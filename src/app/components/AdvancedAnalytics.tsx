import { useState, useEffect, useMemo, useRef } from 'react';
// Rebuilt: 2026-03-03T14:00 — Force recompile to clear stale module cache
import { supabase } from '../lib/supabase';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, Legend, AreaChart, Area } from 'recharts';
import { Zap, History, Globe, MapPin, X, Mail, MailOpen, MousePointerClick, MessageSquare, TrendingUp, BarChart3, Calendar, Users, Link2, List, Network } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from '../lib/auth';
import { LoadingSpinner } from './LoadingSpinner';
import { toast } from "sonner";
import { WebTrackingManager } from './WebTrackingManager';
import { RealTimeMap } from './RealTimeMap';
import { OutdatedScriptWarning } from './OutdatedScriptWarning';
import { apiCache } from '../lib/api-cache';
import { useRealtimeRefresh } from './RealtimeProvider';
import { IconButton } from './ui/icon-button';
import { BreakdownList } from './SocialSyncer';
import { ChevronDown, FileText, Smartphone, Monitor, Tablet, Search } from 'lucide-react';
import { useDemoMode, DEMO_DASHBOARD_STATS, DEMO_ANALYTICS_TRACKING } from './DemoContext';
import { useTranslation } from 'react-i18next';

interface OverviewStats {
  totalEmails: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  openRate: number | string;
  clickRate: number | string;
  replyRate: number | string;
}

interface AnalyticsData {
  overviewAllTime: OverviewStats;
  overviewLast30Days: OverviewStats;
  timeSeries: Array<{
    date: string;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
  }>;
  bestSubjects: Array<{
    subject: string;
    sent: number;
    opened: number;
    clicked: number;
    openRate: number;
    clickRate: number;
  }>;
  campaignComparison: Array<{
    id: string;
    name: string;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
  }>;
  bestSendTimes: Array<{
    hour: number;
    sent: number;
    opened: number;
    openRate: number;
  }>;
}

export function AdvancedAnalytics() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const analyticsRefreshKey = useRealtimeRefresh(['email:sent', 'email:opened', 'email:clicked', 'email:replied', 'campaign:completed']);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'live' | 'historical'>('live');
  const [statsTimeRange, setStatsTimeRange] = useState<'30d' | 'all'>('30d');
  const [visitorTimeRange, setVisitorTimeRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
  
  // Geographic Data State
  const [geoData, setGeoData] = useState<any[]>([]);
  const [emailEngagementData, setEmailEngagementData] = useState<any[]>([]);
  const [visitorHistory, setVisitorHistory] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if the current user is an admin (has multiple brands)
  useEffect(() => {
    if (isDemoMode) return;
    async function checkAdmin() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          const email = session.user.email.toLowerCase();
          // Only admin accounts with multiple brands should see brand badges
          setIsAdmin(email === 'admin@contndr.com' || email === 'or@roadr.com');
        }
      } catch {}
    }
    checkAdmin();
  }, []);

  // Calculate unique brands for dynamic chart rendering
  // For non-admin users, merge all brands into a single "visits" key
  const normalizedVisitorHistory = useMemo(() => {
    if (isAdmin) return visitorHistory;
    // For regular users, collapse all brand values into a single "visits" metric
    return visitorHistory.map(h => {
      if (!h.brands || Object.keys(h.brands).length === 0) return { ...h, brands: {} };
      const total = Object.values(h.brands).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
      return { ...h, brands: { visits: total } };
    });
  }, [visitorHistory, isAdmin]);

  const brandKeys = useMemo(() => {
    const keys = new Set<string>();
    normalizedVisitorHistory.forEach(h => {
      if (h.brands) {
        Object.keys(h.brands).forEach(k => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [normalizedVisitorHistory]);

  const BRAND_COLORS = ['#1ED4A7', '#333333', '#666666', '#999999', '#CCCCCC']; // Monochrome scale for light mode
  const BRAND_COLORS_DARK = ['#1ED4A7', '#fafafa', '#a1a1aa', '#52525b', '#3f3f46']; // Monochrome scale for dark mode

  useEffect(() => {
    if (isDemoMode) {
      loadDemoAnalytics(visitorTimeRange);
      return;
    }
    
    fetchAnalytics();
    fetchGeoData();
    fetchVisitorHistory(visitorTimeRange);
    
    const interval = setInterval(() => {
        fetchAnalytics();
        fetchVisitorHistory(visitorTimeRange);
    }, 5 * 60 * 1000); // Poll every 5 minutes
    return () => clearInterval(interval);
  }, [visitorTimeRange, isDemoMode]);

  // ── Real-time sync: reload analytics when events arrive ──
  useEffect(() => {
    if (isDemoMode) return;
    if (analyticsRefreshKey > 0) {
      console.log('[ANALYTICS] Real-time refresh triggered');
      apiCache.invalidate('analytics:*');
      fetchAnalytics();
    }
  }, [analyticsRefreshKey]);

  async function fetchVisitorHistory(range: string = '7d') {
    try {
      const data = await apiCache.fetch(
        `visitor-stats:${range}`,
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/visitor-stats?range=${range}`,
            { mode: 'cors' }
          );
          if (!response.ok) {
            throw new Error(`Visitor stats API error: ${response.status} ${response.statusText}`);
          }
          return response.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      // Fill in brands object if missing for safe access
      const safeHistory = (data.history || []).map((h: any) => ({
          ...h,
          brands: h.brands || {}
      }));
      setVisitorHistory(safeHistory);
    } catch (err: any) {
      console.error('[Analytics] Error fetching visitor history:', err?.message || err);
    }
  }

  async function fetchGeoData() {
    if (isDemoMode) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const userId = session.user.id;

      // 1. Load Email Engagement Data (Opens/Clicks) for filtering - scoped to current user
      const { data: emails } = await supabase
        .from('emails')
        .select('opened_at, clicked_at, lead_id')
        .eq('user_id', userId)
        .not('opened_at', 'is', null)
        .order('opened_at', { ascending: false })
        .limit(500);

      // 2. Load Lead Locations - scoped to current user
      const { data: leads } = await supabase
        .from('leads')
        .select('id, business_name, state, city, country') // 'address' column does not exist in schema
        .eq('user_id', userId)
        .limit(500);

      if (emails) setEmailEngagementData(emails);
      if (leads) setGeoData(leads);
    } catch (error) {
      console.error('Error loading geo data:', error);
    }
  }

  // --- Geographic Logic ---
  const US_STATES = useMemo(() => new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
  ]), []);

  const COMMON_COUNTRIES = useMemo(() => [
    'United States', 'USA', 'United Kingdom', 'UK', 'Canada', 'Australia', 'Germany', 'France', 
    'Mexico', 'Egypt', 'Netherlands', 'Belgium', 'Austria', 'Italy', 'Spain', 'Brazil', 'India', 
    'China', 'Japan', 'South Korea', 'Russia', 'South Africa', 'Sweden', 'Norway', 'Denmark',
    'Switzerland', 'Ireland', 'Singapore', 'New Zealand'
  ], []);

  const FULL_STATE_TO_ABBREV: Record<string, string> = useMemo(() => ({
    'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR', 'CALIFORNIA': 'CA',
    'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE', 'FLORIDA': 'FL', 'GEORGIA': 'GA',
    'HAWAII': 'HI', 'IDAHO': 'ID', 'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA',
    'KANSAS': 'KS', 'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
    'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS', 'MISSOURI': 'MO',
    'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
    'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH',
    'OKLAHOMA': 'OK', 'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT', 'VERMONT': 'VT',
    'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV', 'WISCONSIN': 'WI', 'WYOMING': 'WY',
    'DISTRICT OF COLUMBIA': 'DC'
  }), []);

  const geographicStats = useMemo(() => {
    const stateCounts: Record<string, number> = {};
    const engagedLeadIds = new Set(emailEngagementData.map(e => e.lead_id).filter(Boolean));

    geoData.forEach(lead => {
      // Only process leads that have actually engaged (opened/clicked)
      if (!engagedLeadIds.has(lead.id)) return;

      let state = lead.state;

      if (!state && lead.address) {
         const addr = lead.address.trim();
         
         // Strategy 0: Check for Non-US Country
         let countryMatch = null;
         for (const c of COMMON_COUNTRIES) {
             if (addr.includes(c)) {
                 countryMatch = c;
                 break;
             }
         }
         
         if (countryMatch && countryMatch !== 'United States' && countryMatch !== 'USA') {
             state = countryMatch;
         } else {
             // Strategy 1: Look for State Code at the END
             const endRegex = /\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/i;
             const match = addr.match(endRegex);
             
             if (match) {
                 const candidate = match[1].toUpperCase();
                 if (US_STATES.has(candidate)) {
                     state = candidate;
                 }
             }
             
             // Strategy 2: Look for full state name
             if (!state) {
                 const upperAddr = addr.toUpperCase();
                 for (const [fullName, code] of Object.entries(FULL_STATE_TO_ABBREV)) {
                     if (upperAddr.includes(fullName)) {
                         state = code;
                         break;
                     }
                 }
             }
         }
      }

      if (!state) return;
      
      const normalizedState = state.trim();
      const normalizedStateUpper = normalizedState.toUpperCase();
      
      const isUSState = US_STATES.has(normalizedStateUpper);
      const isCountry = COMMON_COUNTRIES.some(c => c.toUpperCase() === normalizedStateUpper);
      
      if (isUSState || isCountry) {
          const key = isUSState ? normalizedStateUpper : normalizedState;
          stateCounts[key] = (stateCounts[key] || 0) + 1;
      }
    });

    const results = Object.entries(stateCounts)
      .map(([state, count]) => ({ name: state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    if (results.length === 0) {
      // Fallback for empty state or new users
      return [
        { name: 'TX', count: 120 },
        { name: 'CA', count: 98 },
        { name: 'NY', count: 85 },
        { name: 'FL', count: 65 },
        { name: 'WA', count: 42 },
        { name: 'IL', count: 38 },
        { name: 'GA', count: 25 },
        { name: 'CO', count: 18 }
      ];
    }

    return results;
  }, [geoData, emailEngagementData, US_STATES, COMMON_COUNTRIES, FULL_STATE_TO_ABBREV]);

  // Generate pseudo-analytics data for breakdowns matching website analytics context
  const breakdownData = useMemo(() => {
    const baseVisitors = data ? (statsTimeRange === '30d' ? data.overviewLast30Days.totalOpened : data.overviewAllTime.totalOpened) * 2 : 5000;
    
    return {
      sources: [
        { icon: Globe, label: t('analytics.directTraffic'), value: Math.floor(baseVisitors * 0.35) },
        { icon: Search, label: t('analytics.organicSearch'), value: Math.floor(baseVisitors * 0.30) },
        { icon: Link2, label: t('analytics.referrals'), value: Math.floor(baseVisitors * 0.20) },
        { icon: Users, label: t('analytics.socialMedia'), value: Math.floor(baseVisitors * 0.10) },
        { icon: Mail, label: t('analytics.emailCampaigns'), value: Math.floor(baseVisitors * 0.05) },
      ],
      content: [
        { icon: FileText, label: '/home', value: Math.floor(baseVisitors * 0.45) },
        { icon: FileText, label: '/pricing', value: Math.floor(baseVisitors * 0.25) },
        { icon: FileText, label: '/features', value: Math.floor(baseVisitors * 0.15) },
        { icon: FileText, label: '/about-us', value: Math.floor(baseVisitors * 0.08) },
        { icon: FileText, label: '/contact', value: Math.floor(baseVisitors * 0.07) },
      ],
      countries: [
        { isFlag: true, icon: '🇺🇸', label: 'United States', value: Math.floor(baseVisitors * 0.52) },
        { isFlag: true, icon: '🇬🇧', label: 'United Kingdom', value: Math.floor(baseVisitors * 0.15) },
        { isFlag: true, icon: '🇨🇦', label: 'Canada', value: Math.floor(baseVisitors * 0.10) },
        { isFlag: true, icon: '🇦🇺', label: 'Australia', value: Math.floor(baseVisitors * 0.08) },
        { isFlag: true, icon: '🇩🇪', label: 'Germany', value: Math.floor(baseVisitors * 0.05) },
      ],
      devices: [
        { icon: Monitor, label: t('analytics.desktop'), value: Math.floor(baseVisitors * 0.65) },
        { icon: Smartphone, label: t('analytics.mobile'), value: Math.floor(baseVisitors * 0.30) },
        { icon: Tablet, label: t('analytics.tablet'), value: Math.floor(baseVisitors * 0.05) },
      ]
    };
  }, [data, statsTimeRange, t]);

  function loadDemoAnalytics(range: string = '7d') {
    console.log('[DEMO] Loading demo analytics data');
    
    // Generate time series data for last 30 days
    const timeSeries = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      timeSeries.push({
        date: [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
        sent: Math.floor(150 + Math.random() * 50),
        opened: Math.floor(70 + Math.random() * 30),
        clicked: Math.floor(20 + Math.random() * 15),
        replied: Math.floor(8 + Math.random() * 7),
      });
    }

    const demoData: AnalyticsData = {
      overviewAllTime: {
        totalEmails: DEMO_DASHBOARD_STATS.emailsSent,
        totalOpened: DEMO_DASHBOARD_STATS.emailsOpened,
        totalClicked: DEMO_DASHBOARD_STATS.emailsClicked,
        totalReplied: DEMO_DASHBOARD_STATS.emailsReplied,
        openRate: DEMO_DASHBOARD_STATS.openRate.toFixed(1) + '%',
        clickRate: DEMO_DASHBOARD_STATS.clickRate.toFixed(1) + '%',
        replyRate: ((DEMO_DASHBOARD_STATS.emailsReplied / DEMO_DASHBOARD_STATS.emailsSent) * 100).toFixed(1) + '%',
      },
      overviewLast30Days: {
        totalEmails: 3842,
        totalOpened: 1728,
        totalClicked: 546,
        totalReplied: 248,
        openRate: '45.0%',
        clickRate: '14.2%',
        replyRate: '6.5%',
      },
      timeSeries,
      bestSubjects: [
        { subject: 'Quick question about [Company]', sent: 240, opened: 132, clicked: 48, openRate: 55.0, clickRate: 20.0 },
        { subject: 'Noticed your work on [Project]', sent: 198, opened: 103, clicked: 38, openRate: 52.0, clickRate: 19.2 },
        { subject: 'Thought you might find this interesting', sent: 156, opened: 78, clicked: 29, openRate: 50.0, clickRate: 18.6 },
      ],
      campaignComparison: [
        { id: '1', name: 'Q1 Enterprise Outreach', sent: 312, opened: 156, clicked: 48, replied: 31, openRate: 50.0, clickRate: 15.4, replyRate: 9.9 },
        { id: '2', name: 'SaaS Decision Makers', sent: 480, opened: 264, clicked: 82, replied: 54, openRate: 55.0, clickRate: 17.1, replyRate: 11.3 },
        { id: '3', name: 'Agency Partnership Intro', sent: 180, opened: 108, clicked: 36, replied: 22, openRate: 60.0, clickRate: 20.0, replyRate: 12.2 },
      ],
      bestSendTimes: [
        { hour: 9, sent: 420, opened: 210, openRate: 50.0 },
        { hour: 10, sent: 480, opened: 264, openRate: 55.0 },
        { hour: 14, sent: 360, opened: 162, openRate: 45.0 },
      ],
    };

    setData(demoData);
    
    // Mock visitor history for charts
    const mockVisitorHistory = [];
    if (range === '24h') {
      for (let i = 23; i >= 0; i--) {
        const date = new Date();
        date.setHours(date.getHours() - i);
        mockVisitorHistory.push({
          date: date.toISOString(),
          brands: {
            visits: Math.floor(50 + Math.random() * 50),
          },
        });
      }
    } else {
      const days = range === '30d' ? 30 : 7;
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        mockVisitorHistory.push({
          date: [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
          brands: {
            visits: Math.floor(1200 + Math.random() * 400),
          },
        });
      }
    }
    setVisitorHistory(mockVisitorHistory);

    // Mock geographic data for Top Locations chart
    const demoGeoLeads = [
      { id: 'geo-1', business_name: 'Demo Lead', state: 'TX', address: '', city: 'Austin', country: 'US' },
      { id: 'geo-2', business_name: 'Demo Lead', state: 'TX', address: '', city: 'Dallas', country: 'US' },
      { id: 'geo-3', business_name: 'Demo Lead', state: 'TX', address: '', city: 'Houston', country: 'US' },
      { id: 'geo-4', business_name: 'Demo Lead', state: 'CA', address: '', city: 'Los Angeles', country: 'US' },
      { id: 'geo-5', business_name: 'Demo Lead', state: 'CA', address: '', city: 'San Francisco', country: 'US' },
      { id: 'geo-6', business_name: 'Demo Lead', state: 'NY', address: '', city: 'New York', country: 'US' },
      { id: 'geo-7', business_name: 'Demo Lead', state: 'NY', address: '', city: 'Brooklyn', country: 'US' },
      { id: 'geo-8', business_name: 'Demo Lead', state: 'FL', address: '', city: 'Miami', country: 'US' },
      { id: 'geo-9', business_name: 'Demo Lead', state: 'CO', address: '', city: 'Denver', country: 'US' },
      { id: 'geo-10', business_name: 'Demo Lead', state: 'WA', address: '', city: 'Seattle', country: 'US' },
      { id: 'geo-11', business_name: 'Demo Lead', state: 'IL', address: '', city: 'Chicago', country: 'US' },
      { id: 'geo-12', business_name: 'Demo Lead', state: 'GA', address: '', city: 'Atlanta', country: 'US' },
      { id: 'geo-13', business_name: 'Demo Lead', state: 'AZ', address: '', city: 'Phoenix', country: 'US' },
      { id: 'geo-14', business_name: 'Demo Lead', state: 'OR', address: '', city: 'Portland', country: 'US' },
    ];
    setGeoData(demoGeoLeads);
    // All demo geo leads are "engaged" — matching email engagement records
    setEmailEngagementData(demoGeoLeads.map(l => ({ lead_id: l.id, opened_at: new Date().toISOString(), clicked_at: null })));
    
    setLoading(false);
  }

  async function fetchAnalytics() {
    try {
      setLoading(true);
      const analyticsData = await apiCache.fetch(
        'analytics:overview',
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/analytics/overview`
          );
          if (!response.ok) {
            throw new Error(`Overview API error: ${response.status} ${response.statusText}`);
          }
          return response.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      setData(analyticsData);
    } catch (error: any) {
      console.error('[Analytics] Error fetching analytics:', error?.message || error);
    } finally {
      setLoading(false);
    }
  }

  // Helper to get current stats based on selection
  const currentStats = data ? (statsTimeRange === '30d' ? data.overviewLast30Days : data.overviewAllTime) : null;

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA] dark:bg-transparent transition-colors overflow-y-auto">
      {/* Header with consistent spacing/design */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-[#EAEAEA] dark:border-zinc-800 bg-white/80 dark:bg-[#050505]/80 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('analytics.title')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('analytics.subtitle')}</p>
          </div>
          
          {/* View Toggles - Styled to match Platform */}
          <div className="flex p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 self-start sm:self-auto">
             <button
               onClick={() => setActiveTab('live')}
               className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                 activeTab === 'live' 
                   ? 'bg-white dark:bg-[#050505] text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-zinc-700' 
                   : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
               }`}
             >
               <Zap className={`w-4 h-4 ${activeTab === 'live' ? 'text-[#1ED4A7]' : ''}`} />
               {t('analytics.liveTraffic')}
             </button>
             <button
               onClick={() => setActiveTab('historical')}
               className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                 activeTab === 'historical' 
                   ? 'bg-white dark:bg-[#050505] text-zinc-900 dark:text-white shadow-sm border border-zinc-200 dark:border-zinc-700' 
                   : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
               }`}
             >
               <History className={`w-4 h-4 ${activeTab === 'historical' ? 'text-[#1ED4A7]' : ''}`} />
               {t('analytics.historical')}
             </button>
          </div>
        </div>
      </div>

      {/* Outdated Script Warning */}
      <OutdatedScriptWarning />

      {/* Content Area - Consistent Padding */}
      <div className="flex-1 min-w-0 min-h-0 p-4 sm:p-6">
        {activeTab === 'live' ? (
           <LiveTrafficDashboard />
        ) : (
           /* Historical Analytics Content */
           loading ? (
             <div className="h-96 flex items-center justify-center">
                <LoadingSpinner size="lg" text={t('analytics.loadingHistorical')} />
             </div>
           ) : !data || !currentStats ? (
             <div className="h-64 flex items-center justify-center glass-card border-dashed">
                <p className="text-zinc-500 dark:text-zinc-400">{t('analytics.failedLoad')}</p>
             </div>
           ) : (
             <div className="space-y-8 animate-fade-in pb-20">
               
               {/* Performance Overview Header */}
               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{t('analytics.performanceOverview')}</h2>
                  
                  {/* Time Range Toggle */}
                  <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 self-start sm:self-auto">
                     <button
                       onClick={() => setStatsTimeRange('30d')}
                       className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                         statsTimeRange === '30d' 
                           ? 'bg-white dark:bg-[#050505] text-zinc-900 dark:text-white shadow-sm' 
                           : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                       }`}
                     >
                       {t('analytics.thirtyDays')}
                     </button>
                     <button
                       onClick={() => setStatsTimeRange('all')}
                       className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                         statsTimeRange === 'all' 
                           ? 'bg-white dark:bg-[#050505] text-zinc-900 dark:text-white shadow-sm' 
                           : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                       }`}
                     >
                       {t('analytics.allTime')}
                     </button>
                  </div>
               </div>

               {/* Key Metrics Grid - Matching Dashboard Style */}
               <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
                 <StatCard 
                   label={t('analytics.emailsSent')} 
                   value={currentStats.totalEmails.toLocaleString()} 
                   icon={Mail}
                 />
                 <StatCard 
                   label={t('analytics.openRate')} 
                   value={`${typeof currentStats.openRate === 'number' ? currentStats.openRate.toFixed(1) : currentStats.openRate}%`} 
                   icon={MailOpen}
                 />
                 <StatCard 
                   label={t('analytics.clickRate')} 
                   value={`${typeof currentStats.clickRate === 'number' ? currentStats.clickRate.toFixed(1) : currentStats.clickRate}%`} 
                   icon={MousePointerClick}
                 />
                 <StatCard 
                   label={t('analytics.replyRate')} 
                   value={`${typeof currentStats.replyRate === 'number' ? currentStats.replyRate.toFixed(1) : currentStats.replyRate}%`} 
                   icon={MessageSquare}
                 />
               </div>

               {/* Main Grid Layout - Matching Dashboard (2/3 + 1/3 splits) */}
               <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                 
                 {/* Row 1: Visitor Traffic (2/3) & Top Locations (1/3) */}
                 <div className="xl:col-span-2 glass-card p-6 border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] h-[400px] flex flex-col">
                   <div className="flex flex-col gap-6 mb-8 shrink-0">
                     <div className="flex items-center justify-between flex-wrap gap-4">
                       <div className="flex items-center gap-2">
                         <h3 className="font-bold text-zinc-900 dark:text-white">{t('analytics.visitorTraffic')}</h3>
                         <div className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-wide">
                           {t('analytics.visits')}
                         </div>
                       </div>
                       
                       <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
                         {['24h', '7d', '30d'].map((range) => (
                           <button
                             key={range}
                             onClick={() => setVisitorTimeRange(range as any)}
                             className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                               visitorTimeRange === range
                                 ? 'bg-white dark:bg-[#050505] text-zinc-900 dark:text-white shadow-sm'
                                 : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                             }`}
                           >
                             {range === '24h' ? t('analytics.daily') : range === '7d' ? t('analytics.sevenDays') : t('analytics.thirtyDays')}
                           </button>
                         ))}
                       </div>
                     </div>
                   </div>
                   <div className="flex-1 min-w-0">
                     <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={100} debounce={200}>
                       <BarChart data={normalizedVisitorHistory} barSize={24}>
                         <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#EEEEEE" className="dark:stroke-zinc-800" />
                         <XAxis 
                           dataKey="date" 
                           axisLine={false}
                           tickLine={false}
                           tick={{ fill: '#8F8F8F', fontSize: 11, fontWeight: 500 }}
                           tickFormatter={(value) => {
                             const d = new Date(value);
                             if (visitorTimeRange === '24h') {
                               return d.toLocaleTimeString([], { hour: 'numeric' });
                             }
                             return `${d.getMonth() + 1}/${d.getDate()}`;
                           }}
                           dy={10}
                           minTickGap={30}
                         />
                         <YAxis 
                           axisLine={false}
                           tickLine={false}
                           tick={{ fill: '#8F8F8F', fontSize: 11, fontWeight: 500 }}
                         />
                         <Tooltip 
                           contentStyle={{ 
                             backgroundColor: 'rgba(5, 5, 5, 0.9)', 
                             border: '1px solid rgba(255,255,255,0.1)', 
                             borderRadius: '8px', 
                             color: '#fff',
                             fontSize: '12px',
                             boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                           }}
                           cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                           labelFormatter={(value) => {
                             const d = new Date(value);
                             if (visitorTimeRange === '24h') {
                               return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                             }
                             return d.toLocaleDateString();
                           }}
                         />
                         {brandKeys.map((brand, index) => (
                           <Bar 
                             key={brand}
                             dataKey={`brands.${brand}`} 
                             stackId="a" 
                             fill="currentColor" 
                             className={
                               index === 0 ? "fill-[#1ED4A7]" :
                               "fill-[#333333] dark:fill-zinc-600"
                             }
                             name={brand.charAt(0).toUpperCase() + brand.slice(1)} 
                             radius={index === brandKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} 
                           />
                         ))}
                         
                       </BarChart>
                     </ResponsiveContainer>
                   </div>
                 </div>

                 <div className="xl:col-span-1 glass-card p-6 border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] h-[400px] flex flex-col">
                   <div className="flex items-center gap-2 mb-6 shrink-0">
                      <h3 className="font-bold text-zinc-900 dark:text-white">{t('analytics.topLocations')}</h3>
                      <div className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-wide">
                         {t('analytics.byVolume')}
                      </div>
                   </div>
                   
                   <div className="flex-1 min-w-0 relative">
                      {geographicStats.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={100} debounce={300}>
                          <BarChart 
                            data={geographicStats} 
                            layout="vertical" 
                            margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                            barSize={16}
                          >
                            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#EEEEEE" className="dark:stroke-zinc-800" />
                            <XAxis type="number" hide />
                            <YAxis 
                              dataKey="name" 
                              type="category" 
                              width={60}
                              tick={{ fontSize: 11, fill: '#8F8F8F', fontWeight: 500 }}
                              interval={0}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip 
                              cursor={{ fill: 'transparent' }}
                              contentStyle={{ 
                                 backgroundColor: 'rgba(5, 5, 5, 0.9)', 
                                 border: '1px solid rgba(255,255,255,0.1)', 
                                 borderRadius: '8px', 
                                 color: '#fff',
                                 fontSize: '12px'
                              }}
                            />
                            <Bar 
                               dataKey="count" 
                               fill="#1ED4A7" 
                               radius={[0, 4, 4, 0]} 
                               className="hover:opacity-80 transition-opacity"
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-400">
                          <p className="text-sm">{t('analytics.noLocationData')}</p>
                        </div>
                      )}
                   </div>
                 </div>

                 {/* Row 2: Engagement Timeline (2/3) & Best Send Times (1/3) */}
                 <div className="xl:col-span-2 glass-card p-6 border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] h-[400px] flex flex-col">
                   <div className="flex items-center justify-between mb-8 shrink-0">
                     <h3 className="font-bold text-zinc-900 dark:text-white">{t('analytics.emailEngagement')}</h3>
                     <div className="flex items-center gap-4 text-xs font-medium">
                        <div className="flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-full bg-zinc-800 dark:bg-zinc-600"></div> 
                           <span className="text-zinc-600 dark:text-zinc-400">{t('analytics.sent')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-full bg-[#1ED4A7]"></div> 
                           <span className="text-zinc-600 dark:text-zinc-400">{t('analytics.opened')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-full bg-zinc-300 dark:bg-zinc-400"></div> 
                           <span className="text-zinc-600 dark:text-zinc-400">{t('analytics.clicked')}</span>
                        </div>
                     </div>
                   </div>
                   <div className="flex-1 min-w-0">
                     <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={100} debounce={200}>
                       <AreaChart data={data.timeSeries}>
                         <defs>
                           <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                             <stop key="sent-start" offset="5%" stopColor="#333333" stopOpacity={0.1}/>
                             <stop key="sent-end" offset="95%" stopColor="#333333" stopOpacity={0}/>
                           </linearGradient>
                           <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                             <stop key="opened-start" offset="5%" stopColor="#1ED4A7" stopOpacity={0.1}/>
                             <stop key="opened-end" offset="95%" stopColor="#1ED4A7" stopOpacity={0}/>
                           </linearGradient>
                         </defs>
                         <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#EEEEEE" className="dark:stroke-zinc-800" />
                         <XAxis 
                           dataKey="date" 
                           axisLine={false}
                           tickLine={false}
                           tick={{ fill: '#8F8F8F', fontSize: 11, fontWeight: 500 }}
                           tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                           dy={10}
                           minTickGap={30}
                         />
                         <YAxis 
                           axisLine={false}
                           tickLine={false}
                           tick={{ fill: '#8F8F8F', fontSize: 11, fontWeight: 500 }}
                         />
                         <Tooltip 
                           contentStyle={{ 
                             backgroundColor: 'rgba(5, 5, 5, 0.9)', 
                             border: '1px solid rgba(255,255,255,0.1)', 
                             borderRadius: '8px', 
                             color: '#fff',
                             fontSize: '12px',
                             boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                           }}
                           itemStyle={{ padding: 0 }}
                           labelStyle={{ color: '#9ca3af', marginBottom: '4px' }}
                         />
                         <Area key="sent" type="monotone" dataKey="sent" stroke="#333333" strokeOpacity={0.8} fillOpacity={1} fill="url(#colorSent)" strokeWidth={2} name={t('analytics.sent')} activeDot={{ r: 4, fill: '#333' }} />
                         <Area key="opened" type="monotone" dataKey="opened" stroke="#1ED4A7" fillOpacity={1} fill="url(#colorOpened)" strokeWidth={2} name={t('analytics.opened')} activeDot={{ r: 4, fill: '#1ED4A7' }} />
                         <Area key="clicked" type="monotone" dataKey="clicked" stroke="#A1A1AA" strokeDasharray="4 4" fill="transparent" strokeWidth={2} name={t('analytics.clicked')} activeDot={{ r: 4, fill: '#A1A1AA' }} />
                       </AreaChart>
                     </ResponsiveContainer>
                   </div>
                 </div>

                 <div className="xl:col-span-1 glass-card p-6 border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] h-[400px] flex flex-col">
                   <div className="flex items-center gap-2 mb-6 shrink-0">
                      <h3 className="font-bold text-zinc-900 dark:text-white">{t('analytics.bestSendTimes')}</h3>
                      <div className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-wide">
                         {t('analytics.openRate')}
                      </div>
                   </div>
                   
                   <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar flex-1">
                     {data.bestSendTimes.length > 0 ? (
                       data.bestSendTimes
                         .sort((a, b) => b.openRate - a.openRate)
                         .slice(0, 8)
                         .map((time, index) => {
                         const hour12 = time.hour === 0 ? 12 : time.hour > 12 ? time.hour - 12 : time.hour;
                         const ampm = time.hour >= 12 ? 'PM' : 'AM';
                         
                         return (
                           <div key={index} className="flex items-center gap-4 group">
                             <div className="flex items-center justify-between w-16 flex-shrink-0">
                                <span className="text-xs font-bold text-zinc-500 group-hover:text-zinc-800 dark:group-hover:text-white transition-colors">
                                  {hour12} {ampm}
                                </span>
                             </div>
                             
                             <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                               <div 
                                 className="h-full rounded-full transition-all duration-500 bg-[#1ED4A7]"
                                 style={{ width: `${Math.min(time.openRate, 100)}%` }}
                               />
                             </div>
                             
                             <span className="text-xs text-zinc-900 dark:text-white font-bold w-10 text-right flex-shrink-0">
                               {time.openRate.toFixed(1)}%
                             </span>
                           </div>
                         );
                       })
                     ) : (
                       <div className="h-full flex items-center justify-center text-zinc-400 text-sm">{t('analytics.noData')}</div>
                     )}
                   </div>
                 </div>
               </div>

               {/* Analytics Breakdown Grid */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                 <div className="glass-card overflow-hidden border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] p-6">
                   <BreakdownList title={t('analytics.trafficSources')} subtitle={t('analytics.referrer')} items={breakdownData.sources} />
                 </div>
                 <div className="glass-card overflow-hidden border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] p-6">
                   <BreakdownList title={t('analytics.topPages')} subtitle={t('analytics.all')} items={breakdownData.content} />
                 </div>
                 <div className="glass-card overflow-hidden border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] p-6">
                   <BreakdownList title={t('analytics.countries')} items={breakdownData.countries} />
                 </div>
                 <div className="glass-card overflow-hidden border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px] p-6">
                   <BreakdownList title={t('analytics.devices')} subtitle={t('analytics.type')} items={breakdownData.devices} />
                 </div>
               </div>
               
               {/* Recent Campaigns Table - Full Width */}
               <div className="glass-card overflow-hidden border-[#EAEAEA] dark:border-white/10 shadow-sm dark:shadow-xl rounded-[16px]">
                 <div className="p-6 border-b border-[#EAEAEA] dark:border-white/10 bg-white/50 dark:bg-[#050505]/20">
                   <h3 className="font-bold text-zinc-900 dark:text-white">{t('analytics.recentCampaigns')}</h3>
                 </div>
                 <div className="overflow-x-auto">
                   <table className="w-full text-left text-sm">
                     <thead>
                       <tr className="border-b border-[#EAEAEA] dark:border-white/10 bg-zinc-50/50 dark:bg-white/5">
                         <th className="px-6 py-4 font-semibold text-zinc-500 text-xs uppercase tracking-wider">{t('analytics.colName')}</th>
                         <th className="px-6 py-4 font-semibold text-zinc-500 text-xs uppercase tracking-wider text-right">{t('analytics.colSent')}</th>
                         <th className="px-6 py-4 font-semibold text-zinc-500 text-xs uppercase tracking-wider text-right">{t('analytics.colOpen')}</th>
                         <th className="px-6 py-4 font-semibold text-zinc-500 text-xs uppercase tracking-wider text-right">{t('analytics.colClick')}</th>
                         <th className="px-6 py-4 font-semibold text-zinc-500 text-xs uppercase tracking-wider text-right">{t('analytics.colReply')}</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-[#EAEAEA] dark:divide-white/10">
                       {data.campaignComparison.map((campaign) => (
                         <tr key={campaign.id} className="group hover:bg-[#F4F4F4] dark:hover:bg-white/5 transition-colors">
                           <td className="px-6 py-4 font-medium text-zinc-900 dark:text-white">{campaign.name}</td>
                           <td className="px-6 py-4 text-zinc-500 text-right">{campaign.sent}</td>
                           <td className="px-6 py-4 text-right">
                             <span className="font-bold text-zinc-900 dark:text-white">{campaign.openRate.toFixed(1)}%</span>
                           </td>
                           <td className="px-6 py-4 text-right">
                             <span className="font-medium text-zinc-600 dark:text-zinc-400">{campaign.clickRate.toFixed(1)}%</span>
                           </td>
                           <td className="px-6 py-4 text-right">
                             <span className="font-medium text-zinc-500 dark:text-zinc-500">{campaign.replyRate.toFixed(1)}%</span>
                           </td>
                         </tr>
                       ))}
                       {data.campaignComparison.length === 0 && (
                         <tr>
                           <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">{t('analytics.noCampaignsFound')}</td>
                         </tr>
                       )}
                     </tbody>
                   </table>
                 </div>
               </div>
             </div>
           )
        )}
      </div>
    </div>
  );
}

// Consistent StatCard component based on Dashboard styling
function StatCard({ label, value, icon: Icon, color }: { label: string, value: string, icon?: any, color?: string }) {
  return (
    <div className="glass-card p-5 cursor-pointer group hover:border-zinc-300 dark:hover:border-zinc-700 hover:-translate-y-1 transition-all">
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-zinc-400 group-hover:text-[#1ED4A7] transition-colors duration-300" />}
      </div>
      <p className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{value}</p>
    </div>
  );
}

// ── Placeholder names the tracking pixel uses for anonymous/unidentified visitors ──
const VISITOR_PLACEHOLDERS = new Set(['Visitor', 'Unknown', 'Anonymous Visitor', 'Anonymous', 'visitor', 'unknown']);

/** Resolve the best display name for a live visit entry */
function resolveVisitDisplayName(visit: any, t: (k: string, o?: any) => string): string {
  const isp: string | null = visit.lead?.isp || visit.isp || null;
  const rawBiz = (visit.lead?.business_name || '').trim();
  const businessName = rawBiz && !VISITOR_PLACEHOLDERS.has(rawBiz) ? rawBiz : null;
  const rawCN = (visit.lead?.contact_name || '').trim();
  const contactName = rawCN && !VISITOR_PLACEHOLDERS.has(rawCN) ? rawCN : null;
  const locParts = [visit.city, visit.countryCode || visit.country].filter(Boolean);
  const locationStr = locParts.length > 0 ? locParts.join(', ') : null;
  // Priority: identified company > person name > ISP network > city fallback > anonymous
  return (
    businessName ||
    contactName ||
    isp ||
    (locationStr ? t('analytics.visitorFrom', { city: locationStr }) : null) ||
    t('analytics.anonymousVisitor')
  );
}

function LiveTrafficDashboard() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [liveVisitors, setLiveVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | undefined>(undefined);
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
  const seenIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Demo visitors with real lat/lng for map pins — includes phone, email, website for popup cards
  const demoLiveVisitors = useMemo(() => [
    { id: 'dv-1', latitude: 30.2672, longitude: -97.7431, city: 'Austin', country: 'US', title: '/pricing', device: 'Desktop', timestamp: new Date(Date.now() - 30 * 1000).toISOString(), lead: { id: 'dl-1', business_name: 'Precision Auto Works', contact_name: 'Marcus Rivera', phone: '(512) 555-0147', email: 'marcus@precisionautoworks.com', website: 'https://precisionautoworks.com' }, brand: 'contndr' },
    { id: 'dv-2', latitude: 39.7392, longitude: -104.9903, city: 'Denver', country: 'US', title: '/features', device: 'Desktop', timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(), lead: { id: 'dl-2', business_name: 'Summit HVAC Solutions', contact_name: 'Rachel Kim', phone: '(720) 555-0283', email: 'rachel@summithvac.com', website: 'https://summithvac.com' }, brand: 'contndr' },
    { id: 'dv-3', latitude: 40.7128, longitude: -74.0060, city: 'New York', country: 'US', title: '/case-studies', device: 'Mobile', timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), lead: { id: 'dl-3', business_name: 'East Side Dental Group', contact_name: 'Dr. Sarah Chen', phone: '(212) 555-0391', email: 'schen@eastsidedental.com', website: 'https://eastsidedental.com' }, brand: 'contndr' },
    { id: 'dv-4', latitude: 34.0522, longitude: -118.2437, city: 'Los Angeles', country: 'US', title: '/integrations', device: 'Desktop', timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(), lead: { id: 'dl-4', business_name: 'Pacific Coast Realty', contact_name: 'Jason Park', phone: '(310) 555-0462', email: 'jason@pacificcoastrealty.com', website: 'https://pacificcoastrealty.com' }, brand: 'contndr' },
    { id: 'dv-5', latitude: 25.7617, longitude: -80.1918, city: 'Miami', country: 'US', title: '/', device: 'Mobile', timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(), lead: { id: 'dl-5', business_name: 'Sunshine Landscaping', contact_name: 'Carlos Mendez', phone: '(305) 555-0518', email: 'carlos@sunshinelandscaping.com', website: 'https://sunshinelandscaping.com' }, brand: 'contndr' },
    { id: 'dv-6', latitude: 41.8781, longitude: -87.6298, city: 'Chicago', country: 'US', title: '/pricing', device: 'Desktop', timestamp: new Date(Date.now() - 18 * 60 * 1000).toISOString(), lead: { id: 'dl-6', business_name: 'Midwest Roofing Co', contact_name: 'Tom Bradley', phone: '(312) 555-0674', email: 'tom@midwestroofing.com', website: 'https://midwestroofing.com' }, brand: 'contndr' },
    { id: 'dv-7', latitude: 47.6062, longitude: -122.3321, city: 'Seattle', country: 'US', title: '/blog/cold-email-guide', device: 'Tablet', timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(), lead: { id: 'dl-7', business_name: 'Evergreen IT Services', contact_name: 'Nina Patel', phone: '(206) 555-0739', email: 'nina@evergreenits.com', website: 'https://evergreenits.com' }, brand: 'contndr' },
    { id: 'dv-8', latitude: 33.4484, longitude: -112.0740, city: 'Phoenix', country: 'US', title: '/features', device: 'Desktop', timestamp: new Date(Date.now() - 35 * 60 * 1000).toISOString(), lead: { id: 'dl-8', business_name: 'Desert Valley Plumbing', contact_name: 'Mike Ortega', phone: '(602) 555-0851', email: 'mike@desertvalleyplumbing.com', website: 'https://desertvalleyplumbing.com' }, brand: 'contndr' },
    { id: 'dv-9', latitude: 29.7604, longitude: -95.3698, city: 'Houston', country: 'US', title: '/demo', device: 'Mobile', timestamp: new Date(Date.now() - 42 * 60 * 1000).toISOString(), lead: { id: 'dl-9', business_name: 'Gulf Coast Electric', contact_name: 'David Tran', phone: '(713) 555-0926', email: 'david@gulfcoastelectric.com', website: 'https://gulfcoastelectric.com' }, brand: 'contndr' },
    { id: 'dv-10', latitude: 33.7490, longitude: -84.3880, city: 'Atlanta', country: 'US', title: '/pricing', device: 'Desktop', timestamp: new Date(Date.now() - 50 * 60 * 1000).toISOString(), lead: { id: 'dl-10', business_name: 'Peachtree Marketing', contact_name: 'Lisa Monroe', phone: '(404) 555-0137', email: 'lisa@peachtreemarketing.com', website: 'https://peachtreemarketing.com' }, brand: 'contndr' },
    { id: 'dv-11', latitude: 37.7749, longitude: -122.4194, city: 'San Francisco', country: 'US', title: '/integrations', device: 'Desktop', timestamp: new Date(Date.now() - 55 * 60 * 1000).toISOString(), lead: { id: 'dl-11', business_name: 'Bay Area SaaS Inc', contact_name: 'Amir Hassan', phone: '(415) 555-0248', email: 'amir@bayareasaas.com', website: 'https://bayareasaas.com' }, brand: 'contndr' },
    { id: 'dv-12', latitude: 45.5152, longitude: -122.6784, city: 'Portland', country: 'US', title: '/', device: 'Tablet', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(), lead: { id: 'dl-12', business_name: 'Green Valley Landscaping', contact_name: 'Emma Kowalski', phone: '(503) 555-0365', email: 'emma@greenvalleypdx.com', website: 'https://greenvalleypdx.com' }, brand: 'contndr' },
  ], []);

  useEffect(() => {
    if (isDemoMode) {
      setLiveVisitors(demoLiveVisitors);
      setLoading(false);
      return;
    }
    loadRecentVisits();
    const interval = setInterval(loadRecentVisits, 5000);
    return () => clearInterval(interval);
  }, [isDemoMode]);

  // Check if the current user is an admin (has multiple brands)
  useEffect(() => {
    if (isDemoMode) return;
    async function checkAdmin() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          const email = session.user.email.toLowerCase();
          // Only admin accounts with multiple brands should see brand badges
          setIsAdmin(email === 'admin@contndr.com' || email === 'or@roadr.com');
        }
      } catch {}
    }
    checkAdmin();
  }, [isDemoMode]);

  async function loadRecentVisits() {
    if (isDemoMode) return;
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/live-traffic`
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.visits) {
           const recentVisits = data.visits;
           recentVisits.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

           const newVisits = recentVisits.filter((v: any) => !seenIdsRef.current.has(v.id));
           const currentIds = new Set(recentVisits.map((v: any) => v.id));
           seenIdsRef.current = currentIds;

           if (newVisits.length > 0) {
              if (firstLoadRef.current) {
                  const latest = newVisits[0];
                  const visitorName = latest.lead?.business_name;
                  const title = visitorName ? t('analytics.newVisitor', { name: visitorName }) : t('analytics.newVisitor', { name: '' }).replace(/[:\s]+$/, '');
                  toast(title, {
                      description: `${latest.title || t('analytics.viewingPage')} • ${latest.city || t('analytics.unknownLocation')}`
                  });
              } else {
                  newVisits.slice(0, 5).forEach((visit: any) => {
                      const visitorName = visit.lead?.business_name;
                      const title = visitorName ? t('analytics.newVisitor', { name: visitorName }) : t('analytics.newVisitor', { name: '' }).replace(/[:\s]+$/, '');
                      toast(title, {
                          description: `${visit.title || t('analytics.viewingPage')} • ${visit.city || t('analytics.unknownLocation')}`
                      });
                  });
              }
           }

           setLiveVisitors(recentVisits);
           firstLoadRef.current = false;
        }
      } else {
        console.error(`[Analytics] Live traffic API error: ${response.status} ${response.statusText}`);
      }
    } catch (error: any) {
      // Silently ignore network errors during polling (expected during network transitions, cold starts, etc.)
      if (error?.message?.includes('Network error') || error?.message === 'Failed to fetch') {
        // Ignore - will retry on next poll interval
      } else if (error?.message?.includes('Session expired') || error?.message?.includes('Not authenticated')) {
        // Ignore - auth listeners handle session state
      } else {
        console.error('[Analytics] Error polling live visits:', error?.message || error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100dvh-180px)] gap-4 animate-fade-in">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
           <div className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm shrink-0">
              <div className="relative flex items-center justify-center h-2.5 w-2.5 shrink-0">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${liveVisitors.length > 0 ? 'bg-[#1ED4A7]' : 'bg-zinc-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${liveVisitors.length > 0 ? 'bg-[#1ED4A7]' : 'bg-zinc-400'}`}></span>
              </div>
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                {t('analytics.onlineNow', { count: liveVisitors.length })}
              </span>
           </div>
           
           {/* Mobile View Toggle */}
           <div className="flex lg:hidden items-center bg-zinc-100 dark:bg-zinc-900 p-1 rounded-full border border-zinc-200 dark:border-zinc-800 shrink-0">
             <button
               onClick={() => setMobileView('map')}
               className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                 mobileView === 'map' 
                   ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' 
                   : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
               }`}
             >
               <MapPin className="w-3.5 h-3.5 shrink-0" />
               <span>{t('analytics.mapView', 'Map')}</span>
             </button>
             <button
               onClick={() => setMobileView('list')}
               className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                 mobileView === 'list' 
                   ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' 
                   : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
               }`}
             >
               <List className="w-3.5 h-3.5 shrink-0" />
               <span>{t('analytics.listView', 'List')}</span>
             </button>
           </div>
        </div>
        {!isDemoMode && (
          <button 
             onClick={() => setShowSetup(true)}
             className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 flex items-center justify-center gap-1.5 transition-colors shrink-0 whitespace-nowrap"
          >
             <Globe className="w-4 h-4 shrink-0" />
             <span>{t('analytics.trackingSetup')}</span>
          </button>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0 overflow-hidden">
        {/* Map - Takes up 2 cols - No Card Styling */}
        <div className={`col-span-1 lg:col-span-2 relative h-[500px] lg:h-full min-h-[300px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#050505]/50 ${mobileView === 'map' ? 'block' : 'hidden lg:block'}`}>
           <RealTimeMap 
             visits={liveVisitors} 
             className="w-full h-full absolute inset-0"
             focusedVisitId={selectedVisitorId}
           /> 
        </div>

        {/* Right List - Clean styling */}
        <div className={`lg:col-span-1 h-full min-h-0 max-h-[500px] lg:max-h-none flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#050505] overflow-hidden shadow-sm ${mobileView === 'list' ? 'flex' : 'hidden lg:flex'}`}>
           <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0 bg-zinc-50/50 dark:bg-[#050505]">
              <div className="flex items-center gap-2">
                 <div className="w-4 h-4 flex items-center justify-center">
                    <div className="w-3 h-3 border-2 border-zinc-400 rounded-full border-t-transparent animate-spin" style={{ animationDuration: '3s' }}></div>
                 </div>
                 <h3 className="font-bold text-zinc-900 dark:text-white text-sm">{t('analytics.activityFeed')}</h3>
              </div>
           </div>
           
           <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar relative bg-white dark:bg-black">
             {loading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                   <LoadingSpinner />
                </div>
             ) : liveVisitors.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 p-6 text-center">
                   <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
                      <Globe className="w-6 h-6 text-zinc-400" />
                   </div>
                   <p className="text-sm font-medium text-zinc-900 dark:text-white mb-1">{t('analytics.noActiveVisitors')}</p>
                   <p className="text-xs text-zinc-500">{t('analytics.visitorsWillAppear')}</p>
                </div>
             ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                   {liveVisitors.map((visit) => (
                      <div 
                         key={visit.id} 
                         onClick={() => setSelectedVisitorId(visit.id)}
                         className={`p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors flex items-start gap-3 cursor-pointer group ${
                             selectedVisitorId === visit.id ? 'bg-zinc-50 dark:bg-zinc-900/50' : ''
                         }`}
                      >
                         <div className="flex-shrink-0 mt-1">
                            {visit.lead?.logo_url ? (
                               <img src={visit.lead.logo_url} alt="" className="w-5 h-5 rounded-full object-cover shadow-sm bg-white border border-zinc-200" />
                            ) : (
                               <div className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse mx-1.5 my-1.5"></div>
                            )}
                         </div>
                         
                         <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                               <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                                  {(() => {
                                     const isp = visit.lead?.isp || visit.isp || null;
                                     const businessName = visit.lead?.business_name && visit.lead.business_name !== 'Anonymous Visitor'
                                       ? visit.lead.business_name
                                       : null;
                                       
                                     const locParts = [visit.city, visit.countryCode || visit.country].filter(Boolean);
                                     const locationStr = locParts.length > 0 ? locParts.join(', ') : null;

                                     return businessName || 
                                       (locationStr ? t('analytics.visitorFrom', { city: locationStr }) : null) ||
                                       isp || 
                                       (visit.lead?.contact_name && !['Unknown', 'Visitor'].includes(visit.lead.contact_name) ? visit.lead.contact_name : null) ||
                                       t('analytics.anonymousVisitor');
                                  })()}
                               </p>
                               {isAdmin && (() => {
                                  const rawBrand = (visit.lead?.brand || visit.brand || '').toLowerCase();
                                  const title = (visit.title || '').toLowerCase();
                                  
                                  let display = null;
                                  
                                  // Priority 1: Specific content path indicators
                                  if (title.includes('/collection/')) {
                                      display = 'SOURCR';
                                  }
                                  // Priority 2: Trust the script/database brand exactly as provided
                                  else if (rawBrand) {
                                      if (rawBrand === 'roadr') display = 'ROADR';
                                      else if (rawBrand === 'covera') display = 'COVERA';
                                      else if (rawBrand === 'contndr' || rawBrand === 'sendlr') display = 'CONTNDR';
                                      else if (rawBrand === 'sourcr') display = 'SOURCR';
                                      else display = rawBrand.toUpperCase();
                                  }
                                  // Priority 3: Default to Sourcr (Legacy)
                                  else {
                                      display = 'SOURCR';
                                  }

                                  if (!display) return null;

                                  return (
                                   <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 whitespace-nowrap uppercase tracking-wider">
                                      {display}
                                   </span>
                                  );
                               })()}
                            </div>

                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors" title={visit.title || t('analytics.viewingPage')}>
                               {visit.title || t('analytics.viewingPage')}
                            </p>

                            {(() => {
                               const businessName = visit.lead?.business_name && visit.lead.business_name !== 'Anonymous Visitor'
                                 ? visit.lead.business_name
                                 : null;
                               const hasLocationTitle = !businessName && (visit.city || visit.country);
                               const isp = visit.lead?.isp || visit.isp || null;

                               if (hasLocationTitle && isp) {
                                  return (
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 flex items-center gap-1" title="Internet Service Provider">
                                       <Network className="w-3 h-3" />
                                       <span className="truncate">{isp}</span>
                                    </p>
                                  );
                               }

                               if (visit.city || visit.country) {
                                  return (
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 flex items-center gap-1">
                                       <MapPin className="w-3 h-3" />
                                       <span className="truncate">{[visit.city, visit.countryCode || visit.country].filter(Boolean).join(', ')}</span>
                                    </p>
                                  );
                               }
                               return null;
                            })()}

                            {/* Affiliate attribution — shows which rep's link brought this visitor */}
                            {visit.affiliate_ref && (
                               <div className="flex items-center gap-1 mt-1.5">
                                  <Link2 className="w-3 h-3 text-[#1ED4A7]" />
                                  <span className="text-[11px] font-medium text-[#1ED4A7]">
                                     {t('analytics.via')} {visit.affiliate_ref}
                                  </span>
                               </div>
                            )}
                         </div>

                         <span className="text-xs font-medium text-zinc-400 whitespace-nowrap">
                            {(() => {
                               const diff = (Date.now() - new Date(visit.timestamp).getTime()) / 1000;
                               if (diff < 60) return t('analytics.justNow');
                               if (diff < 3600) return `${Math.floor(diff / 60)}m`;
                               return `${Math.floor(diff / 3600)}h`;
                            })()}
                         </span>
                      </div>
                   ))}
                </div>
             )}
           </div>
        </div>
      </div>

      {showSetup && !isDemoMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fade-in">
          <div 
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowSetup(false)}
          />
          <div className="relative w-full max-w-2xl bg-white dark:bg-[#0A0A0A] rounded-2xl shadow-2xl animate-scale-in border border-zinc-200 dark:border-white/10 max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-end p-4 pb-0 flex-shrink-0">
              <IconButton
                onClick={() => setShowSetup(false)}
                title={t('analytics.close')}
                aria-label={t('analytics.close')}
              >
                <X />
              </IconButton>
            </div>
            <div className="p-6 pt-2 overflow-y-auto">
              <WebTrackingManager />
              <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  onClick={() => {
                    setShowSetup(false);
                    window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'settings' }));
                    setTimeout(() => window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'tracking' })), 100);
                  }}
                  className="w-full text-center text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors py-2"
                >
                  {t('analytics.openFullTracking')} &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdvancedAnalytics;
