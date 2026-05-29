// Campaign Worker - Auto-resume stuck campaigns and auto-process follow-ups
// This module provides endpoints that the frontend calls periodically to ensure
// campaigns never get stuck and follow-ups fire on schedule.

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as kv from "./kv-retry.tsx";
import { processFollowUpsForCampaign } from "./follow-ups.tsx";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ─── Types ───────────────────────────────────────────────────────────

interface CampaignQueueState {
  campaignId: string;
  userId: string;
  status: 'queued' | 'sending' | 'paused' | 'completed' | 'failed';
  totalLeads: number;
  sentCount: number;
  failedCount: number;
  startedAt: string;
  updatedAt: string;
  lastError?: string;
  batchSize: number;
}

// ─── KV Keys ─────────────────────────────────────────────────────────

function queueKey(userId: string, campaignId: string) {
  return `campaign_queue:${userId}:${campaignId}`;
}

function activeQueuesKey(userId: string) {
  return `active_queues:${userId}`;
}

// ─── Queue Management ────────────────────────────────────────────────

/**
 * Enqueue a campaign for background sending.
 * This marks the campaign as "sending" and stores the queue state.
 */
export async function enqueueCampaign(userId: string, campaignId: string, batchSize = 5): Promise<CampaignQueueState> {
  const storageGuard = kv.shouldSkipWriteHeavyTask('campaign-worker-enqueue');
  if (!storageGuard.ok) throw new Error('storage_degraded');

  const campaign = await kv.get(`campaign:${userId}:${campaignId}`);
  if (!campaign) throw new Error('Campaign not found');

  const sentLeadIds = (await kv.get(`campaign_sent:${userId}:${campaignId}`)) || [];
  const totalLeads = (campaign.leads || []).length;

  const state: CampaignQueueState = {
    campaignId,
    userId,
    status: 'sending',
    totalLeads,
    sentCount: sentLeadIds.length,
    failedCount: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    batchSize,
  };

  await kv.set(queueKey(userId, campaignId), state);

  // Track active queues for this user
  const activeQueues: string[] = (await kv.get(activeQueuesKey(userId))) || [];
  if (!activeQueues.includes(campaignId)) {
    activeQueues.push(campaignId);
    await kv.set(activeQueuesKey(userId), activeQueues);
  }

  // Mark campaign as active
  if (campaign.status === 'draft' || campaign.status === 'paused') {
    campaign.status = 'active';
    campaign.updated_at = new Date().toISOString();
    await kv.set(`campaign:${userId}:${campaignId}`, campaign);
    try {
      await supabase.from('campaigns').update({ status: 'active' }).eq('id', campaignId);
    } catch (_) { /* ignore DB sync error */ }
  }

  console.log(`[WORKER] Enqueued campaign ${campaignId} for user ${userId}: ${totalLeads} leads, ${sentLeadIds.length} already sent`);
  return state;
}

/**
 * Get all active/stuck campaigns for a user that need processing.
 * Returns campaigns that are marked as "sending" or "active" with unsent leads.
 */
export async function getPendingCampaigns(userId: string): Promise<Array<{
  campaignId: string;
  remaining: number;
  sentCount: number;
  totalLeads: number;
  status: string;
}>> {
  const storageGuard = kv.shouldSkipWriteHeavyTask('campaign-worker-pending');
  if (!storageGuard.ok) return [];

  const activeQueues: string[] = (await kv.get(activeQueuesKey(userId))) || [];
  const pending: Array<{
    campaignId: string;
    remaining: number;
    sentCount: number;
    totalLeads: number;
    status: string;
  }> = [];

  // Also scan for campaigns that are "active" but not in the queue (edge function died mid-send)
  // We do this by checking campaigns that have status 'active' or 'sending'
  const allCampaignKeys = await kv.getByPrefixLimited(`campaign:${userId}:`, 500, 0);
  const campaignIdsToCheck = new Set(activeQueues);

  for (const entry of (allCampaignKeys || [])) {
    const campaign = entry?.value || entry;
    if (campaign?.status === 'active' || campaign?.status === 'sending') {
      const id = campaign.id || entry?.key?.replace(`campaign:${userId}:`, '');
      if (id) campaignIdsToCheck.add(id);
    }
  }

  for (const campaignId of campaignIdsToCheck) {
    try {
      const campaign = await kv.get(`campaign:${userId}:${campaignId}`);
      if (!campaign || !campaign.leads || campaign.leads.length === 0) continue;
      if (campaign.status === 'completed' || campaign.status === 'draft') continue;

      const sentLeadIds = (await kv.get(`campaign_sent:${userId}:${campaignId}`)) || [];
      const remaining = campaign.leads.length - sentLeadIds.length;

      if (remaining > 0) {
        pending.push({
          campaignId,
          remaining,
          sentCount: sentLeadIds.length,
          totalLeads: campaign.leads.length,
          status: campaign.status || 'active',
        });
      } else {
        // Campaign is done, clean up queue
        await cleanupCompletedCampaign(userId, campaignId);
      }
    } catch (err) {
      console.warn(`[WORKER] Error checking campaign ${campaignId}:`, err);
    }
  }

  return pending;
}

/**
 * Clean up a completed campaign from the active queue.
 */
async function cleanupCompletedCampaign(userId: string, campaignId: string) {
  try {
    // Remove from active queues
    const activeQueues: string[] = (await kv.get(activeQueuesKey(userId))) || [];
    const filtered = activeQueues.filter(id => id !== campaignId);
    await kv.set(activeQueuesKey(userId), filtered);

    // Remove queue state
    await kv.del(queueKey(userId, campaignId));

    // Mark campaign as completed
    const campaign = await kv.get(`campaign:${userId}:${campaignId}`);
    if (campaign && campaign.status !== 'completed') {
      campaign.status = 'completed';
      campaign.updated_at = new Date().toISOString();
      await kv.set(`campaign:${userId}:${campaignId}`, campaign);
      try {
        await supabase.from('campaigns').update({ status: 'completed' }).eq('id', campaignId);
      } catch (_) { /* ignore */ }
    }

    console.log(`[WORKER] Cleaned up completed campaign ${campaignId}`);
  } catch (err) {
    console.warn(`[WORKER] Cleanup error for ${campaignId}:`, err);
  }
}

/**
 * Update queue state after a batch completes.
 */
export async function updateQueueState(userId: string, campaignId: string, batchSent: number, batchFailed: number, isComplete: boolean): Promise<CampaignQueueState | null> {
  const storageGuard = kv.shouldSkipWriteHeavyTask('campaign-worker-update-queue');
  if (!storageGuard.ok) return null;

  const state = await kv.get(queueKey(userId, campaignId)) as CampaignQueueState | null;
  if (!state) return null;

  state.sentCount += batchSent;
  state.failedCount += batchFailed;
  state.updatedAt = new Date().toISOString();

  if (isComplete) {
    state.status = 'completed';
    await cleanupCompletedCampaign(userId, campaignId);
  }

  await kv.set(queueKey(userId, campaignId), state);
  return state;
}

// ─── Follow-Up Processor ─────────────────────────────────────────────

/**
 * Process all due follow-ups for a user's campaigns.
 * Returns a summary of what was processed.
 */
export async function processAllFollowUps(userId: string): Promise<{
  processed: number;
  sent: number;
  campaigns: Array<{ id: string; name: string; followUpsSent: number }>;
  errors: string[];
}> {
  const storageGuard = kv.shouldSkipWriteHeavyTask('campaign-worker-followups');
  if (!storageGuard.ok) {
    return {
      processed: 0,
      sent: 0,
      campaigns: [],
      errors: ['storage_degraded'],
    };
  }

  const result = {
    processed: 0,
    sent: 0,
    campaigns: [] as Array<{ id: string; name: string; followUpsSent: number }>,
    errors: [] as string[],
  };

  try {
    // Get all campaigns with follow-ups enabled (with retry for schema cache errors)
    let campaigns: any[] | null = null;
    let error: any = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await supabase
        .from('campaigns')
        .select('id, name, follow_up_enabled, follow_up_attempts, days_between_follow_ups, status, brand')
        .eq('user_id', userId)
        .eq('follow_up_enabled', true)
        .in('status', ['active', 'completed', 'sending']);
      
      campaigns = res.data;
      error = res.error;
      
      // Retry on schema cache errors
      if (error && (error.message?.includes('schema cache') || error.code === 'PGRST002')) {
        console.warn(`[WORKER] Schema cache error, attempt ${attempt + 1}/3, retrying...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      
      break;
    }

    if (error) {
      console.error('[WORKER] Error fetching campaigns for follow-ups:', error);
      result.errors.push(`Failed to fetch campaigns: ${error.message}`);
      return result;
    }

    if (!campaigns || campaigns.length === 0) {
      return result;
    }

    console.log(`[WORKER] Processing follow-ups for ${campaigns.length} campaigns (user: ${userId})`);

    for (const campaign of campaigns) {
      try {
        result.processed++;
        const followUpResult = await processFollowUpsForCampaign(campaign.id, userId);

        if (followUpResult.success) {
          const sent = followUpResult.followUpsSent || 0;
          result.sent += sent;
          if (sent > 0) {
            result.campaigns.push({
              id: campaign.id,
              name: campaign.name,
              followUpsSent: sent,
            });
          }
        } else {
          result.errors.push(`Campaign ${campaign.name}: ${followUpResult.error}`);
        }
      } catch (err: any) {
        console.error(`[WORKER] Follow-up error for campaign ${campaign.id}:`, err);
        result.errors.push(`Campaign ${campaign.name}: ${err.message}`);
      }
    }

    console.log(`[WORKER] Follow-ups complete: ${result.sent} sent across ${result.campaigns.length} campaigns`);
  } catch (err: any) {
    console.error('[WORKER] processAllFollowUps error:', err);
    result.errors.push(err.message);
  }

  return result;
}

// ─── Follow-Up Due Check ─────────────────────────────────────────────

/**
 * Check how many follow-ups are due for a user (lightweight check, no sending).
 */
export async function getFollowUpsDueCount(userId: string): Promise<{
  totalDue: number;
  campaigns: Array<{ id: string; name: string; dueCount: number }>;
}> {
  const result = {
    totalDue: 0,
    campaigns: [] as Array<{ id: string; name: string; dueCount: number }>,
  };

  try {
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, name, follow_up_enabled, follow_up_attempts, days_between_follow_ups')
      .eq('user_id', userId)
      .eq('follow_up_enabled', true)
      .in('status', ['active', 'completed', 'sending']);

    if (!campaigns || campaigns.length === 0) return result;

    for (const campaign of campaigns) {
      try {
        const daysBetween = campaign.days_between_follow_ups || 3;
        const maxAttempts = campaign.follow_up_attempts || 3;
        const cutoff = new Date(Date.now() - daysBetween * 24 * 60 * 60 * 1000).toISOString();

        // Count emails that are due for follow-up:
        // - Sent before the cutoff (enough time has passed)
        // - Not already at max attempts
        // - Lead hasn't replied or been marked
        const { count, error } = await supabase
          .from('emails')
          .select('id', { count: 'estimated', head: true })
          .eq('user_id', userId)
          .eq('campaign_id', campaign.id)
          .in('status', ['sent', 'delivered', 'opened', 'clicked'])
          .lt('sequence_number', maxAttempts)
          .lt('created_at', cutoff);

        if (!error && count && count > 0) {
          // Subtract any that already have follow-ups sent
          const { count: followedUpCount } = await supabase
            .from('emails')
            .select('id', { count: 'estimated', head: true })
            .eq('user_id', userId)
            .eq('campaign_id', campaign.id)
            .gt('sequence_number', 1);

          const dueCount = Math.max(0, (count || 0) - (followedUpCount || 0));
          if (dueCount > 0) {
            result.totalDue += dueCount;
            result.campaigns.push({ id: campaign.id, name: campaign.name, dueCount });
          }
        }
      } catch (_) { /* skip this campaign */ }
    }
  } catch (err) {
    console.error('[WORKER] getFollowUpsDueCount error:', err);
  }

  return result;
}

// ─── Global Cron: Process ALL Users ──────────────────────────────────

const CRON_LOCK_KEY = 'cron:followup_lock';
const CRON_LAST_RUN_KEY = 'cron:followup_last_run';
const CRON_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Process follow-ups for ALL users who have active campaigns with follow-ups enabled.
 * Protected by a KV-based lock to prevent concurrent runs.
 * Returns a global summary.
 */
export async function processAllUsersFollowUps(): Promise<{
  usersProcessed: number;
  totalSent: number;
  userResults: Array<{ userId: string; email: string; sent: number; errors: number }>;
  errors: string[];
  skipped: boolean;
  lastRun: string;
}> {
  const now = new Date();
  const result = {
    usersProcessed: 0,
    totalSent: 0,
    userResults: [] as Array<{ userId: string; email: string; sent: number; errors: number }>,
    errors: [] as string[],
    skipped: false,
    lastRun: now.toISOString(),
  };

  // ── Acquire lock (simple KV-based mutex) ──
  const lock = await kv.get(CRON_LOCK_KEY);
  if (lock) {
    const lockAge = now.getTime() - new Date(lock.lockedAt).getTime();
    // If lock is older than 10 minutes, assume it's stale and proceed
    if (lockAge < 10 * 60 * 1000) {
      console.log('[CRON] Another cron run is in progress, skipping');
      result.skipped = true;
      return result;
    }
    console.warn('[CRON] Stale lock detected (age: ' + Math.round(lockAge / 1000) + 's), overriding');
  }

  await kv.set(CRON_LOCK_KEY, { lockedAt: now.toISOString(), pid: crypto.randomUUID() });

  try {
    // ── Find all distinct users who have follow-up-enabled campaigns (with retry) ──
    let campaigns: any[] | null = null;
    let error: any = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await supabase
        .from('campaigns')
        .select('user_id, id, name, follow_up_enabled, follow_up_attempts, days_between_follow_ups, status, brand')
        .eq('follow_up_enabled', true)
        .in('status', ['active', 'completed', 'sending']);
      
      campaigns = res.data;
      error = res.error;
      
      // Retry on schema cache errors
      if (error && (error.message?.includes('schema cache') || error.code === 'PGRST002')) {
        console.warn(`[CRON] Schema cache error, attempt ${attempt + 1}/3, retrying...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      
      break;
    }

    if (error) {
      console.error('[CRON] Error fetching campaigns:', error);
      result.errors.push(`DB query failed: ${error.message}`);
      return result;
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('[CRON] No campaigns with follow-ups enabled');
      return result;
    }

    // Group campaigns by user
    const userCampaigns = new Map<string, typeof campaigns>();
    for (const c of campaigns) {
      const existing = userCampaigns.get(c.user_id) || [];
      existing.push(c);
      userCampaigns.set(c.user_id, existing);
    }

    console.log(`[CRON] Processing follow-ups for ${userCampaigns.size} user(s) across ${campaigns.length} campaign(s)`);

    // ── Process each user's campaigns ──
    for (const [userId, userCamps] of userCampaigns) {
      try {
        result.usersProcessed++;

        // Look up user email for logging (best-effort)
        let userEmail = userId;
        try {
          const { data: userData } = await supabase.auth.admin.getUserById(userId);
          if (userData?.user?.email) userEmail = userData.user.email;
        } catch (_) { /* non-critical */ }

        console.log(`[CRON] Processing ${userCamps.length} campaign(s) for ${userEmail}`);

        let userSent = 0;
        let userErrors = 0;

        for (const campaign of userCamps) {
          try {
            const followUpResult = await processFollowUpsForCampaign(campaign.id, userId);
            if (followUpResult.success) {
              const sent = followUpResult.followUpsSent || 0;
              userSent += sent;
              result.totalSent += sent;
            } else {
              userErrors++;
              result.errors.push(`${userEmail} / ${campaign.name}: ${followUpResult.error}`);
            }
          } catch (err: any) {
            userErrors++;
            console.error(`[CRON] Error processing campaign ${campaign.id} for ${userEmail}:`, err);
            result.errors.push(`${userEmail} / ${campaign.name}: ${err.message}`);
          }
        }

        result.userResults.push({
          userId,
          email: userEmail,
          sent: userSent,
          errors: userErrors,
        });
      } catch (err: any) {
        console.error(`[CRON] Error processing user ${userId}:`, err);
        result.errors.push(`User ${userId}: ${err.message}`);
      }
    }

    // ── Store last run timestamp ──
    await kv.set(CRON_LAST_RUN_KEY, {
      completedAt: new Date().toISOString(),
      usersProcessed: result.usersProcessed,
      totalSent: result.totalSent,
      errorsCount: result.errors.length,
    });

    console.log(`[CRON] Complete: ${result.totalSent} follow-ups sent for ${result.usersProcessed} user(s)`);
  } catch (err: any) {
    console.error('[CRON] Fatal error:', err);
    result.errors.push(`Fatal: ${err.message}`);
  } finally {
    // ── Release lock ──
    await kv.del(CRON_LOCK_KEY).catch(() => {});
  }

  return result;
}

/**
 * Opportunistic cron: called by the per-user auto-process endpoint.
 * If the global cron hasn't run in >2 hours, triggers a full run.
 * Returns true if a global run was triggered.
 */
export async function maybeRunGlobalCron(): Promise<boolean> {
  try {
    const lastRun = await kv.get(CRON_LAST_RUN_KEY) as { completedAt: string } | null;
    
    if (lastRun?.completedAt) {
      const elapsed = Date.now() - new Date(lastRun.completedAt).getTime();
      if (elapsed < CRON_INTERVAL_MS) {
        return false; // Too soon
      }
    }

    console.log('[CRON] Opportunistic trigger: global cron overdue, starting full run');
    // Fire and forget — don't block the user's own auto-process
    processAllUsersFollowUps().catch(err => {
      console.error('[CRON] Background global run error:', err);
    });
    return true;
  } catch (err) {
    console.warn('[CRON] maybeRunGlobalCron check error:', err);
    return false;
  }
}

/**
 * Get the status of the last cron run.
 */
export async function getCronStatus(): Promise<{
  lastRun: any;
  lockActive: boolean;
  cronIntervalHours: number;
}> {
  const lastRun = await kv.get(CRON_LAST_RUN_KEY);
  const lock = await kv.get(CRON_LOCK_KEY);
  return {
    lastRun: lastRun || null,
    lockActive: !!lock,
    cronIntervalHours: CRON_INTERVAL_MS / (60 * 60 * 1000),
  };
}
