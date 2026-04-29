/**
 * Social Hub — Combined Social Tracker + Social Publisher.
 * Tracker: Track public social media profiles (YouTube, TikTok, Instagram, LinkedIn, Facebook).
 * Publisher: OAuth-connected social media posting (LinkedIn, Facebook, Instagram).
 *
 * IMPORTANT: No lazy loading inside this component. SocialPublisher is imported directly.
 * No recharts — uses pure SVG chart to avoid module import issues with recharts in this chunk.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  BarChart3, Send, Plus, Trash2, RefreshCw, Loader2, X as XMark, ExternalLink,
  Users, Eye, Heart, MessageCircle, Share2, TrendingUp, TrendingDown,
  Globe, Link2, Search, AlertTriangle, ChevronLeft, ChevronDown, FileText, Smartphone, Monitor, Tablet,
  Target, Shield, Swords
} from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { apiCache } from '../lib/api-cache';
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './LoadingSpinner';
import { SocialPublisher } from './SocialPublisher';
import { CompetitiveReport } from './CompetitiveReport';
import YouTubeLogo from '../imports/svg-youtube-logo';
import InstagramLogo from '../imports/svg-instagram-logo';
import LinkedInLogo from '../imports/svg-linkedin-logo';
import FacebookLogo from '../imports/svg-facebook-logo';
import TikTokIcon from '../imports/svg-tiktok-icon';
import TwitterLogo from '../imports/svg-twitter-logo';

// ─── Types ───────────────────────────────────────────────────────────

type TrackPlatform = 'youtube' | 'tiktok' | 'instagram' | 'linkedin' | 'facebook' | 'twitter';

interface MetricSnapshot {
  followers: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  posts: number;
  engagementRate?: number;
  timestamp: string;
}

interface TrackedAccount {
  id: string;
  userId: string;
  platform: TrackPlatform;
  handle: string;
  url: string;
  displayName?: string;
  avatarUrl?: string;
  latestMetrics?: MetricSnapshot;
  profileType?: 'own' | 'competitor';
  addedAt: string;
  lastSyncedAt?: string;
  syncError?: string;
}

const TRACKER_API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/social-tracker`;

// ─── Platform Config ─────────────────────────────────────────────────

const PLATFORM_CONFIG: Record<TrackPlatform, { label: string; color: string; icon: string }> = {
  youtube: { label: 'YouTube', color: '#FF0000', icon: '▶' },
  tiktok: { label: 'TikTok', color: '#00F2EA', icon: '♪' },
  instagram: { label: 'Instagram', color: '#E4405F', icon: '📷' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', icon: 'in' },
  facebook: { label: 'Facebook', color: '#0866FF', icon: 'f' },
  twitter: { label: 'X', color: '#000000', icon: '𝕏' },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function compactNum(n: number): string {
  if (n >= 1_000_000_000) {
    const val = n / 1_000_000_000;
    return val % 1 === 0 ? `${val}B` : `${val.toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return val % 1 === 0 ? `${val}M` : `${val.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return val % 1 === 0 ? `${val}K` : `${val.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(n);
}

function relTime(iso?: string, t?: (key: string, opts?: any) => string): string {
  if (!iso) return t ? t('socialHub.time.never') : 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t ? t('socialHub.time.justNow') : 'just now';
  if (mins < 60) return t ? t('socialHub.time.mAgo', { count: mins }) : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t ? t('socialHub.time.hAgo', { count: hrs }) : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return t ? t('socialHub.time.dAgo', { count: days }) : `${days}d ago`;
}

function PlatformBadge({ platform, size = 'md' }: { platform: TrackPlatform; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const iconClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';
  return (
    <div
      className={`${sizeClass} rounded-lg flex items-center justify-center shrink-0 bg-zinc-200 dark:bg-zinc-800`}
    >
      {platform === 'youtube' && <YouTubeLogo className={iconClass} />}
      {platform === 'instagram' && <InstagramLogo className={iconClass} />}
      {platform === 'linkedin' && <LinkedInLogo className={`${iconClass} text-[#0A66C2]`} />}
      {platform === 'facebook' && <FacebookLogo className={iconClass} />}
      {platform === 'tiktok' && <TikTokIcon className={iconClass} />}
      {platform === 'twitter' && <TwitterLogo className={`${iconClass} text-black dark:text-white`} />}
    </div>
  );
}

function PlatformIcon({ platform, className = 'w-3.5 h-3.5' }: { platform: TrackPlatform; className?: string }) {
  switch (platform) {
    case 'youtube': return <YouTubeLogo className={className} />;
    case 'instagram': return <InstagramLogo className={className} />;
    case 'linkedin': return <LinkedInLogo className={`${className} text-[#0A66C2]`} />;
    case 'facebook': return <FacebookLogo className={className} />;
    case 'tiktok': return <TikTokIcon className={className} />;
    case 'twitter': return <TwitterLogo className={`${className} text-black dark:text-white`} />;
  }
}

// ─── Metric Card ─────────────────────────────────────────────────────

function MetricCard({ label, value, icon: Icon, dimmed }: {
  label: string;
  value: number;
  icon: any;
  dimmed?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
      dimmed ? 'bg-white/[0.01] border-white/[0.02]' : 'bg-white/[0.03] border-white/[0.04]'
    }`}>
      <Icon className={`w-3 h-3 shrink-0 ${dimmed ? 'text-zinc-700' : 'text-zinc-500'}`} />
      <div className="min-w-0">
        <div className={`text-[10px] leading-tight ${dimmed ? 'text-zinc-700' : 'text-zinc-500'}`}>{label}</div>
        <div className={`text-xs font-semibold leading-tight ${dimmed ? 'text-zinc-400 dark:text-zinc-700' : 'text-zinc-900 dark:text-white'}`}>
          {dimmed ? '—' : compactNum(value)}
        </div>
      </div>
    </div>
  );
}

// ─── Platform metric availability ────────────────────────────────────
// Defines which metrics each platform CAN provide (even if current data is 0)
const PLATFORM_METRICS: Record<TrackPlatform, string[]> = {
  youtube: ['followers', 'views', 'posts'],
  tiktok: ['followers', 'likes', 'views', 'posts'],
  instagram: ['followers', 'posts', 'likes', 'views'],
  linkedin: ['followers', 'posts', 'views'],
  facebook: ['followers', 'likes', 'posts', 'views'],
  twitter: ['followers', 'posts', 'likes'],
};

const METRIC_ICONS: Record<string, any> = {
  followers: Users,
  views: Eye,
  likes: Heart,
  posts: BarChart3,
  comments: MessageCircle,
  shares: Share2,
};

const METRIC_LABELS: Record<string, string> = {
  followers: 'Followers',
  views: 'Views',
  likes: 'Likes',
  posts: 'Posts',
  comments: 'Comments',
  shares: 'Shares',
};

// ─── Tracked Account Card ────────────────────────────────────────────

function TrackedAccountCard({ account, onSync, onRemove, onClick, syncing, removing }: {
  account: TrackedAccount;
  onSync: () => void;
  onRemove: () => void;
  onClick: () => void;
  syncing: boolean;
  removing: boolean;
}) {
  const { t } = useTranslation();
  const cfg = PLATFORM_CONFIG[account.platform];
  const m = account.latestMetrics;
  const isCompetitor = account.profileType === 'competitor';

  return (
    <div
      className={`rounded-xl border overflow-hidden group cursor-pointer transition-colors ${
        isCompetitor
          ? 'border-rose-500/20 dark:border-rose-500/15 bg-white dark:bg-[#0A0A0A] hover:border-rose-500/30 dark:hover:border-rose-500/25'
          : 'border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] hover:border-zinc-300 dark:hover:border-white/[0.12]'
      }`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="p-3 sm:p-4">
        <div className="flex items-start gap-2.5 sm:gap-3">
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt=""
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg object-cover shrink-0 ring-1 ring-white/5"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <PlatformBadge platform={account.platform} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                {account.displayName || account.handle}
              </span>
              {isCompetitor && (
                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-500 border border-rose-500/20">
                  <Swords className="w-2.5 h-2.5" />
                  {t('socialHub.trackerView.competitor', 'Competitor')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
              <PlatformIcon platform={account.platform} className="w-3 h-3 shrink-0" />
              <span style={cfg.color === '#000000' ? undefined : { color: cfg.color }} className={cfg.color === '#000000' ? 'text-black dark:text-white' : ''}>{cfg.label}</span>
              <span className="text-zinc-600">@{account.handle}</span>
            </div>
            {account.lastSyncedAt && (
              <div className="text-[9px] text-zinc-600 mt-0.5">
                {t('socialHub.trackerView.synced', { time: relTime(account.lastSyncedAt, t) })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onSync(); }}
              disabled={syncing}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-[#1ED4A7] hover:bg-[#1ED4A7]/10 transition-colors disabled:opacity-40 touch-manipulation"
              title={t('socialHub.trackerView.syncMetrics')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              disabled={removing}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 touch-manipulation"
              title={t('socialHub.trackerView.remove')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Sync error */}
        {account.syncError && (
          <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/10 rounded-lg px-2.5 py-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{account.syncError}</span>
          </div>
        )}

        {/* Metrics grid */}
        {m && (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {PLATFORM_METRICS[account.platform].map(metricKey => {
              const val = (m as any)[metricKey] || 0;
              return (
                <MetricCard
                  key={metricKey}
                  label={t(`socialHub.metrics.${metricKey}` as any)}
                  value={val}
                  icon={METRIC_ICONS[metricKey]}
                  dimmed={val === 0}
                />
              );
            })}
          </div>
        )}

        {/* No metrics yet */}
        {!m && !account.syncError && (
          <div className="mt-3 text-center py-3">
            <p className="text-[11px] text-zinc-600">{t('socialHub.trackerView.noMetricsYet')}</p>
            <button
              onClick={onSync}
              disabled={syncing}
              className="mt-1.5 inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-medium text-[#1ED4A7] hover:bg-[#1ED4A7]/10 transition-colors disabled:opacity-40"
            >
              {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {t('socialHub.trackerView.syncNow')}
            </button>
          </div>
        )}
      </div>

      {/* Footer link */}
      <div className="px-3 sm:px-4 py-2 border-t border-zinc-200 dark:border-white/[0.04] bg-zinc-50 dark:bg-[#080808] flex items-center justify-between">
        <a
          href={account.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          {t('socialHub.trackerView.viewProfile')}
        </a>
        <span className="text-[10px] text-zinc-700 group-hover:text-zinc-500 transition-colors">
          {t('socialHub.trackerView.clickForDetails')}
        </span>
      </div>
    </div>
  );
}

// ─── Add Profile Modal ───────────────────────────────────────────────

function AddProfileModal({ onClose, onAdd, adding }: {
  onClose: () => void;
  onAdd: (url: string, profileType: 'own' | 'competitor') => void;
  adding: boolean;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [profileType, setProfileType] = useState<'own' | 'competitor'>('own');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onAdd(url.trim(), profileType);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 dark:bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#111] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-white/[0.06]">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{t('socialHub.addModal.title')}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
            <XMark className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t('socialHub.addModal.profileUrl')}</label>
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('socialHub.addModal.placeholder')}
              title=""
              className="w-full bg-zinc-50 dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-teal-500/30 dark:focus:border-[#1ED4A7]/30"
            />
          </div>
          {/* Profile Type Selector */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t('socialHub.addModal.profileType', 'Profile Type')}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProfileType('own')}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                  profileType === 'own'
                    ? 'border-[#1ED4A7]/40 bg-[#1ED4A7]/5 ring-1 ring-[#1ED4A7]/20'
                    : 'border-zinc-200 dark:border-white/[0.06] hover:border-zinc-300 dark:hover:border-white/[0.1]'
                }`}
              >
                <Shield className={`w-4 h-4 shrink-0 ${profileType === 'own' ? 'text-[#1ED4A7]' : 'text-zinc-400'}`} />
                <div>
                  <div className={`text-xs font-semibold ${profileType === 'own' ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}>{t('socialHub.addModal.yourBrand', 'Your Brand')}</div>
                  <div className="text-[9px] text-zinc-500">{t('socialHub.addModal.yourBrandDesc', 'Track your own growth')}</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setProfileType('competitor')}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                  profileType === 'competitor'
                    ? 'border-rose-500/40 bg-rose-500/5 ring-1 ring-rose-500/20'
                    : 'border-zinc-200 dark:border-white/[0.06] hover:border-zinc-300 dark:hover:border-white/[0.1]'
                }`}
              >
                <Swords className={`w-4 h-4 shrink-0 ${profileType === 'competitor' ? 'text-rose-500' : 'text-zinc-400'}`} />
                <div>
                  <div className={`text-xs font-semibold ${profileType === 'competitor' ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}>{t('socialHub.addModal.competitor', 'Competitor')}</div>
                  <div className="text-[9px] text-zinc-500">{t('socialHub.addModal.competitorDesc', 'Monitor their metrics')}</div>
                </div>
              </button>
            </div>
          </div>

          <div className="text-[10px] text-zinc-500 dark:text-zinc-600 space-y-1.5">
            <p className="font-medium text-zinc-600 dark:text-zinc-500">{t('socialHub.addModal.supportedPlatforms')}</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                { key: 'youtube', Logo: YouTubeLogo, label: 'YouTube', extraClass: '' },
                { key: 'tiktok', Logo: TikTokIcon, label: 'TikTok', extraClass: '' },
                { key: 'instagram', Logo: InstagramLogo, label: 'Instagram', extraClass: '' },
                { key: 'linkedin', Logo: LinkedInLogo, label: 'LinkedIn', extraClass: 'text-[#0A66C2]' },
                { key: 'facebook', Logo: FacebookLogo, label: 'Facebook', extraClass: 'text-[#1877F2]' },
                { key: 'twitter', Logo: TwitterLogo, label: 'X', extraClass: 'text-black dark:text-white' },
              ] as const).map(({ key, Logo, label, extraClass }) => (
                <span key={key} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.06]">
                  <Logo className={`w-3.5 h-3.5 ${extraClass}`} />
                  <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white border border-zinc-200 hover:border-zinc-300 dark:border-white/[0.06] dark:hover:border-white/[0.12] transition-colors"
            >
              {t('socialHub.addModal.cancel')}
            </button>
            <button
              type="submit"
              disabled={adding || !url.trim()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {t('socialHub.addModal.trackProfile')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Account Detail Panel with Charts ────────────────────────────────

// Pure SVG area chart — no recharts dependency
function SimpleSvgChart({ data, color, gradientId }: {
  data: { date: string; value: number }[];
  color: string;
  gradientId: string;
}) {
  const W = 600;
  const H = 260;
  const PAD_L = 55;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 30;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const minVal = Math.min(...data.map(d => d.value));
  const range = maxVal - minVal || 1;

  const points = data.map((d, i) => ({
    x: PAD_L + (i / (data.length - 1)) * chartW,
    y: PAD_T + chartH - ((d.value - minVal) / range) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${PAD_T + chartH} L ${points[0].x} ${PAD_T + chartH} Z`;

  // Y-axis ticks (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = minVal + (range * (4 - i)) / 4;
    return { y: PAD_T + (i / 4) * chartH, label: compactNum(Math.round(val)) };
  });

  // X-axis labels (show ~6 evenly spaced)
  const xStep = Math.max(1, Math.floor(data.length / 6));
  const xLabels = data.filter((_, i) => i % xStep === 0 || i === data.length - 1);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <div className="h-[260px] sm:h-[300px] relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line key={`g${i}`} x1={PAD_L} y1={t.y} x2={W - PAD_R} y2={t.y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text key={`y${i}`} x={PAD_L - 8} y={t.y + 4} fill="#52525b" fontSize={10} textAnchor="end" fontFamily="system-ui">{t.label}</text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((d, i) => {
          const idx = data.indexOf(d);
          const x = PAD_L + (idx / (data.length - 1)) * chartW;
          return (
            <text key={`x${i}`} x={x} y={H - 5} fill="#52525b" fontSize={10} textAnchor="middle" fontFamily="system-ui">{d.date}</text>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover hit areas */}
        {points.map((p, i) => (
          <rect
            key={`h${i}`}
            x={p.x - chartW / data.length / 2}
            y={PAD_T}
            width={chartW / data.length}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}

        {/* Dots */}
        {points.map((p, i) => (
          <circle
            key={`d${i}`}
            cx={p.x}
            cy={p.y}
            r={hoverIdx === i ? 5 : 0}
            fill={color}
            stroke="#09090b"
            strokeWidth={2}
          />
        ))}

        {/* Tooltip */}
        {hoverIdx !== null && (() => {
          const p = points[hoverIdx];
          const d = data[hoverIdx];
          const tooltipW = 100;
          const tx = Math.min(Math.max(p.x - tooltipW / 2, 5), W - tooltipW - 5);
          const ty = p.y - 45;
          return (
            <g>
              <line x1={p.x} y1={PAD_T} x2={p.x} y2={PAD_T + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} strokeDasharray="3 3" />
              <rect x={tx} y={ty} width={tooltipW} height={36} rx={8} fill="#18181b" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <text x={tx + tooltipW / 2} y={ty + 14} fill="#71717a" fontSize={9} textAnchor="middle" fontFamily="system-ui">{d.date}</text>
              <text x={tx + tooltipW / 2} y={ty + 28} fill="#fff" fontSize={12} fontWeight="bold" textAnchor="middle" fontFamily="system-ui">{compactNum(d.value)}</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ─── Dual SVG Chart for Compare View ─────────────────────────────────

function DualSvgChart({ dataA, dataB, colorA, colorB, labelA, labelB, gradientId }: {
  dataA: { date: string; value: number }[];
  dataB: { date: string; value: number }[];
  colorA: string;
  colorB: string;
  labelA: string;
  labelB: string;
  gradientId: string;
}) {
  const W = 600;
  const H = 280;
  const PAD_L = 55;
  const PAD_R = 10;
  const PAD_T = 30;
  const PAD_B = 30;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const allValues = [...dataA.map(d => d.value), ...dataB.map(d => d.value)];
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues);
  const range = maxVal - minVal || 1;

  const toPoints = (data: { date: string; value: number }[]) =>
    data.map((d, i) => ({
      x: PAD_L + (i / Math.max(data.length - 1, 1)) * chartW,
      y: PAD_T + chartH - ((d.value - minVal) / range) * chartH,
    }));

  const pointsA = toPoints(dataA);
  const pointsB = toPoints(dataB);

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = minVal + (range * (4 - i)) / 4;
    return { y: PAD_T + (i / 4) * chartH, label: compactNum(Math.round(val)) };
  });

  const xStep = Math.max(1, Math.floor(Math.max(dataA.length, dataB.length) / 6));
  const xData = dataA.length >= dataB.length ? dataA : dataB;
  const xLabels = xData.filter((_, i) => i % xStep === 0 || i === xData.length - 1);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <div className="h-[280px] sm:h-[320px] relative">
      {/* Legend */}
      <div className="absolute top-0 right-0 flex items-center gap-4 text-[10px] z-10">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-[2px] rounded-full" style={{ backgroundColor: colorA }} />
          <span className="text-zinc-500">{labelA}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-[2px] rounded-full" style={{ backgroundColor: colorB }} />
          <span className="text-zinc-500">{labelB}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`${gradientId}_a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorA} stopOpacity={0.15} />
            <stop offset="100%" stopColor={colorA} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${gradientId}_b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorB} stopOpacity={0.10} />
            <stop offset="100%" stopColor={colorB} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map((tick, i) => (
          <line key={`g${i}`} x1={PAD_L} y1={tick.y} x2={W - PAD_R} y2={tick.y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        ))}
        {yTicks.map((tick, i) => (
          <text key={`y${i}`} x={PAD_L - 8} y={tick.y + 4} fill="#52525b" fontSize={10} textAnchor="end" fontFamily="system-ui">{tick.label}</text>
        ))}
        {xLabels.map((d, i) => {
          const idx = xData.indexOf(d);
          const x = PAD_L + (idx / Math.max(xData.length - 1, 1)) * chartW;
          return <text key={`x${i}`} x={x} y={H - 5} fill="#52525b" fontSize={10} textAnchor="middle" fontFamily="system-ui">{d.date}</text>;
        })}

        {/* Area fills */}
        {pointsA.length > 1 && (
          <path d={`${toPath(pointsA)} L ${pointsA[pointsA.length-1].x} ${PAD_T+chartH} L ${pointsA[0].x} ${PAD_T+chartH} Z`} fill={`url(#${gradientId}_a)`} />
        )}
        {pointsB.length > 1 && (
          <path d={`${toPath(pointsB)} L ${pointsB[pointsB.length-1].x} ${PAD_T+chartH} L ${pointsB[0].x} ${PAD_T+chartH} Z`} fill={`url(#${gradientId}_b)`} />
        )}

        {/* Lines */}
        {pointsA.length > 1 && <path d={toPath(pointsA)} fill="none" stroke={colorA} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
        {pointsB.length > 1 && <path d={toPath(pointsB)} fill="none" stroke={colorB} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 3" />}

        {/* Hover areas */}
        {pointsA.map((p, i) => (
          <rect key={`h${i}`} x={p.x - chartW / Math.max(pointsA.length, 1) / 2} y={PAD_T} width={chartW / Math.max(pointsA.length, 1)} height={chartH} fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
        ))}

        {/* Dots on hover */}
        {hoverIdx !== null && pointsA[hoverIdx] && (
          <>
            <circle cx={pointsA[hoverIdx].x} cy={pointsA[hoverIdx].y} r={4} fill={colorA} stroke="#09090b" strokeWidth={2} />
            {pointsB[hoverIdx] && <circle cx={pointsB[hoverIdx].x} cy={pointsB[hoverIdx].y} r={4} fill={colorB} stroke="#09090b" strokeWidth={2} />}
            <line x1={pointsA[hoverIdx].x} y1={PAD_T} x2={pointsA[hoverIdx].x} y2={PAD_T + chartH} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="3 3" />
            {/* Tooltip */}
            {(() => {
              const p = pointsA[hoverIdx];
              const tooltipW = 120;
              const tx = Math.min(Math.max(p.x - tooltipW / 2, 5), W - tooltipW - 5);
              const ty = Math.min(p.y, pointsB[hoverIdx]?.y ?? p.y) - 55;
              return (
                <g>
                  <rect x={tx} y={ty} width={tooltipW} height={48} rx={8} fill="#18181b" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
                  <text x={tx + tooltipW / 2} y={ty + 13} fill="#71717a" fontSize={9} textAnchor="middle" fontFamily="system-ui">{dataA[hoverIdx]?.date}</text>
                  <text x={tx + 10} y={ty + 28} fill={colorA} fontSize={11} fontWeight="bold" fontFamily="system-ui">{compactNum(dataA[hoverIdx]?.value || 0)}</text>
                  <text x={tx + tooltipW - 10} y={ty + 28} fill={colorB} fontSize={11} fontWeight="bold" textAnchor="end" fontFamily="system-ui">{compactNum(dataB[hoverIdx]?.value || 0)}</text>
                  <text x={tx + 10} y={ty + 42} fill="#71717a" fontSize={8} fontFamily="system-ui">{labelA}</text>
                  <text x={tx + tooltipW - 10} y={ty + 42} fill="#71717a" fontSize={8} textAnchor="end" fontFamily="system-ui">{labelB}</text>
                </g>
              );
            })()}
          </>
        )}
      </svg>
    </div>
  );
}

const METRIC_KEYS = [
  { key: 'followers', label: 'Followers', icon: Users, color: '#1ED4A7' },
  { key: 'views', label: 'Views', icon: Eye, color: '#60A5FA' },
  { key: 'likes', label: 'Likes', icon: Heart, color: '#F87171' },
  { key: 'posts', label: 'Posts', icon: BarChart3, color: '#A78BFA' },
  { key: 'comments', label: 'Comments', icon: MessageCircle, color: '#FBBF24' },
  { key: 'shares', label: 'Shares', icon: Share2, color: '#34D399' },
] as const;

export function BreakdownList({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: { icon?: any; label: string; value: number; isFlag?: boolean; img?: string }[];
}) {
  const maxVal = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-4 px-1">
        <span className="text-xs font-semibold text-zinc-900 dark:text-white">{title}</span>
        {subtitle && (
          <button className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white transition-colors">
            {subtitle} <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="space-y-1">
        {items.map((item, idx) => {
          const pct = (item.value / maxVal) * 100;
          return (
            <div key={idx} className="relative flex items-center justify-between px-3 py-2 rounded-md overflow-hidden group hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors cursor-default">
              <div
                className="absolute left-0 top-0 bottom-0 bg-zinc-100 dark:bg-white/[0.03] transition-all rounded-r-md group-hover:bg-zinc-200 dark:group-hover:bg-white/[0.05]"
                style={{ width: `${pct}%` }}
              />
              <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                {item.isFlag ? (
                  <span className="text-sm leading-none shrink-0">{item.icon}</span>
                ) : item.img ? (
                  <img src={item.img} className="w-4 h-4 rounded-[4px] shrink-0" alt="" />
                ) : item.icon ? (
                  <item.icon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />
                ) : null}
                <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate">{item.label}</span>
              </div>
              <span className="relative z-10 text-[11px] font-semibold text-zinc-900 dark:text-white pl-3">
                {compactNum(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountDetailPanel({ account, onBack, onSync, syncing, isDemoMode, allAccounts = [] }: {
  account: TrackedAccount;
  onBack: () => void;
  onSync: () => void;
  syncing: boolean;
  isDemoMode: boolean;
  allAccounts?: TrackedAccount[];
}) {
  const { t } = useTranslation();
  const cfg = PLATFORM_CONFIG[account.platform];
  const m = account.latestMetrics;
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [activeMetric, setActiveMetric] = useState<string>('followers');
  const gradientId = useRef(`chart_grad_${account.id}_${Date.now()}`).current;
  const [compareTarget, setCompareTarget] = useState<TrackedAccount | null>(null);
  const [compareSnapshots, setCompareSnapshots] = useState<MetricSnapshot[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [showCompareDropdown, setShowCompareDropdown] = useState(false);

  // Profiles available for comparison (opposite type from current)
  const compareOptions = useMemo(() => {
    const isCompetitor = account.profileType === 'competitor';
    return allAccounts.filter(a => a.id !== account.id && (isCompetitor ? a.profileType !== 'competitor' : a.profileType === 'competitor'));
  }, [allAccounts, account.id, account.profileType]);

  // Load compare target's snapshots
  useEffect(() => {
    if (!compareTarget) { setCompareSnapshots([]); return; }
    let cancelled = false;
    const loadCompare = async () => {
      setLoadingCompare(true);
      if (isDemoMode) {
        const base = compareTarget.latestMetrics || { followers: 0, views: 0, likes: 0, comments: 0, shares: 0, posts: 0 };
        const now = Date.now();
        const demoSnaps: MetricSnapshot[] = [];
        for (let i = 29; i >= 0; i--) {
          const jitter = (field: number) => Math.max(0, Math.round(field * (0.85 + Math.random() * 0.15 * (1 + i * 0.01))));
          demoSnaps.push({
            followers: jitter(base.followers), views: jitter(base.views), likes: jitter(base.likes),
            comments: jitter(base.comments), shares: jitter(base.shares),
            posts: Math.max(0, (base.posts || 0) - Math.floor(i * 2.5)),
            timestamp: new Date(now - i * 86400000).toISOString(),
          });
        }
        if (!cancelled) { setCompareSnapshots(demoSnaps); setLoadingCompare(false); }
        return;
      }
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${TRACKER_API}/tracked/${compareTarget.id}/metrics?limit=30`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setCompareSnapshots(data.snapshots || []);
        }
      } catch (err) { console.error('[SOCIAL-TRACKER] Compare load error:', err); }
      finally { if (!cancelled) setLoadingCompare(false); }
    };
    loadCompare();
    return () => { cancelled = true; };
  }, [compareTarget?.id, isDemoMode]);

  // Generate pseudo-analytics data for breakdowns (to be replaced by real backend data later)
  const breakdownData = useMemo(() => {
    const baseCount = m ? Math.max((m as any)[activeMetric] || 1000, 1000) : 1000;
    
    return {
      sources: [
        { icon: Globe, label: 'google.com', value: Math.floor(baseCount * 0.45) },
        { icon: Globe, label: 'direct', value: Math.floor(baseCount * 0.25) },
        { icon: Globe, label: 'youtube.com', value: Math.floor(baseCount * 0.15) },
        { icon: Globe, label: 'x.com', value: Math.floor(baseCount * 0.10) },
        { icon: Globe, label: 'linkedin.com', value: Math.floor(baseCount * 0.05) },
      ],
      content: [
        { icon: FileText, label: '/profile', value: Math.floor(baseCount * 0.52) },
        { icon: FileText, label: '/posts/latest', value: Math.floor(baseCount * 0.21) },
        { icon: FileText, label: '/about', value: Math.floor(baseCount * 0.14) },
        { icon: FileText, label: '/mentions', value: Math.floor(baseCount * 0.09) },
      ],
      countries: [
        { isFlag: true, icon: '🇺🇸', label: 'United States', value: Math.floor(baseCount * 0.42) },
        { isFlag: true, icon: '🇬🇧', label: 'United Kingdom', value: Math.floor(baseCount * 0.18) },
        { isFlag: true, icon: '🇨🇦', label: 'Canada', value: Math.floor(baseCount * 0.12) },
        { isFlag: true, icon: '🇦🇺', label: 'Australia', value: Math.floor(baseCount * 0.09) },
        { isFlag: true, icon: '🇩🇪', label: 'Germany', value: Math.floor(baseCount * 0.06) },
      ],
      devices: [
        { icon: Smartphone, label: 'Mobile', value: Math.floor(baseCount * 0.68) },
        { icon: Monitor, label: 'Desktop', value: Math.floor(baseCount * 0.27) },
        { icon: Tablet, label: 'Tablet', value: Math.floor(baseCount * 0.05) },
      ]
    };
  }, [m, activeMetric]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingHistory(true);
      if (isDemoMode) {
        // Generate demo history data
        const now = Date.now();
        const demoSnaps: MetricSnapshot[] = [];
        const base = m || { followers: 0, views: 0, likes: 0, comments: 0, shares: 0, posts: 0 };
        for (let i = 29; i >= 0; i--) {
          const jitter = (field: number) => Math.max(0, Math.round(field * (0.85 + Math.random() * 0.15 * (1 + i * 0.01))));
          demoSnaps.push({
            followers: jitter(base.followers),
            views: jitter(base.views),
            likes: jitter(base.likes),
            comments: jitter(base.comments),
            shares: jitter(base.shares),
            posts: Math.max(0, (base.posts || 0) - Math.floor(i * 2.5)),
            timestamp: new Date(now - i * 86400000).toISOString(),
          });
        }
        if (!cancelled) {
          setSnapshots(demoSnaps);
          setLoadingHistory(false);
        }
        return;
      }
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${TRACKER_API}/tracked/${account.id}/metrics?limit=30`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSnapshots(data.snapshots || []);
        }
      } catch (err) {
        console.error('[SOCIAL-TRACKER] History load error:', err);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [account.id, isDemoMode]);

  // Auto-select best metric
  useEffect(() => {
    if (m) {
      if (m.followers > 0) setActiveMetric('followers');
      else if (m.views > 0) setActiveMetric('views');
      else if (m.likes > 0) setActiveMetric('likes');
    }
  }, [m]);

  const activeCfg = METRIC_KEYS.find(mk => mk.key === activeMetric) || METRIC_KEYS[0];

  // Format chart data
  const chartData = snapshots.map(s => ({
    date: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: (s as any)[activeMetric] || 0,
  }));

  // Show all platform-relevant metrics (dimmed when zero) — not just non-zero
  const platformMetricKeys = PLATFORM_METRICS[account.platform] || [];
  const detailMetrics = METRIC_KEYS.filter(mk => platformMetricKeys.includes(mk.key));

  return (
    <div className="space-y-5">
      {/* Back button + header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {account.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0 ring-1 ring-white/5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <PlatformBadge platform={account.platform} />
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white truncate">{account.displayName || account.handle}</h2>
            <div className="flex items-center gap-1.5 text-[11px]">
              <PlatformIcon platform={account.platform} className="w-3.5 h-3.5 shrink-0" />
              <span style={cfg.color === '#000000' ? undefined : { color: cfg.color }} className={cfg.color === '#000000' ? 'text-black dark:text-white' : ''}>{cfg.label}</span>
              <span className="text-zinc-600">@{account.handle}</span>
              {account.lastSyncedAt && <span className="text-zinc-700 ml-1">· {t('socialHub.trackerView.synced', { time: relTime(account.lastSyncedAt, t) })}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Compare dropdown */}
          {compareOptions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowCompareDropdown(!showCompareDropdown)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                  compareTarget
                    ? 'text-rose-500 border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 border-zinc-200 dark:border-white/[0.06]'
                }`}
              >
                <Swords className="w-3.5 h-3.5" />
                {compareTarget ? (compareTarget.displayName || compareTarget.handle) : t('socialHub.detail.compare', 'Compare')}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showCompareDropdown && (
                <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#111] shadow-2xl py-1 max-h-60 overflow-y-auto">
                  {compareTarget && (
                    <button
                      onClick={() => { setCompareTarget(null); setShowCompareDropdown(false); }}
                      className="w-full px-3 py-2 text-left text-[11px] text-red-400 hover:bg-red-500/5 transition-colors flex items-center gap-2"
                    >
                      <XMark className="w-3 h-3" />
                      {t('socialHub.detail.clearCompare', 'Clear comparison')}
                    </button>
                  )}
                  {compareOptions.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => { setCompareTarget(opt); setShowCompareDropdown(false); }}
                      className={`w-full px-3 py-2 text-left text-[11px] hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors flex items-center gap-2 ${compareTarget?.id === opt.id ? 'bg-rose-500/5 text-rose-500' : 'text-zinc-700 dark:text-zinc-300'}`}
                    >
                      {opt.avatarUrl ? (
                        <img src={opt.avatarUrl} alt="" className="w-5 h-5 rounded shrink-0 object-cover" />
                      ) : (
                        <PlatformBadge platform={opt.platform} size="sm" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{opt.displayName || opt.handle}</div>
                        <div className="text-[9px] text-zinc-500 flex items-center gap-1">
                          <PlatformIcon platform={opt.platform} className="w-2.5 h-2.5" />
                          {PLATFORM_CONFIG[opt.platform].label}
                          {opt.profileType === 'competitor' && (
                            <span className="text-rose-500 font-bold">· {t('socialHub.trackerView.competitor', 'Competitor')}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={onSync} disabled={syncing} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 border border-zinc-200 dark:border-white/[0.06] transition-colors disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> {t('socialHub.trackerView.sync')}
          </button>
          <a href={account.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 border border-zinc-200 dark:border-white/[0.06] transition-colors">
            <ExternalLink className="w-3.5 h-3.5" /> {t('socialHub.detail.profile')}
          </a>
        </div>
      </div>

      {/* Current metrics summary — show ALL platform-relevant metrics */}
      {m && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {detailMetrics.map(mk => {
            const val = (m as any)[mk.key] || 0;
            const Icon = mk.icon;
            const isActive = activeMetric === mk.key;
            const isDimmed = val === 0;
            return (
              <button key={mk.key} onClick={() => setActiveMetric(mk.key)} className={`rounded-xl border p-3 text-left transition-all ${isActive ? 'border-zinc-300 dark:border-white/[0.15] bg-zinc-50 dark:bg-white/[0.04] ring-1 ring-zinc-200 dark:ring-white/[0.08]' : 'border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] hover:border-zinc-300 dark:hover:border-white/[0.1]'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3 h-3" style={{ color: isDimmed ? '#a1a1aa' : mk.color }} />
                  <span className={`text-[10px] uppercase tracking-wider font-medium ${isDimmed ? 'text-zinc-400 dark:text-zinc-700' : 'text-zinc-500'}`}>{t(`socialHub.metrics.${mk.key}` as any)}</span>
                </div>
                <div className={`text-lg font-bold ${isDimmed ? 'text-zinc-400 dark:text-zinc-700' : 'text-zinc-900 dark:text-white'}`}>{isDimmed ? '—' : compactNum(val)}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Chart — single or comparison */}
      <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <activeCfg.icon className="w-4 h-4" style={{ color: activeCfg.color }} />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
              {compareTarget
                ? t('socialHub.detail.compareOverTime', '{{metric}} — You vs {{competitor}}', {
                    metric: t(`socialHub.metrics.${activeMetric}` as any),
                    competitor: compareTarget.displayName || compareTarget.handle,
                  })
                : t('socialHub.detail.overTime', { metric: t(`socialHub.metrics.${activeMetric}` as any) })
              }
            </h3>
          </div>
          <span className="text-[10px] text-zinc-600">{t('socialHub.detail.lastDataPoints', { count: chartData.length })}</span>
        </div>
        {loadingHistory || loadingCompare ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-zinc-600 animate-spin" /></div>
        ) : compareTarget && chartData.length > 1 ? (
          (() => {
            const compareChartData = compareSnapshots.map(s => ({
              date: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              value: (s as any)[activeMetric] || 0,
            }));
            return compareChartData.length > 1 ? (
              <DualSvgChart
                dataA={chartData}
                dataB={compareChartData}
                colorA="#1ED4A7"
                colorB="#f43f5e"
                labelA={account.displayName || account.handle}
                labelB={compareTarget.displayName || compareTarget.handle}
                gradientId={`${gradientId}_compare_${activeMetric}`}
              />
            ) : (
              <SimpleSvgChart data={chartData} color={activeCfg.color} gradientId={`${gradientId}_${activeMetric}`} />
            );
          })()
        ) : chartData.length > 1 ? (
          <SimpleSvgChart data={chartData} color={activeCfg.color} gradientId={`${gradientId}_${activeMetric}`} />
        ) : (
          <div className="text-center py-16">
            <BarChart3 className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
            <p className="text-xs text-zinc-600">{t('socialHub.detail.notEnoughData')}</p>
            <p className="text-[10px] text-zinc-700 mt-1">{t('socialHub.detail.syncRegularly')}</p>
          </div>
        )}
      </div>

      {/* Comparison metrics summary */}
      {compareTarget && compareTarget.latestMetrics && m && (
        <div className="rounded-xl border border-rose-500/15 bg-white dark:bg-[#0A0A0A] p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-4">
            <Swords className="w-4 h-4 text-rose-500" />
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-white">
              {t('socialHub.detail.headToHead', 'Head-to-Head: {{you}} vs {{them}}', {
                you: account.displayName || account.handle,
                them: compareTarget.displayName || compareTarget.handle,
              })}
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PLATFORM_METRICS[account.platform].map(metricKey => {
              const yourVal = (m as any)[metricKey] || 0;
              const theirVal = (compareTarget.latestMetrics as any)?.[metricKey] || 0;
              const diff = yourVal - theirVal;
              const mkCfg = METRIC_KEYS.find(mk => mk.key === metricKey);
              const Icon = mkCfg?.icon;
              return (
                <div key={metricKey} className="rounded-lg border border-zinc-200 dark:border-white/[0.04] p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    {Icon && <Icon className="w-3 h-3 text-zinc-500" />}
                    <span className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">{t(`socialHub.metrics.${metricKey}` as any)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-[#1ED4A7]">{compactNum(yourVal)}</span>
                    <span className="text-[9px] text-zinc-500">vs</span>
                    <span className="text-xs font-bold text-rose-500">{compactNum(theirVal)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-white/[0.04] overflow-hidden flex">
                    <div className="h-full bg-[#1ED4A7] transition-all" style={{ width: `${Math.min(100, (yourVal / Math.max(yourVal + theirVal, 1)) * 100)}%` }} />
                    <div className="h-full bg-rose-500 transition-all" style={{ width: `${Math.min(100, (theirVal / Math.max(yourVal + theirVal, 1)) * 100)}%` }} />
                  </div>
                  <div className={`text-[9px] font-bold mt-1 ${diff >= 0 ? 'text-[#1ED4A7]' : 'text-rose-500'}`}>
                    {diff >= 0 ? `+${compactNum(diff)} ${t('socialHub.detail.ahead', 'ahead')}` : `${compactNum(Math.abs(diff))} ${t('socialHub.detail.behind', 'behind')}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Analytics Breakdown Grid */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-4 sm:p-5">
            <BreakdownList title={t('socialHub.detail.sources')} subtitle={t('socialHub.detail.referrer')} items={breakdownData.sources} />
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-4 sm:p-5">
            <BreakdownList title={t('socialHub.detail.pages')} subtitle={t('socialHub.detail.all')} items={breakdownData.content} />
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-4 sm:p-5">
            <BreakdownList title={t('socialHub.detail.countries')} items={breakdownData.countries} />
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-4 sm:p-5">
            <BreakdownList title={t('socialHub.detail.devices')} subtitle={t('socialHub.detail.type')} items={breakdownData.devices} />
          </div>
        </div>
      )}

      {account.syncError && (
        <div className="flex items-start gap-2 text-[11px] text-amber-400/80 bg-amber-500/5 border border-amber-500/10 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{account.syncError}</span>
        </div>
      )}
    </div>
  );
}

// ─── Social Tracker View ─────────────────────────────────────────────

function SocialTrackerView() {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<TrackedAccount | null>(null);
  const [showReport, setShowReport] = useState(false);

  const DEMO_ACCOUNTS: TrackedAccount[] = [
    { id: 'demo_ig_own', userId: 'demo', platform: 'instagram', handle: 'contndrHQ', url: 'https://instagram.com/contndrHQ', displayName: 'Contndr', profileType: 'own', latestMetrics: { followers: 12_400, views: 89_000, likes: 4_200, comments: 0, shares: 0, posts: 156, timestamp: new Date().toISOString() }, addedAt: new Date(Date.now() - 86400000 * 14).toISOString(), lastSyncedAt: new Date(Date.now() - 1800000).toISOString() },
    { id: 'demo_li_own', userId: 'demo', platform: 'linkedin', handle: 'contndr', url: 'https://linkedin.com/company/contndr', displayName: 'Contndr', profileType: 'own', latestMetrics: { followers: 8_700, views: 45_000, likes: 0, comments: 0, shares: 0, posts: 92, timestamp: new Date().toISOString() }, addedAt: new Date(Date.now() - 86400000 * 10).toISOString(), lastSyncedAt: new Date(Date.now() - 3600000).toISOString() },
    { id: 'demo_tw_own', userId: 'demo', platform: 'twitter', handle: 'contndrHQ', url: 'https://x.com/contndrHQ', displayName: 'Contndr', profileType: 'own', latestMetrics: { followers: 5_200, views: 0, likes: 1_800, comments: 0, shares: 0, posts: 210, timestamp: new Date().toISOString() }, addedAt: new Date(Date.now() - 86400000 * 7).toISOString(), lastSyncedAt: new Date(Date.now() - 7200000).toISOString() },
    { id: 'demo_ig_comp1', userId: 'demo', platform: 'instagram', handle: 'apolloio', url: 'https://instagram.com/apolloio', displayName: 'Apollo.io', profileType: 'competitor', latestMetrics: { followers: 45_600, views: 320_000, likes: 18_900, comments: 0, shares: 0, posts: 480, timestamp: new Date().toISOString() }, addedAt: new Date(Date.now() - 86400000 * 5).toISOString(), lastSyncedAt: new Date(Date.now() - 3600000 * 2).toISOString() },
    { id: 'demo_li_comp1', userId: 'demo', platform: 'linkedin', handle: 'outreach-io', url: 'https://linkedin.com/company/outreach-io', displayName: 'Outreach', profileType: 'competitor', latestMetrics: { followers: 112_000, views: 890_000, likes: 0, comments: 0, shares: 0, posts: 720, timestamp: new Date().toISOString() }, addedAt: new Date(Date.now() - 86400000 * 3).toISOString(), lastSyncedAt: new Date(Date.now() - 7200000).toISOString() },
    { id: 'demo_tw_comp2', userId: 'demo', platform: 'twitter', handle: 'lemaborhia', url: 'https://x.com/lemaborhia', displayName: 'Lemlist', profileType: 'competitor', latestMetrics: { followers: 28_300, views: 0, likes: 9_400, comments: 0, shares: 0, posts: 340, timestamp: new Date().toISOString() }, addedAt: new Date(Date.now() - 86400000 * 2).toISOString(), lastSyncedAt: new Date(Date.now() - 1800000).toISOString() },
  ];

  const loadAccounts = useCallback(async () => {
    if (isDemoMode) { setAccounts(DEMO_ACCOUNTS); setLoading(false); return; }
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { setLoading(false); return; }
      // Consume prefetched data from App.tsx viewPreloadMap
      const data = await apiCache.fetch(
        'social:tracked',
        async () => {
          const res = await fetch(`${TRACKER_API}/tracked`, { headers });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      setAccounts(data.accounts || []);
    } catch (err: any) { console.error('[SOCIAL-TRACKER] Load error:', err); }
    finally { setLoading(false); }
  }, [isDemoMode]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Fetch and display competitor alerts on mount
  useEffect(() => {
    if (isDemoMode) return;
    const fetchAlerts = async () => {
      try {
        const headers = await getAuthHeaders();
        if (!headers.Authorization) return;
        const res = await fetch(`${TRACKER_API}/alerts`, { headers });
        if (res.ok) {
          const data = await res.json();
          const undismissed = (data.alerts || []).filter((a: any) => !a.dismissed);
          undismissed.slice(0, 3).forEach((alert: any) => {
            if (alert.type === 'overtake') {
              toast.warning(`${alert.competitorName} ${t('dashboard.competitiveGap.overtookYou', 'overtook you on {{metric}}', { metric: t(`socialHub.metrics.${alert.metric}` as any, alert.metric) })}`, { duration: 6000 });
            } else if (alert.type === 'milestone') {
              toast.info(`${alert.competitorName} ${t('dashboard.competitiveGap.hitMilestone', 'hit {{milestone}} {{metric}}', { milestone: alert.milestone?.toLocaleString(), metric: t(`socialHub.metrics.${alert.metric}` as any, alert.metric) })}`, { duration: 6000 });
            }
          });
        }
      } catch (err) {
        console.error('[SOCIAL-TRACKER] Alerts fetch error:', err);
      }
    };
    fetchAlerts();
  }, [isDemoMode, t]);

  const handleAdd = async (url: string, profileType: 'own' | 'competitor' = 'own') => {
    if (isDemoMode) { toast.success(t('socialHub.trackerView.profileAdded')); setShowAddModal(false); return; }
    setAdding(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${TRACKER_API}/track`, { method: 'POST', headers, body: JSON.stringify({ url, profileType }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add profile');
      toast.success(data.message || `Now tracking @${data.account?.handle || 'profile'}`);
      setShowAddModal(false); loadAccounts();
    } catch (err: any) { toast.error(err.message); }
    finally { setAdding(false); }
  };

  const handleSync = async (id: string) => {
    if (isDemoMode) { toast.success(t('socialHub.trackerView.syncedDemo')); return; }
    setSyncingId(id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${TRACKER_API}/tracked/${id}/sync`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      toast.success(data.message || t('socialHub.trackerView.metricsSynced')); loadAccounts();
    } catch (err: any) { toast.error(err.message); }
    finally { setSyncingId(null); }
  };

  const handleSyncAll = async () => {
    if (isDemoMode) { toast.success(t('socialHub.trackerView.allSyncedDemo')); return; }
    setSyncingAll(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${TRACKER_API}/sync-all`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      toast.success(data.message || t('socialHub.trackerView.syncedAccounts', { count: data.synced || 0 })); loadAccounts();
    } catch (err: any) { toast.error(err.message); }
    finally { setSyncingAll(false); }
  };

  const handleRemove = async (id: string) => {
    if (!confirm(t('socialHub.trackerView.removeConfirm'))) return;
    if (isDemoMode) { setAccounts(prev => prev.filter(a => a.id !== id)); return; }
    setRemovingId(id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${TRACKER_API}/tracked/${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(t('socialHub.trackerView.failedToRemove'));
      setAccounts(prev => prev.filter(a => a.id !== id)); toast.success(t('socialHub.trackerView.profileRemoved'));
    } catch (err: any) { toast.error(err.message); }
    finally { setRemovingId(null); }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center py-20"><LoadingSpinner size="lg" text={t('socialHub.trackerView.loadingProfiles')} center /></div>;
  }

  const ownAccounts = accounts.filter(a => a.profileType !== 'competitor');
  const competitorAccounts = accounts.filter(a => a.profileType === 'competitor');

  const sumMetric = (list: TrackedAccount[], key: string) => list.reduce((sum, a) => sum + ((a.latestMetrics as any)?.[key] || 0), 0);
  const ownFollowers = sumMetric(ownAccounts, 'followers');
  const compFollowers = sumMetric(competitorAccounts, 'followers');
  const ownPosts = sumMetric(ownAccounts, 'posts');
  const compPosts = sumMetric(competitorAccounts, 'posts');

  return (
    <div className="space-y-5">
      {selectedAccount ? (
        <AccountDetailPanel account={selectedAccount} onBack={() => setSelectedAccount(null)} onSync={() => handleSync(selectedAccount.id)} syncing={syncingId === selectedAccount.id} isDemoMode={isDemoMode} allAccounts={accounts} />
      ) : (
        <>
          {/* ── You vs Competitors comparison bar ── */}
          {accounts.length > 0 && ownAccounts.length > 0 && competitorAccounts.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <Swords className="w-4 h-4 text-zinc-500" />
                <h3 className="text-xs font-semibold text-zinc-900 dark:text-white">{t('socialHub.trackerView.youVsCompetitors', 'You vs Competitors')}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Followers comparison */}
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">{t('socialHub.metrics.followers')}</div>
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-[#1ED4A7]">{t('socialHub.trackerView.you', 'You')}</span>
                        <span className="text-xs font-bold text-zinc-900 dark:text-white">{compactNum(ownFollowers)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100 dark:bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-[#1ED4A7] transition-all duration-700" style={{ width: `${Math.min(100, (ownFollowers / Math.max(ownFollowers, compFollowers, 1)) * 100)}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-rose-500">{t('socialHub.trackerView.competitors', 'Competitors')}</span>
                        <span className="text-xs font-bold text-zinc-900 dark:text-white">{compactNum(compFollowers)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100 dark:bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-rose-500 transition-all duration-700" style={{ width: `${Math.min(100, (compFollowers / Math.max(ownFollowers, compFollowers, 1)) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
                {/* Posts comparison */}
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">{t('socialHub.metrics.posts')}</div>
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-[#1ED4A7]">{t('socialHub.trackerView.you', 'You')}</span>
                        <span className="text-xs font-bold text-zinc-900 dark:text-white">{compactNum(ownPosts)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100 dark:bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-[#1ED4A7] transition-all duration-700" style={{ width: `${Math.min(100, (ownPosts / Math.max(ownPosts, compPosts, 1)) * 100)}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-rose-500">{t('socialHub.trackerView.competitors', 'Competitors')}</span>
                        <span className="text-xs font-bold text-zinc-900 dark:text-white">{compactNum(compPosts)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100 dark:bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-rose-500 transition-all duration-700" style={{ width: `${Math.min(100, (compPosts / Math.max(ownPosts, compPosts, 1)) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Summary stat cards ── */}
          {accounts.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-3 sm:p-4">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t('socialHub.trackerView.yourProfiles', 'Your Profiles')}</div>
                <div className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white mt-1">{ownAccounts.length}</div>
              </div>
              <div className="rounded-xl border border-rose-500/10 dark:border-rose-500/10 bg-white dark:bg-[#0A0A0A] p-3 sm:p-4">
                <div className="text-[10px] text-rose-500/70 uppercase tracking-wider font-semibold">{t('socialHub.trackerView.competitorsTracked', 'Competitors')}</div>
                <div className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white mt-1">{competitorAccounts.length}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-3 sm:p-4">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t('socialHub.trackerView.yourFollowers', 'Your Followers')}</div>
                <div className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white mt-1">{compactNum(ownFollowers)}</div>
              </div>
              <div className="rounded-xl border border-rose-500/10 dark:border-rose-500/10 bg-white dark:bg-[#0A0A0A] p-3 sm:p-4">
                <div className="text-[10px] text-rose-500/70 uppercase tracking-wider font-semibold">{t('socialHub.trackerView.competitorFollowers', 'Their Followers')}</div>
                <div className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white mt-1">{compactNum(compFollowers)}</div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('socialHub.trackerView.trackedProfiles', { count: accounts.length })}</h3>
            <div className="flex items-center gap-2">
              {accounts.length > 0 && competitorAccounts.length > 0 && (
                <button onClick={() => setShowReport(true)} className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors touch-manipulation">
                  <BarChart3 className="w-3 h-3" />
                  <span className="hidden sm:inline">{t('socialHub.trackerView.report', 'Report')}</span>
                </button>
              )}
              {accounts.length > 0 && (
                <button onClick={handleSyncAll} disabled={syncingAll} className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors disabled:opacity-40 touch-manipulation">
                  <RefreshCw className={`w-3 h-3 ${syncingAll ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{t('socialHub.trackerView.syncAll')}</span><span className="sm:hidden">{t('socialHub.trackerView.sync')}</span>
                </button>
              )}
              <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-1 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors touch-manipulation">
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('socialHub.trackerView.trackProfile')}</span><span className="sm:hidden">{t('socialHub.trackerView.add')}</span>
              </button>
            </div>
          </div>

          {accounts.length > 0 ? (
            <div className="space-y-6">
              {/* Your profiles */}
              {ownAccounts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-3.5 h-3.5 text-[#1ED4A7]" />
                    <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{t('socialHub.trackerView.yourProfiles', 'Your Profiles')} ({ownAccounts.length})</h4>
                  </div>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {ownAccounts.map(account => (
                      <TrackedAccountCard key={account.id} account={account} onSync={() => handleSync(account.id)} onRemove={() => handleRemove(account.id)} onClick={() => setSelectedAccount(account)} syncing={syncingId === account.id} removing={removingId === account.id} />
                    ))}
                  </div>
                </div>
              )}
              {/* Competitor profiles */}
              {competitorAccounts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Swords className="w-3.5 h-3.5 text-rose-500" />
                    <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{t('socialHub.trackerView.competitorProfiles', 'Competitor Profiles')} ({competitorAccounts.length})</h4>
                  </div>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {competitorAccounts.map(account => (
                      <TrackedAccountCard key={account.id} account={account} onSync={() => handleSync(account.id)} onRemove={() => handleRemove(account.id)} onClick={() => setSelectedAccount(account)} syncing={syncingId === account.id} removing={removingId === account.id} />
                    ))}
                  </div>
                </div>
              )}
              {/* Ungrouped (legacy accounts without profileType) */}
              {accounts.filter(a => !a.profileType).length > 0 && ownAccounts.length === 0 && competitorAccounts.length === 0 && (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {accounts.map(account => (
                    <TrackedAccountCard key={account.id} account={account} onSync={() => handleSync(account.id)} onRemove={() => handleRemove(account.id)} onClick={() => setSelectedAccount(account)} syncing={syncingId === account.id} removing={removingId === account.id} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-16 sm:py-24 px-6">
              {/* Premium staggered platform grid */}
              <div className="relative w-fit mx-auto mb-10">
                {/* Top row — 3 icons */}
                <div className="flex items-end justify-center gap-3 sm:gap-4 mb-3 sm:mb-4">
                  {([
                    { Logo: YouTubeLogo, color: '#FF0000', label: 'YouTube', extra: '' },
                    { Logo: TikTokIcon, color: '#00F2EA', label: 'TikTok', extra: '' },
                    { Logo: InstagramLogo, color: '#E4405F', label: 'Instagram', extra: '' },
                  ]).map(({ Logo, color, label, extra }, i) => (
                    <div key={label} className="group/icon relative" style={{ transform: i === 1 ? 'translateY(-6px)' : '' }}>
                      <div
                        className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover/icon:opacity-40 transition-opacity duration-500"
                        style={{ backgroundColor: color }}
                      />
                      <div
                        className={`relative ${i === 1 ? 'w-14 h-14 sm:w-16 sm:h-16 rounded-2xl' : 'w-12 h-12 sm:w-14 sm:h-14 rounded-xl'} flex items-center justify-center border border-white/[0.06] group-hover/icon:border-white/[0.12] transition-all duration-300 group-hover/icon:scale-105 cursor-default`}
                        style={{ backgroundColor: `${color}0A`, boxShadow: `0 0 0 1px ${color}08, inset 0 1px 0 ${color}06` }}
                      >
                        <Logo className={`${i === 1 ? 'w-6 h-6 sm:w-7 sm:h-7' : 'w-5 h-5 sm:w-6 sm:h-6'} ${extra}`} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Bottom row — 2 icons, centered between top */}
                <div className="flex items-start justify-center gap-3 sm:gap-4">
                  {([
                    { Logo: LinkedInLogo, color: '#0A66C2', label: 'LinkedIn', extra: 'text-[#0A66C2]' },
                    { Logo: FacebookLogo, color: '#0866FF', label: 'Facebook', extra: '' },
                  ]).map(({ Logo, color, label, extra }) => (
                    <div key={label} className="group/icon relative">
                      <div
                        className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover/icon:opacity-40 transition-opacity duration-500"
                        style={{ backgroundColor: color }}
                      />
                      <div
                        className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center border border-white/[0.06] group-hover/icon:border-white/[0.12] transition-all duration-300 group-hover/icon:scale-105 cursor-default"
                        style={{ backgroundColor: `${color}0A`, boxShadow: `0 0 0 1px ${color}08, inset 0 1px 0 ${color}06` }}
                      >
                        <Logo className={`w-5 h-5 sm:w-6 sm:h-6 ${extra}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <h3 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white mb-1.5">{t('socialHub.trackerView.noProfilesYet', 'Track your brand & competitors')}</h3>
              <p className="text-xs text-zinc-500 mb-6 max-w-sm mx-auto leading-relaxed">{t('socialHub.trackerView.noProfilesDesc', 'Monitor your social growth alongside competitors. Track followers, engagement, and content output across YouTube, TikTok, Instagram, LinkedIn, Facebook, and X.')}</p>
              <div className="flex items-center justify-center gap-3">
                <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-xs font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors touch-manipulation shadow-lg shadow-white/5">
                  <Shield className="w-3.5 h-3.5" /> {t('socialHub.trackerView.trackYourBrand', 'Track Your Brand')}
                </button>
                <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/5 transition-colors touch-manipulation">
                  <Swords className="w-3.5 h-3.5" /> {t('socialHub.trackerView.trackCompetitor', 'Track a Competitor')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {showAddModal && <AddProfileModal onClose={() => setShowAddModal(false)} onAdd={handleAdd} adding={adding} />}
      {showReport && <CompetitiveReport onClose={() => setShowReport(false)} />}
    </div>
  );
}



// ─── Main Social Hub Component ───────────────────────────────────────

export function SocialSyncer() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'tracker' | 'publisher'>('tracker');
  return (
    <div className="h-full overflow-y-auto">
      <div className="sm:sticky sm:top-0 sm:z-10 bg-white/80 dark:bg-black/80 backdrop-blur-md border-b border-zinc-200 dark:border-white/[0.06]">
        <div className="px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white">{t('socialHub.title')}</h1>
              <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{t('socialHub.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center px-4 sm:px-6">
          <button onClick={() => setActiveTab('tracker')} className={`relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${activeTab === 'tracker' ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}>
            <Target className="w-4 h-4" /> {t('socialHub.tracker')}
            {activeTab === 'tracker' && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />}
          </button>
          <button onClick={() => setActiveTab('publisher')} className={`relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${activeTab === 'publisher' ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}>
            <Send className="w-4 h-4" /> {t('socialHub.publisher')}
            {activeTab === 'publisher' && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />}
          </button>
        </div>
        <div className="h-px bg-zinc-200 dark:bg-white/[0.06]" />
      </div>
      <div className="px-4 py-3 sm:px-6 sm:py-6 pb-[calc(env(safe-area-inset-bottom,20px)+20px)] sm:pb-6">
        {activeTab === 'tracker' ? <SocialTrackerView /> : <SocialPublisher />}
      </div>
    </div>
  );
}

export default SocialSyncer;