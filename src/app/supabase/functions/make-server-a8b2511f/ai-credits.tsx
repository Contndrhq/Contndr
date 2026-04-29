/**
 * AI Call Credits System
 * 
 * Manages per-user credit balances for AI calling.
 * Credits are allocated monthly based on plan tier, consumed per-call-minute,
 * and can be topped up via Stripe credit-pack purchases.
 *
 * KV keys:
 *   ai_credits:{userId}           → CreditBalance
 *   ai_credits_log:{userId}       → CreditLogEntry[] (recent 200)
 *   ai_credits_topup:{sessionId}  → { userId, pack, status }
 */

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import * as kv from './kv-retry.tsx';
import { createClient } from 'npm:@supabase/supabase-js@2';

const app = new Hono();
app.use('*', cors());

app.onError((err, c) => {
  console.error('❌ AI Credits route error:', err);
  return c.json({ success: false, error: 'Internal server error', details: err.message }, 500);
});

// ─── Types ────────────────────────────────────────────────────────────────

export interface CreditBalance {
  balance: number;                // current remaining credits (minutes)
  monthly_allocation: number;     // how many credits the plan gives each cycle
  bonus_credits: number;          // purchased top-up credits (don't expire on cycle reset)
  used_this_period: number;       // credits consumed this billing period
  period_start: string;           // ISO date — start of current billing period
  period_end: string;             // ISO date — end of current billing period
  last_reset: string;             // ISO date — last time monthly credits were reset
  plan: string;                   // plan name for reference
  updated_at: string;
}

export interface CreditLogEntry {
  id: string;
  type: 'allocation' | 'deduction' | 'topup' | 'reset' | 'refund' | 'admin_adjust';
  amount: number;                 // positive = added, negative = consumed
  balance_after: number;
  description: string;
  call_id?: string;
  campaign_id?: string;
  timestamp: string;
}

// ─── Plan Allocations ─────────────────────────────────────────────────────

export const PLAN_CREDITS: Record<string, number> = {
  starter: 0,           // No AI calls on Starter
  professional: 0,      // No AI calls on Professional
  growth: 200,          // 200 call-minutes / month
  enterprise: 1000,     // 1,000 call-minutes / month
};

export const CREDIT_PACKS = [
  { id: 'pack_50',   credits: 50,   price_cents: 2500,  label: '50 Credits',   savings: null },
  { id: 'pack_100',  credits: 100,  price_cents: 4500,  label: '100 Credits',  savings: '10% off' },
  { id: 'pack_250',  credits: 250,  price_cents: 10000, label: '250 Credits',  savings: '20% off' },
  { id: 'pack_500',  credits: 500,  price_cents: 17500, label: '500 Credits',  savings: '30% off' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function creditKey(userId: string) { return `ai_credits:${userId}`; }
function logKey(userId: string) { return `ai_credits_log:${userId}`; }

/** Get or initialise a user's credit balance */
export async function getCredits(userId: string): Promise<CreditBalance> {
  let bal: CreditBalance | null = await kv.get(creditKey(userId));
  if (!bal) {
    // Initialise with zero — will be allocated when plan info is available
    const now = new Date().toISOString();
    bal = {
      balance: 0,
      monthly_allocation: 0,
      bonus_credits: 0,
      used_this_period: 0,
      period_start: now,
      period_end: getNextMonthISO(now),
      last_reset: now,
      plan: 'none',
      updated_at: now,
    };
    await kv.set(creditKey(userId), bal);
  }
  return bal;
}

/** Allocate credits for a plan (called on subscription create/update) */
export async function allocateCredits(userId: string, plan: string): Promise<CreditBalance> {
  const allocation = PLAN_CREDITS[plan] || 0;
  const now = new Date().toISOString();
  const existing = await getCredits(userId);

  // If the plan already matches and we're within the same period, don't double-allocate
  if (existing.plan === plan && existing.monthly_allocation === allocation && existing.period_end > now) {
    console.log(`[CREDITS] Credits already allocated for ${userId} on ${plan} plan`);
    return existing;
  }

  const updated: CreditBalance = {
    ...existing,
    balance: allocation + existing.bonus_credits,
    monthly_allocation: allocation,
    used_this_period: 0,
    period_start: now,
    period_end: getNextMonthISO(now),
    last_reset: now,
    plan,
    updated_at: now,
  };

  await kv.set(creditKey(userId), updated);
  await appendLog(userId, {
    type: 'allocation',
    amount: allocation,
    balance_after: updated.balance,
    description: `Monthly allocation for ${plan} plan: ${allocation} credits`,
  });

  console.log(`[CREDITS] Allocated ${allocation} credits for ${userId} (${plan})`);
  return updated;
}

/** Reset credits at the start of a new billing period */
export async function resetMonthlyCredits(userId: string): Promise<CreditBalance> {
  const bal = await getCredits(userId);
  const now = new Date().toISOString();

  // Only reset if we're past the period end
  if (bal.period_end > now) {
    console.log(`[CREDITS] Period not ended yet for ${userId}, skipping reset`);
    return bal;
  }

  const updated: CreditBalance = {
    ...bal,
    balance: bal.monthly_allocation + bal.bonus_credits,
    used_this_period: 0,
    period_start: now,
    period_end: getNextMonthISO(now),
    last_reset: now,
    updated_at: now,
  };

  await kv.set(creditKey(userId), updated);
  await appendLog(userId, {
    type: 'reset',
    amount: bal.monthly_allocation,
    balance_after: updated.balance,
    description: `Monthly credit reset: ${bal.monthly_allocation} credits renewed`,
  });

  console.log(`[CREDITS] Reset monthly credits for ${userId}: ${updated.balance}`);
  return updated;
}

/** Check if a user has enough credits for a call */
export async function hasCredits(userId: string, required: number = 1): Promise<{ allowed: boolean; balance: number; message?: string }> {
  const bal = await getCredits(userId);

  // Auto-reset if period expired
  if (bal.period_end <= new Date().toISOString()) {
    const reset = await resetMonthlyCredits(userId);
    return {
      allowed: reset.balance >= required,
      balance: reset.balance,
      message: reset.balance < required ? `Insufficient credits. You have ${reset.balance} credits, need ${required}.` : undefined,
    };
  }

  return {
    allowed: bal.balance >= required,
    balance: bal.balance,
    message: bal.balance < required ? `Insufficient credits. You have ${bal.balance} credits, need ${required}.` : undefined,
  };
}

/**
 * Deduct credits for a completed call.
 * @param minutes — call duration in minutes (rounded up)
 * @returns updated balance or null if insufficient
 */
export async function deductCredits(
  userId: string,
  minutes: number,
  meta?: { call_id?: string; campaign_id?: string; lead_name?: string }
): Promise<CreditBalance | null> {
  const creditsToDeduct = Math.max(1, Math.ceil(minutes)); // minimum 1 credit per call
  const bal = await getCredits(userId);

  if (bal.balance < creditsToDeduct) {
    console.warn(`[CREDITS] Insufficient credits for ${userId}: has ${bal.balance}, needs ${creditsToDeduct}`);
    return null;
  }

  // Deduct from bonus credits first, then monthly
  let newBonus = bal.bonus_credits;
  let remaining = creditsToDeduct;

  // First consume from monthly allocation (balance - bonus_credits)
  const monthlyRemaining = bal.balance - bal.bonus_credits;
  if (monthlyRemaining >= remaining) {
    // All from monthly
  } else {
    // Consume all monthly first, then from bonus
    const fromBonus = remaining - Math.max(0, monthlyRemaining);
    newBonus = Math.max(0, bal.bonus_credits - fromBonus);
  }

  const updated: CreditBalance = {
    ...bal,
    balance: bal.balance - creditsToDeduct,
    bonus_credits: newBonus,
    used_this_period: bal.used_this_period + creditsToDeduct,
    updated_at: new Date().toISOString(),
  };

  await kv.set(creditKey(userId), updated);

  const desc = meta?.lead_name
    ? `AI call to ${meta.lead_name} (${minutes.toFixed(1)} min)`
    : `AI call (${minutes.toFixed(1)} min)`;

  await appendLog(userId, {
    type: 'deduction',
    amount: -creditsToDeduct,
    balance_after: updated.balance,
    description: desc,
    call_id: meta?.call_id,
    campaign_id: meta?.campaign_id,
  });

  console.log(`[CREDITS] Deducted ${creditsToDeduct} credits from ${userId}. New balance: ${updated.balance}`);
  return updated;
}

/** Add purchased top-up credits */
export async function addTopupCredits(userId: string, credits: number, packId: string): Promise<CreditBalance> {
  const bal = await getCredits(userId);

  const updated: CreditBalance = {
    ...bal,
    balance: bal.balance + credits,
    bonus_credits: bal.bonus_credits + credits,
    updated_at: new Date().toISOString(),
  };

  await kv.set(creditKey(userId), updated);
  await appendLog(userId, {
    type: 'topup',
    amount: credits,
    balance_after: updated.balance,
    description: `Purchased ${credits} credit top-up (${packId})`,
  });

  console.log(`[CREDITS] Added ${credits} top-up credits for ${userId}. New balance: ${updated.balance}`);
  return updated;
}

/** Admin credit adjustment */
export async function adminAdjust(userId: string, amount: number, reason: string): Promise<CreditBalance> {
  const bal = await getCredits(userId);
  const updated: CreditBalance = {
    ...bal,
    balance: Math.max(0, bal.balance + amount),
    bonus_credits: amount > 0 ? bal.bonus_credits + amount : bal.bonus_credits,
    updated_at: new Date().toISOString(),
  };

  await kv.set(creditKey(userId), updated);
  await appendLog(userId, {
    type: 'admin_adjust',
    amount,
    balance_after: updated.balance,
    description: `Admin adjustment: ${reason}`,
  });

  console.log(`[CREDITS] Admin adjusted ${amount} credits for ${userId}: ${reason}`);
  return updated;
}

// ─── Log helpers ──────────────────────────────────────────────────────────

async function appendLog(userId: string, entry: Omit<CreditLogEntry, 'id' | 'timestamp'>) {
  const logs: CreditLogEntry[] = (await kv.get(logKey(userId))) || [];
  logs.unshift({
    ...entry,
    id: `clog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  });
  // Keep last 200 entries
  if (logs.length > 200) logs.length = 200;
  await kv.set(logKey(userId), logs);
}

export async function getCreditLog(userId: string, limit: number = 50): Promise<CreditLogEntry[]> {
  const logs: CreditLogEntry[] = (await kv.get(logKey(userId))) || [];
  return logs.slice(0, limit);
}

// ─── Date helpers ─────────────────────────────────────────────────────────

function getNextMonthISO(isoDate: string): string {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP Routes
// ═══════════════════════════════════════════════════════════════════════════

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function getUser(c: any) {
  const token = c.req.header('Authorization')?.split(' ')[1];
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user?.id) return null;
  return user;
}

// Admin check — mirrors main server ADMIN_EMAILS + ADMIN_UIDS
const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];
const ADMIN_EMAILS = ['admin@contndr.com', 'or@roadr.com', 'or@contndr.com'];
function isAdminUser(user: { id: string; email?: string }): boolean {
  if (ADMIN_UIDS.includes(user.id)) return true;
  if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase().trim())) return true;
  return false;
}

// GET /credits - Get current user's credit balance + recent log
app.get('/credits', async (c) => {
  try {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const balance = await getCredits(user.id);

    // Auto-reset if period expired
    let finalBalance = balance;
    if (balance.period_end <= new Date().toISOString() && balance.monthly_allocation > 0) {
      finalBalance = await resetMonthlyCredits(user.id);
    }

    const log = await getCreditLog(user.id, 30);

    return c.json({
      success: true,
      credits: finalBalance,
      log,
      packs: CREDIT_PACKS,
    });
  } catch (error: any) {
    console.error('[CREDITS] Error getting credits:', error);
    return c.json({ error: error.message }, 500);
  }
});

// POST /credits/check - Pre-flight check before initiating a call
app.post('/credits/check', async (c) => {
  try {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json().catch(() => ({}));
    const required = body.required || 1;

    const result = await hasCredits(user.id, required);
    return c.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[CREDITS] Error checking credits:', error);
    return c.json({ error: error.message }, 500);
  }
});

// POST /credits/purchase - Create Stripe checkout for a credit pack
app.post('/credits/purchase', async (c) => {
  try {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const { pack_id } = await c.req.json();
    const pack = CREDIT_PACKS.find(p => p.id === pack_id);
    if (!pack) return c.json({ error: 'Invalid credit pack' }, 400);

    // Create a one-time Stripe checkout session
    const { getStripe } = await import('./contndr-billing.tsx');
    const stripe = await getStripe();
    if (!stripe) return c.json({ error: 'Stripe not configured' }, 500);

    // Get or create customer (with stale-ID recovery)
    let customerId = await kv.get(`stripe_customer:${user.id}`);

    // Validate the stored customer still exists in Stripe
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (retrieveErr: any) {
        console.warn(`[CREDITS] Stored Stripe customer ${customerId} is invalid (${retrieveErr.code || retrieveErr.message}), re-resolving...`);
        customerId = null; // Force re-lookup below
      }
    }

    if (!customerId) {
      const existing = await stripe.customers.list({ email: user.email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.id },
        });
        customerId = customer.id;
      }
      await kv.set(`stripe_customer:${user.id}`, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: pack.price_cents,
          product_data: {
            name: `AI Call Credits - ${pack.label}`,
            description: `${pack.credits} AI call minutes for Contndr`,
          },
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: {
        type: 'credit_topup',
        userId: user.id,
        pack_id: pack.id,
        credits: String(pack.credits),
      },
      success_url: `${c.req.header('origin') || 'https://contndr.com'}/dashboard?credit_purchase=success`,
      cancel_url: `${c.req.header('origin') || 'https://contndr.com'}/dashboard?credit_purchase=canceled`,
    });

    // Store pending purchase for webhook
    await kv.set(`ai_credits_topup:${session.id}`, {
      userId: user.id,
      pack_id: pack.id,
      credits: pack.credits,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    return c.json({ success: true, url: session.url });
  } catch (error: any) {
    console.error('[CREDITS] Error creating purchase:', error);
    return c.json({ error: error.message }, 500);
  }
});

// POST /credits/admin-adjust - Admin manually adjust credits
app.post('/credits/admin-adjust', async (c) => {
  try {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    // Only admin can adjust
    if (!isAdminUser(user)) return c.json({ error: 'Admin only' }, 403);

    const { target_user_id, amount, reason } = await c.req.json();
    if (!target_user_id || amount === undefined) {
      return c.json({ error: 'target_user_id and amount are required' }, 400);
    }

    const updated = await adminAdjust(target_user_id, amount, reason || 'Manual admin adjustment');
    return c.json({ success: true, credits: updated });
  } catch (error: any) {
    console.error('[CREDITS] Error admin adjusting:', error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /credits/log - Get full credit usage history
app.get('/credits/log', async (c) => {
  try {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const limit = parseInt(c.req.query('limit') || '50');
    const log = await getCreditLog(user.id, limit);
    return c.json({ success: true, log });
  } catch (error: any) {
    console.error('[CREDITS] Error getting log:', error);
    return c.json({ error: error.message }, 500);
  }
});

// GET /credits/admin-view/:userId - Admin view any user's credits + log
app.get('/credits/admin-view/:userId', async (c) => {
  try {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    if (!isAdminUser(user)) return c.json({ error: 'Admin only' }, 403);

    const targetUserId = c.req.param('userId');
    if (!targetUserId) return c.json({ error: 'userId is required' }, 400);

    const balance = await getCredits(targetUserId);
    const log = await getCreditLog(targetUserId, 50);

    return c.json({ success: true, credits: balance, log });
  } catch (error: any) {
    console.error('[CREDITS] Error admin viewing credits:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;