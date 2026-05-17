// bounce-handler.tsx — Mark bounced leads with KV audit trail
import * as kv from './kv-retry.tsx';

/**
 * Inspect a Resend `email.bounced` payload and decide whether to
 * permanently suppress the address. Resend forwards EVERY bounce —
 * including soft bounces (out-of-office, mailbox full, temporary DNS
 * failure) which should NEVER trigger suppression. Treating those as
 * permanent is the difference between losing a few percent of
 * legitimate leads vs. quietly losing tens of percent.
 *
 * Payload shape:
 *   data.bounce = { type: 'Permanent'|'Transient'|'Undetermined',
 *                   subType: 'General'|'NoEmail'|'Suppressed'|...,
 *                   message?: string }
 *
 * Returns:
 *   - 'hard'   → permanent failure; suppress + mark lead bounced
 *   - 'soft'   → transient; just log, keep lead active
 *   - 'unknown'→ no info from provider; default to logging only
 */
export type BounceClass = 'hard' | 'soft' | 'unknown';

export function classifyBounce(payload: any): BounceClass {
  const bounce = payload?.data?.bounce || payload?.bounce || null;
  const type = String(bounce?.type || '').toLowerCase();
  const subType = String(bounce?.subType || bounce?.sub_type || '').toLowerCase();
  const message = String(bounce?.message || payload?.data?.error || '').toLowerCase();

  // Explicit hard signals
  if (type === 'permanent' || type === 'hardbounce' || subType === 'hardbounce') return 'hard';
  if (subType.includes('noemail') || subType.includes('no_email') || subType === 'general' && type === 'permanent') return 'hard';
  if (
    message.includes('does not exist') ||
    message.includes('user unknown') ||
    message.includes('no such user') ||
    message.includes('mailbox unavailable') ||
    message.includes('address rejected') ||
    message.includes('recipient rejected')
  ) {
    return 'hard';
  }

  // Explicit soft signals
  if (type === 'transient' || type === 'softbounce' || subType === 'softbounce') return 'soft';
  if (
    message.includes('mailbox full') ||
    message.includes('out of office') ||
    message.includes('vacation') ||
    message.includes('temporarily') ||
    message.includes('try again') ||
    message.includes('greylisted') ||
    message.includes('rate limit')
  ) {
    return 'soft';
  }

  // Undetermined / no payload info — be conservative: do NOT suppress.
  return 'unknown';
}

/**
 * Mark a lead as bounced: sets `bounced=true` on the leads table,
 * logs the bounce to KV for admin visibility.
 * We no longer auto-delete — the user may want to update the email or
 * keep the lead for reference. Bounced leads are excluded from campaigns.
 */
export async function handleBounceAutoDelete(
  supabaseAdmin: any,
  leadId: string,
  userId: string,
  resendId: string,
) {
  // Snapshot lead info for admin audit log
  const { data: leadRow } = await supabaseAdmin
    .from('leads')
    .select('email, first_name, last_name, company, contact_name, business_name')
    .eq('id', leadId)
    .single();

  const bounceLogKey = `bounce:${leadId}:${Date.now()}`;
  await kv.set(bounceLogKey, JSON.stringify({
    lead_id: leadId,
    user_id: userId,
    resend_id: resendId,
    email: leadRow?.email || 'unknown',
    name: leadRow?.contact_name || [leadRow?.first_name, leadRow?.last_name].filter(Boolean).join(' ') || 'unknown',
    company: leadRow?.business_name || leadRow?.company || '',
    bounced_at: new Date().toISOString(),
    auto_deleted: false,
  }));

  // Mark lead as bounced in the DB (instead of deleting)
  const { error: updateError } = await supabaseAdmin
    .from('leads')
    .update({ bounced: true, status: 'bounced', updated_at: new Date().toISOString() })
    .eq('id', leadId);

  if (updateError) {
    console.error(`[BOUNCE] Failed to mark lead ${leadId} as bounced:`, updateError);
  }

  // Add to email suppression list — prevents future sends to this address
  if (leadRow?.email) {
    const email = leadRow.email.toLowerCase().trim();
    await kv.set(`suppressed:${email}`, JSON.stringify({
      reason: 'hard_bounce',
      lead_id: leadId,
      resend_id: resendId,
      added_at: new Date().toISOString(),
      source: 'bounce_webhook',
    }));
    console.log(`[BOUNCE] Added ${email} to suppression list`);
  }

  console.log(`[BOUNCE] Marked lead ${leadId} as bounced (email: ${leadRow?.email}, user: ${userId})`);
}

/**
 * Mark a lead as bounced by email address (used when we don't have the lead ID handy).
 */
export async function markLeadBouncedByEmail(
  supabaseAdmin: any,
  email: string,
  userId?: string,
) {
  let query = supabaseAdmin
    .from('leads')
    .update({ bounced: true, status: 'bounced', updated_at: new Date().toISOString() })
    .eq('email', email);
  
  if (userId) query = query.eq('user_id', userId);

  const { error } = await query;

  if (error) {
    console.error(`[BOUNCE] Failed to mark leads with email ${email} as bounced:`, error);
    return 0;
  }

  // Add to email suppression list
  const cleanEmail = email.toLowerCase().trim();
  await kv.set(`suppressed:${cleanEmail}`, JSON.stringify({
    email: cleanEmail,
    user_id: userId || 'all',
    reason: 'hard_bounce',
    added_at: new Date().toISOString(),
    source: 'email_lookup',
  }));

  // Log to KV
  const bounceLogKey = `bounce:email:${email}:${Date.now()}`;
  await kv.set(bounceLogKey, JSON.stringify({
    email,
    user_id: userId || 'all',
    bounced_at: new Date().toISOString(),
    source: 'email_lookup',
  }));

  console.log(`[BOUNCE] Marked lead(s) as bounced for email: ${email} + added to suppression list`);
  return 1;
}

/**
 * Fetch all bounce log entries from KV for admin dashboard.
 */
export async function getBouncedLeads(): Promise<any[]> {
  const entries = await kv.getByPrefix('bounce:');
  return entries
    .map((entry: any) => {
      try {
        const val = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
        return { ...val, kv_key: entry.key };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => new Date(b.bounced_at).getTime() - new Date(a.bounced_at).getTime());
}

/**
 * Purge all bounce log entries from KV + force-delete any remaining
 * bounced leads that weren't cleaned up by the webhook.
 */
export async function purgeBouncedLeads(supabaseAdmin: any): Promise<{ purged: number; leadsDeleted: number }> {
  const entries = await kv.getByPrefix('bounce:');
  const keys = entries.map((e: any) => e.key);

  // Collect lead IDs that might still exist in DB
  const leadIds: string[] = [];
  for (const entry of entries) {
    try {
      const val = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
      if (val.lead_id) leadIds.push(val.lead_id);
    } catch { /* skip */ }
  }

  // Force-delete any remaining bounced leads (safety net)
  let leadsDeleted = 0;
  if (leadIds.length > 0) {
    // Delete in batches of 100
    for (let i = 0; i < leadIds.length; i += 100) {
      const batch = leadIds.slice(i, i + 100);
      await supabaseAdmin.from('campaign_leads').delete().in('lead_id', batch);
      await supabaseAdmin.from('emails').delete().in('lead_id', batch);
      const { count } = await supabaseAdmin.from('leads').delete().in('id', batch).select('id', { count: 'exact', head: true });
      leadsDeleted += (count || 0);
    }
  }

  // Delete KV bounce logs
  if (keys.length > 0) {
    await kv.mdel(keys);
  }

  return { purged: keys.length, leadsDeleted };
}