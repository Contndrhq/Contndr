import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, ArrowUpRight, Loader2, Eye, MousePointerClick, Reply, Globe, Mail, UserRound } from 'lucide-react';
import { DashboardListSkeleton } from './DashboardSkeleton';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { supabase } from '../lib/supabase';
import { useDemoMode } from './DemoContext';
import { useRealtimeRefresh } from './RealtimeProvider';
import i18n from '../lib/i18n';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;
const LeadDetailModal = lazy(() => import('./LeadDetailModal').then((module) => ({ default: module.LeadDetailModal })));

interface BuyingSignal {
  id: string;
  leadId?: string; // actual DB lead UUID when matched
  company: string;
  person?: string;
  action: string;
  icon: 'eye' | 'click' | 'reply' | 'visit' | 'email';
  score?: number;
  timeAgo: string;
}

// Known ISP / telco / CDN patterns that aren't real companies
const ISP_PATTERNS = [
  /t[- ]?mobile/i, /hotwire comm/i, /comcast/i, /at&t/i, /verizon/i,
  /spectrum/i, /cox comm/i, /charter comm/i, /centurylink/i, /frontier comm/i,
  /windstream/i, /mediacom/i, /altice/i, /optimum/i, /suddenlink/i,
  /bright ?house/i, /cablevision/i, /earthlink/i, /hughesnet/i, /starlink/i,
  /cloudflare/i, /amazon\.com/i, /google llc/i, /microsoft corp/i,
  /facebook.*inc/i, /meta platforms/i, /akamai/i, /fastly/i,
  /level ?3/i, /cogent/i, /zayo/i, /lumen tech/i,
  /sprint/i, /boost mobile/i, /cricket/i, /tracfone/i, /mint mobile/i,
  /visible/i, /us cellular/i, /consumer cellular/i,
];

function isISP(name: string): boolean {
  if (!name) return true;
  return ISP_PATTERNS.some(p => p.test(name));
}

// Demo data for demo@contndr.com
const DEMO_SIGNALS: BuyingSignal[] = [
  { id: 's1', company: 'Shopify Inc', person: 'Sarah Chen', action: 'Visited pricing page', icon: 'visit', score: 88, timeAgo: '12m ago' },
  { id: 's2', company: 'Tesla Energy', person: 'Mark Davis', action: 'Opened email 3x', icon: 'eye', score: 75, timeAgo: '34m ago' },
  { id: 's3', company: 'Stripe Payments', person: 'Lena Park', action: 'Clicked demo link', icon: 'click', score: 82, timeAgo: '1h ago' },
  { id: 's4', company: 'Notion Labs', person: 'James Wu', action: 'Replied to outreach', icon: 'reply', score: 95, timeAgo: '2h ago' },
  { id: 's5', company: 'Figma', person: 'Amy Torres', action: 'Opened case study email', icon: 'email', score: 63, timeAgo: '3h ago' },
];

function SignalIcon({ type }: { type: BuyingSignal['icon'] }) {
  const cls = 'w-3 h-3 text-[#1ED4A7]';
  switch (type) {
    case 'eye': return <Eye className={cls} />;
    case 'click': return <MousePointerClick className={cls} />;
    case 'reply': return <Reply className={cls} />;
    case 'visit': return <Globe className={cls} />;
    case 'email': return <Mail className={cls} />;
  }
}

function ScoreBadge({ score }: { score: number }) {
  return <span className="text-[11px] font-bold tabular-nums text-zinc-400 dark:text-zinc-500">{score}</span>;
}

export function DashboardCampaignSignals({ onNavigate }: { onNavigate: (view: string) => void }) {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const refreshKey = useRealtimeRefresh(['email:opened', 'email:clicked', 'email:replied', 'lead:created', 'lead:bulk_action']);
  const [signals, setSignals] = useState<BuyingSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const authRetryRef = useRef(0);

  useEffect(() => {
    loadSignals();
  }, [isDemoMode, refreshKey]);

  async function loadSignals() {
    // In sandbox demo mode, use demo data immediately — no API calls
    if (isDemoMode) {
      setSignals(DEMO_SIGNALS);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      let isDemo = false;
      let userId: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
        userId = session?.user?.id || null;
      } catch (_) {}

      if (!userId) {
        setSignals([]);
        if (authRetryRef.current < 4) {
          authRetryRef.current += 1;
          setTimeout(() => loadSignals(), 600);
        }
        return;
      }
      authRetryRef.current = 0;

      const signalData = await apiCache.fetch(`dashboard:buying-signals:${userId}:v3`, async () => {
        try {
          // Fetch intent signals and campaign leads in parallel
          const [intentRes, leadsResult] = await Promise.all([
            authenticatedFetch(`${API_BASE}/intent/dashboard`).then(r => r.ok ? r.json() : { recent_signals: [] }).catch(() => ({ recent_signals: [] })),
            userId ? supabase
              .from('leads')
              .select('id, first_name, last_name, company, email, status, engagement_score, updated_at')
              .eq('user_id', userId)
              .in('status', ['contacted', 'replied', 'meeting_scheduled', 'opened', 'clicked'])
              .order('updated_at', { ascending: false })
              .limit(200)
              .then(r => r.data || [])
              .catch(() => []) : Promise.resolve([]),
          ]);

          // Build lookup maps from campaign leads
          const leadsByEmail = new Map<string, any>();
          const leadsByCompany = new Map<string, any[]>();
          for (const lead of (leadsResult as any[])) {
            if (lead.email) leadsByEmail.set(lead.email.toLowerCase(), lead);
            if (lead.company) {
              const key = lead.company.toLowerCase().trim();
              if (!leadsByCompany.has(key)) leadsByCompany.set(key, []);
              leadsByCompany.get(key)!.push(lead);
            }
          }

          // Process intent signals: enrich with lead data and filter out ISPs
          const rawSignals = intentRes.recent_signals || [];
          const enriched: BuyingSignal[] = [];

          for (const s of rawSignals) {
            const companyName = s.company_name || '';
            const personEmail = s.person_email || '';
            const personName = s.person_name || '';

            // Try to match to a campaign lead
            let matchedLead: any = null;
            if (personEmail && leadsByEmail.has(personEmail.toLowerCase())) {
              matchedLead = leadsByEmail.get(personEmail.toLowerCase());
            } else if (companyName) {
              const companyLeads = leadsByCompany.get(companyName.toLowerCase().trim());
              if (companyLeads?.length) matchedLead = companyLeads[0];
            }

            // If matched to a lead, always show it
            if (matchedLead) {
              const name = [matchedLead.first_name, matchedLead.last_name].filter(Boolean).join(' ');
              enriched.push({
                id: s.id || Math.random().toString(36),
                leadId: matchedLead.id,
                company: matchedLead.company || companyName || 'Unknown',
                person: name || personName || undefined,
                action: mapSignalAction(s),
                icon: mapSignalIcon(s.signal_type, s.signal_detail),
                score: s.score || matchedLead.engagement_score || undefined,
                timeAgo: formatTimeAgo(s.created_at),
              });
              continue;
            }

            // No lead match — skip if it looks like an ISP
            if (isISP(companyName)) continue;

            // Keep it if it has a real person name or non-ISP company
            if (personName || companyName) {
              enriched.push({
                id: s.id || Math.random().toString(36),
                company: companyName || 'Unknown',
                person: personName || undefined,
                action: mapSignalAction(s),
                icon: mapSignalIcon(s.signal_type, s.signal_detail),
                score: s.score || undefined,
                timeAgo: formatTimeAgo(s.created_at),
              });
            }
          }

          // If we have enriched signals from intent, use them
          if (enriched.length > 0) return enriched.slice(0, 8);

          // Fallback: build signals from campaign lead engagement directly
          const engagedLeads = (leadsResult as any[])
            .filter((l: any) => l.status !== 'new' && l.company)
            .slice(0, 8);

          return engagedLeads.map((lead: any) => ({
            id: lead.id,
            leadId: lead.id,
            company: lead.company,
            person: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || undefined,
            action: mapLeadStatusAction(lead.status),
            icon: mapLeadStatusIcon(lead.status),
            score: lead.engagement_score || undefined,
            timeAgo: formatTimeAgo(lead.updated_at),
          }));
        } catch { return []; }
      }, { staleTime: 15_000, cacheTime: 60_000 }).catch(() => []);

      if (isDemo && (signalData as BuyingSignal[]).length === 0) {
        setSignals(DEMO_SIGNALS);
      } else {
        setSignals((signalData as BuyingSignal[]) || []);
      }
    } catch (err) {
      console.error('[DASHBOARD] Buying signals error:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">{t('dashboard.buyingSignals')}</h3>
        <button
          onClick={() => onNavigate('intent')}
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-[#1ED4A7] transition-colors"
        >
          {t('common.viewAll')} <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <DashboardListSkeleton rows={4} />
      ) : signals.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-0.5 -mx-1">
          {signals.map((signal) => (
            <div
              key={signal.id}
              className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer group"
              onClick={() => {
                if (signal.leadId) {
                  setSelectedLeadId(signal.leadId);
                } else {
                  onNavigate('intent');
                }
              }}
            >
              <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-white/[0.06] flex items-center justify-center flex-shrink-0 group-hover:bg-zinc-200 dark:group-hover:bg-white/[0.08] transition-colors">
                <SignalIcon type={signal.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-zinc-900 dark:text-white truncate">
                      {signal.person || signal.company}
                    </p>
                    {signal.person && signal.company && (
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-600 truncate">{signal.company}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {signal.leadId && (
                      <UserRound className="w-3 h-3 text-zinc-500 dark:text-zinc-600 group-hover:text-[#1ED4A7] transition-colors" />
                    )}
                    {signal.score && <ScoreBadge score={signal.score} />}
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 whitespace-nowrap">{signal.timeAgo}</span>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 truncate">{signal.action}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2.5 px-4">
          <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-white/[0.04] flex items-center justify-center">
            <Zap className="w-5 h-5 text-zinc-300 dark:text-zinc-700" />
          </div>
          <div className="text-center">
            <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-500 mb-1.5">{t('dashboard.noBuyingSignalsYet')}</p>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600 leading-relaxed">
              {t('dashboard.signalsAppearWhen')}
            </p>
            <div className="flex flex-col gap-0.5 mt-1.5">
              {[t('dashboard.signalOpenEmails'), t('dashboard.signalClickLinks'), t('dashboard.signalVisitPages'), t('dashboard.signalReplyOutreach')].map(label => (
                <div key={label} className="flex items-center gap-1.5 justify-center">
                  <div className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 flex-shrink-0" />
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-600">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lead Detail Modal — same as CRM */}
      {selectedLeadId && (
        <Suspense fallback={null}>
          <LeadDetailModal
            leadId={selectedLeadId}
            onClose={() => setSelectedLeadId(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

function mapSignalAction(signal: any): string {
  const detail = signal.signal_detail || '';
  const type = signal.signal_type || '';
  const meta = signal.metadata || {};
  const tr = i18n.t.bind(i18n);

  if (detail === 'email_multiple_replies' || detail === 'email_replied') {
    const count = meta.reply_count || 1;
    return count > 1 ? tr('dashboard.signalRepliedMultiple', { count }) : tr('dashboard.signalRepliedOnce');
  }
  if (detail === 'email_opened' || type === 'email') {
    const count = meta.count || meta.open_count || 1;
    return count > 1 ? tr('dashboard.signalOpenedMultiple', { count }) : tr('dashboard.signalOpenedOnce');
  }
  if (detail === 'email_clicked' || detail === 'link_clicked') {
    return meta.link_text ? tr('dashboard.signalClickedLink', { text: meta.link_text }) : tr('dashboard.signalClickedLinkGeneric');
  }
  if (type === 'website' || detail === 'page_view') {
    return meta.page_title ? tr('dashboard.signalVisitedPage', { page: meta.page_title }) : tr('dashboard.signalVisitedWebsite');
  }
  if (type === 'keyword') {
    return meta.keyword ? tr('dashboard.signalMatchedKeyword', { keyword: meta.keyword }) : tr('dashboard.signalMatchedICP');
  }
  if (type === 'activity') {
    return meta.activity || detail || tr('dashboard.signalActivityDetected');
  }
  return detail || tr('dashboard.signalEngagementDetected');
}

function mapSignalIcon(type: string, detail: string): BuyingSignal['icon'] {
  if (detail?.includes('replied') || detail?.includes('reply')) return 'reply';
  if (detail?.includes('clicked') || detail?.includes('click')) return 'click';
  if (type === 'website' || detail?.includes('page_view') || detail?.includes('visit')) return 'visit';
  if (type === 'email' || detail?.includes('opened') || detail?.includes('email')) return 'eye';
  return 'email';
}

function mapLeadStatusAction(status: string): string {
  const tr = i18n.t.bind(i18n);
  switch (status) {
    case 'replied': return tr('dashboard.signalRepliedOnce');
    case 'meeting_scheduled': return tr('dashboard.signalMeetingScheduled');
    case 'clicked': return tr('dashboard.signalClickedLinkGeneric');
    case 'opened': return tr('dashboard.signalOpenedOnce');
    case 'contacted': return tr('dashboard.signalContactedViaCampaign');
    default: return tr('dashboard.signalEngaged');
  }
}

function mapLeadStatusIcon(status: string): BuyingSignal['icon'] {
  switch (status) {
    case 'replied': return 'reply';
    case 'meeting_scheduled': return 'reply';
    case 'clicked': return 'click';
    case 'opened': return 'eye';
    default: return 'email';
  }
}

function formatTimeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const tr = i18n.t.bind(i18n);
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return tr('dashboard.timeNow');
  if (mins < 60) return tr('dashboard.timeMinsAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return tr('dashboard.timeHoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  return tr('dashboard.timeDaysAgo', { count: days });
}
