/**
 * Social Publisher — OAuth-connected social media posting.
 * Connect LinkedIn, Facebook, Instagram → compose → publish or schedule.
 * Matches Contndr dark-only design language.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, RefreshCw, Loader2, X, ExternalLink, Send, Clock,
  Link2, Image, Video, FileText, CheckCircle2, XCircle, AlertTriangle,
  BarChart3, Heart, MessageCircle, Share2, Eye, MousePointerClick,
  Bookmark, ThumbsUp, Calendar,
} from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { useDemoMode } from './DemoContext';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './LoadingSpinner';
import { OAuthResultModal } from './OAuthResultModal';
import ImportedLinkedInLogo from '../imports/svg-linkedin-logo';
import ImportedFacebookLogo from '../imports/svg-facebook-logo';
import ImportedInstagramLogo from '../imports/svg-instagram-logo';
import ImportedMetaLogo from '../imports/svg-meta-logo';

// ─── Inline Brand Logos (kept as aliases to imported SVGs) ───────────

function LinkedInLogo({ className }: { className?: string }) {
  return <ImportedLinkedInLogo className={className} />;
}

function FacebookLogo({ className }: { className?: string }) {
  return <ImportedFacebookLogo className={className} />;
}

function MetaLogo({ className }: { className?: string }) {
  return <ImportedMetaLogo className={className} />;
}

// ─── Types ───────────────────────────────────────────────────────────

type SyncerPlatform = 'linkedin' | 'facebook' | 'instagram';
type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

interface SocialAccount {
  id: string;
  userId: string;
  platform: SyncerPlatform;
  platformUserId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  expiresAt: number;
  scopes: string[];
  connectedAt: string;
  metadata?: Record<string, any>;
}

interface MediaFile {
  url: string;
  path: string;
  mimeType: string;
  fileName: string;
  size: number;
}

interface EngagementMetrics {
  impressions?: number;
  reach?: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reactions?: number;
  saves?: number;
  lastSyncedAt: string;
}

interface SocialPost {
  id: string;
  userId: string;
  content: string;
  platforms: SyncerPlatform[];
  status: PostStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  mediaFiles?: MediaFile[];
  results: Record<SyncerPlatform, {
    status: PostStatus;
    postUrl?: string;
    platformPostId?: string;
    error?: string;
    publishedAt?: string;
    engagement?: EngagementMetrics;
  }>;
}

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/social`;

// ─── Platform Config ─────────────────────────────────────────────────

const SYNCER_PLATFORMS: Record<SyncerPlatform, {
  label: string;
  color: string;
  connectLabel: string;
}> = {
  linkedin: { label: 'LinkedIn', color: '#0A66C2', connectLabel: 'Connect LinkedIn' },
  facebook: { label: 'Facebook', color: '#0866FF', connectLabel: 'Connect Meta (Facebook + Instagram)' },
  instagram: { label: 'Instagram', color: '#E4405F', connectLabel: 'Connect via Meta' },
};

function PlatformLogo({ platform, className }: { platform: SyncerPlatform; className?: string }) {
  switch (platform) {
    case 'linkedin': return <ImportedLinkedInLogo className={className} />;
    case 'facebook': return <ImportedFacebookLogo className={className} />;
    case 'instagram': return <ImportedInstagramLogo className={className} />;
    default: return null;
  }
}

function PlatformBadge({ platform, size = 'md' }: { platform: SyncerPlatform; size?: 'sm' | 'md' }) {
  const cfg = SYNCER_PLATFORMS[platform];
  const sizeClass = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  const logoSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5';
  return (
    <div
      className={`${sizeClass} rounded-xl flex items-center justify-center shrink-0`}
      style={{ backgroundColor: `${cfg.color}15` }}
    >
      <PlatformLogo platform={platform} className={`${logoSize} ${platform === 'linkedin' ? 'text-[#0A66C2]' : ''}`} />
    </div>
  );
}

function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function relTime(iso?: string, t?: (key: string, params?: Record<string, any>) => string): string {
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

// ─── Status badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PostStatus }) {
  const { t } = useTranslation();
  const map: Record<PostStatus, { label: string; cls: string; icon: any }> = {
    draft: { label: t('socialHub.publisherView.draft'), cls: 'text-zinc-600 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800', icon: FileText },
    scheduled: { label: t('socialHub.publisherView.scheduled'), cls: 'text-amber-400 bg-amber-500/10', icon: Clock },
    publishing: { label: t('socialHub.publisherView.publishing'), cls: 'text-blue-400 bg-blue-500/10', icon: Loader2 },
    published: { label: t('socialHub.publisherView.published'), cls: 'text-emerald-400 bg-emerald-500/10', icon: CheckCircle2 },
    failed: { label: t('socialHub.publisherView.failed'), cls: 'text-red-400 bg-red-500/10', icon: XCircle },
  };
  const s = map[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${s.cls}`}>
      <Icon className={`w-3 h-3 ${status === 'publishing' ? 'animate-spin' : ''}`} />
      {s.label}
    </span>
  );
}

// ─── Connected Account Card ──────────────────────────────────────────

function ConnectedAccountCard({ account, onDisconnect, disconnecting }: {
  account: SocialAccount;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const { t } = useTranslation();
  const cfg = SYNCER_PLATFORMS[account.platform];
  const isExpired = account.expiresAt < Date.now();
  return (
    <div className="relative rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] p-4 group hover:border-zinc-300 dark:hover:border-white/[0.12] transition-colors shadow-sm dark:shadow-none">
      <div className="flex items-center gap-3">
        {/* Platform logo */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${cfg.color}15` }}
        >
          <PlatformLogo platform={account.platform} className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">{account.displayName}</span>
            {isExpired ? (
              <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0">{t('socialHub.publisherView.expired')}</span>
            ) : (
              <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">{t('socialHub.publisherView.connected')}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
            <span style={{ color: cfg.color }} className="font-medium">{cfg.label}</span>
            {account.metadata?.accountType === 'organization' && (
              <span className="text-zinc-500 dark:text-zinc-600">· {t('socialHub.publisherView.organization')}</span>
            )}
            {account.email && <span className="text-zinc-500 dark:text-zinc-600 truncate">· {account.email}</span>}
          </div>
        </div>
        <button
          onClick={onDisconnect}
          disabled={disconnecting}
          className="p-2 rounded-lg text-zinc-400 dark:text-zinc-700 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-40 touch-manipulation shrink-0"
          title={t('socialHub.publisherView.disconnect')}
        >
          {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Post Card ───────────────────────────────────────────────────────

function PostCard({ post, onPublish, onDelete, onSyncEngagement, publishing, deleting }: {
  post: SocialPost;
  onPublish: () => void;
  onDelete: () => void;
  onSyncEngagement: () => void;
  publishing: boolean;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hasEngagement = post.status === 'published' && post.platforms.some(p => post.results[p]?.engagement);

  return (
    <div className="rounded-lg sm:rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] overflow-hidden">
      <div className="p-3 sm:p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 sm:gap-3 mb-2">
          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
            {post.platforms.map(p => (
              <PlatformBadge key={p} platform={p} size="sm" />
            ))}
            <StatusBadge status={post.status} />
          </div>
          <span className="text-[9px] sm:text-[10px] text-zinc-600 shrink-0">{relTime(post.updatedAt, t)}</span>
        </div>

        {/* Content preview */}
        <p className={`text-xs sm:text-sm text-zinc-300 ${expanded ? '' : 'line-clamp-3'}`}>
          {post.content || t('socialHub.publisherView.noContent')}
        </p>
        {post.content && post.content.length > 200 && (
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-[#1ED4A7] mt-1 touch-manipulation">
            {expanded ? t('socialHub.publisherView.showLess') : t('socialHub.publisherView.showMore')}
          </button>
        )}

        {/* Media thumbnails */}
        {post.mediaFiles && post.mediaFiles.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2">
            {post.mediaFiles.map((m, i) => (
              <div key={i} className="w-12 h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/[0.04] flex items-center justify-center overflow-hidden">
                {m.mimeType.startsWith('image/') ? (
                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Video className="w-4 h-4 text-zinc-500" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Platform results */}
        {(post.status === 'published' || post.status === 'failed') && (
          <div className="mt-3 space-y-1">
            {post.platforms.map(p => {
              const r = post.results[p];
              if (!r) return null;
              return (
                <div key={p} className="flex items-center gap-2 text-[11px]">
                  <PlatformBadge platform={p} size="sm" />
                  <span className={r.status === 'published' ? 'text-emerald-400' : 'text-red-400'}>
                    {r.status === 'published' ? t('socialHub.publisherView.published') : r.error || t('socialHub.publisherView.failed')}
                  </span>
                  {r.postUrl && (
                    <a href={r.postUrl} target="_blank" rel="noopener noreferrer" className="text-[#1ED4A7] hover:underline flex items-center gap-0.5">
                      {t('socialHub.publisherView.view')} <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Engagement metrics */}
        {hasEngagement && (
          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-white/[0.04]">
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className="w-3 h-3 text-zinc-500" />
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{t('socialHub.publisherView.engagement')}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {post.platforms.map(p => {
                const e = post.results[p]?.engagement;
                if (!e) return null;
                return (
                  <div key={p} className="flex items-center gap-3 text-[11px]">
                    {(e.likes ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <Heart className="w-3 h-3" /> {compactNum(e.likes!)}
                      </span>
                    )}
                    {(e.comments ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <MessageCircle className="w-3 h-3" /> {compactNum(e.comments!)}
                      </span>
                    )}
                    {(e.shares ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <Share2 className="w-3 h-3" /> {compactNum(e.shares!)}
                      </span>
                    )}
                    {(e.impressions ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <Eye className="w-3 h-3" /> {compactNum(e.impressions!)}
                      </span>
                    )}
                    {(e.saves ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <Bookmark className="w-3 h-3" /> {compactNum(e.saves!)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 border-t border-zinc-200 dark:border-white/[0.04] bg-zinc-50 dark:bg-[#080808]">
        {(post.status === 'draft' || post.status === 'scheduled' || post.status === 'failed') && (
          <button
            onClick={onPublish}
            disabled={publishing}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors disabled:opacity-40 touch-manipulation"
          >
            {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            <span className="hidden sm:inline">{post.status === 'failed' ? t('socialHub.publisherView.retry') : t('socialHub.publisherView.publishNow')}</span>
            <span className="sm:hidden">{post.status === 'failed' ? t('socialHub.publisherView.retry') : t('socialHub.publisherView.publish')}</span>
          </button>
        )}
        {post.status === 'published' && (
          <button
            onClick={onSyncEngagement}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors touch-manipulation"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">{t('socialHub.publisherView.refreshStats')}</span>
            <span className="sm:hidden">{t('socialHub.publisherView.refresh')}</span>
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-1.5 rounded-lg text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 touch-manipulation"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Compose Panel ───────────────────────────────────────────────────

function ComposePanel({ accounts, onPostCreated }: {
  accounts: SocialAccount[];
  onPostCreated: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<SyncerPlatform[]>([]);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availablePlatforms = [...new Set(accounts.map(a => a.platform))];

  const togglePlatform = (p: SyncerPlatform) => {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/media/upload`, {
        method: 'POST',
        headers: { Authorization: headers.Authorization },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setMediaFiles(prev => [...prev, data.mediaFile]);
      toast.success(t('socialHub.publisherView.uploaded', { name: file.name }));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeMedia = async (index: number) => {
    const m = mediaFiles[index];
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_BASE}/media`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ path: m.path }),
      });
    } catch {}
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handlePublish = async (schedule = false) => {
    if (!content.trim() && mediaFiles.length === 0) {
      toast.error(t('socialHub.publisherView.addContent'));
      return;
    }
    if (selectedPlatforms.length === 0) {
      toast.error(t('socialHub.publisherView.selectPlatform'));
      return;
    }

    schedule ? setScheduling(true) : setPublishing(true);
    try {
      const headers = await getAuthHeaders();

      // Create post
      const createRes = await fetch(`${API_BASE}/posts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: content.trim(),
          platforms: selectedPlatforms,
          mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined,
          scheduledAt: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error);

      if (!schedule) {
        // Publish immediately
        const pubRes = await fetch(`${API_BASE}/posts/${createData.post.id}/publish`, {
          method: 'POST',
          headers,
        });
        const pubData = await pubRes.json();
        if (!pubRes.ok) throw new Error(pubData.error);

        const allPublished = pubData.post.status === 'published';
        if (allPublished) {
          toast.success(t('socialHub.publisherView.publishedSuccessToast'));
        } else {
          toast.error(t('socialHub.publisherView.someFailedToast'));
        }
      } else {
        toast.success(t('socialHub.publisherView.postScheduled'));
      }

      // Reset form
      setContent('');
      setSelectedPlatforms([]);
      setMediaFiles([]);
      setScheduledAt('');
      setShowSchedule(false);
      onPostCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPublishing(false);
      setScheduling(false);
    }
  };

  return (
    <div className="rounded-xl sm:rounded-2xl border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-[#0A0A0A] overflow-hidden">
      <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
        <h3 className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('socialHub.publisherView.composePost')}</h3>

        {/* Content */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('socialHub.publisherView.whatToShare')}
          rows={4}
          className="w-full bg-zinc-50 dark:bg-[#111] rounded-lg sm:rounded-xl border border-zinc-200 dark:border-white/[0.06] px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-600 focus:outline-none focus:border-teal-500/30 dark:focus:border-[#1ED4A7]/30 resize-none"
        />

        {/* Media previews */}
        {mediaFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {mediaFiles.map((m, i) => (
              <div key={i} className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/[0.06] overflow-hidden">
                {m.mimeType.startsWith('image/') ? (
                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Video className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
                  </div>
                )}
                <button
                  onClick={() => removeMedia(i)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center touch-manipulation"
                >
                  <X className="w-2.5 h-2.5 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Platform select */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-600 uppercase tracking-wider font-semibold">{t('socialHub.publisherView.postTo')}</span>
          {availablePlatforms.map(p => {
            const cfg = SYNCER_PLATFORMS[p];
            const selected = selectedPlatforms.includes(p);
            return (
              <button
                key={p}
                onClick={() => togglePlatform(p)}
                className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium border transition-all touch-manipulation ${
                  selected
                    ? 'border-teal-500/30 bg-teal-500/10 text-teal-600 dark:border-[#1ED4A7]/30 dark:bg-[#1ED4A7]/10 dark:text-[#1ED4A7]'
                    : 'border-zinc-200 dark:border-white/[0.06] text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:hover:text-zinc-300 dark:hover:border-white/[0.12]'
                }`}
              >
                <PlatformBadge platform={p} size="sm" />
                <span className="whitespace-nowrap">{cfg.label}</span>
              </button>
            );
          })}
        </div>

        {/* Schedule option */}
        {showSchedule && (
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-500 shrink-0" />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="flex-1 bg-zinc-50 dark:bg-[#111] border border-zinc-200 dark:border-white/[0.06] rounded-lg px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs text-zinc-900 dark:text-zinc-300 focus:outline-none focus:border-teal-500/30 dark:focus:border-[#1ED4A7]/30 min-w-0"
            />
            <button onClick={() => { setShowSchedule(false); setScheduledAt(''); }} className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400 touch-manipulation shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-zinc-100 dark:border-white/[0.04] bg-zinc-50 dark:bg-[#080808]">
        <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleUpload} className="hidden" />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="p-1.5 sm:p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 dark:hover:text-white dark:hover:bg-white/5 transition-colors disabled:opacity-40 touch-manipulation"
          title={t('socialHub.publisherView.addMedia')}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> : <Image className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
        </button>
        <button
          onClick={() => setShowSchedule(!showSchedule)}
          className={`p-1.5 sm:p-2 rounded-lg transition-colors touch-manipulation ${showSchedule ? 'text-teal-600 bg-teal-500/10 dark:text-[#1ED4A7] dark:bg-[#1ED4A7]/10' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 dark:hover:text-white dark:hover:bg-white/5'}`}
          title={t('socialHub.publisherView.schedule')}
        >
          <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
        <div className="flex-1" />
        {showSchedule && scheduledAt && (
          <button
            onClick={() => handlePublish(true)}
            disabled={scheduling || selectedPlatforms.length === 0}
            className="inline-flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-30 touch-manipulation"
          >
            {scheduling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{t('socialHub.publisherView.schedule')}</span>
          </button>
        )}
        <button
          onClick={() => handlePublish(false)}
          disabled={publishing || selectedPlatforms.length === 0 || (!content.trim() && mediaFiles.length === 0)}
          className="inline-flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation"
        >
          {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{t('socialHub.publisherView.publishNow')}</span>
          <span className="sm:hidden">{t('socialHub.publisherView.publish')}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function SocialPublisher() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncingEngagement, setSyncingEngagement] = useState(false);

  // OAuth result modal (same as Gmail/Outlook connected modal)
  const [oauthModal, setOauthModal] = useState<{ type: 'success' | 'error'; name: string; detail?: string; error?: string } | null>(null);

  // Show modal with a short delay so the popup window closes first
  const showOauthModal = useCallback((modal: typeof oauthModal) => {
    setTimeout(() => setOauthModal(modal), 300);
  }, []);

  // Demo data
  const DEMO_ACCOUNTS: SocialAccount[] = [
    { id: 'demo_li', userId: 'demo', platform: 'linkedin', platformUserId: 'demo', displayName: 'John Smith', email: 'john@example.com', expiresAt: Date.now() + 86400000, scopes: [], connectedAt: new Date().toISOString() },
    { id: 'demo_fb', userId: 'demo', platform: 'facebook', platformUserId: 'demo', displayName: 'My Business Page', expiresAt: Date.now() + 86400000, scopes: [], connectedAt: new Date().toISOString() },
  ];

  const DEMO_POSTS: SocialPost[] = [
    {
      id: 'demo_p1', userId: 'demo', content: 'Excited to share our latest product update! Check it out at contndr.com', platforms: ['linkedin'], status: 'published',
      publishedAt: new Date(Date.now() - 3600000).toISOString(), createdAt: new Date(Date.now() - 7200000).toISOString(), updatedAt: new Date(Date.now() - 3600000).toISOString(),
      results: { linkedin: { status: 'published', postUrl: 'https://linkedin.com/feed/update/123', publishedAt: new Date(Date.now() - 3600000).toISOString(), engagement: { likes: 42, comments: 8, shares: 3, impressions: 1250, lastSyncedAt: new Date().toISOString() } }, facebook: { status: 'draft' }, instagram: { status: 'draft' } },
    },
  ];

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (isDemoMode) {
      setAccounts(DEMO_ACCOUNTS);
      setPosts(DEMO_POSTS);
      setLoading(false);
      return;
    }
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { setLoading(false); return; }
      const [acctRes, postsRes] = await Promise.all([
        fetch(`${API_BASE}/accounts`, { headers }),
        fetch(`${API_BASE}/posts`, { headers }),
      ]);
      if (acctRes.ok) {
        const data = await acctRes.json();
        setAccounts(data.accounts || []);
      }
      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts || []);
      }
    } catch (err: any) {
      console.error('[SOCIAL-PUB] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [isDemoMode]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Listen for OAuth results via BroadcastChannel + postMessage ──
  useEffect(() => {
    let handled = false; // Deduplicate — both BC and postMessage may fire from same popup
    const handleOAuthResult = (data: any) => {
      if (handled) return;
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        // Clear connecting state when we get any OAuth result
        setConnectingPlatform(null);
        if (parsed.social_connected) {
          handled = true;
          // Show the OAuthResultModal (same as Gmail/Outlook) instead of a toast
          showOauthModal({
            type: 'success',
            name: parsed.social_connected,
            detail: parsed.social_name || undefined,
          });
          loadData();
        }
        if (parsed.social_error) {
          handled = true;
          showOauthModal({
            type: 'error',
            name: 'Social',
            error: parsed.social_error,
          });
        }
        if (parsed.linkedin_select_account) {
          handled = true;
          handleLinkedInAccountSelection();
        }
        // meta_select_pages no longer used — Meta now auto-connects server-side like LinkedIn
        // Reset dedup flag after a short window so future OAuth flows work
        if (handled) setTimeout(() => { handled = false; }, 2000);
      } catch {}
    };

    // BroadcastChannel listener (works even when COOP severs window.opener)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('contndr-social-oauth');
      bc.onmessage = (event: MessageEvent) => handleOAuthResult(event.data);
    } catch {}

    // postMessage fallback
    const msgHandler = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'social-oauth-result' || data?.social_connected || data?.social_error) {
          handleOAuthResult(data);
        }
      } catch {}
    };
    window.addEventListener('message', msgHandler);

    return () => {
      window.removeEventListener('message', msgHandler);
      try { bc?.close(); } catch {}
    };
  }, [loadData, showOauthModal]);

  // ── Check URL params for OAuth callbacks (legacy fallback) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('linkedin_select_account') === 'true') {
      handleLinkedInAccountSelection();
      window.history.replaceState({}, '', window.location.pathname);
    }
    const socialConnected = params.get('social_connected');
    if (socialConnected) {
      setOauthModal({ type: 'success', name: socialConnected });
      loadData();
      window.history.replaceState({}, '', window.location.pathname);
    }
    const socialError = params.get('social_error');
    if (socialError) {
      setOauthModal({ type: 'error', name: 'Social', error: decodeURIComponent(socialError) });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ── Connect platform ──
  const handleConnect = async (platform: string) => {
    if (isDemoMode) { toast.success(t('socialHub.publisherView.connectedDemo')); return; }
    setConnectingPlatform(platform);
    try {
      const headers = await getAuthHeaders();
      const token = headers.Authorization?.replace('Bearer ', '');
      if (!token) { toast.error(t('socialHub.publisherView.pleaseSignIn')); return; }
      const origin = encodeURIComponent(window.location.href);

      if (platform === 'meta') {
        // Meta handles both Facebook and Instagram
        const url = `${API_BASE}/auth/meta/connect?token=${token}&origin=${origin}`;
        window.open(url, 'social_oauth', 'width=600,height=700,scrollbars=yes');
      } else {
        const url = `${API_BASE}/auth/${platform}/connect?token=${token}&origin=${origin}`;
        window.open(url, 'social_oauth', 'width=600,height=700,scrollbars=yes');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setConnectingPlatform(null);
    }
  };

  // ── LinkedIn account selection ──
  const handleLinkedInAccountSelection = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/auth/linkedin/accounts`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Auto-select personal for simplicity
      const selectRes = await fetch(`${API_BASE}/auth/linkedin/select-account`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ accountType: 'personal' }),
      });
      const selectData = await selectRes.json();
      if (!selectRes.ok) throw new Error(selectData.error);

      setOauthModal({
        type: 'success',
        name: 'LinkedIn',
        detail: selectData.message || undefined,
      });
      loadData();
    } catch (err: any) {
      setOauthModal({
        type: 'error',
        name: 'LinkedIn',
        error: err.message,
      });
    }
  };

  // ── Disconnect ──
  const handleDisconnect = async (account: SocialAccount) => {
    if (!confirm(t('socialHub.publisherView.disconnectConfirm', { name: account.displayName }))) return;
    if (isDemoMode) {
      setAccounts(prev => prev.filter(a => a.id !== account.id));
      return;
    }
    setDisconnectingId(account.id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/accounts/${account.platform}/${account.id}`, {
        method: 'DELETE', headers,
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      setAccounts(prev => prev.filter(a => a.id !== account.id));
      toast.success(t('socialHub.publisherView.disconnected', { name: account.displayName }));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDisconnectingId(null);
    }
  };

  // ── Publish ──
  const handlePublish = async (postId: string) => {
    if (isDemoMode) { toast.success(t('socialHub.publisherView.publishedDemo')); return; }
    setPublishingId(postId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/posts/${postId}/publish`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPosts(prev => prev.map(p => p.id === postId ? data.post : p));
      toast.success(data.post.status === 'published' ? t('socialHub.publisherView.publishedSuccess') : t('socialHub.publisherView.someFailed'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPublishingId(null);
    }
  };

  // ── Delete post ──
  const handleDeletePost = async (postId: string) => {
    if (!confirm(t('socialHub.publisherView.deleteConfirm'))) return;
    if (isDemoMode) {
      setPosts(prev => prev.filter(p => p.id !== postId));
      return;
    }
    setDeletingId(postId);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_BASE}/posts/${postId}`, { method: 'DELETE', headers });
      setPosts(prev => prev.filter(p => p.id !== postId));
      toast.success(t('socialHub.publisherView.postDeleted'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Sync engagement ──
  const handleSyncEngagement = async (postId?: string) => {
    if (isDemoMode) { toast.success(t('socialHub.publisherView.syncedDemo')); return; }
    setSyncingEngagement(true);
    try {
      const headers = await getAuthHeaders();
      if (postId) {
        const res = await fetch(`${API_BASE}/posts/${postId}/engagement`, { headers });
        const data = await res.json();
        if (res.ok) setPosts(prev => prev.map(p => p.id === postId ? data.post : p));
      } else {
        const res = await fetch(`${API_BASE}/sync-engagement`, { method: 'POST', headers });
        const data = await res.json();
        if (res.ok && data.posts) setPosts(data.posts);
        toast.success(t('socialHub.publisherView.syncedEngagement', { count: data.synced || 0 }));
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSyncingEngagement(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner size="lg" text={t('socialHub.publisherView.loadingPublisher')} center />
      </div>
    );
  }

  const connectedPlatforms = [...new Set(accounts.map(a => a.platform))];
  const unconnectedOptions = [
    !connectedPlatforms.includes('linkedin') && 'linkedin',
    !connectedPlatforms.includes('facebook') && !connectedPlatforms.includes('instagram') && 'meta',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Connected Accounts */}
      <div className="space-y-2 sm:space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('socialHub.publisherView.connectedAccounts')}</h3>
          {posts.some(p => p.status === 'published') && (
            <button
              onClick={() => handleSyncEngagement()}
              disabled={syncingEngagement}
              className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 rounded-lg text-[10px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors disabled:opacity-40 touch-manipulation shrink-0"
            >
              <RefreshCw className={`w-3 h-3 ${syncingEngagement ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{t('socialHub.publisherView.syncEngagement')}</span>
              <span className="sm:hidden">{t('socialHub.trackerView.sync')}</span>
            </button>
          )}
        </div>

        {accounts.length > 0 && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {accounts.map(a => (
              <ConnectedAccountCard
                key={a.id}
                account={a}
                onDisconnect={() => handleDisconnect(a)}
                disconnecting={disconnectingId === a.id}
              />
            ))}
          </div>
        )}

        {/* Connect buttons — styled cards with SVG logos */}
        {unconnectedOptions.length > 0 && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {unconnectedOptions.map(opt => {
              const isConnecting = connectingPlatform === opt;
              const isLinkedIn = opt === 'linkedin';
              const isMeta = opt === 'meta';
              return (
                <button
                  key={opt}
                  onClick={() => handleConnect(opt)}
                  disabled={isConnecting}
                  className="group/connect relative rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all disabled:opacity-40 touch-manipulation text-left"
                >
                  <div className="flex items-center gap-3">
                    {/* Logo(s) */}
                    <div className="flex items-center -space-x-1.5 shrink-0">
                      {isLinkedIn && (
                        <div className="w-10 h-10 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center">
                          <ImportedLinkedInLogo className="w-5 h-5 text-[#0A66C2]" />
                        </div>
                      )}
                      {isMeta && (
                        <>
                          <div className="w-10 h-10 rounded-xl bg-[#0866FF]/10 flex items-center justify-center ring-2 ring-white dark:ring-zinc-900/80 z-10">
                            <ImportedFacebookLogo className="w-5 h-5" />
                          </div>
                          <div className="w-10 h-10 rounded-xl bg-[#E4405F]/10 flex items-center justify-center ring-2 ring-white dark:ring-zinc-900/80 z-0">
                            <ImportedInstagramLogo className="w-5 h-5" />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-300 group-hover/connect:text-black dark:group-hover/connect:text-white transition-colors">
                        {isMeta ? t('socialHub.publisherView.connectMeta') : t('socialHub.publisherView.connectLinkedIn')}
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-600 mt-0.5">
                        {isMeta ? t('socialHub.publisherView.facebookInstagram') : t('socialHub.publisherView.personalOrCompany')}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isConnecting ? (
                        <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 text-zinc-400 dark:text-zinc-600 group-hover/connect:text-zinc-900 dark:group-hover/connect:text-white transition-colors" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {accounts.length === 0 && unconnectedOptions.length === 0 && (
          <div className="text-center py-6 sm:py-8">
            <p className="text-xs sm:text-sm text-zinc-500">{t('socialHub.publisherView.connectToStart')}</p>
          </div>
        )}
      </div>

      {/* Compose (only if accounts connected) */}
      {accounts.length > 0 && (
        <ComposePanel accounts={accounts} onPostCreated={loadData} />
      )}

      {/* Posts */}
      {posts.length > 0 && (
        <div className="space-y-2 sm:space-y-3">
          <h3 className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            {t('socialHub.publisherView.postsCount', { count: posts.length })}
          </h3>
          <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2">
            {posts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                onPublish={() => handlePublish(post.id)}
                onDelete={() => handleDeletePost(post.id)}
                onSyncEngagement={() => handleSyncEngagement(post.id)}
                publishing={publishingId === post.id}
                deleting={deletingId === post.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* OAuth Result Modal — same component used for Gmail/Outlook/HubSpot/etc */}
      {oauthModal && (() => {
        // Determine which logo to show based on the connected platform name
        const nameLC = oauthModal.name.toLowerCase();
        const isLinkedIn = nameLC.includes('linkedin');
        const isFacebook = nameLC.includes('facebook');
        const isInstagram = nameLC.includes('instagram');
        const isMeta = isFacebook || isInstagram || nameLC.includes('meta');
        const accentColor = isLinkedIn ? '#0A66C2' : isFacebook ? '#0866FF' : isInstagram ? '#E4405F' : '#1ED4A7';

        let logo: React.ReactNode = undefined;
        if (isLinkedIn) {
          logo = <ImportedLinkedInLogo className="w-8 h-8 text-[#0A66C2]" />;
        } else if (isFacebook && isInstagram) {
          // Both — show stacked logos
          logo = (
            <div className="flex items-center -space-x-1">
              <ImportedFacebookLogo className="w-7 h-7" />
              <ImportedInstagramLogo className="w-7 h-7" />
            </div>
          );
        } else if (isFacebook) {
          logo = <ImportedFacebookLogo className="w-8 h-8" />;
        } else if (isInstagram) {
          logo = <ImportedInstagramLogo className="w-8 h-8" />;
        }

        return (
          <OAuthResultModal
            type={oauthModal.type}
            integrationName={oauthModal.name}
            detail={oauthModal.detail}
            errorMessage={oauthModal.error}
            logo={logo}
            accentColor={accentColor}
            onClose={() => setOauthModal(null)}
          />
        );
      })()}
    </div>
  );
}

export default SocialPublisher;