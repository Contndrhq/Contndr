/**
 * AIAgentConfig — Full AI Call Agent configuration panel.
 * Scalable for any business type: medical, legal, retail, etc.
 * Manages greeting, instructions, knowledge base, transfer rules, and voice.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot, Save, Plus, Trash2, Phone, PhoneForwarded, Mic, Volume2,
  BookOpen, MessageSquare, Settings2, Sparkles, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle2, Loader2, X, Clock, Building2, GripVertical,
  Play, Pause, Copy, Star, StarOff, HelpCircle, Zap, Brain, Shield,
  ArrowLeft, MoreHorizontal, Pencil,
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { useTranslation } from 'react-i18next';

// ── Types ──

interface TransferRule {
  id: string;
  trigger: string;
  phone: string;
  description: string;
  transfer_message: string;
}

interface AIAgent {
  id: string;
  name: string;
  role: string;
  voice: string;
  brand: string;
  greeting: string;
  instructions: string;
  knowledge_base: string;
  transfer_rules: TransferRule[];
  fallback_action: string;
  max_turns: number;
  business_type: string;
  business_name: string;
  business_phone: string;
  operating_hours: string;
  language: string;
  is_default: boolean;
  end_call_message: string;
  voicemail_message: string;
  qualification_questions: string[];
  created_at: string;
  updated_at: string;
}

const EMPTY_AGENT: Omit<AIAgent, 'id' | 'created_at' | 'updated_at'> = {
  name: '',
  role: 'Receptionist',
  voice: 'rachel',
  brand: '',
  greeting: '',
  instructions: '',
  knowledge_base: '',
  transfer_rules: [],
  fallback_action: 'email',
  max_turns: 12,
  business_type: 'general',
  business_name: '',
  business_phone: '',
  operating_hours: '',
  language: 'en',
  is_default: false,
  end_call_message: '',
  voicemail_message: '',
  qualification_questions: [],
};

const VOICES = [
  { id: 'rachel', label: 'Rachel', desc: 'Calm, professional female', gender: 'female' },
  { id: 'bella', label: 'Bella', desc: 'Warm, engaging female', gender: 'female' },
  { id: 'josh', label: 'Josh', desc: 'Deep, confident male', gender: 'male' },
  { id: 'adam', label: 'Adam', desc: 'Deep, warm male', gender: 'male' },
];

const BUSINESS_TYPES = [
  { id: 'general', label: 'General Business' },
  { id: 'medical', label: 'Medical / Healthcare' },
  { id: 'dental', label: 'Dental Office' },
  { id: 'legal', label: 'Law Firm / Legal' },
  { id: 'real_estate', label: 'Real Estate' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'automotive', label: 'Automotive / Repair' },
  { id: 'restaurant', label: 'Restaurant / Food' },
  { id: 'salon', label: 'Salon / Spa' },
  { id: 'fitness', label: 'Fitness / Gym' },
  { id: 'home_services', label: 'Home Services / HVAC' },
  { id: 'financial', label: 'Financial Services' },
  { id: 'saas', label: 'SaaS / Tech' },
  { id: 'ecommerce', label: 'E-Commerce' },
  { id: 'agency', label: 'Agency / Consulting' },
  { id: 'nonprofit', label: 'Non-Profit' },
];

const ROLES = [
  'Receptionist', 'Sales Specialist', 'Intake Coordinator', 'Appointment Scheduler',
  'Patient Coordinator', 'Customer Support', 'Lead Qualifier', 'Account Manager',
  'Virtual Assistant', 'Concierge',
];

const OBJECTIVES = [
  { id: 'book_call', label: 'Book Appointment / Call' },
  { id: 'intake', label: 'Intake / Collect Information' },
  { id: 'qualify', label: 'Qualify Lead' },
  { id: 'support', label: 'Customer Support' },
  { id: 'follow_up', label: 'Follow-Up' },
  { id: 'appointment', label: 'Schedule Appointment' },
];

const TEMPLATES: Record<string, Partial<typeof EMPTY_AGENT>> = {
  medical: {
    name: 'Sarah',
    role: 'Patient Coordinator',
    business_type: 'medical',
    greeting: "Hi, thank you for calling {business_name}. This is {name}, how can I help you today?",
    instructions: `You are a patient coordinator at a medical facility. Your role is to:\n1. Greet callers warmly and professionally\n2. Determine the nature of their call (new patient, existing patient, scheduling, prescription refill, billing)\n3. For new patients: collect their name, DOB, insurance info, and reason for visit, then schedule an appointment\n4. For existing patients: verify their identity, then help with their request\n5. For emergencies: advise them to call 911 or go to the nearest ER immediately\n6. Always be HIPAA-compliant — never share patient information with unauthorized callers\n7. If you cannot help with a request, transfer to the appropriate department`,
    knowledge_base: '',
    transfer_rules: [
      { id: '1', trigger: 'billing question', phone: '', description: 'Billing Department', transfer_message: "Let me connect you with our billing department right away." },
      { id: '2', trigger: 'emergency', phone: '', description: 'On-Call Nurse', transfer_message: "I'm going to connect you with our on-call nurse immediately." },
      { id: '3', trigger: 'speak to doctor', phone: '', description: "Doctor's Office", transfer_message: "Let me transfer you to the doctor's office." },
    ],
    operating_hours: 'Monday-Friday 8:00 AM - 5:00 PM, Saturday 9:00 AM - 12:00 PM',
    end_call_message: "Thank you for calling {business_name}. We look forward to seeing you. Have a great day!",
  },
  dental: {
    name: 'Emily',
    role: 'Appointment Scheduler',
    business_type: 'dental',
    greeting: "Good morning, thank you for calling {business_name}. This is {name}, how may I assist you?",
    instructions: `You are a dental office receptionist. Your role is to:\n1. Help patients schedule, reschedule, or cancel appointments\n2. For new patients: collect name, DOB, insurance, and what they need (cleaning, emergency, cosmetic)\n3. Explain available appointment slots and dentist availability\n4. Remind callers about any prep needed for their appointment\n5. Handle insurance verification questions (direct complex ones to billing)\n6. For dental emergencies: triage urgency and get them in ASAP or advise going to ER`,
    operating_hours: 'Monday-Thursday 7:30 AM - 5:00 PM, Friday 8:00 AM - 2:00 PM',
  },
  legal: {
    name: 'Michael',
    role: 'Intake Coordinator',
    business_type: 'legal',
    voice: 'josh',
    greeting: "Thank you for calling {business_name}. This is {name}. How can I help you today?",
    instructions: `You are a legal intake coordinator. Your role is to:\n1. Determine what type of legal matter the caller needs help with\n2. Collect basic information: name, contact info, brief description of their situation\n3. Determine if this is within the firm's practice areas\n4. Schedule a consultation if appropriate\n5. Never provide legal advice — only collect information and schedule consultations\n6. Be empathetic — many callers are going through difficult situations\n7. Maintain strict confidentiality`,
    operating_hours: 'Monday-Friday 9:00 AM - 6:00 PM',
  },
  saas: {
    name: 'Alex',
    role: 'Sales Specialist',
    business_type: 'saas',
    greeting: "Hey! This is {name} from {business_name}. I noticed you were checking out our platform — do you have a quick minute?",
    instructions: `You are an outbound sales specialist. Your role is to:\n1. Engage prospects who visited the website or showed interest\n2. Understand their current pain points and needs\n3. Briefly explain how the product can help (don't pitch too hard)\n4. Book a demo or discovery call\n5. Handle objections gracefully — address concerns about pricing, timing, competition\n6. If they're not interested, thank them and move on gracefully`,
  },
};

// ── Main component ──

interface Props {
  onBack?: () => void;
}

export function AIAgentConfig({ onBack }: Props) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Partial<AIAgent>>({ ...EMPTY_AGENT });
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['identity', 'greeting', 'instructions']));
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newQQ, setNewQQ] = useState('');
  
  // ── Voice Preview ──
  const [availableVoices, setAvailableVoices] = useState<any[]>(VOICES);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── API helpers ──

  const api = useCallback(async (path: string, method = 'GET', body?: any) => {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f${path}`,
      {
        method,
        headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
        body: body ? JSON.stringify(body) : undefined,
      }
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(errData.error || 'Request failed');
    }
    return res.json();
  }, []);

  // ── Load agents & voices ──

  useEffect(() => {
    loadAgents();
    loadVoices();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  async function loadVoices() {
    try {
      const data = await api('/elevenlabs/voices/recommended');
      if (data.voices && data.voices.length > 0) {
        const mapped = data.voices.map((v: any) => ({
          id: v.voice_id,
          label: v.name,
          desc: v.labels?.use_case || v.labels?.description || 'AI Voice',
          preview_url: v.preview_url,
          gender: v.labels?.gender || 'neutral'
        }));
        setAvailableVoices(mapped);
        
        // If draft voice isn't in the loaded list, you might optionally want to check that, 
        // but it's fine for now since the user can select it.
      }
    } catch (err) {
      console.warn('Could not load ElevenLabs voices, falling back to defaults:', err);
    }
  }

  async function playVoicePreview(voice: any, e: React.MouseEvent) {
    e.stopPropagation(); // prevent selecting if they just want to play
    if (playingVoice === voice.id) {
      audioRef.current?.pause();
      setPlayingVoice(null);
      return;
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    try {
      if (voice.preview_url) {
        const audio = new Audio(voice.preview_url);
        audioRef.current = audio;
        audio.onended = () => setPlayingVoice(null);
        await audio.play();
        setPlayingVoice(voice.id);
      } else {
        // Fallback to TTS generation
        setPlayingVoice(voice.id);
        const data = await api('/elevenlabs/preview', 'POST', {
          text: draft.greeting || "Hi, I'm your AI assistant. How can I help you today?",
          voiceId: voice.id,
          provider: 'elevenlabs'
        });
        
        if (data.audio) {
          const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
          audioRef.current = audio;
          audio.onended = () => setPlayingVoice(null);
          await audio.play();
        } else {
          setPlayingVoice(null);
        }
      }
    } catch (err) {
      console.error('Failed to play preview:', err);
      setPlayingVoice(null);
    }
  }

  async function loadAgents() {
    setLoading(true);
    try {
      const data = await api('/ai-agents');
      setAgents(data.agents || []);
    } catch (err: any) {
      console.error('Failed to load agents:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Save agent ──

  async function saveAgent() {
    setSaving(true);
    setError(null);
    try {
      if (selectedAgent) {
        const data = await api(`/ai-agents/${selectedAgent.id}`, 'PUT', draft);
        setAgents(prev => prev.map(a => a.id === selectedAgent.id ? data.agent : a));
        setSelectedAgent(data.agent);
      } else {
        const data = await api('/ai-agents', 'POST', draft);
        setAgents(prev => [...prev, data.agent]);
        setSelectedAgent(data.agent);
      }
      setEditMode(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Delete agent ──

  async function deleteAgent(agentId: string) {
    if (!confirm(t('aiCalls.agentPanel.deleteConfirm'))) return;
    try {
      await api(`/ai-agents/${agentId}`, 'DELETE');
      setAgents(prev => prev.filter(a => a.id !== agentId));
      if (selectedAgent?.id === agentId) {
        setSelectedAgent(null);
        setEditMode(false);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  // ── Start editing / creating ──

  function startCreate() {
    setSelectedAgent(null);
    setDraft({ ...EMPTY_AGENT });
    setEditMode(true);
    setExpandedSections(new Set(['identity', 'greeting', 'instructions']));
  }

  function startEdit(agent: AIAgent) {
    setSelectedAgent(agent);
    setDraft({ ...agent });
    setEditMode(true);
    setExpandedSections(new Set(['identity', 'greeting', 'instructions']));
  }

  function applyTemplate(templateKey: string) {
    const tmpl = TEMPLATES[templateKey];
    if (!tmpl) return;
    setDraft(prev => ({
      ...prev,
      ...tmpl,
      business_name: prev.business_name || '', // Don't overwrite user's business name
      transfer_rules: (tmpl.transfer_rules || []).map(r => ({ ...r, id: crypto.randomUUID() })),
    }));
  }

  // ── Transfer rule helpers ──

  function addTransferRule() {
    const rules = [...(draft.transfer_rules || [])];
    rules.push({ id: crypto.randomUUID(), trigger: '', phone: '', description: '', transfer_message: '' });
    setDraft(prev => ({ ...prev, transfer_rules: rules }));
  }

  function updateTransferRule(id: string, field: string, value: string) {
    const rules = (draft.transfer_rules || []).map(r =>
      r.id === id ? { ...r, [field]: value } : r
    );
    setDraft(prev => ({ ...prev, transfer_rules: rules }));
  }

  function removeTransferRule(id: string) {
    setDraft(prev => ({ ...prev, transfer_rules: (prev.transfer_rules || []).filter(r => r.id !== id) }));
  }

  // ── Section toggle ──

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // ── Replace template vars ──

  function previewText(text: string) {
    return text
      .replace(/\{name\}/g, draft.name || 'AI')
      .replace(/\{business_name\}/g, draft.business_name || 'Your Business')
      .replace(/\{role\}/g, draft.role || 'Assistant');
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  // ── Agent list view ──
  if (!editMode) {
    return (
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {onBack && (
              <button onClick={onBack} className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex-shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-[#1ED4A7] flex-shrink-0" />
                <span className="truncate">{t('aiCalls.agentPanel.title')}</span>
              </h2>
              <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5">{t('aiCalls.agentPanel.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-zinc-900 dark:bg-white hover:bg-zinc-700 dark:hover:bg-zinc-200 text-white dark:text-black text-xs sm:text-sm font-medium rounded-lg transition-colors flex-shrink-0"
          >
            <Plus className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
            <span className="hidden xs:inline">{t('aiCalls.agentPanel.newAgent')}</span>
            <span className="xs:hidden">{t('aiCalls.new')}</span>
          </button>
        </div>

        {saveSuccess && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg text-sm text-[#1ED4A7]">
            <CheckCircle2 className="w-4 h-4" />
            {t('aiCalls.agentPanel.savedSuccess')}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Agent cards */}
        {agents.length === 0 ? (
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <div className="text-center py-12 sm:py-20 px-4 sm:px-6">
              <div className="w-12 sm:w-14 h-12 sm:h-14 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/50 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                <Bot className="w-6 sm:w-7 h-6 sm:h-7 text-zinc-500" />
              </div>
              <p className="text-zinc-700 dark:text-zinc-300 font-semibold mb-1">{t('aiCalls.agentPanel.noAgents')}</p>
              <p className="text-xs text-zinc-500 mb-5 max-w-xs mx-auto">{t('aiCalls.agentPanel.noAgentsDesc')}</p>
              <button
                onClick={startCreate}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-900 dark:text-white text-sm font-medium rounded-lg transition-all"
              >
                <Plus className="w-4 h-4" />
                {t('aiCalls.agentPanel.createAgent')}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {agents.map(agent => (
              <div
                key={agent.id}
                className="group relative bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-xl p-4 transition-all cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-900/60"
                onClick={() => startEdit(agent)}
              >
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    agent.is_default ? 'bg-[#1ED4A7]/15 border border-[#1ED4A7]/30' : 'bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700'
                  }`}>
                    <Bot className={`w-5 h-5 ${agent.is_default ? 'text-[#1ED4A7]' : 'text-zinc-500 dark:text-zinc-400'}`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-white truncate">{agent.name || t('aiCalls.agentPanel.unnamed')}</h3>
                      {agent.is_default && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-[#1ED4A7]/10 text-[#1ED4A7] rounded">{t('aiCalls.agentPanel.default')}</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 truncate">
                      {agent.role} {agent.business_name ? `at ${agent.business_name}` : ''}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-600">
                        <Volume2 className="w-3 h-3" />
                        {VOICES.find(v => v.id === agent.voice)?.label || agent.voice}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-600">
                        <Building2 className="w-3 h-3" />
                        {BUSINESS_TYPES.find(b => b.id === agent.business_type)?.label || 'General'}
                      </span>
                      {agent.transfer_rules?.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-600">
                          <PhoneForwarded className="w-3 h-3" />
                          {agent.transfer_rules.length} transfer{agent.transfer_rules.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(agent); }}
                      className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Edit / Create view ──

  const SectionHeader = ({ id, icon: Icon, title, subtitle }: { id: string; icon: any; title: string; subtitle?: string }) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center gap-3 py-3 text-left group"
    >
      <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition-colors">
        <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</span>
        {subtitle && <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5">{subtitle}</p>}
      </div>
      {expandedSections.has(id) ? <ChevronDown className="w-4 h-4 text-zinc-400 dark:text-zinc-600" /> : <ChevronRight className="w-4 h-4 text-zinc-400 dark:text-zinc-600" />}
    </button>
  );

  const inputCls = "w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#1ED4A7]/50 focus:ring-1 focus:ring-[#1ED4A7]/20 transition-all";
  const selectCls = `${inputCls} appearance-none cursor-pointer`;
  const textareaCls = `${inputCls} resize-none`;
  const labelCls = "block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => { setEditMode(false); setSelectedAgent(null); }}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white truncate">
              {selectedAgent ? t('aiCalls.agentPanel.editAgent') : t('aiCalls.agentPanel.newAgentTitle')}
            </h2>
            <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5 truncate">
              {selectedAgent ? t('aiCalls.agentPanel.editing', { name: selectedAgent.name }) : t('aiCalls.agentPanel.configureAgent')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <button
            onClick={() => { setEditMode(false); setSelectedAgent(null); }}
            className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            {t('aiCalls.agentPanel.cancel')}
          </button>
          <button
            onClick={saveAgent}
            disabled={saving || !draft.name}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 bg-zinc-900 dark:bg-white hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed text-white dark:text-black text-xs sm:text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span className="hidden xs:inline">{saving ? t('aiCalls.agentPanel.saving') : t('aiCalls.agentPanel.saveAgent')}</span>
            <span className="xs:hidden">{saving ? '...' : t('aiCalls.agentPanel.save')}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto p-0.5 hover:text-red-300"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Quick templates */}
      {!selectedAgent && (
        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2.5 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#1ED4A7]" />
            {t('aiCalls.agentPanel.quickStartTemplates')}
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'medical', label: 'Medical Facility', icon: Building2 },
              { key: 'dental', label: 'Dental Office', icon: Shield },
              { key: 'legal', label: 'Law Firm', icon: BookOpen },
              { key: 'saas', label: 'SaaS / Tech Sales', icon: Zap },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => applyTemplate(t.key)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 rounded-full text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-all"
              >
                <t.icon className="w-3.5 h-3.5 text-zinc-500" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Form sections */}
      <div className="space-y-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl divide-y divide-zinc-200 dark:divide-zinc-800/50">

        {/* ── Identity ── */}
        <div className="px-3 sm:px-4">
          <SectionHeader id="identity" icon={Bot} title={t('aiCalls.agentPanel.agentIdentity')} subtitle={t('aiCalls.agentPanel.identitySubtitle')} />
          {expandedSections.has('identity') && (
            <div className="pb-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.agentName')}</label>
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="e.g. Sarah, Alex"
                    value={draft.name || ''}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.role')}</label>
                  <select className={selectCls} value={draft.role || ''} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    <option value="custom">Custom...</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.businessName')}</label>
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="e.g. Miami Medical Center"
                    value={draft.business_name || ''}
                    onChange={e => setDraft(d => ({ ...d, business_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.businessType')}</label>
                  <select className={selectCls} value={draft.business_type || 'general'} onChange={e => setDraft(d => ({ ...d, business_type: e.target.value }))}>
                    {BUSINESS_TYPES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.businessPhone')}</label>
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="+1 (305) 555-0100"
                    value={draft.business_phone || ''}
                    onChange={e => setDraft(d => ({ ...d, business_phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.operatingHours')}</label>
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="Mon-Fri 8AM-5PM"
                    value={draft.operating_hours || ''}
                    onChange={e => setDraft(d => ({ ...d, operating_hours: e.target.value }))}
                  />
                </div>
              </div>

              {/* Voice selection */}
              <div>
                <label className={labelCls}>{t('aiCalls.agentPanel.voice')}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-[300px] overflow-y-auto p-1 pr-2 custom-scrollbar">
                  {availableVoices.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setDraft(d => ({ ...d, voice: v.id }))}
                      className={`p-2.5 sm:p-3 rounded-lg border text-center transition-all relative group ${
                        draft.voice === v.id
                          ? 'border-[#1ED4A7]/50 bg-[#1ED4A7]/5'
                          : 'border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-600'
                      }`}
                    >
                      <button
                        onClick={(e) => playVoicePreview(v, e)}
                        className={`absolute top-1.5 right-1.5 p-1 rounded-full bg-white dark:bg-black shadow-sm border border-zinc-200 dark:border-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity ${playingVoice === v.id ? 'opacity-100' : ''}`}
                      >
                        {playingVoice === v.id ? (
                          <Loader2 className="w-3 h-3 text-[#1ED4A7] animate-spin" />
                        ) : (
                          <Play className="w-3 h-3 text-zinc-500" />
                        )}
                      </button>
                      <div className={`text-xs font-bold mb-0.5 ${draft.voice === v.id ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}`}>
                        {v.label}
                      </div>
                      <div className="text-[10px] text-zinc-500 leading-tight truncate">{v.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Default toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`w-9 h-5 rounded-full transition-colors relative ${draft.is_default ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                  onClick={() => setDraft(d => ({ ...d, is_default: !d.is_default }))}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${draft.is_default ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <div>
                  <span className="text-sm text-zinc-900 dark:text-white font-medium">{t('aiCalls.agentPanel.setAsDefault')}</span>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-600">{t('aiCalls.agentPanel.defaultDesc')}</p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* ── Greeting ── */}
        <div className="px-3 sm:px-4">
          <SectionHeader id="greeting" icon={MessageSquare} title={t('aiCalls.agentPanel.greetingOpening')} subtitle={t('aiCalls.agentPanel.greetingSubtitle')} />
          {expandedSections.has('greeting') && (
            <div className="pb-4 space-y-3">
              <div>
                <label className={labelCls}>
                  {t('aiCalls.agentPanel.openingGreeting')}
                  <span className="text-zinc-400 dark:text-zinc-600 ml-1">{t('aiCalls.agentPanel.placeholderNote')}</span>
                </label>
                <textarea
                  className={textareaCls}
                  rows={3}
                  placeholder="Hi, thank you for calling {business_name}. This is {name}, how can I help you today?"
                  value={draft.greeting || ''}
                  onChange={e => setDraft(d => ({ ...d, greeting: e.target.value }))}
                />
                {draft.greeting && (
                  <div className="mt-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700/50">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mb-1">{t('aiCalls.agentPanel.preview')}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 italic">"{previewText(draft.greeting)}"</p>
                  </div>
                )}
              </div>

              <div>
                <label className={labelCls}>{t('aiCalls.agentPanel.endCallMessage')}</label>
                <textarea
                  className={textareaCls}
                  rows={2}
                  placeholder="Thank you for calling {business_name}. Have a great day!"
                  value={draft.end_call_message || ''}
                  onChange={e => setDraft(d => ({ ...d, end_call_message: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelCls}>{t('aiCalls.agentPanel.voicemailMessage')}</label>
                <textarea
                  className={textareaCls}
                  rows={2}
                  placeholder="Hi, this is {name} calling from {business_name}. I was reaching out regarding..."
                  value={draft.voicemail_message || ''}
                  onChange={e => setDraft(d => ({ ...d, voicemail_message: e.target.value }))}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Instructions ── */}
        <div className="px-3 sm:px-4">
          <SectionHeader id="instructions" icon={Brain} title={t('aiCalls.agentPanel.instructionsBehavior')} subtitle={t('aiCalls.agentPanel.instructionsSubtitle')} />
          {expandedSections.has('instructions') && (
            <div className="pb-4 space-y-3">
              <div>
                <label className={labelCls}>
                  {t('aiCalls.agentPanel.agentInstructions')}
                  <span className="text-zinc-400 dark:text-zinc-600 ml-1 hidden sm:inline">{t('aiCalls.agentPanel.instructionsNote')}</span>
                </label>
                <textarea
                  className={textareaCls}
                  rows={8}
                  placeholder={`Example for a medical office:\n\n1. Greet callers warmly and professionally\n2. Determine the nature of their call (new patient, existing patient, scheduling, billing)\n3. For new patients: collect name, DOB, insurance info, and reason for visit\n4. For existing patients: verify identity, then help with their request\n5. For emergencies: advise calling 911 immediately\n6. If you can't help, transfer to the right department`}
                  value={draft.instructions || ''}
                  onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))}
                />
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-1">
                  {t('aiCalls.agentPanel.instructionsDetail')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.maxConversationTurns')}</label>
                  <input
                    type="number"
                    className={inputCls}
                    min={4}
                    max={30}
                    value={draft.max_turns ?? 12}
                    onChange={e => setDraft(d => ({ ...d, max_turns: parseInt(e.target.value) || 12 }))}
                  />
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-1">{t('aiCalls.agentPanel.turnsNote')}</p>
                </div>
                <div>
                  <label className={labelCls}>{t('aiCalls.agentPanel.ifUnresponsive')}</label>
                  <select className={selectCls} value={draft.fallback_action || 'email'} onChange={e => setDraft(d => ({ ...d, fallback_action: e.target.value }))}>
                    <option value="email">{t('aiCalls.agentPanel.followUpEmail')}</option>
                    <option value="voicemail">{t('aiCalls.agentPanel.leaveVoicemail')}</option>
                    <option value="transfer">{t('aiCalls.agentPanel.transferToHuman')}</option>
                    <option value="hangup">{t('aiCalls.agentPanel.endCallGracefully')}</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Knowledge Base ── */}
        <div className="px-3 sm:px-4">
          <SectionHeader id="knowledge" icon={BookOpen} title={t('aiCalls.agentPanel.knowledgeBase')} subtitle={t('aiCalls.agentPanel.knowledgeSubtitle')} />
          {expandedSections.has('knowledge') && (
            <div className="pb-4 space-y-3">
              <div>
                <label className={labelCls}>
                  {t('aiCalls.agentPanel.knowledgeFaq')}
                  <span className="text-zinc-400 dark:text-zinc-600 ml-1">{t('aiCalls.agentPanel.knowledgePaste')}</span>
                </label>
                <textarea
                  className={textareaCls}
                  rows={10}
                  placeholder={`Example for a medical office:\n\nSERVICES:\n- Primary care visits: $150 (with insurance copay varies)\n- Annual physicals: covered by most insurance\n- Lab work: in-house, results within 24-48 hours\n- Telehealth visits available for follow-ups\n\nINSURANCE:\n- We accept Aetna, Blue Cross, Cigna, United, Medicare\n- Self-pay patients receive 15% discount\n\nFAQs:\n- New patient forms can be completed online at our website\n- We require 24-hour notice for cancellations\n- Prescription refills require 48-hour advance notice`}
                  value={draft.knowledge_base || ''}
                  onChange={e => setDraft(d => ({ ...d, knowledge_base: e.target.value }))}
                />
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-1">
                  {t('aiCalls.agentPanel.knowledgeDetail')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Transfer Rules ── */}
        <div className="px-3 sm:px-4">
          <SectionHeader id="transfers" icon={PhoneForwarded} title={t('aiCalls.agentPanel.transferRules')} subtitle={t('aiCalls.agentPanel.transferSubtitle')} />
          {expandedSections.has('transfers') && (
            <div className="pb-4 space-y-3">
              <p className="text-xs text-zinc-500">
                {t('aiCalls.agentPanel.transferDesc')}
              </p>

              {(draft.transfer_rules || []).map((rule, idx) => (
                <div key={rule.id} className="bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-700/50 rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{t('aiCalls.agentPanel.rule', { num: idx + 1 })}</span>
                    <button onClick={() => removeTransferRule(rule.id)} className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">{t('aiCalls.agentPanel.whenCallerSays')}</label>
                      <input
                        className={inputCls}
                        placeholder="e.g. billing question"
                        value={rule.trigger}
                        onChange={e => updateTransferRule(rule.id, 'trigger', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">{t('aiCalls.agentPanel.transferToPhone')}</label>
                      <input
                        className={inputCls}
                        placeholder="+1 (305) 555-0200"
                        value={rule.phone}
                        onChange={e => updateTransferRule(rule.id, 'phone', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">{t('aiCalls.agentPanel.departmentPerson')}</label>
                      <input
                        className={inputCls}
                        placeholder="e.g. Billing Department"
                        value={rule.description}
                        onChange={e => updateTransferRule(rule.id, 'description', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">{t('aiCalls.agentPanel.transferMessage')}</label>
                      <input
                        className={inputCls}
                        placeholder="Let me connect you..."
                        value={rule.transfer_message}
                        onChange={e => updateTransferRule(rule.id, 'transfer_message', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={addTransferRule}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 rounded-lg text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-all w-full justify-center"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('aiCalls.agentPanel.addTransferRule')}
              </button>
            </div>
          )}
        </div>

        {/* ── Qualification Questions ── */}
        <div className="px-3 sm:px-4">
          <SectionHeader id="qualification" icon={HelpCircle} title={t('aiCalls.agentPanel.qualificationQuestions')} subtitle={t('aiCalls.agentPanel.qualificationSubtitle')} />
          {expandedSections.has('qualification') && (
            <div className="pb-4 space-y-3">
              <p className="text-xs text-zinc-500">
                {t('aiCalls.agentPanel.qualificationDesc')}
              </p>

              {(draft.qualification_questions || []).map((q, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-600 w-5 text-right flex-shrink-0">{idx + 1}.</span>
                  <input
                    className={`${inputCls} flex-1`}
                    value={q}
                    onChange={e => {
                      const qs = [...(draft.qualification_questions || [])];
                      qs[idx] = e.target.value;
                      setDraft(d => ({ ...d, qualification_questions: qs }));
                    }}
                  />
                  <button
                    onClick={() => {
                      const qs = (draft.qualification_questions || []).filter((_, i) => i !== idx);
                      setDraft(d => ({ ...d, qualification_questions: qs }));
                    }}
                    className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="e.g. What insurance provider do you have?"
                  value={newQQ}
                  onChange={e => setNewQQ(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newQQ.trim()) {
                      setDraft(d => ({ ...d, qualification_questions: [...(d.qualification_questions || []), newQQ.trim()] }));
                      setNewQQ('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newQQ.trim()) {
                      setDraft(d => ({ ...d, qualification_questions: [...(d.qualification_questions || []), newQQ.trim()] }));
                      setNewQQ('');
                    }
                  }}
                  className="p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors flex-shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIAgentConfig;