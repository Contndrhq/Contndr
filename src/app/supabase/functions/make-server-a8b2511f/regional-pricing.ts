/**
 * Regional Pricing Configuration
 * Shared module for frontend and backend (isomorphic)
 * 
 * This module provides:
 * - Market-to-currency mapping
 * - Country-to-market resolution
 * - Plan pricing by market and interval
 * - Currency formatting helpers
 * 
 * @version 1.0.0
 * @updated 2026-03-19
 */

export type Market = 'US' | 'BR' | 'EU' | 'GB' | 'CA';
export type PlanKey = 'starter' | 'professional' | 'growth';
export type BillingInterval = 'monthly' | 'yearly';

export interface MarketConfig {
  currency: string;
  currencySymbol: string;
  locale: string;
  currencyPosition: 'before' | 'after';
}

export interface PlanPricing {
  monthly: number;
  yearly: number;
  yearlyMonthly: number; // Monthly price when billed yearly
}

// ════════════════════════════════════════════════════════════════════════════
// MARKET CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

export const MARKET_CONFIG: Record<Market, MarketConfig> = {
  US: {
    currency: 'USD',
    currencySymbol: '$',
    locale: 'en-US',
    currencyPosition: 'before',
  },
  BR: {
    currency: 'BRL',
    currencySymbol: 'R$',
    locale: 'pt-BR',
    currencyPosition: 'before',
  },
  EU: {
    currency: 'EUR',
    currencySymbol: '€',
    locale: 'de-DE', // Using German locale for euro formatting (can be overridden by user locale)
    currencyPosition: 'before',
  },
  GB: {
    currency: 'GBP',
    currencySymbol: '£',
    locale: 'en-GB',
    currencyPosition: 'before',
  },
  CA: {
    currency: 'CAD',
    currencySymbol: 'CA$',
    locale: 'en-CA',
    currencyPosition: 'before',
  },
};

// ════════════════════════════════════════════════════════════════════════════
// PRICING BY MARKET (Amounts in cents/minor units)
// ════════════════════════════════════════════════════════════════════════════

export const PRICING_BY_MARKET: Record<Market, Record<PlanKey, PlanPricing>> = {
  US: {
    starter: {
      monthly: 9900,  // $99.00
      yearly: 99000,  // $990.00 (20% off = $83/mo)
      yearlyMonthly: 8250,
    },
    professional: {
      monthly: 19900,  // $199.00
      yearly: 199000,  // $1,990.00 (20% off = $166/mo)
      yearlyMonthly: 16583,
    },
    growth: {
      monthly: 39900,  // $399.00
      yearly: 399000,  // $3,990.00 (20% off = $333/mo)
      yearlyMonthly: 33250,
    },
  },
  BR: {
    starter: {
      monthly: 5900,  // R$59.00
      yearly: 59000,  // R$590.00 (20% off = R$49/mo)
      yearlyMonthly: 4917,
    },
    professional: {
      monthly: 11900,  // R$119.00
      yearly: 119000,  // R$1,190.00 (20% off = R$99/mo)
      yearlyMonthly: 9917,
    },
    growth: {
      monthly: 24900,  // R$249.00
      yearly: 249000,  // R$2,490.00 (20% off = R$207/mo)
      yearlyMonthly: 20750,
    },
  },
  EU: {
    starter: {
      monthly: 7900,  // €79.00
      yearly: 79000,  // €79.00 (20% off = €66/mo)
      yearlyMonthly: 6583,
    },
    professional: {
      monthly: 14900,  // €149.00
      yearly: 149000,  // €1,490.00 (20% off = €124/mo)
      yearlyMonthly: 12417,
    },
    growth: {
      monthly: 27900,  // €279.00
      yearly: 279000,  // €2,790.00 (20% off = €233/mo)
      yearlyMonthly: 23250,
    },
  },
  GB: {
    starter: {
      monthly: 7900,  // £79.00
      yearly: 79000,  // £79.00 (20% off = £66/mo)
      yearlyMonthly: 6583,
    },
    professional: {
      monthly: 15900,  // £159.00
      yearly: 159000,  // £1,590.00 (20% off = £133/mo)
      yearlyMonthly: 13250,
    },
    growth: {
      monthly: 29900,  // £299.00
      yearly: 299000,  // £2,990.00 (20% off = £249/mo)
      yearlyMonthly: 24917,
    },
  },
  CA: {
    starter: {
      monthly: 9900,  // CA$99.00
      yearly: 99000,  // CA$990.00 (20% off = CA$83/mo)
      yearlyMonthly: 8250,
    },
    professional: {
      monthly: 19900,  // CA$199.00
      yearly: 199000,  // CA$1,990.00 (20% off = CA$166/mo)
      yearlyMonthly: 16583,
    },
    growth: {
      monthly: 34900,  // CA$349.00
      yearly: 349000,  // CA$3,490.00 (20% off = CA$291/mo)
      yearlyMonthly: 29083,
    },
  },
};

// ════════════════════════════════════════════════════════════════════════════
// COUNTRY-TO-MARKET MAPPING
// ════════════════════════════════════════════════════════════════════════════

// Euro countries that should use EU pricing
const EU_COUNTRIES = [
  'DE', 'FR', 'ES', 'PT', 'IT', 'NL', 'BE', 'AT', 'IE', 'FI', 'EE', 'LV', 'LT',
  'SK', 'SI', 'CY', 'MT', 'LU', 'GR', 'HR',
];

export function getMarketFromCountry(countryCode: string | null | undefined): Market {
  if (!countryCode) return 'US'; // Default fallback
  
  const code = countryCode.toUpperCase();
  
  // Direct mappings
  if (code === 'US') return 'US';
  if (code === 'BR') return 'BR';
  if (code === 'GB' || code === 'UK') return 'GB';
  if (code === 'CA') return 'CA';
  
  // EU countries
  if (EU_COUNTRIES.includes(code)) return 'EU';
  
  // Default to US for all other countries
  return 'US';
}

// ════════════════════════════════════════════════════════════════════════════
// PRICING HELPERS
// ════════════════════════════════════════════════════════════════════════════

export function getPlanPrice(
  plan: PlanKey,
  market: Market,
  interval: BillingInterval
): number {
  const pricing = PRICING_BY_MARKET[market]?.[plan];
  if (!pricing) return 0;
  
  return interval === 'yearly' ? pricing.yearly : pricing.monthly;
}

export function getPlanMonthlyEquivalent(
  plan: PlanKey,
  market: Market,
  interval: BillingInterval
): number {
  const pricing = PRICING_BY_MARKET[market]?.[plan];
  if (!pricing) return 0;
  
  return interval === 'yearly' ? pricing.yearlyMonthly : pricing.monthly;
}

// ════════════════════════════════════════════════════════════════════════════
// CURRENCY FORMATTING
// ════════════════════════════════════════════════════════════════════════════

export function formatCurrency(
  amountInCents: number,
  market: Market,
  options?: {
    showDecimals?: boolean;
    compact?: boolean;
  }
): string {
  const config = MARKET_CONFIG[market];
  if (!config) return `${amountInCents / 100}`;
  
  const amount = amountInCents / 100;
  const showDecimals = options?.showDecimals !== false;
  
  // Special formatting for Brazilian Real
  if (market === 'BR') {
    const formatted = amount.toLocaleString('pt-BR', {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    });
    return `${config.currencySymbol} ${formatted}`;
  }
  
  // Standard formatting for other currencies
  const formatted = amount.toLocaleString(config.locale, {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  
  return `${config.currencySymbol}${formatted}`;
}

export function getMarketLabel(market: Market): string {
  const labels: Record<Market, string> = {
    US: 'United States',
    BR: 'Brazil',
    EU: 'Europe',
    GB: 'United Kingdom',
    CA: 'Canada',
  };
  return labels[market] || market;
}

// ════════════════════════════════════════════════════════════════════════════
// USER PREFERENCE RESOLUTION
// ════════════════════════════════════════════════════════════════════════════

export function getResolvedMarket(
  detectedCountry: string | null | undefined,
  userPreference: Market | null | undefined
): Market {
  // User preference always wins
  if (userPreference && Object.keys(MARKET_CONFIG).includes(userPreference)) {
    return userPreference;
  }
  
  // Fall back to detected country
  return getMarketFromCountry(detectedCountry);
}