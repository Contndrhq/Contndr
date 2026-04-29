import { useEffect, useState, useRef } from 'react';
import { Mail, Send, Eye, MousePointerClick, XCircle, Clock, Reply, Download, Phone, Globe, User, MapPin, Building2, Filter, ChevronRight, X, Trash2, RefreshCw, Search, Inbox } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import i18n from '../lib/i18n';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { exportEmails } from '../lib/csvExport';
import { LoadingSpinner } from './LoadingSpinner';
import { IconButton } from './ui/icon-button';
import { LeadAvatar } from './LeadAvatar';

interface Email {
  id: string;
  campaign_id: string;
  lead_id: string;
  subject: string;
  preview: string;
  text_body: string;
  html_body: string;
  status: string;
  sent_at: string;
  created_at: string;
  sequence_number?: number;
  direction?: string;
  body?: string;
  opened_at?: string;
  clicked_at?: string;
  campaigns?: {
    brand: string;
  };
  leads?: {
    contact_name?: string;
    email?: string;
    person_linkedin_url?: string;
    business_name?: string;
  };
}

export function EmailsView() {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [brandFilter, setBrandFilter] = useState<'all' | 'Contndr' | 'Roadr' | 'Sourcr' | 'Covera'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [followUpGenerating, setFollowUpGenerating] = useState(false);
  const [followUpPreview, setFollowUpPreview] = useState<{ subject: string; body: string } | null>(null);
  const [followUpSending, setFollowUpSending] = useState(false);
  const [leadData, setLeadData] = useState<any>(null);
  const [campaignData, setCampaignData] = useState<any>(null);
  const [previewLeadData, setPreviewLeadData] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userSignature, setUserSignature] = useState<string | null>(null);

  // --- Gmail/Outlook inbox sync ---
  const [syncResult, setSyncResult] = useState<{ newReplies: number; bouncesDetected: number; provider: string } | null>(null);
  const hasSyncedRef = useRef(false);

  // Auto-sync on mount (once per session)
  useEffect(() => {
    if (!userId || hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    // Fire-and-forget background sync (don't block UI)
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/sync/inbox`,
          { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.newReplies > 0 || data.bouncesDetected > 0) {
            setSyncResult({ newReplies: data.newReplies, bouncesDetected: data.bouncesDetected || 0, provider: data.provider });
            loadEmails(); // Refresh list to show new replies and bounces
          }
          console.log('[INBOX-SYNC] Auto-sync result:', data);
        }
      } catch (e) {
        console.error('[INBOX-SYNC] Auto-sync failed:', e);
      }
    })();
  }, [userId]);

  // FIX: handle escaped \n, Windows CRLF, and bare CR
  function formatEmailBody(body: string | undefined): string {
    if (!body) return '';
    return body
      .replace(/\\n/g, '\n')   // escaped literal \n → real newline
      .replace(/\r\n/g, '\n')  // Windows CRLF → LF
      .replace(/\r/g, '\n');   // bare CR → LF
  }

  useEffect(() => {
    // Get current user ID first
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUserId(session.user.id);
        setUserEmail(session.user.email || null);
      }
    };
    checkUser();
  }, []);

  useEffect(() => {
    if (userId) {
      loadEmails();
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    // Subscribe to real-time changes filtered by user_id
    const channel = supabase
      .channel('emails-view-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'emails',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          console.log('[INBOX] Real-time update:', payload);
          loadEmails();
        }
      )
      .subscribe();

    // Polling fallback every 2 minutes
    const pollInterval = setInterval(() => {
      loadEmails();
    }, 120000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [userId]);

  useEffect(() => {
    if (selectedEmail?.lead_id) {
      fetchPreviewLead(selectedEmail.lead_id);
    } else {
      setPreviewLeadData(null);
    }
  }, [selectedEmail]);

  async function fetchPreviewLead(leadId: string) {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${leadId}`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setPreviewLeadData(data);
      }
    } catch (error) {
      console.error('Error fetching lead preview:', error);
    }
  }

  const [emailPage, setEmailPage] = useState(0);
  const [hasMoreEmails, setHasMoreEmails] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const EMAIL_PAGE_SIZE = 200;

  async function loadEmails(reset = true) {
    if (!userId) return;

    try {
      const offset = reset ? 0 : emailPage * EMAIL_PAGE_SIZE;
      if (reset) {
        setEmailPage(0);
        setHasMoreEmails(true);
      }

      let useJoin = true;
      const selectStr = '*, campaigns(brand), leads(contact_name, email, person_linkedin_url, business_name)';
      const selectStrNoJoin = '*, campaigns(brand)';

      const fetchPage = async (sel: string) => {
        const { data, error } = await supabase
          .from('emails')
          .select(sel)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + EMAIL_PAGE_SIZE - 1);
        return { data, error };
      };

      let result = await fetchPage(selectStr);
      if (result.error && (
        (result.error as any)?.code === '57014' ||
        result.error.message?.includes('timeout') ||
        result.error.message?.includes('statement canceled')
      )) {
        console.warn('[INBOX] Join query timed out, retrying without leads join...');
        useJoin = false;
        result = await fetchPage(selectStrNoJoin);
      }

      if (result.error) throw result.error;

      const batch = result.data || [];
      if (reset) {
        setEmails(batch);
      } else {
        setEmails(prev => [...prev, ...batch]);
      }
      setHasMoreEmails(batch.length === EMAIL_PAGE_SIZE);
      setEmailPage(reset ? 1 : emailPage + 1);
      console.log(`[INBOX] Loaded ${batch.length} emails (offset=${offset})${useJoin ? '' : ' (no lead join)'}`);
    } catch (error) {
      console.error('Error loading emails:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function loadMoreEmails() {
    if (loadingMore || !hasMoreEmails) return;
    setLoadingMore(true);
    loadEmails(false);
  }

  async function loadLeadAndCampaign(leadId: string, campaignId: string, emailContext?: Email) {
    try {
      const headers = await getAuthHeaders();
      const leadResponse = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${leadId}`,
        { headers }
      );
      if (!leadResponse.ok) throw new Error('Failed to load lead data');
      const leadData = await leadResponse.json();

      let campaignData = null;
      if (campaignId && campaignId !== 'manual') {
        const campaignResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}`,
          { headers }
        );
        if (campaignResponse.ok) {
          campaignData = await campaignResponse.json();
        }
      }

      if (!campaignData) {
        console.warn(`Campaign ${campaignId} not found, using default context`);
        let brand = 'Custom';

        if (emailContext?.campaigns?.brand) {
          brand = emailContext.campaigns.brand;
        } else if (leadData.campaigns?.brand) {
          brand = leadData.campaigns.brand;
        } else if (emailContext?.subject?.toLowerCase().includes('covera') || emailContext?.text_body?.toLowerCase().includes('covera')) {
          brand = 'Covera';
        } else if (emailContext?.subject?.toLowerCase().includes('sourcr') || emailContext?.text_body?.toLowerCase().includes('sourcr')) {
          brand = 'Sourcr';
        }

        campaignData = {
          id: campaignId || 'manual',
          brand: brand,
          name: 'Direct Message',
          product: 'Custom Service',
          tone: 'professional',
          sender_name: '',
          sender_title: '',
          from_email: userEmail || '',
          price_summary: 'Custom pricing',
          landing_url: ''
        };

        if (userEmail === 'or@roadr.com') {
          if (brand.toLowerCase() === 'sourcr') {
            campaignData.product = 'Sourcr Recruiting';
            campaignData.from_email = 'zara@sourcr.net';
            campaignData.landing_url = 'https://sourcr.net';
          } else if (brand.toLowerCase() === 'covera') {
            campaignData.product = 'Covera AI';
            campaignData.price_summary = 'Covera Essentials $166/mo, Covera Core $333/mo';
            campaignData.from_email = 'or@covera.co';
            campaignData.landing_url = 'https://covera.co';
          } else if (brand.toLowerCase() === 'roadr') {
            campaignData.product = 'Roadr Mobile Mechanic';
            campaignData.from_email = 'sales@roadr.com';
            campaignData.landing_url = 'https://roadr.com';
          }
        }
      }

      setLeadData(leadData);
      setCampaignData(campaignData);
      return { leadData, campaignData };
    } catch (error) {
      console.error('Error loading lead/campaign:', error);
      alert(t('emailsView.loadError'));
      throw error;
    }
  }

  async function generateFollowUp(leadDataOverride?: any, campaignDataOverride?: any) {
    const lead = leadDataOverride || leadData;
    const campaign = campaignDataOverride || campaignData;

    if (!selectedEmail || !lead || !campaign) {
      alert(t('emailsView.followUpError'));
      return;
    }

    setFollowUpGenerating(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/generate-followup-from-email`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalEmail: {
              subject: selectedEmail.subject,
              body: selectedEmail.text_body || selectedEmail.body,
              sentAt: selectedEmail.sent_at || selectedEmail.created_at,
            },
            lead: lead,
            campaign: campaign,
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to generate follow-up');

      const data = await response.json();
      setFollowUpPreview({ subject: data.subject, body: data.body });
    } catch (error) {
      console.error('Error generating follow-up:', error);
      alert(t('emailsView.followUpError'));
    } finally {
      setFollowUpGenerating(false);
    }
  }

  async function sendFollowUp() {
    if (!followUpPreview || !leadData || !campaignData || !selectedEmail) return;

    setFollowUpSending(true);
    try {
      let fromEmail = campaignData.from_email || userEmail || '';

      if (userEmail === 'or@roadr.com' && !campaignData.from_email) {
        const brand = (campaignData.brand || '').toLowerCase();
        if (brand === 'sourcr') fromEmail = 'zara@sourcr.net';
        else if (brand === 'covera') fromEmail = 'or@covera.co';
        else if (brand === 'roadr') fromEmail = 'sales@roadr.com';
        else fromEmail = 'sales@roadr.com';
      }

      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/send`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: campaignData.id,
            lead_id: leadData.id,
            to_email: leadData.email,
            from_email: fromEmail,
            subject: followUpPreview.subject,
            text_body: followUpPreview.body,
            html_body: followUpPreview.body.replace(/\n/g, '<br>'),
            sequence_number: (selectedEmail.sequence_number || 1) + 1,
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to send follow-up');

      alert(t('emailsView.followUpSent'));
      setShowFollowUpModal(false);
      setFollowUpPreview(null);
      setSelectedEmail(null);
      loadEmails();
    } catch (error) {
      console.error('Error sending follow-up:', error);
      alert(t('emailsView.sendFollowUpError'));
    } finally {
      setFollowUpSending(false);
    }
  }

  function getSignature(campaign: any): string {
    if (userSignature) return '\n\n' + userSignature;
    if (!campaign) return '';

    if (userEmail === 'or@roadr.com') {
      const brand = campaign.brand?.toLowerCase() || 'roadr';
      const senderName = campaign.sender_name || 'Sales Team';
      const senderTitle = campaign.sender_title || 'Account Manager';

      if (brand === 'sourcr') {
        return `\n\nBest,\n${senderName} | ${senderTitle}\nE: ${campaign.from_email || 'zara@sourcr.net'}\nSourcer - sourcr.net`;
      } else if (brand === 'covera') {
        return `\n\nBest Regards,\nOtiniel Ribeiro | Founder\nE: or@covera.co\nW: covera.co\nP: 323-333-9600`;
      } else {
        return `\n\nBest,\n${senderName} | ${senderTitle}\nE: ${campaign.from_email || 'sales@roadr.com'}\nRoadr - roadr.com`;
      }
    }

    if (userEmail === 'admin@contndr.com' && campaign.brand?.toLowerCase() === 'contndr') {
      const senderName = campaign.sender_name || 'Contndr Team';
      const senderTitle = campaign.sender_title || 'Growth Team';
      return `\n\nBest Regards,\n${senderName} | ${senderTitle}\nE: ${campaign.from_email || 'sales@contndr.com'}\nW: contndr.com`;
    }

    const senderName = campaign.sender_name || '';
    const senderTitle = campaign.sender_title || '';
    let sig = '';
    if (senderName) {
      sig = `\n\nBest Regards,\n${senderName}${senderTitle ? ` | ${senderTitle}` : ''}`;
    }
    if (campaign.from_email) sig += `\nE: ${campaign.from_email}`;
    if (campaign.landing_url) sig += `\nW: ${campaign.landing_url.replace(/^https?:\/\//, '')}`;
    return sig;
  }

  async function handleCreateFollowUp(email: Email) {
    try {
      const { leadData, campaignData } = await loadLeadAndCampaign(email.lead_id, email.campaign_id, email);
      setShowFollowUpModal(true);
    } catch (error) {
      // Error handled in loadLeadAndCampaign
    }
  }

  function handleManualFollowUp() {
    if (!campaignData) return;
    const signature = getSignature(campaignData);
    setFollowUpPreview({
      subject: `Re: ${selectedEmail?.subject || ''}`,
      body: signature
    });
  }

  async function deleteEmail(emailId: string) {
    if (!confirm(t('emailsView.confirmDeleteEmail'))) return;
    if (!userId) return;

    try {
      const { error } = await supabase
        .from('emails')
        .delete()
        .eq('id', emailId)
        .eq('user_id', userId);

      if (error) throw error;

      setEmails(prev => prev.filter(e => e.id !== emailId));
      if (selectedEmail?.id === emailId) setSelectedEmail(null);
    } catch (error) {
      console.error('Error deleting email:', error);
      alert(t('emailsView.deleteError'));
    }
  }

  async function deleteAllEmails() {
    const targetEmails = statusFilter === 'all' ? emails : emails.filter(e => e.status === statusFilter);
    if (targetEmails.length === 0) return;
    if (!userId) return;

    if (!confirm(t('emailsView.confirmDeleteAll', { count: targetEmails.length }))) return;

    setLoading(true);
    try {
      const ids = targetEmails.map(e => e.id);
      const { error } = await supabase
        .from('emails')
        .delete()
        .in('id', ids)
        .eq('user_id', userId);

      if (error) throw error;

      setEmails(prev => prev.filter(e => !ids.includes(e.id)));
      setSelectedEmail(null);
      alert(t('emailsView.emailsDeleted'));
    } catch (error) {
      console.error('Error deleting emails:', error);
      alert(t('emailsView.deleteAllError'));
    } finally {
      setLoading(false);
    }
  }

  const getFilteredEmails = () => {
    let filtered = emails;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.subject?.toLowerCase().includes(query) ||
        e.text_body?.toLowerCase().includes(query) ||
        e.preview?.toLowerCase().includes(query) ||
        e.body?.toLowerCase().includes(query) ||
        e.leads?.contact_name?.toLowerCase().includes(query) ||
        e.leads?.business_name?.toLowerCase().includes(query) ||
        e.leads?.email?.toLowerCase().includes(query)
      );
    }

    if (brandFilter !== 'all') {
      filtered = filtered.filter(e =>
        e.campaigns?.brand?.toLowerCase() === brandFilter.toLowerCase()
      );
    }

    switch (statusFilter) {
      case 'all':
        return filtered;
      case 'sent':
        return filtered.filter(e => ['sent', 'delivered', 'opened', 'clicked', 'bounced'].includes(e.status));
      case 'delivered':
        return filtered.filter(e => ['delivered', 'opened', 'clicked'].includes(e.status));
      case 'opened':
        return filtered.filter(e => ['opened', 'clicked'].includes(e.status));
      case 'clicked':
        return filtered.filter(e => e.status === 'clicked');
      case 'replied':
        return filtered.filter(e => e.status === 'replied');
      case 'bounced':
        return filtered.filter(e => e.status === 'bounced');
      default:
        return filtered;
    }
  };

  const filteredEmails = getFilteredEmails();

  const getCountForStatus = (status: string) => {
    let base = emails;
    if (brandFilter !== 'all') {
      base = base.filter(e => e.campaigns?.brand?.toLowerCase() === brandFilter.toLowerCase());
    }

    if (status === 'all') return base.length;
    if (status === 'sent') return base.filter(e => ['sent', 'delivered', 'opened', 'clicked', 'bounced'].includes(e.status)).length;
    if (status === 'delivered') return base.filter(e => ['delivered', 'opened', 'clicked'].includes(e.status)).length;
    if (status === 'opened') return base.filter(e => ['opened', 'clicked'].includes(e.status)).length;
    if (status === 'clicked') return base.filter(e => e.status === 'clicked').length;
    if (status === 'replied') return base.filter(e => e.status === 'replied').length;
    if (status === 'bounced') return base.filter(e => e.status === 'bounced').length;
    return 0;
  };

  const statusCounts = {
    all: getCountForStatus('all'),
    sent: getCountForStatus('sent'),
    delivered: getCountForStatus('delivered'),
    opened: getCountForStatus('opened'),
    clicked: getCountForStatus('clicked'),
    replied: getCountForStatus('replied'),
    bounced: getCountForStatus('bounced'),
  };

  async function updateLeadStatus(newStatus: string) {
    if (!previewLeadData?.id || !userId) return;

    try {
      const { error } = await supabase
        .from('leads')
        .update({ status: newStatus })
        .eq('id', previewLeadData.id)
        .eq('user_id', userId);

      if (error) throw error;

      setPreviewLeadData((prev: any) => ({ ...prev, status: newStatus }));
    } catch (error) {
      console.error('Error updating lead status:', error);
      alert('Failed to update status');
    }
  }

  if (loading) {
    return <LoadingSpinner center size="lg" />;
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
      <div className="p-4 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-black space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t('emailsView.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1ED4A7]/50 focus:border-[#1ED4A7]"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 overflow-x-auto pb-1 scrollbar-hide min-w-0 flex-1">
            {/* Brand Filter */}
            {(userEmail === 'or@roadr.com' || userEmail === 'admin@contndr.com') && (
              <div className="flex gap-1 border-r border-gray-200 dark:border-gray-800 pr-4 mr-2">
                {(['all', 'Contndr', 'Roadr', 'Sourcr', 'Covera'] as const).map((brand) => (
                  <button
                    key={brand}
                    onClick={() => setBrandFilter(brand)}
                    className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                      brandFilter === brand
                        ? 'bg-gray-900 dark:bg-white text-white dark:text-black'
                        : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                    }`}
                  >
                    {brand === 'all' ? t('emailsView.all') : brand}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <FilterButton label={t('emailsView.all')} count={statusCounts.all} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
              <FilterButton label={t('emailsView.sent')} count={statusCounts.sent} active={statusFilter === 'sent'} onClick={() => setStatusFilter('sent')} />
              <FilterButton label={t('emailsView.delivered')} count={statusCounts.delivered} active={statusFilter === 'delivered'} onClick={() => setStatusFilter('delivered')} />
              <FilterButton label={t('emailsView.opened')} count={statusCounts.opened} active={statusFilter === 'opened'} onClick={() => setStatusFilter('opened')} />
              <FilterButton label={t('emailsView.clicked')} count={statusCounts.clicked} active={statusFilter === 'clicked'} onClick={() => setStatusFilter('clicked')} />
              <FilterButton label={t('emailsView.replied')} count={statusCounts.replied} active={statusFilter === 'replied'} onClick={() => setStatusFilter('replied')} />
              <FilterButton label={t('emailsView.bounced')} count={statusCounts.bounced} active={statusFilter === 'bounced'} onClick={() => setStatusFilter('bounced')} />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => loadEmails()}
              className="p-2 text-gray-500 hover:text-black dark:hover:text-white transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"
              title={t('emailsView.refreshList')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {emails.length > 0 && (
              <button
                onClick={() => exportEmails(emails)}
                className="p-2 text-gray-500 hover:text-black dark:hover:text-white transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"
                title={t('emailsView.exportCsv')}
              >
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sync notification banner */}
      {syncResult && (syncResult.newReplies > 0 || syncResult.bouncesDetected > 0) && (
        <div className="px-4 py-2 bg-[#1ED4A7]/10 border-b border-[#1ED4A7]/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-[#1ED4A7]" />
            <span className="text-sm text-[#1ED4A7] font-medium">
              {syncResult.newReplies > 0 && (
                <>{t('emailsView.newReplySynced', { count: syncResult.newReplies, provider: syncResult.provider === 'gmail' ? 'Gmail' : 'Outlook' })}</>
              )}
              {syncResult.bouncesDetected > 0 && (
                <>
                  {syncResult.newReplies > 0 && <span className="mx-1">•</span>}
                  <span className="text-zinc-400">{t('emailsView.bouncesDetected', { count: syncResult.bouncesDetected })}{syncResult.newReplies === 0 ? ` ${t('emailsView.fromProvider', { provider: syncResult.provider === 'gmail' ? 'Gmail' : 'Outlook' })}` : ''}</span>
                </>
              )}
            </span>
          </div>
          <button
            onClick={() => setSyncResult(null)}
            className="text-[#1ED4A7]/60 hover:text-[#1ED4A7]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 dark:bg-black">
        {filteredEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
              <Mail className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('emailsView.noEmails')}</p>
            <p className="text-xs text-gray-500 mt-1">{t('emailsView.noEmailsHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {filteredEmails.slice(0, emailPage * EMAIL_PAGE_SIZE || EMAIL_PAGE_SIZE).map(email => (
              <div
                key={email.id}
                onClick={() => setSelectedEmail(email)}
                className="group p-4 hover:bg-white dark:hover:bg-white/5 cursor-pointer transition-all border-l-2 border-transparent hover:border-[#1ED4A7]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <LeadAvatar
                      name={email.leads?.contact_name || email.leads?.business_name || ''}
                      email={email.leads?.email}
                      linkedinUrl={email.leads?.person_linkedin_url}
                      size={32}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={email.status} />
                        {email.leads?.contact_name && (
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[140px]">
                            {email.leads.contact_name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(email.sent_at || email.created_at).toLocaleString(i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US')}
                        </span>
                        {email.sequence_number && email.sequence_number > 1 && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                            {t('emailsView.followUpNum', { num: email.sequence_number })}
                          </span>
                        )}
                        {email.opened_at && (
                          <div className="flex items-center gap-1 text-xs text-[#1ED4A7]" title={`${t('emailsView.opened')}: ${new Date(email.opened_at).toLocaleString(i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US')}`}>
                            <Eye className="w-3 h-3" />
                          </div>
                        )}
                        {email.clicked_at && (
                          <div className="flex items-center gap-1 text-xs text-[#1ED4A7]" title={`${t('emailsView.clicked')}: ${new Date(email.clicked_at).toLocaleString(i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US')}`}>
                            <MousePointerClick className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate mb-0.5">{email.subject}</h3>
                      {/* FIX: use line-clamp-2 instead of truncate so newlines don't collapse into a wall of text */}
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 max-w-md">
                        {email.preview || (email.text_body || email.body || '').substring(0, 100)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors opacity-0 group-hover:opacity-100" />
                </div>
              </div>
            ))}
            {hasMoreEmails && (
              <div className="p-4 flex justify-center">
                <button
                  onClick={loadMoreEmails}
                  disabled={loadingMore}
                  className="px-4 py-2 text-sm font-medium text-[#1ED4A7] hover:bg-[#1ED4A7]/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loadingMore ? t('emailsView.loadingMore') : t('emailsView.loadMoreEmails')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedEmail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedEmail(null)}>
          <div className="bg-white dark:bg-black rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto border border-gray-200 dark:border-white/10 shadow-2xl animate-scale-in flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between bg-white dark:bg-black sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <StatusBadge status={selectedEmail.status} />
                <span className="text-xs text-gray-500">{new Date(selectedEmail.sent_at || selectedEmail.created_at).toLocaleString(i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US')}</span>
              </div>
              <button onClick={() => setSelectedEmail(null)} className="text-gray-400 hover:text-black dark:hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6">
              {previewLeadData && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/10">
                  <div className="flex items-center gap-4 w-full sm:w-auto">
                    <LeadAvatar
                      name={previewLeadData.contact_name || previewLeadData.business_name || ''}
                      email={previewLeadData.email}
                      linkedinUrl={previewLeadData.person_linkedin_url}
                      size={40}
                    />
                    <div className="flex-1 sm:hidden">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{previewLeadData.business_name}</h3>
                    </div>
                  </div>

                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white hidden sm:block">{previewLeadData.business_name}</h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-gray-500 mt-0.5">
                      <span>{previewLeadData.contact_name}</span>
                      <span className="hidden sm:inline">•</span>
                      <span className="truncate max-w-[200px]">{previewLeadData.email}</span>
                      {previewLeadData.phone && (
                        <>
                          <span className="hidden sm:inline">•</span>
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {previewLeadData.phone}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto mt-2 sm:mt-0">
                    <select
                      value={previewLeadData.status || 'new'}
                      onChange={(e) => updateLeadStatus(e.target.value)}
                      className="flex-1 sm:flex-none text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 bg-white dark:bg-black focus:outline-none focus:ring-1 focus:ring-black"
                    >
                      <option value="new">{t('emailsView.statusNew')}</option>
                      <option value="contacted">{t('emailsView.statusContacted')}</option>
                      <option value="replied">{t('emailsView.statusReplied')}</option>
                      <option value="Interested">{t('emailsView.statusInterested')}</option>
                      <option value="Not Interested">{t('emailsView.statusNotInterested')}</option>
                      <option value="Customer">{t('emailsView.statusCustomer')}</option>
                    </select>
                    {previewLeadData.website && (
                      <a href={previewLeadData.website} target="_blank" rel="noreferrer" className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500">
                        <Globe className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{selectedEmail.subject}</h2>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  {/* FIX: whitespace-pre-wrap preserves newlines in plain-text bodies */}
                  <div className="whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300 break-words">
                    {formatEmailBody(selectedEmail.text_body || selectedEmail.body)}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5 sticky bottom-0">
              <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
                <div className="flex gap-3 order-2 sm:order-1">
                  <button
                    onClick={() => selectedEmail && deleteEmail(selectedEmail.id)}
                    className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors sm:mr-auto"
                  >
                    {t('emailsView.deleteEmail')}
                  </button>
                  <button
                    onClick={() => setSelectedEmail(null)}
                    className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                  >
                    {t('emailsView.close')}
                  </button>
                </div>
                <button
                  onClick={() => handleCreateFollowUp(selectedEmail)}
                  className="order-1 sm:order-2 w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  <Reply className="w-4 h-4" />
                  <span>{t('emailsView.replyFollowUp')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Follow Up Modal */}
      {showFollowUpModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowFollowUpModal(false)}>
          <div className="bg-white dark:bg-black rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto border border-gray-200 dark:border-white/10 shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('emailsView.createFollowUp')}</h3>
              <button onClick={() => setShowFollowUpModal(false)} className="text-gray-400 hover:text-black dark:hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6">
              {!followUpPreview ? (
                <div className="flex flex-col items-center justify-center py-12 gap-6">
                  {followUpGenerating ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="animate-spin w-8 h-8 border-2 border-black dark:border-white border-t-transparent rounded-full" />
                      <p className="text-sm text-gray-500">{t('emailsView.generatingFollowUp')}</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-center space-y-2 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900 dark:text-white">{t('emailsView.howFollowUp')}</h4>
                        <p className="text-sm text-gray-500">{t('emailsView.chooseMethod')}</p>
                      </div>
                      <div className="flex gap-4">
                        <button
                          onClick={() => generateFollowUp()}
                          className="flex flex-col items-center gap-3 p-6 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl border border-gray-200 dark:border-white/10 transition-all w-40"
                        >
                          <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                            <RefreshCw className="w-5 h-5" />
                          </div>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{t('emailsView.aiGenerate')}</span>
                        </button>
                        <button
                          onClick={handleManualFollowUp}
                          className="flex flex-col items-center gap-3 p-6 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl border border-gray-200 dark:border-white/10 transition-all w-40"
                        >
                          <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                            <Mail className="w-5 h-5" />
                          </div>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{t('emailsView.writeManually')}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('emailsView.subject')}</label>
                    <input
                      type="text"
                      value={followUpPreview.subject}
                      onChange={(e) => setFollowUpPreview({...followUpPreview, subject: e.target.value})}
                      className="w-full px-3 py-2 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('emailsView.body')}</label>
                    <textarea
                      value={formatEmailBody(followUpPreview.body)}
                      onChange={(e) => setFollowUpPreview({...followUpPreview, body: e.target.value})}
                      className="w-full h-64 px-3 py-2 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white font-mono"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={sendFollowUp}
                      disabled={followUpSending}
                      className="flex-1 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {followUpSending ? t('emailsView.sending') : t('emailsView.sendFollowUp')}
                    </button>
                    <button
                      onClick={() => generateFollowUp()}
                      disabled={followUpGenerating}
                      className="px-4 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-white/20"
                    >
                      {t('emailsView.regenerate')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterButton({ label, count, active, onClick }: { label: string, count: number, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-gray-900 dark:bg-white text-white dark:text-black shadow-md'
          : 'bg-transparent text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
      }`}
    >
      <span>{label}</span>
      <span className={`px-1.5 py-0.5 rounded text-xs ${
        active ? 'bg-gray-700 dark:bg-gray-200 text-white dark:text-black' : 'bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-400'
      }`}>
        {count}
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    queued: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400',
    sent: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300',
    delivered: 'bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-gray-100',
    opened: 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20',
    clicked: 'bg-[#1ED4A7]/20 text-[#1ED4A7] border border-[#1ED4A7]/30 font-bold',
    replied: 'bg-[#1ED4A7] text-white border border-[#1ED4A7] shadow-[0_0_8px_rgba(30,212,167,0.4)]',
    bounced: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  };
  const style = styles[status as keyof typeof styles] || styles.queued;

  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium uppercase tracking-wide ${style}`}>
      {status}
    </span>
  );
}