/**
 * SocialOAuthCallback
 * ───────────────────
 * Minimal fallback for /social-oauth-callback when the inline script in
 * index.html fails to close the popup. Renders only a dark background,
 * relays the result to the parent (if the inline script didn't already),
 * and aggressively retries window.close().
 *
 * All visual feedback is handled by the OAuthResultModal in the parent window.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export function SocialOAuthCallback() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const alreadyHandled = !!(window as any).__socialOAuthHandled;

    // If the inline script didn't fire (rare edge case), send messages now
    if (!alreadyHandled) {
      const payload: Record<string, any> = { type: 'social-oauth-result' };
      const err = searchParams.get('social_error');
      if (err) {
        payload.social_error = err;
      } else if (searchParams.get('linkedin_select_account') === 'true') {
        payload.linkedin_select_account = true;
      } else if (searchParams.get('meta_select_pages') === 'true') {
        payload.meta_select_pages = true;
      } else {
        const sc = searchParams.get('social_connected');
        if (sc) payload.social_connected = sc;
        const sn = searchParams.get('social_name');
        if (sn) payload.social_name = sn;
      }

      try {
        const bc = new BroadcastChannel('contndr-social-oauth');
        bc.postMessage(payload);
        setTimeout(() => { try { bc.close(); } catch {} }, 500);
      } catch {}

      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, '*');
        }
      } catch {}
    }

    // Aggressively try to close — retry a few times in case the browser delays it
    const tryClose = () => { try { window.close(); } catch {} };
    tryClose();
    const t1 = setTimeout(tryClose, 100);
    const t2 = setTimeout(tryClose, 300);
    const t3 = setTimeout(tryClose, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [searchParams]);

  // Render only a blank dark screen — the parent OAuthResultModal handles all UI
  return <div className="fixed inset-0" style={{ background: '#050505' }} />;
}

export default SocialOAuthCallback;
