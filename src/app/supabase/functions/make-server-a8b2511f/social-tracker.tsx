/**
 * Social Tracker — Track public social media profiles (YouTube, TikTok, Instagram, LinkedIn, Facebook).
 * No OAuth required. Fetches public metrics from profile URLs.
 *
 * KV Keys:
 *   social_tracked:{userId}:{id}              -> TrackedAccount JSON
 *   social_snap:{userId}:{id}:{YYYYMMDD_HH}   -> MetricSnapshot JSON
 *
 * Data Sources:
 *   YouTube   — YouTube Data API v3 (free, reliable)
 *   TikTok    — Direct fetch (SSR HTML with embedded JSON stats), SerpAPI fallback
 *   Instagram — Direct fetch (og:description meta tags), SerpAPI Google search fallback
 *   LinkedIn  — SerpAPI Google search (rich snippets with connections/followers)
 *   Facebook  — SerpAPI Google search (rich snippets with followers/likes)
 */

import { Hono } from "npm:hono";
import * as kv from "./kv-retry.tsx";
import { authGetUser } from "./auth-helpers.tsx";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSerpSearchKey, serpFetch } from "./serp-adapter.tsx";

// ─── Types ───────────────────────────────────────────────────────────

export type TrackPlatform = "youtube" | "tiktok" | "instagram" | "linkedin" | "facebook" | "twitter";

export interface MetricSnapshot {
  followers: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  posts: number;       // videos for YT/TT, posts for IG
  engagementRate?: number;
  timestamp: string;
}

export interface TrackedAccount {
  id: string;
  userId: string;
  platform: TrackPlatform;
  handle: string;
  url: string;
  displayName?: string;
  avatarUrl?: string;
  latestMetrics?: MetricSnapshot;
  addedAt: string;
  lastSyncedAt?: string;
  syncError?: string;
  profileType?: 'own' | 'competitor';
}

// ─── Supabase Admin ──────────────────────────────────────────────────

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return _supabase;
}

// ─── Auth ────────────────────────────────────────────────────────────

async function requireUser(c: any): Promise<{ id: string; email?: string }> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) throw Object.assign(new Error("No Authorization header"), { status: 401 });
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token === "undefined" || token === "null") {
    throw Object.assign(new Error("Invalid token"), { status: 401 });
  }
  const supabase = getSupabase();
  const { user, error } = await authGetUser(supabase, token, "SOCIAL-TRACKER");
  if (error || !user) throw Object.assign(new Error(error || "Auth failed"), { status: 401 });
  return { id: user.id, email: user.email };
}

// ─── KV Helpers ──────────────────────────────────────────────────────

function trackKey(userId: string, id: string) {
  return `social_tracked:${userId}:${id}`;
}
function snapshotPrefix(userId: string, id: string) {
  return `social_snap:${userId}:${id}:`;
}
function snapshotKey(userId: string, id: string, ts: string) {
  return `social_snap:${userId}:${id}:${ts}`;
}

async function getUserTracked(userId: string): Promise<TrackedAccount[]> {
  const raw = await kv.getByPrefix(`social_tracked:${userId}:`);
  return (raw || []).map((r: string) => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean);
}

async function getSnapshots(userId: string, accountId: string, limit = 30): Promise<MetricSnapshot[]> {
  const raw = await kv.getByPrefix(snapshotPrefix(userId, accountId));
  const snaps = (raw || []).map((r: string) => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean) as MetricSnapshot[];
  // Sort by timestamp desc, take latest N
  snaps.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return snaps.slice(0, limit);
}

// ─── URL Parsing ─────────────────────────────────────────────────────

export function parseSocialUrl(url: string): { platform: TrackPlatform; handle: string } | null {
  const cleaned = url.trim().replace(/\/+$/, "");

  // YouTube
  const ytHandle = cleaned.match(/youtube\.com\/@([^\/\?\&#]+)/i);
  if (ytHandle) return { platform: "youtube", handle: ytHandle[1] };
  const ytChannel = cleaned.match(/youtube\.com\/channel\/([^\/\?\&#]+)/i);
  if (ytChannel) return { platform: "youtube", handle: ytChannel[1] };
  const ytCustom = cleaned.match(/youtube\.com\/c\/([^\/\?\&#]+)/i);
  if (ytCustom) return { platform: "youtube", handle: ytCustom[1] };
  // Short youtube.com/username
  const ytShort = cleaned.match(/youtube\.com\/([a-zA-Z0-9_\-]+)$/i);
  if (ytShort && !["watch", "feed", "results", "shorts", "playlist", "gaming"].includes(ytShort[1].toLowerCase())) {
    return { platform: "youtube", handle: ytShort[1] };
  }

  // TikTok
  const ttHandle = cleaned.match(/tiktok\.com\/@([^\/\?\&#]+)/i);
  if (ttHandle) return { platform: "tiktok", handle: ttHandle[1] };

  // Instagram
  const igHandle = cleaned.match(/instagram\.com\/([a-zA-Z0-9_\.]+)/i);
  if (igHandle && !["p", "reel", "reels", "stories", "explore", "accounts", "about", "developer", "legal"].includes(igHandle[1].toLowerCase())) {
    return { platform: "instagram", handle: igHandle[1] };
  }

  // LinkedIn — company pages and personal profiles
  const liCompany = cleaned.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/i);
  if (liCompany) return { platform: "linkedin", handle: liCompany[1] };
  const liIn = cleaned.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (liIn) return { platform: "linkedin", handle: liIn[1] };

  // Facebook — pages and profiles
  const fbPage = cleaned.match(/(?:facebook\.com|fb\.com)\/([a-zA-Z0-9._-]+)/i);
  if (fbPage && !["watch", "marketplace", "groups", "events", "pages", "gaming", "login", "help", "settings", "stories", "reel", "share", "sharer", "dialog", "photo", "video"].includes(fbPage[1].toLowerCase())) {
    return { platform: "facebook", handle: fbPage[1] };
  }

  // Twitter / X
  const twitterHandle = cleaned.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i);
  if (twitterHandle && !["home", "explore", "notifications", "messages", "search", "settings"].includes(twitterHandle[1].toLowerCase())) {
    return { platform: "twitter", handle: twitterHandle[1] };
  }

  return null;
}

// ─── Browser-Like Headers ────────────────────────────────────────────

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ─── Platform Fetchers ───────────────────────────────────────────────

async function fetchYouTubeMetrics(handle: string): Promise<{
  metrics: MetricSnapshot;
  displayName: string;
  avatarUrl: string;
}> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) throw new Error("YouTube API key not configured");

  // Determine query type
  let apiUrl: string;
  if (handle.startsWith("UC") && handle.length > 20) {
    apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${encodeURIComponent(handle)}&key=${apiKey}`;
  } else {
    apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
  }

  let res = await fetch(apiUrl);
  let data = await res.json();

  // Fallback: try forUsername
  if (!data.items || data.items.length === 0) {
    const fallback = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&forUsername=${encodeURIComponent(handle)}&key=${apiKey}`;
    res = await fetch(fallback);
    data = await res.json();
  }

  if (!data.items || data.items.length === 0) {
    throw new Error(`YouTube channel not found: @${handle}`);
  }

  const ch = data.items[0];
  const stats = ch.statistics;
  const snippet = ch.snippet;

  return {
    displayName: snippet.title || handle,
    avatarUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
    metrics: {
      followers: parseInt(stats.subscriberCount || "0"),
      views: parseInt(stats.viewCount || "0"),
      likes: 0, // channel-level likes not available
      comments: 0,
      shares: 0,
      posts: parseInt(stats.videoCount || "0"),
      timestamp: new Date().toISOString(),
    },
  };
}

async function fetchSocialProfile(
  platform: "tiktok" | "instagram",
  handle: string,
): Promise<{
  metrics: MetricSnapshot;
  displayName: string;
  avatarUrl: string;
}> {
  const profileUrl = platform === "tiktok"
    ? `https://www.tiktok.com/@${handle}`
    : `https://www.instagram.com/${handle}/`;

  console.log(`[SOCIAL-TRACKER] Fetching ${platform} profile directly: ${profileUrl}`);

  // Attempt 1: Direct fetch with browser-like headers
  // Both platforms embed profile metrics in server-rendered HTML (og tags, JSON state)
  let html = "";
  let fetchError = "";

  try {
    const res = await fetch(profileUrl, {
      method: "GET",
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });

    if (!res.ok) {
      fetchError = `Direct fetch returned ${res.status}`;
      console.log(`[SOCIAL-TRACKER] ${fetchError}`);
    } else {
      html = await res.text();
      console.log(`[SOCIAL-TRACKER] Direct fetch got ${html.length} bytes for ${platform}/@${handle}`);
    }
  } catch (err: any) {
    fetchError = `Direct fetch error: ${err.message}`;
    console.log(`[SOCIAL-TRACKER] ${fetchError}`);
  }

  // Attempt 1.5 (Instagram only): Try the JSON API endpoint /?__a=1&__d=dis
  if (platform === "instagram" && html.length < 500) {
    try {
      console.log(`[SOCIAL-TRACKER] Trying Instagram JSON API for @${handle}...`);
      const jsonApiUrl = `https://www.instagram.com/${handle}/?__a=1&__d=dis`;
      const jsonRes = await fetch(jsonApiUrl, {
        headers: {
          ...BROWSER_HEADERS,
          "X-IG-App-ID": "936619743392459",
          "X-Requested-With": "XMLHttpRequest",
        },
        redirect: "follow",
      });
      if (jsonRes.ok) {
        const contentType = jsonRes.headers.get("content-type") || "";
        if (contentType.includes("json")) {
          const jsonData = await jsonRes.json();
          const user = jsonData?.graphql?.user || jsonData?.user;
          if (user) {
            console.log(`[SOCIAL-TRACKER] Instagram JSON API success for @${handle}: followers=${user.edge_followed_by?.count || user.follower_count || 0}`);
            const igFollowers = user.edge_followed_by?.count || user.follower_count || 0;
            const igPosts = user.edge_owner_to_timeline_media?.count || user.media_count || 0;
            const igFollowing = user.edge_follow?.count || user.following_count || 0;
            return {
              displayName: user.full_name || user.username || handle,
              avatarUrl: user.profile_pic_url_hd || user.profile_pic_url || "",
              metrics: {
                followers: igFollowers,
                views: 0,
                likes: 0,
                comments: 0,
                shares: 0,
                posts: igPosts,
                engagementRate: igFollowers > 0 && igPosts > 0 ? undefined : undefined,
                timestamp: new Date().toISOString(),
              },
            };
          }
        } else {
          console.log(`[SOCIAL-TRACKER] Instagram JSON API returned non-JSON (${contentType})`);
        }
      } else {
        console.log(`[SOCIAL-TRACKER] Instagram JSON API returned ${jsonRes.status}`);
      }
    } catch (e: any) {
      console.log(`[SOCIAL-TRACKER] Instagram JSON API error: ${e.message}`);
    }
  }

  // Attempt 2: If direct fetch failed or returned tiny HTML, try ScraperAPI as fallback
  if (html.length < 500) {
    const scraperKey = Deno.env.get("SCRAPERAPI_API_KEY");
    if (scraperKey) {
      console.log(`[SOCIAL-TRACKER] Direct fetch insufficient (${html.length} bytes), trying ScraperAPI fallback...`);
      try {
        // ScraperAPI allows these domains via their structured data / autoparse features
        const scraperUrl = `https://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(profileUrl)}&render=true&country_code=us`;
        const res2 = await fetch(scraperUrl, { headers: { Accept: "text/html" } });
        if (res2.ok) {
          html = await res2.text();
          console.log(`[SOCIAL-TRACKER] ScraperAPI fallback got ${html.length} bytes`);
        } else {
          const errText = await res2.text().catch(() => "");
          console.log(`[SOCIAL-TRACKER] ScraperAPI fallback failed (${res2.status}): ${errText.slice(0, 200)}`);
        }
      } catch (e: any) {
        console.log(`[SOCIAL-TRACKER] ScraperAPI fallback error: ${e.message}`);
      }
    }
  }

  // Attempt 3: If both direct fetch and ScraperAPI failed, try SerpAPI Google search
  // (same approach as LinkedIn/Facebook — extract metrics from Google SERP snippets)
  if (html.length < 200) {
    console.log(`[SOCIAL-TRACKER] Direct + ScraperAPI failed for ${platform}/@${handle}, trying SerpAPI Google search fallback...`);
    const serpApiKey = getSerpSearchKey();
    if (serpApiKey) {
      try {
        // Primary search: the profile URL itself
        const searchQuery = profileUrl;
        const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}&num=5&gl=us&hl=en`;
        const serpRes = await serpFetch(serpUrl);
        if (serpRes.ok) {
          const serpData = await serpRes.json();
          console.log(`[SOCIAL-TRACKER] SerpAPI returned ${serpData.organic_results?.length || 0} organic results for ${platform}/@${handle}`);

          let displayName = handle;
          let avatarUrl = "";
          let followers = 0;
          let posts = 0;
          let likes = 0;
          let following = 0;

          // Check knowledge graph
          if (serpData.knowledge_graph) {
            const kg = serpData.knowledge_graph;
            if (kg.title) displayName = kg.title;
            if (kg.thumbnail) avatarUrl = kg.thumbnail;
            if (kg.image) avatarUrl = kg.image;
            const kgDesc = kg.description || "";
            const kgFollowers = kgDesc.match(/([\d,.KMB]+)\s*(?:followers|Followers)/i);
            if (kgFollowers) followers = parseNumber(kgFollowers[1]);
            // Knowledge graph sometimes has post counts
            const kgPosts = kgDesc.match(/([\d,.KMB]+)\s*(?:posts|Posts|videos)/i);
            if (kgPosts) posts = parseNumber(kgPosts[1]);
          }

          // Parse organic results
          const results = serpData.organic_results || [];
          for (const result of results) {
            const resultUrl = (result.link || "").toLowerCase();
            const handleLower = handle.toLowerCase();

            const isMatch = platform === "instagram"
              ? resultUrl.includes(`instagram.com/${handleLower}`)
              : resultUrl.includes(`tiktok.com/@${handleLower}`);

            if (!isMatch) continue;

            console.log(`[SOCIAL-TRACKER] SerpAPI matched result for ${platform}/@${handle}: ${JSON.stringify(result).slice(0, 500)}`);

            // Extract display name from title
            if (result.title) {
              const title = result.title
                .replace(/\s*[\|–-]\s*Instagram\s*$/i, "")
                .replace(/\s*[\|–-]\s*TikTok\s*$/i, "")
                .replace(/\s*\(@[^)]+\)\s*$/i, "") // Remove "(@handle)" suffix
                .replace(/\s*•\s*Instagram photos and videos\s*$/i, "") // Remove IG suffix
                .replace(/\s*[\|–-]\s*.*$/, "")
                .trim();
              if (title) displayName = title;

              // Try to extract post count from title like "X photos and videos"
              const titlePostMatch = result.title.match(/([\d,.KMB]+)\s*(?:photos|videos|posts)/i);
              if (titlePostMatch) posts = parseNumber(titlePostMatch[1]);
            }

            if (result.thumbnail) avatarUrl = result.thumbnail;

            // displayed_link — Google sometimes puts follower counts here
            const displayedLink = result.displayed_link || "";
            if (displayedLink) {
              console.log(`[SOCIAL-TRACKER] SerpAPI displayed_link for ${platform}/@${handle}: ${displayedLink}`);
              const dlFollowers = displayedLink.match(/([\d,.KMB]+)\+?\s*followers/i);
              if (dlFollowers) followers = parseNumber(dlFollowers[1]);
              // Also check for posts count in displayed_link
              const dlPosts = displayedLink.match(/([\d,.KMB]+)\+?\s*posts/i);
              if (dlPosts) posts = parseNumber(dlPosts[1]);
            }

            // Extract from snippet: "X Followers, Y Following, Z Posts"
            const snippet = result.snippet || "";
            console.log(`[SOCIAL-TRACKER] SerpAPI snippet for ${platform}/@${handle}: ${snippet.slice(0, 300)}`);

            const followerMatch = snippet.match(/([\d,.KMB]+)\s*Followers/i);
            if (followerMatch) followers = parseNumber(followerMatch[1]);
            const postMatch = snippet.match(/([\d,.KMB]+)\s*Posts/i);
            if (postMatch) posts = parseNumber(postMatch[1]);
            const likeMatch = snippet.match(/([\d,.KMB]+)\s*(?:Likes|likes|Hearts)/i);
            if (likeMatch) likes = parseNumber(likeMatch[1]);
            const followingMatch = snippet.match(/([\d,.KMB]+)\s*Following/i);
            if (followingMatch) following = parseNumber(followingMatch[1]);

            // Rich snippet extensions
            if (result.rich_snippet?.top?.extensions) {
              console.log(`[SOCIAL-TRACKER] Rich snippet extensions: ${JSON.stringify(result.rich_snippet.top.extensions)}`);
              for (const ext of result.rich_snippet.top.extensions) {
                const extFollowers = ext.match(/([\d,.KMB]+)\s*followers/i);
                if (extFollowers) followers = parseNumber(extFollowers[1]);
                const extPosts = ext.match(/([\d,.KMB]+)\s*posts/i);
                if (extPosts) posts = parseNumber(extPosts[1]);
                const extLikes = ext.match(/([\d,.KMB]+)\s*likes/i);
                if (extLikes) likes = parseNumber(extLikes[1]);
              }
            }
            if (result.rich_snippet?.bottom?.extensions) {
              for (const ext of result.rich_snippet.bottom.extensions) {
                const extFollowers = ext.match(/([\d,.KMB]+)\s*followers/i);
                if (extFollowers) followers = parseNumber(extFollowers[1]);
                const extPosts = ext.match(/([\d,.KMB]+)\s*posts/i);
                if (extPosts) posts = parseNumber(extPosts[1]);
              }
            }

            break; // Use first matching result
          }

          // Secondary SerpAPI search to extract structured "X Followers, Y Following, Z Posts" snippet
          if (followers > 0 && posts === 0 && platform === "instagram") {
            try {
              console.log(`[SOCIAL-TRACKER] Trying secondary SerpAPI search for IG @${handle} posts/following...`);
              const secondaryQuery = `"${handle}" site:instagram.com`;
              const serpUrl2 = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(secondaryQuery)}&api_key=${serpApiKey}&num=3&gl=us&hl=en`;
              const serpRes2 = await serpFetch(serpUrl2);
              if (serpRes2.ok) {
                const serpData2 = await serpRes2.json();
                for (const r of (serpData2.organic_results || [])) {
                  const s = r.snippet || "";
                  const pm = s.match(/([\d,.KMB]+)\s*Posts/i);
                  if (pm) { posts = parseNumber(pm[1]); console.log(`[SOCIAL-TRACKER] Secondary search found posts=${posts}`); }
                  const lm = s.match(/([\d,.KMB]+)\s*(?:Likes|likes)/i);
                  if (lm) { likes = parseNumber(lm[1]); console.log(`[SOCIAL-TRACKER] Secondary search found likes=${likes}`); }
                  const fm = s.match(/([\d,.KMB]+)\s*Following/i);
                  if (fm) { following = parseNumber(fm[1]); console.log(`[SOCIAL-TRACKER] Secondary search found following=${following}`); }
                  if (posts > 0 || likes > 0) break;
                }
              }
            } catch (e2: any) {
              console.log(`[SOCIAL-TRACKER] Secondary SerpAPI search error: ${e2.message}`);
            }
          }

          // Tertiary search: try third-party stat sites (socialblade, etc.) that cache IG/TikTok stats
          if (followers > 0 && posts === 0) {
            try {
              console.log(`[SOCIAL-TRACKER] Trying tertiary SerpAPI search via stat sites for ${platform}/@${handle}...`);
              const statQuery = platform === "instagram"
                ? `"${handle}" instagram posts followers`
                : `"${handle}" tiktok videos followers`;
              const serpUrl3 = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(statQuery)}&api_key=${serpApiKey}&num=5&gl=us&hl=en`;
              const serpRes3 = await serpFetch(serpUrl3);
              if (serpRes3.ok) {
                const serpData3 = await serpRes3.json();
                for (const r of (serpData3.organic_results || [])) {
                  const s = (r.snippet || "") + " " + (r.title || "");
                  const rLink = (r.link || "").toLowerCase();
                  // Look for stat aggregator sites or any result with structured numbers
                  const pm = s.match(/([\d,.KMB]+)\s*(?:Posts|posts|media|uploads|videos)/i);
                  if (pm && posts === 0) { posts = parseNumber(pm[1]); console.log(`[SOCIAL-TRACKER] Tertiary search found posts=${posts} from ${rLink}`); }
                  const lm = s.match(/([\d,.KMB]+)\s*(?:Likes|likes|Hearts|hearts)/i);
                  if (lm && likes === 0) { likes = parseNumber(lm[1]); console.log(`[SOCIAL-TRACKER] Tertiary search found likes=${likes} from ${rLink}`); }
                  // Also check displayed_link for stats
                  const dl = r.displayed_link || "";
                  const dlPosts = dl.match(/([\d,.KMB]+)\s*(?:posts|videos|media)/i);
                  if (dlPosts && posts === 0) { posts = parseNumber(dlPosts[1]); }
                  // Rich snippet extensions from stat sites
                  if (r.rich_snippet?.top?.extensions) {
                    for (const ext of r.rich_snippet.top.extensions) {
                      const ep = ext.match(/([\d,.KMB]+)\s*(?:posts|videos|media|uploads)/i);
                      if (ep && posts === 0) posts = parseNumber(ep[1]);
                      const el = ext.match(/([\d,.KMB]+)\s*(?:likes|hearts)/i);
                      if (el && likes === 0) likes = parseNumber(el[1]);
                    }
                  }
                  if (posts > 0) break;
                }
              }
            } catch (e3: any) {
              console.log(`[SOCIAL-TRACKER] Tertiary SerpAPI search error: ${e3.message}`);
            }
          }

          // If we got any data, return it
          if (followers > 0 || displayName !== handle) {
            console.log(`[SOCIAL-TRACKER] SerpAPI fallback success for ${platform}/@${handle}: name="${displayName}", followers=${followers}, posts=${posts}, likes=${likes}`);
            return {
              displayName: displayName || `@${handle}`,
              avatarUrl,
              metrics: {
                followers,
                views: 0,
                likes,
                comments: 0,
                shares: 0,
                posts,
                timestamp: new Date().toISOString(),
              },
            };
          } else {
            console.log(`[SOCIAL-TRACKER] SerpAPI fallback found no metrics for ${platform}/@${handle}`);
          }
        } else {
          console.log(`[SOCIAL-TRACKER] SerpAPI request failed (${serpRes.status})`);
        }
      } catch (serpErr: any) {
        console.log(`[SOCIAL-TRACKER] SerpAPI fallback error: ${serpErr.message}`);
      }
    }

    // If SerpAPI also failed, throw original error
    throw new Error(
      `Could not fetch ${platform} profile for @${handle}. ${fetchError || "The page returned insufficient data."}. Try again later.`
    );
  }

  // Parse metrics from HTML
  if (platform === "tiktok") {
    return parseTikTokHtml(html, handle);
  } else {
    return parseInstagramHtml(html, handle);
  }
}

function parseNumber(str: string): number {
  if (!str) return 0;
  str = str.trim().replace(/,/g, "");
  const multipliers: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
  const match = str.match(/^([\d.]+)\s*([KMB])?$/i);
  if (match) {
    const num = parseFloat(match[1]);
    const mult = match[2] ? multipliers[match[2].toUpperCase()] || 1 : 1;
    return Math.round(num * mult);
  }
  return parseInt(str) || 0;
}

function parseTikTokHtml(html: string, handle: string): {
  metrics: MetricSnapshot;
  displayName: string;
  avatarUrl: string;
} {
  // Try to extract from __UNIVERSAL_DATA_FOR_REHYDRATION__ or embedded JSON
  let displayName = handle;
  let avatarUrl = "";
  let followers = 0;
  let likes = 0;
  let videos = 0;

  // TikTok embeds user data in a JSON script tag
  const jsonMatch = html.match(/"userInfo"\s*:\s*\{[^}]*"user"\s*:\s*(\{[^}]+\})/);
  if (jsonMatch) {
    try {
      const userData = JSON.parse(jsonMatch[1]);
      displayName = userData.nickname || handle;
      avatarUrl = userData.avatarMedium || userData.avatarThumb || "";
    } catch {}
  }

  // Try stats from JSON
  const statsMatch = html.match(/"stats"\s*:\s*(\{[^}]+\})/);
  if (statsMatch) {
    try {
      const stats = JSON.parse(statsMatch[1]);
      followers = stats.followerCount || 0;
      likes = stats.heartCount || stats.heart || 0;
      videos = stats.videoCount || 0;
    } catch {}
  }

  // Fallback: regex from rendered HTML
  if (followers === 0) {
    const followerMatch = html.match(/data-e2e="followers-count"[^>]*>([^<]+)/);
    if (followerMatch) followers = parseNumber(followerMatch[1]);
  }
  if (likes === 0) {
    const likesMatch = html.match(/data-e2e="likes-count"[^>]*>([^<]+)/);
    if (likesMatch) likes = parseNumber(likesMatch[1]);
  }

  return {
    displayName,
    avatarUrl,
    metrics: {
      followers,
      views: 0, // TikTok doesn't show total views on profile
      likes,
      comments: 0,
      shares: 0,
      posts: videos,
      timestamp: new Date().toISOString(),
    },
  };
}

function parseInstagramHtml(html: string, handle: string): {
  metrics: MetricSnapshot;
  displayName: string;
  avatarUrl: string;
} {
  let displayName = handle;
  let avatarUrl = "";
  let followers = 0;
  let posts = 0;

  // Instagram embeds data in various script tags
  // Try og:description which often has "X Followers, X Following, X Posts"
  const ogDesc = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i);
  if (ogDesc) {
    const parts = ogDesc[1];
    const followerMatch = parts.match(/([\d,.KMB]+)\s*Followers/i);
    if (followerMatch) followers = parseNumber(followerMatch[1]);
    const postMatch = parts.match(/([\d,.KMB]+)\s*Posts/i);
    if (postMatch) posts = parseNumber(postMatch[1]);
  }

  // Try og:title for display name
  const ogTitle = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i);
  if (ogTitle) {
    const titleParts = ogTitle[1].split(/[(@]/);
    displayName = titleParts[0].trim() || handle;
  }

  // Try profile pic from og:image
  const ogImage = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i);
  if (ogImage) avatarUrl = ogImage[1];

  // Try JSON-LD or shared_data
  const sharedData = html.match(/window\._sharedData\s*=\s*(\{.+?\});\s*<\/script>/);
  if (sharedData) {
    try {
      const data = JSON.parse(sharedData[1]);
      const user = data?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) {
        displayName = user.full_name || handle;
        avatarUrl = user.profile_pic_url_hd || user.profile_pic_url || avatarUrl;
        followers = user.edge_followed_by?.count || followers;
        posts = user.edge_owner_to_timeline_media?.count || posts;
      }
    } catch {}
  }

  return {
    displayName,
    avatarUrl,
    metrics: {
      followers,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      posts,
      timestamp: new Date().toISOString(),
    },
  };
}

// ─── SerpAPI-based fetcher for LinkedIn & Facebook ───────────────────
// Direct fetch and ScraperAPI both fail for LinkedIn/Facebook (auth walls, paid tiers).
// SerpAPI Google search reliably returns profile snippets with follower/connection counts.

function ensureProtocol(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function fetchGenericSocialProfile(
  platform: "linkedin" | "facebook" | "twitter",
  handle: string,
  url: string,
): Promise<{
  metrics: MetricSnapshot;
  displayName: string;
  avatarUrl: string;
}> {
  const profileUrl = ensureProtocol(url);
  const serpApiKey = getSerpSearchKey();

  if (!serpApiKey) {
    throw new Error(`SerpAPI key not configured. Cannot fetch ${platform} profile data.`);
  }

  // ── Strategy 1: SerpAPI Google search for the profile URL ──
  // Searching for the exact URL gives Google richer snippets (connections, followers in rich_snippet extensions)
  // than a generic site: search which returns bio text instead.
  const searchQuery = profileUrl;

  const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}&num=5&gl=us&hl=en`;

  console.log(`[SOCIAL-TRACKER] SerpAPI search for ${platform}/@${handle}: ${searchQuery}`);

  let displayName = handle;
  let avatarUrl = "";
  let followers = 0;
  let connections = 0;
  let posts = 0;

  try {
    const res = await serpFetch(serpUrl);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.log(`[SOCIAL-TRACKER] SerpAPI request failed (${res.status}): ${errText.slice(0, 300)}`);
      throw new Error(`SerpAPI returned ${res.status}`);
    }

    const data = await res.json();
    console.log(`[SOCIAL-TRACKER] SerpAPI returned ${data.organic_results?.length || 0} organic results for ${platform}/@${handle}`);
    // Log full response structure for debugging
    console.log(`[SOCIAL-TRACKER] SerpAPI response keys: ${Object.keys(data).join(", ")}`);
    if (data.knowledge_graph) {
      console.log(`[SOCIAL-TRACKER] Knowledge graph: ${JSON.stringify(data.knowledge_graph).slice(0, 500)}`);
    }

    // ── Parse knowledge graph if available ──
    if (data.knowledge_graph) {
      const kg = data.knowledge_graph;
      if (kg.title) displayName = kg.title;
      if (kg.thumbnail) avatarUrl = kg.thumbnail;
      if (kg.image) avatarUrl = kg.image;
      // Knowledge graph sometimes has follower stats
      const kgDesc = kg.description || "";
      const kgFollowers = kgDesc.match(/([\d,.KMB]+)\s*(?:followers|connections)/i);
      if (kgFollowers) followers = parseNumber(kgFollowers[1]);
    }

    // ── Parse organic results ──
    const results = data.organic_results || [];
    for (const result of results) {
      const resultUrl = (result.link || "").toLowerCase();
      const handleLower = handle.toLowerCase();

      // Find the result that matches our profile
      const isMatch = platform === "linkedin"
        ? (resultUrl.includes(`/in/${handleLower}`) || resultUrl.includes(`/company/${handleLower}`))
        : platform === "twitter"
        ? (resultUrl.includes(`twitter.com/${handleLower}`) || resultUrl.includes(`x.com/${handleLower}`))
        : (resultUrl.includes(`facebook.com/${handleLower}`) || resultUrl.includes(`fb.com/${handleLower}`));

      if (!isMatch) continue;

      // Log full result object for debugging
      console.log(`[SOCIAL-TRACKER] Matched result: ${JSON.stringify(result).slice(0, 800)}`);

      // Extract display name from title
      // LinkedIn titles: "Otiniel Ribeiro - CEO - Company | LinkedIn"
      // Facebook titles: "Company Name - Facebook"
      if (result.title) {
        const title = result.title
          .replace(/\s*[\|–-]\s*LinkedIn\s*$/i, "")
          .replace(/\s*[\|–-]\s*Facebook\s*$/i, "")
          .replace(/\s*\(@[^)]+\)\s*on\s*(?:X|Twitter)\s*$/i, "") // "(@handle) on X"
          .replace(/\s*[\|–-]\s*(?:X|Twitter)\s*$/i, "")
          .replace(/\s*[\|–-]\s*.*$/, "") // Remove trailing " - Role - Company" etc
          .trim();
        if (title) displayName = title;
      }

      // Extract thumbnail
      if (result.thumbnail) avatarUrl = result.thumbnail;

      // ── displayed_link — Google often puts "1.3K+ followers" here for LinkedIn ──
      const displayedLink = result.displayed_link || "";
      if (displayedLink) {
        console.log(`[SOCIAL-TRACKER] displayed_link for ${platform}/@${handle}: ${displayedLink}`);
        const dlFollowers = displayedLink.match(/([\d,.KMB]+)\+?\s*followers/i);
        if (dlFollowers) followers = parseNumber(dlFollowers[1]);
        const dlConnections = displayedLink.match(/([\d,.KMB]+)\+?\s*connections/i);
        if (dlConnections && followers === 0) followers = parseNumber(dlConnections[1]);
      }

      // Extract follower/connection counts from snippet
      const snippet = result.snippet || "";
      console.log(`[SOCIAL-TRACKER] SerpAPI snippet for ${platform}/@${handle}: ${snippet.slice(0, 300)}`);

      // LinkedIn: "500+ connections" or "1,234 followers"
      const followerMatch = snippet.match(/([\d,.KMB]+)\s*followers/i);
      if (followerMatch) followers = parseNumber(followerMatch[1]);

      const connectionMatch = snippet.match(/([\d,.+KMB]+)\s*connections/i);
      if (connectionMatch) {
        const connStr = connectionMatch[1].replace("+", "");
        connections = parseNumber(connStr);
        // Use connections as followers if no explicit follower count
        if (followers === 0) followers = connections;
      }

      // Facebook: "X people like this" or "X followers"
      const likesMatch = snippet.match(/([\d,.KMB]+)\s*(?:people\s+)?(?:like|likes)/i);
      if (likesMatch && followers === 0) followers = parseNumber(likesMatch[1]);

      // Extract posts count from snippet (LinkedIn: "X posts", Facebook: "X posts", Twitter: "X Tweets" or "X Posts")
      const postsMatch = snippet.match(/([\d,.KMB]+)\s*(?:posts|articles|updates|tweets)/i);
      if (postsMatch) posts = parseNumber(postsMatch[1]);

      // Rich snippet extensions (SerpAPI sometimes returns structured data)
      if (result.rich_snippet?.top?.extensions) {
        console.log(`[SOCIAL-TRACKER] Rich snippet top extensions: ${JSON.stringify(result.rich_snippet.top.extensions)}`);
        for (const ext of result.rich_snippet.top.extensions) {
          const extFollowers = ext.match(/([\d,.KMB]+)\s*followers/i);
          if (extFollowers) followers = parseNumber(extFollowers[1]);
          const extConnections = ext.match(/([\d,.+KMB]+)\s*connections/i);
          if (extConnections && followers === 0) followers = parseNumber(extConnections[1].replace("+", ""));
        }
      }
      if (result.rich_snippet?.bottom?.extensions) {
        console.log(`[SOCIAL-TRACKER] Rich snippet bottom extensions: ${JSON.stringify(result.rich_snippet.bottom.extensions)}`);
        for (const ext of result.rich_snippet.bottom.extensions) {
          const extFollowers = ext.match(/([\d,.KMB]+)\s*followers/i);
          if (extFollowers) followers = parseNumber(extFollowers[1]);
        }
      }

      // Also check sitelinks or inline snippet data
      if (result.snippet_highlighted_words) {
        console.log(`[SOCIAL-TRACKER] Highlighted words: ${JSON.stringify(result.snippet_highlighted_words)}`);
      }

      break; // Use first matching result
    }

    // ── If no organic match, try searching with the exact URL ──
    if (displayName === handle && results.length === 0) {
      // URL-based search already done as primary — now try site: search
      console.log(`[SOCIAL-TRACKER] No organic results matched, trying site: search fallback...`);
      const siteQuery = platform === "linkedin"
        ? `site:linkedin.com/in/${handle}`
        : platform === "twitter"
        ? `site:twitter.com/${handle} OR site:x.com/${handle}`
        : `site:facebook.com/${handle}`;
      const urlSearchUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(siteQuery)}&api_key=${serpApiKey}&num=3&gl=us&hl=en`;
      const res2 = await serpFetch(urlSearchUrl);
      if (res2.ok) {
        const data2 = await res2.json();
        const results2 = data2.organic_results || [];
        for (const r of results2) {
          if (r.title) {
            displayName = r.title
              .replace(/\s*[\|–-]\s*LinkedIn\s*$/i, "")
              .replace(/\s*[\|–-]\s*Facebook\s*$/i, "")
              .replace(/\s*[\|–-]\s*.*$/, "")
              .trim() || handle;
          }
          if (r.thumbnail) avatarUrl = r.thumbnail;
          const snippet2 = r.snippet || "";
          const fm2 = snippet2.match(/([\d,.KMB]+)\s*followers/i);
          if (fm2) followers = parseNumber(fm2[1]);
          const cm2 = snippet2.match(/([\d,.+KMB]+)\s*connections/i);
          if (cm2 && followers === 0) followers = parseNumber(cm2[1].replace("+", ""));
          break;
        }
      }
    }

    // ── Secondary search for posts/articles count (LinkedIn & Facebook) ──
    if (followers > 0 && posts === 0) {
      try {
        const postQuery = platform === "linkedin"
          ? `"${displayName}" linkedin posts articles`
          : platform === "twitter"
          ? `"${displayName}" twitter posts tweets`
          : `"${displayName}" facebook posts`;
        console.log(`[SOCIAL-TRACKER] Trying secondary SerpAPI search for ${platform}/@${handle} posts: ${postQuery}`);
        const serpUrl2 = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(postQuery)}&api_key=${serpApiKey}&num=5&gl=us&hl=en`;
        const serpRes2 = await serpFetch(serpUrl2);
        if (serpRes2.ok) {
          const serpData2 = await serpRes2.json();
          for (const r of (serpData2.organic_results || [])) {
            const s = (r.snippet || "") + " " + (r.title || "") + " " + (r.displayed_link || "");
            // Look for "X posts", "X articles", "posted X times"
            const pm = s.match(/([\d,.KMB]+)\s*(?:posts|articles|updates|contributions)/i);
            if (pm && posts === 0) {
              posts = parseNumber(pm[1]);
              console.log(`[SOCIAL-TRACKER] Secondary search found posts=${posts} from ${(r.link || "").slice(0, 80)}`);
            }
            // Also check rich snippet extensions from LinkedIn activity pages
            if (r.rich_snippet?.top?.extensions) {
              for (const ext of r.rich_snippet.top.extensions) {
                const ep = ext.match(/([\d,.KMB]+)\s*(?:posts|articles)/i);
                if (ep && posts === 0) {
                  posts = parseNumber(ep[1]);
                  console.log(`[SOCIAL-TRACKER] Secondary search rich snippet found posts=${posts}`);
                }
              }
            }
            if (posts > 0) break;
          }
        }
      } catch (e2: any) {
        console.log(`[SOCIAL-TRACKER] Secondary SerpAPI search error for ${platform}: ${e2.message}`);
      }
    }

  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] SerpAPI error for ${platform}/@${handle}: ${err.message}`);
    // Don't throw — we'll save the account with whatever we have (even if just the handle)
  }

  console.log(`[SOCIAL-TRACKER] ${platform}/@${handle} result: name="${displayName}", followers=${followers}, posts=${posts}, avatar=${avatarUrl ? "yes" : "no"}`);

  return {
    displayName: displayName || `@${handle}`,
    avatarUrl,
    metrics: {
      followers,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      posts,
      timestamp: new Date().toISOString(),
    },
  };
}

// ─── Fetch Metrics Dispatcher ────────────────────────────────────────

async function fetchMetricsForAccount(account: TrackedAccount): Promise<{
  metrics: MetricSnapshot;
  displayName: string;
  avatarUrl: string;
}> {
  switch (account.platform) {
    case "youtube":
      return fetchYouTubeMetrics(account.handle);
    case "tiktok":
    case "instagram":
      return fetchSocialProfile(account.platform, account.handle);
    case "linkedin":
    case "facebook":
    case "twitter":
      return fetchGenericSocialProfile(account.platform, account.handle, account.url);
    default:
      throw new Error(`Unsupported platform: ${account.platform}`);
  }
}

// ─── Hono App ────────────────────────────────────────────────────────

const trackerApp = new Hono();

// ── List tracked accounts ──
trackerApp.get("/tracked", async (c) => {
  try {
    const user = await requireUser(c);
    const accounts = await getUserTracked(user.id);
    return c.json({ accounts });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] List error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── Add tracked account ──
trackerApp.post("/track", async (c) => {
  try {
    const user = await requireUser(c);
    const body = await c.req.json();
    const { url, profileType } = body;

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL is required" }, 400);
    }

    const parsed = parseSocialUrl(url);
    if (!parsed) {
      return c.json({ error: "Could not detect platform from URL. Supported: YouTube, TikTok, Instagram, LinkedIn, Facebook, X (Twitter)" }, 400);
    }

    // Check for duplicate
    const existing = await getUserTracked(user.id);
    const dup = existing.find(a => a.platform === parsed.platform && a.handle.toLowerCase() === parsed.handle.toLowerCase());
    if (dup) {
      return c.json({ error: `Already tracking @${parsed.handle} on ${parsed.platform}` }, 409);
    }

    // Limit to 50 tracked accounts per user
    if (existing.length >= 50) {
      return c.json({ error: "Maximum 50 tracked accounts reached" }, 400);
    }

    const id = `${parsed.platform}_${parsed.handle.toLowerCase()}_${Date.now().toString(36)}`;

    const account: TrackedAccount = {
      id,
      userId: user.id,
      platform: parsed.platform,
      handle: parsed.handle,
      url: url.trim(),
      profileType: profileType === 'competitor' ? 'competitor' : 'own',
      addedAt: new Date().toISOString(),
    };

    // Save initial placeholder immediately to prevent timeout
    await kv.set(trackKey(user.id, id), JSON.stringify(account));

    // Fetch metrics in background
    // @ts-ignore - Available in Supabase Edge Functions
    EdgeRuntime.waitUntil((async () => {
      try {
        const result = await fetchMetricsForAccount(account);
        account.displayName = result.displayName;
        account.avatarUrl = result.avatarUrl;
        account.latestMetrics = result.metrics;
        account.lastSyncedAt = new Date().toISOString();

        // Save initial snapshot
        const snapTs = new Date().toISOString().replace(/[-:]/g, "").slice(0, 11);
        await kv.set(snapshotKey(user.id, id, snapTs), JSON.stringify(result.metrics));
      } catch (fetchErr: any) {
        console.log(`[SOCIAL-TRACKER] Initial fetch failed for ${parsed.platform}/@${parsed.handle}: ${fetchErr.message}`);
        account.syncError = fetchErr.message;
        account.displayName = `@${parsed.handle}`;
      }
      await kv.set(trackKey(user.id, id), JSON.stringify(account));
    })());

    return c.json({ account, message: "Profile tracked, metrics syncing in background..." });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] Track error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── Remove tracked account ──
trackerApp.delete("/tracked/:id", async (c) => {
  try {
    const user = await requireUser(c);
    const id = c.req.param("id");

    await kv.del(trackKey(user.id, id));

    // Clean up snapshots (best effort)
    try {
      const snapKeys = await kv.getByPrefix(snapshotPrefix(user.id, id));
      if (snapKeys && snapKeys.length > 0) {
        // We can't get keys from getByPrefix (it returns values), so we can't delete them.
        // They'll naturally become orphaned. This is fine for KV store.
      }
    } catch {}

    return c.json({ success: true });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] Delete error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── Sync metrics for one account ──
trackerApp.post("/tracked/:id/sync", async (c) => {
  try {
    const user = await requireUser(c);
    const id = c.req.param("id");

    const raw = await kv.get(trackKey(user.id, id));
    if (!raw) return c.json({ error: "Account not found" }, 404);

    const account: TrackedAccount = JSON.parse(raw);

    // Fetch metrics in background to prevent timeout
    // @ts-ignore
    EdgeRuntime.waitUntil((async () => {
      try {
        const result = await fetchMetricsForAccount(account);
        account.displayName = result.displayName;
        account.avatarUrl = result.avatarUrl;
        account.latestMetrics = result.metrics;
        account.lastSyncedAt = new Date().toISOString();
        account.syncError = undefined;

        // Save snapshot
        const snapTs = new Date().toISOString().replace(/[-:]/g, "").slice(0, 11);
        await kv.set(snapshotKey(user.id, id, snapTs), JSON.stringify(result.metrics));

        // Update account
        await kv.set(trackKey(user.id, id), JSON.stringify(account));
      } catch (err: any) {
        console.log(`[SOCIAL-TRACKER] Sync error for ${id}: ${err.message}`);
        account.syncError = err.message;
        account.lastSyncedAt = new Date().toISOString();
        await kv.set(trackKey(user.id, id), JSON.stringify(account));
      }
    })());

    return c.json({ account, syncing: true, message: "Sync started in background..." });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] Sync error: ${err.message}`);

    // Update the account with the error
    try {
      const user = await requireUser(c);
      const id = c.req.param("id");
      const raw = await kv.get(trackKey(user.id, id));
      if (raw) {
        const account: TrackedAccount = JSON.parse(raw);
        account.syncError = err.message;
        account.lastSyncedAt = new Date().toISOString();
        await kv.set(trackKey(user.id, id), JSON.stringify(account));
      }
    } catch {}

    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── Sync all tracked accounts ──
trackerApp.post("/sync-all", async (c) => {
  try {
    const user = await requireUser(c);
    const accounts = await getUserTracked(user.id);

    // @ts-ignore
    EdgeRuntime.waitUntil((async () => {
      for (const account of accounts) {
        try {
          const result = await fetchMetricsForAccount(account);
          account.displayName = result.displayName;
          account.avatarUrl = result.avatarUrl;
          account.latestMetrics = result.metrics;
          account.lastSyncedAt = new Date().toISOString();
          account.syncError = undefined;

          const snapTs = new Date().toISOString().replace(/[-:]/g, "").slice(0, 11);
          await kv.set(snapshotKey(user.id, account.id, snapTs), JSON.stringify(result.metrics));
          await kv.set(trackKey(user.id, account.id), JSON.stringify(account));
        } catch (err: any) {
          console.log(`[SOCIAL-TRACKER] Sync failed for ${account.platform}/@${account.handle}: ${err.message}`);
          account.syncError = err.message;
          account.lastSyncedAt = new Date().toISOString();
          await kv.set(trackKey(user.id, account.id), JSON.stringify(account));
        }
      }
      // After syncing all accounts, check for competitive alerts + store gap snapshot
      try {
        const updatedAccounts = await getUserTracked(user.id);
        await checkAndCreateAlerts(user.id, updatedAccounts);
        await storeGapSnapshot(user.id, updatedAccounts);
      } catch (alertErr: any) {
        console.log(`[SOCIAL-TRACKER] Alert/gap check error: ${alertErr.message}`);
      }
    })());

    return c.json({ syncing: true, count: accounts.length, message: "Syncing accounts in background..." });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] Sync-all error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── Get metric history for an account ──
trackerApp.get("/tracked/:id/metrics", async (c) => {
  try {
    const user = await requireUser(c);
    const id = c.req.param("id");
    const limit = parseInt(c.req.query("limit") || "30");

    const snapshots = await getSnapshots(user.id, id, limit);
    return c.json({ snapshots });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] Metrics error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── Parse URL (helper for frontend) ──
trackerApp.post("/parse-url", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = parseSocialUrl(body.url || "");
    if (!parsed) {
      return c.json({ error: "Could not detect platform" }, 400);
    }
    return c.json(parsed);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// ─── Competitor Alerts ───────────────────────────────────────────────
// Alerts are generated on sync when a competitor overtakes the user or
// hits a milestone (10K, 50K, 100K, 500K, 1M followers etc.)

const MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000];

function alertsPrefix(userId: string) { return `social_alerts:${userId}:`; }
function alertKey(userId: string, alertId: string) { return `social_alerts:${userId}:${alertId}`; }

interface CompetitorAlert {
  id: string;
  type: 'overtake' | 'milestone';
  competitorName: string;
  competitorHandle: string;
  platform: string;
  metric: string;
  competitorValue: number;
  yourValue?: number;
  milestone?: number;
  timestamp: string;
  dismissed: boolean;
}

async function checkAndCreateAlerts(userId: string, allAccounts: TrackedAccount[]) {
  const ownAccounts = allAccounts.filter(a => a.profileType !== 'competitor');
  const competitorAccounts = allAccounts.filter(a => a.profileType === 'competitor');
  if (ownAccounts.length === 0 || competitorAccounts.length === 0) return;

  // Own metrics by platform
  const ownByPlatform: Record<string, Record<string, number>> = {};
  for (const a of ownAccounts) {
    if (!a.latestMetrics) continue;
    if (!ownByPlatform[a.platform]) ownByPlatform[a.platform] = {};
    for (const key of ['followers', 'likes', 'posts', 'views']) {
      ownByPlatform[a.platform][key] = (ownByPlatform[a.platform][key] || 0) + ((a.latestMetrics as any)[key] || 0);
    }
  }

  // Load existing alerts to avoid duplicates
  const existingRaw = await kv.getByPrefix(alertsPrefix(userId));
  const existingAlerts: CompetitorAlert[] = (existingRaw || []).map((r: string) => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean);

  const newAlerts: CompetitorAlert[] = [];

  for (const comp of competitorAccounts) {
    if (!comp.latestMetrics) continue;
    const ownSamePlatform = ownByPlatform[comp.platform];
    if (!ownSamePlatform) continue;

    // Check overtake on followers
    const ownFollowers = ownSamePlatform['followers'] || 0;
    const compFollowers = comp.latestMetrics.followers || 0;
    if (compFollowers > 0 && ownFollowers > 0 && compFollowers > ownFollowers) {
      const alreadyAlerted = existingAlerts.some(a =>
        a.type === 'overtake' && a.competitorHandle === comp.handle && a.platform === comp.platform && a.metric === 'followers' && !a.dismissed
      );
      if (!alreadyAlerted) {
        newAlerts.push({
          id: `overtake_${comp.handle}_${comp.platform}_followers_${Date.now().toString(36)}`,
          type: 'overtake',
          competitorName: comp.displayName || comp.handle,
          competitorHandle: comp.handle,
          platform: comp.platform,
          metric: 'followers',
          competitorValue: compFollowers,
          yourValue: ownFollowers,
          timestamp: new Date().toISOString(),
          dismissed: false,
        });
      }
    }

    // Check milestones
    for (const milestone of MILESTONES) {
      if (compFollowers >= milestone) {
        const alreadyAlerted = existingAlerts.some(a =>
          a.type === 'milestone' && a.competitorHandle === comp.handle && a.platform === comp.platform && a.milestone === milestone
        );
        if (!alreadyAlerted) {
          // Only alert for the highest milestone not yet alerted
          const higherAlerted = existingAlerts.some(a =>
            a.type === 'milestone' && a.competitorHandle === comp.handle && a.platform === comp.platform && (a.milestone || 0) > milestone
          );
          if (!higherAlerted) {
            newAlerts.push({
              id: `milestone_${comp.handle}_${comp.platform}_${milestone}_${Date.now().toString(36)}`,
              type: 'milestone',
              competitorName: comp.displayName || comp.handle,
              competitorHandle: comp.handle,
              platform: comp.platform,
              metric: 'followers',
              competitorValue: compFollowers,
              milestone,
              timestamp: new Date().toISOString(),
              dismissed: false,
            });
          }
        }
      }
    }
  }

  // Save new alerts
  for (const alert of newAlerts) {
    await kv.set(alertKey(userId, alert.id), JSON.stringify(alert));
  }

  console.log(`[SOCIAL-TRACKER] Created ${newAlerts.length} new alerts for user ${userId}`);
}

// ── Get alerts ──
trackerApp.get("/alerts", async (c) => {
  try {
    const user = await requireUser(c);
    const raw = await kv.getByPrefix(alertsPrefix(user.id));
    const alerts: CompetitorAlert[] = (raw || []).map((r: string) => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);
    // Sort newest first, limit to 20
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return c.json({ alerts: alerts.slice(0, 20) });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] Alerts error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── Dismiss alert ──
trackerApp.post("/alerts/:id/dismiss", async (c) => {
  try {
    const user = await requireUser(c);
    const id = c.req.param("id");
    const key = alertKey(user.id, id);
    const raw = await kv.get(key);
    if (raw) {
      const alert: CompetitorAlert = JSON.parse(raw as string);
      alert.dismissed = true;
      await kv.set(key, JSON.stringify(alert));
    }
    return c.json({ success: true });
  } catch (err: any) {
    console.log(`[SOCIAL-TRACKER] Dismiss alert error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ─── Gap History ─────────────────────────────────────────────────────

function gapHistoryPrefix(userId: string) { return `social_gap:${userId}:`; }
function gapHistoryKey(userId: string, date: string) { return `social_gap:${userId}:${date}`; }

interface GapSnapshot {
  date: string;
  gaps: {
    competitorId: string;
    competitorName: string;
    competitorHandle: string;
    platform: string;
    gapPct: number;
    ownFollowers: number;
    compFollowers: number;
  }[];
}

async function storeGapSnapshot(userId: string, allAccounts: TrackedAccount[]) {
  const ownAccounts = allAccounts.filter(a => a.profileType !== 'competitor');
  const competitorAccounts = allAccounts.filter(a => a.profileType === 'competitor');
  if (ownAccounts.length === 0 || competitorAccounts.length === 0) return;

  const ownByPlatform: Record<string, number> = {};
  let totalOwnFollowers = 0;
  for (const a of ownAccounts) {
    const f = a.latestMetrics?.followers || 0;
    ownByPlatform[a.platform] = (ownByPlatform[a.platform] || 0) + f;
    totalOwnFollowers += f;
  }

  const today = new Date().toISOString().slice(0, 10);
  const gaps = competitorAccounts.map(comp => {
    const compF = comp.latestMetrics?.followers || 0;
    const ownF = ownByPlatform[comp.platform] || totalOwnFollowers;
    const gapPct = ownF > 0 ? Math.round(((compF - ownF) / ownF) * 100) : (compF > 0 ? 100 : 0);
    return {
      competitorId: comp.id,
      competitorName: comp.displayName || comp.handle,
      competitorHandle: comp.handle,
      platform: comp.platform,
      gapPct,
      ownFollowers: ownF,
      compFollowers: compF,
    };
  });

  await kv.set(gapHistoryKey(userId, today), JSON.stringify({ date: today, gaps }));
  console.log(`[SOCIAL-TRACKER] Stored gap snapshot for ${today}`);
}

trackerApp.get("/gap-history", async (c) => {
  try {
    const user = await requireUser(c);
    const days = parseInt(c.req.query("days") || "30");
    const raw = await kv.getByPrefix(gapHistoryPrefix(user.id));
    const snapshots: GapSnapshot[] = (raw || []).map((r: string) => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);
    snapshots.sort((a, b) => a.date.localeCompare(b.date));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return c.json({ snapshots: snapshots.filter(s => s.date >= cutoff) });
  } catch (err: any) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ─── Digest Preferences ──────────────────────────────────────────────

function digestPrefsKey(userId: string) { return `social_digest_prefs:${userId}`; }

interface DigestPrefs {
  frequency: 'off' | 'daily' | 'weekly';
  email?: string;
  lastSentAt?: string;
}

trackerApp.get("/digest/preferences", async (c) => {
  try {
    const user = await requireUser(c);
    const raw = await kv.get(digestPrefsKey(user.id));
    return c.json({ preferences: raw ? JSON.parse(raw as string) : { frequency: 'off' } });
  } catch (err: any) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

trackerApp.put("/digest/preferences", async (c) => {
  try {
    const user = await requireUser(c);
    const body = await c.req.json();
    const existing = await kv.get(digestPrefsKey(user.id));
    const prefs: DigestPrefs = existing ? JSON.parse(existing as string) : { frequency: 'off' };
    if (body.frequency) prefs.frequency = body.frequency;
    if (body.email !== undefined) prefs.email = body.email;
    await kv.set(digestPrefsKey(user.id), JSON.stringify(prefs));
    return c.json({ preferences: prefs });
  } catch (err: any) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ─── Send Digest Email ───────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

trackerApp.post("/digest/send", async (c) => {
  try {
    const user = await requireUser(c);
    const accounts = await getUserTracked(user.id);
    const ownAccounts = accounts.filter(a => a.profileType !== 'competitor');
    const competitorAccounts = accounts.filter(a => a.profileType === 'competitor');
    if (competitorAccounts.length === 0) return c.json({ error: "No competitors tracked" }, 400);

    const prefsRaw = await kv.get(digestPrefsKey(user.id));
    const prefs: DigestPrefs = prefsRaw ? JSON.parse(prefsRaw as string) : { frequency: 'off' };
    const recipientEmail = prefs.email || user.email;
    if (!recipientEmail) return c.json({ error: "No email configured" }, 400);

    const alertsRaw = await kv.getByPrefix(alertsPrefix(user.id));
    const alerts: CompetitorAlert[] = (alertsRaw || []).map((r: string) => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean).filter(a => !a.dismissed);
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const ownByPlatform: Record<string, number> = {};
    let totalOwnF = 0;
    for (const a of ownAccounts) { const f = a.latestMetrics?.followers || 0; ownByPlatform[a.platform] = (ownByPlatform[a.platform] || 0) + f; totalOwnF += f; }

    const gapRows = competitorAccounts.map(comp => {
      const compF = comp.latestMetrics?.followers || 0;
      const ownF = ownByPlatform[comp.platform] || totalOwnF;
      const gap = ownF > 0 ? Math.round(((compF - ownF) / ownF) * 100) : 100;
      return { name: comp.displayName || comp.handle, platform: comp.platform, compF, ownF, gap };
    }).sort((a, b) => b.gap - a.gap);

    const alertsHtml = alerts.length > 0 ? `
      <div style="margin-bottom:24px;">
        <h2 style="font-size:16px;font-weight:700;color:#ef4444;margin-bottom:12px;">⚠️ Alerts</h2>
        ${alerts.slice(0, 5).map(a => `
          <div style="padding:10px 14px;margin-bottom:8px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;font-size:13px;">
            <strong>${a.competitorName}</strong> ${a.type === 'overtake' ? `overtook you on ${a.metric} — ${fmtNum(a.competitorValue)} vs ${fmtNum(a.yourValue || 0)}` : `hit ${fmtNum(a.milestone || 0)} ${a.metric}`}
          </div>
        `).join('')}
      </div>` : '';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="background:#fff;border-radius:16px;border:1px solid #e4e4e7;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#09090b,#18181b);padding:28px 24px;text-align:center;">
        <h1 style="margin:0;font-size:20px;font-weight:800;color:#fff;">🗡️ Competitive Intelligence Digest</h1>
        <p style="margin:6px 0 0;font-size:12px;color:#a1a1aa;">Contndr · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>
      <div style="padding:24px;">
        ${alertsHtml}
        <h2 style="font-size:16px;font-weight:700;color:#18181b;margin-bottom:16px;">📊 Competitive Gap Summary</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:2px solid #e4e4e7;">
            <th style="text-align:left;padding:8px 12px;color:#71717a;font-weight:600;font-size:11px;text-transform:uppercase;">Competitor</th>
            <th style="text-align:left;padding:8px 12px;color:#71717a;font-weight:600;font-size:11px;text-transform:uppercase;">Platform</th>
            <th style="text-align:right;padding:8px 12px;color:#71717a;font-weight:600;font-size:11px;text-transform:uppercase;">You</th>
            <th style="text-align:right;padding:8px 12px;color:#71717a;font-weight:600;font-size:11px;text-transform:uppercase;">Them</th>
            <th style="text-align:right;padding:8px 12px;color:#71717a;font-weight:600;font-size:11px;text-transform:uppercase;">Gap</th>
          </tr></thead>
          <tbody>${gapRows.map(r => `
            <tr style="border-bottom:1px solid #f4f4f5;">
              <td style="padding:10px 12px;font-weight:600;color:#18181b;">${r.name}</td>
              <td style="padding:10px 12px;color:#71717a;text-transform:capitalize;">${r.platform}</td>
              <td style="padding:10px 12px;text-align:right;color:#1ED4A7;font-weight:700;">${fmtNum(r.ownF)}</td>
              <td style="padding:10px 12px;text-align:right;color:#f97316;font-weight:700;">${fmtNum(r.compF)}</td>
              <td style="padding:10px 12px;text-align:right;font-weight:700;color:${r.gap <= 0 ? '#1ED4A7' : '#f97316'};">${r.gap <= 0 ? `${Math.abs(r.gap)}% ahead` : `${r.gap}% behind`}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:12px;border:1px solid #e4e4e7;display:flex;justify-content:space-around;text-align:center;">
          <div><div style="font-size:10px;color:#71717a;text-transform:uppercase;font-weight:600;">Your Profiles</div><div style="font-size:24px;font-weight:800;color:#18181b;margin-top:4px;">${ownAccounts.length}</div></div>
          <div><div style="font-size:10px;color:#f97316;text-transform:uppercase;font-weight:600;">Competitors</div><div style="font-size:24px;font-weight:800;color:#18181b;margin-top:4px;">${competitorAccounts.length}</div></div>
          <div><div style="font-size:10px;color:#1ED4A7;text-transform:uppercase;font-weight:600;">Your Followers</div><div style="font-size:24px;font-weight:800;color:#1ED4A7;margin-top:4px;">${fmtNum(totalOwnF)}</div></div>
        </div>
        <div style="text-align:center;margin-top:24px;">
          <a href="https://app.contndr.com/app/social" style="display:inline-block;padding:12px 28px;background:#18181b;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:13px;">View Full Report →</a>
        </div>
      </div>
      <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;text-align:center;">
        <p style="margin:0;font-size:11px;color:#a1a1aa;">Sent by Contndr · <a href="https://app.contndr.com/app/settings" style="color:#71717a;">Manage Preferences</a></p>
      </div>
    </div>
  </div>
</body></html>`;

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) return c.json({ error: "Resend API key not configured" }, 500);

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Contndr Intelligence <noreply@contndr.com>',
        to: recipientEmail,
        subject: `🗡️ Competitive Intelligence Digest — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        html,
      }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      return c.json({ error: `Email send failed: ${err}` }, 500);
    }

    prefs.lastSentAt = new Date().toISOString();
    await kv.set(digestPrefsKey(user.id), JSON.stringify(prefs));
    return c.json({ success: true, message: `Digest sent to ${recipientEmail}` });
  } catch (err: any) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ─── Report Data ─────────────────────────────────────────────────────

trackerApp.get("/report-data", async (c) => {
  try {
    const user = await requireUser(c);
    const accounts = await getUserTracked(user.id);
    const gapRaw = await kv.getByPrefix(gapHistoryPrefix(user.id));
    const gapSnapshots: GapSnapshot[] = (gapRaw || []).map((r: string) => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);
    gapSnapshots.sort((a, b) => a.date.localeCompare(b.date));
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const alertsRaw = await kv.getByPrefix(alertsPrefix(user.id));
    const alerts: CompetitorAlert[] = (alertsRaw || []).map((r: string) => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return c.json({
      ownAccounts: accounts.filter(a => a.profileType !== 'competitor'),
      competitorAccounts: accounts.filter(a => a.profileType === 'competitor'),
      gapHistory: gapSnapshots.filter(s => s.date >= cutoff),
      alerts: alerts.slice(0, 30),
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, err.status || 500);
  }
});

export default trackerApp;
