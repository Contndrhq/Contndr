/**
 * Market Selector Component
 * 
 * Allows users to manually select their pricing market/region.
 * Features a beautiful inline design that matches the Contndr glass-card aesthetic.
 * 
 * @version 2.0.0
 * @updated 2026-03-19
 */

import { useState } from 'react';
import { Globe, Check, Loader2, ChevronDown } from 'lucide-react';
import { type Market, getMarketLabel, MARKET_CONFIG } from '../lib/regional-pricing';
import { toast } from 'sonner';

interface MarketSelectorProps {
  currentMarket: Market;
  onMarketChange: (market: Market) => Promise<void>;
  className?: string;
  compact?: boolean;
  inline?: boolean; // New inline mode for pricing sections
}

const MARKETS: Market[] = ['US', 'BR', 'EU', 'GB', 'CA'];

export function MarketSelector({ 
  currentMarket, 
  onMarketChange, 
  className = '',
  compact = false,
  inline = false,
}: MarketSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleMarketSelect = async (market: Market) => {
    if (market === currentMarket) {
      setIsOpen(false);
      return;
    }

    setLoading(true);
    try {
      await onMarketChange(market);
      toast.success(`Pricing updated to ${getMarketLabel(market)}`);
      setIsOpen(false);
    } catch (error) {
      console.error('[MARKET SELECTOR] Failed to change market:', error);
      toast.error('Failed to update pricing region');
    } finally {
      setLoading(false);
    }
  };

  const currentConfig = MARKET_CONFIG[currentMarket];

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE MODE - Beautiful horizontal selector for pricing sections
  // ═══════════════════════════════════════════════════════════════════════════
  if (inline) {
    return (
      <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`}>
        {MARKETS.map((market) => {
          const config = MARKET_CONFIG[market];
          const isSelected = market === currentMarket;
          
          return (
            <button
              key={market}
              onClick={() => handleMarketSelect(market)}
              disabled={loading}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 ${
                isSelected
                  ? 'bg-white text-black shadow-lg'
                  : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white border border-white/10 hover:border-white/20'
              }`}
            >
              {isSelected && !loading && (
                <Check className="w-3 h-3" />
              )}
              {loading && isSelected && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              <span className="font-semibold">{config.currencySymbol}</span>
              <span className="opacity-80">{config.currency}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPACT MODE - Dropdown with globe icon
  // ═══════════════════════════════════════════════════════════════════════════
  if (compact) {
    return (
      <div className={`relative ${className}`}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-zinc-300 hover:text-white disabled:opacity-50"
          aria-label="Select pricing region"
        >
          <Globe className="w-4 h-4" />
          <span className="font-semibold">{currentConfig.currencySymbol}</span>
          <span>{currentConfig.currency}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute top-full right-0 mt-2 z-50 w-56 bg-[#0A0A0A] border border-white/10 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl">
              <div className="p-2">
                <div className="px-3 py-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Pricing Region
                </div>
                {MARKETS.map((market) => {
                  const config = MARKET_CONFIG[market];
                  const isSelected = market === currentMarket;
                  
                  return (
                    <button
                      key={market}
                      onClick={() => handleMarketSelect(market)}
                      disabled={loading}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm hover:bg-white/5 transition-colors disabled:opacity-50 text-left group"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-white font-medium group-hover:text-white">{getMarketLabel(market)}</span>
                        <span className="text-xs text-zinc-500 font-medium">({config.currencySymbol} {config.currency})</span>
                      </div>
                      {isSelected && !loading && <Check className="w-4 h-4 text-emerald-400" />}
                      {loading && isSelected && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL MODE - Grid layout for settings pages
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-sm font-medium text-zinc-900 dark:text-white">
        Pricing Region
      </label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
        Select your region to see prices in your local currency
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {MARKETS.map((market) => {
          const config = MARKET_CONFIG[market];
          const isSelected = market === currentMarket;
          
          return (
            <button
              key={market}
              onClick={() => handleMarketSelect(market)}
              disabled={loading}
              className={`relative px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                isSelected
                  ? 'bg-white dark:bg-white text-black border-white shadow-lg'
                  : 'bg-white/5 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20'
              } disabled:opacity-50`}
            >
              <div className="flex flex-col items-center gap-1">
                <span className="font-semibold">{getMarketLabel(market)}</span>
                <span className={`text-xs ${isSelected ? 'text-black/70' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {config.currencySymbol} {config.currency}
                </span>
              </div>
              {isSelected && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
              {loading && market === currentMarket && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}