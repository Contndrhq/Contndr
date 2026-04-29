import { useState } from 'react';
import { CheckCircle, XCircle, Loader, AlertTriangle } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';

export function ApiTester() {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<any>(null);

  async function testApis() {
    setTesting(true);
    setResults(null);

    const tests = {
      server: { status: 'pending', message: '', details: '' },
      discovery: { status: 'pending', message: '', details: '' },
      ai: { status: 'pending', message: '', details: '' },
      resend: { status: 'pending', message: '', details: '' },
    };

    try {
      // Get auth headers once at the start
      const headers = await getAuthHeaders();

      // Test 1: Server Health
      try {
        const healthRes = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/health`,
          { headers }
        );
        if (healthRes.ok) {
          tests.server.status = 'success';
          tests.server.message = 'Server is running';
        } else {
          tests.server.status = 'error';
          tests.server.message = `Server error: ${healthRes.status}`;
        }
      } catch (err: any) {
        tests.server.status = 'error';
        tests.server.message = 'Cannot reach server';
        tests.server.details = err.message;
      }

      // Test 2: Lead Discovery (simple test query)
      try {
        const serpRes = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/discover`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              query: 'coffee shop',
              location: 'Seattle, WA',
              limit: 5,
            }),
          }
        );

        const serpData = await serpRes.json();
        
        if (serpRes.ok) {
          tests.discovery.status = 'success';
          tests.discovery.message = `Lead discovery working (found ${serpData.leads?.length || 0} results)`;
          tests.discovery.details = 'Lead discovery is operational';
        } else {
          tests.discovery.status = 'error';
          tests.discovery.message = serpData.error || 'Lead discovery failed';
          tests.discovery.details = serpData.details || 'Check API key and credits';
        }
      } catch (err: any) {
        tests.discovery.status = 'error';
        tests.discovery.message = 'Lead discovery test failed';
        tests.discovery.details = err.message;
      }

      // Test 3: AI (Gemini - direct connectivity test)
      try {
        const aiRes = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/test-ai`,
          { headers }
        );

        const aiData = await aiRes.json();
        
        if (aiRes.ok && aiData.status === 'ok') {
          tests.ai.status = 'success';
          tests.ai.message = `Gemini AI working (${aiData.latency_ms}ms)`;
          tests.ai.details = `Model: ${aiData.model || aiData.provider} | Server v${aiData.version}`;
        } else {
          tests.ai.status = 'error';
          tests.ai.message = aiData.error || 'AI test failed';
          tests.ai.details = aiData.gemini_key_set ? 'API key set but call failed' : 'GEMINI_API_KEY not configured';
        }
      } catch (err: any) {
        tests.ai.status = 'error';
        tests.ai.message = 'AI test failed';
        tests.ai.details = err.message;
      }

      // Test 4: Resend (simulated - check if endpoint exists)
      try {
        const resendRes = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/send`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              // Invalid data to check if endpoint responds
              to_email: null,
            }),
          }
        );

        const resendData = await resendRes.json();
        
        if (resendRes.status === 400 && resendData.error?.includes('required')) {
          tests.resend.status = 'success';
          tests.resend.message = 'Resend endpoint accessible';
          tests.resend.details = 'API key configured';
        } else if (resendRes.ok) {
          tests.resend.status = 'success';
          tests.resend.message = 'Resend working';
        } else {
          tests.resend.status = 'warning';
          tests.resend.message = 'Resend endpoint responded with errors';
          tests.resend.details = resendData.error || 'May need configuration';
        }
      } catch (err: any) {
        tests.resend.status = 'error';
        tests.resend.message = 'Resend test failed';
        tests.resend.details = err.message;
      }

    } catch (err) {
      console.error('Test suite error:', err);
    }

    setResults(tests);
    setTesting(false);
  }

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'success') return <CheckCircle className="w-5 h-5 text-[#1ED4A7] dark:text-[#1ED4A7]" />;
    if (status === 'error') return <XCircle className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />;
    if (status === 'warning') return <AlertTriangle className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />;
    return <Loader className="w-5 h-5 text-zinc-400 dark:text-zinc-500 animate-spin" />;
  };

  const StatusBg = ({ status }: { status: string }) => {
    if (status === 'success') return 'bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/5 border-[#1ED4A7]/20 dark:border-[#1ED4A7]/20';
    if (status === 'error') return 'bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700';
    if (status === 'warning') return 'bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700';
    return 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700';
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h2 className="text-[18px] mb-2 text-[var(--foreground)]">API Connection Tester</h2>
        <p className="text-[var(--foreground-muted)] text-[14px]">
          Test your API integrations to diagnose connection issues
        </p>
      </div>

      <button
        onClick={testApis}
        disabled={testing}
        className="px-6 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[14px] font-medium"
      >
        {testing ? (
          <>
            <Loader className="w-4 h-4 inline mr-2 animate-spin" />
            Testing APIs...
          </>
        ) : (
          'Run Tests'
        )}
      </button>

      {results && (
        <div className="space-y-3">
          {/* Server Test */}
          <div className={`border rounded-lg p-4 ${StatusBg({ status: results.server.status })}`}>
            <div className="flex items-start gap-3">
              <StatusIcon status={results.server.status} />
              <div className="flex-1">
                <h3 className="text-[15px] font-medium text-[var(--foreground)]">Server Connection</h3>
                <p className="text-[13px] mt-1 text-[var(--foreground-muted)]">{results.server.message}</p>
                {results.server.details && (
                  <p className="text-[12px] mt-1 opacity-75 text-[var(--foreground-muted)]">{results.server.details}</p>
                )}
              </div>
            </div>
          </div>

          {/* Lead Discovery Test */}
          <div className={`border rounded-lg p-4 ${StatusBg({ status: results.discovery.status })}`}>
            <div className="flex items-start gap-3">
              <StatusIcon status={results.discovery.status} />
              <div className="flex-1">
                <h3 className="text-[15px] font-medium text-[var(--foreground)]">Lead Discovery</h3>
                <p className="text-[13px] mt-1 text-[var(--foreground-muted)]">{results.discovery.message}</p>
                {results.discovery.details && (
                  <p className="text-[12px] mt-1 opacity-75 text-[var(--foreground-muted)]">{results.discovery.details}</p>
                )}
                {results.discovery.status === 'error' && (
                  <p className="text-[12px] mt-2 text-zinc-500 dark:text-zinc-400">
                    Check your discovery service API key and credits.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* AI Test */}
          <div className={`border rounded-lg p-4 ${StatusBg({ status: results.ai.status })}`}>
            <div className="flex items-start gap-3">
              <StatusIcon status={results.ai.status} />
              <div className="flex-1">
                <h3 className="text-[15px] font-medium text-[var(--foreground)]">Gemini AI (Email Generation)</h3>
                <p className="text-[13px] mt-1 text-[var(--foreground-muted)]">{results.ai.message}</p>
                {results.ai.details && (
                  <p className="text-[12px] mt-1 opacity-75 text-[var(--foreground-muted)]">{results.ai.details}</p>
                )}
              </div>
            </div>
          </div>

          {/* Resend Test */}
          <div className={`border rounded-lg p-4 ${StatusBg({ status: results.resend.status })}`}>
            <div className="flex items-start gap-3">
              <StatusIcon status={results.resend.status} />
              <div className="flex-1">
                <h3 className="text-[15px] font-medium text-[var(--foreground)]">Resend (Email Delivery)</h3>
                <p className="text-[13px] mt-1 text-[var(--foreground-muted)]">{results.resend.message}</p>
                {results.resend.details && (
                  <p className="text-[12px] mt-1 opacity-75 text-[var(--foreground-muted)]">{results.resend.details}</p>
                )}
              </div>
            </div>
          </div>

          {/* Overall Status */}
          <div className="bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/5 border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/20 rounded-lg p-4 mt-4">
            <h3 className="text-gray-900 dark:text-white text-[14px] font-medium mb-2">Diagnosis</h3>
            <div className="text-gray-600 dark:text-gray-400 text-[13px] space-y-1">
              {results.discovery.status === 'error' && (
                <p>• <strong>Lead discovery issue detected:</strong> Most likely out of credits. Check your API dashboard.</p>
              )}
              {results.server.status === 'error' && (
                <p>• <strong>Server connection failed:</strong> Cannot reach backend. Check network connection.</p>
              )}
              {results.discovery.status === 'success' && results.ai.status === 'success' && results.resend.status === 'success' && (
                <p><strong>All systems operational!</strong> Your APIs are configured correctly.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}