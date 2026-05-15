import { useState, useEffect } from 'react';
import { Plus, Play, Pause, Trash2, Clock, MapPin, Search, Zap, XCircle, RefreshCw } from 'lucide-react';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { apiCache } from '../lib/api-cache';
import { AutomationSetup } from './AutomationSetup';
import { FollowUpManager } from './FollowUpManager';
import { HotLeadsView } from './HotLeadsView';
import { LoadingSpinner } from './LoadingSpinner';
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';

type AutomationTab = 'rules' | 'followups' | 'hot-leads';

interface AutomationRule {
  id: string;
  name: string;
  search_query: string;
  location: string;
  leads_per_run: number;
  campaign_id: string;
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
}

interface Campaign {
  id: string;
  name: string;
  brand: string;
}

export function AutomationManager() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [activeTab, setActiveTab] = useState<AutomationTab>('rules');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    search_query: '',
    location: '',
    leads_per_run: 20,
    campaign_id: '',
    frequency: 'daily' as 'daily' | 'weekly' | 'monthly',
    enabled: true,
  });
  const [searchAllUSA, setSearchAllUSA] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // ── Demo data ──
  const demoRules: AutomationRule[] = [
    {
      id: 'demo-rule-1',
      name: 'Austin Auto Shops — Daily',
      search_query: 'Auto repair shop',
      location: 'Austin, TX',
      leads_per_run: 25,
      campaign_id: 'demo-campaign-1',
      enabled: true,
      frequency: 'daily',
      last_run_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      next_run_at: new Date(Date.now() + 21 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'demo-rule-2',
      name: 'Denver Dental Clinics — Weekly',
      search_query: 'Dental clinic',
      location: 'Denver, CO',
      leads_per_run: 40,
      campaign_id: 'demo-campaign-2',
      enabled: true,
      frequency: 'weekly',
      last_run_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      next_run_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'demo-rule-3',
      name: 'Nationwide HVAC — Monthly',
      search_query: 'HVAC contractor',
      location: 'United States',
      leads_per_run: 100,
      campaign_id: 'demo-campaign-3',
      enabled: false,
      frequency: 'monthly',
      last_run_at: null,
      next_run_at: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const demoCampaigns: Campaign[] = [
    { id: 'demo-campaign-1', name: 'Spring Auto Promo', brand: 'default' },
    { id: 'demo-campaign-2', name: 'Dental Outreach Q1', brand: 'default' },
    { id: 'demo-campaign-3', name: 'HVAC National Push', brand: 'default' },
  ];

  useEffect(() => {
    if (isDemoMode) {
      setRules(demoRules);
      setCampaigns(demoCampaigns);
      setLoading(false);
      return;
    }

    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setIsAuthReady(true);
      }
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setIsAuthReady(true);
      } else {
        setIsAuthReady(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isDemoMode) return;
    if (!isAuthReady) return;

    loadRules();
    loadCampaigns();
    const interval = setInterval(() => {
      loadRules();
      loadCampaigns();
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthReady]);

  async function loadCampaigns() {
    if (isDemoMode) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCampaigns(data || []);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
  }

  async function loadRules() {
    if (isDemoMode) return;
    try {
      // Consume prefetched cache from App.tsx viewPreloadMap for instant paint
      const data = await apiCache.fetch(
        'automations:rules',
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/automation/rules`
          );
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            if (err.error?.code === 'PGRST205' || err.error?.message?.includes('automation_rules')) {
              return { rules: [], setupRequired: true };
            }
            throw new Error(`${response.status}`);
          }
          return response.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      if (data.setupRequired) {
        setSetupRequired(true);
      } else {
        setRules(data.rules || []);
        setSetupRequired(false);
      }
    } catch (error) {
      // Suppress network/auth errors
      if (error instanceof Error && (error.message.includes('Not authenticated') || error.message.includes('Network error'))) {
        return;
      }
      console.error('Error loading automation rules:', error);
    } finally {
      setLoading(false);
    }
  }

  async function createRule() {
    if (isDemoMode) {
      alert(t('automationManager.demoDisabled'));
      return;
    }
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/automation/rules`,
        {
          method: 'POST',
          body: JSON.stringify(formData),
        }
      );

      if (response.ok) {
        setShowCreateModal(false);
        setFormData({
          name: '',
          search_query: '',
          location: '',
          leads_per_run: 20,
          campaign_id: '',
          frequency: 'daily',
          enabled: true,
        });
        setSearchAllUSA(false);
        loadRules();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error || 'Failed to create automation rule'}`);
      }
    } catch (error) {
      console.error('Error creating automation rule:', error);
      alert('Failed to create automation rule');
    }
  }

  async function toggleRule(ruleId: string, enabled: boolean) {
    if (isDemoMode) {
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r));
      return;
    }
    try {
      await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/automation/rules/${ruleId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        }
      );
      loadRules();
    } catch (error) {
      console.error('Error toggling rule:', error);
    }
  }

  async function runRule(ruleId: string) {
    if (isDemoMode) {
      setProcessing(ruleId);
      setTimeout(() => {
        alert('Demo mode: Simulated run\n\nDiscovered: 25 leads\nDuplicates: 3\nImported: 22\nEmails Sent: 22');
        setProcessing(null);
      }, 1500);
      return;
    }
    setProcessing(ruleId);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/automation/rules/${ruleId}/run`,
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );

      if (response.ok) {
        const data = await response.json();
        alert(
          `Success!\n\n` +
          `Discovered: ${data.result.discovered} leads\n` +
          `Duplicates: ${data.result.duplicates || 0}\n` +
          `Imported: ${data.result.imported}\n` +
          `Emails Sent: ${data.result.sent}`
        );
        loadRules();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error || 'Failed to run automation'}`);
      }
    } catch (error) {
      console.error('Error running automation:', error);
      alert('Failed to run automation');
    } finally {
      setProcessing(null);
    }
  }

  async function deleteRule(ruleId: string) {
    if (isDemoMode) {
      setRules(prev => prev.filter(r => r.id !== ruleId));
      return;
    }
    if (!confirm(t('automationManager.deleteConfirm'))) return;

    try {
      await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/automation/rules/${ruleId}`,
        { method: 'DELETE' }
      );
      loadRules();
    } catch (error) {
      console.error('Error deleting rule:', error);
    }
  }

  function formatNextRun(nextRun: string) {
    const date = new Date(nextRun);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 24) return t('automationManager.inHours', { hours });
    const days = Math.floor(hours / 24);
    return days > 1 ? t('automationManager.inDaysPlural', { days }) : t('automationManager.inDays', { days });
  }

  return (
    <div className="h-full p-4 sm:p-6 space-y-5 sm:space-y-6 animate-fade-in overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('automationManager.title')}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t('automationManager.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-90 transition-opacity font-medium text-sm whitespace-nowrap self-start sm:self-auto shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>{t('automationManager.newAutomation')}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-zinc-100 dark:bg-zinc-950 p-1 rounded-lg w-full sm:w-fit overflow-x-auto scrollbar-hide border border-zinc-200 dark:border-zinc-800/50 backdrop-blur-sm">
        <button
          onClick={() => setActiveTab('rules')}
          className={`px-4 py-2 rounded-md text-xs sm:text-[13px] font-medium transition-all whitespace-nowrap flex-1 sm:flex-none ${
            activeTab === 'rules' ? 'bg-white dark:bg-zinc-800 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50'
          }`}
        >
          {t('automationManager.rules')}
        </button>
        <button
          onClick={() => setActiveTab('followups')}
          className={`px-4 py-2 rounded-md text-xs sm:text-[13px] font-medium transition-all whitespace-nowrap flex-1 sm:flex-none ${
            activeTab === 'followups' ? 'bg-white dark:bg-zinc-800 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50'
          }`}
        >
          {t('automationManager.autopilot')}
        </button>
        <button
          onClick={() => setActiveTab('hot-leads')}
          className={`px-4 py-2 rounded-md text-xs sm:text-[13px] font-medium transition-all whitespace-nowrap flex-1 sm:flex-none ${
            activeTab === 'hot-leads' ? 'bg-white dark:bg-zinc-800 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50'
          }`}
        >
          {t('automationManager.hotLeads')}
        </button>
      </div>

      {/* Rules List */}
      {activeTab === 'rules' && (
        <div className="space-y-4">
          {loading ? (
            <LoadingSpinner center size="md" />
          ) : setupRequired ? (
            <AutomationSetup />
          ) : rules.length === 0 ? (
            <div className="text-center py-32 bg-zinc-50 dark:bg-[#0A0A0A] border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col items-center justify-center">
              <Zap className="w-8 h-8 text-zinc-400 dark:text-zinc-600 mb-4" />
              <p className="text-zinc-500 dark:text-zinc-500 text-sm mb-6 font-medium">
                {t('automationManager.noRulesYet')}
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-5 py-2.5 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors text-sm font-semibold shadow-sm"
              >
                {t('automationManager.createFirstRule')}
              </button>
            </div>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 transition-all hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-3 flex-wrap">
                      <h3 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-white">
                        {rule.name}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide ${
                          rule.enabled
                            ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] dark:bg-[#1ED4A7]/10 dark:text-[#1ED4A7]'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {rule.enabled ? t('automationManager.active') : t('automationManager.paused')}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 text-sm text-zinc-500 dark:text-zinc-400">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span className="truncate">{rule.search_query}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span className="truncate">{rule.location}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span className="capitalize">{t(`automationManager.${rule.frequency}`)}</span>
                        <span className="text-zinc-300 dark:text-zinc-700">•</span>
                        <span>{rule.leads_per_run} {t('automationManager.leadsSlashRun')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span>{t('automationManager.nextRun')}: {formatNextRun(rule.next_run_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleRule(rule.id, !rule.enabled)}
                      className={`p-2 rounded-lg transition-colors ${
                        rule.enabled
                          ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] dark:bg-[#1ED4A7]/10 dark:text-[#1ED4A7] hover:bg-[#1ED4A7]/20 dark:hover:bg-[#1ED4A7]/20'
                          : 'bg-zinc-50 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                      }`}
                      title={rule.enabled ? t('automationManager.pause') : t('automationManager.resume')}
                    >
                      {rule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => runRule(rule.id)}
                      disabled={processing === rule.id}
                      className="p-2 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                      title={t('automationManager.runNow')}
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="p-2 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                      title={t('automationManager.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {rule.last_run_at && (
                  <div className="pt-4 mt-4 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400">
                    {t('automationManager.lastRun')}: {new Date(rule.last_run_at).toLocaleString()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'followups' && <FollowUpManager />}
      {activeTab === 'hot-leads' && <HotLeadsView />}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-zinc-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{t('automationManager.createRule')}</h2>
                <p className="text-sm text-zinc-500 mt-1">{t('automationManager.createRuleDesc')}</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-zinc-400 hover:text-black dark:hover:text-white"><XCircle className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t('automationManager.ruleName')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('automationManager.ruleNamePlaceholder')}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t('automationManager.searchQuery')}</label>
                  <input
                    type="text"
                    value={formData.search_query}
                    onChange={(e) => setFormData({ ...formData, search_query: e.target.value })}
                    placeholder={t('automationManager.searchQueryPlaceholder')}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t('automationManager.location')}</label>
                  <input
                    type="text"
                    value={formData.location}
                    disabled={searchAllUSA}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder={searchAllUSA ? "United States (Entire Country)" : t('automationManager.locationPlaceholder')}
                    className={`w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700 ${searchAllUSA ? 'opacity-50' : ''}`}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      id="searchAllUSA-automation"
                      checked={searchAllUSA}
                      onChange={(e) => {
                        setSearchAllUSA(e.target.checked);
                        if (e.target.checked) setFormData(prev => ({ ...prev, location: 'United States' }));
                        else setFormData(prev => ({ ...prev, location: '' }));
                      }}
                      className="rounded border-zinc-300 dark:border-zinc-600 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900"
                    />
                    <label htmlFor="searchAllUSA-automation" className="text-xs text-zinc-500 cursor-pointer select-none">{t('automationManager.searchEntireUS')}</label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t('automationManager.leadsPerRun')}</label>
                  <input
                    type="number"
                    value={formData.leads_per_run}
                    onChange={(e) => setFormData({ ...formData, leads_per_run: parseInt(e.target.value) })}
                    min={1}
                    max={100}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t('automationManager.frequency')}</label>
                  <select
                    value={formData.frequency}
                    onChange={(e) => setFormData({ ...formData, frequency: e.target.value as any })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700"
                  >
                    <option value="daily">{t('automationManager.daily')}</option>
                    <option value="weekly">{t('automationManager.weekly')}</option>
                    <option value="monthly">{t('automationManager.monthly')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t('automationManager.campaign')}</label>
                <select
                  value={formData.campaign_id}
                  onChange={(e) => setFormData({ ...formData, campaign_id: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700"
                >
                  <option value="">{t('automationManager.selectCampaign')}</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.brand})</option>
                  ))}
                </select>
              </div>

              <div className="p-4 bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/5 rounded-lg">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-[#1ED4A7] mt-0.5" />
                  <p className="text-sm text-zinc-900 dark:text-white" dangerouslySetInnerHTML={{ __html: t('automationManager.automationDesc', { frequency: t(`automationManager.${formData.frequency}`).toLowerCase(), leadsPerRun: formData.leads_per_run }) }} />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-lg transition-colors"
              >
                {t('automationManager.cancel')}
              </button>
              <button
                onClick={createRule}
                disabled={!formData.name || !formData.search_query || !formData.location || !formData.campaign_id}
                className="px-4 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {t('automationManager.createRule')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutomationManager;