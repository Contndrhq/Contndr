import { useState, useEffect, useCallback } from 'react';
import { Linkedin, UserPlus, Send, CheckCircle2, X, ExternalLink, Copy, Loader2, ListTodo, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface LinkedInTask {
  id: string;
  sequenceId: string;
  sequenceName: string;
  stepNumber: number;
  channel: 'linkedin_connect' | 'linkedin_message';
  leadId: string;
  leadEmail: string;
  leadName: string;
  leadCompany: string;
  message: string;
  status: 'pending' | 'completed' | 'skipped';
  createdAt: string;
  completedAt?: string;
}

export function LinkedInTasks() {
  const [tasks, setTasks] = useState<LinkedInTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'completed' | 'all'>('pending');
  const [updating, setUpdating] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/linkedin-tasks?status=${filter}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('Failed to load LinkedIn tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const updateTask = async (taskId: string, status: 'completed' | 'skipped') => {
    setUpdating(taskId);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/linkedin-tasks/${taskId}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      toast.success(status === 'completed' ? 'Marked as done' : 'Skipped');
      setTasks(prev => prev.filter(t => filter === 'all' ? true : t.id !== taskId).map(t => t.id === taskId ? { ...t, status } : t));
      if (filter !== 'all') {
        setTasks(prev => prev.filter(t => t.id !== taskId));
      }
    } catch { toast.error('Failed to update task'); }
    finally { setUpdating(null); }
  };

  const copyMessage = (msg: string) => {
    navigator.clipboard.writeText(msg);
    toast.success('Copied to clipboard');
  };

  if (loading) return <LoadingSpinner size="lg" text="Loading LinkedIn tasks..." />;

  const pendingCount = tasks.filter(t => t.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-black dark:text-white flex items-center gap-2">
            <Linkedin className="w-4 h-4 text-[#0A66C2] shrink-0" />
            LinkedIn Tasks
          </h3>
          <p className="text-xs text-zinc-500 mt-1">
            Manual touchpoints from your multi-channel sequences.
            {pendingCount > 0 && <span className="text-[#0A66C2] font-medium"> {pendingCount} pending</span>}
          </p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-1 p-0.5 bg-zinc-100 dark:bg-white/5 rounded-lg shrink-0">
          {(['pending', 'completed', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setLoading(true); }}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors capitalize ${
                filter === f
                  ? 'bg-white dark:bg-zinc-800 text-black dark:text-white shadow-sm'
                  : 'text-zinc-500 hover:text-black dark:hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Tasks */}
      {tasks.length === 0 ? (
        <div className="text-center py-12">
          <ListTodo className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">
            {filter === 'pending' ? 'No pending LinkedIn tasks' : 'No tasks found'}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Tasks are created when sequences process LinkedIn touchpoints.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {tasks.map(task => (
            <div
              key={task.id}
              className={`border rounded-xl transition-colors ${
                task.status === 'pending'
                  ? 'border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a]'
                  : 'border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.01] opacity-60'
              }`}
            >
              <div className="px-4 py-3">
                <div className="flex items-start gap-3">
                  {/* Channel icon */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    task.channel === 'linkedin_connect' ? 'bg-[#0A66C2]/10' : 'bg-[#0A66C2]/10'
                  }`}>
                    {task.channel === 'linkedin_connect'
                      ? <UserPlus className="w-3.5 h-3.5 text-[#0A66C2]" />
                      : <Send className="w-3.5 h-3.5 text-[#0A66C2]" />
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-black dark:text-white">
                        {task.leadName}
                      </span>
                      {task.leadCompany && (
                        <span className="text-[11px] text-zinc-400">at {task.leadCompany}</span>
                      )}
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        task.channel === 'linkedin_connect'
                          ? 'bg-[#0A66C2]/10 text-[#0A66C2]'
                          : 'bg-[#0A66C2]/10 text-[#0A66C2]'
                      }`}>
                        {task.channel === 'linkedin_connect' ? 'Connect' : 'Message'}
                      </span>
                    </div>

                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {task.sequenceName} &middot; Step {task.stepNumber}
                    </p>

                    {/* Message preview */}
                    {task.message && (
                      <div className="mt-2 p-2.5 bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5 rounded-lg">
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap line-clamp-3">
                          {task.message}
                        </p>
                        <button
                          onClick={() => copyMessage(task.message)}
                          className="flex items-center gap-1 mt-1.5 text-[10px] font-medium text-zinc-400 hover:text-[#0A66C2] transition-colors"
                        >
                          <Copy className="w-3 h-3" /> Copy to clipboard
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {task.status === 'pending' && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateTask(task.id, 'completed')}
                        disabled={updating === task.id}
                        className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
                        title="Mark as done"
                      >
                        {updating === task.id
                          ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                          : <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        }
                      </button>
                      <button
                        onClick={() => updateTask(task.id, 'skipped')}
                        disabled={updating === task.id}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                        title="Skip"
                      >
                        <X className="w-4 h-4 text-zinc-400" />
                      </button>
                    </div>
                  )}
                  {task.status === 'completed' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-1" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
