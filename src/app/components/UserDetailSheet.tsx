/**
 * UserDetailSheet
 * ───────────────
 * Enterprise-grade admin detail view for a single user. Slides up from the
 * bottom on mobile, side-sheet on desktop. Surfaces everything an admin
 * needs at a glance:
 *   - Account: email, name, phone, role, created, last login
 *   - Subscription: plan, status, period, whitelist, recommendation
 *   - Payment: card brand · •••• last4 · exp · funding · country
 *   - Recent invoices (paid/open/unpaid) with hosted URL + PDF
 *   - Usage: lead count, AI credits balance
 *   - Quick actions: edit plan, manage credits, revoke, inspect KV, delete
 */

import { useEffect, useState, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  CreditCard,
  Mail,
  Phone,
  Calendar,
  Shield,
  Crown,
  Users,
  Database,
  Zap,
  Edit3,
  ExternalLink,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from '../lib/auth';

interface UserDetailSheetProps {
  userId: string;
  userEmail?: string;
  onClose: () => void;
  onEditPlan: () => void;
  onManageCredits: () => void;
  onRevoke?: () => void;
  onDelete?: () => void;
  onPromoteAdmin?: () => void;
  onInspectKv: () => void;
  onChargeUpdated?: () => void;
}

const PLAN_PRICES: Record<string, { monthly: string; yearly: string }> = {
  growth: { monthly: '$499', yearly: '$4,990' },
  scale: { monthly: '$999', yearly: '$9,990' },
  enterprise: { monthly: '$2,500', yearly: '$25,000' },
};

interface DetailPayload {
  user: any;
  subscription: any;
  stripe: {
    customer_id: string | null;
    payment_method: {
      brand: string;
      last4: string;
      exp_month: number;
      exp_year: number;
      funding: string;
      country: string;
    } | null;
    recent_invoices: Array<{
      id: string;
      number: string;
      status: string;
      amount_paid: number;
      amount_due: number;
      currency: string;
      created: number;
      hosted_invoice_url: string;
      pdf: string;
    }>;
  };
  team_link: any;
  ai_credits: any;
  leads_count: number;
}

const CARD_BRAND_GLYPHS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  diners: 'Diners',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  unknown: 'Card',
};

function fmtCurrency(amount: number, currency = 'usd') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format((amount || 0) / 100);
  } catch {
    return `$${((amount || 0) / 100).toFixed(2)}`;
  }
}

function fmtDate(ts?: string | number | null) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString();
}

function fmtDateShort(ts?: string | number | null) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleDateString();
}

export function UserDetailSheet({
  userId,
  userEmail,
  onClose,
  onEditPlan,
  onManageCredits,
  onRevoke,
  onDelete,
  onPromoteAdmin,
  onInspectKv,
  onChargeUpdated,
}: UserDetailSheetProps) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [chargePlan, setChargePlan] = useState<'growth' | 'scale' | 'enterprise'>('growth');
  const [chargeInterval, setChargeInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [charging, setCharging] = useState(false);
  const [generatingSetupLink, setGeneratingSetupLink] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/detail/${userId}`,
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) {
      toast.error(`Failed to load user details: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Default the charge plan picker to the user's current plan when data arrives
  useEffect(() => {
    const current = data?.subscription?.plan;
    if (current && ['growth', 'scale', 'enterprise'].includes(current)) {
      setChargePlan(current as 'growth' | 'scale' | 'enterprise');
    }
  }, [data?.subscription?.plan]);

  // Esc to close, prevent body scroll
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const chargeCard = async () => {
    const confirmMsg = `Charge ${userEmail || 'this user'}'s card on file: ${chargePlan} ${chargeInterval === 'yearly' ? PLAN_PRICES[chargePlan].yearly + '/yr' : PLAN_PRICES[chargePlan].monthly + '/mo'}?\n\nThis creates or updates their Stripe subscription and charges immediately.`;
    if (!confirm(confirmMsg)) return;
    setCharging(true);
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/plan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            userEmail,
            plan: chargePlan,
            charge: true,
            interval: chargeInterval,
          }),
        },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast.success(`Charged successfully — ${chargePlan} ${chargeInterval}`);
      onChargeUpdated?.();
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Charge failed');
    } finally {
      setCharging(false);
    }
  };

  const generateSetupLink = async () => {
    setGeneratingSetupLink(true);
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/${userId}/setup-link`,
        { method: 'POST' },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      try {
        await navigator.clipboard.writeText(j.url);
        toast.success('Setup link copied — send it to the user');
      } catch {
        toast(`Setup link: ${j.url}`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Setup link failed');
    } finally {
      setGeneratingSetupLink(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  const pm = data?.stripe?.payment_method;
  const sub = data?.subscription;
  const u = data?.user;
  const plan = (sub?.plan || u?.subscription?.plan || 'none').toString();

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center sm:justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="
          bg-white dark:bg-[#0A0A0A]
          w-full sm:max-w-xl sm:h-full
          rounded-t-2xl sm:rounded-l-2xl sm:rounded-tr-none
          border-t sm:border-l sm:border-t-0 border-zinc-200 dark:border-white/10
          shadow-2xl
          flex flex-col
          max-h-[92vh] sm:max-h-none
          mt-auto sm:mt-0
          animate-in slide-in-from-bottom sm:slide-in-from-right duration-300
        "
      >
        {/* Header */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-b border-zinc-200 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Shield className="w-3.5 h-3.5" /> Admin · User detail
            </div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white truncate">
              {u?.full_name || userEmail || u?.email || 'User'}
            </h2>
            <div className="text-[11px] text-zinc-500 font-mono truncate">{userId}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={load} title="Refresh" className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {loading && !data ? (
            <div className="flex items-center justify-center py-16 text-zinc-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : !data ? (
            <div className="text-center py-16 text-zinc-500 text-sm">No data.</div>
          ) : (
            <>
              {/* Account */}
              <Section title="Account">
                <KV
                  icon={<Mail className="w-3.5 h-3.5" />}
                  label="Email"
                  value={u?.email}
                  onCopy={() => copy('email', u?.email || '')}
                  copied={copiedField === 'email'}
                />
                <KV icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={u?.phone || '—'} />
                <KV label="Full name" value={u?.full_name || '—'} />
                <KV label="Role" value={u?.role || '—'} />
                <KV icon={<Calendar className="w-3.5 h-3.5" />} label="Joined" value={fmtDate(u?.created_at)} />
                <KV label="Last login" value={fmtDate(u?.last_sign_in_at)} />
                <KV label="Email confirmed" value={u?.email_confirmed_at ? 'Yes' : <span className="text-amber-500">No</span>} />
                {u?.banned_until && (
                  <KV label="Banned until" value={<span className="text-red-500">{fmtDate(u.banned_until)}</span>} />
                )}
              </Section>

              {/* Subscription */}
              <Section title="Subscription">
                <KV
                  icon={<Crown className="w-3.5 h-3.5" />}
                  label="Plan"
                  value={
                    <span className="inline-flex items-center gap-2">
                      <span className="capitalize font-medium text-zinc-900 dark:text-zinc-100">{plan}</span>
                      {sub?.status && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          sub.status === 'active' ? 'bg-emerald-500/15 text-emerald-500'
                          : sub.status === 'pending' ? 'bg-amber-500/15 text-amber-500'
                          : 'bg-zinc-500/15 text-zinc-400'
                        }`}>{sub.status}</span>
                      )}
                      {sub?.isWhitelisted && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">Whitelisted</span>
                      )}
                    </span>
                  }
                />
                {sub?.chosen_plan && sub.chosen_plan !== sub.plan && (
                  <KV label="Chosen plan" value={<span className="capitalize">{sub.chosen_plan}</span>} />
                )}
                {sub?.recommended_plan && (
                  <KV label="Recommended" value={<span className="capitalize">{sub.recommended_plan}</span>} />
                )}
                {sub?.current_period_end && (
                  <KV label="Period ends" value={fmtDateShort(sub.current_period_end)} />
                )}
                {sub?.cancel_at_period_end && (
                  <KV label="Cancel scheduled" value={<span className="text-amber-500">Yes — ends {fmtDateShort(sub.current_period_end)}</span>} />
                )}
                {sub?.updated_at && (
                  <KV label="Sub updated" value={fmtDate(sub.updated_at)} />
                )}
              </Section>

              {/* Payment method */}
              <Section title="Payment method">
                {pm ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 rounded-lg bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 p-3">
                      <CreditCard className="w-5 h-5 text-zinc-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-zinc-900 dark:text-white text-sm">
                          {CARD_BRAND_GLYPHS[pm.brand?.toLowerCase() || 'unknown'] || pm.brand} · •••• {pm.last4}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Exp {String(pm.exp_month).padStart(2, '0')}/{pm.exp_year} · {pm.funding} · {pm.country}
                        </div>
                      </div>
                    </div>
                    {data.stripe.customer_id && (
                      <KV
                        label="Stripe customer"
                        value={
                          <span className="font-mono text-[11px]">
                            {data.stripe.customer_id}
                            <button onClick={() => copy('cust', data.stripe.customer_id!)} className="ml-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                              {copiedField === 'cust' ? <Check className="w-3 h-3 inline" /> : <Copy className="w-3 h-3 inline" />}
                            </button>
                          </span>
                        }
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 italic flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {data.stripe.customer_id ? 'No card on file' : 'No Stripe customer linked'}
                  </div>
                )}
              </Section>

              {/* Charge / Collect card */}
              <Section title={pm ? 'Charge card on file' : 'Collect payment method'}>
                {pm ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {(['growth', 'scale', 'enterprise'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setChargePlan(p)}
                          className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                            chargePlan === p
                              ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                              : 'bg-zinc-50 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:bg-zinc-100 dark:hover:bg-white/10'
                          }`}
                        >
                          <span className="capitalize">{p}</span>
                          <span className="ml-1.5 text-[10px] opacity-70">
                            {chargeInterval === 'yearly' ? PLAN_PRICES[p].yearly + '/yr' : PLAN_PRICES[p].monthly + '/mo'}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(['monthly', 'yearly'] as const).map((i) => (
                        <button
                          key={i}
                          onClick={() => setChargeInterval(i)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                            chargeInterval === i
                              ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-transparent'
                              : 'bg-zinc-50 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-white/10'
                          }`}
                        >
                          {i === 'yearly' ? 'Yearly · save ~17%' : 'Monthly'}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={chargeCard}
                      disabled={charging}
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      {charging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                      {charging ? 'Charging…' : `Charge ${chargeInterval === 'yearly' ? PLAN_PRICES[chargePlan].yearly + '/yr' : PLAN_PRICES[chargePlan].monthly + '/mo'}`}
                    </button>
                    <div className="text-[10px] text-zinc-500">
                      Creates or updates the Stripe subscription and bills the card immediately. Switching intervals re-bills with proration.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-zinc-500">
                      User has no card on file. Generate a Stripe setup link — when they open it, they can save a card without being charged.
                    </div>
                    <button
                      onClick={generateSetupLink}
                      disabled={generatingSetupLink}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 dark:bg-white hover:opacity-90 disabled:opacity-60 text-white dark:text-zinc-900 text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      {generatingSetupLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                      {generatingSetupLink ? 'Generating…' : 'Copy "Save card" link'}
                    </button>
                  </div>
                )}
              </Section>

              {/* Recent invoices */}
              {data.stripe.recent_invoices.length > 0 && (
                <Section title={`Recent invoices · ${data.stripe.recent_invoices.length}`}>
                  <div className="space-y-1.5">
                    {data.stripe.recent_invoices.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-mono text-zinc-700 dark:text-zinc-300 truncate">
                            {inv.number || inv.id.slice(0, 14)}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {fmtDateShort(inv.created)} · {fmtCurrency(inv.amount_paid || inv.amount_due, inv.currency)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            inv.status === 'paid' ? 'bg-emerald-500/15 text-emerald-500'
                            : inv.status === 'open' ? 'bg-amber-500/15 text-amber-500'
                            : 'bg-zinc-500/15 text-zinc-400'
                          }`}>{inv.status}</span>
                          {inv.hosted_invoice_url && (
                            <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {inv.pdf && (
                            <a href={inv.pdf} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                              <FileText className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Usage */}
              <Section title="Usage">
                <KV icon={<Users className="w-3.5 h-3.5" />} label="Leads in CRM" value={data.leads_count.toLocaleString()} />
                {data.ai_credits && (
                  <KV
                    icon={<Zap className="w-3.5 h-3.5" />}
                    label="AI credits"
                    value={
                      <span>
                        {typeof data.ai_credits.balance === 'number' ? data.ai_credits.balance.toLocaleString() : JSON.stringify(data.ai_credits)}
                      </span>
                    }
                  />
                )}
                {data.team_link && (
                  <KV label="Team link" value={<span className="text-[11px] font-mono">{JSON.stringify(data.team_link).slice(0, 80)}</span>} />
                )}
              </Section>
            </>
          )}
        </div>

        {/* Actions footer */}
        <div className="flex-shrink-0 border-t border-zinc-200 dark:border-white/10 px-4 sm:px-6 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <ActionBtn onClick={onEditPlan} icon={<Edit3 className="w-3.5 h-3.5" />}>Edit plan</ActionBtn>
            <ActionBtn onClick={onManageCredits} icon={<Zap className="w-3.5 h-3.5" />}>Credits</ActionBtn>
            <ActionBtn onClick={onInspectKv} icon={<Database className="w-3.5 h-3.5" />}>Inspect KV</ActionBtn>
            {onPromoteAdmin && (
              <ActionBtn onClick={onPromoteAdmin} icon={<Crown className="w-3.5 h-3.5" />}>Promote</ActionBtn>
            )}
            {onRevoke && (
              <ActionBtn onClick={onRevoke} icon={<Shield className="w-3.5 h-3.5" />} variant="amber">Revoke</ActionBtn>
            )}
            {onDelete && (
              <ActionBtn onClick={onDelete} icon={<X className="w-3.5 h-3.5" />} variant="danger">Delete</ActionBtn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({
  icon, label, value, onCopy, copied,
}: { icon?: React.ReactNode; label: string; value: React.ReactNode; onCopy?: () => void; copied?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-0">
      <div className="flex items-center gap-1.5 text-zinc-500 flex-shrink-0 min-w-[110px]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-zinc-900 dark:text-zinc-100 text-right min-w-0 break-all flex items-center gap-1.5 justify-end">
        <span className="min-w-0">{value || '—'}</span>
        {onCopy && value && (
          <button onClick={onCopy} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white flex-shrink-0">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  children, icon, onClick, variant,
}: { children: React.ReactNode; icon?: React.ReactNode; onClick: () => void; variant?: 'amber' | 'danger' }) {
  const base = 'px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap';
  const cls = variant === 'danger'
    ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20'
    : variant === 'amber'
    ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20'
    : 'bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/10';
  return (
    <button onClick={onClick} className={`${base} ${cls}`}>
      {icon}{children}
    </button>
  );
}
