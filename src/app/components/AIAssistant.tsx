import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo, type ReactNode } from 'react';
import {
  ArrowRight, X, Loader2, Navigation, Mail, Search, FileText,
  Copy, ChevronDown, ChevronUp, Building2, MapPin, Phone, CheckCircle,
  Bookmark, Users, Radar, ExternalLink, Check, Send, Pencil,
  Clock, MessageSquare, Trash2, Plus, ChevronLeft, Rocket,
  Settings2, Zap, Target, PenLine
} from 'lucide-react';
import { authenticatedFetch, getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { EnhancedSearchProgress } from './AIAssistantImprovements';
import { useBroadcast } from './BroadcastContext';
import { toast } from 'sonner';
import { apiCache } from '../lib/api-cache';
import { IconButton } from './ui/icon-button';
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';

// ── Session types ──────────────────────────────────────────────

interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  leadCount: number;
  preview: string;
}

interface SerializableMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  leads?: DiscoveredLead[];
  searchState?: 'complete' | 'local-done';
  searchCount?: number;
  searchParams?: AIAction;
  actions?: AIAction[];
  timestamp: string;
}

// ── Types ──────────────────────────────────────────────────────

interface DiscoveredLead {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string;
  linkedin_url: string;
  phone_numbers: { raw_number: string; type: string }[];
  city: string;
  state: string;
  country: string;
  seniority: string;
  organization: {
    name: string;
    website_url: string;
    industry: string;
    estimated_num_employees: number;
  };
}

interface CampaignDraft {
  name: string;
  subject: string;
  body: string;
  tone: string;
  leadCount: number;
  leadFilter?: string;
  lead_ids?: string[];
  brand?: string;
  product?: string;
  fromEmail?: string;
  senderName?: string;
  senderTitle?: string;
  campaignKnowledge?: string;
  followUpEnabled?: boolean;
  followUpDays?: number;
  maxFollowUps?: number;
  audienceType?: 'all' | 'group' | 'filter';
  groupId?: string;
  groupName?: string;
}

interface LeadGroup {
  id: string;
  name: string;
  color: string;
  lead_count: { count: number }[];
}

interface UserCampaignSettings {
  signatureName: string;
  signatureTitle: string;
  signatureEmail: string;
  signatureWebsite: string;
  signaturePhone: string;
  signatureClosingLine: string;
  signatureCustomHtml: string;
  signatureText: string; // pre-built signature preview text
  hasSignature: boolean;
  brand: string;
  fromEmail: string;
  emailProvider: string; // 'resend' (default/not configured), 'gmail_oauth', 'outlook_oauth', 'smtp'
  connectedEmail: string; // the actual connected email address
  knowledgeBrands: string[];
  groups: LeadGroup[];
  isAdmin: boolean;
  userEmail: string;
  loaded: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: AIAction[];
  leads?: DiscoveredLead[];
  searchState?: 'searching' | 'complete' | 'error' | 'local-done';
  searchPhase?: string;
  searchCount?: number;
  searchParams?: AIAction;
  campaignDraft?: CampaignDraft;
  campaignState?: 'preview' | 'sending' | 'sent' | 'error';
  timestamp: Date;
}

interface AIAction {
  type: 'navigate' | 'open_campaign_builder' | 'search_leads' | 'draft_email' | 'find_leads' | 'launch_campaign';
  view?: string;
  query?: string;
  subject?: string;
  body?: string;
  label?: string;
  person_titles?: string[];
  organization_locations?: string[];
  organization_industries?: string[];
  q_keywords?: string;
  max_results?: number;
  campaign_name?: string;
  tone?: string;
  lead_filter?: string;
  campaign_knowledge?: string;
}

interface AIAssistantProps {
  onNavigate?: (view: string) => void;
  onOpenCampaignBuilder?: () => void;
  userName?: string;
  externalOpen?: boolean;
  onExternalClose?: () => void;
  initialQuery?: string;
}

// ── Sparkle icon ───────────────────────────────────────────────

function SparkleIcon({ className = '', size = 20 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L13.8 8.56L12 10L10.2 8.56L12 2Z" fill="currentColor" />
      <path d="M12 22L10.2 15.44L12 14L13.8 15.44L12 22Z" fill="currentColor" />
      <path d="M2 12L8.56 10.2L10 12L8.56 13.8L2 12Z" fill="currentColor" />
      <path d="M22 12L15.44 13.8L14 12L15.44 10.2L22 12Z" fill="currentColor" />
      <path d="M12 8.5L14 12L12 15.5L10 12L12 8.5Z" fill="currentColor" opacity="0.9" />
      <path d="M18.5 4V7M17 5.5H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Mobile keyboard & viewport helper ─────────────────────────
function useVisualViewport() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const diff = window.innerHeight - vv.height;
      const open = diff > 100; // keyboard threshold
      setKeyboardHeight(open ? diff : 0);
      setIsKeyboardOpen(open);
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return { keyboardHeight, isKeyboardOpen };
}

// ── Suggestion chips ───────────────────────────────────────────

const SUGGESTION_KEYS = [
  { labelKey: 'aiAssistant.suggestions.findLeads', icon: Radar, promptKey: 'aiAssistant.suggestions.findLeadsPrompt' },
  { labelKey: 'aiAssistant.suggestions.launchCampaign', icon: Rocket, promptKey: 'aiAssistant.suggestions.launchCampaignPrompt' },
  { labelKey: 'aiAssistant.suggestions.campaignStats', icon: Mail, promptKey: 'aiAssistant.suggestions.campaignStatsPrompt' },
  { labelKey: 'aiAssistant.suggestions.draftEmail', icon: FileText, promptKey: 'aiAssistant.suggestions.draftEmailPrompt' },
];

// ── Robust JSON action stripper ────────────────────────────────
// Uses brace-depth counting to handle merge tags like {{first_name}} inside JSON
function stripActionJSON(text: string): string {
  const ACTION_TYPES = ['launch_campaign', 'find_leads', 'navigate', 'open_campaign_builder', 'search_leads', 'draft_email'];
  let result = text;

  for (const type of ACTION_TYPES) {
    const needle = `"${type}"`;
    let idx = result.indexOf(needle);
    while (idx !== -1) {
      let start = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (result[i] === '{') { start = i; break; }
        if (result[i] === '}') break;
      }
      if (start === -1) { idx = result.indexOf(needle, idx + needle.length); continue; }

      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = start; i < result.length; i++) {
        const ch = result[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (ch === '{') depth++;
          if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
      }

      if (end !== -1) {
        result = result.substring(0, start) + result.substring(end + 1);
        idx = result.indexOf(needle);
      } else {
        idx = result.indexOf(needle, idx + needle.length);
      }
    }
  }

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

// ── Robust inline action extractor (frontend fallback) ─────────
function extractInlineActionsClient(text: string): { actions: AIAction[]; cleanedText: string } {
  const ACTION_TYPES = ['launch_campaign', 'find_leads', 'navigate', 'open_campaign_builder', 'search_leads', 'draft_email'];
  const extracted: { action: AIAction; start: number; end: number }[] = [];

  for (const type of ACTION_TYPES) {
    const needle = `"${type}"`;
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const typeIdx = text.indexOf(needle, searchFrom);
      if (typeIdx === -1) break;

      let start = -1;
      for (let i = typeIdx - 1; i >= 0; i--) {
        if (text[i] === '{') { start = i; break; }
        if (text[i] === '}') break;
      }
      if (start === -1) { searchFrom = typeIdx + needle.length; continue; }

      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (ch === '{') depth++;
          if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
      }
      if (end === -1) { searchFrom = typeIdx + needle.length; continue; }

      const jsonStr = text.substring(start, end + 1);
      try {
        const sanitized = jsonStr.replace(/"((?:[^"\\]|\\.)*)"/g, (m) =>
          m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
        );
        const obj = JSON.parse(sanitized) as AIAction;
        if (obj && obj.type) {
          extracted.push({ action: obj, start, end: end + 1 });
        }
      } catch (e) {
        console.warn('[AI-EXTRACT] Frontend JSON parse failed:', (e as Error).message?.slice(0, 80));
      }
      searchFrom = end + 1;
    }
  }

  extracted.sort((a, b) => b.start - a.start);
  let cleaned = text;
  for (const e of extracted) {
    cleaned = cleaned.substring(0, e.start) + cleaned.substring(e.end);
  }
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { actions: extracted.map(e => e.action), cleanedText: cleaned };
}

// ── Markdown-enhanced message formatter ────────────────────────

function FormatMessage({ content }: { content: string }) {
  // Strip inline JSON objects using robust brace-depth-aware stripping
  // Safety: if stripping removes everything, keep original
  const stripped = stripActionJSON(content);
  const cleanedContent = stripped.trim() ? stripped : content;
  const lines = cleanedContent.split('\n');
  const elements: ReactNode[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Skip empty lines that resulted from JSON stripping
    if (!trimmed && i > 0 && !lines[i - 1]?.trim()) return;
    // Handle ### and ## headers
    if (trimmed.startsWith('### ')) {
      elements.push(<h4 key={i} className="text-[12.5px] font-bold text-zinc-800 dark:text-zinc-200 mt-2.5 mb-1 first:mt-0">{renderInline(trimmed.slice(4))}</h4>);
    } else if (trimmed.startsWith('## ')) {
      elements.push(<h3 key={i} className="text-[13px] font-bold text-zinc-900 dark:text-white mt-3 mb-1.5 first:mt-0">{renderInline(trimmed.slice(3))}</h3>);
    } else if (/^[•\-\*]\s/.test(trimmed)) {
      const bulletContent = trimmed.replace(/^[•\-\*]\s+/, '');
      elements.push(
        <div key={i} className="flex gap-2 items-start ml-1 my-0.5">
          <span className="text-zinc-400 dark:text-zinc-500 mt-0.5 text-[10px] shrink-0">•</span>
          <span className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 flex-1">{renderInline(bulletContent)}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\.\s/)?.[1] || '';
      const rest = trimmed.replace(/^\d+\.\s+/, '');
      elements.push(
        <div key={i} className="flex gap-2 items-start ml-1 my-0.5">
          <span className="text-zinc-400 dark:text-zinc-500 text-[11px] font-medium mt-[1px] shrink-0 w-4 text-right">{num}.</span>
          <span className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 flex-1">{renderInline(rest)}</span>
        </div>
      );
    } else if (trimmed) {
      elements.push(<p key={i} className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 my-0.5">{renderInline(trimmed)}</p>);
    } else if (i > 0) {
      elements.push(<div key={i} className="h-1.5" />);
    }
  });

  return <div className="space-y-0">{elements}</div>;
}

function renderInline(text: string): ReactNode[] {
  // Handle **bold** and `code`
  return text.split(/(\*\*.*?\*\*|`.*?`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-zinc-900 dark:text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="text-[12px] px-1 py-0.5 bg-zinc-100 dark:bg-white/5 rounded text-zinc-700 dark:text-zinc-300 font-mono">{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Lead Card component ────────────────────────────────────────

function LeadCard({ lead, selected, onToggle, onSave, saved, saving, onSendEmail }: {
  lead: DiscoveredLead;
  selected: boolean;
  onToggle: () => void;
  onSave: () => void;
  saved: boolean;
  saving: boolean;
  onSendEmail?: (lead: DiscoveredLead) => void;
}) {
  const { t } = useTranslation();
  const initials = `${(lead.first_name || '?')[0]}${(lead.last_name || '?')[0]}`.toUpperCase();
  const location = [lead.city, lead.state, lead.country].filter(Boolean).join(', ');
  const phone = lead.phone_numbers?.[0]?.raw_number;

  return (
    <div
      className={`group relative p-3 rounded-xl border transition-all duration-200 cursor-pointer
        ${selected
          ? 'bg-zinc-900/[0.03] dark:bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-white/15'
          : 'bg-white dark:bg-zinc-50 dark:bg-zinc-950 border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-900'
        }`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2 md:gap-3">
        {/* Selection check */}
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all duration-200
          ${selected ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' : 'border-zinc-200 dark:border-zinc-600'}`}>
          {selected && <Check className="w-3 h-3 text-white dark:text-zinc-900" />}
        </div>

        {/* Avatar — hidden on mobile to save space */}
        <div className="hidden md:flex w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 items-center justify-center shrink-0">
          <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">{initials}</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-zinc-900 dark:text-white truncate">{lead.name}</span>
            {lead.linkedin_url && (
              <a href={lead.linkedin_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                className="text-zinc-300 dark:text-zinc-600 hover:text-[#1ED4A7] dark:hover:text-[#1ED4A7] transition-colors shrink-0">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {lead.title && (
            <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{lead.title}</p>
          )}
          <div className="flex items-center gap-2 md:gap-3 mt-1.5 flex-wrap">
            {lead.organization?.name && (
              <span className="flex items-center gap-1 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                <Building2 className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[100px] md:max-w-[120px]">{lead.organization.name}</span>
              </span>
            )}
            {location && (
              <span className="flex items-center gap-1 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[100px] md:max-w-[120px]">{location}</span>
              </span>
            )}
            {lead.email && (
              <span className="hidden md:flex items-center gap-1 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                <Mail className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[140px]">{lead.email}</span>
              </span>
            )}
            {phone && (
              <span className="hidden md:flex items-center gap-1 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                <Phone className="w-3 h-3 shrink-0" />
                <span>{phone}</span>
              </span>
            )}
          </div>
        </div>

        {/* Action buttons — inline on desktop */}
        <div className="hidden md:flex flex-col gap-1 shrink-0">
          {onSendEmail && lead.email && (
            <button
              onClick={(e) => { e.stopPropagation(); onSendEmail(lead); }}
              className="px-2.5 py-1.5 rounded-lg text-[10.5px] font-medium transition-all duration-200 active:scale-95 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 border border-zinc-900 dark:border-white"
            >
              <span className="flex items-center gap-1"><Send className="w-3 h-3" /> {t('aiAssistant.leadCard.email')}</span>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onSave(); }}
            disabled={saved || saving}
            className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-medium transition-all duration-200 active:scale-95
              ${saved
                ? 'bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/10 text-[#1ED4A7] dark:text-[#1ED4A7] border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/20'
                : 'bg-zinc-100 dark:bg-white/[0.05] text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/10 hover:bg-zinc-200 dark:hover:bg-white/10'
              }`}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? (
              <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {t('aiAssistant.leadCard.saved')}</span>
            ) : (
              <span className="flex items-center gap-1"><Bookmark className="w-3 h-3" /> {t('aiAssistant.leadCard.save')}</span>
            )}
          </button>
        </div>
      </div>

      {/* Action buttons — row below on mobile */}
      <div className="flex md:hidden items-center gap-1.5 mt-2 pl-7">
        {lead.email && (
          <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 truncate max-w-[140px]">
            <Mail className="w-2.5 h-2.5 shrink-0" />
            {lead.email}
          </span>
        )}
        <div className="flex-1" />
        {onSendEmail && lead.email && (
          <button
            onClick={(e) => { e.stopPropagation(); onSendEmail(lead); }}
            className="px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-200 active:scale-95 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
          >
            <span className="flex items-center gap-1"><Send className="w-2.5 h-2.5" /> {t('aiAssistant.leadCard.email')}</span>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onSave(); }}
          disabled={saved || saving}
          className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-200 active:scale-95
            ${saved
              ? 'bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/10 text-[#1ED4A7] dark:text-[#1ED4A7]'
              : 'bg-zinc-100 dark:bg-white/[0.05] text-zinc-600 dark:text-zinc-300'
            }`}
        >
          {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : saved ? (
            <span className="flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5" /> {t('aiAssistant.leadCard.saved')}</span>
          ) : (
            <span className="flex items-center gap-1"><Bookmark className="w-2.5 h-2.5" /> {t('aiAssistant.leadCard.save')}</span>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Lead results toolbar ───────────────────────────────────────

function LeadResultsToolbar({ leads, selectedIds, onSelectAll, onSaveSelected, saving, savedIds }: {
  leads: DiscoveredLead[];
  selectedIds: Set<string>;
  onSelectAll: () => void;
  onSaveSelected: () => void;
  saving: boolean;
  savedIds: Set<string>;
}) {
  const { t } = useTranslation();
  const unsavedLeads = leads.filter(l => !savedIds.has(l.id));
  const allSelected = selectedIds.size === unsavedLeads.length && unsavedLeads.length > 0;
  const someSelected = selectedIds.size > 0;
  const withEmail = leads.filter(l => l.email).length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
      <span className="text-[11px] md:text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
        <span className="text-zinc-900 dark:text-white font-semibold">{leads.length}</span> {t('aiAssistant.toolbar.found')}
        <span className="text-zinc-300 dark:text-zinc-600 mx-1">·</span>
        <span className="text-zinc-900 dark:text-white font-semibold">{withEmail}</span> {t('aiAssistant.toolbar.withEmail')}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onSelectAll}
          className="px-2 md:px-2.5 py-1 rounded-lg text-[10px] md:text-[10.5px] font-medium bg-zinc-50 dark:bg-zinc-100 dark:bg-zinc-900 border border-zinc-150 dark:border-white/[0.07] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.07] transition-colors"
        >
          {allSelected ? t('aiAssistant.toolbar.deselectAll') : t('aiAssistant.toolbar.selectAll')}
        </button>
        {someSelected && (
          <button
            onClick={onSaveSelected}
            disabled={saving}
            className="px-2.5 md:px-3 py-1 rounded-lg text-[10px] md:text-[10.5px] font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-1 md:gap-1.5"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3" />}
            {t('aiAssistant.toolbar.saveCount', { count: selectedIds.size })}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Action button ──────────────────────────────────────────────

function ActionButton({ action, onExecute }: { action: AIAction; onExecute: (a: AIAction) => void }) {
  const { t } = useTranslation();
  if (action.type === 'find_leads' || action.type === 'launch_campaign') return null; // Handled via cards
  const icons: Record<string, typeof ArrowRight> = { navigate: Navigation, open_campaign_builder: Mail, search_leads: Search, draft_email: Copy };
  const Icon = icons[action.type] || ArrowRight;
  const labels: Record<string, string> = {
    navigate: `${t('aiAssistant.actions.goTo')} ${action.view || 'Dashboard'}`, open_campaign_builder: t('aiAssistant.actions.createCampaign'),
    search_leads: `${t('aiAssistant.actions.searchLabel')} ${action.query || 'leads'}`, draft_email: t('aiAssistant.actions.copyDraft'),
  };
  return (
    <button onClick={() => onExecute(action)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-medium rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white border border-zinc-200 dark:border-white/10 transition-all duration-200 active:scale-[0.97]">
      <Icon className="w-3 h-3" />{action.label || labels[action.type] || t('aiAssistant.actions.execute')}
    </button>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return 'aiAssistant.greeting.morning';
  if (h < 18) return 'aiAssistant.greeting.afternoon';
  return 'aiAssistant.greeting.evening';
}

// ── Inline Editable Field ───────────────────────────────────────

function EditableField({ label, value, onCommit, placeholder, singleLine, multiLine, maxPreviewLines }: {
  label: string; value: string; onCommit: (v: string) => void;
  placeholder?: string; singleLine?: boolean; multiLine?: boolean; maxPreviewLines?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  useEffect(() => { if (!editing) setVal(value); }, [value, editing]);

  const commit = () => { onCommit(val); setEditing(false); };

  if (editing) {
    return (
      <div>
        <label className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">{label}</label>
        {multiLine ? (
          <textarea
            autoFocus value={val} onChange={e => setVal(e.target.value)}
            onBlur={commit} rows={4} placeholder={placeholder}
            className="w-full text-[12px] text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-white/[0.05] border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-2 mt-1 resize-none focus:ring-0 no-focus-ring"
          />
        ) : (
          <input
            autoFocus value={val} onChange={e => setVal(e.target.value)}
            onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} placeholder={placeholder}
            className="w-full text-[12.5px] text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-white/[0.05] border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 mt-1 focus:ring-0 no-focus-ring"
          />
        )}
      </div>
    );
  }

  return (
    <div className="group/ef cursor-pointer" onClick={() => setEditing(true)}>
      <label className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1">
        {label}
        <Pencil className="w-2.5 h-2.5 text-zinc-300 dark:text-zinc-600 opacity-0 group-hover/ef:opacity-100 transition-opacity" />
      </label>
      <p className={`text-[12.5px] mt-0.5 whitespace-pre-wrap leading-relaxed ${multiLine ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-700 dark:text-zinc-200'}`} style={multiLine ? { display: '-webkit-box', WebkitLineClamp: maxPreviewLines || 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>
        {value || <span className="text-zinc-300 dark:text-zinc-600 italic">{placeholder}</span>}
      </p>
    </div>
  );
}

// ── Campaign Preview Card ──────────────────────────────────────

const TONE_OPTIONS = ['casual', 'professional', 'friendly', 'formal', 'enthusiastic'] as const;

const PLATFORM_BRANDS = [
  { value: 'contndr', label: 'Contndr' },
  { value: 'roadr', label: 'Roadr' },
  { value: 'sourcr', label: 'Sourcr' },
  { value: 'covera', label: 'Covera' },
  { value: 'custom', label: 'Custom' },
] as const;

const PRODUCT_OPTIONS = [
  { value: 'custom', label: 'Custom Campaign', brand: 'custom', restricted: false },
  { value: 'contndr_outreach', label: 'Contndr Outreach', brand: 'contndr', restricted: true },
  { value: 'roadr_provider', label: 'Roadr - Provider Subscription', brand: 'roadr', restricted: true },
  { value: 'roadr_investor', label: 'Roadr - Investor Outreach', brand: 'roadr', restricted: true },
  { value: 'sourcr_web', label: 'Sourcr - Premium Website', brand: 'sourcr', restricted: true },
  { value: 'sourcr_investor', label: 'Sourcr - Investor Outreach', brand: 'sourcr', restricted: true },
  { value: 'covera_core', label: 'Covera - Core Platform', brand: 'covera', restricted: true },
  { value: 'covera_investor', label: 'Covera - Investor Outreach', brand: 'covera', restricted: true },
] as const;

function CampaignPreviewCard({ draft, state, onEdit, onLaunch, onRefreshAudience, userSettings, onNavigateToSignature }: {
  draft: CampaignDraft;
  state?: 'preview' | 'sending' | 'sent' | 'error';
  onEdit: (field: string, value: string) => void;
  onLaunch: () => void;
  onRefreshAudience?: (audienceType: string, groupId?: string) => void;
  userSettings?: UserCampaignSettings;
  onNavigateToSignature?: () => void;
}) {
  const { t } = useTranslation();
  const [expandBody, setExpandBody] = useState(false);
  const [expandDetails, setExpandDetails] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [showTestEmail, setShowTestEmail] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState(userSettings?.userEmail || '');
  const [sendingTest, setSendingTest] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [showAudiencePicker, setShowAudiencePicker] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const prevLeadCountRef = useRef(draft.leadCount);

  // Auto-open audience picker if no audience is resolved on mount
  const hasAutoOpened = useRef(false);
  useEffect(() => {
    if (!hasAutoOpened.current && draft.leadCount === 0 && state === 'preview') {
      setShowAudiencePicker(true);
      hasAutoOpened.current = true;
    }
  }, [draft.leadCount, state]);

  useEffect(() => {
    if (audienceLoading && draft.leadCount !== prevLeadCountRef.current && draft.leadCount > 0) {
      setAudienceLoading(false);
      setShowAudiencePicker(false);
    }
    prevLeadCountRef.current = draft.leadCount;
  }, [draft.leadCount, audienceLoading]);

  const isAdmin = userSettings?.isAdmin || false;
  const senderName = draft.senderName || userSettings?.signatureName || '';
  const fromEmail = draft.fromEmail || userSettings?.fromEmail || userSettings?.signatureEmail || '';
  const followUpEnabled = draft.followUpEnabled !== false;
  const followUpDays = draft.followUpDays || 3;
  const maxFollowUps = draft.maxFollowUps || 2;
  const groups = userSettings?.groups || [];

  const audienceReady = draft.leadCount > 0;
  const emailReady = !!(draft.subject && draft.body);
  // Non-admin users must have Gmail, Outlook, or SMTP connected — 'resend' is the unconfigured default
  const emailProviderConnected = isAdmin || (
    userSettings?.emailProvider !== 'resend' && !!userSettings?.connectedEmail
  );
  const canLaunch = audienceReady && emailReady && emailProviderConnected && state !== 'sending';

  const audienceLabel = draft.audienceType === 'group' && draft.groupName
    ? draft.groupName
    : draft.audienceType === 'all'
      ? t('aiAssistant.campaign.allCrmLeads')
      : draft.leadFilter || t('aiAssistant.campaign.noAudience');

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditVal(currentValue);
  };

  const commitEdit = () => {
    if (editingField) {
      onEdit(editingField, editVal);
      setEditingField(null);
    }
  };

  const handleSelectGroup = (groupId: string, groupName: string) => {
    setAudienceLoading(true);
    prevLeadCountRef.current = draft.leadCount;
    onEdit('audienceType', 'group');
    onEdit('groupId', groupId);
    onEdit('groupName', groupName);
    onEdit('leadCount', '0');
    onRefreshAudience?.('group', groupId);
    setTimeout(() => setAudienceLoading(false), 8000);
  };

  const handleSelectAll = () => {
    setAudienceLoading(true);
    prevLeadCountRef.current = draft.leadCount;
    onEdit('audienceType', 'all');
    onEdit('groupId', '');
    onEdit('groupName', '');
    onEdit('leadCount', '0');
    onRefreshAudience?.('all');
    setTimeout(() => setAudienceLoading(false), 8000);
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddress || sendingTest) return;
    setSendingTest(true);
    setTestSent(false);
    try {
      const headers = await getAuthHeaders();
      const testLead = { business_name: 'Test Business', category: 'Technology', city: 'New York', email: testEmailAddress };
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/send-test`,
        { method: 'POST', headers, body: JSON.stringify({ to_email: testEmailAddress, to_name: 'Test Recipient', subject: draft.subject || 'Test Subject', text_body: draft.body || 'Test body', from_email: fromEmail, from_name: senderName, brand: draft.brand || userSettings?.brand || 'custom', lead: testLead }) }
      );
      if (!response.ok) { const text = await response.text(); throw new Error(text.substring(0, 200)); }
      setTestSent(true);
      setTimeout(() => setTestSent(false), 5000);
    } catch (err: any) {
      console.error('[AI-CAMPAIGN] Test email failed:', err);
      toast.error(`Test email failed: ${err.message}`);
    } finally { setSendingTest(false); }
  };

  // Truncate body for preview
  const bodyLines = (draft.body || '').split('\n');
  const bodyPreview = bodyLines.length > 4 && !expandBody ? bodyLines.slice(0, 4).join('\n') + '...' : draft.body;

  // ═══ SENT STATE ═══
  if (state === 'sent') {
    return (
      <div className="rounded-xl border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/20 bg-[#1ED4A7]/[0.03] dark:bg-[#1ED4A7]/[0.03] overflow-hidden" style={{ animation: 'aiMsgIn .25s ease-out' }}>
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          <div className="w-8 h-8 rounded-lg bg-[#1ED4A7] flex items-center justify-center shrink-0">
            <CheckCircle className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-semibold text-[#1ED4A7] dark:text-[#1ED4A7]/80">{t('aiAssistant.campaign.launched', { name: draft.name || 'Campaign' })}</p>
            <p className="text-[11px] text-[#1ED4A7]/70 dark:text-[#1ED4A7]/60 mt-0.5">
              {draft.leadCount > 0 ? `${draft.leadCount.toLocaleString()} leads` : 'Leads'} · {t('aiAssistant.campaign.checkOverlay')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 overflow-hidden" style={{ animation: 'aiMsgIn .25s ease-out' }}>
      {/* ── Header: name + audience pill ── */}
      <div className="px-4 py-3 bg-zinc-50/80 dark:bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center shrink-0">
            <Rocket className="w-3.5 h-3.5 text-white dark:text-zinc-900" />
          </div>
          <div className="flex-1 min-w-0">
            {editingField === 'name' ? (
              <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
                onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()}
                className="w-full text-[12.5px] font-semibold text-zinc-900 dark:text-white bg-transparent outline-none border-b border-zinc-300 dark:border-white/20 pb-0.5" />
            ) : (
              <p className="text-[12.5px] font-semibold text-zinc-900 dark:text-white truncate cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                onClick={() => startEdit('name', draft.name)}>{draft.name || t('aiAssistant.campaign.untitled')}</p>
            )}
          </div>
          {state === 'sending' && <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />}
        </div>

        {/* Audience pill row */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => setShowAudiencePicker(!showAudiencePicker)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              audienceReady
                ? 'bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/10 text-[#1ED4A7] dark:text-[#1ED4A7] border border-[#1ED4A7]/15 dark:border-[#1ED4A7]/15'
                : 'bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/15'
            }`}
          >
            {audienceLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : audienceReady ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <Users className="w-3 h-3" />
            )}
            {audienceLoading ? t('aiAssistant.campaign.loading') : audienceReady ? `${draft.leadCount.toLocaleString()} leads` : draft.leadFilter ? t('aiAssistant.campaign.pickGroup') : t('aiAssistant.campaign.selectAudience')}
            <ChevronDown className="w-2.5 h-2.5 opacity-50" />
          </button>
          {audienceReady ? (
            <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500 truncate">{audienceLabel}</span>
          ) : draft.leadFilter ? (
            <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500 truncate italic">for "{draft.leadFilter}"</span>
          ) : null}
        </div>
      </div>

      {/* ── Audience Picker (inline dropdown) ── */}
      {showAudiencePicker && (
        <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-white/[0.01]" style={{ animation: 'aiContentUp .15s ease-out' }}>
          {/* AI suggestion hint */}
          {draft.leadFilter && !audienceReady && (
            <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
              <Target className="w-3 h-3 text-zinc-400 shrink-0" />
              {t('aiAssistant.campaign.aiSuggested')} <span className="font-medium text-zinc-700 dark:text-zinc-200">"{draft.leadFilter}"</span>
              <span className="text-zinc-400">{t('aiAssistant.campaign.pickMatchingGroup')}</span>
            </p>
          )}
          <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">{t('aiAssistant.campaign.chooseAudience')}</p>
          <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
            {groups.map(g => {
              const count = g.lead_count?.[0]?.count || 0;
              const selected = draft.groupId === g.id;
              // Highlight groups that partially match the AI's lead filter suggestion
              const filterLower = (draft.leadFilter || '').toLowerCase();
              const nameLower = g.name.toLowerCase();
              const isSuggested = !audienceReady && filterLower && (
                nameLower.includes(filterLower) || filterLower.includes(nameLower) ||
                filterLower.split(/\s+/).some(w => w.length > 2 && nameLower.includes(w))
              );
              return (
                <button key={g.id} onClick={() => handleSelectGroup(g.id, g.name)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                    selected
                      ? 'bg-zinc-900/5 dark:bg-zinc-100 dark:bg-zinc-900 ring-1 ring-zinc-300 dark:ring-white/10'
                      : isSuggested
                        ? 'bg-[#1ED4A7]/[0.04] dark:bg-[#1ED4A7]/[0.06] ring-1 ring-[#1ED4A7]/15 dark:ring-[#1ED4A7]/15 hover:bg-[#1ED4A7]/[0.06] dark:hover:bg-[#1ED4A7]/[0.08]'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-100 dark:bg-zinc-900'
                  }`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color || '#a1a1aa' }} />
                  <span className={`text-[11.5px] flex-1 truncate ${selected ? 'font-semibold text-zinc-900 dark:text-white' : isSuggested ? 'font-medium text-[#1ED4A7] dark:text-[#1ED4A7]/80' : 'text-zinc-600 dark:text-zinc-300'}`}>{g.name}</span>
                  {isSuggested && !selected && <span className="text-[9px] font-medium text-[#1ED4A7] shrink-0">{t('aiAssistant.campaign.suggested')}</span>}
                  <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500 tabular-nums">{count}</span>
                  {selected && <Check className="w-3 h-3 text-[#1ED4A7] shrink-0" />}
                </button>
              );
            })}
            {groups.length === 0 && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 text-center py-2">{t('aiAssistant.campaign.noCrmGroups')}</p>
            )}
          </div>
          <button onClick={handleSelectAll}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all mt-1 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 pt-2 ${
              draft.audienceType === 'all' && !draft.groupId ? 'bg-zinc-900/5 dark:bg-zinc-100 dark:bg-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-100 dark:bg-zinc-900'
            }`}>
            <Users className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
            <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 flex-1">{t('aiAssistant.campaign.allCrmLeads')}</span>
            {draft.audienceType === 'all' && !draft.groupId && <Check className="w-3 h-3 text-[#1ED4A7] shrink-0" />}
          </button>
        </div>
      )}

      {/* ── Email Preview ── */}
      <div className="px-4 py-3 space-y-2">
        {/* Subject */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">{t('aiAssistant.campaign.subject')}</span>
            {editingField !== 'subject' && (
              <button onClick={() => startEdit('subject', draft.subject)} className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                <Pencil className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
          {editingField === 'subject' ? (
            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
              onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()}
              className="w-full text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100 bg-white dark:bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors" />
          ) : (
            <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100 cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              onClick={() => startEdit('subject', draft.subject)}>{draft.subject || <span className="text-zinc-300 dark:text-zinc-600 italic">{t('aiAssistant.campaign.noSubject')}</span>}</p>
          )}
        </div>

        {/* Body */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">{t('aiAssistant.campaign.body')}</span>
            {editingField !== 'body' && (
              <button onClick={() => startEdit('body', draft.body)} className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                <Pencil className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
          {editingField === 'body' ? (
            <div>
              <textarea autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
                rows={8}
                className="w-full text-[12px] text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-2 outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors resize-none leading-relaxed" />
              <div className="flex justify-end gap-1.5 mt-1">
                <button onClick={() => setEditingField(null)} className="text-[10.5px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-2 py-0.5 transition-colors">{t('aiAssistant.campaign.cancel')}</button>
                <button onClick={commitEdit} className="text-[10.5px] font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-white/[0.08] hover:bg-zinc-200 dark:hover:bg-white/[0.12] px-2.5 py-0.5 rounded transition-colors">{t('aiAssistant.campaign.save')}</button>
              </div>
            </div>
          ) : (
            <div className="cursor-pointer" onClick={() => startEdit('body', draft.body)}>
              <pre className="text-[11.5px] text-zinc-600 dark:text-zinc-300 font-sans whitespace-pre-wrap leading-relaxed hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors">
                {bodyPreview || <span className="text-zinc-300 dark:text-zinc-600 italic">{t('aiAssistant.campaign.noBody')}</span>}
              </pre>
              {bodyLines.length > 4 && (
                <button onClick={(e) => { e.stopPropagation(); setExpandBody(!expandBody); }}
                  className="text-[10.5px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 mt-0.5 transition-colors">
                  {expandBody ? t('aiAssistant.campaign.showLess') : t('aiAssistant.campaign.showAllLines', { count: bodyLines.length })}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Signature - subtle inline */}
        {userSettings?.hasSignature && userSettings.signatureText ? (
          <div className="pt-1.5 border-t border-dashed border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
            <pre className="text-[10.5px] text-zinc-400 dark:text-zinc-500 font-sans whitespace-pre-line leading-relaxed">{userSettings.signatureText}</pre>
          </div>
        ) : userSettings?.loaded && !userSettings?.hasSignature ? (
          <button onClick={() => onNavigateToSignature?.()}
            className="text-[10.5px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex items-center gap-1 pt-1">
            <PenLine className="w-2.5 h-2.5" /> {t('aiAssistant.campaign.addSignature')}
          </button>
        ) : null}
      </div>

      {/* ── Details & Actions ── */}
      <div className="px-4 pb-3 space-y-2">
        {/* Inline details row */}
        <div className="flex items-center gap-3 text-[10.5px] text-zinc-400 dark:text-zinc-500">
          {senderName && <span>{t('aiAssistant.campaign.from')} <span className="text-zinc-600 dark:text-zinc-300">{senderName}</span></span>}
          {draft.tone && <span className="capitalize">{draft.tone}</span>}
          {followUpEnabled && <span className="flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" /> {t('aiAssistant.campaign.followUpLabel', { count: maxFollowUps })}</span>}
        </div>

        {/* Expandable details */}
        <button onClick={() => setExpandDetails(!expandDetails)}
          className="flex items-center gap-1 text-[10.5px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
          <Settings2 className="w-3 h-3" /> {expandDetails ? t('aiAssistant.campaign.hideDetails') : t('aiAssistant.campaign.editDetails')} {t('aiAssistant.campaign.details')}
          {expandDetails ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
        </button>

        {expandDetails && (
          <div className="space-y-2 pt-1.5 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800" style={{ animation: 'aiContentUp .15s ease-out' }}>
            <div className="grid grid-cols-2 gap-2">
              <EditableField label={t('aiAssistant.campaign.senderName')} value={senderName} onCommit={v => onEdit('senderName', v)} placeholder="Your name..." singleLine />
              <EditableField label={t('aiAssistant.campaign.fromEmail')} value={fromEmail} onCommit={v => onEdit('fromEmail', v)} placeholder="you@company.com" singleLine />
            </div>
            <EditableField label={t('aiAssistant.campaign.campaignKnowledge')} value={draft.campaignKnowledge || ''} onCommit={v => onEdit('campaignKnowledge', v)}
              placeholder={t('aiAssistant.campaign.customContext')} multiLine maxPreviewLines={2} />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> {t('aiAssistant.campaign.followUps')} {followUpEnabled ? t('aiAssistant.campaign.followUpConfig', { count: maxFollowUps, days: followUpDays }) : t('aiAssistant.campaign.off')}
              </span>
              <div className={`relative rounded-full transition-colors cursor-pointer shrink-0 ${followUpEnabled ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-white/15'}`}
                style={{ width: 32, height: 18 }}
                onClick={() => onEdit('followUpEnabled', followUpEnabled ? 'false' : 'true')}>
                <div className={`absolute top-[2px] w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform ${followUpEnabled ? 'translate-x-[15px]' : 'translate-x-[2px]'}`} />
              </div>
            </div>
            {/* Test email */}
            <div className="space-y-1.5">
              <button onClick={() => setShowTestEmail(!showTestEmail)}
                className="flex items-center gap-1 text-[10.5px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                <Mail className="w-2.5 h-2.5" /> {t('aiAssistant.campaign.sendTestEmail')}
              </button>
              {showTestEmail && (
                <div className="flex items-center gap-1.5">
                  <input type="email" value={testEmailAddress} onChange={e => setTestEmailAddress(e.target.value)} placeholder="your@email.com"
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-white/[0.05] border border-zinc-200 dark:border-white/10 rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors" />
                  <button onClick={handleSendTestEmail} disabled={sendingTest || !testEmailAddress || !draft.subject}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap bg-zinc-100 dark:bg-white/[0.08] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed">
                    {sendingTest ? <Loader2 className="w-3 h-3 animate-spin" /> : testSent ? <CheckCircle className="w-3 h-3 text-[#1ED4A7]" /> : <Send className="w-3 h-3" />}
                    {sendingTest ? '...' : testSent ? t('aiAssistant.campaign.testSent') : t('aiAssistant.campaign.send')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-500/5 dark:bg-zinc-500/5 border border-zinc-500/10 dark:border-zinc-500/10">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('aiAssistant.campaign.launchFailed')}</span>
          </div>
        )}

        {/* Email provider not connected warning */}
        {!emailProviderConnected && userSettings?.loaded && (
          <div className="px-3 py-2.5 rounded-xl bg-zinc-100/80 dark:bg-zinc-800/30 border border-zinc-200/80 dark:border-zinc-700/30">
            <p className="text-[11.5px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <strong>{t('aiAssistant.campaign.connectEmailToSend')}</strong>{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'settings' }));
                  window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'email' }));
                }}
                className="font-medium underline hover:no-underline"
              >
                {t('aiAssistant.campaign.settingsEmailConfig')}
              </a>{' '}
              {t('aiAssistant.campaign.connectProviders')}
            </p>
          </div>
        )}

        {/* ── Launch Button ── */}
        <button
          onClick={onLaunch}
          disabled={!canLaunch}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12.5px] font-bold
            bg-zinc-900 dark:bg-white text-white dark:text-zinc-900
            hover:bg-zinc-800 dark:hover:bg-zinc-200
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all duration-200 active:scale-[0.98] shadow-sm"
        >
          {state === 'sending' ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('aiAssistant.campaign.launching')}</>
          ) : state === 'error' ? (
            <><Send className="w-3.5 h-3.5" /> {t('aiAssistant.campaign.retryLaunch')}</>
          ) : !emailProviderConnected ? (
            <><Mail className="w-3.5 h-3.5" /> {t('aiAssistant.campaign.connectToLaunch')}</>
          ) : !audienceReady ? (
            <><Users className="w-3.5 h-3.5" /> {t('aiAssistant.campaign.selectAudienceToLaunch')}</>
          ) : (
            <><Rocket className="w-3.5 h-3.5" /> {t('aiAssistant.campaign.launchToLeads', { count: draft.leadCount.toLocaleString() })}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────

export function AIAssistant({ onNavigate, onOpenCampaignBuilder, userName, externalOpen, onExternalClose, initialQuery }: AIAssistantProps) {
  const isDemoMode = useDemoMode();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set());
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(new Set());
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);

  // ── User campaign settings (fetched once on open) ──
  const [userSettings, setUserSettings] = useState<UserCampaignSettings>({
    signatureName: '', signatureTitle: '', signatureEmail: '', signatureWebsite: '',
    signaturePhone: '', signatureClosingLine: '', signatureCustomHtml: '', signatureText: '', hasSignature: false,
    brand: 'custom', fromEmail: '', emailProvider: 'resend', connectedEmail: '',
    knowledgeBrands: [], groups: [], isAdmin: false, userEmail: '', loaded: false,
  });

  // ── Session state ──
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const broadcast = useBroadcast();
  const firstName = (userName || '').split(' ')[0];
  const { keyboardHeight, isKeyboardOpen } = useVisualViewport();
  const { t } = useTranslation();
  const greetingKey = getGreetingKey();

  // ── Auto-resize textarea ──
  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, []);

  useLayoutEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  // Sync external open trigger from parent (sidebar search bar)
  useEffect(() => {
    if (externalOpen && !isOpen) {
      if (initialQuery && initialQuery.trim()) {
        setPendingQuery(initialQuery);
      }
      setIsOpen(true);
    }
  }, [externalOpen]);

  // Scroll to bottom on new messages or keyboard state change
  useEffect(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [messages, isLoading]);

  // Scroll to bottom when keyboard opens/closes so input stays visible
  useEffect(() => {
    if (isOpen && hasInteracted) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
    }
  }, [isKeyboardOpen]);

  // Focus input when opened + fetch user settings
  useEffect(() => {
    if (isOpen) {
      // Reset stuck loading state when panel opens — prevents permanently disabled send button
      // (state persists across open/close since component doesn't unmount)
      if (isLoading) {
        console.warn('[AI-ASSISTANT] Resetting stuck isLoading state on panel open');
        setIsLoading(false);
      }
      setTimeout(() => inputRef.current?.focus(), 180);
      // Send pending query if opened with one (from the search bar)
      if (pendingQuery && pendingQuery.trim()) {
        const q = pendingQuery;
        setPendingQuery(null);
        // Delay to let the panel render + settings load
        setTimeout(() => sendMessage(q), 300);
      }
      // Fetch user settings for campaign card (once)
      if (!userSettings.loaded) {
        if (isDemoMode) {
          // Set demo user settings
          setUserSettings({
            signatureName: 'Demo User',
            signatureTitle: 'Sales Director',
            signatureEmail: 'demo@contndr.com',
            signatureWebsite: 'contndr.com',
            signaturePhone: '+1-555-0123',
            signatureClosingLine: 'Best regards',
            signatureCustomHtml: '',
            signatureText: 'Best regards,\nDemo User | Sales Director\nE: demo@contndr.com\nP: +1-555-0123\nW: contndr.com',
            hasSignature: true,
            brand: 'custom',
            fromEmail: 'demo@contndr.com',
            emailProvider: 'resend',
            connectedEmail: 'demo@contndr.com',
            knowledgeBrands: ['Contndr', 'TechCorp', 'InnovatePlus'],
            groups: [],
            isAdmin: false,
            userEmail: 'demo@contndr.com',
            loaded: true,
          });
        } else {
          (async () => {
            try {
              const headers = await getAuthHeaders();
              if (!headers.Authorization) {
                console.debug('[AIAssistant] No auth token yet, skipping settings fetch');
                return;
              }
              // Get user session for admin check + brand from metadata
              const { data: { session } } = await supabase.auth.getSession();
            const email = session?.user?.email?.toLowerCase() || '';
            const isAdmin = email === 'or@roadr.com' || email === 'admin@contndr.com';
            const savedBrand = session?.user?.user_metadata?.brand || 'custom';

            const [sigRes, settingsRes, groupsRes] = await Promise.all([
              fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/settings/signature`, { headers }),
              fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/settings/user-settings`, { headers }),
              fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups`, { headers }),
            ]);
            const sig = sigRes.ok ? (await sigRes.json()).signature : null;
            const settings = settingsRes.ok ? (await settingsRes.json()).settings : null;
            const groupsData = groupsRes.ok ? (await groupsRes.json()).groups || [] : [];

            // Build signature preview text (matching CampaignBuilder logic)
            let sigText = '';
            let hasSig = false;
            if (sig) {
              const hasAnyField = !!(sig.custom_html || sig.full_name || sig.closing_line || sig.email || sig.phone || sig.website || sig.title);
              hasSig = hasAnyField;
              if (hasAnyField) {
                if (sig.custom_html) {
                  sigText = sig.custom_html;
                } else {
                  const lines: string[] = [];
                  if (sig.closing_line) lines.push(`${sig.closing_line},`);
                  if (sig.full_name) {
                    let nameLine = sig.full_name;
                    if (sig.title) nameLine += ` | ${sig.title}`;
                    lines.push(nameLine);
                  }
                  if (sig.email) lines.push(`E: ${sig.email}`);
                  if (sig.phone) lines.push(`P: ${sig.phone}`);
                  if (sig.website) {
                    const clean = sig.website.replace(/^https?:\/\//, '');
                    lines.push(`W: ${clean}`);
                  }
                  sigText = lines.join('\n');
                }
              }
            }

            const provider = settings?.provider || 'resend';
            const connEmail = settings?.connected_email || '';
            setUserSettings({
              signatureName: sig?.full_name || sig?.name || '',
              signatureTitle: sig?.title || '',
              signatureEmail: sig?.email || '',
              signatureWebsite: sig?.website || '',
              signaturePhone: sig?.phone || '',
              signatureClosingLine: sig?.closing_line || '',
              signatureCustomHtml: sig?.custom_html || '',
              signatureText: sigText,
              hasSignature: hasSig,
              brand: isAdmin ? (savedBrand !== 'custom' ? savedBrand : 'contndr') : savedBrand,
              fromEmail: connEmail || sig?.email || '',
              emailProvider: provider,
              connectedEmail: connEmail,
              knowledgeBrands: [],
              groups: groupsData,
              isAdmin,
              userEmail: email,
              loaded: true,
            });
            // Also try to get knowledge base brands
            try {
              const kbRes = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/knowledge-base?brand=all`, { headers });
              if (kbRes.ok) {
                const kbData = await kbRes.json();
                const brands = [...new Set((kbData.data || []).map((e: any) => e.brand).filter(Boolean))] as string[];
                setUserSettings(prev => ({ ...prev, knowledgeBrands: brands }));
              }
            } catch {}
          } catch (err) {
            console.warn('[AI] Failed to fetch user settings:', err);
            setUserSettings(prev => ({ ...prev, loaded: true }));
          }
        })();
        }
      }
    }
  }, [isOpen, userSettings.loaded, pendingQuery, isDemoMode]);

  // Safety: auto-reset isLoading if stuck for more than 65 seconds
  useEffect(() => {
    if (!isLoading) return;
    const timeout = setTimeout(() => {
      console.warn('[AI-ASSISTANT] Loading stuck for 65s, force-resetting');
      setIsLoading(false);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'user') {
          return [...prev, { id: `e-${Date.now()}`, role: 'assistant' as const, content: 'The request took too long. Please try again.', timestamp: new Date() }];
        }
        return prev;
      });
    }, 65000);
    return () => clearTimeout(timeout);
  }, [isLoading]);

  // Track scroll
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const onScroll = () => setShowScrollBtn(c.scrollHeight - c.scrollTop - c.clientHeight > 100);
    c.addEventListener('scroll', onScroll);
    return () => c.removeEventListener('scroll', onScroll);
  }, [isOpen, messages.length]);

  // ── Session management functions ──────────────────────────────

  const serializeMessages = useCallback((msgs: Message[]): SerializableMessage[] => {
    return msgs.map(m => ({
      id: m.id, role: m.role, content: m.content,
      leads: m.leads && m.leads.length > 0 ? m.leads : undefined,
      searchState: (m.searchState === 'complete' || m.searchState === 'local-done') ? m.searchState : undefined,
      searchCount: m.searchCount,
      searchParams: m.searchParams,
      actions: m.actions && m.actions.length > 0 ? m.actions : undefined,
      timestamp: m.timestamp.toISOString(),
    }));
  }, []);

  const deserializeMessages = useCallback((msgs: SerializableMessage[]): Message[] => {
    return msgs.map(m => ({
      id: m.id, role: m.role, content: m.content, leads: m.leads,
      searchState: m.searchState, searchCount: m.searchCount,
      searchParams: m.searchParams, actions: m.actions,
      timestamp: new Date(m.timestamp),
    }));
  }, []);

  const saveCurrentSession = useCallback(async (msgs: Message[], sessionId?: string | null) => {
    if (isDemoMode) return; // Skip session saving in demo mode
    const sid = sessionId ?? currentSessionId;
    if (!sid || msgs.length === 0) return;
    try {
      const firstUserMsg = msgs.find(m => m.role === 'user');
      const title = firstUserMsg ? (firstUserMsg.content.length > 50 ? firstUserMsg.content.slice(0, 47) + '...' : firstUserMsg.content) : 'New conversation';
      const lastMsg = msgs[msgs.length - 1];
      const leadCount = msgs.reduce((sum, m) => sum + (m.leads?.length || 0), 0);
      await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-assistant/sessions/${sid}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, messages: serializeMessages(msgs), leadCount, preview: lastMsg?.content?.slice(0, 100) || '' }) }
      );
    } catch (err) { console.error('[AI-SESSION] Save failed:', err); }
  }, [currentSessionId, serializeMessages, isDemoMode]);

  // ── Close with save ──
  const handleClose = useCallback(() => {
    if (messages.length > 0 && currentSessionId) {
      saveCurrentSession(messages, currentSessionId);
    }
    setIsOpen(false);
    onExternalClose?.();
  }, [messages, currentSessionId, saveCurrentSession, onExternalClose]);

  // Keyboard: ⌘J toggle, Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') { e.preventDefault(); setIsOpen(p => !p); }
      if (e.key === 'Escape' && isOpen) handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  // Auto-save: debounce 2s after each message change
  useEffect(() => {
    if (messages.length === 0 || !currentSessionId) return;
    if (messages.some(m => m.searchState === 'searching')) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveCurrentSession(messages, currentSessionId); }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [messages, currentSessionId, saveCurrentSession]);

  // Auto-create session on first user message — include messages so history isn't empty
  const creatingSessionRef = useRef(false);
  useEffect(() => {
    if (isDemoMode) return; // Skip session creation in demo mode
    if (messages.length === 1 && !currentSessionId && !creatingSessionRef.current && messages[0].role === 'user') {
      creatingSessionRef.current = true;
      (async () => {
        try {
          const title = messages[0].content.length > 50 ? messages[0].content.slice(0, 47) + '...' : messages[0].content;
          const res = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-assistant/sessions`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, messages: serializeMessages(messages) }) }
          );
          if (res.ok) {
            const data = await res.json();
            setCurrentSessionId(data.session?.id || null);
          }
        } catch (err) { console.error('[AI-SESSION] Create failed:', err); }
        finally { creatingSessionRef.current = false; }
      })();
    }
  }, [messages, currentSessionId, isDemoMode]);

  const loadSessions = useCallback(async () => {
    if (isDemoMode) {
      setSessions([]);
      return;
    }
    setSessionsLoading(true);
    try {
      const res = await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-assistant/sessions`);
      if (res.ok) { const data = await res.json(); setSessions(data.sessions || []); }
    } catch (err) { console.error('[AI-SESSION] Load list failed:', err); }
    finally { setSessionsLoading(false); }
  }, [isDemoMode]);

  const loadSession = useCallback(async (sessionId: string) => {
    if (isDemoMode) return;
    try {
      const res = await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-assistant/sessions/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        const restored = deserializeMessages(data.session?.messages || []);
        // If session has no messages (e.g. save didn't persist yet), don't enter empty conversation mode
        if (restored.length === 0) {
          console.warn('[AI-SESSION] Session loaded but has no messages');
          toast('This conversation has no saved messages', { description: 'Start a new conversation instead' });
          return;
        }
        setMessages(restored); setCurrentSessionId(sessionId); setHasInteracted(true);
        setShowHistory(false); setSelectedLeadIds(new Set()); setSavedLeadIds(new Set());
      } else {
        console.error('[AI-SESSION] Load returned non-ok status:', res.status);
        toast.error(t('aiAssistant.history.failedToLoad'));
      }
    } catch (err) { console.error('[AI-SESSION] Load failed:', err); toast.error(t('aiAssistant.history.failedToLoad')); }
  }, [deserializeMessages, isDemoMode]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (isDemoMode) return;
    setDeletingSessionId(sessionId);
    try {
      await authenticatedFetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-assistant/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) { setMessages([]); setHasInteracted(false); setCurrentSessionId(null); }
      toast.success(t('aiAssistant.history.deleted'));
    } catch (err) { console.error('[AI-SESSION] Delete failed:', err); toast.error(t('aiAssistant.history.failedToDelete')); }
    finally { setDeletingSessionId(null); }
  }, [currentSessionId]);

  const openHistory = useCallback(() => { loadSessions(); setShowHistory(true); }, [loadSessions]);

  const startNewChat = useCallback(async () => {
    if (messages.length > 0 && currentSessionId) { await saveCurrentSession(messages, currentSessionId); }
    abortRef.current?.abort();
    setMessages([]); setHasInteracted(false); setCurrentSessionId(null);
    setSelectedLeadIds(new Set()); setSavedLeadIds(new Set()); setShowHistory(false);
  }, [messages, currentSessionId, saveCurrentSession]);

  // ── SSE Lead Search ──
  const runLeadSearch = useCallback(async (action: AIAction, messageId: string, dbOnly = true) => {
    console.log('[AI-SEARCH] Starting search:', { messageId, dbOnly, titles: action.person_titles, locations: action.organization_locations });

    // ── Demo mode: return simulated search results ──
    if (isDemoMode) {
      console.log('[AI-SEARCH] Demo mode active — simulating search');
      const maxResults = action.max_results || 25;
      
      setMessages(prev => prev.map(m =>
        m.id === messageId ? {
          ...m,
          searchState: 'searching' as const,
          searchPhase: 'Searching local database...',
        } : m
      ));

      // Simulate search delay with progress updates
      await new Promise(r => setTimeout(r, 800));
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, searchPhase: 'Discovering leads (5 found)' } : m
      ));

      await new Promise(r => setTimeout(r, 600));
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, searchPhase: 'Discovering leads (12 found)' } : m
      ));

      // Generate demo leads based on search criteria
      const demoLeads: DiscoveredLead[] = [
        {
          id: 'demo-ai-1',
          first_name: 'Sarah',
          last_name: 'Chen',
          name: 'Sarah Chen',
          title: action.person_titles?.[0] || 'VP of Marketing',
          email: 'sarah.chen@techcorp.com',
          email_status: 'verified',
          linkedin_url: 'https://linkedin.com/in/sarahchen',
          phone_numbers: [{ raw_number: '+1-415-555-0123', type: 'mobile' }],
          city: action.organization_locations?.[0]?.split(',')[0]?.trim() || 'San Francisco',
          state: 'CA',
          country: 'USA',
          seniority: 'VP',
          organization: {
            name: 'TechCorp Innovation',
            website_url: 'https://techcorp.com',
            industry: action.organization_industries?.[0] || 'Technology',
            estimated_num_employees: 250,
          },
        },
        {
          id: 'demo-ai-2',
          first_name: 'Michael',
          last_name: 'Rodriguez',
          name: 'Michael Rodriguez',
          title: action.person_titles?.[0] || 'Director of Sales',
          email: 'michael.r@growthventures.io',
          email_status: 'verified',
          linkedin_url: 'https://linkedin.com/in/mrodriguez',
          phone_numbers: [{ raw_number: '+1-512-555-0198', type: 'work' }],
          city: action.organization_locations?.[0]?.split(',')[0]?.trim() || 'Austin',
          state: 'TX',
          country: 'USA',
          seniority: 'Director',
          organization: {
            name: 'Growth Ventures',
            website_url: 'https://growthventures.io',
            industry: action.organization_industries?.[0] || 'SaaS',
            estimated_num_employees: 180,
          },
        },
        {
          id: 'demo-ai-3',
          first_name: 'Emily',
          last_name: 'Thompson',
          name: 'Emily Thompson',
          title: action.person_titles?.[0] || 'CMO',
          email: 'emily.thompson@innovateplus.com',
          email_status: 'valid',
          linkedin_url: 'https://linkedin.com/in/emilythompson',
          phone_numbers: [],
          city: action.organization_locations?.[0]?.split(',')[0]?.trim() || 'New York',
          state: 'NY',
          country: 'USA',
          seniority: 'C-Level',
          organization: {
            name: 'InnovatePlus',
            website_url: 'https://innovateplus.com',
            industry: action.organization_industries?.[0] || 'Marketing Technology',
            estimated_num_employees: 450,
          },
        },
        {
          id: 'demo-ai-4',
          first_name: 'David',
          last_name: 'Kim',
          name: 'David Kim',
          title: action.person_titles?.[0] || 'Head of Business Development',
          email: 'd.kim@nexuspartners.com',
          email_status: 'verified',
          linkedin_url: 'https://linkedin.com/in/davidkim',
          phone_numbers: [{ raw_number: '+1-206-555-0234', type: 'mobile' }],
          city: action.organization_locations?.[0]?.split(',')[0]?.trim() || 'Seattle',
          state: 'WA',
          country: 'USA',
          seniority: 'VP',
          organization: {
            name: 'Nexus Partners',
            website_url: 'https://nexuspartners.com',
            industry: action.organization_industries?.[0] || 'Consulting',
            estimated_num_employees: 320,
          },
        },
        {
          id: 'demo-ai-5',
          first_name: 'Jennifer',
          last_name: 'Martinez',
          name: 'Jennifer Martinez',
          title: action.person_titles?.[0] || 'VP of Customer Success',
          email: 'jennifer.martinez@cloudscale.io',
          email_status: 'verified',
          linkedin_url: 'https://linkedin.com/in/jennifermartinez',
          phone_numbers: [{ raw_number: '+1-720-555-0345', type: 'work' }],
          city: action.organization_locations?.[0]?.split(',')[0]?.trim() || 'Denver',
          state: 'CO',
          country: 'USA',
          seniority: 'VP',
          organization: {
            name: 'CloudScale',
            website_url: 'https://cloudscale.io',
            industry: action.organization_industries?.[0] || 'Cloud Infrastructure',
            estimated_num_employees: 280,
          },
        },
      ].slice(0, Math.min(maxResults, 5));

      await new Promise(r => setTimeout(r, 400));
      
      const finalState: 'complete' | 'local-done' = dbOnly && demoLeads.length < maxResults ? 'local-done' : 'complete';
      
      setMessages(prev => prev.map(m =>
        m.id === messageId ? {
          ...m,
          searchState: finalState,
          searchPhase: finalState === 'local-done' ? 'Local search complete' : 'Search complete',
          leads: demoLeads,
          searchCount: demoLeads.length,
        } : m
      ));
      
      console.log(`[AI-SEARCH] Demo mode completed with ${demoLeads.length} leads`);
      return;
    }

    let headers: Record<string, string>;
    try {
      headers = await getAuthHeaders();
      console.log('[AI-SEARCH] Auth headers obtained, has token:', !!headers.Authorization);
      if (!headers.Authorization) {
        console.warn('[AI-SEARCH] No auth token — aborting search to avoid unauthenticated backend call');
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, searchState: 'error' as const, searchPhase: 'Not signed in — please log in to search' } : m
        ));
        return;
      }
    } catch (authErr) {
      console.error('[AI-SEARCH] Failed to get auth headers:', authErr);
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, searchState: 'error' as const, searchPhase: 'Authentication error — try again' } : m
      ));
      return;
    }

    // Abort any previous search
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const currentController = abortRef.current;

    const maxResults = action.max_results || 25;

    // Update phase text based on mode
    setMessages(prev => prev.map(m =>
      m.id === messageId ? {
        ...m,
        searchState: 'searching' as const,
        searchPhase: dbOnly ? 'Searching local database...' : 'Expanding to external sources...',
      } : m
    ));

    // Safety timeout — if search hangs for 45s, transition to error
    const timeoutId = setTimeout(() => {
      console.warn('[AI-SEARCH] Search timed out after 45s, aborting');
      currentController.abort();
      setMessages(prev => prev.map(m =>
        m.id === messageId && m.searchState === 'searching'
          ? { ...m, searchState: 'error' as const, searchPhase: 'Search timed out — try again' }
          : m
      ));
    }, 45_000);

    // Slow-search indicator — after 12s, show "taking longer than expected"
    const slowTimerId = setTimeout(() => {
      setMessages(prev => prev.map(m =>
        m.id === messageId && m.searchState === 'searching'
          ? { ...m, searchPhase: 'Taking longer than expected — still searching...' }
          : m
      ));
    }, 12_000);

    try {
      const body = {
        person_titles: action.person_titles || [],
        organization_locations: action.organization_locations || [],
        organization_industries: action.organization_industries || [],
        q_keywords: action.q_keywords || '',
        max_results: maxResults,
        db_only: dbOnly,
      };

      console.log('[AI-SEARCH] Fetching search-stream...');

      // Use retry logic for transient failures (502/503/504) and cold-start network errors
      let res: Response | null = null;
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/deep-prospect/search-stream`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: currentController.signal,
            }
          );
          console.log(`[AI-SEARCH] Fetch response: ${res.status} (attempt ${attempt + 1})`);
          if (res.status >= 500 && attempt < MAX_RETRIES) {
            const delay = Math.min(1500 * Math.pow(2, attempt), 8000);
            console.warn(`[AI-SEARCH] Server error ${res.status}, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          break;
        } catch (fetchErr: any) {
          if (fetchErr.name === 'AbortError') throw fetchErr;
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1500 * Math.pow(2, attempt), 8000);
            console.warn(`[AI-SEARCH] Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms:`, fetchErr.message);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw fetchErr;
        }
      }

      if (!res || !res.ok) {
        const status = res?.status || 'unknown';
        let errorBody = '';
        try { errorBody = await res?.text() || ''; } catch {}
        throw new Error(`Search failed: ${status} ${errorBody}`.trim());
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body — reader unavailable');
      const decoder = new TextDecoder();
      let buffer = '';
      let allLeads: DiscoveredLead[] = [];
      let lastEventType = '';
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[AI-SEARCH] Stream ended after ${chunkCount} chunks, ${allLeads.length} leads`);
          break;
        }
        chunkCount++;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('event: ')) {
            lastEventType = trimmed.slice(7).trim();
            continue;
          }

          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            if (lastEventType === 'phase' || data.phase !== undefined) {
              setMessages(prev => prev.map(m =>
                m.id === messageId ? { ...m, searchPhase: data.name || `Phase ${data.phase}` } : m
              ));
            } else if (lastEventType === 'progress') {
              setMessages(prev => prev.map(m =>
                m.id === messageId ? { ...m, searchPhase: `Discovering leads (${data.fetched || 0} found)` } : m
              ));
            } else if (lastEventType === 'people' || data.people) {
              const newLeads: DiscoveredLead[] = data.people || [];
              if (newLeads.length > 0) {
                allLeads = [...newLeads];
                setMessages(prev => prev.map(m =>
                  m.id === messageId ? { ...m, leads: [...allLeads], searchCount: allLeads.length } : m
                ));
              }
            } else if (lastEventType === 'error') {
              console.error('[AI-SEARCH] Server error event:', data.message);
              setMessages(prev => prev.map(m =>
                m.id === messageId ? { ...m, searchState: 'error' as const, searchPhase: `Server error — ${data.message || 'try again'}` } : m
              ));
            } else if (lastEventType === 'complete') {
              if (data.people?.length) {
                allLeads = data.people;
              }

              // Determine final state based on mode and results
              const finalState: 'complete' | 'local-done' =
                dbOnly && allLeads.length < maxResults ? 'local-done' : 'complete';

              setMessages(prev => prev.map(m =>
                m.id === messageId ? {
                  ...m,
                  searchState: finalState,
                  searchPhase: finalState === 'local-done' ? 'Local search complete' : 'Search complete',
                  leads: allLeads.length > 0 ? [...allLeads] : m.leads,
                  searchCount: allLeads.length,
                } : m
              ));
            }

            lastEventType = '';
          } catch { /* ignore parse errors */ }
        }
      }

      // Final state — if stream ended without a 'complete' event
      setMessages(prev => prev.map(m => {
        if (m.id !== messageId || m.searchState !== 'searching') return m;
        console.log('[AI-SEARCH] Stream ended without complete event, finalizing with', allLeads.length, 'leads');
        const finalState: 'complete' | 'local-done' =
          dbOnly && allLeads.length < maxResults ? 'local-done' : 'complete';
        return { ...m, searchState: finalState, leads: allLeads.length > 0 ? allLeads : m.leads };
      }));
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[AI-SEARCH] Search aborted');
        // Ensure state transitions away from 'searching' even on abort
        setMessages(prev => prev.map(m =>
          m.id === messageId && m.searchState === 'searching'
            ? { ...m, searchState: 'error' as const, searchPhase: 'Search cancelled' }
            : m
        ));
        return;
      }
      console.error('[AI-SEARCH] Error:', err);
      setMessages(prev => prev.map(m =>
        m.id === messageId && m.searchState === 'searching'
          ? { ...m, searchState: 'error' as const, searchPhase: `Search failed — ${err.message || 'try again'}` }
          : m
      ));
    } finally {
      clearTimeout(timeoutId);
      clearTimeout(slowTimerId);
    }
  }, [isDemoMode]);

  // ── Expand search externally (phase 2) ──
  const expandSearchExternally = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg?.searchParams) return;
    runLeadSearch(msg.searchParams, messageId, false);
  }, [messages, runLeadSearch]);

  // ── Save single lead to CRM ──
  const saveSingleLead = useCallback(async (lead: DiscoveredLead) => {
    if (isDemoMode) { toast.success(`Saved ${lead.name} to CRM (demo)`); return; }
    setSavingLeadIds(prev => new Set(prev).add(lead.id));
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/apollo/save-to-crm`,
        { method: 'POST', headers, body: JSON.stringify({ leads: [lead] }) }
      );
      const data = await res.json();
      if (res.ok && data.results) {
        setSavedLeadIds(prev => new Set(prev).add(lead.id));
        toast.success(`Saved ${lead.name} to CRM`);
      } else if (res.status === 403) {
        toast.error('Lead limit reached — upgrade your plan');
      } else {
        toast.error(data.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save lead');
    } finally {
      setSavingLeadIds(prev => { const n = new Set(prev); n.delete(lead.id); return n; });
    }
  }, []);

  // ── Save selected leads to CRM ──
  const saveSelectedLeads = useCallback(async (leads: DiscoveredLead[]) => {
    const toSave = leads.filter(l => selectedLeadIds.has(l.id) && !savedLeadIds.has(l.id));
    if (toSave.length === 0) return;

    if (isDemoMode) {
      toSave.forEach(l => setSavedLeadIds(prev => new Set(prev).add(l.id)));
      toast.success(`Saved ${toSave.length} leads to CRM (demo)`);
      setSelectedLeadIds(new Set());
      return;
    }

    setIsBulkSaving(true);
    try {
      const headers = await getAuthHeaders();
      let totalSaved = 0;
      let totalSkipped = 0;

      for (let i = 0; i < toSave.length; i += 100) {
        const batch = toSave.slice(i, i + 100);
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/apollo/save-to-crm`,
          { method: 'POST', headers, body: JSON.stringify({ leads: batch }) }
        );
        const data = await res.json();
        if (res.ok && data.results) {
          totalSaved += data.results.saved;
          totalSkipped += data.results.skipped;
          batch.forEach(l => setSavedLeadIds(prev => new Set(prev).add(l.id)));
        } else if (res.status === 403) {
          toast.error('Lead limit reached — upgrade your plan');
          break;
        }
      }

      toast.success(`Saved ${totalSaved} leads to CRM${totalSkipped > 0 ? ` (${totalSkipped} duplicates)` : ''}`);
      setSelectedLeadIds(new Set());
    } catch {
      toast.error('Failed to save leads');
    } finally {
      setIsBulkSaving(false);
    }
  }, [selectedLeadIds, savedLeadIds]);

  // ── Quick email to a single discovered lead ──
  const sendEmailToLead = useCallback((lead: DiscoveredLead) => {
    if (isDemoMode) {
      toast.success(t('aiAssistant.campaign.emailDraftCreated'));
      return;
    }

    const firstName = lead.first_name || lead.name?.split(' ')[0] || 'there';
    const company = lead.organization?.name || '';
    const title = lead.title || '';

    // First save the lead if not already saved
    if (!savedLeadIds.has(lead.id)) {
      saveSingleLead(lead);
    }

    const draft: CampaignDraft = {
      name: `Outreach to ${lead.name}`,
      subject: `${firstName}, quick question`,
      body: `Hi ${firstName},\n\n${title && company ? `As ${title} at ${company}, ` : company ? `At ${company}, ` : ''}I thought this might resonate.\n\nWould a quick chat be worth exploring?`,
      tone: 'casual',
      leadCount: 1,
      leadFilter: lead.name,
      lead_ids: [],
      brand: userSettings.brand || 'custom',
      product: 'custom',
      senderName: userSettings.signatureName || '',
      senderTitle: userSettings.signatureTitle || '',
      fromEmail: userSettings.fromEmail || userSettings.signatureEmail || '',
      campaignKnowledge: '',
      followUpEnabled: true,
      followUpDays: 3,
      maxFollowUps: 2,
      audienceType: 'filter',
      groupId: '',
      groupName: '',
    };

    const msgId = `a-${Date.now()}`;
    const msg: Message = {
      id: msgId,
      role: 'assistant',
      content: `Here's your email to **${lead.name}** — review and hit Launch when ready.`,
      campaignDraft: draft,
      campaignState: 'preview',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, msg]);
    console.log(`[AI-ASSISTANT] Quick email campaign created for lead: ${lead.name} (${lead.email})`);
  }, [savedLeadIds, saveSingleLead, userSettings]);

  // ── Edit campaign draft field ──
  const editCampaignDraft = useCallback((messageId: string, field: string, value: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId || !m.campaignDraft) return m;
      // Handle typed fields
      let typedValue: any = value;
      if (field === 'followUpEnabled') typedValue = value === 'true';
      else if (field === 'followUpDays' || field === 'maxFollowUps' || field === 'leadCount') typedValue = parseInt(value, 10) || 0;
      return { ...m, campaignDraft: { ...m.campaignDraft, [field]: typedValue } };
    }));
  }, []);

  // ── Refresh audience (re-fetch lead IDs when user changes audience in card) ──
  const refreshAudience = useCallback(async (messageId: string, audienceType: string, groupId?: string) => {
    try {
      const headers = await getAuthHeaders();
      let url = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/all-ids?has_email=true`;
      if (audienceType === 'group' && groupId) {
        url += `&group_id=${groupId}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        const ids = data.ids || [];
        const total = data.total || ids.length;
        console.log(`[AI-CAMPAIGN] Refreshed audience: ${total} leads (type=${audienceType}, group=${groupId || 'none'})`);
        setMessages(prev => prev.map(m => {
          if (m.id !== messageId || !m.campaignDraft) return m;
          return { ...m, campaignDraft: { ...m.campaignDraft, lead_ids: ids, leadCount: total } };
        }));
      }
    } catch (err) {
      console.error('[AI-CAMPAIGN] Audience refresh failed:', err);
    }
  }, []);

  // ── Launch campaign from draft ──
  const launchCampaign = useCallback(async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg?.campaignDraft) return;
    const draft = msg.campaignDraft;

    // Block launch if email provider not connected (non-admin users)
    const providerOk = userSettings.isAdmin || (
      userSettings.emailProvider !== 'resend' && !!userSettings.connectedEmail
    );
    if (!providerOk) {
      toast.error(t('aiAssistant.campaign.connectEmailFirst'));
      return;
    }

    // Resolve lead IDs from CRM — use draft.lead_ids, or fetch via all-ids endpoint
    let leadIds = draft.lead_ids || [];
    if (leadIds.length === 0) {
      try {
        const headers = await getAuthHeaders();

        // If leadFilter looks like a person's name (has a space, short), try searching CRM by name
        const filterLooksLikeName = draft.leadFilter && draft.leadFilter.includes(' ') && draft.leadFilter.length < 50;
        if (filterLooksLikeName) {
          // Search CRM for this person by name
          const searchRes = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/all-ids?has_email=true&search=${encodeURIComponent(draft.leadFilter)}`,
            { headers }
          );
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            leadIds = searchData.ids || [];
            console.log(`[AI-CAMPAIGN] Searched CRM by name "${draft.leadFilter}" → ${leadIds.length} leads`);
          }
        }

        // Fallback: general audience fetch
        if (leadIds.length === 0) {
          let url = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/all-ids?has_email=true`;
          if (draft.audienceType === 'group' && draft.groupId) {
            url += `&group_id=${draft.groupId}`;
          }
          const res = await fetch(url, { headers });
          if (res.ok) {
            const data = await res.json();
            leadIds = data.ids || [];
            console.log(`[AI-CAMPAIGN] Resolved ${leadIds.length} lead IDs via all-ids (audience=${draft.audienceType || 'all'})`);
          }
        }
      } catch (err) {
        console.error('[AI-CAMPAIGN] Failed to fetch leads:', err);
      }
    }

    if (leadIds.length === 0) {
      // If lead filter is a name, provide specific guidance
      const filterLooksLikeName = draft.leadFilter && draft.leadFilter.includes(' ') && draft.leadFilter.length < 50;
      if (filterLooksLikeName) {
        toast.error(t('aiAssistant.campaign.leadNotFoundCRM', { name: draft.leadFilter }));
      } else {
        toast.error(t('aiAssistant.campaign.noLeadsWithEmail'));
      }
      return;
    }

    // Update state to sending
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, campaignState: 'sending' as const, campaignDraft: { ...m.campaignDraft!, leadCount: leadIds.length } } : m
    ));

    try {
      const headers = await getAuthHeaders();

      // Resolve brand and sender from draft + user settings
      const brand = draft.brand || userSettings.brand || 'custom';
      const product = draft.product || (brand === 'custom' ? (draft.senderName || userSettings.signatureName || 'custom') : brand);
      const resolvedSenderName = draft.senderName || userSettings.signatureName || '';
      const resolvedSenderTitle = draft.senderTitle || userSettings.signatureTitle || '';
      const resolvedFromEmail = draft.fromEmail || userSettings.fromEmail || userSettings.signatureEmail || '';

      // Build campaign_knowledge with the exact subject/body template
      let campaignKnowledge = draft.campaignKnowledge || '';
      if (draft.subject && draft.body) {
        const templateInstr = `IMPORTANT: Use this EXACT email template. Replace merge tags ({{first_name}}, {{company}}, {{title}}) with the lead's actual data. Do NOT rewrite or reimagine the email — send it as written below.\n\nSubject: ${draft.subject}\n\nBody:\n${draft.body}`;
        campaignKnowledge = campaignKnowledge ? `${campaignKnowledge}\n\n${templateInstr}` : templateInstr;
      }

      // 1. Create campaign
      const createRes = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns`,
        {
          method: 'POST', headers,
          body: JSON.stringify({
            name: draft.name,
            product,
            brand,
            tone: draft.tone || 'casual',
            sender_name: resolvedSenderName,
            sender_title: resolvedSenderTitle,
            from_email: resolvedFromEmail,
            campaign_knowledge: campaignKnowledge,
            status: 'draft',
          }),
        }
      );

      if (!createRes.ok) throw new Error('Failed to create campaign');
      const createData = await createRes.json();
      const campaignId = createData.campaign.id;

      // 2. Add leads to campaign
      const addRes = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns/${campaignId}/leads`,
        {
          method: 'POST', headers,
          body: JSON.stringify({ lead_ids: leadIds }),
        }
      );

      if (!addRes.ok) throw new Error('Failed to add leads');

      // 3. Trigger broadcast — this starts the live sending overlay
      broadcast.startBroadcast({
        campaignId,
        campaignName: draft.name,
        total: leadIds.length,
      });

      // Invalidate caches
      apiCache.invalidate('campaigns:*');
      apiCache.invalidate('crm:*');
      apiCache.invalidate('dashboard:*');

      // Update state to sent
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, campaignState: 'sent' as const } : m
      ));

      toast.success(`Campaign "${draft.name}" launched with ${leadIds.length.toLocaleString()} leads`);

    } catch (err: any) {
      console.error('[AI-CAMPAIGN] Launch failed:', err);
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, campaignState: 'error' as const } : m
      ));
      toast.error(`Failed to launch campaign: ${err.message}`);
    }
  }, [messages, broadcast, userSettings]);

  // ── Send message ──
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;
    setHasInteracted(true);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: content.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.map(m => {
        let content = m.content;
        // Append lead summary so AI knows what was found in this conversation
        if (m.leads && m.leads.length > 0 && m.role === 'assistant') {
          const leadSummary = m.leads.slice(0, 10).map(l =>
            `${l.name} (${l.title || 'N/A'} at ${l.organization?.name || 'N/A'}, ${l.email || 'no email'})`
          ).join('; ');
          content += `\n[Search results: Found ${m.leads.length} leads including: ${leadSummary}]`;
        }
        return { role: m.role, content };
      });
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-assistant/chat`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: content.trim(), history }) }
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[AI-ASSISTANT] Chat request failed: ${res.status} ${errText}`);
        throw new Error(`Request failed: ${res.status}`);
      }
      let data: any;
      try {
        data = await res.json();
      } catch (jsonErr) {
        console.error('[AI-ASSISTANT] Failed to parse response JSON:', jsonErr);
        throw new Error('Invalid response from server');
      }

      // Check for server-side error in response body (can happen with 200 status)
      if (data.error && !data.message) {
        console.error('[AI-ASSISTANT] Server returned error in response body:', data.error, data.details || '');
        throw new Error(data.details || data.error || 'Server error');
      }

      // Ensure data.message is a string
      if (data.message && typeof data.message !== 'string') {
        console.warn('[AI-ASSISTANT] data.message is not a string, type:', typeof data.message);
        try {
          data.message = typeof data.message === 'object'
            ? (data.message.text || data.message.content || JSON.stringify(data.message))
            : String(data.message);
        } catch {
          data.message = 'I processed your request but had trouble formatting the response.';
        }
      }

      console.log('[AI-ASSISTANT] Chat response received:', { message_length: (data.message || '').length, actions_count: (data.actions || []).length, action_types: (data.actions || []).map((a: any) => a.type) });

      // Check for find_leads action — start from structured actions, then check inline
      let findAction = (data.actions || []).find((a: AIAction) => a.type === 'find_leads');
      let campaignAction = (data.actions || []).find((a: AIAction) => a.type === 'launch_campaign');
      let otherActions = (data.actions || []).filter((a: AIAction) => a.type !== 'find_leads' && a.type !== 'launch_campaign');

      console.log('[AI-ASSISTANT] Response received. Structured actions:', (data.actions || []).map((a: AIAction) => a.type), 'findAction?', !!findAction, 'campaignAction?', !!campaignAction);

      // Always clean the message text of any inline JSON action blobs
      // Also use as fallback extraction if structured actions weren't found
      let cleanedMessageText = data.message || '';
      if (cleanedMessageText) {
        const { actions: inlineActions, cleanedText } = extractInlineActionsClient(cleanedMessageText);
        if (inlineActions.length > 0) {
          console.log('[AI-ASSISTANT] Inline actions extracted from message text:', inlineActions.map(a => a.type));
        }
        // Pick up inline find_leads if not already found in structured actions
        if (!findAction) {
          const inlineFind = inlineActions.find(a => a.type === 'find_leads');
          if (inlineFind) {
            findAction = inlineFind;
            console.log('[AI-ASSISTANT] Using inline find_leads action from message text:', inlineFind);
          }
        }
        if (!campaignAction) {
          const inlineCampaign = inlineActions.find(a => a.type === 'launch_campaign');
          if (inlineCampaign) {
            campaignAction = inlineCampaign;
            console.log('[AI-ASSISTANT] Extracted inline campaign action via brace-depth parser');
          }
        }
        // Also pick up other inline actions not already found
        const inlineOthers = inlineActions.filter(a => a.type !== 'launch_campaign' && a.type !== 'find_leads');
        if (inlineOthers.length > 0) {
          otherActions = [...otherActions, ...inlineOthers];
        }
        // Only use cleaned text if it's not empty — prevent stripping everything
        cleanedMessageText = cleanedText.trim() || cleanedMessageText;
      }

      // Final safety: if message was completely stripped, use original
      if (!cleanedMessageText.trim() && data.message) {
        console.warn('[AI-ASSISTANT] Message was stripped to empty, restoring original');
        cleanedMessageText = data.message;
      }

      console.log('[AI-ASSISTANT] After inline extraction — findAction?', !!findAction, 'campaignAction?', !!campaignAction, 'cleanedMsg:', cleanedMessageText.length, 'chars, otherActions:', otherActions.map(a => a.type));

      const assistantMsgId = `a-${Date.now()}`;

      // Build campaign draft if launch_campaign action present
      let campaignDraft: CampaignDraft | undefined;
      if (campaignAction) {
        // Campaign leads always come from CRM (groups / audience selector)
        // Never use in-session discovered leads — user must save them to CRM first
        const leadFilter = campaignAction.lead_filter || '';

        // Try to match the AI's lead_filter to an existing CRM group
        let prefetchedIds: string[] = [];
        let prefetchedCount = 0;
        let matchedGroup: LeadGroup | undefined;

        if (leadFilter && leadFilter.toLowerCase() !== 'all') {
          const filterLower = leadFilter.toLowerCase();
          const filterWords = filterLower.split(/\s+/).filter(w => w.length > 2);
          matchedGroup = (userSettings?.groups || []).find(g => {
            const nameLower = g.name.toLowerCase();
            // Direct substring match (either direction)
            if (nameLower.includes(filterLower) || filterLower.includes(nameLower)) return true;
            // Word-level match: any significant word from the filter appears in the group name
            if (filterWords.some(w => nameLower.includes(w))) return true;
            // Also check if group name words appear in the filter
            const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
            if (nameWords.some(w => filterLower.includes(w))) return true;
            return false;
          });
          if (matchedGroup) {
            try {
              const headers = await getAuthHeaders();
              const crmRes = await fetch(
                `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/all-ids?has_email=true&group_id=${matchedGroup.id}`,
                { headers }
              );
              if (crmRes.ok) {
                const crmData = await crmRes.json();
                prefetchedIds = crmData.ids || [];
                prefetchedCount = crmData.total || prefetchedIds.length;
                console.log(`[AI-CAMPAIGN] Matched CRM group "${matchedGroup.name}" → ${prefetchedCount} leads`);
              }
            } catch (err) {
              console.warn('[AI-CAMPAIGN] CRM group lead fetch failed:', err);
            }
          }

          // If no CRM group matched, check if lead_filter matches a discovered lead name
          if (!matchedGroup && prefetchedIds.length === 0) {
            const allSessionLeads = messages.flatMap(m => m.leads || []);
            const matchedLead = allSessionLeads.find(
              l => l.name && leadFilter && l.name.toLowerCase() === leadFilter.toLowerCase()
            );
            if (matchedLead) {
              console.log(`[AI-CAMPAIGN] Matched discovered lead by name: "${matchedLead.name}" (${matchedLead.email})`);
              // Save the lead if not already saved, then use their ID
              if (!savedLeadIds.has(matchedLead.id)) {
                saveSingleLead(matchedLead);
              }
              prefetchedCount = 1;
              // lead_ids will be resolved at launch time via CRM search
            }
          }
        }

        // Normalize body/subject: convert literal \n text to actual newlines
        // (safety net for double-escaped \\n from AI output)
        const normalizeNewlines = (s: string) => s.replace(/\\n/g, '\n');

        campaignDraft = {
          name: campaignAction.campaign_name || 'Untitled Campaign',
          subject: normalizeNewlines(campaignAction.subject || ''),
          body: normalizeNewlines(campaignAction.body || ''),
          tone: campaignAction.tone || 'casual',
          leadCount: prefetchedCount,
          leadFilter,
          lead_ids: prefetchedIds,
          brand: userSettings.brand || 'custom',
          product: 'custom',
          senderName: userSettings.signatureName || '',
          senderTitle: userSettings.signatureTitle || '',
          fromEmail: userSettings.fromEmail || userSettings.signatureEmail || '',
          campaignKnowledge: campaignAction.campaign_knowledge || '',
          followUpEnabled: true,
          followUpDays: 3,
          maxFollowUps: 2,
          audienceType: matchedGroup ? 'group' : 'filter',
          groupId: matchedGroup?.id || '',
          groupName: matchedGroup?.name || '',
        };
      }

      // cleanedMessageText was already stripped by extractInlineActionsClient above

      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: campaignDraft 
          ? "Here's your campaign — review and hit Launch when ready."
          : (cleanedMessageText || 'I couldn\'t process that. Try rephrasing.'),
        actions: otherActions.length > 0 ? otherActions : undefined,
        timestamp: new Date(),
        ...(findAction ? { searchState: 'searching' as const, leads: [], searchCount: 0, searchPhase: 'Searching local database...', searchParams: findAction } : {}),
        ...(campaignDraft ? { campaignDraft, campaignState: 'preview' as const } : {}),
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Trigger SSE search if find_leads action
      if (findAction) {
        console.log('[AI-ASSISTANT] Triggering search for find_leads action:', findAction);
        runLeadSearch(findAction, assistantMsgId);
      } else {
        console.log('[AI-ASSISTANT] No find_leads action in response. Actions:', data.actions?.map((a: AIAction) => a.type));
      }
    } catch (error: any) {
      console.error('[AI-ASSISTANT] Error:', error?.message || error);
      let errorMsg: string;
      if (error?.message?.includes('502') || error?.message?.includes('unavailable')) {
        errorMsg = 'AI service is temporarily unavailable. The server may still be deploying — try again in a moment.';
      } else if (error?.message?.includes('timeout') || error?.message?.includes('55s')) {
        errorMsg = 'The AI request timed out. Try a simpler question or try again.';
      } else if (error?.message?.includes('OPENAI_API_KEY')) {
        errorMsg = 'The AI service is not configured yet. Please check that the OpenAI API key is set in Supabase secrets.';
      } else if (error?.message?.includes('Not authenticated') || error?.message?.includes('Session expired')) {
        errorMsg = 'Your session has expired. Please sign in again to use the AI assistant.';
      } else if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
        errorMsg = 'Authentication error. Please try refreshing the page or signing in again.';
      } else {
        errorMsg = `Something went wrong: ${error?.message?.slice(0, 100) || 'Unknown error'}. Please try again.`;
      }
      setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: errorMsg, timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, runLeadSearch, savedLeadIds, saveSingleLead, userSettings]);

  // ── Action handler ──
  const handleAction = useCallback((action: AIAction) => {
    switch (action.type) {
      case 'navigate': if (action.view && onNavigate) { onNavigate(action.view); handleClose(); } break;
      case 'open_campaign_builder': onOpenCampaignBuilder?.(); handleClose(); break;
      case 'search_leads': if (onNavigate) { onNavigate('lead-finder'); handleClose(); } break;
      case 'draft_email':
        if (action.body || action.subject) {
          const subj = (action.subject || '').replace(/\\n/g, '\n');
          const bod = (action.body || '').replace(/\\n/g, '\n');
          const t = [subj ? `Subject: ${subj}` : '', bod].filter(Boolean).join('\n\n');
          navigator.clipboard.writeText(t).then(() => toast.success('Draft copied')).catch(() => toast.error('Failed to copy'));
        }
        break;
    }
  }, [onNavigate, onOpenCampaignBuilder, handleClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  // ── Cleanup on unmount ──
  useEffect(() => () => { abortRef.current?.abort(); if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  // ── Body scroll lock when panel is open ──
  // On mobile: use position:fixed to prevent iOS rubber-banding
  // On desktop: just overflow:hidden (position:fixed can cause layout recalc issues)
  useEffect(() => {
    if (!isOpen) return;
    const isMobile = window.innerWidth < 768;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    if (isMobile) {
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
    }
    return () => {
      document.body.style.overflow = '';
      if (isMobile) {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      }
    };
  }, [isOpen]);

  // ── Render ──
  // Only use conversation mode when there are actual messages to display
  // (hasInteracted alone shouldn't show empty conversation panel)
  const hasMessages = messages.length > 0;

  return (
    <>
      {/* ── Backdrop + centered panel ── */}
      {isOpen && (
        <div
          className={`fixed inset-0 z-[9999] flex items-end md:items-center justify-center px-0 pb-0 md:p-8 ${isKeyboardOpen ? 'pt-0' : 'pt-[calc(env(safe-area-inset-top,20px)+24px)]'}`}
          style={{ animation: 'aiFadeIn .2s ease-out' }}
        >
          <div className="absolute inset-0 bg-black/25 dark:bg-black/50 backdrop-blur-[8px]" onClick={handleClose} />

          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full md:max-w-[780px] flex flex-col bg-white dark:bg-[#111111] rounded-t-2xl md:rounded-2xl
              border border-zinc-200/80 dark:border-zinc-200 dark:border-zinc-800
              shadow-[0_24px_80px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]
              overflow-hidden
              ${(hasMessages || showHistory) ? 'ai-panel-fullmobile' : 'ai-panel-capped'}`}
            style={{
              animation: 'aiPanelUp .3s cubic-bezier(.16,1,.3,1)',
              ...(isKeyboardOpen && keyboardHeight > 0 ? {
                height: `calc(100dvh - ${keyboardHeight}px)`,
                maxHeight: `calc(100dvh - ${keyboardHeight}px)`,
                transition: 'height 0.15s ease-out, max-height 0.15s ease-out',
              } : {}),
            }}
          >
            {/* ── Mobile drag handle ── */}
            <div className="md:hidden flex justify-center pt-2 pb-0 shrink-0" onClick={handleClose}>
              <div className="w-9 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            </div>

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-2.5 md:py-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                  <SparkleIcon size={12} className="text-white dark:text-zinc-900" />
                </div>
                <span className="text-[12px] font-semibold text-zinc-500 dark:text-zinc-400 tracking-tight">Contndr AI</span>
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={openHistory} className="tap-target-override p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors inline-flex items-center justify-center" title="Chat history">
                  <Clock className="w-3.5 h-3.5" />
                </button>
                {messages.length > 0 && (
                  <button onClick={startNewChat} className="tap-target-override p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors inline-flex items-center justify-center" title="New conversation">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={handleClose} className="tap-target-override p-2 md:p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors inline-flex items-center justify-center" title="Close" aria-label="Close">
                  <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
                </button>
              </div>
            </div>

            {/* ── History panel ── */}
            {showHistory && (
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" style={{ animation: 'aiContentUp .25s ease-out', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                <div className="px-4 md:px-5 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => setShowHistory(false)} className="flex items-center gap-1 text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                      <ChevronLeft className="w-3.5 h-3.5" /> Back
                    </button>
                    <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</span>
                  </div>

                  {sessionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-5 h-5 text-zinc-300 dark:text-zinc-600 animate-spin" />
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="text-center py-12">
                      <MessageSquare className="w-8 h-8 text-zinc-200 dark:text-zinc-700 mx-auto mb-3" />
                      <p className="text-[13px] text-zinc-400 dark:text-zinc-500">No past conversations yet</p>
                      <p className="text-[11px] text-zinc-300 dark:text-zinc-600 mt-1">Your chats will be saved automatically</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {sessions.map(s => (
                        <div key={s.id}
                          className="group flex items-start gap-3 px-3.5 py-3 rounded-xl border border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all duration-200 cursor-pointer"
                          onClick={() => loadSession(s.id)}
                        >
                          <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-white/[0.05] flex items-center justify-center shrink-0">
                            <MessageSquare className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-zinc-900 dark:text-white truncate">{s.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">
                                {new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                              <span className="text-zinc-200 dark:text-zinc-700">·</span>
                              <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{s.messageCount} messages</span>
                              {s.leadCount > 0 && (
                                <>
                                  <span className="text-zinc-200 dark:text-zinc-700">·</span>
                                  <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                                    <Users className="w-3 h-3" /> {s.leadCount} leads
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                            disabled={deletingSessionId === s.id}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all shrink-0"
                          >
                            {deletingSessionId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Welcome greeting ── */}
            {!hasMessages && !showHistory && (
              <div className="px-4 md:px-6 pb-2 pt-3" style={{ animation: 'aiContentUp .45s cubic-bezier(.16,1,.3,1) .08s both' }}>
                <h1 className="text-[20px] md:text-[28px] font-semibold leading-tight tracking-[-0.02em]">
                  <span className="text-zinc-400 dark:text-zinc-500">{t(greetingKey)}{firstName ? `, ${firstName}` : ''}</span>
                  <br />
                  <span className="text-zinc-900 dark:text-white">{t('aiAssistant.howCanIHelp')}</span>
                </h1>
                <div className="grid grid-cols-2 md:flex md:flex-wrap gap-1.5 mt-5" style={{ animation: 'aiContentUp .45s cubic-bezier(.16,1,.3,1) .2s both' }}>
                  {SUGGESTION_KEYS.map((s) => (
                    <button
                      key={s.labelKey}
                      onClick={() => sendMessage(t(s.promptKey))}
                      className="flex items-center gap-1.5 px-3 py-2.5 md:py-2 rounded-xl md:rounded-full text-left
                        bg-zinc-50 dark:bg-zinc-100 dark:bg-zinc-900 border border-zinc-150 dark:border-white/[0.07]
                        hover:bg-zinc-100 dark:hover:bg-white/[0.07] hover:border-zinc-250 dark:hover:border-white/[0.12]
                        transition-all duration-200 group/c active:scale-[0.98]"
                    >
                      <s.icon className="w-3.5 md:w-3 h-3.5 md:h-3 text-zinc-400 dark:text-zinc-500 group-hover/c:text-zinc-600 dark:group-hover/c:text-zinc-300 shrink-0" />
                      <span className="text-[11px] md:text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400 group-hover/c:text-zinc-700 dark:group-hover/c:text-zinc-200">
                        {t(s.labelKey)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Messages area ── */}
            {hasMessages && !showHistory && (
              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-5 py-4 custom-scrollbar" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                  <div className="space-y-4">
                    {messages.map((msg, idx) => (
                      <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        style={idx === messages.length - 1 ? { animation: 'aiMsgIn .25s ease-out' } : undefined}>
                        {msg.role === 'user' ? (
                          <div className="max-w-[85%] md:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] leading-relaxed break-words">
                            {msg.content}
                          </div>
                        ) : (
                          <div className="max-w-full w-full space-y-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-md bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                                <SparkleIcon size={10} className="text-white dark:text-zinc-900" />
                              </div>
                              <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Contndr AI</span>
                            </div>

                            {/* Text content */}
                            {msg.content && (
                              <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
                                <FormatMessage content={msg.content} />
                              </div>
                            )}

                            {/* Search progress */}
                            {msg.searchState === 'searching' && (
                              <EnhancedSearchProgress
                                phase={msg.searchPhase || ''}
                                count={msg.searchCount || 0}
                                params={msg.searchParams}
                                onCancel={() => {
                                  abortRef.current?.abort();
                                  setMessages(prev => prev.map(m =>
                                    m.id === msg.id && m.searchState === 'searching'
                                      ? { ...m, searchState: 'error' as const, searchPhase: 'Search cancelled' }
                                      : m
                                  ));
                                }}
                              />
                            )}

                            {/* Lead cards */}
                            {msg.leads && msg.leads.length > 0 && (
                              <div className="space-y-1" style={{ animation: 'aiContentUp .3s ease-out' }}>
                                <LeadResultsToolbar
                                  leads={msg.leads}
                                  selectedIds={selectedLeadIds}
                                  savedIds={savedLeadIds}
                                  saving={isBulkSaving}
                                  onSelectAll={() => {
                                    const unsaved = msg.leads!.filter(l => !savedLeadIds.has(l.id));
                                    const allSelected = unsaved.every(l => selectedLeadIds.has(l.id));
                                    if (allSelected) {
                                      setSelectedLeadIds(new Set());
                                    } else {
                                      setSelectedLeadIds(new Set(unsaved.map(l => l.id)));
                                    }
                                  }}
                                  onSaveSelected={() => saveSelectedLeads(msg.leads!)}
                                />
                                <div className="space-y-1.5 max-h-[50vh] md:max-h-[320px] overflow-y-auto custom-scrollbar pr-0.5" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                                  {msg.leads.map(lead => (
                                    <LeadCard
                                      key={lead.id}
                                      lead={lead}
                                      selected={selectedLeadIds.has(lead.id)}
                                      onToggle={() => {
                                        setSelectedLeadIds(prev => {
                                          const next = new Set(prev);
                                          next.has(lead.id) ? next.delete(lead.id) : next.add(lead.id);
                                          return next;
                                        });
                                      }}
                                      onSave={() => saveSingleLead(lead)}
                                      saved={savedLeadIds.has(lead.id)}
                                      saving={savingLeadIds.has(lead.id)}
                                      onSendEmail={sendEmailToLead}
                                    />
                                  ))}
                                </div>

                                {/* Search complete summary */}
                                {msg.searchState === 'complete' && (
                                  <div className="flex items-center gap-2 px-3 py-2 mt-1 rounded-lg bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950">
                                    <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7] shrink-0" />
                                    <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                                      {t('aiAssistant.search.foundLeads')} <strong className="text-zinc-900 dark:text-white">{msg.leads.length}</strong> {t('aiAssistant.search.leads')}
                                      — <strong className="text-zinc-900 dark:text-white">{msg.leads.filter(l => l.email).length}</strong> {t('aiAssistant.search.withVerifiedEmail')}
                                      {' '}{t('aiAssistant.search.selectAndSave')}
                                    </span>
                                  </div>
                                )}

                                {/* Local search done — offer to expand */}
                                {msg.searchState === 'local-done' && (
                                  <div className="flex items-center gap-3 px-3 py-2.5 mt-1 rounded-xl bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-200 dark:border-zinc-800" style={{ animation: 'aiMsgIn .25s ease-out' }}>
                                    <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7] shrink-0" />
                                    <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 flex-1">
                                      {t('aiAssistant.search.foundLeads')} <strong className="text-zinc-900 dark:text-white">{msg.leads.length}</strong> {t('aiAssistant.search.foundFromLocal')}
                                      {' '}{t('aiAssistant.search.wantMore')}
                                    </span>
                                    <button
                                      onClick={() => expandSearchExternally(msg.id)}
                                      className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-1.5 active:scale-95"
                                    >
                                      <Radar className="w-3 h-3" />
                                      {t('aiAssistant.search.discoverMore')}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Search error */}
                            {msg.searchState === 'error' && !msg.leads?.length && (
                              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-500/5 border border-zinc-500/10">
                                <X className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                <span className="text-[12px] text-zinc-400 flex-1">{msg.searchPhase || t('aiAssistant.search.searchFailed')}</span>
                                {msg.searchParams && (
                                  <button
                                    onClick={() => {
                                      setMessages(prev => prev.map(m =>
                                        m.id === msg.id ? { ...m, searchState: 'searching' as const, searchPhase: t('aiAssistant.search.retryingSearch') } : m
                                      ));
                                      runLeadSearch(msg.searchParams!, msg.id);
                                    }}
                                    className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors active:scale-95"
                                  >
                                    {t('aiAssistant.search.retry')}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Local search done with 0 results — show expand button */}
                            {msg.searchState === 'local-done' && (!msg.leads || msg.leads.length === 0) && (
                              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-200 dark:border-zinc-800" style={{ animation: 'aiMsgIn .25s ease-out' }}>
                                <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 flex-1">
                                  {t('aiAssistant.search.noMatchesLocal')}
                                </span>
                                <button
                                  onClick={() => expandSearchExternally(msg.id)}
                                  className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-1.5 active:scale-95"
                                >
                                  <Radar className="w-3 h-3" />
                                  {t('aiAssistant.search.discoverExternally')}
                                </button>
                              </div>
                            )}

                            {/* Action buttons */}
                            {msg.actions && msg.actions.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pl-1">
                                {msg.actions.map((a, i) => <ActionButton key={i} action={a} onExecute={handleAction} />)}
                              </div>
                            )}

                            {/* Campaign preview card */}
                            {msg.campaignDraft && (
                              <CampaignPreviewCard
                                draft={msg.campaignDraft}
                                state={msg.campaignState}
                                onEdit={(field, value) => editCampaignDraft(msg.id, field, value)}
                                onLaunch={() => launchCampaign(msg.id)}
                                onRefreshAudience={(type, gId) => refreshAudience(msg.id, type, gId)}
                                userSettings={userSettings}
                                onNavigateToSignature={() => {
                                  handleClose();
                                  if (onNavigate) onNavigate('settings');
                                  setTimeout(() => window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'signature' })), 150);
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Thinking dots */}
                    {isLoading && (
                      <div className="flex justify-start" style={{ animation: 'aiMsgIn .25s ease-out' }}>
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-md bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                              <SparkleIcon size={10} className="text-white dark:text-zinc-900" />
                            </div>
                            <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Contndr AI</span>
                          </div>
                          <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <div className="flex gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                              </div>
                              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t('aiAssistant.thinking')}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
              </div>
            )}

            {/* Scroll-to-bottom button (positioned relative to panel) */}
            {hasMessages && !showHistory && showScrollBtn && (
              <button
                onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="absolute bottom-24 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 shadow-md flex items-center justify-center hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors z-10"
              >
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
              </button>
            )}

            {/* ── Input bar — pinned to bottom, keyboard-aware ── */}
            {!showHistory && (
            <div
              className={`shrink-0 px-4 md:px-5 md:pb-4 bg-white dark:bg-[#111111] ${hasMessages ? 'pt-2 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800' : 'pt-4'}`}
              style={{
                paddingBottom: isKeyboardOpen
                  ? '8px'
                  : 'calc(1rem + env(safe-area-inset-bottom, 0px))',
                transition: 'padding-bottom 0.15s ease-out',
              }}
            >
              <div className="flex items-end gap-2.5 bg-zinc-50/80 dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-2.5
                focus-within:border-zinc-300 dark:focus-within:border-white/[0.15] focus-within:bg-white dark:focus-within:bg-white/[0.05]
                transition-all duration-200 shadow-sm shadow-black/[0.02] dark:shadow-none">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  onFocus={() => {
                    // On mobile, scroll messages to bottom when keyboard opens
                    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
                  }}
                  placeholder={hasMessages ? t('aiAssistant.inputFollowUp') : t('aiAssistant.inputPlaceholder')}
                  rows={1}
                  className="flex-1 bg-transparent text-[14px] text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 resize-none outline-none border-0 ring-0 focus:ring-0 focus:outline-none leading-relaxed py-0.5 no-focus-ring"
                  style={{ minHeight: '24px', maxHeight: '140px', overflow: 'hidden' }}
                  disabled={isLoading}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isLoading}
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                    bg-zinc-900 dark:bg-white text-white dark:text-zinc-900
                    hover:bg-zinc-800 dark:hover:bg-zinc-200
                    disabled:opacity-15 disabled:cursor-not-allowed
                    transition-all duration-200 active:scale-90"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
              {!isKeyboardOpen && (
                <p className="text-center text-[9.5px] text-zinc-300 dark:text-zinc-600 mt-2.5 select-none">
                  {t('aiAssistant.disclaimer')}<span className="hidden md:inline"> · {t('aiAssistant.toggleShortcut')}</span>
                </p>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes aiFadeIn {
          from { opacity: 0 }
          to { opacity: 1 }
        }
        @keyframes aiPanelUp {
          from { opacity: 0; transform: translateY(16px) scale(.97) }
          to { opacity: 1; transform: translateY(0) scale(1) }
        }
        @keyframes aiContentUp {
          from { opacity: 0; transform: translateY(10px) }
          to { opacity: 1; transform: translateY(0) }
        }
        @keyframes aiMsgIn {
          from { opacity: 0; transform: translateY(6px) }
          to { opacity: 1; transform: translateY(0) }
        }
        @keyframes searchPulse {
          0%, 100% { opacity: 0.5; transform: scaleX(0.7); transform-origin: left }
          50% { opacity: 1; transform: scaleX(1); transform-origin: left }
        }
        /* Mobile: full screen panel when messages present — leave gap at top for status bar */
        .ai-panel-fullmobile {
          height: calc(100dvh - env(safe-area-inset-top, 20px) - 24px);
          max-height: calc(100dvh - env(safe-area-inset-top, 20px) - 24px);
        }
        @media (min-width: 768px) {
          .ai-panel-fullmobile {
            height: min(780px, calc(100dvh - 64px));
            max-height: min(780px, calc(100dvh - 64px));
          }
        }
        /* Capped panel height (no messages yet) — mobile rule first, desktop override after */
        .ai-panel-capped {
          max-height: calc(100dvh - env(safe-area-inset-top, 20px) - 24px);
        }
        @media (min-width: 768px) {
          .ai-panel-capped {
            max-height: min(780px, calc(100dvh - 64px));
          }
        }
      `}</style>
    </>
  );
}