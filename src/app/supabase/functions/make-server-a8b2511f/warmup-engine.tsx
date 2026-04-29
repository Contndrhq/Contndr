/**
 * EMAIL WARM-UP ENGINE — Gradual Send Volume Ramp-Up
 *
 * Protects sender reputation by:
 *  - Tracking daily send volume per sender account
 *  - Enforcing graduated daily limits (start low, ramp up)
 *  - Monitoring bounce/complaint rates
 *  - Auto-pausing accounts that exceed thresholds
 *
 * KV Schema:
 *   warmup:{userId}:{accountId}              → WarmupAccount
 *   warmup_daily:{userId}:{accountId}:{date} → number (sent count)
 *   warmup_accounts:{userId}                 → string[] (account IDs)
 *   sender_accounts:{userId}                 → SenderAccount[] (multi-account rotation)
 *   sender_rotation:{userId}                 → SenderRotationConfig
 */

import * as kv from "./kv-retry.tsx";

// ─── Types ───────────────────────────────────────────────────────────

export interface WarmupAccount {
  id: string;
  userId: string;
  email: string;
  provider: 'gmail' | 'outlook' | 'smtp' | 'resend';
  /** Day the warm-up started (day 0) */
  startDate: string;
  /** Current warm-up day number */
  currentDay: number;
  /** Current allowed daily limit */
  currentDailyLimit: number;
  /** Target daily limit at full warm-up */
  targetDailyLimit: number;
  /** Days to reach target */
  warmupDurationDays: number;
  /** Warm-up schedule: how many emails per day at each stage */
  schedule: WarmupScheduleEntry[];
  status: 'warming' | 'warmed' | 'paused' | 'suspended';
  /** Running stats */
  totalSent: number;
  totalBounced: number;
  totalComplaints: number;
  bounceRate: number;
  /** Auto-pause threshold (bounce rate %) */
  maxBounceRate: number;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarmupScheduleEntry {
  dayStart: number;
  dayEnd: number;
  dailyLimit: number;
}

export interface SenderAccount {
  id: string;
  email: string;
  provider: 'gmail' | 'outlook' | 'smtp' | 'resend';
  /** Maximum emails per day */
  dailyLimit: number;
  /** Emails sent today */
  sentToday: number;
  /** Is this account enabled for rotation? */
  enabled: boolean;
  /** Warm-up status */
  warmupStatus: 'not_started' | 'warming' | 'warmed';
  /** Connection status */
  connected: boolean;
  displayName?: string;
  addedAt: string;
}

export interface SenderRotationConfig {
  enabled: boolean;
  /** 'round_robin' | 'least_used' | 'random' */
  strategy: 'round_robin' | 'least_used' | 'random';
  /** Index for round-robin rotation */
  currentIndex: number;
  /** Global daily limit across all accounts */
  globalDailyLimit: number;
}

// ─── KV Keys ─────────────────────────────────────────────────────────

function warmupKey(userId: string, accountId: string) { return `warmup:${userId}:${accountId}`; }
function warmupDailyKey(userId: string, accountId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `warmup_daily:${userId}:${accountId}:${today}`;
}
function warmupAccountsKey(userId: string) { return `warmup_accounts:${userId}`; }
function senderAccountsKey(userId: string) { return `sender_accounts:${userId}`; }
function senderRotationKey(userId: string) { return `sender_rotation:${userId}`; }

// ─── Default Warm-Up Schedule ────────────────────────────────────────

function generateWarmupSchedule(targetDaily: number, durationDays: number): WarmupScheduleEntry[] {
  const schedule: WarmupScheduleEntry[] = [];
  const phases = Math.min(durationDays, 8); // 8 phases max
  const phaseLength = Math.ceil(durationDays / phases);

  for (let i = 0; i < phases; i++) {
    const progress = (i + 1) / phases;
    // Exponential ramp: starts very low, accelerates
    const limit = Math.max(2, Math.round(targetDaily * Math.pow(progress, 1.5)));
    schedule.push({
      dayStart: i * phaseLength,
      dayEnd: (i + 1) * phaseLength - 1,
      dailyLimit: Math.min(limit, targetDaily),
    });
  }

  return schedule;
}

// ─── Warm-Up Account Management ──────────────────────────────────────

export async function startWarmup(userId: string, email: string, provider: 'gmail' | 'outlook' | 'smtp' | 'resend', options?: {
  targetDailyLimit?: number;
  warmupDurationDays?: number;
  maxBounceRate?: number;
}): Promise<WarmupAccount> {
  const id = crypto.randomUUID();
  const targetDaily = options?.targetDailyLimit || 100;
  const duration = options?.warmupDurationDays || 28;
  const schedule = generateWarmupSchedule(targetDaily, duration);

  const account: WarmupAccount = {
    id,
    userId,
    email,
    provider,
    startDate: new Date().toISOString(),
    currentDay: 0,
    currentDailyLimit: schedule[0]?.dailyLimit || 2,
    targetDailyLimit: targetDaily,
    warmupDurationDays: duration,
    schedule,
    status: 'warming',
    totalSent: 0,
    totalBounced: 0,
    totalComplaints: 0,
    bounceRate: 0,
    maxBounceRate: options?.maxBounceRate || 5,
    lastSentAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await kv.set(warmupKey(userId, id), account);

  // Track account list
  const list: string[] = (await kv.get(warmupAccountsKey(userId))) || [];
  if (!list.includes(id)) {
    list.push(id);
    await kv.set(warmupAccountsKey(userId), list);
  }

  console.log(`[WARMUP] Started warm-up for ${email}: ${duration} days to reach ${targetDaily}/day`);
  return account;
}

export async function getWarmupAccount(userId: string, accountId: string): Promise<WarmupAccount | null> {
  return await kv.get(warmupKey(userId, accountId));
}

export async function listWarmupAccounts(userId: string): Promise<WarmupAccount[]> {
  const list: string[] = (await kv.get(warmupAccountsKey(userId))) || [];
  const accounts: WarmupAccount[] = [];
  for (const id of list) {
    const acc = await kv.get(warmupKey(userId, id));
    if (acc) accounts.push(acc);
  }
  return accounts;
}

export async function pauseWarmup(userId: string, accountId: string): Promise<void> {
  const acc = await kv.get(warmupKey(userId, accountId));
  if (acc) {
    acc.status = 'paused';
    acc.updatedAt = new Date().toISOString();
    await kv.set(warmupKey(userId, accountId), acc);
  }
}

export async function resumeWarmup(userId: string, accountId: string): Promise<void> {
  const acc = await kv.get(warmupKey(userId, accountId));
  if (acc && (acc.status === 'paused' || acc.status === 'suspended')) {
    acc.status = 'warming';
    acc.updatedAt = new Date().toISOString();
    await kv.set(warmupKey(userId, accountId), acc);
  }
}

export async function deleteWarmup(userId: string, accountId: string): Promise<void> {
  await kv.del(warmupKey(userId, accountId));
  const list: string[] = (await kv.get(warmupAccountsKey(userId))) || [];
  await kv.set(warmupAccountsKey(userId), list.filter(id => id !== accountId));
}

/**
 * Update warm-up progress. Called daily or after each send.
 */
export async function updateWarmupProgress(userId: string, accountId: string): Promise<WarmupAccount | null> {
  const acc = await kv.get(warmupKey(userId, accountId));
  if (!acc || acc.status !== 'warming') return acc;

  const startDate = new Date(acc.startDate);
  const now = new Date();
  const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  acc.currentDay = daysSinceStart;

  // Find current schedule phase
  const phase = acc.schedule.find(s => daysSinceStart >= s.dayStart && daysSinceStart <= s.dayEnd);
  if (phase) {
    acc.currentDailyLimit = phase.dailyLimit;
  }

  // Check if warm-up is complete
  if (daysSinceStart >= acc.warmupDurationDays) {
    acc.status = 'warmed';
    acc.currentDailyLimit = acc.targetDailyLimit;
    console.log(`[WARMUP] Account ${acc.email} is fully warmed up! Daily limit: ${acc.targetDailyLimit}`);
  }

  // Check bounce rate
  if (acc.totalSent > 10) {
    acc.bounceRate = (acc.totalBounced / acc.totalSent) * 100;
    if (acc.bounceRate > acc.maxBounceRate) {
      acc.status = 'suspended';
      console.log(`[WARMUP] Account ${acc.email} SUSPENDED: bounce rate ${acc.bounceRate.toFixed(1)}% exceeds ${acc.maxBounceRate}%`);
    }
  }

  acc.updatedAt = now.toISOString();
  await kv.set(warmupKey(userId, accountId), acc);
  return acc;
}

/**
 * Record a sent email for warm-up tracking.
 */
export async function recordWarmupSend(userId: string, accountId: string, bounced: boolean = false): Promise<void> {
  const acc = await kv.get(warmupKey(userId, accountId));
  if (!acc) return;

  acc.totalSent++;
  if (bounced) acc.totalBounced++;
  acc.lastSentAt = new Date().toISOString();
  acc.updatedAt = new Date().toISOString();
  await kv.set(warmupKey(userId, accountId), acc);

  // Increment daily counter
  const dailyKey = warmupDailyKey(userId, accountId);
  const dailyCount: number = (await kv.get(dailyKey)) || 0;
  await kv.set(dailyKey, dailyCount + 1);
}

/**
 * Check if a warm-up account can send more emails today.
 */
export async function canSendWarmup(userId: string, accountId: string): Promise<{ canSend: boolean; remaining: number; limit: number }> {
  const acc = await kv.get(warmupKey(userId, accountId));
  if (!acc || acc.status === 'suspended' || acc.status === 'paused') {
    return { canSend: false, remaining: 0, limit: 0 };
  }

  const dailyKey = warmupDailyKey(userId, accountId);
  const sentToday: number = (await kv.get(dailyKey)) || 0;
  const limit = acc.currentDailyLimit;
  const remaining = Math.max(0, limit - sentToday);

  return { canSend: remaining > 0, remaining, limit };
}

// ─── Sender Account Rotation ─────────────────────────────────────────

export async function getSenderAccounts(userId: string): Promise<SenderAccount[]> {
  return (await kv.get(senderAccountsKey(userId))) || [];
}

export async function addSenderAccount(userId: string, account: Omit<SenderAccount, 'id' | 'sentToday' | 'addedAt'>): Promise<SenderAccount> {
  const accounts = await getSenderAccounts(userId);
  const newAccount: SenderAccount = {
    ...account,
    id: crypto.randomUUID(),
    sentToday: 0,
    addedAt: new Date().toISOString(),
  };
  accounts.push(newAccount);
  await kv.set(senderAccountsKey(userId), accounts);
  console.log(`[ROTATION] Added sender account ${account.email} for user ${userId}`);
  return newAccount;
}

export async function removeSenderAccount(userId: string, accountId: string): Promise<void> {
  const accounts = await getSenderAccounts(userId);
  const filtered = accounts.filter(a => a.id !== accountId);
  await kv.set(senderAccountsKey(userId), filtered);
}

export async function updateSenderAccount(userId: string, accountId: string, updates: Partial<SenderAccount>): Promise<void> {
  const accounts = await getSenderAccounts(userId);
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx >= 0) {
    Object.assign(accounts[idx], updates);
    await kv.set(senderAccountsKey(userId), accounts);
  }
}

export async function getRotationConfig(userId: string): Promise<SenderRotationConfig> {
  return (await kv.get(senderRotationKey(userId))) || {
    enabled: false,
    strategy: 'round_robin',
    currentIndex: 0,
    globalDailyLimit: 200,
  };
}

export async function setRotationConfig(userId: string, config: Partial<SenderRotationConfig>): Promise<SenderRotationConfig> {
  const existing = await getRotationConfig(userId);
  const updated = { ...existing, ...config };
  await kv.set(senderRotationKey(userId), updated);
  return updated;
}

/**
 * Pick the next sender account using the configured rotation strategy.
 * Returns the sender email to use, or null if all accounts are at capacity.
 */
export async function pickNextSender(userId: string): Promise<{ email: string; accountId: string } | null> {
  const config = await getRotationConfig(userId);
  if (!config.enabled) return null;

  const accounts = await getSenderAccounts(userId);
  const enabled = accounts.filter(a => a.enabled && a.connected);
  if (enabled.length === 0) return null;

  // Reset daily counts if needed (check first account)
  const today = new Date().toISOString().slice(0, 10);
  const dailyResetKey = `sender_daily_reset:${userId}:${today}`;
  const alreadyReset = await kv.get(dailyResetKey);
  if (!alreadyReset) {
    for (const acc of accounts) { acc.sentToday = 0; }
    await kv.set(senderAccountsKey(userId), accounts);
    await kv.set(dailyResetKey, true);
  }

  // Find accounts with remaining capacity
  const available = enabled.filter(a => a.sentToday < a.dailyLimit);
  if (available.length === 0) return null;

  let chosen: SenderAccount;

  switch (config.strategy) {
    case 'least_used':
      chosen = available.sort((a, b) => a.sentToday - b.sentToday)[0];
      break;
    case 'random':
      chosen = available[Math.floor(Math.random() * available.length)];
      break;
    case 'round_robin':
    default: {
      const idx = config.currentIndex % available.length;
      chosen = available[idx];
      config.currentIndex = idx + 1;
      await kv.set(senderRotationKey(userId), config);
      break;
    }
  }

  // Increment sent count
  const allIdx = accounts.findIndex(a => a.id === chosen.id);
  if (allIdx >= 0) {
    accounts[allIdx].sentToday++;
    await kv.set(senderAccountsKey(userId), accounts);
  }

  return { email: chosen.email, accountId: chosen.id };
}

/**
 * Get rotation stats for dashboard display.
 */
export async function getRotationStats(userId: string): Promise<{
  totalAccounts: number;
  enabledAccounts: number;
  totalSentToday: number;
  globalDailyLimit: number;
  accountBreakdown: Array<{ email: string; sentToday: number; dailyLimit: number; enabled: boolean; warmupStatus: string }>;
}> {
  const accounts = await getSenderAccounts(userId);
  const config = await getRotationConfig(userId);

  return {
    totalAccounts: accounts.length,
    enabledAccounts: accounts.filter(a => a.enabled).length,
    totalSentToday: accounts.reduce((sum, a) => sum + a.sentToday, 0),
    globalDailyLimit: config.globalDailyLimit,
    accountBreakdown: accounts.map(a => ({
      email: a.email,
      sentToday: a.sentToday,
      dailyLimit: a.dailyLimit,
      enabled: a.enabled,
      warmupStatus: a.warmupStatus,
    })),
  };
}