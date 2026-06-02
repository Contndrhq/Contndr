/**
 * Products module — what the user sells, used by the pipeline auto-stage
 * matcher (Phase 2). Persisted in KV under `products:<userId>` as an array.
 *
 * Why KV instead of a dedicated table:
 *   - Per-user, low-cardinality data (typical user has 1-5 products)
 *   - No need for cross-user queries
 *   - Matches the pattern already used for sub-state, plan recommendation,
 *     campaign drafts, etc.
 */

import { Hono } from "npm:hono";
import * as kv from "./kv-retry.tsx";
import { PLAN_ENTITLEMENTS } from "./plan-entitlements.ts";

export interface ProductMatchingRules {
  /** Min company headcount the product is a fit for */
  min_employees?: number;
  /** Max company headcount before the product is "outgrown" */
  max_employees?: number;
  /** Min monthly outbound lead volume the prospect has */
  min_lead_volume?: number;
  /** Max monthly lead volume — above this, recommend a higher tier */
  max_lead_volume?: number;
  /** Optional industry allowlist (case-insensitive substring match) */
  industries?: string[];
}

export interface Product {
  id: string;
  name: string;
  /** Price in cents to avoid float weirdness */
  price_cents: number;
  /** monthly / yearly subscriptions or one-time deals */
  interval: 'monthly' | 'yearly' | 'one_time';
  /** When a lead matches this product, auto-route to this pipeline stage.
   *  Stored as the stage name (e.g. "Demo Scheduled") not an ID so it
   *  survives pipeline reordering. Matcher will best-effort resolve. */
  target_pipeline_stage?: string;
  /** Scoring rules — leads matching more of these get a higher score */
  matching_rules?: ProductMatchingRules;
  /** Short customer-facing description, used in personalized email scripts */
  description?: string;
  created_at: string;
  updated_at: string;
}

function productsKey(userId: string): string {
  return `products:${userId}`;
}

/** Returns the user's products, seeding Contndr's plans on first call so a
 *  brand-new account ships with a working example instead of an empty list. */
export async function getProducts(userId: string): Promise<Product[]> {
  const raw = await kv.get(productsKey(userId));
  if (Array.isArray(raw) && raw.length > 0) return raw as Product[];
  // First-time user → seed with Contndr's own subscription tiers so the
  // pipeline auto-routing works out of the box. They can edit / delete
  // these from Settings → Products.
  const seeded = seedContndrPlans();
  await kv.set(productsKey(userId), seeded);
  return seeded;
}

export async function saveProducts(userId: string, products: Product[]): Promise<void> {
  await kv.set(productsKey(userId), products);
}

export function seedContndrPlans(): Product[] {
  const now = new Date().toISOString();
  // Pull canonical lead-volume thresholds straight from PLAN_ENTITLEMENTS so
  // the seed never drifts from the real plan caps.
  const growthLimit = PLAN_ENTITLEMENTS.growth.monthlyLeadLimit;
  const scaleLimit = PLAN_ENTITLEMENTS.scale.monthlyLeadLimit;
  return [
    {
      id: 'seed_growth',
      name: 'Growth',
      price_cents: 49900,
      interval: 'monthly',
      target_pipeline_stage: 'Qualified',
      description: 'For teams getting serious about outbound — up to 10k leads/mo.',
      matching_rules: {
        max_employees: 50,
        max_lead_volume: growthLimit,
      },
      created_at: now,
      updated_at: now,
    },
    {
      id: 'seed_scale',
      name: 'Scale',
      price_cents: 99900,
      interval: 'monthly',
      target_pipeline_stage: 'Demo Scheduled',
      description: 'For mid-market teams scaling outreach — 50k leads/mo, AI calling.',
      matching_rules: {
        min_employees: 20,
        max_employees: 200,
        min_lead_volume: growthLimit,
        max_lead_volume: scaleLimit,
      },
      created_at: now,
      updated_at: now,
    },
    {
      id: 'seed_enterprise',
      name: 'Enterprise',
      price_cents: 250000,
      interval: 'monthly',
      target_pipeline_stage: 'Demo Scheduled',
      description: 'Unlimited volume + seats + dedicated success — for 200+ rep orgs.',
      matching_rules: {
        min_employees: 200,
        min_lead_volume: scaleLimit,
      },
      created_at: now,
      updated_at: now,
    },
  ];
}

/** Score a lead against every product, return them sorted best-match first. */
export function rankProductsForLead(
  products: Product[],
  lead: { num_employees?: number; industry?: string; estimated_monthly_lead_volume?: number },
): { product: Product; score: number }[] {
  return products
    .map(product => ({ product, score: scoreProductForLead(product, lead) }))
    .sort((a, b) => b.score - a.score);
}

export function scoreProductForLead(
  product: Product,
  lead: { num_employees?: number; industry?: string; estimated_monthly_lead_volume?: number },
): number {
  const rules = product.matching_rules;
  if (!rules) return 1; // No rules → baseline match for everyone

  let score = 0;
  let checks = 0;

  // Employee count: in-range = +2, off-by-a-little = +0, way off = -2
  if (typeof lead.num_employees === 'number') {
    checks++;
    const e = lead.num_employees;
    const above = typeof rules.min_employees === 'number' ? e >= rules.min_employees : true;
    const below = typeof rules.max_employees === 'number' ? e <= rules.max_employees : true;
    if (above && below) score += 2;
    else if (!above && rules.min_employees && e >= rules.min_employees * 0.5) score += 0;
    else if (!below && rules.max_employees && e <= rules.max_employees * 1.5) score += 0;
    else score -= 2;
  }

  // Lead volume — same shape as employees
  if (typeof lead.estimated_monthly_lead_volume === 'number') {
    checks++;
    const v = lead.estimated_monthly_lead_volume;
    const above = typeof rules.min_lead_volume === 'number' ? v >= rules.min_lead_volume : true;
    const below = typeof rules.max_lead_volume === 'number' && rules.max_lead_volume > 0
      ? v <= rules.max_lead_volume
      : true;
    if (above && below) score += 2;
    else score -= 1;
  }

  // Industry: explicit match wins big; no overlap is a soft no
  if (Array.isArray(rules.industries) && rules.industries.length > 0) {
    checks++;
    const leadIndustry = (lead.industry || '').toLowerCase();
    if (leadIndustry && rules.industries.some(i => leadIndustry.includes(i.toLowerCase()))) {
      score += 3;
    } else {
      score -= 1;
    }
  }

  // Normalize: if no checks fired we have no signal — give a base score so
  // we don't penalize products with no rules vs. products with rules.
  return checks === 0 ? 1 : score;
}

/**
 * Find the best-fit product for a lead and return a prompt-ready string
 * for injection into AI email / call generators. Designed to be cheap
 * (cached products lookup) and fail-safe (returns empty string on any
 * error, so callers can just concat it into the prompt blindly).
 *
 * Caller passes the raw lead row (camelCase or snake_case both fine).
 * Returns '' when there's no usable signal.
 */
export async function getProductPromptContext(
  userId: string,
  lead: Record<string, any>,
): Promise<string> {
  try {
    const products = await getProducts(userId);
    if (!products.length) return '';
    const ranked = rankProductsForLead(products, {
      num_employees: lead.num_employees ?? lead.estimated_num_employees ?? lead.numEmployees,
      industry: lead.industry || lead.category,
      estimated_monthly_lead_volume: lead.estimated_monthly_lead_volume ?? lead.monthly_lead_volume,
    });
    const top = ranked[0];
    if (!top || top.score <= 0) return '';
    const price = `$${(top.product.price_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const intervalLabel = top.product.interval === 'monthly' ? '/mo' : top.product.interval === 'yearly' ? '/yr' : ' one-time';
    const lines: string[] = [];
    lines.push(`BEST-FIT PRODUCT FOR THIS PROSPECT: "${top.product.name}" (${price}${intervalLabel})`);
    if (top.product.description) {
      lines.push(`Description: ${top.product.description}`);
    }
    lines.push(`Anchor the conversation on this tier. Mention the plan name and price naturally when relevant. Don't pretend other tiers don't exist, but lead with this one — it's the best fit based on the prospect's size and volume.`);
    return lines.join('\n');
  } catch (err) {
    console.warn('[PRODUCTS] getProductPromptContext failed:', err);
    return '';
  }
}

// ─── HTTP routes ───────────────────────────────────────────────────────────

export function registerProductsRoutes(app: Hono, getUser: (c: any) => Promise<{ user: any }>) {
  // GET /products — list this user's products (seeds Contndr plans on first call)
  app.get("/make-server-a8b2511f/products", async (c) => {
    try {
      const { user } = await getUser(c);
      const products = await getProducts(user.id);
      return c.json({ success: true, products });
    } catch (error: any) {
      console.error('[PRODUCTS] list error:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  // POST /products — create a new product
  app.post("/make-server-a8b2511f/products", async (c) => {
    try {
      const { user } = await getUser(c);
      const body = await c.req.json();
      if (!body.name || typeof body.price_cents !== 'number') {
        return c.json({ error: 'name and price_cents are required' }, 400);
      }
      const products = await getProducts(user.id);
      const now = new Date().toISOString();
      const product: Product = {
        id: `prod_${crypto.randomUUID()}`,
        name: String(body.name).slice(0, 100),
        price_cents: Math.max(0, Math.floor(body.price_cents)),
        interval: ['monthly', 'yearly', 'one_time'].includes(body.interval) ? body.interval : 'monthly',
        target_pipeline_stage: body.target_pipeline_stage || undefined,
        description: body.description ? String(body.description).slice(0, 500) : undefined,
        matching_rules: body.matching_rules || undefined,
        created_at: now,
        updated_at: now,
      };
      products.push(product);
      await saveProducts(user.id, products);
      return c.json({ success: true, product });
    } catch (error: any) {
      console.error('[PRODUCTS] create error:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  // PATCH /products/:id — update a product in place
  app.patch("/make-server-a8b2511f/products/:id", async (c) => {
    try {
      const { user } = await getUser(c);
      const id = c.req.param('id');
      const body = await c.req.json();
      const products = await getProducts(user.id);
      const idx = products.findIndex(p => p.id === id);
      if (idx === -1) return c.json({ error: 'Product not found' }, 404);
      const existing = products[idx];
      products[idx] = {
        ...existing,
        name: body.name !== undefined ? String(body.name).slice(0, 100) : existing.name,
        price_cents: typeof body.price_cents === 'number' ? Math.max(0, Math.floor(body.price_cents)) : existing.price_cents,
        interval: ['monthly', 'yearly', 'one_time'].includes(body.interval) ? body.interval : existing.interval,
        target_pipeline_stage: body.target_pipeline_stage !== undefined ? body.target_pipeline_stage : existing.target_pipeline_stage,
        description: body.description !== undefined ? body.description : existing.description,
        matching_rules: body.matching_rules !== undefined ? body.matching_rules : existing.matching_rules,
        updated_at: new Date().toISOString(),
      };
      await saveProducts(user.id, products);
      return c.json({ success: true, product: products[idx] });
    } catch (error: any) {
      console.error('[PRODUCTS] update error:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  // DELETE /products/:id
  app.delete("/make-server-a8b2511f/products/:id", async (c) => {
    try {
      const { user } = await getUser(c);
      const id = c.req.param('id');
      const products = await getProducts(user.id);
      const next = products.filter(p => p.id !== id);
      if (next.length === products.length) return c.json({ error: 'Product not found' }, 404);
      await saveProducts(user.id, next);
      return c.json({ success: true });
    } catch (error: any) {
      console.error('[PRODUCTS] delete error:', error);
      return c.json({ error: error.message }, 500);
    }
  });
}
