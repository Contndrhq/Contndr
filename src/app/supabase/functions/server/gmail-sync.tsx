/**
 * GMAIL & OUTLOOK INBOX SYNC MODULE
 *
 * Polls the user's connected Gmail/Outlook inbox for replies from known leads,
 * then inserts them as inbound emails in the `emails` table — the same format
 * the Resend-inbound webhook uses, so the Inbox / EmailsView / analytics all
 * work seamlessly.
 *
 * Key design decisions:
 *  - Batches lead emails into groups of ~40 to stay under Gmail's query-length limit.
 *  - Tracks `gmail_sync_cursor:<userId>` in KV so repeat syncs only fetch new mail.
 *  - Deduplicates by matching lead_id + subject + replied_at timestamp (±1 min window).
 *  - Rate-limited: min 2 min between syncs per user (stored in KV).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import {
  getValidGmailToken,
  getValidOutlookToken,
  kvProviderKey,
  kvGmailTokensKey,
  kvOutlookTokensKey,
} from "./oauth-email.tsx";
import { recordIntentSignal } from "./intent-engine.tsx";
import { markLeadBouncedByEmail } from "./bounce-handler.tsx";

// ─── Supabase Admin ──────────────────────────────────────────────────
const getAdmin = (() => {
  let client: ReturnType<typeof createClient> | null = null;
  return () => {
    if (!client) {
      client = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
      );
    }
    return client;
  };
})();

// ─── Types ───────────────────────────────────────────────────────────
export interface SyncResult {
  newReplies: number;
  leadsUpdated: number;
  errors: string[];
  skippedDuplicates: number;
  bouncesDetected: number;
  provider: "gmail" | "outlook" | "none";
}

// ─── Rate-limit helpers ──────────────────────────────────────────────
const SYNC_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

async function canSync(userId: string): Promise<boolean> {
  const raw = await kv.get(`gmail_sync_last:${userId}`);
  if (!raw) return true;
  const last = Number(raw);
  return Date.now() - last >= SYNC_COOLDOWN_MS;
}

async function markSynced(userId: string): Promise<void> {
  await kv.set(`gmail_sync_last:${userId}`, String(Date.now()));
}

// ─── Gmail helpers ───────────────────────────────────────────────────

/** Decode Gmail's web-safe base64 to a UTF-8 string. */
function decodeBase64Url(data: string): string {
  // Convert from URL-safe base64 → regular base64
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Handle UTF-8 properly
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Walk Gmail payload parts to find text/plain and text/html bodies. */
function extractGmailBodies(payload: any): { text: string; html: string } {
  let text = "";
  let html = "";

  function walk(part: any) {
    const mime = (part.mimeType || "").toLowerCase();
    if (mime === "text/plain" && part.body?.data) {
      text = decodeBase64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);

  // Fallback: if the top-level body has data (non-multipart)
  if (!text && !html && payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if ((payload.mimeType || "").includes("html")) {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  return { text, html };
}

/**
 * Walk ALL Gmail MIME parts and extract every piece of text content,
 * including message/delivery-status parts that standard extractGmailBodies skips.
 * Returns a single concatenated string of everything found.
 */
function extractAllMimeText(payload: any): string {
  const parts: string[] = [];

  function walk(part: any) {
    const mime = (part.mimeType || "").toLowerCase();
    if (part.body?.data) {
      try {
        const decoded = decodeBase64Url(part.body.data);
        parts.push(decoded);
      } catch { /* skip corrupt parts */ }
    }
    if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  return parts.join("\n");
}

/**
 * Paginated Gmail message list — follows nextPageToken to collect all matching
 * messages up to `maxTotal` (default 200). Prevents the old 50-message cap
 * from silently dropping bounces and replies.
 */
async function listAllGmailMessages(
  query: string,
  accessToken: string,
  maxTotal = 200,
): Promise<{ id: string; threadId: string }[]> {
  const all: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  while (all.length < maxTotal) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "100"); // max per page
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[GMAIL-SYNC] Paginated list failed: ${res.status} ${errText}`);
      break;
    }

    const data = await res.json();
    const messages = data.messages || [];
    all.push(...messages);

    if (!data.nextPageToken || messages.length === 0) break;
    pageToken = data.nextPageToken;
  }

  return all.slice(0, maxTotal);
}

/** Extract a header value by name from Gmail's headers array. */
function gmailHeader(headers: any[], name: string): string {
  const h = headers?.find(
    (h: any) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value || "";
}

/** Extract clean email address from "Name <email>" format. */
function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function stripHtml(html: string): string {
  if (!html) return '';
  
  // First, strip HTML tags and get text content
  let text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')  // Convert <br> to newlines
    .replace(/<\/p>/gi, '\n\n')     // Convert </p> to double newlines
    .replace(/<\/div>/gi, '\n')     // Convert </div> to newlines
    .replace(/<\/h[1-6]>/gi, '\n\n') // Convert heading closing tags to double newlines
    .replace(/<\/li>/gi, '\n')      // Convert </li> to newlines
    .replace(/<\/tr>/gi, '\n')      // Convert </tr> to newlines
    .replace(/<\/blockquote>/gi, '\n\n') // Convert </blockquote> to double newlines
    .replace(/<\/dd>/gi, '\n')      // Convert </dd> to newlines
    .replace(/<\/dt>/gi, '\n')      // Convert </dt> to newlines
    .replace(/<hr\s*\/?>/gi, '\n---\n') // Convert <hr> to separator
    .replace(/<[^>]+>/g, " ");      // Remove all other HTML tags
  
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&lsquo;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…')
    .replace(/&copy;/gi, '©')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™');
  
  // Decode numeric HTML entities (&#xxx; and &#xXX;)
  text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  // Clean up whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ')      // Collapse multiple spaces/tabs
    .replace(/\n /g, '\n')        // Remove spaces after newlines
    .replace(/ \n/g, '\n')        // Remove spaces before newlines
    .replace(/\s+$/gm, '')        // Remove trailing whitespace from each line
    .trim();
  
  return text;
}

// ─── Bounce detection helpers ────────────────────────────────────────

/** Known bounce sender addresses and patterns */
const BOUNCE_SENDERS = [
  "mailer-daemon",
  "postmaster",
  "mail delivery subsystem",
  "mail delivery system",
  "microsoft outlook",
  "auto-notify",
  "mailerdaemon",
];

/** Check if an email sender is a bounce notification system */
function isBounceNotification(fromEmail: string, fromRaw: string, subject: string): boolean {
  const lowerFrom = fromEmail.toLowerCase();
  const lowerFromRaw = fromRaw.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  // Check sender
  for (const pattern of BOUNCE_SENDERS) {
    if (lowerFrom.includes(pattern) || lowerFromRaw.includes(pattern)) return true;
  }

  // Check subject
  if (
    lowerSubject.includes("delivery status notification") ||
    lowerSubject.includes("undeliverable") ||
    lowerSubject.includes("undelivered mail") ||
    lowerSubject.includes("delivery failure") ||
    lowerSubject.includes("mail delivery failed") ||
    lowerSubject.includes("returned mail") ||
    lowerSubject.includes("delivery has failed") ||
    lowerSubject.includes("message not delivered") ||
    lowerSubject.includes("couldn't be delivered") ||
    lowerSubject.includes("could not be delivered")
  ) {
    return true;
  }

  return false;
}

/**
 * Extract bounced recipient email addresses from bounce notification body text.
 * Handles common bounce formats from Google, Microsoft, Postfix, etc.
 */
function extractBouncedEmails(text: string, html: string): string[] {
  const combined = `${text} ${stripHtml(html)}`.toLowerCase();
  const emails = new Set<string>();

  // Pattern 1: "wasn't delivered to <email>" / "was not delivered to <email>"
  const notDelivered = combined.match(/(?:wasn't|was not|couldn't be|could not be)\s+delivered\s+to\s+([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (notDelivered) {
    for (const m of notDelivered) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Pattern 2: "delivery to the following recipient failed" followed by email
  const recipientFailed = combined.match(/(?:recipient|address).*?failed.*?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (recipientFailed) {
    for (const m of recipientFailed) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Pattern 3: RFC 3464 "Final-Recipient: rfc822; email@example.com"
  const finalRecipient = combined.match(/final-recipient\s*:\s*(?:rfc822\s*;\s*)?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (finalRecipient) {
    for (const m of finalRecipient) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Pattern 4: "Original-Recipient: rfc822; email@example.com"
  const origRecipient = combined.match(/original-recipient\s*:\s*(?:rfc822\s*;\s*)?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (origRecipient) {
    for (const m of origRecipient) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Pattern 5: "message to <email>" (general)
  const messageTo = combined.match(/(?:your )?message\s+to\s+([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (messageTo) {
    for (const m of messageTo) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Pattern 6: "Address not found ... to <email>"
  const addressNotFound = combined.match(/address\s+not\s+found.*?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (addressNotFound) {
    for (const m of addressNotFound) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Pattern 7: "Recipient inbox full" / "mailbox full" + email
  const mailboxFull = combined.match(/(?:recipient\s+)?(?:inbox|mailbox)\s+full.*?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (mailboxFull) {
    for (const m of mailboxFull) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Pattern 8: "Message blocked" + email (Google blocking)
  const blocked = combined.match(/(?:message\s+blocked|has been blocked).*?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi);
  if (blocked) {
    for (const m of blocked) {
      const emailMatch = m.match(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
      if (emailMatch) emails.add(emailMatch[1].toLowerCase());
    }
  }

  // Fallback: if no patterns matched, try to extract any emails from the body
  // that look like they could be recipients (exclude known system addresses)
  if (emails.size === 0) {
    const allEmails = combined.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi);
    if (allEmails) {
      for (const e of allEmails) {
        const lower = e.toLowerCase();
        // Skip system/daemon addresses
        if (
          lower.includes("mailer-daemon") ||
          lower.includes("postmaster") ||
          lower.includes("noreply") ||
          lower.includes("no-reply") ||
          lower.includes("mailerdaemon") ||
          lower.includes("googlemail") ||
          lower.includes("microsoft.com")
        ) continue;
        emails.add(lower);
      }
    }
  }

  return Array.from(emails);
}

/**
 * Process a bounce notification: extract bounced emails, match to leads,
 * mark emails/leads as bounced.
 */
async function processBounceNotification(
  supabase: any,
  userId: string,
  bouncedRecipientEmails: string[],
  leadMap: Map<string, any>,
  subject: string,
  bodyPreview: string,
): Promise<number> {
  let bouncesProcessed = 0;

  for (const bouncedEmail of bouncedRecipientEmails) {
    const lead = leadMap.get(bouncedEmail);
    if (!lead) {
      console.log(`[BOUNCE-DETECT] Bounced email ${bouncedEmail} not found in leadMap — trying DB lookup`);
      // Try broader DB lookup in case the lead email casing differs
      await markLeadBouncedByEmail(supabase, bouncedEmail, userId);
      // Also find the lead by email to update outbound emails
      const { data: matchedLeads } = await supabase
        .from("leads")
        .select("id")
        .eq("user_id", userId)
        .ilike("email", bouncedEmail)
        .limit(1);
      if (matchedLeads && matchedLeads.length > 0) {
        const leadId = matchedLeads[0].id;
        // Mark outbound emails to this lead as bounced
        await supabase
          .from("emails")
          .update({ status: "bounced" })
          .eq("user_id", userId)
          .eq("lead_id", leadId)
          .in("status", ["sent", "delivered", "queued"]);
        // Log to KV
        const bounceLogKey = `bounce:${leadId}:${Date.now()}`;
        await kv.set(bounceLogKey, JSON.stringify({
          lead_id: leadId,
          user_id: userId,
          email: bouncedEmail,
          bounced_at: new Date().toISOString(),
          source: "gmail_bounce_detect_db_lookup",
          bounce_subject: subject,
        }));
        bouncesProcessed++;
        console.log(`[BOUNCE-DETECT] Marked lead ${leadId} and emails as bounced via DB lookup (${bouncedEmail})`);
      }
      continue;
    }

    // Mark the lead as bounced
    await supabase
      .from("leads")
      .update({ bounced: true, status: "bounced", updated_at: new Date().toISOString() })
      .eq("id", lead.id);

    // Mark outbound emails to this lead as bounced
    const { data: updatedEmails, error: emailUpdateErr } = await supabase
      .from("emails")
      .update({ status: "bounced" })
      .eq("user_id", userId)
      .eq("lead_id", lead.id)
      .in("status", ["sent", "delivered", "queued"])
      .select("id");

    if (emailUpdateErr) {
      console.error(`[BOUNCE-DETECT] Failed to update emails for lead ${lead.id}:`, emailUpdateErr);
    }

    // Log to KV for admin audit trail
    const bounceLogKey = `bounce:${lead.id}:${Date.now()}`;
    await kv.set(bounceLogKey, JSON.stringify({
      lead_id: lead.id,
      user_id: userId,
      email: bouncedEmail,
      name: lead.contact_name || "unknown",
      company: lead.business_name || "",
      bounced_at: new Date().toISOString(),
      source: "gmail_bounce_detect",
      bounce_subject: subject,
      bounce_preview: bodyPreview.slice(0, 200),
      emails_marked: updatedEmails?.length || 0,
    }));

    bouncesProcessed++;
    console.log(`[BOUNCE-DETECT] ✅ Marked lead ${lead.id} (${bouncedEmail}) as bounced, ${updatedEmails?.length || 0} emails updated. Subject: "${subject}"`);
  }

  return bouncesProcessed;
}

// =====================================================================
// GMAIL SYNC
// =====================================================================

export async function syncGmailInbox(userId: string, force = false): Promise<SyncResult> {
  const result: SyncResult = {
    newReplies: 0,
    leadsUpdated: 0,
    errors: [],
    skippedDuplicates: 0,
    bouncesDetected: 0,
    provider: "gmail",
  };

  // --- Rate limit ---
  if (!force && !(await canSync(userId))) {
    result.errors.push("Sync too frequent — try again in a couple of minutes.");
    return result;
  }

  // --- Token ---
  const tokens = await getValidGmailToken(userId);
  if (!tokens) {
    result.provider = "none";
    result.errors.push("Gmail not connected or token expired. Please reconnect in Settings.");
    return result;
  }

  const supabase = getAdmin();

  // --- Load lead emails ---
  const allLeads: any[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, email, business_name, contact_name")
      .eq("user_id", userId)
      .not("email", "is", null)
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (leadsErr) {
      result.errors.push(`DB error loading leads: ${leadsErr.message}`);
      await markSynced(userId);
      return result;
    }

    if (!leads || leads.length === 0) {
      hasMore = false;
    } else {
      allLeads.push(...leads);
      page++;
    }
  }

  if (allLeads.length === 0) {
    result.errors.push("No leads found.");
    await markSynced(userId);
    return result;
  }

  // Build a de-duplicated set of lead emails
  const leadMap = new Map<string, any>(); // email -> lead row
  for (const lead of allLeads) {
    if (lead.email) leadMap.set(lead.email.toLowerCase().trim(), lead);
  }

  const leadEmails = Array.from(leadMap.keys());
  console.log(`[GMAIL-SYNC] User ${userId}: ${leadEmails.length} lead emails to check`);

  // --- Batch queries (Gmail search has limits on query complexity) ---
  const BATCH_SIZE = 10; // Reduced from 35 to 10 to prevent 500 backendError from Gmail API
  const batches: string[][] = [];
  for (let i = 0; i < leadEmails.length; i += BATCH_SIZE) {
    batches.push(leadEmails.slice(i, i + BATCH_SIZE));
  }

  // Get cursor (last sync epoch in seconds for Gmail `after:` operator)
  const cursorRaw = await kv.get(`gmail_sync_cursor:${userId}`);
  // Default: look back 3 days on first sync
  const defaultAfter = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
  const afterEpoch = cursorRaw ? Number(cursorRaw) : defaultAfter;

  // Track the newest internalDate we see so we can advance the cursor
  let newestEpoch = afterEpoch;

  for (const batch of batches) {
    try {
      // Build Gmail search query: from:(a@x.com OR b@x.com) after:EPOCH
      const fromClause = batch.map((e) => `"${e}"`).join(" OR ");
      const query = `from:(${fromClause}) after:${afterEpoch}`;

      // List matching messages (with full pagination — up to 200)
      const messages = await listAllGmailMessages(query, tokens.access_token, 200);

      if (messages.length === 0) continue;

      console.log(`[GMAIL-SYNC] Batch found ${messages.length} candidate messages`);

      // Fetch each message in parallel (max 10 concurrent)
      const chunkSize = 10;
      for (let j = 0; j < messages.length; j += chunkSize) {
        const chunk = messages.slice(j, j + chunkSize);
        const fetches = chunk.map((m: any) =>
          fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
            { headers: { Authorization: `Bearer ${tokens.access_token}` } },
          ).then((r) => (r.ok ? r.json() : null)),
        );

        const fullMessages = await Promise.all(fetches);

        for (const msg of fullMessages) {
          if (!msg) continue;

          try {
            const headers = msg.payload?.headers || [];
            const fromRaw = gmailHeader(headers, "From");
            const fromEmail = extractEmail(fromRaw);
            const subject = gmailHeader(headers, "Subject");
            const dateHeader = gmailHeader(headers, "Date");
            const gmailMessageId = msg.id;

            // Verify this sender is actually one of our leads
            const lead = leadMap.get(fromEmail);
            if (!lead) continue;

            // --- Deduplication: check by lead_id + subject + approximate time ---
            const receivedAt = dateHeader
              ? new Date(dateHeader).toISOString()
              : new Date(Number(msg.internalDate)).toISOString();

            const { count: existingFuzzy } = await supabase
              .from("emails")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("lead_id", lead.id)
              .eq("direction", "inbound")
              .eq("subject", subject)
              .gte("replied_at", new Date(new Date(receivedAt).getTime() - 60000).toISOString())
              .lte("replied_at", new Date(new Date(receivedAt).getTime() + 60000).toISOString());

            if (existingFuzzy && existingFuzzy > 0) {
              result.skippedDuplicates++;
              continue;
            }

            // --- Extract body ---
            const { text, html } = extractGmailBodies(msg.payload);
            const bodyText = text || stripHtml(html);

            // --- Find campaign_id (most recent outbound email to this lead) ---
            const { data: lastOutbound } = await supabase
              .from("emails")
              .select("campaign_id")
              .eq("user_id", userId)
              .eq("lead_id", lead.id)
              .neq("direction", "inbound")
              .order("sent_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            const campaignId = lastOutbound?.campaign_id || null;

            // --- Insert ---
            const { error: insertErr } = await supabase.from("emails").insert({
              user_id: userId,
              lead_id: lead.id,
              campaign_id: campaignId,
              direction: "inbound",
              status: "replied",
              subject,
              text_body: bodyText,
              html_body: html || null,
              body: bodyText,
              replied_at: receivedAt,
            });

            if (insertErr) {
              console.error(`[GMAIL-SYNC] Insert failed for ${fromEmail}:`, insertErr.message);
              result.errors.push(`Insert failed for ${fromEmail}: ${insertErr.message}`);
              continue;
            }

            result.newReplies++;

            // --- Update lead status ---
            await supabase
              .from("leads")
              .update({
                status: "Replied",
                reply_received: true,
                last_contacted: new Date().toISOString(),
              })
              .eq("id", lead.id);
            result.leadsUpdated++;

            // --- Buying Intent: fire email_replied signal (fire-and-forget) ---
            (async () => {
              try {
                const { count: priorReplies } = await supabase
                  .from("emails")
                  .select("id", { count: "exact", head: true })
                  .eq("user_id", userId)
                  .eq("lead_id", lead.id)
                  .eq("direction", "inbound");

                const replyCount = priorReplies || 1;
                const signalDetail = replyCount >= 2 ? "email_multiple_replies" : "email_replied";

                await recordIntentSignal({
                  userId,
                  companyId: lead.business_name ? `lead_${lead.id}` : undefined,
                  companyName: lead.business_name || lead.contact_name || "Unknown",
                  personId: lead.id,
                  personEmail: fromEmail,
                  signalType: "email",
                  signalDetail,
                  metadata: { subject, reply_count: replyCount, source: "gmail_sync" },
                });
                console.log(`[INTENT] Gmail-sync reply signal: ${lead.business_name || fromEmail} → ${signalDetail}`);
              } catch (intentErr) {
                console.warn("[INTENT] Failed to record Gmail-sync reply signal:", intentErr);
              }
            })();

            // Advance cursor
            const msgEpoch = Math.floor(Number(msg.internalDate) / 1000);
            if (msgEpoch > newestEpoch) newestEpoch = msgEpoch;
          } catch (msgErr: any) {
            console.error(`[GMAIL-SYNC] Error processing message:`, msgErr.message);
            result.errors.push(`Message processing error: ${msgErr.message}`);
          }
        }
      }
    } catch (batchErr: any) {
      console.error(`[GMAIL-SYNC] Batch error:`, batchErr.message);
      result.errors.push(`Batch error: ${batchErr.message}`);
    }
  }

  // ── BOUNCE DETECTION: Scan for Mail Delivery Subsystem / mailer-daemon emails ──
  try {
    // For bounce detection, always look back at least 7 days to catch bounces
    // that arrived after the cursor was last advanced for reply detection
    const bounceAfterEpoch = Math.min(afterEpoch, Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000));
    const bounceQuery = `from:(mailer-daemon OR postmaster OR "Mail Delivery Subsystem" OR "Mail Delivery System") after:${bounceAfterEpoch}`;
    // Paginated fetch — up to 200 bounce notifications
    const bounceMessages = await listAllGmailMessages(bounceQuery, tokens.access_token, 200);

    {

      if (bounceMessages.length > 0) {
        console.log(`[GMAIL-SYNC] Found ${bounceMessages.length} potential bounce notifications to check`);

        const bounceChunkSize = 10;
        for (let j = 0; j < bounceMessages.length; j += bounceChunkSize) {
          const chunk = bounceMessages.slice(j, j + bounceChunkSize);
          const fetches = chunk.map((m: any) =>
            fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
              { headers: { Authorization: `Bearer ${tokens.access_token}` } },
            ).then((r) => (r.ok ? r.json() : null)),
          );

          const fullBounceMessages = await Promise.all(fetches);

          for (const msg of fullBounceMessages) {
            if (!msg) continue;
            try {
              const headers = msg.payload?.headers || [];
              const fromRaw = gmailHeader(headers, "From");
              const fromEmail = extractEmail(fromRaw);
              const subject = gmailHeader(headers, "Subject");
              const gmailMsgId = msg.id;

              // Verify this is actually a bounce notification
              if (!isBounceNotification(fromEmail, fromRaw, subject)) continue;

              // Dedup: check if we already processed this bounce
              const bounceDedupKey = `bounce_detect:gmail:${gmailMsgId}`;
              const alreadyProcessed = await kv.get(bounceDedupKey);
              if (alreadyProcessed) continue;

              // Extract ALL MIME parts (including message/delivery-status which
              // contains Final-Recipient — standard extractGmailBodies misses this)
              const allMimeContent = extractAllMimeText(msg.payload);
              const { text, html } = extractGmailBodies(msg.payload);
              const bodyText = text || stripHtml(html) || allMimeContent;

              // Also check X-Failed-Recipients header (many MTAs include this)
              const xFailedRecipients = gmailHeader(headers, "X-Failed-Recipients");

              // Extract bounced email addresses from body AND headers
              const bouncedEmails = extractBouncedEmails(allMimeContent, html);

              // Add X-Failed-Recipients if present (comma-separated list of emails)
              if (xFailedRecipients) {
                const failedEmails = xFailedRecipients.split(/[,;\s]+/).filter(e => e.includes("@"));
                for (const fe of failedEmails) {
                  bouncedEmails.push(fe.trim().toLowerCase());
                }
              }

              // Deduplicate the bounced emails list
              const uniqueBouncedEmails = [...new Set(bouncedEmails)];

              if (uniqueBouncedEmails.length > 0) {
                console.log(`[BOUNCE-DETECT] Gmail bounce found: "${subject}" → bounced: ${uniqueBouncedEmails.join(", ")}`);

                const processed = await processBounceNotification(
                  supabase, userId, uniqueBouncedEmails, leadMap, subject, bodyText,
                );
                result.bouncesDetected += processed;

                // Only mark as processed if we successfully extracted emails
                await kv.set(bounceDedupKey, { processed_at: new Date().toISOString(), bounced_emails: uniqueBouncedEmails });
              } else {
                console.log(`[BOUNCE-DETECT] Gmail bounce notification but couldn't extract recipient: "${subject}" (body length: ${allMimeContent.length})`);
                // Do NOT set dedup key — allow retry on next sync in case parsing improves
              }

              // Advance cursor
              const msgEpoch = Math.floor(Number(msg.internalDate) / 1000);
              if (msgEpoch > newestEpoch) newestEpoch = msgEpoch;
            } catch (bounceErr: any) {
              console.warn(`[BOUNCE-DETECT] Error processing bounce message:`, bounceErr.message);
            }
          }
        }
      }
    }
  } catch (bounceScanErr: any) {
    console.warn("[GMAIL-SYNC] Bounce scan error (non-fatal):", bounceScanErr.message);
  }

  // Update cursor
  await kv.set(`gmail_sync_cursor:${userId}`, String(newestEpoch));
  await markSynced(userId);

  console.log(
    `[GMAIL-SYNC] Done for user ${userId}: ${result.newReplies} new replies, ${result.bouncesDetected} bounces detected, ${result.skippedDuplicates} dupes skipped, ${result.errors.length} errors`,
  );

  return result;
}

// =====================================================================
// OUTLOOK SYNC
// =====================================================================

export async function syncOutlookInbox(userId: string, force = false): Promise<SyncResult> {
  const result: SyncResult = {
    newReplies: 0,
    leadsUpdated: 0,
    errors: [],
    skippedDuplicates: 0,
    bouncesDetected: 0,
    provider: "outlook",
  };

  if (!force && !(await canSync(userId))) {
    result.errors.push("Sync too frequent — try again in a couple of minutes.");
    return result;
  }

  const tokens = await getValidOutlookToken(userId);
  if (!tokens) {
    result.provider = "none";
    result.errors.push("Outlook not connected or token expired. Please reconnect in Settings.");
    return result;
  }

  const supabase = getAdmin();

  // Load leads
  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .select("id, email, business_name, contact_name")
    .eq("user_id", userId)
    .not("email", "is", null);

  if (leadsErr || !leads || leads.length === 0) {
    result.errors.push(leadsErr ? `DB error: ${leadsErr.message}` : "No leads found.");
    await markSynced(userId);
    return result;
  }

  const leadMap = new Map<string, any>();
  for (const lead of leads) {
    if (lead.email) leadMap.set(lead.email.toLowerCase().trim(), lead);
  }

  // Cursor
  const cursorRaw = await kv.get(`outlook_sync_cursor:${userId}`);
  const since = cursorRaw
    ? new Date(Number(cursorRaw)).toISOString()
    : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  let newestEpoch = cursorRaw ? Number(cursorRaw) : Date.now() - 3 * 24 * 60 * 60 * 1000;

  try {
    // Microsoft Graph: fetch inbox messages received after cursor
    // Filter by receivedDateTime and only get from known lead addresses
    const filterParts = Array.from(leadMap.keys())
      .slice(0, 50) // Graph API filter length limit
      .map((email) => `from/emailAddress/address eq '${email}'`);

    // Graph $filter has an OR limit — batch if needed
    const FILTER_BATCH = 15;
    for (let i = 0; i < filterParts.length; i += FILTER_BATCH) {
      const batchFilter = filterParts.slice(i, i + FILTER_BATCH).join(" or ");
      const fullFilter = `receivedDateTime ge ${since} and (${batchFilter})`;

      const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(fullFilter)}&$top=50&$select=id,from,subject,body,receivedDateTime,internetMessageId&$orderby=receivedDateTime desc`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[OUTLOOK-SYNC] Fetch error: ${res.status} ${errText}`);
        result.errors.push(`Graph API error: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const messages = data.value || [];

      for (const msg of messages) {
        try {
          const fromEmail = (msg.from?.emailAddress?.address || "").toLowerCase().trim();
          const lead = leadMap.get(fromEmail);
          if (!lead) continue;

          const subject = msg.subject || "";
          const receivedAt = msg.receivedDateTime || new Date().toISOString();
          const outlookId = msg.internetMessageId || msg.id;
          const htmlBody = msg.body?.contentType === "HTML" ? msg.body?.content : "";
          const textBody = msg.body?.contentType === "Text" ? msg.body?.content : stripHtml(htmlBody);

          // Dedup by fuzzy match
          const { count: existingFuzzy } = await supabase
            .from("emails")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("lead_id", lead.id)
            .eq("direction", "inbound")
            .eq("subject", subject)
            .gte("replied_at", new Date(new Date(receivedAt).getTime() - 60000).toISOString())
            .lte("replied_at", new Date(new Date(receivedAt).getTime() + 60000).toISOString());

          if (existingFuzzy && existingFuzzy > 0) {
            result.skippedDuplicates++;
            continue;
          }

          // Find campaign
          const { data: lastOutbound } = await supabase
            .from("emails")
            .select("campaign_id")
            .eq("user_id", userId)
            .eq("lead_id", lead.id)
            .neq("direction", "inbound")
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const { error: insertErr } = await supabase.from("emails").insert({
            user_id: userId,
            lead_id: lead.id,
            campaign_id: lastOutbound?.campaign_id || null,
            direction: "inbound",
            status: "replied",
            subject,
            text_body: textBody,
            html_body: htmlBody || null,
            body: textBody,
            replied_at: receivedAt,
          });

          if (insertErr) {
            result.errors.push(`Insert failed for ${fromEmail}: ${insertErr.message}`);
            continue;
          }

          result.newReplies++;

          await supabase
            .from("leads")
            .update({
              status: "Replied",
              reply_received: true,
              last_contacted: new Date().toISOString(),
            })
            .eq("id", lead.id);
          result.leadsUpdated++;

          // --- Buying Intent: fire email_replied signal (fire-and-forget) ---
          (async () => {
            try {
              const { count: priorReplies } = await supabase
                .from("emails")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId)
                .eq("lead_id", lead.id)
                .eq("direction", "inbound");

              const replyCount = priorReplies || 1;
              const signalDetail = replyCount >= 2 ? "email_multiple_replies" : "email_replied";

              await recordIntentSignal({
                userId,
                companyId: lead.business_name ? `lead_${lead.id}` : undefined,
                companyName: lead.business_name || lead.contact_name || "Unknown",
                personId: lead.id,
                personEmail: fromEmail,
                signalType: "email",
                signalDetail,
                metadata: { subject, reply_count: replyCount, source: "outlook_sync" },
              });
              console.log(`[INTENT] Outlook-sync reply signal: ${lead.business_name || fromEmail} → ${signalDetail}`);
            } catch (intentErr) {
              console.warn("[INTENT] Failed to record Outlook-sync reply signal:", intentErr);
            }
          })();

          const msgEpoch = new Date(receivedAt).getTime();
          if (msgEpoch > newestEpoch) newestEpoch = msgEpoch;
        } catch (msgErr: any) {
          result.errors.push(`Message error: ${msgErr.message}`);
        }
      }
    }
  } catch (err: any) {
    result.errors.push(`Outlook sync error: ${err.message}`);
  }

  // ── BOUNCE DETECTION: Scan Outlook inbox for bounce notifications ──
  try {
    // Use wider lookback for bounces (at least 7 days)
    const bounceSince = new Date(Math.min(
      new Date(since).getTime(),
      Date.now() - 7 * 24 * 60 * 60 * 1000
    )).toISOString();
    // Query for bounce notification emails using subject-based filter
    const bounceSinceFilter = `receivedDateTime ge ${bounceSince}`;
    const bounceSubjectFilters = [
      "contains(subject, 'Delivery Status Notification')",
      "contains(subject, 'Undeliverable')",
      "contains(subject, 'Undelivered Mail')",
      "contains(subject, 'Delivery Failure')",
      "contains(subject, 'delivery has failed')",
    ].join(" or ");
    const bounceFilter = `${bounceSinceFilter} and (${bounceSubjectFilters})`;

    const bounceUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(bounceFilter)}&$top=50&$select=id,from,subject,body,receivedDateTime&$orderby=receivedDateTime desc`;

    const bounceRes = await fetch(bounceUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (bounceRes.ok) {
      const bounceData = await bounceRes.json();
      const bounceMessages = bounceData.value || [];

      if (bounceMessages.length > 0) {
        console.log(`[OUTLOOK-SYNC] Found ${bounceMessages.length} potential bounce notifications`);

        for (const msg of bounceMessages) {
          try {
            const fromEmail = (msg.from?.emailAddress?.address || "").toLowerCase();
            const fromName = msg.from?.emailAddress?.name || "";
            const subject = msg.subject || "";
            const outlookMsgId = msg.id;

            if (!isBounceNotification(fromEmail, fromName, subject)) continue;

            // Dedup
            const bounceDedupKey = `bounce_detect:outlook:${outlookMsgId}`;
            const alreadyProcessed = await kv.get(bounceDedupKey);
            if (alreadyProcessed) continue;

            const htmlBody = msg.body?.contentType === "HTML" ? msg.body?.content : "";
            const textBody = msg.body?.contentType === "Text" ? msg.body?.content : stripHtml(htmlBody);

            const bouncedEmails = extractBouncedEmails(textBody, htmlBody);

            if (bouncedEmails.length > 0) {
              console.log(`[BOUNCE-DETECT] Outlook bounce found: "${subject}" → bounced: ${bouncedEmails.join(", ")}`);
              const processed = await processBounceNotification(
                supabase, userId, bouncedEmails, leadMap, subject, textBody,
              );
              result.bouncesDetected += processed;

              // Only mark as processed if we found emails
              await kv.set(bounceDedupKey, { processed_at: new Date().toISOString(), bounced_emails: bouncedEmails });
            } else {
              console.log(`[BOUNCE-DETECT] Outlook bounce notification but couldn't extract recipient: "${subject}" (body length: ${(textBody + htmlBody).length})`);
              // Do NOT set dedup key — allow retry on next sync
            }

            const msgEpoch = new Date(msg.receivedDateTime).getTime();
            if (msgEpoch > newestEpoch) newestEpoch = msgEpoch;
          } catch (bounceErr: any) {
            console.warn(`[BOUNCE-DETECT] Outlook bounce error:`, bounceErr.message);
          }
        }
      }
    } else {
      console.warn(`[OUTLOOK-SYNC] Bounce scan query failed: ${bounceRes.status}`);
    }
  } catch (bounceScanErr: any) {
    console.warn("[OUTLOOK-SYNC] Bounce scan error (non-fatal):", bounceScanErr.message);
  }

  await kv.set(`outlook_sync_cursor:${userId}`, String(newestEpoch));
  await markSynced(userId);

  console.log(
    `[OUTLOOK-SYNC] Done for user ${userId}: ${result.newReplies} new, ${result.bouncesDetected} bounces detected, ${result.skippedDuplicates} dupes`,
  );

  return result;
}

// =====================================================================
// UNIFIED SYNC (auto-detect provider)
// =====================================================================

export async function syncInbox(userId: string, force = false): Promise<SyncResult> {
  const provider = (await kv.get(kvProviderKey(userId))) || "resend";

  console.log(`[INBOX-SYNC] Provider for user ${userId}: "${provider}"`);

  if (provider === "gmail_oauth") {
    return syncGmailInbox(userId, force);
  } else if (provider === "outlook_oauth") {
    return syncOutlookInbox(userId, force);
  }

  // ── Fallback: even if provider is "resend" or "smtp", the user may have
  //    Gmail/Outlook tokens from a previous connection or from connecting
  //    for inbox sync only.  Replies still arrive in Gmail/Outlook regardless
  //    of the *sending* provider, so we should still poll for them.
  const gmailTokensRaw = await kv.get(kvGmailTokensKey(userId));
  if (gmailTokensRaw) {
    console.log(`[INBOX-SYNC] Provider is "${provider}" but Gmail tokens exist — running Gmail sync`);
    return syncGmailInbox(userId, force);
  }

  const outlookTokensRaw = await kv.get(kvOutlookTokensKey(userId));
  if (outlookTokensRaw) {
    console.log(`[INBOX-SYNC] Provider is "${provider}" but Outlook tokens exist — running Outlook sync`);
    return syncOutlookInbox(userId, force);
  }

  console.log(`[INBOX-SYNC] No OAuth tokens found for user ${userId} (provider="${provider}") — skipping sync`);

  return {
    newReplies: 0,
    leadsUpdated: 0,
    errors: [],
    skippedDuplicates: 0,
    bouncesDetected: 0,
    provider: "none",
  };
}

// =====================================================================
// SYNC ALL USERS (for cron / admin)
// =====================================================================

export async function syncAllGmailUsers(): Promise<{
  totalUsers: number;
  totalNewReplies: number;
  results: { userId: string; newReplies: number; errors: string[] }[];
}> {
  const supabase = getAdmin();
  const results: { userId: string; newReplies: number; errors: string[] }[] = [];
  let totalNewReplies = 0;

  // Find all users that have gmail_oauth or outlook_oauth as provider
  // We stored provider at `email_settings:<userId>:provider`
  const providerEntries = await kv.getByPrefix("email_settings:");

  // Parse out unique userIds with gmail or outlook
  const userIds = new Set<string>();
  // The getByPrefix returns values — we need to find the keys that end with ":provider"
  // and whose value is "gmail_oauth" or "outlook_oauth"
  // But kv.getByPrefix returns values only. We need a different approach.
  
  // Instead, query users who have sent emails (they must exist in the emails table)
  const { data: emailUsers } = await supabase
    .from("emails")
    .select("user_id")
    .not("user_id", "is", null)
    .limit(500);

  const uniqueUserIds = new Set<string>();
  if (emailUsers) {
    for (const row of emailUsers) {
      if (row.user_id) uniqueUserIds.add(row.user_id);
    }
  }

  console.log(`[GMAIL-SYNC-ALL] Found ${uniqueUserIds.size} users to check`);

  for (const uid of uniqueUserIds) {
    try {
      const syncResult = await syncInbox(uid, true); // force = true for cron
      if (syncResult.provider !== "none") {
        results.push({
          userId: uid,
          newReplies: syncResult.newReplies,
          errors: syncResult.errors,
        });
        totalNewReplies += syncResult.newReplies;
      }
    } catch (err: any) {
      results.push({ userId: uid, newReplies: 0, errors: [err.message] });
    }
  }

  return { totalUsers: results.length, totalNewReplies, results };
}