import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Search, MapPin, Building2, CheckCircle, ShieldCheck, Loader2, Globe, Filter,
  Database, Copy, Zap, Phone, ChevronDown, Download,
  Linkedin, Users, Check, ArrowUpDown, X,
  AlertTriangle, UserCheck, Briefcase, Mail, Pause, Play,
  Hash, SlidersHorizontal, BarChart3, Target,
  Bookmark, LayoutList, Clock, Trash2, Sparkles, RefreshCcw, Radar, Factory
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { toTitleCase } from '../utils/title-case';
import { LeadAvatar } from './LeadAvatar';
import { CompanyLogo } from './CompanyLogo';
import { prefetchAvatars } from '../lib/gravatar';
import { LeadScoreBadge } from './LeadScoreBadge';
import { realtimeManager } from '../lib/realtime';
import { saveFinderCache, loadFinderCache, clearFinderCache, CACHE_KEYS } from '../lib/finder-cache';
import { supabase } from '../lib/supabase';
import { LocationPicker, buildLocationStrings, type LocationPickerValue } from './LocationPicker';
import { useDemoMode, DEMO_APOLLO_RESULTS } from './DemoContext';
import { SmartPhoneButton } from './SmartPhoneButton';
import { useTranslation } from 'react-i18next';
import { translatePhaseName, translateActivityMessage } from '../lib/translate-server-text';
import { useIsMobile } from './ui/use-mobile';
import { MobileFilterSheet } from './ui/mobile-filter-sheet';
import { useScrollHeader } from '../hooks/useScrollHeader';
// Rebuild trigger: 2026-02-24 - Generic email blocking + unified lead finder

// Company logo rendering now handled by shared CompanyLogo component

// ── Generic / role-based email filter — blocks info@, sales@, etc. ──
// Only decision-maker personal emails should reach the CRM.
const GENERIC_EMAIL_PREFIXES = new Set([
  'info', 'contact', 'hello', 'sales', 'support', 'admin', 'office',
  'inquiries', 'inquiry', 'careers', 'jobs', 'hr', 'team', 'help',
  'marketing', 'media', 'press', 'billing', 'accounts', 'reception',
  'frontdesk', 'mail', 'webmaster', 'staff', 'general', 'service',
  'services', 'noreply', 'no-reply', 'do-not-reply', 'donotreply',
  'feedback', 'subscribe', 'unsubscribe', 'newsletter', 'news',
  'postmaster', 'hostmaster', 'abuse', 'security', 'privacy',
  'compliance', 'legal', 'procurement', 'purchasing', 'vendor',
  'vendors', 'suppliers', 'partners', 'partnership', 'affiliates',
  'advertising', 'ads', 'bookings', 'booking', 'reservations',
  'events', 'orders', 'order', 'returns', 'shipping', 'delivery',
  'customerservice', 'customercare', 'customer-service', 'customer-care',
  'helpdesk', 'help-desk', 'techsupport', 'tech-support', 'it',
  'itsupport', 'it-support', 'webteam', 'web-team', 'digital',
  'socialmedia', 'social-media', 'pr', 'comms', 'communications',
  'editorial', 'editor', 'editors', 'submissions', 'apply',
  'applications', 'recruit', 'recruiting', 'recruitment', 'talent',
  'operations', 'ops', 'finance', 'accounting', 'payroll', 'ap',
  'ar', 'invoices', 'invoice', 'payments', 'pay', 'donate',
  'donations', 'membership', 'members', 'community', 'volunteer',
]);

function isGenericEmail(email: string): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  const atIdx = lower.indexOf('@');
  if (atIdx <= 0) return false;
  const prefix = lower.substring(0, atIdx);
  if (GENERIC_EMAIL_PREFIXES.has(prefix)) return true;
  // Numbered variants: info1@, sales2@, support01@
  const stripped = prefix.replace(/\d+$/, '');
  if (stripped !== prefix && GENERIC_EMAIL_PREFIXES.has(stripped)) return true;
  return false;
}

function hasUsableEmail(lead: Pick<ApolloLead, 'email' | 'email_verification'>): boolean {
  const email = lead.email?.trim();
  if (!email || isGenericEmail(email)) return false;
  if (lead.email_verification?.is_role_based) return false;
  return true;
}

function hasCallablePhone(lead: Pick<ApolloLead, 'phone_numbers' | '_has_phone'>): boolean {
  return Boolean(
    lead._has_phone ||
    lead.phone_numbers?.some(phone => phone.raw_number?.replace(/\D/g, '').length >= 7)
  );
}

// LinkedIn URL is the third actionable contact path. Without this, the
// "no email + no phone" filter at the quality gate silently drops every
// LinkedIn-only lead that the backend's tier 4 surfaces — even when the
// user can clearly act on the LinkedIn profile or run "Find email" later.
function hasLinkedinProfile(lead: { linkedin_url?: string | null; person_linkedin_url?: string | null }): boolean {
  const li = (lead.linkedin_url || (lead as any).person_linkedin_url || "").toLowerCase();
  return li.includes("linkedin.com/");
}

// ── Strip emoji and unicode decorators ──
function stripDisplayEmoji(str: string): string {
  if (!str) return '';
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27FF}]/gu, '')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/[★☆●○►▶◀◄■□▪▫♦♣♠♥✓✔✗✘✦✧⚡⭐🔥💡🎯🚀💪🏆🌟💼📧📞🔗✅❌🤝💰📈📊🎉👋🙌🛠️✨💎🔑📍]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Display-level name cleaner: normalizes messy names from scraping ──
function cleanDisplayName(raw: string): string {
  if (!raw) return '';
  let n = stripDisplayEmoji(raw).trim();
  // Strip credential suffixes
  n = n.replace(/\s+(?:MBA|PhD|MD|CPA|PMP|SHRM|CSM|CFA|PE|RN|CISSP|CISM|CCNA|TOGAF|ITIL|SPHR|PHR|CFP|ACCA)\b.*$/i, '').trim();
  // Strip parentheticals: "(He/Him)", "(LION)", "(Open to Work)"
  n = n.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  // Strip hashtags: "#OpenToWork"
  n = n.replace(/\s*#\S+/g, '').trim();
  // Strip trailing commas
  n = n.replace(/[,;:]+$/, '').trim();
  // Collapse whitespace
  n = n.replace(/\s{2,}/g, ' ');
  // ── Strict Title Case normalization ──
  // Detect ALL CAPS or all lowercase names and normalize to Title Case
  // e.g. "MAURICIO FERREIRA" → "Mauricio Ferreira", "jorge suarez" → "Jorge Suarez"
  if (n.length > 1) {
    const isAllUpper = n === n.toUpperCase() && /[A-Z]/.test(n);
    const isAllLower = n === n.toLowerCase() && /[a-z]/.test(n);
    if (isAllUpper || isAllLower) {
      n = n.toLowerCase().replace(/(?:^|\s|-)(\S)/g, (m, c) => m.slice(0, -1) + c.toUpperCase());
    }
    // Handle remaining ALL-CAPS words (3+ chars) within mixed-case names
    n = n.replace(/\b([A-Z]{3,})\b/g, (word) => word.charAt(0) + word.slice(1).toLowerCase());
  }
  return n;
}

// ── Display-level title cleaner: normalizes messy titles for uniform display ──
function cleanDisplayTitle(raw: string): string {
  if (!raw) return '';
  let t = stripDisplayEmoji(raw).trim();
  if (!t) return '';

  // Strip "at Company" or "@ Company" suffixes
  t = t.replace(/\s+(?:at|@)\s+.+$/i, '').trim();

  // Strip "| Company" or "- Company" trailing parts
  t = t.replace(/\s*[|–—]\s*[A-Z].+$/, '').trim();

  // Detect sentence-like titles (LinkedIn headlines)
  const SENTENCE_STARTERS = /^(i |we |my |our |a |the |an |helping |passionate |dedicated |experienced |results|driving |building |creating |empowering |enabling |transforming |committed |focused on |specializ|leverag|proven |award|over \d|with \d+|seeking |looking )/i;
  if (SENTENCE_STARTERS.test(t)) {
    const realPart = t.match(/^([\w\s/&-]+?)\s+(?:who|that|with|helping|passionate|dedicated|\||[-–—]|\.)/i);
    if (realPart && realPart[1].length >= 3 && realPart[1].length <= 45) {
      t = realPart[1].trim();
    } else {
      return '';
    }
  }

  // Kill obvious non-title phrases: anything with "and" + verb pattern
  if (/\b(and|to|for|in|the|that|this|those|these|which|where|when|how)\b.*\b(help|grow|drive|build|lead|create|deliver|enable|provide|improve|support|manage|develop|transform|solve|make|ensure)\b/i.test(t)) {
    // Try to salvage the first title-like fragment before the phrase
    const fragment = t.match(/^([\w\s/&-]{3,35}?)(?:\s+(?:and|who|that|with|helping|to|for)\s)/i);
    if (fragment) {
      t = fragment[1].trim();
    } else {
      return '';
    }
  }

  // Strip trailing fragments
  t = t.replace(/\s*(?:specializ\w+|focused on|passionate about|with expertise|responsible for|helping|dedicated to|committed to|looking to|seeking to|striving)\s+.*/i, '').trim();

  // Strip parenthetical qualifiers
  t = t.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

  // Strip quotes used as emphasis
  t = t.replace(/["""'']/g, '').trim();

  // Normalize separators and whitespace
  t = t.replace(/\s*\/\s*/g, '/').replace(/\s{2,}/g, ' ');

  // Strip trailing punctuation
  t = t.replace(/[.,;:!]+$/, '').trim();

  // Strip leading articles that slip through
  t = t.replace(/^(a |an |the )/i, '').trim();

  // Cap at 50 chars — tighter for premium look
  if (t.length > 50) {
    t = t.substring(0, 50).replace(/\s+\S*$/, '').trim();
  }

  // Reject overly long non-title text (>6 words without a title keyword)
  const words = t.split(/\s+/);
  if (words.length > 6 && !/\b(officer|president|director|manager|head|lead|chief|founder|owner|partner|vp|svp|evp|avp|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive)\b/i.test(t)) {
    return '';
  }

  // Final sanity: reject if it contains common sentence words mid-string
  if (/\b(you|your|they|them|their|us|we|our|my|me|his|her|its|this|that|those|these|would|could|should|will|shall|can|may|might|must|been|being|have|has|had|are|were|was|am|is|do|does|did)\b/i.test(t) && words.length > 3) {
    return '';
  }

  // ── Strict Title Case normalization for titles ──
  // "F&I MANAGER" → "F&I Manager", "SALES ASSOCIATE" → "Sales Associate"
  if (t.length > 1) {
    const isAllUpper = t === t.toUpperCase() && /[A-Z]/.test(t);
    const isAllLower = t === t.toLowerCase() && /[a-z]/.test(t);
    if (isAllUpper || isAllLower) {
      t = t.toLowerCase().replace(/(?:^|\s|[-/])(\S)/g, (m, c) => m.slice(0, -1) + c.toUpperCase());
    }
    // Handle remaining ALL-CAPS words (3+ chars), preserve known acronyms
    const KEEP_UPPER = new Set(['CEO','CFO','CTO','CMO','COO','CRO','CIO','CSO','VP','SVP','EVP','AVP','GM','MD','HR','IT','AI','PR','CRM','SAAS','B2B','B2C','ROI','SEO','API','IOT','MBA','PHD','DBA','USA','LLC','INC']);
    t = t.replace(/\b([A-Z]{3,})\b/g, (word) => {
      if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0) + word.slice(1).toLowerCase();
    });
  }

  return t;
}

// ── Strip person's name from title (Apollo sometimes returns "John Smith. CEO") ──
function cleanTitleForDisplay(name: string, rawTitle: string): string {
  const title = cleanDisplayTitle(rawTitle);
  if (!title || !name) return title;
  const cleanName = cleanDisplayName(name);
  if (!cleanName) return title;

  // Build regex patterns from the name to strip from title prefix
  // Match: "John Smith. CEO", "John Smith, CEO", "John Smith - CEO", "John Smith CEO"
  const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}[\\s.,;:\\-–—|/]*\\s*`, 'i');
  const stripped = title.replace(pattern, '').trim();

  // Also try first+last name separately for partial matches like "J. Smith. CEO"
  if (stripped === title) {
    const nameParts = cleanName.split(/\s+/);
    if (nameParts.length >= 2) {
      const last = nameParts[nameParts.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const first = nameParts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // "Smith. CEO" or "J Smith. CEO"
      const partialPattern = new RegExp(`^(?:${first}\\s+)?${last}[\\s.,;:\\-–—|/]*\\s*`, 'i');
      const partialStripped = title.replace(partialPattern, '').trim();
      if (partialStripped && partialStripped !== title && partialStripped.length >= 2) {
        return partialStripped;
      }
    }
  }

  return stripped && stripped.length >= 2 ? stripped : title;
}

// ── Display-level company name cleaner ──
function cleanDisplayCompany(raw: string): string {
  if (!raw) return '';
  let c = stripDisplayEmoji(raw).trim();
  if (!c) return '';

  // Strip trailing periods
  c = c.replace(/\.+$/, '').trim();

  // Remove URL parts
  c = c.replace(/\s*(?:https?:\/\/|www\.)\S+/i, '').trim();

  // Remove tagline suffixes
  c = c.replace(/\s*[-–—]\s+(?:A |The |Your |We |Leading |Premier |Top |Best |Trusted ).*/i, '').trim();

  // Truncate at comma if followed by sentence-like fragment
  c = c.replace(/,\s+(?:My |I |We |Our |Your |A |The |An |Helping |Passionate |Dedicated |Experienced |Building |Creating |Empowering |Enabling |Transforming |Committed |Focused |Specializ|Leverag|Proven |Award|Driving |Working |Looking |Seeking |Striving |Results).*/i, '').trim();

  // Reject LinkedIn headline patterns entirely
  const HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+\s+in|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work|build|create)|we\s+(?:help|are|build|create|provide|deliver)|my\s+(?:goal|mission|passion|focus))/i;
  if (HEADLINE.test(c)) return '';

  // Reject pure job titles as company names
  const PURE_TITLE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|director|manager|head|lead|chief|founder|co-?founder|owner|partner|president|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelanc\w+|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|developer|designer|recruiter|marketer|sales\w*|business\s+development)(\s+(of|at|for|in|&|and|\/)\s+.*)?$/i;
  if (PURE_TITLE.test(c)) return '';

  // Reject sentence-verb patterns in >3-word strings
  if (/\b(helping|empowering|enabling|transforming|building|creating|delivering|providing|growing|driving|solving|improving|supporting|managing|developing|seeking|looking|striving|committed|passionate|dedicated|experienced)\b/i.test(c) && c.split(/\s+/).length > 3) return '';

  // Reject pronoun-heavy strings
  if (/\b(my goal|i help|i am|we help|we are|our mission|your|they|them|their)\b/i.test(c) && c.split(/\s+/).length > 2) return '';

  // Collapse spaces
  c = c.replace(/\s{2,}/g, ' ');

  // Reject if >7 words
  if (c.split(/\s+/).length > 7) return '';

  // ── Strict Title Case for company names ──
  if (c.length > 1) {
    const isAllUpper = c === c.toUpperCase() && /[A-Z]/.test(c) && c.length > 4;
    const isAllLower = c === c.toLowerCase() && /[a-z]/.test(c);
    if (isAllUpper || isAllLower) {
      c = toTitleCase(c);
    }
  }

  return c;
}

// ── Revenue formatter: converts raw revenue strings to readable format ──
function formatRevenue(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num === 0) return raw;
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(num % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 1)}M`;
  if (num >= 1_000) return `$${Math.round(num / 1_000)}K`;
  return `$${num.toLocaleString()}`;
}

// ── Employee count formatter ──
function formatEmployeeCount(count: number): string {
  if (!count || count <= 0) return '';
  if (count >= 10000) return `${Math.round(count / 1000)}K`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return count.toLocaleString();
}

// ── Phone number formatter: international display ──
function formatPhoneNumber(raw: string): string {
  if (!raw) return '';
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');

  // US/CA: +1 (XXX) XXX-XXXX
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10 && !digits.startsWith('0')) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // UK: +44 XXXX XXXXXX
  if (digits.length >= 11 && digits.startsWith('44')) {
    return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }

  // AU: +61 X XXXX XXXX
  if (digits.length === 11 && digits.startsWith('61')) {
    return `+61 ${digits.slice(2, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }

  // Generic international: +CC XXX XXX XXXX
  if (hasPlus || digits.length > 10) {
    const cc = digits.length >= 12 ? digits.slice(0, 2) : digits.slice(0, 1);
    const rest = digits.slice(cc.length);
    const groups: string[] = [];
    for (let i = 0; i < rest.length; i += 3) {
      groups.push(rest.slice(i, i + 3));
    }
    return `+${cc} ${groups.join(' ')}`;
  }

  // Fallback: space-grouped
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
function isLeadInArea(lead: { city?: string; state?: string; country?: string }, targetLocation: string): boolean {
  if (!targetLocation) return false;
  const leadLoc = [lead.city, lead.state, lead.country].filter(Boolean).join(', ').toLowerCase();
  if (!leadLoc) return false;
  const tLoc = targetLocation.toLowerCase().trim();
  if (leadLoc.includes(tLoc) || tLoc.includes(leadLoc)) return true;
  const expand = (s: string) => STATE_ABBREVS[s.toLowerCase()] || s.toLowerCase();
  const leadState = (lead.state || '').toLowerCase().trim();
  const tParts = tLoc.split(',').map(s => s.trim());
  for (const tp of tParts) {
    if (leadState && (expand(leadState) === expand(tp))) return true;
    const leadCity = (lead.city || '').toLowerCase().trim();
    if (leadCity && leadCity === tp) return true;
  }
  return false;
}

// ── Types ──

interface ApolloLead {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string;
  linkedin_url: string;
  phone_numbers: { raw_number: string; type: string }[];
  city: string;
  state: string;
  country: string;
  seniority: string;
  departments: string[];
  // Preview flags (enrich-on-demand)
  _preview?: boolean;
  _has_email?: boolean;
  _has_phone?: boolean;
  // Computed lead score
  _lead_score?: number;
  // Email verification (DIY engine)
  email_verification?: {
    status: "valid" | "risky" | "invalid" | "unknown" | "pattern_guessed";
    score: number;
    flags: string[];
    mx_valid: boolean;
    is_disposable: boolean;
    is_role_based: boolean;
    is_free_provider: boolean;
    is_catch_all: boolean | null;
    domain: string;
    suggestion?: string;
  } | null;
  organization: {
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
  };
}

interface SearchStats {
  total: number;
  with_email: number;
  verified_emails: number;
  guessed_emails: number;
  with_phone: number;
  with_linkedin: number;
  unique_companies: number;
  seniority_breakdown: Record<string, number>;
  preview?: boolean;
  enrichment_sources?: {
    hunter: number;
    findymail: number;
    apollo_reveal: number;
    pool_kv?: number;
    pool_db?: number;
    pool_saved?: number;
    phone_enrich?: number;
    hunter_phone?: number;
    deep_phone?: number;
    deep_phone_sources?: Record<string, number>;
    phone_verified?: number;
    phone_dropped?: number;
    mobile_confirmed?: number;
    pattern_guessed?: number;
    verified?: number;
    verified_valid?: number;
    verified_risky?: number;
    verified_invalid?: number;
  };
}

interface StreamPhase {
  phase: number;
  name: string;
  status: string;
  total_available?: number;
  fetching?: number;
}

type SeniorityOption = 'owner' | 'founder' | 'c_suite' | 'partner' | 'vp' | 'head' | 'director' | 'manager' | 'senior' | 'entry';
type SortField = 'name' | 'title' | 'company' | 'seniority' | 'email_status' | 'score';

// ── Constants ──

const SENIORITY_OPTIONS: { value: SeniorityOption; labelKey: string; color: string }[] = [
  { value: 'owner', labelKey: 'apolloProSearch.seniorityOwner', color: 'text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-700/40' },
  { value: 'founder', labelKey: 'apolloProSearch.seniorityFounder', color: 'text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-700/40' },
  { value: 'c_suite', labelKey: 'apolloProSearch.seniorityCsuite', color: 'text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-700/40' },
  { value: 'partner', labelKey: 'apolloProSearch.seniorityPartner', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'vp', labelKey: 'apolloProSearch.seniorityVp', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'head', labelKey: 'apolloProSearch.seniorityHead', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'director', labelKey: 'apolloProSearch.seniorityDirector', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'manager', labelKey: 'apolloProSearch.seniorityManager', color: 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/40' },
  { value: 'senior', labelKey: 'apolloProSearch.senioritySenior', color: 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/40' },
  { value: 'entry', labelKey: 'apolloProSearch.seniorityEntry', color: 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/40' },
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

const TITLE_SUGGESTIONS: { value: string; labelKey: string }[] = [
  { value: 'CEO', labelKey: 'apolloProSearch.titleCEO' },
  { value: 'Founder', labelKey: 'apolloProSearch.titleFounder' },
  { value: 'Owner', labelKey: 'apolloProSearch.titleOwner' },
  { value: 'President', labelKey: 'apolloProSearch.titlePresident' },
  { value: 'CTO', labelKey: 'apolloProSearch.titleCTO' },
  { value: 'CFO', labelKey: 'apolloProSearch.titleCFO' },
  { value: 'COO', labelKey: 'apolloProSearch.titleCOO' },
  { value: 'CMO', labelKey: 'apolloProSearch.titleCMO' },
  { value: 'VP of Sales', labelKey: 'apolloProSearch.titleVpSales' },
  { value: 'VP of Marketing', labelKey: 'apolloProSearch.titleVpMarketing' },
  { value: 'VP of Engineering', labelKey: 'apolloProSearch.titleVpEngineering' },
  { value: 'VP of Operations', labelKey: 'apolloProSearch.titleVpOperations' },
  { value: 'Director of Sales', labelKey: 'apolloProSearch.titleDirSales' },
  { value: 'Director of Marketing', labelKey: 'apolloProSearch.titleDirMarketing' },
  { value: 'Director of Engineering', labelKey: 'apolloProSearch.titleDirEngineering' },
  { value: 'Head of Growth', labelKey: 'apolloProSearch.titleHeadGrowth' },
  { value: 'Head of Sales', labelKey: 'apolloProSearch.titleHeadSales' },
  { value: 'Head of Product', labelKey: 'apolloProSearch.titleHeadProduct' },
  { value: 'Sales Manager', labelKey: 'apolloProSearch.titleSalesManager' },
  { value: 'Marketing Manager', labelKey: 'apolloProSearch.titleMarketingManager' },
  { value: 'Account Executive', labelKey: 'apolloProSearch.titleAccountExec' },
  { value: 'General Manager', labelKey: 'apolloProSearch.titleGeneralManager' },
  { value: 'Managing Director', labelKey: 'apolloProSearch.titleManagingDirector' },
  { value: 'Partner', labelKey: 'apolloProSearch.titlePartner' },
];

// Location data moved to LocationPicker component

const INDUSTRY_OPTIONS = [
  'Accounting', 'Advertising', 'Aerospace & Defense', 'Agriculture', 'Airlines & Aviation',
  'Alternative Medicine', 'Animation', 'Apparel & Fashion', 'Architecture & Planning',
  'Arts & Crafts', 'Automotive', 'Aviation & Aerospace', 'Banking', 'Biotechnology',
  'Broadcast Media', 'Building Materials', 'Business Supplies & Equipment',
  'Capital Markets', 'Chemicals', 'Civic & Social Organization', 'Civil Engineering',
  'Commercial Real Estate', 'Computer & Network Security', 'Computer Games',
  'Computer Hardware', 'Computer Networking', 'Computer Software', 'Construction',
  'Consumer Electronics', 'Consumer Goods', 'Consumer Services', 'Cosmetics',
  'Dairy', 'Defense & Space', 'Design', 'E-Learning', 'Education Management',
  'Electrical & Electronic Manufacturing', 'Entertainment', 'Environmental Services',
  'Events Services', 'Executive Office', 'Facilities Services', 'Farming',
  'Financial Services', 'Fine Art', 'Fishery', 'Food & Beverages', 'Food Production',
  'Fund-Raising', 'Furniture', 'Gambling & Casinos', 'Glass, Ceramics & Concrete',
  'Government Administration', 'Government Relations', 'Graphic Design', 'Health, Wellness & Fitness',
  'Higher Education', 'Hospital & Health Care', 'Hospitality', 'Human Resources',
  'Import & Export', 'Individual & Family Services', 'Industrial Automation',
  'Information Services', 'Information Technology & Services', 'Insurance',
  'International Affairs', 'International Trade & Development', 'Internet',
  'Investment Banking', 'Investment Management', 'Judiciary', 'Law Enforcement',
  'Law Practice', 'Legal Services', 'Legislative Office', 'Leisure, Travel & Tourism',
  'Libraries', 'Logistics & Supply Chain', 'Luxury Goods & Jewelry', 'Machinery',
  'Management Consulting', 'Maritime', 'Market Research', 'Marketing & Advertising',
  'Mechanical or Industrial Engineering', 'Media Production', 'Medical Devices',
  'Medical Practice', 'Mental Health Care', 'Military', 'Mining & Metals',
  'Motion Pictures & Film', 'Museums & Institutions', 'Music', 'Nanotechnology',
  'Newspapers', 'Non-Profit Organization Management', 'Oil & Energy',
  'Online Media', 'Outsourcing/Offshoring', 'Package/Freight Delivery',
  'Packaging & Containers', 'Paper & Forest Products', 'Performing Arts',
  'Pharmaceuticals', 'Philanthropy', 'Photography', 'Plastics',
  'Political Organization', 'Primary/Secondary Education', 'Printing',
  'Professional Training & Coaching', 'Program Development', 'Public Policy',
  'Public Relations & Communications', 'Public Safety', 'Publishing',
  'Railroad Manufacture', 'Ranching', 'Real Estate', 'Recreational Facilities & Services',
  'Religious Institutions', 'Renewables & Environment', 'Research',
  'Restaurants', 'Retail', 'Security & Investigations', 'Semiconductors',
  'Shipbuilding', 'Sporting Goods', 'Sports', 'Staffing & Recruiting',
  'Supermarkets', 'Telecommunications', 'Textiles', 'Think Tanks',
  'Tobacco', 'Translation & Localization', 'Transportation/Trucking/Railroad',
  'Utilities', 'Venture Capital & Private Equity', 'Veterinary', 'Warehousing',
  'Wholesale', 'Wine & Spirits', 'Wireless', 'Writing & Editing',
];

const MAX_RESULTS_OPTIONS = [
  { value: 10, label: '10' },
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
];

// ── Helper Components ──

// Infer seniority from title text (frontend fallback for leads without explicit seniority)
function inferSeniorityFromTitle(title: string): SeniorityOption | '' {
  if (!title) return '';
  const t = title.toLowerCase();
  if (/\bowner\b/.test(t)) return 'owner';
  if (/\bfounder\b|co[\s-]?founder\b/.test(t)) return 'founder';
  if (/\b(ceo|cfo|cto|coo|cmo|cro|cpo|cio|chro|cso|cdo)\b/.test(t)) return 'c_suite';
  if (/\bchief\s/.test(t)) return 'c_suite';
  if (/\bpresident\b/.test(t) && !/vice[\s-]?president/.test(t)) return 'c_suite';
  if (/\bpartner\b/.test(t)) return 'partner';
  if (/\b(vp|vice[\s-]?president|svp|evp|avp)\b/.test(t)) return 'vp';
  if (/\bhead\s+(of\s+)?/.test(t)) return 'head';
  if (/\b(director|managing\s+director)\b/.test(t)) return 'director';
  if (/\b(manager|general\s+manager)\b/.test(t)) return 'manager';
  if (/\b(senior|sr\.?|principal)\b/.test(t)) return 'senior';
  return '';
}

// ── Lead Score Computation (mirrors backend scoring for Smart Discovery) ──
function computeLeadScore(lead: ApolloLead): number {
  let score = 0;
  const weights = { data: 20, contact: 25, title: 25, company: 15, verification: 15 };

  // Data completeness (0-20)
  const fields = [lead.name, lead.title, lead.email, lead.organization?.name, lead.organization?.industry, lead.city || lead.country, lead.linkedin_url, lead.organization?.website_url];
  const filled = fields.filter(f => f && String(f).trim().length > 0).length;
  score += Math.round((filled / fields.length) * weights.data);

  // Contact quality (0-25)
  let contactScore = 0;
  if (lead.email) {
    // Generic/role-based emails get zero contact points — they're not decision makers
    if (isGenericEmail(lead.email) || lead.email_verification?.is_role_based) {
      contactScore = 0;
    } else {
      contactScore += 10;
      const domain = lead.email.split('@')[1] || '';
      const freeProviders = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com']);
      if (!freeProviders.has(domain)) contactScore += 5; // Business email
    }
  }
  if (lead.phone_numbers?.length > 0) contactScore += 5;
  if (lead.linkedin_url) contactScore += 5;
  score += Math.min(contactScore, weights.contact);

  // Title/seniority value (0-25)
  const seniorityScores: Record<string, number> = {
    owner: 25, founder: 25, c_suite: 23, partner: 20, vp: 18, head: 16, director: 14, manager: 10, senior: 8, entry: 4,
  };
  const effectiveSeniority = (lead.seniority && lead.seniority !== 'unknown' ? lead.seniority : '') || inferSeniorityFromTitle(lead.title) || '';
  score += seniorityScores[effectiveSeniority] || 6;

  // Company data (0-15)
  let companyScore = 0;
  if (lead.organization?.name) companyScore += 4;
  if (lead.organization?.website_url) companyScore += 3;
  if (lead.organization?.industry) companyScore += 3;
  if (Number(lead.organization?.estimated_num_employees) > 0) companyScore += 3;
  if (lead.organization?.annual_revenue_printed) companyScore += 2;
  score += Math.min(companyScore, weights.company);

  // Email verification quality (0-15)
  if (lead.email_verification) {
    const v = lead.email_verification;
    if (v.status === 'valid' && v.score >= 80) score += 15;
    else if (v.status === 'valid') score += 12;
    else if (v.status === 'risky') score += 6;
    else if (v.status === 'invalid') score += 0;
  } else if (lead.email_status === 'verified') {
    score += 12;
  } else if (lead.email_status === 'pattern_guessed') {
    score += 5;
  } else if (lead.email) {
    score += 8;
  }

  return Math.min(Math.max(score, 0), 100);
}

function SeniorityBadge({ seniority, title }: { seniority: string; title?: string }) {
  const { t } = useTranslation();
  // Treat "unknown" / empty as unset — always try title inference as fallback
  const raw = (seniority && seniority !== 'unknown') ? seniority : '';
  const effectiveSeniority = raw || (title ? inferSeniorityFromTitle(title) : '');
  if (!effectiveSeniority) return null;
  const opt = SENIORITY_OPTIONS.find(s => s.value === effectiveSeniority);
  if (!opt) return null; // Never display raw unrecognized values
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ${opt.color}`}>
      {t(opt.labelKey)}
    </span>
  );
}

// ── Inline activity icon resolver ──
function activityIcon(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('cache hit') || m.includes('local database') || m.includes('scanning local') || m.includes('database')) return <Database className="w-3.5 h-3.5" />;
  if (m.includes('discover') || m.includes('scanning') || m.includes('network') || m.includes('search')) return <Globe className="w-3.5 h-3.5" />;
  if (m.includes('email') || m.includes('located') || m.includes('contact details')) return <Mail className="w-3.5 h-3.5" />;
  if (m.includes('phone')) return <Phone className="w-3.5 h-3.5" />;
  if (m.includes('verif') || m.includes('deliverability') || m.includes('safe to send')) return <ShieldCheck className="w-3.5 h-3.5" />;
  if (m.includes('saving') || m.includes('saved')) return <Database className="w-3.5 h-3.5" />;
  if (m.includes('dedup') || m.includes('cross-check') || m.includes('crm') || m.includes('cross-referenc')) return <UserCheck className="w-3.5 h-3.5" />;
  if (m.includes('enrich') || m.includes('found contact') || m.includes('profile')) return <Zap className="w-3.5 h-3.5" />;
  if (m.includes('paginat') || m.includes('fetching') || m.includes('loading')) return <Download className="w-3.5 h-3.5" />;
  if (m.includes('fallback') || m.includes('broaden')) return <AlertTriangle className="w-3.5 h-3.5" />;
  return <Search className="w-3.5 h-3.5" />;
}

// ── Small inline header feed (for progress panel) ──
function ActivityLogFeed({ entries, isSearching }: { entries: Array<{ id: number; message: string; type: 'info' | 'success' | 'warn'; ts: number }>; isSearching: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries.length]);
  const visible = entries.slice(-3);
  return (
    <div className="mt-1">
      <div ref={scrollRef} className="space-y-px overflow-hidden max-h-[54px]">
        {visible.map((entry, i) => {
          const isLatest = i === visible.length - 1 && isSearching;
          return (
            <div key={entry.id} className={`flex items-center gap-1.5 py-[2px] px-1.5 rounded text-[10px] leading-tight transition-all duration-300 ${isLatest ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'}`}>
              <span className={`w-1 h-1 rounded-full flex-shrink-0 ${entry.type === 'success' ? 'bg-[#1ED4A7]' : entry.type === 'warn' ? 'bg-zinc-400' : isLatest ? 'bg-[#1ED4A7] animate-pulse' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
              <span className="truncate">{entry.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════���═══
// LiveAgentFeed — Premium full-page live activity feed during lead discovery.
// Each entry streams in one-by-one with staggered slide + fade animations,
// contextual icons, and a typing-cursor effect on the latest line.
// ══════════════════════════════════════════════════════════════════════════════
const agentFeedKeyframes = `
@keyframes agentEntryIn {
  0%   { opacity: 0; transform: translateY(8px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes agentCursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes agentPulseRing {
  0%   { box-shadow: 0 0 0 0 rgba(30,212,167,0.35); }
  70%  { box-shadow: 0 0 0 8px rgba(30,212,167,0); }
  100% { box-shadow: 0 0 0 0 rgba(30,212,167,0); }
}
@keyframes agentScanLine {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes leadRowIn {
  0%   { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes leadRowHighlight {
  0%   { background-color: rgba(30,212,167,0.06); }
  100% { background-color: transparent; }
}
`;

function LiveAgentFeed({
  entries,
  isSearching,
  phases,
  progress,
}: {
  entries: Array<{ id: number; message: string; type: 'info' | 'success' | 'warn'; ts: number }>;
  isSearching: boolean;
  phases: StreamPhase[];
  progress: { fetched: number; total: number; page: number; total_pages: number } | null;
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

  const activePhase = phases.find(p => p.status === 'searching' || p.status === 'processing' || p.status === 'checking');
  const completedPhases = phases.filter(p => p.status === 'complete').length;
  const phasePct = phases.length > 0 ? Math.round((completedPhases / Math.max(phases.length, 3)) * 100) : 0;
  const fetchPct = progress && progress.total > 0 ? Math.round((progress.fetched / progress.total) * 100) : 0;
  const pct = progress ? fetchPct : phasePct;

  return (
    <div className="h-full flex flex-col px-4 sm:px-6 pt-3 pb-4">
      {/* ── Header ── */}
      <div className="flex-shrink-0 pb-3">
        <div className="flex items-center gap-3 mb-5">
          <div className="relative">
            <div
              className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white/10 flex items-center justify-center"
              style={isSearching ? { animation: 'agentPulseRing 2s ease infinite' } : undefined}
            >
              <Radar className={`w-5 h-5 text-[#1ED4A7] ${isSearching ? 'animate-pulse' : ''}`} />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">{t('apolloProSearch.pageTitle')}</h3>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {isSearching
                ? (activePhase ? translatePhaseName(t, activePhase.name) : t('apolloProSearch.working'))
                : t('apolloProSearch.completeOps', { count: entries.length })
              }
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {progress && (
              <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 tabular-nums">
                {progress.fetched}/{progress.total}
              </span>
            )}
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
              style={{ animation: 'agentScanLine 2s ease-in-out infinite' }}
            />
          )}
        </div>

        {/* Phase chips */}
        {phases.length > 0 && (
          <div className="flex items-center gap-1.5 mt-4 overflow-x-auto no-scrollbar pb-1">
            {phases.map((phase, i) => {
              const isActive = phase.status === 'searching' || phase.status === 'processing' || phase.status === 'checking';
              const isDone = phase.status === 'complete';
              const isSkipped = phase.status === 'skipped';
              return (
                <div key={phase.phase} className="contents">
                  {i > 0 && (
                    <div className={`w-4 h-px flex-shrink-0 transition-colors duration-500 ${isDone ? 'bg-[#1ED4A7]/40' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                  )}
                  <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg flex-shrink-0 text-[10px] font-medium transition-all duration-300 ${
                    isActive ? 'bg-[#1ED4A7]/8 text-zinc-900 dark:text-zinc-100 ring-1 ring-[#1ED4A7]/25' :
                    isDone ? 'bg-zinc-50 dark:bg-zinc-950 text-[#1ED4A7]' :
                    isSkipped ? 'bg-zinc-50 dark:bg-zinc-950 text-zinc-400 dark:text-zinc-600 line-through' :
                    'bg-zinc-50 dark:bg-zinc-950 text-zinc-400 dark:text-zinc-600'
                  }`}>
                    {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isDone && <CheckCircle className="w-3 h-3" />}
                    {!isActive && !isDone && <div className="w-1.5 h-1.5 rounded-full border border-current" />}
                    <span className="whitespace-nowrap">{translatePhaseName(t, phase.name || '')}</span>
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
            const icon = activityIcon(entry.message);
            return (
              <div
                key={entry.id}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${
                  isLatest
                    ? 'bg-[#1ED4A7]/[0.04] dark:bg-[#1ED4A7]/[0.04]'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/20'
                }`}
                style={{ animation: 'agentEntryIn 0.35s cubic-bezier(0.16,1,0.3,1) both' }}
              >
                {/* Icon */}
                <div className={`flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                  entry.type === 'success'
                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                    : entry.type === 'warn'
                    ? 'bg-zinc-500/10 text-zinc-400'
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
                      ? 'text-zinc-500 dark:text-zinc-400'
                      : 'text-zinc-500 dark:text-zinc-500'
                  }`}>
                    {translateActivityMessage(t, entry.message)}
                    {isLatest && (
                      <span
                        className="inline-block w-[2px] h-[13px] ml-1 align-middle rounded-full bg-[#1ED4A7]"
                        style={{ animation: 'agentCursorBlink 0.8s steps(2) infinite' }}
                      />
                    )}
                  </p>
                </div>

                {/* Dot / Timestamp */}
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
                <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">{t('apolloProSearch.initAgent')}</p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{t('apolloProSearch.preparingSearchShort')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex-shrink-0 px-6 md:px-8 py-3 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
          {t('apolloProSearch.operationCount', { count: entries.length })}{phases.length > 0 ? ` · ${t('apolloProSearch.phasesCount', { completed: completedPhases, total: phases.length })}` : ''}
        </span>
        {isSearching && activePhase && (
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-[#1ED4A7] animate-pulse" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[200px]">
              {translatePhaseName(t, activePhase.name)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailBadge({ status, verification }: { status: string; verification?: ApolloLead['email_verification'] }) {
  const { t } = useTranslation();
  // Single unified badge — verification takes priority when available
  if (verification) {
    const { status: v, score } = verification;
    if (v === 'valid' && score >= 70) return (
      <span className="inline-flex items-center flex-shrink-0 text-[#1ED4A7]/70" title={`${t('apolloProSearch.deliverability')}: ${score}/100`}>
        <ShieldCheck className="w-3.5 h-3.5" />
      </span>
    );
    if (v === 'risky') return (
      <span className="inline-flex items-center flex-shrink-0 text-zinc-400" title={`${t('apolloProSearch.deliverability')}: ${score}/100 — ${t('apolloProSearch.mayBounce')}`}>
        <AlertTriangle className="w-3.5 h-3.5" />
      </span>
    );
    if (v === 'invalid') return (
      <span className="inline-flex items-center flex-shrink-0 text-zinc-500/60" title={`${t('apolloProSearch.deliverability')}: ${score}/100 — ${t('apolloProSearch.likelyBounces')}`}>
        <X className="w-3.5 h-3.5" />
      </span>
    );
  }
  // Fallback to source status when no verification
  if (status === 'verified') return (
    <span className="inline-flex items-center flex-shrink-0 text-[#1ED4A7]/70" title={t('apolloProSearch.verifiedEmail')}>
      <ShieldCheck className="w-3.5 h-3.5" />
    </span>
  );
  if (status === 'pattern_guessed') return (
    <span className="inline-flex items-center flex-shrink-0 text-zinc-400" title={t('apolloProSearch.patternMatched')}>
      <Target className="w-3.5 h-3.5" />
    </span>
  );
  if (status === 'guessed') return (
    <span className="inline-flex items-center flex-shrink-0 text-zinc-400/60" title={t('apolloProSearch.guessedEmail')}>
      <AlertTriangle className="w-3.5 h-3.5" />
    </span>
  );
  return null;
}

function ComboboxInput({
  value, onChange, suggestions, placeholder, icon: Icon, label, required,
}: {
  value: string; onChange: (v: string) => void; suggestions: { value: string; labelKey: string }[];
  placeholder: string; icon: React.ElementType; label: string; required?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!value.trim()) return suggestions.slice(0, 12);
    const q = value.toLowerCase();
    return suggestions.filter(s =>
      s.value.toLowerCase().includes(q) || t(s.labelKey).toLowerCase().includes(q)
    ).slice(0, 10);
  }, [value, suggestions, t]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={comboRef} className="relative">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500 mb-1.5">
        {label} {required && '*'}
      </label>
      <div className="relative">
        <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full pl-8 pr-8 py-2 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all placeholder:text-zinc-400"
        />
        <ChevronDown className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {filtered.map(item => (
            <button
              key={item.value}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(item.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${value === item.value ? 'text-[#1ED4A7] font-medium bg-[#1ED4A7]/5' : 'text-zinc-900 dark:text-zinc-100'}`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Industry Multi-Select Component ──

function IndustrySelect({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (v: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return INDUSTRY_OPTIONS;
    const q = search.toLowerCase();
    return INDUSTRY_OPTIONS.filter(i => {
      const translatedLabel = t(`companySearch.industries.${i}`, i);
      return i.toLowerCase().includes(q) || translatedLabel.toLowerCase().includes(q);
    });
  }, [search, t]);

  const toggle = (industry: string) => {
    const next = new Set(selected);
    if (next.has(industry)) next.delete(industry);
    else next.add(industry);
    onChange(next);
  };

  return (
    <div ref={ref}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        {t('apolloProSearch.industryLabel')} <span className="text-zinc-400 normal-case">{t('apolloProSearch.industryOptional')}</span>
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center gap-2 pl-8 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-950 border rounded-lg transition-all text-left ${
            open
              ? 'ring-2 ring-[#1ED4A7]/30 border-[#1ED4A7]/50'
              : 'border-zinc-200 dark:border-zinc-800'
          }`}
        >
          <Factory className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          {selected.size === 0 ? (
            <span className="text-zinc-400 truncate">{t('apolloProSearch.selectIndustries')}</span>
          ) : (
            <span className="text-zinc-900 dark:text-zinc-100 truncate">
              {Array.from(selected).slice(0, 2).map(s => t(`companySearch.industries.${s}`, s)).join(', ')}
              {selected.size > 2 && ` +${selected.size - 2}`}
            </span>
          )}
          <ChevronDown className={`ml-auto w-3 h-3 text-zinc-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown — inside relative so absolute positioning is scoped to the button */}
        {open && (
          <div className="absolute z-50 top-full left-0 w-full min-w-[240px] mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden">
            <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('apolloProSearch.searchIndustries')}
                className="w-full px-2.5 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-md outline-none focus:ring-1 focus:ring-[#1ED4A7]/30 placeholder:text-zinc-400"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-xs text-zinc-400 text-center">{t('apolloProSearch.noIndustriesFound')}</div>
              ) : filtered.map(ind => (
                <button
                  key={ind}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); toggle(ind); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                    selected.has(ind)
                      ? 'text-[#1ED4A7] font-medium bg-[#1ED4A7]/5'
                      : 'text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                    selected.has(ind)
                      ? 'border-[#1ED4A7] bg-[#1ED4A7]/20'
                      : 'border-zinc-300 dark:border-zinc-600'
                  }`}>
                    {selected.has(ind) && <Check className="w-2.5 h-2.5" />}
                  </div>
                  {t(`companySearch.industries.${ind}`, ind)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Selected chips */}
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {Array.from(selected).map(ind => (
            <span
              key={ind}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md border border-[#1ED4A7]/40 bg-[#1ED4A7]/10 text-[#1ED4A7]"
            >
              {t(`companySearch.industries.${ind}`, ind)}
              <button
                type="button"
                onClick={() => toggle(ind)}
                className="hover:text-zinc-300 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

    </div>
  );
}

// ── Main Component ──

interface ApolloProSearchProps {
  onSaveProspects?: (prospects: any[]) => void;
  embedded?: boolean;
  onUpgrade?: () => void;
  initialDomain?: string;
}

export function ApolloProSearch({ onSaveProspects, embedded = false, onUpgrade, initialDomain }: ApolloProSearchProps) {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { scrollRef: mainScrollRef, headerClass } = useScrollHeader(10, true);
  
  // Search params
  const [titles, setTitles] = useState('');
  const [locationValue, setLocationValue] = useState<LocationPickerValue>({ country: 'United States', state: '', cities: [] });
  const [keywords, setKeywords] = useState('');
  const [seniorities, setSeniorities] = useState<Set<SeniorityOption>>(new Set(['owner', 'founder', 'c_suite']));
  const [employeeRanges, setEmployeeRanges] = useState<Set<string>>(new Set());
  const [industries, setIndustries] = useState<Set<string>>(new Set());
  const [maxResults, setMaxResults] = useState(10);
  const [dbOnly, setDbOnly] = useState(true); // Start with database, auto-fallback to full search
  const [poolStats, setPoolStats] = useState<{ total: number; db_leads: number; kv_leads: number } | null>(null);
  const [companyDomain, setCompanyDomain] = useState(initialDomain || '');

  // Sync companyDomain when initialDomain prop changes (e.g. Company Search → Find Decision Makers)
  useEffect(() => {
    if (initialDomain) setCompanyDomain(initialDomain);
  }, [initialDomain]);

  // Results
  const [results, setResults] = useState<ApolloLead[]>([]);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [existingEmails, setExistingEmails] = useState<Set<string>>(new Set());

  // Enrich-on-demand state
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [revealing, setRevealing] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isCachedResult, setIsCachedResult] = useState(false);
  const [apolloTotalAvailable, setApolloTotalAvailable] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [deepProspectAttempted, setDeepProspectAttempted] = useState(false);
  // Progressive fallback: 0=db-only, 1=full+all-filters, 2=full-no-seniority, 3=full-no-industry, 4=exhausted
  // Using a ref to avoid stale closure issues in setTimeout callbacks
  const fallbackStageRef = useRef(0);
  // Snapshot original filters so we can restore after progressive relaxation
  const originalFiltersRef = useRef<{ seniorities: Set<SeniorityOption>; industries: Set<string> } | null>(null);
  // Ref to always hold the latest handleSearch — prevents stale closures in setTimeout fallbacks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSearchRef = useRef<any>(() => {});

  // Location area filter
  const [showOnlyInArea, setShowOnlyInArea] = useState(false);
  const searchLocationString = useMemo(() => {
    return [locationValue.cities?.[0], locationValue.state].filter(Boolean).join(', ') || '';
  }, [locationValue]);

  // Team contact-check state: email → outreach details
  const [teamContacts, setTeamContacts] = useState<Record<string, { contacted_by: string; campaign_name: string; sent_at: string; is_you: boolean }[]>>({});
  const [checkingTeamContacts, setCheckingTeamContacts] = useState(false);

  // Progress tracking
  const [phases, setPhases] = useState<StreamPhase[]>([]);
  const [progress, setProgress] = useState<{ fetched: number; total: number; page: number; total_pages: number } | null>(null);
  const [activityLog, setActivityLog] = useState<Array<{ id: number; message: string; type: 'info' | 'success' | 'warn'; ts: number }>>([]);
  const activityIdRef = useRef(0);
  const [streamingMode, setStreamingMode] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drip-feed: queue incoming leads and reveal them one-by-one
  const pendingLeadsRef = useRef<ApolloLead[]>([]);
  const dripTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());
  // Track IDs that have just been dripped in (for entry animation)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  function dripNext() {
    if (pendingLeadsRef.current.length === 0) {
      dripTimerRef.current = null;
      return;
    }
    const next = pendingLeadsRef.current.shift()!;
    renderedIdsRef.current.add(next.id);
    setResults(prev => [...prev, next]);
    setFreshIds(prev => new Set(prev).add(next.id));
    // Clear "fresh" highlight after animation completes
    setTimeout(() => setFreshIds(prev => { const n = new Set(prev); n.delete(next.id); return n; }), 800);
    dripTimerRef.current = setTimeout(dripNext, 120);
  }

  function startDrip() {
    if (dripTimerRef.current) return;
    dripNext();
  }

  function flushDrip(allLeads: ApolloLead[]) {
    if (dripTimerRef.current) { clearTimeout(dripTimerRef.current); dripTimerRef.current = null; }
    pendingLeadsRef.current = [];
    renderedIdsRef.current = new Set(allLeads.map(l => l.id));
    setResults(allLeads);
    setFreshIds(new Set());
  }

  // UI
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortAsc, setSortAsc] = useState(true);
  const [emailFilter, setEmailFilter] = useState<'all' | 'verified' | 'has_email' | 'no_email'>('all');
  const [resultSearch, setResultSearch] = useState('');
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  // Saved lists
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [showSavedLists, setShowSavedLists] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [saveListName, setSaveListName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // ── Restore cached results on mount ──
  useEffect(() => {
    const cached = loadFinderCache<{
      results: ApolloLead[];
      stats: SearchStats | null;
      isPreviewMode: boolean;
    }>(CACHE_KEYS.LEAD_FINDER_PEOPLE);
    if (cached && cached.results.length > 0) {
      setResults(cached.results);
      if (cached.stats) setStats(cached.stats);
      setIsPreviewMode(cached.isPreviewMode ?? false);
      setHasSearched(true);
      console.log(`[APOLLO] Restored ${cached.results.length} cached results`);
    }
  }, []);

  // ─��� Persist results to cache whenever they change ──
  useEffect(() => {
    if (results.length > 0 && !isSearching) {
      saveFinderCache(CACHE_KEYS.LEAD_FINDER_PEOPLE, {
        results,
        stats,
        isPreviewMode,
      });
    }
  }, [results, stats, isSearching]);

  // Check Apollo connection + deep prospect availability on mount
  useEffect(() => {
    if (!isDemoMode) {
      loadSavedLists();
      fetchPoolStats();
      fetchExistingCrmEmails();
    }
  }, [isDemoMode]);

  // ── Fetch ALL existing CRM lead emails on mount so results never show duplicates ──
  async function fetchExistingCrmEmails() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      let allEmails: string[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('leads')
          .select('email')
          .eq('user_id', user.id)
          .not('email', 'is', null)
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        allEmails = allEmails.concat(
          data.map((r: any) => (r.email as string).toLowerCase()).filter(Boolean)
        );
        if (data.length < pageSize) break;
        from += pageSize;
      }
      if (allEmails.length > 0) {
        setExistingEmails(prev => {
          const merged = new Set(prev);
          allEmails.forEach(e => merged.add(e));
          return merged;
        });
        console.log(`[LEAD FINDER] Loaded ${allEmails.length} existing CRM emails — will be hidden from results`);
      }
    } catch {
      // Non-critical — silently fail
    }
  }

  async function fetchPoolStats() {
    if (isDemoMode) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/apollo/pool/stats`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setPoolStats({ total: data.total || 0, kv_leads: data.kv_leads || 0, db_leads: data.db_leads || 0 });
      }
    } catch {
      // Non-critical — silently fail
    }
  }

  // ── Team contact-check: run after results are loaded ──
  useEffect(() => {
    if (isDemoMode) return;
    if (results.length === 0) {
      setTeamContacts({});
      return;
    }
    // Collect emails from results
    const emails = results.map(r => r.email).filter(Boolean);
    if (emails.length === 0) return;

    async function checkTeam() {
      setCheckingTeamContacts(true);
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/contact-check`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ emails }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          setTeamContacts(data.contacts || {});
          const contactedCount = Object.keys(data.contacts || {}).length;
          if (contactedCount > 0) {
            console.log(`[APOLLO] Team contact-check: ${contactedCount} leads already contacted by team`);
          }
        }
      } catch (err) {
        console.error('[APOLLO] Team contact-check error:', err);
      } finally {
        setCheckingTeamContacts(false);
      }
    }

    // Debounce slightly to avoid calling during streaming
    const timer = setTimeout(checkTeam, 500);
    return () => clearTimeout(timer);
  }, [results.length, isDemoMode]); // Only re-check when results count changes (avoids re-running on same batch)

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // ── Pool Stats — show how many leads are locally available ──
  useEffect(() => {
    if (isDemoMode) return;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        if (!headers.Authorization) return;
        const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/deep-prospect/pool-stats`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.success) setPoolStats({ total: data.total, db_leads: data.db_leads, kv_levels: data.kv_leads });
        }
      } catch {}
    })();
  }, [results.length, isDemoMode]); // Re-fetch after searches complete (pool may have grown)

  // ── Saved Lists ──
  async function loadSavedLists() {
    if (isDemoMode) return;
    try {
      setLoadingLists(true);
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-engine/lists`, { headers });
      if (res.ok) {
        const data = await res.json();
        // Filter to only Apollo-type lists
        setSavedLists((data.lists || []).filter((l: any) => l.type === 'apollo'));
      }
    } catch (err: any) {
      // Silence transient network errors (e.g. Safari "Load failed")
      const msg = (err?.message || '').toLowerCase();
      if (!msg.includes('load failed') && !msg.includes('failed to fetch') && !msg.includes('network error') && !msg.includes('aborted')) {
        console.error('[APOLLO] Failed to load saved lists:', err);
      }
    } finally {
      setLoadingLists(false);
    }
  }

  async function handleSaveSearchResults() {
    if (results.length === 0) { toast.error(t('apolloProSearch.toastNoResultsToSave')); return; }
    const name = saveListName.trim() || `Smart Discovery — ${new Date().toLocaleDateString()}`;
    setSavingList(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-engine/lists`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          type: 'apollo',
          leads: results,
          search_params: {
            titles,
            locationValue,
            keywords,
            seniorities: Array.from(seniorities),
            employeeRanges: Array.from(employeeRanges),
            industries: Array.from(industries),
            maxResults,
            dbOnly,
          },
        }),
      });
      if (res.ok) {
        toast.success(t('apolloProSearch.toastSavedSearch', { name, count: results.length.toLocaleString() }));
        setShowSaveDialog(false);
        setSaveListName('');
        loadSavedLists();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t('apolloProSearch.toastFailedToSave'));
      }
    } catch (err) {
      toast.error(t('apolloProSearch.toastFailedToSaveResults'));
    } finally {
      setSavingList(false);
    }
  }

  async function handleLoadList(id: string) {
    try {
      setIsSearching(true);
      setResults([]);
      setStats(null);
      fallbackStageRef.current = 0;
      setDeepProspectAttempted(false);
      const headers = await getAuthHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-engine/lists/${id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const leads = (data.leads || []).map((l: ApolloLead) => ({ ...l, _lead_score: computeLeadScore(l) }));
        setResults(leads);
        // Restore search params if available
        const sp = data.list.search_params;
        if (sp) {
          if (sp.titles) setTitles(sp.titles);
          if (sp.locationValue) setLocationValue(sp.locationValue);
          // Legacy compat: old searches stored location/personCity strings
          if (!sp.locationValue && sp.location) setLocationValue({ country: sp.location, state: '', cities: sp.personCity ? [sp.personCity] : [] });
          if (sp.keywords) setKeywords(sp.keywords);
          if (sp.seniorities) setSeniorities(new Set(sp.seniorities));
          if (sp.employeeRanges) setEmployeeRanges(new Set(sp.employeeRanges));
          if (sp.industries) setIndustries(new Set(sp.industries));
          if (sp.maxResults) setMaxResults(sp.maxResults);
          // Reset dbOnly to true on load — will auto-fallback to full search if DB returns 0
        }
        // Build basic stats
        setStats({
          total: leads.length,
          with_email: leads.filter((l: any) => l.email).length,
          verified_emails: leads.filter((l: any) => l.email_status === 'verified').length,
          guessed_emails: leads.filter((l: any) => l.email_status === 'guessed').length,
          with_phone: leads.filter((l: any) => l.phone_numbers?.length > 0).length,
          with_linkedin: leads.filter((l: any) => l.linkedin_url).length,
          unique_companies: new Set(leads.map((l: any) => l.organization?.name).filter(Boolean)).size,
          seniority_breakdown: {},
        });
        setShowSavedLists(false);
        toast.success(t('apolloProSearch.toastLoadedList', { name: data.list.name }));
      }
    } catch (err) {
      toast.error(t('apolloProSearch.toastFailedToLoadList'));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDeleteList(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-engine/lists/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        setSavedLists(prev => prev.filter(l => l.id !== id));
        toast.success(t('apolloProSearch.toastListDeleted'));
      }
    } catch (err) {
      toast.error(t('apolloProSearch.toastFailedToDeleteList'));
    }
  }

  // Toggle seniority
  const toggleSeniority = (s: SeniorityOption) => {
    const next = new Set(seniorities);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSeniorities(next);
  };

  // Toggle employee range
  const toggleEmployeeRange = (r: string) => {
    const next = new Set(employeeRanges);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    setEmployeeRanges(next);
  };

  // ── Search (SSE Streaming) ──
  const handleSearch = async (e?: React.FormEvent, bypassCache = false, forceFullSearch = false, filterOverrides?: { seniorities?: Set<SeniorityOption>; industries?: Set<string>; preferredIndustries?: string[]; forceExternal?: boolean }) => {
    const isAutoFallback = !!filterOverrides;

    if (e) {
      e.preventDefault();
    }
    
    if (!isAutoFallback) {
      // Reset flags on manual search — try DB-first again
      setDeepProspectAttempted(false);
      fallbackStageRef.current = 0;
      if (!forceFullSearch) setDbOnly(true);
      // Snapshot original filters for progressive relaxation
      originalFiltersRef.current = { seniorities: new Set(seniorities), industries: new Set(industries) };
    }

    const effectiveSeniorities = filterOverrides?.seniorities ?? seniorities;
    const effectiveIndustries = filterOverrides?.industries ?? industries;
    // Validation: require at least one filter. Allow seniority-only or preferred_industries
    // (from fallback stages) to count as valid filters so the progressive fallback chain
    // doesn't get blocked when earlier stages removed all explicit filters.
    const hasPreferredIndustries = (filterOverrides?.preferredIndustries?.length ?? 0) > 0;
    const hasLocation = !!locationValue.country;
    if (!titles && !hasLocation && !keywords && effectiveIndustries.size === 0 && effectiveSeniorities.size === 0 && !hasPreferredIndustries && !forceFullSearch) {
      toast.error(t('apolloProSearch.toastEnterFilter'));
      return;
    }

    // ── Demo Mode: Return mock results ──
    if (isDemoMode) {
      console.log('[APOLLO DEMO] Returning demo results');
      setIsSearching(true);
      setResults([]);
      setStats(null);
      setSelectedIds(new Set());
      
      // Simulate loading
      setTimeout(() => {
        const demoLeads = DEMO_APOLLO_RESULTS.map(r => ({
          id: r.id,
          name: r.person_name,
          title: r.person_title,
          email: r.person_email,
          linkedin_url: r.person_linkedin,
          organization: {
            name: r.company_name,
            website_url: r.company_domain,
            industry: r.company_industry,
            employee_count: r.company_size,
            location: r.company_location,
          },
          email_status: r.confidence,
        }));
        
        setResults(demoLeads);
        setStats({
          total: demoLeads.length,
          with_email: demoLeads.length,
          verified_emails: demoLeads.filter(l => l.email_status === 'verified').length,
          likely_emails: demoLeads.filter(l => l.email_status === 'likely').length,
          guessed_emails: 0,
          with_phone: Math.round(demoLeads.length * 0.6),
          with_linkedin: Math.round(demoLeads.length * 0.85),
          unique_companies: new Set(demoLeads.map(l => l.organization?.name).filter(Boolean)).size,
          seniority_breakdown: {},
        });
        setIsSearching(false);
        setHasSearched(true);
        toast.success(t('apolloProSearch.toastFoundDecisionMakers', { count: demoLeads.length }));
      }, 800);
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Cancel any pending streamingMode-off timer from a previous search
    // to prevent it from prematurely hiding the progress display during auto-fallback
    if (streamingModeTimerRef.current) {
      clearTimeout(streamingModeTimerRef.current);
      streamingModeTimerRef.current = null;
    }

    setIsSearching(true);
    // Only clear results if it's a new user-initiated search or re-search
    if (!isAutoFallback) {
      setResults([]);
      setStats(null);
      setSelectedIds(new Set());
      setShowOnlyInArea(false);
      clearFinderCache(CACHE_KEYS.LEAD_FINDER_PEOPLE);
    }
    // Clear activity log + drip state on new user-initiated search
    if (!isAutoFallback) {
      setActivityLog([]);
      if (dripTimerRef.current) { clearTimeout(dripTimerRef.current); dripTimerRef.current = null; }
      pendingLeadsRef.current = [];
      renderedIdsRef.current = new Set();
      setFreshIds(new Set());
    }
    // Only fully clear phases on user-initiated searches.
    // On auto-fallback retries, keep phases visible to prevent
    // flickering/flashing — new SSE events will update them in-place.
    if (!isAutoFallback) {
      setPhases([]);
      setRevealedIds(new Set());
    } else {
      // Auto-fallback: add a "broadening" indicator phase so user sees activity
      const stage = fallbackStageRef.current;
      const broadenMsg = stage <= 1 ? t('apolloProSearch.expandingSearch')
        : stage <= 2 ? t('apolloProSearch.broadeningRemovingSeniority')
        : stage <= 3 ? t('apolloProSearch.broadeningRelaxingIndustry')
        : t('apolloProSearch.retryingBroaderCriteria');
      setPhases([{ phase: -1, name: broadenMsg, status: 'searching' as any }]);
    }
    setProgress(null);
    setStreamingMode(true);
    setIsPreviewMode(false);
    setIsCachedResult(false);
    setApolloTotalAvailable(null);
    setHasSearched(true);

    try {
      const headers = await getAuthHeaders();

      // ── Cold-start warm-up: ping the edge function to trigger initialization ──
      // Supabase Edge Functions may cold-start on first request. The SSE stream
      // is sensitive to cold-start timeouts, so we warm up with a lightweight ping first.
      // Use minimal headers (no Content-Type) to keep it a CORS "simple request" and
      // skip the OPTIONS preflight — shaves ~200ms off cold-start latency.
      const warmupUrl = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/deep-prospect/ping`;
      let warmupOk = false;
      try {
        const warmupHeaders: Record<string, string> = {};
        if (headers['Authorization']) warmupHeaders['Authorization'] = headers['Authorization'];
        const warmupResp = await fetch(warmupUrl, {
          headers: warmupHeaders,
          signal: AbortSignal.timeout(12000),
        });
        warmupOk = warmupResp.ok;
        console.log(`[APOLLO SSE] Edge function warm-up: status=${warmupResp.status}, ok=${warmupOk}`);
      } catch (warmupErr: any) {
        console.warn('[APOLLO SSE] Warm-up ping failed (proceeding anyway):', warmupErr.name, warmupErr.message);
      }

      const body: any = {
        max_results: maxResults,
        per_page: Math.min(maxResults, 100),
        ...(bypassCache ? { bypass_cache: true } : {}),
        ...(!forceFullSearch && dbOnly ? { db_only: true } : {}),
      };

      if (titles.trim()) {
        body.person_titles = titles.split(',').map(t => t.trim()).filter(Boolean);
      }
      const locationStrings = buildLocationStrings(locationValue);
      if (locationStrings.length > 0) {
        body.person_locations = locationStrings;
        body.organization_locations = locationStrings;
      }
      if (keywords.trim()) {
        body.q_keywords = keywords.trim();
      }
      if (effectiveSeniorities.size > 0) {
        body.person_seniorities = Array.from(effectiveSeniorities);
      }
      if (employeeRanges.size > 0) {
        body.organization_num_employees_ranges = Array.from(employeeRanges);
      }
      if (effectiveIndustries.size > 0) {
        body.organization_industries = Array.from(effectiveIndustries);
      }
      if (companyDomain.trim()) {
        body.q_organization_domains = [companyDomain.trim()];
      }
      // Progressive fallback hints: tell the backend to use these as SerpAPI query hints
      // (not strict filters) and to skip pool-satisfied shortcut for precise results
      if (filterOverrides?.preferredIndustries?.length) {
        body.preferred_industries = filterOverrides.preferredIndustries;
      }
      if (filterOverrides?.forceExternal) {
        body.force_external = true;
      }

      // ── SSE fetch with retry on network error (cold-start tolerance) ──
      const sseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/deep-prospect/search-stream`;
      const bodyJson = JSON.stringify(body);

      let response: Response;
      try {
        response = await fetch(sseUrl, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        // First attempt failed — retry once after delay with a fresh warm-up
        if (fetchErr.name === 'AbortError') throw fetchErr;
        console.warn(`[APOLLO SSE] First fetch failed (${fetchErr.name}): ${fetchErr.message} — retrying in 3s...`);

        // Fresh warm-up before retry to ensure the edge function is alive
        await new Promise(r => setTimeout(r, 1500));
        try {
          const retryWarmupHeaders: Record<string, string> = {};
          if (headers['Authorization']) retryWarmupHeaders['Authorization'] = headers['Authorization'];
          await fetch(warmupUrl, { headers: retryWarmupHeaders, signal: AbortSignal.timeout(10000) });
          console.log('[APOLLO SSE] Retry warm-up complete');
        } catch {
          console.warn('[APOLLO SSE] Retry warm-up also failed');
        }
        await new Promise(r => setTimeout(r, 1500));

        // Retry the actual SSE request
        response = await fetch(sseUrl, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal: controller.signal,
        });
      }

      // ── Retry on transient HTTP errors (502/503/504 = cold start / overload) ──
      if (response.status >= 502 && response.status <= 504) {
        console.warn(`[APOLLO SSE] Transient ${response.status} — warming up and retrying in 4s...`);
        await response.text().catch(() => {}); // drain body
        await new Promise(r => setTimeout(r, 2000));
        try {
          const retryWarmupHeaders: Record<string, string> = {};
          if (headers['Authorization']) retryWarmupHeaders['Authorization'] = headers['Authorization'];
          await fetch(warmupUrl, { headers: retryWarmupHeaders, signal: AbortSignal.timeout(10000) });
          console.log('[APOLLO SSE] 503-retry warm-up complete');
        } catch {
          console.warn('[APOLLO SSE] 503-retry warm-up failed');
        }
        await new Promise(r => setTimeout(r, 2000));
        response = await fetch(sseUrl, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let errMsg = `Search failed (${response.status})`;
        try {
          const errData = JSON.parse(errText);
          if (errData.error) errMsg = errData.error;
        } catch {
          if (errText) errMsg += `: ${errText.substring(0, 200)}`;
        }
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let receivedComplete = false;
      let receivedError = false;

      console.log('[APOLLO SSE] Stream connected, reading events...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log(`[APOLLO SSE] Received event: ${currentEvent}`, currentEvent === 'progress' ? data : '(data omitted)');
              switch (currentEvent) {
                case 'phase':
                  setPhases(prev => {
                    // Remove broadening indicator (phase -1) when real phases arrive
                    const filtered = data.phase >= 0 ? prev.filter(p => p.phase >= 0) : prev;
                    const idx = filtered.findIndex(p => p.phase === data.phase);
                    if (idx >= 0) {
                      const updated = [...filtered];
                      updated[idx] = { ...updated[idx], ...data };
                      return updated;
                    }
                    return [...filtered, data];
                  });
                  break;
                case 'progress':
                  setProgress(data);
                  break;
                case 'activity':
                  if (data.message) {
                    setActivityLog(prev => {
                      const next = [...prev, { id: ++activityIdRef.current, message: data.message, type: data.type || 'info', ts: Date.now(), _raw: data.message }];
                      return next.length > 50 ? next.slice(-50) : next; // Keep last 50
                    });

                  }
                  break;
                case 'people':
                  console.log(`[APOLLO SSE] Received ${data.people?.length || 0} people (partial=${data.partial})`);
                  if (data.people) {
                    const scored = data.people.map((p: ApolloLead) => ({ ...p, _lead_score: computeLeadScore(p) }));
                    
                    // Separate new leads from updates to existing leads
                    const newLeads: ApolloLead[] = [];
                    const updates = new Map<string, ApolloLead>();
                    
                    // Build a set of IDs already queued but not yet rendered
                    const pendingIds = new Set(pendingLeadsRef.current.map(p => p.id));
                    
                    for (const lead of scored) {
                      if (renderedIdsRef.current.has(lead.id) || pendingIds.has(lead.id)) {
                        updates.set(lead.id, lead);
                      } else {
                        newLeads.push(lead);
                      }
                    }

                    // Apply updates to existing rendered leads immediately
                    if (updates.size > 0) {
                      setResults(prev => prev.map(p => updates.has(p.id) ? updates.get(p.id)! : p));
                      
                      // Also update any pending leads in the queue
                      pendingLeadsRef.current = pendingLeadsRef.current.map(p => 
                        updates.has(p.id) ? updates.get(p.id)! : p
                      );
                    }

                    // Queue new leads for drip-feed animation
                    if (newLeads.length > 0) {
                      pendingLeadsRef.current.push(...newLeads);
                      startDrip();
                    }
                  }
                  break;
                case 'complete':
                  receivedComplete = true;
                  console.log(`[APOLLO SSE] Complete: ${data.people?.length || 0} total leads (preview=${data.preview}, cached=${data.cached}, total_available=${data.total_available}, requested=${data.requested})`);
                  if (data.people) {
                    const scored = data.people.map((p: ApolloLead) => ({ ...p, _lead_score: computeLeadScore(p) }));
                    flushDrip(scored); // Finalize — show all remaining at once
                    prefetchAvatars(data.people.map((p: any) => ({ email: p.email, linkedinUrl: p.linkedin_url, name: p.name })));
                  }
                  if (data.stats) setStats(data.stats);
                  if (data.existing_emails) {
                    setExistingEmails(new Set(data.existing_emails));
                  }
                  // Detect preview mode from response flag OR by checking individual leads
                  const hasPreviewFlag = data.preview || data.people?.some((p: any) => p._preview);
                  if (hasPreviewFlag) setIsPreviewMode(true);
                  else setIsPreviewMode(false);
                  if (data.cached) setIsCachedResult(true);
                  if (data.total_available != null) setApolloTotalAvailable(data.total_available);
                  if (data.people?.length > 0) {
                    const found = data.people.length;
                    const requested = data.requested || maxResults;
                    const totalAvail = data.total_available;
                    const withEmail = data.stats?.with_email || 0;
                    const withPhone = data.stats?.with_phone || 0;
                    const sources = data.stats?.enrichment_sources;
                    const isDbOnly = data.db_only || false;
                    const stage = fallbackStageRef.current;

                    // ── AUTO-EXPAND: db_only returned some but not enough leads ──
                    // When pool/DB returns < max_results, automatically trigger external
                    // scraping to find more leads. This is the key fix: previously only
                    // triggered on exactly 0 results, meaning pool results short-circuited
                    // the external scrape pipeline entirely.
                    if (isDbOnly && found < requested && stage === 0) {
                      console.log(`[FALLBACK] Stage 0→1: DB-only returned ${found}/${requested} — auto-expanding to external scrape`);
                      toast.info(t('apolloProSearch.toastSearchingMore', { count: found }), { duration: 3000 });
                      setDbOnly(false);
                      fallbackStageRef.current = 1;
                      if (!originalFiltersRef.current) {
                        originalFiltersRef.current = { seniorities: new Set(effectiveSeniorities), industries: new Set(effectiveIndustries) };
                      }
                      // Use ref to get latest handleSearch (avoids stale closure)
                      setTimeout(() => handleSearchRef.current(undefined, true, true, { seniorities: effectiveSeniorities, industries: effectiveIndustries, forceExternal: true }), 300);
                      break;
                    }

                    // ── PROGRESSIVE FALLBACK for insufficient results ──
                    // When external scrape returned few/no NEW leads beyond pool,
                    // and we haven't exhausted fallback stages, continue broadening.
                    // This fixes the "pooling 2 leads" bug: previously the fallback
                    // pipeline only ran when results were exactly 0, so pool-only
                    // results (>0 but <requested) would short-circuit the entire
                    // broadening chain.
                    const fromExternal = data.from_external ?? 0;
                    if (!isDbOnly && found < requested && stage >= 1 && stage < 4 && fromExternal < (requested - found)) {
                      const curSeniorities = effectiveSeniorities;
                      const curIndustries = effectiveIndustries;
                      const origIndustries = originalFiltersRef.current?.industries ?? curIndustries;
                      const origIndustriesArr = Array.from(origIndustries);

                      if (stage <= 1 && curSeniorities.size > 0) {
                        console.log(`[FALLBACK] Stage 1→2: External found ${fromExternal} new, total ${found}/${requested} — dropping seniority filters`);
                        toast.info(t('apolloProSearch.toastBroadeningSearch', { count: found }), { duration: 3000 });
                        fallbackStageRef.current = 2;
                        setSeniorities(new Set());
                        setTimeout(() => handleSearchRef.current(undefined, true, true, { seniorities: new Set(), industries: curIndustries, forceExternal: true }), 300);
                        break;
                      } else if (stage <= 2 && curIndustries.size > 0) {
                        console.log(`[FALLBACK] Stage 2→3: Still only ${found}/${requested} — relaxing industry filter`);
                        toast.info(t('apolloProSearch.toastRelaxingIndustry', { count: found }), { duration: 3000 });
                        fallbackStageRef.current = 3;
                        setIndustries(new Set());
                        const origArr = origIndustriesArr.length > 0 ? origIndustriesArr : undefined;
                        setTimeout(() => handleSearchRef.current(undefined, true, true, {
                          seniorities: new Set(),
                          industries: new Set(),
                          preferredIndustries: origArr,
                          forceExternal: true,
                        }), 300);
                        break;
                      }
                      // If all broadening stages exhausted, fall through to show what we have
                    }

                    let msg = t('apolloProSearch.toastFoundLeads', { count: found.toLocaleString() });
                    let description = t('apolloProSearch.toastEmailsPhones', { emails: withEmail, phones: withPhone });
                    if (sources) {
                      const vValid = sources.verified_valid || 0;
                      if (vValid > 0) description += ` · ${t('apolloProSearch.toastVerifiedCount', { count: vValid })}`;
                    }
                    // Explain when results are much less than requested
                    if (found < requested && totalAvail != null && totalAvail <= found) {
                      description = t('apolloProSearch.toastOnlyAvailable', { count: totalAvail.toLocaleString() });
                    } else if (data.cached && found < requested) {
                      description = t('apolloProSearch.toastClickReSearch');
                    }
                    toast.success(msg, { description, duration: 5000 });
                  } else {
                    // ── Progressive auto-fallback pipeline ──
                    // Stage 0 → 1: DB-only returned 0 → retry full search with all filters
                    // Stage 1 → 2: Full search returned 0 → drop seniority filters
                    // Stage 2 → 3: Still 0 → drop industry filters too
                    // Stage 3 → 4: Exhausted — show NoResultsState
                    const stage = fallbackStageRef.current;
                    const wasDbOnly = data.db_only || (stage === 0 && dbOnly);
                    // Capture current effective filters for override passing
                    const curSeniorities = effectiveSeniorities;
                    const curIndustries = effectiveIndustries;
                    // Compute original industries for preferred_industries hint
                    const origIndustries = originalFiltersRef.current?.industries ?? curIndustries;
                    const origIndustriesArr = Array.from(origIndustries);

                    if (wasDbOnly && stage === 0) {
                      console.log('[FALLBACK] Stage 0→1: DB-only returned 0 — expanding to full search');
                      toast.info(t('apolloProSearch.toastSearchingMatches'), { duration: 3000 });
                      setDbOnly(false);
                      fallbackStageRef.current = 1;
                      if (!originalFiltersRef.current) {
                        originalFiltersRef.current = { seniorities: new Set(curSeniorities), industries: new Set(curIndustries) };
                      }
                      setTimeout(() => handleSearchRef.current(undefined, true, true, { seniorities: curSeniorities, industries: curIndustries, forceExternal: true }), 300);
                    } else if (stage <= 1 && curSeniorities.size > 0) {
                      console.log('[FALLBACK] Stage 1→2: Full search returned 0 — removing seniority filters');
                      toast.info(t('apolloProSearch.toastRemovingSeniority'), { duration: 3000 });
                      fallbackStageRef.current = 2;
                      setSeniorities(new Set());
                      setTimeout(() => handleSearchRef.current(undefined, true, true, { seniorities: new Set(), industries: curIndustries, forceExternal: true }), 300);
                    } else if (stage <= 2 && curIndustries.size > 0) {
                      console.log('[FALLBACK] Stage 2→3: Still 0 — removing strict industry filter, keeping as search hint');
                      toast.info(t('apolloProSearch.toastRelaxingIndustryZero'), { duration: 3000 });
                      fallbackStageRef.current = 3;
                      setIndustries(new Set());
                      // Pass original industries as preferred_industries so SerpAPI still targets
                      // the right industry, but the backend won't apply a strict post-filter
                      setTimeout(() => handleSearchRef.current(undefined, true, true, {
                        seniorities: new Set(),
                        industries: new Set(),
                        preferredIndustries: origIndustriesArr.length > 0 ? origIndustriesArr : undefined,
                        forceExternal: true,
                      }), 300);
                    } else {
                      // Stage 4: All relaxations exhausted
                      fallbackStageRef.current = 4;
                      setDeepProspectAttempted(true);
                      // Restore original filters so the UI still shows what the user originally picked
                      if (originalFiltersRef.current) {
                        setSeniorities(originalFiltersRef.current.seniorities);
                        setIndustries(originalFiltersRef.current.industries);
                        originalFiltersRef.current = null;
                      }
                      toast.info(t('apolloProSearch.toastNoLeadsAfterBroadening'));
                    }
                  }
                  break;
                case 'warning':
                  console.warn('[DEEP PROSPECT] Warning:', data.code, data.message);
                  toast.warning(data.message || t('apolloProSearch.toastSearchWarning'), { duration: 6000 });
                  break;
                case 'error':
                  receivedError = true;
                  console.error('[DEEP PROSPECT] Search error:', data.error_code, data.message);
                  toast.error(data.message || t('apolloProSearch.toastSearchError'));
                  // Mark as exhausted so NoResultsState shows instead of empty table
                  fallbackStageRef.current = 4;
                  setDeepProspectAttempted(true);
                  break;
              }
            } catch (parseErr) {
              console.warn('[APOLLO SSE] Failed to parse SSE data for event:', currentEvent, parseErr);
            }
            currentEvent = '';
          }
        }
      }

      console.log(`[APOLLO SSE] Stream ended. complete=${receivedComplete}, error=${receivedError}`);

      // If the stream ended without a complete or error event, something went wrong
      if (!receivedComplete && !receivedError) {
        console.warn('[APOLLO SSE] Stream ended without complete or error event');
        toast.error(t('apolloProSearch.toastStreamEnded'));
        fallbackStageRef.current = 4;
        setDeepProspectAttempted(true);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      const errName = error.name || 'Error';
      const errMsg = error.message || String(error);
      console.error(`[APOLLO SSE] Search error (${errName}):`, errMsg, error.stack);
      const isNetworkError = errMsg.includes('network error') || errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('Load failed');
      const isCorsError = errMsg.includes('CORS') || errMsg.includes('cross-origin');
      const is503 = errMsg.includes('503') || errMsg.includes('Service Unavailable');
      const userMsg = isNetworkError
        ? t('apolloProSearch.toastConnectionFailed')
        : isCorsError
        ? t('apolloProSearch.toastCorsError')
        : is503
        ? t('apolloProSearch.toastServerUnavailable')
        : (errMsg || t('apolloProSearch.toastSearchFailed'));
      toast.error(userMsg, { description: isNetworkError ? `Technical: ${errName} — ${errMsg.substring(0, 100)}` : undefined, duration: 8000 });
      fallbackStageRef.current = 4;
      setDeepProspectAttempted(true);
    } finally {
      setIsSearching(false);
      // Use ref-tracked timer so auto-fallback retries can cancel it
      streamingModeTimerRef.current = setTimeout(() => {
        setStreamingMode(false);
        streamingModeTimerRef.current = null;
      }, 2000);
      // Refresh pool stats after search (pool grows with each search)
      fetchPoolStats();
    }
  };

  // Keep ref in sync so setTimeout fallbacks always call the latest version
  handleSearchRef.current = handleSearch;

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsSearching(false);
      setStreamingMode(false);
      // Flush any pending drip queue so remaining leads render immediately
      if (dripTimerRef.current) { clearTimeout(dripTimerRef.current); dripTimerRef.current = null; }
      if (pendingLeadsRef.current.length > 0) {
        const remaining = pendingLeadsRef.current.splice(0);
        remaining.forEach(l => renderedIdsRef.current.add(l.id));
        setResults(prev => [...prev, ...remaining]);
      }
      setFreshIds(new Set());
      toast.info(t('apolloProSearch.toastSearchCancelled'));
    }
  };

  const handleReSearch = () => {
    // Reset fallback pipeline so progressive relaxation can re-engage
    fallbackStageRef.current = 0;
    setDeepProspectAttempted(false);
    setDbOnly(true);
    originalFiltersRef.current = { seniorities: new Set(seniorities), industries: new Set(industries) };
    handleSearch(undefined, true);
  };

  // ── Reveal Selected (enrich-on-demand) ──
  const handleRevealSelected = async () => {
    const toReveal = results.filter(l => selectedIds.has(l.id) && (l as any)._preview && !revealedIds.has(l.id));
    if (toReveal.length === 0) {
      toast.info(t('apolloProSearch.toastAlreadyRevealed'));
      return;
    }

    setRevealing(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/apollo/reveal-selected`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ person_ids: toReveal.map(l => l.id) }),
        }
      );
      const data = await response.json();
      if (response.ok && data.people) {
        // Merge revealed data back into results
        const revealedMap = new Map<string, any>();
        for (const p of data.people) {
          revealedMap.set(p.id, p);
        }
        setResults(prev => prev.map(lead => {
          const revealed = revealedMap.get(lead.id);
          if (revealed) return { ...revealed, _preview: false };
          return lead;
        }));
        // Track revealed IDs
        setRevealedIds(prev => {
          const next = new Set(prev);
          for (const id of revealedMap.keys()) next.add(id);
          return next;
        });
        // Update stats with revealed data
        if (data.stats) {
          setStats(prev => prev ? {
            ...prev,
            verified_emails: (prev.verified_emails || 0) + (data.stats.verified || 0),
            with_email: (prev.with_email || 0),
          } : prev);
        }
        toast.success(t('apolloProSearch.toastRevealedContacts', { count: data.people.length, withEmail: data.stats?.with_email || 0 }));
      } else {
        toast.error(data.error || t('apolloProSearch.toastRevealFailed'));
      }
    } catch (error) {
      console.error('[APOLLO] Reveal error:', error);
      toast.error(t('apolloProSearch.toastFailedRevealContacts'));
    } finally {
      setRevealing(false);
    }
  };

  // ── Reveal All Hidden Preview Leads (banner button) ──
  // Routes leads to the correct endpoint based on source:
  // - Apollo leads (no "deep_" prefix) → /apollo/reveal-selected
  // - Deep-prospect leads ("deep_" prefix) → /deep-prospect/reveal-preview (Hunter/Findymail re-enrichment)
  const handleRevealHiddenLeads = async () => {
    const hidden = results.filter(l => {
      const isPreview = (l as any)._preview;
      const noEmail = !l.email?.trim() && !(l as any)._has_email;
      const hasName = (l.name || '').trim().length >= 3;
      const hasCompany = (l.organization?.name || '').trim().length >= 2;
      return (isPreview || noEmail) && hasName && hasCompany && !revealedIds.has(l.id);
    });
    if (hidden.length === 0) {
      toast.info(t('apolloProSearch.toastNoHiddenLeads'));
      return;
    }

    // Split by source: Apollo leads vs deep-prospect leads
    const apolloLeads = hidden.filter(l => !l.id.startsWith('deep_') && !l.id.startsWith('linkedin_enrich_'));
    const deepLeads = hidden.filter(l => l.id.startsWith('deep_') || l.id.startsWith('linkedin_enrich_'));

    setRevealing(true);
    try {
      const headers = await getAuthHeaders();
      const allRevealed: any[] = [];

      // ── Apollo leads: use Apollo reveal endpoint ──
      if (apolloLeads.length > 0) {
        try {
          const response = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/apollo/reveal-selected`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ person_ids: apolloLeads.map(l => l.id) }),
            }
          );
          const data = await response.json();
          if (response.ok && data.people) {
            allRevealed.push(...data.people);
          } else {
            console.warn('[REVEAL] Apollo reveal error:', data.error);
          }
        } catch (err) {
          console.error('[REVEAL] Apollo reveal failed:', err);
        }
      }

      // ── Deep-prospect leads: use Hunter/Findymail re-enrichment ──
      if (deepLeads.length > 0) {
        try {
          const response = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/deep-prospect/reveal-preview`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ leads: deepLeads }),
            }
          );
          const data = await response.json();
          if (response.ok && data.people) {
            allRevealed.push(...data.people);
          } else {
            console.warn('[REVEAL] Deep-prospect reveal error:', data.error);
          }
        } catch (err) {
          console.error('[REVEAL] Deep-prospect reveal failed:', err);
        }
      }

      if (allRevealed.length > 0) {
        // Merge revealed data back into results
        const revealedMap = new Map<string, any>();
        for (const p of allRevealed) {
          revealedMap.set(p.id, p);
        }
        setResults(prev => prev.map(lead => {
          const revealed = revealedMap.get(lead.id);
          if (revealed) return { ...revealed, _preview: !revealed.email };
          return lead;
        }));
        setRevealedIds(prev => {
          const next = new Set(prev);
          for (const id of revealedMap.keys()) next.add(id);
          return next;
        });

        const withEmail = allRevealed.filter((p: any) => p.email).length;
        toast.success(t('apolloProSearch.toastRevealedLeads', { count: allRevealed.length, withEmail }));
      } else {
        toast.info(t('apolloProSearch.toastNoAdditionalEmails'));
      }
    } catch (error) {
      console.error('[REVEAL] Reveal hidden leads error:', error);
      toast.error(t('apolloProSearch.toastFailedToReveal'));
    } finally {
      setRevealing(false);
    }
  };

  // ── Save to CRM ──
  const handleSaveToCRM = async () => {
    const toSave = filteredResults.filter(l => selectedIds.has(l.id) && hasUsableEmail(l));
    if (toSave.length === 0) {
      toast.error(t('apolloProSearch.toastNoValidLeads'));
      return;
    }
    const blockedCount = results.filter(l => selectedIds.has(l.id) && isGenericEmail(l.email || '')).length;
    if (blockedCount > 0) {
      toast.info(t('apolloProSearch.toastGenericFiltered', { count: blockedCount }), { duration: 3000 });
    }

    setSaving(true);
    try {
      const headers = await getAuthHeaders();

      // Batch in chunks of 100
      let totalSaved = 0;
      let totalSkipped = 0;
      let totalDnsBlocked = 0;

      for (let i = 0; i < toSave.length; i += 100) {
        const batch = toSave.slice(i, i + 100);
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/apollo/save-to-crm`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ leads: batch }),
          }
        );
        const data = await response.json();
        if (response.ok && data.results) {
          totalSaved += data.results.saved;
          totalSkipped += data.results.skipped;
          totalDnsBlocked += (data.results.blocked_dns || 0);
        } else if (response.status === 403 && data.error === 'LEAD_LIMIT_EXCEEDED') {
          console.warn('[APOLLO SAVE] Lead limit exceeded:', data);
          toast.error(t('apolloProSearch.toastLeadLimitReached'), {
            description: data.message || t('apolloProSearch.toastLeadLimitDesc'),
            duration: 6000,
            action: onUpgrade ? { label: t('apolloProSearch.toastUpgrade'), onClick: onUpgrade } : undefined,
          });
          if (onUpgrade) setTimeout(() => onUpgrade(), 1500);
          setSaving(false);
          return;
        }
      }

      const skipParts: string[] = [];
      if (totalSkipped > 0) skipParts.push(t('apolloProSearch.toastDuplicatesSkipped', { count: totalSkipped }));
      if (totalDnsBlocked > 0) skipParts.push(t('apolloProSearch.toastBadDomainsBlocked', { count: totalDnsBlocked }));
      const skipSuffix = skipParts.length > 0 ? ` (${skipParts.join(', ')})` : '';
      toast.success(t('apolloProSearch.toastSavedLeadsCrm', { count: totalSaved.toLocaleString() }) + skipSuffix);
      realtimeManager.emit('lead:created', { count: totalSaved, source: 'lead-finder' });
      setSelectedIds(new Set());

      // Update existing emails
      const newEmails = new Set(existingEmails);
      toSave.forEach(l => { if (l.email) newEmails.add(l.email.toLowerCase()); });
      setExistingEmails(newEmails);
    } catch (error) {
      toast.error(t('apolloProSearch.toastFailedToSaveLeads'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    const emailQualified = filteredResults.filter(l => {
      if (!hasUsableEmail(l)) return false;
      return !l.email || !existingEmails.has(l.email.toLowerCase());
    });
    if (emailQualified.length === 0) {
      toast.info(t('apolloProSearch.toastNoNewLeads'));
      return;
    }

    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      let totalSaved = 0;
      let totalSkipped = 0;
      let totalDnsBlocked = 0;

      for (let i = 0; i < emailQualified.length; i += 100) {
        const batch = emailQualified.slice(i, i + 100);
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/apollo/save-to-crm`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ leads: batch }),
          }
        );
        const data = await response.json();
        if (response.ok && data.results) {
          totalSaved += data.results.saved;
          totalSkipped += data.results.skipped;
          totalDnsBlocked += (data.results.blocked_dns || 0);
        } else if (response.status === 403 && data.error === 'LEAD_LIMIT_EXCEEDED') {
          console.warn('[APOLLO SAVE ALL] Lead limit exceeded:', data);
          toast.error(t('apolloProSearch.toastLeadLimitReached'), {
            description: data.message || t('apolloProSearch.toastLeadLimitDesc'),
            duration: 6000,
            action: onUpgrade ? { label: t('apolloProSearch.toastUpgrade'), onClick: onUpgrade } : undefined,
          });
          if (onUpgrade) setTimeout(() => onUpgrade(), 1500);
          setSaving(false);
          return;
        }
      }

      const skipParts: string[] = [];
      if (totalSkipped > 0) skipParts.push(t('apolloProSearch.toastDuplicatesSkipped', { count: totalSkipped }));
      if (totalDnsBlocked > 0) skipParts.push(t('apolloProSearch.toastBadDomainsBlocked', { count: totalDnsBlocked }));
      const skipSuffix = skipParts.length > 0 ? ` (${skipParts.join(', ')})` : '';
      toast.success(t('apolloProSearch.toastSavedLeads', { count: totalSaved.toLocaleString() }) + skipSuffix);
      realtimeManager.emit('lead:created', { count: totalSaved, source: 'deep-prospect' });

      const newEmails = new Set(existingEmails);
      emailQualified.forEach(l => { if (l.email) newEmails.add(l.email.toLowerCase()); });
      setExistingEmails(newEmails);
    } catch (error) {
      toast.error(t('apolloProSearch.toastFailedToSaveLeads'));
    } finally {
      setSaving(false);
    }
  };

  // ── CSV Export ──
  const handleExportCSV = () => {
    if (results.length === 0) return;

    const data = filteredResults.length > 0 ? filteredResults : results;
    const headers = [
      'Name', 'Title', 'Email', 'Email Status', 'Deliverability', 'Deliverability Score',
      'Phone', 'Phone Type', 'Phone 2', 'Phone 2 Type', 'LinkedIn',
      'Seniority', 'City', 'State', 'Country',
      'Company', 'Company Website', 'Company LinkedIn', 'Industry',
      'Employees', 'Revenue', 'Founded',
      'MX Valid', 'Disposable', 'Role Based', 'Free Provider'
    ];

    const rows = data.map(l => {
      const v = l.email_verification;
      return [
        cleanDisplayName(l.name),
        cleanDisplayTitle(l.title),
        l.email,
        l.email_status,
        v?.status || '',
        v?.score ?? '',
        l.phone_numbers?.[0]?.raw_number || '',
        l.phone_numbers?.[0]?.type || '',
        l.phone_numbers?.[1]?.raw_number || '',
        l.phone_numbers?.[1]?.type || '',
        l.linkedin_url,
        l.seniority,
        l.city,
        l.state,
        l.country,
        cleanDisplayCompany(l.organization?.name || ''),
        l.organization?.website_url || '',
        l.organization?.linkedin_url || '',
        l.organization?.industry || '',
        l.organization?.estimated_num_employees || '',
        l.organization?.annual_revenue_printed || '',
        l.organization?.founded_year || '',
        v?.mx_valid ? 'Yes' : (v ? 'No' : ''),
        v?.is_disposable ? 'Yes' : '',
        v?.is_role_based ? 'Yes' : '',
        v?.is_free_provider ? 'Yes' : '',
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(t('apolloProSearch.toastExportedLeads', { count: data.length.toLocaleString() }));
  };

  // ── Filtering & Sorting ──
  const filteredResults = useMemo(() => {
    // QUALITY GATE: main results must be usable contacts.
    // Local-business discovery can return callable owner/manager leads when a
    // personal email is unavailable, so allow a real phone number as contact.
    const initialCount = results.length;
    const filterReasons = { genericEmail: 0, roleBasedEmail: 0, noName: 0, noCompany: 0, noContact: 0 };
    let filtered = results.filter(l => {
      // Block generic/role-based emails (info@, sales@, etc.) — not decision makers
      if (l.email?.trim() && isGenericEmail(l.email)) { filterReasons.genericEmail++; return false; }
      if (l.email_verification?.is_role_based) { filterReasons.roleBasedEmail++; return false; }
      const name = (l.name || '').trim();
      const hasName = name.length >= 3 && name !== '—' && name !== '-';
      if (!hasName) { filterReasons.noName++; return false; }
      const companyName = (l.organization?.name || '').trim();
      const hasCompany = companyName.length >= 2 && companyName !== '—' && companyName !== '-';
      if (!hasCompany) { filterReasons.noCompany++; return false; }
      // Lead is actionable if there's any way to reach the person:
      // verified email, callable phone, OR a LinkedIn profile (which the
      // user can DM or use to run "Find email" later). The previous gate
      // dropped every tier-4 LinkedIn-only lead silently.
      if (!hasUsableEmail(l) && !hasCallablePhone(l) && !hasLinkedinProfile(l)) { filterReasons.noContact++; return false; }
      // DEDUPLICATE against CRM — never show leads the user already has (by email)
      if (l.email && existingEmails.has(l.email.toLowerCase())) return false;
      return true;
    });

    // Log quality gate filtering stats
    const qualityGateFiltered = initialCount - filtered.length;
    if (qualityGateFiltered > 0) {
      console.log(`[LEAD FINDER] Quality gate: ${initialCount} → ${filtered.length} leads (filtered ${qualityGateFiltered})`);
      console.log(`[LEAD FINDER] Filter reasons: genericEmail=${filterReasons.genericEmail}, roleBasedEmail=${filterReasons.roleBasedEmail}, noName=${filterReasons.noName}, noCompany=${filterReasons.noCompany}, noContact=${filterReasons.noContact}`);
    }

    // Text search
    if (resultSearch.trim()) {
      const q = resultSearch.toLowerCase();
      filtered = filtered.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.title.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.organization?.name?.toLowerCase().includes(q) ||
        l.city?.toLowerCase().includes(q)
      );
    }

    // Email filter
    if (emailFilter === 'verified') filtered = filtered.filter(l => l.email_status === 'verified' || l.email_verification?.status === 'valid');
    if (emailFilter === 'has_email') filtered = filtered.filter(l => !!l.email?.trim());
    if (emailFilter === 'no_email') filtered = filtered.filter(l => !l.email?.trim());

    // Location filter
    if (showOnlyInArea && searchLocationString) {
      const preLocationCount = filtered.length;
      filtered = filtered.filter(l => isLeadInArea(l, searchLocationString));
      const locationFiltered = preLocationCount - filtered.length;
      if (locationFiltered > 0) {
        console.log(`[LEAD FINDER] Location filter (${searchLocationString}) filtered ${locationFiltered} leads (${preLocationCount} → ${filtered.length})`);
      }
    }

    // Sort
    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'title': cmp = (a.title || '').localeCompare(b.title || ''); break;
        case 'company': cmp = (a.organization?.name || '').localeCompare(b.organization?.name || ''); break;
        case 'seniority': {
          const order = SENIORITY_OPTIONS.map(s => s.value);
          const aSen = (a.seniority && a.seniority !== 'unknown' ? a.seniority : '') || inferSeniorityFromTitle(a.title) || '';
          const bSen = (b.seniority && b.seniority !== 'unknown' ? b.seniority : '') || inferSeniorityFromTitle(b.title) || '';
          const aIdx = order.indexOf(aSen as SeniorityOption);
          const bIdx = order.indexOf(bSen as SeniorityOption);
          cmp = (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
          break;
        }
        case 'email_status': {
          const statusOrder: Record<string, number> = { verified: 0, guessed: 1, pattern_guessed: 2, unavailable: 3 };
          const aScore = a.email_verification?.score ?? 0;
          const bScore = b.email_verification?.score ?? 0;
          cmp = (statusOrder[a.email_status] ?? 4) - (statusOrder[b.email_status] ?? 4) || bScore - aScore;
          break;
        }
        case 'score': {
          cmp = (b._lead_score || 0) - (a._lead_score || 0); // Higher score first by default
          break;
        }
      }
      return sortAsc ? cmp : -cmp;
    });

    return filtered;
  }, [results, resultSearch, emailFilter, sortField, sortAsc, showOnlyInArea, searchLocationString, existingEmails]);

  // Count of preview/tier2 leads without email that are hidden from main results
  // These can be revealed via the "Reveal Emails" prompt
  const hiddenPreviewCount = useMemo(() => {
    return results.filter(l => {
      const isPreview = (l as any)._preview;
      const noEmail = !l.email?.trim() && !(l as any)._has_email;
      const hasName = (l.name || '').trim().length >= 3;
      const hasCompany = (l.organization?.name || '').trim().length >= 2;
      return (isPreview || noEmail) && hasName && hasCompany && !revealedIds.has(l.id);
    }).length;
  }, [results, revealedIds]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const selectAll = () => {
    if (selectedIds.size === filteredResults.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredResults.map(l => l.id)));
  };

  const handleNewSearch = () => {
    setResults([]);
    setStats(null);
    setHasSearched(false);
    setSelectedIds(new Set());
    setIsPreviewMode(false);
    setIsCachedResult(false);
    setApolloTotalAvailable(null);
    setActivityLog([]);
    setPhases([]);
    setProgress(null);
    setStreamingMode(false);
    setEmailFilter('all');
    setResultSearch('');
    setShowOnlyInArea(false);
    setFreshIds(new Set());
    setRevealedIds(new Set());
    pendingLeadsRef.current = [];
    renderedIdsRef.current = new Set();
    fallbackStageRef.current = 0;
    setDeepProspectAttempted(false);
    clearFinderCache(CACHE_KEYS.LEAD_FINDER_PEOPLE);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const progressPct = progress ? Math.round((progress.fetched / progress.total) * 100) : 0;
  const newLeadsCount = filteredResults.filter(l => hasUsableEmail(l) && (!l.email || !existingEmails.has(l.email.toLowerCase()))).length;

  // Extracted filter form for reuse in both sidebar and mobile sheet
  const renderFilterForm = () => (
    <form onSubmit={(e) => { e.preventDefault(); handleSearch(e); }} className="space-y-3.5">
      <ComboboxInput
        value={titles}
        onChange={setTitles}
        suggestions={TITLE_SUGGESTIONS}
        placeholder={t('leadFinder.jobTitlesPlaceholder')}
        icon={Briefcase}
        label={t('leadFinder.jobTitles')}
      />

      <LocationPicker
        value={locationValue}
        onChange={setLocationValue}
      />

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('leadFinder.keywordsOptional')}
        </label>
        <div className="relative">
          <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            placeholder={t('leadFinder.keywordsPlaceholder')}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all placeholder:text-zinc-400"
          />
        </div>
      </div>

      {companyDomain && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
            {t('leadFinder.companyDomain')}
          </label>
          <div className="relative">
            <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={companyDomain}
              onChange={e => setCompanyDomain(e.target.value)}
              placeholder={t('leadFinder.companyDomainPlaceholder')}
              className="w-full pl-8 pr-8 py-2 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-[#1ED4A7]/30 focus:border-[#1ED4A7]/50 outline-none transition-all placeholder:text-zinc-400 font-mono"
            />
            <button
              type="button"
              onClick={() => setCompanyDomain('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      <IndustrySelect
        selected={industries}
        onChange={setIndustries}
      />

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('leadFinder.seniorityLevel')}
        </label>
        <div className="flex flex-wrap gap-2 md:gap-1">
          {SENIORITY_OPTIONS.slice(0, 8).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleSeniority(opt.value)}
              className={`px-3 py-1.5 md:px-2 md:py-1 min-h-[32px] md:min-h-0 text-[11px] md:text-[10px] font-medium rounded-lg md:rounded-md border transition-all ${
                seniorities.has(opt.value)
                  ? 'border-[#1ED4A7]/40 bg-[#1ED4A7]/10 text-[#1ED4A7]'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('leadFinder.companySize')} <span className="text-zinc-400 normal-case">{t('apolloProSearch.companySizeOptional')}</span>
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
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('leadFinder.maxResults')}
        </label>
        <div className="grid grid-cols-4 gap-2 md:gap-1">
          {MAX_RESULTS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMaxResults(opt.value)}
              className={`flex items-center justify-center py-1.5 min-h-[32px] md:min-h-0 text-[11px] md:text-[10px] font-medium rounded-lg md:rounded-md border transition-all ${
                maxResults === opt.value
                  ? 'border-[#1ED4A7]/40 bg-[#1ED4A7]/10 text-[#1ED4A7]'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  );

  const renderSearchButton = () => (
    <button
      type="button"
      onClick={handleSearch}
      disabled={isSearching}
      className="w-full py-3.5 md:py-3 bg-zinc-900 text-white dark:bg-white dark:text-black font-semibold text-sm rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm active:scale-[0.98] md:rounded-lg md:shadow-md"
    >
      {isSearching ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{t('leadFinder.searching')} {progress ? `(${progress.fetched.toLocaleString()})` : ''}</span>
        </>
      ) : (
        <>
          <Sparkles className="w-3.5 h-3.5" />
          <span>{t('leadFinder.discoverLeads', { count: maxResults.toLocaleString() })}</span>
        </>
      )}
    </button>
  );

  // ── Render ──
  return (
    <div className="flex flex-col h-full bg-transparent px-4 sm:px-6 pt-3 pb-4">
      {/* ── Streaming Progress — hidden when LiveAgentFeed is the main view (no results yet) ── */}
      {streamingMode && (phases.length > 0 || progress) && (results.length > 0 || !isSearching) && (() => {
        const activePhase = phases.find(p => p.status === 'searching' || p.status === 'processing' || p.status === 'checking');
        const completedPhases = phases.filter(p => p.status === 'complete').length;
        const totalPhases = phases.length || 3;
        const phasePct = Math.round((completedPhases / totalPhases) * 100);

        return (
          <div className="flex-shrink-0 mb-4 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            {/* Top progress rail */}
            <div className="h-1 bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-[#1ED4A7] to-[#17a882] transition-all duration-700 ease-out"
                style={{ width: progress ? `${progressPct}%` : `${phasePct}%` }}
              />
            </div>

            <div className="px-4 md:px-6 py-3 space-y-2">
              {/* Active phase + stats */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {activePhase ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1ED4A7]" />
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{translatePhaseName(t, activePhase.name)}</span>
                    </>
                  ) : completedPhases === totalPhases ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7]" />
                      <span className="text-xs font-semibold text-[#1ED4A7]">{t('apolloProSearch.completeLabel')}</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1ED4A7]" />
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{t('apolloProSearch.processingLabel')}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {progress && (
                    <span className="text-[10px] font-mono text-zinc-400">
                      {t('apolloProSearch.leadsProgress', { fetched: progress.fetched.toLocaleString(), total: progress.total.toLocaleString() })}
                    </span>
                  )}
                  {isSearching && (
                    <button
                      onClick={handleCancel}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-500/10 rounded-md transition-colors"
                    >
                      <Pause className="w-2.5 h-2.5" /> {t('apolloProSearch.stopLabel')}
                    </button>
                  )}
                </div>
              </div>

              {/* Phase steps */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {phases.map((phase, i) => {
                  const isActive = phase.status === 'searching' || phase.status === 'processing' || phase.status === 'checking';
                  const isDone = phase.status === 'complete';
                  const isSkipped = phase.status === 'skipped';
                  return (
                    <div key={phase.phase} className="contents">
                      {i > 0 && <div className={`w-4 h-px flex-shrink-0 ${isDone ? 'bg-[#1ED4A7]/60' : isSkipped ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-zinc-200 dark:bg-zinc-800'}`} />}
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-md flex-shrink-0 text-[10px] font-medium transition-all ${
                        isActive ? 'bg-[#1ED4A7]/10 text-zinc-900 dark:text-zinc-100 ring-1 ring-[#1ED4A7]/30' :
                        isDone ? 'bg-[#1ED4A7]/5 text-[#1ED4A7]' :
                        isSkipped ? 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600 line-through' :
                        'bg-zinc-50 dark:bg-zinc-950 text-zinc-400 dark:text-zinc-600'
                      }`}>
                        {isActive && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        {isDone && <CheckCircle className="w-2.5 h-2.5" />}
                        {isSkipped && <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />}
                        {!isActive && !isDone && !isSkipped && <div className="w-2 h-2 rounded-full border border-zinc-300 dark:border-zinc-700" />}
                        <span className="whitespace-nowrap">
                          {translatePhaseName(t, phase.name)}
                          {!!(phase as any).pool_matches && ` (${(phase as any).pool_matches})`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Progress bar for fetch count */}
              {progress && (
                <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#1ED4A7]/60 to-[#1ED4A7] rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              )}

              {/* Live activity feed — shows what the agent is doing behind the scenes */}
              {activityLog.length > 0 && (
                <ActivityLogFeed entries={activityLog} isSearching={isSearching} />
              )}
            </div>
          </div>
        );
      })()}

      {/* Keyframes for agent feed + drip-feed lead animations */}
      <style>{agentFeedKeyframes}</style>

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
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('leadFinder.searching')} {progress ? `(${progress.fetched.toLocaleString()})` : ''}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t('leadFinder.discoverLeads', { count: maxResults.toLocaleString() })}</span>
                  </>
                )}
              </button>
            }
          >
            {renderFilterForm()}
          </MobileFilterSheet>
        </>
      )}

      {/* ── Main Layout ── */}
      <div className="flex-1 overflow-hidden flex min-h-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#050505]/80 dark:backdrop-blur-xl shadow-sm">
        {/* ── Sidebar / Filters ── Desktop Only */}
        <div className={`flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 transition-all duration-300 flex flex-col ${sidebarCollapsed ? 'w-0 md:w-12' : 'w-full md:w-[300px]'} ${results.length > 0 && !sidebarCollapsed ? 'hidden md:block md:flex' : ''}`}>
          {!sidebarCollapsed ? (
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 pb-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-zinc-800 dark:bg-white/10 flex items-center justify-center text-white">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('leadFinder.smartDiscovery')}</h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setShowSavedLists(!showSavedLists); loadSavedLists(); }}
                    className={`p-1.5 rounded-md transition-colors text-xs ${showSavedLists ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' : 'text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title={t('apolloProSearch.savedSearchesTitle')}
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors hidden md:flex"
                  >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                  </button>
                </div>
              </div>

              {/* Saved Lists Panel */}
              {showSavedLists && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('apolloProSearch.savedSearchesTitle')}</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {loadingLists ? (
                      <div className="p-3 text-center"><Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-zinc-400" /></div>
                    ) : savedLists.length === 0 ? (
                      <div className="p-3 text-xs text-zinc-400 text-center">{t('apolloProSearch.noSavedSearches')}</div>
                    ) : savedLists.map((list: any) => (
                      <div
                        key={list.id}
                        className="px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer flex items-center justify-between group transition-colors border-b border-zinc-200 dark:border-zinc-800 last:border-b-0"
                        onClick={() => handleLoadList(list.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <LayoutList className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{list.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-zinc-400">{t('apolloProSearch.leadsCount', { count: list.count })}</span>
                            <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" /> {new Date(list.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteList(list.id, e)}
                          className="p-1 text-zinc-400 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 rounded hover:bg-zinc-100 dark:hover:bg-zinc-500/10"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Form */}
              <div className="space-y-4">
                {renderFilterForm()}
                
                {/* Search Button */}
                <div className="pt-2 md:pt-0 pb-4 md:pb-0">
                  {renderSearchButton()}
                </div>
              </div>

              {/* Results Summary */}
              {stats && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      {t('leadFinder.searchResults')}
                    </span>
                    {isCachedResult && (
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-zinc-200/60 dark:bg-zinc-700/40 text-zinc-500 dark:text-zinc-400 text-[9px] font-bold rounded uppercase tracking-wider flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" /> {t('leadFinder.cached')}
                        </span>
                        <button
                          onClick={handleReSearch}
                          disabled={isSearching}
                          className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors flex items-center gap-0.5 disabled:opacity-50"
                        >
                          <RefreshCcw className="w-2.5 h-2.5" /> {t('leadFinder.reSearch')}
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Info banner when results significantly less than requested */}
                  {stats.total < maxResults && apolloTotalAvailable != null && (
                    <div className="mx-3 mb-2 p-2 rounded-md bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-700/50">
                      <p className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        <strong>{t('apolloProSearch.foundMatchingLeads', { count: apolloTotalAvailable.toLocaleString() })}</strong> {t('apolloProSearch.youRequestedCount', { count: maxResults.toLocaleString() })}.
                        {apolloTotalAvailable < maxResults && ` ${t('apolloProSearch.tryBroadeningFilters')}`}
                        {isCachedResult && ` ${t('apolloProSearch.clickReSearchBypass')}`}
                      </p>
                    </div>
                  )}
                  <div className="p-3 space-y-1.5">
                    <StatRow label={t('apolloProSearch.statTotalLeads')} value={stats.total.toLocaleString()} />
                    {apolloTotalAvailable != null && stats.total < maxResults && (
                      <StatRow label={t('apolloProSearch.statRequested')} value={maxResults.toLocaleString()} color="text-zinc-400" />
                    )}
                    <StatRow label={t('apolloProSearch.statWithEmail')} value={stats.with_email.toLocaleString()} highlight />
                    <StatRow label={t('apolloProSearch.statWithPhone')} value={stats.with_phone.toLocaleString()} />
                    <StatRow label={t('apolloProSearch.statWithLinkedIn')} value={stats.with_linkedin.toLocaleString()} />
                    <StatRow label={t('apolloProSearch.statUniqueCompanies')} value={stats.unique_companies.toLocaleString()} />
                    {filteredResults.length > 0 && (() => {
                      const avgScore = Math.round(filteredResults.reduce((sum, l) => sum + (l._lead_score || 0), 0) / filteredResults.length);
                      return <StatRow label={t('apolloProSearch.statAvgLeadScore')} value={`${avgScore}/100`} color={avgScore >= 80 ? 'text-[#1ED4A7] dark:text-[#1ED4A7]' : avgScore >= 60 ? 'text-zinc-300 dark:text-zinc-300' : avgScore >= 40 ? 'text-zinc-400 dark:text-zinc-400' : 'text-zinc-500 dark:text-zinc-400'} />;
                    })()}
                    {stats.enrichment_sources && (
                      <>
                        {(stats.enrichment_sources.verified_valid || 0) > 0 && (
                          <StatRow label={t('apolloProSearch.statVerifiedEmails')} value={(stats.enrichment_sources.verified_valid || 0).toLocaleString()} color="text-[#1ED4A7]" />
                        )}
                        {(stats.enrichment_sources.verified_risky || 0) > 0 && (
                          <StatRow label={t('apolloProSearch.statUnverifiedEmails')} value={(stats.enrichment_sources.verified_risky || 0).toLocaleString()} color="text-zinc-400" />
                        )}
                        {(stats.enrichment_sources.phone_verified || 0) > 0 && (
                          <StatRow label={t('apolloProSearch.statVerifiedPhones')} value={(stats.enrichment_sources.phone_verified || 0).toLocaleString()} color="text-[#1ED4A7]" />
                        )}
                        {(stats.enrichment_sources.mobile_confirmed || 0) > 0 && (
                          <StatRow label={t('apolloProSearch.statMobileNumbers')} value={(stats.enrichment_sources.mobile_confirmed || 0).toLocaleString()} color="text-zinc-600 dark:text-zinc-300" />
                        )}
                      </>
                    )}
                    {/* CRM duplicates are filtered from results entirely — no stat row needed */}
                    {Object.keys(teamContacts).length > 0 && (
                      <StatRow label={t('apolloProSearch.statTeamContacted')} value={`${results.filter(l => l.email && teamContacts[l.email.toLowerCase()]).length}`} color="text-zinc-400" />
                    )}

                    {/* Actions */}
                    <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
                      {newLeadsCount > 0 && (
                        <button
                          onClick={handleSaveAll}
                          disabled={saving}
                          className="w-full py-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white dark:bg-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                          {t('apolloProSearch.saveAllToCrm', { count: newLeadsCount.toLocaleString() })}
                        </button>
                      )}
                      <button
                        onClick={() => setShowSaveDialog(true)}
                        className="w-full py-1.5 text-xs font-medium rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Bookmark className="w-3 h-3" />
                        {t('apolloProSearch.saveSearchResultsBtn')}
                      </button>
                      <button
                        onClick={handleExportCSV}
                        className="w-full py-1.5 text-xs font-medium rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3 h-3" />
                        {t('apolloProSearch.exportCsvCount', { count: results.length.toLocaleString() })}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="hidden md:flex flex-col items-center py-3 gap-2">
              <button onClick={() => setSidebarCollapsed(false)} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <ChevronDown className="w-3.5 h-3.5 rotate-90" />
              </button>
              <button onClick={() => setSidebarCollapsed(false)} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Top Action Bar */}
          {results.length > 0 && (
            <div className={`flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-[#050505]/95 backdrop-blur-md z-10 sticky top-0 ${headerClass}`}>
              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Mobile: back to filters */}
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="md:hidden p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0"
                    title="Search filters"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
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
                    {selectedIds.size > 0 ? t('apolloProSearch.selectedCount', { count: selectedIds.size }) : t('apolloProSearch.leadsLabel', { count: filteredResults.length })}
                  </span>

                  {/* Search */}
                  <div className="relative hidden md:block max-w-[240px]">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                    <input
                      type="text"
                      value={resultSearch}
                      onChange={e => setResultSearch(e.target.value)}
                      placeholder={t('apolloProSearch.searchResultsPlaceholder')}
                      className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md focus:ring-1 focus:ring-[#1ED4A7]/30 outline-none transition-all placeholder:text-zinc-400"
                    />
                  </div>

                  {/* Email Filter */}
                  <div className="hidden md:flex items-center gap-1">
                    {(['all', 'verified', 'has_email', 'no_email'] as const).map(opt => {
                      const disabled = false;
                      return (
                        <button
                          key={opt}
                          onClick={() => !disabled && setEmailFilter(opt)}
                          className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                            disabled ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed' :
                            emailFilter === opt
                              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {opt === 'all' ? t('apolloProSearch.filterAll') : opt === 'verified' ? t('apolloProSearch.filterVerified') : opt === 'has_email' ? t('apolloProSearch.filterHasEmail') : t('apolloProSearch.filterNoEmail')}
                        </button>
                      );
                    })}
                  </div>

                  {/* Location Area Filter — count uses filteredResults for consistency with displayed leads */}
                  {searchLocationString && filteredResults.length > 0 && (() => {
                    const inAreaCount = filteredResults.filter(l => isLeadInArea(l, searchLocationString)).length;
                    const outCount = filteredResults.filter(l => (l.city || l.state) && !isLeadInArea(l, searchLocationString)).length;
                    if (inAreaCount === 0 && outCount === 0) return null;
                    return (
                      <button
                        onClick={() => setShowOnlyInArea(!showOnlyInArea)}
                        className={`hidden md:flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-all ${
                          showOnlyInArea
                            ? 'bg-[#1ED4A7]/15 text-[#1ED4A7]'
                            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                        title={showOnlyInArea ? t('apolloProSearch.filterAll') : t('apolloProSearch.countInArea', { count: inAreaCount })}
                      >
                        <MapPin className="w-3 h-3" />
                        {showOnlyInArea ? t('apolloProSearch.inAreaCount', { count: inAreaCount }) : t('apolloProSearch.countInArea', { count: inAreaCount })}
                        {outCount > 0 && !showOnlyInArea && <span className="text-zinc-300 dark:text-zinc-600 ml-0.5">· {t('apolloProSearch.otherCount', { count: outCount })}</span>}
                      </button>
                    );
                  })()}
                </div>

                {/* Right Actions — desktop only (mobile uses fixed bottom bar) */}
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={handleNewSearch}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                    title={t('apolloProSearch.newSearch')}
                  >
                    <Search className="w-3 h-3" /> {t('apolloProSearch.newSearch')}
                  </button>
                  {isCachedResult && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="px-1.5 py-0.5 bg-zinc-200/60 dark:bg-zinc-700/40 text-zinc-500 dark:text-zinc-400 text-[9px] font-bold rounded uppercase tracking-wider inline-flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" /> {t('apolloProSearch.cachedLabel')}
                      </span>
                      <button
                        onClick={handleReSearch}
                        disabled={isSearching}
                        className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors inline-flex items-center gap-0.5 disabled:opacity-50"
                      >
                        <RefreshCcw className="w-2.5 h-2.5" /> {t('apolloProSearch.reSearchLabel')}
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => setShowSaveDialog(true)}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                    title={t('apolloProSearch.saveDialogTitle')}
                  >
                    <Bookmark className="w-3 h-3" /> {t('apolloProSearch.saveLabel')}
                  </button>
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                  >
                    <Download className="w-3 h-3" /> {t('apolloProSearch.csvLabel')}
                  </button>
                  {/* Reveal button removed — all contact info shown inline */}
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleSaveToCRM}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white dark:bg-white dark:text-black text-xs font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all disabled:opacity-50 shadow-sm"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                      {t('apolloProSearch.saveToCrm', { count: selectedIds.size })}
                    </button>
                  )}
                </div>


              </div>
            </div>
          )}

          {/* Mobile filter chips */}
          {results.length > 0 && (
            <div className="md:hidden flex-shrink-0 flex items-center gap-1 px-4 py-1.5 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
              {(['all', 'verified', 'has_email', 'no_email'] as const).map(opt => {
                const disabled = false;
                return (
                  <button
                    key={opt}
                    onClick={() => !disabled && setEmailFilter(opt)}
                    className={`px-2 py-1 text-[10px] font-medium rounded-md whitespace-nowrap transition-all ${
                      disabled ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed' :
                      emailFilter === opt
                        ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {opt === 'all' ? t('apolloProSearch.filterAll') : opt === 'verified' ? t('apolloProSearch.filterVerified') : opt === 'has_email' ? t('apolloProSearch.filterHasEmail') : t('apolloProSearch.filterNoEmail')}
                  </button>
                );
              })}
              {/* Mobile location filter — count uses filteredResults for consistency */}
              {searchLocationString && (() => {
                const inAreaCount = filteredResults.filter(l => isLeadInArea(l, searchLocationString)).length;
                if (inAreaCount === 0) return null;
                return (
                  <button
                    onClick={() => setShowOnlyInArea(!showOnlyInArea)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md whitespace-nowrap transition-all ${
                      showOnlyInArea
                        ? 'bg-[#1ED4A7]/15 text-[#1ED4A7]'
                        : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <MapPin className="w-2.5 h-2.5" />
                    {showOnlyInArea ? t('apolloProSearch.inAreaCount', { count: inAreaCount }) : t('apolloProSearch.countInArea', { count: inAreaCount })}
                  </button>
                );
              })()}
            </div>
          )}

          {/* ── Results Table ── */}
          <div ref={mainScrollRef} className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
            {results.length === 0 && !isSearching && !hasSearched ? (
              <ApolloEmptyState />
            ) : results.length === 0 && !isSearching && hasSearched && (fallbackStageRef.current >= 4 || deepProspectAttempted) ? (
              <NoResultsState
                titles={titles}
                location={locationValue.country}
                keywords={keywords}
                autoEnabled={false}
                onBroaden={() => {
                  // Nuclear option: clear all restrictive filters, full external search
                  setDeepProspectAttempted(true);
                  setDbOnly(false);
                  fallbackStageRef.current = 4;
                  setSeniorities(new Set());
                  setIndustries(new Set());
                  const origInd = originalFiltersRef.current?.industries;
                  const prefInd = origInd && origInd.size > 0 ? Array.from(origInd) : undefined;
                  setTimeout(() => handleSearchRef.current(undefined, true, true, { seniorities: new Set(), industries: new Set(), preferredIndustries: prefInd, forceExternal: true }), 100);
                }}
                onReSearch={() => {
                  const origInd = originalFiltersRef.current?.industries;
                  const prefInd = origInd && origInd.size > 0 ? Array.from(origInd) : undefined;
                  handleSearchRef.current(undefined, true, true, { seniorities: new Set(), industries: new Set(), preferredIndustries: prefInd, forceExternal: true });
                }}
              />
            ) : results.length === 0 && (isSearching || (hasSearched && fallbackStageRef.current > 0 && fallbackStageRef.current < 4)) ? (
              <LiveAgentFeed
                entries={activityLog}
                isSearching={isSearching}
                phases={phases}
                progress={progress}
              />
            ) : (
              <div className="min-w-0">
                {/* Compact live activity strip — visible while searching + leads are appearing */}
                {isSearching && activityLog.length > 0 && (
                  <div className="flex items-center gap-2.5 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950">
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] animate-pulse" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">{t('apolloProSearch.agentLabel')}</span>
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {activityLog[activityLog.length - 1]?.message}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums flex-shrink-0">
                      {t('apolloProSearch.foundCount', { count: results.length })}
                    </span>
                  </div>
                )}
                {/* Team collision warning banner */}
                {Object.keys(teamContacts).length > 0 && (() => {
                  const contactedCount = results.filter(l => l.email && teamContacts[l.email.toLowerCase()]).length;
                  return contactedCount > 0 ? (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-500/5 border-b border-zinc-500/10">
                      <AlertTriangle className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span className="text-[12px] text-zinc-400 font-medium">
                        {t('apolloProSearch.teamContactedBanner', { count: contactedCount })}
                      </span>
                      <span className="hidden sm:inline text-[11px] text-zinc-400/60">
                        {t('apolloProSearch.hoverBadgesDetails')}
                      </span>
                    </div>
                  ) : null;
                })()}

                {/* All leads now shown inline — no hidden preview banner needed */}

                {/* Table Header */}
                <div className="sticky top-0 z-10 bg-zinc-50/80 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 hidden md:grid md:grid-cols-[40px_1fr_0.8fr_minmax(0,1.3fr)_56px_60px] items-center px-4 py-2">
                  <div /> {/* checkbox */}
                  <SortHeader label={t('apolloProSearch.personHeader')} field="name" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <SortHeader label={t('apolloProSearch.companyHeader')} field="company" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('apolloProSearch.contactHeader')}</span>
                  <SortHeader label={t('apolloProSearch.scoreHeader')} field="score" current={sortField} asc={sortAsc} onSort={toggleSort} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 text-right pr-1">{t('apolloProSearch.linksHeader')}</span>
                </div>

                {/* Table Rows — each dripped-in lead gets a slide + highlight animation */}
                {filteredResults.map((lead) => (
                  <div
                    key={lead.id}
                    style={freshIds.has(lead.id)
                      ? { animation: 'leadRowIn 0.35s cubic-bezier(0.16,1,0.3,1) both, leadRowHighlight 0.8s ease-out both' }
                      : undefined
                    }
                  >
                    <LeadRow
                      lead={lead}
                      selected={selectedIds.has(lead.id)}
                      inCRM={!!(lead.email && existingEmails.has(lead.email.toLowerCase()))}
                      teamOutreach={lead.email ? teamContacts[lead.email.toLowerCase()] : undefined}
                      onToggleSelect={() => toggleSelect(lead.id)}
                      selectedIndustries={industries}
                      searchLocation={searchLocationString || undefined}
                    />
                  </div>
                ))}

                {/* Load more indicator */}
                {isSearching && results.length > 0 && (
                  <div className="flex items-center justify-center gap-2 py-4 border-t border-zinc-200 dark:border-zinc-800">
                    <Loader2 className="w-4 h-4 animate-spin text-[#1ED4A7]" />
                    <span className="text-xs text-zinc-500">{t('apolloProSearch.loadingMoreLeads', { count: results.length })}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Spacer for fixed mobile bottom bar */}
          {results.length > 0 && <div className="md:hidden h-24 flex-shrink-0" />}
        </div>
      </div>

      {/* Mobile Bottom Action Bar — fixed to always be visible */}
      {results.length > 0 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-[60] border-t border-zinc-200 dark:border-zinc-800 bg-white/98 dark:bg-[#0a0a0a]/98 backdrop-blur-xl px-4 py-3 pb-[max(1rem,calc(0.75rem+env(safe-area-inset-bottom,16px)))] shadow-[0_-4px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.4)]">
          <div className="flex items-center gap-2">
            {/* New Search */}
            <button
              onClick={handleNewSearch}
              className="flex items-center justify-center gap-1.5 h-11 px-4 border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 text-sm font-medium rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all flex-shrink-0"
            >
              <Search className="w-4 h-4" />
              <span>{t('apolloProSearch.newSearch')}</span>
            </button>
            {/* Reveal button removed — all contact info shown inline */}
            <button
              onClick={handleExportCSV}
              className="flex items-center justify-center gap-1.5 px-4 h-11 border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 text-sm font-medium rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all flex-shrink-0"
            >
              <Download className="w-4 h-4" />
            </button>
            {selectedIds.size > 0 ? (
              <button
                onClick={handleSaveToCRM}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 h-11 bg-zinc-900 text-white dark:bg-white dark:text-black text-sm font-semibold rounded-xl disabled:opacity-50 shadow-sm transition-colors active:scale-[0.98]"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {t('apolloProSearch.saveToCrm', { count: selectedIds.size })}
              </button>
            ) : (
              <button
                onClick={handleSaveAll}
                disabled={saving || newLeadsCount === 0}
                className="flex-1 flex items-center justify-center gap-2 h-11 bg-zinc-900 text-white dark:bg-white dark:text-black text-sm font-semibold rounded-xl disabled:opacity-50 shadow-sm transition-colors active:scale-[0.98]"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {t('apolloProSearch.saveAllToCrm', { count: newLeadsCount })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Save Search Dialog ── */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowSaveDialog(false)}>
          <div
            className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-sm p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <Bookmark className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('apolloProSearch.saveDialogTitle')}</h3>
                <p className="text-[11px] text-zinc-500">{t('apolloProSearch.leadsWillBeSaved', { count: results.length })}</p>
              </div>
            </div>
            <input
              type="text"
              value={saveListName}
              onChange={e => setSaveListName(e.target.value)}
              placeholder={`Smart Discovery — ${new Date().toLocaleDateString()}`}
              className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-zinc-400/30 focus:border-zinc-400 outline-none transition-all placeholder:text-zinc-400 mb-4"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSaveSearchResults(); }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="flex-1 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                {t('apolloProSearch.cancelLabel')}
              </button>
              <button
                onClick={handleSaveSearchResults}
                disabled={savingList}
                className="flex-1 py-2 text-xs font-medium rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {savingList ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3" />}
                {t('apolloProSearch.saveLabel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function StatRow({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xs font-semibold ${color || (highlight ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-zinc-100')}`}>{value}</span>
    </div>
  );
}

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

function LeadRow({ lead, selected, inCRM, teamOutreach, onToggleSelect, selectedIndustries, searchLocation }: {
  lead: ApolloLead; selected: boolean; inCRM: boolean; teamOutreach?: { contacted_by: string; campaign_name: string; sent_at: string; is_you: boolean }[]; onToggleSelect: () => void; selectedIndustries?: Set<string>; searchLocation?: string;
}) {
  const { t } = useTranslation();
  const hasTeamOutreach = teamOutreach && teamOutreach.length > 0;
  const inArea = searchLocation ? isLeadInArea(lead, searchLocation) : false;
  const hasLocation = !!(lead.city || lead.state || lead.country);
  const outOfArea = searchLocation && hasLocation && !inArea;
  return (
    <div className={`border-b border-zinc-200 dark:border-zinc-800 transition-colors ${hasTeamOutreach ? 'bg-zinc-500/[0.03]' : selected ? 'bg-[#1ED4A7]/[0.03]' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30'} ${outOfArea ? 'opacity-60 hover:opacity-100' : ''}`}>
      {/* Desktop */}
      <div className="hidden md:grid md:grid-cols-[40px_1fr_0.8fr_minmax(0,1.3fr)_56px_60px] items-center px-4 py-2.5">
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

        {/* Person */}
        <div className="min-w-0 flex items-center gap-2.5">
          <LeadAvatar name={lead.name} email={lead.email} linkedinUrl={lead.linkedin_url} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{cleanDisplayName(lead.name)}</span>
              <SeniorityBadge seniority={lead.seniority} title={lead.title} />
              {inCRM && <span className="px-1.5 py-0.5 bg-[#1ED4A7]/10 text-[#1ED4A7] text-[9px] rounded font-bold uppercase tracking-wider flex-shrink-0">{t('apolloProSearch.inCrmBadge')}</span>}
              {hasTeamOutreach && (
                <span className="group/tip relative inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-500/10 text-zinc-400 text-[9px] rounded font-bold uppercase tracking-wider border border-zinc-500/20 flex-shrink-0 cursor-help">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {t('apolloProSearch.teamBadge')}
                  <span className="absolute bottom-full left-0 mb-2 hidden group-hover/tip:block z-30 pointer-events-none">
                    <span className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl block whitespace-nowrap">
                      {teamOutreach!.slice(0, 3).map((o, i) => (
                        <span key={i} className="block text-[10px] text-zinc-300">
                          <span className="font-medium text-zinc-200">{o.is_you ? t('apolloProSearch.youLabel') : o.contacted_by}</span>
                          {` ${t('apolloProSearch.viaLabel')} `}
                          <span className="text-white">{o.campaign_name}</span>
                          {' · '}
                          {new Date(o.sent_at).toLocaleDateString()}
                        </span>
                      ))}
                      {teamOutreach!.length > 3 && (
                        <span className="block text-[10px] text-zinc-500 mt-0.5">{t('apolloProSearch.moreCount', { count: teamOutreach!.length - 3 })}</span>
                      )}
                    </span>
                  </span>
                </span>
              )}
            </div>
            <span className={`text-xs truncate block ${lead.title ? 'text-zinc-500' : 'text-zinc-400 dark:text-zinc-600 italic'}`}>
              {cleanTitleForDisplay(lead.name, lead.title) || (lead.seniority && lead.seniority !== 'unknown' ? toTitleCase(lead.seniority.replace(/_/g, ' ')) : '—')}
            </span>
          </div>
        </div>

        {/* Company */}
        <div className="min-w-0 flex items-start gap-2">
          <CompanyLogo
            domain={lead.organization?.website_url}
            companyName={lead.organization?.name}
            linkedinUrl={lead.organization?.linkedin_url}
            size={28}
            className="mt-0.5"
          />
          <div className="min-w-0 space-y-0.5">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate block">{cleanDisplayCompany(lead.organization?.name || '') || '—'}</span>
            {/* Industry */}
            <div className="flex items-center gap-1.5">
              <Factory className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
              {lead.organization?.industry ? (
                <span className="text-[10px] leading-tight truncate text-zinc-500 dark:text-zinc-400">{toTitleCase(lead.organization.industry)}</span>
              ) : (
                <span className="text-[10px] text-zinc-300 dark:text-zinc-600 italic">{t('apolloProSearch.noIndustry')}</span>
              )}
            </div>
            {/* Employees · Revenue */}
            <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500">
              <span className="flex items-center gap-0.5 flex-shrink-0">
                <Users className="w-2.5 h-2.5" />
                {Number(lead.organization?.estimated_num_employees) > 0
                  ? formatEmployeeCount(Number(lead.organization.estimated_num_employees))
                  : '—'}
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className="flex-shrink-0">
                {lead.organization?.annual_revenue_printed
                  ? formatRevenue(lead.organization.annual_revenue_printed)
                  : '—'}
              </span>
            </div>
            {/* Location */}
            {(lead.city || lead.organization?.city || lead.country || lead.organization?.country) && (
              <div className="flex items-center gap-1">
                <MapPin className={`w-2.5 h-2.5 flex-shrink-0 ${inArea ? 'text-[#1ED4A7]' : 'text-zinc-400'}`} />
                <span className={`text-[10px] truncate ${inArea ? 'text-[#1ED4A7] font-semibold' : 'text-zinc-400'}`}>{[lead.city || lead.organization?.city, lead.state || lead.organization?.state, lead.country || lead.organization?.country].filter(Boolean).join(', ')}</span>
                {inArea && (
                  <span className="flex-shrink-0 text-[7px] font-bold px-1 py-0.5 rounded bg-[#1ED4A7]/15 text-[#1ED4A7]">{t('apolloProSearch.inAreaBadge')}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Contact — stacked email + phone */}
        <div className="flex flex-col gap-1.5 min-w-0">
          {/* Email row */}
          <div className="flex items-center gap-2 min-w-0 h-5 group">
            {lead.email ? (
              <>
                <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                <code className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate font-mono">{lead.email}</code>
                <EmailBadge status={lead.email_status} verification={lead.email_verification} />
                <button
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(lead.email); toast.success(t('apolloProSearch.emailCopied')); }}
                  className="p-0.5 text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </>
            ) : (
              <span className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-600">
                <Mail className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" /> —
              </span>
            )}
          </div>
          {/* Phone row */}
          <div className="flex items-center gap-2 min-w-0 h-5 group">
            {lead.phone_numbers?.[0]?.raw_number ? (
              <div className="flex items-center gap-2 min-w-0">
                <SmartPhoneButton
                  phone={lead.phone_numbers[0].raw_number}
                  leadName={lead.first_name ? `${lead.first_name} ${lead.last_name || ''}`.trim() : undefined}
                  businessName={lead.organization?.name}
                  leadId={lead.id}
                  showNumber
                  displayNumber={formatPhoneNumber(lead.phone_numbers[0].raw_number)}
                  iconClassName="w-3.5 h-3.5"
                  numberClassName="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate"
                />
                {lead.phone_numbers[0].type && ['mobile', 'direct', 'work', 'company'].includes(lead.phone_numbers[0].type) && (
                  <span className="text-[9px] font-medium px-1 py-0.5 rounded flex-shrink-0 bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">{lead.phone_numbers[0].type}</span>
                )}
              </div>
            ) : (
              <span className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-600">
                <Phone className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" /> —
              </span>
            )}
          </div>
        </div>

        {/* Score */}
        <div className="flex items-center justify-center">
          {lead._lead_score != null ? (
            <LeadScoreBadge score={lead._lead_score} size="sm" showLabel={false} />
          ) : null}
        </div>

        {/* Links */}
        <div className="flex items-center justify-end gap-0.5">
          {lead.linkedin_url && (
            <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-[#0077B5] rounded transition-colors">
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          )}
          {lead.organization?.website_url && (
            <a href={lead.organization.website_url.startsWith('http') ? lead.organization.website_url : `https://${lead.organization.website_url}`} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 rounded transition-colors">
              <Globe className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden px-3 py-3">
        <div className="flex items-start gap-2.5">
          <div onClick={onToggleSelect} className="pt-0.5">
            <div
              className={`rounded border cursor-pointer flex items-center justify-center transition-all p-0 ${selected ? 'bg-[#1ED4A7] border-[#1ED4A7] text-black' : 'border-zinc-300 dark:border-zinc-700'}`}
              style={{ width: 18, height: 18, minWidth: 18, minHeight: 18, maxWidth: 18, maxHeight: 18 }}
            >
              {selected && <Check className="w-3 h-3" />}
            </div>
          </div>
          <LeadAvatar name={lead.name} email={lead.email} linkedinUrl={lead.linkedin_url} size={36} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            {/* Name + Badges */}
            <div className="flex items-start gap-1.5 mb-1 flex-wrap">
              <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100 leading-tight break-words">{cleanDisplayName(lead.name)}</h3>
              <div className="flex items-center gap-1 flex-shrink-0">
                {lead._lead_score != null && <LeadScoreBadge score={lead._lead_score} size="sm" showLabel={false} />}
                <SeniorityBadge seniority={lead.seniority} title={lead.title} />
              </div>
            </div>

            {/* Second row: Title + Status badges */}
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <p className={`text-[12px] leading-tight ${lead.title ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-600 italic'}`}>
                {cleanTitleForDisplay(lead.name, lead.title) || (lead.seniority && lead.seniority !== 'unknown' ? toTitleCase(lead.seniority.replace(/_/g, ' ')) : '—')}
              </p>
              {inCRM && <span className="px-1.5 py-0.5 bg-[#1ED4A7]/10 text-[#1ED4A7] text-[8px] rounded font-bold uppercase flex-shrink-0">CRM</span>}
              {hasTeamOutreach && (
                <span className="px-1.5 py-0.5 bg-zinc-500/10 text-zinc-400 text-[8px] rounded font-bold uppercase flex-shrink-0 inline-flex items-center gap-0.5">
                  <AlertTriangle className="w-2 h-2" /> {t('apolloProSearch.teamBadge')}
                </span>
              )}
            </div>

            {/* Company */}
            {lead.organization?.name && (
              <div className="text-[12px] text-zinc-600 dark:text-zinc-400 mb-1 flex items-center gap-1.5">
                <CompanyLogo domain={lead.organization?.website_url} companyName={lead.organization?.name} linkedinUrl={lead.organization?.linkedin_url} size={14} inline />
                <span className="truncate font-medium">{cleanDisplayCompany(lead.organization.name)}</span>
              </div>
            )}

            {/* Compact metadata grid */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
              {/* Industry */}
              <div className="flex items-center gap-1 min-w-0">
                <Factory className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                {lead.organization?.industry ? (
                  <span className="text-[10px] truncate text-zinc-500 dark:text-zinc-400">{toTitleCase(lead.organization.industry)}</span>
                ) : (
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-600 italic">{t('apolloProSearch.noIndustry')}</span>
                )}
              </div>
              
              {/* Employees */}
              <div className="flex items-center gap-1">
                <Users className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {Number(lead.organization?.estimated_num_employees) > 0
                    ? formatEmployeeCount(Number(lead.organization.estimated_num_employees))
                    : '—'}
                </span>
              </div>

              {/* Location */}
              {(lead.city || lead.organization?.city || lead.country || lead.organization?.country) && (
                <div className="flex items-center gap-1 min-w-0 col-span-2">
                  <MapPin className={`w-2.5 h-2.5 flex-shrink-0 ${inArea ? 'text-[#1ED4A7]' : 'text-zinc-300 dark:text-zinc-600'}`} />
                  <span className={`text-[10px] truncate ${inArea ? 'text-[#1ED4A7] font-semibold' : 'text-zinc-500 dark:text-zinc-400'}`}>
                    {[lead.city || lead.organization?.city, lead.state || lead.organization?.state, lead.country || lead.organization?.country].filter(Boolean).join(', ')}
                  </span>
                  {inArea && (
                    <span className="flex-shrink-0 text-[7px] font-bold px-1 py-0.5 rounded bg-[#1ED4A7]/15 text-[#1ED4A7]">{t('apolloProSearch.inAreaBadge')}</span>
                  )}
                </div>
              )}
            </div>

            {/* Contact info — optimized for mobile */}
            <div className="space-y-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
              {/* Email row */}
              {lead.email ? (
                <button
                  onClick={() => { navigator.clipboard.writeText(lead.email); toast.success(t('apolloProSearch.emailCopied')); }}
                  className="flex items-center gap-1.5 min-w-0 w-full text-left group"
                >
                  <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                  <code className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono flex-1 min-w-0 leading-tight" style={{ overflowWrap: 'anywhere' }}>{lead.email}</code>
                  <EmailBadge status={lead.email_status} verification={lead.email_verification} />
                  <Copy className="w-3 h-3 text-zinc-400 flex-shrink-0 opacity-0 group-active:opacity-100 transition-opacity" />
                </button>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-600">
                  <Mail className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
                  <span>—</span>
                </div>
              )}

              {/* Phone row */}
              {lead.phone_numbers?.[0]?.raw_number ? (
                <div className="flex items-center gap-1.5 min-w-0 w-full">
                  <SmartPhoneButton
                    phone={lead.phone_numbers[0].raw_number}
                    leadName={lead.first_name ? `${lead.first_name} ${lead.last_name || ''}`.trim() : undefined}
                    businessName={lead.organization?.name}
                    leadId={lead.id}
                    showNumber
                    displayNumber={formatPhoneNumber(lead.phone_numbers[0].raw_number)}
                    iconClassName="w-3.5 h-3.5"
                    numberClassName="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono tracking-tight"
                  />
                  {lead.phone_numbers[0].type && ['mobile', 'direct', 'work', 'company'].includes(lead.phone_numbers[0].type) && (
                    <span className="text-[8px] font-semibold px-1 py-0.5 rounded uppercase tracking-wide flex-shrink-0 bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500">{lead.phone_numbers[0].type}</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-600">
                  <Phone className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
                  <span>—</span>
                </div>
              )}

              {/* Additional phone numbers - stacked vertically */}
              {lead.phone_numbers?.length > 1 && lead.phone_numbers.slice(1, 2).map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => { navigator.clipboard.writeText(p.raw_number); toast.success(t('apolloProSearch.phoneCopied')); }}
                  className="flex items-center gap-1.5 pl-5 text-[10px] text-zinc-500 group"
                >
                  <span className="font-mono tracking-tight flex-1 min-w-0">{formatPhoneNumber(p.raw_number)}</span>
                  {p.type && ['mobile', 'direct', 'work', 'company'].includes(p.type) && (
                    <span className="text-[8px] font-semibold px-1 py-0.5 rounded uppercase tracking-wide flex-shrink-0 bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500">{p.type}</span>
                  )}
                </button>
              ))}

              {/* Social links row */}
              {(lead.linkedin_url || lead.organization?.website_url) && (
                <div className="flex items-center gap-1 pt-0.5">
                  {lead.linkedin_url && (
                    <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-[#0077B5] transition-colors">
                      <Linkedin className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {lead.organization?.website_url && (
                    <a href={lead.organization.website_url.startsWith('http') ? lead.organization.website_url : `https://${lead.organization.website_url}`} target="_blank" rel="noreferrer" className="p-1 text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 transition-colors">
                      <Globe className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoResultsState({
  titles,
  location,
  keywords,
  autoEnabled = true,
  onBroaden,
  onReSearch,
}: {
  titles: string;
  location: string;
  keywords: string;
  autoEnabled?: boolean;
  onBroaden: () => void;
  onReSearch: () => void;
}) {
  const { t } = useTranslation();
  const [autoCountdown, setAutoCountdown] = useState(autoEnabled ? 10 : -1);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!autoEnabled) return;
    // Auto-trigger deep prospecting with broadened filters after countdown
    countdownRef.current = setInterval(() => {
      setAutoCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          onBroaden();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [autoEnabled]);

  const cancelAuto = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setAutoCountdown(-1); // -1 = cancelled
  };

  const query = [titles, keywords, location].filter(Boolean).join(', ');

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-5 shadow-sm border border-zinc-200 dark:border-zinc-700">
          <Radar className="w-7 h-7 text-zinc-400 dark:text-zinc-500" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('apolloProSearch.noResults', 'No matching leads found')}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
          {query ? (
            <>No results for <span className="font-medium text-zinc-900 dark:text-zinc-100">"{query}"</span> with your current filters.</>
          ) : (
            <>No leads matched your current filter combination.</>
          )}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-6">
          {t('apolloProSearch.tryBroadening', 'Try broadening your filters, or let Smart Discovery search across LinkedIn profiles, public databases, and professional networks to find verified contacts.')}
        </p>

        <div className="flex flex-col gap-3 items-center">
          {/* Primary CTA */}
          <button
            onClick={() => { cancelAuto(); onBroaden(); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-100 transition-all shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            Broaden & Search Externally
          </button>

          {/* Re-search same filters */}
          <button
            onClick={() => { cancelAuto(); onReSearch(); }}
            className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-100 transition-colors"
          >
            <RefreshCcw className="w-3 h-3" />
            Re-search with same filters
          </button>

          {/* Auto-countdown */}
          {autoCountdown > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="relative w-8 h-8">
                <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-200 dark:text-zinc-800" />
                  <circle
                    cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2"
                    className="text-zinc-600 dark:text-zinc-400"
                    strokeDasharray={`${(autoCountdown / 10) * 94.25} 94.25`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dasharray 1s linear' }}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-zinc-500">{autoCountdown}</span>
              </div>
              <span className="text-[11px] text-zinc-400">Auto-expanding search in {autoCountdown}s</span>
              <button
                onClick={cancelAuto}
                className="text-[11px] text-zinc-400 hover:text-zinc-600 underline underline-offset-2"
              >
                Cancel
              </button>
            </div>
          )}
          {autoCountdown === -1 && (
            <p className="text-[11px] text-zinc-400 mt-1">Auto-search cancelled</p>
          )}
        </div>

        {/* Tips */}
        <div className="mt-8 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">Tips for better results</p>
          <div className="flex flex-col gap-2.5">
            {[
              { icon: Briefcase, tip: 'Use broader job titles (e.g. "CEO" instead of "Chief Executive Officer")' },
              { icon: MapPin, tip: 'Try a wider location (e.g. "United States" instead of a specific city)' },
              { icon: Users, tip: 'Remove seniority filters to include all levels' },
              { icon: Filter, tip: 'Remove employee range filters to include all company sizes' },
            ].map(({ icon: Icon, tip }) => (
              <div key={tip} className="flex items-start gap-2 text-xs text-zinc-500">
                <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-zinc-400" />
                <span>{tip}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ApolloEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <Sparkles className="w-7 h-7 text-zinc-900 dark:text-zinc-100" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('apolloProSearch.emptyStateTitle')}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          {t('apolloProSearch.emptyStateDesc')}
        </p>
        <div className="flex flex-col gap-3 text-left w-fit mx-auto">
          {[
            { icon: Target, label: t('apolloProSearch.emptyStatePoint1') },
            { icon: Mail, label: t('apolloProSearch.emptyStatePoint2') },
            { icon: Phone, label: t('apolloProSearch.emptyStatePoint3') },
            { icon: Linkedin, label: t('apolloProSearch.emptyStatePoint4') },
            { icon: BarChart3, label: t('apolloProSearch.emptyStatePoint5') },
            { icon: Download, label: t('apolloProSearch.emptyStatePoint6') },
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
