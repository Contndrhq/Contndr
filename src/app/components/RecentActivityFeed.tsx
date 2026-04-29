import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MailOpen, MousePointerClick, Reply, Send, TrendingUp, User, Eye } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';
import { useDemoMode } from './DemoContext';
import i18n from '../lib/i18n';

interface Activity {
  id: string;
  type: 'email_sent' | 'email_opened' | 'email_clicked' | 'email_replied' | 'campaign_created' | 'lead_added';
  message: string;
  timestamp: string;
  metadata?: any;
  // Team attribution
  member_name?: string;
  is_you?: boolean;
}

interface RecentActivityFeedProps {
  onNavigate?: (view: string) => void;
}

// ── Demo activity data (demo@contndr.com only) ─────────────────────
function buildDemoActivities(t: (key: string, opts?: any) => string): Activity[] {
  const now = Date.now();
  const h = 3600000;
  const d = 86400000;
  return [
    { id: 'demo-a1',  type: 'email_clicked', message: t('activityFeed.clickedLink', { name: 'Smart Ventures' }), timestamp: new Date(now - 2 * h).toISOString(), metadata: { subject: 'Partnership Opportunities - Special Invitation', clicks: 3 }, is_you: true },
    { id: 'demo-a1b', type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'Smart Ventures' }), timestamp: new Date(now - 2.1 * h).toISOString(), metadata: { subject: 'Partnership Opportunities - Special Invitation', status: 'clicked', opens: 4, clicks: 3 }, is_you: true },
    { id: 'demo-a2',  type: 'email_replied',  message: t('activityFeed.repliedToEmail', { name: 'Apex Digital' }), timestamp: new Date(now - 5 * h).toISOString(), metadata: { subject: 'Growth Strategy - Special Invitation' }, is_you: true },
    { id: 'demo-a2b', type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'Apex Digital' }), timestamp: new Date(now - 5.1 * h).toISOString(), metadata: { subject: 'Growth Strategy - Special Invitation', status: 'replied', opens: 2, replied: true }, is_you: true },
    { id: 'demo-a3',  type: 'email_opened',   message: t('activityFeed.openedEmail', { name: 'Velocity Corp' }), timestamp: new Date(now - 8 * h).toISOString(), metadata: { subject: 'Q1 Outreach - Special Invitation', opens: 2 }, is_you: true },
    { id: 'demo-a3b', type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'Velocity Corp' }), timestamp: new Date(now - 8.1 * h).toISOString(), metadata: { subject: 'Q1 Outreach - Special Invitation', status: 'opened', opens: 2 }, is_you: true },
    { id: 'demo-a4',  type: 'email_clicked', message: t('activityFeed.clickedLink', { name: 'Smart Labs' }), timestamp: new Date(now - 12 * h).toISOString(), metadata: { subject: 'New Product Launch - Special Invitation', clicks: 1 }, is_you: true },
    { id: 'demo-a5',  type: 'email_replied',  message: t('activityFeed.repliedToEmail', { name: 'Smart Labs' }), timestamp: new Date(now - 1 * d).toISOString(), metadata: { subject: 'New Product Launch - Special Invitation' }, is_you: true },
    { id: 'demo-a6',  type: 'email_opened',   message: t('activityFeed.openedEmail', { name: 'Rapid Enterprises' }), timestamp: new Date(now - 1.2 * d).toISOString(), metadata: { subject: 'Holiday Special Offer - Special Invitation', opens: 5 }, is_you: true },
    { id: 'demo-a6b', type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'Rapid Enterprises' }), timestamp: new Date(now - 1.21 * d).toISOString(), metadata: { subject: 'Holiday Special Offer - Special Invitation', status: 'opened', opens: 5 }, is_you: true },
    { id: 'demo-a7',  type: 'email_clicked', message: t('activityFeed.clickedLink', { name: 'Nexus Group' }), timestamp: new Date(now - 1.5 * d).toISOString(), metadata: { subject: 'Exclusive Demo - Special Invitation', clicks: 2 }, is_you: true },
    { id: 'demo-a8',  type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'Summit Analytics' }), timestamp: new Date(now - 2 * d).toISOString(), metadata: { subject: 'Data Insights - Special Invitation' }, is_you: true },
    { id: 'demo-a9',  type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'BlueWave Solutions' }), timestamp: new Date(now - 2.5 * d).toISOString(), metadata: { subject: 'Platform Migration - Special Invitation', status: 'opened', opens: 1 }, is_you: true },
    { id: 'demo-a10', type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'CoreTech Industries' }), timestamp: new Date(now - 3 * d).toISOString(), metadata: { subject: 'Enterprise Plan - Special Invitation' }, is_you: true },
    { id: 'demo-a11', type: 'email_sent', message: t('activityFeed.youEmailed', { name: 'Pinnacle Group' }), timestamp: new Date(now - 3.5 * d).toISOString(), metadata: { subject: 'Scale Outreach - Special Invitation' }, is_you: true },
  ];
}

export function RecentActivityFeed({ onNavigate }: RecentActivityFeedProps) {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamSize, setTeamSize] = useState(1);

  // Helper function to translate activity messages from server
  function translateActivity(activity: Activity): string {
    // If message is already set (from old server code), use it
    // This ensures backward compatibility
    if (activity.message && activity.message.trim()) {
      return activity.message;
    }

    // New translation logic for campaign_created and lead_added
    const meta = activity.metadata || {};
    const member = activity.member_name || '';
    const isYou = activity.is_you === true;

    switch (activity.type) {
      case 'campaign_created':
        const campaignName = meta.campaign_name || '';
        return isYou
          ? t('activityFeed.youCreatedCampaign', { name: campaignName })
          : t('activityFeed.memberCreatedCampaign', { member, name: campaignName });

      case 'lead_added':
        const businessName = meta.business_name || t('activityFeed.aNewLead');
        return isYou
          ? t('activityFeed.youAddedLead', { name: businessName })
          : t('activityFeed.memberAddedLead', { member, name: businessName });

      default:
        return activity.message || '';
    }
  }

  useEffect(() => {
    if (isDemoMode) {
      setActivities(buildDemoActivities(t));
      setTeamSize(1);
      setLoading(false);
      return;
    }
    
    loadActivities();

    // Real-time subscription for email events
    const subscription = supabase
      .channel('activity-feed')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_events',
        },
        () => {
          loadActivities();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [isDemoMode]);

  async function loadActivities() {
    try {
      // Check if demo account
      let isDemo = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isDemo = session?.user?.email === 'demo@contndr.com';
      } catch (_) { /* non-fatal */ }

      // Try team-wide activity first (covers solo users too — they get their own activity back)
      const teamResponse = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/activity`
      );

      if (teamResponse.ok) {
        const teamData = await teamResponse.json();
        console.log('[ACTIVITY FEED] Team activity response:', { 
          team_size: teamData.team_size, 
          activitiesCount: teamData.activities?.length,
          types: teamData.activities?.reduce((acc: any, a: any) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {}),
          error: teamData.error 
        });
        setTeamSize(teamData.team_size || 1);

        // Show ALL team activity (sent, opens, clicks, replies, campaigns, leads)
        if (teamData.activities && teamData.activities.length > 0) {
          setActivities(teamData.activities.slice(0, 12));
          setLoading(false);
          return;
        }
      } else {
        const errText = await teamResponse.text().catch(() => '');
        console.error('[ACTIVITY FEED] Team activity endpoint error:', teamResponse.status, errText);
      }

      // Fallback: load personal activity directly from supabase
      await loadPersonalActivities();

      // If still no engagement activities and this is the demo account, seed demo data
      if (isDemo) {
        // Check current activities after personal fallback loaded
        setTimeout(() => {
          setActivities(prev => {
            const engagementTypes = ['email_clicked', 'email_replied', 'email_opened'];
            const hasEngagement = prev.some(a => engagementTypes.includes(a.type));
            if (!hasEngagement || prev.length === 0) {
              console.log('[DEMO] Seeding demo activity feed with clicks, replies, and opens');
              return buildDemoActivities(t);
            }
            return prev;
          });
        }, 100);
      }
    } catch (error) {
      console.error('Error loading team activity, falling back to personal:', error);
      // If demo account, seed demo data even on error
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email === 'demo@contndr.com') {
          console.log('[DEMO] Seeding demo activity feed (error fallback)');
          setActivities(buildDemoActivities(t));
          setLoading(false);
          return;
        }
      } catch (_) { /* non-fatal */ }
      await loadPersonalActivities();
    }
  }

  async function loadPersonalActivities() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const userId = session.user.id;

      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const activityList: Activity[] = [];

      // 1. Email engagement events (opens, clicks, replies)
      try {
        // Query email_events via emails.user_id join — but use a simpler approach:
        // fetch recent sent emails for this user, then match events via email IDs.
        // This avoids the cross-table user_id filter that was causing 500s.
        const { data: userEmails } = await supabase
          .from('emails')
          .select('id, subject, leads(business_name)')
          .eq('user_id', userId)
          .gte('created_at', oneWeekAgo)
          .order('created_at', { ascending: false })
          .limit(50);

        if (userEmails && userEmails.length > 0) {
          const emailIds = userEmails.map((e: any) => e.id);
          const emailMap = new Map(userEmails.map((e: any) => [e.id, e]));

          const { data: emailEvents } = await supabase
            .from('email_events')
            .select('id, event_type, created_at, email_id')
            .in('email_id', emailIds)
            .in('event_type', ['opened', 'clicked', 'replied'])
            .gte('created_at', oneWeekAgo)
            .order('created_at', { ascending: false })
            .limit(20);

          if (emailEvents) {
            emailEvents.forEach((event: any) => {
              const email = emailMap.get(event.email_id);
              const businessName = (email as any)?.leads?.business_name || 'Unknown';
              let message = '';
              let type: Activity['type'] = 'email_sent';

              switch (event.event_type) {
                case 'opened':
                  message = `${businessName} opened your email`;
                  type = 'email_opened';
                  break;
                case 'clicked':
                  message = `${businessName} clicked a link`;
                  type = 'email_clicked';
                  break;
                case 'replied':
                  message = `${businessName} replied`;
                  type = 'email_replied';
                  break;
                default:
                  return;
              }

              activityList.push({
                id: event.id,
                type,
                message,
                timestamp: event.created_at,
                metadata: { subject: (email as any)?.subject || '' },
                is_you: true,
              });
            });
          }
        }
      } catch (e) {
        console.error('[ACTIVITY FEED] Personal engagement query error:', e);
      }

      // 2. Sent emails (with engagement metadata)
      try {
        const { data: sentEmails } = await supabase
          .from('emails')
          .select('id, subject, created_at, status, open_count, click_count, leads(business_name, contact_name)')
          .eq('user_id', userId)
          .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied'])
          .gte('created_at', oneWeekAgo)
          .order('created_at', { ascending: false })
          .limit(15);

        if (sentEmails) {
          // Track which emails already have engagement events
          const engagementEmailIds = new Set(
            activityList.filter(a => a.type !== 'email_sent').map(a => a.metadata?.email_id).filter(Boolean)
          );

          sentEmails.forEach((email: any) => {
            const biz = email.leads?.business_name || email.leads?.contact_name || 'a lead';

            // Build engagement metadata
            const engagement: any = {};
            if (email.open_count > 0) engagement.opens = email.open_count;
            if (email.click_count > 0) engagement.clicks = email.click_count;
            if (email.status === 'replied') engagement.replied = true;
            if (['opened', 'clicked', 'replied'].includes(email.status)) {
              engagement.status = email.status;
            }

            activityList.push({
              id: `sent-${email.id}`,
              type: 'email_sent',
              message: `You emailed ${biz}`,
              timestamp: email.created_at,
              metadata: { subject: email.subject || '', ...engagement },
              is_you: true,
            });

            // Synthesize engagement activities from email status if no email_events exist
            if (!engagementEmailIds.has(email.id)) {
              const baseTs = new Date(email.created_at).getTime();

              if (email.open_count > 0 || ['opened', 'clicked', 'replied'].includes(email.status)) {
                activityList.push({
                  id: `synth-open-${email.id}`,
                  type: 'email_opened',
                  message: `${biz} opened your email`,
                  timestamp: new Date(baseTs + 60000).toISOString(),
                  metadata: { subject: email.subject || '', email_id: email.id, opens: email.open_count || 1 },
                  is_you: true,
                });
              }

              if (email.click_count > 0 || email.status === 'clicked') {
                activityList.push({
                  id: `synth-click-${email.id}`,
                  type: 'email_clicked',
                  message: `${biz} clicked a link in your email`,
                  timestamp: new Date(baseTs + 120000).toISOString(),
                  metadata: { subject: email.subject || '', email_id: email.id, clicks: email.click_count || 1 },
                  is_you: true,
                });
              }

              if (email.status === 'replied') {
                activityList.push({
                  id: `synth-reply-${email.id}`,
                  type: 'email_replied',
                  message: `${biz} replied to your email`,
                  timestamp: new Date(baseTs + 180000).toISOString(),
                  metadata: { subject: email.subject || '', email_id: email.id },
                  is_you: true,
                });
              }
            }
          });
        }
      } catch (e) {
        console.error('[ACTIVITY FEED] Personal sent query error:', e);
      }

      // 3. Campaigns created
      try {
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('id, name, created_at')
          .eq('user_id', userId)
          .gte('created_at', oneWeekAgo)
          .order('created_at', { ascending: false })
          .limit(5);

        if (campaigns) {
          campaigns.forEach((camp: any) => {
            activityList.push({
              id: `camp-${camp.id}`,
              type: 'campaign_created',
              message: t('activityFeed.youCreatedCampaign', { name: camp.name }),
              timestamp: camp.created_at,
              metadata: {},
              is_you: true,
            });
          });
        }
      } catch (e) {
        console.error('[ACTIVITY FEED] Personal campaigns query error:', e);
      }

      // 4. Leads added
      try {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, business_name, contact_name, created_at')
          .eq('user_id', userId)
          .gte('created_at', oneWeekAgo)
          .order('created_at', { ascending: false })
          .limit(10);

        if (leads) {
          leads.forEach((lead: any) => {
            const biz = lead.business_name || lead.contact_name || t('activityFeed.aNewLead', 'a new lead');
            activityList.push({
              id: `lead-${lead.id}`,
              type: 'lead_added',
              message: t('activityFeed.youAddedLead', { name: biz }),
              timestamp: lead.created_at,
              metadata: {},
              is_you: true,
            });
          });
        }
      } catch (e) {
        console.error('[ACTIVITY FEED] Personal leads query error:', e);
      }

      activityList.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setActivities(activityList.slice(0, 12));
    } catch (error) {
      console.error('Error loading personal activities:', error);
    } finally {
      setLoading(false);
    }
  }

  function getIcon(type: Activity['type']) {
    switch (type) {
      case 'email_sent':
        return <Send className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />;
      case 'email_opened':
        return <MailOpen className="w-4 h-4 text-[#1ED4A7]" />; 
      case 'email_clicked':
        return <MousePointerClick className="w-4 h-4 text-[#1ED4A7]" />;
      case 'email_replied':
        return <Reply className="w-4 h-4 text-[#1ED4A7]" />;
      case 'campaign_created':
        return <Send className="w-4 h-4 text-[#1ED4A7]" />;
      case 'lead_added':
        return <User className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />;
      default:
        return <TrendingUp className="w-4 h-4 text-zinc-500" />;
    }
  }

  /** Engagement type label */
  function getEngagementLabel(type: Activity['type']): string | null {
    switch (type) {
      case 'email_opened': return t('dashboard.opened');
      case 'email_clicked': return t('dashboard.clicked');
      case 'email_replied': return t('dashboard.replied');
      default: return null;
    }
  }

  /** Is this an engagement event (not a user action)? */
  function isEngagement(type: Activity['type']): boolean {
    return type === 'email_opened' || type === 'email_clicked' || type === 'email_replied';
  }

  function formatTimestamp(timestamp: string) {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('dashboard.justNow');
    if (diffMins < 60) return t('dashboard.timeMinsAgo', { count: diffMins });
    if (diffHours < 24) return t('dashboard.timeHoursAgo', { count: diffHours });
    if (diffDays < 7) return t('dashboard.timeDaysAgo', { count: diffDays });
    
    const locale = i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US';
    return then.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }

  function handleActivityClick(activity: Activity) {
    if (!onNavigate) return;

    if (activity.type === 'email_opened' || activity.type === 'email_clicked' || activity.type === 'email_replied') {
      onNavigate('inbox');
    } else if (activity.type === 'email_sent') {
      onNavigate('inbox');
    } else if (activity.type === 'lead_added') {
      onNavigate('crm');
    } else if (activity.type === 'campaign_created') {
      onNavigate('campaigns');
    }
  }

  /** Render inline engagement badges for sent emails that have engagement data */
  function renderEngagementBadges(activity: Activity) {
    const meta = activity.metadata;
    if (!meta) return null;

    const badges: JSX.Element[] = [];

    if (meta.opens > 0) {
      badges.push(
        <span key="opens" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#1ED4A7]/10 text-[#1ED4A7]" title={t('dashboard.openedTimesTitle', { count: meta.opens, plural: meta.opens > 1 ? 's' : '' })}>
          <Eye className="w-2.5 h-2.5" />
          {meta.opens > 1 ? meta.opens : ''}
        </span>
      );
    }

    if (meta.clicks > 0) {
      badges.push(
        <span key="clicks" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#1ED4A7]/10 text-[#1ED4A7]" title={t('dashboard.clickedTimesTitle', { count: meta.clicks, plural: meta.clicks > 1 ? 's' : '' })}>
          <MousePointerClick className="w-2.5 h-2.5" />
          {meta.clicks > 1 ? meta.clicks : ''}
        </span>
      );
    }

    if (meta.replied) {
      badges.push(
        <span key="replied" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#1ED4A7]/10 text-[#1ED4A7]" title={t('dashboard.repliedTitle')}>
          <Reply className="w-2.5 h-2.5" />
        </span>
      );
    }

    if (badges.length === 0) return null;

    return <div className="flex items-center gap-1 mt-0.5">{badges}</div>;
  }

  /** Render engagement count for engagement events (e.g. "3 opens") */
  function renderEngagementCount(activity: Activity) {
    const meta = activity.metadata;
    if (!meta) return null;

    if (activity.type === 'email_opened' && meta.opens > 1) {
      return (
        <span className="text-[10px] text-[#1ED4A7]/70 font-medium tabular-nums">
          {t('dashboard.opensCountLabel', { count: meta.opens })}
        </span>
      );
    }
    if (activity.type === 'email_clicked' && meta.clicks > 1) {
      return (
        <span className="text-[10px] text-[#1ED4A7]/70 font-medium tabular-nums">
          {t('dashboard.clicksCountLabel', { count: meta.clicks })}
        </span>
      );
    }
    return null;
  }

  return (
    <div className="glass-card p-4 h-full max-h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">{t('dashboard.recentActivity')}</h3>
          {teamSize > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1ED4A7]/10 text-[#1ED4A7] font-medium">
              {teamSize} {t('dashboard.members')}
            </span>
          )}
        </div>
        <button
          onClick={() => onNavigate?.('inbox')}
          className="text-[11px] font-medium text-zinc-400 hover:text-[#1ED4A7] transition-colors"
        >
          {t('common.viewAll', 'View All')}
        </button>
      </div>

      {loading ? (
        <LoadingSpinner size="sm" center />
      ) : activities.length === 0 ? (
        <div className="text-center py-8">
          <TrendingUp className="w-8 h-8 text-gray-600 mx-auto mb-2 opacity-50" />
          <p className="text-[13px] text-gray-500">{t('dashboard.noRecentActivity')}</p>
          <p className="text-[11px] text-gray-400 mt-1">{t('dashboard.opensClicksReplies')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-1 flex-1 overflow-y-auto pr-1 custom-scrollbar min-h-0">
          {activities.map((activity) => {
            const engagement = isEngagement(activity.type);
            const engagementLabel = getEngagementLabel(activity.type);

            return (
              <div
                key={activity.id}
                className={`flex items-start gap-2.5 rounded-lg px-2 py-2 group hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors ${onNavigate ? 'cursor-pointer' : ''}`}
                onClick={() => handleActivityClick(activity)}
              >
                <div className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors flex-shrink-0
                  ${engagement
                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                    : 'bg-zinc-100 dark:bg-white/[0.04]'
                  }`}
                >
                  {getIcon(activity.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <p className={`text-[12.5px] font-medium truncate transition-colors
                        ${engagement
                          ? 'text-[#1ED4A7] group-hover:text-[#1ED4A7]/80'
                          : 'text-gray-900 dark:text-white group-hover:text-[#1ED4A7]'
                        }`}
                      >
                        {translateActivity(activity)}
                      </p>
                      {/* Engagement type badge for engagement events */}
                      {engagementLabel && (
                        <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#1ED4A7]/10 text-[#1ED4A7]">
                          {engagementLabel}
                        </span>
                      )}
                    </div>
                    <span className="text-[10.5px] text-gray-500 whitespace-nowrap font-medium tabular-nums">
                      {formatTimestamp(activity.timestamp)}
                    </span>
                  </div>

                  {/* Subject line + engagement counts + team attribution */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {activity.metadata?.subject && (
                      <p className="text-[11px] text-gray-500 truncate group-hover:text-gray-400 dark:group-hover:text-gray-400 transition-colors max-w-[70%]">
                        {activity.metadata.subject}
                      </p>
                    )}
                    {renderEngagementCount(activity)}
                    {teamSize > 1 && activity.member_name && !activity.is_you && (
                      <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                        {activity.member_name}
                      </span>
                    )}
                    {teamSize > 1 && activity.is_you && (
                      <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#1ED4A7]/10 text-[#1ED4A7]">
                        {t('dashboard.you')}
                      </span>
                    )}
                  </div>

                  {/* Inline engagement badges for sent emails with engagement data */}
                  {activity.type === 'email_sent' && renderEngagementBadges(activity)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
