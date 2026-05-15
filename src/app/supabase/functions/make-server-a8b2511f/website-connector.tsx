// Website Connector — tracking script + form capture + intent → AI call pipeline
//
// Architecture:
//   Website Script → /wc/event → workspace resolver (by public key)
//                  → session record → intent score → call queue → AI agent
//   Website Form  → /wc/lead   → consent check → lead create → call queue
//
// KV layout:
//   wc:ws:<userId>                    → workspace config (public_key, domains, etc.)
//   wc:pk:<publicKey>                 → reverse index → userId
//   wc:sess:<userId>:<visitorId>      → visitor session (TTL-ish, rolled forward on events)
//   wc:event:<userId>:<eventId>       → individual event records (capped)
//   wc:eventlist:<userId>             → recent event ids (ring buffer for debug log)
//   wc:lead:<userId>:<leadId>         → website-captured lead reference
//   wc:queue:<userId>:<queueId>       → call queue entry pending dispatch

import { Hono } from "npm:hono";
import * as kv from "./kv-retry.tsx";
import { createClient } from 'npm:@supabase/supabase-js@2';

const wc = new Hono();

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ─── Plan gate: Scale + Enterprise only (whitelisted users always allowed) ─

const ENTITLED_PLANS = new Set(['scale', 'enterprise']);

async function isEntitled(user: any): Promise<{ allowed: boolean; plan: string }> {
  try {
    // Use the same gate logic as AI-call intent triggers so plans stay in sync.
    const { getUserSubscriptionStatus } = await import('./contndr-billing.tsx');
    const sub = await getUserSubscriptionStatus(user);
    const plan = String(sub?.plan || '').toLowerCase();
    const allowed = ENTITLED_PLANS.has(plan) || sub?.isWhitelisted === true;
    return { allowed, plan: plan || 'none' };
  } catch (err) {
    console.warn('[WC] entitlement check failed (fail-closed):', err?.message || err);
    return { allowed: false, plan: 'none' };
  }
}

// ─── Workspace shape ───────────────────────────────────────────────────

interface Workspace {
  user_id: string;
  workspace_id: string;       // user-facing id, same as user_id (kept distinct in case we ever split)
  public_key: string;         // safe to ship in <script>; rotates on demand
  domains: Array<{ host: string; verified: boolean; verified_at: string | null }>;
  ai_call_enabled: boolean;
  score_threshold: number;
  business_hours: { tz: string; start: number; end: number; days: number[] }; // 0=Sun
  created_at: string;
  updated_at: string;
}

const DEFAULT_HOURS = { tz: 'America/New_York', start: 9, end: 18, days: [1, 2, 3, 4, 5] };

function newPublicKey(): string {
  // 32 chars, url-safe-ish
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateWorkspace(userId: string): Promise<Workspace> {
  const existing = await kv.get(`wc:ws:${userId}`) as Workspace | null;
  if (existing) return existing;
  const ws: Workspace = {
    user_id: userId,
    workspace_id: userId,
    public_key: newPublicKey(),
    domains: [],
    ai_call_enabled: true,
    score_threshold: 60,
    business_hours: DEFAULT_HOURS,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await kv.set(`wc:ws:${userId}`, ws);
  await kv.set(`wc:pk:${ws.public_key}`, userId);
  return ws;
}

async function resolveByPublicKey(pk: string): Promise<Workspace | null> {
  if (!pk) return null;
  const userId = await kv.get(`wc:pk:${pk}`) as string | null;
  if (!userId) return null;
  return await kv.get(`wc:ws:${userId}`) as Workspace | null;
}

function originHost(req: Request): string | null {
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  try {
    return origin ? new URL(origin).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function domainMatches(allowed: string[], host: string | null): boolean {
  if (!host) return false;
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

// ─── Auth helper ───────────────────────────────────────────────────────

async function getAuthUser(c: any) {
  const accessToken = (c.req.header('Authorization') || '').replace('Bearer ', '').trim();
  if (!accessToken) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}

// ─── Intent scoring ────────────────────────────────────────────────────

function scoreSession(session: any): number {
  let s = 0;
  const pages: string[] = session.pages_visited || [];
  if (pages.some((p) => /pricing/i.test(p))) s += 25;
  if (pages.some((p) => /demo|trial|book/i.test(p))) s += 25;
  if (pages.some((p) => /contact|checkout/i.test(p))) s += 15;
  if ((session.page_views || 0) >= 3) s += 10;
  if ((session.cta_clicks || 0) >= 1) s += 15;
  if ((session.duration_ms || 0) > 60_000) s += 10;
  if (session.is_returning) s += 10;
  if (session.form_submitted) s += 30;
  // freemail dings a few points, business domains help
  const email: string = session.email || '';
  if (email && !/gmail|yahoo|hotmail|outlook|icloud|aol/i.test(email)) s += 10;
  return Math.min(100, s);
}

// ─── Public CORS for event/lead endpoints ──────────────────────────────

const PUBLIC_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Contndr-Key',
  'Access-Control-Max-Age': '86400',
};

wc.options('/event', (c) => new Response(null, { status: 204, headers: PUBLIC_CORS }));
wc.options('/lead', (c) => new Response(null, { status: 204, headers: PUBLIC_CORS }));

// ─── Public ingest: tracking events ────────────────────────────────────

wc.post('/event', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const publicKey = String(body.public_key || c.req.header('X-Contndr-Key') || '').trim();
    const ws = await resolveByPublicKey(publicKey);
    if (!ws) return new Response(JSON.stringify({ error: 'Unknown workspace' }), { status: 401, headers: PUBLIC_CORS });

    const host = originHost(c.req.raw);
    // Try the body URL too — some browsers strip Referer/Origin on third-party POSTs
    let eventHost: string | null = host;
    if (!eventHost && body.url) {
      try { eventHost = new URL(String(body.url)).hostname.toLowerCase(); } catch {}
    }
    const verifiedHosts = ws.domains.filter((d) => d.verified).map((d) => d.host);
    if (verifiedHosts.length > 0 && !domainMatches(verifiedHosts, eventHost)) {
      return new Response(JSON.stringify({ error: 'Domain not approved' }), { status: 403, headers: PUBLIC_CORS });
    }

    // Auto-verify pending domains on first matching event so customers don't
    // have to click Verify manually. Match by exact host or by suffix.
    if (eventHost) {
      const pending = ws.domains.find((d) => !d.verified && (eventHost === d.host || eventHost.endsWith(`.${d.host}`)));
      if (pending) {
        pending.verified = true;
        pending.verified_at = new Date().toISOString();
        ws.updated_at = new Date().toISOString();
        await kv.set(`wc:ws:${ws.user_id}`, ws);
        console.log(`[WC] Auto-verified domain ${pending.host} for user ${ws.user_id}`);
      }
    }

    const visitorId = String(body.visitor_id || '').slice(0, 64) || crypto.randomUUID();
    const eventType = String(body.event_type || 'page_view'); // page_view | cta_click | form_view | session_end
    const url = String(body.url || '');
    const referrer = String(body.referrer || '');
    const utm = body.utm || {};
    const device = String(body.device || '');
    const browser = String(body.browser || '');
    const location = body.location || null;
    const cfIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
    const ip = cfIp.split(',')[0].trim();

    // Roll the session forward
    const sessKey = `wc:sess:${ws.user_id}:${visitorId}`;
    const existing = await kv.get(sessKey) as any;
    const now = new Date().toISOString();
    const session = existing || {
      visitor_id: visitorId,
      user_id: ws.user_id,
      first_seen: now,
      ip,
      utm,
      referrer,
      device,
      browser,
      location,
      pages_visited: [],
      page_views: 0,
      cta_clicks: 0,
      form_submitted: false,
      duration_ms: 0,
      is_returning: false,
    };
    session.last_seen = now;
    if (existing) {
      session.is_returning = true;
      session.duration_ms = Date.now() - new Date(session.first_seen).getTime();
    }
    if (eventType === 'page_view') {
      session.page_views = (session.page_views || 0) + 1;
      if (url && !session.pages_visited.includes(url)) {
        session.pages_visited.push(url);
        if (session.pages_visited.length > 50) session.pages_visited.shift();
      }
    } else if (eventType === 'cta_click') {
      session.cta_clicks = (session.cta_clicks || 0) + 1;
    }
    session.intent_score = scoreSession(session);
    await kv.set(sessKey, session);

    // Append to event log (capped at 200)
    const eventId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const eventRec = {
      id: eventId,
      user_id: ws.user_id,
      visitor_id: visitorId,
      event_type: eventType,
      url,
      referrer,
      utm,
      device,
      browser,
      ip,
      at: now,
    };
    await kv.set(`wc:event:${ws.user_id}:${eventId}`, eventRec);
    const listKey = `wc:eventlist:${ws.user_id}`;
    const list = (await kv.get(listKey) as string[]) || [];
    list.unshift(eventId);
    await kv.set(listKey, list.slice(0, 200));

    // ── Bridge to legacy Analytics Live Traffic ──
    // Mirror the event into the recent_visit_v2 key format so the existing
    // Analytics → Live Traffic page shows these visits without any frontend
    // change. Enriches with Cloudflare geo headers so the visitor pin lands
    // on the correct city — same source the legacy /tracking endpoint uses.
    // Fire-and-forget so it never blocks the response.
    (async () => {
      try {
        const ts = Date.now();
        const visitId = crypto.randomUUID();
        const cfLatRaw = c.req.header('cf-iplatitude');
        const cfLonRaw = c.req.header('cf-iplongitude');
        const cfCity = c.req.header('cf-ipcity') || null;
        const cfRegion = c.req.header('cf-region-code') || c.req.header('cf-region') || null;
        const cfCountry = c.req.header('cf-ipcountry') || null;
        const cfLat = cfLatRaw ? parseFloat(cfLatRaw) : null;
        const cfLon = cfLonRaw ? parseFloat(cfLonRaw) : null;
        const visitData = {
          id: visitId,
          user_id: ws.user_id,
          lead_id: 'anonymous',
          anonymous_lead: { visitor_id: visitorId },
          brand: 'contndr',
          campaign_id: null,
          email_id: null,
          event_type: eventType,
          element_text: body.cta_label || null,
          element_href: null,
          url,
          title: body.title || '',
          timestamp: new Date(now).toISOString(),
          user_agent: c.req.header('User-Agent') || '',
          city: cfCity,
          country: cfCountry,
          countryCode: cfCountry,
          region: cfRegion,
          latitude: Number.isFinite(cfLat) ? cfLat : null,
          longitude: Number.isFinite(cfLon) ? cfLon : null,
          isp: null,
          affiliate_ref: null,
          kv_key: `recent_visit_v2:${ws.user_id}:${ts}:${visitId}`,
          source: 'website_connector',
        };
        await kv.set(visitData.kv_key, visitData);
      } catch (bridgeErr) {
        console.warn('[WC] legacy visit bridge failed (non-fatal):', bridgeErr);
      }
    })();

    return new Response(JSON.stringify({ ok: true, visitor_id: visitorId, score: session.intent_score }), {
      status: 200, headers: { ...PUBLIC_CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[WC] /event error', err);
    return new Response(JSON.stringify({ error: err?.message || 'event failed' }), { status: 500, headers: PUBLIC_CORS });
  }
});

// ─── Public ingest: form lead capture ──────────────────────────────────

wc.post('/lead', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const publicKey = String(body.public_key || c.req.header('X-Contndr-Key') || '').trim();
    const ws = await resolveByPublicKey(publicKey);
    if (!ws) return new Response(JSON.stringify({ error: 'Unknown workspace' }), { status: 401, headers: PUBLIC_CORS });

    const host = originHost(c.req.raw);
    const verifiedHosts = ws.domains.filter((d) => d.verified).map((d) => d.host);
    if (verifiedHosts.length > 0 && !domainMatches(verifiedHosts, host)) {
      return new Response(JSON.stringify({ error: 'Domain not approved' }), { status: 403, headers: PUBLIC_CORS });
    }

    const fields = body.fields || {};
    const fullName = String(fields.full_name || fields.name || '').trim().slice(0, 200);
    const email = String(fields.email || '').trim().toLowerCase().slice(0, 200);
    const phone = String(fields.phone || '').trim().slice(0, 32);
    const company = String(fields.company || '').trim().slice(0, 200);
    const website = String(fields.website || '').trim().slice(0, 200);
    const role = String(fields.role || fields.title || '').trim().slice(0, 200);
    const message = String(fields.message || '').trim().slice(0, 2000);
    const consent = !!fields.consent;
    const consent_text = String(fields.consent_text || '').slice(0, 500);

    if (!email && !phone) {
      return new Response(JSON.stringify({ error: 'email or phone required' }), { status: 400, headers: PUBLIC_CORS });
    }

    const visitorId = String(body.visitor_id || '').slice(0, 64);
    const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '').split(',')[0].trim();
    const userAgent = c.req.header('user-agent') || '';
    const sourceUrl = String(body.url || '');

    // Pull session for intent context
    let session: any = null;
    if (visitorId) {
      session = await kv.get(`wc:sess:${ws.user_id}:${visitorId}`);
      if (session) {
        session.form_submitted = true;
        session.email = email;
        session.intent_score = scoreSession(session);
        await kv.set(`wc:sess:${ws.user_id}:${visitorId}`, session);
      }
    }

    // Idempotent lead create: dedupe by (user_id, email) when email present
    const leadId = crypto.randomUUID();
    let existingId: string | null = null;
    if (email) {
      const { data: dup } = await supabase
        .from('leads')
        .select('id')
        .eq('user_id', ws.user_id)
        .eq('email', email)
        .maybeSingle();
      if (dup?.id) existingId = dup.id;
    }

    const leadRow: any = {
      id: existingId || leadId,
      user_id: ws.user_id,
      name: fullName || (email.split('@')[0] || null),
      email: email || null,
      phone: phone || null,
      company: company || null,
      website: website || null,
      title: role || null,
      source: 'website_intent_capture',
      lead_status: 'new',
      notes: message || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      if (existingId) {
        await supabase.from('leads').update({
          phone: leadRow.phone || undefined,
          company: leadRow.company || undefined,
          title: leadRow.title || undefined,
          notes: leadRow.notes || undefined,
          updated_at: leadRow.updated_at,
        }).eq('id', existingId);
      } else {
        const { error } = await supabase.from('leads').insert(leadRow);
        if (error) {
          console.warn('[WC] lead insert failed (continuing):', error.message);
        }
      }
    } catch (e: any) {
      console.warn('[WC] lead persistence error:', e?.message || e);
    }

    // Consent record (compliance trail)
    const consentRec = {
      lead_id: leadRow.id,
      user_id: ws.user_id,
      phone,
      consent,
      consent_text,
      source_url: sourceUrl,
      ip,
      user_agent: userAgent,
      visitor_id: visitorId || null,
      at: new Date().toISOString(),
    };
    await kv.set(`wc:consent:${ws.user_id}:${leadRow.id}`, consentRec);

    // Persist a website-capture record (regardless of CRM insert success)
    const captureRec = {
      ...leadRow,
      visitor_id: visitorId || null,
      session_summary: session ? {
        page_views: session.page_views,
        cta_clicks: session.cta_clicks,
        pages_visited: session.pages_visited,
        duration_ms: session.duration_ms,
        utm: session.utm,
        referrer: session.referrer,
        intent_score: session.intent_score,
      } : null,
      consent,
      created_at: leadRow.created_at,
    };
    await kv.set(`wc:lead:${ws.user_id}:${leadRow.id}`, captureRec);

    // Decide whether to trigger an AI call
    const score = session?.intent_score ?? scoreSession({ ...captureRec, form_submitted: true, email });
    const aiCallDecision = {
      attempted: false,
      reason: '',
      queue_id: null as string | null,
    };

    if (!consent) {
      aiCallDecision.reason = 'no_phone_consent';
    } else if (!phone) {
      aiCallDecision.reason = 'no_phone';
    } else if (!ws.ai_call_enabled) {
      aiCallDecision.reason = 'ai_calling_disabled';
    } else if (score < ws.score_threshold) {
      aiCallDecision.reason = `score_below_threshold (${score} < ${ws.score_threshold})`;
    } else if (!withinBusinessHours(ws.business_hours)) {
      aiCallDecision.reason = 'outside_business_hours';
    } else {
      // Enqueue + fire immediately (best-effort)
      const queueId = `wcq_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const queueRec = {
        id: queueId,
        user_id: ws.user_id,
        lead_id: leadRow.id,
        phone,
        name: leadRow.name,
        email: leadRow.email,
        source: 'website_intent_capture',
        score,
        created_at: new Date().toISOString(),
        status: 'queued',
      };
      await kv.set(`wc:queue:${ws.user_id}:${queueId}`, queueRec);
      aiCallDecision.attempted = true;
      aiCallDecision.queue_id = queueId;

      // Fire-and-forget call placement
      placeWebsiteIntentCall(ws.user_id, queueRec).catch((err) => {
        console.error('[WC] call placement error:', err?.message || err);
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      lead_id: leadRow.id,
      score,
      ai_call: aiCallDecision,
    }), { status: 200, headers: { ...PUBLIC_CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[WC] /lead error', err);
    return new Response(JSON.stringify({ error: err?.message || 'lead failed' }), { status: 500, headers: PUBLIC_CORS });
  }
});

function withinBusinessHours(bh: Workspace['business_hours']): boolean {
  try {
    // Compute hour-of-day in the workspace tz
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: bh.tz, hour: 'numeric', hour12: false, weekday: 'short' });
    const parts = fmt.formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = wkMap[parts.find((p) => p.type === 'weekday')?.value || 'Mon'];
    return bh.days.includes(day) && hour >= bh.start && hour < bh.end;
  } catch {
    return true; // fail-open rather than block legitimate calls on tz misconfig
  }
}

async function placeWebsiteIntentCall(userId: string, queueRec: any) {
  // Look up user, agent mode config, and route through Convai if configured.
  // Falls back to Telnyx path if Convai is off.
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const u = data?.user;
    if (!u) throw new Error('user not found');

    const agentConfig = (await kv.get(`agent_mode:${userId}:config`)) as any;
    const useConvai = !!agentConfig?.useElevenLabsConvai;
    const phoneNumberId = agentConfig?.elevenLabsPhoneNumberId;

    if (useConvai && phoneNumberId) {
      const { syncAgentForCall } = await import('./elevenlabs.tsx');
      const synced = await syncAgentForCall({
        userId,
        userEmail: u.email || undefined,
        ai_config: { name: 'Alex', brand: 'Contndr', objective: 'book_call', brand_tone: 'friendly' },
        lead: { name: queueRec.name, email: queueRec.email, phone: queueRec.phone, business: 'Website Visitor' },
      });
      if (!synced.synced) throw new Error(`Agent sync failed: ${synced.error}`);

      const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
      if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');

      const res = await fetch('https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: synced.agent_id,
          agent_phone_number_id: phoneNumberId,
          to_number: queueRec.phone,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(`Convai outbound failed (${res.status}): ${json.message || JSON.stringify(json).slice(0, 200)}`);
      }
      queueRec.status = 'dispatched';
      queueRec.convai_conversation_id = json.conversation_id || null;
      queueRec.dispatched_at = new Date().toISOString();
    } else {
      queueRec.status = 'skipped';
      queueRec.skip_reason = 'convai not configured';
    }
  } catch (err: any) {
    queueRec.status = 'failed';
    queueRec.error = err?.message || String(err);
  }
  await kv.set(`wc:queue:${userId}:${queueRec.id}`, queueRec);
}

// ─── Authenticated dashboard endpoints ─────────────────────────────────

wc.get('/workspace', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ent = await isEntitled(user);
  if (!ent.allowed) {
    return c.json({ entitled: false, plan: ent.plan, required_plans: ['scale', 'enterprise'] });
  }
  const ws = await getOrCreateWorkspace(user.id);
  const origin = (c.req.header('origin') || '').replace(/\/$/, '');
  const cdnBase = origin || Deno.env.get('SUPABASE_URL') || '';
  const trackerUrl = `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/functions/v1/make-server-a8b2511f/wc/tracker.js?k=${ws.public_key}`;
  return c.json({
    entitled: true,
    plan: ent.plan,
    workspace: ws,
    install: {
      script_tag: `<script async src="${trackerUrl}" data-workspace-id="${ws.workspace_id}" data-public-key="${ws.public_key}"></script>`,
      tracker_url: trackerUrl,
      form_attribute: 'data-contndr-capture="lead"',
      event_endpoint: `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/functions/v1/make-server-a8b2511f/wc/event`,
      lead_endpoint: `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/functions/v1/make-server-a8b2511f/wc/lead`,
    },
  });
});

wc.put('/workspace', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ws = await getOrCreateWorkspace(user.id);
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body.ai_call_enabled === 'boolean') ws.ai_call_enabled = body.ai_call_enabled;
  if (typeof body.score_threshold === 'number') ws.score_threshold = Math.max(0, Math.min(100, body.score_threshold));
  if (body.business_hours && typeof body.business_hours === 'object') {
    ws.business_hours = {
      tz: String(body.business_hours.tz || ws.business_hours.tz),
      start: Math.max(0, Math.min(23, Number(body.business_hours.start ?? ws.business_hours.start))),
      end: Math.max(1, Math.min(24, Number(body.business_hours.end ?? ws.business_hours.end))),
      days: Array.isArray(body.business_hours.days) ? body.business_hours.days.filter((d: any) => d >= 0 && d <= 6) : ws.business_hours.days,
    };
  }
  ws.updated_at = new Date().toISOString();
  await kv.set(`wc:ws:${user.id}`, ws);
  return c.json({ workspace: ws });
});

wc.post('/domains', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ws = await getOrCreateWorkspace(user.id);
  const { host } = await c.req.json().catch(() => ({} as any));
  const cleaned = String(host || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!cleaned || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
    return c.json({ error: 'Invalid domain' }, 400);
  }
  if (ws.domains.find((d) => d.host === cleaned)) return c.json({ workspace: ws });
  ws.domains.push({ host: cleaned, verified: false, verified_at: null });
  ws.updated_at = new Date().toISOString();
  await kv.set(`wc:ws:${user.id}`, ws);
  return c.json({ workspace: ws });
});

wc.post('/domains/verify', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ws = await getOrCreateWorkspace(user.id);
  const { host } = await c.req.json().catch(() => ({} as any));
  const cleaned = String(host || '').toLowerCase();
  const d = ws.domains.find((x) => x.host === cleaned);
  if (!d) return c.json({ error: 'Domain not found' }, 404);

  // Verification = the tracker has fired at least one /event from this host.
  // Since /event is what stamps the host check anyway, the cleanest signal is
  // to look for a recent event whose URL hostname matches.
  const listKey = `wc:eventlist:${user.id}`;
  const recent = ((await kv.get(listKey)) as string[]) || [];
  const slice = recent.slice(0, 50);
  let ok = false;
  for (const id of slice) {
    const ev = await kv.get(`wc:event:${user.id}:${id}`) as any;
    if (!ev) continue;
    try {
      const evHost = new URL(ev.url || '').hostname.toLowerCase();
      if (evHost === cleaned || evHost.endsWith(`.${cleaned}`)) { ok = true; break; }
    } catch {}
  }
  if (!ok) {
    return c.json({ verified: false, reason: 'No event received from this host yet. Install the script and load a page.' });
  }
  d.verified = true;
  d.verified_at = new Date().toISOString();
  ws.updated_at = new Date().toISOString();
  await kv.set(`wc:ws:${user.id}`, ws);
  return c.json({ verified: true, workspace: ws });
});

wc.delete('/domains', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ws = await getOrCreateWorkspace(user.id);
  const host = String(c.req.query('host') || '').toLowerCase();
  ws.domains = ws.domains.filter((d) => d.host !== host);
  ws.updated_at = new Date().toISOString();
  await kv.set(`wc:ws:${user.id}`, ws);
  return c.json({ workspace: ws });
});

wc.post('/rotate-key', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ws = await getOrCreateWorkspace(user.id);
  await kv.del(`wc:pk:${ws.public_key}`);
  ws.public_key = newPublicKey();
  ws.updated_at = new Date().toISOString();
  await kv.set(`wc:pk:${ws.public_key}`, user.id);
  await kv.set(`wc:ws:${user.id}`, ws);
  return c.json({ workspace: ws });
});

wc.get('/events', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const list = ((await kv.get(`wc:eventlist:${user.id}`)) as string[]) || [];
  const ids = list.slice(0, 50);
  const events = await Promise.all(ids.map((id) => kv.get(`wc:event:${user.id}:${id}`)));
  return c.json({ events: events.filter(Boolean) });
});

wc.get('/leads', async (c) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const leads = await kv.getByPrefixLimited(`wc:lead:${user.id}:`, 100, 0).catch(() => []);
  const queue = await kv.getByPrefixLimited(`wc:queue:${user.id}:`, 100, 0).catch(() => []);
  return c.json({ leads, queue });
});

wc.post('/test-event', async (c) => {
  // Lets the dashboard fire a synthetic event so the user can see end-to-end wiring.
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ws = await getOrCreateWorkspace(user.id);
  const eventId = `test_${Date.now()}`;
  const eventRec = {
    id: eventId,
    user_id: user.id,
    visitor_id: 'test_visitor',
    event_type: 'page_view',
    url: 'https://test.contndr.com/pricing',
    referrer: 'dashboard_test_button',
    utm: { source: 'dashboard_test' },
    device: 'desktop',
    browser: 'Chrome',
    ip: '127.0.0.1',
    at: new Date().toISOString(),
  };
  await kv.set(`wc:event:${user.id}:${eventId}`, eventRec);
  const listKey = `wc:eventlist:${user.id}`;
  const list = ((await kv.get(listKey)) as string[]) || [];
  list.unshift(eventId);
  await kv.set(listKey, list.slice(0, 200));
  return c.json({ ok: true, event: eventRec, workspace: ws });
});

// ─── Public tracker.js ─────────────────────────────────────────────────

const TRACKER_JS = `(function(){
  try {
    var s = document.currentScript || (function(){var a=document.getElementsByTagName('script'); return a[a.length-1];})();
    var PK = (s && (s.getAttribute('data-public-key') || (s.src||'').split('k=')[1])) || '';
    if (!PK) return;
    var EP = (s.src.split('/wc/tracker.js')[0]) + '/wc';
    var KEY = 'ctd_vid';
    function uuid(){ try{ return crypto.randomUUID(); } catch(e){ return 'v_'+Date.now()+'_'+Math.random().toString(36).slice(2,10); } }
    var vid = '';
    try { vid = localStorage.getItem(KEY) || ''; } catch(e){}
    if (!vid) { vid = uuid(); try { localStorage.setItem(KEY, vid); } catch(e){} }

    function ctx(extra){
      var u = new URL(window.location.href);
      var utm = {};
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){
        var v = u.searchParams.get(k); if (v) utm[k.replace('utm_','')] = v;
      });
      return Object.assign({
        public_key: PK,
        visitor_id: vid,
        url: window.location.href,
        referrer: document.referrer || '',
        utm: utm,
        device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        browser: (navigator.userAgent.match(/(Chrome|Safari|Firefox|Edge|OPR)\\/[0-9.]+/) || [''])[0],
        location: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language }
      }, extra || {});
    }

    function send(path, payload){
      try {
        var url = EP + path;
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: body, keepalive: true }).catch(function(){});
        }
      } catch(e){}
    }

    // Initial page view
    send('/event', ctx({ event_type: 'page_view' }));

    // CTA clicks: any element with [data-contndr-cta] or visible button/anchor labelled book/demo/pricing
    document.addEventListener('click', function(ev){
      var el = ev.target && ev.target.closest && ev.target.closest('[data-contndr-cta], button, a');
      if (!el) return;
      var label = (el.getAttribute('data-contndr-cta') || el.innerText || '').trim().toLowerCase().slice(0,80);
      if (el.hasAttribute('data-contndr-cta') || /book|demo|pricing|get started|sign up|contact/i.test(label)) {
        send('/event', ctx({ event_type: 'cta_click', cta_label: label }));
      }
    }, { capture: true, passive: true });

    // Form capture: any form with [data-contndr-capture="lead"]
    document.addEventListener('submit', function(ev){
      var form = ev.target;
      if (!form || form.getAttribute('data-contndr-capture') !== 'lead') return;
      var fd = new FormData(form);
      var fields = {};
      ['full_name','name','email','phone','company','website','role','title','message','consent','consent_text'].forEach(function(k){
        var v = fd.get(k); if (v != null) fields[k] = (typeof v === 'string' ? v : String(v));
      });
      // Treat any checkbox named consent as boolean
      var c = form.querySelector('input[name="consent"]'); if (c) fields.consent = !!c.checked;
      var ct = form.querySelector('[data-contndr-consent-text]'); if (ct) fields.consent_text = ct.innerText.trim().slice(0,500);
      send('/lead', ctx({ fields: fields }));
    }, true);

    // Session end (best-effort)
    window.addEventListener('beforeunload', function(){ send('/event', ctx({ event_type: 'session_end' })); });
  } catch(e) { /* swallow */ }
})();`;

wc.get('/tracker.js', (c) => {
  return new Response(TRACKER_JS, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

export default wc;
