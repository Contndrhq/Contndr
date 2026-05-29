// ─── Avatar Proxy with KV Caching + Supabase Storage ─────────────────
// Uses SerpAPI LinkedIn photo lookup as the PRIMARY avatar strategy.
// All approved avatars are cached to Supabase Storage (private bucket)
// and served via signed URLs — eliminates hotlink/expiry/CORS issues.
//
// Pipeline:
//   1. Check KV cache → if stored, return CDN URL + confidence
//   2. SerpAPI: Google web search for LinkedIn profile thumbnail
//   3. SerpAPI: Google Images search for LinkedIn headshot (fallback)
//   4. Download → validate (>=128px, image/*) → store in Supabase Storage
//
// Confidence scoring (returned to frontend):
//   linkedin_exact: 0.95, google_kp: 0.90, linkedin_cdn: 0.85,
//   name-only lookups are disabled for display safety; none: 0.00
//
// Endpoints:
//   POST /batch       — { emails, linkedin_urls?, names? } → { avatars, confidence, meta }
//   POST /refresh-all — authenticated; scans user leads and pre-caches
//   POST /backfill    — authenticated; re-processes null/broken/un-stored avatars
//   GET  /status      — health check

import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { fetchLinkedInPhoto, fetchHeadshotByName } from "./linkedin-avatar.tsx";
import { getSerpSearchKey } from "./serp-adapter.tsx";
import {
  ensureBucket,
  cacheExternalAvatar,
  getSignedUrl,
  getConfidenceScore,
  isSignedUrlValid,
} from "./avatar-storage.tsx";

const app = new Hono();

// ── Config ───────────────────────────────────────────────────────────
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for positive results
const NEGATIVE_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days for "no avatar"
const MAX_BATCH_SIZE = 200;
const LINKEDIN_CONCURRENCY = 5;
const MAX_LINKEDIN_PER_BATCH = 10;
const MAX_NAME_LOOKUPS_PER_BATCH = 5;
const CACHE_VERSION = 9; // Bump: disable unsafe name-only avatar matches

// ── Helpers ──────────────────────────────────────────────────────────

async function sha256(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface CachedAvatar {
  url: string | null;           // Original external source URL
  email: string;
  fetched_at: string;
  version?: number;
  source?: string;              // e.g. 'serpapi_linkedin', 'serpapi_name', 'none'
  avatar_confidence?: number;   // 0.0 - 1.0
  last_checked?: string;        // When we last validated the image
  storage_path?: string | null; // Path in Supabase Storage bucket
  cdn_url?: string | null;      // Current signed URL (our CDN)
  cdn_url_expires?: string | null;
}

function isCacheValid(entry: CachedAvatar | null): boolean {
  if (!entry || !entry.fetched_at) return false;
  if ((entry.version || 0) < CACHE_VERSION) return false;
  const age = Date.now() - new Date(entry.fetched_at).getTime();
  const ttl = entry.url ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  return age < ttl;
}

/**
 * Get the best URL to return for a cached avatar.
 * Prefers CDN URL (our storage) over external URL.
 * If CDN URL expired, regenerates it.
 */
async function resolveAvatarUrl(entry: CachedAvatar): Promise<string | null> {
  if (!entry.url && !entry.storage_path) return null;

  // If we have a stored copy, prefer the CDN URL
  if (entry.storage_path) {
    if (entry.cdn_url && isSignedUrlValid(entry.cdn_url_expires)) {
      return entry.cdn_url;
    }
    // Regenerate signed URL
    const signed = await getSignedUrl(entry.storage_path);
    if (signed) {
      // Update cache with new signed URL
      const kvKey = `gravatar:avatar:${await sha256(entry.email)}`;
      entry.cdn_url = signed.url;
      entry.cdn_url_expires = signed.expires;
      try { await kv.set(kvKey, entry); } catch {}
      return signed.url;
    }
  }

  // Fallback to external URL (legacy or storage failed)
  return entry.url;
}

// ── Storage pipeline helper ──────────────────────────────────────────
// Downloads an external avatar URL, validates, stores in Supabase Storage,
// and updates the KV cache entry with storage metadata.

async function storeAndCacheAvatar(
  email: string,
  hash: string,
  externalUrl: string,
  source: string,
): Promise<CachedAvatar> {
  const confidence = getConfidenceScore(source);
  const now = new Date().toISOString();

  const entry: CachedAvatar = {
    url: externalUrl || null,
    email,
    fetched_at: now,
    version: CACHE_VERSION,
    source,
    avatar_confidence: confidence,
    last_checked: now,
    storage_path: null,
    cdn_url: null,
    cdn_url_expires: null,
  };

  // Try to cache in our storage
  if (externalUrl) {
    try {
      const stored = await cacheExternalAvatar(hash, externalUrl);
      if (stored) {
        entry.storage_path = stored.storagePath;
        entry.cdn_url = stored.cdnUrl;
        entry.cdn_url_expires = stored.cdnUrlExpires;
        console.log(`[AVATAR] Stored in CDN: ${email} (${stored.dimensions.width}x${stored.dimensions.height})`);
      } else {
        console.log(`[AVATAR] Storage validation failed for ${email}, keeping external URL`);
        // Image failed validation — lower confidence
        entry.avatar_confidence = Math.min(confidence, 0.40);
      }
    } catch (err: any) {
      console.log(`[AVATAR] Storage error for ${email}: ${err.message}`);
    }
  }

  try { await kv.set(`gravatar:avatar:${hash}`, entry); } catch {}
  return entry;
}

// ── LinkedIn batch processing ────────────────────────────────────────

async function processLinkedInBatch(
  candidates: { email: string; hash: string }[],
  linkedinUrlMap: Record<string, string>,
  serpApiKey: string,
  namesMap: Record<string, string> = {},
): Promise<{ found: number; failed: number; results: Record<string, CachedAvatar> }> {
  let found = 0;
  let failed = 0;
  const results: Record<string, CachedAvatar> = {};

  for (let i = 0; i < candidates.length; i += LINKEDIN_CONCURRENCY) {
    const chunk = candidates.slice(i, i + LINKEDIN_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async ({ email, hash }) => {
        const liUrl = linkedinUrlMap[email];
        const name = namesMap[email] || undefined;
        console.log(`[AVATAR] SerpAPI lookup: ${email} -> ${liUrl?.slice(0, 60)}${name ? ` (name: ${name})` : ""}`);

        const photoUrl = await fetchLinkedInPhoto(liUrl, serpApiKey, false, name);
        const source = photoUrl ? "serpapi_linkedin" : "none";

        const entry = await storeAndCacheAvatar(email, hash, photoUrl || "", source);
        results[email] = entry;

        if (photoUrl) {
          found++;
          console.log(`[AVATAR] SUCCESS: ${email} -> ${(entry.cdn_url || photoUrl).slice(0, 100)}`);
        } else {
          console.log(`[AVATAR] No photo found: ${email}`);
        }
      }),
    );

    for (const s of settled) {
      if (s.status === "rejected") {
        failed++;
        console.log("[AVATAR] SerpAPI chunk error:", s.reason?.message);
      }
    }
  }

  return { found, failed, results };
}

// ── POST /batch ──────────────────────────────────────────────────────

app.post("/batch", async (c) => {
  try {
    const body = await c.req.json();
    const emails: string[] = body?.emails;
    const linkedinUrlMap: Record<string, string> = body?.linkedin_urls || {};
    const namesMap: Record<string, string> = body?.names || {};

    console.log(`[AVATAR] Batch request: ${emails?.length || 0} emails, ${Object.keys(linkedinUrlMap).length} linkedin URLs, ${Object.keys(namesMap).length} names`);

    if (!Array.isArray(emails) || emails.length === 0) {
      return c.json({ avatars: {}, confidence: {} });
    }

    // Ensure storage bucket exists
    await ensureBucket();

    const serpApiKey = getSerpSearchKey() || "";

    // Normalise & deduplicate. Accept either real emails or synthetic
    // `linkedin:<slug>` cache keys — the latter are used by the frontend
    // when a lead has no email yet but does have a LinkedIn URL. Either
    // form ends up flowing through the same KV cache (keyed on its sha256).
    const seen = new Set<string>();
    const emailsToProcess: string[] = [];
    for (const raw of emails) {
      if (!raw || typeof raw !== "string") continue;
      const norm = raw.trim().toLowerCase();
      if (!norm || norm.length < 3) continue;
      const isEmail = norm.includes("@");
      const isLinkedinKey = norm.startsWith("linkedin:") && (linkedinUrlMap[norm] || namesMap[norm]);
      if (!isEmail && !isLinkedinKey) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      emailsToProcess.push(norm);
      if (emailsToProcess.length >= MAX_BATCH_SIZE) break;
    }

    if (emailsToProcess.length === 0) {
      return c.json({ avatars: {}, confidence: {} });
    }

    // Pre-compute hashes
    const pairs = await Promise.all(
      emailsToProcess.map(async (email) => ({
        email,
        hash: await sha256(email),
      })),
    );

    const avatarResults: Record<string, string | null> = {};
    const confidenceResults: Record<string, number> = {};
    const uncached: { email: string; hash: string }[] = [];

    // ── Check KV cache ───────────────────────────────────────────────
    const cacheChecks = await Promise.all(
      pairs.map(async ({ email, hash }) => {
        try {
          const cached = (await kv.get(
            `gravatar:avatar:${hash}`,
          )) as CachedAvatar | null;
          return { email, hash, cached };
        } catch {
          return { email, hash, cached: null };
        }
      }),
    );

    for (const { email, hash, cached } of cacheChecks) {
      if (cached && isCacheValid(cached)) {
        const url = await resolveAvatarUrl(cached);
        avatarResults[email] = url;
        confidenceResults[email] = cached.avatar_confidence ?? getConfidenceScore(cached.source || "none");
      } else {
        uncached.push({ email, hash });
      }
    }

    // ── SerpAPI lookups for uncached emails ──────────────────────────
    let linkedinPending = 0;

    if (serpApiKey && uncached.length > 0) {
      const withLinkedin: { email: string; hash: string }[] = [];
      const withoutLinkedin: { email: string; hash: string }[] = [];

      for (const item of uncached) {
        const liUrl = linkedinUrlMap[item.email];
        if (liUrl && typeof liUrl === "string" && liUrl.includes("linkedin.com/")) {
          withLinkedin.push(item);
        } else {
          withoutLinkedin.push(item);
        }
      }

      const withNameNoLinkedin = withoutLinkedin.filter(({ email }) => {
        const name = namesMap[email];
        return name && name.trim().length >= 3;
      });
      const noNameNoLinkedin = withoutLinkedin.filter(({ email }) => {
        const name = namesMap[email];
        return !name || name.trim().length < 3;
      });

      // Cache null for emails with no LinkedIn URL AND no name
      for (const { email, hash } of noNameNoLinkedin) {
        avatarResults[email] = null;
        confidenceResults[email] = 0;
        const entry: CachedAvatar = {
          url: null, email,
          fetched_at: new Date().toISOString(),
          version: CACHE_VERSION,
          source: "no_linkedin_no_name",
          avatar_confidence: 0,
          last_checked: new Date().toISOString(),
        };
        try { await kv.set(`gravatar:avatar:${hash}`, entry); } catch {}
      }

      // ── LinkedIn lookups ─────────────────────────────────────────
      const linkedinCandidates = withLinkedin.slice(0, MAX_LINKEDIN_PER_BATCH);
      if (linkedinCandidates.length > 0) {
        console.log(`[AVATAR] SYNC: ${linkedinCandidates.length} LinkedIn lookups (of ${withLinkedin.length} total)`);
        const { found, results: batchResults } = await processLinkedInBatch(
          linkedinCandidates, linkedinUrlMap, serpApiKey, namesMap,
        );
        console.log(`[AVATAR] SYNC LinkedIn done: ${found} found of ${linkedinCandidates.length}`);

        for (const { email } of linkedinCandidates) {
          const entry = batchResults[email];
          if (entry) {
            avatarResults[email] = entry.cdn_url || entry.url || null;
            confidenceResults[email] = entry.avatar_confidence ?? 0;
          } else {
            avatarResults[email] = null;
            confidenceResults[email] = 0;
          }
        }
      }
      linkedinPending += Math.max(0, withLinkedin.length - MAX_LINKEDIN_PER_BATCH);

      // ── Name-only headshot lookups disabled ───────────────────────
      const nameCandidates = withNameNoLinkedin.slice(0, MAX_NAME_LOOKUPS_PER_BATCH);
      if (nameCandidates.length > 0) {
        console.log(`[AVATAR] Skipping ${nameCandidates.length} name-only avatar lookups to avoid false matches`);
        for (const { email, hash } of nameCandidates) {
          const entry = await storeAndCacheAvatar(email, hash, "", "no_linkedin_no_name");
          avatarResults[email] = null;
          confidenceResults[email] = entry.avatar_confidence ?? 0;
        }
      }
      linkedinPending += Math.max(0, withNameNoLinkedin.length - MAX_NAME_LOOKUPS_PER_BATCH);

    } else if (!serpApiKey) {
      console.log("[AVATAR] SERPER_API_KEY not configured - caching null for all");
      for (const { email, hash } of uncached) {
        avatarResults[email] = null;
        confidenceResults[email] = 0;
        const entry: CachedAvatar = {
          url: null, email,
          fetched_at: new Date().toISOString(),
          version: CACHE_VERSION,
          source: "no_api_key",
          avatar_confidence: 0,
          last_checked: new Date().toISOString(),
        };
        try { await kv.set(`gravatar:avatar:${hash}`, entry); } catch {}
      }
    }

    return c.json({
      avatars: avatarResults,
      confidence: confidenceResults,
      meta: {
        requested: emailsToProcess.length,
        cached: emailsToProcess.length - uncached.length,
        uncached: uncached.length,
        linkedin_pending: linkedinPending,
      },
    });
  } catch (err: any) {
    console.log("[AVATAR] Batch lookup error:", err.message);
    return c.json({ error: `Avatar batch lookup failed: ${err.message}` }, 500);
  }
});

// ── GET /status ──────────────────────────────────────────────────────
app.get("/status", (c) => {
  const hasSerpApi = !!getSerpSearchKey();
  return c.json({
    ok: true,
    strategy: "serpapi_linkedin + supabase_storage",
    serpApiConfigured: hasSerpApi,
    cacheVersion: CACHE_VERSION,
  });
});

// ── Auth helper ──────────────────────────────────────────────────────

async function getAuthUser(c: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) throw new Error("No Authorization header");
  const token = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "GRAVATAR");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── POST /refresh-all ────────────────────────────────────────────────

const REFRESH_BATCH_SIZE = 100;

app.post("/refresh-all", async (c) => {
  try {
    let user: any;
    let supabase: any;
    try {
      const auth = await getAuthUser(c);
      user = auth.user;
      supabase = auth.supabase;
    } catch (authErr: any) {
      console.log("[AVATAR] refresh-all auth error:", authErr.message);
      return c.json({ error: `Authentication failed: ${authErr.message}` }, 401);
    }

    const userId = user.id;
    const userEmail = user.email || "unknown";
    const serpApiKey = getSerpSearchKey() || "";
    if (!serpApiKey) {
      return c.json({ error: "SERPER_API_KEY not configured" }, 500);
    }

    await ensureBucket();

    const body = await c.req.json().catch(() => ({}));
    const offset = Math.max(0, Number(body.offset) || 0);
    const batchSize = Math.min(500, Math.max(50, Number(body.batchSize) || REFRESH_BATCH_SIZE));

    const { count: totalLeads } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("email", "is", null);

    console.log(`[AVATAR] refresh-all: user=${userEmail} offset=${offset} batchSize=${batchSize} total=${totalLeads}`);

    const { data: batch, error: dbErr } = await supabase
      .from("leads")
      .select("email, person_linkedin_url, linkedin, first_name, last_name, business_name")
      .eq("user_id", userId)
      .not("email", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (dbErr) {
      console.log("[AVATAR] refresh-all DB error:", dbErr.message);
      return c.json({ error: `Database error: ${dbErr.message}` }, 500);
    }

    const fetchedRows = batch?.length || 0;
    const done = fetchedRows < batchSize;
    const nextOffset = done ? null : offset + batchSize;

    const emailSet = new Set<string>();
    const emailLinkedInMap: Record<string, string> = {};
    const emailNamesMap: Record<string, string> = {};
    for (const row of batch || []) {
      if (row.email && typeof row.email === "string") {
        const norm = row.email.trim().toLowerCase();
        if (norm.length >= 3 && norm.includes("@")) {
          emailSet.add(norm);
          const liUrl = row.person_linkedin_url || row.linkedin || "";
          if (liUrl && liUrl.includes("linkedin.com/")) {
            emailLinkedInMap[norm] = liUrl;
          }
          const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
          if (fullName.length >= 3) emailNamesMap[norm] = fullName;
        }
      }
    }

    const emails = Array.from(emailSet);
    if (emails.length === 0) {
      return c.json({
        success: true, done, nextOffset,
        totalLeads: totalLeads || 0,
        stats: { processed: fetchedRows, uniqueEmails: 0, alreadyCached: 0, fetched: 0, found: 0, stored: 0 },
      });
    }

    const pairs = await Promise.all(
      emails.map(async (email) => ({ email, hash: await sha256(email) })),
    );

    let alreadyCached = 0;
    const uncached: { email: string; hash: string }[] = [];

    const cacheChecks = await Promise.all(
      pairs.map(async ({ email, hash }) => {
        try {
          const cached = (await kv.get(`gravatar:avatar:${hash}`)) as CachedAvatar | null;
          return { email, hash, cached };
        } catch {
          return { email, hash, cached: null };
        }
      }),
    );

    for (const { email, hash, cached } of cacheChecks) {
      if (cached && isCacheValid(cached)) {
        alreadyCached++;
      } else {
        uncached.push({ email, hash });
      }
    }

    let linkedinFound = 0;
    let stored = 0;
    let fetched = 0;

    const linkedinCandidates = uncached.filter(({ email }) => !!emailLinkedInMap[email]);
    const noLinkedin = uncached.filter(({ email }) => !emailLinkedInMap[email]);

    // Process leads without LinkedIn URLs
    const withNames = noLinkedin.filter(({ email }) => emailNamesMap[email]?.length >= 3);
    const noNames = noLinkedin.filter(({ email }) => !emailNamesMap[email] || emailNamesMap[email].length < 3);

    for (const { email, hash } of noNames) {
      await storeAndCacheAvatar(email, hash, "", "no_linkedin_no_name");
      fetched++;
    }

    // Name-only lookups are disabled. Wrong-person photos are worse than initials.
    for (const { email, hash } of withNames.slice(0, MAX_NAME_LOOKUPS_PER_BATCH)) {
      await storeAndCacheAvatar(email, hash, "", "no_linkedin_no_name");
      fetched++;
    }

    // LinkedIn lookups
    if (linkedinCandidates.length > 0) {
      console.log(`[AVATAR] refresh-all: ${linkedinCandidates.length} LinkedIn lookups`);
      const { found, results } = await processLinkedInBatch(
        linkedinCandidates, emailLinkedInMap, serpApiKey, emailNamesMap,
      );
      linkedinFound += found;
      fetched += linkedinCandidates.length;
      for (const entry of Object.values(results)) {
        if (entry.storage_path) stored++;
      }
    }

    console.log(
      `[AVATAR] refresh-all done: offset=${offset} emails=${emails.length} cached=${alreadyCached} fetched=${fetched} found=${linkedinFound} stored=${stored} done=${done}`,
    );

    return c.json({
      success: true, done, nextOffset,
      totalLeads: totalLeads || 0,
      stats: {
        processed: fetchedRows,
        uniqueEmails: emails.length,
        alreadyCached,
        fetched,
        found: linkedinFound,
        stored,
      },
    });
  } catch (err: any) {
    console.log("[AVATAR] refresh-all error:", err.message, err.stack);
    return c.json({ error: `Refresh failed: ${err.message}` }, 500);
  }
});

// ── POST /backfill ───────────────────────────────────────────────────
// Re-processes avatars that are: null, broken (no storage_path),
// low-confidence, or from an old cache version. Authenticated.
// Body: { offset?: number, batchSize?: number, force?: boolean }

const BACKFILL_BATCH_SIZE = 100;
const BACKFILL_CONFIDENCE_THRESHOLD = 0.5;

app.post("/backfill", async (c) => {
  try {
    let user: any;
    let supabase: any;
    try {
      const auth = await getAuthUser(c);
      user = auth.user;
      supabase = auth.supabase;
    } catch (authErr: any) {
      return c.json({ error: `Authentication failed: ${authErr.message}` }, 401);
    }

    const userId = user.id;
    const serpApiKey = getSerpSearchKey() || "";
    if (!serpApiKey) {
      return c.json({ error: "SERPER_API_KEY not configured" }, 500);
    }

    await ensureBucket();

    const body = await c.req.json().catch(() => ({}));
    const offset = Math.max(0, Number(body.offset) || 0);
    const batchSize = Math.min(200, Math.max(20, Number(body.batchSize) || BACKFILL_BATCH_SIZE));
    const force = !!body.force; // Force re-process even if cache is valid

    // Fetch leads with email + linkedin
    const { data: batch, error: dbErr } = await supabase
      .from("leads")
      .select("email, person_linkedin_url, linkedin, first_name, last_name, business_name")
      .eq("user_id", userId)
      .not("email", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (dbErr) {
      return c.json({ error: `Database error: ${dbErr.message}` }, 500);
    }

    const fetchedRows = batch?.length || 0;
    const done = fetchedRows < batchSize;
    const nextOffset = done ? null : offset + batchSize;

    let reprocessed = 0;
    let improved = 0;
    let stored = 0;
    let skipped = 0;

    for (const row of batch || []) {
      if (!row.email) continue;
      const email = row.email.trim().toLowerCase();
      if (!email.includes("@")) continue;

      const hash = await sha256(email);
      const kvKey = `gravatar:avatar:${hash}`;

      // Check existing cache entry
      let cached: CachedAvatar | null = null;
      try { cached = await kv.get(kvKey) as CachedAvatar | null; } catch {}

      // Determine if this entry needs backfill
      const needsBackfill = force
        || !cached
        || (cached.version || 0) < CACHE_VERSION
        || (!cached.url && !cached.storage_path)          // null avatar
        || (cached.url && !cached.storage_path)            // has external URL but not stored
        || ((cached.avatar_confidence || 0) < BACKFILL_CONFIDENCE_THRESHOLD && cached.source !== "no_linkedin_no_name");

      if (!needsBackfill) {
        skipped++;
        continue;
      }

      reprocessed++;

      // If there's an existing external URL but no storage, try to store it
      if (cached?.url && !cached.storage_path) {
        const result = await cacheExternalAvatar(hash, cached.url);
        if (result) {
          cached.storage_path = result.storagePath;
          cached.cdn_url = result.cdnUrl;
          cached.cdn_url_expires = result.cdnUrlExpires;
          cached.last_checked = new Date().toISOString();
          cached.version = CACHE_VERSION;
          cached.avatar_confidence = cached.avatar_confidence || getConfidenceScore(cached.source || "none");
          try { await kv.set(kvKey, cached); } catch {}
          stored++;
          improved++;
          continue;
        }
      }

      // Re-run the full pipeline
      const liUrl = row.person_linkedin_url || row.linkedin || "";
      const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();

      if (liUrl && liUrl.includes("linkedin.com/")) {
        const photoUrl = await fetchLinkedInPhoto(liUrl, serpApiKey, true, fullName || undefined);
        const entry = await storeAndCacheAvatar(email, hash, photoUrl || "", photoUrl ? "serpapi_linkedin" : "none");
        if (entry.storage_path) stored++;
        if (photoUrl) improved++;
      } else if (fullName.length >= 3) {
        await storeAndCacheAvatar(email, hash, "", "no_linkedin_no_name");
      } else {
        // No linkedin, no name — just mark as checked
        const entry: CachedAvatar = {
          url: null, email,
          fetched_at: new Date().toISOString(),
          version: CACHE_VERSION,
          source: "no_linkedin_no_name",
          avatar_confidence: 0,
          last_checked: new Date().toISOString(),
        };
        try { await kv.set(kvKey, entry); } catch {}
      }
    }

    console.log(
      `[AVATAR] Backfill done: offset=${offset} rows=${fetchedRows} reprocessed=${reprocessed} improved=${improved} stored=${stored} skipped=${skipped}`,
    );

    return c.json({
      success: true, done, nextOffset,
      stats: {
        processed: fetchedRows,
        reprocessed,
        improved,
        stored,
        skipped,
      },
    });
  } catch (err: any) {
    console.log("[AVATAR] Backfill error:", err.message, err.stack);
    return c.json({ error: `Backfill failed: ${err.message}` }, 500);
  }
});

export default app;
