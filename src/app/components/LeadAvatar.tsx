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
    .split(' ')
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

  // Use the batched avatar hook — SerpAPI LinkedIn photo lookup
  const fetchedAvatarUrl = useLeadAvatar(lookup && !providedAvatarUrl ? email : null, linkedinUrl, name);
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

  // Inline fontSize scales proportionally — avoids Tailwind class merge issues
  const fontSize = Math.max(10, Math.round(size * 0.38));

  return (
    <div
      className={`rounded-full flex-shrink-0 overflow-hidden relative bg-zinc-200 dark:bg-zinc-800 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Initials layer — always present underneath */}
      <span
        className="absolute inset-0 flex items-center justify-center font-semibold select-none leading-none text-zinc-600 dark:text-zinc-300"
        style={{ fontSize }}
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
