/**
 * SlackOAuthCallback
 * ──────────────────
 * Handles the Slack OAuth redirect at
 *   /api/integrations/slack/callback?code=...&state=...
 *
 * Reads the query params Slack appended, POSTs them to the
 * backend `POST /slack/process-callback` (which exchanges the
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

export function SlackOAuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>('processing');
  const [message, setMessage] = useState('Connecting your Slack workspace...');
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    async function processCallback() {
      try {
        const res = await fetch(`${API_BASE}/slack/process-callback`, {
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
          setTeamName(data.team_name || '');
          setMessage(
            data.team_name
              ? `Connected to ${data.team_name}`
              : 'Slack connected successfully!'
          );

          try {
            const bc = new BroadcastChannel('contndr-oauth-result');
            bc.postMessage({ type: 'slack-oauth-success', team_name: data.team_name || '' });
            setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
          } catch (_) {}

          if (window.opener) {
            window.opener.postMessage({ type: 'slack-oauth-success' }, '*');
          }
          try { localStorage.setItem('contndr-slack-oauth-success', 'true'); } catch (_) {}
          try { window.close(); } catch (_) {}
          setTimeout(() => { try { window.close(); } catch (_) {} }, 300);
        } else {
          throw new Error(data.error || 'Connection failed');
        }
      } catch (err: any) {
        console.error('[SLACK CALLBACK] Error:', err);
        setStatus('error');
        setMessage(err.message || 'An unexpected error occurred');

        try {
          const bc = new BroadcastChannel('contndr-oauth-result');
          bc.postMessage({ type: 'slack-oauth-error', message: err.message });
          setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
        } catch (_) {}

        if (window.opener) {
          window.opener.postMessage({ type: 'slack-oauth-error', message: err.message }, '*');
        }
        try { localStorage.setItem('contndr-slack-oauth-error', err.message || 'Slack connection failed'); } catch (_) {}
        try { window.close(); } catch (_) {}
        setTimeout(() => { try { window.close(); } catch (_) {} window.location.href = '/settings'; }, 500);
      }
    }

    // If Slack sent an error directly (user denied), handle immediately
    if (errorParam && !code) {
      setStatus('error');
      setMessage(
        `Slack denied access${errorDescription ? `: ${errorDescription}` : ''}`
      );

      const errMsg = errorDescription || errorParam || 'Access denied';

      try {
        const bc = new BroadcastChannel('contndr-oauth-result');
        bc.postMessage({ type: 'slack-oauth-error', message: errMsg });
        setTimeout(() => { try { bc.close(); } catch (_) {} }, 1000);
      } catch (_) {}

      if (window.opener) {
        window.opener.postMessage({ type: 'slack-oauth-error', message: errMsg }, '*');
      }
      try { localStorage.setItem('contndr-slack-oauth-error', errMsg); } catch (_) {}
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
      integrationName="Slack"
      message={message}
      detail={teamName || undefined}
      accentColor="#4A154B"
    />
  );
}

export default SlackOAuthCallback;