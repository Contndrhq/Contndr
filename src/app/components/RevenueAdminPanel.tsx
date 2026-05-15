import { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { fmtUSD } from '../lib/format';
import { Loader2, RefreshCw, DollarSign, TrendingUp, Users as UsersIcon, Download, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingSpinner } from './LoadingSpinner';

export function RevenueAdminPanel({ searchTerm }: { searchTerm: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'canceled'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all_types' | 'stripe' | 'team' | 'bypass' | 'internal'>('all_types');

  useEffect(() => {
    fetchRevenue();
  }, []);

  async function fetchRevenue() {
    setRefreshing(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/revenue`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setSummary(data.summary || null);
        setSubscribers(data.subscribers || []);
        if (data.healed > 0) {
          toast.success(`Stripe Reconciliation`, {
            description: `Auto-healed ${data.healed} subscriber record(s) from Stripe — they now count toward revenue.`,
          });
        }
      } else {
        const err = await response.json().catch(() => ({}));
        console.error('[REVENUE] Fetch failed:', err);
        toast.error('Failed to load revenue data');
      }
    } catch (err) {
      console.error('[REVENUE] Fetch error:', err);
      toast.error('Network error loading revenue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const filtered = subscribers.filter(sub => {
    const matchesSearch = !searchTerm ||
      sub.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.plan?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
    const matchesPayment = paymentFilter === 'all_types' || sub.payment_type === paymentFilter;
    return matchesSearch && matchesStatus && matchesPayment;
  });

  function downloadRevenueCSV() {
    const csvHeaders = ['Email', 'Name', 'Plan', 'Billing', 'Payment Type', 'Paying', 'MRR', 'Billing Amount', 'List Price/mo', 'Status', 'Stripe Sub ID', 'Lifetime Months', 'Lifetime Revenue', 'Affiliate', 'Aff. Commission/mo'];
    const csvContent = [
      csvHeaders.join(','),
      ...filtered.map(sub => [
        sub.email,
        `"${sub.name || ''}"`,
        sub.plan,
        sub.billing_interval || 'monthly',
        sub.payment_type || 'unknown',
        sub.is_paying ? 'Yes' : 'No',
        sub.mrr ?? sub.plan_price,
        sub.billing_amount || 0,
        sub.list_price || sub.plan_price,
        sub.status,
        sub.stripe_sub_id || '',
        sub.lifetime_months || 0,
        sub.lifetime_revenue || 0,
        sub.affiliate?.affiliate_email || '',
        sub.affiliate?.monthly_commission || 0,
      ].join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `contndr_revenue_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Revenue CSV exported');
  }

  if (loading) {
    return <LoadingSpinner center size="md" />;
  }

  const paymentTypeLabel: Record<string, string> = {
    stripe: 'Stripe',
    team: 'Team Member',
    internal: 'Internal',
    bypass: 'Admin Bypass',
  };
  const paymentTypeColor: Record<string, string> = {
    stripe: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20',
    team: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-500/10 dark:border-blue-500/20',
    internal: 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20',
    bypass: 'text-gray-600 bg-gray-100 border-gray-200 dark:text-zinc-400 dark:bg-zinc-500/10 dark:border-zinc-500/20',
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Revenue Summary Cards */}
      {summary && (
        <>
          {/* Primary metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-shrink-0">
            {[
              {
                icon: DollarSign,
                label: 'Gross MRR',
                value: fmtUSD(summary.total_mrr),
                sub: `ARR: ${fmtUSD(summary.total_arr)}`,
                accent: true,
              },
              {
                icon: DollarSign,
                label: 'Net MRR',
                value: fmtUSD(summary.net_mrr),
                sub: `After ${fmtUSD(summary.total_affiliate_commission_mrr)} affiliate comm.`,
                accent: false,
              },
              {
                icon: UsersIcon,
                label: 'Paying Subscribers',
                value: String(summary.paying_active_count ?? summary.active_count),
                sub: (() => {
                  const np = summary.non_paying_breakdown;
                  const parts: string[] = [];
                  if (np?.team) parts.push(`${np.team} team`);
                  if (np?.bypass) parts.push(`${np.bypass} bypass`);
                  if (np?.internal) parts.push(`${np.internal} internal`);
                  const nonPayingStr = parts.length > 0 ? ` | ${parts.join(', ')}` : '';
                  return `of ${summary.active_count} active${nonPayingStr} | ${summary.canceled_count} canceled`;
                })(),
                accent: false,
              },
              {
                icon: TrendingUp,
                label: 'Lifetime Revenue',
                value: fmtUSD(summary.total_lifetime_revenue),
                sub: 'Stripe-processed payments only',
                accent: false,
              },
            ].map(card => (
              <div key={card.label} className="bg-white dark:bg-black border border-gray-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm dark:shadow-none">
                <div className="flex items-center gap-2 mb-2">
                  <card.icon className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-600" />
                  <span className="text-[10px] text-gray-500 dark:text-zinc-500 font-medium uppercase tracking-wider">{card.label}</span>
                </div>
                <p className={`text-2xl font-bold ${card.accent ? 'text-[#1ED4A7]' : 'text-gray-900 dark:text-white'}`}>{card.value}</p>
                <p className="text-[10px] text-gray-400 dark:text-zinc-600 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Plan breakdown cards */}
          <div className="grid grid-cols-3 gap-3 flex-shrink-0">
            {(['growth', 'scale', 'enterprise'] as const).map(plan => {
              const pb = summary.plan_breakdown?.[plan] || { count: 0, mrr: 0 };
              const price = plan === 'growth' ? 499 : plan === 'scale' ? 999 : 2500;
              return (
                <div key={plan} className="bg-white dark:bg-black border border-gray-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-sm dark:shadow-none">
                  <div className="flex items-center justify-between mb-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border capitalize bg-gray-100 text-gray-700 border-gray-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800">
                      {plan}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-zinc-600 font-mono">
                      list ${price}/mo
                    </span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{pb.count || 0}</p>
                      <p className="text-[10px] text-gray-400 dark:text-zinc-600">subscribers</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">${(pb.mrr || 0).toLocaleString()}</p>
                      <p className="text-[10px] text-gray-400 dark:text-zinc-600">MRR</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div className="text-[10px] text-gray-500 dark:text-zinc-500 font-mono uppercase tracking-widest">
            All Subscribers
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
              {(['all', 'active', 'canceled'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all capitalize whitespace-nowrap ${
                    statusFilter === f
                      ? 'bg-white dark:bg-white/[0.08] text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
              {(['all_types', 'stripe', 'team', 'bypass', 'internal'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setPaymentFilter(f)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all capitalize whitespace-nowrap ${
                    paymentFilter === f
                      ? 'bg-white dark:bg-white/[0.08] text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {f === 'all_types' ? 'all types' : f}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={downloadRevenueCSV}
            className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-zinc-800 rounded-lg text-[11px] font-medium text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors shadow-sm dark:shadow-none"
          >
            <Download className="w-3 h-3" /> Export CSV
          </button>
          <button
            onClick={fetchRevenue}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-zinc-800 rounded-lg text-[11px] font-medium text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-colors disabled:opacity-50 shadow-sm dark:shadow-none"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Subscribers — Desktop table / Mobile cards */}
      {/* Desktop table */}
      <div className="flex-1 overflow-auto bg-white dark:bg-black border border-gray-200 dark:border-zinc-800 rounded-xl hidden md:block shadow-sm dark:shadow-none">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50 dark:bg-zinc-950 sticky top-0 z-10 border-b border-gray-200 dark:border-zinc-800">
            <tr>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest">Subscriber</th>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest">Plan</th>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest text-center">Status</th>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest text-right">MRR / Billing</th>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest text-center">Months</th>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest text-right">Lifetime Rev</th>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest">Affiliate</th>
              <th className="px-5 py-3 text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-widest">Stripe ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
            {filtered.map(sub => {
              const isActive = sub.status === 'active';
              const isPaying = sub.is_paying;
              const rowOpacity = !isPaying && isActive ? 'opacity-60' : '';
              return (
                <tr key={sub.user_id} className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors ${rowOpacity}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-zinc-900 flex items-center justify-center text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase flex-shrink-0">
                        {sub.email?.[0] || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 dark:text-zinc-200 truncate">{sub.name || sub.email}</p>
                        {sub.name && <p className="text-[10px] text-gray-400 dark:text-zinc-600 truncate">{sub.email}</p>}
                        <p className="text-[9px] text-gray-400 dark:text-zinc-700">
                          Joined {sub.user_created_at ? new Date(sub.user_created_at).toLocaleDateString() : 'N/A'}
                          {sub.last_sign_in_at && ` | Last: ${new Date(sub.last_sign_in_at).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border capitalize bg-gray-100 text-gray-700 border-gray-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800 w-fit">
                        {sub.plan || 'none'}
                      </span>
                      {sub.payment_type && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border w-fit ${paymentTypeColor[sub.payment_type] || paymentTypeColor.bypass}`}>
                          {paymentTypeLabel[sub.payment_type] || sub.payment_type}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <div className="inline-flex items-center gap-1.5 text-[10px] font-medium">
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-zinc-600'}`} />
                      <span className={isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-zinc-500'}>
                        {sub.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {isPaying ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`text-sm font-semibold tabular-nums ${isActive ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-zinc-600 line-through'}`}>
                          {fmtUSD(sub.mrr ?? sub.plan_price)}<span className="text-[9px] font-normal text-zinc-400 dark:text-zinc-600">/mo</span>
                        </span>
                        {sub.billing_interval === 'yearly' ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20">
                            Yearly — {fmtUSD(sub.billing_amount || 0)}/yr
                          </span>
                        ) : (
                          <span className="text-[9px] text-zinc-400 dark:text-zinc-600">Monthly</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-semibold tabular-nums text-gray-400 dark:text-zinc-600">$0</span>
                        {sub.list_price > 0 && (
                          <span className="text-[9px] text-gray-400 dark:text-zinc-700 line-through">{fmtUSD(sub.list_price)}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="text-xs font-medium text-gray-600 dark:text-zinc-400 tabular-nums">
                      {sub.lifetime_months || '--'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={`text-xs font-semibold tabular-nums ${isPaying ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-zinc-700'}`}>
                      ${(sub.lifetime_revenue || 0).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {sub.affiliate ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Link2 className="w-3 h-3 text-gray-400 dark:text-zinc-600" />
                          <span className="text-[10px] font-medium text-gray-700 dark:text-zinc-300 truncate max-w-[100px]" title={sub.affiliate.affiliate_email}>
                            {sub.affiliate.affiliate_name || sub.affiliate.affiliate_email}
                          </span>
                        </div>
                        <span className="text-[9px] text-gray-400 dark:text-zinc-600 pl-[18px]">
                          {(sub.affiliate.commission_rate * 100).toFixed(0)}% = ${sub.affiliate.monthly_commission}/mo
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-400 dark:text-zinc-700">Direct</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {sub.stripe_sub_id ? (
                      <span className="text-[9px] font-mono text-gray-400 dark:text-zinc-600 truncate block max-w-[140px]" title={sub.stripe_sub_id}>
                        {sub.stripe_sub_id}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400 dark:text-zinc-700 italic">None</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="p-12 text-center text-gray-500 dark:text-zinc-600 text-sm">
                  {subscribers.length === 0 ? 'No subscribers found.' : 'No subscribers matching your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="flex-1 overflow-auto md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-black border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm dark:shadow-none">
            <p className="text-gray-500 dark:text-zinc-600 text-sm">
              {subscribers.length === 0 ? 'No subscribers found.' : 'No subscribers matching your filters.'}
            </p>
          </div>
        ) : (
          filtered.map(sub => {
            const isActive = sub.status === 'active';
            const isPaying = sub.is_paying;
            return (
              <div key={sub.user_id} className="bg-white dark:bg-black border border-gray-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm dark:shadow-none">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-zinc-900 flex items-center justify-center text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase flex-shrink-0">
                      {sub.email?.[0] || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-zinc-200 truncate">{sub.name || sub.email}</p>
                      {sub.name && <p className="text-[11px] text-gray-400 dark:text-zinc-600 truncate">{sub.email}</p>}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-[10px] font-medium flex-shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-zinc-600'}`} />
                    <span className={isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-zinc-500'}>
                      {sub.status}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border capitalize bg-gray-100 text-gray-700 border-gray-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800">
                    {sub.plan || 'none'}
                  </span>
                  {sub.payment_type && (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${paymentTypeColor[sub.payment_type] || paymentTypeColor.bypass}`}>
                      {paymentTypeLabel[sub.payment_type] || sub.payment_type}
                    </span>
                  )}
                </div>
                {isPaying && sub.billing_interval === 'yearly' && (
                  <div className="mt-2">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20">
                      Yearly — ${sub.billing_amount?.toLocaleString()}/yr
                    </span>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[9px] text-gray-400 dark:text-zinc-600 uppercase tracking-wider">MRR</p>
                    <p className={`text-sm font-semibold tabular-nums ${isPaying ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-zinc-600'}`}>
                      {isPaying ? `$${sub.mrr ?? sub.plan_price}` : '$0'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 dark:text-zinc-600 uppercase tracking-wider">Months</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-zinc-400 tabular-nums">{sub.lifetime_months || '--'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 dark:text-zinc-600 uppercase tracking-wider">Lifetime</p>
                    <p className={`text-sm font-semibold tabular-nums ${isPaying ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-zinc-700'}`}>
                      ${(sub.lifetime_revenue || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
                {sub.affiliate && (
                  <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-white/[0.04] flex items-center gap-1.5">
                    <Link2 className="w-3 h-3 text-gray-400 dark:text-zinc-600 flex-shrink-0" />
                    <span className="text-[10px] text-gray-500 dark:text-zinc-500 truncate">
                      {sub.affiliate.affiliate_name || sub.affiliate.affiliate_email} ({(sub.affiliate.commission_rate * 100).toFixed(0)}% = ${sub.affiliate.monthly_commission}/mo)
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-1 text-[10px] text-gray-400 dark:text-zinc-700 text-right font-mono uppercase tracking-wider flex-shrink-0">
        {filtered.length} subscriber{filtered.length !== 1 ? 's' : ''} shown
        {statusFilter !== 'all' && ` (${statusFilter})`}
        {summary && ` | MRR ${fmtUSD(summary.total_mrr)} | Net ${fmtUSD(summary.net_mrr)}`}
      </div>
    </div>
  );
}