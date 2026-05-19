/**
 * Native push notifications via Capacitor — opt-in scaffold.
 *
 * This file is a no-op in pure-web builds. When the app is packaged with
 * Capacitor for iOS/Android and the @capacitor/push-notifications plugin
 * is installed, the wired-up flow:
 *   1. Asks the user for permission (iOS prompt / Android 13+ prompt)
 *   2. Registers with APNs/FCM and receives a device token
 *   3. POSTs the token to the backend (/devices/register) so the server
 *      can deliver pushes via APNs/FCM
 *   4. Listens for incoming pushes and routes them through the existing
 *      notificationService so the in-app bell stays in sync
 *
 * Setup checklist (do these once when you're ready to ship native push):
 *   1. npm install @capacitor/push-notifications
 *   2. npx cap sync ios && npx cap sync android
 *   3. Enable "Push Notifications" capability in Xcode → Signing &
 *      Capabilities; add APNs key in Apple Developer; upload it to the
 *      backend (or to Firebase if you go through FCM)
 *   4. Android: configure Firebase project + google-services.json
 *   5. Implement POST /devices/register on the backend to store
 *      (user_id, platform, device_token, env) so APNs/FCM has somewhere
 *      to deliver to
 *
 * Until then this file silently does nothing — safe to mount at app boot.
 */

import { authenticatedFetch } from './auth';
import { projectId } from '../utils/supabase/info';
import { notificationService } from './notifications';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

let initialized = false;
let wkBridgeInstalled = false;

/**
 * WKWebView bridge for the native SwiftUI shell (separate from Capacitor).
 *
 * The iOS shell at ContndrApp.swift calls
 *   window.__app.onDeviceTokenReceived(token)
 * after APNs returns a device token. This installs that handler so the
 * token gets POSTed to /devices/register with the current Supabase auth
 * token attached. Safe to call repeatedly — installs once.
 *
 * Also wires window.__app.onNotificationTap(url) for deep-link routing
 * when the user taps a backgrounded push.
 */
export function installWKWebViewBridge(): void {
  if (typeof window === 'undefined' || wkBridgeInstalled) return;
  wkBridgeInstalled = true;

  const w: any = window;
  w.__app = w.__app || {};

  let pendingToken: string | null = null;
  let registered = false;

  const tryRegister = async (token: string): Promise<boolean> => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_token: token, platform: 'ios' }),
      });
      if (res.ok) {
        console.log('[push] device token registered with backend');
        return true;
      }
      // 401 = no auth yet (user not logged in). Anything else is a real failure.
      console.warn('[push] register failed:', res.status);
      return false;
    } catch (err: any) {
      console.warn('[push] register error:', err?.message || err);
      return false;
    }
  };

  // If the token arrives before the user logs in, hold it and retry on
  // every focus / auth-state change until /devices/register succeeds.
  const flushPending = async () => {
    if (registered || !pendingToken) return;
    const ok = await tryRegister(pendingToken);
    if (ok) {
      registered = true;
      pendingToken = null;
    }
  };

  // Retry hooks: re-attempt registration on tab focus and periodically
  // while the token is pending (covers post-login transitions).
  window.addEventListener('focus', () => { void flushPending(); });
  const interval = setInterval(() => {
    if (registered) {
      clearInterval(interval);
      return;
    }
    void flushPending();
  }, 5000);

  w.__app.onDeviceTokenReceived = (token: string) => {
    if (!token || typeof token !== 'string') return true;
    pendingToken = token;
    void flushPending();
    return true;  // tell native side we received it; we handle retry
  };

  w.__app.onNotificationTap = (url: string) => {
    if (typeof url === 'string' && url) {
      try { window.location.href = url; } catch {}
    }
  };

  // Tell the native side we're ready, in case the token arrived before
  // this handler was installed and is sitting in UserDefaults waiting.
  try {
    const native = w.webkit?.messageHandlers?.native;
    if (native?.postMessage) {
      native.postMessage({ type: 'WEB_READY' });
    }
  } catch {}
}

export async function initNativePush(): Promise<{ supported: boolean; reason?: string }> {
  // Always install the WKWebView bridge — it's a no-op on web and harmless
  // if running under Capacitor too. The iOS native shell polls every 3s
  // until window.__app.onDeviceTokenReceived exists.
  installWKWebViewBridge();

  if (initialized) return { supported: true };
  initialized = true;

  // Detect Capacitor — we don't import the plugin statically so the web
  // build doesn't choke if the package isn't installed.
  const isNative = typeof (globalThis as any).Capacitor !== 'undefined'
    && (globalThis as any).Capacitor?.isNativePlatform?.() === true;
  if (!isNative) {
    return { supported: false, reason: 'Not a native platform (Capacitor not detected)' };
  }

  try {
    // Dynamic import so the web bundle never tries to resolve this.
    // The /* @vite-ignore */ + indirect string prevents Vite/Rollup from
    // statically analyzing the path and failing the build when the
    // optional peer dep isn't installed (web/Vercel builds).
    const pkg = '@capacitor/push-notifications';
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - optional peer dep
    const mod: any = await import(/* @vite-ignore */ pkg).catch(() => null);
    if (!mod?.PushNotifications) {
      return { supported: false, reason: '@capacitor/push-notifications not installed' };
    }
    const PushNotifications = mod.PushNotifications;

    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') {
        return { supported: true, reason: 'User declined permission' };
      }
    } else if (perm.receive !== 'granted') {
      return { supported: true, reason: `Permission state: ${perm.receive}` };
    }

    // Register for push (gets a device token from APNs/FCM)
    await PushNotifications.register();

    // Listener: registration success → ship the token to our backend
    PushNotifications.addListener('registration', async (token: any) => {
      const platform = (globalThis as any).Capacitor?.getPlatform?.() || 'unknown';
      try {
        await authenticatedFetch(`${API_BASE}/devices/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_token: token.value || token,
            platform,
          }),
        });
      } catch (err: any) {
        console.warn('[push] device token registration failed:', err?.message || err);
      }
    });

    PushNotifications.addListener('registrationError', (err: any) => {
      console.warn('[push] registration error:', err);
    });

    // Foreground push received — surface through the in-app notification
    // bell so the user sees it without leaving the app.
    PushNotifications.addListener('pushNotificationReceived', (notif: any) => {
      try {
        notificationService.notify(
          'system',
          notif.title || 'Notification',
          notif.body || '',
          notif.data || {},
        );
      } catch {}
    });

    // User tapped a backgrounded notification — route them to the right view
    PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
      const url = action?.notification?.data?.url;
      if (url && typeof url === 'string') {
        try { window.location.href = url; } catch {}
      }
    });

    return { supported: true };
  } catch (err: any) {
    return { supported: false, reason: err?.message || 'init failed' };
  }
}
