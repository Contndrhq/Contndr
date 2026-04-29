import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ExternalLink,
  Unlink,
  RefreshCw,
  Clock,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { apiCache } from '../lib/api-cache';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/hubspot`;

interface HubSpotStatus {
  connected: boolean;
  portal_id?: string;
  user?: string;
  connected_at?: string;
  scopes?: string[];
  error?: string;
}

interface ExportLog {
  type: string;
  success: boolean;
  action?: string;
  email?: string;
  company_name?: string;
  error?: string;
  timestamp: string;
  hubspot_contact_id?: string;
  hubspot_company_id?: string;
}

// HubSpot brand orange
const HUBSPOT_COLOR = '#FF7A59';

export function HubSpotSettings() {
  const [status, setStatus] = useState<HubSpotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [logs, setLogs] = useState<ExportLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiCache.fetch(
        'hubspot:status',
        async () => {
          const res = await authenticatedFetch(`${API_BASE}/status`);
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      setStatus(data);
    } catch (err: any) {
      console.error('[HUBSPOT] Status check error:', err);
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    // Handle redirect-based OAuth return (popup was blocked, SPA callback set localStorage)
    try {
      const hsSuccess = localStorage.getItem('contndr-hubspot-oauth-success');
      const hsError = localStorage.getItem('contndr-hubspot-oauth-error');
      if (hsSuccess) {
        localStorage.removeItem('contndr-hubspot-oauth-success');
        apiCache.invalidate('hubspot:status');
        checkStatus();
        setConnecting(false);
        toast.success('HubSpot connected successfully!');
      }
      if (hsError) {
        localStorage.removeItem('contndr-hubspot-oauth-error');
        setConnecting(false);
        toast.error(hsError || 'HubSpot connection failed');
      }
    } catch (_) {}

    // Listen for OAuth success from popup window
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'hubspot-oauth-success') {
        apiCache.invalidate('hubspot:status');
        checkStatus();
        setConnecting(false);
        toast.success('HubSpot connected successfully!');
      } else if (event.data?.type === 'hubspot-oauth-error') {
        setConnecting(false);
        toast.error(event.data.message || 'HubSpot connection failed');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [checkStatus]);

  async function handleConnect() {
    try {
      setConnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/connect?origin=${encodeURIComponent(window.location.origin)}`);
      const data = await res.json();

      if (data.auth_url) {
        // Open in popup
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const popup = window.open(
          data.auth_url,
          'hubspot-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
        );

        // Fallback: If popup is blocked, open in new tab instead
        if (!popup || popup.closed) {
          window.open(data.auth_url, '_blank');
        }

        // Poll for popup close (in case postMessage doesn't work)
        const pollInterval = setInterval(() => {
          if (popup && popup.closed) {
            clearInterval(pollInterval);
            // Give a moment for the state to be saved, then check
            setTimeout(() => {
              apiCache.invalidate('hubspot:status');
              checkStatus();
              setConnecting(false);
            }, 1500);
          }
        }, 1000);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          setConnecting(false);
        }, 5 * 60 * 1000);
      } else {
        throw new Error(data.error || 'Failed to get authorization URL');
      }
    } catch (err: any) {
      console.error('[HUBSPOT] Connect error:', err);
      toast.error(err.message || 'Failed to start HubSpot connection');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect HubSpot? Existing exports will remain in HubSpot.')) {
      return;
    }

    try {
      setDisconnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/disconnect`, {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success) {
        apiCache.invalidate('hubspot:status');
        setStatus({ connected: false });
        toast.success('HubSpot disconnected');
      } else {
        throw new Error(data.error || 'Failed to disconnect');
      }
    } catch (err: any) {
      console.error('[HUBSPOT] Disconnect error:', err);
      toast.error(err.message || 'Failed to disconnect HubSpot');
    } finally {
      setDisconnecting(false);
    }
  }

  async function loadLogs() {
    try {
      setLogsLoading(true);
      const res = await authenticatedFetch(`${API_BASE}/export-logs`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error('[HUBSPOT] Load logs error:', err);
    } finally {
      setLogsLoading(false);
    }
  }

  function toggleLogs() {
    if (!showLogs && logs.length === 0) {
      loadLogs();
    }
    setShowLogs(!showLogs);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Card */}
      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* HubSpot Logo */}
            <div className="w-10 h-10 rounded-lg bg-[#FF7A59]/10 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 512 512" fill="none">
                <path d="M384.1 201.3V151c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3c-6.3-13.1-19.5-22.2-34.8-22.4h-1c-21.2.2-38.3 17.3-38.5 38.5v1c.2 15.3 9.3 28.5 22.4 34.8v50.3c-53.1 13.6-92.4 62.3-92.4 119.7 0 68.1 55.2 123.3 123.3 123.3 57.4 0 106.1-39.3 119.7-92.4h50.3c6.3 13.1 19.5 22.2 34.8 22.4h1c21.2-.2 38.3-17.3 38.5-38.5v-1c-.2-15.3-9.3-28.5-22.4-34.8v-50.3c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3zM260.6 399c-42.5 0-77-34.5-77-77s34.5-77 77-77 77 34.5 77 77-34.5 77-77 77z" fill="#FF7A59"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                HubSpot Integration
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                Export leads to HubSpot CRM as contacts and companies.
              </p>
            </div>
          </div>

          {/* Refresh button */}
          <button
            onClick={() => { apiCache.invalidate('hubspot:status'); checkStatus(); }}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="Refresh status"
          >
            <RefreshCw className={`w-4 h-4 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Connection Status */}
        {status?.connected ? (
          <div className="space-y-4">
            <div className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-[#1ED4A7]" />
                <div className="flex-1">
                  <p className="font-medium text-zinc-900 dark:text-white">HubSpot Connected</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                    {status.portal_id && (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        Portal: <span className="font-medium text-zinc-800 dark:text-zinc-200">{status.portal_id}</span>
                      </p>
                    )}
                    {status.user && (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        User: <span className="font-medium text-zinc-800 dark:text-zinc-200">{status.user}</span>
                      </p>
                    )}
                    {status.connected_at && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Connected {new Date(status.connected_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-700"
                >
                  {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                  Disconnect
                </button>
              </div>
            </div>

            {/* Permissions */}
            {status.scopes && status.scopes.length > 0 && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-medium">Permissions:</span>{' '}
                {status.scopes.map(s => s.replace('crm.objects.', '').replace('.', ' ')).join(', ')}
              </div>
            )}

            {/* How to use */}
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-white mb-2">How to export leads</h3>
              <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">1</span>
                  Open any lead's detail modal from the Leads table
                </li>
                <li className="flex items-start gap-2">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">2</span>
                  Click the <span className="font-medium text-[#FF7A59]">"Export to HubSpot"</span> button
                </li>
                <li className="flex items-start gap-2">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">3</span>
                  The contact + company will be created or updated in your HubSpot CRM
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {status?.error && (
              <div className="bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {status.error}
              </div>
            )}

            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-white mb-2">Connect your HubSpot account</h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-4">
                Link your HubSpot CRM to push leads directly from Contndr. We'll create contacts and companies
                with all available data, including email, phone, job title, and company details.
              </p>

              <div className="flex flex-wrap gap-2 mb-4">
                {['Contacts', 'Companies', 'Deals', 'Dedup check', 'Auto-association'].map(feature => (
                  <span
                    key={feature}
                    className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded text-xs"
                  >
                    {feature}
                  </span>
                ))}
              </div>

              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-white"
                style={{ backgroundColor: HUBSPOT_COLOR }}
              >
                {connecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting to HubSpot...
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="w-4 h-4" />
                    Connect HubSpot Account
                  </>
                )}
              </button>

              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-3 text-center">
                You'll be redirected to HubSpot to authorize Contndr. Your tokens are stored securely server-side.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Export Logs */}
      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <button
          onClick={toggleLogs}
          className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
        >
          <span className="text-sm font-medium text-zinc-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            Export Activity Log
          </span>
          {showLogs ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>

        {showLogs && (
          <div className="border-t border-zinc-200 dark:border-zinc-800">
            {logsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-sm text-zinc-500">
                No export activity yet
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                {logs.slice(0, 50).map((log, i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-3 text-xs">
                    {log.success ? (
                      <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7] shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">
                        {log.type.replace(/_/g, ' ')}
                      </span>
                      {log.action && (
                        <span className="text-zinc-500 ml-1">({log.action})</span>
                      )}
                      {log.email && (
                        <span className="text-zinc-400 ml-1 truncate block">{log.email}</span>
                      )}
                      {log.company_name && (
                        <span className="text-zinc-400 ml-1 truncate block">{log.company_name}</span>
                      )}
                      {log.error && (
                        <span className="text-zinc-500 ml-1 truncate block">{log.error}</span>
                      )}
                    </div>
                    <span className="text-zinc-400 whitespace-nowrap shrink-0">
                      {new Date(log.timestamp).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Setup Instructions */}
      {!status?.connected && (
        <div className="bg-zinc-100 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            HubSpot App Setup Required
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
            Before connecting, ensure your HubSpot Public OAuth app has the correct Redirect URI configured:
          </p>
          <code className="block text-[11px] bg-zinc-200 dark:bg-zinc-900/50 p-2 rounded font-mono text-zinc-800 dark:text-zinc-300 break-all">
            https://{projectId}.supabase.co/functions/v1/make-server-a8b2511f/hubspot/oauth/callback
          </code>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2">
            Go to your{' '}
            <a
              href="https://developers.hubspot.com/my-apps"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium hover:no-underline"
            >
              HubSpot Developer Portal
              <ExternalLink className="w-3 h-3 inline ml-0.5" />
            </a>{' '}
            &rarr; Your App &rarr; Auth tab &rarr; add the Redirect URI above.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Reusable Export Button for use in other components ──

interface ExportToHubSpotButtonProps {
  lead: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    job_title?: string;
    title?: string;
    company_name?: string;
    business_name?: string;
    domain?: string;
    website?: string;
    industry?: string;
    employee_count?: string | number;
    linkedin_url?: string;
    person_linkedin_url?: string;
    city?: string;
    state?: string;
    country?: string;
    description?: string;
  };
  compact?: boolean;
  className?: string;
}

export function ExportToHubSpotButton({ lead, compact = false, className = '' }: ExportToHubSpotButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    try {
      setExporting(true);
      setError(null);

      const res = await authenticatedFetch(`${API_BASE}/export/lead`, {
        method: 'POST',
        body: JSON.stringify({
          first_name: lead.first_name,
          last_name: lead.last_name,
          email: lead.email,
          phone: lead.phone,
          job_title: lead.job_title || lead.title,
          company_name: lead.company_name || lead.business_name,
          domain: lead.domain,
          website: lead.website,
          industry: lead.industry,
          employee_count: lead.employee_count,
          linkedin_url: lead.linkedin_url || lead.person_linkedin_url,
          city: lead.city,
          state: lead.state,
          country: lead.country,
          description: lead.description,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setExported(true);
        const actions = [];
        if (data.contact?.action && data.contact.action !== 'skipped') actions.push(`Contact ${data.contact.action}`);
        if (data.company?.action && data.company.action !== 'skipped') actions.push(`Company ${data.company.action}`);
        if (data.associated) actions.push('Associated');
        toast.success(`Exported to HubSpot: ${actions.join(', ') || 'Done'}`);
      } else if (res.status === 401) {
        setError('Not connected');
        toast.error('HubSpot not connected. Go to Settings > Integrations to connect.');
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (err: any) {
      console.error('[HUBSPOT] Export error:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to export to HubSpot');
    } finally {
      setExporting(false);
    }
  }

  if (compact) {
    return (
      <button
        onClick={handleExport}
        disabled={exporting}
        title={exported ? 'Exported to HubSpot' : error || 'Export to HubSpot'}
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
          exported
            ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
            : error
            ? 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            : 'bg-[#FF7A59]/10 text-[#FF7A59] hover:bg-[#FF7A59]/20'
        } disabled:opacity-50 ${className}`}
      >
        {exporting ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : exported ? (
          <CheckCircle className="w-3 h-3" />
        ) : (
          <svg width="12" height="12" viewBox="0 0 512 512" fill="currentColor">
            <path d="M384.1 201.3V151c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3c-6.3-13.1-19.5-22.2-34.8-22.4h-1c-21.2.2-38.3 17.3-38.5 38.5v1c.2 15.3 9.3 28.5 22.4 34.8v50.3c-53.1 13.6-92.4 62.3-92.4 119.7 0 68.1 55.2 123.3 123.3 123.3 57.4 0 106.1-39.3 119.7-92.4h50.3c6.3 13.1 19.5 22.2 34.8 22.4h1c21.2-.2 38.3-17.3 38.5-38.5v-1c-.2-15.3-9.3-28.5-22.4-34.8v-50.3c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3zM260.6 399c-42.5 0-77-34.5-77-77s34.5-77 77-77 77 34.5 77 77-34.5 77-77 77z"/>
          </svg>
        )}
        {!compact && (exported ? 'Exported' : 'HubSpot')}
      </button>
    );
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting || exported}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
        exported
          ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20'
          : error
          ? 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          : 'text-white hover:opacity-90 border border-transparent'
      } ${className}`}
      style={!exported && !error ? { backgroundColor: HUBSPOT_COLOR } : undefined}
    >
      {exporting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Exporting...
        </>
      ) : exported ? (
        <>
          <CheckCircle className="w-4 h-4" />
          Exported to HubSpot
        </>
      ) : error ? (
        <>
          <AlertCircle className="w-4 h-4" />
          Retry Export
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
            <path d="M384.1 201.3V151c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3c-6.3-13.1-19.5-22.2-34.8-22.4h-1c-21.2.2-38.3 17.3-38.5 38.5v1c.2 15.3 9.3 28.5 22.4 34.8v50.3c-53.1 13.6-92.4 62.3-92.4 119.7 0 68.1 55.2 123.3 123.3 123.3 57.4 0 106.1-39.3 119.7-92.4h50.3c6.3 13.1 19.5 22.2 34.8 22.4h1c21.2-.2 38.3-17.3 38.5-38.5v-1c-.2-15.3-9.3-28.5-22.4-34.8v-50.3c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3zM260.6 399c-42.5 0-77-34.5-77-77s34.5-77 77-77 77 34.5 77 77-34.5 77-77 77z"/>
          </svg>
          Export to HubSpot
        </>
      )}
    </button>
  );
}