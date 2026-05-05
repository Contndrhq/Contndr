/**
 * CAMPAIGN MONITOR — Global, view-independent background processor.
 *
 * This hook runs at the App level (not inside CampaignsView), ensuring:
 *  1. Stuck/in-progress campaigns are auto-resumed even when the user
 *     navigates to CRM, Analytics, or any other view.
 *  2. Network disconnects are detected and retries are paused until online.
 *  3. The retry queue is drained automatically.
 *  4. Follow-ups fire on schedule.
 *
 * Enterprise patterns:
 *  - Online/offline awareness via navigator.onLine + 'online'/'offline' events
 *  - Visibility API: pauses polling when tab is hidden (saves battery/resources)
 *  - Exponential backoff on consecutive failures
 *  - Deduplication via a ref-based lock
 */

import { useEffect, useRef, useCallback } from 'react';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from './auth';
import { acquireSendLock, isSendLocked, releaseSendLock } from './send-lock';

const AUTO_RESUME_INTERVAL_MS = 30_000;  // 30s when tab is visible
const HIDDEN_TAB_INTERVAL_MS = 120_000;  // 2min when tab is hidden
const FOLLOWUP_INTERVAL_MS = 300_000;    // 5min
const MAX_BACKOFF_MS = 300_000;          // 5min max backoff

interface MonitorState {
  isRunning: boolean;
  consecutiveErrors: number;
  lastSuccessAt: number;
  isOnline: boolean;
  isVisible: boolean;
}

/**
 * Global campaign monitor hook. Call once in AppContent.
 * Requires user to be authenticated (pass userId).
 */
export function useCampaignMonitor(userId: string | null, isDemoMode: boolean) {
  const stateRef = useRef<MonitorState>({
    isRunning: false,
    consecutiveErrors: 0,
    lastSuccessAt: Date.now(),
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isVisible: typeof document !== 'undefined' ? !document.hidden : true,
  });

  const resumeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const followupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Core: check and resume campaigns ──────────────────────────────
  const checkAndResume = useCallback(async () => {
    if (!userId || isDemoMode) return;
    const state = stateRef.current;
    if (state.isRunning || !state.isOnline) return;

    state.isRunning = true;
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/auto-resume`,
        { method: 'POST', signal: AbortSignal.timeout(25000) }
      );

      if (!response.ok) {
        state.consecutiveErrors++;
        return;
      }

      const data = await response.json();
      state.consecutiveErrors = 0;
      state.lastSuccessAt = Date.now();

      const pending = data.pending || [];
      if (pending.length === 0) return;

      // Ask the edge worker to continue the campaign; keep the app thread out of the send loop.
      const target = pending[0];
      if (!target?.campaignId || isSendLocked(target.campaignId)) {
        console.log('[CAMPAIGN-MONITOR] Pending campaign is already being sent live — skipping background resume');
        return;
      }
      if (!acquireSendLock(target.campaignId)) {
        console.log('[CAMPAIGN-MONITOR] Could not acquire send lock — skipping background resume');
        return;
      }
      try {
        const launchResp = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${target.campaignId}/launch`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchSize: 5 }),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (launchResp.ok) {
          console.log(`[CAMPAIGN-MONITOR] Launched background resume for campaign ${target.campaignId}`);
        }
      } catch (launchErr) {
        console.warn('[CAMPAIGN-MONITOR] Campaign launch error:', launchErr);
        state.consecutiveErrors++;
      } finally {
        releaseSendLock(target.campaignId);
      }
    } catch (err) {
      // "Not authenticated" is expected during initial load / logout — skip silently
      if (err instanceof Error && err.message === 'Not authenticated') return;
      // AbortError / TimeoutError = server was slow — silently backoff, don't log as error
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message.includes('aborted') || err.message.includes('Fetch is aborted') || err.message.includes('signal is aborted'))) {
        state.consecutiveErrors++;
        return;
      }
      console.warn('[CAMPAIGN-MONITOR] Check error:', err);
      state.consecutiveErrors++;
    } finally {
      state.isRunning = false;
    }
  }, [userId, isDemoMode]);

  // ─── Follow-up processing (runs less frequently) ──────────────────
  const processFollowUps = useCallback(async () => {
    if (!userId || isDemoMode) return;
    const state = stateRef.current;
    if (!state.isOnline) return;

    try {
      await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/followups/auto-process`,
        { method: 'POST', signal: AbortSignal.timeout(30000) }
      );
    } catch (err) {
      // "Not authenticated" is expected during initial load / logout — skip silently
      if (err instanceof Error && err.message === 'Not authenticated') return;
      // AbortError / TimeoutError — silently swallow, these are expected under load
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message.includes('aborted') || err.message.includes('Fetch is aborted'))) return;
      console.warn('[CAMPAIGN-MONITOR] Follow-up processing error:', err);
    }
  }, [userId, isDemoMode]);

  // ─── Adaptive interval: adjust based on tab visibility & errors ────
  const getInterval = useCallback(() => {
    const state = stateRef.current;
    const baseInterval = state.isVisible ? AUTO_RESUME_INTERVAL_MS : HIDDEN_TAB_INTERVAL_MS;

    if (state.consecutiveErrors > 0) {
      // Exponential backoff: double the interval for each consecutive error
      const backoff = Math.min(baseInterval * Math.pow(2, state.consecutiveErrors), MAX_BACKOFF_MS);
      return backoff;
    }

    return baseInterval;
  }, []);

  // ─── Start/stop the polling loop ──────────────────────────────────
  const startPolling = useCallback(() => {
    if (resumeTimerRef.current) clearInterval(resumeTimerRef.current);

    const interval = getInterval();
    resumeTimerRef.current = setInterval(() => {
      checkAndResume();
    }, interval);
  }, [checkAndResume, getInterval]);

  // ─── Lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || isDemoMode) return;

    // Initial check after 3s (let the UI settle)
    const initialTimer = setTimeout(checkAndResume, 3000);

    // Start polling
    startPolling();

    // Follow-ups: initial run after 8s, then every 5min
    const followupInitial = setTimeout(processFollowUps, 8000);
    followupTimerRef.current = setInterval(processFollowUps, FOLLOWUP_INTERVAL_MS) as any;

    // ── Online/offline handling ──
    const handleOnline = () => {
      console.log('[CAMPAIGN-MONITOR] Network came back online');
      stateRef.current.isOnline = true;
      stateRef.current.consecutiveErrors = 0;
      // Immediately check on reconnect
      setTimeout(checkAndResume, 1000);
      startPolling();
    };

    const handleOffline = () => {
      console.log('[CAMPAIGN-MONITOR] Network went offline — pausing');
      stateRef.current.isOnline = false;
    };

    // ── Visibility API ──
    const handleVisibilityChange = () => {
      stateRef.current.isVisible = !document.hidden;
      // Restart polling with adjusted interval
      startPolling();
      // If tab became visible, immediately check
      if (!document.hidden) {
        setTimeout(checkAndResume, 500);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(initialTimer);
      clearTimeout(followupInitial);
      if (resumeTimerRef.current) clearInterval(resumeTimerRef.current);
      if (followupTimerRef.current) clearInterval(followupTimerRef.current as any);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId, isDemoMode, checkAndResume, processFollowUps, startPolling]);
}
