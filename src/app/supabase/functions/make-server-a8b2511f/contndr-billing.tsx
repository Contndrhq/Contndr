// kv_store.tsx import is aliased to kv-retry.tsx to prevent intermittent "Module not found" errors
// when the npm package takes too long to resolve.
import * as kv from './kv-retry.tsx';
import { recordDealFromStripeEvent, recordRecurringPayment, markDealsAsCanceled } from './sales-leaderboard.tsx';
import { getMarketFromCountry, getResolvedMarket, type Market } from './regional-pricing.ts';
import { getStripePriceId, validateStripePriceId, detectCountryFromRequest, STRIPE_PRICES } from './regional-pricing-config.tsx';

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') || Deno.env.get('STRIPE_SECRET_KEY_ROADR') || Deno.env.get('STRIPE_SECRET_KEY_SOURCR');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || Deno.env.get('STRIPE_WEBHOOK_SECRET_ROADR') || Deno.env.get('STRIPE_WEBHOOK_SECRET_SOURCR');

// KV-based mutex for affiliate referral list mutations. Two concurrent webhook
// events for the same affiliate would otherwise both read the same array and
// clobber each other's modifications when writing back, losing conversions.
const AFFILIATE_LOCK_TTL_MS = 5_000;
async function withAffiliateLock<T>(affiliateUserId: string, fn: () => Promise<T>): Promise<T> {
  const key = `affiliate_lock:${affiliateUserId}`;
  const start = Date.now();
  let acquired = false;
  while (Date.now() - start < 3_000) {
    try {
      const existing: number | null = await kv.get(key);
      if (!existing || Date.now() - existing > AFFILIATE_LOCK_TTL_MS) {
        await kv.set(key, Date.now());
        acquired = true;
        break;
      }
    } catch {
      break; // KV degraded — proceed without lock
    }
    await new Promise(r => setTimeout(r, 50));
  }
  try {
    return await fn();
  } finally {
    if (acquired) { try { await kv.del(key); } catch {} }
  }
}

// Price IDs from Environment Variables
export const PLANS = {
  growth: {
    monthly: Deno.env.get('STRIPE_PRICE_GROWTH') || 'price_1Q...',
    yearly: Deno.env.get('STRIPE_PRICE_GROWTH_YEARLY') || 'price_1Q...',
    name: 'Growth',
    amount: 49900
  },
  scale: {
    monthly: Deno.env.get('STRIPE_PRICE_SCALE') || 'price_1Q...',
    yearly: Deno.env.get('STRIPE_PRICE_SCALE_YEARLY') || 'price_1Q...',
    name: 'Scale',
    amount: 99900
  },
  enterprise: {
    monthly: Deno.env.get('STRIPE_PRICE_ENTERPRISE') || 'price_1Q...',
    yearly: Deno.env.get('STRIPE_PRICE_ENTERPRISE_YEARLY') || 'price_1Q...',
    name: 'Enterprise',
    amount: 250000
  },
  // Legacy aliases kept so existing Stripe subscriptions can still be detected.
  starter: {
    monthly: Deno.env.get('STRIPE_PRICE_STARTER') || 'price_1Q...',
    yearly: Deno.env.get('STRIPE_PRICE_STARTER_YEARLY') || 'price_1Q...',
    name: 'Starter',
    amount: 9900
  },
  professional: {
    monthly: Deno.env.get('STRIPE_PRICE_PROFESSIONAL') || 'price_1Q...', 
    yearly: Deno.env.get('STRIPE_PRICE_PROFESSIONAL_YEARLY') || 'price_1Q...',
    name: 'Professional',
    amount: 19900
  }
};

// ════════════════════════════════════════════════════════════════════════════
// REGIONAL PRICING HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get user's preferred or detected market for pricing
 */
export async function getUserMarket(userId: string, req?: Request): Promise<Market> {
  // STRICT MODE: Always prioritize IP-based detection over saved preference
  if (req) {
    const detectedCountry = detectCountryFromRequest(req);
    if (detectedCountry) {
      const market = getMarketFromCountry(detectedCountry);
      console.log(`[REGIONAL PRICING] Strict Mode: Detected market from IP ${detectedCountry}: ${market}`);
      
      // Auto-save this as their new baseline to override any past manipulation
      try {
        await kv.set(`user:${userId}:market_preference`, market);
      } catch (e) {
        // ignore
      }
      
      return market;
    }
  }

  // Fallback to KV if no request is available
  try {
    const savedMarket = await kv.get(`user:${userId}:market_preference`);
    if (savedMarket && ['US', 'BR', 'EU', 'GB', 'CA'].includes(savedMarket as string)) {
      console.log(`[REGIONAL PRICING] Using saved market preference as fallback for ${userId}: ${savedMarket}`);
      return savedMarket as Market;
    }
  } catch (err) {
    console.warn('[REGIONAL PRICING] Failed to read market preference from KV:', err);
  }
  
  // Default to US
  console.log('[REGIONAL PRICING] Defaulting to US market');
  return 'US';
}

/**
 * Save user's market preference
 */
export async function saveUserMarket(userId: string, market: Market): Promise<void> {
  try {
    await kv.set(`user:${userId}:market_preference`, market);
    console.log(`[REGIONAL PRICING] Saved market preference for ${userId}: ${market}`);
  } catch (err) {
    console.error('[REGIONAL PRICING] Failed to save market preference:', err);
  }
}

// Lazy-loaded Stripe instance (avoids top-level import crash on cold-start)
let _stripeInstance: any = null;

export async function getStripe(): Promise<any> {
  if (!_stripeInstance && STRIPE_KEY) {
    try {
      const { default: Stripe } = await import('npm:stripe@17');
      _stripeInstance = new Stripe(STRIPE_KEY, { apiVersion: '2024-11-20.acacia' });
    } catch (err) {
      console.error('[BILLING] Failed to load Stripe:', err);
      return null;
    }
  }
  return _stripeInstance;
}

// Backward-compat: synchronous export (will be null until getStripe() is called)
export const stripe = null as any;

export async function isUserWhitelisted(email: string) {
  if (!email) return false;
  const whitelist = (Deno.env.get('CONTNDR_WHITELIST') || Deno.env.get('SENDLR_WHITELIST') || '').split(',').map(e => e.trim().toLowerCase());
  return whitelist.includes(email.toLowerCase()) || email.endsWith('@contndr.com') || email === 'admin@contndr.com';
}

export async function getUserSubscriptionStatus(user: any) {
  if (!user) {
    console.log('[BILLING] getUserSubscriptionStatus: No user provided - returning inactive');
    return { status: 'inactive', plan: 'none', isWhitelisted: false };
  }

  const userEmail = user.email?.toLowerCase().trim();
  console.log('[BILLING] ========== SUBSCRIPTION STATUS CHECK ==========');
  console.log('[BILLING] User Email:', userEmail);
  console.log('[BILLING] User ID:', user.id);

  // 1. Check KV first. Explicit admin/Stripe plan assignments must win over
  // internal-email fallbacks, otherwise Enterprise users can appear as Growth.
  let sub;
  try {
    sub = await kv.get(`contndr_sub:${user.id}`);
    if (!sub) {
      sub = await kv.get(`sendlr_sub:${user.id}`);
      if (sub) {
        try {
          await kv.set(`contndr_sub:${user.id}`, sub);
          console.log('[BILLING] Migrated legacy sendlr_sub key to contndr_sub for user:', user.id);
        } catch (setErr) {
          console.log('[BILLING] Failed to migrate legacy sendlr_sub key:', setErr?.message || setErr);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[BILLING] Failed to read subscription from KV for user ${user.id}:`, err?.message || err);
  }

  if (sub && sub.status === 'active' && sub.plan && sub.plan !== 'none' && sub.plan !== 'waitlist') {
    console.log('[BILLING] Found ACTIVE subscription in KV store:', JSON.stringify(sub));
    const normalizedSub = {
      status: sub.status,
      plan: sub.plan,
      isWhitelisted: sub.isWhitelisted || false,
      stripe_sub_id: sub.stripe_sub_id,
      cancel_at_period_end: sub.cancel_at_period_end || false,
      current_period_end: sub.current_period_end || null,
      updated_at: sub.updated_at
    };
    console.log('[BILLING] Returning active subscription:', JSON.stringify(normalizedSub));
    return normalizedSub;
  }

  if (sub && sub.updated_by && sub.plan && sub.plan !== 'none' && sub.plan !== 'waitlist') {
    console.log(`[BILLING] ✅ Admin override detected (set by ${sub.updated_by}): plan=${sub.plan}, healing status to active`);
    sub.status = 'active';
    try {
      await kv.set(`contndr_sub:${user.id}`, sub);
    } catch (e) {}
    return {
      status: 'active',
      plan: sub.plan,
      isWhitelisted: false,
      stripe_sub_id: sub.stripe_sub_id,
      updated_at: sub.updated_at,
      adminOverride: true,
    };
  }

  // 2. Internal/admin fallback. This is only a fallback after explicit billing data.
  if (userEmail === 'or@roadr.com' || userEmail === 'admin@contndr.com' || userEmail === 'demo@contndr.com' || userEmail === 'axel@redaxemedia.com' || userEmail === 'or@contndr.com' || userEmail?.endsWith('@contndr.com')) {
    console.log('[BILLING] Admin/VIP email detected, granting full access');
    return { status: 'active', plan: 'enterprise', isWhitelisted: true };
  }

  // 3. Check Whitelist first (legacy users)
  if (await isUserWhitelisted(user.email)) {
    console.log('[BILLING] User is whitelisted, granting access');
    return { status: 'active', plan: 'enterprise', isWhitelisted: true };
  }

  // 4. If KV failed earlier, aggressively check Stripe directly instead of defaulting to waitlist.
  if (!sub) {
    try {
      console.log('[BILLING] No usable KV subscription, checking Stripe sync fallback...');
      const healed = await syncStripeSubscription(user.id, userEmail);
      if (healed.synced && healed.subscription && ['active', 'trialing'].includes(healed.subscription.status)) {
        return {
          status: healed.subscription.status,
          plan: healed.subscription.plan,
          isWhitelisted: false,
          stripe_sub_id: healed.subscription.stripe_sub_id,
          updated_at: healed.subscription.updated_at
        };
      }
    } catch (stripeErr: any) {
      console.warn('[BILLING] Stripe sync fallback failed:', stripeErr?.message || stripeErr);
    }
  }

  if (sub) {
    console.log('[BILLING] Found subscription but not active, status:', sub.status, 'plan:', sub.plan);
  } else {
    console.log('[BILLING] No subscription record found in KV store for user:', user.id);
  }

  // 3b. TEAM MEMBERSHIP: If user is a team member, inherit the team owner's subscription
  // *** Moved BEFORE Stripe auto-heal so team members get instant access without Stripe API calls ***
  try {
    let teamId = await kv.get(`user:${user.id}:team`);
    
    // FALLBACK: If no direct team link exists, scan team member lists to find this user.
    // This handles cases where the `user:{id}:team` KV key was never set or got cleared.
    if (!teamId) {
      console.log('[BILLING] No direct team link found, checking team member lists as fallback...');
      try {
        const teamKeys = await kv.getByPrefix('team:');
        // teamKeys returns values — we need to check each team's members list
        // getByPrefix returns array of values for keys matching the prefix
        // We look for `team:*:members` entries that contain this user
        for (const members of teamKeys) {
          if (Array.isArray(members)) {
            const match = members.find((m: any) => m.id === user.id);
            if (match && match.role !== 'owner') {
              // Found! The team owner ID is the member with role 'owner'
              const owner = members.find((m: any) => m.role === 'owner');
              if (owner && owner.id && owner.id !== user.id) {
                teamId = owner.id;
                // Heal the missing link for future checks
                console.log(`[BILLING] ✅ HEALED team link: user:${user.id}:team → ${teamId}`);
                await kv.set(`user:${user.id}:team`, teamId);
                break;
              }
            }
          }
        }
      } catch (scanErr) {
        console.log('[BILLING] Team member list scan error (non-fatal):', scanErr?.message || scanErr);
      }
    }
    
    if (teamId && teamId !== user.id) {
      console.log('[BILLING] User is a team member. Team owner:', teamId);
      const ownerSub = await kv.get(`contndr_sub:${teamId}`);
      if (ownerSub && ownerSub.status === 'active') {
        console.log('[BILLING] ✅ Inheriting team owner subscription:', JSON.stringify(ownerSub));
        console.log('[BILLING] =================================================');
        return {
          status: 'active',
          plan: ownerSub.plan || 'starter',
          isWhitelisted: false,
          isTeamMember: true,
          teamOwnerId: teamId,
          stripe_sub_id: ownerSub.stripe_sub_id
        };
      }
      
      // ── CHECK IF OWNER IS VIP/ADMIN/WHITELISTED ──
      // VIP/admin owners bypass KV entirely (step 1 returns early for them).
      // Their contndr_sub KV may be missing or stale, so we must check their
      // email directly against the VIP list and whitelist.
      try {
        const teamMembers = await kv.get(`team:${teamId}:members`);
        const ownerRecord = Array.isArray(teamMembers)
          ? teamMembers.find((m: any) => m.role === 'owner')
          : null;
        const ownerEmail = ownerRecord?.email?.toLowerCase().trim();
        
        if (ownerEmail) {
          const VIP_EMAILS = ['or@roadr.com', 'admin@contndr.com', 'demo@contndr.com', 'axel@redaxemedia.com', 'or@contndr.com'];
          const isOwnerVip = VIP_EMAILS.includes(ownerEmail) || await isUserWhitelisted(ownerEmail);
          
          if (isOwnerVip) {
            console.log(`[BILLING] ✅ Team owner ${ownerEmail} is VIP/whitelisted — granting team member access`);
            console.log('[BILLING] =================================================');
            // Also heal the owner's KV so this shortcut isn't needed next time
            await kv.set(`contndr_sub:${teamId}`, {
              ...(ownerSub || {}),
              plan: 'enterprise',
              status: 'active',
              isWhitelisted: true,
              updated_at: new Date().toISOString(),
            });
            return {
              status: 'active',
              plan: 'enterprise',
              isWhitelisted: false,
              isTeamMember: true,
              teamOwnerId: teamId,
            };
          }
        }
      } catch (vipErr) {
        console.log('[BILLING] VIP owner check error (non-fatal):', vipErr?.message || vipErr);
      }

      // Owner exists but sub not active — try auto-healing the owner's sub from Stripe
      try {
        // Try to get owner email from team members list for better Stripe lookup
        let ownerEmail = null;
        try {
          const teamMembers = await kv.get(`team:${teamId}:members`);
          const ownerRecord = Array.isArray(teamMembers)
            ? teamMembers.find((m: any) => m.role === 'owner')
            : null;
          ownerEmail = ownerRecord?.email || null;
        } catch (_) { /* non-fatal */ }
        
        const ownerHeal = await syncStripeSubscription(teamId, ownerEmail);
        if (ownerHeal.synced && ownerHeal.subscription?.status === 'active') {
          console.log('[BILLING] ✅ Auto-healed team owner sub from Stripe:', JSON.stringify(ownerHeal.subscription));
          console.log('[BILLING] =================================================');
          return {
            status: 'active',
            plan: ownerHeal.subscription.plan || 'starter',
            isWhitelisted: false,
            isTeamMember: true,
            teamOwnerId: teamId,
            stripe_sub_id: ownerHeal.subscription.stripe_sub_id
          };
        }
      } catch (ownerHealErr) {
        console.log('[BILLING] Team owner auto-heal skipped:', ownerHealErr?.message || ownerHealErr);
      }
      console.log('[BILLING] Team owner has no active subscription');
    }
  } catch (teamErr) {
    console.log('[BILLING] Team membership check error:', teamErr?.message || teamErr);
  }

  // 3c. AUTO-HEAL: KV missed the webhook — check Stripe directly as fallback
  // *** Moved AFTER team check so team members don't depend on Stripe API calls ***
  try {
    const healed = await syncStripeSubscription(user.id, userEmail);
    if (healed.synced && healed.subscription) {
      console.log('[BILLING] ✅ Auto-healed from Stripe:', JSON.stringify(healed.subscription));
      
      // GUARD: If we have a local 'pending' status (Waitlist), only let 'active'/'trialing' Stripe status override it.
      // This prevents old 'canceled' Stripe subscriptions from bypassing the waitlist screen.
      const isStripeActive = ['active', 'trialing'].includes(healed.subscription.status);
      const hasLocalPending = sub && sub.status === 'pending';

      if (isStripeActive || !hasLocalPending) {
        return {
            status: healed.subscription.status,
            plan: healed.subscription.plan,
            isWhitelisted: false,
            stripe_sub_id: healed.subscription.stripe_sub_id,
            updated_at: healed.subscription.updated_at
        };
      } else {
        console.log('[BILLING] Ignoring auto-healed status (canceled/inactive) because local status is pending (Waitlist)');
      }
    }
  } catch (healErr) {
    // Non-fatal — Stripe may not be configured or customer doesn't exist
    console.log('[BILLING] Auto-heal skipped:', healErr?.message || healErr);
  }

  // 4. Check if user is on waitlist - this determines if they see waitlist or paywall
  let waitlistId: string | null = null;
  try {
    waitlistId = await kv.get(`waitlist:email:${userEmail}`);
    if (waitlistId) {
      const entry = await kv.get(`waitlist:${waitlistId}`);
      console.log('[BILLING] Waitlist entry found:', JSON.stringify(entry));
      
      if (entry) {
        // User is approved - show paywall on login
        if (entry.status === 'approved' || entry.status === 'invited' || entry.status === 'signed_up') {
          console.log('[BILLING] User approved from waitlist - showing paywall');
          console.log('[BILLING] =================================================');
          return { status: 'unpaid', plan: 'none', isWhitelisted: false };
        }
        
        // User is on waitlist but not approved yet (includes pending_signup)
        console.log('[BILLING] User on waitlist but not approved yet. Status:', entry.status);
        console.log('[BILLING] =================================================');
        return { status: 'pending', plan: 'waitlist', isWhitelisted: false };
      }
    }
  } catch (waitlistErr: any) {
    console.warn(`[BILLING] Failed to read waitlist status from KV for user ${user.id}:`, waitlistErr?.message || waitlistErr);
  }
  
  // 5. CRITICAL: Default for users without any record: auto-register as waitlist
  // This handles OAuth signups (Google/GitHub) that bypass the signup-v2 endpoint
  console.log('[BILLING] No subscription or approval found, auto-registering as waitlist');
  
  // Auto-create subscription record so admin can see them
  if (!sub) {
    try {
      const userName = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.user_name || 'OAuth User';
      const provider = user.app_metadata?.provider || 'unknown';
      
      await kv.set(`contndr_sub:${user.id}`, {
        status: 'pending',
        plan: 'waitlist',
        created_at: new Date().toISOString(),
        signup_method: provider,
      });
      
      // Also create a waitlist entry if one doesn't exist
      if (!waitlistId) {
        const newWaitlistId = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await kv.set(`waitlist:${newWaitlistId}`, {
          id: newWaitlistId,
          email: userEmail,
          name: userName,
          status: 'pending',
          created_at: new Date().toISOString(),
          source: `oauth_${provider}`,
          userId: user.id,
        });
        await kv.set(`waitlist:email:${userEmail}`, newWaitlistId);
        console.log(`[BILLING] Auto-created waitlist entry for OAuth user: ${userEmail} (${provider})`);
      }
    } catch (autoRegErr) {
      console.log('[BILLING] Auto-registration error (non-fatal):', autoRegErr?.message || autoRegErr);
    }
  }
  
  console.log('[BILLING] =================================================');
  return { status: 'pending', plan: 'waitlist', isWhitelisted: false };
}

export async function createCheckoutSession(
  user: any, 
  planType: 'growth' | 'scale' | 'enterprise',
  interval: 'monthly' | 'yearly', 
  successUrl?: string, 
  cancelUrl?: string,
  returnUrl?: string,
  embedded: boolean = false,
  req?: Request,  // Add req parameter for country detection
  preferredMarket?: Market  // Add optional market override
) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe not configured");
  
  // ══════════════════════════════════════════════════════════════════════════
  // ANTI-FRAUD: VALIDATE MARKET SELECTION AGAINST ACTUAL LOCATION
  // ══════════════════════════════════════════════════════════════════════════
  
  let validatedMarket: Market;
  
  if (req) {
    // Detect actual country from IP/geo headers
    const detectedCountry = detectCountryFromRequest(req);
    const actualMarket = detectedCountry ? getMarketFromCountry(detectedCountry) : 'US';
    
    console.log(`[BILLING] Country detection: ${detectedCountry || 'unknown'} -> market ${actualMarket}`);
    
    // OPTION A - STRICT MODE: Ignore user-selected market completely. Force pricing based on IP detection.
    validatedMarket = actualMarket;
    console.log(`[BILLING] Strict mode enforced. Locking checkout to detected market: ${validatedMarket}`);
  } else {
    // Fallback if no request object
    validatedMarket = preferredMarket || 'US';
    console.warn(`[BILLING] No request object for geo detection, using fallback: ${validatedMarket}`);
  }
  
  // Save the validated market as user's preference
  await saveUserMarket(user.id, validatedMarket);
  
  // ── REGIONAL PRICING: Get correct Stripe price ID ──
  const priceId = getStripePriceId(planType, validatedMarket, interval);
  
  // Fallback to legacy PLANS if regional price not available
  const fallbackPriceId = !priceId ? PLANS[planType]?.[interval] : null;
  const finalPriceId = priceId || fallbackPriceId;
  
  console.log(`[BILLING] Creating checkout session for user ${user.id} (${user.email})`);
  console.log(`[BILLING] Plan: ${planType}, Interval: ${interval}, Validated Market: ${validatedMarket}`);
  console.log(`[BILLING] Price ID: ${finalPriceId}`);
  console.log(`[BILLING] Using Stripe Key: ${STRIPE_KEY ? STRIPE_KEY.substring(0, 8) + '...' : 'None'}`);
  console.log(`[BILLING] Mode: ${embedded ? 'Embedded' : 'Hosted'}`);

  if (!finalPriceId || finalPriceId.startsWith('price_1Q...')) {
      throw new Error(`Stripe Price ID not configured for ${planType} ${interval} ${validatedMarket}. Please set env vars.`);
  }

  if (!validateStripePriceId(finalPriceId)) {
    console.warn(`[BILLING] Invalid price ID format: ${finalPriceId}`);
  }

  // Create or get customer
  let customerId = await kv.get(`stripe_customer:${user.id}`);
  
  if (!customerId) {
    // Check if customer exists in Stripe by email to avoid duplicates
    const existingCustomers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
    } else {
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.user_metadata?.name,
            metadata: {
                supabase_user_id: user.id
            }
        });
        customerId = customer.id;
    }
    await kv.set(`stripe_customer:${user.id}`, customerId);
    // Store reverse mapping for webhooks
    await kv.set(`stripe_customer_reverse:${customerId}`, user.id);
  } else {
     // Ensure reverse mapping exists (healing)
     const existingReverse = await kv.get(`stripe_customer_reverse:${customerId}`);
     if (!existingReverse) {
        await kv.set(`stripe_customer_reverse:${customerId}`, user.id);
     }
  }

  // ── GUARD: Prevent double subscriptions ──
  // Check if this customer already has an active/trialing subscription in Stripe.
  // If so, block creation of a second one to prevent double charges.
  try {
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 5,
    });
    const existingTrialing = await stripe.subscriptions.list({
      customer: customerId,
      status: 'trialing',
      limit: 5,
    });
    const allActiveSubs = [...existingSubs.data, ...existingTrialing.data];

    if (allActiveSubs.length > 0) {
      console.warn(`[BILLING] ⚠️ DOUBLE-SUB GUARD: User ${user.id} already has ${allActiveSubs.length} active subscription(s): ${allActiveSubs.map((s: any) => s.id).join(', ')}`);

      // If they're trying to change plans, cancel old subs first
      const currentPriceIds = allActiveSubs.map((s: any) => s.items?.data?.[0]?.price?.id);
      const isSamePrice = currentPriceIds.includes(finalPriceId);

      if (isSamePrice) {
        // Exact same plan — this is a duplicate, block it
        throw new Error(`You already have an active subscription for this plan. If you need to manage your subscription, please contact support.`);
      }

      // Different plan — cancel all existing subs before creating new checkout
      console.log(`[BILLING] Plan change detected. Canceling ${allActiveSubs.length} existing sub(s) before creating new checkout.`);
      for (const existingSub of allActiveSubs) {
        await stripe.subscriptions.cancel(existingSub.id, { prorate: true });
        console.log(`[BILLING] Canceled existing subscription: ${existingSub.id}`);
      }
    }
  } catch (guardErr: any) {
    // Re-throw user-facing errors (like "already subscribed")
    if (guardErr.message?.includes('already have an active subscription')) {
      throw guardErr;
    }
    // Non-fatal for other errors — log and continue (better to allow checkout than block it)
    console.warn('[BILLING] Double-sub guard check failed (non-fatal):', guardErr?.message || guardErr);
  }

  const sessionConfig: any = {
    customer: customerId,
    line_items: [
      {
        price: finalPriceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    metadata: {
      userId: user.id,
      planType: planType,
      interval: interval,
      market: validatedMarket
    },
    subscription_data: {
      metadata: {
        userId: user.id,
        planType: planType,
        market: validatedMarket
      }
    },
    billing_address_collection: 'required',
    allow_promotion_codes: true,
  };

  if (embedded) {
      sessionConfig.ui_mode = 'embedded';
      sessionConfig.return_url = returnUrl;
  } else {
      sessionConfig.success_url = successUrl;
      sessionConfig.cancel_url = cancelUrl;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionConfig);

    return embedded ? session.client_secret : session.url;
  } catch (error) {
    // Check for "No such customer" error which happens when keys change or environments differ
    if (error.code === 'resource_missing' && error.param === 'customer') {
      console.warn(`[BILLING] Customer ${customerId} not found in Stripe (likely environment mismatch). Recreating...`);
      
      // 1. Clear the invalid ID from KV
      await kv.del(`stripe_customer:${user.id}`);
      
      // 2. Create a fresh customer
      let newCustomerId;
      const existingCustomers = await stripe.customers.list({ email: user.email, limit: 1 });
      
      if (existingCustomers.data.length > 0) {
          console.log(`[BILLING] Found existing valid customer for email ${user.email}`);
          newCustomerId = existingCustomers.data[0].id;
      } else {
          console.log(`[BILLING] Creating new customer for email ${user.email}`);
          const customer = await stripe.customers.create({
              email: user.email,
              name: user.user_metadata?.name,
              metadata: {
                  supabase_user_id: user.id
              }
          });
          newCustomerId = customer.id;
      }
      
      // 3. Save the valid ID
      await kv.set(`stripe_customer:${user.id}`, newCustomerId);
      
      // 4. Retry session creation
      sessionConfig.customer = newCustomerId;
      const session = await stripe.checkout.sessions.create(sessionConfig);
      return embedded ? session.client_secret : session.url;
    }
    
    // Re-throw other errors
    throw error;
  }
}

export async function handleStripeWebhook(req: Request) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe not configured");
  
  const signature = req.headers.get('stripe-signature');
  if (!signature || !STRIPE_WEBHOOK_SECRET) {
    throw new Error("Missing signature or webhook secret");
  }

  const body = await req.text();
  let event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  // Idempotency guard. Stripe retries webhooks aggressively (up to 3 days);
  // without this check, a single checkout.session.completed retry would
  // double-allocate AI credits, double-record the affiliate referral, and
  // re-log the deal in the sales leaderboard. Mark each event.id as seen
  // for 7 days (longer than Stripe's retry window).
  const eventDedupKey = `stripe_event:${event.id}`;
  try {
    const seen = await kv.get(eventDedupKey);
    if (seen) {
      console.log(`[BILLING WEBHOOK] Skipping duplicate event ${event.id} (${event.type}) — already processed at ${seen}`);
      return { received: true, duplicate: true };
    }
    await kv.set(eventDedupKey, new Date().toISOString());
  } catch (dedupErr) {
    // If KV is degraded, prefer to skip rather than risk double-processing.
    console.error(`[BILLING WEBHOOK] Idempotency check failed for ${event.id}, refusing to process:`, dedupErr);
    throw new Error('Idempotency check failed — refusing to process to avoid duplicate side effects');
  }

  console.log(`Processing Stripe event: ${event.type} (${event.id})`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const planType = session.metadata?.planType;
      
      console.log('[BILLING WEBHOOK] checkout.session.completed - userId:', userId, 'planType:', planType);
      
      // ── Credit pack top-up fulfillment ──
      if (session.metadata?.type === 'credit_topup' && session.metadata?.userId) {
        try {
          const topupUserId = session.metadata.userId;
          const packId = session.metadata.pack_id;
          const credits = parseInt(session.metadata.credits || '0');
          if (credits > 0) {
            const { addTopupCredits } = await import('./ai-credits.tsx');
            await addTopupCredits(topupUserId, credits, packId);
            console.log(`[BILLING WEBHOOK] ✅ Credit top-up fulfilled: ${credits} credits for ${topupUserId}`);
            // Clean up pending record
            await kv.del(`ai_credits_topup:${session.id}`);
          }
        } catch (topupErr) {
          console.error('[BILLING WEBHOOK] Credit top-up fulfillment error:', topupErr);
        }
        break; // Don't process as a subscription
      }

      if (userId && planType) {
        // ── ANTI-FRAUD: Validate Market vs Billing Address ──
        const checkoutCountry = session.customer_details?.address?.country;
        const metadataMarket = session.metadata?.market;
        
        if (checkoutCountry && metadataMarket) {
          const billingMarket = getMarketFromCountry(checkoutCountry);
          
          if (billingMarket !== metadataMarket) {
            console.error(`[BILLING FRAUD] 🚨 Address-to-Currency Mismatch detected for user ${userId}. Expected market: ${metadataMarket}, Actual checkout country: ${checkoutCountry} (${billingMarket}). Canceling fraudulent subscription: ${session.subscription}`);
            try {
              // Immediately cancel the subscription to prevent access
              await stripe.subscriptions.cancel(session.subscription, { prorate: true });
              
              // You might also want to refund, but cancelling the sub immediately 
              // effectively voids the service
              
              console.log(`[BILLING FRAUD] ✅ Successfully canceled fraudulent subscription ${session.subscription}`);
              
              // We do NOT provision the account or add to KV.
              break;
            } catch (fraudCancelErr: any) {
              console.error(`[BILLING FRAUD] Could not cancel fraudulent sub ${session.subscription}:`, fraudCancelErr?.message);
            }
          }
        }

        // ── GUARD: Detect & cancel duplicate subscriptions ──
        // If the user already has a different active sub, cancel the older one.
        const existingKvSub = await kv.get(`contndr_sub:${userId}`);
        if (
          existingKvSub &&
          existingKvSub.status === 'active' &&
          existingKvSub.stripe_sub_id &&
          existingKvSub.stripe_sub_id !== session.subscription
        ) {
          console.warn(`[BILLING WEBHOOK] ⚠️ DUPLICATE DETECTED: User ${userId} already has active sub ${existingKvSub.stripe_sub_id}, new sub is ${session.subscription}. Canceling the OLD one.`);
          try {
            await stripe.subscriptions.cancel(existingKvSub.stripe_sub_id, { prorate: true });
            console.log(`[BILLING WEBHOOK] ✅ Canceled orphaned subscription: ${existingKvSub.stripe_sub_id}`);
          } catch (cancelErr: any) {
            // May already be canceled or invalid — that's fine
            console.warn(`[BILLING WEBHOOK] Could not cancel old sub ${existingKvSub.stripe_sub_id}: ${cancelErr?.message}`);
          }
        }

        await kv.set(`contndr_sub:${userId}`, {
          plan: planType,
          status: 'active',
          stripe_sub_id: session.subscription,
          updated_at: new Date().toISOString()
        });
        console.log('[BILLING WEBHOOK] Successfully activated subscription for user:', userId);

        // ── AI Call Credits allocation ──
        try {
          const { allocateCredits } = await import('./ai-credits.tsx');
          await allocateCredits(userId, planType);
          console.log(`[BILLING WEBHOOK] AI credits allocated for ${userId} on ${planType} plan`);
        } catch (creditsErr) {
          console.error('[BILLING WEBHOOK] AI credits allocation error (non-fatal):', creditsErr);
        }

        // ── Affiliate conversion tracking ──
        // Locked because two concurrent webhook events for the same affiliate
        // would both read the same `referrals` array and clobber each other's
        // appended/modified entries on write-back, losing conversions.
        try {
          const affiliateUserId = await kv.get(`affiliate_ref:${userId}`);
          if (affiliateUserId) {
            console.log(`[AFFILIATE WEBHOOK] Converting referral for affiliate ${affiliateUserId}, subscriber ${userId}, plan ${planType}`);
            await withAffiliateLock(affiliateUserId, async () => {
              const referrals = (await kv.get(`affiliate:${affiliateUserId}:referrals`)) || [];
              const idx = referrals.findIndex((r: any) => r.referred_user_id === userId);
              if (idx !== -1) {
                referrals[idx].status = 'active';
                referrals[idx].plan = planType;
                referrals[idx].converted_at = new Date().toISOString();
                referrals[idx].stripe_sub_id = session.subscription;
              } else {
                referrals.push({
                  id: crypto.randomUUID(),
                  referred_user_id: userId,
                  referred_email: session.customer_email || 'unknown',
                  signed_up_at: new Date().toISOString(),
                  converted_at: new Date().toISOString(),
                  plan: planType,
                  stripe_sub_id: session.subscription,
                  status: 'active',
                });
              }
              await kv.set(`affiliate:${affiliateUserId}:referrals`, referrals);
            });
            console.log(`[AFFILIATE WEBHOOK] ✅ Referral converted successfully`);
          }
        } catch (affErr) {
          console.error('[AFFILIATE WEBHOOK] Error tracking conversion:', affErr);
        }

        // ── Log admin event for new subscription ──
        try {
          const { logAdminEvent } = await import("./admin-events.tsx");
          const custEmail = session.customer_email || session.customer_details?.email || 'unknown';
          const custName = session.customer_details?.name || custEmail;
          logAdminEvent('subscription_created', 'New Subscriber', `${custName} subscribed to ${planType} plan`, {
            email: custEmail,
            metadata: { plan: planType, amount: session.amount_total ? session.amount_total / 100 : 0 }
          }).catch(() => {});
        } catch (_) {}

        // ── Record deal in sales leaderboard ──
        try {
          // Extract sales rep attribution from session metadata if available
          const salesRepEmail = session.metadata?.sales_rep_email;
          const amountTotal = session.amount_total ? session.amount_total / 100 : 0; // cents → dollars
          const interval = session.metadata?.interval || 'yearly';
          await recordDealFromStripeEvent({
            type: 'checkout.session.completed',
            customer_email: session.customer_email || session.customer_details?.email,
            customer_name: session.customer_details?.name || session.customer_email,
            sales_rep_email: salesRepEmail,
            amount: amountTotal,
            plan_interval: interval,
            stripe_sub_id: session.subscription,
            stripe_checkout_session_id: session.id,
          });
        } catch (salesErr) {
          console.error('[SALES LEADERBOARD] Error recording deal:', salesErr);
        }
      } else {
        console.warn('[BILLING WEBHOOK] Missing userId or planType in session metadata');
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      
      // Find user by customer ID
      const userId = await kv.get(`stripe_customer_reverse:${customerId}`);
      
      if (userId) {
          const status = subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : subscription.status;
          
          // Get existing sub to preserve plan info if needed, or update it
          const existingSub = await kv.get(`contndr_sub:${userId}`);
          
          await kv.set(`contndr_sub:${userId}`, {
            ...existingSub,
            status: status,
            stripe_sub_id: subscription.id,
            updated_at: new Date().toISOString()
          });
          console.log(`[BILLING] Updated subscription for user ${userId} to ${status}`);
      } else {
          console.warn(`[BILLING] Could not find user for customer ${customerId} in subscription.updated`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      
      const userId = await kv.get(`stripe_customer_reverse:${customerId}`);
      
      if (userId) {
          await kv.set(`contndr_sub:${userId}`, {
            status: 'canceled',
            plan: 'none',
            updated_at: new Date().toISOString()
          });
          console.log(`[BILLING] Canceled subscription for user ${userId}`);

          // ── Affiliate churn tracking ──
          try {
            const affiliateUserId = await kv.get(`affiliate_ref:${userId}`);
            if (affiliateUserId) {
              await withAffiliateLock(affiliateUserId, async () => {
                const referrals = (await kv.get(`affiliate:${affiliateUserId}:referrals`)) || [];
                const idx = referrals.findIndex((r: any) => r.referred_user_id === userId);
                if (idx !== -1) {
                  referrals[idx].status = 'churned';
                  referrals[idx].churned_at = new Date().toISOString();
                  await kv.set(`affiliate:${affiliateUserId}:referrals`, referrals);
                  console.log(`[AFFILIATE] Marked referral as churned for affiliate ${affiliateUserId}`);
                }
              });
            }
          } catch (affErr) {
            console.error('[AFFILIATE] Error tracking churn:', affErr);
          }

          // ── Mark deals as canceled in sales leaderboard ──
          try {
            await markDealsAsCanceled(subscription.id);
          } catch (salesErr) {
            console.error('[SALES LEADERBOARD] Error marking deals as canceled:', salesErr);
          }
      } else {
          console.warn(`[BILLING] Could not find user for customer ${customerId} in subscription.deleted`);
      }
      break;
    }

    // ── Recurring revenue: fires on every successful invoice payment ──
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const subId = invoice.subscription;

      // Skip one-off invoices with no subscription
      if (!subId) {
        console.log('[BILLING WEBHOOK] invoice.payment_succeeded — no subscription, skipping');
        break;
      }

      console.log(`[BILLING WEBHOOK] invoice.payment_succeeded — sub=${subId}, reason=${invoice.billing_reason}, amount=${invoice.amount_paid}`);

      try {
        // Determine interval from the invoice line items
        const lineItem = invoice.lines?.data?.[0];
        const interval = lineItem?.price?.recurring?.interval || 'monthly';

        await recordRecurringPayment({
          invoice_id: invoice.id,
          stripe_sub_id: subId,
          customer_email: invoice.customer_email,
          customer_name: invoice.customer_name || invoice.customer_email,
          amount: invoice.amount_paid ? invoice.amount_paid / 100 : 0, // cents → dollars
          plan_interval: interval,
          billing_reason: invoice.billing_reason || 'unknown',
        });
      } catch (salesErr) {
        console.error('[SALES LEADERBOARD] Error recording recurring payment from invoice:', salesErr);
      }

      // ── AI Call Credits renewal on recurring payment ──
      if (invoice.billing_reason === 'subscription_cycle') {
        try {
          const invCustomerId = invoice.customer;
          const invUserId = await kv.get(`stripe_customer_reverse:${invCustomerId}`);
          if (invUserId) {
            const invSub = await kv.get(`contndr_sub:${invUserId}`);
            if (invSub?.plan) {
              const { resetMonthlyCredits, allocateCredits } = await import('./ai-credits.tsx');
              await allocateCredits(invUserId, invSub.plan);
              console.log(`[BILLING WEBHOOK] AI credits renewed for ${invUserId} on ${invSub.plan} plan`);
            }
          }
        } catch (creditsErr) {
          console.error('[BILLING WEBHOOK] AI credits renewal error (non-fatal):', creditsErr);
        }
      }

      // ── Reset payment-failure counter + log admin event ──
      // Successful payment clears any prior dunning state so we don't
      // accidentally downgrade an account that recovered.
      try {
        const invCustomerId = invoice.customer;
        const invUserId = await kv.get(`stripe_customer_reverse:${invCustomerId}`);
        if (invUserId) {
          await kv.del(`payment_failures:${invUserId}`).catch(() => {});
        }
        const amount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
        const lineItem = invoice.lines?.data?.[0];
        const interval = lineItem?.price?.recurring?.interval || 'monthly';
        const { logAdminEvent } = await import('./admin-events.tsx');
        logAdminEvent(
          'payment_succeeded',
          'Recurring Payment Received',
          `${invoice.customer_email || invoice.customer_name || 'Customer'} paid $${amount.toFixed(2)} (${interval}, ${invoice.billing_reason || 'cycle'})`,
          {
            email: invoice.customer_email,
            metadata: {
              amount,
              currency: invoice.currency,
              interval,
              billing_reason: invoice.billing_reason,
              stripe_invoice_id: invoice.id,
              stripe_sub_id: subId,
            },
          },
        ).catch(() => {});
      } catch (adminErr) {
        console.error('[BILLING WEBHOOK] Admin event log error (non-fatal):', adminErr);
      }

      break;
    }

    // ── Payment failure → track, alert admin, eventually downgrade ──
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      const customerId = invoice.customer;

      if (!subId) {
        console.log('[BILLING WEBHOOK] invoice.payment_failed — no subscription, skipping');
        break;
      }

      // How many consecutive failures before we downgrade? Configurable so
      // ops can dial it up/down based on tolerance. Default 3 — matches
      // Stripe's default Smart Retries before they give up.
      const FAILURE_THRESHOLD = Math.max(1, parseInt(Deno.env.get('PAYMENT_FAILURE_THRESHOLD') || '3', 10));
      const failedAt = new Date().toISOString();
      const amountDue = invoice.amount_due ? invoice.amount_due / 100 : 0;
      const attemptCount = invoice.attempt_count || 1;
      const customerEmail = invoice.customer_email || invoice.customer_name || 'unknown';

      console.warn(`[BILLING WEBHOOK] invoice.payment_failed — sub=${subId}, attempt=${attemptCount}, amount=${amountDue}, customer=${customerEmail}`);

      // Resolve user
      let failedUserId: string | null = null;
      try {
        failedUserId = await kv.get(`stripe_customer_reverse:${customerId}`);
      } catch {}

      // Bump the consecutive-failure counter. Keyed by user so a recovered
      // payment naturally resets the count via the success handler above.
      let failures = 1;
      if (failedUserId) {
        try {
          const prev = (await kv.get(`payment_failures:${failedUserId}`)) || { count: 0 };
          failures = (prev.count || 0) + 1;
          await kv.set(`payment_failures:${failedUserId}`, {
            count: failures,
            first_failed_at: prev.first_failed_at || failedAt,
            last_failed_at: failedAt,
            stripe_sub_id: subId,
            stripe_invoice_id: invoice.id,
            amount_due: amountDue,
            attempts: attemptCount,
          });
        } catch (kvErr) {
          console.error('[BILLING WEBHOOK] Could not record payment failure counter:', kvErr);
        }
      }

      // Alert admin on every failure — surface in Activity feed
      try {
        const { logAdminEvent } = await import('./admin-events.tsx');
        logAdminEvent(
          'payment_failed',
          failures >= FAILURE_THRESHOLD ? 'Payment Failed — DOWNGRADING' : `Payment Failed (${failures}/${FAILURE_THRESHOLD})`,
          `${customerEmail} payment failed: $${amountDue.toFixed(2)} (attempt ${attemptCount}). ${failures >= FAILURE_THRESHOLD ? 'Auto-downgrading.' : 'Will retry per Stripe smart-retry policy.'}`,
          {
            email: invoice.customer_email,
            metadata: {
              amount_due: amountDue,
              currency: invoice.currency,
              attempt_count: attemptCount,
              consecutive_failures: failures,
              threshold: FAILURE_THRESHOLD,
              stripe_invoice_id: invoice.id,
              stripe_sub_id: subId,
            },
          },
        ).catch(() => {});
      } catch (_) {}

      // Native push to the affected user — this is the single most
      // urgent notification the app emits (they're about to lose
      // access if they don't fix their card).
      if (failedUserId) {
        (async () => {
          try {
            const { sendNativePush } = await import('./native-push.tsx');
            await sendNativePush(failedUserId, {
              title: '⚠️ Payment failed',
              body: `$${amountDue.toFixed(2)} payment failed (attempt ${attemptCount}). Update your card to avoid losing access.`,
              data: { type: 'payment_failed', amount: amountDue, attempt: attemptCount },
            });
          } catch (err) {
            console.warn('[NATIVE-PUSH] payment-failed fanout failed:', (err as any)?.message);
          }
        })();
      }

      // Auto-downgrade after threshold
      if (failedUserId && failures >= FAILURE_THRESHOLD) {
        try {
          console.warn(`[BILLING WEBHOOK] Threshold reached (${failures}/${FAILURE_THRESHOLD}) — downgrading user ${failedUserId}`);

          // Best-effort cancel the Stripe subscription so they stop being
          // charged and Stripe stops retrying.
          try {
            await stripe.subscriptions.cancel(subId, { prorate: false });
          } catch (cancelErr: any) {
            // Subscription may already be canceled or in unrecoverable state — log and continue
            console.warn(`[BILLING WEBHOOK] Could not cancel sub ${subId} during downgrade: ${cancelErr?.message}`);
          }

          // Flip plan to 'none' in our records so feature gates take effect immediately.
          const existingSub = (await kv.get(`contndr_sub:${failedUserId}`)) || {};
          await kv.set(`contndr_sub:${failedUserId}`, {
            ...existingSub,
            plan: 'none',
            status: 'canceled',
            downgraded_at: failedAt,
            downgrade_reason: `payment_failed_${failures}x`,
            previous_plan: existingSub.plan || null,
            stripe_sub_id: subId,
            updated_at: failedAt,
          });

          // Clear the failure counter — we acted on it
          await kv.del(`payment_failures:${failedUserId}`).catch(() => {});

          // Log the downgrade as its own event
          try {
            const { logAdminEvent } = await import('./admin-events.tsx');
            logAdminEvent(
              'subscription_downgraded',
              'Account Downgraded — Payment Failures',
              `${customerEmail} downgraded from ${existingSub.plan || 'paid'} after ${failures} consecutive failed payments`,
              {
                email: invoice.customer_email,
                metadata: {
                  previous_plan: existingSub.plan || null,
                  consecutive_failures: failures,
                  stripe_sub_id: subId,
                  reason: 'payment_failed',
                },
              },
            ).catch(() => {});
          } catch (_) {}

          // Notify the customer — they need to know WHY their account
          // changed so they can fix their card. Sent only when we have a
          // real email address (skip the "unknown" placeholder case).
          if (invoice.customer_email && /@/.test(invoice.customer_email)) {
            try {
              const { sendAccountDowngradedEmail } = await import('./email-sender.tsx');
              await sendAccountDowngradedEmail({
                email: invoice.customer_email,
                name: invoice.customer_name || undefined,
                previousPlan: existingSub.plan || null,
                failureCount: failures,
              });
              console.log(`[BILLING WEBHOOK] Sent downgrade notification to ${invoice.customer_email}`);
            } catch (emailErr: any) {
              // Email failure shouldn't block the downgrade itself
              console.error('[BILLING WEBHOOK] Could not send downgrade email:', emailErr?.message);
            }
          }
        } catch (downgradeErr) {
          console.error('[BILLING WEBHOOK] Auto-downgrade failed:', downgradeErr);
        }
      }

      break;
    }
  }

  return { received: true };
}

// ---------------------------------------------------------------------------
// Cancel a user's subscription — called from Settings > Billing
// ---------------------------------------------------------------------------
export async function cancelUserSubscription(user: any, immediate: boolean = false) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe not configured");

  const userId = user.id;
  const userEmail = user.email;
  console.log(`[BILLING CANCEL] User ${userId} (${userEmail}) requesting cancellation. Immediate: ${immediate}`);

  // 1. Get the subscription from KV
  const sub = await kv.get(`contndr_sub:${userId}`);
  if (!sub || !sub.stripe_sub_id) {
    // Fallback: try to find it in Stripe directly
    const customerId = await kv.get(`stripe_customer:${userId}`);
    if (customerId) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 5 });
      if (subs.data.length > 0) {
        const stripeSub = subs.data[0];
        if (immediate) {
          await stripe.subscriptions.cancel(stripeSub.id, { prorate: true });
          console.log(`[BILLING CANCEL] Immediately canceled Stripe sub: ${stripeSub.id}`);
        } else {
          await stripe.subscriptions.update(stripeSub.id, { cancel_at_period_end: true });
          console.log(`[BILLING CANCEL] Set cancel_at_period_end for Stripe sub: ${stripeSub.id}`);
        }

        const cancelStatus = immediate ? 'canceled' : 'active';
        await kv.set(`contndr_sub:${userId}`, {
          ...sub,
          status: cancelStatus,
          cancel_at_period_end: !immediate,
          canceled_at: new Date().toISOString(),
          stripe_sub_id: stripeSub.id,
          updated_at: new Date().toISOString(),
        });

        return {
          success: true,
          immediate,
          cancel_at_period_end: !immediate,
          current_period_end: stripeSub.current_period_end
            ? new Date(stripeSub.current_period_end * 1000).toISOString()
            : null,
        };
      }
    }
    throw new Error("No active subscription found to cancel.");
  }

  // 2. Cancel in Stripe
  try {
    if (immediate) {
      await stripe.subscriptions.cancel(sub.stripe_sub_id, { prorate: true });
      console.log(`[BILLING CANCEL] Immediately canceled Stripe sub: ${sub.stripe_sub_id}`);
    } else {
      await stripe.subscriptions.update(sub.stripe_sub_id, { cancel_at_period_end: true });
      console.log(`[BILLING CANCEL] Set cancel_at_period_end for Stripe sub: ${sub.stripe_sub_id}`);
    }
  } catch (stripeErr: any) {
    // If the sub is already canceled in Stripe, just update KV
    if (stripeErr.code === 'resource_missing') {
      console.warn(`[BILLING CANCEL] Stripe sub ${sub.stripe_sub_id} not found — marking as canceled in KV.`);
      await kv.set(`contndr_sub:${userId}`, {
        ...sub,
        plan: 'none',
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return { success: true, immediate: true, cancel_at_period_end: false, current_period_end: null };
    }
    throw stripeErr;
  }

  // 3. Get the current period end for the "access until" date
  let currentPeriodEnd = null;
  try {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_sub_id);
    currentPeriodEnd = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000).toISOString()
      : null;
  } catch (_) {
    // Non-fatal
  }

  // 4. Update KV
  const cancelStatus = immediate ? 'canceled' : 'active';
  await kv.set(`contndr_sub:${userId}`, {
    ...sub,
    plan: immediate ? 'none' : (sub?.plan || 'none'),
    status: cancelStatus,
    cancel_at_period_end: !immediate,
    canceled_at: new Date().toISOString(),
    current_period_end: currentPeriodEnd,
    updated_at: new Date().toISOString(),
  });

  // 5. Affiliate churn tracking (only if immediate)
  if (immediate) {
    try {
      const affiliateUserId = await kv.get(`affiliate_ref:${userId}`);
      if (affiliateUserId) {
        const referrals = (await kv.get(`affiliate:${affiliateUserId}:referrals`)) || [];
        const idx = referrals.findIndex((r: any) => r.referred_user_id === userId);
        if (idx !== -1) {
          referrals[idx].status = 'churned';
          referrals[idx].churned_at = new Date().toISOString();
          await kv.set(`affiliate:${affiliateUserId}:referrals`, referrals);
        }
      }
    } catch (affErr) {
      console.error('[BILLING CANCEL] Affiliate churn tracking error:', affErr);
    }
  }

  console.log(`[BILLING CANCEL] ✅ Cancellation processed for user ${userId}`);
  return {
    success: true,
    immediate,
    cancel_at_period_end: !immediate,
    current_period_end: currentPeriodEnd,
  };
}

// ---------------------------------------------------------------------------
// Sync subscription from Stripe — heals KV when webhooks are missed
// ---------------------------------------------------------------------------
export async function syncStripeSubscription(userId: string, userEmail: string) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe not configured");

  console.log(`[BILLING SYNC] Syncing Stripe subscription for user ${userId} (${userEmail})`);

  // 1. Try to find the Stripe customer ID from KV
  let customerId = null;
  try {
    customerId = await kv.get(`stripe_customer:${userId}`);
  } catch (err: any) {
    console.warn(`[BILLING SYNC] KV get failed for stripe_customer:${userId}:`, err?.message || err);
    // Ignore and proceed to email lookup
  }

  // 2. If not in KV, look up by email in Stripe
  if (!customerId) {
    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      // Heal KV (swallow errors if DB is full)
      try {
        await kv.set(`stripe_customer:${userId}`, customerId);
        await kv.set(`stripe_customer_reverse:${customerId}`, userId);
        console.log(`[BILLING SYNC] Found and cached Stripe customer: ${customerId}`);
      } catch (err: any) {
        console.warn(`[BILLING SYNC] KV set failed for stripe_customer, continuing anyway...`);
      }
    } else {
      console.log(`[BILLING SYNC] No Stripe customer found for email: ${userEmail}`);
      return { synced: false, reason: 'No Stripe customer found for this email' };
    }
  }

  // 3. Fetch active subscriptions for this customer
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 10,
  });

  // Also check trialing
  let sub = subscriptions.data[0];
  if (!sub) {
    const trialingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'trialing',
      limit: 10,
    });
    sub = trialingSubs.data[0];
  }

  // ── GUARD: If multiple active subs exist, cancel the extras ──
  if (subscriptions.data.length > 1) {
    console.warn(`[BILLING SYNC] ⚠️ Found ${subscriptions.data.length} active subscriptions for customer ${customerId}. Cleaning up duplicates.`);
    // Keep the most recent one (last created), cancel the rest
    const sorted = [...subscriptions.data].sort((a: any, b: any) => b.created - a.created);
    sub = sorted[0]; // keep the newest
    for (let i = 1; i < sorted.length; i++) {
      try {
        await stripe.subscriptions.cancel(sorted[i].id, { prorate: true });
        console.log(`[BILLING SYNC] ✅ Canceled duplicate subscription: ${sorted[i].id}`);
      } catch (cancelErr: any) {
        console.warn(`[BILLING SYNC] Could not cancel duplicate sub ${sorted[i].id}: ${cancelErr?.message}`);
      }
    }
  }

  if (!sub) {
    console.log(`[BILLING SYNC] No active/trialing subscription found for customer ${customerId}`);
    return { synced: false, reason: 'No active subscription in Stripe' };
  }

  // 4. Determine the plan from the price ID
  const priceId = sub.items?.data?.[0]?.price?.id;
  let detectedPlan = 'starter'; // default

  for (const [planKey, planConfig] of Object.entries(PLANS)) {
    if (planConfig.monthly === priceId || planConfig.yearly === priceId) {
      detectedPlan = planKey;
      break;
    }
  }

  // 5. Update KV with the correct subscription data
  let existingSub = {};
  try {
    existingSub = await kv.get(`contndr_sub:${userId}`) || {};
  } catch (e) {
    // Ignore and overwrite
  }
  const updatedSub = {
    ...existingSub,
    plan: detectedPlan,
    status: 'active',
    stripe_sub_id: sub.id,
    stripe_customer_id: customerId,
    synced_from_stripe: true,
    updated_at: new Date().toISOString()
  };

  try {
    await kv.set(`contndr_sub:${userId}`, updatedSub);
  } catch (e) {
    console.warn(`[BILLING SYNC] Failed to update contndr_sub in KV (db full?), but returning healed subscription anyway.`);
  }

  // ── Affiliate conversion tracking on sync/heal ──
  try {
    const affiliateUserId = await kv.get(`affiliate_ref:${userId}`);
    if (affiliateUserId) {
      const referrals = (await kv.get(`affiliate:${affiliateUserId}:referrals`)) || [];
      const idx = referrals.findIndex((r: any) => r.referred_user_id === userId);
      if (idx !== -1 && referrals[idx].status === 'signup') {
        referrals[idx].status = 'active';
        referrals[idx].plan = detectedPlan;
        referrals[idx].converted_at = new Date().toISOString();
        referrals[idx].stripe_sub_id = sub.id;
        await kv.set(`affiliate:${affiliateUserId}:referrals`, referrals);
        console.log(`[BILLING SYNC] ✅ Affiliate referral converted for affiliate ${affiliateUserId}`);
      }
    }
  } catch (affErr) {
    console.error('[BILLING SYNC] Error tracking affiliate conversion:', affErr);
  }

  console.log(`[BILLING SYNC] ✅ Synced subscription: plan=${detectedPlan}, sub_id=${sub.id}`);
  return { synced: true, subscription: updatedSub };
}
