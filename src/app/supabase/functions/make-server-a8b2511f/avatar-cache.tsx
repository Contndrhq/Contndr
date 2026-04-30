import * as kv from "./kv-retry.tsx";

interface CachedAvatar {
  url?: string | null;
  email?: string;
  avatar_confidence?: number;
  cdn_url?: string | null;
  cdn_url_expires?: string | null;
}

interface CachedLinkedInAvatar {
  url?: string | null;
  fetched_at?: string;
  version?: number;
}

export interface InlineAvatar {
  avatarUrl: string | null;
  avatarConfidence: number;
}

async function sha256(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = (email || "").trim().toLowerCase();
  return normalized.includes("@") ? normalized : null;
}

function isSignedUrlUsable(expires: string | null | undefined): boolean {
  if (!expires) return false;
  return new Date(expires).getTime() - Date.now() > 5 * 60 * 1000;
}

function bestAvatarUrl(entry: CachedAvatar | null | undefined): string | null {
  if (!entry) return null;
  if ((entry.avatar_confidence ?? 0) > 0 && (entry.avatar_confidence ?? 0) < 0.75) return null;
  if (entry.cdn_url && isSignedUrlUsable(entry.cdn_url_expires)) return entry.cdn_url;
  return entry.url || null;
}

function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  const normalized = (url || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .replace(/\?.*$/, "")
    .toLowerCase();
  return normalized.includes("linkedin.com/") ? normalized : null;
}

function isLinkedInCacheValid(entry: CachedLinkedInAvatar | null | undefined): boolean {
  if (!entry || !entry.fetched_at) return false;
  if ((entry.version || 0) < 4) return false;
  const age = Date.now() - new Date(entry.fetched_at).getTime();
  const ttl = entry.url ? 14 * 24 * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;
  return age < ttl;
}

export async function getCachedAvatars(
  identities: Array<{ email?: string | null; linkedinUrl?: string | null }>,
): Promise<Map<string, InlineAvatar>> {
  const uniqueEmails = Array.from(new Set(identities.map((i) => normalizeEmail(i.email)).filter(Boolean))) as string[];
  const uniqueLinkedInUrls = Array.from(new Set(identities.map((i) => normalizeLinkedInUrl(i.linkedinUrl)).filter(Boolean))) as string[];
  const result = new Map<string, InlineAvatar>();
  if (uniqueEmails.length === 0 && uniqueLinkedInUrls.length === 0) return result;

  try {
    const hashes = await Promise.all(uniqueEmails.map((email) => sha256(email)));
    const emailKeys = hashes.map((hash) => `gravatar:avatar:${hash}`);
    const linkedinKeys = uniqueLinkedInUrls.map((url) => `linkedin:avatar:${url}`);
    const keys = [...emailKeys, ...linkedinKeys];
    const entries = (await kv.mget(keys)) as Array<CachedAvatar | null>;

    uniqueEmails.forEach((email, index) => {
      const entry = entries[index];
      const avatarUrl = bestAvatarUrl(entry);
      result.set(email, {
        avatarUrl,
        avatarConfidence: entry?.avatar_confidence ?? 0,
      });
    });

    uniqueLinkedInUrls.forEach((url, index) => {
      const entry = entries[emailKeys.length + index] as CachedLinkedInAvatar | null;
      if (!isLinkedInCacheValid(entry)) return;
      result.set(`linkedin:${url}`, {
        avatarUrl: entry?.url || null,
        avatarConfidence: entry?.url ? 0.75 : 0,
      });
    });
  } catch (error: any) {
    console.warn("[AVATAR CACHE] Bulk avatar lookup failed:", error?.message || error);
  }

  return result;
}

export async function attachCachedAvatars<T extends Record<string, any>>(
  rows: T[],
  getEmail: (row: T) => string | null | undefined,
  getLinkedInUrl?: (row: T) => string | null | undefined,
): Promise<T[]> {
  const avatars = await getCachedAvatars(rows.map((row) => ({
    email: getEmail(row),
    linkedinUrl: getLinkedInUrl?.(row),
  })));
  return rows.map((row) => {
    const email = normalizeEmail(getEmail(row));
    const linkedinUrl = normalizeLinkedInUrl(getLinkedInUrl?.(row));
    const avatar = (email ? avatars.get(email) : null) || (linkedinUrl ? avatars.get(`linkedin:${linkedinUrl}`) : null);
    return {
      ...row,
      avatarUrl: avatar?.avatarUrl || null,
      avatar_url: avatar?.avatarUrl || null,
      avatarConfidence: avatar?.avatarConfidence || 0,
      avatar_confidence: avatar?.avatarConfidence || 0,
    };
  });
}
