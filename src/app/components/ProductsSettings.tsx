/**
 * Settings → Products
 *
 * Lets users define what they sell. Each product becomes a target for the
 * pipeline auto-stage matcher (Phase 2): when a lead enters the CRM, we
 * score it against every product and auto-route the best match to its
 * configured pipeline stage.
 *
 * Brand-new accounts are auto-seeded with Contndr's own plans so the
 * pipeline auto-routing demonstrates value on day one without setup.
 */

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Package, X } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { confirmAsync } from './ConfirmDialog';

interface MatchingRules {
  min_employees?: number;
  max_employees?: number;
  min_lead_volume?: number;
  max_lead_volume?: number;
  industries?: string[];
}

interface Product {
  id: string;
  name: string;
  price_cents: number;
  interval: 'monthly' | 'yearly' | 'one_time';
  target_pipeline_stage?: string;
  description?: string;
  matching_rules?: MatchingRules;
  created_at: string;
  updated_at: string;
}

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

export function ProductsSettings() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await authenticatedFetch(`${API_BASE}/products`);
      const j = await r.json();
      if (r.ok) setProducts(j.products || []);
      else toast.error(j.error || 'Failed to load products');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(p: Product) {
    if (!(await confirmAsync({
      title: `Delete "${p.name}"?`,
      message: 'This stops the pipeline auto-routing for leads matching this product. Existing leads stay where they are.',
      confirmLabel: 'Delete',
      destructive: true,
    }))) return;
    try {
      const r = await authenticatedFetch(`${API_BASE}/products/${p.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast.success(`Deleted "${p.name}"`);
      setProducts(prev => prev.filter(x => x.id !== p.id));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Products</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
            Define what you sell. New leads get auto-matched and routed to the right pipeline stage. We seed your account with example products you can edit or delete.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add product
        </button>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <Package className="w-8 h-8 mx-auto text-zinc-400 mb-2" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">No products yet</p>
          <p className="text-xs text-zinc-500 mt-1">Add your first product to enable pipeline auto-routing.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {products.map(p => (
            <ProductRow key={p.id} product={p} onEdit={() => setEditing(p)} onDelete={() => handleDelete(p)} />
          ))}
        </div>
      )}

      {(editing || adding) && (
        <ProductEditModal
          product={editing}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={(saved) => {
            if (editing) setProducts(prev => prev.map(p => p.id === saved.id ? saved : p));
            else setProducts(prev => [...prev, saved]);
            setEditing(null);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function ProductRow({ product, onEdit, onDelete }: { product: Product; onEdit: () => void; onDelete: () => void }) {
  const price = `$${(product.price_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const intervalLabel = product.interval === 'monthly' ? '/mo' : product.interval === 'yearly' ? '/yr' : ' one-time';
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shrink-0">
        <Package className="w-4 h-4 text-zinc-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{product.name}</span>
          <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{price}<span className="text-xs text-zinc-500">{intervalLabel}</span></span>
        </div>
        {product.description && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">{product.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] text-zinc-500">
          {product.target_pipeline_stage && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              → {product.target_pipeline_stage}
            </span>
          )}
          {product.matching_rules?.min_employees != null && (
            <span>{product.matching_rules.min_employees}+ employees</span>
          )}
          {product.matching_rules?.max_employees != null && (
            <span>up to {product.matching_rules.max_employees} employees</span>
          )}
          {product.matching_rules?.min_lead_volume != null && (
            <span>{product.matching_rules.min_lead_volume.toLocaleString()}+ leads/mo</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onEdit} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-2 rounded-lg text-zinc-500 hover:text-rose-500 hover:bg-rose-500/10 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function ProductEditModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: (p: Product) => void }) {
  const [name, setName] = useState(product?.name || '');
  const [priceDollars, setPriceDollars] = useState(product ? String(product.price_cents / 100) : '');
  const [interval, setInterval] = useState<Product['interval']>(product?.interval || 'monthly');
  const [stage, setStage] = useState(product?.target_pipeline_stage || '');
  const [description, setDescription] = useState(product?.description || '');
  const [minEmp, setMinEmp] = useState(product?.matching_rules?.min_employees ?? '');
  const [maxEmp, setMaxEmp] = useState(product?.matching_rules?.max_employees ?? '');
  const [minVol, setMinVol] = useState(product?.matching_rules?.min_lead_volume ?? '');
  const [maxVol, setMaxVol] = useState(product?.matching_rules?.max_lead_volume ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const price_cents = Math.round(parseFloat(priceDollars || '0') * 100);
    if (!Number.isFinite(price_cents) || price_cents < 0) { toast.error('Invalid price'); return; }
    setSaving(true);
    const body: any = {
      name: name.trim(),
      price_cents,
      interval,
      target_pipeline_stage: stage.trim() || undefined,
      description: description.trim() || undefined,
      matching_rules: {
        min_employees: minEmp === '' ? undefined : Number(minEmp),
        max_employees: maxEmp === '' ? undefined : Number(maxEmp),
        min_lead_volume: minVol === '' ? undefined : Number(minVol),
        max_lead_volume: maxVol === '' ? undefined : Number(maxVol),
      },
    };
    try {
      const url = product ? `${API_BASE}/products/${product.id}` : `${API_BASE}/products`;
      const method = product ? 'PATCH' : 'POST';
      const r = await authenticatedFetch(url, { method, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      toast.success(product ? `Updated "${j.product.name}"` : `Added "${j.product.name}"`);
      onSaved(j.product);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full sm:max-w-lg max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden modal-as-bottom-sheet sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{product ? 'Edit product' : 'Add product'}</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          <Field label="Product name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Growth plan" className={inputCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (USD)">
              <input type="number" min="0" step="0.01" value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} placeholder="499" className={inputCls} />
            </Field>
            <Field label="Billing">
              <select value={interval} onChange={(e) => setInterval(e.target.value as Product['interval'])} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="one_time">One-time</option>
              </select>
            </Field>
          </div>

          <Field label="Auto-route matched leads to pipeline stage" hint="Optional. Leave blank to skip auto-routing.">
            <input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="e.g. Demo Scheduled" className={inputCls} />
          </Field>

          <Field label="Description" hint="Used by AI to personalize email/call scripts.">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="For mid-market teams scaling outbound…" className={inputCls + ' resize-none'} />
          </Field>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">Matching rules</div>
            <p className="text-[11px] text-zinc-500 mb-3 leading-snug">Leads scoring highest on these get matched to this product. Leave any blank to skip that check.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min employees">
                <input type="number" min="0" value={minEmp} onChange={(e) => setMinEmp(e.target.value as any)} className={inputCls} />
              </Field>
              <Field label="Max employees">
                <input type="number" min="0" value={maxEmp} onChange={(e) => setMaxEmp(e.target.value as any)} className={inputCls} />
              </Field>
              <Field label="Min leads/mo">
                <input type="number" min="0" value={minVol} onChange={(e) => setMinVol(e.target.value as any)} className={inputCls} />
              </Field>
              <Field label="Max leads/mo">
                <input type="number" min="0" value={maxVol} onChange={(e) => setMaxVol(e.target.value as any)} className={inputCls} />
              </Field>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0 flex justify-end gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {product ? 'Save changes' : 'Add product'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export default ProductsSettings;
