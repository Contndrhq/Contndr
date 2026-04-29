/**
 * AdminEventCenter — Full event history panel for the Admin Dashboard.
 * Shows paginated, filterable list of all platform events.
 * Strictly teal + zinc design.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, ListPlus, CheckCircle, CreditCard, Send, Zap, Loader2,
  RefreshCw, ChevronDown, Trash2, Filter, Clock, ArrowUpRight,
  Users, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

type EventType =
  | 'new_signup'
  | 'waitlist_join'
  | 'waitlist_approved'
  | 'subscription_created'
  | 'subscription_cancelled'
  | 'campaign_launched'
  | 'deal_closed'
  | 'team_member_joined'
  | 'new_lead_imported'
  | 'system';

interface AdminEvent {
  id: string;
  type: EventType;
  title: string;
  message: string;
  email?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

const EVENT_CONFIG: Record<EventType, { icon: any; label: string; color: string; bg: string }> = {
  new_signup:             { icon: UserPlus,    label: 'Signup',       color: 'text-[#1ED4A7]',  bg: 'bg-[#1ED4A7]/10' },
  waitlist_join:          { icon: ListPlus,    label: 'Waitlist',     color: 'text-zinc-400',    bg: 'bg-white/[0.04]' },
  waitlist_approved:      { icon: CheckCircle, label: 'Approved',     color: 'text-[#1ED4A7]',  bg: 'bg-[#1ED4A7]/10' },
  subscription_created:   { icon: CreditCard,  label: 'Subscriber',   color: 'text-[#1ED4A7]',  bg: 'bg-[#1ED4A7]/15' },
  subscription_cancelled: { icon: AlertCircle, label: 'Cancelled',    color: 'text-zinc-400',    bg: 'bg-white/[0.04]' },
  campaign_launched:      { icon: Send,        label: 'Campaign',     color: 'text-[#1ED4A7]',  bg: 'bg-[#1ED4A7]/10' },
  deal_closed:            { icon: CreditCard,  label: 'Deal Won',     color: 'text-[#1ED4A7]',  bg: 'bg-[#1ED4A7]/15' },
  team_member_joined:     { icon: Users,       label: 'Team',         color: 'text-zinc-400',    bg: 'bg-white/[0.04]' },
  new_lead_imported:      { icon: Zap,         label: 'Lead Import',  color: 'text-zinc-400',    bg: 'bg-white/[0.04]' },
  system:                 { icon: AlertCircle, label: 'System',       color: 'text-zinc-500',    bg: 'bg-white/[0.03]' },
};

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '',                      label: 'All Events' },
  { value: 'new_signup',            label: 'Signups' },
  { value: 'waitlist_join',         label: 'Waitlist' },
  { value: 'waitlist_approved',     label: 'Approvals' },
  { value: 'subscription_created',  label: 'Subscriptions' },
  { value: 'campaign_launched',     label: 'Campaigns' },
  { value: 'deal_closed',           label: 'Deals' },
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function AdminEventCenter() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [clearing, setClearing] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const fetchEvents = useCallback(async (pageNum: number, append = false) => {
    try {
      if (!append) setLoading(true);
      else setLoadingMore(true);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const params = new URLSearchParams({ page: String(pageNum), limit: '30' });
      if (typeFilter) params.set('type', typeFilter);

      const res = await fetch(`${API_BASE}/admin-events/history?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        console.error('[ADMIN-EVENTS] History fetch failed:', res.status);
        return;
      }

      const data = await res.json();
      const fetched = data.events || [];

      if (append) {
        setEvents(prev => [...prev, ...fetched]);
      } else {
        setEvents(fetched);
      }
      setTotal(data.total || 0);
      setHasMore(data.hasMore ?? false);
      setPage(pageNum);
    } catch (err) {
      console.error('[ADMIN-EVENTS] Error loading history:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    fetchEvents(0);
  }, [fetchEvents]);

  const handleClear = async () => {
    if (!confirm('Clear all admin events? This cannot be undone.')) return;
    setClearing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch(`${API_BASE}/admin-events/clear`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setEvents([]);
        setTotal(0);
        setHasMore(false);
        toast.success(`Cleared ${data.cleared} events`);
      } else {
        toast.error('Failed to clear events');
      }
    } catch (err) {
      toast.error('Error clearing events');
    } finally {
      setClearing(false);
    }
  };

  // Count by type
  const typeCounts: Record<string, number> = {};
  events.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  });

  const activeFilterLabel = FILTER_OPTIONS.find(f => f.value === typeFilter)?.label || 'All Events';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/[0.08] rounded-lg hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors"
            >
              <Filter className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-zinc-700 dark:text-zinc-300">{activeFilterLabel}</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>

            {showFilterDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFilterDropdown(false)} />
                <div className="absolute top-full left-0 mt-1 z-50 w-48 bg-white dark:bg-[#111] border border-zinc-200 dark:border-white/[0.08] rounded-xl shadow-lg dark:shadow-2xl overflow-hidden">
                  {FILTER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setTypeFilter(opt.value); setShowFilterDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${
                        typeFilter === opt.value
                          ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <span className="text-[11px] text-zinc-500 tabular-nums">
            {total} total event{total !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchEvents(0)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/[0.08] rounded-lg hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleClear}
            disabled={clearing || events.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-500 bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/[0.08] rounded-lg hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-500/20 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Summary stat chips */}
      {!loading && events.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0">
          {Object.entries(typeCounts).map(([type, count]) => {
            const config = EVENT_CONFIG[type as EventType];
            if (!config) return null;
            const Icon = config.icon;
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                  typeFilter === type
                    ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/20 text-[#1ED4A7]'
                    : 'bg-white dark:bg-white/[0.03] border-zinc-200 dark:border-white/[0.06] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/[0.05]'
                }`}
              >
                <Icon className="w-3 h-3" />
                {config.label}
                <span className="ml-0.5 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Event List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-3">
              <Clock className="w-5 h-5 text-zinc-600" />
            </div>
            <p className="text-sm text-zinc-500 font-medium">No events yet</p>
            <p className="text-xs text-zinc-600 mt-1">Platform events will appear here in real time</p>
          </div>
        ) : (
          <div className="space-y-1">
            {events.map((event) => {
              const config = EVENT_CONFIG[event.type] || EVENT_CONFIG.system;
              const Icon = config.icon;

              return (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
                >
                  {/* Icon */}
                  <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Icon className={`w-4 h-4 ${config.color}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px] font-semibold text-zinc-900 dark:text-white leading-tight">
                        {event.title}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${config.bg} ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-snug">
                      {event.message}
                    </p>
                    {event.email && (
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-500 mt-0.5 font-mono">
                        {event.email}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="flex-shrink-0 text-right">
                    <span className="text-[11px] text-zinc-500 tabular-nums" title={formatFullDate(event.created_at)}>
                      {timeAgo(event.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center py-4">
                <button
                  onClick={() => fetchEvents(page + 1, true)}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-500 bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.06] rounded-lg hover:bg-zinc-50 dark:hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
