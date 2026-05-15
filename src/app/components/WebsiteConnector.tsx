/**
 * WebsiteConnector
 * ────────────────
 * Scale/Enterprise Website Connector. Hosts:
 *  - Install snippet (script tag with public key)
 *  - Domain verification list
 *  - Form embed + existing-form mapping guide
 *  - Test event button
 *  - Recent events debug log
 *  - Recent website-captured leads + queued AI calls
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Copy,
  Check,
  Plus,
  Trash2,
  RefreshCw,
  Code2,
  Send,
  Shield,
  Zap,
  Clock,
  FileText,
  PhoneCall,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from '../lib/auth';

interface WorkspaceDomain {
  host: string;
  verified: boolean;
  verified_at: string | null;
}

interface Workspace {
  user_id: string;
  workspace_id: string;
  public_key: string;
  domains: WorkspaceDomain[];
  ai_call_enabled: boolean;
  score_threshold: number;
  business_hours: { tz: string; start: number; end: number; days: number[] };
  created_at: string;
  updated_at: string;
}

interface InstallInfo {
  script_tag: string;
  tracker_url: string;
  form_attribute: string;
  event_endpoint: string;
  lead_endpoint: string;
}

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/wc`;

export function WebsiteConnector() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [install, setInstall] = useState<InstallInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [wsRes, evRes, ldRes] = await Promise.all([
        authenticatedFetch(`${BASE}/workspace`),
        authenticatedFetch(`${BASE}/events`),
        authenticatedFetch(`${BASE}/leads`),
      ]);
      const ws = await wsRes.json();
      const ev = await evRes.json();
      const ld = await ldRes.json();
      if (ws.entitled === false) {
        // Shouldn't normally hit this — TrackingTab gates before mounting us.
        // Bail out cleanly if a non-entitled user somehow lands here.
        setLoading(false);
        return;
      }
      setWorkspace(ws.workspace);
      setInstall(ws.install);
      setEvents(ev.events || []);
      setLeads(ld.leads || []);
      setQueue(ld.queue || []);
    } catch (e: any) {
      console.error('[WC] load failed', e);
      toast.error('Failed to load Website Connector');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  const addDomain = async () => {
    const cleaned = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!cleaned) return;
    try {
      const r = await authenticatedFetch(`${BASE}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: cleaned }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setWorkspace(data.workspace);
      setNewDomain('');
      toast.success('Domain added — install the script then click Verify');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add domain');
    }
  };

  const verifyDomain = async (host: string) => {
    try {
      const r = await authenticatedFetch(`${BASE}/domains/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      const data = await r.json();
      if (data.verified) {
        setWorkspace(data.workspace);
        toast.success(`${host} verified`);
      } else {
        toast.error(data.reason || 'Not verified yet');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Verify failed');
    }
  };

  const removeDomain = async (host: string) => {
    try {
      const r = await authenticatedFetch(`${BASE}/domains?host=${encodeURIComponent(host)}`, { method: 'DELETE' });
      const data = await r.json();
      setWorkspace(data.workspace);
    } catch (e: any) {
      toast.error(e?.message || 'Remove failed');
    }
  };

  const rotateKey = async () => {
    if (!confirm('Rotate public key? You will need to reinstall the script everywhere it is currently embedded.')) return;
    try {
      const r = await authenticatedFetch(`${BASE}/rotate-key`, { method: 'POST' });
      const data = await r.json();
      setWorkspace(data.workspace);
      await load();
      toast.success('Public key rotated');
    } catch (e: any) {
      toast.error(e?.message || 'Rotate failed');
    }
  };

  const fireTestEvent = async () => {
    try {
      await authenticatedFetch(`${BASE}/test-event`, { method: 'POST' });
      toast.success('Test event fired');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Test failed');
    }
  };

  const updateSettings = async (patch: Partial<Workspace>) => {
    try {
      const r = await authenticatedFetch(`${BASE}/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await r.json();
      setWorkspace(data.workspace);
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!workspace || !install) return null;

  const verifiedCount = workspace.domains.filter((d) => d.verified).length;
  const formEmbed = `<form data-contndr-capture="lead">
  <input name="full_name" placeholder="Full name" required />
  <input name="email" type="email" placeholder="Email" required />
  <input name="phone" type="tel" placeholder="Phone (for AI follow-up)" />
  <input name="company" placeholder="Company" />
  <textarea name="message" placeholder="What can we help with?"></textarea>
  <label>
    <input type="checkbox" name="consent" required />
    <span data-contndr-consent-text>I agree to receive a call or text about my request.</span>
  </label>
  <button type="submit">Request a call</button>
</form>`;

  return (
    <div className="space-y-6 text-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe className="w-5 h-5 flex-shrink-0" /> Website Connector
          </h2>
          <p className="text-zinc-500 mt-1 text-sm">Connect your website so hot visitors become identified leads and trigger AI calls automatically.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={fireTestEvent} className="px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs flex items-center gap-1 whitespace-nowrap">
            <Send className="w-3.5 h-3.5" /> Fire test
          </button>
          <button onClick={load} className="px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs flex items-center gap-1 whitespace-nowrap">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Install snippet */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2"><Code2 className="w-4 h-4" /> Step 1 · Paste this on your website</h3>
          <button onClick={rotateKey} className="text-xs text-zinc-500 hover:text-red-600">Rotate key</button>
        </div>
        <p className="text-zinc-500 mb-3">Paste this inside the <code>&lt;head&gt;</code> of every page on your site.</p>
        <div className="relative bg-zinc-950 rounded-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Script tag</span>
            <button onClick={() => copy('script', install.script_tag)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-100 flex items-center gap-1">
              {copied === 'script' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied === 'script' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="text-zinc-100 p-3 overflow-x-auto text-[11px] sm:text-xs whitespace-pre-wrap break-all">{install.script_tag}</pre>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-xs">
          <div className="rounded-md bg-zinc-50 dark:bg-zinc-900 p-3 min-w-0">
            <div className="text-zinc-400 mb-1">Workspace ID</div>
            <code className="text-zinc-900 dark:text-zinc-100 break-all block">{workspace.workspace_id}</code>
          </div>
          <div className="rounded-md bg-zinc-50 dark:bg-zinc-900 p-3 min-w-0">
            <div className="text-zinc-400 mb-1">Public key</div>
            <code className="text-zinc-900 dark:text-zinc-100 break-all block">{workspace.public_key}</code>
          </div>
        </div>
      </section>

      {/* Domain verification */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-1"><Shield className="w-4 h-4" /> Step 2 · Connect your website</h3>
        <p className="text-zinc-500 mb-1">Add the domain of <b>your</b> website — the one where you just pasted the script (e.g. <code>acme.com</code>). Most customers only add one.</p>
        <p className="text-zinc-400 text-xs mb-3">Why? Your public key is visible in the script. We only accept events from domains you've approved, so nobody else can pretend to be your site. After adding, load any page on your site and click <b>Verify</b> — it confirms our script is live there.</p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDomain()}
            placeholder="acme.com (your website)"
            className="flex-1 px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
          />
          <button onClick={addDomain} className="px-3 py-1.5 rounded-md bg-black text-white dark:bg-white dark:text-black text-xs flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Add domain
          </button>
        </div>
        <div className="space-y-2">
          {workspace.domains.length === 0 ? (
            <div className="text-zinc-500 text-xs italic">No domains yet.</div>
          ) : workspace.domains.map((d) => (
            <div key={d.host} className="flex items-center justify-between px-3 py-2 rounded-md bg-zinc-50 dark:bg-zinc-900">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-zinc-400" />
                <span className="font-mono text-xs">{d.host}</span>
                {d.verified ? (
                  <span className="text-emerald-600 text-xs flex items-center gap-1"><Check className="w-3 h-3" /> Verified</span>
                ) : (
                  <span className="text-amber-600 text-xs">Pending</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!d.verified && (
                  <button onClick={() => verifyDomain(d.host)} className="text-xs text-emerald-600 hover:underline">Verify</button>
                )}
                <button onClick={() => removeDomain(d.host)} className="text-xs text-zinc-400 hover:text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Form embed */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Step 3 · Capture leads from forms</h3>
          <button onClick={() => setShowForm((s) => !s)} className="text-xs text-zinc-500 hover:text-zinc-800">{showForm ? 'Hide example' : 'Show example'}</button>
        </div>
        <div className="text-zinc-500 space-y-2">
          <p><b>Option A — Embed our form:</b> drop the snippet below into any page.</p>
          <p><b>Option B — Map your existing form:</b> add <code>data-contndr-capture="lead"</code> to your <code>&lt;form&gt;</code> tag and use these field names: <code>full_name</code>, <code>email</code>, <code>phone</code>, <code>company</code>, <code>website</code>, <code>role</code>, <code>message</code>, <code>consent</code>.</p>
          <p className="text-amber-700"><b>Consent is required for AI calls/SMS.</b> Include a checkbox named <code>consent</code> with visible disclosure text (we capture the text, timestamp, URL, IP, and user-agent for compliance).</p>
        </div>
        {showForm && (
          <div className="mt-3 bg-zinc-950 rounded-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">Form snippet</span>
              <button onClick={() => copy('form', formEmbed)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-100 flex items-center gap-1">
                {copied === 'form' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied === 'form' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="text-zinc-100 p-3 overflow-x-auto text-[11px] sm:text-xs">{formEmbed}</pre>
          </div>
        )}
      </section>

      {/* AI call settings */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><Zap className="w-4 h-4" /> Step 4 · AI call trigger rules</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 dark:bg-zinc-900 px-3 py-2">
            <span className="text-zinc-600 dark:text-zinc-300">AI calling enabled</span>
            <input
              type="checkbox"
              checked={workspace.ai_call_enabled}
              onChange={(e) => updateSettings({ ai_call_enabled: e.target.checked })}
            />
          </label>
          <label className="flex flex-col gap-1 rounded-md bg-zinc-50 dark:bg-zinc-900 px-3 py-2">
            <span className="text-zinc-600 dark:text-zinc-300 text-xs">Intent score threshold ({workspace.score_threshold})</span>
            <input
              type="range" min={0} max={100} step={5}
              value={workspace.score_threshold}
              onChange={(e) => updateSettings({ score_threshold: Number(e.target.value) })}
            />
          </label>
          <div className="rounded-md bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs">
            <Clock className="w-3.5 h-3.5 inline mr-1" /> {workspace.business_hours.tz} · {workspace.business_hours.start}:00–{workspace.business_hours.end}:00
          </div>
        </div>
      </section>

      {/* Logs */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
          <h3 className="font-semibold mb-2">Recent events <span className="text-xs text-zinc-400">({events.length})</span></h3>
          <div className="space-y-1 max-h-72 overflow-y-auto text-xs font-mono">
            {events.length === 0 ? (
              <div className="text-zinc-500 italic">No events yet. Install the script and load a page on your site.</div>
            ) : events.slice(0, 30).map((e) => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="text-zinc-400">{new Date(e.at).toLocaleTimeString()}</span>
                <span className={`px-1.5 rounded ${e.event_type === 'cta_click' ? 'bg-amber-100 text-amber-800' : e.event_type === 'session_end' ? 'bg-zinc-100 text-zinc-700' : 'bg-emerald-100 text-emerald-800'}`}>{e.event_type}</span>
                <span className="truncate">{e.url}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><PhoneCall className="w-4 h-4" /> Website-captured leads & call queue</h3>
          <div className="space-y-1 max-h-72 overflow-y-auto text-xs">
            {leads.length === 0 ? (
              <div className="text-zinc-500 italic">No website-captured leads yet.</div>
            ) : leads.slice(0, 30).map((l) => {
              const q = queue.find((x) => x.lead_id === l.id);
              return (
                <div key={l.id} className="px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{l.name || l.email || '(no name)'}</span>
                    {q && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${q.status === 'dispatched' ? 'bg-emerald-100 text-emerald-800' : q.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-zinc-200 text-zinc-700'}`}>
                        call: {q.status}
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-500 text-[11px]">
                    {l.email} · {l.phone || 'no phone'} · score {l.session_summary?.intent_score ?? '–'} · consent {l.consent ? '✓' : '✗'}
                  </div>
                  {q?.error && <div className="text-red-600 text-[11px] mt-0.5">{q.error}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
