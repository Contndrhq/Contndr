import { useState, useEffect } from 'react';
import { Facebook, Key, Loader2, AlertCircle, CheckCircle, Trash2, ExternalLink } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';
import { toast } from 'sonner';

interface ConnectedPage {
  page_id: string;
  page_name: string | null;
  channels: string[];
  connected_at: string;
}

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;
const WEBHOOK_URL = `${API_BASE}/webhooks/meta`;

export function MetaSettings() {
  const [pages, setPages] = useState<ConnectedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageId, setPageId] = useState('');
  const [pageName, setPageName] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [channelLeadAds, setChannelLeadAds] = useState(true);
  const [channelIgDm, setChannelIgDm] = useState(true);
  const [channelMessenger, setChannelMessenger] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPages() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/meta/pages`, { headers });
      if (r.ok) {
        const d = await r.json();
        setPages(d.pages || []);
      }
    } catch (e: any) {
      console.error('[Meta] load error:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPages(); }, []);

  async function connectPage() {
    if (!pageId.trim() || !pageAccessToken.trim()) return;
    setConnecting(true);
    setError(null);
    const channels: string[] = [];
    if (channelLeadAds) channels.push('lead_ads');
    if (channelIgDm) channels.push('instagram_dm');
    if (channelMessenger) channels.push('messenger');
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/meta/connect`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: pageId.trim(),
          page_name: pageName.trim() || null,
          access_token: pageAccessToken.trim(),
          channels,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setError(d.error || 'Failed to connect');
        return;
      }
      toast.success(`Connected ${pageName || pageId}`);
      setPageId('');
      setPageName('');
      setPageAccessToken('');
      loadPages();
    } catch (e: any) {
      setError(e?.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectPage(p: ConnectedPage) {
    if (!confirm(`Disconnect ${p.page_name || p.page_id}? Inbound events will stop until reconnected.`)) return;
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/meta/pages/${p.page_id}`, { method: 'DELETE', headers });
      if (r.ok) {
        toast.success('Disconnected');
        loadPages();
      } else {
        toast.error('Failed to disconnect');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to disconnect');
    }
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(WEBHOOK_URL);
      toast.success('Webhook URL copied');
    } catch {
      /* ignore */
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  const renderConnectForm = () => (
    <div className="bg-white dark:bg-black rounded-2xl border border-gray-200 dark:border-white/10 p-8 max-w-2xl">
      <div className="w-16 h-16 bg-gray-50 dark:bg-white/5 rounded-2xl flex items-center justify-center mb-6">
        <Facebook className="w-8 h-8 text-[#1ED4A7]" />
      </div>

      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {pages.length === 0 ? 'Connect a Meta page' : 'Add another page'}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Pull leads from Facebook/Instagram ads and route DMs to the Contndr inbox.
      </p>

      <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg p-4 mb-6 space-y-3">
        <p className="text-sm font-medium text-gray-900 dark:text-white">One-time setup in Meta Developer Dashboard</p>
        <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
          <li>Create a Meta App at <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-zinc-900 dark:text-white underline">developers.facebook.com</a></li>
          <li>Add the <strong>Webhooks</strong> product, set callback URL to:</li>
        </ol>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 rounded bg-white dark:bg-black border border-gray-200 dark:border-white/10 text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
            {WEBHOOK_URL}
          </code>
          <button
            onClick={copyWebhook}
            className="px-3 py-2 rounded bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black text-xs font-medium transition-colors"
          >
            Copy
          </button>
        </div>
        <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside" start={3}>
          <li>Set <strong>Verify Token</strong> = value of <code>META_VERIFY_TOKEN</code> secret you added to Supabase</li>
          <li>Subscribe to fields: <code>leadgen</code>, <code>messages</code>, <code>messaging_postbacks</code></li>
          <li>From your Page Settings → generate a Page Access Token, paste below</li>
        </ol>
      </div>

      {error && (
        <div className="bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-zinc-500 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Page ID</label>
            <input
              type="text"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="1234567890"
              className="w-full px-4 py-2.5 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] transition-all font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Page Name <span className="text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              placeholder="My Business"
              className="w-full px-4 py-2.5 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Page Access Token</label>
          <div className="relative">
            <input
              type="password"
              value={pageAccessToken}
              onChange={(e) => setPageAccessToken(e.target.value)}
              placeholder="EAAxxx..."
              className="w-full px-4 py-2.5 pl-10 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] transition-all font-mono"
            />
            <Key className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Channels to enable</p>
          <div className="space-y-1.5">
            {[
              { key: 'leadAds', label: 'Lead Ads (form submissions)', state: channelLeadAds, setter: setChannelLeadAds },
              { key: 'igDm', label: 'Instagram DMs', state: channelIgDm, setter: setChannelIgDm },
              { key: 'messenger', label: 'Facebook Messenger', state: channelMessenger, setter: setChannelMessenger },
            ].map((c) => (
              <label key={c.key} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.state}
                  onChange={(e) => c.setter(e.target.checked)}
                  className="rounded border-gray-300 dark:border-white/20 text-[#1ED4A7] focus:ring-[#1ED4A7]/20"
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={connectPage}
          disabled={connecting || !pageId.trim() || !pageAccessToken.trim()}
          className="w-full py-2.5 bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {connecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting…
            </>
          ) : (
            'Connect page'
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Connected pages */}
      {pages.length > 0 && (
        <div className="space-y-3">
          {pages.map((p) => (
            <div
              key={p.page_id}
              className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg p-4 flex items-start gap-3"
            >
              <CheckCircle className="w-5 h-5 text-[#1ED4A7] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {p.page_name || `Page ${p.page_id}`}
                    </p>
                    <p className="text-[13px] text-gray-700 dark:text-gray-300 mt-1 font-mono">{p.page_id}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.channels.map((ch) => (
                        <span
                          key={ch}
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800"
                        >
                          {ch === 'lead_ads' ? 'Lead Ads' : ch === 'instagram_dm' ? 'Instagram DM' : 'Messenger'}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      Connected {new Date(p.connected_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => disconnectPage(p)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title="Disconnect"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Connect form */}
      {renderConnectForm()}
    </div>
  );
}

export default MetaSettings;
