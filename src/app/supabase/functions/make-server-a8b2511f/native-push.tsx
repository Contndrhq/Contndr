/**
 * Native Push — APNs (iOS) + FCM (Android) sender + device-token store.
 *
 * The frontend already wires a Capacitor `@capacitor/push-notifications`
 * scaffold (src/app/lib/nativePush.ts) that registers for permission,
 * receives a device token from APNs/FCM on the user's device, and POSTs
 * it to `/devices/register`. This module:
 *
 *  1. Stores each token under `device_token:<userId>:<token>` in KV so
 *     a single user can have multiple devices (phone + iPad + Android)
 *     all receiving pushes.
 *  2. Exposes `sendNativePush(userId, payload)` that fans out to every
 *     registered token for that user, calling APNs or FCM based on the
 *     stored `platform` field.
 *  3. Fail-safe: if no APNs/FCM credentials are configured in env, the
 *     sender silently no-ops. Web push (browser Notification API) keeps
 *     working independently — native is purely additive.
 *
 * Required environment variables (set in Supabase Edge Function secrets):
 *
 *   APNS_KEY_ID         — 10-character Key ID from Apple Developer portal
 *   APNS_TEAM_ID        — 10-character Team ID from Apple Developer
 *   APNS_BUNDLE_ID      — the app's bundle identifier (e.g. com.contndr.app)
 *   APNS_PRIVATE_KEY    — full PEM contents of the .p8 file
 *   APNS_PRODUCTION     — "1" for production APNs, anything else = sandbox
 *
 *   FCM_PROJECT_ID      — Firebase project ID (Android)
 *   FCM_SERVICE_ACCOUNT_JSON — full JSON of the service account key
 *
 * Without these, native push is disabled; the rest of the app is
 * unaffected.
 */

import * as kv from './kv-retry.tsx';

// ─── Device token records ────────────────────────────────────────────

export interface DeviceTokenRecord {
  user_id: string;
  device_token: string;
  platform: 'ios' | 'android' | 'unknown';
  env?: 'production' | 'sandbox';
  registered_at: string;
  last_seen_at: string;
}

function deviceKey(userId: string, token: string) {
  return `device_token:${userId}:${token}`;
}

function devicePrefix(userId: string) {
  return `device_token:${userId}:`;
}

/**
 * Persist a device token. Idempotent — re-registering the same token
 * just bumps `last_seen_at`. Tokens have no expiry on our side; we
 * prune ones APNs/FCM reports as invalid on send (see sendNativePush).
 */
export async function registerDeviceToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android' | 'unknown' = 'unknown',
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await kv.get(deviceKey(userId, token)).catch(() => null);
  const record: DeviceTokenRecord = {
    user_id: userId,
    device_token: token,
    platform,
    env: platform === 'ios' && Deno.env.get('APNS_PRODUCTION') === '1' ? 'production' : 'sandbox',
    registered_at: (existing as DeviceTokenRecord | null)?.registered_at || now,
    last_seen_at: now,
  };
  await kv.set(deviceKey(userId, token), record);
}

export async function unregisterDeviceToken(userId: string, token: string): Promise<void> {
  try { await kv.del(deviceKey(userId, token)); } catch { /* best-effort */ }
}

async function listDeviceTokens(userId: string): Promise<DeviceTokenRecord[]> {
  try {
    const rows = await kv.getByPrefixLimited(devicePrefix(userId), 50, 0);
    return (rows as any[]).filter((r) => r && r.device_token) as DeviceTokenRecord[];
  } catch {
    return [];
  }
}

// ─── APNs — JWT + HTTP/2 ─────────────────────────────────────────────
// Apple requires a short-lived ES256 JWT signed with the .p8 private
// key. The JWT lasts up to 1 hour; we cache it in-process so we don't
// re-sign on every push.

let apnsJwtCache: { token: string; expiresAt: number } | null = null;

async function getApnsJwt(): Promise<string | null> {
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  const privateKeyPem = Deno.env.get('APNS_PRIVATE_KEY');
  if (!keyId || !teamId || !privateKeyPem) return null;

  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache && apnsJwtCache.expiresAt > now + 60) {
    return apnsJwtCache.token;
  }

  try {
    // Strip PEM header/footer and any whitespace
    const pemBody = privateKeyPem
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      der.buffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );

    const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
    const payload = { iss: teamId, iat: now };
    const b64url = (s: string) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      new TextEncoder().encode(unsigned),
    );
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const token = `${unsigned}.${sigB64}`;
    apnsJwtCache = { token, expiresAt: now + 50 * 60 }; // refresh 10 min before expiry
    return token;
  } catch (err) {
    console.warn('[NATIVE-PUSH] APNs JWT signing failed:', (err as any)?.message || err);
    return null;
  }
}

/**
 * Send one APNs push. Returns { ok, status, reason } so the caller
 * can prune invalid tokens on `BadDeviceToken` / `Unregistered`.
 */
async function sendApns(deviceToken: string, payload: PushPayload): Promise<{ ok: boolean; status: number; reason?: string }> {
  const jwt = await getApnsJwt();
  const bundleId = Deno.env.get('APNS_BUNDLE_ID');
  if (!jwt || !bundleId) return { ok: false, status: 0, reason: 'APNS not configured' };

  const host = Deno.env.get('APNS_PRODUCTION') === '1'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
  const url = `${host}/3/device/${deviceToken}`;

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      badge: payload.badge,
    },
    // Custom data — handed to the JS push handler when the user taps the
    // notification. Lead URL, deal ID, etc.
    ...(payload.data || {}),
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body,
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => '');
    let reason: string | undefined;
    try { reason = JSON.parse(text)?.reason; } catch { reason = text; }
    return { ok: false, status: res.status, reason };
  } catch (err: any) {
    return { ok: false, status: 0, reason: err?.message };
  }
}

// ─── FCM — service-account OAuth + v1 send API ────────────────────────

let fcmTokenCache: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(): Promise<{ token: string; projectId: string } | null> {
  const saRaw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  const projectId = Deno.env.get('FCM_PROJECT_ID');
  if (!saRaw || !projectId) return null;

  const now = Math.floor(Date.now() / 1000);
  if (fcmTokenCache && fcmTokenCache.expiresAt > now + 60) {
    return { token: fcmTokenCache.token, projectId };
  }

  try {
    const sa = JSON.parse(saRaw);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };
    const b64url = (s: string) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

    // Import the RSA private key from the service account
    const pemBody = sa.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'pkcs8', der.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign'],
    );
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const assertion = `${unsigned}.${sigB64}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
    });
    if (!tokenRes.ok) {
      console.warn('[NATIVE-PUSH] FCM token exchange failed:', tokenRes.status);
      return null;
    }
    const j = await tokenRes.json();
    fcmTokenCache = { token: j.access_token, expiresAt: now + (j.expires_in || 3600) - 60 };
    return { token: j.access_token, projectId };
  } catch (err) {
    console.warn('[NATIVE-PUSH] FCM auth failed:', (err as any)?.message || err);
    return null;
  }
}

async function sendFcm(deviceToken: string, payload: PushPayload): Promise<{ ok: boolean; status: number; reason?: string }> {
  const cred = await getFcmAccessToken();
  if (!cred) return { ok: false, status: 0, reason: 'FCM not configured' };

  const url = `https://fcm.googleapis.com/v1/projects/${cred.projectId}/messages:send`;
  const body = JSON.stringify({
    message: {
      token: deviceToken,
      notification: { title: payload.title, body: payload.body },
      data: Object.fromEntries(
        Object.entries(payload.data || {}).map(([k, v]) => [k, String(v ?? '')]),
      ),
    },
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.token}`, 'content-type': 'application/json' },
      body,
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, reason: text.slice(0, 200) };
  } catch (err: any) {
    return { ok: false, status: 0, reason: err?.message };
  }
}

// ─── Public sender ────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  badge?: number;
  data?: Record<string, any>;
}

/**
 * Send a native push to every registered device for `userId`. Prunes
 * invalid tokens (BadDeviceToken / Unregistered / NOT_FOUND) so dead
 * devices don't accumulate. Returns the per-device result for logging.
 */
export async function sendNativePush(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const tokens = await listDeviceTokens(userId);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  let sent = 0, failed = 0;
  await Promise.all(tokens.map(async (t) => {
    const result = t.platform === 'ios'
      ? await sendApns(t.device_token, payload)
      : t.platform === 'android'
        ? await sendFcm(t.device_token, payload)
        : { ok: false, status: 0, reason: 'unknown platform' };

    if (result.ok) {
      sent++;
      return;
    }
    failed++;
    // Prune permanently-dead tokens
    const dead = ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'NOT_FOUND', 'UNREGISTERED', 'INVALID_ARGUMENT'];
    if (dead.some((d) => (result.reason || '').includes(d))) {
      console.log(`[NATIVE-PUSH] Pruning dead token user=${userId.slice(0, 8)} platform=${t.platform} reason=${result.reason}`);
      await unregisterDeviceToken(userId, t.device_token);
    } else {
      console.warn(`[NATIVE-PUSH] Send failed user=${userId.slice(0, 8)} platform=${t.platform} status=${result.status} reason=${result.reason}`);
    }
  }));
  return { sent, failed };
}
