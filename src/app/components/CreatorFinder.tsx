// Rebuild: 2026-03-17T02:00 — force recompile after CreatorFinder i18n translation
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search, Upload, Play, Loader2, CheckCircle, XCircle, AlertTriangle,
  Download, UserPlus, ExternalLink, Mail, Users, Hash, Phone,
  ChevronDown, ChevronRight, Copy, Check,
  Clock, Info, Bookmark, Pause, Radar, Globe, Database,
  SlidersHorizontal, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { dispatchAppEvent } from '../lib/app-events';
import { apiCache } from '../lib/api-cache';
import { saveFinderCache, loadFinderCache, clearFinderCache, CACHE_KEYS } from '../lib/finder-cache';
import { useDemoMode, DEMO_CREATOR_RESULTS } from './DemoContext';
import { useTranslation } from 'react-i18next';

// ══════════════════════════════════════════════════════════════════════════
// Platform Icons (inline SVGs — avoids /imports module resolution issues)
// ══════════════════════════════════════════════════════════════════════════

function YouTubeLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 29 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clipPath="url(#yt_clip0)">
        <g clipPath="url(#yt_clip1)">
          <path d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 1.78814e-07 14.285 0 14.285 0C14.285 0 5.35042 1.78814e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C1.78814e-07 5.35042 0 10 0 10C0 10 1.78814e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z" fill="#FF0000"/>
          <path d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z" fill="white"/>
        </g>
      </g>
      <defs>
        <clipPath id="yt_clip0"><rect width="28.57" height="20" fill="white"/></clipPath>
        <clipPath id="yt_clip1"><rect width="28.57" height="20" fill="white"/></clipPath>
      </defs>
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" fill="currentColor"/>
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.77 1.52V6.84a4.84 4.84 0 01-1-.15z" fill="currentColor"/>
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/>
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════

type Platform = 'youtube' | 'instagram' | 'tiktok' | 'x';

interface KeywordInput {
  keyword: string;
  num_of_posts: number;
}

interface CreatorRun {
  id: string;
  user_id: string;
  platforms: Platform[];
  provider: string;
  status: string;
  status_message?: string;
  created_at: string;
  completed_at?: string;
  input_keywords: KeywordInput[];
  total_videos_found: number;
  unique_channels_found: number;
  channels_with_emails: number;
  channels_scraped?: number;
  total_profiles_discovered: number;
  profiles_enriched: number;
  error_text?: string;
}

interface CreatorResult {
  id: string;
  run_id: string;
  platform: Platform;
  keywords: string[];
  profile_url: string;
  handle: string;
  display_name: string;
  followers_text: string;
  followers_int: number;
  bio: string;
  external_links: string[];
  emails: string[];
  email_primary: string | null;
  email_sources?: Record<string, string>;
  enrichment_sources?: string[];
  website_primary: string | null;
  status: string;
  created_at: string;
  phone_numbers?: string[];
  // Email verification (DNS/MX validated)
  email_verification?: {
    status: 'valid' | 'risky' | 'invalid' | 'unknown';
    score: number;
    mx_valid: boolean;
    is_free_provider: boolean;
    is_disposable: boolean;
  } | null;
  // Engagement metrics
  engagement_rate?: number;
  avg_likes?: number;
  avg_comments?: number;
  posts_analyzed?: number;
  // Legacy compat
  channel_url?: string;
  channel_name?: string;
  subscribers_text?: string;
  subscribers_int?: number;
  description?: string;
  links?: string[];
}

interface CreatorFinderProps {
  onUpgrade?: () => void;
}

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/creator-finder`;

// ── Email source labels for display ──
const SOURCE_LABELS: Record<string, string> = {
  description: 'desc',
  about_page: 'about',
  video_desc: 'video',
  website: 'site',
  hunter: 'hunter',
  bio: 'bio',
  serp: 'serp',
};

// ── Platform config ──
const PLATFORM_CONFIG: Record<Platform, { label: string; color: string }> = {
  youtube: { label: 'YouTube', color: '#FF0000' },
  instagram: { label: 'Instagram', color: '#E4405F' },
  tiktok: { label: 'TikTok', color: '#000000' },
  x: { label: 'X', color: '#000000' },
};

function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  // Normalize platform string (handle any casing issues, null, undefined, string "undefined")
  if (!platform || platform === 'undefined' as any) {
    return <Globe className={className} />;
  }
  
  const normalizedPlatform = platform.toString().toLowerCase().trim();
  
  switch (normalizedPlatform) {
    case 'youtube': return <YouTubeLogo className={className} />;
    case 'instagram': return <InstagramIcon className={className} />;
    case 'tiktok': return <TikTokIcon className={className} />;
    case 'x':
    case 'twitter': return <XIcon className={className} />;
    default: 
      return <Globe className={className} />;
  }
}

// ── Keyframe animations ──
const creatorKeyframes = `
@keyframes cfEntryIn {
  0%   { opacity: 0; transform: translateY(8px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes cfCursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes cfPulseRing {
  0%   { box-shadow: 0 0 0 0 rgba(30,212,167,0.35); }
  70%  { box-shadow: 0 0 0 8px rgba(30,212,167,0); }
  100% { box-shadow: 0 0 0 0 rgba(30,212,167,0); }
}
@keyframes cfScanLine {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes cfRowIn {
  0%   { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes cfRowHighlight {
  0%   { background-color: rgba(30,212,167,0.06); }
  100% { background-color: transparent; }
}
`;

// ── Activity icon resolver ──
function activityIcon(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('youtube') || m.includes('video') || m.includes('search')) return <Search className="w-3.5 h-3.5" />;
  if (m.includes('channel') || m.includes('scrap') || m.includes('profile') || m.includes('fetch')) return <Globe className="w-3.5 h-3.5" />;
  if (m.includes('email') || m.includes('extract') || m.includes('bio')) return <Mail className="w-3.5 h-3.5" />;
  if (m.includes('verif') || m.includes('mx') || m.includes('dns')) return <ShieldCheck className="w-3.5 h-3.5" />;
  if (m.includes('save') || m.includes('import') || m.includes('crm')) return <Database className="w-3.5 h-3.5" />;
  if (m.includes('complete') || m.includes('done') || m.includes('finish')) return <CheckCircle className="w-3.5 h-3.5" />;
  if (m.includes('error') || m.includes('fail')) return <AlertTriangle className="w-3.5 h-3.5" />;
  if (m.includes('instagram') || m.includes('tiktok') || m.includes('twitter') || m.includes(' x ') || m.includes('serpapi') || m.includes('discover')) return <Radar className="w-3.5 h-3.5" />;
  return <Radar className="w-3.5 h-3.5" />;
}

// ══════════════════════════════════════════════════════════════════════════
// Live Agent Feed
// ══════════════════════════════════════════════════════════════════════════

interface AgentEntry {
  id: number;
  message: string;
  type: 'info' | 'success' | 'warn';
  ts: number;
}

function CreatorAgentFeed({
  entries,
  isSearching,
  currentRun,
  pct,
  stepLabel,
  activePlatforms,
}: {
  entries: AgentEntry[];
  isSearching: boolean;
  currentRun: CreatorRun | null;
  pct: number;
  stepLabel: string;
  activePlatforms: Platform[];
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 48);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 md:px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-5">
          <div className="relative">
            <div
              className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-white/10 flex items-center justify-center"
              style={isSearching ? { animation: 'cfPulseRing 2s ease infinite' } : undefined}
            >
              <Radar className={`w-5 h-5 ${isSearching ? 'animate-pulse' : ''} text-zinc-600 dark:text-zinc-300`} />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-main)] tracking-tight">{t('creatorFinder.creatorDiscoveryAgent')}</h3>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {isSearching ? (stepLabel || t('creatorFinder.workingLabel')) : t('creatorFinder.completeOperations', { count: entries.length })}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* Platform badges */}
            <div className="flex items-center gap-1">
              {activePlatforms.map(p => (
                <div key={p} className="w-5 h-5 rounded-md bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-center" title={PLATFORM_CONFIG[p].label}>
                  <PlatformIcon platform={p} className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
                </div>
              ))}
            </div>
            {currentRun && currentRun.profiles_enriched > 0 && currentRun.total_profiles_discovered > 0 && (
              <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 tabular-nums">
                {currentRun.profiles_enriched}/{currentRun.total_profiles_discovered}
              </span>
            )}
            <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600 tabular-nums">
              {pct}%
            </span>
          </div>
        </div>

        {/* Progress rail */}
        <div className="relative h-[3px] rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#1ED4A7] transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
          {isSearching && (
            <div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              style={{ animation: 'cfScanLine 2s ease-in-out infinite' }}
            />
          )}
        </div>

        {/* Phase chips */}
        {currentRun && (
          <div className="flex items-center gap-1.5 mt-4 overflow-x-auto pb-1">
            {[
              { name: t('creatorFinder.discoveryPhase'), done: ['step_channels', 'step_emails', 'step_enrichment', 'step_finalize', 'step_mx', 'completed'].includes(currentRun.status), active: currentRun.status === 'running' || currentRun.status === 'step_videos' || currentRun.status === 'step_discovery' },
              { name: t('creatorFinder.enrichmentPhase'), done: ['step_finalize', 'step_mx', 'completed'].includes(currentRun.status), active: currentRun.status === 'step_channels' || currentRun.status === 'step_emails' || currentRun.status === 'step_enrichment' },
              { name: t('creatorFinder.verificationPhase'), done: currentRun.status === 'completed', active: currentRun.status === 'step_finalize' || currentRun.status === 'step_mx' },
            ].map((phase, i) => (
              <div key={phase.name} className="contents">
                {i > 0 && <div className={`w-4 h-px flex-shrink-0 transition-colors duration-500 ${phase.done ? 'bg-[#1ED4A7]/40' : 'bg-zinc-200 dark:bg-zinc-800'}`} />}
                <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg flex-shrink-0 text-[10px] font-medium transition-all duration-300 ${
                  phase.active ? 'bg-[#1ED4A7]/[0.08] text-[var(--text-main)] ring-1 ring-[#1ED4A7]/25' :
                  phase.done ? 'bg-zinc-50 dark:bg-zinc-900/50 text-[#1ED4A7]' :
                  'bg-zinc-50 dark:bg-zinc-900/30 text-zinc-400 dark:text-zinc-600'
                }`}>
                  {phase.active && <Loader2 className="w-3 h-3 animate-spin" />}
                  {phase.done && <CheckCircle className="w-3 h-3" />}
                  {!phase.active && !phase.done && <div className="w-1.5 h-1.5 rounded-full border border-current" />}
                  <span className="whitespace-nowrap">{phase.name}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="flex-shrink-0 mx-6 md:mx-8 border-t border-zinc-100 dark:border-zinc-800/60" />

      {/* Feed */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 px-4 md:px-6 custom-scrollbar"
      >
        <div className="py-3 space-y-0.5 max-w-xl mx-auto">
          {entries.map((entry, i) => {
            const isLatest = i === entries.length - 1 && isSearching;
            const icon = activityIcon(entry.message);
            return (
              <div
                key={entry.id}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${
                  isLatest
                    ? 'bg-[#1ED4A7]/[0.04] dark:bg-[#1ED4A7]/[0.04]'
                    : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20'
                }`}
                style={{ animation: 'cfEntryIn 0.35s cubic-bezier(0.16,1,0.3,1) both' }}
              >
                <div className={`flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                  entry.type === 'success'
                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                    : entry.type === 'warn'
                    ? 'bg-amber-500/10 text-amber-500'
                    : isLatest
                    ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                    : 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600'
                }`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <p className={`text-[12.5px] leading-relaxed ${
                    isLatest
                      ? 'text-zinc-800 dark:text-zinc-100 font-medium'
                      : entry.type === 'success'
                      ? 'text-zinc-700 dark:text-zinc-300'
                      : entry.type === 'warn'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-zinc-500 dark:text-zinc-500'
                  }`}>
                    {entry.message}
                    {isLatest && (
                      <span
                        className="inline-block w-[2px] h-[13px] ml-1 align-middle rounded-full bg-[#1ED4A7]"
                        style={{ animation: 'cfCursorBlink 0.8s steps(2) infinite' }}
                      />
                    )}
                  </p>
                </div>
                <div className="flex-shrink-0 pt-1.5 flex items-center gap-1.5" />
              </div>
            );
          })}

          {/* Initial waiting */}
          {isSearching && entries.length === 0 && (
            <div className="flex items-center gap-3 px-3 py-6 justify-center">
              <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center animate-pulse">
                <Radar className="w-4 h-4 text-zinc-500" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">{t('creatorFinder.initializingAgent')}</p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{t('creatorFinder.connectingToServices')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 md:px-8 py-3 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
          {entries.length} {t('creatorFinder.operations')}
        </span>
        {isSearching && stepLabel && (
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-[#1ED4A7] animate-pulse" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[200px]">
              {stepLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Empty State
// ══════════════════════════════════════════════════════════════════════════

function CreatorEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-5 shadow-sm border border-zinc-200 dark:border-zinc-700">
          <Radar className="w-7 h-7 text-zinc-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-main)] mb-1">{t('creatorFinder.findCreators')}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
          {t('creatorFinder.emptyDesc')}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-6">
          {t('creatorFinder.emptyInstructions')}
        </p>
        <div className="flex items-center justify-center gap-4 text-[10px] text-zinc-400 dark:text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5" />
            <span>{t('creatorFinder.keywordsLabel')}</span>
          </div>
          <ChevronRight className="w-3 h-3 text-zinc-300 dark:text-zinc-700" />
          <div className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            <span>{t('creatorFinder.profilesLabel')}</span>
          </div>
          <ChevronRight className="w-3 h-3 text-zinc-300 dark:text-zinc-700" />
          <div className="flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5" />
            <span>{t('creatorFinder.emailsLabel')}</span>
          </div>
          <ChevronRight className="w-3 h-3 text-zinc-300 dark:text-zinc-700" />
          <div className="flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" />
            <span>{t('creatorFinder.crmLabel')}</span>
          </div>
        </div>
        {/* Platform logos */}
        <div className="flex items-center justify-center gap-3 mt-5">
          {(['youtube', 'instagram', 'tiktok', 'x'] as Platform[]).map(p => (
            <div key={p} className="w-8 h-8 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
              <PlatformIcon platform={p} className="w-4 h-4 text-zinc-400" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════

export function CreatorFinder({ onUpgrade }: CreatorFinderProps) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  
  // ── Input State ──
  const [keywordText, setKeywordText] = useState('');
  const [numPosts, setNumPosts] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set(['youtube']));

  // ── Run State ──
  const [currentRun, setCurrentRun] = useState<CreatorRun | null>(null);
  const [results, setResults] = useState<CreatorResult[]>([]);
  const [pastRuns, setPastRuns] = useState<CreatorRun[]>([]);
  const [dailyCount, setDailyCount] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(3);

  // ── UI State ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('email_found');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSavedRuns, setShowSavedRuns] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Activity log (agent feed) ──
  const [activityLog, setActivityLog] = useState<AgentEntry[]>([]);
  const activityIdRef = useRef(0);

  // ── Drip-feed state ──
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activityLogRef = useRef<AgentEntry[]>([]);

  function addActivity(message: string, type: AgentEntry['type'] = 'info') {
    setActivityLog(prev => {
      const next = [...prev, { id: ++activityIdRef.current, message, type, ts: Date.now() }];
      activityLogRef.current = next;
      return next;
    });
  }

  // ── Platform toggle ──
  const togglePlatform = (p: Platform) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(p)) {
        if (next.size > 1) next.delete(p); // Must keep at least one
      } else {
        next.add(p);
      }
      return next;
    });
  };

  // ── Restore cached results on mount ──
  useEffect(() => {
    const cached = loadFinderCache<{
      runId: string;
      run: CreatorRun;
      results: CreatorResult[];
      platforms: Platform[];
    }>(CACHE_KEYS.CREATOR_FINDER);
    if (cached && cached.results.length > 0) {
      setCurrentRun(cached.run);
      setResults(cached.results);
      setHasSearched(true);
      if (cached.platforms) setSelectedPlatforms(new Set(cached.platforms));
      console.log(`[CREATOR-FINDER] Restored ${cached.results.length} cached results from run ${cached.runId?.slice(0, 8)}`);
      // If the run was still in-progress, resume polling
      if (cached.run && cached.run.status !== 'completed' && cached.run.status !== 'failed') {
        setIsRunning(true);
        startPolling(cached.runId);
      }
    }
  }, []);

  // ── Persist results to cache whenever they change ──
  useEffect(() => {
    if (results.length > 0 && currentRun) {
      saveFinderCache(CACHE_KEYS.CREATOR_FINDER, {
        runId: currentRun.id,
        run: currentRun,
        results,
        platforms: [...selectedPlatforms],
      });
    }
  }, [results, currentRun]);

  // ── Load past runs on mount ──
  useEffect(() => { 
    if (!isDemoMode) {
      loadPastRuns(); 
    }
  }, [isDemoMode]);

  const loadPastRuns = async () => {
    if (isDemoMode) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE}/runs`, { headers });
      if (res.ok) {
        const data = await res.json();
        setPastRuns(data.runs || []);
        setDailyCount(data.dailyCount || 0);
        setDailyLimit(data.dailyLimit || 3);
      }
    } catch (err) {
      console.error('[CREATOR-FINDER] Failed to load runs:', err);
    }
  };

  // ── Poll for run updates ──
  const startPolling = useCallback((runId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let lastEnriched = 0;
    let lastDiscovered = 0;

    pollRef.current = setInterval(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${BASE}/runs/${runId}`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        setCurrentRun(data.run);

        const run = data.run as CreatorRun;
        if (run.total_profiles_discovered > 0 && run.total_profiles_discovered !== lastDiscovered) {
          if (lastDiscovered === 0) {
            const platformList = (run.platforms || ['youtube']).map(p => PLATFORM_CONFIG[p]?.label || p).join(', ');
            addActivity(t('creatorFinder.discoveredProfiles', { count: run.total_profiles_discovered, platforms: platformList }), 'success');
          }
          lastDiscovered = run.total_profiles_discovered;
        }
        if (run.profiles_enriched && run.profiles_enriched > lastEnriched) {
          const delta = run.profiles_enriched - lastEnriched;
          addActivity(t('creatorFinder.enrichedProfiles', { count: delta, enriched: run.profiles_enriched, total: run.total_profiles_discovered }), 'info');
          lastEnriched = run.profiles_enriched;
        }
        if (run.status_message && !activityLogRef.current.some(a => a.message === run.status_message)) {
          addActivity(run.status_message, 'info');
        }

        if (data.run.status === 'completed') {
          const newResults = data.results || [];
          addActivity(t('creatorFinder.discoveryComplete', { count: newResults.length }), 'success');
          const withEmail = newResults.filter((r: CreatorResult) => r.status === 'email_found').length;
          if (withEmail > 0) {
            addActivity(t('creatorFinder.creatorsWithVerifiedEmails', { count: withEmail }), 'success');
          }
          // Drip-feed results in
          setResults([]);
          const batchSize = 5;
          for (let i = 0; i < newResults.length; i += batchSize) {
            const batch = newResults.slice(i, i + batchSize);
            setTimeout(() => {
              setResults(prev => {
                const existingIds = new Set(prev.map(r => r.id));
                const unique = batch.filter((r: CreatorResult) => !existingIds.has(r.id));
                return [...prev, ...unique];
              });
              setFreshIds(prev => {
                const next = new Set(prev);
                batch.forEach((r: CreatorResult) => next.add(r.id));
                return next;
              });
              setTimeout(() => {
                setFreshIds(prev => {
                  const next = new Set(prev);
                  batch.forEach((r: CreatorResult) => next.delete(r.id));
                  return next;
                });
              }, 800);
            }, (i / batchSize) * 120);
          }
          setIsRunning(false);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadPastRuns();
          toast.success(t('creatorFinder.searchCompleteToast', { count: newResults.length }));
        } else if (data.run.status === 'failed') {
          addActivity(t('creatorFinder.searchFailedToast', { error: data.run.error_text || t('creatorFinder.unknownError') }), 'warn');
          setIsRunning(false);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadPastRuns();
          toast.error(t('creatorFinder.searchFailedToast', { error: data.run.error_text || t('creatorFinder.unknownError') }));
        }
      } catch (err) {
        console.error('[CREATOR-FINDER] Poll error:', err);
      }
    }, 2000);
  }, [t]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Parse keywords ──
  const parseKeywords = (): KeywordInput[] => {
    return keywordText.split('\n').map(l => l.trim()).filter(Boolean)
      .map(kw => ({ keyword: kw, num_of_posts: numPosts }));
  };

  // ── CSV upload handler ──
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const lines = text.split('\n').slice(1);
      const keywords: string[] = [];
      for (const line of lines) {
        const parts = line.split(',');
        const kw = parts[0]?.trim().replace(/^"|"$/g, '');
        if (kw) keywords.push(kw);
        const num = parseInt(parts[1]?.trim());
        if (!isNaN(num) && num > 0) setNumPosts(num);
      }
      if (keywords.length > 0) {
        setKeywordText(keywords.join('\n'));
        toast.success(t('creatorFinder.loadedKeywordsCSV', { count: keywords.length }));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Run search ──
  const handleRun = async () => {
    const keywords = parseKeywords();
    if (keywords.length === 0) { toast.error(t('creatorFinder.enterKeyword')); return; }
    if (keywords.length > 50) { toast.error(t('creatorFinder.maxKeywords')); return; }

    const platforms = [...selectedPlatforms];
    if (platforms.length === 0) { toast.error(t('creatorFinder.selectPlatform')); return; }

    // ── Demo Mode: Return mock results ──
    if (isDemoMode) {
      console.log('[CREATOR FINDER DEMO] Returning demo results');
      setIsRunning(true);
      setResults([]);
      setSelectedIds(new Set());
      setCurrentRun(null);
      setHasSearched(true);
      
      setTimeout(() => {
        const demoCreators = DEMO_CREATOR_RESULTS.filter(c => 
          platforms.includes(c.platform as Platform)
        ).map(c => ({
          id: c.id,
          run_id: 'demo-run',
          platform: c.platform,
          channel_name: c.channel_name,
          channel_handle: c.handle,
          subscriber_count: c.subscriber_count,
          video_count: c.video_count,
          avg_views: c.avg_views,
          email: c.email,
          keywords: keywords.slice(0, 2),
          verified: c.verified,
        }));
        
        setResults(demoCreators);
        setCurrentRun({
          id: 'demo-run',
          user_id: 'demo-user',
          platforms: platforms,
          provider: 'demo',
          status: 'completed',
          created_at: new Date().toISOString(),
          input_keywords: keywords.map(k => ({ keyword: k, num_of_posts: numPosts })),
          total_videos_found: demoCreators.length * 10,
          unique_channels_found: demoCreators.length,
          channels_with_emails: demoCreators.length,
          total_profiles_discovered: demoCreators.length,
          profiles_enriched: demoCreators.length,
        });
        setIsRunning(false);
        toast.success(t('creatorFinder.foundDemoCreators', { count: demoCreators.length }));
      }, 1200);
      return;
    }

    setIsRunning(true);
    setResults([]);
    setSelectedIds(new Set());
    setCurrentRun(null);
    setHasSearched(true);
    setActivityLog([]);
    clearFinderCache(CACHE_KEYS.CREATOR_FINDER);
    activityIdRef.current = 0;

    const platformLabels = platforms.map(p => PLATFORM_CONFIG[p].label).join(', ');
    addActivity(t('creatorFinder.startingSearch', { platforms: platformLabels, count: keywords.length }), 'info');
    addActivity(t('creatorFinder.upToResults', { count: numPosts }), 'info');

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE}/run`, {
        method: 'POST', headers,
        body: JSON.stringify({ keywords, platforms }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'DAILY_LIMIT_EXCEEDED') {
          addActivity(t('creatorFinder.dailyLimitMessage'), 'warn');
          toast.error(t('creatorFinder.dailyLimitReached'), {
            description: data.message, duration: 6000,
            action: onUpgrade ? { label: 'Upgrade', onClick: onUpgrade } : undefined,
          });
        } else {
          addActivity(data.error || t('creatorFinder.failedToStartSearch'), 'warn');
          toast.error(data.error || t('creatorFinder.failedToStartSearch'));
        }
        setIsRunning(false);
        return;
      }

      setDailyCount(prev => prev + 1);
      addActivity(t('creatorFinder.searchDispatched'), 'success');

      if (data.status === 'completed') {
        await loadRunResults(data.run_id);
        setIsRunning(false);
        loadPastRuns();
        addActivity(t('creatorFinder.searchCompletedInstantly'), 'success');
        toast.success(t('creatorFinder.searchComplete'));
      } else {
        startPolling(data.run_id);
      }
    } catch (err: any) {
      addActivity(t('creatorFinder.networkError'), 'warn');
      toast.error(t('creatorFinder.failedToStartSearch'));
      console.error('[CREATOR-FINDER] Run error:', err);
      setIsRunning(false);
    }
  };

  // ── Load past run results ──
  const loadRunResults = async (runId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE}/runs/${runId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCurrentRun(data.run);
        // Deduplicate results by id
        const rawResults = data.results || [];
        const seenIds = new Set<string>();
        const dedupedResults = rawResults.filter((r: CreatorResult) => {
          if (seenIds.has(r.id)) return false;
          seenIds.add(r.id);
          return true;
        });
        setResults(dedupedResults);
        setSelectedIds(new Set());
        setHasSearched(true);
        setShowSavedRuns(false);
        if (data.run.platforms) {
          setSelectedPlatforms(new Set(data.run.platforms));
        }
        if (data.run.status === 'running' || data.run.status?.startsWith('step_')) {
          setIsRunning(true);
          setActivityLog([]);
          activityIdRef.current = 0;
          addActivity('Resuming in-progress search…', 'info');
          startPolling(runId);
        }
      }
    } catch (err) { toast.error('Failed to load run'); }
  };

  // ── Import to CRM ──
  const handleImport = async () => {
    const selected = results.filter(r => selectedIds.has(r.id) && r.email_primary);
    if (selected.length === 0) { toast.error('Select results with emails to import'); return; }
    setImporting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE}/import-to-leads`, {
        method: 'POST', headers,
        body: JSON.stringify({ run_id: currentRun?.id, result_ids: selected.map(r => r.id) }),
      });
      const data = await res.json();
      if (res.ok && data.results) {
        const { saved, skipped } = data.results;
        toast.success(`Imported ${saved} leads to CRM${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}`);
        dispatchAppEvent({ type: 'leads:created', count: saved, meta: { source: 'creator-finder' } });
        apiCache.invalidate('crm:leads*');
        setSelectedIds(new Set());
      } else { toast.error(data.error || 'Import failed'); }
    } catch (err) { toast.error('Import failed'); }
    finally { setImporting(false); }
  };

  // ── Export CSV ──
  const handleExport = async () => {
    if (!currentRun) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE}/export-csv/${currentRun.id}`, { headers });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `creator-finder-${currentRun.id.slice(0, 8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('CSV exported');
      }
    } catch (err) { toast.error('Export failed'); }
  };

  // ── Copy email ──
  const copyEmail = (email: string, id: string) => {
    navigator.clipboard.writeText(email);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Selection ──
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Filtering ──
  const filteredResults = useMemo(() => {
    const seen = new Set<string>();
    return results.filter(r => {
      // Deduplicate by id to prevent React duplicate key warnings
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterPlatform !== 'all' && r.platform !== filterPlatform) return false;
      if (searchFilter) {
        const q = searchFilter.toLowerCase();
        return (
          (r.display_name || r.channel_name || '').toLowerCase().includes(q) ||
          (r.handle || '').toLowerCase().includes(q) ||
          r.keywords.some(k => k.toLowerCase().includes(q)) ||
          r.emails.some(e => e.toLowerCase().includes(q)) ||
          (r.profile_url || r.channel_url || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [results, filterStatus, filterPlatform, searchFilter]);

  const selectAllWithEmail = () => {
    setSelectedIds(new Set(filteredResults.filter(r => r.email_primary).map(r => r.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const emailCount = results.filter(r => r.status === 'email_found').length;
  const noEmailCount = results.filter(r => r.status === 'no_email').length;
  const phoneCount = results.filter(r => r.phone_numbers && r.phone_numbers.length > 0).length;
  const keywordCount = parseKeywords().length;

  // ── Platform stats ──
  const platformStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.platform] = (counts[r.platform] || 0) + 1;
    }
    return counts;
  }, [results]);

  // ── Enrichment source stats ──
  const sourceStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      if (r.email_sources) {
        for (const src of Object.values(r.email_sources)) {
          counts[src] = (counts[src] || 0) + 1;
        }
      }
    }
    return counts;
  }, [results]);

  // ── Progress percentage ──
  const getProgressPct = () => {
    if (!currentRun) return 0;
    const s = currentRun.status;
    if (s === 'queued') return 5;
    if (s === 'running' || s === 'step_videos' || s === 'step_discovery') return 15;
    if (s === 'step_channels') return 25;
    if (s === 'step_emails' || s === 'step_enrichment') {
      const enriched = currentRun.profiles_enriched || currentRun.channels_scraped || 0;
      const total = currentRun.total_profiles_discovered || currentRun.unique_channels_found || 1;
      return 30 + Math.round((enriched / total) * 60);
    }
    if (s === 'step_finalize') return 90;
    if (s === 'step_mx') return 92;
    if (s === 'completed') return 100;
    return 0;
  };

  // ── Step label ──
  const getStepLabel = () => {
    if (!currentRun) return '';
    const s = currentRun.status;
    if (s === 'queued') return t('creatorFinder.queued');
    if (s === 'running' || s === 'step_videos' || s === 'step_discovery') return t('creatorFinder.discoveringProfiles');
    if (s === 'step_channels') return t('creatorFinder.fetchingProfileDetails');
    if (s === 'step_emails' || s === 'step_enrichment') {
      const enriched = currentRun.profiles_enriched || currentRun.channels_scraped || 0;
      const total = currentRun.total_profiles_discovered || currentRun.unique_channels_found || 0;
      return t('creatorFinder.enrichingProfiles', { enriched, total });
    }
    if (s === 'step_mx') return t('creatorFinder.verifyingEmails');
    return '';
  };

  const progressPct = getProgressPct();
  const activePlatforms = [...selectedPlatforms];

  // Helper: clean creator name — strip platform boilerplate from scraped/discovery names
  const cleanName = (name: string): string => {
    if (!name) return '';
    let c = name
      .replace(/\s*[/|·•]\s*Posts?\s*$/i, '')
      .replace(/\s*[/|·•]\s*X\s*$/i, '')
      .replace(/\s*[/|·•-]\s*Twitter\s*$/i, '')
      .replace(/\s+on\s+X\s*$/i, '')
      .replace(/\s+on\s+Twitter\s*$/i, '')
      .replace(/\s*[|/·•-]\s*TikTok\s*$/i, '')
      .replace(/\s*[*·•|/]\s*Instagram\s+photos?\s+and\s+videos?\s*$/i, '')
      .replace(/\s*[|/·•-]\s*Instagram\s*$/i, '')
      .replace(/\s*[|/·•-]\s*YouTube\s*$/i, '')
      // Generic "| <suffix>" — strip if suffix contains known keywords
      .replace(/\s*[|/]\s*[^|/]{1,30}\s*$/, (match) => {
        const suffix = match.replace(/^\s*[|/]\s*/, '').trim().toLowerCase();
        const kw = ['posts', 'x', 'twitter', 'tiktok', 'instagram', 'youtube', 'reels', 'shorts', 'videos', 'photos', 'official', 'profile', 'creator', 'content'];
        return kw.some(w => suffix.includes(w)) ? '' : match;
      })
      .replace(/\s*\(@[^)]+\)/g, '')
      .replace(/\s+@\w+\s*$/, '')
      .replace(/\s*\.{2,}\s*$/, '')
      .replace(/\s*…\s*$/, '')
      .replace(/^["']+|["']+$/g, '')
      .replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return c || name;
  };

  // Helper: get name & profile URL for a result
  const getName = (r: CreatorResult) => cleanName(r.display_name || r.channel_name || 'Unknown');
  const getHandle = (r: CreatorResult) => r.handle || r.profile_url?.replace(/https?:\/\/[^/]+\//, '') || '';
  const getProfileUrl = (r: CreatorResult) => r.profile_url || r.channel_url || '';
  const getFollowers = (r: CreatorResult) => {
    const raw = r.followers_text || r.subscribers_text || '';
    // Treat "0", "0 subscribers", and empty as unknown
    if (!raw || raw === '0' || raw === '0 subscribers' || raw === '0 followers') return '—';
    return raw;
  };
  const getEngagement = (r: CreatorResult) => {
    if (r.engagement_rate != null && r.engagement_rate > 0) {
      return r.engagement_rate >= 10 ? `${Math.round(r.engagement_rate)}%` : `${r.engagement_rate}%`;
    }
    return null;
  };
  const getEngagementColor = (rate?: number) => {
    if (!rate) return '';
    if (rate >= 5) return 'text-[#1ED4A7]';
    if (rate >= 2) return 'text-emerald-500/70';
    if (rate >= 1) return 'text-amber-500';
    return 'text-zinc-400';
  };
  const getLinks = (r: CreatorResult) => r.external_links || r.links || [];

  // ══════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full bg-transparent p-4 md:p-6">
      <style>{creatorKeyframes}</style>

      {/* ── Streaming Progress Strip ── */}
      {isRunning && results.length > 0 && currentRun && (
        <div className="flex-shrink-0 mb-4 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border border-[var(--border-color)] rounded-xl overflow-hidden">
          <div className="h-1 bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-[#1ED4A7] to-[#17a882] transition-all duration-700 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="px-4 md:px-6 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1ED4A7]" />
              <span className="text-xs font-semibold text-[var(--text-main)]">{getStepLabel()}</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-400 tabular-nums">{progressPct}%</span>
          </div>
        </div>
      )}

      {/* ── Main Card ── */}
      <div className="flex-1 overflow-hidden flex min-h-0 rounded-2xl border border-[var(--border-color)] bg-white dark:bg-[#050505]/80 dark:backdrop-blur-xl shadow-sm">

        {/* ═══ Sidebar ═══ */}
        <div className={`flex-shrink-0 border-r border-[var(--border-color)] transition-all duration-300 flex flex-col ${sidebarCollapsed ? 'w-0 md:w-12' : 'w-full md:w-[300px]'} ${results.length > 0 && !sidebarCollapsed ? 'hidden md:flex' : ''}`}>
          {!sidebarCollapsed ? (
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar pb-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-white/10 flex items-center justify-center">
                    <Radar className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                  </div>
                  <h2 className="text-sm font-semibold text-[var(--text-main)]">{t('creatorFinder.title')}</h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setShowSavedRuns(!showSavedRuns); if (!showSavedRuns) loadPastRuns(); }}
                    className={`p-1.5 rounded-md transition-colors text-xs ${showSavedRuns ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' : 'text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title={t('creatorFinder.pastRuns')}
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors hidden md:flex"
                  >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                  </button>
                </div>
              </div>

              {/* Daily Quota */}
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--border-color)]">
                <Radar className="w-3 h-3 text-[#1ED4A7] flex-shrink-0" />
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span className="font-semibold text-[var(--text-main)]">{dailyCount}</span> / {dailyLimit} {t('creatorFinder.runsToday')}
                </span>
              </div>

              {/* Past Runs Panel */}
              {showSavedRuns && (
                <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 border-b border-[var(--border-color)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('creatorFinder.recentRuns')}</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                    {pastRuns.length === 0 ? (
                      <div className="p-3 text-xs text-zinc-400 text-center">{t('creatorFinder.noRunsYet')}</div>
                    ) : pastRuns.map((run) => (
                      <div
                        key={run.id}
                        className="px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer flex items-center gap-2 group transition-colors border-b border-[var(--border-color)] last:border-b-0"
                        onClick={() => loadRunResults(run.id)}
                      >
                        {run.status === 'completed' ? (
                          <CheckCircle className="w-3 h-3 text-[#1ED4A7] flex-shrink-0" />
                        ) : run.status === 'failed' ? (
                          <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                        ) : (
                          <Loader2 className="w-3 h-3 text-zinc-400 animate-spin flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-[var(--text-main)] truncate">
                            {run.input_keywords.map(k => k.keyword).join(', ')}
                          </div>
                          <div className="text-[10px] text-zinc-400 dark:text-zinc-600 flex items-center gap-1">
                            {(run.platforms || ['youtube']).map(p => (
                              <PlatformIcon key={p} platform={p} className="w-2.5 h-2.5 inline" />
                            ))}
                            <span>· {run.total_profiles_discovered || run.unique_channels_found} {t('creatorFinder.profilesCount')} · {run.channels_with_emails} {t('creatorFinder.emailsCount')}</span>
                          </div>
                        </div>
                        <ChevronRight className="w-3 h-3 text-zinc-300 dark:text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Platforms ── */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">{t('creatorFinder.platforms')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {(['youtube', 'instagram', 'tiktok', 'x'] as Platform[]).map(p => (
                    <button
                      key={p}
                      onClick={() => togglePlatform(p)}
                      disabled={isRunning}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                        selectedPlatforms.has(p)
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                          : 'bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border-[var(--border-color)] hover:border-zinc-400 dark:hover:border-zinc-600'
                      } disabled:opacity-40`}
                    >
                      <PlatformIcon platform={p} className="w-3 h-3" />
                      {p !== 'x' && PLATFORM_CONFIG[p].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Keywords Input ── */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">{t('creatorFinder.keywords')}</label>
                <textarea
                  value={keywordText}
                  onChange={e => setKeywordText(e.target.value)}
                  placeholder={t('creatorFinder.keywordsPlaceholder')}
                  rows={5}
                  className="w-full px-3 py-2 text-[12px] bg-zinc-50 dark:bg-zinc-900/50 border border-[var(--border-color)] rounded-lg outline-none resize-none font-mono text-[var(--text-main)] placeholder:text-zinc-400 dark:placeholder:text-zinc-600 transition-all"
                  disabled={isRunning}
                />
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] text-zinc-400">
                    <span className="font-semibold text-[var(--text-main)]">{keywordCount}</span>/50
                  </span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRunning}
                    className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-[var(--text-main)] transition-colors disabled:opacity-40"
                  >
                    <Upload className="w-3 h-3" />
                    CSV
                  </button>
                  <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
                </div>
              </div>

              {/* ── Results per keyword ── */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">{t('creatorFinder.resultsPerKeyword')}</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    value={numPosts}
                    onChange={e => setNumPosts(parseInt(e.target.value))}
                    min={10} max={200} step={10}
                    className="flex-1 accent-[#1ED4A7]"
                    disabled={isRunning}
                  />
                  <span className="text-[12px] font-mono text-[var(--text-main)] w-8 text-right tabular-nums">{numPosts}</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  {t('creatorFinder.higherMoreCreatorsSlower')}
                </p>
              </div>

              {/* ── Run Button ── */}
              <button
                onClick={handleRun}
                disabled={isRunning || keywordCount === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {isRunning ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('creatorFinder.running')}</>
                ) : (
                  <><Play className="w-3.5 h-3.5" /> {t('creatorFinder.runSearch')}</>
                )}
              </button>
            </div>
          ) : (
            /* Collapsed sidebar */
            <div className="flex flex-col items-center py-3 gap-3">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1.5 rounded-md text-zinc-400 hover:text-[var(--text-main)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Expand sidebar"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
              <div className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-white/10 flex items-center justify-center">
                <Radar className="w-3.5 h-3.5 text-zinc-500" />
              </div>
            </div>
          )}
        </div>

        {/* ═══ Content Area ═══ */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Desktop results toolbar */}
          {results.length > 0 && (
            <div className="flex-shrink-0 px-4 py-2.5 hidden md:flex flex-wrap items-center gap-3 border-b border-[var(--border-color)] bg-zinc-50/50 dark:bg-zinc-900/30">
              {/* Stats */}
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-zinc-500 dark:text-zinc-400">
                  <span className="font-semibold text-[var(--text-main)]">{results.length}</span> creators
                </span>
                <span className="text-[#1ED4A7]">
                  <span className="font-semibold">{emailCount}</span> with email
                </span>
                <span className="text-zinc-400 dark:text-zinc-600">
                  <span className="font-semibold">{noEmailCount}</span> no email
                </span>
                {phoneCount > 0 && (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    <span className="font-semibold">{phoneCount}</span> with phone
                  </span>
                )}
                {/* Platform breakdown */}
                {Object.keys(platformStats).length > 1 && (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-700">|</span>
                    {Object.entries(platformStats).map(([p, count]) => (
                      <span key={p} className="inline-flex items-center gap-0.5 text-zinc-400 dark:text-zinc-500 text-[10px]">
                        <PlatformIcon platform={p as Platform} className="w-2.5 h-2.5" />
                        <span className="font-semibold">{count}</span>
                      </span>
                    ))}
                  </>
                )}
                {Object.keys(sourceStats).length > 0 && (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-700">|</span>
                    {Object.entries(sourceStats).map(([src, count]) => {
                      const label = SOURCE_LABELS[src];
                      return label ? (
                        <span key={src} className="inline-flex items-center gap-0.5 text-zinc-400 dark:text-zinc-500 text-[10px]">
                          <span className="font-semibold">{count}</span> {label}
                        </span>
                      ) : null;
                    })}
                  </>
                )}
              </div>

              <div className="flex-1" />

              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3 h-3 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Filter…"
                    value={searchFilter}
                    onChange={e => setSearchFilter(e.target.value)}
                    className="w-28 pl-6.5 pr-2 py-1.5 text-[11px] bg-white dark:bg-zinc-900 border border-[var(--border-color)] rounded-lg outline-none text-[var(--text-main)] placeholder:text-zinc-400"
                    style={{ paddingLeft: '1.625rem' }}
                  />
                </div>
                {Object.keys(platformStats).length > 1 && (
                  <select
                    value={filterPlatform}
                    onChange={e => setFilterPlatform(e.target.value)}
                    className="px-2 py-1.5 text-[11px] bg-white dark:bg-zinc-900 border border-[var(--border-color)] rounded-lg outline-none text-[var(--text-main)]"
                  >
                    <option value="all">All Platforms</option>
                    {Object.keys(platformStats).map(p => (
                      <option key={p} value={p}>{PLATFORM_CONFIG[p as Platform]?.label || p}</option>
                    ))}
                  </select>
                )}
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="px-2 py-1.5 text-[11px] bg-white dark:bg-zinc-900 border border-[var(--border-color)] rounded-lg outline-none text-[var(--text-main)]"
                >
                  <option value="all">All</option>
                  <option value="email_found">With Email</option>
                  <option value="no_email">No Email</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 ? (
                  <>
                    <span className="text-[10px] text-zinc-500 font-medium">{selectedIds.size} selected</span>
                    <button onClick={clearSelection} className="text-[10px] text-zinc-400 hover:text-[var(--text-main)] transition-colors">Clear</button>
                    <button
                      onClick={handleImport}
                      disabled={importing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg disabled:opacity-50 transition-all shadow-sm bg-zinc-900 text-white border border-zinc-800 hover:bg-zinc-800 dark:!bg-white dark:!text-zinc-900 dark:!border-zinc-200 dark:hover:!bg-zinc-100"
                    >
                      {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                      Import to CRM
                    </button>
                  </>
                ) : (
                  <button onClick={selectAllWithEmail} className="text-[10px] text-zinc-400 hover:text-[var(--text-main)] transition-colors">
                    Select all with email
                  </button>
                )}
                <button
                  onClick={handleExport}
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  CSV
                </button>
              </div>
            </div>
          )}

          {/* Mobile compact stats bar */}
          {results.length > 0 && (
            <div className="md:hidden flex-shrink-0 px-4 py-2 flex items-center gap-2 border-b border-[var(--border-color)] bg-zinc-50/50 dark:bg-zinc-900/30">
              <div className="flex items-center gap-2.5 text-[11px] flex-1 min-w-0">
                <span className="text-zinc-500 dark:text-zinc-400 tabular-nums">
                  <span className="font-semibold text-[var(--text-main)]">{results.length}</span> creators
                </span>
                <span className="text-[#1ED4A7] tabular-nums">
                  <span className="font-semibold">{emailCount}</span> email{emailCount !== 1 ? 's' : ''}
                </span>
                {selectedIds.size > 0 && (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <span className="text-zinc-500 dark:text-zinc-400 font-medium tabular-nums">{selectedIds.size} sel</span>
                    <button onClick={clearSelection} className="text-[10px] text-zinc-400 underline underline-offset-2">clear</button>
                  </>
                )}
              </div>
              <div className="relative flex-shrink-0">
                <Search className="w-3 h-3 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter…"
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="w-24 pl-6 pr-2 py-1 text-[11px] bg-white dark:bg-zinc-900 border border-[var(--border-color)] rounded-lg outline-none text-[var(--text-main)] placeholder:text-zinc-400"
                />
              </div>
            </div>
          )}

          {/* Mobile filter chips */}
          {results.length > 0 && (
            <div className="md:hidden flex-shrink-0 flex items-center gap-1 px-4 py-1.5 border-b border-[var(--border-color)]">
              {(['all', 'email_found', 'no_email'] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => setFilterStatus(opt)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-full whitespace-nowrap transition-all ${
                    filterStatus === opt
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }`}
                >
                  {opt === 'all' ? 'All' : opt === 'email_found' ? `Email (${emailCount})` : 'No Email'}
                </button>
              ))}
              {/* Platform filter chips on mobile */}
              {Object.keys(platformStats).length > 1 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700 mx-0.5">|</span>
                  {Object.keys(platformStats).map(p => (
                    <button
                      key={p}
                      onClick={() => setFilterPlatform(filterPlatform === p ? 'all' : p)}
                      className={`px-2 py-1 text-[11px] font-medium rounded-full whitespace-nowrap transition-all ${
                        filterPlatform === p
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
                          : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      {PLATFORM_CONFIG[p as Platform]?.label || p}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── Main Content Area ── */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" style={{ overscrollBehavior: 'contain' }}>
            {/* Empty state */}
            {results.length === 0 && !isRunning && !hasSearched ? (
              <CreatorEmptyState />

            /* Agent feed */
            ) : results.length === 0 && isRunning ? (
              <CreatorAgentFeed
                entries={activityLog}
                isSearching={isRunning}
                currentRun={currentRun}
                pct={progressPct}
                stepLabel={getStepLabel()}
                activePlatforms={activePlatforms}
              />

            /* Failed state */
            ) : results.length === 0 && !isRunning && currentRun?.status === 'failed' ? (
              <div className="h-full flex flex-col items-center justify-center p-8">
                <div className="max-w-sm text-center">
                  <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/20 flex items-center justify-center mx-auto mb-4">
                    <XCircle className="w-6 h-6 text-red-400" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-[var(--text-main)] mb-1">Search failed</h3>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{currentRun.error_text || 'An unknown error occurred.'}</p>
                  <button
                    onClick={handleRun}
                    disabled={keywordCount === 0}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Retry Search
                  </button>
                </div>
              </div>

            /* No results after search */
            ) : results.length === 0 && !isRunning && hasSearched ? (
              <div className="h-full flex flex-col items-center justify-center p-8">
                <div className="max-w-sm text-center">
                  <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-4">
                    <Search className="w-5 h-5 text-zinc-400" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-[var(--text-main)] mb-1">No creators found</h3>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Try different keywords, platforms, or increase results per keyword.</p>
                </div>
              </div>

            /* Results table */
            ) : (
              <div className="min-w-0">
                {/* Compact agent strip while still searching */}
                {isRunning && activityLog.length > 0 && (
                  <div className="flex items-center gap-2.5 px-4 py-2 border-b border-[var(--border-color)] bg-zinc-50/60 dark:bg-zinc-900/30">
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] animate-pulse" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">Agent</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate block">
                        {activityLog[activityLog.length - 1]?.message}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums flex-shrink-0">
                      {results.length} found
                    </span>
                  </div>
                )}

                {/* Table header */}
                <div className="sticky top-0 z-10 bg-zinc-50/80 dark:bg-zinc-900/30 border-b border-[var(--border-color)] hidden md:grid md:grid-cols-[40px_36px_minmax(0,0.7fr)_minmax(0,1.1fr)_72px_minmax(0,1.1fr)_80px_50px_68px] items-center px-4 py-2 gap-1">
                  <div>
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === filteredResults.filter(r => r.email_primary).length}
                      onChange={(e) => e.target.checked ? selectAllWithEmail() : clearSelection()}
                      className="rounded border-zinc-300 dark:border-zinc-600"
                    />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Keyword</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Creator</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Followers</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Email</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Phone</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Links</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 text-right pr-1">Status</span>
                </div>

                {/* Rows */}
                {filteredResults.map(r => (
                  <div
                    key={r.id}
                    style={freshIds.has(r.id)
                      ? { animation: 'cfRowIn 0.35s cubic-bezier(0.16,1,0.3,1) both, cfRowHighlight 0.8s ease-out both' }
                      : undefined
                    }
                  >
                    {/* Desktop row */}
                    <div className={`hidden md:grid md:grid-cols-[40px_36px_minmax(0,0.7fr)_minmax(0,1.1fr)_72px_minmax(0,1.1fr)_80px_50px_68px] items-center px-4 py-2.5 gap-1 border-b border-[var(--border-color)] hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${selectedIds.has(r.id) ? 'bg-[#1ED4A7]/[0.04]' : ''}`}>
                      <div>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          disabled={!r.email_primary}
                          className="rounded border-zinc-300 dark:border-zinc-600 disabled:opacity-20"
                        />
                      </div>

                      {/* Platform icon */}
                      <div className="flex items-center justify-center">
                        <div className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center" title={PLATFORM_CONFIG[r.platform]?.label || r.platform}>
                          <PlatformIcon platform={r.platform} className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
                        </div>
                      </div>

                      {/* Keywords */}
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {r.keywords.slice(0, 2).map((kw, i) => (
                          <span key={i} className="inline-flex items-center text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded font-medium truncate max-w-[90px]">
                            {kw}
                          </span>
                        ))}
                        {r.keywords.length > 2 && <span className="text-[10px] text-zinc-400">+{r.keywords.length - 2}</span>}
                      </div>

                      {/* Creator name + handle */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-[var(--text-main)] truncate">
                            {getName(r)}
                          </div>
                          <button
                            onClick={() => window.open(getProfileUrl(r), '_blank')}
                            className="text-[10px] text-zinc-400 hover:text-[#1ED4A7] transition-colors truncate block max-w-full"
                          >
                            {getHandle(r)}
                          </button>
                        </div>
                      </div>

                      {/* Followers + Engagement */}
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <Users className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />
                          {getFollowers(r)}
                        </div>
                        {getEngagement(r) && (
                          <div className={`text-[9px] font-semibold ${getEngagementColor(r.engagement_rate)}`} title={r.posts_analyzed ? `Based on ${r.posts_analyzed} posts • Avg ${r.avg_likes?.toLocaleString()} likes, ${r.avg_comments?.toLocaleString()} comments` : 'Engagement rate'}>
                            {getEngagement(r)} eng
                          </div>
                        )}
                      </div>

                      {/* Email */}
                      <div className="min-w-0">
                        {r.emails.length > 0 ? (
                          <div className="space-y-1">
                            {r.emails.slice(0, 2).map((email, i) => {
                              const src = r.email_sources?.[email];
                              const srcLabel = src ? SOURCE_LABELS[src] : null;
                              return (
                                <div key={i} className="flex items-center gap-2 min-w-0 h-5 group/email">
                                  <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                                  <code className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate font-mono">{email}</code>
                                  {srcLabel && (
                                    <span className="text-[8px] font-medium text-zinc-400 dark:text-zinc-500 flex-shrink-0 hidden lg:inline">
                                      {srcLabel}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => copyEmail(email, `${r.id}-${i}`)}
                                    className="p-0.5 text-zinc-400 hover:text-[var(--text-main)] rounded transition-colors opacity-0 group-hover/email:opacity-100 flex-shrink-0"
                                    title="Copy email"
                                  >
                                    {copiedId === `${r.id}-${i}` ? (
                                      <Check className="w-3 h-3 text-[#1ED4A7]" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                            {r.emails.length > 2 && <span className="text-[10px] text-zinc-400 pl-[1.375rem]">+{r.emails.length - 2}</span>}
                          </div>
                        ) : (
                          <span className="text-[11px] text-zinc-300 dark:text-zinc-700">—</span>
                        )}
                      </div>

                      {/* Phone */}
                      <div className="min-w-0">
                        {r.phone_numbers && r.phone_numbers.length > 0 ? (
                          <div className="flex items-center gap-1.5 min-w-0 group/phone">
                            <Phone className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                            <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">{r.phone_numbers[0]}</span>
                            <button
                              onClick={() => { navigator.clipboard.writeText(r.phone_numbers![0]); setCopiedId(`${r.id}-ph`); setTimeout(() => setCopiedId(null), 2000); }}
                              className="p-0.5 text-zinc-400 hover:text-[var(--text-main)] rounded transition-colors opacity-0 group-hover/phone:opacity-100 flex-shrink-0"
                              title="Copy phone"
                            >
                              {copiedId === `${r.id}-ph` ? <Check className="w-3 h-3 text-[#1ED4A7]" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-zinc-300 dark:text-zinc-700">—</span>
                        )}
                      </div>

                      {/* Links */}
                      <div>
                        {getLinks(r).length > 0 ? (
                          <button
                            onClick={() => {
                              const nonSocial = getLinks(r).find(l =>
                                !l.includes('youtube') && !l.includes('instagram') &&
                                !l.includes('tiktok') && !l.includes('x.com') && !l.includes('twitter')
                              );
                              if (nonSocial) window.open(nonSocial, '_blank');
                            }}
                            className="text-[10px] text-zinc-500 hover:text-[#1ED4A7] transition-colors flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {getLinks(r).length}
                          </button>
                        ) : (
                          <span className="text-[11px] text-zinc-300 dark:text-zinc-700">—</span>
                        )}
                      </div>

                      {/* Status + Verification */}
                      <div className="text-right space-y-0.5">
                        {r.status === 'email_found' && (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#1ED4A7] bg-[#1ED4A7]/10 px-2 py-0.5 rounded-full">
                              <Mail className="w-2.5 h-2.5" /> Found
                            </span>
                            {r.email_verification && (
                              <span className={`inline-flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider px-1.5 py-px rounded-full ${
                                r.email_verification.status === 'valid'
                                  ? 'text-[#1ED4A7] bg-[#1ED4A7]/10'
                                  : r.email_verification.status === 'risky'
                                  ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/20'
                                  : 'text-zinc-400 bg-zinc-100 dark:bg-zinc-800'
                              }`}>
                                {r.email_verification.status === 'valid' && <ShieldCheck className="w-2 h-2" />}
                                {r.email_verification.status === 'valid' ? 'Verified' : r.email_verification.status === 'risky' ? 'Risky' : `${r.email_verification.score}%`}
                              </span>
                            )}
                            {!r.email_verification && r.enrichment_sources && r.enrichment_sources.length > 1 && (
                              <span className="text-[8px] text-zinc-400">{r.enrichment_sources.length} sources</span>
                            )}
                          </div>
                        )}
                        {r.status === 'no_email' && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                            None
                          </span>
                        )}
                        {r.status === 'error' && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-red-400 bg-red-50 dark:bg-red-950/20 px-2 py-0.5 rounded-full">
                            Error
                          </span>
                        )}
                        {r.status === 'suppressed' && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-500 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded-full">
                            Suppressed
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mobile card */}
                    <div className={`md:hidden px-4 py-2.5 border-b border-[var(--border-color)] ${selectedIds.has(r.id) ? 'bg-[#1ED4A7]/[0.04]' : ''}`}>
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          disabled={!r.email_primary}
                          className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 disabled:opacity-20 flex-shrink-0"
                        />
                        <div className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                          <PlatformIcon platform={r.platform} className="w-3 h-[9px]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-medium text-[var(--text-main)] truncate">{getName(r)}</span>
                            {r.status === 'email_found' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] flex-shrink-0" />
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight flex items-center gap-1">
                            <span>{getHandle(r)}</span>
                            <span className="text-zinc-300 dark:text-zinc-700">·</span>
                            <span>{getFollowers(r)}</span>
                            {getEngagement(r) && (
                              <>
                                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                                <span className={`font-semibold ${getEngagementColor(r.engagement_rate)}`}>{getEngagement(r)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {r.emails.length > 0 && (
                        <div className="mt-1.5 ml-[3.25rem] flex items-center gap-1.5 min-w-0">
                          <Mail className="w-3 h-3 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">{r.emails[0]}</span>
                          {r.email_verification && r.email_verification.status === 'valid' && (
                            <ShieldCheck className="w-3 h-3 text-[#1ED4A7] flex-shrink-0" />
                          )}
                          {r.email_verification && r.email_verification.status === 'risky' && (
                            <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                          )}
                          <button onClick={() => copyEmail(r.emails[0], `${r.id}-m`)} className="flex-shrink-0 ml-auto">
                            {copiedId === `${r.id}-m` ? <Check className="w-3 h-3 text-[#1ED4A7]" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                          </button>
                        </div>
                      )}
                      {r.phone_numbers && r.phone_numbers.length > 0 && (
                        <div className="mt-1 ml-[3.25rem] flex items-center gap-1.5 min-w-0">
                          <Phone className="w-3 h-3 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">{r.phone_numbers[0]}</span>
                          <button onClick={() => { navigator.clipboard.writeText(r.phone_numbers![0]); setCopiedId(`${r.id}-mph`); setTimeout(() => setCopiedId(null), 2000); }} className="flex-shrink-0 ml-auto">
                            {copiedId === `${r.id}-mph` ? <Check className="w-3 h-3 text-[#1ED4A7]" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Loading more while searching */}
                {isRunning && results.length > 0 && (
                  <div className="flex items-center justify-center gap-2 py-4 border-t border-[var(--border-color)]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#1ED4A7]" />
                    <span className="text-xs text-zinc-500">Loading more creators…</span>
                  </div>
                )}

                {/* Filter empty */}
                {filteredResults.length === 0 && results.length > 0 && (
                  <div className="px-4 py-10 text-center text-[12px] text-zinc-400">
                    No results match your filter
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile bottom bar */}
          {results.length > 0 && (
            <div className="md:hidden flex-shrink-0 border-t border-[var(--border-color)] bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl px-4 py-2.5 pb-[max(0.625rem,calc(0.625rem+env(safe-area-inset-bottom,0px)))]">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExport}
                  className="flex items-center justify-center w-10 h-10 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all flex-shrink-0"
                >
                  <Download className="w-4 h-4" />
                </button>
                {selectedIds.size > 0 ? (
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="flex-1 flex items-center justify-center gap-2 h-10 bg-zinc-900 text-white dark:bg-white dark:text-black text-[13px] font-semibold rounded-xl disabled:opacity-50 shadow-sm transition-colors active:scale-[0.98]"
                  >
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Import ({selectedIds.size})
                  </button>
                ) : (
                  <button
                    onClick={selectAllWithEmail}
                    className="flex-1 flex items-center justify-center gap-2 h-10 bg-zinc-900 text-white dark:bg-white dark:text-black text-[13px] font-semibold rounded-xl shadow-sm transition-colors active:scale-[0.98]"
                  >
                    <Mail className="w-4 h-4" />
                    Select All with Email
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CreatorFinder;
