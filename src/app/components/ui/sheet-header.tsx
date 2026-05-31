/**
 * SheetHeader — shared sticky header for modal / sheet overlays.
 *
 * Renders one of two layouts:
 *   - Default:  [ title ......................... X ]
 *   - With back:[ ← Back ]  title  [ X ]
 *
 * On mobile (default sm:hidden breakpoint) it also renders a drag handle
 * at the very top so the sheet feels native. Pair with a parent
 * `flex flex-col max-h-[...]` and a `flex-1 overflow-y-auto` body to
 * keep the header pinned while the body scrolls.
 */

import { ChevronLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';

interface SheetHeaderProps {
  title: ReactNode;
  /** Subtitle / breadcrumb shown above the title in small uppercase text */
  eyebrow?: ReactNode;
  /** When set, renders an iOS-style left chevron that calls this handler */
  onBack?: () => void;
  /** Required close handler — renders as a right-side X */
  onClose: () => void;
  /** Hide the X (e.g. close-on-back-only flows). Default false. */
  hideClose?: boolean;
  /** Custom right-side actions (e.g. refresh button). Rendered before the X. */
  rightActions?: ReactNode;
  /** Hide the mobile drag handle (default shown on mobile only) */
  hideDragHandle?: boolean;
}

export function SheetHeader({
  title,
  eyebrow,
  onBack,
  onClose,
  hideClose,
  rightActions,
  hideDragHandle,
}: SheetHeaderProps) {
  return (
    <>
      {!hideDragHandle && (
        <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>
      )}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 flex items-center gap-0.5 p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors text-sm font-medium"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline -ml-0.5">Back</span>
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 truncate">
              {eyebrow}
            </div>
          )}
          <div className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-white truncate">
            {title}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {rightActions}
          {!hideClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default SheetHeader;
