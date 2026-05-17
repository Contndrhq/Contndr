/**
 * Contndr Real-Time Event Bus
 * 
 * Uses Supabase Realtime Broadcast channels for instant cross-tab and
 * cross-user synchronisation. No database setup required — it's a pure
 * WebSocket pub/sub layer that piggybacks on the existing Supabase client.
 *
 * Architecture:
 *   Action happens -> emitRealtimeEvent() -> Supabase Broadcast channel
 *     -> All connected clients receive -> cache invalidation + UI refresh
 */

import { supabase } from './supabase';
import { apiCache } from './api-cache';
import { notificationService } from './notifications';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ── Event Types ──────────────────────────────────────────────────────

export type RealtimeEventType =
  | 'lead:created'
  | 'lead:updated'
  | 'lead:deleted'
  | 'lead:bulk_action'
  | 'email:sent'
  | 'email:opened'
  | 'email:clicked'
  | 'email:replied'
  | 'email:bounced'
  | 'campaign:created'
  | 'campaign:updated'
  | 'campaign:started'
  | 'campaign:completed'
  | 'campaign:paused'
  | 'pipeline:deal_created'
  | 'pipeline:deal_updated'
  | 'pipeline:deal_moved'
  | 'pipeline:deal_deleted'
  | 'inbox:new_message'
  | 'inbox:reply_sent'
  | 'team:member_joined'
  | 'team:member_left'
  | 'settings:updated'
  | 'automation:triggered'
  | 'automation:completed'
  | 'group:updated'
  | 'import:completed'
  | 'deal:won'
  | 'payment:failed'
  | 'call:completed';

export interface RealtimeEvent {
  type: RealtimeEventType;
  /** User ID that triggered the event */
  userId: string;
  /** Unique event ID for deduplication */
  eventId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Event-specific payload */
  payload?: Record<string, any>;
}

// ── Cache invalidation map: event type -> apiCache keys to bust ──────

const CACHE_INVALIDATION_MAP: Record<string, string[]> = {
  'lead:created':       ['crm:*', 'dashboard:*'],
  'lead:updated':       ['crm:*', 'dashboard:*'],
  'lead:deleted':       ['crm:*', 'dashboard:*'],
  'lead:bulk_action':   ['crm:*', 'dashboard:*'],
  'email:sent':         ['campaigns:*', 'analytics:*', 'dashboard:*', 'inbox:*'],
  'email:opened':       ['campaigns:*', 'analytics:*', 'dashboard:*'],
  'email:clicked':      ['campaigns:*', 'analytics:*', 'dashboard:*'],
  'email:replied':      ['campaigns:*', 'analytics:*', 'dashboard:*', 'inbox:*'],
  'email:bounced':      ['campaigns:*', 'analytics:*', 'dashboard:*', 'crm:bounced-count'],
  'campaign:created':   ['campaigns:*', 'dashboard:*'],
  'campaign:updated':   ['campaigns:*', 'dashboard:*'],
  'campaign:started':   ['campaigns:*', 'dashboard:*'],
  'campaign:completed': ['campaigns:*', 'dashboard:*', 'analytics:*'],
  'campaign:paused':    ['campaigns:*'],
  'pipeline:deal_created': ['pipeline:*', 'dashboard:*'],
  'pipeline:deal_updated': ['pipeline:*', 'dashboard:*'],
  'pipeline:deal_moved':   ['pipeline:*', 'dashboard:*'],
  'pipeline:deal_deleted': ['pipeline:*', 'dashboard:*'],
  'inbox:new_message':  ['inbox:*'],
  'inbox:reply_sent':   ['inbox:*', 'campaigns:*'],
  'team:member_joined': ['settings:team', 'team:*'],
  'team:member_left':   ['settings:team', 'team:*'],
  'settings:updated':   ['settings:*'],
  'automation:triggered':  ['automations:*', 'campaigns:*'],
  'automation:completed':  ['automations:*', 'campaigns:*', 'analytics:*'],
  'group:updated':      ['crm:*', 'groups:*'],
  'import:completed':   ['crm:*', 'dashboard:*'],
  'deal:won':           ['pipeline:*', 'dashboard:*', 'analytics:*', 'revenue:*'],
  'payment:failed':     ['billing:*', 'settings:*', 'dashboard:*'],
  'call:completed':     ['ai-calls:*', 'dashboard:*', 'crm:*'],
};

// ── Notification-worthy events ───────────────────────────────────────

const NOTIFY_EVENTS: Partial<Record<RealtimeEventType, (e: RealtimeEvent, selfUserId: string) => void>> = {
  // Lead-action events (email replied/clicked/opened) — these are
  // triggered BY the lead, so `userId` on the event is the campaign
  // owner. We WANT to notify that owner (i.e. don't skip on
  // userId === selfUserId), because they're the one who needs to know.
  // The previous self-skip meant the user never got their own reply
  // notifications, which is the single most important alert in the app.
  'email:replied': (e) => {
    notificationService.notify(
      'email_replied',
      '💬 New Reply!',
      `${e.payload?.leadName || 'A lead'} replied to "${e.payload?.campaignName || 'a campaign'}"`,
      e.payload
    );
  },
  'email:clicked': (e) => {
    notificationService.notify(
      'email_clicked',
      '🖱️ Link Clicked',
      `${e.payload?.leadName || 'A lead'} clicked a link in "${e.payload?.campaignName || 'your email'}"`,
      e.payload
    );
  },
  'email:opened': (e) => {
    notificationService.notify(
      'email_opened',
      '👀 Email Opened',
      `${e.payload?.leadName || 'A lead'} opened "${e.payload?.campaignName || 'your email'}"`,
      e.payload
    );
  },
  'campaign:completed': (e, _selfUserId) => {
    notificationService.notify(
      'campaign_completed',
      'Campaign Complete',
      `"${e.payload?.campaignName || 'Campaign'}" finished sending`,
      e.payload
    );
  },
  'lead:created': (e, selfUserId) => {
    if (e.userId === selfUserId) return;
    const count = e.payload?.count || 1;
    if (count > 1) {
      notificationService.notify('new_lead', 'New Leads', `${count} leads were added by a team member`, e.payload);
    }
  },
  'import:completed': (e, selfUserId) => {
    if (e.userId === selfUserId) return;
    notificationService.notify('new_lead', 'Import Complete', `${e.payload?.count || 'New'} leads imported by a team member`, e.payload);
  },
  'team:member_joined': (e, _selfUserId) => {
    notificationService.notify('system', 'Team Update', `${e.payload?.name || 'Someone'} joined the team`, e.payload);
  },
  'pipeline:deal_moved': (e, selfUserId) => {
    if (e.userId === selfUserId) return;
    notificationService.notify('system', 'Deal Moved', `"${e.payload?.dealName || 'A deal'}" moved to ${e.payload?.stageName || 'a new stage'}`, e.payload);
  },
  // High-value events the user explicitly asked to surface as real
  // notifications (system tray + native push when wired):
  'deal:won': (e) => {
    const amt = e.payload?.amount;
    const amountText =
      typeof amt === 'number' ? `$${amt.toLocaleString()}` : amt ? String(amt) : '';
    notificationService.notify(
      'deal_won',
      '💰 Deal Won!',
      `${e.payload?.customerName || 'A customer'}${amountText ? ` — ${amountText}` : ''}`,
      e.payload,
    );
  },
  'payment:failed': (e) => {
    const amt = e.payload?.amount;
    const attempt = e.payload?.attempt || 1;
    const amountText =
      typeof amt === 'number' ? `$${amt.toFixed(2)}` : amt ? String(amt) : '';
    notificationService.notify(
      'payment_failed',
      '⚠️ Payment Failed',
      `${amountText ? `${amountText} ` : ''}payment failed (attempt ${attempt}). Update your card to avoid losing access.`,
      e.payload,
    );
  },
  'call:completed': (e) => {
    notificationService.notify(
      'ai_call_completed',
      '📞 AI Call Completed',
      `${e.payload?.leadName || 'Lead'} — ${e.payload?.outcome || 'call ended'}`,
      e.payload,
    );
  },
};

// ── Singleton manager ────────────────────────────────────────────────

type EventListener = (event: RealtimeEvent) => void;

class RealtimeManager {
  private channel: RealtimeChannel | null = null;
  private userId: string | null = null;
  private teamId: string | null = null;
  private listeners = new Map<string, Set<EventListener>>();
  private wildcardListeners = new Set<EventListener>();
  private recentEventIds = new Set<string>();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _statusListeners = new Set<(connected: boolean) => void>();

  /** Connect to realtime channel for this user/team */
  connect(userId: string, teamId?: string) {
    if (this.connected && this.userId === userId) return;
    this.disconnect();

    this.userId = userId;
    this.teamId = teamId || userId; // fallback to user-scoped channel

    const channelName = `contndr:${this.teamId}`;
    console.log(`[REALTIME] Connecting to channel: ${channelName}`);

    this.channel = supabase.channel(channelName, {
      config: { broadcast: { self: true } },
    });

    this.channel
      .on('broadcast', { event: 'sync' }, ({ payload }) => {
        this.handleEvent(payload as RealtimeEvent);
      })
      .subscribe((status) => {
        console.log(`[REALTIME] Channel status: ${status}`);
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          this._statusListeners.forEach(fn => fn(true));
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          this.connected = false;
          this._statusListeners.forEach(fn => fn(false));
          this.scheduleReconnect();
        }
      });
  }

  /** Disconnect and clean up */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.connected = false;
    this.userId = null;
    this._statusListeners.forEach(fn => fn(false));
  }

  /** Emit an event to all connected clients */
  emit(type: RealtimeEventType, payload?: Record<string, any>) {
    if (!this.channel || !this.userId) {
      console.warn('[REALTIME] Cannot emit — not connected');
      return;
    }

    const event: RealtimeEvent = {
      type,
      userId: this.userId,
      eventId: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.channel.send({
      type: 'broadcast',
      event: 'sync',
      payload: event,
    });
  }

  /** Subscribe to a specific event type (or '*' for all) */
  on(type: string, listener: EventListener): () => void {
    if (type === '*') {
      this.wildcardListeners.add(listener);
      return () => { this.wildcardListeners.delete(listener); };
    }
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => { this.listeners.get(type)?.delete(listener); };
  }

  /** Subscribe to connection status changes */
  onStatus(listener: (connected: boolean) => void): () => void {
    this._statusListeners.add(listener);
    // Immediately fire current status
    listener(this.connected);
    return () => { this._statusListeners.delete(listener); };
  }

  get isConnected() { return this.connected; }

  // ── Internal ───────────────────────────────────────────────────────

  private handleEvent(event: RealtimeEvent) {
    if (!event?.type || !event?.eventId) return;

    // Deduplicate (WebSocket can deliver duplicates)
    if (this.recentEventIds.has(event.eventId)) return;
    this.recentEventIds.add(event.eventId);
    // Prune old IDs to prevent memory growth
    if (this.recentEventIds.size > 500) {
      const arr = Array.from(this.recentEventIds);
      this.recentEventIds = new Set(arr.slice(-250));
    }

    console.log(`[REALTIME] Event: ${event.type}`, event.payload);

    // 1. Invalidate caches
    const keysToInvalidate = CACHE_INVALIDATION_MAP[event.type] || [];
    for (const key of keysToInvalidate) {
      apiCache.invalidate(key);
    }

    // 2. Fire notifications for relevant events (only for other users' actions)
    const notifier = NOTIFY_EVENTS[event.type];
    if (notifier && this.userId) {
      try { notifier(event, this.userId); } catch (e) { /* silent */ }
    }

    // 3. Notify typed listeners
    const typed = this.listeners.get(event.type);
    if (typed) {
      typed.forEach(fn => { try { fn(event); } catch (e) { console.error('[REALTIME] Listener error:', e); } });
    }

    // 4. Notify wildcard listeners
    this.wildcardListeners.forEach(fn => { try { fn(event); } catch (e) { console.error('[REALTIME] Listener error:', e); } });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log('[REALTIME] Scheduling reconnect in 5s...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userId && !this.connected) {
        const uid = this.userId;
        const tid = this.teamId;
        this.channel = null; // reset
        this.connect(uid, tid || undefined);
      }
    }, 5000);
  }
}

// Singleton
export const realtimeManager = new RealtimeManager();

// Expose for debugging
if (typeof window !== 'undefined') {
  (window as any).__realtime = realtimeManager;
}
