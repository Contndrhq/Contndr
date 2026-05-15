import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, Upload, Trash2, Plus, Search, X, Download, Mail,
  Globe, AlertTriangle, CheckCircle2, Loader2, Ban, Eye,
  BarChart3, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

type ComplianceTab = 'overview' | 'unsubscribes' | 'blacklist';

export function ComplianceSettings() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ComplianceTab>('overview');
  const [stats, setStats] = useState<{ unsubscribedCount: number; blacklistedEmails: number; blacklistedDomains: number } | null>(null);
  const [unsubscribes, setUnsubscribes] = useState<string[]>([]);
  const [blacklistEmails, setBlacklistEmails] = useState<string[]>([]);
  const [blacklistDomains, setBlacklistDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [newEntry, setNewEntry] = useState('');
  const [newEntryType, setNewEntryType] = useState<'email' | 'domain'>('email');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [statsRes, unsubRes, blRes] = await Promise.all([
        fetch(`${API}/compliance/stats`, { headers }),
        fetch(`${API}/compliance/unsubscribes`, { headers }),
        fetch(`${API}/compliance/blacklist`, { headers }),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (unsubRes.ok) { const d = await unsubRes.json(); setUnsubscribes(d.emails || []); }
      if (blRes.ok) { const d = await blRes.json(); setBlacklistEmails(d.emails || []); setBlacklistDomains(d.domains || []); }
    } catch (err) { console.error('Failed to load compliance data:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const addToBlacklist = async () => {
    if (!newEntry.trim()) return;
    const entries = newEntry.split(/[,\n]/).map(e => e.trim()).filter(Boolean);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/compliance/blacklist`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, type: newEntryType }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(t('complianceView.addedToBlacklist', { count: data.added, type: newEntryType }));
        setNewEntry('');
        loadData();
      }
    } catch { toast.error(t('common.failed')); }
  };

  const removeFromBlacklist = async (entry: string, type: 'email' | 'domain') => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/compliance/blacklist`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [entry], type }),
      });
      if (res.ok) {
        toast.success(t('complianceView.removedFromBlacklist'));
        loadData();
      }
    } catch { toast.error(t('common.failed')); }
  };

  const resubscribe = async (email: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/compliance/unsubscribes`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        toast.success(t('complianceView.reSubscribed'));
        loadData();
      }
    } catch { toast.error(t('common.failed')); }
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/compliance/blacklist/import`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: text }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(t('complianceView.importedResult', { emails: data.emailsAdded, domains: data.domainsAdded }));
        loadData();
      }
    } catch { toast.error(t('common.failed')); }
    finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  if (loading) return <LoadingSpinner size="lg" text={t('common.loading')} />;

  const filteredUnsubs = unsubscribes.filter(e => !search || e.includes(search.toLowerCase()));
  const filteredBlEmails = blacklistEmails.filter(e => !search || e.includes(search.toLowerCase()));
  const filteredBlDomains = blacklistDomains.filter(e => !search || e.includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-black dark:text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-zinc-400" />
          {t('complianceView.title')}
        </h3>
        <p className="text-xs text-zinc-500 mt-1">{t('complianceView.description')}</p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Ban className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-xs font-medium text-zinc-500">{t('complianceView.unsubscribed')}</span>
            </div>
            <p className="text-2xl font-semibold text-black dark:text-white">{stats.unsubscribedCount}</p>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-xs font-medium text-zinc-500">{t('complianceView.blockedEmails')}</span>
            </div>
            <p className="text-2xl font-semibold text-black dark:text-white">{stats.blacklistedEmails}</p>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="text-xs font-medium text-zinc-500">{t('complianceView.blockedDomains')}</span>
            </div>
            <p className="text-2xl font-semibold text-black dark:text-white">{stats.blacklistedDomains}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-100 dark:bg-white/5 p-1 rounded-lg">
        {[
          { key: 'unsubscribes', label: t('complianceView.unsubscribes'), count: unsubscribes.length },
          { key: 'blacklist', label: t('complianceView.blacklistDnc'), count: blacklistEmails.length + blacklistDomains.length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as ComplianceTab)}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.key ? 'bg-white dark:bg-white/10 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('complianceView.search')}
          className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        )}
      </div>

      {/* Unsubscribes Tab */}
      {activeTab === 'unsubscribes' && (
        <div className="space-y-2">
          {filteredUnsubs.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">{t('complianceView.noUnsubscribesYet')}</p>
              <p className="text-xs mt-1">{t('complianceView.unsubscribeLinksAuto')}</p>
            </div>
          ) : (
            filteredUnsubs.map(email => (
              <div key={email} className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/5 rounded-lg">
                <div className="flex items-center gap-2">
                  <Ban className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-sm text-black dark:text-white font-mono">{email}</span>
                </div>
                <button onClick={() => resubscribe(email)} className="text-[11px] text-zinc-500 hover:text-black dark:hover:text-white px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                  {t('complianceView.reSubscribe')}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Blacklist Tab */}
      {activeTab === 'blacklist' && (
        <div className="space-y-4">
          {/* Add Entry */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex flex-col sm:flex-row gap-2">
              <select value={newEntryType} onChange={e => setNewEntryType(e.target.value as 'email' | 'domain')} className="px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white shrink-0">
                <option value="email">{t('common.email')}</option>
                <option value="domain">Domain</option>
              </select>
              <input value={newEntry} onChange={e => setNewEntry(e.target.value)} placeholder={newEntryType === 'email' ? 'john@competitor.com' : 'competitor.com'} className="flex-1 px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-black dark:text-white placeholder:text-zinc-400" onKeyDown={e => e.key === 'Enter' && addToBlacklist()} />
            </div>
            <div className="flex gap-2">
              <button onClick={addToBlacklist} className="px-3 py-2 text-xs font-medium bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-1.5 shrink-0">
                <Plus className="w-3 h-3" /> {t('common.add')}
              </button>
              <label className="px-3 py-2 text-xs font-medium bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300 shrink-0">
                <Upload className="w-3 h-3" /> {importing ? t('complianceView.importing') : t('complianceView.csv')}
                <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleCSVImport} className="hidden" />
              </label>
            </div>
          </div>

          {/* Blocked Emails */}
          {filteredBlEmails.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5">
                <Mail className="w-3 h-3" /> {t('complianceView.blockedEmails')} ({filteredBlEmails.length})
              </h4>
              <div className="space-y-1">
                {filteredBlEmails.slice(0, 50).map(email => (
                  <div key={email} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/5 rounded-lg">
                    <span className="text-sm text-black dark:text-white font-mono">{email}</span>
                    <button onClick={() => removeFromBlacklist(email, 'email')} className="p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                ))}
                {filteredBlEmails.length > 50 && (
                  <p className="text-xs text-zinc-400 text-center py-2">{t('complianceView.moreEntries', { count: filteredBlEmails.length - 50 })}</p>
                )}
              </div>
            </div>
          )}

          {/* Blocked Domains */}
          {filteredBlDomains.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5">
                <Globe className="w-3 h-3" /> {t('complianceView.blockedDomains')} ({filteredBlDomains.length})
              </h4>
              <div className="space-y-1">
                {filteredBlDomains.slice(0, 50).map(domain => (
                  <div key={domain} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/5 rounded-lg">
                    <span className="text-sm text-black dark:text-white font-mono">{domain}</span>
                    <button onClick={() => removeFromBlacklist(domain, 'domain')} className="p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredBlEmails.length === 0 && filteredBlDomains.length === 0 && !search && (
            <div className="text-center py-12 text-zinc-400">
              <Shield className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">{t('complianceView.noBlacklistEntries')}</p>
              <p className="text-xs mt-1">{t('complianceView.blacklistHelp')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ComplianceSettings;
