// OAuth Email Module - Gmail & Outlook OAuth2 + API-based sending
import * as kv from "./kv-retry.tsx";
import { encryptJson, decryptJson, isEncrypted } from "./crypto-store.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? "";
}

function gmailCallback(): string {
  return `${getBaseUrl()}/functions/v1/make-server-a8b2511f/auth/gmail/callback`;
}

function outlookCallback(): string {
  return `${getBaseUrl()}/functions/v1/make-server-a8b2511f/auth/outlook/callback`;
}

// ---------------------------------------------------------------------------
// KV key helpers
// ---------------------------------------------------------------------------

export function kvProviderKey(userId: string) {
  return `email_settings:${userId}:provider`;
}
export function kvGmailTokensKey(userId: string) {
  return `email_settings:${userId}:gmail_tokens`;
}
export function kvOutlookTokensKey(userId: string) {
  return `email_settings:${userId}:outlook_tokens`;
}
export function kvSmtpConfigKey(userId: string) {
  return `email_settings:${userId}:smtp_config`;
}
export function kvRotationTokensKey(userId: string, email: string) {
  return `sender_rotation:${userId}:tokens:${email.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// OAuth State (short-lived, stored in KV)
// ---------------------------------------------------------------------------

export async function createOAuthState(
  userId: string,
  provider: "gmail" | "outlook",
  origin?: string,
  syncOnly?: boolean,
  rotationMode?: boolean,
): Promise<string> {
  const state = crypto.randomUUID();
  await kv.set(
    `oauth_state:${state}`,
    JSON.stringify({ userId, provider, origin: origin || '', syncOnly: !!syncOnly, rotationMode: !!rotationMode, createdAt: Date.now() }),
  );
  return state;
}

export async function verifyOAuthState(
  state: string,
): Promise<{ userId: string; provider: string; origin: string; syncOnly?: boolean; rotationMode?: boolean } | null> {
  const raw = await kv.get(`oauth_state:${state}`);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  // 10-minute expiry
  if (Date.now() - parsed.createdAt > 10 * 60 * 1000) {
    await kv.del(`oauth_state:${state}`);
    return null;
  }
  await kv.del(`oauth_state:${state}`); // one-time use
  return { userId: parsed.userId, provider: parsed.provider, origin: parsed.origin || '', syncOnly: parsed.syncOnly, rotationMode: parsed.rotationMode };
}

// ---------------------------------------------------------------------------
// Gmail OAuth
// ---------------------------------------------------------------------------

export function getGmailAuthUrl(state: string): string {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailCallback(),
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGmailCode(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      redirect_uri: gmailCallback(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail token exchange failed: ${err}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export async function refreshGmailToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail token refresh failed: ${err}`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

export async function getGmailUserInfo(
  accessToken: string,
): Promise<{ email: string; name: string }> {
  const res = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error("Failed to get Gmail user info");
  const data = await res.json();
  return { email: data.email, name: data.name || data.email };
}

// ---------------------------------------------------------------------------
// Outlook OAuth
// ---------------------------------------------------------------------------

export function getOutlookAuthUrl(state: string): string {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: outlookCallback(),
    response_type: "code",
    scope:
      "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access",
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeOutlookCode(code: string) {
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
        client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
        redirect_uri: outlookCallback(),
        grant_type: "authorization_code",
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Outlook token exchange failed: ${err}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export async function refreshOutlookToken(refreshToken: string) {
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
        client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
        grant_type: "refresh_token",
        // Microsoft only returns a rotated refresh_token when offline_access
        // is requested. Scope must match what was granted at initial auth
        // time or Microsoft can omit refresh_token, leaving us with a
        // dead token on the next refresh cycle.
        scope: "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access",
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Outlook token refresh failed: ${err}`);
  }
  // Microsoft rotates the refresh token on every refresh. We MUST persist
  // the new one — using the old refresh token a second time gets a 401
  // and the user appears logged out even though the UI shows "Connected".
  return (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
}

export async function getOutlookUserInfo(
  accessToken: string,
): Promise<{ email: string; name: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to get Outlook user info");
  const data = await res.json();
  return {
    email: data.mail || data.userPrincipalName,
    name: data.displayName || data.mail || "",
  };
}

// ---------------------------------------------------------------------------
// Token Storage & Retrieval (KV)
// ---------------------------------------------------------------------------

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
  email: string;
  name?: string;
}

// Helper: load a stored token blob, accepting both new encrypted-envelope
// values and legacy plaintext-JSON values. Returns null when the key is
// missing or the value can't be decrypted/parsed.
async function loadStoredTokens(kvKey: string): Promise<StoredTokens | null> {
  const raw = await kv.get(kvKey);
  if (!raw) return null;
  if (typeof raw === "string" && isEncrypted(raw)) {
    return await decryptJson<StoredTokens>(raw);
  }
  // Legacy: stored as a JSON string OR (in some places) the raw object.
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as StoredTokens; } catch { return null; }
  }
  if (typeof raw === "object") return raw as StoredTokens;
  return null;
}

export async function storeGmailTokens(
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  userInfo: { email: string; name: string },
  syncOnly?: boolean,
) {
  const stored: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    email: userInfo.email,
    name: userInfo.name,
  };
  // Encrypted-at-rest. encryptJson falls back to plaintext JSON if
  // TOKEN_ENCRYPTION_KEY isn't configured, so this is safe to deploy
  // before the env var is set.
  await kv.set(kvGmailTokensKey(userId), await encryptJson(stored));
  // Only switch the sending provider if this is NOT a sync-only connection
  if (!syncOnly) {
    await kv.set(kvProviderKey(userId), "gmail_oauth");
  }
  console.log(`[OAUTH] Gmail tokens stored for user ${userId} (syncOnly=${!!syncOnly})`);
}

export async function storeOutlookTokens(
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  userInfo: { email: string; name: string },
) {
  const stored: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    email: userInfo.email,
    name: userInfo.name,
  };
  await kv.set(kvOutlookTokensKey(userId), await encryptJson(stored));
  await kv.set(kvProviderKey(userId), "outlook_oauth");
}

/** Returns a valid access token, refreshing if needed. */
export async function getValidGmailToken(
  userId: string,
): Promise<StoredTokens | null> {
  const tokens = await loadStoredTokens(kvGmailTokensKey(userId));
  if (!tokens) return null;

  // Refresh if expiring within 5 minutes
  if (tokens.expires_at < Date.now() + 5 * 60 * 1000) {
    try {
      const refreshed = await refreshGmailToken(tokens.refresh_token);
      tokens.access_token = refreshed.access_token;
      tokens.expires_at = Date.now() + refreshed.expires_in * 1000;
      await kv.set(kvGmailTokensKey(userId), await encryptJson(tokens));
    } catch (err) {
      console.error("[OAUTH] Gmail token refresh failed:", err);
      return null;
    }
  }
  return tokens;
}

export async function getValidOutlookToken(
  userId: string,
): Promise<StoredTokens | null> {
  const tokens = await loadStoredTokens(kvOutlookTokensKey(userId));
  if (!tokens) return null;

  if (tokens.expires_at < Date.now() + 5 * 60 * 1000) {
    try {
      const refreshed = await refreshOutlookToken(tokens.refresh_token);
      tokens.access_token = refreshed.access_token;
      tokens.expires_at = Date.now() + refreshed.expires_in * 1000;
      // CRITICAL: Microsoft rotates the refresh_token. Persist the new one
      // or the next refresh attempt 1 hour from now will use a dead token
      // and the user gets the "Outlook not connected" error.
      if (refreshed.refresh_token) {
        tokens.refresh_token = refreshed.refresh_token;
      }
      await kv.set(kvOutlookTokensKey(userId), await encryptJson(tokens));
    } catch (err) {
      console.error("[OAUTH] Outlook token refresh failed:", err);
      return null;
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Send via Gmail API
// ---------------------------------------------------------------------------

interface EmailPayload {
  from: string;
  to: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  text?: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function buildMimeMessage(opts: EmailPayload): string {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
  const lines: string[] = [];

  lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  if (opts.replyTo) lines.push(`Reply-To: ${opts.replyTo}`);
  if (opts.cc) {
    const ccList = Array.isArray(opts.cc) ? opts.cc.join(", ") : opts.cc;
    lines.push(`Cc: ${ccList}`);
  }
  if (opts.bcc) {
    const bccList = Array.isArray(opts.bcc) ? opts.bcc.join(", ") : opts.bcc;
    lines.push(`Bcc: ${bccList}`);
  }
  // Encode subject as UTF-8 using MIME encoded-word syntax
  lines.push(`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(opts.subject)))}?=`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push(`X-Entity-Ref-ID: ${crypto.randomUUID()}`);
  lines.push("");
  // plain text part
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push("");
  const plainText = opts.text || opts.html.replace(/<[^>]+>/g, "");
  lines.push(btoa(unescape(encodeURIComponent(plainText))));
  lines.push("");
  // html part
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: text/html; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push("");
  lines.push(btoa(unescape(encodeURIComponent(opts.html))));
  lines.push("");
  lines.push(`--${boundary}--`);

  return lines.join("\r\n");
}

function base64url(str: string): string {
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendViaGmailAPI(
  userId: string,
  opts: EmailPayload,
): Promise<SendResult> {
  const tokens = await getValidGmailToken(userId);
  if (!tokens) {
    return {
      success: false,
      error:
        "Gmail not connected or token expired. Please reconnect in Settings > Email Config.",
    };
  }

  const mime = buildMimeMessage({
    ...opts,
    // Ensure from is the connected Gmail address
    from: opts.from || tokens.email,
  });

  // Gmail API expects the raw MIME as a web-safe base64 string
  const raw = base64url(mime);

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      },
    );

    if (res.ok) {
      const data = await res.json();
      return { success: true, messageId: data.id };
    }

    const errBody = await res.text();

    // Gmail rate limit (429) or quota exceeded (403 with rateLimitExceeded)
    if (res.status === 429 || (res.status === 403 && errBody.includes('rateLimitExceeded'))) {
      const backoffMs = Math.min(2000 * Math.pow(2, attempt), 30000);
      console.warn(`[OAUTH-GMAIL] Rate limited (${res.status}). Backing off ${backoffMs}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      continue;
    }

    // Gmail daily limit hit: "You have reached a limit for sending mail"
    if (errBody.includes('limit for sending') || errBody.includes('Daily sending quota') || errBody.includes('RESOURCE_EXHAUSTED')) {
      console.error(`[OAUTH-GMAIL] ❌ Daily sending limit hit for user ${userId}. Gmail says: ${errBody.substring(0, 200)}`);
      // Mark today as exhausted so we don't keep trying
      const today = new Date().toISOString().slice(0, 10);
      try {
        await kv.set(`ratelimit:gmail_oauth:${userId}:daily:${today}`, 9999);
      } catch (_) { /* non-fatal */ }
      return { success: false, error: 'Gmail daily sending limit reached. Remaining emails will be sent tomorrow. Consider adding more sender accounts.' };
    }

    // Permanent bounce: invalid address (550, 553, etc.)
    if (errBody.includes('Address not found') || errBody.includes('address rejected') ||
        errBody.includes('550') || errBody.includes('553') || errBody.includes('invalid') ||
        errBody.includes('inactive') || errBody.includes('does not exist')) {
      console.error(`[OAUTH-GMAIL] ❌ Hard bounce for ${opts.to}: ${errBody.substring(0, 200)}`);
      // Auto-suppress this address
      try {
        await kv.set(`suppressed:${opts.to.toLowerCase().trim()}`, JSON.stringify({
          reason: `Gmail hard bounce: ${errBody.substring(0, 100)}`,
          added_at: new Date().toISOString(),
          source: 'gmail_send_error',
        }));
      } catch (_) { /* non-fatal */ }
      return { success: false, error: `Hard bounce: ${opts.to} — address not found or inactive` };
    }

    console.error("[OAUTH-GMAIL] Send failed:", errBody);
    return { success: false, error: `Gmail API error: ${errBody}` };
  }

  return { success: false, error: 'Gmail send failed after retries (rate limited)' };
}

// ---------------------------------------------------------------------------
// Send via Microsoft Graph API
// ---------------------------------------------------------------------------

export async function sendViaOutlookAPI(
  userId: string,
  opts: EmailPayload,
): Promise<SendResult> {
  const tokens = await getValidOutlookToken(userId);
  if (!tokens) {
    return {
      success: false,
      error:
        "Outlook not connected or token expired. Please reconnect in Settings > Email Config.",
    };
  }

  const graphPayload = {
    message: {
      subject: opts.subject,
      body: {
        contentType: "HTML",
        content: opts.html,
      },
      from: {
        emailAddress: { address: opts.from || tokens.email },
      },
      toRecipients: [
        { emailAddress: { address: opts.to } },
      ],
      replyTo: opts.replyTo
        ? [{ emailAddress: { address: opts.replyTo } }]
        : undefined,
      ccRecipients: opts.cc
        ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]).map((email) => ({
            emailAddress: { address: email },
          }))
        : undefined,
      bccRecipients: opts.bcc
        ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc]).map((email) => ({
            emailAddress: { address: email },
          }))
        : undefined,
    },
    saveToSentItems: true,
  };

  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/sendMail",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(graphPayload),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[OAUTH-OUTLOOK] Send failed:", errBody);
    return { success: false, error: `Outlook Graph API error: ${errBody}` };
  }

  // Graph API returns 202 with no body on success
  return { success: true, messageId: crypto.randomUUID() };
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export async function disconnectProvider(
  userId: string,
  provider: "gmail_oauth" | "outlook_oauth",
) {
  if (provider === "gmail_oauth") {
    await kv.del(kvGmailTokensKey(userId));
  } else if (provider === "outlook_oauth") {
    await kv.del(kvOutlookTokensKey(userId));
  }
  // Reset to resend
  await kv.set(kvProviderKey(userId), "resend");
}

// ---------------------------------------------------------------------------
// Get connected email info (for UI)
// ---------------------------------------------------------------------------

export async function getEmailSettingsFromKV(userId: string) {
  const provider = (await kv.get(kvProviderKey(userId))) || "resend";
  let connectedEmail: string | null = null;
  let connectedName: string | null = null;

  if (provider === "gmail_oauth") {
    const t = await loadStoredTokens(kvGmailTokensKey(userId));
    if (t) {
      connectedEmail = t.email;
      connectedName = t.name || null;
    }
  } else if (provider === "outlook_oauth") {
    const t = await loadStoredTokens(kvOutlookTokensKey(userId));
    if (t) {
      connectedEmail = t.email;
      connectedName = t.name || null;
    }
  } else if (provider === "smtp") {
    const raw = await kv.get(kvSmtpConfigKey(userId));
    if (raw) {
      const cfg = JSON.parse(raw);
      connectedEmail = cfg.from_email || cfg.username || null;
    }
  }

  // Also load brand senders
  const roadrSender = await kv.get(`email_config:${userId}:roadr_sender`);
  const sourcrSender = await kv.get(`email_config:${userId}:sourcr_sender`);

  return {
    provider,
    connected_email: connectedEmail,
    connected_name: connectedName,
    roadr_sender: roadrSender || "",
    sourcr_sender: sourcrSender || "",
  };
}

// ---------------------------------------------------------------------------
// Save SMTP config to KV
// ---------------------------------------------------------------------------

export async function saveSmtpConfigToKV(
  userId: string,
  config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    from_name?: string;
    from_email: string;
  },
) {
  // Merge with existing (to preserve password if not re-sent)
  const existingRaw = await kv.get(kvSmtpConfigKey(userId));
  let existing: any = {};
  if (existingRaw) existing = JSON.parse(existingRaw);

  const merged = {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password || existing.password || "",
    from_name: config.from_name || "",
    from_email: config.from_email,
  };

  await kv.set(kvSmtpConfigKey(userId), JSON.stringify(merged));
  await kv.set(kvProviderKey(userId), "smtp");
}

// ---------------------------------------------------------------------------
// Rotation-mode token storage (multi-account sender rotation)
// ---------------------------------------------------------------------------

/** Store OAuth tokens for a rotation sender account (does NOT change primary provider). */
export async function storeRotationTokens(
  userId: string,
  provider: "gmail" | "outlook",
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  userInfo: { email: string; name: string },
) {
  const stored: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    email: userInfo.email,
    name: userInfo.name,
  };
  // Store under rotation-specific key
  await kv.set(kvRotationTokensKey(userId, userInfo.email), JSON.stringify({ ...stored, provider }));

  // Also auto-add to the sender-rotation accounts list
  const accountsRaw = await kv.get(`sender_rotation:${userId}:accounts`);
  let accounts: any[] = accountsRaw ? JSON.parse(accountsRaw) : [];
  
  // Check if already exists
  const existing = accounts.find((a: any) => a.email.toLowerCase() === userInfo.email.toLowerCase());
  if (existing) {
    existing.connected = true;
    existing.provider = provider === 'gmail' ? 'gmail' : 'outlook';
    existing.displayName = userInfo.name;
  } else {
    accounts.push({
      id: crypto.randomUUID(),
      email: userInfo.email,
      provider: provider === 'gmail' ? 'gmail' : 'outlook',
      dailyLimit: 50,
      sentToday: 0,
      enabled: true,
      warmupStatus: 'not_started',
      connected: true,
      displayName: userInfo.name,
      addedAt: new Date().toISOString(),
    });
  }
  await kv.set(`sender_rotation:${userId}:accounts`, JSON.stringify(accounts));
  console.log(`[ROTATION] Stored OAuth tokens for ${userInfo.email} (provider=${provider}) for user ${userId}`);
}

/** Remove a rotation account's tokens. */
export async function disconnectRotationAccount(userId: string, email: string) {
  await kv.del(kvRotationTokensKey(userId, email));
}

// ---------------------------------------------------------------------------
// OAuth callback HTML — NO LONGER USED
// ---------------------------------------------------------------------------
// The server now uses 302 redirects to the static /oauth-callback.html page
// on the frontend origin, which completely avoids Content-Type issues in
// Supabase Edge Functions. The old oauthSuccessHtml/oauthErrorHtml functions
// have been removed. See oauthRedirect() in index.tsx.