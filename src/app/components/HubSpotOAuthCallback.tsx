/**
 * HubSpotOAuthCallback
 * ────────────────────
 * Handles the HubSpot OAuth redirect at
 *   /api/integrations/hubspot/callback?code=...&state=...
 *
 * Reads the query params HubSpot appended, POSTs them to the
 * backend `POST /hubspot/process-callback` (which exchanges the
 * code for tokens server-side), then notifies the opener window
 * (or sets localStorage) so IntegrationsTab picks up the result.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { OAuthPopupPage } from './OAuthPopupPage';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

type Status = 'processing' | 'success' | 'error';

export function HubSpotOAuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>('processing');
  const [message, setMessage] = useState('Connecting your HubSpot account...');
  const [portalId, setPortalId] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    async function processCallback() {
      try {
        const res = await fetch(`${API_BASE}/hubspot/process-callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({
            code: code || undefined,
            state: state || undefined,
            error: errorParam || undefined,
            error_description: errorDescription || undefined,
          }),
        });

        const data = await res.json();

        if (data.success) {
          setStatus('success');
          setPortalId(data.portal_id || '');
          setMessage(
            data.portal_id
              ? `Connected to portal ${data.portal_id}`
              : 'HubSpot connected successfully!'
          );

          // BroadcastChannel: works even when COOP severs window.opener
          try {
            const bc = new BroadcastChannel('contndr-oauth-result');
            bc.postMessage({ type: 'hubspot-oauth-success', portal_id: data.portal_id || '' });
            setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
          } catch (_) {}

          // Notify the opener (popup flow)
          if (window.opener) {
            window.opener.postMessage({ type: 'hubspot-oauth-success' }, '*');
          }
          // localStorage fallback for full-tab redirect
          try { localStorage.setItem('contndr-hubspot-oauth-success', 'true'); } catch (_) {}
          // Try to close (best effort), then redirect
          try { window.close(); } catch (_) {}
          setTimeout(() => { try { window.close(); } catch (_) {} }, 300);
        } else {
          throw new Error(data.error || 'Connection failed');
        }
      } catch (err: any) {
        console.error('[HUBSPOT CALLBACK] Error:', err);
        setStatus('error');
        setMessage(err.message || 'An unexpected error occurred');

        // BroadcastChannel: error notification
        try {
          const bc = new BroadcastChannel('contndr-oauth-result');
          bc.postMessage({ type: 'hubspot-oauth-error', message: err.message });
          setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
        } catch (_) {}

        // Notify opener of failure
        if (window.opener) {
          window.opener.postMessage(
            { type: 'hubspot-oauth-error', message: err.message },
            '*'
          );
        }
        try { localStorage.setItem('contndr-hubspot-oauth-error', err.message || 'HubSpot connection failed'); } catch (_) {}
        try { window.close(); } catch (_) {}
        setTimeout(() => { try { window.close(); } catch (_) {} window.location.href = '/settings'; }, 500);
      }
    }

    // If HubSpot sent an error directly (user denied), handle immediately
    if (errorParam && !code) {
      setStatus('error');
      setMessage(
        `HubSpot denied access${errorDescription ? `: ${errorDescription}` : ''}`
      );

      const errMsg = errorDescription || errorParam || 'Access denied';

      // BroadcastChannel
      try {
        const bc = new BroadcastChannel('contndr-oauth-result');
        bc.postMessage({ type: 'hubspot-oauth-error', message: errMsg });
        setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
      } catch (_) {}

      if (window.opener) {
        window.opener.postMessage({ type: 'hubspot-oauth-error', message: errMsg }, '*');
      }
      try { localStorage.setItem('contndr-hubspot-oauth-error', errMsg); } catch (_) {}
      try { window.close(); } catch (_) {}
      setTimeout(() => { try { window.close(); } catch (_) {} window.location.href = '/settings'; }, 500);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authorization parameters. Please try connecting again.');
      return;
    }

    processCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OAuthPopupPage
      status={status}
      integrationName="HubSpot"
      message={message}
      detail={portalId ? `Portal ID: ${portalId}` : undefined}
      accentColor="#FF7A59"
    />
  );
}

export default HubSpotOAuthCallback;