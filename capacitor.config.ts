import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the native iOS / Android shells.
 *
 * The webDir points at Vercel's production build output. For local
 * development we instead use `server.url` (uncomment the dev block
 * below) so the native shell loads the live Vite dev server and
 * hot-reloads on save — no `npx cap copy` cycle required.
 *
 * Native push is wired end-to-end:
 *   - Frontend (src/app/lib/nativePush.ts) registers for the
 *     @capacitor/push-notifications plugin and POSTs the device
 *     token to /devices/register.
 *   - Backend (src/app/supabase/functions/make-server-a8b2511f/
 *     native-push.tsx) stores tokens and fans out to APNs/FCM on
 *     event triggers (reply received, deal won, payment failed,
 *     AI call completed).
 *
 * See NATIVE_BUILD.md in the repo root for the iOS + Android build
 * steps (Xcode signing, APNs key generation, Firebase project setup,
 * Supabase secrets).
 */
const config: CapacitorConfig = {
  appId: 'com.Contndr',
  appName: 'Contndr',
  webDir: 'dist',
  // Set `bundledWebRuntime: false` so Capacitor doesn't ship its own
  // copy of the runtime — we already get it from the Vercel bundle.
  bundledWebRuntime: false,
  ios: {
    // Light status bar text by default so it reads against the dark
    // brand background. Per-screen override available via Capacitor's
    // StatusBar plugin if a light surface needs dark text.
    contentInset: 'always',
    backgroundColor: '#050505',
  },
  android: {
    backgroundColor: '#050505',
    // Allow https only — the in-app webview should never fall back to
    // cleartext. Production builds get this for free; this just makes
    // it explicit and audit-friendly.
    allowMixedContent: false,
  },
  plugins: {
    // Splash screen — short fade-out so the app doesn't show a blank
    // surface while React mounts. Keep total under 2s for App Store
    // review (Apple flags "static splash >2s" as a launch experience
    // issue).
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#050505',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    // Push Notifications — required for the native-push plugin to
    // function. iOS additionally needs the "Push Notifications"
    // capability enabled in Xcode → Signing & Capabilities.
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  // Point the native webview at the live Vercel deployment so every
  // web deploy ships to mobile instantly — no Xcode rebuild required.
  // The native shell still handles push notifications, status bar,
  // splash screen, etc.
  server: {
    url: 'https://app.contndr.com',
    cleartext: false,
  },
};

export default config;
