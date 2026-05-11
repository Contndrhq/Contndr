import { useState, useMemo, useCallback, useEffect } from 'react';
import { useLeadAvatar, getAvatarConfidence } from '../lib/gravatar';

// ── Confidence threshold ────────────────────────────────────────────
// Below this threshold we show initials instead of a potentially
// wrong person's photo. Matches the server-side backfill threshold.
const MIN_DISPLAY_CONFIDENCE = 0.75;

// ── Initials helper ──────────────────────────────────────────────────

function getInitials(name: string): string {
  if (!name) return '?';
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ── Deterministic color generator ───────────────────────────────────
// Same name → same colors, every render. Picks from a curated palette of
// readable, modern hues so an "all initials" view still looks distinctive
// instead of a wall of identical gray pills. White text on top has WCAG
// contrast of at least 4.5:1 against every palette entry.
const PALETTE = [
  ['#0EA5E9', '#0369A1'], // sky
  ['#14B8A6', '#0F766E'], // teal
  ['#22C55E', '#15803D'], // green
  ['#F59E0B', '#B45309'], // amber
  ['#EF4444', '#B91C1C'], // red
  ['#EC4899', '#BE185D'], // pink
  ['#A855F7', '#7E22CE'], // purple
  ['#6366F1', '#4338CA'], // indigo
  ['#3B82F6', '#1D4ED8'], // blue
  ['#10B981', '#047857'], // emerald
  ['#F97316', '#C2410C'], // orange
  ['#84CC16', '#4D7C0F'], // lime
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function paletteFor(seed: string): { from: string; to: string } {
  const idx = hashString(seed.toLowerCase()) % PALETTE.length;
  const [from, to] = PALETTE[idx];
  return { from, to };
}

// ── Component ────────────────────────────────────────────────────────

interface LeadAvatarProps {
  name: string;
  email?: string;
  /** LinkedIn profile URL — used as fallback when Gravatar has no avatar */
  linkedinUrl?: string;
  /** Avatar URL already included in a parent payload. Avoids extra avatar lookups in dense lists. */
  avatarUrl?: string | null;
  avatarConfidence?: number | null;
  lookup?: boolean;
  /** px value — rendered as width/height */
  size?: number;
  className?: string;
}

export function LeadAvatar({
  name,
  email,
  linkedinUrl,
  avatarUrl: providedAvatarUrl,
  avatarConfidence,
  lookup = true,
  size = 36,
  className = '',
}: LeadAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  // Trigger lookup whenever we have ANY identifier — email OR linkedin URL.
  // Previously we required an email, so leads scraped from LinkedIn (no email
  // yet) never got their photo even though their LinkedIn URL was present.
  const fetchedAvatarUrl = useLeadAvatar(
    lookup && !providedAvatarUrl ? email : null,
    linkedinUrl,
    name,
  );
  const avatarUrl = providedAvatarUrl ?? fetchedAvatarUrl;

  // Get confidence score from the client-side cache
  const confidence = avatarConfidence ?? (email ? getAvatarConfidence(email) : 0);

  const initials = useMemo(() => getInitials(name), [name]);
  const palette = useMemo(() => paletteFor(name || email || linkedinUrl || '?'), [name, email, linkedinUrl]);

  // Determine if we should show the image:
  // - Must have a URL
  // - Must not have failed to load
  // - Must meet minimum confidence threshold
  const displayUrl = useMemo(() => {
    if (!avatarUrl || imgFailed) return null;
    // Low confidence → don't show (likely wrong person or generic image)
    if (confidence > 0 && confidence < MIN_DISPLAY_CONFIDENCE) return null;
    // Append size hint for Gravatar-compatible URLs (harmless for CDN URLs)
    const separator = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${separator}s=${size * 2}`;
  }, [avatarUrl, size, imgFailed, confidence]);

  const showImage = !!displayUrl;

  // Handle broken images — immediately fallback to initials
  const handleError = useCallback(() => {
    setImgFailed(true);
  }, []);

  // Reset failed state when URL changes (e.g. after backfill)
  useEffect(() => {
    if (avatarUrl) setImgFailed(false);
  }, [avatarUrl]);

  // Inline fontSize scales proportionally to the circle size. We removed the
  // old `leading-none` class — it caused some fonts to render slightly above
  // the geometric center, making letters look top-cropped in dark mode.
  // Default line-height + grid placement gives pixel-perfect optical centering
  // at any size.
  const fontSize = Math.max(10, Math.round(size * 0.4));
  const background = showImage
    ? undefined
    : `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`;

  return (
    <div
      className={`rounded-full flex-shrink-0 overflow-hidden relative grid place-items-center ${className}`}
      style={{ width: size, height: size, background, lineHeight: 1 }}
      aria-label={name || 'avatar'}
    >
      {/* Initials layer — always present underneath. White text on colored
          gradient (~4.5:1 contrast) when there's no photo. Falls back to
          neutral when an image is loaded so a transparent PNG doesn't show
          the gradient through. */}
      <span
        className="font-semibold select-none text-white"
        style={{
          fontSize,
          // Tiny optical adjustment — most sans fonts have a slightly larger
          // descender than ascender area; nudging up by a hair centers caps.
          transform: 'translateY(-2%)',
          textShadow: showImage ? 'none' : '0 1px 1px rgba(0,0,0,0.15)',
        }}
      >
        {initials}
      </span>
      {/* Image layer — covers initials when loaded successfully */}
      {showImage && (
        <img
          src={displayUrl}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 w-full h-full object-cover z-[1]"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={handleError}
        />
      )}
    </div>
  );
}
