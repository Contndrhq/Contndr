import { useState, useEffect, useCallback } from 'react';
import { X, Activity, Zap, Clock, AlertTriangle, Trash2, ChevronDown, ChevronUp, BarChart3, RefreshCw, Database } from 'lucide-react';
import { apiCache, type CacheEventLog } from '../lib/api-cache';

/**
 * Developer tools panel for monitoring apiCache performance.
 * Shows hit/miss/stale counters, active cache entries, in-flight requests,
 * and a live event log. Only rendered in development or when toggled via keyboard shortcut.
 */

const EVENT_TYPE_COLORS: Record<CacheEventLog['type'], string> = {
  hit: 'text-[#1ED4A7]',
  stale: 'text-zinc-400',
  miss: 'text-zinc-500',
  revalidate: 'text-zinc-400',
  invalidate: 'text-zinc-500',
  prefetch: 'text-zinc-400',
  error: 'text-zinc-500',
  set: 'text-gray-400',
};

const EVENT_TYPE_LABELS: Record<CacheEventLog['type'], string> = {
  hit: 'HIT',
  stale: 'STALE',
  miss: 'MISS',
  revalidate: 'REVAL',
  invalidate: 'INVAL',
  prefetch: 'PRE',
  error: 'ERR',
  set: 'SET',
};

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function CacheDevTools() {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState(() => apiCache.stats());
  const [activeSection, setActiveSection] = useState<'overview' | 'entries' | 'log'>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Subscribe to real-time cache stats changes
  useEffect(() => {
    const unsub = apiCache.onStatsChange(() => {
      if (autoRefresh) {
        setStats(apiCache.stats());
      }
    });
    return unsub;
  }, [autoRefresh]);

  // Periodic refresh for TTL countdown
  useEffect(() => {
    if (!isOpen || !autoRefresh) return;
    const interval = setInterval(() => {
      setStats(apiCache.stats());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, autoRefresh]);

  // Keyboard shortcut: Ctrl+Shift+C to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleRefresh = useCallback(() => {
    setStats(apiCache.stats());
  }, []);

  const handleReset = useCallback(() => {
    apiCache.resetCounters();
    setStats(apiCache.stats());
  }, []);

  const handleClearCache = useCallback(() => {
    apiCache.clear();
    setStats(apiCache.stats());
  }, []);

  if (!isOpen) {
    // Floating toggle button (bottom-left)
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-[9999] flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900/90 dark:bg-zinc-800/90 text-zinc-300 text-[11px] font-mono rounded-lg border border-zinc-700/50 shadow-xl backdrop-blur-sm hover:bg-zinc-800 dark:hover:bg-zinc-700 transition-all opacity-40 hover:opacity-100"
        title="Cache Dev Tools (Ctrl+Shift+C)"
      >
        <Database className="w-3 h-3" />
        <span>Cache</span>
        {stats.counters.hits + stats.counters.staleHits + stats.counters.misses > 0 && (
          <span className="text-[#1ED4A7]">{stats.hitRate}%</span>
        )}
      </button>
    );
  }

  const totalRequests = stats.counters.hits + stats.counters.staleHits + stats.counters.misses;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] w-[420px] max-h-[80vh] bg-zinc-950/95 dark:bg-zinc-900/95 text-zinc-200 rounded-xl border border-zinc-700/60 shadow-2xl backdrop-blur-md font-mono text-[12px] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-[#1ED4A7]" />
          <span className="font-semibold text-[13px] text-zinc-100">Cache Dev Tools</span>
          <span className="text-[10px] text-zinc-500 ml-1">Ctrl+Shift+C</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="Refresh stats"
          >
            <RefreshCw className="w-3 h-3 text-zinc-400" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 shrink-0">
        {(['overview', 'entries', 'log'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveSection(tab)}
            className={`flex-1 px-3 py-1.5 text-[11px] font-medium capitalize transition-colors ${
              activeSection === tab
                ? 'text-[#1ED4A7] border-b-2 border-[#1ED4A7] bg-zinc-800/40'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* ── Overview Tab ─────────────────────────────── */}
        {activeSection === 'overview' && (
          <div className="p-3 space-y-3">
            {/* Hit rate gauge */}
            <div className="text-center py-2">
              <div className="text-[32px] font-bold text-[#1ED4A7] leading-none">
                {totalRequests > 0 ? `${stats.hitRate}%` : '--'}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">Cache Hit Rate</div>
            </div>

            {/* Counter grid */}
            <div className="grid grid-cols-4 gap-1.5">
              <CounterCard label="Hits" value={stats.counters.hits} color="text-[#1ED4A7]" />
              <CounterCard label="Stale" value={stats.counters.staleHits} color="text-zinc-400" />
              <CounterCard label="Misses" value={stats.counters.misses} color="text-zinc-500" />
              <CounterCard label="Revals" value={stats.counters.revalidations} color="text-zinc-400" />
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              <CounterCard label="Prefetch" value={stats.counters.prefetches} color="text-zinc-400" />
              <CounterCard label="Invals" value={stats.counters.invalidations} color="text-zinc-500" />
              <CounterCard label="Errors" value={stats.counters.errors} color="text-zinc-500" />
              <CounterCard label="In-Flight" value={stats.inflight} color="text-zinc-400" />
            </div>

            {/* Summary stats */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
              <span className="text-zinc-500">Cached entries</span>
              <span className="text-zinc-200 font-medium">{stats.entries}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
              <span className="text-zinc-500">Total requests</span>
              <span className="text-zinc-200 font-medium">{totalRequests}</span>
            </div>
            {stats.subscribers.length > 0 && (
              <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                <span className="text-zinc-500">Active subscribers</span>
                <span className="text-zinc-200 font-medium">
                  {stats.subscribers.reduce((sum, s) => sum + s.count, 0)}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleReset}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] rounded-lg transition-colors border border-zinc-600"
              >
                <RefreshCw className="w-3 h-3" />
                Reset Counters
              </button>
              <button
                onClick={handleClearCache}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 text-[11px] rounded-lg transition-colors border border-zinc-700/30"
              >
                <Trash2 className="w-3 h-3" />
                Clear Cache
              </button>
            </div>

            {/* Auto-refresh toggle */}
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Auto-refresh</span>
              <button
                onClick={() => setAutoRefresh(prev => !prev)}
                className={`w-8 h-4 rounded-full relative transition-colors ${
                  autoRefresh ? 'bg-[#1ED4A7]' : 'bg-zinc-700'
                }`}
              >
                <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
                  autoRefresh ? 'translate-x-4.5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </div>
        )}

        {/* ── Entries Tab ──────────────────────────────── */}
        {activeSection === 'entries' && (
          <div className="p-2">
            {stats.entryDetails.length === 0 ? (
              <div className="text-center py-6 text-zinc-600">
                <Database className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p>No cache entries</p>
              </div>
            ) : (
              <div className="space-y-1">
                {stats.entryDetails.map(entry => (
                  <div
                    key={entry.key}
                    className="flex items-center gap-2 px-2 py-1.5 bg-zinc-900/40 rounded-lg border border-zinc-800/40 hover:border-zinc-700/60 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-zinc-200 truncate font-medium">{entry.key}</div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
                        <span>Age: {formatAge(entry.age)}</span>
                        <span>TTL: {formatAge(entry.ttl)}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {entry.isExpired ? (
                        <span className="px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded text-[9px] font-medium">EXPIRED</span>
                      ) : entry.isStale ? (
                        <span className="px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded text-[9px] font-medium">STALE</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-[#1ED4A7]/20 text-[#1ED4A7] rounded text-[9px] font-medium">FRESH</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Event Log Tab ────────────────────────────── */}
        {activeSection === 'log' && (
          <div className="p-2">
            {stats.eventLog.length === 0 ? (
              <div className="text-center py-6 text-zinc-600">
                <Activity className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p>No events yet</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {stats.eventLog.map((event, i) => (
                  <div
                    key={`${event.timestamp}-${i}`}
                    className="flex items-start gap-2 px-2 py-1 hover:bg-zinc-800/30 rounded transition-colors"
                  >
                    <span className="text-[10px] text-zinc-600 shrink-0 mt-px tabular-nums">
                      {formatTimestamp(event.timestamp)}
                    </span>
                    <span className={`text-[10px] font-bold shrink-0 mt-px w-8 ${EVENT_TYPE_COLORS[event.type]}`}>
                      {EVENT_TYPE_LABELS[event.type]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-zinc-300 break-all">{event.key}</span>
                      {event.detail && (
                        <div className="text-[10px] text-zinc-600 mt-0.5">{event.detail}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CacheDevTools;

function CounterCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900/50 rounded-lg border border-zinc-800/50 px-2 py-1.5 text-center">
      <div className={`text-[16px] font-bold leading-none ${color}`}>{value}</div>
      <div className="text-[9px] text-zinc-500 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}