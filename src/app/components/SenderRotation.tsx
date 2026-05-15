import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Plus, Trash2, Settings, Mail, CheckCircle2,
  Loader2, BarChart3, AlertCircle, X, Shield, Flame, Link
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getAuthHeaders, getAuthToken } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';
import { GmailIcon } from './GmailIcon';
import { OutlookIcon } from './OutlookIcon';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface SenderAccount {
  id: string;
  email: string;
  provider: string;
  dailyLimit: number;
  sentToday: number;
  enabled: boolean;
  warmupStatus: string;
  connected: boolean;
  displayName?: string;
  addedAt: string;
}

interface RotationConfig {
  enabled: boolean;
  strategy: 'round_robin' | 'least_used' | 'random';
  currentIndex: number;
  globalDailyLimit: number;
}

export function SenderRotation() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<SenderAccount[]>([]);
  const [config, setConfig] = useState<RotationConfig>({ enabled: false, strategy: 'round_robin', currentIndex: 0, globalDailyLimit: 200 });
  const [totalSentToday, setTotalSentToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [connectingOAuth, setConnectingOAuth] = useState<'gmail' | 'outlook' | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newProvider, setNewProvider] = useState<'gmail' | 'outlook' | 'smtp'>('gmail');
  const [newDailyLimit, setNewDailyLimit] = useState(50);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);

  // Handle OAuth callback for rotation mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthEmail = params.get('oauth_email');
    const oauthProvider = params.get('oauth_provider');
    
    if (oauthEmail && oauthProvider && (oauthProvider === 'gmail_rotation' || oauthProvider === 'outlook_rotation')) {
      window.history.replaceState({}, '', window.location.pathname);
      toast.success(`Connected ${oauthEmail} for sender rotation`);
      setLoading(true);
      load();
    }
  }, []);

  async function connectOAuth(type: 'gmail' | 'outlook') {
    setConnectingOAuth(type);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('senderRotation.signInFirst'));
        setConnectingOAuth(null);
        return;
      }
      const returnPath = '/app/settings';
      const returnUrl = `${window.location.origin}${returnPath}`;
      const url = `${API.replace('/functions/v1/make-server-a8b2511f', '')}/functions/v1/make-server-a8b2511f/auth/${type}/connect?token=${encodeURIComponent(token)}&origin=${encodeURIComponent(returnUrl)}&mode=rotation`;
      window.location.href = url;
    } catch (err: any) {
      console.error('[ROTATION] OAuth connect error:', err);
      toast.error(err.message || 'Failed to connect');
      setConnectingOAuth(null);
    }
  }

  const load = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sender-rotation/accounts`, { headers });
      if (res.ok) {
        const d = await res.json();
        setAccounts(d.accounts || []);
        if (d.config) setConfig(d.config);
        if (d.stats) setTotalSentToday(d.stats.totalSentToday || 0);
      }
    } catch (err) { console.error('Failed to load sender accounts:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addAccount = async () => {
    if (!newEmail.trim()) { toast.error(t('senderRotation.enterEmail')); return; }
    setAdding(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sender-rotation/accounts`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, provider: newProvider, dailyLimit: newDailyLimit, displayName: newDisplayName, enabled: true, connected: true, warmupStatus: 'not_started' }),
      });
      if (res.ok) {
        toast.success(t('senderRotation.accountAdded'));
        setShowAdd(false); setNewEmail(''); setNewDisplayName('');
        load();
      }
    } catch { toast.error(t('common.failed')); }
    finally { setAdding(false); }
  };

  const removeAccount = async (id: string) => {
    if (!confirm(t('senderRotation.removeSenderConfirm'))) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/sender-rotation/accounts/${id}`, { method: 'DELETE', headers });
      toast.success(t('senderRotation.removed'));
      load();
    } catch { toast.error(t('common.failed')); }
  };

  const toggleAccount = async (id: string, enabled: boolean) => {
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/sender-rotation/accounts/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, enabled } : a));
    } catch { toast.error(t('common.failed')); }
  };

  const saveConfig = async (updates: Partial<RotationConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/sender-rotation/config`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      toast.success(t('senderRotation.settingsSaved'));
    } catch { toast.error(t('common.failed')); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingSpinner size="lg" text={t('common.loading')} />;

  const enabledCount = accounts.filter(a => a.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-black dark:text-white flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-zinc-400 shrink-0" />
            {t('senderRotation.title')}
          </h3>
          <p className="text-xs text-zinc-500 mt-1">{t('senderRotation.description')}</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shrink-0 self-end sm:self-auto">
          <Plus className="w-3.5 h-3.5" /> {t('senderRotation.addAccount')}
        </button>
      </div>

      {/* Master Toggle & Config */}
      <div className="p-4 border border-zinc-200 dark:border-white/10 rounded-xl bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => saveConfig({ enabled: !config.enabled })}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 appearance-none border-0 p-0 cursor-pointer ${config.enabled ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-zinc-600'}`}
              style={{ minWidth: '2.75rem', minHeight: '1.5rem', maxWidth: '2.75rem', maxHeight: '1.5rem' }}
            >
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-medium text-black dark:text-white">{t('senderRotation.enableRotation')}</p>
              <p className="text-[11px] text-zinc-400">{enabledCount !== 1 ? t('senderRotation.accountsActive', { count: enabledCount }) : t('senderRotation.accountActive', { count: enabledCount })}</p>
            </div>
          </div>
          {config.enabled && (
            <div className="text-right shrink-0">
              <p className="text-lg font-semibold text-black dark:text-white">{totalSentToday}<span className="text-zinc-400 text-sm">/{config.globalDailyLimit}</span></p>
              <p className="text-[10px] text-zinc-400">{t('senderRotation.sentToday')}</p>
            </div>
          )}
        </div>

        {config.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('senderRotation.strategy')}</label>
              <select
                value={config.strategy}
                onChange={e => saveConfig({ strategy: e.target.value as any })}
                className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white"
              >
                <option value="round_robin">{t('senderRotation.roundRobin')}</option>
                <option value="least_used">{t('senderRotation.leastUsedFirst')}</option>
                <option value="random">{t('senderRotation.random')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('senderRotation.globalDailyLimit')}</label>
              <input
                type="number"
                value={config.globalDailyLimit}
                onChange={e => saveConfig({ globalDailyLimit: parseInt(e.target.value) || 200 })}
                className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Add Account Form */}
      {showAdd && (
        <div className="p-4 border border-zinc-200 dark:border-white/10 rounded-xl bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950">
          <h4 className="text-sm font-semibold text-black dark:text-white mb-3">{t('senderRotation.addSenderAccount')}</h4>
          
          {/* OAuth Connect Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => connectOAuth('gmail')}
              disabled={connectingOAuth === 'gmail'}
              className="flex items-center gap-3 p-4 rounded-xl border-2 border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 bg-white dark:bg-white/5 transition-all text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-white dark:bg-white flex items-center justify-center shrink-0 border border-zinc-100 dark:border-transparent">
                <GmailIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-black dark:text-white">{t('senderRotation.connectGmail')}</p>
                <p className="text-[11px] text-zinc-400">{t('senderRotation.gmailDesc')}</p>
              </div>
              {connectingOAuth === 'gmail' && <Loader2 className="w-4 h-4 text-zinc-400 animate-spin shrink-0 ml-auto" />}
            </button>
            <button
              onClick={() => connectOAuth('outlook')}
              disabled={connectingOAuth === 'outlook'}
              className="flex items-center gap-3 p-4 rounded-xl border-2 border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 bg-white dark:bg-white/5 transition-all text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-white/10 flex items-center justify-center shrink-0">
                <OutlookIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-black dark:text-white">{t('senderRotation.connectOutlook')}</p>
                <p className="text-[11px] text-zinc-400">{t('senderRotation.outlookDesc')}</p>
              </div>
              {connectingOAuth === 'outlook' && <Loader2 className="w-4 h-4 text-zinc-400 animate-spin shrink-0 ml-auto" />}
            </button>
          </div>
          
          <p className="text-[11px] text-zinc-400 mb-3">{t('senderRotation.oauthAccountNote')}</p>

          {/* Manual Add Toggle */}
          <div className="border-t border-zinc-200 dark:border-white/10 pt-3 mt-3">
            <button
              onClick={() => setShowManualAdd(!showManualAdd)}
              className="text-[11px] text-zinc-500 hover:text-black dark:hover:text-white transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              {showManualAdd ? t('senderRotation.hideManualEntry') : t('senderRotation.orAddManually')}
            </button>
          </div>

          {showManualAdd && (
            <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('senderRotation.email')}</label>
                  <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="send@yourdomain.com" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('senderRotation.displayName')}</label>
                  <input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="Your Name" className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('senderRotation.provider')}</label>
                  <select value={newProvider} onChange={e => setNewProvider(e.target.value as any)} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white">
                    <option value="gmail">Gmail</option>
                    <option value="outlook">Outlook</option>
                    <option value="smtp">SMTP</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">{t('senderRotation.dailyLimit')}</label>
                  <input type="number" value={newDailyLimit} onChange={e => setNewDailyLimit(parseInt(e.target.value) || 50)} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white" />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={addAccount} disabled={adding} className="px-4 py-2 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                  {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  {t('senderRotation.addAccount')}
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-end mt-3">
            <button onClick={() => { setShowAdd(false); setShowManualAdd(false); }} className="px-4 py-2 text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">{t('senderRotation.close')}</button>
          </div>
        </div>
      )}

      {/* Account List */}
      {accounts.length === 0 && !showAdd ? (
        <div className="text-center py-16">
          <Mail className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <h4 className="text-sm font-medium text-zinc-500 mb-1">{t('senderRotation.noSenderAccounts')}</h4>
          <p className="text-xs text-zinc-400">{t('senderRotation.noSenderAccountsDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map(acc => {
            const usagePercent = acc.dailyLimit > 0 ? Math.round((acc.sentToday / acc.dailyLimit) * 100) : 0;

            return (
              <div key={acc.id} className={`flex items-center gap-4 px-4 py-3 border rounded-xl transition-colors ${
                acc.enabled ? 'border-zinc-200 dark:border-white/5 bg-white dark:bg-[#0a0a0a]' : 'border-zinc-100 dark:border-white/[0.03] bg-zinc-50 dark:bg-white/[0.01] opacity-60'
              }`}>
                {/* Toggle */}
                <button
                  onClick={() => toggleAccount(acc.id, !acc.enabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${acc.enabled ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${acc.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-black dark:text-white truncate max-w-[180px] sm:max-w-none">{acc.email}</p>
                    <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded">{acc.provider}</span>
                    {acc.connected && (
                      <span className="text-[10px] text-[#1ED4A7] flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> {t('senderRotation.connected')}</span>
                    )}
                    {acc.warmupStatus === 'warming' && (
                      <span className="text-[10px] text-zinc-500 flex items-center gap-0.5"><Flame className="w-2.5 h-2.5" /> {t('senderRotation.warming')}</span>
                    )}
                  </div>
                  {acc.displayName && <p className="text-[11px] text-zinc-400 truncate">{acc.displayName}</p>}
                </div>

                {/* Usage Bar */}
                <div className="w-24 hidden sm:block">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-0.5">
                    <span>{acc.sentToday}</span>
                    <span>/{acc.dailyLimit}</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${usagePercent > 90 ? 'bg-zinc-400' : usagePercent > 60 ? 'bg-zinc-500' : 'bg-[#1ED4A7]'}`} style={{ width: `${Math.min(100, usagePercent)}%` }} />
                  </div>
                </div>

                {/* Delete */}
                <button onClick={() => removeAccount(acc.id)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SenderRotation;
