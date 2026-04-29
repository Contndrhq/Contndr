/**
 * CompaniesView — Company-based leads table inside the Leads module.
 * Built to feel like a natural extension of the existing CRM people view.
 * Uses identical table patterns, filters, badges, and interaction logic.
 */
import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import {
  Search, Mail, Phone, Globe, Building2, MapPin, Users, ChevronDown,
  Eye, X, Plus, Download, Upload, ExternalLink, Check, MoreHorizontal,
  Loader2, Zap, CheckCircle, AlertCircle,
  Clock, RefreshCw, Linkedin, DollarSign,
  FileText, Tag, Trash2, Send, Activity, UserSearch, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { CompanyLogo, extractLeadDomain } from './CompanyLogo';
import { LeadScoreBadge } from './LeadScoreBadge';
import { useTranslation } from 'react-i18next';
import { CompanyCSVImportModal, type ImportedCompany } from './leads/CompanyCSVImportModal';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ── Types ────────────────────────────────────────────────────────────────────

type EnrichmentStatus = 'not_enriched' | 'queued' | 'enriched' | 'failed' | 'partial';
type CompanyStatus = 'new' | 'contacted' | 'qualified' | 'negotiating' | 'customer' | 'churned' | 'unqualified';

interface CompanyRecord {
  id: string;
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  employees?: string;        // e.g. "51-200", "1-10"
  revenue?: string;          // e.g. "$1M-$10M"
  email?: string;
  phone?: string;
  linkedin_url?: string;
  twitter_url?: string;
  technologies?: string[];
  funding?: string;
  status: CompanyStatus;
  enrichment: EnrichmentStatus;
  score?: number;
  notes?: string;
  contact_name?: string;     // Primary contact name
  contact_title?: string;
  created_at: string;
  updated_at?: string;
  annual_revenue?: number;
  brand_logo_url?: string;
  description?: string;
  founded_year?: number;
  decision_makers?: DecisionMaker[];
}

interface DecisionMaker {
  id: string;
  name: string;
  title: string;
  email: string;
  email_source?: string;
  email_confidence?: string;
  phone: string;
  linkedin_url: string;
  location?: string;
  snippet?: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_COMPANIES: CompanyRecord[] = [
  { id: 'c1', name: 'Stripe', domain: 'stripe.com', website: 'https://stripe.com', industry: 'Financial Services', city: 'San Francisco', state: 'CA', country: 'United States', employees: '1001-5000', revenue: '$1B+', email: 'partners@stripe.com', phone: '+1 888-926-2289', linkedin_url: 'https://linkedin.com/company/stripe', status: 'qualified', enrichment: 'enriched', score: 91, technologies: ['AWS', 'React', 'Ruby on Rails'], contact_name: 'Sarah Chen', contact_title: 'Head of Partnerships', created_at: '2026-01-15T10:00:00Z', founded_year: 2010 },
  { id: 'c2', name: 'Notion', domain: 'notion.so', website: 'https://notion.so', industry: 'Software', city: 'San Francisco', state: 'CA', country: 'United States', employees: '201-500', revenue: '$100M-$500M', email: 'sales@notion.so', linkedin_url: 'https://linkedin.com/company/notion', status: 'contacted', enrichment: 'enriched', score: 84, technologies: ['React', 'Node.js', 'PostgreSQL'], contact_name: 'Alex Rivera', contact_title: 'Enterprise Sales', created_at: '2026-01-20T08:30:00Z', founded_year: 2016 },
  { id: 'c3', name: 'Figma', domain: 'figma.com', website: 'https://figma.com', industry: 'Design Software', city: 'San Francisco', state: 'CA', country: 'United States', employees: '501-1000', revenue: '$500M-$1B', email: 'enterprise@figma.com', phone: '+1 415-555-0100', linkedin_url: 'https://linkedin.com/company/figma', status: 'new', enrichment: 'enriched', score: 88, technologies: ['WebGL', 'TypeScript', 'Rust'], contact_name: 'Jordan Kim', contact_title: 'Growth Manager', created_at: '2026-02-01T09:00:00Z', founded_year: 2012 },
  { id: 'c4', name: 'Linear', domain: 'linear.app', website: 'https://linear.app', industry: 'Software', city: 'San Francisco', state: 'CA', country: 'United States', employees: '51-200', revenue: '$10M-$50M', email: 'hello@linear.app', linkedin_url: 'https://linkedin.com/company/linear', status: 'new', enrichment: 'partial', score: 77, technologies: ['React', 'GraphQL', 'TypeScript'], created_at: '2026-02-05T11:00:00Z', founded_year: 2019 },
  { id: 'c5', name: 'Vercel', domain: 'vercel.com', website: 'https://vercel.com', industry: 'Cloud Computing', city: 'San Francisco', state: 'CA', country: 'United States', employees: '201-500', revenue: '$50M-$100M', email: 'enterprise@vercel.com', linkedin_url: 'https://linkedin.com/company/vercel', status: 'qualified', enrichment: 'enriched', score: 82, technologies: ['Next.js', 'AWS', 'Edge Runtime'], contact_name: 'Morgan Davis', contact_title: 'Sales Director', created_at: '2026-02-10T14:00:00Z', founded_year: 2015 },
  { id: 'c6', name: 'Intercom', domain: 'intercom.com', website: 'https://intercom.com', industry: 'Customer Support Software', city: 'Dublin', state: '', country: 'Ireland', employees: '501-1000', revenue: '$100M-$500M', email: 'sales@intercom.com', phone: '+353 1 555 0200', linkedin_url: 'https://linkedin.com/company/intercom', status: 'negotiating', enrichment: 'enriched', score: 79, technologies: ['Ruby on Rails', 'Ember.js'], contact_name: 'Pat Sullivan', contact_title: 'VP Sales EMEA', created_at: '2026-02-12T10:00:00Z', founded_year: 2011 },
  { id: 'c7', name: 'HubSpot', domain: 'hubspot.com', website: 'https://hubspot.com', industry: 'Marketing Software', city: 'Cambridge', state: 'MA', country: 'United States', employees: '5001-10000', revenue: '$1B+', email: 'partnerships@hubspot.com', phone: '+1 888-482-7768', linkedin_url: 'https://linkedin.com/company/hubspot', status: 'customer', enrichment: 'enriched', score: 95, technologies: ['React', 'MySQL', 'Elasticsearch'], contact_name: 'Brian Halligan', contact_title: 'Co-Founder & CEO', created_at: '2026-01-08T08:00:00Z', founded_year: 2006 },
  { id: 'c8', name: 'Loom', domain: 'loom.com', website: 'https://loom.com', industry: 'Video Software', city: 'San Francisco', state: 'CA', country: 'United States', employees: '51-200', revenue: '$10M-$50M', status: 'new', enrichment: 'not_enriched', score: 58, created_at: '2026-02-18T16:00:00Z' },
  { id: 'c9', name: 'Airtable', domain: 'airtable.com', website: 'https://airtable.com', industry: 'Database Software', city: 'San Francisco', state: 'CA', country: 'United States', employees: '201-500', revenue: '$100M-$500M', email: 'enterprise@airtable.com', linkedin_url: 'https://linkedin.com/company/airtable', status: 'qualified', enrichment: 'enriched', score: 86, contact_name: 'Howie Liu', contact_title: 'CEO', created_at: '2026-01-25T12:00:00Z', founded_year: 2012 },
  { id: 'c10', name: 'Calendly', domain: 'calendly.com', website: 'https://calendly.com', industry: 'Scheduling Software', city: 'Atlanta', state: 'GA', country: 'United States', employees: '201-500', revenue: '$50M-$100M', email: 'sales@calendly.com', phone: '+1 404-555-0100', linkedin_url: 'https://linkedin.com/company/calendly', status: 'contacted', enrichment: 'enriched', score: 73, contact_name: 'Tope Awotona', contact_title: 'CEO & Founder', created_at: '2026-02-03T09:30:00Z', founded_year: 2013 },
  { id: 'c11', name: 'Webflow', domain: 'webflow.com', website: 'https://webflow.com', industry: 'Website Builder', city: 'San Francisco', state: 'CA', country: 'United States', employees: '201-500', revenue: '$50M-$100M', email: 'enterprise@webflow.com', status: 'new', enrichment: 'queued', score: 69, created_at: '2026-02-20T10:00:00Z', founded_year: 2013 },
  { id: 'c12', name: 'Segment', domain: 'segment.com', website: 'https://segment.com', industry: 'Data Infrastructure', city: 'San Francisco', state: 'CA', country: 'United States', employees: '201-500', revenue: '$50M-$100M', email: 'partnerships@segment.com', phone: '+1 415-555-0200', linkedin_url: 'https://linkedin.com/company/segment', status: 'qualified', enrichment: 'partial', score: 80, contact_name: 'Peter Reinhardt', contact_title: 'Co-Founder', created_at: '2026-01-30T11:00:00Z', founded_year: 2011 },
  { id: 'c13', name: 'Brex', domain: 'brex.com', website: 'https://brex.com', industry: 'Financial Services', city: 'San Francisco', state: 'CA', country: 'United States', employees: '1001-5000', revenue: '$100M-$500M', email: 'enterprise@brex.com', status: 'new', enrichment: 'failed', score: 62, created_at: '2026-02-22T13:00:00Z', founded_year: 2017 },
  { id: 'c14', name: 'Mixpanel', domain: 'mixpanel.com', website: 'https://mixpanel.com', industry: 'Analytics', city: 'San Francisco', state: 'CA', country: 'United States', employees: '201-500', revenue: '$50M-$100M', email: 'sales@mixpanel.com', linkedin_url: 'https://linkedin.com/company/mixpanel', status: 'contacted', enrichment: 'enriched', score: 76, contact_name: 'Amir Movafaghi', contact_title: 'CEO', created_at: '2026-01-18T08:00:00Z', founded_year: 2009 },
  { id: 'c15', name: 'Amplitude', domain: 'amplitude.com', website: 'https://amplitude.com', industry: 'Analytics', city: 'San Francisco', state: 'CA', country: 'United States', employees: '501-1000', revenue: '$100M-$500M', email: 'enterprise@amplitude.com', phone: '+1 415-555-0300', status: 'qualified', enrichment: 'enriched', score: 83, contact_name: 'Spenser Skates', contact_title: 'CEO & Co-Founder', created_at: '2026-01-22T10:00:00Z', founded_year: 2012 },
];

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<CompanyStatus, { label: string; className: string }> = {
  new:          { label: 'New',          className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700' },
  contacted:    { label: 'Contacted',    className: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' },
  qualified:    { label: 'Qualified',    className: 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20' },
  negotiating:  { label: 'Negotiating', className: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
  customer:     { label: 'Customer',     className: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400 border-green-200 dark:border-green-500/20' },
  churned:      { label: 'Churned',      className: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20' },
  unqualified:  { label: 'Unqualified',  className: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800/60 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700' },
};

const ENRICHMENT_CONFIG: Record<EnrichmentStatus, { label: string; icon: typeof CheckCircle; className: string }> = {
  enriched:     { label: 'Enriched',     icon: CheckCircle,   className: 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20' },
  queued:       { label: 'Queued',       icon: Clock,         className: 'bg-amber-50 text-amber-500 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
  partial:      { label: 'Partial',      icon: AlertCircle,   className: 'bg-blue-50 text-blue-500 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' },
  failed:       { label: 'Failed',       icon: AlertCircle,   className: 'bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20' },
  not_enriched: { label: 'Not Enriched', icon: RefreshCw,     className: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800/60 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700' },
};

const EMPLOYEE_RANGES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10000+'];
const INDUSTRIES = ['Analytics', 'Cloud Computing', 'Customer Support Software', 'Data Infrastructure', 'Database Software', 'Design Software', 'Financial Services', 'Marketing Software', 'Scheduling Software', 'Software', 'Video Software', 'Website Builder'];

// ── Translation key maps ───────────────────────────────────────────────────────

const STATUS_LABEL_KEYS: Record<CompanyStatus, string> = {
  new:         'companiesView.statusNew',
  contacted:   'companiesView.statusContacted',
  qualified:   'companiesView.statusQualified',
  negotiating: 'companiesView.statusNegotiating',
  customer:    'companiesView.statusCustomer',
  churned:     'companiesView.statusChurned',
  unqualified: 'companiesView.statusUnqualified',
};

const ENRICHMENT_LABEL_KEYS: Record<EnrichmentStatus, string> = {
  enriched:     'companiesView.enrichmentEnriched',
  queued:       'companiesView.enrichmentQueued',
  partial:      'companiesView.enrichmentPartial',
  failed:       'companiesView.enrichmentFailed',
  not_enriched: 'companiesView.enrichmentNotEnriched',
};

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CompanyStatus }) {
  const { t } = useTranslation();
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.className}`}>
      {t(STATUS_LABEL_KEYS[status] || 'companiesView.statusNew')}
    </span>
  );
}

// ── Enrichment Badge ─────────────────────────��────────────────────────────────

function EnrichmentBadge({ status }: { status: EnrichmentStatus }) {
  const { t } = useTranslation();
  const cfg = ENRICHMENT_CONFIG[status] || ENRICHMENT_CONFIG.not_enriched;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.className}`}>
      <Icon className="w-2.5 h-2.5" />
      {t(ENRICHMENT_LABEL_KEYS[status] || 'companiesView.enrichmentNotEnriched')}
    </span>
  );
}

// ── Company Detail Drawer ─────────────────────────────────────────────────────

function CompanyDetailDrawer({ company, onClose, onStatusChange, onEnrich, enriching }: {
  company: CompanyRecord;
  onClose: () => void;
  onStatusChange: (id: string, status: CompanyStatus) => void;
  onEnrich: (id: string) => void;
  enriching: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'overview' | 'contacts' | 'activity'>('overview');
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  const location = [company.city, company.state, company.country].filter(Boolean).join(', ');

  const sections = [
    { key: 'overview',  label: t('companiesView.tabOverview') },
    { key: 'contacts',  label: t('companiesView.tabContacts') },
    { key: 'activity',  label: t('companiesView.tabActivity') },
  ] as const;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 dark:bg-black/50 backdrop-blur-[1px]" onClick={onClose} />

      {/* Drawer panel */}
      <div
        className="fixed right-0 top-0 h-full w-full max-w-[480px] z-50 bg-white dark:bg-[#0a0a0a] border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl"
        style={{ animation: 'slideInRight 0.22s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-start gap-3 px-5 pt-5 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <CompanyLogo
            domain={company.domain}
            brandLogoUrl={company.brand_logo_url}
            companyName={company.name}
            size={44}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-zinc-900 dark:text-white truncate">{company.name}</h2>
                {company.website && (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-zinc-500 hover:text-[#1ED4A7] transition-colors inline-flex items-center gap-0.5 truncate"
                  >
                    {company.domain || company.website}
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                  </a>
                )}
              </div>
              <button onClick={onClose} className="flex-shrink-0 p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors -mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusBadge status={company.status} />
              <EnrichmentBadge status={company.enrichment} />
              {company.score !== undefined && (
                <LeadScoreBadge score={company.score} size="sm" />
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 flex border-b border-zinc-200 dark:border-zinc-800 px-5">
          {sections.map(s => (
            <button
              key={s.key}
              onClick={() => setTab(s.key)}
              className={`px-3 py-2.5 text-[12px] font-medium border-b-2 transition-colors -mb-px ${
                tab === s.key
                  ? 'border-zinc-900 dark:border-white text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {tab === 'overview' && (
            <>
              {/* Overview section */}
              <DrawerSection title={t('companiesView.sectionOverview')}>
                <DrawerRow icon={Building2} label={t('companiesView.fieldIndustry')} value={company.industry || '—'} />
                <DrawerRow icon={MapPin} label={t('companiesView.fieldLocation')} value={location || '—'} />
                <DrawerRow icon={Users} label={t('companiesView.fieldEmployees')} value={company.employees || '—'} />
                <DrawerRow icon={DollarSign} label={t('companiesView.fieldRevenue')} value={company.revenue || '—'} />
                {company.founded_year && <DrawerRow icon={Clock} label={t('companiesView.fieldFounded')} value={String(company.founded_year)} />}
                {company.funding && <DrawerRow icon={Zap} label={t('companiesView.fieldFunding')} value={company.funding} />}
              </DrawerSection>

              {/* Contact Info */}
              <DrawerSection title={t('companiesView.sectionContactInfo')}>
                {company.email ? (
                  <DrawerRow icon={Mail} label="Email" value={company.email} copyable />
                ) : (
                  <div className="flex items-center gap-2 py-1.5">
                    <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span className="text-[12px] text-zinc-400 italic">{t('companiesView.noEmail')}</span>
                  </div>
                )}
                {company.phone && <DrawerRow icon={Phone} label="Phone" value={company.phone} copyable />}
                {company.website && (
                  <a href={company.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 py-1.5 group">
                    <Globe className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span className="text-[12px] text-zinc-600 dark:text-zinc-300 group-hover:text-[#1ED4A7] transition-colors truncate">{company.website}</span>
                    <ExternalLink className="w-2.5 h-2.5 text-zinc-400 group-hover:text-[#1ED4A7] transition-colors ml-auto flex-shrink-0" />
                  </a>
                )}
                {company.linkedin_url && (
                  <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 py-1.5 group">
                    <Linkedin className="w-3.5 h-3.5 text-[#0A66C2] flex-shrink-0" />
                    <span className="text-[12px] text-zinc-600 dark:text-zinc-300 group-hover:text-[#0A66C2] transition-colors truncate">{t('companiesView.linkedinProfile')}</span>
                    <ExternalLink className="w-2.5 h-2.5 text-zinc-400 group-hover:text-[#0A66C2] transition-colors ml-auto flex-shrink-0" />
                  </a>
                )}
              </DrawerSection>

              {/* Technologies */}
              {company.technologies && company.technologies.length > 0 && (
                <DrawerSection title={t('companiesView.sectionTechnologies')}>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {company.technologies.map(tech => (
                      <span key={tech} className="px-2 py-0.5 text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded border border-zinc-200 dark:border-zinc-700">
                        {tech}
                      </span>
                    ))}
                  </div>
                </DrawerSection>
              )}

              {/* Notes */}
              <DrawerSection title={t('companiesView.sectionNotes')}>
                {company.notes ? (
                  <p className="text-[12px] text-zinc-600 dark:text-zinc-300 leading-relaxed">{company.notes}</p>
                ) : (
                  <p className="text-[12px] text-zinc-400 italic">{t('companiesView.noNotesYet')}</p>
                )}
              </DrawerSection>
            </>
          )}

          {tab === 'contacts' && (
            <div className="space-y-3">
              {/* Find Decision Makers button */}
              <button
                onClick={() => onEnrich(company.id)}
                disabled={enriching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#1ED4A7]/10 to-[#1ED4A7]/5 border border-[#1ED4A7]/25 text-[#1ED4A7] text-[12px] font-medium rounded-xl hover:from-[#1ED4A7]/15 hover:to-[#1ED4A7]/10 hover:border-[#1ED4A7]/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {enriching ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching for decision makers…</>
                ) : (
                  <><UserSearch className="w-3.5 h-3.5" /> Find Decision Makers</>
                )}
              </button>

              {/* Decision makers list (from enrichment) */}
              {company.decision_makers && company.decision_makers.length > 0 ? (
                <div className="space-y-2">
                  {company.decision_makers.map((dm, i) => (
                    <div key={dm.id || i} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          {dm.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-zinc-900 dark:text-white leading-tight">{dm.name}</p>
                              {dm.title && dm.title !== '—' && <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{dm.title}</p>}
                              {dm.location && <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{dm.location}</p>}
                            </div>
                            {i === 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20 rounded font-medium flex-shrink-0">Primary</span>
                            )}
                          </div>
                          <div className="mt-1.5 space-y-0.5">
                            {dm.email ? (
                              <a href={`mailto:${dm.email}`} className="text-[11px] text-zinc-500 hover:text-[#1ED4A7] transition-colors flex items-center gap-1 truncate">
                                <Mail className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{dm.email}</span>
                                {dm.email_source && (
                                  <span className="text-[9px] text-zinc-400 ml-1 flex-shrink-0">{dm.email_source}</span>
                                )}
                              </a>
                            ) : (
                              <span className="text-[11px] text-zinc-300 dark:text-zinc-600 flex items-center gap-1 italic">
                                <Mail className="w-3 h-3 flex-shrink-0" /> No email found
                              </span>
                            )}
                            {dm.linkedin_url && (
                              <a href={dm.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-zinc-500 hover:text-[#0A66C2] transition-colors flex items-center gap-1">
                                <Linkedin className="w-3 h-3 text-[#0A66C2] flex-shrink-0" />
                                <span>LinkedIn Profile</span>
                                <ExternalLink className="w-2.5 h-2.5 ml-auto flex-shrink-0" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !enriching ? (
                /* Primary contact fallback (from CSV import) */
                company.contact_name ? (
                  <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        {company.contact_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{company.contact_name}</p>
                        {company.contact_title && <p className="text-[11px] text-zinc-500 mt-0.5">{company.contact_title}</p>}
                        {company.email && (
                          <a href={`mailto:${company.email}`} className="text-[11px] text-zinc-500 hover:text-[#1ED4A7] transition-colors mt-1 flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {company.email}
                          </a>
                        )}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20 rounded font-medium">{t('companiesView.primaryBadge')}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 text-zinc-400">
                    <Sparkles className="w-7 h-7 mb-2 opacity-30" />
                    <p className="text-[12px] text-center">Click "Find Decision Makers" to search<br/>for senior contacts at {company.name}.</p>
                  </div>
                )
              ) : null}
            </div>
          )}

          {tab === 'activity' && (
            <div className="text-center py-8 text-zinc-400">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-[12px]">{t('companiesView.noActivityYet')}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-5 py-4 flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setStatusMenuOpen(!statusMenuOpen)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-[12px] font-medium rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <Tag className="w-3 h-3" />
              {t('companiesView.statusLabel')}
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>
            {statusMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} />
                <div className="absolute bottom-full mb-1.5 left-0 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
                  {(Object.keys(STATUS_CONFIG) as CompanyStatus[]).map(s => (
                    <button
                      key={s}
                      onClick={() => { onStatusChange(company.id, s); setStatusMenuOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${company.status === s ? 'text-zinc-900 dark:text-white font-medium' : 'text-zinc-600 dark:text-zinc-400'}`}
                    >
                      {company.status === s && <Check className="w-3 h-3 text-[#1ED4A7]" />}
                      <span className={company.status === s ? '' : 'ml-5'}>{t(STATUS_LABEL_KEYS[s])}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {company.email && (
            <button className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-[12px] font-medium rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors">
              <Send className="w-3 h-3" />
              {t('companiesView.outreach')}
            </button>
          )}
          <button
            onClick={() => { onEnrich(company.id); setTab('contacts'); }}
            disabled={enriching}
            className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-[12px] font-medium rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 text-amber-500" />}
            {enriching ? 'Searching…' : t('companiesView.enrich')}
          </button>
        </div>
      </div>
    </>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">{title}</h4>
      <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-1 space-y-0.5">
        {children}
      </div>
    </div>
  );
}

function DrawerRow({ icon: Icon, label, value, copyable }: {
  icon: typeof Building2;
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
      <span className="text-[11px] text-zinc-400 w-16 flex-shrink-0">{label}</span>
      <span className="text-[12px] text-zinc-700 dark:text-zinc-300 truncate flex-1">{value}</span>
      {copyable && (
        <button
          onClick={() => { navigator.clipboard.writeText(value); toast.success(t('companiesView.toastCopied')); }}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex-shrink-0"
        >
          <FileText className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── Row action menu ───────────────────────────────────────────────────────────

function CompanyRowMenu({ company, onView, onStatusChange, onDelete, onEnrich }: {
  company: CompanyRecord;
  onView: () => void;
  onStatusChange: (id: string, s: CompanyStatus) => void;
  onDelete: (id: string) => void;
  onEnrich: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const actions = [
    { label: t('companiesView.actionView'),           icon: Eye,        onClick: () => { onView(); setOpen(false); } },
    { label: 'Find Decision Makers',                  icon: UserSearch, onClick: () => { onView(); onEnrich(company.id); setOpen(false); } },
    { label: t('companiesView.actionFindContacts'),   icon: Users,    onClick: () => { toast.info(t('companiesView.toastSearchingContacts')); setOpen(false); } },
    { label: t('companiesView.actionAddToCampaign'),  icon: Send,     onClick: () => { toast.info(t('companiesView.toastSelectCampaign')); setOpen(false); } },
    { label: t('companiesView.actionExport'),         icon: Download, onClick: () => { toast.info(t('companiesView.toastExportedCsv')); setOpen(false); } },
    { label: t('companiesView.actionDelete'),         icon: Trash2,   onClick: () => { onDelete(company.id); setOpen(false); }, danger: true },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-30 py-1 min-w-[160px]">
            {actions.map((a, i) => {
              const Icon = a.icon;
              return (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); a.onClick(); }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                    (a as any).danger ? 'text-red-500 hover:text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'
                  } ${ i > 0 && (actions[i-1] as any).danger !== (a as any).danger ? 'border-t border-zinc-100 dark:border-zinc-800 mt-0.5 pt-1' : ''}`}
                >
                  <Icon className="w-3 h-3" />
                  {a.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface CompaniesViewProps {
  onStartOutreach?: (companyIds: string[]) => void;
}

export function CompaniesView({ onStartOutreach }: CompaniesViewProps) {
  const { t } = useTranslation();

  // Data — loaded from Supabase
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyRecord | null>(null);
  const [showBulkSelect, setShowBulkSelect] = useState(false);

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importingCompanies, setImportingCompanies] = useState(false);

  // Decision maker enrichment state
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [employeesFilter, setEmployeesFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [enrichmentFilter, setEnrichmentFilter] = useState('all');
  const [hasEmailFilter, setHasEmailFilter] = useState(false);
  const [hasPhoneFilter, setHasPhoneFilter] = useState(false);
  const [hasWebsiteFilter, setHasWebsiteFilter] = useState(false);
  const [showBulkStatusMenu, setShowBulkStatusMenu] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 50;

  // Derived filter options
  const uniqueIndustries = useMemo(() => Array.from(new Set(companies.map(c => c.industry).filter(Boolean) as string[])).sort(), [companies]);
  const uniqueCountries = useMemo(() => Array.from(new Set(companies.map(c => c.country).filter(Boolean) as string[])).sort(), [companies]);
  const uniqueStates = useMemo(() => {
    if (countryFilter === 'all') return [];
    return Array.from(new Set(companies.filter(c => c.country === countryFilter).map(c => c.state).filter(Boolean) as string[])).sort();
  }, [companies, countryFilter]);

  // Filtered companies
  const filteredCompanies = useMemo(() => {
    let data = companies;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      data = data.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.domain?.toLowerCase().includes(q) ||
        c.website?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.state?.toLowerCase().includes(q) ||
        c.country?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q)
      );
    }
    if (industryFilter !== 'all') data = data.filter(c => c.industry === industryFilter);
    if (countryFilter !== 'all') data = data.filter(c => c.country === countryFilter);
    if (stateFilter !== 'all') data = data.filter(c => c.state === stateFilter);
    if (employeesFilter !== 'all') data = data.filter(c => c.employees === employeesFilter);
    if (statusFilter !== 'all') data = data.filter(c => c.status === statusFilter);
    if (enrichmentFilter !== 'all') data = data.filter(c => c.enrichment === enrichmentFilter);
    if (hasEmailFilter) data = data.filter(c => !!c.email);
    if (hasPhoneFilter) data = data.filter(c => !!c.phone);
    if (hasWebsiteFilter) data = data.filter(c => !!c.website);
    return data;
  }, [companies, searchTerm, industryFilter, countryFilter, stateFilter, employeesFilter, statusFilter, enrichmentFilter, hasEmailFilter, hasPhoneFilter, hasWebsiteFilter]);

  const totalPages = Math.ceil(filteredCompanies.length / perPage);
  const pageCompanies = filteredCompanies.slice((currentPage - 1) * perPage, currentPage * perPage);

  // ── Load from Supabase ────────────────────────────────────────────────────
  const loadCompanies = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authenticatedFetch(`${API}/companies?per_page=500`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      
      // Check for memory/database errors and show helpful message
      if (data.error && data.error.includes('memory')) {
        setLoadError('Database overloaded. Your company list is very large. Please contact support for database migration assistance.');
        setCompanies([]);
        return;
      }
      
      // Map API response → CompanyRecord shape
      const mapped: CompanyRecord[] = (data.companies || []).map((c: any) => ({
        id:            c.id,
        name:          c.name,
        domain:        c.domain,
        website:       c.website,
        industry:      c.industry,
        city:          c.city,
        state:         c.state,
        country:       c.country,
        employees:     c.employees,
        email:         c.email,
        phone:         c.phone,
        linkedin_url:  c.linkedin_url,
        twitter_url:   c.twitter_url,
        technologies:  c.technologies,
        funding:       c.funding,
        status:        c.status as CompanyStatus,
        enrichment:    c.enrichment as EnrichmentStatus,
        score:         c.score,
        notes:         c.notes,
        contact_name:  c.contact_name,
        contact_title: c.contact_title,
        created_at:    c.created_at,
        updated_at:    c.updated_at,
        annual_revenue:   c.annual_revenue,
        description:      c.description,
        founded_year:     c.founded_year,
        decision_makers:  c.decision_makers || [],
      }));
      setCompanies(mapped);
    } catch (e: any) {
      console.error('[COMPANIES] Load error:', e);
      
      // Provide helpful error message for memory issues
      if (e.message && e.message.includes('memory')) {
        setLoadError('Database memory full. Your company list is too large. Please contact support.');
      } else {
        setLoadError(e.message || 'Failed to load companies');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCompanies(); }, []);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [searchTerm, industryFilter, countryFilter, stateFilter, employeesFilter, statusFilter, enrichmentFilter, hasEmailFilter, hasPhoneFilter, hasWebsiteFilter]);

  // Selection helpers
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const toggleSelect = (id: string) => setSelectedIds(prev => selectedSet.has(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleSelectAll = () => {
    if (selectedIds.length === pageCompanies.length && pageCompanies.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pageCompanies.map(c => c.id));
    }
  };
  const selectBulk = (n: number) => setSelectedIds(filteredCompanies.slice(0, n).map(c => c.id));

  const handleStatusChange = async (id: string, status: CompanyStatus) => {
    // Optimistic update
    setCompanies(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    if (selectedCompany?.id === id) setSelectedCompany(prev => prev ? { ...prev, status } : null);
    try {
      await authenticatedFetch(`${API}/companies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      toast.success(t('companiesView.toastStatusUpdated', { label: t(STATUS_LABEL_KEYS[status]) }));
    } catch (e: any) {
      toast.error(t('companiesView.toastFailedUpdateStatus'));
      loadCompanies(); // revert
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('companiesView.confirmDelete'))) return;
    setCompanies(prev => prev.filter(c => c.id !== id));
    if (selectedCompany?.id === id) setSelectedCompany(null);
    try {
      await authenticatedFetch(`${API}/companies/${id}`, { method: 'DELETE' });
      toast.success(t('companiesView.toastCompanyDeleted'));
    } catch (e: any) {
      toast.error(t('companiesView.toastFailedDeleteCompany'));
      loadCompanies(); // revert
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(t('companiesView.confirmBulkDelete', { count: selectedIds.length }))) return;
    const idsToDelete = [...selectedIds];
    setCompanies(prev => prev.filter(c => !selectedSet.has(c.id)));
    setSelectedIds([]);
    try {
      await authenticatedFetch(`${API}/companies/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete }),
      });
      toast.success(t('companiesView.toastCompaniesDeleted', { count: idsToDelete.length }));
    } catch (e: any) {
      toast.error(t('companiesView.toastFailedDeleteCompanies'));
      loadCompanies(); // revert
    }
  };

  // ── Find decision makers via Apollo ──────────────────────────────────────
  const handleEnrichCompany = async (id: string) => {
    if (enrichingId) return; // Only one at a time
    setEnrichingId(id);
    try {
      const res = await authenticatedFetch(`${API}/companies/${id}/find-decision-makers`, {
        method: 'POST',
        signal: AbortSignal.timeout(90000), // 90s — Apollo search + up to 5 reveals × ~15s each
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const found = data.found ?? 0;
      const updatedCompany: CompanyRecord = {
        ...companies.find(c => c.id === id)!,
        ...data.company,
        decision_makers: data.decision_makers || [],
        enrichment: data.company?.enrichment as EnrichmentStatus ?? (found > 0 ? 'enriched' : 'partial'),
        contact_name: data.company?.contact_name,
        contact_title: data.company?.contact_title,
        email: data.company?.email,
      };

      setCompanies(prev => prev.map(c => c.id === id ? updatedCompany : c));
      if (selectedCompany?.id === id) setSelectedCompany(updatedCompany);

      const withEmail = (data.decision_makers || []).filter((dm: any) => dm.email).length;
      if (found > 0) {
        const emailNote = withEmail > 0 ? ` · ${withEmail} with email` : '';
        toast.success(`Found ${found} contact${found !== 1 ? 's' : ''} at ${updatedCompany.name}${emailNote}`);
      } else {
        toast.info(`No contacts found for ${updatedCompany.name} — enrichment will retry with broader search next time`);
      }
    } catch (e: any) {
      console.error('[COMPANY ENRICH]', e);
      toast.error('Enrichment failed', { description: e.message });
    } finally {
      setEnrichingId(null);
    }
  };

  // ── Company CSV import → Supabase via API ─────────────────────────────────
  const handleCompanyImport = async (imported: ImportedCompany[]) => {
    setImportingCompanies(true);
    try {
      const res = await authenticatedFetch(`${API}/companies/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: imported }),
        signal: AbortSignal.timeout(60000),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const n = data.imported || 0;
      const d = data.duplicates || 0;

      const noun = n === 1 ? t('companiesView.toastImportedNounSingular') : t('companiesView.toastImportedNounPlural');
      const dupStr = d > 0 ? ` ${t('companiesView.toastDuplicatesSkipped', { count: d })}` : '';
      toast.success(`${t('companiesView.toastImported', { count: n.toLocaleString(), noun })}${dupStr}`);

      setShowImportModal(false);

      // Reset filters so new companies are visible, then reload from DB
      setSearchTerm('');
      setIndustryFilter('all');
      setCountryFilter('all');
      setStateFilter('all');
      setEmployeesFilter('all');
      setStatusFilter('all');
      setEnrichmentFilter('all');
      setHasEmailFilter(false);
      setHasPhoneFilter(false);
      setHasWebsiteFilter(false);
      setCurrentPage(1);

      // Reload from Supabase so canonical industry names are reflected
      await loadCompanies();
    } catch (e: any) {
      console.error('[COMPANIES IMPORT]', e);
      toast.error(t('companiesView.toastImportFailed'), { description: e.message });
    } finally {
      setImportingCompanies(false);
    }
  };

  const activeFiltersCount = [
    industryFilter !== 'all', countryFilter !== 'all', stateFilter !== 'all',
    employeesFilter !== 'all', statusFilter !== 'all', enrichmentFilter !== 'all',
    hasEmailFilter, hasPhoneFilter, hasWebsiteFilter,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setSearchTerm(''); setIndustryFilter('all'); setCountryFilter('all');
    setStateFilter('all'); setEmployeesFilter('all'); setStatusFilter('all');
    setEnrichmentFilter('all'); setHasEmailFilter(false); setHasPhoneFilter(false); setHasWebsiteFilter(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="flex-shrink-0 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative w-full sm:w-44">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder={t('companiesView.searchPlaceholder')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#1ED4A7]/50 focus:border-[#1ED4A7]"
            />
          </div>

          {/* Import CSV button */}
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-medium rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap min-h-[32px] flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('companiesView.importCsv')}</span>
            <span className="sm:hidden">{t('companiesView.importShort')}</span>
          </button>

          {/* Building Search button */}
          {/* Email / Phone / Website toggle pills */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={() => setHasEmailFilter(!hasEmailFilter)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-all ${hasEmailFilter ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/30 text-[#1ED4A7]' : 'border-transparent text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
            >
              <Mail className="w-3 h-3" />
              <span className="hidden sm:inline">{t('companiesView.hasEmail')}</span>
            </button>
            <button
              onClick={() => setHasPhoneFilter(!hasPhoneFilter)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-all ${hasPhoneFilter ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/30 text-[#1ED4A7]' : 'border-transparent text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
            >
              <Phone className="w-3 h-3" />
              <span className="hidden sm:inline">{t('companiesView.hasPhone')}</span>
            </button>
            <button
              onClick={() => setHasWebsiteFilter(!hasWebsiteFilter)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-all ${hasWebsiteFilter ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/30 text-[#1ED4A7]' : 'border-transparent text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
            >
              <Globe className="w-3 h-3" />
              <span className="hidden sm:inline">{t('companiesView.hasWebsite')}</span>
            </button>
          </div>

          <div className="hidden sm:block w-px h-4 bg-zinc-200 dark:bg-zinc-800" />

          {/* Dropdown filters — same select style as CRM */}
          <div className="flex items-center gap-1 flex-wrap">
            {/* Industry */}
            {uniqueIndustries.length > 0 && (
              <div className="relative">
                <select
                  value={industryFilter}
                  onChange={e => setIndustryFilter(e.target.value)}
                  className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${industryFilter !== 'all' ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                  style={{ maxWidth: 150 }}
                >
                  <option value="all">{t('companiesView.filterIndustry')}</option>
                  {uniqueIndustries.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
                <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
              </div>
            )}

            {/* Country */}
            {uniqueCountries.length > 0 && (
              <div className="relative">
                <select
                  value={countryFilter}
                  onChange={e => { setCountryFilter(e.target.value); setStateFilter('all'); }}
                  className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${countryFilter !== 'all' ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                  style={{ maxWidth: 140 }}
                >
                  <option value="all">{t('companiesView.filterCountry')}</option>
                  {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
              </div>
            )}

            {/* State — only when country selected */}
            {countryFilter !== 'all' && uniqueStates.length > 0 && (
              <div className="relative">
                <select
                  value={stateFilter}
                  onChange={e => setStateFilter(e.target.value)}
                  className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${stateFilter !== 'all' ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                  style={{ maxWidth: 120 }}
                >
                  <option value="all">{t('companiesView.filterState')}</option>
                  {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
              </div>
            )}

            {/* Employees */}
            <div className="relative">
              <select
                value={employeesFilter}
                onChange={e => setEmployeesFilter(e.target.value)}
                className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${employeesFilter !== 'all' ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                style={{ maxWidth: 130 }}
              >
                <option value="all">{t('companiesView.filterEmployees')}</option>
                {EMPLOYEE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
            </div>

            {/* Status */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${statusFilter !== 'all' ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                style={{ maxWidth: 130 }}
              >
                <option value="all">{t('companiesView.filterStatus')}</option>
                {(Object.keys(STATUS_CONFIG) as CompanyStatus[]).map(s => (
                  <option key={s} value={s}>{t(STATUS_LABEL_KEYS[s])}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
            </div>

            {/* Enrichment */}
            <div className="relative">
              <select
                value={enrichmentFilter}
                onChange={e => setEnrichmentFilter(e.target.value)}
                className={`appearance-none pl-2 pr-5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer focus:outline-none ${enrichmentFilter !== 'all' ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-black dark:text-white' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
                style={{ maxWidth: 140 }}
              >
                <option value="all">{t('companiesView.filterEnrichment')}</option>
                <option value="enriched">{t('companiesView.enrichmentEnriched')}</option>
                <option value="partial">{t('companiesView.enrichmentPartial')}</option>
                <option value="queued">{t('companiesView.enrichmentQueued')}</option>
                <option value="not_enriched">{t('companiesView.enrichmentNotEnriched')}</option>
                <option value="failed">{t('companiesView.enrichmentFailed')}</option>
              </select>
              <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          {/* Clear filters */}
          {activeFiltersCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <X className="w-3 h-3" />
              {t('companiesView.clearCount', { count: activeFiltersCount })}
            </button>
          )}
        </div>
      </div>

      {/* ── Bulk actions bar ───────────────────────────────────────── */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 mb-3 animate-fade-in">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{t('companiesView.selectedCount', { count: selectedIds.length })}</span>
          {onStartOutreach && (
            <button
              onClick={() => onStartOutreach(selectedIds)}
              className="px-3 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black text-xs font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center gap-2 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              {t('companiesView.startCampaign')}
            </button>
          )}
          <button
            onClick={() => {
              if (selectedIds.length === 1) {
                handleEnrichCompany(selectedIds[0]);
                setSelectedCompany(companies.find(c => c.id === selectedIds[0]) || null);
                setSelectedIds([]);
              } else {
                toast.info(`Select a single company to find its decision makers (bulk enrichment coming soon)`);
              }
            }}
            disabled={!!enrichingId}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {enrichingId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-500" />}
            {t('companiesView.enrich')}
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-red-500 text-xs font-medium rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-all flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('companiesView.delete')}
          </button>
          <button onClick={() => setSelectedIds([])} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors ml-1">
            {t('companiesView.deselectAll')}
          </button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">

        {/* Mobile cards */}
        <div className="block sm:hidden space-y-2 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-zinc-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">{t('companiesView.loadingCompanies')}</span>
            </div>
          ) : pageCompanies.length === 0 ? (
            <CompaniesEmptyState hasFilters={activeFiltersCount > 0 || !!searchTerm} onClear={clearAllFilters} onImport={() => setShowImportModal(true)} />
          ) : (
            pageCompanies.map(company => (
              <div
                key={company.id}
                onClick={() => setSelectedCompany(company)}
                className={`p-3 rounded-xl border cursor-pointer transition-colors ${selectedSet.has(company.id) ? 'bg-[#1ED4A7]/5 border-[#1ED4A7]/20' : 'bg-white dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}
              >
                <div className="flex items-start gap-3">
                  <div onClick={e => { e.stopPropagation(); toggleSelect(company.id); }}>
                    <input
                      type="checkbox"
                      readOnly
                      checked={selectedSet.has(company.id)}
                      className="w-4 h-4 mt-0.5 rounded border-gray-300 dark:border-zinc-700 accent-[#1ED4A7]"
                    />
                  </div>
                  <CompanyLogo domain={company.domain} brandLogoUrl={company.brand_logo_url} companyName={company.name} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-zinc-900 dark:text-white truncate">{company.name}</p>
                      <StatusBadge status={company.status} />
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{company.industry || company.domain}</p>
                    {(company.city || company.state) && (
                      <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-0.5">
                        <MapPin className="w-2.5 h-2.5" />
                        {[company.city, company.state].filter(Boolean).join(', ')}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <EnrichmentBadge status={company.enrichment} />
                      {company.score !== undefined && <LeadScoreBadge score={company.score} size="sm" />}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block">
          <table className="w-full text-left border-collapse">
            <thead className="bg-white dark:bg-[#050505] sticky top-0 z-10 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="p-3 w-10 relative">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === pageCompanies.length && pageCompanies.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                    />
                    <div className="absolute left-8 top-1/2 -translate-y-1/2">
                      <button
                        onClick={e => { e.stopPropagation(); setShowBulkSelect(!showBulkSelect); }}
                        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {showBulkSelect && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowBulkSelect(false)} />
                          <div className="absolute left-0 top-full mt-1 bg-white dark:bg-black rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 min-w-[130px] z-20 py-1">
                            {[50, 100, 200].map(n => (
                              <button key={n} onClick={() => { selectBulk(n); setShowBulkSelect(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                                {t('companiesView.selectFirst', { count: n })}
                              </button>
                            ))}
                            <div className="border-t border-zinc-100 dark:border-zinc-800 my-1" />
                            <button onClick={() => { setSelectedIds([]); setShowBulkSelect(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-400 dark:text-zinc-500">
                              {t('companiesView.deselectAllMenu')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colCompany')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colIndustry')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colLocation')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colEmployees')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colContact')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colStatus')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colEnrichment')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colScore')}</th>
                <th className="p-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('companiesView.colView')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-zinc-400">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    <p className="text-sm">{t('companiesView.loadingCompanies')}</p>
                  </td>
                </tr>
              ) : pageCompanies.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <CompaniesEmptyState hasFilters={activeFiltersCount > 0 || !!searchTerm} onClear={clearAllFilters} onImport={() => setShowImportModal(true)} />
                  </td>
                </tr>
              ) : (
                pageCompanies.map(company => {
                  const isSelected = selectedSet.has(company.id);
                  const location = [company.city, company.state].filter(Boolean).join(', ');
                  return (
                    <tr
                      key={company.id}
                      className={`group border-b border-zinc-100 dark:border-zinc-800/60 transition-colors cursor-pointer ${isSelected ? 'bg-[#1ED4A7]/[0.03]' : 'hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40'}`}
                      onClick={() => setSelectedCompany(company)}
                    >
                      {/* Checkbox */}
                      <td className="p-3 w-10" onClick={e => { e.stopPropagation(); toggleSelect(company.id); }}>
                        <input
                          type="checkbox"
                          readOnly
                          checked={isSelected}
                          className="w-4 h-4 rounded border-gray-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                        />
                      </td>

                      {/* Company cell */}
                      <td className="p-3 max-w-[220px]">
                        <div className="flex items-center gap-2.5">
                          <CompanyLogo domain={company.domain} brandLogoUrl={company.brand_logo_url} companyName={company.name} size={30} />
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-zinc-900 dark:text-white truncate">{company.name}</p>
                            {company.domain && (
                              <a
                                href={company.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="text-[11px] text-zinc-400 hover:text-[#1ED4A7] transition-colors flex items-center gap-0.5 truncate"
                              >
                                {company.domain}
                                <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                              </a>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Industry */}
                      <td className="p-3 max-w-[160px]">
                        <span className="text-[12px] text-zinc-600 dark:text-zinc-400 truncate block">{company.industry || <span className="text-zinc-300 dark:text-zinc-600">—</span>}</span>
                      </td>

                      {/* Location */}
                      <td className="p-3 max-w-[140px]">
                        {location ? (
                          <span className="text-[12px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                            {location}
                          </span>
                        ) : (
                          <span className="text-zinc-300 dark:text-zinc-600 text-[12px]">—</span>
                        )}
                      </td>

                      {/* Employees */}
                      <td className="p-3">
                        {company.employees ? (
                          <span className="text-[12px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                            <Users className="w-3 h-3 text-zinc-400" />
                            {company.employees}
                          </span>
                        ) : (
                          <span className="text-zinc-300 dark:text-zinc-600 text-[12px]">—</span>
                        )}
                      </td>

                      {/* Contact */}
                      <td className="p-3 max-w-[180px]">
                        <div className="flex flex-col gap-0.5">
                          {company.email ? (
                            <a
                              href={`mailto:${company.email}`}
                              onClick={e => e.stopPropagation()}
                              className="text-[11px] text-zinc-600 dark:text-zinc-400 hover:text-[#1ED4A7] transition-colors flex items-center gap-1 truncate"
                            >
                              <Mail className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                              <span className="truncate">{company.email}</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-zinc-300 dark:text-zinc-600 flex items-center gap-1 italic">
                              <Mail className="w-3 h-3 flex-shrink-0" /> No email
                            </span>
                          )}
                          {company.phone && (
                            <span className="text-[11px] text-zinc-500 flex items-center gap-1 truncate">
                              <Phone className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                              <span className="truncate">{company.phone}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="p-3">
                        <StatusBadge status={company.status} />
                      </td>

                      {/* Enrichment */}
                      <td className="p-3">
                        <EnrichmentBadge status={company.enrichment} />
                      </td>

                      {/* Score */}
                      <td className="p-3">
                        {company.score !== undefined ? (
                          <LeadScoreBadge score={company.score} size="sm" />
                        ) : (
                          <span className="text-zinc-300 dark:text-zinc-600 text-[12px]">—</span>
                        )}
                      </td>

                      {/* View + actions */}
                      <td className="p-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); setSelectedCompany(company); }}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <Eye className="w-3 h-3" /> View
                          </button>
                          <CompanyRowMenu
                            company={company}
                            onView={() => setSelectedCompany(company)}
                            onStatusChange={handleStatusChange}
                            onDelete={handleDelete}
                            onEnrich={handleEnrichCompany}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ─────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 flex items-center justify-between pt-3 mt-3 border-t border-zinc-200 dark:border-zinc-800">
          <span className="text-xs text-zinc-500">
            {t('companiesView.paginationInfo', { count: filteredCompanies.length.toLocaleString(), page: currentPage, total: totalPages })}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-xs font-medium border border-zinc-200 dark:border-zinc-800 rounded-lg disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-zinc-600 dark:text-zinc-400"
            >
              {t('companiesView.previous')}
            </button>
            <span className="px-3 py-1.5 text-xs text-zinc-500">{t('companiesView.pageOf', { page: currentPage, total: totalPages })}</span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-xs font-medium border border-zinc-200 dark:border-zinc-800 rounded-lg disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-zinc-600 dark:text-zinc-400"
            >
              {t('companiesView.next')}
            </button>
          </div>
        </div>
      )}

      {/* ── Count footer ───────────────────────────────────────────── */}
      {!loading && filteredCompanies.length > 0 && (
        <p className="text-[11px] text-zinc-400 mt-2">
          {t('companiesView.showingOf', { shown: pageCompanies.length.toLocaleString(), total: filteredCompanies.length.toLocaleString() })}{filteredCompanies.length !== companies.length && <> {t('companiesView.totalCount', { count: companies.length.toLocaleString() })}</>}
        </p>
      )}

      {/* ── Company detail drawer ─────────────────────────────────── */}
      {selectedCompany && (
        <CompanyDetailDrawer
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
          onStatusChange={handleStatusChange}
          onEnrich={handleEnrichCompany}
          enriching={enrichingId === selectedCompany.id}
        />
      )}

      {/* ── Company CSV Import Modal ──────────────────────────────── */}
      <CompanyCSVImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleCompanyImport}
        isImporting={importingCompanies}
      />
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function CompaniesEmptyState({
  hasFilters,
  onClear,
  onImport,
}: {
  hasFilters: boolean;
  onClear: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation();

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
        <Building2 className="w-10 h-10 mb-3 opacity-25" />
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('companiesView.emptyFiltersTitle')}</p>
        <p className="text-xs text-zinc-400 mt-1">{t('companiesView.emptyFiltersDesc')}</p>
        <button
          onClick={onClear}
          className="mt-3 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-medium transition-colors"
        >
          {t('companiesView.clearAllFilters')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 flex items-center justify-center mb-4">
        <Building2 className="w-7 h-7 text-zinc-400 dark:text-zinc-500" />
      </div>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('companiesView.emptyTitle')}</p>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-[260px] leading-relaxed mb-5">
        {t('companiesView.emptyDesc')}
      </p>
      <button
        onClick={onImport}
        className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-medium rounded-lg hover:opacity-90 transition-opacity min-h-[36px]"
      >
        <Upload className="w-3.5 h-3.5" />
        {t('companiesView.importCsv')}
      </button>
    </div>
  );
}
