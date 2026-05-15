/**
 * AI Assistant UX Improvements
 * This file contains improved components and utilities for the AI Assistant
 * 
 * Key improvements:
 * 1. Better search progress with natural language
 * 2. Enhanced brand/signature visibility
 * 3. Faster, more intuitive campaign building
 * 4. Premium polish and animations
 */

import { useState, useEffect, useMemo } from 'react';
import { Radar, Sparkles, X } from 'lucide-react';

// Enhanced Search Progress Component with better UX
export function EnhancedSearchProgress({ phase, count, params, onCancel }: { 
  phase: string; 
  count: number; 
  params?: {
    person_titles?: string[];
    organization_locations?: string[];
    organization_industries?: string[];
    q_keywords?: string;
  };
  onCancel?: () => void;
}) {
  const [dots, setDots] = useState('');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(t);
  }, []);

  // Track elapsed seconds to show cancel button after delay
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Build natural search description
  const description = useMemo(() => {
    if (!params) return null;
    const parts: string[] = [];
    
    if (params.person_titles?.length) {
      parts.push(params.person_titles.slice(0, 2).join(', '));
      if (params.person_titles.length > 2) parts[parts.length - 1] += ` +${params.person_titles.length - 2} more`;
    }
    
    if (params.q_keywords) parts.push(`"${params.q_keywords}"`);
    
    const locations = params.organization_locations?.slice(0, 2).join(', ') || '';
    const industries = params.organization_industries?.slice(0, 2).join(', ') || '';

    let desc = parts.length > 0 ? parts.join(' · ') : 'professionals';
    if (industries) desc += ` in ${industries}`;
    if (locations) desc += ` · ${locations}`;
    
    return desc;
  }, [params]);

  // Intelligent phase-aware messaging
  const getMessage = () => {
    const phaseText = phase?.toLowerCase() || '';
    
    if (phaseText.includes('taking longer')) {
      return {
        title: description ? `Still searching for ${description}` : 'Still searching...',
        subtitle: 'The database is responding slowly — hang tight or cancel and retry.'
      };
    }
    
    if (phaseText.includes('retrying')) {
      return {
        title: description ? `Retrying search for ${description}` : 'Retrying search...',
        subtitle: 'Reconnecting to the database...'
      };
    }
    
    if (phaseText.includes('local') || phaseText.includes('database')) {
      return {
        title: description ? `Searching for ${description}` : 'Searching local database',
        subtitle: 'Checking my database first — this is fast!'
      };
    }
    
    if (phaseText.includes('external') || phaseText.includes('expanding')) {
      return {
        title: description ? `Finding ${description} externally` : 'Expanding search',
        subtitle: 'Searching premium data sources for more leads...'
      };
    }
    
    if (phaseText.includes('professional') || phaseText.includes('profile')) {
      return {
        title: 'Discovering professionals',
        subtitle: description || 'Finding matching profiles...'
      };
    }
    
    if (phaseText.includes('linkedin')) {
      return {
        title: 'Searching LinkedIn',
        subtitle: 'Finding verified profiles...'
      };
    }
    
    if (phaseText.includes('discovering') && count > 0) {
      return {
        title: `Found ${count} ${count === 1 ? 'lead' : 'leads'}!`,
        subtitle: 'Enriching contact information...'
      };
    }
    
    // Default
    return {
      title: description ? `Searching for ${description}` : 'Finding leads',
      subtitle: 'This may take a moment...'
    };
  };

  const message = getMessage();
  const progress = count > 0 ? Math.min(85, (count / 25) * 85) : 35;

  return (
    <div className="space-y-2.5" style={{ animation: 'aiMsgIn .25s ease-out' }}>
      {/* Main search message */}
      <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-gradient-to-br from-zinc-50 via-white to-zinc-50/50 dark:from-white/[0.04] dark:via-white/[0.02] dark:to-white/[0.01] border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="relative w-8 h-8 shrink-0 mt-0.5">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/[0.08] dark:to-white/[0.04]" />
            <Radar className="absolute inset-0 m-auto w-4 h-4 text-zinc-600 dark:text-zinc-300 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] leading-relaxed text-zinc-800 dark:text-zinc-100 font-semibold">
              {message.title}{dots}
            </p>
            <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {message.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white dark:bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="relative w-5 h-5 shrink-0">
          <div className="absolute inset-0 rounded-full border-2 border-zinc-200 dark:border-zinc-700" />
          <div className="absolute inset-0 rounded-full border-2 border-zinc-800 dark:border-white border-t-transparent animate-spin" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-zinc-700 via-zinc-800 to-zinc-900 dark:from-zinc-300 dark:via-zinc-200 dark:to-white transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        
        {count > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-[#1ED4A7]" />
            <span className="text-[12px] font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
              {count}
            </span>
          </div>
        )}

        {onCancel && elapsed > 10 && (
          <button
            className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            onClick={onCancel}
            title="Cancel search"
          >
            <X className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">Cancel</span>
          </button>
        )}
      </div>
    </div>
  );
}