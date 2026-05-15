/**
 * TemplateLibrary — Email template CRUD with categories, search, and insert-to-campaign.
 *
 * Shown as a slide-out panel or modal from CampaignBuilder.
 */
import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Search, Trash2, Edit3, Copy, FileText, Loader2, ChevronDown, Check, Tag, Clock } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { previewTokens, extractTokens } from '../lib/personalization-tokens';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/templates`;

// ── Types ─────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: 'general',      label: 'General' },
  { value: 'cold_intro',   label: 'Cold Intro' },
  { value: 'follow_up',    label: 'Follow-Up' },
  { value: 'breakup',      label: 'Breakup' },
  { value: 'meeting',      label: 'Meeting Request' },
  { value: 'referral',     label: 'Referral Ask' },
  { value: 'value_add',    label: 'Value Add' },
  { value: 'case_study',   label: 'Case Study' },
  { value: 're_engagement', label: 'Re-Engagement' },
];

const CATEGORY_MAP = new Map(CATEGORIES.map(c => [c.value, c.label]));

// ── Props ─────────────────────────────────────────────────────────────

interface TemplateLibraryProps {
  open: boolean;
  onClose: () => void;
  /** Called when user wants to use a template — passes subject & body */
  onInsert?: (subject: string, body: string) => void;
  /** If true, show in "manage" mode (full CRUD) vs "picker" mode (select only) */
  manageMode?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────

export function TemplateLibrary({ open, onClose, onInsert, manageMode }: TemplateLibraryProps) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formCategory, setFormCategory] = useState('general');

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await authenticatedFetch(API);
      const data = await res.json();
      if (data.success) setTemplates(data.templates || []);
    } catch (err) {
      console.error('[TEMPLATES] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetchTemplates();
    }
  }, [open, fetchTemplates]);

  function startCreate() {
    setCreating(true);
    setEditing(null);
    setFormName('');
    setFormSubject('');
    setFormBody('');
    setFormCategory('general');
  }

  function startEdit(t: Template) {
    setEditing(t);
    setCreating(false);
    setFormName(t.name);
    setFormSubject(t.subject);
    setFormBody(t.body);
    setFormCategory(t.category);
  }

  function cancelForm() {
    setCreating(false);
    setEditing(null);
  }

  async function saveTemplate() {
    if (!formName.trim()) {
      toast.error('Template name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: formName, subject: formSubject, body: formBody, category: formCategory };
      if (editing) {
        await authenticatedFetch(`${API}/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Template updated');
      } else {
        await authenticatedFetch(API, { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Template saved');
      }
      cancelForm();
      await fetchTemplates();
    } catch (err: any) {
      toast.error('Failed to save template', { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template permanently?')) return;
    try {
      await authenticatedFetch(`${API}/${id}`, { method: 'DELETE' });
      toast.success('Template deleted');
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err: any) {
      toast.error('Failed to delete', { description: err.message });
    }
  }

  function handleInsert(t: Template) {
    onInsert?.(t.subject, t.body);
    onClose();
    toast.success(`Template "${t.name}" inserted`);
  }

  // Filtered list
  const filtered = templates.filter(t => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
    }
    return true;
  });

  if (!open) return null;

  const isFormOpen = creating || editing;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg h-full bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col animate-slide-in-right shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-[#1ED4A7]" />
            <h2 className="text-[16px] font-bold text-zinc-900 dark:text-white">
              {manageMode ? 'Template Library' : 'Insert Template'}
            </h2>
            <span className="text-[11px] font-medium text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
              {templates.length}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-8 pr-3 py-1.5 text-[13px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-[#1ED4A7]"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[12px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-[#1ED4A7]"
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <button
            onClick={startCreate}
            className="flex items-center gap-1 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-black text-[12px] font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Create / Edit form */}
          {isFormOpen && (
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
              <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white mb-3">
                {editing ? 'Edit Template' : 'New Template'}
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 mb-1">Name *</label>
                    <input
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      placeholder="e.g. Cold Intro V2"
                      className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-[#1ED4A7]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 mb-1">Category</label>
                    <select
                      value={formCategory}
                      onChange={e => setFormCategory(e.target.value)}
                      className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-[#1ED4A7]"
                    >
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-500 mb-1">Subject Line</label>
                  <input
                    value={formSubject}
                    onChange={e => setFormSubject(e.target.value)}
                    placeholder="e.g. Quick question about {{company|your company}}"
                    className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-[#1ED4A7] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-500 mb-1">Body</label>
                  <textarea
                    value={formBody}
                    onChange={e => setFormBody(e.target.value)}
                    placeholder="Hi {{first_name|there}},&#10;&#10;I noticed..."
                    rows={6}
                    className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-[#1ED4A7] font-mono leading-relaxed resize-none"
                  />
                </div>

                {/* Token usage indicator */}
                {(formSubject || formBody) && (
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <Tag className="w-3 h-3" />
                    {(() => {
                      const tokens = extractTokens(formSubject + ' ' + formBody);
                      return tokens.length > 0
                        ? `${tokens.length} token${tokens.length !== 1 ? 's' : ''}: ${tokens.map(t => t.token).join(', ')}`
                        : 'No personalization tokens detected';
                    })()}
                  </div>
                )}

                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={cancelForm}
                    className="px-3 py-1.5 text-[12px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveTemplate}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-black text-[12px] font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50"
                  >
                    {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                    {editing ? 'Update' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Template list */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <FileText className="w-10 h-10 text-zinc-300 dark:text-zinc-700 mb-3" />
              <p className="text-[14px] font-medium text-zinc-500 dark:text-zinc-400">
                {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
              </p>
              <p className="text-[12px] text-zinc-400 dark:text-zinc-600 mt-1">
                {templates.length === 0 ? 'Save your best-performing emails as reusable templates.' : 'Try a different search or category.'}
              </p>
              {templates.length === 0 && (
                <button
                  onClick={startCreate}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-[13px] font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Your First Template
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {filtered.map(t => (
                <div key={t.id} className="group px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[14px] font-semibold text-zinc-900 dark:text-white truncate">
                          {t.name}
                        </p>
                        <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded uppercase">
                          {CATEGORY_MAP.get(t.category) || t.category}
                        </span>
                      </div>
                      {t.subject && (
                        <p className="text-[12px] text-zinc-600 dark:text-zinc-400 truncate font-mono mb-1">
                          {t.subject}
                        </p>
                      )}
                      <p className="text-[12px] text-zinc-400 dark:text-zinc-600 line-clamp-2 leading-relaxed">
                        {t.body.slice(0, 150)}{t.body.length > 150 ? '...' : ''}
                      </p>

                      {/* Preview expansion */}
                      {previewId === t.id && (
                        <div className="mt-2 p-3 bg-[#1ED4A7]/5 border border-[#1ED4A7]/20 rounded-lg">
                          <p className="text-[10px] font-bold text-[#1ED4A7] uppercase tracking-wider mb-1.5">Preview with sample data</p>
                          {t.subject && (
                            <p className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                              {previewTokens(t.subject)}
                            </p>
                          )}
                          <p className="text-[12px] text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                            {previewTokens(t.body)}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(t.updated_at).toLocaleDateString()}
                        </span>
                        {extractTokens(t.subject + ' ' + t.body).length > 0 && (
                          <span className="text-[11px] text-[#1ED4A7] flex items-center gap-1 font-medium">
                            <Tag className="w-3 h-3" />
                            {extractTokens(t.subject + ' ' + t.body).length} tokens
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => setPreviewId(previewId === t.id ? null : t.id)}
                        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        title="Preview"
                      >
                        <Copy className="w-3.5 h-3.5 text-zinc-500" />
                      </button>
                      {onInsert && (
                        <button
                          onClick={() => handleInsert(t)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-[#1ED4A7] border border-[#1ED4A7]/30 rounded-lg hover:bg-[#1ED4A7]/10 transition-colors"
                        >
                          Use
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(t)}
                        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-zinc-500" />
                      </button>
                      <button
                        onClick={() => deleteTemplate(t.id)}
                        className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-zinc-400 hover:text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TemplateLibrary;
