/**
 * Dashboard Competitive Gap Widget
 * Shows how your brand compares to tracked competitors on key social metrics.
 * Displays gap percentages with visual bars and navigates to Social Hub on click.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Swords, Shield, TrendingUp, TrendingDown, Users, Eye, Heart, BarChart3, ChevronRight, Loader2, AlertTriangle, Bell, X } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { useDemoMode } from './DemoContext';
import { toast } from 'sonner';

const TRACKER_API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/social-tracker`;

interface TrackedAccount {
  id: string;
  platform: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  profileType?: 'own' | 'competitor';
  latestMetrics?: {
    followers: number;
    views: number;
    likes: number;
    posts: number;
  };
}

interface CompetitorAlert {
  id: string;
  type: 'overtake' | 'milestone';
  competitorName: string;
  competitorHandle: string;
  platform: string;
  metric: string;
  competitorValue: number;
  yourValue?: number;
  milestone?: number;
  timestamp: string;
  dismissed: boolean;
}

function compactNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

const METRIC_ICONS: Record<string, any> = {
  followers: Users,
  views: Eye,
  likes: Heart,
  posts: BarChart3,
};

// Mini sparkline for gap % trend (inline in competitor cards)
function MiniGapSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const W = 60;
  const H = 20;
  const maxVal = Math.max(...data);
  const minVal = Math.min(...data);
  const range = Math.max(maxVal - minVal, 1);

  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - 2 - ((v - minVal) / range) * (H - 4),
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const lastVal = data[data.length - 1];
  const color = lastVal <= 0 ? '#1ED4A7' : '#f43f5e';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-[60px] h-[20px] shrink-0 opacity-60" preserveAspectRatio="none">
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DashboardCompetitiveGap({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [alerts, setAlerts] = useState<CompetitorAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissingAlert, setDismissingAlert] = useState<string | null>(null);
  const [gapHistory, setGapHistory] = useState<{ date: string; gaps: { competitorId: string; gapPct: number }[] }[]>([]);

  const loadData = useCallback(async () => {
    if (isDemoMode) {
      setAccounts([
        { id: 'own_ig', platform: 'instagram', handle: 'contndrHQ', displayName: 'Contndr', profileType: 'own', latestMetrics: { followers: 12_400, views: 89_000, likes: 4_200, posts: 156 } },
        { id: 'own_li', platform: 'linkedin', handle: 'contndr', displayName: 'Contndr', profileType: 'own', latestMetrics: { followers: 8_700, views: 45_000, likes: 0, posts: 92 } },
        { id: 'comp_ig', platform: 'instagram', handle: 'apolloio', displayName: 'Apollo.io', profileType: 'competitor', latestMetrics: { followers: 45_600, views: 320_000, likes: 18_900, posts: 480 } },
        { id: 'comp_li', platform: 'linkedin', handle: 'outreach-io', displayName: 'Outreach', profileType: 'competitor', latestMetrics: { followers: 112_000, views: 890_000, likes: 0, posts: 720 } },
        { id: 'comp_tw', platform: 'twitter', handle: 'lemaborhia', displayName: 'Lemlist', profileType: 'competitor', latestMetrics: { followers: 28_300, views: 0, likes: 9_400, posts: 340 } },
      ]);
      setAlerts([
        { id: 'alert_1', type: 'overtake', competitorName: 'Apollo.io', competitorHandle: 'apolloio', platform: 'instagram', metric: 'followers', competitorValue: 45_600, yourValue: 12_400, timestamp: new Date(Date.now() - 3600000 * 4).toISOString(), dismissed: false },
        { id: 'alert_2', type: 'milestone', competitorName: 'Outreach', competitorHandle: 'outreach-io', platform: 'linkedin', metric: 'followers', competitorValue: 112_000, milestone: 100_000, timestamp: new Date(Date.now() - 86400000).toISOString(), dismissed: false },
      ]);
      setLoading(false);
      return;
    }
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { setLoading(false); return; }
      const [accountsRes, alertsRes] = await Promise.all([
        fetch(`${TRACKER_API}/tracked`, { headers }),
        fetch(`${TRACKER_API}/alerts`, { headers }).catch(() => null),
      ]);
      if (accountsRes.ok) {
        const data = await accountsRes.json();
        setAccounts(data.accounts || []);
      }
      if (alertsRes?.ok) {
        const alertData = await alertsRes.json();
        setAlerts((alertData.alerts || []).filter((a: CompetitorAlert) => !a.dismissed));
      }
      // Fetch gap history (best effort)
      try {
        const gapRes = await fetch(`${TRACKER_API}/gap-history?days=14`, { headers });
        if (gapRes.ok) {
          const gapData = await gapRes.json();
          setGapHistory(gapData.snapshots || []);
        }
      } catch {}
    } catch (err) {
      console.error('[COMPETITIVE-GAP] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [isDemoMode]);

  useEffect(() => { loadData(); }, [loadData]);

  const dismissAlert = async (alertId: string) => {
    if (isDemoMode) {
      setAlerts(prev => prev.filter(a => a.id !== alertId));
      return;
    }
    setDismissingAlert(alertId);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${TRACKER_API}/alerts/${alertId}/dismiss`, { method: 'POST', headers });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (err) {
      console.error('[COMPETITIVE-GAP] Dismiss error:', err);
    } finally {
      setDismissingAlert(null);
    }
  };

  const ownAccounts = useMemo(() => accounts.filter(a => a.profileType !== 'competitor'), [accounts]);
  const competitorAccounts = useMemo(() => accounts.filter(a => a.profileType === 'competitor'), [accounts]);

  // Calculate gap per competitor on shared platform metrics
  const competitorGaps = useMemo(() => {
    if (ownAccounts.length === 0 || competitorAccounts.length === 0) return [];

    // Aggregate own metrics by platform
    const ownByPlatform: Record<string, { followers: number; posts: number; likes: number; views: number }> = {};
    for (const a of ownAccounts) {
      const m = a.latestMetrics;
      if (!m) continue;
      if (!ownByPlatform[a.platform]) ownByPlatform[a.platform] = { followers: 0, posts: 0, likes: 0, views: 0 };
      ownByPlatform[a.platform].followers += m.followers;
      ownByPlatform[a.platform].posts += m.posts;
      ownByPlatform[a.platform].likes += m.likes;
      ownByPlatform[a.platform].views += m.views;
    }

    // Cross-platform total own metrics
    const totalOwn = { followers: 0, posts: 0 };
    for (const v of Object.values(ownByPlatform)) {
      totalOwn.followers += v.followers;
      totalOwn.posts += v.posts;
    }

    return competitorAccounts.map(comp => {
      const cm = comp.latestMetrics;
      if (!cm) return null;

      // Same-platform comparison if we have own profile on same platform
      const ownSamePlatform = ownByPlatform[comp.platform];
      const ownFollowers = ownSamePlatform?.followers || totalOwn.followers;
      const compFollowers = cm.followers;

      const gap = ownFollowers > 0
        ? Math.round(((compFollowers - ownFollowers) / ownFollowers) * 100)
        : compFollowers > 0 ? 100 : 0;

      return {
        competitor: comp,
        ownFollowers,
        compFollowers,
        gap, // positive = behind, negative = ahead
        samePlatform: !!ownSamePlatform,
      };
    }).filter(Boolean).sort((a: any, b: any) => b.gap - a.gap) as {
      competitor: TrackedAccount;
      ownFollowers: number;
      compFollowers: number;
      gap: number;
      samePlatform: boolean;
    }[];
  }, [ownAccounts, competitorAccounts]);

  // If no accounts, show minimal placeholder
  if (loading) {
    return (
      <div className="glass-card h-full flex flex-col">
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('dashboard.competitiveGap.title', 'Competitive Intelligence')}</h3>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
        </div>
      </div>
    );
  }

  if (accounts.length === 0 || competitorAccounts.length === 0) {
    return (
      <div className="glass-card h-full flex flex-col">
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('dashboard.competitiveGap.title', 'Competitive Intelligence')}</h3>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <Swords className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mb-3" />
          <p className="text-xs text-zinc-500 mb-3">{t('dashboard.competitiveGap.noCompetitors', 'Track competitors in Social Hub to see how you stack up')}</p>
          <button
            onClick={() => onNavigate('social')}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors"
          >
            <Shield className="w-3 h-3" /> {t('dashboard.competitiveGap.trackCompetitors', 'Track Competitors')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card h-full flex flex-col">
      {/* Header */}
      <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Swords className="w-4 h-4 text-rose-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('dashboard.competitiveGap.title', 'Competitive Intelligence')}</h3>
          {alerts.length > 0 && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/10 text-red-500 border border-red-500/20">
              <Bell className="w-2.5 h-2.5" />
              {alerts.length}
            </span>
          )}
        </div>
        <button
          onClick={() => onNavigate('social')}
          className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors flex items-center gap-0.5"
        >
          {t('dashboard.competitiveGap.viewAll', 'View All')} <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3">
        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="space-y-2 mb-4">
            {alerts.slice(0, 3).map(alert => (
              <div key={alert.id} className={`flex items-start gap-2 p-2.5 rounded-lg border text-[11px] ${
                alert.type === 'overtake'
                  ? 'bg-red-500/5 border-red-500/15 text-red-400'
                  : 'bg-amber-500/5 border-amber-500/15 text-amber-400'
              }`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  {alert.type === 'overtake' ? (
                    <span>
                      <strong>{alert.competitorName}</strong>{' '}
                      {t('dashboard.competitiveGap.overtookYou', 'overtook you on {{metric}}', { metric: t(`socialHub.metrics.${alert.metric}` as any, alert.metric) })} —{' '}
                      {compactNum(alert.competitorValue)} vs {compactNum(alert.yourValue || 0)}
                    </span>
                  ) : (
                    <span>
                      <strong>{alert.competitorName}</strong>{' '}
                      {t('dashboard.competitiveGap.hitMilestone', 'hit {{milestone}} {{metric}}', {
                        milestone: compactNum(alert.milestone || 0),
                        metric: t(`socialHub.metrics.${alert.metric}` as any, alert.metric),
                      })}
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissAlert(alert.id); }}
                  disabled={dismissingAlert === alert.id}
                  className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
                >
                  {dismissingAlert === alert.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Gap per competitor */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {competitorGaps.map(({ competitor, ownFollowers, compFollowers, gap }) => {
          const isAhead = gap <= 0;
          const absGap = Math.abs(gap);
          // Extract sparkline data for this competitor from gap history
          const sparkData = gapHistory
            .map(snap => snap.gaps.find(g => g.competitorId === competitor.id)?.gapPct)
            .filter((v): v is number => v !== undefined);

          return (
            <div
              key={competitor.id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 p-3 hover:border-zinc-300 dark:hover:border-zinc-200 dark:border-zinc-800 transition-colors cursor-pointer"
              onClick={() => onNavigate('social')}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {competitor.avatarUrl ? (
                    <img src={competitor.avatarUrl} alt="" className="w-5 h-5 rounded shrink-0 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-5 h-5 rounded bg-rose-500/10 flex items-center justify-center shrink-0">
                      <Swords className="w-2.5 h-2.5 text-rose-500" />
                    </div>
                  )}
                  <span className="text-[11px] font-medium text-zinc-900 dark:text-white truncate">{competitor.displayName || competitor.handle}</span>
                  <span className="text-[9px] text-zinc-500 capitalize">{competitor.platform}</span>
                </div>
                <div className={`flex items-center gap-0.5 text-[10px] font-bold ${isAhead ? 'text-[#1ED4A7]' : 'text-rose-500'}`}>
                  {isAhead ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isAhead ? t('dashboard.competitiveGap.ahead', '{{pct}}% ahead', { pct: absGap }) : t('dashboard.competitiveGap.behind', '{{pct}}% behind', { pct: absGap })}
                </div>
              </div>

              {/* Mini gap trend sparkline */}
              {sparkData.length >= 2 && (
                <div className="mb-1.5">
                  <MiniGapSparkline data={sparkData} />
                </div>
              )}

              {/* Visual bar comparison */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[#1ED4A7] font-medium w-6 shrink-0">{t('dashboard.competitiveGap.you', 'You')}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
                    <div className="h-full rounded-full bg-[#1ED4A7] transition-all duration-700" style={{ width: `${Math.min(100, (ownFollowers / Math.max(ownFollowers, compFollowers, 1)) * 100)}%` }} />
                  </div>
                  <span className="text-[9px] font-semibold text-zinc-600 dark:text-zinc-400 w-10 text-right">{compactNum(ownFollowers)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-rose-500 font-medium w-6 shrink-0 truncate">{(competitor.displayName || competitor.handle).slice(0, 4)}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
                    <div className="h-full rounded-full bg-rose-500 transition-all duration-700" style={{ width: `${Math.min(100, (compFollowers / Math.max(ownFollowers, compFollowers, 1)) * 100)}%` }} />
                  </div>
                  <span className="text-[9px] font-semibold text-zinc-600 dark:text-zinc-400 w-10 text-right">{compactNum(compFollowers)}</span>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

export default DashboardCompetitiveGap;