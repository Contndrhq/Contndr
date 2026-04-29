/**
 * EMAIL TRACKING MODULE — Provider-Agnostic Open & Click Tracking
 *
 * Works identically for Resend, Gmail OAuth, Outlook OAuth, and SMTP.
 *
 *  - Open tracking:  Injects a 1x1 transparent GIF pixel before </body>.
 *  - Click tracking: Rewrites <a href="..."> links to go through our redirect
 *                    endpoint, which records the click then 302s to the real URL.
 *
 * The companion endpoints live in index.tsx:
 *   GET /track/open/:id   — serves the pixel, records the open
 *   GET /track/click/:id  — records the click, redirects to the target URL
 */

import * as kv from "./kv-retry.tsx";
import { kvProviderKey } from "./oauth-email.tsx";

// ─── Constants ───────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BASE_PATH = "/functions/v1/make-server-a8b2511f";

/** Fully-qualified base URL for tracking endpoints. */
export function getTrackingBaseUrl(): string {
  return `${SUPABASE_URL}${BASE_PATH}`;
}

function appendTrackingAttribution(url: string, emailId: string, leadId?: string, campaignId?: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('ct_email', emailId);
    if (leadId) parsed.searchParams.set('ct_lead', leadId);
    if (campaignId) parsed.searchParams.set('ct_campaign', campaignId);
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

/**
 * Minimal valid 1x1 transparent GIF (43 bytes).
 * Returned by the open-tracking endpoint.
 */
export const TRACKING_PIXEL_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00,             // 1x1
  0x80, 0x00, 0x00,                   // GCT flag
  0xff, 0xff, 0xff,                   // white
  0x00, 0x00, 0x00,                   // black (transparent)
  0x21, 0xf9, 0x04, 0x01,             // GCE
  0x00, 0x00, 0x00, 0x00,             // delay, transparent index
  0x2c, 0x00, 0x00, 0x00, 0x00,       // image descriptor
  0x01, 0x00, 0x01, 0x00, 0x00,       // 1x1
  0x02, 0x02, 0x44, 0x01, 0x00,       // LZW min code size + data
  0x3b,                                // trailer
]);

// ─── Open Pixel ──────────────────────────────────────────────────────

/**
 * Append a 1x1 tracking pixel `<img>` to the HTML email body.
 * Placed just before `</body>` if present, otherwise appended at the end.
 */
export function injectOpenPixel(html: string, emailId: string): string {
  const pixelUrl = `${getTrackingBaseUrl()}/track/open/${emailId}`;
  const pixel =
    `<img src="${pixelUrl}" width="1" height="1" alt="" ` +
    `style="display:none !important;height:1px !important;width:1px !important;` +
    `border:0 !important;margin:0 !important;padding:0 !important;` +
    `line-height:0 !important;font-size:0 !important;overflow:hidden !important;" />`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${pixel}</body>`);
  }
  // Wrap in a container div if no body tag (most campaign emails)
  return `${html}${pixel}`;
}

// ─── Click Tracking ──────────────────────────────────────────────────

/**
 * Rewrite `<a href="...">` links in the HTML to route through our click
 * tracking redirect endpoint.  Stores the real URL in KV so the endpoint
 * can look it up and 302.
 *
 * Skips:
 *  - Links that already point to our tracking endpoint
 *  - mailto: links
 *  - tel: links
 *  - Anchor (#) links
 *  - Unsubscribe links (to preserve email client special handling)
 */
export async function injectClickTracking(
  html: string,
  emailId: string,
  userId: string,
  leadId?: string,
  campaignId?: string,
): Promise<string> {
  const baseUrl = getTrackingBaseUrl();

  // Match href="..." in <a> tags (both http and https)
  const hrefRegex = /<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/gi;
  const matches: { fullMatch: string; url: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = hrefRegex.exec(html)) !== null) {
    const url = m[1];
    // Skip if it's already a tracking URL
    if (url.includes("/track/click/") || url.includes("/track/open/")) continue;
    matches.push({ fullMatch: m[0], url });
  }

  if (matches.length === 0) return html;

  let result = html;

  for (const { fullMatch, url } of matches) {
    const trackingId = `${emailId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const destinationUrl = appendTrackingAttribution(url, emailId, leadId, campaignId);

    // ── Self-contained redirect URL ───────────────────────────────────────
    // Encode the destination URL as base64url in a ?u= query param so the
    // click endpoint can redirect WITHOUT a KV lookup.  This means the
    // tracking URL is rewritten in the email unconditionally — KV failures
    // can no longer cause links to remain untracked.
    let encodedDestination = '';
    try {
      // base64url: standard base64, then swap +→- /→_ and strip = padding
      const b64 = btoa(destinationUrl);
      encodedDestination = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch (_) {
      // btoa fails on non-Latin chars — fall back to encodeURIComponent
      encodedDestination = encodeURIComponent(destinationUrl);
    }

    const trackingUrl = `${baseUrl}/track/click/${trackingId}?u=${encodedDestination}`;

    // ── Analytics KV write (fire-and-forget, non-blocking) ───────────────
    // Used for click analytics and lead-level reporting only.
    // A KV timeout/failure no longer prevents the tracking URL from being
    // injected — the redirect destination is already encoded in the URL.
    kv.set(`click_track:${trackingId}`, {
      url: destinationUrl,
      original_url: url,
      email_id: emailId,
      campaign_id: campaignId || null,
      user_id: userId,
      lead_id: leadId || null,
      created_at: new Date().toISOString(),
    }).catch((kvErr: any) => {
      console.warn(`[TRACKING] Analytics KV write failed for ${trackingId} (redirect still works via ?u= param):`, kvErr?.message?.slice(0, 80) || kvErr);
    });

    // ── Rewrite href immediately — no await needed ────────────────────────
    const rewritten = fullMatch.replace(`href="${url}"`, `href="${trackingUrl}"`);
    result = result.replace(fullMatch, rewritten);
  }

  return result;
}

/**
 * Also handle raw/bare URLs in text-based HTML (e.g. `<p>Check out https://example.com</p>`)
 * by wrapping them in `<a>` tags and routing through click tracking.
 *
 * This is called BEFORE injectClickTracking (which handles existing <a> tags).
 */
export async function wrapBareUrlsWithTracking(
  html: string,
  emailId: string,
  userId: string,
  leadId?: string,
  campaignId?: string,
): Promise<string> {
  const baseUrl = getTrackingBaseUrl();

  // Match URLs that are NOT inside href="..." (i.e. bare URLs in text)
  // We look for URLs not preceded by href=" or src="
  const bareUrlRegex = /(?<!href="|src="|href='|src='|\/)(https?:\/\/[^\s<>"']+)/gi;
  const matches: { url: string; index: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = bareUrlRegex.exec(html)) !== null) {
    const url = m[1];
    // Skip tracking URLs
    if (url.includes("/track/click/") || url.includes("/track/open/")) continue;
    matches.push({ url, index: m.index });
  }

  if (matches.length === 0) return html;

  // Process in reverse order so indices remain valid
  let result = html;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { url } = matches[i];
    const trackingId = `${emailId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const destinationUrl = appendTrackingAttribution(url, emailId, leadId, campaignId);

    // ── Self-contained redirect URL (same as injectClickTracking) ─────────
    let encodedDestination = '';
    try {
      const b64 = btoa(destinationUrl);
      encodedDestination = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch (_) {
      encodedDestination = encodeURIComponent(destinationUrl);
    }

    const trackingUrl = `${baseUrl}/track/click/${trackingId}?u=${encodedDestination}`;

    // Fire-and-forget KV write for analytics only
    kv.set(`click_track:${trackingId}`, {
      url: destinationUrl,
      original_url: url,
      email_id: emailId,
      campaign_id: campaignId || null,
      user_id: userId,
      lead_id: leadId || null,
      created_at: new Date().toISOString(),
    }).catch((kvErr: any) => {
      console.warn(`[TRACKING] Bare URL analytics KV write failed for ${trackingId} (redirect still works via ?u= param):`, kvErr?.message?.slice(0, 80) || kvErr);
    });

    const anchor = `<a href="${trackingUrl}" style="color: #000000; text-decoration: underline;">${url}</a>`;
    result = result.replace(url, anchor);
  }

  return result;
}

// ─── Combined Injection ──────────────────────────────────────────────

/**
 * Inject both open-tracking pixel and click-tracking link rewrites.
 *
 * Call this on the final HTML body **after** all content has been assembled
 * (signature, HTML template, etc.) but **before** sending via any provider.
 *
 * @param html     The complete HTML email body
 * @param emailId  The DB email record UUID (must be a real ID, not a temp one)
 * @param userId   The sending user's ID
 * @param leadId   The recipient lead's ID (optional, for lead-level analytics)
 * @param campaignId The campaign ID (optional, for live campaign attribution)
 */
export async function injectAllTracking(
  html: string,
  emailId: string,
  userId: string,
  leadId?: string,
  campaignId?: string,
): Promise<string> {
  // 0. Resolve and persist the sending provider for analytics
  try {
    const provider = await resolveEmailProvider(userId);
    await storeEmailProvider(emailId, provider);
  } catch (e) {
    console.warn('[EMAIL-TRACKING] Failed to store provider for analytics:', e);
  }

  // 1. Rewrite existing <a href> links
  let tracked = await injectClickTracking(html, emailId, userId, leadId, campaignId);

  // 2. Append open-tracking pixel
  tracked = injectOpenPixel(tracked, emailId);

  return tracked;
}

// ─── Plain-text to HTML Conversion ───────────────────────────────────

/**
 * Convert plain text email body to properly formatted HTML with paragraphs.
 * Converts bare URLs to clickable `<a>` links (without tracking — call
 * injectAllTracking separately after this).
 */
export function textToHtml(text: string): string {
  // Split into paragraphs on double line breaks
  const paragraphs = text.split("\n\n");

  const htmlParagraphs = paragraphs.map((para) => {
    // Replace single line breaks with <br>
    let paraHtml = para.replace(/\n/g, "<br>");

    // ── Placeholder approach ──
    // We must convert email addresses BEFORE URLs, but running the URL regex
    // on HTML that already contains <a> tags from the email pass causes it
    // to match partial domains inside attributes (e.g. "ontndr.com" inside
    // "ax@contndr.com"), creating nested/broken tags.
    // Fix: replace email matches with inert placeholders, run the URL regex
    // on the clean text, then restore the placeholders.

    const emailPlaceholders: string[] = [];
    const emailRegex = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/gi;
    paraHtml = paraHtml.replace(emailRegex, (email) => {
      const idx = emailPlaceholders.length;
      emailPlaceholders.push(
        `<a href="mailto:${email}" style="color: #000000; text-decoration: underline;">${email}</a>`
      );
      return `\x00EMAIL_${idx}\x00`;
    });

    // Convert bare URLs to <a> tags (for later click-tracking rewrite)
    // Now safe because email addresses have been replaced with placeholders
    const urlRegex =
      /(https?:\/\/[^\s<]+|www\.[^\s<]+|(?<!@)(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<]*)?)/gi;
    paraHtml = paraHtml.replace(urlRegex, (url) => {
      const href = url.startsWith("http") ? url : `https://${url}`;
      return `<a href="${href}" style="color: #000000; text-decoration: underline;">${url}</a>`;
    });

    // Restore email placeholders
    for (let i = 0; i < emailPlaceholders.length; i++) {
      paraHtml = paraHtml.replace(`\x00EMAIL_${i}\x00`, emailPlaceholders[i]);
    }

    return `<p style="margin: 0 0 12px 0; line-height: 1.6;">${paraHtml}</p>`;
  });

  return htmlParagraphs.join("");
}

// ─── Provider Tracking (for per-provider analytics) ──────────────────

/** Resolve the current email provider for a user from KV settings. */
export async function resolveEmailProvider(userId: string): Promise<string> {
  try {
    const provider = await kv.get(kvProviderKey(userId));
    return provider || 'resend';
  } catch {
    return 'resend';
  }
}

/** Persist the provider that was used to send a specific email. */
export async function storeEmailProvider(emailId: string, provider: string): Promise<void> {
  try {
    await kv.set(`email_provider:${emailId}`, provider);
  } catch (kvErr: any) {
    // Non-fatal: provider info is nice-to-have for analytics but not critical
    console.warn(`[EMAIL-TRACKING] Failed to store provider info (non-fatal):`, kvErr?.message || kvErr);
  }
}

/** Look up which provider was used to send a specific email. */
export async function getEmailProvider(emailId: string): Promise<string> {
  const provider = await kv.get(`email_provider:${emailId}`);
  return provider || 'resend'; // Default for legacy emails sent before provider tracking
}

// ─── User-Agent / Bot Detection ──────────────────────────────────────

/**
 * Store the user-agent string for a tracking event.
 * Key includes userId for efficient per-user prefix scans.
 */
export async function storeTrackingUserAgent(
  emailId: string,
  eventType: 'opened' | 'clicked',
  userAgent: string,
  userId?: string,
): Promise<void> {
  try {
    const ts = Date.now();
    const cls = classifyUserAgent(userAgent);
    const prefix = userId ? `tracking_ua:${userId}` : `tracking_ua:_`;
    await kv.set(`${prefix}:${emailId}:${eventType}:${ts}`, {
      ua: userAgent,
      is_bot: cls.isBot,
      classification: cls.classification,
      label: cls.label,
    });
  } catch (kvErr: any) {
    // Non-fatal: UA tracking is analytics-only, not essential for core functionality
    console.warn(`[EMAIL-TRACKING] Failed to store user-agent (non-fatal):`, kvErr?.message || kvErr);
  }
}

/** Known bot / prefetch user-agent patterns. */
const BOT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /GoogleImageProxy/i, label: 'Google Image Proxy' },
  { pattern: /YahooMailProxy/i, label: 'Yahoo Mail Proxy' },
  { pattern: /Outlook-iOS/i, label: 'Outlook iOS Prefetch' },
  { pattern: /Microsoft Office/i, label: 'Microsoft Office' },
  { pattern: /Windows-RSS-Platform/i, label: 'Windows RSS' },
  { pattern: /Thunderbird/i, label: 'Thunderbird' },
  { pattern: /AppleMail/i, label: 'Apple Mail' },
  { pattern: /cfnetwork/i, label: 'Apple Privacy Proxy' },
  { pattern: /undici/i, label: 'Bot (undici)' },
  { pattern: /axios/i, label: 'Bot (axios)' },
  { pattern: /python-requests/i, label: 'Bot (Python)' },
  { pattern: /Go-http-client/i, label: 'Bot (Go)' },
  { pattern: /curl/i, label: 'Bot (curl)' },
  { pattern: /wget/i, label: 'Bot (wget)' },
  { pattern: /bot|crawler|spider|preview|prefetch|scan|check/i, label: 'Generic Bot' },
  // Gmail aggressively proxies images — these still indicate "opened" but via proxy
  { pattern: /^Mozilla\/5\.0$/i, label: 'Minimal UA (Gmail Proxy)' },
];

export interface UAClassification {
  isBot: boolean;
  classification: 'human' | 'bot' | 'proxy';
  label: string;
}

/** Classify a user-agent as human, bot, or proxy. */
export function classifyUserAgent(ua: string): UAClassification {
  if (!ua || ua.length < 10) {
    return { isBot: true, classification: 'bot', label: 'Empty/Missing UA' };
  }

  for (const { pattern, label } of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      // Proxies (Google, Yahoo, Apple) still represent real user opens,
      // but through a privacy proxy — classify differently from bots
      const isProxy = label.includes('Proxy') || label.includes('Apple');
      return {
        isBot: !isProxy,
        classification: isProxy ? 'proxy' : 'bot',
        label,
      };
    }
  }

  return { isBot: false, classification: 'human', label: 'Human' };
}
