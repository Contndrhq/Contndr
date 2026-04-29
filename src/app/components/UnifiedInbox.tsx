import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mail, RefreshCw, Send, Archive, Trash2, Search,
  ArrowLeft, ChevronRight, MessageSquare, Sparkles, Filter, X, Inbox,
  Forward, CornerUpLeft, Loader2, CheckCheck, Eye, MousePointerClick, Check,
  Brain, Zap, Clock, AlertTriangle, Crosshair, Thermometer, Snowflake,
  Copy, BarChart3, ExternalLink, ChevronDown, ChevronUp, PenSquare,
  Paperclip, FileText, Image as ImageIcon, File as FileIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { LoadingSpinner } from './LoadingSpinner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { fetchWithRetry } from '../lib/fetch-utils';
import { apiCache } from '../lib/api-cache';
import { useNavigate } from 'react-router';
import { useRealtimeContext, useRealtimeRefresh } from './RealtimeProvider';
import { IconButton } from './ui/icon-button';
import { LeadAvatar } from './LeadAvatar';
import { useDemoMode, DEMO_INBOX_THREADS, DEMO_INBOX_STATS } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { decodeHtmlEntities } from '../lib/html-decode';

// ─── Types (matching backend ConversationThread / EmailMessage) ──────────
interface EmailMessage {
  id: string;
  direction: 'sent' | 'received';
  from: string;
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  sentAt: string;
  read: boolean;
  status?: string;
  openedAt?: string | null;
  clickedAt?: string | null;
  deliveredAt?: string | null;
}

interface ConversationThread {
  threadId: string;
  leadId: string;
  campaignId: string;
  brand: string;
  leadName: string;
  leadEmail: string;
  avatarUrl?: string | null;
  avatar_url?: string | null;
  avatarConfidence?: number;
  avatar_confidence?: number;
  leadLinkedinUrl?: string | null;
  leadPhone?: string;
  leadCompany?: string;
  lastMessageAt: string;
  messageCount: number;
  unreadCount: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  status: 'active' | 'paused' | 'closed';
  tags: string[];
  messages: EmailMessage[];
}

interface InboxStats {
  totalConversations: number;
  unreadCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  interestedCount: number;
}

type FilterType = 'all' | 'unread' | 'positive' | 'negative' | 'sent';

interface ThreadEngagement {
  score: number;
  level: 'hot' | 'warm' | 'cold' | 'none';
  opens: number;
  clicks: number;
  replies: number;
  totalSent: number;
  delivered: number;
  bounced: number;
}

interface AIInsights {
  summary: string;
  intent: string;
  suggestedReply: string;
  bestTimeToReach: string;
  nextAction: string;
  risk: string;
}

interface ThreadInsights {
  engagement: ThreadEngagement;
  ai: AIInsights | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────
const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

function formatTimestamp(timestamp: string, t: (key: string, opts?: any) => string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 0) return t('inbox.scheduled');
  if (diffMins < 1) return t('inbox.justNow');
  if (diffMins < 60) return t('inbox.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('inbox.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('inbox.daysAgo', { count: diffDays });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}



/** Compute quick engagement stats from message-level tracking data (client-side fallback).
 *  Uses BOTH timestamp fields AND status — for Gmail/Outlook-sent emails, the self-hosted
 *  tracking pixel reliably updates the `status` column ('opened', 'clicked') but the
 *  timestamp columns (opened_at, clicked_at, delivered_at) may not exist in the DB schema.
 *  Status is always the ground truth. */
function computeThreadEngagement(messages: EmailMessage[]): { opens: number; clicks: number; delivered: number; bounced: number; totalSent: number } {
  const sent = messages.filter(m => m.direction === 'sent');
  return {
    opens: sent.filter(m => !!m.openedAt || m.status === 'opened' || m.status === 'clicked').length,
    clicks: sent.filter(m => !!m.clickedAt || m.status === 'clicked').length,
    delivered: sent.filter(m => !!m.deliveredAt || m.status === 'delivered' || m.status === 'opened' || m.status === 'clicked').length,
    bounced: sent.filter(m => m.status === 'bounced').length,
    totalSent: sent.length,
  };
}

function sentimentColor(s: string) {
  if (s === 'positive') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (s === 'negative') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
}

// Archived/deleted thread IDs persisted across sessions
function getHiddenThreadIds(): Set<string> {
  try {
    const stored = localStorage.getItem('contndr_hidden_threads');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch { return new Set(); }
}

function persistHiddenThreadId(threadId: string) {
  try {
    const ids = getHiddenThreadIds();
    ids.add(threadId);
    localStorage.setItem('contndr_hidden_threads', JSON.stringify([...ids]));
  } catch { /* noop */ }
}

function removeHiddenThreadId(threadId: string) {
  try {
    const ids = getHiddenThreadIds();
    ids.delete(threadId);
    localStorage.setItem('contndr_hidden_threads', JSON.stringify([...ids]));
  } catch { /* noop */ }
}

// ─── Demo data (legacy, no longer used as fallback) ──────────────────
function generateDemoThreads(): ConversationThread[] {
  const now = Date.now();
  return [
    {
      threadId: 'demo-1',
      leadId: 'd1',
      campaignId: 'c1',
      brand: 'Contndr',
      leadName: 'John Smith',
      leadEmail: 'john.smith@example.com',
      leadCompany: 'Acme Corp',
      lastMessageAt: new Date(now - 1000 * 60 * 15).toISOString(),
      messageCount: 3,
      unreadCount: 1,
      sentiment: 'positive',
      status: 'active',
      tags: ['Interested'],
      messages: [
        {
          id: 'm1',
          direction: 'sent',
          from: 'Me',
          to: 'john.smith@example.com',
          subject: 'Partnership Opportunity',
          body: 'Hi John,\n\nI came across Acme Corp and thought there might be a great partnership opportunity between our companies.\n\nWould you be open to a quick chat this week?',
          sentAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
          read: true,
          status: 'opened',
          openedAt: new Date(now - 1000 * 60 * 60 * 20).toISOString(),
          deliveredAt: new Date(now - 1000 * 60 * 60 * 23).toISOString(),
        },
        {
          id: 'm2',
          direction: 'received',
          from: 'john.smith@example.com',
          to: 'Me',
          subject: 'Re: Partnership Opportunity',
          body: 'Thanks for reaching out! I\'d love to discuss this further. How does Thursday at 2pm work for you?',
          sentAt: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
          read: false,
        },
        {
          id: 'm3',
          direction: 'sent',
          from: 'Me',
          to: 'john.smith@example.com',
          subject: 'Re: Partnership Opportunity',
          body: 'Thursday at 2pm works perfectly! I\'ll send over a calendar invite shortly.',
          sentAt: new Date(now - 1000 * 60 * 15).toISOString(),
          read: true,
          status: 'delivered',
          deliveredAt: new Date(now - 1000 * 60 * 14).toISOString(),
        },
      ],
    },
    {
      threadId: 'demo-2',
      leadId: 'd2',
      campaignId: 'c1',
      brand: 'Contndr',
      leadName: 'Sarah Johnson',
      leadEmail: 'sarah.johnson@company.com',
      leadCompany: 'TechCo',
      lastMessageAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
      messageCount: 2,
      unreadCount: 1,
      sentiment: 'neutral',
      status: 'active',
      tags: [],
      messages: [
        {
          id: 'm4',
          direction: 'sent',
          from: 'Me',
          to: 'sarah.johnson@company.com',
          subject: 'Quick question about your services',
          body: 'Hi Sarah,\n\nI wanted to reach out regarding your current outreach process...',
          sentAt: new Date(now - 1000 * 60 * 60 * 24 * 2).toISOString(),
          read: true,
          status: 'clicked',
          openedAt: new Date(now - 1000 * 60 * 60 * 10).toISOString(),
          clickedAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
          deliveredAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
        },
        {
          id: 'm5',
          direction: 'received',
          from: 'sarah.johnson@company.com',
          to: 'Me',
          subject: 'Re: Quick question about your services',
          body: 'Hi, I came across your website and I\'m interested in learning more about what you offer. Could you send over some pricing details?',
          sentAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
          read: false,
        },
      ],
    },
    {
      threadId: 'demo-3',
      leadId: 'd3',
      campaignId: 'c2',
      brand: 'Contndr',
      leadName: 'Michael Chen',
      leadEmail: 'michael@startup.io',
      leadCompany: 'FastGrow',
      lastMessageAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
      messageCount: 1,
      unreadCount: 0,
      sentiment: 'neutral',
      status: 'active',
      tags: [],
      messages: [
        {
          id: 'm6',
          direction: 'sent',
          from: 'Me',
          to: 'michael@startup.io',
          subject: 'Follow-up: Demo Request',
          body: 'Hi Michael,\n\nI wanted to follow up on my previous email about scheduling a demo. Are you still interested?',
          sentAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
          read: true,
          status: 'delivered',
          deliveredAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
        },
      ],
    },
    {
      threadId: 'demo-4',
      leadId: 'd4',
      campaignId: 'c1',
      brand: 'Contndr',
      leadName: 'David Lee',
      leadEmail: 'david.lee@bigcorp.com',
      leadCompany: 'BigCorp',
      lastMessageAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
      messageCount: 2,
      unreadCount: 0,
      sentiment: 'negative',
      status: 'closed',
      tags: ['Not interested'],
      messages: [
        {
          id: 'm7',
          direction: 'sent',
          from: 'Me',
          to: 'david.lee@bigcorp.com',
          subject: 'Pricing inquiry',
          body: 'Hi David,\n\nHere are the pricing details you requested...',
          sentAt: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
          read: true,
          status: 'opened',
          openedAt: new Date(now - 1000 * 60 * 60 * 30).toISOString(),
          deliveredAt: new Date(now - 1000 * 60 * 60 * 47).toISOString(),
        },
        {
          id: 'm8',
          direction: 'received',
          from: 'david.lee@bigcorp.com',
          to: 'Me',
          subject: 'Re: Pricing inquiry',
          body: 'Thanks for the info, but we\'ve decided to go with a different solution for now.',
          sentAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
          read: true,
        },
      ],
    },
    {
      threadId: 'demo-5',
      leadId: 'd5',
      campaignId: 'c3',
      brand: 'Contndr',
      leadName: 'Emily Rodriguez',
      leadEmail: 'emily@designstudio.co',
      leadCompany: 'Design Studio',
      lastMessageAt: new Date(now - 1000 * 60 * 60 * 36).toISOString(),
      messageCount: 4,
      unreadCount: 0,
      sentiment: 'positive',
      status: 'active',
      tags: ['Interested'],
      messages: [
        {
          id: 'm9',
          direction: 'sent',
          from: 'Me',
          to: 'emily@designstudio.co',
          subject: 'Collaboration Opportunity',
          body: 'Hi Emily,\n\nI love what Design Studio is doing...',
          sentAt: new Date(now - 1000 * 60 * 60 * 72).toISOString(),
          read: true,
          status: 'clicked',
          openedAt: new Date(now - 1000 * 60 * 60 * 65).toISOString(),
          clickedAt: new Date(now - 1000 * 60 * 60 * 62).toISOString(),
          deliveredAt: new Date(now - 1000 * 60 * 60 * 71).toISOString(),
        },
        {
          id: 'm10',
          direction: 'received',
          from: 'emily@designstudio.co',
          to: 'Me',
          subject: 'Re: Collaboration Opportunity',
          body: 'This sounds amazing! We\'d love to explore this.',
          sentAt: new Date(now - 1000 * 60 * 60 * 60).toISOString(),
          read: true,
        },
        {
          id: 'm11',
          direction: 'sent',
          from: 'Me',
          to: 'emily@designstudio.co',
          subject: 'Re: Collaboration Opportunity',
          body: 'Great! Let me send you a proposal by Friday.',
          sentAt: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
          read: true,
          status: 'opened',
          openedAt: new Date(now - 1000 * 60 * 60 * 40).toISOString(),
          deliveredAt: new Date(now - 1000 * 60 * 60 * 47).toISOString(),
        },
        {
          id: 'm12',
          direction: 'received',
          from: 'emily@designstudio.co',
          to: 'Me',
          subject: 'Re: Collaboration Opportunity',
          body: 'Looking forward to it!',
          sentAt: new Date(now - 1000 * 60 * 60 * 36).toISOString(),
          read: true,
        },
      ],
    },
  ];
}

// ─── Component ──────────────────────────────────────────────────────────
export function UnifiedInbox() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { emit: emitRealtime } = useRealtimeContext();
  // NOTE: 'inbox:reply_sent' removed — it was self-triggered by handleSendReply and
  // caused an immediate re-fetch that wiped the optimistic message before DB commit.
  const inboxRefreshKey = useRealtimeRefresh(['email:replied', 'inbox:new_message', 'campaign:completed']);
  const isDemoMode = useDemoMode();
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState<ConversationThread | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Reply composer state
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // Forward modal state
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [sendingForward, setSendingForward] = useState(false);
  const forwardInputRef = useRef<HTMLInputElement>(null);

  // CC/BCC state for reply composer
  const [showReplyCcBcc, setShowReplyCcBcc] = useState(false);
  const [replyCc, setReplyCc] = useState('');
  const [replyBcc, setReplyBcc] = useState('');

  // CC/BCC state for forward modal
  const [showForwardCcBcc, setShowForwardCcBcc] = useState(false);
  const [forwardCc, setForwardCc] = useState('');
  const [forwardBcc, setForwardBcc] = useState('');

  // New email compose state
  const [showNewCompose, setShowNewCompose] = useState(false);
  const [newComposeTo, setNewComposeTo] = useState('');
  const [newComposeSubject, setNewComposeSubject] = useState('');
  const [newComposeBody, setNewComposeBody] = useState('');
  const [newComposeCc, setNewComposeCc] = useState('');
  const [newComposeBcc, setNewComposeBcc] = useState('');
  const [showNewComposeCcBcc, setShowNewComposeCcBcc] = useState(false);
  const [sendingNewEmail, setSendingNewEmail] = useState(false);
  const [newComposeAttachments, setNewComposeAttachments] = useState<{ file: File; preview?: string }[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const newComposeRef = useRef<HTMLTextAreaElement>(null);

  // Hidden threads (archived/deleted)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(getHiddenThreadIds);

  // AI Insights state
  const [insights, setInsights] = useState<ThreadInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [showInsightsPanel, setShowInsightsPanel] = useState(false);
  const insightsCache = useRef<Record<string, ThreadInsights>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Email signature preview (fetched once)
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  useEffect(() => {
    if (isDemoMode) {
      setSignaturePreview('Best regards,\nDemo User | Sales Director\nE: demo@contndr.com\nP: +1-555-0123\nW: contndr.com');
      return;
    }
    (async () => {
      try {
        const headers = await getAuthHeaders();
        if (!headers.Authorization) return;
        const res = await fetch(`${API_BASE}/settings/signature`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.signature) {
          const s = data.signature;
          const lines: string[] = [];
          if (s.closing_line) lines.push(s.closing_line + ',');
          const parts: string[] = [];
          if (s.full_name) parts.push(s.full_name);
          if (s.title) parts.push(s.title);
          if (parts.length) lines.push(parts.join(' | '));
          if (s.email) lines.push('E: ' + s.email);
          if (s.phone) lines.push('P: ' + s.phone);
          if (s.website) lines.push('W: ' + s.website);
          if (lines.length > 0) setSignaturePreview(lines.join('\n'));
        }
      } catch (_) {}
    })();
  }, [isDemoMode]);

  // ── Scroll to bottom on new messages ──
  useEffect(() => {
    if (selectedThread && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedThread?.messages.length]);

  // ── Auto-focus reply textarea ──
  useEffect(() => {
    if (showComposer && replyRef.current) {
      replyRef.current.focus();
    }
  }, [showComposer]);

  // ── Auto-focus forward input ──
  useEffect(() => {
    if (showForwardModal && forwardInputRef.current) {
      forwardInputRef.current.focus();
    }
  }, [showForwardModal]);

  // ── Auto-focus new compose ──
  useEffect(() => {
    if (showNewCompose && newComposeRef.current) {
      newComposeRef.current.focus();
    }
  }, [showNewCompose]);

  // ── Fetch threads from backend (stale-while-revalidate via apiCache) ──
  const loadThreads = useCallback(async (force = false) => {
    if (isDemoMode) {
      setThreads(DEMO_INBOX_THREADS as ConversationThread[]);
      setLoading(false);
      return;
    }

    const cacheKey = `inbox:threads:v2:${filter}`;

    // ── Serve cached data immediately (zero-spinner on repeat visits) ──
    if (!force) {
      const cached = apiCache.get<{ threads: ConversationThread[] }>(cacheKey);
      if (cached) {
        setThreads(cached.data.threads || []);
        setLoading(false);
        if (!cached.isStale) return; // fresh — skip network hit entirely
        // stale — fall through to revalidate silently in background
      }
    }

    try {
      const hasCached = !!apiCache.get(cacheKey);
      if (!hasCached) setLoading(true); // only show spinner on true cold miss

      const headers = await getAuthHeaders();

      if (!headers.Authorization) {
        toast.error(t('inbox.signInToView'));
        setThreads([]);
        return;
      }

      const params = new URLSearchParams();
      if (filter === 'unread') params.set('unreadOnly', 'true');
      if (filter === 'positive') params.set('sentiment', 'positive');
      if (filter === 'negative') params.set('sentiment', 'negative');
      if (force) params.set('force', '1'); // bypass server-side KV cache too

      const res = await fetchWithRetry(
        `${API_BASE}/inbox?${params.toString()}`,
        { headers, timeout: 30000, retries: 2 }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[INBOX] Failed to load threads:', res.status, errText);
        throw new Error('Failed to load inbox');
      }

      const data = await res.json();
      const fetched = (data.threads || []) as ConversationThread[];

      // Cache the fresh result (20s stale, 2min expiry)
      apiCache.set(cacheKey, data, { staleTime: 20_000, cacheTime: 120_000 });

      // Merge: preserve optimistically-added sent messages that the server
      // may not have returned yet (DB replication lag / timing).
      setThreads(prev => {
        if (fetched.length === 0) return fetched;

        const fetchedMap = new Map(fetched.map(t => [t.threadId, t]));

        for (const oldThread of prev) {
          const serverThread = fetchedMap.get(oldThread.threadId);
          if (!serverThread) continue;

          const serverMsgIds = new Set(serverThread.messages.map(m => m.id));
          const optimisticMsgs = oldThread.messages.filter(
            m => m.direction === 'sent' && !serverMsgIds.has(m.id)
              && !m.id.startsWith('demo-')
          );

          if (optimisticMsgs.length > 0) {
            serverThread.messages = [...serverThread.messages, ...optimisticMsgs]
              .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
            serverThread.messageCount = serverThread.messages.length;
            const last = serverThread.messages[serverThread.messages.length - 1];
            if (last && new Date(last.sentAt) > new Date(serverThread.lastMessageAt)) {
              serverThread.lastMessageAt = last.sentAt;
            }
          }
        }

        return fetched;
      });

      // Also update selectedThread if it's currently open so it doesn't go stale
      setSelectedThread(prev => {
        if (!prev) return prev;
        const updated = fetched.find(t => t.threadId === prev.threadId);
        if (!updated) return prev;
        const serverIds = new Set(updated.messages.map(m => m.id));
        const extras = prev.messages.filter(
          m => m.direction === 'sent' && !serverIds.has(m.id) && !m.id.startsWith('demo-')
        );
        if (extras.length > 0) {
          updated.messages = [...updated.messages, ...extras]
            .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
          updated.messageCount = updated.messages.length;
        }
        return updated;
      });
    } catch (error) {
      console.error('[INBOX] Error loading threads:', error);
      // Only clear threads if we have no cached fallback
      const cached = apiCache.get<{ threads: ConversationThread[] }>(cacheKey);
      if (!cached) setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [filter, isDemoMode]);

  const loadStats = useCallback(async (force = false) => {
    if (isDemoMode) {
      setStats(DEMO_INBOX_STATS as InboxStats);
      return;
    }

    const cacheKey = 'inbox:stats';

    // Serve cached stats immediately
    if (!force) {
      const cached = apiCache.get<InboxStats>(cacheKey);
      if (cached) {
        setStats(cached.data);
        if (!cached.isStale) return;
      }
    }

    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;

      const res = await fetchWithRetry(
        `${API_BASE}/inbox/stats`,
        { headers, timeout: 20000, retries: 1 }
      );

      if (res.ok) {
        const data = await res.json();
        apiCache.set(cacheKey, data, { staleTime: 30_000, cacheTime: 180_000 });
        setStats(data);
      }
    } catch {
      // Stats are non-critical
    }
  }, [isDemoMode]);

  useEffect(() => {
    // Run threads + stats in parallel
    loadThreads();
    loadStats();
  }, [loadThreads, loadStats]);

  // ── Real-time sync: reload when events arrive from other tabs/users ──
  useEffect(() => {
    if (inboxRefreshKey > 0) {
      console.log('[INBOX] Real-time refresh triggered');
      // Invalidate client cache so real-time events always show fresh data
      apiCache.invalidate(`inbox:threads:v2:${filter}`);
      apiCache.invalidate('inbox:stats');
      loadThreads(true); // force=true → also bypasses server KV cache
      loadStats(true);
    }
  }, [inboxRefreshKey, loadThreads, loadStats, filter]);

  // ── Listen for compose-email events from other views (e.g. CRM) ──
  useEffect(() => {
    const handleComposeEmail = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.to) {
        setSelectedThread(null);
        setShowNewCompose(true);
        setNewComposeTo(detail.to);
        if (detail.name) {
          setNewComposeSubject(`Hi ${detail.name}`);
        }
        setTimeout(() => newComposeRef.current?.focus(), 150);
      }
    };
    window.addEventListener('compose-email', handleComposeEmail);
    return () => window.removeEventListener('compose-email', handleComposeEmail);
  }, []);

  // ── Mark thread as read ──
  const markAsRead = useCallback(async (threadId: string) => {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;
      await fetchWithRetry(
        `${API_BASE}/inbox/conversations/${encodeURIComponent(threadId)}/read`,
        { headers, method: 'POST', timeout: 10000, retries: 1 }
      );
    } catch (err) {
      console.error('[INBOX] Mark as read failed:', err);
    }
  }, []);

  // ── Fetch AI insights for a thread ──
  const loadInsights = useCallback(async (threadId: string) => {
    // Check cache first
    if (insightsCache.current[threadId]) {
      setInsights(insightsCache.current[threadId]);
      return;
    }
    setLoadingInsights(true);
    setInsights(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        setInsights(null);
        return;
      }
      const res = await fetchWithRetry(
        `${API_BASE}/inbox/conversations/${encodeURIComponent(threadId)}/insights`,
        { headers, method: 'POST', timeout: 30000, retries: 1 }
      );
      if (res.ok) {
        const data = await res.json();
        setInsights(data);
        insightsCache.current[threadId] = data;
      } else {
        const errBody = await res.text().catch(() => '');
        console.error('[INBOX] Insights fetch failed:', res.status, errBody);
      }
    } catch (err) {
      console.error('[INBOX] Insights error:', err);
    } finally {
      setLoadingInsights(false);
    }
  }, []);

  // ── Select thread ──
  const handleSelectThread = useCallback((thread: ConversationThread) => {
    setSelectedThread(thread);
    setShowComposer(false);
    setShowNewCompose(false);
    setReplyText('');
    setReplyCc('');
    setReplyBcc('');
    setShowReplyCcBcc(false);
    setShowForwardModal(false);
    setForwardCc('');
    setForwardBcc('');
    setShowForwardCcBcc(false);
    setShowInsightsPanel(false);
    setInsights(null);

    // Optimistic: mark unread count to 0 in local state
    if (thread.unreadCount > 0) {
      setThreads(prev =>
        prev.map(t =>
          t.threadId === thread.threadId
            ? { ...t, unreadCount: 0, messages: t.messages.map(m => ({ ...m, read: true })) }
            : t
        )
      );
      markAsRead(thread.threadId);
    }
  }, [markAsRead]);

  // ── Actions ──
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Invalidate client-side caches so we always get fresh data
      apiCache.invalidate('inbox:threads:v2:all');
      apiCache.invalidate(`inbox:threads:v2:${filter}`);
      apiCache.invalidate('inbox:stats');

      // First trigger a background sync to pull new emails from provider
      const headers = await getAuthHeaders();
      if (headers.Authorization) {
        try {
          await fetchWithRetry(
            `${API_BASE}/sync/inbox`,
            { headers, timeout: 60000, retries: 1, method: 'POST', body: JSON.stringify({ force: true }) }
          );
        } catch {
          // Sync failure is non-fatal — still refresh local data
        }
      }
      // Then force-refresh from backend (bypasses server-side KV cache too)
      await loadThreads(true);
      await loadStats(true);
      toast.success(t('inbox.inboxRefreshed'));
    } catch {
      toast.error(t('inbox.failedRefresh'));
    } finally {
      setRefreshing(false);
    }
  };

  // ── Reply ──
  const handleSendReply = async () => {
    if (!selectedThread || !replyText.trim()) return;

    if (isDemoMode) {
      // Simulate reply in demo mode
      const newMsg: EmailMessage = {
        id: `demo-reply-${Date.now()}`,
        direction: 'sent',
        from: 'alex@contndr.com',
        to: selectedThread.leadEmail,
        subject: `Re: ${selectedThread.messages[0]?.subject || ''}`,
        body: replyText.trim(),
        sentAt: new Date().toISOString(),
        read: true,
        status: 'delivered',
        deliveredAt: new Date().toISOString(),
      };
      const updated = { ...selectedThread, messages: [...selectedThread.messages, newMsg], messageCount: selectedThread.messageCount + 1 };
      setSelectedThread(updated);
      setThreads(prev => prev.map(t => t.threadId === updated.threadId ? updated : t));
      setReplyText('');
      setShowComposer(false);
      toast.success(t('inbox.replySentDemo'));
      return;
    }

    const threadId = selectedThread.threadId;
    const body = replyText.trim();

    setSendingReply(true);

    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        toast.error(t('inbox.signInToReply'));
        return;
      }

      // Parse CC/BCC into arrays (comma-separated)
      const ccList = replyCc.trim() ? replyCc.split(',').map(e => e.trim()).filter(Boolean) : undefined;
      const bccList = replyBcc.trim() ? replyBcc.split(',').map(e => e.trim()).filter(Boolean) : undefined;

      const res = await fetchWithRetry(
        `${API_BASE}/inbox/conversations/${encodeURIComponent(threadId)}/reply`,
        {
          headers,
          method: 'POST',
          body: JSON.stringify({ body, cc: ccList, bcc: bccList }),
          timeout: 30000,
          retries: 1,
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[INBOX] Reply failed:', res.status, errData);
        throw new Error(errData.error || 'Failed to send reply');
      }

      const data = await res.json();

      if (data.success && data.message) {
        // Append the sent message to the thread
        const newMsg: EmailMessage = {
          id: data.message.id,
          direction: 'sent',
          from: data.message.from || 'Me',
          to: data.message.to || selectedThread.leadEmail,
          subject: data.message.subject || '',
          body: data.message.body || body,
          sentAt: data.message.sentAt || new Date().toISOString(),
          read: true,
        };

        setThreads(prev =>
          prev.map(t =>
            t.threadId === threadId
              ? {
                  ...t,
                  messages: [...t.messages, newMsg],
                  messageCount: t.messageCount + 1,
                  lastMessageAt: newMsg.sentAt,
                }
              : t
          )
        );

        // Update selected thread
        setSelectedThread(prev =>
          prev && prev.threadId === threadId
            ? {
                ...prev,
                messages: [...prev.messages, newMsg],
                messageCount: prev.messageCount + 1,
                lastMessageAt: newMsg.sentAt,
              }
            : prev
        );

        setReplyText('');
        setReplyCc('');
        setReplyBcc('');
        setShowReplyCcBcc(false);
        setShowComposer(false);
        toast.success(t('inbox.replySentTo', { name: selectedThread.leadName }));
        // Emit for other tabs but don't self-trigger a re-fetch (removed from refresh list).
        // Delayed refresh to let the DB commit complete before re-fetching.
        emitRealtime('inbox:reply_sent', { leadName: selectedThread.leadName, threadId: selectedThread.threadId });
        setTimeout(() => { loadThreads(); loadStats(); }, 2000);
      }
    } catch (error: any) {
      console.error('[INBOX] Error sending reply:', error);
      toast.error(error.message || t('inbox.failedRefresh'));
    } finally {
      setSendingReply(false);
    }
  };

  // ── Forward ──
  const handleSendForward = async () => {
    if (!selectedThread || !forwardTo.trim()) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(forwardTo.trim())) {
      toast.error(t('inbox.invalidEmail'));
      return;
    }

    setSendingForward(true);

    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        toast.error(t('inbox.signInToForward'));
        return;
      }

      // Build forwarded content from the entire thread
      const forwardedBody = buildForwardBody(selectedThread, forwardNote.trim());
      const lastMsg = selectedThread.messages[selectedThread.messages.length - 1];
      const fwdSubject = lastMsg?.subject
        ? (lastMsg.subject.startsWith('Fwd:') ? lastMsg.subject : `Fwd: ${lastMsg.subject}`)
        : 'Fwd: (no subject)';

      // Parse CC/BCC for forward
      const fwdCcList = forwardCc.trim() ? forwardCc.split(',').map(e => e.trim()).filter(Boolean) : undefined;
      const fwdBccList = forwardBcc.trim() ? forwardBcc.split(',').map(e => e.trim()).filter(Boolean) : undefined;

      const res = await fetchWithRetry(
        `${API_BASE}/emails/send`,
        {
          headers,
          method: 'POST',
          body: JSON.stringify({
            to_email: forwardTo.trim(),
            subject: fwdSubject,
            text_body: forwardedBody,
            html_body: `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #333;">${forwardedBody.replace(/\n/g, '<br>')}</div>`,
            lead_id: selectedThread.leadId,
            campaign_id: selectedThread.campaignId || null,
            cc: fwdCcList,
            bcc: fwdBccList,
          }),
          timeout: 30000,
          retries: 1,
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[INBOX] Forward failed:', res.status, errData);
        throw new Error(errData.error || 'Failed to forward message');
      }

      setForwardTo('');
      setForwardNote('');
      setForwardCc('');
      setForwardBcc('');
      setShowForwardCcBcc(false);
      setShowForwardModal(false);
      toast.success(t('inbox.forwardedTo', { email: forwardTo.trim() }));
    } catch (error: any) {
      console.error('[INBOX] Error forwarding:', error);
      toast.error(error.message || t('inbox.failedRefresh'));
    } finally {
      setSendingForward(false);
    }
  };

  // ── Build forward body ──
  function buildForwardBody(thread: ConversationThread, note: string): string {
    let body = '';
    if (note) {
      body += `${note}\n\n`;
    }
    body += `---------- ${t('inbox.forwardedConversationHeader')} ----------\n`;
    body += `From: ${thread.leadName} <${thread.leadEmail}>\n`;
    if (thread.leadCompany) body += `${t('inbox.companyLabel')}: ${thread.leadCompany}\n`;
    body += `${t('inbox.threadLabel')}: ${thread.messageCount} ${t('inbox.messageWord', { count: thread.messageCount })}\n`;
    body += '-------------------------------------------\n\n';

    for (const msg of thread.messages) {
      const date = new Date(msg.sentAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
      body += `[${msg.direction === 'sent' ? t('inbox.sentDirection') : t('inbox.receivedDirection')}] ${date}\n`;
      if (msg.subject) body += `${t('inbox.subjectLabel')}: ${msg.subject}\n`;
      body += `${msg.body}\n\n`;
    }

    return body;
  }

  // ── Send new email (compose) ──
  const handleSendNewEmail = async () => {
    const to = newComposeTo.trim();
    const subject = newComposeSubject.trim();
    const body = newComposeBody.trim();
    if (!to || !subject || !body) {
      toast.error(t('inbox.fillRequired'));
      return;
    }
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error(t('inbox.invalidEmail'));
      return;
    }

    if (isDemoMode) {
      toast.success(t('inbox.emailSentDemo', { email: to }));
      resetNewCompose();
      return;
    }

    setSendingNewEmail(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { toast.error(t('inbox.signInRequired')); return; }

      const ccList = newComposeCc.trim() ? newComposeCc.split(',').map(e => e.trim()).filter(Boolean) : undefined;
      const bccList = newComposeBcc.trim() ? newComposeBcc.split(',').map(e => e.trim()).filter(Boolean) : undefined;

      // Convert attachments to base64 for the API
      let attachments: { filename: string; content: string }[] | undefined;
      if (newComposeAttachments.length > 0) {
        attachments = await Promise.all(
          newComposeAttachments.map(async ({ file }) => {
            const arrayBuf = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuf);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return { filename: file.name, content: btoa(binary) };
          })
        );
      }

      const res = await fetchWithRetry(
        `${API_BASE}/emails/send`,
        {
          headers,
          method: 'POST',
          body: JSON.stringify({
            to_email: to,
            subject,
            text_body: body,
            campaign_id: 'manual',
            cc: ccList,
            bcc: bccList,
            attachments,
          }),
          timeout: 60000,
          retries: 1,
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[INBOX] New email send failed:', res.status, errData);
        throw new Error(errData.error || 'Failed to send email');
      }

      toast.success(t('inbox.emailSentTo', { email: to }));
      emitRealtime('email:sent', { to, subject });
      resetNewCompose();
      // Refresh inbox to pick up the new thread
      setTimeout(() => handleRefresh(), 1500);
    } catch (error: any) {
      console.error('[INBOX] Error sending new email:', error);
      toast.error(error.message || t('inbox.failedRefresh'));
    } finally {
      setSendingNewEmail(false);
    }
  };

  const resetNewCompose = () => {
    setShowNewCompose(false);
    setNewComposeTo('');
    setNewComposeSubject('');
    setNewComposeBody('');
    setNewComposeCc('');
    setNewComposeBcc('');
    setShowNewComposeCcBcc(false);
    // Revoke preview URLs and clear attachments
    newComposeAttachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview); });
    setNewComposeAttachments([]);
  };

  // ── Attachment helpers ──
  const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB per file
  const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MB total

  const handleAddAttachments = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const currentTotal = newComposeAttachments.reduce((sum, a) => sum + a.file.size, 0);
    const newFiles: { file: File; preview?: string }[] = [];
    let addedSize = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(t('inbox.fileTooLarge', { name: file.name }));
        continue;
      }
      if (currentTotal + addedSize + file.size > MAX_TOTAL_SIZE) {
        toast.error(t('inbox.totalTooLarge'));
        break;
      }
      // Duplicate check
      if (newComposeAttachments.some(a => a.file.name === file.name && a.file.size === file.size)) continue;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      newFiles.push({ file, preview });
      addedSize += file.size;
    }
    if (newFiles.length > 0) {
      setNewComposeAttachments(prev => [...prev, ...newFiles]);
    }
    // Reset file input so re-selecting the same file works
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  const handleRemoveAttachment = (index: number) => {
    setNewComposeAttachments(prev => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return ImageIcon;
    if (type.includes('pdf') || type.includes('document') || type.includes('text')) return FileText;
    return FileIcon;
  };

  // ── Archive ──
  const handleArchive = (threadId: string) => {
    const thread = threads.find(t => t.threadId === threadId);
    setThreads(prev => prev.filter(t => t.threadId !== threadId));
    if (selectedThread?.threadId === threadId) {
      setSelectedThread(null);
      setShowComposer(false);
    }
    persistHiddenThreadId(threadId);
    setHiddenIds(prev => new Set([...prev, threadId]));

    toast.success(t('inbox.conversationArchived'), {
      action: {
        label: t('inbox.undo'),
        onClick: () => {
          if (thread) {
            setThreads(prev => {
              const restored = [thread, ...prev].sort(
                (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
              );
              return restored;
            });
          }
          removeHiddenThreadId(threadId);
          setHiddenIds(prev => {
            const next = new Set(prev);
            next.delete(threadId);
            return next;
          });
        },
      },
    });
  };

  // ── Delete ──
  const handleDelete = (threadId: string) => {
    const thread = threads.find(t => t.threadId === threadId);
    setThreads(prev => prev.filter(t => t.threadId !== threadId));
    if (selectedThread?.threadId === threadId) {
      setSelectedThread(null);
      setShowComposer(false);
    }
    persistHiddenThreadId(threadId);
    setHiddenIds(prev => new Set([...prev, threadId]));

    toast.success(t('inbox.conversationDeleted'), {
      action: {
        label: t('inbox.undo'),
        onClick: () => {
          if (thread) {
            setThreads(prev => {
              const restored = [thread, ...prev].sort(
                (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
              );
              return restored;
            });
          }
          removeHiddenThreadId(threadId);
          setHiddenIds(prev => {
            const next = new Set(prev);
            next.delete(threadId);
            return next;
          });
        },
      },
    });
  };

  // ── Filtering ──
  const filteredThreads = threads
    .filter(t => !hiddenIds.has(t.threadId))
    .filter((thread) => {
      if (filter === 'unread' && thread.unreadCount === 0) return false;
      if (filter === 'positive' && thread.sentiment !== 'positive') return false;
      if (filter === 'negative' && thread.sentiment !== 'negative') return false;
      if (filter === 'sent' && thread.messages.every((m) => m.direction !== 'sent')) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          thread.leadName.toLowerCase().includes(q) ||
          thread.leadEmail.toLowerCase().includes(q) ||
          (thread.leadCompany?.toLowerCase().includes(q) ?? false) ||
          thread.messages.some((m) => m.subject.toLowerCase().includes(q))
        );
      }
      return true;
    });

  const unreadTotal = threads.reduce((s, t) => s + t.unreadCount, 0);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <LoadingSpinner size="lg" text={t('inbox.loadingInboxMsg')} />
      </div>
    );
  }

  // ── Keyboard shortcut for reply ──
  const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !sendingReply) {
      e.preventDefault();
      handleSendReply();
    }
    if (e.key === 'Escape') {
      setShowComposer(false);
      setReplyText('');
    }
  };

  return (
    <div className="flex h-full bg-[var(--bg-page)]">
      {/* ─── Thread List (left panel / full-width on mobile) ─── */}
      <div
        className={`
          w-full lg:w-96 lg:min-w-[24rem] lg:max-w-[24rem] lg:flex lg:flex-col
          border-r-0 lg:border-r border-zinc-200 dark:border-white/[0.06]
          ${selectedThread || showNewCompose ? 'hidden lg:flex' : 'flex flex-col'}
        `}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-[var(--bg-page)] border-b border-zinc-200 dark:border-white/[0.06]">
          <div className="p-4 pb-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                <Mail className="w-5 h-5 text-emerald-500" />
                {t('inbox.title')}
                {unreadTotal > 0 && (
                  <span className="ml-1 bg-emerald-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {unreadTotal}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setSelectedThread(null);
                    setShowComposer(false);
                    setShowNewCompose(true);
                  }}
                  className="p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors text-emerald-600 dark:text-emerald-400"
                  title={t('inbox.composeNewEmail')}
                >
                  <PenSquare className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
                  title={t('inbox.syncRefresh')}
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setShowFilters((p) => !p)}
                  className={`p-2 rounded-lg transition-colors ${
                    showFilters || filter !== 'all'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500'
                  }`}
                  title={t('inbox.filtersLabel')}
                >
                  <Filter className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder={t('inbox.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Filters row */}
          {showFilters && (
            <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
              {(
                [
                  { key: 'all', label: t('common.all') },
                  { key: 'unread', label: t('inbox.unread') },
                  { key: 'positive', label: t('inbox.positive') },
                  { key: 'negative', label: t('inbox.negative') },
                  { key: 'sent', label: t('inbox.sentOnly', 'Sent Only') },
                ] as { key: FilterType; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filter === key
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Stats bar */}
          {stats && (
            <div className="px-4 pb-2 flex gap-3 text-[11px] text-zinc-500 dark:text-zinc-500">
              <span>{stats.totalConversations} {t('inbox.threads', 'threads')}</span>
              <span className="text-zinc-300 dark:text-zinc-700">|</span>
              <span>{stats.unreadCount} {t('inbox.unreadLabel', 'unread')}</span>
              {stats.interestedCount > 0 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">|</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{stats.interestedCount} {t('inbox.interested', 'interested')}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Thread list */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[var(--bg-surface)] dark:bg-[var(--bg-page)]">
          {filteredThreads.length === 0 ? (
            <div className="p-8 text-center">
              <Inbox className="w-12 h-12 mx-auto mb-3 text-zinc-300 dark:text-zinc-700" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">
                {searchQuery ? t('common.noResults') : filter !== 'all' ? t('inbox.noMatching', 'No matching conversations') : t('inbox.empty', 'Your inbox is empty')}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">
                {searchQuery ? t('inbox.tryDifferent', 'Try a different search term') : t('inbox.conversationsAppear', 'Conversations will appear here when leads reply')}
              </p>
            </div>
          ) : (
            <div>
              {filteredThreads.map((thread) => {
                const lastMsg = thread.messages[thread.messages.length - 1];
                const isSelected = selectedThread?.threadId === thread.threadId;
                const threadEng = computeThreadEngagement(thread.messages);
                const hasUnread = thread.unreadCount > 0;

                return (
                  <button
                    key={thread.threadId}
                    onClick={() => handleSelectThread(thread)}
                    className={`w-full text-left px-4 py-3.5 border-b border-zinc-100 dark:border-white/[0.04] transition-colors relative
                      ${isSelected ? 'bg-zinc-50 dark:bg-white/[0.04]' : 'hover:bg-zinc-50/70 dark:hover:bg-white/[0.03]'}
                      ${hasUnread ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : ''}
                    `}
                  >
                    {/* Unread indicator bar */}
                    {hasUnread && (
                      <div className="absolute left-0 top-3 bottom-3 w-0.5 bg-emerald-500 rounded-r" />
                    )}

                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <LeadAvatar
                        name={thread.leadName}
                        email={thread.leadEmail}
                        linkedinUrl={thread.leadLinkedinUrl || undefined}
                        avatarUrl={thread.avatarUrl || thread.avatar_url}
                        avatarConfidence={thread.avatarConfidence ?? thread.avatar_confidence}
                        lookup={false}
                        size={40}
                      />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p
                            className={`text-sm truncate pr-2 ${
                              hasUnread
                                ? 'font-semibold text-zinc-900 dark:text-white'
                                : 'font-medium text-zinc-700 dark:text-zinc-300'
                            }`}
                          >
                            {thread.leadName}
                          </p>
                          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 whitespace-nowrap shrink-0">
                            {formatTimestamp(thread.lastMessageAt, t)}
                          </span>
                        </div>

                        {thread.leadCompany && (
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate -mt-0.5 mb-0.5">
                            {thread.leadCompany}
                          </p>
                        )}

                        <p
                          className={`text-sm truncate ${
                            hasUnread ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {lastMsg?.subject || t('inbox.noSubject')}
                        </p>

                        <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                          {lastMsg?.direction === 'sent' ? t('inbox.youPrefix') : ''}
                          {lastMsg?.body?.substring(0, 80) || ''}
                        </p>

                        {/* Tags + engagement row */}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          {thread.sentiment !== 'neutral' && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sentimentColor(thread.sentiment)}`}>
                              {thread.sentiment}
                            </span>
                          )}
                          {thread.tags.length > 0 &&
                            thread.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                              >
                                {tag}
                              </span>
                            ))}
                          {/* Engagement micro-icons */}
                          <div className="flex items-center gap-1 ml-auto">
                            {threadEng.opens > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400" title={`${threadEng.opens} opened`}>
                                <Eye className="w-3 h-3" />
                                {threadEng.opens}
                              </span>
                            )}
                            {threadEng.clicks > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400" title={`${threadEng.clicks} clicked`}>
                                <MousePointerClick className="w-3 h-3" />
                                {threadEng.clicks}
                              </span>
                            )}
                            {threadEng.bounced > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] text-red-500" title={`${threadEng.bounced} bounced`}>
                                <AlertTriangle className="w-3 h-3" />
                              </span>
                            )}
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
                              {thread.messageCount} msg{thread.messageCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Chevron on mobile */}
                      <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0 mt-3 lg:hidden" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Thread Detail (right panel / full-screen on mobile) ─── */}
      <div
        className={`
          flex-1 flex flex-col min-w-0
          ${selectedThread || showNewCompose ? 'flex' : 'hidden lg:flex'}
        `}
      >
        {selectedThread ? (
          <>
            {/* Detail header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-[var(--bg-page)] border-b border-zinc-200 dark:border-white/[0.06] px-4 lg:px-6 py-3">
              <div className="flex items-center gap-3">
                {/* Back button (mobile only) */}
                <button
                  onClick={() => {
                    setSelectedThread(null);
                    setShowComposer(false);
                    setShowForwardModal(false);
                  }}
                  className="lg:hidden p-1.5 -ml-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                >
                  <ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                </button>

                {/* Avatar */}
                <LeadAvatar
                  name={selectedThread.leadName}
                  email={selectedThread.leadEmail}
                  linkedinUrl={selectedThread.leadLinkedinUrl || undefined}
                  avatarUrl={selectedThread.avatarUrl || selectedThread.avatar_url}
                  avatarConfidence={selectedThread.avatarConfidence ?? selectedThread.avatar_confidence}
                  lookup={false}
                  size={36}
                />

                {/* Name / email */}
                <div className="flex-1 min-w-0 overflow-hidden">
                  {selectedThread.leadId ? (
                    <button
                      onClick={() => navigate(`/app/crm?lead=${selectedThread.leadId}`)}
                      className="text-left group w-full min-w-0"
                      title="Open contact in CRM"
                    >
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        {selectedThread.leadName}
                        <ExternalLink className="w-3 h-3 inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity -translate-y-px" />
                      </p>
                    </button>
                  ) : (
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                      {selectedThread.leadName}
                    </p>
                  )}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {selectedThread.leadEmail}
                    {selectedThread.leadCompany ? ` \u00b7 ${selectedThread.leadCompany}` : ''}
                  </p>
                </div>

                {/* Actions — CRM link hidden on mobile since name already links there */}
                <div className="flex items-center gap-0.5 shrink-0 -mr-1">
                  {selectedThread.leadId && (
                    <IconButton
                      onClick={() => navigate(`/app/crm?lead=${selectedThread.leadId}`)}
                      className="hidden sm:inline-flex"
                      title="Open in CRM"
                      aria-label="Open in CRM"
                    >
                      <ExternalLink />
                    </IconButton>
                  )}
                  <IconButton
                    onClick={() => {
                      setShowInsightsPanel(p => !p);
                      if (!insights && !loadingInsights) loadInsights(selectedThread.threadId);
                    }}
                    className={showInsightsPanel ? 'bg-zinc-100 dark:bg-white/[0.08] text-zinc-900 dark:text-white' : ''}
                    title="AI Insights & Engagement"
                    aria-label="AI Insights"
                  >
                    <Brain />
                  </IconButton>
                  <IconButton
                    onClick={() => handleArchive(selectedThread.threadId)}
                    title="Archive"
                    aria-label="Archive"
                  >
                    <Archive />
                  </IconButton>
                  <IconButton
                    onClick={() => handleDelete(selectedThread.threadId)}
                    className="hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </div>

              {/* ── Engagement summary bar (always visible, compact) ── */}
              {(() => {
                const eng = computeThreadEngagement(selectedThread.messages);
                const hasSent = eng.totalSent > 0;
                if (!hasSent) return null;
                return (
                  <div className="flex items-center gap-3 px-4 lg:px-6 pt-2 pb-1.5">
                    <div className="flex items-center gap-3 text-[11px] flex-wrap">
                      <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                        <Send className="w-3 h-3" />
                        {t('inbox.sentEngagement', { count: eng.totalSent })}
                      </span>
                      {eng.delivered > 0 && (
                        <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                          <CheckCheck className="w-3 h-3" />
                          {t('inbox.deliveredEngagement', { count: eng.delivered })}
                        </span>
                      )}
                      {eng.opens > 0 && (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <Eye className="w-3 h-3" />
                          {t('inbox.openedEngagement', { count: eng.opens })}
                        </span>
                      )}
                      {eng.clicks > 0 && (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <MousePointerClick className="w-3 h-3" />
                          {t('inbox.clickedEngagement', { count: eng.clicks })}
                        </span>
                      )}
                      {eng.bounced > 0 && (
                        <span className="flex items-center gap-1 text-red-500 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          {t('inbox.bouncedEngagement', { count: eng.bounced })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── AI Insights Panel (collapsible) ── */}
            {showInsightsPanel && (
              <div className="border-b border-zinc-200 dark:border-white/[0.06] bg-zinc-50/80 dark:bg-white/[0.02] px-4 lg:px-6 py-3">
                {loadingInsights ? (
                  <div className="flex items-center justify-center py-6 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('inbox.analyzingConversation')}</span>
                  </div>
                ) : insights ? (
                  <div className="space-y-3">
                    {/* Engagement score */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {insights.engagement.level === 'hot' && <Crosshair className="w-4 h-4 text-[#1ED4A7]" />}
                        {insights.engagement.level === 'warm' && <Thermometer className="w-4 h-4 text-amber-500" />}
                        {insights.engagement.level === 'cold' && <Snowflake className="w-4 h-4 text-blue-400" />}
                        {insights.engagement.level === 'none' && <BarChart3 className="w-4 h-4 text-zinc-400" />}
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {t('inbox.engagementScore', { score: insights.engagement.score })}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                          insights.engagement.level === 'hot' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                          : insights.engagement.level === 'warm' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : insights.engagement.level === 'cold' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}>
                          {t(`inbox.engagement${insights.engagement.level.charAt(0).toUpperCase() + insights.engagement.level.slice(1)}`)}
                        </span>
                      </div>
                      {/* Score bar */}
                      <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden max-w-[120px]">
                        <div
                          className={`h-full rounded-full transition-all ${
                            insights.engagement.level === 'hot' ? 'bg-[#1ED4A7]'
                            : insights.engagement.level === 'warm' ? 'bg-amber-500'
                            : insights.engagement.level === 'cold' ? 'bg-blue-400'
                            : 'bg-zinc-400'
                          }`}
                          style={{ width: `${insights.engagement.score}%` }}
                        />
                      </div>
                    </div>

                    {/* Engagement stats grid */}
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: t('inbox.openedLabel'), value: `${insights.engagement.opens}/${insights.engagement.totalSent}`, icon: Eye, color: insights.engagement.opens > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400' },
                        { label: t('inbox.clickedLabel'), value: `${insights.engagement.clicks}/${insights.engagement.totalSent}`, icon: MousePointerClick, color: insights.engagement.clicks > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400' },
                        { label: t('inbox.repliedLabel'), value: `${insights.engagement.replies}`, icon: CornerUpLeft, color: insights.engagement.replies > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400' },
                        { label: t('inbox.deliveredLabel'), value: `${insights.engagement.delivered}/${insights.engagement.totalSent}`, icon: CheckCheck, color: 'text-zinc-500 dark:text-zinc-400' },
                      ].map(stat => (
                        <div key={stat.label} className="text-center py-1.5 px-1 rounded-lg bg-white/60 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/[0.04]">
                          <stat.icon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${stat.color}`} />
                          <p className={`text-xs font-semibold ${stat.color}`}>{stat.value}</p>
                          <p className="text-[9px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">{stat.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* AI Insights */}
                    {insights.ai && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Sparkles className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                          <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('inbox.aiAnalysis')}</span>
                        </div>

                        {/* Summary */}
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                          {insights.ai.summary}
                        </div>

                        {/* Intent badge */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-medium">{t('inbox.intentLabel')}</span>
                          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                            {insights.ai.intent}
                          </span>
                        </div>

                        {/* Next action + best time */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="flex items-start gap-2 p-2 rounded-lg bg-white/60 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/[0.04]">
                            <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-medium">{t('inbox.nextActionLabel')}</p>
                              <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-0.5">{insights.ai.nextAction}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 p-2 rounded-lg bg-white/60 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/[0.04]">
                            <Clock className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-medium">{t('inbox.bestTimeLabel')}</p>
                              <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-0.5">{insights.ai.bestTimeToReach}</p>
                            </div>
                          </div>
                        </div>

                        {/* Risk */}
                        {insights.ai.risk && (
                          <div className="flex items-center gap-2 text-xs">
                            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                            <span className="text-zinc-500 dark:text-zinc-400">{insights.ai.risk}</span>
                          </div>
                        )}

                        {/* Suggested reply with copy */}
                        <div className="relative mt-1">
                          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-medium mb-1">{t('inbox.suggestedReplyLabel')}</p>
                          <div className="relative group">
                            <p className="text-sm text-zinc-600 dark:text-zinc-300 bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.06] rounded-xl px-3 py-2.5 leading-relaxed">
                              {insights.ai.suggestedReply}
                            </p>
                            <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(insights.ai!.suggestedReply);
                                  toast.success(t('inbox.copiedClipboard'));
                                }}
                                className="p-1 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                                title="Copy"
                              >
                                <Copy className="w-3 h-3 text-zinc-500" />
                              </button>
                              <button
                                onClick={() => {
                                  setReplyText(insights.ai!.suggestedReply);
                                  setShowComposer(true);
                                  setShowInsightsPanel(false);
                                }}
                                className="p-1 rounded-md bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                                title="Use as reply"
                              >
                                <Send className="w-3 h-3 text-white dark:text-zinc-900" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('inbox.noInsights')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 lg:px-6 py-4 space-y-3 bg-zinc-50/50 dark:bg-[var(--bg-page)]">
              {selectedThread.messages.map((msg, idx) => {
                const isSent = msg.direction === 'sent';
                const wasOpened = isSent && (!!msg.openedAt || msg.status === 'opened' || msg.status === 'clicked');
                const wasClicked = isSent && (!!msg.clickedAt || msg.status === 'clicked');
                const wasDelivered = isSent && (!!msg.deliveredAt || msg.status === 'delivered' || msg.status === 'opened' || msg.status === 'clicked');
                const wasBounced = isSent && msg.status === 'bounced';
                return (
                  <div key={msg.id} className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] lg:max-w-[70%] rounded-2xl px-4 py-3 ${
                        isSent
                          ? 'bg-zinc-800 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 rounded-br-md'
                          : 'bg-white dark:bg-white/[0.04] text-zinc-900 dark:text-zinc-100 rounded-bl-md shadow-sm dark:shadow-none border border-zinc-100 dark:border-white/[0.06]'
                      }`}
                    >
                      {/* Subject (on first message or if different from previous) */}
                      {(idx === 0 ||
                        msg.subject !== selectedThread.messages[idx - 1]?.subject) && (
                        <p
                          className={`text-xs font-semibold mb-1.5 ${
                            isSent ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {msg.subject}
                        </p>
                      )}
                      <p
                        className={`text-sm whitespace-pre-wrap leading-relaxed ${
                          isSent ? 'text-zinc-100 dark:text-zinc-900' : 'text-zinc-800 dark:text-zinc-200'
                        }`}
                      >
                        {decodeHtmlEntities(msg.body)}
                      </p>
                      {/* Timestamp + tracking status */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <p
                          className={`text-[10px] ${
                            isSent ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-500'
                          }`}
                        >
                          {new Date(msg.sentAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                        {/* Tracking indicators for sent messages */}
                        {isSent && (
                          <div className="flex items-center gap-1.5">
                            {wasBounced ? (
                              <span className="flex items-center gap-0.5 text-[9px] text-red-400 dark:text-red-500 font-medium" title={t('inbox.emailBounced')}>
                                <X className="w-2.5 h-2.5" />
                                {t('inbox.bouncedStatus')}
                              </span>
                            ) : (
                              <>
                                {wasClicked ? (
                                  <span
                                    className="flex items-center gap-0.5 text-[9px] font-medium text-emerald-400 dark:text-emerald-600"
                                    title={msg.clickedAt ? `${t('inbox.clickedStatus')} ${new Date(msg.clickedAt).toLocaleString()}` : t('inbox.clickedStatus')}
                                  >
                                    <MousePointerClick className="w-2.5 h-2.5" />
                                    {t('inbox.clickedStatus')}
                                  </span>
                                ) : wasOpened ? (
                                  <span
                                    className="flex items-center gap-0.5 text-[9px] font-medium text-emerald-400 dark:text-emerald-600"
                                    title={msg.openedAt ? `${t('inbox.openedStatus')} ${new Date(msg.openedAt).toLocaleString()}` : t('inbox.openedStatus')}
                                  >
                                    <Eye className="w-2.5 h-2.5" />
                                    {t('inbox.openedStatus')}
                                  </span>
                                ) : wasDelivered ? (
                                  <span className="flex items-center gap-0.5 text-[9px] text-zinc-400 dark:text-zinc-500" title={t('inbox.deliveredStatus')}>
                                    <CheckCheck className="w-2.5 h-2.5" />
                                    {t('inbox.deliveredStatus')}
                                  </span>
                                ) : (
                                  <Check className="w-2.5 h-2.5 text-zinc-500 dark:text-zinc-400" />
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* ── Forward Modal (inline overlay) ── */}
            {showForwardModal && (
              <div className="border-t border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[var(--bg-page)] px-4 lg:px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    <Forward className="w-4 h-4" />
                    {t('inbox.forwardConversation')}
                  </div>
                  <button
                    onClick={() => {
                      setShowForwardModal(false);
                      setForwardTo('');
                      setForwardNote('');
                    }}
                    className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-zinc-500 dark:text-zinc-400">{t('inbox.toLabel')}</label>
                      <button
                        onClick={() => setShowForwardCcBcc(p => !p)}
                        className="text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
                      >
                        {showForwardCcBcc ? t('inbox.hideCcBcc') : t('inbox.ccBccLabel')}
                      </button>
                    </div>
                    <input
                      ref={forwardInputRef}
                      type="email"
                      value={forwardTo}
                      onChange={(e) => setForwardTo(e.target.value)}
                      placeholder="recipient@email.com"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400/50 dark:focus:ring-white/20"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !sendingForward) {
                          e.preventDefault();
                          handleSendForward();
                        }
                        if (e.key === 'Escape') {
                          setShowForwardModal(false);
                          setForwardTo('');
                          setForwardNote('');
                        }
                      }}
                    />
                  </div>
                  {showForwardCcBcc && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">CC</label>
                        <input
                          type="text"
                          value={forwardCc}
                          onChange={(e) => setForwardCc(e.target.value)}
                          placeholder="cc@email.com, another@email.com"
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400/50 dark:focus:ring-white/20"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">BCC</label>
                        <input
                          type="text"
                          value={forwardBcc}
                          onChange={(e) => setForwardBcc(e.target.value)}
                          placeholder="bcc@email.com"
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400/50 dark:focus:ring-white/20"
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">{t('inbox.noteOptional')}</label>
                    <textarea
                      value={forwardNote}
                      onChange={(e) => setForwardNote(e.target.value)}
                      placeholder={t('inbox.addNote')}
                      rows={2}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400/50 dark:focus:ring-white/20 resize-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-600 flex-1">
                      {t('inbox.messagesIncluded', { count: selectedThread.messageCount })}
                    </p>
                    <button
                      onClick={() => {
                        setShowForwardModal(false);
                        setForwardTo('');
                        setForwardNote('');
                      }}
                      className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                      {t('inbox.cancel')}
                    </button>
                    <button
                      onClick={handleSendForward}
                      disabled={sendingForward || !forwardTo.trim()}
                      className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {sendingForward ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {t('inbox.sending')}
                        </>
                      ) : (
                        <>
                          <Forward className="w-3.5 h-3.5" />
                          {t('inbox.send')}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Reply composer ── */}
            {showComposer && !showForwardModal && (
              <div className="border-t border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[var(--bg-page)] px-4 lg:px-6 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <CornerUpLeft className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t('inbox.replyingTo', { name: selectedThread.leadName })}
                  </span>
                  <button
                    onClick={() => setShowReplyCcBcc(p => !p)}
                    className="text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors ml-auto"
                  >
                    {showReplyCcBcc ? t('inbox.hideCcBcc') : t('inbox.ccBccLabel')}
                  </button>
                  <button
                    onClick={() => {
                      setShowComposer(false);
                      setReplyText('');
                      setReplyCc('');
                      setReplyBcc('');
                      setShowReplyCcBcc(false);
                    }}
                    className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-zinc-400" />
                  </button>
                </div>
                {showReplyCcBcc && (
                  <div className="space-y-2 mb-2">
                    <div>
                      <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">CC</label>
                      <input
                        type="text"
                        value={replyCc}
                        onChange={(e) => setReplyCc(e.target.value)}
                        placeholder="cc@email.com, another@email.com"
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400/50 dark:focus:ring-white/20"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">BCC</label>
                      <input
                        type="text"
                        value={replyBcc}
                        onChange={(e) => setReplyBcc(e.target.value)}
                        placeholder="bcc@email.com"
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400/50 dark:focus:ring-white/20"
                      />
                    </div>
                  </div>
                )}
                <textarea
                  ref={replyRef}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleReplyKeyDown}
                  placeholder={t('inbox.writeReply')}
                  rows={3}
                  className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-xl text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400/50 dark:focus:ring-white/20 resize-none leading-relaxed"
                />
                {signaturePreview && (
                  <div className="mt-1.5 pt-1.5 border-t border-dashed border-zinc-200 dark:border-white/[0.06]">
                    <pre className="text-[10.5px] text-zinc-400 dark:text-zinc-500 font-sans whitespace-pre-line leading-relaxed">{signaturePreview}</pre>
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
                    {t('inbox.ctrlEnterSend', { key: navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl' })}
                  </p>
                  <button
                    onClick={handleSendReply}
                    disabled={sendingReply || !replyText.trim()}
                    className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {sendingReply ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('inbox.sending')}
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        {t('inbox.sendReplyBtn')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── Action bar (when composer is hidden) ── */}
            {!showComposer && !showForwardModal && (
              <div className="sticky bottom-0 bg-white dark:bg-[var(--bg-page)] border-t border-zinc-200 dark:border-white/[0.06] px-4 lg:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex gap-2">
                  <button
                    className="flex-1 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    onClick={() => setShowComposer(true)}
                  >
                    <CornerUpLeft className="w-4 h-4" />
                    {t('inbox.replyBtn')}
                  </button>
                  <button
                    className="px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl text-sm font-medium transition-colors shrink-0 flex items-center gap-2"
                    onClick={() => setShowForwardModal(true)}
                  >
                    <Forward className="w-4 h-4" />
                    {t('inbox.forwardBtn')}
                  </button>
                  <button
                    className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 flex items-center gap-1.5 ${
                      showInsightsPanel
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                    }`}
                    onClick={() => {
                      setShowInsightsPanel(p => !p);
                      if (!insights && !loadingInsights) loadInsights(selectedThread.threadId);
                    }}
                    title="AI Insights"
                  >
                    <Brain className="w-4 h-4" />
                    <span className="hidden sm:inline">AI</span>
                  </button>
                </div>
              </div>
            )}
          </>
        ) : showNewCompose ? (
          /* ── New Email Compose Panel ── */
          <div className="flex-1 flex flex-col bg-white dark:bg-[var(--bg-page)]">
            {/* Compose Header */}
            <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-zinc-200 dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <button
                  onClick={resetNewCompose}
                  className="lg:hidden p-1.5 -ml-1 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                  <PenSquare className="w-4 h-4 text-emerald-500" />
                  {t('inbox.newEmail')}
                </h3>
              </div>
              <button
                onClick={resetNewCompose}
                className="hidden lg:block p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Compose Form */}
            <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 space-y-3">
              {/* To */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wider">{t('inbox.toLabel')}</label>
                <input
                  type="email"
                  value={newComposeTo}
                  onChange={e => setNewComposeTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>

              {/* CC/BCC toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNewComposeCcBcc(p => !p)}
                  className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                >
                  {showNewComposeCcBcc ? t('inbox.hideCcBcc') : t('inbox.addCcBcc')}
                </button>
              </div>

              {/* CC / BCC */}
              {showNewComposeCcBcc && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wider">CC</label>
                    <input
                      type="text"
                      value={newComposeCc}
                      onChange={e => setNewComposeCc(e.target.value)}
                      placeholder="cc@example.com (comma-separated)"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wider">BCC</label>
                    <input
                      type="text"
                      value={newComposeBcc}
                      onChange={e => setNewComposeBcc(e.target.value)}
                      placeholder="bcc@example.com (comma-separated)"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                    />
                  </div>
                </div>
              )}

              {/* Subject */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wider">{t('inbox.subjectLabel')}</label>
                <input
                  type="text"
                  value={newComposeSubject}
                  onChange={e => setNewComposeSubject(e.target.value)}
                  placeholder={t('inbox.emailSubject')}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>

              {/* Body */}
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wider">{t('inbox.messageLabel')}</label>
                <textarea
                  ref={newComposeRef}
                  value={newComposeBody}
                  onChange={e => setNewComposeBody(e.target.value)}
                  placeholder="Write your email..."
                  rows={12}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none"
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSendNewEmail();
                    }
                    if (e.key === 'Escape') {
                      resetNewCompose();
                    }
                  }}
                />
              {/* Signature preview */}
              {signaturePreview && (
                <div className="mt-2 pt-2 border-t border-dashed border-zinc-200 dark:border-white/[0.06]">
                  <pre className="text-[11px] text-zinc-400 dark:text-zinc-500 font-sans whitespace-pre-line leading-relaxed">{signaturePreview}</pre>
                  <p className="text-[10px] text-zinc-400/60 dark:text-zinc-600 mt-0.5 italic">Signature auto-appended on send</p>
                </div>
              )}
              {/* Attachments */}
              <div>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => handleAddAttachments(e.target.files)}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip,.rar"
                />
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Attach files
                </button>

                {newComposeAttachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {newComposeAttachments.map((att, idx) => {
                      const FIcon = getFileIcon(att.file.type);
                      return (
                        <div
                          key={`${att.file.name}-${idx}`}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/[0.06] border border-zinc-200 dark:border-white/[0.08] group/att"
                        >
                          {att.preview ? (
                            <img src={att.preview} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                          ) : (
                            <FIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate max-w-[140px]">{att.file.name}</p>
                            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{formatFileSize(att.file.size)}</p>
                          </div>
                          <button
                            onClick={() => handleRemoveAttachment(idx)}
                            className="p-0.5 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover/att:opacity-100"
                            aria-label={`Remove ${att.file.name}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              </div>
            </div>

            {/* Compose Footer */}
            <div className="sticky bottom-0 bg-white dark:bg-[var(--bg-page)] border-t border-zinc-200 dark:border-white/[0.06] px-4 lg:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to send
                  </span>
                  {newComposeAttachments.length > 0 && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                      <Paperclip className="w-3 h-3" />
                      {newComposeAttachments.length} file{newComposeAttachments.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={resetNewCompose}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Discard
                  </button>
                  <button
                    onClick={handleSendNewEmail}
                    disabled={sendingNewEmail || !newComposeTo.trim() || !newComposeSubject.trim() || !newComposeBody.trim()}
                    className="px-5 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {sendingNewEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Empty state (desktop only) */
          <div className="flex-1 flex items-center justify-center bg-zinc-50/50 dark:bg-[var(--bg-page)]">
            <div className="text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-8 h-8 text-zinc-400 dark:text-zinc-500" />
              </div>
              <p className="text-base font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                {t('inbox.noConversationSelected')}
              </p>
              <p className="text-sm text-zinc-400 dark:text-zinc-600 mb-4">
                {t('inbox.selectOrCompose')}
              </p>
              <button
                onClick={() => setShowNewCompose(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-xl text-sm font-medium transition-colors"
              >
                <PenSquare className="w-4 h-4" />
                {t('inbox.composeEmail')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
