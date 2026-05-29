// Social Creator Providers — Instagram, TikTok, X (Twitter)
// Discovery via SerpAPI Google search, profile scraping, email extraction
// v3: Full multi-source email enrichment pipeline + Hunter email finder + SerpAPI fallback

import { getSerpSearchKey, serpFetch } from "./serp-adapter.tsx";

export type SocialPlatform = "instagram" | "tiktok" | "x";

export interface DiscoveredProfile {
  platform: SocialPlatform;
  keyword: string;
  profile_url: string;
  handle: string;
  display_name?: string;
  snippet_followers_text?: string;
  snippet_followers_int?: number;
  _keywords?: string[];
}

export interface FetchedProfile {
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
  // Engagement metrics
  engagement_rate?: number;       // percentage, e.g. 3.2 = 3.2%
  avg_likes?: number;
  avg_comments?: number;
  posts_analyzed?: number;
}

const SERPAPI_API_KEY = () => getSerpSearchKey();
const HUNTER_API_KEY = () => Deno.env.get("HUNTER_API_KEY") || "";
const FINDYMAIL_API_KEY = () => Deno.env.get("FINDYMAIL_API_KEY") || "";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "zoho.com", "yandex.com",
  "live.com", "msn.com", "gmx.com", "tutanota.com", "fastmail.com",
]);

const SKIP_WEBSITE_DOMAINS = new Set([
  "twitter.com", "x.com", "instagram.com", "facebook.com", "fb.com",
  "tiktok.com", "twitch.tv", "discord.gg", "discord.com", "reddit.com",
  "linkedin.com", "pinterest.com", "snapchat.com", "threads.net",
  "patreon.com", "ko-fi.com", "buymeacoffee.com", "gofundme.com",
  "bit.ly", "linktr.ee", "linkin.bio", "beacons.ai", "stan.store",
  "amazon.com", "amzn.to", "ebay.com", "etsy.com",
  "spotify.com", "apple.com", "music.apple.com", "soundcloud.com",
  "play.google.com", "apps.apple.com",
  "abs.twimg.com", "pbs.twimg.com", "twimg.com", "t.co",
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

// ══════════════════════════════════════════════════════════════════════════
// PROFILE DISCOVERY via SerpAPI
// ══════════════════════════════════════════════════════════════════════════

export async function discoverProfiles(
  platform: SocialPlatform,
  keyword: string,
  maxResults: number
): Promise<DiscoveredProfile[]> {
  const apiKey = SERPAPI_API_KEY();
  if (!apiKey) {
    console.warn("[SOCIAL-PROVIDERS] SERPAPI_API_KEY not set");
    return [];
  }

  const queries = buildPlatformQueries(platform, keyword);
  const profiles: DiscoveredProfile[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        engine: "google",
        q: query,
        api_key: apiKey,
        num: String(Math.min(maxResults * 3, 40)),
      });

      const res = await serpFetch(`https://serpapi.com/search?${params.toString()}`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.warn(`[SOCIAL-PROVIDERS] SerpAPI error ${res.status} for ${platform} "${keyword}"`);
        continue;
      }

      const data = await res.json();
      const results = data.organic_results || [];

      for (const item of results) {
        const url = item.link || "";
        if (!url) continue;
        
        const normalized = normalizeProfileUrl(platform, url);
        if (!normalized || seenUrls.has(normalized)) continue;
        
        seenUrls.add(normalized);
        
        profiles.push({
          platform,
          keyword,
          profile_url: normalized,
          handle: extractHandleFromUrl(platform, normalized),
          display_name: item.title || "",
          snippet_followers_text: (() => {
            const m = (item.snippet || "").match(/([\d,.]+\s*[KkMmBb]?)\s+[Ff]ollowers/);
            return m ? m[1].trim() : undefined;
          })(),
          snippet_followers_int: (() => {
            const m = (item.snippet || "").match(/([\d,.]+\s*[KkMmBb]?)\s+[Ff]ollowers/);
            return m ? parseFollowerShorthand(m[1].replace(/[,\s]/g, "")) : 0;
          })(),
          _keywords: [keyword],
        });

        if (profiles.length >= maxResults) break;
      }

      if (profiles.length >= maxResults) break;
    } catch (err: any) {
      console.warn(`[SOCIAL-PROVIDERS] SerpAPI discovery error for ${platform} "${keyword}": ${err.message}`);
    }
  }

  console.log(`[SOCIAL-PROVIDERS] Discovered ${profiles.length} ${platform} profiles for keyword "${keyword}"`);
  return profiles;
}

function buildPlatformQueries(platform: SocialPlatform, keyword: string): string[] {
  switch (platform) {
    case "instagram":
      return [
        `site:instagram.com ${keyword} creator`,
        `site:instagram.com ${keyword}`,
        `site:instagram.com ${keyword} influencer`,
      ];
    case "tiktok":
      return [
        `site:tiktok.com/@* ${keyword}`,
        `site:tiktok.com ${keyword}`,
        `site:tiktok.com ${keyword} creator`,
      ];
    case "x":
      return [
        `site:x.com ${keyword}`,
        `site:twitter.com ${keyword}`,
        `site:x.com ${keyword} creator`,
      ];
    default:
      return [`site:${platform}.com ${keyword}`];
  }
}

function normalizeProfileUrl(platform: SocialPlatform, url: string): string | null {
  try {
    const u = new URL(url);
    // Strip trailing slashes and get clean path segments
    const segments = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segments.length === 0) return null;

    switch (platform) {
      case "instagram": {
        // First segment is the username — skip system pages and post/reel URLs
        const handle = segments[0];
        const systemPages = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "directory", "about", "legal", "developer", "static"]);
        if (systemPages.has(handle.toLowerCase())) return null;
        if (!/^[\w.][\w.]{0,29}$/.test(handle)) return null;
        return `https://www.instagram.com/${handle}`;
      }
      case "tiktok": {
        // Handle is the @username segment
        const first = segments[0];
        if (first.startsWith("@")) {
          const handle = first.slice(1);
          if (!/^[\w.]{1,30}$/.test(handle)) return null;
          return `https://www.tiktok.com/@${handle}`;
        }
        // Skip non-profile paths like /discover, /tag, /music, etc.
        return null;
      }
      case "x": {
        const handle = segments[0];
        const systemPages = new Set([
          "search", "explore", "home", "messages", "notifications", "settings",
          "i", "intent", "compose", "hashtag", "lists", "login", "signup",
          "tos", "privacy", "about", "help",
        ]);
        if (systemPages.has(handle.toLowerCase())) return null;
        if (!/^\w{1,15}$/.test(handle)) return null;
        return `https://x.com/${handle}`;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function extractHandleFromUrl(platform: SocialPlatform, url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    
    if (platform === "tiktok") {
      const match = path.match(/^\/@([\w.]+)/);
      return match ? match[1] : "";
    } else {
      const match = path.match(/^\/([\w.]+)/);
      return match ? match[1] : "";
    }
  } catch {
    return "";
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PROFILE ENRICHMENT (scrape + email enrichment)
// ══════════════════════════════════════════════════════════════════════════

export async function enrichSocialProfile(profile: DiscoveredProfile): Promise<FetchedProfile> {
  console.log(`[SOCIAL-PROVIDERS] Enriching ${profile.platform} profile: ${profile.profile_url}`);

  try {
    // Step 1: Scrape profile page (gracefully handle failures)
    let scraped: { display_name: string; followers_text: string; followers_int: number; bio: string; external_links: string[]; engagement?: { rate: number; avg_likes: number; avg_comments: number; posts_analyzed: number } };
    try {
      scraped = await scrapeProfilePage(profile.platform, profile.profile_url);
    } catch (scrapeErr: any) {
      console.warn(`[SOCIAL-PROVIDERS] Scrape failed for ${profile.profile_url}: ${scrapeErr.message}, using discovery data`);
      scraped = {
        display_name: "",
        followers_text: "0",
        followers_int: 0,
        bio: "",
        external_links: [],
      };
    }

    // Build effective name: prefer scraped, fall back to discovery title
    let effectiveName = scraped.display_name;
    if (!effectiveName && profile.display_name) {
      effectiveName = profile.display_name;
      console.log(`[SOCIAL-PROVIDERS] Using discovery name fallback for ${profile.handle}: "${effectiveName}"`);
    }

    // UNIVERSAL: run cleanCreatorName on ALL names (scraped or discovery)
    // This strips "(@handle)", "/ Posts", "| TikTok", "- YouTube", trailing "...", etc.
    effectiveName = cleanCreatorName(effectiveName, profile.handle);

    // Followers fallback: use SerpAPI snippet followers when scraping returned 0
    // Google snippets for X/Twitter often contain "123.4K Followers"
    let effectiveFollowersText = scraped.followers_text;
    let effectiveFollowersInt = scraped.followers_int;
    if (!effectiveFollowersInt && profile.snippet_followers_int && profile.snippet_followers_int > 0) {
      effectiveFollowersInt = profile.snippet_followers_int;
      effectiveFollowersText = formatFollowers(effectiveFollowersInt);
      console.log(`[SOCIAL-PROVIDERS] Using SerpAPI snippet followers for ${profile.handle}: ${effectiveFollowersText}`);
    }

    // Step 2: Multi-source email enrichment
    const emailSourceMap: Record<string, string> = {};
    const sourcesUsed: string[] = [];

    // Bio emails
    const bioEmails = extractEmails(scraped.bio);
    for (const e of bioEmails) {
      if (!emailSourceMap[e]) emailSourceMap[e] = "bio";
    }
    if (bioEmails.length > 0) sourcesUsed.push("bio");

    // Website + Hunter enrichment (requires external links)
    if (Object.keys(emailSourceMap).length === 0 && scraped.external_links.length > 0) {
      // Step 3: Website scraping
      const websiteResult = await scrapeLinkedWebsitesForEmails(scraped.external_links);
      for (const e of websiteResult.emails) {
        if (!emailSourceMap[e]) emailSourceMap[e] = "website";
      }
      if (websiteResult.emails.length > 0) sourcesUsed.push("website");

      // Step 4: Hunter.io domain search
      const hunterDomain = extractBestDomainForHunter(scraped.external_links);
      if (hunterDomain) {
        const hunterResult = await hunterDomainSearch(hunterDomain);
        for (const e of hunterResult.emails) {
          if (!emailSourceMap[e]) emailSourceMap[e] = "hunter_domain";
        }
        if (hunterResult.emails.length > 0) sourcesUsed.push("hunter_domain");
      }

      // Step 5: Hunter.io email finder (name + domain)
      const nameForHunter = effectiveName || profile.handle;
      if (hunterDomain && nameForHunter && Object.keys(emailSourceMap).length === 0) {
        const hunterEmailFinderResult = await hunterEmailFinder(nameForHunter, hunterDomain);
        for (const e of hunterEmailFinderResult.emails) {
          if (!emailSourceMap[e]) emailSourceMap[e] = "hunter_finder";
        }
        if (hunterEmailFinderResult.emails.length > 0) sourcesUsed.push("hunter_finder");
      }

      // Step 5.5: Findymail email search (name + domain)
      if (hunterDomain && nameForHunter && Object.keys(emailSourceMap).length === 0) {
        const findymailResult = await findymailEmailSearch(nameForHunter, hunterDomain);
        for (const e of findymailResult.emails) {
          if (!emailSourceMap[e]) emailSourceMap[e] = "findymail";
        }
        if (findymailResult.emails.length > 0) sourcesUsed.push("findymail");
      }
    }

    // Step 6: SerpAPI email fallback — runs even if no external links were found
    const nameForSerp = effectiveName || profile.handle;
    if (Object.keys(emailSourceMap).length === 0 && nameForSerp) {
      const serpResult = await serpApiEmailFallback(nameForSerp, profile.handle);
      for (const e of serpResult.emails) {
        if (!emailSourceMap[e]) emailSourceMap[e] = "serpapi";
      }
      if (serpResult.emails.length > 0) sourcesUsed.push("serpapi");
    }

    const allEmails = Object.keys(emailSourceMap);
    const primaryEmail = allEmails.length > 0 ? allEmails[0] : null;
    const primaryWebsite = scraped.external_links.find(link => !isLinkAggregator(link)) || null;

    console.log(`[SOCIAL-PROVIDERS] Enrichment complete for ${profile.handle}: name="${effectiveName}", ${allEmails.length} emails from [${sourcesUsed.join(", ")}]`);

    return {
      profile_url: profile.profile_url,
      handle: profile.handle,
      display_name: effectiveName,
      followers_text: effectiveFollowersText,
      followers_int: effectiveFollowersInt,
      bio: scraped.bio,
      external_links: scraped.external_links,
      emails: allEmails,
      email_primary: primaryEmail,
      email_sources: emailSourceMap,
      enrichment_sources: sourcesUsed,
      website_primary: primaryWebsite,
      engagement_rate: scraped.engagement?.rate,
      avg_likes: scraped.engagement?.avg_likes,
      avg_comments: scraped.engagement?.avg_comments,
      posts_analyzed: scraped.engagement?.posts_analyzed,
    };
  } catch (err: any) {
    console.error(`[SOCIAL-PROVIDERS] Enrichment error for ${profile.profile_url}: ${err.message}`);
    throw err;
  }
}

/**
 * Strict creator name sanitizer applied to ALL display names (scraped and discovery).
 * Strips platform boilerplate, handles, descriptive suffixes, and sentence fragments
 * to produce a clean, professional display name.
 *
 * Examples of what it cleans:
 *   "Sales (@Sales) / Posts"                → "Sales"
 *   "The Art Of Sales (@SalesIsArt)"        → "The Art Of Sales"
 *   "BowTiedSystems | Sales + AI ..."       → "BowTiedSystems"
 *   "AJ Sales Coach (@SalesCoachAJ) / X"    → "AJ Sales Coach"
 *   "Name - TikTok"                         → "Name"
 *   "Name · Instagram photos and videos"    → "Name"
 */
export function cleanCreatorName(name: string, handle?: string): string {
  if (!name) return "";
  let c = name.trim();

  // ── Step 1: Strip platform suffixes (greedy, order matters) ──
  c = c
    // X/Twitter patterns
    .replace(/\s*[/|·•]\s*Posts?\s*$/i, "")
    .replace(/\s*[/|·•]\s*X\s*$/i, "")
    .replace(/\s*[/|·•-]\s*Twitter\s*$/i, "")
    .replace(/\s+on\s+X\s*$/i, "")
    .replace(/\s+on\s+Twitter\s*$/i, "")
    // TikTok patterns
    .replace(/\s*[|/·•-]\s*TikTok\s*$/i, "")
    // Instagram patterns
    .replace(/\s*[*·•|/]\s*Instagram\s+photos?\s+and\s+videos?\s*$/i, "")
    .replace(/\s*[|/·•-]\s*Instagram\s*$/i, "")
    // YouTube patterns
    .replace(/\s*[|/·•-]\s*YouTube\s*$/i, "")
    // Generic trailing "| <anything>" — only strip if suffix contains platform keywords
    .replace(/\s*[|/]\s*[^|/]{1,30}\s*$/, (match) => {
      const suffix = match.replace(/^\s*[|/]\s*/, "").trim().toLowerCase();
      const platformWords = ["posts", "x", "twitter", "tiktok", "instagram", "youtube", "reels", "shorts", "videos", "photos", "official", "profile", "creator", "content"];
      if (platformWords.some(w => suffix.includes(w))) return "";
      return match;
    });

  // ── Step 2: Remove (@handle) anywhere in the string ──
  c = c.replace(/\s*\(@[^)]+\)/g, "").trim();

  // ── Step 3: Remove trailing @handle (no parens) ──
  c = c.replace(/\s+@\w+\s*$/, "").trim();

  // ── Step 4: Remove trailing ellipsis artifacts ──
  c = c.replace(/\s*\.{2,}\s*$/, "").trim();
  c = c.replace(/\s*…\s*$/, "").trim();

  // ── Step 5: Strip leading/trailing quotes, dashes ──
  c = c.replace(/^["']+|["']+$/g, "").trim();
  c = c.replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, "").trim();

  // ── Step 6: Collapse multiple spaces ──
  c = c.replace(/\s{2,}/g, " ").trim();

  // ── Step 7: Cap at 60 chars (professional display name limit) ──
  if (c.length > 60) {
    const truncated = c.substring(0, 60);
    const lastSpace = truncated.lastIndexOf(" ");
    c = lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated;
  }

  return c || "";
}

/** @deprecated Use cleanCreatorName instead */
export function cleanDiscoveryTitle(platform: string, title: string): string {
  return cleanCreatorName(title);
}

async function scrapeProfilePage(platform: SocialPlatform, url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  let html = "";
  const decoder = new TextDecoder();
  let bytesRead = 0;
  const MAX_BYTES = 300_000; // Increased for X - pages can be large

  while (bytesRead < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    bytesRead += value.byteLength;
  }
  reader.cancel().catch(() => {});

  // Extract JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
  const jsonLd = jsonLdMatch ? JSON.parse(jsonLdMatch[1]) : null;

  // Extract meta tags
  const metaTags: Record<string, string> = {};
  const metaRegex = /<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g;
  let metaMatch;
  while ((metaMatch = metaRegex.exec(html)) !== null) {
    metaTags[metaMatch[1]] = metaMatch[2];
  }

  // ═══ Layer 2: Extract embedded JavaScript data (for X, TikTok, Instagram) ═══
  const embeddedData: any = {};
  
  if (platform === "x") {
    // Try to extract user data from inline JSON patterns — search individual fields
    // These patterns look for JSON keys in X's server-rendered HTML/JS bundles
    const screenNameMatch = html.match(/"screen_name"\s*:\s*"([^"]+)"/);
    const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
    const followersCountMatch = html.match(/"followers_count"\s*:\s*(\d+)/);
    const descriptionMatch = html.match(/"description"\s*:\s*"([^"]*)"/);
    
    if (screenNameMatch || nameMatch) {
      embeddedData.userData = {
        screen_name: screenNameMatch ? screenNameMatch[1] : "",
        name: nameMatch ? nameMatch[1] : "",
        followers_count: followersCountMatch ? parseInt(followersCountMatch[1]) : 0,
        description: descriptionMatch ? descriptionMatch[1] : "",
      };
    }
  } else if (platform === "tiktok") {
    // TikTok: Extract from __UNIVERSAL_DATA_FOR_REHYDRATION__ or SIGI_STATE
    const universalMatch = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(\{.+?\})<\/script>/s);
    if (universalMatch) {
      try {
        const universalData = JSON.parse(universalMatch[1]);
        const defaultScope = universalData?.["__DEFAULT_SCOPE__"];
        const userDetail = defaultScope?.["webapp.user-detail"] || {};
        const userInfo = userDetail?.userInfo?.user || {};
        const userStats = userDetail?.userInfo?.stats || {};
        
        if (userInfo.uniqueId || userInfo.nickname) {
          embeddedData.tiktokUser = {
            uniqueId: userInfo.uniqueId || "",
            nickname: userInfo.nickname || "",
            signature: userInfo.signature || "",
            followerCount: userStats.followerCount || 0,
            bioLink: userInfo.bioLink?.link || "",
          };
          console.log(`[SOCIAL-PROVIDERS] TikTok __UNIVERSAL_DATA__: nickname="${userInfo.nickname}", followers=${userStats.followerCount}`);
        }
        // Extract video items for engagement calculation
        const itemList = defaultScope?.["webapp.user-detail"]?.itemList || [];
        if (Array.isArray(itemList) && itemList.length > 0) {
          embeddedData.tiktokVideoItems = itemList;
          console.log(`[SOCIAL-PROVIDERS] TikTok __UNIVERSAL_DATA__: found ${itemList.length} video items for engagement`);
        }
      } catch (e) {
        console.warn(`[SOCIAL-PROVIDERS] TikTok __UNIVERSAL_DATA__ parse error: ${(e as Error).message}`);
      }
    }

    // Fallback: try SIGI_STATE (older TikTok pages)
    if (!embeddedData.tiktokUser) {
      const sigiMatch = html.match(/<script\s+id="SIGI_STATE"[^>]*>(\{.+?\})<\/script>/s);
      if (sigiMatch) {
        try {
          const sigiData = JSON.parse(sigiMatch[1]);
          const userModule = sigiData?.UserModule?.users || {};
          const statsModule = sigiData?.UserModule?.stats || {};
          const firstUserKey = Object.keys(userModule)[0];
          if (firstUserKey) {
            const user = userModule[firstUserKey];
            const stats = statsModule[firstUserKey] || {};
            embeddedData.tiktokUser = {
              uniqueId: user.uniqueId || firstUserKey,
              nickname: user.nickname || "",
              signature: user.signature || "",
              followerCount: stats.followerCount || 0,
              bioLink: user.bioLink?.link || "",
            };
            console.log(`[SOCIAL-PROVIDERS] TikTok SIGI_STATE: nickname="${user.nickname}", followers=${stats.followerCount}`);
          }
          // Extract SIGI_STATE video items for engagement
          if (!embeddedData.tiktokVideoItems) {
            const itemModule = sigiData?.ItemModule || {};
            const items = Object.values(itemModule);
            if (items.length > 0) {
              embeddedData.tiktokVideoItems = items;
              console.log(`[SOCIAL-PROVIDERS] TikTok SIGI_STATE: found ${items.length} video items for engagement`);
            }
          }
        } catch (e) {
          console.warn(`[SOCIAL-PROVIDERS] TikTok SIGI_STATE parse error: ${(e as Error).message}`);
        }
      }
    }

    // Fallback: try individual JSON field patterns
    if (!embeddedData.tiktokUser) {
      const nicknameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
      const signatureMatch = html.match(/"signature"\s*:\s*"([^"]+)"/);
      const followerCountMatch = html.match(/"followerCount"\s*:\s*(\d+)/);
      const bioLinkMatch = html.match(/"bioLink"\s*:\s*\{[^}]*"link"\s*:\s*"([^"]+)"/);
      
      if (nicknameMatch) {
        embeddedData.tiktokUser = {
          uniqueId: "",
          nickname: nicknameMatch[1],
          signature: signatureMatch ? signatureMatch[1] : "",
          followerCount: followerCountMatch ? parseInt(followerCountMatch[1]) : 0,
          bioLink: bioLinkMatch ? bioLinkMatch[1] : "",
        };
        console.log(`[SOCIAL-PROVIDERS] TikTok regex fallback: nickname="${nicknameMatch[1]}"`);
      }
    }
  }

  // Platform-specific extraction with all layers
  const extracted = extractPlatformData(platform, html, jsonLd, metaTags, embeddedData);
  
  console.log(`[SOCIAL-PROVIDERS] Scraped ${platform}: name="${extracted.displayName}", followers="${extracted.followersText}", bio_length=${extracted.bio.length}, links=${extracted.externalLinks.length}`);

  return {
    display_name: extracted.displayName || "",
    followers_text: extracted.followersText || "0",
    followers_int: extracted.followersInt || 0,
    bio: extracted.bio || "",
    external_links: extracted.externalLinks || [],
    engagement: extracted.engagement,
  };
}

function extractPlatformData(platform: SocialPlatform, html: string, jsonLd: any, metaTags: Record<string, string>, embeddedData?: any) {
  let displayName = "";
  let bio = "";
  
  // Extract links
  const linkRegex = /href="(https?:\/\/[^"]+)"/g;
  const links: string[] = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const link = linkMatch[1];
    try {
      const u = new URL(link);
      const domain = u.hostname.replace(/^www\./, "");
      const platformDomains: Record<string, string[]> = {
        instagram: ["instagram.com"],
        tiktok: ["tiktok.com"],
        x: ["x.com", "twitter.com", "t.co", "twimg.com"],
      };
      const skipForPlatform = platformDomains[platform] || [];
      if (!SKIP_WEBSITE_DOMAINS.has(domain) && !skipForPlatform.some(d => domain === d || domain.endsWith("." + d))) {
        links.push(link);
      }
    } catch {}
  }

  // Extract followers
  let followersText = "0";
  let followersInt = 0;

  if (platform === "instagram") {
    const followerMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
    if (followerMatch) {
      followersInt = parseInt(followerMatch[1]);
      followersText = formatFollowers(followersInt);
    }
  } else if (platform === "tiktok") {
    const followerMatch = html.match(/"followerCount":(\d+)/);
    if (followerMatch) {
      followersInt = parseInt(followerMatch[1]);
      followersText = formatFollowers(followersInt);
    }
  } else if (platform === "x") {
    const followerMatch = html.match(/"followers_count":(\d+)/);
    if (followerMatch) {
      followersInt = parseInt(followerMatch[1]);
      followersText = formatFollowers(followersInt);
    }
  }

  // ═══ ENHANCED DISPLAY NAME AND BIO EXTRACTION ═══
  if (platform === "x") {
    // X/Twitter: Try embedded data first
    if (embeddedData?.userData) {
      displayName = embeddedData.userData.name;
      bio = embeddedData.userData.description;
      if (!followersInt && embeddedData.userData.followers_count) {
        followersInt = embeddedData.userData.followers_count;
        followersText = formatFollowers(followersInt);
      }
    }
    
    // Fallback to meta tags
    if (!displayName) {
      displayName = metaTags["og:title"] || metaTags["twitter:title"] || "";
      // Remove " (@username)" suffix from X/Twitter og:title format
      displayName = displayName.replace(/\s+\(@[^)]+\)\s*$/, "").trim();
    }
    
    // Try regex if still empty
    if (!displayName) {
      const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) displayName = nameMatch[1];
    }
    
    // Bio extraction
    if (!bio) {
      bio = metaTags["og:description"] || metaTags["twitter:description"] || metaTags["description"] || "";
    }
    if (!bio) {
      const descMatch = html.match(/"description"\s*:\s*"([^"]+)"/);
      if (descMatch) bio = descMatch[1];
    }

    // X followers fallback: extract from og:description or bio text
    // X meta descriptions often contain "123 Followers" or "1.2M Followers"
    if (!followersInt) {
      const descText = metaTags["og:description"] || metaTags["twitter:description"] || bio || "";
      const followerTextMatch = descText.match(/([\d,.]+[KkMmBb]?)\s+[Ff]ollowers/);
      if (followerTextMatch) {
        const rawCount = followerTextMatch[1].replace(/,/g, "");
        const parsed = parseFollowerShorthand(rawCount);
        if (parsed > 0) {
          followersInt = parsed;
          followersText = formatFollowers(followersInt);
          console.log(`[SOCIAL-PROVIDERS] X followers from meta: ${followersText}`);
        }
      }
    }
  } else if (platform === "tiktok") {
    // TikTok: Try embedded data first (SIGI_STATE / __UNIVERSAL_DATA__)
    if (embeddedData?.tiktokUser) {
      displayName = embeddedData.tiktokUser.nickname || "";
      bio = embeddedData.tiktokUser.signature || "";
      if (embeddedData.tiktokUser.followerCount && !followersInt) {
        followersInt = embeddedData.tiktokUser.followerCount;
        followersText = formatFollowers(followersInt);
      }
      // Add bio link to external links if present
      if (embeddedData.tiktokUser.bioLink) {
        try {
          const bioLinkUrl = new URL(embeddedData.tiktokUser.bioLink);
          const bioLinkDomain = bioLinkUrl.hostname.replace(/^www\./, "");
          if (!SKIP_WEBSITE_DOMAINS.has(bioLinkDomain)) {
            links.push(embeddedData.tiktokUser.bioLink);
          }
        } catch {}
      }
    }

    // Fallback to meta tags
    if (!displayName) {
      const ogTitle = metaTags["og:title"] || metaTags["twitter:title"] || jsonLd?.name || "";
      // TikTok og:title format: "Name (@handle) | TikTok"
      displayName = ogTitle
        .replace(/\s*\|\s*TikTok\s*$/i, "")
        .replace(/\s*\(@[^)]+\)\s*$/, "")
        .trim();
    }
    if (!bio) {
      bio = metaTags["og:description"] || metaTags["description"] || jsonLd?.description || "";
    }

    // Regex fallback for nickname
    if (!displayName) {
      const nicknameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
      if (nicknameMatch) displayName = nicknameMatch[1];
    }
  } else {
    // Other platforms (Instagram): use meta tags
    if (!displayName) {
      displayName = metaTags["og:title"] || metaTags["twitter:title"] || jsonLd?.name || "";
    }
    if (!bio) {
      bio = metaTags["og:description"] || metaTags["description"] || jsonLd?.description || "";
    }
  }

  // ═══ ENGAGEMENT RATE ENGINE ═══
  // Extract recent post metrics from embedded data and calculate engagement rate
  // Formula: engagement_rate = ((avg_likes + avg_comments) / followers) * 100
  const engagement = extractEngagementMetrics(platform, html, followersInt, embeddedData);

  return {
    displayName: displayName.trim(),
    bio: bio.trim(),
    followersText,
    followersInt,
    externalLinks: [...new Set(links)].slice(0, 10),
    engagement,
  };
}

/**
 * Extract recent post metrics from profile HTML and calculate engagement rate.
 * 
 * Strategy per platform:
 * - TikTok: diggCount/commentCount from __UNIVERSAL_DATA__ or SIGI_STATE ItemModule
 * - Instagram: edge_liked_by/edge_media_to_comment from edge_owner_to_timeline_media
 * - X/Twitter: favorite_count/retweet_count from embedded tweet objects
 */
function extractEngagementMetrics(
  platform: SocialPlatform,
  html: string,
  followersInt: number,
  embeddedData?: any
): { rate: number; avg_likes: number; avg_comments: number; posts_analyzed: number } | undefined {
  if (!followersInt || followersInt <= 0) return undefined;

  const postMetrics: { likes: number; comments: number }[] = [];

  try {
    if (platform === "tiktok") {
      // TikTok: Extract from __UNIVERSAL_DATA__ ItemModule or SIGI_STATE ItemModule
      // Try regex approach to find multiple diggCount/commentCount pairs
      const diggMatches = [...html.matchAll(/"diggCount"\s*:\s*(\d+)/g)];
      const commentMatches = [...html.matchAll(/"commentCount"\s*:\s*(\d+)/g)];
      
      // Pair them up (they appear in order per video item)
      const count = Math.min(diggMatches.length, commentMatches.length, 10);
      for (let i = 0; i < count; i++) {
        const likes = parseInt(diggMatches[i][1]);
        const comments = parseInt(commentMatches[i][1]);
        // Filter out anomalies (0 likes on very old or private videos)
        if (likes > 0 || comments > 0) {
          postMetrics.push({ likes, comments });
        }
      }
      // If no video items found, try embeddedData.tiktokVideoItems
      if (postMetrics.length === 0 && embeddedData?.tiktokVideoItems) {
        for (const item of embeddedData.tiktokVideoItems) {
          const likes = item.diggCount || 0;
          const comments = item.commentCount || 0;
          if (likes > 0 || comments > 0) {
            postMetrics.push({ likes, comments });
          }
        }
      }
    } else if (platform === "instagram") {
      // Instagram: Extract from edge_owner_to_timeline_media edges
      // Pattern: "edge_liked_by":{"count":NNN} and "edge_media_to_comment":{"count":NNN}
      const likeMatches = [...html.matchAll(/"edge_liked_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)\s*\}/g)];
      const commentMatches = [...html.matchAll(/"edge_media_to_comment"\s*:\s*\{\s*"count"\s*:\s*(\d+)\s*\}/g)];
      
      // Also try newer format: "edge_media_preview_like":{"count":NNN}
      const previewLikeMatches = [...html.matchAll(/"edge_media_preview_like"\s*:\s*\{\s*"count"\s*:\s*(\d+)\s*\}/g)];
      const effectiveLikes = likeMatches.length > 0 ? likeMatches : previewLikeMatches;
      
      const count = Math.min(effectiveLikes.length, commentMatches.length, 12);
      for (let i = 0; i < count; i++) {
        postMetrics.push({
          likes: parseInt(effectiveLikes[i][1]),
          comments: parseInt(commentMatches[i][1]),
        });
      }
    } else if (platform === "x") {
      // X/Twitter: Extract favorite_count and reply_count from tweet objects
      const favoriteMatches = [...html.matchAll(/"favorite_count"\s*:\s*(\d+)/g)];
      const replyMatches = [...html.matchAll(/"reply_count"\s*:\s*(\d+)/g)];
      // Also try retweet_count as secondary signal
      const retweetMatches = [...html.matchAll(/"retweet_count"\s*:\s*(\d+)/g)];
      
      const count = Math.min(favoriteMatches.length, 10);
      for (let i = 0; i < count; i++) {
        const likes = parseInt(favoriteMatches[i][1]);
        const comments = replyMatches[i] ? parseInt(replyMatches[i][1]) : 0;
        if (likes > 0 || comments > 0) {
          postMetrics.push({ likes, comments });
        }
      }
    }
  } catch (err) {
    console.warn(`[SOCIAL-PROVIDERS] Engagement extraction error for ${platform}: ${(err as Error).message}`);
  }

  if (postMetrics.length === 0) return undefined;

  // Take last N posts (cap at 10 for stable average)
  const recent = postMetrics.slice(0, 10);
  const totalLikes = recent.reduce((s, p) => s + p.likes, 0);
  const totalComments = recent.reduce((s, p) => s + p.comments, 0);
  const avgLikes = Math.round(totalLikes / recent.length);
  const avgComments = Math.round(totalComments / recent.length);
  const rate = parseFloat((((avgLikes + avgComments) / followersInt) * 100).toFixed(2));

  console.log(`[SOCIAL-PROVIDERS] Engagement for ${platform}: ${rate}% (avg ${avgLikes} likes, ${avgComments} comments across ${recent.length} posts, ${followersInt} followers)`);

  return {
    rate,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    posts_analyzed: recent.length,
  };
}

function formatFollowers(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

function parseFollowerShorthand(raw: string): number {
  const match = raw.match(/^([\d.]+)([KkMmBb]?)$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();
  switch (suffix) {
    case "k": return num * 1_000;
    case "m": return num * 1_000_000;
    case "b": return num * 1_000_000_000;
    default: return num;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EMAIL ENRICHMENT HELPERS
// ══════════════════════════════════════════════════════════════════════════

export async function scrapeLinkedWebsitesForEmails(links: string[]): Promise<{ emails: string[]; domains_scraped: string[] }> {
  const empty = { emails: [], domains_scraped: [] };
  if (!links || links.length === 0) return empty;

  const scrapeable = links.filter(link => {
    try {
      const u = new URL(link);
      const host = u.hostname.replace(/^www\./, "");
      return !SKIP_WEBSITE_DOMAINS.has(host) && !isLinkAggregator(link);
    } catch { return false; }
  }).slice(0, 1);

  if (scrapeable.length === 0) return empty;

  const allEmails: string[] = [];
  const domainsDone: string[] = [];

  for (const siteUrl of scrapeable) {
    try {
      const u = new URL(siteUrl);
      const domain = u.hostname.replace(/^www\./, "");
      domainsDone.push(domain);

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
          const MAX_BYTES = 80_000;

          while (bytesRead < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            bytesRead += value.byteLength;
          }
          reader.cancel().catch(() => {});

          const emails = extractEmails(text);
          allEmails.push(...emails);
          if (allEmails.length >= 2) break;
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[SOCIAL-PROVIDERS] Website scrape error for ${siteUrl}: ${err.message}`);
    }
  }

  const uniqueEmails = [...new Set(allEmails)];
  if (uniqueEmails.length > 0) {
    console.log(`[SOCIAL-PROVIDERS] Website scrape: found ${uniqueEmails.length} emails from ${domainsDone.join(", ")}`);
  }

  return { emails: uniqueEmails, domains_scraped: domainsDone };
}

export async function hunterDomainSearch(domain: string): Promise<{ emails: string[]; source: string }> {
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
        console.warn(`[SOCIAL-PROVIDERS] Hunter.io rate limit hit for domain ${domain}`);
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
      console.log(`[SOCIAL-PROVIDERS] Hunter.io domain search found ${hunterEmails.length} emails for ${domain}`);
    }

    return { emails: hunterEmails, source: "hunter" };
  } catch (err: any) {
    console.warn(`[SOCIAL-PROVIDERS] Hunter.io domain search error for ${domain}: ${err.message}`);
    return empty;
  }
}

export async function hunterEmailFinder(fullName: string, domain: string): Promise<{ emails: string[]; source: string }> {
  const empty = { emails: [], source: "hunter_finder" };
  const apiKey = HUNTER_API_KEY();
  if (!apiKey) return empty;

  if (FREE_EMAIL_DOMAINS.has(domain) || SKIP_WEBSITE_DOMAINS.has(domain)) return empty;

  try {
    const params = new URLSearchParams({
      domain,
      full_name: fullName,
      api_key: apiKey,
    });

    const res = await fetch(`https://api.hunter.io/v2/email-finder?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`[SOCIAL-PROVIDERS] Hunter.io rate limit hit for ${fullName}@${domain}`);
      }
      return empty;
    }

    const data = await res.json();
    const email = data?.data?.email?.toLowerCase();

    if (email && !EMAIL_BLOCKLIST.has(email)) {
      console.log(`[SOCIAL-PROVIDERS] Hunter.io email finder found: ${email}`);
      return { emails: [email], source: "hunter_finder" };
    }

    return empty;
  } catch (err: any) {
    console.warn(`[SOCIAL-PROVIDERS] Hunter.io email finder error for ${fullName}@${domain}: ${err.message}`);
    return empty;
  }
}

export async function findymailEmailSearch(fullName: string, domain: string): Promise<{ emails: string[]; source: string }> {
  const empty = { emails: [], source: "findymail" };
  const apiKey = FINDYMAIL_API_KEY();
  if (!apiKey) return empty;

  if (FREE_EMAIL_DOMAINS.has(domain) || SKIP_WEBSITE_DOMAINS.has(domain)) return empty;

  // Parse full name into first and last
  const nameParts = fullName.trim().split(/\s+/);
  if (nameParts.length < 1) return empty;

  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  try {
    const res = await fetch("https://app.findymail.com/api/search/name", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        domain: domain,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (res.status === 402 || res.status === 429) {
        console.warn(`[SOCIAL-PROVIDERS] Findymail limit/quota hit (${res.status}) for ${fullName}@${domain}`);
      }
      return empty;
    }

    const data = await res.json();
    const email = data?.email?.toLowerCase();

    if (email && !EMAIL_BLOCKLIST.has(email)) {
      console.log(`[SOCIAL-PROVIDERS] Findymail found: ${email}`);
      return { emails: [email], source: "findymail" };
    }

    return empty;
  } catch (err: any) {
    console.warn(`[SOCIAL-PROVIDERS] Findymail error for ${fullName}@${domain}: ${err.message}`);
    return empty;
  }
}

export async function serpApiEmailFallback(displayName: string, handle: string): Promise<{ emails: string[]; source: string }> {
  const empty = { emails: [], source: "serpapi" };
  const apiKey = SERPAPI_API_KEY();
  if (!apiKey) return empty;

  try {
    const queries = [
      `"${displayName}" email contact`,
      `"${handle}" email`,
      `${displayName} ${handle} contact email`,
    ];

    for (const query of queries) {
      const params = new URLSearchParams({
        engine: "google",
        q: query,
        api_key: apiKey,
        num: "5",
      });

      const res = await serpFetch(`https://serpapi.com/search?${params.toString()}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const snippets = (data.organic_results || [])
        .map((r: any) => r.snippet || "")
        .join(" ");

      const emails = extractEmails(snippets);
      if (emails.length > 0) {
        console.log(`[SOCIAL-PROVIDERS] SerpAPI fallback found ${emails.length} emails for "${displayName}"`);
        return { emails, source: "serpapi" };
      }
    }

    return empty;
  } catch (err: any) {
    console.warn(`[SOCIAL-PROVIDERS] SerpAPI fallback error for ${displayName}: ${err.message}`);
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
      if (isLinkAggregator(link)) continue;
      if (domain.includes(".") && domain.length > 3) {
        return domain;
      }
    } catch {}
  }
  return null;
}

function isLinkAggregator(url: string): boolean {
  const aggregators = [
    "linktr.ee", "linkin.bio", "beacons.ai", "stan.store", 
    "bio.link", "campsite.bio", "carrd.co", "allmylinks.com"
  ];
  return aggregators.some(agg => url.includes(agg));
}
