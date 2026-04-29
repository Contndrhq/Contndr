/**
 * SalesforceOAuthCallback
 * ───────────────────────
 * Handles the Salesforce OAuth redirect at
 *   /api/integrations/salesforce/callback?code=...&state=...
 *
 * Reads the query params Salesforce appended, POSTs them to the
 * backend `POST /salesforce/process-callback` (which exchanges the
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

export function SalesforceOAuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>('processing');
  const [message, setMessage] = useState('Connecting your Salesforce account...');
  const [orgName, setOrgName] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    async function processCallback() {
      try {
        const res = await fetch(`${API_BASE}/salesforce/process-callback`, {
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
          setOrgName(data.org_name || '');
          setMessage(
            data.org_name
              ? `Connected to ${data.org_name}`
              : 'Salesforce connected successfully!'
          );

          // BroadcastChannel: works even when COOP severs window.opener
          try {
            const bc = new BroadcastChannel('contndr-oauth-result');
            bc.postMessage({ type: 'salesforce-oauth-success', org_name: data.org_name || '' });
            setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
          } catch (_) {}

          if (window.opener) {
            window.opener.postMessage({ type: 'salesforce-oauth-success' }, '*');
          }
          try { localStorage.setItem('contndr-salesforce-oauth-success', 'true'); } catch (_) {}
          try { window.close(); } catch (_) {}
          setTimeout(() => { try { window.close(); } catch (_) {} }, 300);
        } else {
          throw new Error(data.error || 'Connection failed');
        }
      } catch (err: any) {
        console.error('[SALESFORCE CALLBACK] Error:', err);
        setStatus('error');
        setMessage(err.message || 'An unexpected error occurred');

        try {
          const bc = new BroadcastChannel('contndr-oauth-result');
          bc.postMessage({ type: 'salesforce-oauth-error', message: err.message });
          setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
        } catch (_) {}

        if (window.opener) {
          window.opener.postMessage({ type: 'salesforce-oauth-error', message: err.message }, '*');
        }
        try { localStorage.setItem('contndr-salesforce-oauth-error', err.message || 'Salesforce connection failed'); } catch (_) {}
        try { window.close(); } catch (_) {}
        setTimeout(() => { try { window.close(); } catch (_) {} window.location.href = '/settings'; }, 500);
      }
    }

    // If Salesforce sent an error directly (user denied), handle immediately
    if (errorParam && !code) {
      setStatus('error');
      setMessage(
        `Salesforce denied access${errorDescription ? `: ${errorDescription}` : ''}`
      );

      const errMsg = errorDescription || errorParam || 'Access denied';

      try {
        const bc = new BroadcastChannel('contndr-oauth-result');
        bc.postMessage({ type: 'salesforce-oauth-error', message: errMsg });
        setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
      } catch (_) {}

      if (window.opener) {
        window.opener.postMessage({ type: 'salesforce-oauth-error', message: errMsg }, '*');
      }
      try { localStorage.setItem('contndr-salesforce-oauth-error', errMsg); } catch (_) {}
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
      integrationName="Salesforce"
      message={message}
      detail={orgName || undefined}
      accentColor="#00A1E0"
    />
  );
}

export default SalesforceOAuthCallback;