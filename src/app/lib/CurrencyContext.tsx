/**
 * Global Currency Context
 * 
 * Provides manual currency selection with localStorage persistence
 * throughout the entire application.
 * 
 * Features:
 * - Manual location/currency selection (no auto-detection)
 * - User preference persistence via localStorage
 * - Dynamic currency formatting
 * - Regional pricing support
 * 
 * @version 2.0.0
 * @updated 2026-03-19
 */

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRegionalPricing } from './useRegionalPricing';
import type { Market, PlanKey } from './regional-pricing';
import { MARKET_CONFIG } from './regional-pricing';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

interface CurrencyContextValue {
  market: Market;
  loading: boolean;
  error: string | null;
  
  // Currency info
  currencySymbol: string;
  currency: string;
  locale: string;
  
  // Formatting functions
  formatPrice: (amountInCents: number, options?: FormatOptions) => string;
  formatAmount: (amount: number, options?: FormatOptions) => string;
  
  // Plan pricing
  getPlanPrice: (plan: PlanKey, interval?: 'monthly' | 'yearly') => string;
  
  // Market management
  setMarket: (market: Market) => Promise<void>;
  refetch: () => Promise<void>;
}

interface FormatOptions {
  showDecimals?: boolean;
  compact?: boolean;
  wholeDollars?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// CONTEXT
// ════════════════════════════════════════════════════════════════════════════

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

// ════════════════════════════════════════════════════════════════════════════
// PROVIDER
// ════════════════════════════════════════════════════════════════════════════

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const {
    market,
    loading,
    error,
    setMarket,
    refetch,
    getPlanPricing,
    getCurrencyConfig,
  } = useRegionalPricing();

  const currencyConfig = getCurrencyConfig();

  // Format price in cents to localized currency string
  const formatPrice = useCallback(
    (amountInCents: number, options?: FormatOptions): string => {
      const config = currencyConfig;
      const amount = amountInCents / 100;
      const showDecimals = options?.showDecimals !== false;
      
      // Special handling for Brazilian Real
      if (market === 'BR') {
        const formatted = amount.toLocaleString('pt-BR', {
          minimumFractionDigits: showDecimals ? 2 : 0,
          maximumFractionDigits: showDecimals ? 2 : 0,
        });
        return `${config.currencySymbol} ${formatted}`;
      }
      
      // Standard formatting
      const formatted = amount.toLocaleString(config.locale, {
        minimumFractionDigits: showDecimals ? 2 : 0,
        maximumFractionDigits: showDecimals ? 2 : 0,
      });
      
      return `${config.currencySymbol}${formatted}`;
    },
    [market, currencyConfig]
  );

  // Format whole dollar amount to localized currency string
  const formatAmount = useCallback(
    (amount: number, options?: FormatOptions): string => {
      const config = currencyConfig;
      const showDecimals = options?.showDecimals ?? false;
      
      // Compact formatting for large numbers
      if (options?.compact && amount >= 1000) {
        const units = ['', 'K', 'M', 'B'];
        let unitIndex = 0;
        let value = amount;
        
        while (value >= 1000 && unitIndex < units.length - 1) {
          value /= 1000;
          unitIndex++;
        }
        
        const formatted = value.toLocaleString(config.locale, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        });
        
        if (market === 'BR') {
          return `${config.currencySymbol} ${formatted}${units[unitIndex]}`;
        }
        return `${config.currencySymbol}${formatted}${units[unitIndex]}`;
      }
      
      // Standard formatting
      if (market === 'BR') {
        const formatted = amount.toLocaleString('pt-BR', {
          minimumFractionDigits: showDecimals ? 2 : 0,
          maximumFractionDigits: showDecimals ? 2 : 0,
        });
        return `${config.currencySymbol} ${formatted}`;
      }
      
      const formatted = amount.toLocaleString(config.locale, {
        minimumFractionDigits: showDecimals ? 2 : 0,
        maximumFractionDigits: showDecimals ? 2 : 0,
      });
      
      return `${config.currencySymbol}${formatted}`;
    },
    [market, currencyConfig]
  );

  // Get plan price formatted
  const getPlanPrice = useCallback(
    (plan: PlanKey, interval: 'monthly' | 'yearly' = 'monthly'): string => {
      const pricing = getPlanPricing(plan);
      if (interval === 'yearly') {
        return pricing.formattedYearlyMonthly; // Show monthly equivalent
      }
      return pricing.formattedMonthly;
    },
    [getPlanPricing]
  );

  const value: CurrencyContextValue = {
    market,
    loading,
    error,
    currencySymbol: currencyConfig.currencySymbol,
    currency: currencyConfig.currency,
    locale: currencyConfig.locale,
    formatPrice,
    formatAmount,
    getPlanPrice,
    setMarket,
    refetch,
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HOOK
// ════════════════════════════════════════════════════════════════════════════

export function useCurrency() {
  const context = useContext(CurrencyContext);
  
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  
  return context;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER HOOK FOR OPTIONAL USAGE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Safe version of useCurrency that returns default values if used outside provider
 * Useful for components that might be rendered outside the main app
 */
export function useCurrencySafe() {
  const context = useContext(CurrencyContext);
  
  if (context === undefined) {
    // Return default USD values
    const defaultConfig = MARKET_CONFIG.US;
    return {
      market: 'US' as Market,
      loading: false,
      error: null,
      currencySymbol: defaultConfig.currencySymbol,
      currency: defaultConfig.currency,
      locale: defaultConfig.locale,
      formatPrice: (amountInCents: number) => `$${(amountInCents / 100).toFixed(2)}`,
      formatAmount: (amount: number) => `$${amount.toLocaleString('en-US')}`,
      getPlanPrice: () => '$99',
      setMarket: async () => {},
      refetch: async () => {},
    };
  }
  
  return context;
}