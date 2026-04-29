import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Building2 } from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';

// Proxy URL — routes favicon requests through our edge function to avoid
// Cross-Origin-Resource-Policy blocks from t2.gstatic.com in Safari/WebKit.
const FAVICON_PROXY = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/favicon-proxy`;

/**
 * Multi-tier company logo component with smart fallback chain + quality gate.
 *
 * Fallback chain (5 tiers) — ALL domain-verified:
 *   1. brand_logo_url  — Brandfetch / server-enriched (SVG or high-res PNG, domain-validated)
 *   2. Clearbit Logo   — https://logo.clearbit.com/{domain} (128px PNG, free, domain-only)
 *   3. LinkedIn image   — media.licdn.com company image (if linkedinUrl provided)
 *   4. Google Favicon   — sz=128, ONLY if naturalWidth ≥ 64px (quality gate)
 *   5. Building icon    — clean Building2 icon fallback
 *
 * v3.4.0: Domain guessing from LinkedIn slugs and company names has been REMOVED.
 * If no verified company domain is provided, the component shows the Building2
 * placeholder icon instead of attempting to derive a domain and risk showing
 * a logo for the wrong company.
 *
 * Quality gate: Any logo that loads at <64×64 natural pixels is rejected and
 * the component advances to the icon fallback. Favicons that fail are cached in a
 * module-level Set + localStorage so repeat renders skip them instantly.
 *
 * Display: always 32x32 with object-fit:contain (configurable via size prop).
 * Logos are lazy-loaded and cached in localStorage to avoid repeated lookups.
 *
 * Dark-mode handling:
 *   Background CORS probe detects brightness. Dark logos get
 *   `mix-blend-mode: lighten` with a zinc-700 container bg.
 */

interface CompanyLogoProps {
  /** Company domain (e.g. "apple.com") or full website URL */
  domain?: string | null;
  /** Pre-resolved brand logo URL from server enrichment / Brandfetch */
  brandLogoUrl?: string | null;
  /** Source of the brand logo (brandfetch, clearbit, serpapi_logo, favicon) */
  brandLogoSource?: string | null;
  /** LinkedIn company URL — used for LinkedIn image tier (no longer used for domain derivation) */
  linkedinUrl?: string | null;
  /** Company name — kept for future use (no longer used for domain guessing as of v3.4.0) */
  companyName?: string | null;
  /** Size in px (width & height of the outer container). Default 32. */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Show plain img without container (for inline use) */
  inline?: boolean;
}

// Domains that are social/directory sites — NOT the actual company domain.
// When these appear as the "website" for a lead, skip them so we don't
// render a LinkedIn/Facebook logo as the company logo.
const SOCIAL_DOMAINS = new Set([
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'tiktok.com', 'youtube.com', 'github.com',
  'crunchbase.com', 'bloomberg.com', 'yelp.com', 'bbb.org',
  'glassdoor.com', 'indeed.com', 'angel.co', 'wellfound.com',
  'pitchbook.com', 'owler.com', 'zoominfo.com',
]);

function cleanDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase()
    .trim();
}

/** Clean domain and reject social/directory sites */
function cleanCompanyDomain(raw: string): string {
  const d = cleanDomain(raw);
  if (SOCIAL_DOMAINS.has(d)) return '';
  return d;
}

// NOTE: linkedinSlugToDomain and nameToDomain were REMOVED in v3.4.0.
// Guessing domains from LinkedIn slugs or company names caused wrong
// Clearbit/favicon logos to be displayed for the wrong company.
// The component now requires a verified domain — if none is available,
// it shows the placeholder icon instead of a random wrong logo.

/**
 * Check if a URL is a Google Favicon URL — these can return the generic globe
 * and CORS probing can't detect it, so we treat them specially.
 */
function isGoogleFaviconUrl(url: string): boolean {
  return url.includes('google.com/s2/favicons') || url.includes('icons.duckduckgo.com') || url.includes('gstatic.com/faviconV2') || url.includes('favicon-proxy');
}

function isClearbitUrl(url: string): boolean {
  return url.includes('logo.clearbit.com');
}

// ── Logo URL cache (localStorage) ───────────────────────────────────
// Caches resolved logo URLs by domain so repeat renders don't re-probe.
const LOGO_CACHE_KEY = 'contndr:logo-cache-v5'; // bumped: v4 had DuckDuckGo URLs (blocked CORS)
// Flush stale v0–v4 caches
try { localStorage.removeItem('contndr:logo-cache'); } catch { /* ok */ }
try { localStorage.removeItem('contndr:logo-cache-v1'); } catch { /* ok */ }
try { localStorage.removeItem('contndr:logo-cache-v2'); } catch { /* ok */ }
try { localStorage.removeItem('contndr:logo-cache-v3'); } catch { /* ok */ }
try { localStorage.removeItem('contndr:logo-cache-v4'); } catch { /* ok */ }
const LOGO_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
type LogoCacheEntry = { url: string; source: string; ts: number };
let _logoCacheMap: Map<string, LogoCacheEntry> | null = null;

function getLogoCache(): Map<string, LogoCacheEntry> {
  if (_logoCacheMap) return _logoCacheMap;
  try {
    const raw = localStorage.getItem(LOGO_CACHE_KEY);
    if (raw) {
      const parsed: Record<string, LogoCacheEntry> = JSON.parse(raw);
      _logoCacheMap = new Map(Object.entries(parsed));
      // Prune stale entries
      const now = Date.now();
      for (const [k, v] of _logoCacheMap) {
        if (now - v.ts > LOGO_CACHE_MAX_AGE) _logoCacheMap.delete(k);
      }
    } else {
      _logoCacheMap = new Map();
    }
  } catch {
    _logoCacheMap = new Map();
  }
  return _logoCacheMap;
}

function setCachedLogo(domain: string, url: string, source: string) {
  const cache = getLogoCache();
  cache.set(domain, { url, source, ts: Date.now() });
  // Persist (debounced via microtask to avoid excessive writes)
  queueMicrotask(() => {
    try {
      const obj: Record<string, LogoCacheEntry> = {};
      for (const [k, v] of cache) obj[k] = v;
      localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(obj));
    } catch { /* quota exceeded */ }
  });
}

function getCachedLogo(domain: string): LogoCacheEntry | null {
  if (!domain) return null;
  const cache = getLogoCache();
  const entry = cache.get(domain);
  if (!entry) return null;
  if (Date.now() - entry.ts > LOGO_CACHE_MAX_AGE) {
    cache.delete(domain);
    return null;
  }
  return entry;
}

// ── Module-level probe cache ───────────────────────────────────────
type ProbeResult = 'light' | 'dark' | 'empty' | 'generic';
const probeCache = new Map<string, ProbeResult>();
const probesInFlight = new Set<string>();

/**
 * Background CORS probe: load URL with crossOrigin, sample brightness & colour.
 */
function probeImageBrightness(
  url: string,
  cacheKey: string,
  isFaviconTier: boolean,
  onResult: (result: ProbeResult) => void,
) {
  if (probeCache.has(cacheKey)) {
    onResult(probeCache.get(cacheKey)!);
    return;
  }
  if (probesInFlight.has(cacheKey)) return;
  probesInFlight.add(cacheKey);

  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    probesInFlight.delete(cacheKey);
    try {
      const canvas = document.createElement('canvas');
      const S = 32;
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(probe, 0, 0, S, S);
      const { data } = ctx.getImageData(0, 0, S, S);
      const totalPixels = S * S;
      let totalBrightness = 0;
      let opaquePixels = 0;
      let totalSaturation = 0;
      const colourBuckets = new Set<number>();

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 30) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        totalBrightness += 0.299 * r + 0.587 * g + 0.114 * b;
        opaquePixels++;

        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 510;
        const sat = max === min ? 0 : (max - min) / (l > 0.5 ? (510 - max - min) : (max + min));
        totalSaturation += sat;

        colourBuckets.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      }

      let result: ProbeResult;
      if (opaquePixels < totalPixels * 0.10) {
        result = 'empty';
      } else if (isFaviconTier) {
        const avgSat = totalSaturation / opaquePixels;
        const avgBright = totalBrightness / opaquePixels;
        const opaqueRatio = opaquePixels / totalPixels;
        const isGeneric =
          colourBuckets.size < 25 &&
          avgSat < 0.15 &&
          opaqueRatio < 0.65 &&
          avgBright > 80 && avgBright < 200;
        if (isGeneric) {
          result = 'generic';
        } else if (avgBright < 60) {
          result = 'dark';
        } else {
          result = 'light';
        }
      } else if ((totalBrightness / opaquePixels) < 60) {
        result = 'dark';
      } else {
        result = 'light';
      }
      probeCache.set(cacheKey, result);
      onResult(result);
    } catch {
      probeCache.set(cacheKey, 'light');
    }
  };
  probe.onerror = () => {
    probesInFlight.delete(cacheKey);
    // CORS fails for Google favicons — cache as 'light' so the image still shows
    probeCache.set(cacheKey, 'light');
  };
  probe.src = url;
}

type Tier = 'brand' | 'clearbit' | 'linkedin' | 'favicon' | 'icon';

/** Minimum natural pixel dimension to accept a logo image (quality gate) */
const MIN_LOGO_PX = 64;

/** Module-level cache: domains whose favicons failed the quality gate */
const _faviconQualityFailed = new Set<string>();

export function CompanyLogo({
  domain: rawDomain,
  brandLogoUrl,
  brandLogoSource,
  linkedinUrl,
  companyName,
  size = 32,
  className = '',
  inline = false,
}: CompanyLogoProps) {
  const domain = useMemo(() => (rawDomain ? cleanCompanyDomain(rawDomain) : ''), [rawDomain]);

  // Domain-only resolution: NO guessing from LinkedIn slugs or company names.
  // If no verified domain is available, show the placeholder icon.
  const faviconDomain = domain;

  // LinkedIn company image URL — extract from LinkedIn URL if present
  const linkedinImageUrl = useMemo(() => {
    if (!linkedinUrl) return '';
    if (brandLogoUrl && brandLogoSource === 'serpapi_logo') return '';
    return ''; // LinkedIn doesn't expose direct image URLs; this tier is populated via cached lookups
  }, [linkedinUrl, brandLogoUrl, brandLogoSource]);

  // Clearbit Logo URL — free, no API key, returns 404 if not found
  const clearbitUrl = useMemo(() => {
    if (!faviconDomain) return '';
    return `https://logo.clearbit.com/${faviconDomain}?size=128&format=png`;
  }, [faviconDomain]);

  // Check localStorage cache for a previously resolved logo
  const cachedLogo = useMemo(() => getCachedLogo(faviconDomain), [faviconDomain]);

  // If server already told us this is a favicon source with no quality or low quality, skip directly to initials
  const serverSaysFaviconOnly = brandLogoSource === 'favicon' && brandLogoUrl && isGoogleFaviconUrl(brandLogoUrl);
  // If we previously quality-gate failed this domain's favicon, skip favicon tier
  const faviconAlreadyFailed = faviconDomain ? _faviconQualityFailed.has(faviconDomain) : false;

  // Determine the starting tier
  const startTier = useMemo<Tier>(() => {
    // If we have a cached high-quality logo from a prior visit, use it via brand tier
    if (cachedLogo && cachedLogo.source !== 'favicon' && cachedLogo.source !== 'icon') return 'brand';
    // If cache explicitly says initials, go straight there
    if (cachedLogo && cachedLogo.source === 'icon') return 'icon';
    // Server-enriched brand logo (Brandfetch, Clearbit, SerpAPI) — NOT favicon
    if (brandLogoUrl && !isGoogleFaviconUrl(brandLogoUrl) && !isClearbitUrl(brandLogoUrl)) return 'brand';
    // If server returned a clearbit logo, start at brand tier (it's high quality)
    if (brandLogoUrl && isClearbitUrl(brandLogoUrl)) return 'brand';
    // If server returned favicon source and we already know it's low quality, go to initials
    if (serverSaysFaviconOnly && faviconAlreadyFailed) return 'icon';
    // Try Clearbit as first fallback when we have a domain
    if (faviconDomain && clearbitUrl) return 'clearbit';
    // Google Favicon — only if not already failed quality gate
    if (faviconDomain && !faviconAlreadyFailed) return 'favicon';
    return 'icon';
  }, [brandLogoUrl, brandLogoSource, faviconDomain, clearbitUrl, cachedLogo, serverSaysFaviconOnly, faviconAlreadyFailed]);

  const [tier, setTier] = useState<Tier>(startTier);
  const [isDarkLogo, setIsDarkLogo] = useState(() => {
    // Seed from probe cache immediately so dark-mode treatment applies on first paint
    const pk = brandLogoUrl || (cachedLogo?.url) || faviconDomain;
    if (pk && probeCache.has(pk)) return probeCache.get(pk) === 'dark';
    return false;
  });
  // v3.5.2: If the in-memory caches already have this domain's logo URL AND probe
  // result, the browser definitely has the image in its HTTP cache (the row header
  // already loaded it). Initialize imgLoaded=true so we skip the placeholder flash
  // entirely and render the logo at full opacity on first paint.
  const [imgLoaded, setImgLoaded] = useState(() => {
    if (cachedLogo && cachedLogo.url && cachedLogo.source !== 'icon') {
      const probeCacheKey = cachedLogo.url || faviconDomain;
      if (probeCache.has(probeCacheKey) || probeCache.has(faviconDomain)) {
        return true;
      }
    }
    if (brandLogoUrl) {
      const probeCacheKey = brandLogoUrl;
      if (probeCache.has(probeCacheKey)) {
        return true;
      }
    }
    return false;
  });
  const mountedRef = useRef(true);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Track the identity (domain + brand URL) so we can detect when the component
  // is being reused for a DIFFERENT company — even if startTier stays the same.
  const prevIdentityRef = useRef(`${faviconDomain}|${brandLogoUrl || ''}`);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // v3.5.2: Reset ALL state whenever the company identity changes (domain or brand URL)
  // Previously this only fired on [startTier], so if two consecutive companies resolved
  // to the same startTier (e.g. both 'brand' from cache), imgLoaded/tier/isDarkLogo
  // would persist from the old company — causing the wrong logo to flash on refresh.
  useEffect(() => {
    const identity = `${faviconDomain}|${brandLogoUrl || ''}`;
    if (identity !== prevIdentityRef.current) {
      prevIdentityRef.current = identity;
      setTier(startTier);
      setIsDarkLogo(false);
      // When identity changes, check if the NEW company's image is already in cache
      const newCached = getCachedLogo(faviconDomain);
      if (newCached && newCached.url && newCached.source !== 'icon') {
        const pk = newCached.url || faviconDomain;
        if (probeCache.has(pk) || probeCache.has(faviconDomain)) {
          setImgLoaded(true);
          const pr = probeCache.get(pk) || probeCache.get(faviconDomain);
          if (pr) setIsDarkLogo(pr === 'dark');
          return;
        }
      }
      setImgLoaded(false);
    }
  }, [faviconDomain, brandLogoUrl, startTier]);

  // Also sync tier whenever startTier itself changes (e.g. enrichment adds a brand URL)
  // Skip the initial mount — the useState initializers already set the correct values.
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setTier(startTier);
    setIsDarkLogo(false);
    setImgLoaded(false);
  }, [startTier]);

  const cacheKey = brandLogoUrl || faviconDomain;

  // Seed darkness from cache
  useEffect(() => {
    if (cacheKey && probeCache.has(cacheKey)) {
      const r = probeCache.get(cacheKey)!;
      setIsDarkLogo(r === 'dark');
      if (r === 'empty' || r === 'generic') {
        advanceTier();
      }
    }
  }, [cacheKey]);

  // Favicon URL — proxied through our edge function to avoid Cross-Origin-Resource-Policy
  // blocks from t2.gstatic.com that Safari/WebKit enforces on <img> loads.
  const faviconUrl = faviconDomain
    ? `${FAVICON_PROXY}?url=${encodeURIComponent(`https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${faviconDomain}&size=64`)}`
    : '';

  // Advance to next usable tier
  const advanceTier = useCallback(() => {
    if (!mountedRef.current) return;
    setTier((prev) => {
      const order: Tier[] = ['brand', 'clearbit', 'linkedin', 'favicon', 'icon'];
      const idx = order.indexOf(prev);
      for (let i = idx + 1; i < order.length; i++) {
        const next = order[i];
        if (next === 'clearbit' && !clearbitUrl) continue;
        if (next === 'linkedin' && !linkedinImageUrl) continue;
        if (next === 'favicon' && (!faviconDomain || faviconAlreadyFailed)) continue;
        return next;
      }
      return 'icon';
    });
  }, [faviconDomain, clearbitUrl, linkedinImageUrl, faviconAlreadyFailed]);

  const handleError = useCallback(() => { setImgLoaded(false); advanceTier(); }, [advanceTier]);

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;

      // ── QUALITY GATE: reject images smaller than 64×64 ──
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        if (img.naturalWidth < MIN_LOGO_PX || img.naturalHeight < MIN_LOGO_PX) {
          // Mark this domain's favicon as failed so we don't retry
          if (tier === 'favicon' && faviconDomain) {
            _faviconQualityFailed.add(faviconDomain);
            // Cache as initials so future renders skip the favicon tier
            setCachedLogo(faviconDomain, '', 'icon');
          }
          setImgLoaded(false);
          advanceTier();
          return;
        }
      }

      // Image loaded successfully — show it
      setImgLoaded(true);

      let probeUrl = '';
      let probeCacheKey = cacheKey;
      const isFav = tier === 'favicon';
      if (tier === 'brand' && brandLogoUrl) { probeUrl = brandLogoUrl; }
      else if (tier === 'brand' && cachedLogo) { probeUrl = cachedLogo.url; }
      else if (tier === 'clearbit') { probeUrl = clearbitUrl; probeCacheKey = `clearbit:${faviconDomain}`; }
      else if (tier === 'linkedin') { probeUrl = linkedinImageUrl; probeCacheKey = `linkedin:${faviconDomain}`; }
      else if (tier === 'favicon') { probeUrl = faviconUrl; probeCacheKey = faviconDomain; }

      // Cache the resolved logo URL for future visits
      if (probeUrl && faviconDomain && tier !== 'icon') {
        const sourceMap: Record<string, string> = { brand: 'brandfetch', clearbit: 'clearbit', linkedin: 'linkedin', favicon: 'favicon' };
        setCachedLogo(faviconDomain, probeUrl, sourceMap[tier] || tier);
      }

      if (probeUrl && probeCacheKey) {
        probeImageBrightness(probeUrl, probeCacheKey, isFav, (result) => {
          if (!mountedRef.current) return;
          if (result === 'empty' || result === 'generic') {
            // Favicon returned generic globe — skip to initials
            if (tier === 'favicon' && faviconDomain) {
              _faviconQualityFailed.add(faviconDomain);
              setCachedLogo(faviconDomain, '', 'icon');
            }
            advanceTier();
          } else {
            setIsDarkLogo(result === 'dark');
          }
        });
      }
    },
    [tier, brandLogoUrl, cachedLogo, clearbitUrl, linkedinImageUrl, faviconUrl, cacheKey, faviconDomain, advanceTier],
  );

  // Resolve current tier -> image URL
  let imgSrc = '';
  if (tier === 'brand') {
    if (brandLogoUrl) imgSrc = brandLogoUrl;
    else if (cachedLogo && cachedLogo.url) imgSrc = cachedLogo.url;
  }
  else if (tier === 'clearbit') imgSrc = clearbitUrl;
  else if (tier === 'linkedin') imgSrc = linkedinImageUrl;
  else if (tier === 'favicon') imgSrc = faviconUrl;

  // ── Icon fallback ──────────────────────────────────────────────────
  if (tier === 'icon' || !imgSrc) {
    const iconSize = Math.max(Math.round(size * 0.5), 12);
    if (inline) {
      return (
        <span
          className={`inline-flex items-center justify-center flex-shrink-0 rounded-sm bg-zinc-100 dark:bg-zinc-800 ${className}`}
          style={{ width: size, height: size }}
        >
          <Building2
            className="text-zinc-400 dark:text-zinc-500"
            size={iconSize}
            strokeWidth={1.5}
          />
        </span>
      );
    }
    return (
      <div
        className={`rounded-lg border flex items-center justify-center flex-shrink-0 overflow-hidden border-zinc-200/50 dark:border-zinc-700/30 bg-zinc-100 dark:bg-zinc-800/60 ${className}`}
        style={{ width: size, height: size }}
      >
        <Building2
          className="text-zinc-400 dark:text-zinc-500"
          size={iconSize}
          strokeWidth={1.5}
        />
      </div>
    );
  }

  // ── Dark-mode treatment ────────────────────────────────────────────
  const darkBlendClass = isDarkLogo ? 'dark:mix-blend-lighten' : '';
  const isFavicon = tier === 'favicon';

  if (inline) {
    const iconSize = Math.max(Math.round(size * 0.5), 12);
    return (
      <span
        className={`inline-flex items-center justify-center flex-shrink-0 rounded-sm relative ${isDarkLogo ? 'dark:bg-zinc-700' : ''} ${className}`}
        style={{ width: size, height: size }}
      >
        {/* Building2 fallback behind the img — visible until image loads */}
        {!imgLoaded && (
          <Building2
            className="text-zinc-400 dark:text-zinc-500 absolute"
            size={iconSize}
            strokeWidth={1.5}
          />
        )}
        <img
          ref={imgRef}
          src={imgSrc}
          alt=""
          width={size}
          height={size}
          className={`flex-shrink-0 rounded-sm object-contain ${darkBlendClass} transition-opacity duration-150 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={{ width: size, height: size }}
          loading="lazy"
          decoding="async"
          onError={handleError}
          onLoad={handleLoad}
        />
      </span>
    );
  }

  const containerDarkBg = isDarkLogo ? 'dark:bg-zinc-700' : 'dark:bg-zinc-800/30';
  const iconSize = Math.max(Math.round(size * 0.5), 12);

  return (
    <div
      className={`rounded-lg border flex items-center justify-center flex-shrink-0 overflow-hidden relative border-zinc-200/50 dark:border-zinc-700/30 bg-zinc-50 ${containerDarkBg} ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Building2 fallback behind the img — visible until image loads */}
      {!imgLoaded && (
        <Building2
          className="text-zinc-400 dark:text-zinc-500 absolute"
          size={iconSize}
          strokeWidth={1.5}
        />
      )}
      <img
        ref={imgRef}
        src={imgSrc}
        alt=""
        className={`object-contain ${isFavicon ? '' : 'p-0.5'} ${darkBlendClass} transition-opacity duration-150 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
        style={{ width: size, height: size }}
        loading="lazy"
        decoding="async"
        onError={handleError}
        onLoad={handleLoad}
      />
    </div>
  );
}

/**
 * Extracts a clean domain from a lead's website URL, email, company
 * object, or LinkedIn company URL. Tries every source available.
 */
export function extractLeadDomain(lead: {
  website?: string | null;
  company_website?: string | null;
  email?: string | null;
  primary_email?: string | null;
  emails?: Array<{ email?: string }> | null;
  company?: {
    website?: string | null;
    linkedin_url?: string | null;
  } | null;
  linkedin?: string | null;
  person_linkedin_url?: string | null;
}): string {
  // Priority 1: explicit website / company_website / company.website
  for (const raw of [lead.website, lead.company_website, lead.company?.website]) {
    if (raw) {
      const d = cleanCompanyDomain(raw);
      if (d && d.includes('.')) return d;
    }
  }
  // Priority 2: email domain (skip generic providers) — check all email sources
  const generic = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
    'zoho.com', 'yandex.com', 'tutanota.com', 'fastmail.com',
  ]);
  const emailCandidates = [
    lead.email,
    lead.primary_email,
    ...(lead.emails || []).map(e => e.email),
  ].filter(Boolean) as string[];
  for (const email of emailCandidates) {
    const parts = email.split('@');
    if (parts.length === 2) {
      const emailDomain = parts[1].toLowerCase().trim();
      if (!generic.has(emailDomain) && emailDomain.includes('.')) {
        return emailDomain;
      }
    }
  }
  // Priority 3 REMOVED (v3.4.0): LinkedIn slug → domain guessing was unreliable
  // and caused wrong logos. Return empty if no verified domain found.
  return '';
}

/**
 * Extract the LinkedIn company URL from a lead object (for CompanyLogo).
 */
export function extractCompanyLinkedin(lead: {
  company?: { linkedin_url?: string | null } | null;
}): string {
  return lead.company?.linkedin_url || '';
}

/**
 * Clear all entries from the CompanyLogo localStorage cache.
 * Call this when starting a new search to prevent stale logos
 * from being applied to different companies.
 */
export function clearCompanyLogoCache(): void {
  try {
    _logoCacheMap = new Map();
    localStorage.removeItem(LOGO_CACHE_KEY);
  } catch { /* ok */ }
  // Also reset the in-memory probe cache and favicon-failed set
  probeCache.clear();
  _faviconQualityFailed.clear();
}

/**
 * Invalidate a specific domain's cached logo entry.
 */
export function invalidateCachedLogo(domain: string): void {
  if (!domain) return;
  const cache = getLogoCache();
  cache.delete(domain);
  queueMicrotask(() => {
    try {
      const obj: Record<string, LogoCacheEntry> = {};
      for (const [k, v] of cache) obj[k] = v;
      localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(obj));
    } catch { /* quota exceeded */ }
  });
}