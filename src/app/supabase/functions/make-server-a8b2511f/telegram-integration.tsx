/**
 * Telegram bot integration.
 *
 * Each Contndr user can connect one (or more) Telegram bot they own via
 * @BotFather. Incoming messages to that bot land in the Contndr inbox
 * alongside email + SMS + Meta DMs.
 *
 * Setup flow (user-facing):
 *
 *   1. User opens @BotFather in Telegram, runs /newbot, picks name + handle
 *   2. BotFather replies with the token (e.g. 123456:ABC-DEF...)
 *   3. User pastes the token into Contndr Settings → Telegram
 *   4. We POST to telegram setWebhook with our endpoint + a per-bot secret
 *      so Telegram knows where to deliver messages
 *   5. Any prospect who messages the bot lands in Contndr inbox
 *
 * Auth: Telegram supports a `secret_token` on setWebhook. They send it
 * back as the X-Telegram-Bot-Api-Secret-Token header on every webhook
 * call. We store it per bot in KV and verify on each request.
 */

import { Hono } from "npm:hono";
import * as kv from "./kv-retry.tsx";

const app = new Hono();

const TELEGRAM_BASE = 'https://api.telegram.org';

// ─── Webhook handler ─────────────────────────────────────────────────

/**
 * POST /webhooks/telegram/:botId
 *
 * `botId` is the numeric prefix from the bot token (before the colon)
 * so we can route the incoming message to the right Contndr user
 * without exposing the full token in the URL.
 */
app.post('/webhooks/telegram/:botId', async (c) => {
  try {
    const botId = c.req.param('botId');
    const providedSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
      || c.req.header('x-telegram-bot-api-secret-token')
      || '';

    const botConfig: any = await kv.get(`telegram:bot:${botId}`);
    if (!botConfig) {
      console.warn(`[TELEGRAM] Unknown bot ${botId}`);
      return c.json({ ok: true, ignored: true }, 200);
    }

    if (botConfig.webhook_secret && providedSecret !== botConfig.webhook_secret) {
      console.warn(`[TELEGRAM] Webhook secret mismatch for bot ${botId}`);
      return c.json({ ok: false, error: 'invalid_secret' }, 401);
    }

    const update = await c.req.json();
    const message = update.message || update.edited_message || update.channel_post;
    if (!message) {
      return c.json({ ok: true, ignored: true }, 200);
    }

    const fromUser = message.from || {};
    const chat = message.chat || {};
    const text = message.text || message.caption || '';

    const chatId = String(chat.id || '');
    const senderId = String(fromUser.id || chatId);
    const senderName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ')
      || fromUser.username
      || chat.title
      || senderId;
    const senderHandle = fromUser.username ? `@${fromUser.username}` : null;
    const ts = (message.date ? message.date * 1000 : Date.now());
    const messageId = String(message.message_id || `tg_${ts}_${Math.random().toString(36).slice(2, 8)}`);

    const userId = botConfig.user_id;

    const record = {
      id: `${botId}:${chatId}:${messageId}`,
      direction: 'inbound' as const,
      user_id: userId,
      channel: 'telegram',
      bot_id: botId,
      chat_id: chatId,
      sender_id: senderId,
      sender_name: senderName,
      sender_handle: senderHandle,
      text,
      received_at: new Date(ts).toISOString(),
    };

    await kv.set(`telegram_message:${userId}:${chatId}:${ts}`, record);

    // Native push so the user sees it on their phone
    try {
      const { sendNativePush } = await import('./native-push.tsx');
      await sendNativePush(userId, {
        title: `✈️ Telegram from ${senderName}`,
        body: text.slice(0, 140) || '(media)',
        data: { type: 'telegram_message', bot_id: botId, chat_id: chatId, message_id: messageId },
      });
    } catch (e: any) {
      console.warn('[TELEGRAM] native push error:', e?.message);
    }

    console.log(`[TELEGRAM] 📨 ${senderName} → bot ${botId}: ${text.slice(0, 80)}`);
    return c.json({ ok: true });
  } catch (e: any) {
    console.error('[TELEGRAM] webhook error:', e?.message);
    return c.json({ ok: false }, 200);  // 200 so Telegram doesn't retry-storm
  }
});

// ─── Settings: connect a bot ────────────────────────────────────────

/**
 * POST /telegram/connect — user pastes their bot token from @BotFather.
 *
 * Body: { bot_token: "123456:ABC-DEF..." }
 *
 * We:
 *   1. Validate the token by calling getMe
 *   2. Generate a per-bot webhook secret
 *   3. Register the webhook with Telegram pointing at us
 *   4. Persist the bot config + reverse map
 */
app.post('/telegram/connect', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const { bot_token } = await c.req.json();
    if (!bot_token || typeof bot_token !== 'string' || !bot_token.includes(':')) {
      return c.json({ error: 'bot_token required (looks like "123456:ABC-DEF...")' }, 400);
    }

    // 1) Validate via getMe
    const meRes = await fetch(`${TELEGRAM_BASE}/bot${bot_token}/getMe`);
    const meJson = await meRes.json();
    if (!meRes.ok || !meJson.ok) {
      return c.json({ error: `Invalid token: ${meJson.description || 'getMe failed'}` }, 400);
    }
    const botInfo = meJson.result;
    const botId = String(botInfo.id);
    const botUsername = botInfo.username;

    // 2) Generate a webhook secret
    const webhookSecret = `tg_${crypto.randomUUID().replace(/-/g, '')}`;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || `https://${Deno.env.get('PROJECT_ID') || 'zylftkvcasvznhkmyzfj'}.supabase.co`;
    const webhookUrl = `${supabaseUrl}/functions/v1/make-server-a8b2511f/webhooks/telegram/${botId}`;

    // 3) Register with Telegram
    const setRes = await fetch(`${TELEGRAM_BASE}/bot${bot_token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'edited_message', 'channel_post'],
        drop_pending_updates: false,
      }),
    });
    const setJson = await setRes.json();
    if (!setRes.ok || !setJson.ok) {
      return c.json({ error: `setWebhook failed: ${setJson.description || setRes.statusText}` }, 500);
    }

    // 4) Persist
    const payload = {
      user_id: user.id,
      bot_id: botId,
      bot_username: botUsername,
      bot_name: botInfo.first_name || null,
      bot_token,                  // server-side only, never returned to client
      webhook_secret: webhookSecret,
      webhook_url: webhookUrl,
      connected_at: new Date().toISOString(),
    };

    // Reverse map for webhook routing
    await kv.set(`telegram:bot:${botId}`, payload);

    // Forward map for settings UI
    const existing: any[] = (await kv.get(`telegram:user:${user.id}:bots`)) || [];
    const filtered = existing.filter((b: any) => b.bot_id !== botId);
    filtered.push(payload);
    await kv.set(`telegram:user:${user.id}:bots`, filtered);

    console.log(`[TELEGRAM] ✅ User ${user.email} connected bot @${botUsername} (${botId})`);

    return c.json({
      ok: true,
      bot: {
        bot_id: botId,
        bot_username: botUsername,
        bot_name: payload.bot_name,
        bot_link: `https://t.me/${botUsername}`,
        webhook_url: webhookUrl,
      },
    });
  } catch (e: any) {
    console.error('[TELEGRAM] connect error:', e?.message);
    return c.json({ error: e?.message }, 500);
  }
});

/** GET /telegram/bots — list user's connected bots (tokens stripped) */
app.get('/telegram/bots', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const bots: any[] = (await kv.get(`telegram:user:${user.id}:bots`)) || [];
    return c.json({
      bots: bots.map((b) => ({
        bot_id: b.bot_id,
        bot_username: b.bot_username,
        bot_name: b.bot_name,
        bot_link: `https://t.me/${b.bot_username}`,
        connected_at: b.connected_at,
      })),
    });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

/** DELETE /telegram/bots/:botId — disconnect a bot (also clears the webhook) */
app.delete('/telegram/bots/:botId', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const botId = c.req.param('botId');
    const botConfig: any = await kv.get(`telegram:bot:${botId}`);
    if (botConfig?.user_id !== user.id) {
      return c.json({ error: 'Bot not found or not yours' }, 404);
    }

    // Best-effort: clear the webhook on Telegram's side so they stop trying
    try {
      await fetch(`${TELEGRAM_BASE}/bot${botConfig.bot_token}/deleteWebhook`, { method: 'POST' });
    } catch { /* non-fatal */ }

    await kv.del(`telegram:bot:${botId}`);
    const existing: any[] = (await kv.get(`telegram:user:${user.id}:bots`)) || [];
    await kv.set(`telegram:user:${user.id}:bots`, existing.filter((b: any) => b.bot_id !== botId));

    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

/**
 * POST /telegram/send — send a message back via the bot.
 *
 * Body: { bot_id, chat_id, text }
 */
app.post('/telegram/send', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken || '');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const { bot_id, chat_id, text } = await c.req.json();
    if (!bot_id || !chat_id || !text) return c.json({ error: 'bot_id, chat_id and text required' }, 400);

    const botConfig: any = await kv.get(`telegram:bot:${bot_id}`);
    if (!botConfig || botConfig.user_id !== user.id) {
      return c.json({ error: 'Bot not found or not yours' }, 404);
    }

    const res = await fetch(`${TELEGRAM_BASE}/bot${botConfig.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      return c.json({ ok: false, error: j.description || 'send failed' });
    }

    // Persist outbound message
    const ts = Date.now();
    const messageId = String(j.result?.message_id || `tg_out_${ts}`);
    await kv.set(`telegram_message:${user.id}:${chat_id}:${ts}`, {
      id: `${bot_id}:${chat_id}:${messageId}`,
      direction: 'outbound',
      user_id: user.id,
      channel: 'telegram',
      bot_id,
      chat_id,
      text,
      sent_at: new Date(ts).toISOString(),
    });

    return c.json({ ok: true, message_id: messageId });
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});

export default app;
