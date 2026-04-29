/**
 * CompanyCSVImportModal — v2
 *
 * Full company CSV import flow with validation, confidence scoring,
 * and a review step that surfaces bad / risky rows before import.
 *
 * Steps: upload → [map] → review (validate + confirm)
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X, Upload, FileSpreadsheet, Check, ChevronRight, ChevronLeft,
  Loader2, CheckCircle2, Building2, Info, AlertTriangle, AlertCircle,
  Globe, MapPin, Download, Edit3, Trash2,
  ShieldCheck, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportedCompany {
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  employees?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  twitter_url?: string;
  technologies?: string[];
  funding?: string;
  annual_revenue?: number;
  description?: string;
  founded_year?: number;
  apollo_account_id?: string;
}

type ValidationTier = 'high' | 'medium' | 'review' | 'reject';

interface ValidatedCompany {
  company: ImportedCompany;
  /** raw company name value from CSV (pre-clean) */
  rawName: string;
  rowIndex: number;
  score: number;
  tier: ValidationTier;
  reasons: string[];
  /** suggested cleaned name if we can derive one */
  suggestion?: string;
  /** user has manually edited the name */
  editedName?: string;
  /** user has toggled this row off from import */
  skipped: boolean;
}

interface CompanyCSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (companies: ImportedCompany[]) => Promise<void> | void;
  isImporting?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source detection
// ─────────────────────────────────────────────────────────────────────────────

type DetectedSource = 'apollo_accounts' | 'hubspot_companies' | 'salesforce_accounts' | 'generic';

const SOURCE_META: Record<DetectedSource, { label: string; color: string }> = {
  apollo_accounts:    { label: 'Apollo Accounts',    color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  hubspot_companies:  { label: 'HubSpot Companies',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  salesforce_accounts:{ label: 'Salesforce Accounts',color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  generic:            { label: 'Generic CSV',         color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
};

function detectSource(headerLine: string): DetectedSource {
  const h = headerLine.toLowerCase();
  if (['apollo account id', 'company name for emails', 'short description'].some(s => h.includes(s))) return 'apollo_accounts';
  if (['hubspot company id', 'hs_object_id', 'associated contacts'].some(s => h.includes(s))) return 'hubspot_companies';
  if (['salesforce id', 'account owner', 'billing street'].some(s => h.includes(s))) return 'salesforce_accounts';
  return 'generic';
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function bucketEmployees(raw: string | number | undefined): string | undefined {
  if (!raw) return undefined;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  if (isNaN(n)) return String(raw);
  if (n <= 10)     return '1-10';
  if (n <= 50)     return '11-50';
  if (n <= 200)    return '51-200';
  if (n <= 500)    return '201-500';
  if (n <= 1000)   return '501-1000';
  if (n <= 5000)   return '1001-5000';
  if (n <= 10000)  return '5001-10000';
  return '10000+';
}

function extractDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || undefined;
  }
}

function parseRevenue(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
  return isNaN(n) ? undefined : n;
}

function parseTech(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw.split(/[,;|]/).map(t => t.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Company Name Validation + Confidence Scoring  (strict v2)
// ─────────────────────────────────────────────────────────────────────────────

/** Exact-match blocklist — immediately suspect values */
const BLOCKED_EXACT = new Set([
  'test', 'testing', 'unknown', 'none', 'n/a', 'na', 'null', 'tbd', 'tbh',
  'undefined', 'empty', 'blank', 'placeholder', 'sample', 'example',
  'company name', 'business name', 'account name', 'your company',
  'my company', 'company here', 'enter company', 'enter name',
  'no name', 'no company', 'call later', 'follow up', 'see notes',
  '—', '-', '.', ',', '?', 'n.a.', 'n.a', 'tba', 'xxx',
]);

/**
 * Action verbs that virtually never appear in real company names.
 * Matched as whole words so "Seeking" the company name wouldn't match
 * but "I'm seeking" or "seeking new opportunities" would.
 */
const ACTION_VERB_RE = /\b(looking|seeking|helping|hiring|recruiting|building|growing|creating|developing|managing|leading|supporting|delivering|driving|connecting|enabling|leveraging|providing|offering|working|consulting|striving|thriving|aiming|focusing|specializing|passionate|dedicated|committed|excited|available|open to work|open to new|actively looking|currently looking|love to|happy to|proud to|excited to|glad to)\b/i;

/** First-person pronouns — dead giveaway it's a person bio, not a company */
const PRONOUN_RE = /\b(i am|i'm|i work|i help|i build|i do|we are|we're|we help|we build|we do|my name|my goal|our mission|our goal|our company|our team)\b/i;

/** Common English articles/prepositions that appear in sentence structure
 *  NOTE: "of", "and", "&", "the" are intentionally excluded — they appear
 *  in legitimate company names like "Bank of America", "Johnson & Johnson". */
const SENTENCE_STRUCTURE_RE = /\b(for new|for a |to new|and more|and looking|and working|and helping|and i |and we |currently |recently |formerly |previously )\b/i;

/** Known job title words — when the ENTIRE name is just a title */
const JOB_TITLE_ONLY_RE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|vice president|director|senior director|manager|senior manager|head of|chief of|lead|tech lead|chief|founder|co-founder|cofounder|owner|sole proprietor|partner|managing partner|president|consultant|independent consultant|advisor|analyst|engineer|software engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelancer|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|developer|designer|recruiter|sales rep|account executive|account manager|business development)$/i;

/** Corporate / legal entity suffixes — strong positive signal */
const CORP_SUFFIX_RE = /\b(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|gmbh|plc|llp|lp|s\.a\.?|a\.g\.?|b\.v\.?|pty\.?|srl|pllc|pvt\.?|incorporated|limited|corporation|holdings|group|partners|associates|ventures|capital|technologies|solutions|systems|networks|media|studios|labs|works)\b/i;

/** Generic filler words that weaken confidence when they dominate the name */
const FILLER_WORD_RE = /\b(best|top|premier|professional|expert|quality|great|amazing|awesome|excellent|superior|ultimate|perfect|complete|total|full|rapid|fast|smart|digital|modern|advanced|innovative|creative|dynamic|strategic|synergy|proactive|results.driven)\b/gi;

/** Suggest a cleaner name if we can derive one from supporting data */
function suggestCleanName(raw: string, company: ImportedCompany): string | undefined {
  if (company.domain) {
    const base = company.domain.split('.')[0];
    if (base && base.length > 1) return base.charAt(0).toUpperCase() + base.slice(1);
  }
  // "LastName, JobTitle" pattern → try extracting what's after the comma
  if (raw.includes(',')) {
    const after = raw.split(',')[1]?.trim();
    if (after && after.length > 2 && after.split(' ').length <= 4) return after;
  }
  return undefined;
}

interface ScoreResult {
  score: number;
  tier: ValidationTier;
  reasons: string[];
  suggestion?: string;
}

function scoreCompany(company: ImportedCompany, _rowIndex: number): ScoreResult {
  const raw = company.name.trim();
  const lower = raw.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const reasons: string[] = [];
  // Start conservative — name must earn its trust
  let score = 15;
  let hardFailed = false;

  // ── Supporting field bonuses (before name penalties) ─────────────────────
  if (company.domain || company.website)  score += 40;
  if (company.email && company.domain) {
    const eDom = company.email.split('@')[1]?.toLowerCase();
    if (eDom && company.domain.toLowerCase().includes(eDom.split('.')[0])) score += 20;
  }
  if (company.industry)                    score += 15;
  if (company.city || company.country)     score += 10;
  if (company.phone)                        score += 10;
  if (company.linkedin_url)                score += 15;

  // ── Corporate suffix bonus ────────────────────────────────────────────────
  if (CORP_SUFFIX_RE.test(raw)) score += 20;

  // ── Hard fail checks (order matters — first match wins) ──────────────────

  // 1. Email in name field
  if (!hardFailed && /@/.test(raw)) {
    score = 0; hardFailed = true;
    reasons.push('Email address placed in company name field');
  }

  // 2. Phone number only
  if (!hardFailed && (/^\+?[\d\s\-()\\.]{7,}$/.test(raw) || /^\d{7,}$/.test(raw))) {
    score = 0; hardFailed = true;
    reasons.push('Phone number placed in company name field');
  }

  // 3. URL only
  if (!hardFailed && /^(https?:\/\/|www\.)\S+$/.test(raw)) {
    score = 0; hardFailed = true;
    reasons.push('URL placed in company name field');
  }

  // 4. Blocked exact-match placeholders
  if (!hardFailed && BLOCKED_EXACT.has(lower)) {
    score = 0; hardFailed = true;
    reasons.push(`Placeholder / invalid value: "${raw}"`);
  }

  // 5. Contains action verbs (nearly impossible in a real company name)
  if (!hardFailed && ACTION_VERB_RE.test(lower)) {
    score -= 65;
    hardFailed = true;
    reasons.push('Contains action verb — reads like a personal bio or status update');
  }

  // 6. First-person pronouns
  if (!hardFailed && PRONOUN_RE.test(lower)) {
    score -= 65;
    hardFailed = true;
    reasons.push('Contains personal pronoun — not a company name');
  }

  // 7. Sentence structure fragments
  if (!hardFailed && SENTENCE_STRUCTURE_RE.test(lower)) {
    score -= 55;
    hardFailed = true;
    reasons.push('Sentence-like structure detected');
  }

  // 8. Very long names (> 7 words) with no corporate suffix
  if (!hardFailed && words.length > 7 && !CORP_SUFFIX_RE.test(raw)) {
    score -= 55;
    hardFailed = true;
    reasons.push(`Too many words (${words.length}) for a company name`);
  }

  // 9. Job title only (entire value = one of the known titles)
  if (!hardFailed && JOB_TITLE_ONLY_RE.test(lower.trim())) {
    score -= 50;
    hardFailed = true;
    reasons.push('Entire value is a job title, not a company name');
  }

  // 10. All numbers / symbols, no letters
  if (!hardFailed && (/^[^a-zA-Z]*$/.test(raw) || raw.replace(/[^a-zA-Z]/g, '').length < 2)) {
    score -= 50;
    hardFailed = true;
    reasons.push('Company name has no meaningful text');
  }

  // ── Soft penalties (only if no hard fail already recorded) ───────────────

  if (!hardFailed) {
    // 5–7 words with no corporate suffix and no supporting data → suspicious
    if (words.length >= 5 && !CORP_SUFFIX_RE.test(raw) && !(company.domain || company.website)) {
      score -= 30;
      reasons.push(`${words.length}-word name with no website — may not be a company`);
    }

    // Excessive filler words
    const fillerMatches = raw.match(FILLER_WORD_RE) || [];
    if (fillerMatches.length >= 2) {
      score -= 20;
      if (!reasons.length) reasons.push('Company name dominated by generic marketing words');
    }

    // All lowercase with multiple words and no data
    if (raw === lower && words.length > 1 && !(company.domain || company.website)) {
      score -= 10;
      if (!reasons.length) reasons.push('All-lowercase multi-word name with no website');
    }

    // No supporting data at all — cap the score so it can't auto-pass on name alone
    const hasData = !!(company.domain || company.website || company.industry || company.city || company.country || company.phone || company.linkedin_url);
    if (!hasData) {
      score = Math.min(score, 44); // force into review at best
      if (!reasons.length) reasons.push('No supporting fields (website, industry, location)');
    }
  }

  // ── Clamp & classify ─────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));

  let tier: ValidationTier;
  if (score >= 75)      tier = 'high';
  else if (score >= 50) tier = 'medium';
  else if (score >= 20) tier = 'review';
  else                  tier = 'reject';

  const suggestion = (tier === 'review' || tier === 'reject')
    ? suggestCleanName(raw, company)
    : undefined;

  return { score, tier, reasons, suggestion };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((c === ',' || c === '\t') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCompanyRow(row: Record<string, string>, _source: DetectedSource): ImportedCompany | null {
  const get = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const val = row[k]?.trim();
      if (val) return val;
    }
    return undefined;
  };

  const name = get('Company', 'Name', 'Account Name', 'Company Name', 'Organization Name', 'Firm');
  if (!name) return null;

  const website = get('Website', 'Website URL', 'Web', 'Company URL', 'Domain', 'Homepage URL');
  return {
    name,
    domain:        extractDomain(website),
    website,
    industry:      get('Industry', 'Sector', 'Vertical', 'Industry Category'),
    city:          get('Company City', 'City', 'Billing City', 'HQ City'),
    state:         get('Company State', 'State', 'Province', 'Billing State', 'HQ State'),
    country:       get('Company Country', 'Country', 'Billing Country', 'HQ Country'),
    employees:     bucketEmployees(get('Employees', 'Number of Employees', 'Employee Count', 'Headcount', 'Staff Size', 'Company Size')),
    email:         get('Email', 'Company Email', 'Business Email'),
    phone:         get('Company Phone', 'Phone', 'Phone Number', 'Business Phone', 'Main Phone'),
    linkedin_url:  get('LinkedIn URL', 'Linkedin URL', 'LinkedIn', 'Company LinkedIn URL', 'LinkedIn Company URL'),
    twitter_url:   get('Company Twitter URL', 'Twitter URL', 'Twitter'),
    technologies:  parseTech(get('Technologies', 'Tech Stack', 'Technology')),
    funding:       get('Total Funding', 'Funding'),
    annual_revenue:parseRevenue(get('Annual Revenue', 'Revenue', 'Annual Revenue (in Thousands)')),
    description:   get('Short Description', 'Description', 'About', 'Company Description'),
    founded_year:  parseInt(get('Founded Year', 'Year Founded', 'Founded') || '', 10) || undefined,
    apollo_account_id: get('Account ID', 'Apollo Account ID'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Column mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_FIELDS = [
  { key: 'name',           label: 'Company Name',  required: true },
  { key: 'website',        label: 'Website',        required: false },
  { key: 'email',          label: 'Email',          required: false },
  { key: 'phone',          label: 'Phone',          required: false },
  { key: 'linkedin_url',   label: 'LinkedIn URL',   required: false },
  { key: 'industry',       label: 'Industry',       required: false },
  { key: 'city',           label: 'City',           required: false },
  { key: 'state',          label: 'State',          required: false },
  { key: 'country',        label: 'Country',        required: false },
  { key: 'employees',      label: 'Employees',      required: false },
  { key: 'technologies',   label: 'Technologies',   required: false },
  { key: 'description',    label: 'Description',    required: false },
  { key: 'annual_revenue', label: 'Annual Revenue', required: false },
  { key: 'funding',        label: 'Total Funding',  required: false },
  { key: 'founded_year',   label: 'Founded Year',   required: false },
];

function autoMapHeaders(csvHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const rules: Array<{ systemKey: string; test: (h: string) => boolean }> = [
    { systemKey: 'name',           test: h => h.includes('company') || h.includes('account name') || h.includes('organization') || h.includes('firm') || h === 'name' },
    { systemKey: 'email',          test: h => h.includes('email') },
    { systemKey: 'phone',          test: h => h.includes('phone') || h.includes('tel') },
    { systemKey: 'website',        test: h => h.includes('website') || h.includes('web') || h.includes('url') || h.includes('domain') },
    { systemKey: 'linkedin_url',   test: h => h.includes('linkedin') },
    { systemKey: 'industry',       test: h => h.includes('industry') || h.includes('sector') || h.includes('vertical') },
    { systemKey: 'city',           test: h => h.includes('city') || h.includes('town') },
    { systemKey: 'state',          test: h => h.includes('state') || h.includes('province') || h.includes('region') },
    { systemKey: 'country',        test: h => h.includes('country') },
    { systemKey: 'employees',      test: h => h.includes('employee') || h.includes('headcount') || h.includes('staff') || h.includes('size') },
    { systemKey: 'technologies',   test: h => h.includes('technolog') || h.includes('tech stack') },
    { systemKey: 'description',    test: h => h.includes('description') || h.includes('about') || h.includes('summary') },
    { systemKey: 'annual_revenue', test: h => h.includes('revenue') },
    { systemKey: 'funding',        test: h => h.includes('total funding') || h.includes('funding amount') },
    { systemKey: 'founded_year',   test: h => h.includes('founded') || h.includes('year founded') },
  ];
  for (const header of csvHeaders) {
    const lower = header.toLowerCase().trim();
    for (const rule of rules) {
      if (!mapping[rule.systemKey] && rule.test(lower)) {
        mapping[rule.systemKey] = header;
        break;
      }
    }
  }
  return mapping;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample template download
// ─────────────────────────────────────────────────────────────────────────────

function downloadSampleTemplate() {
  const headers = ['Company', 'Website', 'Email', 'Phone', 'LinkedIn URL', 'Industry', 'Company City', 'Company State', 'Company Country', 'Employees', 'Annual Revenue', 'Total Funding', 'Technologies', 'Short Description', 'Founded Year'];
  const rows = [
    ['Stripe', 'https://stripe.com', 'partners@stripe.com', '+1 888-926-2289', 'https://linkedin.com/company/stripe', 'Financial Services', 'San Francisco', 'CA', 'United States', '5000', '2800000000', '$2.2B', 'AWS,React,Ruby on Rails', 'Online payment processing', '2010'],
    ['Notion', 'https://notion.so', 'sales@notion.so', '', 'https://linkedin.com/company/notion', 'Software', 'San Francisco', 'CA', 'United States', '400', '330000000', '$343M', 'React,Node.js,PostgreSQL', 'All-in-one workspace', '2016'],
  ];
  const escape = (v: string) => (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'contndr-companies-sample.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function exportRejectedCSV(rejected: ValidatedCompany[]) {
  const headers = ['Row', 'Company Name', 'Score', 'Reason', 'Website', 'Email', 'Industry', 'City', 'Country'];
  const rows = rejected.map(v => [
    String(v.rowIndex + 2), // +2 for 1-index + header row
    v.rawName,
    String(v.score),
    v.reasons.join('; '),
    v.company.website || '',
    v.company.email || '',
    v.company.industry || '',
    v.company.city || '',
    v.company.country || '',
  ]);
  const escape = (val: string) => (val.includes(',') || val.includes('"') || val.includes('\n')) ? `"${val.replace(/"/g, '""')}"` : val;
  const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'contndr-rejected-companies.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier config
// ─────────────────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<ValidationTier, {
  label: string;
  badgeClass: string;
  iconClass: string;
  rowClass: string;
  icon: typeof ShieldCheck;
}> = {
  high:   { label: 'Valid',         badgeClass: 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20',                                             iconClass: 'text-[#1ED4A7]',     rowClass: '', icon: ShieldCheck },
  medium: { label: 'Valid',         badgeClass: 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20',                                             iconClass: 'text-[#1ED4A7]',     rowClass: '', icon: CheckCircle2 },
  review: { label: 'Needs Review',  badgeClass: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20', iconClass: 'text-amber-500', rowClass: 'bg-amber-50/40 dark:bg-amber-500/5', icon: AlertTriangle },
  reject: { label: 'Rejected',      badgeClass: 'bg-red-50 text-red-500 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20', iconClass: 'text-red-400',      rowClass: 'bg-red-50/30 dark:bg-red-500/5',    icon: XCircle },
};

// ─────────────────────────────────────────────────────────────────────────────
// Score bar mini component
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBar({ score, tier }: { score: number; tier: ValidationTier }) {
  const color =
    tier === 'high' || tier === 'medium' ? 'bg-[#1ED4A7]' :
    tier === 'review' ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-zinc-400 font-mono">{score}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'map' | 'review';

export function CompanyCSVImportModal({ isOpen, onClose, onImport, isImporting = false }: CompanyCSVImportModalProps) {
  const { t } = useTranslation();
  const [step, setStep]             = useState<Step>('upload');
  const [file, setFile]             = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows]       = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [detectedSource, setDetectedSource] = useState<DetectedSource>('generic');
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [validated, setValidated]   = useState<ValidatedCompany[]>([]);
  const [reviewTab, setReviewTab]   = useState<'valid' | 'review' | 'reject'>('valid');
  const [dupeCount, setDupeCount]   = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep('upload'); setFile(null); setCsvHeaders([]); setCsvRows([]);
      setColumnMapping({}); setDetectedSource('generic'); setParseError(null);
      setValidated([]); setReviewTab('valid'); setDupeCount(0);
    }
  }, [isOpen]);

  // ── Parse & validate CSV ──────────────────────────────────────────────────

  const runValidation = useCallback((companies: ImportedCompany[], source: DetectedSource) => {
    const seen = new Set<string>();
    let dupes = 0;
    const results: ValidatedCompany[] = [];

    companies.forEach((company, i) => {
      const key = (company.domain || company.name).toLowerCase().trim();
      if (seen.has(key)) { dupes++; return; }
      seen.add(key);
      const { score, tier, reasons, suggestion } = scoreCompany(company, i);
      results.push({
        company,
        rawName: company.name,
        rowIndex: i,
        score,
        tier,
        reasons,
        suggestion,
        editedName: undefined,
        skipped: false,
      });
    });

    setDupeCount(dupes);
    setValidated(results);
  }, []);

  const processFile = useCallback((f: File) => {
    if (!f.name.match(/\.(csv|tsv|txt)$/i)) {
      setParseError(t('companiesView.importErrFileType'));
      return;
    }
    setFile(f);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let text = (e.target?.result as string || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          setParseError(t('companiesView.importErrMinRows'));
          return;
        }

        const source = detectSource(lines[0]);
        setDetectedSource(source);
        const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
        setCsvHeaders(headers);
        const rows = lines.slice(1).map(l => parseCSVLine(l));
        setCsvRows(rows);
        setColumnMapping(autoMapHeaders(headers));

        // Try smart parse
        const makeObj = (rowValues: string[]) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => { obj[h] = (rowValues[i] || '').trim(); });
          return obj;
        };
        const companies: ImportedCompany[] = rows
          .map(rv => parseCompanyRow(makeObj(rv), source))
          .filter((c): c is ImportedCompany => c !== null);

        if (companies.length > 0) {
          runValidation(companies, source);
          setStep('review');
        } else {
          setStep('map');
        }
      } catch (err: any) {
        setParseError(err.message || t('companiesView.importErrParseFailed'));
      }
    };
    reader.onerror = () => setParseError(t('companiesView.importErrReadFailed'));
    reader.readAsText(f);
  }, [runValidation]);

  // Build companies from manual column mapping and run validation
  const buildFromMapping = useCallback(() => {
    const reverseMap: Record<string, string> = {};
    for (const [sk, csvH] of Object.entries(columnMapping)) reverseMap[sk] = csvH;

    const companies: ImportedCompany[] = [];
    for (const rowValues of csvRows) {
      const obj: Record<string, string> = {};
      csvHeaders.forEach((h, i) => { obj[h] = (rowValues[i] || '').trim(); });
      const get = (key: string) => reverseMap[key] ? obj[reverseMap[key]] || undefined : undefined;
      const name = get('name');
      if (!name) continue;
      const website = get('website');
      companies.push({
        name,
        website,
        domain: extractDomain(website),
        email:          get('email'),
        phone:          get('phone'),
        linkedin_url:   get('linkedin_url'),
        industry:       get('industry'),
        city:           get('city'),
        state:          get('state'),
        country:        get('country'),
        employees:      bucketEmployees(get('employees')),
        technologies:   parseTech(get('technologies')),
        description:    get('description'),
        annual_revenue: parseRevenue(get('annual_revenue')),
        funding:        get('funding'),
        founded_year:   parseInt(get('founded_year') || '', 10) || undefined,
      });
    }
    runValidation(companies, detectedSource);
    setStep('review');
  }, [columnMapping, csvHeaders, csvRows, detectedSource, runValidation]);

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const onDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }, [processFile]);

  // ── Inline edit helpers ───────────────────────────────────────────────────

  const setEditedName = (rowIndex: number, name: string) => {
    setValidated(prev => prev.map(v => v.rowIndex === rowIndex ? { ...v, editedName: name || undefined } : v));
  };

  const toggleSkip = (rowIndex: number) => {
    setValidated(prev => prev.map(v => v.rowIndex === rowIndex ? { ...v, skipped: !v.skipped } : v));
  };

  // ── Computed lists ────────────────────────────────────────────────────────

  const validRows   = validated.filter(v => (v.tier === 'high' || v.tier === 'medium') && !v.skipped);
  const reviewRows  = validated.filter(v => v.tier === 'review' && !v.skipped);
  const rejectedRows= validated.filter(v => v.tier === 'reject');
  const skippedRows = validated.filter(v => v.skipped);

  // ── Build final ImportedCompany array from a set of ValidatedCompanys ────

  const buildFinalList = (rows: ValidatedCompany[]): ImportedCompany[] =>
    rows
      .filter(v => !v.skipped)
      .map(v => ({
        ...v.company,
        name: v.editedName?.trim() || v.company.name,
      }));

  // ── Import actions ────────────────────────────────────────────────────────

  const handleImportValid = async () => {
    const list = buildFinalList(validRows);
    if (!list.length) { toast.error(t('companiesView.importErrNoValid')); return; }
    await onImport(list);
  };

  const handleImportAll = async () => {
    const list = buildFinalList([...validRows, ...reviewRows]);
    if (!list.length) { toast.error(t('companiesView.importErrNoSelected')); return; }
    await onImport(list);
  };

  if (!isOpen) return null;

  const srcMeta = SOURCE_META[detectedSource];
  const totalParsed = validated.length;
  const STEPS: Step[] = ['upload', 'map', 'review'];

  // Decide which steps to show in the indicator (skip map if we jumped straight to review)
  const stepLabels: { key: Step; label: string }[] = [
    { key: 'upload', label: t('companiesView.importStepUpload') },
    { key: 'map',    label: t('companiesView.importStepMapFields') },
    { key: 'review', label: t('companiesView.importStepReview') },
  ];
  const currentStepIdx = STEPS.indexOf(step);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:max-w-2xl max-h-[92dvh] flex flex-col bg-white dark:bg-zinc-950 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
              <Building2 className="w-4 h-4 text-white dark:text-black" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{t('companiesView.importModalTitle')}</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {step === 'upload' && t('companiesView.importModalSubUpload')}
                {step === 'map'    && t('companiesView.importModalSubMap')}
                {step === 'review' && t('companiesView.importModalSubReview', { count: totalParsed.toLocaleString() })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Step indicator ───────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
          {stepLabels.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="w-3 h-3 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />}
              <div className={`flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
                step === s.key ? 'text-zinc-900 dark:text-white' :
                currentStepIdx > i ? 'text-[#1ED4A7]' : 'text-zinc-400'
              }`}>
                <div className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
                  step === s.key
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-black border-zinc-900 dark:border-white'
                    : currentStepIdx > i
                    ? 'bg-[#1ED4A7] border-[#1ED4A7] text-white'
                    : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-zinc-400'
                }`}>
                  {currentStepIdx > i ? <Check className="w-2.5 h-2.5" /> : <span className="text-[9px] font-bold">{i + 1}</span>}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ════ Step 1: Upload ════════════════════════════════════════════ */}
          {step === 'upload' && (
            <div className="p-5 space-y-4">
              <div
                onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all min-h-[180px] ${
                  isDragging
                    ? 'border-[#1ED4A7] bg-[#1ED4A7]/5'
                    : parseError
                    ? 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/5'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
                />
                {parseError ? (
                  <>
                    <AlertTriangle className="w-10 h-10 text-red-400" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-red-600 dark:text-red-400">{parseError}</p>
                      <p className="text-xs text-zinc-500 mt-1">{t('companiesView.importTryDifferent')}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shadow-sm">
                      <Upload className="w-5 h-5 text-zinc-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {isDragging ? t('companiesView.importDropping') : t('companiesView.importDropHere')}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        {t('companiesView.importOrBrowse')} <span className="text-[#1ED4A7] underline underline-offset-2">{t('companiesView.importBrowseToUpload')}</span>
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2.5 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <Info className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{t('companiesView.importSupportedFormats')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['Apollo Accounts CSV', 'HubSpot Companies', 'Salesforce Accounts', 'Generic CSV'].map(f => (
                      <span key={f} className="px-2 py-0.5 text-[10px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-500 dark:text-zinc-400">{f}</span>
                    ))}
                  </div>
                  <p className="text-[11px] text-zinc-400">{t('companiesView.importValidationNote')}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-400">{t('companiesView.importNeedTemplate')}</p>
                <button
                  onClick={e => { e.stopPropagation(); downloadSampleTemplate(); }}
                  className="flex items-center gap-1.5 text-[11px] text-[#1ED4A7] hover:text-[#1ED4A7]/80 font-medium transition-colors"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  {t('companiesView.importDownloadSample')}
                </button>
              </div>
            </div>
          )}

          {/* ════ Step 2: Column mapping ═════════════════════════════════════ */}
          {step === 'map' && (
            <div className="p-5 space-y-4">
              {file && (
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-zinc-500">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">{file.name}</span>
                    {' · '}{t('companiesView.importRowCount', { count: csvRows.length.toLocaleString() })}
                  </p>
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${srcMeta.color}`}>{srcMeta.label}</span>
                </div>
              )}
              <p className="text-[11px] text-zinc-500">{t('companiesView.importMapInstruction')} <span className="text-red-500">*</span> {t('companiesView.importMapRequired')}</p>
              <div className="space-y-2">
                {SYSTEM_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center gap-3">
                    <div className="w-32 flex-shrink-0 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                      {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </div>
                    <select
                      value={columnMapping[field.key] || ''}
                      onChange={e => setColumnMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="flex-1 appearance-none px-2 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[11px] text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-[#1ED4A7]/50 focus:border-[#1ED4A7] cursor-pointer"
                    >
                      <option value="">{t('companiesView.importSkipColumn')}</option>
                      {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ════ Step 3: Review / Validate ══════════════════════════════════ */}
          {step === 'review' && (
            <div className="flex flex-col min-h-0">
              {/* Summary chips */}
              <div className="flex items-center gap-2 px-5 pt-4 pb-3 flex-wrap flex-shrink-0">
                {file && (
                  <span className="text-[11px] text-zinc-500 mr-1">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">{file.name}</span>
                  </span>
                )}
                <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${srcMeta.color}`}>{srcMeta.label}</span>
                {dupeCount > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded border bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
                    {t('companiesView.importDupesRemoved', { count: dupeCount })}
                  </span>
                )}
              </div>

              {/* Big summary row */}
              <div className="grid grid-cols-3 gap-2 px-5 pb-3 flex-shrink-0">
                <button
                  onClick={() => setReviewTab('valid')}
                  className={`flex flex-col items-center p-3 rounded-xl border transition-all ${reviewTab === 'valid' ? 'border-[#1ED4A7]/30 bg-[#1ED4A7]/5' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}
                >
                  <CheckCircle2 className={`w-5 h-5 mb-1 ${reviewTab === 'valid' ? 'text-[#1ED4A7]' : 'text-zinc-400'}`} />
                  <span className="text-[18px] font-bold text-zinc-900 dark:text-white">{validRows.length}</span>
                  <span className="text-[10px] text-zinc-500 mt-0.5">{t('companiesView.importTabValid')}</span>
                </button>
                <button
                  onClick={() => setReviewTab('review')}
                  className={`flex flex-col items-center p-3 rounded-xl border transition-all ${reviewTab === 'review' ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50/50 dark:bg-amber-500/5' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}
                >
                  <AlertTriangle className={`w-5 h-5 mb-1 ${reviewTab === 'review' ? 'text-amber-500' : 'text-zinc-400'}`} />
                  <span className="text-[18px] font-bold text-zinc-900 dark:text-white">{reviewRows.length}</span>
                  <span className="text-[10px] text-zinc-500 mt-0.5">{t('companiesView.importTabNeedsReview')}</span>
                </button>
                <button
                  onClick={() => setReviewTab('reject')}
                  className={`flex flex-col items-center p-3 rounded-xl border transition-all ${reviewTab === 'reject' ? 'border-red-200 dark:border-red-500/30 bg-red-50/40 dark:bg-red-500/5' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}
                >
                  <XCircle className={`w-5 h-5 mb-1 ${reviewTab === 'reject' ? 'text-red-400' : 'text-zinc-400'}`} />
                  <span className="text-[18px] font-bold text-zinc-900 dark:text-white">{rejectedRows.length}</span>
                  <span className="text-[10px] text-zinc-500 mt-0.5">{t('companiesView.importTabRejected')}</span>
                </button>
              </div>

              {/* Tab label row */}
              <div className="flex-shrink-0 px-5 pb-2">
                {reviewTab === 'valid' && (
                  <p className="text-[11px] text-zinc-500">
                    {t('companiesView.importValidDesc')}
                    {skippedRows.length > 0 && <span className="ml-1 text-zinc-400">{t('companiesView.importValidSkipped', { count: skippedRows.length, s: skippedRows.length > 1 ? 's' : '' })}</span>}
                  </p>
                )}
                {reviewTab === 'review' && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    {t('companiesView.importReviewDesc')}
                  </p>
                )}
                {reviewTab === 'reject' && (
                  <p className="text-[11px] text-red-500 dark:text-red-400">
                    {t('companiesView.importRejectedDesc')}
                  </p>
                )}
              </div>

              {/* Table */}
              <div className="flex-1 overflow-y-auto px-5 pb-4 min-h-0">
                {/* ── Valid tab ── */}
                {reviewTab === 'valid' && (
                  validRows.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">{t('companiesView.importNoValidYet')}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                      <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-zinc-50 dark:bg-zinc-900/80 sticky top-0 z-10">
                            <tr>
                              {[
                                t('companiesView.importColHash'),
                                t('companiesView.importColCompany'),
                                t('companiesView.importColDomain'),
                                t('companiesView.importColIndustry'),
                                t('companiesView.importColLocation'),
                                t('companiesView.importColScore'),
                              ].map(h => (
                                <th key={h} className="px-3 py-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 whitespace-nowrap">{h}</th>
                              ))}
                              <th className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                            {validRows.map(v => {
                              const Icon = TIER_CONFIG[v.tier].icon;
                              return (
                                <tr key={v.rowIndex} className="group hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                                  <td className="px-3 py-2 text-[10px] text-zinc-400 font-mono">{v.rowIndex + 2}</td>
                                  <td className="px-3 py-2 min-w-[120px] max-w-[180px]">
                                    <div className="flex items-center gap-1.5">
                                      <Icon className={`w-3 h-3 flex-shrink-0 ${TIER_CONFIG[v.tier].iconClass}`} />
                                      <span className="text-[11px] font-medium text-zinc-900 dark:text-white truncate">{v.company.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-[11px] text-zinc-500 max-w-[100px] truncate">{v.company.domain || '—'}</td>
                                  <td className="px-3 py-2 text-[11px] text-zinc-500 max-w-[100px] truncate">{v.company.industry || '—'}</td>
                                  <td className="px-3 py-2 text-[11px] text-zinc-500 whitespace-nowrap max-w-[100px] truncate">
                                    {[v.company.city, v.company.country].filter(Boolean).join(', ') || '—'}
                                  </td>
                                  <td className="px-3 py-2"><ScoreBar score={v.score} tier={v.tier} /></td>
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={() => toggleSkip(v.rowIndex)}
                                      title={t('companiesView.importSkipRowTitle')}
                                      className="p-1 rounded text-zinc-300 hover:text-red-400 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                )}

                {/* ── Needs Review tab ── */}
                {reviewTab === 'review' && (
                  reviewRows.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400">
                      <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">{t('companiesView.importNoReviewRows')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {reviewRows.map(v => (
                        <div
                          key={v.rowIndex}
                          className="p-3 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/40 dark:bg-amber-500/5"
                        >
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0 space-y-2">
                              {/* Row meta */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-zinc-400 font-mono">{t('companiesView.importRowLabel', { n: v.rowIndex + 2 })}</span>
                                <ScoreBar score={v.score} tier={v.tier} />
                                {v.reasons.map((r, ri) => (
                                  <span key={ri} className="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20">
                                    {r}
                                  </span>
                                ))}
                              </div>

                              {/* Raw name */}
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-zinc-400 w-12 flex-shrink-0">{t('companiesView.importRawLabel')}</span>
                                <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                  {v.rawName}
                                </span>
                              </div>

                              {/* Inline edit */}
                              <div className="flex items-center gap-1.5">
                                <Edit3 className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                                <input
                                  type="text"
                                  value={v.editedName !== undefined ? v.editedName : (v.suggestion || v.company.name)}
                                  onChange={e => setEditedName(v.rowIndex, e.target.value)}
                                  placeholder={v.suggestion || t('companiesView.importEditPlaceholder')}
                                  className="flex-1 px-2 py-1 text-[11px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-300 dark:focus:ring-amber-500/50 focus:border-amber-300 text-zinc-800 dark:text-zinc-200"
                                />
                                {v.suggestion && (
                                  <button
                                    onClick={() => setEditedName(v.rowIndex, v.suggestion!)}
                                    className="text-[10px] text-[#1ED4A7] hover:text-[#1ED4A7]/80 font-medium whitespace-nowrap transition-colors"
                                  >
                                    {t('companiesView.importUseSuggestion')}
                                  </button>
                                )}
                              </div>

                              {/* Supporting context */}
                              <div className="flex items-center gap-3 flex-wrap text-[10px] text-zinc-400">
                                {v.company.domain && <span className="flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" />{v.company.domain}</span>}
                                {v.company.industry && <span className="flex items-center gap-0.5"><Building2 className="w-2.5 h-2.5" />{v.company.industry}</span>}
                                {(v.company.city || v.company.country) && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{[v.company.city, v.company.country].filter(Boolean).join(', ')}</span>}
                              </div>
                            </div>

                            {/* Skip button */}
                            <button
                              onClick={() => toggleSkip(v.rowIndex)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-zinc-400 hover:text-red-500 dark:hover:text-red-400 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-red-200 dark:hover:border-red-500/30 transition-colors flex-shrink-0 min-h-[32px]"
                             >
                               <Trash2 className="w-3 h-3" />
                               {t('companiesView.importSkipRow')}

                             </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {/* ── Rejected tab ── */}
                {reviewTab === 'reject' && (
                  rejectedRows.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400">
                      <XCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">{t('companiesView.importNoRejectedRows')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {rejectedRows.map(v => (
                        <div
                          key={v.rowIndex}
                          className="p-3 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/30 dark:bg-red-500/5"
                        >
                          <div className="flex items-start gap-2.5">
                            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-zinc-400 font-mono">{t('companiesView.importRowLabel', { n: v.rowIndex + 2 })}</span>
                                <ScoreBar score={v.score} tier={v.tier} />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-zinc-400 w-12 flex-shrink-0">{t('companiesView.importValueLabel')}</span>
                                <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded truncate max-w-[220px]">
                                  {v.rawName}
                                </span>
                              </div>
                              {v.reasons.map((r, ri) => (
                                <div key={ri} className="flex items-center gap-1 text-[10px] text-red-500 dark:text-red-400">
                                  <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
                                  {r}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Export rejected */}
                      <button
                        onClick={() => exportRejectedCSV(rejectedRows)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors min-h-[44px]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {t('companiesView.importExportRejected', { count: rejectedRows.length })}
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-5 py-4 bg-white dark:bg-zinc-950">
          {/* Upload step footer */}
          {step === 'upload' && (
            <div className="flex items-center justify-between">
              <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors min-h-[44px]">
                {t('companiesView.importCancel')}
              </button>
            </div>
          )}

          {/* Map step footer */}
          {step === 'map' && (
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setStep('upload')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-zinc-500 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors min-h-[44px]"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> {t('companiesView.importBack')}
              </button>
              <button
                onClick={buildFromMapping}
                disabled={!columnMapping['name']}
                className="flex items-center gap-1.5 px-5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
              >
                {t('companiesView.importRunValidation')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Review step footer */}
          {step === 'review' && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                onClick={() => setStep('upload')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-zinc-500 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors min-h-[44px]"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> {t('companiesView.importBack')}
              </button>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Import valid only */}
                <button
                  onClick={handleImportValid}
                  disabled={isImporting || validRows.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
                >
                  {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-[#1ED4A7]" />}
                  {t('companiesView.importValidOnly', { count: validRows.length })}
                </button>

                {/* Import valid + reviewed */}
                <button
                  onClick={handleImportAll}
                  disabled={isImporting || (validRows.length + reviewRows.length) === 0}
                  className="flex items-center gap-1.5 px-5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
                >
                  {isImporting
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('companiesView.importImporting')}</>
                    : <><CheckCircle2 className="w-3.5 h-3.5" /> {t('companiesView.importValidAndReviewed', { count: validRows.length + reviewRows.length })}</>
                  }
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
