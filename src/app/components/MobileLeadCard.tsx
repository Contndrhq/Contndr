import { CompanyLogo, extractLeadDomain, extractCompanyLinkedin } from './CompanyLogo';
import { toast } from 'sonner';
import { LeadScoreBadge } from './LeadScoreBadge';
import { LeadAvatar } from './LeadAvatar';
import { toTitleCase } from '../utils/title-case';
import { formatPhoneDisplay } from '../lib/phone-format';
import { Check, Flame, Factory, Users, MapPin, Send, Mail, Copy, Phone, Eye, MousePointerClick, Linkedin, Globe, Loader2, Unlock } from 'lucide-react';
import { SmartPhoneButton } from './SmartPhoneButton';
import { useTranslation } from 'react-i18next';

interface MobileLeadCardProps {
  lead: any;
  selectedLeads: string[];
  toggleLeadSelection: (id: string) => void;
  setSelectedLeadId: (id: string) => void;
  statusColors: Record<string, string>;
  needsReveal: (lead: any) => boolean;
  revealLead: (id: string) => void;
  revealingLeadId: string | null;
  showOutreach?: boolean;
  pipelineStage?: string | null;
  intentLevel?: 'high' | 'medium' | 'none';
  onComposeEmail?: (email: string, name: string) => void;
}

function timeAgo(dateStr: string, t: (key: string, opts?: any) => string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('mobileLeadCard.justNow');
  if (mins < 60) return t('mobileLeadCard.mAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('mobileLeadCard.hAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 7) return t('mobileLeadCard.dAgo', { count: days });
  if (days < 30) return t('mobileLeadCard.wAgo', { count: Math.floor(days / 7) });
  return t('mobileLeadCard.moAgo', { count: Math.floor(days / 30) });
}

// ── Seniority badge matching People Finder ──
type SeniorityOption = 'owner' | 'founder' | 'c_suite' | 'partner' | 'vp' | 'head' | 'director' | 'manager' | 'senior' | 'entry';

const SENIORITY_OPTIONS: { value: SeniorityOption; label: string; color: string }[] = [
  { value: 'owner', label: 'Owner', color: 'text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-700/40' },
  { value: 'founder', label: 'Founder', color: 'text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-700/40' },
  { value: 'c_suite', label: 'C-Suite', color: 'text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-700/40' },
  { value: 'partner', label: 'Partner', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'vp', label: 'VP', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'head', label: 'Head', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'director', label: 'Director', color: 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50' },
  { value: 'manager', label: 'Manager', color: 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/40' },
  { value: 'senior', label: 'Senior', color: 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/40' },
  { value: 'entry', label: 'Entry', color: 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/40' },
];

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

function formatEmployeeCount(val: string | number): string {
  const num = typeof val === 'string' ? parseInt(val.replace(/[^0-9]/g, ''), 10) : val;
  if (!num || num <= 0) return String(val || '—');
  if (num >= 10000) return `${Math.round(num / 1000)}K`;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return num.toLocaleString();
}

function formatRevenue(amount: number): string {
  if (!amount || amount <= 0) return '—';
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(amount % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

export function MobileLeadCard({
  lead,
  selectedLeads,
  toggleLeadSelection,
  setSelectedLeadId,
  statusColors,
  needsReveal,
  revealLead,
  revealingLeadId,
  showOutreach = false,
  pipelineStage = null,
  intentLevel = 'none',
  onComposeEmail,
}: MobileLeadCardProps) {
  const { t } = useTranslation();
  const isRevealing = revealingLeadId === lead.id;
  const showReveal = needsReveal(lead);
  const isHotLead = (lead.score && lead.score > 80) || (lead.stage || lead.status || '').toLowerCase() === 'hot';
  const outreach = lead.team_outreach || [];
  const hasOutreach = outreach.length > 0;
  const companyDomain = extractLeadDomain(lead);
  const selected = selectedLeads.includes(lead.id);

  // Derive seniority badge from job title
  const seniority = inferSeniorityFromTitle(lead.job_title || '');
  const seniorityOpt = seniority ? SENIORITY_OPTIONS.find(s => s.value === seniority) : null;

  const linkedinUrl = lead.person_linkedin_url || lead.linkedin;
  const companyLinkedinUrl = extractCompanyLinkedin(lead);
  const websiteUrl = lead.website || (companyDomain ? `https://${companyDomain}` : null);

  return (
    <div
      className={`bg-white dark:bg-black rounded-xl border transition-colors ${
        isHotLead
          ? 'border-[#1ED4A7]/30 dark:border-[#1ED4A7]/20 bg-[#1ED4A7]/[0.02] ring-1 ring-[#1ED4A7]/10'
          : 'border-zinc-200 dark:border-zinc-800/60'
      }`}
      onClick={() => setSelectedLeadId(lead.id)}
    >
      {/* ── Top: Person header ── */}
      <div className="px-3 py-3">
        <div className="flex items-start gap-2.5">
          {/* Checkbox */}
          <div onClick={(e) => { e.stopPropagation(); toggleLeadSelection(lead.id); }} className="pt-0.5">
            <div
              className={`rounded border cursor-pointer flex items-center justify-center transition-all ${
                selected ? 'bg-[#1ED4A7] border-[#1ED4A7] text-black' : 'border-zinc-300 dark:border-zinc-700'
              }`}
              style={{ width: 18, height: 18, minWidth: 18, minHeight: 18 }}
            >
              {selected && <Check className="w-3 h-3" />}
            </div>
          </div>

          {/* Avatar */}
          <div className="flex-shrink-0 mt-0.5">
            <LeadAvatar
              name={lead.contact_name || lead.business_name || '?'}
              email={lead.email}
              linkedinUrl={linkedinUrl}
              size={36}
            />
          </div>

          {/* Name + badges + metadata */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + Score + Role badge */}
            <div className="flex items-start gap-1.5 mb-1 flex-wrap">
              <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white leading-tight break-words">
                {toTitleCase(lead.contact_name || lead.business_name || '—')}
              </h3>
              <div className="flex items-center gap-1 flex-shrink-0">
                {lead.score !== undefined && lead.score !== null && (
                  <LeadScoreBadge score={lead.score} size="sm" showLabel={false} />
                )}
                {seniorityOpt && (
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ${seniorityOpt.color}`}>
                    {seniorityOpt.label}
                  </span>
                )}
                {isHotLead && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#1ED4A7]/10 text-[#1ED4A7] ring-1 ring-[#1ED4A7]/20 flex-shrink-0 uppercase tracking-wider">
                    <Flame className="w-2.5 h-2.5" />
                    {t('mobileLeadCard.hot')}
                  </span>
                )}
              </div>
            </div>

            {/* Row 2: Job title + CRM status badges */}
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <p className={`text-[12px] leading-tight ${lead.job_title ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-600 italic'}`}>
                {lead.job_title ? toTitleCase(lead.job_title) : '—'}
              </p>
              {pipelineStage && (
                <span className="px-1.5 py-0.5 text-[8px] font-bold rounded uppercase flex-shrink-0 bg-zinc-100 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400">
                  {pipelineStage.replace(/_/g, ' ')}
                </span>
              )}
              {(lead.stage || lead.status) && (
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide border flex-shrink-0 ${
                  statusColors[lead.stage || lead.status] || 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                }`}>
                  {lead.stage || lead.status}
                </span>
              )}
              {intentLevel === 'high' && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#1ED4A7]/10 text-[#1ED4A7] ring-1 ring-[#1ED4A7]/20 flex-shrink-0 uppercase">
                  <span className="inline-flex rounded-full h-1.5 w-1.5 bg-[#1ED4A7] shrink-0" />
                  {t('mobileLeadCard.high')}
                </span>
              )}
              {intentLevel === 'medium' && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-500/20 flex-shrink-0 uppercase">
                  <span className="inline-flex rounded-full h-1.5 w-1.5 bg-zinc-500 dark:bg-zinc-400 shrink-0" />
                  {t('mobileLeadCard.warm')}
                </span>
              )}
            </div>

            {/* Row 3: Company name with mini logo */}
            {(lead.business_name || companyDomain) && lead.contact_name && (
              <div className="text-[12px] text-zinc-600 dark:text-zinc-400 mb-1 flex items-center gap-1.5">
                <CompanyLogo
                  domain={companyDomain}
                  brandLogoUrl={lead.brand_logo_url || lead.company?.brand_logo_url}
                  brandLogoSource={lead.brand_logo_source || lead.company?.brand_logo_source}
                  linkedinUrl={lead.company?.linkedin_url}
                  companyName={lead.business_name || lead.company_name}
                  size={14}
                  className="!rounded-[3px]"
                />
                <span className="truncate font-medium">{toTitleCase(lead.business_name) || companyDomain}</span>
              </div>
            )}

            {/* Compact 2-col metadata grid — matching People Finder */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
              {/* Industry */}
              <div className="flex items-center gap-1 min-w-0">
                <Factory className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                {(lead.industry || lead.category) ? (
                  <span className="text-[10px] truncate text-zinc-500 dark:text-zinc-400">{toTitleCase(lead.industry || lead.category)}</span>
                ) : (
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-600 italic">{t('mobileLeadCard.noIndustry')}</span>
                )}
              </div>

              {/* Employees */}
              <div className="flex items-center gap-1">
                <Users className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {lead.employees ? formatEmployeeCount(lead.employees) : '—'}
                </span>
              </div>

              {/* Revenue (if available) */}
              {lead.annual_revenue && lead.annual_revenue > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{formatRevenue(lead.annual_revenue)}</span>
                </div>
              )}

              {/* Location */}
              {(lead.city || lead.state || lead.country) && (
                <div className="flex items-center gap-1 min-w-0 col-span-2">
                  <MapPin className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                    {[lead.city, lead.state, lead.country].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
            </div>

            {/* ── Team Outreach Banner (inline) ── */}
            {showOutreach && hasOutreach && (
              <div className="mb-2 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-1.5 mb-1">
                  <Send className="w-3 h-3 text-zinc-400" />
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('mobileLeadCard.contacted')}</span>
                </div>
                <div className="space-y-1">
                  {outreach.slice(0, 2).map((o: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 ${
                        o.is_you ? 'bg-zinc-900/10 dark:bg-white/10 text-zinc-900 dark:text-white' : 'bg-zinc-200/60 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400'
                      }`}>
                        {o.contacted_by.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-[11px] text-zinc-600 dark:text-zinc-300 truncate">
                        {o.is_you ? t('mobileLeadCard.you') : o.contacted_by.split(' ')[0]}
                      </span>
                      <span className="text-[10px] text-zinc-400 truncate flex-1">
                        {t('mobileLeadCard.via')} {o.campaign_name}
                      </span>
                      <span className="text-[10px] text-zinc-400 flex-shrink-0">
                        {timeAgo(o.sent_at, t)}
                      </span>
                    </div>
                  ))}
                  {outreach.length > 2 && (
                    <p className="text-[10px] text-zinc-400 pl-6">+{outreach.length - 2} {t('mobileLeadCard.more')}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Contact info — separated by border, People Finder style ── */}
            <div className="space-y-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
              {/* Contact name (if different from header — i.e. header shows business_name) */}
              {lead.contact_name && !lead.business_name && null}

              {/* Email */}
              {showReveal ? (
                lead.has_email ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span className="truncate select-none blur-[3px]">contact@company.com</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-600">
                    <Mail className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
                    <span>{t('mobileLeadCard.noEmail')}</span>
                  </div>
                )
              ) : lead.email ? (
                <div className="flex items-center gap-1 min-w-0 w-full">
                  <button
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(lead.email); toast.success(t('mobileLeadCard.emailCopied')); }}
                    className="flex items-center gap-1.5 min-w-0 flex-1 text-left group"
                  >
                    <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <code className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono flex-1 min-w-0 leading-tight" style={{ overflowWrap: 'anywhere' as any }}>{lead.email}</code>
                    <Copy className="w-3 h-3 text-zinc-400 flex-shrink-0 opacity-0 group-active:opacity-100 transition-opacity" />
                  </button>
                  {onComposeEmail && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onComposeEmail(lead.email, lead.contact_name || lead.name || ''); }}
                      className="p-1 rounded text-zinc-400 hover:text-emerald-500 transition-colors flex-shrink-0"
                      title={t('mobileLeadCard.composeEmail')}
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-600">
                  <Mail className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
                  <span>{t('mobileLeadCard.noEmail')}</span>
                </div>
              )}

              {/* Phone */}
              {showReveal ? (
                lead.has_phone ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <Phone className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    <span className="truncate select-none blur-[3px]">(555) 123-4567</span>
                  </div>
                ) : null
              ) : lead.phone ? (
                <SmartPhoneButton
                  phone={lead.phone}
                  leadName={lead.contact_name || lead.name}
                  businessName={lead.business_name}
                  leadId={lead.id}
                  showNumber
                  displayNumber={formatPhoneDisplay(lead.phone)}
                  numberClassName="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono tracking-tight"
                  iconClassName="w-3.5 h-3.5"
                />
              ) : null}

              {/* Engagement stats */}
              {!!(lead.emails_opened && lead.emails_opened > 0 || lead.emails_clicked && lead.emails_clicked > 0) && (
                <div className="flex items-center gap-3 pt-0.5">
                  {lead.emails_opened > 0 && (
                    <div className="flex items-center gap-1">
                      <Eye className={`w-3 h-3 ${lead.emails_opened > 0 ? 'text-[#1ED4A7]' : 'text-zinc-400'}`} />
                      <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-300">{lead.emails_opened} {t('mobileLeadCard.opens')}</span>
                    </div>
                  )}
                  {lead.emails_clicked > 0 && (
                    <div className="flex items-center gap-1">
                      <MousePointerClick className={`w-3 h-3 ${lead.emails_clicked > 0 ? 'text-[#1ED4A7]' : 'text-zinc-400'}`} />
                      <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-300">{lead.emails_clicked} {t('mobileLeadCard.clicks')}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Social links + actions row */}
              <div className="flex items-center gap-1 pt-0.5">
                {linkedinUrl && (
                  <a href={linkedinUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 text-zinc-400 hover:text-[#0077B5] transition-colors">
                    <Linkedin className="w-3.5 h-3.5" />
                  </a>
                )}
                {companyLinkedinUrl && (
                  <a href={companyLinkedinUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 text-zinc-400 hover:text-[#0077B5] transition-colors">
                    <Linkedin className="w-3.5 h-3.5" />
                  </a>
                )}
                {websiteUrl && (
                  <a href={websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                    <Globe className="w-3.5 h-3.5" />
                  </a>
                )}

                <div className="flex-1" />

                {showReveal ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); revealLead(lead.id); }}
                    disabled={isRevealing}
                    className="px-2.5 py-1 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 rounded-lg text-[11px] font-medium transition-colors inline-flex items-center gap-1 shadow-sm"
                  >
                    {isRevealing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlock className="w-3 h-3" />}
                    {t('mobileLeadCard.reveal')}
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedLeadId(lead.id); }}
                    className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-[11px] font-medium transition-colors inline-flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" />
                    {t('mobileLeadCard.view')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}