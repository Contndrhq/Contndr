import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, TrendingUp, CheckCircle2, Loader2, Users, ChevronDown, ArrowRight, Trophy, XCircle, DollarSign } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { toTitleCase } from '../utils/title-case';
import { IconButton } from './ui/icon-button';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from './ui/use-mobile';

const STAGES = [
  { key: 'prospect_identified', label: 'addToPipelineModal.prospectIdentified', desc: 'addToPipelineModal.prospectIdentifiedDesc' },
  { key: 'contacted', label: 'addToPipelineModal.contacted', desc: 'addToPipelineModal.contactedDesc' },
  { key: 'engaged', label: 'addToPipelineModal.engaged', desc: 'addToPipelineModal.engagedDesc' },
  { key: 'meeting_booked', label: 'addToPipelineModal.meetingBooked', desc: 'addToPipelineModal.meetingBookedDesc' },
  { key: 'proposal_sent', label: 'addToPipelineModal.proposalSent', desc: 'addToPipelineModal.proposalSentDesc' },
  { key: 'negotiation', label: 'addToPipelineModal.negotiation', desc: 'addToPipelineModal.negotiationDesc' },
  { key: 'closed_won', label: 'addToPipelineModal.won', desc: 'addToPipelineModal.wonDesc', outcome: 'won' },
  { key: 'closed_lost', label: 'addToPipelineModal.lost', desc: 'addToPipelineModal.lostDesc', outcome: 'lost' },
] as const;

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface Lead {
  id: string;
  contact_name: string;
  business_name: string;
  email: string;
  category?: string;
  city?: string;
}

// ── Memoized lead row for performance ──
const LeadPickerRow = memo(function LeadPickerRow({ lead, selected, onToggle }: { lead: Lead; selected: boolean; onToggle: (id: string) => void }) {
  return (
    <label className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${selected ? 'bg-zinc-50 dark:bg-zinc-950' : 'hover:bg-zinc-50/60 dark:hover:bg-zinc-900'}`}>
      <div className={`w-[18px] h-[18px] rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
        selected
          ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white'
          : 'border-zinc-300 dark:border-white/15 bg-transparent'
      }`}>
        {selected && (
          <svg className="w-3 h-3 text-white dark:text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <input type="checkbox" checked={selected} onChange={() => onToggle(lead.id)} className="sr-only" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-zinc-900 dark:text-white truncate">
          {toTitleCase(lead.contact_name || lead.business_name) || '—'}
        </p>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
          {lead.business_name && lead.contact_name ? `${toTitleCase(lead.business_name)} · ` : ''}{lead.email || '—'}
          {lead.category ? ` · ${toTitleCase(lead.category)}` : ''}
        </p>
      </div>
    </label>
  );
});

interface AddToPipelineModalProps {
  onClose: () => void;
  /** Pre-selected lead IDs (from CRM selection) */
  preselectedLeadIds?: string[];
  /** Pre-loaded leads (skips fetching if provided) */
  preselectedLeads?: Lead[];
  /** Called after successful import */
  onSuccess?: (created: number, skipped: number) => void;
}

export function AddToPipelineModal({ onClose, preselectedLeadIds = [], preselectedLeads, onSuccess }: AddToPipelineModalProps) {
  const { t } = useTranslation();
  const [stage, setStage] = useState('prospect_identified');
  const [dealValue, setDealValue] = useState('');
  const [leads, setLeads] = useState<Lead[]>(preselectedLeads || []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preselectedLeadIds));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(!preselectedLeads);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'select' | 'stage'>(preselectedLeadIds.length > 0 ? 'stage' : 'select');
  const isMobile = useIsMobile();

  // Fetch leads from CRM if not pre-loaded
  useEffect(() => {
    if (preselectedLeads) return;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_BASE}/leads?limit=500`, { headers });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        setLeads(data.leads || data || []);
      } catch (err) {
        console.error('[ADD-TO-PIPELINE] Failed to load leads:', err);
        toast.error(t('addToPipelineModal.failedToLoadLeads'));
      } finally {
        setLoading(false);
      }
    })();
  }, [preselectedLeads]);

  const filteredLeads = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter(l =>
      l.contact_name?.toLowerCase().includes(q) ||
      l.business_name?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q) ||
      l.category?.toLowerCase().includes(q)
    );
  }, [leads, search]);

  const toggleLead = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedIds.size === filteredLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map(l => l.id)));
    }
  }, [filteredLeads, selectedIds.size]);

  async function handleSubmit() {
    if (selectedIds.size === 0) {
      toast.error(t('addToPipelineModal.selectAtLeast'));
      return;
    }
    setSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/pipeline/deals/from-leads`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_ids: Array.from(selectedIds),
          stage,
          deal_value: dealValue ? parseFloat(dealValue.replace(/,/g, '')) : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `${res.status}`);
      }

      const data = await res.json();
      const { created, skipped } = data;

      if (created > 0) {
        toast.success(t('addToPipelineModal.leadsAddedToPipeline', { count: created }), {
          description: skipped > 0 ? `${skipped} ${t('addToPipelineModal.alreadyInPipeline')}` : undefined,
        });
      } else if (skipped > 0) {
        toast.info(t('addToPipelineModal.allAlreadyInPipeline', { count: skipped }));
      }

      onSuccess?.(created, skipped);
      onClose();
    } catch (err: any) {
      console.error('[ADD-TO-PIPELINE] Error:', err);
      toast.error(`${t('addToPipelineModal.failedToAddToPipeline')}: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedStage = STAGES.find(s => s.key === stage);

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-zinc-900 dark:text-white">
                {step === 'select' ? t('addToPipelineModal.addLeadsToPipeline') : t('addToPipelineModal.choosePipelineStage')}
              </h2>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {step === 'select'
                  ? t('addToPipelineModal.leadsSelected', { count: selectedIds.size })
                  : t('addToPipelineModal.leadsWillBeAdded', { count: selectedIds.size })
                }
              </p>
            </div>
          </div>
          <IconButton size="sm" onClick={onClose} title="Close" aria-label="Close">
            <X />
          </IconButton>
        </div>

        {step === 'select' ? (
          <>
            {/* Search */}
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('addToPipelineModal.searchLeads')}
                  className="w-full pl-10 pr-4 py-2.5 text-[13px] bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 transition-all"
                  autoFocus
                />
              </div>
              {leads.length > 0 && (
                <button
                  onClick={selectAll}
                  className="mt-2 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                >
                  {selectedIds.size === filteredLeads.length ? t('addToPipelineModal.deselectAll') : t('addToPipelineModal.selectAllLeads', { count: filteredLeads.length })}
                </button>
              )}
            </div>

            {/* Lead list */}
            <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400 dark:text-zinc-600">
                  <Users className="w-8 h-8 mb-2" />
                  <p className="text-[13px]">{search ? t('addToPipelineModal.noLeadsMatch') : t('addToPipelineModal.noLeadsInCRM')}</p>
                </div>
              ) : (
                filteredLeads.slice(0, 200).map(lead => (
                  <LeadPickerRow key={lead.id} lead={lead} selected={selectedIds.has(lead.id)} onToggle={toggleLead} />
                ))
              )}
              {filteredLeads.length > 200 && (
                <p className="px-4 py-3 text-[11px] text-zinc-400 dark:text-zinc-500 text-center">
                  {t('addToPipelineModal.showingFirst', { count: filteredLeads.length })}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0 flex items-center justify-between gap-2 sm:gap-3">
              <button onClick={onClose} className="px-3 sm:px-4 py-2.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => setStep('stage')}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-2 px-4 sm:px-5 py-2.5 text-[13px] font-medium text-white bg-zinc-900 dark:bg-white dark:text-black rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">{t('addToPipelineModal.nextChooseStage')}</span>
                <span className="sm:hidden">{t('common.next')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Stage picker */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider px-2 mb-3">
                {t('addToPipelineModal.whichStage')}
              </p>
              {STAGES.filter(s => !('outcome' in s)).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStage(s.key)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all text-left ${
                    stage === s.key
                      ? 'border-zinc-900 dark:border-white/40 bg-zinc-900/[0.03] dark:bg-white/[0.05] ring-1 ring-zinc-900/5 dark:ring-white/5'
                      : 'border-zinc-200 dark:border-zinc-700/50 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    stage === s.key ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold ${stage === s.key ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
                      {t(s.label)}
                    </p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t(s.desc)}</p>
                  </div>
                  {stage === s.key && <CheckCircle2 className="w-4 h-4 text-[#1ED4A7] shrink-0" />}
                </button>
              ))}

              {/* Outcome stages separator */}
              <div className="flex items-center gap-3 pt-2 pb-1 px-2">
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700/50" />
                <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">{t('addToPipelineModal.outcomes')}</span>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700/50" />
              </div>

              {/* Won / Lost */}
              <div className="grid grid-cols-2 gap-2">
                {STAGES.filter(s => 'outcome' in s).map((s) => {
                  const isWon = s.key === 'closed_won';
                  const isSelected = stage === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setStage(s.key)}
                      className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all text-left ${
                        isSelected
                          ? isWon
                            ? 'border-emerald-500/60 bg-emerald-500/[0.08] ring-1 ring-emerald-500/10'
                            : 'border-red-500/60 bg-red-500/[0.08] ring-1 ring-red-500/10'
                          : 'border-zinc-200 dark:border-zinc-700/50 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center ${
                        isSelected
                          ? isWon ? 'bg-emerald-500/20' : 'bg-red-500/20'
                          : 'bg-zinc-200 dark:bg-zinc-700'
                      }`}>
                        {isWon
                          ? <Trophy className={`w-3 h-3 ${isSelected ? 'text-emerald-400' : 'text-zinc-400 dark:text-zinc-500'}`} />
                          : <XCircle className={`w-3 h-3 ${isSelected ? 'text-red-400' : 'text-zinc-400 dark:text-zinc-500'}`} />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] font-semibold ${
                          isSelected
                            ? isWon ? 'text-emerald-400' : 'text-red-400'
                            : 'text-zinc-700 dark:text-zinc-300'
                        }`}>
                          {t(s.label)}
                        </p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t(s.desc)}</p>
                      </div>
                      {isSelected && <CheckCircle2 className={`w-4 h-4 shrink-0 ${isWon ? 'text-emerald-400' : 'text-red-400'}`} />}
                    </button>
                  );
                })}
              </div>

              {/* Deal Value */}
              <div className="pt-2">
                <div className="flex items-center gap-3 px-2 mb-2">
                  <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700/50" />
                  <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Deal Value</span>
                  <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700/50" />
                </div>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                    <DollarSign className="w-3.5 h-3.5 text-zinc-400" />
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={dealValue}
                    onChange={e => {
                      // Allow digits, commas, one decimal point
                      const v = e.target.value.replace(/[^0-9.,]/g, '');
                      setDealValue(v);
                    }}
                    placeholder="0.00"
                    className="w-full pl-9 pr-4 py-3 text-[14px] font-medium bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:focus:ring-zinc-500/30 focus:border-zinc-400 dark:focus:border-zinc-500 transition-all"
                  />
                  {dealValue && (
                    <button
                      onClick={() => setDealValue('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-zinc-300 dark:bg-zinc-600 flex items-center justify-center hover:bg-zinc-400 dark:hover:bg-zinc-500 transition-colors"
                    >
                      <X className="w-2.5 h-2.5 text-white dark:text-zinc-900" />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1.5 px-1">Optional — estimated deal size for this stage</p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0 flex items-center justify-between gap-2 sm:gap-3">
              {preselectedLeadIds.length === 0 ? (
                <button onClick={() => setStep('select')} className="px-3 sm:px-4 py-2.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0">
                  {t('common.back')}
                </button>
              ) : (
                <button onClick={onClose} className="px-3 sm:px-4 py-2.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0">
                  {t('common.cancel')}
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting || selectedIds.size === 0}
                className="flex items-center gap-2 px-4 sm:px-5 py-2.5 text-[13px] font-medium text-white bg-zinc-900 dark:bg-white dark:text-black rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-0"
              >
                {submitting ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('addToPipelineModal.adding')}</>
                ) : (
                  <><TrendingUp className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{t('addToPipelineModal.addToPipeline')}</span></>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}