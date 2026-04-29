import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Plus, GripVertical, TrendingUp, Trophy, X, ChevronDown,
  MoreHorizontal, Trash2, Edit3, Building2, Percent,
  CircleDollarSign, ArrowUpRight, Brain, RefreshCw,
  ExternalLink, CreditCard, Receipt, AlertTriangle, Sparkles,
  Link2, Activity, Clock, TrendingDown, CheckCircle2, Loader2,
  LayoutGrid, List, ArrowUpDown, ChevronRight, Zap, Calendar,
  Users
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import ActivityFeed from './ActivityFeed';
import { useRealtimeContext, useRealtimeRefresh } from './RealtimeProvider';
import { AddToPipelineModal } from './AddToPipelineModal';
import { dispatchAppEvent, useAppEventRefresh } from '../lib/app-events';
import { useDemoMode, DEMO_PIPELINE_DEALS } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';

// Updated: 2026-03-20 - iOS WebView optimization fixes and date picker fix
// ─── Types ───────────────────────────────────────────────────────────
interface PipelineDeal {
  id: string;
  contact_name: string;
  business_name: string;
  email: string;
  stage: string;
  value: number;
  currency: string;
  notes: string;
  category: string;
  lead_id?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  expected_close_date?: string;
  stripe_payment_id?: string;
  stripe_invoice_id?: string;
  stripe_payment_status?: string;
  stripe_payment_url?: string;
  qbo_invoice_id?: string;
  qbo_invoice_number?: string;
  qbo_invoice_status?: string;
  ai_score?: number;
  ai_next_action?: string;
  ai_risk_level?: 'low' | 'medium' | 'high';
  ai_predicted_close_date?: string;
  stage_history?: Array<{ stage: string; entered_at: string; trigger?: string }>;
  days_in_stage?: number;
  is_recurring?: boolean;
  recurring_interval?: 'month' | 'year';
}

interface PipelineMetrics {
  totalDeals: number;
  activeDeals: number;
  wonDeals: number;
  lostDeals: number;
  totalPipelineValue: number;
  wonValue: number;
  closeRate: number;
  forecast: number;
  stageCounts: Record<string, number>;
  stageValues: Record<string, number>;
  avgDaysToClose?: number;
  weeklyVelocity?: number;
}

interface IntegrationStatus {
  stripe: { connected: boolean };
  quickbooks: { connected: boolean; company_name?: string };
  ai: { enabled: boolean };
  calendly?: { connected: boolean; webhook_configured?: boolean };
}

interface AiInsights {
  health_score: number;
  summary: string;
  deal_scores: Array<{ deal_id: string; score: number; risk_level: string; next_action: string; predicted_days_to_close?: number }>;
  recommendations: string[];
  risk_deals: string[];
  top_opportunities: string[];
  bottleneck_stage?: string;
  forecast_adjustment?: string;
  generated_at?: string;
}

// ─── Constants ───────────────────────────────────────────────────────
// Updated: 2026-02-25 - Rebuild trigger after auth retry fix
const STAGES = [
  { key: 'prospect_identified', label: 'Prospect Identified' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'engaged', label: 'Engaged' },
  { key: 'meeting_booked', label: 'Meeting Booked' },
  { key: 'proposal_sent', label: 'Proposal Sent' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'closed_won', label: 'Closed Won' },
  { key: 'closed_lost', label: 'Closed Lost' },
] as const;

const STAGE_LABEL_MAP: Record<string, string> = Object.fromEntries(STAGES.map(s => [s.key, s.label]));

// Lazy evaluation to avoid module loading issues
function getApiBase() {
  return `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/pipeline`;
}

function fmt(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}
function fmtK(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}
function ago(dateStr: string, t?: (key: string, opts?: any) => string) {
  const d = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(d / 60000);
  if (m < 60) return t ? t('pipeline.agoMinutes', { count: m }) : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return t ? t('pipeline.agoHours', { count: h }) : `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return t ? t('pipeline.agoDays', { count: days }) : `${days}d`;
  return t ? t('pipeline.agoMonths', { count: Math.floor(days / 30) }) : `${Math.floor(days / 30)}mo`;
}
function scoreColor(s: number) { return 'text-zinc-500 dark:text-zinc-400'; }
function riskBadge(r?: string) {
  if (!r) return null;
  const labels: Record<string, string> = { low: 'LOW', medium: 'MED', high: 'HIGH' };
  const styles: Record<string, string> = {
    low: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
    medium: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
    high: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
  };
  return <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${styles[r] || styles.medium}`}>{labels[r] || r}</span>;
}

// ─── DealCard (Kanban) ───────────────────────────────────────────────
function DealCard({ deal, onEdit, onDelete, onDragStart, onAction, integrations }: {
  deal: PipelineDeal; onEdit: (d: PipelineDeal) => void; onDelete: (id: string) => void;
  onDragStart: (e: React.DragEvent, d: PipelineDeal) => void;
  onAction: (id: string, action: string) => void; integrations: IntegrationStatus | null;
}) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMenu) return;
    const h = (e: MouseEvent | TouchEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); };
  }, [showMenu]);

  const hasStripe = !!deal.stripe_invoice_id || !!deal.stripe_payment_id || !!deal.stripe_payment_url;
  const hasQbo = !!deal.qbo_invoice_id;
  const isWon = deal.stage === 'closed_won';
  const lastTrigger = deal.stage_history?.filter(h => h.trigger).slice(-1)[0];

  return (
    <div draggable onDragStart={(e) => onDragStart(e, deal)}
      onClick={() => onEdit(deal)}
      className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 sm:p-3.5 cursor-pointer active:scale-[0.98] hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm transition-all duration-200 relative touch-manipulation">
      <div className="absolute top-3 left-1 opacity-0 group-hover:opacity-40 transition-opacity hidden sm:block">
        <GripVertical className="w-3 h-3 text-zinc-400" />
      </div>
      <div className="sm:pl-3">
        <div className="flex items-start justify-between mb-1.5 sm:mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-zinc-900 dark:text-white truncate leading-tight">
                {deal.contact_name || t('pipeline.unnamedDeal')}
              </p>
              {deal.ai_score != null && (
                <span className={`text-[10px] font-bold tabular-nums ${scoreColor(deal.ai_score)}`}>{deal.ai_score}%</span>
              )}
            </div>
            {deal.business_name && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5 flex items-center gap-1">
                <Building2 className="w-3 h-3 shrink-0" />{deal.business_name}
              </p>
            )}
          </div>
          <div className="relative" ref={menuRef}>
            <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="p-1.5 -mr-1 rounded-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all">
              <MoreHorizontal className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-zinc-400" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-20 py-1 text-[12px]">
                <button onClick={(e) => { e.stopPropagation(); onEdit(deal); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"><Edit3 className="w-3 h-3" /> {t('pipeline.edit')}</button>
                {isWon && integrations?.stripe?.connected && !hasStripe && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); onAction(deal.id, 'stripe_invoice'); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"><CreditCard className="w-3 h-3" /> {t('pipeline.stripeInvoice')}</button>
                    <button onClick={(e) => { e.stopPropagation(); onAction(deal.id, 'stripe_link'); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"><Link2 className="w-3 h-3" /> {t('pipeline.paymentLink')}</button>
                  </>
                )}
                {isWon && integrations?.quickbooks?.connected && !hasQbo && (
                  <button onClick={(e) => { e.stopPropagation(); onAction(deal.id, 'qbo_invoice'); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"><Receipt className="w-3 h-3" /> {t('pipeline.qboInvoice')}</button>
                )}
                {deal.stripe_payment_url && (
                  <a href={deal.stripe_payment_url} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"><ExternalLink className="w-3 h-3" /> {t('pipeline.viewInvoice')}</a>
                )}
                <div className="border-t border-zinc-100 dark:border-zinc-800 my-1" />
                <button onClick={(e) => { e.stopPropagation(); onDelete(deal.id); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-3 h-3" /> {t('pipeline.delete')}</button>
              </div>
            )}
          </div>
        </div>
        {deal.value > 0 && (
          <div className="flex items-center gap-1.5 mb-1.5 sm:mb-2">
            <span className="text-[13px] font-bold text-zinc-900 dark:text-white tabular-nums">
              {fmt(deal.value, deal.currency)}
              {deal.is_recurring && <span className="text-[10px] text-zinc-400 font-medium ml-0.5">{deal.recurring_interval === 'year' ? t('pipeline.perYear') : t('pipeline.perMonth')}</span>}
            </span>
            {riskBadge(deal.ai_risk_level)}
          </div>
        )}
        {deal.ai_next_action && (
          <div className="mb-1.5 sm:mb-2 flex items-start gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded-md px-2 py-1.5">
            <Sparkles className="w-3 h-3 text-zinc-400 dark:text-zinc-500 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{deal.ai_next_action}</span>
          </div>
        )}
        {lastTrigger && (
          <div className="mb-1.5 sm:mb-2 flex items-center gap-1 text-[9px] text-zinc-400 dark:text-zinc-500">
            <Zap className="w-2.5 h-2.5" />
            <span>{t('pipeline.auto', { trigger: lastTrigger.trigger?.replace(/_/g, ' ') })}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500 flex-wrap">
          {deal.category && <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded truncate max-w-[80px]">{deal.category}</span>}
          {hasStripe && <span className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 ${deal.stripe_payment_status === 'paid' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}`}><CreditCard className="w-2.5 h-2.5" />{deal.stripe_payment_status === 'paid' ? t('pipeline.paid') : 'Stripe'}</span>}
          {hasQbo && <span className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 ${deal.qbo_invoice_status === 'paid' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}`}><Receipt className="w-2.5 h-2.5" />{deal.qbo_invoice_number ? `#${deal.qbo_invoice_number}` : 'QBO'}</span>}
          <span>{ago(deal.updated_at, t)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── StageColumn (Kanban) ───────────────────────────────────────────���
function StageColumn({ stage, deals, onAddDeal, onEditDeal, onDeleteDeal, onDragStart, onDragOver, onDrop, isDragOver, onAction, integrations, isBottleneck }: {
  stage: typeof STAGES[number]; deals: PipelineDeal[];
  onAddDeal: (s: string) => void; onEditDeal: (d: PipelineDeal) => void; onDeleteDeal: (id: string) => void;
  onDragStart: (e: React.DragEvent, d: PipelineDeal) => void;
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent, s: string) => void;
  isDragOver: boolean; onAction: (id: string, a: string) => void;
  integrations: IntegrationStatus | null; isBottleneck: boolean;
}) {
  const { t } = useTranslation();
  const sv = deals.reduce((s, d) => s + (d.value || 0), 0);
  const isWon = stage.key === 'closed_won';
  const isLost = stage.key === 'closed_lost';
  return (
    <div onDragOver={onDragOver} onDrop={(e) => onDrop(e, stage.key)}
      className={`flex-shrink-0 w-[240px] sm:w-[280px] flex flex-col rounded-xl border transition-all duration-200 ${isDragOver ? 'border-emerald-400/50 dark:border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/5' : isBottleneck ? 'border-amber-300/60 dark:border-amber-500/30 bg-amber-50/20 dark:bg-amber-500/5' : 'border-zinc-200 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30'}`}>
      <div className="px-3.5 py-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isWon ? 'bg-emerald-500' : isLost ? 'bg-red-400' : isBottleneck ? 'bg-amber-400 animate-pulse' : 'bg-zinc-400 dark:bg-zinc-500'}`} />
            <h3 className="text-[12px] font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">{t(`pipeline.stages.${stage.key}`, stage.label)}</h3>
            {isBottleneck && <AlertTriangle className="w-3 h-3 text-amber-500" />}
          </div>
          <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 tabular-nums">{deals.length}</span>
        </div>
        {sv > 0 && <p className={`text-[12px] font-semibold tabular-nums ${isWon ? 'text-emerald-600 dark:text-emerald-400' : isLost ? 'text-red-500 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'}`}>{fmt(sv)}</p>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {deals.map(deal => <DealCard key={deal.id} deal={deal} onEdit={onEditDeal} onDelete={onDeleteDeal} onDragStart={onDragStart} onAction={onAction} integrations={integrations} />)}
        {deals.length === 0 && !isDragOver && <div className="flex flex-col items-center justify-center py-8 text-zinc-400 dark:text-zinc-600"><p className="text-[11px]">{t('pipeline.noDealsBrief')}</p></div>}
      </div>
      {!isLost && (
        <button onClick={() => onAddDeal(stage.key)} className="mx-2 mb-2 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors text-[11px] font-medium"><Plus className="w-3 h-3" />{t('pipeline.addDeal')}</button>
      )}
    </div>
  );
}

// ─── DealTable (List View) ───────────────────────────────────────────
function DealTable({ deals, onEdit, onDelete, onAction, integrations }: {
  deals: PipelineDeal[]; onEdit: (d: PipelineDeal) => void; onDelete: (id: string) => void;
  onAction: (id: string, a: string) => void; integrations: IntegrationStatus | null;
}) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<string>('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    return [...deals].sort((a, b) => {
      let va: any, vb: any;
      switch (sortKey) {
        case 'contact_name': va = a.contact_name.toLowerCase(); vb = b.contact_name.toLowerCase(); break;
        case 'business_name': va = a.business_name.toLowerCase(); vb = b.business_name.toLowerCase(); break;
        case 'value': va = a.value; vb = b.value; break;
        case 'stage': va = STAGES.findIndex(s => s.key === a.stage); vb = STAGES.findIndex(s => s.key === b.stage); break;
        case 'ai_score': va = a.ai_score ?? -1; vb = b.ai_score ?? -1; break;
        default: va = new Date(a.updated_at).getTime(); vb = new Date(b.updated_at).getTime();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [deals, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortHeader = ({ k, label, className = '' }: { k: string; label: string; className?: string }) => (
    <button onClick={() => toggleSort(k)} className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors ${className}`}>
      {label}
      {sortKey === k && <ArrowUpDown className="w-2.5 h-2.5" />}
    </button>
  );

  if (deals.length === 0) {
    return <div className="flex flex-col items-center justify-center py-20 text-zinc-400 dark:text-zinc-600"><p className="text-[13px]">{t('pipeline.noDeals')}</p></div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className="text-left px-4 py-3"><SortHeader k="contact_name" label={t('pipeline.contact')} /></th>
            <th className="text-left px-4 py-3"><SortHeader k="business_name" label={t('pipeline.business')} /></th>
            <th className="text-left px-4 py-3"><SortHeader k="stage" label={t('pipeline.stage')} /></th>
            <th className="text-right px-4 py-3"><SortHeader k="value" label={t('pipeline.value')} className="justify-end" /></th>
            <th className="text-center px-4 py-3"><SortHeader k="ai_score" label={t('pipeline.score')} className="justify-center" /></th>
            <th className="text-left px-4 py-3"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{t('pipeline.integrationsLabel')}</span></th>
            <th className="text-right px-4 py-3"><SortHeader k="updated_at" label={t('pipeline.updated')} className="justify-end" /></th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(deal => {
            const hasStripe = !!deal.stripe_invoice_id || !!deal.stripe_payment_id;
            const hasQbo = !!deal.qbo_invoice_id;
            const isWon = deal.stage === 'closed_won';
            const isLost = deal.stage === 'closed_lost';
            const lastTrigger = deal.stage_history?.filter(h => h.trigger).slice(-1)[0];
            return (
              <tr key={deal.id} className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors group">
                <td className="px-4 py-3">
                  <button onClick={() => onEdit(deal)} className="text-left hover:underline">
                    <p className="font-semibold text-zinc-900 dark:text-white truncate max-w-[180px]">{deal.contact_name || t('pipeline.unnamed')}</p>
                    {deal.email && <p className="text-[11px] text-zinc-400 truncate max-w-[180px]">{deal.email}</p>}
                  </button>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]">{deal.business_name || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${isWon ? 'bg-emerald-500' : isLost ? 'bg-red-400' : 'bg-zinc-400'}`} />
                    <span className={`text-[12px] font-medium ${isWon ? 'text-emerald-600 dark:text-emerald-400' : isLost ? 'text-red-500 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                      {t(`pipeline.stages.${deal.stage}`, STAGE_LABEL_MAP[deal.stage] || deal.stage)}
                    </span>
                    {lastTrigger && <Zap className="w-2.5 h-2.5 text-zinc-400" title={`Auto: ${lastTrigger.trigger}`} />}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-bold text-zinc-900 dark:text-white tabular-nums">
                  {deal.value > 0 ? (
                    <>
                      {fmt(deal.value, deal.currency)}
                      {deal.is_recurring && <span className="text-[10px] text-zinc-400 font-medium ml-0.5">{deal.recurring_interval === 'year' ? t('pipeline.perYear') : t('pipeline.perMonth')}</span>}
                    </>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  {deal.ai_score != null ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-[12px] font-bold tabular-nums ${scoreColor(deal.ai_score)}`}>{deal.ai_score}</span>
                      {riskBadge(deal.ai_risk_level)}
                    </div>
                  ) : <span className="text-zinc-300 dark:text-zinc-700">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {hasStripe && <span className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-0.5 ${deal.stripe_payment_status === 'paid' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}`}><CreditCard className="w-2.5 h-2.5" />{deal.stripe_payment_status === 'paid' ? t('pipeline.paid') : 'Inv'}</span>}
                    {hasQbo && <span className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-0.5 ${deal.qbo_invoice_status === 'paid' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}`}><Receipt className="w-2.5 h-2.5" />{deal.qbo_invoice_number ? `#${deal.qbo_invoice_number}` : 'QBO'}</span>}
                    {!hasStripe && !hasQbo && <span className="text-zinc-300 dark:text-zinc-700">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-[11px] text-zinc-400 tabular-nums">{ago(deal.updated_at, t)}</td>
                <td className="px-2 py-3">
                  <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 opacity-100 transition-opacity">
                    {isWon && integrations?.stripe?.connected && !hasStripe && (
                      <button onClick={() => onAction(deal.id, 'stripe_invoice')} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800" title={t('pipeline.createStripeInvoice')}><CreditCard className="w-3.5 h-3.5 text-zinc-400" /></button>
                    )}
                    <button onClick={() => onDelete(deal.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title={t('pipeline.delete')}><Trash2 className="w-3.5 h-3.5 text-zinc-400 hover:text-red-500" /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── DealModal ───────────────────────────────────────────────────────
function DealModal({ deal, stage, onSave, onClose }: { deal: PipelineDeal | null; stage: string; onSave: (d: Partial<PipelineDeal>) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [contactName, setContactName] = useState(deal?.contact_name || '');
  const [businessName, setBusinessName] = useState(deal?.business_name || '');
  const [email, setEmail] = useState(deal?.email || '');
  const [value, setValue] = useState(deal?.value?.toString() || '');
  const [isRecurring, setIsRecurring] = useState(deal?.is_recurring || false);
  const [recurringInterval, setRecurringInterval] = useState<'month' | 'year'>(deal?.recurring_interval || 'month');
  const [notes, setNotes] = useState(deal?.notes || '');
  const [category, setCategory] = useState(deal?.category || '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(deal?.expected_close_date || '');
  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onSave({ contact_name: contactName.trim(), business_name: businessName.trim(), email: email.trim(), value: Number(value) || 0, is_recurring: isRecurring, recurring_interval: isRecurring ? recurringInterval : undefined, notes: notes.trim(), category: category.trim(), stage: deal?.stage || stage, expected_close_date: expectedCloseDate || undefined });
  };
  const ic = "w-full px-3 sm:px-4 py-2.5 sm:py-3 text-[16px] sm:text-[14px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 transition-colors min-h-[48px] appearance-none";
  const lc = "block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5";
  
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center px-0 pb-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 dark:bg-black/50 backdrop-blur-[8px]" />
      <div className="relative w-full sm:max-w-md flex flex-col bg-white dark:bg-[#111111] modal-as-bottom-sheet sm:rounded-2xl border border-zinc-200/80 dark:border-white/[0.08] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)] overflow-hidden max-h-[85vh] sm:max-h-[calc(100dvh-64px)]" onClick={(e) => e.stopPropagation()}>
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2 pb-0 shrink-0" onClick={onClose}>
          <div className="w-9 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>

        {/* Header — compact, inline close like AI assistant */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-2.5 sm:py-3 shrink-0 border-b border-zinc-100 dark:border-white/[0.06] sm:border-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-6 h-6 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
              <TrendingUp className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
            </div>
            <span className="text-[13px] sm:text-[12px] font-semibold text-zinc-900 dark:text-white sm:text-zinc-500 sm:dark:text-zinc-400 tracking-tight truncate">{deal ? t('pipeline.editDeal') : t('pipeline.newDeal')}</span>
          </div>
          <button onClick={onClose} className="tap-target-override p-2 sm:p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors inline-flex items-center justify-center shrink-0 -mr-1" title="Close" aria-label="Close">
            <X className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-3.5 mobile-form-container" style={{ overscrollBehavior: 'contain' }}>
          <div className="grid grid-cols-1 gap-3">
            <div><label className={lc}>{t('pipeline.contactName')}</label><input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder={t('pipeline.placeholderName')} className={ic} required autoFocus /></div>
            <div><label className={lc}>{t('pipeline.business')}</label><input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder={t('pipeline.placeholderBusiness')} className={ic} /></div>
          </div>
          <div><label className={lc}>{t('pipeline.email')}</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('pipeline.placeholderEmail')} className={ic} /></div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('pipeline.dealValue')}</label>
              <div className="mobile-chip-group flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-0.5 rounded-lg border border-zinc-200 dark:border-white/5">
                <button type="button" onClick={() => setIsRecurring(false)} className={`tap-target-override px-2.5 sm:px-2.5 py-1.5 sm:py-1 text-[10px] font-semibold rounded-md transition-all ${!isRecurring ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>{t('pipeline.oneTime')}</button>
                <button type="button" onClick={() => { setIsRecurring(true); setRecurringInterval('month'); }} className={`tap-target-override px-2.5 sm:px-2.5 py-1.5 sm:py-1 text-[10px] font-semibold rounded-md transition-all ${isRecurring && recurringInterval === 'month' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>{t('pipeline.perMonth')}</button>
                <button type="button" onClick={() => { setIsRecurring(true); setRecurringInterval('year'); }} className={`tap-target-override px-2.5 sm:px-2.5 py-1.5 sm:py-1 text-[10px] font-semibold rounded-md transition-all ${isRecurring && recurringInterval === 'year' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7] shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>{t('pipeline.perYear')}</button>
              </div>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-[16px] sm:text-[14px] pointer-events-none select-none">$</span>
              <input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder={t('pipeline.placeholderValue')} className={`${ic} pl-8 sm:pl-8 ${isRecurring ? 'pr-20' : ''}`} min="0" />
              {isRecurring && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 text-[12px] font-medium pointer-events-none select-none">{recurringInterval === 'year' ? t('pipeline.perYear') : t('pipeline.perMonth')}</span>}
            </div>
          </div>
            <div className="grid grid-cols-1 gap-3">
              <div><label className={lc}>{t('pipeline.category')}</label><input type="text" value={category} onChange={e => setCategory(e.target.value)} placeholder={t('pipeline.placeholderCategory')} className={ic} /></div>
              <div>
                <label className={lc}>{t('pipeline.expectedClose')}</label>
                <div className="relative w-full">
                  <input 
                    type="date" 
                    value={expectedCloseDate} 
                    onChange={e => setExpectedCloseDate(e.target.value)} 
                    className={`${ic} ${!expectedCloseDate ? 'text-zinc-400 dark:text-zinc-500' : 'uppercase'} block w-full m-0 cursor-text sm:cursor-pointer`} 
                  />
                </div>
              </div>
            </div>
          <div><label className={lc}>{t('pipeline.notes')}</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('pipeline.placeholderNotes')} rows={2} className={`${ic} resize-none`} style={{ minHeight: '70px' }} /></div>
        </form>

        {/* Sticky footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-zinc-100 dark:border-white/[0.06] shrink-0 flex gap-2.5 sm:gap-3 bg-white dark:bg-[#111111] keyboard-aware-footer">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 min-h-[52px] sm:min-h-[44px] text-[14px] sm:text-[13px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-[14px] sm:rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">{t('pipeline.cancel')}</button>
          <button type="button" onClick={() => handleSubmit()} className="flex-1 px-4 py-3 min-h-[52px] sm:min-h-[44px] text-[14px] sm:text-[13px] font-medium text-white bg-zinc-900 dark:bg-white dark:text-black rounded-[14px] sm:rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">{deal ? t('pipeline.saveChanges') : t('pipeline.createDeal')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── MetricCard ──────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, subtitle, accent }: { icon: React.ElementType; label: string; value: string; subtitle?: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
        <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] sm:text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider truncate">{label}</p>
        <p className="text-[14px] sm:text-[15px] font-bold tabular-nums text-zinc-900 dark:text-white whitespace-nowrap">{value}</p>
        {subtitle && <p className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 truncate whitespace-nowrap">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── AI Insights Panel ───────────────────────────────────────────────
function AiInsightsPanel({ insights, analyzing, onAnalyze }: { insights: AiInsights | null; analyzing: boolean; onAnalyze: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!insights && !analyzing) {
    return <button onClick={onAnalyze} className="flex items-center gap-2 px-3.5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-xl text-[12px] font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap"><Brain className="w-3.5 h-3.5 shrink-0" />{t('pipeline.aiAnalysis')}</button>;
  }
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900/60 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center"><Brain className="w-4 h-4 text-zinc-500 dark:text-zinc-400" /></div>
          <div className="text-left">
            <p className="text-[12px] font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              {t('pipeline.aiIntelligence')}
              {analyzing && <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />}
              {insights && !analyzing && <span className={`text-[11px] font-bold tabular-nums ${scoreColor(insights.health_score)}`}>{insights.health_score}/100</span>}
            </p>
            {insights && <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1 max-w-[500px]">{insights.summary}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onAnalyze(); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onAnalyze(); } }} className={`p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer ${analyzing ? 'opacity-50 pointer-events-none' : ''}`} title={t('pipeline.reanalyze')}><RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${analyzing ? 'animate-spin' : ''}`} /></div>
          <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {expanded && insights && (
        <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-3">
          {insights.recommendations?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">{t('pipeline.recommendations')}</p>
              <div className="space-y-1.5">
                {insights.recommendations.map((rec, i) => <div key={i} className="flex items-start gap-2 text-[12px] text-zinc-600 dark:text-zinc-300"><Sparkles className="w-3 h-3 text-zinc-400 dark:text-zinc-500 shrink-0 mt-0.5" /><span>{rec}</span></div>)}
              </div>
            </div>
          )}
          {insights.forecast_adjustment && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              {insights.forecast_adjustment === 'up' ? <ArrowUpRight className="w-4 h-4 text-zinc-500" /> : insights.forecast_adjustment === 'down' ? <TrendingDown className="w-4 h-4 text-red-500" /> : <Activity className="w-4 h-4 text-zinc-400" />}
              <span className="text-[12px] text-zinc-600 dark:text-zinc-300">{t('pipeline.forecastLabel')} <span className="font-semibold capitalize">{insights.forecast_adjustment}</span></span>
            </div>
          )}
          {insights.generated_at && <p className="text-[10px] text-zinc-400 dark:text-zinc-600 flex items-center gap-1"><Clock className="w-3 h-3" />{t('pipeline.analyzedAgo', { time: ago(insights.generated_at, t) })}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Integration Bar ─────────────────────────────────────────────────
function IntegrationBar({ integrations, syncing, onSync }: { integrations: IntegrationStatus | null; syncing: string | null; onSync: (t: 'stripe' | 'qbo') => void }) {
  const { t } = useTranslation();
  if (!integrations) return null;
  const items = [
    { key: 'stripe', label: 'Stripe', connected: integrations.stripe.connected, icon: CreditCard },
    { key: 'qbo', label: 'QuickBooks', connected: integrations.quickbooks.connected, icon: Receipt },
    { key: 'calendly', label: 'Calendly', connected: !!integrations.calendly?.connected, icon: Calendar },
    { key: 'ai', label: 'AI', connected: integrations.ai.enabled, icon: Brain },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {items.map(item => (
        <div key={item.key} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border ${item.connected ? 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300' : 'bg-zinc-50 dark:bg-zinc-800/30 border-zinc-100 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600'}`}>
          <item.icon className={`w-3 h-3 ${item.connected ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600'}`} />
          <span>{item.label}</span>
          {item.connected && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />}
          {item.connected && (item.key === 'stripe' || item.key === 'qbo') && (
            <button onClick={() => onSync(item.key as 'stripe' | 'qbo')} disabled={!!syncing} className="ml-0.5 p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50" title={t('pipeline.syncLabel', { label: item.label })}>
              <RefreshCw className={`w-2.5 h-2.5 ${syncing === item.key ? 'animate-spin text-emerald-500' : 'text-zinc-400'}`} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Pipeline Component ─────────────────────────────────────────
export default function Pipeline() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const { emit: emitRealtime } = useRealtimeContext();
  const pipelineRefreshKey = useRealtimeRefresh(['pipeline:deal_created', 'pipeline:deal_updated', 'pipeline:deal_moved', 'pipeline:deal_deleted']);
  const [deals, setDeals] = useState<PipelineDeal[]>(isDemoMode ? DEMO_PIPELINE_DEALS : []);
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [loading, setLoading] = useState(isDemoMode ? false : true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<PipelineDeal | null>(null);
  const [modalStage, setModalStage] = useState('prospect_identified');
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dragDealRef = useRef<PipelineDeal | null>(null);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [showCrmImport, setShowCrmImport] = useState(false);

  const fetchDeals = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const data = await apiCache.fetch(
        'pipeline:deals',
        async () => {
          const res = await fetch(`${getApiBase()}/deals`, { headers });
          if (!res.ok) throw new Error(`${res.status}`);
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      setDeals(data.deals || []);
    } catch (err: any) { console.error('[PIPELINE] Fetch deals error:', err); toast.error(t('pipeline.failedToLoad')); }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const data = await apiCache.fetch(
        'pipeline:metrics',
        async () => {
          const res = await fetch(`${getApiBase()}/metrics`, { headers });
          if (!res.ok) throw new Error(`${res.status}`);
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      setMetrics(data);
    } catch (err: any) { console.error('[PIPELINE] Metrics error:', err); }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${getApiBase()}/integrations/status`, { headers });
      if (res.ok) setIntegrations(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchCachedInsights = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${getApiBase()}/ai/insights`, { headers });
      if (res.ok) { const d = await res.json(); if (d.insights) setAiInsights(d.insights); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      if (isDemoMode) return; // Skip loading in demo mode
      setLoading(true);
      await Promise.all([fetchDeals(), fetchMetrics(), fetchIntegrations(), fetchCachedInsights()]);
      setLoading(false);
    })();
  }, [fetchDeals, fetchMetrics, fetchIntegrations, fetchCachedInsights, isDemoMode]);

  // ── Real-time sync: reload when another tab/user makes pipeline changes ──
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    if (pipelineRefreshKey > 0) {
      console.log('[PIPELINE] Real-time refresh triggered');
      fetchDeals();
      fetchMetrics();
    }
  }, [pipelineRefreshKey, fetchDeals, fetchMetrics, isDemoMode]);

  // ── App-event sync: reload pipeline instantly on in-tab mutations ──
  const pipelineAppEventKey = useAppEventRefresh(['pipeline:changed']);
  useEffect(() => {
    if (isDemoMode) return; // Skip in demo mode
    if (pipelineAppEventKey > 0) {
      console.log('[PIPELINE] App-event refresh triggered');
      fetchDeals();
      fetchMetrics();
    }
  }, [pipelineAppEventKey, fetchDeals, fetchMetrics, isDemoMode]);

  const runAiAnalysis = useCallback(async () => {
    setAnalyzing(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${getApiBase()}/ai/analyze`, { method: 'POST', headers });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
      const data = await res.json();
      setAiInsights(data.insights);
      await fetchDeals();
      toast.success(t('pipeline.aiAnalysisComplete'), { description: t('pipeline.healthLabel', { score: data.insights.health_score }) });
    } catch (err: any) { toast.error(t('pipeline.aiAnalysisFailed'), { description: err.message }); }
    finally { setAnalyzing(false); }
  }, [fetchDeals]);

  const handleSync = useCallback(async (type: 'stripe' | 'qbo') => {
    setSyncing(type);
    try {
      const headers = await getAuthHeaders();
      const ep = type === 'stripe' ? `${getApiBase()}/integrations/stripe/sync` : `${getApiBase()}/integrations/qbo/sync`;
      const res = await fetch(ep, { method: 'POST', headers });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
      const data = await res.json();
      toast.success(t('pipeline.syncedLabel', { type: type === 'stripe' ? 'Stripe' : 'QuickBooks' }), { description: t('pipeline.dealsMatched', { count: data.matched }) });
      await Promise.all([fetchDeals(), fetchMetrics()]);
    } catch (err: any) { toast.error(t('pipeline.syncFailed'), { description: err.message }); }
    finally { setSyncing(null); }
  }, [fetchDeals, fetchMetrics]);

  const handleDealAction = useCallback(async (dealId: string, action: string) => {
    try {
      const headers = await getAuthHeaders();
      let ep = '', label = '';
      if (action === 'stripe_invoice') { ep = `${getApiBase()}/integrations/stripe/create-invoice`; label = t('pipeline.stripeInvoice'); }
      else if (action === 'stripe_link') { ep = `${getApiBase()}/integrations/stripe/create-payment-link`; label = t('pipeline.paymentLink'); }
      else if (action === 'qbo_invoice') { ep = `${getApiBase()}/integrations/qbo/create-invoice`; label = t('pipeline.qboInvoice'); }
      else return;
      const res = await fetch(ep, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ deal_id: dealId }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || `Failed`); }
      const data = await res.json();
      toast.success(t('pipeline.invoiceCreated', { label }), {
        description: data.invoice_url || data.payment_url ? t('pipeline.clickToView') : `${fmt(data.amount)}`,
        action: data.invoice_url || data.payment_url ? { label: t('pipeline.open'), onClick: () => window.open(data.invoice_url || data.payment_url, '_blank') } : undefined,
      });
      await fetchDeals();
    } catch (err: any) { toast.error(t('pipeline.actionFailed'), { description: err.message }); }
  }, [fetchDeals]);

  const handleSaveDeal = async (data: Partial<PipelineDeal>) => {
    try {
      const headers = await getAuthHeaders();
      if (editingDeal) {
        const res = await fetch(`${getApiBase()}/deals/${editingDeal.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error(`${res.status}`); toast.success(t('pipeline.dealUpdated'));
        emitRealtime('pipeline:deal_updated', { dealName: data.contact_name || editingDeal.contact_name });
      } else {
        const res = await fetch(`${getApiBase()}/deals`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error(`${res.status}`); toast.success(t('pipeline.dealCreated'));
        emitRealtime('pipeline:deal_created', { dealName: data.contact_name });
      }
      setModalOpen(false); setEditingDeal(null);
      dispatchAppEvent({ type: 'pipeline:changed' });
      await Promise.all([fetchDeals(), fetchMetrics()]);
    } catch (err: any) { toast.error(t('pipeline.failedToSave'), { description: err.message }); }
  };

  const handleDeleteDeal = async (dealId: string) => {
    if (!confirm(t('pipeline.deleteDeal'))) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${getApiBase()}/deals/${dealId}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(`${res.status}`); toast.success(t('pipeline.dealDeleted'));
      emitRealtime('pipeline:deal_deleted', { dealId });
      dispatchAppEvent({ type: 'pipeline:changed', ids: [dealId] });
      await Promise.all([fetchDeals(), fetchMetrics()]);
    } catch (err: any) { toast.error(t('pipeline.failedToDelete')); }
  };

  const handleDragStart = (e: React.DragEvent, deal: PipelineDeal) => {
    dragDealRef.current = deal; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', deal.id);
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault(); setDragOverStage(null);
    const deal = dragDealRef.current;
    if (!deal || deal.stage === targetStage) return;
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, stage: targetStage, updated_at: new Date().toISOString() } : d));
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${getApiBase()}/deals/${deal.id}/move`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: targetStage }) });
      if (!res.ok) throw new Error(`${res.status}`);
      const sl = t(`pipeline.stages.${targetStage}`, STAGE_LABEL_MAP[targetStage] || targetStage);
      if (targetStage === 'closed_won') {
        toast.success(t('pipeline.dealWon', { name: deal.contact_name }), { description: fmt(deal.value) });
        if (integrations?.stripe?.connected || integrations?.quickbooks?.connected) {
          setTimeout(() => {
            toast(t('pipeline.createInvoiceFor', { name: deal.contact_name }), {
              description: `${fmt(deal.value)}`,
              action: integrations?.stripe?.connected ? { label: t('pipeline.stripeInvoice'), onClick: () => handleDealAction(deal.id, 'stripe_invoice') } : integrations?.quickbooks?.connected ? { label: t('pipeline.qboInvoice'), onClick: () => handleDealAction(deal.id, 'qbo_invoice') } : undefined,
              duration: 10000,
            });
          }, 500);
        }
      } else if (targetStage === 'closed_lost') { toast(t('pipeline.dealLost'), { description: deal.contact_name }); }
      else { toast.success(t('pipeline.movedTo', { stage: sl })); }
      emitRealtime('pipeline:deal_moved', { dealName: deal.contact_name, stageName: STAGE_LABEL_MAP[targetStage] || targetStage });
      dispatchAppEvent({ type: 'pipeline:changed', ids: [deal.id], meta: { stage: targetStage } });
      await fetchMetrics();
    } catch { toast.error(t('pipeline.failedToMove')); await fetchDeals(); }
    dragDealRef.current = null;
  };
  const handleColumnDragOver = (e: React.DragEvent, sk: string) => { handleDragOver(e); setDragOverStage(sk); };

  const dealsByStage: Record<string, PipelineDeal[]> = {};
  for (const s of STAGES) dealsByStage[s.key] = deals.filter(d => d.stage === s.key);

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-6 py-6 lg:px-8 border-b border-zinc-200 dark:border-zinc-800">
          <div className="h-7 w-48 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
          <div className="h-4 w-72 bg-zinc-100 dark:bg-zinc-800/60 rounded mt-2 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">{[...Array(4)].map((_, i) => <div key={i} className="h-[68px] bg-zinc-100 dark:bg-zinc-800/40 rounded-xl animate-pulse" />)}</div>
        </div>
        <div className="flex-1 flex gap-3 p-4 overflow-x-auto">{[...Array(6)].map((_, i) => <div key={i} className="w-[280px] shrink-0 h-64 bg-zinc-100 dark:bg-zinc-800/30 rounded-xl animate-pulse" />)}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 sm:py-5 lg:px-8 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-transparent space-y-3 sm:space-y-4">
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] sm:text-[20px] font-bold text-zinc-900 dark:text-white tracking-tight truncate">{t('pipeline.title', 'Pipeline')}</h1>
            <p className="text-[12px] sm:text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 hidden sm:block truncate">{t('pipeline.subtitle', 'AI Revenue Pipeline — track every deal from outreach to close')}</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* View toggle */}
            <div className="flex items-center border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden h-9">
              <button onClick={() => setViewMode('kanban')} className={`w-9 h-full flex items-center justify-center transition-colors ${viewMode === 'kanban' ? 'bg-zinc-900 dark:bg-white text-white dark:text-black' : 'bg-white dark:bg-zinc-900 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`} title={t('pipeline.kanbanView')}><LayoutGrid className="w-3.5 h-3.5" /></button>
              <button onClick={() => setViewMode('list')} className={`w-9 h-full flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-zinc-900 dark:bg-white text-white dark:text-black' : 'bg-white dark:bg-zinc-900 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`} title={t('pipeline.listView')}><List className="w-3.5 h-3.5" /></button>
            </div>
            {/* Activity feed button */}
            <button
              onClick={() => setActivityOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
              title={t('pipeline.broadcast')}
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
            <span className="hidden md:inline-flex">{integrations?.ai?.enabled && <AiInsightsPanel insights={aiInsights} analyzing={analyzing} onAnalyze={runAiAnalysis} />}</span>
            <button onClick={() => setShowCrmImport(true)}
              className="flex items-center justify-center sm:justify-start sm:gap-2 w-9 h-9 sm:w-auto sm:h-auto sm:px-4 sm:py-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded-lg sm:rounded-xl text-[13px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
              title={t('pipeline.importFromCRM')}>
              <Users className="w-3.5 h-3.5 shrink-0" /><span className="hidden sm:inline">{t('pipeline.importFromCRM')}</span>
            </button>
            <button onClick={() => { setEditingDeal(null); setModalStage('prospect_identified'); setModalOpen(true); }}
              className="flex items-center justify-center sm:justify-start sm:gap-2 w-9 h-9 sm:w-auto sm:h-auto sm:px-4 sm:py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg sm:rounded-xl text-[13px] font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-sm whitespace-nowrap">
              <Plus className="w-4 h-4 shrink-0" /><span className="hidden sm:inline">{t('pipeline.newDeal')}</span>
            </button>
          </div>
        </div>
        <div className="hidden sm:block"><IntegrationBar integrations={integrations} syncing={syncing} onSync={handleSync} /></div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
          <MetricCard icon={CircleDollarSign} label={t('pipeline.pipelineValue')} value={fmtK(metrics?.totalPipelineValue || 0)} subtitle={t('pipeline.activeDeals', { count: metrics?.activeDeals || 0 })} />
          <MetricCard icon={TrendingUp} label={t('pipeline.forecast')} value={fmtK(metrics?.forecast || 0)} subtitle={t('pipeline.weightedByStage')} accent />
          <MetricCard icon={Trophy} label={t('pipeline.won')} value={fmtK(metrics?.wonValue || 0)} subtitle={t('pipeline.dealsClosed', { count: metrics?.wonDeals || 0 })} accent />
          <MetricCard icon={Percent} label={t('pipeline.closeRate')} value={`${metrics?.closeRate || 0}%`} subtitle={t('pipeline.lost', { count: metrics?.lostDeals || 0 })} />
          <div className="hidden xl:block"><MetricCard icon={Activity} label={t('pipeline.velocity')} value={`${metrics?.weeklyVelocity || 0}`} subtitle={t('pipeline.avgClose', { days: metrics?.avgDaysToClose || '—' })} /></div>
        </div>
      </div>

      {/* Board / Table */}
      {viewMode === 'kanban' ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden -webkit-overflow-scrolling-touch">
          <div className="flex gap-2 sm:gap-3 p-3 sm:p-4 h-full min-w-max">
            {STAGES.map(stage => (
              <StageColumn key={stage.key} stage={stage} deals={dealsByStage[stage.key] || []}
                onAddDeal={sk => { setEditingDeal(null); setModalStage(sk); setModalOpen(true); }}
                onEditDeal={d => { setEditingDeal(d); setModalStage(d.stage); setModalOpen(true); }}
                onDeleteDeal={handleDeleteDeal} onDragStart={handleDragStart}
                onDragOver={e => handleColumnDragOver(e, stage.key)} onDrop={handleDrop}
                isDragOver={dragOverStage === stage.key} onAction={handleDealAction}
                integrations={integrations} isBottleneck={aiInsights?.bottleneck_stage === stage.key} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <DealTable deals={deals}
            onEdit={d => { setEditingDeal(d); setModalStage(d.stage); setModalOpen(true); }}
            onDelete={handleDeleteDeal} onAction={handleDealAction} integrations={integrations} />
        </div>
      )}

      {modalOpen && <DealModal deal={editingDeal} stage={modalStage} onSave={handleSaveDeal} onClose={() => { setModalOpen(false); setEditingDeal(null); }} />}
      {showCrmImport && (
        <AddToPipelineModal
          onClose={() => setShowCrmImport(false)}
          onSuccess={(created) => {
            if (created > 0) {
              fetchDeals();
              fetchMetrics();
              emitRealtime('pipeline:deal_created', { count: created, source: 'crm_import' });
            }
          }}
        />
      )}
      <ActivityFeed open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}