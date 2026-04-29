import { CompanyLogo, extractLeadDomain } from './CompanyLogo';
import { LeadScoreBadge } from './LeadScoreBadge';
import { LeadAvatar } from './LeadAvatar';
import { toTitleCase } from '../utils/title-case';
import { formatPhoneDisplay } from '../lib/phone-format';
import { Flame, ExternalLink, Globe2, Users, Mail, Phone, Eye, MousePointerClick, ChevronDown, RefreshCw, Unlock, Loader2 } from 'lucide-react';
import { SmartPhoneButton } from './SmartPhoneButton';
import { useTranslation } from 'react-i18next';

interface TeamOutreach {
  user_id: string;
  contacted_by: string;
  contacted_by_email: string;
  is_you: boolean;
  campaign_name: string;
  campaign_id: string;
  sent_at: string;
  status: string;
}

interface DesktopLeadRowProps {
  lead: any;
  selectedLeads: string[];
  toggleLeadSelection: (id: string) => void;
  setSelectedLeadId: (id: string) => void;
  statusColors: Record<string, string>;
  statusMenuOpen: string | null;
  setStatusMenuOpen: (id: string | null) => void;
  updatingStatus: string | null;
  updateLeadStatus: (id: string, status: string) => void;
  getAvatarColor: (name: string) => string;
  needsReveal: (lead: any) => boolean;
  revealLead: (id: string) => void;
  revealingLeadId: string | null;
  showOutreachColumn?: boolean;
  pipelineStage?: string | null;
  intentLevel?: 'high' | 'medium' | 'none';
  onComposeEmail?: (email: string, name: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function DesktopLeadRow({
  lead,
  selectedLeads,
  toggleLeadSelection,
  setSelectedLeadId,
  statusColors,
  statusMenuOpen,
  setStatusMenuOpen,
  updatingStatus,
  updateLeadStatus,
  getAvatarColor,
  needsReveal,
  revealLead,
  revealingLeadId,
  showOutreachColumn = false,
  pipelineStage = null,
  intentLevel = 'none',
  onComposeEmail,
}: DesktopLeadRowProps) {
  const { t } = useTranslation();
  const showReveal = needsReveal(lead);
  const isRevealing = revealingLeadId === lead.id;
  const isHotLead = (lead.score && lead.score > 80) || (lead.stage || lead.status || '').toLowerCase() === 'hot';

  // Extract domain for company logo
  const companyDomain = extractLeadDomain(lead);

  // Extract a short role badge from job title (like People Finder: FOUNDER, C-SUITE, PARTNER, VP, etc.)
  const getRoleBadge = (title: string | undefined | null): string | null => {
    if (!title) return null;
    const tl = title.toLowerCase();
    if (tl.includes('founder') || tl.includes('co-founder')) return t('crm.roleFounder');
    if (tl.includes('ceo') || tl.includes('cto') || tl.includes('cfo') || tl.includes('coo') || tl.includes('cmo') || tl.includes('cro') || tl.includes('chief')) return t('crm.roleCSuite');
    if (tl.includes('partner') || tl.includes('managing partner') || tl.includes('general partner')) return t('crm.rolePartner');
    if (tl.includes('vp') || tl.includes('vice president')) return t('crm.roleVP');
    if (tl.includes('director')) return t('crm.roleDirector');
    if (tl.includes('head of') || tl.includes('head,')) return t('crm.roleHead');
    if (tl.includes('manager')) return t('crm.roleManager');
    if (tl.includes('president') && !tl.includes('vice')) return t('crm.rolePresident');
    if (tl.includes('owner')) return t('crm.roleOwner');
    return null;
  };

  const roleBadge = getRoleBadge(lead.job_title);

  // Build the subtitle text — show blurred placeholder for unrevealed shared leads
  const getSubtitle = () => {
    if (lead.business_name && lead.contact_name) return toTitleCase(lead.business_name);
    if (lead.website) return lead.website;
    // For unrevealed shared leads, email is null — use has_email to show a blurred placeholder
    if (showReveal && lead.has_email) return 'contact@company.com';
    if (lead.email) return lead.email;
    return '';
  };

  const subtitle = getSubtitle();
  // Apply blur only when we're showing the placeholder for an unrevealed shared lead's email
  const isBlurredSubtitle = showReveal && lead.has_email && !lead.business_name && !lead.website;

  // Status display translation map
  const statusDisplayMap: Record<string, string> = {
    'Hot': t('crm.statusHot'), 'hot': t('crm.statusHot'),
    'Warm': t('crm.statusWarm'), 'warm': t('crm.statusWarm'),
    'Cold': t('crm.statusCold'), 'cold': t('crm.statusCold'),
    'Interested': t('crm.statusInterested'), 'interested': t('crm.statusInterested'),
    'Customer': t('crm.statusCustomer'), 'customer': t('crm.statusCustomer'),
    'Churned': t('crm.statusChurned'),
    'Bad Fit': t('crm.statusBadFit'),
    'Do Not Contact': t('crm.statusDoNotContact'),
    'New': t('crm.statusHot'), 'new': t('crm.statusHot'),
  };

  const outreach: TeamOutreach[] = lead.team_outreach || [];
  const hasOutreach = outreach.length > 0;

  return (
    <tr
      className={`group hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer border-b border-zinc-100 dark:border-zinc-800/50 last:border-0 relative ${
        isHotLead ? 'bg-[#1ED4A7]/[0.03] dark:bg-[#1ED4A7]/[0.02]' : ''
      }`}
      onClick={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'A' || (e.target as HTMLElement).closest('a')) {
          return;
        }
        setSelectedLeadId(lead.id);
      }}
    >
      <td className="p-3 w-10" onClick={(e) => e.stopPropagation()}>
        {/* Hot lead left-edge glow */}
        {isHotLead && (
          <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-[#1ED4A7]/70" />
        )}
        <input
          type="checkbox"
          checked={selectedLeads.includes(lead.id)}
          onChange={() => toggleLeadSelection(lead.id)}
          className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-white text-zinc-900 dark:text-white focus:ring-zinc-400 bg-white dark:bg-zinc-900"
        />
      </td>
      
      {/* Person — avatar + name + badges + job title */}
      <td className="p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex-shrink-0">
            <LeadAvatar
              name={lead.contact_name || lead.business_name || '?'}
              email={lead.email}
              linkedinUrl={lead.person_linkedin_url || lead.linkedin}
              size={36}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-zinc-900 dark:text-white font-medium truncate max-w-[160px] text-[13px]">
                {toTitleCase(lead.contact_name || lead.business_name) || t('crm.unknown')}
              </p>
              {isHotLead && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#1ED4A7]/10 text-[#1ED4A7] ring-1 ring-[#1ED4A7]/20 flex-shrink-0" title="Hot Lead (Score > 80)">
                  <Flame className="w-2.5 h-2.5" />
                  {t('crm.hotBadge')}
                </span>
              )}
              {roleBadge && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200/50 dark:ring-zinc-700/50 flex-shrink-0 uppercase tracking-wide max-w-[100px] truncate">
                  {roleBadge}
                </span>
              )}
              {lead.is_shared && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200/50 dark:ring-zinc-700/50 flex-shrink-0">
                  <Globe2 className="w-2.5 h-2.5" />
                </span>
              )}
              {lead.is_team_lead && !lead.is_shared && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 flex-shrink-0">
                  <Users className="w-2.5 h-2.5" />
                </span>
              )}
              {intentLevel === 'high' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1ED4A7]/10 text-[#1ED4A7] ring-1 ring-[#1ED4A7]/20 flex-shrink-0" title="High Buying Intent (≥ 61)">
                  <span className="inline-flex rounded-full h-1.5 w-1.5 bg-[#1ED4A7] shrink-0" />
                  {t('crm.highIntent')}
                </span>
              )}
              {intentLevel === 'medium' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-500/20 flex-shrink-0" title="Medium Buying Intent (30–60)">
                  <span className="inline-flex rounded-full h-1.5 w-1.5 bg-zinc-500 dark:bg-zinc-400 shrink-0" />
                  {t('crm.warmIntent')}
                </span>
              )}
              {lead.linkedin && (
                <a
                  href={lead.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex-shrink-0 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {lead.job_title && lead.contact_name && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[180px] mt-0.5">
                {lead.job_title}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Company — logo + name + industry + location (People Finder style) */}
      <td className="p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex-shrink-0">
            <CompanyLogo
              domain={companyDomain}
              brandLogoUrl={lead.brand_logo_url || lead.company?.brand_logo_url}
              brandLogoSource={lead.brand_logo_source || lead.company?.brand_logo_source}
              linkedinUrl={lead.company?.linkedin_url}
              companyName={lead.business_name || lead.company_name}
              size={32}
              className="!rounded-lg"
            />
          </div>
          <div className="min-w-0">
            <p className="text-zinc-900 dark:text-white font-medium truncate max-w-[160px] text-[13px]">
              {toTitleCase(lead.business_name) || (companyDomain ? companyDomain.replace(/^www\./, '') : '—')}
            </p>
            {/* Industry · Employees · Revenue — dot-separated metadata line */}
            {(lead.industry || lead.category || lead.employees || lead.annual_revenue) && (
              <div className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 max-w-[220px] truncate">
                {(lead.industry || lead.category) && (
                  <span className="truncate">{toTitleCase(lead.industry || lead.category)}</span>
                )}
                {lead.employees && (lead.industry || lead.category) && (
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                )}
                {lead.employees && (
                  <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                    <Users className="w-3 h-3" />
                    {lead.employees}
                  </span>
                )}
                {lead.annual_revenue && (lead.industry || lead.category || lead.employees) && (
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                )}
                {lead.annual_revenue && (
                  <span className="flex-shrink-0">
                    {lead.annual_revenue >= 1_000_000_000 ? `$${(lead.annual_revenue / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B` : lead.annual_revenue >= 1_000_000 ? `$${(lead.annual_revenue / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : lead.annual_revenue >= 1_000 ? `$${(lead.annual_revenue / 1_000).toFixed(0)}K` : `$${lead.annual_revenue}`}
                  </span>
                )}
              </div>
            )}
            {(lead.city || lead.state) && (
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate max-w-[220px] mt-0.5">
                {[lead.city, lead.state].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Contact Info (Consolidated) */}
      <td className="p-3">
        <div className="flex flex-col gap-1.5">
          {/* Email */}
          <div className="flex items-center gap-2 text-xs h-5">
            {!showReveal && lead.email && onComposeEmail ? (
              <button
                onClick={(e) => { e.stopPropagation(); onComposeEmail(lead.email, lead.contact_name || lead.name || ''); }}
                className="p-0 bg-transparent border-none cursor-pointer text-zinc-400 hover:text-emerald-500 transition-colors flex-shrink-0"
                title={`Send email to ${lead.email}`}
              >
                <Mail className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            )}
            {showReveal ? (
              lead.has_email ? (
                <span className="text-zinc-400 dark:text-zinc-500 select-none blur-[3px] truncate max-w-[180px]">
                  contact@company.com
                </span>
              ) : (
                <span className="text-zinc-300 dark:text-zinc-700 italic">{t('crm.noEmail')}</span>
              )
            ) : lead.email ? (
              <span className="text-zinc-700 dark:text-zinc-300 truncate max-w-[180px]">
                {lead.email}
              </span>
            ) : (
              <span className="text-zinc-300 dark:text-zinc-700 italic">{t('crm.noEmail')}</span>
            )}
          </div>

          {/* Phone */}
          <div className="flex items-center gap-2 text-xs h-5">
            {showReveal ? (
              <>
                <Phone className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                {lead.has_phone ? (
                  <span className="text-zinc-400 dark:text-zinc-500 select-none blur-[3px] truncate max-w-[120px]">
                    +1 (555) 123-4567
                  </span>
                ) : (
                  <span className="text-zinc-300 dark:text-zinc-700 italic">{t('crm.noPhone')}</span>
                )}
              </>
            ) : lead.phone ? (
              <SmartPhoneButton
                phone={lead.phone}
                leadName={lead.contact_name || lead.name}
                businessName={lead.business_name}
                leadId={lead.id}
                showNumber
                displayNumber={formatPhoneDisplay(lead.phone)}
                numberClassName="text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[120px]"
                iconClassName="w-3.5 h-3.5"
              />
            ) : (
              <>
                <Phone className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                <span className="text-zinc-300 dark:text-zinc-700 italic">{t('crm.noPhone')}</span>
              </>
            )}
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="p-3" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setStatusMenuOpen(statusMenuOpen === lead.id ? null : lead.id);
            }}
            disabled={updatingStatus === lead.id}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer hover:opacity-90 transition-all whitespace-nowrap border ${
              statusColors[lead.stage || lead.status || 'Cold'] || statusColors['Cold']
            }`}
          >
            {updatingStatus === lead.id ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <span className="capitalize">{statusDisplayMap[lead.stage || lead.status || 'Cold'] || (lead.stage || lead.status || t('crm.statusCold')).replace(/_/g, ' ')}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </>
            )}
          </button>

          {statusMenuOpen === lead.id && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setStatusMenuOpen(null);
                }}
              />
              <div className="absolute top-full left-0 mt-1 w-44 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 z-20 overflow-hidden py-1.5 animate-in fade-in zoom-in-95 duration-100">
                {([
                  { value: 'Hot', label: t('crm.statusHot') },
                  { value: 'Warm', label: t('crm.statusWarm') },
                  { value: 'Cold', label: t('crm.statusCold') },
                  { value: 'Interested', label: t('crm.statusInterested') },
                  { value: 'Customer', label: t('crm.statusCustomer') },
                  { value: 'Churned', label: t('crm.statusChurned') },
                  { value: 'Bad Fit', label: t('crm.statusBadFit') },
                  { value: 'Do Not Contact', label: t('crm.statusDoNotContact') },
                ] as const).map(({ value: status, label }) => (
                  <button
                    key={status}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateLeadStatus(lead.id, status);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors block ${
                      (lead.stage || lead.status) === status 
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium' 
                        : 'text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </td>

      {/* Team Outreach — only shown when user is on a team */}
      {showOutreachColumn && (
        <td className="p-3">
          {hasOutreach ? (
            <div className="space-y-1">
              {/* Show top outreach entry */}
              {outreach.slice(0, 1).map((o, idx) => {
                const firstName = o.contacted_by.split(' ')[0] || 'Team';
                return (
                  <div key={idx} className="flex items-center gap-1.5" title={`${o.contacted_by} via "${o.campaign_name}" — ${new Date(o.sent_at).toLocaleDateString()}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                      o.is_you ? 'bg-zinc-900/10 dark:bg-white/10 text-zinc-900 dark:text-white' : 'bg-zinc-200/60 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400'
                    }`}>
                      {o.contacted_by.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-[100px] leading-tight">
                        {o.is_you ? t('crm.you') : firstName}
                      </p>
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate max-w-[100px] leading-tight">
                        {timeAgo(o.sent_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {/* "+N more" if there are additional outreach entries */}
              {outreach.length > 1 && (
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 pl-6">
                  {t('crm.moreOutreach', { count: outreach.length - 1 })}
                </p>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-zinc-300 dark:text-zinc-700 italic">—</span>
          )}
        </td>
      )}

      {/* Engagement Stats */}
      <td className="p-3">
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 ${lead.emails_opened && lead.emails_opened > 0 ? 'text-zinc-900 dark:text-white' : 'text-zinc-300 dark:text-zinc-700'}`} title={t('crm.emailsOpenedTooltip', { count: lead.emails_opened || 0 })}>
            <Eye className={`w-3.5 h-3.5 ${lead.emails_opened && lead.emails_opened > 0 ? 'text-[#1ED4A7]' : 'text-current'}`} />
            <span className="text-xs font-medium">{lead.emails_opened || 0}</span>
          </div>
          <div className={`flex items-center gap-1.5 ${lead.emails_clicked && lead.emails_clicked > 0 ? 'text-zinc-900 dark:text-white' : 'text-zinc-300 dark:text-zinc-700'}`} title={t('crm.linksClickedTooltip', { count: lead.emails_clicked || 0 })}>
            <MousePointerClick className={`w-3.5 h-3.5 ${lead.emails_clicked && lead.emails_clicked > 0 ? 'text-[#1ED4A7]' : 'text-current'}`} />
            <span className="text-xs font-medium">{lead.emails_clicked || 0}</span>
          </div>
        </div>
      </td>

      {/* Lead Score / AI Quality Score */}
      <td className="p-3 text-right">
        <div className="flex items-center justify-end">
          <LeadScoreBadge score={lead.score} size="sm" showLabel={true} />
        </div>
      </td>

      {/* Actions */}
      <td className="p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-2">
          {showReveal ? (
            <button
              onClick={(e) => { e.stopPropagation(); revealLead(lead.id); }}
              disabled={isRevealing}
              className="px-3 py-1.5 text-xs bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-sm"
            >
              {isRevealing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlock className="w-3 h-3" />}
              {t('crm.reveal')}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLeadId(lead.id);
              }}
              className="px-3 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-sm"
            >
              {t('crm.view')}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}