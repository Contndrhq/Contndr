import { useState, useEffect } from 'react';
import { Search, Send, Sparkles, TrendingUp, Target, Mail, Trash2, CheckCircle2, XCircle, AlertCircle, Loader2, Eye, ChevronRight, Filter, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { toTitleCase } from '../utils/title-case';
import { ProgressIndicator, ProgressStep } from './ProgressIndicator';

interface Lead {
  id: string;
  business_name: string;
  email: string;
  phone?: string;
  city?: string;
  category?: string;
  website?: string;
  bounced?: boolean; // Whether the email has bounced (invalid)
}

interface AnalyzedLead extends Lead {
  analysis?: {
    hasChatWidget: boolean;
    hasContactForm: boolean;
    businessType: string;
    painPoints: string[];
    estimatedValue: string;
    hook: string;
    pain: string;
    solution: string;
  };
  subject?: string;
  body?: string;
  status: 'pending' | 'analyzing' | 'ready' | 'error';
  error?: string;
}

export function FastMoneyTargets() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [analyzedLeads, setAnalyzedLeads] = useState<AnalyzedLead[]>([]);
  const [savedAnalyzedLeads, setSavedAnalyzedLeads] = useState<AnalyzedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [currentStep, setCurrentStep] = useState<'select' | 'analyze' | 'review'>('select');
  const [senderEmail, setSenderEmail] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'new' | 'ready'>('new');
  const [hideContacted, setHideContacted] = useState(false);
  const [contactedLeadIds, setContactedLeadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchLeads();
    loadAnalyzedLeads();
    loadContactedLeads();
  }, []);

  async function fetchLeads() {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLeads([]);
        setLoading(false);
        return;
      }

      // Fetch ALL leads with emails in batches (Supabase has 1000 row limit)
      let allLeads: any[] = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;
      
      console.log(`[FAST MONEY] Fetching leads in batches of ${batchSize}...`);
      
      while (hasMore) {
        const { data: batch, error: batchError } = await supabase
          .from('leads')
          .select('*')
          .eq('user_id', session.user.id)
          .not('email', 'is', null)
          .neq('email', '')
          .order('created_at', { ascending: false })
          .range(offset, offset + batchSize - 1);
        
        if (batchError) throw batchError;
        
        if (batch && batch.length > 0) {
          allLeads = allLeads.concat(batch);
          console.log(`[FAST MONEY] Batch ${Math.floor(offset / batchSize) + 1}: ${batch.length} leads (total: ${allLeads.length})`);
          offset += batchSize;
          hasMore = batch.length === batchSize;
        } else {
          hasMore = false;
        }
      }
      
      // Deduplicate leads by ID (just in case)
      const uniqueLeadsMap = new Map();
      allLeads.forEach(lead => {
        if (!uniqueLeadsMap.has(lead.id)) {
          uniqueLeadsMap.set(lead.id, lead);
        }
      });
      const leadsData = Array.from(uniqueLeadsMap.values());
      console.log(`[FAST MONEY] Loaded ${leadsData.length} unique leads (from ${allLeads.length} total)`);
      
      const validLeads = (leadsData || []).filter((lead: Lead) => {
        if (!lead.email) return false;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(lead.email)) return false;
        
        const invalidPatterns = ['info@url', 'contact@url', '@example.com', '@test.com', 'noreply@', 'no-reply@'];
        const emailLower = lead.email.toLowerCase();
        if (invalidPatterns.some(pattern => emailLower.includes(pattern))) return false;
        return true;
      });
      
      setLeads(validLeads);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadAnalyzedLeads() {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) {
        setSavedAnalyzedLeads([]);
        setLoading(false);
        return;
      }

      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agent/analyzed-leads`,
        { method: 'GET', headers }
      );

      if (response.ok) {
        const data = await response.json();
        setSavedAnalyzedLeads(data.leads || []);
      }
    } catch (error) {
      console.error('Error fetching analyzed leads:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadContactedLeads() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // First get user's campaign IDs, then get campaign_leads for those campaigns
      const { data: userCampaigns } = await supabase
        .from('campaigns')
        .select('id')
        .eq('user_id', session.user.id);
      
      if (!userCampaigns || userCampaigns.length === 0) {
        setContactedLeadIds(new Set());
        return;
      }

      const campaignIds = userCampaigns.map(c => c.id);

      // Fetch campaign_leads in batches, scoped to user's campaigns
      let allLeads: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: campaignLeadsData, error } = await supabase
          .from('campaign_leads')
          .select('lead_id')
          .in('campaign_id', campaignIds)
          .range(from, from + batchSize - 1);
        
        if (error) {
          console.error('Error loading contacted leads:', error);
          return;
        }

        if (campaignLeadsData && campaignLeadsData.length > 0) {
          allLeads = allLeads.concat(campaignLeadsData);
          from += batchSize;
          hasMore = campaignLeadsData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      const contactedIds = new Set(allLeads.map((cl: any) => cl.lead_id));
      setContactedLeadIds(contactedIds);
    } catch (error) {
      console.error('Error loading contacted leads:', error);
    }
  }

  async function saveAnalyzedLead(lead: AnalyzedLead) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) return;

      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agent/save-analyzed`,
        { method: 'POST', headers, body: JSON.stringify({ lead }) }
      );
    } catch (error) {
      console.error('Error saving analyzed lead:', error);
    }
  }

  async function deleteAnalyzedLead(leadId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) return;

      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agent/analyzed-lead/${leadId}`,
        { method: 'DELETE', headers }
      );
      setSavedAnalyzedLeads(prev => prev.filter(l => l.id !== leadId));
    } catch (error) {
      console.error('Error deleting analyzed lead:', error);
    }
  }

  function toggleLeadSelection(leadId: string) {
    const newSelection = new Set(selectedLeads);
    if (newSelection.has(leadId)) {
      newSelection.delete(leadId);
    } else {
      if (newSelection.size < 50) newSelection.add(leadId);
    }
    setSelectedLeads(newSelection);
  }

  async function analyzeSelectedLeads() {
    if (selectedLeads.size === 0) return;

    setAnalyzing(true);
    setCurrentStep('analyze');

    const leadsToAnalyze = leads.filter(lead => selectedLeads.has(lead.id));
    const initialAnalyzed: AnalyzedLead[] = leadsToAnalyze.map(lead => ({
      ...lead,
      status: 'pending' as const,
    }));
    setAnalyzedLeads(initialAnalyzed);

    const headers = await getAuthHeaders();

    for (let i = 0; i < leadsToAnalyze.length; i++) {
      const lead = leadsToAnalyze[i];
      setAnalyzedLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: 'analyzing' as const } : l));

      try {
        const analysisResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agent/analyze`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              websiteUrl: lead.website,
              businessName: lead.business_name,
              city: lead.city,
              category: lead.category,
            }),
          }
        );

        if (!analysisResponse.ok) throw new Error('Analysis failed');
        const analysisData = await analysisResponse.json();

        const senderName = senderEmail ? senderEmail.split('@')[0] : 'Sales Team';

        const emailResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agent/generate-email`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              analysis: analysisData.analysis,
              businessName: lead.business_name,
              senderName: senderName,
            }),
          }
        );

        if (!emailResponse.ok) throw new Error('Email generation failed');
        const emailData = await emailResponse.json();

        setAnalyzedLeads(prev => prev.map(l =>
          l.id === lead.id
            ? {
                ...l,
                analysis: analysisData.analysis,
                subject: emailData.subject,
                body: emailData.body,
                status: 'ready' as const,
              }
            : l
        ));

        saveAnalyzedLead({
          ...lead,
          analysis: analysisData.analysis,
          subject: emailData.subject,
          body: emailData.body,
          status: 'ready' as const,
        });

        if (i < leadsToAnalyze.length - 1) await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Error analyzing lead ${lead.id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to analyze';
        setAnalyzedLeads(prev => prev.map(l =>
          l.id === lead.id ? { ...l, status: 'error' as const, error: errorMessage } : l
        ));
      }
    }

    setAnalyzing(false);
    setCurrentStep('review');
  }

  async function sendFastMoneyCampaign() {
    const readyLeads = analyzedLeads.filter(l => l.status === 'ready' && !l.bounced);
    if (readyLeads.length === 0) {
      alert('No leads ready to send');
      return;
    }

    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        alert('Please log in to send campaigns');
        setSending(false);
        return;
      }

      const campaignData = {
        name: `Fast Money AI - ${new Date().toLocaleDateString()}`,
        product: 'ai_agent_outreach',
        from_email: senderEmail,
        sender_name: senderEmail ? senderEmail.split('@')[0] : 'Sales Team',
        sender_title: 'Business Development',
        status: 'draft',
      };

      const campaignResponse = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(campaignData),
        }
      );

      if (!campaignResponse.ok) throw new Error('Failed to create campaign');
      const campaignResponseData = await campaignResponse.json();
      const campaignId = campaignResponseData.campaign.id;

      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/leads`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead_ids: readyLeads.map(l => l.id) }),
        }
      );

      const authHeaders = await getAuthHeaders();
      for (const lead of readyLeads) {
        await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/store-personalized-email`,
          {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              campaignId,
              leadId: lead.id,
              subject: lead.subject,
              body: lead.body,
            }),
          }
        );
      }

      const sendResponse = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/send-batch`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        }
      );

      if (!sendResponse.ok) throw new Error('Failed to send campaign');

      const deletionPromises = readyLeads.map(async (lead) => {
        try {
          await deleteAnalyzedLead(lead.id);
        } catch (error) {
          console.error(`Failed to delete ${lead.business_name}:`, error);
        }
      });
      
      await Promise.all(deletionPromises);
      
      alert(`Success! ${readyLeads.length} personalized emails sent.`);
      setCurrentStep('select');
      setSelectedLeads(new Set());
      setAnalyzedLeads([]);
      await loadAnalyzedLeads();
      await loadContactedLeads();
      setActiveTab('ready');

    } catch (error) {
      console.error('Error creating campaign:', error);
      alert('Failed to create campaign');
    } finally {
      setSending(false);
    }
  }

  const stats = {
    dailySends: selectedLeads.size > 0 ? Math.min(selectedLeads.size, 120) : 120,
    responseRate: 5,
    qualifiedRate: 20,
    closeRate: 25,
  };

  const projectedMeetings = Math.round((stats.dailySends * (stats.responseRate / 100) * (stats.qualifiedRate / 100)));
  const clientsPerMonth = Math.round((projectedMeetings * 30 * (stats.closeRate / 100)) / 2);
  const monthlyRevenue = clientsPerMonth * 299;

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = searchTerm === '' || 
      lead.business_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.city?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || toTitleCase(lead.category) === categoryFilter;
    const notContacted = !hideContacted || !contactedLeadIds.has(lead.id);
    return matchesSearch && matchesCategory && notContacted;
  });

  const filteredAnalyzedLeads = savedAnalyzedLeads.filter(lead => {
    return !hideContacted || !contactedLeadIds.has(lead.id);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Fast Money Targets</h1>
        <p className="text-sm text-[var(--foreground-muted)]">
          AI-powered personalization for Sourcr's $299/mo AI Agent
        </p>
      </div>

      {sending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-8 shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md mx-4">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-black dark:text-white" />
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Sending Campaign...</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Personalizing and sending emails</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revenue Projection */}
      <div className="bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-black dark:text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Revenue Projection</h2>
            <p className="text-xs text-[var(--foreground-muted)]">Based on 120 daily sends</p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Response Rate', value: `${stats.responseRate}%`, sub: `${Math.round(stats.dailySends * (stats.responseRate / 100))} replies/day` },
            { label: 'Meetings/Day', value: projectedMeetings, sub: 'High-intent calls' },
            { label: 'Clients/Month', value: clientsPerMonth, sub: '@25% close rate' },
            { label: 'Monthly Revenue', value: `$${monthlyRevenue.toLocaleString()}`, sub: `$${(monthlyRevenue * 12).toLocaleString()} ARR` }
          ].map((stat, idx) => (
            <div key={idx} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-100 dark:border-gray-800">
              <p className="text-xs text-[var(--foreground-muted)] mb-1">{stat.label}</p>
              <p className="text-xl font-semibold text-[var(--foreground)]">{stat.value}</p>
              <p className="text-xs text-[var(--foreground-muted)] mt-1">{stat.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="flex items-center justify-center gap-4 py-2">
        {['Select Leads', 'AI Analysis', 'Review & Send'].map((step, idx) => {
          const stepKey = ['select', 'analyze', 'review'][idx];
          const isActive = currentStep === stepKey;
          return (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 ${isActive ? 'text-black dark:text-white' : 'text-gray-400'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${isActive ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  {idx + 1}
                </div>
                <span className="text-sm font-medium">{step}</span>
              </div>
              {idx < 2 && <ChevronRight className="w-4 h-4 text-gray-300" />}
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      {currentStep === 'select' && (
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setActiveTab('new')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'new' ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'
            }`}
          >
            New Leads ({filteredLeads.length})
          </button>
          <button
            onClick={() => setActiveTab('ready')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'ready' ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'
            }`}
          >
            Ready to Send ({filteredAnalyzedLeads.length})
          </button>
        </div>
      )}

      {currentStep === 'select' && activeTab === 'new' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search leads..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white/20"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm"
            >
              <option value="all">All Categories</option>
              {Array.from(new Set(leads.map(l => toTitleCase(l.category)).filter(Boolean))).sort().map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0 z-10">
                  <tr>
                    <th className="p-4 w-10">
                      <input type="checkbox" className="rounded border-gray-300 dark:border-zinc-600 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900" />
                    </th>
                    <th className="p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Business</th>
                    <th className="p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                    <th className="p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredLeads.slice(0, 100).map((lead) => (
                    <tr key={lead.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                      <td className="p-4">
                        <input
                          type="checkbox"
                          checked={selectedLeads.has(lead.id)}
                          onChange={() => toggleLeadSelection(lead.id)}
                          className="rounded border-gray-300 dark:border-zinc-600 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                        />
                      </td>
                      <td className="p-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{toTitleCase(lead.business_name)}</div>
                        <div className="text-xs text-gray-500">{lead.website}</div>
                      </td>
                      <td className="p-4 text-sm text-gray-600 dark:text-gray-400">{lead.city || '-'}</td>
                      <td className="p-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                          {toTitleCase(lead.category) || 'Uncategorized'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end p-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-black sticky bottom-0">
            <button
              onClick={analyzeSelectedLeads}
              disabled={selectedLeads.size === 0}
              className="px-6 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              Analyze {selectedLeads.size} Leads
            </button>
          </div>
        </div>
      )}
    </div>
  );
}