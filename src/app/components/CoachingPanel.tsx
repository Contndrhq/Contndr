/**
 * Conversation Intelligence — coaching insights view.
 *
 * Mounted as a tab inside AICalls. Reads from /coaching/insights and
 * renders takeaways, top objections, win/loss patterns, high-intent
 * follow-ups, and AI quality leaderboard.
 *
 * No new data captured — purely a smarter read over the call records
 * we already store. Toggle the date-range window to see trends.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lightbulb, AlertTriangle, TrendingUp, MessageSquare, Sparkles, Award, AlertCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface Insights {
  window_days: number;
  total_calls: number;
  connected_calls: number;
  classified_calls: number;
  outcomes: Record<string, number>;
  connect_rate: number;
  win_rate: number;
  avg_quality_score: number;
  avg_duration_seconds: number;
  top_objections: Array<{ label: string; count: number; pct_of_calls: number; sample_call_ids: string[] }>;
  next_actions: Array<{ action: string; count: number; sample_call_ids: string[] }>;
  high_intent_unbooked: Array<{ id: string; name: string; business: string; outcome: string; score: number; summary: string; next_action: string; ended_at?: string }>;
  highest_quality_calls: Array<{ id: string; name: string; business: string; quality_score: number; summary: string; ended_at?: string }>;
  lowest_quality_calls: Array<{ id: string; name: string; business: string; quality_score: number; summary: string; ended_at?: string }>;
  takeaways: string[];
}

interface Props {
  onOpenCall?: (callId: string) => void;
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function CoachingPanel({ onOpenCall }: Props) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authenticatedFetch(`${API}/coaching/insights?days=${days}`);
      const j = await r.json();
      if (r.ok) setInsights(j);
      else toast.error(j.error || 'Failed to load coaching insights');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load coaching insights');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading && !insights) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing calls…
      </div>
    );
  }

  if (!insights) return null;

  return (
    <div className="space-y-4">
      {/* Range toggle */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#1ED4A7]" />
          Coaching insights
        </h3>
        <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                days === r.days ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {/* Takeaways — plain English headline insights */}
      {insights.takeaways.length > 0 && (
        <div className="space-y-2">
          {insights.takeaways.map((t, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-[#1ED4A7]/30 bg-[#1ED4A7]/5 text-sm text-zinc-800 dark:text-zinc-200">
              <Lightbulb className="w-4 h-4 text-[#1ED4A7] shrink-0 mt-0.5" />
              <span className="leading-relaxed">{t}</span>
            </div>
          ))}
        </div>
      )}

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Total calls" value={String(insights.total_calls)} />
        <Tile label="Connect rate" value={fmtPct(insights.connect_rate)} accent={insights.connect_rate >= 0.2 ? 'emerald' : insights.connect_rate > 0 ? 'amber' : undefined} />
        <Tile label="Win rate" value={fmtPct(insights.win_rate)} accent={insights.win_rate >= 0.15 ? 'emerald' : undefined} />
        <Tile label="AI quality" value={insights.avg_quality_score ? `${Math.round(insights.avg_quality_score)}/100` : '—'} accent={insights.avg_quality_score >= 70 ? 'emerald' : insights.avg_quality_score && insights.avg_quality_score < 50 ? 'rose' : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Top objections */}
        <Card icon={AlertTriangle} title="Top objections" subtitle="What prospects push back on most">
          {insights.top_objections.length === 0 ? (
            <Empty>No objections logged yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {insights.top_objections.map(o => (
                <li key={o.label} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-white capitalize">{o.label.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-zinc-500 tabular-nums">{o.count} · {fmtPct(o.pct_of_calls)}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, o.pct_of_calls * 100)}%` }} />
                  </div>
                  {onOpenCall && o.sample_call_ids.length > 0 && (
                    <button onClick={() => onOpenCall(o.sample_call_ids[0])} className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white mt-1">
                      Sample call →
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Outcomes breakdown */}
        <Card icon={TrendingUp} title="Outcome mix" subtitle="How calls ended this period">
          {Object.keys(insights.outcomes).length === 0 ? (
            <Empty>No classified calls yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {Object.entries(insights.outcomes).sort((a, b) => b[1] - a[1]).map(([outcome, count]) => {
                const pct = insights.classified_calls ? count / insights.classified_calls : 0;
                const tone = outcome === 'booked' || outcome === 'positive' ? 'bg-emerald-500'
                  : outcome === 'engaged' ? 'bg-[#1ED4A7]'
                  : outcome === 'voicemail' || outcome === 'no_answer' ? 'bg-zinc-500'
                  : outcome === 'negative' || outcome === 'not_interested' ? 'bg-rose-500'
                  : 'bg-amber-500';
                return (
                  <li key={outcome} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-700 dark:text-zinc-300 capitalize">{outcome.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-zinc-500 tabular-nums">{count} · {fmtPct(pct)}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
                      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* High-intent unbooked — the "follow up THIS WEEK" list */}
        <Card icon={AlertCircle} title="High-intent · not booked" subtitle="Engaged but didn't lock a meeting — follow up manually" accent="emerald">
          {insights.high_intent_unbooked.length === 0 ? (
            <Empty>No high-intent leads waiting on follow-up.</Empty>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto -mr-2 pr-2">
              {insights.high_intent_unbooked.map(c => (
                <li key={c.id}>
                  <button
                    onClick={() => onOpenCall?.(c.id)}
                    className="w-full text-left p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">{c.name}{c.business ? ` · ${c.business}` : ''}</span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">{c.score}/100</span>
                    </div>
                    {c.summary && <p className="text-xs text-zinc-500 mt-0.5 leading-snug line-clamp-2">{c.summary}</p>}
                    {c.next_action && <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1"><span className="text-[10px] uppercase tracking-wider text-zinc-400 mr-1">Next:</span>{c.next_action}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Next-action patterns */}
        <Card icon={MessageSquare} title="Common next actions" subtitle="What the AI is being told to do most">
          {insights.next_actions.length === 0 ? (
            <Empty>No actions logged yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {insights.next_actions.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300 truncate">{a.action}</span>
                  <span className="text-xs text-zinc-500 tabular-nums shrink-0">{a.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* AI quality leaderboard */}
        {(insights.highest_quality_calls.length > 0 || insights.lowest_quality_calls.length > 0) && (
          <>
            <Card icon={Award} title="Best AI calls" subtitle="Learn from what's working" accent="emerald">
              <QualityList items={insights.highest_quality_calls} onOpen={onOpenCall} />
            </Card>
            <Card icon={AlertTriangle} title="Lowest-scored AI calls" subtitle="Review and update agent instructions" accent="rose">
              <QualityList items={insights.lowest_quality_calls} onOpen={onOpenCall} />
            </Card>
          </>
        )}
      </div>

      {insights.avg_duration_seconds > 0 && (
        <div className="flex items-center justify-end gap-1.5 text-[11px] text-zinc-500">
          <Clock className="w-3 h-3" />
          Avg duration: {fmtDuration(insights.avg_duration_seconds)} · {insights.classified_calls} classified of {insights.total_calls}
        </div>
      )}
    </div>
  );
}

// ─── sub-components ────────────────────────────────────────────────────

function Card({ icon: Icon, title, subtitle, accent, children }: { icon: any; title: string; subtitle?: string; accent?: 'emerald' | 'rose' | 'amber'; children: React.ReactNode }) {
  const tone = accent === 'emerald' ? 'text-[#1ED4A7]'
    : accent === 'rose' ? 'text-rose-500'
    : accent === 'amber' ? 'text-amber-500'
    : 'text-zinc-500';
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black p-4">
      <div className="flex items-start gap-2 mb-3">
        <Icon className={`w-4 h-4 ${tone} mt-0.5 shrink-0`} />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h4>
          {subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function QualityList({ items, onOpen }: { items: any[]; onOpen?: (id: string) => void }) {
  if (items.length === 0) return <Empty>No data.</Empty>;
  return (
    <ul className="space-y-2">
      {items.map(c => (
        <li key={c.id}>
          <button onClick={() => onOpen?.(c.id)} className="w-full text-left p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">{c.name}{c.business ? ` · ${c.business}` : ''}</span>
              <span className="text-[10px] font-semibold tabular-nums text-zinc-500">{c.quality_score}/100</span>
            </div>
            {c.summary && <p className="text-xs text-zinc-500 mt-0.5 leading-snug line-clamp-2">{c.summary}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'rose' | 'amber' }) {
  const color = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : accent === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : accent === 'rose' ? 'text-rose-600 dark:text-rose-400'
    : 'text-zinc-900 dark:text-white';
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-500 italic">{children}</p>;
}

function fmtPct(n: number): string { return `${Math.round((n || 0) * 100)}%`; }
function fmtDuration(s: number): string {
  if (!s) return '0s';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export default CoachingPanel;
