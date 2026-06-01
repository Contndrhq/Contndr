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
import { useTranslation } from 'react-i18next';
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
import { confirmAsync } from './ConfirmDialog';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from '../lib/auth';
import { supabase } from '../lib/supabase';

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
      type?: string | null;
      label?: string | null;
      brand: string;
      last4: string | null;
      exp_month: number | null;
      exp_year: number | null;
      funding: string | null;
      country: string | null;
      source?: string | null;
      source_id?: string | null;
      reusable?: boolean;
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
      paid?: boolean;
      attempted?: boolean;
      next_payment_attempt?: number | null;
    }>;
    live_subscription?: {
      id: string;
      status: string;
      cancel_at_period_end: boolean;
      cancel_at: number | null;
      canceled_at: number | null;
      current_period_start: number | null;
      current_period_end: number | null;
      trial_end: number | null;
      latest_invoice_id: string | null;
      has_access: boolean;
    } | null;
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
  const { t } = useTranslation();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [chargePlan, setChargePlan] = useState<'growth' | 'scale' | 'enterprise'>('growth');
  const [chargeInterval, setChargeInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [charging, setCharging] = useState(false);
  const [generatingSetupLink, setGeneratingSetupLink] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null); // 'all' or invoice_id

  // Charge controls — let admin override the amount and pick how Stripe
  // should handle proration. Default to prorated, default amount mirrors
  // the live preview (so the input stays in sync when admin switches plan).
  const [chargeMode, setChargeMode] = useState<'prorate' | 'full' | 'custom'>('prorate');
  const [customAmountCents, setCustomAmountCents] = useState<number | null>(null);

  // Live proration preview — fetched whenever the admin changes the
  // plan/interval picker so they see the actual amount due now BEFORE
  // clicking Charge. Read-only Stripe call, doesn't mutate anything.
  const [preview, setPreview] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    // Skip if the sheet hasn't loaded yet or there's no customer to bill
    if (!data?.stripe?.customer_id && !data?.subscription) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    (async () => {
      try {
        const r = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/plan/preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, plan: chargePlan, interval: chargeInterval }),
          },
        );
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) { setPreviewError(j.error || `HTTP ${r.status}`); setPreview(null); }
        else { setPreview(j); }
      } catch (e: any) {
        if (!cancelled) { setPreviewError(e?.message || 'Preview failed'); setPreview(null); }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, chargePlan, chargeInterval, data?.stripe?.customer_id, data?.subscription]);
  const [sendingApproval, setSendingApproval] = useState(false);

  async function sendApprovalEmail() {
    const ok = await confirmAsync({
      title: 'Send finish-setup email?',
      message: `Emails ${data?.user?.email || 'the user'} that they've been approved + includes a sign-in link${!data?.stripe?.payment_method ? ' and a "save card" link' : ''}.`,
      confirmLabel: 'Send',
    }).catch(() => true);
    if (!ok) return;
    setSendingApproval(true);
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/${userId}/send-approval`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const result = await r.json();
      if (result.success) {
        toast.success(`Sent to ${result.sent_to}`, {
          description: result.setup_link_included
            ? 'Sign-in + save-card link included.'
            : result.already_has_card ? 'Card already on file — sign-in link included.' : 'Sign-in link included.'
        });
      } else {
        toast.error(result.error || 'Failed to send');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send');
    } finally {
      setSendingApproval(false);
    }
  }

  async function retryPayment(invoiceId: string | null) {
    const key = invoiceId || 'all';
    setRetrying(key);
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/${userId}/retry-payment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invoiceId ? { invoice_id: invoiceId } : {}),
        }
      );
      const result = await r.json();
      if (result.success) {
        toast.success(`${result.succeeded}/${result.retried} invoice(s) paid`);
        load();
      } else if (result.retried === 0) {
        toast.info(result.message || 'No retryable invoices');
      } else {
        const errMsg = (result.results || []).find((x: any) => x.error)?.error || 'Retry failed';
        toast.error(errMsg);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Retry failed');
    } finally {
      setRetrying(null);
    }
  }

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
    // CUSTOM mode short-circuit — don't touch the subscription, don't
    // fetch a proration preview. Just confirm with the exact amount
    // the admin typed and fire a raw PaymentIntent.
    if (chargeMode === 'custom') {
      const amt = customAmountCents || 0;
      if (amt < 50) {
        toast.error('Enter at least $0.50');
        return;
      }
      const ok = confirm(
        `Custom charge — ${userEmail || 'this user'}\n\n` +
        `Amount: $${(amt / 100).toFixed(2)}\n` +
        `Card on file (no subscription change).\n\n` +
        `Charge now?`,
      );
      if (!ok) return;
      setCharging(true);
      try {
        const r = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/charge-custom`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              amount_cents: amt,
              description: `Manual charge — ${userEmail || userId}`,
            }),
          },
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (j.requires_action) {
          toast.error('Card requires 3D Secure — customer must complete in their billing portal.');
        } else if (j.status === 'succeeded') {
          toast.success(`Charged $${(j.amount_charged_cents / 100).toFixed(2)}`);
        } else {
          toast.info(`Charge ${j.status}`);
        }
        onChargeUpdated?.();
        await load();
      } catch (e: any) {
        toast.error(e?.message || 'Custom charge failed');
      } finally {
        setCharging(false);
      }
      return;
    }

    // STEP 1 — fetch Stripe's prorated preview so the admin sees the
    // actual "amount due now" (could be much less than the full plan
    // price when upgrading mid-cycle — Stripe credits unused time on
    // the current plan and charges only the difference for the
    // remainder of the current billing period).
    let preview: any = null;
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/plan/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, plan: chargePlan, interval: chargeInterval }),
        },
      );
      preview = await r.json();
      if (!r.ok) throw new Error(preview.error || `HTTP ${r.status}`);
    } catch (e: any) {
      toast.error(e?.message || 'Preview failed — try again');
      return;
    }

    const fmtMoney = (cents: number, currency = 'usd') =>
      `${(currency || 'usd').toUpperCase() === 'USD' ? '$' : ''}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const dueNow = preview.amount_due_now_cents || 0;
    const nextFull = preview.next_full_charge_cents || 0;
    const lineLabel = preview.is_new_subscription ? 'New subscription' : 'Plan change (prorated)';
    const lines = (preview.line_items || []).map((l: any) =>
      `  • ${l.description}: ${l.amount_cents < 0 ? '-' : ''}${fmtMoney(Math.abs(l.amount_cents), preview.currency)}`,
    ).join('\n');

    const confirmMsg =
      `${lineLabel} — ${userEmail || 'this user'}\n\n` +
      (lines ? `${lines}\n\n` : '') +
      `Amount due NOW: ${fmtMoney(dueNow, preview.currency)}\n` +
      (nextFull && !preview.is_new_subscription
        ? `Next full charge: ${fmtMoney(nextFull, preview.currency)}/${chargeInterval === 'yearly' ? 'yr' : 'mo'}\n\n`
        : '\n') +
      `Charge the card on file now?`;

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
            proration_mode: chargeMode,  // 'prorate' | 'full'
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

  const impersonate = async () => {
    if (!confirm(`Sign in as ${userEmail || 'this user'}? Your admin session will be backed up locally and you can exit at any time using the banner at the top of the screen.`)) return;
    try {
      // 1. Back up admin's current session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        localStorage.setItem('contndr_impersonation_admin_backup', JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }));
      }
      // 2. Ask backend for an impersonation magic link
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/${userId}/impersonate`,
        { method: 'POST' },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

      // 3. Exchange the token_hash for a real session
      if (!j.hashed_token) throw new Error('Backend did not return an impersonation token');
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: j.hashed_token,
        type: 'magiclink',
      });
      if (verifyErr) throw verifyErr;

      // 4. Stamp the impersonation flag and reload
      const adminEmail = session?.user?.email || 'admin';
      localStorage.setItem('contndr_impersonation', JSON.stringify({
        email: j.target_email || userEmail,
        admin_email: adminEmail,
        user_id: j.target_id || userId,
      }));
      window.dispatchEvent(new CustomEvent('contndr:impersonation-changed'));
      toast.success(`Now impersonating ${j.target_email || userEmail}`);
      window.location.href = '/';
    } catch (e: any) {
      localStorage.removeItem('contndr_impersonation_admin_backup');
      toast.error(e?.message || 'Impersonation failed');
    }
  };

  const [sendingLoginLink, setSendingLoginLink] = useState(false);
  const [cleaningBounces, setCleaningBounces] = useState(false);

  const cleanBouncedLeads = async () => {
    if (cleaningBounces) return;
    setCleaningBounces(true);
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/${userId}/delete-bounced`,
        { method: 'POST' },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const sample = (j.sample_reasons || []) as Array<{ email: string; type?: string; sub_type?: string; message?: string }>;
      // Show a digestible summary so the admin can tell at a glance
      // what the bounce reasons were (bad list vs. infra vs. reputation).
      const topReasons = sample.slice(0, 3).map(s => {
        const reason = s.message || s.sub_type || s.type || 'unknown';
        return `${s.email}: ${reason}`;
      });
      toast.success(
        j.deleted === 0
          ? 'No bounced leads to clean'
          : `Cleaned ${j.deleted} bounced lead${j.deleted === 1 ? '' : 's'}`,
        topReasons.length ? { description: topReasons.join('\n') } : undefined,
      );
      // Force a refresh so the user detail row no longer shows stale counts
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to clean bounced leads');
    } finally {
      setCleaningBounces(false);
    }
  };

  const sendLoginLink = async () => {
    setSendingLoginLink(true);
    try {
      const r = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/${userId}/login-link`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      try {
        await navigator.clipboard.writeText(j.url);
        toast.success(j.emailed ? 'Sent + URL copied' : 'URL copied (email failed — paste it manually)');
      } catch {
        toast(j.emailed ? 'Login link emailed' : `Login link: ${j.url}`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Login link failed');
    } finally {
      setSendingLoginLink(false);
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

              {/* Past-due banner */}
              {(sub?.status === 'past_due' || sub?.status === 'unpaid' || sub?.status === 'incomplete') && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 flex items-start gap-2.5 text-xs">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-amber-700 dark:text-amber-300">
                      Subscription is {sub.status === 'past_due' ? 'past due' : sub.status === 'unpaid' ? 'unpaid' : 'incomplete'}
                    </div>
                    <div className="text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                      Stripe will continue retrying. Use "Charge card on file" below to attempt collection now, or send a setup link if the card needs updating.
                    </div>
                  </div>
                </div>
              )}

              {/* Subscription */}
              <Section title="Subscription">
                {(() => {
                  // Prefer Stripe's live state over KV's `status: canceled`
                  // since the latter is ambiguous (could mean canceling at
                  // period end + still has access, OR fully terminated).
                  const live = data.stripe?.live_subscription;
                  const hasAccess = live?.has_access === true || sub?.status === 'active';
                  let statusLabel = sub?.status || 'none';
                  let statusCls = 'bg-zinc-500/15 text-zinc-400';
                  let detail: string | null = null;

                  if (live) {
                    if (live.status === 'active' && !live.cancel_at_period_end) {
                      statusLabel = 'active';
                      statusCls = 'bg-emerald-500/15 text-emerald-500';
                      if (live.current_period_end) detail = `Renews ${fmtDateShort(live.current_period_end)}`;
                    } else if (live.status === 'active' && live.cancel_at_period_end) {
                      statusLabel = 'canceling';
                      statusCls = 'bg-amber-500/15 text-amber-500';
                      detail = `Active until ${fmtDateShort(live.current_period_end || live.cancel_at!)}`;
                    } else if (live.status === 'trialing') {
                      statusLabel = 'trial';
                      statusCls = 'bg-sky-500/15 text-sky-400';
                      if (live.trial_end) detail = `Trial ends ${fmtDateShort(live.trial_end)}`;
                    } else if (live.status === 'past_due') {
                      statusLabel = 'past due';
                      statusCls = 'bg-rose-500/15 text-rose-400';
                      detail = 'Payment failed — retry below';
                    } else if (live.status === 'unpaid') {
                      statusLabel = 'unpaid';
                      statusCls = 'bg-rose-500/15 text-rose-400';
                      detail = 'Subscription unpaid — retry below';
                    } else if (live.status === 'incomplete' || live.status === 'incomplete_expired') {
                      statusLabel = 'incomplete';
                      statusCls = 'bg-amber-500/15 text-amber-500';
                      detail = 'Checkout never completed';
                    } else if (live.status === 'canceled') {
                      if (hasAccess) {
                        statusLabel = 'canceling';
                        statusCls = 'bg-amber-500/15 text-amber-500';
                        detail = `Access ends ${fmtDateShort(live.current_period_end!)}`;
                      } else {
                        statusLabel = 'canceled';
                        statusCls = 'bg-zinc-500/15 text-zinc-400';
                        detail = live.canceled_at ? `Ended ${fmtDateShort(live.canceled_at)}` : null;
                      }
                    }
                  } else if (sub?.status === 'active') {
                    statusCls = 'bg-emerald-500/15 text-emerald-500';
                  } else if (sub?.status === 'pending') {
                    statusCls = 'bg-amber-500/15 text-amber-500';
                  }

                  return (
                    <>
                      <KV
                        icon={<Crown className="w-3.5 h-3.5" />}
                        label="Plan"
                        value={
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            <span className="capitalize font-medium text-zinc-900 dark:text-zinc-100">{plan}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] capitalize ${statusCls}`}>{statusLabel}</span>
                            {hasAccess && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                Has access
                              </span>
                            )}
                            {sub?.isWhitelisted && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">Whitelisted</span>
                            )}
                          </span>
                        }
                      />
                      {detail && <KV label="Status" value={<span className="text-zinc-700 dark:text-zinc-300">{detail}</span>} />}
                      {(live?.status === 'past_due' || live?.status === 'unpaid') && (
                        <button
                          onClick={() => retryPayment(null)}
                          disabled={retrying === 'all'}
                          className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 text-white dark:text-black text-xs font-semibold disabled:opacity-50 transition-colors"
                        >
                          {retrying === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          {retrying === 'all' ? 'Retrying…' : 'Retry failed payment'}
                        </button>
                      )}
                    </>
                  );
                })()}
                {sub?.chosen_plan && sub.chosen_plan !== sub.plan && (
                  <KV label="Chosen plan" value={<span className="capitalize">{sub.chosen_plan}</span>} />
                )}
                {sub?.recommended_plan && (
                  <KV label="Recommended" value={<span className="capitalize">{sub.recommended_plan}</span>} />
                )}
                {sub?.updated_at && (
                  <KV label="Sub updated" value={fmtDate(sub.updated_at)} />
                )}
              </Section>

              {/* Payment source */}
              <Section title="Payment source">
                {pm ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 rounded-lg bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 p-3">
                      <CreditCard className="w-5 h-5 text-zinc-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-zinc-900 dark:text-white text-sm">
                          {pm.label || `${CARD_BRAND_GLYPHS[pm.brand?.toLowerCase() || 'unknown'] || pm.brand}${pm.last4 ? ` · •••• ${pm.last4}` : ''}`}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {pm.type === 'card' && pm.exp_month && pm.exp_year
                            ? <>Exp {String(pm.exp_month).padStart(2, '0')}/{pm.exp_year} · {pm.funding || 'card'} · {pm.country || '—'}</>
                            : <>{pm.reusable === false ? 'Paid source detected · not saved for future charges' : 'Reusable payment method'}{pm.country ? ` · ${pm.country}` : ''}</>}
                        </div>
                        {pm.source && (
                          <div className="mt-0.5 text-[10px] text-zinc-400 font-mono truncate">
                            Source: {pm.source}
                          </div>
                        )}
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
                    {data.stripe.customer_id ? 'No reusable payment source found' : 'No Stripe customer linked'}
                  </div>
                )}
              </Section>

              {/* Charge / Collect card */}
              <Section title={pm?.reusable !== false ? (pm ? 'Charge payment source' : 'Collect payment method') : 'Collect reusable payment method'}>
                {pm && pm.reusable !== false ? (
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

                    {/* Charge mode picker — prorate (default), full plan
                        price now, or custom dollar amount. */}
                    <div className="flex flex-col gap-1">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider px-0.5">Charge mode</div>
                      <div className="grid grid-cols-3 gap-1">
                        {(['prorate', 'full', 'custom'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setChargeMode(m)}
                            className={`px-2 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                              chargeMode === m
                                ? 'bg-zinc-900 dark:bg-white text-white dark:text-black border-zinc-900 dark:border-white'
                                : 'bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/20'
                            }`}
                          >
                            {m === 'prorate' ? 'Prorate' : m === 'full' ? 'Full price' : 'Custom $'}
                          </button>
                        ))}
                      </div>
                      <div className="text-[10px] text-zinc-500 px-0.5 mt-0.5">
                        {chargeMode === 'prorate' && 'Credits unused time on current plan. Stripe default.'}
                        {chargeMode === 'full' && 'No proration credit — charges the full new-plan price at next renewal only.'}
                        {chargeMode === 'custom' && 'Charges any amount via PaymentIntent. Subscription is NOT modified.'}
                      </div>
                    </div>

                    {/* Custom amount input (only when mode === 'custom') */}
                    {chargeMode === 'custom' && (
                      <div className="flex flex-col gap-1">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider px-0.5">Amount (USD)</div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                          <input
                            type="number"
                            min="0.50"
                            step="0.01"
                            placeholder="0.00"
                            value={customAmountCents != null ? (customAmountCents / 100).toString() : ''}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setCustomAmountCents(Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null);
                            }}
                            className="w-full pl-7 pr-3 py-2 rounded-md border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-white/30"
                          />
                        </div>
                      </div>
                    )}

                    {/* Inline proration preview — what Stripe will actually
                        charge right now (vs the full recurring price). */}
                    {chargeMode !== 'custom' && (
                    <div className="rounded-lg border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] px-3 py-2.5 text-[11px]">
                      {previewLoading ? (
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {t('settings.billing.calculatingProration', 'Calculating proration…')}
                        </div>
                      ) : previewError ? (
                        <div className="text-rose-500">⚠ {previewError}</div>
                      ) : preview ? (
                        <>
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-zinc-500 dark:text-zinc-400">{t('settings.billing.amountDueNow', 'Amount due now')}</span>
                            <span className="text-sm font-semibold text-zinc-900 dark:text-white tabular-nums">
                              {fmtCurrency(preview.amount_due_now_cents || 0, preview.currency || 'usd')}
                            </span>
                          </div>
                          {!preview.is_new_subscription && preview.next_full_charge_cents > 0 && (
                            <div className="flex items-baseline justify-between text-[10px] text-zinc-500 mb-1.5">
                              <span>{t('settings.billing.thenRenewsAt', 'Then renews at')}</span>
                              <span className="tabular-nums">
                                {fmtCurrency(preview.next_full_charge_cents, preview.currency || 'usd')}
                                /{chargeInterval === 'yearly' ? t('common.yearShort', 'yr') : t('common.monthShort', 'mo')}
                              </span>
                            </div>
                          )}
                          {Array.isArray(preview.line_items) && preview.line_items.length > 0 && (
                            <div className="border-t border-zinc-200 dark:border-white/5 pt-1.5 mt-1.5 space-y-0.5">
                              {preview.line_items.map((l: any, i: number) => (
                                <div key={i} className="flex items-baseline justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                                  <span className="truncate pr-2">
                                    {l.description}
                                    {l.proration ? ` · ${t('settings.billing.proratedSuffix', 'prorated')}` : ''}
                                  </span>
                                  <span className={`tabular-nums flex-shrink-0 ${l.amount_cents < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                                    {l.amount_cents < 0 ? '-' : ''}{fmtCurrency(Math.abs(l.amount_cents), preview.currency || 'usd')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {preview.is_new_subscription && (
                            <div className="text-[10px] text-zinc-500 mt-1">{t('settings.billing.newSubscriptionNoProration', 'New subscription · no proration credit')}</div>
                          )}
                        </>
                      ) : null}
                    </div>
                    )}

                    <button
                      onClick={chargeCard}
                      disabled={charging || previewLoading || (chargeMode === 'custom' && (!customAmountCents || customAmountCents < 50))}
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      {charging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                      {charging
                        ? t('settings.billing.charging', 'Charging…')
                        : chargeMode === 'custom'
                          ? customAmountCents && customAmountCents >= 50
                            ? `Charge $${(customAmountCents / 100).toFixed(2)} now`
                            : 'Enter amount'
                          : preview && !previewError
                            ? t('settings.billing.chargeAmountNow', 'Charge {{amount}} now', {
                                amount: fmtCurrency(preview.amount_due_now_cents || 0, preview.currency || 'usd'),
                              })
                            : `Charge ${chargeInterval === 'yearly' ? PLAN_PRICES[chargePlan].yearly + '/yr' : PLAN_PRICES[chargePlan].monthly + '/mo'}`}
                    </button>
                    <div className="text-[10px] text-zinc-500">
                      Creates or updates the Stripe subscription and bills the card immediately. Switching intervals re-bills with proration.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-zinc-500">
                      {pm?.reusable === false
                        ? 'This customer has paid through Stripe, but no reusable payment method is saved for future admin charges. Generate a setup link so they can save one.'
                        : 'User has no reusable payment method on file. Generate a Stripe setup link — when they open it, they can save one without being charged.'}
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
                            : inv.status === 'uncollectible' ? 'bg-rose-500/15 text-rose-400'
                            : 'bg-zinc-500/15 text-zinc-400'
                          }`}>{inv.status}</span>
                          {(inv.status === 'open' || inv.status === 'uncollectible') && !inv.paid && (
                            <button
                              onClick={() => retryPayment(inv.id)}
                              disabled={retrying === inv.id || retrying === 'all'}
                              title="Retry this payment"
                              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50"
                            >
                              {retrying === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            </button>
                          )}
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

              {/* Timeline */}
              <TimelineSection userId={userId} />
            </>
          )}
        </div>

        {/* Actions footer — 3-col grid on mobile with icon-over-label so all 9
            actions stay visible in ~3 short rows instead of a giant 5-row block.
            Safe-area padding so the last row clears the iPhone home indicator. */}
        <div
          className="flex-shrink-0 border-t border-zinc-200 dark:border-white/10 px-3 sm:px-6 py-2 sm:py-3"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <ActionBtn
              onClick={sendApprovalEmail}
              icon={sendingApproval ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
            >
              {sendingApproval ? 'Sending…' : 'Send approval'}
            </ActionBtn>
            <ActionBtn onClick={onEditPlan} icon={<Edit3 className="w-3.5 h-3.5" />}>Edit plan</ActionBtn>
            <ActionBtn onClick={impersonate} icon={<Users className="w-3.5 h-3.5" />}>Sign in as</ActionBtn>
            <ActionBtn onClick={sendLoginLink} icon={sendingLoginLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}>Login link</ActionBtn>
            <ActionBtn onClick={onManageCredits} icon={<Zap className="w-3.5 h-3.5" />}>Credits</ActionBtn>
            <ActionBtn onClick={onInspectKv} icon={<Database className="w-3.5 h-3.5" />}>Inspect KV</ActionBtn>
            <ActionBtn
              onClick={cleanBouncedLeads}
              icon={cleaningBounces ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
            >
              {cleaningBounces ? 'Cleaning…' : 'Clean bounces'}
            </ActionBtn>
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

interface TimelineEvent {
  at: string;
  type: string;
  title: string;
  detail?: string;
  meta?: any;
}

function TimelineSection({ userId }: { userId: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/users/${userId}/timeline`,
        );
        const j = await r.json();
        if (active) setEvents(j.events || []);
      } catch {
        if (active) setEvents([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [userId]);

  if (loading) {
    return (
      <Section title="Timeline">
        <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
      </Section>
    );
  }
  if (!events || events.length === 0) {
    return (
      <Section title="Timeline">
        <div className="text-xs text-zinc-500 italic">No events yet.</div>
      </Section>
    );
  }

  return (
    <Section title={`Timeline · ${events.length}`}>
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 text-xs py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-0">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 mt-1.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-zinc-900 dark:text-zinc-100 font-medium truncate">{e.title}</div>
              {e.detail && <div className="text-zinc-500 text-[11px] truncate">{e.detail}</div>}
            </div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-600 flex-shrink-0 whitespace-nowrap">
              {fmtDate(e.at)}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

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
}: { children: React.ReactNode; icon?: React.ReactNode; onClick: () => void; variant?: 'amber' | 'danger' | 'primary' }) {
  // Mobile: icon stacked over a tiny label (compact, fits 3-up). Desktop:
  // icon + label inline (the original pill look).
  const base = 'rounded-lg font-medium flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 transition-colors whitespace-nowrap text-[10px] sm:text-xs px-2 py-2 sm:px-2.5 sm:py-2';
  const cls = variant === 'danger'
    ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20'
    : variant === 'amber'
    ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20'
    : variant === 'primary'
    ? 'bg-[#1ED4A7] hover:bg-[#1bc99c] text-black border border-[#1ED4A7] font-semibold'
    : 'bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/10';
  return (
    <button onClick={onClick} className={`${base} ${cls}`}>
      {icon}<span className="truncate">{children}</span>
    </button>
  );
}
