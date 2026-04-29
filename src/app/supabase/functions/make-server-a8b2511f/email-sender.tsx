// Email Sender - Supports Resend (default), Gmail OAuth, Outlook OAuth, and legacy SMTP
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import {
  kvProviderKey,
  kvGmailTokensKey,
  kvOutlookTokensKey,
  kvSmtpConfigKey,
  sendViaGmailAPI,
  sendViaOutlookAPI,
  getEmailSettingsFromKV,
} from "./oauth-email.tsx";
import { validateEmailFast } from "./email-verifier.tsx";

// Lazy singleton — avoids creating a duplicate Supabase client at module scope.
// Shares the same connection pool pattern as index.tsx's getSupabaseAdmin().
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return _supabase;
}
// Backward-compat alias — all existing code in this file uses `supabase`
const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) { return (getSupabase() as any)[prop]; },
});

interface EmailOptions {
  from: string;
  to: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: {
    filename: string;
    content: any;
  }[];
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Resolve the email provider for a user
// ---------------------------------------------------------------------------
// Priority: KV store first (new OAuth/modern flow), then user_settings table
// (legacy SMTP), then default to Resend.
// ---------------------------------------------------------------------------

async function resolveProvider(userId: string): Promise<{
  provider: string;
  smtpConfig?: { host: string; port: number; username: string; password: string; fromName?: string; fromEmail?: string };
  connectedEmail?: string;
}> {
  // 1. Check KV for modern settings
  const kvProvider = await kv.get(kvProviderKey(userId));

  if (kvProvider === "gmail_oauth") {
    const raw = await kv.get(kvGmailTokensKey(userId));
    const email = raw ? JSON.parse(raw).email : undefined;
    return { provider: "gmail_oauth", connectedEmail: email };
  }

  if (kvProvider === "outlook_oauth") {
    const raw = await kv.get(kvOutlookTokensKey(userId));
    const email = raw ? JSON.parse(raw).email : undefined;
    return { provider: "outlook_oauth", connectedEmail: email };
  }

  if (kvProvider === "smtp") {
    const raw = await kv.get(kvSmtpConfigKey(userId));
    if (raw) {
      const cfg = JSON.parse(raw);
      return {
        provider: "smtp",
        smtpConfig: {
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          password: cfg.password,
          fromName: cfg.from_name,
          fromEmail: cfg.from_email,
        },
        connectedEmail: cfg.from_email || cfg.username,
      };
    }
  }

  if (kvProvider === "resend") {
    return { provider: "resend" };
  }

  // 2. Fall back to legacy user_settings table
  try {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (settings && settings.email_provider) {
      const ep = settings.email_provider;
      if (ep === 'smtp' || ep === 'gmail' || ep === 'outlook') {
        if (settings.smtp_host && settings.smtp_password) {
          return {
            provider: "smtp",
            smtpConfig: {
              host: settings.smtp_host,
              port: settings.smtp_port,
              username: settings.smtp_username,
              password: settings.smtp_password,
              fromName: settings.smtp_from_name,
              fromEmail: settings.smtp_from_email,
            },
            connectedEmail: settings.smtp_from_email || settings.smtp_username,
          };
        }
      }
      if (ep === 'resend') return { provider: "resend" };
    }
  } catch {
    // Table may not exist for some users — that's fine
  }

  // 3. Default to Resend
  return { provider: "resend" };
}

// ---------------------------------------------------------------------------
// Resend API
// ---------------------------------------------------------------------------

async function sendViaResend(options: EmailOptions): Promise<SendEmailResult> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    return { success: false, error: 'Resend API key not configured' };
  }

  const fromAddress = options.from;
  const maxRetries = 3;
  let lastError = "";

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: options.to,
          reply_to: options.replyTo,
          cc: options.cc,
          bcc: options.bcc,
          subject: options.subject,
          html: options.html,
          text: options.text,
          headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
          attachments: options.attachments,
          tags: [{ name: 'app', value: 'make-builder' }],
          // Self-hosted tracking handles opens/clicks for ALL providers.
          // Disable Resend's native open tracking to prevent double-counting
          // (we inject our own open pixel via injectAllTracking).
          open_tracking: false,
          click_tracking: false,
        }),
      });

      if (response.status === 429) {
        console.warn(`[EMAIL-SENDER] Rate limited (429). Retrying... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }

      if (!response.ok) {
        const error = await response.text();
        
        // Handle domain verification errors - ATTEMPT FALLBACK
        if (error.includes('verified domain') || error.includes('not a valid') || error.includes('domain is not verified')) {
          console.warn(`[EMAIL-SENDER] Resend domain error for ${fromAddress}: ${error}. Attempting fallback to system sender.`);

          // Only retry if we haven't already tried the fallback
          const systemSender = 'sales@contndr.com';
          
          if (fromAddress !== systemSender) {
             // Retry with system default sender
             try {
                console.log(`[EMAIL-SENDER] Retrying with fallback sender: ${systemSender}`);
                const fallbackResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${resendApiKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      from: systemSender, // Fallback to system sender
                      to: options.to,
                      reply_to: options.replyTo || options.from, // Set Reply-To to original sender so replies go to them
                      cc: options.cc,
                      bcc: options.bcc,
                      subject: options.subject,
                      html: options.html,
                      text: options.text,
                      headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
                      attachments: options.attachments,
                      tags: [{ name: 'app', value: 'make-builder' }, { name: 'fallback', value: 'true' }],
                       // Self-hosted tracking handles opens/clicks for ALL providers.
                       // Disable Resend's native open tracking to prevent double-counting.
                       open_tracking: false,
                       click_tracking: false,
                    }),
                });
                
                if (fallbackResponse.ok) {
                    const data = await fallbackResponse.json();
                    console.log(`[EMAIL-SENDER] ✅ Fallback send successful via ${systemSender}`);
                    return { success: true, messageId: data.id };
                } else {
                    const fallbackError = await fallbackResponse.text();
                    console.error(`[EMAIL-SENDER] Fallback failed: ${fallbackError}`);
                }
             } catch (fallbackErr) {
                 console.error(`[EMAIL-SENDER] Fallback network error:`, fallbackErr);
             }
          }

          return {
            success: false,
            error: `Domain not verified: You cannot send from ${fromAddress} via Resend yet. Please verify your domain on Resend or connect a Gmail/Outlook account in Settings.`,
          };
        }
        
        return { success: false, error: `Resend API error: ${error}` };
      }

      const data = await response.json();
      return { success: true, messageId: data.id };
    } catch (error: any) {
      lastError = error.message;
      console.error(`[EMAIL-SENDER] Network error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { success: false, error: `Failed after ${maxRetries} retries. Last error: ${lastError}` };
}

// ---------------------------------------------------------------------------
// Legacy SMTP (nodemailer)
// ---------------------------------------------------------------------------

let _nodemailer: any = null;
async function getNodemailer() {
  if (!_nodemailer) {
    _nodemailer = (await import("npm:nodemailer")).default;
  }
  return _nodemailer;
}

async function sendViaSMTP(
  options: EmailOptions,
  smtpConfig: { host: string; port: number; username: string; password: string; fromName?: string },
): Promise<SendEmailResult> {
  try {
    const nodemailer = await getNodemailer();
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465,
      auth: { user: smtpConfig.username, pass: smtpConfig.password },
    });
    await transporter.verify();
    const info = await transporter.sendMail({
      from: smtpConfig.fromName ? `"${smtpConfig.fromName}" <${options.from}>` : options.from,
      to: options.to,
      replyTo: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error('SMTP send error:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Gmail / Outlook rate-limit tracking (per-user, per-day)
// ---------------------------------------------------------------------------
// Gmail Workspace: ~2000/day, Gmail personal: ~500/day.
// We cap at a conservative 400/day and 20/minute to stay under radar.
// ---------------------------------------------------------------------------

const GMAIL_DAILY_LIMIT = 400;
const GMAIL_MINUTE_LIMIT = 15;
const OUTLOOK_DAILY_LIMIT = 300;
const OUTLOOK_MINUTE_LIMIT = 15;

function dailyCountKey(userId: string, provider: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `ratelimit:${provider}:${userId}:daily:${today}`;
}

function minuteCountKey(userId: string, provider: string): string {
  const now = new Date();
  const minute = `${now.toISOString().slice(0, 16)}`; // YYYY-MM-DDTHH:MM
  return `ratelimit:${provider}:${userId}:min:${minute}`;
}

async function checkAndIncrementRateLimit(
  userId: string,
  provider: 'gmail_oauth' | 'outlook_oauth',
): Promise<{ allowed: boolean; reason?: string }> {
  const dailyLimit = provider === 'gmail_oauth' ? GMAIL_DAILY_LIMIT : OUTLOOK_DAILY_LIMIT;
  const minuteLimit = provider === 'gmail_oauth' ? GMAIL_MINUTE_LIMIT : OUTLOOK_MINUTE_LIMIT;

  const dKey = dailyCountKey(userId, provider);
  const mKey = minuteCountKey(userId, provider);

  try {
    const [dailyCount, minuteCount] = await Promise.all([
      kv.get(dKey).then((v: any) => Number(v) || 0),
      kv.get(mKey).then((v: any) => Number(v) || 0),
    ]);

    if (dailyCount >= dailyLimit) {
      console.warn(`[RATE-LIMIT] ${provider} daily limit (${dailyLimit}) reached for user ${userId}. Sent today: ${dailyCount}`);
      return { allowed: false, reason: `Daily send limit reached (${dailyLimit}/day). Emails will resume tomorrow. Consider adding more sender accounts via Sender Rotation.` };
    }

    if (minuteCount >= minuteLimit) {
      console.warn(`[RATE-LIMIT] ${provider} per-minute limit (${minuteLimit}) reached for user ${userId}. Sent this minute: ${minuteCount}`);
      return { allowed: false, reason: `Send rate too fast (${minuteLimit}/min). Slowing down — will retry next minute.` };
    }

    // Increment counters
    await Promise.all([
      kv.set(dKey, dailyCount + 1),
      kv.set(mKey, minuteCount + 1),
    ]);

    return { allowed: true };
  } catch (err) {
    console.warn('[RATE-LIMIT] Error checking rate limit (allowing send):', err);
    return { allowed: true }; // Fail open — don't block sends due to KV issues
  }
}

// ---------------------------------------------------------------------------
// Bounce suppression list — skip emails to known-bounced addresses
// ---------------------------------------------------------------------------

async function isEmailSuppressed(toEmail: string): Promise<boolean> {
  try {
    const email = toEmail.toLowerCase().trim();
    // Check KV suppression list (set by bounce handler)
    const suppressed = await kv.get(`suppressed:${email}`);
    if (suppressed) {
      console.log(`[SUPPRESSION] Email ${email} is in suppression list — skipping send`);
      return true;
    }

    // Also check the DB leads table for bounced status
    const { data } = await getSupabase()
      .from('leads')
      .select('bounced')
      .eq('email', email)
      .eq('bounced', true)
      .limit(1);

    if (data && data.length > 0) {
      console.log(`[SUPPRESSION] Email ${email} has bounced lead — adding to suppression list`);
      // Cache in KV for faster future lookups
      await kv.set(`suppressed:${email}`, JSON.stringify({ reason: 'bounced_lead', added_at: new Date().toISOString() }));
      return true;
    }

    return false;
  } catch (err) {
    console.warn('[SUPPRESSION] Error checking suppression list:', err);
    return false; // Fail open
  }
}

// ---------------------------------------------------------------------------
// Main sendEmail dispatcher
// ---------------------------------------------------------------------------

export async function sendEmail(
  userId: string,
  options: EmailOptions,
): Promise<SendEmailResult> {
  // Basic validation
  if (!options.to || typeof options.to !== 'string' || options.to.trim() === '') {
    console.error('[EMAIL-SENDER] Invalid "to" address:', options.to);
    return { success: false, error: 'Invalid "to" address: must be a non-empty string' };
  }
  
  if (!options.from || typeof options.from !== 'string' || options.from.trim() === '') {
    console.error('[EMAIL-SENDER] Invalid "from" address:', options.from);
    return { success: false, error: 'Invalid "from" address: must be a non-empty string' };
  }

  // ── Pre-send email validation ──
  const validation = validateEmailFast(options.to.trim());
  if (!validation.isValid) {
    console.warn(`[EMAIL-SENDER] ✋ Pre-send validation failed for ${options.to}: ${validation.reason}`);
    // Auto-suppress this email for future sends
    try {
      await kv.set(`suppressed:${options.to.toLowerCase().trim()}`, JSON.stringify({
        reason: validation.reason,
        added_at: new Date().toISOString(),
        source: 'pre_send_validation',
      }));
    } catch (_) { /* non-fatal */ }
    return { success: false, error: `Email validation failed: ${validation.reason}` };
  }

  // ── Bounce suppression check ──
  const suppressed = await isEmailSuppressed(options.to);
  if (suppressed) {
    return { success: false, error: `Email suppressed: ${options.to} has previously bounced. Skipping to protect sender reputation.` };
  }

  try {
    const resolved = await resolveProvider(userId);
    console.log(`[EMAIL-SENDER] Sending via ${resolved.provider} for user ${userId}`);

    // ── Rate-limit check for Gmail / Outlook ──
    if (resolved.provider === 'gmail_oauth' || resolved.provider === 'outlook_oauth') {
      const rateCheck = await checkAndIncrementRateLimit(userId, resolved.provider as any);
      if (!rateCheck.allowed) {
        console.warn(`[EMAIL-SENDER] Rate limited: ${rateCheck.reason}`);
        return { success: false, error: rateCheck.reason || 'Rate limit exceeded' };
      }
    }

    switch (resolved.provider) {
      case "gmail_oauth":
        return await sendViaGmailAPI(userId, options);

      case "outlook_oauth":
        return await sendViaOutlookAPI(userId, options);

      case "smtp": {
        const cfg = resolved.smtpConfig;
        if (!cfg || !cfg.host || !cfg.password) {
          return { success: false, error: "Missing SMTP credentials. Please check your email settings." };
        }
        return await sendViaSMTP(options, {
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          password: cfg.password,
          fromName: cfg.fromName,
        });
      }

      case "resend":
      default:
        return await sendViaResend(options);
    }
  } catch (error: any) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// System emails (always Resend)
// ---------------------------------------------------------------------------

export async function sendSystemEmail(options: EmailOptions): Promise<SendEmailResult> {
  return await sendViaResend(options);
}

// ---------------------------------------------------------------------------
// Sender address resolution
// ---------------------------------------------------------------------------

export async function getSenderEmail(userId: string, brand: string): Promise<string> {
  const resolved = await resolveProvider(userId);

  // OAuth providers — use the connected email
  if (resolved.provider === "gmail_oauth" || resolved.provider === "outlook_oauth") {
    return resolved.connectedEmail || "sales@contndr.com";
  }

  // SMTP — use configured from_email
  if (resolved.provider === "smtp" && resolved.smtpConfig) {
    return resolved.smtpConfig.fromEmail || resolved.smtpConfig.username || "sales@contndr.com";
  }

  // Resend — use brand-specific senders from KV
  const brandLower = (brand || "").toLowerCase();
  const roadrSender = await kv.get(`email_config:${userId}:roadr_sender`);
  const sourcrSender = await kv.get(`email_config:${userId}:sourcr_sender`);

  if (brandLower === "roadr") return roadrSender || "sales@roadr.com";
  if (brandLower === "sourcr") return sourcrSender || "or@sourcr.net";
  if (brandLower === "covera") return "or@covera.co";

  return roadrSender || sourcrSender || "sales@contndr.com";
}

// ---------------------------------------------------------------------------
// Template emails (unchanged, always use Resend / system)
// ---------------------------------------------------------------------------

export async function sendWaitlistConfirmation(email: string, name: string): Promise<SendEmailResult> {
  const firstName = name.split(' ')[0];
  return await sendSystemEmail({
    from: 'hello@contndr.com',
    to: email,
    subject: "You're on the Contndr priority list",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .logo { font-weight: 900; font-size: 24px; color: #000; letter-spacing: -1px; margin-bottom: 30px; display: block; text-decoration: none; }
            .btn { display: inline-block; background: #000; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; }
            .footer { margin-top: 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <a href="https://contndr.com" class="logo">Contndr</a>
            <p>Hi ${firstName},</p>
            <p>Thanks for requesting access to Contndr. We've added you to our priority waitlist.</p>
            <p>We're onboarding new teams in batches to ensure the best possible experience. You'll receive an invite as soon as a spot opens up (typically within 48-72 hours).</p>
            <p><strong>Want to skip the line?</strong></p>
            <p>If you're ready to consolidate your sales stack now, you can book a demo with our team to get immediate access.</p>
            <a href="https://calendly.com/ax-contndr/30min?month=2026-02" class="btn">Book a Demo</a>
            <div class="footer">&copy; ${new Date().getFullYear()} Contndr. All rights reserved.</div>
          </div>
        </body>
      </html>
    `,
    text: `Hi ${firstName},\n\nThanks for requesting access to Contndr. We've added you to our priority waitlist.\n\nWe're onboarding new teams in batches to ensure the best possible experience. You'll receive an invite as soon as a spot opens up.\n\nWant to skip the line? Book a demo at https://calendly.com/ax-contndr/30min?month=2026-02`,
  });
}

export async function sendAccessGrantedEmail(email: string, name: string): Promise<SendEmailResult> {
  const firstName = name.split(' ')[0];
  return await sendSystemEmail({
    from: 'hello@contndr.com',
    to: email,
    subject: `${firstName}, you're approved for early access`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #e5e5e5; background-color: #000; margin: 0; padding: 0; }
            .wrapper { background-color: #000; padding: 40px 0; }
            .container { max-width: 480px; margin: 0 auto; padding: 0 20px; }
            .card { background-color: #0A0A0A; border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 40px 32px; }
            .logo-link { display: inline-block; margin-bottom: 32px; text-decoration: none; }
            .logo-link svg { height: 28px; width: auto; }
            .badge { display: inline-block; background: rgba(30,212,167,0.1); color: #1ED4A7; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 100px; border: 1px solid rgba(30,212,167,0.2); margin-bottom: 24px; }
            h1 { font-size: 28px; font-weight: 700; color: #fff; margin: 0 0 16px 0; letter-spacing: -0.5px; }
            .subtitle { color: #999; font-size: 15px; margin: 0 0 32px 0; line-height: 1.7; }
            .btn { display: block; background: #fff; color: #000; padding: 16px 24px; border-radius: 14px; text-decoration: none; font-weight: 700; font-size: 15px; text-align: center; }
            .footer { margin-top: 32px; font-size: 11px; color: #444; text-align: center; }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="container">
              <div class="card">
                <a href="https://contndr.com" class="logo-link">
                  <svg viewBox="0 0 1220 137" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Contndr Logo">
                    <path d="M34.5 127.31C23.73 121.45 15.28 113.36 9.17 103.02C3.06 92.69 0 81.03 0 68.05C0 55.07 3.08999 43.42 9.25999 33.08C15.43 22.75 23.91 14.65 34.68 8.78998C45.45 2.92998 57.52 0 70.88 0C81.72 0 91.61 1.88998 100.56 5.66998C109.51 9.44998 117.07 14.93 123.24 22.11L107.36 37.04C97.78 26.71 86 21.54 72.01 21.54C62.94 21.54 54.81 23.52 47.63 27.49C40.45 31.46 34.84 36.97 30.81 44.03C26.78 51.09 24.76 59.09 24.76 68.03C24.76 76.97 26.77 84.98 30.81 92.04C34.84 99.1 40.45 104.61 47.63 108.58C54.81 112.55 62.94 114.53 72.01 114.53C86 114.53 97.78 109.3 107.36 98.84L123.24 113.96C117.06 121.14 109.47 126.62 100.46 130.4C91.45 134.18 81.53 136.07 70.69 136.07C57.33 136.07 45.27 133.14 34.49 127.28L34.5 127.31Z" fill="#ffffff"/>
                    <path d="M207.16 127.31C196.32 121.45 187.82 113.32 181.64 102.93C175.46 92.53 172.38 80.91 172.38 68.06C172.38 55.21 175.47 43.58 181.64 33.19C187.81 22.79 196.32 14.67 207.16 8.81C218 2.95 230.16 0.019989 243.64 0.019989C257.12 0.019989 269.28 2.95 280.12 8.81C290.96 14.67 299.46 22.77 305.64 33.1C311.81 43.43 314.9 55.09 314.9 68.07C314.9 81.05 311.81 92.71 305.64 103.04C299.46 113.37 290.96 121.47 280.12 127.33C269.28 133.19 257.12 136.12 243.64 136.12C230.16 136.12 218 133.19 207.16 127.33V127.31ZM267.46 108.59C274.52 104.62 280.06 99.08 284.09 91.96C288.12 84.84 290.14 76.87 290.14 68.05C290.14 59.23 288.12 51.26 284.09 44.14C280.06 37.02 274.51 31.48 267.46 27.51C260.4 23.54 252.46 21.56 243.64 21.56C234.82 21.56 226.88 23.54 219.82 27.51C212.76 31.48 207.22 37.03 203.19 44.14C199.16 51.26 197.14 59.23 197.14 68.05C197.14 76.87 199.15 84.84 203.19 91.96C207.22 99.08 212.77 104.62 219.82 108.59C226.88 112.56 234.82 114.54 243.64 114.54C252.46 114.54 260.4 112.56 267.46 108.59Z" fill="#ffffff"/>
                    <path d="M496.36 1.88998V134.2H476.14L403.18 44.61V134.2H378.8V1.88998H399.02L471.98 91.48V1.88998H496.36Z" fill="#ffffff"/>
                    <path d="M596.54 22.69H552.69V1.89999H664.97V22.69H621.12V134.21H596.55V22.69H596.54Z" fill="#ffffff"/>
                    <path d="M838.86 1.88998V134.2H818.64L745.68 44.61V134.2H721.3V1.88998H741.52L814.48 91.48V1.88998H838.86Z" fill="#ffffff"/>
                    <path d="M912.19 1.88998H970.03C984.14 1.88998 996.681 4.62999 1007.64 10.11C1018.6 15.59 1027.11 23.34 1033.16 33.36C1039.21 43.38 1042.23 54.94 1042.23 68.04C1042.23 81.14 1039.21 92.71 1033.16 102.73C1027.11 112.75 1018.61 120.5 1007.64 125.98C996.681 131.46 984.14 134.2 970.03 134.2H912.19V1.88998ZM968.9 113.41C978.6 113.41 987.14 111.55 994.51 107.83C1001.88 104.12 1007.55 98.82 1011.52 91.95C1015.49 85.08 1017.47 77.11 1017.47 68.04C1017.47 58.97 1015.48 51 1011.52 44.13C1007.55 37.26 1001.88 31.97 994.51 28.25C987.14 24.54 978.6 22.68 968.9 22.68H936.77V113.41H968.9Z" fill="#ffffff"/>
                    <path d="M1188.73 90.73C1197.8 87.2 1204.76 81.85 1209.62 74.66C1214.47 67.48 1216.9 58.91 1216.9 48.95C1216.9 38.99 1214.63 30.87 1210.1 23.81C1205.56 16.75 1199.04 11.34 1190.54 7.56C1182.03 3.78 1172.05 1.88998 1160.58 1.88998H1106.14V22.68H1159.44C1170.15 22.68 1178.28 24.95 1183.82 29.48C1189.36 34.02 1192.14 40.51 1192.14 48.95C1192.14 57.39 1189.37 63.91 1183.82 68.51C1178.27 73.11 1170.15 75.41 1159.44 75.41H1106.14V134.19H1130.71V95.63H1160.57C1162.84 95.63 1164.54 95.57 1165.67 95.44L1192.7 134.19H1219.16L1188.73 90.72V90.73Z" fill="#ffffff"/>
                  </svg>
                </a>
                <div class="badge">Approved</div>
                <h1>You're in, ${firstName}.</h1>
                <p class="subtitle">We're activating accounts in small batches to ensure quality. Your spot is reserved. Secure it now to avoid losing access.</p>
                <a href="https://contndr.com?auth=signin" class="btn">Secure Your Spot &rarr;</a>
                <div class="footer">&copy; ${new Date().getFullYear()} Contndr. All rights reserved.</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hi ${firstName},\n\nYou're approved for early access to Contndr.\n\nWe're activating accounts in small batches to ensure quality. Your spot is reserved. Secure it now to avoid losing access.\n\nSecure your spot: https://contndr.com?auth=signin\n\n\u00a9 ${new Date().getFullYear()} Contndr. All rights reserved.`,
  });
}

export async function sendInviteEmail(email: string, name: string): Promise<SendEmailResult> {
  return await sendAccessGrantedEmail(email, name);
}