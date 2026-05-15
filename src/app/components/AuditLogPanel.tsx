/**
 * AuditLogPanel — paginated read-only view of the audit_log table. SOC2 trail.
 */
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Loader2, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';

interface AuditEntry {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  metadata: any;
  ip: string | null;
}

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleString();
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/audit-log?limit=200`, { headers });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to load audit log');
      setEntries(j.entries || []);
      setTotal(j.total || 0);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter((e) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      e.action?.toLowerCase().includes(q) ||
      (e.actor_email || '').toLowerCase().includes(q) ||
      (e.resource_id || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Stat */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">Total events</div>
          <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{total.toLocaleString()}</div>
        </div>
        <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm sm:col-span-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3" /> SOC2 trail
          </div>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            Append-only record of every privileged admin action (plan changes, deletes, impersonation, role updates, integration changes). Last 200 shown.
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="text-sm font-medium text-zinc-900 dark:text-white">Recent admin actions</div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
        <input
          type="text"
          placeholder="Filter by action, admin email, or target ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors shadow-sm"
        />
      </div>

      {/* Entries */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-12 text-center shadow-sm">
          <ShieldCheck className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No audit events yet</p>
          <p className="text-xs text-zinc-500 mt-1">Privileged actions will appear here as they happen.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-5 py-3 text-[11px] font-medium text-zinc-500">When</th>
                <th className="px-5 py-3 text-[11px] font-medium text-zinc-500">Admin</th>
                <th className="px-5 py-3 text-[11px] font-medium text-zinc-500">Action</th>
                <th className="px-5 py-3 text-[11px] font-medium text-zinc-500">Target</th>
                <th className="px-5 py-3 text-[11px] font-medium text-zinc-500">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors">
                  <td className="px-5 py-3 text-xs text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{fmtTime(e.created_at)}</td>
                  <td className="px-5 py-3 text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">{e.actor_email || e.actor_id?.slice(0, 8) || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                      {e.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[11px] font-mono text-zinc-500 truncate max-w-[200px]">
                    {e.resource && e.resource_id ? `${e.resource}:${e.resource_id.slice(0, 12)}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-[11px] font-mono text-zinc-500">{e.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
