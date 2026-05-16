/**
 * ConfirmDialog — webview-safe replacement for window.confirm().
 *
 * Native confirm() can be blocked, return null, or render off-screen in
 * iOS WKWebViews (Capacitor) and some embedded browsers. This provides a
 * promise-based custom confirm that always works, with an in-app modal
 * matching the design system.
 *
 * Usage:
 *   import { useConfirm } from './ConfirmDialog';
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: 'Delete user?',
 *     message: 'This cannot be undone.',
 *     confirmLabel: 'Delete',
 *     destructive: true,
 *   });
 *   if (!ok) return;
 *
 * For drop-in replacement of window.confirm at the call site, use
 * confirmAsync() directly — same return shape, no hook needed:
 *   import { confirmAsync } from './ConfirmDialog';
 *   if (!(await confirmAsync('Delete user?'))) return;
 */
import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<((opts: ConfirmOptions | string) => Promise<boolean>) | null>(null);

let externalAsk: ((opts: ConfirmOptions | string) => Promise<boolean>) | null = null;

/** Use anywhere outside React (or as a window.confirm drop-in). */
export async function confirmAsync(opts: ConfirmOptions | string): Promise<boolean> {
  if (externalAsk) return externalAsk(opts);
  // Fallback to native if the provider hasn't mounted yet
  const message = typeof opts === 'string' ? opts : (opts.message ? `${opts.title}\n\n${opts.message}` : opts.title);
  try { return window.confirm(message); } catch { return false; }
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return ctx || (async (opts: ConfirmOptions | string) => confirmAsync(opts));
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const ask = useCallback((opts: ConfirmOptions | string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const normalized: ConfirmOptions = typeof opts === 'string' ? { title: opts } : opts;
      setState({ ...normalized, resolve });
    });
  }, []);

  useEffect(() => {
    externalAsk = ask;
    return () => { externalAsk = null; };
  }, [ask]);

  // Esc to cancel
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { state.resolve(false); setState(null); }
      if (e.key === 'Enter') { state.resolve(true); setState(null); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={() => { state.resolve(false); setState(null); }}
          data-no-mobile-fix
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-black rounded-t-2xl sm:rounded-2xl border-t sm:border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-md p-5 sm:p-6 pb-[max(env(safe-area-inset-bottom),24px)] animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
          >
            <div className="flex items-start gap-3 mb-4">
              {state.destructive && (
                <div className="w-9 h-9 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{state.title}</h3>
                {state.message && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 whitespace-pre-wrap">{state.message}</p>
                )}
              </div>
              <button
                onClick={() => { state.resolve(false); setState(null); }}
                className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white p-1 -mr-1 -mt-1 flex-shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
              <button
                onClick={() => { state.resolve(false); setState(null); }}
                className="px-4 py-2.5 sm:py-2 rounded-md bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-medium transition-colors"
              >
                {state.cancelLabel || 'Cancel'}
              </button>
              <button
                onClick={() => { state.resolve(true); setState(null); }}
                autoFocus
                className={`px-4 py-2.5 sm:py-2 rounded-md text-sm font-medium transition-colors ${
                  state.destructive
                    ? 'bg-rose-500 hover:bg-rose-600 text-white'
                    : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90'
                }`}
              >
                {state.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
