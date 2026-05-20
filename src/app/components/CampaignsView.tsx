// Rebuild trigger: 2026-02-23-campaigns-module-cache-fix
import { useState, useEffect, useRef, useCallback } from 'react';
import { Mail, Send, Eye, Users, Clock, CheckCircle2, XCircle, AlertCircle, AlertTriangle, Zap, Plus, RefreshCw, Trash2, Download, Target, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, MousePointerClick, User, Radio, Play, Building2, Briefcase, Phone, MapPin, Globe } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { authenticatedFetch, getAuthHeaders } from '../lib/auth';
import { confirmAsync } from './ConfirmDialog';
import { projectId } from '../utils/supabase/info';
import { notifyEmailClicked, notifyEmailOpened } from '../lib/notifications';
import { exportCampaigns } from '../lib/csvExport';
import { FastMoneyTargets } from './FastMoneyTargets';
import { LeadDetailModal } from './LeadDetailModal';

// No-op preloader kept for API compatibility with the onMouseEnter
// handlers below. The modal is now imported directly (same pattern as
// BuyingIntent which works reliably), so hover preloading is unnecessary
// but the hook stays in case we revert to lazy later.
function preloadLeadDetailModal() { /* no-op */ }
import { apiCache } from '../lib/api-cache';
import { LoadingSpinner } from './LoadingSpinner';
import { syncEmailStatuses } from '../utils/syncEmailStatuses';
import { toast } from "sonner";
import { SendingLiveView, type SendingLogEntry } from './SendingLiveView';
import { useRealtimeRefresh } from './RealtimeProvider';
import { SequenceBuilder } from './SequenceBuilder';
import { LinkedInTasks } from './LinkedInTasks';
import { dispatchAppEvent, useAppEventRefresh } from '../lib/app-events';
import { useDemoMode, DEMO_CAMPAIGNS } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { acquireSendLock, releaseSendLock, isSendLocked } from '../lib/send-lock';

type CampaignTab = 'campaigns' | 'sequences' | 'linkedin-tasks' | 'fast-money';
type CampaignScope = 'mine' | 'team';

interface Campaign {
  id: string;
  name: string;
  product: string;
  brand?: string;
  tone: string;
  status: string;
  from_email: string;
  created_at: string;
  // Team fields
  created_by?: string;
  created_by_email?: string;
  is_own?: boolean;
  user_id?: string;
}

interface CampaignsViewProps {
  onCreateCampaign?: () => void;
}

function isMailboxVerificationBlock(error: unknown) {
  return /mailbox verification|zerobounce|risky|catch-all|undeliverable|unknown/i.test(String(error || ''));
}

export function CampaignsView({ onCreateCampaign }: CampaignsViewProps) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const campaignRefreshKey = useRealtimeRefresh(['campaign:created', 'campaign:updated', 'campaign:completed', 'campaign:paused', 'email:sent', 'email:replied']);
  const [campaigns, setCampaigns] = useState<Campaign[]>(isDemoMode ? DEMO_CAMPAIGNS : []);
  const [loading, setLoading] = useState(isDemoMode ? false : true);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [campaignStats, setCampaignStats] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<any>(null);
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);
  const [activeTab, setActiveTab] = useState<CampaignTab>('campaigns');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Team campaign state
  const [campaignScope, setCampaignScope] = useState<CampaignScope>('mine');
  const [teamCampaigns, setTeamCampaigns] = useState<Campaign[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamSize, setTeamSize] = useState(0);
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [teamMembers, setTeamMembers] = useState<{id: string; name: string; email: string}[]>([]);

  // Auto-resume state
  const [autoResuming, setAutoResuming] = useState(false);
  const [pendingCampaigns, setPendingCampaigns] = useState<any[]>([]);
  const autoResumeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoResumeActiveRef = useRef(false);

  // Broadcast live view state
  const [broadcastLog, setBroadcastLog] = useState<SendingLogEntry[]>([]);
  const [broadcastCurrent, setBroadcastCurrent] = useState<SendingLogEntry | null>(null);
  const [broadcastProgress, setBroadcastProgress] = useState(0);
  const [broadcastTotal, setBroadcastTotal] = useState(0);
  const [broadcastSuccess, setBroadcastSuccess] = useState(0);
  const [broadcastError, setBroadcastError] = useState(0);
  const [broadcastBounce, setBroadcastBounce] = useState(0);
  const [broadcastDone, setBroadcastDone] = useState(false);
  // Track which campaign is being broadcast from the list
  const [listBroadcastCampaignId, setListBroadcastCampaignId] = useState<string | null>(null);
  const [listBroadcastCampaignName, setListBroadcastCampaignName] = useState<string>('');

  // Bounced contacts state
  const [bouncedContacts, setBouncedContacts] = useState<any[]>([]);
  // Lead ID currently shown in the LeadDetailModal — null = modal closed
  const [drillLeadId, setDrillLeadId] = useState<string | null>(null);
  const [openedContacts, setOpenedContacts] = useState<any[]>([]);
  const [openedExpanded, setOpenedExpanded] = useState(false);
  const [loadingOpened, setLoadingOpened] = useState(false);
  const [clickedContacts, setClickedContacts] = useState<any[]>([]);
  const [clickedExpanded, setClickedExpanded] = useState(false);
  const [loadingClicked, setLoadingClicked] = useState(false);

  async function loadOpenedContacts(campaignId: string) {
    if (isDemoMode || loadingOpened) return;
    setLoadingOpened(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/opened`
      );
      if (response.ok) {
        const data = await response.json();
        setOpenedContacts(data.opened || []);
      }
    } catch (e) {
      console.error('[OPENED] load error:', e);
    } finally {
      setLoadingOpened(false);
    }
  }

  async function loadClickedContacts(campaignId: string) {
    if (isDemoMode || loadingClicked) return;
    setLoadingClicked(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/clicked`
      );
      if (response.ok) {
        const data = await response.json();
        setClickedContacts(data.clicked || []);
      }
    } catch (e) {
      console.error('[CLICKED] load error:', e);
    } finally {
      setLoadingClicked(false);
    }
  }
  const [bouncedExpanded, setBouncedExpanded] = useState(false);
  const [loadingBounced, setLoadingBounced] = useState(false);
  const [deletingBouncedId, setDeletingBouncedId] = useState<string | null>(null);
  const [deletingAllBounced, setDeletingAllBounced] = useState(false);

  // Normalize legacy brand names: sendlr → contndr
  const normalizeBrand = (brand: string | undefined) => {
    const b = (brand || '').toLowerCase();
    if (b === 'sendlr') return 'contndr';
    return b;
  };

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserEmail(session.user.email || null);
      }
    };
    loadUser();
  }, []);

  // ─── Auto-Resume: Check for stuck/in-progress campaigns on mount & periodically ───
  const checkAndResumeCampaigns = useCallback(async () => {
    if (isDemoMode) return; // Skip in demo mode
    if (autoResumeActiveRef.current) return; // Prevent overlapping
    autoResumeActiveRef.current = true;
    
    try {
      // Step 1: Check for pending campaigns
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/pending`
      );
      if (!response.ok) return;
      
      const data = await response.json();
      const pending = data.pending || [];
      setPendingCampaigns(pending);
      
      if (pending.length === 0) return;
      
      // Don't auto-resume if user is actively sending
      if (sending) return;
      
      // Find the first pending campaign that isn't already being sent by another sender
      // (BroadcastContext or a manual send from this view) to avoid duplicate emails.
      const target = pending.find((p: any) => !isSendLocked(p.campaignId));
      if (!target) {
        console.log('[AUTO-RESUME] All pending campaigns are already being sent — skipping');
        return;
      }

      // Acquire the lock before sending
      if (!acquireSendLock(target.campaignId)) {
        console.log(`[AUTO-RESUME] Lock race on ${target.campaignId} — skipping`);
        return;
      }
      
      console.log(`[AUTO-RESUME] Found ${pending.length} campaigns with unsent emails`);
      setAutoResuming(true);
      
      try {
        const batchResponse = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${target.campaignId}/launch`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchSize: 5 }),
            signal: AbortSignal.timeout(15_000),
          }
        );
        
        if (batchResponse.ok) {
          const batchResult = await batchResponse.json().catch(() => ({}));
          toast('Campaign resumed', {
            description: 'Emails are sending in the background',
            duration: 3000,
          });
          apiCache.invalidate('campaigns:*');
          loadCampaigns();
          
          // Update pending state with new remaining count
          const updatedPending = pending.map((p: any) => {
            if (p.campaignId === target.campaignId) {
              return { ...p, remaining: batchResult.remaining ?? p.remaining, sentCount: (p.sentCount || 0) + (batchResult.sent || 0) };
            }
            return p;
          }).filter((p: any) => p.remaining > 0);
          setPendingCampaigns(updatedPending);
        } else {
          console.warn('[AUTO-RESUME] Batch send failed:', await batchResponse.text().catch(() => 'unknown'));
        }
      } catch (batchErr) {
        console.warn('[AUTO-RESUME] Batch send error:', batchErr);
      } finally {
        releaseSendLock(target.campaignId);
      }
    } catch (err) {
      console.warn('[AUTO-RESUME] Error:', err);
    } finally {
      setAutoResuming(false);
      autoResumeActiveRef.current = false;
    }
  }, [sending, isDemoMode]);

  // Auto-process follow-ups on mount (runs once)
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    const processFollowUps = async () => {
      try {
        const response = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/followups/auto-process`,
          { method: 'POST' }
        );
        if (response.ok) {
          const data = await response.json();
          if (data.sent > 0) {
            toast(`Sent ${data.sent} follow-up${data.sent > 1 ? 's' : ''}`, {
              description: `Across ${data.campaigns?.length || 0} campaign${(data.campaigns?.length || 0) !== 1 ? 's' : ''}`,
              duration: 5000,
            });
          }
        }
      } catch (err) {
        console.warn('[FOLLOW-UPS] Auto-process error:', err);
      }
    };
    // Run follow-up processing after a short delay to not block initial render
    const timer = setTimeout(processFollowUps, 5000);
    return () => clearTimeout(timer);
  }, [isDemoMode]);

  // Auto-resume check on mount + periodic interval
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    // Check immediately on mount (with slight delay)
    const initialTimer = setTimeout(checkAndResumeCampaigns, 2000);
    
    // Check every 45 seconds (global monitor in App handles the heavy lifting every 30s)
    autoResumeRef.current = setInterval(checkAndResumeCampaigns, 45_000);
    
    return () => {
      clearTimeout(initialTimer);
      if (autoResumeRef.current) {
        clearInterval(autoResumeRef.current);
        autoResumeRef.current = null;
      }
    };
  }, [checkAndResumeCampaigns]);

  useEffect(() => {
    if (isDemoMode) return; // Skip loading in demo mode
    loadCampaigns();
    // Light fallback poll for campaign list only (real-time system handles campaign detail).
    const interval = setInterval(() => {
      if (!selectedCampaign) {
        loadCampaigns();
      }
    }, 120 * 1000);
    return () => clearInterval(interval);
  }, [selectedCampaign, isDemoMode]);

  // ── Real-time sync: reload campaigns when events come from other tabs/users ──
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    if (campaignRefreshKey > 0) {
      console.log('[CAMPAIGNS] Real-time refresh triggered');
      apiCache.invalidate('campaigns:*');
      loadCampaigns();
    }
  }, [campaignRefreshKey, isDemoMode]);

  // ── App-event sync: reload campaigns instantly on in-tab mutations ──
  const campaignAppEventKey = useAppEventRefresh(['campaigns:changed', 'campaigns:deleted']);
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    if (campaignAppEventKey > 0) {
      console.log('[CAMPAIGNS] App-event refresh triggered');
      apiCache.invalidate('campaigns:*');
      loadCampaigns();
    }
  }, [campaignAppEventKey, isDemoMode]);

  // Webhook-driven: Resend webhooks push status updates to the DB,
  // and Supabase Realtime (below) pushes DB changes to the frontend.
  // No auto-polling of the Resend API — manualSyncTrackingData() serves
  // as a manual fallback if webhooks ever miss events.

  async function manualSyncTrackingData() {
    if (isDemoMode) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncEmailStatuses({ getAuthHeaders });

      if (result.success) {
        setSyncResult(result);
        if (selectedCampaign) await loadCampaignStats(selectedCampaign);
        setTimeout(() => setSyncResult(null), 5000);
      } else {
        setSyncResult({ success: false, error: result.error || 'Failed to sync' });
      }
    } catch (error: any) {
      setSyncResult({ success: false, error: error.message || 'Failed to sync' });
    } finally {
      setSyncing(false);
    }
  }

  // ─── Real-time tracking: fast poll + live events + Supabase Realtime ───
  const prevStatsRef = useRef<any>(null);
  const liveEventsSinceRef = useRef<number>(Date.now());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect stat changes and fire toast notifications
  const detectAndNotifyChanges = useCallback((oldStats: any, newStats: any) => {
    if (!oldStats?.emailStats || !newStats?.emailStats) return;
    const o = oldStats.emailStats;
    const n = newStats.emailStats;

    const newOpens = (n.opened || 0) - (o.opened || 0);
    const newClicks = (n.clicked || 0) - (o.clicked || 0);

    if (newOpens > 0) {
      toast(`${newOpens} new open${newOpens > 1 ? 's' : ''} detected`, {
        icon: '👀',
        description: `Total opens: ${n.opened}`,
        duration: 4000,
      });
      const campaign = campaigns.find(c => c.id === selectedCampaign);
      if (campaign) notifyEmailOpened('Lead', campaign.name);
    }

    if (newClicks > 0) {
      toast(`${newClicks} new click${newClicks > 1 ? 's' : ''} detected`, {
        icon: '🖱️',
        description: `Total clicks: ${n.clicked}`,
        duration: 4000,
      });
      const campaign = campaigns.find(c => c.id === selectedCampaign);
      if (campaign) notifyEmailClicked('Lead', campaign.name);
    }
  }, [campaigns, selectedCampaign]);

  // Wrapped loadCampaignStats that detects changes
  const loadCampaignStatsLive = useCallback(async (campaignId: string) => {
    if (isDemoMode) return; // Skip in demo mode
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/status`
      );

      if (response.ok) {
        const data = await response.json();
        // Compare with previous stats for change detection
        if (prevStatsRef.current) {
          detectAndNotifyChanges(prevStatsRef.current, data);
        }
        prevStatsRef.current = JSON.parse(JSON.stringify(data));
        setCampaignStats(data);
      }
    } catch (error) {
      console.error('Error loading campaign stats:', error);
    }
  }, [detectAndNotifyChanges, isDemoMode]);

  // Fast-poll live events endpoint (lightweight, every 5s)
  const pollLiveEvents = useCallback(async (campaignId: string) => {
    if (isDemoMode) return; // Skip in demo mode
    try {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/live-events?since=${liveEventsSinceRef.current}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.events && data.events.length > 0) {
          // New events detected — refresh full stats
          liveEventsSinceRef.current = data.server_ts || Date.now();
          await loadCampaignStatsLive(campaignId);
        }
      }
    } catch {
      // Silently fail — next poll will retry
    }
  }, [loadCampaignStatsLive, isDemoMode]);

  // Main real-time effect: sets up fast polling + Supabase Realtime
  useEffect(() => {
    if (!selectedCampaign || isDemoMode) {
      setIsLiveUpdating(false);
      prevStatsRef.current = null;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    setIsLiveUpdating(true);
    liveEventsSinceRef.current = Date.now();

    // Fast poll: check for live events every 5 seconds
    pollTimerRef.current = setInterval(() => {
      pollLiveEvents(selectedCampaign);
    }, 5000);

    // Also do a full stats refresh every 30 seconds as reliable fallback
    const fullRefreshTimer = setInterval(() => {
      loadCampaignStatsLive(selectedCampaign);
    }, 30000);

    // Supabase Realtime (bonus — works when Realtime is enabled on the tables)
    const emailsChannel = supabase
      .channel(`campaign-emails-rt-${selectedCampaign}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emails', filter: `campaign_id=eq.${selectedCampaign}` },
        () => {
          loadCampaignStatsLive(selectedCampaign);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'email_events' },
        (payload: any) => {
          // email_events INSERT — check if it belongs to this campaign
          loadCampaignStatsLive(selectedCampaign);
        }
      )
      .subscribe();

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      clearInterval(fullRefreshTimer);
      supabase.removeChannel(emailsChannel);
      setIsLiveUpdating(false);
    };
  }, [selectedCampaign, pollLiveEvents, loadCampaignStatsLive, isDemoMode]);

  async function loadCampaigns() {
    if (isDemoMode) { setLoading(false); return; }
    try {
      const data = await apiCache.fetch(
        'campaigns:list',
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns`
          );
          if (!response.ok) throw new Error('Failed to load campaigns');
          return response.json();
        },
        { staleTime: 15_000, cacheTime: 60_000 }
      );
      setCampaigns(data?.campaigns || []);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    } finally {
      setLoading(false);
    }
  }

  // Load team campaigns from the shared endpoint
  async function loadTeamCampaigns(forceRefresh = false) {
    if (isDemoMode) return;
    if (teamLoaded && !forceRefresh) return;
    setLoadingTeam(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/campaigns`
      );
      if (response.ok) {
        const data = await response.json();
        setTeamCampaigns(data?.campaigns || []);
        setTeamSize(data?.team_size || 0);
        setTeamMembers(data?.members || []);
        setTeamLoaded(true);
        console.log(`[CAMPAIGNS] Loaded ${data.campaigns?.length || 0} team campaigns`);
      } else {
        console.error('[CAMPAIGNS] Team campaigns error:', await response.text());
      }
    } catch (error) {
      console.error('[CAMPAIGNS] Team campaigns error:', error);
    } finally {
      setLoadingTeam(false);
    }
  }

  // Load team campaigns when switching to team scope
  useEffect(() => {
    if (campaignScope === 'team' && !teamLoaded) {
      loadTeamCampaigns();
    }
  }, [campaignScope]);

  async function loadCampaignStats(campaignId: string) {
    if (isDemoMode) return; // Skip in demo mode
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/status`
      );

      if (response.ok) {
        const data = await response.json();
        setCampaignStats(data);
      }
    } catch (error) {
      console.error('Error loading campaign stats:', error);
    }
  }

  async function viewCampaign(campaignId: string) {
    prevStatsRef.current = null; // Reset so first load doesn't trigger false notifications
    setSelectedCampaign(campaignId);
    setBouncedContacts([]);
    setBouncedExpanded(false);
    if (isDemoMode) {
      // Provide synthetic campaign stats for demo mode
      const camp = campaigns.find(c => c.id === campaignId) as any;
      const sent = camp?.sent_count || 0;
      const opened = camp?.open_count || 0;
      const clicked = camp?.click_count || 0;
      const replied = camp?.reply_count || 0;
      const bounced = camp?.bounce_count || 0;
      const total = camp?.lead_count || 0;
      const pending = Math.max(0, total - sent);
      const delivered = Math.max(0, sent - bounced);
      const positiveReplies = Math.round(replied * 0.65);
      const meetingsBooked = Math.round(replied * 0.3);
      setCampaignStats({
        leadStats: { total, pending, sent, failed: bounced },
        emailStats: {
          sent,
          delivered,
          opened,
          clicked,
          replied,
          bounced,
          positive_replies: positiveReplies,
          meetings_booked: meetingsBooked,
        },
        leads: Array.from({ length: Math.min(total, 20) }, (_, i) => ({
          id: `demo-lead-${campaignId}-${i}`,
          contact_name: ['Sarah Chen', 'Marcus Williams', 'Emily Rodriguez', "James O'Brien", 'Priya Patel', 'David Kim', 'Lisa Thompson', 'Michael Chang', 'Anna Kowalski', 'Robert Singh', 'Jessica Park', 'Daniel Garcia', 'Olivia Brown', 'Chris Evans', 'Maya Johnson', 'Tom Anderson', 'Rachel Lee', 'Kevin Martinez', 'Sophie Davis', 'Alex Taylor'][i % 20],
          email: `lead${i}@example.com`,
          company: ['Stripe', 'Notion', 'Figma', 'Linear', 'Vercel', 'Supabase', 'Railway', 'Retool', 'Airtable', 'Webflow'][i % 10],
          title: ['VP Sales', 'Head of Growth', 'CTO', 'CEO', 'Director of Ops', 'CMO', 'VP Engineering', 'Head of Product', 'COO', 'Director of Sales'][i % 10],
          status: i < sent ? (i < delivered ? 'delivered' : 'sent') : 'pending',
        })),
      });
      return;
    }
    await loadCampaignStatsLive(campaignId);
  }

  async function loadBouncedContacts(campaignId: string) {
    if (isDemoMode) return;
    if (loadingBounced) return;
    setLoadingBounced(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/bounced`
      );
      if (response.ok) {
        const data = await response.json();
        setBouncedContacts(data.bounced || []);
      } else {
        console.error('[BOUNCED] Failed to load bounced contacts:', response.status);
      }
    } catch (error) {
      console.error('[BOUNCED] Error loading bounced contacts:', error);
    } finally {
      setLoadingBounced(false);
    }
  }

  async function deleteBouncedContact(leadId: string, contactId: string) {
    if (!leadId) {
      // No lead ID — just remove the email record from the list
      setBouncedContacts(prev => prev.filter(c => c.id !== contactId));
      toast.success('Removed bounced entry');
      return;
    }
    setDeletingBouncedId(contactId);
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { toast.error('Not authenticated'); setDeletingBouncedId(null); return; }
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
        { method: 'POST', headers, body: JSON.stringify({ lead_ids: [leadId] }) }
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        toast.error('Failed to delete lead', { description: errData.error || 'Please try again' });
        return;
      }
      setBouncedContacts(prev => prev.filter(c => c.id !== contactId));
      toast.success('Lead deleted successfully');
    } catch (error) {
      console.error('[BOUNCED] Error deleting bounced contact:', error);
      toast.error('Failed to delete lead');
    } finally {
      setDeletingBouncedId(null);
    }
  }

  async function deleteAllBouncedContacts() {
    if (isDemoMode) return;
    const leadsWithIds = bouncedContacts.filter(c => c.leadId);
    const uniqueLeadIds = [...new Set(leadsWithIds.map(c => c.leadId))];
    if (uniqueLeadIds.length === 0) {
      toast.info('No leads to delete');
      return;
    }
    if (!(await confirmAsync({ title: 'Delete bounced leads?', message: `${uniqueLeadIds.length} lead${uniqueLeadIds.length === 1 ? '' : 's'} will be permanently removed.`, confirmLabel: 'Delete', destructive: true }))) return;
    setDeletingAllBounced(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { toast.error('Not authenticated'); setDeletingAllBounced(false); return; }
      const BATCH_SIZE = 100;
      let totalDeleted = 0;
      for (let i = 0; i < uniqueLeadIds.length; i += BATCH_SIZE) {
        const batch = uniqueLeadIds.slice(i, i + BATCH_SIZE);
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
          { method: 'POST', headers, body: JSON.stringify({ lead_ids: batch }) }
        );
        if (response.ok) {
          const result = await response.json();
          totalDeleted += (result.results?.deleted || 0);
        }
      }
      setBouncedContacts([]);
      toast.success(`Deleted ${totalDeleted} bounced lead${totalDeleted === 1 ? '' : 's'}`);
      // Refresh campaign stats so the "Bounced: N" badge in the header updates.
      // Without this, the badge keeps showing the old count until page reload.
      if (selectedCampaign) {
        loadCampaignStatsLive(selectedCampaign).catch(() => {});
      }
      apiCache.invalidate('campaigns:*');
    } catch (error) {
      console.error('[BOUNCED] Error deleting all bounced contacts:', error);
      toast.error('Failed to delete bounced leads');
    } finally {
      setDeletingAllBounced(false);
    }
  }

  async function sendCampaign(campaignId: string) {
    if (isDemoMode) {
      toast(t('campaignBuilder.demoMode'), { description: t('campaignBuilder.broadcastingDisabledDemo'), duration: 3000 });
      return;
    }
    if (!(await confirmAsync({ title: 'Send to all pending leads?', message: 'Every lead in pending status will be queued for sending.', confirmLabel: 'Send all' }))) return;

    // Guard: don't send if this campaign is already being broadcast
    if (!acquireSendLock(campaignId)) {
      toast.error('This campaign is already being sent', { description: 'Wait for the current broadcast to finish before sending again.' });
      return;
    }

    const pendingCount = campaignStats?.leadStats?.pending || 0;

    setSending(true);
    setSendResults(null);
    // Initialize broadcast live view
    setBroadcastLog([]);
    setBroadcastCurrent(null);
    setBroadcastProgress(0);
    setBroadcastTotal(pendingCount);
    setBroadcastSuccess(0);
    setBroadcastError(0);
    setBroadcastBounce(0);
    setBroadcastDone(false);

    let totalSent = 0;
    let totalFailed = 0;
    let totalBounced = 0;
    let hasMore = true;
    let consecutiveErrors = 0;
    let emailIndex = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    try {
      while (hasMore) {
        try {
          // Send one at a time for immersive live view
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/send-batch?limit=1`,
            { method: 'POST' }
          );

          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));

            // 409 = server in-flight lock — back off and retry silently
            if (response.status === 409) {
              console.warn('[CAMPAIGNS] Server in-flight lock active — retrying in 3s');
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }

            console.error(`[CAMPAIGNS] Batch failed:`, error);
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              toast.error('Campaign paused', {
                description: 'Too many errors. The live sender paused without starting a background worker.',
                duration: 6000,
              });
              hasMore = false;
              break;
            }
            await new Promise(r => setTimeout(r, 3000 * consecutiveErrors));
            continue;
          }

          consecutiveErrors = 0;
          const data = await response.json();
          const batchSent = data.sent || 0;
          const emailsSent: any[] = data.emails_sent || [];

          // Process each email returned from the batch
          for (const emailInfo of emailsSent) {
            emailIndex++;
            const entryId = `campaign-${campaignId}-${emailIndex}`;

            if (emailInfo.success) {
              totalSent++;
              setBroadcastSuccess(totalSent);

              // Phase: writing — show typewriter with actual content
              const contentEntry: SendingLogEntry = {
                id: entryId,
                recipientName: emailInfo.leadName || 'Unknown',
                recipientEmail: emailInfo.leadEmail || '',
                subject: emailInfo.subject || '(no subject)',
                body: emailInfo.body || '',
                fromEmail: emailInfo.fromEmail || '',
                status: 'writing',
                timestamp: Date.now(),
              };
              setBroadcastCurrent({ ...contentEntry });

              // Typing time: scaled to body length
              const bodyLen = (emailInfo.body || '').length;
              const typingWait = Math.min(Math.max(bodyLen * 4, 1800), 5000);
              await new Promise(r => setTimeout(r, typingWait));

              // Phase: delivered
              setBroadcastCurrent({ ...contentEntry, status: 'delivered' });
              await new Promise(r => setTimeout(r, 1000));

              // Move to log
              setBroadcastLog(prev => [...prev, { ...contentEntry, status: 'delivered', timestamp: Date.now() }]);
            } else {
              const isBounced = emailInfo.bounced || emailInfo.error?.toLowerCase?.()?.includes?.('bounce') || isMailboxVerificationBlock(emailInfo.error);
              const hasDraftPreview = Boolean(emailInfo.subject || emailInfo.body);
              const failedEntry: SendingLogEntry = {
                id: entryId,
                recipientName: emailInfo.leadName || 'Unknown',
                recipientEmail: emailInfo.leadEmail || '',
                subject: emailInfo.subject || '',
                body: emailInfo.body || '',
                fromEmail: emailInfo.fromEmail || '',
                status: isBounced ? 'bounced' : 'failed',
                timestamp: Date.now(),
              };

              if (hasDraftPreview) {
                setBroadcastCurrent({ ...failedEntry, status: 'writing' });
                const bodyLen = (emailInfo.body || '').length;
                const typingWait = Math.min(Math.max(bodyLen * 4, 1800), 5000);
                await new Promise(r => setTimeout(r, typingWait));
                setBroadcastCurrent(failedEntry);
                await new Promise(r => setTimeout(r, 900));
              }

              if (isBounced) {
                totalBounced++;
                setBroadcastBounce(totalBounced);
              } else {
                totalFailed++;
                setBroadcastError(totalFailed);
              }

              setBroadcastLog(prev => [...prev, failedEntry]);
            }

            setBroadcastProgress(emailIndex);
          }

          // Edge case: no emails returned AND no remaining leads
          if (emailsSent.length === 0 && batchSent === 0 && (!data.remaining || data.remaining <= 0)) {
            hasMore = false;
          }

          setSendResults({ sent: totalSent, remaining: data.remaining || 0 });

          if (data.campaign_complete) {
            hasMore = false;
          } else if (batchSent === 0 && data.remaining > 0) {
            // AI or send failed for this lead but there are more leads — keep going
            console.log(`[CAMPAIGNS] Batch sent 0 but ${data.remaining} remaining — continuing...`);
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              toast.error('Campaign paused', {
                description: `Too many consecutive errors. ${data.remaining} leads remaining. The live sender paused safely.`,
                duration: 6000,
              });
              hasMore = false;
            } else {
              await new Promise(r => setTimeout(r, 2000));
            }
          } else if (batchSent === 0) {
            hasMore = false;
          } else {
            consecutiveErrors = 0; // Reset on success
            await new Promise(r => setTimeout(r, 400));
          }
        } catch (networkError: any) {
          console.error(`[CAMPAIGNS] Network error:`, networkError);
          consecutiveErrors++;
          
          // Check if actually offline
          const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
          
          if (isOffline) {
            // Wait for network to come back, then continue
            toast.error('Connection lost', {
              description: 'Waiting for network to reconnect. Campaign will resume automatically.',
              duration: 10000,
            });
            await new Promise<void>(resolve => {
              const onOnline = () => {
                window.removeEventListener('online', onOnline);
                clearTimeout(timeout);
                toast.success('Network reconnected', { description: 'Resuming campaign...', duration: 3000 });
                resolve();
              };
              // Max wait 5 minutes, then bail to auto-resume
              const timeout = setTimeout(() => {
                window.removeEventListener('online', onOnline);
                hasMore = false;
                resolve();
              }, 300_000);
              window.addEventListener('online', onOnline);
            });
            if (!hasMore) break;
            consecutiveErrors = 0; // Reset after reconnect
            continue;
          }
          
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            toast.error('Connection unstable', {
              description: 'Pausing live view without starting a background worker.',
              duration: 8000,
            });
            hasMore = false;
            break;
          }
          // Exponential backoff: 2s, 4s, 6s
          await new Promise(r => setTimeout(r, 2000 * consecutiveErrors));
        }
      }

      setBroadcastCurrent(null);
      setBroadcastDone(true);

      await loadCampaignStats(campaignId);
      apiCache.invalidate('campaigns:*');
      dispatchAppEvent({ type: 'campaigns:changed', ids: [campaignId] });
      await loadCampaigns();
    } catch (error: any) {
      console.error('[CAMPAIGNS] Send error:', error);
      toast.error('Error sending campaign', { description: error.message, duration: 5000 });
      setBroadcastCurrent(null);
      setBroadcastDone(true);
    } finally {
      releaseSendLock(campaignId);
      setSending(false);
    }
  }

  function dismissBroadcast() {
    setSending(false);
    setSendResults(null);
    setBroadcastLog([]);
    setBroadcastCurrent(null);
    setBroadcastProgress(0);
    setBroadcastTotal(0);
    setBroadcastSuccess(0);
    setBroadcastError(0);
    setBroadcastBounce(0);
    setBroadcastDone(false);
    setListBroadcastCampaignId(null);
    setListBroadcastCampaignName('');
  }

  async function startListBroadcast(campaignId: string, campaignName: string) {
    if (isDemoMode) {
      toast(t('campaignBuilder.demoMode'), { description: t('campaignBuilder.broadcastingDisabledDemo'), duration: 3000 });
      return;
    }
    if (!(await confirmAsync({ title: `Send campaign "${campaignName}"?`, message: t('campaigns.confirmSendAll', { name: campaignName }) as string, confirmLabel: 'Send campaign' }))) return;

    // Fetch pending count for this campaign
    let pendingCount = 0;
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/stats`
      );
      if (response.ok) {
        const stats = await response.json();
        pendingCount = stats.leadStats?.pending || 0;
      }
    } catch (e) {
      console.warn('[LIST-BROADCAST] Could not fetch pending count:', e);
    }

    if (pendingCount === 0) {
      toast.error('No pending leads', { description: 'All leads in this campaign have already been sent.' });
      return;
    }

    // Guard: don't send if this campaign is already being broadcast
    if (!acquireSendLock(campaignId)) {
      toast.error('This campaign is already being sent', { description: 'Wait for the current broadcast to finish before sending again.' });
      return;
    }

    setListBroadcastCampaignId(campaignId);
    setListBroadcastCampaignName(campaignName);
    setSending(true);
    setSendResults(null);
    setBroadcastLog([]);
    setBroadcastCurrent(null);
    setBroadcastProgress(0);
    setBroadcastTotal(pendingCount);
    setBroadcastSuccess(0);
    setBroadcastError(0);
    setBroadcastBounce(0);
    setBroadcastDone(false);

    let totalSent = 0;
    let totalFailed = 0;
    let totalBounced = 0;
    let hasMore = true;
    let consecutiveErrors = 0;
    let emailIndex = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    try {
      while (hasMore) {
        try {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/send-batch?limit=1`,
            { method: 'POST' }
          );

          if (!response.ok) {
            // 409 = server in-flight lock — back off and retry silently
            if (response.status === 409) {
              console.warn('[LIST-BROADCAST] Server in-flight lock active — retrying in 3s');
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              toast.error('Campaign paused', { description: 'Too many errors. The live sender paused without starting a background worker.', duration: 6000 });
              hasMore = false;
              break;
            }
            await new Promise(r => setTimeout(r, 3000 * consecutiveErrors));
            continue;
          }

          consecutiveErrors = 0;
          const data = await response.json();
          const batchSent = data.sent || 0;
          const emailsSent: any[] = data.emails_sent || [];

          for (const emailInfo of emailsSent) {
            emailIndex++;
            const entryId = `list-broadcast-${campaignId}-${emailIndex}`;

            if (emailInfo.success) {
              totalSent++;
              setBroadcastSuccess(totalSent);

              const contentEntry: SendingLogEntry = {
                id: entryId,
                recipientName: emailInfo.leadName || 'Unknown',
                recipientEmail: emailInfo.leadEmail || '',
                subject: emailInfo.subject || '(no subject)',
                body: emailInfo.body || '',
                fromEmail: emailInfo.fromEmail || '',
                status: 'writing',
                timestamp: Date.now(),
              };
              setBroadcastCurrent({ ...contentEntry });

              const bodyLen = (emailInfo.body || '').length;
              const typingWait = Math.min(Math.max(bodyLen * 4, 1800), 5000);
              await new Promise(r => setTimeout(r, typingWait));

              setBroadcastCurrent({ ...contentEntry, status: 'delivered' });
              await new Promise(r => setTimeout(r, 1000));

              setBroadcastLog(prev => [...prev, { ...contentEntry, status: 'delivered', timestamp: Date.now() }]);
            } else {
              const isBounced = emailInfo.bounced || emailInfo.error?.toLowerCase?.()?.includes?.('bounce') || isMailboxVerificationBlock(emailInfo.error);
              const hasDraftPreview = Boolean(emailInfo.subject || emailInfo.body);
              const failedEntry: SendingLogEntry = {
                id: entryId,
                recipientName: emailInfo.leadName || 'Unknown',
                recipientEmail: emailInfo.leadEmail || '',
                subject: emailInfo.subject || '',
                body: emailInfo.body || '',
                fromEmail: emailInfo.fromEmail || '',
                status: isBounced ? 'bounced' : 'failed',
                timestamp: Date.now(),
              };

              if (hasDraftPreview) {
                setBroadcastCurrent({ ...failedEntry, status: 'writing' });
                const bodyLen = (emailInfo.body || '').length;
                const typingWait = Math.min(Math.max(bodyLen * 4, 1800), 5000);
                await new Promise(r => setTimeout(r, typingWait));
                setBroadcastCurrent(failedEntry);
                await new Promise(r => setTimeout(r, 900));
              }

              if (isBounced) {
                totalBounced++;
                setBroadcastBounce(totalBounced);
              } else {
                totalFailed++;
                setBroadcastError(totalFailed);
              }

              setBroadcastLog(prev => [...prev, failedEntry]);
            }

            setBroadcastProgress(emailIndex);
          }

          if (emailsSent.length === 0 && batchSent === 0 && (!data.remaining || data.remaining <= 0)) {
            hasMore = false;
          }

          setSendResults({ sent: totalSent, remaining: data.remaining || 0 });

          if (data.campaign_complete) {
            hasMore = false;
          } else if (batchSent === 0 && data.remaining > 0) {
            console.log(`[CAMPAIGNS] List broadcast: batch sent 0 but ${data.remaining} remaining — continuing...`);
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              toast.error('Campaign paused', { description: `Too many errors. ${data.remaining} leads remaining. The live sender paused safely.`, duration: 6000 });
              hasMore = false;
            } else {
              await new Promise(r => setTimeout(r, 2000));
            }
          } else if (batchSent === 0) {
            hasMore = false;
          } else {
            consecutiveErrors = 0;
            await new Promise(r => setTimeout(r, 400));
          }
        } catch (networkError: any) {
          consecutiveErrors++;
          const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
          
          if (isOffline) {
            toast.error('Connection lost', {
              description: 'Waiting for network... Campaign will resume automatically.',
              duration: 10000,
            });
            await new Promise<void>(resolve => {
              const onOnline = () => {
                window.removeEventListener('online', onOnline);
                clearTimeout(timeout);
                toast.success('Network reconnected', { description: 'Resuming campaign...', duration: 3000 });
                resolve();
              };
              const timeout = setTimeout(() => {
                window.removeEventListener('online', onOnline);
                hasMore = false;
                resolve();
              }, 300_000);
              window.addEventListener('online', onOnline);
            });
            if (!hasMore) break;
            consecutiveErrors = 0;
            continue;
          }
          
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            toast.error('Connection unstable', {
              description: 'Pausing live view without starting a background worker.',
              duration: 8000,
            });
            hasMore = false;
            break;
          }
          await new Promise(r => setTimeout(r, 2000 * consecutiveErrors));
        }
      }

      setBroadcastCurrent(null);
      setBroadcastDone(true);

      apiCache.invalidate('campaigns:*');
      dispatchAppEvent({ type: 'campaigns:changed' });
      await loadCampaigns();
    } catch (error: any) {
      console.error('[LIST-BROADCAST] Send error:', error);
      toast.error('Error sending campaign', { description: error.message, duration: 5000 });
      setBroadcastCurrent(null);
      setBroadcastDone(true);
    } finally {
      releaseSendLock(campaignId);
    }
  }

  async function deleteCampaign(campaignId: string) {
    if (isDemoMode) {
      toast('Demo Mode', { description: 'Deleting is disabled in demo mode.', duration: 3000 });
      return;
    }
    if (!(await confirmAsync({ title: 'Delete campaign?', message: t('campaigns.confirmDelete') as string, confirmLabel: 'Delete campaign', destructive: true }))) return;

    try {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}`,
        { method: 'DELETE' }
      );
      if (res && typeof (res as Response).ok === 'boolean' && !(res as Response).ok) {
        const body = await (res as Response).json().catch(() => ({}));
        throw new Error(body?.error || `Delete failed (${(res as Response).status})`);
      }

      if (selectedCampaign === campaignId) {
        setSelectedCampaign(null);
        setCampaignStats(null);
      }
      apiCache.invalidate('campaigns:*');
      dispatchAppEvent({ type: 'campaigns:deleted', ids: [campaignId] });
      await loadCampaigns();
      toast.success('Campaign deleted');
    } catch (error: any) {
      console.error('Error deleting campaign:', error);
      toast.error('Failed to delete campaign', {
        description: error?.message?.slice(0, 200) || 'Please try again.',
      });
    }
  }

  async function deleteAllCampaigns() {
    if (isDemoMode) {
      toast('Demo Mode', { description: 'Deleting is disabled in demo mode.', duration: 3000 });
      return;
    }
    if (!(await confirmAsync({ title: 'Delete all campaigns?', message: t('campaigns.confirmDeleteAll', { count: campaigns.length }) as string, confirmLabel: 'Delete all', destructive: true }))) return;
    if (!(await confirmAsync({ title: 'Are you absolutely sure?', message: t('campaigns.confirmDeleteAllAbsolute', { count: campaigns.length }) as string, confirmLabel: 'Yes, delete all', destructive: true }))) return;

    setDeletingAll(true);
    try {
      // Delete all campaigns in parallel
      await Promise.all(
        campaigns.map(campaign => 
          authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaign.id}`,
            { method: 'DELETE' }
          )
        )
      );

      setSelectedCampaign(null);
      setCampaignStats(null);
      apiCache.invalidate('campaigns:*');
      dispatchAppEvent({ type: 'campaigns:deleted', count: campaigns.length });
      await loadCampaigns();
      alert('All campaigns deleted successfully!');
    } catch (error: any) {
      console.error('Error deleting all campaigns:', error);
      alert('Failed to delete some campaigns. Please try again.');
    } finally {
      setDeletingAll(false);
    }
  }

  if (loading) {
    return <LoadingSpinner center size="lg" />;
  }

  // Show loading spinner while campaign stats are being fetched
  if (selectedCampaign && !campaignStats) {
    return (
      <div className="h-full flex flex-col bg-zinc-50 dark:bg-black items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-6 h-6 border-2 border-zinc-400 border-t-transparent rounded-full" />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('campaigns.loadingCampaign')}</span>
        </div>
      </div>
    );
  }

  if (selectedCampaign && campaignStats) {
    const campaign = campaigns.find(c => c.id === selectedCampaign);
    
    return (
      <div className="h-full flex flex-col bg-zinc-50 dark:bg-black">
        {/* Header — always visible */}
        <div className="flex-shrink-0 p-4 sm:p-8 pb-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <button
                onClick={() => {
                  if (sending) return;
                  setSelectedCampaign(null);
                  setCampaignStats(null);
                }}
                disabled={sending}
                className="flex items-center gap-1 text-sm text-zinc-500 hover:text-black dark:hover:text-white mb-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                {t('campaigns.back')}
              </button>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{campaign?.name}</h1>
                {sending && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-500 dark:bg-white opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-zinc-600 dark:bg-white" />
                    </span>
                    {t('campaigns.broadcasting')}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                <span className="text-sm text-zinc-500">{campaign?.product.replace('_', ' ')}</span>
                <span className="text-xs px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-zinc-600 dark:text-zinc-400 capitalize">{t('campaigns.toneLabel', { tone: campaign?.tone })}</span>
                {!sending && isLiveUpdating && (
                  <span className="flex items-center gap-1.5 text-xs text-[#1ED4A7] font-medium">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1ED4A7] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1ED4A7]"></span>
                    </span>
                    {t('campaigns.live')}
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-3 self-start sm:self-auto">
              {!sending && campaignStats.emailStats.sent > 0 && (
                <button
                  onClick={manualSyncTrackingData}
                  disabled={syncing}
                  className="p-2 text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                  title={t('campaigns.syncStatus')}
                >
                  <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
                </button>
              )}
              
              {/* Send button removed from header — replaced by Broadcast card below stats */}
              
              {!sending && (
                <button
                  onClick={() => campaign && deleteCampaign(campaign.id)}
                  className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content: Live broadcast OR stats */}
        {sending ? (
          <div className="flex-1 flex flex-col min-h-0 p-4 sm:px-8 sm:py-6">
            <div className="flex-1 flex flex-col min-h-0 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
              <SendingLiveView
                log={broadcastLog}
                currentEntry={broadcastCurrent}
                progress={broadcastProgress}
                total={broadcastTotal}
                successCount={broadcastSuccess}
                errorCount={broadcastError}
                bounceCount={broadcastBounce}
              />
            </div>
            <div className="flex-shrink-0 mt-4">
              {broadcastDone ? (
                <button
                  onClick={dismissBroadcast}
                  className="w-full px-4 py-3 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-xl font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {t('campaigns.done')} — {broadcastSuccess} {t('campaigns.delivered')}{broadcastBounce > 0 ? `, ${broadcastBounce} ${t('campaigns.bounced').toLowerCase()}` : ''}{broadcastError > 0 ? `, ${broadcastError} ${t('campaigns.failed')}` : ''}
                </button>
              ) : (
                <div className="flex items-center justify-center gap-2 py-2.5 text-xs text-zinc-400 dark:text-zinc-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-white/40 animate-pulse" />
                  <span>{t('campaigns.doNotClose')}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8 space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {[
                { label: t('campaigns.totalLeads'), value: campaignStats.leadStats.total, icon: Users, color: 'text-zinc-500 dark:text-zinc-400' },
                { label: t('campaigns.pending'), value: campaignStats.leadStats.pending, icon: Clock, color: 'text-zinc-400' },
                { label: t('campaigns.sent'), value: campaignStats.leadStats.sent, icon: Send, color: 'text-[#1ED4A7]' },
                { label: t('common.failed'), value: campaignStats.leadStats.failed, icon: XCircle, color: 'text-zinc-400' }
              ].map((stat, idx) => (
                <div key={idx} className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">{stat.label}</span>
                    <stat.icon className={`w-4 h-4 ${stat.color} flex-shrink-0`} />
                  </div>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-white truncate" title={String(stat.value)}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* ── Broadcast CTA ── */}
            {campaignStats.leadStats.pending > 0 && (
              <div className="relative overflow-hidden bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm">
                {/* Subtle decorative element */}
                <div className="absolute top-0 right-0 w-48 h-48 opacity-[0.03] dark:opacity-[0.04] pointer-events-none">
                  <Radio className="w-full h-full" />
                </div>
                <div className="relative p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                      <Radio className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('campaigns.readyToBroadcast')}</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {campaignStats.leadStats.pending === 1
                          ? t('campaigns.pendingLeadsAIDesc', { count: campaignStats.leadStats.pending })
                          : t('campaigns.pendingLeadsAIDesc_plural', { count: campaignStats.leadStats.pending })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => sendCampaign(selectedCampaign)}
                    className="flex items-center justify-center gap-2.5 px-5 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-sm font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all whitespace-nowrap shadow-sm flex-shrink-0 group"
                  >
                    <Play className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
                    {t('campaigns.startBroadcast')}
                  </button>
                </div>
              </div>
            )}

            {/* Detailed Performance */}
            {campaignStats.emailStats.sent > 0 && (
              <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-6">{t('campaigns.emailPerformance')}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-6">
                  {[
                    { label: t('campaigns.sent'), value: campaignStats.emailStats.sent, color: 'text-zinc-600 dark:text-zinc-400' },
                    { label: t('common.delivered'), value: campaignStats.emailStats.delivered, sub: `${((campaignStats.emailStats.delivered / (campaignStats.emailStats.sent || 1)) * 100).toFixed(1)}%`, color: 'text-[#1ED4A7]' },
                    { label: t('campaigns.opened'), value: campaignStats.emailStats.opened, sub: `${((campaignStats.emailStats.opened / (campaignStats.emailStats.delivered || 1)) * 100).toFixed(1)}%`, color: 'text-[#1ED4A7]' },
                    { label: t('campaigns.replied'), value: campaignStats.emailStats.replied || 0, sub: `${((campaignStats.emailStats.replied / (campaignStats.emailStats.sent || 1)) * 100).toFixed(1)}%`, color: 'text-[#1ED4A7]', highlight: true },
                    { label: t('campaigns.positive'), value: campaignStats.emailStats.positive_replies || 0, sub: `${((campaignStats.emailStats.positive_replies / (campaignStats.emailStats.sent || 1)) * 100).toFixed(1)}%`, color: 'text-[#1ED4A7]', highlight: true },
                    { label: t('campaigns.meetings'), value: campaignStats.emailStats.meetings_booked || 0, color: 'text-[#1ED4A7]', highlight: true },
                    { label: t('campaigns.clicked'), value: campaignStats.emailStats.clicked, sub: `${((campaignStats.emailStats.clicked / (campaignStats.emailStats.sent || 1)) * 100).toFixed(1)}%`, color: 'text-zinc-400' },
                    { label: t('campaigns.bounced'), value: campaignStats.emailStats.bounced, color: 'text-zinc-400' }
                  ].map((stat, idx) => (
                    <div key={idx} className={`${stat.highlight ? 'bg-zinc-50 dark:bg-zinc-900 -m-2 p-2 rounded-lg' : ''}`}>
                      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1 whitespace-nowrap">{stat.label}</p>
                      <p className={`text-xl font-semibold ${stat.color} whitespace-nowrap`}>{stat.value}</p>
                      {stat.sub && <p className="text-xs text-zinc-400 mt-0.5 whitespace-nowrap">{stat.sub}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Bounced Contacts Section ── */}
            {campaignStats.emailStats.bounced > 0 && (
              <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
                <button
                  onClick={() => {
                    if (!bouncedExpanded) {
                      setBouncedExpanded(true);
                      if (bouncedContacts.length === 0) {
                        loadBouncedContacts(selectedCampaign);
                      }
                    } else {
                      setBouncedExpanded(false);
                    }
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {t('campaigns.bouncedContacts')}
                        <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          {campaignStats.emailStats.bounced}
                        </span>
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {t('campaigns.bouncedContactsDesc')}
                      </p>
                    </div>
                  </div>
                  {bouncedExpanded ? (
                    <ChevronUp className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  )}
                </button>

                {bouncedExpanded && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800/50">
                    {loadingBounced ? (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
                        <span className="text-sm text-zinc-500">{t('campaigns.loadingBounced')}</span>
                      </div>
                    ) : bouncedContacts.length === 0 ? (
                      <div className="px-5 py-6 text-center">
                        <p className="text-sm text-zinc-400">{t('campaigns.noBounceDetails')}</p>
                        <p className="text-xs text-zinc-400 mt-1">{t('campaigns.bounceDataInfo')}</p>
                      </div>
                    ) : (
                      <>
                        {/* Delete All Bounced button */}
                        <div className="flex items-center justify-between px-5 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800/30">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {bouncedContacts.length} bounced contact{bouncedContacts.length !== 1 ? 's' : ''}
                          </span>
                          <button
                            onClick={deleteAllBouncedContacts}
                            disabled={deletingAllBounced}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/40 text-zinc-600 dark:text-zinc-400 text-[11px] font-medium rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700/50 transition-colors disabled:opacity-50"
                          >
                            {deletingAllBounced ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {t('campaigns.deleteAllBounced')}
                          </button>
                        </div>
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/30 max-h-[420px] overflow-y-auto">
                          {bouncedContacts.map((contact: any) => (
                            <div
                              key={contact.id}
                              onClick={() => contact.leadId && setDrillLeadId(contact.leadId)}
                              onMouseEnter={() => contact.leadId && preloadLeadDetailModal()}
                              className={`group px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors ${contact.leadId ? 'cursor-pointer' : ''}`}
                            >
                              <div className="flex items-start gap-3">
                                {/* Avatar */}
                                <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                                    {(contact.leadName && contact.leadName !== 'Unknown' ? contact.leadName : contact.leadEmail || '?')[0]?.toUpperCase()}
                                  </span>
                                </div>

                                {/* Lead Details */}
                                <div className="flex-1 min-w-0">
                                  {/* Row 1: Name + badges */}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate max-w-[200px]">
                                      {contact.leadName !== 'Unknown' ? contact.leadName : (contact.leadEmail || 'Unknown')}
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/30 text-zinc-600 dark:text-zinc-400 font-semibold flex-shrink-0 border border-zinc-200/60 dark:border-zinc-700/40">
                                      {t('campaigns.bounced')}
                                    </span>
                                    {contact.leadSeniority && contact.leadSeniority !== 'unknown' && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium flex-shrink-0">
                                        {contact.leadSeniority}
                                      </span>
                                    )}
                                    {contact.bouncedAt && (
                                      <span className="text-[10px] text-zinc-400 dark:text-zinc-600 flex-shrink-0">
                                        {new Date(contact.bouncedAt).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>

                                  {/* Row 2: Email */}
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <Mail className="w-3 h-3 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">{contact.leadEmail || '—'}</span>
                                  </div>

                                  {/* Row 3: Company + Title */}
                                  {(contact.leadCompany || contact.leadTitle) && (
                                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                                      {contact.leadCompany && (
                                        <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                                          <Building2 className="w-3 h-3 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                                          <span className="truncate max-w-[160px]">{contact.leadCompany}</span>
                                        </span>
                                      )}
                                      {contact.leadTitle && (
                                        <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                                          <Briefcase className="w-3 h-3 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                                          <span className="truncate max-w-[180px]">{contact.leadTitle}</span>
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Row 4: Phone + Location + Industry */}
                                  {(contact.leadPhone || contact.leadCity || contact.leadIndustry) && (
                                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                                      {contact.leadPhone && (
                                        <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                                          <Phone className="w-3 h-3 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                                          <span>{contact.leadPhone}</span>
                                        </span>
                                      )}
                                      {contact.leadCity && (
                                        <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                                          <MapPin className="w-3 h-3 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                                          <span className="truncate max-w-[140px]">{contact.leadCity}{contact.leadCountry ? `, ${contact.leadCountry}` : ''}</span>
                                        </span>
                                      )}
                                      {contact.leadIndustry && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 font-medium">
                                          {contact.leadIndustry}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Row 5: Subject line */}
                                  {contact.subject && (
                                    <div className="flex items-center gap-1.5 mt-1.5">
                                      <Send className="w-3 h-3 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
                                      <span className="text-[11px] text-zinc-400 dark:text-zinc-600 truncate italic" title={contact.subject}>
                                        {contact.subject}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* Delete Button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete this bounced lead${contact.leadName !== 'Unknown' ? ` (${contact.leadName})` : ''}? This cannot be undone.`)) {
                                      deleteBouncedContact(contact.leadId, contact.id);
                                    }
                                  }}
                                  disabled={deletingBouncedId === contact.id}
                                  className="flex-shrink-0 p-2 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50 mt-0.5"
                                  title="Delete this lead"
                                >
                                  {deletingBouncedId === contact.id ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Opened Contacts Section ── */}
            {campaignStats.emailStats.opened > 0 && (
              <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
                <button
                  onClick={() => {
                    if (!openedExpanded) {
                      setOpenedExpanded(true);
                      if (openedContacts.length === 0) loadOpenedContacts(selectedCampaign);
                    } else {
                      setOpenedExpanded(false);
                    }
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <Eye className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                        Opened
                        <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">{campaignStats.emailStats.opened}</span>
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Leads who opened your email</p>
                    </div>
                  </div>
                  {openedExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openedExpanded && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800/50">
                    {loadingOpened ? (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
                        <span className="text-sm text-zinc-500">Loading…</span>
                      </div>
                    ) : openedContacts.length === 0 ? (
                      <div className="px-5 py-6 text-center text-sm text-zinc-400">No opens recorded yet.</div>
                    ) : (
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                        {openedContacts.map((c: any) => (
                          <button
                            key={c.id}
                            onClick={() => c.leadId && setDrillLeadId(c.leadId)}
                            onMouseEnter={() => c.leadId && preloadLeadDetailModal()}
                            onFocus={() => c.leadId && preloadLeadDetailModal()}
                            disabled={!c.leadId}
                            className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors disabled:cursor-default"
                          >
                            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex-shrink-0">
                              {(c.leadName || c.leadEmail || '?').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="font-medium text-sm text-zinc-900 dark:text-white truncate">{c.leadName}</span>
                                {c.leadCompany && <span className="text-xs text-zinc-500">· {c.leadCompany}</span>}
                              </div>
                              <div className="text-xs text-zinc-500 truncate">{c.leadEmail}</div>
                              {c.openedAt && (
                                <div className="text-[11px] text-zinc-400 mt-0.5">
                                  Opened {new Date(c.openedAt).toLocaleString()}
                                </div>
                              )}
                            </div>
                            {c.leadId && <ChevronRight className="w-4 h-4 text-zinc-400 dark:text-zinc-600 flex-shrink-0 mt-1.5" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Clicked Contacts Section ── */}
            {campaignStats.emailStats.clicked > 0 && (
              <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
                <button
                  onClick={() => {
                    if (!clickedExpanded) {
                      setClickedExpanded(true);
                      if (clickedContacts.length === 0) loadClickedContacts(selectedCampaign);
                    } else {
                      setClickedExpanded(false);
                    }
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <MousePointerClick className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                        Clicked
                        <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">{campaignStats.emailStats.clicked}</span>
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Leads who clicked a link in your email</p>
                    </div>
                  </div>
                  {clickedExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {clickedExpanded && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800/50">
                    {loadingClicked ? (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
                        <span className="text-sm text-zinc-500">Loading…</span>
                      </div>
                    ) : clickedContacts.length === 0 ? (
                      <div className="px-5 py-6 text-center text-sm text-zinc-400">No clicks recorded yet.</div>
                    ) : (
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                        {clickedContacts.map((c: any) => (
                          <button
                            key={c.id}
                            onClick={() => c.leadId && setDrillLeadId(c.leadId)}
                            onMouseEnter={() => c.leadId && preloadLeadDetailModal()}
                            onFocus={() => c.leadId && preloadLeadDetailModal()}
                            disabled={!c.leadId}
                            className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors disabled:cursor-default"
                          >
                            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex-shrink-0">
                              {(c.leadName || c.leadEmail || '?').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="font-medium text-sm text-zinc-900 dark:text-white truncate">{c.leadName}</span>
                                {c.leadCompany && <span className="text-xs text-zinc-500">· {c.leadCompany}</span>}
                              </div>
                              <div className="text-xs text-zinc-500 truncate">{c.leadEmail}</div>
                              {c.clickedAt && (
                                <div className="text-[11px] text-zinc-400 mt-0.5">
                                  Clicked {new Date(c.clickedAt).toLocaleString()}
                                </div>
                              )}
                            </div>
                            {c.leadId && <ChevronRight className="w-4 h-4 text-zinc-400 dark:text-zinc-600 flex-shrink-0 mt-1.5" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-black">
      <div className="flex-shrink-0 p-4 sm:p-8 bg-zinc-50 dark:bg-black z-10">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('campaigns.title', 'Campaigns')}</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('sidebar.outreach', 'Manage outreach campaigns')}</p>
            </div>
            
            {activeTab === 'campaigns' && onCreateCampaign && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {campaigns.length > 0 && (
                  <button
                    onClick={deleteAllCampaigns}
                    disabled={deletingAll}
                    className="flex items-center justify-center min-h-[44px] min-w-[44px] sm:px-4 bg-white dark:bg-white/5 border border-zinc-200 dark:border-zinc-700/30 text-zinc-600 dark:text-zinc-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/30 transition-colors text-sm font-medium disabled:opacity-50 whitespace-nowrap tap-target-override"
                    title="Delete all campaigns"
                  >
                    {deletingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    <span className="hidden sm:inline ml-2">{t('campaigns.deleteAll', 'Delete All')}</span>
                  </button>
                )}
                <button
                  onClick={onCreateCampaign}
                  className="flex items-center justify-center min-h-[44px] gap-2 px-4 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap tap-target-override"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('campaigns.newCampaign', 'New Campaign')}</span>
                  <span className="sm:hidden">Create</span>
                </button>
              </div>
            )}
          </div>
          
          <div className="flex overflow-x-auto scrollbar-hide pb-1 -mb-1 w-full">
            {/* Tab switcher — only show when admin has multiple tabs */}
            <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg flex-shrink-0">
                <button
                  onClick={() => setActiveTab('campaigns')}
                  className={`min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap tap-target-override flex items-center justify-center ${
                    activeTab === 'campaigns' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {t('campaigns.title', 'Campaigns')}
                </button>
                <button
                  onClick={() => setActiveTab('sequences')}
                  className={`min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap tap-target-override flex items-center justify-center ${
                    activeTab === 'sequences' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {t('campaigns.sequences', 'Sequences')}
                </button>
                <button
                  onClick={() => setActiveTab('linkedin-tasks')}
                  className={`min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap flex items-center justify-center gap-1.5 tap-target-override ${
                    activeTab === 'linkedin-tasks' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {t('campaigns.linkedinTasks', 'Tasks')}
                </button>
                {userEmail === 'admin@contndr.com' && (
                <button
                  onClick={() => setActiveTab('fast-money')}
                  className={`min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap tap-target-override flex items-center justify-center ${
                    activeTab === 'fast-money' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {t('campaigns.fastMoney', 'Fast Money')}
                </button>
                )}
              </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8 pt-0">
        {activeTab === 'fast-money' ? (
          <FastMoneyTargets />
        ) : activeTab === 'sequences' ? (
          <SequenceBuilder />
        ) : activeTab === 'linkedin-tasks' ? (
          <LinkedInTasks />
        ) : (
          <>
            {/* ── List-Level Broadcast Overlay ── */}
            {sending && listBroadcastCampaignId && (
              <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-lg bg-white dark:bg-[#0a0a0a]">
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-[#0f0f0f] border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Radio className="w-4 h-4 text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{listBroadcastCampaignName}</span>
                    {!broadcastDone && (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 flex-shrink-0">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-500 dark:bg-white opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-zinc-600 dark:bg-white" />
                        </span>
                        {t('campaigns.live', 'Live')}
                      </span>
                    )}
                  </div>
                  {broadcastDone && (
                    <button
                      onClick={dismissBroadcast}
                      className="px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center gap-1.5 flex-shrink-0"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {t('campaigns.done', 'Done')}
                    </button>
                  )}
                </div>
                {/* Live send view — only while actively sending, collapses when done */}
                {!broadcastDone && (
                  <>
                    <div style={{ height: '400px' }}>
                      <SendingLiveView
                        log={broadcastLog}
                        currentEntry={broadcastCurrent}
                        progress={broadcastProgress}
                        total={broadcastTotal}
                        successCount={broadcastSuccess}
                        errorCount={broadcastError}
                        bounceCount={broadcastBounce}
                      />
                    </div>
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-[#0f0f0f] border-t border-zinc-200 dark:border-zinc-800">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-white/40 animate-pulse" />
                      <span>{t('campaigns.doNotClose', 'Do not close this window')}</span>
                    </div>
                  </>
                )}
                {/* Compact completion row — replaces the full log once done */}
                {broadcastDone && (
                  <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-3 bg-white dark:bg-[#0a0a0a]">
                    <CheckCircle2 className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                    <div className="flex items-center gap-3 text-xs min-w-0 flex-1">
                      <span className="text-[#1ED4A7] font-semibold">{broadcastSuccess} {t('campaigns.delivered', 'delivered')}</span>
                      {broadcastBounce > 0 && <span className="text-zinc-400 font-semibold">{broadcastBounce} {t('campaigns.bounced', 'bounced')}</span>}
                      {broadcastError > 0 && <span className="text-zinc-400 font-semibold">{broadcastError} {t('campaigns.failed', 'failed')}</span>}
                    </div>
                    <button
                      onClick={dismissBroadcast}
                      className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors flex-shrink-0"
                    >
                      {t('campaigns.dismiss', 'Dismiss')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Auto-Resume Banner */}
            {pendingCampaigns.length > 0 && !sending && (
              <div className="mb-4 flex items-center gap-3 bg-[#1ED4A7]/5 border border-[#1ED4A7]/20 rounded-xl px-4 py-3">
                <div className="relative flex h-2.5 w-2.5 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1ED4A7] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#1ED4A7]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">
                    {autoResuming ? t('campaigns.sending', 'Sending...') : t('campaigns.autoSending', 'Auto-sending in progress')}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {pendingCampaigns.length} campaign{pendingCampaigns.length !== 1 ? 's' : ''} with{' '}
                    {pendingCampaigns.reduce((sum, p) => sum + p.remaining, 0)} emails remaining — sending automatically
                  </p>
                </div>
                {autoResuming && <RefreshCw className="w-4 h-4 animate-spin text-[#1ED4A7] flex-shrink-0" />}
              </div>
            )}

            {/* Scope Toggle — My Campaigns / Team */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg">
                <button
                  onClick={() => setCampaignScope('mine')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                    campaignScope === 'mine' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  {t('campaigns.myCampaigns', 'My Campaigns')}
                  <span className="text-[10px] opacity-60">({campaigns.length})</span>
                </button>
                <button
                  onClick={() => setCampaignScope('team')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                    campaignScope === 'team' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  {t('campaigns.teamLabel', 'Team')}
                  {teamLoaded && <span className="text-[10px] opacity-60">({teamCampaigns.filter(c => !c.is_own).length})</span>}
                </button>
              </div>

              {/* Owner filter (team scope only) */}
              {campaignScope === 'team' && teamLoaded && teamMembers.length > 0 && (
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-black border border-zinc-200 dark:border-white/10 rounded-lg text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/30"
                >
                  <option value="all">{t('campaigns.allMembers', 'All Members')}</option>
                  {teamMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.name || m.email}</option>
                  ))}
                </select>
              )}
            </div>

            {/* ═══════ MY CAMPAIGNS ═══════ */}
            {campaignScope === 'mine' && (
            <>
            {/* Filters */}
            {campaigns.length > 0 && (
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                {(userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com') && (
                  <>
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('campaigns.brand', 'Brand')}:</label>
                    <select
                      value={brandFilter}
                      onChange={(e) => setBrandFilter(e.target.value)}
                      className="px-3 py-1.5 bg-white dark:bg-black border border-zinc-200 dark:border-white/10 rounded-lg text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                    >
                      <option value="all">{t('campaigns.allBrands')} ({campaigns.length})</option>
                      <option value="contndr">Contndr ({campaigns.filter(c => normalizeBrand(c.brand) === 'contndr').length})</option>
                      <option value="roadr">Roadr ({campaigns.filter(c => normalizeBrand(c.brand) === 'roadr').length})</option>
                      <option value="sourcr">Sourcr ({campaigns.filter(c => normalizeBrand(c.brand) === 'sourcr').length})</option>
                      <option value="covera">Covera ({campaigns.filter(c => normalizeBrand(c.brand) === 'covera').length})</option>
                    </select>
                  </>
                )}
                
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 ml-2">{t('campaigns.type', 'Type')}:</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-black border border-zinc-200 dark:border-white/10 rounded-lg text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                >
                  <option value="all">{t('campaigns.allTypes')} ({campaigns.length})</option>
                  <option value="investor">{t('campaigns.investor')} ({campaigns.filter(c => c.product?.includes('_investor')).length})</option>
                  <option value="customer">{t('campaigns.customer')} ({campaigns.filter(c => !c.product?.includes('_investor')).length})</option>
                </select>
                
                {(brandFilter !== 'all' || typeFilter !== 'all') && (
                  <span className="text-xs text-zinc-500">
                    {t('campaigns.showing')} {campaigns.filter(c => {
                      const matchesBrand = brandFilter === 'all' || normalizeBrand(c.brand) === brandFilter;
                      const matchesType = typeFilter === 'all' || 
                        (typeFilter === 'investor' && c.product?.includes('_investor')) ||
                        (typeFilter === 'customer' && !c.product?.includes('_investor'));
                      return matchesBrand && matchesType;
                    }).length} {t('campaigns.of')} {campaigns.length} {t('campaigns.title').toLowerCase()}
                  </span>
                )}
              </div>
            )}
            
            <div className="grid gap-4">
            {campaigns.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10">
                <Send className="w-12 h-12 mx-auto text-zinc-300 mb-4" />
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white">{t('campaigns.noCampaigns', 'No campaigns yet')}</h3>
                <p className="text-zinc-500 mt-1 mb-6">{t('campaigns.createOutreach', 'Create your first campaign to start outreach')}</p>
                {onCreateCampaign && (
                  <button
                    onClick={onCreateCampaign}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90"
                  >
                    <Plus className="w-4 h-4" />
                    {t('campaigns.createCampaign')}
                  </button>
                )}
              </div>
            ) : (
              <>
                {campaigns.filter((campaign) => {
                  const matchesBrand = brandFilter === 'all' || normalizeBrand(campaign.brand) === brandFilter;
                  const matchesType = typeFilter === 'all' || 
                    (typeFilter === 'investor' && campaign.product?.includes('_investor')) ||
                    (typeFilter === 'customer' && !campaign.product?.includes('_investor'));
                  return matchesBrand && matchesType;
                }).length === 0 ? (
                  <div className="text-center py-12 bg-white dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10">
                    <Send className="w-12 h-12 mx-auto text-zinc-300 mb-4" />
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-white">
                      {t('campaigns.noFilteredCampaigns')}
                    </h3>
                    <p className="text-zinc-500 mt-1 mb-6">{t('campaigns.noFilteredCampaigns')}</p>
                    <button
                      onClick={() => {
                        setBrandFilter('all');
                        setTypeFilter('all');
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90"
                    >
                      {t('campaigns.showAllCampaigns')}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                    {campaigns
                      .filter((campaign) => {
                        const matchesBrand = brandFilter === 'all' || normalizeBrand(campaign.brand) === brandFilter;
                        const matchesType = typeFilter === 'all' || 
                          (typeFilter === 'investor' && campaign.product?.includes('_investor')) ||
                          (typeFilter === 'customer' && !campaign.product?.includes('_investor'));
                        return matchesBrand && matchesType;
                      })
                      .map((campaign) => (
                  <div
                    key={campaign.id}
                    onClick={() => viewCampaign(campaign.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viewCampaign(campaign.id); }}
                    className="group flex flex-col h-full bg-white dark:bg-black border border-zinc-200 dark:border-white/10 rounded-xl p-5 hover:border-zinc-300 dark:hover:border-white/20 hover:shadow-md transition-all text-left cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-4 w-full gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 bg-zinc-100 dark:bg-white/10 rounded-lg flex items-center justify-center group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black transition-colors flex-shrink-0">
                          <Send className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-zinc-900 dark:text-white truncate" title={campaign.name}>{campaign.name}</h3>
                          <p className="text-xs text-zinc-500">{new Date(campaign.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <span className={`flex-shrink-0 px-2 py-1 text-xs rounded-full uppercase tracking-wider font-medium whitespace-nowrap ${
                        campaign.status === 'completed' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                        campaign.status === 'active' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20' :
                        'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-400'
                      }`}>
                        {t(`campaigns.${campaign.status}`, campaign.status)}
                      </span>
                    </div>
                    
                    <div className="mt-auto space-y-2 w-full pt-2 border-t border-zinc-100 dark:border-white/10">
                      <div className="flex justify-between items-center text-xs text-zinc-500 uppercase tracking-wider">
                        <span>{t('campaigns.brand')}</span>
                        <div className="flex items-center gap-2">
                          {campaign.product?.includes('_investor') && (
                            <span className="bg-zinc-100 dark:bg-zinc-800/30 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded text-xs font-medium">
                              {t('campaigns.investor')}
                            </span>
                          )}
                          {campaign.brand && (
                            <span className={`font-medium normal-case px-2 py-0.5 rounded capitalize ${
                              campaign.brand.toLowerCase() === 'roadr' ? 'bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-white' :
                              campaign.brand.toLowerCase() === 'sourcr' ? 'bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-white' :
                              campaign.brand.toLowerCase() === 'covera' ? 'bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-white' :
                              'bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-white'
                            }`}>{userEmail === 'or@roadr.com' ? normalizeBrand(campaign.brand) : 'Custom'}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-zinc-500 uppercase tracking-wider">
                        <span>{t('campaigns.product')}</span>
                        <span className="text-zinc-900 dark:text-white font-medium normal-case truncate max-w-[50%] text-right">{campaign.product.replace('_', ' ')}</span>
                      </div>
                      <div className="flex justify-between text-xs text-zinc-500 uppercase tracking-wider">
                        <span>{t('campaigns.tone')}</span>
                        <span className="capitalize text-zinc-900 dark:text-white font-medium normal-case">{campaign.tone}</span>
                      </div>
                    </div>
                    
                    {/* Broadcast button */}
                    {campaign.status === 'active' && (
                      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/10" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            startListBroadcast(campaign.id, campaign.name);
                          }}
                          disabled={sending}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all disabled:opacity-50"
                        >
                          <Radio className="w-3 h-3" />
                          {t('campaigns.broadcast')}
                        </button>
                      </div>
                    )}
                    </div>
                    ))}
                  </div>
                )}
              </>
            )}
            </div>
            </>)}

            {/* ═══════ TEAM CAMPAIGNS ═══════ */}
            {campaignScope === 'team' && (
              loadingTeam ? (
                <div className="flex items-center justify-center py-20">
                  <div className="animate-spin w-6 h-6 border-2 border-zinc-400 border-t-transparent rounded-full" />
                  <span className="ml-3 text-zinc-500 text-sm">{t('campaigns.loadingTeam')}</span>
                </div>
              ) : teamCampaigns.length === 0 || teamSize <= 1 ? (
                <div className="text-center py-16 bg-white dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10">
                  <div className="w-14 h-14 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Users className="w-6 h-6 text-zinc-400" />
                  </div>
                  <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-1">
                    {teamSize <= 1 ? 'No team members yet' : 'No team campaigns'}
                  </h3>
                  <p className="text-sm text-zinc-500 max-w-sm mx-auto">
                    {teamSize <= 1
                      ? 'Invite team members from Settings to share campaigns and coordinate outreach.'
                      : 'Your team members haven\'t created any campaigns yet.'}
                  </p>
                </div>
              ) : (() => {
                const filtered = teamCampaigns.filter(c => {
                  if (ownerFilter !== 'all' && c.user_id !== ownerFilter) return false;
                  return true;
                });
                return (
                  <>
                    {/* Team stats banner */}
                    <div className="mb-4 flex items-center justify-between bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Users className="w-4 h-4 text-[#1ED4A7]" />
                        <span className="text-sm text-zinc-600 dark:text-zinc-300">
                          <span className="font-medium text-zinc-900 dark:text-white">{filtered.length}</span> campaign{filtered.length !== 1 ? 's' : ''} across{' '}
                          <span className="font-medium text-zinc-900 dark:text-white">{teamSize}</span> team member{teamSize !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <button
                        onClick={() => loadTeamCampaigns(true)}
                        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Refresh
                      </button>
                    </div>

                    {filtered.length === 0 ? (
                      <div className="text-center py-12 bg-white dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10">
                        <p className="text-zinc-500 text-sm">No campaigns found for this member</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                        {filtered.map((campaign) => (
                          <button
                            key={campaign.id}
                            onClick={() => viewCampaign(campaign.id)}
                            className={`group flex flex-col h-full bg-white dark:bg-black border rounded-xl p-5 hover:shadow-md transition-all text-left ${
                              campaign.is_own
                                ? 'border-[#1ED4A7]/20 dark:border-[#1ED4A7]/10'
                                : 'border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-3 w-full gap-3">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-10 h-10 bg-zinc-100 dark:bg-white/10 rounded-lg flex items-center justify-center group-hover:bg-black group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-black transition-colors flex-shrink-0">
                                  <Send className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h3 className="font-semibold text-zinc-900 dark:text-white truncate" title={campaign.name}>{campaign.name}</h3>
                                  <p className="text-xs text-zinc-500">{new Date(campaign.created_at).toLocaleDateString()}</p>
                                </div>
                              </div>
                              <span className={`flex-shrink-0 px-2 py-1 text-xs rounded-full uppercase tracking-wider font-medium whitespace-nowrap ${
                                campaign.status === 'completed' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                                campaign.status === 'active' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20' :
                                'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-400'
                              }`}>
                                {campaign.status}
                              </span>
                            </div>
                            
                            {/* Attribution — who created this campaign */}
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] font-bold text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                                {(campaign.created_by || '?')[0].toUpperCase()}
                              </div>
                              <span className="text-xs text-zinc-500 truncate">
                                {campaign.is_own ? 'You' : campaign.created_by || 'Team Member'}
                              </span>
                              {campaign.is_own && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-[#1ED4A7]/10 text-[#1ED4A7] rounded font-medium">yours</span>
                              )}
                            </div>

                            <div className="mt-auto space-y-2 w-full pt-2 border-t border-zinc-100 dark:border-white/10">
                              <div className="flex justify-between text-xs text-zinc-500 uppercase tracking-wider">
                                <span>Product</span>
                                <span className="text-zinc-900 dark:text-white font-medium normal-case truncate max-w-[50%] text-right">{campaign.product?.replace('_', ' ') || '-'}</span>
                              </div>
                              <div className="flex justify-between text-xs text-zinc-500 uppercase tracking-wider">
                                <span>Tone</span>
                                <span className="capitalize text-zinc-900 dark:text-white font-medium normal-case">{campaign.tone || '-'}</span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </>
        )}
      </div>
      {drillLeadId && (
        <LeadDetailModal leadId={drillLeadId} onClose={() => setDrillLeadId(null)} />
      )}
    </div>
  );
}

export default CampaignsView;
