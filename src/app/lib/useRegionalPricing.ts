/**
 * React hook for regional pricing management
 * 
 * Provides:
 * - Manual market selection (no auto-detection)
 * - Market selection with localStorage persistence
 * - Localized price formatting
 * - Plan pricing by market
 * 
 * @version 2.0.0
 * @updated 2026-03-19
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  type Market, 
  type PlanKey, 
  type BillingInterval,
  PRICING_BY_MARKET,
  formatCurrency,
  getMarketLabel,
  getPlanMonthlyEquivalent,
  MARKET_CONFIG
} from './regional-pricing';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from './auth';

interface RegionalPricingState {
  market: Market;
  loading: boolean;
  error: string | null;
}

export interface PlanPriceInfo {
  monthly: number;
  yearly: number;
  yearlyMonthly: number;
  formattedMonthly: string;
  formattedYearly: string;
  formattedYearlyMonthly: string;
  formattedYearlyBilled: string;
}

export function useRegionalPricing() {
  // Initialize from localStorage or default to US
  const [state, setState] = useState<RegionalPricingState>(() => {
    try {
      const saved = localStorage.getItem('contndr_market_preference');
      if (saved && ['US', 'BR', 'EU', 'GB', 'CA'].includes(saved)) {
        return { market: saved as Market, loading: false, error: null };
      }
    } catch (e) {
      console.warn('[REGIONAL PRICING] Failed to read localStorage:', e);
    }
    return { market: 'US', loading: false, error: null };
  });

  // Set market preference (Disabled in Strict Mode)
  const setMarket = useCallback(async (market: Market) => {
    console.warn('[REGIONAL PRICING] Strict Mode: Manual currency switching is disabled.');
    // We intentionally DO NOT update state or localStorage or backend here
    // to strictly enforce geo-detected pricing.
  }, []);

  // Optional: Fetch backend preference on mount (background only, doesn't override local)
  useEffect(() => {
    let mounted = true;
    
    (async () => {
      try {
        const headers = await getAuthHeaders();
        
        // Skip if not authenticated (no Authorization header)
        if (!headers.Authorization) {
          return;
        }
        
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/market`,
          { headers }
        );

        if (res.ok && mounted) {
          const data = await res.json();
          const backendMarket = data.market;
          
          // STRICT MODE: Always trust backend (which uses IP geo-detection)
          // Overwrite any local manipulation or stale preference
          if (backendMarket) {
            setState({ market: backendMarket, loading: false, error: null });
            localStorage.setItem('contndr_market_preference', backendMarket);
          }
        }
      } catch (err: any) {
        // Silently ignore - we have local default from localStorage
      }
    })();
    
    return () => { mounted = false; };
  }, []);

  // Get plan pricing info for current market
  const getPlanPricing = useCallback(
    (plan: PlanKey): PlanPriceInfo => {
      const pricing = PRICING_BY_MARKET[state.market]?.[plan];
      if (!pricing) {
        // Fallback to US pricing
        const usPricing = PRICING_BY_MARKET.US[plan];
        return {
          monthly: usPricing.monthly,
          yearly: usPricing.yearly,
          yearlyMonthly: usPricing.yearlyMonthly,
          formattedMonthly: formatCurrency(usPricing.monthly, 'US'),
          formattedYearly: formatCurrency(usPricing.yearly, 'US'),
          formattedYearlyMonthly: formatCurrency(usPricing.yearlyMonthly, 'US'),
          formattedYearlyBilled: formatCurrency(usPricing.yearly, 'US', { showDecimals: false }),
        };
      }

      return {
        monthly: pricing.monthly,
        yearly: pricing.yearly,
        yearlyMonthly: pricing.yearlyMonthly,
        formattedMonthly: formatCurrency(pricing.monthly, state.market),
        formattedYearly: formatCurrency(pricing.yearly, state.market),
        formattedYearlyMonthly: formatCurrency(pricing.yearlyMonthly, state.market),
        formattedYearlyBilled: formatCurrency(pricing.yearly, state.market, { showDecimals: false }),
      };
    },
    [state.market]
  );

  // Get formatted price for a specific plan and interval
  const getFormattedPrice = useCallback(
    (plan: PlanKey, interval: BillingInterval, monthlyEquivalent: boolean = false): string => {
      const pricing = getPlanPricing(plan);
      
      if (interval === 'yearly' && monthlyEquivalent) {
        return pricing.formattedYearlyMonthly;
      }
      
      return interval === 'yearly' ? pricing.formattedYearlyBilled : pricing.formattedMonthly;
    },
    [getPlanPricing]
  );

  // Get market label
  const getMarketDisplayLabel = useCallback(() => {
    return getMarketLabel(state.market);
  }, [state.market]);

  // Get currency config for current market
  const getCurrencyConfig = useCallback(() => {
    return MARKET_CONFIG[state.market];
  }, [state.market]);

  return {
    market: state.market,
    loading: state.loading,
    error: state.error,
    setMarket,
    refetch: async () => {}, // No-op since we don't auto-fetch anymore
    getPlanPricing,
    getFormattedPrice,
    getMarketDisplayLabel,
    getCurrencyConfig,
  };
}