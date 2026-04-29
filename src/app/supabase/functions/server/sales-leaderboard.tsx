/**
 * Sales Leaderboard — Revenue-first ranking of sales reps
 *
 * KV keys:
 *   sales_deal:contndr:{deal_id}        → individual deal record
 *   sales_rep_index:contndr             → string[] of rep emails for quick iteration
 *   sales_leaderboard_seeded:contndr    → boolean flag so we seed only once
 *   sales_leaderboard_migrated_v2:contndr → boolean flag for v2 migration
 *
 * Deals include a `sales_rep_email` attribution field.
 * Revenue = sum of all active (non-trial, non-canceled) deals' amounts.
 * Annual plans count as their full yearly value.
 */
import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";

const app = new Hono();

// ── Types ─────────────────────────────────────────────────────────────

export interface SalesDeal {
  id: string;
  sales_rep_email: string;
  sales_rep_name: string;
  customer_name: string;
  customer_email?: string;
  amount: number;          // USD value (full yearly for annual plans)
  plan_interval: "monthly" | "yearly" | "one_time";
  status: "active" | "trialing" | "canceled" | "past_due";
  stripe_sub_id?: string;
  stripe_checkout_session_id?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface SalesRepSummary {
  rank: number;
  name: string;
  email: string;
  conversions: number;
  revenue: number;          // USD total from active paid deals
  deals: SalesDeal[];
}

// ── Helpers ───────────────────────────────────────────────────────────

const DEAL_PREFIX = "sales_deal:contndr:";
const REP_INDEX_KEY = "sales_rep_index:contndr";
const SEEDED_KEY = "sales_leaderboard_seeded:contndr";
const MIGRATED_V2_KEY = "sales_leaderboard_migrated_v2:contndr";
const MIGRATED_V3_KEY = "sales_leaderboard_migrated_v3:contndr";
const MIGRATED_V4_KEY = "sales_leaderboard_migrated_v4:contndr";
const REP_SUB_PREFIX = "sales_rep_sub:contndr:"; // maps stripe_sub_id → { email, name }

async function getAllDeals(): Promise<SalesDeal[]> {
  try {
    const raw = await kv.getByPrefix(DEAL_PREFIX);
    return (raw || []) as SalesDeal[];
  } catch (err) {
    console.error("[SALES LB] Error loading deals:", err);
    return [];
  }
}

async function storeDeal(deal: SalesDeal): Promise<void> {
  await kv.set(`${DEAL_PREFIX}${deal.id}`, deal);

  // Update rep index (deduplicated list of emails)
  const index: string[] = (await kv.get(REP_INDEX_KEY)) || [];
  if (!index.includes(deal.sales_rep_email)) {
    index.push(deal.sales_rep_email);
    await kv.set(REP_INDEX_KEY, index);
  }

  // Map stripe_sub_id to rep email/name
  if (deal.stripe_sub_id) {
    await kv.set(`${REP_SUB_PREFIX}${deal.stripe_sub_id}`, { email: deal.sales_rep_email, name: deal.sales_rep_name });
  }
}

function buildLeaderboard(deals: SalesDeal[]): SalesRepSummary[] {
  const repMap = new Map<string, { name: string; email: string; deals: SalesDeal[] }>();

  for (const deal of deals) {
    const email = deal.sales_rep_email.toLowerCase();
    if (!repMap.has(email)) {
      repMap.set(email, { name: deal.sales_rep_name, email, deals: [] });
    }
    repMap.get(email)!.deals.push(deal);
    // Keep the most-recently-seen name
    if (deal.sales_rep_name) {
      repMap.get(email)!.name = deal.sales_rep_name;
    }
  }

  const reps: SalesRepSummary[] = [];
  for (const [email, info] of repMap) {
    // Only count active, paid (non-trial) deals toward revenue
    const activeDeals = info.deals.filter(
      (d) => d.status === "active"
    );
    const revenue = activeDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
    const conversions = activeDeals.length;

    reps.push({
      rank: 0, // computed after sort
      name: info.name,
      email,
      conversions,
      revenue,
      deals: info.deals,
    });
  }

  // Sort by revenue descending, then by conversions descending as tiebreaker
  reps.sort((a, b) => b.revenue - a.revenue || b.conversions - a.conversions);
  reps.forEach((r, i) => (r.rank = i + 1));

  return reps;
}

// ── Seed data ─────────────────────────────────────────────────────────

async function seedIfNeeded(): Promise<boolean> {
  const alreadySeeded = await kv.get(SEEDED_KEY);
  if (alreadySeeded) return false;

  console.log("[SALES LB] Seeding initial sales leaderboard data...");

  const now = new Date().toISOString();

  // Otiniel Ribeiro — 1 conversion: Carlos Doce, $990/yr (Stripe-linked)
  const deal1: SalesDeal = {
    id: "seed-deal-001",
    sales_rep_email: "or@contndr.com",
    sales_rep_name: "Otiniel Ribeiro",
    customer_name: "Carlos Doce",
    customer_email: "carlos@example.com",
    amount: 990,
    plan_interval: "yearly",
    status: "active",
    notes: "Yearly subscription — $990 (Stripe)",
    created_at: now,
    updated_at: now,
  };

  // AXE — 2 conversions: Gavin and Abraham
  const deal2: SalesDeal = {
    id: "seed-deal-002",
    sales_rep_email: "ax@contndr.com",
    sales_rep_name: "AXE",
    customer_name: "Gavin",
    customer_email: "gavin@example.com",
    amount: 199,
    plan_interval: "monthly",
    status: "active",
    notes: "Pro plan — $199/mo",
    created_at: now,
    updated_at: now,
  };

  const deal3: SalesDeal = {
    id: "seed-deal-003",
    sales_rep_email: "ax@contndr.com",
    sales_rep_name: "AXE",
    customer_name: "Abraham",
    customer_email: "abraham@example.com",
    amount: 99,
    plan_interval: "monthly",
    status: "active",
    notes: "Starter plan — $99/mo",
    created_at: now,
    updated_at: now,
  };

  await Promise.all([storeDeal(deal1), storeDeal(deal2), storeDeal(deal3)]);
  await kv.set(SEEDED_KEY, true);

  console.log("[SALES LB] Seed complete: 3 deals across 2 reps");
  return true;
}

// ── v2 migration: fix AXE's $0 deals with correct amounts ────────────

async function migrateV2IfNeeded(): Promise<boolean> {
  const alreadyMigrated = await kv.get(MIGRATED_V2_KEY);
  if (alreadyMigrated) return false;

  console.log("[SALES LB] Running v2 migration — fixing AXE deal amounts...");

  const now = new Date().toISOString();

  // Fix Gavin deal: Pro plan $199/mo
  const gavinDeal = await kv.get(`${DEAL_PREFIX}seed-deal-002`);
  if (gavinDeal && gavinDeal.amount === 0) {
    gavinDeal.amount = 199;
    gavinDeal.plan_interval = "monthly";
    gavinDeal.notes = "Pro plan — $199/mo";
    gavinDeal.updated_at = now;
    await kv.set(`${DEAL_PREFIX}seed-deal-002`, gavinDeal);
    console.log("[SALES LB] v2: Updated Gavin deal → $199 Pro");
  }

  // Fix Abraham deal: Starter plan $99/mo
  const abrahamDeal = await kv.get(`${DEAL_PREFIX}seed-deal-003`);
  if (abrahamDeal && abrahamDeal.amount === 0) {
    abrahamDeal.amount = 99;
    abrahamDeal.plan_interval = "monthly";
    abrahamDeal.notes = "Starter plan — $99/mo";
    abrahamDeal.updated_at = now;
    await kv.set(`${DEAL_PREFIX}seed-deal-003`, abrahamDeal);
    console.log("[SALES LB] v2: Updated Abraham deal → $99 Starter");
  }

  await kv.set(MIGRATED_V2_KEY, true);
  console.log("[SALES LB] v2 migration complete");
  return true;
}

// ── v3 migration: fix customer name Carlos Cuervo → Carlos Doce ──────

async function migrateV3IfNeeded(): Promise<boolean> {
  const alreadyMigrated = await kv.get(MIGRATED_V3_KEY);
  if (alreadyMigrated) return false;

  console.log("[SALES LB] Running v3 migration — fixing Carlos customer name...");

  const now = new Date().toISOString();

  const deal = await kv.get(`${DEAL_PREFIX}seed-deal-001`);
  if (deal) {
    deal.customer_name = "Carlos Doce";
    deal.notes = "Yearly subscription — $990 (Stripe)";
    deal.updated_at = now;
    await kv.set(`${DEAL_PREFIX}seed-deal-001`, deal);
    console.log("[SALES LB] v3: Updated seed-deal-001 customer → Carlos Doce");
  }

  await kv.set(MIGRATED_V3_KEY, true);
  console.log("[SALES LB] v3 migration complete");
  return true;
}

// ── v4 migration: add Mark Lewis deal for AXE (Stripe-verified) ──────

export async function migrateV4IfNeeded(): Promise<boolean> {
  const alreadyMigrated = await kv.get(MIGRATED_V4_KEY);
  if (alreadyMigrated) return false;

  console.log("[SALES LB] Running v4 migration — adding Mark Lewis deal for AXE...");

  const now = new Date().toISOString();

  // Check if deal already exists (idempotent)
  const existing = await kv.get(`${DEAL_PREFIX}seed-deal-004`);
  if (!existing) {
    const deal: SalesDeal = {
      id: "seed-deal-004",
      sales_rep_email: "ax@contndr.com",
      sales_rep_name: "AXE",
      customer_name: "Mark Lewis",
      customer_email: "mark@example.com",
      amount: 199,
      plan_interval: "monthly",
      status: "active",
      notes: "Pro plan — $199/mo (Stripe-verified)",
      created_at: now,
      updated_at: now,
    };
    await storeDeal(deal);
    console.log("[SALES LB] v4: Added seed-deal-004 Mark Lewis → AXE, $199/mo");
  }

  await kv.set(MIGRATED_V4_KEY, true);
  console.log("[SALES LB] v4 migration complete");
  return true;
}

// ── Auth helper ───────────────────────────────────────────────────────

async function getAuthenticatedUser(c: any) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const token = c.req.header("Authorization")?.split(" ")[1];
  if (!token) throw { status: 401, message: "Unauthorized" };

  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "SALES-LEADERBOARD");
  if (error || !user) throw { status: 401, message: "Unauthorized" };

  return { user, supabase };
}

// ══════════════════════════════════════════════════════════════════════
//  GET / — Full sales leaderboard (auto-seeds on first call)
// ══════════════════════════════════════════════════════════════════════
app.get("/", async (c) => {
  try {
    await getAuthenticatedUser(c);

    // Auto-seed if first time (with timeout protection)
    try {
      await Promise.race([
        seedIfNeeded(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Seed timeout")), 3000))
      ]);
    } catch (seedErr) {
      console.warn("[SALES LB] Seed/migration skipped due to timeout:", seedErr);
    }

    // Run migrations with timeout protection
    try {
      await Promise.race([
        Promise.all([migrateV2IfNeeded(), migrateV3IfNeeded(), migrateV4IfNeeded()]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Migration timeout")), 3000))
      ]);
    } catch (migErr) {
      console.warn("[SALES LB] Migrations skipped due to timeout:", migErr);
    }

    const deals = await getAllDeals();
    const leaderboard = buildLeaderboard(deals);

    const totalRevenue = leaderboard.reduce((s, r) => s + r.revenue, 0);
    const totalDeals = leaderboard.reduce((s, r) => s + r.conversions, 0);

    return c.json({
      leaderboard,
      summary: {
        total_reps: leaderboard.length,
        total_revenue: totalRevenue,
        total_deals: totalDeals,
      },
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[SALES LB] GET / error:", err);
    
    // Return empty state if query times out
    if (err.message?.includes("timeout") || err.message?.includes("Query timeout")) {
      console.warn("[SALES LB] Returning empty leaderboard due to timeout");
      return c.json({
        leaderboard: [],
        summary: { total_reps: 0, total_revenue: 0, total_deals: 0 },
        updated_at: new Date().toISOString(),
        warning: "Data temporarily unavailable due to high load",
      });
    }
    
    return c.json({ error: err.message || "Failed to load leaderboard" }, err.status || 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  POST /deal — Add or update a sales deal
//  Body: Partial<SalesDeal> with required sales_rep_email & customer_name
// ══════════════════════════════════════════════════════════════════════
app.post("/deal", async (c) => {
  try {
    await getAuthenticatedUser(c);

    const body = await c.req.json();
    const { sales_rep_email, sales_rep_name, customer_name, customer_email, amount, plan_interval, status, stripe_sub_id, stripe_checkout_session_id, notes, id } = body;

    if (!sales_rep_email || !customer_name) {
      return c.json({ error: "sales_rep_email and customer_name are required" }, 400);
    }

    const now = new Date().toISOString();
    const deal: SalesDeal = {
      id: id || `deal-${crypto.randomUUID().slice(0, 8)}`,
      sales_rep_email: sales_rep_email.toLowerCase(),
      sales_rep_name: sales_rep_name || sales_rep_email.split("@")[0],
      customer_name,
      customer_email: customer_email || undefined,
      amount: amount || 0,
      plan_interval: plan_interval || "yearly",
      status: status || "active",
      stripe_sub_id,
      stripe_checkout_session_id,
      notes,
      created_at: now,
      updated_at: now,
    };

    await storeDeal(deal);
    console.log(`[SALES LB] Deal recorded: ${deal.customer_name} → rep ${deal.sales_rep_email}, $${deal.amount}`);

    return c.json({ ok: true, deal });
  } catch (err: any) {
    console.error("[SALES LB] POST /deal error:", err);
    return c.json({ error: err.message || "Failed to record deal" }, err.status || 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  POST /update-deal-amount — Update amount for a specific deal
// ══════════════════════════════════════════════════════════════════════
app.post("/update-deal-amount", async (c) => {
  try {
    await getAuthenticatedUser(c);

    const { deal_id, amount } = await c.req.json();
    if (!deal_id || amount === undefined) {
      return c.json({ error: "deal_id and amount are required" }, 400);
    }

    const existing = await kv.get(`${DEAL_PREFIX}${deal_id}`);
    if (!existing) {
      return c.json({ error: "Deal not found" }, 404);
    }

    existing.amount = amount;
    existing.updated_at = new Date().toISOString();
    if (existing.notes?.includes("pending confirmation")) {
      existing.notes = existing.notes.replace("Revenue pending confirmation from payment system", `Revenue confirmed: $${amount}`);
    }

    await kv.set(`${DEAL_PREFIX}${deal_id}`, existing);
    console.log(`[SALES LB] Deal ${deal_id} amount updated to $${amount}`);

    return c.json({ ok: true, deal: existing });
  } catch (err: any) {
    console.error("[SALES LB] POST /update-deal-amount error:", err);
    return c.json({ error: err.message || "Failed to update deal" }, err.status || 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  DELETE /deal/:id — Remove a deal
// ══════════════════════════════════════════════════════════════════════
app.delete("/deal/:id", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    const dealId = c.req.param("id");
    if (!dealId) return c.json({ error: "Deal ID required" }, 400);

    const existing = await kv.get(`${DEAL_PREFIX}${dealId}`);
    if (!existing) return c.json({ error: "Deal not found" }, 404);

    await kv.del(`${DEAL_PREFIX}${dealId}`);
    console.log(`[SALES LB] Deal ${dealId} deleted by ${user.email}`);

    return c.json({ ok: true });
  } catch (err: any) {
    console.error("[SALES LB] DELETE /deal error:", err);
    return c.json({ error: err.message || "Failed to delete deal" }, err.status || 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  Webhook integration helper — called from handleStripeWebhook
//  Records a deal when a checkout completes or subscription activates
// ══════════════════════════════════════════════════════════════════════
export async function recordDealFromStripeEvent(event: {
  type: string;
  customer_email?: string;
  customer_name?: string;
  sales_rep_email?: string;
  amount: number;
  plan_interval?: string;
  stripe_sub_id?: string;
  stripe_checkout_session_id?: string;
}): Promise<void> {
  try {
    // Skip if no sales rep attribution
    if (!event.sales_rep_email) {
      console.log("[SALES LB] Stripe event skipped — no sales_rep_email attribution");
      return;
    }

    const now = new Date().toISOString();
    const deal: SalesDeal = {
      id: `stripe-${event.stripe_sub_id || event.stripe_checkout_session_id || crypto.randomUUID().slice(0, 8)}`,
      sales_rep_email: event.sales_rep_email.toLowerCase(),
      sales_rep_name: event.sales_rep_email.split("@")[0],
      customer_name: event.customer_name || event.customer_email || "Unknown",
      customer_email: event.customer_email,
      amount: event.amount,
      plan_interval: (event.plan_interval as any) || "monthly",
      status: "active",
      stripe_sub_id: event.stripe_sub_id,
      stripe_checkout_session_id: event.stripe_checkout_session_id,
      notes: `Auto-recorded from Stripe ${event.type}`,
      created_at: now,
      updated_at: now,
    };

    await storeDeal(deal);
    console.log(`[SALES LB] Stripe deal auto-recorded: ${deal.customer_name} → ${deal.sales_rep_email}, $${deal.amount}`);
  } catch (err) {
    console.error("[SALES LB] recordDealFromStripeEvent error:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Recurring revenue — called on invoice.payment_succeeded
//  Records a new deal entry for each billing cycle renewal so revenue
//  accumulates month-over-month / year-over-year while the sub is active.
// ══════════════════════════════════════════════════════════════════════
export async function recordRecurringPayment(event: {
  invoice_id: string;
  stripe_sub_id: string;
  customer_email?: string;
  customer_name?: string;
  amount: number;           // dollars (already divided by 100)
  plan_interval?: string;
  billing_reason: string;   // "subscription_cycle" | "subscription_create" | etc
}): Promise<void> {
  try {
    // Only track actual renewals, not the initial creation (checkout.session.completed handles that)
    if (event.billing_reason === "subscription_create") {
      console.log("[SALES LB] Skipping invoice for subscription_create (handled by checkout)");
      return;
    }

    // Look up the sales rep from the sub → rep mapping
    const repInfo = await kv.get(`${REP_SUB_PREFIX}${event.stripe_sub_id}`);
    if (!repInfo || !repInfo.email) {
      console.log(`[SALES LB] No sales rep mapped for sub ${event.stripe_sub_id} — skipping recurring revenue`);
      return;
    }

    const now = new Date().toISOString();
    const deal: SalesDeal = {
      id: `renewal-${event.invoice_id}`,
      sales_rep_email: repInfo.email.toLowerCase(),
      sales_rep_name: repInfo.name || repInfo.email.split("@")[0],
      customer_name: event.customer_name || event.customer_email || "Unknown",
      customer_email: event.customer_email,
      amount: event.amount,
      plan_interval: (event.plan_interval as any) || "monthly",
      status: "active",
      stripe_sub_id: event.stripe_sub_id,
      notes: `Recurring payment — ${event.billing_reason}`,
      created_at: now,
      updated_at: now,
    };

    await storeDeal(deal);
    console.log(`[SALES LB] ✅ Recurring revenue recorded: ${deal.customer_name} → ${repInfo.email}, $${deal.amount} (${event.billing_reason})`);
  } catch (err) {
    console.error("[SALES LB] recordRecurringPayment error:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Subscription canceled — marks all deals for this sub as canceled
//  so they stop counting toward revenue in the leaderboard.
// ══════════════════════════════════════════════════════════════════════
export async function markDealsAsCanceled(stripeSubId: string): Promise<void> {
  try {
    if (!stripeSubId) return;

    const allDeals = await getAllDeals();
    const affectedDeals = allDeals.filter(
      (d) => d.stripe_sub_id === stripeSubId && d.status === "active"
    );

    if (affectedDeals.length === 0) {
      console.log(`[SALES LB] No active deals found for canceled sub ${stripeSubId}`);
      return;
    }

    const now = new Date().toISOString();
    for (const deal of affectedDeals) {
      deal.status = "canceled";
      deal.updated_at = now;
      deal.notes = (deal.notes || "") + ` | Canceled ${now}`;
      await kv.set(`${DEAL_PREFIX}${deal.id}`, deal);
    }

    console.log(`[SALES LB] ✅ Marked ${affectedDeals.length} deal(s) as canceled for sub ${stripeSubId}`);
  } catch (err) {
    console.error("[SALES LB] markDealsAsCanceled error:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  GET /meetings — Get meeting overrides
// ══════════════════════════════════════════════════════════════════════
app.get("/meetings", async (c) => {
  try {
    await getAuthenticatedUser(c);
    const overrides = await kv.get("team_meeting_overrides") || {};
    return c.json({ meetings: overrides });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed" }, err.status || 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  POST /meetings — Update meeting overrides
//  Body: { email: string, meetings: number }
// ══════════════════════════════════════════════════════════════════════
app.post("/meetings", async (c) => {
  try {
    await getAuthenticatedUser(c);
    const { email, meetings } = await c.req.json();
    if (!email || meetings === undefined) {
      return c.json({ error: "email and meetings required" }, 400);
    }

    const overrides = (await kv.get("team_meeting_overrides")) || {};
    overrides[email.toLowerCase()] = Number(meetings);
    await kv.set("team_meeting_overrides", overrides);
    console.log(`[SALES LB] Meeting override: ${email} → ${meetings}`);

    return c.json({ ok: true, meetings: overrides });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed" }, err.status || 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  POST /reseed — Force re-seed (admin only, clears seeded flag)
// ══════════════════════════════════════════════════════════════════════
app.post("/reseed", async (c) => {
  try {
    const { user } = await getAuthenticatedUser(c);
    // Only allow admin emails
    const adminEmails = ["or@contndr.com", "or@roadr.com"];
    if (!adminEmails.includes(user.email?.toLowerCase() || "")) {
      return c.json({ error: "Admin only" }, 403);
    }

    await kv.set(SEEDED_KEY, false);
    await seedIfNeeded();

    return c.json({ ok: true, message: "Re-seeded successfully" });
  } catch (err: any) {
    console.error("[SALES LB] POST /reseed error:", err);
    return c.json({ error: err.message || "Failed to reseed" }, err.status || 500);
  }
});

export default app;