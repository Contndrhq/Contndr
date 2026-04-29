/**
 * BuildingSearch — Find decision makers by building address or name.
 *
 * Simplified single-step flow:
 * 1. User types a building name/address → we find ALL companies at that location
 * 2. We automatically find decision makers at ALL those companies in one stream
 * 3. Results render exactly like ApolloProSearch — same cards, badges, save flow.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Building2, Search, Loader2, MapPin, Users, Sparkles,
  ChevronRight, X, Clock, RefreshCcw, Radar, CheckCircle,
  AlertTriangle, Phone, Mail, Linkedin, Copy, Download, Check,
  ShieldCheck, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { CompanyLogo } from './CompanyLogo';
import { LeadScoreBadge } from './LeadScoreBadge';
import { SmartPhoneButton } from './SmartPhoneButton';
import { useTranslation } from 'react-i18next';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ── Types ──

// Shape returned by /company-search/find-people (PersonResult on server)
interface DecisionMaker {
  id: string;
  name: string;
  title: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  phone_numbers?: { raw_number: string; type: string }[];
  // find-people fields
  snippet?: string;
  company_match?: string;
  location?: string;
  // deep-prospect org fields (optional, may not be present from find-people)
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  organization?: {
    name: string;
    website_url?: string;
    industry?: string;
    estimated_num_employees?: number;
  };
  _lead_score?: number;
  _company?: string;
}

interface BuildingSearchProps {
  onSaveProspects?: (prospects: any[]) => void;
  onUpgrade?: () => void;
}

// ── Keyframes ──
const keyframes = `
@keyframes bsEntryIn {
  0%   { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes bsPulseRing {
  0%   { box-shadow: 0 0 0 0 rgba(30,212,167,0.35); }
  70%  { box-shadow: 0 0 0 8px rgba(30,212,167,0); }
  100% { box-shadow: 0 0 0 0 rgba(30,212,167,0); }
}
@keyframes bsScanLine {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

// ── Lead score helper ──
function computeScore(lead: DecisionMaker): number {
  let s = 0;
  if (lead.name) s += 10;
  if (lead.email) s += 20;
  if (lead.linkedin_url) s += 10;
  if (lead.phone_numbers?.length) s += 10;
  const title = lead.title || '';
  if (title) s += 10;
  // Infer seniority from title if seniority field absent
  const sen = lead.seniority?.toLowerCase() || '';
  const t = title.toLowerCase();
  const isSenior = /\b(owner|founder|co-?founder|ceo|cto|cfo|coo|cmo|cro|cpo|chief)\b/.test(t);
  const isVP = /\b(vp|vice president|svp|evp|partner|head of|general manager)\b/.test(t);
  const isDir = /\b(director|managing director)\b/.test(t);
  if (['owner', 'founder', 'c_suite'].includes(sen) || isSenior) s += 30;
  else if (['partner', 'vp', 'head'].includes(sen) || isVP) s += 22;
  else if (['director', 'manager'].includes(sen) || isDir) s += 14;
  else s += 6;
  if (lead.email_status === 'verified') s += 10;
  else if (lead.email_status === 'pattern_guessed') s += 5;
  else if (lead.email) s += 8;
  return Math.min(s, 100);
}

function formatPhone(raw: string): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `+1 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return raw;
}

// ── Main component ──

export function BuildingSearch({ onSaveProspects, onUpgrade }: BuildingSearchProps) {
  const { t } = useTranslation();

  // Search state
  const [buildingQuery, setBuildingQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('building_searches') || '[]'); } catch { return []; }
  });

  // Results
  const [people, setPeople] = useState<DecisionMaker[]>([]);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Streaming state
  const [activityLog, setActivityLog] = useState<{ id: number; message: string; type: 'info'|'success'|'warn' }[]>([]);
  const activityIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [streamPct, setStreamPct] = useState(0);
  const [companiesFound, setCompaniesFound] = useState(0);

  const addActivity = useCallback((message: string, type: 'info'|'success'|'warn' = 'info') => {
    setActivityLog(prev => {
      const next = [...prev, { id: ++activityIdRef.current, message, type }];
      return next.length > 60 ? next.slice(-60) : next;
    });
  }, []);

  // Auto-scroll activity feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [activityLog.length]);

  // ── Single-step search: Find companies → find-people per company ──
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) { toast.error('Please enter a building name or address.'); return; }

    setIsSearching(true);
    setHasSearched(true);
    setPeople([]);
    setSelectedPeopleIds(new Set());
    setActivityLog([]);
    setStreamPct(0);
    setCompaniesFound(0);

    // Save to recent
    const updated = [query, ...recentSearches.filter(s => s !== query)].slice(0, 5);
    setRecentSearches(updated);
    try { localStorage.setItem('building_searches', JSON.stringify(updated)); } catch {}

    addActivity(`Scanning building: "${query}"`, 'info');
    addActivity('Querying Google Maps for tenants...', 'info');

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const headers = await getAuthHeaders();

      // Step 1: Find companies at the building
      setStreamPct(10);
      const companyRes = await fetch(`${API}/company-search/search-by-building`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ building_name: query }),
        signal: controller.signal,
      });

      if (!companyRes.ok) {
        const err = await companyRes.json().catch(() => ({}));
        throw new Error(err.error || `Company search failed (${companyRes.status})`);
      }

      const companyData = await companyRes.json();
      const orgs: { name: string; website: string }[] = (companyData.companies || [])
        .filter((o: any) => o.name && o.website);

      setStreamPct(25);

      if (orgs.length === 0) {
        addActivity('No companies found at this location. Try a different address.', 'warn');
        toast.error('No companies found at this building.');
        setIsSearching(false);
        return;
      }

      // Cap to top 10 companies to keep total time reasonable
      const topOrgs = orgs.slice(0, 10);
      addActivity(`Found ${orgs.length} companies — searching decision makers at top ${topOrgs.length}`, 'success');
      setCompaniesFound(orgs.length);

      // Step 2: Call find-people for each company — this endpoint validates
      // that each person actually works AT that specific company (isCurrentEmployer check),
      // unlike deep-prospect which ignores domain constraints.
      const allPeopleMap = new Map<string, DecisionMaker & { _company?: string }>();
      const allEmailMap: Record<string, { email: string; source: string; confidence: string }> = {};

      let completed = 0;
      const CONCURRENCY = 3;

      // Process in batches of CONCURRENCY
      for (let i = 0; i < topOrgs.length; i += CONCURRENCY) {
        if (controller.signal.aborted) break;

        const batch = topOrgs.slice(i, i + CONCURRENCY);
        const batchPct = Math.round(25 + ((i / topOrgs.length) * 65));
        setStreamPct(batchPct);

        const batchResults = await Promise.allSettled(
          batch.map(async (org) => {
            if (controller.signal.aborted) return;

            const domain = (() => {
              try {
                const url = org.website.startsWith('http') ? org.website : `https://${org.website}`;
                return new URL(url).hostname.replace(/^www\./, '');
              } catch { return ''; }
            })();

            addActivity(`Searching decision makers at ${org.name}...`, 'info');

            const res = await fetch(`${API}/company-search/find-people`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                company_name: org.name,
                domain: domain || undefined,
              }),
              signal: AbortSignal.timeout(30000),
            });

            if (!res.ok) {
              console.warn(`[BUILDING SEARCH] find-people failed for ${org.name}: ${res.status}`);
              return;
            }

            const data = await res.json();
            const found: any[] = data.people || [];
            const emails: Record<string, any> = data.crm_emails || {};

            if (found.length > 0) {
              addActivity(`Found ${found.length} contact${found.length !== 1 ? 's' : ''} at ${org.name}`, 'success');
            }

            return { people: found, emails, companyName: org.name };
          })
        );

        // Merge batch results into allPeopleMap
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            const { people: found, emails, companyName } = result.value;
            for (const p of found) {
              // Use LinkedIn URL as dedup key (most reliable), fall back to name
              const key = p.linkedin_url || `${p.name}-${companyName}`;
              if (!allPeopleMap.has(key)) {
                const scored = { ...p, _lead_score: computeScore(p), _company: companyName };
                allPeopleMap.set(key, scored);
              }
            }
            Object.assign(allEmailMap, emails);
          }
          completed++;
        }

        // Stream partial results to UI as each batch finishes
        const partialPeople = Array.from(allPeopleMap.values());
        if (partialPeople.length > 0) setPeople([...partialPeople]);
      }

      // Final sort: email-confirmed first, then by score
      const finalPeople = Array.from(allPeopleMap.values()).sort((a, b) => {
        const aEmail = allEmailMap[a.id]?.email || a.email ? 1 : 0;
        const bEmail = allEmailMap[b.id]?.email || b.email ? 1 : 0;
        if (bEmail !== aEmail) return bEmail - aEmail;
        return (b._lead_score ?? 0) - (a._lead_score ?? 0);
      });

      setStreamPct(100);
      setPeople(finalPeople);
      setSelectedPeopleIds(new Set(finalPeople.map(p => p.id)));

      if (finalPeople.length === 0) {
        addActivity('No decision makers found at this building. Try a different address.', 'warn');
        toast.info('No decision makers found for this building.');
      } else {
        const withEmail = finalPeople.filter(p => allEmailMap[p.id]?.email || p.email).length;
        addActivity(
          `Done — ${finalPeople.length} decision maker${finalPeople.length !== 1 ? 's' : ''}${withEmail > 0 ? `, ${withEmail} with email` : ''}`,
          'success'
        );
        toast.success(`Found ${finalPeople.length} decision maker${finalPeople.length !== 1 ? 's' : ''} across ${topOrgs.length} companies`);
      }

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[BUILDING SEARCH] Search error:', err);
      toast.error(err.message || 'Search failed.');
    } finally {
      setIsSearching(false);
    }
  }, [recentSearches, addActivity]);

  // ── Save to CRM ──
  const handleSave = useCallback(async () => {
    const toSave = people.filter(p => selectedPeopleIds.has(p.id) && p.email);
    if (toSave.length === 0) { toast.error('Select leads with email addresses to save.'); return; }

    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/apollo/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ people: toSave }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      const data = await res.json();
      toast.success(`Saved ${data.saved || toSave.length} lead${toSave.length !== 1 ? 's' : ''} to CRM`);
      if (onSaveProspects) onSaveProspects(toSave);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save leads');
    } finally {
      setSaving(false);
    }
  }, [people, selectedPeopleIds, onSaveProspects]);

  // ── Copy email ──
  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email).then(() => toast.success('Copied!'));
  };

  // ── Clear results ──
  const handleClear = () => {
    setPeople([]);
    setHasSearched(false);
    setActivityLog([]);
    setBuildingQuery('');
    setSelectedPeopleIds(new Set());
  };

  // ── Render ──

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <style>{keyframes}</style>

      {/* Search Form */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-5">
        <form onSubmit={e => { e.preventDefault(); handleSearch(buildingQuery); }} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Building name or address
            </label>
            {/* Inline input + button row on desktop */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                <input
                  type="text"
                  value={buildingQuery}
                  onChange={e => setBuildingQuery(e.target.value)}
                  placeholder="e.g. Brickell City Centre, 601 Brickell Key Dr..."
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--border-color)] rounded-lg focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all placeholder:text-zinc-400"
                  disabled={isSearching}
                />
              </div>
              <button
                type="submit"
                disabled={!buildingQuery.trim() || isSearching}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap flex-shrink-0"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="hidden sm:inline">{streamPct > 0 ? `${streamPct}%` : 'Searching...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span className="hidden sm:inline">Find Decision Makers</span>
                    <span className="sm:hidden">Search</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Recent searches */}
        {!hasSearched && recentSearches.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">Recent</p>
            <div className="space-y-1">
              {recentSearches.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setBuildingQuery(s); handleSearch(s); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors text-left group"
                >
                  <MapPin className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                  <span className="text-[13px] text-zinc-600 dark:text-zinc-300 flex-1 truncate">{s}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Activity feed (when searching) */}
      {isSearching && activityLog.length > 0 && (
        <div className="flex-shrink-0 px-4 sm:px-6 pb-3 border-t border-[var(--border-color)]">
          <div className="mt-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/40 max-h-32 overflow-y-auto" ref={feedRef}>
            {activityLog.slice(-3).map((entry, i, arr) => {
              const isLatest = i === arr.length - 1;
              return (
                <div key={entry.id} className="flex items-start gap-2 mb-2 last:mb-0">
                  <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    entry.type === 'success' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                    entry.type === 'warn' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400' :
                    'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                  }`}>
                    {entry.type === 'success' ? <CheckCircle className="w-2.5 h-2.5" /> :
                     entry.type === 'warn' ? <AlertTriangle className="w-2.5 h-2.5" /> :
                     <Radar className="w-2.5 h-2.5" />}
                  </div>
                  <p className={`text-[11px] leading-relaxed ${
                    isLatest ? 'text-zinc-800 dark:text-zinc-200 font-medium' : 'text-zinc-500'
                  }`}>
                    {entry.message}
                  </p>
                </div>
              );
            })}
          </div>
          {companiesFound > 0 && (
            <div className="mt-2 text-center">
              <span className="text-[10px] text-zinc-400 tabular-nums">
                {companiesFound} {companiesFound === 1 ? 'company' : 'companies'} found · {streamPct}% complete
              </span>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {hasSearched && !isSearching && (
        <div className="flex-1 flex flex-col overflow-hidden border-t border-[var(--border-color)]">
          {/* Results header */}
          <div className="flex-shrink-0 px-4 sm:px-6 pt-3 pb-2">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-main)]">
                  {people.length} decision maker{people.length !== 1 ? 's' : ''} found
                </h3>
                <p className="text-[11px] text-zinc-400 truncate max-w-[240px]">{buildingQuery}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClear}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title="Clear results"
                >
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
            </div>

            {people.length > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {[
                    { label: 'Emails', value: people.filter(p => p.email).length },
                    { label: 'Verified', value: people.filter(p => p.email_status === 'verified').length },
                    { label: 'Phones', value: people.filter(p => p.phone_numbers?.length).length },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="text-[13px] font-semibold text-[var(--text-main)]">{value}</div>
                      <div className="text-[10px] text-zinc-400">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedPeopleIds(
                      selectedPeopleIds.size === people.length ? new Set() : new Set(people.map(p => p.id))
                    )}
                    className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {selectedPeopleIds.size === people.length ? 'Deselect' : 'All'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={selectedPeopleIds.size === 0 || saving}
                    className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[12px] font-semibold rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-100 disabled:opacity-40 transition-colors"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Save {selectedPeopleIds.size > 0 ? `(${selectedPeopleIds.size})` : ''}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* People list */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4">
            {people.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users className="w-10 h-10 text-zinc-200 dark:text-zinc-700 mb-3" />
                <p className="text-sm font-medium text-zinc-400">No decision makers found</p>
                <p className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-1 max-w-[240px]">
                  Try searching a different building or address.
                </p>
              </div>
            ) : (
              <div className="space-y-2 mt-2">
                {people.map(person => {
                  const selected = selectedPeopleIds.has(person.id);
                  const phone = person.phone_numbers?.[0]?.raw_number;
                  return (
                    <div
                      key={person.id}
                      className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border transition-all ${
                        selected
                          ? 'border-[var(--border-color)] bg-white dark:bg-zinc-900/30'
                          : 'border-transparent bg-transparent opacity-50'
                      }`}
                      style={{ animation: 'bsEntryIn 0.3s ease both' }}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => {
                          const next = new Set(selectedPeopleIds);
                          if (next.has(person.id)) next.delete(person.id);
                          else next.add(person.id);
                          setSelectedPeopleIds(next);
                        }}
                        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          selected ? 'border-[#1ED4A7] bg-[#1ED4A7]' : 'border-zinc-300 dark:border-zinc-600'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </button>

                      {/* Avatar initials */}
                      <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 text-[12px] font-semibold text-zinc-500 dark:text-zinc-400">
                        {(person.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-[var(--text-main)] truncate">{person.name}</span>
                          {person._lead_score !== undefined && (
                            <LeadScoreBadge score={person._lead_score} size="sm" />
                          )}
                        </div>
                        {person.title && (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{person.title}</p>
                        )}
                        {(person._company || person.company_match || person.organization?.name) && (
                          <p className="text-[11px] text-zinc-400 truncate">
                            {person._company || person.company_match || person.organization?.name}
                          </p>
                        )}

                        {/* Contact row */}
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {person.email && (
                            <button
                              onClick={() => copyEmail(person.email!)}
                              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                            >
                              {person.email_status === 'verified' ? (
                                <ShieldCheck className="w-3 h-3 text-[#1ED4A7]" />
                              ) : (
                                <Mail className="w-3 h-3" />
                              )}
                              <span className="truncate max-w-[160px]">{person.email}</span>
                              <Copy className="w-2.5 h-2.5 opacity-50" />
                            </button>
                          )}
                          {phone && (
                            <SmartPhoneButton
                              phone={formatPhone(phone)}
                              leadId={person.id}
                              leadName={person.name}
                              size="sm"
                            />
                          )}
                          {person.linkedin_url && (
                            <a
                              href={person.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                              onClick={e => e.stopPropagation()}
                            >
                              <Linkedin className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BuildingSearch;