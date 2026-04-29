import Stripe from 'npm:stripe@17';
import * as kv from './kv-retry.tsx';

// Helper to safely initialize Stripe clients
function createStripeClient(apiKey: string | undefined, brand: string): Stripe | null {
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  try {
    return new Stripe(apiKey, {
      apiVersion: '2024-11-20.acacia',
    });
  } catch (error) {
    console.error(`Error initializing ${brand} Stripe client:`, error);
    return null;
  }
}

// Helper to get Stripe client for a user
export async function getUserStripeClient(user: any, brand: string): Promise<Stripe | null> {
  // Multi-tenant: Get from KV
  // We check for a brand-specific key first
  let apiKey = await kv.get(`stripe_config:${user.id}:${brand}:secret_key`);
  
  // If not found, check if there's a "default" key
  if (!apiKey) {
      apiKey = await kv.get(`stripe_config:${user.id}:default:secret_key`);
  }

  // Fallback to system env var if Contndr or default
  if (!apiKey && (brand === 'contndr' || brand === 'sendlr' || brand === 'default')) {
      apiKey = Deno.env.get('STRIPE_SECRET_KEY');
  }

  if (apiKey) {
      return createStripeClient(apiKey, brand);
  }
  
  return null;
}

// Helper to generate storage keys
function getStorageKey(user: any, type: 'payment' | 'subscription' | 'revenue_metrics', brand: string, id?: string): string {
    const suffix = id ? `:${id}` : '';
    return `${type}:${user.id}:${brand}${suffix}`;
}

function getPrefix(user: any, type: 'payment' | 'subscription', brand: string): string {
     return `${type}:${user.id}:${brand}:`;
}

const INTERNAL_REVENUE_OWNER_IDS: Record<string, string[]> = {};

function getRevenueOwnerIds(user: any): string[] {
  const email = String(user?.email || "").toLowerCase().trim();
  const linked = INTERNAL_REVENUE_OWNER_IDS[email] || [];
  return Array.from(new Set([user.id, ...linked].filter(Boolean)));
}

function getRevenuePrefixes(user: any, type: 'payment' | 'subscription', brand: string): string[] {
  const brands = brand === 'all' || brand === 'default' ? ['default', 'contndr'] : [brand];
  const prefixes = getRevenueOwnerIds(user).flatMap((ownerId) =>
    brands.map((brandName) => `${type}:${ownerId}:${brandName}:`)
  );

  const email = String(user?.email || "").toLowerCase().trim();
  if (email === 'or@roadr.com') {
    // Legacy imports stored Roadr/Sourcr revenue without a Supabase user id.
    prefixes.push(`${type}:roadr:`, `${type}:sourcr:`);
  }

  return Array.from(new Set(prefixes));
}

async function getRecordsByPrefixes<T>(prefixes: string[], label: string): Promise<T[]> {
  const recordSets = await Promise.all(prefixes.map((prefix) =>
    kv.getByPrefix(prefix).catch((e: any) => {
      console.warn(`[STRIPE] ${label} prefix ${prefix} failed:`, e?.message?.slice(0, 120));
      return [];
    })
  ));
  return recordSets.flat() as T[];
}

// Payment tracking structure
export interface PaymentRecord {
  id: string; // payment_id
  brand: string;
  type: 'subscription' | 'one_time';
  customer_email: string;
  customer_name?: string;
  customer_id: string; // Stripe customer ID
  amount: number; // in cents
  currency: string;
  status: 'succeeded' | 'failed' | 'pending';
  lead_id?: string; // Matched lead ID from our database
  campaign_id?: string; // Campaign that converted this customer
  email_id?: string; // Specific email that led to conversion
  subscription_id?: string;
  invoice_id?: string; // For subscription invoices
  payment_intent_id?: string; // Stripe payment intent
  checkout_session_id?: string; // Checkout session
  metadata?: {
    product?: string;
    plan?: string; // monthly, annual, etc.
    mrr?: number; // Monthly Recurring Revenue (for subscriptions)
    ltv?: number; // Estimated Lifetime Value
  };
  created_at: string;
  updated_at: string;
}

// Subscription tracking
export interface SubscriptionRecord {
  id: string; // subscription_id
  brand: string;
  customer_email: string;
  customer_id: string;
  lead_id?: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  plan: string; // monthly, annual
  amount: number; // in cents
  currency: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  mrr: number; // Monthly Recurring Revenue
  created_at: string;
  updated_at: string;
}

// Revenue metrics cache
export interface RevenueMetrics {
  brand: string;
  total_revenue: number; // All-time revenue
  monthly_revenue: number; // This month
  weekly_revenue: number; // This week
  daily_revenue: number; // Today
  mrr: number; // Monthly Recurring Revenue
  arr: number; // Annual Recurring Revenue
  total_customers: number;
  active_subscriptions: number;
  churn_rate: number;
  avg_deal_size: number;
  conversion_rate: number; // Leads → Customers
  revenue_per_lead: number; // Total revenue / total leads
  updated_at: string;
}

// Attribution tracking - link payment to campaign/email
export async function attributePaymentToLead(
  customerEmail: string,
  brand: string,
  supabase: any
): Promise<{ lead_id?: string; campaign_id?: string; email_id?: string }> {
  try {
    // Step 1: Find lead by email
    const { data: leads, error: leadError } = await supabase
      .from('leads')
      .select('id, email, brand')
      .ilike('email', customerEmail)
      .limit(1);

    if (leadError || !leads || leads.length === 0) {
      return {};
    }

    const lead = leads[0];

    // Step 2: Find the most recent email sent to this lead (likely the one that converted)
    const { data: emails, error: emailError } = await supabase
      .from('emails')
      .select('id, campaign_id, status, opened_at, clicked_at')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(5); // Get last 5 emails to find the one they engaged with

    if (emailError || !emails || emails.length === 0) {
      return { lead_id: lead.id };
    }

    // Prioritize emails that were clicked > opened > sent
    const clickedEmail = emails.find(e => e.clicked_at);
    const openedEmail = emails.find(e => e.opened_at);
    const mostRecentEmail = emails[0];

    const convertingEmail = clickedEmail || openedEmail || mostRecentEmail;

    return {
      lead_id: lead.id,
      campaign_id: convertingEmail.campaign_id,
      email_id: convertingEmail.id,
    };
  } catch (error) {
    console.error('Error attributing payment to lead:', error);
    return {};
  }
}

// Store payment record
export async function storePayment(user: any, payment: PaymentRecord): Promise<void> {
  const key = getStorageKey(user, 'payment', payment.brand, payment.id);
  await kv.set(key, payment);
}

// Store subscription record
export async function storeSubscription(user: any, subscription: SubscriptionRecord): Promise<void> {
  const key = getStorageKey(user, 'subscription', subscription.brand, subscription.id);
  await kv.set(key, subscription);
}

// Get all payments for a brand
export async function getPaymentsByBrand(user: any, brand: string): Promise<PaymentRecord[]> {
  const raw = await getRecordsByPrefixes<PaymentRecord>(
    getRevenuePrefixes(user, 'payment', brand),
    'getPaymentsByBrand'
  );

  // Multi-layer dedup: first by id, then by payment_intent_id, then by customer+amount+time window
  const seenIds = new Set<string>();
  const seenPIs = new Set<string>();
  const deduped: PaymentRecord[] = [];

  // Sort so pi_ prefixed IDs are preferred (they're the canonical source)
  raw.sort((a, b) => {
    if (a.id.startsWith('pi_') && !b.id.startsWith('pi_')) return -1;
    if (!a.id.startsWith('pi_') && b.id.startsWith('pi_')) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  for (const p of raw) {
    // Skip exact ID duplicates
    if (seenIds.has(p.id)) continue;

    // Skip if same payment_intent_id already seen
    if (p.payment_intent_id && seenPIs.has(p.payment_intent_id)) continue;

    // Check against already accepted payments for "fuzzy" duplicates
    // i.e., same email, same amount, one is cs_ and one is pi_, within 24h
    let isFuzzyDuplicate = false;
    for (const accepted of deduped) {
      if (accepted.customer_email === p.customer_email && accepted.amount === p.amount) {
        const timeDiff = Math.abs(new Date(accepted.created_at).getTime() - new Date(p.created_at).getTime());
        const isMixedTypeMatch = (accepted.id.startsWith('cs_') && p.id.startsWith('pi_')) || 
                                 (accepted.id.startsWith('pi_') && p.id.startsWith('cs_'));
        if (isMixedTypeMatch && timeDiff < 86400000) {
          isFuzzyDuplicate = true;
          break;
        }
      }
    }
    
    if (isFuzzyDuplicate) continue;

    seenIds.add(p.id);
    if (p.payment_intent_id) seenPIs.add(p.payment_intent_id);
    deduped.push(p);
  }

  // Sort so pi_ prefixed IDs are preferred if we need to return?
  // Wait, the API consumer expects sorted by date desc anyway, but the original code sorted by pi_ first.
  // Actually, returning newest first is better for the UI.
  return deduped;
}

// Get all subscriptions
export async function getActiveSubscriptions(user: any): Promise<SubscriptionRecord[]> {
  const subscriptions = await getRecordsByPrefixes<SubscriptionRecord>(
    getRevenuePrefixes(user, 'subscription', 'all'),
    'getActiveSubscriptions'
  );
  // Deduplicate by id
  const seen = new Set<string>();
  const merged: SubscriptionRecord[] = [];
  for (const s of subscriptions) {
    if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
  }
  return merged.filter(sub => sub.status === 'active' || sub.status === 'trialing');
}

// Sync subscriptions from Stripe API
export async function syncStripeSubscriptions(user: any): Promise<{ success: boolean; synced: number; errors: string[] }> {
  try {
    const brand = 'default';
    console.log(`🔄 Syncing subscriptions from Stripe for user ${user.id}...`);
    
    const stripe = await getUserStripeClient(user, brand);
    
    if (!stripe) {
      console.error(`❌ Stripe ${brand} client not initialized`);
      return {
        success: false,
        synced: 0,
        errors: [`Stripe ${brand} client not initialized. Configure your API key.`]
      };
    }

    let syncedCount = 0;
    const errors: string[] = [];

    // Fetch all subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      limit: 100,
      status: 'all',
    });

    console.log(`📦 Found ${subscriptions.data.length} subscriptions in Stripe`);

    for (const sub of subscriptions.data) {
      try {
        // Get customer details
        const customer = await stripe.customers.retrieve(sub.customer as string);
        
        if (customer.deleted) {
          continue;
        }

        // Calculate MRR from subscription items
        let mrr = 0;
        for (const item of sub.items.data) {
          const amount = item.price.unit_amount || 0;
          // Convert to monthly if needed
          if (item.price.recurring?.interval === 'year') {
            mrr += amount / 12;
          } else if (item.price.recurring?.interval === 'month') {
            mrr += amount;
          }
        }

        const subscription: SubscriptionRecord = {
          id: sub.id,
          brand,
          customer_id: customer.id,
          customer_email: customer.email || '',
          customer_name: customer.name || undefined,
          status: sub.status as any,
          mrr: Math.round(mrr),
          currency: (sub.currency || 'usd').toUpperCase(),
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end,
          created_at: new Date(sub.created * 1000).toISOString(),
          updated_at: new Date().toISOString()
        };

        await storeSubscription(user, subscription);
        syncedCount++;
        
      } catch (error) {
        console.error(`Error processing subscription ${sub.id}:`, error);
        errors.push(`Subscription ${sub.id}: ${error.message}`);
      }
    }

    return {
      success: true,
      synced: syncedCount,
      errors
    };

  } catch (error) {
    console.error('Error syncing subscriptions:', error);
    return {
      success: false,
      synced: 0,
      errors: [error.message]
    };
  }
}

// Sync historical payments from Stripe API
export async function syncHistoricalPayments(
  user: any,
  brand: string = 'default',
  daysBack: number = 30
): Promise<{ success: boolean; synced: number; errors: string[] }> {
  try {
    console.log(`🔄 Syncing ${brand} payments from last ${daysBack} days...`);
    
    const stripe = await getUserStripeClient(user, brand);
    
    if (!stripe) {
      return {
        success: false,
        synced: 0,
        errors: [`${brand} Stripe client not configured`]
      };
    }

    const errors: string[] = [];
    let syncedCount = 0;
    
    // Calculate timestamp for daysBack
    const created = Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60);

    // Track payment_intent IDs to avoid duplicates
    const processedPaymentIntents = new Set<string>();

    // Fetch payment intents (primary source of truth)
    const paymentIntents = await stripe.paymentIntents.list({
      created: { gte: created },
      limit: 100
    });

    for (const pi of paymentIntents.data) {
      try {
        if (pi.status === 'succeeded' && pi.customer) {
          // Check if we already have this payment
          const existingKey = getStorageKey(user, 'payment', brand, pi.id);
          const existing = await kv.get(existingKey);
          
          if (existing) {
            processedPaymentIntents.add(pi.id); // Mark as processed
            continue; // Skip if already exists
          }

          // Fetch customer details
          const customer = await stripe.customers.retrieve(pi.customer as string) as Stripe.Customer;
          
          if (customer.deleted) continue;

          const payment: PaymentRecord = {
            id: pi.id,
            brand,
            type: pi.invoice ? 'subscription' : 'one_time',
            customer_email: customer.email || '',
            customer_name: customer.name || undefined,
            customer_id: customer.id,
            amount: pi.amount,
            currency: pi.currency.toUpperCase(),
            status: 'succeeded',
            subscription_id: pi.invoice ? (typeof pi.invoice === 'string' ? pi.invoice : pi.invoice.id) : undefined,
            payment_intent_id: pi.id,
            created_at: new Date(pi.created * 1000).toISOString(),
            updated_at: new Date().toISOString()
          };

          // Store payment
          await storePayment(user, payment);
          processedPaymentIntents.add(pi.id);
          syncedCount++;
        }
      } catch (error) {
        console.error(`Error processing payment ${pi.id}:`, error);
        errors.push(`Payment ${pi.id}: ${error.message}`);
      }
    }

    // Also fetch checkout sessions (only for payments not already processed)
    const sessions = await stripe.checkout.sessions.list({
      created: { gte: created },
      limit: 100
    });

    for (const session of sessions.data) {
      try {
        if (session.payment_status === 'paid' && session.customer) {
          // Skip if this session's payment_intent was already processed
          const sessionPaymentIntentId = session.payment_intent as string;
          if (sessionPaymentIntentId && processedPaymentIntents.has(sessionPaymentIntentId)) {
            continue; // Already processed this payment via payment intent
          }

          // Use payment_intent as ID if available, otherwise use session ID
          const paymentId = sessionPaymentIntentId || session.id;
          
          // Check if we already have this payment
          const existingKey = getStorageKey(user, 'payment', brand, paymentId);
          const existing = await kv.get(existingKey);
          
          if (existing) continue; // Skip if already synced

          const customer = await stripe.customers.retrieve(session.customer as string) as Stripe.Customer;
          
          if (customer.deleted) continue;

          const payment: PaymentRecord = {
            id: paymentId,
            brand,
            type: session.mode === 'subscription' ? 'subscription' : 'one_time',
            customer_email: customer.email || session.customer_details?.email || '',
            customer_name: customer.name || session.customer_details?.name || undefined,
            customer_id: customer.id,
            amount: session.amount_total || 0,
            currency: (session.currency || 'usd').toUpperCase(),
            status: 'succeeded',
            subscription_id: session.subscription as string || undefined,
            checkout_session_id: session.id,
            payment_intent_id: sessionPaymentIntentId || undefined,
            created_at: new Date(session.created * 1000).toISOString(),
            updated_at: new Date().toISOString()
          };

          await storePayment(user, payment);
          if (sessionPaymentIntentId) {
            processedPaymentIntents.add(sessionPaymentIntentId);
          }
          syncedCount++;
        }
      } catch (error) {
        console.error(`Error processing session ${session.id}:`, error);
        errors.push(`Session ${session.id}: ${error.message}`);
      }
    }

    return {
      success: true,
      synced: syncedCount,
      errors
    };

  } catch (error) {
    console.error(`Error syncing ${brand} payments:`, error);
    return {
      success: false,
      synced: 0,
      errors: [error.message]
    };
  }
}

// Calculate revenue metrics
export async function calculateRevenueMetrics(
  user: any,
  brand: string,
  supabase: any
): Promise<RevenueMetrics> {
  try {
    // Parallelise the two heaviest KV fan-outs so we don't stack 4+ sequential
    // 8 s timeouts.  getPaymentsByBrand itself now internally parallelises its
    // two getByPrefix calls, and we fetch subscriptions at the same time.
    const [payments, activeSubscriptions, allSubscriptionsForChurn] = await Promise.all([
      getPaymentsByBrand(user, brand),
      getActiveSubscriptions(user),
      getRecordsByPrefixes<SubscriptionRecord>(
        getRevenuePrefixes(user, 'subscription', brand),
        'calculateRevenueMetrics subscriptions'
      ),
    ]);

    const succeededPayments = payments.filter(p => p.status === 'succeeded');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Calculate time-based revenue
    const total_revenue = succeededPayments.reduce((sum, p) => sum + p.amount, 0) / 100;
    const daily_revenue = succeededPayments
      .filter(p => new Date(p.created_at) >= startOfToday)
      .reduce((sum, p) => sum + p.amount, 0) / 100;
    const weekly_revenue = succeededPayments
      .filter(p => new Date(p.created_at) >= startOfWeek)
      .reduce((sum, p) => sum + p.amount, 0) / 100;
    const monthly_revenue = succeededPayments
      .filter(p => new Date(p.created_at) >= startOfMonth)
      .reduce((sum, p) => sum + p.amount, 0) / 100;

    // Unique customers
    const uniqueCustomers = new Set(succeededPayments.map(p => p.customer_email));
    const total_customers = uniqueCustomers.size;

    // Subscription metrics
    const active_subscriptions = activeSubscriptions.length;

    // Calculate MRR from active subscriptions
    const mrr = activeSubscriptions.reduce((sum, sub) => sum + (sub.mrr || 0), 0) / 100;
    const arr = mrr * 12;

    // Calculate churn — reuse already-fetched prefix results
    const seenSubIds = new Set<string>();
    const allSubscriptions: any[] = [];
    for (const s of allSubscriptionsForChurn) {
      if (!seenSubIds.has(s.id)) { seenSubIds.add(s.id); allSubscriptions.push(s); }
    }
    const canceledThisMonth = allSubscriptions.filter(
      sub => sub.status === 'canceled' && new Date(sub.updated_at) >= startOfMonth
    ).length;
    const churn_rate = active_subscriptions > 0 ? (canceledThisMonth / (active_subscriptions + canceledThisMonth)) * 100 : 0;

    if (active_subscriptions > 0 && total_revenue < mrr) {
      console.warn(`⚠️  Revenue ($${total_revenue}) is less than expected MRR ($${mrr}). Run payment sync!`);
    }

    // Average deal size
    const avg_deal_size = total_customers > 0 ? total_revenue / total_customers : 0;

    // Conversion rate (leads → customers)
    let conversion_rate = 0;
    let revenue_per_lead = 0;

    try {
      const { count: totalLeads } = await supabase
        .from('leads')
        .select('id', { count: 'estimated', head: true });

      if (totalLeads && totalLeads > 0) {
        conversion_rate = (total_customers / totalLeads) * 100;
        revenue_per_lead = total_revenue / totalLeads;
      }
    } catch (error) {
      console.error('Error calculating conversion metrics:', error);
    }

    const metrics: RevenueMetrics = {
      brand,
      total_revenue,
      monthly_revenue,
      weekly_revenue,
      daily_revenue,
      mrr,
      arr,
      total_customers,
      active_subscriptions,
      churn_rate,
      avg_deal_size,
      conversion_rate,
      revenue_per_lead,
      updated_at: new Date().toISOString(),
    };

    // Cache the metrics
    const cacheKey = `${getStorageKey(user, 'revenue_metrics', brand)}:isolated-v2`;
    await kv.set(cacheKey, metrics);

    return metrics;
  } catch (error) {
    console.error('Error calculating revenue metrics:', error);
    throw error;
  }
}

// Get cached revenue metrics (with auto-refresh if stale)
export async function getRevenueMetrics(
  user: any,
  brand: string,
  supabase: any,
  forceRefresh = false
): Promise<RevenueMetrics> {
  const cacheKey = `${getStorageKey(user, 'revenue_metrics', brand)}:isolated-v2`;
  const lastSyncKey = `last_stripe_sync:${user.id}:${brand}`;

  if (!forceRefresh) {
    // Read cache key and last-sync key IN PARALLEL to avoid two sequential round-trips
    const [cached, lastSync] = await Promise.all([
      kv.get(cacheKey),
      kv.get(lastSyncKey),
    ]);

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
      // Cache is valid for 30s — return immediately without further KV work
      if (cacheAge < 30 * 1000) {
        return cached;
      }
    }

    // Auto-sync recent payments to ensure fresh data (fire-and-forget style)
    try {
      const now = Date.now();
      // Sync if never synced or > 1 hour ago
      if (!lastSync || (now - new Date(lastSync).getTime() > 60 * 60 * 1000)) {
        console.log(`[REVENUE] Auto-syncing payments for ${brand} (last sync: ${lastSync || 'never'})...`);
        syncHistoricalPayments(user, brand, 1)
          .then(() => kv.set(lastSyncKey, new Date().toISOString()))
          .catch((e) => console.warn("Background auto-sync failed during metric refresh:", e));
      }
    } catch (e) {
      console.warn("Auto-sync failed during metric refresh:", e);
    }
  } else {
    // forceRefresh=true — still run the auto-sync check in parallel with nothing else
    try {
      const lastSync = await kv.get(lastSyncKey);
      const now = Date.now();
      if (!lastSync || (now - new Date(lastSync).getTime() > 60 * 60 * 1000)) {
        console.log(`[REVENUE] Auto-syncing payments for ${brand} (force, last sync: ${lastSync || 'never'})...`);
        await syncHistoricalPayments(user, brand, 1);
        await kv.set(lastSyncKey, new Date().toISOString());
      }
    } catch (e) {
      console.warn("Auto-sync failed during forced metric refresh:", e);
    }
  }

  return await calculateRevenueMetrics(user, brand, supabase);
}

// Get conversion funnel data (Cached)
export async function getConversionFunnel(
  user: any,
  brand: string,
  supabase: any,
  forceRefresh = false
): Promise<{
  leads: number;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  customers: number;
  revenue: number;
  conversionRate: number;
}> {
  // Check cache first
  const cacheKey = `conversion_funnel:${user.id}:${brand}`;
  
  if (!forceRefresh) {
      // Add timeout for cache read
      const cacheTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Cache read timeout')), 3000)
      );
      
      const cached = await Promise.race([
        kv.get(cacheKey),
        cacheTimeout
      ]).catch(() => null);
      
      if (cached) {
          // Cache validity: 5 minutes for funnel
          const cacheAge = Date.now() - new Date(cached.updated_at || 0).getTime();
          if (cacheAge < 5 * 60 * 1000) {
              return cached.data;
          }
      }
  }

  try {
    // Get total leads - scoped to user
    let leadsQuery = supabase.from('leads').select('id', { count: 'estimated', head: true }).eq('user_id', user.id);
    if (brand !== 'all') {
      leadsQuery = leadsQuery.eq('brand', brand);
    }
    const { count: leads } = await leadsQuery;

    // Get campaign IDs for brand filtering AND user scoping
    let campaignsQuery = supabase.from('campaigns').select('id').eq('user_id', user.id);
    
    if (brand !== 'all') {
      campaignsQuery = campaignsQuery.like('product', `${brand}%`);
    }
    
    const { data: campaigns } = await campaignsQuery;
    const campaignIds = campaigns?.map(c => c.id) || [];

    // Get email metrics
    let emailsSent = 0;
    let emailsOpened = 0;
    let emailsClicked = 0;

    // Always scope by user_id
    if (campaignIds.length > 0 || brand === 'all') {
      const buildEmailCountQuery = (column?: string) => {
        let query = supabase.from('emails').select('id', { count: 'estimated', head: true });
        
        query = query.eq('user_id', user.id);

        if (brand !== 'all') {
           if (campaignIds.length > 0) {
               query = query.in('campaign_id', campaignIds);
           } else {
               query = query.eq('id', '00000000-0000-0000-0000-000000000000');
           }
        }
        
        if (column) {
          query = query.not(column, 'is', null);
        }
        return query;
      };

      const [sentRes, openedRes, clickedRes] = await Promise.all([
        buildEmailCountQuery(), // All emails = sent
        buildEmailCountQuery('opened_at'), // Emails with opened_at
        buildEmailCountQuery('clicked_at'), // Emails with clicked_at
      ]);

      emailsSent = sentRes.count || 0;
      emailsOpened = openedRes.count || 0;
      emailsClicked = clickedRes.count || 0;
    }

    // Get customer count and revenue with timeout
    const paymentsTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Payment query timeout')), 5000)
    );
    
    const payments = await Promise.race([
      getPaymentsByBrand(user, brand),
      paymentsTimeout
    ]).catch(() => []);
    
    const succeededPayments = payments.filter(p => p.status === 'succeeded');
    const customers = new Set(succeededPayments.map(p => p.customer_email)).size;
    const revenue = succeededPayments.reduce((sum, p) => sum + p.amount, 0); 

    const conversionRate = leads > 0 ? (customers / leads) * 100 : 0;

    const result = {
      leads: leads || 0,
      emailsSent,
      emailsOpened,
      emailsClicked,
      customers,
      revenue, 
      conversionRate,
      updated_at: new Date().toISOString()
    };
    
    // Cache the result (best effort, don't block on cache write)
    kv.set(cacheKey, { data: result, updated_at: new Date().toISOString() }).catch(e => 
      console.warn('[FUNNEL] Cache write failed (non-fatal):', e)
    );
    
    return result;
  } catch (error) {
    console.error('Error calculating conversion funnel:', error);
    return {
      leads: 0,
      emailsSent: 0,
      emailsOpened: 0,
      emailsClicked: 0,
      customers: 0,
      revenue: 0,
      conversionRate: 0,
    };
  }
}

// Update lead status when they become a customer
export async function markLeadAsCustomer(
  leadId: string,
  paymentId: string,
  supabase: any
): Promise<void> {
  try {
    const { error } = await supabase
      .from('leads')
      .update({
        status: 'customer',
        converted_at: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (error) {
      console.error('Error marking lead as customer:', error);
    } else {
      console.log(`✓ Marked lead ${leadId} as customer (payment: ${paymentId})`);
    }
  } catch (error) {
    console.error('Error updating lead status:', error);
  }
}

// Deduplicate existing payments in KV store
export async function deduplicatePayments(
  user: any,
  brand: string = 'default'
): Promise<{ success: boolean; duplicatesRemoved: number; errors: string[] }> {
  try {
    console.log(`🧹 Deduplicating ${brand} payments for user ${user.id}...`);
    
    const errors: string[] = [];
    let duplicatesRemoved = 0;
    
    // Get all payments for the brand (this merges 'default' + 'contndr' prefixes when brand='default')
    const payments = await getPaymentsByBrand(user, brand);
    
    if (payments.length === 0) {
      return { success: true, duplicatesRemoved: 0, errors: [] };
    }
    
    console.log(`Found ${payments.length} total payments to check`);
    
    // DIAGNOSTIC: Log every payment so we can see what we're working with
    for (const p of payments) {
      console.log(`  📄 Payment id=${p.id} brand=${p.brand} pi=${p.payment_intent_id || 'none'} cs=${p.checkout_session_id || 'none'} email=${p.customer_email} amount=${p.amount} created=${p.created_at}`);
    }
    
    // Helper: construct the CORRECT KV key for a payment record using its actual brand
    const actualKey = (payment: PaymentRecord) => {
      const recordBrand = payment.brand || brand;
      return getStorageKey(user, 'payment', recordBrand, payment.id);
    };
    
    // Track which IDs have been deleted so we don't double-count
    const deletedIds = new Set<string>();
    
    // First pass: Group by payment_intent_id (exact duplicates)
    const paymentIntentMap = new Map<string, PaymentRecord[]>();
    for (const payment of payments) {
      if (payment.payment_intent_id) {
        if (!paymentIntentMap.has(payment.payment_intent_id)) {
          paymentIntentMap.set(payment.payment_intent_id, []);
        }
        paymentIntentMap.get(payment.payment_intent_id)!.push(payment);
      }
    }
    
    console.log(`  [Pass 1] Found ${paymentIntentMap.size} unique payment_intent groups`);
    
    // Remove duplicates with same payment_intent_id
    for (const [paymentIntentId, duplicates] of paymentIntentMap.entries()) {
      if (duplicates.length > 1) {
        // Keep the one where id === payment_intent_id, or the first one with pi_ prefix
        const preferred = duplicates.find(p => p.id === paymentIntentId) || 
                         duplicates.find(p => p.id.startsWith('pi_')) ||
                         duplicates[0];
        const toRemove = duplicates.filter(p => p.id !== preferred.id);
        
        console.log(`  🔍 [Pass 1] Found ${toRemove.length} duplicate(s) for pi=${paymentIntentId} (keep: ${preferred.id}, brand=${preferred.brand})`);
        
        for (const dup of toRemove) {
          try {
            const dupKey = actualKey(dup);
            console.log(`    ❌ Deleting duplicate: id=${dup.id} brand=${dup.brand} key=${dupKey}`);
            await kv.del(dupKey);
            deletedIds.add(dup.id);
            duplicatesRemoved++;
          } catch (error) {
            errors.push(`Failed to delete ${dup.id}: ${error.message}`);
          }
        }
      }
    }
    
    // Second pass: Group by customer + amount, then find pairs within 24 hours
    // This catches duplicates from checkout sessions vs payment intents that might have different timestamps
    const broadMap = new Map<string, PaymentRecord[]>();
    for (const payment of payments) {
      if (deletedIds.has(payment.id)) continue;
      const broadKey = `${payment.customer_email}|${payment.amount}`;
      if (!broadMap.has(broadKey)) {
        broadMap.set(broadKey, []);
      }
      broadMap.get(broadKey)!.push(payment);
    }
    
    for (const [broadKey, group] of broadMap.entries()) {
      if (group.length > 1) {
        // Sort group by created_at ascending
        group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        // Compare every pair to find duplicates within 24 hours
        for (let i = 0; i < group.length; i++) {
          let keep = group[i];
          if (deletedIds.has(keep.id)) continue;
          
          for (let j = i + 1; j < group.length; j++) {
            let potentialDup = group[j];
            if (deletedIds.has(potentialDup.id)) continue;
            
            const timeDiff = Math.abs(new Date(keep.created_at).getTime() - new Date(potentialDup.created_at).getTime());
            
            const exactPiMatch = keep.payment_intent_id && keep.payment_intent_id === potentialDup.payment_intent_id;
            const isMixedTypeMatch = (keep.id.startsWith('cs_') && potentialDup.id.startsWith('pi_')) || 
                                     (keep.id.startsWith('pi_') && potentialDup.id.startsWith('cs_'));
            
            // If they share a payment_intent_id, or if one is cs_ and one is pi_ within 24 hours
            const isDuplicate = exactPiMatch || (isMixedTypeMatch && timeDiff < 86400000);
            
            if (isDuplicate) {
              let toKeep = keep;
              let toRemove = potentialDup;
              
              // Prefer pi_ prefixed IDs over cs_
              // Also prefer items that have a payment_intent_id
              const potentialDupScore = (potentialDup.id.startsWith('pi_') ? 2 : 0) + (potentialDup.payment_intent_id ? 1 : 0);
              const keepScore = (keep.id.startsWith('pi_') ? 2 : 0) + (keep.payment_intent_id ? 1 : 0);
              
              if (potentialDupScore > keepScore) {
                toKeep = potentialDup;
                toRemove = keep;
                // Update 'keep' for subsequent inner loop comparisons
                keep = potentialDup;
                group[i] = potentialDup; 
              }
              
              console.log(`  🔍 [Pass 2] Found duplicate for ${broadKey} — keep: ${toKeep.id}, remove: ${toRemove.id} (diff: ${Math.round(timeDiff/60000)}m)`);
              
              try {
                const dupKey = actualKey(toRemove);
                const exists = await kv.get(dupKey);
                if (exists) {
                  await kv.del(dupKey);
                  deletedIds.add(toRemove.id);
                  duplicatesRemoved++;
                  console.log(`    ❌ Deleted duplicate: id=${toRemove.id}`);
                } else {
                  console.log(`    ⚠️ Duplicate already missing from KV: id=${toRemove.id}`);
                }
              } catch (error) {
                errors.push(`Failed to delete ${toRemove.id}: ${error.message}`);
              }
            }
          }
        }
        
        // Log remaining potential duplicates that were NOT deleted (more than 24h apart)
        const remaining = group.filter(p => !deletedIds.has(p.id));
        if (remaining.length > 1) {
          console.log(`  ⚠️ [Manual Review] ${remaining.length} payments for ${broadKey} survived dedup (time diff > 24h):`);
          for (const p of remaining) {
            console.log(`      id=${p.id} brand=${p.brand} pi=${p.payment_intent_id || 'none'} created=${p.created_at}`);
          }
        }
      }
    }
    
    console.log(`✓ Deduplication complete. Removed ${duplicatesRemoved} duplicates from ${payments.length} total payments.`);
    
    return {
      success: true,
      duplicatesRemoved,
      errors
    };
  } catch (error) {
    console.error('Error deduplicating payments:', error);
    return {
      success: false,
      duplicatesRemoved: 0,
      errors: [error.message]
    };
  }
}
