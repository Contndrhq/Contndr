import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Bot, Loader2, Play, Phone, ShieldCheck, Sparkles } from 'lucide-react';
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

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail) setData(detail);
      else load();
    };
    window.addEventListener('agent-mode-updated', onUpdated);
    return () => window.removeEventListener('agent-mode-updated', onUpdated);
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

  const statusText = enabled
    ? `${config.autonomyLevel === 'autopilot' ? 'Autopilot' : 'Supervised'} active`
    : canUse
      ? 'Ready to activate'
      : 'Premium automation';

  return (
    <div className="glass-card h-full p-4 sm:p-5 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
            Agent Mode
          </h3>
          <span className={`text-[10px] font-medium truncate ${enabled ? 'text-[#1ED4A7]' : 'text-zinc-400 dark:text-zinc-500'}`}>
            {statusText}
          </span>
        </div>
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'agent-mode' }));
            onNavigate('settings');
          }}
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-[#1ED4A7] transition-colors"
          title="Configure Agent Mode"
        >
          Configure <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <MiniStat icon={Sparkles} label="Actions" value={String(config.maxDailyActions || 0)} />
        <MiniStat icon={ShieldCheck} label="Follow-ups" value={config.autoFollowUps ? 'On' : 'Off'} />
        <MiniStat icon={Phone} label="Calls" value={config.autoCallHotVisitors ? 'On' : 'Off'} />
      </div>

      <div className="flex-1 min-h-0 space-y-1.5 overflow-hidden border-t border-zinc-200 dark:border-white/[0.06] pt-3">
        {priorities.slice(0, 3).map((item: any) => (
          <div key={item.id} className="rounded-lg px-2.5 py-2 hover:bg-zinc-50/70 dark:hover:bg-white/[0.03] transition-colors">
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${item.priority === 'high' ? 'bg-[#1ED4A7]' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{item.title}</p>
                  <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex-shrink-0">{item.priority}</span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5 line-clamp-1">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
        {priorities.length === 0 && (
          <div className="rounded-lg px-2.5 py-4 text-[12px] text-zinc-500">
            No urgent priorities. The workspace is quiet.
          </div>
        )}
      </div>

      <button
        onClick={run}
        disabled={!canUse || running}
        className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-50 dark:bg-white/[0.04] text-zinc-700 dark:text-zinc-300 text-[12px] font-medium hover:bg-zinc-100 dark:hover:bg-white/[0.07] hover:text-zinc-900 dark:hover:text-white transition-colors disabled:opacity-50 border border-zinc-200 dark:border-white/[0.06]"
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        Run Agent Pass
      </button>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-zinc-50/60 dark:bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-[#1ED4A7]" />
        <p className="text-[9px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 truncate">{label}</p>
      </div>
      <p className="text-[13px] font-bold text-zinc-900 dark:text-white leading-none">{value}</p>
    </div>
  );
}
