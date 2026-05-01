// Rebuild: 2026-03-17T12:00 — force recompile after chunk loading failure fix
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Mail, MailOpen, Users, DollarSign, CircleDollarSign, Trophy, Target } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { notifyEmailClicked, notifyEmailOpened, notifyHighEngagement } from '../lib/notifications';
import { RecentActivityFeed } from './RecentActivityFeed';
import { DashboardTeamSnapshot } from './DashboardTeamSnapshot';
import { DashboardPipelineSnapshot } from './DashboardPipelineSnapshot';
import { DashboardTodayFocus } from './DashboardTodayFocus';
import { useRealtimeRefresh } from './RealtimeProvider';
import { apiCache } from '../lib/api-cache';
import { LoadingSpinner } from './LoadingSpinner';
import { syncEmailStatuses } from '../utils/syncEmailStatuses';
import { useAppEventRefresh } from '../lib/app-events';
import { useDemoMode, DEMO_DASHBOARD_STATS, DEMO_REVENUE_SNAP, DEMO_RECENT_CAMPAIGNS, DEMO_FOLLOW_UPS } from './DemoContext';
import { useScrollHeader } from '../hooks/useScrollHeader';
import { getLeadLimitForPlan } from '../lib/plan-entitlements';

// ─── localStorage snapshot for instant hydration ──────────────────────
// Updated: 2026-02-23 - Fixed build after email provider guard additions
const SNAPSHOT_KEY = 'contndr:dashboard:snapshot';
const SNAPSHOT_MAX_AGE = 10 * 60 * 1000; // 10 minutes — stale snapshots are ignored

function readSnapshot(): { stats: DashboardStats; recentCampaigns: any[]; upcomingFollowUps: any[]; availableBrands: string[]; campaignIds: any[]; ts: number } | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (Date.now() - snap.ts > SNAPSHOT_MAX_AGE) {
      localStorage.removeItem(SNAPSHOT_KEY);
      return null;
    }
    return snap;
  } catch { return null; }
}

function writeSnapshot(data: { stats: DashboardStats; recentCampaigns: any[]; upcomingFollowUps: any[]; availableBrands: string[]; campaignIds: any[] }) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ ...data, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

interface DashboardStats {
  totalLeads: number;
  totalCampaigns: number;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  openRate: number;
  clickRate: number;
  deliveryRate: number;
  emailsDelivered: number;
  emailsReplied: number; // Replied count from campaigns
  leadsHistory?: number[]; // Historical lead counts for sparkline
  campaignsHistory?: number[]; // Historical campaign counts
  emailsHistory?: number[]; // Historical email counts
  opensHistory?: number[]; // Historical opens
  clicksHistory?: number[]; // Historical clicks
  deliveryHistory?: number[]; // Historical delivery rate
  linkClicks?: number; // Link clicks
}

interface DashboardProps {
  onNavigate: (view: string) => void;
  subscriptionStatus?: any;
  onUpgrade?: () => void;
}

export function Dashboard({ onNavigate, subscriptionStatus, onUpgrade }: DashboardProps) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const leadLimit = getLeadLimitForPlan(subscriptionStatus?.plan);
  const isUnlimitedLeads = leadLimit < 0;

  // Real-time sync: auto-refresh when events come in from other tabs/users
  const dashboardRefreshKey = useRealtimeRefresh([
    'email:sent', 'email:opened', 'email:clicked', 'email:replied', 'email:bounced',
    'campaign:completed', 'lead:created', 'lead:deleted', 'lead:bulk_action',
    'pipeline:deal_created', 'pipeline:deal_moved', 'import:completed',
  ]);
  // Hydrate from localStorage snapshot for instant paint
  const snapshot = isDemoMode ? null : readSnapshot();

  const [stats, setStats] = useState<DashboardStats>(
    isDemoMode ? DEMO_DASHBOARD_STATS : (snapshot?.stats ?? {
      totalLeads: 0,
      totalCampaigns: 0,
      emailsSent: 0,
      emailsOpened: 0,
      emailsClicked: 0,
      openRate: 0,
      clickRate: 0,
      deliveryRate: 0,
      emailsDelivered: 0,
      linkClicks: 0,
      emailsReplied: 0,
    })
  );
  const [recentCampaigns, setRecentCampaigns] = useState<any[]>(isDemoMode ? DEMO_RECENT_CAMPAIGNS : (snapshot?.recentCampaigns ?? []));
  const [loading, setLoading] = useState(isDemoMode ? false : !snapshot);
  const [upcomingFollowUps, setUpcomingFollowUps] = useState<any[]>(isDemoMode ? DEMO_FOLLOW_UPS : (snapshot?.upcomingFollowUps ?? []));
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [syncing, setSyncing] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [availableBrands, setAvailableBrands] = useState<string[]>(isDemoMode ? ['contndr'] : (snapshot?.availableBrands ?? []));
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>(isDemoMode ? 'connected' : 'connecting');
  const [isAuthReady, setIsAuthReady] = useState(isDemoMode ? true : false);
  const [userId, setUserId] = useState<string | null>(isDemoMode ? 'demo-sandbox-user' : null);
  const [userEmail, setUserEmail] = useState<string | null>(isDemoMode ? 'demo@contndr.com' : null);
  // Ref to store user's campaign IDs for filtering real-time events securely
  const userCampaignIdsRef = useRef<Set<any>>(new Set(snapshot?.campaignIds ?? []));
  const demoSeedAttemptedRef = useRef(false);
  const [isDemoSeeding, setIsDemoSeeding] = useState(false);

  // Revenue snapshot for top cards
  const [revenueSnap, setRevenueSnap] = useState<{
    mrr: number; pipelineValue: number; activeDeals: number; wonDeals: number; closeRate: number;
  }>(isDemoMode ? DEMO_REVENUE_SNAP : (() => {
    try {
      const snap = readSnapshot();
      if (snap) return { mrr: 0, pipelineValue: 0, activeDeals: 0, wonDeals: 0, closeRate: 0 };
    } catch {}
    return { mrr: 0, pipelineValue: 0, activeDeals: 0, wonDeals: 0, closeRate: 0 };
  })());

  // Wait for auth to be ready before loading data (skip in demo mode)
  useEffect(() => {
    if (isDemoMode) return; // Demo mode is already initialized above

    const checkAuthReady = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setUserId(data.session.user.id);
        setUserEmail(data.session.user.email || null);
        setIsAuthReady(true);
      }
    };
    
    checkAuthReady();
    
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setUserId(session.user.id);
        setUserEmail(session.user.email || null);
        setIsAuthReady(true);
      } else {
        setUserId(null);
        setUserEmail(null);
        setIsAuthReady(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [isDemoMode]);

  // Debounced reload function for real-time updates (prevents excessive reloads)
  // Uses a ref instead of state to avoid re-subscribing the realtime channel on every event
  const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedReload = useRef(() => {
    if (realtimeDebounceRef.current) {
      clearTimeout(realtimeDebounceRef.current);
    }
    realtimeDebounceRef.current = setTimeout(() => {
      // Invalidate dashboard cache before reloading so real-time updates come through
      if (userId) {
        apiCache.invalidate(`dashboard:data:${userId}:${selectedBrand}`);
      }
      loadDashboardData(true);
    }, 1500); // 1.5s debounce (increased from 1s to reduce DB pressure)
  }).current;

  useEffect(() => {
    if (isDemoMode) return; // Demo mode uses static data
    if (!isAuthReady) return;

    loadDashboardData();
    
    // Webhook-driven: Resend webhooks push status updates to the DB,
    // and Supabase Realtime (below) pushes DB changes to the frontend.
    // No auto-polling of the Resend API — use the manual "Sync" button
    // as a fallback if webhooks miss events.
    
    // REAL-TIME WEBSOCKET UPDATES using Supabase Realtime
    // Subscribe to database changes for instant updates without polling
    const emailsChannel = supabase
      .channel('dashboard-emails')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'emails',
        },
        (payload) => {
          // Security Check: Filter events not belonging to user
          // We check if the email belongs to one of the user's active campaigns
          if (payload.new && 'campaign_id' in payload.new) {
             const campaignId = payload.new.campaign_id;
             if (!userCampaignIdsRef.current.has(campaignId)) return;
          }

          console.log('📨 Real-time email update:', payload);
          
          // Notify on new reply
          if (payload.eventType === 'INSERT' && payload.new.status === 'replied') {
             toast.success(t('dashboard.newReplyReceived'), { 
               description: payload.new.subject || t('dashboard.youHaveNewMessage'),
               duration: 5000
             });
          }
          // Notify on open (if changed from sent/delivered)
          if (payload.eventType === 'UPDATE' && payload.new.status === 'opened' && payload.old.status !== 'opened') {
             // Optional: notify on open
          }

          // Refresh dashboard data when emails change (debounced)
          debouncedReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
        },
        (payload) => {
          // Security Check: Filter leads not belonging to user
          if (payload.new && payload.new.user_id && payload.new.user_id !== userId) return;

          console.log('👤 Real-time lead update:', payload);
          debouncedReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaigns',
        },
        (payload) => {
          // Security Check: Filter campaigns not belonging to user
          if (payload.new && payload.new.user_id && payload.new.user_id !== userId) return;

          console.log('Real-time campaign update:', payload);
          debouncedReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaign_leads',
        },
        (payload) => {
          // Security Check: Filter events not belonging to user's campaigns
          if (payload.new && 'campaign_id' in payload.new) {
             const campaignId = payload.new.campaign_id;
             if (!userCampaignIdsRef.current.has(campaignId)) return;
          }

          console.log('📬 Real-time campaign lead update:', payload);
          debouncedReload();
        }
      )
      .subscribe((status) => {
        console.log('🔌 Realtime connection status:', status);
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setRealtimeStatus('disconnected');
        } else {
          setRealtimeStatus('connecting');
        }
      });
    
    return () => {
      supabase.removeChannel(emailsChannel);
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
    };
  }, [selectedBrand, isAuthReady]); // Re-load when brand changes or auth becomes ready (no timer in deps!)

  // Auto-seed demo data when demo@contndr.com has empty dashboard (skip in sandbox demo mode)
  useEffect(() => {
    if (isDemoMode) return; // Sandbox demo uses static data, no seeding needed
    if (demoSeedAttemptedRef.current || isDemoSeeding || loading) return;
    if (stats.totalLeads > 0 || stats.totalCampaigns > 0) return; // Already has data
    if (userEmail !== 'demo@contndr.com') return;

    const autoSeedDemo = async () => {
      console.log('[DEMO] Demo account detected with 0 data on Dashboard — auto-seeding...');
      demoSeedAttemptedRef.current = true;
      setIsDemoSeeding(true);

      try {
        const response = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/demo/seed`,
          {
            method: 'POST',
            body: JSON.stringify({
              config: { leadCount: 250, campaignCount: 5, emailsPerCampaign: 40, trackingEventsPerEmail: 3, revenueEvents: 15 }
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          console.log('[DEMO] Auto-seed complete:', data.stats);
          toast.success(t('dashboard.demoEnvReady', { leads: data.stats?.leads || 0, campaigns: data.stats?.campaigns || 0 }));
          await loadDashboardData();
        } else {
          const err = await response.json().catch(() => ({}));
          console.error('[DEMO] Auto-seed failed:', err);
        }
      } catch (error) {
        console.error('[DEMO] Auto-seed error:', error);
      } finally {
        setIsDemoSeeding(false);
      }
    };

    autoSeedDemo();
  }, [stats.totalLeads, stats.totalCampaigns, loading, userEmail]);

  // ─── Real-time sync: reload dashboard data when events come from other tabs/users ──
  useEffect(() => {
    if (isDemoMode) return;
    if (dashboardRefreshKey > 0 && isAuthReady) {
      console.log('[DASHBOARD] Real-time refresh triggered');
      loadDashboardData(true);
    }
  }, [dashboardRefreshKey, isAuthReady, isDemoMode]);

  // ─── App-event sync: reload dashboard instantly on in-tab mutations ──
  const appEventKey = useAppEventRefresh(['leads:changed', 'leads:created', 'leads:deleted', 'leads:updated', 'campaigns:changed', 'campaigns:deleted', 'pipeline:changed']);
  useEffect(() => {
    if (isDemoMode) return;
    if (appEventKey > 0 && isAuthReady && userId) {
      console.log('[DASHBOARD] App-event refresh triggered');
      apiCache.invalidate(`dashboard:data:${userId}:${selectedBrand}`);
      loadDashboardData(true);
    }
  }, [appEventKey, isAuthReady, isDemoMode]);

  async function loadDashboardData(silentRefresh?: boolean) {
    if (!silentRefresh) {
      setRefreshing(true);
    }
    
    // Safety check for user ID
    if (!userId) {
      console.warn('[DASHBOARD] Cannot load data - no user ID');
      setLoading(false);
      return;
    }

    try {
      const cacheKey = `dashboard:data:${userId}:${selectedBrand}`;

      // silentRefresh = triggered by real-time event → bypass server KV cache for fresh counts
      // Initial load / brand switch → allow server KV cache (fast path for cold isolates)
      const forceParam = silentRefresh ? '&force=1' : '';

      const dashData = await apiCache.fetch(
        cacheKey,
        async () => {
          // Single server call replaces 7+ individual Supabase count queries
          const res = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/dashboard/stats?brand=${selectedBrand}${forceParam}`,
            { signal: AbortSignal.timeout(25000) }
          );
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            if (res.status === 401) return { stats: { totalLeads: 0, totalCampaigns: 0, emailsSent: 0, emailsOpened: 0, emailsClicked: 0, openRate: 0, clickRate: 0, deliveryRate: 0, emailsDelivered: 0, linkClicks: 0, emailsReplied: 0 }, recentCampaigns: [], upcomingFollowUps: [], availableBrands: ['contndr'], campaignIds: [] };
            throw new Error(`Dashboard stats failed: ${errText}`);
          }
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );

      // Apply cached/fresh data to state
      setStats(dashData.stats);
      setRecentCampaigns(dashData.recentCampaigns);
      setUpcomingFollowUps(dashData.upcomingFollowUps);
      setAvailableBrands(dashData.availableBrands);
      userCampaignIdsRef.current = new Set(dashData.campaignIds);

      // Reset brand if no longer available
      if (selectedBrand !== 'all' && !dashData.availableBrands.includes(selectedBrand)) {
        setSelectedBrand('all');
      }

      // Write snapshot to localStorage for instant hydration
      writeSnapshot(dashData);

      // Load revenue snapshot in parallel (reuses DashboardRevenuePipeline cache keys)
      loadRevenueSnapshot();
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
      if (!silentRefresh) {
        setRefreshing(false);
        setLastRefresh(new Date());
      }
    }
  }

  // ── Revenue snapshot loader (same API as DashboardRevenuePipeline) ──
  const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

  function fmtCurrency(v: number) {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toLocaleString()}`;
  }

  async function loadRevenueSnapshot() {
    try {
      // Demo mode ALWAYS uses demo revenue data — never fetch real data
      if (isDemoMode) {
        setRevenueSnap({ mrr: 24800, pipelineValue: 342000, activeDeals: 31, wonDeals: 18, closeRate: 62.1 });
        return;
      }

      const revenueBrand = 'default';
      const snapshotKeySuffix = `${userId || 'anonymous'}:${revenueBrand}:isolated-v2`;
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;

      const [revenueData, pipelineData] = await Promise.all([
        apiCache.fetch(`dashboard:revenue-snapshot:${snapshotKeySuffix}`, async () => {
          const res = await fetch(`${API_BASE}/revenue/metrics?brand=${revenueBrand}`, { headers });
          if (!res.ok) return null;
          return res.json();
        }, { staleTime: 15_000, cacheTime: 120_000 }).catch(() => null),
        apiCache.fetch(`dashboard:pipeline-snapshot:${userId || 'anonymous'}:isolated-v2`, async () => {
          const res = await fetch(`${API_BASE}/pipeline/deals`, { headers });
          if (!res.ok) return null;
          return res.json();
        }, { staleTime: 15_000, cacheTime: 120_000 }).catch(() => null),
      ]);

      const metrics = revenueData?.metrics;
      const mrr = metrics?.mrr || 0;
      const activeSubs = metrics?.active_subscriptions || 0;
      const totalCustomers = metrics?.total_customers || 0;
      const stripeWonDeals = Math.max(activeSubs, totalCustomers);

      const deals: any[] = pipelineData?.deals || [];
      const activeDeals = deals.filter((d: any) => d.stage !== 'closed_won' && d.stage !== 'closed_lost').length;
      const manualWonDeals = deals.filter((d: any) => d.stage === 'closed_won').length;
      
      // Smart won deals: automatically include paying customers/subscribers
      const wonDeals = manualWonDeals + stripeWonDeals;
      
      const lostDeals = deals.filter((d: any) => d.stage === 'closed_lost').length;
      const pipelineValue = deals
        .filter((d: any) => d.stage !== 'closed_won' && d.stage !== 'closed_lost')
        .reduce((s: number, d: any) => s + (d.value || 0), 0);

      // Realistic Close Rate Calculation:
      // Prevent 100% close rates when users have Stripe customers but haven't manually marked deals as "Lost"
      let closeRate = 0;
      if (wonDeals > 0 || lostDeals > 0) {
        // Assume a baseline loss rate if manual data is sparse (e.g. 35% win rate = ~1.8 lost for every 1 won)
        const impliedLost = Math.max(
           lostDeals, 
           activeDeals * 0.5, 
           wonDeals * 1.8     
        ); 
        
        // Blend actual manual lost deals with the implied baseline
        const blendedLost = (lostDeals * 2 + impliedLost) / 3; 
        
        closeRate = (wonDeals / (wonDeals + blendedLost)) * 100;
      }

      setRevenueSnap({ mrr, pipelineValue, activeDeals, wonDeals, closeRate });
    } catch (err) {
      console.error('[DASHBOARD] Revenue snapshot error:', err);
    }
  }

  async function syncAndRefresh() {
    setSyncing(true);
    try {
      const result = await syncEmailStatuses({ getAuthHeaders, forceAll: true });

      if (result.success) {
        // Invalidate cache and reload dashboard data after successful sync
        if (userId) {
          apiCache.invalidate(`dashboard:data:${userId}:${selectedBrand}`);
        }
        await loadDashboardData();
      } else {
        console.error('Sync error:', result.error);
      }
    } catch (error) {
      console.error('Error syncing email statuses:', error);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in p-6">
        {isDemoSeeding ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <LoadingSpinner size="lg" />
            <div className="text-center">
              <p className="text-sm font-medium text-[#1ED4A7]">{t('dashboard.settingUpDemo', 'Setting up demo environment...')}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{t('dashboard.creatingDemoData', 'Creating leads, campaigns, emails, and analytics data')}</p>
            </div>
          </div>
        ) : (
          <div className="animate-pulse space-y-6">
            <div className="h-10 bg-white/5 rounded-xl w-64 border border-white/10" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-40 bg-white/5 rounded-2xl border border-white/10" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-64 bg-white/5 rounded-2xl border border-white/10" />
              <div className="h-64 bg-white/5 rounded-2xl border border-white/10" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full min-h-screen overflow-y-auto bg-transparent flex flex-col">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-200 dark:border-zinc-800 sm:sticky sm:top-0 sm:z-10 bg-white/80 dark:bg-black/80 backdrop-blur-md flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('dashboard.overview', 'Overview')}</h1>

          <div className="flex items-center justify-center sm:justify-end gap-4 w-full sm:w-auto">
             {/* Plan Status Widget - Hidden as per request */}
             {/* Minimal Brand Filter - Only visible to Admins */}
             {availableBrands.length > 0 && (userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com') && (
               <div className="grid w-full sm:flex sm:w-auto p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 sm:overflow-x-auto no-scrollbar" style={{ gridTemplateColumns: `repeat(${['all', ...availableBrands].length}, 1fr)` }}>
                 {['all', ...availableBrands].map((brand) => (
                   <button
                     key={brand}
                     onClick={() => setSelectedBrand(brand)}
                     className={`px-3 sm:px-4 py-2 text-[13px] font-medium rounded-lg transition-all whitespace-nowrap flex items-center justify-center ${ 
                       selectedBrand === brand
                         ? 'bg-white dark:bg-black text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-zinc-700'
                         : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                     }`}
                   >
                     {brand === 'all' ? t('dashboard.allBrands', 'All Brands') : brand.charAt(0).toUpperCase() + brand.slice(1)}
                   </button>
                 ))}
               </div>
             )}
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="px-4 py-3 sm:px-6 sm:py-6 bg-transparent pb-[calc(env(safe-area-inset-bottom,20px)+20px)] sm:pb-6 flex-1 min-h-0 flex flex-col gap-3 sm:gap-8">
        {/* Key Metrics Grid — Revenue + Campaign combined */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 sm:gap-4 flex-shrink-0">
            {/* Total Leads — kept with usage bar */}
            <div 
              className="glass-card p-4 sm:p-5 cursor-pointer group"
              onClick={() => onNavigate('crm')}
            >
              <div className="flex items-start justify-between mb-2 sm:mb-3">
                <span className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('dashboard.totalLeads', 'Total Leads')}</span>
                <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-400 group-hover:text-[#1ED4A7] transition-colors" />
              </div>
              <div className="flex flex-wrap items-baseline gap-1 mb-3 sm:mb-4">
                <p className="text-lg sm:text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
                  {stats.totalLeads.toLocaleString()}
                </p>
                {isUnlimitedLeads ? (
                  <span className="text-[9px] sm:text-[10px] text-[#1ED4A7] font-semibold uppercase tracking-wide ml-0.5">∞</span>
                ) : (
                  <span className="text-[10px] sm:text-xs text-zinc-500 font-medium">
                    / {leadLimit.toLocaleString()}
                  </span>
                )}
              </div>
              {!isUnlimitedLeads && (
                <div className="progress-bar-track">
                  <div 
                    className="progress-bar-fill" 
                    style={{ width: `${Math.min(100, (stats.totalLeads / leadLimit) * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Emails Sent */}
            <StatCard
              title={t('dashboard.totalEmailsSent', 'Total Emails Sent')}
              value={stats.emailsSent.toLocaleString()}
              icon={Mail}
              onClick={() => onNavigate('emails')}
              trend={stats.emailsReplied > 0 ? `${stats.emailsReplied} ${t('dashboard.replies', 'replies')}` : undefined}
              trendUp={stats.emailsReplied > 0 ? true : undefined}
            />

            {/* Open Rate */}
            <StatCard
              title={t('dashboard.openRate', 'Open Rate')}
              value={`${stats.openRate.toFixed(1)}%`}
              icon={MailOpen}
              teal={stats.openRate > 25}
              trend={stats.openRate > 0 ? (stats.openRate > 50 ? t('dashboard.aboveAvg') : stats.openRate > 25 ? t('dashboard.industryAvg') : t('dashboard.belowAvg')) : undefined}
              trendUp={stats.openRate > 50 ? true : stats.openRate > 25 ? undefined : stats.openRate > 0 ? false : undefined}
            />

            {/* Close Rate */}
            <StatCard
              title={t('dashboard.closeRate', 'Close Rate')}
              value={`${revenueSnap.closeRate.toFixed(1)}%`}
              icon={Target}
              teal={revenueSnap.closeRate > 30}
              trend={revenueSnap.closeRate > 0 ? (revenueSnap.closeRate > 40 ? t('dashboard.strong') : revenueSnap.closeRate > 20 ? t('dashboard.avg') : t('dashboard.needsWork')) : undefined}
              trendUp={revenueSnap.closeRate > 40 ? true : revenueSnap.closeRate > 20 ? undefined : revenueSnap.closeRate > 0 ? false : undefined}
            />

            {/* Pipeline */}
            <StatCard
              title={t('dashboard.pipelineValue', 'Pipeline')}
              value={fmtCurrency(revenueSnap.pipelineValue)}
              icon={TrendingUp}
              onClick={() => onNavigate('pipeline')}
              trend={revenueSnap.activeDeals > 0 ? `${revenueSnap.activeDeals} ${t('dashboard.activeDeals', 'active deals').toLowerCase()}` : undefined}
            />

            {/* MRR */}
            <StatCard
              title={t('dashboard.mrr', 'MRR')}
              value={fmtCurrency(revenueSnap.mrr)}
              icon={DollarSign}
              teal={revenueSnap.mrr > 0}
              onClick={() => onNavigate('revenue')}
              trend={revenueSnap.mrr > 0 || revenueSnap.wonDeals > 0 ? `${revenueSnap.wonDeals} ${t('dashboard.wonDeals', 'won deals')}` : undefined}
              trendUp={revenueSnap.mrr > 0 || revenueSnap.wonDeals > 0 ? true : undefined}
            />
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 xl:flex-1 xl:min-h-0 xl:grid-rows-[320px_minmax(260px,1fr)]">
            
            <div className="h-[320px]">
               <DashboardPipelineSnapshot onNavigate={onNavigate} />
            </div>

            <div className="h-[320px]">
               <DashboardTeamSnapshot onNavigate={onNavigate} stats={stats} />
            </div>

            <div className="min-h-[260px] xl:h-full xl:min-h-0">
               <DashboardTodayFocus onNavigate={onNavigate} />
            </div>

            <div className="min-h-[260px] xl:h-full xl:min-h-0">
               <RecentActivityFeed onNavigate={onNavigate} />
            </div>
          </div>
        </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  color?: string; // Kept for compatibility but ignored in styling
  onClick?: () => void;
  teal?: boolean;
  trend?: string;       // e.g. "↑ 8%" or "above avg"
  trendUp?: boolean;    // true = positive/green, false = negative/red, undefined = neutral
}

function StatCard({ title, value, icon: Icon, onClick, teal, trend, trendUp }: StatCardProps) {
  return (
    <div 
      className={`glass-card p-4 sm:p-5 transition-all group ${onClick ? 'cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 hover:-translate-y-1' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2 sm:mb-4">
        <span className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest">{title}</span>
        <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-400 group-hover:text-[#1ED4A7] transition-colors duration-300" />
      </div>
      <p className={`text-lg sm:text-2xl font-bold ${teal ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'} tracking-tight`}>{value}</p>
      {trend && (
        <p className={`text-[10px] font-semibold mt-1.5 tracking-wide ${
          trendUp === true ? 'text-[#1ED4A7]' : trendUp === false ? 'text-red-400' : 'text-zinc-400 dark:text-zinc-600'
        }`}>
          {trend}
        </p>
      )}
    </div>
  );
}

interface PerformanceBarProps {
  label: string;
  value: number;
  target: number;
}

function PerformanceBar({ label, value, target }: PerformanceBarProps) {
  const isTargetMet = value >= target;
  
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-bold ${isTargetMet ? 'text-[#1ED4A7] dark:drop-shadow-[0_0_8px_rgba(30,212,167,0.4)]' : 'text-zinc-900 dark:text-white'}`}>
            {value.toFixed(1)}%
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-600 font-medium">/ {target}%</span>
        </div>
      </div>
      <div className="progress-bar-track">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${
            isTargetMet ? 'bg-gradient-to-r from-[#1ED4A7] to-[#159c7b] shadow-[0_0_10px_rgba(30,212,167,0.3)]' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

// Default export for React.lazy compatibility
export default Dashboard;
