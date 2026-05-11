// ══════════════════════════════════════════════════════════════════════════
// Multi-Source Phone Enrichment Engine
// Discovers phone numbers (especially mobile/direct) from:
//   1. Company staff/team pages (website scraping)
//   2. Press releases & news mentions (SerpAPI)
//   3. WHOIS domain records
//   4. Public business records (state registries, OpenCorporates, etc.)
//   5. Telnyx Number Lookup for verification
//
// Explorium Contact Enrichment was previously source #5 but removed —
// the API was returning 401/403 on every call and burning ~25s per
// search waiting for timeouts on a service the account doesn't use.
// ══════════════════════════════════════════════════════════════════════════

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Phone number extraction & validation ────────────────────────────────

const PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

// Toll-free and known junk prefixes
const JUNK_PREFIXES = ['800', '888', '877', '866', '855', '844', '833', '900', '911', '411', '611', '511', '311', '211'];

function normalizePhone(raw: string): string {
  return raw.replace(/[^+\d]/g, '');
}

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  // Must be 10-15 digits
  if (digits.length < 10 || digits.length > 15) return false;
  
  // Get the 10-digit core (strip country code)
  const core = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (core.length === 10) {
    const areaCode = core.slice(0, 3);
    if (JUNK_PREFIXES.includes(areaCode)) return false;
    // Area code can't start with 0 or 1
    if (areaCode[0] === '0' || areaCode[0] === '1') return false;
  }
  
  // Reject obviously fake patterns
  if (/^(\d)\1{9,}$/.test(digits)) return false; // all same digit
  if (digits === '1234567890' || digits === '0987654321') return false;
  
  return true;
}

function classifyPhoneType(context: string): 'mobile' | 'direct' | 'work' | 'company' {
  const lower = (context || '').toLowerCase();
  if (/\b(mobile|cell|personal|direct\s*cell)\b/.test(lower)) return 'mobile';
  if (/\b(direct|personal\s*line|desk)\b/.test(lower)) return 'direct';
  if (/\b(fax|facsimile)\b/.test(lower)) return 'company'; // fax → treat as company fallback
  if (/\b(office|work|business|main|general|headquarters|hq)\b/.test(lower)) return 'work';
  return 'direct';
}

// ── Fax filter — skip fax numbers ──
function isFaxContext(context: string): boolean {
  return /\b(fax|facsimile|telefax)\b/i.test(context);
}

interface PhoneResult {
  number: string;
  type: 'mobile' | 'direct' | 'work' | 'company';
  source: string;
  confidence: number; // 0-100
}

// ── Extract phones from HTML with context awareness ──
function extractPhonesFromHtml(html: string, personName?: string): PhoneResult[] {
  // Strip scripts & styles
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');

  const phones: PhoneResult[] = [];
  const seen = new Set<string>();

  let match;
  const regex = new RegExp(PHONE_REGEX.source, 'g');
  while ((match = regex.exec(clean)) !== null) {
    const raw = match[0];
    if (!isValidPhone(raw)) continue;
    
    const normalized = normalizePhone(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Get surrounding context (100 chars each side)
    const start = Math.max(0, match.index - 100);
    const end = Math.min(clean.length, match.index + raw.length + 100);
    const context = clean.substring(start, end);

    // Skip fax numbers
    if (isFaxContext(context)) continue;

    const type = classifyPhoneType(context);
    
    // Higher confidence if person's name is near the phone number
    let confidence = 50;
    if (personName) {
      const nameParts = personName.toLowerCase().split(/\s+/);
      const contextLower = context.toLowerCase();
      if (nameParts.every(p => contextLower.includes(p))) {
        confidence = 90;
      } else if (nameParts.some(p => contextLower.includes(p))) {
        confidence = 70;
      }
    }
    
    // Mobile/direct type gets a boost
    if (type === 'mobile') confidence = Math.min(100, confidence + 15);
    if (type === 'direct') confidence = Math.min(100, confidence + 10);

    phones.push({ number: raw.trim(), type, source: 'website', confidence });
  }

  // Sort by confidence descending, then mobile > direct > work > company
  const typePriority: Record<string, number> = { mobile: 0, direct: 1, work: 2, company: 3 };
  phones.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (typePriority[a.type] || 99) - (typePriority[b.type] || 99);
  });

  return phones;
}

// ══════════════════════════════════════════════════════════════════════════
// SOURCE 1: Company Staff/Team Pages
// ══════════════════════════════════════════════════════════════════════════

interface LeadForPhone {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  organization_website: string;
  organization_name: string;
}

async function scrapeCompanyStaffPages(lead: LeadForPhone): Promise<PhoneResult[]> {
  if (!lead.organization_website) return [];
  
  let baseUrl = lead.organization_website.trim();
  if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
  // Remove trailing slash
  baseUrl = baseUrl.replace(/\/+$/, '');

  const pagePaths = [
    '/team', '/our-team', '/about', '/about-us', '/leadership',
    '/staff', '/people', '/management', '/meet-the-team', '/our-people',
    '/executives', '/board', '/who-we-are', '/contact', '/contact-us',
  ];

  const allPhones: PhoneResult[] = [];
  const personName = `${lead.first_name} ${lead.last_name}`;
  const MAX_PAGES = 6; // Don't overdo it
  let pagesChecked = 0;

  for (const path of pagePaths) {
    if (pagesChecked >= MAX_PAGES) break;
    
    try {
      const url = `${baseUrl}${path}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });
      clearTimeout(timeoutId);
      pagesChecked++;

      if (!response.ok) continue;
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) continue;

      const html = await response.text();
      if (html.length > 500000) continue; // Skip huge pages

      const phones = extractPhonesFromHtml(html, personName);
      for (const p of phones) {
        p.source = `website:${path}`;
        allPhones.push(p);
      }

      // If we found a high-confidence direct/mobile phone, stop early
      if (phones.some(p => p.confidence >= 80 && (p.type === 'mobile' || p.type === 'direct'))) {
        break;
      }
    } catch {
      continue;
    }
  }

  return allPhones;
}

// ══════════════════════════════════════════════════════════════════════════
// SOURCE 2: Press Releases & News Mentions
// ══════════════════════════════════════════════════════════════════════════

async function searchPressReleases(
  lead: LeadForPhone,
  serpApiKey: string
): Promise<PhoneResult[]> {
  if (!serpApiKey) return [];
  
  const query = `"${lead.first_name} ${lead.last_name}" "${lead.organization_name}" (phone OR contact OR mobile OR "can be reached") -site:linkedin.com -site:facebook.com -site:apollo.io`;
  
  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: serpApiKey,
      num: '10',
    });

    const response = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const results = data.organic_results || [];

    const phones: PhoneResult[] = [];
    const seen = new Set<string>();
    const personName = `${lead.first_name} ${lead.last_name}`;

    for (const result of results) {
      const snippet = result.snippet || '';
      const title = result.title || '';
      const combined = `${title} ${snippet}`;

      // Extract phones from snippet
      let match;
      const regex = new RegExp(PHONE_REGEX.source, 'g');
      while ((match = regex.exec(combined)) !== null) {
        const raw = match[0];
        if (!isValidPhone(raw)) continue;
        
        const normalized = normalizePhone(raw);
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        if (isFaxContext(combined)) continue;

        const type = classifyPhoneType(combined);
        
        // Press releases that mention both name and phone → high confidence
        const mentionsName = personName.toLowerCase().split(/\s+/).some(
          p => combined.toLowerCase().includes(p)
        );
        const confidence = mentionsName ? 75 : 45;

        phones.push({ number: raw.trim(), type, source: `press:${result.link || 'search'}`, confidence });
      }

      // Also try to fetch and scrape the actual press release page
      if (phones.length === 0 && result.link) {
        try {
          const pageResponse = await fetch(result.link, {
            signal: AbortSignal.timeout(6000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            redirect: 'follow',
          });
          
          if (pageResponse.ok) {
            const ct = pageResponse.headers.get('content-type') || '';
            if (ct.includes('text/html')) {
              const html = await pageResponse.text();
              if (html.length < 300000) {
                const pagePhones = extractPhonesFromHtml(html, personName);
                for (const p of pagePhones) {
                  p.source = `press:${result.link}`;
                  p.confidence = Math.min(p.confidence, 70); // Cap press page confidence
                  phones.push(p);
                }
              }
            }
          }
        } catch {
          // Non-fatal
        }
      }

      if (phones.length >= 3) break; // Enough candidates
    }

    return phones;
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SOURCE 3: WHOIS Domain Records
// ══════════════════════════════════════════════════════════════════════════

async function lookupWhoisPhone(domain: string): Promise<PhoneResult[]> {
  if (!domain) return [];
  
  // Clean domain
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '').trim();
  if (!cleanDomain) return [];

  const phones: PhoneResult[] = [];

  // Try multiple free WHOIS APIs
  const whoisApis = [
    `https://rdap.org/domain/${cleanDomain}`,
    `https://rdap.verisign.com/com/v1/domain/${cleanDomain}`,
  ];

  for (const apiUrl of whoisApis) {
    try {
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(6000),
        headers: { 'Accept': 'application/rdap+json,application/json' },
      });

      if (!response.ok) continue;
      const data = await response.json();
      
      // RDAP format: entities → vcardArray → tel values
      const entities = data.entities || [];
      for (const entity of entities) {
        // Look for registrant or admin contact
        const roles = entity.roles || [];
        const isOwner = roles.some((r: string) => 
          ['registrant', 'administrative', 'technical'].includes(r.toLowerCase())
        );
        
        if (!isOwner) continue;
        
        const vcardArray = entity.vcardArray?.[1] || [];
        for (const field of vcardArray) {
          if (Array.isArray(field) && field[0] === 'tel') {
            const raw = String(field[3] || '').replace(/^tel:/, '');
            if (raw && isValidPhone(raw)) {
              const typeHint = JSON.stringify(field[1] || {}).toLowerCase();
              const type = classifyPhoneType(typeHint);
              phones.push({
                number: raw.trim(),
                type: type === 'work' ? 'company' : type,
                source: `whois:${cleanDomain}`,
                confidence: roles.includes('registrant') ? 65 : 50,
              });
            }
          }
        }

        // Also check nested entities
        const subEntities = entity.entities || [];
        for (const sub of subEntities) {
          const subVcard = sub.vcardArray?.[1] || [];
          for (const field of subVcard) {
            if (Array.isArray(field) && field[0] === 'tel') {
              const raw = String(field[3] || '').replace(/^tel:/, '');
              if (raw && isValidPhone(raw)) {
                phones.push({
                  number: raw.trim(),
                  type: 'company',
                  source: `whois:${cleanDomain}`,
                  confidence: 45,
                });
              }
            }
          }
        }
      }

      if (phones.length > 0) break; // Got results, stop trying APIs
    } catch {
      continue;
    }
  }

  return phones;
}

// ══════════════════════════════════════════════════════════════════════════
// SOURCE 4: Public Business Records
// ══════════════════════════════════════════════════════��═══════════════════

async function searchPublicRecords(
  lead: LeadForPhone,
  serpApiKey: string
): Promise<PhoneResult[]> {
  if (!serpApiKey || !lead.organization_name) return [];

  // Search public business registries for phone numbers
  const recordsSites = [
    'opencorporates.com', 'bizapedia.com', 'corporationwiki.com',
    'sec.gov', 'bbb.org', 'dandb.com', 'dnb.com',
    'manta.com', 'chamberofcommerce.com',
  ];

  const siteFilter = recordsSites.map(s => `site:${s}`).join(' OR ');
  const ownerPart = lead.name ? `"${lead.name}"` : '';
  const query = `"${lead.organization_name}" ${ownerPart} (phone OR telephone OR contact) (${siteFilter})`;

  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: serpApiKey,
      num: '8',
    });

    const response = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const results = data.organic_results || [];

    const phones: PhoneResult[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      const snippet = result.snippet || '';
      const link = result.link || '';

      let match;
      const regex = new RegExp(PHONE_REGEX.source, 'g');
      while ((match = regex.exec(snippet)) !== null) {
        const raw = match[0];
        if (!isValidPhone(raw)) continue;
        
        const normalized = normalizePhone(raw);
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        if (isFaxContext(snippet)) continue;

        phones.push({
          number: raw.trim(),
          type: 'company',
          source: `public_records:${link}`,
          confidence: 55,
        });
      }

      // For the top 2 results, try to scrape the actual page
      if (results.indexOf(result) < 2 && result.link) {
        try {
          const pageRes = await fetch(result.link, {
            signal: AbortSignal.timeout(6000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            redirect: 'follow',
          });
          
          if (pageRes.ok) {
            const ct = pageRes.headers.get('content-type') || '';
            if (ct.includes('text/html')) {
              const html = await pageRes.text();
              if (html.length < 300000) {
                const pagePhones = extractPhonesFromHtml(html, lead.name);
                for (const p of pagePhones) {
                  if (seen.has(normalizePhone(p.number))) continue;
                  seen.add(normalizePhone(p.number));
                  p.source = `public_records:${result.link}`;
                  p.confidence = Math.min(p.confidence, 60);
                  phones.push(p);
                }
              }
            }
          }
        } catch {
          // Non-fatal
        }
      }

      if (phones.length >= 3) break;
    }

    return phones;
  } catch {
    return [];
  }
}


// ══════════════════════════════════════════════════════════════════════════
// PHONE VERIFICATION: Telnyx Number Lookup
// Validates discovered phone numbers and identifies carrier + line type
// (mobile vs landline vs VoIP). Drops invalid numbers and upgrades
// confidence for confirmed mobile lines.
// ══════════════════════════════════════════════════════════════════════════

interface TelnyxLookupResult {
  valid: boolean;
  lineType: 'mobile' | 'landline' | 'voip' | 'toll_free' | 'unknown';
  carrier: string;
  e164: string;
}

function formatE164(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  return '+' + digits;
}

async function telnyxLookup(
  phoneNumber: string,
  telnyxApiKey: string
): Promise<TelnyxLookupResult> {
  const e164 = formatE164(phoneNumber);

  const response = await fetch(
    `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}`,
    {
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 422) {
      return { valid: false, lineType: 'unknown', carrier: '', e164 };
    }
    throw new Error(`Telnyx lookup returned ${response.status}`);
  }

  const data = await response.json();
  const result = data.data || data;

  const carrierInfo = result?.carrier || result?.portability || {};

  const typeStr = (
    carrierInfo?.type || carrierInfo?.line_type ||
    result?.type || result?.phone_number_type || ''
  ).toLowerCase();

  let lineType: TelnyxLookupResult['lineType'] = 'unknown';
  if (typeStr.includes('mobile') || typeStr.includes('wireless') || typeStr.includes('cell')) {
    lineType = 'mobile';
  } else if (typeStr.includes('landline') || typeStr.includes('fixed')) {
    lineType = 'landline';
  } else if (typeStr.includes('voip') || typeStr.includes('virtual') || typeStr.includes('non-fixed')) {
    lineType = 'voip';
  } else if (typeStr.includes('toll') || typeStr.includes('free')) {
    lineType = 'toll_free';
  }

  const carrier = carrierInfo?.name || carrierInfo?.carrier_name || '';
  const valid = !!(result?.phone_number || result?.national_format) && lineType !== 'toll_free';

  return { valid, lineType, carrier, e164: result?.phone_number || e164 };
}

export async function verifyPhoneNumbers(
  leads: DeepPhoneLead[],
  telnyxApiKey: string,
  options?: {
    onProgress?: (done: number, total: number) => void;
    isCancelled?: () => boolean;
  }
): Promise<{ verified: number; dropped: number; mobileConfirmed: number }> {
  const leadsWithPhone = leads.filter(l => l.phone_numbers.length > 0);
  if (!telnyxApiKey || leadsWithPhone.length === 0) {
    return { verified: 0, dropped: 0, mobileConfirmed: 0 };
  }

  let verified = 0;
  let dropped = 0;
  let mobileConfirmed = 0;
  const BATCH_SIZE = 5;
  const cancelled = options?.isCancelled || (() => false);

  for (let i = 0; i < leadsWithPhone.length; i += BATCH_SIZE) {
    if (cancelled()) break;

    const batch = leadsWithPhone.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (lead) => {
        const results: { idx: number; lookup: TelnyxLookupResult }[] = [];
        for (let idx = 0; idx < lead.phone_numbers.length; idx++) {
          const phone = lead.phone_numbers[idx];
          try {
            const lookup = await telnyxLookup(phone.raw_number, telnyxApiKey);
            results.push({ idx, lookup });
          } catch (err: any) {
            console.warn(`[PHONE VERIFY] Telnyx lookup failed for ${phone.raw_number}: ${err.message}`);
          }
        }
        return { leadId: lead.id, results };
      })
    );

    for (const r of batchResults) {
      if (r.status !== 'fulfilled') continue;
      const { leadId, results } = r.value;
      const lead = leadsWithPhone.find(l => l.id === leadId);
      if (!lead) continue;

      const toRemove: number[] = [];
      for (const { idx, lookup } of results) {
        if (!lookup.valid) {
          toRemove.push(idx);
          continue;
        }

        verified++;
        const phone = lead.phone_numbers[idx];

        // Upgrade type if Telnyx confirms mobile
        if (lookup.lineType === 'mobile' && phone.type !== 'mobile') {
          phone.type = 'mobile';
          mobileConfirmed++;
        } else if (lookup.lineType === 'mobile') {
          mobileConfirmed++;
        }

        // Normalize to E.164 format
        if (lookup.e164 && lookup.e164.startsWith('+')) {
          phone.raw_number = lookup.e164;
        }
      }

      // Remove invalid numbers (reverse order to preserve indices)
      for (const idx of toRemove.sort((a, b) => b - a)) {
        lead.phone_numbers.splice(idx, 1);
        dropped++;
      }
    }

    options?.onProgress?.(Math.min(i + BATCH_SIZE, leadsWithPhone.length), leadsWithPhone.length);

    if (i + BATCH_SIZE < leadsWithPhone.length) {
      await sleep(400);
    }
  }

  console.log(`[PHONE VERIFY] Telnyx verification: ${verified} valid, ${dropped} dropped, ${mobileConfirmed} confirmed mobile`);
  return { verified, dropped, mobileConfirmed };
}

// ══════════════════════════════════════════════════════════════════════════
// Main Enrichment Function — Orchestrates all sources
// ══════════════════════════════════════════════════════════════════════════

interface DeepPhoneResult {
  leadId: string;
  phones: PhoneResult[];
  bestPhone: PhoneResult | null;
}

export interface DeepPhoneLead {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  phone_numbers: { raw_number: string; type: string }[];
  organization: {
    name: string;
    website_url: string;
    phone: string;
  };
}

export async function enrichPhoneNumbers(
  leads: DeepPhoneLead[],
  serpApiKey: string,
  options?: {
    onProgress?: (done: number, total: number) => void;
    isCancelled?: () => boolean;
    skipSerpSources?: boolean; // Skip press releases & public records to conserve API credits
  }
): Promise<{ enriched: number; sources: Record<string, number> }> {
  const leadsNoPhone = leads.filter(l => l.phone_numbers.length === 0);
  if (leadsNoPhone.length === 0) return { enriched: 0, sources: {} };

  const sourceCounts: Record<string, number> = {
    website: 0,
    press: 0,
    whois: 0,
    public_records: 0,
  };
  let enriched = 0;
  const BATCH_SIZE = 10;
  const cancelled = options?.isCancelled || (() => false);

  for (let i = 0; i < leadsNoPhone.length; i += BATCH_SIZE) {
    if (cancelled()) break;
    
    const batch = leadsNoPhone.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (lead): Promise<DeepPhoneResult> => {
        const allPhones: PhoneResult[] = [];
        const leadInput: LeadForPhone = {
          id: lead.id,
          first_name: lead.first_name,
          last_name: lead.last_name,
          name: lead.name,
          title: lead.title,
          organization_website: lead.organization.website_url,
          organization_name: lead.organization.name,
        };

        // Source 1: Company staff pages (always try — free, no API cost)
        try {
          const websitePhones = await scrapeCompanyStaffPages(leadInput);
          allPhones.push(...websitePhones);
        } catch (e) {
          console.warn(`[PHONE ENRICH] Website scrape error for ${lead.name}:`, e);
        }

        // Source 2: WHOIS (always try — free RDAP API)
        if (allPhones.filter(p => p.type === 'mobile' || p.type === 'direct').length === 0) {
          try {
            const domain = (lead.organization.website_url || '').replace(/^https?:\/\//, '').replace(/\/.*/, '');
            const whoisPhones = await lookupWhoisPhone(domain);
            allPhones.push(...whoisPhones);
          } catch (e) {
            console.warn(`[PHONE ENRICH] WHOIS error for ${lead.name}:`, e);
          }
        }

        // Source 3: Press releases (uses SerpAPI — only if no good phone yet)
        if (!options?.skipSerpSources && serpApiKey &&
            allPhones.filter(p => p.confidence >= 70).length === 0) {
          try {
            const pressPhones = await searchPressReleases(leadInput, serpApiKey);
            allPhones.push(...pressPhones);
          } catch (e) {
            console.warn(`[PHONE ENRICH] Press search error for ${lead.name}:`, e);
          }
        }

        // Source 4: Public records (uses SerpAPI — only if still no phone)
        if (!options?.skipSerpSources && serpApiKey && allPhones.length === 0) {
          try {
            const recordsPhones = await searchPublicRecords(leadInput, serpApiKey);
            allPhones.push(...recordsPhones);
          } catch (e) {
            console.warn(`[PHONE ENRICH] Public records error for ${lead.name}:`, e);
          }
        }

        // Deduplicate & sort
        const seenNorm = new Set<string>();
        const uniquePhones = allPhones.filter(p => {
          const norm = normalizePhone(p.number);
          if (seenNorm.has(norm)) return false;
          seenNorm.add(norm);
          return true;
        });

        const typePriority: Record<string, number> = { mobile: 0, direct: 1, work: 2, company: 3 };
        uniquePhones.sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return (typePriority[a.type] || 99) - (typePriority[b.type] || 99);
        });

        return {
          leadId: lead.id,
          phones: uniquePhones,
          bestPhone: uniquePhones[0] || null,
        };
      })
    );

    // Apply results
    for (const r of batchResults) {
      if (r.status !== 'fulfilled' || !r.value.bestPhone) continue;
      
      const result = r.value;
      const lead = leadsNoPhone.find(l => l.id === result.leadId);
      if (!lead || lead.phone_numbers.length > 0) continue;

      // Add best phone (and secondary if high confidence)
      const best = result.bestPhone;
      lead.phone_numbers.push({ raw_number: best.number, type: best.type });
      enriched++;

      // Track source
      const sourceKey = best.source.split(':')[0];
      if (sourceKey in sourceCounts) {
        sourceCounts[sourceKey]++;
      }

      // If we also found a mobile and best was company/work, add the mobile too
      if ((best.type === 'company' || best.type === 'work') && result.phones.length > 1) {
        const mobileFallback = result.phones.find(
          p => (p.type === 'mobile' || p.type === 'direct') && 
               normalizePhone(p.number) !== normalizePhone(best.number) &&
               p.confidence >= 50
        );
        if (mobileFallback) {
          lead.phone_numbers.push({ raw_number: mobileFallback.number, type: mobileFallback.type });
        }
      }

      // Also set org phone if we found a company-type number and org has none
      if (!lead.organization.phone) {
        const companyPhone = result.phones.find(p => p.type === 'company' || p.type === 'work');
        if (companyPhone) {
          lead.organization.phone = companyPhone.number;
        }
      }
    }

    options?.onProgress?.(Math.min(i + BATCH_SIZE, leadsNoPhone.length), leadsNoPhone.length);

    // Rate limit between batches
    if (i + BATCH_SIZE < leadsNoPhone.length) {
      await sleep(500);
    }
  }

  console.log(`[PHONE ENRICH] Complete: ${enriched} phones found from ${leadsNoPhone.length} leads`);
  console.log(`[PHONE ENRICH] Sources: website=${sourceCounts.website}, press=${sourceCounts.press}, whois=${sourceCounts.whois}, public_records=${sourceCounts.public_records}`);

  return { enriched, sources: sourceCounts };
}