import { useState, useRef, useEffect } from 'react';
import { 
  X, 
  ArrowRight, 
  ArrowLeft, 
  Check,
  Building2,
  MapPin,
  Tag,
  Users,
  Upload,
  Mail,
  User,
  Mic,
  Volume2,
  Zap,
  Clock,
  Calendar,
  Globe,
  Shield,
  Target,
  MessageSquare,
  AlertCircle,
  Play,
  Search,
  Filter,
  Loader2,
  Bot
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { fmtUSDCents } from '../lib/format';
import { useTranslation } from 'react-i18next';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';

interface AICallCampaignBuilderProps {
  onClose: () => void;
  preselectedLeadIds?: string[];
  editingCampaign?: any | null;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type IntentTriggerMode = 'known_campaign_visitor' | 'form_request' | 'high_intent_company';

interface IntentTriggerConfig {
  enabled: boolean;
  mode: IntentTriggerMode;
  threshold: number;
  delayMinutes: number;
  pages: string[];
  requireKnownLead: boolean;
  requireConsent: boolean;
  formEnabled: boolean;
  formFields: string[];
  consentText: string;
  cooldownHours: number;
  maxDailyCalls: number;
}

interface CampaignData {
  name: string;
  brand: string;
  customBrandName?: string;
  targetAudience: string;
  tags: string[];
  location: string;
  locationCoordinates?: string;
  objective: 'book_call' | 'send_link' | 'qualify' | 'warm_transfer';
  leadSource: 'crm' | 'csv' | 'email_campaign';
  selectedLeads: string[];
  emailCampaignFilter?: { campaignId: string; activity: 'opened' | 'clicked' | 'replied' };
  aiName: string;
  aiRole: string;
  brandTone: 'friendly' | 'professional' | 'confident' | 'direct';
  voiceProvider: 'telnyx' | 'elevenlabs';
  voiceId: string;
  elevenlabsAgentId?: string;
  customAgentId?: string;
  speakingSpeed: number;
  emotionLevel: number;
  maxDuration: number;
  allowInterruptions: boolean;
  humanTransfer: boolean;
  voicemailAction: 'leave' | 'skip';
  notInterestedAction: 'tag' | 'stop';
  openingLine: string;
  qualificationQuestions: string[];
  valuePitch: string;
  objectionHandling: { objection: string; response: string }[];
  closeAction: string;
  callingDays: string[];
  callingHours: { start: string; end: string };
  maxAttempts: number;
  delayBetweenAttempts: number;
  timezoneDetection: boolean;
  intentTrigger: IntentTriggerConfig;
  instructions?: string;
  knowledgeBase?: string;
  transferRules?: any[];
  maxTurns?: number;
}

interface LocationSuggestion {
  place_name: string;
  center: [number, number];
  text: string;
}

const AUDIENCE_SUGGESTIONS = [
  'Auto repair shop','Car dealership','Mechanic','Body shop','Tire shop','Oil change',
  'Restaurant','Cafe','Coffee shop','Bar','Pizza restaurant','Italian restaurant',
  'Mexican restaurant','Fast food','Bakery','Hotel','Gym','Fitness center',
  'Yoga studio','Spa','Salon','Barber shop','Dentist','Doctor','Veterinarian',
  'Pet store','Real estate agent','Law firm','Accounting firm','Insurance agency',
  'Plumber','Electrician','Contractor','Roofing company','Landscaping','Cleaning service',
];

interface ElevenLabsVoice {
  id: string;
  name: string;
  category: string;
  previewUrl: string;
  description: string;
  gender?: string;
  age?: string;
  accent?: string;
  isCloned?: boolean;
  highQuality?: boolean;
}

interface ElevenLabsAgent {
  agent_id: string;
  name: string;
  conversation_config?: any;
  metadata?: any;
  created_at?: number;
}

// ── Shared style constants ──
const INPUT_CLS = "w-full px-3 py-2 sm:py-2.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors";
const LABEL_CLS = "block text-[11px] sm:text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5 sm:mb-2";
const CARD_SELECTED = "border-[#1ED4A7]/60 bg-[#1ED4A7]/5";
const CARD_DEFAULT = "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700";

const DEFAULT_INTENT_TRIGGER: IntentTriggerConfig = {
  enabled: false,
  mode: 'known_campaign_visitor',
  threshold: 75,
  delayMinutes: 2,
  pages: ['pricing', 'demo', 'contact'],
  requireKnownLead: true,
  requireConsent: true,
  formEnabled: true,
  formFields: ['name', 'email', 'phone', 'company'],
  consentText: 'I agree to receive an immediate call from Contndr about my request.',
  cooldownHours: 24,
  maxDailyCalls: 25,
};

const normalizeIntentTriggerForState = (raw?: any): IntentTriggerConfig => {
  if (!raw) return { ...DEFAULT_INTENT_TRIGGER };
  return {
    ...DEFAULT_INTENT_TRIGGER,
    enabled: Boolean(raw.enabled),
    mode: (raw.mode || DEFAULT_INTENT_TRIGGER.mode) as IntentTriggerMode,
    threshold: Number(raw.threshold ?? DEFAULT_INTENT_TRIGGER.threshold),
    delayMinutes: Number(raw.delay_minutes ?? raw.delayMinutes ?? DEFAULT_INTENT_TRIGGER.delayMinutes),
    pages: Array.isArray(raw.pages) && raw.pages.length ? raw.pages : DEFAULT_INTENT_TRIGGER.pages,
    requireKnownLead: raw.require_known_lead ?? raw.requireKnownLead ?? DEFAULT_INTENT_TRIGGER.requireKnownLead,
    requireConsent: raw.require_consent ?? raw.requireConsent ?? DEFAULT_INTENT_TRIGGER.requireConsent,
    formEnabled: raw.form_enabled ?? raw.formEnabled ?? DEFAULT_INTENT_TRIGGER.formEnabled,
    formFields: Array.isArray(raw.form_fields || raw.formFields) ? (raw.form_fields || raw.formFields) : DEFAULT_INTENT_TRIGGER.formFields,
    consentText: raw.consent_text || raw.consentText || DEFAULT_INTENT_TRIGGER.consentText,
    cooldownHours: Number(raw.cooldown_hours ?? raw.cooldownHours ?? DEFAULT_INTENT_TRIGGER.cooldownHours),
    maxDailyCalls: Number(raw.max_daily_calls ?? raw.maxDailyCalls ?? DEFAULT_INTENT_TRIGGER.maxDailyCalls),
  };
};

const toIntentTriggerPayload = (trigger?: IntentTriggerConfig) => {
  const normalized = normalizeIntentTriggerForState(trigger);
  return {
    enabled: normalized.enabled,
    mode: normalized.mode,
    threshold: normalized.threshold,
    delay_minutes: normalized.delayMinutes,
    pages: normalized.pages,
    require_known_lead: normalized.requireKnownLead,
    require_consent: normalized.requireConsent,
    form_enabled: normalized.formEnabled,
    form_fields: normalized.formFields,
    consent_text: normalized.consentText,
    cooldown_hours: normalized.cooldownHours,
    max_daily_calls: normalized.maxDailyCalls,
    plan_gate: 'scale_enterprise',
  };
};

export function AICallCampaignBuilder({ onClose, preselectedLeadIds, editingCampaign }: AICallCampaignBuilderProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [availableVoices, setAvailableVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [scheduleValue, setScheduleValue] = useState<ScheduleValue>(() => {
    const scheduledAt = editingCampaign?.scheduled_at || editingCampaign?.scheduled_time || editingCampaign?.schedule?.scheduled_at;
    if (editingCampaign?.status === 'scheduled' && scheduledAt) {
      const scheduledDate = new Date(scheduledAt);
      if (!Number.isNaN(scheduledDate.getTime())) return { mode: 'scheduled', scheduledDate };
    }
    return { mode: 'now' };
  });
  const [availableAgents, setAvailableAgents] = useState<ElevenLabsAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<any>(null);

  const getInitialCampaignData = (): Partial<CampaignData> => {
    if (editingCampaign) {
      return {
        name: editingCampaign.name || '',
        brand: editingCampaign.brand || 'contndr',
        customBrandName: editingCampaign.custom_brand_name,
        targetAudience: editingCampaign.target_audience || '',
        tags: editingCampaign.tags || [],
        location: editingCampaign.location || '',
        locationCoordinates: editingCampaign.location_coordinates,
        objective: editingCampaign.objective || 'book_call',
        leadSource: editingCampaign.lead_source || 'crm',
        selectedLeads: editingCampaign.selected_leads || [],
        emailCampaignFilter: editingCampaign.email_campaign_filter,
        aiName: editingCampaign.ai_name || 'Alex',
        aiRole: editingCampaign.ai_role || 'Sales Specialist',
        brandTone: editingCampaign.brand_tone || 'professional',
        voiceProvider: editingCampaign.voice_provider || 'elevenlabs',
        voiceId: editingCampaign.voice_id || '',
        elevenlabsAgentId: editingCampaign.elevenlabs_agent_id || undefined,
        customAgentId: editingCampaign.custom_agent_id || undefined,
        speakingSpeed: editingCampaign.speaking_speed || 1.0,
        emotionLevel: editingCampaign.emotion_level || 0.5,
        maxDuration: editingCampaign.max_duration || 300,
        allowInterruptions: editingCampaign.allow_interruptions !== false,
        humanTransfer: editingCampaign.human_transfer !== false,
        voicemailAction: editingCampaign.voicemail_action || 'leave',
        notInterestedAction: editingCampaign.not_interested_action || 'tag',
        openingLine: editingCampaign.opening_line || '',
        qualificationQuestions: editingCampaign.qualification_questions || [],
        valuePitch: editingCampaign.value_pitch || '',
        objectionHandling: editingCampaign.objection_handling || [],
        closeAction: editingCampaign.close_action || '',
        callingDays: editingCampaign.calling_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        callingHours: editingCampaign.calling_hours || { start: '09:00', end: '17:00' },
        maxAttempts: editingCampaign.max_attempts || 3,
        delayBetweenAttempts: editingCampaign.delay_between_attempts || 24,
        timezoneDetection: editingCampaign.timezone_detection !== false,
        intentTrigger: normalizeIntentTriggerForState(editingCampaign.intent_trigger),
        instructions: editingCampaign.instructions || '',
        knowledgeBase: editingCampaign.knowledge_base || '',
        transferRules: editingCampaign.transfer_rules || [],
        maxTurns: editingCampaign.max_turns || 12,
      };
    }
    return {
      name: '', brand: '', targetAudience: '', tags: [], location: '',
      objective: 'book_call', leadSource: 'crm', selectedLeads: preselectedLeadIds || [],
      aiName: 'Alex', aiRole: 'Sales Specialist', brandTone: 'professional',
      voiceProvider: 'elevenlabs', voiceId: '', speakingSpeed: 1.0, emotionLevel: 0.5,
      maxDuration: 300, allowInterruptions: true, humanTransfer: true,
      voicemailAction: 'leave', notInterestedAction: 'tag',
      openingLine: '',
      qualificationQuestions: [],
      valuePitch: '',
      objectionHandling: [],
      closeAction: '',
      callingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      callingHours: { start: '09:00', end: '17:00' },
      maxAttempts: 3, delayBetweenAttempts: 24, timezoneDetection: true,
      intentTrigger: { ...DEFAULT_INTENT_TRIGGER }
    };
  };

  const [campaignData, setCampaignData] = useState<Partial<CampaignData>>(getInitialCampaignData());
  const updateCampaignData = (updates: Partial<CampaignData>) => setCampaignData(prev => ({ ...prev, ...updates }));

  const createCampaign = async () => {
    setCreating(true);
    try {
      const campaignId = editingCampaign?.id || `ai-call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const isEditing = !!editingCampaign;
      let selectedLeadObjects: any[] = [];
      if (campaignData.leadSource === 'crm' || campaignData.leadSource === 'email_campaign') {
        try {
          const headers = await getAuthHeaders();
          const ids = (campaignData.selectedLeads || []).join(',');
          if (ids) {
            const leadsResponse = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads?ids=${ids}`, { headers });
            if (leadsResponse.ok) {
              const result = await leadsResponse.json();
              selectedLeadObjects = result.leads || [];
            }
          }
        } catch (error) {
          throw new Error('Failed to fetch lead details. Please try again.');
        }
      }
      const campaignPayload = {
        id: campaignId, name: campaignData.name, brand: campaignData.brand,
        custom_brand_name: campaignData.customBrandName, target_audience: campaignData.targetAudience,
        tags: campaignData.tags, location: campaignData.location, location_coordinates: campaignData.locationCoordinates,
        objective: campaignData.objective, lead_source: campaignData.leadSource,
        selected_leads: selectedLeadObjects, total_leads: selectedLeadObjects.length,
        email_campaign_filter: campaignData.emailCampaignFilter, ai_name: campaignData.aiName,
        ai_role: campaignData.aiRole, brand_tone: campaignData.brandTone, voice_provider: campaignData.voiceProvider,
        voice_id: campaignData.voiceId, elevenlabs_agent_id: campaignData.elevenlabsAgentId,
        custom_agent_id: campaignData.customAgentId,
        speaking_speed: campaignData.speakingSpeed,
        emotion_level: campaignData.emotionLevel, max_duration: campaignData.maxDuration,
        allow_interruptions: campaignData.allowInterruptions, human_transfer: campaignData.humanTransfer,
        voicemail_action: campaignData.voicemailAction, not_interested_action: campaignData.notInterestedAction,
        opening_line: campaignData.openingLine, qualification_questions: campaignData.qualificationQuestions,
        value_pitch: campaignData.valuePitch, objection_handling: campaignData.objectionHandling,
        close_action: campaignData.closeAction, calling_days: campaignData.callingDays,
        calling_hours: campaignData.callingHours, max_attempts: campaignData.maxAttempts,
        delay_between_attempts: campaignData.delayBetweenAttempts, timezone_detection: campaignData.timezoneDetection,
        instructions: campaignData.instructions || '',
        knowledge_base: campaignData.knowledgeBase || '',
        transfer_rules: campaignData.transferRules || [],
        max_turns: campaignData.maxTurns || 12,
        intent_trigger: toIntentTriggerPayload(campaignData.intentTrigger),
        schedule: {
          mode: scheduleValue.mode,
          scheduled_at: scheduleValue.mode === 'scheduled' && scheduleValue.scheduledDate
            ? scheduleValue.scheduledDate.toISOString()
            : null,
        },
        scheduled_at: scheduleValue.mode === 'scheduled' && scheduleValue.scheduledDate
          ? scheduleValue.scheduledDate.toISOString()
          : null,
        scheduled_time: scheduleValue.mode === 'scheduled' && scheduleValue.scheduledDate
          ? scheduleValue.scheduledDate.toISOString()
          : null,
        status: isEditing
          ? (scheduleValue.mode === 'scheduled'
              ? 'scheduled'
              : (editingCampaign?.status === 'scheduled' ? 'draft' : editingCampaign?.status || 'draft'))
          : (scheduleValue.mode === 'scheduled' ? 'scheduled' : 'draft'),
        created_at: editingCampaign?.created_at || new Date().toISOString(),
        total_calls: 0, completed_calls: 0, in_progress: 0, booked_meetings: 0
      };
      const url = isEditing
        ? `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-call-campaigns/${campaignId}`
        : `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-call-campaigns`;
      const headers = await getAuthHeaders();
      const response = await fetch(url, { method: isEditing ? 'PUT' : 'POST', headers, body: JSON.stringify(campaignPayload) });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to ${isEditing ? 'update' : 'create'} campaign`);
      }

      if (!isEditing && scheduleValue.mode === 'now') {
        const startResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-call-campaigns/${campaignId}/status`,
          {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' })
          }
        );
        if (!startResponse.ok) {
          const error = await startResponse.json().catch(() => ({}));
          throw new Error(error.error || 'Campaign was created, but AI calling could not be started.');
        }
      }
      onClose();
    } catch (error: any) {
      alert(`Failed: ` + error.message);
    } finally {
      setCreating(false);
    }
  };

  const [customAgents, setCustomAgents] = useState<any[]>([]);
  const [loadingCustomAgents, setLoadingCustomAgents] = useState(false);

  useEffect(() => {
    const fetchCustomAgents = async () => {
      try {
        setLoadingCustomAgents(true);
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agents`,
          { headers: await getAuthHeaders() }
        );
        if (response.ok) {
          const agentsData = await response.json();
          const agents = agentsData.agents || [];
          setCustomAgents(agents);

          // For new campaigns, auto-apply the default agent (or first agent) as a starting point
          if (!editingCampaign && agents.length > 0) {
            const defaultAgent = agents.find((a: any) => a.is_default) || agents[0];
            updateCampaignData({
              customAgentId: defaultAgent.id,
              aiName: defaultAgent.name || 'Alex',
              aiRole: defaultAgent.role || 'Sales Specialist',
              openingLine: defaultAgent.greeting || '',
              qualificationQuestions: defaultAgent.qualification_questions?.length ? defaultAgent.qualification_questions : [],
              instructions: defaultAgent.instructions || '',
              knowledgeBase: defaultAgent.knowledge_base || '',
              transferRules: defaultAgent.transfer_rules || [],
              maxTurns: defaultAgent.max_turns || 12,
            });
          }
        }
      } catch (error) {
        console.warn('Failed to load custom agents', error);
      } finally {
        setLoadingCustomAgents(false);
      }
    };
    fetchCustomAgents();

    const fetchSubscriptionStatus = async () => {
      try {
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/status`,
          { headers: await getAuthHeaders() }
        );
        if (response.ok) {
          setSubscriptionStatus(await response.json());
        }
      } catch (error) {
        console.warn('Failed to load subscription status', error);
      }
    };
    fetchSubscriptionStatus();

    const fetchVoices = async () => {
      try {
        setLoadingVoices(true);
        setVoicesError(null);
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/elevenlabs/voices/recommended`,
          { headers: await getAuthHeaders() }
        );
        if (!response.ok) throw new Error('Failed to fetch voices');
        const data = await response.json();
        if (data.voices?.length > 0) {
          setAvailableVoices(data.voices);
          if (!campaignData.voiceId) updateCampaignData({ voiceId: data.voices[0].id });
        } else {
          setVoicesError('No voices available.');
        }
      } catch (error) {
        setVoicesError('Unable to load voices.');
        setAvailableVoices([]);
      } finally {
        setLoadingVoices(false);
      }
    };
    fetchVoices();

    // Fetch ElevenLabs agents (Pro plan)
    const fetchAgents = async () => {
      try {
        setLoadingAgents(true);
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/elevenlabs/agents`,
          { headers: await getAuthHeaders() }
        );
        if (response.ok) {
          const data = await response.json();
          setAvailableAgents(data.agents || []);
        }
      } catch (error) {
        console.log('Agents not available:', error);
      } finally {
        setLoadingAgents(false);
      }
    };
    fetchAgents();
  }, []);

  const nextStep = () => { if (currentStep < 6) setCurrentStep((currentStep + 1) as Step); };
  const prevStep = () => { if (currentStep > 1) setCurrentStep((currentStep - 1) as Step); };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return campaignData.name && campaignData.brand && campaignData.objective;
      case 2: return campaignData.selectedLeads && campaignData.selectedLeads.length > 0;
      case 3: return campaignData.aiName && campaignData.voiceId;
      case 4: return true;
      case 5: return campaignData.openingLine && campaignData.closeAction;
      case 6: return campaignData.callingDays && campaignData.callingDays.length > 0;
      default: return true;
    }
  };

  const playVoicePreview = (voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    if (playingVoice === voiceId) { setPlayingVoice(null); return; }
    const voice = availableVoices.find(v => v.id === voiceId);
    if (voice?.previewUrl) {
      const audio = new Audio(voice.previewUrl);
      audioRef.current = audio;
      audio.play().then(() => setPlayingVoice(voiceId)).catch(() => setPlayingVoice(null));
      audio.onended = () => setPlayingVoice(null);
    }
  };

  const stepTitles: Record<number, string> = {
    1: t('aiCalls.campaignBuilder.basics'), 2: t('aiCalls.campaignBuilder.leadSource'), 3: t('aiCalls.campaignBuilder.aiConfig'), 4: t('aiCalls.campaignBuilder.rules'), 5: t('aiCalls.campaignBuilder.script'), 6: t('aiCalls.campaignBuilder.schedule')
  };
  const currentPlan = String(subscriptionStatus?.plan || 'none').toLowerCase();
  const canUseIntentTriggers = ['scale', 'enterprise'].includes(currentPlan) || subscriptionStatus?.isWhitelisted === true;

  return (
    <div className="flex flex-col h-full sm:max-h-[88dvh]" style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1.5rem)' }}>
      {/* Mobile drag indicator */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full sm:hidden z-10" />
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-5 pt-6 sm:pt-5 pb-3 sm:pb-4 border-b border-zinc-200 dark:border-zinc-800 relative">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white truncate">
              {editingCampaign ? t('aiCalls.campaignBuilder.editTitle') : t('aiCalls.campaignBuilder.title')}
            </h2>
            <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5">
              {t('aiCalls.campaignBuilder.step', { current: currentStep, total: 6 })} &middot; {stepTitles[currentStep]}
            </p>
          </div>
          <button onClick={onClose} className="flex items-center justify-center p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0 ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((step) => (
            <div
              key={step}
              className={`flex-1 h-1 rounded-full transition-all ${step <= currentStep ? 'bg-[#1ED4A7]' : 'bg-zinc-200 dark:bg-zinc-800'}`}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5">
        {currentStep === 1 && <Step1Basics data={campaignData} update={updateCampaignData} />}
        {currentStep === 2 && <Step2LeadSource data={campaignData} update={updateCampaignData} />}
        {currentStep === 3 && <Step3AIConfiguration data={campaignData} update={updateCampaignData} playingVoice={playingVoice} playVoicePreview={playVoicePreview} availableVoices={availableVoices} loadingVoices={loadingVoices} voicesError={voicesError} availableAgents={availableAgents} loadingAgents={loadingAgents} customAgents={customAgents} loadingCustomAgents={loadingCustomAgents} />}
        {currentStep === 4 && <Step4ConversationRules data={campaignData} update={updateCampaignData} />}
        {currentStep === 5 && <Step5ScriptBuilder data={campaignData} update={updateCampaignData} />}
        {currentStep === 6 && <Step6Scheduling data={campaignData} update={updateCampaignData} scheduleValue={scheduleValue} onScheduleChange={setScheduleValue} canUseIntentTriggers={canUseIntentTriggers} planName={subscriptionStatus?.plan || 'Growth'} />}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 sm:px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t('aiCalls.campaignBuilder.back')}
          </button>

          {currentStep < 6 ? (
            <button
              onClick={nextStep}
              disabled={!canProceed()}
              className="flex items-center gap-1.5 px-4 sm:px-5 py-1.5 sm:py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs sm:text-sm font-medium rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('aiCalls.campaignBuilder.continue')}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={createCampaign}
              disabled={!canProceed() || creating}
              className="flex items-center gap-1.5 px-4 sm:px-5 py-1.5 sm:py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs sm:text-sm font-medium rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{editingCampaign ? 'Updating...' : 'Launching...'}</span></>
              ) : (
                <>{scheduleValue.mode === 'scheduled' ? <Calendar className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{editingCampaign ? 'Update Campaign' : scheduleValue.mode === 'scheduled' ? 'Schedule Campaign' : 'Launch Campaign'}</span>
                <span className="sm:hidden">{editingCampaign ? 'Update' : 'Launch'}</span></>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Campaign Basics ──
function Step1Basics({ data, update }: { data: Partial<CampaignData>; update: (d: Partial<CampaignData>) => void }) {
  const { t } = useTranslation();
  const [audienceSuggestions, setAudienceSuggestions] = useState<string[]>([]);
  const [showAudienceSuggestions, setShowAudienceSuggestions] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const audienceInputRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const audienceSuggestionsRef = useRef<HTMLDivElement>(null);
  const locationSuggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (audienceSuggestionsRef.current && !audienceSuggestionsRef.current.contains(event.target as Node) &&
          audienceInputRef.current && !audienceInputRef.current.contains(event.target as Node)) setShowAudienceSuggestions(false);
      if (locationSuggestionsRef.current && !locationSuggestionsRef.current.contains(event.target as Node) &&
          locationInputRef.current && !locationInputRef.current.contains(event.target as Node)) setShowLocationSuggestions(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (data.targetAudience?.trim()) {
      setAudienceSuggestions(AUDIENCE_SUGGESTIONS.filter(s => s.toLowerCase().includes(data.targetAudience!.toLowerCase())).slice(0, 8));
    } else { setAudienceSuggestions([]); }
  }, [data.targetAudience]);

  useEffect(() => {
    const fetchLocationSuggestions = async () => {
      if (!data.location || data.location.trim().length < 2) { setLocationSuggestions([]); return; }
      setLoadingLocations(true);
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/mapbox/geocode?query=${encodeURIComponent(data.location)}`, { headers });
        if (response.ok) { const d = await response.json(); setLocationSuggestions(d.features || []); }
      } catch (err) { console.error('Error fetching locations:', err); }
      finally { setLoadingLocations(false); }
    };
    const t = setTimeout(fetchLocationSuggestions, 300);
    return () => clearTimeout(t);
  }, [data.location]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <label className={LABEL_CLS}>{t('aiCalls.campaignBuilder.campaignName')}</label>
        <input type="text" value={data.name || ''} onChange={(e) => update({ name: e.target.value })}
          placeholder="e.g., Q1 Auto Shop Outreach" className={INPUT_CLS} />
      </div>

      <div>
        <label className={LABEL_CLS}>Brand Name *</label>
        <input type="text" value={data.customBrandName || data.brand || ''}
          onChange={(e) => {
            const val = e.target.value;
            const lower = val.toLowerCase();
            if (['roadr', 'sourcr', 'covera', 'contndr'].includes(lower)) {
              update({ brand: lower, customBrandName: '' });
            } else {
              update({ brand: 'custom', customBrandName: val });
            }
          }}
          placeholder="e.g., Acme Corp" className={INPUT_CLS} />
      </div>

      <div>
        <label className={LABEL_CLS}>Target Audience</label>
        <div className="space-y-2">
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input ref={audienceInputRef} type="text" value={data.targetAudience || ''}
              onChange={(e) => { update({ targetAudience: e.target.value }); setShowAudienceSuggestions(true); }}
              onFocus={() => setShowAudienceSuggestions(true)}
              placeholder="Business type (e.g., Auto repair shops)"
              className={INPUT_CLS + " pl-9"} />
            {showAudienceSuggestions && audienceSuggestions.length > 0 && (
              <div ref={audienceSuggestionsRef} className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl">
                {audienceSuggestions.map((s, idx) => (
                  <button key={idx} type="button"
                    className="w-full text-left px-3 py-2 text-xs text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    onClick={() => { update({ targetAudience: s }); setShowAudienceSuggestions(false); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input ref={locationInputRef} type="text" value={data.location || ''}
              onChange={(e) => { update({ location: e.target.value }); setShowLocationSuggestions(true); }}
              onFocus={() => setShowLocationSuggestions(true)}
              placeholder="City or address..."
              className={INPUT_CLS + " pl-9"} />
            {showLocationSuggestions && (locationSuggestions.length > 0 || loadingLocations) && (
              <div ref={locationSuggestionsRef} className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl">
                {loadingLocations && (
                  <div className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> Searching...
                  </div>
                )}
                {!loadingLocations && locationSuggestions.map((suggestion, idx) => (
                  <button key={idx} type="button"
                    className="w-full text-left px-3 py-2 text-xs text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    onClick={() => {
                      const [lng, lat] = suggestion.center;
                      update({ location: suggestion.place_name, locationCoordinates: `@${lat},${lng},15z` });
                      setShowLocationSuggestions(false);
                    }}>
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3 h-3 text-zinc-500 flex-shrink-0 mt-0.5" />
                      <span className="truncate">{suggestion.place_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>Call Objective *</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'book_call', icon: Calendar, label: 'Book a Call', desc: 'Schedule meeting' },
            { value: 'send_link', icon: Mail, label: 'Send Link', desc: 'Email follow-up' },
            { value: 'qualify', icon: Target, label: 'Qualify Lead', desc: 'Gather info' },
            { value: 'warm_transfer', icon: Users, label: 'Warm Transfer', desc: 'To human agent' }
          ].map((obj) => {
            const Icon = obj.icon;
            const selected = data.objective === obj.value;
            return (
              <button key={obj.value} onClick={() => update({ objective: obj.value as any })}
                className={`p-2.5 sm:p-3 rounded-lg border transition-all text-left ${selected ? CARD_SELECTED : CARD_DEFAULT}`}>
                <Icon className={`w-4 h-4 mb-1.5 ${selected ? 'text-[#1ED4A7]' : 'text-zinc-500'}`} />
                <p className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-white">{obj.label}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{obj.desc}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Lead Source ──
function Step2LeadSource({ data, update }: { data: Partial<CampaignData>; update: (d: Partial<CampaignData>) => void }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [emailStats, setEmailStats] = useState({ opened: 0, clicked: 0, replied: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => { if (data.leadSource === 'crm') loadLeadsFromCRM(''); }, [data.leadSource]);
  useEffect(() => { if (data.leadSource === 'email_campaign') loadCampaignsAndStats(); }, [data.leadSource]);

  // Debounced search: fires backend call 400ms after user stops typing
  useEffect(() => {
    if (data.leadSource !== 'crm') return;
    const timer = setTimeout(() => loadLeadsFromCRM(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery, data.leadSource]);

  async function loadLeadsFromCRM(search: string) {
    setLoadingLeads(true);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ has_phone: 'true', limit: '300' });
      if (search) params.set('search', search);
      const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads?${params}`, { headers });
      if (response.ok) {
        const result = await response.json();
        setLeads((result.leads || []).filter((lead: any) => lead.phone));
      }
    } catch (error) { console.error('Error loading leads:', error); }
    finally { setLoadingLeads(false); }
  }

  async function loadCampaignsAndStats() {
    setLoadingLeads(true);
    try {
      const headers = await getAuthHeaders();
      const [campRes, statsRes] = await Promise.all([
        fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns`, { headers }),
        fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/activity-stats`, { headers })
      ]);
      if (campRes.ok) { const r = await campRes.json(); setCampaigns(r.campaigns || []); }
      if (statsRes.ok) { const s = await statsRes.json(); setEmailStats({ opened: s.opened || 0, clicked: s.clicked || 0, replied: s.replied || 0 }); }
    } catch (error) { console.error('Error loading campaigns:', error); }
    finally { setLoadingLeads(false); }
  }

  async function loadLeadsByEmailActivity(campaignId: string, activity: 'opened' | 'clicked' | 'replied') {
    setLoadingLeads(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/leads-by-activity?campaignId=${campaignId}&activity=${activity}`, { headers });
      if (response.ok) {
        const result = await response.json();
        const leadsWithPhone = (result.leads || []).filter((lead: any) => lead.phone);
        setLeads(leadsWithPhone);
        update({ selectedLeads: leadsWithPhone.map((l: any) => l.id), emailCampaignFilter: { campaignId, activity } });
      }
    } catch (error) { console.error('Error loading leads:', error); }
    finally { setLoadingLeads(false); }
  }

  const leadCity = (l: any) => l.city || l.location?.split(',')[0]?.trim() || '';
  const uniqueCities = Array.from(new Set(leads.map(leadCity).filter(Boolean))).sort();
  const uniqueCategories = Array.from(new Set(leads.flatMap(l => l.tags || l.category ? [l.category] : []).filter(Boolean))).sort();

  // City and category filters are client-side (backend already handled name/phone search)
  const filteredLeads = leads.filter(lead => {
    if (selectedCity !== 'all' && leadCity(lead) !== selectedCity) return false;
    if (selectedCategory !== 'all' && (!lead.tags || !lead.tags.includes(selectedCategory)) && lead.category !== selectedCategory) return false;
    return true;
  });

  const SELECT_CLS = "w-full px-2.5 py-1.5 sm:py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[10px] sm:text-xs text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors";

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <label className={LABEL_CLS}>Lead Source</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'crm', icon: Users, label: 'From CRM', desc: 'Existing leads' },
            { value: 'csv', icon: Upload, label: 'Upload CSV', desc: 'Import file' },
            { value: 'email_campaign', icon: Mail, label: 'Email', desc: 'Who engaged' }
          ].map((source) => {
            const Icon = source.icon;
            const selected = data.leadSource === source.value;
            return (
              <button key={source.value}
                onClick={() => { update({ leadSource: source.value as any, selectedLeads: [] }); setLeads([]); }}
                className={`p-2.5 sm:p-3 rounded-lg border transition-all text-left ${selected ? CARD_SELECTED : CARD_DEFAULT}`}>
                <Icon className={`w-4 h-4 mb-1.5 ${selected ? 'text-[#1ED4A7]' : 'text-zinc-500'}`} />
                <p className="text-xs font-medium text-zinc-900 dark:text-white">{source.label}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 hidden sm:block">{source.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {data.leadSource === 'crm' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] sm:text-xs font-medium text-zinc-400">
              {loadingLeads ? 'Loading...' : `${filteredLeads.length} of ${leads.length} leads`}
            </label>
            {filteredLeads.length > 0 && (
              <button onClick={() => {
                const allIds = filteredLeads.map(l => l.id);
                const current = data.selectedLeads || [];
                const allSelected = filteredLeads.every(l => current.includes(l.id));
                update({ selectedLeads: allSelected ? current.filter(id => !allIds.includes(id)) : Array.from(new Set([...current, ...allIds])) });
              }}
                className="text-[10px] text-[#1ED4A7] hover:underline">
                {filteredLeads.every(l => data.selectedLeads?.includes(l.id)) ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {leads.length > 0 && (
            <div className="space-y-2 mb-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search leads..." className={INPUT_CLS + " pl-8 !py-1.5 sm:!py-2"} />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)} className={SELECT_CLS}>
                  <option value="all">All Cities</option>
                  {uniqueCities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className={SELECT_CLS}>
                  <option value="all">All Categories</option>
                  {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}

          {loadingLeads ? (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center">
              <Loader2 className="w-5 h-5 text-zinc-500 dark:text-zinc-400 animate-spin mx-auto mb-2" />
              <p className="text-xs text-zinc-500">Loading leads...</p>
            </div>
          ) : leads.length === 0 ? (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center">
              <Users className="w-8 h-8 text-zinc-400 dark:text-zinc-600 mx-auto mb-2" />
              <p className="text-xs font-medium text-zinc-900 dark:text-white mb-0.5">No Leads Found</p>
              <p className="text-[10px] text-zinc-500">Import leads with phone numbers</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center">
              <Search className="w-8 h-8 text-zinc-400 dark:text-zinc-600 mx-auto mb-2" />
              <p className="text-xs font-medium text-zinc-900 dark:text-white">No Matches</p>
            </div>
          ) : (
            <>
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800/50 max-h-56 sm:max-h-72 overflow-y-auto">
                {filteredLeads.map((lead) => (
                  <label key={lead.id} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 cursor-pointer transition-colors">
                    <input type="checkbox" checked={data.selectedLeads?.includes(lead.id) || false}
                      onChange={(e) => {
                        const current = data.selectedLeads || [];
                        update({ selectedLeads: e.target.checked ? [...current, lead.id] : current.filter(id => id !== lead.id) });
                      }}
                      className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-900 dark:text-white truncate">{lead.business_name || lead.contact_name || lead.name || 'Unknown'}</p>
                      <p className="text-[10px] text-zinc-500 truncate">{lead.contact_name && lead.business_name ? `${lead.contact_name} · ` : ''}{lead.phone}{leadCity(lead) ? ` · ${leadCity(lead)}` : ''}</p>
                    </div>
                    {lead.tags?.slice(0, 1).map((tag: string, idx: number) => (
                      <span key={idx} className="hidden sm:inline px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[9px] text-zinc-500 dark:text-zinc-400 flex-shrink-0">{tag}</span>
                    ))}
                  </label>
                ))}
              </div>
              <div className="mt-2 px-3 py-2 bg-[#1ED4A7]/5 border border-[#1ED4A7]/20 rounded-lg">
                <p className="text-[10px] sm:text-xs text-[#1ED4A7] font-medium">{data.selectedLeads?.length || 0} leads selected</p>
              </div>
            </>
          )}
        </div>
      )}

      {data.leadSource === 'csv' && (
        <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-6 sm:p-8 text-center">
          <Upload className="w-8 h-8 text-zinc-400 dark:text-zinc-600 mx-auto mb-2" />
          <p className="text-xs font-medium text-zinc-900 dark:text-white mb-0.5">Upload CSV File</p>
          <p className="text-[10px] text-zinc-500 mb-3">Required: name, business, phone</p>
          <button className="px-4 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">Choose File</button>
        </div>
      )}

      {data.leadSource === 'email_campaign' && (
        <div className="space-y-3">
          <div>
            <label className={LABEL_CLS}>Select Campaign</label>
            {loadingLeads && campaigns.length === 0 ? (
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex justify-center"><Loader2 className="w-4 h-4 text-zinc-500 dark:text-zinc-400 animate-spin" /></div>
            ) : campaigns.length === 0 ? (
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-center">
                <Mail className="w-6 h-6 text-zinc-400 dark:text-zinc-600 mx-auto mb-1" />
                <p className="text-xs text-zinc-500">No email campaigns found</p>
              </div>
            ) : (
              <select value={data.emailCampaignFilter?.campaignId || ''}
                onChange={(e) => {
                  const campaignId = e.target.value;
                  update({ emailCampaignFilter: { ...(data.emailCampaignFilter || {}), campaignId } });
                  if (campaignId && data.emailCampaignFilter?.activity) {
                    loadLeadsByEmailActivity(campaignId, data.emailCampaignFilter.activity as any);
                  }
                }}
                className={INPUT_CLS}>
                <option value="">Choose a campaign...</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Email Activity Filter</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'opened', label: 'Opened', count: emailStats.opened, icon: Mail },
                { value: 'clicked', label: 'Clicked', count: emailStats.clicked, icon: Target },
                { value: 'replied', label: 'Replied', count: emailStats.replied, icon: MessageSquare }
              ].map((act) => {
                const Icon = act.icon;
                const sel = data.emailCampaignFilter?.activity === act.value;
                return (
                  <button key={act.value}
                    onClick={() => { if (data.emailCampaignFilter?.campaignId) loadLeadsByEmailActivity(data.emailCampaignFilter.campaignId, act.value as any); }}
                    disabled={!data.emailCampaignFilter?.campaignId}
                    className={`p-2.5 rounded-lg border transition-all text-left disabled:opacity-40 ${sel ? CARD_SELECTED : CARD_DEFAULT}`}>
                    <Icon className={`w-3.5 h-3.5 mb-1 ${sel ? 'text-[#1ED4A7]' : 'text-zinc-500'}`} />
                    <p className="text-xs font-medium text-zinc-900 dark:text-white">{act.label}</p>
                    <p className={`text-base sm:text-lg font-bold mt-0.5 ${sel ? 'text-[#1ED4A7]' : 'text-zinc-500 dark:text-zinc-400'}`}>{act.count}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {leads.length > 0 && (
            <div>
              <label className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 mb-2 block">{leads.length} leads with phone</label>
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800/50 max-h-48 overflow-y-auto">
                {leads.slice(0, 10).map((lead) => (
                  <div key={lead.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <Check className="w-3 h-3 text-[#1ED4A7] flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-900 dark:text-white truncate">{lead.business_name || lead.contact_name || lead.name}</p>
                      <p className="text-[10px] text-zinc-500">{lead.contact_name && lead.business_name ? `${lead.contact_name} · ` : ''}{lead.phone}</p>
                    </div>
                  </div>
                ))}
                {leads.length > 10 && <p className="px-3 py-2 text-center text-[10px] text-zinc-500">+ {leads.length - 10} more</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 3: AI Configuration ──
function Step3AIConfiguration({
  data, update, playingVoice, playVoicePreview, availableVoices, loadingVoices, voicesError, availableAgents, loadingAgents, customAgents, loadingCustomAgents
}: {
  data: Partial<CampaignData>; update: (d: Partial<CampaignData>) => void;
  playingVoice: string | null; playVoicePreview: (voiceId: string, e: React.MouseEvent) => void;
  availableVoices: ElevenLabsVoice[]; loadingVoices: boolean; voicesError: string | null;
  availableAgents: ElevenLabsAgent[]; loadingAgents: boolean;
  customAgents: any[]; loadingCustomAgents: boolean;
}) {
  return (
    <div className="space-y-4 sm:space-y-5">
      {/* AI Identity */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <label className={LABEL_CLS}>AI Name *</label>
          <input type="text" value={data.aiName || ''} onChange={(e) => update({ aiName: e.target.value })}
            placeholder="e.g., Alex" className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Role</label>
          <select value={data.aiRole || ''} onChange={(e) => update({ aiRole: e.target.value })} className={INPUT_CLS}>
            <option>Sales Specialist</option>
            <option>Growth Advisor</option>
            <option>Consultant</option>
            <option>Account Executive</option>
          </select>
        </div>
      </div>

      {/* Custom Agent Selection */}
      {(customAgents.length > 0 || loadingCustomAgents) && (
        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-[#1ED4A7]" />
            <span className="text-xs font-semibold text-zinc-900 dark:text-white">Use Custom Agent</span>
          </div>
          <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 -mt-1">
            Apply settings from an agent you created in the AI Config panel.
          </p>
          {loadingCustomAgents ? (
            <div className="p-3 flex justify-center"><Loader2 className="w-4 h-4 text-zinc-500 dark:text-zinc-400 animate-spin" /></div>
          ) : (
            <select
              className={INPUT_CLS}
              onChange={(e) => {
                const agent = customAgents.find(a => a.id === e.target.value);
                if (agent) {
                  update({
                    customAgentId: agent.id,
                    aiName: agent.name || data.aiName,
                    aiRole: agent.role || data.aiRole,
                    voiceId: agent.voice || data.voiceId,
                    openingLine: agent.greeting || data.openingLine,
                    qualificationQuestions: agent.qualification_questions?.length ? agent.qualification_questions : data.qualificationQuestions,
                    instructions: agent.instructions || data.instructions,
                    knowledgeBase: agent.knowledge_base || data.knowledgeBase,
                    transferRules: agent.transfer_rules || data.transferRules,
                    maxTurns: agent.max_turns || data.maxTurns,
                  });
                }
              }}
            >
              <option value="">-- Select a custom agent --</option>
              {customAgents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name} ({agent.role})</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Brand Tone */}
      <div>
        <label className={LABEL_CLS}>Brand Tone</label>
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
          {(['friendly', 'professional', 'confident', 'direct'] as const).map((tone) => (
            <button key={tone} onClick={() => update({ brandTone: tone })}
              className={`py-2 px-2 rounded-lg border text-[10px] sm:text-xs font-medium text-center capitalize transition-all ${
                data.brandTone === tone ? CARD_SELECTED + ' text-[#1ED4A7]' : CARD_DEFAULT + ' text-zinc-500 dark:text-zinc-400'
              }`}>
              {tone}
            </button>
          ))}
        </div>
      </div>

      {/* ElevenLabs Agent (Pro) */}
      {(availableAgents.length > 0 || loadingAgents) && (
        <div className="bg-gradient-to-r from-[#1ED4A7]/5 to-transparent border border-[#1ED4A7]/20 rounded-lg p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-[#1ED4A7]" />
            <span className="text-xs font-semibold text-zinc-900 dark:text-white">ElevenLabs Agent</span>
            <span className="text-[9px] px-1.5 py-0.5 bg-[#1ED4A7]/15 text-[#1ED4A7] rounded-full font-semibold">PRO</span>
          </div>
          <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 -mt-1">
            Use a pre-configured ElevenLabs Conversational AI agent for fully autonomous calls.
          </p>
          {loadingAgents ? (
            <div className="p-3 flex justify-center"><Loader2 className="w-4 h-4 text-zinc-500 dark:text-zinc-400 animate-spin" /></div>
          ) : (
            <div className="space-y-1.5">
              <button onClick={() => update({ elevenlabsAgentId: undefined })}
                className={`w-full p-2.5 rounded-lg border transition-all text-left ${!data.elevenlabsAgentId ? CARD_SELECTED : CARD_DEFAULT}`}>
                <p className="text-xs font-medium text-zinc-900 dark:text-white">Manual (OpenAI + ElevenLabs TTS)</p>
                <p className="text-[10px] text-zinc-500">Use campaign script with OpenAI for conversation</p>
              </button>
              {availableAgents.map((agent) => {
                const sel = data.elevenlabsAgentId === agent.agent_id;
                return (
                  <button key={agent.agent_id} onClick={() => update({ elevenlabsAgentId: agent.agent_id })}
                    className={`w-full p-2.5 rounded-lg border transition-all text-left ${sel ? CARD_SELECTED : CARD_DEFAULT}`}>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-zinc-900 dark:text-white">{agent.name}</p>
                      {agent.metadata?.contndr_brand && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">{agent.metadata.contndr_brand}</span>
                      )}
                    </div>
                    {agent.metadata?.contndr_objective && (
                      <p className="text-[10px] text-zinc-500 mt-0.5 capitalize">{agent.metadata.contndr_objective.replace('_', ' ')}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Voice Settings */}
      <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-4 space-y-3 sm:space-y-4">
        <div className="flex items-center gap-2">
          <Volume2 className="w-3.5 h-3.5 text-[#1ED4A7]" />
          <span className="text-xs font-semibold text-zinc-900 dark:text-white">Voice Settings</span>
          <span className="text-[9px] px-1.5 py-0.5 bg-[#1ED4A7]/15 text-[#1ED4A7] rounded-full font-semibold">PRO</span>
        </div>

        {/* Provider */}
        <div>
          <label className={LABEL_CLS}>Provider</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'elevenlabs', label: 'ElevenLabs', desc: 'Pro — Multilingual v2' },
              { value: 'telnyx', label: 'Telnyx', desc: 'Cost effective' }
            ].map((p) => {
              const sel = data.voiceProvider === p.value;
              return (
                <button key={p.value} onClick={() => update({ voiceProvider: p.value as any })}
                  className={`p-2.5 rounded-lg border transition-all text-left ${sel ? CARD_SELECTED : CARD_DEFAULT}`}>
                  <p className="text-xs font-medium text-zinc-900 dark:text-white">{p.label}</p>
                  <p className="text-[10px] text-zinc-500">{p.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Voice Select */}
        <div>
          <label className={LABEL_CLS}>Select Voice</label>
          {loadingVoices ? (
            <div className="p-4 flex justify-center"><Loader2 className="w-4 h-4 text-zinc-500 dark:text-zinc-400 animate-spin" /></div>
          ) : voicesError ? (
            <div className="p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg"><p className="text-xs text-zinc-500 dark:text-zinc-400">{voicesError}</p></div>
          ) : availableVoices.length === 0 ? (
            <div className="p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg"><p className="text-xs text-zinc-500 dark:text-zinc-400">No voices available</p></div>
          ) : (
            <div className="space-y-1.5 max-h-48 sm:max-h-60 overflow-y-auto">
              {availableVoices.map((voice) => {
                const sel = data.voiceId === voice.id;
                return (
                  <div key={voice.id} onClick={() => update({ voiceId: voice.id })}
                    className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${sel ? CARD_SELECTED : CARD_DEFAULT}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-zinc-900 dark:text-white">{voice.name}</p>
                        {voice.isCloned && <span className="text-[8px] px-1 py-0.5 bg-purple-500/20 text-purple-400 rounded font-semibold">CLONED</span>}
                        {voice.highQuality && <span className="text-[8px] px-1 py-0.5 bg-[#1ED4A7]/15 text-[#1ED4A7] rounded font-semibold">HD</span>}
                      </div>
                      {voice.description && <p className="text-[10px] text-zinc-500 truncate mt-0.5">{voice.description}</p>}
                      {(voice.gender || voice.accent) && (
                        <div className="flex gap-1 mt-1">
                          {voice.gender && <span className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">{voice.gender}</span>}
                          {voice.accent && <span className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">{voice.accent}</span>}
                        </div>
                      )}
                    </div>
                    <button onClick={(e) => playVoicePreview(voice.id, e)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[#1ED4A7] hover:bg-[#1ED4A7]/10 rounded-lg transition-colors flex-shrink-0 ml-2">
                      {playingVoice === voice.id ? (
                        <><div className="w-2.5 h-2.5 bg-[#1ED4A7] rounded-sm" />Stop</>
                      ) : (
                        <><Play className="w-2.5 h-2.5" fill="currentColor" />Play</>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sliders */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Speed</label>
            <input type="range" min="0.5" max="1.5" step="0.1" value={data.speakingSpeed || 1.0}
              onChange={(e) => update({ speakingSpeed: parseFloat(e.target.value) })}
              className="w-full accent-[#1ED4A7]" />
            <p className="text-[10px] text-zinc-500 mt-0.5">{data.speakingSpeed}x</p>
          </div>
          <div>
            <label className={LABEL_CLS}>Emotion</label>
            <input type="range" min="0" max="1" step="0.1" value={data.emotionLevel || 0.5}
              onChange={(e) => update({ emotionLevel: parseFloat(e.target.value) })}
              className="w-full accent-[#1ED4A7]" />
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {data.emotionLevel && data.emotionLevel < 0.3 ? 'Calm' : data.emotionLevel && data.emotionLevel > 0.7 ? 'Energetic' : 'Balanced'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 4: Conversation Rules ──
function Step4ConversationRules({ data, update }: { data: Partial<CampaignData>; update: (d: Partial<CampaignData>) => void }) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <label className={LABEL_CLS}>Max Call Duration</label>
        <select value={data.maxDuration || 300} onChange={(e) => update({ maxDuration: parseInt(e.target.value) })} className={INPUT_CLS}>
          <option value={180}>3 minutes</option>
          <option value={300}>5 minutes</option>
          <option value={420}>7 minutes</option>
          <option value={600}>10 minutes</option>
        </select>
      </div>

      <div className="space-y-2">
        {[
          { key: 'allowInterruptions', label: 'Allow Interruptions', desc: 'Let prospect speak while AI is talking' },
          { key: 'humanTransfer', label: 'Human Transfer', desc: 'Transfer to live agent when requested' }
        ].map((item) => (
          <label key={item.key} className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer transition-colors">
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              (data as any)[item.key] !== false ? 'bg-[#1ED4A7] border-[#1ED4A7]' : 'border-zinc-300 dark:border-zinc-600'
            }`}>
              {(data as any)[item.key] !== false && (
                <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <input type="checkbox" checked={(data as any)[item.key] ?? true}
              onChange={(e) => update({ [item.key]: e.target.checked } as any)} className="sr-only" />
            <div>
              <p className="text-xs font-medium text-zinc-900 dark:text-white">{item.label}</p>
              <p className="text-[10px] text-zinc-500">{item.desc}</p>
            </div>
          </label>
        ))}
      </div>

      <div>
        <label className={LABEL_CLS}>Voicemail Action</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'leave', label: 'Leave Voicemail', desc: 'Record message' },
            { value: 'skip', label: 'Skip & Retry', desc: 'Try again later' }
          ].map((a) => {
            const sel = data.voicemailAction === a.value;
            return (
              <button key={a.value} onClick={() => update({ voicemailAction: a.value as any })}
                className={`p-2.5 sm:p-3 rounded-lg border transition-all text-left ${sel ? CARD_SELECTED : CARD_DEFAULT}`}>
                <p className="text-xs font-medium text-zinc-900 dark:text-white">{a.label}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{a.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>If Not Interested</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'tag', label: 'Tag & Continue', desc: 'Keep in system' },
            { value: 'stop', label: 'Stop Contact', desc: 'Remove from calls' }
          ].map((a) => {
            const sel = data.notInterestedAction === a.value;
            return (
              <button key={a.value} onClick={() => update({ notInterestedAction: a.value as any })}
                className={`p-2.5 sm:p-3 rounded-lg border transition-all text-left ${sel ? CARD_SELECTED : CARD_DEFAULT}`}>
                <p className="text-xs font-medium text-zinc-900 dark:text-white">{a.label}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{a.desc}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 5: Script Builder ──
function Step5ScriptBuilder({ data, update }: { data: Partial<CampaignData>; update: (d: Partial<CampaignData>) => void }) {
  const TEXTAREA_CLS = "w-full px-3 py-2.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors resize-none";

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <label className={LABEL_CLS}>Opening Line *</label>
        <textarea value={data.openingLine || ''} onChange={(e) => update({ openingLine: e.target.value })}
          rows={3} placeholder="Hi, this is [AI Name] calling from [Brand]..."
          className={TEXTAREA_CLS} />
        <p className="text-[10px] text-zinc-600 mt-1">First thing your AI will say. Keep it brief.</p>
      </div>

      <div>
        <label className={LABEL_CLS}>Value Pitch</label>
        <textarea value={data.valuePitch || ''} onChange={(e) => update({ valuePitch: e.target.value })}
          rows={3} placeholder="We help businesses like yours..."
          className={TEXTAREA_CLS} />
      </div>

      <div>
        <label className={LABEL_CLS}>Qualification Questions</label>
        <div className="space-y-1.5">
          {data.qualificationQuestions?.map((q, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="text" value={q}
                onChange={(e) => {
                  const updated = [...(data.qualificationQuestions || [])];
                  updated[i] = e.target.value;
                  update({ qualificationQuestions: updated });
                }}
                placeholder="Question..." className={INPUT_CLS} />
              <button onClick={() => {
                const updated = (data.qualificationQuestions || []).filter((_, idx) => idx !== i);
                update({ qualificationQuestions: updated });
              }} className="p-1.5 text-zinc-500 hover:text-red-400 flex-shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={() => update({ qualificationQuestions: [...(data.qualificationQuestions || []), ''] })}
            className="text-[10px] sm:text-xs text-[#1ED4A7] hover:underline mt-1">
            + Add Question
          </button>
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>Closing Action *</label>
        <textarea value={data.closeAction || ''} onChange={(e) => update({ closeAction: e.target.value })}
          rows={2} placeholder="Would you have 15 minutes this week?"
          className={TEXTAREA_CLS} />
      </div>

      <div className="flex items-start gap-2.5 p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg">
        <AlertCircle className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Your AI will adapt these scripts naturally. Actual dialogue varies based on prospect responses.
        </p>
      </div>
    </div>
  );
}

// ── Step 6: Scheduling ──
function Step6Scheduling({ data, update, scheduleValue, onScheduleChange, canUseIntentTriggers, planName }: {
  data: Partial<CampaignData>; update: (d: Partial<CampaignData>) => void;
  scheduleValue: ScheduleValue; onScheduleChange: (v: ScheduleValue) => void;
  canUseIntentTriggers: boolean; planName: string;
}) {
  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const trigger = normalizeIntentTriggerForState(data.intentTrigger);
  const updateTrigger = (updates: Partial<IntentTriggerConfig>) => {
    update({ intentTrigger: { ...trigger, ...updates } });
  };
  const pageOptions = [
    { id: 'pricing', label: 'Pricing' },
    { id: 'demo', label: 'Demo' },
    { id: 'contact', label: 'Contact' },
    { id: 'case_study', label: 'Case Study' },
    { id: 'checkout', label: 'Checkout' },
  ];
  const triggerModes: Array<{ id: IntentTriggerMode; label: string; description: string }> = [
    { id: 'known_campaign_visitor', label: 'Known visitor', description: 'Call a prospect already tied to an email campaign click.' },
    { id: 'form_request', label: 'Form request', description: 'Call after the embedded form captures phone and consent.' },
    { id: 'high_intent_company', label: 'High-intent company', description: 'Queue a review when company traffic matches the ICP.' },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <label className={LABEL_CLS}>Launch Timing</label>
        <SchedulePicker value={scheduleValue} onChange={onScheduleChange}
          itemLabel="calls" itemCount={data.selectedLeads?.length || 0} />
      </div>

      <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Calling Window</span>
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>Calling Days</label>
        <div className="flex flex-wrap gap-1.5">
          {daysOfWeek.map((day) => (
            <button key={day}
              onClick={() => {
                const current = data.callingDays || [];
                update({ callingDays: current.includes(day) ? current.filter(d => d !== day) : [...current, day] });
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg border text-[10px] sm:text-xs font-medium transition-all ${
                data.callingDays?.includes(day)
                  ? 'border-zinc-900 dark:border-white/20 bg-zinc-900 dark:bg-white text-white dark:text-black'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}>
              {day.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <label className={LABEL_CLS}>Start Time</label>
          <input type="time" value={data.callingHours?.start || '09:00'}
            onChange={(e) => update({ callingHours: { ...data.callingHours!, start: e.target.value } })}
            className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>End Time</label>
          <input type="time" value={data.callingHours?.end || '17:00'}
            onChange={(e) => update({ callingHours: { ...data.callingHours!, end: e.target.value } })}
            className={INPUT_CLS} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <label className={LABEL_CLS}>Max Attempts</label>
          <select value={data.maxAttempts || 3} onChange={(e) => update({ maxAttempts: parseInt(e.target.value) })} className={INPUT_CLS}>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} attempt{n > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Delay Between</label>
          <select value={data.delayBetweenAttempts || 24} onChange={(e) => update({ delayBetweenAttempts: parseInt(e.target.value) })} className={INPUT_CLS}>
            <option value={1}>1 hour</option>
            <option value={4}>4 hours</option>
            <option value={24}>24 hours</option>
            <option value={48}>48 hours</option>
            <option value={72}>72 hours</option>
          </select>
        </div>
      </div>

      {/* Timezone toggle */}
      <label className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer transition-colors">
        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
          data.timezoneDetection !== false ? 'bg-[#1ED4A7] border-[#1ED4A7]' : 'border-zinc-300 dark:border-zinc-600'
        }`}>
          {data.timezoneDetection !== false && (
            <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <input type="checkbox" checked={data.timezoneDetection ?? true}
          onChange={(e) => update({ timezoneDetection: e.target.checked })} className="sr-only" />
        <div>
          <p className="text-xs font-medium text-zinc-900 dark:text-white">Auto Timezone Detection</p>
          <p className="text-[10px] text-zinc-500">Call leads at appropriate local times</p>
        </div>
      </label>

      <div className={`rounded-lg border p-3 sm:p-4 space-y-4 ${
        trigger.enabled && canUseIntentTriggers
          ? 'border-[#1ED4A7]/50 bg-[#1ED4A7]/5'
          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-white dark:text-black" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-white">Intent-triggered AI calling</h4>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-zinc-900 text-white dark:bg-white dark:text-black">Scale + Enterprise</span>
              </div>
              <p className="text-[10px] sm:text-xs text-zinc-500 mt-1 leading-relaxed">
                Automatically queue this caller when campaign traffic shows buying intent, or let a visitor request an instant AI call from the page.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!canUseIntentTriggers}
            onClick={() => updateTrigger({ enabled: !trigger.enabled })}
            className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors overflow-hidden ${
              trigger.enabled && canUseIntentTriggers ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-zinc-700'
            } ${!canUseIntentTriggers ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              trigger.enabled && canUseIntentTriggers ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {!canUseIntentTriggers && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
            <AlertCircle className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] sm:text-xs text-zinc-500 leading-relaxed">
              Your current plan is {planName}. Upgrade to Scale or Enterprise to save and activate automated visitor-triggered calls.
            </p>
          </div>
        )}

        <div className={`${!trigger.enabled || !canUseIntentTriggers ? 'opacity-50 pointer-events-none' : ''} space-y-4`}>
          <div>
            <label className={LABEL_CLS}>Trigger Mode</label>
            <div className="grid sm:grid-cols-3 gap-2">
              {triggerModes.map((mode) => (
                <button
                  type="button"
                  key={mode.id}
                  onClick={() => updateTrigger({ mode: mode.id })}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    trigger.mode === mode.id ? CARD_SELECTED : CARD_DEFAULT
                  }`}
                >
                  <p className="text-xs font-semibold text-zinc-900 dark:text-white">{mode.label}</p>
                  <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>High Intent Pages</label>
            <div className="flex flex-wrap gap-1.5">
              {pageOptions.map((page) => {
                const selected = trigger.pages.includes(page.id);
                return (
                  <button
                    type="button"
                    key={page.id}
                    onClick={() => updateTrigger({ pages: selected ? trigger.pages.filter(p => p !== page.id) : [...trigger.pages, page.id] })}
                    className={`px-2.5 py-1.5 rounded-lg border text-[10px] sm:text-xs font-medium transition-all ${
                      selected ? 'border-[#1ED4A7]/60 bg-[#1ED4A7]/10 text-[#0F8D70]' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    {page.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div>
              <label className={LABEL_CLS}>Intent Score</label>
              <select value={trigger.threshold} onChange={(e) => updateTrigger({ threshold: parseInt(e.target.value) })} className={INPUT_CLS}>
                <option value={60}>60+</option>
                <option value={75}>75+</option>
                <option value={90}>90+</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Call Delay</label>
              <select value={trigger.delayMinutes} onChange={(e) => updateTrigger({ delayMinutes: parseInt(e.target.value) })} className={INPUT_CLS}>
                <option value={0}>Instant</option>
                <option value={2}>2 min</option>
                <option value={5}>5 min</option>
                <option value={15}>15 min</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Cooldown</label>
              <select value={trigger.cooldownHours} onChange={(e) => updateTrigger({ cooldownHours: parseInt(e.target.value) })} className={INPUT_CLS}>
                <option value={6}>6 hours</option>
                <option value={24}>24 hours</option>
                <option value={72}>72 hours</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Daily Cap</label>
              <select value={trigger.maxDailyCalls} onChange={(e) => updateTrigger({ maxDailyCalls: parseInt(e.target.value) })} className={INPUT_CLS}>
                <option value={10}>10 calls</option>
                <option value={25}>25 calls</option>
                <option value={50}>50 calls</option>
                <option value={100}>100 calls</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-2">
            {[
              { key: 'requireKnownLead', label: 'Known lead required', hint: 'Uses campaign clicks and CRM identity.' },
              { key: 'requireConsent', label: 'Require consent', hint: 'Best for instant form-triggered calls.' },
              { key: 'formEnabled', label: 'Show call form', hint: 'Embed a short request-call form.' },
            ].map((item) => (
              <label key={item.key} className="flex items-start gap-2.5 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(trigger[item.key as keyof IntentTriggerConfig])}
                  onChange={(e) => updateTrigger({ [item.key]: e.target.checked } as Partial<IntentTriggerConfig>)}
                  className="mt-0.5 accent-[#1ED4A7]"
                />
                <span>
                  <span className="block text-xs font-medium text-zinc-900 dark:text-white">{item.label}</span>
                  <span className="block text-[10px] text-zinc-500 mt-0.5 leading-relaxed">{item.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {(trigger.formEnabled || trigger.requireConsent) && (
            <div>
              <label className={LABEL_CLS}>Form Consent Text</label>
              <textarea
                value={trigger.consentText}
                onChange={(e) => updateTrigger({ consentText: e.target.value })}
                rows={2}
                className={INPUT_CLS}
              />
            </div>
          )}
        </div>
      </div>

      {/* Compliance */}
      <div className="flex items-start gap-2.5 p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg">
        <Shield className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] sm:text-xs font-medium text-zinc-700 dark:text-zinc-300">Compliance</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">All calls honor DNC lists and opt-out requests.</p>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-4">
        <h4 className="text-[10px] sm:text-xs font-semibold text-zinc-900 dark:text-white mb-2 uppercase tracking-wide">Summary</h4>
        <div className="space-y-1.5 text-[10px] sm:text-xs">
          {[
            ['Campaign', data.name || 'Untitled'],
            ['Leads', String(data.selectedLeads?.length || 0)],
            ['Est. Calls', String((data.selectedLeads?.length || 0) * (data.maxAttempts || 3))],
            ['Est. Cost', fmtUSDCents((data.selectedLeads?.length || 0) * (data.maxAttempts || 3) * 0.012)]
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between">
              <span className="text-zinc-500">{label}</span>
              <span className="font-medium text-zinc-900 dark:text-white">{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AICallCampaignBuilder;
