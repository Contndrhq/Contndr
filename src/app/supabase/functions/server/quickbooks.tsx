// ══════════════════════════════════════════════════════════════════════════
// QuickBooks Online OAuth + Data Sync Integration for Contndr
// OAuth connect, token management, data sync (Customers, Invoices, Payments)
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { htmlResponse } from "./html-response.tsx";

const app = new Hono();
app.use("*", cors());

// ── Constants ──────────────────────────────────────────────────────────
const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const QBO_USERINFO_URL = "https://accounts.platform.intuit.com/v1/openid_connect/userinfo";

// API base URLs
const QBO_API_BASE_PROD = "https://quickbooks.api.intuit.com";
const QBO_API_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com";

const QBO_SCOPE = "com.intuit.quickbooks.accounting";

// ── KV key helpers ────────────────────────────────────────────────────
function kvQboConnection(userId: string) {
  return `qbo_connection:${userId}`;
}
function kvQboOAuthState(state: string) {
  return `qbo_oauth_state:${state}`;
}
function kvQboSyncCursor(userId: string, objectType: string) {
  return `qbo_sync_cursor:${userId}:${objectType}`;
}
function kvQboSyncData(userId: string, objectType: string) {
  return `qbo_sync_data:${userId}:${objectType}`;
}
function kvQboSyncLog(userId: string) {
  return `qbo_sync_log:${userId}`;
}

// ── Auth helper ──────────────────────────────────────────────────────
async function getAuthenticatedUser(c: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) throw new Error("No Authorization header");
  const token = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "QUICKBOOKS");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── QBO OAuth credentials ──────────────────────────────────────────
function getQboClientId(): string {
  // Use production credentials by default
  const id = Deno.env.get("QBO_CLIENT_ID_PRODUCTION");
  if (!id) throw new Error("QBO_CLIENT_ID_PRODUCTION not configured");
  return id;
}

function getQboClientSecret(): string {
  // Use production credentials by default
  const secret = Deno.env.get("QBO_CLIENT_SECRET_PRODUCTION");
  if (!secret) throw new Error("QBO_CLIENT_SECRET_PRODUCTION not configured");
  return secret;
}

function getQboRedirectUri(): string {
  // The redirect URI must match what's registered in the Intuit developer portal.
  // For Supabase Edge Functions, the callback route is at:
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl}/functions/v1/make-server-a8b2511f/quickbooks/oauth/callback`;
}

function getQboApiBase(): string {
  // Use production by default (can override with QBO_ENV=sandbox for testing)
  const env = Deno.env.get("QBO_ENV") || "production";
  return env === "sandbox" ? QBO_API_BASE_SANDBOX : QBO_API_BASE_PROD;
}

// ── Token management ──────────────────────────────────────────────────

interface QboConnection {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in ms
  realm_id: string;
  company_name?: string;
  user_email?: string;
  scope: string;
  status: "connected" | "disconnected" | "error";
  connected_at: string;
  last_refreshed_at?: string;
  last_sync_at?: string;
  error_message?: string;
}

async function getStoredConnection(userId: string): Promise<QboConnection | null> {
  const data = await kv.get(kvQboConnection(userId));
  if (!data) return null;
  return typeof data === "string" ? JSON.parse(data) : data;
}

async function storeConnection(userId: string, connection: QboConnection): Promise<void> {
  await kv.set(kvQboConnection(userId), connection);
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await getStoredConnection(userId);
  if (!connection || connection.status === "disconnected") return null;

  // Refresh if expiring within 2 minutes
  if (connection.expires_at < Date.now() + 2 * 60 * 1000) {
    console.log(`[QBO] Token expiring soon for user ${userId}, refreshing...`);
    try {
      const refreshed = await refreshToken(connection.refresh_token);
      connection.access_token = refreshed.access_token;
      connection.refresh_token = refreshed.refresh_token;
      connection.expires_at = Date.now() + refreshed.expires_in * 1000;
      connection.last_refreshed_at = new Date().toISOString();
      connection.status = "connected";
      connection.error_message = undefined;
      await storeConnection(userId, connection);
      console.log(`[QBO] Token refreshed successfully for user ${userId}`);

      await logSyncEvent(userId, {
        type: "token_refresh",
        success: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[QBO] Token refresh failed for user ${userId}:`, err.message);
      connection.status = "error";
      connection.error_message = "Token refresh failed. Please reconnect QuickBooks.";
      await storeConnection(userId, connection);

      await logSyncEvent(userId, {
        type: "token_refresh",
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      return null;
    }
  }

  return connection.access_token;
}

async function refreshToken(refreshTokenValue: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = getQboClientId();
  const clientSecret = getQboClientSecret();
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`,
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QBO token refresh failed (${res.status}): ${err}`);
  }

  return await res.json();
}

// ── Sync event logging ──────────────────────────────────────────────

async function logSyncEvent(userId: string, event: any): Promise<void> {
  try {
    const logKey = kvQboSyncLog(userId);
    const existing = (await kv.get(logKey)) || [];
    const logs = Array.isArray(existing) ? existing : [];
    logs.unshift(event);
    // Keep last 200 entries
    await kv.set(logKey, logs.slice(0, 200));
  } catch (err) {
    console.error("[QBO] Failed to log sync event:", err);
  }
}

// ── QBO API helper ────────────────────────────────────────────────────

async function qboApiFetch(
  accessToken: string,
  realmId: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const base = getQboApiBase();
  const url = `${base}/v3/company/${realmId}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      ...((options.headers as Record<string, string>) || {}),
    },
  });
}

// ── OAuth success/error HTML ──────────────────────────────────────────

function qboSuccessHtml(companyName?: string, realmId?: string): string {
  return `<!DOCTYPE html><html><head><title>QuickBooks Connected</title></head><body>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'quickbooks-oauth-success' }, '*');
    }
    localStorage.setItem('contndr-quickbooks-oauth-success', '1');
  } catch(e) {}
  setTimeout(function(){ window.close(); }, 300);
})();
</script>
<p style="font-family:system-ui;color:#999;text-align:center;margin-top:40vh">QuickBooks connected — closing&hellip;</p>
</body></html>`;
}

function qboErrorHtml(message: string): string {
  const safeMsg = message.replace(/'/g, "\\'").replace(/\n/g, " ");
  return `<!DOCTYPE html><html><head><title>QuickBooks Error</title></head><body>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'quickbooks-oauth-error', message: '${safeMsg}' }, '*');
    }
    localStorage.setItem('contndr-quickbooks-oauth-error', '${safeMsg}');
  } catch(e) {}
  setTimeout(function(){ window.close(); }, 300);
})();
</script>
<p style="font-family:system-ui;color:#ef4444;text-align:center;margin-top:40vh">Connection failed — closing&hellip;</p>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── GET /status — Check QuickBooks connection status ──
app.get("/status", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection || connection.status === "disconnected") {
      return c.json({ connected: false });
    }

    if (connection.status === "error") {
      return c.json({
        connected: false,
        error: connection.error_message || "Connection error. Please reconnect.",
        realm_id: connection.realm_id,
      });
    }

    // Verify token is still usable
    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({
        connected: false,
        error: "Token expired and could not be refreshed. Please reconnect.",
        realm_id: connection.realm_id,
      });
    }

    // Quick validation: fetch CompanyInfo
    let companyName = connection.company_name || "";
    try {
      const infoRes = await qboApiFetch(
        accessToken,
        connection.realm_id,
        "/companyinfo/" + connection.realm_id
      );
      if (infoRes.ok) {
        const infoData = await infoRes.json();
        companyName = infoData?.CompanyInfo?.CompanyName || companyName;
        // Update cached company name
        if (companyName && companyName !== connection.company_name) {
          connection.company_name = companyName;
          await storeConnection(user.id, connection);
        }
      }
    } catch (_) {
      // Non-critical — use cached data
    }

    return c.json({
      connected: true,
      realm_id: connection.realm_id,
      company_name: companyName,
      user_email: connection.user_email,
      scope: connection.scope,
      connected_at: connection.connected_at,
      last_sync_at: connection.last_sync_at,
      last_refreshed_at: connection.last_refreshed_at,
    });
  } catch (error: any) {
    console.error("[QBO] Status check error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /connect — Start OAuth flow (returns auth URL) ──
app.get("/connect", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);

    const appOrigin = c.req.query("origin") || "";

    // Create a CSRF state token
    const state = crypto.randomUUID();
    await kv.set(kvQboOAuthState(state), {
      userId: user.id,
      createdAt: Date.now(),
      appOrigin,
    });

    const params = new URLSearchParams({
      client_id: getQboClientId(),
      redirect_uri: getQboRedirectUri(),
      response_type: "code",
      scope: QBO_SCOPE,
      state,
    });

    const authUrl = `${QBO_AUTH_URL}?${params.toString()}`;

    console.log(`[QBO] OAuth flow started for user ${user.email}`);
    console.log(`[QBO] Redirect URI: ${getQboRedirectUri()}`);

    return c.json({ auth_url: authUrl });
  } catch (error: any) {
    console.error("[QBO] Connect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /oauth/callback — Handle OAuth callback from Intuit ──
app.get("/oauth/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const realmId = c.req.query("realmId");
    const errorParam = c.req.query("error");

    if (errorParam) {
      console.error(`[QBO] OAuth denied: ${errorParam}`);
      return htmlResponse(qboErrorHtml(`QuickBooks denied access: ${errorParam}`), 400);
    }

    if (!code || !state) {
      return htmlResponse(qboErrorHtml("Missing code or state parameter"), 400);
    }

    if (!realmId) {
      return htmlResponse(qboErrorHtml("Missing realmId. QuickBooks did not return a company identifier."), 400);
    }

    // Verify state
    const stateData = await kv.get(kvQboOAuthState(state));
    if (!stateData) {
      return htmlResponse(qboErrorHtml("Invalid or expired state. Please try connecting again."), 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;

    // Check state expiry (10 minutes)
    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(kvQboOAuthState(state));
      return htmlResponse(qboErrorHtml("OAuth state expired. Please try connecting again."), 400);
    }

    // One-time use
    await kv.del(kvQboOAuthState(state));

    const userId = parsedState.userId;
    console.log(`[QBO] OAuth callback for user: ${userId}, realmId: ${realmId}`);

    // Exchange code for tokens using Basic Auth
    const clientId = getQboClientId();
    const clientSecret = getQboClientSecret();
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    const tokenRes = await fetch(QBO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: getQboRedirectUri(),
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[QBO] Token exchange failed (${tokenRes.status}):`, errBody);
      return htmlResponse(qboErrorHtml(`Token exchange failed: ${errBody}`), 500);
    }

    const tokenData = await tokenRes.json();
    console.log("[QBO] Token exchange successful");

    // Fetch company info
    let companyName = "";
    let userEmail = "";
    try {
      const base = getQboApiBase();
      const companyRes = await fetch(
        `${base}/v3/company/${realmId}/companyinfo/${realmId}`,
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            Accept: "application/json",
          },
        }
      );
      if (companyRes.ok) {
        const companyData = await companyRes.json();
        companyName = companyData?.CompanyInfo?.CompanyName || "";
        userEmail = companyData?.CompanyInfo?.Email?.Address || "";
        console.log(`[QBO] Connected to company: ${companyName} (realm ${realmId})`);
      }
    } catch (err) {
      console.warn("[QBO] Could not fetch company info:", err);
    }

    // Store connection
    const connection: QboConnection = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
      realm_id: realmId,
      company_name: companyName,
      user_email: userEmail,
      scope: QBO_SCOPE,
      status: "connected",
      connected_at: new Date().toISOString(),
    };

    await storeConnection(userId, connection);

    await logSyncEvent(userId, {
      type: "oauth_connected",
      success: true,
      realm_id: realmId,
      company_name: companyName,
      timestamp: new Date().toISOString(),
    });

    console.log(`[QBO] Connection stored for user ${userId}`);
    return htmlResponse(qboSuccessHtml(companyName, realmId));
  } catch (error: any) {
    console.error("[QBO] OAuth callback error:", error);
    return htmlResponse(qboErrorHtml(`Unexpected error: ${error.message}`), 500);
  }
});

// ── POST /process-callback — Process OAuth callback from frontend component ──
// This mirrors /oauth/callback but accepts JSON body and returns JSON
app.post("/process-callback", async (c) => {
  try {
    const body = await c.req.json();
    const { code, state, realmId, error: errorParam } = body;

    if (errorParam) {
      return c.json({ success: false, error: `QuickBooks denied access: ${errorParam}` }, 400);
    }

    if (!code || !state) {
      return c.json({ success: false, error: "Missing code or state parameter" }, 400);
    }

    if (!realmId) {
      return c.json({ success: false, error: "Missing realmId" }, 400);
    }

    // Verify state
    const stateData = await kv.get(kvQboOAuthState(state));
    if (!stateData) {
      return c.json({ success: false, error: "Invalid or expired state. Please try connecting again." }, 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;

    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(kvQboOAuthState(state));
      return c.json({ success: false, error: "OAuth state expired. Please try connecting again." }, 400);
    }

    await kv.del(kvQboOAuthState(state));

    const userId = parsedState.userId;
    console.log(`[QBO] Process callback for user: ${userId}, realmId: ${realmId}`);

    // Exchange code for tokens
    const clientId = getQboClientId();
    const clientSecret = getQboClientSecret();
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    const tokenRes = await fetch(QBO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: getQboRedirectUri(),
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[QBO] Token exchange failed (${tokenRes.status}):`, errBody);
      return c.json({ success: false, error: `Token exchange failed: ${errBody}` }, 400);
    }

    const tokenData = await tokenRes.json();

    // Fetch company info
    let companyName = "";
    try {
      const base = getQboApiBase();
      const companyRes = await fetch(
        `${base}/v3/company/${realmId}/companyinfo/${realmId}`,
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            Accept: "application/json",
          },
        }
      );
      if (companyRes.ok) {
        const companyData = await companyRes.json();
        companyName = companyData?.CompanyInfo?.CompanyName || "";
      }
    } catch (err) {
      console.warn("[QBO] Could not fetch company info:", err);
    }

    // Store connection
    const connection: QboConnection = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
      realm_id: realmId,
      company_name: companyName,
      user_email: "",
      scope: QBO_SCOPE,
      status: "connected",
      connected_at: new Date().toISOString(),
    };

    await storeConnection(userId, connection);

    await logSyncEvent(userId, {
      type: "oauth_connected",
      success: true,
      realm_id: realmId,
      company_name: companyName,
      timestamp: new Date().toISOString(),
    });

    return c.json({
      success: true,
      realm_id: realmId,
      company_name: companyName,
    });
  } catch (error: any) {
    console.error("[QBO] Process callback error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ── POST /disconnect — Disconnect QuickBooks ──
app.post("/disconnect", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (connection) {
      // Try to revoke the token at Intuit
      try {
        const clientId = getQboClientId();
        const clientSecret = getQboClientSecret();
        const basicAuth = btoa(`${clientId}:${clientSecret}`);

        await fetch(QBO_REVOKE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Basic ${basicAuth}`,
            "Accept": "application/json",
          },
          body: JSON.stringify({ token: connection.refresh_token }),
        });
        console.log(`[QBO] Token revoked for user ${user.id}`);
      } catch (err) {
        console.warn("[QBO] Token revocation failed (non-critical):", err);
      }

      // Clear connection data
      connection.status = "disconnected";
      connection.access_token = "";
      connection.refresh_token = "";
      connection.error_message = undefined;
      await storeConnection(user.id, connection);
    }

    // Clear sync cursors and data
    const objectTypes = ["Customer", "Invoice", "Payment"];
    for (const objType of objectTypes) {
      try {
        await kv.del(kvQboSyncCursor(user.id, objType));
        await kv.del(kvQboSyncData(user.id, objType));
      } catch (_) {}
    }

    await logSyncEvent(user.id, {
      type: "disconnected",
      success: true,
      timestamp: new Date().toISOString(),
    });

    console.log(`[QBO] Disconnected for user ${user.id}`);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("[QBO] Disconnect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /sync/now — Manually trigger a full sync ──
app.post("/sync/now", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({ error: "Not connected or token expired. Please reconnect." }, 401);
    }

    const connection = await getStoredConnection(user.id);
    if (!connection) {
      return c.json({ error: "No QuickBooks connection found" }, 404);
    }

    const realmId = connection.realm_id;
    const results: Record<string, any> = {};

    // Sync Customers
    try {
      const customers = await syncObjectType(user.id, accessToken, realmId, "Customer");
      results.customers = { count: customers.length, success: true };
    } catch (err: any) {
      results.customers = { success: false, error: err.message };
    }

    // Sync Invoices
    try {
      const invoices = await syncObjectType(user.id, accessToken, realmId, "Invoice");
      results.invoices = { count: invoices.length, success: true };
    } catch (err: any) {
      results.invoices = { success: false, error: err.message };
    }

    // Sync Payments
    try {
      const payments = await syncObjectType(user.id, accessToken, realmId, "Payment");
      results.payments = { count: payments.length, success: true };
    } catch (err: any) {
      results.payments = { success: false, error: err.message };
    }

    // Update last_sync_at
    connection.last_sync_at = new Date().toISOString();
    await storeConnection(user.id, connection);

    await logSyncEvent(user.id, {
      type: "manual_sync",
      success: true,
      results,
      timestamp: new Date().toISOString(),
    });

    return c.json({ success: true, results, synced_at: connection.last_sync_at });
  } catch (error: any) {
    console.error("[QBO] Sync error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /sync/status — Get sync status and summary ──
app.get("/sync/status", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection || connection.status !== "connected") {
      return c.json({ connected: false });
    }

    const objectTypes = ["Customer", "Invoice", "Payment"];
    const summary: Record<string, any> = {};

    for (const objType of objectTypes) {
      const data = await kv.get(kvQboSyncData(user.id, objType));
      const items = Array.isArray(data) ? data : (data ? [data] : []);
      const cursor = await kv.get(kvQboSyncCursor(user.id, objType));
      summary[objType.toLowerCase()] = {
        count: items.length,
        last_synced: typeof cursor === "object" && cursor?.last_updated_time
          ? cursor.last_updated_time
          : null,
      };
    }

    return c.json({
      connected: true,
      last_sync_at: connection.last_sync_at,
      summary,
    });
  } catch (error: any) {
    console.error("[QBO] Sync status error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /data/:type — Get synced data ──
app.get("/data/:type", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const objectType = c.req.param("type");

    const validTypes = ["customers", "invoices", "payments"];
    if (!validTypes.includes(objectType)) {
      return c.json({ error: "Invalid type. Use: customers, invoices, payments" }, 400);
    }

    // Map plural to singular
    const typeMap: Record<string, string> = {
      customers: "Customer",
      invoices: "Invoice",
      payments: "Payment",
    };

    const data = await kv.get(kvQboSyncData(user.id, typeMap[objectType]));
    const items = Array.isArray(data) ? data : (data ? [data] : []);

    return c.json({ success: true, type: objectType, count: items.length, data: items });
  } catch (error: any) {
    console.error("[QBO] Data fetch error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /sync-logs — Get sync activity log ──
app.get("/sync-logs", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const logKey = kvQboSyncLog(user.id);
    const logs = (await kv.get(logKey)) || [];
    return c.json({ logs: Array.isArray(logs) ? logs : [] });
  } catch (error: any) {
    console.error("[QBO] Sync logs error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /company-info — Get connected company details ──
app.get("/company-info", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({ error: "Not connected or token expired" }, 401);
    }

    const connection = await getStoredConnection(user.id);
    if (!connection) {
      return c.json({ error: "No connection found" }, 404);
    }

    const res = await qboApiFetch(
      accessToken,
      connection.realm_id,
      `/companyinfo/${connection.realm_id}`
    );

    if (!res.ok) {
      const errText = await res.text();
      return c.json({ error: `Failed to fetch company info: ${errText}` }, res.status);
    }

    const data = await res.json();
    return c.json({ success: true, company: data.CompanyInfo });
  } catch (error: any) {
    console.error("[QBO] Company info error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /revenue-summary — Computed revenue metrics from synced QBO data ──
app.get("/revenue-summary", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection || connection.status !== "connected") {
      return c.json({ connected: false });
    }

    // Fetch synced invoices, payments, customers
    const [invoicesRaw, paymentsRaw, customersRaw] = await Promise.all([
      kv.get(kvQboSyncData(user.id, "Invoice")),
      kv.get(kvQboSyncData(user.id, "Payment")),
      kv.get(kvQboSyncData(user.id, "Customer")),
    ]);

    const invoices = Array.isArray(invoicesRaw) ? invoicesRaw : [];
    const payments = Array.isArray(paymentsRaw) ? paymentsRaw : [];
    const customers = Array.isArray(customersRaw) ? customersRaw : [];

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Compute metrics from invoices
    let totalInvoiced = 0;
    let totalOutstanding = 0;
    let monthlyInvoiced = 0;
    let paidInvoices = 0;
    let overdueInvoices = 0;

    const recentInvoices: any[] = [];

    for (const inv of invoices) {
      const amt = parseFloat(inv.TotalAmt) || 0;
      const balance = parseFloat(inv.Balance) || 0;
      totalInvoiced += amt;
      totalOutstanding += balance;

      if (balance === 0) paidInvoices++;

      const createDate = new Date(inv.MetaData?.CreateTime || inv.TxnDate || 0);
      if (createDate >= startOfMonth) monthlyInvoiced += amt;

      if (balance > 0 && inv.DueDate) {
        const due = new Date(inv.DueDate);
        if (due < now) overdueInvoices++;
      }

      recentInvoices.push({
        id: inv.Id,
        doc_number: inv.DocNumber,
        customer: inv.CustomerRef?.name || "Unknown",
        amount: amt,
        balance: balance,
        date: inv.TxnDate || inv.MetaData?.CreateTime,
        due_date: inv.DueDate,
        status:
          balance === 0
            ? "paid"
            : inv.DueDate && new Date(inv.DueDate) < now
            ? "overdue"
            : "open",
      });
    }

    // Sort recent invoices by date descending
    recentInvoices.sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Compute payment metrics
    let totalReceived = 0;
    let monthlyReceived = 0;
    let weeklyReceived = 0;
    let dailyReceived = 0;

    for (const pmt of payments) {
      const amt = parseFloat(pmt.TotalAmt) || 0;
      totalReceived += amt;

      const createDate = new Date(
        pmt.MetaData?.CreateTime || pmt.TxnDate || 0
      );
      if (createDate >= startOfMonth) monthlyReceived += amt;
      if (createDate >= startOfWeek) weeklyReceived += amt;
      if (createDate >= startOfDay) dailyReceived += amt;
    }

    return c.json({
      success: true,
      connected: true,
      company_name: connection.company_name,
      metrics: {
        total_invoiced: totalInvoiced,
        total_received: totalReceived,
        total_outstanding: totalOutstanding,
        monthly_invoiced: monthlyInvoiced,
        monthly_received: monthlyReceived,
        weekly_received: weeklyReceived,
        daily_received: dailyReceived,
        total_customers: customers.length,
        total_invoices: invoices.length,
        paid_invoices: paidInvoices,
        overdue_invoices: overdueInvoices,
        collection_rate:
          invoices.length > 0 ? (paidInvoices / invoices.length) * 100 : 0,
      },
      recent_invoices: recentInvoices.slice(0, 20),
      last_sync_at: connection.last_sync_at,
    });
  } catch (error: any) {
    console.error("[QBO] Revenue summary error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;