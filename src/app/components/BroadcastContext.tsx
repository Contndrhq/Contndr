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

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function typingDelayFor(body: string) {
  return Math.min(Math.max((body || '').length * 4, 1800), 5200);
}

function emailInfoToEntry(campaignId: string, index: number, emailInfo: any): SendingLogEntry {
  return {
    id: emailInfo.emailId || emailInfo.email_id || emailInfo.id || `broadcast-${campaignId}-${index}`,
    recipientName: emailInfo.leadName || emailInfo.lead_name || emailInfo.recipientName || emailInfo.leadEmail || 'Unknown',
    recipientEmail: emailInfo.leadEmail || emailInfo.to_email || emailInfo.recipientEmail || '',
    subject: emailInfo.subject || '(no subject)',
    body: emailInfo.body || emailInfo.text_body || '',
    fromEmail: emailInfo.fromEmail || emailInfo.from_email || '',
    status: 'writing',
    timestamp: Date.now(),
  };
}

async function launchBackgroundFallback(campaignId: string) {
  await authenticatedFetch(
    `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/launch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchSize: 5 }),
      signal: AbortSignal.timeout(15_000),
    }
  );
}

// ── Provider ──

export function BroadcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BroadcastState>(initialState);
  const abortRef = useRef(false);
  const runningRef = useRef(false);
  // Track current campaignId for the status poller
  const activeCampaignIdRef = useRef<string>('');
  const foregroundLiveRef = useRef(false);
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
    foregroundLiveRef.current = false;
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
      if (!foregroundLiveRef.current) {
        queueLiveReplay(emailLog);
      }

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
    foregroundLiveRef.current = true;
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

    // Send one at a time from the foreground so the overlay can show the real
    // generated subject/body while each message is being written and delivered.
    // The background worker is kept as a fallback only, otherwise it races the
    // live UI and the user only sees the final "campaign sent" state.
    (async () => {
      let totalSent = 0;
      let totalFailed = 0;
      let totalBounced = 0;
      let emailIndex = 0;
      let hasMore = true;
      let consecutiveErrors = 0;
      let continuedInBackground = false;
      let finalTotal = total;
      const maxConsecutiveErrors = 5;

      try {
        setState(prev => ({ ...prev, statusText: 'Preparing live broadcast...' }));

        try {
          await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/enqueue/${campaignId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batchSize: 1 }),
              signal: AbortSignal.timeout(10_000),
            }
          );
        } catch (enqueueError) {
          console.warn('[BROADCAST] Enqueue failed; continuing live send:', enqueueError);
        }

        while (!abortRef.current && hasMore) {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/send-batch?limit=1`,
            { method: 'POST', signal: AbortSignal.timeout(60_000) }
          );

          if (!response.ok) {
            if (response.status === 409) {
              setState(prev => ({ ...prev, statusText: 'Another sender is finishing a message...' }));
              await wait(3000);
              continue;
            }

            const error = await response.json().catch(() => ({ error: 'Unable to send next message' }));
            console.error('[BROADCAST] Live batch failed:', error);
            consecutiveErrors++;
            if (consecutiveErrors >= maxConsecutiveErrors) {
              continuedInBackground = true;
              setState(prev => ({
                ...prev,
                currentEntry: null,
                statusText: 'Live view paused. Continuing safely in the background...',
              }));
              await launchBackgroundFallback(campaignId).catch((fallbackError) => {
                console.warn('[BROADCAST] Background fallback launch failed:', fallbackError);
              });
              break;
            }
            setState(prev => ({ ...prev, statusText: 'Retrying the next message...' }));
            await wait(2000 * consecutiveErrors);
            continue;
          }

          consecutiveErrors = 0;
          const data = await response.json();
          const batchSent = Number(data.sent || 0);
          const remaining = Number(data.remaining || 0);
          const emailsSent: any[] = Array.isArray(data.emails_sent) ? data.emails_sent : [];

          finalTotal = Math.max(finalTotal, totalSent + totalFailed + totalBounced + remaining + emailsSent.length);

          for (const emailInfo of emailsSent) {
            emailIndex++;
            const entry = emailInfoToEntry(campaignId, emailIndex, emailInfo);
            replayedEmailIdsRef.current.add(entry.id);

            if (emailInfo.success) {
              const writingEntry: SendingLogEntry = { ...entry, status: 'writing', timestamp: Date.now() };
              setState(prev => ({
                ...prev,
                currentEntry: writingEntry,
                total: Math.max(prev.total, finalTotal),
                statusText: `Writing to ${writingEntry.recipientName || writingEntry.recipientEmail}...`,
              }));

              await wait(typingDelayFor(writingEntry.body));
              if (abortRef.current) break;

              setState(prev => ({
                ...prev,
                currentEntry: { ...writingEntry, status: 'sending' },
                statusText: 'Delivering message...',
              }));

              await wait(650);
              if (abortRef.current) break;

              const deliveredEntry: SendingLogEntry = {
                ...writingEntry,
                status: 'delivered',
                timestamp: Date.now(),
              };

              totalSent++;
              setState(prev => ({
                ...prev,
                currentEntry: deliveredEntry,
                progress: Math.max(prev.progress, totalSent + totalFailed + totalBounced),
                successCount: totalSent,
                statusText: 'Message delivered',
              }));

              await wait(850);
              if (abortRef.current) break;

              setState(prev => ({
                ...prev,
                currentEntry: null,
                log: prev.log.some(item => item.id === deliveredEntry.id) ? prev.log : [...prev.log, deliveredEntry],
                progress: Math.max(prev.progress, totalSent + totalFailed + totalBounced),
                successCount: totalSent,
                statusText: remaining > 0 ? `Preparing next message (${totalSent}/${Math.max(finalTotal, 1)})...` : 'Finalizing broadcast...',
              }));
            } else {
              const isBounced = Boolean(emailInfo.bounced) || String(emailInfo.error || '').toLowerCase().includes('bounce');
              const failedEntry: SendingLogEntry = {
                ...entry,
                status: isBounced ? 'bounced' : 'failed',
                timestamp: Date.now(),
              };

              if (isBounced) totalBounced++;
              else totalFailed++;

              setState(prev => ({
                ...prev,
                currentEntry: null,
                log: prev.log.some(item => item.id === failedEntry.id) ? prev.log : [...prev.log, failedEntry],
                progress: Math.max(prev.progress, totalSent + totalFailed + totalBounced),
                errorCount: totalFailed,
                bounceCount: totalBounced,
                total: Math.max(prev.total, finalTotal),
                statusText: 'Skipping a failed message...',
              }));
            }
          }

          if (abortRef.current) break;

          if (data.campaign_complete || (emailsSent.length === 0 && batchSent === 0 && remaining <= 0)) {
            hasMore = false;
          } else if (batchSent === 0 && remaining > 0) {
            consecutiveErrors++;
            if (consecutiveErrors >= maxConsecutiveErrors) {
              continuedInBackground = true;
              setState(prev => ({
                ...prev,
                currentEntry: null,
                statusText: 'No live messages returned. Continuing safely in the background...',
              }));
              await launchBackgroundFallback(campaignId).catch((fallbackError) => {
                console.warn('[BROADCAST] Background fallback launch failed:', fallbackError);
              });
              break;
            }
            await wait(2000);
          } else {
            await wait(350);
          }
        }

        foregroundLiveRef.current = false;

        const finalStats = await fetchCampaignStats(campaignId);
        if (continuedInBackground) {
          const finalEmailLog = await fetchCampaignEmailLog(campaignId, campaignName);
          queueLiveReplay(finalEmailLog);
          await waitForReplayIdle();
        }

        const reconciledSent = Math.max(totalSent, finalStats?.sentCount || 0);
        const reconciledTotal = Math.max(finalTotal, finalStats?.totalLeads || 0, total);
        const completed = !continuedInBackground && (
          finalStats?.status === 'completed' ||
          (reconciledTotal > 0 && reconciledSent + totalFailed + totalBounced >= reconciledTotal)
        );

        setState(prev => ({
          ...prev,
          currentEntry: null,
          done: completed || !continuedInBackground,
          progress: Math.max(prev.progress, reconciledSent + totalFailed + totalBounced),
          successCount: Math.max(prev.successCount, reconciledSent),
          errorCount: Math.max(prev.errorCount, totalFailed),
          bounceCount: Math.max(prev.bounceCount, totalBounced),
          total: Math.max(prev.total, reconciledTotal),
          statusText: continuedInBackground ? 'Continuing safely in the background. You can close this panel.' : '',
        }));

        runningRef.current = false;
        activeCampaignIdRef.current = '';
        releaseSendLock(campaignId);

        apiCache.invalidate('campaigns:*');
        apiCache.invalidate('crm:*');
        apiCache.invalidate('dashboard:*');
        apiCache.invalidate('analytics:*');

        if (!continuedInBackground) {
          realtimeManager.emit('campaign:completed', { campaignName, sent: reconciledSent, bounced: totalBounced, failed: totalFailed });
        }
        if (reconciledSent > 0) {
          realtimeManager.emit('email:sent', { campaignName, count: reconciledSent });
        }
        dispatchAppEvent({ type: 'campaigns:changed', meta: { action: continuedInBackground ? 'broadcast_background' : 'broadcast_complete', sent: reconciledSent } });
        dispatchAppEvent({ type: 'leads:changed', meta: { action: 'emails_sent' } });

        if (!abortRef.current) {
          toast.success(continuedInBackground ? 'Campaign is sending' : 'Campaign sent', {
            description: continuedInBackground
              ? 'Contndr will keep sending safely in the background.'
              : `${reconciledSent} email${reconciledSent !== 1 ? 's' : ''} delivered`,
            duration: 5000,
          });

          setTimeout(() => {
            setState(prev => ({ ...prev, viewMode: 'minimized' }));
          }, 3000);
        }
      } catch (error: any) {
        console.error('[BROADCAST] Live send failed:', error);
        try {
          foregroundLiveRef.current = false;
          await launchBackgroundFallback(campaignId);
          setState(prev => ({
            ...prev,
            currentEntry: null,
            done: true,
            statusText: 'Continuing safely in the background. You can close this panel.',
          }));
          toast.success('Campaign is sending', {
            description: 'Live view paused, but background sending is active.',
            duration: 6000,
          });
        } catch (fallbackError: any) {
          console.error('[BROADCAST] Background fallback failed:', fallbackError);
          setState(prev => ({ ...prev, currentEntry: null, done: true, statusText: 'Launch failed' }));
          toast.error('Could not launch campaign', { description: error?.message || 'Please try again.' });
        }
        releaseSendLock(campaignId);
        runningRef.current = false;
        activeCampaignIdRef.current = '';
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
