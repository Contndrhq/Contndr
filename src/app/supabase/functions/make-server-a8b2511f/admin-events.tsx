/**
 * ADMIN EVENTS — Real-time event feed for Contndr admins
 *
 * Logs platform events (signups, waitlist joins, subscriptions, approvals)
 * to KV and exposes a polling endpoint for admin users to fetch new events.
 *
 * KV Schema:
 *   admin_event:contndr:{timestamp}:{id}  → AdminEvent record
 *   admin_events_last_id                  → auto-increment counter
 */

import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";

const adminEventsApp = new Hono();
const DEGRADED_RECENT_RESPONSE = {
  events: [],
  degraded: true,
  reason: "storage_unavailable",
  retryAfterSeconds: 30,
};

// Admin UID + email constants (must match index.tsx ADMIN_EMAILS / ADMIN_UIDS)
const ADMIN_EMAILS = ['admin@contndr.com', 'or@roadr.com', 'or@contndr.com'];
const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];
function isAdminUser(email: string | undefined | null, uid?: string | null): boolean {
  if (uid && ADMIN_UIDS.includes(uid)) return true;
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

// ─── Shared Supabase admin client (singleton, reset on connection errors) ─────
let _adminClient: ReturnType<typeof createClient> | null = null;
function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }
  return _adminClient;
}
function resetAdminClient() {
  _adminClient = null;
}

// ─── Retry-aware getUser to handle transient connection resets ────────
async function getUserWithRetry(token: string) {
  let lastErr: any;
  const MAX_ATTEMPTS = 4;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const supabase = getAdminClient();
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error) {
        const msg = error.message || '';
        const isTransient = msg.includes('connection reset') || msg.includes('error sending request')
          || msg.includes('ECONNRESET') || msg.includes('os error 104')
          || msg.includes('broken pipe') || msg.includes('network error')
          || msg.includes('connection unexpectedly') || msg.includes('timeout')
          || msg.includes('schema cache') || msg.includes('PGRST002')
          || msg.includes('Database error') || msg.includes('Unexpected failure')
          || msg.includes('fetch failed') || msg.includes('Failed to fetch')
          || msg.includes('connection error') || msg.includes('tls handshake')
          || msg.includes('client error');
        if (isTransient && attempt < MAX_ATTEMPTS - 1) {
          lastErr = error;
          // Reset client so next attempt gets a fresh connection
          resetAdminClient();
          const jitter = Math.random() * 200;
          const delay = 400 * Math.pow(2, attempt) + jitter;
          console.log(`[ADMIN-EVENTS] getUser transient error (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying in ${Math.round(delay)}ms: ${msg}`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return { user: null, error, transient: isTransient };
      }
      return { user, error: null, transient: false };
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message ?? String(err);
      const isTransient = msg.includes('connection reset') || msg.includes('error sending request')
        || msg.includes('ECONNRESET') || msg.includes('os error 104')
        || msg.includes('broken pipe') || msg.includes('network error')
        || msg.includes('connection unexpectedly') || msg.includes('timeout')
        || msg.includes('connection error') || msg.includes('fetch failed')
        || msg.includes('tls handshake') || msg.includes('client error');
      // Always reset client on thrown errors to avoid reusing a broken socket
      resetAdminClient();
      if (isTransient && attempt < MAX_ATTEMPTS - 1) {
        const jitter = Math.random() * 200;
        const delay = 400 * Math.pow(2, attempt) + jitter;
        console.log(`[ADMIN-EVENTS] getUser threw transient error (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying in ${Math.round(delay)}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Do NOT re-throw — return a structured error so callers can decide the response code
      console.error(`[ADMIN-EVENTS] getUser failed after ${attempt + 1} attempt(s): ${msg}`);
      return { user: null, error: lastErr, transient: isTransient };
    }
  }
  console.error(`[ADMIN-EVENTS] getUser exhausted all ${MAX_ATTEMPTS} retries`);
  return { user: null, error: lastErr, transient: true };
}

// Helper: send the right HTTP status when auth is transiently unavailable
function authErrorResponse(c: any, result: { user: null; error: any; transient: boolean }) {
  if (result.transient) {
    console.warn('[ADMIN-EVENTS] Auth service transiently unavailable — returning 503');
    return c.json({ error: 'Auth service temporarily unavailable, please retry' }, 503);
  }
  return c.json({ error: 'Unauthorized' }, 401);
}

// ─── Types ───────────────────────────────────────────────────────────

export type AdminEventType =
  | 'new_signup'
  | 'waitlist_join'
  | 'waitlist_approved'
  | 'subscription_created'
  | 'subscription_cancelled'
  | 'subscription_downgraded'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'new_lead_imported'
  | 'campaign_launched'
  | 'deal_closed'
  | 'team_member_joined'
  | 'system';

export interface AdminEvent {
  id: string;
  type: AdminEventType;
  title: string;
  message: string;
  email?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

// ─── Event Logger (called from other server modules) ──────────────

export async function logAdminEvent(
  type: AdminEventType,
  title: string,
  message: string,
  extra?: { email?: string; metadata?: Record<string, any> }
) {
  try {
    if (kv.isStorageDegraded()) {
      kv.logStorageDegradedOnce('admin_event_logging');
      return;
    }
    if (type === 'system') {
      const noise = `${title} ${message}`.toLowerCase();
      if (
        noise.includes('gc') ||
        noise.includes('garbage collection') ||
        noise.includes('circuit') ||
        noise.includes('retry') ||
        noise.includes('boot') ||
        noise.includes('schema cache')
      ) {
        return;
      }
    }

    const now = Date.now();
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const event: AdminEvent = {
      id,
      type,
      title,
      message,
      email: extra?.email,
      metadata: extra?.metadata,
      created_at: new Date(now).toISOString(),
    };

    const key = `admin_event:contndr:${id}`;
    try {
      await kv.set(key, event);
    } catch (setErr: any) {
      // If DB memory is full, skip event logging entirely — it's non-critical
      if (setErr?.message?.includes('memory full') || setErr?.message?.includes('shared memory')) {
        kv.logStorageDegradedOnce('admin_event_logging');
        return;
      }
      throw setErr;
    }

    // Maintain a rolling index list (newest first, max 100)
    const indexKey = 'admin_events_index';
    let index: string[] = [];
    try {
      index = ((await kv.get(indexKey)) as string[] | null) || [];
    } catch {}
    index.unshift(id);

    // Prune old entries from KV if index exceeds 100 (reduced from 200)
    const pruned = index.slice(0, 100);
    const removed = index.slice(100);
    try {
      await kv.set(indexKey, pruned);
    } catch {}

    // Clean up old event records in background
    if (removed.length > 0) {
      Promise.all(removed.map(rid => kv.del(`admin_event:contndr:${rid}`).catch(() => {}))).catch(() => {});
    }

    console.log(`[ADMIN-EVENT] ${type}: ${title} — ${message}`);
  } catch (err: any) {
    // Don't log "memory full" errors repeatedly — they're expected when DB is at capacity
    if (err?.message?.includes('memory full') || err?.message?.includes('shared memory')) {
      return;
    }
    console.error('[ADMIN-EVENT] Failed to log event:', err);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────

// GET /admin-events/recent?since=<ISO timestamp>
// Returns events newer than `since`. Admin-only.
adminEventsApp.get("/recent", async (c) => {
  try {
    // Auth check — only @contndr.com admins
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const result = await getUserWithRetry(token);
    if (result.error || !result.user?.email) return authErrorResponse(c, result as any);

    const email = result.user.email.toLowerCase().trim();
    if (!isAdminUser(email, result.user.id)) {
      return c.json({ error: 'Forbidden — admin access required' }, 403);
    }

    const now = Date.now();
    const requestedLimit = parseInt(c.req.query('limit') || '50', 10);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 200));
    const sinceQuery = c.req.query('since');
    let sinceMs = sinceQuery ? new Date(sinceQuery).getTime() : now - 30 * 60_000;
    if (!Number.isFinite(sinceMs)) sinceMs = now - 30 * 60_000;
    sinceMs = Math.max(sinceMs, now - 30 * 60_000);

    // Read from index
    const indexKey = 'admin_events_index';
    let index: string[] = [];
    try {
      index = ((await kv.get(indexKey)) as string[] | null) || [];
    } catch (kvErr: any) {
      kv.logStorageDegradedOnce('admin_events_recent');
      return c.json(DEGRADED_RECENT_RESPONSE, 200);
    }

    // IDs encode timestamp as prefix — filter by timestamp
    const recentIds = index.filter(id => {
      const ts = parseInt(id.split('-')[0], 10);
      return ts > sinceMs;
    });

    if (recentIds.length === 0) {
      return c.json({ events: [], degraded: false });
    }

    // Fetch event records
    const events: AdminEvent[] = [];
    const keys = recentIds.slice(0, limit).map(id => `admin_event:contndr:${id}`);
    const records = await kv.mget(keys).catch(() => null);
    if (!records) {
      kv.logStorageDegradedOnce('admin_events_recent_mget');
      return c.json(DEGRADED_RECENT_RESPONSE, 200);
    }
    for (const rec of records) {
      if (rec) events.push(rec as AdminEvent);
    }

    return c.json({ events, degraded: false });
  } catch (error: any) {
    console.error('[ADMIN-EVENTS] Error fetching recent:', error);
    return c.json(DEGRADED_RECENT_RESPONSE, 200);
  }
});

// GET /admin-events/history?page=0&limit=30&type=<optional filter>
// Returns full paginated event history. Admin-only.
adminEventsApp.get("/history", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const result = await getUserWithRetry(token);
    if (result.error || !result.user?.email) return authErrorResponse(c, result as any);

    const email = result.user.email.toLowerCase().trim();
    if (!isAdminUser(email, result.user.id)) {
      return c.json({ error: 'Forbidden — admin access required' }, 403);
    }

    const page = parseInt(c.req.query('page') || '0', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '30', 10), 50);
    const typeFilter = c.req.query('type') || '';

    const indexKey = 'admin_events_index';
    const index: string[] = await kv.get(indexKey).then((value) => (value as string[] | null) || []).catch(() => []);
    if (kv.isStorageDegraded()) {
      return c.json({
        events: [],
        total: 0,
        page,
        hasMore: false,
        degraded: true,
        reason: 'storage_unavailable',
        retryAfterSeconds: 30,
      });
    }

    const start = page * limit;
    const slice = index.slice(start, start + limit);

    if (slice.length === 0) {
      return c.json({ events: [], total: index.length, page, hasMore: false });
    }

    const keys = slice.map(id => `admin_event:contndr:${id}`);
    const records = await kv.mget(keys);
    let events: AdminEvent[] = [];
    for (const rec of records) {
      if (rec) events.push(rec as AdminEvent);
    }

    // Apply optional type filter
    if (typeFilter) {
      events = events.filter(e => e.type === typeFilter);
    }

    return c.json({
      events,
      total: index.length,
      page,
      hasMore: start + limit < index.length,
    });
  } catch (error: any) {
    console.error('[ADMIN-EVENTS] Error fetching history:', error);
    return c.json({
      events: [],
      total: 0,
      page: 0,
      hasMore: false,
      degraded: true,
      reason: 'storage_unavailable',
      retryAfterSeconds: 30,
    }, 200);
  }
});

// DELETE /admin-events/clear — Purge all events. Admin-only.
adminEventsApp.delete("/clear", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const result = await getUserWithRetry(token);
    if (result.error || !result.user?.email) return authErrorResponse(c, result as any);

    const email = result.user.email.toLowerCase().trim();
    if (!isAdminUser(email, result.user.id)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const indexKey = 'admin_events_index';
    const index: string[] = ((await kv.get(indexKey)) as string[] | null) || [];
    // Delete all event records
    if (index.length > 0) {
      await kv.mdel(index.map(id => `admin_event:contndr:${id}`));
    }
    await kv.set(indexKey, []);

    return c.json({ success: true, cleared: index.length });
  } catch (error: any) {
    console.error('[ADMIN-EVENTS] Error clearing:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default adminEventsApp;
