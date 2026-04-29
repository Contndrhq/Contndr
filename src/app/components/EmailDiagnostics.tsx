import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Eye, MousePointerClick, Mail, Send } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { publicAnonKey, projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { syncEmailStatuses } from '../utils/syncEmailStatuses';

export function EmailDiagnostics() {
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);
  const [sending, setSending] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [defaultSender, setDefaultSender] = useState('');
  const [lastWebhookEvent, setLastWebhookEvent] = useState<any>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  
  // Test Email Modal State
  const [showTestModal, setShowTestModal] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testFrom, setTestFrom] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Wait for auth to be ready before loading data
  useEffect(() => {
    const checkAuthReady = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setIsAuthReady(true);
        setUserEmail(data.session.user.email || null);
      }
    };
    
    checkAuthReady();
    
    // Also listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthReady(!!session);
      if (session) setUserEmail(session.user.email || null);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthReady) return;

    loadRecentEmails();
    loadEmailConfig();
    loadWebhookDiagnostics();
    
    // Webhook-driven: Resend webhooks push status updates to the DB,
    // and Supabase Realtime (below) pushes DB changes to the frontend.
    // No auto-polling of the Resend API — use the manual "Sync from
    // Resend API" button as a fallback if webhooks miss events.
    
    // Set up real-time subscriptions for instant updates
    setIsLiveUpdating(true);
    
    const subscription = supabase
      .channel('email-diagnostics')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'emails',
        },
        (payload) => {
          console.log('📨 Real-time email update in diagnostics:', payload);
          // Reload emails when any email changes
          loadRecentEmails();
        }
      )
      .subscribe((status) => {
        console.log('🔌 Email diagnostics realtime status:', status);
        setIsLiveUpdating(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(subscription);
      setIsLiveUpdating(false);
    };
  }, [isAuthReady]);

  async function loadEmailConfig() {
    try {
      const headers = await getAuthHeaders();
      
      // Don't make API call if not authenticated
      if (!headers.Authorization) {
        return;
      }

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/settings/email-config`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.config) {
          // Use roadr_sender only for admin, otherwise user email
          const sender = (userEmail === 'or@roadr.com' ? data.config.roadr_sender : userEmail) || userEmail || '';
          setDefaultSender(sender);
          setTestFrom(sender);
        }
      }
    } catch (error) {
      // Silent catch - will use default sender
    }
  }

  async function loadWebhookDiagnostics() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/webhook-diagnostics`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setLastWebhookEvent(data.lastEvent);
      }
    } catch (error) {
      console.error('Error loading webhook diagnostics:', error);
    }
  }

  async function testWebhookEndpoint() {
    try {
      // Test without auth to simulate Resend
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/webhooks/resend-v2`,
        { method: 'GET' }
      );
      
      const text = await response.text();
      console.log('Webhook endpoint test:', { status: response.status, text });
      
      if (response.ok) {
        alert('✅ Webhook endpoint is reachable!\n\n' + text);
      } else {
        alert('❌ Webhook endpoint returned error:\n\nStatus: ' + response.status + '\n' + text);
      }
    } catch (error) {
      console.error('Error testing webhook endpoint:', error);
      alert('❌ Failed to reach webhook endpoint:\n\n' + error.message);
    }
  }

  async function loadRecentEmails() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/recent?limit=50`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        setEmails(data.emails || []);
        setSummary(data.summary);
      }
    } catch (error) {
      console.error('Error loading emails:', error);
    } finally {
      setLoading(false);
    }
  }

  async function syncAllEmails() {
    setSyncing(true);
    try {
      const result = await syncEmailStatuses({ getAuthHeaders });

      if (result.success) {
        await loadRecentEmails();
        await loadWebhookDiagnostics();
        alert('Sync complete! Email statuses updated.');
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error syncing:', error);
      alert('Failed to sync emails');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSendTest() {
    if (!testTo || !testFrom) return;

    setSending(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/send-test`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: testTo,
            from_email: testFrom,
            subject: 'Contndr Tracking Test ' + new Date().toLocaleTimeString(),
            text_body: 'This is a test email to verify tracking.\n\nPlease open this email and click a link if available.',
            from_name: 'Contndr Test',
            save: true // Save to DB to verify tracking logic
          })
        }
      );

      if (response.ok) {
        alert('✅ Test email sent! Check your inbox.');
        setShowTestModal(false);
        // Wait a bit and reload to see it in the list (if it was saved to DB)
        setTimeout(loadRecentEmails, 2000);
      } else {
        const data = await response.json();
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      alert('Failed to send test email');
    } finally {
      setSending(false);
    }
  }

  function openTestModal() {
    setTestTo('');
    setTestFrom(defaultSender);
    setShowTestModal(true);
  }

  async function repairTracking() {
    if (!confirm('Attempt to find missing Resend IDs? This will match emails sent in the last 24h with Resend logs.')) return;
    setRepairing(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/repair-ids`,
        { method: 'POST', headers }
      );
      
      const data = await response.json();
      if (response.ok) {
        alert(data.message);
        loadRecentEmails();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (error) {
      console.error('Error repairing:', error);
      alert('Failed to repair tracking');
    } finally {
      setRepairing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="mb-1 text-[var(--foreground)]">Email Tracking Diagnostics</h1>
          <p className="text-[var(--foreground-muted)] text-[14px]">
            Debug email tracking and webhook events — powered by Resend webhooks
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
            isLiveUpdating
              ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/20'
              : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              isLiveUpdating ? 'bg-[#1ED4A7] animate-pulse' : 'bg-gray-400'
            }`}></div>
            <span className={`text-[12px] font-medium ${
              isLiveUpdating
                ? 'text-[#1ED4A7]'
                : 'text-gray-700 dark:text-gray-400'
            }`}>
              {isLiveUpdating ? 'Live updates enabled' : 'Connecting...'}
            </span>
          </div>
          <button
            onClick={openTestModal}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-[13px] font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <Send className={`w-4 h-4 ${sending ? 'animate-pulse' : ''}`} />
            {sending ? 'Sending...' : 'Send Test'}
          </button>
          <button
            onClick={repairTracking}
            disabled={repairing}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 text-[13px] font-medium rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
            title="Attempt to recover missing Resend IDs"
          >
            <RefreshCw className={`w-4 h-4 ${repairing ? 'animate-spin' : ''}`} />
            {repairing ? 'Repairing...' : 'Repair Tracking'}
          </button>
          <button
            onClick={syncAllEmails}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-[13px] font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync from Resend API'}
          </button>
        </div>
      </div>

      {/* Open Tracking Reminder */}
      <div className="p-4 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-zinc-500 dark:text-zinc-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-zinc-700 dark:text-zinc-200 text-[13px] font-medium mb-1">
              ⚡ Tracking Requirement
            </p>
            <p className="text-zinc-600 dark:text-zinc-300 text-[12px] mb-2">
              Make sure <strong>Open Tracking</strong> is enabled in your Resend dashboard → Settings → Configuration.
              Without it, emails will never show as "opened" even when recipients open them!
            </p>
            <p className="text-zinc-500 dark:text-zinc-400 text-xs">
              💡 Both <strong>Open Tracking</strong> and <strong>Click Tracking</strong> should be toggled ON.
            </p>
          </div>
        </div>
      </div>

      {/* Webhook status notice */}
      {!lastWebhookEvent && (
        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-medium text-zinc-900 dark:text-white mb-1">No webhook events received yet</p>
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Email tracking webhooks haven't been received. Events will appear here automatically once email activity is detected.
              </p>
              <button
                onClick={testWebhookEndpoint}
                className="mt-3 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors flex items-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Test Webhook Endpoint
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <Mail className="w-5 h-5 text-zinc-400" />
              <span className="text-[13px] text-gray-500 dark:text-gray-400">Total Emails</span>
            </div>
            <p className="text-[28px] font-bold text-gray-900 dark:text-white">{summary.total}</p>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-[#1ED4A7]" />
              <span className="text-[13px] text-gray-500 dark:text-gray-400">Has Resend ID</span>
            </div>
            <p className="text-[28px] font-bold text-gray-900 dark:text-white">{summary.withResendId}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {summary.total > 0 ? Math.round((summary.withResendId / summary.total) * 100) : 0}% of total
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <Eye className="w-5 h-5 text-zinc-400" />
              <span className="text-[13px] text-gray-500 dark:text-gray-400">Opened</span>
            </div>
            <p className="text-[28px] font-bold text-gray-900 dark:text-white">{summary.opened}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {summary.withResendId > 0 ? Math.round((summary.opened / summary.withResendId) * 100) : 0}% open rate
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <MousePointerClick className="w-5 h-5 text-zinc-400" />
              <span className="text-[13px] text-gray-500 dark:text-gray-400">Clicked</span>
            </div>
            <p className="text-[28px] font-bold text-gray-900 dark:text-white">{summary.clicked}</p>
          </div>
        </div>
      )}

      {/* Webhook Diagnostics - Added to debug tracking issues */}
      {lastWebhookEvent && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden p-5">
           <h3 className="text-[var(--foreground)] font-medium mb-3 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${lastWebhookEvent.success ? 'bg-[#1ED4A7]' : 'bg-zinc-500'}`}></div>
            Last Webhook Event Received
           </h3>
           
           <div className="bg-gray-50 dark:bg-black rounded-lg p-3 font-mono text-xs overflow-x-auto border border-gray-100 dark:border-gray-800">
             <div className="grid grid-cols-[100px_1fr] gap-2 mb-2">
               <span className="text-gray-500">Timestamp:</span>
               <span className="text-gray-900 dark:text-gray-300">{new Date(lastWebhookEvent.timestamp).toLocaleString()}</span>
               
               <span className="text-gray-500">Event Type:</span>
               <span className="text-zinc-400 font-semibold">{lastWebhookEvent.type || 'N/A'}</span>
               
               <span className="text-gray-500">Resend ID:</span>
               <span className="text-gray-900 dark:text-gray-300">{lastWebhookEvent.resend_id || 'N/A'}</span>
               
               <span className="text-gray-500">Signature:</span>
               <span className={lastWebhookEvent.signature_verified ? 'text-[#1ED4A7]' : 'text-zinc-400'}>
                 {lastWebhookEvent.signature_verified ? 'Verified ✅' : 'Failed ❌'}
               </span>
             </div>
             
             {lastWebhookEvent.error && (
                <div className="mt-2 p-2 bg-zinc-100 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 rounded border border-zinc-200 dark:border-zinc-700">
                  <strong>Error:</strong> {lastWebhookEvent.error}
                </div>
             )}
             
             {!lastWebhookEvent.success && lastWebhookEvent.headers && (
                <div className="mt-2">
                   <p className="text-gray-500 mb-1">Debug Headers:</p>
                   <pre className="text-gray-600 dark:text-gray-400">{JSON.stringify(lastWebhookEvent.headers, null, 2)}</pre>
                </div>
             )}
           </div>
           
           <div className="mt-3 text-[12px] text-gray-500">
             <p>Use this to verify if Resend is successfully communicating with your backend.</p>
           </div>
        </div>
      )}

      {/* Email List */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-[var(--foreground)]">Recent Emails</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Resend ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Sent
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Opened
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Clicked
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {emails.map((email) => (
                <tr key={email.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                  <td className="px-6 py-4 text-[13px] text-gray-900 dark:text-white max-w-xs truncate">
                    {email.subject}
                  </td>
                  <td className="px-6 py-4 text-[12px] font-mono text-gray-600 dark:text-gray-400">
                    {email.resend_id ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-3 h-3 text-[#1ED4A7]" />
                        <span className="truncate max-w-[120px]">{email.resend_id}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-zinc-500">
                        <XCircle className="w-3 h-3" />
                        <span>Missing</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      email.status === 'opened' || email.status === 'clicked'
                        ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                        : email.status === 'delivered'
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400'
                        : email.status === 'sent'
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
                        : email.status === 'bounced'
                        ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
                    }`}>
                      {email.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-[12px] text-gray-600 dark:text-gray-400">
                    {email.sent_at ? new Date(email.sent_at).toLocaleString() : '-'}
                  </td>
                  <td className="px-6 py-4">
                    {email.opened_at ? (
                      <div className="flex items-center gap-2 text-[12px] text-[#1ED4A7]">
                        <Eye className="w-3.5 h-3.5" />
                        {new Date(email.opened_at).toLocaleString()}
                      </div>
                    ) : (
                      <span className="text-[12px] text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {email.clicked_at ? (
                      <div className="flex items-center gap-2 text-[12px] text-zinc-400">
                        <MousePointerClick className="w-3.5 h-3.5" />
                        {new Date(email.clicked_at).toLocaleString()}
                      </div>
                    ) : (
                      <span className="text-[12px] text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {emails.length === 0 && (
          <div className="px-6 py-12 text-center">
            <AlertCircle className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 text-[14px]">
              No emails found. Start sending campaigns to see tracking data here.
            </p>
          </div>
        )}
      </div>

      {/* Troubleshooting Tips */}
      <div className="bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-zinc-500 dark:text-zinc-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-zinc-700 dark:text-zinc-200 font-medium mb-2">Troubleshooting Tips</h3>
            <ul className="text-zinc-600 dark:text-zinc-300 text-[13px] space-y-1.5 list-disc list-inside">
              <li>If "Resend ID" is missing: The email wasn't sent through Resend API properly</li>
              <li>If status is stuck at "sent": Webhook isn't receiving events or email not opened yet</li>
              <li>If opens/clicks aren't tracking: Click "Sync from Resend API" to manually pull latest status</li>
              <li>Webhook URL: <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-[12px]">
                https://{projectId}.supabase.co/functions/v1/make-server-a8b2511f/webhooks/resend-v2
              </code></li>
            </ul>
          </div>
        </div>
      </div>
      {/* Test Email Modal */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-scale-in border border-gray-200 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Send Test Email</h3>
              <button 
                onClick={() => setShowTestModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Recipient Email (To)
                </label>
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-3 py-2 bg-white dark:bg-black border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 outline-none transition-all"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sender Email (From)
                </label>
                <input
                  type="email"
                  value={testFrom}
                  onChange={(e) => setTestFrom(e.target.value)}
                  placeholder="sender@example.com"
                  className="w-full px-3 py-2 bg-white dark:bg-black border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 outline-none transition-all"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must be a verified sender domain in Resend.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  onClick={() => setShowTestModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendTest}
                  disabled={!testTo || !testFrom || sending}
                  className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send Email
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}