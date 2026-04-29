import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, CheckCircle2, Loader2, Phone, Play, Save, Shield, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface AgentModeConfig {
  enabled: boolean;
  autonomyLevel: 'supervised' | 'autopilot';
  dailyBriefing: boolean;
  autoFollowUps: boolean;
  autoLaunchCampaigns: boolean;
  autoPauseLowQuality: boolean;
  autoCallHotVisitors: boolean;
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/agent-mode`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to load Agent Mode');
      setData(json);
      setDraft({ ...DEFAULT_CONFIG, ...(json.config || {}) });
    } catch (err: any) {
      toast.error('Agent Mode unavailable', { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/agent-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to save Agent Mode');
      setData(json);
      setDraft({ ...DEFAULT_CONFIG, ...(json.config || {}) });
      toast.success('Agent Mode saved');
    } catch (err: any) {
      toast.error('Could not save Agent Mode', { description: err.message });
    } finally {
      setSaving(false);
    }
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

  const setField = <K extends keyof AgentModeConfig>(key: K, value: AgentModeConfig[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
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
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#1ED4A7]/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-[#1ED4A7]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Agent Mode</h2>
              <p className="text-sm text-zinc-500">Let Contndr decide, prioritize, and execute the sales work that should not need your attention.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runNow}
            disabled={!canUseAgent || running}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Now
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {!canUseAgent && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          Agent Mode is available on Growth, Scale, and Enterprise plans. Upgrade this workspace to activate autonomous execution.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        <div className="space-y-4">
          <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#050505] p-5 shadow-sm dark:shadow-none">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Autonomous operating system</h3>
                  <StatusPill active={draft.enabled} />
                </div>
                <p className="text-xs text-zinc-500 mt-1 max-w-3xl">The agent monitors campaigns, processes follow-ups, protects deliverability, and surfaces the highest-value next move.</p>
              </div>
              <ToggleSwitch
                checked={draft.enabled}
                disabled={!canUseAgent}
                onChange={checked => setField('enabled', checked)}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#050505] p-5">
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Mode</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {[
                { id: 'supervised', title: 'Supervised', desc: 'Recommend and execute low-risk work only.' },
                { id: 'autopilot', title: 'Autopilot', desc: 'Execute approved playbooks without daily confirmation.' },
              ].map(option => (
                <button
                  key={option.id}
                  onClick={() => setField('autonomyLevel', option.id as AgentModeConfig['autonomyLevel'])}
                  className={`relative text-left p-4 rounded-xl border transition-all overflow-hidden ${draft.autonomyLevel === option.id ? 'border-[#1ED4A7]/70 bg-[#1ED4A7]/10 shadow-[0_0_0_1px_rgba(30,212,167,0.12)_inset]' : 'border-zinc-200 dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-white/[0.03]'}`}
                >
                  {draft.autonomyLevel === option.id && <div className="absolute right-3 top-3 w-2 h-2 rounded-full bg-[#1ED4A7]" />}
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                    {option.id === 'autopilot' ? <Zap className="w-4 h-4 text-[#1ED4A7]" /> : <Shield className="w-4 h-4 text-zinc-400" />}
                    {option.title}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{option.desc}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#050505] p-5">
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Permissions</label>
            <div className="mt-3 space-y-2">
              <PermissionRow title="Process due follow-ups" desc="Send configured follow-ups when campaign timing rules are met." checked={draft.autoFollowUps} onChange={v => setField('autoFollowUps', v)} />
              <PermissionRow title="Launch prepared campaigns" desc="Autopilot can start campaigns that are ready and under daily action limits." checked={draft.autoLaunchCampaigns} onChange={v => setField('autoLaunchCampaigns', v)} />
              <PermissionRow title="Pause weak campaigns" desc="Flag or pause campaigns when bounce, reply, or click signals move outside guardrails." checked={draft.autoPauseLowQuality} onChange={v => setField('autoPauseLowQuality', v)} />
              <PermissionRow
                title="Call hot visitors"
                desc="Scale/Enterprise only. Trigger AI calls after identified prospects visit from campaign links."
                checked={draft.autoCallHotVisitors && !!canAutoCall}
                disabled={!canAutoCall}
                icon={<Phone className="w-4 h-4 text-[#1ED4A7]" />}
                onChange={v => setField('autoCallHotVisitors', v)}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#050505] p-5 space-y-4">
            <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Guardrails</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <Field label="Operating instructions">
              <textarea value={draft.guardrails} onChange={e => setField('guardrails', e.target.value)} rows={4} className={`${inputClass} resize-none`} />
            </Field>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[#1ED4A7]" />
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Current priorities</h3>
            </div>
            <div className="space-y-3">
              {(data?.recommendations || []).map(item => (
                <div key={item.id} className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{item.title}</p>
                    <span className="text-[10px] uppercase tracking-wider text-[#1ED4A7]">{item.priority}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{item.detail}</p>
                </div>
              ))}
              {(!data?.recommendations || data.recommendations.length === 0) && (
                <p className="text-sm text-zinc-500">No urgent priorities detected.</p>
              )}
            </div>
          </div>

          {data?.lastRun && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                <CheckCircle2 className="w-4 h-4 text-[#1ED4A7]" />
                Last agent pass
              </div>
              <p className="text-xs text-zinc-500 mt-1">{new Date(data.lastRun.ran_at).toLocaleString()}</p>
              <div className="mt-3 space-y-2">
                {(data.lastRun.actions || []).map((action: any, idx: number) => (
                  <div key={idx} className="text-xs text-zinc-600 dark:text-zinc-400">{action.label}</div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7]/50';

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${active ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' : 'bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[#1ED4A7]' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
      {active ? 'Active' : 'Paused'}
    </span>
  );
}

function ToggleSwitch({ checked, disabled, onChange }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? 'bg-zinc-900 dark:bg-white'
          : 'bg-zinc-200 dark:bg-white/[0.12]'
      }`}
    >
      <span
        className={`inline-block h-4.5 w-4.5 transform rounded-full transition-all duration-200 ease-in-out shadow-sm ${
          checked
            ? 'translate-x-[22px] bg-white dark:bg-zinc-900'
            : 'translate-x-[3px] bg-white dark:bg-zinc-400'
        }`}
        style={{ width: 18, height: 18 }}
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

function PermissionRow({ title, desc, checked, disabled, icon, onChange }: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-4 transition-colors ${checked ? 'border-[#1ED4A7]/25 bg-[#1ED4A7]/[0.04]' : 'border-zinc-200 bg-zinc-50 dark:border-white/[0.06] dark:bg-white/[0.02]'} ${disabled ? 'opacity-60' : 'hover:bg-zinc-100 dark:hover:bg-white/[0.04]'}`}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="mt-0.5 flex-shrink-0">{icon}</div>}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-zinc-900 dark:text-white">{title}</p>
            {disabled && <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:bg-white/[0.08]">Locked</span>}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}
