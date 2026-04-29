/**
 * COMPLIANCE ENGINE — Unsubscribe, Blacklist & Suppression Management
 *
 * Handles:
 *  - One-click unsubscribe link injection (CAN-SPAM / GDPR compliant)
 *  - Global opt-out tracking
 *  - Do-not-contact / blacklist management (emails + domains)
 *  - CSV upload for bulk blacklist import
 *  - Pre-send compliance checks
 *
 * KV Schema:
 *   unsubscribed:{userId}            → string[] (emails that opted out)
 *   blacklist_emails:{userId}        → string[] (blocked email addresses)
 *   blacklist_domains:{userId}       → string[] (blocked domains)
 *   global_unsubscribe:{email_hash}  → { email, userId, unsubscribedAt }
 */

import * as kv from "./kv-retry.tsx";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BASE_PATH = "/functions/v1/make-server-a8b2511f";

// ─── Unsubscribe Link Injection ──────────────────────────────────────

/**
 * Generate a unique unsubscribe URL for a recipient.
 * The URL encodes the user ID and recipient email so the unsubscribe
 * endpoint can record the opt-out.
 */
export function generateUnsubscribeUrl(userId: string, recipientEmail: string): string {
  const payload = btoa(JSON.stringify({ u: userId, e: recipientEmail, t: Date.now() }));
  return `${SUPABASE_URL}${BASE_PATH}/unsubscribe/${payload}`;
}

/**
 * Inject an unsubscribe link at the bottom of an HTML email body.
 * Adds both a visible text link and List-Unsubscribe headers support.
 */
export async function injectUnsubscribeLink(userId: string, recipientEmail: string, htmlBody: string): Promise<string> {
  const unsubUrl = generateUnsubscribeUrl(userId, recipientEmail);

  const unsubBlock = `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;line-height:1.5;">
      <p style="margin:0;">You received this email because we thought our service might be relevant to your business.</p>
      <p style="margin:4px 0 0;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a> from future emails.</p>
    </div>
  `;

  // Insert before </body> if present, otherwise append
  if (htmlBody.includes('</body>')) {
    return htmlBody.replace('</body>', `${unsubBlock}</body>`);
  }
  return htmlBody + unsubBlock;
}

/**
 * Generate List-Unsubscribe header value for email headers.
 */
export function getListUnsubscribeHeader(userId: string, recipientEmail: string): string {
  const url = generateUnsubscribeUrl(userId, recipientEmail);
  return `<${url}>`;
}

// ─── Unsubscribe Processing ──────────────────────────────────────────

function unsubKey(userId: string) { return `unsubscribed:${userId}`; }
function globalUnsubKey(email: string) {
  // Simple hash for global dedup
  return `global_unsubscribe:${email.toLowerCase().trim()}`;
}

/**
 * Record an unsubscribe for a specific user's campaign.
 */
export async function recordUnsubscribe(userId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  // Add to user's unsubscribe list
  const list: string[] = (await kv.get(unsubKey(userId))) || [];
  if (!list.includes(normalizedEmail)) {
    list.push(normalizedEmail);
    await kv.set(unsubKey(userId), list);
  }

  // Also record globally
  await kv.set(globalUnsubKey(normalizedEmail), {
    email: normalizedEmail,
    userId,
    unsubscribedAt: new Date().toISOString(),
  });

  console.log(`[COMPLIANCE] Recorded unsubscribe: ${normalizedEmail} for user ${userId}`);
}

/**
 * Check if an email has unsubscribed from a user's emails.
 */
export async function isUnsubscribed(userId: string, email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const list: string[] = (await kv.get(unsubKey(userId))) || [];
  return list.includes(normalizedEmail);
}

/**
 * Get all unsubscribed emails for a user.
 */
export async function getUnsubscribes(userId: string): Promise<string[]> {
  return (await kv.get(unsubKey(userId))) || [];
}

/**
 * Re-subscribe an email (remove from unsubscribe list).
 */
export async function removeUnsubscribe(userId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const list: string[] = (await kv.get(unsubKey(userId))) || [];
  const filtered = list.filter(e => e !== normalizedEmail);
  await kv.set(unsubKey(userId), filtered);
  await kv.del(globalUnsubKey(normalizedEmail));
}

// ─── Blacklist / Do-Not-Contact ──────────────────────────────────────

function blacklistEmailsKey(userId: string) { return `blacklist_emails:${userId}`; }
function blacklistDomainsKey(userId: string) { return `blacklist_domains:${userId}`; }

/**
 * Add emails to the blacklist.
 */
export async function addToBlacklist(userId: string, entries: string[], type: 'email' | 'domain'): Promise<number> {
  const key = type === 'email' ? blacklistEmailsKey(userId) : blacklistDomainsKey(userId);
  const existing: string[] = (await kv.get(key)) || [];
  const existingSet = new Set(existing);
  let added = 0;

  for (const entry of entries) {
    const normalized = entry.toLowerCase().trim();
    if (normalized && !existingSet.has(normalized)) {
      existing.push(normalized);
      existingSet.add(normalized);
      added++;
    }
  }

  await kv.set(key, existing);
  console.log(`[COMPLIANCE] Added ${added} ${type}s to blacklist for user ${userId}`);
  return added;
}

/**
 * Remove entries from the blacklist.
 */
export async function removeFromBlacklist(userId: string, entries: string[], type: 'email' | 'domain'): Promise<number> {
  const key = type === 'email' ? blacklistEmailsKey(userId) : blacklistDomainsKey(userId);
  const existing: string[] = (await kv.get(key)) || [];
  const removeSet = new Set(entries.map(e => e.toLowerCase().trim()));
  const filtered = existing.filter(e => !removeSet.has(e));
  const removed = existing.length - filtered.length;
  await kv.set(key, filtered);
  return removed;
}

/**
 * Get all blacklisted emails and domains.
 */
export async function getBlacklist(userId: string): Promise<{ emails: string[]; domains: string[] }> {
  const emails: string[] = (await kv.get(blacklistEmailsKey(userId))) || [];
  const domains: string[] = (await kv.get(blacklistDomainsKey(userId))) || [];
  return { emails, domains };
}

/**
 * Check if an email is blacklisted (by direct email match or domain match).
 */
export async function isBlacklisted(userId: string, email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const domain = normalizedEmail.split('@')[1];

  const emails: string[] = (await kv.get(blacklistEmailsKey(userId))) || [];
  if (emails.includes(normalizedEmail)) return true;

  const domains: string[] = (await kv.get(blacklistDomainsKey(userId))) || [];
  if (domain && domains.includes(domain)) return true;

  return false;
}

/**
 * Parse CSV content for blacklist import.
 * Accepts single-column CSV with emails or domains.
 */
export function parseBlacklistCSV(csvContent: string): { emails: string[]; domains: string[] } {
  const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const emails: string[] = [];
  const domains: string[] = [];

  for (const line of lines) {
    // Skip header row
    if (/^(email|domain|address|contact)/i.test(line)) continue;

    // Extract first column if CSV has multiple columns
    const value = line.split(',')[0].trim().replace(/"/g, '').toLowerCase();

    if (value.includes('@')) {
      // It's an email
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        emails.push(value);
      }
    } else if (value.includes('.')) {
      // It's a domain
      domains.push(value);
    }
  }

  return { emails, domains };
}

// ─── Pre-Send Compliance Check ───────────────────────────────────────

/**
 * Full compliance check before sending an email.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkCompliance(userId: string, recipientEmail: string): Promise<{ allowed: boolean; reason?: string }> {
  const normalizedEmail = recipientEmail.toLowerCase().trim();

  // 1. Check unsubscribe list
  if (await isUnsubscribed(userId, normalizedEmail)) {
    return { allowed: false, reason: 'Recipient has unsubscribed' };
  }

  // 2. Check blacklist (email + domain)
  if (await isBlacklisted(userId, normalizedEmail)) {
    return { allowed: false, reason: 'Recipient is on the do-not-contact list' };
  }

  // 3. Check global unsubscribe
  const globalRecord = await kv.get(globalUnsubKey(normalizedEmail));
  if (globalRecord) {
    return { allowed: false, reason: 'Recipient has globally unsubscribed' };
  }

  return { allowed: true };
}

// ─── Compliance Stats ────────────────────────────────────────────────

export async function getComplianceStats(userId: string): Promise<{
  unsubscribedCount: number;
  blacklistedEmails: number;
  blacklistedDomains: number;
}> {
  const unsubs = await getUnsubscribes(userId);
  const { emails, domains } = await getBlacklist(userId);
  return {
    unsubscribedCount: unsubs.length,
    blacklistedEmails: emails.length,
    blacklistedDomains: domains.length,
  };
}