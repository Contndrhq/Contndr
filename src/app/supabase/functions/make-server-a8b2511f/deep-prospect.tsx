// ══════════════════════════════════════════════════════════════════════════
// Deep Prospecting Engine — SerpAPI-powered Multi-Source Crawler
// Finds leads by crawling LinkedIn, Crunchbase, company pages via Google
// NO Apollo dependency — uses SerpAPI + Google + LinkedIn + directories.
// Enrichment: Hunter.io → Findymail → Pattern Guessing → Email Verification
//
// QUALITY GATE FIX (2026-03-14):
// - Tier2 leads (without email but with name+company+title) are now marked
//   with _preview=true flag so frontend doesn't filter them out
// - Cache loading now includes tier2 leads (previously only kept tier1 w/email)
// - Frontend quality gate accepts _preview flag for leads pending email reveal
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { getTeamMemberIds } from "./team.tsx";
import { verifyEmailBatch } from "./email-verify.tsx";
import { searchPool, saveToPool, getPoolStats, type PoolLead, type SearchCriteria } from "./lead-pool.tsx";
// Note: isValidPersonName & getRoleTier exist in enrichment_agent.tsx but are unused here.
// This file uses its own local isCleanPersonName() and inferSeniority() instead.
import { enrichPhoneNumbers, verifyPhoneNumbers, type DeepPhoneLead } from "./phone-enrichment.tsx";

const app = new Hono();
// CORS is handled by the parent Hono app in index.tsx — no duplicate middleware needed.
console.log('[DEEP PROSPECT] Module loaded successfully');

// ── Title Case (inline for Deno isolation) ──
const SMALL_WORDS = new Set(['a','an','and','as','at','but','by','for','if','in','nor','of','on','or','so','the','to','up','yet','via']);
const UPPER_WORDS = new Set(['llc','inc','co','usa','uk','uae','eu','nyc','la','dc','it','ai','hr','pr','crm','saas','b2b','b2c','seo','api','iot','ceo','cfo','cto','cmo','coo','cro','cio','cso','vp','svp','evp','avp','gm','md','dba','mba','phd','esq','rn','lp','plc','pe','dds','dvm','pa','np','cpa','jd']);

function toTitleCase(str: string | null | undefined): string {
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Name Quality Validator — rejects garbage, partial, or non-human names ──
function isCleanPersonName(firstName: string, lastName: string): boolean {
  const fn = (firstName || "").trim();
  const ln = (lastName || "").trim();
  if (!fn || !ln) return false;
  if (fn.length < 2 || ln.length < 2) return false;
  // Must be primarily alphabetic (allow hyphens, apostrophes, periods for Jr./Sr.)
  const NAME_PART = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\-]{0,24}$/;
  if (!NAME_PART.test(fn) || !NAME_PART.test(ln)) return false;
  // Reject all-uppercase parts >3 chars (likely acronym/company)
  if (fn.length > 3 && fn === fn.toUpperCase()) return false;
  if (ln.length > 3 && ln === ln.toUpperCase()) return false;
  // Reject numeric content
  if (/\d/.test(fn) || /\d/.test(ln)) return false;
  // Reject names that look like companies/keywords
  const JUNK = new Set([
    'company','service','services','business','management','agency','solutions',
    'consulting','enterprise','ventures','partners','team','staff','group',
    'inc','llc','corp','ltd','properties','property','contact','email','phone',
    'data','page','home','about','profile','linkedin','apollo','directory',
    'search','results','people','view','sign','login','signup','admin','user',
    'test','the','and','for','with','from','into','null','undefined','unknown',
    'none','other','hiring','open','looking','seeking','available','freelance',
    'remote','hybrid','onsite','global','international','national','local',
  ]);
  if (JUNK.has(fn.toLowerCase()) || JUNK.has(ln.toLowerCase())) return false;
  // Reject full name >40 chars (sentence fragment)
  if ((fn + " " + ln).length > 40) return false;
  // Reject emoji/unicode junk in names
  if (/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[★☆●○►▶◀◄■□▪▫♦♣♠♥✓✔✗✘✦✧]/u.test(fn + ln)) return false;
  return true;
}

// Strip emoji and unicode decorators from strings
function stripEmoji(str: string): string {
  if (!str) return "";
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27FF}]/gu, "")
    .replace(/[\u{FE00}-\u{FEFF}]/gu, "")
    .replace(/[★☆●○►▶◀◄■□▪▫♦♣♠♥✓✔✗✘✦✧⚡⭐🔥💡🎯🚀💪🏆🌟💼📧📞🔗✅❌🤝💰📈📊🎉👋🙌🛠️✨💎🔑📍]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── SerpAPI Helper Functions ──

// Build search queries for SerpAPI from user filters
function buildSerpQueries(params: {
  person_titles?: string[];
  organization_locations?: string[];
  person_seniorities?: string[];
  q_keywords?: string;
  organization_industries?: string[];
  max_results: number;
}): string[] {
  const queries: string[] = [];
  const { person_titles, organization_locations, person_seniorities, q_keywords, organization_industries } = params;

  // Build LinkedIn-focused queries with titles + locations + industries
  const titles = person_titles?.length ? person_titles : ["CEO", "VP", "Director", "Manager"];
  const locations = organization_locations?.length ? organization_locations : ["United States"];
  const industries = organization_industries?.length ? organization_industries.slice(0, 3) : [];

  // Strategy 1: LinkedIn profiles with specific titles + locations + industries
  for (const title of titles.slice(0, 4)) {
    for (const location of locations.slice(0, 2)) {
      if (industries.length > 0) {
        for (const industry of industries) {
          queries.push(`site:linkedin.com/in \"${title}\" \"${location}\" \"${industry}\"`);
        }
      } else {
        queries.push(`site:linkedin.com/in \"${title}\" \"${location}\"${q_keywords ? ` \"${q_keywords}\"` : ""}`);
      }
    }
  }

  // Strategy 2: Broader LinkedIn — title + industry without location constraint
  // Catches profiles whose Google snippets don't mention their city/state
  if (industries.length > 0) {
    for (const title of titles.slice(0, 2)) {
      for (const industry of industries.slice(0, 2)) {
        queries.push(`site:linkedin.com/in \"${title}\" \"${industry}\" email`);
      }
    }
  }

  // Strategy 3: Keyword + location queries
  if (q_keywords) {
    queries.push(`site:linkedin.com/in \"${q_keywords}\" \"${locations[0] || ""}\"`.trim());
    if (industries.length > 0) {
      queries.push(`site:linkedin.com/in \"${q_keywords}\" \"${industries[0]}\"`);
    }
  }

  // Strategy 4: Crunchbase person + organization queries
  if (industries.length > 0) {
    for (const industry of industries.slice(0, 2)) {
      queries.push(`site:crunchbase.com/person \"${titles[0] || "CEO"}\" \"${industry}\"`);
      for (const location of locations.slice(0, 1)) {
        queries.push(`site:crunchbase.com/organization \"${industry}\" \"${location}\"`);
      }
    }
  }
  if (q_keywords) {
    queries.push(`site:crunchbase.com/person \"${q_keywords}\"`);
  }

  // Strategy 5: Seniority keyword queries for varied job titles in same seniority band
  const seniorityKeywords: Record<string, string> = {
    c_suite: "CEO OR CTO OR CFO OR COO OR CMO",
    vp: "VP OR \"Vice President\"",
    director: "Director OR \"Head of\"",
    manager: "Manager OR \"Team Lead\"",
  };
  if (person_seniorities?.length && industries.length > 0) {
    for (const sen of person_seniorities.slice(0, 2)) {
      const kw = seniorityKeywords[sen];
      if (kw) {
        queries.push(`site:linkedin.com/in (${kw}) \"${industries[0]}\" \"${locations[0] || ""}\"`.trim());
      }
    }
  }

  return queries.slice(0, 18); // Cap at 18 queries for better coverage
}

// Perform SerpAPI search
async function serpSearch(query: string, apiKey: string, num: number, offset: number): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: apiKey,
      num: String(num),
      start: String(offset),
    });

    const response = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[SERP] Search failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    return data.organic_results || [];
  } catch (err: any) {
    console.warn(`[SERP] Search error for "${query}": ${err.message}`);
    return [];
  }
}

// Parse a SerpAPI search result into ParsedPerson format
// ── QUALITY-FIRST: rejects anything that isn't a clean, real person ──
function parseSearchResult(result: any): ParsedPerson | null {
  try {
    const url = result.link || "";
    const rawTitle = result.title || "";
    const rawSnippet = result.snippet || "";

    // Pre-clean: strip emoji/unicode decorators from all inputs
    const title = stripEmoji(rawTitle);
    const snippet = stripEmoji(rawSnippet);

    // LinkedIn profile parsing
    if (url.includes("linkedin.com/in/")) {
      // Extract name from title (e.g., "John Doe - CEO at Acme Corp | LinkedIn")
      // Strip trailing " | LinkedIn" or " – LinkedIn" first
      const cleanTitle = title.replace(/\s*[|–—-]\s*LinkedIn\s*$/i, "").trim();
      const nameMatch = cleanTitle.match(/^([^-–—|]+)/);
      if (!nameMatch) return null;
      
      let fullName = nameMatch[1].trim();
      // Strip trailing comma artifacts: "John Doe," → "John Doe"
      fullName = fullName.replace(/[,;:]+$/, "").trim();
      // Strip credential suffixes: "John Doe MBA" → "John Doe"
      fullName = fullName.replace(/\s+(?:MBA|PhD|MD|CPA|PMP|SHRM|CSM|CFA|PE|RN|LPN|LCSW|PsyD|EdD|JD|Esq|CISSP|CISM|CCNA|AWS|TOGAF|ITIL|Six Sigma|Green Belt|Black Belt|SPHR|PHR|CFP|CLU|ChFC|CRPC|CAIA|FRM|CMA|CIA|CGMA|ACCA|ACA|FCCA)\b.*$/i, "").trim();
      // Strip parenthetical suffixes: "John Doe (He/Him)" or "John Doe (LION)"
      fullName = fullName.replace(/\s*\([^)]*\)\s*$/, "").trim();
      // Strip hashtag/keyword suffixes: "John Doe #OpenToWork"
      fullName = fullName.replace(/\s*#\S+.*$/, "").trim();

      const nameParts = fullName.split(/\s+/).filter(p => p.length >= 2);
      if (nameParts.length < 2 || nameParts.length > 4) return null;

      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ");

      // ── NAME QUALITY GATE ──
      if (!isCleanPersonName(firstName, lastName)) return null;

      // Extract title and company from snippet or title
      let jobTitle = "";
      let company = "";
      let location = "";
      let industry = "";

      // Strategy 1: Snippet "Title at Company · Location · ..."
      // Prioritize "at" pattern (most reliable for company extraction)
      const atSnippetMatch = snippet.match(/^([^·•]+?)\s+at\s+([^·•]+?)(?:\s*[·•]\s*|$)/i);
      if (atSnippetMatch) {
        jobTitle = atSnippetMatch[1].trim();
        company = atSnippetMatch[2].trim();
      } else {
        const titleCompanyMatch = snippet.match(/^([^·•]+?)(?:\s+-\s+)([^·•]+?)(?:\s*[·•]\s*|$)/i);
        if (titleCompanyMatch) {
          jobTitle = titleCompanyMatch[1].trim();
          company = titleCompanyMatch[2].trim();
        }
      }

      // Strategy 2: Title string after name "Name - Title at Company | LinkedIn"
      if (!jobTitle) {
        const afterName = cleanTitle.replace(fullName, "").replace(/^[\s\-–—|]+/, "").trim();
        // "CEO at Acme Corp"
        const atMatch = afterName.match(/^(.+?)\s+(?:at|@)\s+(.+?)$/i);
        if (atMatch) {
          jobTitle = atMatch[1].trim();
          company = company || atMatch[2].trim();
        } else {
          // "CEO | Acme Corp" or "CEO – Acme Corp" or "CEO - Acme Corp"
          const pipeMatch = afterName.match(/^(.+?)\s*[|–—]\s*(.+?)$/i) || afterName.match(/^(.+?)\s+-\s+(.+?)$/i);
          if (pipeMatch) {
            jobTitle = pipeMatch[1].trim();
            company = company || pipeMatch[2].trim();
          } else if (afterName && afterName.length <= 60) {
            jobTitle = afterName.split(/\s*[|·]\s*/)[0] || "";
          }
        }
      }

      // Strategy 3: Snippet first segment before bullet (often "Title at Company")
      if (!jobTitle && snippet) {
        const firstSeg = snippet.split(/\s*[·•]\s*/)[0] || "";
        const segAt = firstSeg.match(/^(.+?)\s+(?:at|@)\s+(.+?)$/i);
        if (segAt) {
          jobTitle = segAt[1].trim();
          company = company || segAt[2].trim();
        }
      }

      // Strategy 4: If we have a title but no company, check if title looks like a company name
      // This happens when LinkedIn profiles show "Company Name" as the headline
      if (jobTitle && !company) {
        // If the "title" has typical company indicators and no typical title keywords, it's probably a company
        const hasCompanyIndicators = /\b(inc|llc|ltd|corp|co\.|company|group|agency|consulting|solutions|services|partners|ventures|enterprises?|industries|technologies)\b/i.test(jobTitle);
        const hasTitleKeywords = /\b(ceo|cto|cfo|coo|cmo|president|director|manager|head|vp|vice|senior|lead|engineer|developer|designer|analyst|specialist|consultant|advisor|founder|partner|owner)\b/i.test(jobTitle);
        
        // If it looks like a company and doesn't look like a title, swap them
        if (hasCompanyIndicators && !hasTitleKeywords && jobTitle.split(/\s+/).length <= 5) {
          company = jobTitle;
          jobTitle = "";
        }
      }

      // Strategy 5: Snippet bullet segments — "Title · Company · Location · ..."
      // Many LinkedIn snippets list company as the 2nd segment without "at" keyword
      if (!company && snippet) {
        const segments = snippet.split(/\s*[·•]\s*/).map((s: string) => s.trim()).filter(Boolean);
        if (segments.length >= 2) {
          const isGarbageSegment = (s: string) =>
            /^(experience|education|about|summary|skills|connections?|see all|view|activity|posts|articles|groups|recommendations?|endorsements?|certifications?|licenses?|projects?|publications?|honors?|awards?|languages?|courses?|volunteering?|organizations?|interests?|causes?|following|followers?|contact info|show more|current|previous|present|services?|products?|analytics|solutions?|features?|pricing|demo|consulting|management|marketing|engineering|development|technology|design|human resources?|finance|operations?|sales|support|strategy|logistics|compliance|legal|training|staffing|recruiting|recruitment|accounting|media|data|research|security|procurement|administration|customer success|information technology|it)[:)]?$/i.test(s)
            || /^\d+\+?\s*(connections?|followers?|endorsements?|years?|months?)$/i.test(s)
            || /^\d+\s*[-–]\s*(present|current|now)/i.test(s)
            || s.length < 2 || s.length > 80;

          for (let si = 1; si < Math.min(segments.length, 4); si++) {
            const seg = segments[si];
            if (isGarbageSegment(seg)) continue;
            const isLocation = /,\s*[A-Z]{2}$/.test(seg) || /,\s*(United|Canada|Australia|India|Germany|France|UK|Brazil|Mexico|Japan|China|Singapore|Netherlands|Sweden|Ireland|Spain|Italy|Switzerland)/i.test(seg);
            if (isLocation) continue;
            if (jobTitle && seg.toLowerCase() === jobTitle.toLowerCase()) continue;
            if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/i.test(seg) && /\d{4}/.test(seg)) continue;
            const wordCount = seg.split(/\s+/).length;
            if (wordCount >= 1 && wordCount <= 8 && /^[A-Z]/.test(seg)) {
              company = seg;
              break;
            }
          }
        }
      }

      // Strategy 6: Check SerpAPI rich_snippet for structured company data
      if (!company && result.rich_snippet) {
        const rs = result.rich_snippet;
        if (rs.top?.extensions && Array.isArray(rs.top.extensions)) {
          for (const ext of rs.top.extensions) {
            const extStr = String(ext).trim();
            if (!extStr || extStr.length > 80) continue;
            if (jobTitle && extStr.toLowerCase() === jobTitle.toLowerCase()) continue;
            if (/,\s*[A-Z]{2}$/.test(extStr)) continue;
            if (/^(experience|education|connections?|followers?|linkedin|services?|products?|analytics|solutions?|features?|pricing|consulting|management|marketing|engineering|development|technology|design|finance|operations?|sales|support|strategy|training|recruiting|recruitment|media|data|research|security)/i.test(extStr)) continue;
            if (/^[A-Z]/.test(extStr) && extStr.split(/\s+/).length <= 8) {
              company = extStr;
              break;
            }
          }
        }
        if (!company && rs.top?.detected_extensions) {
          const de = rs.top.detected_extensions;
          if (de.company) company = String(de.company).trim();
          else if (de.organization) company = String(de.organization).trim();
        }
      }

      // Clean: strip "LinkedIn" from company if accidentally captured
      company = company.replace(/\bLinkedIn\b/gi, "").trim();
      // Clean: strip trailing connection counts "500+ connections"
      company = company.replace(/\d+\+?\s*connections?\s*$/i, "").trim();
      // Clean: strip "See all" / "View profile" artifacts
      company = company.replace(/\b(?:see all|view profile|view|more)\b.*$/i, "").trim();

      // Extract location from snippet (usually between bullets)
      // ── LOCATION_GARBAGE: LinkedIn section headers, service labels, and other non-location noise ──
      const LOCATION_GARBAGE_RE = /^(experience|education|about|summary|skills|connections|see all|view|activity|posts|articles|groups|recommendations?|endorsements?|certifications?|licenses?|projects?|publications?|honors?|awards?|languages?|courses?|volunteering?|organizations?|interests?|causes?|following|followers?|contact info|show more|services?|products?|analytics|solutions?|features?|pricing|demo|consulting|management|marketing|engineering|development|technology|design|human resources?|finance|operations?|sales|support|strategy|logistics|compliance|legal|training|staffing|recruiting|recruitment|accounting|media|data|research|security|procurement|administration|customer success|information technology|it|full[- ]?time|part[- ]?time|contract|freelance|intern(?:ship)?|self[- ]?employed|seasonal|temporary)[:)]?$/i;

      // Prefer the strongest location signal first: scan ALL segments for "City, ST" or "City, Country"
      if (snippet) {
        const allSegs = snippet.split(/\s*[·•]\s*/).map((s: string) => s.trim()).filter(Boolean);
        for (const seg of allSegs) {
          if (LOCATION_GARBAGE_RE.test(seg)) continue;
          if (/^\d+\+?\s*(connections?|followers?|endorsements?)$/i.test(seg)) continue;
          if (seg.length < 3 || seg.length > 60) continue;
          if (/:\s/.test(seg)) continue;
          // Strong signal: "City, ST" (US states) or "City, Country"
          if (/,\s*[A-Z]{2}$/.test(seg) || /,\s*(United|Canada|Australia|India|Germany|France|UK|Brazil|Mexico|Japan|China|Singapore|Netherlands|Sweden|Ireland|Spain|Italy|Switzerland|Austria|Belgium|Norway|Denmark|Finland|Poland|Portugal|Israel|New Zealand|South Africa|Argentina|Chile|Colombia|Peru|Egypt|Turkey|Saudi|Emirates|Qatar|Kuwait|Bahrain|Oman|Lebanon|Jordan|Greece|Czech|Hungary|Romania|Bulgaria|Croatia|Serbia|Slovakia|Slovenia|Estonia|Latvia|Lithuania|Iceland|Luxembourg|Malta|Cyprus|Korea|Taiwan|Hong Kong|Macau|Thailand|Vietnam|Philippines|Indonesia|Malaysia)/i.test(seg)) {
            location = seg;
            break;
          }
        }
        // Fallback: look for known metro areas in segments
        if (!location) {
          const METRO_RE = /\b(new york|los angeles|san francisco|chicago|boston|seattle|austin|denver|miami|atlanta|dallas|houston|phoenix|philadelphia|washington|portland|nashville|charlotte|raleigh|san diego|san jose|minneapolis|detroit|tampa|orlando|pittsburgh|salt lake|las vegas|sacramento|columbus|baltimore|london|toronto|vancouver|sydney|melbourne|berlin|munich|paris|amsterdam|dublin|bangalore|mumbai|delhi|hyderabad|pune|chennai|tokyo|shanghai|beijing|hong kong|singapore|dubai|tel aviv|rio de janeiro|buenos aires|mexico city|cape town|johannesburg|lagos|cairo|nairobi)\b/i;
          for (const seg of allSegs) {
            if (LOCATION_GARBAGE_RE.test(seg)) continue;
            if (/^\d+\+?\s*(connections?|followers?|endorsements?)$/i.test(seg)) continue;
            if (seg.length < 3 || seg.length > 60) continue;
            if (/:\s/.test(seg)) continue;
            if (METRO_RE.test(seg)) {
              location = seg;
              break;
            }
          }
        }
        // Last fallback: original regex approach with improved garbage filter
        if (!location) {
          const locationMatch = snippet.match(/[·•]\s*([^·•]{3,40}?(?:,\s*[A-Z]{2})?(?:,\s*[A-Za-z\s]+)?)\s*[·•]/);
          if (locationMatch) {
            const potentialLocation = locationMatch[1].trim();
            const isGarbage = LOCATION_GARBAGE_RE.test(potentialLocation)
              || /^\d+\+?\s*(connections?|followers?|endorsements?)$/i.test(potentialLocation)
              || /:\s/.test(potentialLocation)
              || potentialLocation.length < 3;
            if (!isGarbage) {
              location = potentialLocation;
            }
          }
        }
      }

      // Extract industry hint from snippet
      const industryMatch = snippet.match(/(?:in|industry|sector)[\s:]+([A-Za-z\s&,]+?)(?:[·•]|$)/i);
      if (industryMatch) {
        industry = industryMatch[1].trim();
      }

      // Final cleanup: strip emoji from title/company
      jobTitle = stripEmoji(jobTitle);
      company = stripEmoji(company);

      return {
        name: fullName,
        first_name: firstName,
        last_name: lastName,
        title: jobTitle,
        company: company,
        linkedin_url: url,
        location: location,
        snippet: snippet.substring(0, 200),
        source_url: url,
        source_type: "linkedin",
        seniority: inferSeniority(jobTitle),
        industry: industry,
        estimated_num_employees: 0,
      };
    }

    // Crunchbase profile parsing
    if (url.includes("crunchbase.com/person/")) {
      const nameMatch = title.match(/^([^-–—|]+)/);
      if (!nameMatch) return null;

      let fullName = nameMatch[1].trim().replace(/[,;:]+$/, "").trim();
      const nameParts = fullName.split(/\s+/).filter(p => p.length >= 2);
      if (nameParts.length < 2 || nameParts.length > 4) return null;

      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ");

      // ── NAME QUALITY GATE ──
      if (!isCleanPersonName(firstName, lastName)) return null;

      // Extract title and company from snippet
      let jobTitle = "";
      let company = "";
      const roleMatch = snippet.match(/(?:is\s+(?:a|an|the)\s+)?([^.]+?)\s+(?:at|of|for)\s+([^.]+)/i);
      if (roleMatch) {
        jobTitle = stripEmoji(roleMatch[1].trim());
        company = stripEmoji(roleMatch[2].trim());
      }

      return {
        name: fullName,
        first_name: firstName,
        last_name: lastName,
        title: jobTitle,
        company: company,
        linkedin_url: "",
        location: "",
        snippet: snippet.substring(0, 200),
        source_url: url,
        source_type: "crunchbase",
        seniority: inferSeniority(jobTitle),
        industry: "",
        estimated_num_employees: 0,
      };
    }

    return null;
  } catch (err) {
    return null;
  }
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
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "DEEP-PROSPECT");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── DeepLead type — matches frontend lead format ──
interface DeepLead {
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
}

// ── Parse person from Google search result (LinkedIn, Crunchbase, web) ──
interface ParsedPerson {
  name: string;
  first_name: string;
  last_name: string;
  title: string;
  company: string;
  linkedin_url: string;
  location: string;
  snippet: string;
  source_url: string;
  source_type: string; // "linkedin" | "crunchbase" | "web"
  seniority: string;
  industry: string;
  estimated_num_employees: number;
}

function inferSeniority(title: string): string {
  if (!title) return "";
  const t = title.toLowerCase();
  if (/\b(owner|proprietor)\b/.test(t)) return "owner";
  if (/\b(founder|co-?founder)\b/.test(t)) return "founder";
  if (/\b(ceo|cfo|cto|coo|cmo|cro|cpo|cio|chro|cso|cdo)\b/.test(t)) return "c_suite";
  if (/\bchief\s/.test(t)) return "c_suite";
  if (/\bpresident\b/.test(t) && !/vice[\s-]?president/.test(t)) return "c_suite";
  if (/\bpartner\b/.test(t)) return "partner";
  if (/\b(vp|vice[\s-]?president|svp|evp|avp)\b/.test(t)) return "vp";
  if (/\bhead\s+(of\s+)?/.test(t)) return "head";
  if (/\b(director|managing\s+director)\b/.test(t)) return "director";
  if (/\b(manager|general\s+manager)\b/.test(t)) return "manager";
  if (/\b(senior|sr\.?|principal|lead)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|associate|assistant|intern|trainee|entry)\b/.test(t)) return "entry";
  return ""; // Never return "unknown" — empty means genuinely unresolvable
}

// ── Strict industry filter — enforce exact industry match when industries are selected ──
function matchesIndustryFilter(lead: DeepLead, selectedIndustries?: string[]): boolean {
  if (!selectedIndustries || selectedIndustries.length === 0) return true; // No filter = pass all

  const leadIndustry = (lead.organization?.industry || "").toLowerCase().trim();
  const leadName = lead.name || 'Unknown';
  
  console.log(`[FILTER] Checking ${leadName}: industry="${leadIndustry}" against [${selectedIndustries.join(', ')}]`);

  // If we have a real industry value, match strictly
  if (leadIndustry) {
    for (const selected of selectedIndustries) {
      const sel = selected.toLowerCase().trim();
      // Exact match
      if (leadIndustry === sel) {
        console.log(`[FILTER] ✓ ${leadName}: EXACT match "${leadIndustry}" === "${sel}"`);
        return true;
      }
      // Lead industry contains the selected industry (e.g. "Life Insurance" contains "Insurance")
      if (leadIndustry.includes(sel)) {
        console.log(`[FILTER] ✓ ${leadName}: CONTAINS match "${leadIndustry}".includes("${sel}")`);
        return true;
      }
      // Selected industry contains the lead industry (e.g. "Insurance" contains lead's "Insurance")
      if (sel.includes(leadIndustry)) {
        console.log(`[FILTER] ✓ ${leadName}: REVERSE CONTAINS match "${sel}".includes("${leadIndustry}")`);
        return true;
      }
      // Word-boundary match for compound industries — split on common separators
      // e.g. "Health, Wellness & Fitness" should match "Health" or "Fitness"
      const leadWords = leadIndustry.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
      const selWords = sel.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
      for (const lw of leadWords) {
        for (const sw of selWords) {
          if (lw === sw) {
            console.log(`[FILTER] ✓ ${leadName}: WORD match "${lw}" === "${sw}"`);
            return true;
          }
          if (lw.includes(sw) && sw.length >= 4) {
            console.log(`[FILTER] ✓ ${leadName}: WORD CONTAINS match "${lw}".includes("${sw}")`);
            return true;
          }
          if (sw.includes(lw) && lw.length >= 4) {
            console.log(`[FILTER] ✓ ${leadName}: WORD REVERSE match "${sw}".includes("${lw}")`);
            return true;
          }
        }
      }
    }
    console.log(`[FILTER] ✗ ${leadName}: REJECTED - industry "${leadIndustry}" doesn't match any selected`);
    return false; // Has industry but doesn't match any selected
  }

  // No industry on lead — check company description as last resort
  const desc = (lead.organization?.short_description || "").toLowerCase();
  if (desc) {
    for (const selected of selectedIndustries) {
      const sel = selected.toLowerCase().trim();
      // Only match if the description explicitly contains the industry term
      // and the term is substantial (>=5 chars) to avoid false positives
      if (sel.length >= 5 && desc.includes(sel)) {
        console.log(`[FILTER] ✓ ${leadName}: DESCRIPTION match in "${desc.substring(0, 50)}..."`);
        return true;
      }
    }
  }

  console.log(`[FILTER] ✗ ${leadName}: REJECTED - no industry data`);
  return false; // No industry data at all = reject when filter is active
}

// ── Strict location filter — enforce exact location match when locations are selected ──
function matchesLocationFilter(lead: DeepLead, selectedLocations?: string[]): boolean {
  if (!selectedLocations || selectedLocations.length === 0) return true; // No filter = pass all

  const leadCity = (lead.city || lead.organization?.city || "").toLowerCase().trim();
  const leadState = (lead.state || lead.organization?.state || "").toLowerCase().trim();
  const leadCountry = (lead.country || lead.organization?.country || "").toLowerCase().trim();

  // If the lead has no location data at all, reject it when location filter is active
  if (!leadCity && !leadState && !leadCountry) return false;

  // Lead must match at least ONE of the searched locations
  for (const loc of selectedLocations) {
    const parts = loc.toLowerCase().split(",").map((p: string) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    // ALL parts of this location must appear in the lead's city/state/country
    const allPartsMatch = parts.every((part: string) => {
      if (part.length < 2) return true; // skip trivially short parts
      return leadCity.includes(part) || leadState.includes(part) || leadCountry.includes(part);
    });

    if (allPartsMatch) return true;
  }

  return false; // Doesn't match any searched location
}

// ── Generic / role-based email detector — blocks info@, sales@, etc. ──
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
  'operations', 'ops', 'finance', 'accounting', 'payroll', 'ap',
  'ar', 'invoices', 'invoice', 'payments', 'pay', 'donate',
  'donations', 'membership', 'members', 'community', 'volunteer',
]);

function isGenericEmail(email: string): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  const atIdx = lower.indexOf('@');
  if (atIdx <= 0) return false;
  const prefix = lower.substring(0, atIdx);
  if (GENERIC_PREFIXES.has(prefix)) return true;
  const stripped = prefix.replace(/\d+$/, '');
  if (stripped !== prefix && GENERIC_PREFIXES.has(stripped)) return true;
  return false;
}

// ── Quality gate — reject leads that don't have essential data ──
function isQualityLead(lead: DeepLead): boolean {
  // ═══ HARD REQUIREMENT: Must have an email — no email, no deal ═══
  if (!lead.email?.trim()) return false;

  // ═══ BLOCK GENERIC EMAILS — decision makers only ═══
  if (isGenericEmail(lead.email)) {
    console.log(`[QUALITY] Rejected generic email: ${lead.email} (${lead.name})`);
    return false;
  }

  // Must have a real person name (not empty or just dashes)
  const name = (lead.name || "").trim();
  if (!name || name === "—" || name === "-") return false;
  if (!lead.first_name?.trim() || !lead.last_name?.trim()) return false;

  // ── Name quality: must pass strict validation ──
  if (!isCleanPersonName(lead.first_name, lead.last_name)) return false;

  // Must have a real company name (not empty, not just the search keyword echoed back)
  const companyName = (lead.organization?.name || "").trim();
  if (!companyName || companyName === "—" || companyName === "-") return false;

  // Run company name through cleanCompanyName — if it returns empty, the name is garbage
  const cleanedCompany = cleanCompanyName(companyName);
  if (!cleanedCompany) {
    console.log(`[QUALITY] Rejected garbage company name: "${companyName}" (${lead.name})`);
    return false;
  }

  // Company name must be at least 2 chars and not a generic word
  if (cleanedCompany.length < 2) return false;
  const JUNK_COMPANY = new Set([
    "saas", "b2b", "b2c", "ai", "it", "hr", "tech", "software", "company",
    "business", "unknown", "n/a", "na", "none", "undefined", "null", "other",
    "service", "services", "agency", "group", "corp", "inc", "linkedin",
  ]);
  if (JUNK_COMPANY.has(cleanedCompany.toLowerCase())) return false;

  // Reject company names that are >80 chars (likely a description, not a name)
  if (companyName.length > 80) return false;

  // STRICT: Must have a real job title — no title = incomplete data
  const titleClean = (lead.title || "").trim();
  if (!titleClean) return false;
  // Reject title if it's a sentence (>8 words without a role keyword)
  const titleWords = titleClean.split(/\s+/);
  if (titleWords.length > 8) return false;

  return true;
}

// ── Clean a DeepLead in-place — strips emoji, normalizes spacing ──
function sanitizeDeepLead(lead: DeepLead): void {
  lead.first_name = stripEmoji(lead.first_name);
  lead.last_name = stripEmoji(lead.last_name);
  lead.name = stripEmoji(lead.name);
  lead.title = stripEmoji(lead.title);
  if (lead.organization) {
    lead.organization.name = stripEmoji(lead.organization.name);
    lead.organization.short_description = stripEmoji(lead.organization.short_description);
    lead.organization.industry = stripEmoji(lead.organization.industry);
  }
}

// ── Clean job titles: strip sentence-like content, normalize formatting ──
function cleanJobTitle(raw: string): string {
  if (!raw) return "";
  let t = stripEmoji(raw).trim();
  if (!t) return "";

  // Strip "at Company" or "@ Company" suffixes
  t = t.replace(/\s+(?:at|@)\s+.+$/i, "").trim();

  // Strip "| Company" or "– Company" or " - Company" trailing parts (only if there's a role before)
  t = t.replace(/\s*[|–—]\s*[A-Z].+$/, "").trim();
  // Also strip " - Company" with regular hyphen (spaced to avoid "Co-Founder")
  t = t.replace(/\s+-\s+[A-Z][A-Za-z\s&.,]+$/, "").trim();

  // Detect sentence-like titles (LinkedIn headlines that aren't real titles)
  const SENTENCE_INDICATORS = /^(i |we |my |our |a |the |an |helping |passionate |dedicated |experienced |results|driving |building |creating |empowering |enabling |transforming |committed |focused on |specializ|leverag|proven |award|over \d|with \d+|seeking |looking )/i;
  if (SENTENCE_INDICATORS.test(t)) {
    const realPart = t.match(/^([\w\s/&-]+?)\s+(?:who|that|with|helping|passionate|dedicated|\||[-–—]|\.)/i);
    if (realPart && realPart[1].length >= 3 && realPart[1].length <= 45) {
      t = realPart[1].trim();
    } else {
      return ""; // Fully sentence-like, no salvageable title
    }
  }

  // Kill phrase patterns: "and" + verb = sentence not title
  if (/\b(and|to|for|in|the|that|this)\b.*\b(help|grow|drive|build|lead|create|deliver|enable|provide|improve|support|manage|develop|transform|solve|make|ensure)\b/i.test(t)) {
    const fragment = t.match(/^([\w\s/&-]{3,35}?)(?:\s+(?:and|who|that|with|helping|to|for)\s)/i);
    if (fragment) {
      t = fragment[1].trim();
    } else {
      return "";
    }
  }

  // Strip trailing sentence fragments
  t = t.replace(/\s*(?:specializ\w+|focused on|passionate about|with expertise|responsible for|helping|dedicated to|committed to|looking to|seeking to|striving)\s+.*/i, "").trim();

  // Strip parenthetical qualifiers: "CEO (retired)", "VP (Interim)"
  t = t.replace(/\s*\([^)]*\)\s*/g, " ").trim();

  // Strip quotes
  t = t.replace(/["""'']/g, "").trim();

  // Normalize separators: " / " → "/"  and multiple spaces
  t = t.replace(/\s*\/\s*/g, "/").replace(/\s{2,}/g, " ");

  // Strip trailing punctuation (periods, commas)
  t = t.replace(/[.,;:!]+$/, "").trim();

  // Strip leading articles
  t = t.replace(/^(a |an |the )/i, "").trim();

  // Cap at 50 chars — truncate at last word boundary
  if (t.length > 50) {
    t = t.substring(0, 50).replace(/\s+\S*$/, "").trim();
  }

  // Reject overly long non-title text (>6 words without a title keyword)
  const words = t.split(/\s+/);
  if (words.length > 6 && !/\b(officer|president|director|manager|head|lead|chief|founder|owner|partner|vp|svp|evp|avp|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive)\b/i.test(t)) {
    return "";
  }

  // Final sanity: reject sentence words in >3-word strings
  if (/\b(you|your|they|them|their|us|we|our|my|me|his|her|its|this|that|those|these|would|could|should|will|shall|can|may|might|must|been|being|have|has|had|are|were|was|am|is|do|does|did)\b/i.test(t) && words.length > 3) {
    return "";
  }

  return t;
}

// ── Standardize job titles to proper canonical forms ──
const TITLE_ACRONYMS = new Set([
  "CEO", "CTO", "CFO", "COO", "CMO", "CIO", "CISO", "CRO", "CPO", "CLO", "CHRO",
  "VP", "SVP", "EVP", "AVP", "MD", "GM", "IT", "HR", "PR", "AI", "ML", "UX", "UI",
  "QA", "BA", "PM", "PO", "DBA", "SRE", "DevOps", "BDR", "SDR", "AE", "CSM",
]);
const TITLE_ABBREVIATION_MAP: Record<string, string> = {
  "sr": "Senior", "snr": "Senior",
  "jr": "Junior", "jnr": "Junior",
  "mgr": "Manager", "dir": "Director",
  "eng": "Engineer", "dev": "Developer",
  "admin": "Administrator", "coord": "Coordinator",
  "assoc": "Associate", "asst": "Assistant",
  "exec": "Executive", "acct": "Account",
  "ops": "Operations", "mktg": "Marketing",
  "comms": "Communications", "svcs": "Services",
  "mgmt": "Management", "intl": "International",
  "natl": "National", "dept": "Department",
  "tech": "Technology", "info": "Information",
  "fin": "Financial", "biz": "Business", "govt": "Government",
};
const TITLE_LOWERCASE_WORDS = new Set(["of", "and", "the", "in", "at", "for", "to", "a", "an", "or", "on", "by", "with"]);

function standardizeJobTitle(raw: string): string {
  if (!raw) return "";
  let t = raw.trim();
  if (!t) return "";
  const words = t.split(/\s+/);
  const result: string[] = [];
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    // Check abbreviation map (strip trailing dot for lookup)
    const abbrevKey = w.toLowerCase().replace(/\.$/, "");
    if (TITLE_ABBREVIATION_MAP[abbrevKey]) { result.push(TITLE_ABBREVIATION_MAP[abbrevKey]); continue; }
    // Check known acronyms
    const upperW = w.toUpperCase();
    let isAcronym = false;
    for (const acr of TITLE_ACRONYMS) {
      if (acr.toUpperCase() === upperW) { result.push(acr); isAcronym = true; break; }
    }
    if (isAcronym) continue;
    // Slash-separated: "VP/Director"
    if (w.includes("/")) {
      result.push(w.split("/").map(p => {
        const pu = p.toUpperCase();
        for (const acr of TITLE_ACRONYMS) { if (acr.toUpperCase() === pu) return acr; }
        return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
      }).join("/"));
      continue;
    }
    // Hyphenated: "Co-Founder"
    if (w.includes("-") && !w.startsWith("-")) {
      result.push(w.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("-"));
      continue;
    }
    // Minor words lowercase (except first)
    if (i > 0 && TITLE_LOWERCASE_WORDS.has(w.toLowerCase())) { result.push(w.toLowerCase()); continue; }
    // Default: title case
    result.push(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return result.join(" ");
}

// ── Standard industry taxonomy (Apollo/LinkedIn standard) ──
const STANDARD_INDUSTRIES = [
  "Accounting", "Advertising", "Aerospace & Defense", "Agriculture",
  "Airlines & Aviation", "Alternative Medicine", "Animation",
  "Apparel & Fashion", "Architecture & Planning", "Arts & Crafts",
  "Automotive", "Aviation & Aerospace", "Banking", "Biotechnology",
  "Broadcast Media", "Building Materials", "Business Supplies & Equipment",
  "Capital Markets", "Chemicals", "Civic & Social Organization",
  "Civil Engineering", "Commercial Real Estate",
  "Computer & Network Security", "Computer Games", "Computer Hardware",
  "Computer Networking", "Computer Software", "Construction",
  "Consumer Electronics", "Consumer Goods", "Consumer Services",
  "Cosmetics", "Dairy", "Defense & Space", "Design", "E-Learning",
  "Education Management", "Electrical & Electronic Manufacturing",
  "Entertainment", "Environmental Services", "Events Services",
  "Executive Office", "Facilities Services", "Farming",
  "Financial Services", "Fine Art", "Fishery", "Food & Beverages",
  "Food Production", "Fund-Raising", "Furniture",
  "Gambling & Casinos", "Glass, Ceramics & Concrete",
  "Government Administration", "Government Relations", "Graphic Design",
  "Health, Wellness & Fitness", "Higher Education",
  "Hospital & Health Care", "Hospitality", "Human Resources",
  "Import & Export", "Individual & Family Services",
  "Industrial Automation", "Information Services",
  "Information Technology & Services", "Insurance",
  "International Affairs", "International Trade & Development",
  "Internet", "Investment Banking", "Investment Management",
  "Judiciary", "Law Enforcement", "Law Practice", "Legal Services",
  "Legislative Office", "Leisure, Travel & Tourism", "Libraries",
  "Logistics & Supply Chain", "Luxury Goods & Jewelry", "Machinery",
  "Management Consulting", "Maritime", "Market Research",
  "Marketing & Advertising", "Mechanical or Industrial Engineering",
  "Media Production", "Medical Devices", "Medical Practice",
  "Mental Health Care", "Military", "Mining & Metals",
  "Motion Pictures & Film", "Museums & Institutions", "Music",
  "Nanotechnology", "Newspapers",
  "Non-Profit Organization Management", "Oil & Energy",
  "Online Media", "Outsourcing/Offshoring",
  "Package/Freight Delivery", "Packaging & Containers",
  "Paper & Forest Products", "Performing Arts", "Pharmaceuticals",
  "Philanthropy", "Photography", "Plastics",
  "Political Organization", "Primary/Secondary Education", "Printing",
  "Professional Training & Coaching", "Program Development",
  "Public Policy", "Public Relations & Communications",
  "Public Safety", "Publishing", "Railroad Manufacture", "Ranching",
  "Real Estate", "Recreational Facilities & Services",
  "Religious Institutions", "Renewables & Environment", "Research",
  "Restaurants", "Retail", "Security & Investigations",
  "Semiconductors", "Shipbuilding", "Sporting Goods", "Sports",
  "Staffing & Recruiting", "Supermarkets", "Telecommunications",
  "Textiles", "Think Tanks", "Tobacco",
  "Translation & Localization", "Transportation/Trucking/Railroad",
  "Utilities", "Venture Capital & Private Equity", "Veterinary",
  "Warehousing", "Wholesale", "Wine & Spirits", "Wireless",
  "Writing & Editing",
  // Extended: common local service industries
  "Moving & Storage", "Plumbing", "HVAC", "Roofing", "Landscaping",
  "Cleaning Services", "Pest Control", "Electrical Services", "Painting",
  "Flooring", "Home Remodeling", "Beauty & Personal Care", "Child Care",
  "Chiropractic", "Dental", "Media Production",
];

const INDUSTRY_ALIAS_MAP: Record<string, string> = {
  "it": "Information Technology & Services", "tech": "Information Technology & Services",
  "technology": "Information Technology & Services", "information technology": "Information Technology & Services",
  "it services": "Information Technology & Services", "saas": "Computer Software",
  "software": "Computer Software", "software development": "Computer Software",
  "fintech": "Financial Services", "finance": "Financial Services",
  "financial": "Financial Services", "banking & finance": "Banking",
  "healthcare": "Hospital & Health Care", "health care": "Hospital & Health Care",
  "medical": "Medical Practice", "health": "Health, Wellness & Fitness",
  "wellness": "Health, Wellness & Fitness", "fitness": "Health, Wellness & Fitness",
  "biotech": "Biotechnology", "pharma": "Pharmaceuticals", "pharmaceutical": "Pharmaceuticals",
  "edtech": "E-Learning", "e-learning": "E-Learning", "education": "Education Management",
  "higher ed": "Higher Education", "k-12": "Primary/Secondary Education",
  "legal": "Legal Services", "law": "Law Practice",
  "marketing": "Marketing & Advertising", "advertising": "Marketing & Advertising",
  "digital marketing": "Marketing & Advertising", "media": "Media Production",
  "film": "Motion Pictures & Film", "consulting": "Management Consulting",
  "management consulting": "Management Consulting", "staffing": "Staffing & Recruiting",
  "recruiting": "Staffing & Recruiting", "hr": "Human Resources",
  "human resources": "Human Resources", "real estate": "Real Estate", "property": "Real Estate",
  "ecommerce": "Internet", "e-commerce": "Internet", "retail": "Retail",
  "food": "Food & Beverages", "restaurant": "Restaurants", "hospitality": "Hospitality",
  "travel": "Leisure, Travel & Tourism", "tourism": "Leisure, Travel & Tourism",
  "manufacturing": "Mechanical or Industrial Engineering", "automotive": "Automotive",
  "energy": "Oil & Energy", "oil & gas": "Oil & Energy", "oil and gas": "Oil & Energy",
  "renewables": "Renewables & Environment", "clean energy": "Renewables & Environment",
  "environmental": "Environmental Services", "telecom": "Telecommunications",
  "telecommunications": "Telecommunications", "logistics": "Logistics & Supply Chain",
  "supply chain": "Logistics & Supply Chain",
  "transportation": "Transportation/Trucking/Railroad", "trucking": "Transportation/Trucking/Railroad",
  "government": "Government Administration", "public sector": "Government Administration",
  "military": "Military", "defense": "Aerospace & Defense", "aerospace": "Aerospace & Defense",
  "insurance": "Insurance", "nonprofit": "Non-Profit Organization Management",
  "non-profit": "Non-Profit Organization Management", "ngo": "Non-Profit Organization Management",
  "security": "Computer & Network Security", "cybersecurity": "Computer & Network Security",
  "cyber security": "Computer & Network Security", "gaming": "Computer Games",
  "video games": "Computer Games", "publishing": "Publishing", "printing": "Printing",
  "design": "Design", "graphic design": "Graphic Design",
  "architecture": "Architecture & Planning", "construction": "Construction",
  "hardware": "Computer Hardware", "semiconductor": "Semiconductors",
  "semiconductors": "Semiconductors", "networking": "Computer Networking",
  "cloud": "Information Technology & Services", "ai": "Information Technology & Services",
  "artificial intelligence": "Information Technology & Services",
  "machine learning": "Information Technology & Services",
  "data": "Information Services", "analytics": "Information Services",
  "venture capital": "Venture Capital & Private Equity",
  "private equity": "Venture Capital & Private Equity",
  "investment": "Investment Management", "wealth management": "Investment Management",
  "sports": "Sports", "entertainment": "Entertainment", "music": "Music",
  "photography": "Photography", "cosmetics": "Cosmetics", "beauty": "Cosmetics",
  "fashion": "Apparel & Fashion", "luxury": "Luxury Goods & Jewelry",
  "jewelry": "Luxury Goods & Jewelry", "agriculture": "Agriculture", "farming": "Farming",
  "chemicals": "Chemicals", "plastics": "Plastics", "mining": "Mining & Metals",
  "metals": "Mining & Metals", "utilities": "Utilities", "consumer goods": "Consumer Goods",
  "consumer services": "Consumer Services", "professional services": "Management Consulting",
  "professional training": "Professional Training & Coaching",
  "training": "Professional Training & Coaching", "coaching": "Professional Training & Coaching",
  "research": "Research", "clinical research": "Research",
  "public relations": "Public Relations & Communications",
  "pr": "Public Relations & Communications", "communications": "Public Relations & Communications",
  "events": "Events Services", "warehousing": "Warehousing", "wholesale": "Wholesale",
  "import/export": "Import & Export",
  // Extended aliases — common search terms that need mapping
  "moving": "Moving & Storage", "moving company": "Moving & Storage", "movers": "Moving & Storage",
  "relocation": "Moving & Storage", "storage": "Moving & Storage",
  "plumbing": "Plumbing", "plumber": "Plumbing", "plumbers": "Plumbing",
  "hvac": "HVAC", "heating": "HVAC", "air conditioning": "HVAC",
  "roofing": "Roofing", "roofer": "Roofing", "roofers": "Roofing",
  "landscaping": "Landscaping", "lawn care": "Landscaping", "lawn": "Landscaping",
  "cleaning": "Cleaning Services", "janitorial": "Cleaning Services", "maid": "Cleaning Services",
  "pest control": "Pest Control", "exterminator": "Pest Control",
  "electrical": "Electrical Services", "electrician": "Electrical Services",
  "painting": "Painting", "painter": "Painting",
  "flooring": "Flooring", "carpet": "Flooring",
  "remodeling": "Home Remodeling", "renovation": "Home Remodeling", "home improvement": "Home Remodeling",
  "auto repair": "Automotive", "mechanic": "Automotive", "auto body": "Automotive",
  "dental": "Dental", "dentist": "Dental", "orthodontist": "Dental",
  "medical": "Medical Practice", "doctor": "Medical Practice", "physician": "Medical Practice",
  "chiropractic": "Chiropractic", "chiropractor": "Chiropractic",
  "veterinary": "Veterinary", "vet": "Veterinary", "animal hospital": "Veterinary",
  "fitness": "Health, Wellness & Fitness", "gym": "Health, Wellness & Fitness",
  "yoga": "Health, Wellness & Fitness", "personal trainer": "Health, Wellness & Fitness",
  "salon": "Beauty & Personal Care", "hair salon": "Beauty & Personal Care",
  "barber": "Beauty & Personal Care", "spa": "Beauty & Personal Care",
  "restaurant": "Restaurants", "cafe": "Food & Beverages", "catering": "Food & Beverages",
  "bakery": "Food & Beverages", "food truck": "Food & Beverages",
  "daycare": "Child Care", "child care": "Child Care", "preschool": "Child Care",
  "tutoring": "Education Management", "tutor": "Education Management",
  "photography": "Photography", "photographer": "Photography",
  "videography": "Media Production", "video production": "Media Production",
  "web design": "Internet", "web development": "Internet", "seo": "Internet",
  "digital marketing": "Marketing & Advertising", "social media marketing": "Marketing & Advertising",
  "staffing": "Staffing & Recruiting", "recruiting": "Staffing & Recruiting",
  "temp agency": "Staffing & Recruiting",
  "towing": "Automotive", "car wash": "Automotive",
  "tree service": "Environmental Services", "tree removal": "Environmental Services",
  "window cleaning": "Cleaning Services", "pressure washing": "Cleaning Services",
  "locksmith": "Security & Investigations", "security guard": "Security & Investigations",
};

const STANDARD_INDUSTRIES_LOWER = STANDARD_INDUSTRIES.map(i => ({ original: i, lower: i.toLowerCase() }));
const INDUSTRY_KEYWORD_INDEX: { keyword: string; industry: string }[] = [];
for (const ind of STANDARD_INDUSTRIES) {
  const tokens = ind.toLowerCase().split(/[\s&,/]+/).filter(t => t.length >= 3);
  for (const tok of tokens) { INDUSTRY_KEYWORD_INDEX.push({ keyword: tok, industry: ind }); }
}

function standardizeIndustryGlobal(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  // 1. Exact match
  for (const si of STANDARD_INDUSTRIES_LOWER) { if (lower === si.lower) return si.original; }
  // 2. Alias map
  if (INDUSTRY_ALIAS_MAP[lower]) return INDUSTRY_ALIAS_MAP[lower];
  // 3. Substring match
  let bestSubMatch = "", bestSubLen = 0;
  for (const si of STANDARD_INDUSTRIES_LOWER) {
    if (lower.includes(si.lower) && si.lower.length > bestSubLen) { bestSubMatch = si.original; bestSubLen = si.lower.length; }
    if (si.lower.includes(lower) && lower.length >= 4 && lower.length > bestSubLen) { bestSubMatch = si.original; bestSubLen = lower.length; }
  }
  if (bestSubMatch) return bestSubMatch;
  // 4. Keyword token match
  const rawTokens = lower.split(/[\s&,/]+/).filter(t => t.length >= 3);
  const scoreboard = new Map<string, number>();
  for (const rt of rawTokens) {
    for (const entry of INDUSTRY_KEYWORD_INDEX) {
      if (rt === entry.keyword || (rt.includes(entry.keyword) && entry.keyword.length >= 4) || (entry.keyword.includes(rt) && rt.length >= 4)) {
        scoreboard.set(entry.industry, (scoreboard.get(entry.industry) || 0) + 1);
      }
    }
  }
  if (scoreboard.size > 0) {
    let topInd = "", topScore = 0;
    for (const [ind, score] of scoreboard) { if (score > topScore) { topScore = score; topInd = ind; } }
    if (topInd) return topInd;
  }
  // 5. No match — title-case fallback
  return toTitleCase(trimmed);
}

// ── Clean company names: normalize formatting, strip noise ──
function cleanCompanyName(raw: string): string {
  if (!raw) return "";
  let c = stripEmoji(raw).trim();
  if (!c) return "";

  // ── EARLY REJECT: Multilingual LinkedIn UI text ──
  // Italian: "Visualizza i collegamenti in comune con X"
  // French: "Voir les relations en commun avec"
  // German: "Gemeinsame Kontakte anzeigen"
  // Spanish: "Ver conexiones en común con"
  const MULTILINGUAL_UI_RE = /\b(visualizza|collegament|comune\s+con|verbindungen|kontakte\s+anzeigen|connections\s+in\s+common|see\s+connections|ver\s+conexion|voir\s+les\s+relations|conexões\s+em\s+comum|anzeigen|anmelden|connexion|gemeinsame|connexions)\b/i;
  if (MULTILINGUAL_UI_RE.test(c)) return "";
  if (/\bin\s+common\s+with\b/i.test(c)) return "";
  if (/\bcomune\s+con\b/i.test(c)) return "";

  // ── EARLY REJECT: LinkedIn employment duration artifacts ──
  // e.g. "Present 6 Years 7 Months", "Present · 3 years", "Present 2 Years"
  // "Full-time · 4 yr 8 mo", "1 year 3 months", "Aug 2019 - Present · 5 years"
  if (/\b(?:present|current)\s*(?:·\s*)?\d+\s*(?:year|yr|month|mo|week)/i.test(c)) return "";
  if (/^\d+\s*(?:year|yr|month|mo|week)s?\s*\d*/i.test(c)) return "";
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}\s*[-–—]\s*(?:present|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4})/i.test(c)) return "";
  if (/^(?:full[- ]?time|part[- ]?time|contract|freelance|intern(?:ship)?|self[- ]?employed|seasonal|temporary)\s*(?:·|$)/i.test(c)) return "";
  // "Present · Location" — duration lines
  if (/^present\s*·/i.test(c)) return "";

  // Strip trailing periods
  c = c.replace(/\.+$/, "").trim();

  // ── PATTERN: "Company. Company Location" or "Company. Company Suffix" ──
  // e.g. "Inso Biosciences. Inso Biosciences Cornell" → "Inso Biosciences"
  const dotParts = c.split(/\.\s+/);
  if (dotParts.length >= 2) {
    const first = dotParts[0].trim();
    const second = dotParts.slice(1).join(". ").trim();
    if (first.length >= 3 && second.toLowerCase().startsWith(first.toLowerCase())) {
      c = first;
    }
    if (first.length >= 3 && first.split(/\s+/).length <= 5 && second.split(/\s+/).length > 5) {
      c = first;
    }
  }

  // ── PATTERN: Pipe-separated LinkedIn taglines used as company names ──
  // e.g. "Founder | Board Member | Biotechnology | Clinical" → reject
  const pipeParts = c.split(/\s*\|\s*/);
  if (pipeParts.length >= 3) {
    const TITLE_KEYWORDS = /\b(founder|ceo|cto|cfo|coo|cmo|director|manager|head|vp|president|board|member|partner|lead|chief|officer|consultant|advisor|coach|strategist|entrepreneur|owner|principal)\b/i;
    const hasTitle = pipeParts.some(p => TITLE_KEYWORDS.test(p));
    if (hasTitle) return "";
    if (pipeParts.length >= 4) return "";
  }

  // ── PATTERN: "The X Industry Organization and CEO/Title" — tagline + title ──
  const titleSuffix = c.match(/^(.+?)\s+and\s+(CEO|CTO|CFO|COO|CMO|CRO|CPO|CIO|Founder|Co-?Founder|President|Director|VP|SVP|EVP|Partner|Owner|Managing\s+Director|Board\s+Member|Chairman|Chairwoman)\b/i);
  if (titleSuffix) {
    c = titleSuffix[1].trim();
  }

  // ── EARLY DETECTION: LinkedIn headlines / taglines masquerading as company names ──
  // Truncate at comma if followed by sentence-like fragment ("Company, My Goal Is...")
  c = c.replace(/,\s+(?:My |I |We |Our |Your |A |The |An |Helping |Passionate |Dedicated |Experienced |Building |Creating |Empowering |Enabling |Transforming |Committed |Focused |Specializ|Leverag|Proven |Award|Driving |Working |Looking |Seeking |Striving |Results).*/i, "").trim();

  // Detect gerund/sentence-starting company names — these are LinkedIn headlines
  const LINKEDIN_HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+\s+in|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work|build|create|specialize|consult)|we\s+(?:help|are|build|create|provide|deliver|offer|specialize)|my\s+(?:goal|mission|passion|focus|expertise))/i;
  if (LINKEDIN_HEADLINE.test(c)) return "";

  // Reject pure job titles used as company names
  const PURE_TITLE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|director|manager|head|lead|chief|founder|co-?founder|owner|partner|president|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelanc\w+|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|physician|dentist|nurse|developer|designer|recruiter|marketer|sales\w*|business\s+development)(\s+(of|at|for|in|\&|and|\/)\s+.*)?$/i;
  if (PURE_TITLE.test(c)) return "";

  // Reject if it contains obvious sentence verbs (not company names)
  const SENTENCE_VERBS = /\b(helping|empowering|enabling|transforming|building|creating|delivering|providing|growing|driving|solving|improving|supporting|managing|developing|seeking|looking|striving|committed|passionate|dedicated|experienced)\b/i;
  const cWords = c.split(/\s+/);
  if (SENTENCE_VERBS.test(c) && cWords.length > 3) return "";

  // Reject pronoun-heavy strings (LinkedIn bios)
  if (/\b(my goal|i help|i am|we help|we are|our mission|your|they|them|their)\b/i.test(c) && cWords.length > 2) return "";

  // Normalize common suffixes to consistent format
  c = c.replace(/,?\s*\b(Inc|Incorporated)\.?$/i, ", Inc.");
  c = c.replace(/,?\s*\bLLC\.?$/i, ", LLC");
  c = c.replace(/,?\s*\bLtd\.?$/i, ", Ltd.");
  c = c.replace(/,?\s*\bCorp\.?$/i, ", Corp.");
  c = c.replace(/,?\s*\bL\.?P\.?$/i, ", LP");
  c = c.replace(/,?\s*\bPLC\.?$/i, ", PLC");
  c = c.replace(/,?\s*\bGmbH$/i, " GmbH");
  c = c.replace(/,?\s*\bS\.?A\.?$/i, " SA");

  // Strip "The " prefix for generic companies (keep for well-known brands)
  const KEEP_THE = /^the\s+(home|coca|walt|new york|real|boeing|dow|goldman|hartford|general|procter|johnson|est[ée]e|hershey)/i;
  if (/^the\s+/i.test(c) && !KEEP_THE.test(c)) {
    const withoutThe = c.replace(/^the\s+/i, "").trim();
    if (withoutThe.split(/\s+/).length <= 3) {
      c = withoutThe;
    }
  }

  // Remove URL-like parts sometimes appended
  c = c.replace(/\s*(?:https?:\/\/|www\.)\S+/i, "").trim();

  // Remove " - Description" suffixes (company name includes taglines)
  c = c.replace(/\s*[-–—]\s+(?:A |The |Your |We |Leading |Premier |Top |Best |Trusted ).*/i, "").trim();

  // Collapse multiple spaces
  c = c.replace(/\s{2,}/g, " ");

  // Cap length at 50 chars
  if (c.length > 50) {
    c = c.substring(0, 50).replace(/\s+\S*$/, "").trim();
  }

  // Final check: reject if >=7 words (real company names are short)
  if (c.split(/\s+/).length >= 7) return "";

  return c;
}

// ── Company enrichment via Google + Crunchbase ──
// Uses SerpAPI to find the company on Crunchbase/Google and extract:
// - Verified company name (official, not a LinkedIn tagline)
// - Employee count, revenue, founded year, industry, description, website
interface CompanyEnrichment {
  verified_name: string;
  website_url: string;
  industry: string;
  estimated_num_employees: number;
  annual_revenue_printed: string;
  short_description: string;
  founded_year: number;
  linkedin_url: string;
  city: string;
  state: string;
  country: string;
}

async function enrichCompanyData(
  companyName: string,
  location: string,
  serpApiKey: string
): Promise<CompanyEnrichment | null> {
  if (!companyName || companyName.length < 2) return null;

  try {
    // Strategy 1: Search Crunchbase for the organization
    const cbQuery = `site:crunchbase.com/organization "${companyName}"${location ? ` "${location}"` : ""}`;
    const cbParams = new URLSearchParams({
      engine: "google",
      q: cbQuery,
      api_key: serpApiKey,
      num: "3",
    });

    const cbResponse = await fetch(`https://serpapi.com/search?${cbParams}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (cbResponse.ok) {
      const cbData = await cbResponse.json();
      const cbResults = cbData.organic_results || [];

      for (const result of cbResults) {
        const url = result.link || "";
        if (!url.includes("crunchbase.com/organization/")) continue;

        const title = (result.title || "").replace(/\s*[-–—|]\s*Crunchbase.*$/i, "").trim();
        const snippet = result.snippet || "";

        // Extract verified company name from Crunchbase title
        let verifiedName = title;
        // Strip "Overview of " prefix
        verifiedName = verifiedName.replace(/^(?:Overview of|About)\s+/i, "").trim();
        // Strip trailing suffixes like "Company Profile"
        verifiedName = verifiedName.replace(/\s+(?:Company|Organization|Startup|Business)\s+(?:Profile|Info|Overview|Details)$/i, "").trim();

        if (!verifiedName || verifiedName.length < 2) continue;

        // Parse snippet for company details
        // Crunchbase snippets often: "Company is a ... Founded in YYYY ... X employees ..."
        let employees = 0;
        let revenue = "";
        let founded = 0;
        let industry = "";
        let description = "";

        // Employee count patterns
        const empMatch = snippet.match(/(\d[\d,]+)\s*(?:\+\s*)?(?:employees?|people|team\s*members?|staff)/i);
        if (empMatch) employees = parseInt(empMatch[1].replace(/,/g, ""), 10) || 0;
        // Range pattern: "11-50 employees"
        const empRange = snippet.match(/(\d+)\s*[-–]\s*(\d+)\s*employees?/i);
        if (empRange && !employees) {
          const lo = parseInt(empRange[1], 10);
          const hi = parseInt(empRange[2], 10);
          employees = Math.round((lo + hi) / 2);
        }

        // Revenue patterns
        const revMatch = snippet.match(/(?:revenue|funding|raised)\s*(?:of\s*)?[\$€£]?([\d,.]+)\s*(million|billion|M|B|K)/i);
        if (revMatch) {
          const val = parseFloat(revMatch[1].replace(/,/g, ""));
          const unit = revMatch[2].toLowerCase();
          if (unit === "billion" || unit === "b") revenue = `$${val}B`;
          else if (unit === "million" || unit === "m") revenue = `$${val}M`;
          else if (unit === "k") revenue = `$${val}K`;
        }

        // Founded year
        const foundedMatch = snippet.match(/(?:founded|established|started|incorporated)\s*(?:in\s*)?(\d{4})/i);
        if (foundedMatch) founded = parseInt(foundedMatch[1], 10);

        // Industry from snippet
        const indMatch = snippet.match(/(?:in the|in|operates in|industry:\s*|sector:\s*)([A-Za-z\s&,/]+?)(?:\s*(?:industry|sector|space|market|\.|\,))/i);
        if (indMatch) industry = indMatch[1].trim();

        // Description: first sentence of snippet
        const descMatch = snippet.match(/^(.+?\.)\s/);
        if (descMatch) description = descMatch[1];
        else description = snippet.substring(0, 200);

        // Location from snippet
        let city = "", state = "", country = "";
        const locMatch = snippet.match(/(?:based in|headquartered in|located in)\s+([^.]+)/i);
        if (locMatch) {
          const locParts = locMatch[1].split(",").map(s => s.trim());
          if (locParts.length >= 3) { city = locParts[0]; state = locParts[1]; country = locParts[2]; }
          else if (locParts.length === 2) { city = locParts[0]; country = locParts[1]; }
          else if (locParts.length === 1) { city = locParts[0]; }
        }

        // Extract website from Crunchbase snippet if available
        let website = "";
        const siteMatch = snippet.match(/(?:website|site|url)[:\s]+(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/i);
        if (siteMatch) website = siteMatch[1];

        console.log(`[COMPANY ENRICH] Crunchbase match for "${companyName}": verified="${verifiedName}", employees=${employees}, revenue="${revenue}", founded=${founded}`);

        return {
          verified_name: verifiedName,
          website_url: website,
          industry,
          estimated_num_employees: employees,
          annual_revenue_printed: revenue,
          short_description: description,
          founded_year: founded,
          linkedin_url: "",
          city,
          state,
          country,
        };
      }
    }

    // Strategy 2: Google Knowledge Panel / general search for company info
    const gQuery = `"${companyName}" company${location ? ` ${location}` : ""} -site:linkedin.com -site:facebook.com`;
    const gParams = new URLSearchParams({
      engine: "google",
      q: gQuery,
      api_key: serpApiKey,
      num: "5",
    });

    const gResponse = await fetch(`https://serpapi.com/search?${gParams}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (gResponse.ok) {
      const gData = await gResponse.json();

      // Check Knowledge Graph if available
      const kg = gData.knowledge_graph;
      if (kg) {
        const kgName = kg.title || kg.name || "";
        if (kgName && kgName.length >= 2) {
          console.log(`[COMPANY ENRICH] Google KG match for "${companyName}": "${kgName}"`);
          return {
            verified_name: kgName,
            website_url: kg.website || "",
            industry: kg.type || kg.category || "",
            estimated_num_employees: 0,
            annual_revenue_printed: "",
            short_description: kg.description || "",
            founded_year: kg.founded ? parseInt(String(kg.founded), 10) || 0 : 0,
            linkedin_url: "",
            city: "",
            state: "",
            country: "",
          };
        }
      }

      // Fallback: extract from search result titles
      const results = gData.organic_results || [];
      for (const result of results) {
        const url = result.link || "";
        // Skip social/directory sites
        if (/linkedin\.com|facebook\.com|yelp\.com|glassdoor\.com|indeed\.com/.test(url)) continue;

        // If Crunchbase org page found in general search
        if (url.includes("crunchbase.com/organization/")) {
          const cbTitle = (result.title || "").replace(/\s*[-–—|]\s*Crunchbase.*$/i, "").trim();
          if (cbTitle && cbTitle.length >= 2) {
            console.log(`[COMPANY ENRICH] Google→Crunchbase fallback for "${companyName}": "${cbTitle}"`);
            return {
              verified_name: cbTitle,
              website_url: "",
              industry: "",
              estimated_num_employees: 0,
              annual_revenue_printed: "",
              short_description: (result.snippet || "").substring(0, 200),
              founded_year: 0,
              linkedin_url: "",
              city: "", state: "", country: "",
            };
          }
        }
      }
    }

    return null;
  } catch (err: any) {
    console.warn(`[COMPANY ENRICH] Failed for "${companyName}": ${err.message}`);
    return null;
  }
}

// ── Discover company website via Google ──
async function discoverCompanyWebsite(
  companyName: string,
  location: string,
  serpApiKey: string
): Promise<string> {
  try {
    const query = `"${companyName}" ${location} -site:apollo.io -site:linkedin.com -site:facebook.com -site:yelp.com -site:yellowpages.com`;
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: serpApiKey,
      num: "5",
    });

    const response = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return "";
    const data = await response.json();
    const results = data.organic_results || [];

    // Look for the company's own website (not a directory listing)
    const junkDomains = new Set([
      "yelp.com", "yelp.fr", "yelp.co.uk", "yelp.de", "yelp.it", "yelp.es",
      "facebook.com", "linkedin.com", "instagram.com", "twitter.com", "x.com",
      "yellowpages.com", "bbb.org", "glassdoor.com", "glassdoor.co.uk", "glassdoor.de",
      "indeed.com", "indeed.co.uk", "indeed.fr", "indeed.de", "indeed.it",
      "crunchbase.com", "zoominfo.com", "google.com", "google.co.uk", "google.it",
      "apple.com", "apollo.io", "manta.com", "mapquest.com", "foursquare.com",
      "nextdoor.com", "angi.com", "thumbtack.com", "homeadvisor.com",
      "superpages.com", "whitepages.com",
      // Social / content aggregator sites that should never be a company homepage
      "reddit.com", "wikipedia.org", "wikimedia.org", "tumblr.com", "pinterest.com",
      "tiktok.com", "youtube.com", "medium.com", "substack.com", "quora.com",
      "bloomberg.com", "reuters.com", "forbes.com", "businessinsider.com",
      "techcrunch.com", "wired.com", "theverge.com", "cnbc.com", "wsj.com",
      "nytimes.com", "theguardian.com", "bbc.com", "bbc.co.uk",
      "trustpilot.com", "g2.com", "capterra.com", "clutch.co",
      "dnb.com", "hoovers.com", "pitchbook.com", "owler.com",
      "angel.co", "angellist.com", "producthunt.com",
      "gov.uk", "gov.it", "gov.de", "government.se",
      "comune.it", "camera.it", "senato.it",
    ]);

    for (const r of results) {
      const url = r.link || r.displayed_link || "";
      try {
        const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
        if (!junkDomains.has(domain) && domain.length < 50) {
          return domain;
        }
      } catch { continue; }
    }
    return "";
  } catch (err: any) {
    console.warn(`[DEEP PROSPECT] Company website discovery failed for "${companyName}": ${err.message}`);
    return "";
  }
}

// ── Cache helpers ──
function hashParams(params: Record<string, any>): string {
  const keys = ['person_titles', 'organization_locations', 'person_seniorities', 'q_keywords', 'organization_industries', 'max_results'];
  const stable: Record<string, any> = {};
  for (const k of keys) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
      const v = params[k];
      stable[k] = Array.isArray(v) ? [...v].sort().join('|').toLowerCase() : String(v).toLowerCase().trim();
    }
  }
  const str = JSON.stringify(stable);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `deep_cache:${Math.abs(hash).toString(36)}`;
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── POST /search-stream — SSE streaming deep prospecting ──
app.post("/search-stream", async (c) => {
  const t0 = Date.now();
  console.log(`[DEEP PROSPECT] /search-stream handler entered at ${new Date().toISOString()}`);
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    console.log(`[DEEP PROSPECT] Auth OK for ${user.email} (${Date.now() - t0}ms)`);
    const body = await c.req.json();

    const {
      person_titles,
      organization_locations,
      person_seniorities,
      q_keywords,
      organization_industries,
      max_results = 50,
      db_only = false,
      // Progressive fallback hints from frontend:
      // - preferred_industries: original industries the user wanted (used in SerpAPI queries as soft hints, not strict DB filters)
      // - force_external: skip pool-satisfied shortcut — ensures we crawl externally even when pool has enough generic leads
      // - bypass_cache: skip KV cache entirely — used by auto-expand retries to ensure fresh external crawl
      preferred_industries,
      force_external = false,
      bypass_cache = false,
    } = body;

    const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
    if (!SERPAPI_KEY && !db_only) {
      return c.json({ error: "SERPAPI_API_KEY not configured" }, 500);
    }

    const HUNTER_KEY = Deno.env.get("HUNTER_API_KEY");
    const FINDYMAIL_KEY = Deno.env.get("FINDYMAIL_API_KEY");
    const EXPLORIUM_KEY = Deno.env.get("EXPLORIUM_API_KEY");
    const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY");

    console.log(`[DEEP PROSPECT] Starting for ${user.email}: titles=${JSON.stringify(person_titles)}, locations=${JSON.stringify(organization_locations)}, industries=${JSON.stringify(organization_industries)}, max=${max_results}, db_only=${db_only}, force_external=${force_external}, bypass_cache=${bypass_cache}, preferred_industries=${JSON.stringify(preferred_industries)}`);

    let isCancelled = false;
    let controllerClosed = false;

    const stream = new ReadableStream({
      cancel() { isCancelled = true; },
      async start(controller) {
        const encoder = new TextEncoder();

        const safeClose = () => {
          if (controllerClosed || isCancelled) return;
          try { controller.close(); controllerClosed = true; } catch { controllerClosed = true; }
        };

        const heartbeat = setInterval(() => {
          if (isCancelled || controllerClosed) return;
          try { controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)); }
          catch { isCancelled = true; controllerClosed = true; }
        }, 3000);

        const send = (event: string, data: any) => {
          if (isCancelled || controllerClosed) return;
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
          catch { isCancelled = true; controllerClosed = true; }
        };

        const reqSignal = c.req.raw?.signal;
        if (reqSignal) {
          const onAbort = () => { isCancelled = true; clearInterval(heartbeat); safeClose(); };
          if (reqSignal.aborted) { onAbort(); return; }
          reqSignal.addEventListener('abort', onAbort, { once: true });
        }

        try {
          // ── Check cache ──
          const cacheKey = hashParams(body);
          const cached = bypass_cache ? null : await kv.get(cacheKey).catch(() => null);
          if (cached) {
            const data = typeof cached === 'string' ? JSON.parse(cached) : (cached as any)?.value ? (typeof (cached as any).value === 'string' ? JSON.parse((cached as any).value) : (cached as any).value) : cached;
            if (data?.people?.length > 0 && data.timestamp && (Date.now() - data.timestamp) < 24 * 60 * 60 * 1000) {
              console.log(`[DEEP PROSPECT] Cache hit: ${data.people.length} leads`);
              send("phase", { phase: 1, name: "Cache hit — loading saved results", status: "complete" });

              // Apply quality gate + industry filter to cached results
              // Accept both full-quality leads (with email) AND partial-quality leads (preview mode, no email yet)
              let qualityPeople = (data.people as DeepLead[]).filter(l => {
                if (isQualityLead(l)) return true;
                // Also accept tier2 leads (without email but with name+company+title) from cache
                const isPartialQualityLead = (lead: DeepLead): boolean => {
                  const name = (lead.name || "").trim();
                  if (!name || name === "\u2014" || name === "-") return false;
                  if (!lead.first_name?.trim() || !lead.last_name?.trim()) return false;
                  if (!isCleanPersonName(lead.first_name, lead.last_name)) return false;
                  const companyName = (lead.organization?.name || "").trim();
                  const hasLinkedIn = !!lead.linkedin_url;
                  const cleanedCo = cleanCompanyName(companyName);
                  const JUNK_COMPANY = new Set([
                    "saas", "b2b", "b2c", "ai", "it", "hr", "tech", "software", "company",
                    "business", "unknown", "n/a", "na", "none", "undefined", "null", "other",
                    "service", "services", "agency", "group", "corp", "inc", "linkedin",
                  ]);
                  if (!cleanedCo || cleanedCo === "\u2014" || cleanedCo === "-" || cleanedCo.length < 2) {
                    if (!hasLinkedIn) return false;
                  } else if (JUNK_COMPANY.has(cleanedCo.toLowerCase()) && !hasLinkedIn) {
                    return false;
                  }
                  if (companyName.length > 80) return false;
                  const titleClean = (lead.title || "").trim();
                  if (!titleClean) return false;
                  if (titleClean.split(/\s+/).length > 8) return false;
                  return true;
                };
                if (!l.email && isPartialQualityLead(l)) {
                  // Mark as preview so frontend doesn't filter it out
                  (l as any)._preview = true;
                  // Don't set _has_email = false - let it be undefined so frontend quality gate allows it
                  return true;
                }
                return false;
              });
              if (organization_industries?.length) {
                const preIndustryCount = qualityPeople.length;
                qualityPeople = qualityPeople.filter(l => matchesIndustryFilter(l, organization_industries));
                console.log(`[DEEP PROSPECT] Cache industry filter: ${preIndustryCount} → ${qualityPeople.length} leads`);
              }
              if (organization_locations?.length) {
                const preLocCount = qualityPeople.length;
                qualityPeople = qualityPeople.filter(l => matchesLocationFilter(l, organization_locations));
                console.log(`[DEEP PROSPECT] Cache location filter: ${preLocCount} → ${qualityPeople.length} leads`);
              }
              const withEmail = qualityPeople.filter(l => l.email).length;
              const withoutEmail = qualityPeople.filter(l => !l.email).length;
              console.log(`[DEEP PROSPECT] Cache quality gate: ${data.people.length} → ${qualityPeople.length} leads (${withEmail} with email, ${withoutEmail} preview/tier2)`);

              // If cache is all junk or doesn't have enough leads, skip it and re-search
              // We only skip cache if db_only is false and we need more leads, or if qualityPeople is empty.
              // If db_only is true, we return what we have and let the client auto-expand.
              if (qualityPeople.length === 0 || (!db_only && qualityPeople.length < max_results)) {
                console.log(`[DEEP PROSPECT] Cache returned ${qualityPeople.length}/${max_results} leads (db_only=${db_only}), bypassing cache to fetch more`);
                // Fall through to live search
              } else {
                // CRM dedup
                let existingEmails = new Set<string>();
                try {
                  const teamIds = await getTeamMemberIds(user.id);
                  const { data: el } = await supabase.from("leads").select("email").in("user_id", teamIds);
                  if (el) existingEmails = new Set(el.map((l: any) => (l.email || "").toLowerCase()).filter(Boolean));
                } catch {}

                const stats = buildStats(qualityPeople);
                const cacheHasPreview = qualityPeople.some(l => (l as any)._preview);
                send("people", { people: qualityPeople, partial: false, preview: cacheHasPreview });
                send("complete", { people: qualityPeople, stats, existing_emails: Array.from(existingEmails), cached: true, deep_prospect: true, preview: cacheHasPreview, total_available: qualityPeople.length, requested: max_results, db_only });
                clearInterval(heartbeat);
                safeClose();
                return;
              }
            }
          }

          // ══════════════════════════════════════════════════════════════
          // PHASE 0: LOCAL POOL — check our database first
          // ══════════════════════════════════════════════════════════════
          send("phase", { phase: 0, name: "Searching local database", status: "searching" });
          send("activity", { message: `Checking CRM and local network for existing matches...`, type: "info" });

          const poolCriteria: SearchCriteria = {
            person_titles: person_titles || undefined,
            organization_locations: organization_locations || undefined,
            person_seniorities: person_seniorities || undefined,
            q_keywords: q_keywords || undefined,
            organization_industries: organization_industries || undefined,
            max_results: max_results,
          };

          let poolLeads: PoolLead[] = [];
          try {
            console.log(`[DEEP PROSPECT] Phase 0: Starting searchPool...`);
            const poolPromise = searchPool(poolCriteria, undefined, Math.min(max_results * 2, 5000));
            const poolTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('searchPool timed out after 25s')), 25_000));
            const poolResult = await Promise.race([poolPromise, poolTimeout]);
            poolLeads = poolResult.leads;
            // Apply strict industry filter to pool results
            if (organization_industries?.length) {
              const preFilterCount = poolLeads.length;
              poolLeads = poolLeads.filter(l => matchesIndustryFilter(l as any as DeepLead, organization_industries));
              console.log(`[DEEP PROSPECT] Phase 0: Pool industry filter: ${preFilterCount} → ${poolLeads.length}`);
            }
            // Apply strict location filter to pool results
            if (organization_locations?.length) {
              const preLocCount = poolLeads.length;
              poolLeads = poolLeads.filter(l => matchesLocationFilter(l as any as DeepLead, organization_locations));
              console.log(`[DEEP PROSPECT] Phase 0: Pool location filter: ${preLocCount} → ${poolLeads.length}`);
            }
            console.log(`[DEEP PROSPECT] Phase 0: ${poolLeads.length} leads from local pool (${Date.now() - t0}ms total)`);
          } catch (poolErr: any) {
            console.error(`[DEEP PROSPECT] Phase 0: searchPool failed: ${poolErr.message}`);
          }

          send("phase", { phase: 0, name: "Searching local database", status: "complete", pool_matches: poolLeads.length });

          // CRITICAL: When searching with industry filters, ALWAYS crawl fresh external data
          // Pool leads often have mismatched industries from LinkedIn snippets
          const hasIndustryFilter = (organization_industries?.length ?? 0) > 0;
          
          if (hasIndustryFilter && poolLeads.length > 0) {
            console.log(`[DEEP PROSPECT] Industry filter active — forcing external crawl for accurate industry-tagged results (pool has ${poolLeads.length} but may be inaccurate)`);
          }
          
          if (poolLeads.length >= max_results && !force_external && !hasIndustryFilter) {
            console.log(`[DEEP PROSPECT] Pool satisfied request (${poolLeads.length} >= ${max_results}) — skipping external crawl, saving API credits`);
            const poolResults = poolLeads.slice(0, max_results) as any as DeepLead[];
            
            // CRM dedup for pool-satisfied path (timeout-guarded)
            let existingEmails = new Set<string>();
            try {
              const teamPromise = getTeamMemberIds(user.id);
              const teamTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('getTeamMemberIds timed out')), 5000));
              const teamIds = await Promise.race([teamPromise, teamTimeout]);
              const { data: el } = await supabase.from("leads").select("email").in("user_id", teamIds);
              if (el) existingEmails = new Set(el.map((l: any) => (l.email || "").toLowerCase()).filter(Boolean));
            } catch (dedupErr: any) {
              console.warn(`[DEEP PROSPECT] CRM dedup skipped: ${dedupErr.message}`);
            }
            
            const stats = buildStats(poolResults);
            send("people", { people: poolResults, partial: false, preview: false });
            send("complete", { people: poolResults, stats, existing_emails: Array.from(existingEmails), from_pool: poolResults.length, deep_prospect: true, total_available: poolLeads.length, requested: max_results });
            clearInterval(heartbeat);
            safeClose();
            return;
          } else if (poolLeads.length >= max_results && force_external) {
            console.log(`[DEEP PROSPECT] Pool has ${poolLeads.length} leads but force_external=true — proceeding to external crawl for more precise results`);
          }

          // ── DB-Only mode: return whatever the pool found, no external crawling ──
          if (db_only) {
            console.log(`[DEEP PROSPECT] DB-Only mode: returning ${poolLeads.length} leads from local database`);
            const poolResults = poolLeads.slice(0, max_results) as any as DeepLead[];
            
            let existingEmails = new Set<string>();
            try {
              const teamPromise = getTeamMemberIds(user.id);
              const teamTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('getTeamMemberIds timed out')), 5000));
              const teamIds = await Promise.race([teamPromise, teamTimeout]);
              const { data: el } = await supabase.from("leads").select("email").in("user_id", teamIds);
              if (el) existingEmails = new Set(el.map((l: any) => (l.email || "").toLowerCase()).filter(Boolean));
            } catch (dedupErr: any) {
              console.warn(`[DEEP PROSPECT] DB-Only CRM dedup skipped: ${dedupErr.message}`);
            }
            
            const stats = buildStats(poolResults);
            send("people", { people: poolResults, partial: false, preview: false });
            send("complete", { people: poolResults, stats, existing_emails: Array.from(existingEmails), from_pool: poolResults.length, deep_prospect: true, total_available: poolLeads.length, requested: max_results, db_only: true });
            clearInterval(heartbeat);
            safeClose();
            return;
          }

          const poolEmails = new Set(poolLeads.map(l => (l.email || "").toLowerCase()).filter(Boolean));
          // When force_external, request full amount from external (pool leads are generic fallback)
          const externalNeeded = force_external
            ? Math.max(max_results, 10)
            : Math.max(1, max_results - poolLeads.length);
          console.log(`[DEEP PROSPECT] Pool returned ${poolLeads.length}/${max_results} — need ${externalNeeded} more from external sources${force_external ? ' (force_external — requesting full amount)' : ''}`);

          // ══════════════════════════════════════════════════════════════
          // PHASE 1: SerpAPI Web Scraping (LinkedIn + Crunchbase + Web)
          // ══════════════════════════════════════════════════════════════
          send("phase", { phase: 1, name: "Discovering professional profiles", status: "searching" });
          send("activity", { message: `Scanning professional networks...`, type: "info" });

          console.log(`[DEEP PROSPECT] ═══ PHASE 1 START ═══`);
          console.log(`[DEEP PROSPECT] External needed: ${externalNeeded}`);
          console.log(`[DEEP PROSPECT] Search parameters:`);
          console.log(`  - person_titles: ${person_titles?.join(', ') || 'none'}`);
          console.log(`  - organization_locations: ${organization_locations?.join(', ') || 'none'}`);
          console.log(`  - person_seniorities: ${person_seniorities?.join(', ') || 'none'}`);
          console.log(`  - q_keywords: ${q_keywords || 'none'}`);
          console.log(`  - organization_industries: ${organization_industries?.join(', ') || 'none'}`);

          const allParsed: ParsedPerson[] = [];
          const seenNames = new Set<string>();

          // ═══ SERPAPI WEB SCRAPING — Crawl LinkedIn, Crunchbase, company pages ═══
          console.log(`[DEEP PROSPECT] Using SerpAPI to scrape professional profiles from web...`);

          // Use preferred_industries as SerpAPI query hints if provided
          const serpIndustryHints = organization_industries?.length
            ? organization_industries
            : (preferred_industries?.length ? preferred_industries : undefined);
          if (serpIndustryHints && !organization_industries?.length) {
            console.log(`[DEEP PROSPECT] Using preferred_industries as SerpAPI hints: [${serpIndustryHints.join(', ')}]`);
          }

          const serpQueries = buildSerpQueries({
            person_titles,
            organization_locations,
            person_seniorities,
            q_keywords,
            organization_industries: serpIndustryHints,
            max_results: Math.max(externalNeeded, 10),
          });

          console.log(`[DEEP PROSPECT] Generated ${serpQueries.length} SerpAPI search queries`);

          const parseResults = (results: any[]): number => {
            let parsedCount = 0;
            for (const result of results) {
              const parsed = parseSearchResult(result);
              if (!parsed) continue;
              
              // Skip duplicates by name
              if (seenNames.has(parsed.name.toLowerCase())) continue;
              
              // Filter by seniority if specified
              if (person_seniorities?.length && parsed.seniority && !person_seniorities.includes(parsed.seniority)) continue;
              
              seenNames.add(parsed.name.toLowerCase());
              allParsed.push(parsed);
              parsedCount++;
              
              // Send activity feed update occasionally
              if (allParsed.length % 5 === 0) {
                send("activity", { message: `Discovered profile: ${parsed.name} at ${parsed.company}`, type: "success" });
              }
            }
            return parsedCount;
          };

          // Execute searches in parallel batches for speed
          const PARALLEL_CAP = 8; // Run 8 searches at once
          const maxQueries = Math.min(serpQueries.length, 18); // Cap total queries (increased for better coverage)

          for (let batch = 0; batch < maxQueries; batch += PARALLEL_CAP) {
            if (isCancelled || allParsed.length >= externalNeeded * 2) break;
            
            const batchQueries = serpQueries.slice(batch, batch + PARALLEL_CAP);
            console.log(`[DEEP PROSPECT] Executing SerpAPI batch ${Math.floor(batch / PARALLEL_CAP) + 1}: ${batchQueries.length} queries`);

            const batchResults = await Promise.allSettled(
              batchQueries.map((q) => serpSearch(q, SERPAPI_KEY, 20, 0))
            );

            for (let i = 0; i < batchResults.length; i++) {
              const r = batchResults[i];
              if (r.status === "fulfilled" && r.value.length > 0) {
                const parsed = parseResults(r.value);
                console.log(`[DEEP PROSPECT] Query "${batchQueries[i].substring(0, 60)}...": ${r.value.length} raw → ${parsed} parsed (total: ${allParsed.length})`);
              } else if (r.status === "rejected") {
                console.warn(`[DEEP PROSPECT] Query failed: ${r.reason}`);
              }
            }

            send("progress", { fetched: allParsed.length, total: externalNeeded, phase: "crawl" });

            // Rate limiting between batches
            if (batch + PARALLEL_CAP < maxQueries && !isCancelled && allParsed.length < externalNeeded * 2) {
              await sleep(300); // 300ms between batches to respect API limits but keep it fast
            }
          }

          console.log(`[DEEP PROSPECT] Phase 1 complete: ${allParsed.length} leads from SerpAPI web scraping`);

          send("phase", { phase: 1, name: "Discovering professional profiles", status: "complete", total_available: allParsed.length });

          if (allParsed.length === 0) {
            console.log(`[DEEP PROSPECT] No leads found via web scraping — returning pool results only`);
            send("complete", { people: poolLeads as any, stats: buildStats(poolLeads as any), existing_emails: [], from_pool: poolLeads.length, from_external: 0, deep_prospect: true, total_available: poolLeads.length, requested: max_results });
            clearInterval(heartbeat);
            safeClose();
            return;
          }

          // Trim to what we need — enrich ALL parsed candidates to maximize email yield.
          // The enrichment APIs (Hunter, Findymail) are the bottleneck, not parsing.
          // For small requests, enrich everything we found; for large, cap reasonably.
          const enrichmentCap = Math.min(allParsed.length, Math.max(externalNeeded * 3, 100));
          const trimmed = allParsed.slice(0, enrichmentCap);
          console.log(`[DEEP PROSPECT] Phase 1 complete: ${allParsed.length} unique people parsed, enriching top ${trimmed.length}`);

          const locationHint = organization_locations?.[0] || "";

          // ══════════════════════════════════════════════════════════════
          // PHASE 1b: Company Verification via Google + Crunchbase
          // Resolves real company names, employee counts, revenue, etc.
          // Prevents LinkedIn taglines/headlines from being saved as company names.
          // ══════════════════════════════════════════════════════════════
          send("phase", { phase: 1.5, name: `Verifying company data (${trimmed.length})`, status: "processing" });
          send("activity", { message: `Cross-referencing ${trimmed.length} prospects against business records`, type: "info" });

          // Identify unique companies that need verification
          const companyEnrichCache = new Map<string, CompanyEnrichment | null>();
          const uniqueCompanies = [...new Set(trimmed.map(p => (p.company || "").trim()).filter(c => c.length >= 2))];

          // Determine which companies need enrichment:
          // - Companies with suspicious names (pipe-separated, sentence-like, duplicated)
          // - All companies if we have capacity (for employee count, revenue data)
          const SUSPICIOUS_COMPANY = /[|]|^\w+\s+\w+\.\s+\w+|^(founder|ceo|cto|board|member|director|manager|head|vp|president|partner|owner|consultant|advisor|coach|helping|building|creating|working|passionate)/i;

          const companiesNeedingEnrich = uniqueCompanies.filter(c => {
            // Always enrich suspicious names
            if (SUSPICIOUS_COMPANY.test(c)) return true;
            // Enrich companies with >4 words (likely taglines)
            if (c.split(/\s+/).length > 4) return true;
            // Enrich all if we have few companies (worthwhile investment)
            if (uniqueCompanies.length <= 30) return true;
            return false;
          });

          console.log(`[DEEP PROSPECT] Phase 1b: ${companiesNeedingEnrich.length}/${uniqueCompanies.length} companies need Crunchbase/Google verification`);

          const COMPANY_ENRICH_BATCH = 10;
          const COMPANY_ENRICH_CAP = Math.min(companiesNeedingEnrich.length, 40);

          for (let i = 0; i < COMPANY_ENRICH_CAP; i += COMPANY_ENRICH_BATCH) {
            if (isCancelled) break;
            const batch = companiesNeedingEnrich.slice(i, i + COMPANY_ENRICH_BATCH);

            const batchResults = await Promise.allSettled(
              batch.map(company => enrichCompanyData(company, locationHint, SERPAPI_KEY!))
            );

            for (let j = 0; j < batch.length; j++) {
              const r = batchResults[j];
              const companyKey = batch[j].toLowerCase().trim();
              if (r.status === "fulfilled" && r.value) {
                companyEnrichCache.set(companyKey, r.value);
                console.log(`[DEEP PROSPECT] ✓ Company verified: "${batch[j]}" → "${r.value.verified_name}" (${r.value.estimated_num_employees} employees)`);
              } else {
                companyEnrichCache.set(companyKey, null);
              }
            }

            send("progress", { fetched: Math.min(i + COMPANY_ENRICH_BATCH, COMPANY_ENRICH_CAP), total: COMPANY_ENRICH_CAP, phase: "company_verify" });
            if (i + COMPANY_ENRICH_BATCH < COMPANY_ENRICH_CAP) await sleep(150);
          }

          // Apply enrichment to parsed persons
          let companiesEnriched = 0;
          let companiesCorrected = 0;
          for (const person of trimmed) {
            const companyKey = (person.company || "").toLowerCase().trim();
            const enrichment = companyEnrichCache.get(companyKey);
            if (!enrichment) continue;

            companiesEnriched++;
            // If verified name differs significantly, use it (Crunchbase is authoritative)
            if (enrichment.verified_name && enrichment.verified_name.toLowerCase() !== companyKey) {
              console.log(`[DEEP PROSPECT] Company name corrected: "${person.company}" → "${enrichment.verified_name}"`);
              person.company = enrichment.verified_name;
              companiesCorrected++;
            }
            // Enrich with Crunchbase data
            if (enrichment.estimated_num_employees && !person.estimated_num_employees) {
              person.estimated_num_employees = enrichment.estimated_num_employees;
            }
            if (enrichment.industry && !person.industry) {
              person.industry = enrichment.industry;
            }
          }

          console.log(`[DEEP PROSPECT] Phase 1b complete: ${companiesEnriched} companies enriched, ${companiesCorrected} names corrected`);
          send("phase", { phase: 1.5, name: "Verifying company data", status: "complete", enriched: companiesEnriched, corrected: companiesCorrected });

          // ══════════════════════════════════��═══════════════════════════
          // PHASE 2: Discover company websites/domains
          // ══════════════════════════════════════════════════════════════
          send("phase", { phase: 2, name: `Resolving company domains (${trimmed.length})`, status: "processing" });

          // Batch domain discovery — group by company name to avoid duplicate lookups
          const companyDomainMap = new Map<string, string>();

          // First pass: pre-populate from Crunchbase enrichment (highest quality)
          for (const [key, enrichment] of companyEnrichCache) {
            if (enrichment?.website_url && !companyDomainMap.has(key)) {
              const cbDomain = enrichment.website_url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*/, "");
              if (cbDomain && cbDomain.length >= 3) {
                companyDomainMap.set(key, cbDomain);
              }
            }
          }

          // Second pass: try to extract domain from source URL or snippet
          for (const person of trimmed) {
            if (!person.company) continue;
            const companyKey = person.company.toLowerCase().trim();
            if (companyDomainMap.has(companyKey)) continue;

            // Try snippet for website hints
            const urlMatch = person.snippet.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]+\.[a-z]{2,})/i);
            if (urlMatch) {
              const domain = urlMatch[1].toLowerCase();
              if (!['apollo.io', 'linkedin.com', 'facebook.com', 'google.com', 'crunchbase.com'].includes(domain)) {
                companyDomainMap.set(companyKey, domain);
              }
            }
          }

          // Second pass: Google search for remaining companies (batch to limit SerpAPI calls)
          // Use enriched company names if available (Crunchbase-corrected)
          const companiesNeedingDomain = [...new Set(trimmed.map(p => {
            const key = (p.company || "").toLowerCase().trim();
            const enriched = companyEnrichCache.get(key);
            return enriched?.verified_name || p.company;
          }).filter(Boolean))]
            .filter(c => !companyDomainMap.has(c.toLowerCase().trim()));

          const DOMAIN_BATCH = 20;
          // Scale domain lookup limit — for small requests, try harder to find
          // domains since each domain = potential email enrichment
          const DOMAIN_LOOKUP_CAP = Math.min(Math.max(50, Math.ceil(externalNeeded * 1.5)), 120);

          for (let i = 0; i < Math.min(companiesNeedingDomain.length, DOMAIN_LOOKUP_CAP); i += DOMAIN_BATCH) {
            if (isCancelled) break;
            const batch = companiesNeedingDomain.slice(i, i + DOMAIN_BATCH);

            const batchResults = await Promise.allSettled(
              batch.map(company => discoverCompanyWebsite(company, locationHint, SERPAPI_KEY))
            );

            for (let j = 0; j < batch.length; j++) {
              const r = batchResults[j];
              if (r.status === "fulfilled" && r.value) {
                companyDomainMap.set(batch[j].toLowerCase().trim(), r.value);
              }
            }

            send("progress", { fetched: Math.min(i + DOMAIN_BATCH, companiesNeedingDomain.length), total: Math.min(companiesNeedingDomain.length, DOMAIN_LOOKUP_CAP), phase: "domains" });

            if (i + DOMAIN_BATCH < companiesNeedingDomain.length) await sleep(100);
          }

          console.log(`[DEEP PROSPECT] Phase 2: Found domains for ${companyDomainMap.size}/${companiesNeedingDomain.length + companyDomainMap.size} companies`);
          send("phase", { phase: 2, name: "Resolving company domains", status: "complete" });

          // ══════════════════════════════════════════════════════════════
          // PHASE 3: Build DeepLead objects and assign domains
          // Industry standardization: when user selects industries, we
          // normalize the lead's industry to the EXACT search term.
          // If snippet industry matches a selected industry → use selected.
          // If no snippet industry → use the searched industry (fallback).
          // This keeps the data sheet clean and consistent.
          // ══════════════════════════════════════════════════════════════
          send("phase", { phase: 3, name: `Building lead profiles (${trimmed.length})`, status: "processing" });

          // Build a function to standardize industry to the user's search terms
          const standardizeIndustry = (rawIndustry: string): string => {
            if (!organization_industries?.length) return standardizeIndustryGlobal(rawIndustry); // No filter = use global standardization

            const raw = (rawIndustry || "").toLowerCase().trim();
            if (!raw) {
              // No snippet industry — assign single-industry search term, or leave blank
              return organization_industries.length === 1 ? organization_industries[0] : "";
            }

            // Try to match raw industry to one of the searched industries
            for (const searchInd of organization_industries) {
              const si = searchInd.toLowerCase().trim();
              if (raw === si) return searchInd; // Exact match → use search term casing
              if (raw.includes(si) || si.includes(raw)) return searchInd;
              // Word-boundary match for compound industries
              const rawWords = raw.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
              const siWords = si.split(/[,&/]+/).map(w => w.trim()).filter(Boolean);
              for (const rw of rawWords) {
                for (const sw of siWords) {
                  if (rw === sw || (rw.includes(sw) && sw.length >= 4) || (sw.includes(rw) && rw.length >= 4)) {
                    return searchInd; // Matched — use the user's search term
                  }
                }
              }
            }
            // Snippet industry doesn't match any search term — still assign
            // single-industry search term for consistency, or standardize globally
            return organization_industries.length === 1 ? organization_industries[0] : standardizeIndustryGlobal(rawIndustry);
          };

          const leads: DeepLead[] = trimmed.map((p, idx) => {
            const companyKey = (p.company || "").toLowerCase().trim();
            const domain = companyDomainMap.get(companyKey) || "";
            const cbEnrichment = companyEnrichCache.get(companyKey);

            // CRITICAL: For industry-targeted SerpAPI searches, ALWAYS assign the searched industry
            // The query itself was filtered by industry, so all results belong to that industry
            let assignedIndustry = "";
            
            if (serpIndustryHints?.length) {
              assignedIndustry = serpIndustryHints[0];
            } else if (cbEnrichment?.industry) {
              // Prefer Crunchbase industry over snippet
              assignedIndustry = standardizeIndustry(cbEnrichment.industry);
            } else if (p.industry) {
              assignedIndustry = standardizeIndustry(p.industry);
            }
            
            // Fallback: infer industry from search keywords + titles when no explicit source
            // e.g. searching "owner" with keyword "moving" → "Moving & Storage"
            if (!assignedIndustry && q_keywords) {
              const kwIndustry = standardizeIndustryGlobal(q_keywords);
              if (kwIndustry && kwIndustry !== toTitleCase(q_keywords)) {
                assignedIndustry = kwIndustry;
              } else if (kwIndustry) {
                // Use keyword as-is if standardization just title-cased it (still useful)
                assignedIndustry = kwIndustry;
              }
            }
            if (!assignedIndustry && person_titles?.length) {
              // Try to infer from job title context (e.g. "Real Estate Agent" → "Real Estate")
              for (const titleHint of person_titles) {
                const titleIndustry = standardizeIndustryGlobal(titleHint);
                if (titleIndustry && titleIndustry !== toTitleCase(titleHint)) {
                  assignedIndustry = titleIndustry;
                  break;
                }
              }
            }

            // Use Crunchbase-verified name if available, else clean raw name
            const verifiedCompanyName = cbEnrichment?.verified_name
              ? toTitleCase(cbEnrichment.verified_name)
              : toTitleCase(cleanCompanyName(p.company));

            // Merge website: prefer Crunchbase data, then domain discovery, then enrichment
            const websiteDomain = domain
              || (cbEnrichment?.website_url ? cbEnrichment.website_url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*/, "") : "");

            return {
              id: `deep_${Date.now()}_${idx}`,
              first_name: toTitleCase(p.first_name),
              last_name: toTitleCase(p.last_name),
              name: toTitleCase(p.name),
              title: standardizeJobTitle(cleanJobTitle(p.title)),
              email: "",
              email_status: "",
              linkedin_url: p.linkedin_url || "",
              phone_numbers: [],
              city: p.location || cbEnrichment?.city || "",
              state: cbEnrichment?.state || "",
              country: organization_locations?.[0] || cbEnrichment?.country || "",
              seniority: p.seniority,
              departments: [],
              organization: {
                id: "",
                name: verifiedCompanyName,
                website_url: websiteDomain ? `https://${websiteDomain}` : "",
                linkedin_url: cbEnrichment?.linkedin_url || "",
                industry: assignedIndustry,
                estimated_num_employees: cbEnrichment?.estimated_num_employees || p.estimated_num_employees || 0,
                annual_revenue_printed: cbEnrichment?.annual_revenue_printed || "",
                city: cbEnrichment?.city || "",
                state: cbEnrichment?.state || "",
                country: organization_locations?.[0] || cbEnrichment?.country || "",
                short_description: cbEnrichment?.short_description || p.snippet.substring(0, 200),
                founded_year: cbEnrichment?.founded_year || 0,
                phone: "",
              },
            };
          });

          // Sanitize all leads — strip leftover emoji/unicode from all fields
          leads.forEach(sanitizeDeepLead);

          console.log(`[DEEP PROSPECT] Created ${leads.length} DeepLead objects`);
          if (serpIndustryHints?.length) {
            console.log(`[DEEP PROSPECT] ✓ All ${leads.length} leads assigned industry "${serpIndustryHints[0]}" from industry-targeted search`);
          }
          console.log(`[DEEP PROSPECT] Industries: ${leads.map(l => l.organization?.industry || 'NONE').join(', ')}`);
          send("phase", { phase: 3, name: "Building lead profiles", status: "complete" });

          // Stream the newly built leads immediately so the UI shows them while enriching
          // Mark leads without email as _preview so the frontend quality gate doesn't filter them
          if (leads.length > 0) {
            const previewLeads = leads.map(l => {
              if (!l.email) return { ...l, _preview: true };
              return l;
            });
            send("people", { people: previewLeads, partial: true, preview: previewLeads.some(l => (l as any)._preview) });
          }

          // ══════════════════════════════════════════════════════════════
          // PHASE 4: Email Enrichment — Hunter → Findymail → Pattern
          // ══════════════════════════════════════════════════════════════
          const leadsWithDomain = leads.filter(l => l.organization.website_url);
          const leadsNoDomain = leads.filter(l => !l.organization.website_url);

          console.log(`[DEEP PROSPECT] Phase 4: ${leadsWithDomain.length} leads have domains, ${leadsNoDomain.length} without`);

          // ── Phase 4a: Hunter.io email finder ──
          let hunterFound = 0;
          let hunterPhoneFound = 0;

          if (HUNTER_KEY && leadsWithDomain.length > 0 && !isCancelled) {
            send("phase", { phase: 5, name: `Finding email addresses (${leadsWithDomain.length})`, status: "processing" });

            const HB = 10;
            for (let i = 0; i < leadsWithDomain.length; i += HB) {
              if (isCancelled) break;
              const batch = leadsWithDomain.slice(i, i + HB);

              const br = await Promise.allSettled(
                batch.map(async (lead) => {
                  const domain = lead.organization.website_url.replace(/^https?:\/\//, "").replace(/\/.*/, "").replace(/^www\./, "");
                  if (!domain || !lead.first_name || !lead.last_name) return null;
                  try {
                    const url = `https://api.hunter.io/v2/email-finder?first_name=${encodeURIComponent(lead.first_name)}&last_name=${encodeURIComponent(lead.last_name)}&domain=${encodeURIComponent(domain)}&api_key=${HUNTER_KEY}`;
                    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
                    if (!r.ok) return null;
                    const d = await r.json();
                    if (d.data?.email) return {
                      id: lead.id,
                      email: d.data.email,
                      status: d.data.score > 80 ? "verified" : "guessed",
                      phone: d.data.phone_number || null,
                      linkedin: d.data.linkedin_url || null,
                    };
                    return null;
                  } catch { return null; }
                })
              );

              for (const r of br) {
                if (r.status === "fulfilled" && r.value) {
                  hunterFound++;
                  const lead = leads.find(l => l.id === r.value!.id);
                  if (lead) {
                    lead.email = r.value.email;
                    lead.email_status = r.value.status;
                    if (r.value.phone && lead.phone_numbers.length === 0) {
                      lead.phone_numbers.push({ raw_number: r.value.phone, type: "direct" });
                      hunterPhoneFound++;
                    }
                    if (r.value.linkedin && !lead.linkedin_url) {
                      lead.linkedin_url = r.value.linkedin;
                    }
                    send("activity", { message: `Found contact details for ${lead.name}`, type: "success" });
                  }
                }
              }

              // Stream partial leads to frontend immediately
              const enrichedSoFar = leads.filter(l => l.email || l.phone_numbers.length > 0);
              if (enrichedSoFar.length > 0) {
                send("people", { people: enrichedSoFar, partial: true, preview: false });
              }

              send("progress", { fetched: Math.min(i + HB, leadsWithDomain.length), total: leadsWithDomain.length, phase: "email_discovery" });
              if (i + HB < leadsWithDomain.length) await sleep(50);
            }

            console.log(`[DEEP PROSPECT] Hunter found ${hunterFound} emails, ${hunterPhoneFound} phones`);
            send("phase", { phase: 5, name: "Finding email addresses", status: "complete" });
          }

          // ── Phase 4b: Findymail for leads still missing email ──
          let findymailFound = 0;

          if (FINDYMAIL_KEY && !isCancelled) {
            const stillNoEmail = leads.filter(l => !l.email && l.organization.website_url);
            if (stillNoEmail.length > 0) {
              send("phase", { phase: 6, name: `Advanced email search (${stillNoEmail.length})`, status: "processing" });

              const FB = 5;
              for (let i = 0; i < stillNoEmail.length; i += FB) {
                if (isCancelled) break;
                const batch = stillNoEmail.slice(i, i + FB);

                const br = await Promise.allSettled(
                  batch.map(async (lead) => {
                    const domain = lead.organization.website_url.replace(/^https?:\/\//, "").replace(/\/.*/, "").replace(/^www\./, "");
                    if (!domain) return null;
                    try {
                      const r = await fetch("https://app.findymail.com/api/search/name", {
                        method: "POST",
                        headers: { Authorization: `Bearer ${FINDYMAIL_KEY}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ first_name: lead.first_name, last_name: lead.last_name, domain }),
                        signal: AbortSignal.timeout(8000),
                      });
                      if (!r.ok) return null;
                      const d = await r.json();
                      if (d.email) return { id: lead.id, email: d.email, status: "verified" };
                      return null;
                    } catch { return null; }
                  })
                );

                for (const r of br) {
                  if (r.status === "fulfilled" && r.value) {
                    findymailFound++;
                    const lead = leads.find(l => l.id === r.value!.id);
                    if (lead) {
                      lead.email = r.value.email;
                      lead.email_status = r.value.status;
                      send("activity", { message: `Located email for ${lead.name}`, type: "success" });
                    }
                  }
                }
                
                const enrichedSoFar = leads.filter(l => l.email || l.phone_numbers.length > 0);
                if (enrichedSoFar.length > 0) {
                  send("people", { people: enrichedSoFar, partial: true, preview: false });
                }

                if (i + FB < stillNoEmail.length) await sleep(50);
              }

              console.log(`[DEEP PROSPECT] Findymail found ${findymailFound} emails`);
              send("phase", { phase: 6, name: "Advanced email search", status: "complete" });
            }
          }

          // ── Phase 4c: DISABLED — No pattern guessing ──
          // Pattern guessing (fabricating emails from firstname@domain.com) has been
          // permanently removed. Only real verified emails from Hunter.io and Findymail
          // are used. Fabricated emails cause bounces and damage sender reputation.
          let patternGuessed = 0;

          // ══════════════════════════════════════════════════════════════
          // PHASE 5: Email Verification
          // ══════════════════════════════════════════════════════════════
          let verified = 0, verifiedValid = 0, verifiedRisky = 0, verifiedInvalid = 0;

          const leadsWithEmail = leads.filter(l => !!l.email);
          if (leadsWithEmail.length > 0 && !isCancelled) {
            send("phase", { phase: 8, name: `Verifying deliverability (${leadsWithEmail.length})`, status: "processing" });

            try {
              const emailsToVerify = leadsWithEmail.map(l => ({ id: l.id, email: l.email }));
              const verificationResults = await verifyEmailBatch(emailsToVerify, 15);

              for (const [id, verification] of verificationResults) {
                const lead = leads.find(l => l.id === id);
                if (!lead) continue;

                // STRICT MX ENFORCEMENT: Drop ALL emails that fail DNS MX verification
                // This prevents bounce emails from reaching the CRM regardless of source
                if (verification.status === "invalid" || !verification.mx_valid) {
                  console.log(`[DEEP PROSPECT] MX REJECT: ${lead.email} (status=${verification.status}, mx_valid=${verification.mx_valid}) — dropping email for ${lead.name}`);
                  lead.email = "";
                  lead.email_status = "unavailable";
                  lead.email_verification = null;
                  verifiedInvalid++;
                  continue;
                }

                lead.email_verification = verification;
                verified++;
                if (verification.status === "valid") verifiedValid++;
                else if (verification.status === "risky") verifiedRisky++;
              }
            } catch (err: any) {
              console.warn(`[DEEP PROSPECT] Verification error: ${err.message}`);
            }

            send("phase", { phase: 8, name: "Verifying deliverability", status: "complete" });
          }

          // ══════════════════════════════════════════════════════════════
          // PHASE 6: Company enrichment + Phone via Hunter domain-search
          // Enriches: industry, employee count, revenue, location, phones
          // ══════════════════════════════════════════════════════════════
          let phoneEnrichFound = 0;
          const leadsWithWebsite = leads.filter(l => l.organization.website_url);

          if (HUNTER_KEY && leadsWithWebsite.length > 0 && !isCancelled) {
            send("phase", { phase: 7, name: `Enriching company data & phones (${leadsWithWebsite.length})`, status: "processing" });

            const domainLeadMap = new Map<string, DeepLead[]>();
            for (const lead of leadsWithWebsite) {
              const domain = lead.organization.website_url.replace(/^https?:\/\//, "").replace(/\/.*/, "").replace(/^www\./, "");
              if (!domain) continue;
              if (!domainLeadMap.has(domain)) domainLeadMap.set(domain, []);
              domainLeadMap.get(domain)!.push(lead);
            }

            const domains = [...domainLeadMap.keys()];
            const PB = 8;
            for (let i = 0; i < Math.min(domains.length, 40); i += PB) {
              if (isCancelled) break;
              const domainBatch = domains.slice(i, i + PB);

              const results = await Promise.allSettled(
                domainBatch.map(async (domain) => {
                  try {
                    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${HUNTER_KEY}&limit=50`;
                    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
                    if (!r.ok) return { domain, people: [], orgPhone: "", orgIndustry: "", orgEmployees: 0, orgRevenue: "", orgCity: "", orgState: "", orgCountry: "" };
                    const d = await r.json();
                    const org = d.data?.organization || {};
                    return {
                      domain,
                      people: (d.data?.emails || []).filter((e: any) => e.phone_number),
                      orgPhone: org.phone_number || "",
                      orgIndustry: org.industry || "",
                      orgEmployees: org.headcount || 0,
                      orgRevenue: org.annual_revenue ? `$${org.annual_revenue}` : "",
                      orgCity: org.city || "",
                      orgState: org.state || "",
                      orgCountry: org.country || "",
                    };
                  } catch { return { domain, people: [], orgPhone: "", orgIndustry: "", orgEmployees: 0, orgRevenue: "", orgCity: "", orgState: "", orgCountry: "" }; }
                })
              );

              for (const r of results) {
                if (r.status !== "fulfilled" || !r.value) continue;
                const { domain, people: domainPeople, orgPhone, orgIndustry, orgEmployees, orgRevenue, orgCity, orgState, orgCountry } = r.value;
                const domainLeads = domainLeadMap.get(domain) || [];

                for (const lead of domainLeads) {
                  // Enrich org data from Hunter domain-search (more reliable than snippet)
                  // Standardize to search term if industry filter is active
                  if (orgIndustry && !lead.organization.industry) {
                    lead.organization.industry = standardizeIndustry(orgIndustry);
                  }
                  if (orgEmployees && !lead.organization.estimated_num_employees) {
                    lead.organization.estimated_num_employees = orgEmployees;
                  }
                  if (orgRevenue && !lead.organization.annual_revenue_printed) {
                    lead.organization.annual_revenue_printed = orgRevenue;
                  }
                  if (orgCity && !lead.organization.city) {
                    lead.organization.city = orgCity;
                  }
                  if (orgState && !lead.organization.state) {
                    lead.organization.state = orgState;
                  }
                  if (orgCountry && !lead.organization.country) {
                    lead.organization.country = orgCountry;
                  }
                  if (lead.phone_numbers.length > 0) continue;

                  const match = domainPeople.find((p: any) =>
                    (p.first_name || "").toLowerCase() === lead.first_name.toLowerCase() &&
                    (p.last_name || "").toLowerCase() === lead.last_name.toLowerCase()
                  );

                  if (match?.phone_number) {
                    lead.phone_numbers.push({ raw_number: match.phone_number, type: "direct" });
                    phoneEnrichFound++;
                  } else if (orgPhone) {
                    lead.phone_numbers.push({ raw_number: orgPhone, type: "company" });
                    phoneEnrichFound++;
                  }
                }
              }
              
              const enrichedSoFar = leads.filter(l => l.email || l.phone_numbers.length > 0);
              if (enrichedSoFar.length > 0) {
                send("people", { people: enrichedSoFar, partial: true, preview: false });
              }

              if (i + PB < domains.length) await sleep(50);
            }

            send("phase", { phase: 7, name: "Enriching company data & phones", status: "complete" });
            console.log(`[DEEP PROSPECT] Domain-search enrichment: ${phoneEnrichFound} phones, org data for ${domains.length} domains`);
          }

          // ══════════════════════════════════════════════════════════════
          // PHASE 6b: Deep Phone Discovery — multi-source enrichment
          // Sources: Company staff pages, WHOIS, Press releases, Public records
          // ══════════════════════════════════════════════════════════════
          let deepPhoneFound = 0;
          let deepPhoneSources: Record<string, number> = {};
          const leadsStillNoPhone = leads.filter(l => l.phone_numbers.length === 0 && l.organization.website_url);

          if (leadsStillNoPhone.length > 0 && !isCancelled) {
            const DEEP_PHONE_CAP = Math.min(leadsStillNoPhone.length, 40);
            const leadsForDeepPhone = leadsStillNoPhone.slice(0, DEEP_PHONE_CAP);

            send("phase", { phase: 7.5, name: `Deep phone discovery (${leadsForDeepPhone.length})`, status: "processing" });
            console.log(`[DEEP PROSPECT] Phase 6b: Deep phone discovery for ${leadsForDeepPhone.length} leads`);

            try {
              const deepResult = await enrichPhoneNumbers(
                leadsForDeepPhone as DeepPhoneLead[],
                SERPAPI_KEY,
                EXPLORIUM_KEY || '',
                {
                  onProgress: (done, total) => {
                    send("progress", { fetched: done, total, phase: "deep_phone" });
                    // Stream partial updates as phones are found
                    const enrichedSoFar = leads.filter(l => l.email || l.phone_numbers.length > 0);
                    if (enrichedSoFar.length > 0) {
                      send("people", { people: enrichedSoFar, partial: true, preview: false });
                    }
                  },
                  isCancelled: () => isCancelled,
                  skipSerpSources: leadsForDeepPhone.length > 20,
                }
              );
              deepPhoneFound = deepResult.enriched;
              deepPhoneSources = deepResult.sources;
              console.log(`[DEEP PROSPECT] Deep phone discovery found ${deepPhoneFound} numbers:`, deepPhoneSources);
            } catch (err: any) {
              console.warn(`[DEEP PROSPECT] Deep phone discovery error (non-fatal): ${err.message}`);
            }

            send("phase", { phase: 7.5, name: "Deep phone discovery", status: "complete" });
          }

          // ══════════════════════════════════════════════════════════════
          // PHASE 6c: Telnyx Phone Verification
          // Validates all discovered phone numbers, drops invalid ones,
          // confirms mobile vs landline, normalizes to E.164 format.
          // ══════════════════════════════════════════════════════════════
          let phoneVerified = 0, phoneDropped = 0, mobileConfirmed = 0;
          const leadsWithAnyPhone = leads.filter(l => l.phone_numbers.length > 0);

          if (TELNYX_KEY && leadsWithAnyPhone.length > 0 && !isCancelled) {
            send("phase", { phase: 7.8, name: `Verifying phone numbers (${leadsWithAnyPhone.length})`, status: "processing" });
            console.log(`[DEEP PROSPECT] Phase 6c: Telnyx verification for ${leadsWithAnyPhone.length} leads`);

            try {
              const verifyResult = await verifyPhoneNumbers(
                leadsWithAnyPhone as DeepPhoneLead[],
                TELNYX_KEY,
                {
                  onProgress: (done, total) => {
                    send("progress", { fetched: done, total, phase: "phone_verify" });
                  },
                  isCancelled: () => isCancelled,
                }
              );
              phoneVerified = verifyResult.verified;
              phoneDropped = verifyResult.dropped;
              mobileConfirmed = verifyResult.mobileConfirmed;
              console.log(`[DEEP PROSPECT] Telnyx verification: ${phoneVerified} valid, ${phoneDropped} dropped, ${mobileConfirmed} confirmed mobile`);
            } catch (err: any) {
              console.warn(`[DEEP PROSPECT] Telnyx verification error (non-fatal): ${err.message}`);
            }

            send("phase", { phase: 7.8, name: "Verifying phone numbers", status: "complete" });
          }

          // ══════════════════════════════════════════════════════════════
          // PHASE 8b: Industry verification — resolve unknown industries
          // ALWAYS run: every lead needs industry data for clean CRM records.
          // Uses Hunter domain-search to discover real industry from company website.
          // ══════════════════════════════════════════════════════════════
          if (HUNTER_KEY && !isCancelled) {
            const leadsNoIndustry = leads.filter(l => !l.organization.industry && l.organization.website_url);
            if (leadsNoIndustry.length > 0) {
              console.log(`[DEEP PROSPECT] Industry verification: ${leadsNoIndustry.length} leads need industry data`);

              // Build domain → leads map (only for leads we haven't already enriched)
              const indDomainMap = new Map<string, DeepLead[]>();
              for (const lead of leadsNoIndustry) {
                const domain = lead.organization.website_url.replace(/^https?:\/\//, "").replace(/\/.*/, "").replace(/^www\./, "");
                if (!domain) continue;
                if (!indDomainMap.has(domain)) indDomainMap.set(domain, []);
                indDomainMap.get(domain)!.push(lead);
              }

              const indDomains = [...indDomainMap.keys()].slice(0, 30); // Cap at 30 lookups
              const IB = 5;
              for (let i = 0; i < indDomains.length; i += IB) {
                if (isCancelled) break;
                const batch = indDomains.slice(i, i + IB);
                const results = await Promise.allSettled(
                  batch.map(async (domain) => {
                    try {
                      const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${HUNTER_KEY}&limit=1`;
                      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
                      if (!r.ok) return { domain, industry: "" };
                      const d = await r.json();
                      return { domain, industry: d.data?.organization?.industry || "" };
                    } catch { return { domain, industry: "" }; }
                  })
                );
                for (const r of results) {
                  if (r.status !== "fulfilled" || !r.value?.industry) continue;
                  const domainLeads = indDomainMap.get(r.value.domain) || [];
                  for (const lead of domainLeads) {
                    if (!lead.organization.industry) {
                      lead.organization.industry = standardizeIndustry(r.value.industry);
                    }
                  }
                }
                if (i + IB < indDomains.length) await sleep(200);
              }

              const resolved = leadsNoIndustry.filter(l => l.organization.industry).length;
              console.log(`[DEEP PROSPECT] Industry verification complete: ${resolved}/${leadsNoIndustry.length} resolved`);
            }
          }

          // ═════════════════════════════════════════════════════════════
          // FINAL: Merge pool + external, deduplicate, emit results
          // Two-tier approach: prioritize leads WITH email, then fill
          // remaining slots with leads that have name+company+title
          // (still useful for LinkedIn outreach / manual research)
          // ══════════════════════════════════════════════════════════════
          const mergedEmails = new Set<string>();
          const mergedNames = new Set<string>();
          const tier1People: DeepLead[] = []; // With email
          const tier2People: DeepLead[] = []; // Without email but have name+company+title

          // Helper: check if lead has basic data (name + company + title) but no email
          // More lenient for leads with LinkedIn URL — still actionable for outreach
          const isPartialQualityLead = (lead: DeepLead): boolean => {
            const name = (lead.name || "").trim();
            if (!name || name === "\u2014" || name === "-") return false;
            if (!lead.first_name?.trim() || !lead.last_name?.trim()) return false;
            // ── Name quality gate (same as full quality) ──
            if (!isCleanPersonName(lead.first_name, lead.last_name)) return false;
            const companyName = (lead.organization?.name || "").trim();
            const hasLinkedIn = !!lead.linkedin_url;
            // Run through cleanCompanyName — rejects LinkedIn headlines, job titles, sentences
            const cleanedCo = cleanCompanyName(companyName);
            const JUNK_COMPANY = new Set([
              "saas", "b2b", "b2c", "ai", "it", "hr", "tech", "software", "company",
              "business", "unknown", "n/a", "na", "none", "undefined", "null", "other",
              "service", "services", "agency", "group", "corp", "inc", "linkedin",
            ]);
            if (!cleanedCo || cleanedCo === "\u2014" || cleanedCo === "-" || cleanedCo.length < 2) {
              if (!hasLinkedIn) return false; // No company + no LinkedIn = reject
            } else if (JUNK_COMPANY.has(cleanedCo.toLowerCase()) && !hasLinkedIn) {
              return false;
            }
            // Reject company names that are >80 chars (descriptions, not names)
            if (companyName.length > 80) return false;
            // STRICT: Require a real job title — leads without title are not clean data
            const titleClean = (lead.title || "").trim();
            if (!titleClean) return false;
            // Reject title if it's a sentence (>8 words)
            if (titleClean.split(/\s+/).length > 8) return false;
            return true;
          };

          // When force_external, prioritize external leads (industry-targeted by SerpAPI)
          // over pool leads (generic fallback). Otherwise, pool leads first (cheaper, pre-enriched).
          const primarySource = force_external ? leads : poolLeads.map(pl => pl as any as DeepLead);
          const secondarySource = force_external ? poolLeads.map(pl => pl as any as DeepLead) : leads;

          // When force_external + preferred_industries are provided, use preferred_industries
          // to filter pool leads (secondary source) — prevents generic pool leads from polluting results
          const industryFilterForPool = force_external && preferred_industries?.length && !organization_industries?.length
            ? preferred_industries
            : organization_industries;

          if (force_external && preferred_industries?.length && !organization_industries?.length) {
            console.log(`[DEEP PROSPECT] Applying preferred_industries filter to pool leads: [${preferred_industries.join(', ')}]`);
          }

          // Track external lead IDs — SerpAPI queries already include location constraints,
          // so external leads are location-trusted and skip redundant location re-filtering.
          // Previously, location filter silently killed all scraped leads because LinkedIn
          // snippet locations (e.g. "Dallas, TX") didn't contain "United States".
          const externalLeadIds = new Set(leads.map(l => l.id));

          let mergeStats = { industryRejected: 0, locationRejected: 0, qualityRejected: 0, partialRejected: 0 };

          for (const el of primarySource) {
            const dlead = el as DeepLead;
            // Skip strict industry & location filters for external leads — their SerpAPI queries
            // already included these constraints in the query itself, so they are contextually valid.
            if (!externalLeadIds.has(dlead.id)) {
              if (!matchesIndustryFilter(dlead, organization_industries)) { mergeStats.industryRejected++; continue; }
              if (!matchesLocationFilter(dlead, organization_locations)) { mergeStats.locationRejected++; continue; }
            }
            const email = (dlead.email || "").toLowerCase();
            const nameKey = (dlead.name || "").toLowerCase();
            if (email && isQualityLead(dlead)) {
              if (!mergedEmails.has(email)) {
                mergedEmails.add(email);
                mergedNames.add(nameKey);
                tier1People.push(dlead);
              }
            } else if (isPartialQualityLead(dlead) && !mergedNames.has(nameKey)) {
              mergedNames.add(nameKey);
              if (!dlead.email) dlead.email_status = "unavailable";
              tier2People.push(dlead);
            } else {
              if (email) mergeStats.qualityRejected++;
              else mergeStats.partialRejected++;
            }
          }

          // Secondary source fills remaining slots
          // When force_external, apply industryFilterForPool (preferred_industries fallback) to pool leads
          const secondaryIndustryFilter = force_external ? industryFilterForPool : organization_industries;
          for (const el of secondarySource) {
            const dlead = el as DeepLead;
            if (!externalLeadIds.has(dlead.id)) {
              if (!matchesIndustryFilter(dlead, secondaryIndustryFilter)) { mergeStats.industryRejected++; continue; }
              if (!matchesLocationFilter(dlead, organization_locations)) { mergeStats.locationRejected++; continue; }
            }
            const email = (dlead.email || "").toLowerCase();
            const nameKey = (dlead.name || "").toLowerCase();
            if (email && isQualityLead(dlead)) {
              if (!mergedEmails.has(email)) {
                mergedEmails.add(email);
                mergedNames.add(nameKey);
                tier1People.push(dlead);
              }
            } else if (isPartialQualityLead(dlead) && !mergedNames.has(nameKey)) {
              mergedNames.add(nameKey);
              if (!dlead.email) dlead.email_status = "unavailable";
              tier2People.push(dlead);
            } else {
              if (email) mergeStats.qualityRejected++;
              else mergeStats.partialRejected++;
            }
          }

          console.log(`[DEEP PROSPECT] Merge filter stats: ${JSON.stringify(mergeStats)} (industryRejected=${mergeStats.industryRejected}, locationRejected=${mergeStats.locationRejected}, qualityRejected=${mergeStats.qualityRejected}, partialRejected=${mergeStats.partialRejected})`);

          if (force_external) {
            console.log(`[DEEP PROSPECT] Merge priority: external leads first (${leads.length}), then pool leads (${poolLeads.length})`);
          }

          const preQualityCount = poolLeads.length + leads.length;
          if (organization_industries?.length) {
            console.log(`[DEEP PROSPECT] Industry filter active: [${organization_industries.join(', ')}]`);
          }
          console.log(`[DEEP PROSPECT] Two-tier merge: ${tier1People.length} with email (tier 1), ${tier2People.length} without email (tier 2), from ${preQualityCount} total candidates`);

          // Sort within each tier: leads WITH industry first, then without
          const sortByIndustry = (a: DeepLead, b: DeepLead) => {
            const aInd = a.organization?.industry ? 1 : 0;
            const bInd = b.organization?.industry ? 1 : 0;
            return bInd - aInd;
          };
          tier1People.sort(sortByIndustry);
          tier2People.sort(sortByIndustry);

          // Fill: tier 1 first (with email), then tier 2 (without email) to reach max_results
          const finalPeople: DeepLead[] = [];
          for (const p of tier1People) {
            if (finalPeople.length >= max_results) break;
            finalPeople.push(p);
          }
          if (finalPeople.length < max_results) {
            for (const p of tier2People) {
              if (finalPeople.length >= max_results) break;
              // Mark tier2 leads (without email) as preview so frontend doesn't filter them out
              (p as any)._preview = true;
              // Don't set _has_email = false - let it be undefined so frontend quality gate allows it
              finalPeople.push(p);
            }
          }

          const withIndustry = finalPeople.filter(l => l.organization?.industry).length;
          const previewLeads = finalPeople.filter(l => (l as any)._preview).length;
          console.log(`[DEEP PROSPECT] Final output: ${finalPeople.length} leads (${finalPeople.filter(l => l.email).length} with email, ${finalPeople.filter(l => !l.email).length} without email [${previewLeads} marked as preview for frontend], ${withIndustry} with industry)`);

          // Save to pool
          send("phase", { phase: 9, name: "Saving to database", status: "processing" });
          const poolSaved = await saveToPool(leads.filter(l => l.email) as any as PoolLead[]).catch(() => ({ saved: 0, skipped: 0 }));
          send("phase", { phase: 9, name: "Saving to database", status: "complete", saved: poolSaved.saved });

          // Cache results
          kv.set(cacheKey, {
            people: finalPeople,
            timestamp: Date.now(),
            enriched: true,
          }).catch(() => {});

          // CRM dedup
          let existingEmails = new Set<string>();
          try {
            const teamIds = await getTeamMemberIds(user.id);
            const { data: el } = await supabase.from("leads").select("email").in("user_id", teamIds);
            if (el) existingEmails = new Set(el.map((l: any) => (l.email || "").toLowerCase()).filter(Boolean));
          } catch {}

          const enrichmentSources = {
            hunter: hunterFound,
            findymail: findymailFound,
            web_sources: 0,
            phone_enrich: phoneEnrichFound + deepPhoneFound,
            hunter_phone: hunterPhoneFound,
            deep_phone: deepPhoneFound,
            deep_phone_sources: deepPhoneSources,
            phone_verified: phoneVerified,
            phone_dropped: phoneDropped,
            mobile_confirmed: mobileConfirmed,
            pattern_guessed: patternGuessed,
            verified: verified,
            verified_valid: verifiedValid,
            verified_risky: verifiedRisky,
            verified_invalid: verifiedInvalid,
          };

          const stats = buildStats(finalPeople, enrichmentSources);

          const hasPreviewLeads = finalPeople.some(l => (l as any)._preview);
          send("people", { people: finalPeople, partial: false, preview: hasPreviewLeads });
          send("complete", {
            people: finalPeople,
            stats,
            existing_emails: Array.from(existingEmails),
            duplicate_count: 0,
            deep_prospect: true,
            preview: hasPreviewLeads,
            from_pool: poolLeads.length,
            from_external: leads.length,
            pool_saved: poolSaved.saved,
            total_available: allParsed.length + poolLeads.length,
            requested: max_results,
          });

          console.log(`[DEEP PROSPECT] COMPLETE: ${finalPeople.length} leads (${finalPeople.filter(l => l.email).length} with email, ${finalPeople.filter(l => l.phone_numbers?.length > 0).length} with phone)`);

        } catch (error: any) {
          if (!isCancelled && !controllerClosed) {
            send("error", { message: error.message, stack: error.stack });
            console.error("[DEEP PROSPECT] Stream error:", error);
          }
        } finally {
          clearInterval(heartbeat);
          safeClose();
        }
      },
    });

    // Use Hono's context methods for proper middleware integration (CORS etc.)
    // Avoids raw `new Response()` which can bypass the parent CORS middleware chain.
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    // Note: "Connection: keep-alive" omitted — invalid in HTTP/2 (Supabase Edge Functions)
    // ── Explicit CORS headers (belt-and-suspenders) ──
    // Hono's CORS middleware may not always inject headers on streaming responses
    // returned via c.body(). Adding them explicitly guarantees the browser accepts
    // the SSE stream without triggering "TypeError: network error".
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With, apikey");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(stream);
  } catch (error: any) {
    if (error?.name !== "Http" && !error?.message?.includes("connection closed") && !error?.message?.includes("broken pipe") && !error?.message?.includes("EPIPE")) {
      console.error("[DEEP PROSPECT] Error:", error.message, error.stack);
    }
    // Explicit CORS on error responses too — ensures the browser can read the error JSON
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With, apikey");
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /ping — lightweight diagnostic: confirms sub-app loaded & routes work ──
app.get("/ping", (c) => c.json({ ok: true, module: "deep-prospect", ts: Date.now() }));
// POST /ping — same diagnostic, allows warm-up from POST-based clients
app.post("/ping", (c) => c.json({ ok: true, module: "deep-prospect", ts: Date.now() }));

// ── GET /status — check discovery engine availability ──
app.get("/status", async (c) => {
  const key = Deno.env.get("SERPAPI_API_KEY");
  return c.json({
    available: !!key,
    provider: "discovery_engine",
    description: "Smart Discovery — LinkedIn + Web multi-source lead prospecting engine",
  });
});

// ── GET /pool-stats — show how many leads are available locally ──
app.get("/pool-stats", async (c) => {
  try {
    const stats = await getPoolStats();
    return c.json({ success: true, ...stats });
  } catch (error: any) {
    console.error("[DEEP PROSPECT] Pool stats error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── Helper: build stats object ──
function buildStats(people: any[], enrichmentSources?: any) {
  const stats: any = {
    total: people.length,
    with_email: people.filter((p: any) => p.email).length,
    verified_emails: people.filter((p: any) => p.email_status === "verified").length,
    guessed_emails: people.filter((p: any) => p.email_status === "guessed").length,
    with_phone: people.filter((p: any) => p.phone_numbers?.length > 0).length,
    with_linkedin: people.filter((p: any) => p.linkedin_url).length,
    unique_companies: new Set(people.map((p: any) => p.organization?.name).filter(Boolean)).size,
    seniority_breakdown: {} as Record<string, number>,
  };

  if (enrichmentSources) stats.enrichment_sources = enrichmentSources;

  for (const p of people) {
    const s = (p as any).seniority || inferSeniority((p as any).title || "") || "other";
    stats.seniority_breakdown[s] = (stats.seniority_breakdown[s] || 0) + 1;
  }

  return stats;
}

// ══════════════════════════════════════════════════════════════════════════
// POST /enrich-linkedin — Deep-enrich a single person from their LinkedIn URL
// Full pipeline identical to lead finder, aggressively parallelized to fit
// within Edge Function timeout (~50s budget):
//   Phase A: SerpAPI LinkedIn scrape (sequential — must complete first)
//   Phase B: PARALLEL — Crunchbase enrichment + website discovery
//   Phase C: PARALLEL — Hunter email + Hunter domain-search + Findymail
//   Phase D: Deep phone discovery (only if still missing + time budget)
//   Phase E: Email pattern guessing (last resort)
// ══════════════════════════════════════════════════════════════════════════
app.post("/enrich-linkedin", async (c) => {
  const t0 = Date.now();
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();
    const linkedinUrl = (body.linkedin_url || "").trim();

    if (!linkedinUrl) return c.json({ error: "linkedin_url is required" }, 400);

    let normalizedUrl = linkedinUrl;
    if (!normalizedUrl.startsWith("http")) normalizedUrl = "https://" + normalizedUrl;
    const linkedinMatch = normalizedUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (!linkedinMatch) {
      return c.json({ error: "Invalid LinkedIn URL. Expected format: linkedin.com/in/username" }, 400);
    }
    const username = linkedinMatch[1];
    normalizedUrl = `https://www.linkedin.com/in/${username}`;

    console.log(`[LINKEDIN ENRICH] User ${user.id} enriching: ${normalizedUrl}`);

    const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
    if (!SERPAPI_KEY) return c.json({ error: "Discovery engine not configured" }, 500);
    const HUNTER_KEY = Deno.env.get("HUNTER_API_KEY");
    const FINDYMAIL_KEY = Deno.env.get("FINDYMAIL_API_KEY");
    const EXPLORIUM_KEY = Deno.env.get("EXPLORIUM_API_KEY") || "";

    // ══════════════════════════════════════════════════════════════
    // PHASE A: SerpAPI Google scrape — name/title/company (~3s)
    // ══════════════════════════════════════════════════════════════
    const query = `site:linkedin.com/in/${username}`;
    console.log(`[LINKEDIN ENRICH] Phase A — SerpAPI: "${query}"`);
    const serpResponse = await fetch(`https://serpapi.com/search?${new URLSearchParams({
      engine: "google", q: query, api_key: SERPAPI_KEY, num: "5",
    })}`, { signal: AbortSignal.timeout(5000) });

    if (!serpResponse.ok) {
      console.error(`[LINKEDIN ENRICH] SerpAPI failed: ${serpResponse.status} (${Date.now() - t0}ms)`);
      return c.json({ error: "Search engine temporarily unavailable" }, 502);
    }

    const serpData = await serpResponse.json();
    const results = serpData.organic_results || [];

    let parsed: ParsedPerson | null = null;
    for (const result of results) {
      if ((result.link || "").toLowerCase().includes(`linkedin.com/in/${username.toLowerCase()}`)) {
        parsed = parseSearchResult(result);
        if (parsed) break;
      }
    }
    if (!parsed) {
      for (const result of results) {
        parsed = parseSearchResult(result);
        if (parsed) break;
      }
    }
    if (!parsed) {
      console.log(`[LINKEDIN ENRICH] No results, trying broader search`);
      try {
        const broadResp = await fetch(`https://serpapi.com/search?${new URLSearchParams({
          engine: "google", q: `"${username}" linkedin`, api_key: SERPAPI_KEY, num: "5",
        })}`, { signal: AbortSignal.timeout(4000) });
        if (broadResp.ok) {
          const broadData = await broadResp.json();
          for (const result of (broadData.organic_results || [])) {
            if ((result.link || "").toLowerCase().includes("linkedin.com/in/")) {
              parsed = parseSearchResult(result);
              if (parsed) break;
            }
          }
        }
      } catch (e: any) {
        console.warn(`[LINKEDIN ENRICH] Broad search failed: ${e.message}`);
      }
    }

    if (!parsed) {
      return c.json({ error: "Could not find profile data for this LinkedIn URL. The profile may be private or not indexed by Google." }, 404);
    }

    const companyName = cleanCompanyName(parsed.company);
    console.log(`[LINKEDIN ENRICH] Phase A done (${Date.now() - t0}ms): ${parsed.first_name} ${parsed.last_name}, title="${parsed.title}", company="${companyName}", location="${parsed.location}", snippet="${parsed.snippet.substring(0, 100)}..."`);

    // ══════════════════════════════════════════════════════════════
    // PHASE B: PARALLEL — Crunchbase + Website discovery (~5s)
    // ══════════════════════════════════════════════════════════════
    let companyData: CompanyEnrichment | null = null;
    let websiteDomain = "";

    if (companyName) {
      console.log(`[LINKEDIN ENRICH] Phase B — Parallel company + website for: "${companyName}"`);
      const [cbResult, domainResult] = await Promise.allSettled([
        enrichCompanyData(companyName, parsed.location, SERPAPI_KEY),
        discoverCompanyWebsite(companyName, parsed.location, SERPAPI_KEY),
      ]);

      if (cbResult.status === "fulfilled" && cbResult.value) {
        companyData = cbResult.value;
        console.log(`[LINKEDIN ENRICH] Crunchbase: ${companyData.verified_name}, website=${companyData.website_url}, industry=${companyData.industry}, employees=${companyData.estimated_num_employees}, ${companyData.city}/${companyData.state}/${companyData.country}`);
      } else if (cbResult.status === "rejected") {
        console.warn(`[LINKEDIN ENRICH] Crunchbase failed: ${cbResult.reason}`);
      }

      websiteDomain = (companyData?.website_url || "")
        .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*/, "");
      if (!websiteDomain && domainResult.status === "fulfilled" && domainResult.value) {
        websiteDomain = domainResult.value;
        console.log(`[LINKEDIN ENRICH] Google website: ${websiteDomain}`);
      }
      
      // Fallback: If we still don't have a domain but have a company name, try direct Google search
      if (!websiteDomain && companyName && (Date.now() - t0) < 30000) {
        console.log(`[LINKEDIN ENRICH] Attempting direct company search fallback for: "${companyName}"`);
        try {
          const fallbackQuery = `"${companyName}" official website`;
          const fallbackResp = await fetch(`https://serpapi.com/search?${new URLSearchParams({
            engine: "google", q: fallbackQuery, api_key: SERPAPI_KEY, num: "3",
          })}`, { signal: AbortSignal.timeout(3500) });
          
          if (fallbackResp.ok) {
            const fallbackData = await fallbackResp.json();
            for (const result of (fallbackData.organic_results || [])) {
              const link = result.link || "";
              // Extract domain and validate it's not a directory/social site
              const domainMatch = link.match(/^https?:\/\/(?:www\.)?([^\/]+)/i);
              if (domainMatch) {
                const potentialDomain = domainMatch[1].toLowerCase();
                // Skip common non-company domains
                if (!/^(linkedin|facebook|twitter|instagram|youtube|wikipedia|crunchbase|bloomberg|forbes|glassdoor|indeed|reddit|quora|medium)\./.test(potentialDomain)) {
                  websiteDomain = potentialDomain;
                  console.log(`[LINKEDIN ENRICH] Fallback search found domain: ${websiteDomain}`);
                  break;
                }
              }
            }
          }
        } catch (e: any) {
          console.warn(`[LINKEDIN ENRICH] Fallback domain search failed: ${e.message}`);
        }
      }
    } else {
      // Phase B fallback: no company from snippet parsing — try a targeted Google search
      // to discover the person's current company from other indexed sources
      console.warn(`[LINKEDIN ENRICH] Phase B — no company from snippet, attempting person+title company discovery`);
      if (parsed.first_name && parsed.last_name && (Date.now() - t0) < 20000) {
        try {
          const personQuery = parsed.title
            ? `"${parsed.first_name} ${parsed.last_name}" "${parsed.title}" company`
            : `"${parsed.first_name} ${parsed.last_name}" linkedin company`;
          const personResp = await fetch(`https://serpapi.com/search?${new URLSearchParams({
            engine: "google", q: personQuery, api_key: SERPAPI_KEY, num: "5",
          })}`, { signal: AbortSignal.timeout(4000) });

          if (personResp.ok) {
            const personData = await personResp.json();
            const personResults = personData.organic_results || [];

            // Try to extract company from search results
            for (const pr of personResults) {
              const prTitle = (pr.title || "");
              const prSnippet = (pr.snippet || "");
              const combined = prTitle + " " + prSnippet;

              // Look for "at Company" pattern in results
              const atMatch = combined.match(/(?:at|@)\s+([A-Z][A-Za-z0-9\s&.,'-]{1,50}?)(?:\s*[|·•\-–—,]|\s+(?:in|since|from|as|where|with|for|is|was|has)\b|$)/i);
              if (atMatch) {
                let candidateCompany = atMatch[1].trim().replace(/[.,]+$/, "").trim();
                // Validate: not garbage
                if (candidateCompany.length >= 2 && candidateCompany.length <= 60
                  && !/^(linkedin|facebook|twitter|instagram|youtube|wikipedia|google|indeed|glassdoor)/i.test(candidateCompany)
                  && !/^(experience|education|skills|connections)/i.test(candidateCompany)) {
                  parsed.company = candidateCompany;
                  console.log(`[LINKEDIN ENRICH] Person search found company: "${candidateCompany}"`);
                  break;
                }
              }
            }

            // If we found a company, now do Crunchbase + website discovery
            if (parsed.company) {
              const discoveredCompany = cleanCompanyName(parsed.company);
              if (discoveredCompany) {
                console.log(`[LINKEDIN ENRICH] Phase B (late) — enriching discovered company: "${discoveredCompany}"`);
                const [cbResult2, domainResult2] = await Promise.allSettled([
                  enrichCompanyData(discoveredCompany, parsed.location, SERPAPI_KEY),
                  discoverCompanyWebsite(discoveredCompany, parsed.location, SERPAPI_KEY),
                ]);

                if (cbResult2.status === "fulfilled" && cbResult2.value) {
                  companyData = cbResult2.value;
                  console.log(`[LINKEDIN ENRICH] Late Crunchbase: ${companyData.verified_name}, website=${companyData.website_url}`);
                }

                websiteDomain = (companyData?.website_url || "")
                  .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*/, "");
                if (!websiteDomain && domainResult2.status === "fulfilled" && domainResult2.value) {
                  websiteDomain = domainResult2.value;
                  console.log(`[LINKEDIN ENRICH] Late Google website: ${websiteDomain}`);
                }
              }
            }
          }
        } catch (e: any) {
          console.warn(`[LINKEDIN ENRICH] Person company discovery failed: ${e.message}`);
        }
      }
    }

    // Update companyName reference if we discovered it late
    const finalCompanyName = cleanCompanyName(parsed.company) || companyName;
    console.log(`[LINKEDIN ENRICH] Phase B done (${Date.now() - t0}ms): company=${finalCompanyName || "NONE"}, domain=${websiteDomain || "NONE"}`);

    // ══════════════════════════════════════════════════════════════
    // Build DeepLead
    // ══════════════════════════════════════════════════════════════
    const verifiedCompanyName = companyData?.verified_name
      ? toTitleCase(companyData.verified_name)
      : toTitleCase(finalCompanyName);

    // Enhanced location extraction with multiple fallback strategies
    let snippetCity = "", snippetState = "", snippetCountry = "";
    if (parsed.location) {
      const loc = parsed.location.trim();
      const isGarbage = /^(experience|education|about|summary|skills|connections|see all|view|project|certification|license|volunteer|publication|honor|language|course|recommendation|activity|posts|articles|services?|products?|analytics|solutions?|features?|pricing|demo|consulting|management|marketing|engineering|development|technology|design|human resources?|finance|operations?|sales|support|strategy|logistics|compliance|legal|training|staffing|recruiting|recruitment|accounting|media|data|research|security|procurement|administration|customer success|information technology|it|full[- ]?time|part[- ]?time|contract|freelance|intern(?:ship)?|self[- ]?employed)/i.test(loc)
        || /^\d+\+?\s*(connections?|followers?|endorsements?)$/i.test(loc)
        || /:\s/.test(loc)
        || loc.length < 3;
      if (!isGarbage) {
        const parts = loc.split(",").map((p: string) => p.trim());
        if (parts.length >= 3) { 
          snippetCity = parts[0]; 
          snippetState = parts[1]; 
          snippetCountry = parts[2];
        } else if (parts.length >= 2) { 
          snippetCity = parts[0]; 
          snippetState = parts[1]; 
        } else {
          snippetCity = parts[0];
        }
      }
    }

    // If we still don't have location data, try parsing the entire snippet for location patterns
    if (!snippetCity && !snippetState && parsed.snippet) {
      // Look for common location patterns: "City, State", "City, Country", "State, Country"
      const locationPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
      const matches = [...parsed.snippet.matchAll(locationPattern)];
      if (matches.length > 0) {
        const [, city, stateOrCountry] = matches[0];
        snippetCity = city.trim();
        // If it's a 2-letter code, it's probably a state
        if (/^[A-Z]{2}$/.test(stateOrCountry)) {
          snippetState = stateOrCountry;
        } else {
          // Could be country or state - if it's a common country, mark as country
          const commonCountries = /^(United States|United Kingdom|Canada|Australia|Germany|France|India|Brazil|Mexico|Spain|Italy|Netherlands|Sweden|Norway|Denmark|Finland|Ireland|Switzerland|Austria|Belgium|Poland|Singapore|Japan|China|Korea|Malaysia|Thailand|Vietnam|Philippines|Indonesia)$/i;
          if (commonCountries.test(stateOrCountry)) {
            snippetCountry = stateOrCountry;
          } else {
            snippetState = stateOrCountry;
          }
        }
      }
    }

    const lead: DeepLead = {
      id: `linkedin_enrich_${Date.now()}`,
      first_name: toTitleCase(parsed.first_name),
      last_name: toTitleCase(parsed.last_name),
      name: toTitleCase(parsed.name),
      title: standardizeJobTitle(cleanJobTitle(parsed.title)),
      email: "",
      email_status: "",
      linkedin_url: normalizedUrl,
      phone_numbers: [],
      city: snippetCity || companyData?.city || "",
      state: snippetState || companyData?.state || "",
      country: snippetCountry || companyData?.country || "",
      seniority: parsed.seniority || inferSeniority(parsed.title),
      departments: [],
      organization: {
        id: "",
        name: verifiedCompanyName,
        website_url: websiteDomain ? `https://${websiteDomain}` : "",
        linkedin_url: companyData?.linkedin_url || "",
        industry: standardizeIndustryGlobal(companyData?.industry || parsed.industry || ""),
        estimated_num_employees: companyData?.estimated_num_employees || parsed.estimated_num_employees || 0,
        annual_revenue_printed: companyData?.annual_revenue_printed || "",
        city: companyData?.city || "",
        state: companyData?.state || "",
        country: companyData?.country || "",
        short_description: companyData?.short_description || "",
        founded_year: companyData?.founded_year || 0,
        phone: "",
      },
    };
    sanitizeDeepLead(lead);

    // ══════════════════════════════════════════════════════════════
    // PHASE C: PARALLEL — Hunter email + domain-search + Findymail (~5s)
    // ══════════════════════════════════════════════════════════════
    if (websiteDomain) {
      console.log(`[LINKEDIN ENRICH] Phase C — Parallel email + domain: ${websiteDomain}`);

      const hunterEmailP = (HUNTER_KEY && lead.first_name && lead.last_name) ? (async () => {
        try {
          const url = `https://api.hunter.io/v2/email-finder?first_name=${encodeURIComponent(lead.first_name)}&last_name=${encodeURIComponent(lead.last_name)}&domain=${encodeURIComponent(websiteDomain)}&api_key=${HUNTER_KEY}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) return null;
          const d = await r.json();
          return d.data?.email ? { email: d.data.email, score: d.data.score || 0, phone: d.data.phone_number || null, position: d.data.position || null, company: d.data.company || null, linkedin: d.data.linkedin || null, twitter: d.data.twitter || null, first_name: d.data.first_name || null, last_name: d.data.last_name || null } : null;
        } catch { return null; }
      })() : Promise.resolve(null);

      const hunterDomainP = HUNTER_KEY ? (async () => {
        try {
          const r = await fetch(
            `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(websiteDomain)}&api_key=${HUNTER_KEY}&limit=50`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!r.ok) return null;
          return await r.json();
        } catch { return null; }
      })() : Promise.resolve(null);

      const findymailP = (FINDYMAIL_KEY && lead.first_name && lead.last_name) ? (async () => {
        try {
          const r = await fetch("https://app.findymail.com/api/search/name", {
            method: "POST",
            headers: { Authorization: `Bearer ${FINDYMAIL_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ first_name: lead.first_name, last_name: lead.last_name, domain: websiteDomain }),
            signal: AbortSignal.timeout(6000),
          });
          if (!r.ok) return null;
          const d = await r.json();
          return d.email ? { email: d.email } : null;
        } catch { return null; }
      })() : Promise.resolve(null);

      const [heR, hdR, fmR] = await Promise.allSettled([hunterEmailP, hunterDomainP, findymailP]);

      // Apply Hunter email-finder (includes structured person data)
      const he = heR.status === "fulfilled" ? heR.value : null;
      if (he?.email) {
        lead.email = he.email;
        lead.email_status = he.score > 80 ? "verified" : "guessed";
        console.log(`[LINKEDIN ENRICH] Hunter email: ${lead.email} (score: ${he.score})`);
        if (he.phone) lead.phone_numbers.push({ raw_number: he.phone, type: "direct" });

        // Hunter email-finder returns authoritative position/company — use to validate/correct
        if (he.position) {
          const hunterTitle = standardizeJobTitle(cleanJobTitle(he.position));
          if (hunterTitle) {
            if (!lead.title || lead.title.length < 3) {
              lead.title = hunterTitle;
              console.log(`[LINKEDIN ENRICH] Hunter title (backfill): "${hunterTitle}"`);
            } else {
              // If Hunter title is substantially different and cleaner, prefer it
              const serpTitle = lead.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
              const hTitle = hunterTitle.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
              if (serpTitle !== hTitle && !serpTitle.includes(hTitle) && !hTitle.includes(serpTitle)) {
                console.log(`[LINKEDIN ENRICH] Hunter title correction: "${lead.title}" → "${hunterTitle}"`);
                lead.title = hunterTitle;
              }
            }
          }
        }
        if (he.company) {
          const hunterCompany = toTitleCase(cleanCompanyName(he.company));
          if (hunterCompany && !lead.organization.name) {
            lead.organization.name = hunterCompany;
            console.log(`[LINKEDIN ENRICH] Hunter company (backfill): "${hunterCompany}"`);
          }
        }
      }

      // Apply Findymail (fallback)
      if (!lead.email) {
        const fm = fmR.status === "fulfilled" ? fmR.value : null;
        if (fm?.email) {
          lead.email = fm.email;
          lead.email_status = "verified";
          console.log(`[LINKEDIN ENRICH] Findymail email: ${lead.email}`);
        }
      }

      // Apply Hunter domain-search (org data + phones)
      const hd = hdR.status === "fulfilled" ? hdR.value : null;
      if (hd?.data) {
        const org = hd.data.organization || {};
        const domainPeople = (hd.data.emails || []).filter((e: any) => e.phone_number);

        // ── Hunter domain-search person match: validate title/company ──
        const allDomainPeople = hd.data.emails || [];
        const personMatch = allDomainPeople.find((p: any) =>
          (p.first_name || "").toLowerCase() === lead.first_name.toLowerCase() &&
          (p.last_name || "").toLowerCase() === lead.last_name.toLowerCase()
        );
        if (personMatch) {
          // Use Hunter's structured position as the authoritative title
          if (personMatch.position) {
            const hunterPos = standardizeJobTitle(cleanJobTitle(personMatch.position));
            if (hunterPos) {
              if (!lead.title || lead.title.length < 3) {
                lead.title = hunterPos;
                console.log(`[LINKEDIN ENRICH] Hunter domain person title (backfill): "${hunterPos}"`);
              } else {
                const existing = lead.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
                const hunterNorm = hunterPos.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
                // Prefer Hunter if different and the current one looks like it could be company name
                const currentLooksLikeCompany = /\b(inc|llc|ltd|corp|co\.|company|group|agency|consulting|solutions|services|partners|ventures|technologies)\b/i.test(lead.title);
                if (currentLooksLikeCompany || (existing !== hunterNorm && !existing.includes(hunterNorm) && !hunterNorm.includes(existing))) {
                  console.log(`[LINKEDIN ENRICH] Hunter domain person title correction: "${lead.title}" → "${hunterPos}"`);
                  lead.title = hunterPos;
                }
              }
            }
          }
          // Validate seniority from Hunter
          if (personMatch.seniority && !lead.seniority) {
            lead.seniority = personMatch.seniority;
            console.log(`[LINKEDIN ENRICH] Hunter domain person seniority: "${personMatch.seniority}"`);
          }
          // Use Hunter's LinkedIn URL if we don't have one
          if (personMatch.linkedin && !lead.linkedin_url) {
            lead.linkedin_url = personMatch.linkedin;
          }
        }

        // Aggressively backfill organization data from Hunter domain-search
        if (org.industry && !lead.organization.industry) {
          lead.organization.industry = standardizeIndustryGlobal(org.industry);
          console.log(`[LINKEDIN ENRICH] Hunter backfill: industry=${org.industry} → ${lead.organization.industry}`);
        }
        if (org.headcount && !lead.organization.estimated_num_employees) {
          lead.organization.estimated_num_employees = org.headcount;
          console.log(`[LINKEDIN ENRICH] Hunter backfill: employees=${org.headcount}`);
        }
        if (org.annual_revenue && !lead.organization.annual_revenue_printed) {
          lead.organization.annual_revenue_printed = `$${org.annual_revenue}`;
        }
        
        // Backfill organization location
        if (org.city && !lead.organization.city) {
          lead.organization.city = org.city;
          console.log(`[LINKEDIN ENRICH] Hunter backfill: org.city=${org.city}`);
        }
        if (org.state && !lead.organization.state) {
          lead.organization.state = org.state;
          console.log(`[LINKEDIN ENRICH] Hunter backfill: org.state=${org.state}`);
        }
        if (org.country && !lead.organization.country) {
          lead.organization.country = org.country;
          console.log(`[LINKEDIN ENRICH] Hunter backfill: org.country=${org.country}`);
        }
        
        // Backfill person location from org if person location is missing
        if (org.city && !lead.city) {
          lead.city = org.city;
          console.log(`[LINKEDIN ENRICH] Hunter backfill: person.city=${org.city} (from org)`);
        }
        if (org.state && !lead.state) {
          lead.state = org.state;
          console.log(`[LINKEDIN ENRICH] Hunter backfill: person.state=${org.state} (from org)`);
        }
        if (org.country && !lead.country) {
          lead.country = org.country;
          console.log(`[LINKEDIN ENRICH] Hunter backfill: person.country=${org.country} (from org)`);
        }

        if (lead.phone_numbers.length === 0) {
          const pm = domainPeople.find((p: any) =>
            (p.first_name || "").toLowerCase() === lead.first_name.toLowerCase() &&
            (p.last_name || "").toLowerCase() === lead.last_name.toLowerCase()
          );
          if (pm?.phone_number) {
            lead.phone_numbers.push({ raw_number: pm.phone_number, type: "direct" });
            console.log(`[LINKEDIN ENRICH] Hunter domain: direct phone`);
          } else if (org.phone_number) {
            lead.phone_numbers.push({ raw_number: org.phone_number, type: "company" });
            console.log(`[LINKEDIN ENRICH] Hunter domain: company phone`);
          }
        }

        // Domain-search person email fallback
        if (!lead.email) {
          const em = (hd.data.emails || []).find((e: any) =>
            (e.first_name || "").toLowerCase() === lead.first_name.toLowerCase() &&
            (e.last_name || "").toLowerCase() === lead.last_name.toLowerCase() &&
            e.value
          );
          if (em) {
            lead.email = em.value;
            lead.email_status = em.confidence > 80 ? "verified" : "guessed";
            console.log(`[LINKEDIN ENRICH] Hunter domain email: ${lead.email}`);
          }
        }
      }

      console.log(`[LINKEDIN ENRICH] Phase C done (${Date.now() - t0}ms): email=${lead.email || "NONE"}, phone=${lead.phone_numbers[0]?.raw_number || "NONE"}`);
    } else {
      console.log(`[LINKEDIN ENRICH] Phase C skipped — no domain`);
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE D: Deep phone discovery — SKIPPED in Quick Add path.
    // Phone enrichment adds 10-15s and is not needed for the
    // AddLeadModal enrichment use case. Hunter/Findymail direct
    // phone from Phase C is sufficient.
    // ══════════════════════════════════════════════════════════════
    console.log(`[LINKEDIN ENRICH] Phase D skipped (Quick Add path — phone from Phase C only)`);

    // ══════════════════════════════════════════════════════════════
    // PHASE E: DISABLED — No pattern guessing
    // Fabricating emails from name+domain patterns causes bounces.
    // Only real emails from Hunter.io / Findymail are kept.
    // ══════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════
    // FINAL VALIDATION: Cross-check title/company aren't swapped
    // ══════════════════════════════════════════════════════════════
    const COMPANY_INDICATORS = /\b(inc|llc|ltd|corp|co\.|company|group|agency|consulting|solutions|services|partners|ventures|enterprises?|industries|technologies|labs?|studio|media|digital|global|international|associates|holdings|capital|financial|advisors?|management|systems|software|networks?|health|pharma|bio|logistics|properties|realty|motors|foods?|brands?|hospitality)\b/i;
    const TITLE_KEYWORDS = /\b(ceo|cto|cfo|coo|cmo|cro|cpo|cio|president|director|manager|head|vp|vice|senior|lead|engineer|developer|designer|analyst|specialist|consultant|advisor|founder|co-?founder|partner|owner|coordinator|architect|strategist|recruiter|officer|executive|principal|chief|chairman|board member|associate|assistant|intern|trainee)\b/i;

    // If title looks like a company name and company looks like a title → swap
    if (lead.title && lead.organization.name) {
      const titleIsCompany = COMPANY_INDICATORS.test(lead.title) && !TITLE_KEYWORDS.test(lead.title);
      const companyIsTitle = TITLE_KEYWORDS.test(lead.organization.name) && !COMPANY_INDICATORS.test(lead.organization.name);
      if (titleIsCompany && companyIsTitle) {
        console.log(`[LINKEDIN ENRICH] SWAP detected: title="${lead.title}" ↔ company="${lead.organization.name}"`);
        const temp = lead.title;
        lead.title = standardizeJobTitle(cleanJobTitle(lead.organization.name));
        lead.organization.name = toTitleCase(cleanCompanyName(temp));
      } else if (titleIsCompany && !lead.organization.name) {
        // Title is actually a company, move it
        console.log(`[LINKEDIN ENRICH] title→company: "${lead.title}"`);
        lead.organization.name = toTitleCase(cleanCompanyName(lead.title));
        lead.title = "";
      }
    }
    // If company looks like it has a title embedded (e.g. "CEO at Acme Corp"), extract
    if (lead.organization.name) {
      const companyAtMatch = lead.organization.name.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
      if (companyAtMatch) {
        const potentialTitle = companyAtMatch[1].trim();
        const potentialCompany = companyAtMatch[2].trim();
        if (TITLE_KEYWORDS.test(potentialTitle)) {
          if (!lead.title) lead.title = standardizeJobTitle(cleanJobTitle(potentialTitle));
          lead.organization.name = toTitleCase(cleanCompanyName(potentialCompany));
          console.log(`[LINKEDIN ENRICH] Extracted "at" from company: title="${lead.title}", company="${lead.organization.name}"`);
        }
      }
    }

    // Final location sanitization: reject garbage that slipped through
    const LOC_GARBAGE_FINAL = /^(services?|products?|analytics|solutions?|features?|pricing|demo|consulting|management|marketing|engineering|development|technology|design|human resources?|finance|operations?|sales|support|strategy|experience|education|about|summary|skills|connections?|see all|view|activity|posts|articles|full[- ]?time|part[- ]?time|contract|freelance|intern(?:ship)?|self[- ]?employed)$/i;
    if (LOC_GARBAGE_FINAL.test(lead.city.trim())) { lead.city = ""; console.log(`[LINKEDIN ENRICH] Rejected garbage city: "${lead.city}"`); }
    if (LOC_GARBAGE_FINAL.test(lead.state.trim())) { lead.state = ""; }
    if (LOC_GARBAGE_FINAL.test(lead.country.trim())) { lead.country = ""; }

    // ══════════════════════════════════════════════════════════════
    // Build response
    // ══════════════════════════════════════════════════════════════
    const enrichedData = {
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      email_status: lead.email_status,
      phone: lead.phone_numbers[0]?.raw_number || "",
      phone_type: lead.phone_numbers[0]?.type || "",
      title: lead.title,
      linkedin_url: lead.linkedin_url,
      city: toTitleCase(lead.city),
      state: toTitleCase(lead.state),
      country: toTitleCase(lead.country),
      seniority: lead.seniority,
      company_name: lead.organization.name,
      website: lead.organization.website_url,
      industry: lead.organization.industry,
      company_size: lead.organization.estimated_num_employees,
      company_linkedin: lead.organization.linkedin_url,
      company_description: lead.organization.short_description,
    };

    console.log(`[LINKEDIN ENRICH] DONE (${Date.now() - t0}ms): ${enrichedData.first_name} ${enrichedData.last_name} @ ${enrichedData.company_name || 'NO_COMPANY'} | email=${lead.email || "NONE"} | phone=${lead.phone_numbers[0]?.raw_number || "NONE"} | ${enrichedData.city || 'NO_CITY'}, ${enrichedData.state || 'NO_STATE'}, ${enrichedData.country || 'NO_COUNTRY'} | industry=${enrichedData.industry || 'NO_INDUSTRY'} | website=${websiteDomain || "NONE"}`);
    return c.json({ success: true, data: enrichedData });
  } catch (error: any) {
    console.error(`[LINKEDIN ENRICH] Error (${Date.now() - t0}ms):`, error.message);
    return c.json({ error: error.message || "Failed to enrich LinkedIn profile" }, 500);
  }
});

// ── POST /reveal-preview — Re-enrich preview leads that lacked email ──
// Accepts leads with name + company + title and re-attempts email discovery
// via Hunter.io → Findymail → Pattern Guessing pipeline.
app.post("/reveal-preview", async (c) => {
  try {
    const body = await c.req.json();
    const { leads } = body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return c.json({ error: "No leads provided" }, 400);
    }

    // Cap at 50 per request
    const batch = leads.slice(0, 50);
    console.log(`[DEEP PROSPECT REVEAL] Enriching ${batch.length} preview leads`);

    const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");
    const FINDYMAIL_API_KEY = Deno.env.get("FINDYMAIL_API_KEY");

    const enriched: any[] = [];
    let hunterFound = 0;
    let findymailFound = 0;
    let patternFound = 0;

    for (const lead of batch) {
      const firstName = (lead.first_name || "").trim();
      const lastName = (lead.last_name || "").trim();
      const companyName = (lead.organization?.name || "").trim();
      const websiteUrl = (lead.organization?.website_url || "").trim();
      const domain = websiteUrl
        ? websiteUrl.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*/, "")
        : "";

      if (!firstName || !lastName || !domain) {
        // Can't enrich without name + domain — pass through unchanged
        enriched.push({ ...lead, _reveal_failed: true });
        continue;
      }

      let foundEmail = "";
      let emailStatus = "";
      let foundPhone = "";

      // ── Stage 1: Hunter.io email-finder ──
      if (!foundEmail && HUNTER_API_KEY) {
        try {
          const url = `https://api.hunter.io/v2/email-finder?first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&domain=${encodeURIComponent(domain)}&api_key=${HUNTER_API_KEY}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (r.ok) {
            const d = await r.json();
            if (d.data?.email) {
              foundEmail = d.data.email;
              emailStatus = d.data.score > 80 ? "verified" : "guessed";
              if (d.data.phone_number) foundPhone = d.data.phone_number;
              hunterFound++;
              console.log(`[REVEAL] Hunter found email for ${firstName} ${lastName}: ${foundEmail}`);
            }
          }
        } catch (e: any) {
          console.warn(`[REVEAL] Hunter error for ${firstName} ${lastName}: ${e.message}`);
        }
      }

      // ── Stage 2: Findymail ──
      if (!foundEmail && FINDYMAIL_API_KEY) {
        try {
          const r = await fetch("https://app.findymail.com/api/search/name", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${FINDYMAIL_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              first_name: firstName,
              last_name: lastName,
              domain: domain,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (r.ok) {
            const d = await r.json();
            if (d.email) {
              foundEmail = d.email;
              emailStatus = "verified";
              findymailFound++;
              console.log(`[REVEAL] Findymail found email for ${firstName} ${lastName}: ${foundEmail}`);
            }
          }
        } catch (e: any) {
          console.warn(`[REVEAL] Findymail error for ${firstName} ${lastName}: ${e.message}`);
        }
      }

      // ── Stage 3: Pattern guessing ──
      if (!foundEmail && domain) {
        const patterns = [
          `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
          `${firstName[0].toLowerCase()}${lastName.toLowerCase()}@${domain}`,
          `${firstName.toLowerCase()}${lastName[0].toLowerCase()}@${domain}`,
          `${firstName.toLowerCase()}@${domain}`,
        ];
        // Try first pattern as best guess (most common format)
        foundEmail = patterns[0];
        emailStatus = "guessed";
        patternFound++;
      }

      // ── Verify found email ──
      if (foundEmail && emailStatus !== "verified") {
        try {
          const verifyResult = await verifyEmailBatch([{ id: lead.id, email: foundEmail }], 5);
          const [, verification] = verifyResult.entries().next().value || [];
          if (verification) {
            if (verification.result === "undeliverable" || verification.mx_found === false) {
              console.log(`[REVEAL] Email ${foundEmail} failed verification — dropping`);
              foundEmail = "";
              emailStatus = "";
            } else if (verification.result === "deliverable") {
              emailStatus = "verified";
            }
          }
        } catch {
          // Verification failed — keep guessed email
        }
      }

      const revealedLead = {
        ...lead,
        _preview: !foundEmail, // Keep as preview if no email found
        email: foundEmail || lead.email || "",
        email_status: emailStatus || lead.email_status || "",
      };

      if (foundPhone && (!lead.phone_numbers || lead.phone_numbers.length === 0)) {
        revealedLead.phone_numbers = [{ raw_number: foundPhone, type: "direct" }];
      }

      enriched.push(revealedLead);
    }

    const withEmail = enriched.filter((l: any) => l.email).length;
    console.log(`[DEEP PROSPECT REVEAL] Complete: ${enriched.length} leads processed, ${withEmail} with email (hunter=${hunterFound}, findymail=${findymailFound}, pattern=${patternFound})`);

    return c.json({
      success: true,
      people: enriched,
      stats: {
        total: enriched.length,
        with_email: withEmail,
        verified: enriched.filter((l: any) => l.email_status === "verified").length,
        sources: { hunter: hunterFound, findymail: findymailFound, pattern: patternFound },
      },
    });
  } catch (error: any) {
    console.error("[DEEP PROSPECT REVEAL] Error:", error.message, error.stack);
    return c.json({ error: error.message || "Failed to reveal preview leads" }, 500);
  }
});

export default app;