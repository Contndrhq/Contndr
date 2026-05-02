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

async function fetchCampaignEmailLog(campaignId: string, campaignName: string): Promise<SendingLogEntry[]> {
  try {
    const response = await authenticatedFetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/recent?campaign_id=${encodeURIComponent(campaignId)}&limit=100`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!response.ok) return [];
    const data = await response.json();
    const rows = Array.isArray(data.emails) ? data.emails : [];

    return rows
      .slice()
      .reverse()
      .map((email: any, index: number): SendingLogEntry => {
        const status = String(email.status || '').toLowerCase();
        const isFailed = status === 'failed' || status === 'error';
        const isBounced = status === 'bounced';
        return {
          id: email.id || `${campaignId}-${index}`,
          recipientName: email.lead_name || email.to_email || `Message ${index + 1}`,
          recipientEmail: email.to_email || '',
          subject: email.subject || campaignName,
          body: email.text_body || email.body || '',
          fromEmail: email.from_email || '',
          status: isBounced ? 'bounced' : isFailed ? 'failed' : 'delivered',
          timestamp: new Date(email.sent_at || email.created_at || Date.now()).getTime(),
        };
      });
  } catch {
    return [];
  }
}

// ── Provider ──

export function BroadcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BroadcastState>(initialState);
  const abortRef = useRef(false);
  const runningRef = useRef(false);
  // Track current campaignId for the status poller
  const activeCampaignIdRef = useRef<string>('');
  const replayedEmailIdsRef = useRef<Set<string>>(new Set());
  const replayQueueRef = useRef<SendingLogEntry[]>([]);
  const replayingRef = useRef(false);

  const resetLiveReplay = useCallback(() => {
    replayedEmailIdsRef.current = new Set();
    replayQueueRef.current = [];
    replayingRef.current = false;
  }, []);

  const waitForReplayIdle = useCallback(async () => {
    while (!abortRef.current && (replayingRef.current || replayQueueRef.current.length > 0)) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }, []);

  const processReplayQueue = useCallback(async () => {
    if (replayingRef.current) return;
    replayingRef.current = true;

    try {
      while (!abortRef.current && replayQueueRef.current.length > 0) {
        const entry = replayQueueRef.current.shift();
        if (!entry) continue;

        const finalEntry: SendingLogEntry = {
          ...entry,
          status: entry.status === 'failed' || entry.status === 'bounced' ? entry.status : 'delivered',
          timestamp: Date.now(),
        };

        if (finalEntry.status === 'delivered' && (finalEntry.subject || finalEntry.body)) {
          const writingEntry = { ...finalEntry, status: 'writing' as const };
          setState(prev => ({
            ...prev,
            currentEntry: writingEntry,
            statusText: `Writing to ${finalEntry.recipientName || finalEntry.recipientEmail}...`,
          }));

          const bodyLen = (finalEntry.body || '').length;
          const typingWait = Math.min(Math.max(bodyLen * 4, 1800), 5200);
          await new Promise(resolve => setTimeout(resolve, typingWait));
          if (abortRef.current) break;

          setState(prev => ({
            ...prev,
            currentEntry: { ...writingEntry, status: 'sending' },
            statusText: 'Delivering message...',
          }));
          await new Promise(resolve => setTimeout(resolve, 650));
          if (abortRef.current) break;

          setState(prev => ({
            ...prev,
            currentEntry: { ...writingEntry, status: 'delivered' },
            statusText: 'Message delivered',
          }));
          await new Promise(resolve => setTimeout(resolve, 900));
          if (abortRef.current) break;
        }

        setState(prev => {
          if (prev.log.some(item => item.id === finalEntry.id)) {
            return { ...prev, currentEntry: null };
          }

          const nextLog = [...prev.log, finalEntry];
          const delivered = nextLog.filter(item => item.status === 'delivered').length;
          const bounced = nextLog.filter(item => item.status === 'bounced').length;
          const failed = nextLog.filter(item => item.status === 'failed').length;
          const observed = delivered + bounced + failed;

          return {
            ...prev,
            log: nextLog,
            currentEntry: null,
            progress: Math.max(prev.progress, observed),
            successCount: Math.max(prev.successCount, delivered),
            bounceCount: Math.max(prev.bounceCount, bounced),
            errorCount: Math.max(prev.errorCount, failed),
            statusText: 'Watching the live broadcast...',
          };
        });
      }
    } finally {
      replayingRef.current = false;
    }
  }, []);

  const queueLiveReplay = useCallback((emailLog: SendingLogEntry[]) => {
    const fresh = emailLog
      .filter(entry => entry?.id && !replayedEmailIdsRef.current.has(entry.id))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (fresh.length === 0) return;

    for (const entry of fresh) {
      replayedEmailIdsRef.current.add(entry.id);
      replayQueueRef.current.push(entry);
    }

    setState(prev => ({
      ...prev,
      statusText: prev.currentEntry ? prev.statusText : 'Preparing live broadcast...',
    }));
    void processReplayQueue();
  }, [processReplayQueue]);

  const dismiss = useCallback(() => {
    abortRef.current = true;
    if (state.campaignId) releaseSendLock(state.campaignId);
    runningRef.current = false;
    activeCampaignIdRef.current = '';
    resetLiveReplay();
    setState(initialState);
  }, [resetLiveReplay, state.campaignId]);

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

      const [stats, emailLog] = await Promise.all([
        fetchCampaignStats(cId),
        fetchCampaignEmailLog(cId, state.campaignName),
      ]);
      if (!stats) return;
      queueLiveReplay(emailLog);

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
  }, [queueLiveReplay, state.active, state.campaignName, state.done]);

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
    resetLiveReplay();

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

        const [initialStats, initialEmailLog] = await Promise.all([
          fetchCampaignStats(campaignId),
          fetchCampaignEmailLog(campaignId, campaignName),
        ]);
        if (initialStats) {
          queueLiveReplay(initialEmailLog);
          const initialTotal = initialStats.totalLeads > 0 ? initialStats.totalLeads : total;
          const initialComplete = initialStats.status === 'completed' || (initialTotal > 0 && initialStats.sentCount >= initialTotal);
          setState(prev => ({
            ...prev,
            progress: Math.max(prev.progress, initialStats.sentCount),
            successCount: Math.max(prev.successCount, initialStats.sentCount),
            total: Math.max(prev.total, initialTotal),
            statusText: initialComplete ? 'Finalizing live broadcast...' : `Broadcasting live (${initialStats.sentCount}/${Math.max(initialTotal, 1)})...`,
          }));
          if (initialComplete) {
            await waitForReplayIdle();
            setState(prev => ({
              ...prev,
              currentEntry: null,
              done: true,
              statusText: '',
            }));
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
          setState(prev => ({ ...prev, statusText: 'Broadcasting live...' }));
        }

        let finalSent = 0;
        let finalTotal = total;
        let completed = false;
        const startedAt = Date.now();
        const maxWatchMs = 30 * 60 * 1000;

        while (!abortRef.current && Date.now() - startedAt < maxWatchMs) {
          const [stats, emailLog] = await Promise.all([
            fetchCampaignStats(campaignId),
            fetchCampaignEmailLog(campaignId, campaignName),
          ]);
          if (stats) {
            queueLiveReplay(emailLog);
            finalSent = Math.max(finalSent, stats.sentCount);
            finalTotal = Math.max(finalTotal, stats.totalLeads);
            completed = stats.status === 'completed' || (stats.totalLeads > 0 && stats.sentCount >= stats.totalLeads);
            setState(prev => ({
              ...prev,
              progress: Math.max(prev.progress, finalSent),
              successCount: Math.max(prev.successCount, finalSent),
              total: Math.max(prev.total, finalTotal),
              statusText: completed ? 'Finalizing live broadcast...' : `Broadcasting live (${finalSent}/${Math.max(finalTotal, 1)})...`,
            }));
            if (completed) break;
          }
          await new Promise(r => setTimeout(r, 3000));
        }

        const finalEmailLog = await fetchCampaignEmailLog(campaignId, campaignName);
        queueLiveReplay(finalEmailLog);
        await waitForReplayIdle();
        setState(prev => ({
          ...prev,
          currentEntry: null,
          done: completed,
          successCount: Math.max(prev.successCount, finalSent),
          progress: Math.max(prev.progress, finalSent),
          total: Math.max(prev.total, finalTotal),
          statusText: completed ? '' : 'Continuing safely in the background. You can close this panel.',
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
              : 'Contndr will keep sending safely in the background.',
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
  }, [queueLiveReplay, resetLiveReplay, waitForReplayIdle]);

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
