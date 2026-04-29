/**
 * RealtimeProvider — wraps the app and manages the WebSocket lifecycle.
 * Connects when the user is authenticated, disconnects on sign-out,
 * and provides hooks for components to react to real-time events.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { realtimeManager, type RealtimeEvent, type RealtimeEventType } from '../lib/realtime';

// ── Context ──────────────────────────────────────────────────────────

interface RealtimeContextValue {
  /** Whether the WebSocket is currently connected */
  connected: boolean;
  /** Emit a real-time event to all connected clients */
  emit: (type: RealtimeEventType, payload?: Record<string, any>) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  emit: () => {},
});

export function useRealtimeContext() {
  return useContext(RealtimeContext);
}

// ── Hook: useRealtimeEvent ──────────────────────────────────────────
// Subscribe to specific event types and trigger a callback or refetch.

export function useRealtimeEvent(
  eventType: RealtimeEventType | RealtimeEventType[] | '*',
  callback: (event: RealtimeEvent) => void,
  deps: any[] = []
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const types = Array.isArray(eventType) ? eventType : [eventType];
    const unsubs: (() => void)[] = [];

    for (const t of types) {
      unsubs.push(realtimeManager.on(t, (event) => {
        callbackRef.current(event);
      }));
    }

    return () => { unsubs.forEach(fn => fn()); };
  }, [
    // Stable key from the event types
    Array.isArray(eventType) ? eventType.join(',') : eventType,
    ...deps,
  ]);
}

// ── Hook: useRealtimeRefresh ────────────────────────────────────────
// Auto-increment a counter when matching events arrive.
// Components use `refreshKey` as a dependency to re-fetch data.

export function useRealtimeRefresh(
  eventTypes: RealtimeEventType | RealtimeEventType[]
): number {
  const [refreshKey, setRefreshKey] = useState(0);

  useRealtimeEvent(
    eventTypes,
    () => setRefreshKey(k => k + 1),
    []
  );

  return refreshKey;
}

// ── Provider ─────────────────────────────────────────────────────────

interface RealtimeProviderProps {
  children: ReactNode;
  userId: string | null;
  teamId?: string | null;
}

export function RealtimeProvider({ children, userId, teamId }: RealtimeProviderProps) {
  const [connected, setConnected] = useState(false);

  // Connect/disconnect based on auth state
  useEffect(() => {
    if (!userId) {
      realtimeManager.disconnect();
      setConnected(false);
      return;
    }

    realtimeManager.connect(userId, teamId || undefined);

    const unsub = realtimeManager.onStatus((status) => {
      setConnected(status);
    });

    return () => {
      unsub();
      // Don't disconnect on cleanup — we want to stay connected across re-renders
      // Disconnect only happens when userId becomes null (sign-out)
    };
  }, [userId, teamId]);

  // Handle page visibility — reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && userId && !realtimeManager.isConnected) {
        console.log('[REALTIME] Tab visible — reconnecting...');
        realtimeManager.connect(userId, teamId || undefined);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [userId, teamId]);

  // Handle online/offline
  useEffect(() => {
    const handleOnline = () => {
      if (userId && !realtimeManager.isConnected) {
        console.log('[REALTIME] Online — reconnecting...');
        realtimeManager.connect(userId, teamId || undefined);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [userId, teamId]);

  const emit = useCallback((type: RealtimeEventType, payload?: Record<string, any>) => {
    realtimeManager.emit(type, payload);
  }, []);

  return (
    <RealtimeContext.Provider value={{ connected, emit }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export default RealtimeProvider;
