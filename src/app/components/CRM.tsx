// Rebuild: 2026-03-03T14:00 — force recompile to clear stale module cache
/**
 * CRM Component - Lead Management
 * Updated: 2026-03-02 - Rebuild trigger: fix stale dynamic import chunk
 * Updated: 2025-02-20 - Force rebuild to fix dynamic import
 * Core dependencies for lead management, CSV import, and data cleanup
 */
import { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import { useSearchParams } from 'react-router';
import { Users, User, DollarSign, Plus, Search, Mail, Phone, Building, Calendar, TrendingUp, ExternalLink, CheckCircle, Clock, X, Download, Zap, Trash2, Filter, MapPin, Star, Folder, Eye, MousePointerClick, Edit3, StickyNote, Sparkles, RefreshCw, ShieldCheck, ChevronDown, Tag, Loader2, Globe2, Database, Send } from 'lucide-react';
import { toast } from 'sonner';
import { MobileLeadCard } from './MobileLeadCard';
import { DesktopLeadRow } from './DesktopLeadRow';
import { useRealtimeContext, useRealtimeRefresh } from './RealtimeProvider';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { GroupSelector } from './GroupSelector';
import { AddToPipelineModal } from './AddToPipelineModal';
import { exportLeads } from '../lib/csvExport';
import { LoadingSpinner } from './LoadingSpinner';
import { LeadDetailModal } from './LeadDetailModal';
import { CSVImportModal } from './leads/CSVImportModal';
import { DataCleanupUtility } from './DataCleanupUtility';
import { AddLeadModal } from './AddLeadModal';
import { useImportBroadcast } from './ImportBroadcastContext';
import { apiCache } from '../lib/api-cache';
import { EnrollInSequenceModal } from './EnrollInSequenceModal';
import { formatPhoneDisplay } from '../lib/phone-format';
import { SmartPhoneButton } from './SmartPhoneButton';
import { isCountryName } from '../utils/country-names';
import { isValidStateForCountry } from '../utils/us-states';
import { toTitleCase } from '../utils/title-case';
import { dispatchAppEvent, useAppEventRefresh } from '../lib/app-events';
import { useDemoMode, DEMO_LEADS } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { CompaniesView } from './CompaniesView';

// ── Display-level cleaner: reject LinkedIn headlines/taglines from business names ──
function cleanBizDisplay(raw: string): string {
  if (!raw) return '';
  let c = raw.trim();
  c = c.replace(/,\s+(?:My |I |We |Our |Your |A |The |An |Helping |Passionate |Dedicated |Experienced |Building |Creating |Empowering |Enabling |Transforming |Committed |Focused |Specializ|Leverag|Proven |Award|Driving |Working |Looking |Seeking |Striving |Results).*/i, '').trim();
  const HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+\s+in|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work|build|create)|we\s+(?:help|are|build|create|provide|deliver)|my\s+(?:goal|mission|passion|focus))/i;
  if (HEADLINE.test(c)) return '';
  const PURE_TITLE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|director|manager|head|lead|chief|founder|co-?founder|owner|partner|president|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelanc\w+|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|developer|designer|recruiter|marketer|sales\w*|business\s+development)(\s+(of|at|for|in|&|and|\/)\s+.*)?$/i;
  if (PURE_TITLE.test(c)) return '';
  if (/\b(helping|empowering|enabling|transforming|building|creating|delivering|providing|growing|driving|solving|improving|supporting|managing|developing|seeking|looking|striving|committed|passionate|dedicated|experienced)\b/i.test(c) && c.split(/\s+/).length > 3) return '';
  if (/\b(my goal|i help|i am|we help|we are|our mission)\b/i.test(c) && c.split(/\s+/).length > 2) return '';
  if (c.split(/\s+/).length > 7) return '';
  return c;
}

type CRMTab = 'leads' | 'clients' | 'hot-leads' | 'fast-money' | 'companies';

// Normalized schema interfaces
interface Company {
  id: string;
  name?: string;
  name_for_emails?: string;
  website?: string;
  industry?: string;
  keywords?: string;
  linkedin_url?: string;
  facebook_url?: string;
  twitter_url?: string;
  company_phone?: string;
  address_full?: string;
  city?: string;
  state?: string;
  country?: string;
  annual_revenue?: number;
  total_funding?: number;
  latest_funding?: string;
  latest_funding_amount?: number;
  last_raised_at?: string;
  subsidiary_of?: string;
  number_of_retail_locations?: number;
  employees?: string;
  technologies?: string;
  apollo_account_id?: string;
}

interface LeadEmail {
  id: string;
  lead_id: string;
  email: string;
  type: 'primary' | 'secondary' | 'tertiary' | 'other';
  status?: string;
  source?: string;
  verification_source?: string;
  confidence?: string;
  catch_all_status?: string;
  last_verified_at?: string;
}

interface LeadPhone {
  id: string;
  lead_id: string;
  phone: string;
  type: 'work_direct' | 'home' | 'mobile' | 'corporate' | 'other';
}

interface LeadCustomField {
  id: string;
  lead_id: string;
  key: string;
  value: any;
}

interface Lead {
  id: string;
  // Normalized fields
  company_id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: string;
  departments?: string[];
  stage?: string;
  lists?: string[];
  account_owner?: string;
  last_contacted?: string;
  person_linkedin_url?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  email_sent?: boolean;
  email_open?: boolean;
  email_bounced?: boolean;
  replied?: boolean;
  demoed?: boolean;
  apollo_contact_id?: string;
  raw_source?: string;
  
  // Legacy fields (backwards compatibility)
  business_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  category?: string;
  rating?: number;
  status?: string;
  brand?: string;
  campaign_id?: string;
  engagement_score?: number;
  score?: number; // AI Lead Score (0-100)
  reply_received?: boolean;
  created_at: string;
  notes?: string;
  emails_sent?: number;
  emails_opened?: number;
  emails_clicked?: number;
  last_opened_at?: string;
  last_clicked_at?: string;
  engaged_brands?: string[];
  job_title?: string;
  linkedin?: string;
  employees?: string;
  industry?: string;
  keywords?: string[];
  
  // Joined data from normalized schema
  company?: Company | null;
  emails?: LeadEmail[];
  phones?: LeadPhone[];
  custom_fields?: LeadCustomField[];
  
  // Computed fields from backend
  primary_email?: string;
  primary_email_status?: string;
  primary_email_confidence?: string;
  primary_phone?: string;
  company_name?: string;
  company_website?: string;
  
  // Shared leads fields
  is_shared?: boolean;
  is_revealed?: boolean;
  has_email?: boolean;
  has_phone?: boolean;
  avatarUrl?: string | null;
  avatar_url?: string | null;
  avatarConfidence?: number;
  avatar_confidence?: number;
}

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  brand: string;
  lifetime_value: number;
  status: 'active' | 'inactive';
  first_purchase_date?: string;
  last_contact_date?: string;
  notes?: string;
  created_at: string;
}

/**
 * Returns whether the viewport matches the Tailwind `sm` breakpoint
 * (≥640px). Used below to render EITHER the mobile card list OR the
 * desktop table — not both. Previously the page mounted both DOM
 * trees and toggled visibility via `block sm:hidden` / `hidden sm:block`
 * so React was committing ~200 components per render (100 leads × 2
 * variants × LeadAvatar inside each row). Conditional render via this
 * hook drops it to ~100 — perf audit estimated -300–500ms TTI on the
 * leads tab.
 *
 * SSR-safe default: assume desktop on first render so SSR markup
 * matches what desktop users see; the effect re-evaluates immediately
 * on hydration for actual mobile sizes (one-frame FOUC, acceptable).
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 640px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    // Sync once on mount in case SSR default was wrong
    setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

export function CRM({ onStartFollowUp, onUpgrade }: { onStartFollowUp?: (leadIds: string[]) => void; onUpgrade?: () => void }) {
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const { emit: emitRealtime } = useRealtimeContext();
  const realtimeRefreshKey = useRealtimeRefresh(['lead:created', 'lead:updated', 'lead:deleted', 'lead:bulk_action', 'import:completed', 'group:updated']);
  const importBroadcast = useImportBroadcast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<CRMTab>('leads');
  const [leads, setLeads] = useState<Lead[]>(isDemoMode ? DEMO_LEADS : []);
  const [clients, setClients] = useState<Client[]>([]);
  const [hotLeads, setHotLeads] = useState<Lead[]>([]);
  const [fastMoneyLeads, setFastMoneyLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(isDemoMode ? false : true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);
  const [showImportLeads, setShowImportLeads] = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [showEnrollSequenceModal, setShowEnrollSequenceModal] = useState(false);
  const [pipelineLeadIds, setPipelineLeadIds] = useState<Record<string, string>>({});
  const [highIntentLeadIds, setHighIntentLeadIds] = useState<Set<string>>(new Set());
  const [mediumIntentLeadIds, setMediumIntentLeadIds] = useState<Set<string>>(new Set());
  const [contactedFilter, setContactedFilter] = useState<'all' | 'contacted' | 'not-contacted' | 'opened' | 'engaged'>('all');
  const [emailFilter, setEmailFilter] = useState<'all' | 'with_email'>('all');
  const [phoneFilter, setPhoneFilter] = useState<'all' | 'has_phone'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('United States');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [deleting, setDeleting] = useState(false);
  const [fixingLocations, setFixingLocations] = useState(false);
  const [showBulkSelect, setShowBulkSelect] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState<string | null>(null);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [showBulkStatusMenu, setShowBulkStatusMenu] = useState(false);
  const [bouncedCount, setBouncedCount] = useState(0);
  const [showDataCleanup, setShowDataCleanup] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [fixingGeneric, setFixingGeneric] = useState(false);
  const [purging, setPurging] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showVerifyMenu, setShowVerifyMenu] = useState(false);


  // ── Shared leads state (merged into unified view) ──
  const [sharedLeads, setSharedLeads] = useState<Lead[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);
  // ── Team leads state (from team members, merged into All Leads) ──
  const [teamLeads, setTeamLeads] = useState<Lead[]>([]);
  const [teamLeadsLoaded, setTeamLeadsLoaded] = useState(false);
  const [revealingLeadId, setRevealingLeadId] = useState<string | null>(null);
  const [revealEntitlements, setRevealEntitlements] = useState<{
    plan_tier: string;
    monthly_reveal_limit: number | null;
    monthly_reveals_used: number;
    can_export: boolean;
    can_view_phone: boolean;
    can_view_email: boolean;
  } | null>(null);

  const [importProgress, setImportProgress] = useState<{
    discovered: number;
    imported: number;
    duplicates: number;
    message?: string;
  } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalLeads, setTotalLeads] = useState(0);
  const leadsPerPage = 100;
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Server-fetched filter options (lightweight, not all leads)
  const [serverFilterOptions, setServerFilterOptions] = useState<{
    categories: string[];
    countries: string[];
    statesByCountry: Record<string, string[]>;
    citiesByLocation: Record<string, string[]>;
  }>({ categories: [], countries: [], statesByCountry: {}, citiesByLocation: {} });

  // Demo account auto-seed: track if we've already attempted
  const demoSeedAttemptedRef = useRef(false);
  const [isDemoSeeding, setIsDemoSeeding] = useState(false);

  // Ref for scrolling desktop table to top on page change
  const desktopTableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setIsAuthReady(true);
      }
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setIsAuthReady(true);
      } else {
        setIsAuthReady(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // ── Deep-link: open lead detail modal from ?lead=<id> query param (e.g. from Inbox) ──
  useEffect(() => {
    const leadParam = searchParams.get('lead');
    if (leadParam) {
      // Clear the query param first to prevent re-triggering
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('lead');
        return next;
      }, { replace: true });
      
      // Validate UUID format before setting selectedLeadId
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(leadParam)) {
        setSelectedLeadId(leadParam);
      } else {
        // Silently ignore invalid lead IDs (don't show error toast - these are usually from stale/invalid links)
        console.warn('[CRM] Invalid lead ID format from URL parameter (ignored):', leadParam);
      }
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    // Reset filters when changing tabs to prevent hiding leads unintentionally
    setContactedFilter('all');
    setEmailFilter('all');
    setPhoneFilter('all');
    setCategoryFilter('all');
    setStateFilter('all');
    setCountryFilter('all');
    setCityFilter('all');
    setBrandFilter('all');
    setSearchTerm('');
    
    if (isDemoMode) return; // Skip loading in demo mode
    if (isAuthReady) {
      loadData();
      const interval = setInterval(loadData, 2 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [activeTab, isAuthReady, isDemoMode]);

  // Reload leads when filters change (debounced to avoid excessive requests)
  // Reset to page 1 and fetch with new server-side filters
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    if (!isAuthReady || activeTab !== 'leads') return;
    
    const timeoutId = setTimeout(() => {
      console.log('[CRM] Filters changed, reloading page 1...');
      setCurrentPage(1);
      loadLeads(false, 1);
    }, 300); // 300ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [searchTerm, categoryFilter, stateFilter, countryFilter, cityFilter, brandFilter, contactedFilter, emailFilter, phoneFilter]);
  
  // Reload hot leads when brand filter changes
  useEffect(() => {
    if (activeTab === 'hot-leads') {
      loadHotLeads();
    }
  }, [brandFilter]);

  // ── Real-time sync: reload when another tab/user makes changes ──
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    if (realtimeRefreshKey > 0) {
      console.log('[CRM] Real-time refresh triggered, reloading...');
      loadLeads();
    }
  }, [realtimeRefreshKey, isDemoMode]);

  // ── App-event sync: reload CRM instantly on in-tab mutations ──
  const crmAppEventKey = useAppEventRefresh(['leads:changed', 'leads:created', 'leads:deleted', 'leads:updated']);
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    if (crmAppEventKey > 0) {
      console.log('[CRM] App-event refresh triggered');
      loadLeads();
    }
  }, [crmAppEventKey, isDemoMode]);

  // ── Fetch pipeline lead IDs for visual indicator badges ──
  const loadPipelineLeadIds = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;
      const data = await apiCache.fetch<{ lead_ids: { lead_id: string; stage: string }[] }>(
        'crm:pipeline-lead-ids',
        async () => {
          const res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/pipeline/lead-ids`,
            { headers, signal: AbortSignal.timeout(15000) }
          );
          if (!res.ok) throw new Error('Pipeline lead IDs fetch failed');
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      const map: Record<string, string> = {};
      for (const item of (data.lead_ids || [])) {
        map[item.lead_id] = item.stage;
      }
      setPipelineLeadIds(map);
    } catch (err) {
      console.error('[CRM] Failed to load pipeline lead IDs:', err);
    }
  }, []);

  // Pipeline lead IDs are now loaded in the parallel loadData() batch

  // ── Fetch high-intent lead IDs for "High Intent" badge on DesktopLeadRow ──
  const loadHighIntentLeadIds = useCallback(async () => {
    try {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/high-intent`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && Array.isArray(json.leadIds)) {
        setHighIntentLeadIds(new Set(json.leadIds));
        if (Array.isArray(json.mediumIntentLeadIds)) {
          setMediumIntentLeadIds(new Set(json.mediumIntentLeadIds));
        }
      }
    } catch (err) {
      console.error('[CRM] Failed to load high-intent lead IDs:', err);
    }
  }, []);

  // Auto-seed demo data when demo@contndr.com has no leads
  useEffect(() => {
    if (demoSeedAttemptedRef.current || isDemoSeeding || loading) return;
    if (leads.length > 0) return; // Already has data

    const autoSeedDemo = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email !== 'demo@contndr.com') return;

        console.log('[DEMO] Demo account detected with 0 leads — auto-seeding demo data...');
        demoSeedAttemptedRef.current = true;
        setIsDemoSeeding(true);

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
          toast.success(t('crm.toastDemoDataLoaded', {
            leads: data.stats?.leads || 0,
            campaigns: data.stats?.campaigns || 0
          }));
          // Reload leads
          await loadLeads();
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
  }, [leads.length, loading]);

  async function loadData() {
    // Only show spinner on cold load (no cached data) — stale-while-revalidate keeps UI populated
    const hasCachedLeads = !!apiCache.get('crm:leads:v2:p1');
    if (!hasCachedLeads) setLoading(true);
    try {
      if (activeTab === 'leads') {
        // Load critical data first (leads + counts + team leads)
        // Staggering prevents all 8 queries from hammering the DB pool at once
        await Promise.all([loadLeads(true), loadBouncedCount(), loadTeamLeads()]);
        // Secondary data loads non-blocking — don't await; let UI render while these fill in
        Promise.all([loadFilterOptions(), loadPipelineLeadIds(), loadHighIntentLeadIds(), loadRevealEntitlements(true), loadSharedLeads(true)])
          .catch(err => console.warn('[CRM] Secondary data load error (non-fatal):', err));
      } else if (activeTab === 'clients') {
        await loadClients();
      } else if (activeTab === 'hot-leads') {
        await loadHotLeads();
      } else if (activeTab === 'fast-money') {
        await loadFastMoneyLeads();
      }
      setLastRefreshTime(new Date());
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  /** Invalidate CRM caches and reload leads — use after mutations.
   *  Covers: crm:leads, crm:clients, crm:bounced-count, crm:hot-leads:*, crm:fast-money,
   *  crm:shared-leads, crm:reveal-entitlements */
  function invalidateCRMCache(eventType?: 'lead:created' | 'lead:updated' | 'lead:deleted' | 'lead:bulk_action' | 'import:completed', payload?: Record<string, any>) {
    apiCache.invalidate('crm:*');
    apiCache.invalidate('campaign-builder:*');
    if (eventType) emitRealtime(eventType, payload);
    // Dispatch app-wide event for instant cross-component UI refresh
    const typeMap: Record<string, any> = {
      'lead:created': 'leads:created',
      'lead:updated': 'leads:updated',
      'lead:deleted': 'leads:deleted',
      'lead:bulk_action': 'leads:changed',
      'import:completed': 'leads:changed',
    };
    dispatchAppEvent({ type: typeMap[eventType || ''] || 'leads:changed', meta: payload });
  }

  async function loadLeads(useCache = false, page?: number) {
    if (!useCache) {
      apiCache.invalidate('crm:leads*');
      apiCache.invalidate('campaign-builder:leads*');
    }
    // Don't flash spinner when cache will serve data instantly
    if (!useCache) setLoading(true);
    try {
      // Pre-check auth — bail out early if not signed in
      const preCheck = await getAuthHeaders();
      if (!preCheck.Authorization) {
        console.warn('loadLeads: Not authenticated - waiting for session');
        return;
      }

      // Build filter query string from current filters
      const filterParams = new URLSearchParams();
      if (searchTerm) filterParams.set('search', searchTerm);
      if (categoryFilter !== 'all') filterParams.set('category', categoryFilter);
      if (stateFilter !== 'all') filterParams.set('state', stateFilter);
      if (countryFilter !== 'all') filterParams.set('country', countryFilter);
      if (cityFilter !== 'all') filterParams.set('city', cityFilter);
      if (brandFilter !== 'all') filterParams.set('brand', brandFilter);
      if (contactedFilter !== 'all') filterParams.set('contacted', contactedFilter);
      if (emailFilter === 'with_email') filterParams.set('has_email', 'true');
      if (phoneFilter === 'has_phone') filterParams.set('has_phone', 'true');

      const filterQuery = filterParams.toString();
      const targetPage = page || currentPage;
      const cacheKey = `crm:leads:v2:p${targetPage}${filterQuery ? ':' + filterQuery : ''}`;

      // Fetch ONE page of leads with server-side filters (100 per page)
      // Includes one automatic retry on timeout (57014) since parallel query execution
      // should resolve it on the second attempt.
      const fetchOnePage = async () => {
        const url = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads?page=${targetPage}&per_page=${leadsPerPage}${filterQuery ? '&' + filterQuery : ''}`;
        const response = await authenticatedFetch(url, { signal: AbortSignal.timeout(30000) });
        
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.error || '';
          // Auto-retry once on DB statement timeout (57014)
          if (errMsg.includes('statement timeout') || errMsg.includes('57014')) {
            console.warn('[CRM] DB timeout on first attempt, retrying...');
            const retry = await authenticatedFetch(url, { signal: AbortSignal.timeout(30000) });
            if (!retry.ok) {
              const retryErr = await retry.json().catch(() => ({}));
              throw new Error(retryErr.error || `Failed to load leads after retry (page ${targetPage})`);
            }
            return retry.json();
          }
          throw new Error(errMsg || `Failed to load leads (page ${targetPage})`);
        }
        
        return response.json();
      };

      const data = await apiCache.fetch<{ leads: Lead[]; total: number }>(
        cacheKey,
        async () => {
          const result = await fetchOnePage();
          return { leads: result?.leads || [], total: result?.total || 0 };
        },
        { staleTime: 15_000, cacheTime: 60_000 }
      );

      const safeData = data || { leads: [], total: 0 };
      setLeads(safeData.leads);
      setTotalLeads(safeData.total);
      if (page) setCurrentPage(page);

      console.log(`[CRM] Loaded page ${targetPage}: ${safeData.leads.length} leads, ${safeData.total} total`);
    } catch (error: any) {
      // Suppress auth errors (authenticatedFetch already retried once)
      const msg = (error?.message || '').toLowerCase();
      const isAuthError = msg.includes('not authenticated') || msg.includes('session expired');
      if (!isAuthError) {
        console.error('Error loading leads:', error);
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          toast.error(t('crm.toastLoadingTimedOut'));
        } else {
          toast.error(t('crm.toastErrorLoadingLeads'));
        }
      }
    } finally {
      setLoading(false);
    }
  }



  async function loadFilterOptions() {
    try {
      const preCheck = await getAuthHeaders();
      if (!preCheck.Authorization) return;

      const data = await apiCache.fetch<{
        categories: string[];
        countries: string[];
        statesByCountry: Record<string, string[]>;
        citiesByLocation: Record<string, string[]>;
      }>(
        'crm:filter-options',
        async () => {
          const url = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/filter-options`;
          const response = await authenticatedFetch(url, { signal: AbortSignal.timeout(30000) });
          if (!response.ok) {
            console.error('[CRM] Failed to load filter options');
            return { categories: [], countries: [], statesByCountry: {}, citiesByLocation: {} };
          }
          return await response.json();
        },
        { staleTime: 120_000, cacheTime: 300_000 } // Cache for 2-5 min since filter options change rarely
      );
      setServerFilterOptions(data);
    } catch (error) {
      console.error('[CRM] Error loading filter options:', error);
    }
  }

  async function loadTeamLeads() {
    try {
      // 200 is plenty for the merged-team-view above; the previous 2000
      // was building 2k+2k Maps on every render and the user almost
      // never paged past 200 anyway.
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-engine/team-leads?per_page=200`,
        { signal: AbortSignal.timeout(30000) }
      );
      if (response.ok) {
        const data = await response.json();
        // Mark each as team lead and map to Lead shape
        const mapped: Lead[] = (data.leads || []).map((l: any) => ({
          ...l,
          is_team_lead: true,
        }));
        setTeamLeads(mapped);
        setTeamLeadsLoaded(true);
        console.log(`[CRM] Loaded ${mapped.length} team leads from ${data.team_size || 0} members`);
      } else {
        // Solo user or error — no team leads
        setTeamLeads([]);
        setTeamLeadsLoaded(true);
      }
    } catch (error: any) {
      console.error('[CRM] Team leads load error:', error);
      setTeamLeads([]);
      setTeamLeadsLoaded(true);
    }
  }

  async function loadSharedLeads(useCache = false) {
    if (!useCache) {
      apiCache.invalidate('crm:shared-leads');
    }
    setLoadingShared(true);
    try {
      let headers = await getAuthHeaders();
      if (!headers.Authorization) return;

      const data = await apiCache.fetch<Lead[]>(
        'crm:shared-leads',
        async () => {
          // Only fetch page 1 — shared leads aren't in CRM currentData.
          // Reveal flow works per-lead via /leads/shared/reveal.
          const perPage = 1000;
          const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/shared`;
          const t0 = performance.now();
          let [firstPageRes, revealsRes] = await Promise.all([
            fetch(
              `${baseUrl}?per_page=${perPage}&page=1&skip_reveals=1`,
              { headers, signal: AbortSignal.timeout(30000) }
            ),
            fetch(
              `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/shared/my-reveals`,
              { headers, signal: AbortSignal.timeout(10000) }
            ).catch(() => null), // reveals are non-critical
          ]);

          // Retry on 401 (expired token)
          if (firstPageRes.status === 401) {
            console.log('[SHARED] first page 401 - refreshing token and retrying');
            headers = await getAuthHeaders();
            if (headers.Authorization) {
              [firstPageRes, revealsRes] = await Promise.all([
                fetch(
                  `${baseUrl}?per_page=${perPage}&page=1&skip_reveals=1`,
                  { headers, signal: AbortSignal.timeout(30000) }
                ),
                fetch(
                  `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/shared/my-reveals`,
                  { headers, signal: AbortSignal.timeout(10000) }
                ).catch(() => null),
              ]);
            }
          }

          if (!firstPageRes.ok) {
            const errBody = await firstPageRes.text();
            console.error('[SHARED] first page failed', firstPageRes.status, errBody);
            throw new Error(`Shared leads fetch failed: ${firstPageRes.status}`);
          }

          const firstData = await firstPageRes.json();
          const total = firstData.total || 0;
          let allLeads: Lead[] = (firstData.leads || []) as Lead[];

          // Parse reveals
          let revealedIds = new Set<string>();
          if (revealsRes && revealsRes.ok) {
            try {
              const revealsData = await revealsRes.json();
              for (const id of (revealsData.revealed_ids || [])) revealedIds.add(id);
            } catch {}
          }

          // Apply reveals to first batch
          if (revealedIds.size > 0) {
            allLeads = allLeads.map(l => revealedIds.has(l.id) ? { ...l, is_revealed: true } : l);
          }

          // Show first page immediately (progressive update)
          setSharedLeads([...allLeads]);
          console.log(`[SHARED] Loaded page 1: ${allLeads.length}/${total} in ${Math.round(performance.now() - t0)}ms, ${revealedIds.size} reveals (remaining pages skipped)`);

          // ─�� Step 2: Fetch remaining pages in parallel (3 concurrent) ──
          return allLeads;
        },
        { staleTime: 60_000, cacheTime: 300_000 } // 1min stale, 5min cache (shared leads change infrequently)
      );

      setSharedLeads(data);
    } catch (err) {
      console.error('[SHARED] error loading shared leads:', err);
    } finally {
      setLoadingShared(false);
    }
  }

  async function loadRevealEntitlements(useCache = false) {
    if (!useCache) {
      apiCache.invalidate('crm:reveal-entitlements');
    }
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;

      const data = await apiCache.fetch<{
        plan_tier: string;
        monthly_reveal_limit: number | null;
        monthly_reveals_used: number;
        can_export: boolean;
        can_view_phone: boolean;
        can_view_email: boolean;
      }>(
        'crm:reveal-entitlements',
        async () => {
          let res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/shared/entitlements`,
            { headers }
          );
          if (res.status === 401) {
            console.log('[SHARED] entitlements 401 - refreshing token');
            const h2 = await getAuthHeaders();
            if (h2.Authorization) {
              res = await fetch(
                `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/shared/entitlements`,
                { headers: h2 }
              );
            }
          }
          if (!res.ok) throw new Error(`Entitlements fetch failed: ${res.status}`);
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 } // 1min stale, 5min cache
      );

      setRevealEntitlements(data);
    } catch (err) {
      console.error('[SHARED] entitlements error:', err);
    }
  }

  // Navigate to Inbox compose flow for a specific email
  function handleComposeEmail(email: string, name: string) {
    // Navigate to inbox view
    window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'inbox' }));
    // After a short delay to let inbox mount, dispatch compose event
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('compose-email', { detail: { to: email, name } }));
    }, 300);
  }

  async function revealLead(leadId: string) {
    setRevealingLeadId(leadId);
    try {
      const headers = await getAuthHeaders();
      let res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/shared/reveal`,
        { method: 'POST', headers, body: JSON.stringify({ lead_id: leadId }) }
      );
      if (res.status === 401) { console.log('[SHARED] reveal 401 - refreshing token'); const h2 = await getAuthHeaders(); if (h2.Authorization) { res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/shared/reveal`, { method: 'POST', headers: h2, body: JSON.stringify({ lead_id: leadId }) }); } }
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          toast.error(data.error || t('crm.toastRevealLimitReached'));
        } else {
          toast.error(data.error || t('crm.toastRevealFailed'));
        }
        return;
      }
      // Update the lead in sharedLeads with revealed data
      setSharedLeads(prev => prev.map(l =>
        l.id === leadId
          ? { ...l, email: data.data?.email || l.email, phone: data.data?.phone || l.phone, is_revealed: true }
          : l
      ));
      // Update entitlements count and invalidate cache so next load gets fresh data
      if (!data.already_revealed && revealEntitlements) {
        setRevealEntitlements({ ...revealEntitlements, monthly_reveals_used: revealEntitlements.monthly_reveals_used + 1 });
        apiCache.invalidate('crm:reveal-entitlements');
        apiCache.invalidate('crm:shared-leads');
      }
      toast.success(data.already_revealed ? 'Already revealed — no credits used' : 'Contact revealed');
    } catch (err: any) {
      console.error('[SHARED] reveal error:', err);
      toast.error('Failed to reveal contact');
    } finally {
      setRevealingLeadId(null);
    }
  }

  async function loadClients() {
    try {
      const headers = await getAuthHeaders();
      
      if (!headers.Authorization) {
        console.warn('loadClients: Not authenticated - waiting for session');
        return;
      }
      
      const data = await apiCache.fetch<{ clients: Client[] }>(
        'crm:clients',
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/clients`,
            { signal: AbortSignal.timeout(30000) }
          );
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to load clients');
          }
          return response.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );

      const allClients = data.clients || [];
      
      // Deduplicate clients by ID
      const uniqueClients = Array.from(
        new Map(allClients.map((client: Client) => [client.id, client])).values()
      );
      
      setClients(uniqueClients);
    } catch (error) {
      console.error('Error loading clients:', error);
    }
  }

  async function loadBouncedCount() {
    try {
      const preCheck = await getAuthHeaders();
      if (!preCheck.Authorization) return;
      
      const data = await apiCache.fetch<{ count: number }>(
        'crm:bounced-count',
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bounced-count`
          );
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to load bounced count');
          }
          return response.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );

      setBouncedCount(data.count || 0);
    } catch (error) {
      // Silent catch — bounced count is non-critical
    }
  }

  async function loadHotLeads() {
    try {
      const preCheck = await getAuthHeaders();
      if (!preCheck.Authorization) return;
      const brandParam = brandFilter !== 'all' ? `brand=${brandFilter}` : '';
      // Cache key includes brand filter so different filters get separate cache entries
      const cacheKey = `crm:hot-leads:${brandFilter}`;

      const data = await apiCache.fetch<{ leads: Lead[] }>(
        cacheKey,
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/hot-leads?${brandParam}`,
            { signal: AbortSignal.timeout(30000) }
          );
          if (!response.ok) throw new Error('Failed to load hot leads');
          return response.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );

      const allLeads = data?.leads || [];
      const uniqueLeads = Array.from(
        new Map(allLeads.map((lead: Lead) => [lead.id, lead])).values()
      );
      
      console.log('[HOT LEADS] Loaded', uniqueLeads.length, 'leads with brand filter:', brandFilter);
      setHotLeads(uniqueLeads);
    } catch (error) {
      console.error('Error loading hot leads:', error);
    }
  }

  async function loadFastMoneyLeads() {
    try {
      const preCheck = await getAuthHeaders();
      if (!preCheck.Authorization) return;

      const data = await apiCache.fetch<{ leads: Lead[] }>(
        'crm:fast-money',
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/fast-money-leads`,
            { signal: AbortSignal.timeout(30000) }
          );
          if (!response.ok) throw new Error('Failed to load fast money leads');
          return response.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );

      const allLeads = data?.leads || [];
      const uniqueLeads = Array.from(
        new Map(allLeads.map((lead: Lead) => [lead.id, lead])).values()
      );
      
      setFastMoneyLeads(uniqueLeads);
    } catch (error) {
      console.error('Error loading fast money leads:', error);
    }
  }

  async function backfillCountryData() {
    const confirmed = confirm(
      `This will set the country to "United States" for all leads that don't have a country set.\n\nThis is a one-time operation to prepare your data before adding international leads.\n\nContinue?`
    );

    if (!confirmed) return;

    setFixingGeneric(true);
    try {
      const headers = await getAuthHeaders();
      
      if (!headers.Authorization) {
        toast.error('Not authenticated', { description: 'Please sign in and try again.' });
        return;
      }
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/backfill-country`,
        {
          method: 'POST',
          headers,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error backfilling country:', response.status, errorData);
        throw new Error(errorData.error || 'Failed to backfill country data');
      }

      const result = await response.json();
      
      console.log('Country Backfill Results:', result);
      
      // Reload leads
      await loadLeads();
      
      toast.success('Country data backfilled!', { 
        description: result.message 
      });
    } catch (error: any) {
      console.error('Error backfilling country:', error);
      toast.error('Failed to backfill country data', { 
        description: error.message 
      });
    } finally {
      setFixingGeneric(false);
    }
  }

  async function fixGenericEmails() {
    const leadsToFix = leads.filter(lead => {
      if (!lead.email) return false;
      const emailLower = lead.email.toLowerCase();
      const genericPatterns = [
        'info@', 'contact@', 'hello@', 'sales@', 'support@', 'admin@',
        'office@', 'inquiries@', 'careers@', 'jobs@', 'hr@', 'team@',
        'help@', 'marketing@', 'media@', 'press@', 'billing@', 'accounts@',
        'reception@', 'frontdesk@', 'mail@', 'webmaster@', 'staff@'
      ];
      return genericPatterns.some(pattern => emailLower.startsWith(pattern));
    });
    
    if (leadsToFix.length === 0) {
      alert(t('crm.alertGenericEmailsNotFound'));
      return;
    }

    const confirmed = confirm(
      `Found ${leadsToFix.length} leads with generic emails (info@, sales@, etc).\n\nAttempt to find specific decision makers for these leads?\n\nThis will use enrichment credits.`
    );

    if (!confirmed) return;

    setFixingGeneric(true);
    try {
      const headers = await getAuthHeaders();
      
      if (!headers.Authorization) {
        alert('Not authenticated. Please sign in and try again.');
        return;
      }
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/fix-generic`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ limit: 50 }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error fixing generic emails:', response.status, errorData);
        throw new Error(errorData.error || errorData.details || 'Failed to fix generic emails');
      }

      const result = await response.json();
      
      console.log('Fix Generic Results:', result);
      console.log('Fixed leads:', result.results.filter(r => r.status === 'fixed'));
      console.log('Failed leads:', result.results.filter(r => r.status === 'failed'));
      
      // Force reload leads
      console.log('Reloading leads from database...');
      await loadLeads();
      
      // Wait a moment for state to update, then log what we see
      setTimeout(() => {
        const fixedIds = result.results.filter(r => r.status === 'fixed').map(r => r.id);
        const updatedLeads = leads.filter(l => fixedIds.includes(l.id));
        console.log('Updated leads after reload:', updatedLeads);
        console.log('Contact names:', updatedLeads.map(l => ({ id: l.id, business: l.business_name, contact: l.contact_name, email: l.email })));
      }, 1000);
      
      const fixedLeads = result.results.filter(r => r.status === 'fixed');
      const failedLeads = result.results.filter(r => r.status === 'failed');
      
      alert(
        `Process complete!\n\n` +
        `✓ ${result.fixed} leads updated with decision maker info\n` +
        `✗ ${failedLeads.length} leads could not be updated\n` +
        `�� Checked ${result.results.length} leads\n\n` +
        (fixedLeads.length > 0 ? `Updated: ${fixedLeads.slice(0, 3).map(r => r.dm?.full_name || 'Unknown').join(', ')}${fixedLeads.length > 3 ? '...' : ''}\n\nRefresh the page if you don't see the names.` : '')
      );
    } catch (error) {
      console.error('Error fixing generic emails:', error);
      alert(`Failed to fix emails: ${error.message}\n\nPlease check the console for details.`);
    } finally {
      setFixingGeneric(false);
    }
  }

  async function purgeLowQualityLeads() {
    const confirmed = confirm(
      `Remove low quality leads?\n\nThis will DELETE leads that:\n• Have generic emails (info@, sales@, etc.)\n• Have missing or unknown contact names\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    setPurging(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/purge-low-quality`,
        {
          method: 'POST',
          headers,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.details || 'Failed to purge leads');
      }

      const result = await response.json();
      
      apiCache.invalidate('campaign-builder:leads');
      await loadLeads();
      
      if (result.count > 0) {
        alert(`✓ Successfully removed ${result.count} low-quality leads.`);
      } else {
        alert('No low-quality leads found to remove.');
      }
    } catch (error) {
      console.error('Error purging leads:', error);
      alert('Failed to purge leads. Please try again.');
    } finally {
      setPurging(false);
    }
  }

  async function enrichSelectedLeads() {
    if (selectedLeads.length === 0) return;
    
    setEnriching(true);
    
    // Process in batches
    try {
      const headers = await getAuthHeaders();
      
      if (!headers.Authorization) {
        toast.error('Authentication Error', { description: 'Please sign in to enrich leads.' });
        setEnriching(false);
        return;
      }
      
      let successCount = 0;
      for (const leadId of selectedLeads) {
        try {
          const response = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/enrich`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ leadId })
            }
          );
          
          if (response.ok) {
            const result = await response.json();
            if (result.success && result.decision_makers && result.decision_makers.length > 0) {
                successCount++;
            }
          }
        } catch (error) {
          console.error('Error enriching lead:', error);
        }
      }
      
      if (successCount > 0) {
        alert(`Enrichment complete! Data updated for ${successCount} leads.`);
      } else {
        alert(`Enrichment complete. No new data found for selected leads. Ensure domain/website is correct.`);
      }
      
      setSelectedLeads([]);
      loadLeads();
      
    } catch (error) {
      console.error('Error starting enrichment:', error);
      alert('Failed to start enrichment');
    } finally {
      setEnriching(false);
    }
  }

  const currentData = useMemo(() => {
    switch (activeTab) {
      case 'clients': return clients;
      case 'hot-leads': return hotLeads;
      case 'fast-money': return fastMoneyLeads;
      default: {
        // Merge personal leads + team leads, dedup by email
        if (teamLeads.length === 0) return leads;
        // Build a lookup of team_outreach data by normalized email
        const outreachByEmail = new Map<string, any[]>();
        for (const tl of teamLeads) {
          const normEmail = (tl.email || '').toLowerCase();
          if (normEmail && (tl as any).team_outreach?.length) {
            outreachByEmail.set(normEmail, (tl as any).team_outreach);
          }
        }
        const seenEmails = new Set<string>();
        const seenIds = new Set<string>();
        const merged: Lead[] = [];
        // Personal leads first (they take priority) — carry over outreach from team data
        for (const lead of leads) {
          const normEmail = (lead.email || '').toLowerCase();
          const outreach = normEmail ? outreachByEmail.get(normEmail) : undefined;
          if (outreach && !(lead as any).team_outreach?.length) {
            // Spread to avoid mutating original state object
            merged.push({ ...lead, team_outreach: outreach } as any);
          } else {
            merged.push(lead);
          }
          seenIds.add(lead.id);
          if (lead.email) seenEmails.add(normEmail);
        }
        // Then team leads (skip duplicates by email or id)
        for (const lead of teamLeads) {
          if (seenIds.has(lead.id)) continue;
          if (lead.email && seenEmails.has(lead.email.toLowerCase())) continue;
          merged.push(lead);
          seenIds.add(lead.id);
          if (lead.email) seenEmails.add(lead.email.toLowerCase());
        }
        return merged;
      }
    }
  }, [activeTab, leads, clients, hotLeads, fastMoneyLeads, teamLeads]);

  // For 'leads' tab with virtual scrolling: server-side filtering, no client-side filter needed
  // For other tabs: keep client-side filtering for backward compatibility
  const filteredLeads = useMemo(() => {
    if (activeTab === 'leads') {
      // Personal leads are already server-side filtered.
      // Team leads were fetched once at load time without any search/filter applied,
      // so we must apply client-side search to the team-lead portion to avoid
      // showing unrelated team leads when the user searches.
      if (!searchTerm.trim()) return currentData;
      const searchLower = searchTerm.toLowerCase().trim();
      return currentData.filter((lead: any) => {
        // Non-team leads are already filtered by the server — keep them as-is
        if (!lead.is_team_lead) return true;
        // Client-side filter the team-lead portion
        return (
          (lead.business_name || '').toLowerCase().includes(searchLower) ||
          (lead.contact_name || '').toLowerCase().includes(searchLower) ||
          (lead.email || '').toLowerCase().includes(searchLower) ||
          (lead.phone || '').toLowerCase().includes(searchLower) ||
          (lead.city || '').toLowerCase().includes(searchLower) ||
          (lead.state || '').toLowerCase().includes(searchLower) ||
          (lead.category || '').toLowerCase().includes(searchLower) ||
          (lead.industry || '').toLowerCase().includes(searchLower) ||
          (lead.job_title || '').toLowerCase().includes(searchLower)
        );
      });
    }

    // Client-side filtering for other tabs (clients, hot-leads, fast-money)
    return currentData.filter(lead => {
      // Cast to any to handle slightly different shapes if needed, though they largely overlap
      const item = lead as any;
      
      // Enhanced search across all important fields
      const searchLower = searchTerm.toLowerCase().trim();
      const matchesSearch = !searchTerm || 
        (item.business_name || '').toLowerCase().includes(searchLower) ||
        (item.contact_name || '').toLowerCase().includes(searchLower) ||
        (item.email || '').toLowerCase().includes(searchLower) ||
        (item.phone || '').toLowerCase().includes(searchLower) ||
        (item.city || '').toLowerCase().includes(searchLower) ||
        (item.state || '').toLowerCase().includes(searchLower) ||
        (item.country || '').toLowerCase().includes(searchLower) ||
        (item.address || '').toLowerCase().includes(searchLower) ||
        (item.industry || '').toLowerCase().includes(searchLower) ||
        (item.keywords || '').toLowerCase().includes(searchLower) ||
        (item.job_title || '').toLowerCase().includes(searchLower) ||
        (item.website || '').toLowerCase().includes(searchLower) ||
        (item.linkedin || '').toLowerCase().includes(searchLower) ||
        (item.category || '').toLowerCase().includes(searchLower) ||
        (item.brand || '').toLowerCase().includes(searchLower);
      
      // If user is actively searching, ONLY apply search filter and ignore all other filters
      // This ensures search shows ALL matching results regardless of status/category/location filters
      if (searchTerm.trim()) {
        return matchesSearch;
      }
      
      // Skip status filters for clients tab since it's already filtered by status
      if (activeTab === 'clients') return matchesSearch;

      const hasBeenContacted = 
        item.status === 'contacted' || 
        item.status === 'replied' ||
        item.status === 'customer' ||
        (item.emails_sent && item.emails_sent > 0);
      
      if (contactedFilter === 'contacted' && !hasBeenContacted) return false;
      if (contactedFilter === 'not-contacted' && hasBeenContacted) return false;
      if (contactedFilter === 'opened' && !(item.email_open || (item.emails_opened && item.emails_opened > 0))) return false;
      if (contactedFilter === 'engaged' && !(
        item.email_open || 
        (item.emails_opened && item.emails_opened > 0) || 
        (item.emails_clicked && item.emails_clicked > 0) ||
        item.replied
      )) return false;
      
      if (categoryFilter !== 'all' && toTitleCase(item.category) !== categoryFilter) return false;
      if (stateFilter !== 'all' && item.state !== stateFilter) return false;
      if (countryFilter !== 'all' && item.country !== countryFilter) return false;
      if (cityFilter !== 'all' && item.city !== cityFilter) return false;
      
      // Apply email filter only when not searching
      if (emailFilter === 'with_email' && !item.email) return false;
      
      // Apply phone filter
      if (phoneFilter === 'has_phone' && !item.phone) return false;
      
      return matchesSearch;
    });
  }, [activeTab, currentData, searchTerm, contactedFilter, categoryFilter, stateFilter, countryFilter, cityFilter, emailFilter, phoneFilter]);

  // Use server-fetched filter options (lightweight - doesn't require loading all leads)
  const uniqueCategories = useMemo(() => {
    return [...new Set(serverFilterOptions.categories.map(c => toTitleCase(c)).filter(c => c && c.trim() !== ''))];
  }, [serverFilterOptions.categories]);

  const uniqueStates = useMemo(() => {
    if (countryFilter === 'all') return [];
    const states = serverFilterOptions.statesByCountry[countryFilter] || [];
    // Filter out invalid state values
    return states.filter(s => {
      if (!s || s.trim() === '') return false;
      if (/^-?\d+\.\d+/.test(s)) return false;
      if (s.includes(',') || /^\d/.test(s)) return false;
      if (s.length > 50) return false;
      if (isCountryName(s)) return false;
      if (!isValidStateForCountry(s, countryFilter)) return false;
      return true;
    });
  }, [serverFilterOptions.statesByCountry, countryFilter]);

  const uniqueCountries = useMemo(() => {
    return serverFilterOptions.countries.filter(c => {
      if (!c || c.trim() === '') return false;
      if (/^-?\d+\.\d+/.test(c)) return false;
      if (c.includes(',')) return false;
      if (c.length > 50) return false;
      return true;
    });
  }, [serverFilterOptions.countries]);

  const uniqueCities = useMemo(() => {
    if (countryFilter === 'all') return [];
    // Look up cities by country+state or just country
    const key = stateFilter !== 'all' ? `${countryFilter}|${stateFilter}` : countryFilter;
    let cities = serverFilterOptions.citiesByLocation[key] || [];
    // If filtering by state, also include cities that only have a country key
    if (stateFilter !== 'all' && !cities.length) {
      cities = serverFilterOptions.citiesByLocation[countryFilter] || [];
    }
    return cities.filter(c => {
      if (!c || c.trim() === '') return false;
      if (/^-?\d+\.\d+/.test(c)) return false;
      if (/^\d+\s+/.test(c)) return false;
      if (c.split(',').length > 2) return false;
      if (c.length > 40) return false;
      return true;
    });
  }, [serverFilterOptions.citiesByLocation, countryFilter, stateFilter]);

  // For 'leads' tab: server-side pagination (totalLeads from server)
  // For other tabs: client-side pagination
  const totalPages = activeTab === 'leads' 
    ? Math.max(1, Math.ceil(totalLeads / leadsPerPage))
    : Math.ceil(filteredLeads.length / leadsPerPage);
  const paginatedLeads = activeTab === 'leads' 
    ? filteredLeads 
    : filteredLeads.slice(
        (currentPage - 1) * leadsPerPage,
        currentPage * leadsPerPage
      );

  // Page navigation for leads tab
  const goToPage = useCallback((page: number) => {
    if (page < 1 || page > totalPages || page === currentPage || loading) return;
    setCurrentPage(page);
    loadLeads(false, page);
    // Scroll desktop table and page to top
    desktopTableRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [totalPages, currentPage, loading]);

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeads(prev =>
      prev.includes(leadId) ? prev.filter(id => id !== leadId) : [...prev, leadId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedLeads.length === paginatedLeads.length) {
      setSelectedLeads([]);
    } else {
      const leadsToSelect = paginatedLeads.map(lead => lead.id);
      
      // Safety warning for very large selections
      if (leadsToSelect.length > 5000) {
        if (!confirm(`You are about to select ${leadsToSelect.length} leads. This may take a while to process. Continue?`)) {
          return;
        }
      }
      
      setSelectedLeads(leadsToSelect);
      
      // Show helpful toast for large selections
      if (leadsToSelect.length > 1000) {
        toast.info(`Selected ${leadsToSelect.length} leads. Bulk operations will be batched automatically.`);
      }
    }
  };

  const selectBulk = (count: number) => {
    // Select the first N leads from the filtered list
    const leadsToSelect = filteredLeads.slice(0, count).map(lead => lead.id);
    setSelectedLeads(leadsToSelect);
    toast.success(t('crm.selectedTopLeads', { count: leadsToSelect.length }));
  };

  async function updateLeadStatus(leadId: string, newStatus: string) {
    setUpdatingStatus(leadId);
    setStatusMenuOpen(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${leadId}/status`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: newStatus })
        }
      );

      if (response.ok) {
        // Find the lead object to update
        // We look in 'leads' first as it's the master list, but fallback to currentData
        const leadToUpdate = leads.find(l => l.id === leadId) || currentData.find(l => l.id === leadId);
        
        if (leadToUpdate) {
            const updatedLead = { ...leadToUpdate, stage: newStatus, status: newStatus };
            
            // 1. Update All Leads
            setLeads(prev => prev.map(l => l.id === leadId ? updatedLead : l));
            
            // 2. Handle Hot Leads
            // Hot criteria: Engagement >= 7 OR Status is Interested/Warm/Hot
            const isHot = ['Interested', 'Warm', 'Hot', 'interested', 'warm', 'hot'].includes(newStatus);
            
            setHotLeads(prev => {
                const exists = prev.some(l => l.id === leadId);
                if (exists) {
                    return prev.map(l => l.id === leadId ? updatedLead : l);
                } else if (isHot) {
                    return [updatedLead, ...prev];
                }
                return prev;
            });

            // 3. Handle Fast Money
            const isFastMoney = ['Interested', 'Warm', 'interested', 'warm'].includes(newStatus); 
            setFastMoneyLeads(prev => {
                const exists = prev.some(l => l.id === leadId);
                if (exists) {
                    return prev.map(l => l.id === leadId ? updatedLead : l);
                } else if (isFastMoney) {
                    return [updatedLead, ...prev];
                }
                return prev;
            });
        }
        
        toast.success(t('crm.statusUpdatedTo', { status: newStatus }));
        
        // Background refresh to ensure consistency
        if (['Interested', 'Warm', 'Hot', 'interested', 'warm', 'hot'].includes(newStatus)) {
             loadHotLeads();
             loadFastMoneyLeads();
        }
      } else {
        throw new Error('Failed to update status');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  }

  // Helper for deterministic avatar colors — monochrome zinc palette only
  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700',
      'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700',
      'bg-zinc-50 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-800',
      'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700',
      'bg-zinc-50 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Helper to check if a shared lead needs reveal
  const needsReveal = (lead: Lead) => lead.is_shared && !lead.is_revealed;

  // Mask email for unrevealed shared leads
  const maskEmail = (email: string) => {
    const [local, domain] = email.split('@');
    if (!domain) return '••••@••••.com';
    return `${local.slice(0, 2)}••••@${domain.slice(0, 2)}••••`;
  };

  // Mask phone for unrevealed shared leads
  const maskPhone = (phone: string) => {
    return `${phone.slice(0, 3)}•••-••••`;
  };

  const statusColors: Record<string, string> = {
    'Hot': 'bg-[#1ED4A7]/15 text-[#1ED4A7] border border-[#1ED4A7]/25',
    'hot': 'bg-[#1ED4A7]/15 text-[#1ED4A7] border border-[#1ED4A7]/25',
    'Warm': 'bg-zinc-500/10 text-zinc-300 border border-zinc-500/20',
    'warm': 'bg-zinc-500/10 text-zinc-300 border border-zinc-500/20',
    'Cold': 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
    'cold': 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
    'Interested': 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20',
    'interested': 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20',
    'Customer': 'bg-[#1ED4A7]/15 text-[#1ED4A7] border border-[#1ED4A7]/30',
    'customer': 'bg-[#1ED4A7]/15 text-[#1ED4A7] border border-[#1ED4A7]/30',
    'Churned': 'bg-zinc-800 text-zinc-500 border border-zinc-700',
    'Do Not Contact': 'bg-zinc-800 text-zinc-500 border border-zinc-700',
    'Bad Fit': 'bg-zinc-800 text-zinc-500 border border-zinc-700',
    'contacted': 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
    'replied': 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20',
    'waiting': 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
    'new': 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20',
    'New': 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20',
  };

  async function bulkChangeStatus(newStatus: string) {
    if (selectedLeads.length === 0) return;
    try {
      // Get session for user_id guard
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { console.error('Not authenticated'); return; }
      
      const { error } = await supabase
        .from('leads')
        .update({ status: newStatus })
        .in('id', selectedLeads)
        .eq('user_id', session.user.id); // Defense-in-depth: ensure user owns these leads
      if (error) throw error;
      setSelectedLeads([]);
      setShowBulkStatusMenu(false);
      loadData();
    } catch (error) {
      console.error('Error updating lead status:', error);
    }
  }

  async function saveLeadNotes(leadId: string) {
    try {
      // Get session for user_id guard
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { console.error('Not authenticated'); return; }
      
      const { error } = await supabase.from('leads').update({ notes: notesValue }).eq('id', leadId).eq('user_id', session.user.id);
      if (error) throw error;
      setEditingNotes(null);
      loadData();
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  }

  async function fixLeadLocations() {
      setFixingLocations(true);
      try {
          const headers = await getAuthHeaders();
          
          if (!headers.Authorization) {
              toast.error('Authentication Error', { description: 'Please sign in to fix locations.' });
              return;
          }

          const response = await fetch(
              `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/fix-locations`,
              {
                  method: 'POST',
                  headers,
                  signal: AbortSignal.timeout(300000)
              }
          );

          if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw new Error(error.error || 'Failed to fix locations');
          }
          
          const result = await response.json();
          
          if (result.fixed > 0) {
              toast.success(`Fixed ${result.fixed} lead locations`, {
                  description: 'Location data has been updated'
              });
              await loadLeads();
          } else {
              toast.info('No locations needed fixing', { description: 'All leads have proper location data' });
          }
      } catch (error) {
          console.error('Error fixing locations:', error);
          toast.error('Failed to fix locations');
      } finally {
          setFixingLocations(false);
      }
  }

  async function handleModalImport(leadsToImport: any[], fileName?: string) {
    if (leadsToImport.length === 0) return;

    // Close the modal immediately and kick off the background broadcast
    setShowImportLeads(false);
    setImporting(false);
    setImportProgress(null);

    importBroadcast.startImport({
      leads: leadsToImport,
      fileName: fileName || 'CSV Import',
      onComplete: () => {
        invalidateCRMCache('import:completed', { source: 'csv' });
        loadLeads();
      },
      onUpgrade,
    });
  }

  return (
    <div className="flex flex-col h-full bg-transparent overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/80 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('crm.title')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {activeTab === 'leads' ? (
                <>
                  {t('crm.totalLeadsCount', { count: totalLeads.toLocaleString() })}{teamLeads.length > 0 ? ` ${t('crm.includesTeamLeads')}` : ''}
                  {leads.length > 0 && (
                    <><span className="mx-2">•</span><span className="text-zinc-400">{t('crm.pageOf', { page: currentPage, total: totalPages.toLocaleString() })}</span></>
                  )}
                </>
              ) : t('crm.manageProspects')}
            </p>
          </div>
        
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto scrollbar-hide pb-1 -mb-1 w-full sm:w-auto">
          <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg flex-shrink-0">
            <button
              onClick={() => startTransition(() => setActiveTab('leads'))}
              className={`px-3 py-1 sm:px-4 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                activeTab === 'leads' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'
              }`}
            >
              {t('crm.allLeads')}
            </button>
            <button
              onClick={() => startTransition(() => setActiveTab('companies'))}
              className={`px-3 py-1 sm:px-4 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                activeTab === 'companies' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'
              }`}
            >
              {t('crm.companies')}
            </button>
            <button
              onClick={() => startTransition(() => setActiveTab('hot-leads'))}
              className={`px-3 py-1 sm:px-4 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                activeTab === 'hot-leads' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'
              }`}
            >
              {t('crm.hot')}
            </button>
            <button
              onClick={() => startTransition(() => setActiveTab('clients'))}
              className={`px-3 py-1 sm:px-4 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                activeTab === 'clients' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'
              }`}
            >
              {t('crm.clients', 'Clients')}
            </button>
          </div>
          
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* Debug button commented out per user request
            <button
              onClick={() => {
                // Diagnostic: Show all unique city values
                const cityCounts = new Map<string, number>();
                leads.forEach(lead => {
                  const city = (lead.city || '').trim().toLowerCase();
                  if (city) {
                    cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
                  }
                });
                
                // Find Miami variations
                const miamiVariations = Array.from(cityCounts.entries())
                  .filter(([city]) => city.includes('miami'))
                  .sort((a, b) => b[1] - a[1]);
                
                console.log('=== MIAMI CITY VARIATIONS ===');
                console.log(`Total leads: ${leads.length}`);
                console.log(`Leads with city data: ${Array.from(cityCounts.values()).reduce((a, b) => a + b, 0)}`);
                console.log(`Leads without city: ${leads.filter(l => !l.city || !l.city.trim()).length}`);
                console.log('\nMiami variations found:');
                miamiVariations.forEach(([city, count]) => {
                  console.log(`  "${city}": ${count} leads`);
                });
                console.log('\nTotal Miami leads:', miamiVariations.reduce((sum, [, count]) => sum + count, 0));
                
                toast.success(`Found ${miamiVariations.length} Miami variations. Check console (F12) for details.`);
              }}
              className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
              title="Debug city data"
            >
              <Database className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Debug Cities</span>
            </button> */}
            {activeTab !== 'companies' && (
              <button
                onClick={() => setShowAddLead(true)}
                className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-white/10 rounded-lg transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
              >
                <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>{t('crm.addLead')}</span>
              </button>
            )}
            {activeTab !== 'companies' && (
              <button
                onClick={() => setShowImportLeads(true)}
                className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm font-medium whitespace-nowrap"
              >
                <Download className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>{t('common.import')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* Companies tab content */}
      {activeTab === 'companies' && (
        <div className="px-4 sm:px-6 py-6">
          <CompaniesView onStartOutreach={onStartFollowUp} />
        </div>
      )}

      {/* Content */}
      {activeTab !== 'companies' && (
      <div className="px-4 sm:px-6 py-6">
        {/* Toolbar */}
        <div className="flex-shrink-0 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Compact Search */}
          <div className="relative w-full sm:w-44">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder={t('crm.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#1ED4A7]/50 focus:border-[#1ED4A7]"
            />
          </div>

          {activeTab === 'leads' && (
            <>
              {/* Status Pills */}
              <div className="flex items-center gap-0.5 sm:gap-1">
                {([
                  { key: 'all' as const, label: t('common.all') },
                  { key: 'opened' as const, label: t('campaigns.opened') },
                  { key: 'engaged' as const, label: t('crm.engaged', 'Engaged') },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setContactedFilter(key)}
                    className={`px-2 sm:px-2.5 py-1 text-[11px] font-medium rounded-md border transition-all ${
                      contactedFilter === key
                        ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white'
                        : 'border-transparent text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="hidden sm:block w-px h-4 bg-zinc-200 dark:bg-zinc-800" />

              {/* Email & Phone Filters */}
              <div className="flex items-center gap-0.5 sm:gap-1">
                <button
                  onClick={() => setEmailFilter(emailFilter === 'with_email' ? 'all' : 'with_email')}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-all ${
                    emailFilter === 'with_email'
                      ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/30 text-[#1ED4A7]'
                      : 'border-transparent text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <Mail className="w-3 h-3" />
                  <span className="hidden sm:inline">{t('crm.hasEmail')}</span>
                  <span className="sm:hidden">{t('common.email')}</span>
                </button>
                <button
                  onClick={() => setPhoneFilter(phoneFilter === 'has_phone' ? 'all' : 'has_phone')}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-all ${
                    phoneFilter === 'has_phone'
                      ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/30 text-[#1ED4A7]'
                      : 'border-transparent text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <Phone className="w-3 h-3" />
                  <span className="hidden sm:inline">{t('crm.hasPhone')}</span>
                  <span className="sm:hidden">{t('common.phone')}</span>
                </button>
              </div>

              <div className="hidden sm:block w-px h-4 bg-zinc-200 dark:bg-zinc-800" />

              {/* Location & Category Dropdowns */}
              <div className="flex items-center gap-1 flex-wrap">
                {uniqueCategories.length > 0 && (
                  <div className="relative">
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${
                        categoryFilter !== 'all'
                          ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                      style={{ maxWidth: '150px' }}
                      title={categoryFilter !== 'all' ? categoryFilter : t('crm.categoryLabel')}
                    >
                      <option value="all">{t('crm.categoryLabel')}</option>
                      {uniqueCategories.map(category => (
                        <option key={category} value={category as string}>{category as string}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
                  </div>
                )}

                {uniqueCountries.length > 0 && (
                  <div className="relative">
                    <select
                      value={countryFilter}
                      onChange={(e) => {
                        setCountryFilter(e.target.value);
                        setStateFilter('all');
                        setCityFilter('all');
                      }}
                      className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${
                        countryFilter !== 'all'
                          ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                      style={{ maxWidth: '130px' }}
                      title={countryFilter !== 'all' ? countryFilter : t('crm.countryLabel')}
                    >
                      <option value="all">{t('crm.countryLabel')}</option>
                      {uniqueCountries.map(country => (
                        <option key={country} value={country as string}>{country as string}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
                  </div>
                )}

                {uniqueStates.length > 0 && (
                  <div className="relative">
                    <select
                      value={stateFilter}
                      onChange={(e) => {
                        setStateFilter(e.target.value);
                        setCityFilter('all');
                      }}
                      className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${
                        stateFilter !== 'all'
                          ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                      style={{ maxWidth: '130px' }}
                      title={stateFilter !== 'all' ? stateFilter : t('crm.stateLabel')}
                    >
                      <option value="all">{t('crm.stateLabel')}</option>
                      {uniqueStates.map(state => (
                        <option key={state} value={state as string}>{state as string}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
                  </div>
                )}

                {uniqueCities.length > 0 && (
                  <div className="relative">
                    <select
                      value={cityFilter}
                      onChange={(e) => setCityFilter(e.target.value)}
                      className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${
                        cityFilter !== 'all'
                          ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                      style={{ maxWidth: '120px' }}
                    >
                      <option value="all">{t('crm.cityLabel')}</option>
                      {uniqueCities.map(city => (
                        <option key={city} value={city as string} className="truncate">{city as string}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
                  </div>
                )}
              </div>

              {/* Active filter count & clear */}
              {(() => {
                const activeFilterCount = [
                  contactedFilter !== 'all',
                  emailFilter !== 'all',
                  phoneFilter !== 'all',
                  categoryFilter !== 'all',
                  countryFilter !== 'all',
                  stateFilter !== 'all',
                  cityFilter !== 'all',
                ].filter(Boolean).length;
                return activeFilterCount > 0 ? (
                  <button
                    onClick={() => {
                      setContactedFilter('all');
                      setEmailFilter('all');
                      setPhoneFilter('all');
                      setCategoryFilter('all');
                      setCountryFilter('all');
                      setStateFilter('all');
                      setCityFilter('all');
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    {t('crm.clearCount', { count: activeFilterCount })}
                  </button>
                ) : null;
              })()}

              {/* Spacer to push verify button right */}
              <div className="flex-1 hidden sm:block" />
            </>
          )}

          {/* Loading indicator for shared leads */}
          {activeTab === 'leads' && loadingShared && (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{t('crm.loadingShared')}</span>
            </div>
          )}
          
          {activeTab === 'hot-leads' && (
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 ml-auto">
              {t('crm.hotLeadsCount', { count: hotLeads.length })}
            </div>
          )}

          {/* Verify Emails Button */}
          {activeTab === 'leads' && leads.length > 0 && (
            <div className="relative flex-shrink-0 ml-auto sm:ml-0">
              <button
                onClick={() => setShowVerifyMenu(!showVerifyMenu)}
                disabled={verifying}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50"
              >
                <ShieldCheck className="w-3 h-3 text-[#1ED4A7]" />
                {verifying ? t('crm.verifying') : t('crm.verify')}
                <ChevronDown className="w-2.5 h-2.5 text-zinc-400" />
              </button>
              
              {showVerifyMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowVerifyMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-20 py-1">
                    <button
                      onClick={async () => {
                        setShowVerifyMenu(false);
                        if (!confirm(`Verify and DELETE all invalid email addresses? This will permanently remove leads with invalid emails.`)) return;
                        setVerifying(true);
                        try {
                          const headers = await getAuthHeaders();
                          if (!headers.Authorization) { toast.error('Not authenticated.'); setVerifying(false); return; }
                          const toastId = toast.loading('Starting email verification...', { description: `Processing ${leads.length.toLocaleString()} leads.` });
                          const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/verify-emails`, { method: 'POST', headers, body: JSON.stringify({ deleteInvalid: true, skipMxCheck: true }) });
                          toast.dismiss(toastId);
                          if (!response.ok) { const errText = await response.text(); let errData; try { errData = JSON.parse(errText); } catch { errData = { error: errText }; } toast.error('Verification failed', { description: errData.error || `HTTP ${response.status}` }); setVerifying(false); return; }
                          const result = await response.json();
                          apiCache.invalidate('campaign-builder:leads');
                          if (result.stats) { const { valid, invalid, deleted, remaining } = result.stats; toast.success('Verification complete!', { description: remaining > 0 ? `✓ ${valid.toLocaleString()} valid, 🗑️ ${(deleted || invalid).toLocaleString()} deleted. ${remaining.toLocaleString()} remaining.` : `✓ ${valid.toLocaleString()} valid, 🗑️ ${(deleted || invalid).toLocaleString()} deleted`, duration: remaining > 0 ? 10000 : 5000 }); } else { toast.success(result.message, { duration: 10000 }); }
                          await loadLeads();
                        } catch (error) { toast.error('Verification failed', { description: error instanceof Error ? error.message : 'Network error' }); } finally { setVerifying(false); }
                      }}
                      className="w-full text-left px-4 py-2 text-xs text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2"
                    >
                      <Trash2 className="w-3 h-3" />
                      <div>
                        <div className="font-medium">{t('crm.verifyDeleteInvalid')}</div>
                        <div className="text-zinc-500 text-[10px]">{t('crm.syntaxCheck')}</div>
                      </div>
                    </button>
                    <button
                      onClick={async () => {
                        setShowVerifyMenu(false);
                        if (!confirm(`Verify all email addresses? This will mark ${leads.length.toLocaleString()} leads as bounced if invalid.`)) return;
                        setVerifying(true);
                        try {
                          const headers = await getAuthHeaders();
                          if (!headers.Authorization) { toast.error('Not authenticated.'); setVerifying(false); return; }
                          const toastId = toast.loading('Starting email verification...', { description: `Processing ${leads.length.toLocaleString()} leads.` });
                          const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/verify-emails`, { method: 'POST', headers, body: JSON.stringify({ deleteInvalid: false, skipMxCheck: true }) });
                          toast.dismiss(toastId);
                          if (!response.ok) { const errText = await response.text(); let errData; try { errData = JSON.parse(errText); } catch { errData = { error: errText }; } toast.error('Verification failed', { description: errData.error || `HTTP ${response.status}` }); setVerifying(false); return; }
                          const result = await response.json();
                          if (result.stats) { const { valid, invalid, remaining } = result.stats; toast.success('Verification complete!', { description: remaining > 0 ? `✓ ${valid.toLocaleString()} valid, ⚠️ ${invalid.toLocaleString()} bounced. ${remaining.toLocaleString()} remaining.` : `✓ ${valid.toLocaleString()} valid, ⚠️ ${invalid.toLocaleString()} bounced`, duration: remaining > 0 ? 10000 : 5000 }); } else { toast.success(result.message, { duration: 10000 }); }
                          await loadLeads();
                        } catch (error) { toast.error('Verification failed', { description: error instanceof Error ? error.message : 'Network error' }); } finally { setVerifying(false); }
                      }}
                      className="w-full text-left px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2"
                    >
                      <ShieldCheck className="w-3 h-3" />
                      <div>
                        <div className="font-medium">{t('crm.verifyMarkBounced')}</div>
                        <div className="text-zinc-500 text-[10px]">{t('crm.syntaxCheck')}</div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Delete bounced leads */}
          {activeTab === 'leads' && leads.filter(l => l.bounced).length > 0 && (
            <button
              onClick={async () => {
                const bouncedLeads = leads.filter(l => l.bounced);
                const count = bouncedLeads.length;
                if (!confirm(`Delete all ${count.toLocaleString()} bounced leads? This cannot be undone.`)) return;
                setDeleting(true);
                try {
                  const headers = await getAuthHeaders();
                  if (!headers.Authorization) { toast.error('Not authenticated.'); setDeleting(false); return; }
                  toast.info(`Deleting ${count.toLocaleString()} bounced leads...`);
                  const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/delete-bounced`, { method: 'POST', headers, body: JSON.stringify({ action: 'delete_bounced' }) });
                  if (!response.ok) { const errData = await response.json().catch(() => ({})); toast.error('Failed to delete bounced leads', { description: errData.error || 'Please try again' }); setDeleting(false); return; }
                  const result = await response.json();
                  if (result.results) { toast.success(`Deleted ${result.results.deleted.toLocaleString()} bounced leads`); } else { toast.success(result.message); }
                  apiCache.invalidate('campaign-builder:leads');
                  setSelectedLeads([]); await loadLeads();
                } catch (error) { toast.error('Failed to delete bounced leads'); } finally { setDeleting(false); }
              }}
              disabled={deleting}
              className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-[11px] font-medium rounded-md transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              {t('crm.bouncedCount', { count: leads.filter(l => l.bounced).length.toLocaleString() })}
            </button>
          )}

          {/* HIDDEN UTILITY BUTTONS — hidden from UI but code preserved for API access */}
          {false && activeTab === 'leads' && leads.filter(l => !l.address && !l.city).length > 0 && (
            <button
              onClick={async () => {
                const leadsWithoutLocation = leads.filter(l => !l.address && !l.city);
                const count = leadsWithoutLocation.length;
                
                if (!confirm(`Delete all ${count.toLocaleString()} leads without any location data (no address or city)? This cannot be undone.`)) return;
                
                if (!confirm(`Are you absolutely sure? This will permanently delete ${count.toLocaleString()} leads.`)) return;
                
                setDeleting(true);
                
                try {
                  const headers = await getAuthHeaders();
                  
                  if (!headers.Authorization) {
                    toast.error('Not authenticated. Please sign in and try again.');
                    setDeleting(false);
                    return;
                  }

                  const leadIdsToDelete = leadsWithoutLocation.map(l => l.id);
                  
                  // Client-side batching for large deletions
                  const CLIENT_BATCH_SIZE = 1000;
                  const batches = [];
                  for (let i = 0; i < leadIdsToDelete.length; i += CLIENT_BATCH_SIZE) {
                    batches.push(leadIdsToDelete.slice(i, i + CLIENT_BATCH_SIZE));
                  }

                  let totalDeleted = 0;
                  let totalFailed = 0;

                  if (batches.length > 1) {
                    toast.info(`Deleting ${count.toLocaleString()} leads without location in ${batches.length} batches...`);
                  }

                  for (let i = 0; i < batches.length; i++) {
                    console.log(`[DELETE NO LOCATION] Processing batch ${i + 1}/${batches.length} (${batches[i].length} leads)...`);
                    
                    const response = await fetch(
                      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                      {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ lead_ids: batches[i] })
                      }
                    );

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      console.error(`[DELETE NO LOCATION] Batch ${i + 1} failed:`, errorData);
                      totalFailed += batches[i].length;
                      continue;
                    }

                    const result = await response.json();
                    console.log(`[DELETE NO LOCATION] Batch ${i + 1} response:`, result);
                    totalDeleted += result.results.deleted;
                    totalFailed += result.results.failed;
                    
                    console.log(`[DELETE NO LOCATION] Batch ${i + 1}/${batches.length}: Deleted ${result.results.deleted} leads`);
                  }

                  if (totalDeleted > 0) {
                    toast.success(`Deleted ${totalDeleted.toLocaleString()} leads without location`, {
                      description: totalFailed > 0 ? `${totalFailed} failed to delete` : undefined
                    });
                  } else {
                    toast.error('No leads were deleted');
                  }

                  setSelectedLeads([]);
                  await loadLeads();
                } catch (error) {
                  console.error('Error deleting leads without location:', error);
                  toast.error('Failed to delete leads', { description: 'Please try again' });
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="flex-shrink-0 px-3 py-2 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 disabled:opacity-50"
            >
              <MapPin className="w-3 h-3" />
              Delete Without Location ({leads.filter(l => !l.address && !l.city).length.toLocaleString()})
            </button>
          )}

          {/* Quick action to delete leads without category - HIDDEN */}
          {false && activeTab === 'leads' && leads.filter(l => !l.category || l.category.trim() === '').length > 0 && (
            <button
              onClick={async () => {
                const leadsWithoutCategory = leads.filter(l => !l.category || l.category.trim() === '');
                const count = leadsWithoutCategory.length;
                
                if (!confirm(`Delete all ${count.toLocaleString()} leads without a category? This cannot be undone.`)) return;
                
                if (!confirm(`Are you absolutely sure? This will permanently delete ${count.toLocaleString()} leads.`)) return;
                
                setDeleting(true);
                
                try {
                  const headers = await getAuthHeaders();
                  
                  if (!headers.Authorization) {
                    toast.error('Not authenticated. Please sign in and try again.');
                    setDeleting(false);
                    return;
                  }

                  const leadIdsToDelete = leadsWithoutCategory.map(l => l.id);
                  
                  // Client-side batching for large deletions
                  const CLIENT_BATCH_SIZE = 1000;
                  const batches = [];
                  for (let i = 0; i < leadIdsToDelete.length; i += CLIENT_BATCH_SIZE) {
                    batches.push(leadIdsToDelete.slice(i, i + CLIENT_BATCH_SIZE));
                  }

                  let totalDeleted = 0;
                  let totalFailed = 0;

                  if (batches.length > 1) {
                    toast.info(`Deleting ${count.toLocaleString()} leads without category in ${batches.length} batches...`);
                  }

                  for (let i = 0; i < batches.length; i++) {
                    console.log(`[DELETE NO CATEGORY] Processing batch ${i + 1}/${batches.length} (${batches[i].length} leads)...`);
                    
                    const response = await fetch(
                      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                      {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ lead_ids: batches[i] })
                      }
                    );

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      console.error(`[DELETE NO CATEGORY] Batch ${i + 1} failed:`, errorData);
                      totalFailed += batches[i].length;
                      continue;
                    }

                    const result = await response.json();
                    console.log(`[DELETE NO CATEGORY] Batch ${i + 1} response:`, result);
                    totalDeleted += result.results.deleted;
                    totalFailed += result.results.failed;
                    
                    console.log(`[DELETE NO CATEGORY] Batch ${i + 1}/${batches.length}: Deleted ${result.results.deleted} leads`);
                  }

                  if (totalDeleted > 0) {
                    toast.success(`Deleted ${totalDeleted.toLocaleString()} leads without category`, {
                      description: totalFailed > 0 ? `${totalFailed} failed to delete` : undefined
                    });
                  } else {
                    toast.error('No leads were deleted');
                  }

                  setSelectedLeads([]);
                  await loadLeads();
                } catch (error) {
                  console.error('Error deleting leads without category:', error);
                  toast.error('Failed to delete leads', { description: 'Please try again' });
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="flex-shrink-0 px-3 py-2 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 disabled:opacity-50"
            >
              <Tag className="w-3 h-3" />
              Delete Without Category ({leads.filter(l => !l.category || l.category.trim() === '').length.toLocaleString()})
            </button>
          )}

          {/* Quick action to delete all leads without email - HIDDEN */}
          {false && activeTab === 'leads' && leads.filter(l => !l.email).length > 0 && (
            <button
              onClick={async () => {
                const leadsWithoutEmail = leads.filter(l => !l.email);
                const count = leadsWithoutEmail.length;
                
                if (!confirm(`Delete all ${count.toLocaleString()} leads without email? This cannot be undone.`)) return;
                
                if (!confirm(`Are you absolutely sure? This will permanently delete ${count.toLocaleString()} leads that have no email address.`)) return;
                
                setDeleting(true);
                
                try {
                  const headers = await getAuthHeaders();
                  
                  if (!headers.Authorization) {
                    toast.error('Not authenticated. Please sign in and try again.');
                    setDeleting(false);
                    return;
                  }

                  const leadIdsToDelete = leadsWithoutEmail.map(l => l.id);
                  
                  // Client-side batching for large deletions
                  const CLIENT_BATCH_SIZE = 1000;
                  const batches = [];
                  for (let i = 0; i < leadIdsToDelete.length; i += CLIENT_BATCH_SIZE) {
                    batches.push(leadIdsToDelete.slice(i, i + CLIENT_BATCH_SIZE));
                  }

                  let totalDeleted = 0;
                  let totalFailed = 0;

                  if (batches.length > 1) {
                    toast.info(`Deleting ${count.toLocaleString()} leads without email in ${batches.length} batches...`);
                  }

                  for (let i = 0; i < batches.length; i++) {
                    console.log(`[DELETE NO EMAIL] Processing batch ${i + 1}/${batches.length} (${batches[i].length} leads)...`);
                    
                    const response = await fetch(
                      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                      {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ lead_ids: batches[i] })
                      }
                    );

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      console.error(`[DELETE NO EMAIL] Batch ${i + 1} failed:`, errorData);
                      totalFailed += batches[i].length;
                      continue;
                    }

                    const result = await response.json();
                    totalDeleted += result.results.deleted;
                    totalFailed += result.results.failed;
                    
                    console.log(`[DELETE NO EMAIL] Batch ${i + 1}/${batches.length}: Deleted ${result.results.deleted} leads`);
                  }

                  if (totalDeleted > 0) {
                    toast.success(`Deleted ${totalDeleted.toLocaleString()} leads without email`, {
                      description: totalFailed > 0 ? `${totalFailed} failed to delete` : undefined
                    });
                  } else {
                    toast.error('No leads were deleted');
                  }

                  setSelectedLeads([]);
                  await loadLeads();
                } catch (error) {
                  console.error('Error deleting leads without email:', error);
                  toast.error('Failed to delete leads', { description: 'Please try again' });
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="flex-shrink-0 px-3 py-2 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              Delete All Without Email ({leads.filter(l => !l.email).length.toLocaleString()})
            </button>
          )}

          {/* Quick action to delete all leads without phone - HIDDEN */}
          {false && activeTab === 'leads' && leads.filter(l => !l.phone).length > 0 && (
            <button
              onClick={async () => {
                const leadsWithoutPhone = leads.filter(l => !l.phone);
                const count = leadsWithoutPhone.length;
                
                if (!confirm(`Delete all ${count.toLocaleString()} leads without phone numbers? This cannot be undone.`)) return;
                
                if (!confirm(`Are you absolutely sure? This will permanently delete ${count.toLocaleString()} leads that have no phone number.`)) return;
                
                setDeleting(true);
                
                try {
                  const headers = await getAuthHeaders();
                  
                  if (!headers.Authorization) {
                    toast.error('Not authenticated. Please sign in and try again.');
                    setDeleting(false);
                    return;
                  }

                  const leadIdsToDelete = leadsWithoutPhone.map(l => l.id);
                  
                  // Client-side batching for large deletions
                  const CLIENT_BATCH_SIZE = 1000;
                  const batches = [];
                  for (let i = 0; i < leadIdsToDelete.length; i += CLIENT_BATCH_SIZE) {
                    batches.push(leadIdsToDelete.slice(i, i + CLIENT_BATCH_SIZE));
                  }

                  let totalDeleted = 0;
                  let totalFailed = 0;

                  if (batches.length > 1) {
                    toast.info(`Deleting ${count.toLocaleString()} leads without phone in ${batches.length} batches...`);
                  }

                  for (let i = 0; i < batches.length; i++) {
                    console.log(`[DELETE NO PHONE] Processing batch ${i + 1}/${batches.length} (${batches[i].length} leads)...`);
                    
                    const response = await fetch(
                      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                      {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ lead_ids: batches[i] })
                      }
                    );

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      console.error(`[DELETE NO PHONE] Batch ${i + 1} failed:`, errorData);
                      totalFailed += batches[i].length;
                      continue;
                    }

                    const result = await response.json();
                    totalDeleted += result.results.deleted;
                    totalFailed += result.results.failed;
                    
                    console.log(`[DELETE NO PHONE] Batch ${i + 1}/${batches.length}: Deleted ${result.results.deleted} leads`);
                  }

                  if (totalDeleted > 0) {
                    toast.success(`Deleted ${totalDeleted.toLocaleString()} leads without phone`, {
                      description: totalFailed > 0 ? `${totalFailed} failed to delete` : undefined
                    });
                  } else {
                    toast.error('No leads were deleted');
                  }

                  setSelectedLeads([]);
                  await loadLeads();
                } catch (error) {
                  console.error('Error deleting leads without phone:', error);
                  toast.error('Failed to delete leads', { description: 'Please try again' });
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="flex-shrink-0 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 disabled:opacity-50"
            >
              <Phone className="w-3 h-3" />
              Delete Without Phone ({leads.filter(l => !l.phone).length.toLocaleString()})

            </button>
          )}

          {/* Quick action to delete leads of a specific category without phone - HIDDEN */}
          {false && activeTab === 'leads' && categoryFilter !== 'all' && leads.filter(l => l.category === categoryFilter && !l.phone).length > 0 && (
            <button
              onClick={async () => {
                const leadsToDelete = leads.filter(l => l.category === categoryFilter && !l.phone);
                const count = leadsToDelete.length;
                
                if (!confirm(`Delete all ${count.toLocaleString()} "${categoryFilter}" leads without phone numbers? This cannot be undone.`)) return;
                
                if (!confirm(`Are you absolutely sure? This will permanently delete ${count.toLocaleString()} leads from the "${categoryFilter}" category that have no phone number.`)) return;
                
                setDeleting(true);
                
                try {
                  const headers = await getAuthHeaders();
                  
                  if (!headers.Authorization) {
                    toast.error('Not authenticated. Please sign in and try again.');
                    setDeleting(false);
                    return;
                  }

                  const leadIdsToDelete = leadsToDelete.map(l => l.id);
                  
                  // Client-side batching for large deletions
                  const CLIENT_BATCH_SIZE = 1000;
                  const batches = [];
                  for (let i = 0; i < leadIdsToDelete.length; i += CLIENT_BATCH_SIZE) {
                    batches.push(leadIdsToDelete.slice(i, i + CLIENT_BATCH_SIZE));
                  }

                  let totalDeleted = 0;
                  let totalFailed = 0;

                  if (batches.length > 1) {
                    toast.info(`Deleting ${count.toLocaleString()} "${categoryFilter}" leads without phone in ${batches.length} batches...`);
                  }

                  for (let i = 0; i < batches.length; i++) {
                    console.log(`[DELETE CATEGORY NO PHONE] Processing batch ${i + 1}/${batches.length} (${batches[i].length} leads)...`);
                    
                    const response = await fetch(
                      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                      {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ lead_ids: batches[i] })
                      }
                    );

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      console.error(`[DELETE CATEGORY NO PHONE] Batch ${i + 1} failed:`, errorData);
                      totalFailed += batches[i].length;
                      continue;
                    }

                    const result = await response.json();
                    totalDeleted += result.results.deleted;
                    totalFailed += result.results.failed;
                    
                    console.log(`[DELETE CATEGORY NO PHONE] Batch ${i + 1}/${batches.length}: Deleted ${result.results.deleted} leads`);
                  }

                  if (totalDeleted > 0) {
                    toast.success(`Deleted ${totalDeleted.toLocaleString()} leads`, {
                      description: totalFailed > 0 ? `${totalFailed} failed to delete` : `Removed all "${categoryFilter}" leads without phone numbers`
                    });
                  } else {
                    toast.error('No leads were deleted');
                  }

                  setSelectedLeads([]);
                  await loadLeads();
                } catch (error) {
                  console.error('Error deleting category leads without phone:', error);
                  toast.error('Failed to delete leads', { description: 'Please try again' });
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="flex-shrink-0 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 disabled:opacity-50"
            >
              <Phone className="w-3 h-3 text-zinc-500" />
              Delete {categoryFilter} (No Phone) ({leads.filter(l => l.category === categoryFilter && !l.phone).length.toLocaleString()})
            </button>
          )}

          {/* Quick action to delete leads without owner/contact name - HIDDEN */}
          {false && activeTab === 'leads' && leads.filter(l => !l.contact_name).length > 0 && (
            <button
              onClick={async () => {
                const leadsWithoutName = leads.filter(l => !l.contact_name);
                const count = leadsWithoutName.length;
                
                if (!confirm(`Delete all ${count.toLocaleString()} leads without an owner name? This cannot be undone.`)) return;
                
                if (!confirm(`Are you absolutely sure? This will permanently delete ${count.toLocaleString()} leads that have no contact/owner name.`)) return;
                
                setDeleting(true);
                
                try {
                  const headers = await getAuthHeaders();
                  
                  if (!headers.Authorization) {
                    toast.error('Not authenticated. Please sign in and try again.');
                    setDeleting(false);
                    return;
                  }

                  const leadIdsToDelete = leadsWithoutName.map(l => l.id);
                  
                  // Client-side batching for large deletions
                  const CLIENT_BATCH_SIZE = 1000;
                  const batches = [];
                  for (let i = 0; i < leadIdsToDelete.length; i += CLIENT_BATCH_SIZE) {
                    batches.push(leadIdsToDelete.slice(i, i + CLIENT_BATCH_SIZE));
                  }

                  let totalDeleted = 0;
                  let totalFailed = 0;

                  if (batches.length > 1) {
                    toast.info(`Deleting ${count.toLocaleString()} leads without name in ${batches.length} batches...`);
                  }

                  for (let i = 0; i < batches.length; i++) {
                    console.log(`[DELETE NO NAME] Processing batch ${i + 1}/${batches.length} (${batches[i].length} leads)...`);
                    
                    const response = await fetch(
                      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                      {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ lead_ids: batches[i] })
                      }
                    );

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      console.error(`[DELETE NO NAME] Batch ${i + 1} failed:`, errorData);
                      totalFailed += batches[i].length;
                      continue;
                    }

                    const result = await response.json();
                    totalDeleted += result.results.deleted;
                    totalFailed += result.results.failed;
                    
                    console.log(`[DELETE NO NAME] Batch ${i + 1}/${batches.length}: Deleted ${result.results.deleted} leads`);
                  }

                  if (totalDeleted > 0) {
                    toast.success(`Deleted ${totalDeleted.toLocaleString()} leads without owner name`, {
                      description: totalFailed > 0 ? `${totalFailed} failed to delete` : undefined
                    });
                  } else {
                    toast.error('No leads were deleted');
                  }

                  setSelectedLeads([]);
                  await loadLeads();
                } catch (error) {
                  console.error('Error deleting leads without name:', error);
                  toast.error('Failed to delete leads', { description: 'Please try again' });
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="flex-shrink-0 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 disabled:opacity-50"
            >
              <User className="w-3 h-3" />
              Delete Without Owner Name ({leads.filter(l => !l.contact_name).length.toLocaleString()})
            </button>
          )}

          {/* Quick action to delete leads added today - HIDDEN (no longer needed) */}
          {false && activeTab === 'leads' && (() => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const leadsAddedToday = leads.filter(l => {
              if (!l.created_at) return false;
              const createdDate = new Date(l.created_at);
              createdDate.setHours(0, 0, 0, 0);
              return createdDate.getTime() === today.getTime();
            });
            return leadsAddedToday.length > 0 ? (
              <button
                onClick={async () => {
                  const count = leadsAddedToday.length;
                  
                  if (!confirm(`Delete all ${count.toLocaleString()} leads added today? This cannot be undone.`)) return;
                  
                  if (!confirm(`Are you absolutely sure? This will permanently delete ${count.toLocaleString()} leads that were created today (${today.toLocaleDateString()}).`)) return;
                  
                  setDeleting(true);
                  
                  try {
                    const headers = await getAuthHeaders();
                    
                    if (!headers.Authorization) {
                      toast.error('Not authenticated. Please sign in and try again.');
                      setDeleting(false);
                      return;
                    }

                    const leadIdsToDelete = leadsAddedToday.map(l => l.id);
                    
                    // Client-side batching for large deletions
                    const CLIENT_BATCH_SIZE = 1000;
                    const batches = [];
                    for (let i = 0; i < leadIdsToDelete.length; i += CLIENT_BATCH_SIZE) {
                      batches.push(leadIdsToDelete.slice(i, i + CLIENT_BATCH_SIZE));
                    }

                    let totalDeleted = 0;
                    let totalFailed = 0;

                    if (batches.length > 1) {
                      toast.info(`Deleting ${count.toLocaleString()} leads added today in ${batches.length} batches...`);
                    }

                    for (let i = 0; i < batches.length; i++) {
                      const response = await fetch(
                        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                        {
                          method: 'POST',
                          headers,
                          body: JSON.stringify({ lead_ids: batches[i] })
                        }
                      );

                      const result = await response.json();
                      totalDeleted += result.results.deleted;
                      totalFailed += result.results.failed;
                      
                      console.log(`[DELETE TODAY] Batch ${i + 1}/${batches.length}: Deleted ${result.results.deleted} leads`);
                    }

                    if (totalDeleted > 0) {
                      toast.success(`Deleted ${totalDeleted.toLocaleString()} leads added today`, {
                        description: totalFailed > 0 ? `${totalFailed} failed to delete` : undefined
                      });
                    } else {
                      toast.error('No leads were deleted');
                    }

                    setSelectedLeads([]);
                    await loadLeads();
                  } catch (error) {
                    console.error('Error deleting leads added today:', error);
                    toast.error('Failed to delete leads', { description: 'Please try again' });
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                className="flex-shrink-0 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                Delete Leads Added Today ({leadsAddedToday.length.toLocaleString()})
              </button>
            ) : null;
          })()}
        </div>

        {selectedLeads.length > 0 && (
          <div className="flex items-center gap-2 animate-fade-in w-full lg:w-auto justify-start lg:justify-end ml-auto">
             <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{t('crm.selectedCount', { count: selectedLeads.length })}</span>
             {onStartFollowUp && (
               <button
                 onClick={() => {
                   // Filter to only leads with email (required for campaigns)
                   const leadsWithEmail = selectedLeads.filter(id => {
                     const lead = currentData.find(l => l.id === id);
                     return lead?.email;
                   });
                   if (leadsWithEmail.length === 0) {
                     toast.error(t('crm.noSelectedLeadsHaveEmail', 'No selected leads have email addresses'));
                     return;
                   }
                   onStartFollowUp(leadsWithEmail);
                   toast.success(t('crm.startingCampaignWith', { count: leadsWithEmail.length }, `Starting campaign with ${leadsWithEmail.length} leads`));
                 }}
                 className="px-3 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black text-xs font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center gap-2 shadow-sm"
               >
                 <Send className="w-3.5 h-3.5" />
                 <span>{t('crm.startCampaign', 'Start Campaign')}</span>
               </button>
             )}
             <button
                onClick={async () => {
                   if (!confirm(t('crm.confirmDeleteSelected', { count: selectedLeads.length }, `Are you sure you want to delete ${selectedLeads.length} selected leads?`))) return;
                   
                   setDeleting(true);
                   try {
                       const headers = await getAuthHeaders();
                       if (!headers.Authorization) {
                           toast.error('Not authenticated');
                           setDeleting(false);
                           return;
                       }

                       // Batch deletion in chunks of 100
                       const BATCH_SIZE = 100; 
                       const leadIds = [...selectedLeads];
                       const batches = [];
                       for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
                           batches.push(leadIds.slice(i, i + BATCH_SIZE));
                       }
                       
                       let totalDeleted = 0;
                       
                       for (const batch of batches) {
                           const response = await fetch(
                               `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-delete`,
                               {
                                   method: 'POST',
                                   headers,
                                   body: JSON.stringify({ lead_ids: batch })
                               }
                           );
                           
                           if (response.ok) {
                               const result = await response.json();
                               totalDeleted += (result.results?.deleted || 0);
                           }
                       }
                       
                       toast.success(t('crm.deletedLeads', { count: totalDeleted }, `Deleted ${totalDeleted} leads`));
                       setSelectedLeads([]);
                       await loadLeads();
                   } catch (error) {
                       console.error('Delete error:', error);
                       toast.error('Failed to delete leads');
                   } finally {
                       setDeleting(false);
                   }
                }}
                disabled={deleting}
                className="px-3 py-2 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 text-xs font-medium rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all flex items-center gap-2 shadow-sm"
             >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('crm.deleteCount', { count: selectedLeads.length }, `Delete (${selectedLeads.length})`)}</span>
             </button>
          </div>
        )}
      </div>



      {/* Main Content */}
      <div className="flex-1 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800/60 rounded-xl overflow-hidden shadow-sm flex flex-col">
        {loading || isDemoSeeding ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <LoadingSpinner size="lg" center />
            {isDemoSeeding ? (
              <div className="mt-4 text-center">
                <p className="text-sm font-medium text-[#1ED4A7]">{t('crm.settingUpDemoEnv', 'Setting up demo environment...')}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{t('crm.creatingDemoData', 'Creating 250 leads, campaigns, and analytics data')}</p>
              </div>
            ) : leads.length === 0 ? (
              <p className="text-sm text-zinc-500 mt-4">{t('crm.loadingLeads', 'Loading your leads...')}</p>
            ) : null}
          </div>
        ) : (
          <>
            {/* Mobile Card View — only mounted when viewport is <sm.
               Class `block sm:hidden` is kept for safety against late
               hydration on resize, but the JSX is gated on isDesktop
               so React doesn't commit ~100 components on desktop. */}
            {!isDesktop && <div className="block sm:hidden flex-1 min-h-0 overflow-y-auto p-4 space-y-4">{paginatedLeads.map((lead) => (<MobileLeadCard key={lead.id} lead={lead} selectedLeads={selectedLeads} toggleLeadSelection={toggleLeadSelection} setSelectedLeadId={setSelectedLeadId} statusColors={statusColors} needsReveal={needsReveal} revealLead={revealLead} revealingLeadId={revealingLeadId} showOutreach={teamLeads.length > 0} pipelineStage={pipelineLeadIds[lead.id] || null} intentLevel={highIntentLeadIds.has(lead.id) ? 'high' : mediumIntentLeadIds.has(lead.id) ? 'medium' : 'none'} onComposeEmail={handleComposeEmail} />))}</div>}{!isDesktop && <div className="block sm:hidden px-4">{/* Pagination for Mobile */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between py-4">
                   <button
                     onClick={() => activeTab === 'leads' ? goToPage(currentPage - 1) : setCurrentPage(prev => Math.max(1, prev - 1))}
                     disabled={currentPage === 1 || loading}
                     className="px-4 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg text-sm disabled:opacity-50"
                   >
                     {t('crm.previous', 'Previous')}
                   </button>
                   <span className="text-sm text-zinc-500">
                     {currentPage} / {totalPages.toLocaleString()}
                   </span>
                   <button
                     onClick={() => activeTab === 'leads' ? goToPage(currentPage + 1) : setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                     disabled={currentPage === totalPages || loading}
                     className="px-4 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg text-sm disabled:opacity-50"
                   >
                     {t('crm.next', 'Next')}
                   </button>
                </div>
              )}
            </div>}

            {/* Desktop/Tablet Table View — only mounted when ≥sm.
               Class `hidden sm:block` retained for safety, but JSX is
               gated on isDesktop so React doesn't commit the full
               table tree on mobile. */}
            {isDesktop && <div
              ref={desktopTableRef}
              className="hidden sm:block flex-1 min-h-0 overflow-auto"
            >
              <table className="w-full text-left border-collapse">
                <thead className="bg-white dark:bg-[#050505] sticky top-0 z-10 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                  <th className="p-3 w-10 relative">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedLeads.length === paginatedLeads.length && paginatedLeads.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-gray-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                      />
                      <div className="absolute left-8 top-1/2 -translate-y-1/2">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowBulkSelect(!showBulkSelect);
                          }}
                          className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        {showBulkSelect && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowBulkSelect(false)} />
                            <div className="absolute left-0 top-full mt-1 bg-white dark:bg-black rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 min-w-[120px] z-20 py-1">
                              <button onClick={() => { selectBulk(50); setShowBulkSelect(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                                {t('crm.selectFirst', { count: 50 }, 'Select first 50')}
                              </button>
                              <button onClick={() => { selectBulk(100); setShowBulkSelect(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                                {t('crm.selectFirst', { count: 100 }, 'Select first 100')}
                              </button>
                              <button onClick={() => { selectBulk(200); setShowBulkSelect(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                                {t('crm.selectFirst', { count: 200 }, 'Select first 200')}
                              </button>
                              <div className="border-t border-zinc-100 dark:border-zinc-800 my-1"></div>
                              <button onClick={() => { setSelectedLeads([]); setShowBulkSelect(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-400 dark:text-zinc-500">
                                {t('crm.deselectAll', 'Deselect All')}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </th>
                  <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('crm.personHeader', 'Person')}</th>
                  <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('crm.companyHeader', 'Company')}</th>
                  <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('crm.contactHeader', 'Contact')}</th>
                  <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('crm.statusHeader', 'Status')}</th>
                  {teamLeads.length > 0 && (
                    <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('crm.outreachHeader', 'Outreach')}</th>
                  )}
                  <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('crm.engagementHeader', 'Engagement')}</th>
                  <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider text-right">{t('crm.leadScoreHeader', 'Lead Score')}</th>
                  <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {paginatedLeads.map((lead) => (
                  <DesktopLeadRow 
                    key={lead.id} 
                    lead={lead} 
                    selectedLeads={selectedLeads} 
                    toggleLeadSelection={toggleLeadSelection} 
                    setSelectedLeadId={setSelectedLeadId} 
                    statusColors={statusColors} 
                    statusMenuOpen={statusMenuOpen} 
                    setStatusMenuOpen={setStatusMenuOpen} 
                    updatingStatus={updatingStatus} 
                    updateLeadStatus={updateLeadStatus} 
                    getAvatarColor={getAvatarColor} 
                    needsReveal={needsReveal} 
                    revealLead={revealLead} 
                    revealingLeadId={revealingLeadId} 
                    showOutreachColumn={teamLeads.length > 0}
                    pipelineStage={pipelineLeadIds[lead.id] || null}
                    intentLevel={highIntentLeadIds.has(lead.id) ? 'high' : mediumIntentLeadIds.has(lead.id) ? 'medium' : 'none'}
                    onComposeEmail={handleComposeEmail}
                  />
                ))}
              </tbody>
              {/* (removed duplicate hidden tbody — never rendered, was re-rendering paginatedLeads on every state change) */}
            </table>

            </div>}

            {/* Desktop Pagination Controls for Leads Tab — only on ≥sm */}
            {isDesktop && activeTab === 'leads' && totalPages > 1 && (
              <div className="hidden sm:flex sticky bottom-0 bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 items-center justify-between z-10">
                <p className="text-xs text-zinc-500">
                  {t('crm.showingRange', { from: ((currentPage - 1) * leadsPerPage) + 1, to: Math.min(currentPage * leadsPerPage, totalLeads), total: totalLeads.toLocaleString() }, `Showing ${((currentPage - 1) * leadsPerPage) + 1} - ${Math.min(currentPage * leadsPerPage, totalLeads)} of ${totalLeads.toLocaleString()} leads`)}
                  {loading && <Loader2 className="inline w-3 h-3 ml-2 animate-spin text-zinc-400" />}
                </p>
                <div className="flex items-center gap-1.5">
                  {/* First page */}
                  <button
                    onClick={() => goToPage(1)}
                    disabled={currentPage === 1 || loading}
                    className="px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="First page"
                  >
                    &laquo;
                  </button>
                  <button
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1 || loading}
                    className="px-3 py-1 text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('crm.previous', 'Previous')}
                  </button>
                  
                  {/* Page number buttons */}
                  {(() => {
                    const pages: number[] = [];
                    const maxVisible = 7;
                    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                    let end = Math.min(totalPages, start + maxVisible - 1);
                    if (end - start < maxVisible - 1) {
                      start = Math.max(1, end - maxVisible + 1);
                    }
                    for (let i = start; i <= end; i++) pages.push(i);
                    return pages.map(p => (
                      <button
                        key={p}
                        onClick={() => goToPage(p)}
                        disabled={loading}
                        className={`px-2.5 py-1 text-xs rounded transition-colors ${
                          p === currentPage
                            ? 'bg-zinc-900 dark:bg-white text-white dark:text-black font-semibold'
                            : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                        } disabled:cursor-not-allowed`}
                      >
                        {p}
                      </button>
                    ));
                  })()}
                  
                  <button
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages || loading}
                    className="px-3 py-1 text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('crm.next', 'Next')}
                  </button>
                  {/* Last page */}
                  <button
                    onClick={() => goToPage(totalPages)}
                    disabled={currentPage === totalPages || loading}
                    className="px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Last page"
                  >
                    &raquo;
                  </button>
                </div>
              </div>
            )}

            {/* Desktop Pagination Controls for Non-Leads Tabs — only on ≥sm */}
            {isDesktop && activeTab !== 'leads' && filteredLeads.length > leadsPerPage && (
              <div className="hidden sm:flex sticky bottom-0 bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 items-center justify-between">
                <p className="text-xs text-zinc-500">
                  {t('crm.showingRange', { from: ((currentPage - 1) * leadsPerPage) + 1, to: Math.min(currentPage * leadsPerPage, filteredLeads.length), total: filteredLeads.length.toLocaleString() }, `Showing ${((currentPage - 1) * leadsPerPage) + 1} - ${Math.min(currentPage * leadsPerPage, filteredLeads.length)} of ${filteredLeads.length.toLocaleString()} leads`)}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('crm.previous', 'Previous')}
                  </button>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('crm.next', 'Next')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Lead Modal */}
      <AddLeadModal
        isOpen={showAddLead}
        onClose={() => setShowAddLead(false)}
        onLeadAdded={() => { invalidateCRMCache('lead:created'); loadLeads(); }}
        onUpgrade={onUpgrade}
      />

      {/* Import Modal */}
      <CSVImportModal
        isOpen={showImportLeads}
        onClose={() => setShowImportLeads(false)}
        onImport={handleModalImport}
        isImporting={importing}
        importProgress={importProgress}
      />

      {/* Lead Detail Modal */}
      {selectedLeadId && (
        <LeadDetailModal
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
        />
      )}

      {/* Data Cleanup Utility */}
      {showDataCleanup && (
        <DataCleanupUtility
          onClose={() => setShowDataCleanup(false)}
          onDataChanged={loadLeads}
        />
      )}

      {/* Floating Selection Action Bar */}
      {showPipelineModal && (
        <AddToPipelineModal
          preselectedLeadIds={selectedLeads}
          preselectedLeads={currentData.filter((l: any) => selectedLeads.includes(l.id)).map((l: any) => ({
            id: l.id,
            contact_name: l.contact_name || '',
            business_name: l.business_name || '',
            email: l.email || '',
            category: l.category || '',
            city: l.city || '',
          }))}
          onClose={() => setShowPipelineModal(false)}
          onSuccess={(created) => {
            if (created > 0) {
              setSelectedLeads([]);
              loadPipelineLeadIds();
            }
          }}
        />
      )}

      {selectedLeads.length > 0 && (
        <div className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] lg:bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in" style={{ marginBottom: typeof window !== 'undefined' && document.body.classList.contains('is-native-app') && window.innerWidth < 1024 ? '5rem' : '0' }}>
          <div className="flex items-center gap-3 px-5 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black rounded-2xl shadow-2xl border border-zinc-700 dark:border-zinc-300">
            <span className="text-sm font-medium whitespace-nowrap">{selectedLeads.length} lead{selectedLeads.length !== 1 ? 's' : ''} selected</span>
            <div className="w-px h-5 bg-zinc-600 dark:bg-zinc-400" />
            {onStartFollowUp && (
              <button
                onClick={() => {
                  const leadsWithEmail = selectedLeads.filter(id => {
                    const lead = currentData.find((l: any) => l.id === id);
                    return lead?.email;
                  });
                  if (leadsWithEmail.length === 0) {
                    toast.error('No selected leads have email addresses');
                    return;
                  }
                  onStartFollowUp(leadsWithEmail);
                  toast.success(`Starting campaign with ${leadsWithEmail.length} leads`);
                }}
                className="px-3.5 py-1.5 bg-white text-black dark:bg-zinc-200 text-xs font-semibold rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-300 transition-all flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                Start Campaign
              </button>
            )}
            <button
              onClick={() => setShowPipelineModal(true)}
              className="px-3.5 py-1.5 bg-white/10 text-xs font-semibold rounded-lg hover:bg-white/20 dark:hover:bg-zinc-700 transition-all flex items-center gap-1.5"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Add to Pipeline
            </button>
            <button
              onClick={() => setShowEnrollSequenceModal(true)}
              className="px-3.5 py-1.5 bg-white/10 text-xs font-semibold rounded-lg hover:bg-white/20 dark:hover:bg-zinc-700 transition-all flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5" />
              Enroll in Sequence
            </button>
            <button
              onClick={() => setSelectedLeads([])}
              className="p-1.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 rounded-lg transition-colors"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Enroll in Sequence Modal */}
      {showEnrollSequenceModal && (
        <EnrollInSequenceModal
          leadIds={selectedLeads}
          leadEmails={selectedLeads.map(id => {
            const lead = currentData.find((l: any) => l.id === id);
            return { id, email: lead?.email || '', name: lead?.name || lead?.company || '' };
          })}
          onClose={() => setShowEnrollSequenceModal(false)}
          onEnrolled={() => {
            setSelectedLeads([]);
            loadLeads();
          }}
        />
      )}
    </div>
      )} {/* end activeTab !== 'companies' */}
    </div>
  );
}

// Default export for better React.lazy compatibility with large chunks
export default CRM;
