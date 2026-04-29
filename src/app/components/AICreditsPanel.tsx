/**
 * AICreditsPanel — Shows AI call credit balance, usage meter, history, and buy-more flow.
 * Designed for the dark zinc + teal (#1ED4A7) Contndr design system.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  TrendingDown,
  TrendingUp,
  Clock,
  Phone,
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  Loader2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Gift,
  History,
  CreditCard,
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface CreditBalance {
  balance: number;
  monthly_allocation: number;
  bonus_credits: number;
  used_this_period: number;
  period_start: string;
  period_end: string;
  plan: string;
  updated_at: string;
}

interface CreditLogEntry {
  id: string;
  type: 'allocation' | 'deduction' | 'topup' | 'reset' | 'refund' | 'admin_adjust';
  amount: number;
  balance_after: number;
  description: string;
  call_id?: string;
  timestamp: string;
}

interface CreditPack {
  id: string;
  credits: number;
  price_cents: number;
  label: string;
  savings: string | null;
}

interface AICreditsResponse {
  success: boolean;
  credits: CreditBalance;
  log: CreditLogEntry[];
  packs: CreditPack[];
}

export function AICreditsPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [log, setLog] = useState<CreditLogEntry[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPacks, setShowPacks] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadCredits = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-credits/credits`,
        { headers }
      );
      if (res.ok) {
        const data: AICreditsResponse = await res.json();
        setCredits(data.credits);
        setLog(data.log || []);
        setPacks(data.packs || []);
      }
    } catch (err) {
      console.error('[AICredits] Load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadCredits(); }, [loadCredits]);

  // Check for purchase callback on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('credit_purchase') === 'success') {
      toast.success(t('aiCalls.credits.purchaseSuccess'));
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('credit_purchase');
      window.history.replaceState({}, '', url.toString());
      loadCredits();
    }
  }, [loadCredits]);

  async function handlePurchase(packId: string) {
    setPurchasing(packId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-credits/credits/purchase`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack_id: packId }),
        }
      );
      const data = await res.json();
      if (data.success && data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Failed to create purchase session');
      }
    } catch (err: any) {
      console.error('[AICredits] Purchase error:', err);
      toast.error('Failed to initiate purchase');
    } finally {
      setPurchasing(null);
    }
  }

  if (loading) {
    return (
      <div className={`${compact ? 'p-3' : 'p-6'} flex items-center justify-center`}>
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!credits) return null;

  const usagePercent = credits.monthly_allocation > 0
    ? Math.min(100, (credits.used_this_period / credits.monthly_allocation) * 100)
    : 0;
  const isLow = credits.balance <= 10 && credits.balance > 0;
  const isEmpty = credits.balance <= 0;
  const periodEnd = credits.period_end ? new Date(credits.period_end) : null;
  const daysUntilReset = periodEnd ? Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / 86400000)) : 0;

  // ─── Compact mode: inline badge for AICalls header ───
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowPacks(true)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isEmpty ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15' :
            isLow ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15' :
            'border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
          }`}
        >
          <Zap className="w-3 h-3 flex-shrink-0" />
          <span className="font-semibold tabular-nums">{credits.balance}</span>
          <span className="opacity-60 text-[10px]">{t('aiCalls.credits.credits')}</span>
        </button>
        {isEmpty && (
          <button
            onClick={() => setShowPacks(true)}
            className="text-xs px-3 py-1.5 bg-zinc-900 text-white dark:bg-white dark:text-black font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          >
            {t('aiCalls.credits.buyMore')}
          </button>
        )}

        {/* Inline packs modal */}
        {showPacks && (
          <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowPacks(false)}>
            <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 sm:p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-5 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-[#1ED4A7]" />
                {t('aiCalls.credits.buyCreditPacks')}
              </h3>
              <CreditPackGrid packs={packs} purchasing={purchasing} onPurchase={handlePurchase} />
              <button
                onClick={() => setShowPacks(false)}
                className="mt-5 w-full text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors py-2"
              >
                {t('aiCalls.credits.cancelBtn')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Full panel mode ───
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#1ED4A7]/10 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-[#1ED4A7]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('aiCalls.credits.aiCallCredits')}</h3>
              <p className="text-xs text-zinc-500 capitalize">{t('aiCalls.credits.plan', { plan: credits.plan })}</p>
            </div>
          </div>
          <button
            onClick={() => { setRefreshing(true); loadCredits(); }}
            className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            title={t('aiCalls.credits.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Balance */}
        <div className="flex items-end gap-2 mb-3">
          <span className={`text-3xl font-bold tabular-nums ${
            isEmpty ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-zinc-900 dark:text-white'
          }`}>
            {credits.balance}
          </span>
          <span className="text-sm text-zinc-500 mb-1">{t('aiCalls.credits.creditsRemaining')}</span>
        </div>

        {/* Usage bar */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>{t('aiCalls.credits.usedThisPeriod', { count: credits.used_this_period })}</span>
            <span>{t('aiCalls.credits.allocated', { count: credits.monthly_allocation })}</span>
          </div>
          <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                usagePercent > 90 ? 'bg-red-500' :
                usagePercent > 70 ? 'bg-amber-500' :
                'bg-[#1ED4A7]'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>

        {/* Period info + bonus */}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {t('aiCalls.credits.resetsIn', { days: daysUntilReset })}
          </span>
          {credits.bonus_credits > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <Gift className="w-3 h-3" />
              {t('aiCalls.credits.bonusCredits', { count: credits.bonus_credits })}
            </span>
          )}
        </div>

        {/* Warning banners */}
        {isEmpty && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-red-400">{t('aiCalls.credits.noCreditsRemaining')}</p>
              <p className="text-xs text-red-400/70 mt-0.5">{t('aiCalls.credits.noCreditsDesc')}</p>
            </div>
          </div>
        )}
        {isLow && !isEmpty && (
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-amber-400">{t('aiCalls.credits.creditsLow')}</p>
              <p className="text-xs text-amber-400/70 mt-0.5">{t('aiCalls.credits.creditsLowDesc', { count: credits.balance })}</p>
            </div>
          </div>
        )}
      </div>

      {/* Buy Credits Section */}
      <div className="p-5 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setShowPacks(!showPacks)}
          className="w-full flex items-center justify-between text-sm font-medium text-zinc-900 dark:text-white hover:text-[#1ED4A7] transition-colors"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            {t('aiCalls.credits.buyMoreCredits')}
          </span>
          {showPacks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showPacks && (
          <div className="mt-4">
            <CreditPackGrid packs={packs} purchasing={purchasing} onPurchase={handlePurchase} />
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-3 text-center">
              {t('aiCalls.credits.creditExplanation')}
            </p>
          </div>
        )}
      </div>

      {/* Usage History */}
      <div className="p-5">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between text-sm font-medium text-zinc-900 dark:text-white hover:text-[#1ED4A7] transition-colors"
        >
          <span className="flex items-center gap-2">
            <History className="w-4 h-4" />
            {t('aiCalls.credits.usageHistory')}
          </span>
          {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showHistory && (
          <div className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
            {log.length === 0 ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center py-4">{t('aiCalls.credits.noActivity')}</p>
            ) : (
              log.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <LogIcon type={entry.type} />
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{entry.description}</p>
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
                        {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className={`text-xs font-medium tabular-nums ${
                      entry.amount > 0 ? 'text-[#1ED4A7]' : 'text-red-400'
                    }`}>
                      {entry.amount > 0 ? '+' : ''}{entry.amount}
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums w-8 text-right">
                      {entry.balance_after}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function CreditPackGrid({
  packs,
  purchasing,
  onPurchase,
}: {
  packs: CreditPack[];
  purchasing: string | null;
  onPurchase: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {packs.map((pack) => (
        <button
          key={pack.id}
          onClick={() => onPurchase(pack.id)}
          disabled={!!purchasing}
          className={`relative p-4 rounded-xl border transition-all text-left ${
            purchasing === pack.id
              ? 'border-[#1ED4A7]/40 bg-[#1ED4A7]/5'
              : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:border-[#1ED4A7]/40 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          {pack.savings && (
            <span className="absolute -top-2 right-2 text-[10px] font-bold px-2 py-0.5 bg-[#1ED4A7] text-zinc-900 rounded-full">
              {pack.savings}
            </span>
          )}
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-[#1ED4A7]" />
            <span className="text-sm font-bold text-zinc-900 dark:text-white">{pack.credits}</span>
          </div>
          <p className="text-xs text-zinc-500">credits</p>
          <div className="mt-2 flex items-center gap-1">
            {purchasing === pack.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1ED4A7]" />
            ) : (
              <CreditCard className="w-3 h-3 text-zinc-500" />
            )}
            <span className="text-sm font-semibold text-zinc-900 dark:text-white">
              ${(pack.price_cents / 100).toFixed(0)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function LogIcon({ type }: { type: CreditLogEntry['type'] }) {
  const cls = "w-3.5 h-3.5 flex-shrink-0";
  switch (type) {
    case 'allocation':
    case 'reset':
      return <TrendingUp className={`${cls} text-[#1ED4A7]`} />;
    case 'deduction':
      return <Phone className={`${cls} text-red-400`} />;
    case 'topup':
      return <ShoppingCart className={`${cls} text-amber-400`} />;
    case 'refund':
      return <TrendingUp className={`${cls} text-blue-400`} />;
    case 'admin_adjust':
      return <Sparkles className={`${cls} text-purple-400`} />;
    default:
      return <Zap className={`${cls} text-zinc-500`} />;
  }
}

// ─── Inline credit check hook for other components ──────────────────────

export function useAICredits() {
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-credits/credits`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setCredits(data.credits);
      }
    } catch (err) {
      console.error('[useAICredits] Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    credits,
    loading,
    refresh,
    hasCredits: (credits?.balance || 0) > 0,
    isLow: (credits?.balance || 0) <= 10 && (credits?.balance || 0) > 0,
    isEmpty: (credits?.balance || 0) <= 0,
  };
}