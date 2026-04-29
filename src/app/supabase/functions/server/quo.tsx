/**
 * Quo (formerly OpenPhone) integration for internal Contndr sales team only.
 * This module is NOT exposed to public/customer users — gated by isInternalOrAdmin().
 * 
 * Quo API docs: https://www.openphone.com/docs/api (legacy branding)
 * Base URL: https://api.openphone.com/v1
 */

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import * as kv from './kv-retry.tsx';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const app = new Hono();

app.use('*', cors());

// ── Constants ──
// Telnyx API (powers the Quo dialer)
const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

// Internal emails that can use the dialer (admins + all @contndr.com sales reps)
const INTERNAL_ADMIN_EMAILS = ['or@contndr.com', 'or@roadr.com', 'admin@contndr.com'];

function isInternalOrAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return INTERNAL_ADMIN_EMAILS.includes(e) || e.endsWith('@contndr.com');
}

// ── Auth helper — returns { id, email } or null ──
async function getAuthUser(c: any): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "QUO");
    if (error || !user) return null;
    return { id: user.id, email: user.email || '' };
  } catch (_e) {
    return null;
  }
}

// ── Internal-only gate — extracts user AND enforces internal-only ──
async function requireInternalUser(c: any): Promise<{ id: string; email: string }> {
  const user = await getAuthUser(c);
  if (!user) {
    throw new Error('UNAUTHORIZED');
  }
  if (!isInternalOrAdmin(user.email)) {
    console.log('[QUO] Access denied for non-internal user:', user.email);
    throw new Error('FORBIDDEN');
  }
  return user;
}

// ── Phone number normalization to E.164 format ──
function normalizeToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  
  // Strip all non-digit characters except leading +
  let cleaned = phone.trim().replace(/[^\d+]/g, '');
  
  // If it already starts with +, return as-is (assume it's already E.164)
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // Remove any + that's not at the start
  cleaned = cleaned.replace(/\+/g, '');
  
  // If it's 10 digits, assume US and prepend +1
  if (cleaned.length === 10) {
    return '+1' + cleaned;
  }
  
  // If it's 11 digits and starts with 1, prepend +
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return '+' + cleaned;
  }
  
  // If it doesn't have a country code and isn't 10 digits, prepend + and hope for the best
  if (cleaned.length > 0 && !cleaned.startsWith('+')) {
    return '+' + cleaned;
  }
  
  return cleaned.length > 0 ? cleaned : null;
}

// ── Quo API helper ──
function getTelnyxApiKey(): string | null {
  return Deno.env.get('TELNYX_API_KEY') || Deno.env.get('QUO_API_KEY') || null;
}

function getTelnyxConnectionId(): string | null {
  return Deno.env.get('TELNYX_CONNECTION_ID') || null;
}

async function telnyxRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getTelnyxApiKey();
  if (!apiKey) {
    throw new Error('TELNYX_API_KEY not configured');
  }

  const url = `${TELNYX_API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Content-Type', 'application/json');

  return fetch(url, { ...options, headers });
}

// ── Global error handler ──
app.onError((err, c) => {
  console.error('[QUO] Route error:', err);
  if (err.message === 'UNAUTHORIZED') {
    return c.json({ error: 'Unauthorized — not authenticated' }, 401);
  }
  if (err.message === 'FORBIDDEN') {
    return c.json({ error: 'Quo dialer is restricted to internal Contndr team' }, 403);
  }
  return c.json({
    success: false,
    error: 'Internal server error',
    details: err.message
  }, 500);
});

// ──────────────────────────────────────────────
// GET /config — Check Quo API connection status
// ──────────────────────────────────────────────
app.get('/config', async (c) => {
  await requireInternalUser(c);

  try {
    const apiKey = getTelnyxApiKey();
    const connectionId = getTelnyxConnectionId();
    if (!apiKey) {
      return c.json({
        success: true,
        config: {
          api_key_configured: false,
          connection_id_configured: !!connectionId,
          status: 'not_configured'
        }
      });
    }

    // Verify key by fetching phone numbers
    try {
      const res = await telnyxRequest('/phone_numbers?page[size]=10');
      if (res.ok) {
        const data = await res.json();
        const numbers = data.data || [];
        return c.json({
          success: true,
          config: {
            api_key_configured: true,
            connection_id_configured: !!connectionId,
            status: 'active',
            phone_numbers_count: numbers.length
          }
        });
      } else {
        const errText = await res.text();
        console.log('[QUO] Telnyx config check failed:', errText);
        return c.json({
          success: true,
          config: {
            api_key_configured: true,
            connection_id_configured: !!connectionId,
            status: 'invalid_key'
          }
        });
      }
    } catch (_e) {
      return c.json({
        success: true,
        config: {
          api_key_configured: true,
          connection_id_configured: !!connectionId,
          status: 'error'
        }
      });
    }
  } catch (error: any) {
    console.error('[QUO] Config check error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// GET /phone-numbers — List Telnyx phone numbers
// ──────────────────────────────────────────────
app.get('/phone-numbers', async (c) => {
  await requireInternalUser(c);

  try {
    const res = await telnyxRequest('/phone_numbers?page[size]=50&filter[status]=active');
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(errBody || 'Telnyx API error: ' + res.status);
    }
    const data = await res.json();
    // Normalize Telnyx phone number objects to a consistent shape
    const numbers = (data.data || []).map((n: any) => ({
      id: n.id,
      phone_number: n.phone_number,
      phoneNumber: n.phone_number,
      formattedPhoneNumber: n.phone_number,
      name: n.connection_name || n.phone_number,
      connection_id: n.connection_id
    }));
    return c.json({ success: true, numbers });
  } catch (error: any) {
    console.error('[QUO] Error fetching phone numbers:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// POST /calls/initiate — Make an outbound call via Telnyx
// ──────────────────────────────────────────────
app.post('/calls/initiate', async (c) => {
  const user = await requireInternalUser(c);

  try {
    const body = await c.req.json();
    const { to_number, from_number_id, from_phone_number, lead_id, lead_name, business_name, rep_phone } = body;

    if (!to_number) {
      return c.json({
        success: false,
        error: 'to_number is required'
      }, 400);
    }

    // rep_phone is the sales rep's phone number to bridge the call to
    // If not provided, we'll create a call but it won't be bridged (silent call)

    const connectionId = getTelnyxConnectionId();
    if (!connectionId) {
      return c.json({
        success: false,
        error: 'TELNYX_CONNECTION_ID not configured — cannot place calls'
      }, 400);
    }

    // Determine the "from" phone number — prefer explicit phone number, fall back to looking up by ID
    let fromNumber = from_phone_number || null;
    if (!fromNumber && from_number_id) {
      // Try to look up the phone number from Telnyx by ID
      try {
        const lookupRes = await telnyxRequest(`/phone_numbers/${from_number_id}`);
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          fromNumber = lookupData.data?.phone_number || null;
        }
      } catch (_e) {
        console.log('[QUO] Could not look up from_number_id, using it as-is');
        fromNumber = from_number_id; // Might already be a phone number string
      }
    }

    if (!fromNumber) {
      return c.json({
        success: false,
        error: 'Could not determine a "from" phone number. Provide from_phone_number or a valid from_number_id.'
      }, 400);
    }

    // Normalize both phone numbers to E.164 format
    const normalizedFrom = normalizeToE164(fromNumber);
    const normalizedTo = normalizeToE164(to_number);
    const normalizedRep = rep_phone ? normalizeToE164(rep_phone) : null;

    if (!normalizedTo) {
      return c.json({
        success: false,
        error: 'Invalid "to" phone number format. Could not normalize to E.164.'
      }, 400);
    }

    if (!normalizedFrom) {
      return c.json({
        success: false,
        error: 'Invalid "from" phone number format. Could not normalize to E.164.'
      }, 400);
    }

    // Initiate call via Telnyx API with webhook URL for call control
    const webhookUrl = `https://${Deno.env.get('SUPABASE_URL')?.replace('https://', '')}/functions/v1/make-server-a8b2511f/quo/webhook`;
    
    console.log(`[QUO] Initiating Telnyx call: from=${normalizedFrom} to=${normalizedTo} rep=${normalizedRep || 'none'} connection_id=${connectionId}`);
    
    // Encode client state using native base64 encoding
    const clientStateObj = {
      lead_id,
      lead_name,
      business_name,
      rep_phone: normalizedRep,
      user_email: user.email,
      user_id: user.id
    };
    const clientStateBase64 = btoa(JSON.stringify(clientStateObj));
    
    const callPayload: any = {
      connection_id: connectionId,
      from: normalizedFrom,
      to: normalizedTo,
      answering_machine_detection: 'detect',
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: clientStateBase64
    };

    const res = await telnyxRequest('/calls', {
      method: 'POST',
      body: JSON.stringify(callPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[QUO] Telnyx call API error:', errText);
      throw new Error(errText || 'Failed to initiate call: ' + res.status);
    }

    const callData = await res.json();
    const telnyxCall = callData.data;

    // Store call record in KV
    const callId = 'quo_call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const callRecord = {
      id: callId,
      quo_call_id: telnyxCall?.call_control_id || telnyxCall?.id || null,
      lead_id: lead_id || null,
      lead_name: lead_name || null,
      business_name: business_name || null,
      from_number_id: from_number_id,
      from_phone_number: normalizedFrom,
      to_number: normalizedTo,
      status: 'initiated',
      initiated_by: user.email,
      initiated_by_id: user.id,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: '',
      outcome: null,
      duration_seconds: null
    };

    await kv.set('quo:call:' + callId, callRecord);

    // Also index by lead for quick lookup
    if (lead_id) {
      const existingIndex = (await kv.get('quo:lead-calls:' + lead_id)) || [];
      existingIndex.push(callId);
      await kv.set('quo:lead-calls:' + lead_id, existingIndex);
    }

    console.log('[QUO] Call initiated by ' + user.email + ' to ' + normalizedTo + ' (lead: ' + (lead_id || 'none') + ')');

    return c.json({ success: true, call: callRecord });
  } catch (error: any) {
    console.error('[QUO] Error initiating call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// POST /calls/:callId/ai-summary — Generate AI summary for a call
// ──────────────────────────────────────────────
app.post('/calls/:callId/ai-summary', async (c) => {
  const user = await requireInternalUser(c);

  try {
    const callId = c.req.param('callId');
    const body = await c.req.json();
    const { notes, outcome, duration_seconds, lead_name, business_name, to_number, previous_calls } = body;

    const aiKey = Deno.env.get('OPENAI_API_KEY');
    if (!aiKey) {
      return c.json({ success: false, error: 'OPENAI_API_KEY not configured' }, 500);
    }

    // Build context for the AI
    const durationStr = duration_seconds ? `${Math.floor(duration_seconds / 60)}m ${duration_seconds % 60}s` : 'unknown';
    const prevCallsSummary = (previous_calls || []).slice(0, 5).map((pc: any) =>
      `- ${pc.outcome || 'unknown'} (${pc.duration_seconds ? Math.floor(pc.duration_seconds / 60) + 'm' : '?'}) — ${pc.notes || 'no notes'}`
    ).join('\n');

    const prompt = `You are an AI sales assistant analyzing a cold outreach call for a B2B sales team. Generate a structured call summary.

CALL DETAILS:
- Lead: ${lead_name || 'Unknown'}
- Company: ${business_name || 'Unknown'}
- Phone: ${to_number || 'Unknown'}
- Duration: ${durationStr}
- Outcome: ${outcome || 'unknown'}
- Rep notes: ${notes || 'No notes provided'}
- Rep: ${user.email}
${prevCallsSummary ? `\nPREVIOUS CALLS WITH THIS LEAD:\n${prevCallsSummary}` : ''}

Respond in JSON format only:
{
  "summary": "1-2 sentence professional summary of the call",
  "sentiment": "positive" | "neutral" | "negative",
  "interest_level": "high" | "medium" | "low" | "none",
  "action_items": ["specific action item 1", "action item 2"],
  "suggested_follow_up": "specific follow-up recommendation with timing",
  "key_objections": ["objection if any"],
  "deal_probability": 0-100,
  "tags": ["relevant", "tags"]
}`;

    const { generateAI } = await import("./ai-provider.tsx");
    let aiSummary: any;
    try {
      const aiResult = await generateAI({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
        jsonMode: true,
      });
      const content = aiResult.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      aiSummary = JSON.parse(content);
    } catch (aiErr: any) {
      console.error('[QUO AI] AI generation error:', aiErr.message);
      return c.json({ success: false, error: 'AI generation failed' }, 500);
    }

    // Update the call record with AI data if callId is provided and exists
    if (callId && callId !== 'preview') {
      const existingCall = await kv.get('quo:call:' + callId);
      if (existingCall) {
        const updated = {
          ...existingCall,
          ai_summary: aiSummary,
          ai_generated_at: new Date().toISOString(),
          notes: notes || existingCall.notes,
          outcome: outcome || existingCall.outcome,
          updated_at: new Date().toISOString(),
        };
        await kv.set('quo:call:' + callId, updated);
        console.log('[QUO AI] Call ' + callId + ' updated with AI summary');
      }
    }

    return c.json({ success: true, ai_summary: aiSummary });
  } catch (error: any) {
    console.error('[QUO AI] Error generating summary:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// PATCH /calls/:callId — Update a call record (outcome, notes, etc.)
// ──────────────────────────────────────────────
app.patch('/calls/:callId', async (c) => {
  const user = await requireInternalUser(c);

  try {
    const callId = c.req.param('callId');
    const body = await c.req.json();
    const existing = await kv.get('quo:call:' + callId);
    if (!existing) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }

    const updated = {
      ...existing,
      ...body,
      updated_at: new Date().toISOString(),
    };
    // Don't allow overwriting core fields
    updated.id = existing.id;
    updated.initiated_by = existing.initiated_by;
    updated.initiated_by_id = existing.initiated_by_id;
    updated.lead_id = existing.lead_id;

    await kv.set('quo:call:' + callId, updated);
    console.log('[QUO] Call ' + callId + ' updated by ' + user.email);
    return c.json({ success: true, call: updated });
  } catch (error: any) {
    console.error('[QUO] Error updating call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// POST /calls/log — Log call outcome/notes
// ──────────────────────────────────────────────
app.post('/calls/log', async (c) => {
  await requireInternalUser(c);

  try {
    const body = await c.req.json();
    const { call_id, notes, outcome, duration_seconds } = body;

    const existing = await kv.get('quo:call:' + call_id);
    if (!existing) {
      return c.json({ success: false, error: 'Call record not found' }, 404);
    }

    const updated = {
      ...existing,
      notes: notes || existing.notes,
      outcome: outcome || existing.outcome,
      duration_seconds: duration_seconds !== undefined ? duration_seconds : existing.duration_seconds,
      status: outcome ? 'completed' : existing.status,
      updated_at: new Date().toISOString()
    };

    await kv.set('quo:call:' + call_id, updated);

    console.log('[QUO] Call ' + call_id + ' logged — outcome: ' + outcome);

    return c.json({ success: true, call: updated });
  } catch (error: any) {
    console.error('[QUO] Error logging call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// POST /calls/manual-log — Log a call that happened outside the system
// ──────────────────────────────────────────────
app.post('/calls/manual-log', async (c) => {
  const user = await requireInternalUser(c);

  try {
    const body = await c.req.json();
    const { lead_id, lead_name, business_name, to_number, notes, outcome, duration_seconds } = body;

    if (!lead_id) {
      return c.json({ success: false, error: 'lead_id is required' }, 400);
    }

    const callId = 'quo_manual_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const callRecord = {
      id: callId,
      quo_call_id: null,
      lead_id: lead_id,
      lead_name: lead_name || null,
      business_name: business_name || null,
      from_number_id: null,
      to_number: to_number || null,
      status: 'completed',
      initiated_by: user.email,
      initiated_by_id: user.id,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: notes || '',
      outcome: outcome || 'completed',
      duration_seconds: duration_seconds || null,
      manual: true
    };

    await kv.set('quo:call:' + callId, callRecord);

    // Index by lead
    const existingIndex = (await kv.get('quo:lead-calls:' + lead_id)) || [];
    existingIndex.push(callId);
    await kv.set('quo:lead-calls:' + lead_id, existingIndex);

    console.log('[QUO] Manual call logged by ' + user.email + ' for lead ' + lead_id);

    return c.json({ success: true, call: callRecord });
  } catch (error: any) {
    console.error('[QUO] Error logging manual call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// GET /calls/history — Get call history (optionally filtered by lead_id)
// ──────────────────────────────────────────────
app.get('/calls/history', async (c) => {
  await requireInternalUser(c);

  try {
    const leadId = c.req.query('lead_id');

    if (leadId) {
      // Get calls for a specific lead
      const callIds = (await kv.get('quo:lead-calls:' + leadId)) || [];
      if (callIds.length === 0) {
        return c.json({ success: true, calls: [], total: 0 });
      }
      const keys = callIds.map(function(id: string) { return 'quo:call:' + id; });
      const calls = await kv.mget(keys);
      const validCalls = calls
        .filter(function(item: any) { return item !== null && item !== undefined; })
        .sort(function(a: any, b: any) { return new Date(b.started_at).getTime() - new Date(a.started_at).getTime(); });
      return c.json({ success: true, calls: validCalls, total: validCalls.length });
    }

    // Get all calls (most recent first)
    const allCalls = await kv.getByPrefix('quo:call:');
    const sorted = allCalls
      .filter(function(item: any) { return item && typeof item === 'object' && item.started_at; })
      .sort(function(a: any, b: any) { return new Date(b.started_at).getTime() - new Date(a.started_at).getTime(); })
      .slice(0, 100); // Last 100 calls

    return c.json({ success: true, calls: sorted, total: sorted.length });
  } catch (error: any) {
    console.error('[QUO] Error fetching call history:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// GET /calls/:id — Get a single call record
// ──────────────────────────────────────────────
app.get('/calls/:id', async (c) => {
  await requireInternalUser(c);

  try {
    const callId = c.req.param('id');
    const call = await kv.get('quo:call:' + callId);
    if (!call) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }
    return c.json({ success: true, call: call });
  } catch (error: any) {
    console.error('[QUO] Error fetching call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// DELETE /calls/:id — Delete a call record
// ──────────────────────────────────────────────
app.delete('/calls/:id', async (c) => {
  await requireInternalUser(c);

  try {
    const callId = c.req.param('id');
    const call = await kv.get('quo:call:' + callId);
    if (!call) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }

    // Remove from lead index
    if (call.lead_id) {
      const idx = (await kv.get('quo:lead-calls:' + call.lead_id)) || [];
      const filtered = idx.filter(function(id: string) { return id !== callId; });
      await kv.set('quo:lead-calls:' + call.lead_id, filtered);
    }

    await kv.del('quo:call:' + callId);
    console.log('[QUO] Call ' + callId + ' deleted');
    return c.json({ success: true });
  } catch (error: any) {
    console.error('[QUO] Error deleting call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// GET /stats — Get calling stats for the team
// ──────────────────────────────────────────────
app.get('/stats', async (c) => {
  await requireInternalUser(c);

  try {
    const allCalls = await kv.getByPrefix('quo:call:');
    const valid = allCalls.filter(function(item: any) { return item && typeof item === 'object'; });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

    const todayCalls = valid.filter(function(item: any) { return item.started_at >= todayStart; });
    const weekCalls = valid.filter(function(item: any) { return item.started_at >= weekStart; });

    // Outcome breakdown
    const outcomes: Record<string, number> = {};
    valid.forEach(function(item: any) {
      const o = item.outcome || 'unknown';
      outcomes[o] = (outcomes[o] || 0) + 1;
    });

    // Per-rep breakdown
    const byRep: Record<string, number> = {};
    valid.forEach(function(item: any) {
      const rep = item.initiated_by || 'unknown';
      byRep[rep] = (byRep[rep] || 0) + 1;
    });

    return c.json({
      success: true,
      stats: {
        total_calls: valid.length,
        today_calls: todayCalls.length,
        week_calls: weekCalls.length,
        outcomes: outcomes,
        by_rep: byRep
      }
    });
  } catch (error: any) {
    console.error('[QUO] Error fetching stats:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// POST /webhook — Handle Telnyx call control webhooks
// ──────────────────────────────────────────────
app.post('/webhook', async (c) => {
  try {
    const payload = await c.req.json();
    const event = payload.data;
    const eventType = event?.event_type || payload.event_type;
    
    console.log(`[QUO] Webhook received: ${eventType}`);

    // Decode client_state if present
    let clientState: any = {};
    if (event?.payload?.client_state) {
      try {
        clientState = JSON.parse(atob(event.payload.client_state));
      } catch (e) {
        console.log('[QUO] Could not decode client_state');
      }
    }

    const callControlId = event?.payload?.call_control_id || event?.call_control_id;

    // Handle call answered event - bridge to sales rep if phone provided
    if (eventType === 'call.answered' && clientState.rep_phone) {
      console.log(`[QUO] Call answered, bridging to rep: ${clientState.rep_phone}`);
      
      try {
        // Transfer/bridge the call to the sales rep
        const transferRes = await telnyxRequest(`/calls/${callControlId}/actions/transfer`, {
          method: 'POST',
          body: JSON.stringify({
            to: clientState.rep_phone,
            from: event?.payload?.from || event?.from
          })
        });

        if (!transferRes.ok) {
          const errText = await transferRes.text();
          console.error('[QUO] Transfer failed:', errText);
        } else {
          console.log('[QUO] Successfully transferred call to rep');
        }
      } catch (err: any) {
        console.error('[QUO] Error transferring call:', err.message);
      }
    }

    // Handle other call events for logging
    if (eventType === 'call.hangup') {
      console.log('[QUO] Call ended');
      // You could update call records here based on client_state
    }

    if (eventType === 'call.machine.detection.ended') {
      const detectionResult = event?.payload?.machine_detection_result;
      console.log(`[QUO] Machine detection: ${detectionResult}`);
    }

    return c.json({ received: true });
  } catch (error: any) {
    console.error('[QUO] Webhook error:', error);
    return c.json({ received: true, error: error.message });
  }
});

export default app;