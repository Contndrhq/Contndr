/**
 * App-wide instant event bus for optimistic UI updates.
 *
 * Uses DOM CustomEvents for zero-latency same-tab communication.
 * Components dispatch events after mutations and listen to refresh
 * their local state immediately — no server round-trip needed for
 * the UI to react.
 *
 * This complements the Supabase Realtime broadcast channel (which
 * handles cross-tab / cross-user sync) by giving instant feedback
 * within the current tab.
 */

// ── Event types ──────────────────────────────────────────────────────

export type AppEventType =
  | 'leads:changed'
  | 'leads:deleted'
  | 'leads:created'
  | 'leads:updated'
  | 'campaigns:changed'
  | 'campaigns:deleted'
  | 'pipeline:changed'
  | 'settings:changed'
  | 'inbox:changed'
  | 'groups:changed'
  | 'connection:changed';

export interface AppEventDetail {
  type: AppEventType;
  /** IDs of affected items (leads, campaigns, deals, etc.) */
  ids?: string[];
  /** Number of items affected */
  count?: number;
  /** Extra context */
  meta?: Record<string, any>;
}

const EVENT_NAME = 'contndr:app-event';

// ── Dispatch ─────────────────────────────────────────────────────────

export function dispatchAppEvent(detail: AppEventDetail) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

// ── Listen ───────────────────────────────────────────────────────────

type Listener = (detail: AppEventDetail) => void;

export function onAppEvent(types: AppEventType | AppEventType[], listener: Listener): () => void {
  const typeSet = new Set(Array.isArray(types) ? types : [types]);

  const handler = (e: Event) => {
    const detail = (e as CustomEvent<AppEventDetail>).detail;
    if (typeSet.has(detail.type)) {
      listener(detail);
    }
  };

  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

// ── React hook ───────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

/**
 * Hook that returns a refresh counter that increments whenever
 * a matching app event fires. Use as a useEffect dependency to
 * trigger re-fetches instantly.
 */
export function useAppEventRefresh(types: AppEventType | AppEventType[]): number {
  const [key, setKey] = useState(0);

  useEffect(() => {
    return onAppEvent(types, () => setKey(k => k + 1));
  }, [Array.isArray(types) ? types.join(',') : types]);

  return key;
}

/**
 * Hook that calls a callback whenever a matching app event fires.
 * The callback ref is kept stable across renders.
 */
export function useAppEvent(
  types: AppEventType | AppEventType[],
  callback: (detail: AppEventDetail) => void
) {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    return onAppEvent(types, (d) => ref.current(d));
  }, [Array.isArray(types) ? types.join(',') : types]);
}
