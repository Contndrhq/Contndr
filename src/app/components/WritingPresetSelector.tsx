import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Trash2, ChevronDown, Bookmark, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

export interface WritingPreset {
  id: string;
  name: string;
  tone: string;
  maxWords: number;
  customInstructions: string;
  exampleEmail: string;
  createdAt: string;
}

export interface WritingValues {
  tone: string;
  maxWords: number;
  customInstructions: string;
  exampleEmail: string;
}

interface WritingPresetSelectorProps {
  currentValues: WritingValues;
  onApply: (values: WritingValues) => void;
}

export function WritingPresetSelector({ currentValues, onApply }: WritingPresetSelectorProps) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<WritingPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadPresets = useCallback(async () => {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/writing-presets`, { headers });
      if (res.ok) {
        const data = await res.json();
        setPresets(data.presets || []);
      }
    } catch (err) {
      console.error('[WritingPresets] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPresets(); }, [loadPresets]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowSaveInput(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus the input when save mode activates
  useEffect(() => {
    if (showSaveInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showSaveInput]);

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) { toast.error(t('campaignBuilder.enterPresetName')); return; }
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API}/writing-presets`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          tone: currentValues.tone,
          maxWords: currentValues.maxWords,
          customInstructions: currentValues.customInstructions,
          exampleEmail: currentValues.exampleEmail,
        }),
      });
      if (res.ok) {
        toast.success(t('campaignBuilder.presetSaved', { name }));
        setPresetName('');
        setShowSaveInput(false);
        loadPresets();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || t('campaignBuilder.failedToSavePreset'));
      }
    } catch (err: any) {
      toast.error(err.message || t('campaignBuilder.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const deletePreset = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API}/writing-presets/${id}`, { method: 'DELETE', headers });
      toast.success(t('campaignBuilder.presetDeleted'));
      setPresets(prev => prev.filter(p => p.id !== id));
    } catch {
      toast.error(t('campaignBuilder.failedToDelete'));
    } finally {
      setDeletingId(null);
    }
  };

  const applyPreset = (preset: WritingPreset) => {
    onApply({
      tone: preset.tone,
      maxWords: preset.maxWords,
      customInstructions: preset.customInstructions,
      exampleEmail: preset.exampleEmail,
    });
    setOpen(false);
    toast.success(t('campaignBuilder.presetApplied', { name: preset.name }));
  };

  const hasCurrentValues = !!(
    currentValues.tone ||
    currentValues.customInstructions ||
    currentValues.exampleEmail ||
    (currentValues.maxWords && currentValues.maxWords !== 75)
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2">
        {/* Dropdown trigger */}
        <button
          type="button"
          onClick={() => { setOpen(!open); setShowSaveInput(false); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg transition-colors"
        >
          <Bookmark className="w-3 h-3" />
          <span className="hidden sm:inline">{t('campaignBuilder.presets')}</span>
          <span className="sm:hidden">
            {presets.length > 0 ? presets.length : ''}
          </span>
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Save current button */}
        {hasCurrentValues && (
          <button
            type="button"
            onClick={() => { setOpen(true); setShowSaveInput(true); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-[#1ED4A7] hover:text-[#19b892] bg-[#1ED4A7]/10 hover:bg-[#1ED4A7]/15 rounded-lg transition-colors"
          >
            <Save className="w-3 h-3" />
            <span className="hidden sm:inline">{t('campaignBuilder.saveCurrent')}</span>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1.5 right-0 w-72 sm:w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
          {/* Save new preset */}
          {showSaveInput && (
            <div className="p-3 border-b border-zinc-100 dark:border-white/5">
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">{t('campaignBuilder.saveCurrentSettings')}</p>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') { setShowSaveInput(false); setPresetName(''); } }}
                  placeholder={t('campaignBuilder.presetNamePlaceholder')}
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-[12px] border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-zinc-900 dark:text-white placeholder:text-zinc-400"
                />
                <button
                  onClick={savePreset}
                  disabled={saving || !presetName.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg disabled:opacity-40 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors shrink-0"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  {t('campaignBuilder.saveBtn')}
                </button>
              </div>
            </div>
          )}

          {/* Preset list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
              </div>
            ) : presets.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <Bookmark className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{t('campaignBuilder.noSavedPresets')}</p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                  {t('campaignBuilder.configurePresetsHint')}
                </p>
              </div>
            ) : (
              presets.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className="w-full flex items-start gap-3 px-3.5 py-3 text-left hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors border-b border-zinc-50 dark:border-white/[0.03] last:border-b-0 group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-zinc-900 dark:text-white truncate">{preset.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {preset.tone && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400">
                          {preset.tone}
                        </span>
                      )}
                      {preset.maxWords && preset.maxWords !== 75 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400">
                          {preset.maxWords}w
                        </span>
                      )}
                      {preset.customInstructions && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400">
                          {t('campaignBuilder.customInstructionsTag')}
                        </span>
                      )}
                      {preset.exampleEmail && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400">
                          {t('campaignBuilder.exampleEmailTag')}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => deletePreset(preset.id, e)}
                    className="p-1 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-all shrink-0 mt-0.5"
                    title={t('campaignBuilder.deletePreset')}
                  >
                    {deletingId === preset.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </button>
              ))
            )}
          </div>

          {/* Footer hint */}
          {!showSaveInput && hasCurrentValues && presets.length > 0 && (
            <div className="px-3.5 py-2.5 border-t border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950">
              <button
                onClick={() => setShowSaveInput(true)}
                className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                <Save className="w-3 h-3" /> Save current settings as new preset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
