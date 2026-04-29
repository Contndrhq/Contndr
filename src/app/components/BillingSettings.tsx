import { useState } from 'react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { useApiCache, apiCache } from '../lib/api-cache';
import { useTranslation } from 'react-i18next';
import { useRegionalPricing } from '../lib/useRegionalPricing';
import {
  Loader2,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  Shield,
  ArrowUpRight,
  ChevronDown,
} from 'lucide-react';

import { LoadingSpinner } from './LoadingSpinner';

interface BillingDetails {
  plan: string;
  status: string;
  isWhitelisted: boolean;
  stripe_sub_id: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  current_period_end: string | null;
  current_period_start: string | null;
  interval: string | null;
  updated_at: string | null;
}

// Feature keys for each plan (mapped to billingSettings.features.*)
const PLAN_FEATURE_KEYS: Record<string, { nameKey: string; price: number; featureKeys: string[] }> = {
  growth: {
    nameKey: 'upgradeModal.growth',
    price: 499,
    featureKeys: ['trackedLeads10k', 'fiveUserSeats', 'aiEmailCampaigns', 'basicAutomation', 'hubspotSalesforceSync', 'prioritySupport'],
  },
  scale: {
    nameKey: 'upgradeModal.scale',
    price: 999,
    featureKeys: ['trackedLeads50k', 'tenUserSeats', 'smartDiscoveryProspecting', 'aiAgentAdvancedWorkflows', 'revenueTrackingStripe', 'allIntegrationsIncluded', 'dedicatedSupport'],
  },
  enterprise: {
    nameKey: 'upgradeModal.enterprise',
    price: 2500,
    featureKeys: ['unlimitedLeads', 'unlimitedSeats', 'dedicatedAccountManager', 'customIntegrations', 'slaGuarantee', 'whiteGloveOnboarding', 'customWorkflows'],
  },
};

export function BillingSettings() {
  const { t, i18n } = useTranslation();
  const { market, getPlanPricing } = useRegionalPricing();
  const {
    data: billing,
    loading,
    error: billingError,
    refetch: refetchBilling,
  } = useApiCache<BillingDetails>(
    'billing:details',
    async () => {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/details`
      );
      if (!res.ok) {
        const errText = await res.text();
        console.error('[BILLING] Failed to fetch details:', errText);
        throw new Error(errText);
      }
      return res.json();
    },
    { staleTime: 60_000, cacheTime: 300_000 }
  );
  const [canceling, setCanceling] = useState(false);
  const [cancelStep, setCancelStep] = useState<0 | 1 | 2>(0); // 0=hidden, 1=confirm, 2=choose type
  const [cancelType, setCancelType] = useState<'end_of_period' | 'immediate'>('end_of_period');

  async function handleCancel() {
    setCanceling(true);
    try {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ immediate: cancelType === 'immediate' }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.cancel_at_period_end) {
          toast.success(t('billingSettings.cancelEndPeriod'));
        } else {
          toast.success(t('billingSettings.cancelImmediate'));
        }
        setCancelStep(0);
        apiCache.invalidate('billing:details');
        refetchBilling();
      } else {
        toast.error(data.error || t('billingSettings.cancelFailed'));
      }
    } catch (err) {
      console.error('[BILLING] Cancel error:', err);
      toast.error(t('billingSettings.networkError'));
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return <LoadingSpinner center size="md" />;
  }

  if (!billing) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        {t('billingSettings.unableToLoad')}
      </div>
    );
  }

  const isActive = billing.status === 'active';
  const isCanceled = billing.status === 'canceled';
  const isPendingCancel = billing.cancel_at_period_end && isActive;
  const planConfig = PLAN_FEATURE_KEYS[billing.plan] || null;
  const hasSubscription = billing.plan !== 'none' && billing.plan !== 'waitlist';

  // Get regional pricing for current plan
  const planPricing = (billing.plan === 'growth' || billing.plan === 'scale' || billing.plan === 'enterprise') 
    ? getPlanPricing(billing.plan as 'growth' | 'scale' | 'enterprise')
    : null;

  // Locale-aware date formatting
  const dateLocale = i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US';
  const periodEndFormatted = billing.current_period_end
    ? new Date(billing.current_period_end).toLocaleDateString(dateLocale, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  // Get translated plan name
  const planName = planConfig ? t(planConfig.nameKey) : '';

  // Get translated features
  const translatedFeatures = planConfig
    ? planConfig.featureKeys.map((key) => t(`billingSettings.features.${key}`))
    : [];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Current Plan Card */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-zinc-200 dark:border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-white/[0.06] flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('billingSettings.currentPlan')}</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {t('billingSettings.manageSubscription')}
                </p>
              </div>
            </div>

            {/* Status Badge */}
            {billing.isWhitelisted ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-white/[0.06] text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/[0.08]">
                <Shield className="w-3 h-3" />
                {t('billingSettings.complimentary')}
              </span>
            ) : isActive && !isPendingCancel ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 text-[#1ED4A7] dark:text-[#1ED4A7] border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7]" />
                {t('billingSettings.active')}
              </span>
            ) : isPendingCancel ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-500/20">
                <Clock className="w-3 h-3" />
                {t('billingSettings.cancelsSoon')}
              </span>
            ) : isCanceled ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-500/20">
                <XCircle className="w-3 h-3" />
                {t('billingSettings.canceled')}
              </span>
            ) : null}
          </div>
        </div>

        {/* Plan Details */}
        <div className="px-5 sm:px-6 py-5">
          {hasSubscription && planConfig ? (
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-600 uppercase tracking-wider font-medium">
                    {t('billingSettings.planLabel')}
                  </span>
                  <p className="text-xl font-bold text-zinc-900 dark:text-white mt-0.5">{planName}</p>
                </div>
                <div className="text-right">
                  {billing.isWhitelisted ? (
                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                      {t('billingSettings.complimentaryAccess')}
                    </span>
                  ) : planPricing ? (
                    <>
                      <span className="text-2xl font-bold text-zinc-900 dark:text-white">{planPricing.formattedMonthly}</span>
                      <span className="text-xs text-zinc-500">
                        /{billing.interval === 'year' ? t('billingSettings.yr') : t('billingSettings.mo')}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Features */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {translatedFeatures.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                    <CheckCircle className="w-3 h-3 text-[#1ED4A7] dark:text-[#1ED4A7]/60 flex-shrink-0" />
                    {feature}
                  </div>
                ))}
              </div>

              {/* Billing Period */}
              {periodEndFormatted && !billing.isWhitelisted && (
                <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-white/[0.04]">
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-600">
                    {isPendingCancel ? t('billingSettings.accessUntil') : t('billingSettings.nextBillingDate')}
                  </span>
                  <span className="text-[11px] text-zinc-700 dark:text-zinc-300 font-medium">
                    {periodEndFormatted}
                  </span>
                </div>
              )}

              {/* Complimentary access note */}
              {billing.isWhitelisted && (
                <div className="flex items-center gap-2 pt-3 border-t border-zinc-100 dark:border-white/[0.04]">
                  <Shield className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {t('billingSettings.complimentaryNote')}
                  </span>
                </div>
              )}

              {/* Pending Cancel Info */}
              {isPendingCancel && (
                <div className="flex items-start gap-2.5 p-3 bg-zinc-50/50 dark:bg-zinc-500/[0.04] border border-zinc-200/60 dark:border-zinc-500/10 rounded-lg">
                  <Clock className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400/80 leading-relaxed" dangerouslySetInnerHTML={{ 
                    __html: t('billingSettings.pendingCancelInfo', { date: periodEndFormatted || t('billingSettings.endOfPeriod') })
                  }} />
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                <CreditCard className="w-4 h-4 text-zinc-400 dark:text-zinc-600" />
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 font-medium">{t('billingSettings.noActivePlan')}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-1">
                {isCanceled
                  ? t('billingSettings.subscriptionEnded')
                  : t('billingSettings.choosePlan')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Cancel Subscription ── */}
      {isActive && hasSubscription && !billing.isWhitelisted && !isPendingCancel && (
        <div className="border border-zinc-200 dark:border-white/[0.06] rounded-xl overflow-hidden transition-all">
          {/* Default state: subtle inline link */}
          {cancelStep === 0 && (
            <button
              onClick={() => setCancelStep(1)}
              className="w-full px-5 sm:px-6 py-4 flex items-center justify-between group hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
            >
              <span className="text-[12px] text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-500 dark:group-hover:text-zinc-500 transition-colors">
                {t('billingSettings.cancelSubscription')}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-400 dark:group-hover:text-zinc-600 transition-colors" />
            </button>
          )}

          {/* Step 1: Confirmation */}
          {cancelStep === 1 && (
            <div className="px-5 sm:px-6 py-5 space-y-4">
              <div>
                <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white">
                  {t('billingSettings.areYouSure')}
                </h4>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-1 leading-relaxed">
                  {t('billingSettings.cancelLoseAccess', { plan: planName || t('billingSettings.yourPlan') })}
                </p>
              </div>

              {/* What you'll lose */}
              <div className="space-y-1.5">
                {translatedFeatures.slice(0, 4).map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-600">
                    <XCircle className="w-3 h-3 flex-shrink-0" />
                    <span className="line-through">{feature}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setCancelStep(2)}
                  className="px-4 py-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-500/20 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-500/[0.06] transition-all"
                >
                  {t('billingSettings.continueToCancelBtn')}
                </button>
                <button
                  onClick={() => setCancelStep(0)}
                  className="px-4 py-2 text-[11px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                >
                  {t('billingSettings.neverMind')}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Choose timing & confirm */}
          {cancelStep === 2 && (
            <div className="px-5 sm:px-6 py-5 space-y-4">
              <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white">
                {t('billingSettings.whenTakeEffect')}
              </h4>

              <div className="space-y-2">
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    cancelType === 'end_of_period'
                      ? 'border-zinc-300 dark:border-white/[0.12] bg-zinc-50 dark:bg-white/[0.03]'
                      : 'border-zinc-200 dark:border-white/[0.06] hover:border-zinc-300 dark:hover:border-white/[0.08]'
                  }`}
                >
                  <input
                    type="radio"
                    name="cancelType"
                    value="end_of_period"
                    checked={cancelType === 'end_of_period'}
                    onChange={() => setCancelType('end_of_period')}
                    className="mt-0.5 accent-zinc-900 dark:accent-white"
                  />
                  <div>
                    <p className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                      {t('billingSettings.endOfBillingPeriod')}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {t('billingSettings.keepAccessUntil', { date: periodEndFormatted || t('billingSettings.yourNextBillingDate') })}
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    cancelType === 'immediate'
                      ? 'border-zinc-300 dark:border-white/[0.12] bg-zinc-50 dark:bg-white/[0.03]'
                      : 'border-zinc-200 dark:border-white/[0.06] hover:border-zinc-300 dark:hover:border-white/[0.08]'
                  }`}
                >
                  <input
                    type="radio"
                    name="cancelType"
                    value="immediate"
                    checked={cancelType === 'immediate'}
                    onChange={() => setCancelType('immediate')}
                    className="mt-0.5 accent-zinc-900 dark:accent-white"
                  />
                  <div>
                    <p className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                      {t('billingSettings.cancelImmediately')}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {t('billingSettings.accessEndsNow')}
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleCancel}
                  disabled={canceling}
                  className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-[11px] font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-50"
                >
                  {canceling ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {canceling ? t('billingSettings.processing') : t('billingSettings.confirmCancellation')}
                </button>
                <button
                  onClick={() => { setCancelStep(0); setCancelType('end_of_period'); }}
                  disabled={canceling}
                  className="px-4 py-2 text-[11px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                >
                  {t('billingSettings.keepMyPlan')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stripe Dashboard Link */}
      {billing.stripe_sub_id && (
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] text-zinc-400 dark:text-zinc-700 font-mono">
            ID: {billing.stripe_sub_id}
          </p>
          <a
            href="https://billing.stripe.com/p/login/test"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            {t('billingSettings.manageInStripe')} <ArrowUpRight className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}