import { useCallback, useEffect, useState } from 'react';
import { Bot, ChevronRight, Loader2, Play, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

export function DashboardAgentMode({ onNavigate }: { onNavigate: (view: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/agent-mode`);
      const json = await res.json();
      if (res.ok) setData(json);
    } catch (_) {
      // Dashboard should stay quiet if the agent endpoint is temporarily unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/agent-mode/run`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Agent run failed');
      setData((prev: any) => ({ ...prev, lastRun: json.run, recommendations: json.recommendations || prev?.recommendations || [] }));
      toast.success('Agent Mode checked the workspace', {
        description: `${json.run?.actions?.length || 0} action(s) evaluated`,
      });
    } catch (err: any) {
      toast.error('Agent Mode failed', { description: err.message });
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card h-full p-5 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  const config = data?.config || {};
  const enabled = !!config.enabled;
  const priorities = data?.recommendations || [];
  const canUse = data?.entitlements?.agentMode;

  return (
    <div className="glass-card h-full p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${enabled ? 'bg-[#1ED4A7]/10' : 'bg-zinc-100 dark:bg-zinc-900'}`}>
              <Bot className={`w-4 h-4 ${enabled ? 'text-[#1ED4A7]' : 'text-zinc-400'}`} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white">Agent Mode</h3>
              <p className="text-xs text-zinc-500">{enabled ? `${config.autonomyLevel === 'autopilot' ? 'Autopilot' : 'Supervised'} active` : canUse ? 'Ready to activate' : 'Premium automation'}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'agent-mode' }));
            onNavigate('settings');
          }}
          className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          title="Configure Agent Mode"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <MiniStat icon={Sparkles} label="Actions" value={String(config.maxDailyActions || 0)} />
        <MiniStat icon={ShieldCheck} label="Follow-ups" value={config.autoFollowUps ? 'On' : 'Off'} />
        <MiniStat icon={Bot} label="Calls" value={config.autoCallHotVisitors ? 'On' : 'Off'} />
      </div>

      <div className="flex-1 min-h-0 space-y-2 overflow-hidden">
        {priorities.slice(0, 3).map((item: any) => (
          <div key={item.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{item.title}</p>
              <span className="text-[9px] uppercase tracking-wider text-[#1ED4A7]">{item.priority}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{item.detail}</p>
          </div>
        ))}
        {priorities.length === 0 && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 p-4 text-sm text-zinc-500">
            No urgent priorities. The workspace is quiet.
          </div>
        )}
      </div>

      <button
        onClick={run}
        disabled={!canUse || running}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Run Agent Pass
      </button>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-2">
      <Icon className="w-3.5 h-3.5 text-[#1ED4A7] mb-1" />
      <p className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-sm font-bold text-zinc-900 dark:text-white">{value}</p>
    </div>
  );
}

