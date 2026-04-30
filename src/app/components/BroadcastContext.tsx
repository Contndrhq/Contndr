import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { toast } from 'sonner';
import { realtimeManager } from '../lib/realtime';
import { dispatchAppEvent } from '../lib/app-events';
import type { SendingLogEntry } from './SendingLiveView';
import { acquireSendLock, releaseSendLock } from '../lib/send-lock';

// ── Types ──

interface BroadcastState {
  active: boolean;
  campaignName: string;
  campaignId: string;
  log: SendingLogEntry[];
  currentEntry: SendingLogEntry | null;
  progress: number;
  total: number;
  successCount: number;
  errorCount: number;
  bounceCount: number;
  done: boolean;
  viewMode: 'minimized' | 'default' | 'maximized';
  /** Friendly status shown when waiting for first response */
  statusText: string;
}

interface BroadcastContextValue extends BroadcastState {
  startBroadcast: (opts: {
    campaignId: string;
    campaignName: string;
    total: number;
  }) => void;
  dismiss: () => void;
  toggleMinimize: () => void;
  setMinimized: (v: boolean) => void;
  setViewMode: (mode: 'minimized' | 'default' | 'maximized') => void;
  /** Backward compat */
  minimized: boolean;
}

const initialState: BroadcastState = {
  active: false,
  campaignName: '',
  campaignId: '',
  log: [],
  currentEntry: null,
  progress: 0,
  total: 0,
  successCount: 0,
  errorCount: 0,
  bounceCount: 0,
  done: false,
  viewMode: 'default',
  statusText: 'Preparing messages...',
};

const BroadcastContext = createContext<BroadcastContextValue>({
  ...initialState,
  minimized: false,
  startBroadcast: () => {},
  dismiss: () => {},
  toggleMinimize: () => {},
  setMinimized: () => {},
  setViewMode: () => {},
});

export function useBroadcast() {
  return useContext(BroadcastContext);
}

// ── Helpers ──

/**
 * Fetch the current campaign from the server and return its sent_count and status.
 * Used to reconcile when emails are sent server-side (enqueue/cron) but the
 * broadcast loop didn't observe them visually.
 */
async function fetchCampaignStats(campaignId: string): Promise<{ sentCount: number; status: string; totalLeads: number } | null> {
  try {
    const statusResp = await authenticatedFetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/status`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (statusResp.ok) {
      const data = await statusResp.json();
      return {
        sentCount: data.leadStats?.sent ?? data.emailStats?.sent ?? data.sent_count ?? 0,
        status: data.status || 'draft',
        totalLeads: data.leadStats?.total ?? data.total_leads ?? 0,
      };
    }

    const campaignResp = await authenticatedFetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!campaignResp.ok) return null;
    const data = await campaignResp.json();
    return {
      sentCount: data.sent_count || 0,
      status: data.status || 'draft',
      totalLeads: (data.leads || []).length,
    };
  } catch {
    return null;
  }
}

// ── Provider ──

export function BroadcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BroadcastState>(initialState);
  const abortRef = useRef(false);
  const runningRef = useRef(false);
  // Track current campaignId for the status poller
  const activeCampaignIdRef = useRef<string>('');

  const dismiss = useCallback(() => {
    abortRef.current = true;
    if (state.campaignId) releaseSendLock(state.campaignId);
    runningRef.current = false;
    activeCampaignIdRef.current = '';
    setState(initialState);
  }, [state.campaignId]);

  const toggleMinimize = useCallback(() => {
    setState(prev => ({ ...prev, viewMode: prev.viewMode === 'minimized' ? 'default' : 'minimized' }));
  }, []);

  const setMinimized = useCallback((v: boolean) => {
    setState(prev => ({ ...prev, viewMode: v ? 'minimized' : 'default' }));
  }, []);

  const setViewMode = useCallback((mode: 'minimized' | 'default' | 'maximized') => {
    setState(prev => ({ ...prev, viewMode: mode }));
  }, []);

  // ── Background campaign-status poller ──
  // Syncs actual `sent_count` from the server into the overlay progress so the
  // overlay reflects reality even when HTTP connections time out mid-batch.
  useEffect(() => {
    if (!state.active || state.done) return;

    const intervalId = setInterval(async () => {
      const cId = activeCampaignIdRef.current;
      if (!cId || !runningRef.current) return;

      const stats = await fetchCampaignStats(cId);
      if (!stats) return;

      setState(prev => {
        // Only bump forward — never move progress backward
        const newProgress = Math.max(prev.progress, stats.sentCount);
        const newSuccess = Math.max(prev.successCount, stats.sentCount);
        const newTotal = stats.totalLeads > 0 ? stats.totalLeads : prev.total;
        return {
          ...prev,
          progress: newProgress,
          successCount: newSuccess,
          total: Math.max(prev.total, newTotal),
        };
      });
    }, 5_000);

    return () => clearInterval(intervalId);
  }, [state.active, state.done]);

  const startBroadcast = useCallback(({ campaignId, campaignName, total }: {
    campaignId: string;
    campaignName: string;
    total: number;
  }) => {
    if (runningRef.current) {
      toast.error('A broadcast is already in progress');
      return;
    }

    // Global send-lock: prevent concurrent senders from calling send-batch on
    // the same campaign at the same time → duplicate emails.
    if (!acquireSendLock(campaignId)) {
      console.warn(`[BROADCAST] Campaign ${campaignId} is already being sent by another sender — skipping`);
      toast.error('A broadcast is already in progress');
      return;
    }

    abortRef.current = false;
    runningRef.current = true;
    activeCampaignIdRef.current = campaignId;

    setState({
      active: true,
      campaignName,
      campaignId,
      log: [],
      currentEntry: null,
      progress: 0,
      total,
      successCount: 0,
      errorCount: 0,
      bounceCount: 0,
      done: false,
      viewMode: 'default',
      statusText: 'Preparing messages...',
    });

    // Launch the server-side worker and only observe progress from the UI.
    (async () => {
      try {
        setState(prev => ({ ...prev, statusText: 'Launching background worker...' }));
        const launchResponse = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/launch`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchSize: 5 }),
            signal: AbortSignal.timeout(15_000),
          }
        );

        if (!launchResponse.ok) {
          const error = await launchResponse.json().catch(() => ({ error: 'Unable to launch campaign' }));
          throw new Error(error.error || 'Unable to launch campaign');
        }

        const initialStats = await fetchCampaignStats(campaignId);
        if (initialStats) {
          const initialTotal = initialStats.totalLeads > 0 ? initialStats.totalLeads : total;
          const initialComplete = initialStats.status === 'completed' || (initialTotal > 0 && initialStats.sentCount >= initialTotal);
          setState(prev => ({
            ...prev,
            progress: Math.max(prev.progress, initialStats.sentCount),
            successCount: Math.max(prev.successCount, initialStats.sentCount),
            total: Math.max(prev.total, initialTotal),
            done: initialComplete,
            statusText: initialComplete ? '' : `Sending in background (${initialStats.sentCount}/${Math.max(initialTotal, 1)})...`,
          }));
          if (initialComplete) {
            runningRef.current = false;
            activeCampaignIdRef.current = '';
            releaseSendLock(campaignId);
            realtimeManager.emit('campaign:completed', { campaignName, sent: initialStats.sentCount, bounced: 0, failed: 0 });
            if (initialStats.sentCount > 0) realtimeManager.emit('email:sent', { campaignName, count: initialStats.sentCount });
            dispatchAppEvent({ type: 'campaigns:changed', meta: { action: 'broadcast_complete', sent: initialStats.sentCount } });
            dispatchAppEvent({ type: 'leads:changed', meta: { action: 'emails_sent' } });
            toast.success('Campaign sent', {
              description: `${initialStats.sentCount} email${initialStats.sentCount !== 1 ? 's' : ''} delivered`,
              duration: 5000,
            });
            return;
          }
        } else {
          setState(prev => ({ ...prev, statusText: 'Sending in background...' }));
        }

        let finalSent = 0;
        let finalTotal = total;
        let completed = false;
        const startedAt = Date.now();
        const maxWatchMs = 30 * 60 * 1000;

        while (!abortRef.current && Date.now() - startedAt < maxWatchMs) {
          const stats = await fetchCampaignStats(campaignId);
          if (stats) {
            finalSent = Math.max(finalSent, stats.sentCount);
            finalTotal = Math.max(finalTotal, stats.totalLeads);
            completed = stats.status === 'completed' || (stats.totalLeads > 0 && stats.sentCount >= stats.totalLeads);
            setState(prev => ({
              ...prev,
              progress: Math.max(prev.progress, finalSent),
              successCount: Math.max(prev.successCount, finalSent),
              total: Math.max(prev.total, finalTotal),
              statusText: completed ? 'Finalizing campaign...' : `Sending in background (${finalSent}/${Math.max(finalTotal, 1)})...`,
            }));
            if (completed) break;
          }
          await new Promise(r => setTimeout(r, 3000));
        }

        setState(prev => ({
          ...prev,
          currentEntry: null,
          done: completed,
          successCount: Math.max(prev.successCount, finalSent),
          progress: Math.max(prev.progress, finalSent),
          total: Math.max(prev.total, finalTotal),
          statusText: completed ? '' : 'Continuing in background. You can close this panel.',
        }));
        runningRef.current = false;
        activeCampaignIdRef.current = '';
        releaseSendLock(campaignId);

        apiCache.invalidate('campaigns:*');
        apiCache.invalidate('crm:*');
        apiCache.invalidate('dashboard:*');
        apiCache.invalidate('analytics:*');

        if (completed) realtimeManager.emit('campaign:completed', { campaignName, sent: finalSent, bounced: 0, failed: 0 });
        if (finalSent > 0) realtimeManager.emit('email:sent', { campaignName, count: finalSent });
        dispatchAppEvent({ type: 'campaigns:changed', meta: { action: completed ? 'broadcast_complete' : 'broadcast_background', sent: finalSent } });
        dispatchAppEvent({ type: 'leads:changed', meta: { action: 'emails_sent' } });

        if (!abortRef.current) {
          toast.success(completed ? 'Campaign sent' : 'Campaign is sending', {
            description: completed
              ? `${finalSent} email${finalSent !== 1 ? 's' : ''} delivered`
              : 'Contndr will keep sending in the background.',
            duration: 5000,
          });

          setTimeout(() => {
            setState(prev => ({ ...prev, viewMode: 'minimized' }));
          }, 3000);
        }
      } catch (error: any) {
        console.error('[BROADCAST] Launch failed:', error);
        releaseSendLock(campaignId);
        runningRef.current = false;
        activeCampaignIdRef.current = '';
        setState(prev => ({ ...prev, done: true, statusText: 'Launch failed' }));
        toast.error('Could not launch campaign', { description: error?.message || 'Please try again.' });
      }
    })();
  }, []);

  return (
    <BroadcastContext.Provider value={{
      ...state,
      startBroadcast,
      dismiss,
      toggleMinimize,
      setMinimized,
      setViewMode,
      /** Backward compat */
      minimized: state.viewMode === 'minimized',
    }}>
      {children}
    </BroadcastContext.Provider>
  );
}
