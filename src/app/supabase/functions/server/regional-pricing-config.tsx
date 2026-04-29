/**
 * Regional Pricing: Stripe Price ID Configuration
 * Maps (plan, market, interval) → Stripe Price ID
 * 
 * Environment variables should contain the actual Stripe price IDs for each market.
 */

import type { Market, PlanKey, BillingInterval } from './regional-pricing.ts';

// ════════════════════════════════════════════════════════════════════════════
// STRIPE PRICE ID MAPPING
// ════════════════════════════════════════════════════════════════════════════

interface StripePriceConfig {
  monthly: string;
  yearly: string;
}

type StripePriceMapping = Record<Market, Record<PlanKey, StripePriceConfig>>;

// Get Stripe price IDs from environment variables
// Format: STRIPE_PRICE_{PLAN}_{INTERVAL}_{MARKET}
// Example: STRIPE_PRICE_SCALE_MONTHLY_US, STRIPE_PRICE_ENTERPRISE_YEARLY_BR

function getEnvPriceId(plan: PlanKey, interval: 'monthly' | 'yearly', market: Market): string {
  const envKey = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}_${market}`;
  let priceId = Deno.env.get(envKey);
  
  if (!priceId && market === 'US') {
    // For US, fallback silently to legacy keys
    const legacyKey = interval === 'monthly' 
      ? `STRIPE_PRICE_${plan.toUpperCase()}`
      : `STRIPE_PRICE_${plan.toUpperCase()}_YEARLY`;
    priceId = Deno.env.get(legacyKey);
  }
  
  if (!priceId) {
    console.warn(`[REGIONAL PRICING] Missing env var for ${market} ${plan} ${interval}`);
  }
  
  return priceId || '';
}

// Fallback to legacy US-only env vars for backward compatibility
function getLegacyEnvPriceId(plan: PlanKey, interval: 'monthly' | 'yearly'): string {
  const legacyKey = interval === 'monthly' 
    ? `STRIPE_PRICE_${plan.toUpperCase()}`
    : `STRIPE_PRICE_${plan.toUpperCase()}_YEARLY`;
  
  return Deno.env.get(legacyKey) || '';
}

export const STRIPE_PRICES: StripePriceMapping = {
  US: {
    growth: {
      monthly: getEnvPriceId('growth', 'monthly', 'US') || getLegacyEnvPriceId('growth', 'monthly'),
      yearly: getEnvPriceId('growth', 'yearly', 'US') || getLegacyEnvPriceId('growth', 'yearly'),
    },
    scale: {
      monthly: getEnvPriceId('scale', 'monthly', 'US') || getLegacyEnvPriceId('scale', 'monthly'),
      yearly: getEnvPriceId('scale', 'yearly', 'US') || getLegacyEnvPriceId('scale', 'yearly'),
    },
    enterprise: {
      monthly: getEnvPriceId('enterprise', 'monthly', 'US') || getLegacyEnvPriceId('enterprise', 'monthly'),
      yearly: getEnvPriceId('enterprise', 'yearly', 'US') || getLegacyEnvPriceId('enterprise', 'yearly'),
    },
  },
  BR: {
    growth: {
      monthly: getEnvPriceId('growth', 'monthly', 'BR'),
      yearly: getEnvPriceId('growth', 'yearly', 'BR'),
    },
    scale: {
      monthly: getEnvPriceId('scale', 'monthly', 'BR'),
      yearly: getEnvPriceId('scale', 'yearly', 'BR'),
    },
    enterprise: {
      monthly: getEnvPriceId('enterprise', 'monthly', 'BR'),
      yearly: getEnvPriceId('enterprise', 'yearly', 'BR'),
    },
  },
  EU: {
    growth: {
      monthly: getEnvPriceId('growth', 'monthly', 'EU'),
      yearly: getEnvPriceId('growth', 'yearly', 'EU'),
    },
    scale: {
      monthly: getEnvPriceId('scale', 'monthly', 'EU'),
      yearly: getEnvPriceId('scale', 'yearly', 'EU'),
    },
    enterprise: {
      monthly: getEnvPriceId('enterprise', 'monthly', 'EU'),
      yearly: getEnvPriceId('enterprise', 'yearly', 'EU'),
    },
  },
  GB: {
    growth: {
      monthly: getEnvPriceId('growth', 'monthly', 'GB'),
      yearly: getEnvPriceId('growth', 'yearly', 'GB'),
    },
    scale: {
      monthly: getEnvPriceId('scale', 'monthly', 'GB'),
      yearly: getEnvPriceId('scale', 'yearly', 'GB'),
    },
    enterprise: {
      monthly: getEnvPriceId('enterprise', 'monthly', 'GB'),
      yearly: getEnvPriceId('enterprise', 'yearly', 'GB'),
    },
  },
  CA: {
    growth: {
      monthly: getEnvPriceId('growth', 'monthly', 'CA'),
      yearly: getEnvPriceId('growth', 'yearly', 'CA'),
    },
    scale: {
      monthly: getEnvPriceId('scale', 'monthly', 'CA'),
      yearly: getEnvPriceId('scale', 'yearly', 'CA'),
    },
    enterprise: {
      monthly: getEnvPriceId('enterprise', 'monthly', 'CA'),
      yearly: getEnvPriceId('enterprise', 'yearly', 'CA'),
    },
  },
};

// ════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

export function getStripePriceId(
  plan: PlanKey,
  market: Market,
  interval: BillingInterval
): string {
  const intervalKey = interval === 'yearly' ? 'yearly' : 'monthly';
  const priceId = STRIPE_PRICES[market]?.[plan]?.[intervalKey];
  
  if (!priceId) {
    console.error(`[REGIONAL PRICING] Missing Stripe price ID for ${plan} ${interval} ${market}`);
    // Fallback to US if regional price not configured
    if (market !== 'US') {
      console.warn(`[REGIONAL PRICING] Falling back to US price for ${plan} ${interval}`);
      return STRIPE_PRICES.US?.[plan]?.[intervalKey] || '';
    }
  }
  
  return priceId || '';
}

export function validateStripePriceId(priceId: string): boolean {
  // Stripe price IDs start with 'price_'
  return priceId.startsWith('price_') && !priceId.includes('price_1Q...');
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTRY DETECTION
// ════════════════════════════════════════════════════════════════════════════

export function detectCountryFromRequest(req: Request): string | null {
  // Try Cloudflare geo header (used by Supabase Edge Functions)
  const cfCountry = req.headers.get('cf-ipcountry');
  if (cfCountry && cfCountry !== 'XX') {
    return cfCountry;
  }
  
  // Try other common geo headers
  const xCountry = req.headers.get('x-country');
  if (xCountry) {
    return xCountry;
  }
  
  const xGeoCountry = req.headers.get('x-geo-country');
  if (xGeoCountry) {
    return xGeoCountry;
  }
  
  return null;
}
