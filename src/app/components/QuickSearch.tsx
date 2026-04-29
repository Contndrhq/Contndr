import { useState, useEffect, useRef } from 'react';
import { Search, X, Mail, Target, Users, Command } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';
import { useTranslation } from 'react-i18next';

interface SearchResult {
  type: 'lead' | 'campaign' | 'email';
  id: string;
  title: string;
  subtitle: string;
  metadata?: string;
}

interface QuickSearchProps {
  onNavigate?: (view: string, id?: string) => void;
}

export function QuickSearch({ onNavigate }: QuickSearchProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut to open search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // ⌘K on Mac, Ctrl+K on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      
      // ESC to close
      if (e.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
        setResults([]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Search across leads, campaigns, emails
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const searchTimer = setTimeout(async () => {
      setLoading(true);
      const searchResults: SearchResult[] = [];

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          setResults([]);
          setLoading(false);
          return;
        }

        // Search leads - scoped to current user
        const { data: leads } = await supabase
          .from('leads')
          .select('id, business_name, email, city, category')
          .eq('user_id', userId)
          .or(`business_name.ilike.%${query}%,email.ilike.%${query}%,city.ilike.%${query}%`)
          .limit(5);

        if (leads) {
          searchResults.push(
            ...leads.map(lead => ({
              type: 'lead' as const,
              id: lead.id,
              title: lead.business_name,
              subtitle: lead.email || t('quickSearch.noEmail'),
              metadata: lead.city || lead.category,
            }))
          );
        }

        // Search campaigns - scoped to current user
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('id, name, brand, status')
          .eq('user_id', userId)
          .ilike('name', `%${query}%`)
          .limit(5);

        if (campaigns) {
          searchResults.push(
            ...campaigns.map(campaign => ({
              type: 'campaign' as const,
              id: campaign.id,
              title: campaign.name,
              subtitle: campaign.brand,
              metadata: campaign.status,
            }))
          );
        }

        // Search emails - scoped to current user
        const { data: emails } = await supabase
          .from('emails')
          .select('id, subject, status, leads(business_name)')
          .eq('user_id', userId)
          .ilike('subject', `%${query}%`)
          .limit(5);

        if (emails) {
          searchResults.push(
            ...emails.map(email => ({
              type: 'email' as const,
              id: email.id,
              title: email.subject,
              subtitle: email.leads?.business_name || 'Unknown',
              metadata: email.status,
            }))
          );
        }

        setResults(searchResults);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    }, 300); // Debounce

    return () => clearTimeout(searchTimer);
  }, [query]);

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  }

  function handleSelect(result: SearchResult) {
    setIsOpen(false);
    setQuery('');
    setResults([]);

    // Navigate based on result type
    if (onNavigate) {
      if (result.type === 'lead') {
        onNavigate('crm', result.id);
      } else if (result.type === 'campaign') {
        onNavigate('campaigns', result.id);
      } else if (result.type === 'email') {
        onNavigate('inbox', result.id);
      }
    }
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'lead':
        return <Users className="w-4 h-4" />;
      case 'campaign':
        return <Target className="w-4 h-4" />;
      case 'email':
        return <Mail className="w-4 h-4" />;
      default:
        return <Search className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'lead':
        return 'text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/20';
      case 'campaign':
        return 'text-slate-600 bg-slate-50 dark:text-slate-400 dark:bg-slate-950/20';
      case 'email':
        return 'text-[#1ED4A7] bg-[#1ED4A7]/10 dark:text-[#1ED4A7] dark:bg-[#1ED4A7]/10';
      default:
        return 'text-gray-600 bg-gray-50 dark:text-gray-400 dark:bg-gray-950/20';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={() => {
          setIsOpen(false);
          setQuery('');
          setResults([]);
        }}
      />

      {/* Search Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-scale-in">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-200 dark:border-gray-700">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('quickSearch.searchPlaceholder')}
            className="flex-1 bg-transparent border-none outline-none text-[15px] text-gray-900 dark:text-white placeholder:text-gray-400"
          />
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">ESC</kbd>
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              setQuery('');
              setResults([]);
            }}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <LoadingSpinner size="md" center />
          )}

          {!loading && query && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-[14px] text-gray-500 dark:text-gray-400">{t('quickSearch.noResults')}</p>
              <p className="text-[12px] text-gray-400 dark:text-gray-500 mt-1">
                {t('quickSearch.trySearching')}
              </p>
            </div>
          )}

          {!loading && !query && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex items-center gap-1.5 mb-2">
                <Command className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                <span className="text-[14px] text-gray-400 dark:text-gray-500">K</span>
              </div>
              <p className="text-[14px] text-gray-500 dark:text-gray-400">{t('quickSearch.title')}</p>
              <p className="text-[12px] text-gray-400 dark:text-gray-500 mt-1">
                {t('quickSearch.searchDescription')}
              </p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-2">
              {results.map((result, index) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleSelect(result)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                    ${
                      index === selectedIndex
                        ? 'bg-gray-50 dark:bg-gray-800'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }
                  `}
                >
                  <div
                    className={`p-2 rounded-lg ${getTypeColor(result.type)}`}
                  >
                    {getIcon(result.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-gray-900 dark:text-white truncate">
                      {result.title}
                    </p>
                    <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
                      {result.subtitle}
                    </p>
                  </div>
                  {result.metadata && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      {result.metadata}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">↑↓</kbd>
              {t('quickSearch.navigate')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">Enter</kbd>
              {t('quickSearch.selectResult')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}