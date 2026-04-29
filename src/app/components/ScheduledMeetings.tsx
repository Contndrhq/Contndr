import { useState, useEffect } from 'react';
import { Calendar, Clock, User, Mail, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';
import { apiCache } from '../lib/api-cache';

interface Invitee {
  email: string;
  name: string;
  status: string;
  createdAt: string;
  canceledAt?: string;
  rescheduled: boolean;
}

interface ScheduledEvent {
  uri: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string;
  location: any;
  inviteesCounter: {
    total: number;
    active: number;
    limit: number;
  };
  createdAt: string;
  invitees: Invitee[];
}

export function ScheduledMeetings() {
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    fetchScheduledEvents();
  }, []);

  const fetchScheduledEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      setNotConfigured(false);

      const response = await apiCache.fetch(
        'settings:calendly-events',
        async () => {
          const res = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/calendly/scheduled-events`
          );
          if (!res.ok) {
            throw new Error('Failed to fetch scheduled events');
          }
          const data = await res.json();
          // Server now returns 200 + configured:false when Calendly is not set up
          if (data.configured === false || data.error === 'Not configured') {
            return { _notConfigured: true, events: [] };
          }
          return data;
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );

      if (response._notConfigured) {
        setNotConfigured(true);
        setEvents([]);
        return;
      }

      setEvents(response.events || []);
    } catch (err) {
      // Suppress network errors
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        console.warn('[CALENDLY] Network error fetching meetings');
        setError('Network error - please check your internet connection');
        return;
      }

      console.error('Error fetching scheduled events:', err);
      setError(err instanceof Error ? err.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  const getLocationText = (location: any) => {
    if (!location) return 'No location specified';
    if (location.type === 'physical') return location.location;
    if (location.type === 'zoom') return 'Zoom Meeting';
    if (location.type === 'google_conference') return 'Google Meet';
    if (location.type === 'microsoft_teams') return 'Microsoft Teams';
    if (location.type === 'custom') return location.location;
    return 'Online Meeting';
  };

  const isUpcoming = (startTime: string) => {
    return new Date(startTime) > new Date();
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-black rounded-xl border border-gray-200 dark:border-white/10 p-6">
        <LoadingSpinner center size="md" text="Loading scheduled meetings..." />
      </div>
    );
  }

  // Not configured state - cleaner than error
  if (notConfigured) {
    return (
      <div className="bg-white dark:bg-black rounded-xl border border-gray-200 dark:border-white/10 p-8 text-center">
        <div className="w-12 h-12 bg-gray-100 dark:bg-white/5 rounded-xl flex items-center justify-center mx-auto mb-4">
          <Calendar className="w-6 h-6 text-gray-400" />
        </div>
        <h3 className="text-gray-900 dark:text-white font-medium mb-1">
          Calendly Not Connected
        </h3>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">
          Connect your Calendly account above to see your scheduled meetings here.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-black rounded-xl border border-gray-200 dark:border-white/10 p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[14px] text-red-800 dark:text-red-200 mb-1">Unable to load meetings</p>
              <p className="text-[12px] text-red-600 dark:text-red-300">{error}</p>
            </div>
          </div>
          <button
            onClick={fetchScheduledEvents}
            className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[13px] rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-black rounded-xl border border-gray-200 dark:border-white/10">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#1ED4A7]" />
            <h3 className="text-gray-900 dark:text-white">
              Scheduled Meetings
            </h3>
          </div>
          <button
            onClick={fetchScheduledEvents}
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="divide-y divide-gray-200 dark:divide-white/10">
        {events.length === 0 ? (
          <div className="p-12 text-center">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400 mb-1">
              No scheduled meetings
            </p>
            <p className="text-[13px] text-gray-500 dark:text-gray-500">
              Meetings booked through Calendly will appear here
            </p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.uri} className="p-6 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      {event.name}
                    </h4>
                    {isUpcoming(event.startTime) ? (
                      <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded">
                        Upcoming
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400 text-xs rounded">
                        Past
                      </span>
                    )}
                    {event.status === 'canceled' && (
                      <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs rounded">
                        Canceled
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 mb-3">
                    <div className="flex items-center gap-2 text-[13px] text-gray-600 dark:text-gray-400">
                      <Clock className="w-4 h-4" />
                      {formatDateTime(event.startTime)}
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-gray-600 dark:text-gray-400">
                      <ExternalLink className="w-4 h-4" />
                      {getLocationText(event.location)}
                    </div>
                  </div>

                  {/* Invitees */}
                  {event.invitees.length > 0 && (
                    <div className="space-y-2">
                      {event.invitees.map((invitee, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/5 rounded-lg"
                        >
                          <div className="w-8 h-8 bg-[#1ED4A7]/10 rounded-full flex items-center justify-center">
                            <User className="w-4 h-4 text-[#1ED4A7]" />
                          </div>
                          <div className="flex-1">
                            <p className="text-[13px] font-medium text-gray-900 dark:text-white">
                              {invitee.name}
                            </p>
                            <p className="text-[12px] text-gray-600 dark:text-gray-400 flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              {invitee.email}
                            </p>
                          </div>
                          <div>
                            {invitee.status === 'active' ? (
                              <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                                Confirmed
                              </span>
                            ) : invitee.status === 'canceled' ? (
                              <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">
                                Canceled
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400 rounded">
                                {invitee.status}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}