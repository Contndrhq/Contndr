// ─── Avatar Batch Fetcher (SerpAPI LinkedIn) ─────────────────────────
// Provides a React hook that automatically batches concurrent avatar
// requests into a single API call to our server-side proxy.
//
// The server pipeline:
//   1. Check KV cache
//   2. SerpAPI Google search for LinkedIn profile photo
//   3. SerpAPI Google Images fallback for headshots
//
// Usage:
//   const avatarUrl = useLeadAvatar(email, linkedinUrl);
//   // Returns: string (URL) | null (no avatar) | undefined (loading)
//
// Multiple components mounting in the same tick are batched into one
// request.  Results are cached in-memory for the lifetime of the SPA.

import { useState, useEffect } from "react";
import { projectId, publicAnonKey } from "../utils/supabase/info";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ── In-memory singleton state ────────────────────────────────────────

/** email → url | null.  Survives across renders / re-mounts. */
const avatarCache = new Map<string, string | null>();

/** email → confidence score (0.0 - 1.0). */
const confidenceCache = new Map<string, number>();

/** Emails queued for the next batch request. */
const pendingEmails = new Set<string>();

/** Emails currently being fetched (prevents re-queuing). */
const inflightEmails = new Set<string>();

/** email → linkedin URL mapping for pending batch */
const pendingLinkedIn = new Map<string, string>();

/** email → person name mapping for pending batch */
const pendingNames = new Map<string, string>();

/** Listeners notified after every batch resolves. */
const subscribers = new Set<() => void>();

let batchTimer: ReturnType<typeof setTimeout> | null = null;

/** Emails awaiting LinkedIn background processing — will re-poll */
const linkedinPendingEmails = new Set<string>();
let repollTimer: ReturnType<typeof setTimeout> | null = null;
let repollCount = 0;
const MAX_REPOLLS = 5; // up to 5 re-polls to catch all background results
const REPOLL_DELAYS = [4000, 6000, 8000, 12000, 20000]; // escalating delays

/** Client-side cache version — bump to invalidate stale null entries from previous strategies */
const CLIENT_CACHE_VERSION = 8; // Bumped: LinkedIn-only lookup + initials redesign
const CLIENT_CACHE_VERSION_KEY = '__avatar_cache_v';

// Auto-clear stale cache on module load
try {
  const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CLIENT_CACHE_VERSION_KEY) : null;
  if (stored !== String(CLIENT_CACHE_VERSION)) {
    avatarCache.clear();
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(CLIENT_CACHE_VERSION_KEY, String(CLIENT_CACHE_VERSION));
    }
  }
} catch {}

// ── Re-poll for LinkedIn background results ─────────────────────────

function scheduleRepoll() {
  if (repollTimer) return;
  if (repollCount >= MAX_REPOLLS) {
    // Give up polling — cache null for remaining so we don't loop forever
    for (const email of linkedinPendingEmails) {
      if (!avatarCache.has(email)) avatarCache.set(email, null);
    }
    linkedinPendingEmails.clear();
    repollCount = 0;
    subscribers.forEach((fn) => fn());
    return;
  }
  const delay = REPOLL_DELAYS[Math.min(repollCount, REPOLL_DELAYS.length - 1)];
  repollTimer = setTimeout(() => {
    repollTimer = null;
    repollCount++;
    executeRepoll();
  }, delay);
}

async function executeRepoll() {
  const emails = Array.from(linkedinPendingEmails);
  linkedinPendingEmails.clear();
  if (emails.length === 0) return;

  console.debug(`[Gravatar] Re-poll #${repollCount} for ${emails.length} pending avatar(s)`);

  // Send in chunks of 200 (matching new server limit)
  const CHUNK = 200;
  let totalFound = 0;
  let stillPending = 0;

  for (let i = 0; i < emails.length; i += CHUNK) {
    const chunk = emails.slice(i, i + CHUNK);
    try {
      const res = await fetch(`${API_BASE}/gravatar/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ emails: chunk }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const avatars: Record<string, string | null> = data.avatars ?? {};
        const repollConfidence: Record<string, number> = data.confidence ?? {};
        const pending = data.meta?.linkedin_pending ?? 0;

        for (const email of chunk) {
          if (email in avatars) {
            avatarCache.set(email, avatars[email]);
            if (email in repollConfidence) confidenceCache.set(email, repollConfidence[email]);
            if (avatars[email]) totalFound++;
          } else {
            // Still not ready — keep in pending for next re-poll
            linkedinPendingEmails.add(email);
            stillPending++;
          }
        }
      } else {
        for (const email of chunk) {
          if (!avatarCache.has(email)) avatarCache.set(email, null);
        }
      }
    } catch {
      for (const email of chunk) {
        if (!avatarCache.has(email)) avatarCache.set(email, null);
      }
    }
  }

  if (totalFound > 0) {
    console.debug(`[Gravatar] Re-poll found ${totalFound} avatar(s), ${stillPending} still pending`);
  }

  subscribers.forEach((fn) => fn());

  // If there are still pending emails, schedule another re-poll
  if (linkedinPendingEmails.size > 0) {
    scheduleRepoll();
  } else {
    repollCount = 0; // reset for next batch cycle
  }
}

// ── Batch execution ──────────────────────────────────────────────────

const CLIENT_CHUNK_SIZE = 50; // Smaller chunks since server does SYNC lookups per request (takes ~5-15s)

async function executeBatch() {
  const allEmails = Array.from(pendingEmails);
  pendingEmails.clear();
  if (allEmails.length === 0) return;

  // Collect LinkedIn URL + names maps
  const allLinkedinUrls: Record<string, string> = {};
  const allNames: Record<string, string> = {};
  for (const email of allEmails) {
    const liUrl = pendingLinkedIn.get(email);
    if (liUrl) { allLinkedinUrls[email] = liUrl; pendingLinkedIn.delete(email); }
    const name = pendingNames.get(email);
    if (name) { allNames[email] = name; pendingNames.delete(email); }
  }

  // Send in chunks — each chunk triggers SYNCHRONOUS SerpAPI lookups on server
  for (let i = 0; i < allEmails.length; i += CLIENT_CHUNK_SIZE) {
    const chunk = allEmails.slice(i, i + CLIENT_CHUNK_SIZE);

    // Build per-chunk maps
    const chunkLinkedIn: Record<string, string> = {};
    const chunkNames: Record<string, string> = {};
    for (const email of chunk) {
      if (allLinkedinUrls[email]) chunkLinkedIn[email] = allLinkedinUrls[email];
      if (allNames[email]) chunkNames[email] = allNames[email];
    }

    // Mark in-flight
    for (const e of chunk) inflightEmails.add(e);

    try {
      const body: any = { emails: chunk };
      if (Object.keys(chunkLinkedIn).length > 0) body.linkedin_urls = chunkLinkedIn;
      if (Object.keys(chunkNames).length > 0) body.names = chunkNames;

      const res = await fetch(`${API_BASE}/gravatar/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000), // 45s — server does SYNC SerpAPI lookups
      });

      if (res.ok) {
        const data = await res.json();
        const avatars: Record<string, string | null> = data.avatars ?? {};
        const confidence: Record<string, number> = data.confidence ?? {};
        const pending = data.meta?.linkedin_pending ?? 0;

        for (const email of chunk) {
          if (email in avatars) {
            avatarCache.set(email, avatars[email]);
            if (email in confidence) confidenceCache.set(email, confidence[email]);
          } else {
            // Server couldn't process this email yet (overflow) — queue for re-poll
            linkedinPendingEmails.add(email);
          }
        }

        // Schedule re-poll if there's overflow
        if (pending > 0 || linkedinPendingEmails.size > 0) {
          repollCount = 0;
          scheduleRepoll();
        }
      } else {
        if (res.status !== 404) {
          console.debug(
            `[Gravatar] Batch request failed (${res.status}) - caching null for ${chunk.length} emails`,
          );
        }
        for (const email of chunk) {
          if (!avatarCache.has(email)) avatarCache.set(email, null);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && err.name !== 'TimeoutError') {
        console.debug("[Gravatar] Avatar fetch skipped:", err.message || "Network error");
      }
      for (const email of chunk) {
        if (!avatarCache.has(email)) avatarCache.set(email, null);
      }
    } finally {
      for (const e of chunk) inflightEmails.delete(e);
      subscribers.forEach((fn) => fn());
    }
  }

  // If more emails queued while we were fetching, fire again
  if (pendingEmails.size > 0) scheduleBatch();
}

function scheduleBatch() {
  if (batchTimer) return;
  // 100 ms debounce — long enough to collect emails from an entire list
  // render, short enough to feel instant.
  batchTimer = setTimeout(() => {
    batchTimer = null;
    executeBatch();
  }, 100);
}

// ── Public helpers ───────────────────────────────────────────────────

/**
 * Imperatively request an avatar for `email`.
 * Optionally provide a LinkedIn URL for fallback lookup.
 * Optionally provide the person's name for better image search.
 * Does nothing if already cached or in-flight.
 */
export function requestAvatar(email: string, linkedinUrl?: string, name?: string): void {
  const norm = email.trim().toLowerCase();
  if (!norm) return;
  // Accept either a real email or a synthetic `linkedin:<slug>` key. The
  // synthetic key only makes sense when we ALSO have a LinkedIn URL or a
  // name to look up by — otherwise there's nothing the server can resolve.
  const isRealEmail = norm.includes("@");
  const isLinkedinKey = norm.startsWith("linkedin:") && (!!linkedinUrl || !!name);
  if (!isRealEmail && !isLinkedinKey) return;
  if (avatarCache.has(norm) || pendingEmails.has(norm) || inflightEmails.has(norm)) return;
  pendingEmails.add(norm);
  if (linkedinUrl && linkedinUrl.includes("linkedin.com/")) {
    pendingLinkedIn.set(norm, linkedinUrl);
  }
  if (name && name.trim().length > 1) {
    pendingNames.set(norm, name.trim());
  }
  scheduleBatch();
}

/**
 * Synchronously read the cached avatar URL.
 * Returns `undefined` if not yet fetched.
 */
export function getCachedAvatar(email: string): string | null | undefined {
  const norm = email.trim().toLowerCase();
  if (!norm) return null;
  return avatarCache.has(norm) ? avatarCache.get(norm)! : undefined;
}

/**
 * Pre-warm the cache for a list of leads (e.g. when a lead list loads).
 * Emails already cached are skipped.
 */
export function prefetchAvatars(
  leads: { email?: string | null; linkedinUrl?: string | null; name?: string | null }[],
): void {
  for (const lead of leads) {
    if (lead && lead.email) {
      requestAvatar(lead.email, lead.linkedinUrl || undefined, lead.name || undefined);
    }
  }
}

/**
 * Legacy overload: Pre-warm with just email strings.
 */
export function prefetchAvatarsByEmail(emails: (string | undefined | null)[]): void {
  for (const e of emails) {
    if (e) requestAvatar(e);
  }
}

/**
 * Clear the in-memory avatar cache. Useful when re-running a search
 * to force fresh server lookups (e.g., after a cache version bump).
 */
export function clearAvatarCache(): void {
  avatarCache.clear();
  confidenceCache.clear();
  linkedinPendingEmails.clear();
  repollCount = 0;
}

/**
 * Get the confidence score for a cached avatar.
 * Returns 0 if not cached, or the server-provided confidence (0.0-1.0).
 */
export function getAvatarConfidence(email: string): number {
  const norm = email?.trim().toLowerCase() || "";
  return confidenceCache.get(norm) ?? 0;
}

// ── React Hooks ──────────────────────────────────────────────────────

/**
 * Returns the avatar URL for the given lead using SerpAPI LinkedIn
 * photo lookup. Cached in KV server-side, in-memory client-side.
 *
 * Returns `undefined` while loading, `null` if no avatar found,
 * or a URL string for the avatar image.
 */
export function useLeadAvatar(
  email?: string | null,
  linkedinUrl?: string | null,
  name?: string | null,
): string | null | undefined {
  const normalizedEmail = email?.trim().toLowerCase() || "";
  // When there's no email but we have a LinkedIn URL, key the cache by a
  // synthetic pseudo-email derived from the LinkedIn slug. Without this,
  // every LinkedIn-only lead (very common for freshly-scraped leads) skips
  // the lookup entirely and falls back to initials forever.
  const liSlug = (linkedinUrl || "")
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?linkedin\.com\//, "")
    .replace(/\/+$/, "")
    .replace(/[^a-z0-9/-]/g, "");
  const cacheKey = normalizedEmail || (liSlug ? `linkedin:${liSlug}` : "");

  const [, rerender] = useState(0);

  useEffect(() => {
    if (!cacheKey) return;

    // Subscribe to batch completions
    const update = () => rerender((n) => n + 1);
    subscribers.add(update);

    // Enqueue if not yet cached
    if (!avatarCache.has(cacheKey)) {
      // requestAvatar wants a real-looking email; pseudo-key still works
      // because the server only ever uses it as a cache key alongside the
      // linkedin_urls / names maps.
      requestAvatar(cacheKey, linkedinUrl || undefined, name || undefined);
    }

    return () => {
      subscribers.delete(update);
    };
  }, [cacheKey, linkedinUrl, name]);

  if (!cacheKey) return null;
  if (avatarCache.has(cacheKey)) return avatarCache.get(cacheKey)!;
  return undefined; // still loading
}
