import { useState, useEffect, useCallback } from 'react';
import { Copy, Users, DollarSign, TrendingUp, CheckCircle, XCircle, Clock, ExternalLink, Loader2, Gift, ArrowUpRight, Link2, Check, Info, MousePointerClick, Percent, Wallet, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../lib/CurrencyContext';
import { LoadingSpinner } from './LoadingSpinner';
import { apiCache } from '../lib/api-cache';

interface AffiliateData {
  slug: string;
  commission_rate: number;
  status: string;
  created_at: string;
  paypal_email?: string;
  payout_method?: string;
}

interface ReferralEntry {
  id: string;
  referred_email: string;
  signed_up_at: string;
  converted_at?: string;
  plan?: string;
  monthly_commission?: number;
  status: 'signup' | 'converted' | 'active' | 'churned';
}

interface DashboardData {
  affiliate: AffiliateData;
  stats: {
    total_clicks: number;
    total_signups: number;
    total_conversions: number;
    total_earned: number;
    monthly_recurring: number;
  };
  referrals: ReferralEntry[];
}

export function AffiliateSettings() {
  const { t } = useTranslation();
  const { formatAmount, getPlanPrice } = useCurrency();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [copied, setCopied] = useState(false);
  const [customSlug, setCustomSlug] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);
  const [editingPayout, setEditingPayout] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await apiCache.fetch(
        'settings:affiliate',
        async () => {
          const res = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/dashboard`
          );
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );

      if (data.enrolled) {
        setEnrolled(true);
        setDashboard(data);
        setPaypalEmail(data.affiliate?.paypal_email || '');
      } else {
        setEnrolled(false);
      }
    } catch (err) {
      console.error('[AFFILIATE] Failed to load dashboard:', err);
      setEnrolled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleEnroll() {
    setEnrolling(true);
    try {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/enroll`,
        {
          method: 'POST',
          body: JSON.stringify({ slug: customSlug.trim() || undefined }),
        }
      );
      const data = await res.json();

      if (res.ok && data.success) {
        toast.success(t('affiliateView.welcomeAffiliate'));
        setEnrolled(true);
        await loadDashboard();
      } else {
        toast.error(data.error || t('common.failed'));
      }
    } catch (err) {
      toast.error(t('common.error'));
    } finally {
      setEnrolling(false);
    }
  }

  async function handleSavePayout() {
    if (!paypalEmail.trim()) return;
    setSavingPayout(true);
    try {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/update-payout`,
        {
          method: 'POST',
          body: JSON.stringify({ paypal_email: paypalEmail.trim() }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(t('affiliateView.payoutUpdated'));
        setEditingPayout(false);
        await loadDashboard();
      } else {
        toast.error(data.error || t('common.failed'));
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSavingPayout(false);
    }
  }

  function copyLink() {
    if (!dashboard?.affiliate?.slug) return;
    const link = `https://app.contndr.com?ref=${dashboard.affiliate.slug}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success(t('affiliateView.linkCopied'));
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return <LoadingSpinner center size="md" />;
  }

  // ─── Enrollment Screen ──────────────────────────────────────────────
  if (!enrolled) {
    return (
      <div className="space-y-8">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900/60 dark:to-black p-8">
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/5 dark:bg-zinc-950 rounded-full blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-5">
              <Gift className="w-3.5 h-3.5" />
              {t('affiliateView.affiliateProgram')}
            </div>

            <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-3">
              {t('affiliateView.earn10Lifetime')}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-lg leading-relaxed mb-8">
              {t('affiliateView.shareDesc')}
            </p>

            {/* Commission breakdown - displays 10% of plan prices in user's currency */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
              {[
                { plan: 'growth' as const, label: 'Growth' },
                { plan: 'scale' as const, label: 'Scale' },
                { plan: 'enterprise' as const, label: 'Enterprise' },
              ].map((tier) => {
                // Get base plan price and calculate 10% commission
                const basePriceStr = getPlanPrice(tier.plan, 'monthly');
                // Extract number from formatted price (e.g., "$99" -> 99, "€79" -> 79)
                const priceNum = parseFloat(basePriceStr.replace(/[^0-9.]/g, ''));
                const commission = priceNum * 0.10;
                const formattedCommission = formatAmount(commission, { showDecimals: true });
                
                return (
                  <div
                    key={tier.plan}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4"
                  >
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">
                      {tier.label}
                    </p>
                    <p className="text-lg font-bold text-zinc-900 dark:text-white">{formattedCommission}/mo</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{t('affiliateView.perReferralMonth')}</p>
                  </div>
                );
              })}
            </div>

            {/* Custom slug */}
            <div className="max-w-md mb-6">
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                {t('affiliateView.chooseSlug')}
              </label>
              <div className="flex items-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-400/20 transition-all">
                <span className="pl-3 pr-1 text-sm text-zinc-400 whitespace-nowrap select-none">contndr.com/r/</span>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="your-name"
                  className="flex-1 px-2 py-2.5 bg-transparent text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none"
                  maxLength={30}
                />
              </div>
              <p className="text-xs text-zinc-400 mt-1.5">
                {t('affiliateView.leaveBlank')}
              </p>
            </div>

            <button
              onClick={handleEnroll}
              disabled={enrolling}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-sm font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {enrolling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUpRight className="w-4 h-4" />
              )}
              {t('affiliateView.joinProgram')}
            </button>
          </div>
        </div>

        {/* How it works */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-black">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-5">{t('affiliateView.howItWorks')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                title: t('affiliateView.shareYourLink'),
                desc: t('affiliateView.shareYourLinkDesc'),
              },
              {
                step: '02',
                title: t('affiliateView.theySubscribe'),
                desc: t('affiliateView.theySubscribeDesc'),
              },
              {
                step: '03',
                title: t('affiliateView.earnForever'),
                desc: t('affiliateView.earnForeverDesc'),
              },
            ].map((s) => (
              <div key={s.step} className="flex gap-3">
                <span className="text-xs font-bold text-zinc-300 dark:text-zinc-700 mt-0.5">
                  {s.step}
                </span>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white mb-1">{s.title}</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Affiliate Dashboard ────────────────────────────────────────────
  const affiliate = dashboard?.affiliate;
  const stats = dashboard?.stats || {
    total_clicks: 0,
    total_signups: 0,
    total_conversions: 0,
    total_earned: 0,
    monthly_recurring: 0,
  };
  const referrals = dashboard?.referrals || [];
  const link = affiliate ? `https://app.contndr.com?ref=${affiliate.slug}` : '';

  return (
    <div className="space-y-6">
      {/* Referral Link */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-black">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="w-4 h-4 text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('affiliateView.yourReferralLink')}</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate select-all">
            {link}
          </div>
          <button
            onClick={copyLink}
            className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shrink-0"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
        <div className="flex items-center gap-1.5 mt-3">
          <Info className="w-3 h-3 text-zinc-400" />
          <p className="text-xs text-zinc-400">
            {t('affiliateView.shareInfo')}
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: t('affiliateView.clicks'),
            value: stats.total_clicks.toLocaleString(),
            icon: MousePointerClick,
            sub: t('affiliateView.totalLinkClicks'),
          },
          {
            label: t('affiliateView.signups'),
            value: stats.total_signups.toLocaleString(),
            icon: Users,
            sub: t('affiliateView.referredSignups'),
          },
          {
            label: t('affiliateView.conversions'),
            value: stats.total_conversions.toLocaleString(),
            icon: TrendingUp,
            sub: t('affiliateView.paidSubscribers'),
          },
          {
            label: t('affiliateView.monthlyRecurring'),
            value: formatAmount(stats.monthly_recurring),
            icon: DollarSign,
            sub: t('affiliateView.your10Share'),
          },
        ].map((s) => (
          <div
            key={s.label}
            className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-black"
          >
            <div className="flex items-center gap-2 mb-3">
              <s.icon className="w-4 h-4 text-zinc-400" />
              <span className="text-xs text-zinc-500 font-medium">{s.label}</span>
            </div>
            <p className="text-xl font-bold text-zinc-900 dark:text-white">{s.value}</p>
            <p className="text-[11px] text-zinc-400 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Total Earned Banner */}
      {stats.total_earned > 0 && (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-zinc-50 dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-500 font-medium mb-1">{t('affiliateView.lifetimeEarnings')}</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums">
                {formatAmount(stats.total_earned)}
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full">
              <Percent className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{t('affiliateView.tenPercentLifetime')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Payout Settings */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-black">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('affiliateView.payoutDetails')}</h3>
          </div>
          {!editingPayout && affiliate?.paypal_email && (
            <button
              onClick={() => setEditingPayout(true)}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              {t('common.edit')}
            </button>
          )}
        </div>

        {!affiliate?.paypal_email || editingPayout ? (
          <div className="space-y-3 max-w-md">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                {t('affiliateView.paypalEmail')}
              </label>
              <input
                type="email"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/20 transition-all"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSavePayout}
                disabled={savingPayout || !paypalEmail.trim()}
                className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {savingPayout && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t('common.save')}
              </button>
              {editingPayout && (
                <button
                  onClick={() => {
                    setEditingPayout(false);
                    setPaypalEmail(affiliate?.paypal_email || '');
                  }}
                  className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  {t('common.cancel')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
            <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-zinc-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                {affiliate.paypal_email}
              </p>
              <p className="text-xs text-zinc-400">PayPal</p>
            </div>
            <Check className="w-4 h-4 text-[#1ED4A7]" />
          </div>
        )}
        <p className="text-xs text-zinc-400 mt-3 flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {t('affiliateView.payoutsProcessed')}
        </p>
      </div>

      {/* Referrals Table */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-black">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('affiliateView.referrals')}</h3>
        </div>
        {referrals.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Users className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">{t('affiliateView.noReferralsYet')}</p>
            <p className="text-xs text-zinc-400 mt-1">{t('affiliateView.shareToStart')}</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {referrals.map((r) => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-500 uppercase">
                  {r.referred_email?.[0] || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                    {r.referred_email}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {t('affiliateView.signedUp')} {new Date(r.signed_up_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {r.status === 'active' || r.status === 'converted' ? (
                    <>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {formatAmount(r.monthly_commission || 0)}/mo
                      </p>
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#1ED4A7] dark:text-[#1ED4A7] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7]" />
                        {r.plan || t('common.active')}
                      </span>
                    </>
                  ) : r.status === 'churned' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-400 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                      {t('affiliateView.churned')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-400 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                      {t('affiliateView.signedUp')}
                    </span>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-700" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Share Prompt */}
      <div className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-5 text-center">
        <p className="text-sm text-zinc-500 mb-3">
          {t('affiliateView.spreadTheWord')}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`I've been using @contndr for cold outreach and it's a game changer. Try it out: ${link}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            {t('affiliateView.shareOnX')} <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            {t('affiliateView.shareOnLinkedIn')} <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={copyLink}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <Copy className="w-3 h-3" />
            {t('affiliateView.copyLink')}
          </button>
        </div>
      </div>
    </div>
  );
}