import { useEffect, useState, useCallback, useRef } from 'react';
import { Send, MessageSquare, Loader2, RefreshCw, ArrowLeft, Facebook, Instagram } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';

interface Thread {
  thread_key: string;
  sender_id: string;
  page_id: string;
  channel: 'instagram_dm' | 'messenger';
  sender_name: string;
  latest_text: string;
  latest_at: string;
  latest_direction: 'inbound' | 'outbound';
  message_count: number;
  unread_count: number;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  page_id: string;
  sender_id?: string;
  sender_name?: string;
  text: string;
  received_at?: string;
  sent_at?: string;
}

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (!d) return '';
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
function fmtTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  if (channel === 'instagram_dm') return <Instagram className={className} />;
  return <Facebook className={className} />;
}

export function MetaInbox() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/meta/threads`, { headers });
      const d = await r.json();
      setThreads(d.threads || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load Meta inbox');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMessages = useCallback(async (senderId: string) => {
    setLoadingMessages(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/meta/threads/${encodeURIComponent(senderId)}`, { headers });
      const d = await r.json();
      setMessages(d.messages || []);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (selected) loadMessages(selected.sender_id); }, [selected, loadMessages]);

  async function sendReply() {
    if (!replyText.trim() || !selected || sending) return;
    setSending(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch(`${API_BASE}/meta/send`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: selected.page_id,
          sender_id: selected.sender_id,
          text: replyText.trim(),
          channel: selected.channel,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setReplyText('');
        setMessages((prev) => [...prev, {
          id: d.message_id || `tmp_${Date.now()}`,
          direction: 'outbound',
          channel: selected.channel,
          page_id: selected.page_id,
          sender_id: selected.sender_id,
          text: replyText.trim(),
          sent_at: new Date().toISOString(),
        }]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        loadThreads(true);
      } else {
        toast.error(d.error || 'Failed to send');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  if (selected) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-black">
        <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setSelected(null)} className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm text-zinc-900 dark:text-white truncate flex items-center gap-2">
              <ChannelIcon channel={selected.channel} className="w-3.5 h-3.5 text-zinc-500" />
              {selected.sender_name}
            </div>
            <div className="text-[11px] text-zinc-500 truncate">{selected.channel === 'instagram_dm' ? 'Instagram DM' : 'Messenger'}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {loadingMessages ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-xs text-zinc-500">No messages in this thread.</div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%] sm:max-w-[70%]">
                  <div className={`px-3 py-2 rounded-2xl text-[13px] leading-relaxed ${msg.direction === 'outbound' ? 'bg-zinc-900 dark:bg-white text-white dark:text-black rounded-br-md' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-bl-md'}`}>{msg.text}</div>
                  <div className={`text-[10px] text-zinc-500 mt-1 ${msg.direction === 'outbound' ? 'text-right' : ''}`}>{fmtTime(msg.received_at || msg.sent_at || '')}</div>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 bg-white dark:bg-black">
          <div className="flex items-end gap-2">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }}
              placeholder="Type a message…"
              rows={2}
              className="flex-1 resize-none px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
            <button onClick={sendReply} disabled={!replyText.trim() || sending} className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1.5">⌘ + Enter to send</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black">
      <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Facebook className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Meta</h2>
          {threads.length > 0 && <span className="text-xs text-zinc-500">· {threads.length}</span>}
        </div>
        <button onClick={() => loadThreads(true)} disabled={refreshing} className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
      ) : threads.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 px-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
            <Facebook className="w-5 h-5 text-zinc-400" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">No conversations yet</h3>
          <p className="text-xs text-zinc-500 max-w-xs">Connect a Meta page in Settings → Channels. Instagram DMs and Facebook Messenger conversations will land here.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900">
          {threads.map((t) => (
            <button key={t.thread_key} onClick={() => setSelected(t)} className="w-full px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex-shrink-0 relative">
                {(t.sender_name || '?').slice(0, 2).toUpperCase()}
                <ChannelIcon channel={t.channel} className="w-3 h-3 absolute -bottom-0.5 -right-0.5 text-zinc-500 bg-white dark:bg-black rounded-full p-0.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-sm text-zinc-900 dark:text-white truncate">{t.sender_name}</span>
                  {t.unread_count > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-black text-[10px] font-bold">{t.unread_count}</span>}
                  <span className="text-[10px] text-zinc-500 ml-auto flex-shrink-0">{fmtRelative(t.latest_at)}</span>
                </div>
                <p className="text-xs text-zinc-500 truncate">{t.latest_direction === 'outbound' ? 'You: ' : ''}{t.latest_text}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MetaInbox;
