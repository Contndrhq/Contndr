import { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Play, Clock, AlertTriangle,
  CheckCircle2, XCircle, Loader2, Timer, Hash, Server,
  Trash2, Database, HardDrive,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';

interface CronHeartbeat {
  status: string;
  lastCompletedAt?: string;
  startedAt?: string;
  lastBeat?: string;
  duration?: number;
  followUpsSent?: number;
  campaignsResumed?: number;
  campaignEmailsSent?: number;
  notificationsSent?: number;
  errors?: number;
}

interface HealthResponse {
  healthy: boolean;
  reason: string;
  heartbeat: CronHeartbeat | null;
  ageMinutes: number;
}

const POLL_INTERVAL = 60_000; // 60 s

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function CronHealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const fetchHealth = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    try {
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/cron/health`,
        { headers: { Authorization: `Bearer ${publicAnonKey}` } },
      );
      if (res.ok) {
        const data: HealthResponse = await res.json();
        setHealth(data);
      } else {
        setHealth({ healthy: false, reason: `HTTP ${res.status}`, heartbeat: null, ageMinutes: -1 });
      }
    } catch {
      setHealth({ healthy: false, reason: 'Network error — could not reach server', heartbeat: null, ageMinutes: -1 });
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth(true);
    const id = setInterval(() => fetchHealth(true), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchHealth]);

  async function triggerCron() {
    setTriggering(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/cron/trigger`,
        { method: 'POST', headers },
      );
      if (res.ok) {
        toast.success('Cron cycle triggered', { description: 'Refreshing status in a moment\u2026' });
        // Wait a few seconds, then re-fetch
        setTimeout(() => fetchHealth(false), 4000);
      } else {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        toast.error('Trigger failed', { description: err.error || `HTTP ${res.status}` });
      }
    } catch {
      toast.error('Trigger failed', { description: 'Network error' });
    } finally {
      setTriggering(false);
    }
  }

  // Derive visual state
  const hb = health?.heartbeat;
  const statusKey: 'healthy' | 'running' | 'stale' | 'unknown' =
    !health || !hb ? 'unknown'
    : hb.status === 'running' ? 'running'
    : health.healthy ? 'healthy'
    : 'stale';

  const palette = {
    healthy: { dot: 'bg-[#1ED4A7]', ring: 'ring-[#1ED4A7]/20', label: 'Healthy', icon: CheckCircle2, iconColor: 'text-[#1ED4A7]' },
    running: { dot: 'bg-amber-400',  ring: 'ring-amber-400/20',  label: 'Running', icon: Loader2,      iconColor: 'text-amber-400'  },
    stale:   { dot: 'bg-red-400',    ring: 'ring-red-400/20',    label: 'Stale',   icon: AlertTriangle, iconColor: 'text-red-400'    },
    unknown: { dot: 'bg-zinc-500',   ring: 'ring-zinc-500/20',   label: 'Unknown', icon: XCircle,       iconColor: 'text-zinc-500'   },
  }[statusKey];

  const lastTime = hb?.lastCompletedAt || hb?.startedAt || hb?.lastBeat;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      {/* ── Status card ──────────────────────────────────────────── */}
      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm dark:shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left: indicator */}
          <div className="flex items-center gap-3.5">
            <div className={`relative flex items-center justify-center w-10 h-10 rounded-full ${palette.ring} ring-4`}>
              <div className={`w-3.5 h-3.5 rounded-full ${palette.dot} ${statusKey === 'running' ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{palette.label}</h3>
                <palette.icon className={`w-3.5 h-3.5 ${palette.iconColor} ${statusKey === 'running' ? 'animate-spin' : ''}`} />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5 max-w-md">
                {health?.reason || 'Loading\u2026'}
              </p>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchHealth(false)}
              disabled={checking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
              Check Now
            </button>
            <button
              onClick={triggerCron}
              disabled={triggering || statusKey === 'running'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 border border-zinc-900 dark:border-white text-white dark:text-zinc-900 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {triggering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {triggering ? 'Triggering\u2026' : 'Trigger Cycle'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Metric cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Last Beat',
            value: lastTime ? relativeTime(lastTime) : '\u2014',
            sub: lastTime ? new Date(lastTime).toLocaleString() : '',
            icon: Clock,
          },
          {
            label: 'Duration',
            value: hb?.duration != null ? formatDuration(hb.duration) : '\u2014',
            sub: hb?.duration != null ? `${hb.duration.toLocaleString()}ms` : '',
            icon: Timer,
          },
          {
            label: 'Follow-ups',
            value: hb?.followUpsSent != null ? String(hb.followUpsSent) : '\u2014',
            sub: 'Sent in last cycle',
            icon: Activity,
          },
          {
            label: 'Errors',
            value: hb?.errors != null ? String(hb.errors) : '\u2014',
            sub: (hb?.errors ?? 0) > 0 ? 'Check server logs' : 'None',
            icon: (hb?.errors ?? 0) > 0 ? AlertTriangle : Hash,
            accent: (hb?.errors ?? 0) > 0,
          },
        ].map((card) => (
          <div key={card.label} className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-sm dark:shadow-none">
            <div className="flex items-center gap-2 mb-2">
              <card.icon className={`w-3.5 h-3.5 ${card.accent ? 'text-red-400' : 'text-zinc-400 dark:text-zinc-500'}`} />
              <span className="text-[10px] text-zinc-500 dark:text-zinc-500 font-medium uppercase tracking-wider">{card.label}</span>
            </div>
            <p className={`text-lg font-bold ${card.accent ? 'text-red-400' : 'text-zinc-900 dark:text-white'}`}>{card.value}</p>
            {card.sub && <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Raw heartbeat JSON (collapsible) ─────────────────────── */}
      <details className="group bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm dark:shadow-none">
        <summary className="flex items-center gap-2 px-5 py-3 cursor-pointer text-xs font-medium text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors select-none">
          <Server className="w-3.5 h-3.5" />
          Raw Heartbeat Payload
          <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-600 group-open:hidden">Show</span>
          <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-600 hidden group-open:inline">Hide</span>
        </summary>
        <div className="px-5 pb-4">
          <pre className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-3 overflow-x-auto font-mono">
            {hb ? JSON.stringify(hb, null, 2) : 'No heartbeat data'}
          </pre>
        </div>
      </details>

      {/* ── Database GC ──────────────────────────────────────────── */}
      <KvGarbageCollection />

      {/* ── Info footer ──────────────────────────────────────────── */}
      <p className="text-[10px] text-zinc-600 text-center">
        Auto-refreshes every 60 s &middot; Cron runs every 3 h &middot; Stale threshold: 4 h
      </p>
    </div>
  );
}

// ─── KV Garbage Collection Panel ────────────────────────────────────

function KvGarbageCollection() {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/admin/kv-stats`, { headers });
      const data = await res.json();
      // Backend returns { success, stats }; older versions returned counts.
      const payload = data.stats || data.counts;
      if (res.ok && payload) setStats(payload);
      else toast.error(data.error || 'Failed to load stats');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingStats(false);
    }
  };

  const runGC = async () => {
    if (!confirm('This will delete all lead pool cache (dp:*, dpx:*), admin events, click tracking, and email tracking data. App data (users, leads, campaigns, teams) will NOT be affected. Continue?')) return;
    setRunning(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/admin/kv-gc`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (res.ok) {
        setLastResult(data);
        toast.success(`GC complete: ${data.total_deleted} keys freed`);
        // Refresh stats
        fetchStats();
      } else {
        toast.error(data.error || 'GC failed');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Database Memory</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStats}
            disabled={loadingStats}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-300 transition-colors disabled:opacity-50"
          >
            <HardDrive className={`w-3 h-3 ${loadingStats ? 'animate-pulse' : ''}`} />
            {loadingStats ? 'Loading...' : 'Check Usage'}
          </button>
          <button
            onClick={runGC}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-semibold text-red-400 transition-colors disabled:opacity-50"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            {running ? 'Running GC...' : 'Run GC'}
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
          {Object.entries(stats).map(([prefix, count]) => (
            <div
              key={prefix}
              className={`rounded-lg px-3 py-2 border ${
                prefix === 'TOTAL'
                  ? 'border-[#1ED4A7]/20 bg-[#1ED4A7]/5'
                  : count > 1000
                    ? 'border-red-500/20 bg-red-500/5'
                    : count > 100
                      ? 'border-amber-500/20 bg-amber-500/5'
                      : 'border-white/5 bg-zinc-900/50'
              }`}
            >
              <p className="text-[10px] text-zinc-500 font-mono truncate">{prefix}</p>
              <p className={`text-sm font-bold tabular-nums ${
                prefix === 'TOTAL' ? 'text-[#1ED4A7]' :
                count > 1000 ? 'text-red-400' :
                count > 100 ? 'text-amber-400' : 'text-white'
              }`}>
                {count === -1 ? 'Error' : count.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {lastResult && (
        <div className="rounded-lg bg-zinc-900/50 border border-white/5 p-3 text-xs text-zinc-400">
          <p className="text-[#1ED4A7] font-semibold mb-1">Last GC Result: {lastResult.total_deleted} keys freed</p>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
            <span>dpx: indices: <b className="text-white">{lastResult.dpx_deleted}</b></span>
            <span>dp: pool: <b className="text-white">{lastResult.dp_deleted}</b></span>
            <span>admin events: <b className="text-white">{lastResult.admin_events_deleted}</b></span>
            <span>click tracking: <b className="text-white">{lastResult.click_track_deleted}</b></span>
            <span>email tracking: <b className="text-white">{lastResult.email_track_deleted}</b></span>
            <span>misc caches: <b className="text-white">{lastResult.misc_deleted}</b></span>
          </div>
          {lastResult.errors?.length > 0 && (
            <p className="text-red-400 mt-1">Errors: {lastResult.errors.join(', ')}</p>
          )}
        </div>
      )}

      <p className="text-[10px] text-zinc-600 mt-2">
        GC deletes cache/index data only (dp:*, dpx:*, click_track:*, email_track:*, admin_event:*). User data, leads, campaigns, and teams are never touched.
      </p>
    </div>
  );
}