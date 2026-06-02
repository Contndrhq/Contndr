/**
 * Admin → Customer → Billing & Compliance tab
 *
 * One-stop panel for everything financial about a customer: invoices,
 * payments, refunds, disputes, contracts, admin notes, manual charges,
 * + the Compliance Export button.
 *
 * Mounted inside UserDetailSheet so it sits next to the existing account
 * actions; admins never have to leave the user sheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, Receipt, CreditCard, FileText, Upload, Trash2,
  StickyNote, Download, ExternalLink, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch, getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { confirmAsync } from './ConfirmDialog';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface Props {
  userId: string;
  userEmail?: string;
}

interface BillingData {
  invoices: any[];
  payments: any[];
  refunds: any[];
  disputes: any[];
  notes: any[];
  contracts: any[];
  manual_charges: any[];
}

const EMPTY: BillingData = { invoices: [], payments: [], refunds: [], disputes: [], notes: [], contracts: [], manual_charges: [] };

export function BillingComplianceTab({ userId, userEmail }: Props) {
  const [data, setData] = useState<BillingData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authenticatedFetch(`${API}/admin/users/${userId}/billing`);
      const j = await r.json();
      if (r.ok) setData({ ...EMPTY, ...j });
      else toast.error(j.error || 'Failed to load billing data');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await authenticatedFetch(`${API}/admin/users/${userId}/billing/sync`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Sync failed');
      toast.success(`Synced from Stripe: ${j.invoices} invoices, ${j.payments} payments, ${j.refunds} refunds, ${j.disputes} disputes`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const exportBundle = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const headers = await getAuthHeaders();
      // Use raw fetch — we need access to response.blob() and the
      // Content-Disposition header for the filename. authenticatedFetch
      // already adds auth.
      const r = await fetch(`${API}/admin/users/${userId}/billing/export`, { headers });
      if (!r.ok) {
        const errJson = await r.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const disposition = r.headers.get('Content-Disposition') || '';
      const fnameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = fnameMatch?.[1] || `compliance-${userId}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Compliance package downloaded');
    } catch (e: any) {
      toast.error(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading billing records…
      </div>
    );
  }

  const totalRevenue = data.payments
    .filter(p => p.status === 'succeeded')
    .reduce((acc, p) => acc + (p.amount - (p.amount_refunded || 0)), 0);

  return (
    <div className="space-y-4">
      {/* Headline tiles + actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Lifetime revenue" value={fmtMoney(totalRevenue)} accent="emerald" />
        <Tile label="Invoices" value={String(data.invoices.length)} />
        <Tile label="Refunds" value={String(data.refunds.length)} accent={data.refunds.length > 0 ? 'amber' : undefined} />
        <Tile label="Disputes" value={String(data.disputes.length)} accent={data.disputes.length > 0 ? 'rose' : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={sync} disabled={syncing} className={btnSecondary}>
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {syncing ? 'Syncing…' : 'Sync from Stripe'}
        </button>
        <button onClick={exportBundle} disabled={exporting} className={btnPrimary}>
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Export compliance package
        </button>
      </div>

      {/* Disputes — surface at top when present */}
      {data.disputes.length > 0 && (
        <Section icon={AlertTriangle} title={`Disputes (${data.disputes.length})`} accent="rose" defaultOpen>
          {data.disputes.map(d => (
            <div key={d.id} className="text-xs py-2 px-3 border-b border-zinc-100 dark:border-zinc-800/30 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-rose-600 dark:text-rose-400">{d.reason || 'Disputed'} — {fmtMoney(d.amount)}</span>
                <span className="text-zinc-500">{d.status}</span>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">{d.id} · charge {d.charge_id}</div>
              {d.evidence_due_by && (
                <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  Evidence due: {new Date(d.evidence_due_by * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Invoices */}
      <Section icon={Receipt} title={`Invoices (${data.invoices.length})`} defaultOpen>
        {data.invoices.length === 0 ? (
          <Empty>No invoices mirrored yet. Try Sync from Stripe.</Empty>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {data.invoices.map((inv: any) => (
              <div key={inv.id} className="text-xs py-2 px-3 border-b border-zinc-100 dark:border-zinc-800/30 last:border-0 grid grid-cols-12 gap-2 items-center">
                <span className="col-span-3 font-mono text-zinc-700 dark:text-zinc-300 truncate">{inv.number || inv.id.slice(0, 16)}</span>
                <span className="col-span-3 tabular-nums">{fmtMoney(inv.amount_paid || inv.amount_due)}</span>
                <span className="col-span-2"><StatusPill status={inv.status} /></span>
                <span className="col-span-3 text-zinc-500 text-[11px]">{inv.created_at ? new Date(inv.created_at * 1000).toLocaleDateString() : '—'}</span>
                <span className="col-span-1 text-right">
                  {inv.invoice_pdf && (
                    <a href={inv.invoice_pdf} target="_blank" rel="noopener" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white" title="Download PDF">
                      <Download className="w-3.5 h-3.5 inline" />
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Payments */}
      <Section icon={CreditCard} title={`Payments (${data.payments.length})`}>
        {data.payments.length === 0 ? (
          <Empty>No payments mirrored yet.</Empty>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {data.payments.map((p: any) => (
              <div key={p.id} className="text-xs py-2 px-3 border-b border-zinc-100 dark:border-zinc-800/30 last:border-0 grid grid-cols-12 gap-2 items-center">
                <span className="col-span-3 font-mono text-zinc-700 dark:text-zinc-300 truncate">{p.id.slice(0, 16)}</span>
                <span className="col-span-3 tabular-nums">
                  {fmtMoney(p.amount)}
                  {p.amount_refunded > 0 && (
                    <span className="text-[10px] text-amber-500 ml-1">−{fmtMoney(p.amount_refunded)}</span>
                  )}
                </span>
                <span className="col-span-2"><StatusPill status={p.status} /></span>
                <span className="col-span-3 text-zinc-500 text-[11px]">
                  {p.payment_method_brand && `${p.payment_method_brand} •••${p.payment_method_last4 || ''}`}
                </span>
                <span className="col-span-1 text-right">
                  {p.receipt_url && (
                    <a href={p.receipt_url} target="_blank" rel="noopener" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white" title="Receipt">
                      <ExternalLink className="w-3.5 h-3.5 inline" />
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Refunds */}
      {data.refunds.length > 0 && (
        <Section icon={RefreshCw} title={`Refunds (${data.refunds.length})`} accent="amber">
          {data.refunds.map((r: any) => (
            <div key={r.id} className="text-xs py-2 px-3 border-b border-zinc-100 dark:border-zinc-800/30 last:border-0 flex items-center justify-between gap-2">
              <span className="font-mono text-zinc-500 truncate">{r.id.slice(0, 16)}</span>
              <span className="tabular-nums">−{fmtMoney(r.amount)}</span>
              <span className="text-zinc-500">{r.reason || '—'}</span>
              <span className="text-zinc-500 text-[11px]">{r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : '—'}</span>
            </div>
          ))}
        </Section>
      )}

      {/* Contracts */}
      <ContractsSection userId={userId} contracts={data.contracts} onChanged={load} />

      {/* Admin notes */}
      <NotesSection userId={userId} notes={data.notes} onChanged={load} />

      {/* Manual charges */}
      {data.manual_charges.length > 0 && (
        <Section icon={CreditCard} title={`Manual charges (${data.manual_charges.length})`}>
          {data.manual_charges.map((m: any) => (
            <div key={m.id} className="text-xs py-2 px-3 border-b border-zinc-100 dark:border-zinc-800/30 last:border-0">
              <div className="flex items-center justify-between">
                <span className="tabular-nums font-medium">{fmtMoney(m.amount_cents)}</span>
                <span className="text-zinc-500 text-[11px]">{m.charged_at ? new Date(m.charged_at).toLocaleDateString() : '—'}</span>
              </div>
              {m.reason && <div className="text-zinc-500 mt-0.5">{m.reason}</div>}
              <div className="text-[10px] text-zinc-400 font-mono mt-0.5">by {m.charged_by_email} · {m.id.slice(0, 20)}</div>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function Section({ icon: Icon, title, accent, defaultOpen, children }: { icon: any; title: string; accent?: 'rose' | 'amber' | 'emerald'; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const accentClass = accent === 'rose' ? 'text-rose-600 dark:text-rose-400'
    : accent === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-zinc-500';
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-black">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${accentClass}`} />
          <span className="text-sm font-medium text-zinc-900 dark:text-white">{title}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-zinc-100 dark:border-zinc-800/50">{children}</div>}
    </div>
  );
}

function ContractsSection({ userId, contracts, onChanged }: { userId: string; contracts: any[]; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState('contract');

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const headers = await getAuthHeaders();
      delete headers['Content-Type'];
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', category);
      const r = await fetch(`${API}/admin/users/${userId}/contracts`, { method: 'POST', headers, body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      toast.success(`Uploaded ${j.contract.filename}`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onDownload = async (ctrId: string) => {
    try {
      const r = await authenticatedFetch(`${API}/admin/users/${userId}/contracts/${ctrId}/download`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Download failed');
      window.open(j.url, '_blank');
    } catch (e: any) {
      toast.error(e?.message || 'Download failed');
    }
  };

  const onDelete = async (ctr: any) => {
    if (!(await confirmAsync({ title: `Delete "${ctr.filename}"?`, message: 'This permanently removes the file from storage.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      const r = await authenticatedFetch(`${API}/admin/users/${userId}/contracts/${ctr.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'Delete failed');
      toast.success('Deleted');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed');
    }
  };

  return (
    <Section icon={FileText} title={`Contracts & documents (${contracts.length})`}>
      <div className="p-3 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center gap-2 flex-wrap">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-xs px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <option value="contract">Contract</option>
          <option value="sow">SOW</option>
          <option value="bank_statement">Bank statement</option>
          <option value="approval_email">Approval email</option>
          <option value="custom_invoice">Custom invoice</option>
          <option value="receipt">Receipt</option>
          <option value="other">Other</option>
        </select>
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className={btnSecondary}>
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? 'Uploading…' : 'Upload file'}
        </button>
        <span className="text-[10px] text-zinc-500">Max 20MB · stored privately</span>
      </div>
      {contracts.length === 0 ? (
        <Empty>No contracts uploaded yet.</Empty>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          {contracts.map((c: any) => (
            <div key={c.id} className="text-xs py-2 px-3 border-b border-zinc-100 dark:border-zinc-800/30 last:border-0 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-zinc-900 dark:text-white truncate">{c.filename}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {c.category} · {Math.round(c.size_bytes / 1024)}KB · {c.uploaded_by_email} · {new Date(c.uploaded_at).toLocaleDateString()}
                </div>
                {c.notes && <div className="text-[11px] text-zinc-500 mt-0.5 italic">{c.notes}</div>}
              </div>
              <button onClick={() => onDownload(c.id)} className="p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(c)} className="p-1.5 rounded text-zinc-500 hover:text-rose-500 hover:bg-rose-500/10">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function NotesSection({ userId, notes, onChanged }: { userId: string; notes: any[]; onChanged: () => void }) {
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const r = await authenticatedFetch(`${API}/admin/users/${userId}/billing/notes`, {
        method: 'POST',
        body: JSON.stringify({ body, category }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      toast.success('Note added');
      setBody('');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (noteId: string) => {
    if (!(await confirmAsync({ title: 'Delete note?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      const r = await authenticatedFetch(`${API}/admin/users/${userId}/billing/notes/${noteId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    }
  };

  return (
    <Section icon={StickyNote} title={`Admin notes (${notes.length})`}>
      <div className="p-3 border-b border-zinc-100 dark:border-zinc-800/50 space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Legacy annual deal honored at $3,990 for 12 months."
          rows={2}
          className="w-full text-xs px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 resize-none"
        />
        <div className="flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-xs px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
            <option value="general">General</option>
            <option value="discount">Discount</option>
            <option value="refund">Refund</option>
            <option value="contract">Contract</option>
            <option value="legacy">Legacy</option>
            <option value="warning">Warning</option>
          </select>
          <button onClick={add} disabled={saving || !body.trim()} className={btnPrimary}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add note'}
          </button>
        </div>
      </div>
      {notes.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          {notes.map((n: any) => (
            <div key={n.id} className="text-xs py-2 px-3 border-b border-zinc-100 dark:border-zinc-800/30 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap leading-relaxed flex-1">{n.body}</p>
                <button onClick={() => remove(n.id)} className="p-1 rounded text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 shrink-0">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">
                <span className="uppercase tracking-wider font-semibold">{n.category}</span> · {n.author_email} · {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'amber' | 'rose' }) {
  const color = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : accent === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : accent === 'rose' ? 'text-rose-600 dark:text-rose-400'
    : 'text-zinc-900 dark:text-white';
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'paid' || status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    : status === 'open' || status === 'pending' ? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20'
    : status === 'failed' || status === 'uncollectible' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
    : status === 'void' ? 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${tone} capitalize`}>{status}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-zinc-500 text-center py-6 px-3">{children}</div>;
}

const btnSecondary = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40';
const btnPrimary = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-40';

function fmtMoney(cents: number, currency = 'usd'): string {
  if (typeof cents !== 'number') return '—';
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2 });
}

export default BillingComplianceTab;
