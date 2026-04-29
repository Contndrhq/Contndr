// ══════════════════════════════════════════════════════════════════════════
// Apollo.io Native API Integration for Contndr
// Direct REST API access for massive-scale lead discovery (up to 1M+)
// Supports: People Search, Company Search, Enrichment, Bulk Operations
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { getTeamMemberIds } from "./team.tsx";
import { getUserSubscriptionStatus } from "./contndr-billing.tsx";
import { verifyEmailBatch, checkMxRecords, type EmailVerification } from "./email-verify.tsx";
import { searchPool, saveToPool, getPoolStats, hydrateLeadsFromExistingContacts, type PoolLead, type SearchCriteria } from "./lead-pool.tsx";
import { getLeadLimitForPlan } from "./plan-entitlements.ts";

async function checkLeadLimitApollo(user: any, supabase: any, additionalCount: number) {
  const sub = await getUserSubscriptionStatus(user);
  const plan = sub?.plan || 'none';
  const limit = getLeadLimitForPlan(plan);
  const { count, error } = await supabase
    .from('leads')
    .select('*', { count: 'estimated', head: true })
    .eq('user_id', user.id);
  const currentCount = error ? 0 : (count || 0);
  const allowed = limit === -1 || (currentCount + additionalCount) <= limit;
  return { allowed, currentCount, limit, plan, remaining: limit === -1 ? -1 : Math.max(0, limit - currentCount) };
}

const app = new Hono();
app.use("*", cors());

// ── Title Case utility (inline for Deno server) ──
const SMALL_WORDS = new Set(['a','an','and','as','at','but','by','for','if','in','nor','of','on','or','so','the','to','up','yet','via']);
const UPPER_WORDS = new Set(['llc','inc','co','usa','uk','uae','eu','nyc','la','dc','it','ai','hr','pr','crm','saas','b2b','b2c','seo','api','iot','ceo','cfo','cto']);

export function toTitleCase(str: string | null | undefined): string {
  if (!str || typeof str !== 'string') return '';
  if (str === str.toUpperCase() && str.length <= 5) return str;
  return str.toLowerCase().split(/(\s+|-|\/|&)/).map((word, index) => {
    if (/^(\s+|-|\/|&)$/.test(word)) return word;
    const lower = word.toLowerCase();
    if (UPPER_WORDS.has(lower)) return word.toUpperCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join('');
}

// ── CRM-level name/company cleaners: reject LinkedIn headlines, taglines, job titles ──
function cleanCrmCompanyName(raw: string): string {
  if (!raw) return "";
  let c = raw.trim();
  // ── "Company. Company Location" duplicate pattern ──
  const dotParts = c.split(/\.\s+/);
  if (dotParts.length >= 2) {
    const first = dotParts[0].trim();
    const second = dotParts.slice(1).join(". ").trim();
    if (first.length >= 3 && second.toLowerCase().startsWith(first.toLowerCase())) {
      c = first;
    }
  }
  // ── Pipe-separated LinkedIn taglines (3+ segments) ──
  const pipeParts = c.split(/\s*\|\s*/);
  if (pipeParts.length >= 3) {
    const TITLE_KW = /\b(founder|ceo|cto|cfo|coo|cmo|director|manager|head|vp|president|board|member|partner|lead|chief|officer|consultant|advisor|coach|owner|principal)\b/i;
    if (pipeParts.some(p => TITLE_KW.test(p))) return "";
    if (pipeParts.length >= 4) return "";
  }
  // ── "Company and CEO/Title" mixed pattern ──
  const titleSuffix = c.match(/^(.+?)\s+and\s+(CEO|CTO|CFO|COO|CMO|Founder|Co-?Founder|President|Director|VP|SVP|EVP|Partner|Owner|Board\s+Member|Chairman)\b/i);
  if (titleSuffix) {
    c = titleSuffix[1].trim();
  }
  // Truncate at comma if followed by sentence-like fragment
  c = c.replace(/,\s+(?:My |I |We |Our |Your |A |The |An |Helping |Passionate |Dedicated |Experienced |Building |Creating |Empowering |Enabling |Transforming |Committed |Focused |Specializ|Leverag|Proven |Award|Driving |Working |Looking |Seeking |Striving |Results).*/i, "").trim();
  // Reject LinkedIn headline patterns
  const HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+\s+in|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work|build|create|specialize|consult)|we\s+(?:help|are|build|create|provide|deliver|offer|specialize)|my\s+(?:goal|mission|passion|focus|expertise))/i;
  if (HEADLINE.test(c)) return "";
  // Reject pure job titles as company names
  const PURE_TITLE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|director|manager|head|lead|chief|founder|co-?founder|owner|partner|president|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelanc\w+|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|developer|designer|recruiter|marketer|sales\w*|business\s+development)(\s+(of|at|for|in|&|and|\/)\s+.*)?$/i;
  if (PURE_TITLE.test(c)) return "";
  // Reject sentence-verb patterns in >3-word strings
  if (/\b(helping|empowering|enabling|transforming|building|creating|delivering|providing|growing|driving|solving|improving|supporting|managing|developing|seeking|looking|striving|committed|passionate|dedicated|experienced)\b/i.test(c) && c.split(/\s+/).length > 3) return "";
  // Reject pronoun-heavy strings
  if (/\b(my goal|i help|i am|we help|we are|our mission|your|they|them|their)\b/i.test(c) && c.split(/\s+/).length > 2) return "";
  // Reject overly long names (>7 words)
  if (c.split(/\s+/).length > 7) return "";
  // Cap at 60 chars
  if (c.length > 60) c = c.substring(0, 60).replace(/\s+\S*$/, "").trim();
  return c;
}

function cleanCrmContactName(raw: string): string {
  if (!raw) return "";
  let n = raw.trim();
  // Strip credential suffixes
  n = n.replace(/\s+(?:MBA|PhD|MD|CPA|PMP|SHRM|CSM|CFA|PE|RN|CISSP|CISM|CCNA|TOGAF|ITIL|SPHR|PHR|CFP|ACCA).*$/i, "").trim();
  // Strip parentheticals: "(He/Him)", "(LION)", "(Open to Work)"
  n = n.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  // Strip hashtags
  n = n.replace(/\s*#\S+/g, "").trim();
  // Strip trailing commas/colons
  n = n.replace(/[,;:]+$/, "").trim();
  // Reject sentence-like contact names (LinkedIn headlines used as names)
  const HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work)|we\s+(?:help|are|build)|my\s+(?:goal|mission))/i;
  if (HEADLINE.test(n)) return "";
  // Reject if >5 words (names are short)
  if (n.split(/\s+/).length > 5) return "";
  // Collapse whitespace
  n = n.replace(/\s{2,}/g, " ");
  return n;
}

// ── Constants ──────────────────────────────────────────────────────────
const APOLLO_BASE = "https://api.apollo.io/api/v1";
const MAX_PER_PAGE = 100;
const MAX_PAGES_PER_REQUEST = 100; // Apollo limit
const RATE_LIMIT_DELAY_MS = 700; // ~85 req/min to stay within limits
const RETRY_MAX = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 25000; // 25s timeout per Apollo API call

// ── People search endpoint ──
// Apollo now requires /mixed_people/api_search for API callers
// (the old /people/search is deprecated)
const PEOPLE_ENDPOINT = "/mixed_people/api_search";

// ── Seniority options (Apollo's internal values) ──
export const SENIORITY_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "founder", label: "Founder" },
  { value: "c_suite", label: "C-Suite" },
  { value: "partner", label: "Partner" },
  { value: "vp", label: "VP" },
  { value: "head", label: "Head" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "senior", label: "Senior" },
  { value: "entry", label: "Entry" },
];

export const EMPLOYEE_RANGE_OPTIONS = [
  { value: "1,10", label: "1-10" },
  { value: "11,20", label: "11-20" },
  { value: "21,50", label: "21-50" },
  { value: "51,100", label: "51-100" },
  { value: "101,200", label: "101-200" },
  { value: "201,500", label: "201-500" },
  { value: "501,1000", label: "501-1K" },
  { value: "1001,2000", label: "1K-2K" },
  { value: "2001,5000", label: "2K-5K" },
  { value: "5001,10000", label: "5K-10K" },
  { value: "10001,", label: "10K+" },
];

// ── Auth helper ──
async function getAuthenticatedUser(c: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) throw new Error("No Authorization header");
  const token = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "APOLLO");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

function getApolloApiKey(): string {
  const key = Deno.env.get("APOLLO_API_KEY");
  if (!key) throw new Error("APOLLO_API_KEY not configured");
  return key;
}

// ── Rate-limited fetch with retry ──
async function apolloFetch(
  endpoint: string,
  body: Record<string, any>,
  retries = RETRY_MAX
): Promise<any> {
  const apiKey = getApolloApiKey();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const requestBody = JSON.stringify(body);
      // Only log full details on first attempt or for non-reveal calls to avoid log spam
      const isReveal = endpoint === "/people/match";
      if (!isReveal || attempt === 0) {
        console.log(`[APOLLO] Fetching ${APOLLO_BASE}${endpoint} (attempt ${attempt + 1})`);
        if (!isReveal) {
          console.log(`[APOLLO] Request body: ${requestBody}`);
          console.log(`[APOLLO] API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)} (${apiKey.length} chars)`);
        }
      }
      
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);
      
      let response: Response;
      try {
        response = await fetch(`${APOLLO_BASE}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Api-Key": apiKey,
          },
          body: requestBody,
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      
      console.log(`[APOLLO] Response status: ${response.status} ${response.statusText}`);

      if (response.status === 429) {
        // Rate limited — wait and retry
        const waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.warn(
          `[APOLLO] Rate limited, waiting ${waitMs}ms (attempt ${attempt + 1}/${retries + 1})`
        );
        await sleep(waitMs);
        continue;
      }

      if (response.status === 422) {
        const errorBody = await response.text();
        console.warn(`[APOLLO] 422 Unprocessable: ${errorBody}`);
        // Detect credit exhaustion specifically
        const isCreditsExhausted = errorBody.toLowerCase().includes('insufficient credits');
        if (isCreditsExhausted) {
          return { error: "credits_exhausted", message: "Apollo API credits exhausted. Upgrade your Apollo plan or wait for credits to reset.", details: errorBody };
        }
        return { error: "Invalid search parameters", details: errorBody };
      }

      // 400 = bad request — do NOT retry (e.g. missing webhook_url for phone reveals)
      if (response.status === 400) {
        const errorBody = await response.text();
        console.warn(`[APOLLO] 400 Bad Request on ${endpoint}: ${errorBody}`);
        return { error: "bad_request", message: errorBody, details: errorBody };
      }

      // 401/403 = permanent auth/permissions error — do NOT retry
      if (response.status === 401 || response.status === 403) {
        const errorBody = await response.text();
        let parsed: any = {};
        try { parsed = JSON.parse(errorBody); } catch (_) {}
        const code = parsed.error_code || "";
        const msg = parsed.error || parsed.message || errorBody;
        
        if (code === "API_INACCESSIBLE") {
          // Suppress verbose logging for known plan limitation
          console.log(`[APOLLO] ${endpoint} requires Professional plan or higher (API_INACCESSIBLE)`);
          return {
            error: "api_inaccessible",
            message: `Your search API key does not have access to the People Search API. This requires a Professional plan or higher.`,
            details: msg,
          };
        }
        
        console.error(`[APOLLO] ${response.status} Auth error on ${endpoint}: ${msg}`);
        console.error(`[APOLLO] Parsed error:`, parsed);
        return {
          error: response.status === 401 ? "unauthorized" : "forbidden",
          message: `Search API returned ${response.status}: ${msg}`,
          details: errorBody,
        };
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Apollo API returned ${response.status}: ${errorBody}`
        );
      }

      return await response.json();
    } catch (error: any) {
      // Don't retry on abort/timeout — it would just waste the Edge Function wall-clock budget
      if (error?.name === 'AbortError') {
        throw new Error(`Apollo API timed out after ${FETCH_TIMEOUT_MS}ms on ${endpoint}`);
      }
      if (attempt === retries) throw error;
      console.warn(
        `[APOLLO] Attempt ${attempt + 1} failed: ${error.message}. Retrying...`
      );
      await sleep(1000 * (attempt + 1));
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── People search with correct endpoint ──
// Uses /mixed_people/api_search (Apollo's current API endpoint for people search)
// NOTE: This endpoint returns PREVIEW data only (obfuscated names, boolean flags).
// Actual contact info (email, phone, full name) requires a separate reveal step
// via /people/match or /people/bulk_match.
async function apolloPeopleSearch(body: Record<string, any>): Promise<any> {
  console.log(`[APOLLO] Searching people using endpoint: ${PEOPLE_ENDPOINT}`);
  return apolloFetch(PEOPLE_ENDPOINT, body);
}

// ── Bulk reveal people to get actual contact info ──
// Apollo's /mixed_people/api_search returns preview data with boolean flags
// (has_email, has_direct_phone, etc.) but not actual values.
// We must call /people/match for each person to "reveal" their full profile.
const REVEAL_BATCH_SIZE = 10; // Reveal 10 people at a time to stay within rate limits
const REVEAL_DELAY_MS = 500;  // Delay between reveal batches
const PHONE_WEBHOOK_WAIT_MS = 3000; // Wait 3s for phone webhooks (phone fallback handles the gap)

// Build the webhook URL for Apollo to POST phone reveals to
function getPhoneWebhookUrl(): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  return `${supabaseUrl}/functions/v1/make-server-a8b2511f/apollo/phone-webhook`;
}

async function revealPerson(personId: string, sessionId: string): Promise<any> {
  // Apollo REQUIRES webhook_url when reveal_phone_number is true (returns 400 without it).
  // Email + full profile data comes back inline (synchronous).
  // Phone data is delivered asynchronously via the webhook callback.
  const webhookUrl = `${getPhoneWebhookUrl()}?session=${encodeURIComponent(sessionId)}`;
  const result = await apolloFetch("/people/match", {
    id: personId,
    reveal_personal_emails: true,
    reveal_phone_number: true,
    webhook_url: webhookUrl,
  });
  return result;
}

async function bulkRevealPeople(
  people: any[],
  sessionId: string,
  onProgress?: (revealed: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<{ revealed: any[]; creditsExhausted: boolean }> {
  const revealed: any[] = [];
  let creditsExhausted = false;
  
  for (let i = 0; i < people.length; i += REVEAL_BATCH_SIZE) {
    if (isCancelled?.()) break;
    if (creditsExhausted) break; // Stop wasting API calls
    
    const batch = people.slice(i, i + REVEAL_BATCH_SIZE);
    
    // Reveal batch in parallel
    let batchCreditsExhausted = false;
    const batchPromises = batch.map(async (person) => {
      if (batchCreditsExhausted) return { ...person, _revealFailed: true }; // Skip if credits already exhausted in this batch
      try {
        const result = await revealPerson(person.id, sessionId);
        if (result.error) {
          console.warn(`[APOLLO REVEAL] Error revealing ${person.id}: ${result.error}`);
          if (result.error === 'credits_exhausted') {
            batchCreditsExhausted = true;
          }
          return { ...person, _revealFailed: true }; // Fall back to preview data
        }
        // The /people/match response has the person data in result.person
        return result.person || result;
      } catch (err: any) {
        console.warn(`[APOLLO REVEAL] Failed to reveal ${person.id}: ${err.message}`);
        return { ...person, _revealFailed: true }; // Fall back to preview data
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Check if credits exhausted in this batch — bail out of remaining batches
    if (batchCreditsExhausted) {
      creditsExhausted = true;
      console.warn(`[APOLLO REVEAL] Credits exhausted — aborting remaining ${people.length - i - batch.length} reveals`);
    }
    
    // Diagnostic: log first person's key fields to verify reveal is returning full data
    if (revealed.length === 0 && batchResults.length > 0) {
      const sample = batchResults[0];
      console.log(`[APOLLO REVEAL] Sample revealed person:`, JSON.stringify({
        id: sample.id,
        first_name: sample.first_name,
        last_name: sample.last_name,
        email: sample.email,
        email_status: sample.email_status,
        revealed_email: sample.revealed_email,
        phone_numbers: sample.phone_numbers,
        sanitized_phone: sample.sanitized_phone,
        revealed_phone_number: sample.revealed_phone_number,
        organization_name: sample.organization?.name,
        organization_phone: sample.organization?.phone,
        all_keys: Object.keys(sample),
      }));
    }
    revealed.push(...batchResults);
    
    onProgress?.(revealed.length, people.length);
    
    // Rate limit between batches
    if (i + REVEAL_BATCH_SIZE < people.length && !isCancelled?.() && !creditsExhausted) {
      await sleep(REVEAL_DELAY_MS);
    }
  }
  
  return { revealed, creditsExhausted };
}

// ── Collect phone numbers from webhook KV store and merge into people ──
async function mergePhoneWebhookData(people: any[], sessionId: string): Promise<void> {
  try {
    const phoneEntries = await kv.getByPrefix(`apollo_phone:${sessionId}:`);
    if (!phoneEntries || phoneEntries.length === 0) {
      console.log(`[APOLLO PHONE] No webhook phone data received for session ${sessionId}`);
      return;
    }
    
    console.log(`[APOLLO PHONE] Found ${phoneEntries.length} phone webhook entries for session ${sessionId}`);
    
    // Build a map of person_id -> phone data
    const phoneMap = new Map<string, any>();
    for (const entry of phoneEntries) {
      const val = typeof entry === 'string' ? JSON.parse(entry) : (entry?.value ? (typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value) : entry);
      if (val?.person_id) {
        phoneMap.set(val.person_id, val);
      }
    }
    
    // Merge phone numbers into people
    let merged = 0;
    for (const person of people) {
      const phoneData = phoneMap.get(person.id);
      if (phoneData) {
        // Apollo webhook may send phone_numbers array or sanitized_phone
        if (phoneData.phone_numbers && !person.phone_numbers?.length) {
          person.phone_numbers = phoneData.phone_numbers;
          merged++;
        }
        if (phoneData.sanitized_phone && !person.sanitized_phone) {
          person.sanitized_phone = phoneData.sanitized_phone;
          if (!person.phone_numbers?.length) merged++;
        }
        if (phoneData.organization_phone && !person.organization?.phone) {
          if (person.organization) person.organization.phone = phoneData.organization_phone;
        }
      }
    }
    
    console.log(`[APOLLO PHONE] Merged phone data for ${merged} people`);
    
    // Cleanup KV entries (fire and forget)
    for (const entry of phoneEntries) {
      const val = typeof entry === 'string' ? JSON.parse(entry) : (entry?.value ? (typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value) : entry);
      if (val?.person_id) {
        kv.del(`apollo_phone:${sessionId}:${val.person_id}`).catch(() => {});
      }
    }
  } catch (err: any) {
    console.warn(`[APOLLO PHONE] Error merging phone data: ${err.message}`);
  }
}

// ── Search cache helpers ──────────────────────────────────────────────
// Deterministic hash of search params to avoid duplicate API calls
function hashSearchParams(params: Record<string, any>): string {
  // Sort keys for determinism, exclude volatile fields
  const stable: Record<string, any> = {};
  const keys = ['person_titles', 'person_locations', 'organization_locations',
    'person_seniorities', 'organization_num_employees_ranges', 'q_keywords',
    'q_organization_domains', 'max_results'];
  for (const k of keys) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
      // Normalise arrays to sorted strings for stable hashing
      const v = params[k];
      stable[k] = Array.isArray(v) ? [...v].sort().join('|').toLowerCase() : String(v).toLowerCase().trim();
    }
  }
  // Simple DJB2 hash
  const str = JSON.stringify(stable);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // 32-bit int
  }
  return `apollo_cache:${Math.abs(hash).toString(36)}`;
}

async function getCachedSearch(cacheKey: string): Promise<any | null> {
  try {
    const cached = await kv.get(cacheKey);
    if (!cached) return null;
    const data = typeof cached === 'string' ? JSON.parse(cached) : (cached as any)?.value ? (typeof (cached as any).value === 'string' ? JSON.parse((cached as any).value) : (cached as any).value) : cached;
    if (!data || !data.timestamp) return null;
    if (Date.now() - data.timestamp > CACHE_TTL_MS) {
      kv.del(cacheKey).catch(() => {});
      return null;
    }
    return data;
  } catch { return null; }
}

async function setCachedSearch(cacheKey: string, people: any[], params: Record<string, any>, enrichmentSources?: Record<string, number>): Promise<void> {
  try {
    await kv.set(cacheKey, {
      people,
      params,
      count: people.length,
      timestamp: Date.now(),
      enriched: !!enrichmentSources,
      enrichment_sources: enrichmentSources || null,
    });
  } catch (e: any) {
    console.warn(`[APOLLO CACHE] Failed to cache search: ${e.message}`);
  }
}

// ── Transform raw preview data (from search, no reveal) ──
function transformApolloPreview(person: any): any {
  const org = person.organization || person.employment_history?.[0]?.organization || {};
  return {
    id: person.id || "",
    first_name: person.first_name || "",
    last_name: person.last_name || "",
    name: person.name || `${person.first_name || ""} ${person.last_name || ""}`.trim(),
    title: person.title || person.headline || "",
    email: "",          // Not revealed yet
    email_status: "",   // Not revealed yet
    linkedin_url: person.linkedin_url || "",
    phone_numbers: [],  // Not revealed yet
    city: person.city || "",
    state: person.state || "",
    country: person.country || "",
    seniority: person.seniority || "",
    departments: person.departments || [],
    // Preview availability flags from Apollo search
    _preview: true,
    _has_email: !!(person.email || person.has_email || person.email_status === 'verified' || person.email_status === 'guessed'),
    _has_phone: !!(person.has_phone || person.phone_numbers?.length > 0 || person.sanitized_phone),
    organization: {
      id: org.id || "",
      name: org.name || "",
      website_url: org.website_url || "",
      linkedin_url: org.linkedin_url || "",
      industry: org.industry || "",
      estimated_num_employees: org.estimated_num_employees || 0,
      annual_revenue_printed: org.annual_revenue_printed || "",
      city: org.city || "",
      state: org.state || "",
      country: org.country || "",
      short_description: org.short_description || "",
      founded_year: org.founded_year || 0,
      phone: "", // Not revealed yet
    },
  };
}

// ── Transform Apollo person to our Company-like format ──
export interface ApolloLead {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string;
  linkedin_url: string;
  phone_numbers: { raw_number: string; type: string }[];
  city: string;
  state: string;
  country: string;
  seniority: string;
  departments: string[];
  email_verification?: EmailVerification | null;
  organization: {
    id: string;
    name: string;
    website_url: string;
    linkedin_url: string;
    industry: string;
    estimated_num_employees: number;
    annual_revenue_printed: string;
    city: string;
    state: string;
    country: string;
    short_description: string;
    founded_year: number;
    phone: string;
  };
}

function transformApolloLead(person: any): ApolloLead {
  const org = person.organization || {};
  
  // Apollo may return email in different fields depending on reveal settings:
  // - person.email: standard work email
  // - person.personal_emails: array of personal emails (when reveal_personal_emails=true)
  // - person.revealed_email: sometimes used for revealed work email
  const email = person.email 
    || person.revealed_email 
    || (person.personal_emails && person.personal_emails.length > 0 ? person.personal_emails[0] : "")
    || "";

  // Apollo may return phone numbers in different fields:
  // - person.phone_numbers: array of phone objects
  // - person.revealed_phone_number: direct dial (when reveal_phone_number=true)  
  // - person.sanitized_phone: sanitized version
  // - person.organization.phone: company phone as fallback
  const phoneNumbers: { raw_number: string; type: string }[] = [];
  
  // First, add any revealed direct phone number
  if (person.revealed_phone_number) {
    phoneNumbers.push({ raw_number: person.revealed_phone_number, type: "direct" });
  }
  
  // Then add phone_numbers array entries
  if (Array.isArray(person.phone_numbers)) {
    for (const p of person.phone_numbers) {
      const num = p.raw_number || p.sanitized_number || p.number || "";
      if (num && !phoneNumbers.some(existing => existing.raw_number === num)) {
        phoneNumbers.push({ raw_number: num, type: p.type || "unknown" });
      }
    }
  }
  
  // Fallback to sanitized_phone if we still have nothing
  if (phoneNumbers.length === 0 && person.sanitized_phone) {
    phoneNumbers.push({ raw_number: person.sanitized_phone, type: "direct" });
  }

  // Fallback to organization phone if still nothing
  const orgPhone = (person.organization?.phone || "").trim();
  if (phoneNumbers.length === 0 && orgPhone) {
    phoneNumbers.push({ raw_number: orgPhone, type: "company" });
  }

  return {
    id: person.id || "",
    first_name: person.first_name || "",
    last_name: person.last_name || "",
    name: person.name || `${person.first_name || ""} ${person.last_name || ""}`.trim(),
    title: person.title || "",
    email,
    email_status: person.email_status || (email ? "unknown" : "unavailable"),
    linkedin_url: person.linkedin_url || "",
    phone_numbers: phoneNumbers,
    city: person.city || "",
    state: person.state || "",
    country: person.country || "",
    seniority: person.seniority || "",
    departments: person.departments || [],
    email_verification: person.email_verification || null,
    organization: {
      id: org.id || "",
      name: org.name || "",
      website_url: org.website_url || "",
      linkedin_url: org.linkedin_url || "",
      industry: org.industry || "",
      estimated_num_employees: org.estimated_num_employees || 0,
      annual_revenue_printed: org.annual_revenue_printed || "",
      city: org.city || "",
      state: org.state || "",
      country: org.country || "",
      short_description: org.short_description || "",
      founded_year: org.founded_year || 0,
      phone: org.phone || "",
    },
  };
}

const CONTACT_EMAIL_PREFIX_BLOCKLIST = new Set([
  'info', 'contact', 'hello', 'sales', 'support', 'admin', 'office',
  'inquiries', 'inquiry', 'careers', 'jobs', 'hr', 'team', 'help',
  'marketing', 'media', 'press', 'billing', 'accounts', 'reception',
  'frontdesk', 'mail', 'webmaster', 'staff', 'general', 'service',
  'services', 'noreply', 'no-reply', 'do-not-reply', 'donotreply',
  'feedback', 'subscribe', 'unsubscribe', 'newsletter', 'news',
  'postmaster', 'hostmaster', 'abuse', 'security', 'privacy',
  'compliance', 'legal', 'procurement', 'purchasing', 'vendor',
  'vendors', 'suppliers', 'partners', 'partnership', 'affiliates',
  'advertising', 'ads', 'bookings', 'booking', 'reservations',
  'events', 'orders', 'order', 'returns', 'shipping', 'delivery',
  'customerservice', 'customercare', 'customer-service', 'customer-care',
  'helpdesk', 'help-desk', 'techsupport', 'tech-support', 'it',
  'itsupport', 'it-support', 'webteam', 'web-team', 'digital',
  'socialmedia', 'social-media', 'pr', 'comms', 'communications',
  'editorial', 'editor', 'editors', 'submissions', 'apply',
  'applications', 'recruit', 'recruiting', 'recruitment', 'talent',
  'operations', 'ops', 'finance', 'accounting', 'payroll',
  'invoices', 'invoice', 'payments', 'membership', 'members',
  'community', 'volunteer', 'donate', 'donations',
]);

function isGenericContactEmail(email: string | null | undefined): boolean {
  const lower = (email || "").toLowerCase().trim();
  const atIdx = lower.indexOf('@');
  if (atIdx <= 0) return false;
  const prefix = lower.substring(0, atIdx);
  if (CONTACT_EMAIL_PREFIX_BLOCKLIST.has(prefix)) return true;
  const stripped = prefix.replace(/\d+$/, '');
  return stripped !== prefix && CONTACT_EMAIL_PREFIX_BLOCKLIST.has(stripped);
}

function hasUsablePersonEmail(lead: any): boolean {
  const email = (lead?.email || "").trim();
  if (!email || isGenericContactEmail(email)) return false;
  if (lead?.email_verification?.is_role_based) return false;
  return true;
}

function filterEmailQualifiedPeople<T extends any>(people: T[], context: string): T[] {
  const filtered = people.filter(hasUsablePersonEmail);
  const dropped = people.length - filtered.length;
  if (dropped > 0) {
    console.log(`[APOLLO] ${context}: dropped ${dropped} leads without usable person email`);
  }
  return filtered;
}

// ── Hybrid enrichment helper ──
// Strategy: Apollo /mixed_people/api_search returns PREVIEW data only (obfuscated last names,
// no emails, no phones, no LinkedIn, no org details — just boolean flags like has_email, has_direct_phone).
// Therefore we MUST reveal via /people/match to get any real contact data.
//
// Pipeline:
//   Phase 1 — Apollo reveal ALL leads → gets full names, emails, phones, LinkedIn, org data
//   Phase 2 — For leads where Apollo returned no email, try Hunter.io (also grabs phone if returned)
//   Phase 3 — For leads where Hunter also failed, try Findymail
//   Phase 3.5 — DISABLED (pattern guessing removed — only real emails allowed)
//   Phase 4 — For leads still missing phone, Hunter.io domain-search + org phone fallback
//   Phase 5 — DIY email verification: MX records, disposable detection, role-based flagging
//
// This maximizes coverage: Apollo handles most emails + phones,
// Hunter/Findymail fill email gaps, and strict MX verification protects deliverability.
// No emails are fabricated — only real verified emails from API sources are used.
async function hybridEnrichPeople(
  allRawPeople: any[],
  userId: string,
  send: (event: string, data: any) => void,
  isCancelledFn: () => boolean,
): Promise<{ people: ApolloLead[]; hunterFound: number; findymailFound: number; apolloRevealCount: number; phoneEnrichFound: number; hunterPhoneFound: number; patternGuessed: number; verified: number; verifiedValid: number; verifiedRisky: number; verifiedInvalid: number; creditsExhausted: boolean }> {
  const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");
  const FINDYMAIL_API_KEY = Deno.env.get("FINDYMAIL_API_KEY");
  const sessionId = `enrich_${Date.now()}_${userId}`;

  // ── Phase 1: Apollo reveal ALL leads ──
  // Preview data only has: id, first_name, last_name_obfuscated, title, has_email, has_direct_phone, organization.name
  // We need /people/match to get: full last_name, email, phone_numbers, linkedin_url, full org details
  send("phase", { phase: 4, name: `Revealing ${allRawPeople.length} contacts`, status: "processing" });
  send("activity", { message: `Connecting to Apollo API to reveal ${allRawPeople.length} contacts...`, type: "info" });
  console.log(`[ENRICH] Phase 1: Apollo reveal for ${allRawPeople.length} preview leads`);

  // Pass full preview data (not just {id}) so fallback has names/titles/orgs
  const revealResult = await bulkRevealPeople(
    allRawPeople,
    sessionId,
    (rev, tot) => { send("progress", { fetched: rev, total: tot, phase: "reveal" }); },
    isCancelledFn,
  );
  const apolloRevealed = revealResult.revealed;
  const creditsExhausted = revealResult.creditsExhausted;

  if (creditsExhausted) {
    console.warn(`[ENRICH] Apollo credits exhausted — enrichment will be limited`);
    send("warning", { code: "credits_exhausted", message: "Apollo API credits exhausted. Leads will have limited data. Upgrade your Apollo plan or wait for credits to reset." });
    send("activity", { message: "Apollo credits exhausted — switching to fallback enrichment sources", type: "warn" });
  } else {
    send("activity", { message: `Apollo revealed ${apolloRevealed.filter(r => !r._revealFailed).length} contacts with full profiles`, type: "success" });
  }

  // Wait for async phone webhooks to arrive from Apollo
  if (apolloRevealed.length > 0 && !creditsExhausted) {
    send("phase", { phase: 4, name: "Collecting phone data...", status: "processing" });
    send("activity", { message: "Waiting for phone number webhooks from Apollo...", type: "info" });
    await sleep(PHONE_WEBHOOK_WAIT_MS);
    await mergePhoneWebhookData(apolloRevealed, sessionId);
  }

  // Transform revealed data into ApolloLead objects
  // Skip leads that only have { id } (failed reveal with no preview data)
  const revealedMap = new Map<string, ApolloLead>();
  for (const r of apolloRevealed) {
    // If reveal failed, the result has _revealFailed flag — use preview data from allRawPeople
    if (r._revealFailed) continue;
    const person = r.person || r;
    const t = transformApolloLead(person);
    revealedMap.set(t.id, t);
  }

  // For leads that failed to reveal (rate limit, credits, etc.), create from preview data
  for (const raw of allRawPeople) {
    if (!revealedMap.has(raw.id)) {
      const fallback = transformApolloLead(raw);
      // Preview data has last_name_obfuscated instead of last_name — clean it up
      if (raw.last_name_obfuscated && !raw.last_name) {
        fallback.last_name = raw.last_name_obfuscated;
        fallback.name = `${raw.first_name || ''} ${raw.last_name_obfuscated}`.trim();
      }
      revealedMap.set(raw.id, fallback);
    }
  }

  const apolloRevealCount = apolloRevealed.filter(r => !r._revealFailed).length;
  const withEmail = [...revealedMap.values()].filter(l => !!l.email).length;
  const withPhone = [...revealedMap.values()].filter(l => l.phone_numbers?.length > 0).length;
  console.log(`[ENRICH] Phase 1 done: ${apolloRevealCount} revealed, ${withEmail} with email, ${withPhone} with phone`);
  send("activity", { message: `Contact reveal complete — ${withEmail} emails, ${withPhone} phone numbers found`, type: "success" });

  // ── Phase 1.5: Reuse emails already stored in CRM before paid enrichment ──
  let crmHydrated = 0;
  if (!isCancelledFn()) {
    const currentLeads = [...revealedMap.values()];
    send("phase", { phase: 4.5, name: `Checking existing CRM contacts (${currentLeads.length})`, status: "processing" });
    try {
      const hydration = await hydrateLeadsFromExistingContacts(currentLeads);
      crmHydrated = hydration.hydrated;
      if (crmHydrated > 0) {
        send("activity", { message: `Reused ${crmHydrated} known emails from the CRM database`, type: "success" });
      }
      console.log(`[ENRICH] CRM hydration found ${crmHydrated}/${hydration.candidates} emails from existing contacts (${hydration.rowsScanned} rows scanned)`);
    } catch (err: any) {
      console.warn(`[ENRICH] CRM hydration failed: ${err.message}`);
    }
    send("phase", { phase: 4.5, name: "Checking existing CRM contacts", status: "complete", found: crmHydrated });
  }

  // ── Phase 2: Hunter.io for leads missing email (also grabs phone if returned) ──
  // Now we have full names + org website_urls from the reveal
  let hunterFound = 0;
  let hunterPhoneFound = 0;
  const leadsNoEmail = [...revealedMap.entries()].filter(([, l]) => !l.email && l.organization?.website_url);

  if (HUNTER_API_KEY && leadsNoEmail.length > 0 && !isCancelledFn()) {
    send("phase", { phase: 5, name: `Verifying emails (${leadsNoEmail.length} leads)`, status: "processing" });
    send("activity", { message: `Querying Hunter.io for ${leadsNoEmail.length} leads missing email addresses...`, type: "info" });
    console.log(`[ENRICH] Phase 2: Hunter.io for ${leadsNoEmail.length} leads missing email`);
    const HB = 10;
    for (let i = 0; i < leadsNoEmail.length; i += HB) {
      if (isCancelledFn()) break;
      const batch = leadsNoEmail.slice(i, i + HB);
      const br = await Promise.allSettled(
        batch.map(async ([id, lead]) => {
          const domain = lead.organization.website_url.replace(/^https?:\/\//, '').replace(/\/.*/, '').replace(/^www\./, '');
          if (!domain || !lead.first_name || !lead.last_name) return null;
          try {
            const url = `https://api.hunter.io/v2/email-finder?first_name=${encodeURIComponent(lead.first_name)}&last_name=${encodeURIComponent(lead.last_name)}&domain=${encodeURIComponent(domain)}&api_key=${HUNTER_API_KEY}`;
            const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return null;
            const d = await r.json();
            if (d.data?.email) return { id, email: d.data.email, status: d.data.score > 80 ? 'verified' : 'guessed', source: 'hunter', phone: d.data.phone_number || null, linkedin: d.data.linkedin_url || null };
            return null;
          } catch { return null; }
        })
      );
      for (const r of br) {
        if (r.status === 'fulfilled' && r.value) {
          hunterFound++;
          const lead = revealedMap.get(r.value.id);
          if (lead) {
            lead.email = r.value.email;
            lead.email_status = r.value.status;
            (lead as any)._enrichment_source = 'hunter';
            // Also grab phone from Hunter response (free — no extra API call)
            if (r.value.phone && lead.phone_numbers.length === 0) {
              lead.phone_numbers.push({ raw_number: r.value.phone, type: "direct" });
              hunterPhoneFound++;
            }
            // Also grab LinkedIn if missing
            if (r.value.linkedin && !lead.linkedin_url) {
              lead.linkedin_url = r.value.linkedin;
            }
          }
        }
      }
      send("progress", { fetched: Math.min(i + HB, leadsNoEmail.length), total: leadsNoEmail.length, phase: "hunter" });
      if (i + HB < leadsNoEmail.length) await sleep(300);
    }
    console.log(`[ENRICH] Hunter found ${hunterFound}/${leadsNoEmail.length} emails, ${hunterPhoneFound} phones`);
    if (hunterFound > 0) send("activity", { message: `Hunter.io found ${hunterFound} additional emails${hunterPhoneFound > 0 ? ` and ${hunterPhoneFound} phone numbers` : ''}`, type: "success" });
    else send("activity", { message: `Hunter.io scan complete — no additional emails found`, type: "info" });
  }

  // ── Phase 3: Findymail for remaining leads without email ──
  let findymailFound = 0;
  if (FINDYMAIL_API_KEY && !isCancelledFn()) {
    const stillNoEmail = [...revealedMap.entries()].filter(([, l]) => !l.email && l.organization?.website_url && l.first_name);
    if (stillNoEmail.length > 0) {
      send("phase", { phase: 6, name: `Deep email search (${stillNoEmail.length} leads)`, status: "processing" });
      send("activity", { message: `Querying Findymail for ${stillNoEmail.length} leads still missing email...`, type: "info" });
      console.log(`[ENRICH] Phase 3: Findymail for ${stillNoEmail.length} leads still missing email`);
      const FB = 5;
      for (let i = 0; i < stillNoEmail.length; i += FB) {
        if (isCancelledFn()) break;
        const batch = stillNoEmail.slice(i, i + FB);
        const br = await Promise.allSettled(
          batch.map(async ([id, lead]) => {
            const domain = lead.organization.website_url.replace(/^https?:\/\//, '').replace(/\/.*/, '').replace(/^www\./, '');
            if (!domain) return null;
            try {
              const r = await fetch('https://app.findymail.com/api/search/name', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${FINDYMAIL_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ first_name: lead.first_name, last_name: lead.last_name || '', domain }),
                signal: AbortSignal.timeout(8000),
              });
              if (!r.ok) return null;
              const d = await r.json();
              if (d.email) return { id, email: d.email, status: 'verified', source: 'findymail' };
              return null;
            } catch { return null; }
          })
        );
        for (const r of br) {
          if (r.status === 'fulfilled' && r.value) {
            findymailFound++;
            const lead = revealedMap.get(r.value.id);
            if (lead) {
              lead.email = r.value.email;
              lead.email_status = r.value.status;
              (lead as any)._enrichment_source = 'findymail';
            }
          }
        }
        if (i + FB < stillNoEmail.length) await sleep(400);
      }
      console.log(`[ENRICH] Findymail found ${findymailFound} additional emails`);
      if (findymailFound > 0) send("activity", { message: `Findymail discovered ${findymailFound} additional email addresses`, type: "success" });
    }
  }

  // ── Phase 3.5: DISABLED — No pattern guessing ──
  // Pattern guessing (fabricating emails from firstname@domain.com patterns) has been
  // permanently removed. Only real verified emails from Hunter.io and Findymail are kept.
  // Fabricated emails cause bounces and damage sender reputation.
  let patternGuessed = 0;

  // ── Phase 4: Phone enrichment for leads still missing phone numbers ──
  // Uses Hunter.io domain-search to find direct/company phone numbers.
  // Also tries Apollo org enrichment for company phones.
  let phoneEnrichFound = 0;
  const leadsNoPhone = [...revealedMap.entries()].filter(([, l]) => l.phone_numbers.length === 0 && l.organization?.website_url);

  if (leadsNoPhone.length > 0 && !isCancelledFn()) {
    send("phase", { phase: 7, name: `Finding phone numbers (${leadsNoPhone.length} leads)`, status: "processing" });
    send("activity", { message: `Searching for direct phone numbers for ${leadsNoPhone.length} leads...`, type: "info" });
    console.log(`[ENRICH] Phase 4: Phone enrichment for ${leadsNoPhone.length} leads missing phone`);

    // 4a. Hunter.io domain-search — returns people at a domain with phone_number field
    // We batch by unique domain to avoid duplicate API calls
    if (HUNTER_API_KEY) {
      const domainLeadMap = new Map<string, { id: string; lead: ApolloLead }[]>();
      for (const [id, lead] of leadsNoPhone) {
        const domain = lead.organization.website_url.replace(/^https?:\/\//, '').replace(/\/.*/, '').replace(/^www\./, '');
        if (!domain) continue;
        if (!domainLeadMap.has(domain)) domainLeadMap.set(domain, []);
        domainLeadMap.get(domain)!.push({ id, lead });
      }

      const domains = [...domainLeadMap.keys()];
      const PB = 5; // Phone batch size
      for (let i = 0; i < domains.length; i += PB) {
        if (isCancelledFn()) break;
        const domainBatch = domains.slice(i, i + PB);
        const results = await Promise.allSettled(
          domainBatch.map(async (domain) => {
            try {
              const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${HUNTER_API_KEY}&limit=100`;
              const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (!r.ok) return { domain, people: [], orgPhone: "" };
              const d = await r.json();
              // Extract people with phone numbers from the domain search response
              const orgPhone = d.data?.organization?.phone_number || "";
              const people = (d.data?.emails || []).filter((e: any) => e.phone_number);
              return { domain, people, orgPhone };
            } catch { return { domain, people: [], orgPhone: "" }; }
          })
        );

        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const { domain, people: domainPeople, orgPhone } = r.value;
          const leads = domainLeadMap.get(domain) || [];

          for (const { id, lead } of leads) {
            if (lead.phone_numbers.length > 0) continue; // Already has phone from earlier step

            // Try to match by name to find direct phone
            const match = domainPeople.find((p: any) => {
              const fn = (p.first_name || "").toLowerCase();
              const ln = (p.last_name || "").toLowerCase();
              return fn === lead.first_name.toLowerCase() && ln === lead.last_name.toLowerCase();
            });

            if (match?.phone_number) {
              lead.phone_numbers.push({ raw_number: match.phone_number, type: "direct" });
              (lead as any)._phone_source = 'hunter_domain';
              phoneEnrichFound++;
            } else if (orgPhone) {
              // Use organization phone as fallback
              lead.phone_numbers.push({ raw_number: orgPhone, type: "company" });
              (lead as any)._phone_source = 'hunter_org';
              phoneEnrichFound++;
            }
          }
        }
        send("progress", { fetched: Math.min(i + PB, domains.length), total: domains.length, phase: "phone_enrich" });
        if (i + PB < domains.length) await sleep(300);
      }
    }

    send("phase", { phase: 7, name: `Finding phone numbers (${leadsNoPhone.length} leads)`, status: "complete" });
    if (phoneEnrichFound > 0) send("activity", { message: `Phone enrichment found ${phoneEnrichFound} direct phone numbers`, type: "success" });
    console.log(`[ENRICH] Phone enrichment found ${phoneEnrichFound} phone numbers for ${leadsNoPhone.length} leads`);
  }

  // ── Phase 5: DIY Email Verification (replaces ZeroBounce/Kickbox/NeverBounce) ──
  // Runs on ALL leads with email: MX record check, disposable detection, role-based flagging
  let verified = 0;
  let verifiedValid = 0;
  let verifiedRisky = 0;
  let verifiedInvalid = 0;

  const leadsWithEmail = [...revealedMap.entries()].filter(([, l]) => !!l.email);
  if (leadsWithEmail.length > 0 && !isCancelledFn()) {
    send("phase", { phase: 8, name: `Verifying deliverability (${leadsWithEmail.length} emails)`, status: "processing" });
    send("activity", { message: `Verifying deliverability for ${leadsWithEmail.length} email addresses (MX + SMTP checks)...`, type: "info" });
    console.log(`[ENRICH] Phase 5: DIY email verification for ${leadsWithEmail.length} emails`);

    try {
      const emailsToVerify = leadsWithEmail.map(([id, l]) => ({ id, email: l.email }));
      const verificationResults = await verifyEmailBatch(emailsToVerify, 15);

      for (const [id, verification] of verificationResults) {
        const lead = revealedMap.get(id);
        if (!lead) continue;

        // STRICT MX ENFORCEMENT: Drop ALL emails that fail DNS MX verification
        // This prevents bounce emails from reaching the CRM regardless of source
        if (verification.status === "invalid" || !verification.mx_valid) {
          console.log(`[ENRICH] MX REJECT: ${lead.email} (status=${verification.status}, mx_valid=${verification.mx_valid}) — dropping email for ${lead.name}`);
          lead.email = "";
          lead.email_status = "unavailable";
          lead.email_verification = null;
          (lead as any)._enrichment_source = undefined;
          verifiedInvalid++;
          continue;
        }

        lead.email_verification = verification;
        verified++;
        if (verification.status === "valid") verifiedValid++;
        else if (verification.status === "risky") verifiedRisky++;
      }

      console.log(`[ENRICH] Verification complete: ${verifiedValid} valid, ${verifiedRisky} risky, ${verifiedInvalid} invalid out of ${verified}`);
    } catch (err: any) {
      console.warn(`[ENRICH] Verification error: ${err.message}`);
    }
    send("phase", { phase: 8, name: `Verifying deliverability (${leadsWithEmail.length} emails)`, status: "complete" });
    send("activity", { message: `Email verification complete — ${verifiedValid} safe to send, ${verifiedRisky} risky, ${verifiedInvalid} invalid`, type: "success" });
  }

  // ── Assemble final list preserving original order ──
  const idOrder = new Map(allRawPeople.map((p: any, i: number) => [p.id, i]));
  const enrichedPeople = filterEmailQualifiedPeople([...revealedMap.values()], "enrichment").sort(
    (a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999)
  );

  const finalWithEmail = enrichedPeople.filter(l => !!l.email).length;
  const finalWithPhone = enrichedPeople.filter(l => l.phone_numbers?.length > 0).length;
  console.log(`[ENRICH] FINAL: ${enrichedPeople.length} leads, ${finalWithEmail} emails (Apollo: ${finalWithEmail - hunterFound - findymailFound - patternGuessed}, Hunter: ${hunterFound}, Findymail: ${findymailFound}, Pattern: ${patternGuessed}), ${finalWithPhone} phones (Hunter email-finder: ${hunterPhoneFound}, Phone enrichment: ${phoneEnrichFound}), Verification: ${verifiedValid} valid / ${verifiedRisky} risky / ${verifiedInvalid} invalid`);

  return { people: enrichedPeople, hunterFound, findymailFound, apolloRevealCount, phoneEnrichFound, hunterPhoneFound, patternGuessed, verified, verifiedValid, verifiedRisky, verifiedInvalid, creditsExhausted };
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── POST /search — Single-page people search ──
app.post("/search", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const {
      person_titles,
      person_locations,
      organization_locations,
      person_seniorities,
      organization_num_employees_ranges,
      q_keywords,
      q_organization_domains,
      page = 1,
      per_page = 25,
    } = body;

    console.log(
      `[APOLLO] People search: titles=${JSON.stringify(person_titles)}, locations=${JSON.stringify(organization_locations)}, seniorities=${JSON.stringify(person_seniorities)}, page=${page} (User: ${user.email})`
    );

    const searchBody: Record<string, any> = {
      page,
      per_page: Math.min(per_page, MAX_PER_PAGE),
    };

    if (person_titles?.length) searchBody.person_titles = person_titles;
    if (person_locations?.length) searchBody.person_locations = person_locations;
    if (organization_locations?.length) searchBody.organization_locations = organization_locations;
    if (person_seniorities?.length) searchBody.person_seniorities = person_seniorities;
    if (organization_num_employees_ranges?.length)
      searchBody.organization_num_employees_ranges = organization_num_employees_ranges;
    if (q_keywords) searchBody.q_keywords = q_keywords;
    if (q_organization_domains?.length) searchBody.q_organization_domains = q_organization_domains;

    const data = await apolloPeopleSearch(searchBody);

    if (data.error) {
      return c.json({ error: data.error, details: data.details }, 400);
    }

    const people = (data.people || []).map(transformApolloLead);
    const pagination = data.pagination || {};

    console.log(
      `[APOLLO] Found ${people.length} people (page ${pagination.page}/${pagination.total_pages}, total: ${pagination.total_entries})`
    );

    return c.json({
      success: true,
      people,
      pagination: {
        page: pagination.page || page,
        per_page: pagination.per_page || per_page,
        total_entries: pagination.total_entries || 0,
        total_pages: pagination.total_pages || 0,
      },
    });
  } catch (error: any) {
    console.error("[APOLLO] Search error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /search-stream — SSE streaming for massive searches ──
// Paginates through Apollo results and streams them in real-time
app.post("/search-stream", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const {
      person_titles,
      person_locations,
      organization_locations,
      person_seniorities,
      organization_num_employees_ranges,
      q_keywords,
      q_organization_domains,
      max_results = 1000,
      per_page = 100,
      bypass_cache = false,
    } = body;

    const apiKey = getApolloApiKey();
    console.log(`[APOLLO SSE] API Key loaded: ${apiKey ? `exists (${apiKey.length} chars)` : 'MISSING'}`);

    console.log(
      `[APOLLO SSE] Mega search starting: max_results=${max_results} (User: ${user.email})`
    );

    let isCancelled = false;
    let controllerClosed = false;
    const stream = new ReadableStream({
      cancel() {
        isCancelled = true;
      },
      async start(controller) {
        const encoder = new TextEncoder();
        
        // Safe close helper
        const safeClose = () => {
          if (controllerClosed || isCancelled) return;
          try {
            controller.close();
            controllerClosed = true;
          } catch (e: any) {
            // Already closed, ignore
            controllerClosed = true;
          }
        };
        
        // Heartbeat: send SSE comments every 3s to prevent proxy/runtime from killing idle connections
        const heartbeat = setInterval(() => {
          if (isCancelled || controllerClosed) return;
          try {
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
          } catch (_) {
            isCancelled = true;
            controllerClosed = true;
          }
        }, 3000);
        
        const send = (event: string, data: any) => {
          if (isCancelled || controllerClosed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch (_) {
            isCancelled = true;
            controllerClosed = true;
          }
        };

        // ── Proactive disconnect detection via request abort signal ──
        // req.signal fires BEFORE respondWith() tries to write to a dead
        // TCP socket, giving us a chance to close the stream cleanly.
        const reqSignal = c.req.raw?.signal;
        if (reqSignal) {
          const onAbort = () => {
            isCancelled = true;
            clearInterval(heartbeat);
            safeClose();
          };
          if (reqSignal.aborted) { onAbort(); return; }
          reqSignal.addEventListener('abort', onAbort, { once: true });
        }

        try {
          console.log(`[APOLLO SSE] Stream start() executing for ${user.email}...`);

          // ── CACHE CHECK — skip API calls if we have a recent identical search ──
          const cacheKey = hashSearchParams(body);
          if (bypass_cache) {
            console.log(`[APOLLO SSE] Cache BYPASSED by user request (${cacheKey})`);
            kv.del(cacheKey).catch(() => {});
          }
          const cached = bypass_cache ? null : await getCachedSearch(cacheKey);
          if (cached && cached.people?.length > 0) {
            const isEnrichedCache = !!cached.enriched;
            console.log(`[APOLLO SSE] Cache HIT (${cacheKey}): ${cached.people.length} leads (enriched=${isEnrichedCache})`);
            send("phase", { phase: 1, name: "Cache hit", status: "complete", total_available: cached.people.length, fetching: cached.people.length, cached: true });
            send("activity", { message: `Cache hit — loading ${cached.people.length} previously enriched leads`, type: "success" });

            // CRM dedup
            send("phase", { phase: 3, name: "CRM dedup check", status: "checking" });
            let cachedExisting = new Set<string>();
            try {
              const teamIds = await getTeamMemberIds(user.id);
              const { data: el } = await supabase.from("leads").select("email").in("user_id", teamIds);
              if (el) cachedExisting = new Set(el.map((l: any) => (l.email || "").toLowerCase()).filter(Boolean));
            } catch (_) {}
            send("phase", { phase: 3, name: "CRM dedup check", status: "complete" });

            let cachedEnriched: ApolloLead[];
            let cachedSources = { hunter: 0, findymail: 0, apollo_reveal: 0 };

            if (isEnrichedCache) {
              // Already enriched — return directly (no credit burn)
              cachedEnriched = filterEmailQualifiedPeople(cached.people, "cache");
              cachedSources = cached.enrichment_sources || cachedSources;
              console.log(`[APOLLO SSE] Returning ${cachedEnriched.length} pre-enriched cached leads (no re-reveal needed)`);
            } else {
              // Old raw cache — must enrich (this path handles legacy cache entries)
              send("phase", { phase: 4, name: "Enriching contacts", status: "processing" });
              const enrichResult = await hybridEnrichPeople(cached.people, user.id, send, () => isCancelled);
              cachedEnriched = filterEmailQualifiedPeople(enrichResult.people, "legacy cache enrichment");
              cachedSources = { hunter: enrichResult.hunterFound, findymail: enrichResult.findymailFound, apollo_reveal: enrichResult.apolloRevealCount, phone_enrich: enrichResult.phoneEnrichFound, hunter_phone: enrichResult.hunterPhoneFound, pattern_guessed: enrichResult.patternGuessed, verified: enrichResult.verified, verified_valid: enrichResult.verifiedValid, verified_risky: enrichResult.verifiedRisky, verified_invalid: enrichResult.verifiedInvalid };
              // Upgrade cache to enriched format so next hit is free
              setCachedSearch(cacheKey, cachedEnriched, cached.params || {}, cachedSources).catch(() => {});
            }

            const cachedStats = {
              total: cachedEnriched.length,
              with_email: cachedEnriched.filter((p: any) => p.email).length,
              verified_emails: cachedEnriched.filter((p: any) => p.email_status === 'verified').length,
              guessed_emails: cachedEnriched.filter((p: any) => p.email_status === 'guessed').length,
              with_phone: cachedEnriched.filter((p: any) => p.phone_numbers?.length > 0).length,
              with_linkedin: cachedEnriched.filter((p: any) => p.linkedin_url).length,
              unique_companies: new Set(cachedEnriched.map((p: any) => p.organization?.name).filter(Boolean)).size,
              seniority_breakdown: {} as Record<string, number>,
              enrichment_sources: cachedSources,
            };
            for (const p of cachedEnriched) { const s = (p as any).seniority || "unknown"; cachedStats.seniority_breakdown[s] = (cachedStats.seniority_breakdown[s] || 0) + 1; }
            send("phase", { phase: 4, name: "Enriching contacts", status: "complete" });
            send("people", { people: cachedEnriched, partial: false, preview: false });
            send("complete", { people: cachedEnriched, stats: cachedStats, existing_emails: Array.from(cachedExisting), duplicate_count: 0, cached: true, preview: false, total_available: cached.count || cachedEnriched.length, requested: max_results });
            clearInterval(heartbeat);
            safeClose();
            return;
          }
          console.log(`[APOLLO SSE] Cache MISS (${cacheKey}), executing live search...`);

          // ══════════════════════════════════════════════════════════════
          // PHASE 0: LOCAL LEAD POOL — search our own database first
          // This avoids burning external API credits for leads we already know
          // ══════════════════════════════════════════════════════════════
          send("phase", { phase: 0, name: "Searching local database", status: "searching" });
          send("activity", { message: "Scanning local lead database for matching contacts...", type: "info" });

          const poolCriteria: SearchCriteria = {
            person_titles: person_titles || undefined,
            person_locations: person_locations || undefined,
            organization_locations: organization_locations || undefined,
            person_seniorities: person_seniorities || undefined,
            organization_num_employees_ranges: organization_num_employees_ranges || undefined,
            q_keywords: q_keywords || undefined,
            q_organization_domains: q_organization_domains || undefined,
            max_results: max_results,
          };

          let poolLeads: PoolLead[] = [];
          let poolKvMatches = 0;
          let poolDbMatches = 0;
          let poolSize = 0;
          try {
            const poolResult = await searchPool(poolCriteria, undefined, Math.min(max_results, 200));
            poolLeads = filterEmailQualifiedPeople(poolResult.leads, "local pool");
            poolKvMatches = poolResult.kvMatches;
            poolDbMatches = poolResult.dbMatches;
            poolSize = poolResult.totalPoolSize;
            console.log(`[APOLLO SSE] Phase 0: Found ${poolLeads.length} leads in local pool (KV: ${poolKvMatches}, DB: ${poolDbMatches}, pool size: ${poolSize})`);
          } catch (poolErr: any) {
            console.warn(`[APOLLO SSE] Phase 0 pool search failed (continuing to external): ${poolErr.message}`);
          }

          const poolEmails = new Set(poolLeads.map(l => (l.email || "").toLowerCase()).filter(Boolean));

          send("phase", {
            phase: 0,
            name: "Searching local database",
            status: "complete",
            pool_matches: poolLeads.length,
            pool_size: poolSize,
          });

          if (poolLeads.length > 0) {
            send("activity", { message: `Found ${poolLeads.length} matching leads in local database`, type: "success" });
          }

          // If pool fully satisfies the request, skip external API entirely
          if (poolLeads.length >= max_results) {
            console.log(`[APOLLO SSE] Pool satisfied request (${poolLeads.length} >= ${max_results}), skipping external APIs`);
            send("phase", { phase: 1, name: "External search", status: "skipped", reason: "Local pool sufficient" });
            send("activity", { message: `Local database satisfied request — skipping external API calls`, type: "success" });

            // CRM dedup
            send("phase", { phase: 3, name: "CRM dedup check", status: "checking" });
            let poolExisting = new Set<string>();
            try {
              const teamIds = await getTeamMemberIds(user.id);
              const { data: el } = await supabase.from("leads").select("email").in("user_id", teamIds);
              if (el) poolExisting = new Set(el.map((l: any) => (l.email || "").toLowerCase()).filter(Boolean));
            } catch (_) {}
            send("phase", { phase: 3, name: "CRM dedup check", status: "complete" });

          const poolResults = filterEmailQualifiedPeople(poolLeads, "pool response").slice(0, max_results) as any as ApolloLead[];
            const poolStats = {
              total: poolResults.length,
              with_email: poolResults.filter(p => p.email).length,
              verified_emails: poolResults.filter(p => p.email_status === 'verified').length,
              guessed_emails: poolResults.filter(p => p.email_status === 'guessed').length,
              with_phone: poolResults.filter(p => p.phone_numbers?.length > 0).length,
              with_linkedin: poolResults.filter(p => p.linkedin_url).length,
              unique_companies: new Set(poolResults.map(p => p.organization?.name).filter(Boolean)).size,
              seniority_breakdown: {} as Record<string, number>,
              enrichment_sources: { pool_kv: poolKvMatches, pool_db: poolDbMatches, apollo_reveal: 0, hunter: 0, findymail: 0 },
            };
            for (const p of poolResults) { const s = (p as any).seniority || "unknown"; poolStats.seniority_breakdown[s] = (poolStats.seniority_breakdown[s] || 0) + 1; }

            send("phase", { phase: 4, name: "Enriching contacts", status: "complete" });
            send("people", { people: poolResults, partial: false, preview: false });
            send("complete", {
              people: poolResults,
              stats: poolStats,
              existing_emails: Array.from(poolExisting),
              duplicate_count: 0,
              from_pool: poolResults.length,
              pool_kv: poolKvMatches,
              pool_db: poolDbMatches,
              total_available: poolLeads.length,
              requested: max_results,
            });
            clearInterval(heartbeat);
            safeClose();
            return;
          }

          // Reduce external request size by pool results count
          const externalNeeded = Math.max(1, max_results - poolLeads.length);
          console.log(`[APOLLO SSE] Pool provided ${poolLeads.length}, need ${externalNeeded} more from external APIs`);

          const searchBody: Record<string, any> = {
            per_page: Math.min(per_page, MAX_PER_PAGE),
          };

          if (person_titles?.length) searchBody.person_titles = person_titles;
          if (person_locations?.length) searchBody.person_locations = person_locations;
          if (organization_locations?.length)
            searchBody.organization_locations = organization_locations;
          if (person_seniorities?.length)
            searchBody.person_seniorities = person_seniorities;
          if (organization_num_employees_ranges?.length)
            searchBody.organization_num_employees_ranges =
              organization_num_employees_ranges;
          if (q_keywords) searchBody.q_keywords = q_keywords;
          if (q_organization_domains?.length)
            searchBody.q_organization_domains = q_organization_domains;

          // Phase 1: Initial search to get total count
          send("phase", {
            phase: 1,
            name: "Searching external sources",
            status: "searching",
          });
          send("activity", { message: "Querying Apollo external database for matching decision-makers...", type: "info" });

          searchBody.page = 1;
          console.log("[APOLLO SSE] Fetching first page with body:", JSON.stringify(searchBody, null, 2));
          console.log("[APOLLO SSE] Using apolloPeopleSearch (/mixed_people/api_search)...");
          const firstPage = await apolloPeopleSearch(searchBody);
          
          // ── Diagnostic: log raw sample person to identify field names ──
          if (firstPage.people?.length > 0) {
            const sample = firstPage.people[0];
            console.log("[APOLLO SSE] RAW sample person keys:", Object.keys(sample));
            console.log("[APOLLO SSE] RAW FULL sample person:", JSON.stringify(sample).substring(0, 2000));
          }
          
          console.log("[APOLLO SSE] First page response:", JSON.stringify({
            hasError: !!firstPage.error,
            hasPagination: !!firstPage.pagination,
            hasPeople: !!firstPage.people,
            peopleCount: firstPage.people?.length || 0,
            totalEntries: firstPage.pagination?.total_entries || firstPage.total_entries,
            keys: Object.keys(firstPage),
          }));

          if (firstPage.error) {
            console.log(`[APOLLO SSE] Search failed with error: ${firstPage.error}`);
            send("error", {
              message: firstPage.message || firstPage.error,
              error_code: firstPage.error,
              details: firstPage.details,
            });
            clearInterval(heartbeat);
            safeClose();
            return;
          }

          const pagination = firstPage.pagination || {};
          // Handle total_entries at top level (mixed_people/api_search) or inside pagination
          const rawTotalEntries = firstPage.total_entries || pagination.total_entries || 0;
          // Use externalNeeded (reduced by pool hits) instead of max_results for pagination
          const totalAvailable = Math.min(rawTotalEntries, externalNeeded);
          const totalPages = Math.min(
            Math.ceil(totalAvailable / (searchBody.per_page || 100)),
            MAX_PAGES_PER_REQUEST
          );

          console.log(`[APOLLO SSE] Pagination: rawTotalEntries=${rawTotalEntries}, totalAvailable=${totalAvailable}, totalPages=${totalPages}, externalNeeded=${externalNeeded}, poolLeads=${poolLeads.length}`);

          send("phase", {
            phase: 1,
            name: "Connecting to Apollo",
            status: "complete",
            total_available: rawTotalEntries,
            fetching: totalAvailable,
          });
          send("activity", { message: `Apollo found ${rawTotalEntries.toLocaleString()} matching contacts — fetching ${totalAvailable} across ${totalPages} page${totalPages !== 1 ? 's' : ''}`, type: "success" });

          // ── Collect all raw preview people from search pages ──
          const allRawPeople: any[] = [...(firstPage.people || [])];
          const seenIds = new Set(allRawPeople.map((p: any) => p.id));

          send("progress", {
            fetched: allRawPeople.length,
            total: totalAvailable,
            page: 1,
            total_pages: totalPages,
          });

          // Phase 2: Paginate through remaining search results
          if (totalPages > 1) {
            send("phase", {
              phase: 2,
              name: "Searching leads",
              status: "searching",
              pages_remaining: totalPages - 1,
            });
            send("activity", { message: `Paginating through ${totalPages - 1} additional search result pages...`, type: "info" });

            for (let page = 2; page <= totalPages; page++) {
              if (isCancelled) break;
              if (allRawPeople.length >= externalNeeded) break;

              try {
                await sleep(RATE_LIMIT_DELAY_MS);

                searchBody.page = page;
                const pageData = await apolloPeopleSearch(searchBody);

                if (pageData.error || isCancelled) break;

                const pagePeople = (pageData.people || []).filter((p: any) => {
                  if (seenIds.has(p.id)) return false;
                  seenIds.add(p.id);
                  return true;
                });

                allRawPeople.push(...pagePeople);

                send("progress", {
                  fetched: allRawPeople.length,
                  total: totalAvailable,
                  page,
                  total_pages: totalPages,
                });

                console.log(
                  `[APOLLO SSE] Page ${page}/${totalPages}: +${pagePeople.length} (total: ${allRawPeople.length})`
                );
              } catch (pageError: any) {
                console.warn(
                  `[APOLLO SSE] Page ${page} error: ${pageError.message}`
                );
                send("progress", {
                  fetched: allRawPeople.length,
                  total: totalAvailable,
                  page,
                  error: pageError.message,
                });
              }
            }

            send("phase", {
              phase: 2,
              name: "Searching leads",
              status: "complete",
            });
          }

          // ── Phase 3: CRM dedup check (BEFORE reveal for cost savings) ──
          send("phase", { phase: 3, name: "CRM dedup check", status: "checking" });
          send("activity", { message: `Cross-checking ${allRawPeople.length} contacts against your CRM to remove duplicates...`, type: "info" });

          let existingEmails = new Set<string>();
          try {
            const teamMemberIds = await getTeamMemberIds(user.id);
            console.log(`[APOLLO] Team dedup: checking ${teamMemberIds.length} member(s) CRM`);
            const { data: existingLeads } = await supabase
              .from("leads").select("email").in("user_id", teamMemberIds);
            if (existingLeads) {
              existingEmails = new Set(
                existingLeads.map((l: any) => (l.email || "").toLowerCase()).filter(Boolean)
              );
            }
          } catch (_) {}

          send("phase", { phase: 3, name: "CRM dedup check", status: "complete" });
          if (existingEmails.size > 0) send("activity", { message: `CRM dedup found ${existingEmails.size} existing contacts — will flag duplicates`, type: "info" });

          // ── Trim to externalNeeded before enrichment, dedup against pool ──
          // Filter out people whose email we already have from the local pool
          const dedupedRaw = allRawPeople.filter((p: any) => {
            const email = (p.email || "").toLowerCase();
            return !email || !poolEmails.has(email);
          });
          const trimmedPeople = dedupedRaw.slice(0, externalNeeded);
          console.log(`[APOLLO SSE] Trimmed ${allRawPeople.length} raw leads to ${trimmedPeople.length} (externalNeeded=${externalNeeded}, deduped ${allRawPeople.length - dedupedRaw.length} pool duplicates)`);

          // ── Phase 4: Hybrid enrichment ──
          // Apollo reveal all leads first (preview data is too limited), then Hunter/Findymail fill email gaps.
          send("phase", { phase: 4, name: "Enriching contacts", status: "processing" });
          send("activity", { message: `Starting multi-source enrichment for ${trimmedPeople.length} contacts...`, type: "info" });

          const enrichResult = await hybridEnrichPeople(trimmedPeople, user.id, send, () => isCancelled);
          const enrichedPeople = filterEmailQualifiedPeople(enrichResult.people, "external enrichment");
          const apolloCreditsExhausted = enrichResult.creditsExhausted;
          const enrichmentSources = { hunter: enrichResult.hunterFound, findymail: enrichResult.findymailFound, apollo_reveal: enrichResult.apolloRevealCount, phone_enrich: enrichResult.phoneEnrichFound, hunter_phone: enrichResult.hunterPhoneFound, pattern_guessed: enrichResult.patternGuessed, verified: enrichResult.verified, verified_valid: enrichResult.verifiedValid, verified_risky: enrichResult.verifiedRisky, verified_invalid: enrichResult.verifiedInvalid };

          // ── Save enriched leads to the global discovery pool ──
          // This builds our local database so future searches can reuse them
          send("phase", { phase: 9, name: "Saving to lead pool", status: "processing" });
          send("activity", { message: `Saving ${enrichedPeople.length} enriched leads to local pool for faster future searches...`, type: "info" });
          const poolSaveResult = await saveToPool(enrichedPeople as any as PoolLead[]).catch((err: any) => {
            console.warn(`[APOLLO SSE] Pool save error: ${err.message}`);
            return { saved: 0, skipped: 0 };
          });
          console.log(`[APOLLO SSE] Saved ${poolSaveResult.saved} leads to pool (${poolSaveResult.skipped} skipped)`);
          send("phase", { phase: 9, name: "Saving to lead pool", status: "complete", saved: poolSaveResult.saved });
          send("activity", { message: `${poolSaveResult.saved} leads saved to pool — ready for delivery`, type: "success" });

          // ── Merge pool leads (Phase 0) with enriched external leads ──
          // Pool leads go first (already enriched, no credit cost), external leads follow
          const mergedEmails = new Set<string>();
          const mergedPeople: ApolloLead[] = [];

          // Add pool leads first
          for (const pl of poolLeads) {
            if (!hasUsablePersonEmail(pl)) continue;
            const email = (pl.email || "").toLowerCase();
            if (email && mergedEmails.has(email)) continue;
            if (email) mergedEmails.add(email);
            mergedPeople.push(pl as any as ApolloLead);
          }

          // Then add enriched external leads
          for (const el of enrichedPeople) {
            if (!hasUsablePersonEmail(el)) continue;
            const email = (el.email || "").toLowerCase();
            if (!email || !mergedEmails.has(email)) {
              if (email) mergedEmails.add(email);
              mergedPeople.push(el);
            }
          }

          // Trim to requested max
          const finalPeople = mergedPeople.slice(0, max_results);

          // Cache ENRICHED data (all merged) so cache hits don't re-burn Apollo credits
          // Don't cache if credits were exhausted — the data is incomplete
          if (!apolloCreditsExhausted) {
            setCachedSearch(cacheKey, finalPeople, { ...body, _totalAvailable: rawTotalEntries }, enrichmentSources).catch(() => {});
          } else {
            console.log(`[APOLLO SSE] Skipping cache — Apollo credits exhausted, data is incomplete`);
          }

          const stats = {
            total: finalPeople.length,
            with_email: finalPeople.filter(p => p.email).length,
            verified_emails: finalPeople.filter(p => p.email_status === 'verified').length,
            guessed_emails: finalPeople.filter(p => p.email_status === 'guessed').length,
            with_phone: finalPeople.filter(p => p.phone_numbers?.length > 0).length,
            with_linkedin: finalPeople.filter(p => p.linkedin_url).length,
            unique_companies: new Set(finalPeople.map(p => p.organization?.name).filter(Boolean)).size,
            seniority_breakdown: {} as Record<string, number>,
            enrichment_sources: { ...enrichmentSources, pool_kv: poolKvMatches, pool_db: poolDbMatches, pool_saved: poolSaveResult.saved },
          };

          for (const person of finalPeople) {
            const s = person.seniority || "unknown";
            stats.seniority_breakdown[s] = (stats.seniority_breakdown[s] || 0) + 1;
          }

          send("phase", { phase: 4, name: "Enriching contacts", status: "complete" });
          send("people", { people: finalPeople, partial: false, preview: false });

          send("complete", {
            people: finalPeople,
            stats,
            existing_emails: Array.from(existingEmails),
            duplicate_count: 0,
            preview: false,
            from_pool: poolLeads.length,
            from_external: enrichedPeople.length,
            pool_saved: poolSaveResult.saved,
            total_available: rawTotalEntries + poolLeads.length,
            requested: max_results,
            credits_exhausted: apolloCreditsExhausted || false,
          });
        } catch (error: any) {
          // Only log real errors, not client disconnections
          if (!isCancelled && !controllerClosed && error?.name !== 'Http' && !error?.message?.includes('broken pipe')) {
            send("error", { message: error.message, stack: error.stack });
            console.error("[APOLLO SSE] Stream error:", {
              message: error.message,
              stack: error.stack,
              name: error.name,
              error: error
            });
          }
        } finally {
          clearInterval(heartbeat);
          safeClose();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    });
  } catch (error: any) {
    // Don't log client disconnections
    if (error?.name !== 'Http' && !error?.message?.includes('connection closed') && !error?.message?.includes('broken pipe') && !error?.message?.includes('EPIPE')) {
      console.error("[APOLLO SSE] Error:", error);
    }
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /companies — Company search ──
app.post("/companies", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const {
      organization_locations,
      organization_num_employees_ranges,
      q_keywords,
      q_organization_name,
      page = 1,
      per_page = 25,
    } = body;

    const searchBody: Record<string, any> = {
      page,
      per_page: Math.min(per_page, MAX_PER_PAGE),
    };

    if (organization_locations?.length) searchBody.organization_locations = organization_locations;
    if (organization_num_employees_ranges?.length)
      searchBody.organization_num_employees_ranges = organization_num_employees_ranges;
    if (q_keywords) searchBody.q_keywords = q_keywords;
    if (q_organization_name) searchBody.q_organization_name = q_organization_name;

    const data = await apolloFetch("/organizations/search", searchBody);

    if (data.error) {
      return c.json({ error: data.error }, 400);
    }

    const organizations = (data.organizations || data.accounts || []).map(
      (org: any) => ({
        id: org.id,
        name: org.name,
        website_url: org.website_url,
        linkedin_url: org.linkedin_url,
        industry: org.industry,
        estimated_num_employees: org.estimated_num_employees,
        annual_revenue_printed: org.annual_revenue_printed,
        city: org.city,
        state: org.state,
        country: org.country,
        short_description: org.short_description,
        founded_year: org.founded_year,
        phone: org.phone,
        logo_url: org.logo_url,
      })
    );

    return c.json({
      success: true,
      organizations,
      pagination: data.pagination || {},
    });
  } catch (error: any) {
    console.error("[APOLLO] Company search error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /reveal-selected — On-demand reveal for selected leads ──
// Reveals actual email/phone/name for a batch of Apollo person IDs.
// Called by the frontend when user selects leads to reveal or save.
app.post("/reveal-selected", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { person_ids } = await c.req.json();

    if (!Array.isArray(person_ids) || person_ids.length === 0) {
      return c.json({ error: "No person_ids provided" }, 400);
    }

    // Cap at 200 per request to prevent abuse
    const ids = person_ids.slice(0, 200);
    console.log(`[APOLLO REVEAL] Revealing ${ids.length} people on demand for ${user.email}`);

    const sessionId = `reveal_${Date.now()}_${user.id}`;
    const people = ids.map((id: string) => ({ id }));

    const revealResult = await bulkRevealPeople(
      people,
      sessionId,
      (revealed, total) => {
        console.log(`[APOLLO REVEAL] ${revealed}/${total}`);
      },
    );
    const revealedPeople = revealResult.revealed;

    if (revealResult.creditsExhausted) {
      console.warn(`[APOLLO REVEAL] Credits exhausted during on-demand reveal`);
    }

    // Wait for phone webhooks
    if (!revealResult.creditsExhausted) {
      await sleep(PHONE_WEBHOOK_WAIT_MS);
      await mergePhoneWebhookData(revealedPeople, sessionId);
    }

    // Transform to our standard format (filter out failed reveals)
    const transformed = revealedPeople.filter((r: any) => !r._revealFailed).map(transformApolloLead);

    // Quick phone fallback for leads without phone: try Hunter email-finder
    const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");
    if (HUNTER_API_KEY) {
      const noPhone = transformed.filter(p => p.phone_numbers.length === 0 && p.organization?.website_url && p.first_name);
      if (noPhone.length > 0) {
        const phoneResults = await Promise.allSettled(
          noPhone.map(async (lead) => {
            const domain = lead.organization.website_url.replace(/^https?:\/\//, '').replace(/\/.*/, '').replace(/^www\./, '');
            if (!domain) return null;
            try {
              const url = `https://api.hunter.io/v2/email-finder?first_name=${encodeURIComponent(lead.first_name)}&last_name=${encodeURIComponent(lead.last_name)}&domain=${encodeURIComponent(domain)}&api_key=${HUNTER_API_KEY}`;
              const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
              if (!r.ok) return null;
              const d = await r.json();
              if (d.data?.phone_number) return { id: lead.id, phone: d.data.phone_number };
              return null;
            } catch { return null; }
          })
        );
        for (const r of phoneResults) {
          if (r.status === 'fulfilled' && r.value) {
            const lead = transformed.find(p => p.id === r.value!.id);
            if (lead && lead.phone_numbers.length === 0) {
              lead.phone_numbers.push({ raw_number: r.value.phone, type: "direct" });
            }
          }
        }
      }
    }

    // Quick email verification for revealed leads
    const emailsToVerify = transformed.filter(p => p.email).map(p => ({ id: p.id, email: p.email }));
    if (emailsToVerify.length > 0) {
      try {
        const verificationResults = await verifyEmailBatch(emailsToVerify, 10);
        for (const [id, verification] of verificationResults) {
          const lead = transformed.find(p => p.id === id);
          if (lead) lead.email_verification = verification;
        }
      } catch (err: any) {
        console.warn(`[APOLLO REVEAL] Verification error: ${err.message}`);
      }
    }

    console.log(`[APOLLO REVEAL] Revealed ${transformed.length} contacts (${transformed.filter(p => p.email).length} with email, ${transformed.filter(p => p.phone_numbers?.length > 0).length} with phone)`);

    // Save revealed leads to global discovery pool for future reuse
    saveToPool(transformed as any as PoolLead[]).catch((err: any) => {
      console.warn(`[APOLLO REVEAL] Pool save failed: ${err.message}`);
    });

    return c.json({
      success: true,
      people: transformed,
      stats: {
        revealed: transformed.length,
        with_email: transformed.filter(p => p.email).length,
        verified: transformed.filter(p => p.email_status === 'verified').length,
        with_phone: transformed.filter(p => p.phone_numbers?.length > 0).length,
      },
      credits_exhausted: revealResult.creditsExhausted || false,
    });
  } catch (error: any) {
    console.error("[APOLLO REVEAL] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /save-to-crm — Save Apollo leads to CRM ──
app.post("/save-to-crm", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const { leads } = await c.req.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return c.json({ error: "No leads provided" }, 400);
    }

    // **LEAD LIMIT CHECK** — enforce plan-based limits before saving
    const limitCheck = await checkLeadLimitApollo(user, supabase, leads.length);
    if (!limitCheck.allowed) {
      console.log(`[APOLLO LIMIT] User ${user.email} blocked: ${limitCheck.currentCount}/${limitCheck.limit} leads (plan: ${limitCheck.plan}), tried to save ${leads.length}`);
      return c.json({
        error: 'LEAD_LIMIT_EXCEEDED',
        message: `You've reached your ${limitCheck.plan === 'none' ? 'free tier' : limitCheck.plan + ' plan'} limit of ${limitCheck.limit.toLocaleString()} contacts. Upgrade your plan to save more leads.`,
        currentCount: limitCheck.currentCount,
        limit: limitCheck.limit,
        plan: limitCheck.plan,
        remaining: limitCheck.remaining,
        attempted: leads.length,
      }, 403);
    }

    console.log(`[APOLLO] Saving ${leads.length} Apollo leads to CRM`);

    // ── Auto-reveal unrevealed leads before saving ──
    // If leads came from the preview-only search, reveal them now
    const unrevealed = leads.filter((l: any) => l._preview && !l.email);
    if (unrevealed.length > 0) {
      console.log(`[APOLLO] Auto-revealing ${unrevealed.length} unrevealed leads before save...`);
      const sessionId = `save_reveal_${Date.now()}_${user.id}`;
      const toReveal = unrevealed.map((l: any) => ({ id: l.id }));
      const revealResult2 = await bulkRevealPeople(toReveal, sessionId);
      const revealed = revealResult2.revealed;
      if (!revealResult2.creditsExhausted) {
        await sleep(PHONE_WEBHOOK_WAIT_MS);
        await mergePhoneWebhookData(revealed, sessionId);
      }
      // Merge revealed data back into leads array
      const revealedMap = new Map<string, any>();
      for (const r of revealed) {
        if (r._revealFailed) continue;
        const transformed = transformApolloLead(r);
        revealedMap.set(transformed.id, transformed);
      }
      for (let i = 0; i < leads.length; i++) {
        const rev = revealedMap.get(leads[i].id);
        if (rev) leads[i] = rev;
      }
      console.log(`[APOLLO] Auto-reveal complete: ${revealedMap.size} contacts enriched`);
    }

    // Fetch existing leads across the ENTIRE TEAM for dedup (prevents double-contacting)
    const teamMemberIds = await getTeamMemberIds(user.id);
    console.log(`[APOLLO] Team dedup: checking ${teamMemberIds.length} member(s) for duplicates`);
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("email, website")
      .in("user_id", teamMemberIds);

    const existingEmails = new Set<string>(
      (existingLeads || [])
        .map((l: any) => (l.email || "").toLowerCase())
        .filter(Boolean)
    );

    // ── Generic email prefix blocklist — decision makers only ──
    const GENERIC_PREFIXES = new Set([
      'info', 'contact', 'hello', 'sales', 'support', 'admin', 'office',
      'inquiries', 'inquiry', 'careers', 'jobs', 'hr', 'team', 'help',
      'marketing', 'media', 'press', 'billing', 'accounts', 'reception',
      'frontdesk', 'mail', 'webmaster', 'staff', 'general', 'service',
      'services', 'noreply', 'no-reply', 'do-not-reply', 'donotreply',
      'feedback', 'subscribe', 'unsubscribe', 'newsletter', 'news',
      'postmaster', 'hostmaster', 'abuse', 'security', 'privacy',
      'compliance', 'legal', 'procurement', 'purchasing', 'vendor',
      'vendors', 'suppliers', 'partners', 'partnership', 'affiliates',
      'advertising', 'ads', 'bookings', 'booking', 'reservations',
      'events', 'orders', 'order', 'returns', 'shipping', 'delivery',
      'customerservice', 'customercare', 'customer-service', 'customer-care',
      'helpdesk', 'help-desk', 'techsupport', 'tech-support', 'it',
      'itsupport', 'it-support', 'webteam', 'web-team', 'digital',
      'socialmedia', 'social-media', 'pr', 'comms', 'communications',
      'editorial', 'editor', 'editors', 'submissions', 'apply',
      'applications', 'recruit', 'recruiting', 'recruitment', 'talent',
      'operations', 'ops', 'finance', 'accounting', 'payroll',
      'invoices', 'invoice', 'payments', 'membership', 'members',
      'community', 'volunteer', 'donate', 'donations',
    ]);
    function isGenericCrmEmail(email: string): boolean {
      if (!email) return false;
      const atIdx = email.indexOf('@');
      if (atIdx <= 0) return false;
      const prefix = email.substring(0, atIdx).toLowerCase();
      if (GENERIC_PREFIXES.has(prefix)) return true;
      const stripped = prefix.replace(/\d+$/, '');
      if (stripped !== prefix && GENERIC_PREFIXES.has(stripped)) return true;
      return false;
    }

    const results = { saved: 0, skipped: 0, failed: 0, blocked_generic: 0, blocked_dns: 0, errors: [] as string[] };

    // ── DNS Domain Verification — reject leads whose email domain has no MX records ──
    // Pre-fetch MX records for all unique domains in parallel (deduped, cached)
    const uniqueDomains = new Set<string>();
    for (const lead of leads) {
      const email = (lead.email || "").toLowerCase().trim();
      if (!email) continue;
      const domain = email.split("@")[1];
      if (domain) uniqueDomains.add(domain);
    }
    const domainList = [...uniqueDomains];
    const invalidDomains = new Set<string>();
    // Check MX in batches of 15 concurrent lookups
    for (let i = 0; i < domainList.length; i += 15) {
      const batch = domainList.slice(i, i + 15);
      const mxResults = await Promise.allSettled(
        batch.map(async (domain) => {
          const mx = await checkMxRecords(domain);
          return { domain, valid: mx.valid };
        })
      );
      for (const r of mxResults) {
        if (r.status === "fulfilled" && !r.value.valid) {
          invalidDomains.add(r.value.domain);
        }
      }
    }
    if (invalidDomains.size > 0) {
      console.log(`[APOLLO] DNS verification: ${invalidDomains.size} domains have no MX records — leads with these domains will be blocked: ${[...invalidDomains].join(", ")}`);
    }

    // Process in batches of 50 for DB efficiency
    for (let i = 0; i < leads.length; i += 50) {
      const batch = leads.slice(i, i + 50);
      const toInsert: any[] = [];

      for (const lead of batch) {
        const emailLower = (lead.email || "").toLowerCase();

        // Block generic/role-based emails — only decision makers allowed in CRM
        if (emailLower && isGenericCrmEmail(emailLower)) {
          console.log(`[APOLLO] Blocked generic email from CRM: ${emailLower} (${lead.name || 'unknown'})`);
          results.blocked_generic++;
          results.skipped++;
          continue;
        }

        // Block emails with invalid DNS domains (no MX records = will bounce)
        if (emailLower) {
          const domain = emailLower.split("@")[1];
          if (domain && invalidDomains.has(domain)) {
            console.log(`[APOLLO] Blocked bad domain (no MX records): ${emailLower} — domain ${domain}`);
            results.blocked_dns++;
            results.skipped++;
            continue;
          }
        }

        if (emailLower && existingEmails.has(emailLower)) {
          results.skipped++;
          continue;
        }

        // Extract domain from website
        let website = lead.organization?.website_url || "";
        if (website && !website.startsWith("http")) website = `https://${website}`;

        const phone =
          lead.phone_numbers?.[0]?.raw_number || lead.organization?.phone || "";

        if (!emailLower) {
          console.log(`[APOLLO] Blocked lead without mandatory email: ${lead.name || 'unknown'}`);
          results.skipped++;
          continue;
        }

        // ── Clean & validate business_name and contact_name before CRM insert ──
        const rawBizName = (lead.organization?.name || "").trim();
        const rawContactName = (lead.name || `${lead.first_name || ""} ${lead.last_name || ""}`.trim());
        const cleanedBizName = cleanCrmCompanyName(rawBizName);
        const cleanedContactName = cleanCrmContactName(rawContactName);

        // Block leads with empty business name AND empty contact name (completely unidentifiable)
        if (!cleanedBizName && !cleanedContactName) {
          console.log(`[APOLLO] Blocked unidentifiable lead: biz="${rawBizName}", contact="${rawContactName}"`);
          results.skipped++;
          continue;
        }

        // Block leads without a real job title — clean data requirement
        const leadTitle = (lead.title || "").trim();
        if (!leadTitle) {
          console.log(`[APOLLO] Blocked lead without job title: "${cleanedContactName}" at "${cleanedBizName}"`);
          results.skipped++;
          continue;
        }

        toInsert.push({
          user_id: user.id,
          business_name: cleanedBizName,
          contact_name: cleanedContactName,
          email: lead.email || "",
          phone,
          website,
          city: toTitleCase(lead.organization?.city || lead.city || ""),
          state: toTitleCase(lead.organization?.state || lead.state || ""),
          country: toTitleCase(lead.organization?.country || lead.country || ""),
          category: toTitleCase(lead.organization?.industry || ""),
          industry: toTitleCase(lead.organization?.industry || ""),
          job_title: lead.title || "",
          source: "apollo_native",
          person_linkedin_url: lead.linkedin_url || "",
          linkedin: lead.linkedin_url || "",
          employees: lead.organization?.estimated_num_employees
            ? String(lead.organization.estimated_num_employees)
            : "",
          annual_revenue: parseApolloRevenue(
            lead.organization?.annual_revenue_printed
          ),
          notes: [
            `Imported via Apollo Pro.`,
            `Role: ${lead.title || "N/A"}`,
            `Seniority: ${toTitleCase(lead.seniority) || "N/A"}`,
            `Email Status: ${lead.email_status || "N/A"}`,
            `LinkedIn: ${lead.linkedin_url || "N/A"}`,
            `Company LinkedIn: ${lead.organization?.linkedin_url || "N/A"}`,
            `Revenue: ${lead.organization?.annual_revenue_printed || "N/A"}`,
            `Employees: ${lead.organization?.estimated_num_employees || "N/A"}`,
            `Founded: ${lead.organization?.founded_year || "N/A"}`,
          ].join("\n"),
          status: "Cold",
          created_at: new Date().toISOString(),
        });

        if (emailLower) existingEmails.add(emailLower);
      }

      if (toInsert.length > 0) {
        const { error } = await supabase.from("leads").insert(toInsert);
        if (error) {
          console.error("[APOLLO] Batch insert error:", error);
          results.failed += toInsert.length;
          results.errors.push(error.message);
        } else {
          results.saved += toInsert.length;
        }
      }
    }

    console.log(
      `[APOLLO] Save complete: ${results.saved} saved, ${results.skipped} skipped (${results.blocked_generic} generic emails blocked, ${results.blocked_dns} bad DNS domains blocked), ${results.failed} failed`
    );

    // Also save to the global discovery pool for future reuse
    saveToPool(leads as any as PoolLead[]).catch((err: any) => {
      console.warn(`[APOLLO] Pool save during CRM save failed: ${err.message}`);
    });

    return c.json({ success: true, results });
  } catch (error: any) {
    console.error("[APOLLO] Save error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /status — Check Apollo API key validity ──
app.get("/status", async (c) => {
  try {
    // Auth is optional for status check — if it fails, still check key presence
    let userEmail = "anonymous";
    try {
      const { user } = await getAuthenticatedUser(c);
      userEmail = user.email || user.id;
    } catch (authErr: any) {
      console.log(`[APOLLO STATUS] Auth skipped: ${authErr.message}`);
    }

    const apiKey = Deno.env.get("APOLLO_API_KEY");
    console.log(
      `[APOLLO STATUS] Key check: exists=${!!apiKey}, length=${apiKey?.length || 0} (User: ${userEmail})`
    );

    if (!apiKey || apiKey.trim().length === 0) {
      return c.json({
        connected: false,
        error: "APOLLO_API_KEY not configured — add it in Supabase Edge Function secrets",
      });
    }

    // Actually validate the key has People Search access with a minimal call
    // Using /people/search endpoint (Professional plan and above)
    try {
      const testBody = JSON.stringify({ page: 1, per_page: 1, q_keywords: "CEO" });
      const testHeaders = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      };

      console.log(`[APOLLO STATUS] Testing endpoint: ${PEOPLE_ENDPOINT}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      let testRes;
      try {
        testRes = await fetch(`${APOLLO_BASE}${PEOPLE_ENDPOINT}`, {
            method: "POST",
            headers: testHeaders,
            body: testBody,
            signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // 200 or 422 = works, key is valid and endpoint is accessible
      // 429 = rate limited but means the key works
      if (testRes.ok || testRes.status === 429 || testRes.status === 422) {
        console.log(`[APOLLO STATUS] Key validated via ${PEOPLE_ENDPOINT} (${testRes.status})`);
        return c.json({ 
          connected: true, 
          key_length: apiKey.length, 
          endpoint: PEOPLE_ENDPOINT,
          status: testRes.status === 429 ? "rate_limited" : "ok"
        });
      }

      if (testRes.status === 401) {
        console.warn(`[APOLLO STATUS] Key is invalid (401 Unauthorized)`);
        return c.json({
          connected: false,
          error: "Apollo API key is invalid or expired. Generate a new key in your Apollo.io settings.",
          key_present: true,
        });
      }

      if (testRes.status === 403) {
        const errBody = await testRes.text().catch(() => "");
        let parsed: any = {};
        try { parsed = JSON.parse(errBody); } catch (_) {}
        const code = parsed.error_code || "";

        if (code === "API_INACCESSIBLE") {
           console.log(`[APOLLO STATUS] ${PEOPLE_ENDPOINT} requires Professional plan (API_INACCESSIBLE)`);
           return c.json({
            connected: true,
            key_present: true,
            plan_upgrade_required: true,
            warning: "Your Apollo API key is valid and connected, but People Search requires a Professional plan or higher. Some search features may be limited.",
            key_length: apiKey.length,
           });
        }

        // Non-API_INACCESSIBLE 403 = key is bad
        console.warn(`[APOLLO STATUS] Key rejected with 403: ${errBody}`);
        return c.json({
          connected: false,
          error: `Apollo API returned 403. Your API key may be invalid or expired.`,
          details: errBody,
          key_present: true,
        });
      }

      // Other unexpected status code
      const errBody = await testRes.text().catch(() => "");
      console.warn(`[APOLLO STATUS] Unexpected status ${testRes.status}: ${errBody}`);
      return c.json({
        connected: false,
        error: `Apollo API returned unexpected status ${testRes.status}. Please check your API key.`,
        details: errBody,
        key_present: true,
      });
    } catch (fetchErr: any) {
      // Network/timeout/CORS error = cannot validate, mark as not connected
      console.error(`[APOLLO STATUS] Validation request failed: ${fetchErr.message}`);
      
      const isTimeout = fetchErr.name === 'AbortError' || fetchErr.message?.includes('aborted');
      
      return c.json({
        connected: false,
        error: isTimeout 
            ? `Connection to Apollo API timed out. Please try again.` 
            : `Could not connect to Apollo API: ${fetchErr.message}. Check your network or API key.`,
        key_present: true,
      });
    }
  } catch (error: any) {
    console.error("[APOLLO STATUS] Unexpected error:", error);
    return c.json({
      connected: false,
      error: `Status check failed: ${error.message}`,
    }, 500);
  }
});

// ── Helper: parse Apollo revenue string ──
function parseApolloRevenue(val: string | undefined): number | null {
  if (!val) return null;
  const clean = val.replace(/[$,+]/g, "").trim();

  if (clean.includes("-")) {
    const parts = clean.split("-").map((p) => p.trim());
    const parsePart = (s: string) => {
      const upper = s.toUpperCase();
      let mult = 1;
      if (upper.includes("B")) mult = 1e9;
      else if (upper.includes("M")) mult = 1e6;
      else if (upper.includes("K")) mult = 1e3;
      const n = parseFloat(upper.replace(/[BMK]/g, ""));
      return isNaN(n) ? null : n * mult;
    };
    const min = parsePart(parts[0]);
    const max = parsePart(parts[1]);
    if (min !== null && max !== null) return (min + max) / 2;
    return min || max;
  }

  const upper = clean.toUpperCase();
  let mult = 1;
  if (upper.includes("B")) mult = 1e9;
  else if (upper.includes("M")) mult = 1e6;
  else if (upper.includes("K")) mult = 1e3;

  const num = parseFloat(upper.replace(/[BMK]/g, ""));
  if (isNaN(num)) return null;
  return num * mult;
}

// ── GET /pool/stats — Discovery pool statistics ──
// Pool stats are global aggregate counts — no auth required.
// This endpoint is called on component mount before the session may be ready.
app.get("/pool/stats", async (c) => {
  try {
    const stats = await getPoolStats();
    return c.json({ success: true, ...stats });
  } catch (error: any) {
    console.error("[POOL STATS] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /pool/diagnose — Diagnostic endpoint to test industry searches ──
// Test what leads exist for a specific industry in the database
app.get("/pool/diagnose", async (c) => {
  try {
    const industry = c.req.query("industry");
    if (!industry) {
      return c.json({ error: "Missing 'industry' query parameter" }, 400);
    }

    console.log(`[POOL DIAGNOSE] Testing industry: "${industry}"`);

    // Test database query
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const indLower = industry.toLowerCase().trim();
    
    // Query 1: Exact category match
    const { data: exactMatches, error: e1 } = await supabase
      .from("leads")
      .select("id, contact_name, business_name, category, email, city, state")
      .ilike("category", indLower)
      .not("email", "is", null)
      .neq("email", "")
      .limit(10);

    // Query 2: Prefix match
    const { data: prefixMatches, error: e2 } = await supabase
      .from("leads")
      .select("id, contact_name, business_name, category, email, city, state")
      .ilike("category", `${indLower}%`)
      .not("email", "is", null)
      .neq("email", "")
      .limit(10);

    // Query 3: Contains match
    const { data: containsMatches, error: e3 } = await supabase
      .from("leads")
      .select("id, contact_name, business_name, category, email, city, state")
      .ilike("category", `%${indLower}%`)
      .not("email", "is", null)
      .neq("email", "")
      .limit(10);

    // Query 4: Count total matches
    const { count, error: e4 } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("category", `%${indLower}%`)
      .not("email", "is", null)
      .neq("email", "");

    // Query 5: Sample categories to see what we have
    const { data: sampleCategories, error: e5 } = await supabase
      .from("leads")
      .select("category")
      .not("category", "is", null)
      .neq("category", "")
      .limit(100);

    const uniqueCategories = [...new Set(
      (sampleCategories || []).map((r: any) => r.category).filter(Boolean)
    )].sort();

    return c.json({
      success: true,
      industry: industry,
      results: {
        exact_matches: exactMatches?.length || 0,
        prefix_matches: prefixMatches?.length || 0,
        contains_matches: containsMatches?.length || 0,
        total_count: count || 0,
      },
      sample_exact: exactMatches?.slice(0, 3) || [],
      sample_prefix: prefixMatches?.slice(0, 3) || [],
      sample_contains: containsMatches?.slice(0, 3) || [],
      available_categories: uniqueCategories.slice(0, 50), // First 50 unique categories
      errors: [e1, e2, e3, e4, e5].filter(Boolean).map((e: any) => e.message),
    });
  } catch (error: any) {
    console.error("[POOL DIAGNOSE] Error:", error);
    return c.json({ error: error.message, stack: error.stack }, 500);
  }
});

// ── POST /phone-webhook — Apollo phone reveal webhook callback ──
// Apollo POSTs phone data here after an async phone reveal completes.
// No auth required — Apollo calls this directly.
// Apollo's actual payload format:
// { "status": "success", "total_requested_enrichments": 1, "people": [{ "id": "...", "status": "success", "phone_numbers": [...], "sanitized_phone": "..." }] }
// Session ID is passed via query parameter: ?session=xxx
app.post("/phone-webhook", async (c) => {
  try {
    const body = await c.req.json();
    const sessionId = c.req.query("session") || "";
    
    console.log(`[APOLLO PHONE WEBHOOK] Received callback (session=${sessionId}):`, JSON.stringify(body).substring(0, 2000));
    
    if (!sessionId) {
      console.warn("[APOLLO PHONE WEBHOOK] Missing session query parameter");
      return c.json({ received: true, warning: "missing session" });
    }
    
    // Apollo sends phone data in a "people" array at the top level
    const people = body.people || [];
    if (!Array.isArray(people) || people.length === 0) {
      console.warn("[APOLLO PHONE WEBHOOK] No people array in webhook payload");
      return c.json({ received: true, warning: "no people data" });
    }
    
    let stored = 0;
    for (const person of people) {
      const personId = person.id;
      if (!personId) continue;
      
      // Skip people where the reveal failed or has no phone data
      const hasPhoneData = (
        (Array.isArray(person.phone_numbers) && person.phone_numbers.length > 0) ||
        person.sanitized_phone ||
        person.revealed_phone_number ||
        person.organization?.phone
      );
      
      if (!hasPhoneData) {
        console.log(`[APOLLO PHONE WEBHOOK] Person ${personId}: status=${person.status}, no phone data`);
        continue;
      }
      
      const phoneData: any = {
        person_id: personId,
        timestamp: Date.now(),
      };
      
      if (Array.isArray(person.phone_numbers) && person.phone_numbers.length > 0) {
        phoneData.phone_numbers = person.phone_numbers;
      }
      if (person.sanitized_phone) {
        phoneData.sanitized_phone = person.sanitized_phone;
      }
      if (person.revealed_phone_number) {
        phoneData.revealed_phone_number = person.revealed_phone_number;
      }
      if (person.organization?.phone) {
        phoneData.organization_phone = person.organization.phone;
      }
      
      const kvKey = `apollo_phone:${sessionId}:${personId}`;
      await kv.set(kvKey, phoneData);
      stored++;
      
      console.log(`[APOLLO PHONE WEBHOOK] Stored phone for ${personId}:`, JSON.stringify(phoneData).substring(0, 300));
    }
    
    console.log(`[APOLLO PHONE WEBHOOK] Processed ${people.length} people, stored ${stored} phone records`);
    return c.json({ received: true, stored });
  } catch (error: any) {
    console.error("[APOLLO PHONE WEBHOOK] Error:", error.message);
    return c.json({ received: true, error: error.message }, 200); // Always return 200 to Apollo
  }
});

export default app;
