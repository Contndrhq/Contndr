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

  // Inline fontSize scales proportionally to the circle size. The previous
  // `leading-none` was causing letters to render slightly above the geometric
  // center; grid placement + a small upward optical nudge gives pixel-perfect
  // centering at any size, in any font.
  const fontSize = Math.max(10, Math.round(size * 0.4));

  return (
    <div
      className={`rounded-full flex-shrink-0 overflow-hidden relative grid place-items-center bg-zinc-100 dark:bg-zinc-800 ${className}`}
      style={{ width: size, height: size, lineHeight: 1 }}
      aria-label={name || 'avatar'}
    >
      {/* Initials layer — always present underneath. Neutral text on neutral
          background; gets covered by the photo when one loads. */}
      <span
        className="font-semibold select-none text-zinc-600 dark:text-zinc-300"
        style={{
          fontSize,
          // Tiny optical adjustment — most sans fonts have a slightly larger
          // descender than ascender area; nudging up by a hair centers caps.
          transform: 'translateY(-2%)',
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
