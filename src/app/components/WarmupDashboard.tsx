import { useState, useEffect, useCallback } from 'react';
import {
  Flame, Plus, Pause, Play, Trash2, AlertTriangle, CheckCircle2,
  Loader2, TrendingUp, Mail, Clock, BarChart3, Shield, X, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface WarmupAccount {
  id: string;
  email: string;
  provider: string;
  currentDay: number;
  currentDailyLimit: number;
  targetDailyLimit: number;
  warmupDurationDays: number;
  status: 'warming' | 'warmed' | 'paused' | 'suspended';
  totalSent: number;
  totalBounced: number;
  bounceRate: number;
  maxBounceRate: number;
  lastSentAt: string | null;
  schedule: { dayStart: number; dayEnd: number; dailyLimit: number }[];
  createdAt: string;
}

export function WarmupDashboard() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<WarmupAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newProvider, setNewProvider] = useState<'gmail' | 'outlook' | 'smtp'>('gmail');
  const [newTarget, setNewTarget] = useState(100);
  const [newDuration, setNewDuration] = useState(28);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/warmup/accounts`, { headers });
      if (res.ok) { const d = await res.json(); setAccounts(d.accounts || []); }
    } catch (err) { console.error('Failed to load warmup accounts:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startWarmup = async () => {
    if (!newEmail.trim()) { toast.error(t('senderRotation.enterEmail')); return; }
    setAdding(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/warmup/start`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, provider: newProvider, targetDailyLimit: newTarget, warmupDurationDays: newDuration }),
      });
      if (res.ok) {
        toast.success(t('warmupView.warmUpStarted'));
        setShowAdd(false); setNewEmail('');
        load();
      } else { const d = await res.json(); toast.error(d.error || t('common.failed')); }
    } catch { toast.error(t('common.error')); }
    finally { setAdding(false); }
  };

  const togglePause = async (id: string, currentStatus: string) => {
    const endpoint = currentStatus === 'paused' || currentStatus === 'suspended' ? 'resume' : 'pause';
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/warmup/${id}/${endpoint}`, { method: 'POST', headers });
      toast.success(endpoint === 'pause' ? t('warmupView.paused') : t('warmupView.resumed'));
      load();
    } catch { toast.error(t('common.failed')); }
  };

  const deleteAccount = async (id: string) => {
    if (!confirm(t('warmupView.removeConfirm'))) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/warmup/${id}`, { method: 'DELETE', headers });
      toast.success(t('warmupView.removed'));
      load();
    } catch { toast.error(t('common.failed')); }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'warming': return 'text-amber-500 bg-amber-50 dark:bg-amber-500/10';
      case 'warmed': return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10';
      case 'paused': return 'text-zinc-500 bg-zinc-100 dark:bg-white/5';
      case 'suspended': return 'text-red-500 bg-red-50 dark:bg-red-500/10';
      default: return 'text-zinc-400 bg-zinc-50';
    }
  };

  if (loading) return <LoadingSpinner size="lg" text={t('common.loading')} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-black dark:text-white flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-500 shrink-0" />
            {t('warmupView.title')}
          </h3>
          <p className="text-xs text-zinc-500 mt-1">{t('warmupView.description')}</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shrink-0 self-end sm:self-auto">
          <Plus className="w-3.5 h-3.5" /> {t('warmupView.addAccount')}
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="p-4 border border-zinc-200 dark:border-white/10 rounded-xl bg-zinc-50 dark:bg-white/[0.02]">
          <h4 className="text-sm font-semibold text-black dark:text-white mb-3">{t('warmupView.startWarmUp')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('warmupView.emailAccount')}</label>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="your@email.com" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('warmupView.provider')}</label>
              <select value={newProvider} onChange={e => setNewProvider(e.target.value as any)} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white">
                <option value="gmail">Gmail</option>
                <option value="outlook">Outlook</option>
                <option value="smtp">SMTP</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('warmupView.targetDailyLimit')}</label>
              <input type="number" value={newTarget} onChange={e => setNewTarget(parseInt(e.target.value) || 100)} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('warmupView.warmUpDuration')}</label>
              <input type="number" value={newDuration} onChange={e => setNewDuration(parseInt(e.target.value) || 28)} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={startWarmup} disabled={adding} className="px-4 py-2 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg disabled:opacity-50 flex items-center gap-1.5">
              {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Flame className="w-3 h-3" />}
              {t('warmupView.startWarmUp')}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-xs text-zinc-500">{t('warmupView.cancel')}</button>
          </div>
        </div>
      )}

      {/* Accounts */}
      {accounts.length === 0 && !showAdd ? (
        <div className="text-center py-16">
          <Flame className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <h4 className="text-sm font-medium text-zinc-500 mb-1">{t('warmupView.noWarmUpAccounts')}</h4>
          <p className="text-xs text-zinc-400">{t('warmupView.noWarmUpAccountsDesc')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map(acc => {
            const progress = Math.min(100, Math.round((acc.currentDay / acc.warmupDurationDays) * 100));

            return (
              <div key={acc.id} className="border border-zinc-200 dark:border-white/5 rounded-xl bg-white dark:bg-[#0a0a0a] p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-black dark:text-white">{acc.email}</h4>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getStatusColor(acc.status)}`}>
                        {acc.status === 'warming' && <Flame className="w-3 h-3 mr-1" />}
                        {acc.status === 'warmed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                        {acc.status === 'suspended' && <AlertTriangle className="w-3 h-3 mr-1" />}
                        {acc.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {acc.provider} &middot; {t('warmupView.dayOf', { current: acc.currentDay, total: acc.warmupDurationDays })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => togglePause(acc.id, acc.status)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                      {acc.status === 'paused' || acc.status === 'suspended' ? <Play className="w-4 h-4 text-emerald-500" /> : <Pause className="w-4 h-4 text-amber-500" />}
                    </button>
                    <button onClick={() => deleteAccount(acc.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                    <span>{t('warmupView.warmUpProgress')}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${
                      acc.status === 'suspended' ? 'bg-red-500' :
                      acc.status === 'warmed' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`} style={{ width: `${progress}%` }} />
                  </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-lg font-semibold text-black dark:text-white">{acc.currentDailyLimit}</p>
                    <p className="text-[10px] text-zinc-400">{t('warmupView.todaysLimit')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-black dark:text-white">{acc.targetDailyLimit}</p>
                    <p className="text-[10px] text-zinc-400">{t('warmupView.target')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-black dark:text-white">{acc.totalSent}</p>
                    <p className="text-[10px] text-zinc-400">{t('warmupView.totalSent')}</p>
                  </div>
                  <div className="text-center">
                    <p className={`text-lg font-semibold ${acc.bounceRate > acc.maxBounceRate ? 'text-red-500' : 'text-black dark:text-white'}`}>
                      {acc.bounceRate.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-zinc-400">{t('warmupView.bounceRate')}</p>
                  </div>
                </div>

                {/* Schedule Preview */}
                {acc.status === 'warming' && acc.schedule.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-white/5">
                    <p className="text-[11px] font-medium text-zinc-500 mb-2">{t('warmupView.warmUpSchedule')}</p>
                    <div className="flex gap-1">
                      {acc.schedule.map((phase, i) => {
                        const isActive = acc.currentDay >= phase.dayStart && acc.currentDay <= phase.dayEnd;
                        const isPast = acc.currentDay > phase.dayEnd;
                        return (
                          <div key={i} className={`flex-1 h-6 rounded text-[9px] font-medium flex items-center justify-center transition-colors ${
                            isActive ? 'bg-amber-500 text-white' :
                            isPast ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                            'bg-zinc-100 dark:bg-white/5 text-zinc-400'
                          }`}>
                            {phase.dailyLimit}/d
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {acc.status === 'suspended' && (
                  <div className="mt-3 p-3 bg-red-50 dark:bg-red-500/10 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-red-700 dark:text-red-400">{t('warmupView.accountSuspended')}</p>
                      <p className="text-[11px] text-red-600 dark:text-red-300">{t('warmupView.bounceExceeded', { rate: acc.bounceRate.toFixed(1), max: acc.maxBounceRate })}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default WarmupDashboard;
