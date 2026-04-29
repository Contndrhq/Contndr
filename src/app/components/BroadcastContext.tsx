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
    const resp = await authenticatedFetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
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

    // Run the sending loop in the background
    (async () => {
      let hasMore = true;
      let consecutiveErrors = 0;
      let emailIndex = 0;
      let totalSent = 0;
      let totalFailed = 0;
      let totalBounced = 0;
      const MAX_CONSECUTIVE_ERRORS = 10;

      // ── Enqueue for auto-resume (non-blocking) ──
      try {
        await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/enqueue/${campaignId}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchSize: 1 }) }
        );
      } catch (e) {
        console.warn('[BROADCAST] Enqueue failed (non-fatal):', e);
      }

      // ── Pre-check: is the campaign already completed? ──
      // Emails may have been sent server-side (enqueue/cron) before the loop starts.
      // If so, skip straight to the "done" state with accurate stats.
      try {
        const preStats = await fetchCampaignStats(campaignId);
        if (preStats) {
          const alreadyDone =
            preStats.status === 'completed' ||
            (preStats.totalLeads > 0 && preStats.sentCount >= preStats.totalLeads);

          if (alreadyDone) {
            console.log(`[BROADCAST] Campaign ${campaignId} is already completed (sent=${preStats.sentCount}/${preStats.totalLeads}) — skipping send-batch loop`);
            totalSent = preStats.sentCount;
            hasMore = false;

            // Show the synced progress before marking done
            setState(prev => ({
              ...prev,
              progress: preStats.sentCount,
              successCount: preStats.sentCount,
              total: Math.max(prev.total, preStats.totalLeads),
              statusText: 'Syncing sent status...',
            }));
          }
        }
      } catch (e) {
        console.warn('[BROADCAST] Pre-check failed (non-fatal):', e);
      }

      // ── Send-batch loop ──
      while (hasMore && !abortRef.current) {
        try {
          setState(prev => ({
            ...prev,
            statusText: emailIndex === 0 ? 'Connecting to mail server...' : `Sending email ${emailIndex + 1}...`,
          }));

          // 90-second timeout — AI generation + SMTP delivery can be slow
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/send-batch?limit=1`,
            { method: 'POST', signal: AbortSignal.timeout(90_000) }
          );

          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));

            // 409 = server-side in-flight lock held by another request.
            // Back off briefly and retry.
            if (response.status === 409) {
              console.warn('[BROADCAST] Server reports campaign already in-flight — backing off 3s then retrying');
              setState(prev => ({ ...prev, statusText: 'Waiting for previous batch...' }));
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }

            console.error('[BROADCAST] Batch failed:', error);
            consecutiveErrors++;

            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              toast.error('Campaign experiencing issues', {
                description: 'Retrying with longer delays. Emails will continue sending in the background.',
                duration: 6000,
              });
              setState(prev => ({ ...prev, statusText: 'Retrying after connection issue...' }));
              await new Promise(r => setTimeout(r, 10000));
              consecutiveErrors = 0;
              continue;
            }

            setState(prev => ({ ...prev, statusText: `Retrying (attempt ${consecutiveErrors})...` }));
            await new Promise(r => setTimeout(r, 2000 * Math.pow(1.5, consecutiveErrors)));
            continue;
          }

          consecutiveErrors = 0;
          const data = await response.json();
          const batchSent = data.sent || 0;
          const emailsSent: any[] = data.emails_sent || [];

          for (const emailInfo of emailsSent) {
            if (abortRef.current) break;
            emailIndex++;
            const entryId = `broadcast-${campaignId}-${emailIndex}`;

            if (emailInfo.success) {
              totalSent++;

              // Phase: writing — show typewriter with actual content
              const contentEntry: SendingLogEntry = {
                id: entryId,
                recipientName: emailInfo.leadName || 'Unknown',
                recipientEmail: emailInfo.leadEmail || '',
                subject: emailInfo.subject || '(no subject)',
                body: emailInfo.body || '',
                fromEmail: emailInfo.fromEmail || '',
                status: 'writing',
                timestamp: Date.now(),
              };
              setState(prev => ({
                ...prev,
                currentEntry: { ...contentEntry },
                successCount: totalSent,
                statusText: `Sending to ${emailInfo.leadName || 'recipient'}...`,
              }));

              // Typing wait: scaled to body length (feels natural)
              const bodyLen = (emailInfo.body || '').length;
              const typingWait = Math.min(Math.max(bodyLen * 4, 1800), 5000);
              await new Promise(r => setTimeout(r, typingWait));

              if (abortRef.current) break;

              // Phase: delivered
              setState(prev => ({
                ...prev,
                currentEntry: { ...contentEntry, status: 'delivered' },
              }));
              await new Promise(r => setTimeout(r, 1000));

              if (abortRef.current) break;

              // Move to completed log
              setState(prev => ({
                ...prev,
                log: [...prev.log, { ...contentEntry, status: 'delivered', timestamp: Date.now() }],
                currentEntry: null,
              }));
            } else {
              const isBounced = emailInfo.bounced || emailInfo.error?.toLowerCase?.()?.includes?.('bounce');
              if (isBounced) {
                totalBounced++;
              } else {
                totalFailed++;
              }

              const failedEntry: SendingLogEntry = {
                id: entryId,
                recipientName: emailInfo.leadName || 'Unknown',
                recipientEmail: emailInfo.leadEmail || '',
                subject: emailInfo.subject || '',
                body: emailInfo.body || '',
                fromEmail: emailInfo.fromEmail || '',
                status: isBounced ? 'bounced' : 'failed',
                timestamp: Date.now(),
              };
              setState(prev => ({
                ...prev,
                log: [...prev.log, failedEntry],
                errorCount: totalFailed,
                bounceCount: totalBounced,
              }));
            }

            setState(prev => ({ ...prev, progress: emailIndex }));
          }

          // ── Detect loop end conditions ──

          // No emails returned and batch sent 0 → no more work
          if (emailsSent.length === 0 && batchSent === 0) {
            hasMore = false;
          }

          if (data.campaign_complete || batchSent === 0) {
            hasMore = false;
          } else {
            await new Promise(r => setTimeout(r, 400));
          }

        } catch (networkError: any) {
          console.error('[BROADCAST] Network error:', networkError);
          consecutiveErrors++;

          // AbortError from our 90-second timeout — treat as a transient error
          const isTimeout = networkError?.name === 'AbortError' || networkError?.name === 'TimeoutError';
          if (isTimeout) {
            console.warn('[BROADCAST] send-batch timed out (90s) — the server may have sent the email anyway. Retrying...');
            setState(prev => ({ ...prev, statusText: 'Connection timed out, retrying...' }));
            // On timeout, give the server a moment to finish, then retry
            await new Promise(r => setTimeout(r, 5000));
            consecutiveErrors = 0; // Don't count timeouts as real errors
            continue;
          }

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            toast.error('Connection unstable', {
              description: 'Retrying with longer delays. Emails will continue sending in the background.',
              duration: 6000,
            });
            setState(prev => ({ ...prev, statusText: 'Connection unstable — retrying...' }));
            await new Promise(r => setTimeout(r, 10000));
            consecutiveErrors = 0;
            continue;
          }

          setState(prev => ({ ...prev, statusText: `Network error, retrying (${consecutiveErrors})...` }));
          await new Promise(r => setTimeout(r, 2000 * Math.pow(1.5, consecutiveErrors)));
        }
      }

      // ── Final stats reconciliation ──
      // If the broadcast loop processed 0 emails visually (because they were
      // sent server-side), fetch the real stats from the campaign record.
      let finalSent = totalSent;
      let finalTotal = total;
      if (totalSent === 0 && !abortRef.current) {
        const finalStats = await fetchCampaignStats(campaignId);
        if (finalStats) {
          finalSent = finalStats.sentCount;
          finalTotal = Math.max(total, finalStats.totalLeads);
          console.log(`[BROADCAST] Reconciled stats from server: sent=${finalSent}/${finalTotal}`);
        }
      }

      // Done
      setState(prev => ({
        ...prev,
        currentEntry: null,
        done: true,
        successCount: Math.max(prev.successCount, finalSent),
        progress: Math.max(prev.progress, finalSent),
        total: Math.max(prev.total, finalTotal),
        statusText: '',
      }));
      runningRef.current = false;
      activeCampaignIdRef.current = '';
      releaseSendLock(campaignId);

      // Invalidate caches
      apiCache.invalidate('campaigns:*');
      apiCache.invalidate('crm:*');
      apiCache.invalidate('dashboard:*');
      apiCache.invalidate('analytics:*');

      // Broadcast real-time event so other tabs/users refresh
      realtimeManager.emit('campaign:completed', { campaignName, sent: finalSent, bounced: totalBounced, failed: totalFailed });
      if (finalSent > 0) {
        realtimeManager.emit('email:sent', { campaignName, count: finalSent });
      }
      dispatchAppEvent({ type: 'campaigns:changed', meta: { action: 'broadcast_complete', sent: finalSent } });
      dispatchAppEvent({ type: 'leads:changed', meta: { action: 'emails_sent' } });

      if (!abortRef.current) {
        toast.success('Campaign sent', {
          description: `${finalSent} email${finalSent !== 1 ? 's' : ''} delivered${totalBounced > 0 ? `, ${totalBounced} bounced` : ''}${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`,
          duration: 5000,
        });

        // Auto-minimize after completion
        setTimeout(() => {
          setState(prev => ({ ...prev, viewMode: 'minimized' }));
        }, 3000);
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
