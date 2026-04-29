import { toTitleCase } from '../utils/title-case';
import { formatPhoneDisplay } from '../lib/phone-format';
import { LeadAvatar } from './LeadAvatar';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { ActivityFeed } from './ActivityFeed';
import { dispatchAppEvent } from '../lib/app-events';
import { X, Mail, MapPin, CheckCircle, ChevronDown, Briefcase, Activity, Building, TrendingUp, Tag, Phone, Send, AlertTriangle, ExternalLink, Linkedin, Facebook, Twitter, DollarSign, Users, Clock, Eye, MousePointer, Share2, Loader2, ArrowUpRight, Zap, Pencil, Check } from 'lucide-react';
import { AddToPipelineModal } from './AddToPipelineModal';
import { IconButton } from './ui/icon-button';
import { LeadScoreBadge } from './LeadScoreBadge';
import { QuoDialer } from './QuoDialer';
import { AIQuickCall } from './AIQuickCall';
import { SmartPhoneButton } from './SmartPhoneButton';
import { supabase } from '../lib/supabase';
import { useDemoMode, DEMO_LEADS } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { MobileSection } from './ui/mobile-sheet';

// ─── Admin UIDs (supplement email-based checks) ─────────────────────
const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];

// ── Display-level title cleaner ──
function cleanDisplayTitle(raw: string): string {
  if (!raw) return '';
  let t = raw.trim();
  t = t.replace(/\s+(?:at|@)\s+.+$/i, '').trim();
  t = t.replace(/\s*[|–—]\s*[A-Z].+$/, '').trim();
  if (/^(i |we |my |our |helping |passionate |dedicated |experienced |results|driving |building |creating |empowering |enabling |transforming |committed |focused on |specializ)/i.test(t)) {
    const realPart = t.match(/^([\w\s/&-]+?)\s+(?:who|that|with|helping|passionate|dedicated|\||[-–—]|\.)/i);
    if (realPart && realPart[1].length >= 3 && realPart[1].length <= 50) {
      t = realPart[1].trim();
    } else {
      return '';
    }
  }
  t = t.replace(/\s*(?:specializ\w+|focused on|passionate about|with expertise|responsible for|helping|dedicated to)\s+.*/i, '').trim();
  t = t.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  t = t.replace(/\s*\/\s*/g, '/').replace(/\s{2,}/g, ' ');
  t = t.replace(/[.,;:!]+$/, '').trim();
  if (t.length > 55) t = t.substring(0, 55).replace(/\s+\S*$/, '').trim();
  const words = t.split(/\s+/);
  if (words.length > 7 && !/\b(officer|president|director|manager|head|lead|chief|founder|owner|partner|vp|svp|evp|avp)\b/i.test(t)) return '';
  return t;
}

// ── Display-level company name cleaner ──
function cleanDisplayCompany(raw: string): string {
  if (!raw) return '';
  let c = raw.trim();
  c = c.replace(/\.+$/, '').trim();
  c = c.replace(/\s*(?:https?:\/\/|www\.)\S+/i, '').trim();
  c = c.replace(/\s*[-–—]\s+(?:A |The |Your |We |Leading |Premier |Top |Best |Trusted ).*/i, '').trim();
  c = c.replace(/\s{2,}/g, ' ');
  return c;
}

function formatDollar(val: number | undefined): string | undefined {
  if (!val) return undefined;
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(val % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val.toLocaleString()}`;
}

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
  short_description?: string;
  founded_year?: number;
}

interface LeadEmail {
  id: string;
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
  phone: string;
  type: 'work_direct' | 'home' | 'mobile' | 'corporate' | 'other';
}

interface LeadCustomField {
  id: string;
  key: string;
  value: any;
}

interface LeadDetail {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: string;
  departments?: string[];
  stage?: string;
  lists?: string[];
  account_owner?: string;
  last_contacted?: string;
  last_engagement_date?: string;
  person_linkedin_url?: string;
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
  created_at: string;
  company?: Company | null;
  emails?: LeadEmail[];
  phones?: LeadPhone[];
  custom_fields?: LeadCustomField[];
  emails_sent?: number;
  emails_opened?: number;
  emails_clicked?: number;
}

interface LeadDetailModalProps {
  leadId: string;
  onClose: () => void;
}

export function LeadDetailModal({ leadId, onClose }: LeadDetailModalProps) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'contact' | 'company' | 'engagement' | 'custom'>('overview');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showPipelineModal, setShowPipelineModal] = useState(false);

  // Team outreach state
  const [teamOutreach, setTeamOutreach] = useState<{ contacted_by: string; contacted_by_email: string; is_you: boolean; campaign_name: string; sent_at: string; status: string }[]>([]);

  // Score breakdown state
  const [scoreBreakdown, setScoreBreakdown] = useState<{
    totalScore: number;
    grade: string;
    factors: {
      dataCompleteness: number;
      contactQuality: number;
      companySize: number;
      industryValue: number;
      titleValue: number;
      engagement: number;
      recency: number;
      status: number;
      intentScore: number;
    };
    recommendations: string[];
  } | null>(null);
  const [loadingScore, setLoadingScore] = useState(false);

  // ── Demo mode: build a synthetic LeadDetail from DEMO_LEADS ──
  const demoLeadDetail = useMemo<LeadDetail | null>(() => {
    if (!isDemoMode) return null;
    const dl = DEMO_LEADS.find(l => l.id === leadId);
    if (!dl) return null;
    const nameParts = (dl.contact_name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    // Synthetic company data enrichment per demo lead
    const companyMeta: Record<string, { employees?: string; industry?: string; revenue?: number; founded?: number; linkedin?: string; description?: string }> = {
      'Stripe': { employees: '8000+', industry: 'Fintech', revenue: 14_000_000_000, founded: 2010, linkedin: 'https://linkedin.com/company/stripe', description: 'Financial infrastructure for the internet' },
      'Notion': { employees: '1500+', industry: 'SaaS / Productivity', revenue: 800_000_000, founded: 2013, linkedin: 'https://linkedin.com/company/notion-hq', description: 'Connected workspace for notes, docs, and projects' },
      'Linear': { employees: '150+', industry: 'SaaS / Developer Tools', revenue: 50_000_000, founded: 2019, linkedin: 'https://linkedin.com/company/linear-app', description: 'Issue tracking & project management for software teams' },
      'Vercel': { employees: '800+', industry: 'Developer Tools', revenue: 250_000_000, founded: 2015, linkedin: 'https://linkedin.com/company/vercel', description: 'Frontend cloud for building web experiences' },
      'Figma': { employees: '1200+', industry: 'Design', revenue: 600_000_000, founded: 2012, linkedin: 'https://linkedin.com/company/figma', description: 'Collaborative interface design tool' },
      'Shopify': { employees: '12000+', industry: 'E-commerce', revenue: 7_000_000_000, founded: 2006, linkedin: 'https://linkedin.com/company/shopify', description: 'Commerce platform for businesses of all sizes' },
      'Datadog': { employees: '5000+', industry: 'Monitoring & Analytics', revenue: 2_100_000_000, founded: 2010, linkedin: 'https://linkedin.com/company/datadog', description: 'Monitoring & security platform for cloud applications' },
      'Airtable': { employees: '1000+', industry: 'SaaS / Productivity', revenue: 400_000_000, founded: 2012, linkedin: 'https://linkedin.com/company/airtable', description: 'Low-code platform for building collaborative apps' },
      'Retool': { employees: '500+', industry: 'Developer Tools', revenue: 100_000_000, founded: 2017, linkedin: 'https://linkedin.com/company/retool', description: 'Build internal tools remarkably fast' },
      'Loom': { employees: '400+', industry: 'SaaS / Video', revenue: 150_000_000, founded: 2015, linkedin: 'https://linkedin.com/company/laboriously', description: 'Video messaging for work' },
      'Amplitude': { employees: '1000+', industry: 'Analytics', revenue: 280_000_000, founded: 2012, linkedin: 'https://linkedin.com/company/amplitude-analytics', description: 'Digital analytics platform' },
      'PlanetScale': { employees: '200+', industry: 'Database', revenue: 50_000_000, founded: 2018, linkedin: 'https://linkedin.com/company/planetscale', description: 'Serverless MySQL database platform' },
    };
    const cm = companyMeta[dl.business_name] || {};
    const seniorityGuess: Record<string, string> = {
      'Sarah Chen': 'vp', 'James Park': 'director', 'Karri Saarinen': 'founder',
      'Guillermo Rauch': 'founder', 'Dylan Field': 'founder', 'Tobi Lutke': 'founder',
      'Olivier Pomel': 'founder', 'Howie Liu': 'founder', 'David Hsu': 'founder',
      'Joe Thomas': 'founder', 'Spenser Skates': 'founder', 'Sam Lambert': 'c_suite',
    };
    const titleGuess: Record<string, string> = {
      'Sarah Chen': 'VP of Partnerships', 'James Park': 'Director of Sales', 'Karri Saarinen': 'Co-founder & CEO',
      'Guillermo Rauch': 'Founder & CEO', 'Dylan Field': 'Co-founder & CEO', 'Tobi Lutke': 'Founder & CEO',
      'Olivier Pomel': 'Co-founder & CEO', 'Howie Liu': 'Co-founder & CEO', 'David Hsu': 'Founder & CEO',
      'Joe Thomas': 'Co-founder & CEO', 'Spenser Skates': 'Co-founder & CEO', 'Sam Lambert': 'CEO',
    };
    return {
      id: dl.id,
      first_name: firstName,
      last_name: lastName,
      title: titleGuess[dl.contact_name] || 'Executive',
      seniority: seniorityGuess[dl.contact_name] || 'manager',
      departments: ['executive'],
      stage: dl.status,
      lists: ['Demo Leads'],
      person_linkedin_url: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase().replace(/\s/g, '-')}`,
      city: dl.city,
      state: dl.state,
      country: 'United States',
      last_contacted: dl.last_contacted || undefined,
      email_sent: dl.status !== 'new',
      email_open: dl.status === 'replied' || dl.status === 'interested',
      replied: dl.status === 'replied' || dl.status === 'interested',
      created_at: '2026-02-15T10:00:00Z',
      company: {
        id: `demo-co-${dl.id}`,
        name: dl.business_name,
        website: dl.website,
        industry: cm.industry || dl.category,
        employees: cm.employees,
        annual_revenue: cm.revenue,
        linkedin_url: cm.linkedin,
        city: dl.city,
        state: dl.state,
        country: 'United States',
        short_description: cm.description,
        founded_year: cm.founded,
      } as Company,
      emails: [{ id: `demo-email-${dl.id}`, email: dl.email, type: 'primary' as const, status: 'verified', confidence: 'high' }],
      phones: dl.phone ? [{ id: `demo-phone-${dl.id}`, phone: dl.phone, type: 'work_direct' as const }] : [],
      custom_fields: [],
      emails_sent: dl.status !== 'new' ? Math.floor(Math.random() * 4) + 1 : 0,
      emails_opened: dl.status === 'replied' || dl.status === 'interested' ? Math.floor(Math.random() * 3) + 1 : 0,
      emails_clicked: dl.status === 'interested' ? 1 : 0,
    };
  }, [isDemoMode, leadId]);

  // Quo dialer: check if current user is internal (admin or @contndr.com)
  const [isInternalUser, setIsInternalUser] = useState(false);
  useEffect(() => {
    if (isDemoMode) return; // Skip auth check in demo
    supabase.auth.getSession().then(({ data }) => {
      const email = data?.session?.user?.email?.toLowerCase().trim();
      const userId = data?.session?.user?.id;
      if (!email) return;
      const INTERNAL = ['or@contndr.com', 'or@roadr.com', 'admin@contndr.com'];
      setIsInternalUser(INTERNAL.includes(email) || email.endsWith('@contndr.com') || (userId && ADMIN_UIDS.includes(userId)));
    });
  }, [isDemoMode]);

  // ── Demo mode: populate lead from demo data immediately ──
  useEffect(() => {
    if (!isDemoMode) return;
    if (demoLeadDetail) {
      setLead(demoLeadDetail);
      // Provide a synthetic score breakdown for demo
      setScoreBreakdown({
        totalScore: 72 + Math.floor(Math.random() * 18),
        grade: 'A',
        factors: {
          dataCompleteness: 18, contactQuality: 12, companySize: 10,
          industryValue: 8, titleValue: 9, engagement: 7, recency: 6, status: 5, intentScore: 4,
        },
        recommendations: [
          'Strong lead with verified contact info',
          'Consider personalized outreach referencing their product',
          'Follow up within 48 hours for best conversion',
        ],
      });
      setLoading(false);
    } else {
      setLoading(false);
      toast.error(t('leadDetail.demoLeadNotFound'));
      onClose();
    }
  }, [isDemoMode, demoLeadDetail, onClose]);

  useEffect(() => {
    if (isDemoMode) return; // Skip API fetch in demo mode
    // Validate leadId is a proper UUID before attempting to fetch
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(leadId)) {
      console.warn('[LeadDetailModal] Invalid lead ID format, closing modal:', leadId);
      setLoading(false);
      toast.error(t('leadDetail.invalidLeadId'));
      onClose();
      return;
    }
    fetchLeadDetail();
  }, [leadId, onClose, isDemoMode]);

  // Fetch score breakdown when lead loads
  useEffect(() => {
    if (!lead || isDemoMode) return; // Skip in demo — already set above
    async function fetchScoreBreakdown() {
      setLoadingScore(true);
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${lead!.id}/score-breakdown`,
          { headers }
        );
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setScoreBreakdown(data.breakdown);
          }
        }
      } catch (err) {
        console.error('[LEAD DETAIL] Score breakdown fetch error:', err);
      } finally {
        setLoadingScore(false);
      }
    }
    fetchScoreBreakdown();
  }, [lead?.id, isDemoMode]);

  // Check team outreach when lead loads
  useEffect(() => {
    if (!lead || isDemoMode) return; // Skip in demo
    const email = lead.emails?.find(e => e.type === 'primary')?.email || lead.emails?.[0]?.email;
    if (!email) return;

    async function checkTeamOutreach() {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/contact-check`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ emails: [email] }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          const contacts = data.contacts?.[email!.toLowerCase()] || [];
          setTeamOutreach(contacts);
        }
      } catch (err) {
        console.error('[LEAD DETAIL] Team outreach check error:', err);
      }
    }
    checkTeamOutreach();
  }, [lead?.id, isDemoMode]);

  async function fetchLeadDetail() {
    try {
      const headers = await getAuthHeaders();
      
      if (!headers.Authorization) {
        setLoading(false);
        return;
      }
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${leadId}`,
        { headers }
      );

      if (response.status === 401) {
        setLoading(false);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setLead(data);
      }
    } catch (error) {
      console.error('Error fetching lead detail:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(newStatus: string) {
    if (!lead) return;
    setUpdatingStatus(true);
    setShowStatusDropdown(false);

    // Demo mode: just update local state, skip API
    if (isDemoMode) {
      setLead(prev => prev ? { ...prev, stage: newStatus, status: newStatus } : null);
      toast.success(t('leadDetail.statusUpdatedTo', { status: newStatus }));
      setUpdatingStatus(false);
      return;
    }
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${lead.id}/status`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: newStatus })
        }
      );

      if (response.ok) {
        setLead(prev => prev ? { ...prev, stage: newStatus, status: newStatus } : null);
        toast.success(t('leadDetail.statusUpdatedTo', { status: newStatus }));
        dispatchAppEvent({ type: 'leads:updated', ids: [lead.id], meta: { status: newStatus } });
      } else {
        throw new Error(await response.text());
      }
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error(t('leadDetail.failedToUpdateStatus'));
    } finally {
      setUpdatingStatus(false);
    }
  }

  // ── Inline edit handler: update local state after save ──
  // Must be declared before early returns to satisfy Rules of Hooks
  const handleFieldSaved = useCallback((dbField: string, newValue: string) => {
    setLead(prev => {
      if (!prev) return prev;
      const updated = { ...prev };
      switch (dbField) {
        case 'contact_name': {
          const parts = newValue.split(' ');
          updated.first_name = parts[0] || '';
          updated.last_name = parts.slice(1).join(' ') || '';
          break;
        }
        case 'title':
          updated.title = newValue;
          break;
        case 'industry':
          if (updated.company) updated.company = { ...updated.company, industry: newValue };
          break;
        case 'city':
          updated.city = newValue;
          if (updated.company) updated.company = { ...updated.company, city: newValue };
          break;
        case 'state':
          updated.state = newValue;
          if (updated.company) updated.company = { ...updated.company, state: newValue };
          break;
        case 'country':
          updated.country = newValue;
          if (updated.company) updated.company = { ...updated.company, country: newValue };
          break;
        case 'business_name':
          if (updated.company) updated.company = { ...updated.company, name: newValue };
          break;
        case 'website':
          if (updated.company) updated.company = { ...updated.company, website: newValue };
          break;
        case 'linkedin_url':
          updated.person_linkedin_url = newValue;
          break;
        case 'email':
          if (updated.emails && updated.emails.length > 0) {
            updated.emails = [{ ...updated.emails[0], email: newValue }, ...updated.emails.slice(1)];
          }
          break;
        case 'phone':
          if (updated.phones && updated.phones.length > 0) {
            updated.phones = [{ ...updated.phones[0], phone: newValue }, ...updated.phones.slice(1)];
          }
          break;
        case 'seniority':
          updated.seniority = newValue;
          break;
      }
      return updated;
    });
  }, []);

  if (loading) {
    return createPortal(
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[99999]">
        <div className="bg-white dark:bg-black rounded-xl p-8 border border-zinc-200 dark:border-zinc-800 shadow-2xl">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#1ED4A7] border-t-transparent"></div>
        </div>
      </div>,
      document.body
    );
  }

  if (!lead) {
    return createPortal(
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[99999] p-4">
        <div className="bg-white dark:bg-black rounded-xl p-8 border border-zinc-200 dark:border-zinc-800 shadow-2xl">
          <p className="text-zinc-900 dark:text-white font-medium">{t('leadDetail.leadNotFound')}</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
          >
            {t('leadDetail.close')}
          </button>
        </div>
      </div>,
      document.body
    );
  }

  // Filter out placeholder values the tracking system may have stored (e.g. contact_name = 'Visitor')
  const PLACEHOLDER_NAMES = new Set(['Visitor', 'Unknown', 'Anonymous Visitor', 'Anonymous', 'visitor', 'unknown']);
  const cleanFirst = PLACEHOLDER_NAMES.has((lead.first_name || '').trim()) ? '' : (lead.first_name || '');
  const cleanLast  = PLACEHOLDER_NAMES.has((lead.last_name  || '').trim()) ? '' : (lead.last_name  || '');
  const rawFullName = [cleanFirst, cleanLast].filter(Boolean).join(' ');
  const fullName = toTitleCase(rawFullName) || toTitleCase(lead.company?.name || '') || 'Unknown';
  const primaryEmail = lead.emails?.find(e => e.type === 'primary');
  const companyName = toTitleCase(lead.company?.name) || 'Unknown Company';
  
  const statusColors: Record<string, string> = {
    'Hot': 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-transparent dark:border-red-500/20',
    'Warm': 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400 border border-transparent dark:border-orange-500/20',
    'Cold': 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 border border-transparent dark:border-blue-500/20',
    'Interested': 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20',
    'Customer': 'bg-[#1ED4A7]/15 text-[#1ED4A7] border border-[#1ED4A7]/30',
    'Churned': 'bg-zinc-100 text-zinc-700 dark:bg-white/5 dark:text-zinc-300 border border-transparent dark:border-white/10',
    'Do Not Contact': 'bg-zinc-100 text-zinc-700 dark:bg-white/5 dark:text-zinc-300 border border-transparent dark:border-white/10',
    'Bad Fit': 'bg-zinc-100 text-zinc-700 dark:bg-white/5 dark:text-zinc-300 border border-transparent dark:border-white/10',
  };

  const currentStatus = lead.stage || lead.status || 'Cold';

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-[99998] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Mobile: Bottom Sheet (Fixed Height) | Desktop: Right Sidebar */}
      <div
        className="fixed z-[99999] bg-[#F2F2F7] dark:bg-black flex flex-col overflow-hidden shadow-2xl
                   md:right-0 md:top-0 md:bottom-0 md:w-[480px] md:border-l md:border-zinc-200/50 md:dark:border-zinc-800/50
                   max-md:inset-x-0 max-md:bottom-0 max-md:border-t max-md:border-zinc-200/50 max-md:dark:border-zinc-800/50 max-md:rounded-t-[28px]
                   max-md:animate-in max-md:slide-in-from-bottom md:animate-in md:slide-in-from-right duration-300"
        style={{
          height: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1rem)', // Mobile: fixed height
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle - Mobile Only */}
        <div className="md:hidden flex-shrink-0 pt-3 pb-1 flex justify-center bg-[#F2F2F7] dark:bg-black">
          <div className="w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full opacity-60" />
        </div>

        {/* Top Action Bar */}
        <div className="relative flex justify-between items-center px-4 pt-2 pb-3 shrink-0 bg-[#F2F2F7] dark:bg-black z-20 border-b border-zinc-200/30 dark:border-zinc-800/50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPipelineModal(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-black/5 dark:bg-white/5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors whitespace-nowrap min-h-[44px] tap-target-override shadow-sm"
              title={t('leadDetail.addToPipeline')}
            >
              <TrendingUp className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">{t('leadDetail.addToPipeline')}</span>
              <span className="sm:hidden">Pipeline</span>
            </button>
          </div>
          <button
            onClick={onClose}
            type="button"
            title={t('leadDetail.close')}
            aria-label={t('leadDetail.close')}
            className="hover:opacity-80 transition-opacity tap-target-override flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 shadow-sm"
          >
            <X className="w-5 h-5 text-zinc-700 dark:text-zinc-300" strokeWidth={2.2} />
          </button>
        </div>

        {/* Profile Header */}
        <div className="px-4 pb-4 bg-[#F2F2F7] dark:bg-black shrink-0">
          <div className="flex items-start gap-3">
            <LeadAvatar
              name={fullName}
              email={primaryEmail?.email || lead.emails?.[0]?.email}
              linkedinUrl={lead.person_linkedin_url || lead.linkedin}
              size={64}
              className="ring-2 ring-[#F2F2F7] dark:ring-black shadow-sm shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-col items-start gap-1.5">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white truncate w-full tracking-tight">{fullName}</h2>
                <div className="relative shrink-0">
                  <button
                    onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                    disabled={updatingStatus}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center justify-center gap-1.5 transition-colors hover:opacity-80 whitespace-nowrap capitalize min-h-[32px] tap-target-override shadow-sm ${statusColors[currentStatus] || statusColors['Cold']}`}
                  >
                    {updatingStatus ? '...' : currentStatus.replace(/_/g, ' ')}
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  </button>
                  
                  {showStatusDropdown && (
                    <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-[#1C1C1E] rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700 z-50 overflow-hidden py-1">
                      {['Hot', 'Warm', 'Cold', 'Interested', 'Customer', 'Churned', 'Bad Fit', 'Do Not Contact'].map((status) => (
                        <button
                          key={status}
                          onClick={() => updateStatus(status)}
                          className={`w-full text-left px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors flex items-center justify-between min-h-[44px] tap-target-override ${
                            currentStatus === status ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' : 'text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          {status}
                          {currentStatus === status && <CheckCircle className="w-4 h-4" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="space-y-1">
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
                  {cleanDisplayTitle(lead.title) || lead.title || t('leadDetail.noTitle')} {t('leadDetail.atCompany')} {cleanDisplayCompany(companyName)}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {primaryEmail && (
                    <span className="flex items-center gap-1 min-w-0">
                      <Mail className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{primaryEmail.email}</span>
                    </span>
                  )}
                  {(lead.person_linkedin_url || (lead as any).linkedin) && (
                    <a
                      href={lead.person_linkedin_url || (lead as any).linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 whitespace-nowrap text-[#0A66C2] hover:text-[#0A66C2]/80 transition-colors"
                    >
                      <Linkedin className="w-3.5 h-3.5 shrink-0" />
                      <span>LinkedIn</span>
                      <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                    </a>
                  )}
                  {lead.city && (
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      {lead.city}{lead.state ? `, ${lead.state}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs - horizontally scrollable */}
        <div className="border-b border-zinc-200/50 dark:border-zinc-800/50 px-4 bg-[#F2F2F7] dark:bg-black shrink-0">
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" style={{ WebkitOverflowScrolling: 'touch' } as any}>
            {[
              { id: 'overview', label: t('leadDetail.tabOverview'), icon: Briefcase },
              { id: 'activity', label: t('leadDetail.tabActivity'), icon: Activity },
              { id: 'contact', label: t('leadDetail.tabContact'), icon: Mail },
              { id: 'company', label: t('leadDetail.tabCompany'), icon: Building },
              { id: 'engagement', label: t('leadDetail.tabEngagement'), icon: TrendingUp },
              { id: 'custom', label: t('leadDetail.tabCustom'), icon: Tag },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center justify-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap text-sm shrink-0 min-h-[48px] tap-target-override ${
                  activeTab === tab.id
                    ? 'border-[#1ED4A7] text-[#1ED4A7] font-medium'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto bg-white dark:bg-black text-zinc-900 dark:text-zinc-100 overscroll-contain custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' } as any}>
          {activeTab === 'activity' && (
            <div className="h-full">
               <ActivityFeed leadId={lead.id} />
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
              <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                <EditableInfoCard
                  label={t('leadDetail.firstName')} value={lead.first_name} dbField="contact_name" leadId={lead.id}
                  buildPayload={(val) => ({ contact_name: [val, lead.last_name].filter(Boolean).join(' ') })}
                  onSaved={(_, val) => handleFieldSaved('contact_name', [val, lead.last_name].filter(Boolean).join(' '))}
                  placeholder={t('leadDetail.firstNamePlaceholder')}
                />
                <EditableInfoCard
                  label={t('leadDetail.lastName')} value={lead.last_name} dbField="contact_name" leadId={lead.id}
                  buildPayload={(val) => ({ contact_name: [lead.first_name, val].filter(Boolean).join(' ') })}
                  onSaved={(_, val) => handleFieldSaved('contact_name', [lead.first_name, val].filter(Boolean).join(' '))}
                  placeholder={t('leadDetail.lastNamePlaceholder')}
                />
                <EditableInfoCard label={t('leadDetail.jobTitle')} value={lead.title} dbField="title" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.jobTitlePlaceholder')} />
                <EditableInfoCard label={t('leadDetail.seniority')} value={lead.seniority} dbField="seniority" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.seniorityPlaceholder')} />
                <InfoCard label={t('leadDetail.stage')} value={lead.stage}>
                  <span className={`inline-flex px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap capitalize ${
                    lead.stage === 'Hot' ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-transparent dark:border-red-500/20' :
                    lead.stage === 'Warm' ? 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400 border border-transparent dark:border-orange-500/20' :
                    lead.stage === 'Interested' || lead.stage === 'Customer' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20' :
                    'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 border border-transparent dark:border-blue-500/20'
                  }`}>
                    {(lead.stage || 'Cold').replace(/_/g, ' ')}
                  </span>
                </InfoCard>
                <InfoCard label={t('leadDetail.accountOwner')} value={lead.account_owner} />
                <InfoCard label={t('leadDetail.lastContacted')} value={lead.last_contacted ? new Date(lead.last_contacted).toLocaleDateString() : undefined} />
                <InfoCard label={t('leadDetail.lastEngagement')} value={lead.last_engagement_date ? new Date(lead.last_engagement_date).toLocaleDateString() : t('leadDetail.noEngagementYet')} />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2 px-1">{t('leadDetail.location')}</label>
                <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                  <EditableInfoCard label={t('leadDetail.city')} value={lead.city} dbField="city" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.cityPlaceholder')} />
                  <EditableInfoCard label={t('leadDetail.state')} value={lead.state} dbField="state" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.statePlaceholder')} />
                  <EditableInfoCard label={t('leadDetail.country')} value={lead.country} dbField="country" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.countryPlaceholder')} />
                </div>
              </div>

              {/* Lead Score Breakdown */}
              {(scoreBreakdown || loadingScore) && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-900/50">
                  <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-black">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      {t('leadDetail.leadScore')}
                    </h3>
                    {scoreBreakdown && (
                      <LeadScoreBadge score={scoreBreakdown.totalScore} size="md" />
                    )}
                  </div>
                  {loadingScore ? (
                    <div className="p-6 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                    </div>
                  ) : scoreBreakdown ? (
                    <div className="px-4 py-3 space-y-3">{(() => {
                        const intentVal = scoreBreakdown.factors.intentScore;
                        const factors = [
                          { label: t('leadDetail.scoreData'), value: scoreBreakdown.factors.dataCompleteness },
                          { label: t('leadDetail.scoreContact'), value: scoreBreakdown.factors.contactQuality },
                          { label: t('leadDetail.scoreCompany'), value: scoreBreakdown.factors.companySize },
                          { label: t('leadDetail.scoreIndustry'), value: scoreBreakdown.factors.industryValue },
                          { label: t('leadDetail.scoreTitle'), value: scoreBreakdown.factors.titleValue },
                          { label: t('leadDetail.scoreEngage'), value: scoreBreakdown.factors.engagement },
                          { label: t('leadDetail.scoreRecency'), value: scoreBreakdown.factors.recency },
                          { label: t('leadDetail.scorePipeline'), value: scoreBreakdown.factors.status },
                        ];
                        const isHighIntent = intentVal >= 61;
                        const isMediumIntent = intentVal >= 30 && intentVal < 61;
                        const noIntentData = intentVal === 50;

                        return (
                          <>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                              {factors.map((f) => (
                                <div key={f.label} className="flex items-center gap-2">
                                  <span className="text-xs text-zinc-500 dark:text-zinc-400 w-16 shrink-0 truncate">{f.label}</span>
                                  <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        f.value >= 70 ? 'bg-zinc-900 dark:bg-zinc-100' :
                                        f.value >= 40 ? 'bg-zinc-500 dark:bg-zinc-400' :
                                        'bg-zinc-300 dark:bg-zinc-600'
                                      }`}
                                      style={{ width: `${Math.min(f.value, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-300 w-8 text-right">{Math.round(f.value)}</span>
                                </div>
                              ))}
                            </div>

                            <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${
                              isHighIntent ? 'bg-[#1ED4A7]/5 border border-[#1ED4A7]/20' :
                              isMediumIntent ? 'bg-amber-500/5 border border-amber-500/15' :
                              'bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800'
                            }`}>
                              <Zap className={`w-4 h-4 shrink-0 ${
                                isHighIntent ? 'text-[#1ED4A7]' : isMediumIntent ? 'text-amber-500 dark:text-amber-400' : 'text-zinc-400'
                              }`} />
                              <span className={`text-xs font-medium shrink-0 ${
                                isHighIntent ? 'text-[#1ED4A7]' : isMediumIntent ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'
                              }`}>{t('leadDetail.scoreIntent')}</span>
                              <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isHighIntent ? 'bg-[#1ED4A7]' : isMediumIntent ? 'bg-amber-500 dark:bg-amber-400' : 'bg-zinc-400 dark:bg-zinc-500'
                                  }`}
                                  style={{ width: `${Math.min(intentVal, 100)}%` }}
                                />
                              </div>
                              <span className={`text-xs font-bold tabular-nums w-8 text-right ${
                                isHighIntent ? 'text-[#1ED4A7]' : isMediumIntent ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500'
                              }`}>{Math.round(intentVal)}</span>
                              <span className={`text-[10px] ml-1 shrink-0 ${
                                isHighIntent ? 'text-[#1ED4A7]/70' : isMediumIntent ? 'text-amber-500/60' : 'text-zinc-400'
                              }`}>
                                {isHighIntent ? t('leadDetail.intentPrioritize') : isMediumIntent ? t('leadDetail.intentWarming') : noIntentData ? t('leadDetail.intentNoData') : t('leadDetail.intentLow')}
                              </span>
                            </div>

                            {scoreBreakdown.recommendations.length > 0 && (
                              <div className="pt-2 mt-2 border-t border-zinc-100 dark:border-zinc-800">
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                  {scoreBreakdown.recommendations.slice(0, 3).map((rec, i) => (
                                    <span key={i} className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                                      <ArrowUpRight className="w-3 h-3 shrink-0" />
                                      {rec}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Team Outreach History */}
              {teamOutreach.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
                  <div className="px-4 py-3 border-b border-amber-500/10 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-amber-400">
                      {t('leadDetail.teamOutreachHistory')}
                    </h3>
                    <span className="text-xs text-amber-400/60 ml-1">
                      {teamOutreach.length !== 1 ? t('leadDetail.outreachesFromTeam', { count: teamOutreach.length }) : t('leadDetail.outreachFromTeam', { count: teamOutreach.length })}
                    </span>
                  </div>
                  <div className="divide-y divide-amber-500/10">
                    {teamOutreach.map((outreach, idx) => (
                      <div key={idx} className="px-4 py-3 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          outreach.is_you
                            ? 'bg-[#1ED4A7]/20 border border-[#1ED4A7]/30 text-[#1ED4A7]'
                            : 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                        }`}>
                          {outreach.contacted_by[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">
                            {outreach.is_you ? t('leadDetail.youLabel') : outreach.contacted_by}
                            <span className="font-normal text-zinc-500 dark:text-zinc-400"> {t('leadDetail.contactedThisLead')}</span>
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {t('leadDetail.campaignLabel')} <span className="text-zinc-700 dark:text-zinc-300">{outreach.campaign_name}</span>
                            {' · '}
                            {new Date(outreach.sent_at).toLocaleDateString()}
                            {' · '}
                            <span className="capitalize">{outreach.status}</span>
                          </p>
                        </div>
                        <Send className={`w-4 h-4 flex-shrink-0 ${outreach.is_you ? 'text-[#1ED4A7]' : 'text-amber-400'}`} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Company Information */}
              {lead.company && (
                <div>
                  <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 px-1 mb-2 flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    {t('leadDetail.companyInformation')}
                  </h3>
                  <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                    <EditableInfoCard label={t('leadDetail.companyName')} value={lead.company.name} dbField="business_name" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.companyNamePlaceholder')} />
                    <EditableInfoCard label={t('leadDetail.industry')} value={toTitleCase(lead.company.industry)} dbField="industry" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.industryPlaceholder')} />
                    <InfoCard label={t('leadDetail.employees')} value={lead.company.employees || (lead as any).employees} />
                    <EditableInfoCard label={t('leadDetail.website')} value={lead.company.website} dbField="website" leadId={lead.id} onSaved={handleFieldSaved} placeholder={t('leadDetail.websitePlaceholder')} />
                    <InfoCard label={t('leadDetail.annualRevenue')} value={formatDollar(lead.company.annual_revenue)} />
                    <InfoCard label={t('leadDetail.totalFunding')} value={formatDollar(lead.company.total_funding)} />
                    <InfoCard label={t('leadDetail.latestFunding')} value={lead.company.latest_funding} />
                    <InfoCard label={t('leadDetail.latestFundingAmount')} value={formatDollar(lead.company.latest_funding_amount)} />
                  </div>
                </div>
              )}
              
              {lead.departments && (Array.isArray(lead.departments) ? lead.departments.length > 0 : lead.departments.trim()) && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-400 mb-2">{t('leadDetail.departments')}</label>
                  <div className="flex flex-wrap gap-2">
                    {(Array.isArray(lead.departments) ? lead.departments : lead.departments.split(',')).map((dept, i) => (
                      <span key={i} className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-full text-sm">
                        {typeof dept === 'string' ? dept.trim() : dept}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {lead.lists && (Array.isArray(lead.lists) ? lead.lists.length > 0 : lead.lists.trim()) && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-400 mb-2">Lists</label>
                  <div className="flex flex-wrap gap-2">
                    {(Array.isArray(lead.lists) ? lead.lists : lead.lists.split(',')).map((list, i) => (
                      <span key={i} className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-full text-sm">
                        {typeof list === 'string' ? list.trim() : list}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Export to CRM ─────────────────── */}
              <LeadCrmExport lead={lead} primaryEmail={primaryEmail} />
            </div>
          )}

          {activeTab === 'contact' && (
            <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
              {/* Emails */}
              <div>
                <h3 className="text-base sm:text-lg font-semibold mb-4 flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                  <Mail className="w-5 h-5" />
                  Email Addresses
                </h3>
                {lead.emails && lead.emails.length > 0 ? (
                  <div className="space-y-3">
                    {lead.emails.map((email, i) => (
                      <div key={i} className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-zinc-50 dark:bg-zinc-900/50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-3">
                              <span className="font-medium text-base text-zinc-900 dark:text-zinc-100">{email.email}</span>
                              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                                email.type === 'primary' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                                email.type === 'secondary' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300' :
                                'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                              }`}>
                                {email.type}
                              </span>
                              {email.status && (
                                <span className="px-2.5 py-1 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                                  {email.status}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                              {email.source && (
                                <div>
                                  <span className="font-medium">Source:</span> {email.source}
                                </div>
                              )}
                              {email.verification_source && (
                                <div>
                                  <span className="font-medium">Verified by:</span> {email.verification_source}
                                </div>
                              )}
                              {email.confidence && (
                                <div>
                                  <span className="font-medium">Confidence:</span> {email.confidence}
                                </div>
                              )}
                              {email.catch_all_status && (
                                <div>
                                  <span className="font-medium">Catch-all:</span> {email.catch_all_status}
                                </div>
                              )}
                              {email.last_verified_at && (
                                <div>
                                  <span className="font-medium">Last verified:</span> {new Date(email.last_verified_at).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 dark:text-zinc-500">No email addresses on file</p>
                )}
              </div>

              {/* Phones */}
              <div>
                <h3 className="text-base sm:text-lg font-semibold mb-4 flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                  <Phone className="w-5 h-5" />
                  Phone Numbers
                </h3>
                {lead.phones && lead.phones.length > 0 ? (
                  <div className="space-y-3">
                    {lead.phones.map((phone, i) => (
                      <div key={i} className="flex items-center justify-between p-4 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 min-h-[60px]">
                        <SmartPhoneButton
                          phone={phone.phone}
                          leadName={`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || undefined}
                          businessName={lead.company?.name}
                          leadId={lead.id}
                          showNumber
                          displayNumber={formatPhoneDisplay(phone.phone)}
                          iconClassName="w-4 h-4"
                          numberClassName="text-base font-medium text-zinc-900 dark:text-zinc-100"
                        />
                        <span className="px-3 py-1.5 rounded-full text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 capitalize">
                          {phone.type.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 dark:text-zinc-500">No phone numbers on file</p>
                )}
              </div>

              {/* Quo Dialer — internal/admin users only */}
              {isInternalUser && (
                <div className="mt-6">
                  <QuoDialer
                    leadId={lead.id}
                    leadName={`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown'}
                    businessName={lead.company?.name || ''}
                    phones={lead.phones || []}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'company' && lead.company && (
            <div className="p-4 sm:p-6 space-y-6">
              <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                <EditableInfoCard label="Company Name" value={lead.company.name} dbField="business_name" leadId={lead.id} onSaved={handleFieldSaved} placeholder="Company name" />
                <InfoCard label="Name for Emails" value={lead.company.name_for_emails} />
                <EditableInfoCard label="Industry" value={toTitleCase(lead.company.industry)} dbField="industry" leadId={lead.id} onSaved={handleFieldSaved} placeholder="Industry" />
                <InfoCard label="Employees" value={lead.company.employees || (lead as any).employees} />
                <EditableInfoCard label="Website" value={lead.company.website} dbField="website" leadId={lead.id} onSaved={handleFieldSaved} placeholder="https://example.com" />
                <InfoCard label="Company Phone" value={lead.company.company_phone} />
              </div>

              {(lead.company.linkedin_url || lead.company.facebook_url || lead.company.twitter_url) && (
                <div>
                  <label className="block text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2 px-1">Social Links</label>
                  <div className="flex gap-3">
                    {lead.company.linkedin_url && (
                      <a href={lead.company.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center min-w-[44px] min-h-[44px] w-12 h-12 rounded-xl bg-[#1ED4A7]/10 text-[#1ED4A7] hover:bg-[#1ED4A7]/20 transition-colors tap-target-override" title="LinkedIn">
                        <Linkedin className="w-5 h-5" />
                      </a>
                    )}
                    {lead.company.facebook_url && (
                      <a href={lead.company.facebook_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center min-w-[44px] min-h-[44px] w-12 h-12 rounded-xl bg-[#1ED4A7]/10 text-[#1ED4A7] hover:bg-[#1ED4A7]/20 transition-colors tap-target-override" title="Facebook">
                        <Facebook className="w-5 h-5" />
                      </a>
                    )}
                    {lead.company.twitter_url && (
                      <a href={lead.company.twitter_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center min-w-[44px] min-h-[44px] w-12 h-12 rounded-xl bg-[#1ED4A7]/10 text-[#1ED4A7] hover:bg-[#1ED4A7]/20 transition-colors tap-target-override" title="Twitter">
                        <Twitter className="w-5 h-5" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2 px-1">Location</label>
                <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                  <InfoCard label="Address" value={lead.company.address_full} />
                  <EditableInfoCard label="City" value={lead.company.city || lead.city} dbField="city" leadId={lead.id} onSaved={handleFieldSaved} placeholder="City" />
                  <EditableInfoCard label="State" value={lead.company.state || lead.state} dbField="state" leadId={lead.id} onSaved={handleFieldSaved} placeholder="State" />
                  <EditableInfoCard label="Country" value={lead.company.country || lead.country} dbField="country" leadId={lead.id} onSaved={handleFieldSaved} placeholder="Country" />
                </div>
              </div>

              {/* Financials */}
              <div>
                <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 px-1 mb-2 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Financials
                </h3>
                <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                  <InfoCard label="Annual Revenue" value={formatDollar(lead.company.annual_revenue)} />
                  <InfoCard label="Total Funding" value={formatDollar(lead.company.total_funding)} />
                  <InfoCard label="Latest Funding" value={lead.company.latest_funding} />
                  <InfoCard label="Latest Funding Amount" value={formatDollar(lead.company.latest_funding_amount)} />
                  <InfoCard label="Last Raised At" value={lead.company.last_raised_at ? new Date(lead.company.last_raised_at).toLocaleDateString() : undefined} />
                  <InfoCard label="Subsidiary Of" value={lead.company.subsidiary_of} />
                </div>
              </div>

              {/* Other Details */}
              <div>
                <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 px-1 mb-2 flex items-center gap-2">
                  <Building className="w-4 h-4" />
                  Other Details
                </h3>
                <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                  <InfoCard label="Retail Locations" value={lead.company.number_of_retail_locations?.toString()} />
                  <InfoCard label="Account ID" value={lead.company.apollo_account_id} />
                </div>
              </div>

              {lead.company.technologies && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-400 mb-2">Technologies</label>
                  <p className="text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm">{lead.company.technologies}</p>
                </div>
              )}

              {lead.company.keywords && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-400 mb-2">Keywords</label>
                  <p className="text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm">{lead.company.keywords}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'engagement' && (
            <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
              {/* Engagement Metrics */}
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                  <TrendingUp className="w-5 h-5" />
                  Your Engagement Metrics
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-zinc-900 p-4 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Send className="w-4 h-4 text-zinc-400" />
                      <span className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Sent</span>
                    </div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-white">{lead.emails_sent || 0}</div>
                  </div>
                  <div className="bg-white dark:bg-zinc-900 p-4 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Eye className="w-4 h-4 text-[#1ED4A7]" />
                      <span className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Opens</span>
                    </div>
                    <div className="text-2xl font-bold text-[#1ED4A7]">{lead.emails_opened || 0}</div>
                  </div>
                  <div className="bg-white dark:bg-zinc-900 p-4 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2 mb-2">
                      <MousePointer className="w-4 h-4 text-[#1ED4A7]" />
                      <span className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Clicks</span>
                    </div>
                    <div className="text-2xl font-bold text-[#1ED4A7]">{lead.emails_clicked || 0}</div>
                  </div>
                  <div className="bg-white dark:bg-zinc-900 p-4 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Mail className="w-4 h-4 text-zinc-400" />
                      <span className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Replied</span>
                    </div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-white">{lead.replied ? '1' : '0'}</div>
                  </div>
                </div>
              </div>

              {/* Status Flags */}
              <div className="flex flex-wrap gap-2">
                {lead.email_sent && (
                  <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Send className="w-3 h-3" /> Email Sent
                  </span>
                )}
                {lead.email_open && (
                  <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#1ED4A7]/10 text-[#1ED4A7] flex items-center gap-1.5">
                    <Eye className="w-3 h-3" /> Opened
                  </span>
                )}
                {lead.email_bounced && (
                  <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" /> Bounced
                  </span>
                )}
                {lead.replied && (
                  <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#1ED4A7]/15 text-[#1ED4A7] flex items-center gap-1.5">
                    <Mail className="w-3 h-3" /> Replied
                  </span>
                )}
                {lead.demoed && (
                  <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#1ED4A7]/15 text-[#1ED4A7] flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3" /> Demoed
                  </span>
                )}
              </div>

              {/* Team Outreach History */}
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                  <Users className="w-5 h-5" />
                  Team Outreach History
                  {teamOutreach.length > 0 && (
                    <span className="ml-1 px-2 py-0.5 bg-[#1ED4A7]/10 text-[#1ED4A7] text-xs rounded-full font-medium">
                      {teamOutreach.length}
                    </span>
                  )}
                </h3>
                {teamOutreach.length > 0 ? (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {teamOutreach.map((outreach, idx) => (
                        <div key={idx} className="px-4 py-3.5 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            outreach.is_you
                              ? 'bg-[#1ED4A7]/20 border border-[#1ED4A7]/30 text-[#1ED4A7]'
                              : 'bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                          }`}>
                            {outreach.contacted_by?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-900 dark:text-white">
                              {outreach.is_you ? 'You' : outreach.contacted_by}
                              <span className="font-normal text-zinc-500 dark:text-zinc-400"> sent an email</span>
                            </p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <Briefcase className="w-3 h-3" />
                                {outreach.campaign_name || 'Direct'}
                              </span>
                              <span className="text-xs text-zinc-400">·</span>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(outreach.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                              <span className="text-xs text-zinc-400">·</span>
                              <span className={`text-xs font-medium capitalize px-1.5 py-0.5 rounded ${
                                outreach.status === 'opened' || outreach.status === 'clicked' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                                outreach.status === 'bounced' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300' :
                                outreach.status === 'replied' ? 'bg-[#1ED4A7]/15 text-[#1ED4A7]' :
                                'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                              }`}>
                                {outreach.status || 'sent'}
                              </span>
                            </div>
                          </div>
                          <Send className={`w-4 h-4 flex-shrink-0 ${outreach.is_you ? 'text-[#1ED4A7]' : 'text-zinc-300 dark:text-zinc-600'}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-8 text-center">
                    <Users className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      No team outreach recorded for this lead yet.
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                      Outreach from all team members will appear here automatically.
                    </p>
                  </div>
                )}
              </div>

              {/* Key Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {lead.last_contacted && (
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-4 h-4 text-zinc-400" />
                      <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Last Contacted</span>
                    </div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">
                      {new Date(lead.last_contacted).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                )}
                {lead.last_engagement_date && (
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp className="w-4 h-4 text-[#1ED4A7]" />
                      <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Last Engagement</span>
                    </div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">
                      {new Date(lead.last_engagement_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="p-4 sm:p-6">
              {lead.custom_fields && lead.custom_fields.length > 0 ? (
                <div className="bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-white/5 shadow-sm">
                  {lead.custom_fields.map((field) => (
                    <InfoCard key={field.id} label={field.key} value={String(field.value)} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
                  <Tag className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No custom fields defined</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showPipelineModal && lead && (
        <AddToPipelineModal
          preselectedLeadIds={[lead.id]}
          preselectedLeads={[{
            id: lead.id,
            contact_name: lead.contact_name || '',
            business_name: lead.business_name || '',
            email: lead.email || lead.emails?.[0]?.email || '',
            category: lead.category || '',
            city: lead.city || '',
          }]}
          onClose={() => setShowPipelineModal(false)}
          onSuccess={(created) => {
            if (created > 0) {
              toast.success(`${lead.contact_name || 'Lead'} added to pipeline`);
            }
          }}
        />
      )}
    </>,
    document.body
  );
}

// ── Single-lead CRM export (HubSpot + Salesforce) ────────────────
const HUBSPOT_API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/hubspot`;
const SALESFORCE_API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/salesforce`;

function LeadCrmExport({ lead, primaryEmail }: { lead: any; primaryEmail: any }) {
  const [exporting, setExporting] = useState<'hubspot' | 'salesforce' | null>(null);
  const [exported, setExported] = useState<Record<string, boolean>>({});

  function buildPayload() {
    return {
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      email: primaryEmail?.email || lead.emails?.[0]?.email || '',
      phone: lead.phones?.[0]?.phone || '',
      job_title: lead.title || '',
      company_name: lead.company?.name || '',
      city: lead.city || '',
      state: lead.state || '',
      country: lead.country || '',
      website: lead.company?.website || '',
      industry: lead.company?.industry || '',
      person_linkedin_url: lead.person_linkedin_url || '',
    };
  }

  async function handleHubSpot() {
    try {
      setExporting('hubspot');
      const payload = buildPayload();
      const res = await authenticatedFetch(`${HUBSPOT_API}/export/bulk`, {
        method: 'POST',
        body: JSON.stringify({ leads: [payload] }),
      });
      const data = await res.json();
      if (data.success) {
        setExported(p => ({ ...p, hubspot: true }));
        toast.success('Exported to HubSpot');
      } else if (res.status === 401) {
        toast.error('HubSpot not connected. Go to Settings → Integrations.');
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'HubSpot export failed');
    } finally {
      setExporting(null);
    }
  }

  async function handleSalesforce() {
    try {
      setExporting('salesforce');
      const payload = buildPayload();
      const res = await authenticatedFetch(`${SALESFORCE_API}/export/lead`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setExported(p => ({ ...p, salesforce: true }));
        toast.success('Exported to Salesforce');
      } else if (res.status === 401) {
        toast.error('Salesforce not connected. Go to Settings → Integrations.');
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Salesforce export failed');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
        <Share2 className="w-5 h-5" />
        Export to CRM
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* HubSpot */}
        <button
          onClick={handleHubSpot}
          disabled={exporting !== null}
          className="flex items-center gap-3.5 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:border-[#FF7A59]/40 hover:bg-[#FF7A59]/5 transition-all group disabled:opacity-60 text-left tap-target-override"
        >
          <div className="w-10 h-10 rounded-lg bg-[#FF7A59]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#FF7A59]/15 transition-colors">
            {exporting === 'hubspot' ? (
              <Loader2 className="w-5 h-5 text-[#FF7A59] animate-spin" />
            ) : exported.hubspot ? (
              <CheckCircle className="w-5 h-5 text-emerald-500" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 31 32" fill="#FF7A59">
                <path d="M23.5121 10.5729V6.7809C24.0149 6.54599 24.4405 6.17299 24.7394 5.70539C25.0382 5.23779 25.198 4.69485 25.2001 4.1399V4.0509C25.198 3.27659 24.8894 2.53459 24.3419 1.98707C23.7944 1.43954 23.0524 1.13101 22.2781 1.1289H22.1891C21.414 1.12996 20.6708 1.43799 20.1223 1.9856C19.5738 2.53321 19.2645 3.27581 19.2621 4.0509V4.1399C19.265 4.6912 19.4235 5.23049 19.7193 5.69574C20.015 6.16099 20.4361 6.53331 20.9341 6.7699L20.9501 6.7799V10.5819C19.4993 10.8021 18.1332 11.4044 16.9921 12.3269L17.0081 12.3169L6.57007 4.1869C7.51307 0.665903 2.91907 -1.5891 0.711073 1.3119C-1.50293 4.2079 1.87807 8.0409 5.02907 6.2079L5.01307 6.2179L15.2731 14.2019C14.3662 15.5639 13.8842 17.1646 13.8881 18.8009C13.8881 20.5869 14.4561 22.2489 15.4191 23.6079L15.4031 23.5819L12.2781 26.7019C12.0281 26.6239 11.7681 26.5819 11.5071 26.5769H11.5021C9.09107 26.5769 7.87707 29.4989 9.58507 31.2069C11.2931 32.9099 14.2151 31.7019 14.2151 29.2899C14.2095 29.019 14.1641 28.7505 14.0801 28.4929L14.0851 28.5139L17.1741 25.4249C18.1818 26.1936 19.3514 26.7226 20.5941 26.9718C21.8368 27.221 23.1199 27.1837 24.3461 26.8629C25.5708 26.5403 26.7058 25.9428 27.6651 25.1158C28.6243 24.2889 29.3825 23.2542 29.882 22.0904C30.3815 20.9266 30.6093 19.6643 30.548 18.3993C30.4866 17.1343 30.1378 15.8999 29.5281 14.7899C28.9183 13.68 28.0632 12.724 27.0279 11.9948C25.9926 11.2655 24.8045 10.7823 23.5541 10.5819L23.5021 10.5719L23.5121 10.5729ZM22.2251 23.0779C18.4181 23.0679 16.5221 18.4629 19.2201 15.7759C21.9131 13.0879 26.5121 14.9949 26.5121 18.8019V18.8069C26.5121 19.3682 26.4014 19.924 26.1865 20.4425C25.9715 20.961 25.6565 21.4321 25.2594 21.8287C24.8622 22.2254 24.3908 22.5399 23.872 22.7542C23.3533 22.9686 22.7974 23.0786 22.2361 23.0779H22.2251Z" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-white group-hover:text-[#FF7A59] transition-colors">
              {exported.hubspot ? 'Exported to HubSpot' : 'HubSpot'}
            </p>
            <p className="text-xs text-zinc-500">Sync contact & company</p>
          </div>
        </button>

        {/* Salesforce */}
        <button
          onClick={handleSalesforce}
          disabled={exporting !== null}
          className="flex items-center gap-3.5 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:border-[#00A1E0]/40 hover:bg-[#00A1E0]/5 transition-all group disabled:opacity-60 text-left tap-target-override"
        >
          <div className="w-10 h-10 rounded-lg bg-[#00A1E0]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#00A1E0]/15 transition-colors">
            {exporting === 'salesforce' ? (
              <Loader2 className="w-5 h-5 text-[#00A1E0] animate-spin" />
            ) : exported.salesforce ? (
              <CheckCircle className="w-5 h-5 text-emerald-500" />
            ) : (
              <svg width="22" height="15" viewBox="0 0 30 21" fill="#00A1E0" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.6666 10.0135H10.4315C10.4638 9.77164 10.5871 9.35167 11.0708 9.35167C11.3872 9.35167 11.6319 9.53072 11.6666 10.0135ZM18.0726 9.36292C18.0506 9.36292 17.4112 9.27996 17.4112 10.3003C17.4112 11.3207 18.0501 11.2378 18.0726 11.2378C18.682 11.2378 18.734 10.6031 18.734 10.3003C18.734 9.28043 18.0937 9.36292 18.0726 9.36292ZM6.6716 10.4766C6.62022 10.5169 6.57937 10.569 6.55251 10.6285C6.52566 10.688 6.5136 10.7531 6.51738 10.8183C6.51738 11.0423 6.61488 11.1018 6.6716 11.1487C6.89191 11.3221 7.37801 11.2481 7.6527 11.1932V10.3992C7.40332 10.3491 6.86847 10.3074 6.6716 10.4766ZM30 9.37417C30 13.4791 26.25 16.6106 22.2487 15.7688C21.3876 17.3155 18.9332 19.0849 16.0518 17.72C14.1224 22.2219 7.71317 22.0406 6.02941 17.4777C0.417502 18.5974 -2.35283 10.9922 2.50111 8.13725C0.872192 4.4143 3.56236 0 7.85942 0C8.75302 0.000554939 9.63452 0.206723 10.4357 0.602543C11.2368 0.998364 11.9361 1.57322 12.4794 2.28261C13.4498 1.27957 14.7951 0.651036 16.2834 0.651036C18.2681 0.651036 19.9865 1.75344 20.9146 3.39626C25.2656 1.48956 30 4.71943 30 9.37417ZM5.64597 10.8647C5.64597 10.3135 5.098 10.1536 4.80831 10.0599C4.56127 9.96099 4.17971 9.89538 4.17971 9.64087C4.17971 9.19747 4.97659 9.32871 5.35956 9.5415C5.35956 9.5415 5.4144 9.57478 5.43643 9.51947C5.44768 9.48666 5.54706 9.21106 5.55784 9.17778C5.56204 9.16466 5.56096 9.15042 5.55484 9.13809C5.54871 9.12575 5.53802 9.11628 5.52503 9.11169C4.94706 8.75407 3.61721 8.71282 3.61721 9.70695C3.61721 10.291 4.1558 10.4306 4.45534 10.5117C4.67659 10.5858 5.07268 10.6523 5.07268 10.9195C5.07268 11.107 4.90721 11.2504 4.64284 11.2504C4.32162 11.2499 4.0092 11.1455 3.75221 10.9528C3.73018 10.942 3.68564 10.9195 3.67486 10.9861L3.56236 11.3362C3.54033 11.3802 3.57314 11.3915 3.57314 11.4023C3.65518 11.4679 4.05596 11.7112 4.64284 11.7112C5.26018 11.7112 5.64597 11.3802 5.64597 10.8623V10.8647ZM7.14597 8.8689C6.67113 8.8689 6.27128 9.01748 6.14284 9.11169C6.13771 9.11525 6.13333 9.11979 6.12998 9.12506C6.12663 9.13033 6.12436 9.13621 6.12331 9.14237C6.12226 9.14853 6.12245 9.15483 6.12388 9.16091C6.1253 9.16699 6.12792 9.17273 6.13159 9.17778L6.253 9.50869C6.2563 9.52018 6.26386 9.52998 6.27414 9.53608C6.28442 9.54218 6.29665 9.54412 6.30831 9.5415C6.33878 9.5415 6.62707 9.35402 7.10191 9.35402C7.28941 9.35402 7.43285 9.38729 7.53223 9.46463C7.70098 9.59587 7.67566 9.85319 7.67566 9.96053C7.45113 9.94646 6.77988 9.79929 6.29706 10.1368C6.187 10.2122 6.09777 10.3143 6.03762 10.4334C5.97748 10.5525 5.94837 10.6849 5.953 10.8183C5.953 11.0948 6.02378 11.3057 6.26191 11.4909C6.83566 11.8733 7.96254 11.5846 8.04785 11.5569C8.12192 11.5419 8.21332 11.526 8.21332 11.4688V9.88085C8.2152 9.66477 8.22832 8.86656 7.14551 8.86656L7.14597 8.8689ZM9.32802 7.88555C9.3285 7.87817 9.3274 7.87076 9.32479 7.86383C9.32218 7.8569 9.31812 7.85061 9.31289 7.84537C9.30765 7.84014 9.30136 7.83608 9.29443 7.83347C9.2875 7.83086 9.28009 7.82976 9.2727 7.83025H8.81239C8.80504 7.82983 8.79768 7.83098 8.79081 7.83362C8.78394 7.83626 8.7777 7.84033 8.77252 7.84556C8.76734 7.85079 8.76332 7.85705 8.76074 7.86395C8.75816 7.87084 8.75707 7.87821 8.75755 7.88555V11.5884C8.75707 11.5957 8.75816 11.6031 8.76074 11.61C8.76332 11.6168 8.76734 11.6231 8.77252 11.6283C8.7777 11.6336 8.78394 11.6376 8.79081 11.6403C8.79768 11.6429 8.80504 11.6441 8.81239 11.6437H9.27552C9.28291 11.6441 9.29031 11.643 9.29724 11.6404C9.30417 11.6378 9.31046 11.6338 9.3157 11.6285C9.32094 11.6233 9.32499 11.617 9.3276 11.6101C9.33021 11.6031 9.33131 11.5957 9.33083 11.5884L9.32802 7.88555ZM11.9413 9.24153C11.8429 9.13326 11.623 8.88859 11.114 8.88859C10.9494 8.88859 10.4502 8.89937 10.1436 9.30761C9.84599 9.66524 9.83521 10.1564 9.83521 10.3111C9.83521 10.4574 9.84224 10.9795 10.1661 11.3034C10.2899 11.4398 10.5908 11.6891 11.2354 11.6891C11.7426 11.6891 12.0074 11.579 12.1063 11.5129C12.1283 11.5016 12.1396 11.4796 12.1176 11.4248L12.0074 11.1046C12.0018 11.0925 11.9921 11.0826 11.9801 11.0766C11.9681 11.0707 11.9544 11.069 11.9413 11.0718C11.8199 11.1159 11.6437 11.204 11.2246 11.204C10.408 11.204 10.4347 10.5131 10.4305 10.4213H12.1729C12.1856 10.421 12.1979 10.4165 12.2078 10.4086C12.2177 10.4006 12.2247 10.3896 12.2277 10.3772C12.2141 10.3772 12.3248 9.68821 11.9422 9.24153H11.9413ZM13.6612 11.7112C14.2785 11.7112 14.6648 11.3802 14.6648 10.8623C14.6648 10.3111 14.1163 10.1513 13.8266 10.0575C13.6326 9.97974 13.198 9.89913 13.198 9.63852C13.198 9.46229 13.3523 9.34089 13.5951 9.34089C13.8677 9.34637 14.1355 9.41419 14.3779 9.53916C14.3779 9.53916 14.4332 9.57244 14.4552 9.51713C14.466 9.48432 14.5654 9.20872 14.5762 9.17544C14.5804 9.16232 14.5793 9.14808 14.5732 9.13574C14.567 9.1234 14.5563 9.11394 14.5434 9.10935C14.1726 8.87968 13.7587 8.87781 13.5951 8.87781C13.0326 8.87781 12.636 9.2195 12.636 9.70461C12.636 10.2886 13.1741 10.4283 13.4737 10.5094C13.7601 10.6031 14.091 10.6622 14.091 10.9172C14.091 11.1046 13.926 11.2481 13.6612 11.2481C13.34 11.2474 13.0276 11.143 12.7705 10.9504C12.7639 10.9447 12.7558 10.941 12.7471 10.9397C12.7384 10.9384 12.7295 10.9395 12.7215 10.943C12.7134 10.9464 12.7065 10.9521 12.7015 10.9593C12.6965 10.9665 12.6936 10.975 12.6932 10.9837L12.583 11.3362C12.561 11.3802 12.5938 11.3915 12.5938 11.4023C12.6744 11.4679 13.078 11.7112 13.6621 11.7112H13.6612ZM16.7385 8.9992C16.7385 8.96593 16.7273 8.9439 16.6832 8.9439H16.132C16.132 8.93734 16.176 8.52487 16.3415 8.35942C16.5365 8.1649 16.8927 8.28255 16.904 8.28255C16.9588 8.30458 16.9701 8.28255 16.9809 8.26052L17.1135 7.89633C17.1463 7.85227 17.1135 7.84149 17.1023 7.83025C16.8637 7.7365 16.289 7.69573 15.9557 8.02898C15.6988 8.28583 15.6276 8.68142 15.5807 8.9439H15.1837C15.1694 8.94508 15.1561 8.95131 15.1461 8.96144C15.136 8.97158 15.1299 8.98497 15.1288 8.9992L15.0623 9.36292C15.0623 9.39573 15.0735 9.41776 15.1176 9.41776H15.5034C15.1045 11.6629 15.0932 11.7711 15.0182 12.02C14.9676 12.1897 14.864 12.3434 14.7426 12.3837C14.7384 12.3837 14.5607 12.4625 14.2907 12.3725C14.2907 12.3725 14.2466 12.3505 14.2246 12.4058C14.2134 12.4391 14.1032 12.7254 14.0919 12.7587C14.0807 12.792 14.0919 12.8248 14.114 12.8248C14.3535 12.9185 14.7234 12.9078 14.9521 12.8248C15.2465 12.7179 15.4077 12.455 15.4926 12.2183C15.6215 11.8569 15.6243 11.7594 16.0438 9.41823H16.6171C16.6314 9.41706 16.6448 9.41085 16.6549 9.40072C16.6651 9.39059 16.6713 9.3772 16.6724 9.36292L16.7385 8.9992ZM19.2412 9.74914C19.2149 9.6704 19.0021 8.90031 18.0613 8.90031C17.3465 8.90031 16.9832 9.36902 16.882 9.74914C16.8351 9.88975 16.7329 10.4053 16.882 10.8515C16.8862 10.8656 17.0887 11.7008 18.0613 11.7008C18.7621 11.7008 19.1348 11.2504 19.2412 10.8515C19.3917 10.4011 19.2885 9.88975 19.2412 9.74914ZM21.3693 8.9664C21.135 8.88906 20.5903 8.87734 20.3329 9.21997V9.01045C20.3333 9.0031 20.3322 8.99575 20.3295 8.98888C20.3269 8.98201 20.3228 8.97577 20.3176 8.97059C20.3124 8.9654 20.3061 8.96139 20.2992 8.95881C20.2923 8.95623 20.285 8.95514 20.2776 8.95562H19.837C19.8296 8.95514 19.8223 8.95623 19.8154 8.95881C19.8085 8.96139 19.8022 8.9654 19.797 8.97059C19.7918 8.97577 19.7877 8.98201 19.785 8.98888C19.7824 8.99575 19.7813 9.0031 19.7817 9.01045V11.6015C19.7813 11.6088 19.7824 11.6162 19.785 11.6231C19.7877 11.63 19.7917 11.6363 19.797 11.6415C19.8022 11.6467 19.8084 11.6508 19.8153 11.6534C19.8222 11.656 19.8296 11.6572 19.837 11.6568H20.2889C20.2962 11.6572 20.3036 11.656 20.3105 11.6534C20.3174 11.6508 20.3237 11.6467 20.3289 11.6415C20.3341 11.6363 20.3382 11.63 20.3408 11.6231C20.3434 11.6162 20.3446 11.6088 20.3442 11.6015V10.2999C20.3442 10.1635 20.3465 9.76695 20.5532 9.59446C20.7829 9.3648 21.1157 9.43698 21.1818 9.45104C21.1959 9.45079 21.2096 9.4465 21.2213 9.43869C21.233 9.43088 21.2423 9.41988 21.2479 9.40698C21.3029 9.28487 21.3508 9.15967 21.3914 9.03201C21.396 9.02016 21.3963 9.00706 21.3923 8.99498C21.3883 8.9829 21.3802 8.97262 21.3693 8.96593V8.9664ZM23.5636 11.5021L23.4642 11.1604C23.4422 11.1051 23.3981 11.1271 23.3981 11.1271C23.1998 11.2124 22.9223 11.2157 22.8689 11.2157C22.6514 11.2157 22.064 11.1628 22.064 10.2896C22.064 9.99755 22.1507 9.36339 22.8361 9.36339C23.0191 9.35872 23.2017 9.38487 23.3761 9.44073C23.3761 9.44073 23.4201 9.46276 23.4314 9.40745C23.4754 9.28605 23.5082 9.19794 23.5528 9.05451C23.5636 9.01045 23.5307 8.99967 23.5195 8.99967C22.9762 8.81828 22.4723 8.88109 22.2182 8.99967C22.1437 9.03436 21.4575 9.30387 21.4575 10.2896C21.4575 10.4255 21.4303 11.7008 22.814 11.7008C23.0625 11.7004 23.3089 11.6554 23.5415 11.5682C23.5516 11.5607 23.5591 11.5503 23.5631 11.5384C23.567 11.5265 23.5672 11.5137 23.5636 11.5016V11.5021ZM26.0887 9.64977C26.0512 9.50916 25.837 8.88906 25.0411 8.88906C24.2911 8.88906 23.9386 9.36292 23.8392 9.76039C23.7851 9.93903 23.759 10.125 23.7618 10.3116C23.7618 11.5241 24.645 11.6896 25.1625 11.6896C25.6697 11.6896 25.934 11.5794 26.0334 11.5134C26.0554 11.5021 26.0667 11.4801 26.0447 11.4252L25.934 11.1051C25.9284 11.093 25.9188 11.0831 25.9068 11.0771C25.8947 11.0712 25.8811 11.0695 25.8679 11.0723C25.7465 11.1164 25.5703 11.2045 25.1512 11.2045C24.3347 11.2045 24.3614 10.5136 24.3576 10.4217H26.0995C26.1123 10.4214 26.1246 10.4169 26.1346 10.409C26.1445 10.401 26.1517 10.39 26.1548 10.3777C26.1436 10.3772 26.1989 10.0463 26.0887 9.6493V9.64977ZM24.997 9.35214C24.5128 9.35214 24.3876 9.77398 24.3576 10.014H25.5937C25.5525 9.45526 25.2365 9.35167 24.997 9.35167V9.35214Z" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-white group-hover:text-[#00A1E0] transition-colors">
              {exported.salesforce ? 'Exported to Salesforce' : 'Salesforce'}
            </p>
            <p className="text-xs text-zinc-500">Push lead & opportunity</p>
          </div>
        </button>
      </div>
    </div>
  );
}

function InfoCard({ label, value, children }: { label: string; value?: string | number | null; children?: React.ReactNode }) {
  if (!value && !children) return null;
  return (
    <div className="bg-transparent px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 min-h-[44px]">
      <label className="text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-500 shrink-0">{label}</label>
      <div className="text-zinc-900 dark:text-white text-sm sm:text-base font-medium break-words sm:text-right">
        {children || value}
      </div>
    </div>
  );
}

// ── Editable inline field ────────────────────────────────────────────
// Click-to-edit with auto-save on blur/enter, escape to cancel.
// `dbField` is the actual DB column name for the PUT /leads/:id endpoint.
function EditableInfoCard({
  label,
  value,
  dbField,
  leadId,
  onSaved,
  placeholder,
  children,
  buildPayload,
}: {
  label: string;
  value?: string | number | null;
  dbField: string;
  leadId: string;
  onSaved: (field: string, newValue: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
  buildPayload?: (newValue: string) => Record<string, any>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value || ''));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync draft when value changes externally
  useEffect(() => {
    if (!editing) setDraft(String(value || ''));
  }, [value, editing]);

  const isDemoMode = useDemoMode();

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    const original = String(value || '');
    if (trimmed === original) {
      setEditing(false);
      return;
    }
    // Demo mode: update locally without API call
    if (isDemoMode) {
      onSaved(dbField, trimmed);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      setSaving(false);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload ? buildPayload(trimmed) : { [dbField]: trimmed || null };
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${leadId}`,
        { method: 'PUT', body: JSON.stringify(payload) }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      onSaved(dbField, trimmed);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      dispatchAppEvent({ type: 'leads:updated', ids: [leadId], meta: { [dbField]: trimmed } });
    } catch (err: any) {
      console.error('[EDIT LEAD]', err);
      toast.error('Failed to update field', { description: err.message });
      setDraft(original);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [draft, value, dbField, leadId, onSaved, buildPayload, isDemoMode]);

  const cancel = useCallback(() => {
    setDraft(String(value || ''));
    setEditing(false);
  }, [value]);

  // If children are provided (e.g. a link), just render normally — not editable
  if (children) {
    return (
      <div className="bg-transparent px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 min-h-[44px]">
        <label className="text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-500 shrink-0">{label}</label>
        <div className="text-zinc-900 dark:text-white text-sm sm:text-base font-medium break-words sm:text-right">{children}</div>
      </div>
    );
  }

  return (
    <div className="group/edit bg-transparent px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 min-h-[44px] transition-colors hover:bg-zinc-50 dark:hover:bg-white/5">
      {label && (
        <label className="text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-500 shrink-0 flex items-center gap-2">
          {label}
          {justSaved && (
            <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-[#1ED4A7] font-semibold animate-in fade-in duration-200">
              <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> Saved
            </span>
          )}
        </label>
      )}
      {!label && justSaved && (
        <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-[#1ED4A7] font-semibold animate-in fade-in duration-200 mb-1">
          <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> Saved
        </span>
      )}
      <div className="flex-1 flex sm:justify-end min-w-0">
      {editing ? (
        <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') cancel();
            }}
            onBlur={save}
            disabled={saving}
            placeholder={placeholder || label}
            className="w-full sm:w-64 bg-white dark:bg-zinc-800 border border-[#1ED4A7] rounded-lg px-3 py-1.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/50 sm:text-right min-h-[44px]"
          />
          {saving && <Loader2 className="w-4 h-4 text-zinc-400 animate-spin shrink-0" />}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto group/btn rounded-lg min-h-[32px] px-2 py-1 -mr-2 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors tap-target-override text-left"
        >
          <span className={`text-sm sm:text-base font-medium break-words truncate sm:text-right ${value ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500 italic'}`}>
            {value || placeholder || `Add ${label.toLowerCase()}`}
          </span>
          <Pencil className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 opacity-0 group-hover/edit:opacity-100 transition-opacity shrink-0 hidden sm:block" />
        </button>
      )}
      </div>
    </div>
  );
}