import { useState, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, X, Loader2, ArrowLeft, LogOut, Sparkles, ChevronDown, ArrowRight } from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { useTranslation } from 'react-i18next';
import { useRegionalPricing } from '../lib/useRegionalPricing';

// ---------------------------------------------------------------------------
// Lazy Stripe initialiser
// ---------------------------------------------------------------------------
let _stripeInstance: Promise<Stripe | null> | null = null;

async function fetchPublishableKey(): Promise<string | null> {
  try {
    // @ts-ignore
    const envKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (envKey) return envKey;
  } catch {}

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Stripe] Fetching config from backend (attempt ${attempt})...`);
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/config`,
        { headers: { 'Authorization': `Bearer ${publicAnonKey}` } }
      );
      if (response.ok) {
        const data = await response.json();
        if (data.publishableKey) {
          console.log('[Stripe] Loaded publishable key from backend');
          return data.publishableKey;
        }
      } else {
        console.warn(`[Stripe] Backend config fetch failed: ${response.status}`);
      }
    } catch (e) {
      console.warn(`[Stripe] Config fetch attempt ${attempt} failed:`, e);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 500));
  }
  return null;
}

function getStripePromise(): Promise<Stripe | null> {
  if (!_stripeInstance) {
    _stripeInstance = (async () => {
      const key = await fetchPublishableKey();
      if (!key) {
        console.error('[Stripe] CRITICAL: No publishable key found.');
        _stripeInstance = null;
        return null;
      }
      return loadStripe(key);
    })();
  }
  return _stripeInstance;
}

// ---------------------------------------------------------------------------
// Plan recommendation engine
// ---------------------------------------------------------------------------
type PlanKey = 'growth' | 'scale' | 'enterprise';

// Plan capacity limits (hard constraints)
const PLAN_LEAD_CAP: Record<PlanKey, number> = { growth: 10000, scale: 50000, enterprise: Infinity };
const PLAN_SEAT_CAP: Record<PlanKey, number> = { growth: 5, scale: 10, enterprise: Infinity };
const PLAN_TIER: Record<PlanKey, number> = { growth: 1, scale: 2, enterprise: 3 };

function computeRecommendation(user: any): { plan: PlanKey; reasons: string[] } | null {
  const meta = user?.user_metadata;
  if (!meta) return null;

  const { monthlyLeadVolume, teamSize, annualRevenue } = meta;
  if (!monthlyLeadVolume && !teamSize && !annualRevenue) return null;

  // ── 1. Determine hard FLOOR from lead volume ──
  let floor: PlanKey = 'growth';
  let leadReason = '';

  if (monthlyLeadVolume) {
    switch (monthlyLeadVolume) {
      case '0_1000':
        floor = 'growth'; leadReason = 'Under 1k leads/mo'; break;
      case '1000_5000':
        floor = 'growth'; leadReason = '1k–5k leads/mo'; break;
      case '5000_20000':
        floor = 'scale'; leadReason = '5k–20k leads/mo'; break;
      case '20000_plus':
        floor = 'enterprise'; leadReason = '20k+ leads/mo'; break;
    }
  }

  // ── 2. Determine hard FLOOR from team size ──
  let teamFloor: PlanKey = 'growth';
  let teamReason = '';

  if (teamSize) {
    switch (teamSize) {
      case '1_5':
        teamFloor = 'growth'; teamReason = '1–5 team members'; break;
      case '6_20':
        teamFloor = 'scale'; teamReason = '6–20 team members'; break;
      case '21_50':
        teamFloor = 'enterprise'; teamReason = '21–50 team members'; break;
      case '51_plus':
        teamFloor = 'enterprise'; teamReason = '51+ team members'; break;
    }
  }

  // Take the higher of the two floors
  const effectiveFloor = PLAN_TIER[teamFloor] > PLAN_TIER[floor] ? teamFloor : floor;

  // ── 3. Soft signals can only UPGRADE from the floor ──
  let recommended: PlanKey = effectiveFloor;
  const reasons: string[] = [];

  if (PLAN_TIER[effectiveFloor] === PLAN_TIER[teamFloor] && teamReason && PLAN_TIER[teamFloor] > PLAN_TIER[floor]) {
    reasons.push(teamReason);
    if (leadReason) reasons.push(leadReason);
  } else {
    if (leadReason) reasons.push(leadReason);
    if (teamReason && teamReason !== leadReason) reasons.push(teamReason);
  }

  // Revenue can push UP from floor, never down
  if (annualRevenue) {
    let revSuggestion: PlanKey = 'growth';
    let revReason = '';
    switch (annualRevenue) {
      case '0_500k':
        revSuggestion = 'growth'; revReason = 'Early-stage revenue'; break;
      case '500k_1m':
        revSuggestion = 'growth'; revReason = '$500k–$1M revenue'; break;
      case '1m_5m':
        revSuggestion = 'scale'; revReason = '$1M–$5M revenue'; break;
      case '5m_plus':
        revSuggestion = 'enterprise'; revReason = '$5M+ revenue'; break;
    }
    if (PLAN_TIER[revSuggestion] > PLAN_TIER[recommended]) {
      recommended = revSuggestion;
      const bestSupporting = reasons[0];
      reasons.length = 0;
      reasons.push(revReason);
      if (bestSupporting) reasons.push(bestSupporting);
    } else if (PLAN_TIER[revSuggestion] === PLAN_TIER[recommended] && revReason && reasons.length < 2) {
      reasons.push(revReason);
    }
  }

  // Cap reasons at 2
  return { plan: recommended, reasons: reasons.slice(0, 2) };
}

// ---------------------------------------------------------------------------
// Feature keys for plan features (shared with BillingSettings)
// ---------------------------------------------------------------------------
const GROWTH_FEATURE_KEYS = [
  'trackedLeads10k',
  'fiveUserSeats',
  'aiEmailCampaigns',
  'basicAutomation',
  'hubspotSalesforceSync',
  'prioritySupport'
];

const SCALE_FEATURE_KEYS = [
  'trackedLeads50k',
  'tenUserSeats',
  'smartDiscoveryProspecting',
  'aiAgentAdvancedWorkflows',
  'revenueTrackingStripe',
  'allIntegrationsIncluded',
  'dedicatedSupport'
];

const ENTERPRISE_FEATURE_KEYS = [
  'unlimitedLeads',
  'unlimitedSeats',
  'dedicatedAccountManager',
  'customIntegrations',
  'slaGuarantee',
  'whiteGloveOnboarding',
  'customWorkflows'
];

// ---------------------------------------------------------------------------
// Comparison feature keys
// ---------------------------------------------------------------------------
const COMPARISON_KEYS = {
  growth_vs_scale: [
    { featureKey: 'leadCapacity', growthVal: '10,000', scaleVal: '50,000' },
    { featureKey: 'userSeats', growthVal: '5', scaleVal: '10' },
    { featureKey: 'prospecting', growthKey: 'standard', scaleKey: 'smartDiscoveryAI' },
    { featureKey: 'aiAgent', growthVal: '—', scaleKey: 'advancedWorkflows' },
    { featureKey: 'revenueTracking', growthVal: '—', scaleKey: 'stripeIntegration' },
    { featureKey: 'support', growthKey: 'priority', scaleKey: 'dedicated' },
  ],
  scale_vs_enterprise: [
    { featureKey: 'leadCapacity', scaleVal: '50,000', enterpriseKey: 'unlimited' },
    { featureKey: 'userSeats', scaleVal: '10', enterpriseKey: 'unlimited' },
    { featureKey: 'accountManagement', scaleVal: '—', enterpriseKey: 'dedicatedCSM' },
    { featureKey: 'integrations', scaleKey: 'allIncluded', enterpriseKey: 'customAPI' },
    { featureKey: 'sla', scaleVal: '—', enterpriseKey: 'guaranteed' },
    { featureKey: 'onboarding', scaleKey: 'standard', enterpriseKey: 'whiteGlove' },
  ],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan?: string;
  forced?: boolean;
  user?: any;
}

export function UpgradeModal({ isOpen, onClose, currentPlan, forced = false, user }: UpgradeModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<string | null>(null);
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('yearly');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showComparison, setShowComparison] = useState<'growth_vs_scale' | 'scale_vs_enterprise' | null>(null);
  const savedRef = useRef(false);

  const recommendation = useMemo(() => computeRecommendation(user), [user]);

  // Regional pricing hook
  const { market, loading: marketLoading, setMarket, getPlanPricing } = useRegionalPricing();

  // Persist recommendation to server for admin analytics
  useEffect(() => {
    if (!recommendation || !isOpen || savedRef.current) return;
    savedRef.current = true;

    (async () => {
      try {
        const headers = await getAuthHeaders();
        await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/save-recommendation`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recommendedPlan: recommendation.plan,
              reasons: recommendation.reasons,
            }),
          }
        );
        console.log(`[UPGRADE] Recommendation saved: ${recommendation.plan}`);
      } catch (err) {
        console.warn('[UPGRADE] Failed to save recommendation:', err);
      }
    })();
  }, [recommendation, isOpen]);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      onClose();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleUpgrade = async (plan: PlanKey) => {
    setLoading(plan);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/checkout`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan,
            interval,
            embedded: true,
            returnUrl: window.location.href,
            recommendedPlan: recommendation?.plan || null,
            market, // Add market for regional pricing
          })
        }
      );

      if (!response.ok) {
        const text = await response.text();
        console.error('Checkout failed:', response.status, text);
        try {
           const json = JSON.parse(text);
           alert(json.error || t('upgradeModal.checkoutFailedStatus', { status: response.status }));
        } catch {
           alert(`${t('upgradeModal.checkoutFailedStatus', { status: response.status })}: ${text.substring(0, 100)}`);
        }
        return;
      }

      const data = await response.json();
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setShowCheckout(true);
      } else {
        console.error('Checkout failed: No clientSecret returned', data);
        alert(data.error || t('upgradeModal.failedToStartCheckout'));
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert(t('upgradeModal.checkoutFailed'));
    } finally {
      setLoading(null);
    }
  };

  const handleClose = () => {
    if (forced) return;
    onClose();
    setTimeout(() => {
      setShowCheckout(false);
      setClientSecret(null);
    }, 300);
  };

  const handleBack = () => {
    setShowCheckout(false);
    setClientSecret(null);
  };

  const getButtonText = (targetPlan: PlanKey, defaultForcedText: string) => {
    if (currentPlan === targetPlan) return t('upgradeModal.currentPlan');
    if (forced) return defaultForcedText;
    const levels: Record<string, number> = { growth: 1, scale: 2, enterprise: 3 };
    const currentLevel = levels[currentPlan || ''] || 0;
    const targetLevel = levels[targetPlan];
    const planName = t(`upgradeModal.${targetPlan}`);
    if (currentLevel > targetLevel) return t('upgradeModal.downgradeTo', { plan: planName });
    return t('upgradeModal.upgradeTo', { plan: planName });
  };

  const isRecommended = (plan: PlanKey) => recommendation?.plan === plan;

  // Build translated feature arrays for each plan
  const getTranslatedFeatures = (keys: string[]) => keys.map(k => t(`billingSettings.features.${k}`));

  // Build plans with regional pricing
  const plans = useMemo(() => {
    return [
      {
        key: 'growth' as PlanKey,
        name: t('upgradeModal.growth'),
        pricing: getPlanPricing('growth'),
        features: getTranslatedFeatures(GROWTH_FEATURE_KEYS),
        forcedCta: t('upgradeModal.secureSpot'),
      },
      {
        key: 'scale' as PlanKey,
        name: t('upgradeModal.scale'),
        pricing: getPlanPricing('scale'),
        features: getTranslatedFeatures(SCALE_FEATURE_KEYS),
        forcedCta: t('upgradeModal.secureSpot'),
      },
      {
        key: 'enterprise' as PlanKey,
        name: t('upgradeModal.enterprise'),
        pricing: getPlanPricing('enterprise'),
        features: getTranslatedFeatures(ENTERPRISE_FEATURE_KEYS),
        forcedCta: t('upgradeModal.secureSpot'),
      },
    ];
  }, [t, getPlanPricing]);

  // Helper to get comparison cell values (translated)
  const getComparisonValue = (row: any, side: string) => {
    const valKey = `${side}Val`;
    const transKey = `${side}Key`;
    if (row[valKey] !== undefined) return row[valKey];
    if (row[transKey]) return t(`upgradeModal.comparison.${row[transKey]}`);
    return '—';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="relative z-[10000]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="fixed inset-0 bg-black/80 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />

          <div className="fixed inset-0 overflow-y-auto pt-safe sm:pt-0" data-no-mobile-fix>
            <div className="flex min-h-full items-start sm:items-center justify-center p-2 sm:p-6 pb-[max(env(safe-area-inset-bottom),12px)] text-center">
              <motion.div
                className="w-full max-w-5xl transform overflow-hidden rounded-2xl sm:rounded-[2rem] bg-[#0A0A0A] p-5 sm:p-8 text-left align-middle shadow-2xl transition-all border border-white/10 relative flex flex-col mt-4 sm:mt-0 mb-[max(env(safe-area-inset-bottom),16px)] sm:mb-0"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >

                {!forced && (
                  <div className="absolute right-6 z-10" style={{ top: 'max(env(safe-area-inset-top, 24px), 24px)' }}>
                    <button onClick={handleClose} className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                )}

                {showCheckout && clientSecret ? (
                  <div className="w-full h-full flex flex-col">
                    <div className="mb-6 flex items-center justify-center relative">
                      <button onClick={handleBack} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors absolute left-0">
                        <ArrowLeft className="w-5 h-5" />
                        <span>{t('upgradeModal.backToPlans')}</span>
                      </button>
                      <span className="text-white font-bold text-lg">{t('upgradeModal.checkout')}</span>
                    </div>
                    <div className="flex-1 w-full bg-white rounded-xl overflow-hidden min-h-[500px]">
                      <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret }}>
                        <EmbeddedCheckout className="h-full w-full" />
                      </EmbeddedCheckoutProvider>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-center mb-3 sm:mb-5 mt-2 sm:mt-4 px-4 sm:px-12">
                      {forced ? (
                        <>
                          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-white tracking-tighter mb-1.5 sm:mb-2">
                            {t('upgradeModal.chooseYourPlan')}
                          </h2>
                          {recommendation ? (
                            <p className="text-xs sm:text-sm text-gray-400 mb-1">
                              {t('upgradeModal.pickedBasedOnProfile', { reasons: recommendation.reasons.join(' & ').toLowerCase() })}
                            </p>
                          ) : (
                            <p className="text-xs sm:text-sm text-gray-400 mb-4">
                              {t('upgradeModal.notChargedUntilActivated')}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <h2 className="text-xl sm:text-3xl md:text-4xl font-bold text-white tracking-tighter mb-1.5 sm:mb-2">
                            {t('upgradeModal.upgradeWorkspace')}
                          </h2>
                          {recommendation ? (
                            <p className="text-xs sm:text-base text-gray-400 mb-1"
                              dangerouslySetInnerHTML={{
                                __html: t('upgradeModal.basedOnRecommend', {
                                  reasons: recommendation.reasons.join(' & ').toLowerCase(),
                                  plan: recommendation.plan.charAt(0).toUpperCase() + recommendation.plan.slice(1),
                                }).replace(/<1>(.*?)<\/1>/, '<span class="text-white font-semibold">$1</span>')
                              }}
                            />
                          ) : (
                            <p className="text-xs sm:text-base text-gray-400 mb-4">
                              {t('upgradeModal.unlockPotential')}
                            </p>
                          )}
                        </>
                      )}

                      {/* Interval Toggle */}
                      <div className="inline-flex items-center p-1 bg-white/5 rounded-full border border-white/10 mt-2 sm:mt-3">
                        <button
                          onClick={() => setInterval('monthly')}
                          className={`px-4 sm:px-6 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold transition-all ${
                            interval === 'monthly' ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'
                          }`}
                        >{t('upgradeModal.monthly')}</button>
                        <button
                          onClick={() => setInterval('yearly')}
                          className={`px-4 sm:px-6 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 sm:gap-2 ${
                            interval === 'yearly' ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          {t('upgradeModal.yearly')} <span className={`text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${interval === 'yearly' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-emerald-400'}`}>{t('upgradeModal.save20')}</span>
                        </button>
                      </div>


                    </div>

                    {/* Plan Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 px-2 sm:px-4 md:px-6">
                      {plans.map((plan) => {
                        const rec = isRecommended(plan.key);
                        const isCurrent = currentPlan === plan.key;
                        const elevated = rec || (!recommendation && plan.key === 'growth');
                        const planLevel: Record<PlanKey, number> = { growth: 1, scale: 2, enterprise: 3 };
                        const recLevel = recommendation ? planLevel[recommendation.plan] : 0;
                        const thisLevel = planLevel[plan.key];
                        const dimmed = recommendation && !rec && !isCurrent && thisLevel < recLevel - 1;

                        return (
                          <div
                            key={plan.key}
                            className={`relative px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6 rounded-2xl transition-all flex flex-col text-left ${
                              elevated
                                ? 'bg-white text-black shadow-[0_0_60px_-20px_rgba(255,255,255,0.08)]'
                                : isCurrent
                                ? 'bg-white/5 border border-white/30'
                                : 'bg-black border border-white/10 hover:border-white/20'
                            } ${dimmed ? 'opacity-50' : ''}`}
                          >
                            {rec && (
                              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 bg-black text-white text-[10px] font-semibold rounded-full uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap">
                                <Sparkles className="w-3 h-3 text-[#1ED4A7]" />
                                {t('upgradeModal.tailoredForYou')}
                              </div>
                            )}
                            {!recommendation && plan.key === 'growth' && (
                              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 bg-black text-white text-[10px] font-semibold rounded-full uppercase tracking-wider">
                                {t('upgradeModal.mostPopular')}
                              </div>
                            )}

                            <h3 className={`text-base sm:text-lg font-semibold mb-1.5 sm:mb-2 ${elevated ? '!text-black' : 'text-white'}`}>
                              {plan.name}
                            </h3>

                            <div className="flex flex-col mb-3 sm:mb-4">
                              <div className="flex items-baseline gap-1">
                                <span className={`text-2xl sm:text-3xl font-bold tabular-nums ${elevated ? '!text-black' : 'text-white'}`}>
                                  {interval === 'yearly' ? plan.pricing.formattedYearlyMonthly : plan.pricing.formattedMonthly}
                                </span>
                                <span className="text-sm sm:text-base text-zinc-500 font-normal">{t('upgradeModal.mo')}</span>
                              </div>
                              {interval === 'yearly' && (
                                <span className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">{t('upgradeModal.billedYearly', { amount: plan.pricing.formattedYearlyBilled })}</span>
                              )}
                            </div>

                            {/* Why this plan callout */}
                            {rec && recommendation && (
                              <div className="mb-4 px-3 py-2 rounded-lg bg-black/[0.04] border border-black/[0.06]">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-0.5">{t('upgradeModal.whyThisPlan')}</div>
                                <div className="text-[12px] text-zinc-600 leading-snug">
                                  {recommendation.reasons.map((r, i) => (
                                    <span key={r}>
                                      {i > 0 && <span className="text-zinc-400 mx-1">&middot;</span>}
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <ul className="space-y-1.5 sm:space-y-2.5 mb-4 sm:mb-5 flex-1">
                              {plan.features.map((feature, idx) => (
                                <li key={idx} className={`flex items-start gap-2 sm:gap-2.5 text-[12px] sm:text-[13px] leading-snug ${elevated ? 'text-zinc-600' : 'text-zinc-300'}`}>
                                  <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${elevated ? '!text-black' : 'text-emerald-400/70'}`} />
                                  <span>{feature}</span>
                                </li>
                              ))}
                            </ul>

                            <button
                              onClick={() => handleUpgrade(plan.key)}
                              disabled={loading !== null || isCurrent}
                              className={`w-full py-2.5 sm:py-3 rounded-xl text-[13px] sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 mt-auto ${
                                isCurrent
                                  ? elevated ? 'bg-black/10 text-zinc-400 cursor-default' : 'bg-white/10 text-zinc-400 cursor-default'
                                  : elevated
                                  ? 'bg-black text-white hover:bg-zinc-800 shadow-xl'
                                  : 'border border-white/20 text-white hover:bg-white hover:text-black'
                              }`}
                            >
                              {loading === plan.key ? <Loader2 className="animate-spin" /> : null}
                              {getButtonText(plan.key, plan.forcedCta)}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* "Not sure?" comparison toggles */}
                    <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-6 px-4 md:px-8 mt-6 mb-2">
                      <button
                        onClick={() => setShowComparison(showComparison === 'growth_vs_scale' ? null : 'growth_vs_scale')}
                        className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors ${
                          showComparison === 'growth_vs_scale' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {t('upgradeModal.growthVsScale')}
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showComparison === 'growth_vs_scale' ? 'rotate-180' : ''}`} />
                      </button>
                      <span className="hidden md:inline text-zinc-700">|</span>
                      <button
                        onClick={() => setShowComparison(showComparison === 'scale_vs_enterprise' ? null : 'scale_vs_enterprise')}
                        className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors ${
                          showComparison === 'scale_vs_enterprise' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {t('upgradeModal.scaleVsEnterprise')}
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showComparison === 'scale_vs_enterprise' ? 'rotate-180' : ''}`} />
                      </button>
                    </div>

                    {/* Comparison table */}
                    {showComparison && (() => {
                      const rows = COMPARISON_KEYS[showComparison];
                      const isGrowthVsScale = showComparison === 'growth_vs_scale';
                      const leftSide = isGrowthVsScale ? 'growth' : 'scale';
                      const rightSide = isGrowthVsScale ? 'scale' : 'enterprise';
                      const leftLabel = isGrowthVsScale ? t('upgradeModal.growth') : t('upgradeModal.scale');
                      const rightLabel = isGrowthVsScale ? t('upgradeModal.scale') : t('upgradeModal.enterprise');

                      return (
                        <div className="px-4 md:px-8 pb-4 mt-2">
                          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
                            <table className="w-full text-left">
                              <thead>
                                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                                  <th className="px-4 md:px-5 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider w-[40%]">{t('upgradeModal.feature')}</th>
                                  <th className="px-4 md:px-5 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider w-[30%]">{leftLabel}</th>
                                  <th className="px-4 md:px-5 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider w-[30%]">{rightLabel}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/[0.04]">
                                {rows.map((row: any) => {
                                  const leftVal = getComparisonValue(row, leftSide);
                                  const rightVal = getComparisonValue(row, rightSide);
                                  const rightBetter = leftVal === '—' && rightVal !== '—';
                                  const featureLabel = t(`upgradeModal.comparison.${row.featureKey}`);

                                  return (
                                    <tr key={row.featureKey} className="hover:bg-white/[0.01]">
                                      <td className="px-4 md:px-5 py-3 text-[13px] text-zinc-400 font-medium">{featureLabel}</td>
                                      <td className={`px-4 md:px-5 py-3 text-[13px] ${leftVal === '—' ? 'text-zinc-700' : 'text-zinc-300'}`}>
                                        {leftVal}
                                      </td>
                                      <td className={`px-4 md:px-5 py-3 text-[13px] font-medium ${rightBetter ? 'text-white' : rightVal === '—' ? 'text-zinc-700' : 'text-zinc-300'}`}>
                                        {rightBetter && <span className="inline-block w-1 h-1 rounded-full bg-[#1ED4A7] mr-1.5 align-middle" />}
                                        {rightVal}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex justify-center py-4">
                      <button onClick={handleSignOut} className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors opacity-60 hover:opacity-100">
                        <LogOut className="w-4 h-4" />
                        <span>{t('upgradeModal.signOut')}</span>
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}