// Contndr Lead Enrichment Agent v3.0
// Production-grade email enrichment: every email MUST be verified before delivery.
// Zero-tolerance for bounces. If it can't be verified, it's not returned as a contact.
// Email enrichment: Icypeas first, then MX/pattern verification as a guarded fallback.

export interface EnrichmentInput {
  company_name: string;
  company_domain: string;
  company_website_url?: string;
  company_location?: string;
  company_industry?: string;
  company_size?: string;
  notes?: string;
}

export interface DecisionMaker {
  full_name: string;
  title: string;
  email: string;
  phone?: string;
  linkedin_url?: string;
  photo_url?: string;
  verification_status: 'verified' | 'catch_all' | 'risky' | 'unverifiable' | 'no_email';
  confidence_score: number;
  source: string;
  why_selected: string;
  email_patterns_tried?: number;
}

export interface EnrichmentOutput {
  success: boolean;
  company: {
    name: string;
    domain: string;
    website: string;
    linkedin_url?: string;
    estimated_revenue?: string;
    employee_count?: string;
  };
  status: "enriched" | "rejected" | "needs_review";
  reason?: string;
  decision_makers: DecisionMaker[];
  excluded_emails_found: string[];
  notes?: string;
  verification_summary?: {
    total_candidates: number;
    verified: number;
    catch_all: number;
    failed: number;
    domain_mx_valid: boolean;
  };
}

// Routes SerpAPI requests through Serper.dev (~10× cheaper) when
// SERPER_API_KEY is set; falls back to SerpAPI transparently otherwise.
import { getSerpSearchKey, serpFetch } from "./serp-adapter.tsx";
import { icypeasDomainSearch, icypeasEmailSearch, icypeasVerifyEmail } from "./icypeas.tsx";

// ── Role tiers (expanded) ───────────────────────────────────────────────
const TIER_1_ROLES = [
  "owner", "founder", "co-founder", "cofounder", "ceo", "chief executive",
  "president", "managing partner", "principal", "managing director", "general manager",
  "proprietor"
];
const TIER_2_ROLES = [
  "coo", "chief operating", "cto", "chief technology", "cmo", "chief marketing",
  "cro", "chief revenue", "chief growth", "chief commercial",
  "head of operations", "operations director", "director of operations",
  "operations manager", "vp operations", "vice president operations",
  "head of growth", "head of sales", "head of marketing", "head of business",
  "vp sales", "vp marketing", "vp business development",
  "vice president sales", "vice president marketing"
];
const TIER_3_ROLES = [
  "director", "senior director", "regional director", "area director",
  "vp", "vice president", "senior vice president", "svp", "evp",
  "partner", "senior partner"
];
const TIER_4_ROLES = [
  "cfo", "chief financial", "controller", "finance director", "head of finance",
  "compliance", "risk", "vendor management", "procurement director",
  "head of procurement"
];
const TIER_5_ROLES = [
  "manager", "senior manager", "regional manager", "area manager",
  "general counsel", "head of", "lead", "team lead", "supervisor",
  "coordinator"
];

const ALL_TIERS = [TIER_1_ROLES, TIER_2_ROLES, TIER_3_ROLES, TIER_4_ROLES, TIER_5_ROLES];

export function getRoleTier(title: string): number {
  const lower = title.toLowerCase();
  for (let i = 0; i < ALL_TIERS.length; i++) {
    if (ALL_TIERS[i].some(r => lower.includes(r))) return i + 1;
  }
  return 99;
}

const EXCLUDED_PREFIXES = [
  "info", "contact", "hello", "support", "sales", "admin", "jobs", "careers",
  "office", "inquiries", "hr", "team", "help", "marketing", "media", "press",
  "billing", "accounts", "reception", "frontdesk", "mail", "webmaster", "staff",
  "noreply", "no-reply", "newsletter", "notifications", "service"
];

const BLOCKED_DOMAINS = [
  "yelp.com", "facebook.com", "linkedin.com", "clutch.co", "yellowpages.com",
  "instagram.com", "tiktok.com", "google.com", "apple.com", "microsoft.com",
  "bbb.org", "foursquare.com", "tripadvisor.com", "glassdoor.com"
];

function isExcludedEmail(email: string): boolean {
  const prefix = email.split("@")[0].toLowerCase();
  return EXCLUDED_PREFIXES.some(p => prefix === p || prefix.startsWith(p + "+") || prefix.startsWith(p + "."));
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE VERIFICATION LAYER - Every email must pass through this
// ═══════════════════════════════════════════════════════════════════════════

interface VerificationResult {
  email: string;
  status: 'valid' | 'invalid' | 'catch_all' | 'risky' | 'unknown';
  deliverable: boolean;
}

// In-memory verification cache to avoid burning API credits
const verificationCache = new Map<string, { result: VerificationResult; timestamp: number }>();
const VERIFY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-PROVIDER TRACKING — auto-switch when a provider runs out of credits
// ═══════════════════════════════════════════════════════════════════════════
// Previously these were plain `let` booleans that flipped to `true` on the
// first 402/429 and NEVER RESET. One rate-limited request from any user
// killed enrichment for every subsequent user across the entire Edge Worker
// lifetime (could be hours). Now each provider has a `cooldownUntil` epoch
// and we treat it as "exhausted" only until that timestamp passes — auto-
// healing on the next request after the cooldown window elapses.
const PROVIDER_COOLDOWN_MS = {
  402: 60 * 60 * 1000,        // credit/billing — long cooldown (1h)
  429: 5 * 60 * 1000,         //  rate limit — short cooldown (5m)
  403: 15 * 60 * 1000,        // forbidden/temp ban — medium (15m)
} as const;

const providerCooldowns: Record<'icypeas' | 'hunter', number> = {
  icypeas: 0,
  hunter: 0,
};

function markProviderExhausted(provider: 'icypeas' | 'hunter', status: number) {
  const ms = (PROVIDER_COOLDOWN_MS as Record<number, number>)[status];
  if (!ms) return;
  const wasInCooldown = providerCooldowns[provider] > Date.now();
  providerCooldowns[provider] = Date.now() + ms;
  if (!wasInCooldown) {
    console.warn(
      `[PROVIDER] ${provider} cooldown engaged (HTTP ${status}, ${Math.round(ms / 60000)}m)`,
    );
  }
}

function markIcypeasExhausted(status: number) {
  markProviderExhausted('icypeas', status);
}

function markHunterExhausted(status: number) {
  markProviderExhausted('hunter', status);
}

function isExhausted(provider: 'icypeas' | 'hunter'): boolean {
  return providerCooldowns[provider] > Date.now();
}

function getAvailableProviders(): ('icypeas' | 'hunter')[] {
  const ICYPEAS_API_KEY = Deno.env.get("ICYPEAS_API_KEY");
  const HUNTER_API_KEY = "";
  const providers: ('icypeas' | 'hunter')[] = [];
  if (ICYPEAS_API_KEY && !isExhausted('icypeas')) providers.push('icypeas');
  if (HUNTER_API_KEY && !isExhausted('hunter')) providers.push('hunter');
  return providers;
}

// ═══════════════════════════════════════════════════════════════════════════
// HUNTER.IO API LAYER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hunter.io email verification (alternative to Icypeas verify).
 */
async function hunterVerifyEmail(email: string, apiKey: string): Promise<VerificationResult> {
  try {
    const response = await fetch(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`
    );

    if (!response.ok) {
      markHunterExhausted(response.status);
      console.warn(`[VERIFY-HUNTER] API returned ${response.status} for ${email}`);
      return { email, status: 'unknown', deliverable: false };
    }

    const json = await response.json();
    const data = json.data || {};
    const rawStatus = (data.status || data.result || '').toLowerCase();

    let result: VerificationResult;

    if (rawStatus === 'valid' || rawStatus === 'deliverable') {
      result = { email, status: 'valid', deliverable: true };
      console.log(`[VERIFY-HUNTER] VALID: ${email}`);
    } else if (rawStatus === 'accept_all' || rawStatus === 'accept-all') {
      result = { email, status: 'catch_all', deliverable: true };
      console.log(`[VERIFY-HUNTER] CATCH-ALL: ${email}`);
    } else if (rawStatus === 'risky') {
      result = { email, status: 'risky', deliverable: false };
      console.log(`[VERIFY-HUNTER] RISKY: ${email}`);
    } else {
      result = { email, status: 'invalid', deliverable: false };
      console.log(`[VERIFY-HUNTER] INVALID: ${email} (status: ${rawStatus})`);
    }

    verificationCache.set(email.toLowerCase(), { result, timestamp: Date.now() });
    return result;

  } catch (error) {
    console.warn(`[VERIFY-HUNTER] Failed for ${email}: ${(error as Error).message}`);
    return { email, status: 'unknown', deliverable: false };
  }
}

/**
 * Hunter.io email finder (alternative to Icypeas search/mail).
 */
async function hunterFindEmail(
  firstName: string, lastName: string, domain: string, apiKey: string
): Promise<{ email: string; confidence: number } | null> {
  try {
    const params = new URLSearchParams({
      domain,
      first_name: firstName,
      last_name: lastName,
      api_key: apiKey
    });

    const response = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);

    if (!response.ok) {
      markHunterExhausted(response.status);
      return null;
    }

    const json = await response.json();
    const data = json.data || {};

    if (data.email) {
      console.log(`[HUNTER-FINDER] Found email for ${firstName} ${lastName}@${domain}: ${data.email} (confidence: ${data.confidence || 'unknown'})`);
      return { email: data.email, confidence: data.confidence || 50 };
    }

    return null;
  } catch (error) {
    console.warn(`[HUNTER-FINDER] Failed for ${firstName} ${lastName}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Hunter.io domain search (alternative to Icypeas domain search).
 * Returns contacts at a given domain with names, titles, and emails.
 */
async function hunterDomainSearch(domain: string, apiKey: string, limit = 20): Promise<{
  contacts: { full_name: string; title: string; email: string; phone?: string; linkedin_url?: string; confidence: number }[];
} | null> {
  try {
    const params = new URLSearchParams({
      domain,
      limit: String(limit),
      api_key: apiKey
    });

    const response = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);

    if (!response.ok) {
      markHunterExhausted(response.status);
      const errorText = await response.text();
      console.warn(`[HUNTER-DOMAIN] API returned ${response.status}: ${errorText}`);
      return null;
    }

    const json = await response.json();
    const data = json.data || {};
    const emails = data.emails || [];

    console.log(`[HUNTER-DOMAIN] Found ${emails.length} contacts for ${domain}`);

    const contacts = emails
      .filter((e: any) => {
        const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
        return name.length >= 3 && e.value;
      })
      .map((e: any) => ({
        full_name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        title: e.position || e.seniority || 'Unknown',
        email: e.value,
        phone: e.phone_number || undefined,
        linkedin_url: e.linkedin || undefined,
        confidence: e.confidence || 50,
      }));

    return { contacts };
  } catch (error) {
    console.warn(`[HUNTER-DOMAIN] Failed for ${domain}: ${(error as Error).message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED VERIFICATION — Icypeas is the active provider
// ═══════════════════════════════════════════════════════════════════════════

async function verifyEmailMultiProvider(email: string): Promise<VerificationResult> {
  if (!email || !email.includes('@')) {
    return { email, status: 'invalid', deliverable: false };
  }

  // Check cache first
  const cached = verificationCache.get(email.toLowerCase());
  if (cached && (Date.now() - cached.timestamp) < VERIFY_CACHE_TTL) {
    console.log(`[VERIFY] Cache hit: ${email} = ${cached.result.status}`);
    return cached.result;
  }

  const ICYPEAS_API_KEY = Deno.env.get("ICYPEAS_API_KEY");
  const HUNTER_API_KEY = "";

  // Hunter.io is intentionally disabled. Keep this branch unreachable unless
  // we explicitly re-enable it later.
  if (HUNTER_API_KEY && !isExhausted("hunter")) {
    const result = await hunterVerifyEmail(email, HUNTER_API_KEY);
    if (result.status !== 'unknown') return result;
    // If Hunter returned 'unknown' (error), try Icypeas
  }

  // Fallback to Icypeas
  if (ICYPEAS_API_KEY && !isExhausted("icypeas")) {
    const result = await verifyEmailStrict(email, ICYPEAS_API_KEY);
    if (result.status !== 'unknown') return result;
  }

  return { email, status: 'unknown', deliverable: false };
}

/**
 * Unified email finder — tries Icypeas finder, then pattern+verify.
 */
async function findVerifiedEmailMultiProvider(
  fullName: string,
  domain: string
): Promise<{ email: string; status: VerificationResult['status']; patternsTriedCount: number; source: string } | null> {
  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ");

  const ICYPEAS_API_KEY = Deno.env.get("ICYPEAS_API_KEY");
  const HUNTER_API_KEY = "";

  // ── Strategy 1: Hunter.io email finder (disabled) ──
  if (HUNTER_API_KEY && !isExhausted("hunter") && firstName && lastName) {
    const hunterResult = await hunterFindEmail(firstName, lastName, domain, HUNTER_API_KEY);
    if (hunterResult) {
      const verification = await verifyEmailMultiProvider(hunterResult.email);
      if (verification.deliverable) {
        console.log(`[FIND] Hunter finder → verified: ${hunterResult.email}`);
        return { email: hunterResult.email, status: verification.status, patternsTriedCount: 0, source: 'hunter_finder' };
      }
    }
  }

  // ── Strategy 1: Icypeas email finder ──
  if (ICYPEAS_API_KEY && !isExhausted("icypeas") && firstName && lastName) {
    try {
      const result = await icypeasEmailSearch(firstName, lastName, domain);
      const foundEmail = result?.email;
      if (foundEmail) {
        const verification = await verifyEmailMultiProvider(foundEmail);
        if (verification.deliverable) {
          console.log(`[FIND] Icypeas finder → verified: ${foundEmail}`);
          return { email: foundEmail, status: verification.status, patternsTriedCount: 0, source: 'icypeas_finder' };
        }
      }
    } catch (error) {
      console.warn(`[FIND] Icypeas finder error: ${(error as Error).message}`);
    }
  }

  // ── Strategy 3: Pattern generation + multi-provider verification ──
  const patterns = generateEmailPatterns(fullName, domain);
  if (patterns.length === 0) return null;

  console.log(`[FIND] Trying ${patterns.length} email patterns for ${fullName}@${domain}`);

  for (let i = 0; i < patterns.length; i += 3) {
    const batch = patterns.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(email => verifyEmailMultiProvider(email))
    );

    for (const result of results) {
      if (result.deliverable) {
        console.log(`[FIND] Pattern match → verified: ${result.email} (${result.status})`);
        return { email: result.email, status: result.status, patternsTriedCount: i + results.indexOf(result) + 1, source: 'pattern_verified' };
      }
    }

    if (i === 0) {
      const allInvalid = results.every(r => r.status === 'invalid');
      if (allInvalid && patterns.length > 6) {
        console.log(`[FIND] First 3 patterns all invalid for ${domain}, stopping early`);
        return null;
      }
    }
  }

  console.log(`[FIND] No verified email found for ${fullName}@${domain}`);
  return null;
}

/**
 * Verify a single email through Icypeas' verification API.
 * This is the ONLY source of truth for whether an email is deliverable.
 */
async function verifyEmailStrict(email: string, apiKey: string): Promise<VerificationResult> {
  if (!email || !email.includes('@')) {
    return { email, status: 'invalid', deliverable: false };
  }

  // Check cache first
  const cached = verificationCache.get(email.toLowerCase());
  if (cached && (Date.now() - cached.timestamp) < VERIFY_CACHE_TTL) {
    console.log(`[VERIFY] Cache hit: ${email} = ${cached.result.status}`);
    return cached.result;
  }

  try {
    const result = await icypeasVerifyEmail(email);
    if (result.deliverable) console.log(`[VERIFY] ${result.status.toUpperCase()}: ${email}`);
    else console.log(`[VERIFY] ${result.status.toUpperCase()}: ${email} - excluded`);

    // Cache the result
    verificationCache.set(email.toLowerCase(), { result, timestamp: Date.now() });
    return result;

  } catch (error) {
    console.warn(`[VERIFY] Verification failed for ${email}: ${(error as Error).message}`);
    return { email, status: 'unknown', deliverable: false };
  }
}

/**
 * Check if a domain has valid MX records (can receive email at all).
 * Uses Google DNS-over-HTTPS for reliability in serverless.
 */
const mxCache = new Map<string, { valid: boolean; timestamp: number }>();

async function checkDomainMX(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain);
  if (cached && (Date.now() - cached.timestamp) < VERIFY_CACHE_TTL) {
    return cached.valid;
  }

  try {
    const dnsUrl = `https://dns.google/resolve?name=${domain}&type=MX`;
    const response = await fetch(dnsUrl, {
      headers: { 'Accept': 'application/dns-json' }
    });

    if (!response.ok) {
      mxCache.set(domain, { valid: true, timestamp: Date.now() }); // fail open
      return true;
    }

    const data = await response.json();
    const hasMX = data.Answer && data.Answer.some((a: any) => a.type === 15);

    if (!hasMX) {
      // Fallback: check for A record
      const aUrl = `https://dns.google/resolve?name=${domain}&type=A`;
      const aResponse = await fetch(aUrl, { headers: { 'Accept': 'application/dns-json' } });
      const aData = await aResponse.json();
      const hasA = aData.Answer && aData.Answer.some((a: any) => a.type === 1);

      mxCache.set(domain, { valid: hasA, timestamp: Date.now() });

      if (!hasA) {
        console.log(`[VERIFY] Domain ${domain} has NO mail servers (no MX or A records)`);
      }
      return hasA;
    }

    mxCache.set(domain, { valid: true, timestamp: Date.now() });
    return true;
  } catch (error) {
    console.warn(`[VERIFY] MX check failed for ${domain}: ${(error as Error).message}`);
    mxCache.set(domain, { valid: true, timestamp: Date.now() }); // fail open
    return true;
  }
}

/**
 * Generate all common email patterns for a person at a domain.
 * Returns patterns in order of most common to least common.
 */
function generateEmailPatterns(fullName: string, domain: string): string[] {
  const parts = fullName.toLowerCase().trim().split(/\s+/).filter(p => p.length > 1);
  if (parts.length < 2) return [];

  const first = parts[0].replace(/[^a-z]/g, '');
  const last = parts[parts.length - 1].replace(/[^a-z]/g, '');

  if (!first || !last) return [];

  return [
    `${first}.${last}@${domain}`,      // john.smith@
    `${first}${last}@${domain}`,        // johnsmith@
    `${first[0]}${last}@${domain}`,     // jsmith@
    `${first}@${domain}`,               // john@
    `${first}${last[0]}@${domain}`,     // johns@
    `${first[0]}.${last}@${domain}`,    // j.smith@
    `${first}_${last}@${domain}`,       // john_smith@
    `${last}.${first}@${domain}`,       // smith.john@
    `${last}${first}@${domain}`,        // smithjohn@
    `${first}-${last}@${domain}`,       // john-smith@
  ];
}

/**
 * Try multiple email patterns and verify each until we find a deliverable one.
 * This is the production-grade approach for Apollo/LinkedIn-sourced contacts.
 */
async function findVerifiedEmail(
  fullName: string,
  domain: string,
  apiKey: string
): Promise<{ email: string; status: VerificationResult['status']; patternsTriedCount: number } | null> {
  // First, try Icypeas' email finder API.
  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ");

  if (firstName && lastName) {
    try {
      const result = await icypeasEmailSearch(firstName, lastName, domain);
      const foundEmail = result?.email;

      if (foundEmail) {
        const verification = await verifyEmailStrict(foundEmail, apiKey);
        if (verification.deliverable) {
          console.log(`[VERIFY] Icypeas finder found verified email: ${foundEmail}`);
          return { email: foundEmail, status: verification.status, patternsTriedCount: 0 };
        }
        console.log(`[VERIFY] Icypeas finder email ${foundEmail} failed verification (${verification.status})`);
      }
    } catch (error) {
      console.warn(`[VERIFY] Icypeas email finder failed for ${fullName}: ${(error as Error).message}`);
    }
  }

  // Provider finder didn't work, try email pattern generation + verification
  const patterns = generateEmailPatterns(fullName, domain);
  console.log(`[VERIFY] Trying ${patterns.length} email patterns for ${fullName}@${domain}`);

  // Verify patterns in batches of 3 to be efficient
  for (let i = 0; i < patterns.length; i += 3) {
    const batch = patterns.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(email => verifyEmailStrict(email, apiKey))
    );

    for (const result of results) {
      if (result.deliverable) {
        console.log(`[VERIFY] Found verified email via pattern: ${result.email} (${result.status})`);
        return { email: result.email, status: result.status, patternsTriedCount: i + results.indexOf(result) + 1 };
      }
    }

    // If the first 3 common patterns all fail, the rest are very unlikely to work
    // Unless it's a catch-all domain (which would pass on the first try anyway)
    if (i === 0) {
      // Check if all failed with 'invalid' - if so, stop early
      const allInvalid = results.every(r => r.status === 'invalid');
      if (allInvalid && patterns.length > 6) {
        console.log(`[VERIFY] First 3 patterns all invalid for ${domain}, stopping early`);
        return null;
      }
    }
  }

  console.log(`[VERIFY] No verified email found for ${fullName}@${domain} after ${patterns.length} patterns`);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENRICHMENT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export async function enrichLeadWithIcypeas(input: EnrichmentInput): Promise<EnrichmentOutput> {
  const ICYPEAS_API_KEY = Deno.env.get("ICYPEAS_API_KEY");
  const HUNTER_API_KEY = "";

  const providers = getAvailableProviders();
  console.log(`[ENRICH] Available providers: ${providers.length > 0 ? providers.join(', ') : 'NONE'}`);

  // 1) Validate lead before enrichment
  if (!input.company_domain || BLOCKED_DOMAINS.some(d => input.company_domain.toLowerCase().includes(d))) {
    return {
      success: false,
      company: { name: input.company_name, domain: input.company_domain || "", website: input.company_website_url || "" },
      status: "rejected",
      reason: "missing_or_invalid_company_domain",
      decision_makers: [],
      excluded_emails_found: []
    };
  }

  if (!ICYPEAS_API_KEY && !HUNTER_API_KEY) {
    return {
      success: false,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: "needs_review",
      reason: "NO_ENRICHMENT_API_KEYS — set ICYPEAS_API_KEY",
      decision_makers: [],
      excluded_emails_found: []
    };
  }

  // 1.5) MX record check
  const domainCanReceiveEmail = await checkDomainMX(input.company_domain);
  if (!domainCanReceiveEmail) {
    return {
      success: false,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: "rejected",
      reason: "domain_has_no_mail_servers",
      decision_makers: [],
      excluded_emails_found: [],
      notes: `Domain ${input.company_domain} has no MX or A records. Cannot receive email.`,
      verification_summary: { total_candidates: 0, verified: 0, catch_all: 0, failed: 0, domain_mx_valid: false }
    };
  }

  // 2) Company intelligence in parallel
  const companyIntel = await searchCompanyIntelligence(input);

  // 3) Domain search — Icypeas is the active provider
  let domainSearchResult: EnrichmentOutput | null = null;

  if (HUNTER_API_KEY && !isExhausted("hunter")) {
    domainSearchResult = await tryHunterDomainSearchEnrich(input, HUNTER_API_KEY);
  }

  if (!domainSearchResult?.decision_makers?.length && ICYPEAS_API_KEY && !isExhausted("icypeas")) {
    console.log(`[ENRICH] Trying Icypeas domain search...`);
    domainSearchResult = await tryIcypeasDomainSearch(input, ICYPEAS_API_KEY);
  }

  // 4) Apollo.io via SerpAPI — uses multi-provider email finding
  const apolloResult = !domainSearchResult?.decision_makers?.length
    ? await findDecisionMakerViaSerpApiMulti(input)
    : null;

  // 5) LinkedIn via SerpAPI — uses multi-provider email finding
  const linkedinResult = (!domainSearchResult?.decision_makers?.length && !apolloResult?.decision_makers?.length)
    ? await findDecisionMakerViaLinkedInMulti(input)
    : null;

  // 6) Merge results from all sources
  const allDMs: DecisionMaker[] = [];
  const allExcluded: string[] = [];
  let totalCandidates = 0;

  for (const result of [domainSearchResult, apolloResult, linkedinResult]) {
    if (!result) continue;
    for (const dm of result.decision_makers) {
      if (!allDMs.some(existing => existing.email.toLowerCase() === dm.email.toLowerCase())) {
        allDMs.push(dm);
      }
    }
    allExcluded.push(...result.excluded_emails_found);
    totalCandidates += result.verification_summary?.total_candidates || 0;
  }

  const deliverableContacts = allDMs.filter(
    dm => dm.verification_status === 'verified' || dm.verification_status === 'catch_all'
  );

  deliverableContacts.sort((a, b) => {
    const tierDiff = getRoleTier(a.title) - getRoleTier(b.title);
    if (tierDiff !== 0) return tierDiff;
    return b.confidence_score - a.confidence_score;
  });

  const topContacts = deliverableContacts.slice(0, 3);
  const withLinkedIn = await backfillLinkedInUrls(topContacts, input.company_name);

  const verifiedCount = withLinkedIn.filter(dm => dm.verification_status === 'verified').length;
  const catchAllCount = withLinkedIn.filter(dm => dm.verification_status === 'catch_all').length;
  const providerNote = isExhausted("icypeas") ? ' (Icypeas exhausted)' : '';

  const verificationSummary = {
    total_candidates: totalCandidates,
    verified: verifiedCount,
    catch_all: catchAllCount,
    failed: totalCandidates - verifiedCount - catchAllCount,
    domain_mx_valid: true
  };

  if (withLinkedIn.length > 0) {
    return mergeCompanyIntel({
      success: true,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: "enriched",
      decision_makers: withLinkedIn,
      excluded_emails_found: allExcluded.slice(0, 5),
      notes: (catchAllCount > 0
        ? `${verifiedCount} verified email${verifiedCount !== 1 ? 's' : ''}, ${catchAllCount} on catch-all domain.`
        : `${verifiedCount} verified email${verifiedCount !== 1 ? 's' : ''} found.`) + providerNote,
      verification_summary: verificationSummary
    }, companyIntel);
  }

  return mergeCompanyIntel({
    success: false,
    company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
    status: "needs_review",
    reason: "no_verified_emails_found",
    decision_makers: [],
    excluded_emails_found: allExcluded.slice(0, 5),
    notes: `Searched ${providers.join(', ') || 'no providers available'}, Apollo, and LinkedIn. Found ${totalCandidates} candidate${totalCandidates !== 1 ? 's' : ''} but none passed verification.`,
    verification_summary: verificationSummary
  }, companyIntel);
}

// ── Company Intelligence Search (Revenue, LinkedIn, Employee Count) ─────
interface CompanyIntel {
  linkedin_url?: string;
  estimated_revenue?: string;
  employee_count?: string;
}

function mergeCompanyIntel(result: EnrichmentOutput, intel: CompanyIntel): EnrichmentOutput {
  return {
    ...result,
    company: {
      ...result.company,
      linkedin_url: intel.linkedin_url || result.company.linkedin_url,
      estimated_revenue: intel.estimated_revenue || result.company.estimated_revenue,
      employee_count: intel.employee_count || result.company.employee_count,
    }
  };
}

async function searchCompanyIntelligence(input: EnrichmentInput): Promise<CompanyIntel> {
  const SERPAPI_API_KEY = getSerpSearchKey();
  if (!SERPAPI_API_KEY) return {};

  const intel: CompanyIntel = {};

  try {
    const [linkedinData, revenueData] = await Promise.allSettled([
      searchCompanyLinkedIn(input.company_name, input.company_domain, SERPAPI_API_KEY),
      searchCompanyRevenue(input.company_name, input.company_domain, SERPAPI_API_KEY),
    ]);

    if (linkedinData.status === "fulfilled" && linkedinData.value) {
      intel.linkedin_url = linkedinData.value;
    }

    if (revenueData.status === "fulfilled" && revenueData.value) {
      intel.estimated_revenue = revenueData.value.revenue;
      intel.employee_count = revenueData.value.employees;
    }

    console.log(`[ENRICH] Company intel for ${input.company_name}: LinkedIn=${intel.linkedin_url || 'none'}, Revenue=${intel.estimated_revenue || 'none'}, Employees=${intel.employee_count || 'none'}`);
  } catch (err) {
    console.warn(`[ENRICH] Company intelligence search failed:`, (err as Error).message);
  }

  return intel;
}

async function searchCompanyLinkedIn(companyName: string, domain: string, apiKey: string): Promise<string | null> {
  try {
    const query = `site:linkedin.com/company "${companyName}" OR site:linkedin.com/company "${domain.replace(/\.\w+$/, '')}"`;
    const params = new URLSearchParams({ engine: "google", q: query, api_key: apiKey, num: "5" });

    const response = await serpFetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) return null;

    const data = await response.json();
    const results = data.organic_results || [];

    for (const r of results) {
      const link = r.link || "";
      if (link.match(/linkedin\.com\/company\/[a-z0-9-]+/i)) {
        return link;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function searchCompanyRevenue(companyName: string, domain: string, apiKey: string): Promise<{ revenue?: string; employees?: string } | null> {
  try {
    const query = `"${companyName}" "${domain}" (revenue OR "annual revenue" OR "estimated revenue" OR employees OR "company size")`;
    const params = new URLSearchParams({ engine: "google", q: query, api_key: apiKey, num: "10" });

    const response = await serpFetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) return null;

    const data = await response.json();
    const results = data.organic_results || [];

    let revenue: string | undefined;
    let employees: string | undefined;

    if (data.answer_box) {
      const answerText = JSON.stringify(data.answer_box).toLowerCase();
      const revMatch = answerText.match(/revenue[:\s]*\$?([\d,.]+\s*(?:million|billion|m|b|k))/i);
      if (revMatch) revenue = revMatch[1].trim();
    }

    for (const r of results) {
      const snippet = (r.snippet || "").toLowerCase();
      const title = (r.title || "").toLowerCase();
      const combined = `${title} ${snippet}`;

      if (!revenue) {
        const revenuePatterns = [
          /(?:revenue|annual revenue|estimated revenue)[:\s]*\$?([\d,.]+\s*(?:million|billion|m|b|k))/i,
          /\$\s*([\d,.]+\s*(?:million|billion|m|b))\s*(?:in\s+)?(?:revenue|annual|yearly)/i,
          /(?:revenue|sales)[:\s]*\$\s*([\d,.]+\s*(?:million|billion|m|b|k))/i,
          /(?:generates?|earns?|makes?)\s*\$\s*([\d,.]+\s*(?:million|billion|m|b|k))/i,
          /\$([\d,.]+(?:m|b|k))\s*(?:in\s+)?(?:revenue|sales)/i,
        ];
        for (const pattern of revenuePatterns) {
          const match = combined.match(pattern);
          if (match) {
            revenue = `$${match[1].trim()}`
              .replace(/\s*million/i, 'M').replace(/\s*billion/i, 'B').replace(/\s*thousand/i, 'K')
              .replace(/(\d)m$/i, '$1M').replace(/(\d)b$/i, '$1B').replace(/(\d)k$/i, '$1K');
            break;
          }
        }
      }

      if (!employees) {
        const empPatterns = [
          /(\d[\d,]*)\s*(?:\+\s*)?(?:employees|staff|workers|team members)/i,
          /(?:employees|staff|team|headcount|company size)[:\s]*(\d[\d,]*)/i,
          /(?:has|with|over|about|approximately)\s*(\d[\d,]*)\s*(?:\+\s*)?(?:employees|people|staff)/i,
          /([\d,]+-[\d,]+)\s*employees/i,
        ];
        for (const pattern of empPatterns) {
          const match = combined.match(pattern);
          if (match) { employees = match[1].trim(); break; }
        }
      }

      if (revenue && employees) break;
    }

    if (revenue || employees) return { revenue, employees };
    return null;
  } catch (err) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ICYPEAS DOMAIN SEARCH (Fallback) - WITH STRICT VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

async function tryIcypeasDomainSearch(input: EnrichmentInput, apiKey: string): Promise<EnrichmentOutput | null> {
  try {
    console.log(`[ENRICH] Icypeas domain search for ${input.company_domain}...`);

    const contacts = await icypeasDomainSearch(input.company_domain);

    console.log(`[ENRICH] Icypeas returned ${contacts.length} contacts for ${input.company_domain}`);

    if (contacts.length === 0) return null;

    const candidates: { dm: DecisionMaker; roleTier: number; originalEmail: string }[] = [];
    const excludedEmails: string[] = [];
    let totalCandidates = 0;

    for (const contact of contacts) {
      const email = contact.email;
      if (!email) continue;

      const title = (contact.position || contact.title || contact.job_title || "").toLowerCase();
      const name = contact.full_name || contact.name || `${contact.first_name || ""} ${contact.last_name || ""}`.trim();

      // Skip contacts without real names
      if (!name || name === "Unknown" || name.trim().length < 3) continue;

      // Check excluded email prefixes
      if (isExcludedEmail(email)) {
        excludedEmails.push(email);
        continue;
      }

      totalCandidates++;

      const roleTier = title ? getRoleTier(title) : 99;

      candidates.push({
        dm: {
          full_name: name,
          title: contact.position || contact.title || contact.job_title || "Unknown",
          email: email,
          phone: contact.phone_number || contact.phone || contact.direct_phone,
          linkedin_url: contact.linkedin_url || contact.linkedin || contact.li_url || contact.social_linkedin || contact.linkedin_profile || undefined,
          verification_status: 'unverifiable', // Will be updated after verification
          confidence_score: 0, // Will be set based on verification
          source: "icypeas",
          why_selected: roleTier < 99 ? `Tier ${roleTier} role match: ${title}` : "Personal contact at company"
        },
        roleTier,
        originalEmail: email
      });
    }

    // Sort by role tier (best roles first)
    candidates.sort((a, b) => a.roleTier - b.roleTier);

    // Take top 6 candidates and verify their emails
    const topCandidates = candidates.slice(0, 6);
    console.log(`[ENRICH] Verifying ${topCandidates.length} candidate emails from Icypeas...`);

    const verifiedDMs: DecisionMaker[] = [];

    for (const candidate of topCandidates) {
      const verification = await verifyEmailStrict(candidate.originalEmail, apiKey);

      if (verification.deliverable) {
        verifiedDMs.push({
          ...candidate.dm,
          email: candidate.originalEmail,
          verification_status: verification.status === 'catch_all' ? 'catch_all' : 'verified',
          confidence_score: verification.status === 'valid' ? 95 : (verification.status === 'catch_all' ? 70 : 60),
        });
        console.log(`  [OK] ${candidate.dm.full_name} (${candidate.dm.title}) - ${candidate.originalEmail} = ${verification.status}`);
      } else {
        console.log(`  [FAIL] ${candidate.dm.full_name} - ${candidate.originalEmail} = ${verification.status}`);

        // If the direct email failed, try to find a verified alternative via patterns
        const altResult = await findVerifiedEmail(candidate.dm.full_name, input.company_domain, apiKey);
        if (altResult && altResult.email !== candidate.originalEmail) {
          verifiedDMs.push({
            ...candidate.dm,
            email: altResult.email,
            verification_status: altResult.status === 'catch_all' ? 'catch_all' : 'verified',
            confidence_score: altResult.status === 'valid' ? 90 : 65,
            email_patterns_tried: altResult.patternsTriedCount,
          });
          console.log(`  [RECOVERED] Found alt email for ${candidate.dm.full_name}: ${altResult.email}`);
        }
      }

      // Cap at 3 verified contacts
      if (verifiedDMs.length >= 3) break;
    }

    const verifiedCount = verifiedDMs.filter(dm => dm.verification_status === 'verified').length;
    const catchAllCount = verifiedDMs.filter(dm => dm.verification_status === 'catch_all').length;

    return {
      success: verifiedDMs.length > 0,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: verifiedDMs.length > 0 ? "enriched" : "needs_review",
      reason: verifiedDMs.length === 0 ? "icypeas_contacts_failed_verification" : undefined,
      decision_makers: verifiedDMs,
      excluded_emails_found: excludedEmails.slice(0, 5),
      notes: verifiedDMs.length === 0
        ? `Found ${totalCandidates} contacts but none passed email verification.`
        : undefined,
      verification_summary: {
        total_candidates: totalCandidates,
        verified: verifiedCount,
        catch_all: catchAllCount,
        failed: totalCandidates - verifiedCount - catchAllCount,
        domain_mx_valid: true
      }
    };

  } catch (error) {
    console.warn("[ENRICH] Icypeas domain search failed:", (error as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APOLLO via SERPAPI (Fallback 1) - WITH STRICT VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

async function findDecisionMakerViaSerpApi(input: EnrichmentInput, icypeasApiKey: string): Promise<EnrichmentOutput | null> {
  const SERPAPI_API_KEY = getSerpSearchKey();
  if (!SERPAPI_API_KEY) return null;

  console.log(`[ENRICH] Searching Apollo.io via SerpAPI for: ${input.company_name} (${input.company_domain})`);

  const targetRolesQuery = "(CEO OR Founder OR Owner OR President OR Director OR VP OR Head OR Manager OR Partner)";
  const query = `site:apollo.io/people "${input.company_name}" ${targetRolesQuery}`;

  const params = new URLSearchParams({
    engine: "google", q: query, api_key: SERPAPI_API_KEY, num: "15"
  });

  try {
    const response = await serpFetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);

    const data = await response.json();
    const results = data.organic_results || [];

    console.log(`[ENRICH] Apollo SerpAPI returned ${results.length} results`);

    const candidates: { name: string; title: string; roleTier: number; linkedinUrl?: string }[] = [];

    for (const result of results) {
      const titleSnippet = result.title || "";
      const snippet = result.snippet || "";

      const cleanTitle = titleSnippet
        .replace(/\s*\|\s*Apollo\.io/i, "")
        .replace(/\s*-\s*Apollo\.io/i, "")
        .replace(/\s*·\s*Apollo\.io/i, "");

      const parts = cleanTitle.split(/ - | – | \| | at /);

      if (parts.length >= 2) {
        let name = parts[0].trim();
        let jobTitle = parts[1].trim();

        if (!jobTitle || jobTitle.length < 3) {
          const snippetMatch = snippet.match(/(?:is|as)\s+(?:a\s+|the\s+)?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
          if (snippetMatch) jobTitle = snippetMatch[1];
        }

        if (!isValidPersonName(name)) continue;

        const roleTier = getRoleTier(jobTitle);
        if (roleTier === 99) continue;

        candidates.push({
          name,
          title: jobTitle,
          roleTier,
          linkedinUrl: result.link?.includes("apollo.io") ? undefined : result.link,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Deduplicate by name
    const uniqueCandidates = candidates.filter((c, i, self) =>
      i === self.findIndex(t => t.name.toLowerCase() === c.name.toLowerCase())
    );

    // Sort by role tier
    uniqueCandidates.sort((a, b) => a.roleTier - b.roleTier);

    console.log(`[ENRICH] Verifying emails for ${uniqueCandidates.length} Apollo candidates...`);

    const verifiedDMs: DecisionMaker[] = [];
    let totalCandidates = 0;

    // Try to find verified emails for top candidates
    for (const candidate of uniqueCandidates.slice(0, 5)) {
      totalCandidates++;
      const emailResult = await findVerifiedEmail(candidate.name, input.company_domain, icypeasApiKey);

      if (emailResult) {
        verifiedDMs.push({
          full_name: candidate.name,
          title: candidate.title,
          email: emailResult.email,
          linkedin_url: candidate.linkedinUrl,
          verification_status: emailResult.status === 'catch_all' ? 'catch_all' : 'verified',
          confidence_score: emailResult.status === 'valid' ? 90 : 65,
          source: "apollo_serpapi+icypeas_verified",
          why_selected: `Tier ${candidate.roleTier} match from Apollo, email verified via Icypeas`,
          email_patterns_tried: emailResult.patternsTriedCount,
        });
        console.log(`  [OK] ${candidate.name}: ${emailResult.email} (${emailResult.status})`);
      } else {
        console.log(`  [FAIL] ${candidate.name}: no verified email found`);
      }

      if (verifiedDMs.length >= 3) break;
    }

    if (verifiedDMs.length === 0) return null;

    return {
      success: true,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: "enriched",
      decision_makers: verifiedDMs,
      excluded_emails_found: [],
      notes: `Found via Apollo.io, all emails verified through Icypeas.`,
      verification_summary: {
        total_candidates: totalCandidates,
        verified: verifiedDMs.filter(dm => dm.verification_status === 'verified').length,
        catch_all: verifiedDMs.filter(dm => dm.verification_status === 'catch_all').length,
        failed: totalCandidates - verifiedDMs.length,
        domain_mx_valid: true
      }
    };

  } catch (error) {
    console.warn(`[ENRICH] Apollo SerpAPI search failed: ${(error as Error).message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN via SERPAPI (Fallback 2) - WITH STRICT VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

async function findDecisionMakerViaLinkedIn(input: EnrichmentInput, icypeasApiKey: string): Promise<EnrichmentOutput | null> {
  const SERPAPI_API_KEY = getSerpSearchKey();
  if (!SERPAPI_API_KEY) return null;

  console.log(`[ENRICH] Searching LinkedIn via SerpAPI for: ${input.company_name}`);

  const query = `site:linkedin.com/in "${input.company_name}" (CEO OR Founder OR Owner OR Director OR Manager OR President OR VP OR Head)`;

  const params = new URLSearchParams({
    engine: "google", q: query, api_key: SERPAPI_API_KEY, num: "10"
  });

  try {
    const response = await serpFetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);

    const data = await response.json();
    const results = data.organic_results || [];

    console.log(`[ENRICH] LinkedIn SerpAPI returned ${results.length} results`);

    const candidates: { name: string; title: string; roleTier: number; linkedinUrl?: string }[] = [];

    for (const result of results) {
      const titleSnippet = result.title || "";
      const snippet = result.snippet || "";
      const link = result.link || "";

      const cleanTitle = titleSnippet
        .replace(/\s*\|\s*LinkedIn/i, "")
        .replace(/\s*-\s*LinkedIn/i, "");

      const parts = cleanTitle.split(/ - | – | \| /);

      if (parts.length >= 2) {
        const name = parts[0].trim();
        let jobTitle = parts[1].trim();

        if (!isValidPersonName(name)) continue;

        // Verify this person is actually at the target company
        const companyNameLower = input.company_name.toLowerCase();
        const allText = `${titleSnippet} ${snippet}`.toLowerCase();
        const companyWords = companyNameLower.split(/\s+/).filter(w => w.length > 2);
        const matchesCompany = companyWords.some(w => allText.includes(w));
        if (!matchesCompany) continue;

        const roleTier = getRoleTier(jobTitle);
        if (roleTier === 99) continue;

        candidates.push({
          name,
          title: jobTitle,
          roleTier,
          linkedinUrl: link.includes("linkedin.com") ? link : undefined,
        });
      }
    }

    if (candidates.length === 0) return null;

    const uniqueCandidates = candidates.filter((c, i, self) =>
      i === self.findIndex(t => t.name.toLowerCase() === c.name.toLowerCase())
    );

    uniqueCandidates.sort((a, b) => a.roleTier - b.roleTier);

    console.log(`[ENRICH] Verifying emails for ${uniqueCandidates.length} LinkedIn candidates...`);

    const verifiedDMs: DecisionMaker[] = [];
    let totalCandidates = 0;

    for (const candidate of uniqueCandidates.slice(0, 4)) {
      totalCandidates++;
      const emailResult = await findVerifiedEmail(candidate.name, input.company_domain, icypeasApiKey);

      if (emailResult) {
        verifiedDMs.push({
          full_name: candidate.name,
          title: candidate.title,
          email: emailResult.email,
          linkedin_url: candidate.linkedinUrl,
          verification_status: emailResult.status === 'catch_all' ? 'catch_all' : 'verified',
          confidence_score: emailResult.status === 'valid' ? 88 : 62,
          source: "linkedin_serpapi+icypeas_verified",
          why_selected: `Tier ${candidate.roleTier} match from LinkedIn, email verified via Icypeas`,
          email_patterns_tried: emailResult.patternsTriedCount,
        });
      }

      if (verifiedDMs.length >= 3) break;
    }

    if (verifiedDMs.length === 0) return null;

    return {
      success: true,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: "enriched",
      decision_makers: verifiedDMs,
      excluded_emails_found: [],
      notes: `Found via LinkedIn, all emails verified through Icypeas.`,
      verification_summary: {
        total_candidates: totalCandidates,
        verified: verifiedDMs.filter(dm => dm.verification_status === 'verified').length,
        catch_all: verifiedDMs.filter(dm => dm.verification_status === 'catch_all').length,
        failed: totalCandidates - verifiedDMs.length,
        domain_mx_valid: true
      }
    };

  } catch (error) {
    console.warn(`[ENRICH] LinkedIn SerpAPI search failed: ${(error as Error).message}`);
    return null;
  }
}

// ── Backfill LinkedIn URLs ──────────────────────────────────────────────
async function backfillLinkedInUrls(dms: DecisionMaker[], companyName: string): Promise<DecisionMaker[]> {
  const SERPAPI_API_KEY = getSerpSearchKey();
  if (!SERPAPI_API_KEY) return dms;

  const results: DecisionMaker[] = [];

  for (const dm of dms) {
    if (dm.linkedin_url) {
      results.push(dm);
      continue;
    }

    try {
      const query = `site:linkedin.com/in "${dm.full_name}" "${companyName}"`;
      const params = new URLSearchParams({ engine: "google", q: query, api_key: SERPAPI_API_KEY, num: "3" });

      const response = await serpFetch(`https://serpapi.com/search?${params}`);
      if (!response.ok) {
        results.push(dm);
        continue;
      }

      const data = await response.json();
      const organic = data.organic_results || [];
      let foundUrl: string | undefined;

      for (const r of organic) {
        const link = r.link || "";
        if (link.match(/linkedin\.com\/in\/[a-z0-9-]+/i)) {
          const allText = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();
          const nameParts = dm.full_name.toLowerCase().split(/\s+/);
          const nameMatch = nameParts.some(part => part.length > 2 && allText.includes(part));
          if (nameMatch) { foundUrl = link; break; }
        }
      }

      results.push(foundUrl ? { ...dm, linkedin_url: foundUrl } : dm);
    } catch (error) {
      results.push(dm);
    }
  }

  return results;
}

// ── Helpers ────────────────────────────────────────────────────────────
export function isValidPersonName(name: string): boolean {
  const INVALID_NAME_PATTERNS = [
    'property', 'management', 'service', 'company', 'business', 'contact',
    'email', 'phone', 'address', 'data', 'our', 'your', 'the', 'for', 'and',
    'into', 'being', 'from', 'with', 'site', 'page', 'home', 'about', 'team',
    'staff', 'member', 'employee', 'reporting', 'protecting', 'serving',
    'providing', 'offering', 'renters', 'tenants', 'landlord', 'profile',
    'login', 'signup', 'apollo', 'linkedin', 'directory', 'search', 'results',
    'people', 'company', 'solutions', 'inc.', 'llc', 'corp', 'group', 'agency'
  ];

  const nameLower = name.toLowerCase();
  const parts = name.trim().split(/\s+/);

  if (parts.length < 2) return false;
  if (parts.some(p => p.length < 2)) return false;
  if (INVALID_NAME_PATTERNS.some(pattern => nameLower.includes(pattern))) return false;
  if (/\d/.test(name)) return false;
  if (name.length > 50) return false;

  return true;
}

// ── Standalone verification (exposed for lead-engine.tsx to use) ────────
export async function verifyEmailExport(email: string): Promise<{
  email: string;
  status: string;
  deliverable: boolean;
}> {
  // Use unified multi-provider verification
  return verifyEmailMultiProvider(email);
}

function deduplicateByName(dms: DecisionMaker[]): DecisionMaker[] {
  return dms.filter((dm, index, self) =>
    index === self.findIndex((t) => t.full_name.toLowerCase() === dm.full_name.toLowerCase())
  );
}

// ── Quick Contact Discovery (for search-time decision maker surfacing) ──
/**
 * Lightweight contact discovery: Icypeas → Hunter.io fallback.
 * Returns contacts with names and titles WITHOUT email verification.
 * Used during search to surface decision makers before full enrichment.
 */
export async function quickDiscoverContacts(domain: string): Promise<{
  full_name: string;
  title: string;
  email?: string;
  linkedin_url?: string;
  role_tier: number;
}[]> {
  type QuickContact = { full_name: string; title: string; email?: string; linkedin_url?: string; role_tier: number };

  // ── Try Icypeas first ──
  const ICYPEAS_API_KEY = Deno.env.get("ICYPEAS_API_KEY");
  if (ICYPEAS_API_KEY && !isExhausted("icypeas")) {
    try {
      const contacts = await icypeasDomainSearch(domain);
      const initial: QuickContact[] = contacts
        .filter((c: any) => {
          const name = c.full_name || c.name || `${c.first_name || ""} ${c.last_name || ""}`.trim();
          const email = c.email || "";
          return name && name.length >= 3 && name !== "Unknown" &&
                 (!email || !isExcludedEmail(email)) && isValidPersonName(name);
        })
        .map((c: any) => {
          const name = c.full_name || c.name || `${c.first_name || ""} ${c.last_name || ""}`.trim();
          const title = c.position || c.title || c.job_title || "Unknown";
          return {
            full_name: name, title,
            email: c.email || undefined,
            linkedin_url: c.linkedin_url || c.linkedin || c.li_url || c.social_linkedin || undefined,
            role_tier: getRoleTier(title)
          };
        })
        .sort((a: QuickContact, b: QuickContact) => a.role_tier - b.role_tier)
        .slice(0, 8);

      // NOTE: Per-contact Icypeas Email Finder backfill used to run
      // here, but it pushed the request over Supabase's CPU-time limit
      // (10s hard cap) and the WHOLE pipeline died with 'CPU Time
      // exceeded' — leads showed up then vanished.
      //
      // Email backfill is now exposed as a separate, on-demand
      // endpoint (POST /enrich/email-find) that the frontend's "Retry"
      // button under each "No email found" row calls one at a time.
      // Same provider, no batch fan-out, fits inside the per-request
      // budget.
      if (initial.length > 0) return initial;
    } catch { /* fall through to Hunter */ }
  }

  // ── Fallback to Hunter.io ──
  const HUNTER_API_KEY = "";
  if (HUNTER_API_KEY && !isExhausted("hunter")) {
    try {
      const hunterResult = await hunterDomainSearch(domain, HUNTER_API_KEY, 10);
      if (hunterResult && hunterResult.contacts.length > 0) {
        return hunterResult.contacts
          .filter(c => isValidPersonName(c.full_name) && (!c.email || !isExcludedEmail(c.email)))
          .map(c => ({
            full_name: c.full_name,
            title: c.title,
            email: c.email || undefined,
            linkedin_url: c.linkedin_url || undefined,
            role_tier: getRoleTier(c.title)
          }))
          .sort((a, b) => a.role_tier - b.role_tier)
          .slice(0, 8);
      }
    } catch { /* no contacts */ }
  }

  // ── Fallback to SerpAPI LinkedIn scrape ──
  // This is the ONLY contact source that works without a Icypeas/
  // Hunter key (or when both are rate-limited). It scrapes Google for
  // public LinkedIn profile snippets associated with the company domain
  // and parses out name + title. No emails (those come from a separate
  // pattern-guess step later) but we get who-works-there for free —
  // which beats the previous "0 contacts" outcome entirely.
  const linkedinContacts = await discoverContactsViaLinkedInScrape(domain);
  if (linkedinContacts.length > 0) {
    return linkedinContacts.slice(0, 8);
  }

  return [];
}

/**
 * Last-ditch contact source: scrape Google for `site:linkedin.com/in/
 * "Company Name"` snippets. Each result on Google's organic page is
 * a LinkedIn profile with the title format "Name - Title - Company"
 * which we parse out. Free relative to paid people-search APIs, only
 * requires the SerpAPI key we're already paying for.
 *
 * Not perfect — Google snippets aren't always cleanly structured —
 * but recovers 3-10 plausible contacts for any company with a real
 * LinkedIn presence. The downstream pattern-guess + verify step turns
 * those into emails.
 */
async function discoverContactsViaLinkedInScrape(domain: string): Promise<{
  full_name: string;
  title: string;
  email?: string;
  linkedin_url?: string;
  role_tier: number;
}[]> {
  const SERPAPI_API_KEY = getSerpSearchKey();
  if (!SERPAPI_API_KEY) return [];

  // Derive a search query: prefer the bare domain stem (e.g. "acme"
  // from "acme.com"). Searching by domain matches LinkedIn snippets
  // that mention the company without us knowing its exact display name.
  const domainStem = domain.split('.')[0].replace(/[-_]/g, ' ');
  if (!domainStem || domainStem.length < 3) return [];

  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: `site:linkedin.com/in "${domainStem}"`,
      api_key: SERPAPI_API_KEY,
      num: '20',
    });
    const resp = await serpFetch(`https://serpapi.com/search?${params}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    const results: any[] = data.organic_results || [];
    if (results.length === 0) return [];

    const out: Array<{
      full_name: string;
      title: string;
      linkedin_url?: string;
      role_tier: number;
    }> = [];
    const seenNames = new Set<string>();

    for (const r of results) {
      const link: string = r.link || '';
      const title: string = r.title || '';
      // LinkedIn /in/ URL is required — filter out company pages,
      // posts, articles, etc.
      if (!/linkedin\.com\/in\//i.test(link)) continue;

      // Title format examples Google produces:
      //   "Jane Doe - Head of Sales - Acme | LinkedIn"
      //   "Jane Doe - Acme - LinkedIn"
      //   "Jane Doe | LinkedIn"
      // Split on " - " and " | ".
      const cleaned = title.replace(/\s*[|]\s*LinkedIn.*$/i, '').trim();
      const parts = cleaned.split(/\s+[-–]\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) continue;

      const name = parts[0];
      if (!isValidPersonName(name)) continue;

      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);

      // Title is typically parts[1]; if absent, try parsing the
      // snippet. Stop at company name (often parts[2]).
      let jobTitle = parts[1] || '';
      if (!jobTitle && r.snippet) {
        // Snippet often starts with the title or "Title at Company"
        const snippetMatch = (r.snippet as string).match(/^([^.·•\n]+?)(?:\s+at\s+|\s+•\s+|\s+·\s+|\.)/i);
        if (snippetMatch) jobTitle = snippetMatch[1].trim();
      }
      if (!jobTitle) jobTitle = 'Unknown';

      const roleTier = getRoleTier(jobTitle);
      if (roleTier === 99) continue;       // junk titles (assistant, intern, etc.)

      out.push({
        full_name: name,
        title: jobTitle,
        linkedin_url: link,
        role_tier: roleTier,
      });

      if (out.length >= 15) break;
    }

    // Sort by role tier so decision-makers come first
    out.sort((a, b) => a.role_tier - b.role_tier);
    return out;
  } catch (err: any) {
    console.warn(`[ENRICH] LinkedIn scrape for ${domain} failed:`, err?.message || err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HUNTER.IO DOMAIN SEARCH ENRICHMENT (parallel to Icypeas domain search)
// ═══════════════════════════════════════════════════════════════════════════

async function tryHunterDomainSearchEnrich(input: EnrichmentInput, hunterApiKey: string): Promise<EnrichmentOutput | null> {
  try {
    console.log(`[ENRICH] Hunter.io domain search for ${input.company_domain}...`);
    const hunterResult = await hunterDomainSearch(input.company_domain, hunterApiKey, 20);

    if (!hunterResult || hunterResult.contacts.length === 0) return null;

    const candidates: { dm: DecisionMaker; roleTier: number }[] = [];
    const excludedEmails: string[] = [];
    let totalCandidates = 0;

    for (const contact of hunterResult.contacts) {
      if (!contact.email) continue;
      if (!contact.full_name || contact.full_name.trim().length < 3) continue;
      if (!isValidPersonName(contact.full_name)) continue;

      if (isExcludedEmail(contact.email)) {
        excludedEmails.push(contact.email);
        continue;
      }

      totalCandidates++;
      const roleTier = getRoleTier(contact.title);

      candidates.push({
        dm: {
          full_name: contact.full_name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          linkedin_url: contact.linkedin_url,
          verification_status: 'unverifiable',
          confidence_score: 0,
          source: "hunter",
          why_selected: roleTier < 99 ? `Tier ${roleTier} role via Hunter.io` : "Contact at company via Hunter.io"
        },
        roleTier
      });
    }

    candidates.sort((a, b) => a.roleTier - b.roleTier);
    const topCandidates = candidates.slice(0, 6);
    console.log(`[ENRICH] Verifying ${topCandidates.length} candidate emails from Hunter.io...`);

    const verifiedDMs: DecisionMaker[] = [];

    for (const candidate of topCandidates) {
      const verification = await verifyEmailMultiProvider(candidate.dm.email);

      if (verification.deliverable) {
        verifiedDMs.push({
          ...candidate.dm,
          verification_status: verification.status === 'catch_all' ? 'catch_all' : 'verified',
          confidence_score: verification.status === 'valid' ? 92 : (verification.status === 'catch_all' ? 68 : 58),
        });
        console.log(`  [OK] ${candidate.dm.full_name} (${candidate.dm.title}) - ${candidate.dm.email} = ${verification.status}`);
      } else {
        console.log(`  [FAIL] ${candidate.dm.full_name} - ${candidate.dm.email} = ${verification.status}`);

        // Try alternate email via multi-provider finder
        const altResult = await findVerifiedEmailMultiProvider(candidate.dm.full_name, input.company_domain);
        if (altResult && altResult.email !== candidate.dm.email) {
          verifiedDMs.push({
            ...candidate.dm,
            email: altResult.email,
            verification_status: altResult.status === 'catch_all' ? 'catch_all' : 'verified',
            confidence_score: altResult.status === 'valid' ? 88 : 63,
            source: `hunter+${altResult.source}`,
            email_patterns_tried: altResult.patternsTriedCount,
          });
          console.log(`  [RECOVERED] Alt email for ${candidate.dm.full_name}: ${altResult.email}`);
        }
      }

      if (verifiedDMs.length >= 3) break;
    }

    if (verifiedDMs.length === 0 && totalCandidates === 0) return null;

    return {
      success: verifiedDMs.length > 0,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: verifiedDMs.length > 0 ? "enriched" : "needs_review",
      reason: verifiedDMs.length === 0 ? "hunter_contacts_failed_verification" : undefined,
      decision_makers: verifiedDMs,
      excluded_emails_found: excludedEmails.slice(0, 5),
      verification_summary: {
        total_candidates: totalCandidates,
        verified: verifiedDMs.filter(dm => dm.verification_status === 'verified').length,
        catch_all: verifiedDMs.filter(dm => dm.verification_status === 'catch_all').length,
        failed: totalCandidates - verifiedDMs.length,
        domain_mx_valid: true
      }
    };
  } catch (error) {
    console.warn("[ENRICH] Hunter domain search failed:", (error as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APOLLO via SERPAPI — MULTI-PROVIDER (uses findVerifiedEmailMultiProvider)
// ═══════════════════════════════════════════════════════════════════════════

async function findDecisionMakerViaSerpApiMulti(input: EnrichmentInput): Promise<EnrichmentOutput | null> {
  const SERPAPI_API_KEY = getSerpSearchKey();
  if (!SERPAPI_API_KEY) return null;

  console.log(`[ENRICH-MULTI] Searching Apollo.io via SerpAPI for: ${input.company_name} (${input.company_domain})`);

  const targetRolesQuery = "(CEO OR Founder OR Owner OR President OR Director OR VP OR Head OR Manager OR Partner)";
  const query = `site:apollo.io/people "${input.company_name}" ${targetRolesQuery}`;

  const params = new URLSearchParams({
    engine: "google", q: query, api_key: SERPAPI_API_KEY, num: "15"
  });

  try {
    const response = await serpFetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);

    const data = await response.json();
    const results = data.organic_results || [];

    const candidates: { name: string; title: string; roleTier: number; linkedinUrl?: string }[] = [];

    for (const result of results) {
      const titleSnippet = result.title || "";
      const snippet = result.snippet || "";

      const cleanTitle = titleSnippet
        .replace(/\s*\|\s*Apollo\.io/i, "")
        .replace(/\s*-\s*Apollo\.io/i, "")
        .replace(/\s*·\s*Apollo\.io/i, "");

      const parts = cleanTitle.split(/ - | – | \| | at /);

      if (parts.length >= 2) {
        let name = parts[0].trim();
        let jobTitle = parts[1].trim();

        if (!jobTitle || jobTitle.length < 3) {
          const snippetMatch = snippet.match(/(?:is|as)\s+(?:a\s+|the\s+)?([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
          if (snippetMatch) jobTitle = snippetMatch[1];
        }

        if (!isValidPersonName(name)) continue;

        const roleTier = getRoleTier(jobTitle);
        if (roleTier === 99) continue;

        candidates.push({ name, title: jobTitle, roleTier, linkedinUrl: result.link?.includes("apollo.io") ? undefined : result.link });
      }
    }

    if (candidates.length === 0) return null;

    const uniqueCandidates = candidates.filter((c, i, self) =>
      i === self.findIndex(t => t.name.toLowerCase() === c.name.toLowerCase())
    );
    uniqueCandidates.sort((a, b) => a.roleTier - b.roleTier);

    console.log(`[ENRICH-MULTI] Verifying emails for ${uniqueCandidates.length} Apollo candidates (multi-provider)...`);

    const verifiedDMs: DecisionMaker[] = [];
    let totalCandidates = 0;

    for (const candidate of uniqueCandidates.slice(0, 5)) {
      totalCandidates++;
      const emailResult = await findVerifiedEmailMultiProvider(candidate.name, input.company_domain);

      if (emailResult) {
        verifiedDMs.push({
          full_name: candidate.name,
          title: candidate.title,
          email: emailResult.email,
          linkedin_url: candidate.linkedinUrl,
          verification_status: emailResult.status === 'catch_all' ? 'catch_all' : 'verified',
          confidence_score: emailResult.status === 'valid' ? 90 : 65,
          source: `apollo_serpapi+${emailResult.source}`,
          why_selected: `Tier ${candidate.roleTier} match from Apollo, email via ${emailResult.source}`,
          email_patterns_tried: emailResult.patternsTriedCount,
        });
        console.log(`  [OK] ${candidate.name}: ${emailResult.email} (${emailResult.status} via ${emailResult.source})`);
      } else {
        console.log(`  [FAIL] ${candidate.name}: no verified email found across providers`);
      }

      if (verifiedDMs.length >= 3) break;
    }

    if (verifiedDMs.length === 0) return null;

    return {
      success: true,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: "enriched",
      decision_makers: verifiedDMs,
      excluded_emails_found: [],
      notes: `Found via Apollo.io, emails verified through Icypeas and mailbox verification.`,
      verification_summary: {
        total_candidates: totalCandidates,
        verified: verifiedDMs.filter(dm => dm.verification_status === 'verified').length,
        catch_all: verifiedDMs.filter(dm => dm.verification_status === 'catch_all').length,
        failed: totalCandidates - verifiedDMs.length,
        domain_mx_valid: true
      }
    };
  } catch (error) {
    console.warn(`[ENRICH-MULTI] Apollo SerpAPI search failed: ${(error as Error).message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN via SERPAPI — MULTI-PROVIDER (uses findVerifiedEmailMultiProvider)
// ═══════════════════════════════════════════════════════════════════════════

async function findDecisionMakerViaLinkedInMulti(input: EnrichmentInput): Promise<EnrichmentOutput | null> {
  const SERPAPI_API_KEY = getSerpSearchKey();
  if (!SERPAPI_API_KEY) return null;

  console.log(`[ENRICH-MULTI] Searching LinkedIn via SerpAPI for: ${input.company_name}`);

  const query = `site:linkedin.com/in "${input.company_name}" (CEO OR Founder OR Owner OR Director OR Manager OR President OR VP OR Head)`;

  const params = new URLSearchParams({
    engine: "google", q: query, api_key: SERPAPI_API_KEY, num: "10"
  });

  try {
    const response = await serpFetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);

    const data = await response.json();
    const results = data.organic_results || [];

    const candidates: { name: string; title: string; roleTier: number; linkedinUrl?: string }[] = [];

    for (const result of results) {
      const titleSnippet = result.title || "";
      const snippet = result.snippet || "";
      const link = result.link || "";

      const cleanTitle = titleSnippet
        .replace(/\s*\|\s*LinkedIn/i, "")
        .replace(/\s*-\s*LinkedIn/i, "");

      const parts = cleanTitle.split(/ - | – | \| /);

      if (parts.length >= 2) {
        const name = parts[0].trim();
        let jobTitle = parts[1].trim();

        if (!isValidPersonName(name)) continue;

        const companyNameLower = input.company_name.toLowerCase();
        const allText = `${titleSnippet} ${snippet}`.toLowerCase();
        const companyWords = companyNameLower.split(/\s+/).filter(w => w.length > 2);
        const matchesCompany = companyWords.some(w => allText.includes(w));
        if (!matchesCompany) continue;

        const roleTier = getRoleTier(jobTitle);
        if (roleTier === 99) continue;

        candidates.push({ name, title: jobTitle, roleTier, linkedinUrl: link.includes("linkedin.com") ? link : undefined });
      }
    }

    if (candidates.length === 0) return null;

    const uniqueCandidates = candidates.filter((c, i, self) =>
      i === self.findIndex(t => t.name.toLowerCase() === c.name.toLowerCase())
    );
    uniqueCandidates.sort((a, b) => a.roleTier - b.roleTier);

    const verifiedDMs: DecisionMaker[] = [];
    let totalCandidates = 0;

    for (const candidate of uniqueCandidates.slice(0, 4)) {
      totalCandidates++;
      const emailResult = await findVerifiedEmailMultiProvider(candidate.name, input.company_domain);

      if (emailResult) {
        verifiedDMs.push({
          full_name: candidate.name,
          title: candidate.title,
          email: emailResult.email,
          linkedin_url: candidate.linkedinUrl,
          verification_status: emailResult.status === 'catch_all' ? 'catch_all' : 'verified',
          confidence_score: emailResult.status === 'valid' ? 88 : 62,
          source: `linkedin_serpapi+${emailResult.source}`,
          why_selected: `Tier ${candidate.roleTier} match from LinkedIn, email via ${emailResult.source}`,
          email_patterns_tried: emailResult.patternsTriedCount,
        });
      }

      if (verifiedDMs.length >= 3) break;
    }

    if (verifiedDMs.length === 0) return null;

    return {
      success: true,
      company: { name: input.company_name, domain: input.company_domain, website: input.company_website_url || "" },
      status: "enriched",
      decision_makers: verifiedDMs,
      excluded_emails_found: [],
      notes: `Found via LinkedIn, emails verified through Icypeas and mailbox verification.`,
      verification_summary: {
        total_candidates: totalCandidates,
        verified: verifiedDMs.filter(dm => dm.verification_status === 'verified').length,
        catch_all: verifiedDMs.filter(dm => dm.verification_status === 'catch_all').length,
        failed: totalCandidates - verifiedDMs.length,
        domain_mx_valid: true
      }
    };
  } catch (error) {
    console.warn(`[ENRICH-MULTI] LinkedIn SerpAPI search failed: ${(error as Error).message}`);
    return null;
  }
}
