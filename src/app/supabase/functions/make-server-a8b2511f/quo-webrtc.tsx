/**
 * WebRTC credential + token generation for native browser calling via Telnyx.
 * Creates per-user Telephony Credentials, caches them in KV, and issues
 * short-lived JWT tokens that the frontend TelnyxRTC SDK consumes.
 *
 * Flow:
 *   1. POST /token  →  resolves a valid Credential Connection (auto-discover/create)
 *   2. Finds-or-creates a Telephony Credential for the user
 *   3. Generates a fresh JWT from Telnyx  →  returns { token, credential_id }
 *   4. Frontend does  new TelnyxRTC({ login_token: token })
 *
 * The TELNYX_CONNECTION_ID env var may point to ANY connection type (Call Control,
 * TeXML, Credential, etc.). If it isn't a Credential Connection this module will
 * automatically search for (or create) one so WebRTC always works.
 */

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import * as kv from './kv-retry.tsx';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const app = new Hono();

app.use('*', cors());

// ── Constants ──
const TELNYX_API_BASE = 'https://api.telnyx.com/v2';
const CREDENTIAL_CONN_KV_KEY = 'quo:webrtc-credential-connection';

const INTERNAL_ADMIN_EMAILS = ['or@contndr.com', 'or@roadr.com', 'admin@contndr.com'];

function isInternalOrAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return INTERNAL_ADMIN_EMAILS.includes(e) || e.endsWith('@contndr.com');
}

// ── Auth helper ──
async function getAuthUser(c: any): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "QUO-WEBRTC");
    if (error || !user) return null;
    return { id: user.id, email: user.email || '' };
  } catch (_e) {
    return null;
  }
}

async function requireInternalUser(c: any): Promise<{ id: string; email: string }> {
  const user = await getAuthUser(c);
  if (!user) throw new Error('UNAUTHORIZED');
  if (!isInternalOrAdmin(user.email)) {
    console.log('[QUO-WEBRTC] Access denied for non-internal user:', user.email);
    throw new Error('FORBIDDEN');
  }
  return user;
}

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
  if (!apiKey) throw new Error('TELNYX_API_KEY not configured');
  const url = `${TELNYX_API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Content-Type', 'application/json');
  return fetch(url, { ...options, headers });
}

// ──────────────────────────────────────────────────────────────
// Resolve a valid Credential Connection ID for WebRTC.
//
// Strategy:
//   1. Check KV cache for a previously resolved credential connection
//   2. Try the TELNYX_CONNECTION_ID env var – verify it's a credential type
//   3. List all credential connections on the account and pick the first one
//   4. If none exist, create one named "Contndr WebRTC"
// ──────────────────────────────────────────────────────────────
async function resolveCredentialConnectionId(): Promise<string> {
  // 1. Check KV cache
  const cached = await kv.get(CREDENTIAL_CONN_KV_KEY);
  if (cached && cached.connection_id) {
    // Quick-verify it still exists
    try {
      const verifyRes = await telnyxRequest(`/credential_connections/${cached.connection_id}`);
      if (verifyRes.ok) {
        console.log(`[QUO-WEBRTC] Using cached credential connection: ${cached.connection_id}`);
        return cached.connection_id;
      }
    } catch (_e) { /* will re-discover */ }
    console.log('[QUO-WEBRTC] Cached credential connection no longer valid, re-discovering...');
  }

  // 2. Try the env var – check if it points to a credential connection
  const envConnId = getTelnyxConnectionId();
  if (envConnId) {
    try {
      const checkRes = await telnyxRequest(`/credential_connections/${envConnId}`);
      if (checkRes.ok) {
        console.log(`[QUO-WEBRTC] TELNYX_CONNECTION_ID ${envConnId} is a valid credential connection`);
        await kv.set(CREDENTIAL_CONN_KV_KEY, { connection_id: envConnId, resolved_at: new Date().toISOString() });
        return envConnId;
      }
    } catch (_e) { /* not a credential connection */ }
    console.log(`[QUO-WEBRTC] TELNYX_CONNECTION_ID ${envConnId} is not a credential connection, searching for one...`);
  }

  // 3. List existing credential connections
  try {
    const listRes = await telnyxRequest('/credential_connections?page[size]=25');
    if (listRes.ok) {
      const listData = await listRes.json();
      const connections = listData.data || [];
      if (connections.length > 0) {
        // Prefer one that's active, fallback to first
        const active = connections.find((c: any) => c.active === true) || connections[0];
        const foundId = active.id;
        console.log(`[QUO-WEBRTC] Found existing credential connection: ${foundId} (${active.connection_name || 'unnamed'})`);
        await kv.set(CREDENTIAL_CONN_KV_KEY, { connection_id: foundId, resolved_at: new Date().toISOString() });
        return foundId;
      }
    }
  } catch (e: any) {
    console.log('[QUO-WEBRTC] Error listing credential connections:', e.message);
  }

  // 4. Create a new credential connection
  console.log('[QUO-WEBRTC] No credential connection found, creating one...');
  const createRes = await telnyxRequest('/credential_connections', {
    method: 'POST',
    body: JSON.stringify({
      connection_name: 'Contndr WebRTC',
      active: true,
      // Default to WebRTC-friendly settings
      webrtc_enabled: true,
    })
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error('[QUO-WEBRTC] Failed to create credential connection:', errText);
    throw new Error(
      'Cannot resolve a Credential Connection for WebRTC. ' +
      'TELNYX_CONNECTION_ID points to a non-credential connection and auto-creation failed: ' + errText
    );
  }

  const createData = await createRes.json();
  const newId = createData.data?.id;
  if (!newId) {
    throw new Error('Telnyx returned no ID for newly created credential connection');
  }

  console.log(`[QUO-WEBRTC] Created new credential connection: ${newId}`);
  await kv.set(CREDENTIAL_CONN_KV_KEY, { connection_id: newId, resolved_at: new Date().toISOString() });
  return newId;
}

// ── Error handler ──
app.onError((err, c) => {
  console.error('[QUO-WEBRTC] Route error:', err);
  if (err.message === 'UNAUTHORIZED') {
    return c.json({ error: 'Unauthorized — not authenticated' }, 401);
  }
  if (err.message === 'FORBIDDEN') {
    return c.json({ error: 'WebRTC dialer is restricted to internal Contndr team' }, 403);
  }
  return c.json({ success: false, error: 'Internal server error', details: err.message }, 500);
});

// ──────────────────────────────────────────────
// POST /token — Get a fresh WebRTC login token
//   Resolves a Credential Connection, finds or creates a Telephony
//   Credential for this user, then generates a short-lived JWT.
// ──────────────────────────────────────────────
app.post('/token', async (c) => {
  const user = await requireInternalUser(c);

  try {
    // Resolve a working credential connection (auto-discover/create)
    const connectionId = await resolveCredentialConnectionId();

    // Check KV for an existing credential for this user
    const kvKey = `quo:webrtc-cred:${user.id}`;
    let credentialId: string | null = null;
    const cached = await kv.get(kvKey);

    if (cached && cached.credential_id) {
      // Verify credential still exists on Telnyx
      try {
        const checkRes = await telnyxRequest(`/telephony_credentials/${cached.credential_id}`);
        if (checkRes.ok) {
          credentialId = cached.credential_id;
          console.log(`[QUO-WEBRTC] Reusing cached credential ${credentialId} for ${user.email}`);
        } else {
          console.log(`[QUO-WEBRTC] Cached credential ${cached.credential_id} no longer valid, will recreate`);
        }
      } catch (_e) {
        console.log('[QUO-WEBRTC] Error checking cached credential, will recreate');
      }
    }

    // Create a new credential if we don't have one
    if (!credentialId) {
      const sipUser = `contndr_${user.id.replace(/-/g, '').substring(0, 12)}`;
      const sipPass = generateSecurePassword(24);

      const createRes = await telnyxRequest('/telephony_credentials', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: connectionId,
          name: `Contndr WebRTC – ${user.email}`,
          sip_username: sipUser,
          sip_password: sipPass,
        })
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error('[QUO-WEBRTC] Failed to create credential:', errText);

        // If it's an "invalid connection" error, clear cached connection so next
        // attempt re-discovers a valid one
        if (errText.includes('invalid connection')) {
          console.log('[QUO-WEBRTC] Clearing cached credential connection due to invalid connection error');
          await kv.del(CREDENTIAL_CONN_KV_KEY);
        }

        throw new Error('Failed to create telephony credential: ' + errText);
      }

      const createData = await createRes.json();
      credentialId = createData.data?.id;

      if (!credentialId) {
        throw new Error('Telnyx returned no credential ID');
      }

      // Cache it
      await kv.set(kvKey, {
        credential_id: credentialId,
        connection_id: connectionId,
        sip_username: sipUser,
        created_at: new Date().toISOString(),
        user_email: user.email
      });

      console.log(`[QUO-WEBRTC] Created new credential ${credentialId} for ${user.email}`);
    }

    // Generate a JWT token from the credential
    const tokenRes = await telnyxRequest(`/telephony_credentials/${credentialId}/token`, {
      method: 'POST'
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[QUO-WEBRTC] Failed to generate token:', errText);

      // If the credential is broken, clear cache so next attempt creates a new one
      await kv.del(kvKey);
      throw new Error('Failed to generate WebRTC token: ' + errText);
    }

    // Telnyx returns the raw JWT as text (not JSON)
    const contentType = tokenRes.headers.get('content-type') || '';
    let token: string;
    if (contentType.includes('application/json')) {
      const tokenData = await tokenRes.json();
      token = tokenData.data || tokenData.token || tokenData;
    } else {
      token = await tokenRes.text();
    }

    if (!token || typeof token !== 'string' || token.length < 20) {
      await kv.del(kvKey);
      throw new Error('Invalid token received from Telnyx');
    }

    console.log(`[QUO-WEBRTC] Token generated for ${user.email} (credential: ${credentialId}, connection: ${connectionId})`);

    return c.json({
      success: true,
      token,
      credential_id: credentialId,
      connection_id: connectionId
    });
  } catch (error: any) {
    console.error('[QUO-WEBRTC] Error generating token:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ──────────────────────────────────────────────
// GET /status — Quick health-check
// ──────────────────────────────────────────────
app.get('/status', async (c) => {
  await requireInternalUser(c);

  const apiKey = getTelnyxApiKey();
  const connectionId = getTelnyxConnectionId();

  // Also report whether we have a resolved credential connection
  let resolvedConnection: string | null = null;
  try {
    const cached = await kv.get(CREDENTIAL_CONN_KV_KEY);
    resolvedConnection = cached?.connection_id || null;
  } catch (_e) { /* ignore */ }

  return c.json({
    success: true,
    webrtc_available: !!apiKey,
    api_key_configured: !!apiKey,
    env_connection_id: connectionId || null,
    resolved_credential_connection: resolvedConnection,
  });
});

// ──────────────────────────────────────────────
// POST /reset — Clear cached connections & credentials (admin debug)
// ──────────────────────────────────────────────
app.post('/reset', async (c) => {
  const user = await requireInternalUser(c);
  console.log(`[QUO-WEBRTC] Reset requested by ${user.email}`);

  // Clear the credential connection cache
  await kv.del(CREDENTIAL_CONN_KV_KEY);

  // Clear this user's credential cache
  await kv.del(`quo:webrtc-cred:${user.id}`);

  return c.json({ success: true, message: 'WebRTC caches cleared. Next call will re-discover connection and create new credentials.' });
});

// ── Helper: Generate secure random password ──
function generateSecurePassword(length: number): string {
  // Avoid special chars that may break SIP auth
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }
  return password;
}

export default app;
