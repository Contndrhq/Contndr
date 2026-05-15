/**
 * ElevenLabsUsagePanel — Pro plan character usage + model info panel.
 * Shows subscription tier, character consumption, reset date, and available models.
 * Designed for the admin dashboard or AI settings area.
 *
 * Gracefully handles missing subscription data (e.g. API key without user_read
 * permission) by still showing voice/agent stats and an actionable warning.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, RefreshCw, Mic, Zap, BarChart3, Volume2,
  AlertCircle, CheckCircle2, TrendingUp, Bot, Clock,
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { useTranslation } from 'react-i18next';

interface Subscription {
  tier: string;
  character_count: number;
  character_limit: number;
  can_use_agents: boolean;
  available_models: { key: string; model_id: string }[];
  next_invoice: number | null;
}

interface VoiceStats {
  total: number;
  premade: number;
  cloned: number;
  professional: number;
}

interface AgentStats {
  total: number;
  names: string[];
}

export function ElevenLabsUsagePanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [voiceStats, setVoiceStats] = useState<VoiceStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subWarning, setSubWarning] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    setSubWarning(null);
    try {
      const headers = await getAuthHeaders();
      const base = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/elevenlabs`;

      const [subRes, voicesRes, agentsRes] = await Promise.all([
        fetch(`${base}/subscription`, { headers }).catch(() => null),
        fetch(`${base}/voices`, { headers }).catch(() => null),
        fetch(`${base}/agents`, { headers }).catch(() => null),
      ]);

      if (subRes && subRes.ok) {
        const data = await subRes.json();
        if (data.subscription) {
          setSubscription(data.subscription);
        } else {
          const detail = data.details || data.error || '';
          if (typeof detail === 'string' && detail.includes('missing_permissions')) {
            setSubWarning('API key missing user_read permission — update key in ElevenLabs dashboard');
          } else {
            setSubWarning(data.error || 'Subscription data unavailable');
          }
          console.warn('[ElevenLabs Usage] Subscription not available:', data.error || 'unknown');
        }
      } else if (subRes) {
        console.warn('[ElevenLabs Usage] Subscription endpoint returned', subRes.status);
        setSubWarning('Could not fetch subscription info');
      }

      if (voicesRes && voicesRes.ok) {
        const data = await voicesRes.json();
        const voices = data.voices || [];
        setVoiceStats({
          total: voices.length,
          premade: voices.filter((v: any) => v.category === 'premade').length,
          cloned: voices.filter((v: any) => v.category === 'cloned' || v.isCloned).length,
          professional: voices.filter((v: any) => v.category === 'professional').length,
        });
      }

      if (agentsRes && agentsRes.ok) {
        const data = await agentsRes.json();
        const agents = data.agents || [];
        setAgentStats({
          total: agents.length,
          names: agents.map((a: any) => a.name).slice(0, 5),
        });
      }
    } catch (err: any) {
      console.error('[ElevenLabs Usage] Error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    if (compact) return null;
    return (
      <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  // If we have no data at all, hide the panel entirely
  const hasAnyData = subscription || voiceStats || agentStats;
  if (!hasAnyData && !subWarning) return null;

  // Derived values — all null-safe
  const usedPct = subscription && subscription.character_limit > 0
    ? Math.min(100, (subscription.character_count / subscription.character_limit) * 100)
    : 0;
  const remaining = subscription
    ? Math.max(0, subscription.character_limit - subscription.character_count)
    : 0;
  const resetDate = subscription?.next_invoice
    ? new Date(subscription.next_invoice * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  const isHigh = subscription ? usedPct > 80 : false;
  const isCritical = subscription ? usedPct > 95 : false;
  const tierLabel = subscription?.tier || 'unknown';

  // ─── Compact mode: inline badge for AICalls header ───
  if (compact) {
    if (!subscription) {
      // No subscription data — show a minimal voice count badge instead
      if (!voiceStats && !agentStats) return null;
      return (
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
          <Volume2 className="w-3 h-3 text-[#1ED4A7]" />
          <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">{voiceStats?.total || 0}</span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600">{t('elevenlabs.voicesLabel')}</span>
        </div>
      );
    }
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
        <Volume2 className={`w-3 h-3 ${isCritical ? 'text-red-400' : isHigh ? 'text-amber-400' : 'text-[#1ED4A7]'}`} />
        <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">
          {remaining.toLocaleString()}
        </span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600">{t('elevenlabs.charsLabel')}</span>
        <span className={`text-[9px] px-1 py-0.5 rounded font-bold uppercase tracking-wider ${
          tierLabel === 'pro' ? 'bg-[#1ED4A7]/15 text-[#1ED4A7]' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
        }`}>
          {tierLabel}
        </span>
      </div>
    );
  }

  const tierColors: Record<string, string> = {
    free: 'bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300',
    starter: 'bg-blue-500/20 text-blue-500 dark:text-blue-400',
    creator: 'bg-purple-500/20 text-purple-500 dark:text-purple-400',
    pro: 'bg-[#1ED4A7]/15 text-[#1ED4A7]',
    scale: 'bg-amber-500/20 text-amber-500 dark:text-amber-400',
    enterprise: 'bg-red-500/20 text-red-500 dark:text-red-400',
    unknown: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400',
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#1ED4A7]/10 flex items-center justify-center">
            <Volume2 className="w-4 h-4 text-[#1ED4A7]" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              ElevenLabs
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${tierColors[tierLabel] || tierColors.unknown}`}>
                {tierLabel}
              </span>
            </h3>
            <p className="text-[10px] text-zinc-500">{t('elevenlabs.voiceConversationalAI')}</p>
          </div>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Character Usage Bar — only shown when subscription data is available */}
        {subscription && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('elevenlabs.characterUsage')}</span>
              <span className={`text-[10px] font-bold ${isCritical ? 'text-red-400' : isHigh ? 'text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {usedPct.toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isCritical ? 'bg-red-500' : isHigh ? 'bg-amber-400' : 'bg-[#1ED4A7]'
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-zinc-500">
                {subscription.character_count.toLocaleString()} / {subscription.character_limit.toLocaleString()}
              </span>
              <span className="text-[10px] text-zinc-500">
                {t('elevenlabs.remaining', { count: remaining.toLocaleString() })}
              </span>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className={`grid gap-2.5 ${subscription ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
          <div className="bg-zinc-100 dark:bg-zinc-800/40 rounded-lg p-2.5 sm:p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Mic className="w-3 h-3 text-zinc-500" />
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium">{t('elevenlabs.voices')}</span>
            </div>
            <p className="text-lg font-bold text-zinc-900 dark:text-white">{voiceStats?.total || 0}</p>
            <p className="text-[9px] text-zinc-400 dark:text-zinc-600 mt-0.5">
              {t('elevenlabs.cloned', { count: voiceStats?.cloned || 0 })}
            </p>
          </div>

          <div className="bg-zinc-100 dark:bg-zinc-800/40 rounded-lg p-2.5 sm:p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Bot className="w-3 h-3 text-zinc-500" />
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium">{t('elevenlabs.agents')}</span>
            </div>
            <p className="text-lg font-bold text-zinc-900 dark:text-white">{agentStats?.total || 0}</p>
            <p className="text-[9px] text-zinc-400 dark:text-zinc-600 mt-0.5">
              {subscription ? (subscription.can_use_agents ? t('elevenlabs.agentsActive') : t('elevenlabs.upgradeRequired')) : t('elevenlabs.configured', { count: agentStats?.total || 0 })}
            </p>
          </div>

          {subscription && (
            <div className="bg-zinc-100 dark:bg-zinc-800/40 rounded-lg p-2.5 sm:p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3 h-3 text-zinc-500" />
                <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium">{t('elevenlabs.models')}</span>
              </div>
              <p className="text-lg font-bold text-zinc-900 dark:text-white">{subscription.available_models?.length || 0}</p>
              <p className="text-[9px] text-zinc-400 dark:text-zinc-600 mt-0.5">{t('elevenlabs.available')}</p>
            </div>
          )}

          {subscription && (
            <div className="bg-zinc-100 dark:bg-zinc-800/40 rounded-lg p-2.5 sm:p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="w-3 h-3 text-zinc-500" />
                <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium">{t('elevenlabs.resets')}</span>
              </div>
              <p className="text-sm font-bold text-zinc-900 dark:text-white mt-1">{resetDate || 'N/A'}</p>
              <p className="text-[9px] text-zinc-400 dark:text-zinc-600 mt-0.5">{t('elevenlabs.nextCycle')}</p>
            </div>
          )}

          {/* Show voice breakdown when no subscription */}
          {!subscription && voiceStats && (
            <div className="bg-zinc-100 dark:bg-zinc-800/40 rounded-lg p-2.5 sm:p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3 h-3 text-zinc-500" />
                <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium">{t('elevenlabs.breakdown')}</span>
              </div>
              <p className="text-[10px] text-zinc-600 dark:text-zinc-300 mt-1">{t('elevenlabs.premade', { count: voiceStats.premade })}</p>
              <p className="text-[10px] text-zinc-600 dark:text-zinc-300">{t('elevenlabs.pro', { count: voiceStats.professional })}</p>
            </div>
          )}
        </div>

        {/* Agent list */}
        {agentStats && agentStats.total > 0 && (
          <div className="pt-1">
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('elevenlabs.activeAgents')}</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {agentStats.names.map((name, i) => (
                <span key={i} className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[10px] text-zinc-600 dark:text-zinc-300 font-medium">
                  {name}
                </span>
              ))}
              {agentStats.total > 5 && (
                <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800/50 rounded text-[10px] text-zinc-500">
                  {t('elevenlabs.more', { count: agentStats.total - 5 })}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Warning if high usage */}
        {isHigh && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs ${
            isCritical ? 'bg-red-500/5 border-red-500/20 text-red-400' : 'bg-amber-500/5 border-amber-500/20 text-amber-400'
          }`}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{isCritical ? t('elevenlabs.characterLimitReached') : t('elevenlabs.highCharacterUsage')}</p>
              <p className="text-[10px] mt-0.5 opacity-80">
                {isCritical
                  ? t('elevenlabs.criticalWarning')
                  : t('elevenlabs.highUsageWarning')}
              </p>
            </div>
          </div>
        )}

        {/* Subscription warning (e.g. missing API key permission) */}
        {subWarning && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs bg-amber-500/5 border-amber-500/20 text-amber-400">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{t('elevenlabs.subscriptionUnavailable')}</p>
              <p className="text-[10px] mt-0.5 opacity-80">{subWarning}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ElevenLabsUsagePanel;