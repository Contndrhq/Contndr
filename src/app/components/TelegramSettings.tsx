import { useState, useEffect } from 'react';
import { Send, Key, Loader2, AlertCircle, CheckCircle, Trash2, ExternalLink } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';
import { toast } from 'sonner';

interface ConnectedBot {
  bot_id: string;
  bot_username: string;
  bot_name: string | null;
  bot_link: string;
  connected_at: string;
}

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

export function TelegramSettings() {
  const [bots, setBots] = useState<ConnectedBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [botToken, setBotToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBots() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/telegram/bots`, { headers });
      if (r.ok) {
        const d = await r.json();
        setBots(d.bots || []);
      }
    } catch (e: any) {
      console.error('[Telegram] load error:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBots(); }, []);

  async function connectBot() {
    if (!botToken.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/telegram/connect`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_token: botToken.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setError(d.error || 'Failed to connect');
        return;
      }
      toast.success(`Connected @${d.bot.bot_username}`);
      setBotToken('');
      loadBots();
    } catch (e: any) {
      setError(e?.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectBot(botId: string, username: string) {
    if (!confirm(`Disconnect @${username}? Inbound messages will stop until reconnected.`)) return;
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/telegram/bots/${botId}`, { method: 'DELETE', headers });
      if (r.ok) {
        toast.success('Disconnected');
        loadBots();
      } else {
        toast.error('Failed to disconnect');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to disconnect');
    }
  }

  if (loading) {
    return <LoadingSpinner center size="md" />;
  }

  // Connect form — always visible at the top
  const renderConnectForm = () => (
    <div className="bg-white dark:bg-black rounded-2xl border border-gray-200 dark:border-white/10 p-8 max-w-2xl">
      <div className="w-16 h-16 bg-gray-50 dark:bg-white/5 rounded-2xl flex items-center justify-center mb-6">
        <Send className="w-8 h-8 text-[#1ED4A7]" />
      </div>

      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {bots.length === 0 ? 'Connect a Telegram bot' : 'Add another bot'}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Anyone who messages your bot lands in the Contndr inbox alongside email + SMS.
        Your phone gets a push notification on every new message.
      </p>

      <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 mb-6 list-decimal list-inside">
        <li>Open Telegram and search <span className="font-mono text-gray-900 dark:text-white">@BotFather</span></li>
        <li>Send <span className="font-mono text-gray-900 dark:text-white">/newbot</span>, pick a name + handle (must end in <code>bot</code>)</li>
        <li>BotFather replies with a token like <code>123456:ABC-DEF...</code></li>
        <li>Paste the token below — we'll register the webhook automatically</li>
      </ol>

      {error && (
        <div className="bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-zinc-500 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Bot Token
          </label>
          <div className="relative">
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:ABC-DEF_ghi-jkl..."
              className="w-full px-4 py-2.5 pl-10 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] transition-all font-mono"
            />
            <Key className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
        </div>

        <button
          onClick={connectBot}
          disabled={connecting || !botToken.trim()}
          className="w-full py-2.5 bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {connecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting…
            </>
          ) : (
            'Connect bot'
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Connected bots */}
      {bots.length > 0 && (
        <div className="space-y-3">
          {bots.map((b) => (
            <div
              key={b.bot_id}
              className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg p-4 flex items-start gap-3"
            >
              <CheckCircle className="w-5 h-5 text-[#1ED4A7] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      @{b.bot_username}
                      {b.bot_name && <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">· {b.bot_name}</span>}
                    </p>
                    <p className="text-[13px] text-gray-700 dark:text-gray-300 mt-1">
                      Connected {new Date(b.connected_at).toLocaleDateString()}
                    </p>
                    <a
                      href={b.bot_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-zinc-900 dark:text-white underline hover:no-underline font-medium mt-2"
                    >
                      Open in Telegram <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <button
                    onClick={() => disconnectBot(b.bot_id, b.bot_username)}
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

export default TelegramSettings;
