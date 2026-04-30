import { useState, useEffect, useRef, useMemo } from 'react';
import { CheckCircle, XCircle, Loader2, Send, ArrowRight, Sparkles, Clock, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

// ── Types ──
export interface SendingLogEntry {
  id: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  fromEmail: string;
  status: 'composing' | 'writing' | 'sending' | 'delivered' | 'failed' | 'bounced';
  timestamp: number;
}

interface SendingLiveViewProps {
  log: SendingLogEntry[];
  currentEntry: SendingLogEntry | null;
  progress: number;
  total: number;
  successCount: number;
  errorCount: number;
  bounceCount?: number;
  statusText?: string;
  /** When true, hides internal top bar, progress bar, and bottom bar (parent provides those) */
  embedded?: boolean;
}

// ── Streaming text hook — fast typing with natural rhythm ──
function useStreamText(text: string, baseSpeed: number = 8, enabled: boolean = true) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !text) {
      setDisplayed('');
      setDone(false);
      return;
    }
    setDisplayed('');
    setDone(false);
    let i = 0;
    let lastTime = 0;

    const step = (timestamp: number) => {
      if (!lastTime) lastTime = timestamp;
      const elapsed = timestamp - lastTime;

      const char = text[i] || '';
      const charSpeed =
        char === ' ' ? baseSpeed * 0.25
        : char === '\n' ? baseSpeed * 3
        : char === '.' || char === ',' || char === '!' || char === '?' ? baseSpeed * 2
        : baseSpeed;

      if (elapsed >= charSpeed) {
        const charsPerFrame = Math.max(1, Math.floor(elapsed / charSpeed));
        i = Math.min(i + charsPerFrame, text.length);
        setDisplayed(text.slice(0, i));
        lastTime = timestamp;

        if (i >= text.length) {
          setDone(true);
          return;
        }
      }
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [text, baseSpeed, enabled]);

  return { displayed, done };
}

// ── Blinking cursor ──
function Cursor() {
  return (
    <span
      className="inline-block w-[2px] h-[1em] ml-[1px] align-middle rounded-full bg-zinc-900 dark:bg-white"
      style={{ animation: 'cursorBlink 0.8s steps(2) infinite' }}
    />
  );
}

// ── Live email composition — the main show ──
function LiveEmailComposer({ entry }: { entry: SendingLogEntry }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasContent = !!entry.subject && !!entry.body;
  const canType = (entry.status === 'writing' || entry.status === 'sending' || entry.status === 'delivered') && hasContent;

  const { displayed: subjectText, done: subjectDone } = useStreamText(
    entry.subject || '', 12, canType
  );

  const { displayed: bodyText, done: bodyDone } = useStreamText(
    entry.body || '', 5, subjectDone
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [bodyText]);

  const isDelivered = entry.status === 'delivered';
  const isSending = entry.status === 'sending';

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-fade-in">
      {/* Email chrome — To / From / Subject */}
      <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800/60 px-3 sm:px-5 py-3 space-y-2.5">
        {/* To */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest w-10 sm:w-12 flex-shrink-0">To</span>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/70 rounded-md px-2 py-1 min-w-0">
              <div className="w-4 h-4 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                <span className="text-[8px] font-bold text-zinc-600 dark:text-white/80">
                  {(entry.recipientName || '?')[0]?.toUpperCase()}
                </span>
              </div>
              <span className="text-xs text-zinc-800 dark:text-zinc-200 font-medium truncate">{entry.recipientName}</span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate hidden sm:inline">&lt;{entry.recipientEmail}&gt;</span>
            </div>
          </div>
        </div>

        {/* Mobile-only email line */}
        <div className="flex items-center gap-2 sm:hidden">
          <span className="w-10 flex-shrink-0" />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate">{entry.recipientEmail}</span>
        </div>

        {/* From */}
        {entry.fromEmail && (
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest w-10 sm:w-12 flex-shrink-0">From</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono truncate">{entry.fromEmail}</span>
          </div>
        )}

        {/* Subject */}
        <div className="flex items-start gap-2 sm:gap-3">
          <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest w-10 sm:w-12 flex-shrink-0 pt-0.5">Subj</span>
          <div className="flex-1 min-w-0">
            {!hasContent ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 text-zinc-400 animate-spin flex-shrink-0" />
                <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">Generating personalized content...</span>
              </div>
            ) : (
              <span className="text-[13px] sm:text-sm text-zinc-900 dark:text-white font-medium break-words">
                {subjectText}
                {!subjectDone && <Cursor />}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Email body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 min-h-0">
        {!hasContent ? (
          <div className="flex items-center gap-3 py-8 justify-center">
            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-white/5 flex items-center justify-center animate-pulse">
              <Sparkles className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Crafting follow-up for {entry.recipientName}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">Analyzing previous conversation...</p>
            </div>
          </div>
        ) : subjectDone ? (
          <div className="text-[13px] sm:text-sm text-zinc-700 dark:text-zinc-300 leading-[1.75] whitespace-pre-wrap break-words">
            {bodyText}
            {!bodyDone && <Cursor />}
          </div>
        ) : null}

        {/* Status indicators */}
        {bodyDone && isSending && (
          <div className="mt-5 pt-3 border-t border-zinc-200 dark:border-zinc-800/40 flex items-center gap-2 animate-fade-in">
            <Send className="w-3.5 h-3.5 text-zinc-400 dark:text-white/60 animate-pulse" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Delivering...</span>
          </div>
        )}
        {bodyDone && isDelivered && (
          <div className="mt-5 pt-3 border-t border-zinc-200 dark:border-zinc-800/40 flex items-center gap-2 animate-fade-in">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Message delivered</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Compact completed row ──
function CompletedRow({ entry, isLast }: { entry: SendingLogEntry; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isSent = entry.status === 'delivered';
  const isBounced = entry.status === 'bounced';

  return (
    <div className={!isLast ? 'border-b border-zinc-100 dark:border-zinc-800/20' : ''}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-colors text-left"
      >
        <div className="flex-shrink-0">
          {isSent ? (
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400/80" />
          ) : isBounced ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400/80" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400/80" />
          )}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 sm:gap-2">
          <span className={`text-xs font-medium truncate ${isSent ? 'text-zinc-600 dark:text-zinc-400' : isBounced ? 'text-amber-600 dark:text-amber-400/70' : 'text-red-500 dark:text-red-400/70'}`}>
            {entry.recipientName}
          </span>
          <ArrowRight className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
          <span className="text-[11px] text-zinc-400 dark:text-zinc-600 font-mono truncate hidden sm:inline">
            {entry.recipientEmail}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            isSent ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-400/10' : isBounced ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-400/10' : 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-400/10'
          }`}>
            {isSent ? 'Sent' : isBounced ? 'Bounced' : 'Failed'}
          </span>
          {entry.body && (
            expanded
              ? <ChevronUp className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />
              : <ChevronDown className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />
          )}
        </div>
      </button>

      {expanded && entry.body && (
        <div className="px-3 sm:px-4 pb-3 animate-fade-in">
          <div className="ml-5 sm:ml-6 bg-zinc-50 dark:bg-zinc-900/60 rounded-lg p-3 border border-zinc-100 dark:border-zinc-800/40">
            <p className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-semibold mb-1.5">{entry.subject}</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap line-clamp-8">{entry.body}</p>
          </div>
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════
export function SendingLiveView({
  log,
  currentEntry,
  progress,
  total,
  successCount,
  errorCount,
  bounceCount,
  statusText,
  embedded,
}: SendingLiveViewProps) {
  const logScrollRef = useRef<HTMLDivElement>(null);
  const completedEntries = useMemo(
    () => log.filter(e => e.status === 'delivered' || e.status === 'failed' || e.status === 'bounced'),
    [log]
  );
  const bounceCountComputed = bounceCount ?? completedEntries.filter(e => e.status === 'bounced').length;
  const progressPct = total > 0 ? (progress / total) * 100 : 0;
  const isDone = progress >= total && total > 0 && !currentEntry;
  const hasServerProgress = progress > 0 || successCount > 0 || errorCount > 0 || bounceCountComputed > 0;

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [completedEntries.length]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0a0a0a] text-zinc-900 dark:text-white">
      <style>{`@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      {/* ── Top bar ── */}
      {!embedded && (
        <div className="flex-shrink-0 flex items-center justify-between px-3 sm:px-4 py-2.5 bg-zinc-50 dark:bg-[#0f0f0f] border-b border-zinc-200 dark:border-zinc-800/80">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!isDone ? (
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-900 dark:bg-white animate-pulse flex-shrink-0" />
            ) : (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
            )}
            <span className="text-xs sm:text-[13px] font-semibold text-zinc-900 dark:text-white truncate">
              {isDone ? 'Sending complete' : 'Sending in progress'}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 text-[11px] flex-shrink-0">
            <span className="text-zinc-400 dark:text-zinc-500 tabular-nums">
              <span className="text-zinc-900 dark:text-white font-bold">{progress}</span>
              <span className="mx-0.5 text-zinc-300 dark:text-zinc-600">/</span>
              <span className="text-zinc-400 dark:text-zinc-500">{total}</span>
            </span>
            {successCount > 0 && (
              <span className="text-emerald-500 dark:text-emerald-400/80 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                <span className="hidden sm:inline">{successCount}</span>
              </span>
            )}
            {bounceCountComputed > 0 && (
              <span className="text-amber-500 dark:text-amber-400/80 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span className="hidden sm:inline">{bounceCountComputed}</span>
              </span>
            )}
            {errorCount > 0 && (
              <span className="text-red-500 dark:text-red-400/80 flex items-center gap-1">
                <XCircle className="w-3 h-3" />
                <span className="hidden sm:inline">{errorCount}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Progress bar ── */}
      {!embedded && (
        <div className="flex-shrink-0 relative h-[2px] bg-zinc-100 dark:bg-zinc-900">
          <div
            className="absolute inset-y-0 left-0 rounded-r-full transition-all duration-700 ease-out bg-zinc-900 dark:bg-white"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Active email being composed */}
        {currentEntry && (
          <div className="flex flex-col min-h-0 flex-1 border-b border-zinc-200 dark:border-zinc-800/50">
            <LiveEmailComposer entry={currentEntry} />
          </div>
        )}

        {/* Completed log */}
        {completedEntries.length > 0 && (
          <div
            className="flex flex-col min-h-0"
            style={{
              flexShrink: currentEntry ? 1 : 0,
              maxHeight: currentEntry ? '30vh' : undefined,
              flex: currentEntry ? undefined : '1 1 auto',
            }}
          >
            <div className="flex-shrink-0 px-3 sm:px-4 py-2 bg-zinc-50 dark:bg-[#0c0c0c] border-b border-zinc-100 dark:border-zinc-800/30">
              <span className="text-[10px] uppercase tracking-widest font-semibold text-zinc-400 dark:text-zinc-600">
                Sent ({completedEntries.filter(e => e.status === 'delivered').length})
                {completedEntries.filter(e => e.status === 'bounced').length > 0 && (
                  <span className="ml-2 text-amber-500 dark:text-amber-400/80">
                    Bounced ({completedEntries.filter(e => e.status === 'bounced').length})
                  </span>
                )}
                {completedEntries.filter(e => e.status === 'failed').length > 0 && (
                  <span className="ml-2 text-red-500 dark:text-red-400/80">
                    Failed ({completedEntries.filter(e => e.status === 'failed').length})
                  </span>
                )}
              </span>
            </div>
            <div ref={logScrollRef} className="flex-1 overflow-y-auto">
              {completedEntries.map((entry, idx) => (
                <CompletedRow key={entry.id} entry={entry} isLast={idx === completedEntries.length - 1} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!currentEntry && completedEntries.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            {hasServerProgress || isDone ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 text-center">
                <CheckCircle className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  {isDone ? 'Campaign sent' : 'Sending in background'}
                </div>
                <div className="text-xs text-zinc-400 dark:text-zinc-500">
                  {successCount > 0
                    ? `${successCount} delivered${total > successCount ? ` of ${total}` : ''}`
                    : statusText || 'Waiting for delivery updates...'}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 text-zinc-400 dark:text-zinc-500 animate-spin" />
                <span className="text-sm text-zinc-400 dark:text-zinc-500">{statusText || 'Preparing messages...'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      {!embedded && (
        <div className="flex-shrink-0 flex items-center justify-between px-3 sm:px-4 py-2 bg-zinc-50 dark:bg-[#0c0c0c] border-t border-zinc-200 dark:border-zinc-800/60">
          <div className="flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-600">
            <Clock className="w-3 h-3 flex-shrink-0" />
            <span className="tabular-nums">
              {isDone ? 'All messages processed' : `~${Math.max(0, total - progress)} remaining`}
            </span>
          </div>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-600 tabular-nums">{Math.round(progressPct)}%</span>
        </div>
      )}
    </div>
  );
}
