import { useState, useEffect, useRef } from 'react';
import { Globe, Plus, X, Copy, Check, Trash2, ChevronDown, ChevronUp, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { authenticatedFetch } from '../lib/auth';
import { useTranslation } from 'react-i18next';

interface TrackedWebsite {
  id: string;
  url: string;
  domain: string;
  addedAt: string;
  status: 'pending' | 'active' | 'inactive';
  lastVisit?: string;
  visitCount: number;
}

export function WebTrackingManager() {
  const { t } = useTranslation();
  const [websites, setWebsites] = useState<TrackedWebsite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [expandedSite, setExpandedSite] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        setUserId(data.session.user.id);
      }
    });
  }, []);

  useEffect(() => {
    if (userId) loadWebsites();
  }, [userId]);

  async function loadWebsites(isRefresh = false) {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/tracked-websites`
      );
      if (response.ok) {
        const data = await response.json();
        setWebsites(data.websites || []);
        setLoadError(false);
        // If server flagged a possible load error (e.g. timeout returned partial/empty results)
        if (data.loadError && data.websites?.length === 0) {
          setLoadError(true);
        }
        if (isRefresh) toast.success(t('tracking.refreshed'));
        
        // Auto-retry once on initial load if we got 0 results 
        // (the index might not be built yet, so the LIKE query may have timed out)
        if (!isRefresh && !initialLoadDone.current && data.websites?.length === 0 && !data.loadError) {
          initialLoadDone.current = true;
          console.log('[WebTrackingManager] Initial load returned 0 websites, auto-retrying in 2s...');
          setTimeout(() => loadWebsites(true), 2000);
          return; // Keep loading state while retry happens
        }
        initialLoadDone.current = true;
      } else {
        const err = await response.json().catch(() => ({}));
        console.error('Failed to load tracked websites:', err);
        if (isRefresh) toast.error(t('tracking.failedToRefresh'));
        setLoadError(true);
      }
    } catch (err) {
      console.error('Failed to load tracked websites:', err);
      if (isRefresh) toast.error(t('tracking.failedToRefresh'));
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function extractDomain(input: string): string {
    try {
      let url = input.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return input.trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  async function handleAddWebsite() {
    if (!urlInput.trim()) {
      toast.error(t('tracking.errorEmptyUrl'));
      return;
    }

    const domain = extractDomain(urlInput);
    if (!domain || !domain.includes('.')) {
      toast.error(t('tracking.errorInvalidUrl'));
      return;
    }

    // Check for duplicate
    if (websites.some(w => w.domain === domain)) {
      toast.error(t('tracking.errorDuplicate'));
      return;
    }

    setSaving(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/tracked-websites`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlInput.trim(), domain }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        toast.success(t('tracking.successAdded'));
        setWebsites(prev => [...prev, data.website]);
        setUrlInput('');
        setShowAddModal(false);
        setExpandedSite(data.website.id);
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || t('tracking.errorAddFailed'));
      }
    } catch (err) {
      toast.error(t('tracking.errorAddFailed'));
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteWebsite(id: string) {
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/tracked-websites/${id}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setWebsites(prev => prev.filter(w => w.id !== id));
        setDeleteConfirm(null);
        if (expandedSite === id) setExpandedSite(null);
        toast.success(t('tracking.successRemoved'));
      } else {
        toast.error(t('tracking.errorRemoveFailed'));
      }
    } catch (err) {
      toast.error(t('tracking.errorRemoveFailed'));
      console.error(err);
    }
  }

  function getPixelCode(site: TrackedWebsite): string {
    return `<script src="https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/track/js?uid=${userId}&d=${site.domain}"></script>`;
  }

  function handleCopyCode(siteId: string, code: string) {
    navigator.clipboard.writeText(code);
    setCopiedId(siteId);
    toast.success(t('tracking.copiedToClipboard'));
    setTimeout(() => setCopiedId(null), 2000);
  }

  function getStatusConfig(status: string) {
    switch (status) {
      case 'active':
        return { label: t('tracking.statusConnected'), dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' };
      case 'pending':
        return { label: t('tracking.pendingSetup'), dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' };
      default:
        return { label: t('tracking.statusInactive'), dot: 'bg-zinc-400', text: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-50 dark:bg-zinc-900/50' };
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
            {t('tracking.websiteVisitors')}
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t('tracking.websiteVisitorsDesc')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(websites.length > 0 || loadError) && (
            <button
              onClick={() => { setLoadError(false); loadWebsites(true); }}
              disabled={refreshing}
              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
              title={t('tracking.refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
          >
            <Plus className="w-4 h-4" />
            {t('tracking.addWebsite')}
          </button>
        </div>
      </div>

      {/* Website List */}
      {loading ? (
        <div className="py-12 text-center">
          <div className="w-5 h-5 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-sm text-zinc-500 mt-3">{t('tracking.loadingWebsites')}</p>
        </div>
      ) : loadError ? (
        /* Error State — websites may exist but failed to load */
        <div className="border border-dashed border-amber-500/30 dark:border-amber-500/20 rounded-xl py-10 px-6 text-center bg-amber-50/50 dark:bg-amber-950/10">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
          </div>
          <h4 className="text-sm font-medium text-zinc-900 dark:text-white mb-1">
            {t('tracking.couldntLoad')}
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto mb-5">
            {t('tracking.couldntLoadDesc')}
          </p>
          <button
            onClick={() => { setLoadError(false); loadWebsites(true); }}
            disabled={refreshing}
            className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors inline-flex items-center gap-2 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? t('tracking.retrying') : t('tracking.retry')}
          </button>
        </div>
      ) : websites.length === 0 ? (
        /* Empty State */
        <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl py-12 px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <Globe className="w-6 h-6 text-zinc-400" />
          </div>
          <h4 className="text-sm font-medium text-zinc-900 dark:text-white mb-1">
            {t('tracking.noWebsitesYet')}
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto mb-5">
            {t('tracking.noWebsitesDesc')}
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
          >
            <Plus className="w-4 h-4" />
            {t('tracking.addWebsite')}
          </button>
        </div>
      ) : (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {websites.map(site => {
            const status = getStatusConfig(site.status);
            const isExpanded = expandedSite === site.id;
            const isDeleting = deleteConfirm === site.id;

            return (
              <div key={site.id} className="bg-white dark:bg-[#0A0A0A]">
                {/* Site Row */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                    <Globe className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                        {site.domain}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${status.bg} ${status.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${site.status === 'active' ? 'animate-pulse' : ''}`} />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">
                      {site.visitCount > 0 
                        ? `${site.visitCount.toLocaleString()} ${site.visitCount !== 1 ? t('tracking.visitsPlural') : t('tracking.visits')}${site.lastVisit ? ` · ${t('tracking.lastVisit')} ${new Date(site.lastVisit).toLocaleDateString()}` : ''}`
                        : `${t('tracking.added')} ${new Date(site.addedAt).toLocaleDateString()}`
                      }
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {isDeleting ? (
                      <>
                        <button
                          onClick={() => handleDeleteWebsite(site.id)}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
                        >
                          {t('tracking.confirm')}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
                        >
                          {t('tracking.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setExpandedSite(isExpanded ? null : site.id)}
                          className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
                          title={t('tracking.setupInstructions')}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(site.id)}
                          className="p-2 text-zinc-400 hover:text-red-500 transition-colors rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
                          title={t('tracking.removeWebsite')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded Setup Instructions */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="mt-3 p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {t('tracking.addToHead')} <code className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-[11px]">&lt;head&gt;</code>
                        </p>
                        <button
                          onClick={() => handleCopyCode(site.id, getPixelCode(site))}
                          className="px-2.5 py-1 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-medium rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
                        >
                          {copiedId === site.id ? (
                            <>
                              <Check className="w-3 h-3" />
                              {t('tracking.copied')}
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              {t('tracking.copy')}
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="p-3 bg-zinc-900 dark:bg-black rounded-md overflow-x-auto text-xs font-mono text-zinc-300 leading-relaxed">
                        {getPixelCode(site)}
                      </pre>
                      <p className="mt-2.5 text-[11px] text-zinc-500 dark:text-zinc-500 leading-relaxed">
                        {t('tracking.scriptRunsBackground', { domain: site.domain })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pro tip */}
      {websites.length > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-500 flex items-center gap-1.5">
          <span className="inline-block w-1 h-1 rounded-full bg-zinc-400" />
          {t('tracking.autoTrackedNote')}
        </p>
      )}

      {/* Add Website Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-md bg-white dark:bg-[#0A0A0A] rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-0">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
                {t('tracking.addNewDomain')}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('tracking.domainInputDesc')}
              </p>

              {/* URL Input */}
              <div>
                <label className="block text-sm font-medium text-zinc-900 dark:text-white mb-1.5">
                  {t('tracking.websiteUrl')}<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddWebsite()}
                  placeholder="https://yourdomain.com"
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#111] border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 transition-all"
                  autoFocus
                />
              </div>

              {/* Domain Preview */}
              {urlInput.trim() && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg">
                  <Globe className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {t('tracking.willTrack')} <strong className="text-zinc-900 dark:text-white">{extractDomain(urlInput)}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
              >
                {t('tracking.cancel')}
              </button>
              <button
                onClick={handleAddWebsite}
                disabled={saving || !urlInput.trim()}
                className="px-5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
              >
                {saving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 dark:border-zinc-900/30 border-t-white dark:border-t-zinc-900 rounded-full animate-spin" />
                    {t('tracking.saving')}
                  </>
                ) : (
                  t('tracking.save')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}