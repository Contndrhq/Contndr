// ══════════════════════════════════════════════════════════════════════════
// Creator Finder — Multi-Platform Creator Discovery Pipeline (v6)
// v6: Full email verification scoring (DNS/MX + disposable/role checks like Lead Finder)
// Platforms: YouTube (Data API), Instagram, TikTok, X (SerpAPI + scraping)
// Incremental processing: POST /run does discovery, GET /runs/:id polls enrich
// one profile per invocation. YouTube uses YouTube Data API, social platforms
// use SerpAPI Google search. All share website scrape + Hunter.io enrichment.
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { getUserSubscriptionStatus } from "./contndr-billing.tsx";
import { checkMxRecords, verifyEmail } from "./email-verify.tsx";
import {
  discoverProfiles as discoverSocialProfiles,
  enrichSocialProfile,
  scrapeLinkedWebsitesForEmails as scrapeWebsites,
  hunterDomainSearch,
  hunterEmailFinder,
  findymailEmailSearch,
  serpApiEmailFallback,
  cleanCreatorName,
  type SocialPlatform,
  type DiscoveredProfile,
  type FetchedProfile,
} from "./social-creator-providers.tsx";

const app = new Hono();
app.use("*", cors());

// ── Auth helper ──
async function getAuthenticatedUser(c: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) throw new Error("No Authorization header");
  const token = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "CREATOR-FINDER");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ══════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════

type Platform = "youtube" | "instagram" | "tiktok" | "x";

interface KeywordInput {
  keyword: string;
  num_of_posts: number;
}

interface DiscoveredChannel {
  channel_id: string;
  channel_name: string;
  channel_url: string;
  keywords: Set<string>;
}

interface ScrapedChannel {
  channel_url: string;
  channel_name: string;
  subscribers: string;
  subscribers_int: number;
  description: string;
  links: string[];
  emails: string[];
}

// Unified result type (normalized across all platforms)
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
  status: "email_found" | "no_email" | "error" | "suppressed";
  created_at: string;
  // Email verification (DNS/MX validated like Lead Finder)
  email_verification?: {
    status: "valid" | "risky" | "invalid" | "unknown";
    score: number;
    mx_valid: boolean;
    is_free_provider: boolean;
    is_disposable: boolean;
  } | null;
  // Engagement metrics
  phone_numbers?: string[];
  engagement_rate?: number;
  avg_likes?: number;
  avg_comments?: number;
  posts_analyzed?: number;
  // Legacy YouTube compat fields
  channel_url?: string;
  channel_name?: string;
  subscribers_text?: string;
  subscribers_int?: number;
  description?: string;
  links?: string[];
}

interface CreatorRun {
  id: string;
  user_id: string;
  platforms: Platform[];
  provider: string;
  status: "queued" | "running" | "step_videos" | "step_channels" | "step_emails" | "step_discovery" | "step_enrichment" | "step_finalize" | "step_mx" | "completed" | "failed";
  status_message?: string;
  created_at: string;
  completed_at?: string;
  input_keywords: KeywordInput[];
  total_videos_found: number;
  unique_channels_found: number;
  channels_with_emails: number;
  channels_scraped?: number;
  // Multi-platform stats
  total_profiles_discovered: number;
  profiles_enriched: number;
  error_text?: string;
}

// ══════════════════════════════════════════════════════════════════════════
// YOUTUBE DATA API v3
// ══════════════════════════════════════════════════════════════════════════

const YT_API_KEY = () => Deno.env.get("YOUTUBE_API_KEY") || "";
const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

async function youtubeSearchVideos(
  keyword: string,
  maxResults: number = 50
): Promise<{ channelId: string; channelTitle: string; videoTitle: string }[]> {
  const apiKey = YT_API_KEY();
  if (!apiKey) throw new Error("YOUTUBE_API_KEY not configured");

  const results: { channelId: string; channelTitle: string; videoTitle: string }[] = [];
  let pageToken: string | undefined;
  const perPage = Math.min(maxResults, 50);
  const maxPages = Math.ceil(maxResults / perPage);

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      part: "snippet",
      q: keyword,
      type: "video",
      maxResults: String(perPage),
      order: "relevance",
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `${YT_API_BASE}/search?${params.toString()}`;
    console.log(`[CREATOR-FINDER] YT API search: keyword="${keyword}" page=${page}`);

    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[CREATOR-FINDER] YT API search error ${res.status}: ${errText}`);
      // Gracefully stop pagination on quota exceeded instead of throwing
      if (res.status === 403 && errText.includes("quota")) {
        console.warn(`[CREATOR-FINDER] YouTube API quota exceeded — returning ${results.length} results collected so far`);
        break;
      }
      throw new Error(`YouTube API search error: ${res.status} — ${errText}`);
    }

    const data = await res.json();
    const items = data.items || [];

    for (const item of items) {
      const snippet = item.snippet || {};
      const channelId = snippet.channelId || "";
      const channelTitle = snippet.channelTitle || "";
      const videoTitle = snippet.title || "";
      if (channelId) {
        results.push({ channelId, channelTitle, videoTitle });
      }
    }

    console.log(`[CREATOR-FINDER] YT API page ${page}: ${items.length} videos, ${results.length} total`);

    pageToken = data.nextPageToken;
    if (!pageToken || results.length >= maxResults) break;
  }

  return results.slice(0, maxResults);
}

async function youtubeGetChannels(
  channelIds: string[]
): Promise<Map<string, {
  channelId: string;
  title: string;
  customUrl: string;
  description: string;
  subscriberCount: number;
  subscriberText: string;
  viewCount: number;
  videoCount: number;
  thumbnailUrl: string;
  country: string;
  publishedAt: string;
}>> {
  const apiKey = YT_API_KEY();
  if (!apiKey) throw new Error("YOUTUBE_API_KEY not configured");

  const result = new Map<string, any>();
  const BATCH = 50;

  for (let i = 0; i < channelIds.length; i += BATCH) {
    const batch = channelIds.slice(i, i + BATCH);
    const params = new URLSearchParams({
      part: "snippet,statistics,brandingSettings",
      id: batch.join(","),
      key: apiKey,
    });

    const url = `${YT_API_BASE}/channels?${params.toString()}`;
    console.log(`[CREATOR-FINDER] YT API channels: batch ${Math.floor(i / BATCH) + 1}, ${batch.length} IDs`);

    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[CREATOR-FINDER] YT API channels error ${res.status}: ${errText}`);
      if (res.status === 403 && errText.includes("quota")) {
        console.warn(`[CREATOR-FINDER] YouTube API quota exceeded during channel fetch — returning ${result.size} channels so far`);
        break;
      }
      continue;
    }

    const data = await res.json();
    for (const item of (data.items || [])) {
      const snippet = item.snippet || {};
      const stats = item.statistics || {};
      const branding = item.brandingSettings?.channel || {};
      const subCount = parseInt(stats.subscriberCount || "0");

      result.set(item.id, {
        channelId: item.id,
        title: snippet.title || "",
        customUrl: snippet.customUrl || "",
        description: snippet.description || "",
        subscriberCount: subCount,
        subscriberText: formatSubscribers(subCount),
        viewCount: parseInt(stats.viewCount || "0"),
        videoCount: parseInt(stats.videoCount || "0"),
        thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
        country: snippet.country || branding.country || "",
        publishedAt: snippet.publishedAt || "",
      });
    }

    if (i + BATCH < channelIds.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return result;
}

function formatSubscribers(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B subscribers`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M subscribers`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K subscribers`;
  return `${count} subscribers`;
}

// ══════════════════════════════════════════════════════════════════════════
// YOUTUBE SERPAPI FALLBACK (when YouTube Data API quota is exhausted)
// Discovers YouTube channels via Google search, scrapes channel pages for metadata.
// ══════════════════════════════════════════════════════════════════════════

const SERPAPI_KEY = () => Deno.env.get("SERPAPI_API_KEY") || "";

async function youtubeSearchViaSerpApi(
  keyword: string,
  maxResults: number
): Promise<{ channelId: string; channelTitle: string; channelUrl: string }[]> {
  const apiKey = SERPAPI_KEY();
  if (!apiKey) {
    console.warn("[CREATOR-FINDER] SERPAPI_API_KEY not set, cannot use YouTube SerpAPI fallback");
    return [];
  }

  const queries = [
    `site:youtube.com ${keyword} channel`,
    `site:youtube.com/@* ${keyword}`,
    `site:youtube.com ${keyword} creator`,
  ];

  const results: { channelId: string; channelTitle: string; channelUrl: string }[] = [];
  const seenKeys = new Set<string>();

  for (const query of queries) {
    if (results.length >= maxResults) break;
    try {
      const params = new URLSearchParams({
        engine: "google",
        q: query,
        api_key: apiKey,
        num: String(Math.min(maxResults * 2, 40)),
      });

      const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`[CREATOR-FINDER] SerpAPI YouTube fallback error ${res.status} for "${keyword}"`);
        continue;
      }

      const data = await res.json();
      for (const item of (data.organic_results || [])) {
        const url = item.link || "";
        if (!url) continue;

        const normalized = normalizeYouTubeSerpResult(url);
        if (!normalized) continue;

        const key = normalized.channelId || normalized.channelUrl;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const title = (item.title || "").replace(/\s*[-–—]\s*YouTube\s*$/i, "").trim();
        results.push({ channelId: normalized.channelId, channelTitle: title, channelUrl: normalized.channelUrl });
        if (results.length >= maxResults) break;
      }
    } catch (err: any) {
      console.warn(`[CREATOR-FINDER] SerpAPI YouTube fallback error for "${keyword}": ${err.message}`);
    }
  }

  console.log(`[CREATOR-FINDER] SerpAPI YouTube fallback: found ${results.length} channels for "${keyword}"`);
  return results;
}

function normalizeYouTubeSerpResult(url: string): { channelId: string; channelUrl: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("youtube.com")) return null;
    const path = u.pathname;

    // Direct channel ID: /channel/UCxxxxxx
    const channelIdMatch = path.match(/^\/channel\/(UC[\w-]+)/);
    if (channelIdMatch) {
      return { channelId: channelIdMatch[1], channelUrl: `https://www.youtube.com/channel/${channelIdMatch[1]}` };
    }

    // Handle URL: /@handle or /c/handle or /user/handle
    const handleMatch = path.match(/^\/([@][\w.-]+|c\/[\w.-]+|user\/[\w.-]+)/);
    if (handleMatch) {
      const raw = handleMatch[1];
      const handle = raw.replace(/^(c\/|user\/)/, "");
      return {
        channelId: `handle:${handle.replace(/^@/, "")}`,
        channelUrl: `https://www.youtube.com/${raw.startsWith("@") ? raw : `@${handle}`}`,
      };
    }

    return null; // Skip videos, playlists, shorts, etc.
  } catch {
    return null;
  }
}

/**
 * Scrape YouTube channel pages for metadata when Data API quota is exhausted.
 * Extracts name, subscriber count, description, thumbnail from server-rendered ytInitialData + meta tags.
 */
async function youtubeGetChannelsByScraping(
  channels: { channelId: string; channelUrl: string; channelTitle: string }[]
): Promise<Map<string, {
  channelId: string; title: string; customUrl: string; description: string;
  subscriberCount: number; subscriberText: string; viewCount: number; videoCount: number;
  thumbnailUrl: string; country: string; publishedAt: string; _resolvedChannelId?: string;
}>> {
  const result = new Map<string, any>();
  const UA_S = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const BATCH = 3;

  for (let i = 0; i < channels.length; i += BATCH) {
    const batch = channels.slice(i, i + BATCH);
    const scrapeResults = await Promise.allSettled(
      batch.map(async (ch) => {
        const res = await fetch(ch.channelUrl.replace(/\/$/, ""), {
          headers: { "User-Agent": UA_S, "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No body");
        let html = "";
        const decoder = new TextDecoder();
        let bytesRead = 0;
        while (bytesRead < 200_000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += decoder.decode(value, { stream: true });
          bytesRead += value.byteLength;
        }
        reader.cancel().catch(() => {});
        return { ch, html };
      })
    );

    for (const sr of scrapeResults) {
      if (sr.status !== "fulfilled") continue;
      const { ch, html } = sr.value;

      try {
        const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/)?.[1] || "";
        const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/)?.[1] || "";
        const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/)?.[1] || "";
        const ogUrl = html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/)?.[1] || "";

        // ── Subscriber count extraction (multiple strategies) ──
        let subscriberCount = 0;
        let subscriberText = "";

        // Strategy 1: ytInitialData subscriberCountText — may have "simpleText" at any position
        const subSimpleText = html.match(/"subscriberCountText"[^}]*"simpleText"\s*:\s*"([^"]+)"/);
        if (subSimpleText) {
          subscriberText = subSimpleText[1]; // e.g. "1.2M subscribers"
          subscriberCount = parseSubscribers(subscriberText);
        }

        // Strategy 2: accessibilityData label (always present, more reliable)
        if (!subscriberCount) {
          const subAccessibility = html.match(/"subscriberCountText"[^}]*"label"\s*:\s*"([^"]+)"/);
          if (subAccessibility) {
            subscriberText = subAccessibility[1]; // e.g. "1.04 million subscribers"
            subscriberCount = parseSubscriberLabel(subscriberText);
          }
        }

        // Strategy 3: meta description often has "XXK subscribers"
        if (!subscriberCount) {
          const metaDesc = html.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1] || "";
          const subMatch = metaDesc.match(/([\d,.]+\s*[KkMmBb]?)\s+subscribers?/);
          if (subMatch) {
            subscriberCount = parseSubscribers(subMatch[1]);
            subscriberText = subMatch[0];
          }
        }

        // Strategy 4: og:description (e.g. "... · 1.2M subscribers · ...")
        if (!subscriberCount) {
          const subOgMatch = ogDesc.match(/([\d,.]+\s*[KkMmBb]?)\s+subscribers?/i);
          if (subOgMatch) {
            subscriberCount = parseSubscribers(subOgMatch[1]);
            subscriberText = subOgMatch[0];
          }
        }

        // ── Channel description ──
        let description = ogDesc;
        const descMatch = html.match(/"description"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]{0,2000})"/);
        if (descMatch) {
          description = descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }

        // ── Real channel ID ──
        let realChannelId = ch.channelId;
        const cidMatch = html.match(/"channelId"\s*:\s*"(UC[\w-]+)"/);
        if (cidMatch) realChannelId = cidMatch[1];
        if (realChannelId.startsWith("handle:")) {
          const metaCidMatch = html.match(/<meta\s+itemprop="channelId"\s+content="(UC[\w-]+)"/);
          if (metaCidMatch) realChannelId = metaCidMatch[1];
        }

        // ── Custom URL / handle ──
        let customUrl = "";
        const vanityMatch = html.match(/"vanityChannelUrl"\s*:\s*"[^"]*\/([@\w.-]+)"/);
        if (vanityMatch) {
          customUrl = vanityMatch[1].startsWith("@") ? vanityMatch[1] : `@${vanityMatch[1]}`;
        } else if (ogUrl.includes("/@")) {
          const handle = ogUrl.split("/@")[1]?.split("/")[0] || "";
          if (handle) customUrl = `@${handle}`;
        }

        const title = ogTitle.replace(/\s*[-–—]\s*YouTube\s*$/i, "").trim() || ch.channelTitle;

        result.set(ch.channelId, {
          channelId: realChannelId,
          title,
          customUrl,
          description: description.slice(0, 1000),
          subscriberCount,
          subscriberText: subscriberCount > 0 ? formatSubscribers(subscriberCount) : subscriberText || "0 subscribers",
          viewCount: 0,
          videoCount: 0,
          thumbnailUrl: ogImage,
          country: "",
          publishedAt: "",
          _resolvedChannelId: realChannelId,
        });

        console.log(`[CREATOR-FINDER] Scraped YT channel: "${title}" subs=${subscriberCount} (${subscriberCount > 0 ? formatSubscribers(subscriberCount) : "unknown"})`);
      } catch (parseErr: any) {
        console.warn(`[CREATOR-FINDER] YT channel scrape parse error for ${ch.channelUrl}: ${parseErr.message}`);
      }
    }

    if (i + BATCH < channels.length) await new Promise(r => setTimeout(r, 200));
  }

  return result;
}

/** Parse subscriber label like "1.04 million subscribers" → 1040000 */
function parseSubscriberLabel(label: string): number {
  if (!label) return 0;
  const m = label.match(/([\d,.]+)\s*(thousand|million|billion)?/i);
  if (!m) return 0;
  let num = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "thousand") num *= 1_000;
  else if (unit === "million") num *= 1_000_000;
  else if (unit === "billion") num *= 1_000_000_000;
  return Math.round(num);
}

// ══════════════════════════════════════════════════════════════════════════
// LIGHTWEIGHT ABOUT PAGE SCRAPER (links + email extraction only)
// ══════════════════════════════════════════════════════════════════════════

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function scrapeChannelLinksAndEmails(channelUrl: string): Promise<{ links: string[]; emails: string[] }> {
  const empty = { links: [], emails: [] };
  try {
    let aboutUrl = channelUrl.replace(/\/$/, "");
    if (!aboutUrl.endsWith("/about")) aboutUrl += "/about";

    const res = await fetch(aboutUrl, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return empty;

    // Stream-read with size limit to avoid CPU exhaustion on large pages
    const reader = res.body?.getReader();
    if (!reader) return empty;
    let html = "";
    const decoder = new TextDecoder();
    let bytesRead = 0;
    const MAX_BYTES = 150_000;
    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytesRead += value.byteLength;
    }
    reader.cancel().catch(() => {});

    // ── Extract ytInitialData JSON blob ──
    const jsonMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    const rawJson = jsonMatch?.[1] || "";

    // ── External links ──
    const links: string[] = [];
    const linkRegex = /"url":\s*"(https?:\/\/(?:www\.)?(?!youtube\.com|youtu\.be|google\.|gstatic\.com|ggpht\.com|googleusercontent\.com|ytimg\.com)[^"]+)"/g;
    let lm;
    while ((lm = linkRegex.exec(rawJson)) !== null) {
      let link = lm[1];
      if (link.includes("youtube.com/redirect")) {
        const qMatch = link.match(/[?&]q=([^&]+)/);
        if (qMatch) link = decodeURIComponent(qMatch[1]);
      }
      if (link && !link.includes("youtube.com") && !link.includes("accounts.google")) {
        links.push(link);
      }
    }

    // ── Emails ──
    const emails = extractEmails(rawJson, html.slice(0, 50000));

    return { links: [...new Set(links)], emails };
  } catch (err: any) {
    console.warn(`[CREATOR-FINDER] Light scrape error for ${channelUrl}: ${err.message}`);
    return empty;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EMAIL EXTRACTION
// ══════════════════════════════════════════════════════════════════════════

const EMAIL_REGEX = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+/g;

const EMAIL_BLOCKLIST = new Set([
  "example@example.com", "test@test.com", "user@domain.com",
  "name@domain.com", "email@domain.com", "your@email.com",
]);

const JUNK_DOMAINS = new Set([
  "sentry.io", "sentry-next.wixpress.com", "googleusercontent.com",
  "youtube.com", "googleapis.com", "gstatic.com", "google.com",
  "ytimg.com", "ggpht.com", "w3.org", "schema.org",
  "mozilla.org", "chromium.org", "apple.com",
]);

function extractEmails(...sources: string[]): string[] {
  const combined = sources.join(" ");
  const matches = combined.match(EMAIL_REGEX) || [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of matches) {
    const email = raw.toLowerCase().trim();
    if (seen.has(email)) continue;
    seen.add(email);
    if (EMAIL_BLOCKLIST.has(email)) continue;
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|css|js)$/i.test(email)) continue;
    const domain = email.split("@")[1];
    if (domain && JUNK_DOMAINS.has(domain)) continue;
    if (email.length > 80) continue;
    result.push(email);
  }
  return result;
}

// ── Phone number extraction ──
const PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}[-.\s]?\d{4,14}/g;
const PHONE_BLOCKLIST = new Set(["0000000000", "1234567890", "1111111111", "9999999999"]);

function extractPhoneNumbers(...sources: string[]): string[] {
  const combined = sources.join(" ");
  const matches = combined.match(PHONE_REGEX) || [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of matches) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue;
    if (seen.has(digits)) continue;
    if (PHONE_BLOCKLIST.has(digits)) continue;
    seen.add(digits);
    result.push(raw.trim());
  }
  return result.slice(0, 3); // Max 3 phones per profile
}

function parseSubscribers(raw: string): number {
  if (!raw) return 0;
  const s = raw.replace(/[,\s]/g, "").toLowerCase();
  const m = s.match(/([\d.]+)\s*(k|m|b)?/i);
  if (!m) return 0;
  let num = parseFloat(m[1]);
  if (m[2] === "k") num *= 1000;
  else if (m[2] === "m") num *= 1000000;
  else if (m[2] === "b") num *= 1000000000;
  return Math.round(num);
}

function normalizeChannelUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://www.youtube.com${url.startsWith("/") ? url : `/${url}`}`);
    const path = u.pathname;
    if (path.startsWith("/@") || path.startsWith("/channel/") || path.startsWith("/c/") || path.startsWith("/user/")) {
      return `https://www.youtube.com${path}`.replace(/\/$/, "");
    }
    return url.replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ENRICHMENT SOURCE 2: YouTube Video Descriptions (via YT Data API v3)
// ══════════════════════════════════════════════════════════════════════════

async function fetchVideoDescriptionEmails(channelId: string): Promise<{ emails: string[]; source: string }> {
  const empty = { emails: [], source: "video_desc" };
  const apiKey = YT_API_KEY();
  if (!apiKey) return empty;

  try {
    const searchParams = new URLSearchParams({
      part: "id",
      channelId,
      type: "video",
      order: "date",
      maxResults: "5",
      key: apiKey,
    });

    const searchRes = await fetch(`${YT_API_BASE}/search?${searchParams.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) return empty;

    const searchData = await searchRes.json();
    const videoIds = (searchData.items || [])
      .map((item: any) => item.id?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) return empty;

    const videoParams = new URLSearchParams({
      part: "snippet",
      id: videoIds.join(","),
      key: apiKey,
    });

    const videoRes = await fetch(`${YT_API_BASE}/videos?${videoParams.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!videoRes.ok) return empty;

    const videoData = await videoRes.json();
    const descriptions = (videoData.items || [])
      .map((item: any) => item.snippet?.description || "")
      .filter(Boolean);

    if (descriptions.length === 0) return empty;

    const allText = descriptions.join("\n");
    const emails = extractEmails(allText);

    if (emails.length > 0) {
      console.log(`[CREATOR-FINDER] Video descriptions for ${channelId}: found ${emails.length} emails`);
    }

    return { emails, source: "video_desc" };
  } catch (err: any) {
    console.warn(`[CREATOR-FINDER] Video desc fetch error for ${channelId}: ${err.message}`);
    return empty;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ENRICHMENT SOURCE 3: Linked Website Scraping
// ══════════════════════════════════════════════════════════════════════════

const SKIP_WEBSITE_DOMAINS = new Set([
  "twitter.com", "x.com", "instagram.com", "facebook.com", "fb.com",
  "tiktok.com", "twitch.tv", "discord.gg", "discord.com", "reddit.com",
  "linkedin.com", "pinterest.com", "snapchat.com", "threads.net",
  "patreon.com", "ko-fi.com", "buymeacoffee.com", "gofundme.com",
  "bit.ly", "linktr.ee", "linkin.bio", "beacons.ai", "stan.store",
  "amazon.com", "amzn.to", "ebay.com", "etsy.com",
  "spotify.com", "apple.com", "music.apple.com", "soundcloud.com",
  "play.google.com", "apps.apple.com",
]);

async function scrapeLinkedWebsitesForEmails(links: string[]): Promise<{ emails: string[]; domains_scraped: string[]; phone_numbers?: string[] }> {
  const empty = { emails: [], domains_scraped: [], phone_numbers: [] };
  if (!links || links.length === 0) return empty;

  const scrapeable = links.filter(link => {
    try {
      const u = new URL(link);
      const host = u.hostname.replace(/^www\./, "");
      return !SKIP_WEBSITE_DOMAINS.has(host);
    } catch { return false; }
  }).slice(0, 1); // Only scrape 1 website max for CPU efficiency

  if (scrapeable.length === 0) return empty;

  const allEmails: string[] = [];
  const allPhones: string[] = [];
  const domainsDone: string[] = [];

  for (const siteUrl of scrapeable) {
    try {
      const u = new URL(siteUrl);
      const domain = u.hostname.replace(/^www\./, "");
      domainsDone.push(domain);

      // Only scrape homepage + /contact (2 pages max for CPU budget)
      const pages = [siteUrl, `${u.origin}/contact`];

      for (const pageUrl of pages) {
        try {
          const res = await fetch(pageUrl, {
            headers: {
              "User-Agent": UA,
              "Accept": "text/html",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(4000),
            redirect: "follow",
          });

          if (!res.ok) continue;

          const contentType = res.headers.get("content-type") || "";
          if (!contentType.includes("text/html")) continue;

          const reader = res.body?.getReader();
          if (!reader) continue;

          let text = "";
          const decoder = new TextDecoder();
          let bytesRead = 0;
          const MAX_BYTES = 80_000; // Reduced from 100KB to 80KB

          while (bytesRead < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            bytesRead += value.byteLength;
          }
          reader.cancel().catch(() => {});

          const emails = extractEmails(text);
          const phones = extractPhoneNumbers(text);
          allEmails.push(...emails);
          allPhones.push(...phones);
          if (allEmails.length >= 2) break; // Stop early if found emails
        } catch {
          // Individual page fetch failed — continue to next
        }
      }
    } catch (err: any) {
      console.warn(`[CREATOR-FINDER] Website scrape error for ${siteUrl}: ${err.message}`);
    }
  }

  const uniqueEmails = [...new Set(allEmails)];
  if (uniqueEmails.length > 0) {
    console.log(`[CREATOR-FINDER] Linked website scrape: found ${uniqueEmails.length} emails from ${domainsDone.join(", ")}`);
  }

  const uniquePhones = [...new Set(allPhones)].slice(0, 3);
  return { emails: uniqueEmails, domains_scraped: domainsDone, phone_numbers: uniquePhones };
}

// ══════════════════════════════════════════════════════════════════════════
// ENRICHMENT SOURCE 4: Hunter.io Domain Search
// ══════════════════════════════════════════════════════════════════════════

const HUNTER_API_KEY = () => Deno.env.get("HUNTER_API_KEY") || "";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "zoho.com", "yandex.com",
  "live.com", "msn.com", "gmx.com", "tutanota.com", "fastmail.com",
]);

async function hunterDomainSearchLocal(domain: string): Promise<{ emails: string[]; source: string }> {
  const empty = { emails: [], source: "hunter" };
  const apiKey = HUNTER_API_KEY();
  if (!apiKey) return empty;

  if (FREE_EMAIL_DOMAINS.has(domain) || SKIP_WEBSITE_DOMAINS.has(domain)) return empty;

  try {
    const params = new URLSearchParams({
      domain,
      api_key: apiKey,
      limit: "5",
    });

    const res = await fetch(`https://api.hunter.io/v2/domain-search?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`[CREATOR-FINDER] Hunter.io rate limit hit for domain ${domain}`);
      }
      return empty;
    }

    const data = await res.json();
    const hunterEmails: string[] = [];

    for (const item of (data?.data?.emails || [])) {
      const email = item?.value?.toLowerCase();
      if (email && !EMAIL_BLOCKLIST.has(email)) {
        hunterEmails.push(email);
      }
    }

    if (hunterEmails.length > 0) {
      console.log(`[CREATOR-FINDER] Hunter.io found ${hunterEmails.length} emails for ${domain}`);
    }

    return { emails: hunterEmails, source: "hunter" };
  } catch (err: any) {
    console.warn(`[CREATOR-FINDER] Hunter.io error for ${domain}: ${err.message}`);
    return empty;
  }
}

function extractBestDomainForHunter(links: string[]): string | null {
  for (const link of links) {
    try {
      const u = new URL(link);
      const domain = u.hostname.replace(/^www\./, "");
      if (SKIP_WEBSITE_DOMAINS.has(domain)) continue;
      if (FREE_EMAIL_DOMAINS.has(domain)) continue;
      if (domain.includes(".") && domain.length > 3) {
        return domain;
      }
    } catch { /* skip bad URLs */ }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// MULTI-SOURCE ENRICHMENT ORCHESTRATOR (YouTube only)
// ══════════════════════════════════════════════════════════════════════════

interface EnrichedEmailResult {
  emails: string[];
  email_sources: Record<string, string>;
  links: string[];
  enrichment_sources_used: string[];
  phone_numbers: string[];
}

async function enrichChannel(
  channelId: string,
  channelUrl: string,
  channelDescription: string,
  channelName?: string,
): Promise<EnrichedEmailResult> {
  const emailSourceMap: Record<string, string> = {};
  const allLinks: string[] = [];
  const allPhones: string[] = [];
  const sourcesUsed: string[] = [];

  // ── Source 1: Channel description ──
  const descEmails = extractEmails(channelDescription || "");
  for (const e of descEmails) {
    if (!emailSourceMap[e]) emailSourceMap[e] = "description";
  }
  if (descEmails.length > 0) sourcesUsed.push("description");

  // ── Source 2 + 3: Run in parallel ──
  const [aboutResult, videoResult] = await Promise.allSettled([
    scrapeChannelLinksAndEmails(channelUrl),
    fetchVideoDescriptionEmails(channelId),
  ]);

  let aboutLinks: string[] = [];
  if (aboutResult.status === "fulfilled") {
    const about = aboutResult.value;
    aboutLinks = about.links || [];
    allLinks.push(...aboutLinks);
    for (const e of about.emails) {
      if (!emailSourceMap[e]) emailSourceMap[e] = "about_page";
    }
    if (about.emails.length > 0) sourcesUsed.push("about_page");
  }

  if (videoResult.status === "fulfilled") {
    for (const e of videoResult.value.emails) {
      if (!emailSourceMap[e]) emailSourceMap[e] = "video_desc";
    }
    if (videoResult.value.emails.length > 0) sourcesUsed.push("video_desc");
  }

  // ── Source 4 + 5: Website scrape + Hunter domain search (only if no emails yet) ──
  const hunterDomain = extractBestDomainForHunter(aboutLinks);
  if (aboutLinks.length > 0 && Object.keys(emailSourceMap).length === 0) {
    const [websiteResult, hunterResult] = await Promise.allSettled([
      scrapeLinkedWebsitesForEmails(aboutLinks),
      hunterDomain ? hunterDomainSearchLocal(hunterDomain) : Promise.resolve({ emails: [], source: "hunter" }),
    ]);

    if (websiteResult.status === "fulfilled") {
      for (const e of websiteResult.value.emails) {
        if (!emailSourceMap[e]) emailSourceMap[e] = "website";
      }
      if (websiteResult.value.emails.length > 0) sourcesUsed.push("website");
      if (websiteResult.value.phone_numbers) allPhones.push(...websiteResult.value.phone_numbers);
    }

    if (hunterResult.status === "fulfilled") {
      for (const e of hunterResult.value.emails) {
        if (!emailSourceMap[e]) emailSourceMap[e] = "hunter";
      }
      if (hunterResult.value.emails.length > 0) sourcesUsed.push("hunter");
    }
  }

  // ── Source 6: Hunter.io email finder (name + domain) ──
  const nameForLookup = channelName || "";
  if (hunterDomain && nameForLookup && Object.keys(emailSourceMap).length === 0) {
    try {
      const finderResult = await hunterEmailFinder(nameForLookup, hunterDomain);
      for (const e of finderResult.emails) {
        if (!emailSourceMap[e]) emailSourceMap[e] = "hunter_finder";
      }
      if (finderResult.emails.length > 0) sourcesUsed.push("hunter_finder");
    } catch (err: any) {
      console.warn(`[CREATOR-FINDER] Hunter email finder error for ${channelId}: ${err.message}`);
    }
  }

  // ── Source 7: Findymail email search (name + domain) ──
  if (hunterDomain && nameForLookup && Object.keys(emailSourceMap).length === 0) {
    try {
      const findymailResult = await findymailEmailSearch(nameForLookup, hunterDomain);
      for (const e of findymailResult.emails) {
        if (!emailSourceMap[e]) emailSourceMap[e] = "findymail";
      }
      if (findymailResult.emails.length > 0) sourcesUsed.push("findymail");
    } catch (err: any) {
      console.warn(`[CREATOR-FINDER] Findymail error for ${channelId}: ${err.message}`);
    }
  }

  // ── Source 8: SerpAPI email fallback — runs even if no links were found ──
  if (Object.keys(emailSourceMap).length === 0 && nameForLookup) {
    try {
      const serpResult = await serpApiEmailFallback(nameForLookup, channelId);
      for (const e of serpResult.emails) {
        if (!emailSourceMap[e]) emailSourceMap[e] = "serpapi";
      }
      if (serpResult.emails.length > 0) sourcesUsed.push("serpapi");
    } catch (err: any) {
      console.warn(`[CREATOR-FINDER] SerpAPI fallback error for ${channelId}: ${err.message}`);
    }
  }

  const allEmails = Object.keys(emailSourceMap);

  // Extract phone numbers from description + any scraped sources
  const descPhones = extractPhoneNumbers(channelDescription || "");
  allPhones.push(...descPhones);
  const uniquePhones = [...new Set(allPhones)].slice(0, 3);

  console.log(`[CREATOR-FINDER] Enrichment for ${channelId}: ${allEmails.length} emails, ${uniquePhones.length} phones from ${sourcesUsed.length} sources [${sourcesUsed.join(", ")}]`);

  return {
    emails: allEmails,
    email_sources: emailSourceMap,
    links: [...new Set(allLinks)],
    enrichment_sources_used: sourcesUsed,
    phone_numbers: uniquePhones,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// KV STORAGE HELPERS
// ══════════════════════════════════════════════════════════════════════════

const RUN_PREFIX = "creator-finder:run:";
const RESULTS_PREFIX = "creator-finder:results:";
const USER_RUNS_PREFIX = "creator-finder:user-runs:";
const DAILY_COUNT_PREFIX = "creator-finder:daily:";
const QUEUE_PREFIX = "creator-finder:queue:";
const SCRAPED_PREFIX = "creator-finder:scraped:";
const CHANNELS_PREFIX = "creator-finder:channels:";
const API_DETAILS_PREFIX = "creator-finder:apidet:";
// Social platform KV keys
const SOCIAL_QUEUE_PREFIX = "creator-finder:socqueue:";
const SOCIAL_PROFILES_PREFIX = "creator-finder:socprofiles:";
const SOCIAL_ENRICHED_PREFIX = "creator-finder:socenriched:";

const SCRAPE_BATCH_SIZE = 3;

async function saveRun(run: CreatorRun) {
  await kv.set(`${RUN_PREFIX}${run.id}`, JSON.stringify(run));
}

async function getRun(runId: string): Promise<CreatorRun | null> {
  const raw = await kv.get(`${RUN_PREFIX}${runId}`);
  if (!raw) return null;
  const run = JSON.parse(raw);
  // Ensure new fields have defaults for backwards compat
  if (!run.platforms) run.platforms = ["youtube"];
  if (run.total_profiles_discovered === undefined) run.total_profiles_discovered = run.unique_channels_found || 0;
  if (run.profiles_enriched === undefined) run.profiles_enriched = run.channels_scraped || 0;
  return run;
}

async function saveResults(runId: string, results: CreatorResult[]) {
  const CHUNK = 200;
  for (let i = 0; i < results.length; i += CHUNK) {
    const chunk = results.slice(i, i + CHUNK);
    await kv.set(`${RESULTS_PREFIX}${runId}:${i}`, JSON.stringify(chunk));
  }
  await kv.set(`${RESULTS_PREFIX}${runId}:count`, String(results.length));
}

async function getResults(runId: string): Promise<CreatorResult[]> {
  const countRaw = await kv.get(`${RESULTS_PREFIX}${runId}:count`);
  const count = countRaw ? parseInt(countRaw) : 0;
  if (count === 0) return [];

  const CHUNK = 200;
  const all: CreatorResult[] = [];
  for (let i = 0; i < count; i += CHUNK) {
    const raw = await kv.get(`${RESULTS_PREFIX}${runId}:${i}`);
    if (raw) all.push(...JSON.parse(raw));
  }
  return all;
}

async function addUserRun(userId: string, runId: string) {
  const raw = await kv.get(`${USER_RUNS_PREFIX}${userId}`);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  ids.unshift(runId);
  await kv.set(`${USER_RUNS_PREFIX}${userId}`, JSON.stringify(ids.slice(0, 100)));
}

async function getUserDailyCount(userId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const raw = await kv.get(`${DAILY_COUNT_PREFIX}${userId}:${today}`);
  return raw ? parseInt(raw) : 0;
}

async function incrementUserDailyCount(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${DAILY_COUNT_PREFIX}${userId}:${today}`;
  const current = await getUserDailyCount(userId);
  await kv.set(key, String(current + 1));
}

// ── Plan limits ──
const PLAN_RUN_LIMITS: Record<string, number> = {
  none: 3, starter: 3, professional: 25, growth: 100,
};

function getDailyLimitForPlan(plan: string): number {
  return PLAN_RUN_LIMITS[(plan || "none").toLowerCase()] ?? PLAN_RUN_LIMITS.none;
}

// ══════════════════════════════════════════════════════════════════════════
// PIPELINE — Phase 1 for YouTube (search + channel details, runs in POST /run)
// ══════════════════════════════════════════════════════════════════════════

interface SerializedChannel {
  channel_id: string;
  channel_name: string;
  channel_url: string;
  keywords: string[];
}

async function youtubePhase1(runId: string) {
  const run = await getRun(runId);
  if (!run) {
    console.error(`[CREATOR-FINDER] YT Phase1: run ${runId} not found`);
    return;
  }

  try {
    run.status = "step_videos";
    run.status_message = "Searching YouTube via YouTube Data API...";
    await saveRun(run);

    const channelMap = new Map<string, DiscoveredChannel>();
    let totalVideoHits = 0;
    let usedSerpApiFallback = false;

    // ── Step 1: Try YouTube Data API first ──
    for (const kwInput of run.input_keywords) {
      try {
        const hits = await youtubeSearchVideos(kwInput.keyword, kwInput.num_of_posts);
        totalVideoHits += hits.length;

        for (const hit of hits) {
          if (!hit.channelId) continue;
          if (!channelMap.has(hit.channelId)) {
            channelMap.set(hit.channelId, {
              channel_id: hit.channelId,
              channel_name: hit.channelTitle,
              channel_url: `https://www.youtube.com/channel/${hit.channelId}`,
              keywords: new Set(),
            });
          }
          channelMap.get(hit.channelId)!.keywords.add(kwInput.keyword);
          if (hit.channelTitle && !channelMap.get(hit.channelId)!.channel_name) {
            channelMap.get(hit.channelId)!.channel_name = hit.channelTitle;
          }
        }
      } catch (err: any) {
        console.error(`[CREATOR-FINDER] YT API search failed for keyword="${kwInput.keyword}": ${err.message}`);
      }
    }

    // ── Step 2: If YouTube API returned nothing (likely quota), fall back to SerpAPI ──
    if (channelMap.size === 0 && SERPAPI_KEY()) {
      console.log(`[CREATOR-FINDER] ${run.id}: YouTube API returned 0 results — falling back to SerpAPI Google search`);
      usedSerpApiFallback = true;
      run.status_message = "YouTube API quota exceeded — discovering channels via Google search...";
      await saveRun(run);

      for (const kwInput of run.input_keywords) {
        try {
          const serpHits = await youtubeSearchViaSerpApi(kwInput.keyword, kwInput.num_of_posts);
          totalVideoHits += serpHits.length;

          for (const hit of serpHits) {
            const key = hit.channelId;
            if (!key) continue;
            if (!channelMap.has(key)) {
              channelMap.set(key, {
                channel_id: key,
                channel_name: hit.channelTitle,
                channel_url: hit.channelUrl,
                keywords: new Set(),
              });
            }
            channelMap.get(key)!.keywords.add(kwInput.keyword);
            if (hit.channelTitle && !channelMap.get(key)!.channel_name) {
              channelMap.get(key)!.channel_name = hit.channelTitle;
            }
          }
        } catch (err: any) {
          console.error(`[CREATOR-FINDER] SerpAPI YT fallback failed for keyword="${kwInput.keyword}": ${err.message}`);
        }
      }
    }

    run.total_videos_found = totalVideoHits;
    const allChannelIds = [...channelMap.keys()];
    let cappedIds = allChannelIds.slice(0, 500);
    run.unique_channels_found = cappedIds.length;
    run.total_profiles_discovered += cappedIds.length;
    await saveRun(run);
    console.log(`[CREATOR-FINDER] ${run.id}: ${totalVideoHits} hits, ${cappedIds.length} unique channels${usedSerpApiFallback ? " (via SerpAPI)" : ""}`);

    if (cappedIds.length === 0) {
      return; // No YouTube results — other platforms may still have results
    }

    // ── Step 3: Fetch channel details (API first, scraping fallback) ──
    run.status = "step_channels";
    let channelDetails: Map<string, any> = new Map();

    if (!usedSerpApiFallback) {
      run.status_message = `Fetching details for ${cappedIds.length} channels via YouTube API...`;
      await saveRun(run);
      channelDetails = await youtubeGetChannels(cappedIds);
      console.log(`[CREATOR-FINDER] ${run.id}: fetched ${channelDetails.size} channel details from API`);

      // If API returned nothing (quota hit during channel fetch), set flag to scrape
      if (channelDetails.size === 0 && cappedIds.length > 0) {
        console.log(`[CREATOR-FINDER] ${run.id}: YouTube channel API returned 0 — falling back to page scraping`);
        usedSerpApiFallback = true;
      }
    }

    if (usedSerpApiFallback) {
      run.status_message = `Scraping details for ${cappedIds.length} YouTube channels...`;
      await saveRun(run);
      const channelsToScrape = cappedIds.map(id => {
        const ch = channelMap.get(id)!;
        return { channelId: id, channelUrl: ch.channel_url, channelTitle: ch.channel_name };
      });
      channelDetails = await youtubeGetChannelsByScraping(channelsToScrape);
      console.log(`[CREATOR-FINDER] ${run.id}: scraped ${channelDetails.size} channel details`);
    }

    // Re-key channels if scraping resolved handle: pseudo-IDs to real UC IDs
    const resolvedRekeying = new Map<string, string>();
    for (const [origKey, details] of channelDetails) {
      if (details._resolvedChannelId && details._resolvedChannelId !== origKey && details._resolvedChannelId.startsWith("UC")) {
        resolvedRekeying.set(origKey, details._resolvedChannelId);
      }
    }

    for (const [oldKey, newKey] of resolvedRekeying) {
      if (channelMap.has(oldKey) && !channelMap.has(newKey)) {
        const ch = channelMap.get(oldKey)!;
        ch.channel_id = newKey;
        channelMap.set(newKey, ch);
        channelMap.delete(oldKey);
      }
      if (channelDetails.has(oldKey) && !channelDetails.has(newKey)) {
        const det = channelDetails.get(oldKey)!;
        channelDetails.set(newKey, det);
        channelDetails.delete(oldKey);
      }
    }

    // Recalculate cappedIds after re-keying
    cappedIds = [...channelMap.keys()].slice(0, 500);

    for (const [chId, discovered] of channelMap) {
      const details = channelDetails.get(chId);
      if (details) {
        if (details.customUrl) {
          discovered.channel_url = `https://www.youtube.com/${details.customUrl.startsWith("@") ? details.customUrl : `@${details.customUrl}`}`;
        }
        if (details.title) discovered.channel_name = details.title;
      }
    }

    // Serialize and store in KV for incremental processing
    const serializedChannels: Record<string, SerializedChannel> = {};
    for (const [chId, ch] of channelMap) {
      if (!cappedIds.includes(chId)) continue;
      serializedChannels[chId] = {
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        channel_url: ch.channel_url,
        keywords: [...ch.keywords],
      };
    }
    await kv.set(`${CHANNELS_PREFIX}${runId}`, JSON.stringify(serializedChannels));

    const serializedDetails: Record<string, any> = {};
    for (const [chId, det] of channelDetails) {
      serializedDetails[chId] = det;
    }
    await kv.set(`${API_DETAILS_PREFIX}${runId}`, JSON.stringify(serializedDetails));

    await kv.set(`${QUEUE_PREFIX}${runId}`, JSON.stringify(cappedIds));
    await kv.set(`${SCRAPED_PREFIX}${runId}`, JSON.stringify({}));

    run.unique_channels_found = cappedIds.length;
    await saveRun(run);

    console.log(`[CREATOR-FINDER] ${run.id}: YT Phase 1 complete — ${cappedIds.length} channels queued${usedSerpApiFallback ? " (SerpAPI+scraping)" : ""}`);
  } catch (err: any) {
    console.error(`[CREATOR-FINDER] YT Phase1 FAILED for run ${runId}:`, err);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PIPELINE — Phase 1 for Social Platforms (SerpAPI discovery)
// ══════════════════════════════════════════════════════════════════════════

async function socialPhase1(runId: string, platforms: SocialPlatform[]) {
  const run = await getRun(runId);
  if (!run) return;

  try {
    run.status = "step_discovery";
    run.status_message = `Discovering profiles on ${platforms.join(", ")}...`;
    await saveRun(run);

    const allProfiles: (DiscoveredProfile & { _keywords: string[] })[] = [];
    const seenUrls = new Set<string>();
    const seenHandles = new Map<string, string>(); // platform:handle -> url

    for (const kwInput of run.input_keywords) {
      // Run platform discoveries in parallel for each keyword
      const platformResults = await Promise.allSettled(
        platforms.map(platform => discoverSocialProfiles(platform, kwInput.keyword, kwInput.num_of_posts))
      );

      for (let pi = 0; pi < platforms.length; pi++) {
        const result = platformResults[pi];
        if (result.status !== "fulfilled") {
          console.error(`[CREATOR-FINDER] Social discovery failed for ${platforms[pi]}/"${kwInput.keyword}": ${(result as PromiseRejectedResult).reason?.message || "unknown"}`);
          continue;
        }
        for (const p of result.value) {
          const key = `${p.platform}:${p.handle.toLowerCase()}`;
          if (seenHandles.has(key)) {
            const existing = allProfiles.find(ep => `${ep.platform}:${ep.handle.toLowerCase()}` === key);
            if (existing && !existing._keywords.includes(kwInput.keyword)) {
              existing._keywords.push(kwInput.keyword);
            }
            continue;
          }
          seenHandles.set(key, p.profile_url);
          seenUrls.add(p.profile_url);
          allProfiles.push({ ...p, _keywords: [kwInput.keyword] });
        }
      }
    }

    // Cap at 500 per run
    const capped = allProfiles.slice(0, 500);
    run.total_profiles_discovered += capped.length;
    await saveRun(run);

    console.log(`[CREATOR-FINDER] ${runId}: Social discovery found ${capped.length} profiles across ${platforms.join(", ")}`);

    if (capped.length === 0) return;

    // Store profiles for incremental enrichment
    const profilesMap: Record<string, any> = {};
    const queue: string[] = [];
    for (let i = 0; i < capped.length; i++) {
      const key = `social_${i}`;
      profilesMap[key] = capped[i];
      queue.push(key);
    }

    await kv.set(`${SOCIAL_PROFILES_PREFIX}${runId}`, JSON.stringify(profilesMap));
    await kv.set(`${SOCIAL_QUEUE_PREFIX}${runId}`, JSON.stringify(queue));
    await kv.set(`${SOCIAL_ENRICHED_PREFIX}${runId}`, JSON.stringify({}));

    console.log(`[CREATOR-FINDER] ${runId}: ${queue.length} social profiles queued for enrichment`);
  } catch (err: any) {
    console.error(`[CREATOR-FINDER] Social Phase1 FAILED for run ${runId}:`, err);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// INCREMENTAL ENRICHMENT (called on each GET /runs/:id poll)
// ══════════════════════════════════════════════════════════════════════════

async function incrementalEnrichAndMaybeFinalize(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run || (run.status !== "step_emails" && run.status !== "step_enrichment" && run.status !== "step_finalize")) return;

  // If marked for finalization from previous poll, do it now (separate CPU budget)
  if (run.status === "step_finalize") {
    await finalizeRun(runId);
    return;
  }

  try {
    // ── YouTube queue ──
    const ytQueueRaw = await kv.get(`${QUEUE_PREFIX}${runId}`);
    const ytQueue: string[] = ytQueueRaw ? JSON.parse(ytQueueRaw) : [];

    // ── Social queue ──
    const socQueueRaw = await kv.get(`${SOCIAL_QUEUE_PREFIX}${runId}`);
    const socQueue: string[] = socQueueRaw ? JSON.parse(socQueueRaw) : [];

    const totalRemaining = ytQueue.length + socQueue.length;

    if (totalRemaining === 0) {
      await finalizeRun(runId);
      return;
    }

    // Process YouTube and social queues in parallel within the same poll
    let ytProcessed = 0;
    let socProcessed = 0;

    if (ytQueue.length > 0) {
      const batch = ytQueue.splice(0, SCRAPE_BATCH_SIZE);
      await kv.set(`${QUEUE_PREFIX}${runId}`, JSON.stringify(ytQueue));

      const channelsRaw = await kv.get(`${CHANNELS_PREFIX}${runId}`);
      const channels: Record<string, SerializedChannel> = channelsRaw ? JSON.parse(channelsRaw) : {};

      const apiDetRaw = await kv.get(`${API_DETAILS_PREFIX}${runId}`);
      const apiDetails: Record<string, any> = apiDetRaw ? JSON.parse(apiDetRaw) : {};

      const scrapedRaw = await kv.get(`${SCRAPED_PREFIX}${runId}`);
      const scraped: Record<string, { links: string[]; emails: string[]; email_sources?: Record<string, string>; enrichment_sources?: string[]; phone_numbers?: string[] }> = scrapedRaw ? JSON.parse(scrapedRaw) : {};

      console.log(`[CREATOR-FINDER] ${runId}: enriching YT batch of ${batch.length} (${ytQueue.length} YT + ${socQueue.length} social remaining)`);
      const enrichResults = await Promise.allSettled(
        batch.map(chId => {
          const ch = channels[chId];
          const url = ch?.channel_url || `https://www.youtube.com/channel/${chId}`;
          const desc = apiDetails[chId]?.description || "";
          const name = ch?.channel_name || apiDetails[chId]?.title || "";
          return enrichChannel(chId, url, desc, name);
        })
      );

      for (let i = 0; i < batch.length; i++) {
        const r = enrichResults[i];
        if (r.status === "fulfilled") {
          scraped[batch[i]] = {
            links: r.value.links,
            emails: r.value.emails,
            email_sources: r.value.email_sources,
            enrichment_sources: r.value.enrichment_sources_used,
            phone_numbers: r.value.phone_numbers,
          };
        } else {
          scraped[batch[i]] = { links: [], emails: [] };
        }
      }

      await kv.set(`${SCRAPED_PREFIX}${runId}`, JSON.stringify(scraped));
      run.channels_scraped = Object.keys(scraped).length;
      ytProcessed = batch.length;
    }

    if (socQueue.length > 0) {
      const batch = socQueue.splice(0, SCRAPE_BATCH_SIZE);
      await kv.set(`${SOCIAL_QUEUE_PREFIX}${runId}`, JSON.stringify(socQueue));

      const profilesRaw = await kv.get(`${SOCIAL_PROFILES_PREFIX}${runId}`);
      const profiles: Record<string, any> = profilesRaw ? JSON.parse(profilesRaw) : {};

      const enrichedRaw = await kv.get(`${SOCIAL_ENRICHED_PREFIX}${runId}`);
      const enriched: Record<string, any> = enrichedRaw ? JSON.parse(enrichedRaw) : {};

      console.log(`[CREATOR-FINDER] ${runId}: enriching social batch of ${batch.length} (${socQueue.length} remaining)`);

      // Parallel social enrichment instead of sequential
      const socResults = await Promise.allSettled(
        batch.map(async (key) => {
          const profile = profiles[key];
          if (!profile) return { key, result: null };
          const result = await enrichSocialProfile(profile);
          return { key, result, profile };
        })
      );

      for (const sr of socResults) {
        if (sr.status === "fulfilled" && sr.value.result) {
          const { key, result, profile } = sr.value;
          enriched[key] = {
            ...result,
            platform: profile.platform,
            _keywords: profile._keywords || [profile.keyword],
          };
          if (result.engagement_rate) {
            console.log(`[CREATOR-FINDER] ${runId}: engagement for ${key}: ${result.engagement_rate}% (${result.posts_analyzed} posts, avg ${result.avg_likes} likes)`);
          }
        } else if (sr.status === "rejected") {
          // Find the key from the batch
          const idx = socResults.indexOf(sr);
          const key = batch[idx];
          const profile = profiles[key];
          console.warn(`[CREATOR-FINDER] Social enrichment error for ${key}: ${sr.reason}`);
          enriched[key] = {
            platform: profile?.platform,
            profile_url: profile?.profile_url,
            handle: profile?.handle,
            display_name: profile?.display_name,
            bio: profile?.snippet || "",
            followers_text: "",
            followers_int: 0,
            external_links: [],
            emails: [],
            email_sources: {},
            _keywords: profile?._keywords || [],
            error: String(sr.reason),
          };
        }
      }

      await kv.set(`${SOCIAL_ENRICHED_PREFIX}${runId}`, JSON.stringify(enriched));
      socProcessed = batch.length;
    }

    run.profiles_enriched = (run.channels_scraped || 0) + (await (async () => {
      const enrichedRaw = await kv.get(`${SOCIAL_ENRICHED_PREFIX}${runId}`);
      return enrichedRaw ? Object.keys(JSON.parse(enrichedRaw)).length : 0;
    })());

    // Update run progress
    const totalProfiles = run.total_profiles_discovered;
    run.status_message = `Enriching profiles (${run.profiles_enriched}/${totalProfiles})...`;
    await saveRun(run);

    console.log(`[CREATOR-FINDER] ${runId}: enriched ${run.profiles_enriched}/${totalProfiles}`);

    // Check if both queues are now empty — defer finalization to next poll
    const ytRemaining = ytQueue.length;
    const socRemaining = socQueue.length;
    if (ytRemaining === 0 && socRemaining === 0) {
      // Don't finalize in the same invocation as enrichment.
      // Mark for finalization so the NEXT poll call handles it,
      // avoiding CPU Time exceeded from enrichment + finalization combined.
      run.status = "step_finalize" as any;
      run.status_message = "Finalizing results...";
      await saveRun(run);
      console.log(`[CREATOR-FINDER] ${runId}: enrichment done, deferring finalization to next poll`);
    }
  } catch (err: any) {
    console.error(`[CREATOR-FINDER] Incremental enrich error for ${runId}:`, err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FINALIZE (MX verification + result assembly)
// ══════════════════════════════════════════════════════════════════════════

async function finalizeRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;

  try {
    run.status = "step_mx";
    run.status_message = "Verifying email domains...";
    await saveRun(run);

    // ── Collect YouTube results ──
    const channelsRaw = await kv.get(`${CHANNELS_PREFIX}${runId}`);
    const channels: Record<string, SerializedChannel> = channelsRaw ? JSON.parse(channelsRaw) : {};

    const apiDetRaw = await kv.get(`${API_DETAILS_PREFIX}${runId}`);
    const apiDetails: Record<string, any> = apiDetRaw ? JSON.parse(apiDetRaw) : {};

    const scrapedRaw = await kv.get(`${SCRAPED_PREFIX}${runId}`);
    const scraped: Record<string, { links: string[]; emails: string[]; email_sources?: Record<string, string>; enrichment_sources?: string[]; phone_numbers?: string[] }> = scrapedRaw ? JSON.parse(scrapedRaw) : {};

    // ── Collect Social results ──
    const enrichedRaw = await kv.get(`${SOCIAL_ENRICHED_PREFIX}${runId}`);
    const socialEnriched: Record<string, any> = enrichedRaw ? JSON.parse(enrichedRaw) : {};

    // Collect all emails for full verification (DNS MX + scoring like Lead Finder)
    const allEmails = new Set<string>();
    for (const chId of Object.keys(channels)) {
      const det = apiDetails[chId];
      const sc = scraped[chId];
      const descEmails = det?.description ? extractEmails(det.description) : [];
      const scrapedEmails = sc?.emails || [];
      for (const e of [...descEmails, ...scrapedEmails]) allEmails.add(e);
    }
    for (const key of Object.keys(socialEnriched)) {
      const prof = socialEnriched[key];
      for (const e of (prof.emails || [])) allEmails.add(e);
    }

    // Full email verification with scoring (same approach as Lead Finder)
    const emailVerifications = new Map<string, { status: string; score: number; mx_valid: boolean; is_free_provider: boolean; is_disposable: boolean }>();
    const invalidDomains = new Set<string>();
    const emailArr = [...allEmails];

    // Verify in batches of 5 for CPU efficiency
    for (let i = 0; i < emailArr.length; i += 5) {
      const batch = emailArr.slice(i, i + 5);
      const verifyResults = await Promise.allSettled(
        batch.map(async (email) => {
          const result = await verifyEmail(email);
          return { email, result };
        })
      );
      for (let j = 0; j < verifyResults.length; j++) {
        const r = verifyResults[j];
        const email = batch[j];
        if (r.status === "fulfilled") {
          const { result } = r.value;
          emailVerifications.set(email, {
            status: result.status,
            score: result.score,
            mx_valid: result.mx_valid,
            is_free_provider: result.is_free_provider,
            is_disposable: result.is_disposable,
          });
          if (!result.mx_valid) {
            const domain = email.split("@")[1];
            if (domain) invalidDomains.add(domain);
          }
        } else {
          // Verification failed (timeout/error) — mark as unverified (mx_valid: false) so it gets excluded
          console.warn(`[CREATOR-FINDER] Email verification failed for ${email}: ${r.reason}`);
          emailVerifications.set(email, {
            status: "unknown",
            score: 0,
            mx_valid: false,
            is_free_provider: false,
            is_disposable: false,
          });
        }
      }
    }

    const mxPassCount = [...emailVerifications.values()].filter(v => v.mx_valid).length;
    const mxFailCount = [...emailVerifications.values()].filter(v => !v.mx_valid).length;
    const disposableCount = [...emailVerifications.values()].filter(v => v.is_disposable).length;
    const unverifiedCount = emailArr.length - emailVerifications.size;
    console.log(`[CREATOR-FINDER] DNS MX verification: ${mxPassCount} passed, ${mxFailCount} failed MX, ${disposableCount} disposable, ${unverifiedCount} unverified (dropped) out of ${emailArr.length} total`);
    if (invalidDomains.size > 0) {
      console.log(`[CREATOR-FINDER] DNS check: ${invalidDomains.size} domains have no MX records`);
    }

    // Build final results
    const results: CreatorResult[] = [];
    const seenIds = new Set<string>();
    const seenEmails = new Set<string>();

    // ── YouTube results ──
    for (const [chId, ch] of Object.entries(channels)) {
      if (seenIds.has(chId)) continue;
      seenIds.add(chId);

      const det = apiDetails[chId];
      const sc = scraped[chId];

      const rawName = det?.title || ch.channel_name || "";
      const channelName = cleanCreatorName(rawName);
      const channelSubs = det?.subscriberText || "0";
      const channelSubsInt = det?.subscriberCount || 0;
      const channelDesc = (det?.description || "").slice(0, 500);
      const channelLinks = sc?.links || [];

      const descEmails = det?.description ? extractEmails(det.description) : [];
      const scrapedEmails = sc?.emails || [];
      const allChannelEmails = [...new Set([...descEmails, ...scrapedEmails])];

      // Filter emails: ONLY allow emails that passed DNS MX verification
      const validEmails = allChannelEmails
        .filter(e => {
          const lower = e.toLowerCase();
          if (seenEmails.has(lower)) return false;
          const verification = emailVerifications.get(lower);
          // Must have been verified AND have valid MX records — reject unverified or invalid
          if (!verification || !verification.mx_valid) return false;
          if (verification.is_disposable) return false;
          return true;
        })
        .sort((a, b) => {
          // Sort by verification score (highest first)
          const scoreA = emailVerifications.get(a.toLowerCase())?.score || 0;
          const scoreB = emailVerifications.get(b.toLowerCase())?.score || 0;
          return scoreB - scoreA;
        });
      validEmails.forEach(e => seenEmails.add(e.toLowerCase()));

      // Get verification for primary email
      const primaryEmail = validEmails[0] || null;
      const primaryVerification = primaryEmail ? emailVerifications.get(primaryEmail.toLowerCase()) : null;

      const websitePrimary = channelLinks.find(l =>
        l && !l.includes("youtube.com") && !l.includes("youtu.be") &&
        !l.includes("twitter.com") && !l.includes("x.com") &&
        !l.includes("instagram.com") && !l.includes("tiktok.com") &&
        !l.includes("facebook.com")
      ) || null;

      results.push({
        id: crypto.randomUUID(),
        run_id: runId,
        platform: "youtube",
        keywords: ch.keywords,
        profile_url: ch.channel_url,
        handle: ch.channel_url.replace("https://www.youtube.com/", ""),
        display_name: channelName,
        followers_text: channelSubs,
        followers_int: channelSubsInt,
        bio: channelDesc,
        external_links: channelLinks,
        emails: validEmails,
        email_primary: primaryEmail,
        email_sources: sc?.email_sources
          ? Object.fromEntries(validEmails.map(e => [e, sc.email_sources![e] || "unknown"]).filter(([_, v]) => v))
          : undefined,
        enrichment_sources: sc?.enrichment_sources,
        website_primary: websitePrimary,
        status: validEmails.length > 0 ? "email_found" : "no_email",
        phone_numbers: sc?.phone_numbers || extractPhoneNumbers(channelDesc),
        email_verification: primaryVerification ? {
          status: primaryVerification.status as "valid" | "risky" | "invalid" | "unknown",
          score: primaryVerification.score,
          mx_valid: primaryVerification.mx_valid,
          is_free_provider: primaryVerification.is_free_provider,
          is_disposable: primaryVerification.is_disposable,
        } : null,
        created_at: new Date().toISOString(),
        // Legacy compat
        channel_url: ch.channel_url,
        channel_name: channelName,
        subscribers_text: channelSubs,
        subscribers_int: channelSubsInt,
        description: channelDesc,
        links: channelLinks,
      });
    }

    // ── Social results ──
    for (const [key, prof] of Object.entries(socialEnriched) as [string, any][]) {
      // Filter emails: ONLY allow emails that passed DNS MX verification
      const validEmails = (prof.emails || [])
        .filter((e: string) => {
          const lower = e.toLowerCase();
          if (seenEmails.has(lower)) return false;
          const verification = emailVerifications.get(lower);
          // Must have been verified AND have valid MX records — reject unverified or invalid
          if (!verification || !verification.mx_valid) return false;
          if (verification.is_disposable) return false;
          return true;
        })
        .sort((a: string, b: string) => {
          const scoreA = emailVerifications.get(a.toLowerCase())?.score || 0;
          const scoreB = emailVerifications.get(b.toLowerCase())?.score || 0;
          return scoreB - scoreA;
        });
      validEmails.forEach((e: string) => seenEmails.add(e.toLowerCase()));

      const socialPrimaryEmail = validEmails[0] || null;
      const socialPrimaryVerification = socialPrimaryEmail ? emailVerifications.get(socialPrimaryEmail.toLowerCase()) : null;

      const externalLinks = prof.external_links || [];
      const websitePrimary = externalLinks.find((l: string) =>
        l && !l.includes("instagram.com") && !l.includes("tiktok.com") &&
        !l.includes("x.com") && !l.includes("twitter.com") &&
        !l.includes("youtube.com") && !l.includes("facebook.com")
      ) || null;

      // Infer platform from profile_url if missing (handles legacy KV data)
      const inferredPlatform = prof.platform || (
        prof.profile_url?.includes("instagram.com") ? "instagram" :
        prof.profile_url?.includes("tiktok.com") ? "tiktok" :
        (prof.profile_url?.includes("x.com") || prof.profile_url?.includes("twitter.com")) ? "x" :
        "youtube"
      );

      results.push({
        id: crypto.randomUUID(),
        run_id: runId,
        platform: inferredPlatform,
        keywords: prof._keywords || [],
        profile_url: prof.profile_url,
        handle: prof.handle,
        display_name: prof.display_name || "",
        followers_text: prof.followers_text || "",
        followers_int: prof.followers_int || 0,
        bio: (prof.bio || "").slice(0, 1000),
        external_links: externalLinks,
        emails: validEmails,
        email_primary: socialPrimaryEmail,
        email_sources: prof.email_sources || undefined,
        enrichment_sources: Object.values(prof.email_sources || {}).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i) as string[],
        website_primary: websitePrimary,
        status: prof.error ? "error" : validEmails.length > 0 ? "email_found" : "no_email",
        phone_numbers: extractPhoneNumbers(prof.bio || ""),
        email_verification: socialPrimaryVerification ? {
          status: socialPrimaryVerification.status as "valid" | "risky" | "invalid" | "unknown",
          score: socialPrimaryVerification.score,
          mx_valid: socialPrimaryVerification.mx_valid,
          is_free_provider: socialPrimaryVerification.is_free_provider,
          is_disposable: socialPrimaryVerification.is_disposable,
        } : null,
        created_at: new Date().toISOString(),
        // Engagement metrics (from scraping recent post likes/comments)
        engagement_rate: prof.engagement_rate || undefined,
        avg_likes: prof.avg_likes || undefined,
        avg_comments: prof.avg_comments || undefined,
        posts_analyzed: prof.posts_analyzed || undefined,
        // Legacy compat (empty for social)
        channel_url: prof.profile_url,
        channel_name: prof.display_name || "",
        subscribers_text: prof.followers_text || "",
        subscribers_int: prof.followers_int || 0,
        description: (prof.bio || "").slice(0, 500),
        links: externalLinks,
      });
    }

    // Log engagement summary
    const withEngagement = results.filter(r => r.engagement_rate && r.engagement_rate > 0);
    console.log(`[CREATOR-FINDER] ${runId}: finalize — ${results.length} results, ${withEngagement.length} with engagement data`);
    if (withEngagement.length > 0) {
      withEngagement.forEach(r => console.log(`[CREATOR-FINDER]   ${r.handle}: ${r.engagement_rate}% (${r.posts_analyzed} posts)`));
    }

    // Save results
    run.channels_with_emails = results.filter(r => r.status === "email_found").length;
    run.channels_scraped = run.unique_channels_found;
    run.profiles_enriched = run.total_profiles_discovered;
    run.status = "completed";
    run.status_message = `Done! ${results.length} creators, ${run.channels_with_emails} with emails.`;
    run.completed_at = new Date().toISOString();
    await saveRun(run);
    await saveResults(runId, results);

    // Cleanup incremental KV keys
    try {
      await kv.del(`${QUEUE_PREFIX}${runId}`);
      await kv.del(`${SCRAPED_PREFIX}${runId}`);
      await kv.del(`${CHANNELS_PREFIX}${runId}`);
      await kv.del(`${API_DETAILS_PREFIX}${runId}`);
      await kv.del(`${SOCIAL_QUEUE_PREFIX}${runId}`);
      await kv.del(`${SOCIAL_PROFILES_PREFIX}${runId}`);
      await kv.del(`${SOCIAL_ENRICHED_PREFIX}${runId}`);
    } catch { /* ignore cleanup errors */ }

    console.log(`[CREATOR-FINDER] ${runId}: COMPLETE — ${results.length} results, ${run.channels_with_emails} with emails`);
  } catch (err: any) {
    console.error(`[CREATOR-FINDER] Finalize FAILED for run ${runId}:`, err);
    run.status = "failed";
    run.error_text = err.message || "Finalization error";
    run.status_message = `Failed: ${run.error_text}`;
    await saveRun(run);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── POST /run — Start a new Creator Finder run (multi-platform) ──
app.post("/run", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    // Normalize inputs
    let keywords: KeywordInput[] = [];
    if (body.keywords && Array.isArray(body.keywords)) {
      keywords = body.keywords;
    } else if (body.keyword_text && typeof body.keyword_text === "string") {
      keywords = body.keyword_text
        .split("\n")
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((kw: string) => ({ keyword: kw, num_of_posts: body.num_of_posts || 40 }));
    }

    if (keywords.length === 0) {
      return c.json({ error: "No keywords provided" }, 400);
    }
    if (keywords.length > 50) {
      return c.json({ error: "Maximum 50 keywords per run" }, 400);
    }

    // Parse platforms (default: youtube only for backward compat)
    const platforms: Platform[] = body.platforms && Array.isArray(body.platforms) && body.platforms.length > 0
      ? body.platforms.filter((p: string) => ["youtube", "instagram", "tiktok", "x"].includes(p))
      : ["youtube"];

    if (platforms.length === 0) {
      return c.json({ error: "At least one platform required" }, 400);
    }

    // Plan limit check
    const sub = await getUserSubscriptionStatus(user);
    const plan = sub?.plan || "none";
    const dailyLimit = getDailyLimitForPlan(plan);
    const dailyCount = await getUserDailyCount(user.id);
    if (dailyCount >= dailyLimit) {
      return c.json({
        error: "DAILY_LIMIT_EXCEEDED",
        message: `You've reached your daily limit of ${dailyLimit} Creator Finder runs (${plan} plan). Upgrade for more.`,
        dailyCount,
        dailyLimit,
        plan,
      }, 403);
    }

    // Check API keys for selected platforms
    if (platforms.includes("youtube") && !YT_API_KEY()) {
      return c.json({ error: "YouTube API key not configured. Please add YOUTUBE_API_KEY in settings." }, 500);
    }
    const socialPlatforms = platforms.filter(p => p !== "youtube") as SocialPlatform[];
    if (socialPlatforms.length > 0 && !Deno.env.get("SERPAPI_API_KEY")) {
      return c.json({ error: "SerpAPI key not configured. Required for Instagram, TikTok, and X discovery." }, 500);
    }

    // Create run
    const runId = crypto.randomUUID();
    const run: CreatorRun = {
      id: runId,
      user_id: user.id,
      platforms,
      provider: platforms.includes("youtube") ? "youtube_api+scraper" : "serpapi+scraper",
      status: "queued",
      status_message: "Queued for processing...",
      created_at: new Date().toISOString(),
      input_keywords: keywords,
      total_videos_found: 0,
      unique_channels_found: 0,
      channels_with_emails: 0,
      channels_scraped: 0,
      total_profiles_discovered: 0,
      profiles_enriched: 0,
    };

    await saveRun(run);
    await addUserRun(user.id, runId);
    await incrementUserDailyCount(user.id);

    // Phase 1: Platform-specific discovery
    try {
      // YouTube discovery (uses YouTube Data API)
      if (platforms.includes("youtube")) {
        try {
          await youtubePhase1(runId);
        } catch (ytErr: any) {
          // Don't let YouTube quota errors kill the entire run — social platforms can still work
          console.warn(`[CREATOR-FINDER] YouTube Phase1 error (continuing with other platforms): ${ytErr.message}`);
        }
      }

      // Social discovery (uses SerpAPI)
      if (socialPlatforms.length > 0) {
        await socialPhase1(runId, socialPlatforms);
      }

      // Set run to enrichment phase
      const updatedRun = await getRun(runId);
      if (updatedRun && updatedRun.status !== "failed") {
        if (updatedRun.total_profiles_discovered === 0) {
          updatedRun.status = "completed";
          updatedRun.status_message = "No profiles found. Try different keywords or platforms.";
          updatedRun.completed_at = new Date().toISOString();
          await saveRun(updatedRun);
          await saveResults(runId, []);
        } else {
          updatedRun.status = "step_emails";
          updatedRun.status_message = `Discovered ${updatedRun.total_profiles_discovered} profiles. Enriching emails (0/${updatedRun.total_profiles_discovered})...`;
          await saveRun(updatedRun);
        }
      }
    } catch (err: any) {
      const failedRun = await getRun(runId);
      if (failedRun) {
        failedRun.status = "failed";
        failedRun.error_text = err.message || "Discovery phase failed";
        failedRun.status_message = `Failed: ${failedRun.error_text}`;
        await saveRun(failedRun);
      }
    }

    const finalRun = await getRun(runId);
    return c.json({
      success: true,
      run_id: runId,
      status: finalRun?.status || "step_emails",
    });
  } catch (err: any) {
    console.error("[CREATOR-FINDER] /run error:", err);
    return c.json({ error: err.message }, err.message === "Unauthorized" ? 401 : 500);
  }
});

// ── GET /runs/:id — Poll run status + incremental enrichment ──
app.get("/runs/:id", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const runId = c.req.param("id");
    let run = await getRun(runId);
    if (!run) return c.json({ error: "Run not found" }, 404);
    if (run.user_id !== user.id) return c.json({ error: "Unauthorized" }, 403);

    // If in enrichment or finalization phase, do incremental work on this poll
    if (run.status === "step_emails" || run.status === "step_enrichment" || run.status === "step_finalize") {
      await incrementalEnrichAndMaybeFinalize(runId);
      run = await getRun(runId) || run;
    }

    const response: any = { run };

    if (run.status === "completed") {
      response.results = await getResults(runId);
    }

    return c.json(response);
  } catch (err: any) {
    console.error("[CREATOR-FINDER] /runs/:id error:", err);
    return c.json({ error: err.message }, err.message === "Unauthorized" ? 401 : 500);
  }
});

// ── GET /runs — List user's runs ──
app.get("/runs", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const raw = await kv.get(`${USER_RUNS_PREFIX}${user.id}`);
    const runIds: string[] = raw ? JSON.parse(raw) : [];

    const runs: CreatorRun[] = [];
    for (const id of runIds.slice(0, 20)) {
      const run = await getRun(id);
      if (run) runs.push(run);
    }

    const sub = await getUserSubscriptionStatus(user);
    const plan = sub?.plan || "none";
    const dailyLimit = getDailyLimitForPlan(plan);
    const dailyCount = await getUserDailyCount(user.id);

    return c.json({ runs, dailyCount, dailyLimit, plan });
  } catch (err: any) {
    console.error("[CREATOR-FINDER] /runs error:", err);
    return c.json({ error: err.message }, err.message === "Unauthorized" ? 401 : 500);
  }
});

// ── POST /import-to-leads — Import selected creator results to CRM ──
app.post("/import-to-leads", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const { run_id, result_ids } = await c.req.json();

    if (!run_id || !result_ids?.length) {
      return c.json({ error: "run_id and result_ids required" }, 400);
    }

    const allResults = await getResults(run_id);
    const selectedSet = new Set(result_ids);
    const selected = allResults.filter(r => selectedSet.has(r.id) && r.email_primary);

    if (selected.length === 0) {
      return c.json({ error: "No results with emails to import" }, 400);
    }

    // Check existing emails for dedup
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("email")
      .eq("user_id", user.id);
    const existingEmails = new Set(
      (existingLeads || []).map((l: any) => (l.email || "").toLowerCase()).filter(Boolean)
    );

    const toInsert: any[] = [];
    let skipped = 0;

    const platformLabels: Record<string, string> = {
      youtube: "YouTube Creator",
      instagram: "Instagram Creator",
      tiktok: "TikTok Creator",
      x: "X Creator",
    };

    for (const r of selected) {
      const emailLower = (r.email_primary || "").toLowerCase();
      if (existingEmails.has(emailLower)) {
        skipped++;
        continue;
      }

      toInsert.push({
        user_id: user.id,
        business_name: r.display_name || r.channel_name || "Unknown Creator",
        contact_name: r.display_name || r.channel_name || "",
        email: r.email_primary,
        phone: r.phone_numbers?.[0] || "",
        website: r.website_primary || "",
        city: "",
        state: "",
        country: "",
        category: "Content Creator",
        job_title: platformLabels[r.platform] || "Creator",
        source: `${r.platform}_creator_finder`,
        person_linkedin_url: "",
        linkedin: "",
        employees: r.followers_text || r.subscribers_text || "",
        notes: [
          `Imported from Creator Finder (${r.platform})`,
          `Profile: ${r.profile_url || r.channel_url}`,
          `Handle: ${r.handle}`,
          `Followers: ${r.followers_text || r.subscribers_text || ""}`,
          `Keywords: ${r.keywords.join(", ")}`,
          `All emails: ${r.emails.join(", ")}`,
          r.external_links?.length ? `Links: ${r.external_links.join(", ")}` : "",
        ].filter(Boolean).join("\n"),
        status: "Cold",
        created_at: new Date().toISOString(),
      });

      existingEmails.add(emailLower);
    }

    let saved = 0;
    let failed = 0;

    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      const { error } = await supabase.from("leads").insert(batch);
      if (error) {
        console.error("[CREATOR-FINDER] Import batch error:", error);
        failed += batch.length;
      } else {
        saved += batch.length;
      }
    }

    return c.json({
      success: true,
      results: { saved, skipped, failed },
    });
  } catch (err: any) {
    console.error("[CREATOR-FINDER] /import-to-leads error:", err);
    return c.json({ error: err.message }, err.message === "Unauthorized" ? 401 : 500);
  }
});

// ── GET /export-csv/:id — Export results as CSV ──
app.get("/export-csv/:id", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const runId = c.req.param("id");
    const run = await getRun(runId);
    if (!run || run.user_id !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const results = await getResults(runId);
    const header = "Platform,Keyword,Name,Handle,Profile URL,Followers,Email(s),Phone(s),Email Sources,Website,Links,Bio,Status\n";
    const rows = results.map(r => {
      const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
      const emailSourcesStr = r.emails.map(e => `${e} (${r.email_sources?.[e] || 'unknown'})`).join("; ");
      return [
        esc(r.platform),
        esc(r.keywords.join("; ")),
        esc(r.display_name || r.channel_name || ""),
        esc(r.handle),
        esc(r.profile_url || r.channel_url || ""),
        esc(r.followers_text || r.subscribers_text || ""),
        esc(r.emails.join(", ")),
        esc((r.phone_numbers || []).join(", ")),
        esc(emailSourcesStr),
        esc(r.website_primary || ""),
        esc((r.external_links || r.links || []).join(", ")),
        esc((r.bio || r.description || "").slice(0, 200)),
        esc(r.status),
      ].join(",");
    }).join("\n");

    return new Response(header + rows, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="creator-finder-${runId.slice(0, 8)}.csv"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error("[CREATOR-FINDER] /export-csv error:", err);
    return c.json({ error: err.message }, 500);
  }
});

export default app;
