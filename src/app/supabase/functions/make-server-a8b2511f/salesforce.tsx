// ══════════════════════════════════════════════════════════════════════════
// Salesforce OAuth + CRM Integration for Contndr
// OAuth connect, token management, lead/account export
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { htmlResponse } from "./html-response.tsx";

const app = new Hono();
app.use("*", cors());

// ── Constants ──────────────────────────────────────────────────────────
const SF_AUTH_URL = "https://login.salesforce.com/services/oauth2/authorize";
const SF_TOKEN_URL = "https://login.salesforce.com/services/oauth2/token";
const SF_API_VERSION = "v60.0";
const SCOPES = "full refresh_token api";

// ── KV key helpers ────────────────────────────────────────────────────
function kvSalesforceConnection(userId: string) {
  return `salesforce_connection:${userId}`;
}
function kvSalesforceExportLog(userId: string) {
  return `salesforce_export_log:${userId}`;
}
function kvSalesforceLeadMap(userId: string, email: string) {
  return `salesforce_lead:${userId}:${email.toLowerCase()}`;
}
function kvSalesforceAccountMap(userId: string, domain: string) {
  return `salesforce_account:${userId}:${domain.toLowerCase()}`;
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
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "SALESFORCE");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── Get Salesforce OAuth credentials ──
function getSalesforceClientId(): string {
  const id = Deno.env.get("SALESFORCE_CLIENT_ID");
  if (!id) throw new Error("SALESFORCE_CLIENT_ID not configured");
  return id;
}

function getSalesforceClientSecret(): string {
  const secret = Deno.env.get("SALESFORCE_CLIENT_SECRET");
  if (!secret) throw new Error("SALESFORCE_CLIENT_SECRET not configured");
  return secret;
}

function getRedirectUri(): string {
  return "https://contndr.com/api/integrations/salesforce/callback";
}

// ── PKCE helpers (S256) ───────────────────────────────────────────────
// Salesforce requires Proof Key for Code Exchange on this Connected App.
// We generate a random code_verifier, hash it to a code_challenge, send
// the challenge in the authorize URL, then include the verifier when
// exchanging the authorization code for tokens.

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function generatePKCE(): Promise<{ code_verifier: string; code_challenge: string }> {
  // 32 random bytes → ~43 base64url chars (within the 43-128 range)
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const code_verifier = base64url(verifierBytes.buffer);

  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(code_verifier));
  const code_challenge = base64url(digest);

  return { code_verifier, code_challenge };
}

// ── Token management ──────────────────────────────────────────────────

interface SalesforceConnection {
  access_token: string;
  refresh_token: string;
  instance_url: string;
  token_type: string;
  expires_at: number; // Unix timestamp in ms
  connected_at: string;
  last_refreshed_at?: string;
  sf_user_id?: string;
  sf_org_name?: string;
  sf_user_email?: string;
}

async function getStoredConnection(userId: string): Promise<SalesforceConnection | null> {
  const data = await kv.get(kvSalesforceConnection(userId));
  if (!data) return null;
  return typeof data === "string" ? JSON.parse(data) : data;
}

async function storeConnection(userId: string, connection: SalesforceConnection): Promise<void> {
  await kv.set(kvSalesforceConnection(userId), connection);
}

async function getValidAccessToken(userId: string): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const connection = await getStoredConnection(userId);
  if (!connection) return null;

  // Refresh if expiring within 5 minutes
  if (connection.expires_at < Date.now() + 5 * 60 * 1000) {
    console.log(`[SALESFORCE] Token expiring soon for user ${userId}, refreshing...`);
    try {
      const refreshed = await refreshToken(connection.refresh_token);
      connection.access_token = refreshed.access_token;
      // Salesforce may or may not return a new refresh token
      if (refreshed.refresh_token) {
        connection.refresh_token = refreshed.refresh_token;
      }
      if (refreshed.instance_url) {
        connection.instance_url = refreshed.instance_url;
      }
      // Salesforce tokens are issued_at-based; default 2 hours if not specified
      connection.expires_at = Date.now() + (refreshed.expires_in ? refreshed.expires_in * 1000 : 2 * 60 * 60 * 1000);
      connection.last_refreshed_at = new Date().toISOString();
      await storeConnection(userId, connection);
      console.log(`[SALESFORCE] Token refreshed successfully for user ${userId}`);

      await logExportEvent(userId, {
        type: "token_refresh",
        success: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[SALESFORCE] Token refresh failed for user ${userId}:`, err.message);

      await logExportEvent(userId, {
        type: "token_refresh",
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      return null;
    }
  }

  return { accessToken: connection.access_token, instanceUrl: connection.instance_url };
}

async function refreshToken(refreshTokenValue: string): Promise<{
  access_token: string;
  refresh_token?: string;
  instance_url?: string;
  expires_in?: number;
}> {
  const res = await fetch(SF_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: getSalesforceClientId(),
      client_secret: getSalesforceClientSecret(),
      refresh_token: refreshTokenValue,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Salesforce token refresh failed (${res.status}): ${err}`);
  }

  return await res.json();
}

// ── Export event logging ──────────────────────────────────────────────

async function logExportEvent(userId: string, event: any): Promise<void> {
  try {
    const logKey = kvSalesforceExportLog(userId);
    const existing = (await kv.get(logKey)) || [];
    const logs = Array.isArray(existing) ? existing : [];
    logs.unshift(event);
    // Keep last 200 entries
    await kv.set(logKey, logs.slice(0, 200));
  } catch (err) {
    console.error("[SALESFORCE] Failed to log export event:", err);
  }
}

// ── Salesforce API helper ─────────────────────────────────────────────

async function sfApiFetch(
  instanceUrl: string,
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith("http") ? endpoint : `${instanceUrl}/services/data/${SF_API_VERSION}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...((options.headers as Record<string, string>) || {}),
    },
  });
}

// ── OAuth success/error HTML ──────────────────────────────────────────

function sfSuccessHtml(orgName?: string, appOrigin?: string): string {
  const safeOrigin = appOrigin ? appOrigin.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
  return `<!DOCTYPE html><html><head><title>Salesforce Connected</title></head><body>
<script>
(function(){
  var appOrigin = '${safeOrigin}';
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'salesforce-oauth-success' }, '*');
    }
    localStorage.setItem('contndr-salesforce-oauth-success', 'true');
  } catch(e) {}
  if (window.opener) {
    setTimeout(function(){ window.close(); }, 300);
  } else if (appOrigin) {
    setTimeout(function(){ window.location.href = appOrigin + '/settings'; }, 300);
  }
})();
</script>
<p style="font-family:system-ui;color:#999;text-align:center;margin-top:40vh">Salesforce connected — closing&hellip;</p>
</body></html>`;
}

function sfErrorHtml(message: string, appOrigin?: string): string {
  const safeOrigin = appOrigin ? appOrigin.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
  const safeMsg = message.replace(/'/g, "\\'").replace(/\n/g, " ");
  return `<!DOCTYPE html><html><head><title>Salesforce Error</title></head><body>
<script>
(function(){
  var appOrigin = '${safeOrigin}';
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'salesforce-oauth-error', message: '${safeMsg}' }, '*');
    }
    localStorage.setItem('contndr-salesforce-oauth-error', '${safeMsg}');
  } catch(e) {}
  if (window.opener) {
    setTimeout(function(){ window.close(); }, 300);
  } else if (appOrigin) {
    setTimeout(function(){ window.location.href = appOrigin + '/settings'; }, 1000);
  }
})();
</script>
<p style="font-family:system-ui;color:#ef4444;text-align:center;margin-top:40vh">Connection failed — closing&hellip;</p>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── GET /status — Check Salesforce connection status ──
app.get("/status", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection) {
      return c.json({ connected: false });
    }

    // Check if token is still valid
    const tokenData = await getValidAccessToken(user.id);
    if (!tokenData) {
      return c.json({
        connected: false,
        error: "Token expired and could not be refreshed. Please reconnect.",
      });
    }

    // Quick identity check
    try {
      const res = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, "/limits");
      if (res.ok) {
        return c.json({
          connected: true,
          instance_url: connection.instance_url,
          org_name: connection.sf_org_name || "",
          user_email: connection.sf_user_email || "",
          connected_at: connection.connected_at,
        });
      }
    } catch (_) {
      // Token validation failed but connection might still be valid
    }

    return c.json({
      connected: true,
      instance_url: connection.instance_url,
      org_name: connection.sf_org_name || "",
      connected_at: connection.connected_at,
    });
  } catch (error: any) {
    console.error("[SALESFORCE] Status check error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /connect — Start OAuth flow (returns auth URL) ──
app.get("/connect", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);

    // Capture the app origin so the callback can redirect back if popup was blocked
    const appOrigin = c.req.query("origin") || "";

    // Create a state token to prevent CSRF
    const state = crypto.randomUUID();
    await kv.set(`salesforce_oauth_state:${state}`, {
      userId: user.id,
      createdAt: Date.now(),
      appOrigin,
    });

    // Generate PKCE code_verifier and code_challenge
    const pkce = await generatePKCE();
    await kv.set(`salesforce_oauth_pkce:${state}`, pkce);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: getSalesforceClientId(),
      redirect_uri: getRedirectUri(),
      scope: SCOPES,
      state,
      prompt: "consent",
      code_challenge: pkce.code_challenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${SF_AUTH_URL}?${params.toString()}`;

    console.log(`[SALESFORCE] OAuth flow started for user ${user.email}`);
    console.log(`[SALESFORCE] Redirect URI: ${getRedirectUri()}`);

    return c.json({ auth_url: authUrl });
  } catch (error: any) {
    console.error("[SALESFORCE] Connect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /oauth/callback — Handle OAuth callback from Salesforce ──
app.get("/oauth/callback", async (c) => {
  let appOrigin = "";
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const errorParam = c.req.query("error");
    const errorDescription = c.req.query("error_description");

    if (errorParam) {
      console.error(`[SALESFORCE] OAuth denied: ${errorParam} - ${errorDescription}`);
      // Try to recover origin from state even on error
      if (state) {
        try {
          const sd = await kv.get(`salesforce_oauth_state:${state}`);
          if (sd) {
            const ps = typeof sd === "string" ? JSON.parse(sd) : sd;
            appOrigin = ps.appOrigin || "";
            await kv.del(`salesforce_oauth_state:${state}`);
            await kv.del(`salesforce_oauth_pkce:${state}`);
          }
        } catch (_) {}
      }
      return htmlResponse(sfErrorHtml(`Salesforce denied access: ${errorDescription || errorParam}`, appOrigin), 400);
    }

    if (!code || !state) {
      return htmlResponse(sfErrorHtml("Missing code or state parameter", appOrigin), 400);
    }

    // Verify state
    const stateData = await kv.get(`salesforce_oauth_state:${state}`);
    if (!stateData) {
      return htmlResponse(sfErrorHtml("Invalid or expired state. Please try connecting again.", appOrigin), 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;
    appOrigin = parsedState.appOrigin || "";

    // Check state expiry (10 minutes)
    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(`salesforce_oauth_state:${state}`);
      await kv.del(`salesforce_oauth_pkce:${state}`);
      return htmlResponse(sfErrorHtml("OAuth state expired. Please try connecting again.", appOrigin), 400);
    }

    // Retrieve PKCE code_verifier
    const pkceData = await kv.get(`salesforce_oauth_pkce:${state}`);
    const parsedPkce = pkceData ? (typeof pkceData === "string" ? JSON.parse(pkceData) : pkceData) : null;
    const codeVerifier = parsedPkce?.code_verifier;

    // One-time use — clean up both state and PKCE
    await kv.del(`salesforce_oauth_state:${state}`);
    await kv.del(`salesforce_oauth_pkce:${state}`);

    const userId = parsedState.userId;
    console.log(`[SALESFORCE] OAuth callback for user: ${userId}`);

    // Exchange code for tokens (include code_verifier for PKCE)
    const tokenParams: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: getSalesforceClientId(),
      client_secret: getSalesforceClientSecret(),
      redirect_uri: getRedirectUri(),
      code,
    };
    if (codeVerifier) {
      tokenParams.code_verifier = codeVerifier;
    }

    const tokenRes = await fetch(SF_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[SALESFORCE] Token exchange failed (${tokenRes.status}):`, errBody);
      return htmlResponse(sfErrorHtml("Connection failed. Please try again.", appOrigin), 500);
    }

    const tokenData = await tokenRes.json();
    console.log("[SALESFORCE] Token exchange successful");

    // Get user/org info using the identity service
    let sfOrgName = "";
    let sfUserEmail = "";
    let sfUserId = "";
    try {
      if (tokenData.id) {
        // tokenData.id is an identity URL like https://login.salesforce.com/id/00Dxx0000001gEREAY/005xx000001SjXJAA0
        const identityRes = await fetch(tokenData.id, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (identityRes.ok) {
          const identity = await identityRes.json();
          sfUserEmail = identity.email || identity.username || "";
          sfUserId = identity.user_id || "";

          // Try to get the actual organization display name via SOQL
          try {
            const orgRes = await sfApiFetch(
              tokenData.instance_url,
              tokenData.access_token,
              `/query?q=${encodeURIComponent("SELECT Name FROM Organization LIMIT 1")}`
            );
            if (orgRes.ok) {
              const orgData = await orgRes.json();
              sfOrgName = orgData.records?.[0]?.Name || identity.organization_id || "";
            } else {
              sfOrgName = identity.organization_id || "";
            }
          } catch {
            sfOrgName = identity.organization_id || "";
          }

          console.log(`[SALESFORCE] Connected user: ${sfUserEmail}, org: ${sfOrgName}`);
        }
      }
    } catch (err) {
      console.warn("[SALESFORCE] Could not fetch identity info:", err);
    }

    // Store connection
    const connection: SalesforceConnection = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      instance_url: tokenData.instance_url,
      token_type: tokenData.token_type || "Bearer",
      // Salesforce access tokens typically last 2 hours
      expires_at: tokenData.issued_at
        ? Number(tokenData.issued_at) + 2 * 60 * 60 * 1000
        : Date.now() + 2 * 60 * 60 * 1000,
      connected_at: new Date().toISOString(),
      sf_user_id: sfUserId,
      sf_org_name: sfOrgName,
      sf_user_email: sfUserEmail,
    };

    await storeConnection(userId, connection);

    // Log connection event
    await logExportEvent(userId, {
      type: "oauth_connect",
      success: true,
      instance_url: tokenData.instance_url,
      timestamp: new Date().toISOString(),
    });

    console.log(`[SALESFORCE] Connection stored for user ${userId}`);

    return htmlResponse(sfSuccessHtml(sfOrgName || sfUserEmail, appOrigin));
  } catch (error: any) {
    console.error("[SALESFORCE] OAuth callback error:", error);
    return htmlResponse(sfErrorHtml("An unexpected error occurred. Please try again.", appOrigin), 500);
  }
});

// ── POST /process-callback — SPA-friendly token exchange ──────────────
// The OAuth redirect now lands on the frontend SPA at
// https://contndr.com/api/integrations/salesforce/callback
// That page reads the query params and POSTs { code, state } here.
app.post("/process-callback", async (c) => {
  try {
    const body = await c.req.json();
    const { code, state, error: errorParam, error_description: errorDescription } = body;

    if (errorParam) {
      console.error(`[SALESFORCE] OAuth denied (process-callback): ${errorParam} - ${errorDescription}`);
      // Clean up state + PKCE if present
      if (state) {
        try {
          await kv.del(`salesforce_oauth_state:${state}`);
          await kv.del(`salesforce_oauth_pkce:${state}`);
        } catch (_) {}
      }
      return c.json({ success: false, error: `Salesforce denied access: ${errorDescription || errorParam}` }, 400);
    }

    if (!code || !state) {
      return c.json({ success: false, error: "Missing code or state parameter" }, 400);
    }

    // Verify state
    const stateData = await kv.get(`salesforce_oauth_state:${state}`);
    if (!stateData) {
      return c.json({ success: false, error: "Invalid or expired state. Please try connecting again." }, 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;

    // Check state expiry (10 minutes)
    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(`salesforce_oauth_state:${state}`);
      await kv.del(`salesforce_oauth_pkce:${state}`);
      return c.json({ success: false, error: "OAuth state expired. Please try connecting again." }, 400);
    }

    // Retrieve PKCE code_verifier
    const pkceData = await kv.get(`salesforce_oauth_pkce:${state}`);
    const parsedPkce = pkceData ? (typeof pkceData === "string" ? JSON.parse(pkceData) : pkceData) : null;
    const codeVerifier = parsedPkce?.code_verifier;

    // One-time use — clean up both state and PKCE
    await kv.del(`salesforce_oauth_state:${state}`);
    await kv.del(`salesforce_oauth_pkce:${state}`);

    const userId = parsedState.userId;
    console.log(`[SALESFORCE] process-callback for user: ${userId}`);

    // Exchange code for tokens (include code_verifier for PKCE)
    const tokenParams: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: getSalesforceClientId(),
      client_secret: getSalesforceClientSecret(),
      redirect_uri: getRedirectUri(),
      code,
    };
    if (codeVerifier) {
      tokenParams.code_verifier = codeVerifier;
    }

    const tokenRes = await fetch(SF_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[SALESFORCE] Token exchange failed (${tokenRes.status}):`, errBody);
      return c.json({ success: false, error: "Token exchange failed. Please try again." }, 400);
    }

    const tokenData = await tokenRes.json();
    console.log("[SALESFORCE] Token exchange successful (process-callback)");

    // Get user/org info
    let sfOrgName = "";
    let sfUserEmail = "";
    let sfUserId = "";
    try {
      if (tokenData.id) {
        const identityRes = await fetch(tokenData.id, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (identityRes.ok) {
          const identity = await identityRes.json();
          sfUserEmail = identity.email || identity.username || "";
          sfUserId = identity.user_id || "";

          try {
            const orgRes = await sfApiFetch(
              tokenData.instance_url,
              tokenData.access_token,
              `/query?q=${encodeURIComponent("SELECT Name FROM Organization LIMIT 1")}`
            );
            if (orgRes.ok) {
              const orgData = await orgRes.json();
              sfOrgName = orgData.records?.[0]?.Name || identity.organization_id || "";
            } else {
              sfOrgName = identity.organization_id || "";
            }
          } catch {
            sfOrgName = identity.organization_id || "";
          }

          console.log(`[SALESFORCE] Connected user: ${sfUserEmail}, org: ${sfOrgName}`);
        }
      }
    } catch (err) {
      console.warn("[SALESFORCE] Could not fetch identity info:", err);
    }

    // Store connection
    const connection: SalesforceConnection = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      instance_url: tokenData.instance_url,
      token_type: tokenData.token_type || "Bearer",
      expires_at: tokenData.issued_at
        ? Number(tokenData.issued_at) + 2 * 60 * 60 * 1000
        : Date.now() + 2 * 60 * 60 * 1000,
      connected_at: new Date().toISOString(),
      sf_user_id: sfUserId,
      sf_org_name: sfOrgName,
      sf_user_email: sfUserEmail,
    };

    await storeConnection(userId, connection);

    await logExportEvent(userId, {
      type: "oauth_connect",
      success: true,
      instance_url: tokenData.instance_url,
      timestamp: new Date().toISOString(),
    });

    console.log(`[SALESFORCE] Connection stored for user ${userId} (process-callback)`);

    return c.json({
      success: true,
      org_name: sfOrgName,
      user_email: sfUserEmail,
      instance_url: tokenData.instance_url,
    });
  } catch (error: any) {
    console.error("[SALESFORCE] process-callback error:", error);
    return c.json({ success: false, error: "An unexpected error occurred. Please try again." }, 500);
  }
});

// ── POST /disconnect — Remove Salesforce connection ──
app.post("/disconnect", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);

    // Optionally revoke the token at Salesforce
    const connection = await getStoredConnection(user.id);
    if (connection?.access_token && connection.instance_url) {
      try {
        await fetch(`${connection.instance_url}/services/oauth2/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: connection.access_token }),
        });
        console.log(`[SALESFORCE] Token revoked at Salesforce for user ${user.id}`);
      } catch (revokeErr) {
        console.warn("[SALESFORCE] Token revoke failed (non-critical):", revokeErr);
      }
    }

    await kv.del(kvSalesforceConnection(user.id));

    await logExportEvent(user.id, {
      type: "disconnect",
      timestamp: new Date().toISOString(),
    });

    console.log(`[SALESFORCE] Disconnected for user ${user.id}`);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("[SALESFORCE] Disconnect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /export-logs — Get recent export logs ──
app.get("/export-logs", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const logs = (await kv.get(kvSalesforceExportLog(user.id))) || [];
    return c.json({ logs: Array.isArray(logs) ? logs : [] });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /test-connection — Verify token and Salesforce API reachability ──
app.get("/test-connection", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const tokenData = await getValidAccessToken(user.id);
    if (!tokenData) {
      return c.json({
        success: false,
        error: "No valid token. Please reconnect Salesforce.",
      });
    }

    // Test the connection by fetching API limits
    const limitsRes = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, "/limits");
    if (!limitsRes.ok) {
      const errText = await limitsRes.text();
      return c.json({
        success: false,
        error: `Salesforce API returned ${limitsRes.status}: ${errText}`,
      });
    }

    const limits = await limitsRes.json();
    const dailyApiRequests = limits.DailyApiRequests;

    // Also try a quick SOQL query to verify data access
    let canQueryLeads = false;
    try {
      const qRes = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, `/query?q=${encodeURIComponent("SELECT COUNT() FROM Lead LIMIT 1")}`);
      canQueryLeads = qRes.ok;
    } catch { /* non-critical */ }

    return c.json({
      success: true,
      instance_url: tokenData.instanceUrl,
      api_usage: dailyApiRequests ? {
        used: dailyApiRequests.Remaining !== undefined ? dailyApiRequests.Max - dailyApiRequests.Remaining : null,
        max: dailyApiRequests.Max || null,
        remaining: dailyApiRequests.Remaining || null,
      } : null,
      permissions: {
        can_query_leads: canQueryLeads,
      },
    });
  } catch (error: any) {
    console.error("[SALESFORCE] Test connection error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /callback-url — Return the OAuth callback URL for setup reference ──
app.get("/callback-url", async (c) => {
  try {
    return c.json({ callback_url: getRedirectUri() });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// EXPORT ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

// ── POST /export/lead — Export a person as a Salesforce Lead ──
app.post("/export/lead", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const tokenData = await getValidAccessToken(user.id);
    if (!tokenData) {
      return c.json({ error: "Salesforce not connected or token expired. Please reconnect." }, 401);
    }
    const { accessToken, instanceUrl } = tokenData;

    const {
      first_name,
      last_name,
      email,
      phone,
      job_title,
      company_name,
      linkedin_url,
      city,
      state,
      country,
      website,
    } = body;

    if (!email && !first_name && !last_name) {
      return c.json({ error: "At least email or name is required to export a lead" }, 400);
    }

    // Check if we already have a mapping for this lead
    let existingLeadId: string | null = null;
    if (email) {
      const cached = await kv.get(kvSalesforceLeadMap(user.id, email));
      if (cached) {
        const cachedData = typeof cached === "string" ? JSON.parse(cached) : cached;
        existingLeadId = cachedData.salesforce_lead_id;
      }

      // Also search Salesforce directly if no local cache
      if (!existingLeadId) {
        try {
          const query = encodeURIComponent(`SELECT Id FROM Lead WHERE Email = '${email.toLowerCase().replace(/'/g, "\\'")}'`);
          const searchRes = await sfApiFetch(instanceUrl, accessToken, `/query?q=${query}`);
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.totalSize > 0) {
              existingLeadId = searchData.records[0].Id;
            }
          }
        } catch (err) {
          console.warn("[SALESFORCE] Lead search failed:", err);
        }
      }
    }

    // Build Salesforce Lead payload
    const leadPayload: Record<string, string> = {};
    if (first_name) leadPayload.FirstName = first_name;
    leadPayload.LastName = last_name || "Unknown";
    leadPayload.Company = company_name || "Unknown";
    if (email) leadPayload.Email = email.toLowerCase();
    if (phone) leadPayload.Phone = phone;
    if (job_title) leadPayload.Title = job_title;
    if (city) leadPayload.City = city;
    if (state) leadPayload.State = state;
    if (country) leadPayload.Country = country;
    if (website) leadPayload.Website = website;
    if (linkedin_url) leadPayload.Description = `LinkedIn: ${linkedin_url}`;
    leadPayload.LeadSource = "Contndr";

    let salesforceLeadId: string;
    let action: "created" | "updated";

    if (existingLeadId) {
      // Update existing lead
      const updateRes = await sfApiFetch(instanceUrl, accessToken, `/sobjects/Lead/${existingLeadId}`, {
        method: "PATCH",
        body: JSON.stringify(leadPayload),
      });

      if (!updateRes.ok && updateRes.status !== 204) {
        const err = await updateRes.text();
        console.error(`[SALESFORCE] Lead update failed: ${err}`);

        await logExportEvent(user.id, {
          type: "export_lead",
          success: false,
          action: "update",
          email,
          error: err,
          timestamp: new Date().toISOString(),
        });

        return c.json({ error: `Failed to update lead: ${err}` }, 400);
      }

      salesforceLeadId = existingLeadId;
      action = "updated";
    } else {
      // Create new lead
      const createRes = await sfApiFetch(instanceUrl, accessToken, "/sobjects/Lead", {
        method: "POST",
        body: JSON.stringify(leadPayload),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        console.error(`[SALESFORCE] Lead creation failed: ${err}`);

        await logExportEvent(user.id, {
          type: "export_lead",
          success: false,
          action: "create",
          email,
          error: err,
          timestamp: new Date().toISOString(),
        });

        return c.json({ error: `Failed to create lead: ${err}` }, 400);
      }

      const createData = await createRes.json();
      salesforceLeadId = createData.id;
      action = "created";
    }

    // Cache the mapping
    if (email) {
      await kv.set(kvSalesforceLeadMap(user.id, email), {
        salesforce_lead_id: salesforceLeadId,
        exported_at: new Date().toISOString(),
      });
    }

    // Build Salesforce URL
    const salesforceUrl = `${instanceUrl}/lightning/r/Lead/${salesforceLeadId}/view`;

    // Log success
    await logExportEvent(user.id, {
      type: "export_lead",
      success: true,
      action,
      email,
      salesforce_lead_id: salesforceLeadId,
      salesforce_url: salesforceUrl,
      timestamp: new Date().toISOString(),
    });

    console.log(`[SALESFORCE] Lead ${action}: ${email} -> Salesforce ID ${salesforceLeadId}`);

    return c.json({
      success: true,
      action,
      salesforce_lead_id: salesforceLeadId,
      salesforce_url: salesforceUrl,
    });
  } catch (error: any) {
    console.error("[SALESFORCE] Export lead error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /export/account — Export a company as a Salesforce Account ──
app.post("/export/account", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const tokenData = await getValidAccessToken(user.id);
    if (!tokenData) {
      return c.json({ error: "Salesforce not connected or token expired. Please reconnect." }, 401);
    }
    const { accessToken, instanceUrl } = tokenData;

    const {
      company_name,
      domain,
      industry,
      employee_count,
      city,
      state,
      country,
      phone,
      website,
      description,
    } = body;

    if (!company_name && !domain) {
      return c.json({ error: "Company name or domain is required" }, 400);
    }

    const searchDomain = domain || (website ? (() => {
      try { return new URL(website.startsWith("http") ? website : `https://${website}`).hostname; } catch { return ""; }
    })() : "");

    // Check for existing account
    let existingAccountId: string | null = null;
    if (searchDomain) {
      const cached = await kv.get(kvSalesforceAccountMap(user.id, searchDomain));
      if (cached) {
        const cachedData = typeof cached === "string" ? JSON.parse(cached) : cached;
        existingAccountId = cachedData.salesforce_account_id;
      }

      if (!existingAccountId && website) {
        try {
          const query = encodeURIComponent(`SELECT Id FROM Account WHERE Website LIKE '%${searchDomain.replace(/'/g, "\\'")}'`);
          const searchRes = await sfApiFetch(instanceUrl, accessToken, `/query?q=${query}`);
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.totalSize > 0) {
              existingAccountId = searchData.records[0].Id;
            }
          }
        } catch (_) {}
      }
    }

    // Build Salesforce Account payload
    const accountPayload: Record<string, any> = {};
    accountPayload.Name = company_name || searchDomain || "Unknown";
    if (website) accountPayload.Website = website.startsWith("http") ? website : `https://${website}`;
    if (industry) accountPayload.Industry = industry;
    if (employee_count) accountPayload.NumberOfEmployees = Number(employee_count) || undefined;
    if (phone) accountPayload.Phone = phone;
    if (city) accountPayload.BillingCity = city;
    if (state) accountPayload.BillingState = state;
    if (country) accountPayload.BillingCountry = country;
    if (description) accountPayload.Description = description;

    // Remove undefined values
    Object.keys(accountPayload).forEach(key => {
      if (accountPayload[key] === undefined) delete accountPayload[key];
    });

    let salesforceAccountId: string;
    let action: "created" | "updated";

    if (existingAccountId) {
      const updateRes = await sfApiFetch(instanceUrl, accessToken, `/sobjects/Account/${existingAccountId}`, {
        method: "PATCH",
        body: JSON.stringify(accountPayload),
      });

      if (!updateRes.ok && updateRes.status !== 204) {
        const err = await updateRes.text();
        await logExportEvent(user.id, {
          type: "export_account",
          success: false,
          action: "update",
          company_name,
          error: err,
          timestamp: new Date().toISOString(),
        });
        return c.json({ error: `Failed to update account: ${err}` }, 400);
      }

      salesforceAccountId = existingAccountId;
      action = "updated";
    } else {
      const createRes = await sfApiFetch(instanceUrl, accessToken, "/sobjects/Account", {
        method: "POST",
        body: JSON.stringify(accountPayload),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        await logExportEvent(user.id, {
          type: "export_account",
          success: false,
          action: "create",
          company_name,
          error: err,
          timestamp: new Date().toISOString(),
        });
        return c.json({ error: `Failed to create account: ${err}` }, 400);
      }

      const createData = await createRes.json();
      salesforceAccountId = createData.id;
      action = "created";
    }

    // Cache
    if (searchDomain) {
      await kv.set(kvSalesforceAccountMap(user.id, searchDomain), {
        salesforce_account_id: salesforceAccountId,
        exported_at: new Date().toISOString(),
      });
    }

    const salesforceUrl = `${instanceUrl}/lightning/r/Account/${salesforceAccountId}/view`;

    await logExportEvent(user.id, {
      type: "export_account",
      success: true,
      action,
      company_name,
      salesforce_account_id: salesforceAccountId,
      salesforce_url: salesforceUrl,
      timestamp: new Date().toISOString(),
    });

    console.log(`[SALESFORCE] Account ${action}: ${company_name} -> Salesforce ID ${salesforceAccountId}`);

    return c.json({
      success: true,
      action,
      salesforce_account_id: salesforceAccountId,
      salesforce_url: salesforceUrl,
    });
  } catch (error: any) {
    console.error("[SALESFORCE] Export account error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /export/full — Full export (Lead + Account) for a person record ──
app.post("/export/full", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const tokenData = await getValidAccessToken(user.id);
    if (!tokenData) {
      return c.json({ error: "Salesforce not connected or token expired. Please reconnect." }, 401);
    }

    const {
      first_name,
      last_name,
      email,
      phone,
      job_title,
      company_name,
      domain,
      industry,
      employee_count,
      linkedin_url,
      city,
      state,
      country,
      website,
      description,
    } = body;

    let leadResult: any = null;
    let accountResult: any = null;

    // 1. Export as Salesforce Lead
    if (email || first_name || last_name) {
      const leadPayload: Record<string, string> = {};
      if (first_name) leadPayload.FirstName = first_name;
      leadPayload.LastName = last_name || "Unknown";
      leadPayload.Company = company_name || "Unknown";
      if (email) leadPayload.Email = email.toLowerCase();
      if (phone) leadPayload.Phone = phone;
      if (job_title) leadPayload.Title = job_title;
      if (city) leadPayload.City = city;
      if (state) leadPayload.State = state;
      if (country) leadPayload.Country = country;
      if (website) leadPayload.Website = website;
      if (linkedin_url) leadPayload.Description = `LinkedIn: ${linkedin_url}`;
      leadPayload.LeadSource = "Contndr";

      // Check existing
      let existingLeadId: string | null = null;
      if (email) {
        const cached = await kv.get(kvSalesforceLeadMap(user.id, email));
        if (cached) {
          const cachedData = typeof cached === "string" ? JSON.parse(cached) : cached;
          existingLeadId = cachedData.salesforce_lead_id;
        }
        if (!existingLeadId) {
          try {
            const query = encodeURIComponent(`SELECT Id FROM Lead WHERE Email = '${email.toLowerCase().replace(/'/g, "\\'")}'`);
            const searchRes = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, `/query?q=${query}`);
            if (searchRes.ok) {
              const data = await searchRes.json();
              if (data.totalSize > 0) existingLeadId = data.records[0].Id;
            }
          } catch (_) {}
        }
      }

      if (existingLeadId) {
        const res = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, `/sobjects/Lead/${existingLeadId}`, {
          method: "PATCH",
          body: JSON.stringify(leadPayload),
        });
        if (res.ok || res.status === 204) {
          leadResult = { action: "updated", salesforce_lead_id: existingLeadId };
        }
      } else {
        const res = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, "/sobjects/Lead", {
          method: "POST",
          body: JSON.stringify(leadPayload),
        });
        if (res.ok) {
          const data = await res.json();
          leadResult = { action: "created", salesforce_lead_id: data.id };
        }
      }

      // Cache
      if (email && leadResult?.salesforce_lead_id) {
        await kv.set(kvSalesforceLeadMap(user.id, email), {
          salesforce_lead_id: leadResult.salesforce_lead_id,
          exported_at: new Date().toISOString(),
        });
      }
    }

    // 2. Export company as Salesforce Account (if company data is available)
    const effectiveDomain = domain || (website ? (() => {
      try { return new URL(website.startsWith("http") ? website : `https://${website}`).hostname; } catch { return ""; }
    })() : "");

    if (company_name || effectiveDomain) {
      try {
        const accountPayload: Record<string, any> = {};
        accountPayload.Name = company_name || effectiveDomain || "Unknown";
        if (website) accountPayload.Website = website.startsWith("http") ? website : `https://${website}`;
        if (industry) accountPayload.Industry = industry;
        if (employee_count) {
          const numEmp = Number(employee_count);
          if (!isNaN(numEmp) && numEmp > 0) accountPayload.NumberOfEmployees = numEmp;
        }
        if (city) accountPayload.BillingCity = city;
        if (state) accountPayload.BillingState = state;
        if (country) accountPayload.BillingCountry = country;

        // Check for existing account
        let existingAccountId: string | null = null;
        if (effectiveDomain) {
          const cachedAcct = await kv.get(kvSalesforceAccountMap(user.id, effectiveDomain));
          if (cachedAcct) {
            const acctData = typeof cachedAcct === "string" ? JSON.parse(cachedAcct) : cachedAcct;
            existingAccountId = acctData.salesforce_account_id;
          }
          if (!existingAccountId) {
            try {
              const safeD = effectiveDomain.replace(/'/g, "\\'");
              const query = encodeURIComponent(`SELECT Id FROM Account WHERE Website LIKE '%${safeD}' LIMIT 1`);
              const acctSearch = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, `/query?q=${query}`);
              if (acctSearch.ok) {
                const acctSearchData = await acctSearch.json();
                if (acctSearchData.totalSize > 0) existingAccountId = acctSearchData.records[0].Id;
              }
            } catch { /* non-critical */ }
          }
        }

        if (existingAccountId) {
          const acctRes = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, `/sobjects/Account/${existingAccountId}`, {
            method: "PATCH",
            body: JSON.stringify(accountPayload),
          });
          if (acctRes.ok || acctRes.status === 204) {
            accountResult = { action: "updated", salesforce_account_id: existingAccountId };
          }
        } else {
          const acctRes = await sfApiFetch(tokenData.instanceUrl, tokenData.accessToken, "/sobjects/Account", {
            method: "POST",
            body: JSON.stringify(accountPayload),
          });
          if (acctRes.ok) {
            const acctData = await acctRes.json();
            accountResult = { action: "created", salesforce_account_id: acctData.id };
          }
        }

        // Cache account mapping
        if (effectiveDomain && accountResult?.salesforce_account_id) {
          await kv.set(kvSalesforceAccountMap(user.id, effectiveDomain), {
            salesforce_account_id: accountResult.salesforce_account_id,
            exported_at: new Date().toISOString(),
          });
        }
      } catch (acctErr: any) {
        console.warn("[SALESFORCE] Account export in full flow failed (non-critical):", acctErr.message);
      }
    }

    // Log
    await logExportEvent(user.id, {
      type: "export_full",
      success: !!leadResult,
      lead: leadResult,
      account: accountResult,
      email,
      company_name,
      timestamp: new Date().toISOString(),
    });

    const salesforceUrl = leadResult?.salesforce_lead_id
      ? `${tokenData.instanceUrl}/lightning/r/Lead/${leadResult.salesforce_lead_id}/view`
      : null;

    return c.json({
      success: !!leadResult,
      lead: leadResult,
      account: accountResult,
      salesforce_url: salesforceUrl,
    });
  } catch (error: any) {
    console.error("[SALESFORCE] Full export error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;