// Cron Scheduler - Automated campaign resume + follow-up processing + notifications
// This module handles:
// 1. Global campaign auto-resume (stuck "active"/"sending" campaigns across all users)
// 2. Follow-up processing for all users (delegates to campaign-worker.tsx)
// 3. Email digest notifications to users about automated activity
// 4. In-app notification storage
// 5. Self-scheduling via Deno.cron (if available) or external cron

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as kv from "./kv-retry.tsx";
import { processAllUsersFollowUps, getCronStatus } from "./campaign-worker.tsx";
import { sendSystemEmail } from "./email-sender.tsx";
import { scoreAllLeads, calculateLeadScore } from "./lead-scoring.tsx";
import { processAllSequences } from "./sequence-engine.tsx";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ─── Constants ───────────────────────────────────────────────────────

const CRON_RESUME_LOCK_KEY = 'cron:resume_lock';
const CRON_RESUME_LAST_RUN_KEY = 'cron:resume_last_run';
const CRON_FULL_LAST_RUN_KEY = 'cron:full_last_run';
const CRON_RESCORE_LAST_RUN_KEY = 'cron:rescore_last_run';
const NOTIFICATION_PREFIX = 'notification:';
const DIGEST_LAST_SENT_PREFIX = 'digest_last_sent:';
const BATCH_LIMIT_PER_CAMPAIGN = 10;

// ─── Types ───────────────────────────────────────────────────────────

interface CronRunResult {
  followUps: {
    usersProcessed: number;
    totalSent: number;
    errors: string[];
  };
  campaignResume: {
    usersProcessed: number;
    campaignsResumed: number;
    totalSent: number;
    errors: string[];
  };
  notifications: {
    emailsSent: number;
    inAppCreated: number;
  };
  duration: number;
}

export interface InAppNotification {
  id: string;
  userId: string;
  type: 'followup_sent' | 'campaign_resumed' | 'campaign_completed' | 'cron_summary' | 'system';
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}

// ─── In-App Notifications ────────────────────────────────────────────

function notificationKey(userId: string, id: string) {
  return `${NOTIFICATION_PREFIX}${userId}:${id}`;
}

function notificationListKey(userId: string) {
  return `${NOTIFICATION_PREFIX}list:${userId}`;
}

export async function createNotification(
  userId: string,
  type: InAppNotification['type'],
  title: string,
  message: string,
  data?: Record<string, any>,
): Promise<InAppNotification> {
  const id = crypto.randomUUID();
  const notification: InAppNotification = {
    id,
    userId,
    type,
    title,
    message,
    data,
    read: false,
    createdAt: new Date().toISOString(),
  };

  // Store the notification
  await kv.set(notificationKey(userId, id), notification);

  // Maintain a list of notification IDs (newest first, max 50)
  const listRaw: string[] = (await kv.get(notificationListKey(userId))) || [];
  listRaw.unshift(id);
  // Keep only the most recent 50
  const trimmed = listRaw.slice(0, 50);
  await kv.set(notificationListKey(userId), trimmed);

  return notification;
}

export async function getNotifications(userId: string, limit = 20): Promise<InAppNotification[]> {
  const listRaw: string[] = (await kv.get(notificationListKey(userId))) || [];
  if (listRaw.length === 0) return [];

  const ids = listRaw.slice(0, limit);
  const notifications: InAppNotification[] = [];

  for (const id of ids) {
    try {
      const n = await kv.get(notificationKey(userId, id));
      if (n) notifications.push(n);
    } catch (_) { /* skip missing */ }
  }

  return notifications;
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const n = await kv.get(notificationKey(userId, notificationId));
  if (n) {
    n.read = true;
    await kv.set(notificationKey(userId, notificationId), n);
  }
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const listRaw: string[] = (await kv.get(notificationListKey(userId))) || [];
  let count = 0;
  for (const id of listRaw) {
    try {
      const n = await kv.get(notificationKey(userId, id));
      if (n && !n.read) {
        n.read = true;
        await kv.set(notificationKey(userId, id), n);
        count++;
      }
    } catch (_) { /* skip */ }
  }
  return count;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const listRaw: string[] = (await kv.get(notificationListKey(userId))) || [];
  let count = 0;
  for (const id of listRaw.slice(0, 50)) {
    try {
      const n = await kv.get(notificationKey(userId, id));
      if (n && !n.read) count++;
    } catch (_) { /* skip */ }
  }
  return count;
}

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  await kv.del(notificationKey(userId, notificationId));
  const listRaw: string[] = (await kv.get(notificationListKey(userId))) || [];
  const filtered = listRaw.filter(id => id !== notificationId);
  await kv.set(notificationListKey(userId), filtered);
}

// ─── Campaign Auto-Resume ────────────────────────────────────────────

/**
 * Activate scheduled campaigns whose scheduled_time has passed.
 * Changes status from 'scheduled' to 'active' so they get picked up by resume logic.
 */
async function activateScheduledCampaigns(): Promise<{
  campaignsActivated: number;
  errors: string[];
}> {
  const result = {
    campaignsActivated: 0,
    errors: [] as string[],
  };

  try {
    const now = new Date().toISOString();
    
    // Find all scheduled campaigns whose time has passed
    const { data: scheduledCampaigns, error } = await supabase
      .from('campaigns')
      .select('id, user_id, name, scheduled_time')
      .eq('status', 'scheduled')
      .lte('scheduled_time', now)
      .not('scheduled_time', 'is', null);

    if (error) {
      result.errors.push(`DB query failed: ${error.message}`);
      return result;
    }

    if (!scheduledCampaigns || scheduledCampaigns.length === 0) {
      return result;
    }

    console.log(`[CRON-SCHEDULE] Found ${scheduledCampaigns.length} scheduled campaign(s) ready to activate`);

    for (const campaign of scheduledCampaigns) {
      try {
        // Update status to 'active' in both KV and DB
        const kvCampaign = await kv.get(`campaign:${campaign.user_id}:${campaign.id}`);
        if (kvCampaign) {
          kvCampaign.status = 'active';
          kvCampaign.updated_at = new Date().toISOString();
          await kv.set(`campaign:${campaign.user_id}:${campaign.id}`, kvCampaign);
        }

        // Update DB
        await supabase
          .from('campaigns')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', campaign.id);

        result.campaignsActivated++;
        console.log(`[CRON-SCHEDULE] Activated campaign "${campaign.name}" (scheduled for ${campaign.scheduled_time})`);
      } catch (err: any) {
        console.error(`[CRON-SCHEDULE] Error activating campaign ${campaign.id}:`, err);
        result.errors.push(`${campaign.name}: ${err.message}`);
      }
    }

    console.log(`[CRON-SCHEDULE] Activated ${result.campaignsActivated} scheduled campaign(s)`);
  } catch (err: any) {
    console.error('[CRON-SCHEDULE] Fatal error:', err);
    result.errors.push(`Fatal: ${err.message}`);
  }

  return result;
}

/**
 * Find and resume all stuck campaigns across ALL users.
 * Calls the send-batch endpoint via HTTP for each stuck campaign using
 * service-key impersonation.
 */
export async function resumeAllUsersCampaigns(): Promise<{
  usersProcessed: number;
  campaignsResumed: number;
  totalSent: number;
  userResults: Array<{ userId: string; email: string; campaigns: number; sent: number }>;
  errors: string[];
}> {
  const result = {
    usersProcessed: 0,
    campaignsResumed: 0,
    totalSent: 0,
    userResults: [] as Array<{ userId: string; email: string; campaigns: number; sent: number }>,
    errors: [] as string[],
  };

  // Acquire lock
  const lock = await kv.get(CRON_RESUME_LOCK_KEY);
  if (lock) {
    const lockAge = Date.now() - new Date(lock.lockedAt).getTime();
    if (lockAge < 15 * 60 * 1000) { // 15 min lock for campaign sends (takes longer)
      console.log('[CRON-RESUME] Lock active, skipping');
      return result;
    }
    console.warn('[CRON-RESUME] Stale lock, overriding');
  }
  await kv.set(CRON_RESUME_LOCK_KEY, { lockedAt: new Date().toISOString() });

  try {
    // Find all campaigns that are active/sending with leads
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id, user_id, name, status')
      .in('status', ['active', 'sending'])
      .order('updated_at', { ascending: true }); // oldest first (most likely stuck)

    if (error) {
      result.errors.push(`DB query failed: ${error.message}`);
      return result;
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('[CRON-RESUME] No active/sending campaigns found');
      return result;
    }

    // Group by user
    const userCampaigns = new Map<string, typeof campaigns>();
    for (const c of campaigns) {
      const existing = userCampaigns.get(c.user_id) || [];
      existing.push(c);
      userCampaigns.set(c.user_id, existing);
    }

    console.log(`[CRON-RESUME] Found ${campaigns.length} active campaigns across ${userCampaigns.size} user(s)`);

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();

    if (!baseUrl || !serviceKey) {
      console.error('[CRON-RESUME] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
      result.errors.push('Missing required environment variables');
      return result;
    }

    const honoApp = (globalThis as any).__honoApp;
    console.log(`[CRON-RESUME] Internal Hono app available: ${!!honoApp}, serviceKey len=${serviceKey.length}, anonKey len=${anonKey.length}`);

    for (const [userId, userCamps] of userCampaigns) {
      try {
        result.usersProcessed++;

        // Look up user email for logging
        let userEmail = userId;
        try {
          const { data: userData } = await supabase.auth.admin.getUserById(userId);
          if (userData?.user?.email) userEmail = userData.user.email;
        } catch (_) { /* non-critical */ }

        let userSent = 0;
        let userCampaignCount = 0;

        for (const campaign of userCamps) {
          try {
            // Check KV for unsent leads
            const kvCampaign = await kv.get(`campaign:${userId}:${campaign.id}`);
            if (!kvCampaign || !kvCampaign.leads || kvCampaign.leads.length === 0) continue;

            const sentLeadIds = (await kv.get(`campaign_sent:${userId}:${campaign.id}`)) || [];
            const remaining = kvCampaign.leads.length - sentLeadIds.length;

            if (remaining <= 0) {
              // Campaign is done, mark as completed
              kvCampaign.status = 'completed';
              kvCampaign.updated_at = new Date().toISOString();
              await kv.set(`campaign:${userId}:${campaign.id}`, kvCampaign);
              try { await supabase.from('campaigns').update({ status: 'completed' }).eq('id', campaign.id); } catch (_) {}
              continue;
            }

            console.log(`[CRON-RESUME] Resuming campaign "${campaign.name}" for ${userEmail}: ${remaining} leads remaining`);

            // Call send-batch directly via the Hono app's internal fetch handler.
            // This bypasses the Supabase API gateway entirely (avoids 401 issues with
            // non-JWT key formats in the Make environment). The Hono auth middleware
            // still validates the service-key + X-Cron-As-User impersonation.
            const sendUrl = `${baseUrl}/functions/v1/make-server-a8b2511f/campaigns/${campaign.id}/send-batch?limit=${BATCH_LIMIT_PER_CAMPAIGN}`;
            
            let response: Response | null = null;
            const internalHeaders: Record<string, string> = {
              'Authorization': `Bearer ${serviceKey}`,
              'X-Cron-As-User': userId,
              'Content-Type': 'application/json',
            };

            // Prefer internal Hono app.fetch (same process, no gateway)
            if (honoApp && typeof honoApp.fetch === 'function') {
              try {
                const internalReq = new Request(sendUrl, { method: 'POST', headers: internalHeaders });
                response = await honoApp.fetch(internalReq);
              } catch (internalErr: any) {
                console.error(`[CRON-RESUME] Internal app.fetch error for "${campaign.name}":`, internalErr.message);
              }
            }

            // Fallback: external HTTP call (in case globalThis ref isn't set yet)
            if (!response) {
              console.log(`[CRON-RESUME] Falling back to external HTTP for "${campaign.name}"`);
              const headerSets = [
                { ...internalHeaders, 'apikey': serviceKey },
                ...(anonKey && anonKey !== serviceKey ? [{ ...internalHeaders, 'apikey': anonKey }] : []),
              ];
              for (let attempt = 0; attempt < headerSets.length; attempt++) {
                try {
                  response = await fetch(sendUrl, { method: 'POST', headers: headerSets[attempt] });
                  if (response.status !== 401) break;
                  console.warn(`[CRON-RESUME] External attempt ${attempt + 1} got 401 for "${campaign.name}"`);
                } catch (fetchErr: any) {
                  console.error(`[CRON-RESUME] External attempt ${attempt + 1} fetch error:`, fetchErr.message);
                }
              }
            }

            if (response && response.ok) {
              const data = await response.json();
              const batchSent = data.sent || 0;
              userSent += batchSent;
              result.totalSent += batchSent;
              result.campaignsResumed++;
              userCampaignCount++;

              if (data.campaign_complete) {
                console.log(`[CRON-RESUME] Campaign "${campaign.name}" completed`);
              } else {
                console.log(`[CRON-RESUME] Campaign "${campaign.name}": sent ${batchSent}, ${data.remaining} remaining`);
              }
            } else {
              const errorText = response ? await response.text().catch(() => 'Unknown error') : 'All fetch attempts failed';
              const status = response?.status || 0;
              console.error(`[CRON-RESUME] send-batch failed for ${campaign.name}: ${status} ${errorText}`);
              result.errors.push(`${userEmail} / ${campaign.name}: ${status} ${errorText.slice(0, 200)}`);
            }

            // Rate limit between campaigns: 3s pause
            await new Promise(resolve => setTimeout(resolve, 3000));

          } catch (err: any) {
            console.error(`[CRON-RESUME] Error resuming campaign ${campaign.id}:`, err);
            result.errors.push(`${userEmail} / ${campaign.name}: ${err.message}`);
          }
        }

        result.userResults.push({
          userId,
          email: userEmail,
          campaigns: userCampaignCount,
          sent: userSent,
        });
      } catch (err: any) {
        result.errors.push(`User ${userId}: ${err.message}`);
      }
    }

    // Store last run
    await kv.set(CRON_RESUME_LAST_RUN_KEY, {
      completedAt: new Date().toISOString(),
      usersProcessed: result.usersProcessed,
      campaignsResumed: result.campaignsResumed,
      totalSent: result.totalSent,
      errorsCount: result.errors.length,
    });

    console.log(`[CRON-RESUME] Complete: resumed ${result.campaignsResumed} campaign(s), sent ${result.totalSent} emails`);
  } catch (err: any) {
    console.error('[CRON-RESUME] Fatal error:', err);
    result.errors.push(`Fatal: ${err.message}`);
  } finally {
    await kv.del(CRON_RESUME_LOCK_KEY).catch(() => {});
  }

  return result;
}

// ─── Email Digest ────────────────────────────────────────────────────

/**
 * Send email digest notifications to users about automated activity.
 * Only sends once per day per user.
 */
async function sendDigestNotifications(
  followUpResults: Array<{ userId: string; email: string; sent: number; errors: number }>,
  resumeResults: Array<{ userId: string; email: string; campaigns: number; sent: number }>,
): Promise<{ emailsSent: number; inAppCreated: number }> {
  let emailsSent = 0;
  let inAppCreated = 0;

  // Merge results by userId
  const userActivity = new Map<string, {
    email: string;
    followUpsSent: number;
    followUpErrors: number;
    campaignsResumed: number;
    campaignEmailsSent: number;
  }>();

  for (const r of followUpResults) {
    const existing = userActivity.get(r.userId) || {
      email: r.email,
      followUpsSent: 0,
      followUpErrors: 0,
      campaignsResumed: 0,
      campaignEmailsSent: 0,
    };
    existing.followUpsSent += r.sent;
    existing.followUpErrors += r.errors;
    existing.email = r.email;
    userActivity.set(r.userId, existing);
  }

  for (const r of resumeResults) {
    const existing = userActivity.get(r.userId) || {
      email: r.email,
      followUpsSent: 0,
      followUpErrors: 0,
      campaignsResumed: 0,
      campaignEmailsSent: 0,
    };
    existing.campaignsResumed += r.campaigns;
    existing.campaignEmailsSent += r.sent;
    existing.email = r.email;
    userActivity.set(r.userId, existing);
  }

  for (const [userId, activity] of userActivity) {
    // Skip users with no activity
    if (activity.followUpsSent === 0 && activity.campaignEmailsSent === 0) continue;

    // ── Create in-app notification (always) ──
    try {
      const parts: string[] = [];
      if (activity.followUpsSent > 0) {
        parts.push(`${activity.followUpsSent} follow-up${activity.followUpsSent !== 1 ? 's' : ''} sent`);
      }
      if (activity.campaignEmailsSent > 0) {
        parts.push(`${activity.campaignEmailsSent} campaign email${activity.campaignEmailsSent !== 1 ? 's' : ''} sent (${activity.campaignsResumed} campaign${activity.campaignsResumed !== 1 ? 's' : ''} resumed)`);
      }

      await createNotification(
        userId,
        'cron_summary',
        'Automated activity summary',
        parts.join(' and ') + '.',
        {
          followUpsSent: activity.followUpsSent,
          campaignEmailsSent: activity.campaignEmailsSent,
          campaignsResumed: activity.campaignsResumed,
          errors: activity.followUpErrors,
          timestamp: new Date().toISOString(),
        },
      );
      inAppCreated++;
    } catch (err) {
      console.warn(`[DIGEST] Failed to create in-app notification for ${activity.email}:`, err);
    }

    // ── Send email digest (max once per day per user) ──
    try {
      const digestKey = `${DIGEST_LAST_SENT_PREFIX}${userId}`;
      const lastSent = await kv.get(digestKey);
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      if (lastSent && new Date(lastSent).getTime() > oneDayAgo) {
        continue; // Already sent today
      }

      // Build digest email
      const lines: string[] = [];
      lines.push(`Hi,`);
      lines.push('');
      lines.push(`Here's a summary of your automated outreach activity:`);
      lines.push('');

      if (activity.followUpsSent > 0) {
        lines.push(`Follow-ups: ${activity.followUpsSent} sent`);
      }
      if (activity.campaignEmailsSent > 0) {
        lines.push(`Campaign emails: ${activity.campaignEmailsSent} sent (${activity.campaignsResumed} campaigns resumed)`);
      }
      if (activity.followUpErrors > 0) {
        lines.push(`Errors: ${activity.followUpErrors}`);
      }

      lines.push('');
      lines.push(`Log in to Contndr to view details and manage your campaigns.`);
      lines.push('');
      lines.push(`This is an automated digest sent once daily when there's outreach activity.`);

      const htmlLines = lines.map(l => l ? `<p style="margin: 4px 0; color: #374151; font-size: 14px;">${l}</p>` : '<br>').join('\n');

      await sendSystemEmail({
        from: 'Contndr <notifications@contndr.com>',
        to: activity.email,
        subject: `Contndr: ${activity.followUpsSent + activity.campaignEmailsSent} automated emails sent`,
        html: `
          <div style="max-width: 480px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <div style="padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff;">
              <h2 style="margin: 0 0 16px; font-size: 18px; color: #111827;">Automated Activity Summary</h2>
              ${htmlLines}
            </div>
            <p style="text-align: center; margin-top: 16px; font-size: 11px; color: #9ca3af;">
              Contndr Automation Engine
            </p>
          </div>
        `,
        text: lines.join('\n'),
      });

      await kv.set(digestKey, new Date().toISOString());
      emailsSent++;
      console.log(`[DIGEST] Sent daily digest to ${activity.email}`);
    } catch (err) {
      console.warn(`[DIGEST] Failed to send email digest to ${activity.email}:`, err);
    }
  }

  return { emailsSent, inAppCreated };
}

// ─── Full Cron Run ───────────────────────────────────────────────────

/**
 * Execute a complete cron cycle:
 * 1. Activate scheduled campaigns
 * 2. Process follow-ups for all users
 * 3. Resume stuck campaigns for all users
 * 4. Send digest notifications
 */
export async function runFullCronCycle(): Promise<CronRunResult> {
  const start = Date.now();
  console.log('[CRON] ════════ Starting full cron cycle ════════');

  const cronResult: CronRunResult = {
    followUps: { usersProcessed: 0, totalSent: 0, errors: [] },
    campaignResume: { usersProcessed: 0, campaignsResumed: 0, totalSent: 0, errors: [] },
    notifications: { emailsSent: 0, inAppCreated: 0 },
    duration: 0,
  };

  // Collect per-user results for digest notifications
  let followUpUserResults: Array<{ userId: string; email: string; sent: number; errors: number }> = [];
  let resumeUserResults: Array<{ userId: string; email: string; campaigns: number; sent: number }> = [];

  // ── Pre-flight: Check DB health and run periodic cleanup ──
  try {
    await kv.get(CRON_FULL_LAST_RUN_KEY); // simple read to test DB
  } catch (err: any) {
    if (err?.message?.includes('memory full') || err?.message?.includes('shared memory') || err?.message?.includes('circuit breaker')) {
      console.warn('[CRON] Database memory exhausted — running emergency GC before cron cycle...');
      try {
        const { runCleanup, resetCircuit } = await import("./kv-cleanup.tsx");
        const stats = await runCleanup();
        console.log(`[CRON] Emergency GC complete: deleted ${stats.totalDeleted} entries in ${stats.duration}ms`);
        resetCircuit();
      } catch (gcErr) {
        console.error('[CRON] Emergency GC failed:', gcErr);
      }
    }
  }
  
  // Run periodic cleanup every cron cycle (proactive maintenance)
  try {
    const { runCleanup } = await import("./kv-cleanup.tsx");
    console.log('[CRON] Running periodic KV cleanup...');
    const stats = await runCleanup();
    console.log(`[CRON] Periodic cleanup: deleted ${stats.totalDeleted} entries (${stats.duration}ms) - tracking: ${stats.categories.tracking}, intent: ${stats.categories.intent}, retry: ${stats.categories.retry}, sessions: ${stats.categories.sessions}`);
  } catch (cleanupErr) {
    console.warn('[CRON] Periodic cleanup failed (non-fatal):', cleanupErr);
  }

  // ── Step 0: Activate scheduled campaigns ──
  try {
    console.log('[CRON] Step 0/4: Activating scheduled campaigns...');
    const activationResult = await activateScheduledCampaigns();
    console.log(`[CRON] Scheduled campaigns: ${activationResult.campaignsActivated} activated`);
    if (activationResult.errors.length > 0) {
      cronResult.campaignResume.errors.push(...activationResult.errors);
    }
  } catch (err: any) {
    console.error('[CRON] Scheduled campaign activation failed:', err);
    cronResult.campaignResume.errors.push(`Activation fatal: ${err.message}`);
  }

  // ── Step 1: Process follow-ups ──
  try {
    console.log('[CRON] Step 1/4: Processing follow-ups...');
    const followUpResult = await processAllUsersFollowUps();
    cronResult.followUps = {
      usersProcessed: followUpResult.usersProcessed,
      totalSent: followUpResult.totalSent,
      errors: followUpResult.errors,
    };
    followUpUserResults = followUpResult.userResults || [];
    console.log(`[CRON] Follow-ups: ${followUpResult.totalSent} sent for ${followUpResult.usersProcessed} user(s)`);
  } catch (err: any) {
    console.error('[CRON] Follow-up step failed:', err);
    cronResult.followUps.errors.push(`Fatal: ${err.message}`);
  }

  // ── Step 2: Resume stuck campaigns ──
  try {
    console.log('[CRON] Step 2/4: Resuming stuck campaigns...');
    const resumeResult = await resumeAllUsersCampaigns();
    cronResult.campaignResume = {
      usersProcessed: resumeResult.usersProcessed,
      campaignsResumed: resumeResult.campaignsResumed,
      totalSent: resumeResult.totalSent,
      errors: resumeResult.errors,
    };
    resumeUserResults = resumeResult.userResults || [];
    console.log(`[CRON] Campaign resume: ${resumeResult.campaignsResumed} campaigns, ${resumeResult.totalSent} emails`);
  } catch (err: any) {
    console.error('[CRON] Campaign resume step failed:', err);
    cronResult.campaignResume.errors.push(`Fatal: ${err.message}`);
  }

  // ── Step 2.5: Process multi-step sequences ──
  try {
    console.log('[CRON] Step 2.5: Processing email sequences...');
    const seqResult = await processAllSequences();
    console.log(`[CRON] Sequences: ${seqResult.totalSent} emails sent for ${seqResult.usersProcessed} user(s)`);
  } catch (err: any) {
    console.error('[CRON] Sequence processing failed:', err);
  }

  // ── Step 3: Send notifications ──
  try {
    console.log('[CRON] Step 3/4: Sending notifications...');
    const notifResult = await sendDigestNotifications(followUpUserResults, resumeUserResults);
    cronResult.notifications = notifResult;
    console.log(`[CRON] Notifications: ${notifResult.emailsSent} emails, ${notifResult.inAppCreated} in-app`);
  } catch (err: any) {
    console.warn('[CRON] Notification step failed:', err);
  }

  cronResult.duration = Date.now() - start;

  // Store full run timestamp
  await kv.set(CRON_FULL_LAST_RUN_KEY, {
    completedAt: new Date().toISOString(),
    duration: cronResult.duration,
    followUpsSent: cronResult.followUps.totalSent,
    campaignsResumed: cronResult.campaignResume.campaignsResumed,
    campaignEmailsSent: cronResult.campaignResume.totalSent,
    notificationsSent: cronResult.notifications.emailsSent,
    errors: [
      ...cronResult.followUps.errors,
      ...cronResult.campaignResume.errors,
    ].length,
  });

  console.log(`[CRON] ════════ Full cycle complete in ${cronResult.duration}ms ════════`);
  return cronResult;
}

// ─── Cron Status ─────────────────────────────────────────────────────

export async function getFullCronStatus(): Promise<{
  followUpCron: any;
  resumeCron: any;
  fullCron: any;
  followUpLockActive: boolean;
  resumeLockActive: boolean;
}> {
  const [followUpStatus, resumeLastRun, fullLastRun, resumeLock] = await Promise.all([
    getCronStatus(),
    kv.get(CRON_RESUME_LAST_RUN_KEY),
    kv.get(CRON_FULL_LAST_RUN_KEY),
    kv.get(CRON_RESUME_LOCK_KEY),
  ]);

  return {
    followUpCron: followUpStatus,
    resumeCron: resumeLastRun || null,
    fullCron: fullLastRun || null,
    followUpLockActive: followUpStatus.lockActive,
    resumeLockActive: !!resumeLock,
  };
}

// ─── Lead Re-Scoring with Intent Data ────────────────────────────────

/**
 * Re-score all leads for all users, incorporating fresh intent data.
 * Builds a high_intent_leads:{userId} set in KV for leads whose intent
 * factor ≥ 61, so the frontend can show "High Intent" badges cheaply.
 * Runs as part of the cron cycle (every 6 hours via Deno.cron).
 */
export async function rescoreAllUsersLeads(): Promise<{
  usersProcessed: number;
  leadsScored: number;
  highIntentLeads: number;
  errors: string[];
}> {
  const result = {
    usersProcessed: 0,
    leadsScored: 0,
    highIntentLeads: 0,
    errors: [] as string[],
  };

  const t0 = Date.now();
  console.log('[CRON-RESCORE] ── Starting lead re-scoring cycle ──');

  try {
    // Get all distinct user IDs that have leads
    const { data: userRows, error: userErr } = await supabase
      .from('leads')
      .select('user_id')
      .limit(10000);

    if (userErr) {
      result.errors.push(`DB query failed: ${userErr.message}`);
      return result;
    }

    const userIds = [...new Set((userRows || []).map((r: any) => r.user_id).filter(Boolean))];
    console.log(`[CRON-RESCORE] Found ${userIds.length} user(s) with leads`);

    for (const userId of userIds) {
      try {
        result.usersProcessed++;

        // Score all leads for this user (this does full scoring with intent lookup)
        const scoreResult = await scoreAllLeads(supabase, userId);
        result.leadsScored += scoreResult.scored;

        // Build the high-intent set by scanning leads that had intent data
        // We check the intent KV scores for this user
        const intentScores = await kv.getByPrefix(`intent:score:${userId}:`) as any[];
        const highIntentLeadIds: string[] = [];
        const mediumIntentLeadIds: string[] = [];

        if (intentScores && intentScores.length > 0) {
          for (const scoreEntry of intentScores) {
            if (scoreEntry && typeof scoreEntry.total_score === 'number') {
              const leadIdsForEntry: string[] = [];
              if (scoreEntry.lead_ids && Array.isArray(scoreEntry.lead_ids)) {
                leadIdsForEntry.push(...scoreEntry.lead_ids);
              } else if (scoreEntry.company_name) {
                // Look up leads by company name for this user
                const { data: matchingLeads } = await supabase
                  .from('leads')
                  .select('id')
                  .eq('user_id', userId)
                  .ilike('business_name', scoreEntry.company_name)
                  .limit(100);
                if (matchingLeads) {
                  leadIdsForEntry.push(...matchingLeads.map((l: any) => l.id));
                }
              }
              if (scoreEntry.total_score >= 61) {
                highIntentLeadIds.push(...leadIdsForEntry);
              } else if (scoreEntry.total_score >= 30) {
                mediumIntentLeadIds.push(...leadIdsForEntry);
              }
            }
          }
        }

        // Also check leads that have direct intent scores via lead_{id} pattern
        const { data: allLeads } = await supabase
          .from('leads')
          .select('id')
          .eq('user_id', userId)
          .limit(100000);

        if (allLeads && allLeads.length > 0) {
          // Batched intent-score lookup. Was 500 serial KV gets per user; for
          // 10 users that's 5,000 sequential round trips per cron run, which
          // OOMed the function and timed out before campaign-resume could
          // run. Single `mget` chunked into 200-key batches keeps memory and
          // request count bounded.
          const leadsToCheck = allLeads.slice(0, 500);
          const intentKeys = leadsToCheck.map(l => `intent:score:${userId}:lead_${l.id}`);
          const CHUNK = 200;
          const allScores: any[] = [];
          for (let i = 0; i < intentKeys.length; i += CHUNK) {
            try {
              const batch = await kv.mget(intentKeys.slice(i, i + CHUNK));
              allScores.push(...batch);
            } catch (e: any) {
              console.warn(`[CRON-RESCORE] mget batch failed for ${userId}:`, e?.message);
              allScores.push(...new Array(Math.min(CHUNK, intentKeys.length - i)).fill(null));
            }
          }
          // Indexes align — see kv_store.tsx#mget contract.
          for (let i = 0; i < leadsToCheck.length; i++) {
            const directScore = allScores[i];
            if (directScore && typeof directScore.total_score === 'number') {
              const ts = directScore.total_score;
              const leadId = leadsToCheck[i].id;
              if (ts >= 61) {
                if (!highIntentLeadIds.includes(leadId)) highIntentLeadIds.push(leadId);
              } else if (ts >= 30) {
                if (!mediumIntentLeadIds.includes(leadId)) mediumIntentLeadIds.push(leadId);
              }
            }
          }
        }

        // Deduplicate and store the high-intent set
        const uniqueHighIntent = [...new Set(highIntentLeadIds)];
        // Remove any leads from medium that are already high
        const highSet = new Set(uniqueHighIntent);
        const uniqueMediumIntent = [...new Set(mediumIntentLeadIds)].filter(id => !highSet.has(id));
        await kv.set(`high_intent_leads:${userId}`, {
          leadIds: uniqueHighIntent,
          mediumIntentLeadIds: uniqueMediumIntent,
          updatedAt: new Date().toISOString(),
          count: uniqueHighIntent.length,
          mediumCount: uniqueMediumIntent.length,
        });

        result.highIntentLeads += uniqueHighIntent.length;
        console.log(`[CRON-RESCORE] User ${userId}: scored ${scoreResult.scored} leads, ${uniqueHighIntent.length} high-intent`);

      } catch (err: any) {
        console.error(`[CRON-RESCORE] Error rescoring user ${userId}:`, err);
        result.errors.push(`User ${userId}: ${err.message}`);
      }
    }

    // Store last run
    await kv.set(CRON_RESCORE_LAST_RUN_KEY, {
      completedAt: new Date().toISOString(),
      duration: Date.now() - t0,
      usersProcessed: result.usersProcessed,
      leadsScored: result.leadsScored,
      highIntentLeads: result.highIntentLeads,
      errorsCount: result.errors.length,
    });

    console.log(`[CRON-RESCORE] ── Complete in ${Date.now() - t0}ms: ${result.leadsScored} leads scored, ${result.highIntentLeads} high-intent ──`);
  } catch (err: any) {
    console.error('[CRON-RESCORE] Fatal error:', err);
    result.errors.push(`Fatal: ${err.message}`);
  }

  return result;
}

// ─── Click Tracking Data Cleanup ─────────────────────────────────────

/**
 * Clean up old click tracking data from KV store to prevent memory exhaustion.
 * Removes click_track:* entries older than 90 days (configurable).
 * Should be called periodically from cron or manually when memory is tight.
 */
export async function cleanupOldClickTracking(daysToKeep = 90): Promise<{
  deleted: number;
  errors: number;
  duration: number;
}> {
  const t0 = Date.now();
  console.log(`[CLEANUP] Starting click tracking cleanup (keeping last ${daysToKeep} days)`);
  
  const result = {
    deleted: 0,
    errors: 0,
    duration: 0,
  };

  try {
    // Get all click tracking entries
    const allTrackingData = await kv.getByPrefix('click_track:');
    console.log(`[CLEANUP] Found ${allTrackingData.length} click tracking entries`);

    if (!allTrackingData || allTrackingData.length === 0) {
      console.log('[CLEANUP] No click tracking data to clean up');
      result.duration = Date.now() - t0;
      return result;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffTime = cutoffDate.getTime();

    const keysToDelete: string[] = [];

    // Check each entry's age
    for (const data of allTrackingData) {
      try {
        if (data && data.created_at) {
          const createdTime = new Date(data.created_at).getTime();
          if (createdTime < cutoffTime) {
            // Extract the tracking ID from the data (format: click_track:{trackingId})
            // The trackingId contains emailId_timestamp_random
            const parts = data.email_id ? String(data.email_id).split('_') : [];
            if (parts.length >= 2) {
              const trackingId = `${data.email_id}_${parts[1]}_${parts[2] || ''}`;
              keysToDelete.push(`click_track:${trackingId}`);
            }
          }
        }
      } catch (err) {
        result.errors++;
        console.warn('[CLEANUP] Error processing tracking entry:', err);
      }
    }

    // Delete in batches of 100 to avoid overwhelming the DB
    const BATCH_SIZE = 100;
    for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
      const batch = keysToDelete.slice(i, i + BATCH_SIZE);
      try {
        await kv.mdel(batch);
        result.deleted += batch.length;
        console.log(`[CLEANUP] Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} entries`);
      } catch (err) {
        result.errors += batch.length;
        console.error(`[CLEANUP] Error deleting batch:`, err);
      }
      // Small delay between batches to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    result.duration = Date.now() - t0;
    console.log(`[CLEANUP] Complete in ${result.duration}ms: deleted ${result.deleted} entries, ${result.errors} errors`);
  } catch (err: any) {
    console.error('[CLEANUP] Fatal error during cleanup:', err);
    result.errors++;
    result.duration = Date.now() - t0;
  }

  return result;
}

// ─── Deno.cron Registration ──────────────────────────────────────────
// Register Deno.cron jobs if the API is available (Supabase Edge Functions).
// These fire automatically without any external service.

let cronRegistered = false;

export function registerDenoCron() {
  if (cronRegistered) return;
  cronRegistered = true;

  // Check if Deno.cron is available
  if (typeof (Deno as any).cron !== 'function') {
    console.log('[CRON] Deno.cron not available - relying on external cron + opportunistic triggers');
    return;
  }

  try {
    // Full cron cycle every 3 hours
    (Deno as any).cron('contndr-full-cron', '0 */3 * * *', async () => {
      console.log('[CRON] Deno.cron triggered: full cycle');
      try {
        await runFullCronCycle();
      } catch (err) {
        console.error('[CRON] Deno.cron execution error:', err);
      }
    });
    console.log('[CRON] Deno.cron registered: full cycle every 3 hours');
  } catch (err) {
    console.warn('[CRON] Failed to register Deno.cron:', err);
    console.log('[CRON] Falling back to external cron + opportunistic triggers');
  }

  // KV store cleanup every 30 minutes (proactive maintenance)
  try {
    (Deno as any).cron('contndr-kv-cleanup', '*/30 * * * *', async () => {
      console.log('[CRON] Deno.cron triggered: KV cleanup');
      try {
        const { runCleanup } = await import("./kv-cleanup.tsx");
        const stats = await runCleanup();
        console.log(`[CRON] KV cleanup: deleted ${stats.totalDeleted} entries (${stats.duration}ms)`);
      } catch (err) {
        console.error('[CRON] KV cleanup execution error:', err);
      }
    });
    console.log('[CRON] Deno.cron registered: KV cleanup every 30 minutes');
  } catch (err) {
    console.warn('[CRON] Failed to register KV cleanup cron:', err);
  }

  // Social scheduled posts every 5 minutes
  try {
    (Deno as any).cron('contndr-social-scheduled', '*/5 * * * *', async () => {
      console.log('[CRON] Deno.cron triggered: social scheduled posts');
      try {
        const { processScheduledSocialPosts } = await import("./social-syncer.tsx");
        const result = await processScheduledSocialPosts();
        if (result.processed > 0) {
          console.log(`[CRON] Social scheduled: ${result.published} published, ${result.failed} failed out of ${result.processed}`);
        }
      } catch (err) {
        console.error('[CRON] Social scheduled execution error:', err);
      }
    });
    console.log('[CRON] Deno.cron registered: social scheduled posts every 5 minutes');
  } catch (err) {
    console.warn('[CRON] Failed to register social scheduled cron:', err);
  }

  // Social engagement metrics sync — every 15 minutes
  // The worker itself applies tiered frequency per post age (30m / 3h / 24h)
  try {
    (Deno as any).cron('contndr-social-engagement', '*/15 * * * *', async () => {
      console.log('[CRON] Deno.cron triggered: social engagement sync');
      try {
        const { syncAllEngagement } = await import("./social-syncer.tsx");
        const result = await syncAllEngagement();
        if (result.synced > 0 || result.errors > 0) {
          console.log(`[CRON] Social engagement: ${result.synced} synced, ${result.errors} errors`);
        }
      } catch (err) {
        console.error('[CRON] Social engagement sync error:', err);
      }
    });
    console.log('[CRON] Deno.cron registered: social engagement sync every 15 minutes');
  } catch (err) {
    console.warn('[CRON] Failed to register social engagement cron:', err);
  }

  // Lead re-scoring with fresh intent data every 6 hours
  try {
    (Deno as any).cron('contndr-rescore-leads', '0 */6 * * *', async () => {
      console.log('[CRON] Deno.cron triggered: lead re-scoring');
      try {
        await rescoreAllUsersLeads();
      } catch (err) {
        console.error('[CRON] Lead re-scoring execution error:', err);
      }
    });
    console.log('[CRON] Deno.cron registered: lead re-scoring every 6 hours');
  } catch (err) {
    console.warn('[CRON] Failed to register lead re-scoring cron:', err);
  }

  // Click tracking data cleanup every day
  try {
    (Deno as any).cron('contndr-click-tracking-cleanup', '0 0 * * *', async () => {
      console.log('[CRON] Deno.cron triggered: click tracking cleanup');
      try {
        const cleanupResult = await cleanupOldClickTracking();
        console.log(`[CRON] Click tracking cleanup: deleted ${cleanupResult.deleted} entries, ${cleanupResult.errors} errors`);
      } catch (err) {
        console.error('[CRON] Click tracking cleanup execution error:', err);
      }
    });
    console.log('[CRON] Deno.cron registered: click tracking cleanup every day');
  } catch (err) {
    console.warn('[CRON] Failed to register click tracking cleanup cron:', err);
  }
}