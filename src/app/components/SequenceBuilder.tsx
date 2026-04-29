import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Play, Pause, X, GripVertical, Sparkles, Clock,
  Mail, Users, ArrowRight, ChevronDown, ChevronUp, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, BarChart3, Zap, Eye, 
  MousePointerClick, MessageSquare, Edit3, Save, ArrowLeft,
  Linkedin, UserPlus, Send, ListTodo
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ─── Types ───────────────────────────────────────────────────────────

interface SequenceStep {
  id: string;
  stepNumber: number;
  delayDays: number;
  /** For email steps: 'ai' or 'template'. Ignored for LinkedIn steps. */
  type: 'ai' | 'template';
  /** Channel: email (default for legacy), linkedin_connect, linkedin_message */
  channel?: 'email' | 'linkedin_connect' | 'linkedin_message';
  subject?: string;
  body?: string;
  aiInstructions?: string;
  stepLabel: string;
  /** LinkedIn connection request note (max 300 chars) */
  linkedinNote?: string;
  /** LinkedIn message body */
  linkedinMessage?: string;
}

interface SequenceConfig {
  id: string;
  name: string;
  campaignId?: string;
  brand?: string;
  product?: string;
  tone?: string;
  fromEmail?: string;
  senderName?: string;
  senderTitle?: string;
  landingUrl?: string;
  priceSummary?: string;
  campaignKnowledge?: string;
  steps: SequenceStep[];
  stopOnReply: boolean;
  stopOnClick: boolean;
  stopOnMeeting: boolean;
  dailyLimit: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  timezone: string;
  status: string;
  useSenderRotation: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SequenceStats {
  totalEnrolled: number;
  active: number;
  completed: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  byStep: Record<number, number>;
}

interface SequenceBuilderProps {
  onClose?: () => void;
  embedded?: boolean;
}

const STEP_LABELS = [
  { value: 'initial', label: 'Initial Outreach', color: 'bg-emerald-500' },
  { value: 'follow_up_1', label: 'Follow-up 1', color: 'bg-blue-500' },
  { value: 'follow_up_2', label: 'Follow-up 2', color: 'bg-indigo-500' },
  { value: 'follow_up_3', label: 'Follow-up 3', color: 'bg-purple-500' },
  { value: 'breakup', label: 'Breakup Email', color: 'bg-zinc-500' },
  { value: 'linkedin_connect', label: 'LinkedIn Connect', color: 'bg-[#0A66C2]' },
  { value: 'linkedin_message', label: 'LinkedIn Message', color: 'bg-[#0A66C2]' },
  { value: 'custom', label: 'Custom', color: 'bg-amber-500' },
];

/** Resolve channel from step (legacy steps default to 'email') */
const getChannel = (step: SequenceStep): 'email' | 'linkedin_connect' | 'linkedin_message' => {
  if (step.channel) return step.channel;
  // Legacy fallback: infer from stepLabel
  if (step.stepLabel === 'linkedin_connect') return 'linkedin_connect';
  if (step.stepLabel === 'linkedin_message') return 'linkedin_message';
  return 'email';
};

const CHANNEL_META = {
  email: { icon: Mail, label: 'Email', accent: 'text-zinc-600', bg: 'bg-zinc-100 dark:bg-white/5' },
  linkedin_connect: { icon: UserPlus, label: 'LinkedIn Connect', accent: 'text-[#0A66C2]', bg: 'bg-[#0A66C2]/10' },
  linkedin_message: { icon: Send, label: 'LinkedIn Message', accent: 'text-[#0A66C2]', bg: 'bg-[#0A66C2]/10' },
};

export function SequenceBuilder({ onClose, embedded = false }: SequenceBuilderProps) {
  const { t } = useTranslation();
  const [sequences, setSequences] = useState<SequenceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSequence, setSelectedSequence] = useState<SequenceConfig | null>(null);
  const [stats, setStats] = useState<SequenceStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // New sequence form
  const [newName, setNewName] = useState('');
  const [newProduct, setNewProduct] = useState('');
  const [newTone, setNewTone] = useState('professional');
  const [newFromEmail, setNewFromEmail] = useState('');
  const [newSenderName, setNewSenderName] = useState('');
  const [newDailyLimit, setNewDailyLimit] = useState(50);

  const loadSequences = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSequences(data.sequences || []);
      }
    } catch (err) {
      console.error('Failed to load sequences:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSequenceDetail = useCallback(async (id: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences/${id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSelectedSequence(data.sequence);
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to load sequence detail:', err);
    }
  }, []);

  useEffect(() => { loadSequences(); }, [loadSequences]);

  const createSequence = async () => {
    if (!newName.trim()) { toast.error('Please enter a sequence name'); return; }
    setCreating(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          product: newProduct,
          tone: newTone,
          fromEmail: newFromEmail,
          senderName: newSenderName,
          dailyLimit: newDailyLimit,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success('Sequence created!');
        setShowNewForm(false);
        setNewName(''); setNewProduct(''); setNewFromEmail(''); setNewSenderName('');
        await loadSequences();
        setSelectedSequence(data.sequence);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create sequence');
      }
    } catch { toast.error('Network error'); }
    finally { setCreating(false); }
  };

  const updateStep = async (stepId: string, updates: Partial<SequenceStep>) => {
    if (!selectedSequence) return;
    const updatedSteps = selectedSequence.steps.map(s =>
      s.id === stepId ? { ...s, ...updates } : s
    );
    setSelectedSequence({ ...selectedSequence, steps: updatedSteps });
  };

  const saveSequence = async () => {
    if (!selectedSequence) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences/${selectedSequence.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedSequence),
      });
      if (res.ok) {
        toast.success('Sequence saved!');
        await loadSequences();
      } else {
        toast.error('Failed to save');
      }
    } catch { toast.error('Network error'); }
    finally { setSaving(false); }
  };

  const toggleSequenceStatus = async () => {
    if (!selectedSequence) return;
    const newStatus = selectedSequence.status === 'active' ? 'paused' : 'active';
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences/${selectedSequence.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast.success(newStatus === 'active' ? 'Sequence activated!' : 'Sequence paused');
        setSelectedSequence({ ...selectedSequence, status: newStatus });
        await loadSequences();
      }
    } catch { toast.error('Failed to update status'); }
  };

  const deleteSeq = async (id: string) => {
    if (!confirm('Delete this sequence? This cannot be undone.')) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/sequences/${id}`, { method: 'DELETE', headers });
      toast.success('Sequence deleted');
      if (selectedSequence?.id === id) setSelectedSequence(null);
      await loadSequences();
    } catch { toast.error('Failed to delete'); }
  };

  const addStep = (channel: 'email' | 'linkedin_connect' | 'linkedin_message' = 'email') => {
    if (!selectedSequence) return;
    const nextNum = selectedSequence.steps.length + 1;
    setShowAddMenu(false);

    if (channel === 'email') {
      const labels = ['follow_up_1', 'follow_up_2', 'follow_up_3', 'breakup', 'custom'];
      const label = labels[Math.min(nextNum - 2, labels.length - 1)] || 'custom';
      const newStep: SequenceStep = {
        id: crypto.randomUUID(),
        stepNumber: nextNum,
        delayDays: nextNum === 1 ? 0 : 3,
        type: 'ai',
        channel: 'email',
        stepLabel: label,
        aiInstructions: '',
      };
      setSelectedSequence({ ...selectedSequence, steps: [...selectedSequence.steps, newStep] });
    } else {
      const newStep: SequenceStep = {
        id: crypto.randomUUID(),
        stepNumber: nextNum,
        delayDays: channel === 'linkedin_connect' ? 1 : 2,
        type: 'template',
        channel,
        stepLabel: channel,
        linkedinNote: channel === 'linkedin_connect' ? '' : undefined,
        linkedinMessage: channel === 'linkedin_message' ? '' : undefined,
      };
      setSelectedSequence({ ...selectedSequence, steps: [...selectedSequence.steps, newStep] });
    }
  };

  const removeStep = (stepId: string) => {
    if (!selectedSequence) return;
    const filtered = selectedSequence.steps.filter(s => s.id !== stepId);
    // Renumber
    const renumbered = filtered.map((s, i) => ({ ...s, stepNumber: i + 1 }));
    setSelectedSequence({ ...selectedSequence, steps: renumbered });
  };

  const processNow = async () => {
    setProcessing(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences/process`, { method: 'POST', headers });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Processed: ${data.totalSent} emails sent`);
        if (selectedSequence) await loadSequenceDetail(selectedSequence.id);
      }
    } catch { toast.error('Failed to process'); }
    finally { setProcessing(false); }
  };

  // ─── List View ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="Loading sequences..." />
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────────

  if (selectedSequence) {
    const stepLabelInfo = (label: string) => STEP_LABELS.find(l => l.value === label) || STEP_LABELS[5];

    return (
      <div className="h-full overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-[#0a0a0a] border-b border-zinc-200 dark:border-white/10 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => { setSelectedSequence(null); setStats(null); }} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                <ArrowLeft className="w-4 h-4 text-zinc-500" />
              </button>
              <div>
                <input
                  value={selectedSequence.name}
                  onChange={e => setSelectedSequence({ ...selectedSequence, name: e.target.value })}
                  className="text-lg font-semibold bg-transparent border-none outline-none text-black dark:text-white w-full"
                />
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    selectedSequence.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                    selectedSequence.status === 'paused' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                    selectedSequence.status === 'completed' ? 'bg-zinc-100 dark:bg-white/5 text-zinc-500' :
                    'bg-zinc-100 dark:bg-white/5 text-zinc-500'
                  }`}>
                    {selectedSequence.status}
                  </span>
                  <span className="text-xs text-zinc-400">{selectedSequence.steps.length} steps</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={processNow} disabled={processing || selectedSequence.status !== 'active'} className="px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5">
                {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Process Now
              </button>
              <button onClick={toggleSequenceStatus} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                selectedSequence.status === 'active'
                  ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-200'
                  : 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200'
              }`}>
                {selectedSequence.status === 'active' ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Activate</>}
              </button>
              <button onClick={saveSequence} disabled={saving} className="px-3 py-1.5 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Stats Bar */}
          {stats && stats.totalEnrolled > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'Enrolled', value: stats.totalEnrolled, icon: Users, color: 'text-zinc-600' },
                { label: 'Active', value: stats.active, icon: Play, color: 'text-blue-500' },
                { label: 'Completed', value: stats.completed, icon: CheckCircle2, color: 'text-emerald-500' },
                { label: 'Replied', value: stats.replied, icon: MessageSquare, color: 'text-indigo-500' },
                { label: 'Bounced', value: stats.bounced, icon: AlertCircle, color: 'text-red-500' },
                { label: 'Unsub', value: stats.unsubscribed, icon: X, color: 'text-amber-500' },
              ].map(stat => (
                <div key={stat.label} className="bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5 rounded-xl p-3 text-center">
                  <stat.icon className={`w-4 h-4 mx-auto mb-1 ${stat.color}`} />
                  <p className="text-lg font-semibold text-black dark:text-white">{stat.value}</p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Settings Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">Daily Send Limit</label>
              <input type="number" value={selectedSequence.dailyLimit} onChange={e => setSelectedSequence({ ...selectedSequence, dailyLimit: parseInt(e.target.value) || 50 })} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">From Email</label>
              <input value={selectedSequence.fromEmail || ''} onChange={e => setSelectedSequence({ ...selectedSequence, fromEmail: e.target.value })} placeholder="Connected email" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">Sender Name</label>
              <input value={selectedSequence.senderName || ''} onChange={e => setSelectedSequence({ ...selectedSequence, senderName: e.target.value })} placeholder="Your Name" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
            </div>
          </div>

          {/* Auto-Stop Toggles */}
          <div className="flex flex-wrap gap-4">
            {[
              { key: 'stopOnReply', label: 'Stop on Reply', icon: MessageSquare },
              { key: 'stopOnClick', label: 'Stop on Click', icon: MousePointerClick },
              { key: 'stopOnMeeting', label: 'Stop on Meeting', icon: CheckCircle2 },
              { key: 'useSenderRotation', label: 'Sender Rotation', icon: RefreshCw },
            ].map(toggle => (
              <button
                key={toggle.key}
                onClick={() => setSelectedSequence({ ...selectedSequence, [toggle.key]: !(selectedSequence as any)[toggle.key] })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  (selectedSequence as any)[toggle.key]
                    ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
              >
                <toggle.icon className="w-3.5 h-3.5" />
                {toggle.label}
                {(selectedSequence as any)[toggle.key] && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
              </button>
            ))}
          </div>

          {/* Steps Timeline */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-black dark:text-white">Sequence Steps</h3>
              <div className="relative">
                <button onClick={() => setShowAddMenu(!showAddMenu)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg transition-colors">
                  <Plus className="w-3 h-3" /> Add Step <ChevronDown className="w-3 h-3" />
                </button>
                {showAddMenu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowAddMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl z-30 overflow-hidden">
                      <button onClick={() => addStep('email')} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-black dark:text-white hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                        <Mail className="w-3.5 h-3.5 text-zinc-500" /> Email Step
                      </button>
                      <div className="h-px bg-zinc-100 dark:bg-white/5" />
                      <button onClick={() => addStep('linkedin_connect')} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-black dark:text-white hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                        <UserPlus className="w-3.5 h-3.5 text-[#0A66C2]" /> LinkedIn Connect
                      </button>
                      <button onClick={() => addStep('linkedin_message')} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-black dark:text-white hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                        <Send className="w-3.5 h-3.5 text-[#0A66C2]" /> LinkedIn Message
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {selectedSequence.steps.map((step, idx) => {
                const labelInfo = stepLabelInfo(step.stepLabel);
                const isEditing = editingStep === step.id;
                const leadsAtStep = stats?.byStep[step.stepNumber] || 0;
                const channel = getChannel(step);
                const chMeta = CHANNEL_META[channel];
                const isLinkedin = channel !== 'email';

                return (
                  <div key={step.id} className="relative">
                    {/* Timeline connector */}
                    {idx > 0 && (
                      <div className="absolute left-6 -top-3 w-px h-3 bg-zinc-200 dark:bg-white/10" />
                    )}

                    <div className={`border rounded-xl transition-colors ${
                      isEditing ? 'border-zinc-400 dark:border-white/20 bg-zinc-50 dark:bg-white/[0.02]' : 'border-zinc-200 dark:border-white/5 bg-white dark:bg-[#0a0a0a]'
                    }`}>
                      {/* Step Header */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className={`w-8 h-8 rounded-full ${labelInfo.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {step.stepNumber}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-black dark:text-white">{labelInfo.label}</span>
                            {/* Channel badge */}
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${isLinkedin ? 'bg-[#0A66C2]/10 text-[#0A66C2]' : 'bg-zinc-100 dark:bg-white/5 text-zinc-500'}`}>
                              <chMeta.icon className="w-2.5 h-2.5" />
                              {chMeta.label}
                            </span>
                            {!isLinkedin && step.type === 'ai' && <Sparkles className="w-3 h-3 text-amber-500" />}
                            {!isLinkedin && step.type === 'template' && <Mail className="w-3 h-3 text-blue-500" />}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-0.5">
                            {idx > 0 && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Wait {step.delayDays} day{step.delayDays !== 1 ? 's' : ''}
                              </span>
                            )}
                            {idx === 0 && !isLinkedin && <span>Sends immediately on enrollment</span>}
                            {idx === 0 && isLinkedin && <span>Task created on enrollment</span>}
                            {isLinkedin && (
                              <span className="flex items-center gap-1 text-[#0A66C2]">
                                <ListTodo className="w-3 h-3" /> Manual task
                              </span>
                            )}
                            {leadsAtStep > 0 && (
                              <span className="flex items-center gap-1 text-blue-500">
                                <Users className="w-3 h-3" /> {leadsAtStep} pending
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingStep(isEditing ? null : step.id)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                            {isEditing ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <Edit3 className="w-4 h-4 text-zinc-400" />}
                          </button>
                          {selectedSequence.steps.length > 1 && (
                            <button onClick={() => removeStep(step.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4 text-red-400" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Editor */}
                      {isEditing && (
                        <div className="border-t border-zinc-200 dark:border-white/5 px-4 py-4 space-y-3">
                          {/* Delay */}
                          {idx > 0 && (
                            <div>
                              <label className="text-xs font-medium text-zinc-500 mb-1 block">Wait (days after previous step)</label>
                              <input type="number" min={1} max={30} value={step.delayDays} onChange={e => updateStep(step.id, { delayDays: parseInt(e.target.value) || 1 })} className="w-24 px-3 py-1.5 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white" />
                            </div>
                          )}

                          {/* ── Email-specific editor ── */}
                          {!isLinkedin && (
                            <>
                              {/* Type Toggle */}
                              <div>
                                <label className="text-xs font-medium text-zinc-500 mb-1 block">Email Type</label>
                                <div className="flex gap-2">
                                  <button onClick={() => updateStep(step.id, { type: 'ai' })} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${step.type === 'ai' ? 'border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-zinc-200 dark:border-white/10 text-zinc-500'}`}>
                                    <Sparkles className="w-3 h-3" /> AI Generated
                                  </button>
                                  <button onClick={() => updateStep(step.id, { type: 'template' })} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${step.type === 'template' ? 'border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'border-zinc-200 dark:border-white/10 text-zinc-500'}`}>
                                    <Mail className="w-3 h-3" /> Template
                                  </button>
                                </div>
                              </div>

                              {/* Label */}
                              <div>
                                <label className="text-xs font-medium text-zinc-500 mb-1 block">Step Label</label>
                                <select value={step.stepLabel} onChange={e => updateStep(step.id, { stepLabel: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white">
                                  {STEP_LABELS.filter(l => l.value !== 'linkedin_connect' && l.value !== 'linkedin_message').map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                              </div>

                              {step.type === 'ai' ? (
                                <div>
                                  <label className="text-xs font-medium text-zinc-500 mb-1 block">AI Instructions</label>
                                  <textarea value={step.aiInstructions || ''} onChange={e => updateStep(step.id, { aiInstructions: e.target.value })} placeholder="Tell the AI what to focus on for this step..." rows={3} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400 resize-none" />
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <label className="text-xs font-medium text-zinc-500 mb-1 block">Subject Line</label>
                                    <input value={step.subject || ''} onChange={e => updateStep(step.id, { subject: e.target.value })} placeholder="Email subject..." className="w-full px-3 py-1.5 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
                                  </div>
                                  <div>
                                    <label className="text-xs font-medium text-zinc-500 mb-1 block">Email Body (HTML)</label>
                                    <textarea value={step.body || ''} onChange={e => updateStep(step.id, { body: e.target.value })} placeholder="Email body HTML..." rows={6} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400 resize-none font-mono" />
                                  </div>
                                </>
                              )}
                            </>
                          )}

                          {/* ── LinkedIn Connect editor ── */}
                          {channel === 'linkedin_connect' && (
                            <>
                              <div className="flex items-center gap-2 p-3 rounded-lg bg-[#0A66C2]/5 border border-[#0A66C2]/20">
                                <Linkedin className="w-4 h-4 text-[#0A66C2] shrink-0" />
                                <p className="text-[11px] text-[#0A66C2]">
                                  Connection requests appear as manual tasks in your task queue. Complete them directly on LinkedIn.
                                </p>
                              </div>
                              <div>
                                <label className="text-xs font-medium text-zinc-500 mb-1 block">
                                  Connection Note <span className="text-zinc-400">({(step.linkedinNote || '').length}/300)</span>
                                </label>
                                <textarea
                                  value={step.linkedinNote || ''}
                                  onChange={e => {
                                    if (e.target.value.length <= 300) updateStep(step.id, { linkedinNote: e.target.value });
                                  }}
                                  placeholder="Hi {{first_name}}, I came across your profile and thought we could connect..."
                                  rows={3}
                                  className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400 resize-none"
                                />
                                <p className="text-[10px] text-zinc-400 mt-1">Supports variables: {"{{first_name}}, {{company}}, {{title}}"}</p>
                              </div>
                            </>
                          )}

                          {/* ── LinkedIn Message editor ── */}
                          {channel === 'linkedin_message' && (
                            <>
                              <div className="flex items-center gap-2 p-3 rounded-lg bg-[#0A66C2]/5 border border-[#0A66C2]/20">
                                <Linkedin className="w-4 h-4 text-[#0A66C2] shrink-0" />
                                <p className="text-[11px] text-[#0A66C2]">
                                  LinkedIn messages appear as manual tasks. You must be connected with the lead before sending.
                                </p>
                              </div>
                              <div>
                                <label className="text-xs font-medium text-zinc-500 mb-1 block">Message</label>
                                <textarea
                                  value={step.linkedinMessage || ''}
                                  onChange={e => updateStep(step.id, { linkedinMessage: e.target.value })}
                                  placeholder="Hi {{first_name}}, thanks for connecting! I wanted to share..."
                                  rows={4}
                                  className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400 resize-none"
                                />
                                <p className="text-[10px] text-zinc-400 mt-1">Supports variables: {"{{first_name}}, {{company}}, {{title}}"}</p>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Arrow between steps */}
                    {idx < selectedSequence.steps.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 rotate-90" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Campaign Knowledge */}
          <div>
            <label className="text-xs font-medium text-zinc-500 mb-1 block">Campaign Context / Knowledge</label>
            <textarea value={selectedSequence.campaignKnowledge || ''} onChange={e => setSelectedSequence({ ...selectedSequence, campaignKnowledge: e.target.value })} placeholder="Add context about your product, service, or offer that the AI should use when generating emails..." rows={4} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400 resize-none" />
          </div>
        </div>
      </div>
    );
  }

  // ─── Sequences List ─────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 border-b border-zinc-200 dark:border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-black dark:text-white">Sequences</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Multi-channel outreach — email + LinkedIn, with auto-stop on reply</p>
          </div>
          <button onClick={() => setShowNewForm(true)} className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">
            <Plus className="w-3.5 h-3.5" /> New Sequence
          </button>
        </div>
      </div>

      {/* New Sequence Form */}
      {showNewForm && (
        <div className="mx-6 mt-4 p-5 border border-zinc-200 dark:border-white/10 rounded-xl bg-zinc-50 dark:bg-white/[0.02]">
          <h3 className="text-sm font-semibold text-black dark:text-white mb-3">Create New Sequence</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">Sequence Name *</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g., SaaS Decision Makers Q1" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">Product / Service</label>
              <input value={newProduct} onChange={e => setNewProduct(e.target.value)} placeholder="What you're selling" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">Sender Name</label>
              <input value={newSenderName} onChange={e => setNewSenderName(e.target.value)} placeholder="Your Name" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">Daily Limit</label>
              <input type="number" value={newDailyLimit} onChange={e => setNewDailyLimit(parseInt(e.target.value) || 50)} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white" />
            </div>
          </div>
          <p className="text-[11px] text-zinc-400 mt-3">A default 4-step sequence (Initial → Follow-up 1 → Follow-up 2 → Breakup) will be created. You can customize steps after creation.</p>
          <div className="flex items-center gap-2 mt-4">
            <button onClick={createSequence} disabled={creating} className="px-4 py-2 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-1.5">
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Sequence
            </button>
            <button onClick={() => setShowNewForm(false)} className="px-4 py-2 text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sequences Grid */}
      <div className="p-6">
        {sequences.length === 0 && !showNewForm ? (
          <div className="text-center py-16">
            <Mail className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-zinc-500 mb-1">No sequences yet</h3>
            <p className="text-xs text-zinc-400">Create your first multi-channel sequence to automate email + LinkedIn outreach.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sequences.map(seq => (
              <div key={seq.id} className="border border-zinc-200 dark:border-white/5 rounded-xl bg-white dark:bg-[#0a0a0a] hover:border-zinc-300 dark:hover:border-white/10 transition-colors">
                <button onClick={() => loadSequenceDetail(seq.id)} className="w-full text-left px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        seq.status === 'active' ? 'bg-emerald-500' :
                        seq.status === 'paused' ? 'bg-amber-500' :
                        seq.status === 'completed' ? 'bg-zinc-400' : 'bg-zinc-300'
                      }`} />
                      <div>
                        <h4 className="text-sm font-medium text-black dark:text-white">{seq.name}</h4>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          {seq.steps.length} steps
                          {seq.steps.some(s => (s.channel || 'email') !== 'email') && (
                            <span className="text-[#0A66C2]"> &middot; multi-channel</span>
                          )}
                          {' '}&middot; {seq.status} &middot; {seq.dailyLimit}/day limit
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Step indicators */}
                      <div className="hidden sm:flex items-center gap-1">
                        {seq.steps.map((step, i) => {
                          const info = stepLabelInfo(step.stepLabel);
                          return (
                            <div key={step.id} className="flex items-center">
                              <div className={`w-5 h-5 rounded-full ${info.color} flex items-center justify-center text-white text-[9px] font-bold`}>
                                {step.stepNumber}
                              </div>
                              {i < seq.steps.length - 1 && (
                                <div className="w-4 h-px bg-zinc-200 dark:bg-zinc-700" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button onClick={e => { e.stopPropagation(); deleteSeq(seq.id); }} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors ml-2">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SequenceBuilder;