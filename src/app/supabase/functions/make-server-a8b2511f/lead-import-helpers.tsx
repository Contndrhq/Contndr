/**
 * Shared helpers for importing leads from external channels (Meta Lead Ads,
 * Meta DMs, Telegram DMs). Centralizes:
 *
 *   • Cross-channel de-dup (match by email, then phone, then external_id)
 *   • Plan-limit enforcement
 *   • Source attribution
 *   • Activity-log stamp
 *   • Optional auto-enrichment hook
 *
 * Every channel funnels through `upsertImportedLead()` so leads from
 * different sources never produce duplicates and the CRM always shows
 * the most-complete record for a person.
 */

import * as kv from "./kv-retry.tsx";

export interface ImportedLeadFields {
  /** The user/owner this lead belongs to */
  user_id: string;
  /** Channel identifier — e.g. 'meta_lead_ad' | 'meta_instagram_dm' | 'meta_messenger' | 'telegram_dm' */
  source: string;
  /** Stable per-channel id (leadgen_id, sender_id, chat_id) for re-import idempotency */
  external_id?: string | null;
  // ── Core CRM columns (must match the canonical schema used by
  //    Lead Finder so imported leads slot into the same UI without
  //    looking second-class) ──
  email?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  business_name?: string | null;
  job_title?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  category?: string | null;
  industry?: string | null;
  linkedin?: string | null;
  person_linkedin_url?: string | null;
  // ── Channel context ──
  /** Whatever raw payload the channel had — stored on the lead for audit */
  raw?: Record<string, any>;
  /** First snippet of text we saw (e.g. opening DM) — drives initial summary */
  initial_message?: string | null;
}

interface UpsertResult {
  /** The lead id (existing or newly minted) */
  lead_id: string;
  /** True if we created a new lead row */
  created: boolean;
  /** True if we merged into an existing lead */
  merged: boolean;
  /** Reason we skipped (e.g. 'plan_limit_reached'), if applicable */
  skipped_reason?: string;
}

function getSupabaseAdmin() {
  // Dynamic import to keep this module bundle-light. Callers usually
  // already have supabase-js loaded by the time they invoke us.
  return import("npm:@supabase/supabase-js@2").then(({ createClient }) =>
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    ),
  );
}

/**
 * Find an existing lead that matches the imported one. Match strategy
 * (in priority order):
 *   1) Exact email match for this user
 *   2) Exact phone match for this user
 *   3) Stored external_id under leads.imports[].external_id (any channel)
 */
async function findExistingLead(
  supabase: any,
  fields: ImportedLeadFields,
): Promise<{ id: string; lead: any } | null> {
  // 1) Email match
  if (fields.email) {
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", fields.user_id)
      .eq("email", fields.email.toLowerCase().trim())
      .limit(1);
    if (data && data[0]) return { id: data[0].id, lead: data[0] };
  }

  // 2) Phone match — normalize to digits-only for comparison
  if (fields.phone) {
    const normPhone = fields.phone.replace(/[^\d+]/g, "");
    if (normPhone.length >= 7) {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("user_id", fields.user_id)
        .or(`phone.eq.${normPhone},phone.eq.${fields.phone}`)
        .limit(1);
      if (data && data[0]) return { id: data[0].id, lead: data[0] };
    }
  }

  // 3) external_id match via KV reverse index
  if (fields.external_id) {
    const idxKey = `lead_external_idx:${fields.user_id}:${fields.source}:${fields.external_id}`;
    const existingId = await kv.get(idxKey);
    if (existingId) {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("id", existingId)
        .limit(1);
      if (data && data[0]) return { id: data[0].id, lead: data[0] };
    }
  }

  return null;
}

/**
 * Check whether the user has room for one more lead under their plan.
 * Returns { allowed: boolean, reason?: string }.
 */
async function checkPlanLimit(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const sub: any = await kv.get(`contndr_sub:${userId}`).catch(() => null);
    if (!sub) return { allowed: true }; // Default-allow if no sub config

    const plan = (sub.plan || "none").toLowerCase();
    const { PLAN_ENTITLEMENTS, normalizePlan } = await import("./plan-entitlements.ts");
    const ent = PLAN_ENTITLEMENTS[normalizePlan(plan)];
    if (!ent) return { allowed: true };
    if (ent.monthlyLeadLimit === -1) return { allowed: true }; // unlimited

    // Quick monthly-import counter to avoid scanning the leads table for
    // each webhook call. KV-backed, rolls over on the 1st.
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const counterKey = `lead_import_count:${userId}:${monthKey}`;
    const counter = (await kv.get(counterKey)) || { count: 0 };
    if (counter.count >= ent.monthlyLeadLimit) {
      return { allowed: false, reason: "monthly_lead_limit_reached" };
    }
    return { allowed: true };
  } catch (e: any) {
    console.warn("[LEAD-IMPORT] checkPlanLimit error (defaulting allow):", e?.message);
    return { allowed: true };
  }
}

async function bumpImportCounter(userId: string): Promise<void> {
  try {
    const monthKey = new Date().toISOString().slice(0, 7);
    const counterKey = `lead_import_count:${userId}:${monthKey}`;
    const counter = (await kv.get(counterKey)) || { count: 0 };
    counter.count = (counter.count || 0) + 1;
    counter.updated_at = new Date().toISOString();
    await kv.set(counterKey, counter);
  } catch { /* non-fatal */ }
}

/**
 * Upsert a lead from any external channel, with cross-channel dedup +
 * plan-limit enforcement + activity-log stamp. Returns the lead id +
 * whether it was newly created vs merged into existing.
 */
export async function upsertImportedLead(fields: ImportedLeadFields): Promise<UpsertResult> {
  const supabase = await getSupabaseAdmin();
  const now = new Date().toISOString();
  const normEmail = fields.email ? fields.email.toLowerCase().trim() : null;
  const normPhone = fields.phone ? fields.phone.replace(/[^\d+]/g, "") : null;

  const existing = await findExistingLead(supabase, fields);
  if (existing) {
    // MERGE: fill in any blank fields we now know, append source to imports[]
    const lead = existing.lead;
    const updates: any = { updated_at: now, last_activity_at: now };

    // Backfill any blank canonical fields with newly-arrived data, but
    // never OVERWRITE — we trust the most-complete record we already have.
    if (normEmail && !lead.email) updates.email = normEmail;
    if (normPhone && !lead.phone) updates.phone = normPhone;
    if (fields.contact_name && (!lead.contact_name || lead.contact_name === "Unknown")) {
      updates.contact_name = fields.contact_name;
    }
    if (fields.business_name && !lead.business_name) updates.business_name = fields.business_name;
    if (fields.job_title && !lead.job_title) updates.job_title = fields.job_title;
    if (fields.website && !lead.website) updates.website = fields.website;
    if (fields.address && !lead.address) updates.address = fields.address;
    if (fields.city && !lead.city) updates.city = fields.city;
    if (fields.state && !lead.state) updates.state = fields.state;
    if (fields.country && !lead.country) updates.country = fields.country;
    if (fields.category && !lead.category) updates.category = fields.category;
    if (fields.industry && !lead.industry) updates.industry = fields.industry;
    if (fields.linkedin && !lead.linkedin) updates.linkedin = fields.linkedin;
    if (fields.person_linkedin_url && !lead.person_linkedin_url) {
      updates.person_linkedin_url = fields.person_linkedin_url;
    }

    if (Object.keys(updates).length > 2) {
      await supabase.from("leads").update(updates).eq("id", existing.id);
    }

    // Keep a per-source import history in KV for the CRM activity view
    await appendImportHistory(existing.id, fields);

    // Index external_id → lead so future imports on the same channel
    // dedup even without email/phone overlap
    if (fields.external_id) {
      await kv.set(
        `lead_external_idx:${fields.user_id}:${fields.source}:${fields.external_id}`,
        existing.id,
      );
    }

    return { lead_id: existing.id, created: false, merged: true };
  }

  // CREATE: plan-limit check before adding a brand-new row
  const limitCheck = await checkPlanLimit(fields.user_id);
  if (!limitCheck.allowed) {
    console.warn(`[LEAD-IMPORT] Skipping import for ${fields.user_id}: ${limitCheck.reason}`);
    // Still log it as a dropped-event so admins can see the leakage
    await kv.set(`lead_import_dropped:${Date.now()}:${fields.user_id}`, {
      reason: limitCheck.reason,
      source: fields.source,
      email: normEmail,
      at: now,
    }).catch(() => {});
    return { lead_id: "", created: false, merged: false, skipped_reason: limitCheck.reason };
  }

  // Build the new lead row using the SAME canonical schema Lead Finder
  // uses, so imported leads are first-class in the CRM (no missing
  // columns / second-class display). Channel-specific provenance lives
  // in source + source_external_id + notes.
  const newLeadId = `${fields.source.replace(/_/g, "-")}-${fields.external_id || crypto.randomUUID()}`;
  const channelMeta = sourceLabel(fields.source);
  const notesLines = [
    `Imported via ${channelMeta.emoji} ${channelMeta.label}.`,
    fields.external_id ? `Channel ID: ${fields.external_id}` : null,
    fields.initial_message ? `First message: ${fields.initial_message.slice(0, 240)}` : null,
    fields.linkedin || fields.person_linkedin_url
      ? `LinkedIn: ${fields.person_linkedin_url || fields.linkedin}`
      : null,
  ].filter(Boolean).join("\n");

  const newLead: any = {
    id: newLeadId,
    user_id: fields.user_id,
    // Canonical CRM columns — match Lead Finder's insert shape exactly
    business_name: fields.business_name || null,
    contact_name: fields.contact_name || null,
    email: normEmail,
    phone: normPhone,
    website: fields.website || null,
    address: fields.address || null,
    city: fields.city || null,
    state: fields.state || null,
    country: fields.country || null,
    category: fields.category || null,
    industry: fields.industry || null,
    job_title: fields.job_title || null,
    linkedin: fields.linkedin || null,
    person_linkedin_url: fields.person_linkedin_url || null,
    notes: notesLines || null,
    // Status uses the same case-sensitive vocabulary the rest of the
    // CRM uses ('Cold' / 'Warm' / 'Hot'), so segment/filter views work.
    status: "Cold",
    bounced: false,
    // Channel attribution
    source: fields.source,
    source_external_id: fields.external_id || null,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };

  try {
    const { error } = await supabase.from("leads").insert(newLead);
    if (error) {
      // If the deterministic id collides (re-delivery), treat as merge
      if ((error.code || "").startsWith("23")) {
        return { lead_id: newLeadId, created: false, merged: true };
      }
      console.warn("[LEAD-IMPORT] insert failed:", error.message);
      return { lead_id: "", created: false, merged: false, skipped_reason: "db_insert_failed" };
    }
  } catch (e: any) {
    console.warn("[LEAD-IMPORT] insert error:", e?.message);
    return { lead_id: "", created: false, merged: false, skipped_reason: "db_insert_failed" };
  }

  await appendImportHistory(newLeadId, fields);
  if (fields.external_id) {
    await kv.set(
      `lead_external_idx:${fields.user_id}:${fields.source}:${fields.external_id}`,
      newLeadId,
    );
  }
  await bumpImportCounter(fields.user_id);

  return { lead_id: newLeadId, created: true, merged: false };
}

async function appendImportHistory(leadId: string, fields: ImportedLeadFields): Promise<void> {
  try {
    const key = `lead_imports:${leadId}`;
    const list: any[] = (await kv.get(key)) || [];
    list.push({
      source: fields.source,
      external_id: fields.external_id || null,
      initial_message: fields.initial_message || null,
      imported_at: new Date().toISOString(),
    });
    // Keep last 50 imports per lead — plenty for the activity timeline
    if (list.length > 50) list.splice(0, list.length - 50);
    await kv.set(key, list);
  } catch { /* non-fatal */ }
}

/**
 * Human-readable label for a source key — used by the CRM badge.
 * Keep aligned with the source values the integrations stamp.
 */
export function sourceLabel(source: string): { label: string; emoji: string } {
  switch (source) {
    case "meta_lead_ad":       return { label: "Meta Lead Ad",    emoji: "🎯" };
    case "meta_instagram_dm":  return { label: "Instagram DM",    emoji: "📷" };
    case "meta_messenger":     return { label: "Messenger",       emoji: "💬" };
    case "telegram_dm":        return { label: "Telegram",        emoji: "✈️" };
    case "sms":                return { label: "SMS",             emoji: "📱" };
    case "import":             return { label: "Import",          emoji: "📥" };
    case "lead_finder":        return { label: "Lead Finder",     emoji: "🔎" };
    default:                   return { label: source,            emoji: "🔗" };
  }
}
