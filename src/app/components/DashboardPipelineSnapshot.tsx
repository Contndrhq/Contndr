import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ArrowUpRight, Loader2 } from 'lucide-react';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { supabase } from '../lib/supabase';
import { useDemoMode } from './DemoContext';
import { useRealtimeRefresh } from './RealtimeProvider';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface PipelineStage {
  key: string;
  label: string;
  count: number;
  value: number;
}

const STAGE_ORDER: { key: string; label: string }[] = [
  { key: 'prospect_identified', label: 'Prospect Identified' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'engaged', label: 'Engaged' },
  { key: 'meeting_booked', label: 'Meeting Booked' },
  { key: 'proposal_sent', label: 'Proposal Sent' },
  { key: 'negotiation', label: 'Negotiation' },
];

// Demo data
const DEMO_STAGES: PipelineStage[] = [
  { key: 'discovery', label: 'Discovery', count: 12, value: 48200 },
  { key: 'demo', label: 'Demo', count: 8, value: 36400 },
  { key: 'proposal', label: 'Proposal', count: 4, value: 22800 },
  { key: 'negotiation', label: 'Negotiation', count: 3, value: 18500 },
  { key: 'closing', label: 'Closing', count: 2, value: 14600 },
];

function fmtCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

export function DashboardPipelineSnapshot({ onNavigate }: { onNavigate: (view: string) => void }) {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const refreshKey = useRealtimeRefresh(['pipeline:deal_created', 'pipeline:deal_moved']);
  const [stages, setStages] = useState<PipelineStage[]>(isDemoMode ? DEMO_STAGES : []);
  const [totalValue, setTotalValue] = useState(isDemoMode ? DEMO_STAGES.reduce((s, st) => s + st.value, 0) : 0);
  const [totalDeals, setTotalDeals] = useState(isDemoMode ? DEMO_STAGES.reduce((s, st) => s + st.count, 0) : 0);
  const [loading, setLoading] = useState(isDemoMode ? false : true);

  useEffect(() => {
    if (isDemoMode) return;
    loadPipeline();
  }, [isDemoMode, refreshKey]);

  async function loadPipeline() {
    try {
      // Check demo
      let isDemo = false;
      let userId: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
        userId = session?.user?.id || null;
      } catch (_) {}

      const cacheKey = `dashboard:pipeline-snapshot:${userId || 'anonymous'}:v3`;
      const pipelineData = await apiCache.fetch(cacheKey, async () => {
        const headers = await getAuthHeaders();
        const [metricsRes, dealsRes] = await Promise.all([
          fetch(`${API_BASE}/pipeline/metrics`, { headers }),
          fetch(`${API_BASE}/pipeline/deals`, { headers }),
        ]);
        const [metricsData, dealsData] = await Promise.all([
          metricsRes.ok ? metricsRes.json() : Promise.resolve(null),
          dealsRes.ok ? dealsRes.json() : Promise.resolve(null),
        ]);
        return { metrics: metricsData, deals: dealsData?.deals || [] };
      }, { staleTime: 15_000, cacheTime: 90_000 }).catch(() => null);

      const deals: any[] = pipelineData?.deals || [];
      const activeDeals = deals.filter((d: any) => d.stage !== 'closed_won' && d.stage !== 'closed_lost');
      const metrics = pipelineData?.metrics;

      if (isDemo && activeDeals.length === 0) {
        setStages(DEMO_STAGES);
        setTotalValue(DEMO_STAGES.reduce((s, st) => s + st.value, 0));
        setTotalDeals(DEMO_STAGES.reduce((s, st) => s + st.count, 0));
      } else if (metrics?.stageCounts && metrics?.stageValues) {
        const result: PipelineStage[] = STAGE_ORDER.map(s => ({
          key: s.key,
          label: s.label,
          count: metrics.stageCounts[s.key] || 0,
          value: metrics.stageValues[s.key] || 0,
        }));

        setStages(result);
        setTotalValue(metrics.totalPipelineValue || 0);
        setTotalDeals(metrics.activeDeals || activeDeals.length);
      } else {
        // Group by stage
        const stageMap = new Map<string, { count: number; value: number }>();
        for (const deal of activeDeals) {
          const stg = (deal.stage || 'discovery').toLowerCase();
          const cur = stageMap.get(stg) || { count: 0, value: 0 };
          cur.count++;
          cur.value += deal.value || 0;
          stageMap.set(stg, cur);
        }

        const result: PipelineStage[] = STAGE_ORDER.map(s => ({
          key: s.key,
          label: s.label,
          count: stageMap.get(s.key)?.count || 0,
          value: stageMap.get(s.key)?.value || 0,
        }));

        setStages(result);
        setTotalValue(activeDeals.reduce((s: number, d: any) => s + (d.value || 0), 0));
        setTotalDeals(activeDeals.length);
      }
    } catch (err) {
      console.error('[DASHBOARD] Pipeline snapshot error:', err);
    } finally {
      setLoading(false);
    }
  }

  const maxCount = Math.max(...stages.map(s => s.count), 1);

  return (
    <div className="glass-card p-4 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">{t('pipeline.title')}</h3>
        <button
          onClick={() => onNavigate('pipeline')}
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-[#1ED4A7] transition-colors"
        >
          {t('common.viewAll')} <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      ) : totalDeals === 0 ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Motivating header */}
          <div className="mb-3 pb-2 border-b border-zinc-100 dark:border-white/[0.06]">
            <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{t('dashboard.startTracking')}</p>
          </div>

          {/* Empty pipeline stages */}
          <div className="flex-1 space-y-2.5 min-h-0">
            {STAGE_ORDER.map((stage) => (
              <div key={stage.key} className="group">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[12px] font-medium text-zinc-400 dark:text-zinc-600">{t(`pipeline.stages.${stage.key}`, stage.label)}</span>
                  <span className="text-[11px] text-zinc-300 dark:text-zinc-700 tabular-nums">0 {t('dashboard.deals')}</span>
                </div>
                <div className="h-1.5 bg-zinc-100 dark:bg-white/[0.04] rounded-full overflow-hidden" />
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/[0.06] flex-shrink-0">
            <button
              onClick={() => onNavigate('pipeline')}
              className="w-full text-[12px] font-semibold text-center py-2 rounded-lg bg-[#1ED4A7]/10 text-[#1ED4A7] hover:bg-[#1ED4A7]/20 transition-colors border border-[#1ED4A7]/20"
            >
              {t('dashboard.createDeal')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Total value */}
          <div className="mb-4 pb-3 border-b border-zinc-100 dark:border-white/[0.06]">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{fmtCurrency(totalValue)}</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">{t('dashboard.openDeals')}</span>
            </div>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
              {totalDeals} {t('dashboard.activeDeals').toLowerCase()} — {stages.filter(s => s.count > 0).length} {t('dashboard.pipelineStages', 'stages')}
            </p>
          </div>

          {/* Stages */}
          <div className="flex-1 space-y-3">
            {stages.map((stage) => (
              <div key={stage.key} className="group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-400">{t(`pipeline.stages.${stage.key}`, stage.label)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-600 tabular-nums">{fmtCurrency(stage.value)}</span>
                    <span className="text-[12px] font-bold text-zinc-900 dark:text-white tabular-nums min-w-[20px] text-right">{stage.count}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-zinc-100 dark:bg-white/[0.04] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-[#1ED4A7]/50 to-[#1ED4A7]"
                    style={{ width: `${stage.count > 0 ? Math.max((stage.count / maxCount) * 100, 8) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
