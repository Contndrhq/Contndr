import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { enrichLeadWithFindymail, EnrichmentInput, quickDiscoverContacts, getRoleTier, isValidPersonName } from "./enrichment_agent.tsx";
import * as kv from "./kv-retry.tsx";
import { getTeamMemberIds, getTeamId } from "./team.tsx";
import { toTitleCase } from "./apollo-native.tsx";
import { getUserSubscriptionStatus } from "./contndr-billing.tsx";
import { saveToPool, type PoolLead } from "./lead-pool.tsx";
import { checkMxRecords, verifyMailboxDeliverability } from "./email-verify.tsx";
import { getLeadLimitForPlan } from "./plan-entitlements.ts";

async function checkLeadLimitEngine(user: any, supabase: any, additionalCount: number) {
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

app.use('*', cors());

// ── Auth helper ─────────────────────────────────────────────────────────
async function getAuthenticatedUser(c: any) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new Error("No Authorization header");
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "LEAD-ENGINE");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── Domain blocklist (aggregators, social, directories) ─────────────────
const JUNK_DOMAINS = new Set([
  "yelp.com", "facebook.com", "linkedin.com", "instagram.com", "tiktok.com",
  "twitter.com", "x.com", "youtube.com", "pinterest.com",
  "yellowpages.com", "bbb.org", "clutch.co", "foursquare.com",
  "tripadvisor.com", "glassdoor.com", "indeed.com", "angi.com",
  "thumbtack.com", "homeadvisor.com", "mapquest.com", "manta.com",
  "superpages.com", "whitepages.com", "crunchbase.com", "zoominfo.com",
  "dnb.com", "google.com", "apple.com", "microsoft.com",
  "nextdoor.com", "patch.com", "alignable.com", "chamberofcommerce.com"
]);

function isJunkDomain(domain: string): boolean {
  if (!domain) return true;
  const d = domain.toLowerCase();
  return JUNK_DOMAINS.has(d) || Array.from(JUNK_DOMAINS).some(junk => d.endsWith(`.${junk}`));
}

// ── Quality scoring ─────────────────────────────────────────────────────
interface RawCompany {
  name: string;
  domain: string;
  website: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviews?: number;
  types?: string[];
  place_id?: string;
  description?: string;
  source: string;
  industry?: string;
  quality_score?: number;
  discovered_contacts?: {
    full_name: string;
    title: string;
    email?: string;
    linkedin_url?: string;
    source: string;
    role_tier: number;
  }[];
  enrichedData?: {
    status: string;
    decision_makers: any[];
    notes?: string;
    company_linkedin?: string;
    estimated_revenue?: string;
    employee_count?: string;
    verification_summary?: any;
  };
}

/**
 * Search-time ICP fit (0-100). Prior version only counted "has phone,
 * has address, decent rating" which made the LeadFinder sort by
 * "completeness" instead of fit-for-the-user's-product. Now we layer
 * in industry weight, enrichment quality (verified vs catch-all email
 * mix), and contact-tier coverage so the top of the list actually
 * reflects which leads are most likely to convert.
 *
 * Signals (scaled to roughly 0-100 cap):
 *   Base presence (signal of a real business):
 *     +20 has a real website (domain)
 *     +10 has phone
 *     +10 has address
 *      +5 has description
 *   Reputation:
 *     +10 rating ≥ 3.5
 *      +5 ≥ 5 reviews
 *     +10 ≥ 20 reviews
 *   ICP fit (industry):
 *     +0..20 scaled from INDUSTRY_SCORES (defaults to 50 → +10)
 *   Enrichment quality (set later by enrichment step; safe defaults):
 *     +10 has ≥1 verified decision-maker contact
 *      +5 has ≥1 derived/guessed decision-maker contact
 *   Penalties:
 *      -5 very long/suspicious domain
 *      -5 mostly catch-all email domain (low deliverability)
 */
function scoreCompany(c: RawCompany): number {
  let score = 0;

  // Presence signals
  if (c.domain) score += 20;
  if (c.phone) score += 10;
  if (c.address) score += 10;
  if (c.description) score += 5;

  // Reputation
  if (c.rating && c.rating >= 3.5) score += 10;
  if (c.reviews && c.reviews >= 5) score += 5;
  if (c.reviews && c.reviews >= 20) score += 10;

  // Industry ICP fit — INDUSTRY_SCORES is 0-100; map to 0-20 here.
  const industryRaw = (c.industry && INDUSTRY_SCORES_LOCAL[c.industry]) || 50;
  score += Math.round(industryRaw * 0.2);

  // Enrichment quality (these fields get set after enrichLeadWithFindymail)
  const dms = (c as any).discovered_contacts || [];
  if (Array.isArray(dms) && dms.length > 0) {
    const hasVerified = dms.some((d: any) => d.verification_status === 'verified');
    const hasDerived  = dms.some((d: any) => d.verification_status === 'derived' || d.verification_status === 'guessed');
    if (hasVerified) score += 10;
    else if (hasDerived) score += 5;
  }

  // Penalties
  if (c.domain && c.domain.length > 30) score -= 5;
  if ((c as any).verification_summary?.catch_all > ((c as any).verification_summary?.verified || 0)) {
    score -= 5;
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

// Compact copy of lead-scoring.tsx's INDUSTRY_SCORES, local to this
// module to avoid pulling the whole scoring module into the search hot
// path. Keep in sync with src/.../lead-scoring.tsx.
const INDUSTRY_SCORES_LOCAL: Record<string, number> = {
  'SaaS': 100, 'Technology': 95, 'Finance': 90, 'Healthcare': 85,
  'Legal': 80, 'Consulting': 80, 'Marketing': 75, 'E-commerce': 70,
  'Real Estate': 65, 'Education': 60, 'Manufacturing': 55, 'Retail': 50,
  'Hospitality': 45, 'Construction': 40, 'Media': 70,
};

// ── SerpAPI People Discovery Helpers ────────────────────────────────────
interface DiscoveredPerson {
  full_name: string;
  title: string;
  company_hint: string;
  linkedin_url?: string;
  source: string;
  role_tier: number;
}

async function searchPeopleViaApollo(
  companies: RawCompany[],
  industry: string,
  location: string,
  serpApiKey: string
): Promise<DiscoveredPerson[]> {
  try {
    // Build a domain-based query for precision — top 8 company domains
    const topDomains = companies.slice(0, 8).map(c => `"${c.domain}"`).join(" OR ");
    const query = `site:apollo.io/people (${topDomains}) (CEO OR Founder OR Owner OR President OR Director OR VP OR Partner OR "Managing Director" OR "Head of")`;

    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: serpApiKey,
      num: "30"
    });

    console.log(`[LEAD ENGINE] Apollo people search for top ${Math.min(companies.length, 8)} domains...`);

    const response = await fetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) return [];

    const data = await response.json();
    const results = data.organic_results || [];
    const people: DiscoveredPerson[] = [];

    for (const result of results) {
      const rawTitle = (result.title || "")
        .replace(/\s*[|·-]\s*Apollo\.io/i, "")
        .replace(/\s*Apollo\.io/i, "");
      const snippet = result.snippet || "";

      // Apollo format: "Name - Title - Company" or "Name - Title"
      const parts = rawTitle.split(/ - | – /);
      if (parts.length < 2) continue;

      const name = parts[0].trim();
      const jobTitle = parts[1]?.trim() || "";
      const companyPart = parts[2]?.trim() || "";

      if (!isValidPersonName(name)) continue;
      const roleTier = getRoleTier(jobTitle);
      if (roleTier === 99) continue;

      // Build company hint from title part + snippet
      let companyHint = companyPart;
      if (!companyHint) {
        const snippetMatch = snippet.match(/(?:at|@|for)\s+([A-Z][A-Za-z0-9\s&.',-]+?)(?:\.|,|\s-|$)/);
        if (snippetMatch) companyHint = snippetMatch[1].trim();
      }

      people.push({
        full_name: name,
        title: jobTitle,
        company_hint: companyHint,
        source: "apollo_discovery",
        role_tier: roleTier
      });
    }

    console.log(`[LEAD ENGINE] Apollo found ${people.length} decision makers`);
    return people;
  } catch (error: any) {
    console.warn(`[LEAD ENGINE] Apollo people search failed:`, error.message);
    return [];
  }
}

async function searchPeopleViaLinkedIn(
  companies: RawCompany[],
  industry: string,
  location: string,
  serpApiKey: string
): Promise<DiscoveredPerson[]> {
  try {
    // Use company names for LinkedIn (profiles show company names, not domains)
    const topNames = companies.slice(0, 6).map(c => `"${c.name}"`).join(" OR ");
    const query = `site:linkedin.com/in (${topNames}) (CEO OR Founder OR Owner OR President OR Director OR VP OR Partner)`;

    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: serpApiKey,
      num: "20"
    });

    console.log(`[LEAD ENGINE] LinkedIn people search for top ${Math.min(companies.length, 6)} companies...`);

    const response = await fetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) return [];

    const data = await response.json();
    const results = data.organic_results || [];
    const people: DiscoveredPerson[] = [];

    for (const result of results) {
      const rawTitle = (result.title || "")
        .replace(/\s*[|·-]\s*LinkedIn/i, "")
        .replace(/\s*LinkedIn/i, "");
      const snippet = result.snippet || "";
      const link = result.link || "";

      // LinkedIn format: "Name - Title" or "Name - Title at Company"
      const parts = rawTitle.split(/ - | – | \| /);
      if (parts.length < 2) continue;

      const name = parts[0].trim();
      let jobTitle = parts[1]?.trim() || "";

      // Sometimes the title contains "at Company" suffix
      const atMatch = jobTitle.match(/^(.+?)\s+at\s+(.+)$/i);
      let companyHint = "";
      if (atMatch) {
        jobTitle = atMatch[1].trim();
        companyHint = atMatch[2].trim();
      }

      if (!isValidPersonName(name)) continue;
      const roleTier = getRoleTier(jobTitle);
      if (roleTier === 99) continue;

      // Build company hint from snippet if not found
      if (!companyHint) {
        const snippetMatch = snippet.match(/(?:at|@)\s+([A-Z][A-Za-z0-9\s&.',-]+?)(?:\.|,|\s-|$)/);
        if (snippetMatch) companyHint = snippetMatch[1].trim();
      }

      const linkedinUrl = link.match(/linkedin\.com\/in\/[a-z0-9-]+/i) ? link : undefined;

      people.push({
        full_name: name,
        title: jobTitle,
        company_hint: companyHint,
        linkedin_url: linkedinUrl,
        source: "linkedin_discovery",
        role_tier: roleTier
      });
    }

    console.log(`[LEAD ENGINE] LinkedIn found ${people.length} decision makers`);
    return people;
  } catch (error: any) {
    console.warn(`[LEAD ENGINE] LinkedIn people search failed:`, error.message);
    return [];
  }
}

/**
 * Build a stable dedup key for a person's name so "John A. Smith",
 * "John Smith", and "J. Smith" all collapse to the same entry. We:
 *   - lowercase
 *   - strip punctuation
 *   - drop middle tokens (initials especially)
 *   - keep first initial + full last name as the key
 *
 * Falls back to the raw lowercased name if we can't extract a usable
 * first+last (single token, blank, etc.).
 */
export function personDedupKey(rawName: string | null | undefined): string {
  if (!rawName) return '';
  const cleaned = rawName.toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length === 1) return tokens[0];
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  // Single-letter first initial collapses to just the initial
  const firstKey = first.length === 1 ? first[0] : first[0]; // always first letter
  return `${firstKey}|${last}`;
}

/**
 * Common "noise" tokens that shouldn't count as matching evidence.
 * "Acme Inc" vs "Acme Holdings" share both "inc"/"holdings"-like tokens
 * but we want the match to fail; "Acme" vs "Acme Dental" should also
 * fail (different businesses). Token-overlap with stop-token filtering
 * is the standard trick.
 */
const COMPANY_STOPWORDS = new Set([
  'inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'group',
  'holdings', 'enterprises', 'partners', 'associates', 'services', 'solutions',
  'the', 'and', 'of', 'for', 'a', 'an', 'global', 'international', 'pllc',
  'plc', 'pty', 'gmbh', 'sa', 'spa', 'srl',
]);

function tokenizeCompanyName(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !COMPANY_STOPWORDS.has(t));
}

/**
 * Match a discovered person to a company in the result set.
 *
 * Old impl used substring containment — "Acme" matched "Acme Dental",
 * "Acme Holdings", "Acme Inc", etc. (silent attribution to the wrong
 * company in saved leads). New impl requires either:
 *   - Domain-base token match (highest confidence), OR
 *   - Token-overlap ratio ≥ 0.6 after removing legal stopwords
 *     (Inc/LLC/Holdings/Group/etc.)
 *
 * If we can't reach 0.6, return null — preferring "no attribution"
 * over "wrong attribution."
 */
function matchPersonToCompany(person: DiscoveredPerson, companies: RawCompany[]): RawCompany | null {
  if (!person.company_hint) return null;

  const hintTokens = tokenizeCompanyName(person.company_hint);
  if (hintTokens.length === 0) return null;

  const hintCompact = hintTokens.join('');

  let best: { company: RawCompany; score: number } | null = null;

  for (const company of companies) {
    const nameTokens = tokenizeCompanyName(company.name);
    const domainBase = (company.domain || '').split('.')[0].replace(/[^a-z0-9]/g, '');

    // Domain-base match (highest confidence — domains are uniquely identifying)
    if (domainBase.length >= 3 && hintCompact.includes(domainBase)) {
      return company;
    }

    if (nameTokens.length === 0) continue;

    // Token-overlap (Jaccard-like, asymmetric: we measure overlap relative
    // to the SMALLER set so "Acme" against "Acme Dental" gets 0.5, not 1.0)
    const hintSet = new Set(hintTokens);
    const overlap = nameTokens.filter(t => hintSet.has(t)).length;
    const score = overlap / Math.max(hintTokens.length, nameTokens.length);

    if (score >= 0.6 && (!best || score > best.score)) {
      best = { company, score };
    }
  }

  return best?.company || null;
}

// ── POST /search — Deep company discovery ───────────────────────────────
// Supports `depth`: "standard" (1 page ~20), "deep" (3 pages ~60), "maximum" (5 pages ~100)
// Combines Google Maps + Google organic search, deduplicates, quality-scores, and sorts.
app.post("/search", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const { industry, location, keywords, depth = "standard" } = await c.req.json();

    if (!industry || !location) {
      return c.json({ error: "Industry and location are required" }, 400);
    }

    const SERPAPI_API_KEY = Deno.env.get("SERPAPI_API_KEY");
    if (!SERPAPI_API_KEY) {
      return c.json({ error: "Server configuration error: Search API key missing" }, 500);
    }
    const HUNTER_API_KEY_NS = Deno.env.get("HUNTER_API_KEY");

    // Determine how many pages to fetch based on depth
    const pageCounts: Record<string, number> = {
      standard: 1,  // ~20 results
      deep: 3,      // ~60 results
      maximum: 5    // ~100 results
    };
    const pages = pageCounts[depth] || 1;

    console.log(`[LEAD ENGINE] Deep search: "${industry}" in "${location}" | depth=${depth} pages=${pages} (User: ${user.email})`);

    const query = `${industry} in ${location} ${keywords || ''}`.trim();
    const allCompanies: RawCompany[] = [];
    const seenDomains = new Set<string>();

    // ── Phase 1: Google Maps paginated search ───────────────────────────
    // Pages are fetched in PARALLEL. Each page is an independent SerpAPI
    // call addressed by the `start` offset, so there's no sequence to
    // preserve — and at `depth=maximum` (5 pages) the old sequential
    // loop cost ~5x SerpAPI latency (often 10s+). Now we fire all pages
    // at once via `Promise.allSettled` and dedup the merged results.
    const pageFetches = Array.from({ length: pages }, (_, page) => {
      const params = new URLSearchParams({
        engine: "google_maps",
        q: query,
        api_key: SERPAPI_API_KEY,
        type: "search",
        start: (page * 20).toString(),
      });
      return fetch(`https://serpapi.com/search?${params}`)
        .then(async (response) => {
          if (!response.ok) {
            console.warn(`[LEAD ENGINE] Maps page ${page + 1} failed: ${response.statusText}`);
            return [] as any[];
          }
          const data = await response.json();
          return (data.local_results || []) as any[];
        })
        .catch((err) => {
          console.warn(`[LEAD ENGINE] Maps page ${page + 1} error:`, err?.message || err);
          return [] as any[];
        });
    });

    const pageResultsSettled = await Promise.allSettled(pageFetches);
    for (let page = 0; page < pageResultsSettled.length; page++) {
      const settled = pageResultsSettled[page];
      const results = settled.status === 'fulfilled' ? settled.value : [];
      if (results.length === 0) continue;
      for (const r of results) {
        const domain = extractDomain(r.website);
        if (!domain || isJunkDomain(domain) || seenDomains.has(domain)) continue;
        seenDomains.add(domain);
        allCompanies.push({
          name: r.title,
          domain,
          website: r.website,
          phone: r.phone,
          address: r.address,
          rating: r.rating,
          reviews: r.reviews,
          types: r.types,
          place_id: r.place_id,
          description: r.description,
          source: 'google_maps',
          industry: toTitleCase(industry),
        });
      }
      console.log(`[LEAD ENGINE] Maps page ${page + 1}: +${results.length} raw → ${allCompanies.length} unique so far`);
    }

    // ── Phase 2: Google organic search (supplements Maps) ───────────────
    // This catches businesses that have websites but aren't on Google Maps
    if (depth !== "standard") {
      try {
        const organicQuery = `"${industry}" "${location}" -site:yelp.com -site:facebook.com -site:linkedin.com -site:yellowpages.com -site:bbb.org`;
        const organicParams = new URLSearchParams({
          engine: "google",
          q: organicQuery,
          api_key: SERPAPI_API_KEY,
          num: "20"
        });

        console.log(`[LEAD ENGINE] Supplementary organic search...`);
        const organicResponse = await fetch(`https://serpapi.com/search?${organicParams}`);

        if (organicResponse.ok) {
          const organicData = await organicResponse.json();
          const organicResults = organicData.organic_results || [];

          for (const r of organicResults) {
            const domain = extractDomain(r.link || r.displayed_link);
            if (!domain || isJunkDomain(domain) || seenDomains.has(domain)) continue;
            seenDomains.add(domain);

            // Extract a company name from the title (strip suffix like " | Home" etc.)
            let name = (r.title || "").replace(/\s*[|–-]\s*(Home|About|Contact|Services).*$/i, "").trim();
            if (!name || name.length < 2) continue;

            allCompanies.push({
              name,
              domain,
              website: r.link,
              description: r.snippet,
              source: 'google_organic',
              industry: toTitleCase(industry)
            });
          }
          console.log(`[LEAD ENGINE] Organic search: added extras → ${allCompanies.length} total unique companies`);
        }
      } catch (organicError) {
        console.warn(`[LEAD ENGINE] Organic search failed:`, organicError.message);
        // Non-fatal, continue with what we have
      }
    }

    // ── Phase 3: Quality scoring + sorting ──────────────────────────────
    const scored = allCompanies.map(c => ({
      ...c,
      quality_score: scoreCompany(c)
    }));

    // Sort: highest quality first
    scored.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));

    // Filter: require minimum quality (must have at least a domain = 30 points)
    const qualified = scored.filter(c => (c.quality_score || 0) >= 30);

    // Cache search metadata
    const searchKey = `search:${industry}:${location}:${depth}`.toLowerCase().replace(/\s+/g, '-');
    await kv.set(searchKey, {
      timestamp: Date.now(),
      count: qualified.length,
      depth,
      top_domains: qualified.slice(0, 5).map(c => c.domain)
    });

    console.log(`[LEAD ENGINE] Final result: ${qualified.length} quality leads from ${allCompanies.length} total discovered`);

    // ── Phase 4: Decision Maker Discovery ──────────────────────────────
    // Run Findymail domain search + Apollo people search + LinkedIn people search IN PARALLEL
    // to maximize contact coverage while minimizing total latency
    let companiesWithContacts = 0;
    let autoEnrichedCount = 0;
    if (qualified.length > 0) {
      const numToDiscover = depth === 'maximum' ? 8 : depth === 'deep' ? 5 : 3;
      const topForDiscovery = qualified.slice(0, numToDiscover);

      console.log(`[LEAD ENGINE] Phase 4: Multi-source contact discovery for top ${topForDiscovery.length} companies...`);

      try {
        // Run all four discovery sources in parallel
        const [findymailSettled, hunterSettledNS, apolloSettled, linkedinSettled] = await Promise.allSettled([
          // Source 1: Findymail domain search for each top company
          Promise.allSettled(
            topForDiscovery.map(async (c) => {
              const cacheKey = `quick-discover:${c.domain}`;
              const cached = await kv.get(cacheKey);
              if (cached?.contacts && cached.timestamp && (Date.now() - cached.timestamp) < 7 * 24 * 60 * 60 * 1000) {
                return { domain: c.domain, contacts: cached.contacts };
              }
              const contacts = await quickDiscoverContacts(c.domain);
              await kv.set(cacheKey, { contacts, timestamp: Date.now() }).catch(() => {});
              return { domain: c.domain, contacts };
            })
          ),
          // Source 2: Hunter domain search (if API key available)
          HUNTER_API_KEY_NS ? Promise.allSettled(
            topForDiscovery.map(async (c) => {
              try {
                const response = await fetch(`https://api.hunter.io/v2/domain-search?domain=${c.domain}&limit=10&api_key=${HUNTER_API_KEY_NS}`);
                if (response.ok) {
                  const data = await response.json();
                  const emails = data.data?.emails || [];
                  const contacts = emails
                    .filter((e: any) => e.first_name && e.last_name && e.value)
                    .map((e: any) => ({
                      full_name: `${e.first_name} ${e.last_name}`,
                      title: e.position || 'Unknown',
                      email: e.value,
                      linkedin_url: e.linkedin || undefined,
                      source: 'hunter_discovery',
                      role_tier: getRoleTier(e.position || ''),
                    }));
                  return { domain: c.domain, contacts };
                }
                return { domain: c.domain, contacts: [] };
              } catch (err) {
                console.warn(`[LEAD ENGINE] Hunter search failed for ${c.domain}:`, err);
                return { domain: c.domain, contacts: [] };
              }
            })
          ) : Promise.resolve([]),
          // Source 3: Apollo people search (one API call for batch of domains)
          depth !== 'standard'
            ? searchPeopleViaApollo(qualified, industry, location, SERPAPI_API_KEY)
            : Promise.resolve([]),
          // Source 4: LinkedIn people search (one API call for batch of company names)
          depth !== 'standard'
            ? searchPeopleViaLinkedIn(qualified, industry, location, SERPAPI_API_KEY)
            : Promise.resolve([])
        ]);

        // Apply Findymail results to companies
        if (findymailSettled.status === 'fulfilled') {
          const findymailResults = findymailSettled.value;
          for (const result of findymailResults) {
            if (result.status === 'fulfilled' && result.value.contacts?.length > 0) {
              const company = qualified.find(c => c.domain === result.value.domain);
              if (company) {
                company.discovered_contacts = result.value.contacts.map((contact: any) => ({
                  ...contact,
                  source: contact.source || 'findymail_discovery'
                }));
                company.quality_score = (company.quality_score || 0) + 25;
                companiesWithContacts++;
              }
            }
          }
        }

        // Apply Hunter results
        if (HUNTER_API_KEY_NS && hunterSettledNS.status === 'fulfilled' && Array.isArray(hunterSettledNS.value)) {
          for (const result of hunterSettledNS.value) {
            if (result.status === 'fulfilled' && result.value.contacts?.length > 0) {
              const company = qualified.find(c => c.domain === result.value.domain);
              if (company) {
                if (!company.discovered_contacts) company.discovered_contacts = [];
                for (const contact of result.value.contacts) {
                  const alreadyFound = company.discovered_contacts.some(dc => personDedupKey(dc.full_name) === personDedupKey(contact.full_name));
                  if (!alreadyFound) {
                    company.discovered_contacts.push(contact);
                    if (company.discovered_contacts.length === 1) {
                      company.quality_score = (company.quality_score || 0) + 25;
                      companiesWithContacts++;
                    }
                  }
                }
              }
            }
          }
        }

        // Merge Apollo people into companies (match by name/domain)
        if (apolloSettled.status === 'fulfilled' && apolloSettled.value.length > 0) {
          const apolloPeople = apolloSettled.value as DiscoveredPerson[];
          for (const person of apolloPeople) {
            const matched = matchPersonToCompany(person, qualified);
            if (matched) {
              if (!matched.discovered_contacts) matched.discovered_contacts = [];
              const alreadyFound = matched.discovered_contacts.some(
                dc => personDedupKey(dc.full_name) === personDedupKey(person.full_name)
              );
              if (!alreadyFound) {
                matched.discovered_contacts.push({
                  full_name: person.full_name,
                  title: person.title,
                  linkedin_url: person.linkedin_url,
                  source: person.source,
                  role_tier: person.role_tier
                });
                if (!matched.quality_score || matched.discovered_contacts.length === 1) {
                  matched.quality_score = (matched.quality_score || 0) + 25;
                  companiesWithContacts++;
                }
              }
            }
          }
        }

        // Merge LinkedIn people into companies (match by name/domain)
        if (linkedinSettled.status === 'fulfilled' && linkedinSettled.value.length > 0) {
          const linkedinPeople = linkedinSettled.value as DiscoveredPerson[];
          for (const person of linkedinPeople) {
            const matched = matchPersonToCompany(person, qualified);
            if (matched) {
              if (!matched.discovered_contacts) matched.discovered_contacts = [];
              const alreadyFound = matched.discovered_contacts.some(
                dc => personDedupKey(dc.full_name) === personDedupKey(person.full_name)
              );
              if (!alreadyFound) {
                matched.discovered_contacts.push({
                  full_name: person.full_name,
                  title: person.title,
                  linkedin_url: person.linkedin_url,
                  source: person.source,
                  role_tier: person.role_tier
                });
                if (!matched.quality_score || matched.discovered_contacts.length === 1) {
                  matched.quality_score = (matched.quality_score || 0) + 25;
                  companiesWithContacts++;
                }
              }
            }
          }
        }

        // Sort discovered contacts within each company by role tier
        for (const company of qualified) {
          if (company.discovered_contacts?.length) {
            company.discovered_contacts.sort((a, b) => a.role_tier - b.role_tier);
            // Cap at 5 contacts per company
            company.discovered_contacts = company.discovered_contacts.slice(0, 5);
          }
        }

        // Re-sort: companies with discovered contacts first, then by quality score
        qualified.sort((a, b) => {
          const aHas = (a.discovered_contacts?.length || 0) > 0 ? 1 : 0;
          const bHas = (b.discovered_contacts?.length || 0) > 0 ? 1 : 0;
          if (bHas !== aHas) return bHas - aHas;
          return (b.quality_score || 0) - (a.quality_score || 0);
        });

        // Recount after merging all sources
        companiesWithContacts = qualified.filter(c => c.discovered_contacts?.length).length;

        console.log(`[LEAD ENGINE] Multi-source discovery complete: ${companiesWithContacts} companies have decision makers`);
      } catch (discoveryError: any) {
        console.warn(`[LEAD ENGINE] Contact discovery failed:`, discoveryError.message);
      }
    }

    // ── Phase 5: Auto-Enrich Top Companies ────────────────────────────
    // Run full enrichment (with email verification) for the top 2 companies that have discovered contacts
    // This gives users verified emails immediately for the best leads
    if (qualified.length > 0 && companiesWithContacts > 0) {
      const numToAutoEnrich = depth === 'maximum' ? 2 : 1;
      const toAutoEnrich = qualified
        .filter(c => c.discovered_contacts?.length && !c.enrichedData)
        .slice(0, numToAutoEnrich);

      if (toAutoEnrich.length > 0) {
        console.log(`[LEAD ENGINE] Phase 5: Auto-enriching top ${toAutoEnrich.length} companies with verified emails...`);

        try {
          const enrichResults = await Promise.allSettled(
            toAutoEnrich.map(async (company) => {
              // Check enrichment cache first
              const cacheKey = `enrich:${company.domain}`;
              const cached = await kv.get(cacheKey);
              if (cached?.enriched_at && (Date.now() - new Date(cached.enriched_at).getTime() < 30 * 24 * 60 * 60 * 1000)) {
                const hasUnverified = cached.decision_makers?.some(
                  (dm: any) => dm.verification_status === 'derived' || dm.verification_status === 'unverified' || dm.verification_status === 'likely_valid'
                );
                if (!hasUnverified) return { domain: company.domain, ...cached, source: 'cache' };
              }

              const input: EnrichmentInput = {
                company_name: company.name,
                company_domain: company.domain,
                company_website_url: company.website,
                company_location: company.address
              };

              const result = await enrichLeadWithFindymail(input);
              if (result.success) {
                await kv.set(cacheKey, { ...result, enriched_at: new Date().toISOString() }).catch(() => {});
              }
              return { domain: company.domain, ...result };
            })
          );

          for (const settled of enrichResults) {
            if (settled.status === 'fulfilled' && settled.value.success) {
              const enrichData = settled.value;
              const company = qualified.find(c => c.domain === enrichData.domain);
              if (company && enrichData.decision_makers?.length > 0) {
                company.enrichedData = {
                  status: enrichData.status,
                  decision_makers: enrichData.decision_makers,
                  notes: enrichData.notes,
                  company_linkedin: enrichData.company?.linkedin_url,
                  estimated_revenue: enrichData.company?.estimated_revenue,
                  employee_count: enrichData.company?.employee_count,
                  verification_summary: enrichData.verification_summary,
                };
                autoEnrichedCount++;
                console.log(`[LEAD ENGINE] Auto-enriched ${company.name}: ${enrichData.decision_makers.length} verified contacts`);
              }
            }
          }
        } catch (autoEnrichError: any) {
          console.warn(`[LEAD ENGINE] Auto-enrichment failed:`, autoEnrichError.message);
        }
      }
    }

    // ── Phase 6: Check which domains are already saved in CRM (team-wide) ───────────
    let savedDomains: string[] = [];
    try {
      const teamMemberIds = await getTeamMemberIds(user.id);
      console.log(`[LEAD ENGINE] Team dedup: checking ${teamMemberIds.length} member(s) CRM`);
      const { data: existingLeads } = await supabase
        .from('leads')
        .select('website')
        .in('user_id', teamMemberIds)
        .eq('source', 'lead_finder');

      if (existingLeads && existingLeads.length > 0) {
        const savedDomainSet = new Set<string>();
        for (const lead of existingLeads) {
          if (lead.website) {
            const d = extractDomain(lead.website);
            if (d) savedDomainSet.add(d);
          }
        }
        savedDomains = Array.from(savedDomainSet);
        console.log(`[LEAD ENGINE] Team has ${savedDomains.length} existing leads in CRM`);
      }
    } catch (err) {
      console.warn(`[LEAD ENGINE] Could not check existing leads:`, err.message);
    }

    return c.json({ 
      success: true, 
      companies: qualified,
      saved_domains: savedDomains,
      meta: {
        total: qualified.length,
        total_raw: allCompanies.length,
        filtered_out: allCompanies.length - qualified.length,
        depth,
        pages_searched: pages,
        sources: [
          'google_maps',
          'findymail_discovery',
          ...(HUNTER_API_KEY_NS ? ['hunter_discovery'] : []),
          ...(depth !== 'standard' ? ['google_organic', 'apollo_people', 'linkedin_people'] : []),
        ],
        with_contacts: companiesWithContacts,
        auto_enriched: autoEnrichedCount
      }
    });

  } catch (error) {
    console.error('[LEAD ENGINE] Search error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /search-stream — SSE streaming search with real-time progress ──
// Same logic as /search but streams phase-by-phase progress via Server-Sent Events
app.post("/search-stream", async (c) => {
  try {
    console.log(`[LEAD ENGINE SSE] ========== SEARCH STREAM REQUEST RECEIVED ==========`);
    console.log(`[LEAD ENGINE SSE] Headers:`, Object.fromEntries(c.req.raw.headers.entries()));
    
    const { user, supabase } = await getAuthenticatedUser(c);
    console.log(`[LEAD ENGINE SSE] Authenticated user: ${user.email} (ID: ${user.id})`);
    
    const { industry, location, keywords, depth = "standard" } = await c.req.json();
    console.log(`[LEAD ENGINE SSE] Request params:`, { industry, location, keywords, depth });

    if (!industry || !location) {
      console.warn(`[LEAD ENGINE SSE] Missing required fields: industry=${industry}, location=${location}`);
      return c.json({ error: "Industry and location are required" }, 400);
    }

    const SERPAPI_API_KEY = Deno.env.get("SERPAPI_API_KEY");
    if (!SERPAPI_API_KEY) {
      console.error(`[LEAD ENGINE SSE] SERPAPI_API_KEY not configured`);
      return c.json({ error: "Server configuration error: Search API key missing" }, 500);
    }
    const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");

    const pageCounts: Record<string, number> = { standard: 1, deep: 3, maximum: 5 };
    const pages = pageCounts[depth] || 1;

    console.log(`[LEAD ENGINE SSE] Stream search: "${industry}" in "${location}" | depth=${depth} pages=${pages} (User: ${user.email})`);

    const query = `${industry} in ${location} ${keywords || ''}`.trim();
    
    let isCancelled = false;
    let controllerClosed = false;
    const stream = new ReadableStream({
      cancel() {
        isCancelled = true;
      },
      async start(controller) {
        const encoder = new TextEncoder();

        const safeClose = () => {
          if (controllerClosed || isCancelled) return;
          try { controller.close(); controllerClosed = true; } catch { controllerClosed = true; }
        };

        const send = (event: string, data: any) => {
          if (isCancelled || controllerClosed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
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
            safeClose();
          };
          if (reqSignal.aborted) { onAbort(); return; }
          reqSignal.addEventListener('abort', onAbort, { once: true });
        }

        try {
          const allCompanies: RawCompany[] = [];
          const seenDomains = new Set<string>();

          // Track actual phases sent so frontend can compute accurate progress
          let phasesEmitted = 0;

          // ── Phase 1: Business Directory ──────────────────────────────────────
          phasesEmitted++;
          send("phase", { phase: 1, name: "Business Directory", status: "searching", total_phases: depth === "standard" ? 5 : 6 });

          // Parallel page fetch — fire all pages at once, emit progress
          // as each settles. ~60-75% wall-time reduction at depth=maximum
          // vs. the old sequential loop.
          const pagePromises = Array.from({ length: pages }, (_, page) => {
            const params = new URLSearchParams({
              engine: "google_maps", q: query, api_key: SERPAPI_API_KEY,
              type: "search", start: (page * 20).toString(),
            });
            return fetch(`https://serpapi.com/search?${params}`)
              .then(async (response) => {
                if (!response.ok) return { page, results: [] as any[] };
                const data = await response.json();
                return { page, results: (data.local_results || []) as any[] };
              })
              .catch((err) => {
                console.warn(`[LEAD ENGINE SSE] Maps page ${page + 1} error:`, err?.message || err);
                return { page, results: [] as any[] };
              });
          });

          let pagesSettled = 0;
          for (const promise of pagePromises) {
            promise.then(({ page, results }) => {
              if (isCancelled) return;
              for (const r of results) {
                const domain = extractDomain(r.website);
                if (!domain || isJunkDomain(domain) || seenDomains.has(domain)) continue;
                seenDomains.add(domain);
                allCompanies.push({
                  name: r.title, domain, website: r.website, phone: r.phone,
                  address: r.address, rating: r.rating, reviews: r.reviews,
                  types: r.types, place_id: r.place_id, description: r.description,
                  source: 'google_maps', industry: toTitleCase(industry),
                });
              }
              pagesSettled++;
              send("progress", { phase: 1, page: pagesSettled, total_pages: pages, companies_found: allCompanies.length });
            });
          }
          await Promise.allSettled(pagePromises);
          if (isCancelled) return;

          send("phase", { phase: 1, name: "Business Directory", status: "complete", companies_found: allCompanies.length });

          // ── Phase 2: Web Search ───────────────────────────────────
          if (depth !== "standard") {
            phasesEmitted++;
            send("phase", { phase: 2, name: "Web Search", status: "searching" });

            try {
              const organicQuery = `"${industry}" "${location}" -site:yelp.com -site:facebook.com -site:linkedin.com -site:yellowpages.com -site:bbb.org`;
              const organicParams = new URLSearchParams({
                engine: "google", q: organicQuery, api_key: SERPAPI_API_KEY, num: "20"
              });

              const organicResponse = await fetch(`https://serpapi.com/search?${organicParams}`);
              if (organicResponse.ok) {
                const organicData = await organicResponse.json();
                const organicResults = organicData.organic_results || [];
                let added = 0;

                for (const r of organicResults) {
                  const domain = extractDomain(r.link || r.displayed_link);
                  if (!domain || isJunkDomain(domain) || seenDomains.has(domain)) continue;
                  seenDomains.add(domain);
                  let name = (r.title || "").replace(/\s*[|–-]\s*(Home|About|Contact|Services).*$/i, "").trim();
                  if (!name || name.length < 2) continue;
                  allCompanies.push({ name, domain, website: r.link, description: r.snippet, source: 'google_organic', industry: toTitleCase(industry) });
                  added++;
                }
                send("phase", { phase: 2, name: "Web Search", status: "complete", added });
              }
            } catch (e: any) {
              console.warn(`[LEAD ENGINE SSE] Web Search failed:`, e.message);
              send("phase", { phase: 2, name: "Web Search", status: "complete", added: 0 });
            }
          }

          // ── Phase 3: Quality Scoring ─────────────────────────────────
          phasesEmitted++;
          send("phase", { phase: 3, name: "Quality Scoring", status: "processing" });

          const scored = allCompanies.map(c => ({ ...c, quality_score: scoreCompany(c) }));
          scored.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
          const qualified = scored.filter(c => (c.quality_score || 0) >= 30);

          send("phase", { phase: 3, name: "Quality Scoring", status: "complete", qualified: qualified.length, filtered_out: allCompanies.length - qualified.length });

          // Send initial companies immediately so UI can start rendering
          send("companies", { companies: qualified.slice(0, 20), partial: true });

          // ── Phase 4: Contact Discovery ───────────────────────────────
          let companiesWithContacts = 0;
          if (qualified.length > 0 && !isCancelled) {
            phasesEmitted++;
            {
              const contactSources = ["Verified Email Database"];
              if (HUNTER_API_KEY) contactSources.push("Contact Database");
              if (depth !== "standard") { contactSources.push("B2B Database"); contactSources.push("Professional Network"); }
              send("phase", { phase: 4, name: "Contact Discovery", status: "searching", sources: contactSources });
            }

            const numToDiscover = depth === 'maximum' ? 8 : depth === 'deep' ? 5 : 3;
            const topForDiscovery = qualified.slice(0, numToDiscover);

            try {
              if (isCancelled) throw new Error("Cancelled");
              const [findymailSettled, hunterSettled, apolloSettled, linkedinSettled] = await Promise.allSettled([
                // Source 1: Findymail domain search
                Promise.allSettled(
                  topForDiscovery.map(async (c) => {
                    const cacheKey = `quick-discover:${c.domain}`;
                    const cached = await kv.get(cacheKey);
                    if (cached?.contacts && cached.timestamp && (Date.now() - cached.timestamp) < 7 * 24 * 60 * 60 * 1000) {
                      return { domain: c.domain, contacts: cached.contacts };
                    }
                    const contacts = await quickDiscoverContacts(c.domain);
                    await kv.set(cacheKey, { contacts, timestamp: Date.now() }).catch(() => {});
                    return { domain: c.domain, contacts };
                  })
                ),
                // Source 2: Hunter domain search (if API key available)
                HUNTER_API_KEY ? Promise.allSettled(
                  topForDiscovery.map(async (c) => {
                    try {
                      const response = await fetch(`https://api.hunter.io/v2/domain-search?domain=${c.domain}&limit=10&api_key=${HUNTER_API_KEY}`);
                      if (response.ok) {
                        const data = await response.json();
                        const emails = data.data?.emails || [];
                        const contacts = emails
                          .filter((e: any) => e.first_name && e.last_name && e.value)
                          .map((e: any) => ({
                            full_name: `${e.first_name} ${e.last_name}`,
                            title: e.position || 'Unknown',
                            email: e.value,
                            linkedin_url: e.linkedin || undefined,
                            source: 'hunter_discovery',
                            role_tier: getRoleTier(e.position || ''),
                          }));
                        return { domain: c.domain, contacts };
                      }
                      return { domain: c.domain, contacts: [] };
                    } catch (err) {
                      console.warn(`[LEAD ENGINE SSE] Hunter search failed for ${c.domain}:`, err);
                      return { domain: c.domain, contacts: [] };
                    }
                  })
                ) : Promise.resolve([]),
                // Source 3: Apollo people search
                depth !== 'standard' ? searchPeopleViaApollo(qualified, industry, location, SERPAPI_API_KEY) : Promise.resolve([]),
                // Source 4: LinkedIn people search
                depth !== 'standard' ? searchPeopleViaLinkedIn(qualified, industry, location, SERPAPI_API_KEY) : Promise.resolve([])
              ]);

              // Apply Findymail results
              if (findymailSettled.status === 'fulfilled') {
                for (const result of findymailSettled.value) {
                  if (result.status === 'fulfilled' && result.value.contacts?.length > 0) {
                    const company = qualified.find(c => c.domain === result.value.domain);
                    if (company) {
                      company.discovered_contacts = result.value.contacts.map((contact: any) => ({
                        ...contact, source: contact.source || 'findymail_discovery'
                      }));
                      company.quality_score = (company.quality_score || 0) + 25;
                      companiesWithContacts++;
                    }
                  }
                }
                send("progress", { phase: 4, source: "Verified Email Database", status: "done" });
              }

              // Apply Hunter results
              if (HUNTER_API_KEY && hunterSettled.status === 'fulfilled' && Array.isArray(hunterSettled.value)) {
                for (const result of hunterSettled.value) {
                  if (result.status === 'fulfilled' && result.value.contacts?.length > 0) {
                    const company = qualified.find(c => c.domain === result.value.domain);
                    if (company) {
                      if (!company.discovered_contacts) company.discovered_contacts = [];
                      for (const contact of result.value.contacts) {
                        const alreadyFound = company.discovered_contacts.some(dc => personDedupKey(dc.full_name) === personDedupKey(contact.full_name));
                        if (!alreadyFound) {
                          company.discovered_contacts.push(contact);
                          if (company.discovered_contacts.length === 1) {
                            company.quality_score = (company.quality_score || 0) + 25;
                            companiesWithContacts++;
                          }
                        }
                      }
                    }
                  }
                }
                send("progress", { phase: 4, source: "Contact Database", status: "done" });
              }

              // Merge Apollo people
              if (apolloSettled.status === 'fulfilled' && apolloSettled.value.length > 0) {
                const apolloPeople = apolloSettled.value as DiscoveredPerson[];
                for (const person of apolloPeople) {
                  const matched = matchPersonToCompany(person, qualified);
                  if (matched) {
                    if (!matched.discovered_contacts) matched.discovered_contacts = [];
                    const alreadyFound = matched.discovered_contacts.some(dc => personDedupKey(dc.full_name) === personDedupKey(person.full_name));
                    if (!alreadyFound) {
                      matched.discovered_contacts.push({ full_name: person.full_name, title: person.title, linkedin_url: person.linkedin_url, source: person.source, role_tier: person.role_tier });
                      if (!matched.quality_score || matched.discovered_contacts.length === 1) {
                        matched.quality_score = (matched.quality_score || 0) + 25;
                        companiesWithContacts++;
                      }
                    }
                  }
                }
                send("progress", { phase: 4, source: "B2B Database", status: "done" });
              }

              // Merge LinkedIn people
              if (linkedinSettled.status === 'fulfilled' && linkedinSettled.value.length > 0) {
                const linkedinPeople = linkedinSettled.value as DiscoveredPerson[];
                for (const person of linkedinPeople) {
                  const matched = matchPersonToCompany(person, qualified);
                  if (matched) {
                    if (!matched.discovered_contacts) matched.discovered_contacts = [];
                    const alreadyFound = matched.discovered_contacts.some(dc => personDedupKey(dc.full_name) === personDedupKey(person.full_name));
                    if (!alreadyFound) {
                      matched.discovered_contacts.push({ full_name: person.full_name, title: person.title, linkedin_url: person.linkedin_url, source: person.source, role_tier: person.role_tier });
                      if (!matched.quality_score || matched.discovered_contacts.length === 1) {
                        matched.quality_score = (matched.quality_score || 0) + 25;
                        companiesWithContacts++;
                      }
                    }
                  }
                }
                send("progress", { phase: 4, source: "Professional Network", status: "done" });
              }

              // Sort contacts & cap
              for (const company of qualified) {
                if (company.discovered_contacts?.length) {
                  company.discovered_contacts.sort((a, b) => a.role_tier - b.role_tier);
                  company.discovered_contacts = company.discovered_contacts.slice(0, 5);
                }
              }

              qualified.sort((a, b) => {
                const aHas = (a.discovered_contacts?.length || 0) > 0 ? 1 : 0;
                const bHas = (b.discovered_contacts?.length || 0) > 0 ? 1 : 0;
                if (bHas !== aHas) return bHas - aHas;
                return (b.quality_score || 0) - (a.quality_score || 0);
              });

              companiesWithContacts = qualified.filter(c => c.discovered_contacts?.length).length;
            } catch (discoveryError: any) {
              console.warn(`[LEAD ENGINE SSE] Contact discovery failed:`, discoveryError.message);
            }

            send("phase", { phase: 4, name: "Contact Discovery", status: "complete", with_contacts: companiesWithContacts });

            // Send updated companies with contacts
            send("companies", { companies: qualified, partial: false });
          }

          // ── Phase 5: Auto-Enrichment ─────────────────────────────────
          if (isCancelled) return;
          let autoEnrichedCount = 0;
          const shouldAutoEnrich = qualified.length > 0 && companiesWithContacts > 0;
          const toAutoEnrich = shouldAutoEnrich
            ? qualified.filter(c => c.discovered_contacts?.length && !c.enrichedData).slice(0, depth === 'maximum' ? 2 : 1)
            : [];

          if (toAutoEnrich.length > 0) {
            phasesEmitted++;
            send("phase", { phase: 5, name: "Auto-Enrichment", status: "verifying_emails", count: toAutoEnrich.length });

            try {
              const enrichResults = await Promise.allSettled(
                toAutoEnrich.map(async (company) => {
                  const cacheKey = `enrich:${company.domain}`;
                  const cached = await kv.get(cacheKey);
                  if (cached?.enriched_at && (Date.now() - new Date(cached.enriched_at).getTime() < 30 * 24 * 60 * 60 * 1000)) {
                    const hasUnverified = cached.decision_makers?.some((dm: any) => dm.verification_status === 'derived' || dm.verification_status === 'unverified' || dm.verification_status === 'likely_valid');
                    if (!hasUnverified) return { domain: company.domain, ...cached, source: 'cache' };
                  }

                  const input: EnrichmentInput = {
                    company_name: company.name, company_domain: company.domain,
                    company_website_url: company.website, company_location: company.address
                  };
                  const result = await enrichLeadWithFindymail(input);
                  if (result.success) await kv.set(cacheKey, { ...result, enriched_at: new Date().toISOString() }).catch(() => {});
                  return { domain: company.domain, ...result };
                })
              );

              for (const settled of enrichResults) {
                if (settled.status === 'fulfilled' && settled.value.success) {
                  const enrichData = settled.value;
                  const company = qualified.find(c => c.domain === enrichData.domain);
                  if (company && enrichData.decision_makers?.length > 0) {
                    company.enrichedData = {
                      status: enrichData.status, decision_makers: enrichData.decision_makers,
                      notes: enrichData.notes, company_linkedin: enrichData.company?.linkedin_url,
                      estimated_revenue: enrichData.company?.estimated_revenue,
                      employee_count: enrichData.company?.employee_count,
                      verification_summary: enrichData.verification_summary,
                    };
                    autoEnrichedCount++;
                    send("progress", { phase: 5, domain: company.domain, name: company.name, contacts: enrichData.decision_makers.length });
                  }
                }
              }
            } catch (e: any) {
              console.warn(`[LEAD ENGINE SSE] Auto-enrichment failed:`, e.message);
            }

            send("phase", { phase: 5, name: "Auto-Enrichment", status: "complete", auto_enriched: autoEnrichedCount });
          } else {
            // Phase 5 skipped — emit so frontend can count it toward progress
            phasesEmitted++;
            send("phase", { phase: 5, name: "Auto-Enrichment", status: "skipped", reason: shouldAutoEnrich ? "no_candidates" : "no_contacts_discovered" });
          }

          // ── Phase 6: CRM Check ───────────────────────────��───────────
          if (isCancelled) return;
          phasesEmitted++;
          send("phase", { phase: 6, name: "CRM Check", status: "checking" });

          let savedDomains: string[] = [];
          try {
            const teamMemberIds = await getTeamMemberIds(user.id);
            const { data: existingLeads } = await supabase.from('leads').select('website').in('user_id', teamMemberIds).eq('source', 'lead_finder');
            if (existingLeads && existingLeads.length > 0) {
              const savedDomainSet = new Set<string>();
              for (const lead of existingLeads) {
                if (lead.website) { const d = extractDomain(lead.website); if (d) savedDomainSet.add(d); }
              }
              savedDomains = Array.from(savedDomainSet);
            }
          } catch (err: any) {
            console.warn(`[LEAD ENGINE SSE] CRM check failed:`, err.message);
          }

          send("phase", { phase: 6, name: "CRM Check", status: "complete", saved_count: savedDomains.length });

          // Cache search metadata
          const searchKey = `search:${industry}:${location}:${depth}`.toLowerCase().replace(/\s+/g, '-');
          await kv.set(searchKey, { timestamp: Date.now(), count: qualified.length, depth, top_domains: qualified.slice(0, 5).map(c => c.domain) });

          // ── Save discovered contacts to the global lead pool ──
          try {
            const poolLeads: PoolLead[] = [];
            for (const company of qualified) {
              const contacts = company.discovered_contacts || [];
              const enrichedDMs = company.enrichedData?.decision_makers || [];
              const allContacts = [
                ...contacts.filter((ct: any) => ct.email).map((ct: any) => ({
                  email: ct.email, name: ct.full_name || "", title: ct.title || "", linkedin: ct.linkedin_url || "",
                })),
                ...enrichedDMs.filter((dm: any) => dm.email).map((dm: any) => ({
                  email: dm.email, name: dm.name || "", title: dm.title || "", linkedin: dm.linkedin || "",
                })),
              ];
              const seenContactEmails = new Set<string>();
              for (const ct of allContacts) {
                const emailLower = ct.email.toLowerCase();
                if (seenContactEmails.has(emailLower)) continue;
                seenContactEmails.add(emailLower);
                const parts = ct.name.split(/\s+/);
                poolLeads.push({
                  id: crypto.randomUUID(),
                  first_name: parts[0] || "", last_name: parts.slice(1).join(" ") || "",
                  name: ct.name, title: ct.title, email: ct.email, email_status: "verified",
                  linkedin_url: ct.linkedin,
                  phone_numbers: company.phone ? [{ raw_number: company.phone, type: "company" }] : [],
                  city: "", state: "", country: "", seniority: "", departments: [],
                  organization: {
                    id: "", name: company.name || "", website_url: company.website || "",
                    linkedin_url: "", industry: company.industry || (company.types || []).join(", "),
                    estimated_num_employees: 0, annual_revenue_printed: "",
                    city: "", state: "", country: "",
                    short_description: company.description || "",
                    founded_year: 0, phone: company.phone || "",
                  },
                  _pool_source: "lead_engine",
                });
              }
            }
            if (poolLeads.length > 0) {
              saveToPool(poolLeads).catch((err: any) => console.warn(`[LEAD ENGINE] Pool save error: ${err.message}`));
              console.log(`[LEAD ENGINE] Queued ${poolLeads.length} contacts for pool save`);
            }
          } catch (poolErr: any) {
            console.warn(`[LEAD ENGINE] Pool save failed: ${poolErr.message}`);
          }

          // ── Final complete event ─────────────────────────────────────
          send("complete", {
            companies: qualified,
            saved_domains: savedDomains,
            actual_phases: phasesEmitted,
            meta: {
              total: qualified.length, total_raw: allCompanies.length,
              filtered_out: allCompanies.length - qualified.length, depth,
              pages_searched: pages,
              sources: ['google_maps', 'findymail_discovery', ...(HUNTER_API_KEY ? ['hunter_discovery'] : []), ...(depth !== 'standard' ? ['google_organic', 'apollo_people', 'linkedin_people'] : [])],
              with_contacts: companiesWithContacts, auto_enriched: autoEnrichedCount
            }
          });

        } catch (error: any) {
          // Only log real errors, not client disconnections
          if (!isCancelled && error?.name !== 'Http' && !error?.message?.includes('connection closed') && !error?.message?.includes('broken pipe') && !error?.message?.includes('EPIPE')) {
            send("error", { message: error.message });
            console.error('[LEAD ENGINE SSE] Stream error:', error);
          }
        } finally {
          safeClose();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      }
    });

  } catch (error: any) {
    // Don't log client disconnections
    if (error?.name !== 'Http' && !error?.message?.includes('connection closed') && !error?.message?.includes('broken pipe') && !error?.message?.includes('EPIPE')) {
      console.error('[LEAD ENGINE SSE] ========== SEARCH STREAM ERROR ==========');
      console.error('[LEAD ENGINE SSE] Error name:', error?.name);
      console.error('[LEAD ENGINE SSE] Error message:', error?.message);
      console.error('[LEAD ENGINE SSE] Error stack:', error?.stack);
      console.error('[LEAD ENGINE SSE] Full error:', error);
    }
    return c.json({ error: error.message || 'Search failed' }, 500);
  }
});

// ── POST /enrich — Enrich a single company ──────────────────────────────
app.post("/enrich", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { company } = await c.req.json();

    if (!company || !company.domain) {
      return c.json({ error: "Valid company object with domain required" }, 400);
    }

    console.log(`[LEAD ENGINE] Enriching ${company.name} (${company.domain})`);

    // Check cache (30-day TTL)
    const cacheKey = `enrich:${company.domain}`;
    const cached = await kv.get(cacheKey);
    if (cached?.enriched_at && (Date.now() - new Date(cached.enriched_at).getTime() < 30 * 24 * 60 * 60 * 1000)) {
       // Invalidate old cache entries that have unverified/derived emails (pre-v3 pipeline)
       const hasUnverifiedContacts = cached.decision_makers?.some(
         (dm: any) => dm.verification_status === 'derived' || dm.verification_status === 'unverified' || dm.verification_status === 'likely_valid'
       );
       if (!hasUnverifiedContacts) {
         console.log(`[LEAD ENGINE] Cache hit for ${company.domain} (verified)`);
         return c.json({ ...cached, source: 'cache' });
       }
       console.log(`[LEAD ENGINE] Cache invalidated for ${company.domain} (has unverified contacts from old pipeline)`);
    }

    const input: EnrichmentInput = {
      company_name: company.name,
      company_domain: company.domain,
      company_website_url: company.website,
      company_location: company.address
    };

    const result = await enrichLeadWithFindymail(input);

    // Cache successful results
    if (result.success) {
      await kv.set(cacheKey, {
        ...result,
        enriched_at: new Date().toISOString()
      });
    }

    return c.json(result);

  } catch (error) {
    console.error('[LEAD ENGINE] Enrichment error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /enrich-batch — Enrich multiple companies in sequence ──────────
app.post("/enrich-batch", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { companies } = await c.req.json();

    if (!Array.isArray(companies) || companies.length === 0) {
      return c.json({ error: "No companies provided" }, 400);
    }

    // Cap at 10 per batch to avoid timeout
    const batch = companies.slice(0, 10);
    console.log(`[LEAD ENGINE] Batch enriching ${batch.length} companies (concurrency 4)`);

    // PARALLEL enrichment with bounded concurrency.
    // Previously this was a `for await` loop — 10 companies × 3-8s each
    // = 30-80s sequential walltime, regularly hitting the Edge wall
    // clock and timing out. Now we issue 4 in flight at a time. With
    // typical 5s per call, 10 companies finish in ~15s instead of 50s.
    const CONCURRENCY = 4;
    const results: any[] = new Array(batch.length);

    const enrichOne = async (company: any, idx: number) => {
      if (!company.domain) {
        results[idx] = { domain: company.domain, success: false, reason: "no_domain" };
        return;
      }
      try {
        // Check cache first
        const cacheKey = `enrich:${company.domain}`;
        const cached = await kv.get(cacheKey);
        if (cached?.enriched_at && (Date.now() - new Date(cached.enriched_at).getTime() < 30 * 24 * 60 * 60 * 1000)) {
          const hasUnverified = cached.decision_makers?.some(
            (dm: any) => dm.verification_status === 'derived' || dm.verification_status === 'unverified' || dm.verification_status === 'likely_valid'
          );
          if (!hasUnverified) {
            results[idx] = { domain: company.domain, ...cached, source: 'cache' };
            return;
          }
          console.log(`[LEAD ENGINE] Batch: cache invalidated for ${company.domain} (unverified contacts)`);
        }

        const input: EnrichmentInput = {
          company_name: company.name,
          company_domain: company.domain,
          company_website_url: company.website,
          company_location: company.address,
        };
        const result = await enrichLeadWithFindymail(input);
        if (result.success) {
          await kv.set(cacheKey, { ...result, enriched_at: new Date().toISOString() });
        }
        results[idx] = { domain: company.domain, ...result };
      } catch (err: any) {
        console.error(`[LEAD ENGINE] Batch enrich error for ${company.domain}:`, err.message);
        results[idx] = { domain: company.domain, success: false, reason: err.message };
      }
    };

    // Simple bounded-concurrency runner — process the batch in waves of CONCURRENCY.
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map((c: any, j: number) => enrichOne(c, i + j)));
    }

    const enriched = results.filter(r => r.success).length;
    console.log(`[LEAD ENGINE] Batch complete: ${enriched}/${batch.length} enriched`);

    return c.json({
      success: true,
      results,
      meta: { total: batch.length, enriched, remaining: companies.length - batch.length }
    });

  } catch (error) {
    console.error('[LEAD ENGINE] Batch enrichment error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /save — Save selected leads to CRM ────────────────────────────
app.post("/save", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const { leads, search_industry } = await c.req.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return c.json({ error: "No leads provided" }, 400);
    }

    // **LEAD LIMIT CHECK** — enforce plan-based limits before saving
    const limitCheck = await checkLeadLimitEngine(user, supabase, leads.length);
    if (!limitCheck.allowed) {
      console.log(`[LEAD ENGINE LIMIT] User ${user.email} blocked: ${limitCheck.currentCount}/${limitCheck.limit} leads (plan: ${limitCheck.plan}), tried to save ${leads.length}`);
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

    console.log(`[LEAD ENGINE] Saving ${leads.length} leads to CRM`);

    // Fetch existing leads across the ENTIRE TEAM for dedup (prevents double-contacting)
    const teamMemberIds = await getTeamMemberIds(user.id);
    console.log(`[LEAD ENGINE] Team dedup: checking ${teamMemberIds.length} member(s) for duplicates`);
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('email, website')
      .in('user_id', teamMemberIds);

    const existingEmails = new Set<string>(
      (existingLeads || []).map((l: any) => (l.email || '').toLowerCase()).filter(Boolean)
    );
    const existingDomains = new Set<string>(
      (existingLeads || []).map((l: any) => extractDomain(l.website || '')).filter(Boolean)
    );

    const results = {
      saved: 0,
      skipped: 0,
      failed: 0,
      blocked_dns: 0,
      errors: [] as string[],
      saved_domains: [] as string[],
    };

    // ── DNS MX Verification — pre-check all unique email domains ──
    const uniqueEmailDomains = new Set<string>();
    for (const lead of leads) {
      const contacts = [
        ...(lead.decision_makers || []),
        ...(lead.discovered_contacts || []),
        ...(lead.selected_dm ? [lead.selected_dm] : []),
      ];
      for (const c of contacts) {
        const email = (c.email || '').toLowerCase().trim();
        const domain = email.split('@')[1];
        if (domain) uniqueEmailDomains.add(domain);
      }
    }
    const invalidEmailDomains = new Set<string>();
    const domainArr = [...uniqueEmailDomains];
    for (let i = 0; i < domainArr.length; i += 15) {
      const batch = domainArr.slice(i, i + 15);
      const mxResults = await Promise.allSettled(
        batch.map(async (domain) => {
          const mx = await checkMxRecords(domain);
          return { domain, valid: mx.valid };
        })
      );
      for (const r of mxResults) {
        if (r.status === 'fulfilled' && !r.value.valid) {
          invalidEmailDomains.add(r.value.domain);
        }
      }
    }
    if (invalidEmailDomains.size > 0) {
      console.log(`[LEAD ENGINE] DNS MX check: ${invalidEmailDomains.size} domains have no MX records — emails from these domains will be blocked: ${[...invalidEmailDomains].join(', ')}`);
    }

    for (const lead of leads) {
      try {
        // Collect all contacts: decision_makers (enriched) + discovered_contacts + legacy selected_dm
        const allContacts: any[] = [];
        if (lead.decision_makers?.length > 0) {
          allContacts.push(...lead.decision_makers);
        } else if (lead.selected_dm) {
          // Legacy format: single selected_dm
          allContacts.push(lead.selected_dm);
        }
        // Also add discovered_contacts that aren't already in allContacts (by email)
        if (lead.discovered_contacts?.length > 0) {
          const existingContactEmails = new Set(allContacts.map((c: any) => (c.email || '').toLowerCase()).filter(Boolean));
          for (const dc of lead.discovered_contacts) {
            if (dc.email && !existingContactEmails.has(dc.email.toLowerCase())) {
              allContacts.push({
                full_name: dc.full_name,
                title: dc.title,
                email: dc.email,
                linkedin_url: dc.linkedin_url,
                source: dc.source || 'discovered',
                confidence_score: dc.confidence_score || 'N/A',
              });
              existingContactEmails.add(dc.email.toLowerCase());
            }
          }
        }

        if (allContacts.length === 0) {
          console.log(`[LEAD ENGINE] No contacts for ${lead.company?.name || 'unknown'}, skipping`);
          continue;
        }

        const leadDomain = extractDomain(lead.company?.website || '');
        let savedAnyForCompany = false;

        for (const dm of allContacts) {
          let emailLower = (dm.email || '').toLowerCase().trim();

          // Dedup by email only (not by domain — multiple contacts per company is valid)
          if (emailLower && existingEmails.has(emailLower)) {
            console.log(`[LEAD ENGINE] Skipping duplicate (email match): ${dm.email}`);
            results.skipped++;
            continue;
          }

          // Block emails with invalid DNS domains (no MX records = will bounce)
          if (emailLower) {
            const emailDomain = emailLower.split('@')[1];
            if (emailDomain && invalidEmailDomains.has(emailDomain)) {
              console.log(`[LEAD ENGINE] Blocked bad domain (no MX records): ${dm.email} — domain ${emailDomain}`);
              results.blocked_dns++;
              results.skipped++;
              continue;
            }
          }

          let mailboxNote = "";
          if (emailLower) {
            const mailbox = await verifyMailboxDeliverability(emailLower);
            mailboxNote = [
              `Mailbox Verification: ${mailbox.deliverability}`,
              `Mailbox Provider: ${mailbox.provider}`,
              `Mailbox Status: ${mailbox.provider_status || 'N/A'}`,
              `Mailbox Reason: ${mailbox.reason}`,
            ].join('\n');
            if (!mailbox.safe_to_send) {
              console.log(`[LEAD ENGINE] Blocked unsafe mailbox: ${dm.email} — ${mailbox.reason}`);
              results.skipped++;
              continue;
            }
            emailLower = mailbox.email;
          }

          const { error } = await supabase.from('leads').insert({
            user_id: user.id,
            business_name: lead.company.name,
            contact_name: dm.full_name,
            email: emailLower,
            phone: dm.phone || lead.company.phone,
            website: lead.company.website,
            address: lead.company.address,
            city: toTitleCase(extractCity(lead.company.address)),
            state: toTitleCase(extractState(lead.company.address)),
            category: toTitleCase(lead.company.types?.[0] || ''),
            industry: toTitleCase(lead.company.industry || search_industry || lead.company.types?.[0] || ''),
            job_title: dm.title || '',
            source: 'lead_finder',
            rating: lead.company.rating,
            reviews: lead.company.reviews,
            person_linkedin_url: dm.linkedin_url,
            linkedin: dm.linkedin_url,
            employees: lead.company.enrichedData?.employee_count,
            annual_revenue: parseRevenue(lead.company.enrichedData?.estimated_revenue),
            notes: `Imported via Lead Finder.\nRole: ${dm.title || 'N/A'}\nSeniority: ${dm.role_tier === 1 ? 'Owner' : dm.role_tier === 2 ? 'C-Suite' : dm.role_tier === 3 ? 'Director' : dm.role_tier === 4 ? 'Manager' : 'N/A'}\nSource: ${dm.source || 'N/A'}\nConfidence: ${dm.confidence_score || 'N/A'}\n${mailboxNote ? mailboxNote + '\n' : ''}LinkedIn: ${dm.linkedin_url || 'N/A'}\nCompany LinkedIn: ${lead.company.enrichedData?.company_linkedin || 'N/A'}\nRevenue: ${lead.company.enrichedData?.estimated_revenue || 'N/A'}\nEmployees: ${lead.company.enrichedData?.employee_count || 'N/A'}`,
            status: 'Cold',
            created_at: new Date().toISOString()
          });

          if (error) throw error;
          results.saved++;
          savedAnyForCompany = true;
          // Track email so subsequent contacts in same batch are also deduped
          if (emailLower) existingEmails.add(emailLower);
        }

        if (savedAnyForCompany && leadDomain) {
          results.saved_domains.push(leadDomain);
        }

      } catch (e) {
        console.error(`[LEAD ENGINE] Failed to save lead ${lead.company?.name || 'unknown'}:`, e);
        results.failed++;
        results.errors.push(e.message);
      }
    }

    if (results.skipped > 0 || results.blocked_dns > 0) {
      console.log(`[LEAD ENGINE] Save complete: ${results.saved} saved, ${results.skipped} skipped (${results.blocked_dns} bad DNS domains blocked), ${results.failed} failed`);
    }

    return c.json({ success: true, results });

  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /verify-email — Verify a single email on-demand ────────────────
app.post("/verify-email", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { email } = await c.req.json();

    if (!email || !email.includes('@')) {
      return c.json({ error: "Valid email address required" }, 400);
    }

    console.log(`[LEAD ENGINE] On-demand email verification: ${email}`);
    const mailbox = await verifyMailboxDeliverability(email);

    return c.json({
      success: true,
      email: mailbox.email,
      status: mailbox.deliverability,
      deliverable: mailbox.safe_to_send,
      provider: mailbox.provider,
      provider_status: mailbox.provider_status,
      reason: mailbox.reason,
    });

  } catch (error) {
    console.error('[LEAD ENGINE] Email verification error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /verify-batch — Verify multiple emails ────────────────────────
app.post("/verify-batch", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { emails } = await c.req.json();

    if (!Array.isArray(emails) || emails.length === 0) {
      return c.json({ error: "Array of emails required" }, 400);
    }

    // Cap at 20 per batch
    const batch = emails.slice(0, 20);
    console.log(`[LEAD ENGINE] Batch email verification: ${batch.length} emails`);

    const results = [];
    for (const email of batch) {
      if (!email || !email.includes('@')) {
        results.push({ email, status: 'invalid', deliverable: false });
        continue;
      }
      const mailbox = await verifyMailboxDeliverability(email);
      results.push({
        email: mailbox.email,
        status: mailbox.deliverability,
        deliverable: mailbox.safe_to_send,
        provider: mailbox.provider,
        provider_status: mailbox.provider_status,
        reason: mailbox.reason,
      });
    }

    const verified = results.filter(r => r.deliverable).length;
    console.log(`[LEAD ENGINE] Batch verify complete: ${verified}/${batch.length} deliverable`);

    return c.json({
      success: true,
      results,
      meta: { total: batch.length, deliverable: verified, failed: batch.length - verified }
    });

  } catch (error) {
    console.error('[LEAD ENGINE] Batch verification error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ── Saved Searches ──────────────────────────────────────────────────────
app.get("/saved-searches", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const searches = await kv.get(`saved_searches:${user.id}`) || [];
    return c.json({ searches });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

app.post("/saved-searches", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { id, name, industry, location, keywords, depth } = await c.req.json();
    
    const key = `saved_searches:${user.id}`;
    let searches = await kv.get(key) || [];
    
    if (id) {
        // Update existing
        const idx = searches.findIndex((s: any) => s.id === id);
        if (idx >= 0) {
            searches[idx] = { ...searches[idx], name, industry, location, keywords, depth, updated_at: new Date().toISOString() };
        } else {
            // If ID provided but not found, create new (shouldn't happen often)
            searches.unshift({ id, name, industry, location, keywords, depth, created_at: new Date().toISOString() });
        }
    } else {
        // Create new
        const newId = crypto.randomUUID();
        searches.unshift({ 
            id: newId, 
            name: name || `${industry} in ${location}`, 
            industry, 
            location, 
            keywords, 
            depth,
            created_at: new Date().toISOString() 
        });
    }
    
    // Limit to 50 saved searches
    if (searches.length > 50) searches = searches.slice(0, 50);
    
    await kv.set(key, searches);
    return c.json({ success: true, searches });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

app.delete("/saved-searches/:id", async (c) => {
    try {
        const { user } = await getAuthenticatedUser(c);
        const id = c.req.param('id');
        const key = `saved_searches:${user.id}`;
        let searches = await kv.get(key) || [];
        searches = searches.filter((s: any) => s.id !== id);
        await kv.set(key, searches);
        return c.json({ success: true, searches });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
});

// ── Helpers ─────────���───────────────────────────────────────────────────
function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return "";
  }
}

function extractCity(address: string): string {
  if (!address) return "";
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  
  if (parts.length >= 4) {
    // Format: "Street, City, State ZIP, Country" → City is second part
    return parts[1];
  } else if (parts.length === 3) {
    // Format: "City, State, Country" → City is first part
    return parts[0];
  } else if (parts.length === 2) {
    // Format: "City, State" → City is first part
    return parts[0];
  }
  return parts[0] || "";
}

function extractState(address: string): string {
  if (!address) return "";
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  
  if (parts.length >= 4) {
    // Format: "Street, City, State ZIP, Country" → extract state abbreviation
    const stateZip = parts[2];
    const stateMatch = stateZip.match(/^([A-Za-z\s]+)/);
    return stateMatch ? stateMatch[1].trim() : stateZip;
  } else if (parts.length === 3) {
    // Format: "City, State, Country" → State is second part
    return parts[1];
  } else if (parts.length === 2) {
    // Format: "City, State" → State is second part
    return parts[1];
  }
  return "";
}

function parseRevenue(val: string | undefined): number | null {
  if (!val) return null;
  // Remove '$', ',', '+'
  const clean = val.replace(/[$,+]/g, '').trim();
  
  // Handle range "1M - 10M"
  if (clean.includes('-')) {
    const parts = clean.split('-').map(p => p.trim());
    const parsePart = (s: string) => {
        const upper = s.toUpperCase();
        let mult = 1;
        if (upper.endsWith('B')) mult = 1e9;
        else if (upper.endsWith('M')) mult = 1e6;
        else if (upper.endsWith('K')) mult = 1e3;
        const n = parseFloat(upper.replace(/[BMK]/g, ''));
        return isNaN(n) ? null : n * mult;
    };
    const min = parsePart(parts[0]);
    const max = parsePart(parts[1]);
    if (min !== null && max !== null) return (min + max) / 2;
    return min || max;
  }
  
  const upper = clean.toUpperCase();
  let mult = 1;
  if (upper.endsWith('B')) mult = 1e9;
  else if (upper.endsWith('M')) mult = 1e6;
  else if (upper.endsWith('K')) mult = 1e3;
  
  const num = parseFloat(upper.replace(/[BMK]/g, ''));
  if (isNaN(num)) return null;
  return num * mult;
}

// ── Saved Lists Routes ────────────────────────────────────────────────
// Store lead lists in KV store

app.get("/lists", async (c) => {
    try {
        const { user } = await getAuthenticatedUser(c);
        
        console.log(`[LEAD ENGINE] Fetching lists for user: ${user.id}`);
        
        // Scan for all lists meta for this user
        // Using prefix list_meta:{userId}:
        const prefix = `list_meta:${user.id}:`;
        const metas = await kv.getByPrefix(prefix);
        
        console.log(`[LEAD ENGINE] Found ${metas.length} lists for user ${user.id}`);
        
        // Sort by created_at desc
        metas.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        return c.json({ lists: metas });
    } catch (error: any) {
        console.error('[LEAD ENGINE] Get lists error:', error);
        return c.json({ error: error.message || 'Failed to load lists' }, 500);
    }
});

app.get("/lists/:id", async (c) => {
    try {
        const { user } = await getAuthenticatedUser(c);
        const listId = c.req.param("id");
        
        // Check ownership via meta
        const metaKey = `list_meta:${user.id}:${listId}`;
        const meta = await kv.get(metaKey);
        
        if (!meta) {
            return c.json({ error: "List not found" }, 404);
        }
        
        // Get data
        const dataKey = `list_data:${user.id}:${listId}`;
        const data = await kv.get(dataKey);
        
        // Support both standard (companies) and apollo (leads) list types
        const listType = meta.type || 'standard';
        if (listType === 'apollo') {
            return c.json({ list: meta, leads: data || [] });
        }
        return c.json({ list: meta, companies: data || [] });
    } catch (error: any) {
        console.error('[LEAD ENGINE] Get list error:', error);
        return c.json({ error: error.message }, 500);
    }
});

app.post("/lists", async (c) => {
    try {
        const { user } = await getAuthenticatedUser(c);
        const { name, industry, location, keywords, depth, companies, leads, type, search_params } = await c.req.json();
        
        if (!name) {
            return c.json({ error: "List name is required" }, 400);
        }
        
        const listId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const listType = type || 'standard';
        const data = listType === 'apollo' ? (leads || []) : (companies || []);
        
        const meta = {
            id: listId,
            name,
            type: listType,
            industry: industry || '',
            location: location || '',
            keywords: keywords || '',
            depth: depth || '',
            search_params: search_params || null,
            count: data.length,
            created_at: timestamp
        };
        
        // Store meta and data
        const metaKey = `list_meta:${user.id}:${listId}`;
        const dataKey = `list_data:${user.id}:${listId}`;
        
        await kv.set(metaKey, meta);
        await kv.set(dataKey, data);
        
        console.log(`[LEAD ENGINE] Saved list "${name}" (${listType}) with ${data.length} items for user ${user.id}`);
        
        return c.json({ success: true, list: meta });
    } catch (error: any) {
        console.error('[LEAD ENGINE] Save list error:', error);
        return c.json({ error: error.message }, 500);
    }
});

app.delete("/lists/:id", async (c) => {
    try {
        const { user } = await getAuthenticatedUser(c);
        const listId = c.req.param("id");
        
        const metaKey = `list_meta:${user.id}:${listId}`;
        const dataKey = `list_data:${user.id}:${listId}`;
        
        // Check existence
        const existing = await kv.get(metaKey);
        if (!existing) {
            return c.json({ error: "List not found" }, 404);
        }
        
        await kv.del(metaKey);
        await kv.del(dataKey);
        
        return c.json({ success: true });
    } catch (error: any) {
        console.error('[LEAD ENGINE] Delete list error:', error);
        return c.json({ error: error.message }, 500);
    }
});

// ── POST /people-search — Targeted People Discovery ───────────────────
app.post("/people-search", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { jobTitles, location, industry, keywords, companies = [] } = await c.req.json();

    if ((!industry && companies.length === 0) || !location) {
      return c.json({ error: "Location and Industry (or Company list) are required" }, 400);
    }

    const SERPAPI_API_KEY = Deno.env.get("SERPAPI_API_KEY");
    const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");
    const FINDYMAIL_API_KEY = Deno.env.get("FINDYMAIL_API_KEY");
    
    console.log(`[LEAD ENGINE] People search: "${jobTitles.join(', ')}" in "${location}" (User: ${user.email})`);
    console.log(`[LEAD ENGINE] API Keys: SerpApi=${!!SERPAPI_API_KEY}, Hunter=${!!HUNTER_API_KEY}, Findymail=${!!FINDYMAIL_API_KEY}`);

    let targetCompanies: RawCompany[] = [];

    // 1. If companies provided, use them (simple object creation)
    if (companies.length > 0) {
      targetCompanies = companies.map((name: string) => ({
        name,
        domain: extractDomain(name) || name.toLowerCase().replace(/\s+/g, '') + ".com", // Best guess if not provided
        website: "",
        source: "user_provided"
      }));
    } else {
      // 2. Otherwise, find companies first (reusing Maps search logic, limited to 1 page)
      const query = `${industry} in ${location} ${keywords || ''}`.trim();
      const params = new URLSearchParams({
        engine: "google_maps",
        q: query,
        api_key: SERPAPI_API_KEY!,
        type: "search",
        start: "0"
      });

      const response = await fetch(`https://serpapi.com/search?${params}`);
      if (response.ok) {
        const data = await response.json();
        const results = data.local_results || [];
        
        for (const r of results) {
            const domain = extractDomain(r.website);
            if (!domain || isJunkDomain(domain)) continue;
            
            targetCompanies.push({
                name: r.title,
                domain,
                website: r.website,
                phone: r.phone,
                address: r.address,
                source: 'google_maps'
            });
        }
      }
      // Limit to top 8 companies for people search to avoid timeouts
      targetCompanies = targetCompanies.slice(0, 8);
    }

    if (targetCompanies.length === 0) {
        return c.json({ success: true, prospects: [] });
    }

    console.log(`[LEAD ENGINE] Searching for people at ${targetCompanies.length} companies...`);

    // 3. Search for people at these companies
    // We'll use parallel execution for speed
    const allPeople: any[] = [];
    const seenEmails = new Set<string>();

    await Promise.all(targetCompanies.map(async (company) => {
        // A. Hunter Domain Search (if API key available)
        if (HUNTER_API_KEY) {
            try {
                // Hunter domain search returns people with emails directly
                const response = await fetch(`https://api.hunter.io/v2/domain-search?domain=${company.domain}&limit=10&api_key=${HUNTER_API_KEY}`);
                if (response.ok) {
                    const data = await response.json();
                    const emails = data.data?.emails || [];
                    
                    for (const e of emails) {
                        const title = (e.position || e.seniority || "").toLowerCase();
                        // Filter by job titles if provided
                        const matchesTitle = jobTitles.length === 0 || jobTitles.some((t: string) => title.includes(t.toLowerCase()));
                        
                        if (matchesTitle && e.value && !seenEmails.has(e.value)) {
                            seenEmails.add(e.value);
                            allPeople.push({
                                id: crypto.randomUUID(),
                                name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
                                title: e.position || "Unknown",
                                company: company.name,
                                company_domain: company.domain,
                                email: e.value,
                                phone: e.phone_number,
                                linkedin: e.linkedin,
                                location: company.address || location,
                                source: 'hunter',
                                confidence: e.confidence
                            });
                        }
                    }
                }
            } catch (err) {
                console.warn(`[LEAD ENGINE] Hunter search failed for ${company.domain}:`, err);
            }
        }

        // B. Apollo/LinkedIn via SerpApi (if we need more people or don't have Hunter)
        // We only do this if we have fewer than 2 people from Hunter for this company
        const existingForCompany = allPeople.filter(p => p.company_domain === company.domain).length;
        if (existingForCompany < 2 && SERPAPI_API_KEY) {
             // We can reuse searchPeopleViaApollo/LinkedIn but they search *multiple* companies at once.
             // Here we are iterating company by company. 
             // To be efficient, we should actually batch this outside the loop, but for now let's skip
             // complex batching to keep code simple. We'll just rely on Hunter primarily.
             // If we really want "Find People" style, we should use the `searchPeopleViaApollo` function
             // passing just this one company in a list.
             
             try {
                 const discovered = await searchPeopleViaApollo([company], industry || "", location, SERPAPI_API_KEY);
                 for (const p of discovered) {
                     // Check if title matches
                     const title = p.title.toLowerCase();
                     const matchesTitle = jobTitles.length === 0 || jobTitles.some((t: string) => title.includes(t.toLowerCase()));
                     
                     if (matchesTitle) {
                         // We don't have email yet, but we found a person
                         // We could try to enrich them later or return as "unenriched"
                         allPeople.push({
                             id: crypto.randomUUID(),
                             name: p.full_name,
                             title: p.title,
                             company: company.name,
                             company_domain: company.domain,
                             linkedin: p.linkedin_url,
                             location: company.address || location,
                             source: 'apollo_discovery',
                             status: 'new' // needs enrichment
                         });
                     }
                 }
             } catch (err) {
                 console.warn(`[LEAD ENGINE] Apollo search failed for ${company.name}:`, err);
             }
        }
    }));

    return c.json({ 
        success: true, 
        prospects: allPeople 
    });

  } catch (error: any) {
    console.error('[LEAD ENGINE] People search error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /team-leads — Fetch all leads across the team for shared CRM view ──
app.get("/team-leads", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const teamMemberIds = await getTeamMemberIds(user.id);
    
    // If user is solo (only their own ID), no team leads to show
    if (teamMemberIds.length <= 1) {
      return c.json({ leads: [], team_size: 1, members: [] });
    }

    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '1000');
    const search = c.req.query('search') || '';
    const brand = c.req.query('brand') || 'all';
    const offset = (page - 1) * perPage;

    console.log(`[LEAD ENGINE] Fetching team leads for ${teamMemberIds.length} members, page ${page}`);

    // Get team member details for attribution
    const teamId = await getTeamId(user.id);
    const membersList: any[] = await kv.get(`team:${teamId}:members`) || [];
    const memberMap = new Map<string, { name: string; email: string }>();
    for (const m of membersList) {
      memberMap.set(m.id, { name: m.name || m.email || 'Unknown', email: m.email || '' });
    }
    // Ensure the current user is in the map
    if (!memberMap.has(user.id)) {
      memberMap.set(user.id, { name: user.user_metadata?.name || user.email || 'You', email: user.email || '' });
    }

    // Query leads for all team members (excluding current user — they have their own view)
    const otherMemberIds = teamMemberIds.filter(id => id !== user.id);
    if (otherMemberIds.length === 0) {
      return c.json({ leads: [], team_size: teamMemberIds.length, members: Array.from(memberMap.entries()).map(([id, m]) => ({ id, ...m })) });
    }

    let query = supabase
      .from('leads')
      .select('*', { count: 'estimated' })
      .in('user_id', otherMemberIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (brand !== 'all') {
      query = query.eq('brand', brand);
    }

    if (search) {
      query = query.or(
        `business_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,category.ilike.%${search}%,city.ilike.%${search}%`
      );
    }

    let leads: any[] | null = null;
    let count: number | null = null;
    let queryErr: any = null;
    // Retry once on transient DB errors (timeout 57014, schema cache PGRST002, shared memory)
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await query;
      if (!res.error) { leads = res.data; count = res.count; queryErr = null; break; }
      queryErr = res.error;
      const isTransient = res.error.code === '57014' || res.error.code === 'PGRST002'
        || res.error.message?.includes('shared memory') || res.error.message?.includes('schema cache');
      if (isTransient && attempt === 0) {
        console.warn(`[LEAD ENGINE] Team leads transient error (${res.error.code}), retrying in 1s...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      break;
    }
    if (queryErr) {
      console.error('[LEAD ENGINE] Team leads query error:', queryErr);
      return c.json({ error: queryErr.message }, 500);
    }

    // ── Outreach attribution: who from the team already emailed each lead ──
    // The `emails` table does NOT have a `to_email` column.
    // Instead, emails link to recipients via `lead_id` → `leads.email`.
    // Two-step approach: (1) find leads by email, (2) query emails by lead_id.
    const leadEmails = (leads || [])
      .map((l: any) => (l.email || '').toLowerCase())
      .filter(Boolean);
    const uniqueLeadEmails = [...new Set(leadEmails)];

    const outreachMap = new Map<string, any[]>();

    if (uniqueLeadEmails.length > 0) {
      const EMAIL_BATCH = 100;
      const allOutreachRows: any[] = [];

      // Step 1: Find all leads whose email matches (across all team members)
      const leadIdToEmailMap = new Map<string, string>();
      for (let i = 0; i < uniqueLeadEmails.length; i += EMAIL_BATCH) {
        const batch = uniqueLeadEmails.slice(i, i + EMAIL_BATCH);
        let matchedLeads: any[] | null = null;
        let leadsErr: any = null;
        for (let _retry = 0; _retry < 3; _retry++) {
          const res = await supabase
            .from('leads')
            .select('id, email')
            .in('email', batch);
          leadsErr = res.error;
          matchedLeads = res.data;
          if (!leadsErr) break;
          const msg = leadsErr?.message || leadsErr?.code || '';
          const isTransient = msg.includes('schema cache') || msg.includes('PGRST002') || msg.includes('shared memory') || msg.includes('too many connections');
          if (!isTransient || _retry === 2) break;
          console.log(`[LEAD ENGINE] Transient DB error (attempt ${_retry + 1}/3), retrying in ${800 * (_retry + 1)}ms:`, msg);
          await new Promise(r => setTimeout(r, 800 * (_retry + 1)));
        }
        if (leadsErr) {
          console.error('[LEAD ENGINE] Team outreach leads lookup error:', leadsErr);
        } else if (matchedLeads) {
          for (const ml of matchedLeads) {
            leadIdToEmailMap.set(ml.id, (ml.email || '').toLowerCase());
          }
        }
      }

      // Step 2: Query emails by lead_id for those leads, filtered to team members
      const matchedLeadIds = Array.from(leadIdToEmailMap.keys());
      if (matchedLeadIds.length > 0) {
        for (let i = 0; i < matchedLeadIds.length; i += EMAIL_BATCH) {
          const batch = matchedLeadIds.slice(i, i + EMAIL_BATCH);
          const { data: emailRows } = await supabase
            .from('emails')
            .select('user_id, campaign_id, sent_at, status, lead_id')
            .in('user_id', teamMemberIds)
            .in('lead_id', batch)
            .in('status', ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained'])
            .order('sent_at', { ascending: false })
            .limit(2000);
          if (emailRows) allOutreachRows.push(...emailRows);
        }
      }

      // Fetch campaign names
      const outCampaignIds = [...new Set(allOutreachRows.map(r => r.campaign_id).filter(Boolean))];
      const campaignNameLookup = new Map<string, string>();
      if (outCampaignIds.length > 0) {
        for (let i = 0; i < outCampaignIds.length; i += EMAIL_BATCH) {
          const batch = outCampaignIds.slice(i, i + EMAIL_BATCH);
          const { data: camps } = await supabase
            .from('campaigns')
            .select('id, name')
            .in('id', batch);
          if (camps) camps.forEach((c: any) => campaignNameLookup.set(c.id, c.name));
        }
      }

      // Group by email (resolve lead_id → email via our map)
      for (const row of allOutreachRows) {
        const normEmail = leadIdToEmailMap.get(row.lead_id) || '';
        if (!normEmail) continue;
        if (!outreachMap.has(normEmail)) outreachMap.set(normEmail, []);
        outreachMap.get(normEmail)!.push({
          user_id: row.user_id,
          contacted_by: memberMap.get(row.user_id)?.name || 'Team Member',
          contacted_by_email: memberMap.get(row.user_id)?.email || '',
          is_you: row.user_id === user.id,
          campaign_name: campaignNameLookup.get(row.campaign_id) || 'Unknown',
          campaign_id: row.campaign_id,
          sent_at: row.sent_at,
          status: row.status,
        });
      }

      // Deduplicate: most recent per (user_id + campaign_id)
      for (const [email, entries] of outreachMap) {
        const seen = new Map<string, any>();
        for (const e of entries) {
          const key = `${e.user_id}:${e.campaign_id}`;
          if (!seen.has(key) || new Date(e.sent_at) > new Date(seen.get(key).sent_at)) {
            seen.set(key, e);
          }
        }
        outreachMap.set(email, Array.from(seen.values()).sort(
          (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
        ));
      }
    }

    // Annotate each lead with team member name + outreach history
    const annotatedLeads = (leads || []).map((lead: any) => {
      const normEmail = (lead.email || '').toLowerCase();
      return {
        ...lead,
        added_by: memberMap.get(lead.user_id)?.name || 'Team Member',
        added_by_email: memberMap.get(lead.user_id)?.email || '',
        is_team_lead: true,
        team_outreach: outreachMap.get(normEmail) || [],
      };
    });

    console.log(`[LEAD ENGINE] Returning ${annotatedLeads.length} team leads (total: ${count}), ${outreachMap.size} with outreach`);

    return c.json({
      leads: annotatedLeads,
      total: count || 0,
      page,
      per_page: perPage,
      team_size: teamMemberIds.length,
      members: Array.from(memberMap.entries()).map(([id, m]) => ({ id, ...m })),
    });
  } catch (error: any) {
    console.error('[LEAD ENGINE] Team leads error:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;
