// ══════════════════════════════════════════════════════════════════════════
// HubSpot OAuth + CRM Integration for Contndr
// OAuth connect, token management, contact/company export, association
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { htmlResponse } from "./html-response.tsx";

const app = new Hono();
app.use("*", cors());

// ── Constants ──────────────────────────────────────────────────────────
const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const SCOPES = [
  "crm.objects.contacts.write",
  "crm.objects.contacts.read",
  "crm.objects.companies.write",
  "crm.objects.companies.read",
  "crm.schemas.contacts.read",
  "crm.objects.deals.write",
  "oauth",
];

// ── KV key helpers ────────────────────────────────────────────────────
function kvHubSpotConnection(userId: string) {
  return `hubspot_connection:${userId}`;
}
function kvHubSpotExportLog(userId: string) {
  return `hubspot_export_log:${userId}`;
}
function kvHubSpotContactMap(userId: string, email: string) {
  return `hubspot_contact:${userId}:${email.toLowerCase()}`;
}
function kvHubSpotCompanyMap(userId: string, domain: string) {
  return `hubspot_company:${userId}:${domain.toLowerCase()}`;
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
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "HUBSPOT");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── Get HubSpot OAuth credentials ──
function getHubSpotClientId(): string {
  const id = Deno.env.get("HUBSPOT_CLIENT_ID");
  if (!id) throw new Error("HUBSPOT_CLIENT_ID not configured");
  return id;
}

function getHubSpotClientSecret(): string {
  const secret = Deno.env.get("HUBSPOT_CLIENT_SECRET");
  if (!secret) throw new Error("HUBSPOT_CLIENT_SECRET not configured");
  return secret;
}

function getRedirectUri(): string {
  return "https://contndr.com/api/integrations/hubspot/callback";
}

// ── Token management ──────────────────────────────────────────────────

interface HubSpotConnection {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in ms
  hubspot_portal_id?: string;
  hubspot_user?: string;
  connected_at: string;
  last_refreshed_at?: string;
}

async function getStoredConnection(userId: string): Promise<HubSpotConnection | null> {
  const data = await kv.get(kvHubSpotConnection(userId));
  if (!data) return null;
  // Handle string or object
  return typeof data === "string" ? JSON.parse(data) : data;
}

async function storeConnection(userId: string, connection: HubSpotConnection): Promise<void> {
  await kv.set(kvHubSpotConnection(userId), connection);
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await getStoredConnection(userId);
  if (!connection) return null;

  // Refresh if expiring within 5 minutes
  if (connection.expires_at < Date.now() + 5 * 60 * 1000) {
    console.log(`[HUBSPOT] Token expiring soon for user ${userId}, refreshing...`);
    try {
      const refreshed = await refreshToken(connection.refresh_token);
      connection.access_token = refreshed.access_token;
      connection.refresh_token = refreshed.refresh_token;
      connection.expires_at = Date.now() + refreshed.expires_in * 1000;
      connection.last_refreshed_at = new Date().toISOString();
      await storeConnection(userId, connection);
      console.log(`[HUBSPOT] Token refreshed successfully for user ${userId}`);

      // Log refresh event
      await logExportEvent(userId, {
        type: "token_refresh",
        success: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[HUBSPOT] Token refresh failed for user ${userId}:`, err.message);

      // Log failed refresh
      await logExportEvent(userId, {
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
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: getHubSpotClientId(),
      client_secret: getHubSpotClientSecret(),
      refresh_token: refreshTokenValue,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot token refresh failed (${res.status}): ${err}`);
  }

  return await res.json();
}

// ── Export event logging ──────────────────────────────────────────────

async function logExportEvent(userId: string, event: any): Promise<void> {
  try {
    const logKey = kvHubSpotExportLog(userId);
    const existing = (await kv.get(logKey)) || [];
    const logs = Array.isArray(existing) ? existing : [];
    logs.unshift(event);
    // Keep last 200 entries
    await kv.set(logKey, logs.slice(0, 200));
  } catch (err) {
    console.error("[HUBSPOT] Failed to log export event:", err);
  }
}

// ── HubSpot API helper ────────────────────────────────────────────────

async function hubspotApiFetch(
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith("http") ? endpoint : `${HUBSPOT_API_BASE}${endpoint}`;
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

function hubspotSuccessHtml(portalId?: string): string {
  return `<!DOCTYPE html><html><head><title>HubSpot Connected</title></head><body>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'hubspot-oauth-success' }, '*');
    }
    localStorage.setItem('contndr-hubspot-oauth-success', '1');
  } catch(e) {}
  setTimeout(function(){ window.close(); }, 300);
})();
</script>
<p style="font-family:system-ui;color:#999;text-align:center;margin-top:40vh">HubSpot connected — closing&hellip;</p>
</body></html>`;
}

function hubspotErrorHtml(message: string): string {
  const safeMsg = message.replace(/'/g, "\\'").replace(/\n/g, " ");
  return `<!DOCTYPE html><html><head><title>HubSpot Error</title></head><body>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'hubspot-oauth-error', message: '${safeMsg}' }, '*');
    }
    localStorage.setItem('contndr-hubspot-oauth-error', '${safeMsg}');
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

// ── GET /status — Check HubSpot connection status ──
app.get("/status", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection) {
      return c.json({ connected: false });
    }

    // Check if token is still valid by calling a lightweight HubSpot endpoint
    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({
        connected: false,
        error: "Token expired and could not be refreshed. Please reconnect.",
      });
    }

    // Verify the token works with a quick API call
    try {
      const res = await hubspotApiFetch(accessToken, "/oauth/v1/access-tokens/" + accessToken);
      if (res.ok) {
        const tokenInfo = await res.json();
        return c.json({
          connected: true,
          portal_id: tokenInfo.hub_id || connection.hubspot_portal_id,
          user: tokenInfo.user || connection.hubspot_user,
          connected_at: connection.connected_at,
          scopes: tokenInfo.scopes || [],
        });
      }
    } catch (_) {
      // Token validation failed, but connection might still be valid
    }

    return c.json({
      connected: true,
      portal_id: connection.hubspot_portal_id,
      connected_at: connection.connected_at,
    });
  } catch (error: any) {
    console.error("[HUBSPOT] Status check error:", error);
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
    await kv.set(`hubspot_oauth_state:${state}`, {
      userId: user.id,
      createdAt: Date.now(),
      appOrigin,
    });

    const params = new URLSearchParams({
      client_id: getHubSpotClientId(),
      redirect_uri: getRedirectUri(),
      scope: SCOPES.join(" "),
      state,
    });

    const authUrl = `${HUBSPOT_AUTH_URL}?${params.toString()}`;

    console.log(`[HUBSPOT] OAuth flow started for user ${user.email}`);
    console.log(`[HUBSPOT] Redirect URI: ${getRedirectUri()}`);

    return c.json({ auth_url: authUrl });
  } catch (error: any) {
    console.error("[HUBSPOT] Connect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /oauth/callback — Handle OAuth callback from HubSpot ──
app.get("/oauth/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const errorParam = c.req.query("error");

    if (errorParam) {
      console.error(`[HUBSPOT] OAuth denied: ${errorParam}`);
      return htmlResponse(hubspotErrorHtml(`HubSpot denied access: ${errorParam}`), 400);
    }

    if (!code || !state) {
      return htmlResponse(hubspotErrorHtml("Missing code or state parameter"), 400);
    }

    // Verify state
    const stateData = await kv.get(`hubspot_oauth_state:${state}`);
    if (!stateData) {
      return htmlResponse(hubspotErrorHtml("Invalid or expired state. Please try connecting again."), 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;

    // Check state expiry (10 minutes)
    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(`hubspot_oauth_state:${state}`);
      return htmlResponse(hubspotErrorHtml("OAuth state expired. Please try connecting again."), 400);
    }

    // One-time use
    await kv.del(`hubspot_oauth_state:${state}`);

    const userId = parsedState.userId;
    console.log(`[HUBSPOT] OAuth callback for user: ${userId}`);

    // Exchange code for tokens
    const tokenRes = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: getHubSpotClientId(),
        client_secret: getHubSpotClientSecret(),
        redirect_uri: getRedirectUri(),
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[HUBSPOT] Token exchange failed (${tokenRes.status}):`, errBody);
      return htmlResponse(hubspotErrorHtml(`Token exchange failed: ${errBody}`), 500);
    }

    const tokenData = await tokenRes.json();
    console.log("[HUBSPOT] Token exchange successful");

    // Get portal/account info
    let portalId = "";
    let hubspotUser = "";
    try {
      const infoRes = await fetch(
        `${HUBSPOT_API_BASE}/oauth/v1/access-tokens/${tokenData.access_token}`
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        portalId = String(info.hub_id || "");
        hubspotUser = info.user || "";
        console.log(`[HUBSPOT] Connected to portal: ${portalId}, user: ${hubspotUser}`);
      }
    } catch (err) {
      console.warn("[HUBSPOT] Could not fetch portal info:", err);
    }

    // Store connection
    const connection: HubSpotConnection = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      hubspot_portal_id: portalId,
      hubspot_user: hubspotUser,
      connected_at: new Date().toISOString(),
    };

    await storeConnection(userId, connection);

    // Log connection event
    await logExportEvent(userId, {
      type: "oauth_connect",
      success: true,
      portal_id: portalId,
      timestamp: new Date().toISOString(),
    });

    console.log(`[HUBSPOT] Connection stored for user ${userId}`);

    return htmlResponse(hubspotSuccessHtml(portalId));
  } catch (error: any) {
    console.error("[HUBSPOT] OAuth callback error:", error);
    return htmlResponse(hubspotErrorHtml(error.message), 500);
  }
});

// ── POST /process-callback — SPA-friendly token exchange ──────────────
// The OAuth redirect now lands on the frontend SPA at
// https://contndr.com/api/integrations/hubspot/callback
// That page reads the query params and POSTs { code, state } here.
app.post("/process-callback", async (c) => {
  try {
    const body = await c.req.json();
    const { code, state, error: errorParam, error_description: errorDescription } = body;

    if (errorParam) {
      console.error(`[HUBSPOT] OAuth denied (process-callback): ${errorParam} - ${errorDescription}`);
      if (state) {
        try { await kv.del(`hubspot_oauth_state:${state}`); } catch (_) {}
      }
      return c.json({ success: false, error: `HubSpot denied access: ${errorDescription || errorParam}` }, 400);
    }

    if (!code || !state) {
      return c.json({ success: false, error: "Missing code or state parameter" }, 400);
    }

    // Verify state
    const stateData = await kv.get(`hubspot_oauth_state:${state}`);
    if (!stateData) {
      return c.json({ success: false, error: "Invalid or expired state. Please try connecting again." }, 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;

    // Check state expiry (10 minutes)
    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(`hubspot_oauth_state:${state}`);
      return c.json({ success: false, error: "OAuth state expired. Please try connecting again." }, 400);
    }

    // One-time use
    await kv.del(`hubspot_oauth_state:${state}`);

    const userId = parsedState.userId;
    console.log(`[HUBSPOT] process-callback for user: ${userId}`);

    // Exchange code for tokens
    const tokenRes = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: getHubSpotClientId(),
        client_secret: getHubSpotClientSecret(),
        redirect_uri: getRedirectUri(),
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[HUBSPOT] Token exchange failed (${tokenRes.status}):`, errBody);
      return c.json({ success: false, error: "Token exchange failed. Please try again." }, 400);
    }

    const tokenData = await tokenRes.json();
    console.log("[HUBSPOT] Token exchange successful (process-callback)");

    // Get portal/account info
    let portalId = "";
    let hubspotUser = "";
    try {
      const infoRes = await fetch(
        `${HUBSPOT_API_BASE}/oauth/v1/access-tokens/${tokenData.access_token}`
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        portalId = String(info.hub_id || "");
        hubspotUser = info.user || "";
        console.log(`[HUBSPOT] Connected to portal: ${portalId}, user: ${hubspotUser}`);
      }
    } catch (err) {
      console.warn("[HUBSPOT] Could not fetch portal info:", err);
    }

    // Store connection
    const connection: HubSpotConnection = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      hubspot_portal_id: portalId,
      hubspot_user: hubspotUser,
      connected_at: new Date().toISOString(),
    };

    await storeConnection(userId, connection);

    await logExportEvent(userId, {
      type: "oauth_connect",
      success: true,
      portal_id: portalId,
      timestamp: new Date().toISOString(),
    });

    console.log(`[HUBSPOT] Connection stored for user ${userId} (process-callback)`);

    return c.json({
      success: true,
      portal_id: portalId,
      user: hubspotUser,
    });
  } catch (error: any) {
    console.error("[HUBSPOT] process-callback error:", error);
    return c.json({ success: false, error: "An unexpected error occurred. Please try again." }, 500);
  }
});

// ── POST /disconnect — Remove HubSpot connection ──
app.post("/disconnect", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);

    await kv.del(kvHubSpotConnection(user.id));

    await logExportEvent(user.id, {
      type: "disconnect",
      timestamp: new Date().toISOString(),
    });

    console.log(`[HUBSPOT] Disconnected for user ${user.id}`);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("[HUBSPOT] Disconnect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── GET /export-logs — Get recent export logs ──
app.get("/export-logs", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const logs = (await kv.get(kvHubSpotExportLog(user.id))) || [];
    return c.json({ logs: Array.isArray(logs) ? logs : [] });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// EXPORT ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

// ── POST /export/contact — Export a single contact to HubSpot ──
app.post("/export/contact", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({ error: "HubSpot not connected or token expired. Please reconnect." }, 401);
    }

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
    } = body;

    if (!email && !first_name && !last_name) {
      return c.json({ error: "At least email or name is required to export a contact" }, 400);
    }

    // Duplicate check: search by email first
    let existingContactId: string | null = null;
    if (email) {
      // Check our local cache first
      const cached = await kv.get(kvHubSpotContactMap(user.id, email));
      if (cached) {
        const cachedData = typeof cached === "string" ? JSON.parse(cached) : cached;
        existingContactId = cachedData.hubspot_contact_id;
      }

      // Also check HubSpot directly
      if (!existingContactId) {
        try {
          const searchRes = await hubspotApiFetch(
            accessToken,
            "/crm/v3/objects/contacts/search",
            {
              method: "POST",
              body: JSON.stringify({
                filterGroups: [
                  {
                    filters: [
                      {
                        propertyName: "email",
                        operator: "EQ",
                        value: email.toLowerCase(),
                      },
                    ],
                  },
                ],
              }),
            }
          );

          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.total > 0) {
              existingContactId = searchData.results[0].id;
            }
          }
        } catch (err) {
          console.warn("[HUBSPOT] Contact search failed:", err);
        }
      }
    }

    // Build HubSpot properties
    const properties: Record<string, string> = {};
    if (first_name) properties.firstname = first_name;
    if (last_name) properties.lastname = last_name;
    if (email) properties.email = email.toLowerCase();
    if (phone) properties.phone = phone;
    if (job_title) properties.jobtitle = job_title;
    if (company_name) properties.company = company_name;
    if (linkedin_url) properties.hs_linkedin_url = linkedin_url;
    if (city) properties.city = city;
    if (state) properties.state = state;
    if (country) properties.country = country;

    let hubspotContactId: string;
    let action: "created" | "updated";

    if (existingContactId) {
      // Update existing contact
      const updateRes = await hubspotApiFetch(
        accessToken,
        `/crm/v3/objects/contacts/${existingContactId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        }
      );

      if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error(`[HUBSPOT] Contact update failed: ${err}`);

        await logExportEvent(user.id, {
          type: "export_contact",
          success: false,
          action: "update",
          email,
          error: err,
          timestamp: new Date().toISOString(),
        });

        return c.json({ error: `Failed to update contact: ${err}` }, 400);
      }

      hubspotContactId = existingContactId;
      action = "updated";
    } else {
      // Create new contact
      const createRes = await hubspotApiFetch(
        accessToken,
        "/crm/v3/objects/contacts",
        {
          method: "POST",
          body: JSON.stringify({ properties }),
        }
      );

      if (!createRes.ok) {
        const err = await createRes.text();
        console.error(`[HUBSPOT] Contact creation failed: ${err}`);

        // Check for specific error: duplicate (409 Conflict)
        if (createRes.status === 409) {
          await logExportEvent(user.id, {
            type: "export_contact",
            success: false,
            action: "create",
            email,
            error: "Duplicate contact exists in HubSpot",
            timestamp: new Date().toISOString(),
          });
          return c.json({ error: "A contact with this email already exists in HubSpot", duplicate: true }, 409);
        }

        await logExportEvent(user.id, {
          type: "export_contact",
          success: false,
          action: "create",
          email,
          error: err,
          timestamp: new Date().toISOString(),
        });

        return c.json({ error: `Failed to create contact: ${err}` }, 400);
      }

      const createData = await createRes.json();
      hubspotContactId = createData.id;
      action = "created";
    }

    // Cache the mapping
    if (email) {
      await kv.set(kvHubSpotContactMap(user.id, email), {
        hubspot_contact_id: hubspotContactId,
        exported_at: new Date().toISOString(),
      });
    }

    // Log success
    await logExportEvent(user.id, {
      type: "export_contact",
      success: true,
      action,
      email,
      hubspot_contact_id: hubspotContactId,
      timestamp: new Date().toISOString(),
    });

    console.log(`[HUBSPOT] Contact ${action}: ${email} -> HubSpot ID ${hubspotContactId}`);

    return c.json({
      success: true,
      action,
      hubspot_contact_id: hubspotContactId,
    });
  } catch (error: any) {
    console.error("[HUBSPOT] Export contact error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /export/company — Export a single company to HubSpot ──
app.post("/export/company", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({ error: "HubSpot not connected or token expired. Please reconnect." }, 401);
    }

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

    // Duplicate check: search by domain
    let existingCompanyId: string | null = null;
    const searchDomain = domain || (website ? new URL(website.startsWith("http") ? website : `https://${website}`).hostname : "");

    if (searchDomain) {
      // Check local cache
      const cached = await kv.get(kvHubSpotCompanyMap(user.id, searchDomain));
      if (cached) {
        const cachedData = typeof cached === "string" ? JSON.parse(cached) : cached;
        existingCompanyId = cachedData.hubspot_company_id;
      }

      // Check HubSpot
      if (!existingCompanyId) {
        try {
          const searchRes = await hubspotApiFetch(
            accessToken,
            "/crm/v3/objects/companies/search",
            {
              method: "POST",
              body: JSON.stringify({
                filterGroups: [
                  {
                    filters: [
                      {
                        propertyName: "domain",
                        operator: "EQ",
                        value: searchDomain,
                      },
                    ],
                  },
                ],
              }),
            }
          );

          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.total > 0) {
              existingCompanyId = searchData.results[0].id;
            }
          }
        } catch (err) {
          console.warn("[HUBSPOT] Company search failed:", err);
        }
      }
    }

    // Build HubSpot properties
    const properties: Record<string, string> = {};
    if (company_name) properties.name = company_name;
    if (searchDomain) properties.domain = searchDomain;
    if (industry) properties.industry = industry;
    if (employee_count) properties.numberofemployees = String(employee_count);
    if (city) properties.city = city;
    if (state) properties.state = state;
    if (country) properties.country = country;
    if (phone) properties.phone = phone;
    if (website) properties.website = website;
    if (description) properties.description = description;

    let hubspotCompanyId: string;
    let action: "created" | "updated";

    if (existingCompanyId) {
      const updateRes = await hubspotApiFetch(
        accessToken,
        `/crm/v3/objects/companies/${existingCompanyId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        }
      );

      if (!updateRes.ok) {
        const err = await updateRes.text();
        await logExportEvent(user.id, {
          type: "export_company",
          success: false,
          action: "update",
          company_name,
          error: err,
          timestamp: new Date().toISOString(),
        });
        return c.json({ error: `Failed to update company: ${err}` }, 400);
      }

      hubspotCompanyId = existingCompanyId;
      action = "updated";
    } else {
      const createRes = await hubspotApiFetch(
        accessToken,
        "/crm/v3/objects/companies",
        {
          method: "POST",
          body: JSON.stringify({ properties }),
        }
      );

      if (!createRes.ok) {
        const err = await createRes.text();
        await logExportEvent(user.id, {
          type: "export_company",
          success: false,
          action: "create",
          company_name,
          error: err,
          timestamp: new Date().toISOString(),
        });
        return c.json({ error: `Failed to create company: ${err}` }, 400);
      }

      const createData = await createRes.json();
      hubspotCompanyId = createData.id;
      action = "created";
    }

    // Cache the mapping
    if (searchDomain) {
      await kv.set(kvHubSpotCompanyMap(user.id, searchDomain), {
        hubspot_company_id: hubspotCompanyId,
        exported_at: new Date().toISOString(),
      });
    }

    await logExportEvent(user.id, {
      type: "export_company",
      success: true,
      action,
      company_name,
      hubspot_company_id: hubspotCompanyId,
      timestamp: new Date().toISOString(),
    });

    console.log(`[HUBSPOT] Company ${action}: ${company_name} -> HubSpot ID ${hubspotCompanyId}`);

    return c.json({
      success: true,
      action,
      hubspot_company_id: hubspotCompanyId,
    });
  } catch (error: any) {
    console.error("[HUBSPOT] Export company error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /export/associate — Associate a contact with a company ──
app.post("/export/associate", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { hubspot_contact_id, hubspot_company_id } = await c.req.json();

    if (!hubspot_contact_id || !hubspot_company_id) {
      return c.json({ error: "Both hubspot_contact_id and hubspot_company_id are required" }, 400);
    }

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({ error: "HubSpot not connected or token expired" }, 401);
    }

    // Create association: contact -> company
    const assocRes = await hubspotApiFetch(
      accessToken,
      `/crm/v4/objects/contacts/${hubspot_contact_id}/associations/companies/${hubspot_company_id}`,
      {
        method: "PUT",
        body: JSON.stringify([
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: 1, // contact_to_company
          },
        ]),
      }
    );

    if (!assocRes.ok) {
      const err = await assocRes.text();
      console.error(`[HUBSPOT] Association failed: ${err}`);
      return c.json({ error: `Association failed: ${err}` }, 400);
    }

    await logExportEvent(user.id, {
      type: "association",
      success: true,
      hubspot_contact_id,
      hubspot_company_id,
      timestamp: new Date().toISOString(),
    });

    console.log(`[HUBSPOT] Associated contact ${hubspot_contact_id} with company ${hubspot_company_id}`);

    return c.json({ success: true });
  } catch (error: any) {
    console.error("[HUBSPOT] Association error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /export/lead — Full lead export (contact + company + association) ──
app.post("/export/lead", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({ error: "HubSpot not connected or token expired" }, 401);
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

    let hubspotContactId: string | null = null;
    let hubspotCompanyId: string | null = null;
    let contactAction: string = "skipped";
    let companyAction: string = "skipped";

    // 1. Export company first (if we have company data)
    if (company_name || domain || website) {
      const companyDomain = domain || (website ? (() => {
        try {
          return new URL(website.startsWith("http") ? website : `https://${website}`).hostname;
        } catch { return ""; }
      })() : "");

      // Search for existing company
      if (companyDomain) {
        try {
          const searchRes = await hubspotApiFetch(
            accessToken,
            "/crm/v3/objects/companies/search",
            {
              method: "POST",
              body: JSON.stringify({
                filterGroups: [{
                  filters: [{
                    propertyName: "domain",
                    operator: "EQ",
                    value: companyDomain,
                  }],
                }],
              }),
            }
          );
          if (searchRes.ok) {
            const data = await searchRes.json();
            if (data.total > 0) hubspotCompanyId = data.results[0].id;
          }
        } catch (_) {}
      }

      const companyProps: Record<string, string> = {};
      if (company_name) companyProps.name = company_name;
      if (companyDomain) companyProps.domain = companyDomain;
      if (industry) companyProps.industry = industry;
      if (employee_count) companyProps.numberofemployees = String(employee_count);
      if (website) companyProps.website = website;
      if (description) companyProps.description = description;

      if (hubspotCompanyId) {
        // Update
        await hubspotApiFetch(accessToken, `/crm/v3/objects/companies/${hubspotCompanyId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: companyProps }),
        });
        companyAction = "updated";
      } else {
        const res = await hubspotApiFetch(accessToken, "/crm/v3/objects/companies", {
          method: "POST",
          body: JSON.stringify({ properties: companyProps }),
        });
        if (res.ok) {
          const data = await res.json();
          hubspotCompanyId = data.id;
          companyAction = "created";
        }
      }

      // Cache
      if (companyDomain && hubspotCompanyId) {
        await kv.set(kvHubSpotCompanyMap(user.id, companyDomain), {
          hubspot_company_id: hubspotCompanyId,
          exported_at: new Date().toISOString(),
        });
      }
    }

    // 2. Export contact
    if (email || first_name || last_name) {
      // Search for existing contact
      if (email) {
        try {
          const searchRes = await hubspotApiFetch(
            accessToken,
            "/crm/v3/objects/contacts/search",
            {
              method: "POST",
              body: JSON.stringify({
                filterGroups: [{
                  filters: [{
                    propertyName: "email",
                    operator: "EQ",
                    value: email.toLowerCase(),
                  }],
                }],
              }),
            }
          );
          if (searchRes.ok) {
            const data = await searchRes.json();
            if (data.total > 0) hubspotContactId = data.results[0].id;
          }
        } catch (_) {}
      }

      const contactProps: Record<string, string> = {};
      if (first_name) contactProps.firstname = first_name;
      if (last_name) contactProps.lastname = last_name;
      if (email) contactProps.email = email.toLowerCase();
      if (phone) contactProps.phone = phone;
      if (job_title) contactProps.jobtitle = job_title;
      if (company_name) contactProps.company = company_name;
      if (linkedin_url) contactProps.hs_linkedin_url = linkedin_url;
      if (city) contactProps.city = city;
      if (state) contactProps.state = state;
      if (country) contactProps.country = country;

      if (hubspotContactId) {
        await hubspotApiFetch(accessToken, `/crm/v3/objects/contacts/${hubspotContactId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: contactProps }),
        });
        contactAction = "updated";
      } else {
        const res = await hubspotApiFetch(accessToken, "/crm/v3/objects/contacts", {
          method: "POST",
          body: JSON.stringify({ properties: contactProps }),
        });
        if (res.ok) {
          const data = await res.json();
          hubspotContactId = data.id;
          contactAction = "created";
        }
      }

      // Cache
      if (email && hubspotContactId) {
        await kv.set(kvHubSpotContactMap(user.id, email), {
          hubspot_contact_id: hubspotContactId,
          exported_at: new Date().toISOString(),
        });
      }
    }

    // 3. Associate contact <-> company
    let associated = false;
    if (hubspotContactId && hubspotCompanyId) {
      try {
        const assocRes = await hubspotApiFetch(
          accessToken,
          `/crm/v4/objects/contacts/${hubspotContactId}/associations/companies/${hubspotCompanyId}`,
          {
            method: "PUT",
            body: JSON.stringify([
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 1,
              },
            ]),
          }
        );
        associated = assocRes.ok;
      } catch (_) {}
    }

    // Log the full export
    await logExportEvent(user.id, {
      type: "export_lead",
      success: true,
      email,
      company_name,
      contact: { id: hubspotContactId, action: contactAction },
      company: { id: hubspotCompanyId, action: companyAction },
      associated,
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[HUBSPOT] Lead exported: contact=${hubspotContactId} (${contactAction}), company=${hubspotCompanyId} (${companyAction}), associated=${associated}`
    );

    return c.json({
      success: true,
      contact: { hubspot_id: hubspotContactId, action: contactAction },
      company: { hubspot_id: hubspotCompanyId, action: companyAction },
      associated,
    });
  } catch (error: any) {
    console.error("[HUBSPOT] Lead export error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// ── POST /export/bulk — Bulk export multiple leads ──
app.post("/export/bulk", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const { leads } = await c.req.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return c.json({ error: "No leads provided" }, 400);
    }

    if (leads.length > 100) {
      return c.json({ error: "Maximum 100 leads per bulk export" }, 400);
    }

    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      return c.json({ error: "HubSpot not connected or token expired" }, 401);
    }

    const results = {
      exported: 0,
      updated: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process in sequence to respect rate limits
    for (const lead of leads) {
      try {
        const contactProps: Record<string, string> = {};
        if (lead.first_name) contactProps.firstname = lead.first_name;
        if (lead.last_name) contactProps.lastname = lead.last_name;
        if (lead.email) contactProps.email = lead.email.toLowerCase();
        if (lead.phone) contactProps.phone = lead.phone;
        if (lead.job_title || lead.title) contactProps.jobtitle = lead.job_title || lead.title;
        if (lead.company_name || lead.business_name) contactProps.company = lead.company_name || lead.business_name;

        // Check for existing
        let existingId: string | null = null;
        if (lead.email) {
          try {
            const searchRes = await hubspotApiFetch(
              accessToken,
              "/crm/v3/objects/contacts/search",
              {
                method: "POST",
                body: JSON.stringify({
                  filterGroups: [{
                    filters: [{
                      propertyName: "email",
                      operator: "EQ",
                      value: lead.email.toLowerCase(),
                    }],
                  }],
                }),
              }
            );
            if (searchRes.ok) {
              const data = await searchRes.json();
              if (data.total > 0) existingId = data.results[0].id;
            }
          } catch (_) {}
        }

        if (existingId) {
          await hubspotApiFetch(accessToken, `/crm/v3/objects/contacts/${existingId}`, {
            method: "PATCH",
            body: JSON.stringify({ properties: contactProps }),
          });
          results.updated++;
        } else {
          const res = await hubspotApiFetch(accessToken, "/crm/v3/objects/contacts", {
            method: "POST",
            body: JSON.stringify({ properties: contactProps }),
          });
          if (res.ok) {
            results.exported++;
          } else {
            const err = await res.text();
            results.failed++;
            results.errors.push(`${lead.email || lead.first_name}: ${err}`);
          }
        }

        // Brief delay to avoid rate limits (HubSpot: 100 requests/10 seconds)
        await new Promise((r) => setTimeout(r, 120));
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${lead.email || "unknown"}: ${err.message}`);
      }
    }

    await logExportEvent(user.id, {
      type: "bulk_export",
      total: leads.length,
      exported: results.exported,
      updated: results.updated,
      failed: results.failed,
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[HUBSPOT] Bulk export: ${results.exported} created, ${results.updated} updated, ${results.failed} failed out of ${leads.length}`
    );

    return c.json({ success: true, results });
  } catch (error: any) {
    console.error("[HUBSPOT] Bulk export error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;