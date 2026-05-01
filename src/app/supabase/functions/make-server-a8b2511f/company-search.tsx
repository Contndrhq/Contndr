// ══════════════════════════════════════════════════════════════════════════
// Company Search — SerpAPI Google Maps + Google Search powered
// Replaces Apollo /companies endpoint (credits exhausted)
// Uses Google Maps for local business discovery with rich company data
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { getTeamMemberIds } from "./team.tsx";
import { secEdgarLookup, openCorporatesLookup, enhancedWebsiteScrape, detectTechStack } from "./gov-enrichment.tsx";
import { generateAI } from "./ai-provider.tsx";
import { verifyMailboxDeliverability } from "./email-verify.tsx";

const app = new Hono();
app.use("*", cors());

// ── Hunter.io rate-limit-aware fetch with retry + in-memory domain-search cache ──
const _hunterDomainCache = new Map<string, { data: any; ts: number }>();
const HUNTER_CACHE_TTL = 600_000; // 10 min in-memory
let _hunterRateLimited = false; // shared flag — skip Hunter after first 429 in a batch cycle
let _hunterRateLimitedAt = 0;

async function hunterFetchWithRetry(url: string, maxRetries = 0): Promise<Response | null> {
  // If Hunter was rate-limited recently, skip immediately to save time
  if (_hunterRateLimited && Date.now() - _hunterRateLimitedAt < 5 * 60_000) {
    return null;
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.status === 429) {
        // Mark globally rate-limited so parallel calls skip immediately
        _hunterRateLimited = true;
        _hunterRateLimitedAt = Date.now();
        const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
        const delay = Math.max((retryAfter || 300) * 1000, 5 * 60_000);
        console.warn(`[HUNTER] 429 rate limited — skipping Hunter for ${Math.round(delay / 1000)}s`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, Math.min(delay, 5000)));
          continue;
        }
        return null;
      }
      // Success — clear rate limit flag
      _hunterRateLimited = false;
      if (!res.ok) {
        console.error(`[HUNTER] HTTP ${res.status} error`);
        return null;
      }
      return res;
    } catch (e: any) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.error(`[HUNTER] Fetch failed after retries: ${e.message}`);
      return null;
    }
  }
  return null;
}

async function hunterDomainSearch(domain: string, apiKey: string, limit = 20): Promise<any | null> {
  const cacheKey = `${domain}:${limit}`;
  const cached = _hunterDomainCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < HUNTER_CACHE_TTL) {
    console.log(`[HUNTER] In-memory cache hit for domain "${domain}"`);
    return cached.data;
  }
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}&limit=${limit}&type=personal`;
  const res = await hunterFetchWithRetry(url);
  if (!res) return null;
  const data = await res.json();
  
  // Check for Hunter.io API errors (billing issues, rate limits, etc.)
  if (data.errors) {
    console.error(`[HUNTER] API error for domain "${domain}": ${JSON.stringify(data.errors)}`);
    return null;
  }
  
  _hunterDomainCache.set(cacheKey, { data, ts: Date.now() });
  // Store email pattern in pool intelligence if available
  if (data?.data?.pattern) {
    poolStoreEmailPattern(domain, data.data.pattern);
  }
  return data;
}

// ── Auth helper ──
async function getAuthenticatedUser(c: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) throw new Error("No Authorization header");
  const token = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "COMPANY-SEARCH");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── Types ──
interface CompanyResult {
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
  logo_url: string;
  rating?: number;
  reviews_count?: number;
  address?: string;
  types?: string[];
  // ── Enhanced enrichment fields ──
  legal_name?: string;
  company_type?: string;         // LLC, Corp, etc.
  incorporation_date?: string;
  company_status?: string;       // active/inactive
  sec_ticker?: string;
  sec_sic?: string;
  tech_stack?: { name: string; category: string }[];
  social_links?: Record<string, string>;
  careers_count?: number;        // open positions (growth signal)
  officers?: { name: string; position: string }[];
  data_sources?: string[];       // which enrichment sources contributed
}

// ── Brand Enrichment Constants (hoisted here so route handlers can reference them) ──
const BRAND_KV_PREFIX = "brandfetch:v3:"; // Bumped v2→v3: flush cache after tightening SerpAPI to domain-only matching + removing name-based logo lookups
const BRAND_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── SerpAPI Google Maps search ──
async function serpGoogleMaps(
  query: string,
  location?: string,
  start = 0,
  num = 20
): Promise<{ results: any[]; total?: number }> {
  const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
  if (!SERPAPI_KEY) throw new Error("SERPAPI_API_KEY not configured");

  const params = new URLSearchParams({
    engine: "google_maps",
    q: query,
    type: "search",
    api_key: SERPAPI_KEY,
    start: String(start),
  });

  // Google Maps engine doesn't support `location` without `ll` (lat,lng,zoom).
  // Instead, append location to the query — but keep it separate from quoted terms
  // so Google Maps treats it as a geographic filter, not part of the business name.
  if (location) {
    params.set("q", `${query} ${location}`);
  }

  console.log(`[COMPANY SEARCH] SerpAPI Google Maps: q="${params.get("q")}", location="${location || 'none'}", start=${start}`);

  const response = await fetch(`https://serpapi.com/search?${params}`, {
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[COMPANY SEARCH] SerpAPI error ${response.status}: ${errText}`);
    throw new Error(`SerpAPI request failed (${response.status})`);
  }

  const data = await response.json();

  // Google Maps returns `local_results` array
  const results = data.local_results || [];
  // SerpAPI sometimes reports very large totals; cap at a reasonable max
  // Google Maps typically returns up to ~120 results across pages (6 pages of 20)
  const rawTotal = data.search_information?.total_results || results.length;
  const total = Math.min(rawTotal, 500);

  console.log(`[COMPANY SEARCH] SerpAPI returned ${results.length} results (total: ${total}, raw: ${rawTotal})`);
  return { results, total };
}

// ── Fallback: SerpAPI Google Search for company-style results ──
async function serpGoogleSearch(
  query: string,
  location?: string,
  num = 20
): Promise<any[]> {
  const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
  if (!SERPAPI_KEY) return [];

  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: SERPAPI_KEY,
    num: String(num),
  });

  if (location) {
    params.set("location", location);
  }

  console.log(`[COMPANY SEARCH] SerpAPI Google fallback: q="${query}"`);

  try {
    const response = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return [];

    const data = await response.json();
    // Return local_results from Google search (business cards in search results)
    return data.local_results || [];
  } catch (err) {
    console.error("[COMPANY SEARCH] Google fallback error:", err);
    return [];
  }
}

// ── Company name lookup via Google Knowledge Graph + organic results ��─
// Used when searching by exact company name returns 0 Google Maps results
// (e.g. "First Service Residential" — nationwide company, not a local storefront).
async function knowledgeGraphLookup(
  companyName: string,
  location?: string
): Promise<CompanyResult[]> {
  const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
  if (!SERPAPI_KEY || !companyName.trim()) return [];

  const locSuffix = location ? ` ${location}` : "";
  const params = new URLSearchParams({
    engine: "google",
    q: `${companyName.trim()}${locSuffix}`,
    api_key: SERPAPI_KEY,
    num: "10",
  });

  try {
    const res = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();

    const results: CompanyResult[] = [];
    const seenNames = new Set<string>();
    const normQuery = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");

    // helper: check if two strings share at least one significant word
    const wordsOverlap = (a: string, b: string) =>
      a.split(/\s+/).filter(w => w.length > 2).some(w => b.includes(w.replace(/[^a-z0-9]/g, "")));

    // ── 1. Knowledge Graph (most authoritative) ──
    const kg = data.knowledge_graph;
    if (kg?.title) {
      const title = (kg.title as string).trim();
      const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isRelevant =
        wordsOverlap(companyName.toLowerCase(), normTitle) ||
        wordsOverlap(normTitle, normQuery);
      if (isRelevant && isPlausibleBusinessName(title)) {
        seenNames.add(normTitle);
        const rawWebsite = (kg.website || kg.official_website || "") as string;
        const website = rawWebsite.startsWith("http") ? rawWebsite : rawWebsite ? `https://${rawWebsite}` : "";
        const hq = ((kg.headquarters || kg.location || "") as string);
        const cityMatch = hq.match(/^([^,]+),?\s/);
        const stateMatch = hq.match(/,\s*([A-Z]{2})\b/);
        const empStr = ((kg.employees || kg.number_of_employees || kg.description || "") as string).toString();
        const empMatch = empStr.match(/(\d[\d,]+)\s*(?:employees|workers|staff)/i);
        const empNum = empMatch ? parseInt(empMatch[1].replace(/,/g, ""), 10) : 0;
        const foundedStr = ((kg.founded || kg.inception || "") as string).toString();
        const foundedYear = parseInt(foundedStr.match(/\d{4}/)?.[0] || "", 10) || 0;
        results.push({
          id: `kg-${Date.now()}-0`,
          name: title,
          website_url: website,
          linkedin_url: (kg as any).profiles?.linkedin || "",
          industry: toTitleCase((kg.type || kg.entity_type || "") as string),
          estimated_num_employees: empNum,
          annual_revenue_printed: "",
          city: cityMatch?.[1]?.trim() || "",
          state: stateMatch?.[1]?.trim() || "",
          country: "United States",
          short_description: (kg.description || "") as string,
          founded_year: (foundedYear > 1800 && foundedYear <= new Date().getFullYear()) ? foundedYear : 0,
          phone: (kg.phone || "") as string,
          logo_url: "",
          rating: 0,
          reviews_count: 0,
          address: hq,
        });
      }
    }

    // ── 2. Organic results: find the company's own homepage only ──
    // Critical: we only want the root domain homepage, not subpages like /earn-with-us or /news,
    // which Google indexes and which look like separate companies when parsed naively.
    const SKIP_DOMAINS = /linkedin\.com|facebook\.com|twitter\.com|yelp\.com|glassdoor\.com|indeed\.com|wikipedia\.org|bloomberg\.com|crunchbase\.com|instagram\.com|youtube\.com|bbb\.org|mapquest\.com|yellowpages\.com|bizapedia\.com|manta\.com|dnb\.com|hoovers\.com|zoominfo\.com|rocketreach\.com|apollo\.io|clearbit\.com/i;
    // Track seen root domains so we never emit two entries from the same site
    const seenRootDomains = new Set<string>();
    for (const existingResult of results) {
      if (existingResult.website_url) {
        const d = existingResult.website_url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
        if (d) seenRootDomains.add(d);
      }
    }

    for (let i = 0; i < Math.min((data.organic_results || []).length, 10); i++) {
      const r = data.organic_results[i];
      const link: string = r.link || "";
      const snippet: string = r.snippet || "";
      if (!link || SKIP_DOMAINS.test(link)) continue;

      // ── Subpage filter ──
      // Reject any URL with a non-trivial path (e.g. /earn-with-us, /news, /about, /contact).
      // These are internal pages of a company's website, not separate companies.
      // Only allow root domain or short locale path segments (en, us, uk, fr, de, etc.)
      let linkPath = "";
      try {
        const parsed = new URL(link.startsWith("http") ? link : `https://${link}`);
        linkPath = parsed.pathname.replace(/\/$/, ""); // strip trailing slash
      } catch { continue; }
      if (linkPath) {
        const pathParts = linkPath.split("/").filter(Boolean);
        if (pathParts.length > 1) continue; // multi-level path → definitely a subpage
        if (pathParts.length === 1) {
          const seg = pathParts[0].toLowerCase();
          // Allow only short locale/region codes (en, us, uk, fr, de, au, ca, mx, etc.)
          const isLocale = /^[a-z]{2,3}(-[a-z]{2})?$/.test(seg) && seg.length <= 5;
          if (!isLocale) continue; // /earn-with-us, /news, /about → skip
        }
      }

      // Root domain for deduplication (e.g. "roadr.com")
      const rootDomain = link.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
      const linkHost = rootDomain.replace(/[^a-z0-9]/g, "");

      // If we already have a result from this exact domain, don't add another
      if (seenRootDomains.has(rootDomain)) {
        // But do fill in missing fields on the existing result for this domain
        const existing = results.find(res => {
          const d = res.website_url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
          return d === rootDomain;
        });
        if (existing) {
          if (!existing.short_description && snippet) existing.short_description = snippet;
        } else if (results[0] && !results[0].website_url) {
          results[0].website_url = `https://${rootDomain}`;
        }
        continue;
      }

      const rawTitle = cleanCompanyName((r.title || "").split("|")[0].split(" - ")[0].trim());
      const normRawTitle = rawTitle.toLowerCase().replace(/[^a-z0-9]/g, "");

      const hostMatch = normQuery.length >= 4 && (linkHost.includes(normQuery.slice(0, 4)) || normQuery.includes(linkHost.slice(0, 4)));
      const titleMatch = normRawTitle.length >= 3 && (normRawTitle.includes(normQuery.slice(0, 4)) || normQuery.includes(normRawTitle.slice(0, 4)));
      if (!hostMatch && !titleMatch) continue;

      const title = rawTitle || companyName;
      if (!isPlausibleBusinessName(title)) continue;
      const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");

      // If this matches an already-found company (KG result), just fill in missing fields
      if (results[0] && (seenNames.has(normTitle) || normTitle.slice(0, 6) === results[0].name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6))) {
        if (!results[0].website_url) results[0].website_url = `https://${rootDomain}`;
        if (!results[0].short_description && snippet) results[0].short_description = snippet;
        seenRootDomains.add(rootDomain);
        continue;
      }

      seenNames.add(normTitle);
      seenRootDomains.add(rootDomain);
      results.push({
        id: `og-${Date.now()}-${i}`,
        name: title,
        // Always store the clean root domain URL, never a subpage URL
        website_url: `https://${rootDomain}`,
        linkedin_url: "",
        industry: "",
        estimated_num_employees: 0,
        annual_revenue_printed: "",
        city: "",
        state: "",
        country: "United States",
        short_description: snippet,
        founded_year: 0,
        phone: "",
        logo_url: "",
        rating: 0,
        reviews_count: 0,
        address: "",
      });
      if (results.length >= 3) break;
    }

    console.log(`[COMPANY SEARCH] KG lookup for "${companyName}" found ${results.length} results`);
    return results;
  } catch (err: any) {
    console.error("[COMPANY SEARCH] KG lookup error:", err.message);
    return [];
  }
}

// ── Enrich: try to scrape basic info from company website ──
async function quickScrapeCompanyInfo(
  website: string
): Promise<{ description?: string; linkedin_url?: string; employee_hint?: string; revenue_hint?: string; founded_hint?: string }> {
  if (!website) return {};
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return {};
    const html = await response.text();

    // Extract meta description
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i
    );
    const description = descMatch?.[1]?.trim() || "";

    // Extract LinkedIn URL
    const linkedinMatch = html.match(
      /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"'\s]+)/i
    );
    const linkedin_url = linkedinMatch?.[1] || "";

    // Try to find employee count hints
    const employeeMatch = html.match(
      /(\d[\d,]+)\s*(?:\+\s*)?(?:employees|team\s*members|people|staff|professionals)/i
    );
    const employee_hint = employeeMatch?.[1]?.replace(/,/g, "") || "";

    // Try to find revenue hints on website
    const revenueMatch = html.match(
      /(?:revenue|annual\s*revenue|yearly\s*revenue|sales)[^$\d]{0,30}\$\s*([\d,.]+)\s*(million|billion|M|B|K|thousand)/i
    ) || html.match(
      /\$\s*([\d,.]+)\s*(million|billion|M|B)\s*(?:in\s*)?(?:revenue|annual|sales)/i
    );
    let revenue_hint = "";
    if (revenueMatch) {
      const num = parseFloat(revenueMatch[1].replace(/,/g, ""));
      const unit = revenueMatch[2].toLowerCase();
      if (unit.startsWith("b")) revenue_hint = `$${num}B`;
      else if (unit === "m" || unit.startsWith("m")) revenue_hint = `$${num}M`;
      else if (unit === "k" || unit.startsWith("t")) revenue_hint = `$${num}K`;
      else revenue_hint = `$${num}`;
    }

    // Try JSON-LD structured data (schema.org Organization)
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of jsonLdMatches) {
      try {
        const ld = JSON.parse(m[1]);
        const orgs = Array.isArray(ld) ? ld : [ld];
        for (const org of orgs) {
          if (org["@type"] === "Organization" || org["@type"] === "Corporation" || org["@type"] === "LocalBusiness") {
            if (!employee_hint && org.numberOfEmployees) {
              const empVal = typeof org.numberOfEmployees === "object"
                ? org.numberOfEmployees.value || org.numberOfEmployees.minValue
                : org.numberOfEmployees;
              if (empVal) employee_hint = String(empVal).replace(/,/g, "");
            }
            if (!revenue_hint && org.revenue) {
              const revVal = typeof org.revenue === "object" ? org.revenue.value : org.revenue;
              if (revVal) revenue_hint = String(revVal);
            }
          }
        }
      } catch {
        // Invalid JSON-LD, skip
      }
    }

    // Try to find founded year
    const foundedMatch = html.match(
      /(?:founded|established|since|started)\s*(?:in\s*)?(\d{4})/i
    );
    const founded_hint = foundedMatch?.[1] || "";

    // ── Tech stack detection from HTML (free — no extra fetch needed) ──
    const tech_stack = detectTechStack(html);

    // ── Social links from HTML ──
    const socialPatterns: [string, RegExp][] = [
      ["linkedin", /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"'\s]+)/i],
      ["twitter", /href=["'](https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^"'\s]+)/i],
      ["facebook", /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s]+)/i],
    ];
    const social_links: Record<string, string> = {};
    for (const [key, pat] of socialPatterns) {
      const sm = html.match(pat);
      if (sm) social_links[key] = sm[1];
    }

    return { description, linkedin_url, employee_hint, revenue_hint, founded_hint, tech_stack, social_links };
  } catch {
    return {};
  }
}

// ── Batch LinkedIn enrichment via SerpAPI Google Search ──
// Uses ONE API call to find LinkedIn company pages for multiple companies
async function batchLinkedInEnrich(
  companies: CompanyResult[]
): Promise<Map<string, { employees?: string; revenue?: string; industry?: string; founded?: string }>> {
  const enrichMap = new Map<string, { employees?: string; revenue?: string; industry?: string; founded?: string }>();
  const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
  if (!SERPAPI_KEY || companies.length === 0) return enrichMap;

  // Build a query to find LinkedIn pages for multiple companies at once
  // Use batches of 5 to keep the query manageable
  const batches: CompanyResult[][] = [];
  for (let i = 0; i < Math.min(companies.length, 15); i += 5) {
    batches.push(companies.slice(i, i + 5));
  }

  for (const batch of batches) {
    try {
      const orParts = batch.map(c => `"${c.name}"`).join(" OR ");
      const query = `site:linkedin.com/company (${orParts})`;

      const params = new URLSearchParams({
        engine: "google",
        q: query,
        api_key: SERPAPI_KEY,
        num: "10",
      });

      const response = await fetch(`https://serpapi.com/search?${params}`, {
        signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) continue;
      const data = await response.json();
      const organicResults = data.organic_results || [];

      for (const result of organicResults) {
        const snippet = result.snippet || "";
        const title = result.title || "";
        const link = result.link || "";

        // Match to a company by name
        const matchedCompany = batch.find(c =>
          title.toLowerCase().includes(c.name.toLowerCase()) ||
          link.toLowerCase().includes(c.name.toLowerCase().replace(/[^a-z0-9]/g, ""))
        );

        if (!matchedCompany) continue;

        const enrichData: { employees?: string; revenue?: string; industry?: string; founded?: string } = {};

        // Parse employee count from LinkedIn snippet
        // LinkedIn snippets often look like: "Company · 1,001-5,000 employees"
        // or "501-1000 employees" or "10,001+ employees"
        const empMatch = snippet.match(
          /(\d[\d,]*(?:\s*-\s*\d[\d,]*)?(?:\+)?)\s*employees/i
        ) || title.match(
          /(\d[\d,]*(?:\s*-\s*\d[\d,]*)?(?:\+)?)\s*employees/i
        );
        if (empMatch) {
          enrichData.employees = empMatch[1].replace(/\s/g, "");
        }

        // Parse industry from LinkedIn snippet
        const industryMatch = snippet.match(
          /(?:industry|sector)[:\s]+([^·|•\n]+)/i
        );
        if (industryMatch) {
          enrichData.industry = industryMatch[1].trim();
        }

        // Parse revenue if mentioned
        const revMatch = snippet.match(
          /\$\s*([\d,.]+)\s*(million|billion|M|B)/i
        ) || snippet.match(
          /revenue[:\s]*\$?\s*([\d,.]+)\s*(million|billion|M|B|K)?/i
        );
        if (revMatch) {
          const num = parseFloat(revMatch[1].replace(/,/g, ""));
          const unit = (revMatch[2] || "").toLowerCase();
          if (unit.startsWith("b")) enrichData.revenue = `$${num}B`;
          else if (unit === "m" || unit.startsWith("m")) enrichData.revenue = `$${num}M`;
          else if (num > 1000) enrichData.revenue = `$${(num / 1000000).toFixed(1)}M`;
          else enrichData.revenue = `$${num}M`;
        }

        // Parse founded year
        const foundedMatch = snippet.match(/(?:founded|established|since)\s*(?:in\s*)?(\d{4})/i);
        if (foundedMatch) {
          enrichData.founded = foundedMatch[1];
        }

        if (Object.keys(enrichData).length > 0) {
          enrichMap.set(matchedCompany.id, enrichData);
          // Also store the LinkedIn URL if we don't have it
          if (!matchedCompany.linkedin_url && link.includes("linkedin.com/company")) {
            matchedCompany.linkedin_url = link;
          }
        }
      }
    } catch (err) {
      console.error("[COMPANY SEARCH] LinkedIn batch enrich error:", err);
    }
  }

  console.log(`[COMPANY SEARCH] LinkedIn enrichment found data for ${enrichMap.size} companies`);
  return enrichMap;
}

// ── Deep enrichment for a single company (knowledge graph + Google search + gov/registry) ──
async function deepEnrichCompany(
  companyName: string,
  location?: string,
  companyDomain?: string
): Promise<{
  employees?: number; employee_range?: string; revenue?: string; founded_year?: number;
  industry?: string; description?: string;
  legal_name?: string; company_type?: string; incorporation_date?: string; company_status?: string;
  sec_ticker?: string; sec_sic?: string;
  tech_stack?: { name: string; category: string }[];
  social_links?: Record<string, string>;
  careers_count?: number;
  officers?: { name: string; position: string }[];
  team_members?: { name: string; title: string; email?: string; linkedin?: string }[];
  data_sources?: string[];
}> {
  const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
  if (!SERPAPI_KEY) return {};

  try {
    const result: {
      employees?: number; employee_range?: string; revenue?: string; founded_year?: number;
      industry?: string; description?: string;
      legal_name?: string; company_type?: string; incorporation_date?: string; company_status?: string;
      sec_ticker?: string; sec_sic?: string;
      tech_stack?: { name: string; category: string }[];
      social_links?: Record<string, string>;
      careers_count?: number;
      officers?: { name: string; position: string }[];
      team_members?: { name: string; title: string; email?: string; linkedin?: string }[];
      data_sources?: string[];
    } = {};

    const dataSources: string[] = ["serpapi"];

    // ── Run ALL enrichment sources in parallel for maximum speed ──
    const locSuffix = location ? ` ${location}` : "";
    const serpQuery = `"${companyName}"${locSuffix} company employees revenue`;
    const serpParams = new URLSearchParams({ engine: "google", q: serpQuery, api_key: SERPAPI_KEY, num: "5" });

    const cleanDomain = companyDomain?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() || "";
    const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");

    const [serpResult, hunterResult, secResult, ocResult, webResult] = await Promise.allSettled([
      // 1. SerpAPI knowledge graph + organic results
      fetch(`https://serpapi.com/search?${serpParams}`, { signal: AbortSignal.timeout(6000) })
        .then(r => r.ok ? r.json() : null),
      // 2. Hunter.io domain search
      (cleanDomain && HUNTER_API_KEY)
        ? hunterDomainSearch(cleanDomain, HUNTER_API_KEY, 1)
        : Promise.resolve(null),
      // 3. SEC EDGAR
      secEdgarLookup(companyName),
      // 4. Corporate registry
      openCorporatesLookup(companyName, location),
      // 5. Enhanced website scrape
      companyDomain ? enhancedWebsiteScrape(companyDomain) : Promise.resolve(null),
    ]);

    // ── Process SerpAPI results ──
    if (serpResult.status === "fulfilled" && serpResult.value) {
      const data = serpResult.value;

      // Knowledge graph
      const kg = data.knowledge_graph;
      if (kg) {
        if (kg.employees || kg.number_of_employees) {
          const empStr = (kg.employees || kg.number_of_employees || "").toString();
          const empNum = parseInt(empStr.replace(/[^0-9]/g, ""), 10);
          if (empNum > 0) result.employees = empNum;
        }
        if (kg.revenue || kg.annual_revenue) {
          result.revenue = (kg.revenue || kg.annual_revenue || "").toString();
        }
        if (kg.founded) {
          const yr = parseInt(String(kg.founded).match(/\d{4}/)?.[0] || "", 10);
          if (yr > 1800 && yr <= new Date().getFullYear()) result.founded_year = yr;
        }
        if (kg.type || kg.industry) {
          result.industry = (kg.type || kg.industry || "").toString();
        }
        if (kg.description) {
          result.description = kg.description;
        }
      }

      // Answer box
      const answerBox = data.answer_box;
      if (answerBox?.answer || answerBox?.snippet) {
        const text = answerBox.answer || answerBox.snippet || "";
        if (!result.employees) {
          const empMatch = text.match(/(\d[\d,]+)\s*(?:employees|workers|staff)/i);
          if (empMatch) result.employees = parseInt(empMatch[1].replace(/,/g, ""), 10);
        }
        if (!result.revenue) {
          const revMatch = text.match(/\$\s*([\d,.]+)\s*(million|billion|M|B)/i);
          if (revMatch) {
            const num = parseFloat(revMatch[1].replace(/,/g, ""));
            const unit = revMatch[2].toLowerCase();
            if (unit.startsWith("b")) result.revenue = `$${num}B`;
            else result.revenue = `$${num}M`;
          }
        }
      }

      // Organic results
      for (const r of (data.organic_results || []).slice(0, 5)) {
        const snippet = r.snippet || "";

        if (!result.employees && !result.employee_range) {
          const empRangeMatch = snippet.match(/(\d[\d,]*\s*-\s*\d[\d,]*)\s*employees/i);
          if (empRangeMatch) {
            result.employee_range = empRangeMatch[1].replace(/\s/g, "");
            const parts = empRangeMatch[1].split("-").map((s: string) => parseInt(s.replace(/[^0-9]/g, ""), 10));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              result.employees = Math.round((parts[0] + parts[1]) / 2);
            }
          } else {
            const empMatch = snippet.match(/(\d[\d,]+)\s*(?:\+\s*)?(?:employees|workers|team members|staff)/i);
            if (empMatch) result.employees = parseInt(empMatch[1].replace(/,/g, ""), 10);
          }
        }

        if (!result.revenue) {
          const revMatch = snippet.match(/(?:revenue|sales|earnings)[^$]{0,20}\$\s*([\d,.]+)\s*(million|billion|M|B)/i)
            || snippet.match(/\$\s*([\d,.]+)\s*(million|billion|M|B)\s*(?:in\s*)?(?:revenue|sales|earnings)/i);
          if (revMatch) {
            const num = parseFloat(revMatch[1].replace(/,/g, ""));
            const unit = revMatch[2].toLowerCase();
            if (unit.startsWith("b")) result.revenue = `$${num}B`;
            else result.revenue = `$${num}M`;
          }
        }

        if (!result.founded_year) {
          const foundMatch = snippet.match(/(?:founded|established|started|since)\s*(?:in\s*)?(\d{4})/i);
          if (foundMatch) {
            const yr = parseInt(foundMatch[1], 10);
            if (yr > 1800 && yr <= new Date().getFullYear()) result.founded_year = yr;
          }
        }
      }
    }

    // ── Process Hunter.io results ──
    if (hunterResult.status === "fulfilled" && hunterResult.value) {
      const hData = hunterResult.value;
      const org = hData.data?.organization;
      if (org) {
        if (!result.industry && org.industry) result.industry = org.industry;
        if (!result.description && org.description) result.description = org.description;
      }
      const emailCount = hData.data?.total || 0;
      if (!result.employees && emailCount > 0) {
        result.employees = Math.max(emailCount, Math.round(emailCount * 2.5));
      }
    }

    // ── Process SEC EDGAR results ──
    if (secResult.status === "fulfilled" && secResult.value) {
      const sec = secResult.value;
      if (sec.legal_name) result.legal_name = sec.legal_name;
      if (sec.sic_description && !result.industry) result.industry = sec.sic_description;
      if (sec.ticker) result.sec_ticker = sec.ticker;
      if (sec.sic_description) result.sec_sic = sec.sic_description;
      if (sec.executives?.length) {
        result.officers = sec.executives.map(e => ({ name: e.name, position: e.title }));
      }
      if (sec.cik) dataSources.push("sec_edgar");
    }

    // ── Process Corporate registry results ──
    if (ocResult.status === "fulfilled" && ocResult.value) {
      const oc = ocResult.value;
      if (oc.legal_name && !result.legal_name) result.legal_name = oc.legal_name;
      if (oc.company_type) result.company_type = oc.company_type;
      if (oc.incorporation_date) {
        result.incorporation_date = oc.incorporation_date;
        if (!result.founded_year) {
          const yr = parseInt(oc.incorporation_date.slice(0, 4), 10);
          if (yr > 1800 && yr <= new Date().getFullYear()) result.founded_year = yr;
        }
      }
      if (oc.status) result.company_status = oc.status;
      if (oc.industry_codes?.length && !result.industry) {
        result.industry = oc.industry_codes[0];
      }
      if (oc.officers?.length) {
        const existingNames = new Set((result.officers || []).map(o => o.name.toLowerCase()));
        const newOfficers = oc.officers.filter(o => !existingNames.has(o.name.toLowerCase()));
        result.officers = [...(result.officers || []), ...newOfficers];
      }
      if (oc.legal_name) dataSources.push("corporate_registry");
    }

    // ── Process Enhanced website scrape results ──
    if (webResult.status === "fulfilled" && webResult.value) {
      const web = webResult.value;
      if (web.tech_stack?.length) {
        result.tech_stack = web.tech_stack;
        dataSources.push("website_techstack");
      }
      if (web.social_links && Object.keys(web.social_links).length > 0) {
        result.social_links = web.social_links;
      }
      if (web.careers_count && web.careers_count > 0) {
        result.careers_count = web.careers_count;
      }
      if (web.legal_entity_name && !result.legal_name) {
        result.legal_name = web.legal_entity_name;
      }
      if (web.team_members?.length) {
        result.team_members = web.team_members.slice(0, 15);
        dataSources.push("website_team");
      }
    }

    // ── Secondary Crunchbase lookup ONLY if we're still missing key data ──
    // This is the only sequential call — skipped if we already have employees + revenue
    if (!result.employees && !result.revenue && SERPAPI_KEY) {
      try {
        const cbQuery = `"${companyName}" (site:crunchbase.com OR site:bloomberg.com OR site:zoominfo.com) employees revenue founded`;
        const cbParams = new URLSearchParams({ engine: "google", q: cbQuery, api_key: SERPAPI_KEY, num: "5" });
        const cbResponse = await fetch(`https://serpapi.com/search?${cbParams}`, { signal: AbortSignal.timeout(4000) });
        if (cbResponse.ok) {
          const cbData = await cbResponse.json();
          for (const r of (cbData.organic_results || []).slice(0, 5)) {
            const snippet = r.snippet || "";
            const title = r.title || "";

            if (!result.employees) {
              const empMatch = snippet.match(/([\d,]+)\s*(?:\+?\s*)?(?:employees|people|staff|team)/i)
                || title.match(/([\d,]+)\s*(?:\+?\s*)?(?:employees|people)/i);
              if (empMatch) {
                const val = parseInt(empMatch[1].replace(/,/g, ""), 10);
                if (val > 0 && val < 10000000) result.employees = val;
              }
            }

            if (!result.revenue) {
              const revMatch = snippet.match(/(?:revenue|funding|raised)[^$]{0,30}\$\s*([\d,.]+)\s*(million|billion|M|B|K)/i)
                || snippet.match(/\$\s*([\d,.]+)\s*(million|billion|M|B)\s*(?:in\s*)?(?:revenue|funding|raised)/i);
              if (revMatch) {
                const num = parseFloat(revMatch[1].replace(/,/g, ""));
                const unit = revMatch[2].toLowerCase();
                if (unit.startsWith("b")) result.revenue = `$${num}B`;
                else result.revenue = `$${num}M`;
              }
            }

            if (!result.founded_year) {
              const foundMatch = snippet.match(/(?:founded|established|started|incorporated)\s*(?:in\s*)?((?:19|20)\d{2})/i);
              if (foundMatch) {
                const yr = parseInt(foundMatch[1], 10);
                if (yr > 1800 && yr <= new Date().getFullYear()) result.founded_year = yr;
              }
            }
          }
        }
      } catch (cbErr: any) {
        console.log(`[DEEP ENRICH] Crunchbase fallback failed (non-fatal): ${cbErr.message}`);
      }
    }

    result.data_sources = dataSources;
    console.log(`[DEEP ENRICH] Enrichment completed for "${companyName}" — sources: ${dataSources.join(", ")}`);
    return result;
  } catch (err) {
    console.error("[COMPANY SEARCH] Deep enrich error:", err);
    return {};
  }
}

// ── Parse employee range string to a number (midpoint) ──
function parseEmployeeRange(rangeStr: string): number {
  if (!rangeStr) return 0;
  // Handle "1,001-5,000" or "501-1000" or "10,001+" formats
  const cleaned = rangeStr.replace(/,/g, "").replace(/\s/g, "");
  if (cleaned.includes("-")) {
    const parts = cleaned.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return Math.round((parts[0] + parts[1]) / 2);
    }
  }
  const plusMatch = cleaned.match(/(\d+)\+/);
  if (plusMatch) return parseInt(plusMatch[1], 10);
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// ── Clean company name: strip SEO suffixes and reject non-business-name strings ──
function cleanCompanyName(raw: string): string {
  if (!raw) return "";
  // Remove common separators and everything after them
  let name = raw
    .split(/\s[–—|]\s/)[0]  // em dash, en dash, pipe with spaces
    .split(/\s-\s/)[0]       // hyphen with spaces
    .trim();

  // If name is still very long (>60 chars), it's likely still an SEO title — truncate at first punctuation
  if (name.length > 60) {
    const cut = name.match(/^(.{10,60}?)[\s,.:;!]/);
    if (cut) name = cut[1].trim();
  }

  // Remove trailing "Inc", "LLC", "Ltd" etc. only if they make name >40 chars (keep short names intact)
  if (name.length > 40) {
    name = name.replace(/\s*(,?\s*(Inc\.?|LLC|Ltd\.?|Co\.?|Corp\.?|Limited|PLC|LP|LLP|Group|International|Pvt\.?\s*Ltd\.?))+$/i, "").trim();
  }

  return name;
}

// ── Validate: is this string a plausible business name (not a headline/sentence)? ──
function isPlausibleBusinessName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 80) return false;

  // Reject strings that look like sentences/headlines (contain action verbs at start or mid-sentence)
  const sentencePatterns = /^(contact|explore|discover|learn|about|read|how to|why|what|get|find|visit|meet|welcome to|introducing|announcing|review of|guide to|best|top \d|comparing)/i;
  if (sentencePatterns.test(name)) return false;

  // Reject news-style headlines: "Company Acquires X", "Company Announces Y", "Company's Manager John"
  const headlineVerbs = /\b(acquires?|acquired|announces?|announced|launches?|launched|reports?|reported|expands?|expanded|hires?|hired|fires?|fired|settles?|settled|sues?|sued|files?|filed|raises?|raised|closes?|closed|opens?|opened|partners?|partnered|merges?|merged|buys?|bought|sells?|sold|wins?|won|loses?|lost|reveals?|revealed|unveils?|unveiled|signs?|signed)\b/i;
  if (headlineVerbs.test(name)) return false;

  // Reject strings with "'s" followed by role/title (e.g. "Asset Living's Community Manager Bruce")
  if (/\w+'s\s+(community|regional|general|area|district|senior|chief|head|vp|director|manager|ceo|cfo|cto|president|founder)/i.test(name)) return false;

  // Reject if too many words (real business names rarely exceed 7 words)
  const wordCount = name.split(/\s+/).length;
  if (wordCount > 8) return false;

  // Reject strings that end in common non-name suffixes
  if (/\.\.\.$/.test(name)) return false;  // truncated titles

  // Reject strings starting with articles that look like descriptions
  if (/^(the|a|an)\s+\w+\s+(of|for|to|in|at|by|with|from|about|near)\s+/i.test(name) && wordCount > 5) return false;

  return true;
}

// ── Clean website URL: strip UTM params, Google redirects, and tracking cruft ──
function cleanWebsiteUrl(raw: string): string {
  if (!raw) return "";
  let url = raw.trim();

  // Unwrap Google redirect URLs
  try {
    if (url.includes("google.com/url") || url.includes("google.com/aclk")) {
      const parsed = new URL(url);
      const inner = parsed.searchParams.get("q") || parsed.searchParams.get("url") || parsed.searchParams.get("adurl") || "";
      if (inner) url = inner;
    }
  } catch { /* not a valid URL, continue */ }

  // Strip UTM and common tracking parameters
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const paramsToRemove = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "UTM_source", "UTM_medium", "UTM_campaign", "UTM_term", "UTM_content",
      "fbclid", "gclid", "gclsrc", "dclid", "msclkid",
      "ref", "referrer", "source", "mc_cid", "mc_eid",
    ];
    for (const p of paramsToRemove) {
      parsed.searchParams.delete(p);
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    const hasParams = parsed.searchParams.toString().length > 0;
    if (!cleanPath || cleanPath === "") {
      url = parsed.origin;
    } else {
      url = hasParams ? `${parsed.origin}${cleanPath}?${parsed.searchParams}` : `${parsed.origin}${cleanPath}`;
    }
  } catch { /* not a valid URL, return as-is */ }

  url = url.replace(/\/+$/, "");
  return url;
}

// ── Parse Google Maps result into our Company format ──
function parseGoogleMapsResult(result: any, index: number): CompanyResult {
  const id = result.place_id || result.data_id || `gm-${Date.now()}-${index}`;
  const name = cleanCompanyName(result.title || "");
  const address = result.address || "";
  const addressParts = address.split(",").map((s: string) => s.trim());
  let city = "";
  let state = "";
  let country = "";

  if (addressParts.length >= 3) {
    city = addressParts[0] || "";
    // State might have zip code
    const stateZip = addressParts[addressParts.length - 2] || "";
    state = stateZip.replace(/\d{5}(-\d{4})?$/, "").trim();
    country = addressParts[addressParts.length - 1] || "";
  } else if (addressParts.length === 2) {
    city = addressParts[0] || "";
    state = addressParts[1] || "";
  } else if (addressParts.length === 1) {
    city = addressParts[0] || "";
  }

  // Industry from types
  const types = result.types || result.type_ids || [];
  const typeLabel = result.type || "";
  const industry = typeLabel || (Array.isArray(types) ? types[0] || "" : "");

  return {
    id,
    name,
    website_url: cleanWebsiteUrl(result.website || ""),
    linkedin_url: "",
    industry: toTitleCase(industry),
    estimated_num_employees: 0,
    annual_revenue_printed: "",
    city,
    state,
    country: country || "United States",
    short_description: result.description || "",
    founded_year: 0,
    phone: result.phone || "",
    logo_url: "", // Never use SerpAPI Google Maps thumbnails — they're listing photos, not company logos
    rating: result.rating || 0,
    reviews_count: result.reviews || 0,
    address,
    types,
  };
}

// ── Title case helper ──
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "if", "in", "nor", "of",
  "on", "or", "so", "the", "to", "up", "yet", "via",
]);

function toTitleCase(str: string | null | undefined): string {
  if (!str || typeof str !== "string") return "";
  return str
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/(\s+)/)
    .map((word, index) => {
      if (/^\s+$/.test(word)) return word;
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

// ── Build search query from filters ──
// Returns a primary query + fallback queries for retry when primary returns 0 results
function buildSearchQuery(params: {
  q_organization_name?: string;
  q_keywords?: string;
  organization_locations?: string[];
  organization_num_employees_ranges?: string[];
}): { query: string; location?: string; fallbackQueries: string[] } {
  const name = params.q_organization_name?.trim() || "";
  const keywords = params.q_keywords?.trim() || "";

  const location =
    params.organization_locations?.length
      ? params.organization_locations[0]
      : undefined;

  const fallbackQueries: string[] = [];

  // When both company name and keywords are provided, use quoted company name
  // to keep it as an exact phrase, then append keywords separately.
  // This prevents "Asset living Property management" from being treated as one blob.
  let query = "";
  if (name && keywords) {
    query = `"${name}" ${keywords}`;
    // Fallback 1: just the company name (broader)
    fallbackQueries.push(name);
    // Fallback 2: just keywords (broadest, location-only filtering)
    fallbackQueries.push(keywords);
  } else if (name) {
    query = name;
  } else if (keywords) {
    query = keywords;
  } else {
    query = "businesses";
  }

  return { query, location, fallbackQueries };
}

// ── KV caching for search results ──
const CACHE_TTL = 60 * 60; // 1 hour

// ══════════════════════════════════════════════════════════════════════════
// Pool Intelligence — Shared enrichment cache across ALL users
// Any data enriched by one user benefits everyone, saving API credits
// ══════════════════════════════════════════════════════════════════════════
const POOL_COMPANY_TTL  = 24 * 60 * 60 * 1000; // 24h for company enrichment
const POOL_PEOPLE_TTL   = 24 * 60 * 60 * 1000; // 24h for discovered people
const POOL_EMAIL_TTL    = 7 * 24 * 60 * 60 * 1000; // 7 days for verified emails
const POOL_PATTERN_TTL  = 7 * 24 * 60 * 60 * 1000; // 7 days for email patterns

// ── Pool Stats Tracking — fire-and-forget increment counters ──
const POOL_STATS_KEY = "pool:stats";

interface PoolStats {
  emails_stored: number;
  people_stored: number;
  companies_stored: number;
  patterns_stored: number;
  total_lookups: number;
  total_hits: number;
  api_calls_saved: number; // estimated API calls avoided by pool hits
  _ts: number;
}

async function getPoolStats(): Promise<PoolStats> {
  try {
    const raw = await kv.get(POOL_STATS_KEY);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return parsed as PoolStats;
    }
  } catch {}
  return { emails_stored: 0, people_stored: 0, companies_stored: 0, patterns_stored: 0, total_lookups: 0, total_hits: 0, api_calls_saved: 0, _ts: Date.now() };
}

async function incrementPoolStats(field: keyof Omit<PoolStats, "_ts">, count = 1): Promise<void> {
  // Fire-and-forget with error suppression to avoid blocking main flow
  Promise.resolve().then(async () => {
    try {
      const stats = await getPoolStats();
      (stats as any)[field] = ((stats as any)[field] || 0) + count;
      stats._ts = Date.now();
      await kv.set(POOL_STATS_KEY, JSON.stringify(stats));
    } catch (e) {
      // Silently fail - stats are non-critical
    }
  }).catch(() => {});
}

function emailPoolKey(firstName: string, lastName: string, domain: string): string {
  return `pool:email:${firstName.toLowerCase().trim()}:${lastName.toLowerCase().trim()}:${domain.toLowerCase().trim()}`;
}

async function poolStoreEmail(firstName: string, lastName: string, domain: string, email: string, source: string, confidence: string): Promise<void> {
  try {
    const key = emailPoolKey(firstName, lastName, domain);
    await kv.set(key, JSON.stringify({ email, source, confidence, _ts: Date.now() }));
    incrementPoolStats("emails_stored"); // fire-and-forget
  } catch {}
}

async function poolLookupEmail(firstName: string, lastName: string, domain: string): Promise<{ email: string; source: string; confidence: string } | null> {
  try {
    const key = emailPoolKey(firstName, lastName, domain);
    const cached = await kv.get(key);
    if (!cached) return null;
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    if (parsed._ts && Date.now() - parsed._ts < POOL_EMAIL_TTL) {
      if (!isTrustedEmailSource(parsed.source, parsed.confidence)) return null;
      return { email: parsed.email, source: parsed.source, confidence: parsed.confidence };
    }
  } catch {}
  return null;
}

async function poolBatchLookupEmails(
  people: { id: string; first_name: string; last_name: string }[],
  domain: string
): Promise<{ found: Record<string, { email: string; source: string; confidence: string }>; pending: { id: string; first_name: string; last_name: string }[] }> {
  const found: Record<string, { email: string; source: string; confidence: string }> = {};
  const pending: { id: string; first_name: string; last_name: string }[] = [];
  const keys = people.map(p => emailPoolKey(p.first_name, p.last_name, domain));
  try {
    const values = await kv.mget(keys);
    for (let i = 0; i < people.length; i++) {
      const val = values[i];
      if (val) {
        try {
          const parsed = typeof val === "string" ? JSON.parse(val) : val;
          if (parsed._ts && Date.now() - parsed._ts < POOL_EMAIL_TTL && parsed.email) {
            if (!isTrustedEmailSource(parsed.source, parsed.confidence)) {
              pending.push(people[i]);
              continue;
            }
            found[people[i].id] = { email: parsed.email, source: `pool:${parsed.source}`, confidence: parsed.confidence };
            continue;
          }
        } catch {}
      }
      pending.push(people[i]);
    }
  } catch {
    pending.push(...people);
  }
  return { found, pending };
}

async function poolStorePeople(companyName: string, domain: string, people: PersonResult[], hunterEmails: Record<string, { email: string; source: string; confidence: string }>): Promise<void> {
  try {
    const key = `pool:people:${companyName.toLowerCase().trim()}:${domain.toLowerCase().trim()}`;
    await kv.set(key, JSON.stringify({ people, hunterEmails, _ts: Date.now() }));
    incrementPoolStats("people_stored", people.length); // fire-and-forget
  } catch {}
}

async function poolLookupPeople(companyName: string, domain: string): Promise<{ people: PersonResult[]; hunterEmails: Record<string, { email: string; source: string; confidence: string }> } | null> {
  try {
    const key = `pool:people:${companyName.toLowerCase().trim()}:${domain.toLowerCase().trim()}`;
    const cached = await kv.get(key);
    if (!cached) return null;
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    if (parsed._ts && Date.now() - parsed._ts < POOL_PEOPLE_TTL && parsed.people?.length) {
      return { people: parsed.people, hunterEmails: parsed.hunterEmails || {} };
    }
  } catch {}
  return null;
}

async function poolStoreCompanyEnrich(companyName: string, location: string, data: any): Promise<void> {
  try {
    const key = `pool:company:${companyName.toLowerCase().trim()}:${(location || "").toLowerCase().trim()}`;
    await kv.set(key, JSON.stringify({ data, _ts: Date.now() }));
    incrementPoolStats("companies_stored"); // fire-and-forget
  } catch {}
}

async function poolLookupCompanyEnrich(companyName: string, location: string): Promise<any | null> {
  try {
    const key = `pool:company:${companyName.toLowerCase().trim()}:${(location || "").toLowerCase().trim()}`;
    const cached = await kv.get(key);
    if (!cached) return null;
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    if (parsed._ts && Date.now() - parsed._ts < POOL_COMPANY_TTL && parsed.data) {
      return parsed.data;
    }
  } catch {}
  return null;
}

async function poolStoreEmailPattern(domain: string, pattern: string): Promise<void> {
  try {
    const key = `pool:pattern:${domain.toLowerCase().trim()}`;
    await kv.set(key, JSON.stringify({ pattern, _ts: Date.now() }));
    incrementPoolStats("patterns_stored"); // fire-and-forget
  } catch {}
}

async function poolLookupEmailPattern(domain: string): Promise<string | null> {
  try {
    const key = `pool:pattern:${domain.toLowerCase().trim()}`;
    const cached = await kv.get(key);
    if (!cached) return null;
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    if (parsed._ts && Date.now() - parsed._ts < POOL_PATTERN_TTL && parsed.pattern) {
      return parsed.pattern;
    }
  } catch {}
  return null;
}

// ── CRM Cross-Reference Helper ──
// Queries the leads table to find existing contacts matching company names/websites
interface CrmContact {
  id: string;
  contact_name: string;
  email: string;
  phone: string;
  job_title: string;
  business_name: string;
  linkedin: string;
  industry: string;
  employees: string;
  annual_revenue: string;
  city: string;
  state: string;
  country: string;
  website: string;
  source: string;
}

async function crossReferenceCRM(
  supabase: any,
  userId: string,
  companyNames: string[],
  websites: string[]
): Promise<{ contactsByCompany: Record<string, CrmContact[]>; companyEnrich: Record<string, { employees?: string; revenue?: string; industry?: string; website?: string; linkedin?: string }> }> {
  const contactsByCompany: Record<string, CrmContact[]> = {};
  const companyEnrich: Record<string, { employees?: string; revenue?: string; industry?: string; website?: string; linkedin?: string }> = {};

  if (companyNames.length === 0) return { contactsByCompany, companyEnrich };

  try {
    const teamIds = await getTeamMemberIds(userId);
    console.log(`[CRM XREF] Checking ${companyNames.length} companies across ${teamIds.length} team member(s)`);

    // Fetch all team leads and match in-memory (more efficient than N queries at scale)
    // Retry on transient PostgREST errors (schema cache, connection reset, TLS)
    let teamLeads: any[] | null = null;
    const CRM_MAX_RETRIES = 3;
    for (let _crmAttempt = 0; _crmAttempt < CRM_MAX_RETRIES; _crmAttempt++) {
      const { data, error } = await supabase
        .from("leads")
        .select("id, contact_name, email, phone, job_title, business_name, person_linkedin_url, linkedin, industry, category, employees, annual_revenue, city, state, country, website, source")
        .in("user_id", teamIds)
        .not("business_name", "is", null)
        .limit(5000);

      if (error) {
        const msg = error.message || '';
        const isTransient = msg.includes('schema cache') || msg.includes('PGRST002')
          || msg.includes('connection reset') || msg.includes('tls handshake')
          || msg.includes('error sending request') || msg.includes('client error');
        if (isTransient && _crmAttempt < CRM_MAX_RETRIES - 1) {
          const delay = 500 * Math.pow(2, _crmAttempt);
          console.log(`[CRM XREF] Transient query error (attempt ${_crmAttempt + 1}/${CRM_MAX_RETRIES}), retrying in ${delay}ms: ${msg.slice(0, 120)}`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error("[CRM XREF] Query error:", error.message);
        return { contactsByCompany, companyEnrich };
      }
      teamLeads = data;
      break;
    }

    if (!teamLeads?.length) {
      console.log("[CRM XREF] No team leads found in CRM");
      return { contactsByCompany, companyEnrich };
    }

    console.log(`[CRM XREF] Loaded ${teamLeads.length} team leads, matching against ${companyNames.length} companies`);

    // ── Build domain index for O(1) lookups at scale ──
    // Index all lead domains for fast matching instead of nested loops
    const leadsByDomain = new Map<string, any[]>();  // domain -> leads[]
    const leadsByName = new Map<string, any[]>();     // lowercase biz name -> leads[]
    for (const lead of teamLeads) {
      const bizName = (lead.business_name || "").toLowerCase().trim();
      if (bizName) {
        if (!leadsByName.has(bizName)) leadsByName.set(bizName, []);
        leadsByName.get(bizName)!.push(lead);
      }
      const leadDomain = (lead.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase().trim();
      if (leadDomain) {
        if (!leadsByDomain.has(leadDomain)) leadsByDomain.set(leadDomain, []);
        leadsByDomain.get(leadDomain)!.push(lead);
        // Also index the root domain (e.g. "shop.example.com" -> "example.com")
        const parts = leadDomain.split(".");
        if (parts.length > 2) {
          const rootDomain = parts.slice(-2).join(".");
          if (!leadsByDomain.has(rootDomain)) leadsByDomain.set(rootDomain, []);
          leadsByDomain.get(rootDomain)!.push(lead);
        }
      }
    }

    console.log(`[CRM XREF] Domain index: ${leadsByDomain.size} domains, ${leadsByName.size} unique company names indexed`);

    // Track already-matched lead IDs to avoid duplicates across companies
    const matchedLeadIds = new Set<string>();

    // Match companies to leads using indexed lookups
    for (let ci = 0; ci < companyNames.length; ci++) {
      const companyName = companyNames[ci];
      const companyLower = companyName.toLowerCase().trim();
      const website = websites[ci] || "";
      const companyDomain = website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase().trim();
      const matchedLeads: any[] = [];

      // 1. Exact name match — O(1) via Map
      const exactMatches = leadsByName.get(companyLower);
      if (exactMatches) matchedLeads.push(...exactMatches);

      // 2. Domain match — O(1) via Map
      if (companyDomain) {
        const domainMatches = leadsByDomain.get(companyDomain);
        if (domainMatches) matchedLeads.push(...domainMatches);
        // Also check root domain
        const parts = companyDomain.split(".");
        if (parts.length > 2) {
          const rootDomain = parts.slice(-2).join(".");
          const rootMatches = leadsByDomain.get(rootDomain);
          if (rootMatches) matchedLeads.push(...rootMatches);
        }
      }

      // 3. Partial name match — only if no exact/domain hits (fallback, still O(N) but rare)
      if (matchedLeads.length === 0 && companyLower.length >= 3) {
        for (const [bizName, leads] of leadsByName) {
          if (bizName.length >= 3 && (bizName.includes(companyLower) || companyLower.includes(bizName))) {
            matchedLeads.push(...leads);
            break; // First match is enough for partial
          }
        }
      }

      // Dedup and process matched leads
      for (const lead of matchedLeads) {
        if (matchedLeadIds.has(lead.id)) continue;
        matchedLeadIds.add(lead.id);

        const contact: CrmContact = {
          id: lead.id,
          contact_name: lead.contact_name || "",
          email: lead.email || "",
          phone: lead.phone || "",
          job_title: lead.job_title || "",
          business_name: lead.business_name || "",
          linkedin: lead.person_linkedin_url || lead.linkedin || "",
          industry: lead.industry || lead.category || "",
          employees: lead.employees || "",
          annual_revenue: lead.annual_revenue || "",
          city: lead.city || "",
          state: lead.state || "",
          country: lead.country || "",
          website: lead.website || "",
          source: lead.source || "",
        };

        if (!contactsByCompany[companyName]) contactsByCompany[companyName] = [];
        contactsByCompany[companyName].push(contact);

        // Also extract enrichment data from CRM contacts to fill gaps
        if (!companyEnrich[companyName]) companyEnrich[companyName] = {};
        const ce = companyEnrich[companyName];
        if (!ce.employees && lead.employees) ce.employees = lead.employees;
        if (!ce.revenue && lead.annual_revenue) ce.revenue = lead.annual_revenue;
        if (!ce.industry && (lead.industry || lead.category)) ce.industry = lead.industry || lead.category;
        if (!ce.website && lead.website) ce.website = lead.website;
        if (!ce.linkedin && (lead.person_linkedin_url || lead.linkedin)) ce.linkedin = lead.person_linkedin_url || lead.linkedin;
      }
    }

    const matchedCount = Object.keys(contactsByCompany).length;
    const totalContacts = Object.values(contactsByCompany).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[CRM XREF] Matched ${totalContacts} CRM contacts across ${matchedCount} companies`);

  } catch (err: any) {
    console.error("[CRM XREF] Error:", err.message);
  }

  return { contactsByCompany, companyEnrich };
}

async function getCachedResults(cacheKey: string): Promise<CompanyResult[] | null> {
  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL * 1000) {
        console.log(`[COMPANY SEARCH] Cache hit: ${cacheKey}`);
        return parsed.results;
      }
    }
  } catch {
    // Cache miss
  }
  return null;
}

async function setCachedResults(cacheKey: string, results: CompanyResult[]): Promise<void> {
  try {
    await kv.set(cacheKey, JSON.stringify({ ts: Date.now(), results }));
  } catch (err) {
    console.error("[COMPANY SEARCH] Cache write error:", err);
  }
}

// ════════════════════════════════════════════════════════════════════════�����
// ROUTES
// ═════════════════════════════════════════════════════════════════════��════

// ── POST /search — Main company search ──
app.post("/search", async (c) => {
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
      append_mode = false, // When true, skip cache and always fetch fresh for this page
    } = body;

    console.log(`[COMPANY SEARCH] User ${user.email} searching:`, {
      q_organization_name,
      q_keywords,
      organization_locations,
      organization_num_employees_ranges,
      page,
      per_page,
    });

    // Build the search query (with fallbacks for 0-result retries)
    const { query, location, fallbackQueries } = buildSearchQuery({
      q_organization_name,
      q_keywords,
      organization_locations,
    });
    console.log(`[COMPANY SEARCH] Query: "${query}", location: "${location || 'none'}", fallbacks: ${fallbackQueries.length}`);

    // Check cache (skip if append_mode to allow loading more pages independently)
    const cacheKey = `csearch:${query}:${location || ""}:${page}:${per_page}`;
    const cached = !append_mode ? await getCachedResults(cacheKey) : null;
    if (cached) {
      // Still cross-reference CRM even on cache hits for fresh contact data
      let cachedCrmContacts: Record<string, CrmContact[]> = {};
      try {
        const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
        const cachedSlice = cached.slice(0, per_page);
        const { contactsByCompany, companyEnrich } = await crossReferenceCRM(
          supabaseAdmin,
          user.id,
          cachedSlice.map(c => c.name),
          cachedSlice.map(c => c.website_url)
        );
        cachedCrmContacts = contactsByCompany;
        // Merge CRM enrichment into cached results
        for (const company of cachedSlice) {
          const ce = companyEnrich[company.name];
          if (!ce) continue;
          if (!company.estimated_num_employees && ce.employees) {
            const emp = parseInt(ce.employees.replace(/[^0-9]/g, ""), 10);
            if (!isNaN(emp) && emp > 0) company.estimated_num_employees = emp;
          }
          if (!company.annual_revenue_printed && ce.revenue) company.annual_revenue_printed = ce.revenue;
          if (!company.industry && ce.industry) company.industry = toTitleCase(ce.industry);
        }
      } catch {}

      return c.json({
        success: true,
        organizations: cached.slice(0, per_page),
        crm_contacts: cachedCrmContacts,
        pagination: {
          page,
          per_page,
          total_entries: cached.length,
          total_pages: Math.ceil(cached.length / per_page),
        },
        source: "cache",
      });
    }

    // Calculate start offset for pagination
    // Google Maps returns max 20 per page, so we may need multiple API calls
    const MAPS_PAGE_SIZE = 20;
    const effectivePerPage = Math.min(per_page, 60); // Cap at 60 per request to keep response times reasonable
    const pagesNeeded = Math.ceil(effectivePerPage / MAPS_PAGE_SIZE);
    const baseStart = (page - 1) * effectivePerPage;

    // ── Strategy: Google Maps + Knowledge Graph in parallel, then Google Search fallback ──
    // Running KG alongside Maps means name-only searches (e.g. "First Service Residential")
    // always get a result even when Maps returns 0 (no local storefront).
    let allCompanies: CompanyResult[] = [];
    let kgCompanies: CompanyResult[] = [];
    let totalEstimate = 0;

    // Only run KG lookup on first page and when searching by company name
    const runKgLookup = page === 1 && !!q_organization_name;

    const [mapsOutcome, kgOutcome] = await Promise.allSettled([
      // ── Maps fetch (single or multi-page) ──
      (async () => {
        if (pagesNeeded > 1) {
          const mapsFetches = Array.from({ length: pagesNeeded }, (_, p) => {
            const start = baseStart + p * MAPS_PAGE_SIZE;
            return serpGoogleMaps(query, location, start).catch(err => {
              console.error(`[COMPANY SEARCH] Maps page ${p} failed:`, err.message);
              return { results: [] as any[], total: 0 };
            });
          });
          const mapsResults = await Promise.all(mapsFetches);
          const companies: CompanyResult[] = [];
          let total = 0;
          for (let p = 0; p < mapsResults.length; p++) {
            const mr = mapsResults[p];
            const startOffset = baseStart + p * MAPS_PAGE_SIZE;
            const parsed = mr.results.map((r: any, i: number) =>
              parseGoogleMapsResult(r, i + startOffset)
            ).filter(c => c.name && isPlausibleBusinessName(c.name));
            companies.push(...parsed);
            if (p === 0) total = mr.total || parsed.length;
          }
          return { companies, total };
        } else {
          const mapsResult = await serpGoogleMaps(query, location, baseStart);
          const parsed = mapsResult.results.map((r: any, i: number) =>
            parseGoogleMapsResult(r, i + baseStart)
          ).filter(c => c.name && isPlausibleBusinessName(c.name));
          let total = mapsResult.total || parsed.length;
          if (parsed.length < MAPS_PAGE_SIZE) total = Math.min(total, baseStart + parsed.length);
          return { companies: parsed, total };
        }
      })(),
      // ── Knowledge Graph lookup (parallel, name searches only) ──
      runKgLookup
        ? knowledgeGraphLookup(q_organization_name!, location)
        : Promise.resolve([] as CompanyResult[]),
    ]);

    if (mapsOutcome.status === "fulfilled") {
      allCompanies = mapsOutcome.value.companies;
      totalEstimate = mapsOutcome.value.total;
    } else {
      console.error("[COMPANY SEARCH] Google Maps search failed:", (mapsOutcome as any).reason?.message);
    }

    if (kgOutcome.status === "fulfilled") {
      kgCompanies = kgOutcome.value;
    } else {
      console.error("[COMPANY SEARCH] KG lookup failed:", (kgOutcome as any).reason?.message);
    }

    // Merge KG results: prepend any KG company not already in Maps results
    if (kgCompanies.length > 0) {
      const mapsNames = new Set(allCompanies.map(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)));
      for (const kgc of kgCompanies) {
        const kgNorm = kgc.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
        // If maps already has this company by name, enrich it instead of prepending
        const existing = allCompanies.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) === kgNorm);
        if (existing) {
          if (!existing.website_url && kgc.website_url) existing.website_url = kgc.website_url;
          if (!existing.short_description && kgc.short_description) existing.short_description = kgc.short_description;
          if (!existing.industry && kgc.industry) existing.industry = kgc.industry;
        } else if (!mapsNames.has(kgNorm)) {
          // Prepend so the exact-name match appears first
          allCompanies.unshift(kgc);
          mapsNames.add(kgNorm);
          totalEstimate = Math.max(totalEstimate, allCompanies.length);
        }
      }
    }

    // ── Fallback retries: if primary query returned 0, try broader queries ──
    if (allCompanies.length === 0 && fallbackQueries.length > 0 && page === 1) {
      for (const fbQuery of fallbackQueries) {
        console.log(`[COMPANY SEARCH] Primary returned 0 — retrying with fallback query: "${fbQuery}"`);
        try {
          const fbResult = await serpGoogleMaps(fbQuery, location, 0);
          const fbParsed = fbResult.results.map((r: any, i: number) =>
            parseGoogleMapsResult(r, i)
          ).filter(c => c.name && isPlausibleBusinessName(c.name));
          allCompanies.push(...fbParsed);
          totalEstimate = fbResult.total || fbParsed.length;
          console.log(`[COMPANY SEARCH] Fallback "${fbQuery}" returned ${fbParsed.length} results`);
          if (allCompanies.length > 0) break; // Found results, stop trying fallbacks
        } catch (fbErr: any) {
          console.error(`[COMPANY SEARCH] Fallback query "${fbQuery}" failed:`, fbErr.message);
        }
      }
    }

    // If Maps returned very few results, try Google Search as supplement
    if (allCompanies.length < 5) {
      // Try the most relevant query: for "Asset Living" + "property management", 
      // search Google for local results with the company name
      const googleQuery = q_organization_name 
        ? `${q_organization_name} ${q_keywords || ''} ${location || ''}`.trim()
        : `${query} companies`;
      console.log(`[COMPANY SEARCH] Maps returned ${allCompanies.length}, trying Google Search fallback: "${googleQuery}"...`);
      try {
        const googleResults = await serpGoogleSearch(
          googleQuery,
          location,
          20
        );
        const seenNames = new Set(allCompanies.map((c) => c.name.toLowerCase()));
        for (let i = 0; i < googleResults.length; i++) {
          const r = googleResults[i];
          const name = cleanCompanyName((r.title || r.name || "").trim());
          if (!name || !isPlausibleBusinessName(name) || seenNames.has(name.toLowerCase())) continue;
          seenNames.add(name.toLowerCase());
          allCompanies.push({
            id: r.place_id || `gs-${Date.now()}-${i}`,
            name,
            website_url: r.links?.website || r.website || "",
            linkedin_url: "",
            industry: toTitleCase(r.type || ""),
            estimated_num_employees: 0,
            annual_revenue_printed: "",
            city: r.address_info?.city || "",
            state: r.address_info?.state || "",
            country: r.address_info?.country || "United States",
            short_description: r.snippet || r.description || "",
            founded_year: 0,
            phone: r.phone || "",
            logo_url: "", // Never use SerpAPI thumbnails — they're listing photos, not company logos
            rating: r.rating || 0,
            reviews_count: r.reviews || 0,
            address: r.address || "",
          });
        }
        if (!totalEstimate) totalEstimate = allCompanies.length;
      } catch (googleErr: any) {
        console.error("[COMPANY SEARCH] Google fallback error:", googleErr.message);
      }
    }

    // ── Last resort: Google organic search to find company locations/properties ──
    // For searches like "Asset Living Denver" where the company manages properties 
    // under different names, organic results can surface the properties page
    if (allCompanies.length === 0 && q_organization_name && page === 1) {
      console.log(`[COMPANY SEARCH] Still 0 results — trying organic search for "${q_organization_name}" locations...`);
      const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
      if (SERPAPI_KEY) {
        try {
          const locPart = location ? ` ${location}` : "";
          const keyPart = q_keywords ? ` ${q_keywords}` : "";
          const orgQuery = `"${q_organization_name}"${keyPart}${locPart} locations properties offices`;
          const orgParams = new URLSearchParams({
            engine: "google",
            q: orgQuery,
            api_key: SERPAPI_KEY,
            num: "20",
          });
          if (location) orgParams.set("location", location);
          
          const orgRes = await fetch(`https://serpapi.com/search?${orgParams}`, {
            signal: AbortSignal.timeout(10000),
          });
          
          if (orgRes.ok) {
            const orgData = await orgRes.json();
            
            // Check for local_results first (Google sometimes shows a map pack in organic)
            const localResults = orgData.local_results || [];
            const seenNames = new Set(allCompanies.map((c) => c.name.toLowerCase()));
            for (let i = 0; i < localResults.length; i++) {
              const r = localResults[i];
              const name = cleanCompanyName((r.title || r.name || "").trim());
              if (!name || !isPlausibleBusinessName(name) || seenNames.has(name.toLowerCase())) continue;
              seenNames.add(name.toLowerCase());
              allCompanies.push({
                id: r.place_id || `org-local-${Date.now()}-${i}`,
                name,
                website_url: r.links?.website || r.website || "",
                linkedin_url: "",
                industry: toTitleCase(r.type || q_keywords || ""),
                estimated_num_employees: 0,
                annual_revenue_printed: "",
                city: r.address_info?.city || "",
                state: r.address_info?.state || "",
                country: r.address_info?.country || "United States",
                short_description: r.snippet || r.description || "",
                founded_year: 0,
                phone: r.phone || "",
                logo_url: "", // Never use SerpAPI thumbnails — they're listing photos, not company logos
                rating: r.rating || 0,
                reviews_count: r.reviews || 0,
                address: r.address || "",
              });
            }
            
            // NOTE: We intentionally do NOT parse organic_results here.
            // Google page titles (e.g. "Asset Living Acquires Denver-Based Echelon Property")
            // are headlines/descriptions, NOT business names. Only local_results have real names.
            
            totalEstimate = allCompanies.length;
            console.log(`[COMPANY SEARCH] Organic fallback found ${allCompanies.length} results`);
          }
        } catch (orgErr: any) {
          console.error("[COMPANY SEARCH] Organic fallback error:", orgErr.message);
        }
      }
    }

    // ── Lightweight quick-scrape: only top 3 companies, 3s timeout ──
    // Full enrichment happens in /enrich-batch after results are shown
    const enrichTargets = allCompanies
      .filter((c) => c.website_url && !c.short_description)
      .slice(0, 3);

    if (enrichTargets.length > 0) {
      console.log(`[COMPANY SEARCH] Quick-enriching ${enrichTargets.length} companies (lightweight)...`);
      const enrichResults = await Promise.allSettled(
        enrichTargets.map((c) => quickScrapeCompanyInfo(c.website_url))
      );

      for (let i = 0; i < enrichTargets.length; i++) {
        const result = enrichResults[i];
        if (result.status !== "fulfilled") continue;
        const enriched = result.value;
        const company = enrichTargets[i];

        if (enriched.description && !company.short_description) {
          company.short_description = enriched.description;
        }
        if (enriched.linkedin_url && !company.linkedin_url) {
          company.linkedin_url = enriched.linkedin_url;
        }
        if (enriched.employee_hint) {
          const num = parseInt(enriched.employee_hint, 10);
          if (!isNaN(num) && num > 0 && !company.estimated_num_employees) {
            company.estimated_num_employees = num;
          }
        }
        if (enriched.revenue_hint) {
          company.annual_revenue_printed = enriched.revenue_hint;
        }
        if (enriched.founded_hint) {
          const yr = parseInt(enriched.founded_hint, 10);
          if (!isNaN(yr) && yr > 1800 && yr <= new Date().getFullYear() && !company.founded_year) {
            company.founded_year = yr;
          }
        }
      }
    }

    // NOTE: LinkedIn batch enrichment + deep enrichment are handled by /enrich-batch
    // which the frontend triggers automatically after showing initial results.
    // This keeps the search response fast (~3-8s instead of 30-60s).

    // ── Post-filter by employee range if specified ──
    let filtered = allCompanies;
    if (organization_num_employees_ranges?.length && allCompanies.some((c) => c.estimated_num_employees > 0)) {
      const ranges = organization_num_employees_ranges.map((r: string) => {
        const [min, max] = r.split(",").map(Number);
        return { min: min || 0, max: max || Infinity };
      });
      filtered = allCompanies.filter((c) => {
        if (!c.estimated_num_employees) return true; // Keep unknowns
        return ranges.some(
          (r) =>
            c.estimated_num_employees >= r.min &&
            c.estimated_num_employees <= r.max
        );
      });
    }

    // De-duplicate by name
    const seen = new Set<string>();
    const deduped = filtered.filter((c) => {
      const key = c.name.toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Cache the results
    if (deduped.length > 0) {
      await setCachedResults(cacheKey, deduped);
      
      // Store discovered companies in pool intelligence for cross-user benefit
      // This allows any user who searches the same company later to instantly benefit
      // from this initial discovery without re-querying SerpAPI
      console.log(`[COMPANY SEARCH] Storing ${deduped.length} companies in pool intelligence...`);
      const poolStoragePromises = deduped.map(async (company) => {
        try {
          // Build basic enrichment data from search results
          const basicEnrichData: any = {};
          if (company.estimated_num_employees) basicEnrichData.employees = company.estimated_num_employees;
          if (company.annual_revenue_printed) basicEnrichData.revenue = company.annual_revenue_printed;
          if (company.industry) basicEnrichData.industry = company.industry;
          if (company.founded_year) basicEnrichData.founded_year = company.founded_year;
          if (company.website_url) basicEnrichData.website = company.website_url;
          if (company.linkedin_url) basicEnrichData.linkedin = company.linkedin_url;
          if (company.phone) basicEnrichData.phone = company.phone;
          if (company.short_description) basicEnrichData.description = company.short_description;
          if (company.address) basicEnrichData.address = company.address;
          if (company.rating) basicEnrichData.rating = company.rating;
          if (company.reviews_count) basicEnrichData.reviews_count = company.reviews_count;
          // NOTE: Do NOT store brand_logo_url in pool intelligence — pool is keyed by company name+location,
          // so logos can cross-contaminate between different companies with similar names.
          // Logos are resolved separately via the domain-keyed brandfetch:v3: KV cache.
          
          // Only store if we have meaningful data
          if (Object.keys(basicEnrichData).length >= 3) {
            await poolStoreCompanyEnrich(company.name, location || "", basicEnrichData);
          }
        } catch (err) {
          // Ignore individual storage failures
        }
      });
      
      // Fire and forget — don't block response
      Promise.all(poolStoragePromises).catch(() => {});
    }

    const paginatedResults = deduped.slice(0, effectivePerPage);

    // ── CRM Cross-Reference: find existing contacts for these companies ──
    let crmContacts: Record<string, CrmContact[]> = {};
    let crmEnrich: Record<string, { employees?: string; revenue?: string; industry?: string; website?: string; linkedin?: string }> = {};
    try {
      const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
      const { contactsByCompany, companyEnrich } = await crossReferenceCRM(
        supabaseAdmin,
        user.id,
        paginatedResults.map(c => c.name),
        paginatedResults.map(c => c.website_url)
      );
      crmContacts = contactsByCompany;
      crmEnrich = companyEnrich;

      // Merge CRM enrichment data into company results (lowest priority — only fill gaps)
      for (const company of paginatedResults) {
        const ce = crmEnrich[company.name];
        if (!ce) continue;
        if (!company.estimated_num_employees && ce.employees) {
          const emp = parseInt(ce.employees.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(emp) && emp > 0) company.estimated_num_employees = emp;
        }
        if (!company.annual_revenue_printed && ce.revenue) {
          company.annual_revenue_printed = ce.revenue;
        }
        if (!company.industry && ce.industry) {
          company.industry = toTitleCase(ce.industry);
        }
        if (!company.linkedin_url && ce.linkedin) {
          company.linkedin_url = ce.linkedin;
        }
      }
    } catch (crmErr: any) {
      console.error("[COMPANY SEARCH] CRM cross-reference error (non-fatal):", crmErr.message);
    }

    // ── Inline Brand Logo Enrichment (KV cache → SerpAPI → Favicon fallback) ──
    // Attach brand_logo_url to each company so the frontend doesn't need a separate API call
    try {
      const domainMap: Record<string, string[]> = {}; // domain → [company ids]
      const domainNameMap: Record<string, string> = {}; // domain → company name (for SerpAPI)
      for (const co of paginatedResults) {
        const d = normalizeDomain(co.website_url || "");
        if (!d) continue;
        // Skip social/directory domains — never waste Brandfetch credits on these
        if (SOCIAL_BRAND_DOMAINS.has(rootDomain(d))) {
          console.log(`[COMPANY SEARCH] Skipping brand enrichment for social domain: ${d} (company: ${co.name})`);
          continue;
        }
        if (!domainMap[d]) domainMap[d] = [];
        domainMap[d].push(co.id);
        if (!domainNameMap[d] && co.name) domainNameMap[d] = co.name;
      }
      const domains = Object.keys(domainMap);
      if (domains.length > 0) {
        const kvKeys = domains.map(d => BRAND_KV_PREFIX + d);
        const cached = await kv.mget(kvKeys);
        const brandLogos: Record<string, string> = {};
        const uncachedDomains: string[] = [];
        for (let i = 0; i < domains.length; i++) {
          const raw = cached[i];
          if (raw) {
            const record = typeof raw === "string" ? JSON.parse(raw) : raw;
            const age = Date.now() - (record.fetched_at || 0);
            if (age < BRAND_CACHE_TTL_MS) {
              // If cached result has a valid logo, use it
              if (record.logo_url) {
                brandLogos[domains[i]] = record.logo_url;
              }
              // If cached "not_found" / mismatch rejection — don't re-fetch, skip this domain
              continue;
            }
          }
          uncachedDomains.push(domains[i]);
        }
        // For uncached: fetch Brandfetch logos SYNCHRONOUSLY (parallel with timeout) so first search gets real logos
        if (uncachedDomains.length > 0) {
          console.log(`[COMPANY SEARCH] Synchronous brand enrichment for ${uncachedDomains.length} uncached domains`);
          const BRAND_GROUP_TIMEOUT = 12000; // 12s group timeout — includes SerpAPI logo search as Tier 2
          try {
            const enrichPromises = uncachedDomains.map(async (d) => {
              try {
                const result = await enrichBrand(d, false, domainNameMap[d]);
                return { domain: d, result };
              } catch {
                return { domain: d, result: null };
              }
            });
            const raceResult = await Promise.race([
              Promise.allSettled(enrichPromises),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), BRAND_GROUP_TIMEOUT)),
            ]);
            if (raceResult && Array.isArray(raceResult)) {
              for (const settled of raceResult) {
                if (settled.status === "fulfilled" && settled.value.result?.logo_url) {
                  brandLogos[settled.value.domain] = settled.value.result.logo_url;
                }
              }
            }
          } catch (enrichErr: any) {
            console.warn(`[COMPANY SEARCH] Parallel brand enrichment error: ${enrichErr?.message}`);
          }
          // For any domains STILL without a logo after enrichment, leave empty —
          // frontend will show initials placeholder. No more blurry favicon injection.
        }
        // Attach brand_logo_url + brand_logo_source + brand_logo_quality to each company result
        // Read source & quality from the authoritative KV BrandRecord (not URL pattern matching)
        for (const co of paginatedResults) {
          const d = normalizeDomain(co.website_url || "");
          if (d && brandLogos[d]) {
            (co as any).brand_logo_url = brandLogos[d];
          }
          // Read source + quality from the KV BrandRecord (authoritative)
          if (d) {
            try {
              const kvKey = BRAND_KV_PREFIX + d;
              const raw = await kv.get(kvKey);
              if (raw) {
                const rec: BrandRecord = typeof raw === "string" ? JSON.parse(raw) : raw;
                if (rec.source) (co as any).brand_logo_source = rec.source;
                if (rec.logo_quality) (co as any).brand_logo_quality = rec.logo_quality;
              }
            } catch {}
          }
          // Fallback source detection if KV read failed
          if (d && brandLogos[d] && !(co as any).brand_logo_source) {
            const logoUrl = brandLogos[d];
            (co as any).brand_logo_source = logoUrl.includes('google.com/s2/favicons') ? 'favicon'
              : logoUrl.includes('icons.duckduckgo.com') ? 'favicon'
              : logoUrl.includes('logo.clearbit.com') ? 'clearbit'
              : 'brandfetch';
          }
        }
        console.log(`[COMPANY SEARCH] Brand logos: ${Object.keys(brandLogos).length} attached (${uncachedDomains.length} freshly enriched via Brandfetch)`);
      }
    } catch (brandErr: any) {
      console.error("[COMPANY SEARCH] Inline brand enrichment error (non-fatal):", brandErr?.message);
    }

    console.log(
      `[COMPANY SEARCH] Returning ${paginatedResults.length} companies (${deduped.length} total, page ${page})`
    );

    return c.json({
      success: true,
      organizations: paginatedResults,
      crm_contacts: crmContacts,
      pagination: {
        page,
        per_page: effectivePerPage,
        total_entries: Math.max(totalEstimate, deduped.length),
        total_pages: Math.max(1, Math.ceil(Math.max(totalEstimate, deduped.length) / effectivePerPage)),
      },
      source: "serpapi",
    });
  } catch (error: any) {
    console.error("[COMPANY SEARCH] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /search-by-building — Search for company by building/location name ──
// Finds the operating company, owner, or property management company behind a building or location
// Example: "Diplomat Residences" → finds developer, management company, owners
app.post("/search-by-building", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { building_name, location } = await c.req.json();

    if (!building_name || !building_name.trim()) {
      return c.json({ error: "building_name is required" }, 400);
    }

    console.log(`[BUILDING SEARCH] Searching for company behind: "${building_name}" in ${location || "any location"}`);

    const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
    if (!SERPAPI_KEY) {
      return c.json({ error: "SERPAPI_API_KEY not configured" }, 500);
    }

    // Strategy: Run multiple searches in parallel to find property owners, developers, managers
    const locationSuffix = location ? ` ${location}` : "";
    
    const searches = [
      // Search 1: Building owner/developer
      `"${building_name}"${locationSuffix} owner developer company`,
      // Search 2: Property management
      `"${building_name}"${locationSuffix} property management company`,
      // Search 3: General company info
      `"${building_name}"${locationSuffix} building company contact`,
    ];

    const searchResults = await Promise.allSettled(
      searches.map(async (query) => {
        const params = new URLSearchParams({
          engine: "google",
          q: query,
          api_key: SERPAPI_KEY,
          num: "10",
        });
        
        const res = await fetch(`https://serpapi.com/search?${params}`, {
          signal: AbortSignal.timeout(10000),
        });
        
        if (!res.ok) return null;
        return res.json();
      })
    );

    // Extract company information from search results
    const companies: Array<{
      name: string;
      role: string;
      website?: string;
      description?: string;
      address?: string;
      phone?: string;
      source: string;
    }> = [];

    const seenCompanies = new Set<string>();

    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      if (result.status !== "fulfilled" || !result.value) continue;

      const data = result.value;
      const searchType = i === 0 ? "owner/developer" : i === 1 ? "management" : "general";

      // Check knowledge graph first
      const kg = data.knowledge_graph;
      if (kg?.title) {
        const companyName = kg.title.trim();
        const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
        
        if (!seenCompanies.has(normalized) && isPlausibleBusinessName(companyName)) {
          seenCompanies.add(normalized);
          
          const rawWebsite = (kg.website || kg.official_website || "") as string;
          const website = rawWebsite.startsWith("http") ? rawWebsite : rawWebsite ? `https://${rawWebsite}` : "";
          
          companies.push({
            name: companyName,
            role: searchType,
            website,
            description: (kg.description || kg.type || "") as string,
            address: (kg.headquarters || kg.address || "") as string,
            phone: (kg.customer_service || kg.phone || "") as string,
            source: "knowledge_graph",
          });
        }
      }

      // Check organic results for company mentions
      const organicResults = data.organic_results || [];
      if (Array.isArray(organicResults)) {
        for (const org of organicResults.slice(0, 5)) {
        const title = org.title || "";
        const snippet = org.snippet || "";
        const link = org.link || "";

        // Extract company name from title/snippet
        // Common patterns: "ABC Company - Property Management", "Owned by XYZ Corp"
        const ownerMatch = snippet.match(/(?:owned|developed|managed)\s+by\s+([A-Z][A-Za-z\s&]+(?:Inc|LLC|Corp|Company|Group|Partners|Realty|Properties|Management)?)/i);
        const titleMatch = title.match(/^([A-Z][A-Za-z\s&]+(?:Inc|LLC|Corp|Company|Group|Partners|Realty|Properties|Management)?)\s*[-–|]/);
        
        const companyName = (ownerMatch?.[1] || titleMatch?.[1] || "").trim();
        
        if (companyName && companyName.length > 2) {
          const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
          
          if (!seenCompanies.has(normalized) && isPlausibleBusinessName(companyName)) {
            seenCompanies.add(normalized);
            
            // Extract domain from link
            const domain = link.match(/https?:\/\/([^\/]+)/)?.[1] || "";
            const website = domain && !domain.includes("google.com") && !domain.includes("wikipedia") ? `https://${domain}` : "";
            
            companies.push({
              name: companyName,
              role: searchType,
              website,
              description: snippet.slice(0, 200),
              source: "organic_search",
            });
          }
        }
        }
      }

      // Check local results (property management companies often show up here)
      const localResults = data.local_results || [];
      if (Array.isArray(localResults)) {
        for (const local of localResults.slice(0, 3)) {
          const companyName = (local.title || "").trim();
          const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
          
          if (!seenCompanies.has(normalized) && isPlausibleBusinessName(companyName)) {
            seenCompanies.add(normalized);
            
            companies.push({
              name: companyName,
              role: searchType,
              website: local.link || "",
              address: local.address || "",
              phone: local.phone || "",
              description: local.snippet || local.type || "",
              source: "local_result",
            });
          }
        }
      }
    }

    console.log(`[BUILDING SEARCH] Found ${companies.length} companies for "${building_name}"`);

    // Enrich top companies with deep data
    const enrichedCompanies = await Promise.allSettled(
      companies.slice(0, 5).map(async (comp) => {
        const domain = comp.website ? comp.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() : "";
        
        const enrichment = await deepEnrichCompany(comp.name, location, domain);
        
        return {
          ...comp,
          ...enrichment,
          building_name,
          building_location: location,
        };
      })
    );

    const finalCompanies = enrichedCompanies
      .filter(r => r.status === "fulfilled")
      .map(r => (r as any).value);

    return c.json({
      success: true,
      building_name,
      location: location || null,
      companies: finalCompanies,
      total_found: companies.length,
    });

  } catch (error: any) {
    console.error("[BUILDING SEARCH] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /enrich — Enrich a single company with website scraping ──
app.post("/enrich", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { website } = await c.req.json();

    if (!website) {
      return c.json({ error: "No website provided" }, 400);
    }

    console.log(`[COMPANY SEARCH] Enriching company website: ${website}`);
    const info = await quickScrapeCompanyInfo(website);

    return c.json({
      success: true,
      ...info,
    });
  } catch (error: any) {
    console.error("[COMPANY SEARCH] Enrich error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /enrich-deep — Deep enrichment via Google Knowledge Graph + search ──
app.post("/enrich-deep", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { company_name, location, company_id, domain } = await c.req.json();

    if (!company_name) {
      return c.json({ error: "No company_name provided" }, 400);
    }

    // Check pool intelligence first (24h shared cache), then short-lived user cache
    const poolData = await poolLookupCompanyEnrich(company_name, location || "");
    if (poolData) {
      console.log(`[COMPANY SEARCH] Pool intelligence hit for "${company_name}"`);
      // Strip brand_logo_url from pool data — pool is keyed by name+location and may contain
      // cross-contaminated logos from different companies with similar names.
      // Logos should only come from the domain-keyed brandfetch:v3: KV cache.
      const { brand_logo_url: _stripLogo, ...safePoolData } = poolData;
      return c.json({ success: true, ...safePoolData, source: "pool" });
    }

    const cacheKey = `cenrich:${company_name.toLowerCase().trim()}:${(location || "").toLowerCase().trim()}`;
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL * 1000) {
          console.log(`[COMPANY SEARCH] Deep enrich cache hit: ${company_name}`);
          return c.json({ success: true, ...parsed.data, source: "cache" });
        }
      }
    } catch {
      // Cache miss
    }

    console.log(`[COMPANY SEARCH] Deep enriching: "${company_name}" (${location || "no location"}, domain: ${domain || "none"})`);
    const data = await deepEnrichCompany(company_name, location, domain);

    // Store in both short-lived cache AND long-lived pool intelligence
    try {
      await kv.set(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
    if (data && Object.keys(data).length > 0) {
      await poolStoreCompanyEnrich(company_name, location || "", data);
    }

    return c.json({
      success: true,
      ...data,
      source: "serpapi",
    });
  } catch (error: any) {
    console.error("[COMPANY SEARCH] Deep enrich error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /enrich-batch — Batch deep enrichment for multiple companies ──
// Runs deepEnrichCompany in parallel for all companies missing data
app.post("/enrich-batch", async (c) => {
  try {
    await getAuthenticatedUser(c);
    const { companies } = await c.req.json() as {
      companies: { id: string; name: string; location?: string; domain?: string; estimated_num_employees?: number; annual_revenue_printed?: string }[];
    };

    if (!companies?.length) {
      return c.json({ error: "companies array is required" }, 400);
    }

    // Cap at 10 companies per batch to stay within CPU budget
    const cappedCompanies = companies.slice(0, 10);

    // Only enrich companies that actually need it (missing employees OR revenue)
    const targets = cappedCompanies.filter(
      (co) => !co.estimated_num_employees || !co.annual_revenue_printed
    );

    console.log(`[ENRICH BATCH] Enriching ${targets.length}/${cappedCompanies.length} companies that need data (capped from ${companies.length})`);

    if (targets.length === 0) {
      return c.json({ results: {}, enriched_count: 0 });
    }

    // Check pool intelligence first (24h), then short-lived cache, then API
    const results: Record<string, any> = {};
    const needsApi: typeof targets = [];
    let poolHits = 0;
    let cacheHits = 0;

    for (const company of targets) {
      // 1. Pool intelligence (24h shared across all users)
      const poolData = await poolLookupCompanyEnrich(company.name, company.location || "");
      if (poolData) {
        // Strip brand_logo_url from pool data — pool is name-keyed, logos may be cross-contaminated
        const { brand_logo_url: _stripLogo, ...safePoolData } = poolData;
        results[company.id] = safePoolData;
        poolHits++;
        continue;
      }
      // 2. Short-lived user cache (1h)
      const cacheKey = `cenrich:${company.name.toLowerCase().trim()}:${(company.location || "").toLowerCase().trim()}`;
      try {
        const cached = await kv.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL * 1000) {
            results[company.id] = parsed.data;
            cacheHits++;
            continue;
          }
        }
      } catch {}
      needsApi.push(company);
    }

    console.log(`[ENRICH BATCH] ${poolHits} pool hits, ${cacheHits} cache hits, ${needsApi.length} need API calls`);

    // Reset Hunter rate-limit flag at start of each batch request
    _hunterRateLimited = false;

    // Global deadline — return partial results before edge function timeout (reduced to 30s to stay within CPU budget)
    const DEADLINE_MS = 30_000;
    const batchStart = Date.now();
    let timedOut = false;

    // Process API calls in batches of 3 to stay within CPU budget
    for (let i = 0; i < needsApi.length; i += 3) {
      // Check deadline before starting a new batch
      if (Date.now() - batchStart > DEADLINE_MS) {
        console.warn(`[ENRICH BATCH] Hit ${DEADLINE_MS}ms deadline after ${i} companies — returning partial results`);
        timedOut = true;
        break;
      }

      const batch = needsApi.slice(i, i + 3);
      // Per-company timeout to prevent a single slow company from blocking the batch
      const COMPANY_TIMEOUT = 10_000;
      const batchResults = await Promise.allSettled(
        batch.map(async (company) => {
          const data = await Promise.race([
            deepEnrichCompany(company.name, company.location, company.domain),
            new Promise<{}>((resolve) => setTimeout(() => {
              console.warn(`[ENRICH BATCH] Timeout enriching "${company.name}" — skipping`);
              resolve({});
            }, COMPANY_TIMEOUT)),
          ]);
          // Cache in both short-lived cache + pool intelligence
          const cacheKey = `cenrich:${company.name.toLowerCase().trim()}:${(company.location || "").toLowerCase().trim()}`;
          try {
            await kv.set(cacheKey, JSON.stringify({ ts: Date.now(), data }));
          } catch {}
          if (data && Object.keys(data).length > 0) {
            await poolStoreCompanyEnrich(company.name, company.location || "", data);
          }
          return { id: company.id, data };
        })
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled" && r.value.data && Object.keys(r.value.data).length > 0) {
          results[r.value.id] = r.value.data;
        }
      }

      // Small delay between batches to be nice to SerpAPI
      if (i + 5 < needsApi.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Inject brand logos from KV cache into enrichment results (so frontend gets them for free)
    try {
      const enrichDomains: { id: string; domain: string }[] = [];
      for (const company of companies) {
        const d = normalizeDomain(company.domain || "");
        if (d && results[company.id] && !SOCIAL_BRAND_DOMAINS.has(rootDomain(d))) enrichDomains.push({ id: company.id, domain: d });
      }
      if (enrichDomains.length > 0) {
        const bkvKeys = enrichDomains.map(e => BRAND_KV_PREFIX + e.domain);
        const brandCached = await kv.mget(bkvKeys);
        for (let i = 0; i < enrichDomains.length; i++) {
          const raw = brandCached[i];
          if (raw) {
            const rec = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (rec.logo_url && results[enrichDomains[i].id]) {
              results[enrichDomains[i].id].brand_logo_url = rec.logo_url;
            }
          }
        }
      }
    } catch {}

    const enrichedCount = Object.keys(results).length;
    console.log(`[ENRICH BATCH] Complete: enriched ${enrichedCount}/${targets.length} companies${timedOut ? ' (partial — deadline reached)' : ''}`);

    return c.json({ 
      results, 
      enriched_count: enrichedCount, 
      total_requested: targets.length, 
      pool_hits: poolHits,
      cache_hits: cacheHits,
      api_calls: needsApi.length - (needsApi.length - (enrichedCount - poolHits - cacheHits)),
      partial: timedOut || undefined 
    });
  } catch (error: any) {
    console.error("[ENRICH BATCH] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Find Decision Makers — SerpAPI Google Search for LinkedIn profiles
// Searches: site:linkedin.com/in "{company}" + title keywords
// ══════════════════════════════════════════════════════════════════════════

interface PersonResult {
  id: string;
  name: string;
  title: string;
  linkedin_url: string;
  snippet: string;
  company_match: string;
  location?: string; // Parsed from LinkedIn snippet (e.g. "Denver, Colorado")
  phone?: string; // Company line fallback for phone-first local-business outreach
}

function normalizePhone(raw?: string): string {
  const value = (raw || "").trim();
  if (!value) return "";
  return value.replace(/\D/g, "").length >= 7 ? value : "";
}

function attachCompanyPhone<T extends PersonResult>(people: T[], phone?: string): T[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return people;
  return people.map(person => person.phone ? person : { ...person, phone: normalized });
}

/** Extract location from a LinkedIn Google snippet — they typically contain "City, State" or "City, State Area" */
function parseLocationFromSnippet(snippet: string, title?: string): string {
  if (!snippet && !title) return "";
  const text = `${snippet} ${title || ""}`;

  // Pattern: "Greater X Area" or "X Metropolitan Area"
  const greaterMatch = text.match(/(?:Greater\s+)([A-Z][a-zA-Z\s]+?)\s+(?:Metropolitan\s+)?Area/);
  if (greaterMatch) return greaterMatch[1].trim();

  // Pattern: "Location: City, State" (sometimes in LinkedIn snippets)
  const locationLabel = text.match(/Location:\s*([A-Z][a-zA-Z\s]+?,\s*[A-Z][a-zA-Z\s]+)/);
  if (locationLabel) return locationLabel[1].trim();

  // Pattern: "City, State" at start of snippet (common LinkedIn format)
  const startMatch = snippet.match(/^([A-Z][a-zA-Z\s]+?,\s*[A-Z][a-zA-Z\s]+?)(?:\s+Area)?\s*[·\-–—|]/);
  if (startMatch) return startMatch[1].trim().replace(/\s+Area$/, "");

  // Pattern: "· City, State ·" or "· City, State Area ·" anywhere in snippet
  const midMatch = text.match(/[·\-–—|]\s*([A-Z][a-zA-Z\s]+?,\s*[A-Z][a-zA-Z]+?)(?:\s+Area)?\s*[·\-–—|]/);
  if (midMatch) return midMatch[1].trim();

  // Pattern: ending with "City, State" or "City, State Area"
  const endMatch = text.match(/[·\-–—|]\s*([A-Z][a-zA-Z\s]+?,\s*[A-Z][a-zA-Z]+?)(?:\s+Area)?\.?\s*$/);
  if (endMatch) return endMatch[1].trim();

  // Fallback: any "City, State Area" pattern
  const genericMatch = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+Area\b/);
  if (genericMatch) return genericMatch[1].trim();

  return "";
}

/** Check if a parsed location matches the target search location (state-level matching) */
function isLocationInArea(personLocation: string, searchLocation: string): boolean {
  if (!personLocation || !searchLocation) return false;
  const pLoc = personLocation.toLowerCase().replace(/\s+area$/, "").trim();
  const sLoc = searchLocation.toLowerCase().trim();
  if (pLoc.includes(sLoc) || sLoc.includes(pLoc)) return true;
  const pParts = pLoc.split(",").map(s => s.trim());
  const sParts = sLoc.split(",").map(s => s.trim());
  const pState = pParts.length > 1 ? pParts[pParts.length - 1] : pParts[0];
  const sState = sParts.length > 1 ? sParts[sParts.length - 1] : sParts[0];
  if (pState && sState && (pState === sState || pState.includes(sState) || sState.includes(pState))) return true;
  const STATE_MAP: Record<string, string> = {
    al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
    co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
    hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
    ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
    ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri",
    mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
    nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
    ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
    sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
    va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
    dc: "district of columbia",
  };
  const expandAbbrev = (s: string) => STATE_MAP[s] || s;
  if (expandAbbrev(pState) === expandAbbrev(sState)) return true;
  for (const [abbr, full] of Object.entries(STATE_MAP)) {
    if ((pLoc.includes(full) && (sLoc.includes(full) || sLoc.includes(abbr))) ||
        (sLoc.includes(full) && pLoc.includes(abbr))) return true;
  }
  return false;
}

/** Returns true if the snippet or raw Google title contains evidence the person works at targetCompany */
function isCurrentEmployer(snippet: string, rawTitle: string, targetCompany: string): boolean {
  const target = targetCompany.toLowerCase().trim();
  const snip = snippet.toLowerCase();
  const rtitle = rawTitle.toLowerCase();

  // Helper: normalize to alphanum+space for fuzzy comparison
  const norm = (s: string) => s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const normTarget = norm(target);
  const normTargetWords = normTarget.split(" ").filter(w => w.length > 3);

  // ── Tier 1 (HIGH CONFIDENCE): explicit "at [company]" pattern ──
  // LinkedIn snippets for current employees always show "Role at Company"
  const atRe = /\bat\s+([\w\s&,'./@!#-]{3,70}?)(?:\s*[·|•\n]|$)/gi;
  let m: RegExpExecArray | null;
  const fullHaystack = `${rtitle} ${snip}`;
  // Reset lastIndex for global regex
  atRe.lastIndex = 0;
  while ((m = atRe.exec(fullHaystack)) !== null) {
    const employer = norm(m[1]);
    if (employer.includes(normTarget) || normTarget.includes(employer)) return true;
    // Fuzzy: all significant words of target appear in the extracted employer
    if (normTargetWords.length > 0 && normTargetWords.every(w => employer.includes(w))) return true;
  }

  // ── Tier 2 (HIGH CONFIDENCE): first bullet segment of snippet ──
  // LinkedIn snippets typically start with "[Role] at [Company] · [Location] · ..."
  // OR "[Company] · [timeframe]" when the person's headline is their company
  const firstSeg = snip.split(/\s*[·•]\s*/)[0]?.trim() || "";
  const normFirst = norm(firstSeg);
  if (normFirst && (normFirst.includes(normTarget) || (normTargetWords.length > 0 && normTargetWords.every(w => normFirst.includes(w))))) return true;

  // ── Tier 3 (MEDIUM CONFIDENCE): Google title contains company name ──
  // Google page titles for LinkedIn profiles include current employer in the title string
  const normRTitle = norm(rtitle);
  if (normRTitle.includes(normTarget)) return true;
  if (normTargetWords.length > 0 && normTargetWords.every(w => normRTitle.includes(w))) return true;

  // ── Tier 4 (FALLBACK for short/simple company names): ──
  // Allow snippet match only when company name is unambiguous (≤2 significant words)
  // This catches cases where the company name appears in context but not with "at" phrasing
  if (normTargetWords.length <= 2 && normTargetWords.length > 0) {
    const normSnip = norm(snip);
    if (normSnip.includes(normTarget)) return true;
  }

  return false;
}

/** Returns true if the title or snippet clearly identifies a DIFFERENT current employer */
function hasClearlyDifferentEmployer(title: string, snippet: string, targetCompany: string): boolean {
  const target = targetCompany.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  // Pattern: "Title at OtherCompany" — extract employer after "at"
  const haystack = `${title} ${snippet}`.toLowerCase();
  const atMatch = haystack.match(/\bat\s+([\w\s&,'.\-]{3,60}?)(?:\s*[·|\n]|$)/);
  if (atMatch) {
    const employer = atMatch[1].replace(/[^a-z0-9\s]/g, "").trim();
    const t6 = target.slice(0, 6);
    const e6 = employer.slice(0, 6);
    if (employer.length > 2 && e6 && t6 && !employer.includes(t6) && !target.includes(e6)) {
      return true;
    }
  }

  // Pattern: the title field IS a company name (contains entity suffixes like LLC, Inc, Academy, Partners…)
  // This happens when Google renders "Barry Turnbull · Turnbull Pickleball Academy & All Sport" and we
  // parsed "Turnbull Pickleball Academy & All Sport" as the "title".
  const companyEntityRe = /\b(LLC|Inc\.?|Corp\.?|Ltd\.?|LLP|LP|PLC|Academy|Partners|Associates|Solutions|Services|Group|Holdings|Ventures|Consulting|Enterprises|Technologies|Industries|Realty|Shutters|Roofing|Plumbing|Electric|Construction|Management|Capital|Financial|Advisors|Agency|Studio|Media)\b/i;
  if (companyEntityRe.test(title)) {
    const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const t6 = target.slice(0, 6);
    const n6 = normTitle.slice(0, 6);
    if (t6 && n6 && !normTitle.includes(t6) && !target.includes(n6)) {
      return true;
    }
  }

  return false;
}

// Validate that a title is a decision maker (C-level, VP, Director, etc.) and not just any employee
function isDecisionMakerTitle(title: string): boolean {
  if (!title || title === "—" || title.length < 2) return false;
  
  const titleLower = title.toLowerCase();
  
  // Decision maker patterns: C-level, VP, Director, Founder, Owner, President, Partner, Head of, Managing
  const decisionMakerPatterns = [
    /\b(ceo|chief executive|chief operating|chief technology|chief financial|chief marketing|chief product|chief revenue|chief innovation|chief strategy|chief data|chief information|chief legal|chief compliance|chief people|chief human|chief administrative|chief commercial|chief customer|chief sales|chief growth|chief security|chief design|chief engineering|chief science|chief medical|chief clinical|chief nursing|chief academic|chief content|chief creative|chief digital|chief analytics)\b/i,
    /\b(coo|cto|cfo|cmo|cpo|cro|cio|cdo|cso|cco|clo|cvo|cao|cxo|cno|cgo|cto|ciso|chro|cgmo|cbo)\b/i,
    /\b(founder|co-founder|cofounder|owner|co-owner|coowner)\b/i,
    /\b(president|vice president|vp|svp|evp|avp|senior vice president|executive vice president|assistant vice president)\b/i,
    /\b(partner|managing partner|senior partner|general partner|equity partner)\b/i,
    /\b(director|senior director|executive director|managing director|board director|associate director)\b/i,
    /\b(head of|general manager|regional manager|country manager|national manager|global manager)\b/i,
    /\b(principal|senior principal)\b/i,
  ];
  
  // Check if title matches any decision maker pattern
  const isDecisionMaker = decisionMakerPatterns.some(pattern => pattern.test(titleLower));
  
  // Exclude non-decision maker titles even if they contain keywords like "director" in "Director of Photography" at a film company
  const nonDecisionMakerPatterns = [
    /\b(intern|internship|student|trainee|apprentice|fellow|graduate|entry|junior|assistant|associate|coordinator|specialist|analyst|representative|rep|agent|clerk|staff|member|team member|contributor|volunteer|contractor)\b/i,
    /\b(coach|driver|trainer|instructor|teacher|educator|consultant|advisor|freelance|independent)\b/i,
    /\b(photographer|videographer|designer|developer|engineer|programmer|writer|editor|producer|artist|creative|talent)\b(?!.*\b(head|chief|vp|vice president|director|manager)\b)/i, // Only exclude if not combined with senior title
  ];
  
  const isExcluded = nonDecisionMakerPatterns.some(pattern => pattern.test(titleLower));
  
  return isDecisionMaker && !isExcluded;
}

function isLikelyHumanName(name: string): boolean {
  const raw = (name || "").trim();
  if (!raw || raw.length < 4 || raw.length > 60) return false;
  if (/^\d/.test(raw)) return false;
  if (/@|https?:|www\.|\.com\b/i.test(raw)) return false;

  const normalized = raw.toLowerCase();
  const titleOrContentPhrase = /\b(chief|officer|executive|insights?|yesterday|today|tomorrow|restaurant|restaurants|group|company|llc|inc|corp|department|transformation|hospitality|management|marketing|operations|finance|sales|careers|privacy|terms)\b/i;
  if (titleOrContentPhrase.test(normalized)) return false;

  const tokens = raw
    .split(/\s+/)
    .map(t => t.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, ""))
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  return tokens.every(token => /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'-]{1,}$/.test(token));
}

function isTrustedEmailSource(source?: string, confidence?: string): boolean {
  const cleanSource = (source || "").replace(/^pool:/, "").toLowerCase();
  if (!cleanSource) return false;
  if (cleanSource.includes("pattern") || cleanSource.includes("guess")) return false;
  if (cleanSource === "contndr_website") return confidence !== "low";
  return ["crm", "crm_verified", "hunter", "findymail", "website", "domain", "manual"].some(s => cleanSource.includes(s));
}

function trustedEmailResults(results: Record<string, { email: string; source: string; confidence: string }>) {
  return Object.fromEntries(
    Object.entries(results || {}).filter(([, value]) => isTrustedEmailSource(value.source, value.confidence))
  ) as Record<string, { email: string; source: string; confidence: string }>;
}

async function deliverableEmailResults(results: Record<string, { email: string; source: string; confidence: string }>) {
  const deliverable: Record<string, { email: string; source: string; confidence: string; mailbox_status?: string; mailbox_provider?: string }> = {};
  for (const [id, value] of Object.entries(results || {})) {
    if (!value.email) continue;
    const mailbox = await verifyMailboxDeliverability(value.email);
    if (!mailbox.safe_to_send) {
      console.log(`[EMAIL ENRICH] Dropped ${value.email}: ${mailbox.deliverability} (${mailbox.reason})`);
      continue;
    }
    deliverable[id] = {
      ...value,
      mailbox_status: mailbox.deliverability,
      mailbox_provider: mailbox.provider,
    };
  }
  return deliverable;
}

function parseLinkedInResult(result: any, companyName: string): PersonResult | null {
  try {
    const link: string = result.link || "";
    if (!link.includes("linkedin.com/in/")) return null;

    // Title format: "John Smith - CEO - Company Name | LinkedIn"
    // or "John Smith – Title at Company | LinkedIn"
    const rawTitle: string = result.title || "";
    const cleaned = rawTitle
      .replace(/\s*\|\s*LinkedIn.*$/i, "")
      .replace(/\s*[-–—]\s*LinkedIn.*$/i, "")
      .trim();

    // Try to extract name and title from the cleaned string
    // Pattern 1: "Name - Title - Company"
    // Pattern 2: "Name - Title at Company"
    // Pattern 3: "Name | Title"
    let name = "";
    let title = "";

    const dashParts = cleaned.split(/\s*[-–—]\s*/);
    if (dashParts.length >= 2) {
      name = dashParts[0].trim();
      // Everything after the first dash is title + company context
      title = dashParts.slice(1).join(" · ").trim();
      // Remove "at Company" suffix (employer is validated separately below)
      title = title.replace(/\s+at\s+.*$/i, "").trim();
    } else {
      const pipeParts = cleaned.split(/\s*\|\s*/);
      if (pipeParts.length >= 2) {
        name = pipeParts[0].trim();
        title = pipeParts[1].trim();
      } else {
        name = cleaned;
      }
    }

    // Skip if name looks like a company page or generic
    if (!name || name.length < 2 || name.length > 60 || !isLikelyHumanName(name)) return null;
    if (/^\d+\s+/.test(name)) return null; // starts with numbers
    if (name.toLowerCase().includes("linkedin")) return null;

    const snippet: string = result.snippet || "";

    // ── Employer validation ──────────────────────────────────────────────────
    // 1. Reject if the title clearly points to a different current company
    //    (e.g. "Turnbull Pickleball Academy", "WRR Travel Partners, LLC")
    if (hasClearlyDifferentEmployer(title, snippet, companyName)) {
      console.log(`[FIND PEOPLE] Rejected "${name}" — title indicates different employer (title: "${title}", target: "${companyName}")`);
      return null;
    }
    // 2. Reject if neither snippet nor raw Google title contains the company name
    //    — these are false positives where Google indexed the company name in endorsements/connections
    if (!isCurrentEmployer(snippet, rawTitle, companyName)) {
      console.log(`[FIND PEOPLE] Rejected "${name}" — company not found in snippet (not a current employee of "${companyName}")`);
      return null;
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Decision maker validation ────────────────────────────────────────────
    // Only return people with decision-maker titles (C-level, VP, Director, etc.)
    if (!isDecisionMakerTitle(title)) {
      console.log(`[FIND PEOPLE] Rejected "${name}" — not a decision maker (title: "${title}")`);
      return null;
    }
    // ────────────────────────────────────────────────────────────────────────

    const location = parseLocationFromSnippet(snippet, rawTitle);

    return {
      id: link.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32),
      name,
      title: title || "—",
      linkedin_url: link.split("?")[0], // clean tracking params
      snippet: snippet.slice(0, 300),
      company_match: companyName,
      location: location || undefined,
    };
  } catch {
    return null;
  }
}

app.post("/find-people", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);

    const body = await c.req.json();
    const { company_name, domain, location, search_location, phone } = body;
    // search_location = the user's original search location context (e.g. "Colorado", "Denver, CO")

    if (!company_name) {
      return c.json({ error: "company_name is required" }, 400);
    }

    // ── CRM contacts: pull existing contacts at this company first ──
    let crmPeople: PersonResult[] = [];
    let crmEmailMap: Record<string, { email: string; source: string; confidence: string }> = {};
    try {
      const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
      const { contactsByCompany } = await crossReferenceCRM(
        supabaseAdmin,
        user.id,
        [company_name],
        domain ? [domain] : []
      );
      const contacts = contactsByCompany[company_name] || [];
      if (contacts.length > 0) {
        console.log(`[FIND PEOPLE] Found ${contacts.length} existing CRM contacts at "${company_name}"`);
        for (const contact of contacts) {
          if (!contact.contact_name) continue;
          const personId = `crm-${contact.id}`;
          crmPeople.push({
            id: personId,
            name: contact.contact_name,
            title: contact.job_title || "—",
            linkedin_url: contact.linkedin || "",
            snippet: `CRM Contact · ${contact.source || "imported"}`,
            company_match: company_name,
          });
          if (contact.email) {
            crmEmailMap[personId] = { email: contact.email, source: "crm", confidence: "high" };
          }
        }
      }
    } catch (crmErr: any) {
      console.error("[FIND PEOPLE] CRM lookup error (non-fatal):", crmErr.message);
    }

    // ── Check pool intelligence first (24h shared cache), then short-lived cache ──
    const cacheKey = `find-people:${company_name.toLowerCase().trim()}:${(domain || "").toLowerCase().trim()}`;
    const cleanDomainForPool = domain ? domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() : "";

    // Pool intelligence — shared across all users
    const poolResult = await poolLookupPeople(company_name, cleanDomainForPool);
    if (poolResult) {
      console.log(`[FIND PEOPLE] Pool intelligence hit for "${company_name}" — ${poolResult.people.length} people`);
      const seenNames = new Set(crmPeople.map(p => p.name.toLowerCase()));
      // Re-validate cached pool results with the same employer filter so stale bad data is discarded
      const poolPeople = poolResult.people.filter((p: PersonResult) => {
        if (seenNames.has(p.name.toLowerCase())) return false;
        if (!isLikelyHumanName(p.name)) return false;
        // Hunter/CRM/registry people don't need the LinkedIn snippet check
        if (p.id.startsWith("hunter-") || p.id.startsWith("crm-") || p.id.startsWith("officer-") || p.id.startsWith("team-")) return true;
        // LinkedIn/profile people: re-apply employer validation against the snippet we stored
        if (hasClearlyDifferentEmployer(p.title, p.snippet, company_name)) return false;
        if (!isCurrentEmployer(p.snippet, p.title, company_name)) return false;
        return true;
      });
      const mergedEmails = { ...crmEmailMap, ...trustedEmailResults(poolResult.hunterEmails || {}) };
      // Sort by location relevance
      const sortLoc = search_location || location || "";
      let allPoolPeople = [...crmPeople, ...poolPeople];
      if (sortLoc) {
        const inA: PersonResult[] = [], unk: PersonResult[] = [], outA: PersonResult[] = [];
        for (const p of allPoolPeople) {
          if (!p.location) unk.push(p);
          else if (isLocationInArea(p.location, sortLoc)) inA.push(p);
          else outA.push(p);
        }
        allPoolPeople = [...inA, ...unk, ...outA];
      }
      return c.json({ 
        people: attachCompanyPhone(allPoolPeople, phone), 
        crm_emails: mergedEmails, 
        source: "pool",
        pool_hit: true,
        pool_people_count: poolPeople.length,
        pool_email_count: Object.keys(poolResult.hunterEmails || {}).length,
        search_location: sortLoc || undefined,
      });
    }

    // Short-lived user cache (1h)
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
        if (parsed._ts && Date.now() - parsed._ts < 3600000) {
          console.log(`[FIND PEOPLE] Cache hit for "${company_name}"`);
          const seenNames = new Set(crmPeople.map(p => p.name.toLowerCase()));
          const cachedPeople = (parsed.people || []).filter((p: PersonResult) => {
            if (seenNames.has(p.name.toLowerCase())) return false;
            if (!isLikelyHumanName(p.name)) return false;
            if (p.id.startsWith("hunter-") || p.id.startsWith("crm-") || p.id.startsWith("officer-") || p.id.startsWith("team-")) return true;
            if (hasClearlyDifferentEmployer(p.title, p.snippet, company_name)) return false;
            if (!isCurrentEmployer(p.snippet, p.title, company_name)) return false;
            return true;
          });
          const mergedEmails = { ...crmEmailMap, ...trustedEmailResults(parsed.hunterEmails || {}) };
          const cacheSortLoc = search_location || location || "";
          let cachedAllPeople = [...crmPeople, ...cachedPeople];
          if (cacheSortLoc) {
            const inA: PersonResult[] = [], unk: PersonResult[] = [], outA: PersonResult[] = [];
            for (const p of cachedAllPeople) {
              if (!p.location) unk.push(p);
              else if (isLocationInArea(p.location, cacheSortLoc)) inA.push(p);
              else outA.push(p);
            }
            cachedAllPeople = [...inA, ...unk, ...outA];
          }
          return c.json({ people: attachCompanyPhone(cachedAllPeople, phone), crm_emails: mergedEmails, source: "cache", search_location: cacheSortLoc || undefined });
        }
      }
    } catch {}

    const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
    if (!SERPAPI_KEY) {
      return c.json({ error: "SERPAPI_API_KEY not configured" }, 500);
    }

    const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");
    const cleanDomain = domain ? domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() : "";

    // ── Run LinkedIn search + Hunter.io domain-search in parallel ──
    const titleKeywords = `(CEO OR CTO OR COO OR CFO OR "Vice President" OR VP OR "Managing Director" OR founder OR owner OR president OR partner OR director OR "General Manager" OR "Head of")`;
    // Use search_location (the user's search context) as primary location filter — more specific than the company HQ
    const effectiveLocation = search_location || location || "";
    // Use "at {company}" phrasing — Google indexes LinkedIn snippets with "Role at Company"
    // This is significantly more accurate than just putting the company name in the query,
    // which can match anyone who merely mentioned the company (endorsements, connections, past roles).
    let query = `site:linkedin.com/in "${company_name}" ${titleKeywords}`;
    if (effectiveLocation) {
      query += ` "${effectiveLocation}"`;
    }
    // Secondary query uses "at" phrasing for higher-confidence current-employer matching
    const preciseQuery = `site:linkedin.com/in "at ${company_name}" ${titleKeywords}`;

    console.log(`[FIND PEOPLE] Searching for decision makers at "${company_name}" via multi-source enrichment (location: ${effectiveLocation || "none"})`);

    // Launch all searches in parallel for speed: profile search + domain search + Crunchbase/company profile search
    const linkedInPromise = (async () => {
      try {
        // Run both queries in parallel: broad name match + precise "at Company" phrasing
        const [broadRes, preciseRes] = await Promise.allSettled([
          fetch(`https://serpapi.com/search?${new URLSearchParams({ engine: "google", q: query, api_key: SERPAPI_KEY, num: "20" })}`, { signal: AbortSignal.timeout(20000) }),
          fetch(`https://serpapi.com/search?${new URLSearchParams({ engine: "google", q: preciseQuery, api_key: SERPAPI_KEY, num: "15" })}`, { signal: AbortSignal.timeout(18000) }),
        ]);

        const results: PersonResult[] = [];
        const seenUrls = new Set<string>();

        // Process broad results first
        if (broadRes.status === "fulfilled" && broadRes.value.ok) {
          const data = await broadRes.value.json();
          const organic = data.organic_results || [];
          console.log(`[FIND PEOPLE] Broad search returned ${organic.length} results`);
          for (const result of organic) {
            const person = parseLinkedInResult(result, company_name);
            if (person && !seenUrls.has(person.linkedin_url)) {
              seenUrls.add(person.linkedin_url);
              results.push(person);
            }
          }
        }

        // Merge precise "at Company" results (higher confidence, may add new profiles)
        if (preciseRes.status === "fulfilled" && preciseRes.value.ok) {
          const data = await preciseRes.value.json();
          const organic = data.organic_results || [];
          console.log(`[FIND PEOPLE] Precise "at company" search returned ${organic.length} results`);
          for (const result of organic) {
            const person = parseLinkedInResult(result, company_name);
            if (person && !seenUrls.has(person.linkedin_url)) {
              seenUrls.add(person.linkedin_url);
              // Prepend high-confidence "at Company" matches so they rank first
              results.unshift(person);
            }
          }
        }

        console.log(`[FIND PEOPLE] After employer validation: ${results.length} confirmed decision makers at "${company_name}"`);

        // Domain-based fallback if still sparse
        if (results.length < 3 && domain) {
          const fallbackQuery = `site:linkedin.com/in "${domain}" ${titleKeywords}${effectiveLocation ? ` "${effectiveLocation}"` : ""}`;
          const fallbackParams = new URLSearchParams({ engine: "google", q: fallbackQuery, api_key: SERPAPI_KEY, num: "15" });
          try {
            const fallbackRes = await fetch(`https://serpapi.com/search?${fallbackParams}`, { signal: AbortSignal.timeout(15000) });
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              for (const r of (fallbackData.organic_results || [])) {
                const person = parseLinkedInResult(r, company_name);
                if (person && !seenUrls.has(person.linkedin_url)) {
                  seenUrls.add(person.linkedin_url);
                  results.push(person);
                }
              }
            }
          } catch {}
        }
        return results;
      } catch (e: any) {
        console.error("[FIND PEOPLE] LinkedIn search error:", e.message);
        return [];
      }
    })();

    // Hunter.io domain-search returns people at a company with verified emails
    const hunterPromise = (async (): Promise<{ people: PersonResult[]; emails: Record<string, { email: string; source: string; confidence: string }> }> => {
      if (!HUNTER_API_KEY || !cleanDomain) {
        if (!HUNTER_API_KEY) console.log(`[FIND PEOPLE] Skipping Hunter.io: API key not configured`);
        if (!cleanDomain) console.log(`[FIND PEOPLE] Skipping Hunter.io: no domain provided for "${company_name}"`);
        return { people: [], emails: {} };
      }
      try {
        const hData = await hunterDomainSearch(cleanDomain, HUNTER_API_KEY, 20);
        if (!hData) return { people: [], emails: {} };
        const hunterEmails = hData.data?.emails || [];
        const hunterPeople: PersonResult[] = [];
        const hunterEmailMap: Record<string, { email: string; source: string; confidence: string }> = {};

        for (const entry of hunterEmails) {
          const firstName = entry.first_name || "";
          const lastName = entry.last_name || "";
          const fullName = `${firstName} ${lastName}`.trim();
          if (!fullName || fullName.length < 2) continue;

          const title = entry.position || "";
          const seniorityLower = (entry.seniority || "").toLowerCase();
          const titleLower = title.toLowerCase();
          const isDecisionMaker = seniorityLower === "senior" || seniorityLower === "executive" || seniorityLower === "c_level" ||
            /ceo|cto|coo|cfo|vp|vice president|director|founder|owner|president|partner|managing|head of|general manager|chief/i.test(titleLower);
          if (!isDecisionMaker && title) continue;
          if (!isLikelyHumanName(fullName)) continue;

          const personId = `hunter-${(entry.value || fullName).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;
          hunterPeople.push({
            id: personId,
            name: fullName,
            title: title || (entry.department ? `${entry.department} Department` : "—"),
            linkedin_url: entry.linkedin || "",
            snippet: `Domain Search · ${cleanDomain}`,
            company_match: company_name,
          });
          if (entry.value) {
            const conf = (entry.confidence || 0) > 80 ? "high" : (entry.confidence || 0) > 50 ? "medium" : "low";
            hunterEmailMap[personId] = { email: entry.value, source: "hunter", confidence: conf };
          }
        }

        console.log(`[FIND PEOPLE] Hunter.io found ${hunterPeople.length} people with ${Object.keys(hunterEmailMap).length} emails at "${cleanDomain}"`);
        return { people: hunterPeople, emails: hunterEmailMap };
      } catch (e: any) {
        console.error("[FIND PEOPLE] Hunter.io domain-search error:", e.message);
        return { people: [], emails: {} };
      }
    })();

    // ── Supplemental: search Crunchbase/company profiles for additional people ──
    const companyProfilePromise = (async (): Promise<PersonResult[]> => {
      if (!SERPAPI_KEY) return [];
      try {
        // Search Crunchbase, Bloomberg, company about pages for leadership info
        const profileQuery = `"${company_name}" (CEO OR founder OR "leadership team" OR "management team" OR "executive team") -site:linkedin.com`;
        const params = new URLSearchParams({ engine: "google", q: profileQuery, api_key: SERPAPI_KEY, num: "10" });
        const response = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) return [];
        const data = await response.json();
        const organic = data.organic_results || [];
        const results: PersonResult[] = [];

        for (const result of organic) {
          const snippet = result.snippet || "";
          const title = result.title || "";

          // Try to extract person names with titles from snippets
          // Pattern: "John Smith, CEO" or "CEO John Smith" or "founded by John Smith"
          const namePatterns = [
            /(?:CEO|CTO|COO|CFO|Founder|Co-Founder|President|Owner)\s+(?:&\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
            /([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[,]\s*(?:CEO|CTO|COO|CFO|Founder|Co-Founder|President|Owner|VP|Director)/g,
            /(?:founded|co-founded|led|headed|started)\s+by\s+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
          ];

          for (const pattern of namePatterns) {
            let match;
            while ((match = pattern.exec(snippet)) !== null) {
              const personName = match[1]?.trim();
              if (!personName || personName.length < 4 || personName.length > 50 || !isLikelyHumanName(personName)) continue;
              // Extract title context
              const titleContext = snippet.match(new RegExp(`${personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,\\s]*(?:is\\s+)?(?:the\\s+)?((?:CEO|CTO|COO|CFO|Founder|Co-Founder|President|Owner|VP|Director|Managing Director|Chief\\s+\\w+\\s+Officer)[^,.]*)`, 'i'));
              const titleStr = titleContext?.[1]?.trim() || "Executive";
              const personId = `profile-${personName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;
              results.push({
                id: personId,
                name: personName,
                title: titleStr,
                linkedin_url: "",
                snippet: `Company Profile · ${result.link?.includes("crunchbase") ? "Crunchbase" : "Web"}`,
                company_match: company_name,
              });
            }
          }
        }

        console.log(`[FIND PEOPLE] Company profile search found ${results.length} additional people`);
        return results;
      } catch (e: any) {
        console.error("[FIND PEOPLE] Company profile search error (non-fatal):", e.message);
        return [];
      }
    })();

    // ── 4th source: Website team pages + OpenCorporates officers ──
    const registryPeoplePromise = (async (): Promise<PersonResult[]> => {
      const results: PersonResult[] = [];
      try {
        // Run website team scrape and OpenCorporates officers in parallel
        const [webResult, ocResult] = await Promise.allSettled([
          domain ? enhancedWebsiteScrape(domain) : Promise.resolve(null),
          openCorporatesLookup(company_name, location),
        ]);

        // Website team members
        if (webResult.status === "fulfilled" && webResult.value?.team_members?.length) {
          for (const member of webResult.value.team_members) {
            if (!member.name || member.name.length < 3) continue;
            if (!isLikelyHumanName(member.name)) continue;
            const personId = `team-${member.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;
            results.push({
              id: personId,
              name: member.name,
              title: member.title || "—",
              linkedin_url: member.linkedin || "",
              snippet: "Team Page · Website",
              company_match: company_name,
            });
          }
          console.log(`[FIND PEOPLE] Website team scrape found ${webResult.value.team_members.length} people`);
        }

        // OpenCorporates officers
        if (ocResult.status === "fulfilled" && ocResult.value?.officers?.length) {
          for (const officer of ocResult.value.officers) {
            if (!officer.name || officer.name.length < 3) continue;
            // Skip if it looks like a company name rather than a person
            if (/\b(LLC|Inc|Corp|Ltd|Limited|LLP|LP|PLC|Group|Holdings|Trust|Bank|Fund)\b/i.test(officer.name)) continue;
            if (!isLikelyHumanName(officer.name)) continue;
            const personId = `officer-${officer.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;
            results.push({
              id: personId,
              name: officer.name,
              title: officer.position || "Officer",
              linkedin_url: "",
              snippet: "Corporate Registry · Public Record",
              company_match: company_name,
            });
          }
          console.log(`[FIND PEOPLE] OpenCorporates found ${ocResult.value.officers.length} officers`);
        }
      } catch (e: any) {
        console.log(`[FIND PEOPLE] Registry people search error (non-fatal): ${e.message}`);
      }
      return results;
    })();

    // Wait for all sources in parallel
    const [serpLinkedIn, hunterResult, profilePeople, registryPeople] = await Promise.all([linkedInPromise, hunterPromise, companyProfilePromise, registryPeoplePromise]);

    // Merge Hunter emails into the email map
    const mergedEmailMap = { ...crmEmailMap, ...hunterResult.emails };

    // Merge all people: CRM first, then LinkedIn, then Hunter, then profiles, then registry (deduped by name)
    const seenNames = new Set(crmPeople.map(p => p.name.toLowerCase().trim()));
    const dedupedLinkedIn = serpLinkedIn.filter(p => {
      const key = p.name.toLowerCase().trim();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
    const dedupedHunter = hunterResult.people.filter(p => {
      const key = p.name.toLowerCase().trim();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
    const dedupedProfile = profilePeople.filter(p => {
      const key = p.name.toLowerCase().trim();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
    const dedupedRegistry = registryPeople.filter(p => {
      const key = p.name.toLowerCase().trim();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
    let allPeople = [...crmPeople, ...dedupedLinkedIn, ...dedupedHunter, ...dedupedProfile, ...dedupedRegistry];

    // ── Location-aware sorting: in-area contacts first ──
    const sortLocation = search_location || location || "";
    if (sortLocation) {
      const inArea: PersonResult[] = [];
      const unknown: PersonResult[] = [];
      const outOfArea: PersonResult[] = [];
      for (const p of allPeople) {
        if (!p.location) unknown.push(p);
        else if (isLocationInArea(p.location, sortLocation)) inArea.push(p);
        else outOfArea.push(p);
      }
      allPeople = [...inArea, ...unknown, ...outOfArea];
      console.log(`[FIND PEOPLE] Location sort (${sortLocation}): ${inArea.length} in-area, ${unknown.length} unknown, ${outOfArea.length} out-of-area`);
    }

    console.log(`[FIND PEOPLE] Total: ${allPeople.length} decision makers (${crmPeople.length} CRM, ${dedupedLinkedIn.length} profiles, ${dedupedHunter.length} domain, ${dedupedProfile.length} company pages, ${dedupedRegistry.length} registry/team)`);

    // Cache results in both short-lived cache AND pool intelligence
    const apiPeople = [...dedupedLinkedIn, ...dedupedHunter, ...dedupedProfile, ...dedupedRegistry];
    try {
      await kv.set(cacheKey, JSON.stringify({ people: apiPeople, hunterEmails: hunterResult.emails, _ts: Date.now() }));
    } catch {}
    // Store in pool intelligence for ALL users (only non-CRM people since CRM is per-user)
    if (apiPeople.length > 0) {
      await poolStorePeople(company_name, cleanDomain, apiPeople, hunterResult.emails);
      // Also store any Hunter emails individually in the email pool
      for (const [personId, emailData] of Object.entries(hunterResult.emails)) {
        const person = apiPeople.find(p => p.id === personId);
        if (person && emailData.email) {
          const { first_name, last_name } = splitName(person.name);
          if (first_name) {
            await poolStoreEmail(first_name, last_name, cleanDomain, emailData.email, emailData.source, emailData.confidence);
          }
        }
      }
    }

    return c.json({ people: attachCompanyPhone(allPeople, phone), crm_emails: mergedEmailMap, source: "multi", search_location: sortLocation || undefined });
  } catch (error: any) {
    console.error("[FIND PEOPLE] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Enrich People Emails — Hunter.io → Findymail pipeline
// Takes decision makers found via LinkedIn and finds verified emails
// ══════════════════════════════════════════════════════════════════════════

interface EmailEnrichInput {
  id: string;
  name: string;
  title: string;
  linkedin_url: string;
}

function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

function cleanNameToken(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function extractEmailsFromText(text: string, domain: string): string[] {
  const cleanDomain = domain.toLowerCase();
  const emails = new Set<string>();
  const decoded = (text || "")
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/\s+\[at\]\s+|\s+\(at\)\s+|\s+at\s+/gi, "@")
    .replace(/\s+\[dot\]\s+|\s+\(dot\)\s+|\s+dot\s+/gi, ".");
  const matches = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[),.;:'">]+$/g, "");
    if (!email.endsWith(`@${cleanDomain}`)) continue;
    const local = email.split("@")[0] || "";
    if (!/^[a-z0-9._%+-]{2,}$/.test(local)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email)) continue;
    emails.add(email);
  }
  return [...emails];
}

async function scrapeWebsiteEmails(domain: string): Promise<string[]> {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, "");
  const paths = ["", "/contact", "/about", "/team", "/staff"];
  const urls = paths.flatMap(path => [
    `https://${cleanDomain}${path}`,
    path === "" ? `https://www.${cleanDomain}` : "",
  ]).filter(Boolean).slice(0, 6);

  const results = await Promise.allSettled(urls.map(async (url) => {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 ContndrBot/1.0" },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (contentType && !contentType.includes("text") && !contentType.includes("html")) return [];
    const text = await res.text();
    return extractEmailsFromText(text, cleanDomain);
  }));

  const emails = new Set<string>();
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const email of result.value) emails.add(email);
    }
  }
  return [...emails];
}

function emailMatchesPerson(email: string, firstName: string, lastName: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() || "";
  const first = cleanNameToken(firstName);
  const last = cleanNameToken(lastName);
  if (!first || !last) return false;
  const variants = new Set([
    `${first}.${last}`,
    `${first}_${last}`,
    `${first}-${last}`,
    `${first}${last}`,
    `${first[0]}${last}`,
    `${first}.${last[0]}`,
    `${first}${last[0]}`,
    `${last}.${first}`,
    `${last}${first}`,
  ]);
  return variants.has(local);
}

app.post("/enrich-people-email", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);

    const body = await c.req.json();
    const { people, domain, force } = body as { people: EmailEnrichInput[]; domain: string; force?: boolean };

    if (!people?.length) return c.json({ error: "people array is required" }, 400);
    if (!domain) return c.json({ error: "domain is required" }, 400);

    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
    if (!cleanDomain) return c.json({ error: "Invalid domain" }, 400);

    // ── Pool intelligence: stable domain-level cache key (not session-dependent IDs) ──
    const domainCacheKey = `email-enrich:pool:${cleanDomain}`;
    if (!force) {
      // First check per-person pool (7-day TTL, shared across all users)
      const peopleWithNames = people.map(p => {
        const { first_name, last_name } = splitName(p.name);
        return { id: p.id, first_name, last_name };
      }).filter(p => p.first_name);

      if (peopleWithNames.length > 0) {
        const { found: poolFound } = await poolBatchLookupEmails(peopleWithNames, cleanDomain);
        if (Object.keys(poolFound).length === people.length) {
          console.log(`[EMAIL ENRICH] Full pool intelligence hit for "${cleanDomain}" — ${Object.keys(poolFound).length}/${people.length} emails`);
          return c.json({ results: poolFound, source: "pool", total_found: Object.keys(poolFound).length, total_people: people.length, pool_hits: Object.keys(poolFound).length });
        }
        if (Object.keys(poolFound).length > 0) {
          console.log(`[EMAIL ENRICH] Partial pool intelligence hit for "${cleanDomain}" — ${Object.keys(poolFound).length}/${people.length} emails from pool`);
        }
      }

      // Also check legacy session-based cache as fallback
      const legacyCacheKey = `email-enrich:${cleanDomain}:${people.map((p) => p.id).sort().join(",")}`;
      try {
        const cached = await kv.get(legacyCacheKey);
        if (cached) {
          const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
          const trustedCached = trustedEmailResults(parsed.results || {});
          const cachedCount = Object.keys(trustedCached).length;
          if (parsed._ts && Date.now() - parsed._ts < 3600000 && cachedCount > 0) {
            console.log(`[EMAIL ENRICH] Legacy cache hit for domain "${cleanDomain}"`);
            return c.json({ results: trustedCached, source: "cache" });
          }
        }
      } catch {}
    } else {
      console.log(`[EMAIL ENRICH] Force mode — skipping all caches for "${cleanDomain}"`);
    }

    const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");
    const FINDYMAIL_API_KEY = Deno.env.get("FINDYMAIL_API_KEY");
    if (!HUNTER_API_KEY && !FINDYMAIL_API_KEY) {
      console.log("[EMAIL ENRICH] No external providers configured — using Contndr fallback enrichment only");
    }

    console.log(`[EMAIL ENRICH] Starting for ${people.length} people at "${cleanDomain}"`);
    const results: Record<string, { email: string; source: string; confidence: string }> = {};
    const pending = new Map<string, { first_name: string; last_name: string }>();

    // Phase -1: Check per-person pool intelligence (7-day TTL, shared across all users)
    // This runs BEFORE CRM check because pool data is the cheapest (zero API cost)
    if (!force) {
      const peopleWithNames = people.map(p => {
        const { first_name, last_name } = splitName(p.name);
        return { id: p.id, first_name, last_name };
      }).filter(p => p.first_name);

      if (peopleWithNames.length > 0) {
        const { found: poolFound, pending: poolPending } = await poolBatchLookupEmails(peopleWithNames, cleanDomain);
        for (const [id, data] of Object.entries(poolFound)) {
          results[id] = data;
        }
        if (Object.keys(poolFound).length > 0) {
          console.log(`[EMAIL ENRICH] Phase -1 (Pool): Found ${Object.keys(poolFound).length} emails from shared pool`);
        }
      }
    }

    // Phase 0: Check CRM for existing emails (free — no API calls needed)
    try {
      const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
      const teamIds = await getTeamMemberIds(user.id);
      const { data: crmLeads } = await supabaseAdmin
        .from("leads")
        .select("contact_name, email")
        .in("user_id", teamIds)
        .not("email", "is", null)
        .not("contact_name", "is", null)
        .limit(5000);

      if (crmLeads?.length) {
        const crmEmailIndex = new Map<string, string>();
        for (const lead of crmLeads) {
          if (lead.email && lead.contact_name) {
            crmEmailIndex.set(lead.contact_name.toLowerCase().trim(), lead.email);
          }
        }
        for (const person of people) {
          const nameKey = person.name.toLowerCase().trim();
          const crmEmail = crmEmailIndex.get(nameKey);
          if (crmEmail) {
            results[person.id] = { email: crmEmail, source: "crm", confidence: "high" };
            console.log(`[EMAIL ENRICH] CRM hit: ${person.name} → ${crmEmail}`);
          }
        }
        if (Object.keys(results).length > 0) {
          console.log(`[EMAIL ENRICH] Phase 0: Found ${Object.keys(results).length} emails from CRM`);
        }
      }
    } catch (crmErr: any) {
      console.error("[EMAIL ENRICH] CRM email lookup error (non-fatal):", crmErr.message);
    }

    for (const person of people) {
      if (results[person.id]) continue; // Already have email from CRM
      const { first_name, last_name } = splitName(person.name);
      if (first_name) pending.set(person.id, { first_name, last_name });
    }

    // Phase 1: Hunter.io (batches of 3 with longer delays to respect rate limits)
    if (HUNTER_API_KEY && pending.size > 0) {
      console.log(`[EMAIL ENRICH] Phase 1: Hunter.io for ${pending.size} people`);
      const entries = [...pending.entries()];
      for (let i = 0; i < entries.length; i += 3) {
        const batch = entries.slice(i, i + 3);
        const br = await Promise.allSettled(
          batch.map(async ([id, { first_name, last_name }]) => {
            try {
              const url = `https://api.hunter.io/v2/email-finder?first_name=${encodeURIComponent(first_name)}&last_name=${encodeURIComponent(last_name)}&domain=${encodeURIComponent(cleanDomain)}&api_key=${HUNTER_API_KEY}`;
              const r = await hunterFetchWithRetry(url, 0);
              if (!r) return null;
              const d = await r.json();
              if (d.data?.email) {
                const confidence = d.data.score > 80 ? "high" : d.data.score > 50 ? "medium" : "low";
                return { id, email: d.data.email, source: "hunter", confidence };
              }
              return null;
            } catch { return null; }
          })
        );
        for (const r of br) {
          if (r.status === "fulfilled" && r.value) {
            results[r.value.id] = { email: r.value.email, source: r.value.source, confidence: r.value.confidence };
            // Store in pool intelligence for future users
            const personNames = pending.get(r.value.id);
            if (personNames) {
              poolStoreEmail(personNames.first_name, personNames.last_name, cleanDomain, r.value.email, r.value.source, r.value.confidence);
            }
            pending.delete(r.value.id);
          }
        }
        if (i + 3 < entries.length) await new Promise((r) => setTimeout(r, 600));
      }
      console.log(`[EMAIL ENRICH] Hunter.io found ${Object.keys(results).length} emails`);
    }

    // Phase 2: Findymail
    if (FINDYMAIL_API_KEY && pending.size > 0) {
      console.log(`[EMAIL ENRICH] Phase 2: Findymail for ${pending.size} remaining`);
      const entries = [...pending.entries()];
      let findymailFound = 0;
      for (let i = 0; i < entries.length; i += 5) {
        const batch = entries.slice(i, i + 5);
        const br = await Promise.allSettled(
          batch.map(async ([id, { first_name, last_name }]) => {
            try {
              const r = await fetch("https://app.findymail.com/api/search/name", {
                method: "POST",
                headers: { Authorization: `Bearer ${FINDYMAIL_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ first_name, last_name: last_name || "", domain: cleanDomain }),
                signal: AbortSignal.timeout(8000),
              });
              if (!r.ok) return null;
              const d = await r.json();
              if (d.email) return { id, email: d.email, source: "findymail", confidence: "high" };
              return null;
            } catch { return null; }
          })
        );
        for (const r of br) {
          if (r.status === "fulfilled" && r.value) {
            results[r.value.id] = { email: r.value.email, source: r.value.source, confidence: r.value.confidence };
            // Store in pool intelligence for future users
            const personNames = pending.get(r.value.id);
            if (personNames) {
              poolStoreEmail(personNames.first_name, personNames.last_name, cleanDomain, r.value.email, r.value.source, r.value.confidence);
            }
            pending.delete(r.value.id);
            findymailFound++;
          }
        }
        if (i + 5 < entries.length) await new Promise((r) => setTimeout(r, 400));
      }
      console.log(`[EMAIL ENRICH] Findymail found ${findymailFound} additional emails`);
    }

    // Phase 3a: First-party website scrape. This catches obvious personal emails
    // from contact/about/team pages before we generate low-confidence guesses.
    if (pending.size > 0 && cleanDomain) {
      try {
        console.log(`[EMAIL ENRICH] Phase 3a: Contndr website email scrape for ${pending.size} remaining`);
        const websiteEmails = await scrapeWebsiteEmails(cleanDomain);
        let websiteFound = 0;
        if (websiteEmails.length > 0) {
          for (const [id, { first_name, last_name }] of [...pending.entries()]) {
            const email = websiteEmails.find(e => emailMatchesPerson(e, first_name, last_name));
            if (!email) continue;
            results[id] = { email, source: "contndr_website", confidence: "medium" };
            poolStoreEmail(first_name, last_name, cleanDomain, email, "contndr_website", "medium");
            pending.delete(id);
            websiteFound++;
          }
        }
        console.log(`[EMAIL ENRICH] Website scrape found ${websiteEmails.length} domain emails, matched ${websiteFound} people`);
      } catch (websiteErr: any) {
        console.log(`[EMAIL ENRICH] Website email scrape failed (non-fatal): ${websiteErr.message}`);
      }
    }

    // Phase 3b: Explicitly do NOT invent first.last style emails. MX-valid only
    // proves the domain can receive mail, not that this person's mailbox exists.
    if (pending.size > 0 && cleanDomain) {
      console.log(`[EMAIL ENRICH] ${pending.size} people remain without trusted emails — skipping guessed email generation`);
    }

    const filteredResults = await deliverableEmailResults(trustedEmailResults(results));
    const droppedGuesses = Object.keys(results).length - Object.keys(filteredResults).length;
    if (droppedGuesses > 0) {
      console.log(`[EMAIL ENRICH] Dropped ${droppedGuesses} guessed/untrusted emails from response`);
    }
    const totalFound = Object.keys(filteredResults).length;
    const poolHits = Object.values(filteredResults).filter(r => r.source.startsWith("pool:")).length;
    console.log(`[EMAIL ENRICH] DONE: ${totalFound}/${people.length} emails for "${cleanDomain}" (${poolHits} from pool, ${totalFound - poolHits} freshly enriched)`);

    // Store domain-level cache (stable key, not session-dependent)
    if (totalFound > 0) {
      try { await kv.set(domainCacheKey, JSON.stringify({ results: filteredResults, _ts: Date.now() })); } catch {}
    }
    // Also store legacy session-based cache for backward compatibility
    const legacyCacheKey2 = `email-enrich:${cleanDomain}:${people.map((p) => p.id).sort().join(",")}`;
    if (totalFound > 0) {
      try { await kv.set(legacyCacheKey2, JSON.stringify({ results: filteredResults, _ts: Date.now() })); } catch {}
    }

    return c.json({ results: filteredResults, source: "enriched", total_found: totalFound, total_people: people.length, pool_hits: poolHits });
  } catch (error: any) {
    console.error("[EMAIL ENRICH] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /save-people-to-crm — Save discovered decision makers to CRM ──
app.post("/save-people-to-crm", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const body = await c.req.json();
    const { people, company } = body as {
      people: {
        id: string;
        name: string;
        title: string;
        linkedin_url?: string;
        email?: string;
        email_source?: string;
        email_confidence?: string;
        phone?: string;
      }[];
      company: {
        name: string;
        website_url?: string;
        phone?: string;
        address?: string;
        city?: string;
        state?: string;
        country?: string;
        industry?: string;
        estimated_num_employees?: number;
        annual_revenue_printed?: string;
        rating?: number;
        reviews_count?: number;
      };
    };

    if (!Array.isArray(people) || people.length === 0) {
      return c.json({ error: "No people provided" }, 400);
    }
    if (!company?.name) {
      return c.json({ error: "Company info required" }, 400);
    }

    console.log(`[COMPANY SEARCH] Saving ${people.length} decision makers from "${company.name}" to CRM for user ${user.email}`);

    // ── Lead limit check ──
    const { getUserSubscriptionStatus } = await import("./contndr-billing.tsx");
    const { getLeadLimitForPlan } = await import("./plan-entitlements.ts");
    const sub = await getUserSubscriptionStatus(user);
    const plan = sub?.plan || "none";
    const limit = getLeadLimitForPlan(plan);
    const { count: currentCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    const cc = currentCount || 0;
    if (limit !== -1 && cc + people.length > limit) {
      return c.json({
        error: "LEAD_LIMIT_EXCEEDED",
        message: `You've reached your ${plan === "none" ? "free tier" : plan + " plan"} limit of ${limit.toLocaleString()} contacts.`,
        currentCount: cc, limit, plan,
        remaining: Math.max(0, limit - cc),
      }, 403);
    }

    // ── Dedup: fetch existing team leads ──
    const teamIds = await getTeamMemberIds(user.id);
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("email")
      .in("user_id", teamIds);
    const existingEmails = new Set<string>(
      (existingLeads || []).map((l: any) => (l.email || "").toLowerCase()).filter(Boolean)
    );

    const results = { saved: 0, skipped: 0, failed: 0, errors: [] as string[] };

    for (const person of people) {
      try {
        if (person.id.startsWith("crm-")) { results.skipped++; continue; }

        let emailLower = (person.email || "").toLowerCase().trim();
        if (emailLower && existingEmails.has(emailLower)) {
          results.skipped++; continue;
        }

        const contactName = (person.name || "").trim();
        const jobTitle = (person.title || "").trim();
        if (!contactName) { results.skipped++; continue; }

        let mailboxNote = "";
        if (emailLower) {
          const mailbox = await verifyMailboxDeliverability(emailLower);
          mailboxNote = [
            `Mailbox Verification: ${mailbox.deliverability}`,
            `Mailbox Provider: ${mailbox.provider}`,
            `Mailbox Status: ${mailbox.provider_status || "N/A"}`,
            `Mailbox Reason: ${mailbox.reason}`,
          ].join("\n");
          if (!mailbox.safe_to_send) {
            console.warn(`[COMPANY SEARCH] Dropping unsafe email for ${contactName}: ${emailLower} (${mailbox.reason})`);
            emailLower = "";
          }
        }

        const phoneForLead = normalizePhone(person.phone) || normalizePhone(company.phone) || "";
        if (!emailLower && !phoneForLead) {
          results.skipped++;
          results.errors.push(`${contactName}: skipped because no deliverable email or usable phone was available`);
          continue;
        }

        let annualRevenue: number | null = null;
        const revStr = company.annual_revenue_printed || "";
        if (revStr) {
          const cleaned = revStr.replace(/[^0-9.BMKbmk]/g, "");
          const num = parseFloat(cleaned);
          if (!isNaN(num)) {
            if (/B/i.test(revStr)) annualRevenue = num * 1_000_000_000;
            else if (/M/i.test(revStr)) annualRevenue = num * 1_000_000;
            else if (/K/i.test(revStr)) annualRevenue = num * 1_000;
            else annualRevenue = num;
          }
        }

        const { error } = await supabase.from("leads").insert({
          user_id: user.id,
          business_name: company.name,
          contact_name: contactName,
          email: emailLower,
          phone: phoneForLead,
          website: company.website_url || "",
          address: company.address || "",
          city: toTitleCase(company.city || ""),
          state: toTitleCase(company.state || ""),
          country: toTitleCase(company.country || ""),
          category: toTitleCase(company.industry || ""),
          industry: toTitleCase(company.industry || ""),
          job_title: jobTitle,
          source: "company_search",
          person_linkedin_url: person.linkedin_url || "",
          linkedin: person.linkedin_url || "",
          employees: company.estimated_num_employees ? String(company.estimated_num_employees) : "",
          annual_revenue: annualRevenue,
          rating: company.rating || null,
          reviews: company.reviews_count || null,
          notes: [
            `Imported via Company Search — Decision Maker.`,
            `Role: ${jobTitle || "N/A"}`,
            `Email Source: ${person.email_source || "N/A"}`,
            `Email Confidence: ${person.email_confidence || "N/A"}`,
            mailboxNote,
            `LinkedIn: ${person.linkedin_url || "N/A"}`,
          ].filter(Boolean).join("\n"),
          status: "Cold",
          created_at: new Date().toISOString(),
        });

        if (error) {
          console.error(`[COMPANY SEARCH] Insert error for ${contactName}:`, error.message);
          results.failed++;
          results.errors.push(`${contactName}: ${error.message}`);
        } else {
          results.saved++;
          if (emailLower) existingEmails.add(emailLower);
          // Store verified email in pool intelligence (CRM saves = highest confidence)
          if (emailLower && company.website_url) {
            const cleanDomain = company.website_url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
            if (cleanDomain) {
              const { first_name, last_name } = splitName(contactName);
              if (first_name) {
                poolStoreEmail(first_name, last_name, cleanDomain, person.email!, "crm_verified", "high");
              }
            }
          }
        }
      } catch (e: any) {
        results.failed++;
        results.errors.push(e.message);
      }
    }

    console.log(`[COMPANY SEARCH] Save complete: ${results.saved} saved, ${results.skipped} skipped, ${results.failed} failed`);
    return c.json({ success: true, results });
  } catch (error: any) {
    console.error("[COMPANY SEARCH] Save to CRM error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Pool Intelligence Management Endpoints
// ══════════════════════════════════════════════════════════════════════════

// ── GET /pool-stats — returns pool statistics (total entries, credits saved) ──
app.get("/make-server-a8b2511f/pool-stats", async (c) => {
  try {
    const stats = await getPoolStats();
    
    // Count actual pool entries by prefix (for accuracy check)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );
    
    const prefixes = ["pool:email:", "pool:people:", "pool:company:", "pool:pattern:"];
    let totalEntries = 0;
    
    for (const prefix of prefixes) {
      const { count } = await supabase
        .from("kv_store_a8b2511f")
        .select("key", { count: "exact", head: true })
        .like("key", `${prefix}%`);
      totalEntries += count || 0;
    }
    
    return c.json({
      success: true,
      stats: {
        ...stats,
        total_pool_entries: totalEntries,
        estimated_cost_saved: Math.round(stats.api_calls_saved * 0.002 * 100) / 100, // ~$0.002 per API call
      },
    });
  } catch (error: any) {
    console.error("[POOL STATS] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /pool-invalidate — invalidate pool entries by domain/company/all ──
app.post("/make-server-a8b2511f/pool-invalidate", async (c) => {
  try {
    const body = await c.req.json();
    const { domain, company_name, invalidate_all } = body;
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );
    
    let deletedCount = 0;
    
    if (invalidate_all) {
      // Delete all pool entries
      const { count } = await supabase
        .from("kv_store_a8b2511f")
        .delete({ count: "exact" })
        .like("key", "pool:%");
      deletedCount = count || 0;
      console.log(`[POOL INVALIDATE] Deleted all ${deletedCount} pool entries`);
    } else if (domain) {
      // Delete entries matching domain
      const cleanDomain = domain.toLowerCase().trim();
      const patterns = [
        `pool:email:%:${cleanDomain}`,
        `pool:people:%:${cleanDomain}`,
        `pool:pattern:${cleanDomain}`,
      ];
      
      for (const pattern of patterns) {
        const { count } = await supabase
          .from("kv_store_a8b2511f")
          .delete({ count: "exact" })
          .like("key", pattern);
        deletedCount += count || 0;
      }
      console.log(`[POOL INVALIDATE] Deleted ${deletedCount} entries for domain: ${cleanDomain}`);
    } else if (company_name) {
      // Delete entries matching company name
      const cleanName = company_name.toLowerCase().trim();
      const patterns = [
        `pool:people:${cleanName}:%`,
        `pool:company:${cleanName}:%`,
      ];
      
      for (const pattern of patterns) {
        const { count } = await supabase
          .from("kv_store_a8b2511f")
          .delete({ count: "exact" })
          .like("key", pattern);
        deletedCount += count || 0;
      }
      console.log(`[POOL INVALIDATE] Deleted ${deletedCount} entries for company: ${cleanName}`);
    } else {
      return c.json({ error: "Must provide domain, company_name, or invalidate_all" }, 400);
    }
    
    return c.json({ success: true, deleted_count: deletedCount });
  } catch (error: any) {
    console.error("[POOL INVALIDATE] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /pool-coverage — check what pool data exists for a company ──
app.post("/make-server-a8b2511f/pool-coverage", async (c) => {
  try {
    const body = await c.req.json();
    const { company_name, domain, location } = body;
    
    if (!company_name || !domain) {
      return c.json({ error: "company_name and domain required" }, 400);
    }
    
    const cleanName = company_name.toLowerCase().trim();
    const cleanDomain = domain.toLowerCase().trim();
    const cleanLocation = (location || "").toLowerCase().trim();
    
    // Check each pool type
    const coverage: any = {
      has_company_data: false,
      has_people_data: false,
      has_email_pattern: false,
      people_count: 0,
      emails_count: 0,
    };
    
    // Company enrichment
    const companyData = await poolLookupCompanyEnrich(cleanName, cleanLocation);
    if (companyData) {
      coverage.has_company_data = true;
    }
    
    // People data
    const peopleData = await poolLookupPeople(cleanName, cleanDomain);
    if (peopleData) {
      coverage.has_people_data = true;
      coverage.people_count = peopleData.people.length;
      coverage.emails_count = Object.keys(peopleData.hunterEmails).length;
    }
    
    // Email pattern
    const pattern = await poolLookupEmailPattern(cleanDomain);
    if (pattern) {
      coverage.has_email_pattern = true;
    }
    
    // Calculate coverage score (0-100)
    let score = 0;
    if (coverage.has_company_data) score += 30;
    if (coverage.has_people_data) score += 40;
    if (coverage.has_email_pattern) score += 30;
    coverage.coverage_score = score;
    
    return c.json({ success: true, coverage });
  } catch (error: any) {
    console.error("[POOL COVERAGE] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// AI Search Suggestions — generates alternative queries when 0 results
// ══════════════════════════════════════════════════════════════════════════

app.post("/suggest", async (c) => {
  try {
    const { companyName, location, keywords, industries } = await c.req.json();

    // Build context about what failed
    const parts: string[] = [];
    if (companyName) parts.push(`Company name: "${companyName}"`);
    if (location) parts.push(`Location: "${location}"`);
    if (keywords) parts.push(`Keywords: "${keywords}"`);
    if (industries?.length) parts.push(`Industries: ${industries.join(", ")}`);
    const searchContext = parts.join("\n");

    if (!searchContext) {
      return c.json({ suggestions: {} });
    }

    const aiResult = await generateAI({
      messages: [
        {
          role: "system",
          content: `You are a B2B lead generation expert. A user searched for companies but got 0 results. Based on their search parameters, suggest alternative searches that are likely to return results.

Return valid JSON only with this structure:
{
  "competitors": [{ "name": "Company Name", "reason": "Short reason" }],
  "related_keywords": [{ "term": "keyword phrase", "reason": "Why this is related" }],
  "broader_industries": [{ "industry": "Industry Name", "reason": "Connection to original search" }],
  "search_tips": ["One-sentence tip for better results"]
}

Rules:
- competitors: 3-5 real, well-known companies similar to or in the same space as the searched company/industry. Only include if a company name or specific keywords were searched.
- related_keywords: 3-5 alternative keyword phrases that would find similar companies. Be specific — e.g. "property management software" not just "management".
- broader_industries: 2-3 related industry categories worth exploring.
- search_tips: 1-2 practical tips specific to this search.
- All suggestions must be real, actionable, and relevant to the original search intent.`,
        },
        {
          role: "user",
          content: `The following company search returned 0 results:\n\n${searchContext}\n\nSuggest alternatives.`,
        },
      ],
      temperature: 0.7,
      maxTokens: 800,
      jsonMode: true,
    });

    let parsed;
    try {
      parsed = JSON.parse(aiResult.text);
    } catch {
      console.error("[SUGGEST] Failed to parse AI response:", aiResult.text);
      return c.json({ suggestions: { competitors: [], related_keywords: [], broader_industries: [], search_tips: [] } });
    }

    return c.json({ suggestions: parsed });
  } catch (error: any) {
    console.error("[SUGGEST] Error:", error);
    return c.json({ suggestions: { competitors: [], related_keywords: [], broader_industries: [], search_tips: [] } });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Brandfetch Brand Enrichment — logo, icon, colors, name
// KV-cached with 30-day TTL • Falls back to Google Favicon
// ══════════════════════════════════════════════════════════════════════════

function normalizeDomain(raw: string): string {
  if (!raw) return "";
  let d = raw.trim().toLowerCase();
  if (d.includes("@")) d = d.split("@").pop() || "";
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.replace(/[/?#].*$/, "");
  d = d.replace(/[./]+$/, "");
  return d;
}

// BRAND_KV_PREFIX and BRAND_CACHE_TTL_MS are declared near top of file

// ── Domain & Brand Validation ────────────────���─────────────────────────────
// Social/directory domains must NEVER be queried via Brandfetch/Clearbit — they're not the company.
const SOCIAL_BRAND_DOMAINS = new Set([
  "linkedin.com", "facebook.com", "twitter.com", "x.com",
  "instagram.com", "tiktok.com", "youtube.com", "github.com",
  "crunchbase.com", "bloomberg.com", "yelp.com", "bbb.org",
  "glassdoor.com", "indeed.com", "angel.co", "wellfound.com",
  "pitchbook.com", "owler.com", "zoominfo.com", "google.com",
  "apple.com", "amazon.com", "microsoft.com",
]);

/** Strip common business suffixes for fuzzy comparison */
function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/\b(inc|llc|ltd|corp|co|company|group|holdings|enterprises?|international|intl|plc|gmbh|sa|srl|pty|pvt)\b\.?/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract the root domain (e.g., "sub.foo.com" → "foo.com") */
function rootDomain(d: string): string {
  const parts = d.split(".");
  if (parts.length <= 2) return d;
  return parts.slice(-2).join(".");
}

/**
 * Check if Brandfetch's returned domain is a plausible match for what we queried.
 * Handles: exact match, www prefix, subdomain redirects, minor TLD changes.
 */
function domainMatchesQuery(returnedDomain: string, queriedDomain: string): boolean {
  if (!returnedDomain || !queriedDomain) return true; // can't verify → assume ok
  const rd = normalizeDomain(returnedDomain);
  const qd = normalizeDomain(queriedDomain);
  if (rd === qd) return true;
  if (rootDomain(rd) === rootDomain(qd)) return true;
  const rdBase = rd.replace(/\.[a-z]{2,6}$/, "");
  const qdBase = qd.replace(/\.[a-z]{2,6}$/, "");
  if (rdBase === qdBase) return true;
  return false;
}

/**
 * Check if a Brandfetch brand name plausibly matches the expected company name.
 * Uses token overlap — rejects only when there's ZERO meaningful overlap.
 */
function brandNameMatchesCompany(brandName: string, companyName: string): boolean {
  if (!brandName || !companyName) return true; // can't verify → assume ok
  const bn = normalizeBrandName(brandName);
  const cn = normalizeBrandName(companyName);
  if (bn.includes(cn) || cn.includes(bn)) return true;
  const bnTokens = bn.split(/\s+/).filter(t => t.length >= 3);
  const cnTokens = cn.split(/\s+/).filter(t => t.length >= 3);
  if (bnTokens.length === 0 || cnTokens.length === 0) return true; // too short to verify
  const cnSet = new Set(cnTokens);
  const overlap = bnTokens.filter(t => cnSet.has(t));
  return overlap.length > 0;
}

interface BrandRecord {
  domain: string;
  name?: string;
  logo_url?: string;
  icon_url?: string;
  colors?: { hex: string; type: string }[];
  source: "brandfetch" | "clearbit" | "serpapi_logo" | "favicon" | "not_found";
  logo_quality?: "high" | "medium" | "low" | "none"; // quality gate result
  fetched_at: number;
  error?: string;
}

async function fetchBrandfetch(domain: string, expectedCompanyName?: string): Promise<BrandRecord | null> {
  // Block social/directory domains — never waste API credits on these
  if (SOCIAL_BRAND_DOMAINS.has(rootDomain(domain))) {
    console.log(`[BRANDFETCH] Skipping social/directory domain: ${domain}`);
    return null;
  }
  const apiKey = Deno.env.get("BRANDFETCH_API_KEY");
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      return { domain, source: "not_found", fetched_at: Date.now(), error: "not_found_brandfetch" };
    }
    if (!res.ok) {
      console.error(`[BRANDFETCH] HTTP ${res.status} for ${domain}`);
      return null;
    }
    const data = await res.json();

    // ── DOMAIN REDIRECT GUARD ──
    // Brandfetch may resolve parked/redirected domains to a completely different brand.
    // If the returned domain doesn't match what we queried, reject the result.
    const returnedDomain = data.domain || "";
    if (returnedDomain && !domainMatchesQuery(returnedDomain, domain)) {
      console.warn(`[BRANDFETCH] ⚠️ DOMAIN MISMATCH: queried "${domain}" but got brand for "${returnedDomain}" (name: "${data.name || "?"}") — REJECTED to prevent wrong logo`);
      return { domain, source: "not_found", fetched_at: Date.now(), error: `domain_redirect:${returnedDomain}` };
    }

    // ── BRAND NAME GUARD ──
    // If we know the expected company name, verify the Brandfetch brand name has some overlap.
    // This catches cases where Brandfetch returns data for the domain owner but not the actual business.
    if (expectedCompanyName && data.name) {
      if (!brandNameMatchesCompany(data.name, expectedCompanyName)) {
        console.warn(`[BRANDFETCH] ⚠️ NAME MISMATCH: expected "${expectedCompanyName}" but Brandfetch returned "${data.name}" for domain "${domain}" — REJECTED`);
        return { domain, source: "not_found", fetched_at: Date.now(), error: `name_mismatch:${data.name}` };
      }
    }

    let bestLogo = "";
    let bestIcon = "";
    const logos: any[] = data.logos || [];
    for (const logo of logos) {
      const formats: any[] = logo.formats || [];
      // Prefer SVG for crisp rendering at any size, then PNG, then anything available
      const bestFormat = formats.find((f: any) => f.format === "svg") || formats.find((f: any) => f.format === "png") || formats[0];
      if (!bestFormat?.src) continue;
      if (logo.type === "logo" || logo.type === "symbol") {
        if (!bestLogo || logo.type === "logo") bestLogo = bestFormat.src;
      }
      if (logo.type === "icon" || logo.type === "symbol") {
        if (!bestIcon) bestIcon = bestFormat.src;
      }
    }
    if (!bestLogo && logos.length > 0) {
      const anyFormat = logos[0]?.formats?.[0];
      if (anyFormat?.src) bestLogo = anyFormat.src;
    }
    if (!bestIcon && bestLogo) bestIcon = bestLogo;
    const colors: { hex: string; type: string }[] = [];
    for (const c of data.colors || []) {
      if (c.hex) colors.push({ hex: c.hex, type: c.type || "primary" });
    }
    console.log(`[BRANDFETCH] ✅ Matched "${domain}" → brand "${data.name || "?"}" (logos: ${logos.length}, colors: ${colors.length})`);
    return {
      domain,
      name: data.name || undefined,
      logo_url: bestLogo || undefined,
      icon_url: bestIcon || undefined,
      colors: colors.length > 0 ? colors : undefined,
      source: "brandfetch",
      logo_quality: "high",
      fetched_at: Date.now(),
    };
  } catch (err: any) {
    console.error(`[BRANDFETCH] Error for ${domain}:`, err?.message);
    return null;
  }
}

/**
 * Clearbit Logo API — free, no API key needed.
 * Returns a high-quality 128px PNG logo or 404.
 * HEAD request to validate before caching.
 */
async function fetchClearbit(domain: string): Promise<BrandRecord | null> {
  // Block social/directory domains
  if (SOCIAL_BRAND_DOMAINS.has(rootDomain(domain))) return null;
  try {
    const url = `https://logo.clearbit.com/${domain}?size=128&format=png`;
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.log(`[CLEARBIT] No logo for ${domain} (HTTP ${res.status})`);
      return null;
    }
    // Verify content-type is an image (not an error page)
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) {
      console.log(`[CLEARBIT] Non-image response for ${domain}: ${ct}`);
      return null;
    }
    console.log(`[CLEARBIT] Found logo for ${domain}`);
    return {
      domain,
      logo_url: url,
      icon_url: `https://logo.clearbit.com/${domain}?size=64&format=png`,
      source: "clearbit",
      logo_quality: "high",
      fetched_at: Date.now(),
    };
  } catch (err: any) {
    console.log(`[CLEARBIT] Error for ${domain}: ${err?.message}`);
    return null;
  }
}

/**
 * SerpAPI Google Images search for company logos — DOMAIN-VERIFIED.
 *
 * Searches Google Images by company name (broad) but verifies results against the
 * company's domain before accepting. Two-pass approach:
 *
 *   Pass 1 (strict): Image URL or source page is on the company's own domain → accept.
 *   Pass 2 (trusted): Image is from Wikipedia/Wikimedia/known logo aggregators where
 *                      the source page URL or title references the company domain → accept.
 *
 * Rejects LinkedIn, Crunchbase, and other directory/social sites where name-only
 * matches frequently return logos for the WRONG company.
 *
 * Returns null if no verified logo found (caller falls through to favicon).
 */
async function fetchSerpApiCompanyLogo(domain: string, companyName?: string): Promise<BrandRecord | null> {
  // Block social/directory domains
  if (SOCIAL_BRAND_DOMAINS.has(rootDomain(domain))) return null;
  const serpApiKey = Deno.env.get("SERPAPI_API_KEY");
  if (!serpApiKey) return null;
  if (!domain || domain.length < 4) return null;

  const searchName = companyName || domain.replace(/\.(com|io|co|org|net|ai|app|dev|xyz)$/, "").replace(/[.-]/g, " ");
  // Search by company name (broad) — we verify domain on the results
  const query = `"${searchName}" logo`;
  const params = new URLSearchParams({
    engine: "google_images",
    q: query,
    api_key: serpApiKey,
    num: "20",
    gl: "us",
    hl: "en",
    safe: "active",
  });

  try {
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log(`[SERPAPI-LOGO] HTTP ${res.status} for "${searchName}" (${domain})`);
      return null;
    }

    const data = await res.json();
    const images = data.images_results || [];

    // Stock/generic image patterns to skip
    const skipPatterns = [
      "shutterstock", "istockphoto", "gettyimages", "dreamstime", "stock",
      "placeholder", "icon-library", "flaticon", "freepik", "pngitem",
      "cleanpng", "pngtree", "clipartmax", "kindpng", "pikpng",
    ];

    // Directory/social sites whose logos are frequently for the WRONG company
    const rejectSourceDomains = [
      "linkedin.com", "crunchbase.com", "facebook.com", "twitter.com", "x.com",
      "instagram.com", "youtube.com", "tiktok.com", "pinterest.com",
      "glassdoor.com", "indeed.com", "yelp.com", "bbb.org",
      "zoominfo.com", "apollo.io", "pitchbook.com", "owler.com",
      "dnb.com", "hoovers.com", "manta.com", "buzzfile.com",
    ];

    // Trusted logo aggregator sources — accept if page context also references domain/name
    const trustedLogoSources = [
      "wikipedia.org", "wikimedia.org", "commons.wikimedia.org",
      "brandsoftheworld.com", "seeklogo.com", "logopedia.fandom.com",
      "worldvectorlogo.com", "logodownload.org", "1000logos.net",
      "logowik.com", "pngwing.com",
    ];

    // Domain root for matching (e.g., "iron-university.com" → "iron-university.com")
    const domainRoot = rootDomain(domain);
    // Domain name without TLD for fuzzy text matching (e.g., "iron-university")
    const domainStem = domainRoot.replace(/\.[^.]+$/, "").toLowerCase();

    const makeBrandRecord = (logoUrl: string, pass: string): BrandRecord => {
      console.log(`[SERPAPI-LOGO] ✅ ${pass} logo for ${domain}: ${logoUrl.slice(0, 120)}`);
      return {
        domain,
        logo_url: logoUrl,
        icon_url: logoUrl,
        source: "serpapi_logo",
        logo_quality: "high",
        fetched_at: Date.now(),
      };
    };

    // Candidate accumulator for pass 2 (only used if pass 1 finds nothing)
    const trustedCandidates: { original: string; link: string; title: string }[] = [];

    // ── PASS 1: Image or source page is on the company's own domain ──
    for (const img of images) {
      const link = (img.link || "").toLowerCase();
      const original = img.original || "";
      const originalLower = original.toLowerCase();
      const title = (img.title || "").toLowerCase();

      // Skip stock/generic images
      if (skipPatterns.some(p => originalLower.includes(p) || link.includes(p))) continue;
      // Skip tiny images
      if (img.original_width && img.original_width < 50) continue;
      if (img.original_height && img.original_height < 50) continue;

      const linkMatchesDomain = link.includes(domain) || link.includes(domainRoot);
      const imageMatchesDomain = originalLower.includes(domain) || originalLower.includes(domainRoot);

      // Pass 1: source page or image hosted on the company's own domain
      if (original && (linkMatchesDomain || imageMatchesDomain)) {
        return makeBrandRecord(original, "Pass1-domain");
      }

      // Collect trusted-source candidates for pass 2
      const linkHost = link.replace(/^https?:\/\//, "").split("/")[0];
      const isFromRejectSource = rejectSourceDomains.some(d => linkHost.includes(d));
      if (!isFromRejectSource && original) {
        const isFromTrustedSource = trustedLogoSources.some(d => linkHost.includes(d));
        if (isFromTrustedSource) {
          trustedCandidates.push({ original, link, title });
        }
      }
    }

    // ── PASS 2: Trusted logo aggregator sites where page references the company ──
    for (const cand of trustedCandidates) {
      // The page URL, title, or image URL should reference the company's domain or name
      const contextText = `${cand.link} ${cand.title} ${cand.original}`.toLowerCase();
      const domainMentioned = contextText.includes(domain) || contextText.includes(domainRoot) || contextText.includes(domainStem);
      const nameMentioned = searchName.length >= 3 && contextText.includes(searchName.toLowerCase());

      if (domainMentioned || nameMentioned) {
        return makeBrandRecord(cand.original, "Pass2-trusted");
      }
    }

    console.log(`[SERPAPI-LOGO] No verified logo for "${searchName}" / ${domain} (${images.length} results, ${trustedCandidates.length} trusted candidates)`);
    return null;
  } catch (err: any) {
    console.log(`[SERPAPI-LOGO] Error for "${domain}": ${err?.message}`);
    return null;
  }
}

/**
 * Logo quality gate — HEAD-check a favicon URL and reject if:
 *   1. Content-Length < 1200 bytes (generic globe ≈ 400-800B, tiny 16px upscale ≈ 600-1000B)
 *   2. Content-Type is image/x-icon or image/vnd.microsoft.icon (.ico files)
 * Returns "high" (>4KB), "medium" (1.2-4KB), "low" (<1.2KB), or "none" (error/ico).
 */
async function faviconQualityGate(url: string): Promise<"high" | "medium" | "low" | "none"> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return "none";
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("x-icon") || ct.includes("vnd.microsoft.icon")) {
      console.log(`[FAVICON-GATE] .ico content-type for ${url} — rejected`);
      return "none";
    }
    const cl = parseInt(res.headers.get("content-length") || "0", 10);
    if (cl > 0 && cl < 1200) {
      console.log(`[FAVICON-GATE] Too small (${cl}B) for ${url} — low quality`);
      return "low";
    }
    if (cl > 4000) return "high";
    if (cl > 0) return "medium";
    // No content-length header — assume medium (can't verify)
    return "medium";
  } catch {
    return "none";
  }
}

/**
 * Google Favicon fallback with quality gate.
 * Requests sz=256 for best quality, then HEAD-checks.
 * If quality is "low" or "none", returns source="not_found" so frontend shows initials.
 */
async function fetchFaviconFallback(domain: string): Promise<BrandRecord> {
  // Use DuckDuckGo favicon service — CORS-friendly, no 301 redirects
  // Google's s2/favicons causes CORS errors on the client due to cross-origin redirects to gstatic.com
  const ddgUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  const googleUrl256 = `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;
  // Quality-check using Google (server-side, no CORS), but serve DuckDuckGo URL to client
  const quality = await faviconQualityGate(googleUrl256);
  if (quality === "low" || quality === "none") {
    console.log(`[FAVICON] Quality gate FAILED for ${domain} (${quality}) — no usable favicon`);
    return {
      domain,
      source: "not_found",
      logo_quality: "none",
      fetched_at: Date.now(),
      error: `favicon_quality_${quality}`,
    };
  }
  console.log(`[FAVICON] Quality gate PASSED for ${domain} (${quality})`);
  return {
    domain,
    logo_url: ddgUrl,
    icon_url: ddgUrl,
    source: "favicon",
    logo_quality: quality,
    fetched_at: Date.now(),
  };
}

// Synchronous fallback — returns DuckDuckGo Favicon URL (CORS-friendly)
function buildFaviconRecord(domain: string): BrandRecord {
  return {
    domain,
    logo_url: `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    icon_url: `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    source: "favicon",
    logo_quality: "medium", // unverified — client will quality-check
    fetched_at: Date.now(),
  };
}

async function enrichBrand(domain: string, forceRefresh = false, companyName?: string): Promise<BrandRecord> {
  // Block social/directory domains entirely — never enrich these
  if (SOCIAL_BRAND_DOMAINS.has(rootDomain(domain))) {
    console.log(`[BRAND-ENRICH] Skipping social/directory domain: ${domain}`);
    return { domain, source: "not_found", fetched_at: Date.now(), error: "social_domain_blocked" };
  }
  const kvKey = BRAND_KV_PREFIX + domain;
  if (!forceRefresh) {
    try {
      const cached = await kv.get(kvKey);
      if (cached) {
        const record: BrandRecord = typeof cached === "string" ? JSON.parse(cached) : cached;
        const age = Date.now() - (record.fetched_at || 0);
        // If previously rejected due to mismatch, check if we have a company name now to re-evaluate
        if (age < BRAND_CACHE_TTL_MS) {
          // If cached result was a mismatch rejection but we have a new company name, let it through for re-check
          if (record.error?.startsWith("name_mismatch:") && companyName) {
            const cachedBrandName = record.error.replace("name_mismatch:", "");
            if (brandNameMatchesCompany(cachedBrandName, companyName)) {
              // Actually matches this time (different company same domain) — force re-fetch
              console.log(`[BRAND-ENRICH] Cached mismatch for "${domain}" now matches company "${companyName}" — re-fetching`);
            } else {
              return record; // still mismatched
            }
          } else {
            return record;
          }
        }
      }
    } catch {}
  }
  // Tier 1: Brandfetch (real brand assets — SVG/PNG logos, colors, icons)
  const bfResult = await fetchBrandfetch(domain, companyName);
  if (bfResult && bfResult.source !== "not_found") {
    try { await kv.set(kvKey, JSON.stringify(bfResult)); } catch {}
    return bfResult;
  }
  // Cache "not_found" from Brandfetch (including mismatch rejections) to avoid re-querying
  if (bfResult && bfResult.source === "not_found") {
    try { await kv.set(kvKey, JSON.stringify(bfResult)); } catch {}
  }
  // Tier 2: Clearbit Logo API (high-quality 128px PNG, free, no API key)
  const cbResult = await fetchClearbit(domain);
  if (cbResult && cbResult.logo_url) {
    try { await kv.set(kvKey, JSON.stringify(cbResult)); } catch {}
    return cbResult;
  }
  // Tier 3: SerpAPI Google Images — find logo from LinkedIn, Crunchbase, etc.
  const serpResult = await fetchSerpApiCompanyLogo(domain, companyName);
  if (serpResult && serpResult.logo_url) {
    try { await kv.set(kvKey, JSON.stringify(serpResult)); } catch {}
    return serpResult;
  }
  // Tier 4: Google Favicon fallback (sz=128)
  const favResult = await fetchFaviconFallback(domain);
  try { await kv.set(kvKey, JSON.stringify(favResult)); } catch {}
  return favResult;
}

// ── POST /brand-enrich — Single domain ──
app.post("/brand-enrich", async (c) => {
  try {
    const body = await c.req.json();
    const domain = normalizeDomain(body.domain || "");
    if (!domain) return c.json({ error: "domain is required" }, 400);
    const result = await enrichBrand(domain, !!body.force_refresh, body.company_name);
    return c.json({ brand: result });
  } catch (error: any) {
    console.error("[BRAND-ENRICH] Error:", error);
    return c.json({ error: "Brand enrichment failed", message: error?.message }, 500);
  }
});

// ── POST /brand-enrich-batch — Batch enrich multiple domains ──
app.post("/brand-enrich-batch", async (c) => {
  try {
    const body = await c.req.json();
    const domains: string[] = (body.domains || []).map((d: string) => normalizeDomain(d)).filter(Boolean);
    // Optional: map of domain → company name for SerpAPI logo search
    const domainNames: Record<string, string> = body.domain_names || {};
    if (domains.length === 0) return c.json({ brands: {} });
    const unique = [...new Set(domains)];
    const results: Record<string, BrandRecord> = {};
    const uncached: string[] = [];
    const kvKeys = unique.map(d => BRAND_KV_PREFIX + d);
    try {
      const cached = await kv.mget(kvKeys);
      for (let i = 0; i < unique.length; i++) {
        const raw = cached[i];
        if (raw) {
          const record: BrandRecord = typeof raw === "string" ? JSON.parse(raw) : raw;
          const age = Date.now() - (record.fetched_at || 0);
          if (age < BRAND_CACHE_TTL_MS) {
            results[unique[i]] = record;
            continue;
          }
        }
        uncached.push(unique[i]);
      }
    } catch {
      uncached.push(...unique.filter(d => !results[d]));
    }
    const BATCH_SIZE = 5;
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(d => enrichBrand(d, !!body.force_refresh, domainNames[d]))
      );
      for (let j = 0; j < batch.length; j++) {
        const r = batchResults[j];
        if (r.status === "fulfilled") {
          results[batch[j]] = r.value;
        } else {
          results[batch[j]] = buildFaviconRecord(batch[j]);
        }
      }
    }
    return c.json({ brands: results });
  } catch (error: any) {
    console.error("[BRAND-ENRICH-BATCH] Error:", error);
    return c.json({ error: "Batch brand enrichment failed", message: error?.message }, 500);
  }
});

// ── POST /brand-migrate-favicons — One-time migration job ──
// Re-enriches all KV brand entries where source='favicon' or logo_quality is missing/low.
// Skips tiers 1-3 cache (force_refresh=true) so Brandfetch/Clearbit/SerpAPI are retried.
// Processes in batches to avoid timeouts. Pass { cursor, limit } for pagination.
app.post("/brand-migrate-favicons", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(body.limit || 50, 200);
    const cursor = body.cursor || "";
    const dryRun = !!body.dry_run;

    // Scan all brandfetch:v3:* keys
    const allEntries = await kv.getByPrefix(BRAND_KV_PREFIX);
    if (!allEntries || allEntries.length === 0) {
      return c.json({ message: "No brand entries found", migrated: 0, total: 0 });
    }

    // Filter entries that need re-enrichment
    const needsMigration: { domain: string; record: BrandRecord }[] = [];
    for (const entry of allEntries) {
      if (!entry?.value) continue;
      const record: BrandRecord = typeof entry.value === "string" ? JSON.parse(entry.value) : entry.value;
      const domain = record.domain || entry.key?.replace(BRAND_KV_PREFIX, "") || "";
      if (!domain) continue;

      const isFavicon = record.source === "favicon";
      const isNotFound = record.source === "not_found";
      const isLowQuality = record.logo_quality === "low" || record.logo_quality === "none";
      const hasNoQualityField = !record.logo_quality && record.source === "favicon";

      if (isFavicon || isNotFound || isLowQuality || hasNoQualityField) {
        if (cursor && domain < cursor) continue; // pagination
        needsMigration.push({ domain, record });
      }
    }

    // Sort for consistent pagination
    needsMigration.sort((a, b) => a.domain.localeCompare(b.domain));
    const batch = needsMigration.slice(0, limit);
    const nextCursor = batch.length === limit && needsMigration.length > limit
      ? needsMigration[limit]?.domain || null
      : null;

    if (dryRun) {
      return c.json({
        message: "Dry run — no changes made",
        total_needing_migration: needsMigration.length,
        batch_size: batch.length,
        next_cursor: nextCursor,
        domains: batch.map(b => ({ domain: b.domain, old_source: b.record.source, old_quality: b.record.logo_quality })),
      });
    }

    // Re-enrich each domain (skip favicon cache → force_refresh=true)
    const results: { domain: string; old_source: string; new_source: string; new_quality: string }[] = [];
    const MIGRATE_BATCH = 3; // 3 concurrent to avoid rate limits
    for (let i = 0; i < batch.length; i += MIGRATE_BATCH) {
      const chunk = batch.slice(i, i + MIGRATE_BATCH);
      const enrichResults = await Promise.allSettled(
        chunk.map(({ domain }) => enrichBrand(domain, true))
      );
      for (let j = 0; j < chunk.length; j++) {
        const r = enrichResults[j];
        const old = chunk[j];
        if (r.status === "fulfilled") {
          results.push({
            domain: old.domain,
            old_source: old.record.source,
            new_source: r.value.source,
            new_quality: r.value.logo_quality || "unknown",
          });
        } else {
          results.push({
            domain: old.domain,
            old_source: old.record.source,
            new_source: "error",
            new_quality: "none",
          });
        }
      }
    }

    const upgraded = results.filter(r => r.new_source !== "favicon" && r.new_source !== "not_found" && r.new_source !== "error").length;
    console.log(`[BRAND-MIGRATE] Processed ${results.length} domains, ${upgraded} upgraded to higher quality`);

    return c.json({
      message: `Migration batch complete: ${upgraded}/${results.length} upgraded`,
      total_needing_migration: needsMigration.length,
      processed: results.length,
      upgraded,
      next_cursor: nextCursor,
      results,
    });
  } catch (error: any) {
    console.error("[BRAND-MIGRATE] Error:", error);
    return c.json({ error: "Migration failed", message: error?.message }, 500);
  }
});

export default app;
