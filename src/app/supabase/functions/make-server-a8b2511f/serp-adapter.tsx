/**
 * SerpAPI → Serper.dev adapter.
 *
 * Serper is ~10× cheaper than SerpAPI ($0.30/1k vs $5/1k for Google search)
 * and returns identical data, but uses a different URL + response shape.
 *
 * This adapter accepts a SerpAPI URL (the existing call shape used across
 * the codebase) and:
 *
 *   1) Routes Google* engines through Serper if SERPER_API_KEY is set
 *   2) Translates the Serper response back to the SerpAPI shape callers
 *      already parse — so adoption is one-line per call site
 *   3) Falls back to real SerpAPI when the engine isn't supported by
 *      Serper or the key isn't configured
 *
 * Drop-in usage:
 *   const r = await serpFetch('https://serpapi.com/search?engine=google&q=foo');
 *   const data = await r.json();
 *   // `data.organic_results`, `data.local_results`, etc. — same shape as SerpAPI
 */

// Map SerpAPI's `engine` query param to Serper's path. null = not supported,
// fall through to SerpAPI.
const SERPER_PATH_BY_ENGINE: Record<string, string | null> = {
  google: '/search',
  google_search: '/search',
  google_maps: '/maps',
  google_news: '/news',
  google_images: '/images',
  google_scholar: '/scholar',
  google_jobs: '/jobs',
  google_places: '/places',
  // Engines Serper doesn't cover → fall back to real SerpAPI
  bing: null,
  yahoo: null,
  duckduckgo: null,
  baidu: null,
  yandex: null,
};

const SERPER_BASE = 'https://google.serper.dev';

export function getSerpSearchKey(): string {
  return Deno.env.get('SERPAPI_API_KEY') || Deno.env.get('SERPER_API_KEY') || '';
}

/**
 * Drop-in replacement for `fetch(serpapiUrl)`. Returns a Response so
 * callers can keep `.json()` / `.ok` / `.status` unchanged.
 */
export async function serpFetch(serpapiUrl: string, init?: RequestInit): Promise<Response> {
  const serperKey = Deno.env.get('SERPER_API_KEY');
  if (!serperKey) return realSerpApi(serpapiUrl, init);

  let url: URL;
  try { url = new URL(serpapiUrl); } catch { return realSerpApi(serpapiUrl, init); }
  if (!url.hostname.includes('serpapi.com')) return fetch(serpapiUrl, init);

  const engine = (url.searchParams.get('engine') || 'google').toLowerCase();
  const serperPath = SERPER_PATH_BY_ENGINE[engine];
  if (serperPath === null) {
    // Engine not supported by Serper — pass through
    return realSerpApi(serpapiUrl, init);
  }
  if (serperPath === undefined) {
    // Unknown engine — be safe, pass through
    return realSerpApi(serpapiUrl, init);
  }

  // Build Serper request body from SerpAPI query params
  const body: Record<string, any> = {};
  const q = url.searchParams.get('q');
  if (q) body.q = q;

  // Pagination — SerpAPI uses `num` + `start`; Serper uses `num` + `page`.
  // Serper is stricter than SerpAPI on some endpoints; 10 is the safest
  // portable page size and avoids 400s on advanced Google queries.
  const num = parseInt(url.searchParams.get('num') || '', 10);
  if (Number.isFinite(num) && num > 0) body.num = Math.min(num, 10);
  const start = parseInt(url.searchParams.get('start') || '', 10);
  if (Number.isFinite(start) && start > 0 && body.num) {
    body.page = Math.floor(start / (body.num || 10)) + 1;
  }

  // Geo / language — common params SerpAPI callers set
  const gl = url.searchParams.get('gl');
  if (gl) body.gl = gl;
  const hl = url.searchParams.get('hl');
  if (hl) body.hl = hl;
  const location = url.searchParams.get('location');
  if (location) body.location = location;

  // Maps-specific
  if (engine === 'google_maps' || engine === 'google_places') {
    const ll = url.searchParams.get('ll');
    if (ll) body.ll = ll;
    // SerpAPI uses `type=search` for maps queries; Serper infers from path
  }

  try {
    const res = await postSerper(serperPath, serperKey, body);

    if (!res.ok && res.status === 400) {
      const errText = await res.text().catch(() => "");
      console.warn(`[SERP-ADAPTER] Serper 400 for ${engine}: ${errText.slice(0, 240)}; retrying minimal payload`);

      const minimalBody: Record<string, any> = {};
      if (q) minimalBody.q = q;
      if (gl) minimalBody.gl = gl;
      if (hl) minimalBody.hl = hl;

      const retry = await postSerper(serperPath, serperKey, minimalBody);
      if (retry.ok) {
        const serperJson = await retry.json();
        const translated = translateSerperToSerpApi(serperJson, engine);
        return new Response(JSON.stringify(translated), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const retryText = await retry.text().catch(() => "");
      console.warn(`[SERP-ADAPTER] Serper retry failed ${retry.status}: ${retryText.slice(0, 240)}`);
      return new Response(retryText || errText || "Serper request failed", {
        status: retry.status,
        statusText: retry.statusText,
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[SERP-ADAPTER] Serper ${res.status}: ${errText.slice(0, 240)}`);
      if (Deno.env.get("SERPER_ALLOW_SERPAPI_FALLBACK") === "true") {
        return realSerpApi(serpapiUrl, init);
      }
      return new Response(errText || "Serper request failed", {
        status: res.status,
        statusText: res.statusText,
      });
    }

    const serperJson = await res.json();
    const translated = translateSerperToSerpApi(serperJson, engine);
    return new Response(JSON.stringify(translated), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.warn(`[SERP-ADAPTER] Serper threw: ${e?.message}`);
    if (Deno.env.get("SERPER_ALLOW_SERPAPI_FALLBACK") === "true") {
      return realSerpApi(serpapiUrl, init);
    }
    return new Response(e?.message || "Serper request failed", { status: 502 });
  }
}

function postSerper(path: string, apiKey: string, body: Record<string, any>): Promise<Response> {
  return fetch(`${SERPER_BASE}${path}`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
}

function realSerpApi(serpapiUrl: string, init?: RequestInit): Promise<Response> {
  // Just pass through to the original URL — SerpAPI key already embedded
  return fetch(serpapiUrl, init);
}

/**
 * Translate Serper's response into the SerpAPI shape the rest of the
 * codebase already parses. Conservative — keeps the original Serper
 * fields under `_serper` for debugging and only maps the well-known ones.
 */
function translateSerperToSerpApi(serper: any, engine: string): any {
  const out: any = {
    search_metadata: { status: 'Success', engine, source: 'serper' },
    _serper: serper,  // raw payload for debugging
  };

  // ── Web search ──
  if (Array.isArray(serper.organic)) {
    out.organic_results = serper.organic.map((r: any, i: number) => ({
      position: r.position ?? i + 1,
      title: r.title,
      link: r.link,
      displayed_link: r.displayed_link || r.link,
      snippet: r.snippet,
      snippet_highlighted_words: r.snippet_highlighted_words,
      sitelinks: r.sitelinks,
      date: r.date,
      attributes: r.attributes,
    }));
  }

  if (Array.isArray(serper.peopleAlsoAsk)) {
    out.related_questions = serper.peopleAlsoAsk.map((q: any) => ({
      question: q.question,
      snippet: q.snippet,
      title: q.title,
      link: q.link,
    }));
  }

  if (serper.knowledgeGraph) {
    const kg = serper.knowledgeGraph;
    out.knowledge_graph = {
      title: kg.title,
      type: kg.type,
      description: kg.description,
      website: kg.website,
      image: kg.imageUrl,
      attributes: kg.attributes,
    };
  }

  // ── Maps / Places ──
  if (Array.isArray(serper.places)) {
    out.local_results = serper.places.map((p: any) => ({
      position: p.position,
      title: p.title,
      place_id: p.placeId || p.cid,
      data_id: p.fid,
      data_cid: p.cid,
      reviews_link: p.reviewsLink,
      photos_link: p.photosLink,
      gps_coordinates: p.latitude && p.longitude ? { latitude: p.latitude, longitude: p.longitude } : undefined,
      rating: p.rating,
      reviews: p.ratingCount,
      type: p.type,
      types: p.types,
      address: p.address,
      phone: p.phoneNumber,
      website: p.website,
      hours: p.openingHours,
      thumbnail: p.thumbnailUrl,
    }));
    // SerpAPI also exposes `places_results` in some maps responses — alias for callers
    out.places_results = out.local_results;
  }

  // ── News ──
  if (Array.isArray(serper.news)) {
    out.news_results = serper.news.map((n: any, i: number) => ({
      position: i + 1,
      title: n.title,
      link: n.link,
      snippet: n.snippet,
      source: n.source,
      date: n.date,
      thumbnail: n.imageUrl,
    }));
  }

  // ── Images ──
  if (Array.isArray(serper.images)) {
    out.images_results = serper.images.map((img: any, i: number) => ({
      position: i + 1,
      thumbnail: img.thumbnailUrl,
      original: img.imageUrl,
      title: img.title,
      link: img.link,
      source: img.source,
      source_name: img.source,
    }));
  }

  // ── Scholar ──
  if (Array.isArray(serper.organic) && engine === 'google_scholar') {
    out.organic_results = serper.organic.map((r: any, i: number) => ({
      position: i + 1,
      title: r.title,
      link: r.link,
      publication_info: { summary: r.publicationInfo },
      snippet: r.snippet,
      cited_by: r.citedBy,
    }));
  }

  // ── Jobs ──
  if (Array.isArray(serper.jobs)) {
    out.jobs_results = serper.jobs.map((j: any, i: number) => ({
      position: i + 1,
      title: j.title,
      company_name: j.company,
      location: j.location,
      via: j.via,
      thumbnail: j.thumbnail,
      description: j.description,
    }));
  }

  return out;
}

/**
 * Diagnostic helper — admin/health endpoint can call this to confirm
 * the adapter is routing to Serper (and not silently falling back).
 */
export function serpAdapterStatus(): { provider: 'serper' | 'serpapi'; reason?: string } {
  if (Deno.env.get('SERPER_API_KEY')) return { provider: 'serper' };
  return { provider: 'serpapi', reason: 'SERPER_API_KEY not set' };
}

/**
 * Live end-to-end test of the adapter. Used by /admin/serp-diag so the
 * user can verify Serper is actually being hit (and not silently
 * falling back to SerpAPI). Runs three probes:
 *
 *   1) Web search via Serper directly
 *   2) Web search via the adapter (serpFetch) using a SerpAPI URL
 *   3) Maps search via the adapter
 *
 * Returns every step's success/error so we can pinpoint exactly where
 * the chain breaks.
 */
export async function runSerpDiagnostics(): Promise<any> {
  const out: any = {
    SERPER_API_KEY_set: !!Deno.env.get('SERPER_API_KEY'),
    SERPAPI_API_KEY_set: !!(Deno.env.get('SERPAPI_API_KEY') || Deno.env.get('SERP_API_KEY')),
    probes: {},
  };

  // 1) Direct Serper call — verifies key + network + payload shape
  if (out.SERPER_API_KEY_set) {
    try {
      const r = await fetch(`${SERPER_BASE}/search`, {
        method: 'POST',
        headers: {
          'X-API-KEY': Deno.env.get('SERPER_API_KEY')!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: 'contndr', num: 3 }),
      });
      const txt = await r.text();
      let json: any = null;
      try { json = JSON.parse(txt); } catch {}
      out.probes.serper_direct = {
        ok: r.ok,
        status: r.status,
        organic_count: Array.isArray(json?.organic) ? json.organic.length : 0,
        error: r.ok ? null : (json?.message || txt.slice(0, 200)),
      };
    } catch (e: any) {
      out.probes.serper_direct = { ok: false, error: e?.message };
    }
  } else {
    out.probes.serper_direct = { skipped: true, reason: 'SERPER_API_KEY not set' };
  }

  // 2) Adapter web search — verifies translation
  try {
    const url = `https://serpapi.com/search?engine=google&q=contndr&num=3&api_key=${Deno.env.get('SERPAPI_API_KEY') || ''}`;
    const r = await serpFetch(url);
    const json = await r.json();
    out.probes.adapter_web = {
      ok: r.ok,
      status: r.status,
      source: json?.search_metadata?.source || 'unknown',
      organic_results_count: Array.isArray(json?.organic_results) ? json.organic_results.length : 0,
      first_title: json?.organic_results?.[0]?.title || null,
    };
  } catch (e: any) {
    out.probes.adapter_web = { ok: false, error: e?.message };
  }

  // 3) Adapter maps search
  try {
    const url = `https://serpapi.com/search?engine=google_maps&q=coffee+shop+miami&type=search&api_key=${Deno.env.get('SERPAPI_API_KEY') || ''}`;
    const r = await serpFetch(url);
    const json = await r.json();
    out.probes.adapter_maps = {
      ok: r.ok,
      status: r.status,
      source: json?.search_metadata?.source || 'unknown',
      local_results_count: Array.isArray(json?.local_results) ? json.local_results.length : 0,
      first_title: json?.local_results?.[0]?.title || null,
    };
  } catch (e: any) {
    out.probes.adapter_maps = { ok: false, error: e?.message };
  }

  out.verdict = (() => {
    if (!out.SERPER_API_KEY_set) return 'SERPER_API_KEY not configured — adapter falling back to SerpAPI';
    if (!out.probes.serper_direct?.ok) return `Serper rejected the request: ${out.probes.serper_direct?.error || out.probes.serper_direct?.status}`;
    if (out.probes.adapter_web?.source !== 'serper') return 'Adapter did not route to Serper (check logs)';
    if (out.probes.adapter_web?.organic_results_count === 0) return 'Serper returned no organic results (translation issue)';
    return 'Adapter working — Serper is the active provider';
  })();

  return out;
}
