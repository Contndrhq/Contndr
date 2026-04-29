import { useState, useEffect } from 'react';
import { Calendar, Clock, Link as LinkIcon, CheckCircle, X, ExternalLink, Key, Loader2, AlertCircle } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';

interface EventType {
  uri: string;
  name: string;
  slug: string;
  duration: number;
  schedulingUrl: string;
  description: string;
  color: string;
  active: boolean;
}

interface CalendlyUser {
  name: string;
  email: string;
  schedulingUrl: string;
  timezone: string;
  avatarUrl?: string;
}

interface CalendlySettingsProps {
  onClose?: () => void;
  standalone?: boolean;
}

export function CalendlySettings({ onClose, standalone = false }: CalendlySettingsProps) {
  const [user, setUser] = useState<CalendlyUser | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  
  // Connection state
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserEmail(session.user.email || null);
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    fetchCalendlyData();
  }, []);

  const fetchCalendlyData = async () => {
    try {
      setLoading(true);
      setError(null);
      setConnectionError(null);

      const headers = await getAuthHeaders();
      
      // Fetch user info
      const userResponse = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/calendly/user`,
        { headers }
      );

      // Handle not configured state
      if (userResponse.status === 404) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Handle invalid key
      if (userResponse.status === 401) {
        setUser(null);
        setConnectionError('Invalid API Key. Please reconnect.');
        setLoading(false);
        return;
      }

      if (!userResponse.ok) {
        throw new Error('Failed to fetch Calendly user info');
      }

      const userData = await userResponse.json();
      setUser(userData);

      // Fetch event types
      const eventTypesResponse = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/calendly/event-types`,
        { headers }
      );

      if (!eventTypesResponse.ok) {
        console.warn('Failed to fetch event types');
        // Don't fail completely if event types fail, just show user info
        setEventTypes([]);
      } else {
        const eventTypesData = await eventTypesResponse.json();
        setEventTypes(eventTypesData.eventTypes || []);

        // Auto-select first event type
        if (eventTypesData.eventTypes && eventTypesData.eventTypes.length > 0) {
          setSelectedEventType(eventTypesData.eventTypes[0].uri);
        }
      }
    } catch (err) {
      // Suppress network errors from console
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        console.warn('[CALENDLY] Network error fetching settings');
        if (user) {
          setError('Network error - please check your internet connection');
        } else {
          // If we can't fetch user, we might be offline. 
          // Show connection error on the connect screen if we were trying to load initial state
          setConnectionError('Network error - please check your internet connection');
        }
        return;
      }

      console.error('Error fetching Calendly data:', err);
      // If we are not connected, we don't want to show a generic error, just the connect screen
      if (user) {
        setError(err instanceof Error ? err.message : 'Failed to load Calendly data');
      }
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!apiKey.trim()) return;

    try {
      setSaving(true);
      setConnectionError(null);
      
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/calendly/config`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ apiKey: apiKey.trim() })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      // Refresh data
      await fetchCalendlyData();
      setApiKey(''); // Clear input
    } catch (err) {
      console.error('Error saving config:', err);
      setConnectionError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const copyToClipboard = (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        // Fallback for browsers without clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (err) {
          console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  };

  const renderConnectScreen = () => (
    <div className="bg-white dark:bg-black rounded-2xl border border-gray-200 dark:border-white/10 p-8 text-center max-w-lg mx-auto">
      <div className="w-16 h-16 bg-gray-50 dark:bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Calendar className="w-8 h-8 text-[#1ED4A7]" />
      </div>
      
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Connect Calendly
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        Generate personalized booking links and automate your scheduling workflow.
      </p>

      {connectionError && (
        <div className="bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 mb-6 text-left flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-zinc-500 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{connectionError}</p>
        </div>
      )}

      <div className="text-left space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Personal Access Token
          </label>
          <div className="relative">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Calendly API Key"
              className="w-full px-4 py-2.5 pl-10 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] transition-all"
            />
            <Key className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Go to <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noopener noreferrer" className="text-zinc-900 dark:text-white underline hover:no-underline font-medium">Calendly Integrations</a> to generate a token.
          </p>
        </div>

        <button
          onClick={saveConfig}
          disabled={saving || !apiKey}
          className="w-full py-2.5 bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting...
            </>
          ) : (
            'Connect Account'
          )}
        </button>
      </div>
    </div>
  );

  const mainContent = (
    <>
      {loading ? (
        <LoadingSpinner center size="md" />
      ) : !user ? (
        renderConnectScreen()
      ) : (
        <div className="space-y-6">
          {/* Connected Account */}
          <div className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-[#1ED4A7] mt-0.5" />
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      Connected to Calendly
                    </p>
                    {/* Connected User Details */}
                    {true && (
                      <>
                        <p className="text-[13px] text-gray-700 dark:text-gray-300 mt-1">
                          {user.name} ({user.email})
                        </p>
                        <p className="text-[12px] text-gray-600 dark:text-gray-400 mt-1">
                          Timezone: {user.timezone}
                        </p>
                      </>
                    )}
                  </div>
                  {/* Option to disconnect could go here */}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
               <p className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
            </div>
          )}

          {/* Event Types */}
          <div>
            <h3 className="text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#1ED4A7]" />
              Your Event Types
            </h3>
            <p className="text-[13px] text-gray-600 dark:text-gray-400 mb-4">
              These meeting types will be available when creating campaigns and generating booking links.
            </p>

            {eventTypes.length === 0 ? (
              <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg p-8 text-center">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  No event types found
                </p>
                <p className="text-[13px] text-gray-500 dark:text-gray-500 mb-4">
                  Create event types in your Calendly dashboard to get started
                </p>
                <a
                  href="https://calendly.com/event_types"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black text-[13px] font-medium rounded-lg transition-colors border border-transparent"
                >
                  Open Calendly Dashboard
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {eventTypes.map((eventType) => (
                  <div
                    key={eventType.uri}
                    className={`p-4 border-2 rounded-lg transition-all cursor-pointer ${
                      selectedEventType === eventType.uri
                        ? 'border-black dark:border-white bg-gray-50 dark:bg-white/5'
                        : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                    }`}
                    onClick={() => setSelectedEventType(eventType.uri)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-gray-900 dark:text-white">
                            {eventType.name}
                          </h4>
                          <span className="text-[12px] px-2 py-0.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400 rounded">
                            {formatDuration(eventType.duration)}
                          </span>
                        </div>
                        {eventType.description && (
                          <p className="text-[13px] text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                            {eventType.description.replace(/<[^>]*>?/gm, '')}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(eventType.schedulingUrl);
                            }}
                            className="flex items-center gap-1.5 text-[12px] text-gray-900 dark:text-white hover:underline"
                          >
                            <LinkIcon className="w-3.5 h-3.5" />
                            Copy Booking Link
                          </button>
                          <a
                            href={eventType.schedulingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1.5 text-[12px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            View Page
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );

  const content = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-black rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-white/10">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-gray-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-gray-900 dark:text-white" />
                Calendly Integration
              </h2>
              <p className="text-[13px] text-gray-600 dark:text-gray-400 mt-1">
                Connect your Calendly account to automate meeting bookings
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {mainContent}
        </div>

        {/* Footer */}
        {user && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-[13px] text-gray-600 dark:text-gray-400">
                {eventTypes.length} event type{eventTypes.length !== 1 ? 's' : ''} available
              </p>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black text-[13px] rounded-lg transition-colors w-full sm:w-auto"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return standalone ? content : mainContent;
}