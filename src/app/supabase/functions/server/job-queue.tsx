/**
 * JOB QUEUE — Enterprise-grade persistent retry queue for transient failures.
 *
 * When an email send fails due to a transient error (network timeout, rate limit,
 * connection reset), the job is NOT marked as permanently failed. Instead, it's
 * placed in a retry queue with exponential backoff metadata.
 *
 * KV Schema:
 *   retry_queue:{userId}:{campaignId}  → RetryJob[]
 *   retry_dlq:{userId}:{campaignId}    → DeadLetterJob[] (max retries exceeded)
 *   retry_stats:{userId}               → { totalRetried, totalDLQ, lastProcessed }
 *
 * Usage:
 *   import { enqueueRetry, processRetryQueue, getRetryStats } from "./job-queue.tsx";
 */

import * as kv from "./kv-retry.tsx";

// ─── Configuration ───────────────────────────────────────────────────

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 30_000;    // 30s initial backoff
const MAX_DELAY_MS = 600_000;    // 10min max backoff
const DLQ_TTL_DAYS = 7;         // Keep dead letters for 7 days

// ─── Types ───────────────────────────────────────────────────────────

export interface RetryJob {
  id: string;
  leadId: string;
  leadEmail: string;
  campaignId: string;
  userId: string;
  /** The kind of failure that caused the retry */
  failureReason: string;
  /** Category: 'network' | 'rate_limit' | 'timeout' | 'server_error' | 'transient' */
  failureCategory: string;
  /** Number of retry attempts so far */
  attempts: number;
  /** When this job should next be retried (ISO timestamp) */
  nextRetryAt: string;
  /** When the job was first created */
  createdAt: string;
  /** When the job was last attempted */
  lastAttemptAt: string;
}

export interface DeadLetterJob extends RetryJob {
  /** When the job was moved to DLQ */
  deadLetteredAt: string;
}

export interface RetryStats {
  totalRetried: number;
  totalDLQ: number;
  lastProcessed: string | null;
  queueDepth: number;
}

// ─── KV Keys ─────────────────────────────────────────────────────────

function retryQueueKey(userId: string, campaignId: string) {
  return `retry_queue:${userId}:${campaignId}`;
}

function dlqKey(userId: string, campaignId: string) {
  return `retry_dlq:${userId}:${campaignId}`;
}

function retryStatsKey(userId: string) {
  return `retry_stats:${userId}`;
}

// ─── Transient Error Detection ───────────────────────────────────────

/**
 * Determines if a send failure is transient (worth retrying) vs permanent.
 * Returns { isTransient, category } or null if permanent.
 */
export function classifyFailure(error: string): { isTransient: boolean; category: string } {
  const e = (error || '').toLowerCase();

  // Permanent failures — do NOT retry
  if (
    e.includes('bounced') ||
    e.includes('rejected') ||
    e.includes('undeliverable') ||
    e.includes('does not exist') ||
    e.includes('user unknown') ||
    e.includes('mailbox full') ||
    e.includes('domain not verified') ||
    e.includes('not a valid') ||
    e.includes('domain is not verified') ||
    e.includes('suppressed') ||
    e.includes('validation failed') ||
    e.includes('blacklisted') ||
    e.includes('unsubscribed') ||
    e.includes('invalid') ||
    e.includes('recipient.*rejected')
  ) {
    return { isTransient: false, category: 'permanent' };
  }

  // Rate limits — retry with longer backoff
  if (
    e.includes('rate limit') ||
    e.includes('too many') ||
    e.includes('429') ||
    e.includes('daily send limit') ||
    e.includes('send rate too fast')
  ) {
    return { isTransient: true, category: 'rate_limit' };
  }

  // Network / connection errors — retry
  if (
    e.includes('network') ||
    e.includes('fetch failed') ||
    e.includes('failed to fetch') ||
    e.includes('load failed') ||
    e.includes('connection reset') ||
    e.includes('econnreset') ||
    e.includes('connection terminated') ||
    e.includes('broken pipe') ||
    e.includes('tls handshake') ||
    e.includes('error sending request') ||
    e.includes('os error')
  ) {
    return { isTransient: true, category: 'network' };
  }

  // Timeouts — retry
  if (
    e.includes('timeout') ||
    e.includes('timed out') ||
    e.includes('deadline exceeded')
  ) {
    return { isTransient: true, category: 'timeout' };
  }

  // Database memory/circuit breaker errors — NOT retryable (need manual intervention)
  if (
    e.includes('memory full') ||
    e.includes('shared memory') ||
    e.includes('circuit breaker')
  ) {
    return { isTransient: false, category: 'database_capacity' };
  }

  // Server errors — retry
  if (
    e.includes('500') ||
    e.includes('502') ||
    e.includes('503') ||
    e.includes('504') ||
    e.includes('internal server error') ||
    e.includes('server error') ||
    e.includes('schema cache')
  ) {
    return { isTransient: true, category: 'server_error' };
  }

  // AI generation failures — retry (model may have been overloaded)
  if (
    e.includes('ai generation failed') ||
    e.includes('model') ||
    e.includes('overloaded')
  ) {
    return { isTransient: true, category: 'transient' };
  }

  // Unknown errors — default to transient (retry once, then DLQ)
  return { isTransient: true, category: 'transient' };
}

// ─── Queue Operations ────────────────────────────────────────────────

/**
 * Add a failed send to the retry queue with exponential backoff.
 */
export async function enqueueRetry(
  userId: string,
  campaignId: string,
  leadId: string,
  leadEmail: string,
  failureReason: string,
  failureCategory: string,
  existingAttempts = 0,
): Promise<{ queued: boolean; deadLettered: boolean }> {
  const attempts = existingAttempts + 1;

  // Max retries exceeded → move to DLQ
  if (attempts > MAX_RETRIES) {
    await addToDeadLetterQueue(userId, campaignId, {
      id: crypto.randomUUID(),
      leadId,
      leadEmail,
      campaignId,
      userId,
      failureReason,
      failureCategory,
      attempts,
      nextRetryAt: '',
      createdAt: existingAttempts === 0 ? new Date().toISOString() : '',
      lastAttemptAt: new Date().toISOString(),
      deadLetteredAt: new Date().toISOString(),
    });
    console.log(`[JOB-QUEUE] Lead ${leadId} moved to DLQ after ${attempts} attempts: ${failureReason}`);
    return { queued: false, deadLettered: true };
  }

  // Calculate backoff: base * 2^attempts with jitter, capped by rate_limit getting longer
  const multiplier = failureCategory === 'rate_limit' ? 3 : 1;
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempts - 1) * multiplier, MAX_DELAY_MS);
  const jitter = delay * (0.7 + Math.random() * 0.6);
  const nextRetryAt = new Date(Date.now() + jitter).toISOString();

  const job: RetryJob = {
    id: crypto.randomUUID(),
    leadId,
    leadEmail,
    campaignId,
    userId,
    failureReason,
    failureCategory,
    attempts,
    nextRetryAt,
    createdAt: existingAttempts === 0 ? new Date().toISOString() : new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
  };

  try {
    const queue: RetryJob[] = (await kv.get(retryQueueKey(userId, campaignId))) || [];

    // Deduplicate: remove any existing entry for this lead
    const filtered = queue.filter(j => j.leadId !== leadId);
    filtered.push(job);

    await kv.set(retryQueueKey(userId, campaignId), filtered);
    console.log(`[JOB-QUEUE] Queued retry for lead ${leadId} (attempt ${attempts}/${MAX_RETRIES}, next at ${nextRetryAt}, category: ${failureCategory})`);
    return { queued: true, deadLettered: false };
  } catch (err) {
    console.error(`[JOB-QUEUE] Failed to enqueue retry for lead ${leadId}:`, err);
    return { queued: false, deadLettered: false };
  }
}

/**
 * Get all jobs in the retry queue that are due for processing.
 */
export async function getDueRetries(userId: string, campaignId: string, limit = 10): Promise<RetryJob[]> {
  try {
    const queue: RetryJob[] = (await kv.get(retryQueueKey(userId, campaignId))) || [];
    const now = new Date().toISOString();

    return queue
      .filter(j => j.nextRetryAt <= now)
      .sort((a, b) => a.nextRetryAt.localeCompare(b.nextRetryAt))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[JOB-QUEUE] Error reading retry queue:`, err);
    return [];
  }
}

/**
 * Remove a job from the retry queue (after successful retry or permanent failure).
 */
export async function removeFromQueue(userId: string, campaignId: string, leadId: string): Promise<void> {
  try {
    const queue: RetryJob[] = (await kv.get(retryQueueKey(userId, campaignId))) || [];
    const filtered = queue.filter(j => j.leadId !== leadId);
    await kv.set(retryQueueKey(userId, campaignId), filtered);
  } catch (err) {
    console.warn(`[JOB-QUEUE] Error removing job from queue:`, err);
  }
}

/**
 * Get the full retry queue for a campaign (for status display).
 */
export async function getRetryQueue(userId: string, campaignId: string): Promise<RetryJob[]> {
  try {
    return (await kv.get(retryQueueKey(userId, campaignId))) || [];
  } catch {
    return [];
  }
}

/**
 * Get retry statistics for a user.
 */
export async function getRetryStats(userId: string): Promise<RetryStats> {
  try {
    const stats = (await kv.get(retryStatsKey(userId))) || { totalRetried: 0, totalDLQ: 0, lastProcessed: null, queueDepth: 0 };
    return stats;
  } catch {
    return { totalRetried: 0, totalDLQ: 0, lastProcessed: null, queueDepth: 0 };
  }
}

/**
 * Update retry stats after processing.
 */
export async function updateRetryStats(userId: string, retriedCount: number, dlqCount: number): Promise<void> {
  try {
    const stats = await getRetryStats(userId);
    stats.totalRetried += retriedCount;
    stats.totalDLQ += dlqCount;
    stats.lastProcessed = new Date().toISOString();
    await kv.set(retryStatsKey(userId), stats);
  } catch {
    // Non-fatal
  }
}

/**
 * Get all campaigns that have retry jobs for a user.
 */
export async function getCampaignsWithRetries(userId: string): Promise<string[]> {
  try {
    const entries = await kv.getByPrefix(`retry_queue:${userId}:`);
    const campaignIds: string[] = [];
    for (const entry of (entries || [])) {
      const queue = entry?.value;
      if (Array.isArray(queue) && queue.length > 0) {
        const key = entry.key as string;
        const campaignId = key.replace(`retry_queue:${userId}:`, '');
        if (campaignId) campaignIds.push(campaignId);
      }
    }
    return campaignIds;
  } catch {
    return [];
  }
}

// ─── Dead Letter Queue ───────────────────────────────────────────────

async function addToDeadLetterQueue(userId: string, campaignId: string, job: DeadLetterJob): Promise<void> {
  try {
    const dlq: DeadLetterJob[] = (await kv.get(dlqKey(userId, campaignId))) || [];

    // Cap DLQ size at 500 entries, evict oldest
    if (dlq.length >= 500) {
      dlq.splice(0, dlq.length - 499);
    }

    dlq.push(job);
    await kv.set(dlqKey(userId, campaignId), dlq);

    // Update stats
    await updateRetryStats(userId, 0, 1);
  } catch (err) {
    console.error(`[JOB-QUEUE] Failed to add to DLQ:`, err);
  }
}

/**
 * Get dead letter queue for a campaign.
 */
export async function getDeadLetterQueue(userId: string, campaignId: string): Promise<DeadLetterJob[]> {
  try {
    return (await kv.get(dlqKey(userId, campaignId))) || [];
  } catch {
    return [];
  }
}

/**
 * Retry all dead-lettered jobs for a campaign (manual re-queue).
 */
export async function retryDeadLetters(userId: string, campaignId: string): Promise<{ requeued: number }> {
  try {
    const dlq: DeadLetterJob[] = (await kv.get(dlqKey(userId, campaignId))) || [];
    if (dlq.length === 0) return { requeued: 0 };

    let requeued = 0;
    for (const job of dlq) {
      await enqueueRetry(userId, campaignId, job.leadId, job.leadEmail, 'Manual retry from DLQ', 'transient', 0);
      requeued++;
    }

    // Clear DLQ
    await kv.set(dlqKey(userId, campaignId), []);
    console.log(`[JOB-QUEUE] Re-queued ${requeued} dead-lettered jobs for campaign ${campaignId}`);
    return { requeued };
  } catch (err) {
    console.error(`[JOB-QUEUE] Error retrying dead letters:`, err);
    return { requeued: 0 };
  }
}

/**
 * Clean up stale retry queues (jobs older than DLQ_TTL_DAYS).
 */
export async function cleanupStaleJobs(userId: string, campaignId: string): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - DLQ_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const queue: RetryJob[] = (await kv.get(retryQueueKey(userId, campaignId))) || [];
    const before = queue.length;
    const fresh = queue.filter(j => j.createdAt > cutoff);
    if (fresh.length < before) {
      await kv.set(retryQueueKey(userId, campaignId), fresh);
    }
    return before - fresh.length;
  } catch {
    return 0;
  }
}
