import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, Loader2, Phone, Play, Save } from 'lucide-react';
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
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/[0.08] dark:to-white/[0.03] flex items-center justify-center border border-zinc-200/80 dark:border-white/[0.06]">
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
            disabled={!canUseAgent || running}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-white/[0.08] text-[12.5px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.04] disabled:opacity-50"
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
          right={<ToggleSwitch checked={draft.enabled} disabled={!canUseAgent} onChange={checked => setField('enabled', checked)} />}
        />
        <div className="py-3.5 px-4">
          <div className="flex bg-zinc-100 dark:bg-white/[0.06] rounded-lg p-0.5 border border-zinc-200/60 dark:border-white/[0.06] w-full sm:w-fit">
            {[
              { id: 'supervised', title: 'Supervised' },
              { id: 'autopilot', title: 'Autopilot' },
            ].map(option => (
              <button
                key={option.id}
                onClick={() => setField('autonomyLevel', option.id as AgentModeConfig['autonomyLevel'])}
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
        <PermissionRow title="Process due follow-ups" desc="Send configured follow-ups when campaign timing rules are met." checked={draft.autoFollowUps} onChange={v => setField('autoFollowUps', v)} />
        <PermissionRow title="Launch prepared campaigns" desc="Start ready campaigns within daily action limits." checked={draft.autoLaunchCampaigns} onChange={v => setField('autoLaunchCampaigns', v)} />
        <PermissionRow title="Pause weak campaigns" desc="Flag or pause campaigns when performance moves outside guardrails." checked={draft.autoPauseLowQuality} onChange={v => setField('autoPauseLowQuality', v)} />
        <PermissionRow
          title="Call hot visitors"
          desc="Scale/Enterprise only. Trigger AI calls after identified prospects visit from campaign links."
          checked={draft.autoCallHotVisitors && !!canAutoCall}
          disabled={!canAutoCall}
          icon={Phone}
          onChange={v => setField('autoCallHotVisitors', v)}
        />
      </SettingsSection>

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

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">{title}</h3>
        <div className="flex-1 h-px bg-zinc-100 dark:bg-white/[0.06]" />
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

function SettingRow({ icon: Icon, title, desc, right }: {
  icon: typeof Bot;
  title: string;
  desc: string;
  right: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-white/[0.06] flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors shrink-0">
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
    <div className={`flex items-center justify-between py-3.5 px-4 rounded-xl transition-colors group ${disabled ? 'opacity-60' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.02]'}`}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-white/[0.06] flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors shrink-0">
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
