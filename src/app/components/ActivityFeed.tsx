import { useState, useEffect, useCallback } from 'react';
import {
  Mail, MailOpen, MousePointerClick, MessageSquare, Calendar, FileText, DollarSign,
  ArrowRight, Zap, RefreshCw, X, Clock, Building2, ChevronDown,
  Loader2, Filter
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { useCurrency } from '../lib/CurrencyContext';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/pipeline`;

interface TriggerLogEntry {
  event_type: string;
  user_id: string;
  email?: string;
  lead_id?: string;
  metadata?: Record<string, any>;
  triggered_at: string;
  deal_id?: string;
  deal_contact?: string;
  deal_business?: string;
  deal_value?: number;
  old_stage?: string;
  new_stage?: string;
}

const STAGE_LABELS: Record<string, string> = {
  prospect_identified: 'Prospect Identified',
  contacted: 'Contacted',
  engaged: 'Engaged',
  meeting_booked: 'Meeting Booked',
  proposal_sent: 'Proposal Sent',
  negotiation: 'Negotiation',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

const EVENT_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string; bgColor: string }> = {
  email_sent: { icon: Mail, label: 'Email Sent', color: 'text-zinc-400 dark:text-zinc-400', bgColor: 'bg-zinc-100 dark:bg-zinc-500/10' },
  email_opened: { icon: MailOpen, label: 'Email Opened', color: 'text-zinc-400 dark:text-zinc-400', bgColor: 'bg-zinc-100 dark:bg-zinc-500/10' },
  email_clicked: { icon: MousePointerClick, label: 'Email Clicked', color: 'text-[#1ED4A7] dark:text-[#1ED4A7]', bgColor: 'bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10' },
  email_replied: { icon: MessageSquare, label: 'Email Replied', color: 'text-[#1ED4A7] dark:text-[#1ED4A7]', bgColor: 'bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10' },
  meeting_booked: { icon: Calendar, label: 'Meeting Booked', color: 'text-[#1ED4A7] dark:text-[#1ED4A7]', bgColor: 'bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10' },
  proposal_sent: { icon: FileText, label: 'Proposal Sent', color: 'text-zinc-400 dark:text-zinc-400', bgColor: 'bg-zinc-100 dark:bg-zinc-500/10' },
  invoice_paid: { icon: DollarSign, label: 'Invoice Paid', color: 'text-[#1ED4A7] dark:text-[#1ED4A7]', bgColor: 'bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10' },
};

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function PipelineActivityFeed({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { formatAmount } = useCurrency();
  const [log, setLog] = useState<TriggerLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/triggers/log`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLog(Array.isArray(data.log) ? data.log : []);
      }
    } catch (err) {
      console.error('[ACTIVITY] Failed to fetch trigger log:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchLog();
  }, [open, fetchLog]);

  if (!open) return null;

  const filtered = filter ? log.filter(e => e.event_type === filter) : log;

  // Group by date
  const grouped: Array<{ date: string; entries: Array<TriggerLogEntry & { index: number }> }> = [];
  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const dateStr = new Date(entry.triggered_at).toDateString();
    const last = grouped[grouped.length - 1];
    if (last && last.date === dateStr) {
      last.entries.push({ ...entry, index: i });
    } else {
      grouped.push({ date: dateStr, entries: [{ ...entry, index: i }] });
    }
  }

  const eventTypes = [...new Set(log.map(e => e.event_type))];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white dark:bg-zinc-900 sm:border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right-full duration-300">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Zap className="w-4 h-4 text-[#1ED4A7]" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-zinc-900 dark:text-white">Activity Feed</h2>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{log.length} trigger event{log.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchLog}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-400 dark:text-zinc-300"
              title="Close"
              aria-label="Close"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        {eventTypes.length > 1 && (
          <div className="px-5 py-2.5 border-b border-zinc-100 dark:border-zinc-800/60 flex items-center gap-1.5 overflow-x-auto shrink-0">
            <Filter className="w-3 h-3 text-zinc-400 shrink-0" />
            <button
              onClick={() => setFilter(null)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors ${
                !filter
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              All
            </button>
            {eventTypes.map(et => {
              const config = EVENT_CONFIG[et];
              return (
                <button
                  key={et}
                  onClick={() => setFilter(filter === et ? null : et)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors ${
                    filter === et
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {config?.label || et.replace(/_/g, ' ')}
                </button>
              );
            })}
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading && log.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
              <p className="text-[12px] text-zinc-400">Loading activity...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 px-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-2">
                <Zap className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
              </div>
              <p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">No trigger activity yet</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 max-w-[260px]">
                When emails are sent, replies detected, meetings booked, or invoices paid, automatic stage progressions will appear here.
              </p>
            </div>
          ) : (
            <div className="py-2">
              {grouped.map((group, gi) => (
                <div key={gi}>
                  {/* Date header */}
                  <div className="sticky top-0 z-10 px-5 py-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      {formatDate(group.entries[0].triggered_at)}
                    </p>
                  </div>

                  {/* Entries */}
                  <div className="px-5 space-y-0.5">
                    {group.entries.map((entry) => {
                      const config = EVENT_CONFIG[entry.event_type] || { icon: Zap, label: entry.event_type, color: 'text-zinc-500', bgColor: 'bg-zinc-100 dark:bg-zinc-800' };
                      const Icon = config.icon;
                      const isExpanded = expanded.has(entry.index);
                      const isCalendly = entry.metadata?.source === 'calendly';

                      return (
                        <button
                          key={entry.index}
                          onClick={() => {
                            const next = new Set(expanded);
                            if (isExpanded) next.delete(entry.index);
                            else next.add(entry.index);
                            setExpanded(next);
                          }}
                          className="w-full text-left group"
                        >
                          <div className="flex gap-3 py-2.5 rounded-lg px-2 -mx-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                            {/* Timeline dot */}
                            <div className="flex flex-col items-center gap-1 pt-0.5">
                              <div className={`w-7 h-7 rounded-lg ${config.bgColor} flex items-center justify-center shrink-0`}>
                                <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                              </div>
                              {gi < grouped.length - 1 || entry.index < group.entries.length - 1 ? (
                                <div className="w-px flex-1 bg-zinc-200 dark:bg-zinc-800 min-h-[8px]" />
                              ) : null}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0 pb-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-semibold text-zinc-900 dark:text-white leading-tight">
                                    {config.label}
                                    {isCalendly && (
                                      <span className="ml-1.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-500/10 text-zinc-500 dark:text-zinc-400">Calendly</span>
                                    )}
                                  </p>
                                  {entry.deal_contact && (
                                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                                      {entry.deal_contact}
                                      {entry.deal_business && (
                                        <span className="text-zinc-400 dark:text-zinc-500"> at {entry.deal_business}</span>
                                      )}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                                    {formatTime(entry.triggered_at)}
                                  </span>
                                  <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </div>

                              {/* Stage transition pill */}
                              {entry.old_stage && entry.new_stage && (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                                    {STAGE_LABELS[entry.old_stage] || entry.old_stage}
                                  </span>
                                  <ArrowRight className="w-3 h-3 text-[#1ED4A7] shrink-0" />
                                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 text-[#1ED4A7] dark:text-[#1ED4A7] font-semibold">
                                    {STAGE_LABELS[entry.new_stage] || entry.new_stage}
                                  </span>
                                </div>
                              )}

                              {/* Expanded details */}
                              {isExpanded && (
                                <div className="mt-2 space-y-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg px-3 py-2.5">
                                  {entry.email && (
                                    <div className="flex items-center gap-2">
                                      <Mail className="w-3 h-3 shrink-0 text-zinc-400" />
                                      <span className="truncate">{entry.email}</span>
                                    </div>
                                  )}
                                  {entry.deal_value && entry.deal_value > 0 && (
                                    <div className="flex items-center gap-2">
                                      <DollarSign className="w-3 h-3 shrink-0 text-zinc-400" />
                                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">{formatAmount(entry.deal_value, { showDecimals: false })}</span>
                                    </div>
                                  )}
                                  {entry.deal_business && (
                                    <div className="flex items-center gap-2">
                                      <Building2 className="w-3 h-3 shrink-0 text-zinc-400" />
                                      <span>{entry.deal_business}</span>
                                    </div>
                                  )}
                                  {isCalendly && entry.metadata?.meeting_name && (
                                    <div className="flex items-center gap-2">
                                      <Calendar className="w-3 h-3 shrink-0 text-zinc-400" />
                                      <span>{entry.metadata.meeting_name}</span>
                                    </div>
                                  )}
                                  {isCalendly && entry.metadata?.meeting_start && (
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-3 h-3 shrink-0 text-zinc-400" />
                                      <span>{new Date(entry.metadata.meeting_start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                    </div>
                                  )}
                                  {isCalendly && entry.metadata?.invitee_name && (
                                    <div className="flex items-center gap-2">
                                      <Calendar className="w-3 h-3 shrink-0 text-zinc-400" />
                                      <span>Invitee: {entry.metadata.invitee_name}</span>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 text-zinc-400 dark:text-zinc-600">
                                    <Clock className="w-3 h-3 shrink-0" />
                                    <span>{new Date(entry.triggered_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer stats */}
        {log.length > 0 && (
          <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
              <div className="flex items-center gap-3">
                {Object.entries(
                  log.reduce((acc, e) => { acc[e.event_type] = (acc[e.event_type] || 0) + 1; return acc; }, {} as Record<string, number>)
                ).map(([type, count]) => {
                  const config = EVENT_CONFIG[type];
                  const Icon = config?.icon || Zap;
                  return (
                    <span key={type} className="flex items-center gap-1">
                      <Icon className={`w-3 h-3 ${config?.color || 'text-zinc-400'}`} />
                      <span className="font-semibold tabular-nums">{count}</span>
                    </span>
                  );
                })}
              </div>
              <span>Last 200 events</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lead-specific Activity Feed (named export for LeadDetailModal) ──
export function ActivityFeed({ leadId }: { leadId: string }) {
  const { formatAmount } = useCurrency();
  const [log, setLog] = useState<TriggerLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!leadId) return;
    (async () => {
      setLoading(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_BASE}/triggers/log`, { headers });
        if (res.ok) {
          const data = await res.json();
          const all: TriggerLogEntry[] = Array.isArray(data.log) ? data.log : [];
          setLog(all.filter(e => e.lead_id === leadId || e.email));
        }
      } catch (err) {
        console.error('[ACTIVITY] Lead feed error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [leadId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (log.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-400 dark:text-zinc-600">
        <Zap className="w-6 h-6 mb-2 opacity-40" />
        <p className="text-[13px] font-medium">No activity yet</p>
        <p className="text-[11px] mt-1">Pipeline events for this lead will appear here</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {log.map((entry, i) => {
        const config = EVENT_CONFIG[entry.event_type] || { icon: Zap, label: entry.event_type, color: 'text-zinc-500', bgColor: 'bg-zinc-100 dark:bg-zinc-800' };
        const Icon = config.icon;
        return (
          <div key={i} className="flex gap-3 py-2">
            <div className={`w-7 h-7 rounded-lg ${config.bgColor} flex items-center justify-center shrink-0`}>
              <Icon className={`w-3.5 h-3.5 ${config.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-zinc-900 dark:text-white">{config.label}</p>
                <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(entry.triggered_at)}</span>
              </div>
              {entry.old_stage && entry.new_stage && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                    {STAGE_LABELS[entry.old_stage] || entry.old_stage}
                  </span>
                  <ArrowRight className="w-3 h-3 text-[#1ED4A7] shrink-0" />
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 text-[#1ED4A7] dark:text-[#1ED4A7] font-semibold">
                    {STAGE_LABELS[entry.new_stage] || entry.new_stage}
                  </span>
                </div>
              )}
              {entry.deal_value && entry.deal_value > 0 && (
                <p className="text-[11px] text-zinc-500 mt-0.5">{formatAmount(entry.deal_value, { showDecimals: false })}</p>
              )}
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                {new Date(entry.triggered_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}