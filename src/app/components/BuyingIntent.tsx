import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  TrendingUp, Target, Zap, Eye, MousePointerClick, Mail,
  Globe, Search, Activity, ChevronDown, ChevronRight, Plus, Trash2,
  RefreshCw, Settings2, BarChart3, Clock, ArrowUpRight, ArrowDownRight,
  Sparkles, Filter, Download, X, Check, AlertTriangle, Loader2,
  Building2, User, Tag, Radio, Bell, Play, Pause, ChevronUp,
  ExternalLink, Crosshair, ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { LeadDetailModal } from './LeadDetailModal';
import { apiCache } from '../lib/api-cache';

// ─── Types ───────────────────────────────────────────────────────────

interface CompanyScore {
  company_id: string;
  company_name: string;
  website_points: number;
  email_points: number;
  keyword_points: number;
  activity_points: number;
  total_score: number;
  status: 'cold' | 'warm' | 'hot' | 'buying_now';
  signal_count: number;
  last_signal_at: string;
  last_updated: string;
  top_signals: string[];
}

interface IntentSignal {
  id: string;
  user_id: string;
  company_id?: string;
  company_name?: string;
  person_id?: string;
  person_name?: string;
  person_email?: string;
  signal_type: 'website' | 'email' | 'keyword' | 'activity';
  signal_detail: string;
  score: number;
  metadata?: Record<string, any>;
  created_at: string;
}

interface IntentRule {
  id: string;
  name: string;
  condition_type: string;
  condition_value: string;
  actions: { type: string; value: string }[];
  enabled: boolean;
  created_at: string;
  last_triggered?: string;
  trigger_count: number;
}

interface IntentConfig {
  keywords: string[];
  high_intent_pages: string[];
  tracked_tech: string[];
  activity_keywords: string[];
}

interface DashboardData {
  summary: {
    total_companies: number;
    buying_now: number;
    hot: number;
    warm: number;
    cold: number;
    total_signals: number;
    signals_this_week: number;
    trend_pct: number;
  };
  companies: CompanyScore[];
  recent_signals: IntentSignal[];
  recent_activity: any[];
  signal_distribution: {
    website: number;
    email: number;
    keyword: number;
    activity: number;
  };
  config: IntentConfig;
  rules: IntentRule[];
}

// ─── Constants ───────────────────────────────────────────────────────

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/intent`;

const STATUS_CONFIG = {
  buying_now: { labelKey: 'buyingIntentView.buyingNow', dot: 'bg-[#1ED4A7]', icon: Crosshair },
  hot: { labelKey: 'buyingIntentView.hot', dot: 'bg-zinc-900 dark:bg-zinc-100', icon: TrendingUp },
  warm: { labelKey: 'buyingIntentView.warm', dot: 'bg-zinc-500', icon: Target },
  cold: { labelKey: 'buyingIntentView.cold', dot: 'bg-zinc-400', icon: Activity },
};

const SIGNAL_TYPE_CONFIG = {
  website: { labelKey: 'buyingIntentView.web', icon: Globe },
  email: { labelKey: 'buyingIntentView.email', icon: Mail },
  keyword: { labelKey: 'buyingIntentView.keyword', icon: Search },
  activity: { labelKey: 'buyingIntentView.activity', icon: Activity },
};

// Signal detail keys for i18n lookup
const SIGNAL_DETAIL_KEYS = [
  'page_visit_general', 'page_visit_homepage', 'page_visit_pricing', 'page_visit_demo',
  'page_visit_contact', 'page_visit_case_study', 'page_visit_compare', 'page_visit_features',
  'page_visit_book_call', 'email_click_visit', 'repeat_visit_7d', 'time_on_site_3min',
  'multiple_pages', 'email_opened', 'email_clicked', 'email_replied', 'email_multiple_replies',
  'email_forwarded', 'email_opened_multiple', 'keyword_match_industry', 'keyword_match_title',
  'keyword_match_description', 'keyword_match_blog', 'keyword_match_job_posting',
  'tech_stack_installed', 'tech_stack_removed', 'competitor_mention', 'lead_status_interested',
  'lead_status_meeting_scheduled', 'lead_status_replied', 'lead_status_engaged',
  'lead_status_converted', 'funding_raised', 'new_hire_vp_sales', 'hiring_bdrs',
  'expansion_new_location', 'leadership_change', 'product_launch', 'partnership_announcement',
];

// ─── Helpers ─────────────────────────────────────────────────────────

// timeAgo is now a hook-dependent helper — moved inside component via useCallback

// ─── Radial Score Gauge ──────────────────────────────────────────────

function RadialScore({ score, size = 56, strokeWidth = 4 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const strokeColor = score >= 60 ? '#1ED4A7' : score >= 30 ? '#71717a' : '#a1a1aa';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          className="stroke-zinc-200/60 dark:stroke-zinc-800/60"
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke={strokeColor}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-white">
          {score}
        </span>
      </div>
    </div>
  );
}

// ─── Status Pill ─────────────────────────────────────────────────────

function StatusPill({ status }: { status: CompanyScore['status'] }) {
  const { t } = useTranslation();
  const cfg = STATUS_CONFIG[status];
  const isBuying = status === 'buying_now';
  return (
    <span className={`inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap
      ${isBuying
        ? 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200/50 dark:ring-zinc-700/50'
        : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200/50 dark:ring-zinc-700/50'
      }`}
    >
      <span className={`inline-flex rounded-full h-1.5 w-1.5 ${cfg.dot}`} />
      {t(cfg.labelKey)}
    </span>
  );
}

// ─── Animated Counter ────────────────────────────────────────────────

function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>();
  useEffect(() => {
    const start = display;
    const diff = value - start;
    if (diff === 0) return;
    const duration = 800;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) ref.current = requestAnimationFrame(animate);
    };
    ref.current = requestAnimationFrame(animate);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [value]);
  return <span className={className}>{display}</span>;
}

// ─── Main Component ──────────────────────────────────────────────────

export function BuyingIntent() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();

  // i18n helper: translate signal detail keys
  const translateSignalDetail = useCallback((detail: string): string => {
    const key = `buyingIntentView.signalDetails.${detail}`;
    const translated = t(key);
    // If no translation found (key returned as-is), fall back to the raw detail string
    return translated === key ? detail : translated;
  }, [t]);

  // i18n helper: time ago
  const timeAgo = useCallback((dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('buyingIntentView.timeAgo.justNow');
    if (mins < 60) return t('buyingIntentView.timeAgo.minsAgo', { mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('buyingIntentView.timeAgo.hoursAgo', { hrs });
    const days = Math.floor(hrs / 24);
    if (days < 7) return t('buyingIntentView.timeAgo.daysAgo', { days });
    return t('buyingIntentView.timeAgo.weeksAgo', { weeks: Math.floor(days / 7) });
  }, [t]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'signals' | 'rules' | 'config'>('leaderboard');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [companyDetail, setCompanyDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [isDemoAccount, setIsDemoAccount] = useState(false);

  // Detect demo account
  useEffect(() => {
    if (isDemoMode) {
      setIsDemoAccount(true);
      return;
    }
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsDemoAccount(session?.user?.email === 'demo@contndr.com');
    });
  }, [isDemoMode]);

  const [editConfig, setEditConfig] = useState<IntentConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', condition_type: 'score_above', condition_value: '60', action_type: 'add_to_list', action_value: 'High Intent Leads' });

  const [showAddSignal, setShowAddSignal] = useState(false);
  const [newSignal, setNewSignal] = useState({ company_name: '', signal_type: 'website', signal_detail: 'page_visit_pricing', score: 20 });

  // Lead profile viewer
  const [viewingLeadId, setViewingLeadId] = useState<string | null>(null);
  const [lookingUpPerson, setLookingUpPerson] = useState<string | null>(null);

  const openPersonProfile = useCallback(async (person: { name?: string; email?: string; person_id?: string }) => {
    if (person.person_id) { setViewingLeadId(person.person_id); return; }
    const key = person.email || person.name || '';
    if (!key) return;
    setLookingUpPerson(key);
    try {
      if (isDemoMode) {
        // In demo mode just signal we tried — no real DB
        toast.info('Lead profile not available in demo mode');
        return;
      }
      // Try by email first, then by name
      let query = supabase.from('leads').select('id').limit(1);
      if (person.email) {
        // emails is a jsonb array; try matching in the emails column or person_email field
        const { data: byEmail } = await supabase
          .from('leads')
          .select('id')
          .or(`person_email.eq.${person.email},contact_email.eq.${person.email}`)
          .limit(1);
        if (byEmail && byEmail.length > 0) { setViewingLeadId(byEmail[0].id); return; }
        // Try inside jsonb emails array
        const { data: byJsonb } = await supabase
          .from('leads')
          .select('id')
          .filter('emails', 'cs', JSON.stringify([{ email: person.email }]))
          .limit(1);
        if (byJsonb && byJsonb.length > 0) { setViewingLeadId(byJsonb[0].id); return; }
      }
      if (person.name) {
        const { data: byName } = await supabase
          .from('leads')
          .select('id')
          .ilike('contact_name', `%${person.name}%`)
          .limit(1);
        if (byName && byName.length > 0) { setViewingLeadId(byName[0].id); return; }
      }
      toast.error('Lead profile not found in CRM');
    } catch (e: any) {
      toast.error('Could not open lead profile');
    } finally {
      setLookingUpPerson(null);
    }
  }, [isDemoMode]);

  // Live clock tick for "time ago" freshness
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(prev => prev + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const scanTriggeredRef = useRef(false);

  function loadDemoIntentData() {
    console.log('[DEMO] Loading demo buying intent data');
    
    const now = Date.now();
    const demoData: DashboardData = {
      summary: {
        total_companies: 12,
        buying_now: 3,
        hot: 4,
        warm: 4,
        cold: 1,
        total_signals: 84,
        signals_this_week: 28,
        trend_pct: 24.5,
      },
      companies: [
        {
          company_id: 'stripe-demo',
          company_name: 'Stripe',
          website_points: 60,
          email_points: 40,
          keyword_points: 20,
          activity_points: 30,
          total_score: 150,
          status: 'buying_now',
          signal_count: 12,
          last_signal_at: new Date(now - 15 * 60000).toISOString(),
          last_updated: new Date(now - 15 * 60000).toISOString(),
          top_signals: ['Visited pricing page 4 times', 'Opened 3 emails in 24h', 'Clicked demo link'],
        },
        {
          company_id: 'notion-demo',
          company_name: 'Notion',
          website_points: 40,
          email_points: 50,
          keyword_points: 15,
          activity_points: 25,
          total_score: 130,
          status: 'buying_now',
          signal_count: 9,
          last_signal_at: new Date(now - 45 * 60000).toISOString(),
          last_updated: new Date(now - 45 * 60000).toISOString(),
          top_signals: ['Email reply: "interested"', 'Visited features page', 'Downloaded whitepaper'],
        },
        {
          company_id: 'datadog-demo',
          company_name: 'Datadog',
          website_points: 35,
          email_points: 45,
          keyword_points: 10,
          activity_points: 20,
          total_score: 110,
          status: 'buying_now',
          signal_count: 7,
          last_signal_at: new Date(now - 2 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 2 * 60 * 60000).toISOString(),
          top_signals: ['Opened proposal', 'Active on site', 'Clicked ROI calculator'],
        },
        {
          company_id: 'linear-demo',
          company_name: 'Linear',
          website_points: 30,
          email_points: 30,
          keyword_points: 12,
          activity_points: 18,
          total_score: 90,
          status: 'hot',
          signal_count: 6,
          last_signal_at: new Date(now - 4 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 4 * 60 * 60000).toISOString(),
          top_signals: ['Visited case studies', 'Email click-through', 'Browsing integrations'],
        },
        {
          company_id: 'vercel-demo',
          company_name: 'Vercel',
          website_points: 25,
          email_points: 35,
          keyword_points: 8,
          activity_points: 15,
          total_score: 83,
          status: 'hot',
          signal_count: 5,
          last_signal_at: new Date(now - 6 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 6 * 60 * 60000).toISOString(),
          top_signals: ['Email opened twice', 'Website revisit', 'Viewed testimonials'],
        },
        {
          company_id: 'figma-demo',
          company_name: 'Figma',
          website_points: 20,
          email_points: 25,
          keyword_points: 10,
          activity_points: 15,
          total_score: 70,
          status: 'hot',
          signal_count: 4,
          last_signal_at: new Date(now - 8 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 8 * 60 * 60000).toISOString(),
          top_signals: ['Opened case study email', 'Visited /pricing', 'Browsing integrations'],
        },
        {
          company_id: 'shopify-demo',
          company_name: 'Shopify',
          website_points: 18,
          email_points: 20,
          keyword_points: 12,
          activity_points: 10,
          total_score: 60,
          status: 'hot',
          signal_count: 4,
          last_signal_at: new Date(now - 10 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 10 * 60 * 60000).toISOString(),
          top_signals: ['Clicked pricing link', 'Multiple page views', 'Job posting matches ICP'],
        },
        {
          company_id: 'hubspot-demo',
          company_name: 'HubSpot',
          website_points: 15,
          email_points: 10,
          keyword_points: 8,
          activity_points: 12,
          total_score: 45,
          status: 'warm',
          signal_count: 3,
          last_signal_at: new Date(now - 18 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 18 * 60 * 60000).toISOString(),
          top_signals: ['Email opened', 'Visited homepage', 'Industry keyword match'],
        },
        {
          company_id: 'intercom-demo',
          company_name: 'Intercom',
          website_points: 12,
          email_points: 8,
          keyword_points: 10,
          activity_points: 8,
          total_score: 38,
          status: 'warm',
          signal_count: 3,
          last_signal_at: new Date(now - 24 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 24 * 60 * 60000).toISOString(),
          top_signals: ['Visited features page', 'Keyword: sales automation', 'Email delivered'],
        },
        {
          company_id: 'webflow-demo',
          company_name: 'Webflow',
          website_points: 10,
          email_points: 12,
          keyword_points: 5,
          activity_points: 8,
          total_score: 35,
          status: 'warm',
          signal_count: 2,
          last_signal_at: new Date(now - 36 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 36 * 60 * 60000).toISOString(),
          top_signals: ['Email opened once', 'Browsed blog'],
        },
        {
          company_id: 'airtable-demo',
          company_name: 'Airtable',
          website_points: 8,
          email_points: 10,
          keyword_points: 6,
          activity_points: 6,
          total_score: 30,
          status: 'warm',
          signal_count: 2,
          last_signal_at: new Date(now - 48 * 60 * 60000).toISOString(),
          last_updated: new Date(now - 48 * 60 * 60000).toISOString(),
          top_signals: ['Visited homepage', 'Email click-through'],
        },
      ],
      recent_signals: [
        {
          id: 'sig-1',
          user_id: 'demo',
          company_id: 'stripe-demo',
          company_name: 'Stripe',
          signal_type: 'website',
          signal_detail: 'Visited /pricing (4th visit this week)',
          score: 25,
          created_at: new Date(now - 15 * 60000).toISOString(),
        },
        {
          id: 'sig-2',
          user_id: 'demo',
          company_id: 'notion-demo',
          company_name: 'Notion',
          signal_type: 'email',
          signal_detail: 'Reply containing keyword: "interested in a demo"',
          score: 30,
          created_at: new Date(now - 45 * 60000).toISOString(),
        },
        {
          id: 'sig-3',
          user_id: 'demo',
          company_id: 'datadog-demo',
          company_name: 'Datadog',
          signal_type: 'website',
          signal_detail: 'Clicked ROI calculator on pricing page',
          score: 20,
          created_at: new Date(now - 2 * 60 * 60000).toISOString(),
        },
        {
          id: 'sig-4',
          user_id: 'demo',
          company_id: 'linear-demo',
          company_name: 'Linear',
          signal_type: 'email',
          signal_detail: 'Clicked link in follow-up email',
          score: 18,
          created_at: new Date(now - 4 * 60 * 60000).toISOString(),
        },
        {
          id: 'sig-5',
          user_id: 'demo',
          company_id: 'figma-demo',
          company_name: 'Figma',
          person_name: 'Amy Torres',
          person_email: 'amy@figma.com',
          signal_type: 'email',
          signal_detail: 'Opened case study email',
          score: 15,
          created_at: new Date(now - 8 * 60 * 60000).toISOString(),
        },
        {
          id: 'sig-6',
          user_id: 'demo',
          company_id: 'shopify-demo',
          company_name: 'Shopify',
          signal_type: 'keyword',
          signal_detail: 'Job posting matches ICP: "Sales Automation Engineer"',
          score: 12,
          created_at: new Date(now - 10 * 60 * 60000).toISOString(),
        },
        {
          id: 'sig-7',
          user_id: 'demo',
          company_id: 'vercel-demo',
          company_name: 'Vercel',
          signal_type: 'activity',
          signal_detail: 'Lead marked as interested after demo call',
          score: 22,
          created_at: new Date(now - 6 * 60 * 60000).toISOString(),
        },
      ],
      signal_distribution: {
        website: 38,
        email: 29,
        keyword: 12,
        activity: 21,
      },
      recent_activity: [],
      rules: [
        {
          id: 'rule-1',
          name: 'Auto-tag hot leads from pricing page',
          condition_type: 'signal_score_above',
          condition_value: '80',
          actions: [{ type: 'tag', value: 'hot-lead' }],
          enabled: true,
          created_at: new Date(Date.now() - 7 * 24 * 60 * 60000).toISOString(),
          last_triggered: new Date(Date.now() - 2 * 60 * 60000).toISOString(),
          trigger_count: 14,
        },
        {
          id: 'rule-2',
          name: 'Notify on buying-now companies',
          condition_type: 'status_change',
          condition_value: 'buying_now',
          actions: [{ type: 'notify', value: 'slack' }],
          enabled: true,
          created_at: new Date(Date.now() - 14 * 24 * 60 * 60000).toISOString(),
          last_triggered: new Date(Date.now() - 45 * 60000).toISOString(),
          trigger_count: 8,
        },
      ],
      config: {
        keywords: ['pricing', 'demo', 'trial', 'quote', 'budget', 'implementation'],
        high_intent_pages: ['/pricing', '/demo', '/contact', '/get-started'],
        tracked_tech: ['Salesforce', 'HubSpot', 'Intercom'],
        activity_keywords: ['interested', 'budget', 'timeline', 'decision', 'meeting'],
      },
    };
    
    setData(demoData);
    setLoading(false);
    setError(null);
  }

  const fetchDashboard = useCallback(async () => {
    try {
      setError(null);
      // Consume prefetched data from App.tsx viewPreloadMap so first paint is instant
      const json = await apiCache.fetch(
        'intent:dashboard',
        async () => {
          const res = await authenticatedFetch(`${BASE}/dashboard`, { signal: AbortSignal.timeout(30000) });
          if (!res.ok) throw new Error(`${t('buyingIntentView.failedToFetchIntentData')}: ${res.status}`);
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      setData(json);

      // Auto-scan leads for keyword/activity signals once per session
      if (!scanTriggeredRef.current) {
        scanTriggeredRef.current = true;
        authenticatedFetch(`${BASE}/scan-leads`, { method: 'POST' })
          .then(async (scanRes) => {
            if (scanRes.ok) {
              const scanResult = await scanRes.json();
              if (scanResult.signals_created > 0) {
                console.log(`[INTENT] Auto-scan created ${scanResult.signals_created} new signals`);
                // Refresh dashboard to pick up new signals
                const refreshRes = await authenticatedFetch(`${BASE}/dashboard`, { signal: AbortSignal.timeout(30000) });
                if (refreshRes.ok) setData(await refreshRes.json());
              }
            }
          })
          .catch((e) => console.warn('[INTENT] Auto-scan failed (non-fatal):', e));
      }
    } catch (e: any) {
      console.error('[INTENT UI] Fetch error:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { 
    if (isDemoMode) {
      loadDemoIntentData();
      return;
    }
    fetchDashboard(); 
  }, [fetchDashboard, isDemoMode]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (isDemoMode) return;
    const interval = setInterval(fetchDashboard, 60000);
    return () => clearInterval(interval);
  }, [fetchDashboard, isDemoMode]);

  const seedDemo = async () => {
    if (isDemoMode) { toast.success(t('buyingIntentView.demoAlreadyLoaded')); setSeeding(false); return; }
    setSeeding(true);
    try {
      const res = await authenticatedFetch(`${BASE}/seed-demo`, { method: 'POST' });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToSeedDemoData'));
      const json = await res.json();
      toast.success(t('buyingIntentView.seededSignals', { signals: json.signals_created, companies: json.companies }));
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSeeding(false);
    }
  };

  const clearData = async () => {
    if (isDemoMode) { toast.success(t('buyingIntentView.dataCleared')); return; }
    if (!confirm(t('buyingIntentView.clearConfirm'))) return;
    try {
      const res = await authenticatedFetch(`${BASE}/clear`, { method: 'POST' });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToClearData'));
      toast.success(t('buyingIntentView.allDataCleared'));
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const recompute = async () => {
    if (isDemoMode) { toast.success(t('buyingIntentView.scoresRecomputedDemo')); return; }
    setRecomputing(true);
    try {
      const res = await authenticatedFetch(`${BASE}/recompute`, { method: 'POST' });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToRecompute'));
      toast.success(t('buyingIntentView.scoresRecomputed'));
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRecomputing(false);
    }
  };

  const fetchCompanyDetail = async (companyId: string) => {
    if (expandedCompany === companyId) {
      setExpandedCompany(null);
      setCompanyDetail(null);
      return;
    }
    setExpandedCompany(companyId);
    setLoadingDetail(true);

    // Demo mode: build synthetic company detail from existing demo data
    if (isDemoMode) {
      const company = data?.companies.find(c => c.company_id === companyId);
      const companySignals = (data?.recent_signals || []).filter(s => s.company_id === companyId);
      const now = Date.now();
      // If no matching signals in the global list, synthesize some from top_signals
      const signals: IntentSignal[] = companySignals.length > 0 ? companySignals : (company?.top_signals || []).map((detail, i) => ({
        id: `${companyId}-sig-${i}`,
        user_id: 'demo',
        company_id: companyId,
        company_name: company?.company_name,
        signal_type: (['website', 'email', 'keyword', 'activity'] as const)[i % 4],
        signal_detail: detail,
        score: Math.floor(Math.random() * 20) + 10,
        created_at: new Date(now - (i + 1) * 3 * 60 * 60000).toISOString(),
      }));
      // Synthetic people for each demo company
      const demoCompanyPeople: Record<string, { name: string; email: string; signal_count: number }[]> = {
        'stripe-demo': [
          { name: 'Sarah Chen', email: 'sarah@stripe.com', signal_count: 5 },
          { name: 'Marcus Reid', email: 'marcus@stripe.com', signal_count: 3 },
        ],
        'notion-demo': [
          { name: 'James Park', email: 'james@notion.so', signal_count: 4 },
          { name: 'Rachel Kim', email: 'rachel@notion.so', signal_count: 2 },
        ],
        'datadog-demo': [
          { name: 'Olivier Pomel', email: 'olivier@datadoghq.com', signal_count: 3 },
        ],
        'linear-demo': [
          { name: 'Karri Saarinen', email: 'karri@linear.app', signal_count: 4 },
        ],
        'vercel-demo': [
          { name: 'Guillermo Rauch', email: 'guillermo@vercel.com', signal_count: 3 },
        ],
        'figma-demo': [
          { name: 'Dylan Field', email: 'dylan@figma.com', signal_count: 2 },
          { name: 'Amy Torres', email: 'amy@figma.com', signal_count: 2 },
        ],
        'shopify-demo': [
          { name: 'Tobi Lutke', email: 'tobi@shopify.com', signal_count: 2 },
        ],
        'hubspot-demo': [
          { name: 'Yamini Rangan', email: 'yamini@hubspot.com', signal_count: 2 },
        ],
        'intercom-demo': [
          { name: 'Eoghan McCabe', email: 'eoghan@intercom.com', signal_count: 1 },
        ],
        'webflow-demo': [
          { name: 'Vlad Magdalin', email: 'vlad@webflow.com', signal_count: 1 },
        ],
        'airtable-demo': [
          { name: 'Howie Liu', email: 'howie@airtable.com', signal_count: 1 },
        ],
      };
      setCompanyDetail({
        signals,
        people: demoCompanyPeople[companyId] || [{ name: (company?.company_name || 'Company') + ' Contact', email: `contact@${(company?.company_name || 'company').toLowerCase()}.com`, signal_count: 1 }],
      });
      setLoadingDetail(false);
      return;
    }

    try {
      const res = await authenticatedFetch(`${BASE}/company/${companyId}`);
      if (!res.ok) throw new Error(t('buyingIntentView.failedToFetchCompanyDetail'));
      setCompanyDetail(await res.json());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const addSignal = async () => {
    if (isDemoMode) { toast.success(t('buyingIntentView.signalRecordedDemo')); setShowAddSignal(false); return; }
    try {
      const companyId = `manual_${newSignal.company_name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
      const res = await authenticatedFetch(`${BASE}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          company_name: newSignal.company_name,
          signal_type: newSignal.signal_type,
          signal_detail: newSignal.signal_detail,
          score: newSignal.score,
        }),
      });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToAddSignal'));
      toast.success(t('buyingIntentView.signalRecorded'));
      setShowAddSignal(false);
      setNewSignal({ company_name: '', signal_type: 'website', signal_detail: 'page_visit_pricing', score: 20 });
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const saveConfig = async () => {
    if (!editConfig) return;
    if (isDemoMode) { toast.success(t('buyingIntentView.configSavedDemo')); setSavingConfig(false); return; }
    setSavingConfig(true);
    try {
      const res = await authenticatedFetch(`${BASE}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editConfig),
      });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToSaveConfig'));
      toast.success(t('buyingIntentView.configSaved'));
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const addRule = async () => {
    if (isDemoMode) { toast.success(t('buyingIntentView.ruleCreatedDemo')); setShowNewRule(false); return; }
    try {
      const res = await authenticatedFetch(`${BASE}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRule.name,
          condition_type: newRule.condition_type,
          condition_value: newRule.condition_value,
          actions: [{ type: newRule.action_type, value: newRule.action_value }],
          enabled: true,
        }),
      });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToCreateRule'));
      toast.success(t('buyingIntentView.ruleCreated'));
      setShowNewRule(false);
      setNewRule({ name: '', condition_type: 'score_above', condition_value: '60', action_type: 'add_to_list', action_value: t('buyingIntentView.highIntentLeads') });
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (isDemoMode) { toast.success(t('buyingIntentView.ruleDeletedDemo')); return; }
    try {
      const res = await authenticatedFetch(`${BASE}/rules/${ruleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToDeleteRule'));
      toast.success(t('buyingIntentView.ruleDeleted'));
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleRule = async (rule: IntentRule) => {
    if (isDemoMode) { toast.success(t('buyingIntentView.ruleToggled')); return; }
    try {
      const res = await authenticatedFetch(`${BASE}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error(t('buyingIntentView.failedToToggleRule'));
      await fetchDashboard();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ─── Loading / Error States ────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-900 dark:text-white">{t('buyingIntentView.loadingIntentEngine')}</p>
            <p className="text-xs text-zinc-400 mt-1">{t('buyingIntentView.analyzingSignals')}</p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-4 max-w-sm">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5 text-zinc-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-white">{t('buyingIntentView.connectionLost')}</p>
            <p className="text-xs text-zinc-500 mt-1">{error}</p>
          </div>
          <button onClick={fetchDashboard} className="text-xs font-medium text-zinc-900 dark:text-white hover:underline">
            {t('buyingIntentView.tryAgain')}
          </button>
        </motion.div>
      </div>
    );
  }

  const summary = data?.summary || { total_companies: 0, buying_now: 0, hot: 0, warm: 0, cold: 0, total_signals: 0, signals_this_week: 0, trend_pct: 0 };
  const companies = data?.companies || [];
  const filteredCompanies = statusFilter === 'all' ? companies : companies.filter(c => c.status === statusFilter);
  const signals = data?.recent_signals || [];
  const rules = data?.rules || [];
  const config = data?.config || { keywords: [], high_intent_pages: [], tracked_tech: [], activity_keywords: [] };
  const dist = data?.signal_distribution || { website: 0, email: 0, keyword: 0, activity: 0 };
  const totalDist = dist.website + dist.email + dist.keyword + dist.activity || 1;

  const tabs = [
    { id: 'leaderboard' as const, label: t('buyingIntentView.leaderboard'), icon: BarChart3 },
    { id: 'signals' as const, label: t('buyingIntentView.signals'), icon: Radio },
    { id: 'rules' as const, label: t('buyingIntentView.rules'), icon: Zap },
    { id: 'config' as const, label: t('buyingIntentView.config'), icon: Settings2 },
  ];

  return (
    <>
    <div className="h-full overflow-y-auto">
      <div className="px-3 sm:px-6 py-4 sm:py-8 space-y-5 sm:space-y-8">

        {/* ── Header ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('buyingIntentView.title')}</h1>
            <span className="text-xs text-zinc-400 hidden sm:inline">{t('buyingIntentView.signalsTracked', { count: summary.total_signals })}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowAddSignal(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
            >
              <Plus className="w-3 h-3" />
              {t('buyingIntentView.signalBtn')}
            </button>
            <button
              onClick={recompute}
              disabled={recomputing}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-zinc-700 transition-all disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${recomputing ? 'animate-spin' : ''}`} />
              {t('buyingIntentView.rescore')}
            </button>
            {isDemoAccount && summary.total_signals === 0 && (
              <button
                onClick={seedDemo}
                disabled={seeding}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-sm disabled:opacity-40"
              >
                {seeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {t('buyingIntentView.demoData')}
              </button>
            )}
            {isDemoAccount && summary.total_signals > 0 && (
              <button
                onClick={clearData}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-zinc-600 hover:border-zinc-300 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </motion.div>

        {/* ── Hero Stats ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          {/* Buying Now — hero card */}
          <div className="col-span-1 sm:col-span-2 lg:col-span-1 rounded-2xl bg-zinc-900 dark:bg-white p-4 sm:p-5 shadow-xl shadow-zinc-900/8 dark:shadow-black/10">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{t('buyingIntentView.buyingNow')}</span>
              {summary.buying_now > 0 && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1ED4A7] opacity-40" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1ED4A7]" />
                </span>
              )}
            </div>
            <p className="text-2xl sm:text-3xl font-bold tabular-nums text-white dark:text-zinc-900 tracking-tight">
              <AnimatedNumber value={summary.buying_now} />
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {summary.total_companies > 0 ? t('buyingIntentView.ofTracked', { pct: Math.round((summary.buying_now / summary.total_companies) * 100) }) : t('buyingIntentView.noCompaniesYet')}
            </p>
          </div>

          {/* Hot */}
          <StatCard
            label={t('buyingIntentView.hot')}
            value={summary.hot}
            icon={TrendingUp}
            total={summary.total_companies}
          />

          {/* Signals This Week */}
          <StatCard
            label={t('buyingIntentView.thisWeek')}
            value={summary.signals_this_week}
            icon={Radio}
            trend={summary.trend_pct}
          />

          {/* Total Companies */}
          <StatCard
            label={t('buyingIntentView.tracked')}
            value={summary.total_companies}
            icon={Crosshair}
          />
        </motion.div>

        {/* ── Signal Distribution Mini-Bar ────────────────────────── */}
        {summary.total_signals > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="flex items-center gap-3"
          >
            <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-zinc-200/50 dark:bg-zinc-800/50">
              {(['website', 'email', 'keyword', 'activity'] as const).map((type, i) => {
                const pct = (dist[type] / totalDist) * 100;
                if (pct === 0) return null;
                const colors = ['bg-[#1ED4A7]', 'bg-zinc-700 dark:bg-zinc-300', 'bg-zinc-500 dark:bg-zinc-500', 'bg-zinc-300 dark:bg-zinc-700'];
                return (
                  <motion.div
                    key={type}
                    className={colors[i]}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, delay: 0.3 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {(['website', 'email', 'keyword', 'activity'] as const).map((type, i) => {
                const cfg = SIGNAL_TYPE_CONFIG[type];
                if (dist[type] === 0) return null;
                const dotColors = ['bg-[#1ED4A7]', 'bg-zinc-700 dark:bg-zinc-300', 'bg-zinc-500', 'bg-zinc-300 dark:bg-zinc-700'];
                return (
                  <span key={type} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                    <span className={`w-1.5 h-1.5 rounded-full ${dotColors[i]}`} />
                    <cfg.icon className="w-2.5 h-2.5" />
                    {dist[type]}
                  </span>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="relative">
          <div className="flex items-center gap-0.5 bg-zinc-100/80 dark:bg-zinc-950 rounded-xl p-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.id === 'signals' && signals.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-zinc-200/70 dark:bg-zinc-700/70 text-zinc-500 dark:text-zinc-400 tabular-nums">{signals.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab Content ─────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {activeTab === 'leaderboard' && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {/* Filters */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {['all', 'buying_now', 'hot', 'warm', 'cold'].map(f => {
                  const count = f === 'buying_now' ? summary.buying_now : f === 'hot' ? summary.hot : f === 'warm' ? summary.warm : f === 'cold' ? summary.cold : summary.total_companies;
                  return (
                    <button
                      key={f}
                      onClick={() => setStatusFilter(f)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg whitespace-nowrap transition-all ${
                        statusFilter === f
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {f === 'all' ? t('buyingIntentView.all') : f === 'buying_now' ? t('buyingIntentView.buyingNow') : f === 'hot' ? t('buyingIntentView.hot') : f === 'warm' ? t('buyingIntentView.warm') : t('buyingIntentView.cold')}
                      <span className={`tabular-nums ${statusFilter === f ? 'opacity-60' : 'opacity-40'}`}>{count}</span>
                    </button>
                  );
                })}
              </div>

              {filteredCompanies.length === 0 ? (
                <EmptyState
                  icon={Crosshair}
                  title={t('buyingIntentView.noIntentDataYet')}
                  description={t('buyingIntentView.signalsWillAppear')}
                  action={isDemoAccount && summary.total_signals === 0 ? { label: t('buyingIntentView.seedDemoData'), onClick: seedDemo, loading: seeding } : undefined}
                />
              ) : (
                <div className="space-y-2">
                  {filteredCompanies.map((company, idx) => (
                    <motion.div
                      key={company.company_id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(idx * 0.04, 0.4) }}
                    >
                      <div className={`group rounded-xl sm:rounded-2xl border transition-all duration-200
                        ${expandedCompany === company.company_id
                          ? 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 shadow-lg shadow-zinc-900/5 dark:shadow-black/10'
                          : 'bg-white dark:bg-zinc-900/70 border-zinc-200/60 dark:border-zinc-800/40 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-md hover:shadow-zinc-900/3'
                        }`}
                      >
                        <button
                          onClick={() => fetchCompanyDetail(company.company_id)}
                          className="w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 text-left"
                        >
                          {/* Rank */}
                          <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-[11px] sm:text-xs font-bold shrink-0 tabular-nums
                            ${idx < 3
                              ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                              : 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400'
                            }`}
                          >
                            {idx + 1}
                          </div>

                          {/* Company */}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                              <p className="text-[12px] sm:text-[13px] font-semibold text-zinc-900 dark:text-white truncate">{company.company_name}</p>
                              <div className="shrink-0">
                                <StatusPill status={company.status} />
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 sm:gap-2.5 mt-0.5 sm:mt-1">
                              <span className="text-[10px] sm:text-[11px] text-zinc-400 tabular-nums whitespace-nowrap">{t('buyingIntentView.nSignals', { count: company.signal_count })}</span>
                              <span className="w-0.5 h-0.5 rounded-full bg-zinc-300 dark:bg-zinc-700 shrink-0" />
                              <span className="text-[10px] sm:text-[11px] text-zinc-400 whitespace-nowrap">{timeAgo(company.last_signal_at)}</span>
                              {company.top_signals.length > 0 && (
                                <>
                                  <span className="w-0.5 h-0.5 rounded-full bg-zinc-300 dark:bg-zinc-700 hidden sm:block shrink-0" />
                                  <span className="text-[11px] text-zinc-400 truncate hidden sm:inline">
                                    {translateSignalDetail(company.top_signals[0])}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Score Gauge */}
                          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            <div className="hidden sm:block">
                              <RadialScore score={company.total_score} size={44} strokeWidth={3} />
                            </div>
                            <div className="sm:hidden text-right">
                              <p className="text-base font-bold tabular-nums text-zinc-900 dark:text-white">
                                {company.total_score}
                              </p>
                            </div>
                            <ChevronDown className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-300 dark:text-zinc-600 transition-transform duration-200 ${expandedCompany === company.company_id ? 'rotate-180' : ''}`} />
                          </div>
                        </button>

                        {/* Expanded Detail */}
                        <AnimatePresence>
                          {expandedCompany === company.company_id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                              className="overflow-hidden"
                            >
                              <div className="border-t border-zinc-100 dark:border-zinc-800/50 p-4">
                                {loadingDetail ? (
                                  <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                                  </div>
                                ) : companyDetail ? (
                                  <div className="space-y-5">
                                    {/* Score Breakdown */}
                                    <div className="grid grid-cols-4 gap-2">
                                      {[
                                        { label: t('buyingIntentView.web'), points: company.website_points, icon: Globe },
                                        { label: t('buyingIntentView.email'), points: company.email_points, icon: Mail },
                                        { label: t('buyingIntentView.keyword'), points: company.keyword_points, icon: Search },
                                        { label: t('buyingIntentView.activity'), points: company.activity_points, icon: Activity },
                                      ].map(item => (
                                        <div key={item.label} className="rounded-xl bg-zinc-50 dark:bg-zinc-800/30 p-3 text-center">
                                          <item.icon className="w-3.5 h-3.5 mx-auto mb-1.5 text-zinc-400" />
                                          <p className="text-lg font-bold tabular-nums text-zinc-900 dark:text-white">{item.points}</p>
                                          <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider mt-0.5">{item.label}</p>
                                        </div>
                                      ))}
                                    </div>

                                    {/* Recent Signals */}
                                    <div>
                                      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2.5">{t('buyingIntentView.recentSignals')}</p>
                                      <div className="space-y-1">
                                        {(companyDetail.signals || []).slice(0, 8).map((sig: IntentSignal, i: number) => {
                                          const typeCfg = SIGNAL_TYPE_CONFIG[sig.signal_type];
                                          return (
                                            <div key={sig.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                                              <typeCfg.icon className="w-3 h-3 text-zinc-400 shrink-0" />
                                              <span className="text-xs text-zinc-600 dark:text-zinc-300 flex-1 truncate">
                                                {translateSignalDetail(sig.signal_detail)}
                                              </span>
                                              <span className="text-[11px] font-semibold tabular-nums text-zinc-900 dark:text-white">+{sig.score}</span>
                                              <span className="text-[10px] text-zinc-400 tabular-nums">{timeAgo(sig.created_at)}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    {/* People */}
                                    {companyDetail.people?.length > 0 && (
                                      <div>
                                        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2.5">{t('buyingIntentView.people')}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                          {companyDetail.people.map((person: any, i: number) => (
                                            <button
                                              key={i}
                                              onClick={() => openPersonProfile(person)}
                                              disabled={lookingUpPerson === (person.email || person.name)}
                                              className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/30 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 transition-all min-h-[36px] disabled:opacity-50"
                                            >
                                              {lookingUpPerson === (person.email || person.name) ? (
                                                <Loader2 className="w-3 h-3 text-zinc-400 animate-spin shrink-0" />
                                              ) : (
                                                <User className="w-3 h-3 text-zinc-400 shrink-0" />
                                              )}
                                              {person.name || person.email || t('buyingIntentView.unknown')}
                                              <span className="text-zinc-400 text-[10px] tabular-nums">({person.signal_count})</span>
                                              <ArrowRight className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 dark:group-hover:text-zinc-400 transition-colors shrink-0" />
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'signals' && (
            <motion.div
              key="signals"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="space-y-1.5"
            >
              {signals.length === 0 ? (
                <EmptyState
                  icon={Radio}
                  title={t('buyingIntentView.noSignalsYet')}
                  description={t('buyingIntentView.signalsWillStream')}
                />
              ) : (
                <>
                  {signals.map((sig, idx) => {
                    const typeCfg = SIGNAL_TYPE_CONFIG[sig.signal_type];
                    return (
                      <motion.div
                        key={sig.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(idx * 0.03, 0.3) }}
                        className="group flex items-center gap-3 p-3 rounded-xl hover:bg-white dark:hover:bg-zinc-900/60 transition-all"
                      >
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center gap-1 shrink-0">
                          <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center group-hover:bg-zinc-200/80 dark:group-hover:bg-zinc-800 transition-colors">
                            <typeCfg.icon className="w-3.5 h-3.5 text-zinc-500" />
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-900 dark:text-white truncate">{sig.company_name || t('buyingIntentView.unknown')}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 font-medium">{t(typeCfg.labelKey)}</span>
                          </div>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                            {translateSignalDetail(sig.signal_detail)}
                          </p>
                          {sig.person_name && (
                            <button
                              onClick={() => openPersonProfile({ name: sig.person_name, email: sig.person_email, person_id: sig.person_id })}
                              disabled={lookingUpPerson === (sig.person_email || sig.person_name)}
                              className="group text-[10px] text-zinc-400 mt-0.5 flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors disabled:opacity-50"
                            >
                              {lookingUpPerson === (sig.person_email || sig.person_name) ? (
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              ) : (
                                <User className="w-2.5 h-2.5" />
                              )}
                              {sig.person_name}
                              <ArrowRight className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          )}
                        </div>

                        {/* Score & time */}
                        <div className="text-right shrink-0">
                          <span className="text-xs font-bold tabular-nums text-zinc-900 dark:text-white">+{sig.score}</span>
                          <p className="text-[10px] text-zinc-400 tabular-nums mt-0.5">{timeAgo(sig.created_at)}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'rules' && (
            <motion.div
              key="rules"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500">{t('buyingIntentView.rulesDescription')}</p>
                <button
                  onClick={() => setShowNewRule(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-sm"
                >
                  <Plus className="w-3 h-3" />
                  {t('buyingIntentView.newRule')}
                </button>
              </div>

              {showNewRule && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5 shadow-lg shadow-zinc-900/3 dark:shadow-black/10 space-y-4"
                >
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">{t('buyingIntentView.createRule')}</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <InputField label={t('buyingIntentView.ruleName')} value={newRule.name} onChange={v => setNewRule(p => ({ ...p, name: v }))} placeholder="e.g. High Intent Alert" />
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 block">{t('buyingIntentView.condition')}</label>
                      <select
                        value={newRule.condition_type}
                        onChange={e => setNewRule(p => ({ ...p, condition_type: e.target.value }))}
                        className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white"
                      >
                        <option value="score_above">{t('buyingIntentView.conditionScoreAbove')}</option>
                        <option value="status_is">{t('buyingIntentView.conditionStatusIs')}</option>
                        <option value="signal_type">{t('buyingIntentView.conditionSignalType')}</option>
                        <option value="new_signal">{t('buyingIntentView.conditionNewSignal')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 block">{t('buyingIntentView.value')}</label>
                      {newRule.condition_type === 'status_is' ? (
                        <select value={newRule.condition_value} onChange={e => setNewRule(p => ({ ...p, condition_value: e.target.value }))} className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white">
                          <option value="buying_now">{t('buyingIntentView.buyingNow')}</option>
                          <option value="hot">{t('buyingIntentView.hot')}</option>
                          <option value="warm">{t('buyingIntentView.warm')}</option>
                        </select>
                      ) : newRule.condition_type === 'signal_type' ? (
                        <select value={newRule.condition_value} onChange={e => setNewRule(p => ({ ...p, condition_value: e.target.value }))} className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white">
                          <option value="website">{t('buyingIntentView.website')}</option>
                          <option value="email">{t('buyingIntentView.email')}</option>
                          <option value="keyword">{t('buyingIntentView.keyword')}</option>
                          <option value="activity">{t('buyingIntentView.activity')}</option>
                        </select>
                      ) : (
                        <input type="number" value={newRule.condition_value} onChange={e => setNewRule(p => ({ ...p, condition_value: e.target.value }))} className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white" />
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 block">{t('buyingIntentView.action')}</label>
                      <select value={newRule.action_type} onChange={e => setNewRule(p => ({ ...p, action_type: e.target.value }))} className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white">
                        <option value="add_to_list">{t('buyingIntentView.actionAddToList')}</option>
                        <option value="assign_owner">{t('buyingIntentView.actionAssignOwner')}</option>
                        <option value="start_sequence">{t('buyingIntentView.actionStartSequence')}</option>
                        <option value="slack_alert">{t('buyingIntentView.actionSlackAlert')}</option>
                        <option value="update_status">{t('buyingIntentView.actionUpdateStatus')}</option>
                      </select>
                    </div>
                    <InputField
                      label={newRule.action_type === 'slack_alert' ? t('buyingIntentView.channelOptional') : newRule.action_type === 'add_to_list' ? t('buyingIntentView.listName') : newRule.action_type === 'assign_owner' ? t('buyingIntentView.ownerEmail') : newRule.action_type === 'start_sequence' ? t('buyingIntentView.sequenceName') : t('buyingIntentView.value')}
                      value={newRule.action_value}
                      onChange={v => setNewRule(p => ({ ...p, action_value: v }))}
                      placeholder={newRule.action_type === 'slack_alert' ? t('buyingIntentView.defaultIfEmpty') : newRule.action_type === 'add_to_list' ? t('buyingIntentView.highIntentLeads') : t('buyingIntentView.enterValue')}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={addRule} disabled={!newRule.name} className="h-8 px-4 text-[11px] font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-40 shadow-sm">
                      {t('buyingIntentView.createRule')}
                    </button>
                    <button onClick={() => setShowNewRule(false)} className="h-8 px-4 text-[11px] font-medium text-zinc-400 hover:text-zinc-600 transition-colors">
                      {t('buyingIntentView.cancel')}
                    </button>
                  </div>
                </motion.div>
              )}

              {rules.length === 0 && !showNewRule ? (
                <EmptyState icon={Zap} title={t('buyingIntentView.noRulesYet')} description={t('buyingIntentView.createRulesToAutoAct')} />
              ) : (
                <div className="space-y-2">
                  {rules.map((rule, idx) => (
                    <motion.div
                      key={rule.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="group flex items-center gap-3 p-4 bg-white dark:bg-zinc-900/70 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/40 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
                    >
                      <button
                        onClick={() => toggleRule(rule)}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                          rule.enabled
                            ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] ring-1 ring-[#1ED4A7]/20'
                            : 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400'
                        }`}
                      >
                        {rule.enabled ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-900 dark:text-white">{rule.name}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                          {t('buyingIntentView.when')} {rule.condition_type.replace(/_/g, ' ')} = <span className="font-medium text-zinc-700 dark:text-zinc-300">{rule.condition_value}</span>
                          {rule.actions?.[0] && (
                            <span className="text-zinc-400">
                              {' → '}{rule.actions[0].type.replace(/_/g, ' ')}{rule.actions[0].value ? `: ${rule.actions[0].value}` : ''}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {rule.trigger_count > 0 && (
                          <span className="text-[10px] text-zinc-400 tabular-nums">{rule.trigger_count}x</span>
                        )}
                        <button onClick={() => deleteRule(rule.id)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'config' && (
            <motion.div
              key="config"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <ConfigPanel
                config={editConfig || config}
                onConfigChange={setEditConfig}
                onSave={saveConfig}
                saving={savingConfig}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Add Signal Modal ────────────────────────────────────── */}
        <AnimatePresence>
          {showAddSignal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm"
                onClick={() => setShowAddSignal(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-6 w-full max-w-md shadow-2xl shadow-zinc-900/10 dark:shadow-black/30 space-y-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white" style={{ fontFamily: "'Red Hat Display', sans-serif" }}>{t('buyingIntentView.recordSignal')}</h3>
                  <button onClick={() => setShowAddSignal(false)} className="w-7 h-7 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-all">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-3">
                  <InputField label={t('buyingIntentView.company')} value={newSignal.company_name} onChange={v => setNewSignal(p => ({ ...p, company_name: v }))} placeholder="Acme Corp" />
                  <div>
                    <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 block">{t('buyingIntentView.signalType')}</label>
                    <select value={newSignal.signal_type} onChange={e => setNewSignal(p => ({ ...p, signal_type: e.target.value }))} className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white">
                      <option value="website">{t('buyingIntentView.website')}</option>
                      <option value="email">{t('buyingIntentView.email')}</option>
                      <option value="keyword">{t('buyingIntentView.keyword')}</option>
                      <option value="activity">{t('buyingIntentView.activity')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 block">{t('buyingIntentView.signalDetail')}</label>
                    <select
                      value={newSignal.signal_detail}
                      onChange={e => {
                        const scoreMap: Record<string, number> = {
                          page_visit_pricing: 20, page_visit_demo: 30, page_visit_contact: 25,
                          email_opened: 5, email_clicked: 15, email_replied: 40,
                          keyword_match_job_posting: 20, tech_stack_installed: 25,
                          funding_raised: 30, new_hire_vp_sales: 25, hiring_bdrs: 20,
                        };
                        setNewSignal(p => ({ ...p, signal_detail: e.target.value, score: scoreMap[e.target.value] || 10 }));
                      }}
                      className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white"
                    >
                      {SIGNAL_DETAIL_KEYS.map((key) => (
                        <option key={key} value={key}>{translateSignalDetail(key)}</option>
                      ))}
                    </select>
                  </div>
                  <InputField label={t('buyingIntentView.scorePoints')} value={String(newSignal.score)} onChange={v => setNewSignal(p => ({ ...p, score: parseInt(v) || 0 }))} type="number" />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={addSignal}
                    disabled={!newSignal.company_name}
                    className="flex-1 h-10 text-xs font-semibold rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-sm disabled:opacity-40"
                  >
                    {t('buyingIntentView.recordSignal')}
                  </button>
                  <button onClick={() => setShowAddSignal(false)} className="h-10 px-4 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors">
                    {t('buyingIntentView.cancel')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>

    {/* Lead Profile Modal */}
    {viewingLeadId && (
      <LeadDetailModal leadId={viewingLeadId} onClose={() => setViewingLeadId(null)} />
    )}
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, trend, total }: {
  label: string;
  value: number;
  icon: any;
  trend?: number;
  total?: number;
}) {
  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900/70 border border-zinc-200/60 dark:border-zinc-800/40 p-3 sm:p-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <Icon className="w-3.5 h-3.5 text-zinc-400" />
        {trend !== undefined && trend !== 0 && (
          <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${trend > 0 ? 'text-zinc-900 dark:text-white' : 'text-zinc-500'}`}>
            {trend > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white tabular-nums tracking-tight">
        <AnimatedNumber value={value} />
      </p>
      <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider mt-1">{label}</p>
      {total !== undefined && total > 0 && (
        <div className="mt-2.5 h-1 rounded-full bg-zinc-100 dark:bg-zinc-800/50 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-zinc-900 dark:bg-white"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((value / total) * 100, 100)}%` }}
            transition={{ duration: 1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, description, action }: {
  icon: any;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void; loading?: boolean };
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
      </div>
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{title}</p>
      <p className="text-xs text-zinc-400 mt-1 max-w-xs">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.loading}
          className="mt-4 text-xs font-semibold text-zinc-900 dark:text-white hover:underline disabled:opacity-40"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

function InputField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder:text-zinc-400"
      />
    </div>
  );
}

// ─── Config Panel ────────────────────────────────────────────────────

function ConfigPanel({ config, onConfigChange, onSave, saving }: {
  config: IntentConfig;
  onConfigChange: (c: IntentConfig) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [newKeyword, setNewKeyword] = useState('');
  const [newPage, setNewPage] = useState('');
  const [newTech, setNewTech] = useState('');
  const [newActivity, setNewActivity] = useState('');

  const addItem = (field: keyof IntentConfig, value: string, setter: (v: string) => void) => {
    if (!value.trim()) return;
    const updated = { ...config, [field]: [...config[field], value.trim()] };
    onConfigChange(updated);
    setter('');
  };

  const removeItem = (field: keyof IntentConfig, index: number) => {
    const updated = { ...config, [field]: config[field].filter((_, i) => i !== index) };
    onConfigChange(updated);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{t('buyingIntentView.configureDescription')}</p>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 h-8 px-4 text-[11px] font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-40 shadow-sm"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {t('buyingIntentView.save')}
        </button>
      </div>

      <ConfigSection
        title={t('buyingIntentView.icpKeywords')} description={t('buyingIntentView.icpKeywordsDesc')} icon={Tag}
        items={config.keywords} newValue={newKeyword} setNewValue={setNewKeyword}
        onAdd={() => addItem('keywords', newKeyword, setNewKeyword)} onRemove={i => removeItem('keywords', i)} placeholder="e.g. sales automation"
      />
      <ConfigSection
        title={t('buyingIntentView.highIntentPagesTitle')} description={t('buyingIntentView.highIntentPagesDesc')} icon={Globe}
        items={config.high_intent_pages} newValue={newPage} setNewValue={setNewPage}
        onAdd={() => addItem('high_intent_pages', newPage, setNewPage)} onRemove={i => removeItem('high_intent_pages', i)} placeholder="e.g. /pricing"
      />
      <ConfigSection
        title={t('buyingIntentView.trackedTechTitle')} description={t('buyingIntentView.trackedTechDesc')} icon={Zap}
        items={config.tracked_tech} newValue={newTech} setNewValue={setNewTech}
        onAdd={() => addItem('tracked_tech', newTech, setNewTech)} onRemove={i => removeItem('tracked_tech', i)} placeholder="e.g. HubSpot"
      />
      <ConfigSection
        title={t('buyingIntentView.activityKeywordsTitle')} description={t('buyingIntentView.activityKeywordsDesc')} icon={Activity}
        items={config.activity_keywords} newValue={newActivity} setNewValue={setNewActivity}
        onAdd={() => addItem('activity_keywords', newActivity, setNewActivity)} onRemove={i => removeItem('activity_keywords', i)} placeholder="e.g. VP Sales"
      />
    </div>
  );
}

function ConfigSection({ title, description, icon: Icon, items, newValue, setNewValue, onAdd, onRemove, placeholder }: {
  title: string;
  description: string;
  icon: any;
  items: string[];
  newValue: string;
  setNewValue: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  placeholder: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-white dark:bg-zinc-900/70 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/40 p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-zinc-500" />
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-900 dark:text-white">{title}</p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/40 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
            {item}
            <button onClick={() => onRemove(i)} className="text-zinc-400 hover:text-zinc-600 transition-colors ml-0.5">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        {items.length === 0 && (
          <span className="text-[11px] text-zinc-400 italic">{t('buyingIntentView.noItemsConfigured')}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()}
          placeholder={placeholder}
          className="flex-1 h-8 px-3 text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder:text-zinc-400"
        />
        <button
          onClick={onAdd}
          disabled={!newValue.trim()}
          className="h-8 w-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all disabled:opacity-40"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default BuyingIntent;
