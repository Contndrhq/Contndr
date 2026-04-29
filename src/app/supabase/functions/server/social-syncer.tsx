/**
 * Social Post Syncer — Provider-based architecture for social media publishing.
 * Phase 1: LinkedIn (OpenID Connect + Share on LinkedIn)
 * Phase 2: Meta (Facebook Pages + Instagram Business via Facebook Login)
 * Phase 3: Media uploads (images/videos) + scheduled post cron
 *
 * KV Keys:
 *   social_account:{userId}:{platform}:{accountId} → SocialAccount JSON
 *   social_post:{userId}:{postId}                  → SocialPost JSON
 *   social_oauth_state:{state}                      → OAuth state JSON (10min TTL)
 *   social_meta_temp:{userId}                       → Temporary Meta user token for page selection
 *   social_linkedin_temp:{userId}                    → Temporary LinkedIn token for account selection
 *   social_scheduled_index                           → JSON array of scheduled post refs
 */

import { Hono } from "npm:hono";
import * as kv from "./kv-retry.tsx";
import { createClient } from "npm:@supabase/supabase-js@2";
import { authGetUser } from "./auth-helpers.tsx";

// ─── Types ───────────────────────────────────────────────────────────

export type Platform = "linkedin" | "facebook" | "instagram";

export interface SocialAccount {
  id: string;
  userId: string;
  platform: Platform;
  platformUserId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  scopes: string[];
  connectedAt: string;
  metadata?: Record<string, any>;
}

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export interface MediaFile {
  url: string;       // signed URL for viewing
  path: string;      // storage path
  mimeType: string;  // image/jpeg, video/mp4, etc.
  fileName: string;
  size: number;
}

export interface EngagementMetrics {
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

export interface SocialPost {
  id: string;
  userId: string;
  content: string;
  platforms: Platform[];
  status: PostStatus;
  scheduledAt?: string; // ISO
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Attached media files */
  mediaFiles?: MediaFile[];
  /** Per-platform publish results */
  results: Record<Platform, {
    status: PostStatus;
    postUrl?: string;
    platformPostId?: string;
    error?: string;
    publishedAt?: string;
    engagement?: EngagementMetrics;
  }>;
  metadata?: Record<string, any>;
}

// ─── Supabase Admin Singleton ────────────────────────────────────────

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

// ─── Auth Helper ─────────────────────────────────────────────────────

async function requireUser(c: any): Promise<{ id: string; email?: string }> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) throw Object.assign(new Error("No Authorization header"), { status: 401 });
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token === "undefined" || token === "null") {
    throw Object.assign(new Error("Invalid token"), { status: 401 });
  }
  const supabase = getSupabase();
  const { user, error } = await authGetUser(supabase, token, "SOCIAL-SYNCER");
  if (error || !user) throw Object.assign(new Error(error || "Auth failed"), { status: 401 });
  return { id: user.id, email: user.email };
}

// ─── KV Helpers ──────────────────────────────────────────────────────

function accountKey(userId: string, platform: Platform, accountId: string) {
  return `social_account:${userId}:${platform}:${accountId}`;
}
function postKey(userId: string, postId: string) {
  return `social_post:${userId}:${postId}`;
}

async function getUserAccounts(userId: string): Promise<SocialAccount[]> {
  const raw = await kv.getByPrefix(`social_account:${userId}:`);
  return (raw || []).map((r: string) => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean);
}

async function getUserPosts(userId: string): Promise<SocialPost[]> {
  const raw = await kv.getByPrefix(`social_post:${userId}:`);
  return (raw || []).map((r: string) => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean).sort((a: SocialPost, b: SocialPost) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

// ─── Provider Adapters ───────────────────────────────────────────────

interface ProviderAdapter {
  platform: Platform;
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scopes: string[] }>;
  getUserInfo(accessToken: string): Promise<{ platformUserId: string; displayName: string; email?: string; avatarUrl?: string }>;
  publishPost(accessToken: string, platformUserId: string, content: string, mediaFiles?: MediaFile[]): Promise<{ platformPostId: string; postUrl: string }>;
  refreshAccessToken?(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  getEngagement?(accessToken: string, platformPostId: string, platformUserId: string): Promise<EngagementMetrics>;
}

// ─── LinkedIn Adapter ────────────────────────────────────────────────

function getBaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? "";
}

function linkedinCallbackUrl(): string {
  return `${getBaseUrl()}/functions/v1/make-server-a8b2511f/social/auth/linkedin/callback`;
}

function metaCallbackUrl(): string {
  return `${getBaseUrl()}/functions/v1/make-server-a8b2511f/social/auth/meta/callback`;
}

const linkedinAdapter: ProviderAdapter = {
  platform: "linkedin",

  getAuthUrl(state: string): string {
    const clientId = Deno.env.get("LINKEDIN_CLIENT_ID") ?? "";
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: linkedinCallbackUrl(),
      state,
      scope: "openid profile email w_member_social",
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  },

  async exchangeCode(code: string) {
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: Deno.env.get("LINKEDIN_CLIENT_ID") ?? "",
        client_secret: Deno.env.get("LINKEDIN_CLIENT_SECRET") ?? "",
        redirect_uri: linkedinCallbackUrl(),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LinkedIn token exchange failed: ${err}`);
    }
    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 5184000, // LinkedIn tokens last 60 days
      scopes: (data.scope || "openid profile email w_member_social").split(" "),
    };
  },

  async getUserInfo(accessToken: string) {
    // OpenID Connect userinfo endpoint
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LinkedIn userinfo failed: ${err}`);
    }
    const data = await res.json();
    return {
      platformUserId: data.sub,
      displayName: data.name || `${data.given_name || ""} ${data.family_name || ""}`.trim(),
      email: data.email,
      avatarUrl: data.picture,
    };
  },

  async publishPost(accessToken: string, platformUserId: string, content: string, mediaFiles?: MediaFile[]) {
    const hasMedia = mediaFiles && mediaFiles.length > 0;
    const images = mediaFiles?.filter(m => m.mimeType.startsWith("image/")) || [];
    const videos = mediaFiles?.filter(m => m.mimeType.startsWith("video/")) || [];

    // Support both personal (urn:li:person:) and org (urn:li:organization:) accounts
    // The publish endpoints pass a pre-built URN for org accounts via metadata
    const authorUrn = platformUserId.startsWith("urn:li:") ? platformUserId : `urn:li:person:${platformUserId}`;

    if (!hasMedia) {
      // Text-only LinkedIn post (existing logic)
      const body = {
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: content },
            shareMediaCategory: "NONE",
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      };

      const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LinkedIn publish failed (${res.status}): ${err}`);
      }

      const result = await res.json();
      const postId = result.id || "";
      const activityId = postId.replace("urn:li:ugcPost:", "urn:li:activity:");
      return { platformPostId: postId, postUrl: `https://www.linkedin.com/feed/update/${activityId}` };
    }

    // ── LinkedIn media upload flow ──
    // Upload each image to LinkedIn, then create a post referencing them
    const uploadedAssets: string[] = [];
    for (const media of (videos.length > 0 ? [videos[0]] : images.slice(0, 9))) {
      const isVideo = media.mimeType.startsWith("video/");
      // Step 1: Register upload
      const registerBody = {
        registerUploadRequest: {
          recipes: [isVideo ? "urn:li:digitalmediaRecipe:feedshare-video" : "urn:li:digitalmediaRecipe:feedshare-image"],
          owner: authorUrn,
          serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
        },
      };
      const regRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(registerBody),
      });
      if (!regRes.ok) {
        const err = await regRes.text();
        throw new Error(`LinkedIn register upload failed: ${err}`);
      }
      const regData = await regRes.json();
      const uploadUrl = regData.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
      const asset = regData.value?.asset;
      if (!uploadUrl || !asset) throw new Error("LinkedIn upload registration returned incomplete data");

      // Step 2: Fetch the binary from our storage and upload to LinkedIn
      // Generate a fresh signed URL for this specific download
      const supabase = getSupabase();
      const { data: signedData } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(media.path, 300);
      const downloadUrl = signedData?.signedUrl || media.url;
      const mediaRes = await fetch(downloadUrl);
      if (!mediaRes.ok) throw new Error(`Failed to download media from storage: ${media.fileName}`);
      const mediaBlob = await mediaRes.blob();

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": media.mimeType },
        body: mediaBlob,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`LinkedIn media upload failed: ${err}`);
      }
      uploadedAssets.push(asset);
    }

    // Step 3: Create post with media
    const mediaCategory = videos.length > 0 ? "VIDEO" : "IMAGE";
    const mediaEntries = uploadedAssets.map(asset => ({
      status: "READY",
      media: asset,
    }));

    const body = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content },
          shareMediaCategory: mediaCategory,
          media: mediaEntries,
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LinkedIn publish with media failed (${res.status}): ${err}`);
    }

    const result = await res.json();
    const postId = result.id || "";
    const activityId = postId.replace("urn:li:ugcPost:", "urn:li:activity:");
    return { platformPostId: postId, postUrl: `https://www.linkedin.com/feed/update/${activityId}` };
  },

  async refreshAccessToken(refreshToken: string) {
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: Deno.env.get("LINKEDIN_CLIENT_ID") ?? "",
        client_secret: Deno.env.get("LINKEDIN_CLIENT_SECRET") ?? "",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LinkedIn token refresh failed: ${err}`);
    }
    const data = await res.json();
    return { accessToken: data.access_token, expiresIn: data.expires_in || 5184000 };
  },

  async getEngagement(accessToken: string, platformPostId: string, _platformUserId: string): Promise<EngagementMetrics> {
    const now = new Date().toISOString();
    const metrics: EngagementMetrics = { lastSyncedAt: now };
    const encodedUrn = encodeURIComponent(platformPostId);
    console.log(`[SOCIAL-ENGAGE] LinkedIn getEngagement called for URN: ${platformPostId} (encoded: ${encodedUrn})`);

    const versionedHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": "202506",
      "X-Restli-Protocol-Version": "2.0.0",
    };

    // Also try with the activity URN — LinkedIn often needs urn:li:activity:
    // instead of urn:li:ugcPost: for socialActions
    const activityUrn = platformPostId.includes("ugcPost")
      ? platformPostId.replace("urn:li:ugcPost:", "urn:li:activity:")
      : null;
    const encodedActivityUrn = activityUrn ? encodeURIComponent(activityUrn) : null;

    try {
      let gotSocialActions = false;
      let summaryLikes = 0;
      let summaryComments = 0;

      // ── Strategy 1: REST socialActions with UGC URN ──
      const actionsRes = await fetch(
        `https://api.linkedin.com/rest/socialActions/${encodedUrn}`,
        { headers: versionedHeaders },
      );

      if (actionsRes.ok) {
        const data = await actionsRes.json();
        console.log(`[SOCIAL-ENGAGE] LinkedIn REST socialActions RAW response:`, JSON.stringify(data).slice(0, 600));
        summaryLikes = data.likesSummary?.totalLikes ?? data.likesSummary?.aggregatedTotalLikes ?? 0;
        summaryComments = data.commentsSummary?.totalFirstLevelComments ?? data.commentsSummary?.aggregatedTotalComments ?? 0;
        gotSocialActions = true;
        console.log(`[SOCIAL-ENGAGE] LinkedIn REST socialActions OK (ugcPost URN) — likes=${summaryLikes}, comments=${summaryComments}`);
      } else {
        const errBody = await actionsRes.text().catch(() => "");
        console.log(`[SOCIAL-ENGAGE] LinkedIn REST socialActions ${actionsRes.status} (ugcPost URN): ${errBody.slice(0, 300)}`);

        // ── Strategy 2: REST socialActions with activity URN ──
        if (encodedActivityUrn) {
          try {
            const activityRes = await fetch(
              `https://api.linkedin.com/rest/socialActions/${encodedActivityUrn}`,
              { headers: versionedHeaders },
            );
            if (activityRes.ok) {
              const data = await activityRes.json();
              console.log(`[SOCIAL-ENGAGE] LinkedIn REST socialActions RAW (activity URN):`, JSON.stringify(data).slice(0, 600));
              summaryLikes = data.likesSummary?.totalLikes ?? data.likesSummary?.aggregatedTotalLikes ?? 0;
              summaryComments = data.commentsSummary?.totalFirstLevelComments ?? data.commentsSummary?.aggregatedTotalComments ?? 0;
              gotSocialActions = true;
              console.log(`[SOCIAL-ENGAGE] LinkedIn REST socialActions OK (activity URN) — likes=${summaryLikes}, comments=${summaryComments}`);
            } else {
              const errBody2 = await activityRes.text().catch(() => "");
              console.log(`[SOCIAL-ENGAGE] LinkedIn REST socialActions ${activityRes.status} (activity URN): ${errBody2.slice(0, 300)}`);
            }
          } catch (e2: any) {
            console.log(`[SOCIAL-ENGAGE] LinkedIn activity URN fetch failed: ${e2.message}`);
          }
        }
      }

      // ── Always fetch sub-resource counts (reactions/likes + comments) ──
      // LinkedIn moved from "likes" to "reactions" — the summary may return 0
      // but sub-resources give accurate totals via paging.total
      let subLikes = 0;
      let subComments = 0;
      const urnsToTry = encodedActivityUrn ? [encodedUrn, encodedActivityUrn] : [encodedUrn];

      for (const urnAttempt of urnsToTry) {
        try {
          const [likesRes, commentsRes] = await Promise.allSettled([
            fetch(`https://api.linkedin.com/rest/socialActions/${urnAttempt}/likes?count=0&start=0`, {
              headers: versionedHeaders,
            }),
            fetch(`https://api.linkedin.com/rest/socialActions/${urnAttempt}/comments?count=0&start=0`, {
              headers: versionedHeaders,
            }),
          ]);

          if (likesRes.status === "fulfilled") {
            if (likesRes.value.ok) {
              const d = await likesRes.value.json();
              const total = d.paging?.total ?? d.paging?.count ?? 0;
              console.log(`[SOCIAL-ENGAGE] LinkedIn sub-resource likes (${urnAttempt.slice(0, 30)}): total=${total}, paging=${JSON.stringify(d.paging)}`);
              if (total > subLikes) subLikes = total;
            } else {
              const t = await likesRes.value.text().catch(() => "");
              console.log(`[SOCIAL-ENGAGE] LinkedIn sub-resource likes ${likesRes.value.status}: ${t.slice(0, 200)}`);
            }
          }
          if (commentsRes.status === "fulfilled") {
            if (commentsRes.value.ok) {
              const d = await commentsRes.value.json();
              const total = d.paging?.total ?? d.paging?.count ?? 0;
              console.log(`[SOCIAL-ENGAGE] LinkedIn sub-resource comments (${urnAttempt.slice(0, 30)}): total=${total}, paging=${JSON.stringify(d.paging)}`);
              if (total > subComments) subComments = total;
            } else {
              const t = await commentsRes.value.text().catch(() => "");
              console.log(`[SOCIAL-ENGAGE] LinkedIn sub-resource comments ${commentsRes.value.status}: ${t.slice(0, 200)}`);
            }
          }

          // If we got results from this URN, no need to try the other
          if (subLikes > 0 || subComments > 0) break;
        } catch (subErr: any) {
          console.log(`[SOCIAL-ENGAGE] LinkedIn sub-resource fetch failed for ${urnAttempt.slice(0, 30)}: ${subErr.message}`);
        }
      }

      // Also try v2 endpoint as additional fallback
      if (subLikes === 0 && subComments === 0 && !gotSocialActions) {
        console.log(`[SOCIAL-ENGAGE] Falling back to v2 socialActions sub-resources...`);
        const urnToTry = encodedActivityUrn || encodedUrn;
        const [likesRes, commentsRes] = await Promise.allSettled([
          fetch(`https://api.linkedin.com/v2/socialActions/${urnToTry}/likes?count=0&start=0`, {
            headers: versionedHeaders,
          }),
          fetch(`https://api.linkedin.com/v2/socialActions/${urnToTry}/comments?count=0&start=0`, {
            headers: versionedHeaders,
          }),
        ]);

        if (likesRes.status === "fulfilled" && likesRes.value.ok) {
          const d = await likesRes.value.json();
          const total = d.paging?.total ?? d.paging?.count ?? 0;
          console.log(`[SOCIAL-ENGAGE] LinkedIn v2 likes OK: ${total}`);
          if (total > subLikes) subLikes = total;
        }
        if (commentsRes.status === "fulfilled" && commentsRes.value.ok) {
          const d = await commentsRes.value.json();
          const total = d.paging?.total ?? d.paging?.count ?? 0;
          console.log(`[SOCIAL-ENGAGE] LinkedIn v2 comments OK: ${total}`);
          if (total > subComments) subComments = total;
        }
      }

      // Take the maximum between summary and sub-resource counts
      metrics.likes = Math.max(summaryLikes, subLikes);
      metrics.comments = Math.max(summaryComments, subComments);
      console.log(`[SOCIAL-ENGAGE] LinkedIn likes: summary=${summaryLikes}, sub=${subLikes}, final=${metrics.likes}`);
      console.log(`[SOCIAL-ENGAGE] LinkedIn comments: summary=${summaryComments}, sub=${subComments}, final=${metrics.comments}`);

      // ── Shares count via REST socialActions shares sub-resource ──
      try {
        const sharesUrn = encodedActivityUrn || encodedUrn;
        const sharesRes = await fetch(
          `https://api.linkedin.com/rest/socialActions/${sharesUrn}/shares?count=0&start=0`,
          { headers: versionedHeaders },
        );
        if (sharesRes.ok) {
          const sd = await sharesRes.json();
          metrics.shares = sd.paging?.total ?? 0;
        }
      } catch { /* shares sub-resource may not exist */ }

      // ── Organization share statistics for impressions/clicks (org pages only) ──
      try {
        const statsRes = await fetch(
          `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&shares[0]=${encodedUrn}`,
          { headers: versionedHeaders },
        );
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          const el = statsData.elements?.[0]?.totalShareStatistics;
          if (el) {
            metrics.impressions = el.impressionCount ?? 0;
            metrics.clicks = el.clickCount ?? 0;
            if (!metrics.shares) metrics.shares = el.shareCount ?? 0;
            console.log(`[SOCIAL-ENGAGE] LinkedIn org stats: impressions=${metrics.impressions}, clicks=${metrics.clicks}`);
          }
        }
      } catch { /* share stats may not be available for personal profiles */ }

      console.log(`[SOCIAL-ENGAGE] LinkedIn FINAL metrics for ${platformPostId}: likes=${metrics.likes}, comments=${metrics.comments}, shares=${metrics.shares}, impressions=${metrics.impressions}`);
    } catch (err: any) {
      console.log(`[SOCIAL-ENGAGE] LinkedIn engagement fetch EXCEPTION: ${err.message}`);
    }

    // Ensure all metrics default to 0 if undefined (e.g., if 403 Access Denied)
    metrics.likes = metrics.likes ?? 0;
    metrics.comments = metrics.comments ?? 0;
    metrics.shares = metrics.shares ?? 0;
    metrics.impressions = metrics.impressions ?? 0;
    metrics.reach = metrics.reach ?? 0;
    metrics.clicks = metrics.clicks ?? 0;
    return metrics;
  },
};

// Registry of all provider adapters
const adapters: Record<Platform, ProviderAdapter> = {
  linkedin: linkedinAdapter,
  facebook: {
    platform: "facebook",
    getAuthUrl(_state: string): string {
      // Facebook OAuth is handled via the shared Meta flow
      throw new Error("Use /auth/meta/connect for Facebook OAuth");
    },
    async exchangeCode(_code: string) {
      throw new Error("Use /auth/meta/callback for Facebook token exchange");
    },
    async getUserInfo(accessToken: string) {
      // Fetch page info using the page access token
      const res = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,picture.type(large)&access_token=${accessToken}`);
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Facebook page info failed: ${err}`);
      }
      const data = await res.json();
      return {
        platformUserId: data.id,
        displayName: data.name || "Facebook Page",
        avatarUrl: data.picture?.data?.url,
      };
    },
    async publishPost(accessToken: string, platformUserId: string, content: string, mediaFiles?: MediaFile[]) {
      const hasMedia = mediaFiles && mediaFiles.length > 0;
      const images = mediaFiles?.filter(m => m.mimeType.startsWith("image/")) || [];
      const videos = mediaFiles?.filter(m => m.mimeType.startsWith("video/")) || [];

      if (!hasMedia) {
        // Text-only Facebook post
        const res = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/feed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content, access_token: accessToken }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Facebook publish failed (${res.status}): ${err}`);
        }
        const data = await res.json();
        const postId = data.id || "";
        return { platformPostId: postId, postUrl: `https://www.facebook.com/${postId.replace("_", "/posts/")}` };
      }

      // Facebook with media
      if (videos.length > 0) {
        // Video post — use the first video
        const video = videos[0];
        const supabase = getSupabase();
        const { data: signedData } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(video.path, 300);
        const videoUrl = signedData?.signedUrl || video.url;
        const res = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/videos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_url: videoUrl, description: content, access_token: accessToken }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Facebook video publish failed (${res.status}): ${err}`);
        }
        const data = await res.json();
        return { platformPostId: data.id || "", postUrl: `https://www.facebook.com/${platformUserId}/videos/${data.id}` };
      }

      if (images.length === 1) {
        // Single image post
        const img = images[0];
        const supabase = getSupabase();
        const { data: signedData } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(img.path, 300);
        const imgUrl = signedData?.signedUrl || img.url;
        const res = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: imgUrl, message: content, access_token: accessToken }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Facebook photo publish failed (${res.status}): ${err}`);
        }
        const data = await res.json();
        return { platformPostId: data.id || "", postUrl: `https://www.facebook.com/${data.post_id || data.id}` };
      }

      // Multiple images — upload as unpublished photos, then create feed post with attached_media
      const photoIds: string[] = [];
      for (const img of images.slice(0, 10)) {
        const supabase = getSupabase();
        const { data: signedData } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(img.path, 300);
        const imgUrl = signedData?.signedUrl || img.url;
        const res = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: imgUrl, published: false, access_token: accessToken }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Facebook multi-photo upload failed (${res.status}): ${err}`);
        }
        const data = await res.json();
        photoIds.push(data.id);
      }

      const attachedMedia: Record<string, string> = {};
      photoIds.forEach((id, i) => { attachedMedia[`attached_media[${i}]`] = `{"media_fbid":"${id}"}`; });

      const feedPayload = new URLSearchParams({ message: content, access_token: accessToken, ...attachedMedia });
      const feedRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: feedPayload,
      });
      if (!feedRes.ok) {
        const err = await feedRes.text();
        throw new Error(`Facebook multi-photo post failed (${feedRes.status}): ${err}`);
      }
      const feedData = await feedRes.json();
      return { platformPostId: feedData.id || "", postUrl: `https://www.facebook.com/${feedData.id?.replace("_", "/posts/")}` };
    },
    async getEngagement(accessToken: string, platformPostId: string, _platformUserId: string): Promise<EngagementMetrics> {
      const now = new Date().toISOString();
      const metrics: EngagementMetrics = { lastSyncedAt: now };
      try {
        // Facebook post insights
        const fields = "likes.summary(true),comments.summary(true),shares";
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${platformPostId}?fields=${fields}&access_token=${accessToken}`,
        );
        if (res.ok) {
          const data = await res.json();
          metrics.likes = data.likes?.summary?.total_count ?? 0;
          metrics.comments = data.comments?.summary?.total_count ?? 0;
          metrics.shares = data.shares?.count ?? 0;
        }

        // Post-level insights for impressions/reach/reactions
        try {
          const insightsRes = await fetch(
            `https://graph.facebook.com/v19.0/${platformPostId}/insights?metric=post_impressions,post_reactions_by_type_total,post_engaged_users&access_token=${accessToken}`,
          );
          if (insightsRes.ok) {
            const insightsData = await insightsRes.json();
            for (const metric of insightsData.data || []) {
              const val = metric.values?.[0]?.value;
              switch (metric.name) {
                case "post_impressions":
                  metrics.impressions = typeof val === "number" ? val : 0;
                  break;
                case "post_reactions_by_type_total":
                  if (typeof val === "object" && val) {
                    metrics.reactions = Object.values(val as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
                  }
                  break;
                case "post_engaged_users":
                  metrics.reach = typeof val === "number" ? val : 0;
                  break;
              }
            }
          }
        } catch { /* insights may not be available for all post types */ }

        console.log(`[SOCIAL-ENGAGE] Facebook metrics for ${platformPostId}: likes=${metrics.likes}, comments=${metrics.comments}, shares=${metrics.shares}, impressions=${metrics.impressions}`);
      } catch (err: any) {
        console.log(`[SOCIAL-ENGAGE] Facebook engagement fetch error: ${err.message}`);
      }
      return metrics;
    },
  },
  instagram: {
    platform: "instagram",
    getAuthUrl(_state: string): string {
      throw new Error("Use /auth/meta/connect for Instagram OAuth");
    },
    async exchangeCode(_code: string) {
      throw new Error("Use /auth/meta/callback for Instagram token exchange");
    },
    async getUserInfo(accessToken: string) {
      // IG user info via Facebook's Graph API (requires page token)
      const res = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,username,profile_picture_url&access_token=${accessToken}`);
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Instagram user info failed: ${err}`);
      }
      const data = await res.json();
      return {
        platformUserId: data.id,
        displayName: data.name || data.username || "Instagram",
        avatarUrl: data.profile_picture_url,
      };
    },
    async publishPost(accessToken: string, platformUserId: string, content: string, mediaFiles?: MediaFile[]) {
      const hasMedia = mediaFiles && mediaFiles.length > 0;
      const images = mediaFiles?.filter(m => m.mimeType.startsWith("image/")) || [];
      const videos = mediaFiles?.filter(m => m.mimeType.startsWith("video/")) || [];

      if (!hasMedia) {
        throw new Error("Instagram requires an image or video for feed posts. Please attach media to publish to Instagram.");
      }

      const supabase = getSupabase();

      if (images.length === 1 && videos.length === 0) {
        // Single image post
        const img = images[0];
        const { data: signedData } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(img.path, 600);
        const imgUrl = signedData?.signedUrl || img.url;

        const containerRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: imgUrl, caption: content, access_token: accessToken }),
        });
        if (!containerRes.ok) {
          const err = await containerRes.text();
          throw new Error(`Instagram container creation failed (${containerRes.status}): ${err}`);
        }
        const containerData = await containerRes.json();
        const creationId = containerData.id;

        const publishRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/media_publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
        });
        if (!publishRes.ok) {
          const err = await publishRes.text();
          throw new Error(`Instagram publish failed (${publishRes.status}): ${err}`);
        }
        const publishData = await publishRes.json();
        return { platformPostId: publishData.id || "", postUrl: `https://www.instagram.com/` };
      }

      if (videos.length > 0) {
        // Video (Reel) post — use first video
        const video = videos[0];
        const { data: signedData } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(video.path, 600);
        const videoUrl = signedData?.signedUrl || video.url;

        const containerRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ video_url: videoUrl, caption: content, media_type: "REELS", access_token: accessToken }),
        });
        if (!containerRes.ok) {
          const err = await containerRes.text();
          throw new Error(`Instagram video container failed (${containerRes.status}): ${err}`);
        }
        const containerData = await containerRes.json();

        // Poll for container status (video processing)
        let creationId = containerData.id;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${accessToken}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.status_code === "FINISHED") break;
            if (statusData.status_code === "ERROR") throw new Error("Instagram video processing failed");
          }
        }

        const publishRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/media_publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
        });
        if (!publishRes.ok) {
          const err = await publishRes.text();
          throw new Error(`Instagram video publish failed (${publishRes.status}): ${err}`);
        }
        const publishData = await publishRes.json();
        return { platformPostId: publishData.id || "", postUrl: `https://www.instagram.com/` };
      }

      // Multiple images — Carousel post
      const childIds: string[] = [];
      for (const img of images.slice(0, 10)) {
        const { data: signedData } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(img.path, 600);
        const imgUrl = signedData?.signedUrl || img.url;
        const childRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: imgUrl, is_carousel_item: true, access_token: accessToken }),
        });
        if (!childRes.ok) {
          const err = await childRes.text();
          throw new Error(`Instagram carousel item failed (${childRes.status}): ${err}`);
        }
        const childData = await childRes.json();
        childIds.push(childData.id);
      }

      const carouselRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_type: "CAROUSEL", children: childIds, caption: content, access_token: accessToken }),
      });
      if (!carouselRes.ok) {
        const err = await carouselRes.text();
        throw new Error(`Instagram carousel creation failed (${carouselRes.status}): ${err}`);
      }
      const carouselData = await carouselRes.json();

      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${platformUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: carouselData.id, access_token: accessToken }),
      });
      if (!publishRes.ok) {
        const err = await publishRes.text();
        throw new Error(`Instagram carousel publish failed (${publishRes.status}): ${err}`);
      }
      const publishData = await publishRes.json();
      return { platformPostId: publishData.id || "", postUrl: `https://www.instagram.com/` };
    },
    async getEngagement(accessToken: string, platformPostId: string, _platformUserId: string): Promise<EngagementMetrics> {
      const now = new Date().toISOString();
      const metrics: EngagementMetrics = { lastSyncedAt: now };
      try {
        // Instagram media insights
        const fields = "like_count,comments_count,impressions,reach,saved,shares";
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${platformPostId}?fields=${fields}&access_token=${accessToken}`,
        );
        if (res.ok) {
          const data = await res.json();
          metrics.likes = data.like_count ?? 0;
          metrics.comments = data.comments_count ?? 0;
          metrics.saves = data.saved ?? 0;
          metrics.impressions = data.impressions ?? 0;
          metrics.reach = data.reach ?? 0;
          metrics.shares = data.shares?.count ?? 0;
        }

        // Also try the insights endpoint for richer data
        try {
          const insRes = await fetch(
            `https://graph.facebook.com/v19.0/${platformPostId}/insights?metric=impressions,reach,saved,shares&access_token=${accessToken}`,
          );
          if (insRes.ok) {
            const insData = await insRes.json();
            for (const metric of insData.data || []) {
              const val = metric.values?.[0]?.value;
              if (typeof val !== "number") continue;
              switch (metric.name) {
                case "impressions": metrics.impressions = val; break;
                case "reach": metrics.reach = val; break;
                case "saved": metrics.saves = val; break;
                case "shares": metrics.shares = val; break;
              }
            }
          }
        } catch { /* insights endpoint may not be available for all media types */ }

        console.log(`[SOCIAL-ENGAGE] Instagram metrics for ${platformPostId}: likes=${metrics.likes}, comments=${metrics.comments}, impressions=${metrics.impressions}, reach=${metrics.reach}, saves=${metrics.saves}`);
      } catch (err: any) {
        console.log(`[SOCIAL-ENGAGE] Instagram engagement fetch error: ${err.message}`);
      }
      return metrics;
    },
  },
};

function getAdapter(platform: Platform): ProviderAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`Platform "${platform}" is not yet supported`);
  return adapter;
}

// ─── Token Refresh Helper ────────────────────────────────────────────

async function ensureFreshToken(account: SocialAccount): Promise<string> {
  // If token expires within 5 minutes, refresh it
  if (account.expiresAt > Date.now() + 5 * 60 * 1000) {
    return account.accessToken;
  }
  const adapter = getAdapter(account.platform);
  if (!adapter.refreshAccessToken || !account.refreshToken) {
    throw new Error(`Cannot refresh ${account.platform} token — reconnect required`);
  }
  console.log(`[SOCIAL] Refreshing ${account.platform} token for user ${account.userId}`);
  const result = await adapter.refreshAccessToken(account.refreshToken);
  account.accessToken = result.accessToken;
  account.expiresAt = Date.now() + result.expiresIn * 1000;
  // Persist updated token
  await kv.set(accountKey(account.userId, account.platform, account.id), JSON.stringify(account));
  return account.accessToken;
}

// ─── Supabase Storage for Media ──────────────────────────────────────

const MEDIA_BUCKET = "make-a8b2511f-social-media";

async function ensureMediaBucket() {
  const supabase = getSupabase();
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b: any) => b.name === MEDIA_BUCKET);
  if (!exists) {
    await supabase.storage.createBucket(MEDIA_BUCKET, { public: false });
    console.log(`[SOCIAL] Created storage bucket: ${MEDIA_BUCKET}`);
  }
}

// Call once on first request (lazy init)
let _bucketReady = false;
async function initBucket() {
  if (_bucketReady) return;
  try {
    await ensureMediaBucket();
    _bucketReady = true;
  } catch (err: any) {
    console.log(`[SOCIAL] Bucket init warning: ${err.message}`);
  }
}

// ─── Hono App ────────────────────────────────────────────────────────

const socialApp = new Hono();

// ── GET /accounts — List connected social accounts ──

socialApp.get("/accounts", async (c) => {
  try {
    const user = await requireUser(c);
    const accounts = await getUserAccounts(user.id);
    // Strip tokens from response
    const safe = accounts.map(({ accessToken, refreshToken, ...rest }) => rest);
    return c.json({ accounts: safe });
  } catch (err: any) {
    console.log(`[SOCIAL] Error listing accounts: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── DELETE /accounts/:platform/:accountId — Disconnect account ──

socialApp.delete("/accounts/:platform/:accountId", async (c) => {
  try {
    const user = await requireUser(c);
    const { platform, accountId } = c.req.param();
    await kv.del(accountKey(user.id, platform as Platform, accountId));
    return c.json({ ok: true });
  } catch (err: any) {
    console.log(`[SOCIAL] Error disconnecting account: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── GET /auth/:platform/connect — Initiate OAuth flow ──

socialApp.get("/auth/:platform/connect", async (c, next) => {
  try {
    const { platform } = c.req.param();
    // Meta uses its own dedicated flow — let it fall through
    if (platform === "meta") return next();
    const adapter = getAdapter(platform as Platform);
    const token = c.req.query("token");
    const origin = c.req.query("origin") || "";
    if (!token) return c.json({ error: "Missing authentication token" }, 401);

    const supabase = getSupabase();
    const { user, error } = await authGetUser(supabase, token, "SOCIAL-OAUTH");
    if (error || !user) {
      console.log(`[SOCIAL] OAuth connect auth failed: ${error}`);
      return socialOAuthRedirect(c, origin, { error: "Authentication failed" });
    }

    const state = crypto.randomUUID();
    await kv.set(
      `social_oauth_state:${state}`,
      JSON.stringify({ userId: user.id, platform, origin, createdAt: Date.now() }),
    );

    const authUrl = adapter.getAuthUrl(state);
    console.log(`[SOCIAL] Redirecting to ${platform} OAuth for user ${user.id}`);
    return c.redirect(authUrl);
  } catch (err: any) {
    console.log(`[SOCIAL] OAuth connect error: ${err.message}`);
    const origin = c.req.query("origin") || "/";
    return socialOAuthRedirect(c, origin, { error: err.message });
  }
});

// ── GET /auth/:platform/callback — OAuth callback ──

socialApp.get("/auth/:platform/callback", async (c, next) => {
  const { platform } = c.req.param();
  // Meta uses its own dedicated callback — let it fall through
  if (platform === "meta") return next();
  let origin = "";
  try {
    const code = c.req.query("code");
    const stateParam = c.req.query("state");
    const errorParam = c.req.query("error");
    const errorDesc = c.req.query("error_description");

    // Verify state
    const stateRaw = stateParam ? await kv.get(`social_oauth_state:${stateParam}`) : null;
    let stateData: any = null;
    if (stateRaw) {
      stateData = JSON.parse(stateRaw);
      origin = stateData?.origin || "";
      await kv.del(`social_oauth_state:${stateParam}`);
      if (Date.now() - stateData.createdAt > 10 * 60 * 1000) {
        stateData = null;
      }
    }

    if (errorParam) {
      console.log(`[SOCIAL] ${platform} OAuth denied: ${errorParam} - ${errorDesc}`);
      return socialOAuthRedirect(c, origin, { error: errorDesc || errorParam });
    }
    if (!code || !stateData) {
      console.log(`[SOCIAL] ${platform} OAuth callback: missing code or invalid state`);
      return socialOAuthRedirect(c, origin, { error: "Missing authorization code or expired state. Please try again." });
    }

    const adapter = getAdapter(platform as Platform);
    const tokens = await adapter.exchangeCode(code);
    const userInfo = await adapter.getUserInfo(tokens.accessToken);

    // ── LinkedIn: Check for org pages; if found, redirect for account selection; otherwise auto-connect personal ──
    if (platform === "linkedin") {
      // Probe for administered organizations (requires r_organization_admin scope)
      let hasOrgs = false;
      try {
        const aclsRes = await fetch(
          `https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=1`,
          {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              "LinkedIn-Version": "202506",
              "X-Restli-Protocol-Version": "2.0.0",
            },
          },
        );
        if (aclsRes.ok) {
          const aclsData = await aclsRes.json();
          hasOrgs = (aclsData.elements?.length || 0) > 0;
          console.log(`[SOCIAL-LI] Org ACL probe: ${aclsData.elements?.length || 0} orgs found`);
        } else {
          console.log(`[SOCIAL-LI] Org ACL probe failed (${aclsRes.status}) — no org scope, personal-only`);
        }
      } catch (orgErr: any) {
        console.log(`[SOCIAL-LI] Org ACL probe error: ${orgErr.message}`);
      }

      if (hasOrgs) {
        // Store temp token and redirect for account selection
        const tempKey = `social_linkedin_temp:${stateData.userId}`;
        await kv.set(tempKey, JSON.stringify({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          scopes: tokens.scopes,
          userInfo,
          createdAt: Date.now(),
        }));
        console.log(`[SOCIAL-LI] Org pages available — redirecting for account selection (${userInfo.displayName})`);
        return socialOAuthRedirect(c, origin, { linkedin_select_account: true });
      }

      // No orgs — auto-connect personal profile directly (no extra click needed)
      const liAccountId = `linkedin_${userInfo.platformUserId}`;
      const liAccount: SocialAccount = {
        id: liAccountId,
        userId: stateData.userId,
        platform: "linkedin",
        platformUserId: userInfo.platformUserId,
        displayName: userInfo.displayName,
        email: userInfo.email,
        avatarUrl: userInfo.avatarUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        scopes: tokens.scopes,
        connectedAt: new Date().toISOString(),
        metadata: { accountType: "personal" },
      };
      await kv.set(accountKey(stateData.userId, "linkedin", liAccountId), JSON.stringify(liAccount));
      console.log(`[SOCIAL-LI] No org pages — auto-connected personal for user ${stateData.userId}: ${userInfo.displayName}`);
      return socialOAuthRedirect(c, origin, { platform: "linkedin", name: userInfo.displayName });
    }

    // ── Non-LinkedIn platforms: direct connect (fallback) ──
    const accountId = `${platform}_${userInfo.platformUserId}`;
    const account: SocialAccount = {
      id: accountId,
      userId: stateData.userId,
      platform: platform as Platform,
      platformUserId: userInfo.platformUserId,
      displayName: userInfo.displayName,
      email: userInfo.email,
      avatarUrl: userInfo.avatarUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      scopes: tokens.scopes,
      connectedAt: new Date().toISOString(),
    };

    await kv.set(accountKey(stateData.userId, platform as Platform, accountId), JSON.stringify(account));
    console.log(`[SOCIAL] ${platform} account connected for user ${stateData.userId}: ${userInfo.displayName}`);
    return socialOAuthRedirect(c, origin, { platform, name: userInfo.displayName });
  } catch (err: any) {
    console.log(`[SOCIAL] ${platform} OAuth callback error: ${err.message}`);
    return socialOAuthRedirect(c, origin, { error: err.message });
  }
});

// ── GET /auth/linkedin/accounts — List personal profile + administered organization pages ──

socialApp.get("/auth/linkedin/accounts", async (c) => {
  try {
    const user = await requireUser(c);
    console.log(`[SOCIAL-LI] Accounts request for user ${user.id}`);
    const tempRaw = await kv.get(`social_linkedin_temp:${user.id}`);
    if (!tempRaw) {
      return c.json({ error: "No LinkedIn authorization found. Please connect LinkedIn first." }, 400);
    }
    const temp = JSON.parse(tempRaw);
    if (Date.now() - temp.createdAt > 30 * 60 * 1000) {
      await kv.del(`social_linkedin_temp:${user.id}`);
      return c.json({ error: "LinkedIn authorization expired. Please reconnect." }, 400);
    }

    const versionedHeaders = {
      Authorization: `Bearer ${temp.accessToken}`,
      "LinkedIn-Version": "202506",
      "X-Restli-Protocol-Version": "2.0.0",
    };

    // Personal profile is always available
    const personal = {
      type: "personal" as const,
      id: temp.userInfo.platformUserId,
      name: temp.userInfo.displayName,
      avatarUrl: temp.userInfo.avatarUrl,
      email: temp.userInfo.email,
    };

    // Try to fetch administered organizations (requires r_organization_admin scope)
    const organizations: { type: "organization"; id: string; name: string; avatarUrl?: string; vanityName?: string }[] = [];
    try {
      const aclsRes = await fetch(
        `https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50`,
        { headers: versionedHeaders },
      );
      if (aclsRes.ok) {
        const aclsData = await aclsRes.json();
        const orgElements = aclsData.elements || [];
        console.log(`[SOCIAL-LI] Found ${orgElements.length} organization ACL(s) for user ${user.id}`);

        // Fetch org details for each
        for (const acl of orgElements) {
          const orgUrn = acl.organization || acl["organization~"]?.id;
          if (!orgUrn) continue;
          const orgId = String(orgUrn).replace("urn:li:organization:", "");
          try {
            const orgRes = await fetch(
              `https://api.linkedin.com/rest/organizations/${orgId}?projection=(id,localizedName,vanityName,logoV2)`,
              { headers: versionedHeaders },
            );
            if (orgRes.ok) {
              const orgData = await orgRes.json();
              const logoElements = orgData.logoV2?.["original~"]?.elements;
              const logoUrl = logoElements?.[0]?.identifiers?.[0]?.identifier;
              organizations.push({
                type: "organization",
                id: orgId,
                name: orgData.localizedName || `Organization ${orgId}`,
                avatarUrl: logoUrl,
                vanityName: orgData.vanityName,
              });
              console.log(`[SOCIAL-LI]   Org: id=${orgId}, name=${orgData.localizedName}, vanity=${orgData.vanityName}`);
            } else {
              const errText = await orgRes.text().catch(() => "");
              console.log(`[SOCIAL-LI]   Org ${orgId} fetch failed (${orgRes.status}): ${errText.slice(0, 200)}`);
            }
          } catch (orgErr: any) {
            console.log(`[SOCIAL-LI]   Org ${orgId} fetch error: ${orgErr.message}`);
          }
        }
      } else {
        const errText = await aclsRes.text().catch(() => "");
        console.log(`[SOCIAL-LI] Organization ACLs fetch failed (${aclsRes.status}): ${errText.slice(0, 300)}`);
        console.log(`[SOCIAL-LI] This is expected if r_organization_admin scope was not granted — personal-only mode`);
      }
    } catch (orgListErr: any) {
      console.log(`[SOCIAL-LI] Organization listing error: ${orgListErr.message}`);
    }

    return c.json({ personal, organizations });
  } catch (err: any) {
    console.log(`[SOCIAL-LI] Error fetching accounts: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── POST /auth/linkedin/select-account — Finalize LinkedIn by selecting personal or org ──

socialApp.post("/auth/linkedin/select-account", async (c) => {
  try {
    const user = await requireUser(c);
    const { accountType, orgId } = await c.req.json();
    // accountType: "personal" | "organization"
    if (!accountType) return c.json({ error: "accountType is required" }, 400);
    if (accountType === "organization" && !orgId) return c.json({ error: "orgId is required for organization accounts" }, 400);

    const tempRaw = await kv.get(`social_linkedin_temp:${user.id}`);
    if (!tempRaw) return c.json({ error: "No LinkedIn authorization found. Please reconnect." }, 400);
    const temp = JSON.parse(tempRaw);
    if (Date.now() - temp.createdAt > 30 * 60 * 1000) {
      await kv.del(`social_linkedin_temp:${user.id}`);
      return c.json({ error: "LinkedIn authorization expired. Please reconnect." }, 400);
    }

    const now = new Date().toISOString();
    const versionedHeaders = {
      Authorization: `Bearer ${temp.accessToken}`,
      "LinkedIn-Version": "202506",
      "X-Restli-Protocol-Version": "2.0.0",
    };

    if (accountType === "personal") {
      const accountId = `linkedin_${temp.userInfo.platformUserId}`;
      const account: SocialAccount = {
        id: accountId,
        userId: user.id,
        platform: "linkedin",
        platformUserId: temp.userInfo.platformUserId,
        displayName: temp.userInfo.displayName,
        email: temp.userInfo.email,
        avatarUrl: temp.userInfo.avatarUrl,
        accessToken: temp.accessToken,
        refreshToken: temp.refreshToken,
        expiresAt: Date.now() + (temp.expiresIn || 5184000) * 1000,
        scopes: temp.scopes || [],
        connectedAt: now,
        metadata: { accountType: "personal" },
      };
      await kv.set(accountKey(user.id, "linkedin", accountId), JSON.stringify(account));
      console.log(`[SOCIAL-LI] Personal account connected for user ${user.id}: ${temp.userInfo.displayName}`);
      await kv.del(`social_linkedin_temp:${user.id}`);
      return c.json({ ok: true, connected: ["LinkedIn (Personal)"], message: `Connected LinkedIn as ${temp.userInfo.displayName}` });
    }

    // Organization account
    // Fetch org details to get the name
    let orgName = `Organization ${orgId}`;
    let orgAvatarUrl: string | undefined;
    try {
      const orgRes = await fetch(
        `https://api.linkedin.com/rest/organizations/${orgId}?projection=(id,localizedName,vanityName,logoV2)`,
        { headers: versionedHeaders },
      );
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        orgName = orgData.localizedName || orgName;
        const logoElements = orgData.logoV2?.["original~"]?.elements;
        orgAvatarUrl = logoElements?.[0]?.identifiers?.[0]?.identifier;
      }
    } catch { /* use fallback name */ }

    const accountId = `linkedin_org_${orgId}`;
    const account: SocialAccount = {
      id: accountId,
      userId: user.id,
      platform: "linkedin",
      platformUserId: orgId,
      displayName: orgName,
      avatarUrl: orgAvatarUrl,
      accessToken: temp.accessToken,
      refreshToken: temp.refreshToken,
      expiresAt: Date.now() + (temp.expiresIn || 5184000) * 1000,
      scopes: temp.scopes || [],
      connectedAt: now,
      metadata: {
        accountType: "organization",
        orgId,
        orgName,
        personId: temp.userInfo.platformUserId,
        personName: temp.userInfo.displayName,
      },
    };
    await kv.set(accountKey(user.id, "linkedin", accountId), JSON.stringify(account));
    console.log(`[SOCIAL-LI] Organization account connected for user ${user.id}: ${orgName} (org ${orgId})`);
    await kv.del(`social_linkedin_temp:${user.id}`);
    return c.json({ ok: true, connected: [`LinkedIn (${orgName})`], message: `Connected LinkedIn as ${orgName}` });
  } catch (err: any) {
    console.log(`[SOCIAL-LI] Error selecting account: ${err.message}\n${err.stack || ""}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

function socialOAuthRedirect(c: any, _origin: string, result: { platform?: string; name?: string; error?: string; linkedin_select_account?: boolean }) {
  // Redirect to the frontend's /social-oauth-callback route on the SAME ORIGIN as the parent app.
  // BroadcastChannel is same-origin only, so rendering HTML on the Supabase domain doesn't work.
  // The frontend SocialOAuthCallback component handles BroadcastChannel relay + auto-close.
  let baseUrl = "";
  try {
    if (_origin) {
      const decoded = decodeURIComponent(_origin);
      baseUrl = new URL(decoded).origin;
    }
  } catch {
    try {
      if (_origin) baseUrl = new URL(_origin).origin;
    } catch {}
  }

  const params = new URLSearchParams();
  if (result.error) {
    params.set("social_error", result.error);
  } else if (result.linkedin_select_account) {
    params.set("linkedin_select_account", "true");
  } else {
    if (result.platform) params.set("social_connected", result.platform);
    if (result.name) params.set("social_name", result.name);
  }

  const redirectUrl = `${baseUrl}/social-oauth-callback?${params.toString()}`;
  console.log(`[SOCIAL] Redirecting to frontend callback: ${redirectUrl}`);
  return c.redirect(redirectUrl);
}

// ── Meta OAuth Flow ──────────────────────────────────────────────────
// Meta uses a multi-step flow: OAuth → get user token → fetch pages → user selects page

socialApp.get("/auth/meta/connect", async (c) => {
  try {
    const token = c.req.query("token");
    const origin = c.req.query("origin") || "";
    if (!token) return c.json({ error: "Missing authentication token" }, 401);

    const supabase = getSupabase();
    const { user, error } = await authGetUser(supabase, token, "SOCIAL-META-OAUTH");
    if (error || !user) {
      console.log(`[SOCIAL] Meta OAuth connect auth failed: ${error}`);
      return socialOAuthRedirect(c, origin, { error: "Authentication failed" });
    }

    const state = crypto.randomUUID();
    await kv.set(
      `social_oauth_state:${state}`,
      JSON.stringify({ userId: user.id, platform: "meta", origin, createdAt: Date.now() }),
    );

    const appId = Deno.env.get("META_APP_ID") ?? "";

    // FIX: Removed invalid "pages_manage_posts" scope.
    // NOTE: Meta uses "instagram_content_publish" (no "ing") as the valid OAuth scope name.
    const scopes = "pages_read_engagement,pages_show_list,business_management,instagram_basic,instagram_content_publish";

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: metaCallbackUrl(),
      state,
      scope: scopes,
      response_type: "code",
    });
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    console.log(`[SOCIAL-META] Connect: user=${user.id}, appId=${appId ? appId.substring(0, 6) + "..." : "EMPTY"}, redirect_uri=${metaCallbackUrl()}, state=${state}, origin=${origin || "(empty)"}`);
    return c.redirect(authUrl);
  } catch (err: any) {
    console.log(`[SOCIAL-META] Connect error: ${err.message}`);
    const origin = c.req.query("origin") || "";
    return socialOAuthRedirect(c, origin, { error: err.message });
  }
});

socialApp.get("/auth/meta/callback", async (c) => {
  let origin = "";
  try {
    const code = c.req.query("code");
    const stateParam = c.req.query("state");
    const errorParam = c.req.query("error");
    const errorDesc = c.req.query("error_description");
    const errorReason = c.req.query("error_reason");

    // ── Diagnostic: log all non-secret query params ──
    console.log(`[SOCIAL-META] Callback hit: code=${code ? "present(" + code.length + "chars)" : "MISSING"}, state=${stateParam ? "present" : "MISSING"}, error=${errorParam || "none"}, error_desc=${errorDesc || "none"}, error_reason=${errorReason || "none"}`);

    // ── State validation ──
    const stateRaw = stateParam ? await kv.get(`social_oauth_state:${stateParam}`) : null;
    console.log(`[SOCIAL-META] State lookup: key=social_oauth_state:${stateParam || "null"}, found=${!!stateRaw}`);
    let stateData: any = null;
    if (stateRaw) {
      stateData = JSON.parse(stateRaw);
      origin = stateData?.origin || "";
      await kv.del(`social_oauth_state:${stateParam}`);
      const stateAge = Date.now() - stateData.createdAt;
      console.log(`[SOCIAL-META] State valid: userId=${stateData.userId}, platform=${stateData.platform}, origin=${origin || "(empty)"}, age=${Math.round(stateAge / 1000)}s`);
      if (stateAge > 10 * 60 * 1000) {
        console.log(`[SOCIAL-META] State EXPIRED (age=${Math.round(stateAge / 1000)}s > 600s)`);
        stateData = null;
      }
    } else if (stateParam) {
      console.log(`[SOCIAL-META] State NOT FOUND in KV — may have been consumed already, never written, or KV read failed`);
    }

    if (errorParam) {
      console.log(`[SOCIAL-META] OAuth denied by user/Meta: ${errorParam} — ${errorDesc} — reason: ${errorReason}`);
      return socialOAuthRedirect(c, origin, { error: errorDesc || errorParam });
    }
    if (!code || !stateData) {
      const reason = !code ? "authorization code missing from Meta redirect" : "state is invalid, expired, or not found in KV";
      console.log(`[SOCIAL-META] Aborting: ${reason}`);
      return socialOAuthRedirect(c, origin, { error: `Meta OAuth failed: ${reason}. Please try connecting again.` });
    }

    // ── Token exchange ──
    const appId = Deno.env.get("META_APP_ID") ?? "";
    const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
    const callbackUrl = metaCallbackUrl();
    console.log(`[SOCIAL-META] Env check: META_APP_ID=${appId ? appId.substring(0, 6) + "...(" + appId.length + "chars)" : "EMPTY"}, META_APP_SECRET=${appSecret ? "set(" + appSecret.length + "chars)" : "EMPTY"}, redirect_uri=${callbackUrl}`);

    if (!appId || !appSecret) {
      console.log(`[SOCIAL-META] FATAL: Missing env — META_APP_ID=${appId ? "set" : "MISSING"}, META_APP_SECRET=${appSecret ? "set" : "MISSING"}`);
      return socialOAuthRedirect(c, origin, { error: "Server config error: Meta app credentials not set." });
    }

    console.log(`[SOCIAL-META] POSTing token exchange to graph.facebook.com with redirect_uri=${callbackUrl}`);
    const tokenRes = await fetch("https://graph.facebook.com/v19.0/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: callbackUrl,
        code,
      }),
    });

    const tokenResText = await tokenRes.text();
    console.log(`[SOCIAL-META] Token exchange response: status=${tokenRes.status}, body=${tokenResText.substring(0, 500)}`);

    if (!tokenRes.ok) {
      return socialOAuthRedirect(c, origin, { error: `Meta token exchange failed (HTTP ${tokenRes.status}): ${tokenResText.substring(0, 200)}` });
    }

    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenResText);
    } catch {
      console.log(`[SOCIAL-META] Token response not valid JSON: ${tokenResText.substring(0, 200)}`);
      return socialOAuthRedirect(c, origin, { error: "Meta returned an invalid token response." });
    }

    const shortLivedToken = tokenData.access_token;
    if (!shortLivedToken) {
      console.log(`[SOCIAL-META] Token response missing access_token field: ${JSON.stringify(tokenData).substring(0, 300)}`);
      return socialOAuthRedirect(c, origin, { error: "Meta did not return an access token." });
    }
    console.log(`[SOCIAL-META] Short-lived token OK: ${shortLivedToken.substring(0, 12)}..., expires_in=${tokenData.expires_in ?? "unspecified"}`);

    // ── Exchange for long-lived token (60 days) ──
    console.log(`[SOCIAL-META] Exchanging for long-lived token…`);
    const llRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`);
    const llResText = await llRes.text();
    console.log(`[SOCIAL-META] Long-lived token response: status=${llRes.status}, body=${llResText.substring(0, 500)}`);

    let longLivedToken = shortLivedToken;
    let expiresIn = tokenData.expires_in || 5184000;
    if (llRes.ok) {
      try {
        const llData = JSON.parse(llResText);
        longLivedToken = llData.access_token || shortLivedToken;
        expiresIn = llData.expires_in || 5184000;
        console.log(`[SOCIAL-META] Long-lived token OK: ${longLivedToken.substring(0, 12)}..., expires_in=${expiresIn}`);
      } catch {
        console.log(`[SOCIAL-META] Long-lived response not valid JSON, using short-lived token`);
      }
    } else {
      console.log(`[SOCIAL-META] Long-lived exchange failed (HTTP ${llRes.status}), using short-lived token`);
    }

    // ── LinkedIn-style: handle everything server-side in one shot ──
    // Fetch pages, auto-select first if found, fall back to personal FB profile if none.
    const now = new Date().toISOString();
    const pageExpiresAt = Date.now() + expiresIn * 1000;
    const connectedAccounts: string[] = [];

    // 1) Try to get Facebook Pages
    console.log(`[SOCIAL-META] Fetching pages from Graph API (inline)…`);
    let pages: any[] = [];
    try {
      const pagesRes = await fetch(
        `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,picture.type(large),instagram_business_account{id,name,username,profile_picture_url}&limit=100&access_token=${longLivedToken}`,
      );
      if (pagesRes.ok) {
        const pagesData = await pagesRes.json();
        pages = pagesData.data || [];
        console.log(`[SOCIAL-META] Found ${pages.length} Facebook page(s)`);
      } else {
        console.log(`[SOCIAL-META] Pages fetch failed (HTTP ${pagesRes.status}), falling back to personal profile`);
      }
    } catch (pgErr: any) {
      console.log(`[SOCIAL-META] Pages fetch error: ${pgErr.message}, falling back to personal profile`);
    }

    if (pages.length > 0) {
      // Auto-select first page (like LinkedIn auto-selects personal)
      const selectedPage = pages[0];
      const pageToken = selectedPage.access_token;

      // Create Facebook Page account
      const fbAccountId = `facebook_${selectedPage.id}`;
      const fbAccount: SocialAccount = {
        id: fbAccountId,
        userId: stateData.userId,
        platform: "facebook",
        platformUserId: selectedPage.id,
        displayName: selectedPage.name || "Facebook Page",
        avatarUrl: selectedPage.picture?.data?.url,
        accessToken: pageToken,
        expiresAt: pageExpiresAt,
        scopes: ["pages_read_engagement", "pages_show_list", "business_management"],
        connectedAt: now,
        metadata: { pageId: selectedPage.id, pageName: selectedPage.name, accountType: "page" },
      };
      await kv.set(accountKey(stateData.userId, "facebook", fbAccountId), JSON.stringify(fbAccount));
      connectedAccounts.push("Facebook");
      console.log(`[SOCIAL-META] Facebook page connected: ${selectedPage.name}`);

      // If Instagram Business account is linked, create Instagram account
      if (selectedPage.instagram_business_account) {
        const ig = selectedPage.instagram_business_account;
        const igAccountId = `instagram_${ig.id}`;
        const igAccount: SocialAccount = {
          id: igAccountId,
          userId: stateData.userId,
          platform: "instagram",
          platformUserId: ig.id,
          displayName: ig.username ? `@${ig.username}` : ig.name || "Instagram Business",
          avatarUrl: ig.profile_picture_url,
          accessToken: pageToken,
          expiresAt: pageExpiresAt,
          scopes: ["instagram_basic", "instagram_content_publish"],
          connectedAt: now,
          metadata: { igUserId: ig.id, igUsername: ig.username, linkedPageId: selectedPage.id, linkedPageName: selectedPage.name },
        };
        await kv.set(accountKey(stateData.userId, "instagram", igAccountId), JSON.stringify(igAccount));
        connectedAccounts.push("Instagram");
        console.log(`[SOCIAL-META] Instagram Business connected: ${ig.username || ig.name}`);
      }
    } else {
      // No pages — connect personal Facebook profile (like LinkedIn personal)
      console.log(`[SOCIAL-META] No pages found — connecting personal Facebook profile`);
      let fbUser: any = {};
      try {
        const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,picture.type(large)&access_token=${longLivedToken}`);
        if (meRes.ok) fbUser = await meRes.json();
      } catch {}

      const fbAccountId = `facebook_${fbUser.id || stateData.userId}`;
      const fbAccount: SocialAccount = {
        id: fbAccountId,
        userId: stateData.userId,
        platform: "facebook",
        platformUserId: fbUser.id || stateData.userId,
        displayName: fbUser.name || "Facebook Profile",
        avatarUrl: fbUser.picture?.data?.url,
        accessToken: longLivedToken,
        expiresAt: pageExpiresAt,
        scopes: ["pages_read_engagement", "pages_show_list", "business_management"],
        connectedAt: now,
        metadata: { accountType: "personal" },
      };
      await kv.set(accountKey(stateData.userId, "facebook", fbAccountId), JSON.stringify(fbAccount));
      connectedAccounts.push("Facebook");
      console.log(`[SOCIAL-META] Personal Facebook connected: ${fbUser.name || "unknown"}`);
    }

    // Also store temp token for future page selection if user adds pages later
    const tempKey = `social_meta_temp:${stateData.userId}`;
    await kv.set(tempKey, JSON.stringify({
      userAccessToken: longLivedToken,
      expiresIn,
      createdAt: Date.now(),
    }));

    const metaDisplayName = connectedAccounts.join(" & ");
    console.log(`[SOCIAL-META] SUCCESS — connected: [${metaDisplayName}] for user ${stateData.userId}`);
    return socialOAuthRedirect(c, origin, { platform: metaDisplayName, name: metaDisplayName });
  } catch (err: any) {
    console.log(`[SOCIAL-META] Callback UNHANDLED ERROR: ${err.message}\n${err.stack || ""}`);
    return socialOAuthRedirect(c, origin, { error: err.message });
  }
});

// ── GET /auth/meta/pages — List available Facebook Pages for selection ──

socialApp.get("/auth/meta/pages", async (c) => {
  try {
    const user = await requireUser(c);
    console.log(`[SOCIAL-META] Pages request for user ${user.id}`);
    const tempRaw = await kv.get(`social_meta_temp:${user.id}`);
    if (!tempRaw) {
      console.log(`[SOCIAL-META] No temp token found for user ${user.id}`);
      return c.json({ error: "No Meta authorization found. Please connect Meta first." }, 400);
    }
    const temp = JSON.parse(tempRaw);
    const tempAge = Date.now() - temp.createdAt;
    console.log(`[SOCIAL-META] Temp token age: ${Math.round(tempAge / 1000)}s`);
    // Check 30-minute expiry for temp token
    if (tempAge > 30 * 60 * 1000) {
      await kv.del(`social_meta_temp:${user.id}`);
      console.log(`[SOCIAL-META] Temp token expired for user ${user.id}`);
      return c.json({ error: "Meta authorization expired. Please reconnect." }, 400);
    }

    // Fetch pages the user manages
    console.log(`[SOCIAL-META] Fetching pages from Graph API…`);
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,picture.type(large),instagram_business_account{id,name,username,profile_picture_url}&limit=100&access_token=${temp.userAccessToken}`,
    );
    const pagesResText = await pagesRes.text();
    console.log(`[SOCIAL-META] Pages response: status=${pagesRes.status}, body=${pagesResText.substring(0, 500)}`);
    if (!pagesRes.ok) {
      throw new Error(`Failed to fetch Facebook pages (HTTP ${pagesRes.status}): ${pagesResText.substring(0, 200)}`);
    }
    let pagesData: any;
    try { pagesData = JSON.parse(pagesResText); } catch { throw new Error(`Pages response not valid JSON`); }
    const pages = (pagesData.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      pictureUrl: p.picture?.data?.url,
      accessToken: p.access_token,
      instagram: p.instagram_business_account
        ? {
            id: p.instagram_business_account.id,
            name: p.instagram_business_account.name,
            username: p.instagram_business_account.username,
            profilePictureUrl: p.instagram_business_account.profile_picture_url,
          }
        : null,
    }));

    const igCount = pages.filter((p: any) => p.instagram).length;
    console.log(`[SOCIAL-META] Found ${pages.length} Facebook page(s), ${igCount} with Instagram Business for user ${user.id}`);
    pages.forEach((p: any) => {
      console.log(`[SOCIAL-META]   Page: id=${p.id}, name=${p.name}, hasIG=${!!p.instagram}${p.instagram ? `, igId=${p.instagram.id}, igUser=@${p.instagram.username}` : ""}`);
    });
    // Don't expose page access tokens to frontend
    const safePgs = pages.map(({ accessToken, ...rest }: any) => rest);
    return c.json({ pages: safePgs });
  } catch (err: any) {
    console.log(`[SOCIAL-META] Error fetching pages: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── POST /auth/meta/select-page — Finalize Meta connection by selecting a page ──

socialApp.post("/auth/meta/select-page", async (c) => {
  try {
    const user = await requireUser(c);
    const { pageId } = await c.req.json();
    if (!pageId) return c.json({ error: "pageId is required" }, 400);

    const tempRaw = await kv.get(`social_meta_temp:${user.id}`);
    if (!tempRaw) {
      return c.json({ error: "No Meta authorization found. Please connect Meta first." }, 400);
    }
    const temp = JSON.parse(tempRaw);
    if (Date.now() - temp.createdAt > 30 * 60 * 1000) {
      await kv.del(`social_meta_temp:${user.id}`);
      return c.json({ error: "Meta authorization expired. Please reconnect." }, 400);
    }

    // Re-fetch pages to get the page access token (not exposed to frontend)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,picture.type(large),instagram_business_account{id,name,username,profile_picture_url}&limit=100&access_token=${temp.userAccessToken}`,
    );
    if (!pagesRes.ok) {
      const err = await pagesRes.text();
      throw new Error(`Failed to fetch Facebook pages: ${err}`);
    }
    const pagesData = await pagesRes.json();
    const selectedPage = (pagesData.data || []).find((p: any) => p.id === pageId);
    if (!selectedPage) {
      return c.json({ error: "Selected page not found. You may not have manage permissions." }, 404);
    }

    const now = new Date().toISOString();
    const connectedAccounts: string[] = [];

    // Page access tokens derived from long-lived user tokens are long-lived (no expiry)
    const pageToken = selectedPage.access_token;
    const pageExpiresAt = Date.now() + 60 * 24 * 60 * 60 * 1000; // ~60 days conservative

    // Create Facebook Page account
    // FIX: Removed invalid "pages_manage_posts" from stored scopes list.
    const fbAccountId = `facebook_${selectedPage.id}`;
    const fbAccount: SocialAccount = {
      id: fbAccountId,
      userId: user.id,
      platform: "facebook",
      platformUserId: selectedPage.id,
      displayName: selectedPage.name || "Facebook Page",
      avatarUrl: selectedPage.picture?.data?.url,
      accessToken: pageToken,
      expiresAt: pageExpiresAt,
      scopes: ["pages_read_engagement", "pages_show_list", "business_management"],
      connectedAt: now,
      metadata: {
        pageId: selectedPage.id,
        pageName: selectedPage.name,
      },
    };
    await kv.set(accountKey(user.id, "facebook", fbAccountId), JSON.stringify(fbAccount));
    connectedAccounts.push("Facebook");
    console.log(`[SOCIAL] Facebook page connected for user ${user.id}: ${selectedPage.name}`);

    // If Instagram Business account is linked, create Instagram account
    if (selectedPage.instagram_business_account) {
      const ig = selectedPage.instagram_business_account;
      const igAccountId = `instagram_${ig.id}`;
      const igAccount: SocialAccount = {
        id: igAccountId,
        userId: user.id,
        platform: "instagram",
        platformUserId: ig.id,
        displayName: ig.username ? `@${ig.username}` : ig.name || "Instagram Business",
        avatarUrl: ig.profile_picture_url,
        accessToken: pageToken, // IG uses the page token
        expiresAt: pageExpiresAt,
        scopes: ["instagram_basic", "instagram_content_publish"],
        connectedAt: now,
        metadata: {
          igUserId: ig.id,
          igUsername: ig.username,
          linkedPageId: selectedPage.id,
          linkedPageName: selectedPage.name,
        },
      };
      await kv.set(accountKey(user.id, "instagram", igAccountId), JSON.stringify(igAccount));
      connectedAccounts.push("Instagram");
      console.log(`[SOCIAL-META] Instagram Business connected for user ${user.id}: ${ig.username || ig.name}`);
    }

    // Clean up temp token
    await kv.del(`social_meta_temp:${user.id}`);

    console.log(`[SOCIAL-META] Page selection complete: connected=[${connectedAccounts.join(", ")}] for user ${user.id}`);
    return c.json({
      ok: true,
      connected: connectedAccounts,
      message: `Connected ${connectedAccounts.join(" & ")}`,
    });
  } catch (err: any) {
    console.log(`[SOCIAL-META] Error selecting page: ${err.message}\n${err.stack || ""}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── GET /auth/meta/debug — Non-secret diagnostic info for Meta integration ──

socialApp.get("/auth/meta/debug", async (c) => {
  try {
    const appId = Deno.env.get("META_APP_ID") ?? "";
    const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
    const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const callbackUrl = metaCallbackUrl();
    return c.json({
      meta_app_id_set: !!appId,
      meta_app_id_prefix: appId ? appId.substring(0, 6) + "..." : null,
      meta_app_id_length: appId.length,
      meta_app_secret_set: !!appSecret,
      meta_app_secret_length: appSecret.length,
      supabase_url_set: !!baseUrl,
      callback_url: callbackUrl,
      connect_url: `${baseUrl}/functions/v1/make-server-a8b2511f/social/auth/meta/connect`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── POST /media/upload — Upload media file to storage ──

socialApp.post("/media/upload", async (c) => {
  try {
    const user = await requireUser(c);
    await initBucket();

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return c.json({ error: "No file provided" }, 400);

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/quicktime", "video/webm"];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, GIF, WebP, MP4, MOV, WebM` }, 400);
    }

    const maxSize = file.type.startsWith("video/") ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: `File too large. Max: ${maxSize / (1024 * 1024)}MB` }, 400);
    }

    const ext = file.name.split(".").pop() || "bin";
    const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const supabase = getSupabase();
    const buffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: signedData } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

    if (!signedData?.signedUrl) throw new Error("Failed to generate signed URL");

    const mediaFile: MediaFile = {
      url: signedData.signedUrl,
      path: storagePath,
      mimeType: file.type,
      fileName: file.name,
      size: file.size,
    };

    console.log(`[SOCIAL] Media uploaded: ${file.name} (${(file.size / 1024).toFixed(1)}KB) for user ${user.id}`);
    return c.json({ mediaFile }, 201);
  } catch (err: any) {
    console.log(`[SOCIAL] Media upload error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── DELETE /media — Delete media file from storage ──

socialApp.delete("/media", async (c) => {
  try {
    const user = await requireUser(c);
    const { path: filePath } = await c.req.json();
    if (!filePath) return c.json({ error: "path is required" }, 400);
    if (!filePath.startsWith(`${user.id}/`)) return c.json({ error: "Unauthorized" }, 403);

    const supabase = getSupabase();
    await supabase.storage.from(MEDIA_BUCKET).remove([filePath]);
    return c.json({ ok: true });
  } catch (err: any) {
    console.log(`[SOCIAL] Media delete error: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── POST /posts — Create a new post ──

socialApp.post("/posts", async (c) => {
  try {
    const user = await requireUser(c);
    const body = await c.req.json();
    const { content, platforms, scheduledAt, mediaFiles } = body;

    if (!content?.trim() && (!mediaFiles || mediaFiles.length === 0)) {
      return c.json({ error: "Post content or media is required" }, 400);
    }
    if (!platforms?.length) return c.json({ error: "At least one platform is required" }, 400);

    const postId = crypto.randomUUID();
    const now = new Date().toISOString();
    const status: PostStatus = scheduledAt ? "scheduled" : "draft";

    const results: SocialPost["results"] = {} as any;
    for (const p of platforms) {
      results[p as Platform] = { status: "draft" };
    }

    const post: SocialPost = {
      id: postId,
      userId: user.id,
      content: (content || "").trim(),
      platforms,
      status,
      scheduledAt: scheduledAt || undefined,
      createdAt: now,
      updatedAt: now,
      mediaFiles: mediaFiles || undefined,
      results,
    };

    await kv.set(postKey(user.id, postId), JSON.stringify(post));

    if (scheduledAt) await addToScheduledIndex(user.id, postId, scheduledAt);

    return c.json({ post }, 201);
  } catch (err: any) {
    console.log(`[SOCIAL] Error creating post: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── GET /posts — List all posts ──

socialApp.get("/posts", async (c) => {
  try {
    const user = await requireUser(c);
    const posts = await getUserPosts(user.id);
    return c.json({ posts });
  } catch (err: any) {
    console.log(`[SOCIAL] Error listing posts: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── GET /posts/:postId — Get single post ──

socialApp.get("/posts/:postId", async (c) => {
  try {
    const user = await requireUser(c);
    const { postId } = c.req.param();
    const raw = await kv.get(postKey(user.id, postId));
    if (!raw) return c.json({ error: "Post not found" }, 404);
    return c.json({ post: JSON.parse(raw) });
  } catch (err: any) {
    console.log(`[SOCIAL] Error getting post: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── PUT /posts/:postId — Update a post ──

socialApp.put("/posts/:postId", async (c) => {
  try {
    const user = await requireUser(c);
    const { postId } = c.req.param();
    const raw = await kv.get(postKey(user.id, postId));
    if (!raw) return c.json({ error: "Post not found" }, 404);

    const post: SocialPost = JSON.parse(raw);
    if (post.status === "published" || post.status === "publishing") {
      return c.json({ error: "Cannot edit a published or publishing post" }, 400);
    }

    const body = await c.req.json();
    if (body.content !== undefined) post.content = body.content.trim();
    if (body.mediaFiles !== undefined) post.mediaFiles = body.mediaFiles || undefined;
    if (body.platforms !== undefined) {
      post.platforms = body.platforms;
      const newResults: SocialPost["results"] = {} as any;
      for (const p of body.platforms) {
        newResults[p as Platform] = post.results[p as Platform] || { status: "draft" };
      }
      post.results = newResults;
    }
    if (body.scheduledAt !== undefined) {
      const oldScheduled = post.scheduledAt;
      post.scheduledAt = body.scheduledAt || undefined;
      post.status = body.scheduledAt ? "scheduled" : "draft";
      if (oldScheduled && !body.scheduledAt) await removeFromScheduledIndex(user.id, postId);
      else if (body.scheduledAt) await addToScheduledIndex(user.id, postId, body.scheduledAt);
    }
    post.updatedAt = new Date().toISOString();

    await kv.set(postKey(user.id, postId), JSON.stringify(post));
    return c.json({ post });
  } catch (err: any) {
    console.log(`[SOCIAL] Error updating post: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── DELETE /posts/:postId — Delete a post ──

socialApp.delete("/posts/:postId", async (c) => {
  try {
    const user = await requireUser(c);
    const { postId } = c.req.param();
    await removeFromScheduledIndex(user.id, postId);
    await kv.del(postKey(user.id, postId));
    return c.json({ ok: true });
  } catch (err: any) {
    console.log(`[SOCIAL] Error deleting post: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── POST /posts/:postId/publish — Publish a post now ──

socialApp.post("/posts/:postId/publish", async (c) => {
  try {
    const user = await requireUser(c);
    const { postId } = c.req.param();
    const raw = await kv.get(postKey(user.id, postId));
    if (!raw) return c.json({ error: "Post not found" }, 404);

    const post: SocialPost = JSON.parse(raw);
    if (post.status === "published") {
      return c.json({ error: "Post is already published" }, 400);
    }

    post.status = "publishing";
    post.updatedAt = new Date().toISOString();
    await kv.set(postKey(user.id, postId), JSON.stringify(post));

    // Get all accounts for this user
    const accounts = await getUserAccounts(user.id);
    let allSucceeded = true;

    for (const platform of post.platforms) {
      const account = accounts.find((a) => a.platform === platform);
      if (!account) {
        post.results[platform] = { status: "failed", error: `No ${platform} account connected` };
        allSucceeded = false;
        continue;
      }

      try {
        const freshToken = await ensureFreshToken(account);
        const adapter = getAdapter(platform);
        // For LinkedIn org accounts, pass the full URN so publishPost uses urn:li:organization:
        let publishUserId = account.platformUserId;
        if (platform === "linkedin" && account.metadata?.accountType === "organization") {
          publishUserId = `urn:li:organization:${account.platformUserId}`;
        }
        const result = await adapter.publishPost(freshToken, publishUserId, post.content, post.mediaFiles);
        post.results[platform] = {
          status: "published",
          platformPostId: result.platformPostId,
          postUrl: result.postUrl,
          publishedAt: new Date().toISOString(),
        };
      } catch (pubErr: any) {
        console.log(`[SOCIAL] Failed to publish to ${platform}: ${pubErr.message}`);
        post.results[platform] = { status: "failed", error: pubErr.message };
        allSucceeded = false;
      }
    }

    post.status = allSucceeded ? "published" : "failed";
    if (allSucceeded) post.publishedAt = new Date().toISOString();
    post.updatedAt = new Date().toISOString();
    await kv.set(postKey(user.id, postId), JSON.stringify(post));

    return c.json({ post });
  } catch (err: any) {
    console.log(`[SOCIAL] Error publishing post: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ─── Scheduled Post Index ────────────────────────────────────────────
// A simple KV-based index for efficient cron processing

interface ScheduledRef { userId: string; postId: string; scheduledAt: string; }

async function getScheduledIndex(): Promise<ScheduledRef[]> {
  const raw = await kv.get("social_scheduled_index");
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function addToScheduledIndex(userId: string, postId: string, scheduledAt: string) {
  const index = await getScheduledIndex();
  const existing = index.findIndex(r => r.userId === userId && r.postId === postId);
  if (existing >= 0) index[existing] = { userId, postId, scheduledAt };
  else index.push({ userId, postId, scheduledAt });
  await kv.set("social_scheduled_index", JSON.stringify(index));
}

async function removeFromScheduledIndex(userId: string, postId: string) {
  const index = await getScheduledIndex();
  const filtered = index.filter(r => !(r.userId === userId && r.postId === postId));
  if (filtered.length !== index.length) {
    await kv.set("social_scheduled_index", JSON.stringify(filtered));
  }
}

// ─── Cron: Process Scheduled Posts ──���────────────────────────────────
// Called by cron-scheduler.tsx every 5 minutes

// ─── Engagement Sync Worker ──────────────────────────────────────────
// Tiered sync frequency:
//   < 24h old  → every 30 min
//   1-7d old   → every 3 hours
//   > 7d old   → every 24 hours

function getEngagementSyncInterval(publishedAt: string): number {
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 24) return 30 * 60 * 1000;        // 30 minutes
  if (hours < 24 * 7) return 3 * 60 * 60 * 1000; // 3 hours
  return 24 * 60 * 60 * 1000;                     // 24 hours
}

function shouldSyncEngagement(post: SocialPost, platform: Platform): boolean {
  const result = post.results[platform];
  if (!result || result.status !== "published" || !result.platformPostId) return false;
  const publishedAt = result.publishedAt || post.publishedAt;
  if (!publishedAt) return false;

  // Don't sync posts older than 90 days
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  if (ageMs > 90 * 24 * 60 * 60 * 1000) return false;

  const lastSync = result.engagement?.lastSyncedAt;
  if (!lastSync) return true; // never synced

  const interval = getEngagementSyncInterval(publishedAt);
  return Date.now() - new Date(lastSync).getTime() >= interval;
}

export async function syncAllEngagement(): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  // Scan all social posts across all users
  const allPostRaw = await kv.getByPrefix("social_post:");
  if (!allPostRaw || allPostRaw.length === 0) return { synced: 0, errors: 0 };

  const posts: SocialPost[] = [];
  for (const raw of allPostRaw) {
    try { posts.push(JSON.parse(raw)); } catch { continue; }
  }

  // Only process published posts
  const publishedPosts = posts.filter(p => p.status === "published");
  if (publishedPosts.length === 0) return { synced: 0, errors: 0 };

  console.log(`[SOCIAL-ENGAGE] Checking ${publishedPosts.length} published posts for engagement sync`);

  // Group posts by userId to batch account lookups
  const byUser = new Map<string, SocialPost[]>();
  for (const post of publishedPosts) {
    const arr = byUser.get(post.userId) || [];
    arr.push(post);
    byUser.set(post.userId, arr);
  }

  for (const [userId, userPosts] of byUser) {
    let accounts: SocialAccount[] | null = null;

    for (const post of userPosts) {
      let postUpdated = false;

      for (const platform of post.platforms) {
        if (!shouldSyncEngagement(post, platform)) continue;

        // Lazy-load accounts for this user
        if (!accounts) {
          try { accounts = await getUserAccounts(userId); } catch { accounts = []; }
        }

        const account = accounts.find(a => a.platform === platform);
        if (!account) continue;

        const adapter = getAdapter(platform);
        if (!adapter.getEngagement) continue;

        const result = post.results[platform];
        if (!result?.platformPostId) continue;

        try {
          const freshToken = await ensureFreshToken(account);
          const engagement = await adapter.getEngagement(freshToken, result.platformPostId, account.platformUserId);
          result.engagement = engagement;
          postUpdated = true;
          synced++;
        } catch (err: any) {
          console.log(`[SOCIAL-ENGAGE] Error syncing ${platform} engagement for post ${post.id}: ${err.message}`);
          errors++;
        }
      }

      if (postUpdated) {
        post.updatedAt = new Date().toISOString();
        await kv.set(postKey(post.userId, post.id), JSON.stringify(post));
      }
    }
  }

  if (synced > 0 || errors > 0) {
    console.log(`[SOCIAL-ENGAGE] Sync complete: ${synced} synced, ${errors} errors`);
  }
  return { synced, errors };
}

export async function processScheduledSocialPosts(): Promise<{ processed: number; published: number; failed: number }> {
  const now = Date.now();
  const index = await getScheduledIndex();
  const due = index.filter(r => new Date(r.scheduledAt).getTime() <= now);

  if (due.length === 0) return { processed: 0, published: 0, failed: 0 };

  console.log(`[SOCIAL-CRON] Processing ${due.length} due scheduled posts`);
  let published = 0;
  let failed = 0;

  for (const ref of due) {
    try {
      const raw = await kv.get(postKey(ref.userId, ref.postId));
      if (!raw) {
        await removeFromScheduledIndex(ref.userId, ref.postId);
        continue;
      }

      const post: SocialPost = JSON.parse(raw);
      if (post.status !== "scheduled") {
        await removeFromScheduledIndex(ref.userId, ref.postId);
        continue;
      }

      // Publish the post
      post.status = "publishing";
      post.updatedAt = new Date().toISOString();
      await kv.set(postKey(ref.userId, ref.postId), JSON.stringify(post));

      const accounts = await getUserAccounts(ref.userId);
      let allOk = true;

      for (const platform of post.platforms) {
        const account = accounts.find(a => a.platform === platform);
        if (!account) {
          post.results[platform] = { status: "failed", error: `No ${platform} account connected` };
          allOk = false;
          continue;
        }
        try {
          const token = await ensureFreshToken(account);
          const adapter = getAdapter(platform);
          let publishUserId = account.platformUserId;
          if (platform === "linkedin" && account.metadata?.accountType === "organization") {
            publishUserId = `urn:li:organization:${account.platformUserId}`;
          }
          const result = await adapter.publishPost(token, publishUserId, post.content, post.mediaFiles);
          post.results[platform] = { status: "published", platformPostId: result.platformPostId, postUrl: result.postUrl, publishedAt: new Date().toISOString() };
        } catch (pubErr: any) {
          console.log(`[SOCIAL-CRON] Failed ${platform} for post ${ref.postId}: ${pubErr.message}`);
          post.results[platform] = { status: "failed", error: pubErr.message };
          allOk = false;
        }
      }

      post.status = allOk ? "published" : "failed";
      if (allOk) post.publishedAt = new Date().toISOString();
      post.updatedAt = new Date().toISOString();
      await kv.set(postKey(ref.userId, ref.postId), JSON.stringify(post));
      await removeFromScheduledIndex(ref.userId, ref.postId);

      if (allOk) published++; else failed++;
      console.log(`[SOCIAL-CRON] Post ${ref.postId} → ${allOk ? "published" : "failed"}`);
    } catch (err: any) {
      console.log(`[SOCIAL-CRON] Error processing post ${ref.postId}: ${err.message}`);
      failed++;
    }
  }

  return { processed: due.length, published, failed };
}

// ── POST /sync-engagement — Trigger engagement sync for all user's published posts ──

socialApp.post("/sync-engagement", async (c) => {
  try {
    const user = await requireUser(c);
    console.log(`[SOCIAL-ENGAGE] sync-engagement called by user ${user.id}`);
    const posts = await getUserPosts(user.id);
    const published = posts.filter(p => p.status === "published");
    console.log(`[SOCIAL-ENGAGE] Found ${posts.length} total posts, ${published.length} published`);
    if (published.length === 0) return c.json({ synced: 0, errors: 0, posts: [] });

    const accounts = await getUserAccounts(user.id);
    console.log(`[SOCIAL-ENGAGE] Found ${accounts.length} connected accounts: ${accounts.map(a => `${a.platform}(${a.displayName})`).join(', ')}`);
    let synced = 0;
    let errors = 0;

    for (const post of published) {
      let postUpdated = false;
      for (const platform of post.platforms) {
        const result = post.results[platform];
        if (!result?.platformPostId || result.status !== "published") {
          console.log(`[SOCIAL-ENGAGE] Skipping ${platform} for post ${post.id}: platformPostId=${result?.platformPostId}, status=${result?.status}`);
          continue;
        }
        const account = accounts.find(a => a.platform === platform);
        if (!account) {
          console.log(`[SOCIAL-ENGAGE] No ${platform} account found for user — skipping post ${post.id}`);
          continue;
        }
        const adapter = getAdapter(platform);
        if (!adapter.getEngagement) {
          console.log(`[SOCIAL-ENGAGE] No getEngagement for ${platform} adapter — skipping`);
          continue;
        }
        console.log(`[SOCIAL-ENGAGE] Fetching ${platform} engagement for post ${post.id}, platformPostId=${result.platformPostId}`);

        try {
          const freshToken = await ensureFreshToken(account);
          const engagement = await adapter.getEngagement(freshToken, result.platformPostId, account.platformUserId);
          result.engagement = engagement;
          postUpdated = true;
          synced++;
        } catch (err: any) {
          console.log(`[SOCIAL-ENGAGE] Manual bulk sync error for ${platform} post ${post.id}: ${err.message}`);
          errors++;
        }
      }
      if (postUpdated) {
        post.updatedAt = new Date().toISOString();
        await kv.set(postKey(user.id, post.id), JSON.stringify(post));
      }
    }

    // Return refreshed posts so frontend doesn't need a second fetch
    const refreshedPosts = await getUserPosts(user.id);
    console.log(`[SOCIAL-ENGAGE] Manual bulk sync complete: synced=${synced}, errors=${errors}`);
    return c.json({ synced, errors, posts: refreshedPosts });
  } catch (err: any) {
    console.log(`[SOCIAL] Error in manual engagement sync: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── GET /posts/:postId/engagement — Force-sync and return engagement for a single post ──

socialApp.get("/posts/:postId/engagement", async (c) => {
  try {
    const user = await requireUser(c);
    const { postId } = c.req.param();
    const raw = await kv.get(postKey(user.id, postId));
    if (!raw) return c.json({ error: "Post not found" }, 404);

    const post: SocialPost = JSON.parse(raw);
    if (post.status !== "published") return c.json({ error: "Post is not published" }, 400);

    const accounts = await getUserAccounts(user.id);
    let updated = false;

    for (const platform of post.platforms) {
      const result = post.results[platform];
      if (!result?.platformPostId || result.status !== "published") continue;
      const account = accounts.find(a => a.platform === platform);
      if (!account) continue;
      const adapter = getAdapter(platform);
      if (!adapter.getEngagement) continue;

      try {
        const freshToken = await ensureFreshToken(account);
        const engagement = await adapter.getEngagement(freshToken, result.platformPostId, account.platformUserId);
        result.engagement = engagement;
        updated = true;
      } catch (err: any) {
        console.log(`[SOCIAL-ENGAGE] Manual sync error for ${platform}: ${err.message}`);
      }
    }

    if (updated) {
      post.updatedAt = new Date().toISOString();
      await kv.set(postKey(user.id, postId), JSON.stringify(post));
    }

    return c.json({ post });
  } catch (err: any) {
    console.log(`[SOCIAL] Error fetching engagement: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

// ── GET /analytics/engagement — Aggregate engagement analytics across all posts ──

socialApp.get("/analytics/engagement", async (c) => {
  try {
    const user = await requireUser(c);
    const posts = await getUserPosts(user.id);
    const published = posts.filter(p => p.status === "published");

    const totals: Record<Platform, EngagementMetrics & { postCount: number }> = {
      linkedin: { postCount: 0, impressions: 0, clicks: 0, likes: 0, comments: 0, shares: 0, lastSyncedAt: "" },
      facebook: { postCount: 0, impressions: 0, clicks: 0, likes: 0, comments: 0, shares: 0, reactions: 0, reach: 0, lastSyncedAt: "" },
      instagram: { postCount: 0, impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, lastSyncedAt: "" },
    };

    let totalImpressions = 0;
    let totalEngagements = 0;
    let totalPosts = 0;

    // Per-post engagement for timeline chart
    const timeline: { id: string; publishedAt: string; platforms: Platform[]; engagement: Record<string, EngagementMetrics> }[] = [];

    for (const post of published) {
      const postEngagement: Record<string, EngagementMetrics> = {};
      let hasAny = false;

      for (const platform of post.platforms) {
        const result = post.results[platform];
        if (!result?.engagement) continue;
        const e = result.engagement;
        hasAny = true;
        postEngagement[platform] = e;

        const t = totals[platform];
        t.postCount++;
        t.impressions = (t.impressions || 0) + (e.impressions || 0);
        t.clicks = (t.clicks || 0) + (e.clicks || 0);
        t.likes = (t.likes || 0) + (e.likes || 0);
        t.comments = (t.comments || 0) + (e.comments || 0);
        t.shares = (t.shares || 0) + (e.shares || 0);
        t.reactions = (t.reactions || 0) + (e.reactions || 0);
        t.reach = (t.reach || 0) + (e.reach || 0);
        t.saves = (t.saves || 0) + (e.saves || 0);

        totalImpressions += e.impressions || 0;
        totalEngagements += (e.likes || 0) + (e.comments || 0) + (e.shares || 0) + (e.saves || 0);
      }

      if (hasAny) {
        totalPosts++;
        timeline.push({
          id: post.id,
          publishedAt: post.publishedAt || post.updatedAt,
          platforms: post.platforms,
          engagement: postEngagement,
        });
      }
    }

    const engagementRate = totalImpressions > 0 ? ((totalEngagements / totalImpressions) * 100) : 0;

    return c.json({
      summary: {
        totalPosts,
        totalPublished: published.length,
        totalImpressions,
        totalEngagements,
        engagementRate: Math.round(engagementRate * 100) / 100,
      },
      platforms: totals,
      timeline: timeline.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()).slice(0, 50),
    });
  } catch (err: any) {
    console.log(`[SOCIAL] Error building analytics: ${err.message}`);
    return c.json({ error: err.message }, err.status || 500);
  }
});

export default socialApp;