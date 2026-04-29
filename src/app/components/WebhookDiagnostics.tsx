import { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, Clock, AlertCircle, ExternalLink } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

export function WebhookDiagnostics() {
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setChecking(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/stripe/webhook/status`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        setStatus(data.status);
        console.log('Webhook status:', data);
      }
    } catch (error) {
      console.error('Error checking webhook status:', error);
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }

  async function testWebhook() {
    setTestResult('testing');
    try {
      const headers = await getAuthHeaders();
      
      // Try to hit the webhook endpoint directly (this will fail signature check but tell us if it's reachable)
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/stripe/webhook/sourcr`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ test: true }),
        }
      );

      const data = await response.json();
      
      if (response.status === 400 && data.error === 'Missing signature') {
        setTestResult('reachable');
      } else if (response.status === 500 && data.error === 'Webhook secret not configured') {
        setTestResult('no-secret');
      } else if (response.status === 503) {
        setTestResult('no-stripe');
      } else {
        setTestResult(JSON.stringify(data));
      }
    } catch (error) {
      setTestResult(`error: ${error.message}`);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-pulse text-[var(--foreground-muted)] text-[14px]">
          Checking webhook configuration...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Live Status */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-gray-400 dark:text-gray-500" />
            <h2 className="text-[var(--foreground)]">Live Webhook Status</h2>
          </div>
          <button
            onClick={checkStatus}
            disabled={checking}
            className="px-3 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[12px] font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Refresh'}
          </button>
        </div>

        <div className="space-y-3">
          {/* Sourcr Status */}
          <div className={`p-4 rounded-lg border ${
            status?.sourcr_configured 
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50'
              : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {status?.sourcr_configured ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                )}
                <div>
                  <p className={`text-[14px] font-medium ${
                    status?.sourcr_configured 
                      ? 'text-emerald-900 dark:text-emerald-100'
                      : 'text-red-900 dark:text-red-100'
                  }`}>
                    Sourcr Webhook Secret
                  </p>
                  {status?.sourcr_secret_preview && (
                    <p className="text-[12px] text-gray-600 dark:text-gray-400 font-mono mt-1">
                      {status.sourcr_secret_preview}
                    </p>
                  )}
                </div>
              </div>
              <span className={`text-[12px] font-bold ${
                status?.sourcr_configured 
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {status?.sourcr_configured ? 'CONFIGURED' : 'MISSING'}
              </span>
            </div>
          </div>

          {/* Roadr Status */}
          <div className={`p-4 rounded-lg border ${
            status?.roadr_configured 
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50'
              : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {status?.roadr_configured ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                   <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                )}
                <div>
                  <p className={`text-[14px] font-medium ${
                    status?.roadr_configured 
                      ? 'text-emerald-900 dark:text-emerald-100'
                      : 'text-amber-900 dark:text-amber-100'
                  }`}>
                    Roadr Webhook Secret
                  </p>
                  {status?.roadr_secret_preview && (
                    <p className="text-[12px] text-gray-600 dark:text-gray-400 font-mono mt-1">
                      {status.roadr_secret_preview}
                    </p>
                  )}
                </div>
              </div>
              <span className={`text-[12px] font-bold ${
                status?.roadr_configured 
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}>
                {status?.roadr_configured ? 'CONFIGURED' : 'OPTIONAL'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostic Test */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="w-5 h-5 text-gray-400 dark:text-gray-500" />
          <h2 className="text-[var(--foreground)]">Endpoint Diagnostic</h2>
        </div>

        <p className="text-[var(--foreground-muted)] text-[13px] mb-4">
          Test if the webhook endpoint is reachable and configured correctly.
        </p>

        <button
          onClick={testWebhook}
          disabled={testResult === 'testing'}
          className="w-full px-4 py-2.5 bg-blue-600 text-white text-[13px] font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {testResult === 'testing' ? 'Testing...' : 'Run Diagnostic Test'}
        </button>

        {testResult && testResult !== 'testing' && (
          <div className={`mt-4 p-4 rounded-lg border ${
            testResult === 'reachable'
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50'
              : testResult === 'no-secret'
              ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50'
              : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50'
          }`}>
            <p className="text-[13px] font-medium mb-2">Test Result:</p>
            {testResult === 'reachable' && (
              <div className="text-emerald-900 dark:text-emerald-100 text-[13px]">
                ✅ <strong>Endpoint is reachable and working!</strong>
                <p className="mt-2 text-[12px]">
                  The webhook endpoint is accessible. Signature verification would work with proper Stripe headers.
                </p>
              </div>
            )}
            {testResult === 'no-secret' && (
              <div className="text-red-900 dark:text-red-100 text-[13px]">
                ❌ <strong>Webhook secret not configured</strong>
                <p className="mt-2 text-[12px]">
                  Stripe webhook verification is not set up yet. Please contact your administrator to complete the configuration.
                </p>
              </div>
            )}
            {testResult === 'no-stripe' && (
              <div className="text-amber-900 dark:text-amber-100 text-[13px]">
                ⚠️ <strong>Stripe not configured</strong>
                <p className="mt-2 text-[12px]">
                  Stripe integration is not connected yet. Go to Settings &rarr; Integrations to set up Stripe.
                </p>
              </div>
            )}
            {!['reachable', 'no-secret', 'no-stripe'].includes(testResult) && (
              <div className="text-gray-900 dark:text-gray-100 text-[13px]">
                <code className="text-xs font-mono">{testResult}</code>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Next Steps */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-lg p-4">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-blue-900 dark:text-blue-100 text-[14px] font-medium mb-2">
              What to do if webhooks aren't working:
            </p>
            <ol className="text-blue-800 dark:text-blue-200 text-[13px] space-y-2 list-decimal list-inside">
              <li>
                Check Supabase logs for errors:
                <a
                  href={`https://supabase.com/dashboard/project/${projectId}/logs/edge-functions`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 ml-2 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View Logs <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                Check Stripe webhook delivery logs in your Stripe dashboard
              </li>
              <li>
                Look for HTTP status codes (200 = success, 400/500 = error)
              </li>
              <li>
                If you see errors, copy the exact error message and check the logs
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}