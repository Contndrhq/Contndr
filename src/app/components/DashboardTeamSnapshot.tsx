import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Trophy, ArrowUpRight, Loader2, Flame, Mail, MailOpen, MousePointerClick, MailCheck, TrendingUp, Zap, Eye } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { supabase } from '../lib/supabase';
import { DashboardSoloSidebar } from './DashboardSoloSidebar';
import { useDemoMode } from './DemoContext';

interface MemberSnap {
  id: string;
  name: string;
  is_you: boolean;
  leads: number;
  emails_sent: number;
  replies: number;
  meetings: number;
  revenue: number;
  deal_count: number;
  pipeline_value: number;
}

// Demo data for demo@contndr.com
const DEMO_MEMBERS: MemberSnap[] = [
  { id: 'd1', name: 'Or Briga', is_you: true, leads: 847, emails_sent: 3842, replies: 312, meetings: 48, revenue: 84200, deal_count: 12, pipeline_value: 156000 },
  { id: 'd2', name: 'Sarah Chen', is_you: false, leads: 623, emails_sent: 2915, replies: 248, meetings: 37, revenue: 62400, deal_count: 9, pipeline_value: 118000 },
  { id: 'd3', name: 'Jake Morrison', is_you: false, leads: 531, emails_sent: 2480, replies: 196, meetings: 29, revenue: 41800, deal_count: 7, pipeline_value: 89000 },
  { id: 'd4', name: 'Maya Patel', is_you: false, leads: 412, emails_sent: 1956, replies: 158, meetings: 22, revenue: 29500, deal_count: 5, pipeline_value: 64000 },
  { id: 'd5', name: 'Liam Foster', is_you: false, leads: 289, emails_sent: 1340, replies: 104, meetings: 14, revenue: 17600, deal_count: 3, pipeline_value: 38000 },
];

function MemberAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded-full bg-zinc-200 dark:bg-white/[0.08] flex items-center justify-center text-zinc-500 dark:text-zinc-400 font-semibold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

export function DashboardTeamSnapshot({ onNavigate, stats }: { onNavigate: (view: string) => void; stats?: { totalCampaigns: number; emailsSent: number; emailsOpened: number; emailsClicked: number; openRate: number; clickRate: number; deliveryRate: number; emailsDelivered: number } }) {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const [members, setMembers] = useState<MemberSnap[]>(isDemoMode ? DEMO_MEMBERS : []);
  const [teamSize, setTeamSize] = useState(isDemoMode ? DEMO_MEMBERS.length : 0);
  const [loading, setLoading] = useState(isDemoMode ? false : true);

  useEffect(() => {
    if (isDemoMode) return; // Skip loading in demo mode
    loadTeam();
  }, [isDemoMode]);

  async function loadTeam() {
    try {
      // Check current session and scope cache per user. The previous global
      // dashboard:team-snapshot key could leak a solo/team state between accounts.
      let isDemo = false;
      let sessionUserId = 'anonymous';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
        sessionUserId = session?.user?.id || sessionUserId;
      } catch (_) {}

      // Demo account ALWAYS gets demo data - never fetch real team data
      if (isDemo) {
        setMembers(DEMO_MEMBERS);
        setTeamSize(DEMO_MEMBERS.length);
        return;
      }

      const data = await apiCache.fetch(
        `dashboard:team-snapshot:${sessionUserId}`,
        async () => {
          const res = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/leaderboard`
          );
          if (!res.ok) throw new Error('Failed');
          return res.json();
        },
        { staleTime: 120_000, cacheTime: 600_000 }
      );

      const m: MemberSnap[] = (data.members || []).map((member: any) => ({
        id: member.id,
        name: member.name,
        is_you: member.is_you,
        leads: member.leads || 0,
        emails_sent: member.emails_sent || 0,
        replies: member.replies || 0,
        meetings: member.meetings || 0,
        revenue: member.revenue || 0,
        deal_count: member.deal_count || 0,
        pipeline_value: member.pipeline_value || 0,
      }));

      setMembers(m);
      setTeamSize(Math.max(Number(data.team_size || 0), m.length));
    } catch (err) {
      console.error('[DASHBOARD] Team snapshot error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Sort by revenue (descending), fallback to leads
  const sorted = useMemo(() => [...members].sort((a, b) => (b.revenue || b.leads) - (a.revenue || a.leads)).slice(0, 5), [members]);
  const hasAnyRevenue = sorted.some(m => m.revenue > 0);
  const maxRevenue = sorted.length > 0 ? Math.max(...sorted.map(m => m.revenue || m.leads)) || 1 : 1;

  if (loading) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  // Solo / no team — show a compact campaign pulse instead of an empty team card.
  if (teamSize <= 1) {
    if (stats) {
      return <DashboardSoloSidebar stats={stats} onNavigate={onNavigate} />;
    }
    // Fallback if no stats passed (shouldn't happen normally)
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
            {t('dashboard.team')}
          </h3>
          <Users className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-white/[0.04] flex items-center justify-center mb-4">
            <Users className="w-5 h-5 text-zinc-300 dark:text-zinc-600" />
          </div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('dashboard.inviteTeam')}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed max-w-[200px]">
            {t('dashboard.addMembersUnlock')}
          </p>
          <button
            onClick={() => onNavigate('settings')}
            className="mt-4 text-[11px] font-medium px-4 py-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03] text-zinc-500 dark:text-zinc-400 hover:text-[#1ED4A7] transition-colors border border-zinc-200 dark:border-white/[0.06] hover:border-[#1ED4A7]/30"
          >
            {t('dashboard.teamSettings')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 sm:p-5 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
            {t('dashboard.team')}
          </h3>
          <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 tabular-nums">
            {teamSize} {t('dashboard.members')}
          </span>
        </div>
        <button
          onClick={() => onNavigate('team')}
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-[#1ED4A7] transition-colors"
        >
          {t('common.fullBoard')} <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {/* Leaderboard */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 custom-scrollbar">
        {sorted.map((member, idx) => {
          const rank = idx + 1;
          const pct = Math.max((member.revenue / maxRevenue) * 100, 4);

          return (
            <div
              key={member.id}
              className={`rounded-lg px-3 py-2 transition-colors ${
                member.is_you ? 'bg-[#1ED4A7]/[0.04]' : ''
              }`}
            >
              <div className="flex items-center gap-2.5">
                {/* Rank */}
                <span className={`w-4 text-center text-[11px] font-bold tabular-nums flex-shrink-0 ${
                  rank === 1 ? 'text-amber-500' :
                  rank === 2 ? 'text-zinc-400' :
                  rank === 3 ? 'text-amber-700 dark:text-amber-600' :
                  'text-zinc-300 dark:text-zinc-600'
                }`}>
                  {rank}
                </span>

                {/* Avatar */}
                <MemberAvatar name={member.name} size={26} />

                {/* Name + metrics */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">
                      {member.name}
                    </span>
                    {member.is_you && (
                      <span className="px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-[#1ED4A7] bg-[#1ED4A7]/10 rounded flex-shrink-0">
                        {t('dashboard.you')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    {hasAnyRevenue ? (
                      <>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
                          {member.meetings} {t('dashboard.meetings')}
                        </span>
                        <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
                          {member.replies} {t('dashboard.replies')}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
                          {member.leads.toLocaleString()} {t('dashboard.leads')}
                        </span>
                        <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
                          {member.emails_sent.toLocaleString()} {t('dashboard.sent')}
                        </span>
                        {member.replies > 0 && (
                          <>
                            <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
                            <span className="text-[10px] text-[#1ED4A7] tabular-nums font-medium">
                              {member.replies} {t('dashboard.replies')}
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Primary metric */}
                <div className="text-right flex-shrink-0 ml-1">
                  {hasAnyRevenue ? (
                    <span className="text-[12px] font-bold text-zinc-900 dark:text-white tabular-nums whitespace-nowrap">
                      {fmtCurrency(member.revenue)}
                    </span>
                  ) : (
                    <span className={`text-[12px] font-bold tabular-nums whitespace-nowrap ${
                      member.leads > 0 ? 'text-zinc-900 dark:text-white' : 'text-zinc-300 dark:text-zinc-700'
                    }`}>
                      {member.leads.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/[0.06] flex-shrink-0">
        <button
          onClick={() => onNavigate('team')}
          className="w-full text-[11px] font-medium text-center py-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-white/[0.08]"
        >
          <Trophy className="w-3 h-3 inline mr-1.5 -mt-px" />
          {t('common.viewLeaderboard')}
        </button>
      </div>
    </div>
  );
}

function fmtCurrency(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}
