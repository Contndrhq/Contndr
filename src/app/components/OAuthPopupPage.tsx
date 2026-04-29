/**
 * OAuthPopupPage
 * ──────────────
 * A polished "you can close this tab" page shown inside the OAuth popup.
 * Since COOP headers may sever `window.opener`, the actual result notification
 * happens via BroadcastChannel from the callback component — this page is
 * purely cosmetic and tries to auto-close.
 */

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, X } from 'lucide-react';

type PopupStatus = 'processing' | 'success' | 'error';

interface OAuthPopupPageProps {
  status: PopupStatus;
  integrationName: string;
  message: string;
  /** Optional detail (portal ID, org name, etc.) */
  detail?: string;
  /** Brand accent color hex — defaults to #1ED4A7 */
  accentColor?: string;
  /** Optional branded logo */
  logo?: React.ReactNode;
}

export function OAuthPopupPage({
  status,
  integrationName,
  message,
  detail,
  accentColor = '#1ED4A7',
  logo,
}: OAuthPopupPageProps) {
  const [dots, setDots] = useState('');

  // Animated dots while processing
  useEffect(() => {
    if (status !== 'processing') return;
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, [status]);

  // Try to auto-close after a brief delay on success
  useEffect(() => {
    if (status === 'success') {
      const t = setTimeout(() => {
        try { window.close(); } catch (_) {}
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [status]);

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      {/* Subtle radial glow */}
      <div
        className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none opacity-20 blur-[100px]"
        style={{
          background: status === 'success'
            ? accentColor
            : status === 'error'
              ? '#ef4444'
              : '#ffffff',
        }}
      />

      <div className="relative text-center max-w-sm w-full">
        {/* Logo / Icon */}
        <div className="relative w-20 h-20 mx-auto mb-6">
          {status === 'success' && (
            <div
              className="absolute inset-0 rounded-full animate-ping opacity-20"
              style={{ backgroundColor: accentColor }}
            />
          )}
          <div
            className={`relative w-20 h-20 rounded-2xl flex items-center justify-center border transition-all duration-500 ${
              status === 'processing'
                ? 'bg-white/5 border-white/10'
                : status === 'success'
                  ? 'border-transparent'
                  : 'bg-red-500/10 border-red-500/20'
            }`}
            style={status === 'success' ? { backgroundColor: `${accentColor}15`, borderColor: `${accentColor}30` } : undefined}
          >
            {status === 'processing' && (
              <Loader2 className="w-9 h-9 text-white/50 animate-spin" />
            )}
            {status === 'success' && (
              logo ? (
                <div className="w-10 h-10 flex items-center justify-center">{logo}</div>
              ) : (
                <CheckCircle className="w-9 h-9" style={{ color: accentColor }} />
              )
            )}
            {status === 'error' && (
              <XCircle className="w-9 h-9 text-red-500" />
            )}
          </div>
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold text-white mb-2">
          {status === 'processing'
            ? `Connecting ${integrationName}${dots}`
            : status === 'success'
              ? `${integrationName} Connected`
              : 'Connection Failed'}
        </h1>

        {/* Message */}
        <p className="text-[14px] text-zinc-400 mb-2 break-words leading-relaxed">{message}</p>

        {/* Detail */}
        {status === 'success' && detail && (
          <p className="text-[13px] text-zinc-500 mb-4">
            {detail}
          </p>
        )}

        {/* Close hint for success */}
        {status === 'success' && (
          <div className="mt-6 space-y-3">
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accentColor }} />
              Result sent to Contndr
            </div>
            <p className="text-[13px] text-zinc-500">
              You can safely close this tab.
            </p>
            <button
              onClick={() => { try { window.close(); } catch (_) {} }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 transition-all"
            >
              <X className="w-3.5 h-3.5" />
              Close Tab
            </button>
          </div>
        )}

        {/* Processing hint */}
        {status === 'processing' && (
          <p className="text-[13px] text-zinc-600 mt-6">
            Please wait while we complete the connection...
          </p>
        )}

        {/* Error actions */}
        {status === 'error' && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <a
              href="/settings"
              className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white text-[13px] font-medium rounded-lg border border-white/10 transition-all"
            >
              Back to Settings
            </a>
            <button
              onClick={() => { try { window.close(); } catch (_) {} }}
              className="text-[12px] text-zinc-500 hover:text-zinc-400 transition-colors"
            >
              or close this tab
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
