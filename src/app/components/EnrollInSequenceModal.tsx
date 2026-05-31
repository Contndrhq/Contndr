import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Mail, Users, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { useTranslation } from 'react-i18next';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface SequenceSummary {
  id: string;
  name: string;
  status: string;
  steps: { id: string; stepNumber: number; stepLabel: string }[];
  dailyLimit: number;
  stopOnReply: boolean;
}

interface EnrollInSequenceModalProps {
  leadIds: string[];
  leadEmails: { id: string; email: string; name?: string }[];
  onClose: () => void;
  onEnrolled: () => void;
}

export function EnrollInSequenceModal({ leadIds, leadEmails, onClose, onEnrolled }: EnrollInSequenceModalProps) {
  const { t } = useTranslation();
  const [sequences, setSequences] = useState<SequenceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const leadsWithEmail = leadEmails.filter(l => l.email);
  const leadsWithoutEmail = leadIds.length - leadsWithEmail.length;

  const loadSequences = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSequences(data.sequences || []);
      }
    } catch (err) {
      console.error('Failed to load sequences:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSequences(); }, [loadSequences]);

  const enroll = async () => {
    if (!selectedSeqId) { toast.error(t('enrollSequenceModal.selectSequence')); return; }
    if (leadsWithEmail.length === 0) { toast.error(t('enrollSequenceModal.noEmailAddresses')); return; }

    setEnrolling(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/sequences/${selectedSeqId}/enroll`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: leadsWithEmail.map(l => l.id),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const enrolled = data.enrolled || leadsWithEmail.length;
        const skipped = data.skipped || 0;
        toast.success(t('enrollSequenceModal.enrolled', { count: enrolled }) + (skipped > 0 ? ` ${t('enrollSequenceModal.skippedAlready', { count: skipped })}` : ''));
        onEnrolled();
        onClose();
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        toast.error(err.error || t('enrollSequenceModal.failedToEnroll'));
      }
    } catch (err) {
      console.error('Enroll error:', err);
      toast.error(t('enrollSequenceModal.networkErrorEnrolling'));
    } finally {
      setEnrolling(false);
    }
  };

  const selectedSeq = sequences.find(s => s.id === selectedSeqId);
  const activeSequences = sequences.filter(s => s.status === 'active' || s.status === 'paused' || s.status === 'draft');

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal — bottom-sheet on mobile, centered card on desktop */}
      <div className="relative bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl border-t sm:border border-zinc-200 dark:border-white/10 shadow-2xl w-full sm:max-w-lg sm:mx-4 max-h-[90vh] sm:max-h-[80vh] flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-white/5">
          <div>
            <h2 className="text-[15px] font-semibold text-black dark:text-white">{t('enrollSequenceModal.title')}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {t('enrollSequenceModal.leadsWithEmail', { count: leadsWithEmail.length })}
              {leadsWithoutEmail > 0 && (
                <span className="text-amber-500"> {t('enrollSequenceModal.withoutEmailSkipped', { count: leadsWithoutEmail })}</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors">
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
            </div>
          ) : activeSequences.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-zinc-500 mb-1">{t('enrollSequenceModal.noSequences')}</p>
              <p className="text-xs text-zinc-400">{t('enrollSequenceModal.createSequenceFirst')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSequences.map(seq => (
                <button
                  key={seq.id}
                  onClick={() => setSelectedSeqId(seq.id)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    selectedSeqId === seq.id
                      ? 'border-emerald-400 dark:border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-500/5'
                      : 'border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        seq.status === 'active' ? 'bg-emerald-500' :
                        seq.status === 'paused' ? 'bg-amber-500' : 'bg-zinc-300'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-black dark:text-white truncate">{seq.name}</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          {seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''} &middot; {seq.dailyLimit}/day &middot; {seq.status}
                          {seq.stopOnReply && ' &middot; auto-stop on reply'}
                        </p>
                      </div>
                    </div>
                    {selectedSeqId === seq.id && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    )}
                  </div>

                  {/* Step preview dots */}
                  <div className="flex items-center gap-1 mt-2.5 ml-5">
                    {seq.steps.map((step, i) => (
                      <div key={step.id} className="flex items-center">
                        <div className="w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[8px] font-bold text-zinc-500 dark:text-zinc-400">
                          {step.stepNumber}
                        </div>
                        {i < seq.steps.length - 1 && (
                          <div className="w-3 h-px bg-zinc-200 dark:bg-zinc-700" />
                        )}
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Warning for leads without email */}
          {leadsWithoutEmail > 0 && (
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                {t('enrollSequenceModal.leadsSkippedNoEmail', { count: leadsWithoutEmail })}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 dark:border-white/5 flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-white transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={enroll}
            disabled={!selectedSeqId || enrolling || leadsWithEmail.length === 0}
            className="px-5 py-2.5 text-xs font-semibold bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {enrolling ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('enrollSequenceModal.enrolling')}</>
            ) : (
              <><Zap className="w-3.5 h-3.5" /> {t('enrollSequenceModal.enrollLeads', { count: leadsWithEmail.length })}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EnrollInSequenceModal;