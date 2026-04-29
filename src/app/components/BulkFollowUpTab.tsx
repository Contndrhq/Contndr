import { useState, useEffect, useMemo } from 'react';
import { Send, Clock, RefreshCw, CheckCircle, Search, Filter, CheckSquare, Square, Minus } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';
import { SendingLiveView, type SendingLogEntry } from './SendingLiveView';

interface EligibleEmail {
  id: string;
  campaign_id: string;
  lead_id: string;
  subject: string;
  sent_at: string;
  text_body: string;
  campaign_brand: string;
  campaign_from_email?: string;
  lead_business_name: string;
  lead_email: string;
  lead_city?: string;
  lead_address?: string;
  hours_since_sent: number;
}

export function BulkFollowUpTab() {
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [eligibleEmails, setEligibleEmails] = useState<EligibleEmail[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [bounceCount, setBounceCount] = useState(0);

  // Live sending view state
  const [sendingLog, setSendingLog] = useState<SendingLogEntry[]>([]);
  const [currentSendingEntry, setCurrentSendingEntry] = useState<SendingLogEntry | null>(null);
  const [sendingComplete, setSendingComplete] = useState(false);

  // Filtering & Selection
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'ready'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadEligibleEmails();
    setSelectedIds(new Set());
  }, [selectedBrand]);

  useEffect(() => {
    async function loadBrands() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const { data: brandData } = await supabase
        .from('campaigns')
        .select('brand')
        .eq('user_id', session.user.id);
      
      const brandsSet = new Set<string>();
      if (brandData) {
        brandData.forEach(c => {
          if (c.brand) {
            const b = c.brand.toLowerCase();
            // Normalize legacy sendlr → contndr
            brandsSet.add(b === 'sendlr' ? 'contndr' : b);
          }
        });
      }
      setAvailableBrands(Array.from(brandsSet).sort());
    }
    loadBrands();
  }, []);

  async function loadEligibleEmails() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/eligible-for-followup?brand=${selectedBrand}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to load eligible emails');
      }

      const data = await response.json();
      console.log('Follow-up emails loaded:', data.emails); // Debug log
      setEligibleEmails(data.emails || []);
    } catch (error) {
      console.error('Error loading eligible emails:', error);
    } finally {
      setLoading(false);
    }
  }

  // Filter and sort emails based on search and status
  const filteredEmails = useMemo(() => {
    return eligibleEmails
      .filter(email => {
        // Search filter
        const query = searchQuery.toLowerCase();
        const matchesSearch = 
          email.lead_business_name.toLowerCase().includes(query) ||
          email.lead_email.toLowerCase().includes(query) ||
          (email.lead_city && email.lead_city.toLowerCase().includes(query)) ||
          (email.lead_address && email.lead_address.toLowerCase().includes(query));
        
        if (!matchesSearch) return false;

        // Status filter
        if (filterStatus === 'ready') {
          return email.hours_since_sent >= 24;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by readiness (ready first)
        const aReady = a.hours_since_sent >= 24;
        const bReady = b.hours_since_sent >= 24;
        
        if (aReady && !bReady) return -1;
        if (!aReady && bReady) return 1;
        
        // Then sort by hours descending (oldest sent first)
        return b.hours_since_sent - a.hours_since_sent;
      });
  }, [eligibleEmails, searchQuery, filterStatus]);

  // Selection Logic
  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEmails.length && filteredEmails.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEmails.map(e => e.id)));
    }
  };

  const selectBulk = (count: number) => {
    const idsToSelect = filteredEmails.slice(0, count).map(e => e.id);
    setSelectedIds(new Set(idsToSelect));
  };

  const isAllSelected = filteredEmails.length > 0 && selectedIds.size === filteredEmails.length;
  const isPartiallySelected = selectedIds.size > 0 && selectedIds.size < filteredEmails.length;

  async function sendBulkFollowUps() {
    const emailsToSend = eligibleEmails.filter(e => selectedIds.has(e.id) && e.hours_since_sent >= 24);
    
    if (emailsToSend.length === 0) {
      alert('No selected emails are ready to send. Emails must be sent at least 24 hours ago.');
      return;
    }

    const confirmed = confirm(
      `Send follow-ups to ${emailsToSend.length} leads?\n\nThis will use the same follow-up generation as individual emails.`
    );
    if (!confirmed) return;

    setSending(true);
    setSendingComplete(false);
    setProgress(0);
    setTotal(emailsToSend.length);
    setSuccessCount(0);
    setErrorCount(0);
    setBounceCount(0);
    setSendingLog([]);
    setCurrentSendingEntry(null);

    let localSuccess = 0;
    let localError = 0;
    let localBounce = 0;

    try {
      const headers = await getAuthHeaders();

      for (let idx = 0; idx < emailsToSend.length; idx++) {
        const email = emailsToSend[idx];

        // ── Phase 1: "composing" — shown while we fetch lead/campaign/generate ──
        const baseEntry: SendingLogEntry = {
          id: email.id,
          recipientName: email.lead_business_name,
          recipientEmail: email.lead_email,
          subject: '',
          body: '',
          fromEmail: '',
          status: 'composing',
          timestamp: Date.now(),
        };
        setCurrentSendingEntry({ ...baseEntry });

        try {
          // Fetch lead + campaign in parallel
          const [leadRes, campaignRes] = await Promise.all([
            fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${email.lead_id}`, { headers }),
            fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${email.campaign_id}`, { headers }),
          ]);
          if (!leadRes.ok) throw new Error('Failed to fetch lead data');
          if (!campaignRes.ok) throw new Error('Failed to fetch campaign data');
          const [leadData, campaignData] = await Promise.all([leadRes.json(), campaignRes.json()]);

          // Generate follow-up
          const generateRes = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/generate-followup-from-email`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                originalEmail: { subject: email.subject, body: email.text_body, sentAt: email.sent_at },
                lead: leadData,
                campaign: campaignData,
              }),
            }
          );
          if (!generateRes.ok) throw new Error('Failed to generate follow-up');
          const followUpData = await generateRes.json();

          // Resolve from_email
          let fromEmail = email.campaign_from_email;
          const { data: { session: sess } } = await supabase.auth.getSession();
          const userEmail = sess?.user?.email?.toLowerCase() || '';
          const isAdmin = userEmail === 'or@roadr.com' || userEmail === 'admin@contndr.com';

          if (isAdmin && (fromEmail === 'sales@roadr.com' || fromEmail === 'or@sourcr.net' || fromEmail === 'partner@roadr.com')) {
            fromEmail = 'sales@contndr.com';
          }
          if (!fromEmail) {
            if (isAdmin) {
              const brand = (email.campaign_brand || '').toLowerCase();
              fromEmail = brand === 'covera' ? 'or@covera.co' : 'sales@contndr.com';
            } else {
              fromEmail = userEmail || '';
            }
          }

          // ── Phase 2: "writing" — real content arrives, typewriter begins ──
          const contentEntry: SendingLogEntry = {
            ...baseEntry,
            subject: followUpData.subject || '(no subject)',
            body: followUpData.body || '',
            fromEmail: fromEmail || '',
            status: 'writing',
          };
          setCurrentSendingEntry({ ...contentEntry });

          // Give the typewriter time to type: ~5ms per body char, min 2s, max 6s
          const bodyLen = (followUpData.body || '').length;
          const typingWait = Math.min(Math.max(bodyLen * 5, 2000), 6000);
          await new Promise(r => setTimeout(r, typingWait));

          // ── Phase 3: "sending" — brief indicator while API sends ──
          setCurrentSendingEntry({ ...contentEntry, status: 'sending' });

          const sendRes = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/send`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                campaign_id: email.campaign_id,
                lead_id: email.lead_id,
                to_email: email.lead_email,
                from_email: fromEmail,
                subject: followUpData.subject,
                text_body: followUpData.body,
                html_body: followUpData.body.replace(/\n/g, '<br>'),
                sequence_number: 1,
              }),
            }
          );

          if (sendRes.ok) {
            localSuccess++;
            setSuccessCount(localSuccess);

            // ── Phase 4: "delivered" — show checkmark on the email for a beat ──
            setCurrentSendingEntry({ ...contentEntry, status: 'delivered' });
            await new Promise(r => setTimeout(r, 1200));

            // Move to completed log
            setSendingLog(prev => [...prev, { ...contentEntry, status: 'delivered', timestamp: Date.now() }]);
            setEligibleEmails(prev => prev.filter(e => e.id !== email.id));
            setSelectedIds(prev => { const n = new Set(prev); n.delete(email.id); return n; });
          } else {
            const sendJson = await sendRes.json().catch(() => ({}));
            const isBounced = sendJson.bounced || (sendJson.error && /bounce/i.test(sendJson.error));
            if (isBounced) {
              localBounce++;
              setBounceCount(localBounce);
              setSendingLog(prev => [...prev, { ...contentEntry, status: 'bounced', timestamp: Date.now() }]);
            } else {
              localError++;
              setErrorCount(localError);
              setSendingLog(prev => [...prev, { ...contentEntry, status: 'failed', timestamp: Date.now() }]);
            }
          }
        } catch (error) {
          localError++;
          setErrorCount(localError);
          setSendingLog(prev => [...prev, { ...baseEntry, status: 'failed', timestamp: Date.now() }]);
          console.error(`Error sending follow-up to ${email.lead_email}:`, error);
        } finally {
          setProgress(idx + 1);
        }

        // Brief pause before next email
        if (idx < emailsToSend.length - 1) {
          await new Promise(r => setTimeout(r, 600));
        }
      }

      setCurrentSendingEntry(null);
      setSendingComplete(true);
    } catch (error) {
      console.error('Error in bulk follow-up:', error);
    }
  }

  function dismissSendingView() {
    setSending(false);
    setSendingComplete(false);
    setProgress(0);
    setTotal(0);
    setSuccessCount(0);
    setErrorCount(0);
    setBounceCount(0);
    setSendingLog([]);
    setCurrentSendingEntry(null);
  }

  // Count ready emails within selection
  const selectedReadyCount = Array.from(selectedIds).filter(id => {
    const email = eligibleEmails.find(e => e.id === id);
    return email && email.hours_since_sent >= 24;
  }).length;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
      {/* Header & Brand Selection — hidden during sending */}
      {!sending && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Follow-Up Queue</h3>
              <p className="text-xs text-zinc-500 mt-1">
                {eligibleEmails.length} pending follow-ups
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto w-full sm:w-auto">
              <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1.5 rounded-2xl flex-1 sm:flex-none overflow-x-auto border border-zinc-200 dark:border-zinc-800">
                <button
                   onClick={() => setSelectedBrand('all')}
                   disabled={sending}
                   className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all capitalize whitespace-nowrap ${
                     selectedBrand === 'all'
                       ? 'bg-white dark:bg-[#050505] text-black dark:text-white shadow-md transform scale-[1.02]'
                       : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-zinc-800/50'
                   }`}
                >
                  All Brands
                </button>
                {availableBrands.map((brand) => (
                  <button
                    key={brand}
                    onClick={() => setSelectedBrand(brand)}
                    disabled={sending}
                    className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all capitalize whitespace-nowrap ${
                      selectedBrand === brand
                        ? 'bg-white dark:bg-[#050505] text-black dark:text-white shadow-md transform scale-[1.02]'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    {brand}
                  </button>
                ))}
              </div>
              <button
                onClick={loadEligibleEmails}
                disabled={loading}
                className="p-3 text-zinc-500 hover:text-black dark:hover:text-white transition-colors disabled:opacity-50 flex-shrink-0 bg-zinc-100 dark:bg-zinc-900 rounded-xl"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Search by business, email, or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-500 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/50 focus:border-[#1ED4A7] transition-all"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterStatus(filterStatus === 'all' ? 'ready' : 'all')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap ${
                  filterStatus === 'ready'
                    ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/20 text-[#1ED4A7]'
                    : 'bg-white dark:bg-black border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                <Filter className="w-4 h-4" />
                <span>Ready Only</span>
              </button>
            </div>
          </div>
          
          {/* Selection Header */}
          {filteredEmails.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 pt-1">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
              >
                {isAllSelected ? (
                  <CheckSquare className="w-4 h-4" />
                ) : isPartiallySelected ? (
                  <Minus className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {selectedIds.size === 0 ? 'Select All' : `${selectedIds.size} Selected`}
              </button>

              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="hidden sm:inline">Bulk Select:</span>
                <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5">
                  {[50, 100, 200].map(count => (
                    <button
                      key={count}
                      onClick={() => selectBulk(count)}
                      className="px-2.5 py-1 rounded-md hover:bg-white dark:hover:bg-zinc-800 hover:shadow-sm hover:text-black dark:hover:text-white transition-all text-zinc-600 dark:text-zinc-400"
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* List Content — replaced by SendingLiveView during sending */}
      {sending ? (
        <div className="flex-1 overflow-hidden bg-white dark:bg-[#0a0a0a]">
          <SendingLiveView
            log={sendingLog}
            currentEntry={currentSendingEntry}
            progress={progress}
            total={total}
            successCount={successCount}
            errorCount={errorCount}
            bounceCount={bounceCount}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-50 dark:bg-black p-4">
          {loading ? (
            <LoadingSpinner center size="md" />
          ) : filteredEmails.length > 0 ? (
            <div className="space-y-2">
              {filteredEmails.map((email) => {
                const isSelected = selectedIds.has(email.id);
                const isReady = email.hours_since_sent >= 24;

                return (
                  <div
                    key={email.id}
                    onClick={() => toggleSelection(email.id)}
                    className={`flex items-center gap-3 p-4 bg-white dark:bg-[#050505] rounded-lg border transition-all cursor-pointer ${
                      isSelected 
                        ? 'border-[#1ED4A7] shadow-sm bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/5' 
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className={`flex-shrink-0 text-zinc-300 dark:text-zinc-600 ${isSelected ? 'text-[#1ED4A7] dark:text-[#1ED4A7]' : ''}`}>
                      {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-zinc-900 dark:text-white truncate mb-0.5 flex items-center gap-2">
                        <span>{email.lead_business_name}</span>
                        {(email.lead_city || email.lead_address) && (
                          <span className="text-xs font-normal text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded px-1.5 py-0.5 max-w-[150px] truncate">
                            {email.lead_city || email.lead_address}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">
                        {email.lead_email}
                      </div>
                    </div>
                    
                    <div className="ml-4 flex items-center gap-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500 whitespace-nowrap">
                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{Math.round(email.hours_since_sent)}h ago</span>
                      </div>
                      {isReady && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#1ED4A7]/10 text-[#1ED4A7] whitespace-nowrap">
                          <CheckCircle className="w-3 h-3 flex-shrink-0" />
                          Ready
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-6 h-6 text-zinc-400" />
              </div>
              <p className="text-sm font-medium text-zinc-900 dark:text-white">No emails found</p>
              <p className="text-xs text-zinc-500 mt-1">Try adjusting your filters or search query</p>
            </div>
          )}
        </div>
      )}

      {/* Footer / Send Button */}
      <div className={`p-3 sm:p-4 border-t ${sending || sendingComplete ? 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a]' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black'}`}>
        {sendingComplete ? (
          <button
            onClick={dismissSendingView}
            className="w-full px-4 py-3 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            Done — {successCount} delivered{errorCount > 0 ? `, ${errorCount} failed` : ''}{bounceCount > 0 ? `, ${bounceCount} bounced` : ''}
          </button>
        ) : sending ? (
          <div className="flex items-center justify-center gap-2 py-2.5 text-xs text-zinc-400 dark:text-zinc-500">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-white/40 animate-pulse" />
            <span>Do not close this window</span>
          </div>
        ) : (
          <button
            onClick={sendBulkFollowUps}
            disabled={selectedReadyCount === 0}
            className="w-full px-4 py-3 bg-black dark:bg-white text-white dark:text-black rounded-lg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <Send className="w-4 h-4" />
            {selectedReadyCount === 0 
              ? 'Select Ready Emails to Send' 
              : `Send ${selectedReadyCount} Selected Follow-Up${selectedReadyCount !== 1 ? 's' : ''}`
            }
          </button>
        )}
      </div>
    </div>
  );
}