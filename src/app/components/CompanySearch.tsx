import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Search, MapPin, Building2, Loader2, Globe, Copy, Phone, ChevronDown,
  Download, Linkedin, Users, Check, X, Hash, Factory, DollarSign,
  Sparkles, ChevronRight, ArrowUpDown, Briefcase, Zap, ExternalLink, UserCircle, Mail, ShieldCheck,
  Bookmark, Trash2, Clock, UserPlus, Radar, Database, CheckCircle, RefreshCw, PenLine,
  RotateCcw, Lightbulb, ArrowRight, Flame, Filter, BookmarkPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { toTitleCase } from '../utils/title-case';
import { saveFinderCache, loadFinderCache, clearFinderCache, clearAllFinderCaches, CACHE_KEYS, addSearchHistory, getSearchHistory, removeSearchHistoryEntry, type SearchHistoryEntry } from '../lib/finder-cache';
import { LeadScoreBadge } from './LeadScoreBadge';
import { CompanyLogo, clearCompanyLogoCache } from './CompanyLogo';
import { buildCompanyCsv } from '../utils/csv-export';
import { LocationPicker, buildLocationStrings, type LocationPickerValue } from './LocationPicker';
import { useDemoMode, DEMO_COMPANY_RESULTS } from './DemoContext';
import { SmartPhoneButton } from './SmartPhoneButton';
import { useTranslation } from 'react-i18next';
import { translatePhaseName, translateActivityMessage } from '../lib/translate-server-text';
import { useIsMobile } from './ui/use-mobile';
import { MobileFilterSheet } from './ui/mobile-filter-sheet';
import { useScrollHeader } from '../hooks/useScrollHeader';
// companyFallbackIcon removed — replaced by teal company initials placeholder

// ── Types ──

interface Company {
  id: string;
  name: string;
  website_url: string;
  linkedin_url: string;
  industry: string;
  estimated_num_employees: number;
  annual_revenue_printed: string;
  city: string;
  state: string;
  country: string;
  short_description: string;
  founded_year: number;
  phone: string;
  logo_url: string;
  rating?: number;
  reviews_count?: number;
  address?: string;
  // Enhanced enrichment fields
  legal_name?: string;
  company_type?: string;
  incorporation_date?: string;
  company_status?: string;
  sec_ticker?: string;
  sec_sic?: string;
  tech_stack?: { name: string; category: string }[];
  social_links?: Record<string, string>;
  careers_count?: number;
  officers?: { name: string; position: string }[];
  data_sources?: string[];
}

interface Person {
  id: string;
  name: string;
  title: string;
  linkedin_url: string;
  snippet: string;
  company_match: string;
  location?: string;
  phone?: string;
}

interface CrmContact {
  id: string;
  contact_name: string;
  email: string;
  phone: string;
  job_title: string;
  business_name: string;
  linkedin: string;
  industry: string;
  employees: string;
  annual_revenue: string;
  city: string;
  state: string;
  country: string;
  website: string;
  source: string;
}

interface CompanySearchProps {
  onUpgrade?: () => void;
}

// ── Constants ──

// Location data moved to LocationPicker component

const INDUSTRY_OPTIONS = [
  'Accounting', 'Advertising', 'Aerospace & Defense', 'Agriculture',
  'Architecture & Planning', 'Automotive', 'Banking', 'Biotechnology',
  'Building Materials', 'Business Supplies & Equipment', 'Civil Engineering',
  'Computer Software', 'Construction', 'Consumer Electronics', 'Consumer Services',
  'Design', 'E-Learning', 'Education Management', 'Electrical & Electronic Manufacturing',
  'Entertainment', 'Environmental Services', 'Events Services', 'Facilities Services',
  'Financial Services', 'Food & Beverages', 'Health, Wellness & Fitness',
  'Hospital & Health Care', 'Hospitality', 'Human Resources', 'Industrial Automation',
  'Information Technology & Services', 'Insurance', 'Internet', 'Law Practice',
  'Legal Services', 'Logistics & Supply Chain', 'Management Consulting',
  'Marketing & Advertising', 'Mechanical or Industrial Engineering',
  'Medical Devices', 'Medical Practice', 'Mining & Metals',
  'Non-Profit Organization Management', 'Oil & Energy', 'Pharmaceuticals',
  'Professional Training & Coaching', 'Real Estate', 'Renewables & Environment',
  'Research', 'Restaurants', 'Retail', 'Security & Investigations',
  'Staffing & Recruiting', 'Telecommunications', 'Transportation/Trucking/Railroad',
  'Utilities', 'Venture Capital & Private Equity', 'Wholesale',
];

const EMPLOYEE_RANGES = [
  { value: '1,10', label: '1-10' },
  { value: '11,20', label: '11-20' },
  { value: '21,50', label: '21-50' },
  { value: '51,100', label: '51-100' },
  { value: '101,200', label: '101-200' },
  { value: '201,500', label: '201-500' },
  { value: '501,1000', label: '501-1K' },
  { value: '1001,2000', label: '1K-2K' },
  { value: '2001,5000', label: '2K-5K' },
  { value: '5001,10000', label: '5K-10K' },
  { value: '10001,', label: '10K+' },
];

// ── Helpers ──

/** Show only the clean domain for display (e.g. "www.example.com") */
function displayDomain(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    // Fallback: strip protocol, path, and params
    return url.replace(/^https?:\/\//, '').replace(/[?#\/].*$/, '');
  }
}

function formatEmployeeCount(count: number): string {
  if (!count || count <= 0) return '';
  if (count >= 10000) return `${Math.round(count / 1000)}K`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return count.toLocaleString();
}

function formatPhoneNumber(raw: string): string {
  if (!raw) return '';
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10 && !digits.startsWith('0')) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (hasPlus || digits.length > 10) {
    const cc = digits.length >= 12 ? digits.slice(0, 2) : digits.slice(0, 1);
    const rest = digits.slice(cc.length);
    const groups: string[] = [];
    for (let i = 0; i < rest.length; i += 3) groups.push(rest.slice(i, i + 3));
    return `+${cc} ${groups.join(' ')}`;
  }
  return (hasPlus ? '+' : '') + digits.replace(/(\d{3,4})(?=\d)/g, '$1 ');
}

// ── Location matching helper (client-side) ──
const STATE_ABBREVS: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri',
  mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey',
  nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio',
  ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
  sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
  va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
  dc: 'district of columbia',
};
function isPersonInArea(personLocation: string | undefined, targetLocation: string): boolean {
  if (!personLocation || !targetLocation) return false;
  const pLoc = personLocation.toLowerCase().replace(/\s+area$/, '').trim();
  const tLoc = targetLocation.toLowerCase().trim();
  if (pLoc.includes(tLoc) || tLoc.includes(pLoc)) return true;
  const pParts = pLoc.split(',').map(s => s.trim());
  const tParts = tLoc.split(',').map(s => s.trim());
  const pState = pParts[pParts.length - 1] || '';
  const tState = tParts[tParts.length - 1] || '';
  const expand = (s: string) => STATE_ABBREVS[s] || s;
  if (pState && tState && expand(pState) === expand(tState)) return true;
  for (const [abbr, full] of Object.entries(STATE_ABBREVS)) {
    if ((pLoc.includes(full) && (tLoc.includes(full) || tLoc.includes(abbr))) ||
        (tLoc.includes(full) && pLoc.includes(abbr))) return true;
  }
  return false;
}

// ── Company Lead Score (mirrors people lead score paradigm) ──
function computeCompanyScore(
  company: Company,
  batchEnrich?: any,
  crmContacts?: CrmContact[],
): number {
  let score = 0;

  // Data completeness (0-25)
  const fields = [company.name, company.website_url, company.industry, company.short_description, company.phone, company.city || company.country, company.linkedin_url];
  const filled = fields.filter(f => f && String(f).trim().length > 0).length;
  score += Math.round((filled / fields.length) * 25);

  // Business signals (0-30)
  const empCount = company.estimated_num_employees || batchEnrich?.employees || 0;
  const rev = company.annual_revenue_printed || batchEnrich?.revenue || '';
  if (empCount > 0) score += 8;
  if (empCount > 50) score += 4;
  if (empCount > 500) score += 3;
  if (rev) score += 8;
  if (company.rating && company.rating >= 4) score += 4;
  else if (company.rating && company.rating >= 3) score += 2;
  if (company.reviews_count && company.reviews_count > 10) score += 3;

  // Contact quality (0-20)
  if (company.website_url) score += 6;
  if (company.linkedin_url) score += 6;
  if (company.phone) score += 5;
  if (company.founded_year || batchEnrich?.founded_year) score += 3;

  // CRM & enrichment (0-15)
  if (crmContacts && crmContacts.length > 0) score += 8;
  if (batchEnrich && Object.keys(batchEnrich).length > 0) score += 4;
  const ind = company.industry || batchEnrich?.industry || '';
  if (ind) score += 3;

  // Bonus for description (0-10)
  const desc = company.short_description || batchEnrich?.description || '';
  if (desc && desc.length > 30) score += 6;
  else if (desc) score += 3;
  if (company.address) score += 2;

  // Enhanced enrichment bonus (0-15)
  if (company.legal_name || company.company_type) score += 3;       // verified legal entity
  if (company.sec_ticker) score += 4;                               // public company = high signal
  if (company.company_status?.toLowerCase() === 'active') score += 2;
  if (company.tech_stack && company.tech_stack.length > 0) score += 3; // tech stack = digital footprint
  if (company.careers_count && company.careers_count > 0) score += 3;  // hiring = growing company
  if (company.data_sources && company.data_sources.length > 2) score += 2; // multi-source verified

  return Math.min(Math.max(score, 0), 100);
}

type SortField = 'name' | 'industry' | 'employees' | 'revenue' | 'score' | 'location';

// ── Agent Feed Types ──
interface SearchPhase {
  phase: number;
  name: string;
  status: 'pending' | 'searching' | 'complete' | 'skipped';
}

interface ActivityEntry {
  id: number;
  message: string;
  type: 'info' | 'success' | 'warn';
  ts: number;
}

// ── Agent Feed Keyframes ──
const companyAgentKeyframes = `
@keyframes companyEntryIn {
  0%   { opacity: 0; transform: translateY(8px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes companyCursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes companyPulseRing {
  0%   { box-shadow: 0 0 0 0 rgba(30,212,167,0.35); }
  70%  { box-shadow: 0 0 0 8px rgba(30,212,167,0); }
  100% { box-shadow: 0 0 0 0 rgba(30,212,167,0); }
}
@keyframes companyScanLine {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

// ── Activity Icon Resolver ──
function companyActivityIcon(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('business director') || m.includes('searching') || m.includes('querying') || m.includes('discover')) return <Globe className="w-3.5 h-3.5" />;
  if (m.includes('crm') || m.includes('cross-referenc')) return <Database className="w-3.5 h-3.5" />;
  if (m.includes('enrich') || m.includes('deep enrich') || m.includes('company data')) return <Zap className="w-3.5 h-3.5" />;
  if (m.includes('email') || m.includes('contact')) return <Mail className="w-3.5 h-3.5" />;
  if (m.includes('decision maker') || m.includes('people') || m.includes('profile')) return <Users className="w-3.5 h-3.5" />;
  if (m.includes('found') || m.includes('complet') || m.includes('discover')) return <CheckCircle className="w-3.5 h-3.5" />;
  if (m.includes('filter') || m.includes('prepar') || m.includes('initializ')) return <Search className="w-3.5 h-3.5" />;
  if (m.includes('process') || m.includes('pars') || m.includes('organiz')) return <Factory className="w-3.5 h-3.5" />;
  return <Search className="w-3.5 h-3.5" />;
}

// ── Company Agent Feed — Full-page live activity feed during company search ──
function CompanyAgentFeed({
  entries,
  isSearching,
  phases,
}: {
  entries: ActivityEntry[];
  isSearching: boolean;
  phases: SearchPhase[];
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 48);
  };

  const activePhase = phases.find(p => p.status === 'searching');
  const completedPhases = phases.filter(p => p.status === 'complete').length;
  const totalPhases = Math.max(phases.length, 1);
  const pct = Math.round((completedPhases / totalPhases) * 100);

  return (
    <div className="h-full flex flex-col px-4 sm:px-6 pt-3 pb-4">
      <style>{companyAgentKeyframes}</style>

      {/* ── Header ── */}
      <div className="flex-shrink-0 pb-3">
        <div className="flex items-center gap-3 mb-5">
          <div className="relative">
            <div
              className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white/10 flex items-center justify-center"
              style={isSearching ? { animation: 'companyPulseRing 2s ease infinite' } : undefined}
            >
              <Radar className={`w-5 h-5 text-[#1ED4A7] ${isSearching ? 'animate-pulse' : ''}`} />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-main)] tracking-tight">{t('leadFinder.companyDiscoveryAgent')}</h3>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {isSearching
                ? (activePhase ? translatePhaseName(t, activePhase.name) : t('leadFinder.working'))
                : `${t('leadFinder.complete')} — ${entries.length} ${t('leadFinder.operationsPerformed')}`
              }
            </p>
          </div>
          <div className="ml-auto">
            <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600 tabular-nums">
              {pct}%
            </span>
          </div>
        </div>

        {/* Progress rail */}
        <div className="relative h-[3px] rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#1ED4A7] transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
          {isSearching && (
            <div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              style={{ animation: 'companyScanLine 2s ease-in-out infinite' }}
            />
          )}
        </div>

        {/* Phase chips */}
        {phases.length > 0 && (
          <div className="flex items-center gap-1.5 mt-4 overflow-x-auto no-scrollbar pb-1">
            {phases.map((phase, i) => {
              const isActive = phase.status === 'searching';
              const isDone = phase.status === 'complete';
              const isSkipped = phase.status === 'skipped';
              return (
                <div key={phase.phase} className="contents">
                  {i > 0 && (
                    <div className={`w-4 h-px flex-shrink-0 transition-colors duration-500 ${isDone ? 'bg-[#1ED4A7]/40' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                  )}
                  <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg flex-shrink-0 text-[10px] font-medium transition-all duration-300 ${
                    isActive ? 'bg-[#1ED4A7]/8 text-[var(--text-main)] ring-1 ring-[#1ED4A7]/25' :
                    isDone ? 'bg-zinc-50 dark:bg-zinc-900/50 text-[#1ED4A7]' :
                    isSkipped ? 'bg-zinc-50 dark:bg-zinc-900/30 text-zinc-400 dark:text-zinc-600 line-through' :
                    'bg-zinc-50 dark:bg-zinc-900/30 text-zinc-400 dark:text-zinc-600'
                  }`}>
                    {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isDone && <CheckCircle className="w-3 h-3" />}
                    {!isActive && !isDone && <div className="w-1.5 h-1.5 rounded-full border border-current" />}
                    <span className="whitespace-nowrap">{translatePhaseName(t, phase.name)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="flex-shrink-0 mx-6 md:mx-8 border-t border-zinc-100 dark:border-zinc-800/60" />

      {/* ── Feed ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 px-4 md:px-6"
      >
        <div className="py-3 space-y-0.5 max-w-xl mx-auto">
          {entries.map((entry, i) => {
            const isLatest = i === entries.length - 1 && isSearching;
            const icon = companyActivityIcon(entry.message);
            return (
              <div
                key={entry.id}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${
                  isLatest
                    ? 'bg-[#1ED4A7]/[0.04] dark:bg-[#1ED4A7]/[0.04]'
                    : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20'
                }`}
                style={{ animation: 'companyEntryIn 0.35s cubic-bezier(0.16,1,0.3,1) both' }}
              >
                {/* Icon */}
                <div className={`flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                  entry.type === 'success'
                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                    : entry.type === 'warn'
                    ? 'bg-zinc-500/10 text-zinc-500'
                    : isLatest
                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                    : 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600'
                }`}>
                  {icon}
                </div>

                {/* Message */}
                <div className="flex-1 min-w-0 pt-1">
                  <p className={`text-[12.5px] leading-relaxed ${
                    isLatest
                      ? 'text-zinc-800 dark:text-zinc-100 font-medium'
                      : entry.type === 'success'
                      ? 'text-zinc-700 dark:text-zinc-300'
                      : entry.type === 'warn'
                      ? 'text-zinc-600 dark:text-zinc-400'
                      : 'text-zinc-500 dark:text-zinc-500'
                  }`}>
                    {translateActivityMessage(t, entry.message)}
                    {isLatest && (
                      <span
                        className="inline-block w-[2px] h-[13px] ml-1 align-middle rounded-full bg-[#1ED4A7]"
                        style={{ animation: 'companyCursorBlink 0.8s steps(2) infinite' }}
                      />
                    )}
                  </p>
                </div>

                {/* Active indicator */}
                <div className="flex-shrink-0 pt-1.5 flex items-center gap-1.5">
                  {isLatest && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}

          {/* Initial waiting */}
          {isSearching && entries.length === 0 && (
            <div className="flex items-center gap-3 px-3 py-6 justify-center">
              <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center animate-pulse">
                <Radar className="w-4 h-4 text-[#1ED4A7]" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">{t('leadFinder.initializingAgent')}</p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{t('leadFinder.connectingToDataSources')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex-shrink-0 px-6 md:px-8 py-3 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
          {entries.length} {t('leadFinder.operations')}{phases.length > 0 ? ` · ${completedPhases}/${phases.length} ${t('leadFinder.phases')}` : ''}
        </span>
        {isSearching && activePhase && (
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-[#1ED4A7] animate-pulse" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[200px]">
              {activePhase.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component ──

export function CompanySearch({ onUpgrade }: CompanySearchProps) {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { scrollRef: mainScrollRef, headerClass } = useScrollHeader(10, true);
  
  // Search
  const [companyName, setCompanyName] = useState('');
  const [locationValue, setLocationValue] = useState<LocationPickerValue>({ country: 'United States', state: '', cities: [] });
  const [keywords, setKeywords] = useState('');
  const [industries, setIndustries] = useState<Set<string>>(new Set());
  const [employeeRanges, setEmployeeRanges] = useState<Set<string>>(new Set());
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allResults, setAllResults] = useState<Company[]>([]); // Accumulated results across pages

  // Results
  const [results, setResults] = useState<Company[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingSuggestionSearch, setPendingSuggestionSearch] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // AI Suggestions & Search History
  const [aiSuggestions, setAiSuggestions] = useState<any>(null);
  const [loadingAiSuggestions, setLoadingAiSuggestions] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);

  // UI
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resultSearch, setResultSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // Save / Load
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveListName, setSaveListName] = useState('');
  const [savingList, setSavingList] = useState(false);
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [showSavedLists, setShowSavedLists] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);

  // Auto-enrichment (batch deep enrich after search)
  const [batchEnrichMap, setBatchEnrichMap] = useState<Record<string, any>>({});
  const [isAutoEnriching, setIsAutoEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState('');

  // CRM cross-reference
  const [crmContactsMap, setCrmContactsMap] = useState<Record<string, CrmContact[]>>({});

  // Bulk Find People
  const [isBulkFindingPeople, setIsBulkFindingPeople] = useState(false);
  const [bulkPeopleMap, setBulkPeopleMap] = useState<Record<string, { people: Person[]; emailMap: Record<string, { email: string; source: string; confidence: string }> }>>({});
  const [bulkFindProgress, setBulkFindProgress] = useState('');

  // Brand enrichment (Brandfetch / SerpAPI logos)
  const [brandMap, setBrandMap] = useState<Record<string, { logo_url?: string; icon_url?: string; name?: string; colors?: { hex: string; type: string }[]; source?: string }>>({});
  const brandFetchedRef = useRef<Set<string>>(new Set());

  // Agent feed (step-by-step progress)
  const [searchPhases, setSearchPhases] = useState<SearchPhase[]>([]);
  const [searchActivity, setSearchActivity] = useState<ActivityEntry[]>([]);
  const searchActivityIdRef = useRef(0);
  const [agentActive, setAgentActive] = useState(false);

  const addActivity = useCallback((message: string, type: 'info' | 'success' | 'warn' = 'info') => {
    setSearchActivity(prev => {
      const next = [...prev, { id: ++searchActivityIdRef.current, message, type, ts: Date.now() }];
      return next.length > 50 ? next.slice(-50) : next;
    });
  }, []);

  const updatePhase = useCallback((phase: number, updates: Partial<SearchPhase>) => {
    setSearchPhases(prev => prev.map(p => p.phase === phase ? { ...p, ...updates } : p));
  }, []);

  // Industry picker
  const [industrySearch, setIndustrySearch] = useState('');
  const [showIndustryPicker, setShowIndustryPicker] = useState(false);
  const industryRef = useRef<HTMLDivElement>(null);

  // Location picker (cascading country → state → city)

  // Pool intelligence
  const [poolStats, setPoolStats] = useState<any>(null);
  const [showPoolStats, setShowPoolStats] = useState(false);
  const [poolCoverageMap, setPoolCoverageMap] = useState<Record<string, any>>({});

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (industryRef.current && !industryRef.current.contains(e.target as Node)) setShowIndustryPicker(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleEmployeeRange = (v: string) => {
    setEmployeeRanges(prev => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  };

  const toggleIndustry = (v: string) => {
    setIndustries(prev => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  };

  // ── Search ──
  const handleSearch = useCallback(async (e?: React.FormEvent, pageOverride?: number, appendMode = false) => {
    if (e) e.preventDefault();
    const currentPage = pageOverride || 1;
    const hasLocation = !!locationValue.country;
    if (!companyName && !hasLocation && !keywords && industries.size === 0) {
      toast.error(t('leadFinder.toastPleaseEnterFilter'));
      return;
    }

    // ── Demo Mode: Return mock results ──
    if (isDemoMode) {
      console.log('[COMPANY SEARCH DEMO] Returning demo results');
      setIsSearching(true);
      setResults([]);
      
      setTimeout(() => {
        const demoCompanies = DEMO_COMPANY_RESULTS.map(c => ({
          id: c.id,
          name: c.name,
          website_url: c.domain,
          linkedin_url: `https://linkedin.com/company/${c.domain.replace('.', '-')}`,
          industry: c.industry,
          estimated_num_employees: parseInt(c.employees.split('-')[0]),
          annual_revenue_printed: c.revenue,
          city: c.location.split(', ')[0],
          state: c.location.split(', ')[1] || '',
          country: 'United States',
          short_description: c.description,
          founded_year: parseInt(c.founded),
          phone: '',
          logo_url: '',
          tech_stack: c.technologies.map(t => ({ name: t, category: 'Technology' })),
        }));
        
        setResults(demoCompanies);
        setAllResults(demoCompanies);
        setIsSearching(false);
        setHasSearched(true);
        setPage(1);
        toast.success(t('leadFinder.toastFoundCompanies', { count: demoCompanies.length }));
      }, 800);
      return;
    }

    if (appendMode) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
    }

    if (currentPage === 1 && !appendMode) {
      setAgentActive(true);
      setResults([]);
      setAllResults([]);
      setSelectedIds(new Set());
      setBatchEnrichMap({});
      clearFinderCache(CACHE_KEYS.LEAD_FINDER_COMPANIES);
      setBulkPeopleMap({});
      setCrmContactsMap({});
      setBrandMap({});
      brandFetchedRef.current = new Set();
      // Clear CompanyLogo's localStorage cache so stale logos from
      // a previous search can't bleed into new results (v3.5.1)
      clearCompanyLogoCache();
      setEnrichProgress('');
      setBulkFindProgress('');
      lastEnrichedRef.current = '';
      // Reset agent feed
      setSearchActivity([]);
      searchActivityIdRef.current = 0;
      setSearchPhases([
        { phase: 0, name: t('leadFinder.phasePreparingSearch'), status: 'searching' },
        { phase: 1, name: t('leadFinder.phaseBusinessDiscovery'), status: 'pending' },
        { phase: 2, name: t('leadFinder.phaseProcessingResults'), status: 'pending' },
        { phase: 3, name: t('leadFinder.phaseCRMCrossReference'), status: 'pending' },
        { phase: 4, name: t('leadFinder.phaseDataEnrichment'), status: 'pending' },
        { phase: 5, name: t('leadFinder.phaseDeepIntelligence'), status: 'pending' },
      ]);
    } else if (!appendMode) {
      // Subsequent pages — light loading without full agent feed
      setBatchEnrichMap({});
      setBulkPeopleMap({});
      lastEnrichedRef.current = '';
    }
    setPage(currentPage);
    setHasSearched(true);
    setAiSuggestions(null);
    setLoadingAiSuggestions(false);

    try {
      const hdrs = await getAuthHeaders();
      if (!hdrs['Authorization']) {
        toast.error(t('leadFinder.toastSessionExpired'));
        setIsSearching(false);
        return;
      }
      const body: any = { page: currentPage, per_page: perPage, append_mode: appendMode };

      if (companyName.trim()) body.q_organization_name = companyName.trim();
      const locationStrings = buildLocationStrings(locationValue);
      if (locationStrings.length > 0) body.organization_locations = locationStrings;
      if (keywords.trim()) body.q_keywords = keywords.trim();
      if (industries.size > 0) body.q_keywords = [keywords, ...industries].filter(Boolean).join(', ');
      if (employeeRanges.size > 0) body.organization_num_employees_ranges = Array.from(employeeRanges);

      // Phase 0: Preparing (only animate on first page)
      if (currentPage === 1) {
        addActivity(t('leadFinder.activityInitializing'), 'info');
        await new Promise(r => setTimeout(r, 100));
        const filterParts: string[] = [];
        if (companyName.trim()) filterParts.push(`name "${companyName.trim()}"`);
        const locStr = buildLocationStrings(locationValue).join(', ');
        if (locStr) filterParts.push(`location "${locStr}"`);
        if (industries.size > 0) filterParts.push(`${industries.size} industri${industries.size === 1 ? 'y' : 'es'}`);
        if (employeeRanges.size > 0) filterParts.push(`${employeeRanges.size} size filter${employeeRanges.size > 1 ? 's' : ''}`);
        if (keywords.trim()) filterParts.push(`keywords "${keywords.trim()}"`);
        addActivity(t('leadFinder.activityFiltersConfigured', { filters: filterParts.join(', ') || t('leadFinder.activityBroadSearch') }), 'info');
        updatePhase(0, { status: 'complete' });

        // Phase 1: Business Discovery
        updatePhase(1, { status: 'searching' });
        addActivity(t('leadFinder.activitySearchingDirectories'), 'info');
        addActivity(`Requesting page ${currentPage} with ${perPage} results per page`, 'info');
      }

      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/search`,
        {
          method: 'POST',
          headers: { ...hdrs, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (currentPage === 1) {
          addActivity(`Search failed: ${err.error || `HTTP ${res.status}`}`, 'warn');
          updatePhase(1, { status: 'skipped' });
        }
        throw new Error(err.error || `Search failed (${res.status})`);
      }

      const data = await res.json();
      const orgs = data.organizations || [];

      // Extract inline brand logos from server response (avoids separate API call)
      const inlineBrands: Record<string, { logo_url?: string; source?: string }> = {};
      for (const co of orgs) {
        if (co.brand_logo_url && co.website_url) {
          const domain = (co.website_url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').toLowerCase().trim();
          if (domain) {
            const src = co.brand_logo_source || 'server';
            inlineBrands[domain] = { logo_url: co.brand_logo_url, source: src };
            // Only mark as fetched if it's a real Brandfetch/SerpAPI logo — favicon fallbacks
            // should still be upgradeable by the batch enrichment effect
            if (src !== 'favicon') {
              brandFetchedRef.current.add(domain);
            }
          }
        }
      }
      if (Object.keys(inlineBrands).length > 0) {
        setBrandMap(prev => ({ ...prev, ...inlineBrands }));
      }

      if (appendMode) {
        // Append new results, dedup by id
        setAllResults(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newOrgs = orgs.filter((c: Company) => !existingIds.has(c.id));
          const combined = [...prev, ...newOrgs];
          setResults(combined);
          return combined;
        });
        if (data.crm_contacts) setCrmContactsMap(prev => ({ ...prev, ...data.crm_contacts }));
      } else {
        setResults(orgs);
        setAllResults(orgs);
        if (data.crm_contacts) setCrmContactsMap(data.crm_contacts);
      }
      setPagination(data.pagination || null);

      // Auto-collapse sidebar on mobile after search to show results
      if (currentPage === 1 && orgs.length > 0 && window.innerWidth < 768) {
        setSidebarCollapsed(true);
      }

      if (currentPage === 1) {
        updatePhase(1, { status: 'complete' });
        addActivity(t('leadFinder.activityDiscovered', { count: orgs.length }), 'success');

        // Phase 2: Processing Results
        updatePhase(2, { status: 'searching' });
        addActivity(t('leadFinder.activityParsingProfiles'), 'info');
        if (data.pagination) {
          addActivity(`Page ${data.pagination.page || currentPage} of ${data.pagination.total_pages || 1} — ${data.pagination.total_entries || orgs.length} total results`, 'info');
        }
        updatePhase(2, { status: 'complete' });
        addActivity(`Organized ${orgs.length} company profiles`, 'success');

        // Phase 3: CRM Cross-Reference
        updatePhase(3, { status: 'searching' });
        addActivity('Cross-referencing companies against your CRM...', 'info');
        if (data.crm_contacts) {
          const matchCount = Object.keys(data.crm_contacts).length;
          if (matchCount > 0) {
            addActivity(`Found ${matchCount} CRM matches via domain indexing`, 'success');
          } else {
            addActivity('No existing CRM matches found for these companies', 'info');
          }
        } else {
          addActivity('CRM cross-reference complete — no matches', 'info');
        }
        updatePhase(3, { status: 'complete' });

        // Save to search history
        addSearchHistory({
          params: {
            companyName: companyName.trim(),
            locationValue,
            keywords: keywords.trim(),
            industries: Array.from(industries),
            employeeRanges: Array.from(employeeRanges),
          },
          resultCount: orgs.length,
          timestamp: Date.now(),
        });
        setSearchHistory(getSearchHistory());

        // If 0 results, mark enrichment phases as skipped and deactivate agent
        if (orgs.length === 0) {
          updatePhase(4, { status: 'skipped' });
          updatePhase(5, { status: 'skipped' });
          addActivity('No companies found — try broadening your search (e.g. remove keywords or adjust location)', 'warn');
          setAgentActive(false);

          // Fetch AI-powered suggestions in background
          setAiSuggestions(null);
          setLoadingAiSuggestions(true);
          fetchAiSuggestions(companyName.trim(), buildLocationStrings(locationValue).join(', '), keywords.trim(), Array.from(industries));
        } else {
          // Phase 4 will be triggered by auto-enrich in useEffect
          addActivity('Company search complete — starting enrichment...', 'success');
        }
      }
    } catch (err: any) {
      console.error('[COMPANY SEARCH] Error:', err);
      toast.error(err.message || t('leadFinder.toastCompanySearchFailed'));
      if (currentPage === 1) {
        addActivity(`Error: ${err.message || 'Company search failed'}`, 'warn');
        // Mark remaining phases as skipped
        setSearchPhases(prev => prev.map(p => p.status === 'pending' || p.status === 'searching' ? { ...p, status: 'skipped' as const } : p));
        setAgentActive(false);
      }
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  }, [companyName, locationValue, keywords, industries, employeeRanges, perPage, addActivity, updatePhase]);

  // ── Trigger search after suggestion updates state ──
  useEffect(() => {
    if (pendingSuggestionSearch) {
      setPendingSuggestionSearch(false);
      handleSearch(undefined, 1);
    }
  }, [pendingSuggestionSearch, handleSearch]);

  // ── Fetch AI suggestions for failed searches ──
  const fetchAiSuggestions = async (cn: string, loc: string, kw: string, ind: string[]) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/suggest`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyName: cn, location: loc, keywords: kw, industries: ind }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setAiSuggestions(data.suggestions || null);
      }
    } catch (err) {
      console.error('[AI SUGGEST] Error fetching suggestions:', err);
    } finally {
      setLoadingAiSuggestions(false);
    }
  };

  // ── Load search history on mount ──
  useEffect(() => {
    setSearchHistory(getSearchHistory());
  }, []);

  // ── Auto-enrich companies after search ──
  const autoEnrichCompanies = useCallback(async (companies: Company[]) => {
    // Cap at 10 to stay within edge function CPU budget
    const needsEnrich = companies.filter(c => !c.estimated_num_employees || !c.annual_revenue_printed).slice(0, 10);
    if (needsEnrich.length === 0) {
      updatePhase(4, { status: 'complete' });
      updatePhase(5, { status: 'complete' });
      addActivity('All companies already have full data — enrichment skipped', 'success');
      setAgentActive(false);
      return;
    }

    setIsAutoEnriching(true);
    setEnrichProgress(`Enriching 0/${needsEnrich.length} companies...`);

    // Update agent feed
    updatePhase(4, { status: 'searching' });
    updatePhase(5, { status: 'searching' });
    addActivity(`Starting deep enrichment for ${needsEnrich.length} companies missing data...`, 'info');

    try {
      const headers = await getAuthHeaders();
      if (!headers['Authorization']) {
        console.warn('[ENRICH] No auth token available, skipping enrich-batch');
        addActivity('Session expired — skipping enrichment. Please refresh.', 'error');
        setIsAutoEnriching(false);
        return;
      }
      addActivity(`Enriching employee counts, revenue & industry data...`, 'info');
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/enrich-batch`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(60000), // 60s frontend timeout
          body: JSON.stringify({
            companies: needsEnrich.map(c => ({
              id: c.id,
              name: c.name,
              location: [c.city, c.state, c.country].filter(Boolean).join(', ') || undefined,
              domain: c.website_url ? c.website_url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined,
              estimated_num_employees: c.estimated_num_employees,
              annual_revenue_printed: c.annual_revenue_printed,
            })),
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const enrichResults = data.results || {};
        const poolHits = data.pool_hits || 0;
        const cacheHits = data.cache_hits || 0;
        const apiCalls = data.api_calls || 0;
        
        setBatchEnrichMap(prev => ({ ...prev, ...enrichResults }));

        // Also merge enrichment data back into results for consistent display
        setResults(prev => prev.map(c => {
          const enrich = enrichResults[c.id];
          if (!enrich) return c;
          return {
            ...c,
            estimated_num_employees: c.estimated_num_employees || enrich.employees || 0,
            annual_revenue_printed: c.annual_revenue_printed || enrich.revenue || '',
            founded_year: c.founded_year || enrich.founded_year || 0,
            industry: c.industry || enrich.industry || '',
            short_description: c.short_description || enrich.description || '',
            // Enhanced enrichment fields
            legal_name: c.legal_name || enrich.legal_name,
            company_type: c.company_type || enrich.company_type,
            incorporation_date: c.incorporation_date || enrich.incorporation_date,
            company_status: c.company_status || enrich.company_status,
            sec_ticker: c.sec_ticker || enrich.sec_ticker,
            sec_sic: c.sec_sic || enrich.sec_sic,
            tech_stack: c.tech_stack || enrich.tech_stack,
            social_links: c.social_links || enrich.social_links,
            careers_count: c.careers_count || enrich.careers_count,
            officers: c.officers || enrich.officers,
            data_sources: enrich.data_sources || c.data_sources,
          };
        }));

        const enriched = Object.keys(enrichResults).length;
        const isPartial = data.partial === true;
        if (enriched > 0) {
          setEnrichProgress(`Enriched ${enriched}/${needsEnrich.length} companies${isPartial ? ' (partial)' : ''}`);
          
          // Build pool hit message
          let poolMsg = '';
          if (poolHits > 0) {
            poolMsg = ` (${poolHits} from pool intelligence)`;
          }
          
          if (isPartial) {
            toast.info(`Enriched ${enriched}/${needsEnrich.length} companies${poolMsg} — some skipped due to time limits`);
            addActivity(`Partial enrichment: ${enriched}/${needsEnrich.length} companies enriched${poolHits > 0 ? ` (${poolHits} pool hits)` : ''} (server deadline reached)`, 'warn');
          } else {
            toast.success(`Enriched ${enriched} companies${poolMsg}`);
            if (poolHits > 0) {
              addActivity(`Enriched ${enriched}/${needsEnrich.length} companies — ${poolHits} from pool intelligence, ${apiCalls} API calls`, 'success');
            } else {
              addActivity(`Enriched ${enriched}/${needsEnrich.length} companies with employee count, revenue & industry data`, 'success');
            }
          }
        } else {
          setEnrichProgress('');
          addActivity('Enrichment complete — no additional data found', 'info');
        }
      } else {
        addActivity('Enrichment API returned an error — continuing with available data', 'warn');
      }
    } catch (err: any) {
      console.error('[AUTO ENRICH] Error:', err);
      setEnrichProgress('');
      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('aborted');
      if (isTimeout) {
        addActivity('Enrichment timed out — some results may still have been saved. Try refreshing.', 'warn');
      } else {
        addActivity(`Enrichment error: ${err.message || 'Unknown error'}`, 'warn');
      }
    } finally {
      setIsAutoEnriching(false);
      updatePhase(4, { status: 'complete' });
      updatePhase(5, { status: 'complete' });
      addActivity('All discovery phases complete — company intelligence fully enriched', 'success');
      setAgentActive(false);
    }
  }, [addActivity, updatePhase]);

  // Auto-trigger enrichment when results change
  const lastEnrichedRef = useRef<string>('');
  useEffect(() => {
    if (results.length === 0 || isSearching) return;
    const resultKey = results.map(c => c.id).join(',');
    if (resultKey === lastEnrichedRef.current) return;
    lastEnrichedRef.current = resultKey;
    autoEnrichCompanies(results);
  }, [results, isSearching, autoEnrichCompanies]);

  // ── Auto Brand Enrichment (Brandfetch / SerpAPI logos) ──
  useEffect(() => {
    if (results.length === 0 || isSearching) return;
    // Collect domains we haven't fetched yet
    const domainsToFetch: string[] = [];
    const domainNames: Record<string, string> = {};
    for (const c of results) {
      const raw = c.website_url || '';
      if (!raw) continue;
      const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').toLowerCase().trim();
      if (!domain || brandFetchedRef.current.has(domain)) continue;
      domainsToFetch.push(domain);
      brandFetchedRef.current.add(domain);
      if (c.name && !domainNames[domain]) domainNames[domain] = c.name;
    }
    if (domainsToFetch.length === 0) return;
    const unique = [...new Set(domainsToFetch)];

    (async () => {
      try {
        const headers = await getAuthHeaders();
        if (!headers['Authorization']) {
          console.warn('[BRAND-ENRICH] No auth token, skipping brand-enrich-batch');
          return;
        }
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/brand-enrich-batch`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ domains: unique, domain_names: domainNames }),
          }
        );
        if (!res.ok) {
          console.error('[BRAND ENRICH] HTTP error:', res.status);
          return;
        }
        const data = await res.json();
        const brands: Record<string, any> = data.brands || {};
        if (Object.keys(brands).length > 0) {
          setBrandMap(prev => ({ ...prev, ...brands }));
        }
      } catch (err) {
        console.error('[BRAND ENRICH] Batch error:', err);
      }
    })();
  }, [results, isSearching]);

  // ── Bulk Save Companies to CRM ──
  const [isBulkSavingCompanies, setIsBulkSavingCompanies] = useState(false);
  const [bulkSavedCompanyIds, setBulkSavedCompanyIds] = useState<Set<string>>(new Set());

  const handleBulkSaveCompaniesToCrm = useCallback(async () => {
    const selected = results.filter(c => selectedIds.has(c.id));
    if (selected.length === 0) {
      toast.error(t('leadFinder.toastSelectCompaniesFirst'));
      return;
    }
    setIsBulkSavingCompanies(true);
    try {
      const headers = await getAuthHeaders();
      const companies = selected.map(c => {
        const domain = c.website_url
          ? c.website_url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
          : undefined;
        return {
          name: c.name,
          domain: domain || undefined,
          website: c.website_url || undefined,
          industry: c.industry || undefined,
          city: c.city || undefined,
          state: c.state || undefined,
          country: c.country || undefined,
          employees: c.estimated_num_employees ? String(c.estimated_num_employees) : undefined,
          phone: c.phone || undefined,
          linkedin_url: c.linkedin_url || undefined,
          description: c.short_description || undefined,
          founded_year: c.founded_year || undefined,
        };
      });
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/companies/import`,
        { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ companies }) }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const n = data.imported || 0;
      const d = data.duplicates || 0;
      setBulkSavedCompanyIds(prev => {
        const next = new Set(prev);
        selected.forEach(c => next.add(c.id));
        return next;
      });
      if (n > 0) {
        const noun = n === 1 ? t('companiesView.toastImportedNounSingular') : t('companiesView.toastImportedNounPlural');
        const dupStr = d > 0 ? ` ${t('companiesView.toastDuplicatesSkipped', { count: d })}` : '';
        toast.success(`${t('companiesView.toastImported', { count: n, noun })}${dupStr}`);
      } else if (d > 0) {
        toast.info(t('leadFinder.toastAllContactsInCRM'));
      }
    } catch (err: any) {
      console.error('[CompanySearch] Bulk save companies error:', err);
      toast.error(t('companiesView.toastImportFailed'));
    } finally {
      setIsBulkSavingCompanies(false);
    }
  }, [results, selectedIds, t]);

  // ── Bulk Find Decision Makers ──
  const handleBulkFindPeople = useCallback(async () => {
    const selected = results.filter(c => selectedIds.has(c.id));
    if (selected.length === 0) {
      toast.error(t('leadFinder.toastSelectCompaniesFirst'));
      return;
    }

    setIsBulkFindingPeople(true);
    setAgentActive(true);
    setBulkFindProgress(t('companySearch.bulkFindProgress', { current: 0, total: selected.length }));

    // Set up agent feed for bulk find
    setSearchPhases([
      { phase: 0, name: 'Profile Search', status: 'searching' },
      { phase: 1, name: 'Contact Discovery', status: 'pending' },
      { phase: 2, name: 'Email Enrichment', status: 'pending' },
      { phase: 3, name: 'Finalizing', status: 'pending' },
    ]);
    setSearchActivity([]);
    searchActivityIdRef.current = 0;
    addActivity(`Starting bulk decision maker search for ${selected.length} companies...`, 'info');

    let completed = 0;
    const headers = await getAuthHeaders();

    // Process in parallel batches of 2 (reduced to respect Hunter.io rate limits)
    let totalPeopleFound = 0;
    let totalEmailsFound = 0;
    for (let i = 0; i < selected.length; i += 2) {
      const batch = selected.slice(i, i + 2);
      if (i === 0) updatePhase(0, { status: 'searching' });
      const batchResults = await Promise.allSettled(
        batch.map(async (company) => {
          const domain = company.website_url
            ? company.website_url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
            : '';
          const companyLoc = [company.city, company.state, company.country].filter(Boolean).join(', ');

          addActivity(`Searching decision makers at ${company.name}...`, 'info');

          // Step 1: Find people (LinkedIn + Hunter.io domain-search in parallel)
          const peopleRes = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/find-people`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                company_name: company.name,
                domain: domain || undefined,
                location: companyLoc || undefined,
                search_location: [locationValue.cities?.[0], locationValue.state].filter(Boolean).join(', ') || undefined,
                phone: company.phone || undefined,
              }),
            }
          );

          if (!peopleRes.ok) {
            addActivity(`Failed to find people at ${company.name}`, 'warn');
            throw new Error('Find people failed');
          }
          const peopleData = await peopleRes.json();
          const people: Person[] = peopleData.people || [];
          const poolHit = peopleData.pool_hit === true;
          const poolPeopleCount = peopleData.pool_people_count || 0;
          totalPeopleFound += people.length;

          if (people.length > 0) {
            const poolMsg = poolHit ? ` (${poolPeopleCount} from pool intelligence)` : '';
            addActivity(`Found ${people.length} decision maker${people.length !== 1 ? 's' : ''} at ${company.name}${poolMsg}`, 'success');
          } else {
            addActivity(`No decision makers found at ${company.name}`, 'info');
          }

          // Seed with CRM + Hunter emails from find-people response
          let emailMap: Record<string, { email: string; source: string; confidence: string }> = {};
          if (peopleData.crm_emails) {
            emailMap = { ...peopleData.crm_emails };
            const preEmails = Object.keys(peopleData.crm_emails).length;
            if (preEmails > 0) {
              totalEmailsFound += preEmails;
              addActivity(`${preEmails} email${preEmails !== 1 ? 's' : ''} found for ${company.name}`, 'success');
            }
          }

          // Step 2: Enrich emails for people not already covered by CRM/Hunter
          const cleanDomain = domain.replace(/^www\./, '').replace(/\/.*$/, '').trim();
          const needEmailPeople = people.filter(p => !emailMap[p.id]);
          if (needEmailPeople.length > 0 && cleanDomain) {
            updatePhase(2, { status: 'searching' });
            addActivity(`Enriching ${needEmailPeople.length} email${needEmailPeople.length !== 1 ? 's' : ''} for ${company.name}...`, 'info');
            try {
              const emailRes = await fetch(
                `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/enrich-people-email`,
                {
                  method: 'POST',
                  headers: { ...headers, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    people: needEmailPeople.map(p => ({ id: p.id, name: p.name, title: p.title, linkedin_url: p.linkedin_url })),
                    domain: cleanDomain,
                  }),
                }
              );
              if (emailRes.ok) {
                const emailData = await emailRes.json();
                emailMap = { ...emailMap, ...(emailData.results || {}) };
                const enrichedEmails = Object.keys(emailData.results || {}).length;
                const poolHits = emailData.pool_hits || 0;
                totalEmailsFound += enrichedEmails;
                if (enrichedEmails > 0) {
                  const poolNote = poolHits > 0 ? ` (${poolHits} from pool)` : '';
                  addActivity(`Found ${enrichedEmails} additional email${enrichedEmails !== 1 ? 's' : ''} for ${company.name}${poolNote}`, 'success');
                }
              }
            } catch (emailErr) {
              console.error('[BULK FIND] Email enrich error (non-fatal):', emailErr);
              addActivity(`Email enrichment error for ${company.name} (non-fatal)`, 'warn');
            }
          }

          return { companyId: company.id, people, emailMap };
        })
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const { companyId, people, emailMap } = r.value;
          setBulkPeopleMap(prev => ({ ...prev, [companyId]: { people, emailMap } }));
          completed++;
          setBulkFindProgress(t('companySearch.bulkFindProgress', { current: completed, total: selected.length }));
        } else {
          completed++;
        }
      }
    }

    // Finalize
    updatePhase(0, { status: 'complete' });
    updatePhase(1, { status: 'complete' });
    updatePhase(2, { status: 'complete' });
    updatePhase(3, { status: 'searching' });
    addActivity(`Finalizing results: ${totalPeopleFound} decision makers, ${totalEmailsFound} emails across ${completed} companies`, 'success');
    await new Promise(r => setTimeout(r, 300));
    updatePhase(3, { status: 'complete' });
    addActivity('Bulk decision maker search complete', 'success');

    setBulkFindProgress('');
    setIsBulkFindingPeople(false);
    setAgentActive(false);
    toast.success(t('leadFinder.toastFoundDecisionMakers', { count: completed }));
  }, [results, selectedIds, addActivity, updatePhase, locationValue]);

  // ── Sort & Filter ──
  const filteredResults = React.useMemo(() => {
    let list = [...results];
    if (resultSearch) {
      const q = resultSearch.toLowerCase();
      list = list.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.country?.toLowerCase().includes(q) ||
        c.short_description?.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = (a.name || '').localeCompare(b.name || ''); break;
        case 'industry': cmp = (a.industry || '').localeCompare(b.industry || ''); break;
        case 'employees': cmp = (a.estimated_num_employees || 0) - (b.estimated_num_employees || 0); break;
        case 'revenue': cmp = (a.annual_revenue_printed || '').localeCompare(b.annual_revenue_printed || ''); break;
        case 'score': {
          const sa = computeCompanyScore(a, batchEnrichMap[a.id], crmContactsMap[a.name]);
          const sb = computeCompanyScore(b, batchEnrichMap[b.id], crmContactsMap[b.name]);
          cmp = sb - sa;
          break;
        }
        case 'location': cmp = [a.city, a.state, a.country].filter(Boolean).join(', ').localeCompare([b.city, b.state, b.country].filter(Boolean).join(', ')); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [results, resultSearch, sortField, sortAsc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const selectAll = () => {
    if (selectedIds.size === filteredResults.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredResults.map(c => c.id)));
  };

  // ── Export CSV ──
  const handleExportCSV = () => {
    if (results.length === 0) { toast.error(t('leadFinder.toastNoResultsToExport')); return; }
    const csv = buildCompanyCsv(
      results as any,
      (c: any) => computeCompanyScore(c, batchEnrichMap[c.id], crmContactsMap[c.name]),
    );
    // (/\"/g, '""'), 'REPLACED_JUNKEND'.replace(/\"/g, '""'),
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `companies-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(t('leadFinder.toastExportedCompanies', { count: results.length }));
  };

  // ── Saved Lists ──
  const loadSavedLists = useCallback(async () => {
    try {
      setLoadingLists(true);
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/saved-lists`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        // Filter to company-type lists
        setSavedLists((data.lists || []).filter((l: any) => l.type === 'companies'));
      }
    } catch (err) {
      console.error('[SAVED LISTS] Error loading:', err);
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => { loadSavedLists(); }, [loadSavedLists]);

  // ── Restore cached results on mount ──
  // v3.5.1: Also restores brandMap so logos stay correctly mapped to their company domain
  useEffect(() => {
    const cached = loadFinderCache<{
      results: Company[];
      pagination: any;
      brandMap?: Record<string, { logo_url?: string; icon_url?: string; name?: string; colors?: { hex: string; type: string }[]; source?: string }>;
    }>(CACHE_KEYS.LEAD_FINDER_COMPANIES);
    if (cached && cached.results.length > 0) {
      setResults(cached.results);
      setAllResults(cached.results);
      if (cached.pagination) setPagination(cached.pagination);
      // Restore persisted brandMap keyed by domain — prevents logo mismatches on refresh
      if (cached.brandMap && Object.keys(cached.brandMap).length > 0) {
        setBrandMap(cached.brandMap);
        // Mark domains as already fetched so auto-enrichment doesn't re-fetch
        for (const domain of Object.keys(cached.brandMap)) {
          brandFetchedRef.current.add(domain);
        }
        console.log(`[COMPANY-SEARCH] Restored brandMap for ${Object.keys(cached.brandMap).length} domains`);
      }
      setHasSearched(true);
      console.log(`[COMPANY-SEARCH] Restored ${cached.results.length} cached results`);
    }
  }, []);

  // ── Persist results + brandMap to cache whenever they change ──
  // v3.5.1: brandMap is now persisted so logo→domain mappings survive page refresh
  useEffect(() => {
    if (results.length > 0 && !isSearching) {
      saveFinderCache(CACHE_KEYS.LEAD_FINDER_COMPANIES, {
        results,
        pagination,
        brandMap,
      });
    }
  }, [results, pagination, isSearching, brandMap]);

  const handleSaveSearchResults = async () => {
    if (results.length === 0) { toast.error(t('leadFinder.toastNoResultsToSave')); return; }
    const name = saveListName.trim() || `Company Search — ${new Date().toLocaleDateString()}`;
    setSavingList(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/saved-lists`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            type: 'companies',
            leads: results.map(c => ({
              id: c.id, name: c.name, website_url: c.website_url, linkedin_url: c.linkedin_url,
              industry: c.industry, estimated_num_employees: c.estimated_num_employees,
              annual_revenue_printed: c.annual_revenue_printed, city: c.city, state: c.state,
              country: c.country, short_description: c.short_description, phone: c.phone,
              logo_url: c.logo_url, rating: c.rating, reviews_count: c.reviews_count,
              address: c.address, founded_year: c.founded_year,
            })),
            params: { companyName, locationValue, keywords, industries: Array.from(industries), employeeRanges: Array.from(employeeRanges) },
          }),
        }
      );
      if (res.ok) {
        toast.success(t('leadFinder.toastSavedList', { name, count: results.length }));
        setShowSaveDialog(false);
        setSaveListName('');
        loadSavedLists();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t('leadFinder.toastFailedToSave'));
      }
    } catch (err) {
      toast.error(t('leadFinder.toastFailedToSaveSearchResults'));
    } finally {
      setSavingList(false);
    }
  };

  const handleLoadSavedList = async (list: any) => {
    if (list.leads) {
      setResults(list.leads);
      setAllResults(list.leads);
      setPagination({ page: 1, per_page: list.leads.length, total_entries: list.leads.length, total_pages: 1 });
      setHasSearched(true);
      setSelectedIds(new Set());
      setExpandedId(null);
      // Restore params if available
      if (list.params) {
        if (list.params.companyName) setCompanyName(list.params.companyName);
        if (list.params.locationValue) setLocationValue(list.params.locationValue);
        // Legacy compat
        if (!list.params.locationValue && list.params.location) setLocationValue({ country: list.params.location, state: '', cities: [] });
        if (list.params.keywords) setKeywords(list.params.keywords);
        if (list.params.industries) setIndustries(new Set(list.params.industries));
        if (list.params.employeeRanges) setEmployeeRanges(new Set(list.params.employeeRanges));
      }
      toast.success(t('leadFinder.toastLoadedList', { name: list.name, count: list.leads.length }));
      setShowSavedLists(false);
    }
  };

  const handleDeleteSavedList = async (listId: string, listName: string) => {
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/saved-lists/${listId}`,
        { method: 'DELETE', headers }
      );
      toast.success(t('leadFinder.toastDeletedList', { name: listName }));
      loadSavedLists();
    } catch {
      toast.error(t('leadFinder.toastFailedToDelete'));
    }
  };

  // ── Pool Intelligence Functions ──
  const fetchPoolStats = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/pool-stats`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setPoolStats(data.stats);
      }
    } catch (err) {
      console.error('[POOL STATS] Fetch error:', err);
    }
  };

  const fetchPoolCoverage = async (companyName: string, domain: string, location?: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/pool-coverage`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_name: companyName, domain, location }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        return data.coverage;
      }
    } catch (err) {
      console.error('[POOL COVERAGE] Fetch error:', err);
    }
    return null;
  };

  // Fetch pool stats on mount
  useEffect(() => {
    fetchPoolStats();
  }, []);

  const filteredIndustries = INDUSTRY_OPTIONS.filter(i => {
    const q = industrySearch.toLowerCase();
    const translatedLabel = t(`companySearch.industries.${i}`, i);
    return i.toLowerCase().includes(q) || translatedLabel.toLowerCase().includes(q);
  });
  // Location filtering handled by LocationPicker component

  // Extracted filter form for reuse in both sidebar and mobile sheet
  const renderFilterForm = () => (
    <div className="space-y-3.5">
      {/* Company Name */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('companySearch.companyNameLabel')} <span className="text-zinc-400 normal-case">{t('companySearch.optional')}</span>
        </label>
        <div className="relative">
          <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder={t('leadFinder.companySearchPlaceholder')}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--border-color)] rounded-lg focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all placeholder:text-zinc-400"
          />
        </div>
      </div>

      {/* Location — cascading Country → State → City */}
      <LocationPicker
        value={locationValue}
        onChange={setLocationValue}
      />

      {/* Keywords */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('companySearch.keywordsLabel')} <span className="text-zinc-400 normal-case">{t('companySearch.optional')}</span>
        </label>
        <div className="relative">
          <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            placeholder={t('leadFinder.keywordsPlaceholder')}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--border-color)] rounded-lg focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all placeholder:text-zinc-400"
          />
        </div>
      </div>

      {/* Industry Multi-Select */}
      <div ref={industryRef}>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('companySearch.industryLabel')} <span className="text-zinc-400 normal-case">{t('companySearch.optional')}</span>
        </label>
        <button
          type="button"
          onClick={() => setShowIndustryPicker(!showIndustryPicker)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--border-color)] rounded-lg text-left transition-all hover:border-zinc-300 dark:hover:border-zinc-600"
        >
          <span className={industries.size > 0 ? 'text-[var(--text-main)]' : 'text-zinc-400'}>
            {industries.size > 0 ? t('companySearch.nSelectedIndustries', { count: industries.size }) : t('companySearch.industryPlaceholder')}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${showIndustryPicker ? 'rotate-180' : ''}`} />
        </button>
        {industries.size > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Array.from(industries).map(ind => (
              <span
                key={ind}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20"
              >
                {t(`companySearch.industries.${ind}`, ind)}
                <button type="button" onClick={() => toggleIndustry(ind)}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {showIndustryPicker && (
          <div className="mt-1.5 border border-[var(--border-color)] rounded-lg bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
            <div className="px-2 py-1.5 border-b border-[var(--border-color)]">
              <input
                type="text"
                value={industrySearch}
                onChange={e => setIndustrySearch(e.target.value)}
                placeholder={t('leadFinder.searchIndustries')}
                className="w-full px-2 py-1 text-xs bg-transparent outline-none placeholder:text-zinc-400"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto p-1">
              {filteredIndustries.map(ind => (
                <button
                  key={ind}
                  type="button"
                  onClick={() => toggleIndustry(ind)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded-md transition-colors flex items-center gap-2 ${
                    industries.has(ind)
                      ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                    industries.has(ind) ? 'bg-[#1ED4A7] border-[#1ED4A7]' : 'border-zinc-300 dark:border-zinc-700'
                  }`}>
                    {industries.has(ind) && <Check className="w-2.5 h-2.5 text-black" />}
                  </div>
                  {t(`companySearch.industries.${ind}`, ind)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Employee Range */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('companySearch.employeeSizeLabel')} <span className="text-zinc-400 normal-case">{t('companySearch.optional')}</span>
        </label>
        <div className="flex flex-wrap gap-2 md:gap-1">
          {EMPLOYEE_RANGES.slice(0, 8).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleEmployeeRange(opt.value)}
              className={`px-3 py-1.5 md:px-2 md:py-1 min-h-[32px] md:min-h-0 text-[11px] md:text-[10px] font-medium rounded-lg md:rounded-md border transition-all ${
                employeeRanges.has(opt.value)
                  ? 'border-[#1ED4A7]/40 bg-[#1ED4A7]/10 text-[#1ED4A7]'
                  : 'border-[var(--border-color)] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Per Page */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('leadFinder.perPage')}
        </label>
        <div className="grid grid-cols-4 gap-2 md:gap-1">
          {[10, 25, 50, 100].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setPerPage(n)}
              className={`flex items-center justify-center py-1.5 min-h-[32px] md:min-h-0 text-[11px] md:text-[10px] font-medium rounded-lg md:rounded-md border transition-all ${
                perPage === n
                  ? 'border-[#1ED4A7]/40 bg-[#1ED4A7]/10 text-[#1ED4A7]'
                  : 'border-[var(--border-color)] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col px-4 sm:px-6 pt-3 pb-4">
      {/* Mobile: Filter Button Trigger */}
      {isMobile && results.length > 0 && (
        <>
          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="fixed bottom-24 right-4 z-50 flex items-center gap-2 px-4 py-3 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-full shadow-2xl"
          >
            <Filter className="w-4 h-4" />
            <span className="text-sm font-medium">{t('common.filters')}</span>
          </button>
          <MobileFilterSheet
            isOpen={mobileFiltersOpen}
            onClose={() => setMobileFiltersOpen(false)}
            title={t('common.filters')}
            footerActions={
              <button
                type="button"
                onClick={(e) => {
                  setMobileFiltersOpen(false);
                  handleSearch(e as any);
                }}
                disabled={isSearching}
                className="w-full py-3.5 bg-zinc-900 text-white dark:bg-white dark:text-black font-semibold text-sm rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm active:scale-[0.98]"
              >
                {isSearching ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{t('companySearch.searching')}</span></>
                ) : (
                  <><Search className="w-3.5 h-3.5" /><span>{t('companySearch.searchButton')}</span></>
                )}
              </button>
            }
          >
            {renderFilterForm()}
          </MobileFilterSheet>
        </>
      )}
      {/* ── Main Layout ── */}
      <div className="flex-1 overflow-hidden flex min-h-0 rounded-2xl border border-[var(--border-color)] bg-white dark:bg-[#050505]/80 dark:backdrop-blur-xl shadow-sm">
        {/* ── Sidebar / Filters ── */}
        <div className={`flex-shrink-0 border-r border-[var(--border-color)] transition-all duration-300 flex flex-col ${sidebarCollapsed ? 'w-0 md:w-12' : 'w-full md:w-[300px]'} ${results.length > 0 && !sidebarCollapsed ? 'hidden md:block md:flex' : ''}`}>
          {!sidebarCollapsed ? (
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 pb-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-zinc-800 dark:bg-white/10 flex items-center justify-center text-white">
                    <Building2 className="w-3.5 h-3.5" />
                  </div>
                  <h2 className="text-sm font-semibold text-[var(--text-main)]">{t('leadFinder.companySearchTitle')}</h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setShowSavedLists(!showSavedLists); if (!showSavedLists) loadSavedLists(); }}
                    className={`p-1.5 rounded-md transition-colors text-xs ${showSavedLists ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' : 'text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Saved Searches"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors hidden md:flex"
                  >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                  </button>
                </div>
              </div>

              {/* Saved Lists Panel */}
              {showSavedLists && (
                <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 border-b border-[var(--border-color)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('leadFinder.savedSearches')}</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {loadingLists ? (
                      <div className="p-3 text-center"><Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-zinc-400" /></div>
                    ) : savedLists.length === 0 ? (
                      <div className="p-3 text-xs text-zinc-400 text-center">{t('leadFinder.noSavedSearches')}</div>
                    ) : savedLists.map((list: any) => (
                      <div
                        key={list.id}
                        className="px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer flex items-center justify-between group transition-colors border-b border-[var(--border-color)] last:border-b-0"
                        onClick={() => handleLoadSavedList(list)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Bookmark className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                            <span className="text-xs font-medium text-[var(--text-main)] truncate">{list.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-zinc-400">{list.leads?.length || 0} companies</span>
                            <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" /> {new Date(list.created_at || list.ts).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteSavedList(list.id, list.name); }}
                          className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Form */}
              <form id="company-search-form" onSubmit={handleSearch} className="space-y-4">
                {renderFilterForm()}

                {/* Search Button */}
                <div className="pt-2 md:pt-0 pb-4 md:pb-0">
                  <button
                    type="submit"
                    disabled={isSearching}
                    className="w-full py-3.5 md:py-3 bg-zinc-900 text-white dark:bg-white dark:text-black font-semibold text-sm rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm active:scale-[0.98] md:rounded-lg md:shadow-md"
                  >
                    {isSearching ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{t('companySearch.searching')}</span></>
                    ) : (
                      <><Search className="w-3.5 h-3.5" /><span>{t('companySearch.searchButton')}</span></>
                    )}
                  </button>
                </div>
              </form>

              {/* Results Summary */}
              {hasSearched && !isSearching && (
                <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 border-b border-[var(--border-color)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('companySearch.resultsTitle')}</span>
                  </div>
                  <div className="p-3 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-500">{t('companySearch.companiesFound')}</span>
                      <span className="text-xs font-semibold text-zinc-500">{results.length}</span>
                    </div>
                    {pagination?.total_entries && (
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">{t('companySearch.totalAvailable')}</span>
                        <span className="text-xs font-semibold text-zinc-400">{pagination.total_entries.toLocaleString()}</span>
                      </div>
                    )}
                    {results.length > 0 && (() => {
                      const withPhone = results.filter(c => c.phone).length;
                      const withSite = results.filter(c => c.website_url).length;
                      const withSize = results.filter(c => c.estimated_num_employees > 0).length;
                      const withRevenue = results.filter(c => c.annual_revenue_printed).length;
                      const uniqueIndustries = new Set(results.map(c => c.industry).filter(Boolean)).size;
                      return (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">{t('companySearch.withPhone')}</span>
                            <span className="text-xs font-semibold text-[#1ED4A7]">{withPhone}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">{t('companySearch.withWebsite')}</span>
                            <span className="text-xs font-semibold text-[var(--text-main)]">{withSite}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">{t('companySearch.withSizeData')}</span>
                            <span className="text-xs font-semibold text-[var(--text-main)]">{withSize}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">{t('companySearch.withRevenue')}</span>
                            <span className="text-xs font-semibold text-[var(--text-main)]">{withRevenue}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">{t('companySearch.industriesLabel')}</span>
                            <span className="text-xs font-semibold text-[var(--text-main)]">{uniqueIndustries}</span>
                          </div>
                          {(() => {
                            const crmMatchCount = Object.keys(crmContactsMap).length;
                            const crmTotalContacts = Object.values(crmContactsMap).reduce((sum, arr) => sum + arr.length, 0);
                            if (crmTotalContacts === 0) return null;
                            return (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-zinc-500">{t('companySearch.crmContacts')}</span>
                                <span className="text-xs font-semibold text-[#1ED4A7]">{crmTotalContacts} at {crmMatchCount} co.</span>
                              </div>
                            );
                          })()}
                        </>
                      );
                    })()}

                    <div className="pt-2 mt-2 border-t border-[var(--border-color)] space-y-1.5">
                      {isAutoEnriching && (
                        <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-[#1ED4A7]/5 border border-[#1ED4A7]/20">
                          <Loader2 className="w-3 h-3 animate-spin text-[#1ED4A7] flex-shrink-0" />
                          <span className="text-[10px] text-[#1ED4A7] font-medium">{enrichProgress || t('companySearch.enriching')}</span>
                        </div>
                      )}
                      {!isAutoEnriching && Object.keys(batchEnrichMap).length > 0 && (
                        <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-[#1ED4A7]/5 border border-[#1ED4A7]/20">
                          <Sparkles className="w-3 h-3 text-[#1ED4A7] flex-shrink-0" />
                          <span className="text-[10px] text-[#1ED4A7] font-medium">{t('companySearch.companiesDeepEnriched', { count: Object.keys(batchEnrichMap).length })}</span>
                        </div>
                      )}
                      <button
                        onClick={() => setShowSaveDialog(true)}
                        className="w-full py-1.5 text-xs font-medium rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Bookmark className="w-3 h-3" />
                        {t('leadFinder.saveSearchResults')}
                      </button>
                      <button
                        onClick={handleExportCSV}
                        className="w-full py-1.5 text-xs font-medium rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3 h-3" />
                        {t('companySearch.exportCsv', { count: results.length })}
                      </button>
                      {poolStats && (
                        <button
                          onClick={() => setShowPoolStats(!showPoolStats)}
                          className="w-full py-1.5 text-xs font-medium rounded-md bg-[#1ED4A7]/10 text-[#1ED4A7] hover:bg-[#1ED4A7]/20 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Database className="w-3 h-3" />
                          Intelligence Pool
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Searches (sidebar widget) */}
              {searchHistory.length > 0 && (
                <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 border-b border-[var(--border-color)] flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-zinc-400" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Recent</span>
                    </div>
                  </div>
                  <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                    {searchHistory.slice(0, 5).map((entry) => {
                      const p = entry.params;
                      const parts: string[] = [];
                      if (p.companyName) parts.push(p.companyName);
                      if (p.keywords) parts.push(p.keywords);
                      if (p.locationValue) parts.push(buildLocationStrings(p.locationValue).join(', '));
                      else if (p.location) parts.push(p.location);
                      const label = parts.join(' \u00b7 ') || 'Search';
                      return (
                        <div key={entry.id} className="group flex items-center gap-1">
                          <button
                            onClick={() => {
                              setCompanyName(p.companyName);
                              if (p.locationValue) setLocationValue(p.locationValue);
                              else if (p.location) setLocationValue({ country: p.location, state: '', cities: [] });
                              setKeywords(p.keywords);
                              setIndustries(new Set(p.industries));
                              setEmployeeRanges(new Set(p.employeeRanges));
                              setPendingSuggestionSearch(true);
                            }}
                            className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors text-left min-w-0"
                          >
                            <Search className="w-2.5 h-2.5 text-zinc-400 flex-shrink-0" />
                            <span className="text-[11px] text-[var(--text-main)] truncate flex-1">{label}</span>
                            <span className={`text-[10px] flex-shrink-0 ${entry.resultCount === 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                              {entry.resultCount}
                            </span>
                          </button>
                          <button
                            onClick={() => { removeSearchHistoryEntry(entry.id); setSearchHistory(getSearchHistory()); }}
                            className="p-0.5 text-zinc-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="hidden md:flex flex-col items-center py-3 gap-2">
              <button onClick={() => setSidebarCollapsed(false)} className="p-1.5 rounded-md text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <ChevronDown className="w-3.5 h-3.5 rotate-90" />
              </button>
              <button onClick={() => setSidebarCollapsed(false)} className="p-1.5 rounded-md text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <Building2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setSidebarCollapsed(false); setShowSavedLists(true); loadSavedLists(); }} className="p-1.5 rounded-md text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title={t('companySearch.savedSearchesTitle')}>
                <Bookmark className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Top Action Bar */}
          {results.length > 0 && (
            <div className="flex-shrink-0 border-b border-[var(--border-color)]">
              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Mobile: back to filters */}
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="md:hidden p-1.5 rounded-md text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0"
                    title={t('companySearch.searchFilters')}
                  >
                    <Building2 className="w-4 h-4" />
                  </button>

                  {/* Select All */}
                  <button
                    onClick={selectAll}
                    className="flex-shrink-0 appearance-none rounded border border-zinc-300 dark:border-zinc-700 flex items-center justify-center transition-colors hover:border-zinc-400 p-0"
                    style={{ width: 18, height: 18, minWidth: 18, minHeight: 18, maxWidth: 18, maxHeight: 18, ...(selectedIds.size === filteredResults.length && filteredResults.length > 0 ? { background: '#1ED4A7', borderColor: '#1ED4A7' } : {}) }}
                  >
                    {selectedIds.size === filteredResults.length && filteredResults.length > 0 && <Check className="w-3 h-3 text-black" />}
                    {selectedIds.size > 0 && selectedIds.size < filteredResults.length && <div className="w-2 h-0.5 bg-zinc-400 rounded" />}
                  </button>

                  <span className="text-xs text-zinc-500 font-medium flex-shrink-0">
                    {selectedIds.size > 0 ? t('companySearch.selectedCount', { count: selectedIds.size }) : t('companySearch.companiesCount', { count: filteredResults.length })}
                  </span>

                  {/* Search */}
                  <div className="relative hidden md:block max-w-[240px]">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                    <input
                      type="text"
                      value={resultSearch}
                      onChange={e => setResultSearch(e.target.value)}
                      placeholder={t('companySearch.searchResultsPlaceholder')}
                      className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--border-color)] rounded-md focus:ring-1 focus:ring-[#1ED4A7]/30 outline-none transition-all placeholder:text-zinc-400"
                    />
                  </div>
                </div>

                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => setShowSaveDialog(true)}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                    title={t('companySearch.saveDialogTitle', 'Save search results')}
                  >
                    <Bookmark className="w-3 h-3" /> {t('companySearch.saveLabel')}
                  </button>
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-zinc-500 hover:text-[var(--text-main)] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                  >
                    <Download className="w-3 h-3" /> {t('companySearch.csvLabel', 'CSV')}
                  </button>
                  {/* Bulk Find Decision Makers */}
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleBulkFindPeople}
                      disabled={isBulkFindingPeople}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-50"
                    >
                      {isBulkFindingPeople ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> {t('companySearch.findingLabel')}</>
                      ) : (
                        <><Users className="w-3 h-3" /> {t('companySearch.findPeopleCount', { count: selectedIds.size })}</>
                      )}
                    </button>
                  )}
                  {selectedIds.size > 0 && !isBulkFindingPeople && (
                    <span className="text-[10px] text-zinc-400 font-medium tabular-nums">
                      {t('companySearch.selectedCount', { count: selectedIds.size })}
                    </span>
                  )}
                  {/* Enrichment progress */}
                  {isAutoEnriching && (
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium">
                      <Loader2 className="w-3 h-3 animate-spin text-[#1ED4A7]" />
                      {enrichProgress}
                    </span>
                  )}
                  {bulkFindProgress && (
                    <span className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium">
                      <Loader2 className="w-3 h-3 animate-spin text-[#1ED4A7]" />
                      {bulkFindProgress}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Results ── */}
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
            {results.length === 0 && !isSearching && !hasSearched && !agentActive ? (
              <CompanyEmptyState />
            ) : results.length === 0 && (isSearching || agentActive) ? (
              <CompanyAgentFeed
                entries={searchActivity}
                isSearching={isSearching || agentActive}
                phases={searchPhases}
              />
            ) : results.length === 0 && hasSearched && !agentActive ? (
              <div className="h-full flex flex-col items-center justify-start md:justify-center p-4 sm:p-6 md:p-8 overflow-y-auto">
                <div className="max-w-lg w-full text-center">
                  {/* ── Fresh Search CTA — top of empty state ── */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 mb-6 sm:mb-7">
                    <button
                      onClick={() => {
                        clearAllFinderCaches();
                        handleSearch(undefined, 1);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl border-2 border-[#1ED4A7]/60 bg-[#1ED4A7]/8 dark:bg-[#1ED4A7]/10 text-sm font-semibold text-[#1ED4A7] hover:bg-[#1ED4A7]/15 active:bg-[#1ED4A7]/20 transition-all"
                    >
                      <RefreshCw className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      {t('companySearch.retryFreshData')}
                    </button>
                    <button
                      onClick={() => {
                        clearAllFinderCaches();
                        toast.success(t('leadFinder.toastCacheCleared'));
                      }}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 active:bg-zinc-100 dark:active:bg-zinc-800 transition-all"
                    >
                      <RotateCcw className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      {t('companySearch.clearCache')}
                    </button>
                  </div>

                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-4 sm:mb-5 shadow-sm border border-zinc-200 dark:border-zinc-700">
                    <Building2 className="w-6 h-6 sm:w-7 sm:h-7 text-zinc-400 dark:text-zinc-500" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-[var(--text-main)] mb-1">{t('companySearch.noResults', 'No companies found')}</h3>
                  <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mb-5 sm:mb-6 px-2">
                    {t('companySearch.tryDifferent', 'Your search didn\'t return results. Try a suggestion below or run a fresh search.')}
                  </p>

                  {/* ── Similar / Alternative Search Suggestions ── */}
                  {(() => {
                    const suggestions: { label: string; icon: React.ReactNode; action: () => void; description: string }[] = [];

                    // If company name + keywords → try keywords only
                    if (companyName.trim() && keywords.trim()) {
                      suggestions.push({
                        label: t('companySearch.searchCompaniesKeyword', { keyword: keywords.trim() }),
                        icon: <Factory className="w-3.5 h-3.5" />,
                        description: t('companySearch.dropCompanyNameDesc', { keyword: keywords.trim() }) + (locationValue.country ? t('companySearch.inLocation', { location: buildLocationStrings(locationValue).join(', ') }) : ''),
                        action: () => { setCompanyName(''); setPendingSuggestionSearch(true); },
                      });
                    }

                    // If company name + location → try company name without location
                    if (companyName.trim() && (locationValue.state || locationValue.cities.length > 0)) {
                      suggestions.push({
                        label: t('companySearch.searchNationwide', { name: companyName.trim() }),
                        icon: <Globe className="w-3.5 h-3.5" />,
                        description: t('companySearch.removeStateCityDesc'),
                        action: () => { setLocationValue({ ...locationValue, state: '', cities: [] }); setPendingSuggestionSearch(true); },
                      });
                    }

                    // If company name only → try as keyword instead
                    if (companyName.trim() && !keywords.trim()) {
                      suggestions.push({
                        label: t('companySearch.searchAsKeyword', { name: companyName.trim() }),
                        icon: <Search className="w-3.5 h-3.5" />,
                        description: t('companySearch.moveToKeywordsDesc'),
                        action: () => { const cn = companyName.trim(); setCompanyName(''); setKeywords(cn); setPendingSuggestionSearch(true); },
                      });
                    }

                    // If cities selected → suggest broadening to state/country level
                    if (locationValue.cities.length > 0) {
                      const label = t('companySearch.broadenTo', { location: locationValue.state || locationValue.country });
                      suggestions.push({
                        label,
                        icon: <MapPin className="w-3.5 h-3.5" />,
                        description: t('companySearch.searchFullRegion', { location: locationValue.state || locationValue.country }),
                        action: () => { setLocationValue({ ...locationValue, cities: [] }); setPendingSuggestionSearch(true); },
                      });
                    } else if (locationValue.state) {
                      suggestions.push({
                        label: t('companySearch.broadenTo', { location: locationValue.country }),
                        icon: <MapPin className="w-3.5 h-3.5" />,
                        description: t('companySearch.searchFullCountry', { country: locationValue.country, state: locationValue.state }),
                        action: () => { setLocationValue({ ...locationValue, state: '' }); setPendingSuggestionSearch(true); },
                      });
                    }

                    // If keywords → try without keywords
                    if (keywords.trim() && (companyName.trim() || locationValue.country)) {
                      suggestions.push({
                        label: t('companySearch.dropKeywords'),
                        icon: <X className="w-3.5 h-3.5" />,
                        description: t('companySearch.searchWithoutFilter', { keywords: keywords.trim() }),
                        action: () => { setKeywords(''); setPendingSuggestionSearch(true); },
                      });
                    }

                    return suggestions.length > 0 ? (
                      <div className="mb-5 sm:mb-6">
                        <div className="flex items-center justify-center gap-1.5 mb-3">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('companySearch.tryInstead')}</span>
                        </div>
                        <div className="space-y-2 text-left">
                          {suggestions.map((s, i) => (
                            <button
                              key={i}
                              onClick={s.action}
                              className="w-full group flex items-start gap-3 p-3.5 sm:p-3 rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50/50 dark:bg-zinc-800/30 hover:bg-[#1ED4A7]/5 hover:border-[#1ED4A7]/30 dark:hover:bg-[#1ED4A7]/5 dark:hover:border-[#1ED4A7]/30 active:bg-[#1ED4A7]/10 transition-all duration-200 text-left"
                            >
                              <div className="flex-shrink-0 w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-zinc-100 dark:bg-zinc-700/50 flex items-center justify-center text-zinc-500 dark:text-zinc-400 group-hover:bg-[#1ED4A7]/10 group-hover:text-[#1ED4A7] transition-colors">
                                {s.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-[var(--text-main)] group-hover:text-[#1ED4A7] transition-colors flex items-center gap-1.5">
                                  {s.label}
                                  <ArrowRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all hidden sm:block" />
                                </div>
                                <div className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">{s.description}</div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 flex-shrink-0 self-center sm:hidden" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* ── AI-Powered Suggestions ── */}
                  {loadingAiSuggestions ? (
                    <div className="mb-5 sm:mb-6 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50/50 dark:bg-zinc-800/30">
                      <div className="flex items-center justify-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[#1ED4A7] animate-pulse" />
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('companySearch.generatingAISuggestions')}</span>
                      </div>
                    </div>
                  ) : aiSuggestions && (
                    <div className="mb-5 sm:mb-6 text-left">
                      <div className="flex items-center justify-center gap-1.5 mb-3">
                        <Sparkles className="w-3.5 h-3.5 text-[#1ED4A7]" />
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('companySearch.aiSuggestionsLabel')}</span>
                      </div>

                      {/* Competitors */}
                      {aiSuggestions.competitors?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-1">{t('companySearch.similarCompanies', 'Similar Companies')}</p>
                          <div className="flex flex-wrap gap-2">
                            {aiSuggestions.competitors.map((c: any, i: number) => (
                              <button
                                key={i}
                                onClick={() => { setCompanyName(c.name); setKeywords(''); setPendingSuggestionSearch(true); }}
                                title={c.reason}
                                className="group inline-flex items-center gap-1.5 px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700/60 bg-white dark:bg-zinc-800/50 text-xs font-medium text-[var(--text-main)] hover:border-[#1ED4A7]/40 hover:bg-[#1ED4A7]/5 active:bg-[#1ED4A7]/10 transition-all"
                              >
                                <Building2 className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-zinc-400 group-hover:text-[#1ED4A7] transition-colors" />
                                {c.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Related Keywords */}
                      {aiSuggestions.related_keywords?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-1">Related Keywords</p>
                          <div className="flex flex-wrap gap-2">
                            {aiSuggestions.related_keywords.map((k: any, i: number) => (
                              <button
                                key={i}
                                onClick={() => { setKeywords(k.term); setCompanyName(''); setPendingSuggestionSearch(true); }}
                                title={k.reason}
                                className="group inline-flex items-center gap-1.5 px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700/60 bg-white dark:bg-zinc-800/50 text-xs font-medium text-[var(--text-main)] hover:border-[#1ED4A7]/40 hover:bg-[#1ED4A7]/5 active:bg-[#1ED4A7]/10 transition-all"
                              >
                                <Hash className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-zinc-400 group-hover:text-[#1ED4A7] transition-colors" />
                                {k.term}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Broader Industries */}
                      {aiSuggestions.broader_industries?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-1">Related Industries</p>
                          <div className="flex flex-wrap gap-2">
                            {aiSuggestions.broader_industries.map((ind: any, i: number) => (
                              <button
                                key={i}
                                onClick={() => { setKeywords(ind.industry); setCompanyName(''); setPendingSuggestionSearch(true); }}
                                title={ind.reason}
                                className="group inline-flex items-center gap-1.5 px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700/60 bg-white dark:bg-zinc-800/50 text-xs font-medium text-[var(--text-main)] hover:border-[#1ED4A7]/40 hover:bg-[#1ED4A7]/5 active:bg-[#1ED4A7]/10 transition-all"
                              >
                                <Factory className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-zinc-400 group-hover:text-[#1ED4A7] transition-colors" />
                                {ind.industry}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Search Tips */}
                      {aiSuggestions.search_tips?.length > 0 && (
                        <div className="mt-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-800/20 space-y-1.5">
                          {aiSuggestions.search_tips.map((tip: string, i: number) => (
                            <p key={i} className="text-[11px] text-zinc-600 dark:text-zinc-400 flex items-start gap-1.5">
                              <Zap className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                              {tip}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Recent Searches ── */}
                  {searchHistory.length > 0 && (
                    <div className="mb-5 text-left">
                      <div className="flex items-center justify-center gap-1.5 mb-3">
                        <Clock className="w-3.5 h-3.5 text-zinc-400" />
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Recent Searches</span>
                      </div>
                      <div className="space-y-1.5">
                        {searchHistory.slice(0, 5).map((entry) => {
                          const p = entry.params;
                          const parts: string[] = [];
                          if (p.companyName) parts.push(p.companyName);
                          if (p.keywords) parts.push(p.keywords);
                          if (p.locationValue) parts.push(buildLocationStrings(p.locationValue).join(', '));
                          else if (p.location) parts.push(p.location);
                          if (p.industries.length) parts.push(p.industries.join(', '));
                          const label = parts.join(' · ') || 'Untitled search';
                          const timeAgo = (() => {
                            const diff = Date.now() - entry.timestamp;
                            const mins = Math.floor(diff / 60000);
                            if (mins < 1) return 'just now';
                            if (mins < 60) return `${mins}m ago`;
                            const hrs = Math.floor(mins / 60);
                            if (hrs < 24) return `${hrs}h ago`;
                            return `${Math.floor(hrs / 24)}d ago`;
                          })();
                          return (
                            <div key={entry.id} className="group flex items-center gap-1.5 sm:gap-2">
                              <button
                                onClick={() => {
                                  setCompanyName(p.companyName);
                                  if (p.locationValue) setLocationValue(p.locationValue);
                                  else if (p.location) setLocationValue({ country: p.location, state: '', cities: [] });
                                  setKeywords(p.keywords);
                                  setIndustries(new Set(p.industries));
                                  setEmployeeRanges(new Set(p.employeeRanges));
                                  setPendingSuggestionSearch(true);
                                }}
                                className="flex-1 flex items-center gap-2 sm:gap-2.5 px-3 py-2.5 sm:py-2 rounded-lg border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50/50 dark:bg-zinc-800/30 hover:bg-[#1ED4A7]/5 hover:border-[#1ED4A7]/30 active:bg-[#1ED4A7]/10 transition-all text-left min-w-0"
                              >
                                <Search className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-zinc-400 flex-shrink-0" />
                                <span className="text-xs font-medium text-[var(--text-main)] truncate flex-1">{label}</span>
                                <span className={`text-[10px] flex-shrink-0 tabular-nums ${entry.resultCount === 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                                  {entry.resultCount === 0 ? '0' : entry.resultCount}
                                </span>
                                <span className="text-[10px] text-zinc-400 flex-shrink-0 hidden sm:inline">{timeAgo}</span>
                              </button>
                              <button
                                onClick={() => {
                                  removeSearchHistoryEntry(entry.id);
                                  setSearchHistory(getSearchHistory());
                                }}
                                className="p-1.5 sm:p-1 text-zinc-400 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 transition-all rounded"
                              >
                                <X className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-4 px-2">
                    Results are cached for 24 hours. Use "Retry with Fresh Data" above to bypass the cache.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                {/* Agent Progress Banner (compact, shown during enrichment when results are visible) */}
                {agentActive && searchPhases.length > 0 && (
                  <div className="sticky top-0 z-20 bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-[var(--border-color)] px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Radar className="w-3.5 h-3.5 text-[#1ED4A7] animate-pulse" />
                        <span className="text-[11px] font-semibold text-[var(--text-main)]">{t('leadFinder.companyDiscoveryAgent')}</span>
                      </div>
                      {/* Compact phase chips */}
                      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1">
                        {searchPhases.map((phase) => {
                          const isActive = phase.status === 'searching';
                          const isDone = phase.status === 'complete';
                          return (
                            <div key={phase.phase} className={`flex items-center gap-1 px-2 py-1 rounded-md flex-shrink-0 text-[9px] font-medium transition-all duration-300 ${
                              isActive ? 'bg-[#1ED4A7]/8 text-[var(--text-main)] ring-1 ring-[#1ED4A7]/25' :
                              isDone ? 'text-[#1ED4A7]' :
                              'text-zinc-400 dark:text-zinc-600'
                            }`}>
                              {isActive && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                              {isDone && <CheckCircle className="w-2.5 h-2.5" />}
                              {!isActive && !isDone && <div className="w-1 h-1 rounded-full border border-current" />}
                              <span className="whitespace-nowrap">{translatePhaseName(t, phase.name)}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Progress percentage */}
                      <span className="text-[10px] font-mono text-zinc-400 tabular-nums flex-shrink-0">
                        {Math.round((searchPhases.filter(p => p.status === 'complete').length / Math.max(searchPhases.length, 1)) * 100)}%
                      </span>
                    </div>
                    {/* Progress rail */}
                    <div className="relative h-[2px] rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden mt-2">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-[#1ED4A7] transition-all duration-700 ease-out"
                        style={{ width: `${Math.round((searchPhases.filter(p => p.status === 'complete').length / Math.max(searchPhases.length, 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Table Header */}
                <div className="sticky top-0 z-10 bg-zinc-50/80 dark:bg-zinc-900/30 border-b border-[var(--border-color)] hidden md:grid md:grid-cols-[40px_1.1fr_0.65fr_0.35fr_0.45fr_55px_0.75fr_80px] items-center px-4 py-2 gap-x-2">
                  <div /> {/* checkbox */}
                  <SortHeader label={t('companySearch.colCompany')} field="name" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <SortHeader label={t('companySearch.colIndustry')} field="industry" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <SortHeader label={t('companySearch.colSize')} field="employees" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <SortHeader label={t('companySearch.colRevenue')} field="revenue" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <SortHeader label={t('companySearch.colScore')} field="score" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <SortHeader label={t('companySearch.colLocation')} field="location" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 text-right pr-1">{t('companySearch.colActions')}</span>
                </div>

                {/* Rows */}
                {filteredResults.map(company => {
                  // v3.5.1: Use company ID + cleaned domain as composite key
                  // to prevent React from reusing component state across different companies
                  const companyDomain = (company.website_url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').toLowerCase().trim();
                  const compositeKey = `${company.id}:${companyDomain || company.name}`;
                  return (
                  <CompanyRow
                    key={compositeKey}
                    company={company}
                    selected={selectedIds.has(company.id)}
                    expanded={expandedId === company.id}
                    onToggleSelect={() => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        next.has(company.id) ? next.delete(company.id) : next.add(company.id);
                        return next;
                      });
                    }}
                    onToggleExpand={() => setExpandedId(expandedId === company.id ? null : company.id)}
                    batchEnrich={batchEnrichMap[company.id]}
                    bulkPeopleData={bulkPeopleMap[company.id]}
                    crmContacts={crmContactsMap[company.name]}
                    leadScore={computeCompanyScore(company, batchEnrichMap[company.id], crmContactsMap[company.name])}
                    brandData={brandMap[companyDomain] || undefined}
                    searchLocation={[locationValue.cities?.[0], locationValue.state].filter(Boolean).join(', ') || undefined}
                  />
                  );
                })}

                {/* Load More + Pagination */}
                {pagination && (() => {
                  const totalPages = pagination.total_pages || 1;
                  const currentPage = page;
                  const hasMore = currentPage < totalPages;
                  const totalEntries = pagination.total_entries || filteredResults.length;

                  return (
                    <div className="border-t border-[var(--border-color)] py-4 space-y-3">
                      {/* Load More button — primary action */}
                      {hasMore && (
                        <div className="flex justify-center">
                          <button
                            onClick={() => handleSearch(undefined, currentPage + 1, true)}
                            disabled={isSearching || isLoadingMore}
                            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shadow-sm"
                          >
                            {isLoadingMore ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                {t('companySearch.loadingMoreCompanies')}
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                {t('leadFinder.loadMoreCompanies')}
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Info row + page navigation */}
                      <div className="flex items-center justify-between px-2">
                        <span className="text-[11px] text-zinc-400 tabular-nums">
                          {t('companySearch.showingOf', { shown: String(filteredResults.length), total: totalEntries.toLocaleString() })}
                          {totalPages > 1 && <> &middot; {t('companySearch.pageOf', { current: currentPage, total: totalPages })}</>}
                        </span>
                        {totalPages > 1 && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleSearch(undefined, currentPage - 1)}
                              disabled={currentPage <= 1 || isSearching || isLoadingMore}
                              className="px-2 py-1 text-[11px] font-medium rounded-md border border-[var(--border-color)] text-zinc-500 hover:text-[var(--text-main)] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              {t('companySearch.prevLabel')}
                            </button>
                            {(() => {
                              const pageNumbers: (number | 'ellipsis')[] = [];
                              if (totalPages <= 7) {
                                for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
                              } else {
                                pageNumbers.push(1);
                                if (currentPage > 3) pageNumbers.push('ellipsis');
                                const start = Math.max(2, currentPage - 1);
                                const end = Math.min(totalPages - 1, currentPage + 1);
                                for (let i = start; i <= end; i++) pageNumbers.push(i);
                                if (currentPage < totalPages - 2) pageNumbers.push('ellipsis');
                                pageNumbers.push(totalPages);
                              }
                              return pageNumbers.map((pn, idx) =>
                                pn === 'ellipsis' ? (
                                  <span key={`ellipsis-${idx}`} className="px-0.5 text-[10px] text-zinc-400">…</span>
                                ) : (
                                  <button
                                    key={pn}
                                    onClick={() => handleSearch(undefined, pn)}
                                    disabled={isSearching || isLoadingMore}
                                    className={`w-7 h-7 text-[11px] font-medium rounded-md border transition-all disabled:cursor-not-allowed ${
                                      pn === currentPage
                                        ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/30 text-[#1ED4A7] font-semibold'
                                        : 'border-[var(--border-color)] text-zinc-500 hover:text-[var(--text-main)] hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                    }`}
                                  >
                                    {pn}
                                  </button>
                                )
                              );
                            })()}
                            <button
                              onClick={() => handleSearch(undefined, currentPage + 1)}
                              disabled={currentPage >= totalPages || isSearching || isLoadingMore}
                              className="px-2 py-1 text-[11px] font-medium rounded-md border border-[var(--border-color)] text-zinc-500 hover:text-[var(--text-main)] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              {t('companySearch.nextLabel')}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Per-page selector */}
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">{t('leadFinder.perPage')}</span>
                        <div className="flex items-center rounded-lg border border-[var(--border-color)] overflow-hidden">
                          {[10, 25, 50, 100].map(n => (
                            <button
                              key={n}
                              onClick={() => { setPerPage(n); setPage(1); }}
                              className={`flex items-center justify-center px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                perPage === n
                                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                                  : 'text-zinc-500 hover:text-[var(--text-main)] hover:bg-zinc-50 dark:hover:bg-zinc-800'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Mobile spacer + bottom bar */}
          {results.length > 0 && <div className="md:hidden h-24 flex-shrink-0" />}
        </div>
      </div>

      {/* Mobile Bottom Action Bar */}
      {results.length > 0 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-[60] border-t border-zinc-200 dark:border-zinc-800 bg-white/98 dark:bg-[#0a0a0a]/98 backdrop-blur-xl px-4 py-3 pb-[max(1rem,calc(0.75rem+env(safe-area-inset-bottom,16px)))] shadow-[0_-4px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.4)]">
          <div className="flex flex-col gap-2">
            {/* Load More row */}
            {pagination && page < (pagination.total_pages || 1) && (
              <button
                onClick={() => handleSearch(undefined, page + 1, true)}
                disabled={isSearching || isLoadingMore}
                className="w-full flex items-center justify-center gap-2 h-10 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-semibold rounded-xl disabled:opacity-40 transition-all active:scale-[0.98]"
              >
                {isLoadingMore ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('companySearch.loadingMore')}</>
                ) : (
                  <><ChevronDown className="w-3.5 h-3.5" /> {t('leadFinder.loadMoreCompanies')}</>
                )}
              </button>
            )}
            <div className="flex items-center gap-2">
              {/* New Search */}
              <button
                onClick={() => {
                  setResults([]);
                  setAllResults([]);
                  setHasSearched(false);
                  setAgentActive(false);
                  setPagination(null);
                  setSelectedIds(new Set());
                  setBatchEnrichMap({});
                  setBulkPeopleMap({});
                  setCrmContactsMap({});
                  setBrandMap({});
                  brandFetchedRef.current = new Set();
                  clearCompanyLogoCache();
                  setSearchPhases([]);
                  setSearchActivity([]);
                }}
                className="flex items-center justify-center gap-1.5 h-11 px-4 border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 text-sm font-medium rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all flex-shrink-0"
              >
                <Search className="w-4 h-4" />
                <span>{t('leadFinder.new')}</span>
              </button>
              {/* Export */}
              <button
                onClick={handleExportCSV}
                disabled={results.length === 0}
                className="flex-1 flex items-center justify-center gap-2 h-11 bg-zinc-900 text-white dark:bg-white dark:text-black text-sm font-semibold rounded-xl disabled:opacity-50 shadow-sm transition-colors active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                {t('companySearch.exportCount', { count: results.length })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save Search Dialog ── */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowSaveDialog(false)}>
          <div
            className="bg-white dark:bg-zinc-900 rounded-xl border border-[var(--border-color)] shadow-xl p-5 w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <Bookmark className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-main)]">{t('leadFinder.saveSearchResults')}</h3>
                <p className="text-[11px] text-zinc-500">{results.length} {t('leadFinder.companiesWillBeSaved')}</p>
              </div>
            </div>
            <input
              type="text"
              value={saveListName}
              onChange={e => setSaveListName(e.target.value)}
              placeholder={`Company Search — ${new Date().toLocaleDateString()}`}
              className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-[var(--border-color)] rounded-lg focus:ring-2 focus:ring-zinc-400/30 focus:border-zinc-400 outline-none transition-all placeholder:text-zinc-400 mb-4"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSaveSearchResults(); }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="flex-1 py-2 text-xs font-medium rounded-lg border border-[var(--border-color)] text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                {t('companySearch.cancel')}
              </button>
              <button
                onClick={handleSaveSearchResults}
                disabled={savingList}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {savingList ? <><Loader2 className="w-3 h-3 animate-spin" /> {t('companySearch.saving')}</> : <><Bookmark className="w-3 h-3" /> {t('companySearch.saveLabel')}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pool Stats Dialog ── */}
      {showPoolStats && poolStats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowPoolStats(false)}>
          <div
            className="bg-white dark:bg-zinc-900 rounded-xl border border-[var(--border-color)] shadow-xl p-5 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#1ED4A7]/10 flex items-center justify-center flex-shrink-0">
                <Database className="w-4 h-4 text-[#1ED4A7]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-main)]">{t('leadFinder.intelligencePoolStats')}</h3>
                <p className="text-[11px] text-zinc-500">{t('leadFinder.sharedEnrichmentData')}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-[var(--border-color)]">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">{t('leadFinder.poolContents')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-zinc-500">Emails</div>
                    <div className="text-lg font-bold text-[var(--text-main)]">{poolStats.emails_stored?.toLocaleString() || 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">{t('leadFinder.profiles')}</div>
                    <div className="text-lg font-bold text-[var(--text-main)]">{poolStats.people_stored?.toLocaleString() || 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">{t('leadFinder.companies')}</div>
                    <div className="text-lg font-bold text-[var(--text-main)]">{poolStats.companies_stored?.toLocaleString() || 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">{t('leadFinder.patterns')}</div>
                    <div className="text-lg font-bold text-[var(--text-main)]">{poolStats.patterns_stored?.toLocaleString() || 0}</div>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#1ED4A7]/5 border border-[#1ED4A7]/20">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1ED4A7] mb-2">Credits Saved</div>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-bold text-[#1ED4A7]">{poolStats.api_calls_saved?.toLocaleString() || 0}</div>
                  <div className="text-xs text-zinc-500">API calls avoided</div>
                </div>
                {poolStats.estimated_cost_saved > 0 && (
                  <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                    ≈ ${poolStats.estimated_cost_saved.toFixed(2)} saved
                  </div>
                )}
              </div>

              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-[var(--border-color)]">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Total Entries</div>
                <div className="text-lg font-bold text-[var(--text-main)]">{poolStats.total_pool_entries?.toLocaleString() || 0}</div>
                <div className="text-[10px] text-zinc-400 mt-1">Cached enrichment data</div>
              </div>

              <div className="text-[10px] text-zinc-400 text-center pt-2">
                Pool data is shared across all Contndr users and expires automatically after 7-24 hours
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setShowPoolStats(false)}
                className="flex-1 py-2 text-xs font-medium rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => { setShowPoolStats(false); fetchPoolStats(); toast.success(t('leadFinder.toastPoolStatsRefreshed')); }}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-color)] text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function SortHeader({ label, field, current, asc, onSort }: {
  label: string; field: SortField; current: SortField; asc: boolean; onSort: (f: SortField) => void;
}) {
  return (
    <button
      onClick={() => onSort(field)}
      className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1 transition-colors ${
        current === field ? 'text-[#1ED4A7]' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
      }`}
    >
      {label}
      {current === field && <ArrowUpDown className={`w-3 h-3 ${asc ? '' : 'rotate-180'}`} />}
    </button>
  );
}

function CompanyRow({ company, selected, expanded, onToggleSelect, onToggleExpand, batchEnrich, bulkPeopleData, crmContacts, leadScore, brandData, searchLocation }: {
  company: Company; selected: boolean; expanded: boolean; onToggleSelect: () => void; onToggleExpand: () => void;
  batchEnrich?: any;
  bulkPeopleData?: { people: Person[]; emailMap: Record<string, { email: string; source: string; confidence: string }> };
  crmContacts?: CrmContact[];
  leadScore?: number;
  brandData?: { logo_url?: string; icon_url?: string; name?: string; colors?: { hex: string; type: string }[]; source?: string };
  searchLocation?: string;
}) {
  const { t } = useTranslation();
  const loc = [company.city, company.state, company.country].filter(Boolean).join(', ');
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichData, setEnrichData] = useState<{
    employees?: number; employee_range?: string; revenue?: string;
    founded_year?: number; industry?: string; description?: string;
    legal_name?: string; company_type?: string; incorporation_date?: string; company_status?: string;
    sec_ticker?: string; sec_sic?: string;
    tech_stack?: { name: string; category: string }[];
    social_links?: Record<string, string>;
    careers_count?: number;
    officers?: { name: string; position: string }[];
    team_members?: { name: string; title: string; email?: string; linkedin?: string }[];
    data_sources?: string[];
  } | null>(null);

  // ── Inline Decision Maker Finder (single-step: LinkedIn + Emails) ──
  const [people, setPeople] = useState<Person[]>([]);
  const [isFindingPeople, setIsFindingPeople] = useState(false);
  const [hasFetchedPeople, setHasFetchedPeople] = useState(false);
  const [findPeopleStage, setFindPeopleStage] = useState<'idle' | 'linkedin' | 'emails' | 'done'>('idle');
  const [emailMap, setEmailMap] = useState<Record<string, { email: string; source: string; confidence: string }>>({});
  const [searchLocationContext, setSearchLocationContext] = useState(searchLocation || '');
  const [showOnlyInArea, setShowOnlyInArea] = useState(false);

  // ── Pool Coverage Indicator ──
  const [poolCoverage, setPoolCoverage] = useState<any>(null);

  // Pool coverage disabled to avoid CPU timeout - too many parallel requests
  // Can be manually fetched on-demand instead
  /*
  useEffect(() => {
    const domain = company.website_url
      ? company.website_url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()
      : '';
    if (domain) {
      const fetchCoverage = async () => {
        try {
          const headers = await getAuthHeaders();
          const res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/pool-coverage`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                company_name: company.name,
                domain,
                location: loc,
              }),
            }
          );
          if (res.ok) {
            const data = await res.json();
            setPoolCoverage(data.coverage);
          }
        } catch (err) {
          console.error('[POOL COVERAGE] Fetch error:', err);
        }
      };
      fetchCoverage();
    }
  }, [company.id]);
  */

  // ── Manual email input ──
  const [manualEmailEditId, setManualEmailEditId] = useState<string | null>(null);
  const [manualEmailValue, setManualEmailValue] = useState('');
  const [reEnrichingId, setReEnrichingId] = useState<string | null>(null);

  const handleManualEmailSubmit = (personId: string) => {
    const email = manualEmailValue.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t('leadFinder.toastEnterValidEmail'));
      return;
    }
    setEmailMap(prev => ({ ...prev, [personId]: { email, source: 'manual', confidence: 'manual' } }));
    setManualEmailEditId(null);
    setManualEmailValue('');
    toast.success(t('leadFinder.toastEmailAdded'));
  };

  const handleReEnrichPerson = async (person: Person) => {
    const domain = company.website_url
      ? company.website_url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()
      : '';
    if (!domain) {
      toast.error(t('leadFinder.toastNoDomainForEnrichment'));
      return;
    }
    setReEnrichingId(person.id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/enrich-people-email`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            people: [{ id: person.id, name: person.name, title: person.title, linkedin_url: person.linkedin_url }],
            domain,
            force: true, // bypass cache for retry
          }),
        }
      );
      if (!res.ok) throw new Error('Enrichment failed');
      const data = await res.json();
      const found = data.results?.[person.id];
      if (found?.email) {
        setEmailMap(prev => ({ ...prev, [person.id]: found }));
        toast.success(t('leadFinder.toastFoundEmailFor', { name: person.name }));
      } else {
        toast.info(t('leadFinder.toastNoEmailFoundFor', { name: person.name }));
      }
    } catch (err: any) {
      console.error('[RE-ENRICH] Error:', err);
      toast.error(t('leadFinder.toastEmailEnrichmentFailed'));
    } finally {
      setReEnrichingId(null);
    }
  };

  // ── Save to CRM ──
  const [isSavingToCrm, setIsSavingToCrm] = useState(false);
  const [savedToCrm, setSavedToCrm] = useState<Set<string>>(new Set()); // person IDs already saved

  const handleSavePeopleToCrm = async (peopleToSave?: Person[]) => {
    const candidates = (peopleToSave || people).filter(p => !p.id.startsWith('crm-') && !savedToCrm.has(p.id));
    // Save people with either a direct email or a callable company/person line.
    // Local-business outreach often starts with calls before direct emails exist.
    const toSave = candidates.filter(p => emailMap[p.id]?.email || p.phone || company.phone);
    const skippedNoEmail = candidates.length - toSave.length;
    if (toSave.length === 0 && skippedNoEmail > 0) {
      toast.error(`${skippedNoEmail} contact${skippedNoEmail !== 1 ? 's' : ''} skipped — email or phone required for outreach`);
      return;
    }
    if (toSave.length === 0) {
      toast.info(t('leadFinder.toastAllContactsInCRM'));
      return;
    }
    if (skippedNoEmail > 0) {
      toast.info(`${skippedNoEmail} contact${skippedNoEmail !== 1 ? 's' : ''} without email or phone skipped`);
    }
    setIsSavingToCrm(true);
    try {
      const headers = await getAuthHeaders();
      const payload = {
        people: toSave.map(p => ({
          id: p.id,
          name: p.name,
          title: p.title,
          linkedin_url: p.linkedin_url,
          email: emailMap[p.id]?.email || '',
          email_source: emailMap[p.id]?.source || '',
          email_confidence: emailMap[p.id]?.confidence || '',
          phone: p.phone || company.phone || '',
        })),
        company: {
          name: company.name,
          website_url: company.website_url,
          phone: company.phone,
          address: company.address,
          city: company.city,
          state: company.state,
          country: company.country,
          industry: company.industry || batchEnrich?.industry || enrichData?.industry || '',
          estimated_num_employees: company.estimated_num_employees || batchEnrich?.employees || enrichData?.employees,
          annual_revenue_printed: company.annual_revenue_printed || batchEnrich?.revenue || enrichData?.revenue || '',
          rating: company.rating,
          reviews_count: company.reviews_count,
        },
      };

      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/save-people-to-crm`,
        { method: 'POST', headers, body: JSON.stringify(payload) }
      );
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'LEAD_LIMIT_EXCEEDED') {
          toast.error(data.message || 'Lead limit exceeded');
        } else {
          toast.error(data.error || 'Failed to save');
        }
        return;
      }

      const { results } = data;
      setSavedToCrm(prev => {
        const next = new Set(prev);
        toSave.forEach(p => next.add(p.id));
        return next;
      });

      if (results.saved > 0) {
        toast.success(`${results.saved} contact${results.saved > 1 ? 's' : ''} saved to CRM${results.skipped > 0 ? ` (${results.skipped} skipped)` : ''}`);
      } else if (results.skipped > 0) {
        toast.info(`${results.skipped} contact${results.skipped > 1 ? 's' : ''} already in CRM`);
      }
    } catch (err: any) {
      console.error('[CompanySearch] Save to CRM error:', err);
      toast.error(t('leadFinder.toastFailedToSaveContacts'));
    } finally {
      setIsSavingToCrm(false);
    }
  };

  const handleFindPeople = async () => {
    if (isFindingPeople || hasFetchedPeople) return;
    setIsFindingPeople(true);
    setFindPeopleStage('linkedin');
    try {
      const headers = await getAuthHeaders();
      const domain = company.website_url
        ? company.website_url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        : '';
      const companyLoc = [company.city, company.state, company.country].filter(Boolean).join(', ');

      // Step 1: Find LinkedIn profiles
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/find-people`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_name: company.name,
            domain: domain || undefined,
            location: companyLoc || undefined,
            search_location: searchLocation || undefined,
            phone: company.phone || undefined,
          }),
        }
      );
      if (!res.ok) throw new Error('Failed to find people');
      const data = await res.json();
      const foundPeople: Person[] = data.people || [];
      setPeople(foundPeople);
      setSearchLocationContext(data.search_location || searchLocation || '');
      setHasFetchedPeople(true);

      // Seed email map with CRM + Hunter emails returned from backend
      const returnedEmails: Record<string, { email: string; source: string; confidence: string }> = data.crm_emails || {};
      if (Object.keys(returnedEmails).length > 0) {
        setEmailMap(prev => ({ ...prev, ...returnedEmails }));
      }

      if (foundPeople.length === 0) {
        toast.info(t('leadFinder.toastNoDecisionMakersFor', { name: company.name }));
        setFindPeopleStage('done');
        return;
      }

      const crmCount = foundPeople.filter(p => p.id.startsWith('crm-')).length;
      const externalCount = foundPeople.length - crmCount;
      const emailsAlready = Object.keys(returnedEmails).length;
      const isFromPool = data.source === 'pool';
      const parts: string[] = [];
      if (crmCount > 0) parts.push(`${crmCount} from CRM`);
      if (externalCount > 0) parts.push(`${externalCount} ${isFromPool ? 'from intelligence pool' : 'discovered'}`);
      toast.success(`Found ${foundPeople.length} decision maker${foundPeople.length !== 1 ? 's' : ''}${emailsAlready > 0 ? ` (${emailsAlready} with emails)` : ''}${parts.length > 0 ? ` — ${parts.join(', ')}` : ''}`);

      // Step 2: Enrich remaining emails via Hunter.io email-finder + Findymail for people without emails
      const cleanDomain = domain.replace(/^www\./, '').replace(/\/.*$/, '').trim();
      const peopleNeedingEmail = foundPeople.filter(p => !returnedEmails[p.id]);
      if (cleanDomain && peopleNeedingEmail.length > 0) {
        setFindPeopleStage('emails');
        try {
          const emailRes = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/enrich-people-email`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                people: peopleNeedingEmail.map(p => ({ id: p.id, name: p.name, title: p.title, linkedin_url: p.linkedin_url })),
                domain: cleanDomain,
              }),
            }
          );
          if (emailRes.ok) {
            const emailData = await emailRes.json();
            setEmailMap(prev => ({ ...prev, ...(emailData.results || {}) }));
            const found = Object.keys(emailData.results || {}).length;
            const poolHits = emailData.pool_hits || 0;
            if (found > 0) {
              const poolNote = poolHits > 0 ? ` (${poolHits} instant from intelligence pool)` : '';
              toast.success(`Found ${found} additional verified email${found !== 1 ? 's' : ''}${poolNote}`);
            }
          }
        } catch (emailErr: any) {
          console.error('[EMAIL ENRICH] Auto-enrich error (non-fatal):', emailErr);
        }
      } else if (emailsAlready > 0) {
        // All emails already found via Hunter domain-search — no need for individual enrichment
        console.log(`[FIND PEOPLE] All ${emailsAlready} emails already discovered via Hunter.io domain-search`);
      }

      setFindPeopleStage('done');
    } catch (err: any) {
      console.error('[FIND PEOPLE] Error:', err);
      toast.error(t('leadFinder.toastFailedToFindDecisionMakers'));
      setFindPeopleStage('idle');
    } finally {
      setIsFindingPeople(false);
    }
  };

  const handleDeepEnrich = async () => {
    if (isEnriching || enrichData) return;
    setIsEnriching(true);
    try {
      const headers = await getAuthHeaders();
      const companyLoc = [company.city, company.state, company.country].filter(Boolean).join(', ');
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/company-search/enrich-deep`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_name: company.name,
            location: companyLoc || undefined,
            company_id: company.id,
          }),
        }
      );
      if (!res.ok) throw new Error('Enrichment failed');
      const data = await res.json();
      setEnrichData(data);
      if (data.employees || data.revenue) {
        toast.success(t('leadFinder.toastFoundDataFor', { name: company.name }));
      } else {
        toast.info(t('leadFinder.toastNoAdditionalDataFor', { name: company.name }));
      }
    } catch (err: any) {
      console.error('[DEEP ENRICH] Error:', err);
      toast.error(t('leadFinder.toastDeepEnrichmentFailed'));
    } finally {
      setIsEnriching(false);
    }
  };

  // Merge enriched data with company data for display (company > batch > deep enrich)
  const displayEmployees = company.estimated_num_employees || batchEnrich?.employees || enrichData?.employees || 0;
  const displayRevenue = company.annual_revenue_printed || batchEnrich?.revenue || enrichData?.revenue || '';
  const displayFounded = company.founded_year || batchEnrich?.founded_year || enrichData?.founded_year || 0;
  const displayIndustry = company.industry || batchEnrich?.industry || enrichData?.industry || '';
  const displayDescription = company.short_description || batchEnrich?.description || enrichData?.description || '';
  const isHotCompany = (leadScore != null && leadScore > 80);

  // Brand logo resolution now handled by shared CompanyLogo component (5-tier pipeline with quality gates)
  // NOTE: Do NOT include company.logo_url here — it's Apollo's raw logo (often Clearbit for the wrong domain).
  // CompanyLogo already resolves Clearbit from the actual website_url domain as tier 2.
  const bestBrandLogoUrl = brandData?.logo_url || batchEnrich?.brand_logo_url || (company as any).brand_logo_url || '';
  const bestBrandLogoSource = brandData?.source || batchEnrich?.brand_logo_source || (company as any).brand_logo_source || '';

  // Auto-populate people from bulk find if available and not already fetched
  useEffect(() => {
    if (bulkPeopleData && !hasFetchedPeople && bulkPeopleData.people.length > 0) {
      setPeople(bulkPeopleData.people);
      setEmailMap(bulkPeopleData.emailMap);
      setHasFetchedPeople(true);
      setFindPeopleStage('done');
    }
  }, [bulkPeopleData, hasFetchedPeople]);

  return (
    <div className={`border-b border-[var(--border-color)] transition-colors relative ${selected ? 'bg-[#1ED4A7]/[0.03]' : isHotCompany ? 'bg-[#1ED4A7]/[0.03] dark:bg-[#1ED4A7]/[0.02]' : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30'}`}>
      {/* Hot company left accent bar */}
      {isHotCompany && <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-[#1ED4A7]/70" />}
      {/* Desktop */}
      <div className="hidden md:grid md:grid-cols-[40px_1.1fr_0.65fr_0.35fr_0.45fr_55px_0.75fr_80px] items-center px-4 py-2.5 gap-x-2">
        {/* Checkbox */}
        <div onClick={onToggleSelect}>
          <div
            className={`w-[18px] h-[18px] rounded border cursor-pointer flex items-center justify-center transition-all ${
              selected ? 'bg-[#1ED4A7] border-[#1ED4A7] text-black' : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-400'
            }`}
          >
            {selected && <Check className="w-3 h-3" />}
          </div>
        </div>

        {/* Company */}
        <div className="min-w-0 flex items-center gap-2.5 cursor-pointer" onClick={onToggleExpand}>
          <CompanyLogo
            domain={company.website_url}
            brandLogoUrl={bestBrandLogoUrl}
            brandLogoSource={bestBrandLogoSource}
            linkedinUrl={company.linkedin_url}
            companyName={company.name}
            size={32}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-[var(--text-main)] truncate">{toTitleCase(company.name) || '—'}</span>
              {isHotCompany && (
                <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20" title="Hot Company (Score > 80)">
                  <Flame className="w-2.5 h-2.5" />Hot
                </span>
              )}
              {crmContacts && crmContacts.length > 0 && (
                <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-[#1ED4A7]/15 text-[#1ED4A7] border border-[#1ED4A7]/20" title={`${crmContacts.length} contact${crmContacts.length !== 1 ? 's' : ''} in CRM`}>
                  <Users className="w-2.5 h-2.5" />{crmContacts.length} in CRM
                </span>
              )}
              {poolCoverage && poolCoverage.coverage_score > 0 && (
                <span
                  className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20"
                  title={`Pool coverage: ${poolCoverage.coverage_score}%${poolCoverage.has_people_data ? ` • ${poolCoverage.people_count} profiles` : ''}${poolCoverage.emails_count > 0 ? ` • ${poolCoverage.emails_count} emails` : ''}`}
                >
                  <Database className="w-2.5 h-2.5" />{poolCoverage.coverage_score}%
                </span>
              )}
            </div>
            {company.website_url && (
              <span className="text-[10px] text-zinc-400 truncate block">{displayDomain(company.website_url)}</span>
            )}
          </div>
          <ChevronRight className={`w-3 h-3 text-zinc-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>

        {/* Industry */}
        <div className="min-w-0">
          {displayIndustry ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate block">{toTitleCase(displayIndustry)}</span>
          ) : (
            <span className="text-xs text-zinc-300 dark:text-zinc-600 italic">—</span>
          )}
        </div>

        {/* Employees */}
        <div className="flex items-center gap-1">
          <Users className="w-2.5 h-2.5 text-zinc-400 flex-shrink-0" />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {displayEmployees > 0 ? formatEmployeeCount(displayEmployees) : '—'}
          </span>
        </div>

        {/* Revenue */}
        <div className="flex items-center gap-1">
          {displayRevenue ? (
            <>
              <DollarSign className="w-2.5 h-2.5 text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{displayRevenue}</span>
            </>
          ) : (
            <>
              <DollarSign className="w-2.5 h-2.5 text-zinc-400 flex-shrink-0" />
              <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
            </>
          )}
        </div>

        {/* Score */}
        <div className="flex items-center justify-center">
          {leadScore != null ? (
            <LeadScoreBadge score={leadScore} size="sm" showLabel={false} />
          ) : null}
        </div>

        {/* Location */}
        <div className="flex items-center gap-1 min-w-0">
          <MapPin className="w-2.5 h-2.5 text-zinc-400 flex-shrink-0" />
          <span className="text-xs text-zinc-400 truncate">{loc || '—'}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-0.5">
          {company.phone && (
            <SmartPhoneButton
              phone={company.phone}
              businessName={company.name}
              iconClassName="w-3.5 h-3.5"
              className="p-1"
            />
          )}
          {company.linkedin_url && (
            <a href={company.linkedin_url} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-[#0077B5] rounded transition-colors">
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          )}
          {company.website_url && (
            <a href={company.website_url.startsWith('http') ? company.website_url : `https://${company.website_url}`} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-[var(--text-main)] rounded transition-colors">
              <Globe className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Desktop Expanded Detail */}
      {expanded && (
        <div className="px-3 md:px-4 pb-3">
          <div className="md:ml-[40px] p-3 md:p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/30 border border-[var(--border-color)] space-y-3">
            {/* Brand header with logo + colors */}
            {brandData && (brandData.logo_url || brandData.colors) && (
              <div className="flex items-center gap-3 pb-2 border-b border-zinc-100 dark:border-zinc-800/50">
                <CompanyLogo
                  domain={company.website_url}
                  brandLogoUrl={bestBrandLogoUrl}
                  brandLogoSource={bestBrandLogoSource}
                  linkedinUrl={company.linkedin_url}
                  companyName={company.name}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  {brandData.name && <span className="text-xs font-semibold text-[var(--text-main)] block truncate">{brandData.name}</span>}
                  {brandData.colors && brandData.colors.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      {brandData.colors.slice(0, 5).map((c, i) => (
                        <div key={i} className="w-3.5 h-3.5 rounded-full border border-zinc-200 dark:border-zinc-700" style={{ backgroundColor: c.hex }} title={`${c.type}: ${c.hex}`} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {displayDescription && (
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{displayDescription}</p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {company.phone && (
                <div>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">{t('companySearch.phone', 'Phone')}</span>
                  <SmartPhoneButton
                    phone={company.phone}
                    businessName={company.name}
                    showNumber
                    displayNumber={formatPhoneNumber(company.phone)}
                    iconClassName="w-3.5 h-3.5"
                    numberClassName="text-xs text-zinc-700 dark:text-zinc-300 font-mono"
                  />
                </div>
              )}
              {displayFounded > 0 && (
                <div>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">{t('companySearch.founded', 'Founded')}</span>
                  <span className="text-xs text-zinc-700 dark:text-zinc-300">{displayFounded}</span>
                </div>
              )}
              {displayEmployees > 0 && (
                <div>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">{t('companySearch.employees', 'Employees')}</span>
                  <span className="text-xs text-zinc-700 dark:text-zinc-300">
                    {displayEmployees.toLocaleString()}
                    {(enrichData?.employee_range || batchEnrich?.employee_range) && <span className="text-zinc-400 ml-1">({enrichData?.employee_range || batchEnrich?.employee_range})</span>}
                  </span>
                </div>
              )}
              {displayRevenue && (
                <div>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">{t('companySearch.revenue', 'Revenue')}</span>
                  <span className="text-xs text-zinc-700 dark:text-zinc-300 font-semibold">{displayRevenue}</span>
                </div>
              )}
              {company.rating ? (
                <div>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">{t('companySearch.rating', 'Rating')}</span>
                  <span className="text-xs text-zinc-600 dark:text-zinc-300 font-medium">{company.rating}★ {company.reviews_count ? `(${company.reviews_count} reviews)` : ''}</span>
                </div>
              ) : null}
              {company.address && (
                <div className="col-span-2">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">{t('companySearch.location', 'Address')}</span>
                  <span className="text-xs text-zinc-700 dark:text-zinc-300">{company.address}</span>
                </div>
              )}
            </div>

            {/* ��─ Enhanced Enrichment Data ── */}
            {/* Legal / Registry Info */}
            {(enrichData?.legal_name || enrichData?.company_type || enrichData?.company_status || enrichData?.sec_ticker || company.legal_name || company.company_type || company.sec_ticker) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {(enrichData?.legal_name || company.legal_name) && (
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">Legal Name</span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">{enrichData?.legal_name || company.legal_name}</span>
                  </div>
                )}
                {(enrichData?.company_type || company.company_type) && (
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">Entity Type</span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">{enrichData?.company_type || company.company_type}</span>
                  </div>
                )}
                {(enrichData?.company_status || company.company_status) && (
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">Status</span>
                    <span className={`text-xs font-medium ${(enrichData?.company_status || company.company_status || '').toLowerCase() === 'active' ? 'text-[#1ED4A7]' : 'text-zinc-400'}`}>
                      {toTitleCase(enrichData?.company_status || company.company_status || '')}
                    </span>
                  </div>
                )}
                {(enrichData?.sec_ticker || company.sec_ticker) && (
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">Ticker</span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300 font-mono font-semibold">{enrichData?.sec_ticker || company.sec_ticker}</span>
                  </div>
                )}
                {enrichData?.incorporation_date && (
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">Incorporated</span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">{enrichData.incorporation_date}</span>
                  </div>
                )}
                {(enrichData?.careers_count ?? company.careers_count ?? 0) > 0 && (
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-0.5">Open Roles</span>
                    <span className="text-xs text-[#1ED4A7] font-semibold">{enrichData?.careers_count || company.careers_count} positions</span>
                  </div>
                )}
              </div>
            )}

            {/* Tech Stack */}
            {((enrichData?.tech_stack || company.tech_stack)?.length ?? 0) > 0 && (
              <div>
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium block mb-1.5">Tech Stack</span>
                <div className="flex flex-wrap gap-1">
                  {(enrichData?.tech_stack || company.tech_stack || []).map((t: { name: string; category: string }, i: number) => (
                    <span key={`${t.name}-${i}`} className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/60" title={t.category}>
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Social Links */}
            {(() => {
              const links = enrichData?.social_links || company.social_links;
              if (!links || Object.keys(links).length === 0) return null;
              const iconMap: Record<string, string> = { linkedin: 'LinkedIn', twitter: 'X / Twitter', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', github: 'GitHub' };
              return (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {Object.entries(links).map(([key, url]) => url ? (
                    <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 hover:text-[#1ED4A7] hover:border-[#1ED4A7]/30 transition-colors"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      {iconMap[key] || key}
                    </a>
                  ) : null)}
                </div>
              );
            })()}

            {/* Data verification indicator — neutral, no source names exposed */}
            {(enrichData?.data_sources || company.data_sources)?.length ? (
              <div className="flex items-center gap-1.5 pt-0.5">
                <Database className="w-3 h-3 text-zinc-400" />
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                  Verified from {(enrichData?.data_sources || company.data_sources || []).length} sources
                </span>
              </div>
            ) : null}

            {/* ── CRM Contacts Preview ── */}
            {crmContacts && crmContacts.length > 0 && !hasFetchedPeople && (
              <div className="rounded-lg border border-[#1ED4A7]/20 bg-[#1ED4A7]/[0.03] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-3.5 h-3.5 text-[#1ED4A7]" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1ED4A7]">
                    Existing CRM Contacts
                  </span>
                  <span className="text-[10px] bg-[#1ED4A7]/15 text-[#1ED4A7] px-1.5 py-0.5 rounded font-semibold">{crmContacts.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {crmContacts.slice(0, 6).map(contact => (
                    <div key={contact.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/50 dark:bg-zinc-900/30 border border-[var(--border-color)]">
                      <div className="w-6 h-6 rounded-full bg-[#1ED4A7]/10 flex items-center justify-center flex-shrink-0">
                        <UserCircle className="w-3.5 h-3.5 text-[#1ED4A7]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-medium text-[var(--text-main)] truncate block">{contact.contact_name || '—'}</span>
                        <span className="text-[9px] text-zinc-400 truncate block">{contact.job_title || contact.email || '—'}</span>
                      </div>
                      {contact.email && (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(contact.email); toast.success(t('leadFinder.toastEmailCopied')); }}
                          className="p-0.5 text-[#1ED4A7] hover:text-[#19b892] flex-shrink-0"
                          title={contact.email}
                        >
                          <Mail className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {crmContacts.length > 6 && (
                  <span className="text-[10px] text-zinc-400 mt-1.5 block">+ {crmContacts.length - 6} more contacts in CRM</span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {/* Deep enrich button — only show when missing size/revenue data */}
              {(!displayEmployees || !displayRevenue) && !enrichData && !batchEnrich && (
                <button
                  onClick={handleDeepEnrich}
                  disabled={isEnriching}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all disabled:opacity-50"
                >
                  {isEnriching ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> {t('companySearch.enriching')}</>
                  ) : (
                    <><Zap className="w-3 h-3" /> {t('companySearch.deepEnrichGetData')}</>
                  )}
                </button>
              )}
              {(enrichData || batchEnrich) && (
                <span className="text-[10px] text-[#1ED4A7] font-medium flex items-center gap-1">
                  <Check className="w-3 h-3" /> {t('companySearch.enriched')}
                </span>
              )}
              <button
                onClick={handleFindPeople}
                disabled={isFindingPeople || hasFetchedPeople}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg shadow-sm transition-all ${
                  hasFetchedPeople
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 cursor-default'
                    : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100'
                } disabled:opacity-60`}
              >
                {isFindingPeople ? (
                  findPeopleStage === 'emails' ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('companySearch.findingEmails')}</>
                  ) : (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('companySearch.searchingProfilesLabel')}</>
                  )
                ) : hasFetchedPeople ? (
                  <><Check className="w-3.5 h-3.5" /> {t('companySearch.decisionMakersSummary', { count: people.length, plural: people.length !== 1 ? 's' : '' })}{Object.keys(emailMap).length > 0 ? ` · ${t('companySearch.emailsSummary', { count: Object.keys(emailMap).length, plural: Object.keys(emailMap).length !== 1 ? 's' : '' })}` : ''}</>
                ) : (
                  <><Sparkles className="w-3.5 h-3.5" /> {t('companySearch.findDecisionMakers')}</>
                )}
              </button>
            </div>

            {/* ── Inline People Results ── */}
            {(isFindingPeople || people.length > 0) && (
              <div className="pt-3 border-t border-zinc-200/60 dark:border-zinc-700/40">
                <div className="flex items-center gap-2 mb-2.5">
                  <Users className="w-3.5 h-3.5 text-[#1ED4A7]" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {t('companySearch.decisionMakers')}
                  </span>
                  {people.length > 0 && (
                    <span className="text-[10px] bg-[#1ED4A7]/10 text-[#1ED4A7] px-1.5 py-0.5 rounded font-semibold">{people.length}</span>
                  )}
                  {Object.keys(emailMap).length > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-[#1ED4A7]">
                      <ShieldCheck className="w-3 h-3" /> {Object.keys(emailMap).length}/{people.length} {t('companySearch.emailsLabel')}
                    </span>
                  )}
                  {findPeopleStage === 'emails' && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                      <Loader2 className="w-3 h-3 animate-spin" /> {t('companySearch.findingEmailsLower')}
                    </span>
                  )}
                  {/* Location filter toggle */}
                  {searchLocationContext && people.length > 0 && (() => {
                    const inAreaCount = people.filter(p => isPersonInArea(p.location, searchLocationContext)).length;
                    const outCount = people.filter(p => p.location && !isPersonInArea(p.location, searchLocationContext)).length;
                    if (inAreaCount === 0 && outCount === 0) return null;
                    return (
                      <button
                        onClick={() => setShowOnlyInArea(!showOnlyInArea)}
                        className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded transition-all ${
                          showOnlyInArea
                            ? 'bg-[#1ED4A7]/15 text-[#1ED4A7]'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                        title={showOnlyInArea ? t('companySearch.showAllContacts') : t('companySearch.showOnlyInAreaTitle', { location: searchLocationContext })}
                      >
                        <MapPin className="w-2.5 h-2.5" />
                        {showOnlyInArea ? t('companySearch.inAreaCount', { count: inAreaCount }) : t('companySearch.countInArea', { count: inAreaCount })}
                        {outCount > 0 && !showOnlyInArea && <span className="text-zinc-400">· {t('companySearch.otherCount', { count: outCount })}</span>}
                      </button>
                    );
                  })()}
                  {/* Save All to CRM button — email or callable phone qualifies for outreach */}
                  {people.length > 0 && findPeopleStage !== 'emails' && (() => {
                    const saveable = people.filter(p => !p.id.startsWith('crm-') && !savedToCrm.has(p.id) && (emailMap[p.id]?.email || p.phone || company.phone));
                    const allSaved = saveable.length === 0 && people.some(p => savedToCrm.has(p.id));
                    const noDirectEmailCount = saveable.filter(p => !emailMap[p.id]?.email).length;
                    return (
                      <div className="ml-auto flex items-center gap-2">
                        {noDirectEmailCount > 0 && findPeopleStage === 'done' && (
                          <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-medium flex items-center gap-1" title="Will save with the company phone for calling">
                            <Phone className="w-2.5 h-2.5" /> {noDirectEmailCount} callable
                          </span>
                        )}
                        <button
                          onClick={() => handleSavePeopleToCrm()}
                          disabled={isSavingToCrm || saveable.length === 0}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
                            allSaved
                              ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] cursor-default'
                              : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50'
                          }`}
                        >
                          {isSavingToCrm ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> {t('companySearch.saving')}</>
                          ) : allSaved ? (
                            <><Check className="w-3 h-3" /> {t('companySearch.allSaved')}</>
                          ) : (
                            <><UserPlus className="w-3 h-3" /> {saveable.length > 1 ? t('companySearch.saveAllCount', { count: saveable.length }) : t('companySearch.saveSingleToCRM')}</>
                          )}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {isFindingPeople && people.length === 0 && (
                  <div className="flex items-center gap-2 py-3 px-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#1ED4A7]" />
                    <span className="text-xs text-zinc-500">
                      {findPeopleStage === 'emails' ? t('companySearch.enrichingContactEmails') : t('companySearch.searchingKeyPeople')}
                    </span>
                  </div>
                )}

                {people.length > 0 && (() => {
                  // Sort: email-confirmed first, then others
                  const sortedPeople = [
                    ...people.filter(p => emailMap[p.id]?.email || p.id.startsWith('crm-')),
                    ...people.filter(p => !emailMap[p.id]?.email && !p.id.startsWith('crm-')),
                  ];
                  const filteredPeople = showOnlyInArea && searchLocationContext
                    ? sortedPeople.filter(p => isPersonInArea(p.location, searchLocationContext))
                    : sortedPeople;
                  return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredPeople.map(person => {
                      const personEmail = emailMap[person.id];
                      const isCrmPerson = person.id.startsWith('crm-');
                      const inArea = searchLocationContext ? isPersonInArea(person.location, searchLocationContext) : false;
                      const outOfArea = searchLocationContext && person.location && !inArea;
                      const personPhone = person.phone || company.phone || '';
                      return (
                        <div
                          key={person.id}
                          className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all group ${
                            isCrmPerson
                              ? 'border-[#1ED4A7]/30 bg-[#1ED4A7]/[0.02]'
                              : outOfArea
                                ? 'border-zinc-200/50 dark:border-zinc-700/30 opacity-70 hover:opacity-100 hover:border-zinc-300 dark:hover:border-zinc-600'
                                : 'border-zinc-200/80 dark:border-zinc-700/50 hover:border-[#0077B5]/40 hover:bg-[#0077B5]/[0.03]'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isCrmPerson ? 'bg-[#1ED4A7]/10' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                            <UserCircle className={`w-4.5 h-4.5 ${isCrmPerson ? 'text-[#1ED4A7]' : 'text-zinc-400 dark:text-zinc-500'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {person.linkedin_url ? (
                                <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[var(--text-main)] truncate hover:underline">{person.name}</a>
                              ) : (
                                <span className="text-xs font-semibold text-[var(--text-main)] truncate">{person.name}</span>
                              )}
                              {isCrmPerson && (
                                <span className="flex-shrink-0 text-[8px] font-bold px-1 py-0.5 rounded bg-[#1ED4A7]/15 text-[#1ED4A7]">CRM</span>
                              )}
                              {!isCrmPerson && person.id.startsWith('team-') && (
                                <span className="flex-shrink-0 text-[8px] font-bold px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400">TEAM PAGE</span>
                              )}
                              {!isCrmPerson && person.id.startsWith('officer-') && (
                                <span className="flex-shrink-0 text-[8px] font-bold px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400">REGISTRY</span>
                              )}
                              {!isCrmPerson && person.id.startsWith('hunter-') && (
                                <span className="flex-shrink-0 text-[8px] font-bold px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400">DOMAIN</span>
                              )}
                              {person.linkedin_url && (
                                <a href={person.linkedin_url} target="_blank" rel="noreferrer">
                                  <Linkedin className="w-3 h-3 text-zinc-300 dark:text-zinc-600 hover:text-[#0077B5] flex-shrink-0 transition-colors" />
                                </a>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate leading-relaxed mt-0.5">{person.title}</p>
                            {/* Location display */}
                            {person.location && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <MapPin className={`w-2.5 h-2.5 flex-shrink-0 ${inArea ? 'text-[#1ED4A7]' : 'text-zinc-400 dark:text-zinc-500'}`} />
                                <span className={`text-[9px] truncate ${inArea ? 'text-[#1ED4A7] font-semibold' : 'text-zinc-400 dark:text-zinc-500'}`}>{person.location}</span>
                                {inArea && (
                                  <span className="flex-shrink-0 text-[7px] font-bold px-1 py-0.5 rounded bg-[#1ED4A7]/15 text-[#1ED4A7]">{t('companySearch.inAreaBadge')}</span>
                                )}
                              </div>
                            )}
                            {!person.location && searchLocationContext && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <MapPin className="w-2.5 h-2.5 flex-shrink-0 text-zinc-300 dark:text-zinc-600" />
                                <span className="text-[9px] text-zinc-300 dark:text-zinc-600 italic">{t('companySearch.locationUnknown')}</span>
                              </div>
                            )}
                            {personEmail && (
                              <button
                                onClick={() => { navigator.clipboard.writeText(personEmail.email); toast.success(t('leadFinder.toastEmailCopied')); }}
                                className="flex items-center gap-1 mt-1 group/email"
                              >
                                <Mail className="w-2.5 h-2.5 text-[#1ED4A7] flex-shrink-0" />
                                <span className="text-[10px] font-medium text-[#1ED4A7] truncate group-hover/email:underline">{personEmail.email}</span>
                                <Copy className="w-2 h-2 text-zinc-400 opacity-0 group-hover/email:opacity-100 flex-shrink-0 transition-opacity" />
                                {personEmail.confidence === 'high' && (
                                  <ShieldCheck className="w-2.5 h-2.5 text-[#1ED4A7] flex-shrink-0" title="High confidence" />
                                )}
                                {personEmail.source === 'crm' && (
                                  <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#1ED4A7]/15 text-[#1ED4A7] flex-shrink-0">CRM</span>
                                )}
                                {personEmail.source === 'manual' && (
                                  <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 flex-shrink-0">{t('companySearch.manualBadge')}</span>
                                )}
                              </button>
                            )}
                            {personPhone && (
                              <div className="flex items-center gap-1 mt-1">
                                <SmartPhoneButton
                                  phone={personPhone}
                                  leadName={person.name}
                                  businessName={company.name}
                                  leadId={person.id}
                                  showNumber
                                  displayNumber={formatPhoneNumber(personPhone)}
                                  iconClassName="w-2.5 h-2.5"
                                  numberClassName="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 truncate"
                                />
                                {!personEmail && (
                                  <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 flex-shrink-0">CALL</span>
                                )}
                              </div>
                            )}
                            {findPeopleStage === 'done' && !personEmail && !isCrmPerson && (
                              <div className="mt-1 space-y-1">
                                {manualEmailEditId === person.id ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="email"
                                      value={manualEmailValue}
                                      onChange={e => setManualEmailValue(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') handleManualEmailSubmit(person.id); if (e.key === 'Escape') { setManualEmailEditId(null); setManualEmailValue(''); } }}
                                      placeholder="email@company.com"
                                      className="w-full min-w-0 px-1.5 py-0.5 text-[10px] bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded focus:ring-1 focus:ring-[#1ED4A7]/50 focus:border-[#1ED4A7]/50 outline-none transition-all placeholder:text-zinc-400"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleManualEmailSubmit(person.id)}
                                      className="flex-shrink-0 p-0.5 rounded text-[#1ED4A7] hover:bg-[#1ED4A7]/10 transition-colors"
                                      title="Save email"
                                    >
                                      <Check className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => { setManualEmailEditId(null); setManualEmailValue(''); }}
                                      className="flex-shrink-0 p-0.5 rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                      title="Cancel"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] text-zinc-400/80 dark:text-zinc-500/60 italic">{t('companySearch.noEmailFound')}</span>
                                    <button
                                      onClick={() => { setManualEmailEditId(person.id); setManualEmailValue(''); }}
                                      className="flex items-center gap-0.5 text-[9px] font-medium text-zinc-500 hover:text-[#1ED4A7] transition-colors"
                                      title="Enter email manually"
                                    >
                                      <PenLine className="w-2.5 h-2.5" /> {t('companySearch.addLabel')}
                                    </button>
                                    <button
                                      onClick={() => handleReEnrichPerson(person)}
                                      disabled={reEnrichingId === person.id}
                                      className="flex items-center gap-0.5 text-[9px] font-medium text-zinc-500 hover:text-[#1ED4A7] transition-colors disabled:opacity-50"
                                      title="Retry email discovery"
                                    >
                                      <RefreshCw className={`w-2.5 h-2.5 ${reEnrichingId === person.id ? 'animate-spin' : ''}`} /> {t('companySearch.retryLabel')}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Individual Save to CRM button — requires email for outreach */}
                          {!isCrmPerson && (() => {
                            const hasEmail = !!emailMap[person.id]?.email;
                            const hasPhone = !!(person.phone || company.phone);
                            const isSaved = savedToCrm.has(person.id);
                            const isDisabled = isSavingToCrm || isSaved || (!hasEmail && !hasPhone);
                            return (
                              <button
                                onClick={(e) => { e.stopPropagation(); if (hasEmail || hasPhone) handleSavePeopleToCrm([person]); }}
                                disabled={isDisabled}
                                className={`flex-shrink-0 p-1.5 rounded-md transition-all ${
                                  isSaved
                                    ? 'text-[#1ED4A7] bg-[#1ED4A7]/10 cursor-default'
                                    : (!hasEmail && !hasPhone)
                                      ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'
                                      : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40'
                                }`}
                                title={isSaved ? t('companySearch.savedToCRMTitle') : (!hasEmail && !hasPhone) ? 'Email or phone required' : t('companySearch.saveSingleToCRM')}
                              >
                                {isSaved ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                              </button>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  );
                })()}

                {hasFetchedPeople && people.length === 0 && !isFindingPeople && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-600 italic py-2">
                    {t('companySearch.noProfilesFound')}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile */}
      <div className="md:hidden px-3 py-3">
        <div className="flex items-start gap-2.5">
          <div onClick={onToggleSelect} className="pt-0.5">
            <div className={`w-5 h-5 rounded-md border-2 cursor-pointer flex items-center justify-center transition-all ${selected ? 'bg-[#1ED4A7] border-[#1ED4A7] text-black' : 'border-zinc-300 dark:border-zinc-700'}`}>
              {selected && <Check className="w-3 h-3" />}
            </div>
          </div>
          <CompanyLogo
            domain={company.website_url}
            brandLogoUrl={bestBrandLogoUrl}
            brandLogoSource={bestBrandLogoSource}
            linkedinUrl={company.linkedin_url}
            companyName={company.name}
            size={36}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0" onClick={onToggleExpand}>
            <div className="flex items-start gap-1.5 mb-1 flex-wrap">
              <h3 className="text-[14px] font-semibold text-[var(--text-main)] leading-tight break-words">{company.name}</h3>
              {isHotCompany && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20 flex-shrink-0 mt-0.5" title="Hot Company (Score > 80)">
                  <Flame className="w-2.5 h-2.5" />Hot
                </span>
              )}
              <ChevronRight className={`w-3 h-3 text-zinc-400 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
              <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                {leadScore != null && <LeadScoreBadge score={leadScore} size="sm" showLabel={false} />}
                {crmContacts && crmContacts.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-[#1ED4A7]/15 text-[#1ED4A7] border border-[#1ED4A7]/20">
                    <Users className="w-2.5 h-2.5" />{crmContacts.length} in CRM
                  </span>
                )}
                {poolCoverage && poolCoverage.coverage_score > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">
                    <Database className="w-2.5 h-2.5" />{poolCoverage.coverage_score}%
                  </span>
                )}
              </div>
            </div>

            {displayIndustry && (
              <div className="flex items-center gap-1 mb-1">
                <Factory className="w-2.5 h-2.5 text-zinc-400 flex-shrink-0" />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{toTitleCase(displayIndustry)}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
              <div className="flex items-center gap-1">
                <Users className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {displayEmployees > 0 ? formatEmployeeCount(displayEmployees) : '—'}
                </span>
              </div>
              {displayRevenue ? (
                <div className="flex items-center gap-1">
                  <DollarSign className="w-2.5 h-2.5 text-[#1ED4A7] flex-shrink-0" />
                  <span className="text-[10px] font-medium text-[#1ED4A7]">{displayRevenue}</span>
                </div>
              ) : company.rating ? (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{company.rating}★</span>
                  {company.reviews_count ? (
                    <span className="text-[10px] text-zinc-400">({company.reviews_count})</span>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <DollarSign className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                  <span className="text-[10px] text-zinc-400">—</span>
                </div>
              )}
              {loc && (
                <div className="flex items-center gap-1 col-span-2">
                  <MapPin className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{loc}</span>
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2 pt-1.5 border-t border-zinc-100 dark:border-zinc-800 flex-wrap">
              {company.phone && (
                <SmartPhoneButton
                  phone={company.phone}
                  businessName={company.name}
                  showNumber
                  displayNumber={formatPhoneNumber(company.phone)}
                  iconClassName="w-3 h-3"
                  numberClassName="text-[11px] text-zinc-500"
                />
              )}
              {company.linkedin_url && (
                <a href={company.linkedin_url} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-[#0077B5]">
                  <Linkedin className="w-3.5 h-3.5" />
                </a>
              )}
              {company.website_url && (
                <a href={company.website_url.startsWith('http') ? company.website_url : `https://${company.website_url}`} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-[var(--text-main)]">
                  <Globe className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={handleFindPeople}
                disabled={isFindingPeople || hasFetchedPeople}
                className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-50"
              >
                {isFindingPeople ? (
                  findPeopleStage === 'emails' ? (
                    <><Loader2 className="w-2.5 h-2.5 animate-spin" /> {t('companySearch.emailsMobile')}</>
                  ) : (
                    <><Loader2 className="w-2.5 h-2.5 animate-spin" /> {t('companySearch.searchingMobile')}</>
                  
                  )
                ) : hasFetchedPeople ? (
                  <><Check className="w-2.5 h-2.5" /> {t('companySearch.peopleSummary', { count: people.length })}{Object.keys(emailMap).length > 0 ? ` · ${t('companySearch.emailsSummaryMobile', { count: Object.keys(emailMap).length })}` : ''}</>
                ) : (
                  <><Sparkles className="w-2.5 h-2.5" /> {t('companySearch.findPeople')}</>
                )}
              </button>
            </div>

            {/* Mobile inline people results */}
            {(isFindingPeople || people.length > 0) && (
              <div className="pt-2 mt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Users className="w-3 h-3 text-[#1ED4A7]" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('companySearch.decisionMakers')}</span>
                  {people.length > 0 && <span className="text-[9px] bg-[#1ED4A7]/10 text-[#1ED4A7] px-1 py-0.5 rounded font-bold">{people.length}</span>}
                  {Object.keys(emailMap).length > 0 && (
                    <span className="ml-auto text-[9px] text-[#1ED4A7] font-semibold">{t('companySearch.emailsMobileSuffix', { count: Object.keys(emailMap).length })}</span>
                  )}
                  {findPeopleStage === 'emails' && (
                    <span className="ml-auto flex items-center gap-1 text-[9px] text-zinc-400">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> {t('companySearch.emailsMobile')}
                    </span>
                  )}
                </div>
                {/* Mobile location filter */}
                {searchLocationContext && people.length > 0 && (() => {
                  const inAreaCount = people.filter(p => isPersonInArea(p.location, searchLocationContext)).length;
                  if (inAreaCount === 0) return null;
                  return (
                    <button
                      onClick={() => setShowOnlyInArea(!showOnlyInArea)}
                      className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded mb-1.5 transition-all ${
                        showOnlyInArea ? 'bg-[#1ED4A7]/15 text-[#1ED4A7]' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      <MapPin className="w-2 h-2" />
                      {showOnlyInArea ? t('companySearch.showingInArea', { count: inAreaCount }) : t('companySearch.countInArea', { count: inAreaCount })}
                    </button>
                  );
                })()}
                {isFindingPeople && people.length === 0 && (
                  <div className="flex items-center gap-1.5 py-2">
                    <Loader2 className="w-3 h-3 animate-spin text-[#1ED4A7]" />
                    <span className="text-[10px] text-zinc-400">
                      {findPeopleStage === 'emails' ? t('companySearch.findingEmailsMobile') : t('companySearch.searchingProfilesMobile')}
                    </span>
                  </div>
                )}
                {(showOnlyInArea && searchLocationContext
                  ? people.filter(p => isPersonInArea(p.location, searchLocationContext))
                  : [
                      ...people.filter(p => emailMap[p.id]?.email || p.id.startsWith('crm-')),
                      ...people.filter(p => !emailMap[p.id]?.email && !p.id.startsWith('crm-')),
                    ]
                ).map(person => {
                  const personEmail = emailMap[person.id];
                  const inArea = searchLocationContext ? isPersonInArea(person.location, searchLocationContext) : false;
                  const personPhone = person.phone || company.phone || '';
                  return (
                    <div
                      key={person.id}
                      className={`flex items-center gap-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 rounded px-1 transition-colors ${person.location && searchLocationContext && !inArea ? 'opacity-60' : ''}`}
                    >
                      <UserCircle className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-[var(--text-main)] block truncate hover:underline">{person.name}</a>
                        <span className="text-[9px] text-zinc-400 block truncate">{person.title}</span>
                        {person.location && (
                          <span className={`flex items-center gap-0.5 text-[8px] ${inArea ? 'text-[#1ED4A7] font-semibold' : 'text-zinc-400'}`}>
                            <MapPin className="w-2 h-2" /> {person.location}
                            {inArea && <span className="ml-0.5 px-1 py-0 rounded bg-[#1ED4A7]/15 text-[7px] font-bold">{t('companySearch.inAreaBadge')}</span>}
                          </span>
                        )}
                        {personEmail && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(personEmail.email); toast.success(t('leadFinder.toastEmailCopied')); }}
                            className="flex items-center gap-1 mt-0.5"
                          >
                            <Mail className="w-2.5 h-2.5 text-[#1ED4A7]" />
                            <span className="text-[9px] font-medium text-[#1ED4A7] truncate">{personEmail.email}</span>
                          </button>
                        )}
                        {personPhone && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <SmartPhoneButton
                              phone={personPhone}
                              leadName={person.name}
                              businessName={company.name}
                              leadId={person.id}
                              showNumber
                              displayNumber={formatPhoneNumber(personPhone)}
                              iconClassName="w-2.5 h-2.5"
                              numberClassName="text-[9px] font-medium text-zinc-500 dark:text-zinc-400 truncate"
                            />
                          </div>
                        )}
                      </div>
                      <Linkedin className="w-3 h-3 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

function CompanyEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-5 shadow-sm border border-[var(--border-color)]">
          <Building2 className="w-7 h-7 text-[var(--text-main)]" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-main)] mb-1">{t('companySearch.emptyStateTitle')}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          {t('companySearch.emptyStateDesc')}
        </p>
        <div className="flex flex-col gap-3 text-left w-fit mx-auto">
          {[
            { icon: Search, label: t('companySearch.emptyStatePoint1') },
            { icon: Building2, label: t('companySearch.emptyStatePoint2') },
            { icon: Phone, label: t('companySearch.emptyStatePoint3') },
            { icon: Users, label: t('companySearch.emptyStatePoint4') },
            { icon: Globe, label: t('companySearch.emptyStatePoint5') },
            { icon: Download, label: t('companySearch.emptyStatePoint6') },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2.5 text-xs text-zinc-500">
              <div className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <Icon className="w-3 h-3 text-zinc-500" />
              </div>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CompanySearch;
