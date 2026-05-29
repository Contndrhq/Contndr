// ─── LinkedIn Avatar Fetcher via SerpAPI ─────────────────────────────
// Uses SerpAPI's Google search to extract LinkedIn profile/company photos
// from search result thumbnails. Intended as a fallback when Gravatar
// doesn't have an avatar for a lead.
//
// Usage:
//   import { fetchLinkedInPhoto } from "./linkedin-avatar.tsx";
//   const url = await fetchLinkedInPhoto("https://linkedin.com/in/john-doe", apiKey);

import * as kv from "./kv-retry.tsx";
import { serpFetch } from "./serp-adapter.tsx";

// ── Config ───────────────────────────────────────────────────────────
const CACHE_PREFIX = "linkedin:avatar:";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for positive results
const NEGATIVE_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days for "no photo" results
const CACHE_VERSION = 4; // Bumped: invalidate all stale null entries from old batch overflow limits
const SERPAPI_BASE = "https://serpapi.com/search.json";

// ── Types ────────────────────────────────────────────────────────────

interface CachedLinkedInAvatar {
  url: string | null;
  linkedin_url: string;
  fetched_at: string;
  version: number;
  source: "serpapi_google";
}

// ── Cache helpers ────────────────────────────────────────────────────

function cacheKey(linkedinUrl: string): string {
  // Normalize the LinkedIn URL to a stable cache key
  return `${CACHE_PREFIX}${normalizeLinkedInUrl(linkedinUrl)}`;
}

function normalizeLinkedInUrl(url: string): string {
  // Strip protocol, www, trailing slashes, query params
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .replace(/\?.*$/, "")
    .toLowerCase();
}

function isCacheValid(entry: CachedLinkedInAvatar | null): boolean {
  if (!entry || !entry.fetched_at) return false;
  if ((entry.version || 0) < CACHE_VERSION) return false;
  const age = Date.now() - new Date(entry.fetched_at).getTime();
  const ttl = entry.url ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  return age < ttl;
}

// ── Core lookup ──────────────────────────────────────────────────────

/**
 * Fetches a LinkedIn profile photo URL via SerpAPI Google search.
 * Returns the image URL or null if no photo is found.
 *
 * Checks KV cache first; caches results for future lookups.
 */
export async function fetchLinkedInPhoto(
  linkedinUrl: string,
  serpApiKey: string,
  skipCache = false,
  personName?: string,
): Promise<string | null> {
  if (!linkedinUrl || !serpApiKey) return null;

  const normalized = normalizeLinkedInUrl(linkedinUrl);
  if (!normalized.includes("linkedin.com/")) return null;

  // ── Check cache ────────────────────────────────────────────────────
  if (!skipCache) {
    try {
      const cached = (await kv.get(
        cacheKey(linkedinUrl),
      )) as CachedLinkedInAvatar | null;
      if (cached && isCacheValid(cached)) {
        return cached.url;
      }
    } catch {
      // Cache miss, continue
    }
  }

  // ── SerpAPI Google search ──────────────────────────────────────────
  try {
    const photoUrl = await searchGoogleForLinkedInPhoto(
      linkedinUrl,
      serpApiKey,
      personName,
    );

    // Cache the result (positive or negative)
    const entry: CachedLinkedInAvatar = {
      url: photoUrl,
      linkedin_url: linkedinUrl,
      fetched_at: new Date().toISOString(),
      version: CACHE_VERSION,
      source: "serpapi_google",
    };

    try {
      await kv.set(cacheKey(linkedinUrl), entry);
    } catch (kvErr: any) {
      console.log(
        `[LINKEDIN-AVATAR] KV write error for ${normalized}:`,
        kvErr.message,
      );
    }

    return photoUrl;
  } catch (err: any) {
    console.log(
      `[LINKEDIN-AVATAR] Error fetching photo for ${normalized}:`,
      err.message,
    );
    return null;
  }
}

/**
 * Name-only headshot search via SerpAPI Google Images.
 * Used for leads WITHOUT a LinkedIn URL — searches for professional headshots
 * using the person's name + optional company for context.
 * More permissive than Strategy B since there's no LinkedIn URL to slug-match against.
 *
 * Checks KV cache first, keyed by name.
 */
export async function fetchHeadshotByName(
  personName: string,
  companyName: string | undefined,
  serpApiKey: string,
): Promise<string | null> {
  if (!personName || personName.length < 3 || !serpApiKey) return null;

  const nameKey = `headshot:name:${personName.toLowerCase().replace(/\s+/g, '-')}`;

  // Check cache
  try {
    const cached = await kv.get(nameKey) as { url: string | null; fetched_at: string; version: number } | null;
    if (cached && cached.version >= 1 && cached.fetched_at) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      const ttl = cached.url ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
      if (age < ttl) return cached.url;
    }
  } catch {}

  // Build search query — name + company for specificity + "headshot" to bias toward professional photos
  const queryParts = [personName];
  if (companyName && companyName.length > 2) queryParts.push(companyName);
  queryParts.push('headshot');

  const params = new URLSearchParams({
    engine: "google_images",
    q: queryParts.join(' '),
    api_key: serpApiKey,
    num: "5",
    gl: "us",
    hl: "en",
    safe: "active",
  });

  try {
    const res = await serpFetch(`${SERPAPI_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log(`[HEADSHOT] SerpAPI error: ${res.status}`);
      // Cache negative result
      try { await kv.set(nameKey, { url: null, fetched_at: new Date().toISOString(), version: 1 }); } catch {}
      return null;
    }

    const data = await res.json();
    const images = data.images_results || [];

    // Accept LinkedIn-sourced images, professional photo sites, or licdn CDN images
    for (const img of images) {
      const link = (img.link || "").toLowerCase();
      const source = (img.source || "").toLowerCase();
      const originalUrl = (img.original || "").toLowerCase();

      // Skip obviously wrong images (stock photo sites, generic icons)
      if (isStockOrGenericImage(originalUrl || img.original || '')) continue;
      if (isGenericLinkedInImage(img.original || '')) continue;

      // Prefer LinkedIn-sourced results (high confidence for person photos)
      if (link.includes("linkedin.com/in/") || source.includes("linkedin")) {
        if (img.original && !isGenericLinkedInImage(img.original)) {
          console.log(`[HEADSHOT] Found LinkedIn image for "${personName}": ${img.original.slice(0, 80)}`);
          try { await kv.set(nameKey, { url: img.original, fetched_at: new Date().toISOString(), version: 1, source: 'serpapi_name_linkedin' }); } catch {}
          return img.original;
        }
      }

      // Accept licdn CDN images (LinkedIn-hosted)
      if (originalUrl.includes("media.licdn.com/") && img.original) {
        console.log(`[HEADSHOT] Found licdn image for "${personName}": ${img.original.slice(0, 80)}`);
        try { await kv.set(nameKey, { url: img.original, fetched_at: new Date().toISOString(), version: 1, source: 'serpapi_name_licdn' }); } catch {}
        return img.original;
      }
    }

    // No suitable image found
    console.log(`[HEADSHOT] No match for "${personName}"`);
    try { await kv.set(nameKey, { url: null, fetched_at: new Date().toISOString(), version: 1, source: 'none' }); } catch {}
    return null;
  } catch (err: any) {
    console.log(`[HEADSHOT] Error: ${err.message}`);
    try { await kv.set(nameKey, { url: null, fetched_at: new Date().toISOString(), version: 1 }); } catch {}
    return null;
  }
}

/**
 * Detect stock photo / generic image sites that shouldn't be used as person avatars.
 */
function isStockOrGenericImage(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  const stockPatterns = [
    'shutterstock.com', 'istockphoto.com', 'gettyimages.com', 'stock.adobe.com',
    'unsplash.com', 'pexels.com', 'depositphotos.com', 'dreamstime.com',
    'pixabay.com', 'freepik.com', 'placeholder', 'dummy', 'avatar-default',
    'gravatar.com/avatar', 'ui-avatars.com', 'robohash.org',
  ];
  return stockPatterns.some(p => lower.includes(p));
}

/**
 * Batch-check KV cache for multiple LinkedIn URLs.
 * Returns a map of linkedinUrl → cached photo URL (or null).
 * Missing/expired entries are omitted from the result.
 */
export async function getCachedLinkedInPhotos(
  linkedinUrls: string[],
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};

  const checks = await Promise.all(
    linkedinUrls.map(async (url) => {
      try {
        const cached = (await kv.get(
          cacheKey(url),
        )) as CachedLinkedInAvatar | null;
        return { url, cached };
      } catch {
        return { url, cached: null };
      }
    }),
  );

  for (const { url, cached } of checks) {
    if (cached && isCacheValid(cached)) {
      results[normalizeLinkedInUrl(url)] = cached.url;
    }
  }

  return results;
}

// ── SerpAPI integration ──────────────────────────────────────────────

/**
 * Extract the LinkedIn slug from a URL (e.g. "john-doe" from linkedin.com/in/john-doe-123abc).
 * Returns null if it can't extract one.
 */
function extractLinkedInSlug(linkedinUrl: string): string | null {
  const match = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

/**
 * Check whether a result link's LinkedIn slug matches (or closely matches) the target.
 * We compare the slug prefix (stripping trailing hex IDs) rather than exact match
 * because the same person can have slightly different URL variants.
 */
function slugMatches(targetUrl: string, resultLink: string): boolean {
  const targetSlug = extractLinkedInSlug(targetUrl);
  const resultSlug = extractLinkedInSlug(resultLink);
  if (!targetSlug || !resultSlug) return false;
  // Exact match
  if (targetSlug === resultSlug) return true;
  // Strip trailing hex/numeric IDs and compare core slug
  const stripTrailing = (s: string) => s.replace(/-[a-f0-9]{6,}$/i, '').replace(/-\d{3,}$/, '');
  const targetCore = stripTrailing(targetSlug);
  const resultCore = stripTrailing(resultSlug);
  if (targetCore && resultCore && targetCore === resultCore) return true;
  // One starts with the other (handles slug variants)
  if (targetCore.length >= 3 && resultCore.length >= 3) {
    if (targetCore.startsWith(resultCore) || resultCore.startsWith(targetCore)) return true;
  }
  return false;
}

/**
 * Extract a person's name from a LinkedIn URL for image search.
 * e.g. "linkedin.com/in/john-doe-123abc" → "John Doe"
 */
function extractNameFromLinkedInUrl(linkedinUrl: string): string | null {
  const match = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) return null;
  // Strip trailing hex/hash IDs (e.g. "-123abc456")
  const slug = match[1].replace(/-[a-f0-9]{6,}$/i, '');
  // Convert slug to name-like string
  const parts = slug.split('-').filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return null;
  // Capitalise each part
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/**
 * Strategy A: Google web search for the LinkedIn URL (existing approach).
 * Returns image URL or null.
 */
async function searchGoogleWebForLinkedInPhoto(
  linkedinUrl: string,
  apiKey: string,
): Promise<string | null> {
  const normalized = normalizeLinkedInUrl(linkedinUrl);

  const params = new URLSearchParams({
    engine: "google",
    q: normalized,
    api_key: apiKey,
    num: "3",
    gl: "us",
    hl: "en",
  });

  const res = await serpFetch(`${SERPAPI_BASE}?${params.toString()}`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log(
      `[LINKEDIN-AVATAR] SerpAPI web search error: ${res.status} ${body.slice(0, 300)}`,
    );
    return null;
  }

  const data = await res.json();

  // Strategy 1: Check knowledge_graph for image
  if (data.knowledge_graph?.header_images?.[0]?.image) {
    return data.knowledge_graph.header_images[0].image;
  }
  if (data.knowledge_graph?.image) {
    return data.knowledge_graph.image;
  }
  if (data.knowledge_graph?.thumbnail) {
    return data.knowledge_graph.thumbnail;
  }

  // Strategy 2: Check organic results for the LinkedIn page thumbnail
  // Prefer results whose link slug-matches the target URL
  const organicResults = data.organic_results || [];
  for (const result of organicResults) {
    const link = (result.link || "");
    if (link.toLowerCase().includes("linkedin.com/in/") && result.thumbnail) {
      if (slugMatches(linkedinUrl, link) && !isGenericLinkedInImage(result.thumbnail)) {
        return result.thumbnail;
      }
    }
  }
  // Fallback: accept any LinkedIn thumbnail (Strategy A searches the exact URL so results are usually correct)
  for (const result of organicResults) {
    const link = (result.link || "").toLowerCase();
    if (link.includes("linkedin.com/") && result.thumbnail) {
      if (!isGenericLinkedInImage(result.thumbnail)) {
        return result.thumbnail;
      }
    }
  }

  // Strategy 3: Check rich_snippet or sitelinks for images
  for (const result of organicResults) {
    const link = (result.link || "").toLowerCase();
    if (link.includes("linkedin.com/")) {
      if (result.rich_snippet?.top?.extensions) continue;
      if (
        result.rich_snippet?.top?.detected_extensions?.image
      ) {
        return result.rich_snippet.top.detected_extensions.image;
      }
    }
  }

  // Strategy 4: Check inline_images if present
  const inlineImages = data.inline_images || [];
  for (const img of inlineImages) {
    if (img.original && !isGenericLinkedInImage(img.original)) {
      return img.original;
    }
    if (img.thumbnail && !isGenericLinkedInImage(img.thumbnail)) {
      return img.thumbnail;
    }
  }

  return null;
}

/**
 * Strategy B: Google Image search for the person's LinkedIn headshot.
 * Uses "site:linkedin.com/in <name>" as query to find profile photos.
 * Much higher hit rate for actual headshots than web search thumbnails.
 */
async function searchGoogleImagesForLinkedInPhoto(
  linkedinUrl: string,
  apiKey: string,
  personName?: string,
): Promise<string | null> {
  const name = personName || extractNameFromLinkedInUrl(linkedinUrl);
  if (!name) return null;

  const params = new URLSearchParams({
    engine: "google_images",
    q: `site:linkedin.com/in ${name} profile photo`,
    api_key: apiKey,
    num: "5",
    gl: "us",
    hl: "en",
    safe: "active",
  });

  try {
    const res = await serpFetch(`${SERPAPI_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const images = data.images_results || [];

    // Pass 1: Only accept images whose source link matches the target LinkedIn profile slug.
    // This prevents showing Person B's photo for Person A when they share a common name.
    for (const img of images) {
      const link = (img.link || "");
      if (!link.toLowerCase().includes("linkedin.com/in/")) continue;
      if (!slugMatches(linkedinUrl, link)) continue;

      if (img.original && !isGenericLinkedInImage(img.original)) {
        console.log(`[LINKEDIN-AVATAR] Strategy B slug-matched: ${link}`);
        return img.original;
      }
      if (img.thumbnail && !isGenericLinkedInImage(img.thumbnail)) {
        console.log(`[LINKEDIN-AVATAR] Strategy B slug-matched (thumb): ${link}`);
        return img.thumbnail;
      }
    }

    // Pass 2: Accept licdn.com CDN images only if the source page matches the target slug
    for (const img of images) {
      const link = (img.link || "");
      const originalUrl = (img.original || "").toLowerCase();
      if (originalUrl.includes("media.licdn.com/") && !isGenericLinkedInImage(img.original)) {
        // Only accept CDN images if the source link matches our target profile
        if (link.toLowerCase().includes("linkedin.com/in/") && slugMatches(linkedinUrl, link)) {
          console.log(`[LINKEDIN-AVATAR] Strategy B CDN slug-matched: ${link}`);
          return img.original;
        }
      }
    }

    // No slug-verified match found — return null instead of a wrong person's photo
    console.log(`[LINKEDIN-AVATAR] Strategy B: no slug-verified match for ${name} (${extractLinkedInSlug(linkedinUrl)})`);
    return null;
  } catch (err: any) {
    console.log(`[LINKEDIN-AVATAR] Image search error: ${err.message}`);
    return null;
  }
}

/**
 * Combined search: tries web search first (cheap — usually returns knowledge graph),
 * then falls back to Google Image search for higher hit rate on headshots.
 */
async function searchGoogleForLinkedInPhoto(
  linkedinUrl: string,
  apiKey: string,
  personName?: string,
): Promise<string | null> {
  // Strategy A: Google web search (fast, uses knowledge graph)
  const webResult = await searchGoogleWebForLinkedInPhoto(linkedinUrl, apiKey);
  if (webResult) return webResult;

  // Strategy B: Google Image search (higher hit rate for actual headshots)
  const imageResult = await searchGoogleImagesForLinkedInPhoto(linkedinUrl, apiKey, personName);
  if (imageResult) return imageResult;

  return null;
}

/**
 * Detect generic LinkedIn placeholder/logo images that shouldn't be used as avatars.
 */
function isGenericLinkedInImage(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  const genericPatterns = [
    "static.licdn.com/aero", // LinkedIn's generic default images
    "static-exp1.licdn.com/sc/h/", // Static LinkedIn icons
    "linkedin-logo",
    "linkedin_logo",
    "ghost-person", // LinkedIn's default "no photo" image
    "default-avatar",
    "company-ghost",
    "feed-dsa-default",
  ];
  for (const pattern of genericPatterns) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}
