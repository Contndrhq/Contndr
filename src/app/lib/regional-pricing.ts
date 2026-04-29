/**
 * Regional Pricing Configuration
 * Shared module for frontend and backend (isomorphic)
 * 
 * This module provides:
 * - Market-to-currency mapping
 * - Country-to-market resolution
 * - Plan pricing by market and interval
 * - Currency formatting helpers
 */

export type Market = 'US' | 'BR' | 'EU' | 'GB' | 'CA';
export type PlanKey = 'growth' | 'scale' | 'enterprise';
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
    growth: {
      monthly: 49900,  // $499.00
      yearly: 499000,  // $4,990.00 (20% off = $416/mo)
      yearlyMonthly: 41583,
    },
    scale: {
      monthly: 99900,  // $999.00
      yearly: 999000,  // $9,990.00 (20% off = $833/mo)
      yearlyMonthly: 83250,
    },
    enterprise: {
      monthly: 250000,  // $2,500.00 (starting point for custom pricing)
      yearly: 2500000,  // $25,000.00 (20% off = $2,083/mo)
      yearlyMonthly: 208333,
    },
  },
  BR: {
    growth: {
      monthly: 29900,  // R$299.00
      yearly: 299000,  // R$2,990.00 (20% off = R$249/mo)
      yearlyMonthly: 24917,
    },
    scale: {
      monthly: 59900,  // R$599.00
      yearly: 599000,  // R$5,990.00 (20% off = R$499/mo)
      yearlyMonthly: 49917,
    },
    enterprise: {
      monthly: 149900,  // R$1,499.00
      yearly: 1499000,  // R$14,990.00 (20% off = R$1,249/mo)
      yearlyMonthly: 124917,
    },
  },
  EU: {
    growth: {
      monthly: 39900,  // €399.00
      yearly: 399000,  // €3,990.00 (20% off = €333/mo)
      yearlyMonthly: 33250,
    },
    scale: {
      monthly: 79900,  // €799.00
      yearly: 799000,  // €7,990.00 (20% off = €666/mo)
      yearlyMonthly: 66583,
    },
    enterprise: {
      monthly: 199900,  // €1,999.00
      yearly: 1999000,  // €19,990.00 (20% off = €1,666/mo)
      yearlyMonthly: 166583,
    },
  },
  GB: {
    growth: {
      monthly: 39900,  // £399.00
      yearly: 399000,  // £3,990.00 (20% off = £333/mo)
      yearlyMonthly: 33250,
    },
    scale: {
      monthly: 79900,  // £799.00
      yearly: 799000,  // £7,990.00 (20% off = £666/mo)
      yearlyMonthly: 66583,
    },
    enterprise: {
      monthly: 199900,  // £1,999.00
      yearly: 1999000,  // £19,990.00 (20% off = £1,666/mo)
      yearlyMonthly: 166583,
    },
  },
  CA: {
    growth: {
      monthly: 49900,  // CA$499.00
      yearly: 499000,  // CA$4,990.00 (20% off = CA$416/mo)
      yearlyMonthly: 41667,
    },
    scale: {
      monthly: 99900,  // CA$999.00
      yearly: 999000,  // CA$9,990.00 (20% off = CA$833/mo)
      yearlyMonthly: 83250,
    },
    enterprise: {
      monthly: 249900,  // CA$2,499.00
      yearly: 2499000,  // CA$24,990.00 (20% off = CA$2,083/mo)
      yearlyMonthly: 208250,
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