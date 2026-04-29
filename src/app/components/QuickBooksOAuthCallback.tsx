/**
 * QuickBooksOAuthCallback
 * ───────────────────────
 * Handles the QuickBooks OAuth redirect at
 *   /api/integrations/quickbooks/callback?code=...&state=...&realmId=...
 *
 * Reads the query params Intuit appended, POSTs them to the
 * backend `POST /quickbooks/process-callback` (which exchanges the
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

export function QuickBooksOAuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>('processing');
  const [message, setMessage] = useState('Connecting your QuickBooks account...');
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const realmId = searchParams.get('realmId');
    const errorParam = searchParams.get('error');

    async function processCallback() {
      try {
        const res = await fetch(`${API_BASE}/quickbooks/process-callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({
            code: code || undefined,
            state: state || undefined,
            realmId: realmId || undefined,
            error: errorParam || undefined,
          }),
        });

        const data = await res.json();

        if (data.success) {
          setStatus('success');
          setCompanyName(data.company_name || '');
          setMessage(
            data.company_name
              ? `Connected to ${data.company_name}`
              : 'QuickBooks connected successfully!'
          );

          try {
            const bc = new BroadcastChannel('contndr-oauth-result');
            bc.postMessage({ type: 'quickbooks-oauth-success', company_name: data.company_name || '' });
            setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
          } catch (_) {}

          if (window.opener) {
            window.opener.postMessage({ type: 'quickbooks-oauth-success' }, '*');
          }
          try { localStorage.setItem('contndr-quickbooks-oauth-success', 'true'); } catch (_) {}
          try { window.close(); } catch (_) {}
          setTimeout(() => { try { window.close(); } catch (_) {} }, 300);
        } else {
          throw new Error(data.error || 'Connection failed');
        }
      } catch (err: any) {
        console.error('[QUICKBOOKS CALLBACK] Error:', err);
        setStatus('error');
        setMessage(err.message || 'An unexpected error occurred');

        try {
          const bc = new BroadcastChannel('contndr-oauth-result');
          bc.postMessage({ type: 'quickbooks-oauth-error', message: err.message });
          setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
        } catch (_) {}

        if (window.opener) {
          window.opener.postMessage({ type: 'quickbooks-oauth-error', message: err.message }, '*');
        }
        try { localStorage.setItem('contndr-quickbooks-oauth-error', err.message || 'QuickBooks connection failed'); } catch (_) {}
        try { window.close(); } catch (_) {}
        setTimeout(() => { try { window.close(); } catch (_) {} window.location.href = '/settings'; }, 500);
      }
    }

    // If Intuit sent an error directly (user denied), handle immediately
    if (errorParam && !code) {
      setStatus('error');
      setMessage(`QuickBooks denied access: ${errorParam}`);

      const errMsg = errorParam || 'Access denied';

      try {
        const bc = new BroadcastChannel('contndr-oauth-result');
        bc.postMessage({ type: 'quickbooks-oauth-error', message: errMsg });
        setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
      } catch (_) {}

      if (window.opener) {
        window.opener.postMessage({ type: 'quickbooks-oauth-error', message: errMsg }, '*');
      }
      try { localStorage.setItem('contndr-quickbooks-oauth-error', errMsg); } catch (_) {}
      try { window.close(); } catch (_) {}
      setTimeout(() => { try { window.close(); } catch (_) {} window.location.href = '/settings'; }, 500);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authorization parameters. Please try connecting again.');
      return;
    }

    if (!realmId) {
      setStatus('error');
      setMessage('Missing company identifier (realmId). Please try connecting again.');
      return;
    }

    processCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OAuthPopupPage
      status={status}
      integrationName="QuickBooks"
      message={message}
      detail={companyName || undefined}
      accentColor="#2CA01C"
    />
  );
}

export default QuickBooksOAuthCallback;