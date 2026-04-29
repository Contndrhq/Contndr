import { useState, useEffect } from 'react';
import { Sparkles, Clock, TrendingUp, Users, Loader2, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiCache } from '../lib/api-cache';
import { projectId } from '../utils/supabase/info';
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';
import i18n from '../lib/i18n';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface Insight {
  id: string;
  icon: 'clock' | 'trending' | 'users';
  label: string;
  value: string;
}

const DEMO_INSIGHTS: Insight[] = [
  { id: 'i1', icon: 'clock', label: 'Best time to send', value: 'Tue & Thu, 4 PM' },
  { id: 'i2', icon: 'trending', label: 'Top performing', value: 'Real Estate' },
  { id: 'i3', icon: 'users', label: 'Most responsive', value: 'Construction CEOs' },
];

function InsightIcon({ type }: { type: Insight['icon'] }) {
  const cls = 'w-3 h-3';
  switch (type) {
    case 'clock': return <Clock className={`${cls} text-[#1ED4A7]`} />;
    case 'trending': return <TrendingUp className={`${cls} text-[#1ED4A7]`} />;
    case 'users': return <Users className={`${cls} text-[#1ED4A7]`} />;
  }
}

export function DashboardAIInsights() {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const [insights, setInsights] = useState<Insight[]>(isDemoMode ? DEMO_INSIGHTS : []);
  const [loading, setLoading] = useState(isDemoMode ? false : true);

  useEffect(() => {
    if (isDemoMode) {
      // Translate demo insight values based on language
      const translatedDemo: Insight[] = [
        { id: 'i1', icon: 'clock', label: 'Best time to send', value: i18n.language === 'es' ? 'Mar & Jue, 4 PM' : i18n.language === 'pt' ? 'Ter & Qui, 4 PM' : 'Tue & Thu, 4 PM' },
        { id: 'i2', icon: 'trending', label: 'Top performing', value: i18n.language === 'es' ? 'Bienes Raíces' : i18n.language === 'pt' ? 'Imobiliário' : 'Real Estate' },
        { id: 'i3', icon: 'users', label: 'Most responsive', value: i18n.language === 'es' ? 'CEOs Construcción' : i18n.language === 'pt' ? 'CEOs Construção' : 'Construction CEOs' },
      ];
      setInsights(translatedDemo);
      return;
    }
    loadInsights();
  }, [isDemoMode]);

  async function loadInsights() {
    try {
      let isDemo = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
      } catch (_) {}

      // Try to compute insights from real data
      const computed = await apiCache.fetch('dashboard:ai-insights', async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;
        const userId = session.user.id;

        const result: Insight[] = [];

        // 1. Best send time — analyze email opens by hour/day
        try {
          const { data: openedEmails } = await supabase
            .from('email_events')
            .select('created_at, emails!inner(user_id)')
            .eq('event_type', 'opened')
            .eq('emails.user_id', userId)
            .order('created_at', { ascending: false })
            .limit(200);

          if (openedEmails && openedEmails.length >= 10) {
            const dayHourCounts = new Map<string, number>();
            const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

            for (const e of openedEmails) {
              const d = new Date(e.created_at);
              const key = `${dayKeys[d.getDay()]} ${d.getHours()}`;
              dayHourCounts.set(key, (dayHourCounts.get(key) || 0) + 1);
            }

            let bestKey = '';
            let bestCount = 0;
            for (const [k, v] of dayHourCounts) {
              if (v > bestCount) { bestCount = v; bestKey = k; }
            }

            if (bestKey) {
              const [dayKey, hour] = bestKey.split(' ');
              const h = parseInt(hour);
              const ampm = h >= 12 ? 'PM' : 'AM';
              const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
              const translatedDay = t(`common.weekdaysShort.${dayKey}`);
              result.push({
                id: 'best-time',
                icon: 'clock',
                label: 'Best time to send',
                value: `${translatedDay}, ${h12} ${ampm}`,
              });
            }
          }
        } catch (_) {}

        // 2. Top industry / campaign
        try {
          const { data: campaigns } = await supabase
            .from('campaigns')
            .select('id, name')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

          if (campaigns && campaigns.length > 0) {
            const { data: emails } = await supabase
              .from('emails')
              .select('campaign_id, status')
              .in('campaign_id', campaigns.map(c => c.id));

            if (emails && emails.length > 0) {
              const stats = new Map<string, { sent: number; opened: number }>();
              for (const e of emails) {
                const cur = stats.get(e.campaign_id) || { sent: 0, opened: 0 };
                cur.sent++;
                if (['opened', 'clicked', 'replied'].includes(e.status)) cur.opened++;
                stats.set(e.campaign_id, cur);
              }

              let best = '';
              let bestRate = 0;
              for (const [cid, s] of stats) {
                if (s.sent < 5) continue;
                const rate = s.opened / s.sent;
                if (rate > bestRate) {
                  bestRate = rate;
                  best = campaigns.find(c => c.id === cid)?.name || '';
                }
              }

              if (best) {
                const cleaned = best.replace(/campaign|outreach|email|series|sequence/gi, '').trim();
                result.push({
                  id: 'top-industry',
                  icon: 'trending',
                  label: 'Top performing',
                  value: cleaned || best,
                });
              }
            }
          }
        } catch (_) {}

        // 3. Most active leads segment
        try {
          const { data: recentReplies } = await supabase
            .from('email_events')
            .select('emails!inner(user_id, leads(industry, job_title))')
            .eq('event_type', 'replied')
            .eq('emails.user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

          if (recentReplies && recentReplies.length >= 3) {
            const titleCounts = new Map<string, number>();
            for (const r of recentReplies) {
              const title = (r as any).emails?.leads?.title;
              if (title) {
                titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
              }
            }

            let topTitle = '';
            let topCount = 0;
            for (const [t, c] of titleCounts) {
              if (c > topCount) { topCount = c; topTitle = t; }
            }

            if (topTitle) {
              result.push({
                id: 'active-segment',
                icon: 'users',
                label: 'Most responsive',
                value: topTitle.length > 24 ? topTitle.slice(0, 22) + '...' : topTitle,
              });
            }
          }
        } catch (_) {}

        return result.length > 0 ? result : null;
      }, { staleTime: 300_000, cacheTime: 600_000 }).catch(() => null);

      if (computed && (computed as Insight[]).length > 0) {
        setInsights(computed as Insight[]);
      } else if (isDemo) {
        setInsights(DEMO_INSIGHTS);
      }
    } catch (err) {
      console.error('[DASHBOARD] AI insights error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return null;
  if (insights.length === 0) return null;

  return (
    <div className="relative rounded-xl border border-zinc-100 dark:border-white/[0.06] bg-gradient-to-r from-zinc-50 via-zinc-50 to-zinc-50 dark:from-white/[0.02] dark:via-white/[0.03] dark:to-white/[0.02] overflow-hidden">
      {/* Subtle accent line at top */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#1ED4A7]/30 to-transparent" />
      
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Label */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-5 h-5 rounded-md bg-[#1ED4A7]/10 flex items-center justify-center">
            <Sparkles className="w-2.5 h-2.5 text-[#1ED4A7]" />
          </div>
          <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{t('aiInsights.label', 'AI')}</span>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-zinc-200 dark:bg-white/[0.06] flex-shrink-0" />

        {/* Insights inline */}
        <div className="flex items-center gap-5 overflow-x-auto scrollbar-hide flex-1 min-w-0">
          {insights.map((insight, i) => (
            <div key={insight.id} className="flex items-center gap-2 flex-shrink-0">
              <div className="w-6 h-6 rounded-lg bg-[#1ED4A7]/8 dark:bg-[#1ED4A7]/[0.06] flex items-center justify-center flex-shrink-0">
                <InsightIcon type={insight.icon} />
              </div>
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-wider whitespace-nowrap">{
                  insight.label === 'Best time to send' ? t('aiInsights.bestTimeToSend', 'Best time to send') :
                  insight.label === 'Top performing' ? t('aiInsights.topPerforming', 'Top performing') :
                  insight.label === 'Most responsive' ? t('aiInsights.mostResponsive', 'Most responsive') :
                  insight.label
                }</span>
                <ChevronRight className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
                <span className="text-[12px] font-semibold text-zinc-800 dark:text-white whitespace-nowrap">{insight.value}</span>
              </div>

              {/* Separator dot between insights */}
              {i < insights.length - 1 && (
                <div className="w-1 h-1 rounded-full bg-zinc-200 dark:bg-white/[0.08] ml-3 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}