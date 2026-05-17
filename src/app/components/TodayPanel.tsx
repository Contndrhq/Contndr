// TodayPanel — the "what matters RIGHT NOW" home-screen card stack.
//
// Replaces six charts with a small list of concrete actions: someone is
// on your site, a reply landed, a deal closed, payment failed, etc.
// Empty signals collapse. If everything is zero, show a clean "Nothing
// urgent" line — not a marketing-flavored AI message.
//
// Copy guidelines (we got AI-flavor complaints):
//   - No em-dashes (—) or en-dashes (–). Use periods, commas, parens.
//   - No "·" middot separators. Use a plain comma.
//   - No "we'll alert you", "ship a campaign", "shoot us a note".
//   - Numbers and nouns. "5 replies waiting" beats "you've got messages!"

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flame, MessageSquare, Send, PhoneCall, CheckCircle2, Loader2, ArrowRight,
  ChevronDown, UserPlus, DollarSign, AlertTriangle, CreditCard, Clock,
} from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;
const POLL_INTERVAL_MS = 30_000;

interface HotVisitor {
  lead_id: string;
  name: string;
  business: string;
  page: string;
  last_seen_ms_ago: number;
}
interface UnreadReply {
  email_id: string;
  lead_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  snippet: string;
  received_at: string;
}
interface CampaignSummary {
  id: string;
  name: string;
  brand: string;
  status: string;
  sent: number;
  total: number;
}
interface DealItem {
  id: string;
  name: string;
  customer: string;
  amount: number;
}
interface ScheduledItem {
  id: string;
  name: string;
  scheduled_at: string;
}
interface TodayData {
  hot_visitors_now: { count: number; top: HotVisitor[] };
  unread_replies: { count: number; top: UnreadReply[] };
  campaigns_sending: { count: number; items: CampaignSummary[] };
  ai_calls_today: { total: number; connected: number; active_now: number };
  new_leads_today?: { count: number };
  deals_won_today?: { count: number; total_amount: number; items: DealItem[] };
  bounces_last_24h?: { count: number };
  scheduled_soon?: { count: number; items: ScheduledItem[] };
  payment_alert?: { status: string } | null;
}

export function TodayPanel({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  // Collapsible. Power users in chart mode don't want Today pushing the
  // charts down on every visit. Choice persists.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('contndr:today:collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('contndr:today:collapsed', collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);
  const errorCountRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/today`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(json);
      errorCountRef.current = 0;
    } catch {
      errorCountRef.current = Math.min(errorCountRef.current + 1, 6);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const tick = () => {
      if (document.hidden) return;
      const backoff = errorCountRef.current > 0
        ? Math.min(120_000, POLL_INTERVAL_MS * 2 ** errorCountRef.current)
        : POLL_INTERVAL_MS;
      load();
      timer = setTimeout(tick, backoff);
    };
    let timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-black p-6">
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading.</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const cards: React.ReactNode[] = [];

  // Order matters: most-urgent action first.

  // 1. Payment problem — single most-urgent thing in the app
  if (data.payment_alert) {
    const status = data.payment_alert.status;
    cards.push(
      <Card
        key="payment"
        icon={CreditCard}
        accent="text-red-500"
        accentBg="bg-red-500/10"
        title={status === 'past_due'
          ? 'Payment past due. Update your card.'
          : 'Subscription payment failed.'}
        action="Open billing"
        onAction={() => onNavigate?.('settings')}
      />
    );
  }

  // 2. Hot prospects on site right now
  if (data.hot_visitors_now.count > 0) {
    const n = data.hot_visitors_now.count;
    cards.push(
      <Card
        key="hot"
        icon={Flame}
        accent="text-orange-500"
        accentBg="bg-orange-500/10"
        title={`${n} hot ${n === 1 ? 'prospect' : 'prospects'} on your site now`}
        action="See live visitors"
        onAction={() => onNavigate?.('intent')}
      >
        <div className="space-y-1.5">
          {data.hot_visitors_now.top.map(v => (
            <div key={v.lead_id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <div className="min-w-0 flex-1 truncate">
                <span className="font-medium text-zinc-900 dark:text-white">{v.name}</span>
                {v.business && <span className="text-zinc-500 dark:text-zinc-400">{`, ${v.business}`}</span>}
                <span className="text-zinc-400 dark:text-zinc-500">{` on ${v.page || '/'}`}</span>
              </div>
              <span className="text-zinc-400 dark:text-zinc-500 text-[11px] shrink-0">{formatAgo(v.last_seen_ms_ago)}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // 3. Unread replies — action requires you, lead is waiting
  if (data.unread_replies.count > 0) {
    const n = data.unread_replies.count;
    cards.push(
      <Card
        key="replies"
        icon={MessageSquare}
        accent="text-emerald-500"
        accentBg="bg-emerald-500/10"
        title={`${n} ${n === 1 ? 'reply' : 'replies'} waiting for you`}
        action="Open inbox"
        onAction={() => onNavigate?.('inbox')}
      >
        <div className="space-y-1.5">
          {data.unread_replies.top.map(r => (
            <div key={r.email_id} className="text-[12.5px] truncate">
              <span className="font-medium text-zinc-900 dark:text-white">{r.from_name}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{`: ${r.subject}`}</span>
              {r.snippet && (
                <span className="text-zinc-400 dark:text-zinc-500">
                  {`. ${r.snippet.slice(0, 60)}${r.snippet.length > 60 ? '…' : ''}`}
                </span>
              )}
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // 4. Deals closed today — celebrate + log
  if (data.deals_won_today && data.deals_won_today.count > 0) {
    const d = data.deals_won_today;
    cards.push(
      <Card
        key="won"
        icon={DollarSign}
        accent="text-emerald-500"
        accentBg="bg-emerald-500/10"
        title={d.total_amount > 0
          ? `${d.count} ${d.count === 1 ? 'deal' : 'deals'} closed today, ${formatMoney(d.total_amount)}`
          : `${d.count} ${d.count === 1 ? 'deal' : 'deals'} closed today`}
        action="Open pipeline"
        onAction={() => onNavigate?.('pipeline')}
      >
        <div className="space-y-1.5">
          {d.items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-zinc-900 dark:text-white truncate flex-1 min-w-0">
                {it.customer || it.name}
              </span>
              {it.amount > 0 && (
                <span className="text-zinc-500 dark:text-zinc-400 shrink-0">{formatMoney(it.amount)}</span>
              )}
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // 5. AI calls happening / done today
  if (data.ai_calls_today.active_now > 0 || data.ai_calls_today.total > 0) {
    const a = data.ai_calls_today;
    const isLive = a.active_now > 0;
    const titleText = isLive
      ? `${a.active_now} AI ${a.active_now === 1 ? 'call' : 'calls'} live now`
      : `${a.connected} of ${a.total} AI ${a.total === 1 ? 'call' : 'calls'} connected today`;
    cards.push(
      <Card
        key="calls"
        icon={PhoneCall}
        accent={isLive ? 'text-rose-500' : 'text-sky-500'}
        accentBg={isLive ? 'bg-rose-500/10' : 'bg-sky-500/10'}
        title={titleText}
        action="Open AI calls"
        onAction={() => onNavigate?.('ai-calls')}
      />
    );
  }

  // 6. Campaigns sending right now
  if (data.campaigns_sending.count > 0) {
    const n = data.campaigns_sending.count;
    cards.push(
      <Card
        key="campaigns"
        icon={Send}
        accent="text-violet-500"
        accentBg="bg-violet-500/10"
        title={`${n} ${n === 1 ? 'campaign' : 'campaigns'} sending`}
        action="Open campaigns"
        onAction={() => onNavigate?.('campaigns')}
      >
        <div className="space-y-1.5">
          {data.campaigns_sending.items.slice(0, 3).map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-zinc-900 dark:text-white truncate flex-1 min-w-0">{c.name}</span>
              <span className="text-zinc-500 dark:text-zinc-400 shrink-0">{c.sent}/{c.total || '∞'}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // 7. Bounce spike — deliverability risk
  if (data.bounces_last_24h && data.bounces_last_24h.count >= 5) {
    const n = data.bounces_last_24h.count;
    cards.push(
      <Card
        key="bounces"
        icon={AlertTriangle}
        accent="text-amber-500"
        accentBg="bg-amber-500/10"
        title={`${n} ${n === 1 ? 'bounce' : 'bounces'} in the last 24h`}
        action="Review bounced leads"
        onAction={() => onNavigate?.('crm')}
      />
    );
  }

  // 8. Scheduled campaigns about to fire
  if (data.scheduled_soon && data.scheduled_soon.count > 0) {
    const s = data.scheduled_soon;
    cards.push(
      <Card
        key="scheduled"
        icon={Clock}
        accent="text-sky-500"
        accentBg="bg-sky-500/10"
        title={`${s.count} ${s.count === 1 ? 'campaign' : 'campaigns'} scheduled in the next 24h`}
        action="Open campaigns"
        onAction={() => onNavigate?.('campaigns')}
      >
        <div className="space-y-1.5">
          {s.items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-zinc-900 dark:text-white truncate flex-1 min-w-0">{it.name}</span>
              <span className="text-zinc-500 dark:text-zinc-400 shrink-0">{formatWhen(it.scheduled_at)}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // 9. New leads today — quiet good-news card, only when notable
  if (data.new_leads_today && data.new_leads_today.count >= 10) {
    const n = data.new_leads_today.count;
    cards.push(
      <Card
        key="newleads"
        icon={UserPlus}
        accent="text-zinc-600 dark:text-zinc-300"
        accentBg="bg-zinc-500/10"
        title={`${n.toLocaleString()} new ${n === 1 ? 'lead' : 'leads'} today`}
        action="Open leads"
        onAction={() => onNavigate?.('crm')}
      />
    );
  }

  // Total signal count drives the collapsed-state badge. Only count
  // events that actually need a human (skip "informational" newleads
  // and AI-calls-completed-today which don't need action).
  const totalSignals = data
    ? data.hot_visitors_now.count
      + data.unread_replies.count
      + data.ai_calls_today.active_now
      + data.campaigns_sending.count
      + (data.deals_won_today?.count || 0)
      + (data.payment_alert ? 1 : 0)
      + (data.bounces_last_24h && data.bounces_last_24h.count >= 5 ? 1 : 0)
      + (data.scheduled_soon?.count || 0)
    : 0;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between gap-3 group"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">Today</h2>
          {collapsed && totalSignals > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-black text-[10.5px] font-bold">
              {totalSignals}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        </div>
        <span className="text-[11.5px] text-zinc-400 dark:text-zinc-500">
          {collapsed
            ? (totalSignals > 0 ? `${totalSignals} to act on` : 'Nothing urgent')
            : 'Updating every 30s'}
        </span>
      </button>

      {collapsed ? null : cards.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-black p-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-zinc-900 dark:text-white">Nothing urgent right now</p>
            <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              No live visitors, replies, or alerts. New signals show up here as they happen.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{cards}</div>
      )}
    </section>
  );
}

function Card({ icon: Icon, accent, accentBg, title, action, onAction, children }: {
  icon: any;
  accent: string;
  accentBg: string;
  title: string;
  action?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-black p-4 flex flex-col">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-xl ${accentBg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4.5 h-4.5 ${accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-white leading-snug">{title}</p>
        </div>
      </div>
      {children && <div className="mb-3">{children}</div>}
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="self-start inline-flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white"
        >
          {action}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function formatAgo(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function formatWhen(iso: string) {
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  if (diff < 0) return 'now';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function formatMoney(amount: number) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
