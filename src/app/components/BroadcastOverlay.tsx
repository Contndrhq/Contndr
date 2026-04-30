import { useEffect, useRef } from 'react';
import { useBroadcast } from './BroadcastContext';
import { SendingLiveView } from './SendingLiveView';
import { X, Minimize2, Maximize2, CheckCircle, XCircle, AlertTriangle, Radio, Shrink } from 'lucide-react';

// ── Shared keyframes ──
const sharedStyles = `
  @keyframes slideUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
  @keyframes slideUpPanel { from { opacity:0; transform: translateY(24px) scale(0.96); } to { opacity:1; transform: translateY(0) scale(1); } }
  @keyframes fadeInScale { from { opacity:0; transform: scale(0.95); } to { opacity:1; transform: scale(1); } }
  @keyframes pulseRing { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); } 70% { box-shadow: 0 0 0 6px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
`;

// ── Stat badges reusable component ──
function StatBadges({ successCount, bounceCount, errorCount }: { successCount: number; bounceCount: number; errorCount: number }) {
  return (
    <>
      {successCount > 0 && (
        <span className="text-[10px] text-[#1ED4A7] dark:text-[#1ED4A7] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 rounded">
          <CheckCircle className="w-2.5 h-2.5" />
          {successCount}
        </span>
      )}
      {bounceCount > 0 && (
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-500/10 rounded">
          <AlertTriangle className="w-2.5 h-2.5" />
          {bounceCount}
        </span>
      )}
      {errorCount > 0 && (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-500/10 rounded">
          <XCircle className="w-2.5 h-2.5" />
          {errorCount}
        </span>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 1. MINIMIZED PILL — compact progress bar at bottom-right
// ══════════════════════════════════════════════════════════════════
function MinimizedPill() {
  const b = useBroadcast();
  const pct = b.total > 0 ? Math.round((b.progress / b.total) * 100) : 0;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] animate-fade-in"
      style={{ animation: 'slideUp 0.3s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <style>{sharedStyles}</style>
      <button
        onClick={() => b.setViewMode('default')}
        className="group flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer"
      >
        {/* Pulsing dot or check */}
        {b.done ? (
          <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
        ) : (
          <div
            className="w-2.5 h-2.5 rounded-full bg-[#1ED4A7] flex-shrink-0"
            style={{ animation: 'pulseRing 2s infinite' }}
          />
        )}

        {/* Campaign name + progress */}
        <div className="flex flex-col items-start min-w-0">
          <span className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate max-w-[180px]">
            {b.done ? 'Sending complete' : b.campaignName || 'Sending...'}
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
            {b.progress}/{b.total} sent · {pct}%
          </span>
        </div>

        {/* Mini progress arc */}
        <div className="relative w-8 h-8 flex-shrink-0">
          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5"
              className="text-zinc-100 dark:text-zinc-800" />
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={b.done ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 81.68} 81.68`}
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-zinc-700 dark:text-zinc-300 tabular-nums">
            {pct}
          </span>
        </div>

        {/* Expand icon */}
        <Maximize2 className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors flex-shrink-0" />
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 2. DEFAULT PANEL — floating bottom-right window (420px)
// ══════════════════════════════════════════════════════════════════
function DefaultPanel() {
  const b = useBroadcast();
  const panelRef = useRef<HTMLDivElement>(null);
  const pct = b.total > 0 ? Math.round((b.progress / b.total) * 100) : 0;

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [b.log.length]);

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] animate-fade-in"
      style={{ animation: 'slideUpPanel 0.35s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <style>{sharedStyles}</style>

      <div className="w-[420px] max-w-[calc(100vw-2rem)] bg-white dark:bg-[#0a0a0a] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: 'min(560px, calc(100vh - 2rem))' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50 dark:bg-[#0f0f0f] border-b border-zinc-200 dark:border-zinc-800/80 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {!b.done ? (
              <Radio className="w-3.5 h-3.5 text-[#1ED4A7] animate-pulse flex-shrink-0" />
            ) : (
              <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7] flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-zinc-900 dark:text-white truncate">
                {b.done ? 'Campaign sent' : 'Broadcasting live'}
              </p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-600 truncate">
                {b.campaignName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Stats badges */}
            <StatBadges successCount={b.successCount} bounceCount={b.bounceCount} errorCount={b.errorCount} />

            {/* Maximize */}
            <button
              onClick={() => b.setViewMode('maximized')}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors ml-1"
              title="Maximize"
            >
              <Maximize2 className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>

            {/* Minimize */}
            <button
              onClick={() => b.setViewMode('minimized')}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="Minimize"
            >
              <Minimize2 className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>

            <button
              onClick={b.dismiss}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title={b.done ? 'Close' : 'Hide broadcast'}
            >
              <X className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div className="flex-shrink-0 relative h-[2px] bg-zinc-100 dark:bg-zinc-900">
          <div
            className="absolute inset-y-0 left-0 rounded-r-full transition-all duration-700 ease-out bg-zinc-900 dark:bg-white"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* ── SendingLiveView (embedded — no internal chrome) ── */}
        <div className="flex-1 overflow-hidden min-h-0">
          <SendingLiveView
            log={b.log}
            currentEntry={b.currentEntry}
            progress={b.progress}
            total={b.total}
            successCount={b.successCount}
            errorCount={b.errorCount}
            bounceCount={b.bounceCount}
            embedded
            statusText={b.statusText}
          />
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-5 sm:px-6 py-3 bg-zinc-50 dark:bg-[#0c0c0c] border-t border-zinc-200 dark:border-zinc-800/60 flex items-center justify-between">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            {b.done
              ? `${b.successCount} delivered${b.bounceCount > 0 ? ` · ${b.bounceCount} bounced` : ''}${b.errorCount > 0 ? ` · ${b.errorCount} failed` : ''}`
              : `${b.progress}/${b.total} · ~${Math.max(0, b.total - b.progress)} remaining`
            }
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

// ══════════════════════════════════════════════════════════════════
// 3. MAXIMIZED PANEL — centered near-full-screen overlay
// ══════════════════════════════════════════════════════════════════
function MaximizedPanel() {
  const b = useBroadcast();
  const pct = b.total > 0 ? Math.round((b.progress / b.total) * 100) : 0;

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        b.setViewMode('default');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8"
      style={{ animation: 'fadeInScale 0.3s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <style>{sharedStyles}</style>

      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
        onClick={() => b.setViewMode('default')}
      />

      {/* Panel */}
      <div className="relative w-full max-w-4xl h-full max-h-[calc(100vh-4rem)] bg-white dark:bg-[#0a0a0a] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 bg-zinc-50 dark:bg-[#0f0f0f] border-b border-zinc-200 dark:border-zinc-800/80 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {!b.done ? (
              <div className="relative flex-shrink-0">
                <Radio className="w-5 h-5 text-[#1ED4A7] animate-pulse" />
              </div>
            ) : (
              <CheckCircle className="w-5 h-5 text-[#1ED4A7] flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                {b.done ? 'Campaign sent' : 'Broadcasting live'}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 truncate">
                {b.campaignName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Stats badges — larger in maximized */}
            <StatBadges successCount={b.successCount} bounceCount={b.bounceCount} errorCount={b.errorCount} />

            {/* Progress counter */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg ml-1">
              <span className="text-xs font-bold text-zinc-900 dark:text-white tabular-nums">{b.progress}</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-600">/</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">{b.total}</span>
            </div>

            {/* Restore to default */}
            <button
              onClick={() => b.setViewMode('default')}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors ml-1"
              title="Restore to floating panel"
            >
              <Shrink className="w-4 h-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>

            {/* Minimize to pill */}
            <button
              onClick={() => b.setViewMode('minimized')}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="Minimize"
            >
              <Minimize2 className="w-4 h-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>

            <button
              onClick={b.dismiss}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title={b.done ? 'Close' : 'Hide broadcast'}
            >
              <X className="w-4 h-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" />
            </button>
          </div>
        </div>

        {/* ── Progress bar (thicker in maximized) ── */}
        <div className="flex-shrink-0 relative h-[3px] bg-zinc-100 dark:bg-zinc-900">
          <div
            className="absolute inset-y-0 left-0 rounded-r-full transition-all duration-700 ease-out bg-zinc-900 dark:bg-white"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* ── SendingLiveView (embedded — no internal chrome) ── */}
        <div className="flex-1 overflow-hidden min-h-0">
          <SendingLiveView
            log={b.log}
            currentEntry={b.currentEntry}
            progress={b.progress}
            total={b.total}
            successCount={b.successCount}
            errorCount={b.errorCount}
            bounceCount={b.bounceCount}
            embedded
            statusText={b.statusText}
          />
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-5 sm:px-6 py-3 bg-zinc-50 dark:bg-[#0c0c0c] border-t border-zinc-200 dark:border-zinc-800/60 flex items-center justify-between">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            {b.done
              ? `${b.successCount} delivered${b.bounceCount > 0 ? ` · ${b.bounceCount} bounced` : ''}${b.errorCount > 0 ? ` · ${b.errorCount} failed` : ''}`
              : `${b.progress}/${b.total} · ~${Math.max(0, b.total - b.progress)} remaining`
            }
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

// ── Main export
export function BroadcastOverlay() {
  const b = useBroadcast();

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
