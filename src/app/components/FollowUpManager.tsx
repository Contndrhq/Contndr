import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Zap, Play, Mail, Power, ChevronRight, Pause, Rocket, Shield, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { authenticatedFetch, getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from "sonner";
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';

interface Campaign {
  id: string;
  name: string;
  follow_up_enabled: boolean;
  follow_up_attempts: number;
  days_between_follow_ups: number;
  status: string;
  brand: string;
}

// How long before we consider the cycle "stale" and auto-heal
const AUTO_HEAL_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours
// How often to poll + auto-heal (frontend heartbeat)
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function FollowUpManager() {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const [cronStatus, setCronStatus] = useState<any>(null);
  const [cronTriggering, setCronTriggering] = useState(false);
  const [showEnableCampaigns, setShowEnableCampaigns] = useState(false);
  // Auto-heal: tracks if a silent cycle is running in the background
  const [autoHealing, setAutoHealing] = useState(false);
  const autoHealTriggeredRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Demo data ──
  const demoCampaigns: Campaign[] = [
    { id: 'demo-fu-1', name: 'Spring Auto Promo', follow_up_enabled: true, follow_up_attempts: 3, days_between_follow_ups: 3, status: 'active', brand: 'default' },
    { id: 'demo-fu-2', name: 'Dental Outreach Q1', follow_up_enabled: true, follow_up_attempts: 2, days_between_follow_ups: 5, status: 'active', brand: 'default' },
  ];
  const demoAllCampaigns: Campaign[] = [
    ...demoCampaigns,
    { id: 'demo-fu-3', name: 'HVAC National Push', follow_up_enabled: false, follow_up_attempts: 3, days_between_follow_ups: 3, status: 'sent', brand: 'default' },
    { id: 'demo-fu-4', name: 'SaaS Beta Launch', follow_up_enabled: false, follow_up_attempts: 3, days_between_follow_ups: 4, status: 'draft', brand: 'default' },
  ];

  // ── Load everything on mount ──
  useEffect(() => {
    if (isDemoMode) {
      setCampaigns(demoCampaigns);
      setAllCampaigns(demoAllCampaigns);
      setStats({ eligible: Array(14).fill(null) });
      setDueCount(6);
      setCronStatus({
        fullCron: { completedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString() },
        followUpCron: { lastRun: { totalSent: 8, completedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString() } },
        resumeCron: { campaignsResumed: 1 },
      });
      setLoading(false);
      return;
    }

    loadAll();

    // Heartbeat: periodically check status + auto-heal if needed
    heartbeatRef.current = setInterval(() => {
      checkDueFollowUps();
      loadCronStatus().then(status => {
        if (status) maybeAutoHeal(status);
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  async function loadAll() {
    setLoading(true);
    const [, , , , status] = await Promise.all([
      loadCampaigns(),
      loadAllCampaigns(),
      loadEngagementStats(),
      checkDueFollowUps(),
      loadCronStatus(),
    ]);
    setLoading(false);

    // Auto-heal on first load if cycle is stale or never run
    if (status) {
      maybeAutoHeal(status);
    }
  }

  // ── Auto-heal: silently trigger a full cycle if overdue ──
  const maybeAutoHeal = useCallback((status: any) => {
    if (autoHealTriggeredRef.current || cronTriggering || autoHealing) return;

    const lastRunAt = status?.fullCron?.completedAt || status?.followUpCron?.lastRun?.completedAt;
    const lastRunMs = lastRunAt ? Date.now() - new Date(lastRunAt).getTime() : null;
    const isOverdue = lastRunMs === null || lastRunMs > AUTO_HEAL_THRESHOLD_MS;

    if (isOverdue) {
      autoHealTriggeredRef.current = true;
      runSilentCycle();
    }
  }, [cronTriggering, autoHealing]);

  // Silent cycle: runs in background, updates status, only toasts if there's actual activity
  async function runSilentCycle() {
    setAutoHealing(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/cron/trigger`,
        { method: 'POST' }
      );
      if (response.ok) {
        const data = await response.json();
        const totalActivity = (data.followUps?.totalSent || 0) + (data.campaignResume?.totalSent || 0);
        if (totalActivity > 0) {
          const parts: string[] = [];
          if (data.followUps?.totalSent > 0) parts.push(t('autopilot.followUpsSentCount', { count: data.followUps.totalSent }));
          if (data.campaignResume?.totalSent > 0) parts.push(t('autopilot.campaignEmailsSentCount', { count: data.campaignResume.totalSent }));
          toast.success(t('autopilot.autopilotProcessed'), {
            description: parts.join(' · '),
            duration: 5000,
          });
        }
        // Refresh all data after cycle
        await Promise.all([loadCronStatus(), checkDueFollowUps(), loadCampaigns()]);
      }
    } catch (err) {
      console.warn('[AUTOPILOT] Silent cycle error:', err);
    } finally {
      setAutoHealing(false);
    }
  }

  async function checkDueFollowUps() {
    if (isDemoMode) return;
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/followups/due-count`
      );
      if (response.ok) {
        const data = await response.json();
        setDueCount(data.totalDue || 0);
      }
    } catch (err) {
      console.warn('[FOLLOW-UPS] Due count check error:', err);
    }
  }

  async function autoProcessFollowUps() {
    if (isDemoMode) {
      toast(t('autopilot.demoFollowUpProcessing'), { duration: 3000 });
      return;
    }
    if (autoProcessing) return;
    setAutoProcessing(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/followups/auto-process`,
        { method: 'POST' }
      );
      if (response.ok) {
        const data = await response.json();
        if (data.sent > 0) {
          toast.success(t('autopilot.sentFollowUpsCount', { count: data.sent }), {
            description: t('autopilot.sentFollowUpsAcross', { count: data.campaigns?.length || 0 }),
            duration: 5000,
          });
          loadCampaigns();
          checkDueFollowUps();
        } else {
          toast(t('autopilot.allCaughtUp'), { description: t('autopilot.noFollowUpsDueNow'), duration: 3000 });
        }
      }
    } catch (err) {
      console.warn('[FOLLOW-UPS] Auto-process error:', err);
    } finally {
      setAutoProcessing(false);
    }
  }

  async function loadCronStatus(): Promise<any> {
    if (isDemoMode) return null;
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/cron/status`
      );
      if (response.ok) {
        const data = await response.json();
        setCronStatus(data);
        return data;
      }
    } catch (err) {
      console.warn('[CRON] Status check error:', err);
    }
    return null;
  }

  async function triggerGlobalCron() {
    if (isDemoMode) {
      setCronTriggering(true);
      setTimeout(() => {
        toast.success(t('autopilot.demoCycleSimulated'), {
          description: t('autopilot.demoCycleDesc'),
          duration: 5000,
        });
        setCronTriggering(false);
      }, 2000);
      return;
    }
    setCronTriggering(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/cron/trigger`,
        { method: 'POST' }
      );
      if (response.ok) {
        const data = await response.json();
        const parts: string[] = [];
        if (data.followUps?.totalSent > 0) parts.push(t('autopilot.followUpsSentCount', { count: data.followUps.totalSent }));
        if (data.campaignResume?.totalSent > 0) parts.push(t('autopilot.campaignEmailsSentCount', { count: data.campaignResume.totalSent }));
        if (data.campaignResume?.campaignsResumed > 0) parts.push(t('autopilot.campaignsResumedCount', { count: data.campaignResume.campaignsResumed }));
        if (data.notifications?.emailsSent > 0) parts.push(t('autopilot.digestsSentCount', { count: data.notifications.emailsSent }));
        toast.success(t('autopilot.autoCycleComplete'), {
          description: parts.length > 0 ? parts.join(' · ') : t('autopilot.everythingUpToDate'),
          duration: 6000,
        });
        loadCronStatus();
        checkDueFollowUps();
        loadCampaigns();
      } else {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        toast.error(t('autopilot.autoCycleFailed'), { description: error.error || t('autopilot.pleaseRetry'), duration: 5000 });
      }
    } catch (err: any) {
      toast.error(t('autopilot.connectionError'), { description: err.message, duration: 5000 });
    } finally {
      setCronTriggering(false);
      // Allow auto-heal again after manual trigger
      autoHealTriggeredRef.current = false;
    }
  }

  async function loadCampaigns() {
    if (isDemoMode) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('follow_up_enabled', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCampaigns(data || []);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
  }

  async function loadAllCampaigns() {
    if (isDemoMode) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAllCampaigns(data || []);
    } catch (error) {
      console.error('Error loading all campaigns:', error);
    }
  }

  async function loadEngagementStats() {
    if (isDemoMode) return;
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/eligible-for-followup`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error loading engagement stats:', error);
    }
  }

  async function processFollowUp(campaignId: string) {
    if (isDemoMode) {
      toast.success(t('autopilot.demoFollowUpSimulated'), { duration: 4000 });
      return;
    }
    setProcessing(campaignId);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/follow-ups`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        }
      );
      if (response.ok) {
        const data = await response.json();
        toast.success(t('autopilot.sentFollowUpsCount', { count: data.followUpsSent || 0 }), { duration: 4000 });
        loadCampaigns();
        checkDueFollowUps();
      } else {
        const error = await response.json();
        toast.error(`Follow-up error: ${error.error || 'Unknown error'}`, { duration: 5000 });
      }
    } catch (error: any) {
      toast.error(`Error: ${error.message}`, { duration: 5000 });
    } finally {
      setProcessing(null);
    }
  }

  async function enableFollowUps(campaignId: string, enabled: boolean, maxAttempts = 3, daysBetween = 3) {
    if (isDemoMode) {
      if (enabled) {
        const camp = demoAllCampaigns.find(c => c.id === campaignId);
        if (camp) setCampaigns(prev => [...prev, { ...camp, follow_up_enabled: true }]);
      } else {
        setCampaigns(prev => prev.filter(c => c.id !== campaignId));
      }
      toast(enabled ? t('autopilot.followUpsEnabled') : t('autopilot.followUpsDisabled'), { duration: 3000 });
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase
        .from('campaigns')
        .update({
          follow_up_enabled: enabled,
          follow_up_attempts: maxAttempts,
          days_between_follow_ups: daysBetween,
        })
        .eq('id', campaignId)
        .eq('user_id', session.user.id);
      loadCampaigns();
      loadAllCampaigns();
      toast(enabled ? t('autopilot.followUpsEnabled') : t('autopilot.followUpsDisabled'), { duration: 3000 });
    } catch (error) {
      console.error('Error updating follow-up settings:', error);
    }
  }

  // ── Derived ──
  const eligibleCount = stats?.eligible?.length || 0;
  const disabledCampaigns = allCampaigns.filter(c => !c.follow_up_enabled);
  const isRunningNow = cronTriggering || autoProcessing || autoHealing || cronStatus?.followUpLockActive || cronStatus?.resumeLockActive;

  // Automation health — smarter thresholds
  const lastRunAt = cronStatus?.fullCron?.completedAt || cronStatus?.followUpCron?.lastRun?.completedAt;
  const lastRunMs = lastRunAt ? Date.now() - new Date(lastRunAt).getTime() : null;

  // Health status with auto-heal awareness
  const healthStatus: 'active' | 'syncing' | 'idle' | 'never' =
    isRunningNow ? 'syncing'
    : lastRunMs === null ? 'never'
    : lastRunMs < 6 * 60 * 60 * 1000 ? 'active' // 6 hours = healthy
    : 'idle'; // Stale, but we'll auto-heal — so don't alarm the user

  // Total emails sent across all cron runs
  const lastFollowUpsSent = cronStatus?.followUpCron?.lastRun?.totalSent || 0;
  const lastCampaignsResumed = cronStatus?.resumeCron?.campaignsResumed || 0;
  const lastDigestsSent = cronStatus?.fullCron?.notificationsSent || 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-28 sm:pb-6">
      {/* ── Header + Primary CTA ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 text-[var(--foreground)]">{t('autopilot.title')}</h1>
          <p className="text-[var(--foreground-muted)] text-[14px]">
            {t('autopilot.subtitle')}
          </p>
        </div>
        <button
          onClick={() => { loadAll(); }}
          className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          {t('common.refresh')}
        </button>
      </div>

      {/* ── Autopilot Control Card ── */}
      <div className="relative overflow-hidden bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-2xl">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            {/* Left: status */}
            <div className="flex items-start gap-4 min-w-0">
              <div className={`mt-0.5 flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                healthStatus === 'syncing'
                  ? 'bg-[#1ED4A7]/10'
                  : healthStatus === 'active'
                    ? 'bg-[#1ED4A7]/10'
                    : 'bg-zinc-100 dark:bg-zinc-900'
              }`}>
                {healthStatus === 'syncing' ? (
                  <RefreshCw className="w-5 h-5 text-[#1ED4A7] animate-spin" />
                ) : healthStatus === 'active' ? (
                  <Rocket className="w-5 h-5 text-[#1ED4A7]" />
                ) : healthStatus === 'idle' ? (
                  <CheckCircle className="w-5 h-5 text-zinc-400" />
                ) : (
                  <Pause className="w-5 h-5 text-zinc-400" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                    {healthStatus === 'syncing'
                      ? t('autopilot.syncing')
                      : healthStatus === 'active'
                        ? t('autopilot.allSystemsActive')
                        : healthStatus === 'idle'
                          ? t('autopilot.standingBy')
                          : campaigns.length > 0 || allCampaigns.length > 0
                            ? t('autopilot.readyToActivate')
                            : t('autopilot.noCampaignsYet')}
                  </h2>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    healthStatus === 'syncing' || healthStatus === 'active'
                      ? 'bg-[#1ED4A7]/15 text-[#1ED4A7]'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      healthStatus === 'syncing'
                        ? 'bg-[#1ED4A7] animate-pulse'
                        : healthStatus === 'active'
                          ? 'bg-[#1ED4A7]'
                          : 'bg-zinc-400'
                    }`} />
                    {healthStatus === 'syncing' ? t('autopilot.running') : healthStatus === 'active' ? t('autopilot.healthy') : healthStatus === 'idle' ? t('autopilot.idle') : t('autopilot.inactive')}
                  </span>
                </div>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {healthStatus === 'syncing'
                    ? t('autopilot.processingActivity')
                    : lastRunAt
                      ? t('autopilot.lastCycle', { time: formatTimeAgo(lastRunAt, t) })
                      : campaigns.length > 0
                        ? t('autopilot.firstCycleAuto')
                        : t('autopilot.enableToGetStarted')}
                  {dueCount > 0 && !isRunningNow && (
                    <span className="text-zinc-900 dark:text-white font-medium"> · {t('autopilot.followUpsPending', { count: dueCount })}</span>
                  )}
                </p>
              </div>
            </div>

            {/* Right: CTA */}
            <button
              onClick={triggerGlobalCron}
              disabled={cronTriggering || autoHealing}
              className="flex items-center justify-center gap-2.5 px-6 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl text-sm font-semibold hover:bg-black dark:hover:bg-zinc-100 disabled:opacity-60 transition-all flex-shrink-0 w-full sm:w-auto"
            >
              {cronTriggering || autoHealing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {cronTriggering || autoHealing ? t('autopilot.runningBtn') : t('autopilot.runFullCycle')}
            </button>
          </div>

          {/* Activity summary chips — show whenever we have data */}
          {(lastFollowUpsSent > 0 || lastCampaignsResumed > 0 || lastDigestsSent > 0 || lastRunAt) && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/80">
              <ActivityChip label={t('autopilot.followUpsSent')} value={lastFollowUpsSent} />
              <ActivityChip label={t('autopilot.campaignsResumed')} value={lastCampaignsResumed} />
              <ActivityChip label={t('autopilot.digestsDelivered')} value={lastDigestsSent} />
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Stats ── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('autopilot.dueNow')} value={dueCount} highlight={dueCount > 0 ? 'amber' : undefined} />
        <StatCard label={t('autopilot.eligible')} value={eligibleCount} />
        <StatCard label={t('autopilot.active')} value={campaigns.length} highlight={campaigns.length > 0 ? 'teal' : undefined} />
      </div>

      {/* ── Due Follow-Ups Banner ── */}
      {dueCount > 0 && !cronTriggering && !autoHealing && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3.5">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-white">
                {t('autopilot.followUpsReadyToSend', { count: dueCount })}
              </p>
              <p className="text-xs text-zinc-500">
                {t('autopilot.leadsWaiting')}
              </p>
            </div>
          </div>
          <button
            onClick={autoProcessFollowUps}
            disabled={autoProcessing}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-black dark:hover:bg-zinc-100 disabled:opacity-50 whitespace-nowrap flex-shrink-0"
          >
            {autoProcessing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {autoProcessing ? t('autopilot.sendingBtn') : t('autopilot.sendNow')}
          </button>
        </div>
      )}

      {/* ── Active Follow-Up Campaigns ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('autopilot.activeCampaigns')}</h3>
          <span className="text-xs text-zinc-400">{t('autopilot.withFollowUps', { count: campaigns.length })}</span>
        </div>

        {campaigns.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mx-auto mb-3">
              <Mail className="w-6 h-6 text-zinc-400" />
            </div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('autopilot.noCampaignsOnAutopilot')}</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-xs mx-auto">
              {disabledCampaigns.length > 0
                ? t('autopilot.campaignsAvailable', { count: disabledCampaigns.length })
                : t('autopilot.createCampaignFirst')}
            </p>
            {disabledCampaigns.length > 0 && !showEnableCampaigns && (
              <button
                onClick={() => setShowEnableCampaigns(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-xs font-medium hover:bg-black dark:hover:bg-zinc-100 transition-colors"
              >
                <Power className="w-3 h-3" />
                {t('autopilot.enableOnCampaign')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map(campaign => (
              <CampaignRow
                key={campaign.id}
                campaign={campaign}
                processing={processing === campaign.id}
                onProcess={() => processFollowUp(campaign.id)}
                onDisable={() => enableFollowUps(campaign.id, false)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Enable Follow-Ups ── */}
      {disabledCampaigns.length > 0 && (
        <section>
          <button
            onClick={() => setShowEnableCampaigns(!showEnableCampaigns)}
            className="flex items-center justify-between w-full group"
          >
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
              {t('autopilot.availableCampaigns')}
              <span className="text-xs font-normal text-zinc-400 ml-2">{disabledCampaigns.length}</span>
            </h3>
            <ChevronRight className={`w-4 h-4 text-zinc-400 transition-transform ${showEnableCampaigns ? 'rotate-90' : ''}`} />
          </button>

          {showEnableCampaigns && (
            <div className="mt-3 space-y-2">
              {disabledCampaigns.slice(0, 15).map(campaign => (
                <div
                  key={campaign.id}
                  className="flex items-center justify-between gap-3 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-900 dark:text-white truncate">{campaign.name}</p>
                    <p className="text-xs text-zinc-400 capitalize">{campaign.status}</p>
                  </div>
                  <button
                    onClick={() => enableFollowUps(campaign.id, true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 whitespace-nowrap flex-shrink-0 transition-colors"
                  >
                    <Power className="w-3 h-3" />
                    {t('autopilot.enable')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── How Autopilot Works — clean, minimal ── */}
      <section className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800/60 rounded-xl p-5">
        <h4 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-3">{t('autopilot.howAutopilotWorks')}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <AutopilotStep
            icon={<Mail className="w-4 h-4" />}
            title={t('autopilot.followUps')}
            desc={t('autopilot.followUpsDesc')}
          />
          <AutopilotStep
            icon={<Rocket className="w-4 h-4" />}
            title={t('autopilot.campaignResume')}
            desc={t('autopilot.campaignResumeDesc')}
          />
          <AutopilotStep
            icon={<Shield className="w-4 h-4" />}
            title={t('autopilot.smartSafeguards')}
            desc={t('autopilot.smartSafeguardsDesc')}
          />
        </div>
      </section>

      {/* ── Mobile Bottom Action Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden">
        <div className="bg-white/80 dark:bg-black/80 backdrop-blur-xl border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            onClick={triggerGlobalCron}
            disabled={cronTriggering || autoHealing}
            className="flex items-center justify-center gap-2.5 w-full px-6 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl text-sm font-semibold hover:bg-black dark:hover:bg-zinc-100 disabled:opacity-60 transition-all"
          >
            {cronTriggering || autoHealing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {cronTriggering || autoHealing ? t('autopilot.runningBtn') : t('autopilot.runFullCycle')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function ActivityChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-400">
      <span className="font-semibold text-zinc-900 dark:text-white">{value}</span>
      {label}
    </span>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: 'teal' | 'amber' }) {
  const valueColor = highlight === 'teal'
    ? 'text-[#1ED4A7]'
    : highlight === 'amber'
      ? 'text-zinc-400'
      : 'text-zinc-900 dark:text-white';

  return (
    <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

function CampaignRow({
  campaign,
  processing,
  onProcess,
  onDisable,
}: {
  campaign: Campaign;
  processing: boolean;
  onProcess: () => void;
  onDisable: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] flex-shrink-0" />
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{campaign.name}</h4>
          </div>
          <div className="flex items-center gap-3 mt-1 ml-3.5">
            <span className="text-xs text-zinc-400">
              {t('autopilot.attemptsEvery', { count: campaign.follow_up_attempts, days: campaign.days_between_follow_ups })}
            </span>
            {campaign.brand && campaign.brand !== 'custom' && campaign.brand !== 'default' && (
              <span className="text-xs px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 capitalize">
                {campaign.brand}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3.5 sm:ml-0">
          <button
            onClick={onProcess}
            disabled={processing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-xs font-medium hover:bg-black dark:hover:bg-zinc-100 disabled:opacity-50 transition-colors"
          >
            {processing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {t('autopilot.send')}
          </button>
          <button
            onClick={onDisable}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-500 rounded-lg text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            {t('autopilot.disable')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AutopilotStep({ icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500">
        {icon}
      </div>
      <div>
        <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">{title}</p>
        <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string, t?: any): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (t) {
    if (mins < 1) return t('autopilot.justNow');
    if (mins < 60) return t('autopilot.mAgo', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('autopilot.hAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('autopilot.dAgo', { count: days });
  }
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}