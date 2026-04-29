/**
 * Lead Pool — Global Discovery Database
 *
 * Stores every enriched lead from Smart Discovery searches in a shared pool.
 * On subsequent searches, the pool is queried FIRST to surface known leads
 * before burning external API credits (Apollo, Hunter, Findymail).
 *
 * KV Schema:
 *   dp:{email_lower}                      → full ApolloLead-format object + metadata
 *   dpx:domain:{domain}                   → string[] of emails at that domain
 *   dpx:industry:{industry_lower}         → string[] of emails in that industry
 *   dpx:location:{city_lower}             → string[] of emails in that city
 *   dpx:seniority:{seniority}             → string[] of emails with that seniority
 *   dpx:title_kw:{keyword}               → string[] of emails with that title keyword
 *   dpx:emp:{range}                       → string[] of emails with that employee range
 *   dp_meta                               → { total: number, last_updated: string }
 *
 * Also queries the Supabase `leads` table (across ALL users) as a secondary pool.
 */

import * as kv from "./kv-retry.tsx";
import { createClient } from "npm:@supabase/supabase-js@2";

// ── Types ────────────────────────────────────────────────────────────

export interface PoolLead {
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
  email_verification?: any;
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
  _pool_source?: string;         // "kv_pool" | "leads_table"
  _pool_saved_at?: string;       // ISO timestamp
  _enrichment_source?: string;
}

export interface SearchCriteria {
  person_titles?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  person_seniorities?: string[];
  organization_num_employees_ranges?: string[];
  organization_industries?: string[];
  q_keywords?: string;
  q_organization_domains?: string[];
  max_results?: number;
}

// ── Admin client ─────────────────────────────────────────────────────

let _adminClient: any = null;
function adminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
  }
  return _adminClient;
}

// ── Title keyword extraction ─────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","and","as","at","but","by","for","if","in","nor","of","on","or",
  "so","the","to","up","yet","via","is","it","its","my","our","we","am",
]);

function extractTitleKeywords(title: string): string[] {
  if (!title) return [];
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// ── Employee range matching ──────────────────────────────────────────

function getEmployeeRangeBucket(num: number): string {
  if (num <= 10) return "1,10";
  if (num <= 20) return "11,20";
  if (num <= 50) return "21,50";
  if (num <= 100) return "51,100";
  if (num <= 200) return "101,200";
  if (num <= 500) return "201,500";
  if (num <= 1000) return "501,1000";
  if (num <= 2000) return "1001,2000";
  if (num <= 5000) return "2001,5000";
  if (num <= 10000) return "5001,10000";
  return "10001,";
}

// ── Normalize domain from URL ────────────────────────────────────────

function extractDomain(url: string): string {
  if (!url) return "";
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\/.*/, "")
    .replace(/^www\./, "")
    .toLowerCase()
    .trim();
}

// ── Parse KV array value safely ──────────────────────────────────────

function parseKvArray(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  if (raw?.value) return parseKvArray(raw.value);
  return [];
}

function parseKvObject(raw: any): any {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.value) return parseKvObject(raw.value);
    return raw;
  }
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

// ── MAX index size to prevent KV values from growing unbounded ───────

const MAX_INDEX_SIZE = 500; // Reduced from 15000 to prevent KV memory exhaustion

// ══════════════════════════════════════════════════════════════════════
// SAVE TO POOL
// ══════════════════════════════════════════════════════════════════════

/**
 * Save an array of enriched leads to the discovery pool.
 * Creates/updates the primary record and updates all search indexes.
 */
export async function saveToPool(leads: PoolLead[]): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  // Batch into groups of 20 to avoid overwhelming KV
  const BATCH = 20;

  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    const promises: Promise<void>[] = [];

    for (const lead of batch) {
      if (!lead.email) {
        skipped++;
        continue;
      }

      const emailKey = lead.email.toLowerCase().trim();
      if (!emailKey) {
        skipped++;
        continue;
      }

      promises.push(
        (async () => {
          try {
            // Check if already exists (skip if so — don't overwrite with potentially less data)
            const existing = parseKvObject(await kv.get(`dp:${emailKey}`));
            if (existing && existing.email) {
              // Update only if new data has more fields filled (merge strategy)
              const newHasMore =
                (!existing.phone_numbers?.length && lead.phone_numbers?.length > 0) ||
                (!existing.email_verification && lead.email_verification) ||
                (!existing.linkedin_url && lead.linkedin_url) ||
                (!existing.organization?.estimated_num_employees && lead.organization?.estimated_num_employees > 0) ||
                (!existing.organization?.annual_revenue_printed && lead.organization?.annual_revenue_printed) ||
                (!existing.organization?.founded_year && lead.organization?.founded_year > 0) ||
                (!existing.organization?.industry && lead.organization?.industry);
              if (!newHasMore) {
                skipped++;
                return;
              }
              // Merge — keep existing fields, add new ones
              const merged = { ...existing };
              if (lead.phone_numbers?.length > 0 && !merged.phone_numbers?.length)
                merged.phone_numbers = lead.phone_numbers;
              if (lead.email_verification && !merged.email_verification)
                merged.email_verification = lead.email_verification;
              if (lead.linkedin_url && !merged.linkedin_url)
                merged.linkedin_url = lead.linkedin_url;
              if (lead.title && !merged.title) merged.title = lead.title;
              if (lead.seniority && !merged.seniority) merged.seniority = lead.seniority;
              // Merge organization data — fill in missing fields
              if (lead.organization && merged.organization) {
                if (lead.organization.estimated_num_employees > 0 && !merged.organization.estimated_num_employees)
                  merged.organization.estimated_num_employees = lead.organization.estimated_num_employees;
                if (lead.organization.annual_revenue_printed && !merged.organization.annual_revenue_printed)
                  merged.organization.annual_revenue_printed = lead.organization.annual_revenue_printed;
                if (lead.organization.founded_year > 0 && !merged.organization.founded_year)
                  merged.organization.founded_year = lead.organization.founded_year;
                if (lead.organization.industry && !merged.organization.industry)
                  merged.organization.industry = lead.organization.industry;
                if (lead.organization.website_url && !merged.organization.website_url)
                  merged.organization.website_url = lead.organization.website_url;
                if (lead.organization.linkedin_url && !merged.organization.linkedin_url)
                  merged.organization.linkedin_url = lead.organization.linkedin_url;
                if (lead.organization.short_description && !merged.organization.short_description)
                  merged.organization.short_description = lead.organization.short_description;
                if (lead.organization.phone && !merged.organization.phone)
                  merged.organization.phone = lead.organization.phone;
              } else if (lead.organization && !merged.organization) {
                merged.organization = lead.organization;
              }
              merged._pool_saved_at = new Date().toISOString();
              await kv.set(`dp:${emailKey}`, merged);
              saved++;
              return;
            }

            // Save lead data
            const poolLead = {
              ...lead,
              _pool_source: "kv_pool",
              _pool_saved_at: new Date().toISOString(),
            };
            await kv.set(`dp:${emailKey}`, poolLead);

            // Update indexes (fire and forget for speed — these are best-effort)
            const indexUpdates: Promise<void>[] = [];

            // Domain index
            const domain = extractDomain(lead.organization?.website_url || "");
            if (domain) indexUpdates.push(appendToIndex(`dpx:domain:${domain}`, emailKey));

            // Industry index
            const industry = (lead.organization?.industry || "").toLowerCase().trim();
            if (industry) indexUpdates.push(appendToIndex(`dpx:industry:${industry}`, emailKey));

            // Location indexes (city)
            const city = (lead.city || lead.organization?.city || "").toLowerCase().trim();
            if (city) indexUpdates.push(appendToIndex(`dpx:location:${city}`, emailKey));

            // State-level location
            const state = (lead.state || lead.organization?.state || "").toLowerCase().trim();
            if (state) indexUpdates.push(appendToIndex(`dpx:location:${state}`, emailKey));

            // Country location
            const country = (lead.country || lead.organization?.country || "").toLowerCase().trim();
            if (country) indexUpdates.push(appendToIndex(`dpx:location:${country}`, emailKey));

            // Seniority index
            if (lead.seniority) {
              indexUpdates.push(appendToIndex(`dpx:seniority:${lead.seniority.toLowerCase()}`, emailKey));
            }

            // Title keyword indexes
            const titleKws = extractTitleKeywords(lead.title);
            for (const kw of titleKws.slice(0, 5)) {
              indexUpdates.push(appendToIndex(`dpx:title_kw:${kw}`, emailKey));
            }

            // Employee range index
            const empCount = lead.organization?.estimated_num_employees;
            if (empCount && empCount > 0) {
              const bucket = getEmployeeRangeBucket(empCount);
              indexUpdates.push(appendToIndex(`dpx:emp:${bucket}`, emailKey));
            }

            await Promise.allSettled(indexUpdates);
            saved++;
          } catch (err: any) {
            // If DB memory is full, stop trying to save more leads
            if (err?.message?.includes('memory full') || err?.message?.includes('shared memory')) {
              console.warn(`[LEAD POOL] Database memory full — stopping pool saves. Run /admin/kv-gc to free space.`);
              skipped++;
              return;
            }
            console.warn(`[LEAD POOL] Error saving ${lead.email}: ${err.message}`);
            skipped++;
          }
        })()
      );
    }

    await Promise.allSettled(promises);
  }

  // Update meta (fire and forget)
  updatePoolMeta(saved).catch(() => {});

  console.log(`[LEAD POOL] Saved ${saved} leads to pool, skipped ${skipped}`);
  return { saved, skipped };
}

async function appendToIndex(indexKey: string, email: string): Promise<void> {
  try {
    const existing = parseKvArray(await kv.get(indexKey));
    if (existing.includes(email)) return;
    if (existing.length >= MAX_INDEX_SIZE) return; // Cap index size
    existing.push(email);
    await kv.set(indexKey, existing);
  } catch (err: any) {
    // If DB memory is full, skip index writes silently — they're non-critical cache
    if (err?.message?.includes('memory full') || err?.message?.includes('shared memory')) {
      return;
    }
    // First entry
    try {
      await kv.set(indexKey, [email]);
    } catch {}
  }
}

async function updatePoolMeta(addedCount: number): Promise<void> {
  try {
    const existing = parseKvObject(await kv.get("dp_meta")) || { total: 0 };
    existing.total = (existing.total || 0) + addedCount;
    existing.last_updated = new Date().toISOString();
    await kv.set("dp_meta", existing);
  } catch {
    await kv.set("dp_meta", { total: addedCount, last_updated: new Date().toISOString() });
  }
}

// ══════════════════════════════════════════════════════════════════════
// SEARCH POOL
// ══════════════════════════════════════════════════════════════════════

/**
 * Search the discovery pool (KV) and the leads table for matching leads.
 * Returns de-duplicated leads in ApolloLead format.
 */
export async function searchPool(
  criteria: SearchCriteria,
  excludeEmails?: Set<string>,
  maxResults = 2000,
): Promise<{ leads: PoolLead[]; kvMatches: number; dbMatches: number; totalPoolSize: number }> {
  const t0 = Date.now();
  try {
    console.log(`[LEAD POOL] Searching pool with criteria:`, JSON.stringify(criteria));

    const [kvResults, dbResults, meta] = await Promise.allSettled([
      searchKvPool(criteria, maxResults),
      searchLeadsTable(criteria, maxResults),
      kv.get("dp_meta"),
    ]);

    const kvLeads = kvResults.status === "fulfilled" ? kvResults.value : [];
    const dbLeads = dbResults.status === "fulfilled" ? dbResults.value : [];
    const poolMeta = meta.status === "fulfilled" ? parseKvObject(meta.value) : null;

    // Log any internal failures for debugging
    if (kvResults.status === "rejected") console.warn(`[LEAD POOL] KV search failed: ${kvResults.reason}`);
    if (dbResults.status === "rejected") console.warn(`[LEAD POOL] DB search failed: ${dbResults.reason}`);

    // Merge and deduplicate by email
    const seen = new Set<string>(excludeEmails || []);
    const merged: PoolLead[] = [];

    // KV pool results first (higher quality — already enriched)
    for (const lead of kvLeads) {
      const email = (lead.email || "").toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      lead._pool_source = "kv_pool";
      merged.push(lead);
      if (merged.length >= maxResults) break;
    }

    // Then DB results
    for (const lead of dbLeads) {
      const email = (lead.email || "").toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      lead._pool_source = "leads_table";
      merged.push(lead);
      if (merged.length >= maxResults) break;
    }

    const elapsed = Date.now() - t0;
    console.log(
      `[LEAD POOL] Search complete in ${elapsed}ms: ${kvLeads.length} KV matches + ${dbLeads.length} DB matches → ${merged.length} unique (pool size: ${poolMeta?.total || "unknown"})`
    );

    return {
      leads: merged,
      kvMatches: kvLeads.length,
      dbMatches: dbLeads.length,
      totalPoolSize: poolMeta?.total || 0,
    };
  } catch (err: any) {
    console.error(`[LEAD POOL] Critical pool search error: ${err.message}`);
    return { leads: [], kvMatches: 0, dbMatches: 0, totalPoolSize: 0 };
  }
}

// ── KV Pool Search ───────────────────────────────────────────────────

async function searchKvPool(criteria: SearchCriteria, maxResults: number): Promise<PoolLead[]> {
  // Build index queries based on criteria
  const indexQueries: string[] = [];

  // ── Track which indexes are "industry" queries so we can weight them ──
  const industryIndexKeys = new Set<string>();

  // Log search criteria
  console.log(`[LEAD POOL KV] Search criteria: industries=${criteria.organization_industries?.join(', ') || 'none'}, keywords=${criteria.q_keywords || 'none'}, seniorities=${criteria.person_seniorities?.join(', ') || 'none'}`);

  // Domain index — most specific
  if (criteria.q_organization_domains?.length) {
    for (const domain of criteria.q_organization_domains) {
      const d = domain.toLowerCase().replace(/^www\./, "").trim();
      if (d) indexQueries.push(`dpx:domain:${d}`);
    }
  }

  // Seniority index
  if (criteria.person_seniorities?.length) {
    for (const sen of criteria.person_seniorities) {
      indexQueries.push(`dpx:seniority:${sen.toLowerCase()}`);
    }
  }

  // Title keyword indexes
  if (criteria.person_titles?.length) {
    for (const title of criteria.person_titles) {
      const kws = extractTitleKeywords(title);
      for (const kw of kws.slice(0, 3)) {
        indexQueries.push(`dpx:title_kw:${kw}`);
      }
    }
  }

  // Location indexes
  const locations = [
    ...(criteria.person_locations || []),
    ...(criteria.organization_locations || []),
  ];
  for (const loc of locations) {
    const parts = loc
      .toLowerCase()
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      indexQueries.push(`dpx:location:${part}`);
    }
  }

  // Employee range index
  if (criteria.organization_num_employees_ranges?.length) {
    for (const range of criteria.organization_num_employees_ranges) {
      indexQueries.push(`dpx:emp:${range}`);
    }
  }

  // ══════ CRITICAL: Explicit industry filter (from dropdown selection) ══════
  // This is the PRIMARY search dimension when industries are selected.
  // We MUST prioritize these indexes above all others.
  if (criteria.organization_industries?.length) {
    console.log(`[LEAD POOL KV] Building industry indexes for: ${criteria.organization_industries.join(', ')}`);
    for (const ind of criteria.organization_industries) {
      const normalized = ind.toLowerCase().trim();
      const iKey = `dpx:industry:${normalized}`;
      indexQueries.push(iKey);
      industryIndexKeys.add(iKey);
      console.log(`[LEAD POOL KV] Added industry index key: ${iKey}`);
    }
  }

  // Industry from keywords (best-effort — keywords might match industry)
  if (criteria.q_keywords) {
    const kws = criteria.q_keywords
      .toLowerCase()
      .split(/[,\s]+/)
      .filter((w) => w.length > 2);
    for (const kw of kws.slice(0, 3)) {
      const iKey = `dpx:industry:${kw}`;
      indexQueries.push(iKey);
      industryIndexKeys.add(iKey);
      indexQueries.push(`dpx:title_kw:${kw}`);
    }
  }

  if (indexQueries.length === 0) {
    console.log("[LEAD POOL KV] No index queries generated from criteria");
    return [];
  }

  // Fetch all matching indexes
  console.log(`[LEAD POOL KV] Querying ${indexQueries.length} indexes (${industryIndexKeys.size} industry-specific)`);
  const indexResults = await Promise.allSettled(
    indexQueries.map((key) => kv.get(key))
  );

  // Collect all candidate emails with scoring (more index hits = better match)
  // Industry index hits get a 5× bonus (increased from 3×) so they dominate location-only matches
  const emailScores = new Map<string, number>();
  const industryEmails = new Set<string>(); // Track emails that came from industry indexes

  for (let idx = 0; idx < indexResults.length; idx++) {
    const result = indexResults[idx];
    const indexKey = indexQueries[idx];
    
    if (result.status !== "fulfilled") {
      console.warn(`[LEAD POOL KV] Index query failed: ${indexKey}`);
      continue;
    }
    
    const emails = parseKvArray(result.value);
    const isIndustryIndex = industryIndexKeys.has(indexKey);
    const weight = isIndustryIndex ? 5 : 1; // Industry matches get 5× weight
    
    if (emails.length > 0) {
      console.log(`[LEAD POOL KV] Index "${indexKey}" returned ${emails.length} emails (weight: ${weight}×)`);
    }
    
    for (const email of emails) {
      emailScores.set(email, (emailScores.get(email) || 0) + weight);
      if (isIndustryIndex) industryEmails.add(email);
    }
  }

  if (emailScores.size === 0) {
    console.log("[LEAD POOL KV] No candidates found in indexes");
    return [];
  }

  // Sort by score (most index hits first) and take top candidates
  // For large requests, fetch proportionally more to account for post-fetch filtering
  const candidateCap = Math.max(maxResults * 3, 3000);
  const sortedEmails = [...emailScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, candidateCap)
    .map(([email]) => email);

  console.log(`[LEAD POOL KV] Found ${emailScores.size} candidates (${industryEmails.size} from industry indexes), fetching top ${sortedEmails.length}`);

  // Fetch actual lead data in batches — use larger batches for large requests
  const allFetched: PoolLead[] = [];
  const FETCH_BATCH = maxResults > 500 ? 100 : 50;
  for (let i = 0; i < sortedEmails.length; i += FETCH_BATCH) {
    const batch = sortedEmails.slice(i, i + FETCH_BATCH);
    const keys = batch.map((e) => `dp:${e}`);
    try {
      const results = await kv.mget(keys);
      for (const raw of results) {
        const lead = parseKvObject(raw);
        if (lead && lead.email) {
          // Quality gate: require real name and company
          const name = (lead.name || "").trim();
          const companyName = (lead.organization?.name || "").trim();
          if (name.length >= 3 && name !== "—" && name !== "-" &&
              companyName.length >= 2 && companyName !== "—" && companyName !== "-") {
            allFetched.push(lead as PoolLead);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[LEAD POOL KV] mget error: ${err.message}`);
    }
  }

  // ── Post-fetch filtering ──
  let results = allFetched;

  // Strict industry filter: when explicit industries are selected, ONLY keep leads that match
  if (criteria.organization_industries?.length) {
    const selectedIndustries = criteria.organization_industries.map(i => i.toLowerCase().trim());
    const industryFiltered: PoolLead[] = [];
    for (const lead of results) {
      const leadIndustry = (lead.organization?.industry || "").toLowerCase().trim();
      if (!leadIndustry) continue; // No industry = skip
      let matched = false;
      for (const sel of selectedIndustries) {
        if (leadIndustry === sel) { matched = true; break; }
        if (leadIndustry.includes(sel)) { matched = true; break; }
        if (sel.includes(leadIndustry) && leadIndustry.length >= 4) { matched = true; break; }
        // Word-boundary match for compound industries
        const leadWords = leadIndustry.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
        const selWords = sel.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
        for (const lw of leadWords) {
          for (const sw of selWords) {
            if (lw === sw || (lw.includes(sw) && sw.length >= 4) || (sw.includes(lw) && lw.length >= 4)) {
              matched = true; break;
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
      if (matched) industryFiltered.push(lead);
    }
    console.log(`[LEAD POOL KV] Industry filter [${criteria.organization_industries.join(', ')}]: ${results.length} → ${industryFiltered.length} leads`);
    results = industryFiltered;
  }

  // ══════ STRICT LOCATION FILTER ══════
  // When locations are specified, REQUIRE every lead to match at least one searched location.
  // Each location string is split by comma into parts (e.g. "New York, NY" → ["new york", "ny"])
  // and ALL parts must appear in the lead's city/state/country fields.
  const searchLocations = [
    ...(criteria.person_locations || []),
    ...(criteria.organization_locations || []),
  ];
  if (searchLocations.length > 0) {
    const beforeCount = results.length;
    const locationFiltered: PoolLead[] = [];
    for (const lead of results) {
      const leadCity = (lead.city || lead.organization?.city || "").toLowerCase().trim();
      const leadState = (lead.state || lead.organization?.state || "").toLowerCase().trim();
      const leadCountry = (lead.country || lead.organization?.country || "").toLowerCase().trim();

      // Lead must match at least ONE of the searched locations
      let matchedAnyLocation = false;
      for (const loc of searchLocations) {
        const parts = loc.toLowerCase().split(",").map((p: string) => p.trim()).filter(Boolean);
        if (parts.length === 0) continue;

        // ALL parts of this location must match somewhere in the lead's location fields
        const allPartsMatch = parts.every((part: string) => {
          if (part.length < 2) return true; // skip trivially short parts
          return leadCity.includes(part) || leadState.includes(part) || leadCountry.includes(part);
        });

        if (allPartsMatch) {
          matchedAnyLocation = true;
          break;
        }
      }

      if (matchedAnyLocation) {
        locationFiltered.push(lead);
      }
    }
    console.log(`[LEAD POOL KV] Strict location filter [${searchLocations.join('; ')}]: ${beforeCount} → ${locationFiltered.length} leads`);
    results = locationFiltered;
  }

  // Keyword filter: when keywords are specified, require keyword match
  const kwLower = (criteria.q_keywords || "").toLowerCase().trim();
  if (kwLower) {
    const filtered: PoolLead[] = [];
    for (const lead of results) {
      const industry = (lead.organization?.industry || "").toLowerCase();
      const orgName = (lead.organization?.name || "").toLowerCase();
      const title = (lead.title || "").toLowerCase();
      if (industry.includes(kwLower) || orgName.includes(kwLower) || title.includes(kwLower)) {
        filtered.push(lead);
        if (filtered.length >= maxResults) break;
      }
    }
    console.log(`[LEAD POOL KV] Keyword filter "${kwLower}": ${results.length} → ${filtered.length} leads`);
    return filtered;
  }

  return results.slice(0, maxResults);
}

// ── Supabase Leads Table Search ──────────────────────────────────────

// Sanitize strings for use in Supabase PostgREST .or() filters
function sanitizeForFilter(s: string): string {
  return s.replace(/[%_\\().,'"]/g, "").trim();
}

function sanitizeDomainForFilter(s: string): string {
  return s.replace(/[^a-z0-9.-]/gi, "").trim();
}

function normalizeLookupText(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompanyLookup(s: string | null | undefined): string {
  return normalizeLookupText(s)
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|pa|lp|llp)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLinkedinUrl(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim();
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function hasUsefulLeadEmail(email: string | null | undefined): boolean {
  const e = (email || "").trim();
  return !!e && e.includes("@") && !e.toLowerCase().startsWith("info@") && !e.toLowerCase().startsWith("contact@");
}

/**
 * Hydrate newly discovered candidates with emails/phones already stored in the
 * CRM lead table. This is intentionally batched by name/domain/company/LinkedIn
 * so People Finder can reuse first-party data without one Supabase query per row.
 */
export async function hydrateLeadsFromExistingContacts<T extends any>(
  leads: T[],
): Promise<{ hydrated: number; candidates: number; rowsScanned: number }> {
  const candidates = leads.filter((lead: any) => {
    if (hasUsefulLeadEmail(lead?.email)) return false;
    const first = normalizeLookupText(lead?.first_name);
    const last = normalizeLookupText(lead?.last_name);
    return !!first && !!last;
  });

  if (candidates.length === 0) {
    return { hydrated: 0, candidates: 0, rowsScanned: 0 };
  }

  const sb = adminClient();
  const SELECT_COLS = "id, contact_name, email, phone, website, city, state, country, category, business_name, employees, annual_revenue, notes, person_linkedin_url, linkedin, source, created_at, job_title";

  const names = [...new Set(candidates.map((lead: any) => normalizeLookupText(lead?.name || `${lead?.first_name || ""} ${lead?.last_name || ""}`)).filter(Boolean))];
  const domains = [...new Set(candidates.map((lead: any) => extractDomain(lead?.organization?.website_url || "")).filter(Boolean))];
  const companies = [...new Set(candidates.map((lead: any) => normalizeCompanyLookup(lead?.organization?.name || "")).filter(c => c.length >= 3))];
  const linkedins = [...new Set(candidates.map((lead: any) => normalizeLinkedinUrl(lead?.linkedin_url || "")).filter(Boolean))];

  const rowsById = new Map<string, any>();
  const addRows = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      if (!row?.id || !hasUsefulLeadEmail(row.email)) continue;
      rowsById.set(row.id, row);
    }
  };

  for (const chunk of chunkArray(names, 20)) {
    const parts = chunk.flatMap((name) => {
      const words = name.split(" ").map(sanitizeForFilter).filter(w => w.length >= 2).slice(0, 3);
      if (words.length < 2) return [];
      return [`contact_name.ilike.%${words.join("%")}%`];
    });
    if (parts.length === 0) continue;
    const { data, error } = await sb.from("leads").select(SELECT_COLS)
      .or(parts.join(","))
      .not("email", "is", null).neq("email", "")
      .limit(1000)
      .order("created_at", { ascending: false });
    if (error) console.warn(`[LEAD POOL DB] Existing-contact name hydration error: ${error.message}`);
    else addRows(data);
  }

  for (const chunk of chunkArray(domains, 20)) {
    const parts = chunk.flatMap((domain) => {
      const d = sanitizeDomainForFilter(domain.toLowerCase());
      return d.length >= 3 ? [`website.ilike.%${d}%`, `email.ilike.%@${d}`] : [];
    });
    if (parts.length === 0) continue;
    const { data, error } = await sb.from("leads").select(SELECT_COLS)
      .or(parts.join(","))
      .not("email", "is", null).neq("email", "")
      .limit(2000)
      .order("created_at", { ascending: false });
    if (error) console.warn(`[LEAD POOL DB] Existing-contact domain hydration error: ${error.message}`);
    else addRows(data);
  }

  for (const chunk of chunkArray(companies, 20)) {
    const parts = chunk.map((company) => `business_name.ilike.%${sanitizeForFilter(company)}%`);
    if (parts.length === 0) continue;
    const { data, error } = await sb.from("leads").select(SELECT_COLS)
      .or(parts.join(","))
      .not("email", "is", null).neq("email", "")
      .limit(1000)
      .order("created_at", { ascending: false });
    if (error) console.warn(`[LEAD POOL DB] Existing-contact company hydration error: ${error.message}`);
    else addRows(data);
  }

  for (const chunk of chunkArray(linkedins, 20)) {
    const parts = chunk.flatMap((url) => {
      const safe = sanitizeForFilter(url.replace(/^linkedin\.com\//, ""));
      return safe ? [`person_linkedin_url.ilike.%${safe}%`, `linkedin.ilike.%${safe}%`] : [];
    });
    if (parts.length === 0) continue;
    const { data, error } = await sb.from("leads").select(SELECT_COLS)
      .or(parts.join(","))
      .not("email", "is", null).neq("email", "")
      .limit(500)
      .order("created_at", { ascending: false });
    if (error) console.warn(`[LEAD POOL DB] Existing-contact LinkedIn hydration error: ${error.message}`);
    else addRows(data);
  }

  const rows = [...rowsById.values()];
  let hydrated = 0;

  for (const lead of candidates as any[]) {
    const leadName = normalizeLookupText(lead?.name || `${lead?.first_name || ""} ${lead?.last_name || ""}`);
    const leadDomain = extractDomain(lead?.organization?.website_url || "");
    const leadCompany = normalizeCompanyLookup(lead?.organization?.name || "");
    const leadLinkedin = normalizeLinkedinUrl(lead?.linkedin_url || "");

    let best: any = null;
    for (const row of rows) {
      const rowName = normalizeLookupText(row.contact_name);
      const rowDomain = extractDomain(row.website || row.email?.split("@")[1] || "");
      const rowCompany = normalizeCompanyLookup(row.business_name || "");
      const rowLinkedin = normalizeLinkedinUrl(row.person_linkedin_url || row.linkedin || "");

      const linkedinMatch = !!leadLinkedin && !!rowLinkedin && (leadLinkedin === rowLinkedin || rowLinkedin.includes(leadLinkedin) || leadLinkedin.includes(rowLinkedin));
      const nameMatch = !!leadName && !!rowName && leadName === rowName;
      const domainMatch = !!leadDomain && !!rowDomain && leadDomain === rowDomain;
      const companyMatch = !!leadCompany && !!rowCompany && (leadCompany === rowCompany || leadCompany.includes(rowCompany) || rowCompany.includes(leadCompany));

      if (linkedinMatch || (nameMatch && (domainMatch || companyMatch))) {
        best = row;
        break;
      }
    }

    if (!best || !hasUsefulLeadEmail(best.email)) continue;

    const pooled = transformDbLeadToPool(best);
    lead.email = pooled.email;
    lead.email_status = pooled.email_status || "verified";
    lead.email_verification = lead.email_verification || { status: "valid", mx_valid: true, source: "crm_existing" };
    lead._enrichment_source = "crm_existing";
    if (!lead.linkedin_url && pooled.linkedin_url) lead.linkedin_url = pooled.linkedin_url;
    if ((!lead.phone_numbers || lead.phone_numbers.length === 0) && pooled.phone_numbers?.length) lead.phone_numbers = pooled.phone_numbers;
    if (!lead.title && pooled.title) lead.title = pooled.title;
    if (!lead.seniority && pooled.seniority) lead.seniority = pooled.seniority;
    if (lead.organization && pooled.organization) {
      if (!lead.organization.name && pooled.organization.name) lead.organization.name = pooled.organization.name;
      if (!lead.organization.website_url && pooled.organization.website_url) lead.organization.website_url = pooled.organization.website_url;
      if (!lead.organization.industry && pooled.organization.industry) lead.organization.industry = pooled.organization.industry;
      if (!lead.organization.estimated_num_employees && pooled.organization.estimated_num_employees) lead.organization.estimated_num_employees = pooled.organization.estimated_num_employees;
      if (!lead.organization.annual_revenue_printed && pooled.organization.annual_revenue_printed) lead.organization.annual_revenue_printed = pooled.organization.annual_revenue_printed;
    }
    hydrated++;
  }

  console.log(`[LEAD POOL DB] Existing-contact hydration: ${hydrated}/${candidates.length} candidates hydrated from ${rows.length} scanned CRM rows`);
  return { hydrated, candidates: candidates.length, rowsScanned: rows.length };
}

async function searchLeadsTable(criteria: SearchCriteria, maxResults: number): Promise<PoolLead[]> {
  try {
    // Skip DB search if no criteria provided (would return random leads)
    const hasCriteria = (criteria.person_titles?.length || 0) +
      (criteria.person_locations?.length || 0) +
      (criteria.organization_locations?.length || 0) +
      (criteria.q_organization_domains?.length || 0) +
      (criteria.organization_industries?.length || 0) +
      (criteria.q_keywords ? 1 : 0) > 0;
    if (!hasCriteria) {
      console.log("[LEAD POOL DB] No searchable criteria for DB query, skipping");
      return [];
    }

    const sb = adminClient();
    const SELECT_COLS = "id, contact_name, email, phone, website, city, state, country, category, business_name, employees, annual_revenue, notes, person_linkedin_url, linkedin, source, created_at, job_title";

    // ── OPTIMIZED MULTI-TIER QUERY STRATEGY ──
    // Tier 1: Exact matches (highest priority, smallest result set)
    // Tier 2: Prefix matches (good relevance, medium result set)
    // Tier 3: Contains matches (broadest, largest result set)
    // This ensures we find the best matches first without fetching millions of rows.

    const locations = [
      ...(criteria.person_locations || []),
      ...(criteria.organization_locations || []),
    ];

    const hasKeywords = !!(criteria.q_keywords && sanitizeForFilter(criteria.q_keywords).length >= 2);
    const kwSanitized = hasKeywords ? sanitizeForFilter(criteria.q_keywords!) : "";
    const hasIndustries = !!(criteria.organization_industries?.length);

    // Track what criteria types we have for logging
    console.log(`[LEAD POOL DB] Search criteria: industries=${hasIndustries ? criteria.organization_industries?.join(', ') : 'none'}, keywords=${kwSanitized || 'none'}, locations=${locations.length}, titles=${criteria.person_titles?.length || 0}`);

    // ── TIER 1: EXACT/PREFIX INDUSTRY MATCHES (highest priority) ──
    // When industries are explicitly selected, prioritize finding those FIRST
    const tierResults: any[][] = [];
    
    if (hasIndustries) {
      for (const ind of criteria.organization_industries!) {
        const indSanitized = sanitizeForFilter(ind);
        if (indSanitized.length < 2) continue;

        const indLower = indSanitized.toLowerCase();
        console.log(`[LEAD POOL DB] Tier 1: Searching for industry "${ind}" (sanitized: "${indSanitized}")`);

        // Build multi-condition query for this industry
        // Try exact match first, then prefix, then contains
        const industryParts: string[] = [];
        
        // Exact category match (case-insensitive equality)
        industryParts.push(`category.eq.${indSanitized}`);
        industryParts.push(`category.ilike.${indLower}`);
        
        // Prefix matches (category starts with industry)
        industryParts.push(`category.ilike.${indLower}%`);
        
        // Contains matches (industry anywhere in category)
        industryParts.push(`category.ilike.%${indLower}%`);
        
        // Check notes for structured "Industry: X" or "Category: X" lines
        industryParts.push(`notes.ilike.%Industry: ${indLower}%`);
        industryParts.push(`notes.ilike.%Category: ${indLower}%`);

        try {
          const { data, error } = await sb.from("leads").select(SELECT_COLS)
            .or(industryParts.join(","))
            .not("email", "is", null).neq("email", "")
            .limit(5000) // Limit per industry to avoid flooding
            .order("created_at", { ascending: false });

          if (error) {
            console.warn(`[LEAD POOL DB] Tier 1 industry "${ind}" error: ${error.message}`);
          } else if (data && data.length > 0) {
            console.log(`[LEAD POOL DB] Tier 1: Found ${data.length} matches for industry "${ind}"`);
            tierResults.push(data);
          } else {
            console.log(`[LEAD POOL DB] Tier 1: No matches for industry "${ind}"`);
          }
        } catch (err: any) {
          console.warn(`[LEAD POOL DB] Tier 1 query failed for "${ind}": ${err.message}`);
        }
      }
    }

    // ── TIER 2: KEYWORD MATCHES (if keywords provided) ──
    if (hasKeywords) {
      console.log(`[LEAD POOL DB] Tier 2: Searching for keyword "${kwSanitized}"`);
      const kwParts: string[] = [];
      
      // Exact/prefix first
      kwParts.push(`category.ilike.${kwSanitized}%`);
      kwParts.push(`business_name.ilike.${kwSanitized}%`);
      kwParts.push(`job_title.ilike.${kwSanitized}%`);
      
      // Contains
      kwParts.push(`category.ilike.%${kwSanitized}%`);
      kwParts.push(`business_name.ilike.%${kwSanitized}%`);
      kwParts.push(`job_title.ilike.%${kwSanitized}%`);
      kwParts.push(`notes.ilike.%${kwSanitized}%`);

      try {
        const { data, error } = await sb.from("leads").select(SELECT_COLS)
          .or(kwParts.join(","))
          .not("email", "is", null).neq("email", "")
          .limit(5000)
          .order("created_at", { ascending: false });

        if (error) {
          console.warn(`[LEAD POOL DB] Tier 2 keyword error: ${error.message}`);
        } else if (data && data.length > 0) {
          console.log(`[LEAD POOL DB] Tier 2: Found ${data.length} keyword matches`);
          tierResults.push(data);
        }
      } catch (err: any) {
        console.warn(`[LEAD POOL DB] Tier 2 query failed: ${err.message}`);
      }
    }

    // ── TIER 3: LOCATION + TITLE MATCHES (broader criteria) ──
    if (locations.length > 0 || criteria.person_titles?.length) {
      console.log(`[LEAD POOL DB] Tier 3: Searching locations/titles`);
      
      // Process location filtering with STRICT AND logic (all parts must match)
      for (const loc of locations) {
        const parts = loc.split(",").map((p) => sanitizeForFilter(p)).filter(Boolean);
        if (parts.length === 0) continue;

        console.log(`[LEAD POOL DB] Tier 3: Processing location "${loc}" with ${parts.length} parts: ${parts.join(', ')}`);
        
        // Build broad OR query to get candidates, then filter strictly in memory
        const broadConditions: string[] = [];
        for (const part of parts) {
          if (part.length < 2) continue;
          const partLower = part.toLowerCase();
          broadConditions.push(`city.ilike.%${partLower}%`);
          broadConditions.push(`state.ilike.%${partLower}%`);
          broadConditions.push(`country.ilike.%${partLower}%`);
        }
        
        if (broadConditions.length === 0) continue;
        
        // Execute broad query
        try {
          const { data, error } = await sb.from("leads").select(SELECT_COLS)
            .or(broadConditions.join(","))
            .not("email", "is", null).neq("email", "")
            .limit(10000) // Get more candidates for strict filtering
            .order("created_at", { ascending: false });

          if (error) {
            console.warn(`[LEAD POOL DB] Tier 3 location "${loc}" error: ${error.message}`);
          } else if (data && data.length > 0) {
            // STRICT POST-FILTER: ALL location parts must match
            const strictMatches = data.filter((lead: any) => {
              const leadCity = (lead.city || "").toLowerCase();
              const leadState = (lead.state || "").toLowerCase();
              const leadCountry = (lead.country || "").toLowerCase();
              const leadLocationStr = `${leadCity} ${leadState} ${leadCountry}`;
              
              // Every part of the search location must appear somewhere in the lead's location
              return parts.every(part => {
                const partLower = part.toLowerCase();
                return leadCity.includes(partLower) || 
                       leadState.includes(partLower) || 
                       leadCountry.includes(partLower);
              });
            });
            
            console.log(`[LEAD POOL DB] Tier 3: Filtered ${data.length} candidates → ${strictMatches.length} strict matches for "${loc}"`);
            if (strictMatches.length > 0) {
              tierResults.push(strictMatches);
            }
          }
        } catch (err: any) {
          console.warn(`[LEAD POOL DB] Tier 3 location query failed for "${loc}": ${err.message}`);
        }
      }

      // Process title filtering separately
      if (criteria.person_titles?.length) {
        const titleParts: string[] = [];
        for (const t of criteria.person_titles) {
          const sanitized = sanitizeForFilter(t);
          if (sanitized.length >= 2) {
            const tLower = sanitized.toLowerCase();
            titleParts.push(`job_title.ilike.${tLower}%`);
            titleParts.push(`job_title.ilike.%${tLower}%`);
            titleParts.push(`notes.ilike.%${tLower}%`);
          }
        }

        if (titleParts.length > 0) {
          try {
            const { data, error } = await sb.from("leads").select(SELECT_COLS)
              .or(titleParts.join(","))
              .not("email", "is", null).neq("email", "")
              .limit(5000)
              .order("created_at", { ascending: false });

            if (error) {
              console.warn(`[LEAD POOL DB] Tier 3 title error: ${error.message}`);
            } else if (data && data.length > 0) {
              console.log(`[LEAD POOL DB] Tier 3: Found ${data.length} title matches`);
              tierResults.push(data);
            }
          } catch (err: any) {
            console.warn(`[LEAD POOL DB] Tier 3 title query failed: ${err.message}`);
          }
        }
      }
    }

    // ── TIER 4: DOMAIN MATCHES (if provided) ──
    if (criteria.q_organization_domains?.length) {
      console.log(`[LEAD POOL DB] Tier 4: Searching domains`);
      const domainParts: string[] = [];
      for (const d of criteria.q_organization_domains) {
        const domain = d.replace(/^www\./, "").toLowerCase();
        domainParts.push(`website.ilike.%${domain}%`);
      }

      try {
        const { data, error } = await sb.from("leads").select(SELECT_COLS)
          .or(domainParts.join(","))
          .not("email", "is", null).neq("email", "")
          .limit(1000)
          .order("created_at", { ascending: false });

        if (error) {
          console.warn(`[LEAD POOL DB] Tier 4 domain error: ${error.message}`);
        } else if (data && data.length > 0) {
          console.log(`[LEAD POOL DB] Tier 4: Found ${data.length} domain matches`);
          tierResults.push(data);
        }
      } catch (err: any) {
        console.warn(`[LEAD POOL DB] Tier 4 query failed: ${err.message}`);
      }
    }

    if (tierResults.length === 0) {
      console.log("[LEAD POOL DB] No results from any tier");
      return [];
    }

    console.log(`[LEAD POOL DB] Collected ${tierResults.length} tier result sets, merging and deduplicating...`);

    // Merge + deduplicate rows from all tiers
    const seenId = new Set<string>();
    const allRows: any[] = [];
    for (const rows of tierResults) {
      for (const row of rows) {
        if (!row.id || seenId.has(row.id)) continue;
        seenId.add(row.id);
        allRows.push(row);
      }
    }

    if (allRows.length === 0) {
      console.log("[LEAD POOL DB] No matching leads found after deduplication");
      return [];
    }

    console.log(`[LEAD POOL DB] Found ${allRows.length} unique raw matches, scoring for relevance...`);

    // ── ENHANCED RELEVANCE SCORING ──
    // Industry match is PRIMARY (+10 when explicitly selected)
    // Keyword match is SECONDARY (+7)
    // Title/domain are TERTIARY (+5/+4)
    // Location is QUATERNARY (+2)
    const scored: { row: any; score: number; debug: string[] }[] = [];
    const kwLower = (criteria.q_keywords || "").toLowerCase().trim();

    for (const row of allRows) {
      let score = 0;
      const debug: string[] = [];
      
      const notes = (row.notes || "").toLowerCase();
      const category = (row.category || "").toLowerCase().trim();
      const businessName = (row.business_name || "").toLowerCase();
      const jobTitle = (row.job_title || "").toLowerCase();
      const city = (row.city || "").toLowerCase();
      const state = (row.state || "").toLowerCase();
      const country = (row.country || "").toLowerCase();
      const website = (row.website || "").toLowerCase();

      // ══════════ INDUSTRY MATCH (PRIMARY — +10) ══════════
      // When industries are explicitly selected, this is the MOST important signal.
      // A lead without industry match should be heavily penalized.
      let matchesIndustry = false;
      if (criteria.organization_industries?.length) {
        for (const ind of criteria.organization_industries) {
          const indLow = ind.toLowerCase().trim();
          
          // Exact match (best)
          if (category === indLow) {
            score += 10;
            matchesIndustry = true;
            debug.push(`exact-industry[${ind}]`);
            break;
          }
          
          // Prefix match (very good)
          if (category && category.startsWith(indLow)) {
            score += 9;
            matchesIndustry = true;
            debug.push(`prefix-industry[${ind}]`);
            break;
          }
          
          // Contains match (good)
          if (category && category.includes(indLow)) {
            score += 8;
            matchesIndustry = true;
            debug.push(`contains-industry[${ind}]`);
            break;
          }
          
          // Reverse contains (category is subset of industry term)
          if (category && category.length >= 4 && indLow.includes(category)) {
            score += 8;
            matchesIndustry = true;
            debug.push(`reverse-industry[${ind}]`);
            break;
          }
          
          // Word-boundary match for compound categories
          if (category) {
            const catWords = category.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
            const indWords = indLow.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
            let wordMatch = false;
            for (const cw of catWords) {
              for (const iw of indWords) {
                if (cw === iw || (cw.includes(iw) && iw.length >= 4) || (iw.includes(cw) && cw.length >= 4)) {
                  wordMatch = true;
                  break;
                }
              }
              if (wordMatch) break;
            }
            if (wordMatch) {
              score += 7;
              matchesIndustry = true;
              debug.push(`word-industry[${ind}]`);
              break;
            }
          }
          
          // Check structured "Industry: X" in notes
          const industryLineMatch = notes.match(/industry:\s*(.+)/i);
          if (industryLineMatch) {
            const noteIndustry = industryLineMatch[1].trim().toLowerCase().split('\n')[0];
            if (noteIndustry.includes(indLow) || indLow.includes(noteIndustry)) {
              score += 6;
              matchesIndustry = true;
              debug.push(`notes-industry[${ind}]`);
              break;
            }
          }
          
          // Check business name (sometimes companies have industry in name)
          if (businessName.includes(indLow)) {
            score += 5;
            matchesIndustry = true;
            debug.push(`bizname-industry[${ind}]`);
            break;
          }
        }
      }

      // ── HARD FILTER: when industries are explicitly selected, REQUIRE match ──
      if (criteria.organization_industries?.length && !matchesIndustry) {
        debug.push(`REJECTED-no-industry-match`);
        continue; // Skip entirely — wrong industry
      }

      // ══════════ KEYWORD MATCH (SECONDARY — +7) ══════════
      let matchesKeyword = false;
      if (kwLower) {
        if (category.includes(kwLower)) {
          score += 7;
          matchesKeyword = true;
          debug.push(`keyword-category`);
        } else if (businessName.includes(kwLower)) {
          score += 6;
          matchesKeyword = true;
          debug.push(`keyword-business`);
        } else if (jobTitle.includes(kwLower)) {
          score += 5;
          matchesKeyword = true;
          debug.push(`keyword-title`);
        } else if (notes.includes(kwLower)) {
          score += 4;
          matchesKeyword = true;
          debug.push(`keyword-notes`);
        }
      }

      // When keywords are specified (without explicit industry), require keyword match
      if (kwLower && !matchesKeyword && !criteria.organization_industries?.length) {
        debug.push(`REJECTED-no-keyword-match`);
        continue;
      }

      // ══════════ TITLE MATCH (TERTIARY — +5) ══════════
      if (criteria.person_titles?.length) {
        for (const t of criteria.person_titles) {
          const tLow = t.toLowerCase();
          if (jobTitle.includes(tLow)) {
            score += 5;
            debug.push(`title-match`);
            break;
          } else if (notes.includes(tLow)) {
            score += 3;
            debug.push(`title-notes`);
            break;
          }
        }
      }

      // ══════════ DOMAIN MATCH (TERTIARY — +4) ══════════
      if (criteria.q_organization_domains?.length) {
        for (const d of criteria.q_organization_domains) {
          const domain = d.replace(/^www\./, "").toLowerCase();
          if (website.includes(domain)) {
            score += 4;
            debug.push(`domain-match`);
            break;
          }
        }
      }

      // ══════════ LOCATION MATCH — STRICT HARD FILTER ══════════
      // When locations are specified, REQUIRE the lead to match at least one.
      // Each location is split by comma into parts and ALL parts must match
      // (e.g. "New York, NY" → city must contain "new york" AND state must contain "ny")
      let matchesLocation = false;
      if (locations.length > 0) {
        for (const loc of locations) {
          const parts = loc.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
          if (parts.length === 0) continue;

          // ALL parts of this location must appear in lead's city/state/country
          const allPartsMatch = parts.every((part: string) => {
            if (part.length < 2) return true; // skip trivially short parts
            return city.includes(part) || state.includes(part) || country.includes(part);
          });

          if (allPartsMatch) {
            score += 2;
            matchesLocation = true;
            debug.push(`location-strict`);
            break;
          }
        }

        // HARD FILTER: when locations are specified, REJECT leads that don't match
        if (!matchesLocation) {
          debug.push(`REJECTED-no-location-match`);
          continue; // Skip entirely — wrong location
        }
      }

      // ══════════ DATA QUALITY BONUS ══════════
      // Leads with more complete data get a small boost
      if (row.phone) {
        score += 0.5;
        debug.push(`has-phone`);
      }
      if (row.person_linkedin_url) {
        score += 0.5;
        debug.push(`has-linkedin`);
      }
      if (row.website) {
        score += 0.3;
        debug.push(`has-website`);
      }
      if (row.employees && row.employees > 0) {
        score += 0.2;
        debug.push(`has-emp-count`);
      }

      if (score > 0) {
        scored.push({ row, score, debug });
      } else {
        debug.push(`REJECTED-zero-score`);
      }
    }

    // Sort by score (highest first), then by recency
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.row.created_at || "").localeCompare(a.row.created_at || "");
    });

    // Take top results
    const topResults = scored.slice(0, maxResults);
    
    if (topResults.length > 0) {
      console.log(`[LEAD POOL DB] Scored ${scored.length} matching leads, returning top ${topResults.length}`);
      console.log(`[LEAD POOL DB] Top 3 scores: ${topResults.slice(0, 3).map((r, i) => `#${i+1}: ${r.score} [${r.debug.join(',')}]`).join(' | ')}`);
      console.log(`[LEAD POOL DB] Score range: ${topResults[0]?.score.toFixed(1)} (best) to ${topResults[topResults.length - 1]?.score.toFixed(1)} (worst)`);
    } else {
      console.log(`[LEAD POOL DB] No scored leads passed filters`);
      return [];
    }

    // Transform DB leads to PoolLead format
    return topResults.map(({ row }) => transformDbLeadToPool(row)).filter((l: PoolLead) => {
      // Require email + real person name + real company name (quality gate)
      if (!l.email) return false;
      if (!l.name?.trim() || l.name.trim().length < 3) return false;
      if (!l.first_name?.trim() || !l.last_name?.trim()) return false;
      if (!l.organization?.name?.trim() || l.organization.name.trim().length < 2) return false;
      return true;
    });
  } catch (err: any) {
    console.error(`[LEAD POOL DB] Critical search error: ${err.message}\nStack: ${err.stack}`);
    return [];
  }
}

// Junk title values that should be treated as empty
const JUNK_TITLE_VALUES = new Set([
  "n/a", "na", "undefined", "null", "none", "unknown", "-", "—", "",
  "not available", "not specified", "unspecified",
]);

function isValidTitle(t: string): boolean {
  if (!t) return false;
  return !JUNK_TITLE_VALUES.has(t.toLowerCase().trim());
}

// Map seniority labels to generic title fallbacks
const SENIORITY_TITLE_MAP: Record<string, string> = {
  owner: "Owner",
  founder: "Founder",
  c_suite: "Executive",
  partner: "Partner",
  vp: "Vice President",
  head: "Head of Department",
  director: "Director",
  manager: "Manager",
  senior: "Senior Professional",
  entry: "Professional",
};

// Normalize seniority strings that may have been human-readablified (e.g. "C Suite" → "c_suite")
function normalizeSeniority(raw: string): string {
  const lower = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
  // Direct matches
  if (SENIORITY_TITLE_MAP[lower]) return lower;
  // Common variants
  const NORMALIZE_MAP: Record<string, string> = {
    c_suite: "c_suite", csuite: "c_suite",
    owner: "owner", founder: "founder", partner: "partner",
    vp: "vp", vice_president: "vp",
    head: "head", director: "director", manager: "manager",
    senior: "senior", entry: "entry", junior: "entry",
    executive: "c_suite", chief: "c_suite",
  };
  return NORMALIZE_MAP[lower] || lower;
}

// Infer seniority from a job title string (e.g. "CEO" → "c_suite", "Owner & CEO" → "owner")
function inferSeniorityFromTitle(title: string): string {
  if (!title) return "";
  const t = title.toLowerCase();

  // Owner takes priority (user's primary lead type)
  if (/\bowner\b/.test(t)) return "owner";
  if (/\bfounder\b|co[\s-]?founder\b/.test(t)) return "founder";

  // C-Suite titles
  if (/\b(ceo|cfo|cto|coo|cmo|cro|cpo|cio|chro|cso|cdo)\b/.test(t)) return "c_suite";
  if (/\bchief\s/.test(t)) return "c_suite";
  if (/\bpresident\b/.test(t) && !/vice[\s-]?president/.test(t)) return "c_suite";

  // Partner
  if (/\bpartner\b/.test(t)) return "partner";

  // VP
  if (/\b(vp|vice[\s-]?president|svp|evp|avp)\b/.test(t)) return "vp";

  // Head
  if (/\bhead\s+(of\s+)?/.test(t)) return "head";

  // Director
  if (/\b(director|managing\s+director)\b/.test(t)) return "director";

  // Manager
  if (/\b(manager|general\s+manager)\b/.test(t)) return "manager";

  // Senior
  if (/\b(senior|sr\.?|principal|lead)\b/.test(t)) return "senior";

  return "";
}

function transformDbLeadToPool(row: any): PoolLead {
  // Parse name parts
  const contactName = row.contact_name || "";
  const nameParts = contactName.split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  // ── Multi-strategy title extraction ──
  let title = "";
  let seniority = "";

  // Strategy 0: Use the dedicated job_title column (most reliable — set by CRM, AddLead, Apollo save)
  if (row.job_title && isValidTitle(row.job_title)) {
    title = row.job_title.trim();
  }

  if (row.notes) {
    // Always extract seniority from notes (independent of title)
    const senMatch = row.notes.match(/Seniority:\s*(.+)/i);
    if (senMatch) {
      const candidate = senMatch[1].trim().split("\n")[0].trim().toLowerCase();
      if (!JUNK_TITLE_VALUES.has(candidate)) seniority = normalizeSeniority(candidate);
    }

    // Only fall back to notes-based title extraction if job_title column was empty
    if (!title) {
      // Strategy 1: "Role: ..." line (Apollo and Lead Finder format)
      const roleMatch = row.notes.match(/Role:\s*(.+)/i);
      if (roleMatch) {
        const candidate = roleMatch[1].trim().split("\n")[0].trim();
        if (isValidTitle(candidate)) title = candidate;
      }

      // Strategy 2: "Title: ..." line
      if (!title) {
        const titleMatch = row.notes.match(/Title:\s*(.+)/i);
        if (titleMatch) {
          const candidate = titleMatch[1].trim().split("\n")[0].trim();
          if (isValidTitle(candidate)) title = candidate;
        }
      }

      // Strategy 3: "Position: ..." line
      if (!title) {
        const posMatch = row.notes.match(/Position:\s*(.+)/i);
        if (posMatch) {
          const candidate = posMatch[1].trim().split("\n")[0].trim();
          if (isValidTitle(candidate)) title = candidate;
        }
      }

      // Strategy 4: Scan notes for common C-suite/title keywords on any line
      if (!title) {
        const lines = row.notes.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip metadata lines (lines with ":" that are key-value pairs we already checked)
          if (/^(Imported|Source|Confidence|LinkedIn|Email|Company|Revenue|Employees|Founded|Seniority)[\s:]/i.test(trimmed)) continue;
          // Check if a standalone line looks like a title (contains title keywords)
          if (/\b(CEO|CFO|CTO|COO|CMO|CRO|CPO|CIO|CHRO|CSO|CDO|President|Founder|Owner|Partner|Director|Manager|VP|Vice President|Head of|Chief|General Manager|Managing Director|Principal|Coordinator|Supervisor|Lead|Specialist|Consultant|Analyst|Engineer|Developer|Designer|Architect|Strategist)\b/i.test(trimmed) && trimmed.length < 80) {
            title = trimmed;
            break;
          }
        }
      }
    }
  }

  // Strategy 5: Use seniority as a weak fallback title
  if (!title && seniority) {
    title = SENIORITY_TITLE_MAP[seniority] || "";
  }

  // Strategy 6: Infer seniority from title when no explicit seniority was found
  if (!seniority && title) {
    seniority = inferSeniorityFromTitle(title);
  }

  // Parse phone
  const phoneNumbers: { raw_number: string; type: string }[] = [];
  if (row.phone) {
    phoneNumbers.push({ raw_number: row.phone, type: "unknown" });
  }

  // Parse employee count
  let estimatedEmployees = 0;
  if (row.employees) {
    const num = parseInt(row.employees.replace(/[^\d]/g, ""), 10);
    if (!isNaN(num)) estimatedEmployees = num;
  }

  // Fallback: extract employee count from notes ("Employees: 500")
  if (!estimatedEmployees && row.notes) {
    const empMatch = row.notes.match(/Employees:\s*([0-9][0-9,]*)/i);
    if (empMatch) {
      const num = parseInt(empMatch[1].replace(/[^\d]/g, ""), 10);
      if (!isNaN(num) && num > 0) estimatedEmployees = num;
    }
  }

  // Parse annual revenue from notes if not in column
  let annualRevenue = row.annual_revenue ? `$${row.annual_revenue}` : "";
  if (!annualRevenue && row.notes) {
    const revMatch = row.notes.match(/Revenue:\s*(\$[^\n]+)/i);
    if (revMatch) {
      const candidate = revMatch[1].trim();
      if (candidate && candidate !== "N/A") annualRevenue = candidate;
    }
  }

  // Parse founded year from notes
  let foundedYear = 0;
  if (row.notes) {
    const foundedMatch = row.notes.match(/Founded:\s*(\d{4})/i);
    if (foundedMatch) {
      const yr = parseInt(foundedMatch[1], 10);
      if (yr >= 1800 && yr <= 2030) foundedYear = yr;
    }
  }

  return {
    id: row.id || crypto.randomUUID(),
    first_name: firstName,
    last_name: lastName,
    name: contactName,
    title,
    email: row.email || "",
    email_status: "verified", // If it's in CRM, assume previously verified
    linkedin_url: row.person_linkedin_url || row.linkedin || "",
    phone_numbers: phoneNumbers,
    city: row.city || "",
    state: row.state || "",
    country: row.country || "",
    seniority,
    departments: [],
    organization: {
      id: "",
      name: row.business_name || "",
      website_url: row.website || "",
      linkedin_url: "",
      industry: row.category || "",
      estimated_num_employees: estimatedEmployees,
      annual_revenue_printed: annualRevenue,
      city: row.city || "",
      state: row.state || "",
      country: row.country || "",
      short_description: "",
      founded_year: foundedYear,
      phone: "",
    },
    _pool_source: "leads_table",
  };
}

// ══════════════════════════════════════════════════════════════════════
// POOL STATS
// ══════════════════════════════════════════════════════════════════════

export async function getPoolStats(): Promise<{
  total: number;
  last_updated: string;
  kv_leads: number;
  db_leads: number;
}> {
  const [metaRaw, dbCountResult] = await Promise.allSettled([
    kv.get("dp_meta"),
    adminClient()
      .from("leads")
      .select("id", { count: "exact", head: true })
      .not("email", "is", null)
      .neq("email", ""),
  ]);

  const meta = metaRaw.status === "fulfilled" ? parseKvObject(metaRaw.value) : null;
  const dbCount =
    dbCountResult.status === "fulfilled" ? dbCountResult.value?.count || 0 : 0;

  return {
    total: (meta?.total || 0) + dbCount,
    last_updated: meta?.last_updated || "never",
    kv_leads: meta?.total || 0,
    db_leads: dbCount,
  };
}
