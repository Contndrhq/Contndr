import { useState, useEffect } from 'react';
import { 
  Phone, 
  PhoneCall, 
  PhoneOff,
  Clock,
  Users,
  CheckCircle2,
  XCircle,
  Plus,
  Settings,
  Mic,
  Volume2,
  VolumeX,
  UserPlus,
  List,
  RefreshCw,
  ArrowLeft,
  Edit,
  Play,
  Pause,
  Trash2,
  Calendar,
  Target,
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { useTranslation } from 'react-i18next';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';
import { apiCache } from '../lib/api-cache';
import { AIAgentConfig } from './AIAgentConfig';
import { AICreditsPanel } from './AICreditsPanel';
import { ElevenLabsUsagePanel } from './ElevenLabsUsagePanel';
import { useCanAccessAdmin } from '../hooks/useUserRole';

interface ActiveCall {
  id: string;
  leadName: string;
  businessName: string;
  phone: string;
  status: 'speaking' | 'listening' | 'processing';
  duration: number;
  aiName: string;
  brand: string;
  startedAt: string;
}

interface CallStats {
  activeNow: number;
  totalToday: number;
  connected: number;
  voicemail: number;
  noAnswer: number;
  booked: number;
  avgDuration: number;
}

interface Campaign {
  id: string;
  name: string;
  brand: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  pause_reason?: string;
  last_error?: string;
  total_leads: number;
  calls_made: number;
  failed_calls?: number;
  created_at: string;
  selected_leads?: string[];
}

export function AICalls({ 
  onCreateCampaign, 
  onViewSettings, 
  onViewLogs,
  onEditCampaign 
}: { 
  onCreateCampaign: () => void;
  onViewSettings: () => void;
  onViewLogs: () => void;
  onEditCampaign?: (campaign: Campaign) => void;
}) {
  const { t } = useTranslation();
  const isAdmin = useCanAccessAdmin();
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<CallStats>({
    activeNow: 0,
    totalToday: 0,
    connected: 0,
    voicemail: 0,
    noAnswer: 0,
    booked: 0,
    avgDuration: 0
  });
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deletingCampaign, setDeletingCampaign] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAgentConfig, setShowAgentConfig] = useState(false);
  const [showVoicePanel, setShowVoicePanel] = useState(false);

  useEffect(() => {
    loadData();
    const pollInterval = setInterval(() => loadData(true), 2000);
    return () => clearInterval(pollInterval);
  }, []);

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const headers = await getAuthHeaders();

      // Use apiCache so prefetched data from App.tsx is consumed immediately
      const campaignsData = await apiCache.fetch(
        'ai-calls:campaigns',
        async () => {
          const res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-call-campaigns`,
            { headers }
          );
          if (!res.ok) throw new Error(`${res.status}`);
          return res.json();
        },
        { staleTime: silent ? 0 : 20_000, cacheTime: 120_000 }
      );
      setCampaigns(campaignsData.campaigns || []);

      try {
        const callsResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/active-calls`, 
          { headers, method: 'GET', signal: AbortSignal.timeout(10000) }
        );

        if (callsResponse.ok) {
          const data = await callsResponse.json();
          setActiveCalls(data.calls || []);
          setStats(data.stats || stats);
        } else {
          setActiveCalls([]);
        }
      } catch (fetchError) {
        setActiveCalls([]);
      }
    } catch (error) {
      console.error('Error loading AI calls data:', error);
      if (!silent) setError(t('aiCalls.failedLoadData'));
    } finally {
      setLoading(false);
    }
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  async function updateCampaignStatus(newStatus: 'active' | 'paused') {
    if (!selectedCampaign) return;
    
    if (newStatus === 'active' && (!selectedCampaign.total_leads || selectedCampaign.total_leads === 0)) {
      alert(t('aiCalls.cannotStart'));
      return;
    }
    
    setUpdatingStatus(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-call-campaigns/${selectedCampaign.id}/status`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        }
      );

      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const updatedCampaign = payload?.campaign || { ...selectedCampaign, status: newStatus };
        setSelectedCampaign(updatedCampaign);
        setCampaigns(campaigns.map(c => c.id === selectedCampaign.id ? updatedCampaign : c));
        if (newStatus === 'active') alert(t('aiCalls.campaignStarted'));
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Campaign status update failed:', errorData);
        throw new Error(errorData.error || 'Failed to update status');
      }
    } catch (error: any) {
      console.error('Error updating campaign status:', error);
      alert(t('aiCalls.failedUpdateStatus', { error: error.message || 'Unknown error' }));
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function deleteCampaign() {
    if (!selectedCampaign || !confirm(t('aiCalls.deleteConfirm', { name: selectedCampaign.name }))) return;
    
    setDeletingCampaign(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-call-campaigns/${selectedCampaign.id}`,
        { method: 'DELETE', headers }
      );

      if (response.ok) {
        setCampaigns(campaigns.filter(c => c.id !== selectedCampaign.id));
        setSelectedCampaign(null);
      } else {
        throw new Error('Failed to delete campaign');
      }
    } catch (error) {
      console.error('Error deleting campaign:', error);
      alert(t('aiCalls.errorDeleting'));
    } finally {
      setDeletingCampaign(false);
    }
  }

  if (loading) return <LoadingSpinner size="lg" text={t('aiCalls.loading')} center />;

  // ── Agent Config sub-view ──
  if (showAgentConfig) {
    return (
      <div className="flex flex-col h-full p-3 sm:p-6 overflow-y-auto animate-fade-in">
        <AIAgentConfig onBack={() => setShowAgentConfig(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 sm:p-6 space-y-4 sm:space-y-6 animate-fade-in overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('aiCalls.title')}</h1>
            {stats.activeNow > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-[#1ED4A7] rounded-full text-[10px] sm:text-xs font-medium text-black">
                <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                {stats.activeNow} {t('aiCalls.live')}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-zinc-500">{t('aiCalls.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <AICreditsPanel compact />
          {isAdmin && <ElevenLabsUsagePanel compact />}
        </div>
      </div>

      {/* Action buttons row */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <button
          onClick={() => setShowAgentConfig(true)}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-[#1ED4A7] hover:text-[#19bf96] transition-colors border border-[#1ED4A7]/20 hover:border-[#1ED4A7]/40 rounded-lg hover:bg-[#1ED4A7]/5"
        >
          <Bot className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          <span className="hidden sm:inline">{t('aiCalls.agentConfig')}</span>
          <span className="sm:hidden">{t('aiCalls.agents')}</span>
        </button>
        <button
          onClick={onViewSettings}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <Settings className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          <span className="hidden sm:inline">{t('aiCalls.numbers')}</span>
        </button>
        <button
          onClick={onCreateCampaign}
          className="flex items-center gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors text-xs sm:text-sm font-medium"
        >
          <Plus className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          <span className="hidden xs:inline">{t('aiCalls.createCampaign')}</span>
          <span className="xs:hidden">{t('aiCalls.new')}</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <StatCard title={t('aiCalls.stats.active')} value={stats.activeNow.toString()} icon={PhoneCall} color="text-[#1ED4A7]" pulse={stats.activeNow > 0} />
        <StatCard title={t('aiCalls.stats.today')} value={stats.totalToday.toString()} icon={Phone} color="text-zinc-500 dark:text-zinc-400" />
        <StatCard title={t('aiCalls.stats.connected')} value={stats.connected.toString()} icon={CheckCircle2} color="text-[#1ED4A7]" subtitle={stats.totalToday > 0 ? `${Math.round((stats.connected / stats.totalToday) * 100)}%` : '0%'} />
        <StatCard title={t('aiCalls.stats.voicemail')} value={stats.voicemail.toString()} icon={Mic} color="text-zinc-500 dark:text-zinc-400" />
        <StatCard title={t('aiCalls.stats.noAnswer')} value={stats.noAnswer.toString()} icon={PhoneOff} color="text-zinc-500 dark:text-zinc-400" />
        <StatCard title={t('aiCalls.stats.booked')} value={stats.booked.toString()} icon={UserPlus} color="text-[#1ED4A7]" subtitle={stats.connected > 0 ? `${Math.round((stats.booked / stats.connected) * 100)}%` : '0%'} />
      </div>

      {/* ElevenLabs Voice & AI Panel (collapsible) */}
      {isAdmin && (
      <div>
        <button
          onClick={() => setShowVoicePanel(!showVoicePanel)}
          className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors mb-2"
        >
          <Volume2 className="w-3.5 h-3.5 text-[#1ED4A7]" />
          <span>ElevenLabs Pro</span>
          {showVoicePanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showVoicePanel && <ElevenLabsUsagePanel />}
      </div>
      )}

      {/* Live Call Monitor */}
      {activeCalls.length > 0 && (
        <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-3 sm:px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-[#1ED4A7]/5 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] animate-pulse" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('aiCalls.liveCalls')}</h2>
            <span className="text-[10px] text-zinc-500">{t('aiCalls.activeCount', { count: activeCalls.length })}</span>
          </div>
          <div className="divide-y divide-zinc-200/50 dark:divide-zinc-800/50">
            {activeCalls.map(call => (
              <ActiveCallCard key={call.id} call={call} formatDuration={formatDuration} onCallEnded={(id) => setActiveCalls(prev => prev.filter(c => c.id !== id))} />
            ))}
          </div>
        </div>
      )}

      {/* Campaigns List */}
      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('aiCalls.campaigns')}</h2>
        </div>
        {campaigns.length > 0 ? (
          <div className="divide-y divide-zinc-200/50 dark:divide-zinc-800/50">
            {campaigns.map(campaign => (
              <CampaignRow
                key={campaign.id}
                campaign={campaign}
                onViewDetails={() => setSelectedCampaign(campaign)}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-10 sm:py-14 text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Phone className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-500" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">{t('aiCalls.noCampaignsYet')}</h3>
            <p className="text-xs text-zinc-500 mb-4">{t('aiCalls.startBooking')}</p>
            <button
              onClick={onCreateCampaign}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('aiCalls.createCampaign')}
            </button>
          </div>
        )}
      </div>

      {/* Campaign Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={() => setSelectedCampaign(null)}>
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-2xl sm:rounded-xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="sticky top-0 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-5 py-3.5 z-10 flex justify-between items-center">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white truncate">{selectedCampaign.name}</h2>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${
                    selectedCampaign.status === 'active' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                    selectedCampaign.status === 'paused' && selectedCampaign.pause_reason === 'insufficient_credits' ? 'bg-amber-500/10 text-amber-400' :
                    selectedCampaign.status === 'paused' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400' :
                    'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                  }`}>
                    {selectedCampaign.status === 'paused' && selectedCampaign.pause_reason === 'insufficient_credits' ? t('aiCalls.noCredits') : selectedCampaign.status}
                  </span>
                </div>
                <p className="text-[10px] sm:text-xs text-zinc-500 capitalize truncate">{selectedCampaign.brand} &middot; {t('aiCalls.created')} {new Date(selectedCampaign.created_at).toLocaleDateString()}</p>
              </div>
              <button onClick={() => setSelectedCampaign(null)} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0 ml-2">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* Progress */}
              {selectedCampaign.status === 'paused' && selectedCampaign.pause_reason === 'insufficient_credits' && (
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <PhoneOff className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-amber-300">{t('aiCalls.pausedInsufficient')}</p>
                    <p className="text-[10px] text-amber-400/70 mt-0.5">{t('aiCalls.purchaseMore')}</p>
                  </div>
                </div>
              )}
              {selectedCampaign.last_error && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <PhoneOff className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-red-300">Calling issue</p>
                    <p className="text-[10px] text-red-300/80 mt-0.5 break-words">{selectedCampaign.last_error}</p>
                  </div>
                </div>
              )}
              <div>
                <div className="flex justify-between text-xs font-medium text-zinc-900 dark:text-white mb-1.5">
                  <span>{t('aiCalls.progress')}</span>
                  <span className="text-zinc-400">
                    {selectedCampaign.calls_made + (selectedCampaign.failed_calls || 0)}/{selectedCampaign.total_leads} ({Math.round(((selectedCampaign.calls_made + (selectedCampaign.failed_calls || 0)) / Math.max(selectedCampaign.total_leads, 1)) * 100)}%)
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#1ED4A7] rounded-full transition-all duration-500"
                    style={{ width: (Math.min(100, Math.round(((selectedCampaign.calls_made + (selectedCampaign.failed_calls || 0)) / Math.max(selectedCampaign.total_leads, 1)) * 100)) + '%') }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/50 p-3 sm:p-4 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                    <Target className="w-3 h-3" />
                    {t('aiCalls.totalLeads')}
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white">{selectedCampaign.total_leads}</p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/50 p-3 sm:p-4 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                    <PhoneCall className="w-3 h-3" />
                    {t('aiCalls.callsMade')}
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white">{selectedCampaign.calls_made}</p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/50 p-3 sm:p-4 rounded-lg col-span-2">
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                    <PhoneOff className="w-3 h-3" />
                    Failed Attempts
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white">{selectedCampaign.failed_calls || 0}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                {selectedCampaign.status === 'draft' && (
                  <button onClick={() => updateCampaignStatus('active')} disabled={updatingStatus} className="flex-1 py-2 sm:py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                    {updatingStatus ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {t('aiCalls.start')}
                  </button>
                )}
                {selectedCampaign.status === 'active' && (
                  <button onClick={() => updateCampaignStatus('paused')} disabled={updatingStatus} className="flex-1 py-2 sm:py-2.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                    {updatingStatus ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                    {t('aiCalls.pause')}
                  </button>
                )}
                {selectedCampaign.status === 'paused' && (
                  <button onClick={() => updateCampaignStatus('active')} disabled={updatingStatus} className="flex-1 py-2 sm:py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                    {updatingStatus ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {t('aiCalls.resume')}
                  </button>
                )}
                <button onClick={() => { if (onEditCampaign && selectedCampaign) { onEditCampaign(selectedCampaign); setSelectedCampaign(null); } }} className="flex-1 py-2 sm:py-2.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5">
                  <Edit className="w-3.5 h-3.5" /> {t('aiCalls.edit')}
                </button>
                <button onClick={deleteCampaign} disabled={deletingCampaign} className="px-3 py-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50">
                  {deletingCampaign ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, subtitle, pulse }: { title: string, value: string, icon: any, color: string, subtitle?: string, pulse?: boolean }) {
  return (
    <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 p-3 sm:p-4 rounded-xl">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <span className="text-[10px] sm:text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</span>
        <Icon className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${color} ${pulse ? 'animate-pulse' : ''}`} />
      </div>
      <p className="text-lg sm:text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{value}</p>
      {subtitle && <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ActiveCallCard({ call, formatDuration, onCallEnded }: { call: ActiveCall; formatDuration: (s: number) => string; onCallEnded: (id: string) => void }) {
  const { t } = useTranslation();
  const [broadcastState, setBroadcastState] = useState<'off' | 'connecting' | 'live'>('off');

  async function handleEndCall() {
    if (!confirm(t('aiCalls.endCall'))) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/calls/${call.id}/hangup`,
        { method: 'POST', headers, body: JSON.stringify({}) }
      );
      onCallEnded(call.id);
    } catch (error) {
      alert(t('aiCalls.errorEndingCall'));
    }
  }
  
  async function handleBroadcastToggle() {
    if (broadcastState === 'live') {
      setBroadcastState('off');
      return;
    }

    const phoneNumber = prompt(t('aiCalls.broadcastPrompt'));
    if (!phoneNumber) return;

    setBroadcastState('connecting');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/calls/${call.id}/listen`,
        { method: 'POST', headers, body: JSON.stringify({ listen_number: phoneNumber }) }
      );
      if (res.ok) {
        setBroadcastState('live');
      } else {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Broadcast setup failed:', errData);
        if (errData.call_ended) {
          alert(t('aiCalls.callAlreadyEnded'));
        } else {
          alert(errData.error || t('aiCalls.failedBroadcast'));
        }
        setBroadcastState('off');
      }
    } catch (error) {
      console.error('Error setting up broadcast:', error);
      alert(t('aiCalls.errorBroadcast'));
      setBroadcastState('off');
    }
  }

  return (
    <div className="px-3 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          {call.status === 'speaking' ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-[#1ED4A7] bg-[#1ED4A7]/10 px-1.5 py-0.5 rounded">
              <Volume2 className="w-2.5 h-2.5" /> {t('aiCalls.speaking')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
              <Mic className="w-2.5 h-2.5" /> {t('aiCalls.listening')}
            </span>
          )}
          <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600">{formatDuration(call.duration)}</span>
        </div>
        <p className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-white truncate">{call.leadName} &middot; {call.businessName}</p>
        <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5 truncate">{call.phone} &middot; AI: {call.aiName}</p>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        {/* No Sound / Broadcasting toggle */}
        <button
          onClick={handleBroadcastToggle}
          disabled={broadcastState === 'connecting'}
          className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium rounded-lg transition-all ${
            broadcastState === 'live'
              ? 'text-[#1ED4A7] bg-[#1ED4A7]/10 border border-[#1ED4A7]/30 hover:bg-[#1ED4A7]/20'
              : broadcastState === 'connecting'
              ? 'text-amber-400 bg-amber-500/10 cursor-wait'
              : 'text-zinc-500 bg-zinc-200/50 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          {broadcastState === 'connecting' ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="hidden sm:inline">{t('aiCalls.calling')}</span>
            </>
          ) : broadcastState === 'live' ? (
            <>
              <Volume2 className="w-3 h-3" />
              <span className="hidden sm:inline">{t('aiCalls.live')}</span>
            </>
          ) : (
            <>
              <VolumeX className="w-3 h-3" />
              <span className="hidden sm:inline">{t('aiCalls.noSound')}</span>
            </>
          )}
        </button>
        <button onClick={handleEndCall} className="px-2 sm:px-2.5 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-800 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors">{t('aiCalls.end')}</button>
      </div>
    </div>
  );
}

function CampaignRow({ campaign, onViewDetails }: { campaign: Campaign; onViewDetails: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-3 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <h3 className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-white truncate">{campaign.name}</h3>
          <span className={`px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${
            campaign.status === 'active' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
            campaign.status === 'paused' && campaign.pause_reason === 'insufficient_credits' ? 'bg-amber-500/10 text-amber-400' :
            campaign.status === 'paused' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400' :
            'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
          }`}>{campaign.status === 'paused' && campaign.pause_reason === 'insufficient_credits' ? t('aiCalls.noCredits') : campaign.status}</span>
        </div>
        <p className="text-[10px] sm:text-xs text-zinc-500 truncate">
          {campaign.calls_made}/{campaign.total_leads} {t('aiCalls.calls')}
          {(campaign.failed_calls || 0) > 0 ? ` · ${campaign.failed_calls} failed` : ''}
          {campaign.last_error ? ` · ${campaign.last_error}` : ` · ${campaign.brand} · ${new Date(campaign.created_at).toLocaleDateString()}`}
        </p>
      </div>
      <button onClick={onViewDetails} className="px-2.5 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-colors flex-shrink-0">{t('aiCalls.details')}</button>
    </div>
  );
}
