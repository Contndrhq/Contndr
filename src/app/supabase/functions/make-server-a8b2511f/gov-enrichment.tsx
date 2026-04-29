// ══════════════════════════════════════════════════════════════════════════
// Government & Registry Data Enrichment
// Sources:
//   1. SEC EDGAR (US public companies) — executives, revenue, subsidiaries
//   2. Corporate registry search (Secretary of State, business registries) — legal name, status, officers
//   3. Enhanced Website Scraping — team pages, tech stack, careers/growth
// ══════════════════════════════════════════════════════════════════════════

// ── SEC EDGAR: Public company data ──────────────────────────────────────
// Uses the EDGAR full-text search API + company tickers file
// Returns: executives, revenue, subsidiaries, CIK, SIC industry

interface SECCompanyData {
  cik?: string;
  legal_name?: string;
  sic_description?: string;
  state_of_incorporation?: string;
  fiscal_year_end?: string;
  executives?: { name: string; title: string }[];
  revenue_hint?: string;
  filing_date?: string;
  ticker?: string;
}

const SEC_UA = "ContndrBot/1.0 (support@contndr.com)"; // SEC requires a UA with contact info

export async function secEdgarLookup(companyName: string): Promise<SECCompanyData> {
  if (!companyName || companyName.length < 2) return {};

  try {
    // Step 1: Search EDGAR full-text search for company filings
    const searchQuery = encodeURIComponent(`"${companyName}"`);
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=${searchQuery}&forms=10-K,10-Q&dateRange=custom&startdt=2023-01-01&enddt=2026-12-31`;

    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": SEC_UA, Accept: "application/json" },
    });

    if (!searchRes.ok) {
      // Fallback: try the company search endpoint
      return await secEdgarCompanySearch(companyName);
    }

    const searchData = await searchRes.json();
    const hits = searchData.hits?.hits || [];

    if (hits.length === 0) {
      return await secEdgarCompanySearch(companyName);
    }

    const topHit = hits[0]._source || {};
    const result: SECCompanyData = {};

    if (topHit.entity_name) result.legal_name = topHit.entity_name;
    if (topHit.file_date) result.filing_date = topHit.file_date;

    // Extract CIK for deeper lookup
    const cik = topHit.entity_id || "";
    if (cik) {
      result.cik = cik;
      // Step 2: Get company details from EDGAR company API
      const details = await secEdgarCompanyDetails(cik);
      if (details.sic_description) result.sic_description = details.sic_description;
      if (details.state_of_incorporation) result.state_of_incorporation = details.state_of_incorporation;
      if (details.fiscal_year_end) result.fiscal_year_end = details.fiscal_year_end;
      if (details.ticker) result.ticker = details.ticker;
      if (details.executives?.length) result.executives = details.executives;
    }

    console.log(`[SEC EDGAR] Found data for "${companyName}": CIK=${result.cik || "none"}, legal="${result.legal_name || "none"}"${result.executives?.length ? `, ${result.executives.length} executives` : ""}`);
    return result;
  } catch (e: any) {
    console.log(`[SEC EDGAR] Lookup failed for "${companyName}" (non-fatal): ${e.message}`);
    return {};
  }
}

async function secEdgarCompanySearch(companyName: string): Promise<SECCompanyData> {
  try {
    // Use the EDGAR company search (returns HTML but we can parse basics)
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&CIK=&type=10-K&dateb=&owner=include&count=3&search_text=&action=getcompany&output=atom`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": SEC_UA },
    });

    if (!res.ok) return {};
    const xml = await res.text();

    // Parse Atom XML for company info
    const result: SECCompanyData = {};

    // Extract company name from <title>
    const nameMatch = xml.match(/<company-name>([^<]+)<\/company-name>/i)
      || xml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      // Only accept if it's close to our search
      if (name.toLowerCase().includes(companyName.toLowerCase().slice(0, 5))) {
        result.legal_name = name;
      }
    }

    // Extract CIK
    const cikMatch = xml.match(/<CIK>(\d+)<\/CIK>/i)
      || xml.match(/CIK=(\d+)/i);
    if (cikMatch) {
      result.cik = cikMatch[1];

      // Get details from the submissions endpoint
      const details = await secEdgarCompanyDetails(cikMatch[1]);
      Object.assign(result, details);
    }

    // Extract SIC
    const sicMatch = xml.match(/<assigned-sic>(\d+)<\/assigned-sic>/i)
      || xml.match(/<SIC>(\d+)<\/SIC>/i);
    if (sicMatch && !result.sic_description) {
      result.sic_description = `SIC ${sicMatch[1]}`;
    }

    return result;
  } catch (e: any) {
    console.log(`[SEC EDGAR] Company search fallback failed: ${e.message}`);
    return {};
  }
}

async function secEdgarCompanyDetails(cik: string): Promise<Partial<SECCompanyData>> {
  try {
    // Pad CIK to 10 digits
    const paddedCik = cik.padStart(10, "0");
    const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": SEC_UA, Accept: "application/json" },
    });

    if (!res.ok) return {};
    const data = await res.json();

    const result: Partial<SECCompanyData> = {};

    if (data.sicDescription) result.sic_description = data.sicDescription;
    if (data.stateOfIncorporation) result.state_of_incorporation = data.stateOfIncorporation;
    if (data.fiscalYearEnd) result.fiscal_year_end = data.fiscalYearEnd;
    if (data.tickers?.length) result.ticker = data.tickers[0];

    // Extract executives from recent filings
    // The submissions JSON doesn't directly list executives, but we can get them from
    // the company's display name and officer info if available
    if (data.formerNames?.length) {
      // Former names can indicate mergers/acquisitions
    }

    return result;
  } catch (e: any) {
    console.log(`[SEC EDGAR] Company details fetch failed for CIK ${cik}: ${e.message}`);
    return {};
  }
}


// ── OpenCorporates: Global corporate registry ───────────────────────────
// Free tier: 50 requests/day, no API key needed for basic search
// Returns: legal name, entity type, status, jurisdiction, incorporation date, officers

interface OpenCorpData {
  legal_name?: string;
  company_number?: string;
  jurisdiction?: string;
  incorporation_date?: string;
  company_type?: string;
  status?: string;
  registered_address?: string;
  officers?: { name: string; position: string }[];
  industry_codes?: string[];
}

/**
 * Corporate registry lookup via SerpAPI Google Search
 * Searches Secretary of State databases, OpenCorporates public pages, and business registries
 * Replaces direct OpenCorporates API (which requires paid authentication)
 */
export async function openCorporatesLookup(companyName: string, jurisdiction?: string): Promise<OpenCorpData> {
  if (!companyName || companyName.length < 2) return {};

  const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
  if (!SERPAPI_KEY) return {};

  try {
    // Search for official business registry entries
    const locHint = jurisdiction ? ` ${jurisdiction}` : "";
    const query = `"${companyName}"${locHint} (site:opencorporates.com OR "secretary of state" OR "business entity" OR "corporation search") incorporation status`;

    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: SERPAPI_KEY,
      num: "5",
    });

    const res = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (res.status === 429) console.log(`[REGISTRY] Search quota exceeded for "${companyName}"`);
      return {};
    }

    const data = await res.json();
    const result: OpenCorpData = {};
    const organicResults = data.organic_results || [];

    for (const r of organicResults.slice(0, 5)) {
      const snippet = (r.snippet || "").toString();
      const title = (r.title || "").toString();

      // Legal name from OpenCorporates results
      if (!result.legal_name) {
        // OpenCorporates page titles are like: "COMPANY NAME :: OpenCorporates"
        const ocMatch = title.match(/^(.+?)\s*::\s*OpenCorporates/i);
        if (ocMatch) {
          result.legal_name = ocMatch[1].trim();
        }
        // Secretary of state patterns: "Entity Name: COMPANY NAME"
        const sosMatch = snippet.match(/(?:entity\s*name|legal\s*name|business\s*name)[:\s]+([A-Z][A-Z\s&,.]+(?:LLC|INC|CORP|LP|LLP|CO|LTD)?)/i);
        if (sosMatch && !result.legal_name) {
          result.legal_name = sosMatch[1].trim();
        }
      }

      // Company type
      if (!result.company_type) {
        const typeMatch = snippet.match(/(?:entity\s*type|business\s*type|type|form)[:\s]+((?:Limited\s*Liability|Corporation|Partnership|Sole\s*Proprietor)[A-Za-z\s]*)/i)
          || snippet.match(/\b(LLC|Inc\.?|Corp\.?|LP|LLP|S-Corp|C-Corp)\b/i);
        if (typeMatch) result.company_type = typeMatch[1].trim();
      }

      // Status
      if (!result.status) {
        const statusMatch = snippet.match(/(?:status|standing)[:\s]+(Active|Inactive|Dissolved|Good\s*Standing|Revoked|Suspended|Withdrawn|Merged|Cancelled)/i);
        if (statusMatch) result.status = statusMatch[1].trim();
      }

      // Incorporation date
      if (!result.incorporation_date) {
        const dateMatch = snippet.match(/(?:incorporat|formation|filing|register|organized|created)[A-Za-z\s]*(?:date)?[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
          || snippet.match(/(?:incorporat|formation|register|organized)[A-Za-z\s]*(?:date)?[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i)
          || snippet.match(/(?:incorporat|formed|founded|registered)\s+(?:on\s+|in\s+)?(\d{4})/i);
        if (dateMatch) result.incorporation_date = dateMatch[1].trim();
      }

      // Jurisdiction
      if (!result.jurisdiction) {
        const jurMatch = snippet.match(/(?:jurisdiction|state|registered\s*in)[:\s]+(Delaware|California|New\s*York|Texas|Florida|Nevada|Wyoming|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
          || title.match(/(\w+)\s+Secretary\s+of\s+State/i);
        if (jurMatch) result.jurisdiction = jurMatch[1].trim();
      }

      // Officers from snippets
      if (!result.officers) {
        const titlePattern = "CEO|CFO|COO|President|Director|Secretary|Treasurer|Manager|Chairman|Partner|Principal";
        const officerRegex = new RegExp(
          "(?:(?:" + titlePattern + ")\\s*[:\\-]\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+))" +
          "|(?:([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+)\\s*[,\\-]\\s*(?:" + titlePattern + "))",
          "gi"
        );
        const officerMatches = snippet.matchAll(officerRegex);
        const officers: { name: string; position: string }[] = [];
        for (const m of officerMatches) {
          const name = (m[1] || m[2] || "").trim();
          const positionMatch = m[0].match(/CEO|CFO|COO|President|Director|Secretary|Treasurer|Manager|Chairman|Partner|Principal/i);
          if (name && positionMatch) {
            officers.push({ name, position: positionMatch[0] });
          }
        }
        if (officers.length > 0) result.officers = officers.slice(0, 10);
      }
    }

    if (Object.keys(result).length > 0) {
      console.log(`[REGISTRY] Found data for "${companyName}": legal="${result.legal_name || "?"}", status="${result.status || "?"}", type="${result.company_type || "?"}${result.officers?.length ? `, ${result.officers.length} officers` : ""}`);
    } else {
      console.log(`[REGISTRY] No registry data found for "${companyName}"`);
    }

    return result;
  } catch (e: any) {
    console.log(`[REGISTRY] Lookup failed for "${companyName}" (non-fatal): ${e.message}`);
    return {};
  }
}


// ── Enhanced Website Scraping ───────────────────────────────────────────
// Scrapes team pages, careers pages, and detects tech stack from HTML

interface TeamMember {
  name: string;
  title: string;
  email?: string;
  linkedin?: string;
  image_url?: string;
}

interface TechStackItem {
  name: string;
  category: string; // crm, marketing, analytics, ecommerce, hosting, framework
}

interface EnhancedScrapeResult {
  team_members: TeamMember[];
  tech_stack: TechStackItem[];
  careers_count?: number;     // Number of open positions (growth signal)
  social_links: {
    linkedin?: string;
    twitter?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    github?: string;
  };
  legal_entity_name?: string;
  phone_numbers: string[];
  locations: string[];
}

// ── Tech stack detection patterns ──
// Detects CRM, marketing, analytics, ecommerce, and hosting from HTML source
const TECH_PATTERNS: { pattern: RegExp; name: string; category: string }[] = [
  // Analytics
  { pattern: /google-analytics\.com|gtag\(|ga\(|GoogleAnalyticsObject/i, name: "Google Analytics", category: "analytics" },
  { pattern: /segment\.com\/analytics|analytics\.js/i, name: "Segment", category: "analytics" },
  { pattern: /hotjar\.com|hj\(|_hjSettings/i, name: "Hotjar", category: "analytics" },
  { pattern: /mixpanel\.com|mixpanel\.init/i, name: "Mixpanel", category: "analytics" },
  { pattern: /heap\.io|heap\.load/i, name: "Heap", category: "analytics" },
  { pattern: /amplitude\.com|amplitude\.init/i, name: "Amplitude", category: "analytics" },
  { pattern: /plausible\.io/i, name: "Plausible", category: "analytics" },
  { pattern: /posthog\.com|posthog\.init/i, name: "PostHog", category: "analytics" },
  { pattern: /fullstory\.com|FullStory/i, name: "FullStory", category: "analytics" },
  { pattern: /clarity\.ms/i, name: "Microsoft Clarity", category: "analytics" },

  // Marketing / Ads
  { pattern: /fbq\(|facebook\.net\/en_US\/fbevents/i, name: "Facebook Pixel", category: "marketing" },
  { pattern: /googleadservices\.com|google_conversion_id/i, name: "Google Ads", category: "marketing" },
  { pattern: /mc\.yandex\.ru|ym\(/i, name: "Yandex Metrica", category: "marketing" },
  { pattern: /snap\.licdn\.com|_linkedin_partner_id/i, name: "LinkedIn Insight", category: "marketing" },
  { pattern: /static\.ads-twitter\.com|twq\(/i, name: "Twitter Ads", category: "marketing" },
  { pattern: /intercom\.io|Intercom\(/i, name: "Intercom", category: "marketing" },
  { pattern: /drift\.com|Drift\.load/i, name: "Drift", category: "marketing" },
  { pattern: /crisp\.chat|CRISP_WEBSITE_ID/i, name: "Crisp", category: "marketing" },
  { pattern: /tawk\.to/i, name: "Tawk.to", category: "marketing" },
  { pattern: /hs-scripts\.com|HubSpot|hubspot\.com/i, name: "HubSpot", category: "crm" },
  { pattern: /marketo\.net|Munchkin/i, name: "Marketo", category: "marketing" },
  { pattern: /pardot\.com|piAId/i, name: "Pardot", category: "marketing" },
  { pattern: /mailchimp\.com|mc_cid/i, name: "Mailchimp", category: "marketing" },
  { pattern: /klaviyo\.com/i, name: "Klaviyo", category: "marketing" },
  { pattern: /activecampaign\.com/i, name: "ActiveCampaign", category: "crm" },

  // CRM
  { pattern: /salesforce\.com|force\.com/i, name: "Salesforce", category: "crm" },
  { pattern: /zoho\.com\/crm/i, name: "Zoho CRM", category: "crm" },
  { pattern: /pipedrive\.com/i, name: "Pipedrive", category: "crm" },

  // Ecommerce
  { pattern: /shopify\.com|Shopify\./i, name: "Shopify", category: "ecommerce" },
  { pattern: /bigcommerce\.com/i, name: "BigCommerce", category: "ecommerce" },
  { pattern: /woocommerce|wc-/i, name: "WooCommerce", category: "ecommerce" },
  { pattern: /magento|Mage\./i, name: "Magento", category: "ecommerce" },
  { pattern: /squarespace\.com/i, name: "Squarespace", category: "ecommerce" },

  // Hosting / Infrastructure
  { pattern: /cloudflare/i, name: "Cloudflare", category: "hosting" },
  { pattern: /wp-content|wp-includes|wordpress/i, name: "WordPress", category: "framework" },
  { pattern: /wix\.com|wixstatic\.com/i, name: "Wix", category: "framework" },
  { pattern: /webflow\.com/i, name: "Webflow", category: "framework" },
  { pattern: /gatsby/i, name: "Gatsby", category: "framework" },
  { pattern: /next\/_next|__next/i, name: "Next.js", category: "framework" },
  { pattern: /nuxt/i, name: "Nuxt.js", category: "framework" },
  { pattern: /react/i, name: "React", category: "framework" },
  { pattern: /angular/i, name: "Angular", category: "framework" },
  { pattern: /vue\.js|vuejs/i, name: "Vue.js", category: "framework" },

  // Payment
  { pattern: /stripe\.com|Stripe\(/i, name: "Stripe", category: "payment" },
  { pattern: /paypal\.com/i, name: "PayPal", category: "payment" },
  { pattern: /braintree/i, name: "Braintree", category: "payment" },
];

async function fetchPageSafe(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Detect tech stack from HTML source code
 */
export function detectTechStack(html: string): TechStackItem[] {
  const found = new Map<string, TechStackItem>();
  for (const { pattern, name, category } of TECH_PATTERNS) {
    if (pattern.test(html) && !found.has(name)) {
      found.set(name, { name, category });
    }
  }
  return [...found.values()];
}

/**
 * Extract team members from team/about/leadership pages
 */
function extractTeamMembers(html: string): TeamMember[] {
  const members: TeamMember[] = [];
  const seenNames = new Set<string>();

  // 1. JSON-LD structured data (schema.org Person/Organization)
  const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonLdMatches) {
    try {
      const ld = JSON.parse(m[1]);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        // Organization with employees/founders
        if (item.employee || item.founder || item.member) {
          const people = [...(Array.isArray(item.employee) ? item.employee : item.employee ? [item.employee] : []),
                          ...(Array.isArray(item.founder) ? item.founder : item.founder ? [item.founder] : []),
                          ...(Array.isArray(item.member) ? item.member : item.member ? [item.member] : [])];
          for (const p of people) {
            const name = p.name || `${p.givenName || ""} ${p.familyName || ""}`.trim();
            if (name && name.length >= 3 && !seenNames.has(name.toLowerCase())) {
              seenNames.add(name.toLowerCase());
              members.push({
                name,
                title: p.jobTitle || p.roleName || "",
                email: p.email || "",
                linkedin: (p.sameAs || []).find?.((u: string) => u?.includes("linkedin.com")) || "",
              });
            }
          }
        }

        // Direct Person entries
        if (item["@type"] === "Person" && item.name) {
          const name = item.name;
          if (!seenNames.has(name.toLowerCase())) {
            seenNames.add(name.toLowerCase());
            members.push({
              name,
              title: item.jobTitle || "",
              email: item.email || "",
              linkedin: (item.sameAs || []).find?.((u: string) => u?.includes("linkedin.com")) || "",
            });
          }
        }
      }
    } catch {
      // Invalid JSON-LD
    }
  }

  // 2. Common team page HTML patterns
  // Pattern: team member cards with name + title in headings/paragraphs
  const teamPatterns = [
    // <h3>Name</h3><p>Title</p> or <h3>Name</h3><span>Title</span>
    /<h[2-4][^>]*>\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*<\/h[2-4]>\s*(?:<[^>]+>\s*)*(?:<(?:p|span|div|h[2-6])[^>]*>\s*((?:CEO|CTO|COO|CFO|VP|Director|Founder|Co-Founder|President|Partner|Head|Manager|Chief|Managing|Owner|Principal|Senior|Lead|Executive)[^<]{0,80})\s*<\/)/gi,
    // aria-label or title attributes with name + title
    /(?:team-member|staff|leadership)[^"]*"[^>]*>[\s\S]{0,300}?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})[\s\S]{0,200}?((?:CEO|CTO|COO|CFO|VP|Director|Founder|President|Partner|Head|Chief|Managing|Owner)[^<]{0,60})/gi,
  ];

  for (const pattern of teamPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && members.length < 20) {
      const name = match[1]?.trim();
      const title = match[2]?.trim();
      if (name && name.length >= 3 && name.length <= 50 && !seenNames.has(name.toLowerCase())) {
        // Validate it looks like a real name (at least 2 words, each capitalized)
        const words = name.split(/\s+/);
        if (words.length >= 2 && words.every(w => /^[A-Z]/.test(w))) {
          seenNames.add(name.toLowerCase());
          members.push({ name, title: title || "" });
        }
      }
    }
  }

  return members;
}

/**
 * Extract phone numbers from HTML
 */
function extractPhoneNumbers(html: string): string[] {
  const phones = new Set<string>();
  // US phone patterns
  const patterns = [
    /(?:tel:|phone:|call\s*:?\s*)?\+?1?\s*[\(.-]?\s*(\d{3})\s*[\).-]?\s*(\d{3})\s*[.-]?\s*(\d{4})/gi,
    /href=["']tel:([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const phone = match[0].replace(/.*tel:/, "").replace(/["']/g, "").trim();
      if (phone.replace(/\D/g, "").length >= 10) {
        phones.add(phone);
      }
    }
  }
  return [...phones].slice(0, 5);
}

/**
 * Extract social media links from HTML
 */
function extractSocialLinks(html: string): EnhancedScrapeResult["social_links"] {
  const links: EnhancedScrapeResult["social_links"] = {};

  const socialPatterns: { key: keyof typeof links; pattern: RegExp }[] = [
    { key: "linkedin", pattern: /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"'\s]+)/i },
    { key: "twitter", pattern: /href=["'](https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^"'\s]+)/i },
    { key: "facebook", pattern: /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s]+)/i },
    { key: "instagram", pattern: /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'\s]+)/i },
    { key: "youtube", pattern: /href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|@)[^"'\s]+)/i },
    { key: "github", pattern: /href=["'](https?:\/\/(?:www\.)?github\.com\/[^"'\s]+)/i },
  ];

  for (const { key, pattern } of socialPatterns) {
    const match = html.match(pattern);
    if (match) links[key] = match[1];
  }

  return links;
}

/**
 * Extract legal entity name from privacy policy or footer
 */
function extractLegalEntity(html: string): string | undefined {
  // Privacy policy patterns: "Company LLC", "Company Inc.", etc.
  const legalPatterns = [
    /(?:©|&copy;|copyright)\s*\d{4}\s+([A-Z][A-Za-z\s&.,']+(?:LLC|Inc\.?|Ltd\.?|Corp\.?|Corporation|Limited|LLP|LP|PLC|Group|Holdings|Enterprises))/i,
    /(?:owned|operated|managed)\s+by\s+([A-Z][A-Za-z\s&.,']+(?:LLC|Inc\.?|Ltd\.?|Corp\.?|Corporation|Limited|LLP|LP|PLC))/i,
    /(?:privacy policy|terms of service|legal notice)\s+(?:of|for)\s+([A-Z][A-Za-z\s&.,']+(?:LLC|Inc\.?|Ltd\.?|Corp\.?|Corporation|Limited|LLP|LP|PLC))/i,
  ];

  for (const pattern of legalPatterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Count open job positions as a growth signal
 */
function countCareersListings(html: string): number {
  // Look for job listing patterns
  const jobPatterns = [
    /<(?:li|div|article)[^>]*class=["'][^"']*(?:job|position|opening|career|vacancy)[^"']*["']/gi,
    /(?:apply now|view position|apply for this|open position)/gi,
  ];

  let count = 0;
  for (const pattern of jobPatterns) {
    const matches = html.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Enhanced website scrape: team members, tech stack, careers, social links
 * Scrapes multiple pages (homepage, about, team, careers) in parallel
 */
export async function enhancedWebsiteScrape(website: string): Promise<EnhancedScrapeResult> {
  const result: EnhancedScrapeResult = {
    team_members: [],
    tech_stack: [],
    social_links: {},
    phone_numbers: [],
    locations: [],
  };

  if (!website) return result;

  try {
    const baseUrl = website.startsWith("http") ? website : `https://${website}`;
    const origin = new URL(baseUrl).origin;

    // Fetch multiple pages in parallel
    const pagePaths = [
      "",                    // homepage
      "/about",
      "/about-us",
      "/team",
      "/our-team",
      "/leadership",
      "/careers",
      "/jobs",
    ];

    const pages = await Promise.allSettled(
      pagePaths.map(path => fetchPageSafe(`${origin}${path}`, 5000))
    );

    const allHtml: string[] = [];
    for (const page of pages) {
      if (page.status === "fulfilled" && page.value) {
        allHtml.push(page.value);
      }
    }

    if (allHtml.length === 0) return result;

    // Combine all HTML for analysis
    const combinedHtml = allHtml.join("\n");
    const homepageHtml = allHtml[0] || "";

    // 1. Tech stack detection (primarily from homepage)
    result.tech_stack = detectTechStack(homepageHtml);

    // 2. Team members (from all pages, especially team/about)
    const seenNames = new Set<string>();
    for (const html of allHtml) {
      const members = extractTeamMembers(html);
      for (const m of members) {
        if (!seenNames.has(m.name.toLowerCase())) {
          seenNames.add(m.name.toLowerCase());
          result.team_members.push(m);
        }
      }
    }

    // 3. Social links (from homepage)
    result.social_links = extractSocialLinks(homepageHtml);
    // Fill from other pages if missing
    if (!result.social_links.linkedin) {
      const links = extractSocialLinks(combinedHtml);
      if (links.linkedin) result.social_links.linkedin = links.linkedin;
    }

    // 4. Phone numbers
    result.phone_numbers = extractPhoneNumbers(combinedHtml);

    // 5. Legal entity name
    result.legal_entity_name = extractLegalEntity(combinedHtml);

    // 6. Careers count (growth signal)
    const careersHtml = allHtml.slice(6).join("\n"); // /careers and /jobs pages
    if (careersHtml) {
      result.careers_count = countCareersListings(careersHtml);
    }

    // 7. Location extraction from footer/contact
    const locationPatterns = [
      /(?:headquartered?|located|based)\s+in\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+){0,3})/g,
      /<address[^>]*>([\s\S]{10,200}?)<\/address>/gi,
    ];
    for (const pattern of locationPatterns) {
      let match;
      while ((match = pattern.exec(combinedHtml)) !== null && result.locations.length < 5) {
        const loc = match[1].replace(/<[^>]+>/g, "").trim();
        if (loc.length >= 3 && loc.length <= 100) {
          result.locations.push(loc);
        }
      }
    }

    console.log(`[ENHANCED SCRAPE] ${website}: ${result.team_members.length} team members, ${result.tech_stack.length} tech items, ${result.careers_count || 0} job listings, ${Object.keys(result.social_links).length} social links`);
    return result;
  } catch (e: any) {
    console.log(`[ENHANCED SCRAPE] Failed for ${website} (non-fatal): ${e.message}`);
    return result;
  }
}