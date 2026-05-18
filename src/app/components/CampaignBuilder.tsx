// Rebuild: 2026-03-03T14:00 — force recompile to clear stale module cache
import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { X, Sparkles, Send, Users, CheckCircle2, Filter, Mail, Search, MapPin, Tag, CheckSquare, AlertCircle, Loader2, Zap, ChevronDown, Calendar, Clock, FileText, Paperclip, Trash2, Upload, Briefcase } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { MigrationNotice } from './MigrationNotice';
import { GroupsManager } from './GroupsManager';
import { apiCache } from '../lib/api-cache';
import { useBroadcast } from './BroadcastContext';
import { dispatchAppEvent } from '../lib/app-events';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import { toast } from 'sonner';
import { realtimeManager } from '../lib/realtime';
import { formatPhoneDisplay } from '../lib/phone-format';
import DOMPurify from 'dompurify';
import { TokenInserter } from './TokenInserter';
import { TemplateLibrary } from './TemplateLibrary';
import { WritingPresetSelector } from './WritingPresetSelector';
import { IconButton } from './ui/icon-button';
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { isCountryName } from '../utils/country-names';
import { isValidStateForCountry } from '../utils/us-states';

interface Group {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  lead_count: { count: number }[];
}

// ═══════════════════════════════════════════════════════════════════════
// Performance: Memoized Lead Row Component
// ═══════════════════════════════════════════════════════════════════════

// ── Display-level cleaners: reject LinkedIn headlines/taglines from display ──
function cleanBizNameForDisplay(raw: string): string {
  if (!raw) return '';
  let c = raw.trim();
  c = c.replace(/,\s+(?:My |I |We |Our |Your |A |The |An |Helping |Passionate |Dedicated |Experienced |Building |Creating |Empowering |Enabling |Transforming |Committed |Focused |Specializ|Leverag|Proven |Award|Driving |Working |Looking |Seeking |Striving |Results).*/i, '').trim();
  const HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+\s+in|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work|build|create)|we\s+(?:help|are|build|create|provide|deliver)|my\s+(?:goal|mission|passion|focus))/i;
  if (HEADLINE.test(c)) return '';
  const PURE_TITLE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|director|manager|head|lead|chief|founder|co-?founder|owner|partner|president|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelanc\w+|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|developer|designer|recruiter|marketer|sales\w*|business\s+development)(\s+(of|at|for|in|&|and|\/)\s+.*)?$/i;
  if (PURE_TITLE.test(c)) return '';
  if (/\b(helping|empowering|enabling|transforming|building|creating|delivering|providing|growing|driving|solving|improving|supporting|managing|developing|seeking|looking|striving|committed|passionate|dedicated|experienced)\b/i.test(c) && c.split(/\s+/).length > 3) return '';
  if (/\b(my goal|i help|i am|we help|we are|our mission|your|they|them|their)\b/i.test(c) && c.split(/\s+/).length > 2) return '';
  if (c.split(/\s+/).length > 7) return '';
  return c;
}

interface LeadRowProps {
  lead: any;
  isSelected: boolean;
  onToggle: (leadId: string) => void;
}

const LeadRow = memo(function LeadRow({ lead, isSelected, onToggle }: LeadRowProps) {
  const { t } = useTranslation();
  const displayName = cleanBizNameForDisplay(lead.business_name) || lead.contact_name || lead.business_name || '—';
  return (
    <label
      className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all ${
        isSelected 
          ? 'bg-zinc-50 dark:bg-zinc-950' 
          : 'hover:bg-zinc-50/60 dark:hover:bg-zinc-900'
      }`}
    >
      <div className={`w-[18px] h-[18px] rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
        isSelected 
          ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' 
          : 'border-zinc-300 dark:border-white/15 bg-transparent'
      }`}>
        {isSelected && (
          <svg className="w-3 h-3 text-white dark:text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(lead.id)}
        className="sr-only"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-zinc-900 dark:text-white truncate">
          {displayName}
        </p>
        <p className="text-[12px] text-zinc-400 dark:text-zinc-500 truncate">
          {lead.category} · {lead.city}
        </p>
        {lead.email && (
          <p className="text-[11px] text-zinc-400/70 dark:text-zinc-600 truncate mt-0.5">
            {lead.email}
          </p>
        )}
      </div>
      {lead.bounced && (
        <span className="text-[10px] font-medium text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-500/10 px-2 py-0.5 rounded-full flex-shrink-0">{t('campaignBuilder.bounced')}</span>
      )}
      {lead.contacted && !lead.bounced && (
        <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-white/5 px-2 py-0.5 rounded-full flex-shrink-0">{t('campaignBuilder.contacted')}</span>
      )}
    </label>
  );
});

interface CampaignAttachment {
  id: string;
  filename: string;
  size: number;
  type: string;
  storagePath: string;
}

const STANDARD_INDUSTRIES = [
  'Accounting', 'Airlines/Aviation', 'Alternative Dispute Resolution', 'Alternative Medicine',
  'Animation', 'Apparel & Fashion', 'Architecture & Planning', 'Arts and Crafts',
  'Automotive', 'Aviation & Aerospace', 'Banking', 'Biotechnology', 'Broadcast Media',
  'Building Materials', 'Business Supplies and Equipment', 'Capital Markets', 'Chemicals',
  'Civic & Social Organization', 'Civil Engineering', 'Commercial Real Estate',
  'Computer & Network Security', 'Computer Games', 'Computer Hardware', 'Computer Networking',
  'Computer Software', 'Construction', 'Consumer Electronics', 'Consumer Goods',
  'Consumer Services', 'Cosmetics', 'Dairy', 'Defense & Space', 'Design',
  'Education Management', 'E-Learning', 'Electrical/Electronic Manufacturing',
  'Entertainment', 'Environmental Services', 'Events Services', 'Executive Office',
  'Facilities Services', 'Farming', 'Financial Services', 'Fine Art', 'Fishery',
  'Food & Beverages', 'Food Production', 'Fund-Raising', 'Furniture', 'Gambling & Casinos',
  'Glass, Ceramics & Concrete', 'Government Administration', 'Government Relations',
  'Graphic Design', 'Health, Wellness & Fitness', 'Higher Education', 'Hospital & Health Care',
  'Hospitality', 'Human Resources', 'Import & Export', 'Individual & Family Services',
  'Industrial Automation', 'Information Services', 'Information Technology & Services',
  'Insurance', 'International Affairs', 'International Trade and Development', 'Internet',
  'Investment Banking', 'Investment Management', 'Judiciary', 'Law Enforcement',
  'Law Practice', 'Legal Services', 'Legislative Office', 'Leisure, Travel & Tourism',
  'Libraries', 'Logistics & Supply Chain', 'Luxury Goods & Jewelry', 'Machinery',
  'Management Consulting', 'Maritime', 'Marketing & Advertising', 'Market Research',
  'Mechanical or Industrial Engineering', 'Media Production', 'Medical Devices',
  'Medical Practice', 'Mental Health Care', 'Military', 'Mining & Metals',
  'Motion Pictures & Film', 'Museums & Institutions', 'Music', 'Nanotechnology',
  'Newspapers', 'Nonprofit Organization Management', 'Oil & Energy', 'Online Media',
  'Outsourcing/Offshoring', 'Package/Freight Delivery', 'Packaging and Containers',
  'Paper & Forest Products', 'Performing Arts', 'Pharmaceuticals', 'Philanthropy',
  'Photography', 'Plastics', 'Political Organization', 'Primary/Secondary Education',
  'Printing', 'Professional Training & Coaching', 'Program Development', 'Public Policy',
  'Public Relations and Communications', 'Public Safety', 'Publishing', 'Railroad Manufacture',
  'Ranching', 'Real Estate', 'Recreational Facilities and Services', 'Religious Institutions',
  'Renewables & Environment', 'Research', 'Restaurants', 'Retail', 'Security & Investigations',
  'Semiconductors', 'Shipbuilding', 'Sporting Goods', 'Sports', 'Staffing & Recruiting',
  'Supermarkets', 'Telecommunications', 'Textiles', 'Think Tanks', 'Tobacco',
  'Translation & Localization', 'Transportation/Trucking/Railroad', 'Utilities',
  'Venture Capital & Private Equity', 'Veterinary', 'Warehousing', 'Wholesale',
  'Wine & Spirits', 'Wireless', 'Writing & Editing'
];

interface CampaignBuilderProps {
  onClose?: () => void;
  preselectedLeadIds?: string[];
}

// ─── Audience Builder v2 helpers (module-level, pure) ─────────────────
// Fisher-Yates shuffle, used by sample-mode=Random. Mutates the input
// array and returns it — caller passes a copy.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Engagement state predicate. Inspects whichever lead fields we have
// (the schema isn't 100% uniform — some leads have status, some have
// last_email_status, some carry derived flags). Conservative: when a
// signal is missing we treat the lead as "not in that state" rather
// than guess.
type EngagementStateLocal = 'never_contacted' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed';
function matchesEngagement(lead: any, states: EngagementStateLocal[]): boolean {
  if (!states.length) return true;
  const status = String(lead.status || lead.last_email_status || '').toLowerCase();
  const wasContacted = !!(lead.last_contacted || lead.contacted_at || lead.last_email_at);
  for (const s of states) {
    if (s === 'never_contacted' && !wasContacted) return true;
    if (s === 'opened' && (status === 'opened' || lead.opened_count > 0)) return true;
    if (s === 'clicked' && (status === 'clicked' || lead.clicked_count > 0)) return true;
    if (s === 'replied' && (status === 'replied' || !!lead.replied_at)) return true;
    if (s === 'bounced' && (status === 'bounced' || lead.bounced === true)) return true;
    if (s === 'unsubscribed' && (status === 'unsubscribed' || lead.unsubscribed === true)) return true;
  }
  return false;
}

export function CampaignBuilder({ onClose, preselectedLeadIds = [] }: CampaignBuilderProps) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const broadcast = useBroadcast();
  const [step, setStep] = useState<'details' | 'leads' | 'preview'>('details');
  const [campaign, setCampaign] = useState({
    name: '',
    brand: 'custom',
    product: 'custom',
    customProductName: '',
    value: '',
    landingUrl: '',
    tone: 'casual',
    fromEmail: '',
    senderName: '',
    senderTitle: '',
    campaignKnowledge: '',
    customInstructions: '',
    exampleEmail: '',
    maxWords: 75,
    cc: '',
    bcc: '',
  });
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [availableLeads, setAvailableLeads] = useState<any[]>([]);
  const [totalLeadCount, setTotalLeadCount] = useState(0);
  const [leadPage, setLeadPage] = useState(1);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [hasMoreLeads, setHasMoreLeads] = useState(true);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<string[]>(preselectedLeadIds);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<'individual' | 'groups'>('groups');
  const [previewEmail, setPreviewEmail] = useState<{
    subject: string;
    preview: string;
    body: string;
  } | null>(null);
  const [previewLeadName, setPreviewLeadName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);
  const [loadingGroupLeads, setLoadingGroupLeads] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const [testEmailSent, setTestEmailSent] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [showMigrationNotice, setShowMigrationNotice] = useState(false);
  const [showOnlyUncontacted, setShowOnlyUncontacted] = useState(false);
  const [scheduleValue, setScheduleValue] = useState<ScheduleValue>({ mode: 'now' });
  const sendImmediately = scheduleValue.mode === 'now';
  const [enableFollowUps, setEnableFollowUps] = useState(true); // Enable follow-up automation
  const [followUpDays, setFollowUpDays] = useState(3); // Days between follow-ups
  const [maxFollowUps, setMaxFollowUps] = useState(2); // Maximum number of follow-ups
  const [showInvestorSuggestion, setShowInvestorSuggestion] = useState(false);
  const [showGroupsManager, setShowGroupsManager] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userBrand, setUserBrand] = useState('custom');
  const isAdmin = userEmail === 'or@roadr.com' || userEmail === 'admin@contndr.com';
  
  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]); // Start cleared — no default country filter
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [activeDropdown, setActiveDropdown] = useState<'city' | 'state' | 'country' | 'industry' | null>(null);
  const [showFilters, setShowFilters] = useState(true); // Default to showing filters for better accessibility
  const [showBulkSelect, setShowBulkSelect] = useState(false);

  // ── Audience Builder v2 — additive state (none of the existing
  //    filter/select logic depends on these; they layer on top so the
  //    legacy code paths keep working if anything reads it). ──
  // Exact-N sampling. `null` = no cap (all matching).
  const [sampleSize, setSampleSize] = useState<number | null>(null);
  // First → preserves whatever order the lead list comes in (lead_score desc on the server).
  // Random → unbiased small-sample test runs.
  // Top by score → only when we have a lead_score field; falls back to First otherwise.
  const [sampleMode, setSampleMode] = useState<'first' | 'random' | 'top_score'>('first');
  // Engagement filter — multi-select. Empty array = no engagement filter.
  // `never_contacted` is mutually-exclusive with the others; UI enforces it.
  // Backward-compat: while `engagementStates` is empty, the legacy
  // `showOnlyUncontacted` toggle still works. As soon as the user picks
  // anything in the multi-filter we shift to the new source of truth.
  type EngagementState = 'never_contacted' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed';
  const [engagementStates, setEngagementStates] = useState<EngagementState[]>([]);
  // Active preset name, so the UI can highlight which preset is on
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // ── Phase 2: lead score range (0–100) ──
  // null = no score filter applied. The slider sets [min, max] inclusive.
  const [scoreRange, setScoreRange] = useState<[number, number] | null>(null);
  // ── Phase 2: recency filters ──
  // `addedWithinDays` — only leads created in the last N days. null = no limit.
  // `lastContactedRange` — { min?, max? } in days since now. min=60 means "contacted ≥60d ago".
  const [addedWithinDays, setAddedWithinDays] = useState<number | null>(null);
  const [lastContactedRange, setLastContactedRange] = useState<{ min?: number; max?: number } | null>(null);
  // ── Phase 2: cross-campaign exclusion ──
  // When true, leads currently enrolled in another active/sending/
  // scheduled campaign are filtered out — prevents double-touch.
  // `activeCampaignLeadIds` is fetched lazily from /campaigns/active-lead-ids
  // and cached for the modal's lifetime.
  const [excludeActiveCampaigns, setExcludeActiveCampaigns] = useState(false);
  const [activeCampaignLeadIds, setActiveCampaignLeadIds] = useState<Set<string> | null>(null);
  // ── Phase 2: saved segments ──
  interface SavedSegment { id: string; name: string; filters: any; updated_at?: string; }
  const [savedSegments, setSavedSegments] = useState<SavedSegment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [showSegmentMenu, setShowSegmentMenu] = useState(false);
  const [savingSegment, setSavingSegment] = useState(false);

  const [hasSignature, setHasSignature] = useState(true);
  const [signatureText, setSignatureText] = useState<string>('');
  const [attachments, setAttachments] = useState<CampaignAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Performance: visible lead count for lazy rendering
  const [visibleLeadCount, setVisibleLeadCount] = useState(50);
  const leadListRef = useRef<HTMLDivElement>(null);

  // Performance: O(1) lookup set for selected leads
  const selectedLeadSet = useMemo(() => new Set(selectedLeads), [selectedLeads]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleLeadCount(50);
  }, [searchQuery, selectedCities, selectedStates, selectedCountries, selectedIndustries, showOnlyUncontacted, engagementStates, scoreRange, addedWithinDays, lastContactedRange, excludeActiveCampaigns]);

  // Debounced server-side search: re-fetch leads when filters change
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);
  useEffect(() => {
    // Skip the very first mount — loadLeads() handles the initial fetch
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      console.log(`[CAMPAIGN BUILDER] FILTER_EFFECT skip initial mount, showOnlyUncontacted=${showOnlyUncontacted}`);
      return;
    }
    console.log(`[CAMPAIGN BUILDER] FILTER_EFFECT triggered: showOnlyUncontacted=${showOnlyUncontacted} search="${searchQuery}" cities=${selectedCities.length} states=${selectedStates.length} countries=${selectedCountries.length} industries=${selectedIndustries.length}`);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      console.log(`[CAMPAIGN BUILDER] FILTER_EFFECT debounce fired, calling fetchLeadsPage(1) with showOnlyUncontacted=${showOnlyUncontacted}`);
      setLeadPage(1);
      setHasMoreLeads(true);
      fetchLeadsPage(1, false);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery, selectedCities, selectedStates, selectedCountries, selectedIndustries, showOnlyUncontacted]);

  // Email config for non-admin users
  const [emailProvider, setEmailProvider] = useState<string>('resend');
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [loadingEmailConfig, setLoadingEmailConfig] = useState(false);

  useEffect(() => {
    if (isDemoMode) return;
    async function loadSignature() {
      try {
        const res = await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/settings/signature`);
        const data = await res.json();
        console.log('[CAMPAIGN] Signature API response:', data);
        if (data.success && data.signature) {
             const s = data.signature;
             const configured = !!(s.custom_html || (s.full_name && s.closing_line));
             setHasSignature(configured);
             if (configured) {
               // Pre-fill campaign sender fields from signature (if not already set by admin auto-populate)
               setCampaign(prev => ({
                 ...prev,
                 fromEmail: prev.fromEmail || s.email || '',
                 senderName: prev.senderName || s.full_name || '',
                 senderTitle: prev.senderTitle || s.title || '',
               }));

               // Build the signature text for preview
               if (s.custom_html) {
                 setSignatureText(s.custom_html);
               } else {
                 const lines: string[] = [];
                 if (s.closing_line) lines.push(`${s.closing_line},`);
                 if (s.full_name) {
                   let nameLine = s.full_name;
                   if (s.title) nameLine += ` | ${s.title}`;
                   lines.push(nameLine);
                 }
                 if (s.email) lines.push(`E: ${s.email}`);
                 if (s.phone) lines.push(`P: ${formatPhoneDisplay(s.phone)}`);
                 if (s.website) {
                   const clean = s.website.replace(/^https?:\/\//, '');
                   lines.push(`W: ${clean}`);
                 }
                  // Affiliate tracking removed — always show user's own website
                  setSignatureText(lines.join('\n'));
               }
             }
        } else {
             setHasSignature(false);
        }
      } catch (e) {
        console.error('[CAMPAIGN] Failed to load signature:', e);
        setHasSignature(false);
      }
    }
    loadSignature();
  }, [isDemoMode]);

  const productOptions = [
    { value: 'custom', label: 'Custom Campaign', restricted: false },
    { value: 'contndr_outreach', label: 'Contndr Outreach', restricted: true },
    { value: 'roadr_provider', label: 'Roadr - Provider Subscription (Legacy)', restricted: true },
    { value: 'roadr_investor', label: 'Roadr - Investor Outreach', restricted: true },
    { value: 'sourcr_web_starter', label: 'Sourcr - Starter Website (Legacy)', restricted: true },
    { value: 'sourcr_web', label: 'Sourcr - Premium Website (Legacy)', restricted: true },
    { value: 'sourcr_app', label: 'Sourcr - Mobile App (Legacy)', restricted: true },
    { value: 'sourcr_investor', label: 'Sourcr - Investor Outreach', restricted: true },
    { value: 'covera_core', label: 'Covera - Core Platform', restricted: true },
    { value: 'covera_investor', label: 'Covera - Investor Outreach', restricted: true },
  ];

  const toneOptions = [
    { value: 'casual', labelKey: 'toneCasual', descKey: 'toneCasualDesc' },
    { value: 'professional', labelKey: 'toneProfessional', descKey: 'toneProfessionalDesc' },
    { value: 'direct', labelKey: 'toneDirect', descKey: 'toneDirectDesc' },
    { value: 'friendly', labelKey: 'toneFriendly', descKey: 'toneFriendlyDesc' },
    { value: 'enthusiastic', labelKey: 'toneEnthusiastic', descKey: 'toneEnthusiasticDesc' },
    { value: 'formal', labelKey: 'toneFormal', descKey: 'toneFormalDesc' },
    { value: 'witty', labelKey: 'toneWitty', descKey: 'toneWittyDesc' },
    { value: 'empathetic', labelKey: 'toneEmpathetic', descKey: 'toneEmpatheticDesc' },
  ];

  const senderNameOptions = [
    { value: 'custom', label: 'Custom...' },
    { value: 'Otiniel Ribeiro', label: 'Otiniel Ribeiro (Recommended - CEO)', restricted: true },
    { value: 'Contndr Team', label: 'Contndr Team (Provider Subscription)', restricted: true },
    { value: 'Victoria Collins', label: 'Victoria Collins', restricted: true },
    { value: 'Zara Blake', label: 'Zara Blake', restricted: true },
  ];

  const senderTitleOptions = [
    { value: 'Founder', label: 'Founder (Recommended - Higher Reply Rates)' },
    { value: 'custom', label: 'Custom...' },
    { value: 'Growth Team', label: 'Growth Team', restricted: true },
    { value: 'Partnership Team', label: 'Partnership Team (Legacy)', restricted: true },
    { value: 'Sales Manager', label: 'Sales Manager' },
    { value: 'Business Development Manager', label: 'Business Development Manager' },
    { value: 'Account Executive', label: 'Account Executive' },
    { value: 'Partnership Manager', label: 'Partnership Manager' },
    { value: 'Founder & CEO', label: 'Founder & CEO' },
  ];

  const filteredProductOptions = productOptions.filter(opt => 
    !opt.restricted || isAdmin
  );

  const filteredSenderNameOptions = senderNameOptions.filter(opt => 
    !opt.restricted || isAdmin
  );

  const filteredSenderTitleOptions = senderTitleOptions.filter(opt => 
    !opt.restricted || isAdmin
  );

  useEffect(() => {
    if (isDemoMode) {
      setUserEmail('demo@contndr.com');
      setUserBrand('contndr');
      setCampaign(prev => ({ ...prev, brand: 'contndr' }));
      return;
    }
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (user) {
        const email = user.email || '';
        setUserEmail(email);
        // Only default to contndr brand for admin accounts
        const adminUser = email.toLowerCase() === 'or@roadr.com' || email.toLowerCase() === 'admin@contndr.com';
        
        // Use saved brand from profile settings, or fallback to 'custom'
        const savedBrand = user.user_metadata?.brand || 'custom';
        setUserBrand(savedBrand);
        
        setCampaign(prev => ({ ...prev, brand: adminUser ? 'contndr' : savedBrand }));
        // Default test email to user's own email for non-admin
        if (!adminUser) setTestEmailAddress(email);
      }
    };
    loadUser();
  }, [isDemoMode]);

  // Load email config for non-admin users (provider + connected email)
  useEffect(() => {
    if (isDemoMode || isAdmin || !userEmail) return;
    async function loadEmailConfig() {
      setLoadingEmailConfig(true);
      try {
        const provData = await apiCache.fetch(
          'settings:email-provider',
          async () => {
            const res = await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/settings/user-settings`);
            return res.json();
          },
          { staleTime: 60_000, cacheTime: 300_000 }
        );
        if (provData.success && provData.settings) {
          const prov = provData.settings.provider || 'resend';
          setEmailProvider(prov);
          const cEmail = provData.settings.connected_email || null;
          setConnectedEmail(cEmail);
          // For OAuth or SMTP users, auto-fill fromEmail with connected email
          if ((prov === 'gmail_oauth' || prov === 'outlook_oauth' || prov === 'smtp') && cEmail) {
            setCampaign(prev => ({
              ...prev,
              fromEmail: prev.fromEmail || cEmail,
            }));
          }
        }
      } catch (err) {
        console.error('[CAMPAIGN] Failed to load email config:', err);
      } finally {
        setLoadingEmailConfig(false);
      }
    }
    loadEmailConfig();
  }, [isAdmin, userEmail]);

  // Load leads when needed
  useEffect(() => {
    if (step === 'leads') {
      loadLeads();
      loadGroups();
      
      // Show investor suggestion if this is an investor campaign
      const isInvestorCampaign = campaign.product === 'sourcr_investor' || campaign.product === 'roadr_investor' || campaign.product === 'covera_investor';
      setShowInvestorSuggestion(isInvestorCampaign);
    }
  }, [step]);

  // Helper function to get auth headers and validate
  async function getValidatedAuthHeaders() {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      throw new Error('Not authenticated. Please sign in and try again.');
    }
    return headers;
  }

  const LEADS_PER_PAGE = 200;
  const lightFields = 'id,business_name,contact_name,email,category,city,state,country,last_contacted,bounced,status';

  // Build query string from current filters
  const buildFilterQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set('skip_stats', 'true');
    params.set('fields', lightFields);
    params.set('per_page', String(LEADS_PER_PAGE));
    params.set('exclude_bounced', 'true');
    // CRITICAL: Only fetch leads with emails for campaign sending
    params.set('has_email', 'true');
    if (searchQuery) params.set('search', searchQuery);
    if (selectedCities.length > 0) params.set('city', selectedCities.join('|'));
    if (selectedStates.length > 0) params.set('state', selectedStates.join('|'));
    if (selectedCountries.length > 0) params.set('country', selectedCountries.join('|'));
    if (selectedIndustries.length > 0) params.set('industry', selectedIndustries.join('|'));
    if (showOnlyUncontacted) params.set('contacted', 'no');
    else params.set('contacted', 'all');
    return params.toString();
  }, [searchQuery, selectedCities, selectedStates, selectedCountries, selectedIndustries, showOnlyUncontacted]);

  async function fetchLeadsPage(page: number, append = false) {
    try {
      if (append) setLoadingMoreLeads(true);

      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;

      const filterQS = buildFilterQuery();
      const url = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads?page=${page}&${filterQS}`;
      console.log(`[CAMPAIGN BUILDER] FETCH page=${page} showOnlyUncontacted=${showOnlyUncontacted} url=${url}`);
      const response = await authenticatedFetch(url, { signal: AbortSignal.timeout(30000) });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[CAMPAIGN BUILDER] HTTP ${response.status} body=${errBody}`);
        throw new Error(`Failed to fetch leads: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[CAMPAIGN BUILDER] RESPONSE total=${data.total} leads_returned=${(data.leads||[]).length} page=${data.page} total_pages=${data.total_pages}`);
      if (data.leads && data.leads.length > 0) {
        const s = data.leads[0];
        console.log(`[CAMPAIGN BUILDER] SAMPLE_LEAD id=${s.id} last_contacted=${s.last_contacted} status=${s.status} business_name=${s.business_name}`);
      }
      if (data.leads && data.leads.length === 0 && showOnlyUncontacted) {
        console.warn(`[CAMPAIGN BUILDER] WARNING: Server returned 0 leads for uncontacted filter! Response keys: ${Object.keys(data).join(',')}`);
      }

      const leadsData = (data.leads || [])
        // SAFETY: Filter out any leads without emails (should already be filtered by backend)
        .filter((lead: any) => !!lead.email?.trim())
        .map((lead: any) => ({
          ...lead,
          contacted: !!lead.last_contacted ||
            ['contacted','replied','customer','closed','client'].includes((lead.status || '').toLowerCase()),
        }));

      const serverTotal = data.total || 0;
      setTotalLeadCount(serverTotal);
      setLeadPage(page);
      setHasMoreLeads(page * LEADS_PER_PAGE < serverTotal);

      if (append && page > 1) {
        setAvailableLeads(prev => {
          const existingIds = new Set(prev.map((l: any) => l.id));
          const newLeads = leadsData.filter((l: any) => !existingIds.has(l.id));
          return [...prev, ...newLeads];
        });
        // Bump visible count so newly loaded leads are visible during scroll
        setVisibleLeadCount(prev => prev + leadsData.length);
      } else {
        setAvailableLeads(leadsData);
      }

      console.log(`[CAMPAIGN BUILDER] DONE page=${page}: ${leadsData.length} leads (${serverTotal} total) showOnlyUncontacted=${showOnlyUncontacted}`);
    } catch (error) {
      console.error('[CAMPAIGN BUILDER] Error loading leads:', error);
    } finally {
      setLoadingMoreLeads(false);
    }
  }

  async function loadLeads() {
    console.log(`[CAMPAIGN BUILDER] loadLeads() called, showOnlyUncontacted=${showOnlyUncontacted}`);
    setLeadPage(1);
    setHasMoreLeads(true);
    
    // Demo mode: skip API calls
    if (isDemoMode) {
      console.log('[CAMPAIGN BUILDER DEMO] Using demo leads');
      setAvailableLeads([]);
      setTotalLeadCount(0);
      setHasMoreLeads(false);
      return;
    }
    
    // Check prefetch cache for instant first page — but SKIP cache when filtering
    const cached = !showOnlyUncontacted ? apiCache.get<any>('campaign-builder:leads:page1') : null;
    if (cached?.data) {
      const leadsData = (cached.data.leads || [])
        // SAFETY: Filter out any leads without emails from cached data
        .filter((lead: any) => !!lead.email?.trim())
        .map((lead: any) => ({
          ...lead,
          contacted: !!lead.last_contacted ||
            ['contacted','replied','customer','closed','client'].includes((lead.status || '').toLowerCase()),
        }));
      setAvailableLeads(leadsData);
      setTotalLeadCount(cached.data.total || leadsData.length);
      setHasMoreLeads((cached.data.total || 0) > leadsData.length);
      console.log(`[CAMPAIGN BUILDER] Cache hit — ${leadsData.length} leads shown instantly (showOnlyUncontacted=${showOnlyUncontacted})`);
      if (!cached.isStale) return;
    }
    
    fetchLeadsPage(1, false);
  }

  function loadMoreLeads() {
    if (loadingMoreLeads || !hasMoreLeads) return;
    fetchLeadsPage(leadPage + 1, true);
  }

  async function loadGroups() {
    if (isDemoMode) return;
    try {
      // Check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('No active session - groups will be filtered by RLS');
        return;
      }

      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to load groups');
      }

      const data = await response.json();
      console.log(`Loaded ${data.groups?.length || 0} groups for campaign builder for user ${session.user.email}`);
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  }

  const toggleLeadSelection = useCallback((leadId: string) => {
    setSelectedLeads(prev => {
      const set = new Set(prev);
      if (set.has(leadId)) {
        set.delete(leadId);
      } else {
        set.add(leadId);
      }
      return Array.from(set);
    });
  }, []);

  function selectAllLeads() {
    // Use server-side select all for full 65K+ coverage
    selectAllFilteredLeads();
  }

  function deselectAllLeads() {
    setSelectedLeads([]);
  }

  // Filtering is now server-side — availableLeads IS the filtered result
  // For multi-city/multi-industry client-side filtering (server only supports single values),
  // we do a lightweight local pass only when multiple values are selected
  const filteredLeads = useMemo(() => {
    // Always exclude bounced leads client-side (safety net on top of server filter)
    let leads = availableLeads.filter(lead => !lead.bounced);
    if (selectedCities.length > 1 || selectedStates.length > 1 || selectedCountries.length > 1 || selectedIndustries.length > 1) {
      const citySet = selectedCities.length > 1 ? new Set(selectedCities) : null;
      const stateSet = selectedStates.length > 1 ? new Set(selectedStates) : null;
      const countrySet = selectedCountries.length > 1 ? new Set(selectedCountries) : null;
      const industrySet = selectedIndustries.length > 1 ? new Set(selectedIndustries) : null;
      leads = leads.filter(lead => {
        if (citySet && !citySet.has(lead.city)) return false;
        if (stateSet && !stateSet.has(lead.state)) return false;
        if (countrySet && !countrySet.has(lead.country)) return false;
        if (industrySet && !(industrySet.has(lead.industry) || industrySet.has(lead.category))) return false;
        return true;
      });
    }
    // Audience Builder v2 — engagement filter applies to the VISIBLE list,
    // the counts, AND the sampler. Previously it only ran inside
    // applyAudienceSample, which left contacted leads visible in the list
    // even when "Never contacted" was active.
    if (engagementStates.length > 0) {
      leads = leads.filter(l => matchesEngagement(l, engagementStates));
    }
    // ── Phase 2 filters ──
    if (scoreRange) {
      const [lo, hi] = scoreRange;
      leads = leads.filter(l => {
        const s = Number(l.lead_score ?? l.score ?? 0);
        return s >= lo && s <= hi;
      });
    }
    if (addedWithinDays != null) {
      const cutoff = Date.now() - addedWithinDays * 24 * 60 * 60 * 1000;
      leads = leads.filter(l => {
        const t = new Date(l.created_at || 0).getTime();
        return t >= cutoff;
      });
    }
    if (lastContactedRange) {
      const now = Date.now();
      leads = leads.filter(l => {
        const tRaw = l.last_contacted || l.contacted_at || l.last_email_at;
        if (!tRaw) return false; // can't satisfy a "contacted N days ago" filter for never-contacted leads
        const ageDays = (now - new Date(tRaw).getTime()) / (24 * 60 * 60 * 1000);
        if (lastContactedRange.min != null && ageDays < lastContactedRange.min) return false;
        if (lastContactedRange.max != null && ageDays > lastContactedRange.max) return false;
        return true;
      });
    }
    if (excludeActiveCampaigns && activeCampaignLeadIds) {
      leads = leads.filter(l => !activeCampaignLeadIds.has(l.id));
    }
    return leads;
  }, [availableLeads, selectedCities, selectedStates, selectedCountries, selectedIndustries, engagementStates, scoreRange, addedWithinDays, lastContactedRange, excludeActiveCampaigns, activeCampaignLeadIds]);

  // Server-side filter options (loaded once from /filter-options endpoint)
  const [serverFilterOptions, setServerFilterOptions] = useState<{
    categories: string[];
    countries: string[];
    statesByCountry: Record<string, string[]>;
    citiesByLocation: Record<string, string[]>;
    industries: string[];
  }>({ categories: [], countries: [], statesByCountry: {}, citiesByLocation: {}, industries: [] });
  const [initialFilterOptionsSet, setInitialFilterOptionsSet] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadFilterOptions() {
      try {
        const res = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/filter-options`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          console.log('[CAMPAIGN BUILDER] Filter options from server:', data);
          console.log('[CAMPAIGN BUILDER] Industries received:', data.industries);
          
          const allIndustries = Array.from(new Set([
            ...(data.industries || []),
            ...(data.categories || []) // Use categories as fallback/supplement for industries
          ])).filter(Boolean).sort();

          setServerFilterOptions({
            categories: (data.categories || []).sort(),
            countries: (data.countries || []).sort(),
            statesByCountry: data.statesByCountry || {},
            citiesByLocation: data.citiesByLocation || {},
            industries: allIndustries
          });
          
          console.log('[CAMPAIGN BUILDER] Loaded filter options:', {
            categories: (data.categories || []).length,
            countries: (data.countries || []).length,
            states: Object.keys(data.statesByCountry || {}).length,
            cities: Object.keys(data.citiesByLocation || {}).length,
            industries: (data.industries || []).length
          });
        }
      } catch (err: any) {
        // Suppress abort errors (component unmounted or navigation)
        if (err?.name === 'AbortError' || err?.message?.includes('aborted') || controller.signal.aborted) return;
        console.error('[CAMPAIGN BUILDER] Failed to load filter options:', err);
      }
    }
    loadFilterOptions();
    return () => controller.abort();
  }, []);

  // Supplement server filter options with data from loaded leads if server data is incomplete
  useEffect(() => {
    console.log('[CAMPAIGN BUILDER SUPPLEMENT] Effect triggered:', {
      availableLeadsCount: availableLeads.length,
      serverIndustriesCount: serverFilterOptions.industries.length,
      initialFilterOptionsSet,
      sampleLeadIndustries: availableLeads.slice(0, 5).map(l => l.industry)
    });
    
    if (availableLeads.length === 0) {
      console.log('[CAMPAIGN BUILDER SUPPLEMENT] Skipping - no leads loaded yet');
      return;
    }
    
    // Only supplement industries if server didn't provide them
    if (serverFilterOptions.industries.length === 0 && !initialFilterOptionsSet) {
      console.log('[CAMPAIGN BUILDER SUPPLEMENT] Server has no industries, extracting from leads (using category field)...');
      
      const industries = Array.from(new Set(
        availableLeads
          .map(lead => lead.category || lead.industry) // Use category field primarily, fallback to industry
          .filter(industry => industry && industry.trim() !== '')
      )).sort();
      
      console.log('[CAMPAIGN BUILDER SUPPLEMENT] Extracted industries from category field:', industries.length, industries);
      
      if (industries.length > 0) {
        console.log('[CAMPAIGN BUILDER] Supplementing industries from loaded leads:', industries.length, industries);
        setServerFilterOptions(prev => ({ ...prev, industries }));
        setInitialFilterOptionsSet(true);
      } else {
        // No industries found - this is expected if leads don't have industry data populated
        console.log('[CAMPAIGN BUILDER SUPPLEMENT] No industries available (leads may not have category field populated)');
        setInitialFilterOptionsSet(true); // Still set flag to avoid infinite loop
      }
    } else {
      console.log('[CAMPAIGN BUILDER SUPPLEMENT] Skipping supplement:', {
        reason: serverFilterOptions.industries.length > 0 ? 'Server already has industries' : 'Already supplemented',
        serverIndustriesCount: serverFilterOptions.industries.length,
        alreadySet: initialFilterOptionsSet
      });
    }
  }, [availableLeads, initialFilterOptionsSet, serverFilterOptions.industries.length]);

  // Clear dependent filters when country/state selection changes (like CRM)
  useEffect(() => {
    // When countries are cleared, also clear states and cities
    if (selectedCountries.length === 0) {
      setSelectedStates([]);
      setSelectedCities([]);
    } else {
      // When countries change, clear any selected states that don't belong to the new countries
      const validStates = selectedCountries.flatMap(country => 
        serverFilterOptions.statesByCountry[country] || []
      );
      setSelectedStates(prev => prev.filter(state => validStates.includes(state)));
      
      // Also clear cities if they're not valid for the current country/state selection
      setSelectedCities(prev => {
        if (prev.length === 0) return prev;
        const validCities = new Set<string>();
        for (const country of selectedCountries) {
          if (selectedStates.length > 0) {
            for (const state of selectedStates) {
              const key = `${country}|${state}`;
              const cities = serverFilterOptions.citiesByLocation[key] || [];
              cities.forEach(c => validCities.add(c));
            }
            const countryCities = serverFilterOptions.citiesByLocation[country] || [];
            countryCities.forEach(c => validCities.add(c));
          } else {
            const countryCities = serverFilterOptions.citiesByLocation[country] || [];
            countryCities.forEach(c => validCities.add(c));
          }
        }
        return prev.filter(city => validCities.has(city));
      });
    }
  }, [selectedCountries, serverFilterOptions.statesByCountry, serverFilterOptions.citiesByLocation]);

  // Clear cities when states change
  useEffect(() => {
    if (selectedStates.length === 0 && selectedCountries.length > 0) {
      // States cleared but countries still selected - validate cities for countries only
      setSelectedCities(prev => {
        if (prev.length === 0) return prev;
        const validCities = new Set<string>();
        for (const country of selectedCountries) {
          const countryCities = serverFilterOptions.citiesByLocation[country] || [];
          countryCities.forEach(c => validCities.add(c));
        }
        return prev.filter(city => validCities.has(city));
      });
    }
  }, [selectedStates, selectedCountries, serverFilterOptions.citiesByLocation]);

  // Use server filter options with hierarchical structure (like CRM)
  const uniqueCountries = useMemo(() => {
    return serverFilterOptions.countries.filter(c => {
      if (!c || c.trim() === '') return false;
      if (/^-?\d+\.\d+/.test(c)) return false;
      if (c.includes(',')) return false;
      if (c.length > 50) return false;
      if (!isCountryName(c)) return false;
      return true;
    });
  }, [serverFilterOptions.countries]);

  const uniqueStates = useMemo(() => {
    if (selectedCountries.length === 0) return [];
    // Get states for all selected countries
    const states = new Set<string>();
    for (const country of selectedCountries) {
      const countryStates = serverFilterOptions.statesByCountry[country] || [];
      countryStates.forEach(s => {
        // Filter out invalid state values (same as CRM)
        if (!s || s.trim() === '') return;
        if (/^-?\d+\.\d+/.test(s)) return; // Coordinates
        if (s.includes(',') || /^\d/.test(s)) return; // Addresses or numbers
        if (s.length > 50) return; // Too long
        if (isCountryName(s)) return; // Country name in state field
        if (!isValidStateForCountry(s, country)) return; // Not a valid state for this country
        states.add(s);
      });
    }
    return Array.from(states).sort();
  }, [serverFilterOptions.statesByCountry, selectedCountries]);

  const uniqueCities = useMemo(() => {
    if (selectedCountries.length === 0) return [];
    const cities = new Set<string>();
    
    for (const country of selectedCountries) {
      // If states are selected, get cities for each country+state combination
      if (selectedStates.length > 0) {
        for (const state of selectedStates) {
          const key = `${country}|${state}`;
          const stateCities = serverFilterOptions.citiesByLocation[key] || [];
          stateCities.forEach(c => {
            if (!c || c.trim() === '') return;
            if (/^-?\d+\.\d+/.test(c)) return;
            if (/^\d+\s+/.test(c)) return;
            if (c.split(',').length > 2) return;
            if (c.length > 40) return;
            cities.add(c);
          });
        }
        // Fallback: also include cities with just country key
        const countryCities = serverFilterOptions.citiesByLocation[country] || [];
        countryCities.forEach(c => {
          if (!c || c.trim() === '') return;
          if (/^-?\d+\.\d+/.test(c)) return;
          if (/^\d+\s+/.test(c)) return;
          if (c.split(',').length > 2) return;
          if (c.length > 40) return;
          cities.add(c);
        });
      } else {
        // No states selected, get all cities for the country
        const countryCities = serverFilterOptions.citiesByLocation[country] || [];
        countryCities.forEach(c => {
          if (!c || c.trim() === '') return;
          if (/^-?\d+\.\d+/.test(c)) return;
          if (/^\d+\s+/.test(c)) return;
          if (c.split(',').length > 2) return;
          if (c.length > 40) return;
          cities.add(c);
        });
      }
    }
    return Array.from(cities).sort();
  }, [serverFilterOptions.citiesByLocation, selectedCountries, selectedStates]);

  const uniqueIndustries = useMemo(() => {
    const serverIndustries = serverFilterOptions.industries.filter(i => i && i.trim() !== '');
    const combined = Array.from(new Set([...serverIndustries, ...STANDARD_INDUSTRIES])).sort();
    console.log('[CAMPAIGN BUILDER] uniqueIndustries computed:', combined.length, combined);
    return combined;
  }, [serverFilterOptions.industries]);

  // Count maps use loaded leads (approximate, for display only)
  const cityCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of availableLeads) {
      if (lead.city) map.set(lead.city, (map.get(lead.city) || 0) + 1);
    }
    return map;
  }, [availableLeads]);

  const stateCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of availableLeads) {
      if (lead.state) map.set(lead.state, (map.get(lead.state) || 0) + 1);
    }
    return map;
  }, [availableLeads]);

  const countryCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of availableLeads) {
      if (lead.country) map.set(lead.country, (map.get(lead.country) || 0) + 1);
    }
    return map;
  }, [availableLeads]);

  const industryCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of availableLeads) {
      if (lead.industry) map.set(lead.industry, (map.get(lead.industry) || 0) + 1);
    }
    return map;
  }, [availableLeads]);

  // Select all filtered leads — uses server-side all-ids endpoint for full dataset
  async function selectAllFilteredLeads() {
    // ── Local path: all data already loaded ──
    // Use REPLACE (not merge) so clicking always gives a predictable, visible result.
    // Previously used merge which silently appeared to do nothing if those IDs were
    // already selected, and had no toast to confirm success.
    if (!hasMoreLeads && filteredLeads.length > 0) {
      const filteredLeadIds = filteredLeads.map(lead => lead.id);
      setSelectedLeads(filteredLeadIds);
      toast.success(t('campaignBuilder.selectedCount', { count: filteredLeadIds.length.toLocaleString() }));
      return;
    }

    if (!hasMoreLeads && filteredLeads.length === 0) {
      toast.info('No leads match your current filters');
      return;
    }

    // ── Server path: leads span multiple pages ──
    setSelectingAll(true);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      // Match the exact filter params used by the display query so IDs align with what's shown
      params.set('has_email', 'true');
      params.set('exclude_bounced', 'true');
      if (searchQuery) params.set('search', searchQuery);
      if (selectedCities.length > 0) params.set('city', selectedCities.join('|'));
      if (selectedStates.length > 0) params.set('state', selectedStates.join('|'));
      if (selectedCountries.length > 0) params.set('country', selectedCountries.join('|'));
      if (selectedIndustries.length > 0) params.set('industry', selectedIndustries.join('|'));
      if (showOnlyUncontacted) params.set('contacted', 'no');
      else params.set('contacted', 'all');
      const url = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/all-ids?${params.toString()}`;
      const res = await authenticatedFetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) {
        // Non-2xx — throw so catch block handles with local fallback
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      const allIds: string[] = data.ids || [];
      if (allIds.length === 0) {
        toast.info('No leads match your current filters');
        return;
      }
      setSelectedLeads(allIds); // REPLACE for predictable UX
      toast.success(t('campaignBuilder.selectedCount', { count: allIds.length.toLocaleString() }));
    } catch (err) {
      console.error('[CAMPAIGN BUILDER] Error selecting all:', err);
      // Fallback: use whatever is currently loaded locally
      const localIds = filteredLeads.map(lead => lead.id);
      if (localIds.length > 0) {
        setSelectedLeads(localIds);
        toast.success(t('campaignBuilder.selectedCount', { count: localIds.length.toLocaleString() }));
      } else {
        toast.error(t('campaignBuilder.failedToSelectAll'));
      }
    } finally {
      setSelectingAll(false);
    }
  }

  function selectBulk(count: number) {
    const leadsToSelect = filteredLeads.slice(0, count).map(lead => lead.id);
    setSelectedLeads(leadsToSelect);
  }

  // ─── Audience Builder v2 helpers ────────────────────────────────────
  // applyAudienceSample applies the current (sampleSize, sampleMode) to
  // filteredLeads and updates selectedLeads. Used by the new size-control
  // chips and by smart presets.
  const applyAudienceSample = useCallback((size: number | null, mode: 'first' | 'random' | 'top_score') => {
    // filteredLeads already has engagement filter applied. Just need
    // to handle ordering + slicing here.
    let pool = filteredLeads;
    if (mode === 'top_score') {
      pool = [...pool].sort((a, b) => (b.lead_score || b.score || 0) - (a.lead_score || a.score || 0));
    } else if (mode === 'random') {
      pool = shuffle([...pool]);
    }
    const sliced = size == null ? pool : pool.slice(0, size);
    setSelectedLeads(sliced.map(l => l.id));
    setSampleSize(size);
    setSampleMode(mode);
  }, [filteredLeads]);

  // Smart presets — one-click filter+sample combos. Each preset:
  //  (a) clears existing engagement + advanced filters that conflict
  //  (b) sets the engagement states it cares about
  //  (c) optionally caps the audience size to a sensible default
  const applyPreset = useCallback((presetId: string) => {
    setActivePreset(presetId);
    switch (presetId) {
      case 'never_contacted': {
        setEngagementStates(['never_contacted']);
        setShowOnlyUncontacted(true);
        break;
      }
      case 'hot_prospects': {
        // Anyone who opened/clicked recently. Re-engagement candidates.
        setEngagementStates(['opened', 'clicked']);
        setShowOnlyUncontacted(false);
        break;
      }
      case 're_engage': {
        // Contacted before, never replied. Filter applied via engagement
        // state filtering at the lead level (see matchesEngagement).
        setEngagementStates(['opened', 'clicked']);  // soft signal of past interest
        setShowOnlyUncontacted(false);
        break;
      }
      case 'recent_visitors': {
        // Will work once we plumb intent visit data; for now select
        // leads flagged with site_visit_recent.
        setEngagementStates([]);
        setShowOnlyUncontacted(false);
        break;
      }
      case 'high_score': {
        setEngagementStates([]);
        setSampleMode('top_score');
        break;
      }
      case 'clear':
      default:
        setActivePreset(null);
        setEngagementStates([]);
        setShowOnlyUncontacted(false);
        return;
    }
  }, []);

  // Estimate how long this campaign will take to complete at the user's
  // configured daily cap. Pure UI — not authoritative. Shows in the
  // live summary banner so users know "47 leads = 12 min" before they
  // hit send.
  const audienceEstimate = useMemo(() => {
    const n = selectedLeads.length;
    if (n === 0) return null;
    // Default cap aligns with our rate-limit defaults; could plumb the
    // user's actual setting through later.
    const dailyCap = 250;
    const perEmailCostCents = 2; // rough — covers send + AI gen
    const minutesPerEmail = (60 / dailyCap) * 24 * 60 / 60; // = (24*60)/dailyCap
    const totalMinutes = Math.ceil(n * minutesPerEmail);
    const minutesPerCap = (24 * 60) / dailyCap;
    const estMinutes = Math.max(1, Math.ceil(n * minutesPerCap));
    const cost = (n * perEmailCostCents) / 100;
    return {
      count: n,
      timeText: estMinutes < 60
        ? `~${estMinutes} min at ${dailyCap}/day`
        : estMinutes < 24 * 60
          ? `~${Math.ceil(estMinutes / 60)} h at ${dailyCap}/day`
          : `~${Math.ceil(estMinutes / (24 * 60))} days at ${dailyCap}/day`,
      costText: `~$${cost.toFixed(2)} est`,
    };
  }, [selectedLeads.length]);

  // ─── Phase 2: load saved segments + active-campaign lead IDs ───────
  // Both fire once on mount of the leads step (cheap KV scans).
  // activeCampaignLeadIds stays null until the user toggles the
  // exclusion option, but we eagerly fetch so the toggle responds
  // instantly when clicked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/segments`);
        if (r.ok && !cancelled) {
          const j = await r.json();
          setSavedSegments(Array.isArray(j.segments) ? j.segments : []);
        }
      } catch { /* non-fatal */ }
      try {
        const r = await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/active-lead-ids`);
        if (r.ok && !cancelled) {
          const j = await r.json();
          if (Array.isArray(j.lead_ids)) setActiveCampaignLeadIds(new Set(j.lead_ids));
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Save the current filter snapshot as a segment. Prompts for a name
  // via window.prompt (deliberately simple — a richer dialog is Phase 3
  // polish). The snapshot captures every Phase 1 + Phase 2 filter so
  // reloading restores the audience exactly.
  const saveCurrentAsSegment = useCallback(async () => {
    const name = (typeof window !== 'undefined' && window.prompt('Name this segment:', '') || '').trim();
    if (!name) return;
    setSavingSegment(true);
    try {
      const filters = {
        searchQuery,
        selectedCities, selectedStates, selectedCountries, selectedIndustries,
        engagementStates, scoreRange, addedWithinDays, lastContactedRange,
        excludeActiveCampaigns, sampleSize, sampleMode,
      };
      const r = await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'save failed');
      // Replace or append in local list
      setSavedSegments(prev => {
        const without = prev.filter(s => s.id !== j.segment.id);
        return [j.segment, ...without];
      });
      setActiveSegmentId(j.segment.id);
      toast.success(`Saved segment "${name}"`);
    } catch (err: any) {
      toast.error('Could not save segment', { description: err.message });
    } finally {
      setSavingSegment(false);
    }
  }, [searchQuery, selectedCities, selectedStates, selectedCountries, selectedIndustries,
      engagementStates, scoreRange, addedWithinDays, lastContactedRange,
      excludeActiveCampaigns, sampleSize, sampleMode]);

  // Apply a saved segment's filters to the current state. We DON'T
  // restore selectedLeads (which would be stale anyway) — only the
  // filter shape. The user re-picks the sample size after loading.
  const loadSegment = useCallback((seg: SavedSegment) => {
    const f = seg.filters || {};
    setSearchQuery(f.searchQuery || '');
    setSelectedCities(Array.isArray(f.selectedCities) ? f.selectedCities : []);
    setSelectedStates(Array.isArray(f.selectedStates) ? f.selectedStates : []);
    setSelectedCountries(Array.isArray(f.selectedCountries) ? f.selectedCountries : []);
    setSelectedIndustries(Array.isArray(f.selectedIndustries) ? f.selectedIndustries : []);
    setEngagementStates(Array.isArray(f.engagementStates) ? f.engagementStates : []);
    setScoreRange(Array.isArray(f.scoreRange) && f.scoreRange.length === 2 ? f.scoreRange : null);
    setAddedWithinDays(typeof f.addedWithinDays === 'number' ? f.addedWithinDays : null);
    setLastContactedRange(f.lastContactedRange && typeof f.lastContactedRange === 'object' ? f.lastContactedRange : null);
    setExcludeActiveCampaigns(!!f.excludeActiveCampaigns);
    setSampleMode(f.sampleMode === 'random' || f.sampleMode === 'top_score' ? f.sampleMode : 'first');
    setActiveSegmentId(seg.id);
    setShowSegmentMenu(false);
    toast.success(`Loaded segment "${seg.name}"`);
  }, []);

  const deleteSegment = useCallback(async (seg: SavedSegment) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete segment "${seg.name}"?`)) return;
    try {
      await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/segments/${seg.id}`, { method: 'DELETE' });
      setSavedSegments(prev => prev.filter(s => s.id !== seg.id));
      if (activeSegmentId === seg.id) setActiveSegmentId(null);
      toast.success(`Deleted segment`);
    } catch (err: any) {
      toast.error('Could not delete', { description: err.message });
    }
  }, [activeSegmentId]);

  // Select all leads from current city selection
  function selectByCurrentCities() {
    if (selectedCities.length === 0) return;
    const cityLeadIds = availableLeads
      .filter(lead => selectedCities.includes(lead.city))
      .map(lead => lead.id);
    setSelectedLeads(prev => {
      const newSelection = [...new Set([...prev, ...cityLeadIds])];
      return newSelection;
    });
  }



  // Helper function to detect if a lead is EARLY-STAGE SaaS/TECH investor (angels, pre-seed, seed only)
  function isInvestorLead(lead: any): boolean {
    const searchText = `${lead.business_name || ''} ${lead.category || ''} ${lead.description || ''}`.toLowerCase();
    
    // EXCLUDE later-stage VCs and growth firms (NOT our target!)
    const excludeKeywords = [
      'series a', 'series b', 'series c', 'series d',
      'growth equity', 'growth stage', 'late stage', 'later stage',
      'private equity', 'pe firm', 'buyout', 'lbo',
      'expansion capital', 'mezzanine', 'bridge',
      'institutional investor', 'corporate venture',
      'venture debt', 'debt financing', 'debt fund',
      'secondary', 'public equity'
    ];
    
    // EXCLUDE non-tech/non-SaaS focused investors (NOT our target!)
    const excludeIndustryKeywords = [
      'biotech', 'pharmaceutical', 'pharma', 'life science',
      'healthcare only', 'medtech only', 'medical device',
      'real estate', 'property', 'commercial real estate',
      'retail only', 'consumer goods', 'cpg only',
      'hardware only', 'manufacturing only',
      'energy', 'oil', 'gas', 'mining',
      'agriculture', 'agtech only', 'food production'
    ];
    
    // If any exclude keyword is found, this is NOT our target investor
    const hasExcludedKeyword = excludeKeywords.some(keyword => searchText.includes(keyword));
    const hasExcludedIndustry = excludeIndustryKeywords.some(keyword => searchText.includes(keyword));
    if (hasExcludedKeyword || hasExcludedIndustry) {
      return false;
    }
    
    // REQUIRE: Must be early-stage (angel, pre-seed, seed)
    const stageKeywords = [
      // Angel investors
      'angel investor', 'angel network', 'angel group', 'angel fund',
      'super angel', 'micro vc', 'micro fund', 'micro-vc',
      
      // Pre-seed and Seed VCs
      'pre-seed', 'preseed', 'pre seed',
      'seed fund', 'seed stage', 'seed investor', 'seed capital',
      'early stage vc', 'early-stage vc', 'early stage venture',
      'seed vc', 'seed venture', 'seed-stage',
      
      // Family offices (must include "early" or "startup" to qualify)
      'family office early', 'family office startup', 'family office seed',
      'family office angel', 'family investment office',
      
      // Accelerators and incubators that invest
      'accelerator', 'incubator', 'startup studio',
      'venture builder', 'venture lab',
      
      // General early-stage specific terms
      'startup investor', 'startup fund',
      'early stage investor', 'early-stage investor',
      'pre-revenue investor', 'bootstrap investor',
      '0 to 1 investor', 'idea stage', 'founder investor'
    ];
    
    // REQUIRE: Must focus on SaaS/Software/Tech (Roadr and Sourcr are SaaS products)
    const techFocusKeywords = [
      // SaaS specific
      'saas', 'software as a service', 'b2b saas', 'b2c saas',
      'subscription software', 'cloud software',
      
      // Software/Tech general
      'software', 'technology', 'tech', 'internet',
      'digital', 'mobile app', 'web app', 'platform',
      
      // Tech verticals
      'fintech', 'edtech', 'proptech', 'insurtech',
      'martech', 'adtech', 'hrtech', 'legaltech',
      
      // B2B Tech
      'b2b software', 'b2b tech', 'enterprise software',
      'business software', 'productivity software',
      
      // Developer tools
      'dev tools', 'developer tools', 'api', 'infrastructure',
      
      // General tech investing terms
      'tech startups', 'software startups', 'tech companies',
      'internet companies', 'digital products'
    ];
    
    // Must match BOTH: early-stage AND tech/SaaS focus
    const hasStageMatch = stageKeywords.some(keyword => searchText.includes(keyword));
    const hasTechFocus = techFocusKeywords.some(keyword => searchText.includes(keyword));
    
    return hasStageMatch && hasTechFocus;
  }

  // Performance: memoized investor leads
  const investorLeads = useMemo(() => {
    return availableLeads.filter(lead => isInvestorLead(lead) && !lead.contacted);
  }, [availableLeads]);

  // Auto-select investor leads
  function selectInvestorLeads() {
    const investorLeadIds = investorLeads.map(lead => lead.id);
    setSelectedLeads(investorLeadIds);
    setShowInvestorSuggestion(false);
  }

  function toggleGroupSelection(groupId: string) {
    const isCurrentlySelected = selectedGroups.includes(groupId);
    
    setSelectedGroups(prev =>
      isCurrentlySelected
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );

    // Auto-select/deselect all leads in this group
    if (isCurrentlySelected) {
      // Deselecting group - remove its leads
      removeLeadsFromGroup(groupId);
    } else {
      // Selecting group - add its leads
      addLeadsFromGroup(groupId);
    }
  }

  async function addLeadsFromGroup(groupId: string) {
    setLoadingGroupLeads(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups/${groupId}/leads`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        const leadIds = data.leads?.map((lead: any) => lead.id) || [];
        
        // Add these leads to selectedLeads (avoiding duplicates)
        setSelectedLeads(prev => {
          const set = new Set(prev);
          leadIds.forEach((id: string) => set.add(id));
          return Array.from(set);
        });
      }
    } catch (error) {
      console.error('Error loading group leads:', error);
    } finally {
      setLoadingGroupLeads(false);
    }
  }

  async function removeLeadsFromGroup(groupId: string) {
    setLoadingGroupLeads(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups/${groupId}/leads`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        const leadIds = data.leads?.map((lead: any) => lead.id) || [];
        
        // Remove these leads from selectedLeads
        setSelectedLeads(prev => {
          const removeSet = new Set(leadIds);
          return prev.filter(id => !removeSet.has(id));
        });
      }
    } catch (error) {
      console.error('Error loading group leads:', error);
    } finally {
      setLoadingGroupLeads(false);
    }
  }

  function selectAllGroups() {
    // Select all groups
    const allGroupIds = groups.map(group => group.id);
    setSelectedGroups(allGroupIds);
    
    // Load and select all leads from all groups
    allGroupIds.forEach(groupId => addLeadsFromGroup(groupId));
  }

  function deselectAllGroups() {
    // Get all group IDs that are currently selected
    const currentlySelectedGroups = [...selectedGroups];
    
    // Clear groups
    setSelectedGroups([]);
    
    // Remove leads from all previously selected groups
    currentlySelectedGroups.forEach(groupId => removeLeadsFromGroup(groupId));
  }

  async function generatePreview() {
    setLoading(true);
    try {
      // Get a sample lead for preview — use the first SELECTED lead, not just the first available
      const sampleLead = availableLeads.find(l => selectedLeadSet.has(l.id)) || availableLeads[0] || {
        business_name: t('campaignBuilder.sampleBusiness'),
        category: 'Auto Repair',
        city: 'Miami',
      };
      setPreviewLeadName(sampleLead.business_name || sampleLead.contact_name || t('campaignBuilder.sampleLead'));

      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/generate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            lead: sampleLead,
            product: campaign.customProductName || campaign.product,
            tone: campaign.tone,
            landing_url: campaign.landingUrl,
            price_summary: campaign.value,
            sequence_number: 1,
            sender_name: campaign.senderName,
            sender_title: campaign.senderTitle,
            campaign_knowledge: campaign.campaignKnowledge,
            brand: campaign.brand,
            from_email: campaign.fromEmail,
            custom_instructions: campaign.customInstructions,
            example_email: campaign.exampleEmail,
            max_words: campaign.maxWords,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.details ? ` — ${errorData.details}` : '';
        throw new Error((errorData.error || `Server error ${response.status}`) + detail);
      }

      const data = await response.json();
      setPreviewEmail({
        subject: data.email.subject,
        preview: data.email.preview,
        body: data.email.html_body, // Use HTML body for proper line break rendering
      });
      setStep('preview');
    } catch (error: any) {
      console.error('Error generating preview:', error);
      alert(t('campaignBuilder.errorGeneratingPreview', { message: error.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleAttachmentUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB per file (base64 adds ~33% overhead)
    const MAX_TOTAL = 20 * 1024 * 1024; // 20MB total
    const MAX_COUNT = 5;

    const currentTotalSize = attachments.reduce((sum, a) => sum + a.size, 0);

    for (const file of Array.from(files)) {
      if (attachments.length >= MAX_COUNT) {
        toast.error(t('campaignBuilder.maxAttachmentsAllowed', { count: MAX_COUNT }));
        break;
      }
      if (file.size > MAX_SIZE) {
        toast.error(t('campaignBuilder.exceedsFileLimit', { name: file.name }));
        continue;
      }
      if (currentTotalSize + file.size > MAX_TOTAL) {
        toast.error(t('campaignBuilder.totalSizeExceeds'));
        break;
      }

      setUploadingAttachment(true);
      try {
        const headers = await getValidatedAuthHeaders();

        // Read file as base64 to avoid FormData/multipart issues in edge functions
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Strip the data:...;base64, prefix
            const b64 = result.split(',')[1] || result;
            resolve(b64);
          };
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/upload-attachment`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              filename: file.name,
              base64,
              type: file.type,
              size: file.size,
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Upload failed (${res.status})`);
        }

        const data = await res.json();
        if (data.success && data.attachment) {
          setAttachments(prev => [...prev, data.attachment]);
          toast.success(t('campaignBuilder.attached', { name: file.name }));
        }
      } catch (err: any) {
        console.error('[CAMPAIGN] Attachment upload error:', err);
        toast.error(t('campaignBuilder.failedUpload', { name: file.name, error: err.message }));
      } finally {
        setUploadingAttachment(false);
      }
    }

    // Reset input
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  async function removeAttachment(att: CampaignAttachment) {
    try {
      const headers = await getValidatedAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/attachment`,
        {
          method: 'DELETE',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: att.storagePath }),
        }
      );
    } catch (err) {
      console.error('[CAMPAIGN] Failed to delete attachment from storage:', err);
    }
    setAttachments(prev => prev.filter(a => a.id !== att.id));
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(type: string): string {
    if (type.includes('pdf')) return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return '📊';
    if (type.includes('presentation') || type.includes('powerpoint')) return '📑';
    if (type.startsWith('image/')) return '🖼️';
    if (type.includes('zip')) return '📦';
    return '📎';
  }

  async function createCampaign() {
    setLoading(true);
    // Track the campaign ID for rollback if a later step (lead-add) fails.
    // Without rollback, a failed lead-add leaves an empty "ghost" campaign in
    // the user's list with 0 leads and 0 sent — confusing and looks broken.
    let createdCampaignIdForRollback: string | null = null;
    try {
      console.log('🚀 CREATING CAMPAIGN with product:', campaign.customProductName || campaign.product, 'brand:', campaign.brand);
      console.log('[CAMPAIGN] sendImmediately:', sendImmediately, 'scheduleValue:', scheduleValue);
      
      // ── Demo Mode: Skip API calls ──
      if (isDemoMode) {
        console.log('[CAMPAIGN DEMO] Simulating campaign creation');
        await new Promise(r => setTimeout(r, 1000));
        toast.success(t('campaignBuilder.campaignCreatedDemo'));
        setLoading(false);
        broadcast({ type: 'CAMPAIGN_CREATED', campaign_id: 'demo-campaign' });
        if (onClose) onClose();
        return;
      }
      
      // Get auth headers and validate
      const headers = await getValidatedAuthHeaders();
      
      // Determine campaign status and scheduled time
      const isScheduled = scheduleValue.mode === 'scheduled';
      const status = isScheduled ? 'scheduled' : 'draft';
      const scheduled_time = isScheduled && scheduleValue.scheduledDate 
        ? scheduleValue.scheduledDate.toISOString() 
        : undefined;
      
      console.log('[CAMPAIGN] Status:', status, 'Scheduled time:', scheduled_time);
      
      // Create campaign
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: campaign.name,
            product: campaign.customProductName || campaign.product, // Use custom name if provided
            brand: campaign.brand,
            price_summary: campaign.value,
            landing_url: campaign.landingUrl,
            tone: campaign.tone,
            from_email: campaign.fromEmail,
            sender_name: campaign.senderName,
            sender_title: campaign.senderTitle,
            campaign_knowledge: campaign.campaignKnowledge || '',
            custom_instructions: campaign.customInstructions || '',
            example_email: campaign.exampleEmail || '',
            max_words: campaign.maxWords || 75,
            cc: campaign.cc.trim() ? campaign.cc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
            bcc: campaign.bcc.trim() ? campaign.bcc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
            status,
            scheduled_time,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        
        // Check if it's a missing column error (check both details and message)
        const errorString = JSON.stringify(errorData).toLowerCase();
        if (errorString.includes('sender_name') || errorString.includes('sender_title') || errorString.includes('schema cache')) {
          setShowMigrationNotice(true);
          setLoading(false);
          return;
        }
        
        throw new Error(errorData.error || 'Failed to create campaign');
      }

      const data = await response.json();
      const campaignId = data.campaign.id;
      createdCampaignIdForRollback = campaignId;
      console.log('[CAMPAIGN] Campaign created:', campaignId);
      // NOTE: setCreatedCampaignId moved below — only shown after leads are confirmed added

      // Filter out bounced leads AND leads without emails to prevent wasting credits
      const validLeads = availableLeads
        .filter(lead => {
          if (!selectedLeadSet.has(lead.id)) return false;
          if (lead.bounced) return false;
          // CRITICAL: Only include leads with valid email addresses
          if (!lead.email?.trim()) return false;
          return true;
        })
        .map(lead => lead.id);
      
      const bouncedCount = availableLeads.filter(lead => selectedLeadSet.has(lead.id) && lead.bounced).length;
      const noEmailCount = availableLeads.filter(lead => selectedLeadSet.has(lead.id) && !lead.email?.trim()).length;
      const excludedCount = selectedLeads.length - validLeads.length;
      
      if (excludedCount > 0) {
        console.log(`[CAMPAIGN] Excluded ${excludedCount} invalid leads: ${bouncedCount} bounced, ${noEmailCount} without email`);
        if (noEmailCount > 0) {
          toast.error(t('campaignBuilder.noEmailExcluded', { count: noEmailCount }), { duration: 4000 });
        }
      }
      
      // Prevent campaign send if no valid leads remain
      if (validLeads.length === 0) {
        toast.error(t('campaignBuilder.noValidLeadsError'));
        setLoading(false);
        return;
      }
      
      console.log('[CAMPAIGN] Valid leads to add:', validLeads.length);

      // Add selected leads to campaign — MUST succeed before sending
      let leadsAdded = false;
      if (validLeads.length > 0) {
        const addHeaders = await getValidatedAuthHeaders();
        const addLeadsResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/leads`,
          {
            method: 'POST',
            headers: addHeaders,
            body: JSON.stringify({
              lead_ids: validLeads,
            }),
          }
        );

        if (!addLeadsResponse.ok) {
          const errorBody = await addLeadsResponse.json().catch(() => ({}));
          console.error('[CAMPAIGN] Failed to add leads to campaign:', errorBody);
          throw new Error(`Failed to add leads to campaign: ${errorBody.error || 'Unknown error'}`);
        }
        const addResult = await addLeadsResponse.json();
        console.log('[CAMPAIGN] Leads added successfully:', addResult.total_leads);
        leadsAdded = true;
      }

      // Show "Campaign Launched" only AFTER leads are successfully added.
      // From this point onward, the campaign is real — clear the rollback
      // flag so a later non-fatal failure (groups, broadcast) doesn't delete it.
      createdCampaignIdForRollback = null;
      setCreatedCampaignId(campaignId);

      // Add selected groups to campaign
      if (selectedGroups.length > 0) {
        const groupHeaders = await getValidatedAuthHeaders();
        const addGroupsResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/groups`,
          {
            method: 'POST',
            headers: groupHeaders,
            body: JSON.stringify({
              group_ids: selectedGroups,
            }),
          }
        );

        if (!addGroupsResponse.ok) {
          console.error('[CAMPAIGN] Failed to add groups to campaign');
        } else {
          console.log('[CAMPAIGN] Groups added successfully');
        }
      }

      // Automatically send emails if the user wants that — trigger global broadcast
      if (sendImmediately && leadsAdded) {
        console.log('[CAMPAIGN] Triggering broadcast for campaign:', campaignId, 'leads:', validLeads.length);
        
        // Trigger the global broadcast overlay (runs in background)
        broadcast.startBroadcast({
          campaignId,
          campaignName: campaign.name || t('campaignBuilder.untitledCampaign'),
          total: validLeads.length,
        });
      } else if (sendImmediately && !leadsAdded) {
        console.warn('[CAMPAIGN] sendImmediately is true but no leads were added to campaign — skipping send');
      } else {
        console.log(`[CAMPAIGN] Campaign saved as draft. sendImmediately=${sendImmediately}, leadsAdded=${leadsAdded}`);
      }

      // ── Invalidate related caches so other views pick up the new campaign ──
      apiCache.invalidate('campaigns:*');  // CampaignsView list
      apiCache.invalidate('crm:*');        // CRM leads (email_sent flags may change)
      apiCache.invalidate('dashboard:*');  // Dashboard summary counts
      apiCache.invalidate('analytics:*');  // Analytics overview
      console.log('[CAMPAIGN] Cache invalidated after campaign creation');
      realtimeManager.emit('campaign:created', { campaignName: campaign.name || 'New Campaign' });
      dispatchAppEvent({ type: 'campaigns:changed', meta: { action: 'created' } });

      // Close immediately so user can keep working while broadcast shows progress
      onClose?.();

    } catch (error: any) {
      console.error('Error creating campaign:', error);

      // Roll back the orphaned campaign so the user doesn't see a "ghost"
      // entry with 0 leads in their list. Best-effort — failure to delete is
      // logged but doesn't change the user-facing error.
      if (createdCampaignIdForRollback) {
        try {
          const rollbackHeaders = await getAuthHeaders();
          await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${createdCampaignIdForRollback}`,
            { method: 'DELETE', headers: rollbackHeaders },
          );
          console.log('[CAMPAIGN] Rolled back orphaned campaign:', createdCampaignIdForRollback);
        } catch (rollbackErr) {
          console.error('[CAMPAIGN] Rollback delete failed (orphan left in DB):', rollbackErr);
        }
      }

      // Provide more specific error messages
      let errorMessage = error.message;
      if (error.message === 'Failed to fetch') {
        errorMessage = t('campaignBuilder.networkError');
      } else if (error.message.includes('Not authenticated')) {
        errorMessage = t('campaignBuilder.sessionExpired');
      }

      toast.error(t('campaignBuilder.errorCreatingCampaign', { message: errorMessage }), { duration: 8000 });
    } finally {
      setLoading(false);
    }
  }

  async function sendTestEmail() {
    setSendingTestEmail(true);
    setTestEmailSent(false);
    try {
      const headers = await getAuthHeaders();
      
      // Create a test lead object with custom email
      const testLead = {
        business_name: 'Test Business',
        category: 'Auto Repair',
        city: 'Miami',
        email: testEmailAddress,
      };

      // Send test email
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/send-test`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            to_email: testEmailAddress,
            to_name: 'Test Recipient',
            subject: previewEmail?.subject,
            text_body: previewEmail?.body,
            preview_text: previewEmail?.preview,
            from_email: campaign.fromEmail,
            from_name: campaign.senderName,
            brand: campaign.brand,
            lead: testLead,
            cc: campaign.cc.trim() ? campaign.cc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
            bcc: campaign.bcc.trim() ? campaign.bcc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
          }),
        }
      );

      if (!response.ok) {
        const responseText = await response.text();
        console.error('Test email send failed (raw response):', responseText);
        
        // Try to parse as JSON
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch (e) {
          // Not JSON, use the text directly
          throw new Error(`Server error: ${responseText.substring(0, 200)}`);
        }
        
        throw new Error(errorData.error || 'Failed to send test email');
      }

      const result = await response.json();
      console.log('Test email response:', result);
      
      // Check if there was a database warning
      if (result.warning) {
        console.warn('Test email sent but database issue:', result.db_error);
        alert(t('campaignBuilder.testEmailDbWarning', { email: testEmailAddress, error: result.db_error }));
      } else {
        console.log(`Test email saved to database with ID: ${result.email_id}`);
      }

      setTestEmailSent(true);
      
      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setTestEmailSent(false);
      }, 5000);

    } catch (error: any) {
      console.error('Error sending test email:', error);
      alert(t('campaignBuilder.errorSendingTestEmail', { message: error.message }));
    } finally {
      setSendingTestEmail(false);
    }
  }

  const stepIndex = step === 'details' ? 0 : step === 'leads' ? 1 : 2;
  const stepLabels = [t('campaignBuilder.campaignDetails'), t('campaignBuilder.selectLeads'), t('campaignBuilder.previewAndSend')];
  const stepIcons = [Sparkles, Users, Send];

  if (createdCampaignId) {
    return (
      <div className="p-8 sm:p-10 text-center">
        <div className="relative mx-auto mb-6 w-20 h-20">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-zinc-200/40 to-zinc-300/40 dark:from-white/10 dark:to-white/5 animate-pulse" />
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center border border-zinc-200 dark:border-white/10">
            {sendImmediately 
              ? <CheckCircle2 className="w-9 h-9 text-[#1ED4A7]" />
              : <Calendar className="w-8 h-8 text-zinc-900 dark:text-white" />
            }
          </div>
        </div>
        <h2 className="text-[24px] font-bold mb-2 text-zinc-900 dark:text-white tracking-tight">
          {sendImmediately ? t('campaignBuilder.campaignLaunched') : t('campaignBuilder.campaignScheduled')}
        </h2>
        <p className="text-zinc-500 dark:text-zinc-400 text-[14px] mb-1 max-w-sm mx-auto leading-relaxed">
          {sendImmediately 
            ? t('campaignBuilder.emailsBeingSent', { count: selectedLeads.length })
            : t('campaignBuilder.emailsScheduledFor', { count: selectedLeads.length, date: scheduleValue.scheduledDate?.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) ?? '' })
          }
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 pb-5 pt-8 sm:p-8 relative flex flex-col min-h-full">
      {/* Mobile drag indicator */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-zinc-200 dark:bg-white/10 rounded-full sm:hidden" />

      {/* Migration Notice Modal */}
      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setShowMigrationNotice(false)} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="min-w-0 pr-4">
          <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight text-zinc-900 dark:text-white">
            {step === 'details' && t('campaignBuilder.newCampaign')}
            {step === 'leads' && t('campaignBuilder.selectAudienceStep')}
            {step === 'preview' && t('campaignBuilder.reviewAndLaunch')}
          </h2>
          <p className="text-zinc-500 dark:text-zinc-400 text-[13px] sm:text-[14px] mt-1">
            {step === 'details' && t('campaignBuilder.configureOutreach')}
            {step === 'leads' && t('campaignBuilder.chooseLeads')}
            {step === 'preview' && t('campaignBuilder.reviewEmails')}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center p-2 sm:p-2.5 flex-shrink-0 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors bg-zinc-50 dark:bg-zinc-800/50"
            title={t('campaignBuilder.close', 'Close')}
            aria-label={t('campaignBuilder.close', 'Close')}
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Premium Step Indicator */}
      <div className="flex items-center gap-0 mb-8">
        {stepLabels.map((label, i) => {
          const Icon = stepIcons[i];
          const isActive = i === stepIndex;
          const isComplete = i < stepIndex;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold transition-all duration-300 ${
                  isActive 
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg shadow-zinc-900/20 dark:shadow-white/10 scale-110'
                    : isComplete 
                      ? 'bg-[#1ED4A7] text-white' 
                      : 'bg-zinc-100 dark:bg-white/5 text-zinc-400 dark:text-zinc-600'
                }`}>
                  {isComplete ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <span className={`text-[12px] font-medium hidden sm:block transition-colors ${
                  isActive ? 'text-zinc-900 dark:text-white' : isComplete ? 'text-[#1ED4A7]' : 'text-zinc-400 dark:text-zinc-600'
                }`}>{label}</span>
              </div>
              {i < stepLabels.length - 1 && (
                <div className={`flex-1 h-px mx-3 transition-colors ${isComplete ? 'bg-[#1ED4A7]' : 'bg-zinc-200 dark:bg-white/10'}`} />
              )}
            </div>
          );
        })}
      </div>

      {step === 'details' && (
        <div className="space-y-6 flex-1 flex flex-col">
          {!hasSignature && !isAdmin && (
            <div className="bg-zinc-100/80 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-700/50 rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-200 dark:bg-zinc-700/40 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4.5 h-4.5 text-zinc-500 dark:text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-700 dark:text-zinc-200 text-[13px]">{t('campaignBuilder.emailSignatureMissing')}</p>
                <p className="text-zinc-500 dark:text-zinc-400 text-[12px] mt-0.5">{t('campaignBuilder.signatureMissingDesc')}</p>
              </div>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'settings' }));
                  setTimeout(() => window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'signature' })), 150);
                }}
                className="text-[12px] font-semibold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700/30 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700/50 transition-all whitespace-nowrap cursor-pointer"
              >
                {t('campaignBuilder.setUp')}
              </button>
            </div>
          )}

          {/* ─── Section: Campaign basics ───────────────────────────────
              Sender identity + recipient delivery. Existing fields are
              unchanged — only the section header is new, providing
              visual hierarchy across the previously flat scroll. */}
          <div className="space-y-1">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-900 dark:text-white">
              Campaign basics
            </h3>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
              Who's sending, what product, and where replies go.
            </p>
          </div>

          <div>
            <label className="block text-[13px] text-zinc-600 dark:text-zinc-400 mb-2 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.campaignName')}</label>
            <input
              type="text"
              value={campaign.name}
              onChange={e => setCampaign({ ...campaign, name: e.target.value })}
              placeholder={t('campaignBuilder.campaignNamePlaceholderInput')}
              className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
            />
          </div>

          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-2 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.productService')}</label>
            {isAdmin ? (
            <>
            <select
              value={campaign.product}
              onChange={e => {
                const newProduct = e.target.value;
                
                // Only allow auto-population for admin user or unrestricted products
                if (!isAdmin && newProduct !== 'custom') {
                   // Should technically not happen due to filtered options, but safety check
                   setCampaign({ ...campaign, product: newProduct });
                   return;
                }

                // Auto-update fromEmail and senderName based on product
                let fromEmail = campaign.fromEmail;
                let senderName = campaign.senderName;
                let senderTitle = campaign.senderTitle;
                let landingUrl = campaign.landingUrl;
                let campaignKnowledge = campaign.campaignKnowledge;
                let brand = campaign.brand;
                
                // If switching to custom, revert brand to user's brand
                if (newProduct === 'custom') {
                   brand = userBrand;
                }
                
                // Auto-populate investor campaign knowledge
                if (newProduct === 'sourcr_investor' && isAdmin) {
                  brand = 'sourcr';
                  fromEmail = 'or@sourcr.net';
                  landingUrl = 'https://sourcr.net';
                  senderName = 'Otiniel Ribeiro'; // Updated to match founder-led approach
                  senderTitle = 'CEO'; // Professional CEO title
                  campaignKnowledge = `Target: Angel investors and early-stage VCs (pre-seed to seed only). NOT Series A or beyond.

Positioning: This is NOT a desperate fundraise. Sourcr is profitable, debt-free, and generating $30-35K/month in revenue. We're seeking strategic partners who bring operational value, marketing expertise, or distribution capabilities to accelerate our next phase of growth.

Key Metrics to Emphasize:
- $30-35K monthly revenue ($360K annual run rate)
- 100% organic growth (zero paid ads)
- Profitable and cash-flow positive
- No debt, no dilution to date
- Bootstrapped since inception

What We're Looking For:
- Operators with experience scaling service or SaaS businesses
- Marketing leaders with proven acquisition systems
- Advisors with strong distribution or network access
- Partners aligned with long-term growth and execution

Current Bottleneck:
- Not demand or delivery quality
- Need to scale operations, marketing, and sales systems
- Right partners can help us accelerate without changing core offering

Investment Philosophy:
- Partnerships structured around value creation
- Flexibility between strategic investment, advisory, or growth partnerships
- Focus on alignment and execution, not short-term capital injection

Tone Guidelines:
- Confident, not promotional
- Direct and concise
- No desperation language
- No inflated projections
- Focus on real numbers and real execution

CRITICAL RULES:
- INCLUDE LINK: "See how it works → sourcr.net"
- 100-125 words max
- Never use em dashes (—)
- Never mention location/city

Email Goal: Secure an intro call to discuss strategic partnership opportunities. Include "See how it works → sourcr.net"`;
                } else if (newProduct === 'roadr_investor' && isAdmin) {
                  brand = 'roadr';
                  fromEmail = 'or@roadr.com';
                  landingUrl = 'https://roadr.com';
                  senderName = 'Otiniel Ribeiro'; // Updated to match founder-led approach
                  senderTitle = 'CEO'; // Professional CEO title
                  campaignKnowledge = `Target: Angel investors and early-stage VCs (pre-seed to seed only). NOT Series A or beyond.

Positioning: Roadr is a product-first company with real momentum. V2 is LIVE on iOS and Android with active subscriptions on both sides of the marketplace. We're seeking strategic partners who can help scale user acquisition, provider network growth, and brand reach.

Key Points to Emphasize:
- Roadr V2 is LIVE and functional (not theoretical)
- Available on iOS and Android - download at roadr.com
- Dual-sided marketplace with active subscriptions (consumers + service providers)
- NBA and NFL brand ambassadors secured
- Nationwide verified service provider network
- Daily-use automotive super app (not just emergencies)
- Foundation built and ready to scale

Product Capabilities:
- Roadside assistance and vehicle services nationwide
- Service marketplace (maintenance, repairs, detailing)
- Parking spot memory
- Insurance and registration reminders
- Vehicle care notifications
- OEM and aftermarket parts integration

What We're Looking For:
- Operators with experience scaling marketplaces or consumer apps
- Strategic marketers with national or regional distribution reach
- Advisors with automotive, consumer tech, or platform experience
- Partners aligned with building a long-term category leader

Why Now:
- Product is no longer theoretical - V2 is LIVE
- Subscriptions are active on both sides
- Platform has proven utility beyond just emergencies
- Foundation is built - ready to scale

Investment Goal:
- Not seeking survival capital
- Seeking partners who add strategic value in growth, distribution, partnerships, or scale
- Capital is secondary to alignment and execution support

Tone Guidelines:
- Confident and grounded
- Clear and direct
- No hype or exaggerated claims
- Emphasis on product, traction, and vision
- Focused on partnership, not pressure

Email Goal: Secure an intro call to discuss strategic partnership and growth capital.`;
                } else if (newProduct === 'covera_core' && isAdmin) {
                  brand = 'covera';
                  fromEmail = 'or@covera.co';
                  landingUrl = 'https://covera.co';
                  senderName = 'Otiniel Ribeiro';
                  senderTitle = 'Founder';
                  campaignKnowledge = `Target: Businesses with 10+ vendors - property management, construction, healthcare, logistics, facilities, hospitality, franchises. Focus on operations managers, compliance managers, risk managers, COOs, CFOs.

THE PROBLEM - Lead with one of these (VARY for creativity):
1. "One uninsured vendor incident costs six figures. Most companies are still tracking vendor compliance and contracts manually."
2. "Most businesses are one vendor incident or contract dispute away from a lawsuit they didn't see coming."
3. "Manual vendor compliance tracking fails at scale. Spreadsheets don't prevent disasters."
4. "Expired vendor insurance and forgotten contract renewals are silent six-figure risks."
5. "Managing vendor contracts, insurance, and compliance across spreadsheets is a disaster waiting to happen."

Core Positioning: Covera centralizes vendor management - insurance, contracts, and compliance - all in one dashboard. One incident or missed contract renewal costs more than years of software. Manual tracking fails. We automate verification and alerts to prevent coverage lapses and contract issues before they become lawsuits.

What Makes This Valuable:
- Six-figure problem with clear ROI ($399/mo vs. $100K+ loss from incidents or contract disputes)
- Most companies still use spreadsheets and email (massive pain, scattered documents)
- Compliance buyers have budget authority (they control risk spend)
- Problem gets worse as company scales (more vendors = more exposure + more contracts)
- Prevents disasters, not just organizes documents
- Everything in one dashboard (insurance, contracts, compliance, renewals)
- Audit-ready reports (compliance teams need this)
- Automated reminders before expiration (prevents silent failures for both insurance AND contracts)
- Contract lifecycle management (avoid auto-renewals, track key dates, store all agreements centrally)

Pain Points to Hit (use when relevant):
- Manual email chasing for vendor insurance AND contract renewals
- Audit panic from missing or outdated COIs and contracts
- Expired insurance leading to denied claims
- Missed contract renewal dates leading to unfavorable auto-renewals
- One uninsured vendor can cost six figures
- Contract disputes from lost or disorganized agreements
- Spreadsheet chaos and forgotten expiration dates (for both insurance and contracts)
- Legal exposure from compliance gaps and contract lapses
- Scattered documents across email, drives, and filing cabinets

What We're Selling:
- Peace of mind (not features)
- Complete vendor management system (insurance + contracts + compliance in one place)
- Risk prevention platform (not document storage)
- Audit-ready compliance (not organization tool)
- Never miss a renewal or expiration again

Qualifying Questions (vary these):
- "How are you currently tracking vendor insurance and contracts?"
- "Have you had any close calls with expired vendor COIs or missed contract renewals?"
- "Do you manually chase vendors for insurance updates and contract documents?"
- "How many vendors do you work with?"
- "Where do you store all your vendor contracts right now?"

Tone - Calm, Confident, No Hype:
- Lead with the six-figure problem (not the platform)
- Show you understand their pain (scattered systems, manual tracking)
- Be direct and professional (compliance buyers respect calm confidence)
- Vary your opening hook for creativity
- Never oversell or use buzzwords
- Keep it conversational and human
- Emphasize "everything in one dashboard" - insurance, contracts, compliance

Email Structure Variations (mix it up):
- Problem-first: "Most businesses are one vendor incident or contract dispute away from a six-figure loss..."
- Pain point: "Manual vendor management fails when you scale past 20 vendors..."
- Direct question: "How are you currently tracking vendor insurance and contract renewals?"
- Risk-focused: "One uninsured vendor or missed contract renewal can cost more than years of software..."
- Dashboard hook: "Imagine having all vendor insurance, contracts, and compliance in one dashboard..."

CRITICAL RULES:
- INCLUDE LINK: "See how it works → covera.co"
- 100-125 words max
- Never use em dashes (—)
- Never mention location/city
- Avoid pushy closes (compliance buyers hate pressure)
- Vary structure and hooks for creativity

Email Goal: Start a conversation about their current vendor compliance process. Include "See how it works → covera.co"`;
                } else if (newProduct === 'covera_investor' && isAdmin) {
                  brand = 'covera';
                  fromEmail = 'or@covera.co';
                  landingUrl = 'https://covera.co';
                  senderName = 'Otiniel Ribeiro';
                  senderTitle = 'CEO';
                  campaignKnowledge = `Target: Angel investors and early-stage VCs (pre-seed to seed only). NOT Series A or beyond. Focus on SaaS/software/tech investors ONLY.

THE HOOK - Lead with one of these angles (vary for creativity):
1. "Companies lose six figures on a single uninsured vendor incident or missed contract renewal. Most are still tracking everything manually."
2. "Every business with vendors has a six-figure blind spot - scattered insurance and contracts. We built software to fix it."
3. "Most compliance software is garbage. We built something that actually prevents disasters AND manages contracts in one dashboard."
4. "There's a massive market for boring software that prevents six-figure losses from vendor incidents and contract disputes."

Core Positioning: Covera centralizes vendor management - insurance, contracts, and compliance - in one dashboard. The problem costs six figures per incident or missed renewal. The market is still using spreadsheets and scattered systems. We automate tracking and alerts to prevent coverage lapses and contract issues before they become lawsuits.

What Makes This Investable:
- Six-figure problem with clear ROI (customers pay $399/mo to avoid $100K+ losses from incidents or contract disputes)
- Massive greenfield TAM (every company with vendors needs this - insurance AND contract management)
- Market still uses manual processes and scattered systems (huge opportunity)
- Multiple high-value verticals: property management, construction, healthcare, logistics, facilities
- Compliance buyers have budget authority and high pain
- Sticky product (compliance and contracts are ongoing, high retention)
- No dominant player yet (category-defining opportunity)
- Simple product solving expensive problem (good unit economics)
- Expanding TAM by solving multiple pain points (insurance + contracts) in one platform

Traction Talking Points (use when relevant):
- Strong PMF signals in property management and construction
- Customers renew because compliance never ends
- Pain is universal but overlooked (blind spot opportunity)

What We're Looking For:
- Operators who built B2B SaaS or compliance software
- Strategic advisors with enterprise sales or distribution experience
- Partners who understand regulated markets
- Investors who like boring, profitable problems

Why This Works:
- Problem gets worse as companies scale (more vendors = more risk)
- Regulatory pressure increasing across all sectors
- Manual tracking fails at scale (spreadsheets cannot prevent disasters)
- Customers buy to avoid getting sued, not to be organized (high willingness to pay)

Tone - Founder-Led, Direct, No Hype:
- Lead with the problem and market opportunity (not features)
- Show you understand SaaS economics and investor priorities
- Be confident but not desperate (you're evaluating fit, not begging)
- Vary your opening hook for creativity
- Never sound like marketing or AI-generated copy
- Keep it conversational and human

Email Structure Variations (mix it up):
- Problem-first: "Most companies are one vendor incident away from a six-figure loss..."
- Market opportunity: "Massive TAM for compliance automation that actually prevents disasters..."
- Traction-first: "We're seeing strong PMF in property management..."
- Direct ask: "Building vendor compliance automation. Curious if you invest in boring but profitable SaaS..."

CRITICAL RULES:
- INCLUDE LINK: "See how it works → covera.co"
- 100-125 words max
- Never use em dashes (—)
- Never mention location/city
- Avoid desperate fundraise language
- Vary structure and hooks for creativity

Email Goal: Secure an intro call to discuss strategic fit and partnership. Include "See how it works → covera.co"`;
                } else if (newProduct === 'contndr_outreach') {
                  brand = 'contndr';
                  fromEmail = 'hello@contndr.com';
                  landingUrl = 'https://contndr.com';
                  senderName = 'Contndr Team';
                  senderTitle = 'Growth Team';
                  campaignKnowledge = `Target: B2B companies doing manual sales follow-ups or using fragmented outreach tools.
                  
Positioning: Contndr is a private AI sales system being rolled out to a small group of businesses. Not public yet. Exclusivity is the angle.

Style Reference (use this as the base, adapt for their industry):
"Quick one, are you currently handling customer follow-ups and sales manually after inquiries come in?
We've been quietly rolling out a private AI sales system to a small group of businesses handling high-value transactions.
Not public yet, but opening a few additional spots.
If you're curious, you can apply for access here:
contndr.com"

Tone:
- Conversational, casual opener ("Quick one" or a relevant question)
- Exclusivity: "quietly rolling out", "private", "small group", "not public yet", "few additional spots"
- Mention their industry in parentheses naturally
- Soft CTA: "If you're curious" not "Book a demo"
- NO hard selling, NO feature lists, NO buzzwords

CRITICAL RULES:
- STRICTLY under 55 words
- INCLUDE LINK: End with just "contndr.com" on its own line
- Never use em dashes or hyphens
- Never list features or benefits
- No sign-off or signature (added automatically)

Email Goal: Spark curiosity. Get them to click the link to apply for access.`;
                } else if (newProduct.startsWith('sourcr_') && isAdmin) {
                  brand = 'sourcr';
                  fromEmail = 'or@sourcr.net'; // Otiniel R. email for Sourcr
                  landingUrl = 'https://sourcr.net';
                  // Set founder-led defaults
                  senderName = 'Otiniel Ribeiro';
                  senderTitle = 'CEO';
                  
                  campaignKnowledge = `Target: Small to medium businesses needing professional digital presence.

Positioning: Sourcr delivers premium website and app development at a fraction of agency costs. We combine design excellence with technical reliability.

Services to Emphasize:
- Custom Website Development
- Mobile App Development
- Speed, Security, and SEO included
- Monthly subscription model available (reduces upfront capex)

Tone Guidelines:
- Professional and consultative
- Solution-oriented
- Clear value proposition (ROI)

CRITICAL RULES:
- INCLUDE LINK: "See how it works → sourcr.net"
- 100-125 words max
- Never use em dashes (—)
- Never mention location/city

Email Goal: Schedule a consultation to discuss their digital needs. Include "See how it works → sourcr.net"`;
                } else if (newProduct === 'roadr_provider' && isAdmin) {
                  brand = 'roadr';
                  fromEmail = 'partner@roadr.com'; // Partner email for provider subscription
                  landingUrl = 'https://roadr.com/earn-with-us';
                  senderName = 'Roadr Team';
                  senderTitle = 'Partnership Team';
                } else if (newProduct.startsWith('roadr_') && isAdmin) {
                  brand = 'roadr';
                  fromEmail = 'or@roadr.com'; // Otiniel Ribeiro email for Roadr
                  landingUrl = 'https://roadr.com/earn-with-us';
                  // Set founder-led defaults
                  senderName = 'Otiniel Ribeiro';
                  senderTitle = 'CEO';
                } else if (newProduct.startsWith('covera_') && isAdmin) {
                  brand = 'covera';
                  fromEmail = 'or@covera.co'; // Otiniel Ribeiro email for Covera
                  landingUrl = 'https://covera.co';
                  // Set founder-led defaults
                  senderName = 'Otiniel Ribeiro';
                  senderTitle = 'CEO';
                } else {
                  // Default for generic/custom — no Contndr branding for regular users
                  brand = isAdmin ? 'contndr' : 'custom';
                  fromEmail = userEmail || '';
                  senderName = '';
                  senderTitle = '';
                }
                
                console.log('PRODUCT CHANGE:', { newProduct, brand, fromEmail });
                setCampaign({ ...campaign, product: newProduct, fromEmail, senderName, senderTitle, landingUrl, campaignKnowledge, brand });
              }}
              className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
            >
              {filteredProductOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            
            {/* Custom product name input for admin when custom is selected */}
            {campaign.product === 'custom' && (
              <div className="mt-3">
                <input
                  type="text"
                  value={campaign.customProductName}
                  onChange={e => setCampaign({ ...campaign, customProductName: e.target.value })}
                  placeholder={t('campaignBuilder.customProductPlaceholder')}
                  className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                />
                <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {t('campaignBuilder.productServiceDesc')}
                </p>
              </div>
            )}
            </>
            ) : (
              <>
                <input
                  type="text"
                  value={campaign.customProductName}
                  onChange={e => setCampaign({ ...campaign, customProductName: e.target.value })}
                  placeholder={t('campaignBuilder.productServicePlaceholder')}
                  className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                />
                <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {t('campaignBuilder.productServiceDesc')}
                </p>
              </>
            )}
          </div>

          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-2 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.fromEmail')}</label>
            {isAdmin && campaign.brand === 'covera' ? (
              <select
                value={campaign.fromEmail}
                onChange={e => setCampaign({ ...campaign, fromEmail: e.target.value })}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              >
                <option value="or@covera.co">or@covera.co ({t('campaignBuilder.default', 'Default')})</option>
                <option value="or@getcovera.co">or@getcovera.co</option>
              </select>
            ) : isAdmin && campaign.brand === 'roadr' ? (
              <select
                value={campaign.fromEmail}
                onChange={e => setCampaign({ ...campaign, fromEmail: e.target.value })}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              >
                <option value="or@roadr.com">or@roadr.com (Founder - Recommended)</option>
                <option value="partner@roadr.com">partner@roadr.com (Provider Subscription)</option>
              </select>
            ) : isAdmin ? (
              <input
                type="email"
                value={campaign.fromEmail}
                onChange={e => setCampaign({ ...campaign, fromEmail: e.target.value })}
                placeholder={t('campaignBuilder.senderEmailPlaceholder')}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              />
            ) : connectedEmail ? (
              <>
                <div className="flex items-center gap-2.5 px-4 py-3 border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/15 bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/5 rounded-xl">
                  <span className="w-2 h-2 rounded-full bg-[#1ED4A7] flex-shrink-0" />
                  <span className="text-[14px] text-zinc-900 dark:text-white font-medium">{connectedEmail}</span>
                  <span className="text-[11px] text-[#1ED4A7] font-medium ml-auto">
                    {emailProvider === 'gmail_oauth' ? 'Gmail' : emailProvider === 'outlook_oauth' ? 'Outlook' : 'SMTP'}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {t('campaignBuilder.sendingFromConnected')}{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'settings' })); window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'email' })); }} className="text-zinc-500 dark:text-zinc-400 underline hover:no-underline">{t('campaignBuilder.change')}</a>
                </p>
              </>
            ) : (
              <>
                {!loadingEmailConfig && (
                  <div className="p-4 bg-zinc-100/80 dark:bg-zinc-800/20 border border-zinc-200/80 dark:border-zinc-700/30 rounded-xl">
                    <p className="text-[13px] text-zinc-600 dark:text-zinc-300">
                      <strong>{t('campaignBuilder.connectEmailToSend')}</strong> {t('campaignBuilder.goTo')}{' '}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'settings' }));
                          window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'email' }));
                        }}
                        className="font-medium underline hover:no-underline"
                      >
                        {t('campaignBuilder.settingsEmailConfig')}
                      </a>{' '}
                      {t('campaignBuilder.andConnect')}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* CC / BCC */}
          <div>
            <button
              type="button"
              onClick={() => setShowCcBcc(p => !p)}
              className="text-[12px] font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors flex items-center gap-1"
            >
              {showCcBcc ? t('campaignBuilder.hideCcBcc') : t('campaignBuilder.addCcBcc')}
            </button>
            {showCcBcc && (
              <div className="mt-2 space-y-3">
                <div>
                  <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.ccLabel')}</label>
                  <input
                    type="text"
                    value={campaign.cc}
                    onChange={e => setCampaign({ ...campaign, cc: e.target.value })}
                    placeholder="cc@email.com, another@email.com"
                    className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{t('campaignBuilder.ccVisibleToAll')}</p>
                </div>
                <div>
                  <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.bccLabel')}</label>
                  <input
                    type="text"
                    value={campaign.bcc}
                    onChange={e => setCampaign({ ...campaign, bcc: e.target.value })}
                    placeholder="bcc@email.com"
                    className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{t('campaignBuilder.bccHiddenFromOthers')}</p>
                </div>
              </div>
            )}
          </div>

          {/* Attachments */}
          <div>
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.csv,.zip"
              onChange={e => handleAttachmentUpload(e.target.files)}
            />
            {attachments.length === 0 ? (
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={uploadingAttachment}
                className="text-[12px] font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {uploadingAttachment ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Paperclip className="w-3.5 h-3.5" />
                )}
                {uploadingAttachment ? t('campaignBuilder.uploading') : t('campaignBuilder.addAttachment')}
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                    {t('campaignBuilder.attachmentsCount', { count: attachments.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={uploadingAttachment || attachments.length >= 5}
                    className="text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors flex items-center gap-1 disabled:opacity-40"
                  >
                    {uploadingAttachment ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Paperclip className="w-3 h-3" />
                    )}
                    {uploadingAttachment ? t('campaignBuilder.uploading') : t('campaignBuilder.addMore')}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {attachments.map(att => (
                    <div
                      key={att.id}
                      className="flex items-center gap-2.5 px-3 py-2.5 bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl group"
                    >
                      <span className="text-[14px] flex-shrink-0">{getFileIcon(att.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 truncate">{att.filename}</p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatFileSize(att.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att)}
                        className="flex items-center justify-center p-1.5 text-zinc-400 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0"
                        title={t('campaignBuilder.removeAttachment')}
                      >
                        <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
                  {t('campaignBuilder.maxFileInfo')}
                </p>
              </div>
            )}
          </div>

          {/* Sender Name + Title — 2-col grid for tighter form on
              desktop. Collapses to stacked single-col below sm. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-2 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.senderName')}</label>
            {isAdmin ? (
              <select
                value={campaign.senderName}
                onChange={e => {
                  const newSenderName = e.target.value;
                  let newFromEmail = campaign.fromEmail;

                  // Auto-update email for specific senders
                  if (newSenderName === 'Zara Blake') {
                    newFromEmail = 'Zara@sourcr.net';
                  }

                  setCampaign({ ...campaign, senderName: newSenderName, fromEmail: newFromEmail });
                }}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              >
                {filteredSenderNameOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={campaign.senderName}
                onChange={e => setCampaign({ ...campaign, senderName: e.target.value })}
                placeholder={t('campaignBuilder.senderNamePlaceholder')}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              />
            )}
          </div>

          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-2 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.senderTitle')}</label>
            {isAdmin ? (
              <select
                value={campaign.senderTitle}
                onChange={e => setCampaign({ ...campaign, senderTitle: e.target.value })}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              >
                {filteredSenderTitleOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={campaign.senderTitle}
                onChange={e => setCampaign({ ...campaign, senderTitle: e.target.value })}
                placeholder={t('campaignBuilder.senderTitlePlaceholder')}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              />
            )}
          </div>
          </div>

          {/* ─── Section: How your AI writes ──────────────────────────
              Tone, length, examples, brand context. The existing
              Writing Control panel is unchanged below — only the
              header is new, providing a visual handoff between the
              identity block above and the writing controls. */}
          <div className="pt-2 border-t border-zinc-100 dark:border-white/[0.06] space-y-1">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-900 dark:text-white pt-4">
              How your AI writes
            </h3>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
              Tone, length, the brand context behind every email.
            </p>
          </div>

          {/* Signature Preview for non-admin users (only when no configured signature exists) */}
          {!isAdmin && !signatureText && (campaign.senderName || campaign.fromEmail || campaign.landingUrl) && (
            <div className="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10">
              <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-2.5">{t('campaignBuilder.emailSignaturePreview')}</p>
              <div className="text-[13px] text-zinc-700 dark:text-zinc-300 font-mono whitespace-pre-line leading-relaxed">
                {campaign.senderName && `${t('campaignBuilder.bestRegards')},\n${campaign.senderName}${campaign.senderTitle ? ` | ${campaign.senderTitle}` : ''}`}
                {campaign.fromEmail && `\nE: ${campaign.fromEmail}`}
                {campaign.landingUrl && `\nW: ${campaign.landingUrl.replace(/^https?:\/\//, '')}`}
              </div>
            </div>
          )}

          {/* ═══ WRITING CONTROL CENTER ═══ */}
          <div className="space-y-4 border border-zinc-200 dark:border-white/10 rounded-xl p-4 bg-zinc-50 dark:bg-white/[0.01]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="w-3.5 h-3.5 text-zinc-900 dark:text-white shrink-0" />
                <span className="text-[11px] font-semibold text-zinc-900 dark:text-white uppercase tracking-wider shrink-0">{t('campaignBuilder.writingControl')}</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-600 normal-case tracking-normal hidden sm:inline">{t('campaignBuilder.writingControlDesc')}</span>
              </div>
              <WritingPresetSelector
                currentValues={{
                  tone: campaign.tone,
                  maxWords: campaign.maxWords,
                  customInstructions: campaign.customInstructions,
                  exampleEmail: campaign.exampleEmail,
                }}
                onApply={(values) => setCampaign({
                  ...campaign,
                  tone: values.tone,
                  maxWords: values.maxWords,
                  customInstructions: values.customInstructions,
                  exampleEmail: values.exampleEmail,
                })}
              />
            </div>

            {/* Writing Instructions — THE PRIMARY CONTROL */}
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                {t('campaignBuilder.writingInstructions')}
              </label>
              <textarea
                value={campaign.customInstructions}
                onChange={e => setCampaign({ ...campaign, customInstructions: e.target.value })}
                placeholder={t('campaignBuilder.writingInstructionsPlaceholder')}
                rows={5}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all resize-none"
              />
              <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                {t('campaignBuilder.instructionsOverride')}
              </p>
            </div>

            {/* Example Email — paste your own style */}
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                {t('campaignBuilder.exampleEmail')} <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-600">{t('campaignBuilder.exampleEmailHint')}</span>
              </label>
              <textarea
                value={campaign.exampleEmail}
                onChange={e => setCampaign({ ...campaign, exampleEmail: e.target.value })}
                placeholder={t('campaignBuilder.exampleEmailPlaceholder')}
                rows={4}
                className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all resize-none"
              />
            </div>

            {/* Word Count + Tone — side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                  {t('campaignBuilder.maxWords')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={30}
                    max={200}
                    step={5}
                    value={campaign.maxWords}
                    onChange={e => setCampaign({ ...campaign, maxWords: Number(e.target.value) })}
                    className="flex-1 h-1.5 bg-zinc-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-zinc-900 dark:accent-white"
                  />
                  <span className="text-[13px] font-mono text-zinc-900 dark:text-white w-8 text-right tabular-nums">{campaign.maxWords}</span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-600">
                  {campaign.maxWords <= 50 ? t('campaignBuilder.ultraShort') : campaign.maxWords <= 80 ? t('campaignBuilder.shortIdeal') : campaign.maxWords <= 120 ? t('campaignBuilder.mediumRoom') : t('campaignBuilder.longDetailed')}
                </p>
              </div>
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                  {t('campaignBuilder.tone')}
                </label>
                {/* Tone — pill selector. Native <select> read cheap on
                    this page where every other control is already a
                    pill or chip. Same state shape, same options, just
                    a richer touch target with the description shown
                    on the active choice. */}
                <div className="flex flex-wrap gap-1.5">
                  {toneOptions.map(opt => {
                    const active = campaign.tone === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setCampaign({ ...campaign, tone: opt.value })}
                        title={t(`campaignBuilder.${opt.descKey}`)}
                        className={`px-3 py-1.5 text-[12px] font-medium rounded-full border transition-all ${
                          active
                            ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                            : 'bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
                        }`}
                      >
                        {t(`campaignBuilder.${opt.labelKey}`)}
                      </button>
                    );
                  })}
                </div>
                {/* Description line — shows the active tone's blurb so the
                    user still sees what they picked without having to
                    hover. */}
                {(() => {
                  const active = toneOptions.find(o => o.value === campaign.tone);
                  if (!active) return null;
                  return (
                    <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                      {t(`campaignBuilder.${active.descKey}`)}
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Brand & Product Info (formerly "Campaign Knowledge Base") */}
          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
              {t('campaignBuilder.brandProductInfo')} <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-600">{t('campaignBuilder.brandProductInfoHint')}</span>
            </label>
            <textarea
              value={campaign.campaignKnowledge}
              onChange={e => setCampaign({ ...campaign, campaignKnowledge: e.target.value })}
              placeholder={t('campaignBuilder.brandProductInfoPlaceholder')}
              rows={4}
              className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all resize-none"
            />
            <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              {t('campaignBuilder.aiUsesThis')}
            </p>
          </div>

          {/* Signature Preview */}
          {signatureText && (
            <div className="bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">{t('campaignBuilder.emailSignature')}</span>
                <a
                  href="/app/settings"
                  onClick={(e) => {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'settings' }));
                    window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'signature' }));
                  }}
                  className="text-[11px] text-zinc-400 hover:text-zinc-900 dark:hover:text-white underline hover:no-underline transition-colors"
                >
                  {t('campaignBuilder.edit')}
                </a>
              </div>
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-lg px-4 py-3">
                <pre className="text-[13px] text-zinc-600 dark:text-zinc-400 font-sans whitespace-pre-line leading-relaxed">
                  {signatureText}
                </pre>
              </div>
            </div>
          )}

          {/* Spacer so sticky CTA doesn't overlap last field */}
          <div className="flex-1 min-h-[16px]" />
          {/* Sticky CTA */}
          <div className="sticky bottom-0 mt-auto -mx-4 sm:-mx-7 px-4 sm:px-7 pt-3 pb-4 sm:pb-7 bg-[var(--background)] border-t border-[var(--border)] z-10 -mb-4 sm:-mb-7">
            <button
              onClick={() => setStep('leads')}
              disabled={!campaign.name || !campaign.fromEmail || !campaign.senderName}
              className="w-full flex items-center justify-center gap-2.5 px-5 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[14px] font-semibold rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-100 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              <span>{t('campaignBuilder.nextSelectLeads')}</span>
            </button>
          </div>
        </div>
      )}

      {step === 'leads' && (
        <div className="space-y-5 flex-1 flex flex-col">
          {/* Investor Lead Suggestion Banner */}
          {showInvestorSuggestion && investorLeads.length > 0 && (
            <div className="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-zinc-900 dark:text-white mb-1">
                    🎯 {t('campaignBuilder.investorSuggestionTitle', { count: investorLeads.length })}
                  </p>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-3">
                    {t('campaignBuilder.investorSuggestionDesc')}
                  </p>
                  <button
                    onClick={selectInvestorLeads}
                    className="px-4 py-2.5 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-[13px] font-semibold rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-sm active:scale-[0.98]"
                  >
                    {t('campaignBuilder.autoSelectInvestors', { count: investorLeads.length })}
                  </button>
                </div>
                <button
                  onClick={() => setShowInvestorSuggestion(false)}
                  className="flex items-center justify-center p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 rounded-xl transition-all"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          )}

          {/* ─── Audience Builder v2: Live audience summary banner ───
              Pinned at the top of the leads step so the user always
              sees what they're about to send: count, estimated send
              window (given daily cap), and cost. Quietly hides when
              nothing is selected yet. */}
          {audienceEstimate && (
            <div className="rounded-xl border border-zinc-900/10 dark:border-white/10 bg-zinc-50/80 dark:bg-zinc-950 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center">
                  <Users className="w-4 h-4 text-white dark:text-zinc-900" strokeWidth={2.2} />
                </div>
                <div className="leading-tight">
                  <div className="text-[15px] font-semibold text-zinc-900 dark:text-white">
                    {audienceEstimate.count.toLocaleString()} {audienceEstimate.count === 1 ? 'lead' : 'leads'} selected
                  </div>
                  <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                    {audienceEstimate.timeText} <span className="mx-1.5 text-zinc-300 dark:text-zinc-700">·</span> {audienceEstimate.costText}
                  </div>
                </div>
              </div>
              <button
                onClick={deselectAllLeads}
                className="text-[12px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white font-medium"
              >
                Clear
              </button>
            </div>
          )}

          {/* ─── Audience Builder v2: Smart presets ───
              One-click filter combos for the 90% of audiences users
              actually build. Each preset toggles engagement filters and
              (where relevant) the size-control mode. Re-clicking the
              active preset clears it. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold mr-1">Presets</span>
            {([
              { id: 'never_contacted', label: 'Never contacted' },
              { id: 'hot_prospects',   label: 'Hot prospects' },
              { id: 're_engage',       label: 'Re-engage' },
              { id: 'recent_visitors', label: 'Recent visitors' },
              { id: 'high_score',      label: 'High score' },
            ] as const).map(p => {
              const active = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => active ? applyPreset('clear') : applyPreset(p.id)}
                  className={`px-3 py-1.5 text-[12px] font-medium rounded-full border transition-all ${
                    active
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                      : 'bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* ─── Audience Builder v2 Phase 2: Saved segments ───
              The user can save the current filter shape as a named
              segment and reload it later. Dropdown lists existing
              segments + "Save current as…" entry. Pure persistence
              of the filter shape — selectedLeads is NOT stored. */}
          {(savedSegments.length > 0 || true) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold">Segments</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSegmentMenu(v => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-full border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-white/30"
                >
                  {activeSegmentId
                    ? (savedSegments.find(s => s.id === activeSegmentId)?.name || 'Segment')
                    : (savedSegments.length === 0 ? 'No saved segments' : 'Load segment')}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showSegmentMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowSegmentMenu(false)} />
                    <div className="absolute left-0 top-full mt-1.5 bg-white dark:bg-zinc-950 rounded-xl shadow-xl border border-zinc-200 dark:border-white/10 min-w-[220px] max-w-[320px] z-20 py-1.5 max-h-[280px] overflow-y-auto">
                      {savedSegments.length === 0 && (
                        <div className="px-3.5 py-2 text-[12px] text-zinc-500">No segments yet. Save your filters to reuse them.</div>
                      )}
                      {savedSegments.map(seg => (
                        <div
                          key={seg.id}
                          className={`flex items-center justify-between gap-2 px-3 py-2 group hover:bg-zinc-50 dark:hover:bg-white/[0.04] cursor-pointer ${activeSegmentId === seg.id ? 'bg-zinc-50 dark:bg-white/[0.04]' : ''}`}
                          onClick={() => loadSegment(seg)}
                        >
                          <span className="text-[12.5px] text-zinc-900 dark:text-white truncate flex-1">{seg.name}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSegment(seg); }}
                            className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-opacity"
                            title="Delete segment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={saveCurrentAsSegment}
                disabled={savingSegment}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-full border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-white/30 disabled:opacity-50"
              >
                {savingSegment ? 'Saving…' : 'Save current'}
              </button>
              {activeSegmentId && (
                <button
                  onClick={() => setActiveSegmentId(null)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white underline"
                >
                  clear
                </button>
              )}
            </div>
          )}

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" strokeWidth={2} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('campaignBuilder.searchLeadsPlaceholder')}
              className="w-full pl-10 pr-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
            />
          </div>

            {/* Filters Section */}
            <div className="space-y-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white font-medium transition-colors"
              >
                <Filter className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{showFilters ? t('campaignBuilder.hideAdvancedFilters') : t('campaignBuilder.showAdvancedFilters')}</span>
                {(selectedCountries.length + selectedStates.length + selectedCities.length + selectedIndustries.length) > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#1ED4A7] text-white text-[10px] font-bold leading-none">
                    {selectedCountries.length + selectedStates.length + selectedCities.length + selectedIndustries.length}
                  </span>
                )}
              </button>

              {showFilters && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl relative">
                    {/* Industry Filter */}
                    <div className="relative">
                      <label className="flex items-center gap-1.5 text-[12px] text-zinc-700 dark:text-zinc-300 mb-1.5 font-medium">
                        <Briefcase className="w-3.5 h-3.5" strokeWidth={2} />
                        Industry
                      </label>
                      <button
                        onClick={() => setActiveDropdown(activeDropdown === 'industry' ? null : 'industry')}
                        className="w-full text-left px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all flex items-center justify-between"
                      >
                        <span className="truncate">
                          {selectedIndustries.length === 0 ? 'All Industries' : `${selectedIndustries.length} selected`}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      </button>
                      
                      {activeDropdown === 'industry' && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setActiveDropdown(null)} />
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl shadow-black/20 dark:shadow-black/60 z-20 max-h-60 overflow-y-auto p-1.5">
                            {uniqueIndustries.map(industry => {
                              const isSelected = selectedIndustries.includes(industry);
                              return (
                                <label key={industry} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      if (isSelected) {
                                        setSelectedIndustries(prev => prev.filter(i => i !== industry));
                                      } else {
                                        setSelectedIndustries(prev => [...prev, industry]);
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                                  />
                                  <span className="text-[13px] text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                                    {industry}
                                  </span>
                                </label>
                              );
                            })}
                            {uniqueIndustries.length === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-500 text-center">No industries found</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Country Filter */}
                    <div className="relative">
                      <label className="flex items-center gap-1.5 text-[12px] text-zinc-700 dark:text-zinc-300 mb-1.5 font-medium">
                        <MapPin className="w-3.5 h-3.5" strokeWidth={2} />
                        Country
                      </label>
                      <button
                        onClick={() => setActiveDropdown(activeDropdown === 'country' ? null : 'country')}
                        className="w-full text-left px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all flex items-center justify-between"
                      >
                        <span className="truncate">
                          {selectedCountries.length === 0 ? `All Countries (${uniqueCountries.length})` : `${selectedCountries.length} selected`}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      </button>
                      
                      {activeDropdown === 'country' && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setActiveDropdown(null)} />
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl shadow-black/20 dark:shadow-black/60 z-20 max-h-60 overflow-y-auto p-1.5">
                            {uniqueCountries.map(country => {
                              const count = countryCountMap.get(country) || 0;
                              const isSelected = selectedCountries.includes(country);
                              return (
                                <label key={country} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      if (isSelected) {
                                        setSelectedCountries(prev => prev.filter(c => c !== country));
                                      } else {
                                        setSelectedCountries(prev => [...prev, country]);
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                                  />
                                  <span className="text-[13px] text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                                    {country} <span className="text-zinc-400 dark:text-zinc-500 text-xs">({count})</span>
                                  </span>
                                </label>
                              );
                            })}
                            {uniqueCountries.length === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-500 text-center">No countries found</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* State Filter */}
                    <div className="relative">
                      <label className="flex items-center gap-1.5 text-[12px] text-zinc-700 dark:text-zinc-300 mb-1.5 font-medium">
                        <MapPin className="w-3.5 h-3.5" strokeWidth={2} />
                        State
                      </label>
                      <button
                        onClick={() => setActiveDropdown(activeDropdown === 'state' ? null : 'state')}
                        className="w-full text-left px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all flex items-center justify-between"
                      >
                        <span className="truncate">
                          {selectedStates.length === 0 ? `All States (${uniqueStates.length})` : `${selectedStates.length} selected`}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      </button>
                      
                      {activeDropdown === 'state' && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setActiveDropdown(null)} />
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl shadow-black/20 dark:shadow-black/60 z-20 max-h-60 overflow-y-auto p-1.5">
                            {uniqueStates.map(state => {
                              const count = stateCountMap.get(state) || 0;
                              const isSelected = selectedStates.includes(state);
                              return (
                                <label key={state} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      if (isSelected) {
                                        setSelectedStates(prev => prev.filter(s => s !== state));
                                      } else {
                                        setSelectedStates(prev => [...prev, state]);
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                                  />
                                  <span className="text-[13px] text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                                    {state} <span className="text-zinc-400 dark:text-zinc-500 text-xs">({count})</span>
                                  </span>
                                </label>
                              );
                            })}
                            {selectedCountries.length === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-500 text-center">Select a country first</div>
                            )}
                            {selectedCountries.length > 0 && uniqueStates.length === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-500 text-center">No states found</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* City Filter */}
                    <div className="relative">
                      <label className="flex items-center gap-1.5 text-[12px] text-zinc-700 dark:text-zinc-300 mb-1.5 font-medium">
                        <MapPin className="w-3.5 h-3.5" strokeWidth={2} />
                        City
                      </label>
                      <button
                        onClick={() => setActiveDropdown(activeDropdown === 'city' ? null : 'city')}
                        className="w-full text-left px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all flex items-center justify-between"
                      >
                        <span className="truncate">
                          {selectedCities.length === 0 ? `All Cities (${uniqueCities.length})` : `${selectedCities.length} selected`}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      </button>
                      
                      {activeDropdown === 'city' && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setActiveDropdown(null)} />
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl shadow-black/20 dark:shadow-black/60 z-20 max-h-60 overflow-y-auto p-1.5">
                            {uniqueCities.map(city => {
                              const count = cityCountMap.get(city) || 0;
                              const isSelected = selectedCities.includes(city);
                              return (
                                <label key={city} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      if (isSelected) {
                                        setSelectedCities(prev => prev.filter(c => c !== city));
                                      } else {
                                        setSelectedCities(prev => [...prev, city]);
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                                  />
                                  <span className="text-[13px] text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                                    {city} <span className="text-zinc-400 dark:text-zinc-500 text-xs">({count})</span>
                                  </span>
                                </label>
                              );
                            })}
                            {selectedCountries.length === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-500 text-center">Select a country first</div>
                            )}
                            {selectedCountries.length > 0 && uniqueCities.length === 0 && (
                              <div className="px-3 py-2 text-xs text-zinc-500 text-center">No cities found</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Quick Actions */}
                    <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wide flex items-center">
                        Quick Actions
                      </span>
                      {(selectedCities.length > 0 || selectedStates.length > 0 || selectedCountries.length > 0 || selectedIndustries.length > 0) && (
                        <button
                          onClick={() => {
                            setSelectedCities([]);
                            setSelectedStates([]);
                            setSelectedCountries([]);
                            setSelectedIndustries([]);
                          }}
                          className="flex items-center gap-1 px-2 py-1 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                        >
                          <X className="w-3 h-3" strokeWidth={2} />
                          {t('campaignBuilder.clearFilters')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

          {/* ─── Audience Builder v2 Phase 2: Power filters ───
              Lead score range + recency + cross-campaign exclusion.
              Sits between advanced location/industry filters and the
              contact-status toggle so the visual flow is broad → fine. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl">
            {/* Lead score range */}
            <div>
              <label className="flex items-center justify-between text-[12px] text-zinc-700 dark:text-zinc-300 mb-1.5 font-medium">
                <span>Lead score</span>
                <span className="text-zinc-400 dark:text-zinc-500 font-mono text-[11px]">
                  {scoreRange ? `${scoreRange[0]}–${scoreRange[1]}` : 'any'}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={scoreRange?.[0] ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const hi = scoreRange?.[1] ?? 100;
                    setScoreRange([Math.min(v, hi), hi]);
                  }}
                  className="flex-1 h-1.5 bg-zinc-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-zinc-900 dark:accent-white"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={scoreRange?.[1] ?? 100}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const lo = scoreRange?.[0] ?? 0;
                    setScoreRange([lo, Math.max(v, lo)]);
                  }}
                  className="flex-1 h-1.5 bg-zinc-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-zinc-900 dark:accent-white"
                />
                {scoreRange && (
                  <button
                    onClick={() => setScoreRange(null)}
                    className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white underline"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>

            {/* Added within (days) — quick chips */}
            <div>
              <label className="block text-[12px] text-zinc-700 dark:text-zinc-300 mb-1.5 font-medium">Added within</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'Any time', val: null as number | null },
                  { label: '7d',  val: 7 },
                  { label: '30d', val: 30 },
                  { label: '90d', val: 90 },
                  { label: '1y',  val: 365 },
                ].map(opt => {
                  const active = addedWithinDays === opt.val;
                  return (
                    <button
                      key={String(opt.val)}
                      type="button"
                      onClick={() => setAddedWithinDays(opt.val)}
                      className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full border transition-all ${
                        active
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                          : 'bg-white dark:bg-black text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Last contacted — for re-engagement campaigns */}
            <div>
              <label className="block text-[12px] text-zinc-700 dark:text-zinc-300 mb-1.5 font-medium">Last contacted</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'Any',           val: null as { min?: number; max?: number } | null },
                  { label: 'Never',         val: { min: 99999 } },
                  { label: '>30d ago',      val: { min: 30 } },
                  { label: '>60d ago',      val: { min: 60 } },
                  { label: '>90d ago',      val: { min: 90 } },
                ].map(opt => {
                  const active = JSON.stringify(lastContactedRange) === JSON.stringify(opt.val);
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setLastContactedRange(opt.val)}
                      className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full border transition-all ${
                        active
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                          : 'bg-white dark:bg-black text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cross-campaign exclusion */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <label className="block text-[12px] text-zinc-700 dark:text-zinc-300 font-medium">Exclude double-touches</label>
                <p className="text-[10.5px] text-zinc-500 dark:text-zinc-500 mt-0.5 leading-snug">
                  Skip leads in your other active campaigns
                  {activeCampaignLeadIds ? ` (${activeCampaignLeadIds.size.toLocaleString()})` : ''}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={excludeActiveCampaigns}
                onClick={() => setExcludeActiveCampaigns(v => !v)}
                className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                  excludeActiveCampaigns ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-200 dark:bg-zinc-800'
                }`}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 bg-white dark:bg-zinc-900 rounded-full shadow transition-transform"
                  style={{ transform: excludeActiveCampaigns ? 'translateX(20px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          </div>

          {/* Contact Status Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/5 border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/15 rounded-xl">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-[#1ED4A7]" strokeWidth={2} />
              </div>
              <span className="text-[13px] text-zinc-800 dark:text-zinc-100 font-medium">
                {showOnlyUncontacted ? t('campaignBuilder.showingOnlyUncontacted') : t('campaignBuilder.showingAllLeads')}
              </span>
            </div>
            <button
              onClick={() => {
                const next = !showOnlyUncontacted;
                console.log(`[CAMPAIGN BUILDER] TOGGLE uncontacted: ${showOnlyUncontacted} → ${next}`);
                setShowOnlyUncontacted(next);
              }}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white dark:bg-white/[0.05] text-[#1ED4A7] text-[12px] font-semibold rounded-lg hover:bg-[#1ED4A7]/5 dark:hover:bg-[#1ED4A7]/10 transition-all border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/20"
            >
              <Filter className="w-3 h-3" strokeWidth={2} />
              <span>{showOnlyUncontacted ? t('campaignBuilder.showAll') : t('campaignBuilder.onlyUncontacted')}</span>
            </button>
          </div>

          {/* ─── Audience Builder v2: Engagement multi-filter ───
              Replaces the binary "uncontacted only" toggle with a
              proper multi-pill filter. The legacy toggle above still
              works for users who haven't discovered this; both write
              to compatible state. Pills are mutually-exclusive with
              "never_contacted" — UI strips the conflict on click. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold mr-1">Engagement</span>
            {([
              { id: 'never_contacted', label: 'Never contacted' },
              { id: 'opened',          label: 'Opened' },
              { id: 'clicked',         label: 'Clicked' },
              { id: 'replied',         label: 'Replied' },
              { id: 'bounced',         label: 'Bounced' },
              { id: 'unsubscribed',    label: 'Unsubscribed' },
            ] as const).map(p => {
              const active = engagementStates.includes(p.id as EngagementStateLocal);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setEngagementStates(prev => {
                      if (active) return prev.filter(s => s !== p.id);
                      // never_contacted is mutually-exclusive with the rest
                      if (p.id === 'never_contacted') return ['never_contacted' as EngagementStateLocal];
                      return [...prev.filter(s => s !== 'never_contacted'), p.id as EngagementStateLocal];
                    });
                  }}
                  className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full border transition-all ${
                    active
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                      : 'bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            {engagementStates.length > 0 && (
              <button
                onClick={() => setEngagementStates([])}
                className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white font-medium underline ml-1"
              >
                clear
              </button>
            )}
          </div>

          {/* ─── Audience Builder v2: Audience size control ───
              Quick-pick chips for common batch sizes + custom-N input
              + sample mode. "First" matches the current sort (server
              default = lead_score desc), "Random" is unbiased small-
              sample testing, "Top by score" sorts by lead_score before
              slicing. Selecting any chip immediately updates
              selectedLeads via applyAudienceSample. */}
          <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50/60 dark:bg-zinc-950 px-3.5 py-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold">Audience size</span>
              <div className="flex flex-wrap gap-1.5">
                {[10, 25, 50, 100, 250, 500, 1000].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => applyAudienceSample(n, sampleMode)}
                    className={`px-2.5 py-1 text-[12px] font-semibold rounded-md border transition-all ${
                      sampleSize === n
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                        : 'bg-white dark:bg-black text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
                    }`}
                  >
                    {n.toLocaleString()}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => applyAudienceSample(null, sampleMode)}
                  className={`px-2.5 py-1 text-[12px] font-semibold rounded-md border transition-all ${
                    sampleSize === null && selectedLeads.length > 0
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                      : 'bg-white dark:bg-black text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
                  }`}
                >
                  All
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">Exact:</span>
                <input
                  type="number"
                  min="1"
                  max={filteredLeads.length || undefined}
                  placeholder="N"
                  className="w-20 px-2 py-1 text-[12px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-md focus:outline-none focus:border-zinc-400 dark:focus:border-white/30"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!isNaN(v) && v > 0) applyAudienceSample(v, sampleMode);
                    }
                  }}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v > 0) applyAudienceSample(v, sampleMode);
                  }}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mr-1">Order:</span>
                {([
                  { id: 'first',     label: 'First' },
                  { id: 'random',    label: 'Random' },
                  { id: 'top_score', label: 'Top score' },
                ] as const).map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSampleMode(m.id);
                      // Re-apply with new mode if a size is already set
                      if (selectedLeads.length > 0) applyAudienceSample(sampleSize, m.id);
                    }}
                    className={`px-2 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                      sampleMode === m.id
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            {/* Count copy v2 — explicit "X match · Y loaded · Z selected"
                instead of the previous "matching filters (loaded)" which
                read ambiguous to most users. */}
            <p className="text-[13px] text-zinc-600 dark:text-zinc-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span>
                <span className="font-semibold text-zinc-900 dark:text-white">{totalLeadCount.toLocaleString()}</span>{' '}
                {(searchQuery || selectedCities.length > 0 || selectedStates.length > 0 || selectedCountries.length > 0 || selectedIndustries.length > 0)
                  ? 'match'
                  : 'available'}
              </span>
              {filteredLeads.length < totalLeadCount && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-zinc-500 dark:text-zinc-500">{filteredLeads.length.toLocaleString()} loaded</span>
                </>
              )}
              {selectedLeads.length > 0 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[#1ED4A7] font-semibold">{selectedLeads.length.toLocaleString()} selected</span>
                </>
              )}
            </p>
            <div className="flex gap-2 items-center self-end sm:self-auto">
              <div className="relative">
                <button
                  onClick={() => setShowBulkSelect(!showBulkSelect)}
                  className="flex items-center gap-1 text-[13px] text-[#1ED4A7] hover:text-[#1ED4A7]/80 font-medium transition-colors"
                >
                  {(searchQuery || selectedCities.length > 0 || selectedStates.length > 0 || selectedCountries.length > 0 || selectedIndustries.length > 0) ? t('campaignBuilder.selectFiltered') : t('campaignBuilder.selectAllLabel')}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showBulkSelect && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowBulkSelect(false)} />
                    <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-white/[0.05] rounded-xl shadow-xl border border-zinc-200 dark:border-white/10 min-w-[160px] z-20 py-1.5">
                      <button 
                        onClick={() => { selectAllFilteredLeads(); setShowBulkSelect(false); }}
                        disabled={selectingAll}
                        className="w-full text-left px-3.5 py-2 text-[12px] font-medium hover:bg-zinc-50 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-300 rounded-lg mx-0 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {selectingAll && <Loader2 className="w-3 h-3 animate-spin" />}
                        {(searchQuery || selectedCities.length > 0 || selectedStates.length > 0 || selectedCountries.length > 0 || selectedIndustries.length > 0) ? t('campaignBuilder.selectAllFiltered', { count: totalLeadCount.toLocaleString() }) : t('campaignBuilder.selectAllLeads', { count: totalLeadCount.toLocaleString() })}
                      </button>
                      <div className="border-t border-zinc-100 dark:border-white/5 my-1 mx-2"></div>
                      <button onClick={() => { selectBulk(50); setShowBulkSelect(false); }} className="w-full text-left px-3.5 py-2 text-[12px] hover:bg-zinc-50 dark:hover:bg-white/5 text-zinc-600 dark:text-zinc-400 transition-colors">
                        {t('campaignBuilder.selectFirst50')}
                      </button>
                      <button onClick={() => { selectBulk(100); setShowBulkSelect(false); }} className="w-full text-left px-3.5 py-2 text-[12px] hover:bg-zinc-50 dark:hover:bg-white/5 text-zinc-600 dark:text-zinc-400 transition-colors">
                        {t('campaignBuilder.selectFirst100')}
                      </button>
                      <button onClick={() => { selectBulk(200); setShowBulkSelect(false); }} className="w-full text-left px-3.5 py-2 text-[12px] hover:bg-zinc-50 dark:hover:bg-white/5 text-zinc-600 dark:text-zinc-400 transition-colors">
                        {t('campaignBuilder.selectFirst200')}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <span className="text-zinc-300 dark:text-zinc-600">|</span>
              <button
                onClick={deselectAllLeads}
                className="text-[13px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 font-medium"
              >
                {t('campaignBuilder.clear')}
              </button>
            </div>
          </div>

          <div
            ref={leadListRef}
            className="flex-1 min-h-[200px] overflow-y-auto border border-zinc-200 dark:border-white/10 rounded-xl"
            onScroll={(e) => {
              const el = e.currentTarget;
              // Show more already-loaded leads for smooth scrolling
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && visibleLeadCount < filteredLeads.length) {
                setVisibleLeadCount(prev => Math.min(prev + 50, filteredLeads.length));
              }
              // Fetch next page from server when nearing end of loaded data
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 300 && visibleLeadCount >= filteredLeads.length - 20 && hasMoreLeads && !loadingMoreLeads) {
                loadMoreLeads();
              }
            }}
          >
            {filteredLeads.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-500 dark:text-zinc-400 text-[14px]">
                  {searchQuery || selectedCities.length > 0 || selectedIndustries.length > 0
                    ? t('campaignBuilder.noLeadsMatch')
                    : showOnlyUncontacted
                    ? t('campaignBuilder.allLeadsContacted') + ' 🎉'
                    : t('campaignBuilder.noLeadsImportFirst')}
                </p>
                {(searchQuery || selectedCities.length > 0 || selectedIndustries.length > 0) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCities([]);
                      setSelectedIndustries([]);
                    }}
                    className="mt-3 text-[13px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white font-medium transition-colors"
                  >
                    {t('campaignBuilder.clearAllFilters')}
                  </button>
                )}
                {showOnlyUncontacted && !searchQuery && selectedCities.length === 0 && selectedIndustries.length === 0 && (
                  <button
                    onClick={() => setShowOnlyUncontacted(false)}
                    className="mt-3 text-[13px] text-[#1ED4A7] hover:text-[#1ED4A7]/80 font-medium transition-colors"
                  >
                    {t('campaignBuilder.showAllLeads')}
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-white/5">
                {filteredLeads.slice(0, visibleLeadCount).map(lead => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    isSelected={selectedLeadSet.has(lead.id)}
                    onToggle={toggleLeadSelection}
                  />
                ))}
                {(visibleLeadCount < filteredLeads.length || hasMoreLeads) && (
                  <div className="p-3 text-center">
                    {loadingMoreLeads ? (
                      <div className="flex items-center justify-center gap-2 text-zinc-400 text-[13px]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('campaignBuilder.loadingMoreLeads')}
                      </div>
                    ) : visibleLeadCount < filteredLeads.length ? (
                      <button
                        onClick={() => setVisibleLeadCount(prev => Math.min(prev + 100, filteredLeads.length))}
                        className="text-[13px] text-[#1ED4A7] hover:text-[#1ED4A7]/80 font-medium transition-colors"
                      >
                        {t('campaignBuilder.showMore', { count: (filteredLeads.length - visibleLeadCount).toString() })}
                      </button>
                    ) : hasMoreLeads ? (
                      <button
                        onClick={loadMoreLeads}
                        className="text-[13px] text-[#1ED4A7] hover:text-[#1ED4A7]/80 font-medium transition-colors"
                      >
                        {t('campaignBuilder.loadMoreFromServer', { count: (totalLeadCount - filteredLeads.length).toLocaleString() })}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Groups section hidden for now */}

          {/* Spacer to push CTA to bottom */}
          <div className="h-4" />

          {/* Sticky CTA */}
          <div className="sticky bottom-0 mt-auto -mx-4 sm:-mx-7 px-4 sm:px-7 pt-3 pb-4 sm:pb-7 bg-[var(--background)] border-t border-[var(--border)] z-10 -mb-4 sm:-mb-7 flex gap-3">
            <button
              onClick={() => setStep('details')}
              className="px-5 py-3 text-[14px] font-medium border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-950 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-all active:scale-[0.98] min-h-[44px]"
            >
              {t('campaignBuilder.back')}
            </button>
            <button
              onClick={generatePreview}
              disabled={loading || selectedLeads.length === 0}
              className="flex-1 flex items-center justify-center gap-2.5 px-5 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[14px] font-semibold rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-100 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] whitespace-nowrap min-h-[44px]"
            >
              <Sparkles className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
              <span className="truncate">
                {loading ? t('campaignBuilder.generating') : loadingGroupLeads ? t('campaignBuilder.loadingLeadsBtn') : (
                  <>
                    <span className="sm:hidden">{t('campaignBuilder.preview')}</span>
                    <span className="hidden sm:inline">{t('campaignBuilder.generateAIPreview')}</span>
                    {selectedLeads.length > 0 && ` (${selectedLeads.length})`}
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && previewEmail && (
        <div className="space-y-5 flex-1 flex flex-col">
          <div className="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-zinc-700 dark:text-zinc-300 text-[13px] leading-relaxed pt-1">
                  {t('campaignBuilder.previewFor')} <span className="font-semibold text-zinc-900 dark:text-white">{previewLeadName}</span>. {t('campaignBuilder.eachLeadUnique')}
                  {campaign.customInstructions && (
                    <span className="text-zinc-400 dark:text-zinc-500"> · {t('campaignBuilder.usingCustomInstructions')}</span>
                  )}
                  {campaign.exampleEmail && (
                    <span className="text-zinc-400 dark:text-zinc-500"> · {t('campaignBuilder.mimickingExampleStyle')}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => { setStep('details'); }}
                className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white underline hover:no-underline transition-colors flex-shrink-0 mt-1"
              >
                {t('campaignBuilder.editInstructions')}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-zinc-600 dark:text-zinc-400 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.subject')} <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-600">{t('campaignBuilder.editable')}</span></label>
              <div className="flex items-center gap-2">
                <TokenInserter
                  compact
                  previewText={previewEmail.subject}
                  onInsert={(tag) => setPreviewEmail({ ...previewEmail, subject: previewEmail.subject + tag })}
                />
                <button
                  onClick={() => setShowTemplateLibrary(true)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-lg transition-colors"
                >
                  <FileText className="w-3 h-3" />
                  {t('campaignBuilder.templates')}
                </button>
              </div>
            </div>
            <input
              type="text"
              value={previewEmail.subject}
              onChange={e => setPreviewEmail({ ...previewEmail, subject: e.target.value })}
              className="w-full px-4 py-3 text-[14px] font-medium border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
            />
          </div>

          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-2 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.previewText')} <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-600">{t('campaignBuilder.editable')}</span></label>
            <input
              type="text"
              value={previewEmail.preview}
              onChange={e => setPreviewEmail({ ...previewEmail, preview: e.target.value })}
              className="w-full px-4 py-3 text-[14px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-zinc-600 dark:text-zinc-400 font-medium tracking-wide uppercase text-[11px]">{t('campaignBuilder.body')} <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-600">{t('campaignBuilder.editable')}</span></label>
              <div className="flex items-center gap-2">
                <TokenInserter
                  compact
                  previewText={previewEmail.body}
                  onInsert={(tag) => setPreviewEmail({ ...previewEmail, body: previewEmail.body + tag })}
                />
                <button
                  onClick={generatePreview}
                  disabled={loading}
                  className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1 transition-colors"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {t('campaignBuilder.regenerate')}
                </button>
              </div>
            </div>
            <div className="px-5 py-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl shadow-sm">
              <div 
                className="text-[14px] text-zinc-900 dark:text-white leading-relaxed outline-none min-h-[120px]"
                contentEditable
                suppressContentEditableWarning
                onBlur={e => setPreviewEmail({ ...previewEmail, body: e.currentTarget.innerHTML })}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewEmail.body) }}
              />
            </div>
            <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
              {t('campaignBuilder.editBodyNote')}
            </p>
          </div>

          {/* CC/BCC Summary */}
          {(campaign.cc.trim() || campaign.bcc.trim()) && (
            <div className="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10">
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">{t('campaignBuilder.ccBccSummary', 'CC / BCC')}</p>
              {campaign.cc.trim() && (
                <p className="text-[13px] text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium text-zinc-500 dark:text-zinc-400 mr-1.5">{t('campaignBuilder.ccLabel', 'CC')}:</span>
                  {campaign.cc.trim()}
                </p>
              )}
              {campaign.bcc.trim() && (
                <p className="text-[13px] text-zinc-700 dark:text-zinc-300 mt-1">
                  <span className="font-medium text-zinc-500 dark:text-zinc-400 mr-1.5">{t('campaignBuilder.bccLabel', 'BCC')}:</span>
                  {campaign.bcc.trim()}
                </p>
              )}
            </div>
          )}

          {/* Attachments Summary */}
          {attachments.length > 0 && (
            <div className="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Paperclip className="w-3 h-3" />
                  {t('campaignBuilder.attachmentsSummary', { count: attachments.length })}
                </p>
                <button
                  onClick={() => setStep('details')}
                  className="text-[11px] font-medium text-zinc-400 hover:text-zinc-900 dark:hover:text-white underline hover:no-underline transition-colors"
                >
                  {t('campaignBuilder.edit')}
                </button>
              </div>
              <div className="space-y-1">
                {attachments.map(att => (
                  <div key={att.id} className="flex items-center gap-2 text-[13px]">
                    <span className="text-[12px] flex-shrink-0">{getFileIcon(att.type)}</span>
                    <span className="text-zinc-700 dark:text-zinc-300 truncate">{att.filename}</span>
                    <span className="text-zinc-400 dark:text-zinc-500 text-[11px] flex-shrink-0">{formatFileSize(att.size)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-2">
                {t('campaignBuilder.attachmentsTotalSent', { size: formatFileSize(attachments.reduce((s, a) => s + a.size, 0)) })}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2">
            {/* Send Now / Schedule */}
            <SchedulePicker
              value={scheduleValue}
              onChange={setScheduleValue}
              itemLabel={t('campaignBuilder.emailsItemLabel', 'emails')}
              itemCount={selectedLeads.length}
            />

            {/* Follow-Up Automation */}
            <div className="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10">
              <div className="flex items-start justify-between mb-3 gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-zinc-900 dark:text-white mb-1">
                    {t('campaignBuilder.automatedFollowUps')}
                  </p>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
                    {enableFollowUps 
                      ? t('campaignBuilder.followUpDesc', { max: maxFollowUps, days: followUpDays })
                      : t('campaignBuilder.noFollowUps')
                    }
                  </p>
                </div>
                <div className={`relative w-10 h-[22px] rounded-full transition-colors cursor-pointer flex-shrink-0 mt-0.5 ${enableFollowUps ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-white/15'}`}
                  onClick={() => setEnableFollowUps(!enableFollowUps)}>
                  <div className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${enableFollowUps ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                </div>
              </div>

              {enableFollowUps && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-zinc-200 dark:border-white/10">
                  <div>
                    <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[10px]">
                      {t('campaignBuilder.daysBetweenFollowUps')}
                    </label>
                    <select
                      value={followUpDays}
                      onChange={(e) => setFollowUpDays(Number(e.target.value))}
                      className="w-full px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                    >
                      <option value={2}>{t('campaignBuilder.days2')}</option>
                      <option value={3}>{t('campaignBuilder.days3')}</option>
                      <option value={5}>{t('campaignBuilder.days5')}</option>
                      <option value={7}>{t('campaignBuilder.days7')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[10px]">
                      {t('campaignBuilder.maxFollowUpsLabel')}
                    </label>
                    <select
                      value={maxFollowUps}
                      onChange={(e) => setMaxFollowUps(Number(e.target.value))}
                      className="w-full px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-900 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                    >
                      <option value={1}>{t('campaignBuilder.followUp1')}</option>
                      <option value={2}>{t('campaignBuilder.followUp2')}</option>
                      <option value={3}>{t('campaignBuilder.followUp3')}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Spacer so sticky CTA doesn't overlap content */}
            <div className="flex-1 min-h-[16px]" />
            {/* Sticky CTA */}
            <div className="sticky bottom-0 mt-auto -mx-4 sm:-mx-7 px-4 sm:px-7 pt-3 pb-4 sm:pb-7 bg-[var(--background)] border-t border-[var(--border)] z-10 -mb-4 sm:-mb-7 flex gap-3">
              <button
                onClick={() => setStep('leads')}
                className="px-5 py-3 text-[14px] font-medium border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-950 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-all active:scale-[0.98]"
              >
                {t('campaignBuilder.back')}
              </button>
              <button
                onClick={createCampaign}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2.5 px-5 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[14px] font-semibold rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-100 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] whitespace-nowrap"
              >
                {sendImmediately ? <Send className="w-4 h-4 flex-shrink-0" strokeWidth={2} /> : <Clock className="w-4 h-4 flex-shrink-0" strokeWidth={2} />}
                <span className="truncate">
                  {loading ? (sendImmediately ? t('campaignBuilder.launching') : t('campaignBuilder.scheduling')) : (
                    <>
                      <span className="sm:hidden">{sendImmediately ? t('campaignBuilder.launch') : t('campaignBuilder.scheduleSchedule')}</span>
                      <span className="hidden sm:inline">{sendImmediately ? t('campaignBuilder.launchCampaignBtn') : t('campaignBuilder.scheduleCampaignBtn')}</span>
                      {selectedLeads.length > 0 && ` (${selectedLeads.length})`}
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Groups Manager Modal — hidden for now */}

      {/* Template Library slide-out */}
      <TemplateLibrary
        open={showTemplateLibrary}
        onClose={() => setShowTemplateLibrary(false)}
        onInsert={(subject, body) => {
          if (previewEmail) {
            setPreviewEmail({ ...previewEmail, subject: subject || previewEmail.subject, body: body || previewEmail.body });
          }
        }}
      />
    </div>
  );
}
