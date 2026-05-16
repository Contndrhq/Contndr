import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, Loader2, Phone, Play, Save, Plus, Trash2, Sparkles, Target, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ─── AI Call Playbook (per-user sales script) ─────────────────────────────
// Lives in Agent Mode rather than its own tab — it's only relevant when
// AI calling / hot-visitor calls are turned on, which are configured here.
interface ObjectionEntry {
  trigger: string;
  response: string;
  label?: string;
}

interface AICallPlaybookData {
  qualifying_questions: string[];
  value_props: string[];
  meeting_options: string;
  booking_link: string;
  objections: ObjectionEntry[];
  close_style: 'soft' | 'direct';
}

const EMPTY_PLAYBOOK: AICallPlaybookData = {
  qualifying_questions: [],
  value_props: [],
  meeting_options: '',
  booking_link: '',
  objections: [],
  close_style: 'soft',
};

const SUGGESTED_OBJECTIONS: ObjectionEntry[] = [
  { trigger: 'already have', response: "Totally fair — most teams I talk to already have something. What's the one thing it doesn't do well that you wish it did?", label: 'already_have' },
  { trigger: 'too expensive', response: "Yeah, budget's always real — but folks getting value usually pay it back in the first month from one extra deal. Mind if I show you the math?", label: 'price' },
  { trigger: 'send me info', response: "Happy to — but a 10-min screen-share lands way better than a deck. How's tomorrow at this same time?", label: 'send_info' },
  { trigger: 'not the right time', response: "Got it — won't keep you. Want me to grab 10 min on the calendar later this week instead?", label: 'bad_timing' },
  { trigger: 'talk to my team', response: "Makes sense — best path is I show you both at once. Want 15 min with the two of you this week?", label: 'not_dm' },
  { trigger: 'think about it', response: "Totally — what's the main thing on your mind? I'd rather answer it now than have you stuck on it later.", label: 'thinking' },
];

interface AgentModeConfig {
  enabled: boolean;
  autonomyLevel: 'supervised' | 'autopilot';
  dailyBriefing: boolean;
  autoFollowUps: boolean;
  autoLaunchCampaigns: boolean;
  autoPauseLowQuality: boolean;
  autoCallHotVisitors: boolean;
  useElevenLabsConvai: boolean;
  elevenLabsPhoneNumberId: string;
  maxDailyActions: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  guardrails: string;
}

interface AgentModeData {
  config: AgentModeConfig;
  entitlements: {
    agentMode: boolean;
    aiCalling: boolean;
    intentAutoCall: boolean;
    plan: string;
  };
  recommendations: Array<{ id: string; title: string; detail: string; priority: string; action: string }>;
  lastRun?: any;
}

const DEFAULT_CONFIG: AgentModeConfig = {
  enabled: false,
  autonomyLevel: 'supervised',
  dailyBriefing: true,
  autoFollowUps: true,
  autoLaunchCampaigns: false,
  autoPauseLowQuality: true,
  autoCallHotVisitors: false,
  useElevenLabsConvai: false,
  elevenLabsPhoneNumberId: '',
  maxDailyActions: 25,
  quietHoursStart: '20:00',
  quietHoursEnd: '08:00',
  guardrails: 'Protect deliverability, avoid duplicate outreach, and never call outside business hours.',
};

export function AgentModeSettings() {
  const [data, setData] = useState<AgentModeData | null>(null);
  const [draft, setDraft] = useState<AgentModeConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const [playbook, setPlaybook] = useState<AICallPlaybookData>(EMPTY_PLAYBOOK);
  const [playbookSaving, setPlaybookSaving] = useState(false);

  // ── Test call state ──
  // Lets the user place a one-click pretend call to their own phone so they
  // can hear the AI agent end-to-end (TTS + playbook + KB + opening line)
  // without touching real leads or worrying about cooldowns / daily caps.
  const [testPhone, setTestPhone] = useState('');
  const [testCalling, setTestCalling] = useState(false);

  const fireTestCall = async () => {
    setTestCalling(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/ai-call/test-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPhone.trim() ? { phone: testPhone.trim() } : {}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Test call failed');
      const isConvai = json.route === 'elevenlabs_convai';
      toast.success(isConvai ? '🚀 Convai call started (sub-second latency)' : '⚠️ Test call started (legacy Telnyx path)', {
        description: isConvai
          ? `ElevenLabs is dialing ${json.to}. Conversation: ${json.conversation_id || '?'}.`
          : `Ringing ${json.to} via Telnyx. Convai skipped: ${json.convai_skip_reason || 'unknown'}. Playbook=${json.using_playbook ? 'yes' : 'no'}, KB=${json.using_kb ? 'yes' : 'no'}.`,
        duration: 12000,
      });
    } catch (err: any) {
      toast.error('Test call failed', { description: err.message });
    } finally {
      setTestCalling(false);
    }
  };

  // ── ElevenLabs Conversational AI agent state (Layer A) ──
  const [agentInfo, setAgentInfo] = useState<{ agent_id?: string; created_at?: string; last_synced_at?: string } | null>(null);
  const [agentSyncing, setAgentSyncing] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);

  const ensureAgent = async () => {
    setAgentLoading(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/elevenlabs/my-agent`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to provision agent');
      setAgentInfo({ agent_id: json.agent_id, created_at: json.record?.created_at, last_synced_at: json.record?.last_synced_at });
      if (json.created) toast.success('ElevenLabs agent provisioned');
    } catch (err: any) {
      toast.error('Could not provision agent', { description: err.message });
    } finally {
      setAgentLoading(false);
    }
  };

  const syncAgent = async () => {
    setAgentSyncing(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/elevenlabs/my-agent/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_config: { name: 'Alex', brand: 'Contndr', objective: 'book_call', brand_tone: 'friendly' } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      toast.success('Agent synced — playbook + KB pushed');
      // Refresh status to show new last_synced_at
      ensureAgent();
    } catch (err: any) {
      toast.error('Sync failed', { description: err.message });
    } finally {
      setAgentSyncing(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agentRes, pbRes] = await Promise.all([
        authenticatedFetch(`${API_BASE}/agent-mode`),
        authenticatedFetch(`${API_BASE}/ai-call-playbook`).catch(() => null),
      ]);
      const json = await agentRes.json();
      if (!agentRes.ok) throw new Error(json.error || 'Unable to load Agent Mode');
      setData(json);
      setDraft({ ...DEFAULT_CONFIG, ...(json.config || {}) });
      if (pbRes && pbRes.ok) {
        const pbJson = await pbRes.json();
        setPlaybook({ ...EMPTY_PLAYBOOK, ...(pbJson.playbook || {}) });
      }
      // Auto-fetch agent status if Convai is already enabled. Doesn't create
      // an agent unless the user explicitly toggles it on for the first time.
      if (json.config?.useElevenLabsConvai) {
        try {
          const aRes = await authenticatedFetch(`${API_BASE}/elevenlabs/my-agent`);
          if (aRes.ok) {
            const aJson = await aRes.json();
            setAgentInfo({ agent_id: aJson.agent_id, created_at: aJson.record?.created_at, last_synced_at: aJson.record?.last_synced_at });
          }
        } catch {}
      }
    } catch (err: any) {
      toast.error('Agent Mode unavailable', { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const savePlaybook = async () => {
    setPlaybookSaving(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/ai-call-playbook`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playbook),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setPlaybook({ ...EMPTY_PLAYBOOK, ...(json.playbook || {}) });
      toast.success('Sales playbook saved');
    } catch (err: any) {
      toast.error('Could not save playbook', { description: err.message });
    } finally {
      setPlaybookSaving(false);
    }
  };

  const updatePbStringArr = (key: 'qualifying_questions' | 'value_props', idx: number, value: string) => {
    setPlaybook(p => {
      const next = [...p[key]]; next[idx] = value;
      return { ...p, [key]: next };
    });
  };
  const addPbString = (key: 'qualifying_questions' | 'value_props') =>
    setPlaybook(p => ({ ...p, [key]: [...p[key], ''] }));
  const removePbString = (key: 'qualifying_questions' | 'value_props', idx: number) =>
    setPlaybook(p => ({ ...p, [key]: p[key].filter((_, i) => i !== idx) }));

  const updatePbObjection = (idx: number, field: keyof ObjectionEntry, value: string) => {
    setPlaybook(p => {
      const next = [...p.objections];
      next[idx] = { ...next[idx], [field]: value };
      return { ...p, objections: next };
    });
  };
  const addPbObjection = () => setPlaybook(p => ({ ...p, objections: [...p.objections, { trigger: '', response: '' }] }));
  const removePbObjection = (idx: number) => setPlaybook(p => ({ ...p, objections: p.objections.filter((_, i) => i !== idx) }));
  const seedPbObjections = () => {
    setPlaybook(p => {
      const have = new Set(p.objections.map(o => o.trigger.toLowerCase().trim()));
      const fresh = SUGGESTED_OBJECTIONS.filter(o => !have.has(o.trigger.toLowerCase().trim()));
      return { ...p, objections: [...p.objections, ...fresh] };
    });
    toast.success('Added starter objections — edit them to match your voice');
  };

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = async (config: AgentModeConfig, quiet = false) => {
    setSaving(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/agent-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to save Agent Mode');
      setData(json);
      setDraft({ ...DEFAULT_CONFIG, ...(json.config || {}) });
      window.dispatchEvent(new CustomEvent('agent-mode-updated', { detail: json }));
      if (!quiet) toast.success('Agent Mode saved');
      return json;
    } catch (err: any) {
      toast.error('Could not save Agent Mode', { description: err.message });
      await load();
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    await saveConfig(draft);
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/agent-mode/run`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to run Agent Mode');
      setData(prev => prev ? { ...prev, lastRun: json.run, recommendations: json.recommendations || prev.recommendations } : prev);
      toast.success('Agent pass complete', { description: `${json.run?.actions?.length || 0} action(s) evaluated` });
    } catch (err: any) {
      toast.error('Agent pass failed', { description: err.message });
    } finally {
      setRunning(false);
    }
  };

  const setField = <K extends keyof AgentModeConfig>(key: K, value: AgentModeConfig[K], persist = false) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      if (persist) {
        saveConfig(next, true).catch(() => {});
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  const entitlements = data?.entitlements;
  const canUseAgent = entitlements?.agentMode;
  const canAutoCall = entitlements?.aiCalling && entitlements?.intentAutoCall;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/[0.08] dark:to-white/[0.03] flex items-center justify-center border border-zinc-200/80 dark:border-zinc-200 dark:border-zinc-800">
            <Bot className="w-4.5 h-4.5 text-zinc-600 dark:text-zinc-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">Agent Mode</h2>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">Configure how much work Contndr can handle for you.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          <button
            onClick={runNow}
            disabled={!canUseAgent || running || saving}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 text-[12.5px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {!canUseAgent && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
          Agent Mode is available on Growth, Scale, and Enterprise plans.
        </div>
      )}

      <SettingsSection title="Autonomy">
        <SettingRow
          icon={Bot}
          title="Enable Agent Mode"
          desc="Allow Contndr to monitor work and surface daily priorities."
          right={<ToggleSwitch checked={draft.enabled} disabled={!canUseAgent || saving} onChange={checked => setField('enabled', checked, true)} />}
        />
        <div className="py-3.5 px-4">
          <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 border border-zinc-200/60 dark:border-zinc-200 dark:border-zinc-800 w-full sm:w-fit">
            {[
              { id: 'supervised', title: 'Supervised' },
              { id: 'autopilot', title: 'Autopilot' },
            ].map(option => (
              <button
                key={option.id}
                onClick={() => setField('autonomyLevel', option.id as AgentModeConfig['autonomyLevel'], true)}
                disabled={saving || !canUseAgent}
                className={`px-4 py-1.5 rounded-md text-[11.5px] font-medium transition-all ${
                  draft.autonomyLevel === option.id
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                {option.title}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500 mt-2">
            {draft.autonomyLevel === 'autopilot' ? 'Execute approved playbooks without daily confirmation.' : 'Recommend actions and execute low-risk work only.'}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Permissions">
        <PermissionRow title="Process due follow-ups" desc="Send configured follow-ups when campaign timing rules are met." checked={draft.autoFollowUps} disabled={saving || !canUseAgent} onChange={v => setField('autoFollowUps', v, true)} />
        <PermissionRow title="Launch prepared campaigns" desc="Start ready campaigns within daily action limits." checked={draft.autoLaunchCampaigns} disabled={saving || !canUseAgent} onChange={v => setField('autoLaunchCampaigns', v, true)} />
        <PermissionRow title="Pause weak campaigns" desc="Flag or pause campaigns when performance moves outside guardrails." checked={draft.autoPauseLowQuality} disabled={saving || !canUseAgent} onChange={v => setField('autoPauseLowQuality', v, true)} />
        <PermissionRow
          title="Call hot visitors"
          desc={canAutoCall ? 'Automatically arm AI calls when identified prospects visit from campaign links.' : 'Scale/Enterprise only. Upgrade or refresh billing to enable visitor-triggered AI calls.'}
          checked={draft.autoCallHotVisitors && !!canAutoCall}
          disabled={saving || !canAutoCall}
          icon={Phone}
          onChange={v => setField('autoCallHotVisitors', v, true)}
        />
        <PermissionRow
          title="Use ElevenLabs Conversational AI (beta)"
          desc="Route AI calls through ElevenLabs' realtime agent for sub-500ms latency, natural barge-in, and human-grade voice. Phone routing wires up next; this provisions the agent so it's ready."
          checked={draft.useElevenLabsConvai}
          disabled={saving}
          icon={Sparkles}
          onChange={async v => {
            setField('useElevenLabsConvai', v, true);
            if (v) await ensureAgent();
          }}
        />
        {/* ── Test call: dial yourself end-to-end ── */}
        <div className="px-4 py-3.5 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-zinc-500 dark:text-zinc-400 shrink-0" />
              <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">Test call to me</p>
            </div>
            <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-0.5 ml-6">
              Rings your phone in 10 seconds. Uses your real playbook + KB but bypasses cooldowns and daily caps.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="tel"
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="+1 555 555 0123"
              className="px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black text-[12.5px] w-[170px]"
            />
            <button
              type="button"
              onClick={fireTestCall}
              disabled={testCalling}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-black text-[12px] font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {testCalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
              Call me
            </button>
          </div>
        </div>

        {draft.useElevenLabsConvai && (
          <div className="px-4 py-3 bg-zinc-50/60 dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="text-[12px] text-zinc-600 dark:text-zinc-400 space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">Agent:</span>
                  {agentLoading ? (
                    <span className="text-zinc-400">Provisioning…</span>
                  ) : agentInfo?.agent_id ? (
                    <code className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{agentInfo.agent_id}</code>
                  ) : (
                    <button onClick={ensureAgent} className="text-zinc-700 dark:text-zinc-200 underline">Provision now</button>
                  )}
                </div>
                {agentInfo?.last_synced_at && (
                  <div><span className="font-medium">Last synced:</span> {new Date(agentInfo.last_synced_at).toLocaleString()}</div>
                )}
                <div className="text-[11.5px] text-zinc-400 dark:text-zinc-500 pt-1">
                  Sync pushes your playbook + Knowledge Base into the agent's prompt.
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {!agentInfo?.agent_id && (
                  <button onClick={ensureAgent} disabled={agentLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-[12px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50">
                    {agentLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    Provision agent
                  </button>
                )}
                <button onClick={syncAgent} disabled={agentSyncing} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-black text-[12px] font-semibold hover:opacity-90 disabled:opacity-50">
                  {agentSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Sync now
                </button>
              </div>
            </div>

            {/* ── Phone number ID for SIP-routed calls ── */}
            <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
              <p className="text-[11.5px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                ElevenLabs phone number ID
              </p>
              <input
                type="text"
                value={draft.elevenLabsPhoneNumberId}
                onChange={e => setField('elevenLabsPhoneNumberId', e.target.value, true /* persist immediately */)}
                placeholder="phnum_xxxxxxxxxxxx"
                className="w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black text-[12.5px] font-mono"
              />
              {draft.elevenLabsPhoneNumberId && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">✓ Saved. Calls will route through ElevenLabs Convai when the toggle above is on.</p>
              )}
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-1.5 leading-relaxed">
                Required for sub-second-latency calls. Get this by:
                <br />
                <span className="text-zinc-600 dark:text-zinc-400">1.</span> Open ElevenLabs portal → Conversational AI → Phone Numbers
                <br />
                <span className="text-zinc-600 dark:text-zinc-400">2.</span> Click <em>Import a phone number from SIP trunk</em>
                <br />
                <span className="text-zinc-600 dark:text-zinc-400">3.</span> Use your Telnyx SIP credentials (find them in Telnyx portal → SIP Connections → Outbound)
                <br />
                <span className="text-zinc-600 dark:text-zinc-400">4.</span> ElevenLabs returns a <code>phnum_…</code> ID — paste it here.
                <br />
                With this set, calls route through ElevenLabs (~600ms latency). Without it, calls fall back to the legacy Telnyx pipeline (~3s latency).
              </p>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="AI Sales Script">
        <div className="px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-zinc-700 dark:text-zinc-300">
              The script your AI follows on every call now lives in <strong>AI Brain</strong>, alongside your Knowledge Base and Voice & Tone.
            </p>
            <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-1">
              One place to teach the AI what to know, how to sell, and how to sound.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'knowledge-base' }))}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-black text-[12px] font-semibold hover:opacity-90 shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Open AI Brain
          </button>
        </div>
      </SettingsSection>

      {false && (
      <SettingsSection title="AI Call Sales Playbook (legacy)">
        <div className="px-4 py-3 text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          The script your AI agent follows on every call — discovery questions, value props, objection handlers, and how it asks for the meeting. Applies to manual calls, campaigns, and auto-calls from hot visitors.
        </div>

        {/* Qualifying questions */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200">Qualifying questions <span className="text-zinc-400 dark:text-zinc-500 font-normal">— up to 5</span></p>
          </div>
          <div className="space-y-2">
            {playbook.qualifying_questions.map((q, i) => (
              <PbRow key={i} value={q} placeholder={i === 0 ? 'e.g. How are you currently handling outbound?' : ''} onChange={v => updatePbStringArr('qualifying_questions', i, v)} onRemove={() => removePbString('qualifying_questions', i)} />
            ))}
            {playbook.qualifying_questions.length < 5 && (
              <button type="button" onClick={() => addPbString('qualifying_questions')} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"><Plus className="w-3 h-3" />Add question</button>
            )}
          </div>
        </div>

        {/* Value props */}
        <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
          <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200 mb-2">Value props <span className="text-zinc-400 dark:text-zinc-500 font-normal">— outcomes, not features</span></p>
          <div className="space-y-2">
            {playbook.value_props.map((v, i) => (
              <PbRow key={i} value={v} placeholder={i === 0 ? 'e.g. Cut prospecting time from 4 hours/day to 30 min' : ''} onChange={val => updatePbStringArr('value_props', i, val)} onRemove={() => removePbString('value_props', i)} />
            ))}
            {playbook.value_props.length < 5 && (
              <button type="button" onClick={() => addPbString('value_props')} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"><Plus className="w-3 h-3" />Add value prop</button>
            )}
          </div>
        </div>

        {/* Close mechanics */}
        <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Meeting times the AI proposes">
            <input type="text" value={playbook.meeting_options} onChange={e => setPlaybook(p => ({ ...p, meeting_options: e.target.value }))} placeholder="Thursday at 2pm or Friday at 10am ET" className={inputClass} />
          </Field>
          <Field label="Booking link (optional)">
            <input type="url" value={playbook.booking_link} onChange={e => setPlaybook(p => ({ ...p, booking_link: e.target.value }))} placeholder="https://cal.com/you/15min" className={inputClass} />
          </Field>
          <Field label="Close style">
            <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 border border-zinc-200/60 dark:border-zinc-200 dark:border-zinc-800 w-fit">
              {(['soft', 'direct'] as const).map(s => (
                <button key={s} type="button" onClick={() => setPlaybook(p => ({ ...p, close_style: s }))} className={`px-3 py-1 rounded-md text-[11.5px] font-medium transition-all ${playbook.close_style === s ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {s === 'soft' ? 'Soft' : 'Direct'}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Objections */}
        <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200">Objection library <span className="text-zinc-400 dark:text-zinc-500 font-normal">— up to 12</span></p>
            <button type="button" onClick={seedPbObjections} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"><Sparkles className="w-3 h-3" />Add 6 starters</button>
          </div>
          <div className="space-y-2">
            {playbook.objections.map((obj, i) => (
              <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-2.5 space-y-2 bg-zinc-50/40 dark:bg-zinc-950">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1.5">
                    <input type="text" value={obj.trigger} onChange={e => updatePbObjection(i, 'trigger', e.target.value)} placeholder='Trigger phrase, e.g. "too expensive"' className={`${inputClass} font-medium`} />
                    <textarea value={obj.response} onChange={e => updatePbObjection(i, 'response', e.target.value)} placeholder="What the AI should say in response" rows={2} className={`${inputClass} resize-none`} />
                  </div>
                  <button type="button" onClick={() => removePbObjection(i)} className="p-1.5 text-zinc-400 hover:text-red-500" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
            {playbook.objections.length < 12 && (
              <button type="button" onClick={addPbObjection} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"><Plus className="w-3 h-3" />Add objection</button>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 flex justify-end">
          <button type="button" onClick={savePlaybook} disabled={playbookSaving} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:opacity-90 disabled:opacity-50">
            {playbookSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
            Save playbook
          </button>
        </div>
      </SettingsSection>
      )}

      <SettingsSection title="Guardrails">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-4 py-3.5">
          <Field label="Max daily actions">
            <input type="number" min={1} max={250} value={draft.maxDailyActions} onChange={e => setField('maxDailyActions', Number(e.target.value || 1))} className={inputClass} />
          </Field>
          <Field label="Quiet hours start">
            <input type="time" value={draft.quietHoursStart} onChange={e => setField('quietHoursStart', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Quiet hours end">
            <input type="time" value={draft.quietHoursEnd} onChange={e => setField('quietHoursEnd', e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="px-4 pb-3.5">
          <Field label="Operating instructions">
            <textarea value={draft.guardrails} onChange={e => setField('guardrails', e.target.value)} rows={4} className={`${inputClass} resize-none`} />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Priorities">
        <div className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
          {(data?.recommendations || []).slice(0, 3).map(item => (
            <div key={item.id} className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{item.title}</p>
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{item.priority}</span>
              </div>
              <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500 mt-1">{item.detail}</p>
            </div>
          ))}
          {(!data?.recommendations || data.recommendations.length === 0) && (
            <p className="px-4 py-3.5 text-[13px] text-zinc-500">No urgent priorities detected.</p>
          )}
        </div>
      </SettingsSection>

      {data?.lastRun && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 text-center pt-1 pb-4">
          Last agent pass: {new Date(data.lastRun.ran_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7]/50';

function PbRow({ value, placeholder, onChange, onRemove }: { value: string; placeholder?: string; onChange: (v: string) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
      <button type="button" onClick={onRemove} className="p-1.5 text-zinc-400 hover:text-red-500 shrink-0" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">{title}</h3>
        <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ToggleSwitch({ checked, disabled, onChange }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  // Use inline styles for the moving thumb's position so production
  // Tailwind purges can't strip the arbitrary translate values that
  // previously made the thumb collapse into a solid pill on mobile.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? 'bg-zinc-900 dark:bg-white'
          : 'bg-zinc-200 dark:bg-zinc-800'
      }`}
      style={{ width: 44, height: 24 }}
    >
      <span
        aria-hidden
        className={`block rounded-full transition-transform duration-200 ease-in-out shadow-sm ${
          checked ? 'bg-white dark:bg-zinc-900' : 'bg-white dark:bg-zinc-400'
        }`}
        style={{
          width: 18,
          height: 18,
          transform: `translateX(${checked ? 23 : 3}px)`,
        }}
      />
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function SettingRow({ icon: Icon, title, desc, right }: {
  icon: typeof Bot;
  title: string;
  desc: string;
  right: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors shrink-0">
          <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{title}</p>
          <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{desc}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function PermissionRow({ title, desc, checked, disabled, icon, onChange }: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  icon?: typeof Bot;
  onChange: (checked: boolean) => void;
}) {
  const Icon = icon;
  return (
    <div className={`flex items-center justify-between py-3.5 px-4 rounded-xl transition-colors group ${disabled ? 'opacity-60' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors shrink-0">
            <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{title}</p>
            {disabled && <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:bg-white/[0.08]">Locked</span>}
          </div>
          <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{desc}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}
