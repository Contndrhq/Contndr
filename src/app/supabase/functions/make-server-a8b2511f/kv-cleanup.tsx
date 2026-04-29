/**
 * KV Cleanup Utility — Automatic cleanup of old data to reduce memory pressure
 * 
 * Runs periodically to:
 * 1. Remove old email tracking data (clicks/opens older than 90 days)
 * 2. Clean up expired retry queue jobs
 * 3. Prune old intent signals (older than 180 days)
 * 4. Remove stale session data
 * 
 * This prevents the KV store from filling up and triggering the circuit breaker.
 */

import * as kv from './kv_store.tsx'; // Use raw KV to bypass circuit breaker during cleanup

const TRACKING_RETENTION_DAYS = 90;
const INTENT_RETENTION_DAYS = 180;
const RETRY_RETENTION_DAYS = 7;
const SESSION_RETENTION_DAYS = 30;

interface CleanupStats {
  totalScanned: number;
  totalDeleted: number;
  categories: {
    tracking: number;
    intent: number;
    retry: number;
    sessions: number;
  };
  duration: number;
  errors: number;
}

/**
 * Run a full cleanup cycle
 */
export async function runCleanup(): Promise<CleanupStats> {
  const startTime = Date.now();
  const stats: CleanupStats = {
    totalScanned: 0,
    totalDeleted: 0,
    categories: { tracking: 0, intent: 0, retry: 0, sessions: 0 },
    duration: 0,
    errors: 0,
  };

  console.log('[KV-CLEANUP] Starting cleanup cycle...');

  try {
    // 1. Clean old click tracking
    await cleanupClickTracking(stats);

    // 2. Clean old intent signals
    await cleanupIntentSignals(stats);

    // 3. Clean stale retry queues
    await cleanupRetryQueues(stats);

    // 4. Clean old sessions
    await cleanupSessions(stats);
    
    // 5. Clean old live events (campaign real-time updates)
    await cleanupLiveEvents(stats);

  } catch (err: any) {
    console.error('[KV-CLEANUP] Fatal error during cleanup:', err.message);
    stats.errors++;
  }

  stats.duration = Date.now() - startTime;
  console.log(`[KV-CLEANUP] Cleanup complete: scanned ${stats.totalScanned}, deleted ${stats.totalDeleted} in ${stats.duration}ms`);
  console.log(`[KV-CLEANUP] Details:`, stats.categories);

  return stats;
}

/**
 * Clean up old click tracking data
 */
async function cleanupClickTracking(stats: CleanupStats) {
  try {
    const cutoffDate = new Date(Date.now() - TRACKING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    // Get all click tracking keys
    const entries = await kv.getByPrefix('click_track:');
    stats.totalScanned += entries.length;

    const keysToDelete: string[] = [];
    
    for (const entry of entries) {
      try {
        const data = entry.value;
        if (data?.created_at) {
          const createdAt = new Date(data.created_at);
          if (createdAt < cutoffDate) {
            keysToDelete.push(entry.key as string);
          }
        } else {
          // No timestamp - assume old and delete
          keysToDelete.push(entry.key as string);
        }
      } catch {
        // Corrupted entry - delete it
        keysToDelete.push(entry.key as string);
      }
    }

    if (keysToDelete.length > 0) {
      // Delete in batches to avoid timeout
      const batchSize = 50;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        try {
          await kv.mdel(batch);
          stats.categories.tracking += batch.length;
          stats.totalDeleted += batch.length;
        } catch (err: any) {
          console.warn(`[KV-CLEANUP] Error deleting tracking batch: ${err.message}`);
          stats.errors++;
        }
      }
    }

    console.log(`[KV-CLEANUP] Cleaned ${keysToDelete.length} old click tracking entries`);
  } catch (err: any) {
    console.error(`[KV-CLEANUP] Error cleaning click tracking: ${err.message}`);
    stats.errors++;
  }
}

/**
 * Clean up old intent signals
 */
async function cleanupIntentSignals(stats: CleanupStats) {
  try {
    const cutoffDate = new Date(Date.now() - INTENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    const entries = await kv.getByPrefix('intent:signal:');
    stats.totalScanned += entries.length;

    const keysToDelete: string[] = [];
    
    for (const entry of entries) {
      try {
        const data = entry.value;
        if (data?.created_at) {
          const createdAt = new Date(data.created_at);
          if (createdAt < cutoffDate) {
            keysToDelete.push(entry.key as string);
          }
        }
      } catch {
        keysToDelete.push(entry.key as string);
      }
    }

    if (keysToDelete.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        try {
          await kv.mdel(batch);
          stats.categories.intent += batch.length;
          stats.totalDeleted += batch.length;
        } catch (err: any) {
          console.warn(`[KV-CLEANUP] Error deleting intent batch: ${err.message}`);
          stats.errors++;
        }
      }
    }

    console.log(`[KV-CLEANUP] Cleaned ${keysToDelete.length} old intent signals`);
  } catch (err: any) {
    console.error(`[KV-CLEANUP] Error cleaning intent signals: ${err.message}`);
    stats.errors++;
  }
}

/**
 * Clean up stale retry queues
 */
async function cleanupRetryQueues(stats: CleanupStats) {
  try {
    const cutoffDate = new Date(Date.now() - RETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    const entries = await kv.getByPrefix('retry_queue:');
    stats.totalScanned += entries.length;

    for (const entry of entries) {
      try {
        const queue = entry.value as any[];
        if (!Array.isArray(queue)) continue;

        const original = queue.length;
        const fresh = queue.filter((job: any) => {
          if (job?.createdAt) {
            return new Date(job.createdAt) > cutoffDate;
          }
          return false;
        });

        if (fresh.length < original) {
          const key = entry.key as string;
          if (fresh.length === 0) {
            await kv.del(key);
          } else {
            await kv.set(key, fresh);
          }
          const deleted = original - fresh.length;
          stats.categories.retry += deleted;
          stats.totalDeleted += deleted;
        }
      } catch (err: any) {
        console.warn(`[KV-CLEANUP] Error cleaning retry queue: ${err.message}`);
        stats.errors++;
      }
    }
  } catch (err: any) {
    console.error(`[KV-CLEANUP] Error cleaning retry queues: ${err.message}`);
    stats.errors++;
  }
}

/**
 * Clean up old session data
 */
async function cleanupSessions(stats: CleanupStats) {
  try {
    const cutoffDate = new Date(Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    // Clean oauth states
    const stateEntries = await kv.getByPrefix('oauth_state:');
    stats.totalScanned += stateEntries.length;

    const keysToDelete: string[] = [];
    
    for (const entry of stateEntries) {
      try {
        const data = entry.value;
        if (data?.created_at) {
          const createdAt = new Date(data.created_at);
          if (createdAt < cutoffDate) {
            keysToDelete.push(entry.key as string);
          }
        } else {
          // No timestamp - delete old oauth states
          keysToDelete.push(entry.key as string);
        }
      } catch {
        keysToDelete.push(entry.key as string);
      }
    }

    if (keysToDelete.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        try {
          await kv.mdel(batch);
          stats.categories.sessions += batch.length;
          stats.totalDeleted += batch.length;
        } catch (err: any) {
          console.warn(`[KV-CLEANUP] Error deleting session batch: ${err.message}`);
          stats.errors++;
        }
      }
    }

    console.log(`[KV-CLEANUP] Cleaned ${keysToDelete.length} old sessions`);
  } catch (err: any) {
    console.error(`[KV-CLEANUP] Error cleaning sessions: ${err.message}`);
    stats.errors++;
  }
}

/**
 * Clean up old live events (campaign real-time updates)
 * These accumulate quickly and should only be kept for 24 hours
 */
async function cleanupLiveEvents(stats: CleanupStats) {
  try {
    // Live events older than 24 hours are no longer needed
    const cutoffTimestamp = Date.now() - (24 * 60 * 60 * 1000);
    
    const liveEntries = await kv.getByPrefix('live_event:');
    stats.totalScanned += liveEntries.length;

    const keysToDelete: string[] = [];
    
    for (const entry of liveEntries) {
      try {
        const key = entry.key as string;
        // Extract timestamp from key format: live_event:{campaignId}:{timestamp}:{eventType}
        const parts = key.split(':');
        if (parts.length >= 3) {
          const timestamp = parseInt(parts[2]);
          if (!isNaN(timestamp) && timestamp < cutoffTimestamp) {
            keysToDelete.push(key);
          }
        } else {
          // Malformed key - delete it
          keysToDelete.push(key);
        }
      } catch {
        // Corrupted entry - delete it
        keysToDelete.push(entry.key as string);
      }
    }

    if (keysToDelete.length > 0) {
      const batchSize = 100; // Can be larger for simple live events
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        try {
          await kv.mdel(batch);
          stats.categories.tracking += batch.length; // Count under tracking category
          stats.totalDeleted += batch.length;
        } catch (err: any) {
          console.warn(`[KV-CLEANUP] Error deleting live event batch: ${err.message}`);
          stats.errors++;
        }
      }
    }

    console.log(`[KV-CLEANUP] Cleaned ${keysToDelete.length} old live events`);
  } catch (err: any) {
    console.error(`[KV-CLEANUP] Error cleaning live events: ${err.message}`);
    stats.errors++;
  }
}

/**
 * Get estimated KV store size (approximation based on entry count)
 */
export async function getKVStats(): Promise<{
  totalEntries: number;
  byPrefix: Record<string, number>;
}> {
  const prefixes = [
    'click_track:',
    'intent:',
    'retry_queue:',
    'retry_dlq:',
    'oauth_state:',
    'email_provider:',
    'unsubscribed:',
    'blacklist:',
    'campaign:',
    'lead:',
    'live_event:',
    'tracking_ua:',
  ];

  const stats: Record<string, number> = {};
  let total = 0;

  for (const prefix of prefixes) {
    try {
      const entries = await kv.getByPrefix(prefix);
      const count = entries.length;
      stats[prefix] = count;
      total += count;
    } catch {
      stats[prefix] = 0;
    }
  }

  return {
    totalEntries: total,
    byPrefix: stats,
  };
}
