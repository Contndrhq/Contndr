/**
 * Billing Records — local paper trail of every Stripe-side financial event.
 *
 * Why this exists:
 *   When Stripe / a bank / an accountant / an investor / a customer's
 *   lawyer asks for proof of a transaction, we need to produce it WITHOUT
 *   logging into the Stripe dashboard or hoping their data is still there.
 *   Webhook events get mirrored into KV so we always have a local copy.
 *
 * Storage layout:
 *   billing:invoices:<userId>            → array of mirrored invoices
 *   billing:payments:<userId>            → array of mirrored payments/charges
 *   billing:refunds:<userId>             → array of refunds (separate from payments
 *                                          so we can show them as their own row)
 *   billing:disputes:<userId>            → array of dispute records
 *   billing:notes:<userId>               → array of admin notes
 *   billing:contracts:<userId>           → array of contract metadata (files
 *                                          themselves in Supabase Storage)
 *   billing:manual_charges:<userId>      → record of admin-triggered Stripe
 *                                          PaymentIntent charges (custom $)
 *
 * Why KV not SQL tables:
 *   Per-user, append-mostly arrays with bounded growth (a heavy customer
 *   has maybe 50 invoices/year). KV reads + JSON.parse are cheap, no
 *   migration overhead, matches the existing pattern.
 */

import * as kv from "./kv-retry.tsx";

// ─── Data shapes ─────────────────────────────────────────────────────────

export interface MirroredInvoice {
  id: string;                            // Stripe invoice ID (in_xxx)
  user_id: string;
  customer_id: string;                   // cus_xxx
  customer_email?: string;
  customer_name?: string;
  number?: string;                       // Human invoice number (INV-0001)
  amount_due: number;                    // cents
  amount_paid: number;                   // cents
  amount_remaining: number;              // cents
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  billing_reason?: string;               // subscription_create, subscription_cycle, etc.
  collection_method?: string;
  description?: string;
  period_start?: number;                 // unix
  period_end?: number;                   // unix
  due_date?: number;                     // unix
  paid_at?: number;                      // unix
  created_at: number;                    // unix (from Stripe)
  hosted_invoice_url?: string;           // public Stripe-hosted page
  invoice_pdf?: string;                  // direct PDF download
  payment_intent_id?: string;
  subscription_id?: string;
  lines?: Array<{
    description?: string;
    amount: number;
    quantity?: number;
    period_start?: number;
    period_end?: number;
  }>;
  mirrored_at: string;                   // ISO — when we stored this locally
}

export interface MirroredPayment {
  id: string;                            // Stripe charge ID (ch_xxx) or PaymentIntent pi_xxx
  user_id: string;
  customer_id?: string;
  customer_email?: string;
  amount: number;                        // cents
  amount_refunded: number;               // cents
  currency: string;
  status: string;                        // succeeded, pending, failed
  payment_method_type?: string;          // card, link, ach_debit, etc.
  payment_method_last4?: string;
  payment_method_brand?: string;         // visa, mastercard, amex
  receipt_url?: string;
  description?: string;
  invoice_id?: string;                   // when paid via subscription invoice
  refunded: boolean;
  disputed: boolean;
  failure_message?: string;
  created_at: number;                    // unix
  mirrored_at: string;
}

export interface MirroredRefund {
  id: string;                            // Stripe refund re_xxx
  user_id: string;
  charge_id: string;
  amount: number;                        // cents
  currency: string;
  reason?: string;
  status: string;
  created_at: number;
  mirrored_at: string;
}

export interface MirroredDispute {
  id: string;                            // Stripe dispute dp_xxx
  user_id: string;
  charge_id: string;
  amount: number;                        // cents
  currency: string;
  reason?: string;                       // fraudulent, product_not_received, etc.
  status: string;                        // warning_needs_response, needs_response, won, lost
  evidence_due_by?: number;              // unix
  created_at: number;
  mirrored_at: string;
}

export interface AdminNote {
  id: string;
  user_id: string;
  body: string;
  category?: 'general' | 'discount' | 'refund' | 'contract' | 'legacy' | 'warning';
  author_email: string;
  author_id: string;
  created_at: string;
}

export interface ContractMetadata {
  id: string;
  user_id: string;
  filename: string;
  storage_path: string;                  // path inside the `contracts` bucket
  size_bytes: number;
  mime_type: string;
  category: 'contract' | 'sow' | 'bank_statement' | 'approval_email' | 'custom_invoice' | 'receipt' | 'other';
  notes?: string;
  uploaded_by_email: string;
  uploaded_at: string;
}

export interface ManualCharge {
  id: string;                            // Stripe pi_xxx
  user_id: string;
  customer_id: string;
  amount_cents: number;
  currency: string;
  description?: string;
  reason?: string;                       // admin-typed reason
  status: string;
  charged_by_email: string;
  charged_at: string;
  receipt_url?: string;
}

// ─── KV keys ─────────────────────────────────────────────────────────────

export const invoicesKey = (userId: string) => `billing:invoices:${userId}`;
export const paymentsKey = (userId: string) => `billing:payments:${userId}`;
export const refundsKey = (userId: string) => `billing:refunds:${userId}`;
export const disputesKey = (userId: string) => `billing:disputes:${userId}`;
export const notesKey = (userId: string) => `billing:notes:${userId}`;
export const contractsKey = (userId: string) => `billing:contracts:${userId}`;
export const manualChargesKey = (userId: string) => `billing:manual_charges:${userId}`;

// ─── Helpers ─────────────────────────────────────────────────────────────

async function loadArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await kv.get(key);
    if (!raw) return [];
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) as T[]; } catch { return []; }
    }
    return Array.isArray(raw) ? raw as T[] : [];
  } catch {
    return [];
  }
}

async function saveArray<T>(key: string, arr: T[]): Promise<void> {
  await kv.set(key, arr);
}

/**
 * Upsert an item by id into a stored array, keeping the array bounded
 * (200 items most-recent) so KV reads stay snappy on heavy accounts.
 */
async function upsertById<T extends { id: string }>(
  key: string,
  next: T,
  maxItems = 200,
): Promise<void> {
  const arr = await loadArray<T>(key);
  const idx = arr.findIndex(x => x.id === next.id);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...next };
  } else {
    arr.unshift(next);
  }
  await saveArray(key, arr.slice(0, maxItems));
}

// ─── Mirror an arbitrary Stripe event into local KV ────────────────────

/**
 * Resolve the Contndr userId from a Stripe customer id by checking our
 * reverse lookup KV that the checkout flow already populates.
 */
export async function userIdForStripeCustomer(customerId: string): Promise<string | null> {
  if (!customerId) return null;
  try {
    const direct = await kv.get(`stripe_customer_reverse:${customerId}`);
    if (direct) return String(direct);
  } catch {}
  return null;
}

/** Mirror a Stripe invoice object to local KV. */
export async function mirrorInvoice(invoice: any, userIdHint?: string | null): Promise<void> {
  if (!invoice?.id) return;
  const userId = userIdHint || await userIdForStripeCustomer(invoice.customer);
  if (!userId) {
    console.warn(`[BILLING RECORDS] mirrorInvoice: no userId for customer=${invoice.customer}, skipping invoice ${invoice.id}`);
    return;
  }
  const mirrored: MirroredInvoice = {
    id: invoice.id,
    user_id: userId,
    customer_id: invoice.customer,
    customer_email: invoice.customer_email,
    customer_name: invoice.customer_name,
    number: invoice.number,
    amount_due: invoice.amount_due ?? 0,
    amount_paid: invoice.amount_paid ?? 0,
    amount_remaining: invoice.amount_remaining ?? 0,
    currency: invoice.currency || 'usd',
    status: invoice.status,
    billing_reason: invoice.billing_reason,
    collection_method: invoice.collection_method,
    description: invoice.description,
    period_start: invoice.period_start,
    period_end: invoice.period_end,
    due_date: invoice.due_date,
    paid_at: invoice.status_transitions?.paid_at,
    created_at: invoice.created,
    hosted_invoice_url: invoice.hosted_invoice_url,
    invoice_pdf: invoice.invoice_pdf,
    payment_intent_id: invoice.payment_intent,
    subscription_id: invoice.subscription,
    lines: (invoice.lines?.data || []).slice(0, 25).map((l: any) => ({
      description: l.description,
      amount: l.amount,
      quantity: l.quantity,
      period_start: l.period?.start,
      period_end: l.period?.end,
    })),
    mirrored_at: new Date().toISOString(),
  };
  await upsertById(invoicesKey(userId), mirrored);
}

/** Mirror a Stripe charge or PaymentIntent to local KV. */
export async function mirrorPayment(charge: any, userIdHint?: string | null): Promise<void> {
  if (!charge?.id) return;
  const userId = userIdHint || await userIdForStripeCustomer(charge.customer);
  if (!userId) {
    console.warn(`[BILLING RECORDS] mirrorPayment: no userId for customer=${charge.customer}, skipping ${charge.id}`);
    return;
  }
  const pm = charge.payment_method_details || {};
  const card = pm.card || {};
  const mirrored: MirroredPayment = {
    id: charge.id,
    user_id: userId,
    customer_id: charge.customer,
    customer_email: charge.billing_details?.email || charge.receipt_email,
    amount: charge.amount ?? 0,
    amount_refunded: charge.amount_refunded ?? 0,
    currency: charge.currency || 'usd',
    status: charge.status,
    payment_method_type: charge.payment_method_details?.type,
    payment_method_last4: card.last4 || pm?.us_bank_account?.last4,
    payment_method_brand: card.brand,
    receipt_url: charge.receipt_url,
    description: charge.description,
    invoice_id: charge.invoice,
    refunded: !!charge.refunded,
    disputed: !!charge.disputed,
    failure_message: charge.failure_message,
    created_at: charge.created,
    mirrored_at: new Date().toISOString(),
  };
  await upsertById(paymentsKey(userId), mirrored);
}

/** Mirror a refund object. */
export async function mirrorRefund(refund: any, userIdHint?: string | null): Promise<void> {
  if (!refund?.id || !refund.charge) return;
  // Refunds don't have a customer field — derive via the charge
  let userId = userIdHint || null;
  if (!userId) {
    try {
      const { default: Stripe } = await import("npm:stripe@14.21.0");
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (stripeKey) {
        const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
        const charge = await stripe.charges.retrieve(refund.charge);
        userId = await userIdForStripeCustomer(charge.customer as string);
      }
    } catch (err) {
      console.warn(`[BILLING RECORDS] mirrorRefund: lookup failed for ${refund.id}:`, err);
    }
  }
  if (!userId) return;
  const mirrored: MirroredRefund = {
    id: refund.id,
    user_id: userId,
    charge_id: refund.charge,
    amount: refund.amount ?? 0,
    currency: refund.currency || 'usd',
    reason: refund.reason,
    status: refund.status,
    created_at: refund.created,
    mirrored_at: new Date().toISOString(),
  };
  await upsertById(refundsKey(userId), mirrored);
}

/** Mirror a dispute object. */
export async function mirrorDispute(dispute: any, userIdHint?: string | null): Promise<void> {
  if (!dispute?.id || !dispute.charge) return;
  let userId = userIdHint || null;
  if (!userId) {
    try {
      const { default: Stripe } = await import("npm:stripe@14.21.0");
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (stripeKey) {
        const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
        const charge = await stripe.charges.retrieve(dispute.charge);
        userId = await userIdForStripeCustomer(charge.customer as string);
      }
    } catch (err) {
      console.warn(`[BILLING RECORDS] mirrorDispute: lookup failed for ${dispute.id}:`, err);
    }
  }
  if (!userId) return;
  const mirrored: MirroredDispute = {
    id: dispute.id,
    user_id: userId,
    charge_id: dispute.charge,
    amount: dispute.amount ?? 0,
    currency: dispute.currency || 'usd',
    reason: dispute.reason,
    status: dispute.status,
    evidence_due_by: dispute.evidence_details?.due_by,
    created_at: dispute.created,
    mirrored_at: new Date().toISOString(),
  };
  await upsertById(disputesKey(userId), mirrored);
}

/**
 * Dispatch a Stripe event to the appropriate mirror function.
 * Called from the existing webhook handler in contndr-billing.tsx so we
 * persist a local copy of every financial event without adding a second
 * webhook endpoint.
 */
export async function mirrorStripeEvent(event: any): Promise<void> {
  const obj = event?.data?.object;
  if (!obj) return;

  try {
    switch (event.type) {
      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.updated':
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
      case 'invoice.voided':
      case 'invoice.marked_uncollectible':
        await mirrorInvoice(obj);
        break;

      case 'charge.succeeded':
      case 'charge.updated':
      case 'charge.failed':
      case 'charge.captured':
      case 'charge.refunded':
        await mirrorPayment(obj);
        break;

      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
        // PaymentIntent → look up the latest charge and mirror that
        if (obj.latest_charge && typeof obj.latest_charge === 'object') {
          await mirrorPayment(obj.latest_charge);
        }
        break;

      case 'refund.created':
      case 'refund.updated':
      case 'charge.refund.updated':
        await mirrorRefund(obj);
        break;

      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        await mirrorDispute(obj);
        break;
    }
  } catch (err) {
    // Never block the main webhook path on a mirror failure
    console.error(`[BILLING RECORDS] mirrorStripeEvent ${event.type} failed (non-fatal):`, err);
  }
}

// ─── On-demand Stripe backfill ───────────────────────────────────────────

/**
 * Pull every invoice + payment + refund + dispute for a user's Stripe
 * customer and mirror them locally. Used by the "Sync from Stripe" admin
 * button to backfill historical data captured before webhooks fired.
 */
export async function backfillBillingFromStripe(
  userId: string,
  customerId: string,
): Promise<{ invoices: number; payments: number; refunds: number; disputes: number }> {
  const { default: Stripe } = await import("npm:stripe@14.21.0");
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not configured');
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  const counts = { invoices: 0, payments: 0, refunds: 0, disputes: 0 };

  // Invoices — paginate up to 200 (last 1-2 years for a typical customer)
  try {
    const invoices = await stripe.invoices.list({ customer: customerId, limit: 100 });
    for (const inv of invoices.data) {
      await mirrorInvoice(inv, userId);
      counts.invoices++;
    }
  } catch (err) {
    console.warn(`[BILLING RECORDS] invoice backfill failed for ${customerId}:`, err);
  }

  // Charges — same window
  try {
    const charges = await stripe.charges.list({ customer: customerId, limit: 100 });
    for (const ch of charges.data) {
      await mirrorPayment(ch, userId);
      counts.payments++;
      // Refunds are embedded on each charge; pick out separately
      for (const r of (ch.refunds?.data || [])) {
        await mirrorRefund(r, userId);
        counts.refunds++;
      }
    }
  } catch (err) {
    console.warn(`[BILLING RECORDS] charges backfill failed for ${customerId}:`, err);
  }

  // Disputes — global list filtered by customer (Stripe doesn't support
  // .list({customer}) on disputes directly, so we walk the recent ones
  // and filter client-side)
  try {
    const disputes = await stripe.disputes.list({ limit: 100 });
    for (const d of disputes.data) {
      // Resolve user via the charge
      let chargeCustomerId: string | undefined;
      try {
        const ch = await stripe.charges.retrieve(d.charge as string);
        chargeCustomerId = ch.customer as string;
      } catch {}
      if (chargeCustomerId === customerId) {
        await mirrorDispute(d, userId);
        counts.disputes++;
      }
    }
  } catch (err) {
    console.warn(`[BILLING RECORDS] disputes backfill failed:`, err);
  }

  console.log(`[BILLING RECORDS] Backfilled for ${userId}/${customerId}:`, counts);
  return counts;
}

// ─── Loaders for the admin UI ─────────────────────────────────────────

export async function getInvoices(userId: string): Promise<MirroredInvoice[]> {
  return loadArray<MirroredInvoice>(invoicesKey(userId));
}
export async function getPayments(userId: string): Promise<MirroredPayment[]> {
  return loadArray<MirroredPayment>(paymentsKey(userId));
}
export async function getRefunds(userId: string): Promise<MirroredRefund[]> {
  return loadArray<MirroredRefund>(refundsKey(userId));
}
export async function getDisputes(userId: string): Promise<MirroredDispute[]> {
  return loadArray<MirroredDispute>(disputesKey(userId));
}
export async function getNotes(userId: string): Promise<AdminNote[]> {
  return loadArray<AdminNote>(notesKey(userId));
}
export async function getContracts(userId: string): Promise<ContractMetadata[]> {
  return loadArray<ContractMetadata>(contractsKey(userId));
}
export async function getManualCharges(userId: string): Promise<ManualCharge[]> {
  return loadArray<ManualCharge>(manualChargesKey(userId));
}

// ─── Admin notes CRUD helpers ─────────────────────────────────────────

export async function addNote(userId: string, body: string, category: AdminNote['category'], author: { email: string; id: string }): Promise<AdminNote> {
  const note: AdminNote = {
    id: `note_${crypto.randomUUID()}`,
    user_id: userId,
    body: String(body).slice(0, 2000),
    category: category || 'general',
    author_email: author.email,
    author_id: author.id,
    created_at: new Date().toISOString(),
  };
  const arr = await getNotes(userId);
  arr.unshift(note);
  await saveArray(notesKey(userId), arr.slice(0, 500));
  return note;
}

export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  const arr = await getNotes(userId);
  const next = arr.filter(n => n.id !== noteId);
  if (next.length === arr.length) return false;
  await saveArray(notesKey(userId), next);
  return true;
}

export async function addManualCharge(userId: string, charge: ManualCharge): Promise<void> {
  const arr = await getManualCharges(userId);
  arr.unshift(charge);
  await saveArray(manualChargesKey(userId), arr.slice(0, 500));
}
