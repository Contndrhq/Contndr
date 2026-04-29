import { useState, useEffect } from 'react';
import { Crosshair, Mail, Phone, MapPin, TrendingUp, MessageSquare, Eye, MousePointer } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { LoadingSpinner } from './LoadingSpinner';
import { toTitleCase } from '../utils/title-case';
import { useDemoMode } from './DemoContext';
import { SmartPhoneButton } from './SmartPhoneButton';
import { useTranslation } from 'react-i18next';

interface Lead {
  id: string;
  business_name: string;
  email: string;
  phone?: string;
  city?: string;
  category?: string;
  status?: string;
  updated_at?: string;
}

interface Reply {
  subject: string;
  body: string;
  classification: string;
  received_at: string;
}

export function HotLeadsView() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);

  // ── Demo data ──
  const demoHotLeads: Lead[] = [
    { id: 'demo-hl-1', business_name: 'Precision Auto Works', email: 'mike@precisionauto.com', phone: '(512) 555-0147', city: 'Austin, TX', category: 'Auto Repair', status: 'hot' },
    { id: 'demo-hl-2', business_name: 'Bright Smile Dental', email: 'info@brightsmile.com', phone: '(303) 555-0298', city: 'Denver, CO', category: 'Dental Clinic', status: 'interested' },
    { id: 'demo-hl-3', business_name: 'Summit HVAC Solutions', email: 'jobs@summithvac.com', phone: '(415) 555-0361', city: 'San Francisco, CA', category: 'HVAC Contractor', status: 'replied' },
    { id: 'demo-hl-4', business_name: 'Green Valley Landscaping', email: 'sales@greenvalley.com', city: 'Portland, OR', category: 'Landscaping', status: 'warm' },
    { id: 'demo-hl-5', business_name: 'Apex Roofing Co', email: 'contact@apexroofing.com', phone: '(214) 555-0482', city: 'Dallas, TX', category: 'Roofing', status: 'hot' },
  ];

  const demoReplies: Reply[] = [
    { subject: 'Re: Quick question about your services', body: 'Hi! Yes, we\'d love to learn more about what you offer. Can we schedule a call this week?', classification: 'interested', received_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { subject: 'Re: Partnership opportunity', body: 'Thanks for reaching out. We\'re currently evaluating new vendors — could you send over a proposal?', classification: 'question', received_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() },
  ];

  useEffect(() => {
    if (isDemoMode) {
      setLeads(demoHotLeads);
      setLoading(false);
      return;
    }
    fetchHotLeads();
  }, []);

  async function fetchHotLeads() {
    if (isDemoMode) return;
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      
      if (!headers.Authorization) {
        console.warn('No auth token available');
        return;
      }

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/hot`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        setLeads(data.leads || []);
      } else {
        console.error('Failed to fetch hot leads:', response.status);
      }
    } catch (error) {
      console.error('Error fetching hot leads:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchReplies(leadId: string) {
    if (isDemoMode) {
      setReplies(demoReplies);
      return;
    }
    try {
      setLoadingReplies(true);
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${leadId}/replies`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        setReplies(data.replies || []);
      }
    } catch (error) {
      console.error('Error fetching replies:', error);
    } finally {
      setLoadingReplies(false);
    }
  }

  function getStatusBadge(lead: Lead) {
    const status = (lead.status || '').toLowerCase();

    if (status.includes('hot')) {
      return { label: t('hotLeads.badgeHot'), color: 'bg-[#1ED4A7]/10 text-[#1ED4A7]' };
    }
    if (status.includes('interested')) {
      return { label: t('hotLeads.badgeInterested'), color: 'bg-[#1ED4A7]/10 text-[#1ED4A7]' };
    }
    if (status.includes('warm')) {
      return { label: t('hotLeads.badgeWarm'), color: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400' };
    }
    if (status.includes('replied')) {
      return { label: t('hotLeads.badgeReplied'), color: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white' };
    }
    return { label: t('hotLeads.badgeLead'), color: 'bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-500' };
  }

  function getClassificationBadge(classification: string) {
    const badges: Record<string, { label: string; color: string }> = {
      interested: { label: t('hotLeads.classInterested'), color: 'bg-[#1ED4A7]/10 text-[#1ED4A7]' },
      not_interested: { label: t('hotLeads.classNotInterested'), color: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400' },
      out_of_office: { label: t('hotLeads.classOutOfOffice'), color: 'bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-500' },
      question: { label: t('hotLeads.classQuestion'), color: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white' },
      unsubscribe: { label: t('hotLeads.classUnsubscribe'), color: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400' },
    };
    return badges[classification] || { label: t('hotLeads.classUnknown'), color: 'bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-500' };
  }

  if (loading) {
    return <LoadingSpinner size="lg" text={t('common.loadingHotLeads')} center />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1 text-[var(--foreground)]">{t('hotLeads.title')}</h1>
        <p className="text-[var(--foreground-muted)] text-[14px]">
          {t('hotLeads.subtitle')}
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="bg-white dark:bg-black rounded-lg border border-zinc-200 dark:border-zinc-800 p-12 text-center">
          <Crosshair className="w-12 h-12 text-zinc-400 dark:text-zinc-600 mx-auto mb-4" />
          <h3 className="text-zinc-900 dark:text-white mb-2">{t('hotLeads.noHotLeadsYet')}</h3>
          <p className="text-zinc-600 dark:text-zinc-400 text-[14px]">
            {t('hotLeads.emptyDesc')}<br />
            {t('hotLeads.emptyAction')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Leads List */}
          <div className="space-y-3">
            {leads.map((lead) => {
              const badge = getStatusBadge(lead);
              const isSelected = selectedLead?.id === lead.id;

              return (
                <div
                  key={lead.id}
                  onClick={() => {
                    setSelectedLead(lead);
                    fetchReplies(lead.id);
                  }}
                  className={`bg-white dark:bg-black rounded-lg border p-4 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-[#1ED4A7] ring-2 ring-[#1ED4A7]/20'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="text-zinc-900 dark:text-white font-medium mb-1">
                        {toTitleCase(lead.business_name)}
                      </h3>
                      {lead.category && (
                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-2">
                          {toTitleCase(lead.category)}
                        </p>
                      )}
                    </div>
                    <span className={`inline-flex items-center px-2 py-1 rounded text-[12px] font-medium ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-[13px] text-zinc-600 dark:text-zinc-400">
                    {lead.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        <span>{lead.email}</span>
                      </div>
                    )}
                    {lead.phone && (
                      <SmartPhoneButton
                        phone={lead.phone}
                        leadName={lead.contact_name || lead.business_name}
                        businessName={lead.business_name}
                        leadId={lead.id}
                        showNumber
                        displayNumber={lead.phone}
                        iconClassName="w-4 h-4"
                        numberClassName="text-[13px] text-zinc-600 dark:text-zinc-400"
                        className="flex items-center gap-2"
                      />
                    )}
                    {lead.city && (
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        <span>{lead.city}</span>
                      </div>
                    )}
                  </div>


                </div>
              );
            })}
          </div>

          {/* Lead Details Panel */}
          <div className="bg-white dark:bg-black rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 sticky top-6 h-fit">
            {!selectedLead ? (
              <div className="text-center py-12">
                <TrendingUp className="w-12 h-12 text-zinc-400 dark:text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-600 dark:text-zinc-400 text-[14px]">
                  {t('hotLeads.selectLeadToView')}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white mb-1">
                    {selectedLead.business_name}
                  </h2>
                  {(() => {
                    const b = getStatusBadge(selectedLead);
                    return (
                      <span className={`inline-flex items-center px-2 py-1 rounded text-[12px] font-medium ${b.color}`}>
                        {b.label}
                      </span>
                    );
                  })()}
                </div>

                <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                  <h3 className="text-[14px] font-medium text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    {t('hotLeads.repliesCount', { count: replies.length })}
                  </h3>

                  {loadingReplies ? (
                    <LoadingSpinner size="md" center />
                  ) : replies.length === 0 ? (
                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400 text-center py-6">
                      {t('hotLeads.noRepliesYet')}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {replies.map((reply, index) => {
                        const badge = getClassificationBadge(reply.classification);
                        return (
                          <div key={index} className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 text-[13px]">
                            <div className="flex items-start justify-between mb-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                                {badge.label}
                              </span>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {new Date(reply.received_at).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="font-medium text-zinc-900 dark:text-white mb-1">
                              {reply.subject}
                            </p>
                            <p className="text-zinc-600 dark:text-zinc-400 line-clamp-3">
                              {reply.body}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}