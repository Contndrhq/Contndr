// Rebuild trigger: 2026-03-05 — fix stale dynamic import chunk after KV retry hardening
import { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { fmtUSDCents } from '../lib/format';
import {
  Loader2, RefreshCw, CheckCircle, Search, Download, Check, X,
  UserX, Trash2, Mail, Zap, RotateCcw, Link2, MousePointerClick,
  Users as UsersIcon, TrendingUp, DollarSign, ChevronDown, ChevronUp,
  Copy, Wallet, ExternalLink, BarChart3, Eye, Database, AlertTriangle,
  UserPlus, EyeOff, Percent, Shield, Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import { LoadingSpinner } from './LoadingSpinner';
import { RevenueAdminPanel } from './RevenueAdminPanel';
import { TrackingAnalytics } from './TrackingAnalytics';
import { RoleManagement } from './RoleManagement';
import { CronHealthPanel } from './CronHealthPanel';
import { SalesAdminPanel } from './SalesAdminPanel';
import { AdminEventCenter } from './AdminEventCenter';
import { AdminLeadBrowser } from './AdminLeadBrowser';

// ─── Admin Credit Management Modal ──────────────────────────────────
function AdminCreditModal({ user, onClose }: { user: { id: string; email: string; user_metadata: any; subscription: any }; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState<any>(null);
  const [log, setLog] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const QUICK_AMOUNTS = [10, 25, 50, 100, 250, 500];

  async function loadCredits() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-credits/credits/admin-view/${user.id}`,
        { headers }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setCredits(data.credits);
        setLog(data.log || []);
      } else {
        console.error('[ADMIN CREDITS] Load error:', data.error);
      }
    } catch (err) {
      console.error('[ADMIN CREDITS] Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCredits(); }, [user.id]);

  async function handleAdjust(adjustAmount: number) {
    if (adjustAmount === 0) return;
    setAdjusting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-credits/credits/admin-adjust`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_user_id: user.id,
            amount: adjustAmount,
            reason: reason.trim() || `Admin added ${adjustAmount} credits`,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to adjust credits');
      toast.success(`${adjustAmount > 0 ? '+' : ''}${adjustAmount} credits applied`, {
        description: `New balance: ${data.credits?.balance ?? '?'} credits`,
      });
      setCredits(data.credits);
      setAmount('');
      setReason('');
      loadCredits();
    } catch (err: any) {
      toast.error(err.message || 'Failed to adjust credits');
    } finally {
      setAdjusting(false);
    }
  }

  const parsedAmount = parseInt(amount) || 0;
  const planLabel = credits?.plan || user.subscription?.plan || 'none';
  const isGrowthOrEnterprise = planLabel === 'growth' || planLabel === 'enterprise';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#0A0A0A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-white/[0.06] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">AI Credits</h3>
              <p className="text-[11px] text-zinc-500 truncate">{user.user_metadata?.name || user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
            </div>
          ) : (
            <>
              {/* Balance Card */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Current Balance</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                    isGrowthOrEnterprise
                      ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                  }`}>
                    <span className="capitalize">{planLabel}</span>
                  </span>
                </div>
                <div className="flex items-end gap-2 mb-3">
                  <span className={`text-3xl font-bold tabular-nums ${credits?.balance > 0 ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-600'}`}>
                    {credits?.balance ?? 0}
                  </span>
                  <span className="text-sm text-zinc-500 mb-0.5">credits</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                    <div className="text-[9px] text-zinc-600 uppercase">Monthly</div>
                    <div className="text-xs font-semibold text-zinc-300">{credits?.monthly_allocation ?? 0}</div>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                    <div className="text-[9px] text-zinc-600 uppercase">Bonus</div>
                    <div className="text-xs font-semibold text-zinc-300">{credits?.bonus_credits ?? 0}</div>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                    <div className="text-[9px] text-zinc-600 uppercase">Used</div>
                    <div className="text-xs font-semibold text-zinc-300">{credits?.used_this_period ?? 0}</div>
                  </div>
                </div>
              </div>

              {/* Quick Add */}
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2.5">Quick Add</div>
                <div className="grid grid-cols-3 gap-2">
                  {QUICK_AMOUNTS.map(qty => (
                    <button
                      key={qty}
                      onClick={() => handleAdjust(qty)}
                      disabled={adjusting}
                      className="group relative px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-[#1ED4A7]/5 hover:border-[#1ED4A7]/20 text-white text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <span className="text-[#1ED4A7] text-[10px] font-bold absolute top-1.5 left-2.5">+</span>
                      {qty}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Amount */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Custom Adjustment</div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 100 or -50"
                    className="flex-1 bg-zinc-50 dark:bg-[#111] border border-zinc-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-teal-500/30 dark:focus:border-[#1ED4A7]/30 tabular-nums"
                  />
                  <button
                    onClick={() => handleAdjust(parsedAmount)}
                    disabled={adjusting || parsedAmount === 0}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {adjusting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : parsedAmount >= 0 ? 'Add' : 'Deduct'}
                  </button>
                </div>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (optional) — e.g. Comp for issue, bonus, etc."
                  className="w-full bg-zinc-50 dark:bg-[#111] border border-zinc-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-teal-500/30 dark:focus:border-[#1ED4A7]/30"
                />
                {parsedAmount < 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-400/80">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>Negative values deduct credits from the user's balance.</span>
                  </div>
                )}
              </div>

              {/* Credit Log */}
              <div>
                <button
                  onClick={() => setShowLog(!showLog)}
                  className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold hover:text-zinc-300 transition-colors w-full"
                >
                  {showLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Credit History ({log.length})
                </button>
                {showLog && (
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {log.length === 0 ? (
                      <p className="text-[11px] text-zinc-600 py-3 text-center">No credit history</p>
                    ) : (
                      log.map((entry: any) => (
                        <div key={entry.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                entry.type === 'admin_adjust' ? 'bg-amber-500/10 text-amber-400' :
                                entry.type === 'allocation' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                                entry.type === 'deduction' ? 'bg-red-500/10 text-red-400' :
                                entry.type === 'topup' ? 'bg-blue-500/10 text-blue-400' :
                                'bg-zinc-500/10 text-zinc-400'
                              }`}>
                                {entry.type.replace('_', ' ')}
                              </span>
                              <span className="text-[10px] text-zinc-600 truncate">{entry.description}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <div className={`text-xs font-bold tabular-nums ${entry.amount > 0 ? 'text-[#1ED4A7]' : entry.amount < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                              {entry.amount > 0 ? '+' : ''}{entry.amount}
                            </div>
                            <div className="text-[9px] text-zinc-600">{new Date(entry.timestamp).toLocaleDateString()}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  businessType: string;
  monthlyLeadVolume: string;
  teamSize?: string;
  annualRevenue?: string;
  created_at: string;
  status: string;
  recommended_plan?: string;
  recommendation_reasons?: string[];
}

const TEAM_SIZE_LABELS: Record<string, string> = {
  '1_5': '1–5', '6_20': '6–20', '21_50': '21–50', '51_plus': '51+'
};
const REVENUE_LABELS: Record<string, string> = {
  '0_500k': '<$500k', '500k_1m': '$500k–1m', '1m_5m': '$1m–5m', '5m_plus': '$5m+'
};

interface User {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string;
  user_metadata: any;
  subscription: any;
  leadCount?: number;
  leadLimit?: number;
}

// ─── Affiliate Admin Panel (sub-component) ──────────────────────────
function AffiliateAdminPanel({
  affiliates,
  totals,
  expandedAffiliate,
  setExpandedAffiliate,
  searchTerm,
  refreshing,
  onRefresh,
}: {
  affiliates: any[];
  totals: any;
  expandedAffiliate: string | null;
  setExpandedAffiliate: (id: string | null) => void;
  searchTerm: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newAff, setNewAff] = useState({ name: '', email: '', password: '', custom_slug: '', commission_rate: 10 });
  const [createdResult, setCreatedResult] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = affiliates.filter(a =>
    a.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.slug?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Compute platform-wide subscriber earnings summary
  const allReferrals = affiliates.flatMap(a => (a.referrals || []).map((r: any) => ({ ...r, affiliate_name: a.name, affiliate_email: a.email, affiliate_slug: a.slug, commission_rate: a.commission_rate })));
  const activeSubscribers = allReferrals.filter((r: any) => r.status === 'active' || r.status === 'converted');
  const churnedSubscribers = allReferrals.filter((r: any) => r.status === 'churned');

  function copySlug(slug: string) {
    navigator.clipboard.writeText(`https://contndr.com/r/${slug}`);
    toast.success('Link copied');
  }

  async function handleCreateExternal(e: React.FormEvent) {
    e.preventDefault();
    if (!newAff.name || !newAff.email || !newAff.password) return;
    setCreating(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/affiliates/create-external`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newAff.name,
            email: newAff.email,
            password: newAff.password,
            custom_slug: newAff.custom_slug || undefined,
            commission_rate: (newAff.commission_rate || 10) / 100,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create affiliate');
      setCreatedResult(data.affiliate);
      toast.success(`Affiliate ${data.affiliate.name} created!`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create affiliate');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteExternal(userId: string) {
    if (!confirm('Delete this external affiliate? This will remove their login and all data.')) return;
    setDeletingId(userId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/affiliates/${userId}`,
        { method: 'DELETE', headers }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      toast.success('Affiliate deleted');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      {/* Summary Stats */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 flex-shrink-0">
          {[
            { label: 'Affiliates', value: String(totals.total_affiliates), icon: UsersIcon, color: '' },
            { label: 'Total Clicks', value: totals.total_clicks.toLocaleString(), icon: MousePointerClick, color: '' },
            { label: 'Signups', value: totals.total_signups.toLocaleString(), icon: TrendingUp, color: '' },
            { label: 'Paying Subscribers', value: String(activeSubscribers.length), icon: CheckCircle, color: 'text-[#1ED4A7]' },
            { label: 'Monthly Commission', value: fmtUSDCents(totals.total_monthly_recurring), icon: DollarSign, color: 'text-[#1ED4A7]' },
            { label: 'Lifetime Owed', value: fmtUSDCents(totals.total_earned), icon: Wallet, color: '' },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-3.5 shadow-sm dark:shadow-none">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{s.label}</span>
              </div>
              <p className={`text-lg font-bold ${s.color || 'text-white'}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 flex-shrink-0">
        <div className="text-xs text-zinc-500 font-mono uppercase tracking-widest">
          Affiliate Partners &amp; Subscriber Earnings
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowCreateModal(true); setCreatedResult(null); setNewAff({ name: '', email: '', password: '', custom_slug: '', commission_rate: 10 }); }}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 text-white dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 dark:text-black rounded-lg text-xs font-medium transition-colors"
          >
            <UserPlus className="w-3 h-3" />
            Create External Affiliate
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Create External Affiliate Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Create External Affiliate</h3>
                <p className="text-xs text-zinc-500 mt-0.5">For influencers & partners — they get a portal login with tracking only</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {createdResult ? (
              <div className="p-6">
                <div className="text-center mb-5">
                  <div className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-white" />
                  </div>
                  <h4 className="text-lg font-bold text-white">Affiliate Created!</h4>
                  <p className="text-sm text-zinc-400 mt-1">Share these credentials with the affiliate partner</p>
                </div>
                <div className="space-y-3 bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Name</span>
                    <p className="text-sm font-medium text-white mt-0.5">{createdResult.name}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Login Email</span>
                    <p className="text-sm font-mono text-white mt-0.5">{createdResult.email}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Password</span>
                    <p className="text-sm font-mono text-white mt-0.5">{newAff.password}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Portal URL</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm font-mono text-zinc-300 flex-1 truncate">{window.location.origin}/affiliate</p>
                      <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/affiliate`); toast.success('Portal URL copied'); }} className="p-1 rounded hover:bg-zinc-700"><Copy className="w-3.5 h-3.5 text-zinc-500" /></button>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Referral Link</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm font-mono text-zinc-300 flex-1 truncate">{createdResult.referral_link}</p>
                      <button onClick={() => { navigator.clipboard.writeText(createdResult.referral_link); toast.success('Referral link copied'); }} className="p-1 rounded hover:bg-zinc-700"><Copy className="w-3.5 h-3.5 text-zinc-500" /></button>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Commission Rate</span>
                    <p className="text-sm font-medium text-white mt-0.5">{(createdResult.commission_rate * 100).toFixed(0)}%</p>
                  </div>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(`Affiliate Portal Login:\nURL: ${window.location.origin}/affiliate\nEmail: ${createdResult.email}\nPassword: ${newAff.password}\nReferral Link: ${createdResult.referral_link}\nCommission: ${(createdResult.commission_rate * 100).toFixed(0)}%`); toast.success('All credentials copied to clipboard'); }}
                  className="w-full mt-4 py-2.5 bg-zinc-900 text-white dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 dark:text-black text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" /> Copy All Credentials
                </button>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="w-full mt-2 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium rounded-xl transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateExternal} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={newAff.name}
                    onChange={e => setNewAff({ ...newAff, name: e.target.value })}
                    className="w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/40"
                    placeholder="e.g. John Smith"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Email *</label>
                  <input
                    type="email"
                    value={newAff.email}
                    onChange={e => setNewAff({ ...newAff, email: e.target.value })}
                    className="w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/40"
                    placeholder="influencer@email.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Password *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newAff.password}
                      onChange={e => setNewAff({ ...newAff, password: e.target.value })}
                      className="w-full px-3 py-2.5 pr-10 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/40"
                      placeholder="Min 6 characters"
                      minLength={6}
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Custom Slug</label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-zinc-600">/r/</span>
                      <input
                        type="text"
                        value={newAff.custom_slug}
                        onChange={e => setNewAff({ ...newAff, custom_slug: e.target.value })}
                        className="flex-1 px-3 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/40"
                        placeholder="auto-generated"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Commission %</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={newAff.commission_rate}
                        onChange={e => setNewAff({ ...newAff, commission_rate: parseInt(e.target.value) || 10 })}
                        className="w-full px-3 py-2.5 pr-8 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500/40"
                        min={1}
                        max={50}
                      />
                      <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    </div>
                  </div>
                </div>
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-xs text-zinc-400">
                  The affiliate will log in at <span className="font-mono font-medium text-zinc-300">/affiliate</span> with their email and password. They can only see their tracking dashboard — no platform access.
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={creating || !newAff.name || !newAff.email || !newAff.password}
                    className="flex-1 py-2.5 bg-zinc-900 text-white dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 dark:text-black disabled:text-zinc-400 dark:disabled:text-zinc-600 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    {creating ? 'Creating...' : 'Create Affiliate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Mobile Affiliate Cards */}
      <div className="flex-1 overflow-auto md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl shadow-sm dark:shadow-none">
            <p className="text-zinc-600 text-sm">
              {affiliates.length === 0 ? 'No affiliates enrolled yet.' : 'No affiliates matching your search.'}
            </p>
          </div>
        ) : (
          filtered.map((aff: any) => (
            <div key={aff.userId} className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-4 shadow-sm dark:shadow-none">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{aff.name || 'Unknown'}</p>
                    {aff.is_external && <span className="px-1.5 py-0.5 text-[9px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 rounded">External</span>}
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5 truncate">{aff.email}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => copySlug(aff.slug)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    {aff.slug}
                  </button>
                  {aff.is_external && (
                    <button
                      onClick={() => handleDeleteExternal(aff.userId)}
                      disabled={deletingId === aff.userId}
                      className="p-1 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-500/10 rounded transition-colors"
                      title="Delete external affiliate"
                    >
                      {deletingId === aff.userId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider">Clicks</p>
                  <p className="text-sm font-bold text-white tabular-nums">{(aff.stats?.total_clicks || aff.stats?.clicks || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider">Signups</p>
                  <p className="text-sm font-bold text-white tabular-nums">{(aff.stats?.total_signups || aff.stats?.signups || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider">MRR</p>
                  <p className="text-sm font-bold text-[#1ED4A7] tabular-nums">{fmtUSDCents(aff.stats?.monthly_recurring || 0)}</p>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center justify-between">
                <span className="text-[10px] text-zinc-600">
                  {(aff.commission_rate * 100).toFixed(0)}% commission &bull; Total: {fmtUSDCents(aff.stats?.total_earned || 0)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop Affiliates Table */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl hidden md:block shadow-sm dark:shadow-none">
        <table className="w-full text-left border-collapse">
          <thead className="bg-zinc-50 dark:bg-[#111] sticky top-0 z-10 border-b border-zinc-200 dark:border-white/5">
            <tr>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Affiliate</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Slug / Link</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">Clicks</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">Signups</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">Conversions</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">MRR Owed</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">Total Earned</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Payout</th>
              <th className="px-5 py-3.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {filtered.map((aff) => (
              <AffiliateRow
                key={aff.userId}
                affiliate={aff}
                isExpanded={expandedAffiliate === aff.userId}
                onToggle={() => setExpandedAffiliate(expandedAffiliate === aff.userId ? null : aff.userId)}
                onCopyLink={() => copySlug(aff.slug)}
                onDelete={aff.is_external ? () => handleDeleteExternal(aff.userId) : undefined}
                deleting={deletingId === aff.userId}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="p-12 text-center text-gray-500 dark:text-zinc-600 text-sm">
                  {affiliates.length === 0 ? 'No affiliates enrolled yet.' : 'No affiliates matching your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-1 text-[10px] text-zinc-600 text-right uppercase tracking-wider flex-shrink-0">
        Total: {affiliates.length} affiliate{affiliates.length !== 1 ? 's' : ''} | {activeSubscribers.length} active subscriber{activeSubscribers.length !== 1 ? 's' : ''} | {churnedSubscribers.length} churned
      </div>
    </div>
  );
}

function AffiliateRow({
  affiliate,
  isExpanded,
  onToggle,
  onCopyLink,
  onDelete,
  deleting,
}: {
  affiliate: any;
  isExpanded: boolean;
  onToggle: () => void;
  onCopyLink: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const stats = affiliate.stats || {};
  const referrals = affiliate.referrals || [];
  const hasReferrals = referrals.length > 0;

  return (
    <>
      <tr className="hover:bg-white/[0.02] transition-colors group">
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="font-medium text-sm text-zinc-900 dark:text-zinc-200">{affiliate.name || 'Unknown'}</div>
            {affiliate.is_external && <span className="px-1.5 py-0.5 text-[9px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 rounded">External</span>}
          </div>
          <div className="text-xs text-zinc-600 mt-0.5">{affiliate.email}</div>
          <div className="text-[10px] text-zinc-700 mt-0.5 flex items-center gap-2">
            <span>Joined {affiliate.created_at ? new Date(affiliate.created_at).toLocaleDateString() : 'N/A'}</span>
            {onDelete && (
              <button
                onClick={onDelete}
                disabled={deleting}
                className="text-zinc-400 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
                title="Delete external affiliate"
              >
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              </button>
            )}
          </div>
        </td>
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1 select-all">
              /r/{affiliate.slug}
            </span>
            <button
              onClick={onCopyLink}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-300 transition-colors"
              title="Copy referral link"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </td>
        <td className="px-5 py-3.5 text-center">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{stats.total_clicks?.toLocaleString() || 0}</span>
        </td>
        <td className="px-5 py-3.5 text-center">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{stats.total_signups || 0}</span>
        </td>
        <td className="px-5 py-3.5 text-center">
          <span className={`text-sm font-medium ${stats.total_conversions > 0 ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-zinc-200'}`}>
            {stats.total_conversions || 0}
          </span>
        </td>
        <td className="px-5 py-3.5 text-right">
          <span className={`text-sm font-semibold ${stats.monthly_recurring > 0 ? 'text-[#1ED4A7]' : 'text-zinc-500'}`}>
            {fmtUSDCents(stats.monthly_recurring || 0)}
          </span>
        </td>
        <td className="px-5 py-3.5 text-right">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-200">
            {fmtUSDCents(stats.total_earned || 0)}
          </span>
        </td>
        <td className="px-5 py-3.5">
          {affiliate.paypal_email ? (
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3 h-3 text-[#1ED4A7]" />
              <span className="text-xs text-zinc-400 truncate max-w-[120px]" title={affiliate.paypal_email}>
                {affiliate.paypal_email}
              </span>
            </div>
          ) : (
            <span className="text-[10px] text-zinc-400 font-medium">Not set</span>
          )}
        </td>
        <td className="px-5 py-3.5">
          <button
            onClick={onToggle}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-300 transition-colors"
            title={hasReferrals ? "View subscriber earnings" : "No referrals yet"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>
      </tr>

      {/* Expanded subscriber earnings details */}
      {isExpanded && (
        <tr>
          <td colSpan={9} className="px-5 py-0">
            <div className="bg-zinc-50 dark:bg-[#111] rounded-lg border border-zinc-200 dark:border-white/5 my-2 overflow-hidden">
              {/* Expanded header with earnings summary */}
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    Subscriber Earnings ({referrals.length} referral{referrals.length !== 1 ? 's' : ''})
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    Commission: {((affiliate.commission_rate || 0.1) * 100).toFixed(0)}% of plan price
                  </span>
                </div>
                {/* Mini stats row for this affiliate */}
                <div className="flex gap-4 mt-1">
                  {[
                    { label: 'Active Subs', value: referrals.filter((r: any) => r.status === 'active' || r.status === 'converted').length, color: 'text-[#1ED4A7]' },
                    { label: 'Churned', value: referrals.filter((r: any) => r.status === 'churned').length, color: 'text-zinc-500' },
                    { label: 'Pending', value: referrals.filter((r: any) => r.status === 'signup').length, color: 'text-zinc-400' },
                    { label: 'MRR Owed', value: fmtUSDCents(stats.monthly_recurring || 0), color: 'text-[#1ED4A7]' },
                    { label: 'Lifetime', value: fmtUSDCents(stats.total_earned || 0), color: 'text-white' },
                  ].map(ms => (
                    <div key={ms.label} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-600">{ms.label}:</span>
                      <span className={`text-[10px] font-bold ${ms.color}`}>{ms.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {!hasReferrals ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-zinc-600">No referrals yet. Subscriber earnings will appear here once users sign up through this affiliate's link.</p>
                </div>
              ) : (
                <>
                  {/* Subscriber table header */}
                  <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[9px] font-bold text-zinc-600 uppercase tracking-widest border-b border-white/5">
                    <div className="col-span-3">Subscriber</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-1 text-center">Plan</div>
                    <div className="col-span-1 text-right">Plan $</div>
                    <div className="col-span-1 text-right">Commission</div>
                    <div className="col-span-1 text-center">Months</div>
                    <div className="col-span-1 text-right">Total Paid</div>
                    <div className="col-span-2">Live Sub</div>
                  </div>

                  {/* Subscriber rows */}
                  <div className="divide-y divide-white/[0.03]">
                    {referrals.map((ref: any, idx: number) => {
                      const liveSub = ref.live_subscription;
                      const isActive = ref.status === 'active' || ref.status === 'converted';
                      const isChurned = ref.status === 'churned';

                      return (
                        <div key={ref.id || idx} className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-white/[0.02] transition-colors">
                          {/* Subscriber */}
                          <div className="col-span-3 flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase flex-shrink-0">
                              {ref.referred_email?.[0] || '?'}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-zinc-900 dark:text-zinc-200 truncate">{ref.referred_email || 'Unknown'}</p>
                              <p className="text-[9px] text-zinc-700">
                                {ref.signed_up_at ? new Date(ref.signed_up_at).toLocaleDateString() : 'N/A'}
                                {ref.converted_at && <span className="text-[#1ED4A7]"> &rarr; {new Date(ref.converted_at).toLocaleDateString()}</span>}
                              </p>
                            </div>
                          </div>

                          {/* Referral Status */}
                          <div className="col-span-2">
                            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
                              isActive
                                ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
                                : isChurned
                                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700'
                                : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#1ED4A7]' : isChurned ? 'bg-gray-400' : 'bg-zinc-400'}`} />
                              {isActive ? 'Active' : isChurned ? 'Churned' : 'Signup'}
                            </div>
                            {ref.status_mismatch && (
                              <div className="text-[9px] text-zinc-500 font-medium mt-0.5">Mismatch</div>
                            )}
                          </div>

                          {/* Plan */}
                          <div className="col-span-1 text-center">
                            {ref.plan ? (
                              <span className="text-[10px] font-medium text-zinc-300 capitalize">{ref.plan}</span>
                            ) : (
                              <span className="text-[10px] text-zinc-600">--</span>
                            )}
                          </div>

                          {/* Plan Price */}
                          <div className="col-span-1 text-right">
                            {ref.subscriber_plan_price ? (
                              <span className="text-[10px] font-mono text-zinc-400">${ref.subscriber_plan_price}</span>
                            ) : (
                              <span className="text-[10px] text-zinc-600">--</span>
                            )}
                          </div>

                          {/* Monthly Commission */}
                          <div className="col-span-1 text-right">
                            {ref.monthly_commission ? (
                              <span className={`text-[10px] font-bold ${isActive ? 'text-[#1ED4A7]' : 'text-zinc-500'}`}>
                                {fmtUSDCents(ref.monthly_commission)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-600">$0</span>
                            )}
                          </div>

                          {/* Months Active */}
                          <div className="col-span-1 text-center">
                            {ref.active_months ? (
                              <span className="text-[10px] font-medium text-zinc-300">{ref.active_months}mo</span>
                            ) : (
                              <span className="text-[10px] text-zinc-600">--</span>
                            )}
                          </div>

                          {/* Total Commission Paid */}
                          <div className="col-span-1 text-right">
                            {ref.total_commission ? (
                              <span className="text-[10px] font-bold text-white">{fmtUSDCents(ref.total_commission)}</span>
                            ) : (
                              <span className="text-[10px] text-zinc-600">$0</span>
                            )}
                          </div>

                          {/* Live Subscription Status */}
                          <div className="col-span-2">
                            {liveSub ? (
                              <div className="flex flex-col">
                                <div className="flex items-center gap-1">
                                  <span className={`w-1.5 h-1.5 rounded-full ${liveSub.status === 'active' ? 'bg-[#1ED4A7]' : liveSub.status === 'canceled' ? 'bg-zinc-500' : 'bg-gray-400'}`} />
                                  <span className={`text-[10px] font-medium capitalize ${liveSub.status === 'active' ? 'text-[#1ED4A7]' : liveSub.status === 'canceled' ? 'text-zinc-500' : 'text-gray-500 dark:text-zinc-500'}`}>
                                    {liveSub.status}
                                  </span>
                                  {liveSub.plan && liveSub.plan !== 'none' && (
                                    <span className="text-[9px] text-gray-400 dark:text-zinc-600 capitalize">({liveSub.plan})</span>
                                  )}
                                </div>
                                {liveSub.stripe_sub_id && (
                                  <span className="text-[8px] font-mono text-gray-300 dark:text-zinc-700 truncate" title={liveSub.stripe_sub_id}>
                                    {liveSub.stripe_sub_id.slice(0, 18)}...
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-400 dark:text-zinc-600 italic">No subscription</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Admin Dashboard ───────────────────────────────────────────
export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'waitlist' | 'users' | 'affiliates' | 'revenue' | 'sales' | 'tracking' | 'org' | 'roles' | 'events' | 'system' | 'leads'>('waitlist');
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [shouldCharge, setShouldCharge] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [inspectData, setInspectData] = useState<any>(null);
  const [inspectingUserId, setInspectingUserId] = useState<string | null>(null);

  // Lead tracking
  const [totalLeads, setTotalLeads] = useState(0);

  // Affiliate state
  const [affiliates, setAffiliates] = useState<any[]>([]);
  const [affiliateTotals, setAffiliateTotals] = useState<any>(null);
  const [expandedAffiliate, setExpandedAffiliate] = useState<string | null>(null);

  // Org / Sales Rep state
  const [orgReps, setOrgReps] = useState<any[]>([]);
  const [orgConfig, setOrgConfig] = useState<any>(null);
  const [orgSetupDone, setOrgSetupDone] = useState(false);
  const [settingUpOrg, setSettingUpOrg] = useState(false);
  const [showAddRep, setShowAddRep] = useState(false);
  const [newRepName, setNewRepName] = useState('');
  const [newRepEmail, setNewRepEmail] = useState('');
  const [newRepPassword, setNewRepPassword] = useState('');
  const [newRepRole, setNewRepRole] = useState('sales_rep');
  const [addingRep, setAddingRep] = useState(false);
  const [removingRepEmail, setRemovingRepEmail] = useState<string | null>(null);
  const [creditUser, setCreditUser] = useState<User | null>(null);

  useEffect(() => {
    if (editingUser) {
      setShouldCharge(false);
      if (!editingUser.subscription?.stripe_sub_id) {
        handleSyncStripe(editingUser.id, editingUser.email);
      }
    }
  }, [editingUser?.id]);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  async function loadData() {
    setRefreshing(true);
    try {
      if (activeTab === 'waitlist') {
        await fetchWaitlist();
      } else if (activeTab === 'users') {
        await fetchUsers();
      } else if (activeTab === 'affiliates') {
        await fetchAffiliates();
      } else if (activeTab === 'org') {
        await fetchOrgReps();
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function setupOrgAccount() {
    setSettingUpOrg(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/org/setup-contndr`,
        { method: 'POST', headers }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success('Org Account Ready', { description: data.message });
        setOrgSetupDone(true);
        await fetchOrgReps();
      } else {
        toast.error('Setup Failed', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Setup Error', { description: err.message });
    } finally {
      setSettingUpOrg(false);
    }
  }

  async function fetchOrgReps() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/org/reps`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setOrgReps(data.reps || []);
        setOrgConfig(data.orgConfig || null);
        if (data.orgConfig) setOrgSetupDone(true);
      }
    } catch (err) {
      console.error('[ORG] Error fetching reps:', err);
    }
  }

  async function handleAddRep() {
    if (!newRepName || !newRepEmail || !newRepPassword) {
      toast.error('All fields required');
      return;
    }
    setAddingRep(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/org/onboard-rep`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: newRepEmail,
            password: newRepPassword,
            name: newRepName,
            role: newRepRole,
          }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success('Rep Onboarded', { description: data.message });
        setNewRepName('');
        setNewRepEmail('');
        setNewRepPassword('');
        setNewRepRole('sales_rep');
        setShowAddRep(false);
        await fetchOrgReps();
      } else {
        toast.error('Failed', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error', { description: err.message });
    } finally {
      setAddingRep(false);
    }
  }

  async function handleRemoveRep(repEmail: string) {
    if (!confirm(`Remove ${repEmail} from the org? Their access will be revoked.`)) return;
    setRemovingRepEmail(repEmail);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/org/reps/${encodeURIComponent(repEmail)}`,
        { method: 'DELETE', headers }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success('Rep Removed', { description: data.message });
        await fetchOrgReps();
      } else {
        toast.error('Failed', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error', { description: err.message });
    } finally {
      setRemovingRepEmail(null);
    }
  }

  async function handlePromoteAdmin(targetUserId: string) {
    if (!confirm(`Promote user ${targetUserId} to org admin with full campaign access?`)) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/org/promote-admin`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: targetUserId }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success('Promoted to Admin', { description: data.message });
        await fetchOrgReps();
        await fetchUsers();
      } else {
        toast.error('Promotion Failed', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error', { description: err.message });
    }
  }

  async function fetchWaitlist() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/waitlist`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setWaitlistEntries(data.entries || []);
      } else {
        const errData = await response.json().catch(() => ({}));
        console.error('[ADMIN] fetchWaitlist failed:', response.status, errData);
        toast.error(`Waitlist fetch failed: ${errData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }

  async function fetchUsers() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
        setTotalLeads(data.totalLeads || 0);
      } else {
        const errData = await response.json().catch(() => ({}));
        console.error('[ADMIN] fetchUsers failed:', response.status, errData);
        toast.error(`Users fetch failed: ${errData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }

  async function fetchAffiliates() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/affiliates`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setAffiliates(data.affiliates || []);
        setAffiliateTotals(data.totals || null);
      } else {
        const errData = await response.json().catch(() => ({}));
        console.error('[ADMIN] fetchAffiliates failed:', response.status, errData);
        toast.error(`Affiliates fetch failed: ${errData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }

  async function handleApprove(id: string, email: string) {
    if (!confirm(`Approve ${email} and send invitation?`)) return;
    setProcessingId(id);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/waitlist/approve`,
        { method: 'POST', headers, body: JSON.stringify({ id, email }) }
      );
      if (response.ok) {
        toast.success('User Approved', { description: 'Invitation sent successfully.' });
        fetchWaitlist();
      } else {
        toast.error('Failed to approve');
      }
    } catch (e) {
      toast.error('Error approving user');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(id: string) {
    if (!confirm('Are you sure you want to reject this application?')) return;
    setProcessingId(id);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/waitlist/reject`,
        { method: 'POST', headers, body: JSON.stringify({ id }) }
      );
      if (response.ok) {
        toast.success('Application Rejected');
        fetchWaitlist();
      } else {
        toast.error('Failed to reject');
      }
    } catch (e) {
      toast.error('Error rejecting user');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDeleteWaitlistEntry(id: string) {
    if (!confirm('Are you sure you want to permanently delete this application?')) return;
    setProcessingId(id);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/waitlist/${id}`,
        { method: 'DELETE', headers }
      );
      if (response.ok) {
        toast.success('Application Deleted');
        fetchWaitlist();
      } else {
        toast.error('Failed to delete application');
      }
    } catch (e) {
      toast.error('Error deleting application');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm('DANGER: This will permanently delete the user account. Continue?')) return;
    setProcessingId(userId);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/delete`,
        { method: 'POST', headers, body: JSON.stringify({ userId }) }
      );
      if (response.ok) {
        toast.success('User Deleted');
        fetchUsers();
      } else {
        toast.error('Failed to delete user');
      }
    } catch (e) {
      toast.error('Error deleting user');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleUpdatePlan(userId: string, newPlan: string) {
    const action = shouldCharge ? `upgrade/downgrade to ${newPlan} AND CHARGE them via Stripe` : `change the plan to ${newPlan} (Bypass Payment)`;
    if (!confirm(`Are you sure you want to ${action}?`)) return;
    setProcessingId(userId);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/plan`,
        { method: 'POST', headers, body: JSON.stringify({ userId, plan: newPlan, charge: shouldCharge }) }
      );
      if (response.ok) {
        toast.success('Plan Updated', { description: `User is now on ${newPlan} plan.` });
        fetchUsers();
        setEditingUser(null);
        setShouldCharge(false);
      } else {
        const error = await response.json();
        toast.error('Update Failed', { description: error.error || 'An error occurred' });
      }
    } catch (err) {
      console.error('Plan update error:', err);
      toast.error('Update Failed', { description: 'Network error' });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSyncStripe(userId: string, userEmail: string) {
    setSyncing(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/sync-stripe`,
        { method: 'POST', headers, body: JSON.stringify({ userId, userEmail }) }
      );
      const data = await response.json();
      if (data.synced) {
        toast.success('Stripe Synced', {
          description: `Found active ${data.subscription?.plan} subscription (${data.subscription?.stripe_sub_id?.slice(0, 20)}...)`
        });
        await fetchUsers();
        setEditingUser(prev => prev ? { ...prev, subscription: data.subscription } : null);
      } else {
        toast.error('No Subscription Found', {
          description: data.reason || 'Could not find an active Stripe subscription for this user.'
        });
      }
    } catch (err) {
      console.error('Stripe sync error:', err);
      toast.error('Sync Failed', { description: 'Network error while syncing with Stripe' });
    } finally {
      setSyncing(false);
    }
  }

  async function handleRevokeSubscription(userId: string, userEmail: string, currentPlan: string) {
    if (!confirm(`Revoke subscription access for ${userEmail}?\n\nCurrent Plan: ${currentPlan}\n\nThis will immediately block their access to the app.`)) return;
    setProcessingId(userId);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/revoke-subscription`,
        { method: 'POST', headers, body: JSON.stringify({ userId }) }
      );
      if (response.ok) {
        const data = await response.json();
        toast.success('Access Revoked', {
          description: `${userEmail} can no longer access the app. Previous plan: ${data.previousSubscription?.plan || currentPlan}`
        });
        fetchUsers();
      } else {
        const error = await response.json();
        toast.error('Revoke Failed', { description: error.error || 'An error occurred' });
      }
    } catch (err) {
      console.error('Revoke error:', err);
      toast.error('Revoke Failed', { description: 'Network error' });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleInspectUser(userId: string) {
    setInspectingUserId(userId);
    setInspectData(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/inspect/${userId}`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setInspectData(data);
      } else {
        toast.error('Inspect Failed');
        setInspectingUserId(null);
      }
    } catch (err) {
      toast.error('Inspect Failed', { description: 'Network error' });
      setInspectingUserId(null);
    }
  }

  const filteredWaitlist = waitlistEntries.filter(entry =>
    entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.businessType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.user_metadata?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const downloadCSV = () => {
    const data = activeTab === 'waitlist' ? filteredWaitlist : filteredUsers;
    const headers = activeTab === 'waitlist'
      ? ['ID', 'Name', 'Email', 'Type', 'Volume', 'Team Size', 'Revenue', 'Status', 'Date']
      : ['ID', 'Email', 'Name', 'Created', 'Last Login', 'Plan'];
    const csvContent = [
      headers.join(','),
      ...data.map((item: any) => {
        if (activeTab === 'waitlist') {
          return [item.id, `"${item.name}"`, item.email, item.businessType, item.monthlyLeadVolume, item.teamSize || '', item.annualRevenue || '', item.status, item.created_at].join(',');
        } else {
          return [item.id, item.email, `"${item.user_metadata?.name || ''}"`, item.created_at, item.last_sign_in_at, item.subscription?.plan].join(',');
        }
      })
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `contndr_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && waitlistEntries.length === 0 && users.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-50 dark:bg-[#050505]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-[#050505] text-zinc-900 dark:text-white transition-colors duration-200">
      {/* Top Bar */}
      <div className="px-4 sm:px-6 py-4 sm:py-6 bg-zinc-50 dark:bg-[#050505] z-20 flex flex-col gap-4">
        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-[#111] rounded-lg w-full sm:w-fit border border-zinc-200 dark:border-white/5 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveTab('waitlist')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'waitlist' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            Waitlist Requests
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'users' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            Active Users
          </button>
          <button
            onClick={() => setActiveTab('affiliates')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'affiliates' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            Affiliates
          </button>
          <button
            onClick={() => setActiveTab('revenue')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'revenue' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            Revenue
          </button>
          <button
            onClick={() => setActiveTab('sales')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'sales' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            <DollarSign className="w-3.5 h-3.5 inline mr-1" />
            Sales
          </button>
          <button
            onClick={() => setActiveTab('tracking')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'tracking' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            Tracking
          </button>
          <button
            onClick={() => setActiveTab('org')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'org' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            Org / Sales Reps
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'roles' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            <Shield className="w-3.5 h-3.5 inline mr-1.5" />
            Roles & Permissions
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'events' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            <Zap className="w-3.5 h-3.5 inline mr-1.5" />
            Event Feed
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'system' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            <Activity className="w-3.5 h-3.5 inline mr-1.5" />
            System
          </button>
          <button
            onClick={() => setActiveTab('leads')}
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'leads' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-transparent' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
          >
            <Database className="w-3.5 h-3.5 inline mr-1.5" />
            Lead Database
          </button>
        </div>

        {activeTab !== 'roles' && activeTab !== 'system' && activeTab !== 'sales' && activeTab !== 'events' && activeTab !== 'leads' && (
          <div className="relative max-w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder={activeTab === 'waitlist' ? "Search applicants..." : activeTab === 'affiliates' ? "Search affiliates..." : activeTab === 'revenue' ? "Search subscribers..." : activeTab === 'tracking' ? "Search tracking data..." : activeTab === 'org' ? "Search sales reps..." : "Search users..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl text-sm text-zinc-900 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-zinc-300 dark:focus:border-white/10 focus:ring-1 focus:ring-zinc-300 dark:focus:ring-white/10 transition-all shadow-sm dark:shadow-none"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-6 pb-4 sm:pb-6 flex flex-col">
        {activeTab === 'leads' ? (
          <AdminLeadBrowser searchTerm={searchTerm} />
        ) : activeTab === 'events' ? (
          <AdminEventCenter />
        ) : activeTab === 'system' ? (
          <CronHealthPanel />
        ) : activeTab === 'sales' ? (
          <SalesAdminPanel searchTerm={searchTerm} />
        ) : activeTab === 'roles' ? (
          <RoleManagement />
        ) : activeTab === 'tracking' ? (
          <TrackingAnalytics adminMode />
        ) : activeTab === 'affiliates' ? (
          <AffiliateAdminPanel
            affiliates={affiliates}
            totals={affiliateTotals}
            expandedAffiliate={expandedAffiliate}
            setExpandedAffiliate={setExpandedAffiliate}
            searchTerm={searchTerm}
            refreshing={refreshing}
            onRefresh={loadData}
          />
        ) : activeTab === 'revenue' ? (
          <RevenueAdminPanel searchTerm={searchTerm} />
        ) : activeTab === 'org' ? (
          /* ─── Org / Sales Reps Tab ─────────────────────────────── */
          <div className="flex flex-col gap-4 h-full overflow-hidden">
            {/* Setup Banner */}
            {!orgSetupDone && (
              <div className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/10 rounded-xl p-5 shadow-sm dark:shadow-none">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Contndr Org Account</h3>
                    <p className="text-xs text-zinc-400">
                      Create or verify the <span className="font-mono text-zinc-300">or@contndr.com</span> org account with Growth plan (bypasses payment).
                    </p>
                  </div>
                  <button
                    onClick={setupOrgAccount}
                    disabled={settingUpOrg}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-zinc-100 border border-white text-black text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {settingUpOrg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {settingUpOrg ? 'Setting up…' : 'Setup Org Account'}
                  </button>
                </div>
              </div>
            )}

            {/* Org Info + Stats */}
            {orgSetupDone && orgConfig && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-shrink-0">
                {[
                  { label: 'Org', value: orgConfig.name || 'Contndr', icon: UsersIcon },
                  { label: 'Domain', value: orgConfig.domain || 'contndr.com', icon: Link2 },
                  { label: 'Plan', value: (orgConfig.plan || 'growth').charAt(0).toUpperCase() + (orgConfig.plan || 'growth').slice(1), icon: Zap },
                  { label: 'Sales Reps', value: String(orgReps.length), icon: UsersIcon },
                ].map(s => (
                  <div key={s.label} className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-3.5 shadow-sm dark:shadow-none">
                    <div className="flex items-center gap-2 mb-2">
                      <s.icon className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{s.label}</span>
                    </div>
                    <p className="text-lg font-bold text-zinc-900 dark:text-white">{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Actions Bar */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div className="text-xs text-zinc-500 font-mono uppercase tracking-widest">
                Onboarded Sales Reps
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddRep(!showAddRep)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs font-medium text-zinc-300 transition-colors"
                >
                  {showAddRep ? <X className="w-3 h-3" /> : <UsersIcon className="w-3 h-3" />}
                  {showAddRep ? 'Cancel' : 'Add Sales Rep'}
                </button>
                <button
                  onClick={loadData}
                  disabled={refreshing}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Add Rep Form */}
            {showAddRep && (
              <div className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/10 rounded-xl p-5 shadow-sm dark:shadow-none">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-white mb-4">Onboard New Sales Rep</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Full Name</label>
                    <input
                      type="text"
                      value={newRepName}
                      onChange={(e) => setNewRepName(e.target.value)}
                      placeholder="e.g. Jane Smith"
                      className="w-full px-3 py-2 bg-zinc-900 border border-white/10 rounded-lg text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Email</label>
                    <input
                      type="email"
                      value={newRepEmail}
                      onChange={(e) => setNewRepEmail(e.target.value)}
                      placeholder="e.g. jane@contndr.com"
                      className="w-full px-3 py-2 bg-zinc-900 border border-white/10 rounded-lg text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Password</label>
                    <input
                      type="text"
                      value={newRepPassword}
                      onChange={(e) => setNewRepPassword(e.target.value)}
                      placeholder="Temporary password"
                      className="w-full px-3 py-2 bg-zinc-900 border border-white/10 rounded-lg text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Role</label>
                    <select
                      value={newRepRole}
                      onChange={(e) => setNewRepRole(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900 border border-white/10 rounded-lg text-sm text-zinc-300 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                    >
                      <option value="sales_rep">Sales Rep</option>
                      <option value="account_exec">Account Executive</option>
                      <option value="sdr">SDR</option>
                      <option value="team_lead">Team Lead</option>
                      <option value="org_admin">Org Admin</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleAddRep}
                  disabled={addingRep || !newRepName || !newRepEmail || !newRepPassword}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-zinc-100 text-black text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {addingRep ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  {addingRep ? 'Onboarding…' : 'Onboard Rep'}
                </button>
              </div>
            )}

            {/* Reps Table */}
            <div className="flex-1 overflow-auto rounded-xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#0A0A0A] shadow-sm dark:shadow-none">
              {orgReps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <UsersIcon className="w-8 h-8 text-zinc-700 mb-3" />
                  <p className="text-sm text-zinc-500 mb-1">No sales reps onboarded yet</p>
                  <p className="text-xs text-zinc-600">Click "Add Sales Rep" to get started.</p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="px-5 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Name</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Email</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Role</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Onboarded</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {orgReps
                      .filter(r => !searchTerm || r.name?.toLowerCase().includes(searchTerm.toLowerCase()) || r.email?.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map((rep: any) => (
                      <tr key={rep.id || rep.email} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-3">
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{rep.name}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-sm text-zinc-400 font-mono">{rep.email}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 capitalize">
                            {(rep.role || 'sales_rep').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            rep.status === 'active'
                              ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                          }`}>
                            <div className={`w-1 h-1 rounded-full ${rep.status === 'active' ? 'bg-[#1ED4A7]' : 'bg-zinc-400'}`} />
                            {rep.status || 'active'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="text-xs text-zinc-500">
                            {rep.onboarded_at ? new Date(rep.onboarded_at).toLocaleDateString() : '—'}
                          </div>
                          {rep.onboarded_by && (
                            <div className="text-[10px] text-zinc-600">by {rep.onboarded_by}</div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => handleRemoveRep(rep.email)}
                            disabled={removingRepEmail === rep.email}
                            className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
                            title="Remove from org"
                          >
                            {removingRepEmail === rep.email ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-1 text-[10px] text-zinc-600 text-right uppercase tracking-wider flex-shrink-0">
              Total Reps: {orgReps.length} | All reps get Growth plan (payment bypassed)
            </div>
          </div>
        ) : (
          <>
            {/* Actions Bar */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
              <div className="text-xs text-zinc-500 font-mono uppercase tracking-widest">
                {activeTab === 'waitlist' ? 'Pending Applications' : 'Platform Users'}
              </div>
              <div className="flex gap-2 sm:gap-3">
                <button
                  onClick={downloadCSV}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
                <button
                  onClick={loadData}
                  disabled={refreshing}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* User Lead Summary Stats (only shown on users tab) */}
            {activeTab === 'users' && users.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 flex-shrink-0">
                {[
                  { label: 'Total Users', value: users.length.toString(), icon: UsersIcon },
                  { label: 'Total Leads', value: totalLeads.toLocaleString(), icon: Database },
                  { label: 'Avg Leads / User', value: users.length > 0 ? Math.round(totalLeads / users.length).toLocaleString() : '0', icon: BarChart3 },
                  { label: 'At Limit', value: users.filter(u => u.leadLimit && u.leadLimit !== -1 && (u.leadCount || 0) >= u.leadLimit).length.toString(), icon: TrendingUp },
                ].map(s => (
                  <div key={s.label} className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-3.5 shadow-sm dark:shadow-none">
                    <div className="flex items-center gap-2 mb-2">
                      <s.icon className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{s.label}</span>
                    </div>
                    <p className="text-lg font-bold text-zinc-900 dark:text-white">{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Mobile Card Layout */}
            <div className="flex-1 overflow-auto md:hidden space-y-2">
              {activeTab === 'waitlist' ? (
                filteredWaitlist.length === 0 ? (
                  <div className="text-center py-12 bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl shadow-sm dark:shadow-none">
                    <p className="text-zinc-600 text-sm">No applications found.</p>
                  </div>
                ) : (
                  filteredWaitlist.map((entry) => (
                    <div key={entry.id} className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-4 shadow-sm dark:shadow-none">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{entry.name}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-600 mt-0.5 truncate">{entry.email}</p>
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-700 mt-0.5">{new Date(entry.created_at).toLocaleDateString()}</p>
                        </div>
                        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border flex-shrink-0 ${
                          entry.status === 'approved'
                            ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
                            : entry.status === 'rejected'
                            ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                        }`}>
                          <div className={`w-1 h-1 rounded-full ${
                            entry.status === 'approved' ? 'bg-[#1ED4A7]' :
                            entry.status === 'rejected' ? 'bg-zinc-400' : 'bg-zinc-400'
                          }`} />
                          <span className="capitalize">{entry.status.replace(/_/g, ' ')}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                          {entry.businessType || 'Unknown'}
                        </span>
                        <span className="text-xs text-zinc-400">
                          {entry.monthlyLeadVolume?.replace('_', ' - ') || 'N/A'} leads/mo
                        </span>
                        {entry.teamSize && entry.teamSize !== 'Unknown' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                            {TEAM_SIZE_LABELS[entry.teamSize] || entry.teamSize} ppl
                          </span>
                        )}
                        {entry.annualRevenue && entry.annualRevenue !== 'Unknown' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                            {REVENUE_LABELS[entry.annualRevenue] || entry.annualRevenue}
                          </span>
                        )}
                        {entry.recommended_plan && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20">
                            Suggested: <span className="capitalize">{entry.recommended_plan}</span>
                          </span>
                        )}
                      </div>
                      {(entry.status === 'pending' || entry.status === 'pending_signup') && (
                        <div className="mt-3 flex items-center gap-2">
                          <button onClick={() => handleReject(entry.id)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Decline">
                            <X className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleApprove(entry.id, entry.email)} disabled={!!processingId} className="flex-1 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 transition-all flex items-center justify-center gap-1.5">
                            <Check className="w-3 h-3" />
                            <span className="text-[10px] font-bold uppercase">Approve</span>
                          </button>
                          <button onClick={() => handleDeleteWaitlistEntry(entry.id)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )
              ) : (
                filteredUsers.length === 0 ? (
                  <div className="text-center py-12 bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl shadow-sm dark:shadow-none">
                    <p className="text-zinc-600 text-sm">No users found.</p>
                  </div>
                ) : (
                  filteredUsers.map((user) => {
                    const count = user.leadCount || 0;
                    const limit = user.leadLimit || 0;
                    const isUnlimited = limit === -1;
                    return (
                      <div key={user.id} className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-4 shadow-sm dark:shadow-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{user.user_metadata?.name || 'User'}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-600 mt-0.5 truncate">{user.email}</p>
                            {(user.user_metadata?.teamSize || user.user_metadata?.annualRevenue) && (
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {user.user_metadata?.teamSize && user.user_metadata.teamSize !== 'Unknown' && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                                    {TEAM_SIZE_LABELS[user.user_metadata.teamSize] || user.user_metadata.teamSize} ppl
                                  </span>
                                )}
                                {user.user_metadata?.annualRevenue && user.user_metadata.annualRevenue !== 'Unknown' && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                                    {REVENUE_LABELS[user.user_metadata.annualRevenue] || user.user_metadata.annualRevenue}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                              user.subscription?.status === 'active'
                                ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                            }`}>
                              {user.subscription?.plan || 'None'}
                            </div>
                            {user.subscription?.status === 'active' && (
                              <span className="text-[9px] text-[#1ED4A7] font-medium">Active</span>
                            )}
                          </div>
                        </div>
                        {user.subscription?.recommended_plan && (
                          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] text-zinc-500">Suggested:</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium capitalize ${
                              user.subscription.recommended_plan === (user.subscription?.plan || 'none')
                                ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20'
                                : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                            }`}>
                              {user.subscription.recommended_plan}
                            </span>
                            {user.subscription.chose_recommended === false && (
                              <span className="text-[8px] text-amber-500/70 font-medium">≠ chosen</span>
                            )}
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex items-baseline gap-1">
                            <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-200">{count.toLocaleString()}</span>
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-600">/ {isUnlimited ? '∞' : limit.toLocaleString()}</span>
                          </div>
                          {!isUnlimited && limit > 0 && (
                            <div className="w-20 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${Math.round((count / limit) * 100) >= 100 ? 'bg-zinc-500' : Math.round((count / limit) * 100) >= 80 ? 'bg-zinc-400' : 'bg-[#1ED4A7]'}`}
                                style={{ width: `${Math.min(100, Math.round((count / limit) * 100))}%` }}
                              />
                            </div>
                          )}
                          {isUnlimited && <span className="text-[10px] text-[#1ED4A7] font-medium">Unlimited</span>}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={() => setCreditUser(user)} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-[10px] font-medium transition-colors">
                            <Zap className="w-3 h-3" /> Credits
                          </button>
                          <button onClick={() => setEditingUser(user)} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-400 text-[10px] font-medium transition-colors">
                            <DollarSign className="w-3 h-3" /> Plan
                          </button>
                        </div>
                      </div>
                    );
                  })
                )
              )}
            </div>

            {/* Desktop Table Container */}
            <div className="flex-1 overflow-auto bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl hidden md:block shadow-sm dark:shadow-none">
              <table className="w-full text-left border-collapse">
                <thead className="bg-zinc-50 dark:bg-[#111] sticky top-0 z-10 border-b border-zinc-200 dark:border-white/5">
                  <tr>
                    {activeTab === 'waitlist' ? (
                      <>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Applicant</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Details</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Size / Revenue</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Status</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">Action</th>
                      </>
                    ) : (
                      <>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">User</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Plan</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Leads</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Activity</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">Manage</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
                  {activeTab === 'waitlist' ? (
                    filteredWaitlist.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-medium text-sm text-zinc-900 dark:text-zinc-200">{entry.name}</div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-600 mt-0.5">{entry.email}</div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-700 mt-1">{new Date(entry.created_at).toLocaleDateString()}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 w-fit">
                              {entry.businessType || 'Unknown'}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {entry.monthlyLeadVolume?.replace('_', ' - ') || 'N/A'} leads/mo
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-zinc-300">
                              {entry.teamSize && entry.teamSize !== 'Unknown' ? `${TEAM_SIZE_LABELS[entry.teamSize] || entry.teamSize} employees` : '—'}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {entry.annualRevenue && entry.annualRevenue !== 'Unknown' ? (REVENUE_LABELS[entry.annualRevenue] || entry.annualRevenue) + ' /yr' : '—'}
                            </span>
                            {entry.recommended_plan && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20 w-fit mt-0.5" title={entry.recommendation_reasons?.join(', ')}>
                                Suggested: <span className="capitalize">{entry.recommended_plan}</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            entry.status === 'approved'
                              ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
                              : entry.status === 'rejected'
                              ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                              : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                          }`}>
                            <div className={`w-1 h-1 rounded-full ${
                              entry.status === 'approved' ? 'bg-[#1ED4A7]' :
                              entry.status === 'rejected' ? 'bg-zinc-400' : 'bg-zinc-400'
                            }`} />
                            <span className="capitalize">{entry.status.replace(/_/g, ' ')}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(entry.status === 'pending' || entry.status === 'pending_signup') && (
                              <>
                                <button onClick={() => handleReject(entry.id)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Decline">
                                  <X className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleApprove(entry.id, entry.email)} disabled={!!processingId} className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 transition-all flex items-center gap-1.5" title="Approve & Invite">
                                  <Check className="w-3 h-3" />
                                  <span className="text-[10px] font-bold uppercase">Approve</span>
                                </button>
                              </>
                            )}
                            {entry.status === 'approved' && <span className="text-[10px] text-[#1ED4A7] font-medium mr-2">Invited</span>}
                            {entry.status === 'rejected' && <span className="text-[10px] text-zinc-400 font-medium mr-2">Declined</span>}
                            <button onClick={() => handleDeleteWaitlistEntry(entry.id)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Delete Permanently">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-medium text-sm text-zinc-900 dark:text-zinc-200">{user.user_metadata?.name || 'User'}</div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-600 mt-0.5">{user.email}</div>
                          {(user.user_metadata?.businessType || user.user_metadata?.teamSize || user.user_metadata?.annualRevenue) && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {user.user_metadata?.businessType && user.user_metadata.businessType !== 'Unknown' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                                  {user.user_metadata.businessType}
                                </span>
                              )}
                              {user.user_metadata?.teamSize && user.user_metadata.teamSize !== 'Unknown' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                                  {TEAM_SIZE_LABELS[user.user_metadata.teamSize] || user.user_metadata.teamSize} ppl
                                </span>
                              )}
                              {user.user_metadata?.annualRevenue && user.user_metadata.annualRevenue !== 'Unknown' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                                  {REVENUE_LABELS[user.user_metadata.annualRevenue] || user.user_metadata.annualRevenue}
                                </span>
                              )}
                            </div>
                          )}
                          {user.subscription?.isTeamMember && (
                            <div className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full bg-zinc-500/10 border border-zinc-500/20">
                              <UsersIcon className="w-3 h-3 text-zinc-400" />
                              <span className="text-[9px] text-zinc-400 font-medium truncate max-w-[200px]" title={`Team owner: ${user.subscription.teamOwnerEmail || user.subscription.teamOwnerId}`}>
                                {user.subscription.teamOwnerOrg || user.subscription.teamOwnerName || user.subscription.teamOwnerEmail?.split('@')[0] || (user.subscription.teamOwnerId?.slice(0, 8) + '\u2026')}&apos;s team
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                                user.subscription?.status === 'active'
                                  ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                              }`}>
                                {user.subscription?.plan || 'None'}
                              </div>
                              {user.subscription?.status === 'active' && (
                                <div className="text-[9px] text-[#1ED4A7] font-medium">
                                  Active
                                </div>
                              )}
                              {user.subscription?.status === 'active' && user.subscription?.plan && user.subscription.plan !== 'none' && !user.subscription?.stripe_sub_id && (
                                <div
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-500/20 bg-zinc-500/10 cursor-help"
                                  title="No Stripe subscription linked — manually enrolled or stale mapping. Use Inspect (👁) to debug."
                                >
                                  <Wallet className="w-3 h-3 text-zinc-400" />
                                  <span className="text-[9px] text-zinc-400 font-semibold">Unlinked</span>
                                </div>
                              )}
                              {user.subscription?._inheritedPlan && user.subscription?.status !== 'active' && (
                                <div className="text-[9px] text-zinc-400 font-medium">
                                  Inherits: {user.subscription._inheritedPlan}
                                </div>
                              )}
                            </div>
                            {user.subscription?.updated_by && (
                              <div className="text-[9px] text-zinc-600 truncate max-w-[180px]" title={`Set by ${user.subscription.updated_by} on ${user.subscription.updated_at ? new Date(user.subscription.updated_at).toLocaleString() : 'unknown'}`}>
                                by {user.subscription.updated_by.split('@')[0]}@ · {user.subscription.updated_at ? new Date(user.subscription.updated_at).toLocaleDateString() : '?'}
                              </div>
                            )}
                            {user.subscription?.recommended_plan && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-[9px] text-zinc-500">Suggested:</span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium capitalize ${
                                  user.subscription.recommended_plan === (user.subscription?.plan || 'none')
                                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20'
                                    : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                }`} title={user.subscription.recommendation_reasons?.join(', ')}>
                                  {user.subscription.recommended_plan}
                                </span>
                                {user.subscription.chose_recommended === false && (
                                  <span className="text-[8px] text-amber-500/70 font-medium">≠ chosen</span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            const count = user.leadCount || 0;
                            const limit = user.leadLimit || 0;
                            const isUnlimited = limit === -1;
                            const pct = isUnlimited ? 0 : limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 0;
                            const isNearLimit = !isUnlimited && pct >= 80;
                            const isAtLimit = !isUnlimited && pct >= 100;
                            return (
                              <div className="flex flex-col gap-1.5 min-w-[120px]">
                                <div className="flex items-baseline gap-1">
                                  <span className={`text-sm font-bold tabular-nums ${isAtLimit ? 'text-zinc-400' : isNearLimit ? 'text-zinc-400' : 'text-zinc-900 dark:text-zinc-200'}`}>
                                    {count.toLocaleString()}
                                  </span>
                                  <span className="text-[10px] text-zinc-500 dark:text-zinc-600">
                                    / {isUnlimited ? '∞' : limit.toLocaleString()}
                                  </span>
                                </div>
                                {!isUnlimited && (
                                  <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${isAtLimit ? 'bg-zinc-500' : isNearLimit ? 'bg-zinc-400' : 'bg-[#1ED4A7]'}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                )}
                                {isUnlimited && (
                                  <span className="text-[9px] text-[#1ED4A7] font-medium">Unlimited</span>
                                )}
                                {isAtLimit && (
                                  <span className="text-[9px] text-zinc-400 font-semibold">Limit reached</span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-[10px] text-zinc-500">
                            Last Login: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Never'}
                          </div>
                          <div className="text-[10px] text-zinc-600">
                            Joined: {new Date(user.created_at).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleInspectUser(user.id)} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Inspect KV Data">
                              <Eye className="w-4 h-4" />
                            </button>
                            <button onClick={() => setCreditUser(user)} className="p-1.5 rounded-lg hover:bg-amber-500/10 text-zinc-500 hover:text-amber-400 transition-colors" title="Manage AI Credits">
                              <Zap className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditingUser(user)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Change Plan / Bypass Payment">
                              <DollarSign className="w-4 h-4" />
                            </button>
                            {user.subscription?.status === 'active' && user.subscription?.plan && (
                              <button onClick={() => handleRevokeSubscription(user.id, user.email, user.subscription.plan)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Revoke Subscription Access">
                                <UserX className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => handlePromoteAdmin(user.id)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-[#1ED4A7]/10 text-zinc-500 hover:text-[#1ED4A7] transition-colors" title="Promote to Org Admin">
                              <Shield className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteUser(user.id)} disabled={!!processingId} className="p-1.5 rounded-lg hover:bg-zinc-500/20 text-zinc-500 hover:text-zinc-300 transition-colors" title="Delete User">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}

                  {((activeTab === 'waitlist' && filteredWaitlist.length === 0) || (activeTab === 'users' && filteredUsers.length === 0)) && (
                    <tr>
                      <td colSpan={activeTab === 'users' ? 5 : 4} className="p-12 text-center text-zinc-600 text-sm">
                        No records found matching your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-[10px] text-zinc-600 text-right uppercase tracking-wider">
              Total: {activeTab === 'waitlist' ? waitlistEntries.length : users.length}
              {activeTab === 'users' && totalLeads > 0 && (
                <span className="ml-3">| {totalLeads.toLocaleString()} leads across all users</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Change Plan Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#0A0A0A] p-6 rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl w-full max-w-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-white">Change Plan</h3>
              <button onClick={() => setEditingUser(null)} className="text-zinc-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6">
              <p className="text-sm text-zinc-400 mb-4">
                Update plan for <span className="font-semibold text-white">{editingUser.email}</span>
              </p>

              {editingUser.subscription?.stripe_sub_id ? (
                <div className="bg-zinc-100 dark:bg-white/5 p-3 rounded-xl border border-zinc-200 dark:border-white/10 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-zinc-500">
                      Stripe ID: {editingUser.subscription.stripe_sub_id}
                    </span>
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        checked={shouldCharge}
                        onChange={(e) => setShouldCharge(e.target.checked)}
                        className="w-4 h-4 rounded border-zinc-600 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-zinc-900"
                      />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-white leading-none mb-1">Charge via Stripe</span>
                      <span className="text-xs text-zinc-400 leading-snug">
                        Immediately charge card on file for the new plan.
                      </span>
                    </div>
                  </label>
                </div>
              ) : (
                <div className="mb-4 p-3 bg-zinc-100 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10">
                  <div className="flex items-start gap-2">
                    <UserX className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                    <div className="flex flex-col flex-1">
                      <span className="text-xs font-medium text-zinc-300">Stripe Billing Unavailable</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">
                        No Stripe subscription ID linked. Webhook may have been missed.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSyncStripe(editingUser.id, editingUser.email)}
                    disabled={syncing}
                    className="mt-2.5 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-500/10 hover:bg-zinc-500/20 border border-zinc-500/20 text-zinc-400 text-[11px] font-semibold transition-colors disabled:opacity-50"
                  >
                    {syncing ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Syncing with Stripe...</>
                    ) : (
                      <><RotateCcw className="w-3 h-3" /> Sync from Stripe</>
                    )}
                  </button>
                </div>
              )}

              {!shouldCharge && (
                <div className="text-xs text-zinc-400 bg-zinc-500/10 p-2 rounded-lg border border-zinc-500/20">
                  Warning: This bypasses payment. The user will not be charged for this upgrade (they will continue paying their existing rate, if any).
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {['starter', 'professional', 'growth'].map(plan => (
                <button
                  key={plan}
                  onClick={() => handleUpdatePlan(editingUser.id, plan)}
                  disabled={!!processingId}
                  className={`p-4 rounded-xl border text-left flex items-center justify-between transition-all ${
                    editingUser.subscription?.plan === plan
                      ? 'bg-zinc-800 dark:bg-zinc-800 border-zinc-500 dark:border-white/50 text-white'
                      : 'hover:bg-zinc-100 dark:hover:bg-white/5 border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <span className="capitalize font-medium">{plan}</span>
                  {editingUser.subscription?.plan === plan && <CheckCircle className="w-4 h-4 text-zinc-300" />}
                </button>
              ))}

              {/* Divider */}
              <div className="relative my-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-200 dark:border-white/5" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-2 text-[9px] uppercase tracking-widest text-zinc-500 dark:text-zinc-600 bg-white dark:bg-[#0A0A0A]">or</span>
                </div>
              </div>

              {/* Remove Plan / Revoke */}
              <button
                onClick={() => {
                  handleRevokeSubscription(editingUser.id, editingUser.email, editingUser.subscription?.plan || 'none');
                  setEditingUser(null);
                }}
                disabled={!!processingId || (!editingUser.subscription?.plan || editingUser.subscription?.plan === 'none')}
                className={`p-4 rounded-xl border text-left flex items-center justify-between transition-all ${
                  !editingUser.subscription?.plan || editingUser.subscription?.plan === 'none'
                    ? 'border-zinc-200 dark:border-white/5 text-zinc-400 dark:text-zinc-700 cursor-not-allowed'
                    : 'hover:bg-red-50 dark:hover:bg-zinc-500/5 border-red-100 dark:border-zinc-500/20 text-red-600 dark:text-zinc-400 hover:border-red-200 dark:hover:border-zinc-500/40'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <UserX className="w-4 h-4" />
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Remove Plan</span>
                    <span className={`text-[10px] ${
                      !editingUser.subscription?.plan || editingUser.subscription?.plan === 'none'
                        ? 'text-zinc-400 dark:text-zinc-700'
                        : 'text-red-500/70 dark:text-zinc-500/70'
                    }`}>
                      Revoke access — keeps account intact
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Credit Modal */}
      {creditUser && (
        <AdminCreditModal user={creditUser} onClose={() => setCreditUser(null)} />
      )}

      {/* Inspect KV Data Modal */}
      {inspectingUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#0A0A0A] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl w-full max-w-lg relative overflow-hidden max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Eye className="w-5 h-5 text-zinc-500" /> Inspect User KV
              </h3>
              <button onClick={() => { setInspectingUserId(null); setInspectData(null); }} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-[10px] font-mono text-gray-500 dark:text-zinc-500 mb-3 break-all">
              {inspectingUserId}
            </div>
            {inspectData ? (
              <div className="overflow-auto flex-1 space-y-3">
                {Object.entries(inspectData).filter(([k]) => k !== 'userId').map(([key, value]) => (
                  <div key={key} className="bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-200 dark:border-white/10 p-3">
                    <div className="text-[10px] font-mono font-bold text-gray-700 dark:text-zinc-300 mb-1.5 uppercase tracking-wider">{key}</div>
                    {value === null || value === undefined ? (
                      <div className="text-[11px] text-gray-400 dark:text-zinc-600 italic">null</div>
                    ) : typeof value === 'object' ? (
                      <pre className="text-[10px] text-gray-600 dark:text-zinc-400 font-mono whitespace-pre-wrap break-all leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
                    ) : (
                      <div className="text-[11px] text-gray-600 dark:text-zinc-400 font-mono break-all">{String(value)}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-gray-400 dark:text-zinc-600">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading KV data...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;