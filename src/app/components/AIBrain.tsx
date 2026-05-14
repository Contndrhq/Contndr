import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Sparkles, Target, BookOpen, MessageSquare, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { KnowledgeBase } from './KnowledgeBase';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ─── Shape mirrored from backend sanitizeAICallPlaybook ─────────────────────
interface ObjectionEntry { trigger: string; response: string; label?: string; }
interface AICallPlaybook {
  qualifying_questions: string[];
  value_props: string[];
  meeting_options: string;
  booking_link: string;
  objections: ObjectionEntry[];
  close_style: 'soft' | 'direct';
}
const EMPTY_PLAYBOOK: AICallPlaybook = {
  qualifying_questions: [], value_props: [], meeting_options: '',
  booking_link: '', objections: [], close_style: 'soft',
};
const SUGGESTED_OBJECTIONS: ObjectionEntry[] = [
  { trigger: 'already have', response: "Totally fair — most teams I talk to already have something. What's the one thing it doesn't do well that you wish it did?", label: 'already_have' },
  { trigger: 'too expensive', response: "Yeah, budget's always real — but folks getting value usually pay it back in the first month from one extra deal. Mind if I show you the math?", label: 'price' },
  { trigger: 'send me info', response: "Happy to — but a 10-min screen-share lands way better than a deck. How's tomorrow at this same time?", label: 'send_info' },
  { trigger: 'not the right time', response: "Got it — won't keep you. Want me to grab 10 min on the calendar later this week instead?", label: 'bad_timing' },
  { trigger: 'talk to my team', response: "Makes sense — best path is I show you both at once. Want 15 min with the two of you this week?", label: 'not_dm' },
  { trigger: 'think about it', response: "Totally — what's the main thing on your mind? I'd rather answer it now than have you stuck on it later.", label: 'thinking' },
];

// ─── Voice & Tone (user-level defaults flowing into agents + campaigns) ───
interface AIVoice {
  ai_name: string;
  brand: string;
  tone: 'friendly' | 'professional' | 'direct' | 'confident';
  voice_id: string;
  filler_words: boolean;
}
const EMPTY_VOICE: AIVoice = {
  ai_name: '', brand: '', tone: 'friendly', voice_id: 'rachel', filler_words: true,
};
const VOICE_OPTIONS = [
  { id: 'rachel', label: 'Rachel — calm, professional female' },
  { id: 'bella',  label: 'Bella — warm, engaging female' },
  { id: 'sarah',  label: 'Sarah — friendly, natural female' },
  { id: 'josh',   label: 'Josh — deep, confident male' },
  { id: 'adam',   label: 'Adam — deep, warm male' },
];

export function AIBrain() {
  const [section, setSection] = useState<'facts' | 'script' | 'voice'>('facts');

  // ── Playbook ──
  const [playbook, setPlaybook] = useState<AICallPlaybook>(EMPTY_PLAYBOOK);
  const [pbLoading, setPbLoading] = useState(true);
  const [pbSaving, setPbSaving] = useState(false);

  // ── Voice ──
  const [voice, setVoice] = useState<AIVoice>(EMPTY_VOICE);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voiceSaving, setVoiceSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setPbLoading(true);
    setVoiceLoading(true);
    try {
      const [pbRes, vRes] = await Promise.all([
        authenticatedFetch(`${API_BASE}/ai-call-playbook`).catch(() => null),
        authenticatedFetch(`${API_BASE}/ai-brain/voice`).catch(() => null),
      ]);
      if (pbRes?.ok) {
        const j = await pbRes.json();
        setPlaybook({ ...EMPTY_PLAYBOOK, ...(j.playbook || {}) });
      }
      if (vRes?.ok) {
        const j = await vRes.json();
        setVoice({ ...EMPTY_VOICE, ...(j.voice || {}) });
      }
    } finally {
      setPbLoading(false);
      setVoiceLoading(false);
    }
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const savePlaybook = async () => {
    setPbSaving(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/ai-call-playbook`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playbook),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Save failed');
      setPlaybook({ ...EMPTY_PLAYBOOK, ...(j.playbook || {}) });
      toast.success('Sales script saved');
    } catch (err: any) { toast.error('Could not save', { description: err.message }); }
    finally { setPbSaving(false); }
  };

  const saveVoice = async () => {
    setVoiceSaving(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/ai-brain/voice`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(voice),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Save failed');
      setVoice({ ...EMPTY_VOICE, ...(j.voice || {}) });
      toast.success('Voice & tone saved');
    } catch (err: any) { toast.error('Could not save', { description: err.message }); }
    finally { setVoiceSaving(false); }
  };

  // Playbook helpers
  const updateArr = (k: 'qualifying_questions' | 'value_props', i: number, v: string) =>
    setPlaybook(p => { const a = [...p[k]]; a[i] = v; return { ...p, [k]: a }; });
  const addArr = (k: 'qualifying_questions' | 'value_props') =>
    setPlaybook(p => ({ ...p, [k]: [...p[k], ''] }));
  const rmArr = (k: 'qualifying_questions' | 'value_props', i: number) =>
    setPlaybook(p => ({ ...p, [k]: p[k].filter((_, idx) => idx !== i) }));
  const updateObj = (i: number, f: keyof ObjectionEntry, v: string) =>
    setPlaybook(p => { const o = [...p.objections]; o[i] = { ...o[i], [f]: v }; return { ...p, objections: o }; });
  const addObj = () => setPlaybook(p => ({ ...p, objections: [...p.objections, { trigger: '', response: '' }] }));
  const rmObj = (i: number) => setPlaybook(p => ({ ...p, objections: p.objections.filter((_, idx) => idx !== i) }));
  const seedObj = () => {
    setPlaybook(p => {
      const have = new Set(p.objections.map(o => o.trigger.toLowerCase().trim()));
      const fresh = SUGGESTED_OBJECTIONS.filter(o => !have.has(o.trigger.toLowerCase().trim()));
      return { ...p, objections: [...p.objections, ...fresh] };
    });
    toast.success('Added starter objections — edit to match your voice');
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/[0.08] dark:to-white/[0.03] flex items-center justify-center border border-zinc-200/80 dark:border-white/[0.06] shrink-0">
          <Sparkles className="w-4.5 h-4.5 text-zinc-600 dark:text-zinc-300" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">AI Brain</h2>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
            Everything your AI needs to sound like you on emails and calls. One place. Three sections.
          </p>
        </div>
      </div>

      {/* Section switcher */}
      <div className="flex bg-zinc-100 dark:bg-white/[0.06] rounded-lg p-0.5 border border-zinc-200/60 dark:border-white/[0.06] w-fit">
        <SectionTab active={section === 'facts'} onClick={() => setSection('facts')} icon={BookOpen} label="Facts" />
        <SectionTab active={section === 'script'} onClick={() => setSection('script')} icon={MessageSquare} label="Sales Script" />
        <SectionTab active={section === 'voice'} onClick={() => setSection('voice')} icon={Mic} label="Voice & Tone" />
      </div>

      {/* FACTS — the existing KB */}
      {section === 'facts' && (
        <div className="space-y-3">
          <SectionDesc>
            Anything the AI should <em>know</em> about your business — pricing, products, hours, FAQs, common objections, case studies. Used by email composer and live AI calls.
          </SectionDesc>
          <KnowledgeBase />
        </div>
      )}

      {/* SALES SCRIPT — the playbook */}
      {section === 'script' && (
        <div className="space-y-4">
          <SectionDesc>
            How the AI should <em>act</em> on a call — what to ask, how to pitch, how to handle objections, and how to ask for the meeting. Applies to every AI call.
          </SectionDesc>

          {pbLoading ? <Loader /> : (
            <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] divide-y divide-zinc-100 dark:divide-white/[0.06] bg-white dark:bg-black">
              {/* Qualifying questions */}
              <div className="px-4 py-3">
                <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200 mb-2">
                  Qualifying questions <span className="text-zinc-400 dark:text-zinc-500 font-normal">— up to 5, AI picks one per call</span>
                </p>
                <div className="space-y-2">
                  {playbook.qualifying_questions.map((q, i) => (
                    <Row key={i} value={q} placeholder={i === 0 ? 'e.g. How are you currently handling outbound?' : ''} onChange={v => updateArr('qualifying_questions', i, v)} onRemove={() => rmArr('qualifying_questions', i)} />
                  ))}
                  {playbook.qualifying_questions.length < 5 && (
                    <AddBtn onClick={() => addArr('qualifying_questions')} label="Add question" />
                  )}
                </div>
              </div>

              {/* Value props */}
              <div className="px-4 py-3">
                <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200 mb-2">
                  Value props <span className="text-zinc-400 dark:text-zinc-500 font-normal">— outcomes, not features</span>
                </p>
                <div className="space-y-2">
                  {playbook.value_props.map((v, i) => (
                    <Row key={i} value={v} placeholder={i === 0 ? 'e.g. Cut prospecting time from 4 hours/day to 30 min' : ''} onChange={val => updateArr('value_props', i, val)} onRemove={() => rmArr('value_props', i)} />
                  ))}
                  {playbook.value_props.length < 5 && (
                    <AddBtn onClick={() => addArr('value_props')} label="Add value prop" />
                  )}
                </div>
              </div>

              {/* Close mechanics */}
              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Meeting times the AI proposes">
                  <input type="text" value={playbook.meeting_options} onChange={e => setPlaybook(p => ({ ...p, meeting_options: e.target.value }))} placeholder="Thursday at 2pm or Friday at 10am ET" className={inputClass} />
                </Field>
                <Field label="Booking link (optional)">
                  <input type="url" value={playbook.booking_link} onChange={e => setPlaybook(p => ({ ...p, booking_link: e.target.value }))} placeholder="https://cal.com/you/15min" className={inputClass} />
                </Field>
                <Field label="Close style">
                  <div className="flex bg-zinc-100 dark:bg-white/[0.06] rounded-lg p-0.5 border border-zinc-200/60 dark:border-white/[0.06] w-fit">
                    {(['soft', 'direct'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setPlaybook(p => ({ ...p, close_style: s }))} className={`px-3 py-1 rounded-md text-[11.5px] font-medium transition-all ${playbook.close_style === s ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
                        {s === 'soft' ? 'Soft' : 'Direct'}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              {/* Objections */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200">
                    Objection library <span className="text-zinc-400 dark:text-zinc-500 font-normal">— up to 12</span>
                  </p>
                  <button type="button" onClick={seedObj} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
                    <Sparkles className="w-3 h-3" />Add 6 starters
                  </button>
                </div>
                <div className="space-y-2">
                  {playbook.objections.map((obj, i) => (
                    <div key={i} className="rounded-lg border border-zinc-200 dark:border-white/[0.08] p-2.5 space-y-2 bg-zinc-50/40 dark:bg-white/[0.02]">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-1.5">
                          <input type="text" value={obj.trigger} onChange={e => updateObj(i, 'trigger', e.target.value)} placeholder='Trigger phrase, e.g. "too expensive"' className={`${inputClass} font-medium`} />
                          <textarea value={obj.response} onChange={e => updateObj(i, 'response', e.target.value)} placeholder="What the AI should say in response" rows={2} className={`${inputClass} resize-none`} />
                        </div>
                        <button type="button" onClick={() => rmObj(i)} className="p-1.5 text-zinc-400 hover:text-red-500" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                  {playbook.objections.length < 12 && <AddBtn onClick={addObj} label="Add objection" />}
                </div>
              </div>

              <div className="px-4 py-3 flex justify-end">
                <button type="button" onClick={savePlaybook} disabled={pbSaving} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:opacity-90 disabled:opacity-50">
                  {pbSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                  Save sales script
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VOICE & TONE */}
      {section === 'voice' && (
        <div className="space-y-4">
          <SectionDesc>
            How the AI should <em>sound</em>. Sets the default agent name, brand, tone, and voice that flow into every new campaign and every call.
          </SectionDesc>

          {voiceLoading ? <Loader /> : (
            <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] divide-y divide-zinc-100 dark:divide-white/[0.06] bg-white dark:bg-black">
              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="AI agent name">
                  <input type="text" value={voice.ai_name} onChange={e => setVoice(v => ({ ...v, ai_name: e.target.value }))} placeholder="Alex" className={inputClass} />
                </Field>
                <Field label="Your brand / business name">
                  <input type="text" value={voice.brand} onChange={e => setVoice(v => ({ ...v, brand: e.target.value }))} placeholder="Contndr" className={inputClass} />
                </Field>
              </div>

              <div className="px-4 py-3">
                <Field label="Tone">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['friendly', 'professional', 'direct', 'confident'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setVoice(v => ({ ...v, tone: t }))} className={`px-3 py-2 rounded-md border text-[12px] font-medium transition-all ${voice.tone === t ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white' : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <div className="px-4 py-3">
                <Field label="Default voice">
                  <select value={voice.voice_id} onChange={e => setVoice(v => ({ ...v, voice_id: e.target.value }))} className={inputClass}>
                    {VOICE_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </select>
                </Field>
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200">Use natural filler words</p>
                  <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-0.5">Lets the AI say "yeah", "um", "actually" so it sounds less robotic. Recommended on.</p>
                </div>
                <button type="button" role="switch" aria-checked={voice.filler_words} onClick={() => setVoice(v => ({ ...v, filler_words: !v.filler_words }))} className={`relative inline-flex h-6 w-11 items-center rounded-full shrink-0 transition-colors ${voice.filler_words ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-200 dark:bg-white/[0.12]'}`}>
                  <span className={`inline-block h-4.5 w-4.5 transform rounded-full transition-all shadow-sm ${voice.filler_words ? 'translate-x-[22px] bg-white dark:bg-zinc-900' : 'translate-x-[3px] bg-white dark:bg-zinc-400'}`} style={{ width: 18, height: 18 }} />
                </button>
              </div>

              <div className="px-4 py-3 flex justify-end">
                <button type="button" onClick={saveVoice} disabled={voiceSaving} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-[12.5px] font-semibold hover:opacity-90 disabled:opacity-50">
                  {voiceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
                  Save voice
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const inputClass = 'w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7]/50';

function SectionTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-all ${active ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
      <Icon className="w-3.5 h-3.5" />{label}
    </button>
  );
}
function SectionDesc({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{children}</p>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
function Row({ value, placeholder, onChange, onRemove }: { value: string; placeholder?: string; onChange: (v: string) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
      <button type="button" onClick={onRemove} className="p-1.5 text-zinc-400 hover:text-red-500 shrink-0" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
    </div>
  );
}
function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
      <Plus className="w-3 h-3" />{label}
    </button>
  );
}
function Loader() { return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>; }
