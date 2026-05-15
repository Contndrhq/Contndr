import { useState, useEffect, useMemo } from 'react';
import {
  Users, Trophy, Target, Mail, CalendarCheck, DollarSign,
  TrendingUp, RefreshCcw, MailOpen, MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from '../lib/auth';
import { apiCache } from '../lib/api-cache';
import { LoadingSpinner } from './LoadingSpinner';
import { supabase } from '../lib/supabase';
import { useDemoMode, DEMO_TEAM_MEMBERS as DEMO_TEAM_MEMBERS_CTX } from './DemoContext';
import { useTranslation } from 'react-i18next';

// ── Types ──────────────────────────────────────────────────────────

interface MemberStats {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  is_you: boolean;
  leads: number;
  leads_this_month: number;
  emails_sent: number;
  emails_opened: number;
  emails_clicked: number;
  open_rate: number;
  click_rate: number;
  replies: number;
  meetings: number;
  pipeline: number;
  campaigns: number;
  revenue: number;
  conversions: number;
}

interface TeamTotals {
  leads: number;
  leads_this_month: number;
  emails_sent: number;
  emails_opened: number;
  emails_clicked: number;
  replies: number;
  meetings: number;
  pipeline: number;
  campaigns: number;
  revenue: number;
  conversions: number;
  open_rate: number;
  click_rate: number;
}

type SortMetric = 'leads' | 'emails_sent' | 'open_rate' | 'replies' | 'meetings' | 'pipeline' | 'revenue' | 'conversions';

// Column definitions for the table — labels/shortLabels are i18n keys resolved at render time
const COLUMNS: { key: SortMetric; labelKey: string; shortLabelKey: string; icon: React.ElementType; color: string; format: (v: number) => string; hideBelow?: string }[] = [
  { key: 'leads',       labelKey: 'teamLeaderboard.colLeads',     shortLabelKey: 'teamLeaderboard.colLeads',    icon: Target,        color: '#1ED4A7', format: (v) => v.toLocaleString() },
  { key: 'emails_sent', labelKey: 'teamLeaderboard.colEmails',    shortLabelKey: 'teamLeaderboard.colEmails',   icon: Mail,          color: '#60A5FA', format: (v) => v.toLocaleString() },
  { key: 'open_rate',   labelKey: 'teamLeaderboard.colOpenRate',  shortLabelKey: 'teamLeaderboard.colOpenPct',  icon: MailOpen,      color: '#38BDF8', format: (v) => `${v}%`,            hideBelow: 'xl' },
  { key: 'replies',     labelKey: 'teamLeaderboard.colReplies',   shortLabelKey: 'teamLeaderboard.colReplies',  icon: MessageSquare, color: '#FB923C', format: (v) => v.toLocaleString(), hideBelow: 'xl' },
  { key: 'meetings',    labelKey: 'teamLeaderboard.colMeetings',  shortLabelKey: 'teamLeaderboard.colMtgs',     icon: CalendarCheck, color: '#A78BFA', format: (v) => v.toLocaleString() },
  { key: 'pipeline',    labelKey: 'teamLeaderboard.colPipeline',  shortLabelKey: 'teamLeaderboard.colPipeline', icon: TrendingUp,    color: '#F59E0B', format: (v) => v.toLocaleString(), hideBelow: '2xl' },
  { key: 'conversions', labelKey: 'teamLeaderboard.colDeals',     shortLabelKey: 'teamLeaderboard.colDeals',    icon: TrendingUp,    color: '#34D399', format: (v) => v.toLocaleString() },
  { key: 'revenue',     labelKey: 'teamLeaderboard.colRevenue',   shortLabelKey: 'teamLeaderboard.colRev',      icon: DollarSign,    color: '#34D399', format: (v) => v > 0 ? `$${v.toLocaleString()}` : '—' },
];

// Responsive visibility classes for columns
function colVisibility(col: typeof COLUMNS[number]) {
  if (!col.hideBelow) return 'hidden lg:table-cell';
  if (col.hideBelow === 'xl') return 'hidden xl:table-cell';
  if (col.hideBelow === '2xl') return 'hidden 2xl:table-cell';
  return 'hidden lg:table-cell';
}

// ── Demo data (demo@contndr.com only) ──────────────────────────────

const DEMO_MEMBERS: MemberStats[] = [
  {
    id: 'demo-1', name: 'Or Briga', email: 'or@contndr.com', avatar_url: null, is_you: true,
    leads: 847, leads_this_month: 134, emails_sent: 3842, emails_opened: 1729, emails_clicked: 461,
    open_rate: 45.0, click_rate: 12.0, replies: 312, meetings: 48, pipeline: 156, campaigns: 14, revenue: 84200, conversions: 156,
  },
  {
    id: 'demo-2', name: 'Sarah Chen', email: 'sarah@contndr.com', avatar_url: null, is_you: false,
    leads: 623, leads_this_month: 97, emails_sent: 2915, emails_opened: 1370, emails_clicked: 321,
    open_rate: 47.0, click_rate: 11.0, replies: 248, meetings: 37, pipeline: 118, campaigns: 11, revenue: 62400, conversions: 118,
  },
  {
    id: 'demo-3', name: 'Jake Morrison', email: 'jake@contndr.com', avatar_url: null, is_you: false,
    leads: 531, leads_this_month: 82, emails_sent: 2480, emails_opened: 1042, emails_clicked: 248,
    open_rate: 42.0, click_rate: 10.0, replies: 196, meetings: 29, pipeline: 94, campaigns: 9, revenue: 41800, conversions: 94,
  },
  {
    id: 'demo-4', name: 'Maya Patel', email: 'maya@contndr.com', avatar_url: null, is_you: false,
    leads: 412, leads_this_month: 68, emails_sent: 1956, emails_opened: 860, emails_clicked: 195,
    open_rate: 44.0, click_rate: 10.0, replies: 158, meetings: 22, pipeline: 73, campaigns: 7, revenue: 29500, conversions: 73,
  },
  {
    id: 'demo-5', name: 'Liam Foster', email: 'liam@contndr.com', avatar_url: null, is_you: false,
    leads: 289, leads_this_month: 41, emails_sent: 1340, emails_opened: 536, emails_clicked: 121,
    open_rate: 40.0, click_rate: 9.0, replies: 104, meetings: 14, pipeline: 48, campaigns: 5, revenue: 17600, conversions: 48,
  },
];

function buildDemoTotals(m: MemberStats[]): TeamTotals {
  const t = {
    leads: m.reduce((s, x) => s + x.leads, 0),
    leads_this_month: m.reduce((s, x) => s + x.leads_this_month, 0),
    emails_sent: m.reduce((s, x) => s + x.emails_sent, 0),
    emails_opened: m.reduce((s, x) => s + x.emails_opened, 0),
    emails_clicked: m.reduce((s, x) => s + x.emails_clicked, 0),
    replies: m.reduce((s, x) => s + x.replies, 0),
    meetings: m.reduce((s, x) => s + x.meetings, 0),
    pipeline: m.reduce((s, x) => s + x.pipeline, 0),
    campaigns: m.reduce((s, x) => s + x.campaigns, 0),
    revenue: m.reduce((s, x) => s + x.revenue, 0),
    conversions: m.reduce((s, x) => s + x.conversions, 0),
    open_rate: 0,
    click_rate: 0,
  };
  t.open_rate = t.emails_sent > 0 ? Number(((t.emails_opened / t.emails_sent) * 100).toFixed(1)) : 0;
  t.click_rate = t.emails_sent > 0 ? Number(((t.emails_clicked / t.emails_sent) * 100).toFixed(1)) : 0;
  return t;
}

// ── Avatar ─────────────────────────────────────────────────────────

function MemberAvatar({ name, avatarUrl, size = 32 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const [imgError, setImgError] = useState(false);

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className="rounded-full bg-zinc-200 dark:bg-white/[0.08] flex items-center justify-center text-zinc-500 dark:text-zinc-400 font-semibold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

function TeamLeaderboard() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [members, setMembers] = useState<MemberStats[]>([]);
  const [totals, setTotals] = useState<TeamTotals | null>(null);
  const [teamSize, setTeamSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortMetric>('revenue');
  const [isDemoAccount, setIsDemoAccount] = useState(false);

  // Check if demo account and seed demo data if backend returns solo/empty
  function seedDemoData() {
    console.log('[DEMO] Seeding demo team leaderboard data');
    setMembers(DEMO_MEMBERS);
    setTotals(buildDemoTotals(DEMO_MEMBERS));
    setTeamSize(DEMO_MEMBERS.length);
    setIsDemoAccount(true);
  }

  async function loadLeaderboard(forceRefresh = false) {
    try {
      if (forceRefresh) {
        setRefreshing(true);
        apiCache.invalidate('team:leaderboard');
        apiCache.invalidate('sales:leaderboard');
      } else {
        setLoading(true);
      }

      // Sandbox demo mode — use DemoContext data, skip API
      if (isDemoMode) {
        seedDemoData();
        return;
      }

      // Check if demo account
      let isDemo = false;
      let currentUserEmail = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
        currentUserEmail = session?.user?.email || '';
      } catch (_) { /* non-fatal */ }

      // Demo account ALWAYS gets demo data - never fetch real team data
      if (isDemo) {
        seedDemoData();
        return;
      }

      // Fetch team leaderboard + sales leaderboard in parallel
      const [teamData, salesData] = await Promise.all([
        apiCache.fetch(
          'team:leaderboard',
          async () => {
            const res = await authenticatedFetch(
              `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/leaderboard`
            );
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: 'Failed to load leaderboard' }));
              throw new Error(err.error || 'Failed to load leaderboard');
            }
            return res.json();
          },
          { staleTime: 120_000, cacheTime: 600_000 }
        ),
        apiCache.fetch(
          'sales:leaderboard',
          async () => {
            try {
              const res = await authenticatedFetch(
                `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/sales-leaderboard`
              );
              if (!res.ok) return { leaderboard: [] };
              return res.json();
            } catch {
              return { leaderboard: [] };
            }
          },
          { staleTime: 120_000, cacheTime: 600_000 }
        ),
      ]);

      // Build a revenue lookup from sales leaderboard
      const salesByEmail: Record<string, { revenue: number; conversions: number; name: string }> = {};
      if (salesData?.leaderboard) {
        for (const rep of salesData.leaderboard) {
          salesByEmail[rep.email.toLowerCase()] = {
            revenue: rep.revenue || 0,
            conversions: rep.conversions || 0,
            name: rep.name,
          };
        }
      }

      // Merge: overlay sales revenue onto existing team members ONLY.
      // Never inject rows from the sales leaderboard — it may contain users from
      // other workspaces / the broader Contndr platform, which would pollute the
      // team view with members who don't belong to this workspace.
      const mergedMembers: MemberStats[] = (teamData.members || []).map((m: any) => {
        const email = (m.email || '').toLowerCase();
        const sales = salesByEmail[email];
        return {
          ...m,
          revenue: sales ? Math.max(sales.revenue, m.revenue || 0) : (m.revenue || 0),
          conversions: sales ? Math.max(sales.conversions, m.conversions || 0) : (m.conversions || 0),
        };
      });

      setMembers(mergedMembers);

      // Recalculate totals with merged revenue
      const baseTotals = teamData.team_totals || {
        leads: 0, leads_this_month: 0, emails_sent: 0, emails_opened: 0,
        emails_clicked: 0, replies: 0, meetings: 0, pipeline: 0,
        campaigns: 0, revenue: 0, conversions: 0, open_rate: 0, click_rate: 0,
      };
      baseTotals.revenue = mergedMembers.reduce((s: number, m: MemberStats) => s + (m.revenue || 0), 0);
      baseTotals.conversions = mergedMembers.reduce((s: number, m: MemberStats) => s + (m.conversions || 0), 0);
      setTotals(baseTotals);
      setTeamSize(Math.max(teamData.team_size || 0, mergedMembers.length));
    } catch (err: any) {
      console.error('[TEAM LEADERBOARD] Error:', err);
      // If demo account and API failed, still seed demo data
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email === 'demo@contndr.com') {
          seedDemoData();
          return;
        }
      } catch (_) { /* non-fatal */ }
      toast.error(err.message || 'Failed to load team leaderboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { loadLeaderboard(); }, []);

  const sorted = useMemo(() => {
    return [...members].sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }, [members, sortBy]);

  // For mobile bar
  const maxVal = useMemo(() => {
    if (sorted.length === 0) return 1;
    return Math.max(...sorted.map(m => m[sortBy] || 0)) || 1;
  }, [sorted, sortBy]);

  const activeCol = COLUMNS.find(c => c.key === sortBy)!;

  // ── Solo / no-team empty state ────────────────────────────────
  // Only show empty state if there are truly no members to display
  // (solo users still see their own stats as a personal dashboard)
  if (!loading && members.length === 0 && teamSize <= 1) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 py-20">
        <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-5">
          <Users className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1.5">
          {t('teamLeaderboard.inviteYourTeam')}
        </h2>
        <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center max-w-sm leading-relaxed">
          {t('teamLeaderboard.inviteDescription')}
        </p>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full px-4 sm:px-6 lg:px-8 py-6 lg:py-8">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
            {teamSize <= 1 ? t('teamLeaderboard.yourStats') : t('teamLeaderboard.teamTitle')}
          </h1>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
            {teamSize <= 1 ? t('teamLeaderboard.personalPerformance') : t('teamLeaderboard.membersCount', { count: teamSize })}
          </p>
        </div>
        <button
          onClick={() => loadLeaderboard(true)}
          disabled={refreshing}
          className="p-2 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.05] transition-colors disabled:opacity-40"
          aria-label={t('teamLeaderboard.refresh')}
        >
          <RefreshCcw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Summary strip ──────────────────────────────────────── */}
      {totals && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-px rounded-xl overflow-hidden border border-zinc-200/80 dark:border-zinc-200 dark:border-zinc-800 bg-zinc-200/80 dark:bg-zinc-100 dark:bg-zinc-900 mb-8">
          {([
            { labelKey: 'teamLeaderboard.colLeads',    value: totals.leads.toLocaleString() },
            { labelKey: 'teamLeaderboard.colEmails',   value: totals.emails_sent.toLocaleString() },
            { labelKey: 'teamLeaderboard.colOpenRate',  value: `${totals.open_rate}%` },
            { labelKey: 'teamLeaderboard.colReplies',  value: totals.replies.toLocaleString() },
            { labelKey: 'teamLeaderboard.colDeals',    value: (totals.conversions || 0).toLocaleString() },
            { labelKey: 'teamLeaderboard.colRevenue',  value: totals.revenue > 0 ? `$${totals.revenue.toLocaleString()}` : '$0' },
          ] as const).map((s, i) => (
            <div
              key={s.labelKey}
              className={`bg-white dark:bg-[#0a0a0a] px-3 py-3 sm:px-4 sm:py-3.5 text-center ${i >= 3 ? 'hidden sm:block' : ''}`}
            >
              <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white tabular-nums leading-none">
                {s.value}
              </div>
              <div className="text-[10px] sm:text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 uppercase tracking-wider font-medium">
                {t(s.labelKey)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Mobile sort label ───────────────────────────────────── */}
      <div className="lg:hidden flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">
          {t('teamLeaderboard.sortedBy', { metric: t(activeCol.labelKey) })}
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════════
           DESKTOP TABLE (lg+)
         ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200/60 dark:border-zinc-200 dark:border-zinc-800">
              <th className="w-10 pb-3 text-left">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-300 dark:text-zinc-600">#</span>
              </th>
              <th className="pb-3 text-left">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">{t('teamLeaderboard.member')}</span>
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`pb-3 text-right cursor-pointer select-none group/th ${colVisibility(col)}`}
                  onClick={() => setSortBy(col.key)}
                >
                  <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                    sortBy === col.key
                      ? 'text-zinc-900 dark:text-white'
                      : 'text-zinc-400 dark:text-zinc-500 group-hover/th:text-zinc-600 dark:group-hover/th:text-zinc-300'
                  }`}>
                    {t(col.shortLabelKey)}
                    {sortBy === col.key && (
                      <span className="inline-block w-1 h-1 rounded-full ml-0.5" style={{ backgroundColor: col.color }} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((member, idx) => {
              const rank = idx + 1;
              return (
                <tr
                  key={member.id}
                  className={`border-b border-zinc-100/60 dark:border-white/[0.03] transition-colors ${
                    member.is_you
                      ? 'bg-[#1ED4A7]/[0.03]'
                      : 'hover:bg-zinc-50 dark:hover:bg-white/[0.015]'
                  }`}
                >
                  {/* Rank */}
                  <td className="py-3.5 pr-2">
                    <span className={`text-xs font-bold tabular-nums ${
                      rank === 1 ? 'text-amber-500' :
                      rank === 2 ? 'text-zinc-400' :
                      rank === 3 ? 'text-amber-700 dark:text-amber-600' :
                      'text-zinc-300 dark:text-zinc-600'
                    }`}>
                      {rank}
                    </span>
                  </td>

                  {/* Member */}
                  <td className="py-3.5 pr-4">
                    <div className="flex items-center gap-3">
                      <MemberAvatar name={member.name} avatarUrl={member.avatar_url} size={30} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                            {member.name}
                          </span>
                          {member.is_you && (
                            <span className="px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-[#1ED4A7] bg-[#1ED4A7]/10 rounded flex-shrink-0">
                              {t('teamLeaderboard.you')}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate block">
                          {member.email}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Stat columns */}
                  {COLUMNS.map((col) => {
                    const val = member[col.key] || 0;
                    const isActive = sortBy === col.key;
                    return (
                      <td
                        key={col.key}
                        className={`py-3.5 text-right tabular-nums ${colVisibility(col)}`}
                      >
                        <span className={`text-sm font-medium ${
                          isActive
                            ? 'text-zinc-900 dark:text-white font-semibold'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}>
                          {col.format(val)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ═══════════════════════════════════════════════════════════
           MOBILE / TABLET CARDS (< lg)
         ═══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden space-y-1">
        {sorted.map((member, idx) => {
          const rank = idx + 1;
          const val = member[sortBy] || 0;
          const pct = maxVal > 0 ? Math.max((val / maxVal) * 100, 3) : 3;

          return (
            <div
              key={member.id}
              className={`rounded-xl px-3.5 py-3 transition-colors ${
                member.is_you
                  ? 'bg-[#1ED4A7]/[0.04] dark:bg-[#1ED4A7]/[0.03]'
                  : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Rank */}
                <span className={`w-5 text-center text-xs font-bold tabular-nums flex-shrink-0 ${
                  rank === 1 ? 'text-amber-500' :
                  rank === 2 ? 'text-zinc-400' :
                  rank === 3 ? 'text-amber-700 dark:text-amber-600' :
                  'text-zinc-300 dark:text-zinc-600'
                }`}>
                  {rank}
                </span>

                {/* Avatar */}
                <MemberAvatar name={member.name} avatarUrl={member.avatar_url} size={32} />

                {/* Name */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                      {member.name}
                    </span>
                    {member.is_you && (
                      <span className="px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-[#1ED4A7] bg-[#1ED4A7]/10 rounded flex-shrink-0">
                        {t('teamLeaderboard.you')}
                      </span>
                    )}
                  </div>
                  {/* Bar */}
                  <div className="mt-1.5 h-1 bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${pct}%`, backgroundColor: activeCol.color, opacity: 0.5 }}
                    />
                  </div>
                </div>

                {/* Value */}
                <span className="text-sm font-semibold text-zinc-900 dark:text-white tabular-nums ml-2 whitespace-nowrap">
                  {activeCol.format(val)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Empty data state ────────────────────────────────────── */}
      {sorted.length === 0 && !loading && (
        <div className="text-center py-16">
          <Trophy className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
          <p className="text-sm text-zinc-400 dark:text-zinc-500">{t('teamLeaderboard.noDataYet')}</p>
        </div>
      )}

      <div className="h-8" />
    </div>
  );
}

export default TeamLeaderboard;