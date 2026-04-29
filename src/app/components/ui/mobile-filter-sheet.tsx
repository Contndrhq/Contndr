import { X } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface MobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footerActions?: ReactNode;
  size?: 'small' | 'medium' | 'large' | 'auto';
}

/**
 * iOS-native bottom sheet for filters, forms, and actions on mobile.
 * Automatically handles safe areas, keyboard avoidance, and native gestures.
 */
export function MobileFilterSheet({
  isOpen,
  onClose,
  title,
  children,
  footerActions,
  size = 'medium',
}: MobileFilterSheetProps) {
  // Lock body scroll when sheet is open
  useEffect(() => {
    const nav = document.getElementById('mobile-nav-container');
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.classList.add('sheet-open');
      if (nav) nav.setAttribute('data-sheet-open', 'true');

      return () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.classList.remove('sheet-open');
        if (nav) nav.removeAttribute('data-sheet-open');
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClass = {
    small: 'mobile-sheet-small',
    medium: 'mobile-sheet-medium',
    large: 'mobile-sheet-large',
    auto: 'mobile-sheet-auto',
  }[size];

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-[101] bg-white dark:bg-zinc-950 rounded-t-3xl shadow-2xl animate-slide-in-up ${sizeClass} flex flex-col`}
      >
        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 min-h-0 custom-scrollbar mobile-form-container">
          {children}
        </div>

        {/* Footer Actions - Sticky */}
        {footerActions && (
          <div
            className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] flex flex-col gap-3"
          >
            {footerActions}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

/**
 * Slide-in-up animation for mobile sheets
 */
const slideInUpKeyframes = `
  @keyframes slideInUp {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  .animate-slide-in-up {
    animation: slideInUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
`;

// Inject keyframes if not already present
if (typeof document !== 'undefined') {
  const styleId = 'mobile-sheet-animations';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = slideInUpKeyframes;
    document.head.appendChild(style);
  }
}