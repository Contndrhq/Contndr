import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, TrendingUp, ArrowUpRight, CircleDollarSign, Trophy, Loader2 } from 'lucide-react';
import { authenticatedFetch, getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { supabase } from '../lib/supabase';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface SnapshotData {
  mrr: number;
  totalRevenue: number;
  pipelineValue: number;
  activeDeals: number;
  wonDeals: number;
  closeRate: number;
}

function fmtCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

export function DashboardRevenuePipeline({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemoAccount, setIsDemoAccount] = useState(false);

  useEffect(() => {
    loadSnapshot();
  }, []);

  async function loadSnapshot() {
    try {
      // Check demo
      let isDemo = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
      } catch (_) {}
      setIsDemoAccount(isDemo);

      // Fetch revenue + pipeline in parallel
      const [revenueData, pipelineData] = await Promise.all([
        apiCache.fetch('dashboard:revenue-snapshot', async () => {
          const res = await authenticatedFetch(`${API_BASE}/revenue/metrics`);
          if (!res.ok) return null;
          return res.json();
        }, { staleTime: 120_000, cacheTime: 300_000 }).catch(() => null),
        apiCache.fetch('dashboard:pipeline-snapshot', async () => {
          const headers = await getAuthHeaders();
          const res = await fetch(`${API_BASE}/pipeline/deals`, { headers });
          if (!res.ok) return null;
          return res.json();
        }, { staleTime: 120_000, cacheTime: 300_000 }).catch(() => null),
      ]);

      // Extract revenue metrics
      const metrics = revenueData?.metrics;
      const mrr = metrics?.mrr || 0;
      const totalRevenue = metrics?.total_revenue || 0;
      const activeSubs = metrics?.active_subscriptions || 0;
      const totalCustomers = metrics?.total_customers || 0;
      const stripeWonDeals = Math.max(activeSubs, totalCustomers);

      // Calculate pipeline metrics from deals
      const deals: any[] = pipelineData?.deals || [];
      const activeDeals = deals.filter((d: any) => d.stage !== 'closed_won' && d.stage !== 'closed_lost').length;
      const manualWonDeals = deals.filter((d: any) => d.stage === 'closed_won').length;
      
      // Smart won deals: automatically include paying customers/subscribers
      const wonDeals = manualWonDeals + stripeWonDeals;
      
      const lostDeals = deals.filter((d: any) => d.stage === 'closed_lost').length;
      const pipelineValue = deals
        .filter((d: any) => d.stage !== 'closed_won' && d.stage !== 'closed_lost')
        .reduce((s: number, d: any) => s + (d.value || 0), 0);

      // Realistic Close Rate Calculation:
      // Prevent 100% close rates when users have Stripe customers but haven't manually marked deals as "Lost"
      let closeRate = 0;
      if (wonDeals > 0 || lostDeals > 0) {
        // Assume a baseline loss rate if manual data is sparse (e.g. 35% win rate = ~1.8 lost for every 1 won)
        const impliedLost = Math.max(
           lostDeals, 
           activeDeals * 0.5, 
           wonDeals * 1.8     
        ); 
        
        // Blend actual manual lost deals with the implied baseline
        const blendedLost = (lostDeals * 2 + impliedLost) / 3; 
        
        closeRate = (wonDeals / (wonDeals + blendedLost)) * 100;
      }

      // If demo and no real data, use demo values
      if (isDemo && mrr === 0 && activeDeals === 0) {
        setData({
          mrr: 12400,
          totalRevenue: 235900,
          pipelineValue: 186500,
          activeDeals: 23,
          wonDeals: 14,
          closeRate: 58.3,
        });
      } else {
        setData({ mrr, totalRevenue, pipelineValue, activeDeals, wonDeals, closeRate });
      }
    } catch (err) {
      console.error('[DASHBOARD] Revenue/Pipeline snapshot error:', err);
      setData({ mrr: 0, totalRevenue: 0, pipelineValue: 0, activeDeals: 0, wonDeals: 0, closeRate: 0 });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const metrics = [
    { label: t('dashboard.mrr'), value: fmtCurrency(data.mrr), icon: DollarSign, teal: data.mrr > 0 },
    { label: t('sidebar.pipeline'), value: fmtCurrency(data.pipelineValue), icon: TrendingUp, teal: false },
    { label: t('dashboard.activeDeals'), value: data.activeDeals.toLocaleString(), icon: CircleDollarSign, teal: false },
    { label: t('dashboard.dealsWon'), value: data.wonDeals.toLocaleString(), icon: Trophy, teal: data.wonDeals > 0 },
  ];

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
          {t('dashboard.revenuePipeline')}
        </h3>
        <button
          onClick={() => onNavigate('revenue')}
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-[#1ED4A7] transition-colors"
        >
          {t('dashboard.viewAll')} <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-4 flex-1">
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col">
            <div className="flex items-center gap-1.5 mb-1.5">
              <m.icon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
              <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                {m.label}
              </span>
            </div>
            <span className={`text-xl font-bold tracking-tight ${m.teal ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}`}>
              {m.value}
            </span>
          </div>
        ))}
      </div>

      {/* Close Rate Bar */}
      <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">{t('dashboard.closeRate')}</span>
          <span className={`text-sm font-bold tabular-nums ${data.closeRate > 30 ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}`}>
            {data.closeRate.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-[#1ED4A7] to-[#159c7b]"
            style={{ width: `${Math.min(data.closeRate, 100)}%` }}
          />
        </div>
      </div>

      {/* Quick Links */}
      <div className="mt-5 flex gap-2">
        <button
          onClick={() => onNavigate('pipeline')}
          className="flex-1 text-[11px] font-medium text-center py-2 rounded-lg bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-100 dark:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-200 dark:border-zinc-800"
        >
          {t('sidebar.pipeline')}
        </button>
        <button
          onClick={() => onNavigate('revenue')}
          className="flex-1 text-[11px] font-medium text-center py-2 rounded-lg bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-100 dark:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-200 dark:border-zinc-800"
        >
          {t('sidebar.revenue')}
        </button>
      </div>
    </div>
  );
}
