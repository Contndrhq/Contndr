import React, { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './utils';

interface MobileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'small' | 'medium' | 'large' | 'auto';
  showHandle?: boolean;
}

/**
 * Mobile-optimized bottom sheet component for iOS webview.
 * Follows iOS design patterns with rounded corners, safe area support,
 * and proper touch targets.
 */
export function MobileSheet({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'auto',
  showHandle = true,
}: MobileSheetProps) {
  React.useEffect(() => {
    const nav = document.getElementById('mobile-nav-container');
    if (isOpen) {
      document.body.classList.add('sheet-open');
      if (nav) nav.setAttribute('data-sheet-open', 'true');
    } else {
      document.body.classList.remove('sheet-open');
      if (nav) nav.removeAttribute('data-sheet-open');
    }
    return () => {
      document.body.classList.remove('sheet-open');
      if (nav) nav.removeAttribute('data-sheet-open');
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    small: 'mobile-sheet-small',
    medium: 'mobile-sheet-medium',
    large: 'mobile-sheet-large',
    auto: 'mobile-sheet-auto',
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-[60] animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom Sheet */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-[70] bg-white dark:bg-[#111111] border-t border-zinc-200 dark:border-white/10',
          'rounded-t-[28px] flex flex-col overflow-hidden',
          'animate-in slide-in-from-bottom duration-300',
          sizeClasses[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle */}
        {showHandle && (
          <div className="flex-shrink-0 pt-3 pb-0 flex justify-center">
            <div className="w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full opacity-60" />
          </div>
        )}

        {/* Header */}
        {(title || description) && (
          <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-zinc-200 dark:border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {title && (
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-0.5">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {description}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="tap-target-override flex-shrink-0 -mr-1.5 -mt-1 p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 custom-scrollbar mobile-form-container">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="flex-shrink-0 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] border-t border-zinc-200 dark:border-white/10 bg-white dark:bg-[#111111]"
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Mobile-optimized form field for iOS
 */
export function MobileFormField({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

/**
 * Mobile-optimized input field
 */
export function MobileInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full px-4 py-3.5 text-base bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10',
        'rounded-xl focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all',
        'placeholder:text-zinc-400 dark:placeholder:text-zinc-500',
        'min-h-[44px]', // iOS touch target
        className
      )}
      {...props}
    />
  );
}

/**
 * Mobile-optimized textarea
 */
export function MobileTextarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full px-4 py-3.5 text-base bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10',
        'rounded-xl focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all',
        'placeholder:text-zinc-400 dark:placeholder:text-zinc-500',
        'min-h-[100px] resize-vertical',
        className
      )}
      {...props}
    />
  );
}

/**
 * Mobile-optimized chip group
 */
export function MobileChipGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {children}
    </div>
  );
}

/**
 * Mobile-optimized chip/tag button
 */
export function MobileChip({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-medium border-2 transition-all tap-target-override',
        selected
          ? 'border-[#1ED4A7] bg-[#1ED4A7]/10 text-[#1ED4A7]'
          : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20',
        className
      )}
    >
      {children}
    </button>
  );
}

/**
 * Mobile-optimized CTA button
 */
export function MobileCTA({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const variants = {
    primary: 'bg-[#1ED4A7] text-white hover:bg-[#1ED4A7]/90 active:bg-[#1ED4A7]/80',
    secondary: 'bg-zinc-100 dark:bg-white/5 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-white/10',
    ghost: 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5',
  };

  return (
    <button
      className={cn(
        'w-full px-6 py-4 min-h-[52px] rounded-[14px] text-base font-semibold',
        'flex items-center justify-center gap-2 transition-all tap-target-override',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Mobile-optimized section divider
 */
export function MobileSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6', className)}>
      {title && (
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}