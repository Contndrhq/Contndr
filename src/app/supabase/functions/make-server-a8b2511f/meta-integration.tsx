/**
 * Meta (Facebook + Instagram) integration.
 *
 * Two inbound channels covered:
 *
 *   1. LEAD ADS
 *      Meta posts `leadgen` events when someone fills a lead form on a
 *      Facebook/Instagram ad. We resolve the full lead data via the
 *      Graph API using the leadgen_id, then create a Contndr lead with
 *      the form fields mapped to our schema.
 *
 *   2. MESSAGING (Instagram DM + Facebook Messenger)
 *      Meta posts `messages` events when someone messages your business
 *      page. We persist the message to KV under a unified meta_message:*
 *      key so it surfaces in the Contndr inbox alongside email + SMS.
 *
 * Authentication:
 *
 *   - Webhook verification (GET): Meta sends ?hub.verify_token=X.
 *     Compare against META_VERIFY_TOKEN env var. Reply with hub.challenge.
 *
 *   - Webhook signature (POST): Meta signs the body with X-Hub-Signature-256.
 *     HMAC-SHA256 with META_APP_SECRET. Reject mismatches.
 *
 *   - Per-user page access token (for fetching leadgen details + replying):
 *     stored in KV under meta:user:<userId>:page:<pageId>.
 */

import { Hono } from "npm:hono";
import * as kv from "./kv-retry.tsx";

const app = new Hono();

const META_GRAPH_VERSION = 'v19.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// ─── Webhook signature verification ──────────────────────────────────

async function verifyMetaSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const appSecret = Deno.env.get('META_APP_SECRET');
  if (!appSecret) {
    console.warn('[META] META_APP_SECRET not set — webhook signatures cannot be verified');
    return false;
  }
  const expected = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const hex = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare
  if (hex.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < hex.length; i++) result |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return result === 0;
}

// ─── GET /webhooks/meta — Verification challenge ─────────────────────

app.get('/webhooks/meta', (c) => {
  const url = new URL(c.req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = Deno.env.get('META_VERIFY_TOKEN');

  if (mode === 'subscribe' && token && expected && token === expected) {
    console.log('[META] Webhook verified by Meta');
    return c.text(challenge || '', 200);
  }
  console.warn('[META] Webhook verification failed', { mode, tokenMatch: token === expected });
  return c.text('Forbidden', 403);
});

// ─── POST /webhooks/meta — Lead Ads + Messaging events ───────────────

app.post('/webhooks/meta', async (c) => {
  try {
    const rawBody = await c.req.text();
    const sig = c.req.header('X-Hub-Signature-256') || c.req.header('x-hub-signature-256');
    if (!(await verifyMetaSignature(rawBody, sig))) {
      console.warn('[META] Invalid webhook signature');
      // Still 200 so Meta doesn't disable our webhook on dev-secret mismatch
      return c.json({ ok: false, error: 'invalid_signature' }, 200);
    }

    const payload = JSON.parse(rawBody);
    const objectType = payload.object;  // 'page' | 'instagram'

    for (const entry of (payload.entry || [])) {
      const pageId = entry.id;

      // Lead Ads
      for (const change of (entry.changes || [])) {
        if (change.field === 'leadgen') {
          handleLeadgenEvent(pageId, change.value).catch((e) =>
            console.warn('[META] leadgen handler error:', e?.message),
          );
        }
      }

      // Messaging (FB Messenger + Instagram DMs)
      for (const msg of (entry.messaging || [])) {
        handleMessagingEvent(objectType, pageId, msg).catch((e) =>
          console.warn('[META] messaging handler error:', e?.message),
        );
      }
    }

    // Always 200 quickly — Meta retries aggressively on 5xx
    return c.json({ ok: true });
  } catch (e: any) {
    console.error('[META] webhook error:', e?.message);
    return c.json({ ok: false }, 200);
  }
});

// ─── Lead Ads handler ────────────────────────────────────────────────

async function handleLeadgenEvent(pageId: string, value: any): Promise<void> {
  const leadgenId = value?.leadgen_id;
  const formId = value?.form_id;
  if (!leadgenId) return;

  // Resolve owner user
  const userMap: any = await kv.get(`meta:page:${pageId}`);
  const userId = userMap?.user_id;
  if (!userId) {
    console.warn(`[META] No Contndr user linked to page ${pageId}, skipping leadgen ${leadgenId}`);
    return;
  }
  const pageAccessToken = userMap?.access_token;
  if (!pageAccessToken) {
    console.warn(`[META] No access token for page ${pageId}, cannot fetch leadgen ${leadgenId}`);
    return;
  }

  // Fetch full lead detail via Graph API
  let leadDetail: any = null;
  try {
    const res = await fetch(`${META_GRAPH_BASE}/${leadgenId}?access_token=${pageAccessToken}`);
    if (!res.ok) {
      console.warn(`[META] Graph leadgen fetch failed: ${res.status} ${await res.text()}`);
      return;
    }
    leadDetail = await res.json();
  } catch (e: any) {
    console.warn('[META] Graph leadgen fetch error:', e?.message);
    return;
  }

  // Field data is an array of { name, values }
  const fields: Record<string, string> = {};
  for (const f of (leadDetail.field_data || [])) {
    fields[(f.name || '').toLowerCase()] = (f.values && f.values[0]) || '';
  }

  const email = fields['email'] || fields['email address'] || '';
  const fullName = fields['full_name'] || fields['name'] || [fields['first_name'], fields['last_name']].filter(Boolean).join(' ');
  const phone = fields['phone_number'] || fields['phone'] || '';
  const company = fields['company'] || fields['company_name'] || '';
  const jobTitle = fields['job_title'] || fields['title'] || '';

  // Route through the shared importer so the lead gets cross-channel
  // de-duped (e.g. same email previously DMed → merges into existing).
  let leadId = '';
  try {
    const { upsertImportedLead } = await import('./lead-import-helpers.tsx');
    const result = await upsertImportedLead({
      user_id: userId,
      source: 'meta_lead_ad',
      external_id: leadgenId,
      email,
      phone,
      contact_name: fullName,
      business_name: company,
      job_title: jobTitle,
      raw: { form_id: formId, page_id: pageId, fields },
    });
    leadId = result.lead_id;
    if (result.skipped_reason) {
      console.warn(`[META] lead ad ${leadgenId} dropped: ${result.skipped_reason}`);
      return;
    }
    console.log(`[META] ✅ Lead ${result.created ? 'created' : 'merged'} from Meta lead ad: ${leadId} (${email || 'no email'})`);
  } catch (e: any) {
    console.warn('[META] lead upsert error:', e?.message);
    return;
  }

  // Native push so the user knows a new lead landed
  try {
    const { sendNativePush } = await import('./native-push.tsx');
    await sendNativePush(userId, {
      title: '🎯 New lead from Meta',
      body: `${fullName || email || 'New submission'}${company ? ` · ${company}` : ''}`,
      data: { type: 'lead_created', lead_id: leadId, source: 'meta_lead_ad' },
    });
  } catch (e: any) {
    console.warn('[META] native push error:', e?.message);
  }
}

// ─── Messaging handler (IG DM + FB Messenger) ────────────────────────

async function handleMessagingEvent(objectType: string, pageId: string, msg: any): Promise<void> {
  // We only care about inbound messages from the prospect (not echoes
  // of messages WE sent back). Meta marks echoes with is_echo=true.
  if (msg.message?.is_echo) return;
  const senderId = msg.sender?.id;
  const text = msg.message?.text;
  if (!senderId || !text) return;

  const userMap: any = await kv.get(`meta:page:${pageId}`);
  const userId = userMap?.user_id;
  if (!userId) {
    console.warn(`[META] No Contndr user linked to page ${pageId}, skipping message`);
    return;
  }

  const channel = objectType === 'instagram' ? 'instagram_dm' : 'messenger';
  const messageId = msg.message?.mid || `meta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ts = msg.timestamp || Date.now();

  // Resolve sender name via Graph API (best-effort)
  let senderName: string | null = null;
  try {
    if (userMap.access_token) {
      const res = await fetch(`${META_GRAPH_BASE}/${senderId}?fields=name&access_token=${userMap.access_token}`);
      if (res.ok) {
        const j = await res.json();
        senderName = j.name || null;
      }
    }
  } catch { /* non-fatal */ }

  const record = {
    id: messageId,
    direction: 'inbound' as const,
    user_id: userId,
    channel,
    page_id: pageId,
    sender_id: senderId,
    sender_name: senderName,
    text,
    received_at: new Date(ts).toISOString(),
  };
  await kv.set(`meta_message:${userId}:${senderId}:${ts}`, record);

  // First-message-creates-lead — same pattern as Telegram. The dedup
  // logic in lead-import-helpers will merge by external_id if the
  // same prospect DMs again (or if they were already imported via a
  // Lead Ad form using the same email).
  (async () => {
    try {
      const { upsertImportedLead } = await import('./lead-import-helpers.tsx');
      await upsertImportedLead({
        user_id: userId,
        source: channel === 'instagram_dm' ? 'meta_instagram_dm' : 'meta_messenger',
        external_id: senderId,
        contact_name: senderName,
        initial_message: text,
        raw: { page_id: pageId, sender_id: senderId },
      });
    } catch (e: any) {
      console.warn('[META] upsertImportedLead failed:', e?.message);
    }
  })();

  // Native push
  try {
    const { sendNativePush } = await import('./native-push.tsx');
    const channelEmoji = channel === 'instagram_dm' ? '📷' : '💬';
    await sendNativePush(userId, {
      title: `${channelEmoji} ${channel === 'instagram_dm' ? 'Instagram' : 'Messenger'} message`,
      body: `${senderName || senderId}: ${text.slice(0, 140)}`,
      data: { type: 'meta_message', channel, sender_id: senderId, message_id: messageId },
    });
  } catch (e: any) {
    console.warn('[META] native push error:', e?.message);
  }
}

// ─── Settings endpoints ──────────────────────────────────────────────

/**
 * POST /meta/connect — Save a Meta page connection for the authenticated user.
 *
 * Body: { page_id, page_name, access_token, channels: ['lead_ads', 'instagram_dm', 'messenger'] }
 *
 * Stores both a forward (user → pages) and reverse (page → user) mapping
 * so the webhook handler can route inbound events back to the right
 * Contndr account.
 */
app.post('/meta/connect', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { page_id, page_name, access_token: pageAccessToken, channels } = body;
    if (!page_id || !pageAccessToken) {
      return c.json({ error: 'page_id and access_token required' }, 400);
    }

    const payload = {
      user_id: user.id,
      page_id,
      page_name: page_name || null,
      access_token: pageAccessToken,
      channels: Array.isArray(channels) && channels.length ? channels : ['lead_ads', 'instagram_dm', 'messenger'],
      connected_at: new Date().toISOString(),
    };

    // Reverse map: page → user (webhook needs this)
    await kv.set(`meta:page:${page_id}`, payload);

    // Forward map: user → pages (settings UI needs this)
    const existing: any[] = (await kv.get(`meta:user:${user.id}:pages`)) || [];
    const filtered = existing.filter((p: any) => p.page_id !== page_id);
    filtered.push(payload);
    await kv.set(`meta:user:${user.id}:pages`, filtered);

    return c.json({ ok: true, page: { page_id, page_name, channels: payload.channels } });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

/** GET /meta/pages — List connected pages for the authenticated user */
app.get('/meta/pages', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const pages: any[] = (await kv.get(`meta:user:${user.id}:pages`)) || [];
    // Strip the access tokens before returning — caller doesn't need them
    return c.json({
      pages: pages.map((p) => ({ page_id: p.page_id, page_name: p.page_name, channels: p.channels, connected_at: p.connected_at })),
    });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

/** DELETE /meta/pages/:pageId — Disconnect a page */
app.delete('/meta/pages/:pageId', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const pageId = c.req.param('pageId');
    const existing: any[] = (await kv.get(`meta:user:${user.id}:pages`)) || [];
    const filtered = existing.filter((p: any) => p.page_id !== pageId);
    await kv.set(`meta:user:${user.id}:pages`, filtered);
    await kv.del(`meta:page:${pageId}`);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

/**
 * GET /meta/threads — list IG DM + Messenger threads
 */
app.get('/meta/threads', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const all = await kv.getByPrefixLimited(`meta_message:${user.id}:`, 2000, 0).catch(() => []);
    const byThread = new Map<string, any[]>();
    for (const row of (all as any[])) {
      if (!row || typeof row !== 'object') continue;
      const key = row.sender_id || row.recipient_id;
      if (!key) continue;
      const arr = byThread.get(key) || [];
      arr.push(row);
      byThread.set(key, arr);
    }

    const threads = Array.from(byThread.entries()).map(([senderId, msgs]) => {
      msgs.sort((a, b) => new Date(b.received_at || b.sent_at || 0).getTime() - new Date(a.received_at || a.sent_at || 0).getTime());
      const latest = msgs[0];
      const unread = msgs.filter((m: any) => m.direction === 'inbound' && !m.read).length;
      return {
        thread_key: senderId,
        sender_id: senderId,
        page_id: latest.page_id,
        channel: latest.channel,                          // 'instagram_dm' | 'messenger'
        sender_name: latest.sender_name || senderId,
        latest_text: (latest.text || '').slice(0, 140),
        latest_at: latest.received_at || latest.sent_at,
        latest_direction: latest.direction,
        message_count: msgs.length,
        unread_count: unread,
      };
    }).sort((a, b) => new Date(b.latest_at || 0).getTime() - new Date(a.latest_at || 0).getTime());

    return c.json({ threads });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

/** GET /meta/threads/:senderId — full conversation */
app.get('/meta/threads/:senderId', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const senderId = c.req.param('senderId');
    const rows = await kv.getByPrefixLimited(`meta_message:${user.id}:${senderId}:`, 1000, 0).catch(() => []);
    const messages = (rows as any[])
      .filter((r) => r && typeof r === 'object')
      .sort((a, b) => new Date(a.received_at || a.sent_at || 0).getTime() - new Date(b.received_at || b.sent_at || 0).getTime());
    return c.json({ messages });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

/**
 * POST /meta/send — send a reply via Meta Send API
 * Body: { page_id, sender_id, text, channel }
 */
app.post('/meta/send', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const { page_id, sender_id, text, channel } = await c.req.json();
    if (!page_id || !sender_id || !text) return c.json({ error: 'page_id, sender_id, text required' }, 400);

    const pageConfig: any = await kv.get(`meta:page:${page_id}`);
    if (!pageConfig || pageConfig.user_id !== user.id) {
      return c.json({ error: 'Page not connected to your account' }, 403);
    }

    const res = await fetch(`${META_GRAPH_BASE}/${page_id}/messages?access_token=${pageConfig.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: sender_id },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    });
    const j = await res.json();
    if (!res.ok || j.error) {
      return c.json({ ok: false, error: j.error?.message || 'Send failed' });
    }

    const ts = Date.now();
    const messageId = j.message_id || `meta_out_${ts}`;
    await kv.set(`meta_message:${user.id}:${sender_id}:${ts}`, {
      id: messageId,
      direction: 'outbound',
      user_id: user.id,
      channel: channel || pageConfig.channels?.[0] || 'messenger',
      page_id,
      recipient_id: sender_id,
      sender_id,                                          // keep this so thread grouping works
      text,
      sent_at: new Date(ts).toISOString(),
    });

    return c.json({ ok: true, message_id: messageId });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

export default app;
