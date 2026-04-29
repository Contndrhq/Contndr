import { useEffect, useRef, useState } from 'react';
import { useImportBroadcast, type ImportBatchLogEntry } from './ImportBroadcastContext';
import {
  X, Minimize2, Maximize2, CheckCircle, XCircle, AlertTriangle,
  Upload, Shrink, Database, Copy, Package,
} from 'lucide-react';

// ── Shared keyframes ──
const sharedStyles = `
  @keyframes ib-slideUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
  @keyframes ib-slideUpPanel { from { opacity:0; transform: translateY(24px) scale(0.96); } to { opacity:1; transform: translateY(0) scale(1); } }
  @keyframes ib-fadeInScale { from { opacity:0; transform: scale(0.95); } to { opacity:1; transform: scale(1); } }
  @keyframes ib-pulseRing { 0% { box-shadow: 0 0 0 0 rgba(63,63,70,0.4); } 70% { box-shadow: 0 0 0 6px rgba(63,63,70,0); } 100% { box-shadow: 0 0 0 0 rgba(63,63,70,0); } }
  @keyframes ib-pulse-emerald { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); } 70% { box-shadow: 0 0 0 6px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
`;

// ── Elapsed timer hook ──
function useElapsed(startTime: number | null, active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active || !startTime) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - startTime) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startTime]);
  return elapsed;
}

function formatTime(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

// ── Stat badges ──
function StatBadges({ imported, duplicates, errors }: { imported: number; duplicates: number; errors: number }) {
  return (
    <>
      {imported > 0 && (
        <span className="text-[10px] text-[#1ED4A7] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 bg-[#1ED4A7]/10 rounded">
          <CheckCircle className="w-2.5 h-2.5" />
          {imported}
        </span>
      )}
      {duplicates > 0 && (
        <span className="text-[10px] text-zinc-500 font-semibold flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-500/10 rounded">
          <Copy className="w-2.5 h-2.5" />
          {duplicates}
        </span>
      )}
      {errors > 0 && (
        <span className="text-[10px] text-zinc-400 font-semibold flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-400/10 rounded">
          <XCircle className="w-2.5 h-2.5" />
          {errors}
        </span>
      )}
    </>
  );
}

// ── Batch log item ──
function BatchLogItem({ entry }: { entry: ImportBatchLogEntry }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-xs border-b border-zinc-100 dark:border-zinc-800/50 last:border-0">
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800">
        {entry.error ? (
          <XCircle className="w-3.5 h-3.5 text-zinc-400" />
        ) : (
          <Package className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-zinc-900 dark:text-white font-medium">Batch {entry.batchIndex}</span>
        <span className="text-zinc-400 dark:text-zinc-500 ml-1.5">
          {entry.size} leads
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {entry.imported > 0 && (
          <span className="text-[#1ED4A7] font-semibold">+{entry.imported}</span>
        )}
        {entry.duplicates > 0 && (
          <span className="text-zinc-500 font-medium">{entry.duplicates} dup</span>
        )}
        {entry.error && (
          <span className="text-zinc-400 font-medium truncate max-w-[100px]" title={entry.error}>
            {entry.error}
          </span>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// 1. MINIMIZED PILL
// ══════════════════════════════════════════════════════════════════
function MinimizedPill() {
  const b = useImportBroadcast();
  const pct = b.total > 0 ? Math.round(((b.imported + b.duplicates) / b.total) * 100) : 0;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9998] animate-fade-in"
      style={{ animation: 'ib-slideUp 0.3s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <style>{sharedStyles}</style>
      <button
        onClick={() => b.setViewMode('default')}
        className="group flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer"
      >
        {/* Icon */}
        {b.done ? (
          b.failed ? (
            <AlertTriangle className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
          )
        ) : (
          <div
            className="w-2.5 h-2.5 rounded-full bg-zinc-700 dark:bg-zinc-300 flex-shrink-0"
            style={{ animation: 'ib-pulseRing 2s infinite' }}
          />
        )}

        {/* Label */}
        <div className="flex flex-col items-start min-w-0">
          <span className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate max-w-[180px]">
            {b.done
              ? (b.failed ? 'Import incomplete' : 'Import complete')
              : 'Importing leads...'}
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
            {b.imported}/{b.total} imported · {pct}%
          </span>
        </div>

        {/* Mini progress arc */}
        <div className="relative w-8 h-8 flex-shrink-0">
          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5"
              className="text-zinc-100 dark:text-zinc-800" />
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={b.done && !b.failed ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 81.68} 81.68`}
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-zinc-700 dark:text-zinc-300 tabular-nums">
            {pct}
          </span>
        </div>

        {/* Expand */}
        <Maximize2 className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors flex-shrink-0" />
      </button>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// 2. DEFAULT PANEL — floating bottom-right (420px)
// ══════════════════════════════════════════════════════════════════
function DefaultPanel() {
  const b = useImportBroadcast();
  const elapsed = useElapsed(b.startTime, b.active);
  const scrollRef = useRef<HTMLDivElement>(null);

  const done = b.imported + b.duplicates;
  const pct = b.total > 0 ? Math.min(100, Math.round((done / b.total) * 100)) : 0;
  const rate = elapsed > 0 ? done / elapsed : 0;
  const remaining = rate > 0 && !b.done ? Math.ceil((b.total - done) / rate) : 0;

  // Auto-scroll log
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [b.log.length]);

  return (
    <div
      className="fixed bottom-4 right-4 z-[9998]"
      style={{ animation: 'ib-slideUpPanel 0.35s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <style>{sharedStyles}</style>

      <div className="w-[420px] max-w-[calc(100vw-2rem)] bg-white dark:bg-[#0a0a0a] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: 'min(520px, calc(100vh - 2rem))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50 dark:bg-[#0f0f0f] border-b border-zinc-200 dark:border-zinc-800/80 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {b.done ? (
              b.failed ? (
                <AlertTriangle className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7] flex-shrink-0" />
              )
            ) : (
              <Upload className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-300 animate-pulse flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-zinc-900 dark:text-white truncate">
                {b.done
                  ? (b.failed ? 'Import incomplete' : 'Import complete')
                  : 'Importing leads'}
              </p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-600 truncate">
                {b.fileName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <StatBadges imported={b.imported} duplicates={b.duplicates} errors={b.errors} />

            <button
              onClick={() => b.setViewMode('maximized')}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors ml-1"
              title="Maximize"
            >
              <Maximize2 className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>
            <button
              onClick={() => b.setViewMode('minimized')}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="Minimize"
            >
              <Minimize2 className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>
            {b.done && (
              <button
                onClick={b.dismiss}
                className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex-shrink-0 relative h-[2px] bg-zinc-100 dark:bg-zinc-900">
          <div
            className={`absolute inset-y-0 left-0 rounded-r-full transition-all duration-700 ease-out ${b.done && !b.failed ? 'bg-[#1ED4A7]' : 'bg-zinc-900 dark:bg-white'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Content — progress ring + stats */}
        <div className="flex-shrink-0 px-5 py-5">
          <div className="flex items-center gap-5">
            {/* Circular progress */}
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" strokeWidth="4"
                  className="text-zinc-100 dark:text-zinc-800" stroke="currentColor" />
                <circle cx="40" cy="40" r="34" fill="none" strokeWidth="4"
                  className={b.done && !b.failed ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * 213.63} 213.63`}
                  style={{ transition: 'stroke-dasharray 0.6s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {b.done && !b.failed ? (
                  <CheckCircle className="w-6 h-6 text-[#1ED4A7]" />
                ) : (
                  <>
                    <span className="text-lg font-bold text-zinc-900 dark:text-white tabular-nums">{pct}%</span>
                    <span className="text-[9px] text-zinc-400 tabular-nums">{done}/{b.total}</span>
                  </>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <p className="text-lg font-bold text-zinc-900 dark:text-white tabular-nums">{b.imported.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Imported</p>
              </div>
              <div>
                <p className="text-lg font-bold text-zinc-900 dark:text-white tabular-nums">{b.total.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Total</p>
              </div>
              {b.duplicates > 0 && (
                <div>
                  <p className="text-lg font-bold text-zinc-500 tabular-nums">{b.duplicates.toLocaleString()}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Duplicates</p>
                </div>
              )}
              {b.errors > 0 && (
                <div>
                  <p className="text-lg font-bold text-zinc-400 tabular-nums">{b.errors.toLocaleString()}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Errors</p>
                </div>
              )}
            </div>
          </div>

          {/* Timing info */}
          <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
            <span>
              Batch {b.currentBatch} of {b.totalBatches}
            </span>
            <span>
              {b.done
                ? `Done in ${formatTime(elapsed)}`
                : elapsed > 2 && remaining > 0
                ? `~${formatTime(remaining)} left`
                : `${formatTime(elapsed)} elapsed`}
            </span>
          </div>
        </div>

        {/* Batch log */}
        {b.log.length > 0 && (
          <div ref={scrollRef} className="flex-1 overflow-y-auto border-t border-zinc-100 dark:border-zinc-800/50 min-h-0 max-h-[160px]">
            {b.log.map(entry => (
              <BatchLogItem key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-2.5 bg-zinc-50 dark:bg-[#0c0c0c] border-t border-zinc-200 dark:border-zinc-800/60 flex items-center justify-between">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {b.done ? b.message : 'You can keep working while this runs'}
          </p>
          {b.done && (
            <button
              onClick={b.dismiss}
              className="px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// 3. MAXIMIZED PANEL — centered overlay
// ══════════════════════════════════════════════════════════════════
function MaximizedPanel() {
  const b = useImportBroadcast();
  const elapsed = useElapsed(b.startTime, b.active);
  const scrollRef = useRef<HTMLDivElement>(null);

  const done = b.imported + b.duplicates;
  const pct = b.total > 0 ? Math.min(100, Math.round((done / b.total) * 100)) : 0;
  const rate = elapsed > 0 ? done / elapsed : 0;
  const remaining = rate > 0 && !b.done ? Math.ceil((b.total - done) / rate) : 0;

  // Escape to restore
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') b.setViewMode('default');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [b.log.length]);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 sm:p-8"
      style={{ animation: 'ib-fadeInScale 0.3s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <style>{sharedStyles}</style>

      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
        onClick={() => b.setViewMode('default')}
      />

      {/* Panel */}
      <div className="relative w-full max-w-2xl h-full max-h-[calc(100vh-4rem)] bg-white dark:bg-[#0a0a0a] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-zinc-50 dark:bg-[#0f0f0f] border-b border-zinc-200 dark:border-zinc-800/80 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {b.done ? (
              b.failed ? (
                <AlertTriangle className="w-5 h-5 text-zinc-400 flex-shrink-0" />
              ) : (
                <CheckCircle className="w-5 h-5 text-[#1ED4A7] flex-shrink-0" />
              )
            ) : (
              <Database className="w-5 h-5 text-zinc-600 dark:text-zinc-300 animate-pulse flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                {b.done
                  ? (b.failed ? 'Import incomplete' : 'Import complete')
                  : 'Importing leads'}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 truncate">
                {b.fileName} · {b.total.toLocaleString()} leads
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <StatBadges imported={b.imported} duplicates={b.duplicates} errors={b.errors} />

            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg ml-1">
              <span className="text-xs font-bold text-zinc-900 dark:text-white tabular-nums">{b.imported}</span>
              <span className="text-xs text-zinc-400">/</span>
              <span className="text-xs text-zinc-400 tabular-nums">{b.total}</span>
            </div>

            <button
              onClick={() => b.setViewMode('default')}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors ml-1"
              title="Restore"
            >
              <Shrink className="w-4 h-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>
            <button
              onClick={() => b.setViewMode('minimized')}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="Minimize"
            >
              <Minimize2 className="w-4 h-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>
            {b.done && (
              <button
                onClick={b.dismiss}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex-shrink-0 relative h-[3px] bg-zinc-100 dark:bg-zinc-900">
          <div
            className={`absolute inset-y-0 left-0 rounded-r-full transition-all duration-700 ease-out ${b.done && !b.failed ? 'bg-[#1ED4A7]' : 'bg-zinc-900 dark:bg-white'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Big progress section */}
        <div className="flex-shrink-0 px-8 py-8">
          <div className="flex items-center gap-8">
            {/* Big circular ring */}
            <div className="relative w-28 h-28 flex-shrink-0">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                <circle cx="56" cy="56" r="48" fill="none" strokeWidth="5"
                  className="text-zinc-100 dark:text-zinc-800" stroke="currentColor" />
                <circle cx="56" cy="56" r="48" fill="none" strokeWidth="5"
                  className={b.done && !b.failed ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * 301.59} 301.59`}
                  style={{ transition: 'stroke-dasharray 0.6s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {b.done && !b.failed ? (
                  <CheckCircle className="w-8 h-8 text-[#1ED4A7]" />
                ) : (
                  <>
                    <span className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums">{pct}%</span>
                    <span className="text-[10px] text-zinc-400 tabular-nums">{done}/{b.total}</span>
                  </>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums">{b.imported.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Imported</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-zinc-500 tabular-nums">{b.duplicates.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Duplicates</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-zinc-400 tabular-nums">{b.errors.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Errors</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums">{b.total.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Total</p>
              </div>
            </div>
          </div>

          {/* Timing bar */}
          <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
            <span>Batch {b.currentBatch} of {b.totalBatches}</span>
            <span>
              {b.done
                ? `Completed in ${formatTime(elapsed)}`
                : elapsed > 2 && remaining > 0
                ? `~${formatTime(remaining)} remaining`
                : `${formatTime(elapsed)} elapsed`}
            </span>
          </div>
        </div>

        {/* Batch log — scrollable */}
        <div className="flex-shrink-0 px-6 pb-1">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">Batch Log</p>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto border-t border-zinc-100 dark:border-zinc-800/50 min-h-0">
          {b.log.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-zinc-400">
              Waiting for first batch...
            </div>
          ) : (
            b.log.map(entry => (
              <BatchLogItem key={entry.id} entry={entry} />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 sm:px-6 py-3 bg-zinc-50 dark:bg-[#0c0c0c] border-t border-zinc-200 dark:border-zinc-800/60 flex items-center justify-between">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {b.done ? b.message : 'You can keep working while this runs'}
          </p>
          {b.done && (
            <button
              onClick={b.dismiss}
              className="px-4 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Main export ──
export function ImportBroadcastOverlay() {
  const b = useImportBroadcast();

  if (!b.active) return null;

  switch (b.viewMode) {
    case 'minimized':
      return <MinimizedPill />;
    case 'maximized':
      return <MaximizedPanel />;
    default:
      return <DefaultPanel />;
  }
}