// ══════════════════════════════════════════════════════════════════════════
// Slack OAuth + Notification Integration for Contndr
// OAuth connect, token management, channel picker, event notifications
// ══════════════════════════════════════════════════════════════════════════

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { htmlResponse } from "./html-response.tsx";

const app = new Hono();
app.use("*", cors());

// ── Constants ──────────────────────────────────────────────────────────
const SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_API_BASE = "https://slack.com/api";

const BOT_SCOPES = [
  "chat:write",
  "chat:write.public",
  "channels:read",
  "users:read",
  "users:read.email",
  "incoming-webhook",
];

// ── KV key helpers ────────────────────────────────────────────────────
function kvSlackConnection(userId: string) {
  return `slack_connection:${userId}`;
}
function kvSlackSettings(userId: string) {
  return `slack_settings:${userId}`;
}
function kvSlackEventLog(userId: string) {
  return `slack_event_log:${userId}`;
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
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "SLACK");
  if (error || !user) throw new Error("Unauthorized");
  return { user, supabase };
}

// ── Slack OAuth credentials ──
function getSlackClientId(): string {
  const id = Deno.env.get("SLACK_CLIENT_ID");
  if (!id) throw new Error("SLACK_CLIENT_ID not configured");
  return id;
}

function getSlackClientSecret(): string {
  const secret = Deno.env.get("SLACK_CLIENT_SECRET");
  if (!secret) throw new Error("SLACK_CLIENT_SECRET not configured");
  return secret;
}

function getRedirectUri(): string {
  return "https://contndr.com/api/integrations/slack/callback";
}

// ── Types ──────────────────────────────────────────────────────────────

interface SlackConnection {
  bot_token: string;
  team_id: string;
  team_name: string;
  authed_user_id: string;
  bot_user_id?: string;
  connected_at: string;
  webhook_url?: string;
  webhook_channel?: string;
}

interface SlackSettings {
  default_channel_id: string | null;
  default_channel_name: string | null;
  enabled_events: {
    new_lead: boolean;
    reply: boolean;
    meeting_booked: boolean;
    campaign_started: boolean;
  };
}

const DEFAULT_SETTINGS: SlackSettings = {
  default_channel_id: null,
  default_channel_name: null,
  enabled_events: {
    new_lead: true,
    reply: true,
    meeting_booked: true,
    campaign_started: true,
  },
};

// ── Token & connection management ─────────────────────────────────────

async function getStoredConnection(userId: string): Promise<SlackConnection | null> {
  const data = await kv.get(kvSlackConnection(userId));
  if (!data) return null;
  return typeof data === "string" ? JSON.parse(data) : data;
}

async function storeConnection(userId: string, connection: SlackConnection): Promise<void> {
  await kv.set(kvSlackConnection(userId), connection);
}

async function getStoredSettings(userId: string): Promise<SlackSettings> {
  const data = await kv.get(kvSlackSettings(userId));
  if (!data) return { ...DEFAULT_SETTINGS };
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  return { ...DEFAULT_SETTINGS, ...parsed };
}

async function storeSettings(userId: string, settings: SlackSettings): Promise<void> {
  await kv.set(kvSlackSettings(userId), settings);
}

// ── Event logging ─────────────────────────────────────────────────────

async function logSlackEvent(userId: string, event: any): Promise<void> {
  try {
    const logKey = kvSlackEventLog(userId);
    const existing = (await kv.get(logKey)) || [];
    const logs = Array.isArray(existing) ? existing : [];
    logs.unshift(event);
    await kv.set(logKey, logs.slice(0, 100));
  } catch (err) {
    console.error("[SLACK] Failed to log event:", err);
  }
}

// ── Slack API helper ──────────────────────────────────────────────────

async function slackApiFetch(botToken: string, endpoint: string, body?: any): Promise<any> {
  const url = `${SLACK_API_BASE}/${endpoint}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Slack API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || "unknown"}`);
  }
  return data;
}

// ── Reusable send message utility ─────────────────────────────────────

export async function sendSlackMessage(
  userId: string,
  options: {
    channel_id?: string;
    text: string;
    blocks?: any[];
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const connection = await getStoredConnection(userId);
    if (!connection) {
      return { success: false, error: "Slack not connected" };
    }

    const settings = await getStoredSettings(userId);
    const channelId = options.channel_id || settings.default_channel_id;

    if (!channelId) {
      return { success: false, error: "No channel selected. Please choose a default channel in Slack settings." };
    }

    const payload: any = {
      channel: channelId,
      text: options.text,
    };

    if (options.blocks) {
      payload.blocks = options.blocks;
    }

    await slackApiFetch(connection.bot_token, "chat.postMessage", payload);

    await logSlackEvent(userId, {
      type: "message_sent",
      channel_id: channelId,
      success: true,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  } catch (err: any) {
    console.error(`[SLACK] Send message failed for user ${userId}:`, err.message);

    await logSlackEvent(userId, {
      type: "message_sent",
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });

    // Handle specific Slack errors
    if (err.message?.includes("invalid_auth") || err.message?.includes("token_revoked")) {
      return { success: false, error: "Slack authentication expired. Please reconnect Slack." };
    }
    if (err.message?.includes("channel_not_found")) {
      return { success: false, error: "Channel not found. Please select a different channel." };
    }
    if (err.message?.includes("not_in_channel")) {
      return { success: false, error: "Bot is not in the channel. Invite the Contndr bot to the channel first." };
    }

    return { success: false, error: "Failed to send Slack message. Please try again." };
  }
}

// ── Notification builders (Slack Blocks) ──────────────────────────────

export function buildNewLeadBlocks(lead: { name: string; title?: string; company?: string; source?: string; list_name?: string }) {
  return {
    text: `New lead added: ${lead.name}${lead.company ? ` at ${lead.company}` : ""}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New Lead Added", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Name:*\n${lead.name}` },
          { type: "mrkdwn", text: `*Company:*\n${lead.company || "N/A"}` },
          ...(lead.title ? [{ type: "mrkdwn", text: `*Title:*\n${lead.title}` }] : []),
        ],
      },
      ...(lead.source || lead.list_name
        ? [
            {
              type: "context",
              elements: [
                ...(lead.source ? [{ type: "mrkdwn", text: `Source: ${lead.source}` }] : []),
                ...(lead.list_name ? [{ type: "mrkdwn", text: `List: ${lead.list_name}` }] : []),
              ],
            },
          ]
        : []),
      { type: "divider" },
    ],
  };
}

export function buildReplyBlocks(lead: { name: string; snippet: string }) {
  return {
    text: `Reply from ${lead.name}: ${lead.snippet}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Reply Received", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${lead.name}* replied:\n>${lead.snippet}` },
      },
      { type: "divider" },
    ],
  };
}

export function buildMeetingBookedBlocks(lead: { name: string; date: string }) {
  return {
    text: `Meeting booked with ${lead.name} on ${lead.date}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Meeting Booked", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Lead:*\n${lead.name}` },
          { type: "mrkdwn", text: `*Date:*\n${lead.date}` },
        ],
      },
      { type: "divider" },
    ],
  };
}

export function buildCampaignStartedBlocks(campaign: { name: string; lead_count: number }) {
  return {
    text: `Campaign started: ${campaign.name} (${campaign.lead_count} leads)`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Campaign Started", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Campaign:*\n${campaign.name}` },
          { type: "mrkdwn", text: `*Leads:*\n${campaign.lead_count}` },
        ],
      },
      { type: "divider" },
    ],
  };
}

// ── OAuth success/error HTML ──────────────────────────────────────────

function slackSuccessHtml(teamName?: string, appOrigin?: string): string {
  const safeOrigin = appOrigin ? appOrigin.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
  return `<!DOCTYPE html><html><head><title>Slack Connected</title></head><body>
<script>
(function(){
  var appOrigin = '${safeOrigin}';
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'slack-oauth-success' }, '*');
    }
    localStorage.setItem('contndr-slack-oauth-success', 'true');
  } catch(e) {}
  if (window.opener) {
    setTimeout(function(){ window.close(); }, 300);
  } else if (appOrigin) {
    setTimeout(function(){ window.location.href = appOrigin + '/settings'; }, 300);
  }
})();
</script>
<p style="font-family:system-ui;color:#999;text-align:center;margin-top:40vh">Slack connected — closing&hellip;</p>
</body></html>`;
}

function slackErrorHtml(message: string, appOrigin?: string): string {
  const safeOrigin = appOrigin ? appOrigin.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
  const safeMsg = message.replace(/'/g, "\\'").replace(/\n/g, " ");
  return `<!DOCTYPE html><html><head><title>Slack Error</title></head><body>
<script>
(function(){
  var appOrigin = '${safeOrigin}';
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'slack-oauth-error', message: '${safeMsg}' }, '*');
    }
    localStorage.setItem('contndr-slack-oauth-error', '${safeMsg}');
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

// ── GET /status — Check Slack connection status ──
app.get("/status", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection) {
      return c.json({ connected: false });
    }

    const settings = await getStoredSettings(user.id);

    // Verify token is still valid with a quick auth.test call
    try {
      const authTest = await slackApiFetch(connection.bot_token, "auth.test");
      return c.json({
        connected: true,
        team_id: authTest.team_id || connection.team_id,
        team_name: authTest.team || connection.team_name,
        bot_user_id: authTest.user_id || connection.bot_user_id,
        connected_at: connection.connected_at,
        default_channel_id: settings.default_channel_id,
        default_channel_name: settings.default_channel_name,
        enabled_events: settings.enabled_events,
      });
    } catch (err: any) {
      // Token might be revoked
      if (err.message?.includes("invalid_auth") || err.message?.includes("token_revoked")) {
        // Clean up invalid connection
        await kv.del(kvSlackConnection(user.id));
        return c.json({
          connected: false,
          error: "Slack connection expired. Please reconnect.",
        });
      }
      // Other errors — still return connected status from stored data
      return c.json({
        connected: true,
        team_id: connection.team_id,
        team_name: connection.team_name,
        connected_at: connection.connected_at,
        default_channel_id: settings.default_channel_id,
        default_channel_name: settings.default_channel_name,
        enabled_events: settings.enabled_events,
      });
    }
  } catch (error: any) {
    if (error.message?.includes("Unauthorized") || error.message?.includes("No Authorization")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("[SLACK] Status check error:", error);
    return c.json({ error: "Unable to check Slack status. Please try again." }, 500);
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
    await kv.set(`slack_oauth_state:${state}`, {
      userId: user.id,
      createdAt: Date.now(),
      appOrigin,
    });

    const params = new URLSearchParams({
      client_id: getSlackClientId(),
      redirect_uri: getRedirectUri(),
      scope: BOT_SCOPES.join(","),
      state,
    });

    const authUrl = `${SLACK_AUTH_URL}?${params.toString()}`;

    console.log(`[SLACK] OAuth flow started for user ${user.email}`);
    console.log(`[SLACK] Redirect URI: ${getRedirectUri()}`);

    return c.json({ auth_url: authUrl });
  } catch (error: any) {
    if (error.message?.includes("Unauthorized") || error.message?.includes("No Authorization")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("[SLACK] Connect error:", error);
    return c.json({ error: "Unable to start Slack connection. Please try again." }, 500);
  }
});

// ── GET /oauth/callback — Handle OAuth callback from Slack ──
app.get("/oauth/callback", async (c) => {
  let appOrigin = "";
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const errorParam = c.req.query("error");

    if (errorParam) {
      console.error(`[SLACK] OAuth denied: ${errorParam}`);
      // Try to recover origin from state even on error
      if (state) {
        try {
          const sd = await kv.get(`slack_oauth_state:${state}`);
          if (sd) {
            const ps = typeof sd === "string" ? JSON.parse(sd) : sd;
            appOrigin = ps.appOrigin || "";
            await kv.del(`slack_oauth_state:${state}`);
          }
        } catch (_) {}
      }
      return htmlResponse(slackErrorHtml("Slack denied access. Please try again.", appOrigin), 400);
    }

    if (!code || !state) {
      return htmlResponse(slackErrorHtml("Missing authorization parameters. Please try again.", appOrigin), 400);
    }

    // Verify state
    const stateData = await kv.get(`slack_oauth_state:${state}`);
    if (!stateData) {
      return htmlResponse(slackErrorHtml("Session expired. Please try connecting again.", appOrigin), 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;
    appOrigin = parsedState.appOrigin || "";

    // Check state expiry (10 minutes)
    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(`slack_oauth_state:${state}`);
      return htmlResponse(slackErrorHtml("Session expired. Please try connecting again.", appOrigin), 400);
    }

    // One-time use
    await kv.del(`slack_oauth_state:${state}`);

    const userId = parsedState.userId;
    console.log(`[SLACK] OAuth callback for user: ${userId}`);

    // Exchange code for tokens
    const tokenRes = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getSlackClientId(),
        client_secret: getSlackClientSecret(),
        code,
        redirect_uri: getRedirectUri(),
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[SLACK] Token exchange failed (${tokenRes.status}):`, errBody);
      return htmlResponse(slackErrorHtml("Connection failed. Please try again.", appOrigin), 500);
    }

    const tokenData = await tokenRes.json();

    if (!tokenData.ok) {
      console.error(`[SLACK] Token exchange error:`, tokenData.error);
      return htmlResponse(slackErrorHtml("Connection failed. Please try again.", appOrigin), 500);
    }

    console.log("[SLACK] Token exchange successful");

    // Extract connection data
    const connection: SlackConnection = {
      bot_token: tokenData.access_token,
      team_id: tokenData.team?.id || "",
      team_name: tokenData.team?.name || "",
      authed_user_id: tokenData.authed_user?.id || "",
      bot_user_id: tokenData.bot_user_id || "",
      connected_at: new Date().toISOString(),
      webhook_url: tokenData.incoming_webhook?.url || "",
      webhook_channel: tokenData.incoming_webhook?.channel || "",
    };

    await storeConnection(userId, connection);

    // Initialize default settings
    const existingSettings = await getStoredSettings(userId);
    if (!existingSettings.default_channel_id && tokenData.incoming_webhook?.channel_id) {
      existingSettings.default_channel_id = tokenData.incoming_webhook.channel_id;
      existingSettings.default_channel_name = tokenData.incoming_webhook.channel || "";
      await storeSettings(userId, existingSettings);
    }

    // Log connection event
    await logSlackEvent(userId, {
      type: "oauth_connect",
      success: true,
      team_name: connection.team_name,
      timestamp: new Date().toISOString(),
    });

    console.log(`[SLACK] Connection stored for user ${userId} — workspace: ${connection.team_name}`);

    return htmlResponse(slackSuccessHtml(connection.team_name, appOrigin));
  } catch (error: any) {
    console.error("[SLACK] OAuth callback error:", error);
    return htmlResponse(slackErrorHtml("An unexpected error occurred. Please try again.", appOrigin), 500);
  }
});

// ── POST /process-callback — SPA-friendly token exchange ──────────────
// The OAuth redirect now lands on the frontend SPA at
// https://contndr.com/api/integrations/slack/callback
// That page reads the query params and POSTs { code, state } here.
app.post("/process-callback", async (c) => {
  try {
    const body = await c.req.json();
    const { code, state, error: errorParam, error_description: errorDescription } = body;

    if (errorParam) {
      console.error(`[SLACK] OAuth denied (process-callback): ${errorParam} - ${errorDescription}`);
      if (state) {
        try { await kv.del(`slack_oauth_state:${state}`); } catch (_) {}
      }
      return c.json({ success: false, error: `Slack denied access: ${errorDescription || errorParam}` }, 400);
    }

    if (!code || !state) {
      return c.json({ success: false, error: "Missing code or state parameter" }, 400);
    }

    // Verify state
    const stateData = await kv.get(`slack_oauth_state:${state}`);
    if (!stateData) {
      return c.json({ success: false, error: "Invalid or expired state. Please try connecting again." }, 400);
    }

    const parsedState = typeof stateData === "string" ? JSON.parse(stateData) : stateData;

    // Check state expiry (10 minutes)
    if (Date.now() - parsedState.createdAt > 10 * 60 * 1000) {
      await kv.del(`slack_oauth_state:${state}`);
      return c.json({ success: false, error: "Session expired. Please try connecting again." }, 400);
    }

    // One-time use
    await kv.del(`slack_oauth_state:${state}`);

    const userId = parsedState.userId;
    console.log(`[SLACK] process-callback for user: ${userId}`);

    // Exchange code for tokens
    const tokenRes = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getSlackClientId(),
        client_secret: getSlackClientSecret(),
        code,
        redirect_uri: getRedirectUri(),
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[SLACK] Token exchange failed (${tokenRes.status}):`, errBody);
      return c.json({ success: false, error: "Token exchange failed. Please try again." }, 400);
    }

    const tokenData = await tokenRes.json();

    if (!tokenData.ok) {
      console.error(`[SLACK] Token exchange error:`, tokenData.error);
      return c.json({ success: false, error: `Token exchange failed: ${tokenData.error}` }, 400);
    }

    console.log("[SLACK] Token exchange successful (process-callback)");

    // Extract connection data
    const connection: SlackConnection = {
      bot_token: tokenData.access_token,
      team_id: tokenData.team?.id || "",
      team_name: tokenData.team?.name || "",
      authed_user_id: tokenData.authed_user?.id || "",
      bot_user_id: tokenData.bot_user_id || "",
      connected_at: new Date().toISOString(),
      webhook_url: tokenData.incoming_webhook?.url || "",
      webhook_channel: tokenData.incoming_webhook?.channel || "",
    };

    await storeConnection(userId, connection);

    // Initialize default settings
    const existingSettings = await getStoredSettings(userId);
    if (!existingSettings.default_channel_id && tokenData.incoming_webhook?.channel_id) {
      existingSettings.default_channel_id = tokenData.incoming_webhook.channel_id;
      existingSettings.default_channel_name = tokenData.incoming_webhook.channel || "";
      await storeSettings(userId, existingSettings);
    }

    await logSlackEvent(userId, {
      type: "oauth_connect",
      success: true,
      team_name: connection.team_name,
      timestamp: new Date().toISOString(),
    });

    console.log(`[SLACK] Connection stored for user ${userId} (process-callback) — workspace: ${connection.team_name}`);

    return c.json({
      success: true,
      team_name: connection.team_name,
      team_id: connection.team_id,
    });
  } catch (error: any) {
    console.error("[SLACK] process-callback error:", error);
    return c.json({ success: false, error: "An unexpected error occurred. Please try again." }, 500);
  }
});

// ── GET /channels — List available channels ──
app.get("/channels", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection) {
      return c.json({ error: "Slack not connected" }, 400);
    }

    const data = await slackApiFetch(connection.bot_token, "conversations.list?exclude_archived=true&types=public_channel&limit=200");

    const channels = (data.channels || []).map((ch: any) => ({
      id: ch.id,
      name: ch.name,
      is_private: ch.is_private || false,
      num_members: ch.num_members || 0,
    }));

    // Sort by name
    channels.sort((a: any, b: any) => a.name.localeCompare(b.name));

    return c.json({ channels });
  } catch (error: any) {
    if (error.message?.includes("Unauthorized") || error.message?.includes("No Authorization")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("[SLACK] List channels error:", error);
    return c.json({ error: "Unable to load channels. Please try again." }, 500);
  }
});

// ── PATCH /settings — Update channel + event toggles ──
app.patch("/settings", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const body = await c.req.json();

    const connection = await getStoredConnection(user.id);
    if (!connection) {
      return c.json({ error: "Slack not connected" }, 400);
    }

    const settings = await getStoredSettings(user.id);

    if (body.default_channel_id !== undefined) {
      settings.default_channel_id = body.default_channel_id;
    }
    if (body.default_channel_name !== undefined) {
      settings.default_channel_name = body.default_channel_name;
    }
    if (body.enabled_events !== undefined) {
      settings.enabled_events = {
        ...settings.enabled_events,
        ...body.enabled_events,
      };
    }

    await storeSettings(user.id, settings);

    console.log(`[SLACK] Settings updated for user ${user.id}`);

    return c.json({ success: true, settings });
  } catch (error: any) {
    if (error.message?.includes("Unauthorized") || error.message?.includes("No Authorization")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("[SLACK] Update settings error:", error);
    return c.json({ error: "Unable to save settings. Please try again." }, 500);
  }
});

// ── POST /test-message — Send a test notification ──
app.post("/test-message", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const connection = await getStoredConnection(user.id);

    if (!connection) {
      return c.json({ error: "Slack not connected" }, 400);
    }

    const settings = await getStoredSettings(user.id);
    const channelId = settings.default_channel_id;

    if (!channelId) {
      return c.json({
        success: false,
        error: "No channel selected. Please pick a default channel first.",
      });
    }

    const testBlocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "Contndr Test Message", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "This is a test notification from *Contndr*. If you see this, your Slack integration is working correctly!",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Sent by Contndr at ${new Date().toLocaleString("en-US", { timeZone: "UTC" })} UTC`,
          },
        ],
      },
    ];

    await slackApiFetch(connection.bot_token, "chat.postMessage", {
      channel: channelId,
      text: "Test message from Contndr - your Slack integration is working!",
      blocks: testBlocks,
    });

    await logSlackEvent(user.id, {
      type: "test_message",
      success: true,
      channel_id: channelId,
      channel_name: settings.default_channel_name,
      timestamp: new Date().toISOString(),
    });

    return c.json({ success: true, message: "Test message sent!" });
  } catch (error: any) {
    if (error.message?.includes("Unauthorized") || error.message?.includes("No Authorization")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("[SLACK] Test message error:", error);

    if (error.message?.includes("channel_not_found")) {
      return c.json({ success: false, error: "Channel not found. Please select a different channel." });
    }
    if (error.message?.includes("not_in_channel")) {
      return c.json({ success: false, error: "The Contndr bot isn't in this channel. Please invite it first." });
    }

    return c.json({ success: false, error: "Failed to send test message. Please try again." });
  }
});

// ── GET /event-log — Get recent Slack event logs ──
app.get("/event-log", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const logs = (await kv.get(kvSlackEventLog(user.id))) || [];
    return c.json({ logs: Array.isArray(logs) ? logs : [] });
  } catch (error: any) {
    if (error.message?.includes("Unauthorized") || error.message?.includes("No Authorization")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("[SLACK] Event log error:", error);
    return c.json({ error: "Unable to load event log." }, 500);
  }
});

// ── POST /disconnect — Disconnect Slack integration ──
app.post("/disconnect", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);

    // Delete connection and settings
    await kv.del(kvSlackConnection(user.id));
    await kv.del(kvSlackSettings(user.id));

    // Log disconnection
    await logSlackEvent(user.id, {
      type: "disconnect",
      success: true,
      timestamp: new Date().toISOString(),
    });

    console.log(`[SLACK] Disconnected for user ${user.id}`);

    return c.json({ success: true });
  } catch (error: any) {
    if (error.message?.includes("Unauthorized") || error.message?.includes("No Authorization")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("[SLACK] Disconnect error:", error);
    return c.json({ error: "Failed to disconnect. Please try again." }, 500);
  }
});

export default app;