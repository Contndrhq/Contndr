import { useState, useEffect } from 'react';
import { Calendar, TrendingUp, Users, Clock, CheckCircle, XCircle, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';

interface CalendlyStats {
  totalMeetings: number;
  upcomingMeetings: number;
  completedMeetings: number;
  canceledMeetings: number;
  conversionRate: number; // Meetings scheduled / Leads contacted
  meetingsByBrand: Record<string, number>;
  meetingsByCampaign: Array<{
    campaignId: string;
    campaignName: string;
    meetingsScheduled: number;
  }>;
  recentMeetings: Array<{
    name: string;
    startTime: string;
    status: string;
    invitees: Array<{ name: string; email: string }>;
  }>;
}

interface CalendlyAnalyticsProps {
  brand?: string;
  compactMode?: boolean;
}

export function CalendlyAnalytics({ brand = 'all', compactMode = false }: CalendlyAnalyticsProps) {
  const [stats, setStats] = useState<CalendlyStats>({
    totalMeetings: 0,
    upcomingMeetings: 0,
    completedMeetings: 0,
    canceledMeetings: 0,
    conversionRate: 0,
    meetingsByBrand: {},
    meetingsByCampaign: [],
    recentMeetings: [],
  });
  const [loading, setLoading] = useState(true);
  const [totalLeadsContacted, setTotalLeadsContacted] = useState(0);

  useEffect(() => {
    loadAnalytics();
  }, [brand]);

  const loadAnalytics = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const userId = session.user.id;

      setLoading(true);

      // Check online status to prevent unnecessary errors
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setLoading(false);
        return;
      }

      // Fetch scheduled meetings from Calendly
      console.log('[CALENDLY] Fetching analytics');
      
      const [meetingsResponse, leadsResponse] = await Promise.all([
        authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/calendly/scheduled-events`
        ).catch(err => {
          // Suppress network errors
          if (err instanceof TypeError && err.message === 'Failed to fetch') {
             return { ok: false, status: 0, statusText: 'Network Error', json: async () => ({ error: 'Network error' }) } as Response;
          }
          if (err instanceof Error && (err.message.includes('Session expired') || err.message.includes('Auth session missing'))) {
             console.warn('[CALENDLY] Auth error:', err.message);
             return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: 'Session expired' }) } as Response;
          }
          console.error('[CALENDLY] Network error fetching meetings:', err);
          return { ok: false, status: 0, statusText: 'Network Error', json: async () => ({ error: err.message }) } as Response;
        }),
        // Get total leads contacted
        (async () => {
          let query = supabase
            .from('leads')
            .select('*', { count: 'estimated', head: true })
            .eq('user_id', userId)
            .or('status.eq.contacted,status.eq.replied,status.eq.meeting_scheduled');
            
          if (brand !== 'all') {
            query = query.eq('brand', brand);
          }
            
          const { count } = await query;
          return { count: count || 0 };
        })()
      ]);

      let meetings: any[] = [];
      if (meetingsResponse && meetingsResponse.ok) {
        const data = await meetingsResponse.json();
        meetings = data.events || [];
      } else {
        // Handle Not Configured gracefully
        // Server now returns 200 + configured:false instead of 404 to suppress browser console errors
        if (meetingsResponse && meetingsResponse.ok) {
          const data = await meetingsResponse.json().catch(() => ({}));
          if (data.configured === false || data.error === 'Not configured') {
            console.log('[CALENDLY] Not configured, skipping analytics fetch');
            meetings = [];
          } else {
            meetings = data.collection || data.events || [];
          }
        } else if (meetingsResponse && meetingsResponse.status !== 0) {
          // Only log if it's not a network error (status 0) and not our known 404
          console.error('[CALENDLY] Failed to fetch meetings:', {
            status: meetingsResponse.status,
            statusText: meetingsResponse.statusText
          });
          if (meetingsResponse.json) {
            try {
              const errorData = await meetingsResponse.json();
              console.error('[CALENDLY] Error details:', errorData);
              
              // Show user-friendly error message
              if (meetingsResponse.status === 401) {
                toast.error('Calendly API Error', { 
                  description: errorData.details || 'Unable to authenticate with Calendly. Please reconnect in Settings.',
                  duration: 8000
                });
              }
            } catch (e) {
              console.error('[CALENDLY] Could not parse error response');
            }
          }
        }
      }

      const { count: totalContacted } = leadsResponse;
      setTotalLeadsContacted(totalContacted);

      // Calculate stats
      const now = new Date();
      const upcoming = meetings.filter(m => new Date(m.startTime) > now && m.status === 'active');
      const completed = meetings.filter(m => new Date(m.startTime) <= now && m.status === 'active');
      const canceled = meetings.filter(m => m.status === 'canceled');

      // Get meetings scheduled from leads table (in batches)
      let allMeetingLeads: any[] = [];
      let meetingOffset = 0;
      const batchSize = 1000;
      let hasMoreMeetings = true;
      
      while (hasMoreMeetings) {
        const { data: batch } = await supabase
          .from('leads')
          .select('brand, campaign_id, calendly_event_uri')
          .eq('user_id', userId)
          .eq('status', 'meeting_scheduled')
          .not('calendly_event_uri', 'is', null)
          .range(meetingOffset, meetingOffset + batchSize - 1);
        
        if (batch && batch.length > 0) {
          allMeetingLeads = allMeetingLeads.concat(batch);
          meetingOffset += batchSize;
          hasMoreMeetings = batch.length === batchSize;
        } else {
          hasMoreMeetings = false;
        }
      }

      const meetingsWithBrand = allMeetingLeads;
      
      // Filter by brand
      const filteredMeetingsWithBrand = brand === 'all'
        ? meetingsWithBrand
        : meetingsWithBrand.filter(m => m.brand === brand);

      // Dynamically calculate meetings by brand
      const meetingsByBrand: Record<string, number> = {};
      
      // Pre-fill with known brands if they exist in the data to avoid empty chart
      // but only if we have data for them. For new users, this should be empty.
      
      filteredMeetingsWithBrand.forEach(m => {
          if (m.brand) {
              const b = m.brand.toLowerCase();
              meetingsByBrand[b] = (meetingsByBrand[b] || 0) + 1;
          }
      });
      
      // If no meetings, meetingsByBrand is empty.
      // If we want to show 0s for specific brands, we'd need the list of available brands.
      // But for a new user, showing nothing or empty state is better than showing "Roadr 0".
      
      // Group by campaign
      const campaignGroups = filteredMeetingsWithBrand.reduce((acc: any, m) => {
        if (m.campaign_id) {
          acc[m.campaign_id] = (acc[m.campaign_id] || 0) + 1;
        }
        return acc;
      }, {});

      // Fetch campaign names
      const campaignIds = Object.keys(campaignGroups);
      let campaigns: any[] = [];
      if (campaignIds.length > 0) {
          const { data } = await supabase
            .from('campaigns')
            .select('id, name')
            .in('id', campaignIds);
          campaigns = data || [];
      }

      const meetingsByCampaign = campaignIds.map(id => ({
        campaignId: id,
        campaignName: campaigns?.find(c => c.id === id)?.name || 'Unknown Campaign',
        meetingsScheduled: campaignGroups[id],
      }));

      // Calculate conversion rate
      const conversionRate = totalContacted > 0 
        ? (filteredMeetingsWithBrand.length / totalContacted) * 100 
        : 0;

      setStats({
        totalMeetings: filteredMeetingsWithBrand.length,
        upcomingMeetings: upcoming.length,
        completedMeetings: completed.length,
        canceledMeetings: canceled.length,
        conversionRate: Math.round(conversionRate * 10) / 10,
        meetingsByBrand: meetingsByBrand as any,
        meetingsByCampaign: meetingsByCampaign.sort((a, b) => b.meetingsScheduled - a.meetingsScheduled),
        recentMeetings: meetings.slice(0, 5),
      });
    } catch (error) {
      console.error('Error loading Calendly analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-6">
        <LoadingSpinner center size="md" />
      </div>
    );
  }

  if (compactMode) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Meetings', value: stats.totalMeetings, icon: Calendar },
          { label: 'Upcoming', value: stats.upcomingMeetings, icon: Clock },
          { label: 'Conversion', value: `${stats.conversionRate}%`, icon: TrendingUp },
          { label: 'Completed', value: stats.completedMeetings, icon: CheckCircle }
        ].map((item, idx) => (
          <div key={idx} className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-400">{item.label}</span>
              <item.icon className="w-3.5 h-3.5 text-gray-500" />
            </div>
            <p className="text-xl font-bold text-white">{item.value}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="glass-card h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
          Meeting Analytics
        </h3>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse"></span>
          <span className="text-xs text-gray-500 font-medium">Live Sync</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Meetings', value: stats.totalMeetings, icon: Calendar },
            { label: 'Upcoming', value: stats.upcomingMeetings, icon: Clock },
            { label: 'Conversion Rate', value: `${stats.conversionRate}%`, icon: TrendingUp, sub: `${stats.totalMeetings} / ${totalLeadsContacted} leads` },
            { label: 'Completed', value: stats.completedMeetings, icon: CheckCircle }
          ].map((item, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{item.label}</span>
                <item.icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-xl font-bold text-gray-900 dark:text-white mb-0.5">{item.value}</p>
              {item.sub && <p className="text-xs text-gray-500">{item.sub}</p>}
            </div>
          ))}
        </div>

        {/* Brand Breakdown */}
        {brand === 'all' && (
          <div className="mb-8">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4">
              Meetings by Brand
            </h4>
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(stats.meetingsByBrand).map(([brandName, count]) => (
                <div key={brandName} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 transition-colors">
                  <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 capitalize">{brandName}</span>
                  <span className="text-[13px] font-bold text-gray-900 dark:text-white">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Campaign Performance */}
        {stats.meetingsByCampaign.length > 0 && (
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4">
              Top Performance
            </h4>
            <div className="space-y-3">
              {stats.meetingsByCampaign.slice(0, 5).map((campaign, idx) => (
                <div
                  key={campaign.campaignId}
                  className="flex items-center justify-between group p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-400 dark:text-gray-600 w-4">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[13px] text-gray-700 dark:text-gray-300 font-medium group-hover:text-[#1ED4A7] transition-colors">
                      {campaign.campaignName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-gray-900 dark:text-white">
                      {campaign.meetingsScheduled}
                    </span>
                    <span className="text-xs text-gray-500">mtgs</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}