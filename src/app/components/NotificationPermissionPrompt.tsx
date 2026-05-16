/**
 * NotificationPermissionPrompt — one-time banner that asks the user to
 * enable native browser notifications. Appears in the bottom-right corner
 * (above the mobile nav) on first authenticated load when permission is
 * still 'default'. Dismissible (won't show again for 30 days).
 *
 * Why this matters: toast notifications only work while the app is open
 * and in the foreground. Real browser notifications wake up the system
 * tray and pop a banner even when the tab is backgrounded — which is
 * what users actually need for important alerts (new lead replied,
 * AI call completed, payment failed, etc.).
 *
 * iOS Safari quirk: web notifications require the app to be installed
 * as a PWA (iOS 16.4+). If we're in regular Safari and the user opts
 * in, we tell them how to install. Capacitor native is handled
 * separately by the existing Capacitor Push integration.
 */
import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { notificationService } from '../lib/notifications';
import { toast } from 'sonner';

const STORAGE_KEY = 'contndr_notif_prompt_dismissed_at';
const REPROMPT_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isIosSafariNotPwa(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isStandalone = (window.matchMedia('(display-mode: standalone)').matches)
    || (navigator as any).standalone === true;
  return isIos && !isStandalone;
}

export function NotificationPermissionPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    // Respect prior dismissal
    try {
      const last = localStorage.getItem(STORAGE_KEY);
      if (last && Date.now() - Number(last) < REPROMPT_AFTER_MS) return;
    } catch {}
    // Delay so we don't slam the user the millisecond they sign in
    const t = setTimeout(() => setVisible(true), 8000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const enable = async () => {
    if (isIosSafariNotPwa()) {
      toast.info('Add Contndr to your Home Screen first', {
        description: 'iOS requires the app to be installed as a PWA before notifications can be enabled. Tap Share → Add to Home Screen.',
        duration: 8000,
      });
      dismiss();
      return;
    }
    setBusy(true);
    try {
      const granted = await notificationService.requestPermission();
      if (granted) {
        toast.success('Notifications enabled', {
          description: 'You\'ll get a system alert when leads reply, calls complete, or payments need attention.',
        });
        // Fire a test notification so they see what it looks like
        try {
          new Notification('Contndr — notifications on', {
            body: 'You\'ll hear from us when something needs you.',
            icon: '/favicon.ico',
            tag: 'contndr-welcome',
          });
        } catch {}
      } else {
        toast('Notifications blocked', {
          description: 'You can enable them later from Settings → Preferences.',
        });
      }
    } finally {
      setBusy(false);
      dismiss();
    }
  };

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
    setVisible(false);
  };

  return (
    <div
      className="fixed z-[80] bottom-[max(env(safe-area-inset-bottom),16px)] left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm"
      style={{ marginBottom: 'var(--mobile-nav-clearance, 0px)' }}
      data-no-mobile-fix
    >
      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-4 flex items-start gap-3 lg:mb-0 mb-[5.5rem]">
        <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
          <Bell className="w-4 h-4 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-zinc-900 dark:text-white">Turn on real-time alerts</div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
            Get notified when leads reply, AI calls finish, or payments need attention — even when the app is closed.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={enable}
              disabled={busy}
              className="px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Enabling…' : 'Enable notifications'}
            </button>
            <button
              onClick={dismiss}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white -mr-1 -mt-1 p-1 flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
