/**
 * Server-side Supabase Realtime broadcast helper.
 *
 * Posts to the Realtime HTTP API so backend code can push events to
 * specific user/admin channels — used for things the user's browser
 * can't poll for (e.g. admin approves their waitlist entry, so their
 * pending screen should auto-flip to dashboard without a refresh).
 *
 * Channel naming convention:
 *   contndr:<userId>   — the per-user channel each authenticated client
 *                        is already subscribed to via src/app/lib/realtime.ts
 *   contndr:admin      — shared admin channel that AdminDashboard
 *                        listens on while open
 *
 * Event shape mirrors the client's broadcast format:
 *   { type: 'broadcast', event: 'sync', payload: { type, userId, eventId, timestamp, payload } }
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export type BackendRealtimeEventType =
  | 'subscription:updated'
  | 'waitlist:status_changed'
  | 'admin:waitlist_changed'
  | 'admin:user_changed'
  // Async events the user wants surfaced as browser/native notifications.
  // These match the frontend RealtimeEventType in src/app/lib/realtime.ts
  // so the existing NOTIFY_EVENTS map fires browser notifications when
  // the user's tab is open and notification permission is granted.
  | 'email:replied'
  | 'email:interested'
  | 'deal:won'
  | 'payment:failed'
  | 'call:completed'
  | 'meeting:booked';

interface BroadcastInput {
  channel: string;          // e.g. "contndr:<userId>"
  type: BackendRealtimeEventType;
  payload?: Record<string, any>;
}

/**
 * Send a single broadcast event. Best-effort — never throws so callers
 * can fire-and-forget without breaking the primary mutation path.
 */
export async function broadcastRealtime({ channel, type, payload }: BroadcastInput): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn('[REALTIME-BROADCAST] Skipped — SUPABASE_URL / SERVICE_ROLE_KEY missing');
    return;
  }
  try {
    const url = `${SUPABASE_URL}/realtime/v1/api/broadcast`;
    const event = {
      type,
      userId: payload?.userId || null,
      eventId: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      payload: payload || {},
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          { topic: channel, event: 'sync', payload: event, private: false },
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`[REALTIME-BROADCAST] non-200: ${res.status} ${txt.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.warn('[REALTIME-BROADCAST] error:', e?.message);
  }
}

/**
 * Notify a specific user that their subscription/waitlist state
 * changed, and ALSO notify the admin channel so any admin dashboard
 * open elsewhere refreshes its lists.
 */
export async function notifyUserStatusChange(opts: {
  userId: string;
  email?: string;
  newStatus: 'approved' | 'rejected' | 'pending' | 'paused' | 'active';
  source?: string;
}): Promise<void> {
  await Promise.all([
    broadcastRealtime({
      channel: `contndr:${opts.userId}`,
      type: 'subscription:updated',
      payload: { userId: opts.userId, email: opts.email, status: opts.newStatus, source: opts.source },
    }),
    broadcastRealtime({
      channel: 'contndr:admin',
      type: 'admin:waitlist_changed',
      payload: { userId: opts.userId, email: opts.email, status: opts.newStatus, source: opts.source },
    }),
  ]);
}
