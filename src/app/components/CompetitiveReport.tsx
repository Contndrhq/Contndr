/**
 * CompetitiveReport — Printable competitive intelligence report.
 * Shows: summary cards, gap analysis table, gap trend chart, alerts history.
 * Uses window.print() for PDF export.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Swords, Shield, Users, TrendingUp, AlertTriangle, Printer,
  X, Loader2, Mail, ChevronDown, BarChart3, Bell, Send,
} from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { useDemoMode } from './DemoContext';
import { toast } from 'sonner';

const TRACKER_API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/social-tracker`;

function compactNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

interface GapEntry {
  competitorId: string;
  competitorName: string;
  competitorHandle: string;
  platform: string;
  gapPct: number;
  ownFollowers: number;
  compFollowers: number;
}

interface GapSnapshot {
  date: string;
  gaps: GapEntry[];
}

interface TrackedAccount {
  id: string;
  platform: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  profileType?: 'own' | 'competitor';
  latestMetrics?: { followers: number; views: number; likes: number; posts: number };
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

interface DigestPrefs {
  frequency: 'off' | 'daily' | 'weekly';
  email?: string;
  lastSentAt?: string;
}

// ─── Gap Trend SVG Chart ─────────────────────────────────────────────

function GapTrendChart({ gapHistory, competitorId, competitorName, color }: {
  gapHistory: GapSnapshot[];
  competitorId: string;
  competitorName: string;
  color: string;
}) {
  const data = useMemo(() => {
    return gapHistory
      .map(snap => {
        const entry = snap.gaps.find(g => g.competitorId === competitorId);
        if (!entry) return null;
        return { date: snap.date, gapPct: entry.gapPct };
      })
      .filter(Boolean) as { date: string; gapPct: number }[];
  }, [gapHistory, competitorId]);

  if (data.length < 2) {
    return (
      <div className="text-center py-6">
        <BarChart3 className="w-5 h-5 text-zinc-400 mx-auto mb-1" />
        <p className="text-[10px] text-zinc-500">{competitorName}: Sync regularly to build trend data</p>
      </div>
    );
  }

  const W = 400;
  const H = 120;
  const PAD_L = 40;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 20;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const values = data.map(d => d.gapPct);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  const range = Math.max(maxVal - minVal, 1);

  const points = data.map((d, i) => ({
    x: PAD_L + (i / Math.max(data.length - 1, 1)) * chartW,
    y: PAD_T + chartH - ((d.gapPct - minVal) / range) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Zero line
  const zeroY = PAD_T + chartH - ((0 - minVal) / range) * chartH;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-3 h-[2px] rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400">{competitorName}</span>
        <span className={`text-[9px] font-bold ${data[data.length - 1].gapPct <= 0 ? 'text-[#1ED4A7]' : 'text-rose-500'}`}>
          {data[data.length - 1].gapPct <= 0 ? `${Math.abs(data[data.length - 1].gapPct)}% ahead` : `${data[data.length - 1].gapPct}% behind`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }} preserveAspectRatio="xMidYMid meet">
        {/* Zero line */}
        {minVal <= 0 && maxVal >= 0 && (
          <line x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="4 3" />
        )}
        {/* Y-axis labels */}
        {[0, 1, 2].map(i => {
          const val = minVal + (range * (2 - i)) / 2;
          const y = PAD_T + (i / 2) * chartH;
          return <text key={i} x={PAD_L - 6} y={y + 3} fill="#71717a" fontSize={8} textAnchor="end" fontFamily="system-ui">{Math.round(val)}%</text>;
        })}
        {/* X-axis labels */}
        {[data[0], data[Math.floor(data.length / 2)], data[data.length - 1]].map((d, i) => {
          if (!d) return null;
          const idx = data.indexOf(d);
          const x = PAD_L + (idx / Math.max(data.length - 1, 1)) * chartW;
          return <text key={i} x={x} y={H - 4} fill="#71717a" fontSize={8} textAnchor="middle" fontFamily="system-ui">{d.date.slice(5)}</text>;
        })}
        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots at start/end */}
        <circle cx={points[0].x} cy={points[0].y} r={3} fill={color} stroke="#09090b" strokeWidth={1.5} />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={color} stroke="#09090b" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ─── Main Report Component ───────────────────────────────────────────

export function CompetitiveReport({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const printRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [ownAccounts, setOwnAccounts] = useState<TrackedAccount[]>([]);
  const [competitorAccounts, setCompetitorAccounts] = useState<TrackedAccount[]>([]);
  const [gapHistory, setGapHistory] = useState<GapSnapshot[]>([]);
  const [alerts, setAlerts] = useState<CompetitorAlert[]>([]);
  const [generatedAt, setGeneratedAt] = useState('');

  // Digest settings
  const [digestPrefs, setDigestPrefs] = useState<DigestPrefs>({ frequency: 'off' });
  const [showDigestSettings, setShowDigestSettings] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [savingDigest, setSavingDigest] = useState(false);
  const [digestEmail, setDigestEmail] = useState('');

  const COMPETITOR_COLORS = ['#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

  useEffect(() => {
    const load = async () => {
      if (isDemoMode) {
        const own: TrackedAccount[] = [
          { id: 'own_ig', platform: 'instagram', handle: 'contndrHQ', displayName: 'Contndr', profileType: 'own', latestMetrics: { followers: 12_400, views: 89_000, likes: 4_200, posts: 156 } },
          { id: 'own_li', platform: 'linkedin', handle: 'contndr', displayName: 'Contndr', profileType: 'own', latestMetrics: { followers: 8_700, views: 45_000, likes: 0, posts: 92 } },
        ];
        const comp: TrackedAccount[] = [
          { id: 'comp_ig', platform: 'instagram', handle: 'apolloio', displayName: 'Apollo.io', profileType: 'competitor', latestMetrics: { followers: 45_600, views: 320_000, likes: 18_900, posts: 480 } },
          { id: 'comp_li', platform: 'linkedin', handle: 'outreach-io', displayName: 'Outreach', profileType: 'competitor', latestMetrics: { followers: 112_000, views: 890_000, likes: 0, posts: 720 } },
          { id: 'comp_tw', platform: 'twitter', handle: 'lemaborhia', displayName: 'Lemlist', profileType: 'competitor', latestMetrics: { followers: 28_300, views: 0, likes: 9_400, posts: 340 } },
        ];
        // Generate demo gap history
        const demoGaps: GapSnapshot[] = [];
        for (let i = 29; i >= 0; i--) {
          const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          demoGaps.push({
            date,
            gaps: comp.map(c => ({
              competitorId: c.id,
              competitorName: c.displayName || c.handle,
              competitorHandle: c.handle,
              platform: c.platform,
              gapPct: Math.round(((c.latestMetrics!.followers * (1 + (i - 15) * 0.008)) - 12400) / 12400 * 100),
              ownFollowers: Math.round(12400 * (1 - i * 0.005)),
              compFollowers: Math.round(c.latestMetrics!.followers * (1 + (i - 15) * 0.008)),
            })),
          });
        }
        setOwnAccounts(own);
        setCompetitorAccounts(comp);
        setGapHistory(demoGaps);
        setAlerts([
          { id: 'a1', type: 'overtake', competitorName: 'Apollo.io', competitorHandle: 'apolloio', platform: 'instagram', metric: 'followers', competitorValue: 45_600, yourValue: 12_400, timestamp: new Date(Date.now() - 3600000 * 4).toISOString(), dismissed: false },
          { id: 'a2', type: 'milestone', competitorName: 'Outreach', competitorHandle: 'outreach-io', platform: 'linkedin', metric: 'followers', competitorValue: 112_000, milestone: 100_000, timestamp: new Date(Date.now() - 86400000).toISOString(), dismissed: false },
        ]);
        setGeneratedAt(new Date().toISOString());
        setLoading(false);
        return;
      }

      try {
        const headers = await getAuthHeaders();
        if (!headers.Authorization) { setLoading(false); return; }
        const [reportRes, prefsRes] = await Promise.all([
          fetch(`${TRACKER_API}/report-data`, { headers }),
          fetch(`${TRACKER_API}/digest/preferences`, { headers }).catch(() => null),
        ]);
        if (reportRes.ok) {
          const data = await reportRes.json();
          setOwnAccounts(data.ownAccounts || []);
          setCompetitorAccounts(data.competitorAccounts || []);
          setGapHistory(data.gapHistory || []);
          setAlerts(data.alerts || []);
          setGeneratedAt(data.generatedAt || new Date().toISOString());
        }
        if (prefsRes?.ok) {
          const prefsData = await prefsRes.json();
          setDigestPrefs(prefsData.preferences || { frequency: 'off' });
          setDigestEmail(prefsData.preferences?.email || '');
        }
      } catch (err) {
        console.error('[REPORT] Load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isDemoMode]);

  const handlePrint = () => {
    window.print();
  };

  const handleSendDigest = async () => {
    if (isDemoMode) { toast.success(t('socialHub.report.digestSentDemo', 'Demo: Digest email would be sent')); return; }
    setSendingDigest(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${TRACKER_API}/digest/send`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send digest');
      toast.success(data.message || t('socialHub.report.digestSent', 'Digest sent!'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSendingDigest(false);
    }
  };

  const handleSaveDigestPrefs = async () => {
    if (isDemoMode) { toast.success(t('socialHub.report.prefsSavedDemo', 'Demo: Preferences saved')); setShowDigestSettings(false); return; }
    setSavingDigest(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${TRACKER_API}/digest/preferences`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ frequency: digestPrefs.frequency, email: digestEmail }),
      });
      if (!res.ok) throw new Error('Failed to save preferences');
      toast.success(t('socialHub.report.prefsSaved', 'Digest preferences saved'));
      setShowDigestSettings(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingDigest(false);
    }
  };

  // Calculate gaps
  const gapData = useMemo(() => {
    const ownByPlatform: Record<string, number> = {};
    let totalOwn = 0;
    for (const a of ownAccounts) {
      const f = a.latestMetrics?.followers || 0;
      ownByPlatform[a.platform] = (ownByPlatform[a.platform] || 0) + f;
      totalOwn += f;
    }
    return competitorAccounts.map(comp => {
      const compF = comp.latestMetrics?.followers || 0;
      const ownF = ownByPlatform[comp.platform] || totalOwn;
      const gap = ownF > 0 ? Math.round(((compF - ownF) / ownF) * 100) : (compF > 0 ? 100 : 0);
      return { ...comp, ownF, compF: compF, gap };
    }).sort((a, b) => b.gap - a.gap);
  }, [ownAccounts, competitorAccounts]);

  const totalOwnFollowers = ownAccounts.reduce((s, a) => s + (a.latestMetrics?.followers || 0), 0);
  const totalCompFollowers = competitorAccounts.reduce((s, a) => s + (a.latestMetrics?.followers || 0), 0);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
        <div className="bg-white dark:bg-[#111] rounded-2xl p-8">
          <Loader2 className="w-6 h-6 text-zinc-500 animate-spin mx-auto" />
          <p className="text-xs text-zinc-500 mt-3">{t('socialHub.report.loading', 'Generating report...')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <div className="bg-white dark:bg-[#0A0A0A] rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 w-full max-w-4xl max-h-[90vh] overflow-y-auto print:max-h-none print:overflow-visible print:border-0 print:rounded-none print:max-w-none" ref={printRef}>
        {/* Header — hidden in print */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 print:hidden">
          <div className="flex items-center gap-3">
            <Swords className="w-5 h-5 text-rose-500" />
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-white">{t('socialHub.report.title', 'Competitive Intelligence Report')}</h2>
              <p className="text-[11px] text-zinc-500">{t('socialHub.report.generated', 'Generated {{date}}', { date: new Date(generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowDigestSettings(!showDigestSettings)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 transition-colors">
              <Mail className="w-3.5 h-3.5" /> {t('socialHub.report.digest', 'Digest')} <ChevronDown className="w-3 h-3" />
            </button>
            <button onClick={handleSendDigest} disabled={sendingDigest} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 transition-colors disabled:opacity-40">
              {sendingDigest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t('socialHub.report.sendNow', 'Send Now')}
            </button>
            <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors">
              <Printer className="w-3.5 h-3.5" /> {t('socialHub.report.exportPdf', 'Export PDF')}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Digest Settings Dropdown */}
        {showDigestSettings && (
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 print:hidden">
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-white mb-3">{t('socialHub.report.digestSettings', 'Email Digest Settings')}</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-[10px] text-zinc-500 font-medium mb-1">{t('socialHub.report.frequency', 'Frequency')}</label>
                <div className="flex items-center gap-1">
                  {(['off', 'daily', 'weekly'] as const).map(freq => (
                    <button key={freq} onClick={() => setDigestPrefs(p => ({ ...p, frequency: freq }))}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                        digestPrefs.frequency === freq
                          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                          : 'text-zinc-500 border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                      }`}>
                      {t(`socialHub.report.freq.${freq}`, freq === 'off' ? 'Off' : freq === 'daily' ? 'Daily' : 'Weekly')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[10px] text-zinc-500 font-medium mb-1">{t('socialHub.report.email', 'Email')}</label>
                <input type="email" value={digestEmail} onChange={(e) => setDigestEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-3 py-1.5 rounded-lg text-[11px] bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:ring-1 focus:ring-zinc-400 outline-none"
                />
              </div>
              <button onClick={handleSaveDigestPrefs} disabled={savingDigest}
                className="px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors disabled:opacity-40">
                {savingDigest ? <Loader2 className="w-3 h-3 animate-spin" /> : t('socialHub.report.save', 'Save')}
              </button>
            </div>
            {digestPrefs.lastSentAt && (
              <p className="text-[10px] text-zinc-500 mt-2">{t('socialHub.report.lastSent', 'Last sent: {{date}}', { date: new Date(digestPrefs.lastSentAt).toLocaleString() })}</p>
            )}
          </div>
        )}

        {/* Report Content */}
        <div className="p-4 sm:p-6 space-y-6">
          {/* Print header */}
          <div className="hidden print:block text-center mb-6">
            <h1 className="text-2xl font-bold text-black">Competitive Intelligence Report</h1>
            <p className="text-sm text-gray-500">Contndr · Generated {new Date(generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-4 text-center">
              <Shield className="w-5 h-5 text-[#1ED4A7] mx-auto mb-2" />
              <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{t('socialHub.report.yourProfiles', 'Your Profiles')}</div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{ownAccounts.length}</div>
            </div>
            <div className="rounded-xl border border-rose-500/15 p-4 text-center">
              <Swords className="w-5 h-5 text-rose-500 mx-auto mb-2" />
              <div className="text-[10px] text-rose-500/70 font-semibold uppercase tracking-wider">{t('socialHub.report.competitors', 'Competitors')}</div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{competitorAccounts.length}</div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-4 text-center">
              <Users className="w-5 h-5 text-[#1ED4A7] mx-auto mb-2" />
              <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{t('socialHub.report.yourFollowers', 'Your Followers')}</div>
              <div className="text-2xl font-bold text-[#1ED4A7] mt-1">{compactNum(totalOwnFollowers)}</div>
            </div>
            <div className="rounded-xl border border-rose-500/15 p-4 text-center">
              <Users className="w-5 h-5 text-rose-500 mx-auto mb-2" />
              <div className="text-[10px] text-rose-500/70 font-semibold uppercase tracking-wider">{t('socialHub.report.theirFollowers', 'Their Followers')}</div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{compactNum(totalCompFollowers)}</div>
            </div>
          </div>

          {/* Alerts */}
          {alerts.filter(a => !a.dismissed).length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 text-red-500" />
                <h3 className="text-xs font-semibold text-zinc-900 dark:text-white">{t('socialHub.report.recentAlerts', 'Recent Alerts')}</h3>
              </div>
              <div className="space-y-2">
                {alerts.filter(a => !a.dismissed).slice(0, 5).map(alert => (
                  <div key={alert.id} className={`flex items-start gap-2 p-2.5 rounded-lg text-[11px] ${
                    alert.type === 'overtake' ? 'bg-red-500/5 border border-red-500/15 text-red-500' : 'bg-amber-500/5 border border-amber-500/15 text-amber-500'
                  }`}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <strong>{alert.competitorName}</strong>{' '}
                      {alert.type === 'overtake'
                        ? `overtook you on ${alert.metric} — ${compactNum(alert.competitorValue)} vs ${compactNum(alert.yourValue || 0)}`
                        : `hit ${compactNum(alert.milestone || 0)} ${alert.metric}`
                      }
                      <span className="text-zinc-500 ml-2">{new Date(alert.timestamp).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gap Analysis Table */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Swords className="w-4 h-4 text-rose-500" />
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('socialHub.report.gapAnalysis', 'Competitive Gap Analysis')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b-2 border-zinc-200 dark:border-zinc-200 dark:border-zinc-800">
                    <th className="text-left py-2 px-3 text-zinc-500 font-semibold uppercase tracking-wider text-[9px]">{t('socialHub.report.competitor', 'Competitor')}</th>
                    <th className="text-left py-2 px-3 text-zinc-500 font-semibold uppercase tracking-wider text-[9px]">{t('socialHub.report.platform', 'Platform')}</th>
                    <th className="text-right py-2 px-3 text-zinc-500 font-semibold uppercase tracking-wider text-[9px]">{t('socialHub.report.you', 'You')}</th>
                    <th className="text-right py-2 px-3 text-zinc-500 font-semibold uppercase tracking-wider text-[9px]">{t('socialHub.report.them', 'Them')}</th>
                    <th className="text-right py-2 px-3 text-zinc-500 font-semibold uppercase tracking-wider text-[9px]">{t('socialHub.report.gap', 'Gap')}</th>
                    <th className="py-2 px-3 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {gapData.map(row => (
                    <tr key={row.id} className="border-b border-zinc-100 dark:border-white/[0.03]">
                      <td className="py-2.5 px-3 font-medium text-zinc-900 dark:text-white">{row.displayName || row.handle}</td>
                      <td className="py-2.5 px-3 text-zinc-500 capitalize">{row.platform}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-[#1ED4A7]">{compactNum(row.ownF)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-rose-500">{compactNum(row.compF)}</td>
                      <td className={`py-2.5 px-3 text-right font-bold ${row.gap <= 0 ? 'text-[#1ED4A7]' : 'text-rose-500'}`}>
                        {row.gap <= 0 ? `${Math.abs(row.gap)}% ahead` : `${row.gap}% behind`}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden flex">
                          <div className="h-full bg-[#1ED4A7]" style={{ width: `${(row.ownF / Math.max(row.ownF + row.compF, 1)) * 100}%` }} />
                          <div className="h-full bg-rose-500" style={{ width: `${(row.compF / Math.max(row.ownF + row.compF, 1)) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Gap Trend Charts */}
          {gapHistory.length >= 2 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-zinc-500" />
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('socialHub.report.gapTrends', 'Gap Trends (Last 30 Days)')}</h3>
              </div>
              <p className="text-[10px] text-zinc-500 mb-4">{t('socialHub.report.gapTrendsDesc', 'Positive = behind competitor, Negative = ahead. Track if you are catching up or falling behind.')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {competitorAccounts.map((comp, idx) => (
                  <GapTrendChart
                    key={comp.id}
                    gapHistory={gapHistory}
                    competitorId={comp.id}
                    competitorName={comp.displayName || comp.handle}
                    color={COMPETITOR_COLORS[idx % COMPETITOR_COLORS.length]}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CompetitiveReport;