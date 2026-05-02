import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, CalendarClock, MapPin, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useDemoMode } from './DemoContext';

interface DashboardEngagementHeatmapProps {
  brandFilter?: string;
}

interface EmailOpen {
  opened_at: string;
  campaign_id?: string | null;
}

const HOURS = ['12a', '2a', '4a', '6a', '8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p'];
const DEMO_POINTS = [
  [1, 0, 0, 0, 0, 0, 3, 4, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 4, 5, 0, 0, 2, 1],
  [0, 0, 0, 0, 0, 5, 6, 1, 0, 6, 2, 0],
  [0, 0, 0, 0, 0, 5, 0, 0, 4, 3, 0, 0],
  [0, 0, 0, 0, 0, 5, 4, 0, 0, 7, 6, 3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 2, 3, 6, 0, 5, 4, 0],
];

export function DashboardEngagementHeatmap({ brandFilter = 'all' }: DashboardEngagementHeatmapProps) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [opens, setOpens] = useState<EmailOpen[]>([]);
  const [loading, setLoading] = useState(!isDemoMode);

  useEffect(() => {
    if (isDemoMode) {
      setLoading(false);
      return;
    }
    loadOpenData();
  }, [brandFilter, isDemoMode]);

  async function loadOpenData() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setOpens([]);
        return;
      }

      let campaignIds: string[] | null = null;
      if (brandFilter && brandFilter !== 'all') {
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('id')
          .eq('user_id', userId)
          .eq('brand', brandFilter)
          .limit(200);
        campaignIds = (campaigns || []).map((c: any) => c.id);
        if (campaignIds.length === 0) {
          setOpens([]);
          return;
        }
      }

      let query = supabase
        .from('emails')
        .select('opened_at, campaign_id')
        .eq('user_id', userId)
        .not('opened_at', 'is', null)
        .order('opened_at', { ascending: false })
        .limit(500);

      if (campaignIds) {
        query = query.in('campaign_id', campaignIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      setOpens((data || []) as EmailOpen[]);
    } catch (error) {
      console.error('[DASHBOARD] Engagement heatmap error:', error);
      setOpens([]);
    } finally {
      setLoading(false);
    }
  }

  const days = [
    t('common.weekdaysShort.mon', 'Mon'),
    t('common.weekdaysShort.tue', 'Tue'),
    t('common.weekdaysShort.wed', 'Wed'),
    t('common.weekdaysShort.thu', 'Thu'),
    t('common.weekdaysShort.fri', 'Fri'),
    t('common.weekdaysShort.sat', 'Sat'),
    t('common.weekdaysShort.sun', 'Sun'),
  ];

  const { grid, max } = useMemo(() => {
    if (isDemoMode) {
      return { grid: DEMO_POINTS, max: Math.max(...DEMO_POINTS.flat(), 1) };
    }

    const next = Array.from({ length: 7 }, () => Array(12).fill(0));
    let nextMax = 0;

    for (const open of opens) {
      if (!open.opened_at) continue;
      const date = new Date(open.opened_at);
      const day = date.getDay() === 0 ? 6 : date.getDay() - 1;
      const hourBucket = Math.min(11, Math.floor(date.getHours() / 2));
      next[day][hourBucket] += 1;
      nextMax = Math.max(nextMax, next[day][hourBucket]);
    }

    return { grid: next, max: Math.max(nextMax, 1) };
  }, [opens, isDemoMode]);

  const intensityClass = (value: number) => {
    if (value <= 0) return 'bg-zinc-100/80 dark:bg-white/[0.035] border-zinc-200/50 dark:border-white/[0.035]';
    const intensity = value / max;
    if (intensity < 0.25) return 'bg-[#1ED4A7]/14 border-[#1ED4A7]/10';
    if (intensity < 0.5) return 'bg-[#1ED4A7]/30 border-[#1ED4A7]/15';
    if (intensity < 0.75) return 'bg-[#1ED4A7]/55 border-[#1ED4A7]/25';
    return 'bg-[#1ED4A7] border-[#1ED4A7]/80 shadow-[0_0_12px_rgba(30,212,167,0.24)]';
  };

  return (
    <div className="glass-card p-5 h-full min-h-full flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 mb-3 flex-shrink-0">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
            {t('dashboard.engagementHeatmap', 'Engagement Heatmap')}
          </h3>
          <p className="text-[11px] text-zinc-500 mt-1">{t('dashboard.whenWhereActive', 'When your leads are most active')}</p>
        </div>
        <div className="hidden sm:flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-100/80 dark:bg-white/[0.03] p-1">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-white/10 text-[10px] font-semibold text-zinc-800 dark:text-white">
            <Clock3 className="w-3 h-3" /> {t('common.time', 'Time')}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold text-zinc-500">
            <MapPin className="w-3 h-3" /> {t('dashboard.location', 'Location')}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold text-zinc-500">
            <CalendarClock className="w-3 h-3" /> {t('common.day', 'Day')}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col justify-center">
          <div className="rounded-2xl border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/60 dark:bg-white/[0.02] p-3 sm:p-4">
          <div className="grid grid-cols-[32px_repeat(12,minmax(0,1fr))] gap-1 sm:gap-1.5 mb-2 px-0.5">
            <div />
            {HOURS.map((hour) => (
              <div key={hour} className="text-[9px] font-medium text-zinc-500 text-center tabular-nums">
                {hour}
              </div>
            ))}
          </div>

          <div className="grid grid-rows-7 gap-1 sm:gap-1.5">
            {grid.map((row, dayIndex) => (
              <div key={days[dayIndex]} className="grid grid-cols-[32px_repeat(12,minmax(0,1fr))] gap-1 sm:gap-1.5 items-center">
                <div className="text-[10px] font-medium text-zinc-500 text-right pr-1">{days[dayIndex]}</div>
                {row.map((value, hourIndex) => (
                  <div
                    key={`${dayIndex}-${hourIndex}`}
                    title={`${days[dayIndex]} ${HOURS[hourIndex]}: ${value} opens`}
                    className={`h-3.5 sm:h-4 rounded-[5px] border transition-colors ${intensityClass(value)}`}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 text-[10px] font-medium text-zinc-500">
            <span>{t('dashboard.heatmapLess', 'Less')}</span>
            <div className="flex gap-1">
              <div className="w-2.5 h-2.5 rounded-[4px] bg-white/[0.04] border border-white/[0.04]" />
              <div className="w-2.5 h-2.5 rounded-[4px] bg-[#1ED4A7]/20 border border-[#1ED4A7]/10" />
              <div className="w-2.5 h-2.5 rounded-[4px] bg-[#1ED4A7]/50 border border-[#1ED4A7]/20" />
              <div className="w-2.5 h-2.5 rounded-[4px] bg-[#1ED4A7] border border-[#1ED4A7]" />
            </div>
            <span>{t('dashboard.heatmapMore', 'More')}</span>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
