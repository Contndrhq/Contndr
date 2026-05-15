/**
 * AdminCallsPanel
 * ───────────────
 * Cross-user AI call log for admins. Shows every call placed across the
 * platform with status, outcome, duration, and an expandable transcript.
 * Matches the Active Users design system: stat cards on top, list of rows
 * with neutral avatars, click-to-expand details, single "Manage" action.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Phone, RefreshCw, Loader2, ChevronDown, ChevronUp, Search,
  ExternalLink, Clock, User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface AdminCall {
  id: string;
  user_id: string;
  user_email: string;
  route: string;
  status: string;
  outcome: string | null;
  lead_name: string | null;
  business_name: string | null;
  from_number: string | null;
  to_number: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  summary: string | null;
  recording_url: string | null;
  convai_conversation_id: string | null;
}

interface AdminCallsResponse {
  success: boolean;
  calls: AdminCall[];
  stats: {
    total: number;
    completed: number;
    with_transcript: number;
    via_convai: number;
    total_minutes: number;
  };
}

function fmtDuration(s?: number | null): string {
  if (!s || s < 1) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

function statusChip(status: string, outcome?: string | null) {
  const key = (outcome || status || '').toLowerCase();
  if (key.includes('complete') || key === 'completed' || key === 'success') {
    return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
  }
  if (key.includes('voicemail') || key.includes('no_answer') || key === 'missed') {
    return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
  }
  if (key.includes('fail') || key.includes('error') || key === 'rejected') {
    return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
  }
  return 'bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800';
}

function initials(seed?: string | null) {
  const s = String(seed || '?');
  return (s.match(/[A-Za-z0-9]/g) || ['?']).slice(0, 2).join('').toUpperCase();
}

export function AdminCallsPanel({ searchTerm = '' }: { searchTerm?: string }) {
  const [data, setData] = useState<AdminCallsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState('');

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/ai-calls?limit=200`, { headers });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to load calls');
      setData(j);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load calls');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const calls = (data?.calls || []).filter((c) => {
    const q = (searchTerm || localSearch).toLowerCase().trim();
    if (!q) return true;
    return (
      (c.user_email || '').toLowerCase().includes(q) ||
      (c.lead_name || '').toLowerCase().includes(q) ||
      (c.business_name || '').toLowerCase().includes(q) ||
      (c.to_number || '').includes(q)
    );
  });

  const stats = data?.stats || { total: 0, completed: 0, with_transcript: 0, via_convai: 0, total_minutes: 0 };

  return (
    <div className="flex flex-col gap-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Calls', value: stats.total.toLocaleString() },
          { label: 'Completed', value: stats.completed.toLocaleString() },
          { label: 'Total Minutes', value: stats.total_minutes.toLocaleString() },
          { label: 'With Transcript', value: stats.with_transcript.toLocaleString() },
          { label: 'Via ElevenLabs', value: stats.via_convai.toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
              {s.label}
            </div>
            <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="text-sm font-medium text-zinc-900 dark:text-white">AI calls across all users</div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search (only if no external) */}
      {!searchTerm && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
          <input
            type="text"
            placeholder="Search by user, lead, business, or phone…"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors shadow-sm"
          />
        </div>
      )}

      {/* Calls list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading calls…
        </div>
      ) : calls.length === 0 ? (
        <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-12 text-center shadow-sm">
          <Phone className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No calls yet</p>
          <p className="text-xs text-zinc-500 mt-1">AI calls will appear here as they happen across the platform.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map((c) => {
            const isOpen = expanded === c.id;
            const av = initials(c.lead_name || c.business_name || c.user_email);
            return (
              <div
                key={c.id}
                className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  className="w-full text-left p-3 sm:p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 flex-shrink-0">
                      {av}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {c.lead_name || c.business_name || c.to_number || 'Unknown'}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusChip(c.status, c.outcome)}`}>
                          {c.outcome || c.status}
                        </span>
                        {c.route === 'elevenlabs_convai' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                            ElevenLabs
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" /> {c.user_email}</span>
                        {c.to_number && <span>· {c.to_number}</span>}
                        <span>· <Clock className="w-3 h-3 inline -mt-0.5" /> {fmtDuration(c.duration_seconds)}</span>
                        <span>· {fmtTime(c.started_at)}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {isOpen ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                    {c.summary && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider font-medium text-zinc-500 mb-1">Summary</div>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{c.summary}</p>
                      </div>
                    )}
                    {c.transcript ? (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider font-medium text-zinc-500 mb-1">Transcript</div>
                        <pre className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                          {c.transcript}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500 italic">No transcript captured for this call.</div>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                      {c.recording_url && (
                        <a
                          href={c.recording_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
                        >
                          <ExternalLink className="w-3 h-3" /> Recording
                        </a>
                      )}
                      <div className="text-[11px] text-zinc-500 font-mono ml-auto">id: {c.id}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
