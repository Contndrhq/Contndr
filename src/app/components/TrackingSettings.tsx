/**
 * TrackingSettings
 * ────────────────
 * Clean, minimal "Tracking" tab inside Settings.
 * Two sections: your websites + your tracking script. That's it.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Globe,
  Copy,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  RefreshCw,
  X,
  Code2,
  ExternalLink,
  Tag,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { authenticatedFetch } from '../lib/auth';

/* ─── Types ──────────────────────────────────────────────── */

interface TrackedWebsite {
  id: string;
  url: string;
  domain: string;
  addedAt: string;
  status: 'pending' | 'active' | 'inactive';
  lastVisit?: string;
  visitCount: number;
}

/* ─── Main Export ────────────────────────────────────────── */

export function TrackingSettings() {
  const { t } = useTranslation();
  const [websites, setWebsites] = useState<TrackedWebsite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [expandedSite, setExpandedSite] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState('sourcr');
  const [showScript, setShowScript] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [testing, setTesting] = useState(false);

  /* Auth */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        setUserId(data.session.user.id);
        setUserEmail(data.session.user.email || null);
      }
    });
  }, []);

  useEffect(() => {
    if (userId) loadWebsites();
  }, [userId]);

  /* Data */
  async function loadWebsites(isRefresh = false) {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/tracked-websites`
      );
      if (response.ok) {
        const data = await response.json();
        setWebsites(data.websites || []);
        if (isRefresh) toast.success(t('tracking.refreshed', 'Refreshed'));
      }
    } catch (err) {
      console.error('Failed to load tracked websites:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function extractDomain(input: string): string {
    try {
      let url = input.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return input.trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  async function handleAddWebsite() {
    if (!urlInput.trim()) { toast.error(t('tracking.errorEmptyUrl')); return; }
    const domain = extractDomain(urlInput);
    if (!domain || !domain.includes('.')) { toast.error(t('tracking.errorInvalidUrl')); return; }
    if (websites.some(w => w.domain === domain)) { toast.error(t('tracking.errorDuplicate')); return; }
    setSaving(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/tracked-websites`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: urlInput.trim(), domain }) }
      );
      if (response.ok) {
        const data = await response.json();
        toast.success(t('tracking.successAdded'));
        setWebsites(prev => [...prev, data.website]);
        setUrlInput('');
        setShowAddForm(false);
        setExpandedSite(data.website.id);
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || t('tracking.errorAddFailed'));
      }
    } catch { toast.error(t('tracking.errorAddFailed')); } finally { setSaving(false); }
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
      } else { toast.error(t('tracking.errorRemoveFailed')); }
    } catch { toast.error(t('tracking.errorRemoveFailed')); }
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

  /* Full tracking script */
  const trackingScript = `<script>
  (function() {
    const urlParams = new URLSearchParams(window.location.search);
    const lid = urlParams.get('lid');
    if (lid) localStorage.setItem('contndr_lid', lid);
    const storedLid = localStorage.getItem('contndr_lid');
    // Capture affiliate ref from URL (?ref=slug) or sessionStorage
    const urlRef = urlParams.get('ref');
    if (urlRef) try { sessionStorage.setItem('contndr_affiliate_ref', urlRef); } catch(e) {}
    let affiliateRef = null;
    try { affiliateRef = sessionStorage.getItem('contndr_affiliate_ref'); } catch(e) {}

    const track = async () => {
      let coords = {};
      try {
        if ("geolocation" in navigator && "permissions" in navigator) {
          const perm = await navigator.permissions.query({ name: 'geolocation' });
          if (perm.state === 'granted') {
             const pos = await new Promise((resolve, reject) => {
               navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 1000, maximumAge: 300000 });
             });
             if (pos && pos.coords) {
               coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
             }
          }
        }
      } catch (e) {}

      fetch('https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/track/web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: '${userId || ""}' || null,
          brand: '${selectedBrand}',
          lead_id: storedLid,
          affiliate_ref: affiliateRef,
          url: window.location.href,
          title: document.title,
          timestamp: Date.now(),
          ...coords
        })
      })
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          console.warn('Contndr Tracking Script Outdated!');
          console.warn('Action Required:', data.message);
        }
      })
      .catch(err => console.error('Contndr Tracking Error:', err));
    };
    
    track();
    
    const pushState = history.pushState;
    history.pushState = function() {
      pushState.apply(history, arguments);
      track();
    };
    window.addEventListener('popstate', track);
  })();
</script>`;

  const handleCopyScript = () => {
    if (!userId) { toast.error(t('tracking.errorAccountLoad')); return; }
    navigator.clipboard.writeText(trackingScript);
    setScriptCopied(true);
    toast.success(t('tracking.scriptCopied'));
    setTimeout(() => setScriptCopied(false), 2000);
  };

  const handleTest = async () => {
    if (!userId) { toast.error(t('tracking.errorAccountLoad')); return; }
    setTesting(true);
    try {
      let coords: any = {};
      try {
        if ("geolocation" in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2000 });
          });
          if (pos?.coords) coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        }
      } catch {}
      const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/track/web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: userId, lead_id: null, url: window.location.href, title: 'Test Visit from Settings', brand: selectedBrand, timestamp: Date.now(), ...coords })
      });
      if (response.ok) toast.success(t('tracking.testSuccess'));
      else { const txt = await response.text(); toast.error(`${t('tracking.testFailed')}: ${txt}`); }
    } catch (err) { toast.error(`${t('tracking.testFailed')}: ${err}`); } finally { setTesting(false); }
  };

  const isAdmin = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com';

  const statusDot = (status: string, visitCount?: number) => {
    // If we have visits, it's definitely connected regardless of stored status
    if (visitCount && visitCount > 0) return 'bg-[#1ED4A7]';
    if (status === 'active') return 'bg-[#1ED4A7]';
    if (status === 'pending') return 'bg-amber-400 dark:bg-amber-500 animate-pulse';
    return 'bg-zinc-300 dark:bg-zinc-600';
  };

  const statusLabel = (status: string, visitCount?: number) => {
    if (visitCount && visitCount > 0) return t('tracking.statusConnected');
    if (status === 'active') return t('tracking.statusConnected');
    if (status === 'pending') return t('tracking.statusPending');
    return t('tracking.statusInactive');
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* ─── Header ─────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{t('tracking.title')}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
          {t('tracking.description')}
        </p>
      </div>

      {/* ─── Websites ───────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('tracking.yourWebsites')}</h3>
          <div className="flex items-center gap-1.5">
            {websites.length > 0 && (
              <button onClick={() => loadWebsites(true)} disabled={refreshing}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button onClick={() => setShowAddForm(true)}
              className="px-3 py-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> {t('tracking.add')}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center">
            <div className="w-4 h-4 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-500 dark:border-t-zinc-400 rounded-full animate-spin mx-auto" />
          </div>
        ) : websites.length === 0 ? (
          <button onClick={() => setShowAddForm(true)}
            className="w-full border border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl py-8 px-6 text-center hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors group">
            <Globe className="w-5 h-5 text-zinc-300 dark:text-zinc-600 mx-auto mb-2 group-hover:text-zinc-400 transition-colors" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('tracking.addFirst')}</p>
          </button>
        ) : (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
            {websites.map(site => {
              const isExpanded = expandedSite === site.id;
              const isDeleting = deleteConfirm === site.id;
              return (
                <div key={site.id}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">{site.domain}</span>
                        <span className={`inline-flex items-center gap-1.5 text-[11px] ${(site.visitCount > 0 || site.status === 'active') ? 'text-[#1ED4A7]' : 'text-zinc-500 dark:text-zinc-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusDot(site.status, site.visitCount)}`} />
                          {statusLabel(site.status, site.visitCount)}
                        </span>
                      </div>
                      {site.visitCount > 0 && (
                        <p className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                          {site.visitCount.toLocaleString()} {site.visitCount !== 1 ? t('tracking.visitsPlural') : t('tracking.visits')}{site.lastVisit ? ` · ${t('tracking.lastVisit')} ${new Date(site.lastVisit).toLocaleDateString()}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {isDeleting ? (
                        <>
                          <button onClick={() => handleDeleteWebsite(site.id)}
                            className="px-2 py-1 text-[12px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-md transition-colors">{t('tracking.remove')}</button>
                          <button onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-1 text-[12px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">{t('tracking.cancel')}</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setExpandedSite(isExpanded ? null : site.id)}
                            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title={t('tracking.showTrackingCode')}>
                            <Code2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleteConfirm(site.id)}
                            className="p-1.5 text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" title={t('tracking.remove')}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-3.5">
                      <div className="p-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
                            {t('tracking.pasteInstruction')} <code className="px-1 py-0.5 bg-zinc-200/60 dark:bg-zinc-700/60 rounded text-[11px] font-mono">&lt;head&gt;</code>
                          </p>
                          <button onClick={() => handleCopyCode(site.id, getPixelCode(site))}
                            className="px-2 py-1 text-[12px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 rounded-md transition-colors flex items-center gap-1">
                            {copiedId === site.id ? <><Check className="w-3 h-3" /> {t('tracking.copied')}</> : <><Copy className="w-3 h-3" /> {t('tracking.copy')}</>}
                          </button>
                        </div>
                        <pre className="p-2.5 bg-zinc-900 dark:bg-black rounded-md overflow-x-auto text-[12px] font-mono text-zinc-400 leading-relaxed select-all">{getPixelCode(site)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Full Tracking Script ───────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('tracking.advancedScript')}</h3>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {t('tracking.advancedScriptDesc')}
        </p>

        {/* Admin brand selector */}
        {isAdmin && (
          <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
            <Tag className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{t('tracking.brand')}</span>
            <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
              className="ml-auto px-2.5 py-1 text-[13px] bg-white dark:bg-black border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-600">
              <option value="contndr">Contndr</option>
              <option value="sourcr">Sourcr</option>
              <option value="covera">Covera</option>
              <option value="roadr">Roadr</option>
            </select>
          </div>
        )}

        <button
          onClick={() => setShowScript(!showScript)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors text-left"
        >
          <span className="text-[13px] font-medium text-zinc-600 dark:text-zinc-300">
            {showScript ? t('tracking.hideCode') : t('tracking.viewCode')}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${showScript ? 'rotate-180' : ''}`} />
        </button>

        {showScript && (
          <div className="relative">
            {!userId && (
              <div className="absolute inset-0 bg-zinc-100/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-lg z-10 flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-500 dark:border-t-zinc-400 rounded-full animate-spin" />
              </div>
            )}
            <div className="absolute top-2.5 right-2.5 z-10">
              <button onClick={handleCopyScript} disabled={!userId}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 bg-zinc-800/40 hover:bg-zinc-700/60 rounded-md transition-colors backdrop-blur-sm disabled:opacity-30"
                title={t('tracking.copy')}>
                {scriptCopied ? <Check className="w-3.5 h-3.5 text-zinc-300" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <pre className="p-4 bg-zinc-900 dark:bg-zinc-950 rounded-lg overflow-x-auto overflow-y-auto max-h-[260px] text-[12px] font-mono text-zinc-400 leading-relaxed border border-zinc-800">{trackingScript}</pre>
          </div>
        )}

        <div className="flex gap-2.5">
          <button onClick={handleCopyScript} disabled={!userId}
            className="flex-1 px-3.5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-[13px] font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {scriptCopied ? <><Check className="w-3.5 h-3.5" /> {t('tracking.copied')}</> : <><Copy className="w-3.5 h-3.5" /> {t('tracking.copyScript')}</>}
          </button>
          <button onClick={handleTest} disabled={!userId || testing}
            className="px-3.5 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg text-[13px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
            {testing ? <><div className="w-3.5 h-3.5 border-2 border-zinc-300/30 border-t-zinc-500 rounded-full animate-spin" /> {t('tracking.testing')}</> : <><ExternalLink className="w-3.5 h-3.5" /> {t('tracking.sendTest')}</>}
          </button>
        </div>
      </section>

      {/* ─── Add Website Modal ──────────────────────────── */}
      {showAddForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={() => setShowAddForm(false)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-[#0A0A0A] rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between px-5 pt-5">
              <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{t('tracking.addWebsite')}</h3>
              <button onClick={() => setShowAddForm(false)} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors rounded-md">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddWebsite()}
                placeholder="yourdomain.com" autoFocus
                className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600 transition-all"
              />
              {urlInput.trim() && (
                <p className="text-[12px] text-zinc-400">
                  {t('tracking.willTrack')} <span className="text-zinc-700 dark:text-zinc-200 font-medium">{extractDomain(urlInput)}</span>
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button onClick={() => setShowAddForm(false)} className="px-3 py-1.5 text-[13px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">{t('tracking.cancel')}</button>
              <button onClick={handleAddWebsite} disabled={saving || !urlInput.trim()}
                className="px-4 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                {saving ? <><div className="w-3 h-3 border-2 border-white/30 dark:border-zinc-900/30 border-t-white dark:border-t-zinc-900 rounded-full animate-spin" /> {t('tracking.adding')}</> : t('tracking.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}