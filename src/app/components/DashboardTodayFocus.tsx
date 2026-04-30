import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, UserPlus, Send, Zap, Clock, ArrowUpRight, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { supabase } from '../lib/supabase';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface MeetingInfo {
  name: string;
  time: string;
  email?: string;
}

interface FollowUpInfo {
  id: string;
  leadName: string;
  dueLabel: string;
  overdue: boolean;
}

// Demo data
const DEMO_MEETINGS: MeetingInfo[] = [
  { name: 'Sarah at Shopify', time: '2:00 PM', email: 'sarah@shopify.com' },
  { name: 'Mike at Stripe', time: '4:30 PM', email: 'mike@stripe.com' },
];

const DEMO_FOLLOW_UPS: FollowUpInfo[] = [
  { id: 'f1', leadName: 'Notion Labs', dueLabel: 'Due today', overdue: false },
  { id: 'f2', leadName: 'Tesla Energy', dueLabel: 'Overdue 1d', overdue: true },
  { id: 'f3', leadName: 'Apex Digital', dueLabel: 'Due tomorrow', overdue: false },
];

export function DashboardTodayFocus({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState<MeetingInfo[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      let isDemo = false;
      let userId: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
        userId = session?.user?.id || null;
      } catch (_) {}

      if (isDemo) {
        setMeetings(DEMO_MEETINGS);
        setFollowUps(DEMO_FOLLOW_UPS);
        setLoading(false);
        return;
      }

      const [meetingsResult, followUpsResult] = await Promise.all([
        apiCache.fetch('dashboard:today-meetings', async () => {
          try {
            const res = await authenticatedFetch(`${API_BASE}/calendly/scheduled-events`);
            if (!res.ok) return [];
            const data = await res.json();
            const events = data.events || data.collection || [];
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayEnd = new Date(todayStart.getTime() + 86400000);

            return events
              .filter((e: any) => {
                const start = new Date(e.start_time || e.start);
                return start >= todayStart && start < todayEnd && e.status !== 'canceled';
              })
              .slice(0, 4)
              .map((e: any) => ({
                name: e.name || e.invitees_counter?.active > 0
                  ? (e.invitees?.[0]?.name || e.name || 'Meeting')
                  : 'Meeting',
                time: new Date(e.start_time || e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                email: e.invitees?.[0]?.email,
              }));
          } catch { return []; }
        }, { staleTime: 60_000, cacheTime: 180_000 }).catch(() => []),

        apiCache.fetch('dashboard:due-followups', async () => {
          if (!userId) return [];
          try {
            const { data: campaigns } = await supabase
              .from('campaigns')
              .select('id')
              .eq('user_id', userId);
            if (!campaigns || campaigns.length === 0) return [];
            const cids = campaigns.map(c => c.id);

            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(23, 59, 59, 999);

            const { data: fups } = await supabase
              .from('follow_ups')
              .select('id, due_date, status, lead_id, leads(business_name, contact_name)')
              .in('campaign_id', cids)
              .lte('due_date', tomorrow.toISOString())
              .neq('status', 'completed')
              .order('due_date', { ascending: true })
              .limit(5);

            if (!fups) return [];
            const now = Date.now();
            return fups.map((f: any) => {
              const due = new Date(f.due_date).getTime();
              const diffMs = due - now;
              const diffDays = Math.floor(diffMs / 86400000);
              let dueLabel = '';
              let overdue = false;
              if (diffDays < 0) {
                overdue = true;
                dueLabel = t('dashboard.overdueDays', { days: Math.abs(diffDays) });
              } else if (diffDays === 0) {
                dueLabel = t('dashboard.dueToday');
              } else {
                dueLabel = t('dashboard.dueInDays', { days: diffDays });
              }
              return {
                id: f.id,
                leadName: f.leads?.business_name || f.leads?.contact_name || t('dashboard.unknownLead'),
                dueLabel,
                overdue,
              };
            });
          } catch { return []; }
        }, { staleTime: 60_000, cacheTime: 180_000 }).catch(() => []),
      ]);

      setMeetings(meetingsResult as MeetingInfo[]);
      setFollowUps(followUpsResult as FollowUpInfo[]);
    } catch (err) {
      console.error('[DASHBOARD] Today focus error:', err);
    } finally {
      setLoading(false);
    }
  }

  const quickActions = [
    { label: t('common.addContact'), icon: UserPlus, view: 'crm', primary: true },
    { label: t('common.newCampaign'), icon: Send, view: 'campaigns', primary: false },
    { label: t('common.findLeads'), icon: Zap, view: 'lead-finder', primary: false },
  ];

  return (
    <div className="glass-card p-5 min-h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">{t('common.today')}</h3>
        <Clock className="w-3.5 h-3.5 text-zinc-500" />
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
          {/* Quick Actions */}
          <div className="flex gap-2 flex-shrink-0 mb-4">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => onNavigate(action.view)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[11px] font-semibold transition-all ${
                  action.primary
                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20 hover:bg-[#1ED4A7]/20'
                    : 'bg-zinc-100 dark:bg-white/[0.03] text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-white/[0.06] hover:bg-zinc-200 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-300'
                }`}
              >
                <action.icon className="w-3 h-3" />
                <span className="hidden sm:inline">{action.label}</span>
                <span className="sm:hidden">{action.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>

          {/* Meetings */}
          <div className="flex-shrink-0 mb-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-zinc-500" />
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  {t('common.meetings')}
                </span>
              </div>
              {meetings.length > 0 && (
                <span className="text-[10px] font-bold text-[#1ED4A7] tabular-nums">{meetings.length} {t('common.today').toLowerCase()}</span>
              )}
            </div>

            {meetings.length > 0 ? (
              <div className="space-y-0.5">
                {meetings.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-1.5 px-1 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer group"
                    onClick={() => onNavigate('meetings')}
                  >
                    <div className="w-6 h-6 rounded-md bg-white/[0.04] flex items-center justify-center flex-shrink-0 group-hover:bg-[#1ED4A7]/10 transition-colors">
                      <Calendar className="w-3 h-3 text-zinc-500 group-hover:text-[#1ED4A7] transition-colors" />
                    </div>
                    <span className="text-[12px] font-medium text-white truncate flex-1">{m.name}</span>
                    <span className="text-[11px] text-zinc-500 tabular-nums flex-shrink-0">{m.time}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-600 pl-1">{t('dashboard.noMeetingsScheduled')}</p>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-white/[0.04] flex-shrink-0 mb-3" />

          {/* Follow-ups */}
          <div className="flex-shrink-0">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-zinc-500" />
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  {t('common.followUps')}
                </span>
              </div>
              {followUps.length > 0 && (
                <button
                  onClick={() => onNavigate('follow-ups')}
                  className="flex items-center gap-0.5 text-[10px] font-medium text-zinc-500 hover:text-[#1ED4A7] transition-colors"
                >
                  {t('common.viewAll')} <ArrowUpRight className="w-2.5 h-2.5" />
                </button>
              )}
            </div>

            {followUps.length > 0 ? (
              <div className="space-y-0.5">
                {followUps.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 py-1.5 px-1 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer group"
                    onClick={() => onNavigate('follow-ups')}
                  >
                    <div className={`w-6 h-6 rounded-md bg-white/[0.04] flex items-center justify-center flex-shrink-0 group-hover:bg-[#1ED4A7]/10 transition-colors`}>
                      <div className={`w-2 h-2 rounded-full ${
                        f.overdue ? 'bg-zinc-400' : 'bg-[#1ED4A7]/60'
                      }`} />
                    </div>
                    <span className="text-[12px] font-medium text-white truncate flex-1">{f.leadName}</span>
                    <span className={`text-[10px] font-medium flex-shrink-0 px-1.5 py-0.5 rounded-md ${
                      f.overdue
                        ? 'text-zinc-400 bg-white/[0.04]'
                        : 'text-[#1ED4A7]/80 bg-[#1ED4A7]/[0.06]'
                    }`}>
                      {f.dueLabel}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-600 pl-1">{t('dashboard.noFollowUpsDue')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
