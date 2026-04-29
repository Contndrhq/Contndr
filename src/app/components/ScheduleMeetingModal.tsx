import { useState, useEffect } from 'react';
import { Calendar, Clock, X, Link as LinkIcon, CheckCircle, Copy, ExternalLink } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface EventType {
  uri: string;
  name: string;
  duration: number;
  schedulingUrl: string;
  description: string;
}

interface Lead {
  id: string;
  business_name: string;
  contact_name?: string;
  email: string;
}

interface ScheduleMeetingModalProps {
  lead: Lead;
  campaignId?: string;
  brand?: string;
  onClose: () => void;
  onScheduled?: () => void;
}

export function ScheduleMeetingModal({ lead, campaignId, brand, onClose, onScheduled }: ScheduleMeetingModalProps) {
  const { t } = useTranslation();
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [schedulingLink, setSchedulingLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    fetchEventTypes();
  }, []);

  const fetchEventTypes = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/calendly/event-types`,
        { headers: await getAuthHeaders() }
      );

      if (!response.ok) {
        // Handle not configured gracefully
        if (response.status === 404) {
          setEventTypes([]);
          return;
        }
        throw new Error('Failed to fetch event types');
      }

      const data = await response.json();
      setEventTypes(data.eventTypes || []);

      // Auto-select first event type
      if (data.eventTypes.length > 0) {
        setSelectedEventType(data.eventTypes[0].uri);
      }
    } catch (err) {
      // Suppress network errors
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        console.warn('[CALENDLY] Network error fetching event types');
        setError(t('scheduleMeetingModal.networkError'));
        return;
      }

      console.error('Error fetching event types:', err);
      setError(err instanceof Error ? err.message : t('scheduleMeetingModal.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const generateSchedulingLink = async () => {
    if (!selectedEventType) {
      toast.error(t('scheduleMeetingModal.chooseEventType'));
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/calendly/scheduling-link`,
        {
          method: 'POST',
          headers: await getAuthHeaders(),
          body: JSON.stringify({
            eventTypeUri: selectedEventType,
            leadId: lead.id,
            leadEmail: lead.email,
            leadName: lead.contact_name || lead.business_name,
            campaignId: campaignId,
            brand: brand,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(t('scheduleMeetingModal.failedToGenerate'));
      }

      const data = await response.json();
      setSchedulingLink(data.schedulingLink);
      toast.success(t('scheduleMeetingModal.schedulingLink') + '!');
    } catch (err) {
      console.error('Error generating link:', err);
      setError(err instanceof Error ? err.message : t('scheduleMeetingModal.failedToGenerate'));
      toast.error(t('scheduleMeetingModal.failedToGenerate'));
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!schedulingLink) return;
    
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(schedulingLink);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      } else {
        // Fallback for browsers without clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = schedulingLink;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 2000);
        } catch (err) {
          console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  };

  const openLink = () => {
    if (!schedulingLink) return;
    window.open(schedulingLink, '_blank');
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const selectedEvent = eventTypes.find(et => et.uri === selectedEventType);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-gray-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                Schedule Meeting
              </h2>
              <p className="text-[13px] text-gray-600 dark:text-gray-400 mt-1">
                Generate a personalized booking link for {lead.contact_name || lead.business_name}
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
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mb-4"></div>
              <p className="text-[14px] text-gray-600 dark:text-gray-400">
                Loading meeting types...
              </p>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-[14px] text-red-800 dark:text-red-200">{error}</p>
              <button
                onClick={fetchEventTypes}
                className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[13px] rounded-lg transition-colors"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : eventTypes.length === 0 ? (
            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-gray-900 dark:text-white font-medium mb-2">
                Calendly Not Connected
              </h3>
              <p className="text-[13px] text-gray-500 dark:text-gray-500 mb-4">
                {t('scheduleMeetingModal.connectCalendly')}
              </p>
              <a
                href="/settings"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] rounded-lg transition-colors"
              >
                {t('scheduleMeetingModal.goToSettings')}
              </a>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Lead Info */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="font-medium text-blue-900 dark:text-blue-200 mb-2">
                  Meeting with:
                </h3>
                <p className="text-[14px] text-blue-800 dark:text-blue-300">
                  {lead.contact_name || lead.business_name}
                </p>
                <p className="text-[13px] text-blue-700 dark:text-blue-400">
                  {lead.email}
                </p>
              </div>

              {/* Event Type Selection */}
              <div>
                <h3 className="text-gray-900 dark:text-white mb-3">
                  Select Meeting Type
                </h3>
                <div className="space-y-2">
                  {eventTypes.map((eventType) => (
                    <button
                      key={eventType.uri}
                      onClick={() => setSelectedEventType(eventType.uri)}
                      className={`w-full p-4 border-2 rounded-lg text-left transition-all ${
                        selectedEventType === eventType.uri
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-gray-900 dark:text-white">
                              {eventType.name}
                            </h4>
                            <span className="text-[12px] px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                              <Clock className="w-3 h-3 inline mr-1" />
                              {formatDuration(eventType.duration)}
                            </span>
                          </div>
                          {eventType.description && (
                            <p className="text-[13px] text-gray-600 dark:text-gray-400 mt-1">
                              {eventType.description}
                            </p>
                          )}
                        </div>
                        {selectedEventType === eventType.uri && (
                          <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 ml-3" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Generated Link */}
              {schedulingLink && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-green-900 dark:text-green-200 mb-2">
                        Booking Link Generated
                      </p>
                      <div className="bg-white dark:bg-gray-900 rounded p-3 mb-3 break-all">
                        <code className="text-[12px] text-gray-900 dark:text-white">
                          {schedulingLink}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={copyToClipboard}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-[13px] rounded-lg transition-colors"
                        >
                          <Copy className="w-4 h-4" />
                          {linkCopied ? t('scheduleMeetingModal.copied') : t('scheduleMeetingModal.copyLink')}
                        </button>
                        <button
                          onClick={openLink}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white text-[13px] border border-gray-300 dark:border-gray-600 rounded-lg transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                          {t('scheduleMeetingModal.openLink')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[13px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {t('common.cancel')}
            </button>
            {!schedulingLink && (
              <button
                onClick={generateSchedulingLink}
                disabled={!selectedEventType || generating}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-[13px] rounded-lg transition-colors flex items-center gap-2"
              >
                {generating ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                    {t('scheduleMeetingModal.generating')}
                  </>
                ) : (
                  <>
                    <LinkIcon className="w-4 h-4" />
                    {t('scheduleMeetingModal.generateLink')}
                  </>
                )}
              </button>
            )}
            {schedulingLink && (
              <button
                onClick={() => {
                  if (onScheduled) onScheduled();
                  onClose();
                }}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-[13px] rounded-lg transition-colors"
              >
                {t('scheduleMeetingModal.done')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}