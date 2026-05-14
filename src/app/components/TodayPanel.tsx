// TodayPanel — the "what matters RIGHT NOW" home-screen card stack.
//
// Replaces the cognitive load of "look at six charts and figure out what to
// do" with a small list of concrete actions: someone is on your site, you
// have unread replies, your campaign is sending, a call is happening.
// Anything with a zero count collapses. If everything is zero, show
// "All caught up" rather than a stack of empty boxes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, MessageSquare, Send, PhoneCall, CheckCircle2, Loader2, ArrowRight, ChevronDown } from 'lucide-react';
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
interface TodayData {
  hot_visitors_now: { count: number; top: HotVisitor[] };
  unread_replies: { count: number; top: UnreadReply[] };
  campaigns_sending: { count: number; items: CampaignSummary[] };
  ai_calls_today: { total: number; connected: number; active_now: number };
}

export function TodayPanel({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  // Collapsible — power users who flip into the full-dashboard view don't
  // want Today pushing the charts down on every visit. Choice persists.
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
          <span className="text-sm">Loading today's priorities…</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const cards: React.ReactNode[] = [];

  if (data.hot_visitors_now.count > 0) {
    cards.push(
      <Card
        key="hot"
        icon={Flame}
        accent="text-orange-500"
        accentBg="bg-orange-500/10"
        title={`${data.hot_visitors_now.count} hot prospect${data.hot_visitors_now.count > 1 ? 's' : ''} on your site right now`}
        action="See live visitors"
        onAction={() => onNavigate?.('intent')}
      >
        <div className="space-y-1.5">
          {data.hot_visitors_now.top.map(v => (
            <div key={v.lead_id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <div className="min-w-0 flex-1 truncate">
                <span className="font-medium text-zinc-900 dark:text-white">{v.name}</span>
                {v.business && <span className="text-zinc-500 dark:text-zinc-400"> · {v.business}</span>}
                <span className="text-zinc-400 dark:text-zinc-500"> · {v.page || '/'}</span>
              </div>
              <span className="text-zinc-400 dark:text-zinc-500 text-[11px] shrink-0">{formatAgo(v.last_seen_ms_ago)}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (data.unread_replies.count > 0) {
    cards.push(
      <Card
        key="replies"
        icon={MessageSquare}
        accent="text-emerald-500"
        accentBg="bg-emerald-500/10"
        title={`${data.unread_replies.count} unanswered repl${data.unread_replies.count > 1 ? 'ies' : 'y'}`}
        action="Open inbox"
        onAction={() => onNavigate?.('inbox')}
      >
        <div className="space-y-1.5">
          {data.unread_replies.top.map(r => (
            <div key={r.email_id} className="text-[12.5px] truncate">
              <span className="font-medium text-zinc-900 dark:text-white">{r.from_name}</span>
              <span className="text-zinc-500 dark:text-zinc-400"> — {r.subject}</span>
              {r.snippet && <span className="text-zinc-400 dark:text-zinc-500"> · {r.snippet.slice(0, 60)}{r.snippet.length > 60 ? '…' : ''}</span>}
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (data.ai_calls_today.active_now > 0 || data.ai_calls_today.total > 0) {
    const a = data.ai_calls_today;
    const isLive = a.active_now > 0;
    cards.push(
      <Card
        key="calls"
        icon={PhoneCall}
        accent={isLive ? 'text-rose-500' : 'text-sky-500'}
        accentBg={isLive ? 'bg-rose-500/10' : 'bg-sky-500/10'}
        title={isLive
          ? `${a.active_now} AI call${a.active_now > 1 ? 's' : ''} happening right now`
          : `${a.connected}/${a.total} AI call${a.total > 1 ? 's' : ''} connected today`
        }
        action="Open AI calls"
        onAction={() => onNavigate?.('ai-calls')}
      />
    );
  }

  if (data.campaigns_sending.count > 0) {
    cards.push(
      <Card
        key="campaigns"
        icon={Send}
        accent="text-violet-500"
        accentBg="bg-violet-500/10"
        title={`${data.campaigns_sending.count} campaign${data.campaigns_sending.count > 1 ? 's' : ''} sending`}
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

  // Total signal count drives the badge when collapsed
  const totalSignals = data
    ? data.hot_visitors_now.count + data.unread_replies.count
      + data.ai_calls_today.active_now + data.campaigns_sending.count
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
          {collapsed ? (totalSignals > 0 ? `${totalSignals} thing${totalSignals > 1 ? 's' : ''} to act on` : 'All caught up') : 'Live · auto-refreshing'}
        </span>
      </button>

      {collapsed ? null : cards.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-black p-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-zinc-900 dark:text-white">All caught up</p>
            <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              No hot visitors, replies, or calls right now. Ship a campaign or wait for signals — we'll alert you.
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
