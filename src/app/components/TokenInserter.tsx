/**
 * TokenInserter — Dropdown for inserting personalization merge tags
 * into email subject/body fields.
 *
 * Usage:
 *   <TokenInserter onInsert={(tag) => insertAtCursor(tag)} />
 */
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, User, Building2, MapPin, Settings2, Eye } from 'lucide-react';
import { TOKEN_DEFS, type TokenDef, previewTokens } from '../lib/personalization-tokens';

interface TokenInserterProps {
  /** Called with the full merge tag string, e.g. "{{first_name|there}}" */
  onInsert: (tag: string) => void;
  /** Optional: show preview panel */
  previewText?: string;
  /** Compact mode for inline toolbar */
  compact?: boolean;
}

const CATEGORY_META: Record<string, { label: string; icon: typeof User }> = {
  contact:  { label: 'Contact',  icon: User },
  company:  { label: 'Company',  icon: Building2 },
  location: { label: 'Location', icon: MapPin },
  custom:   { label: 'System',   icon: Settings2 },
};

export function TokenInserter({ onInsert, previewText, compact }: TokenInserterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = TOKEN_DEFS.filter(t =>
    !search || t.label.toLowerCase().includes(search.toLowerCase()) || t.token.includes(search.toLowerCase())
  );

  const grouped = ['contact', 'company', 'location', 'custom'].map(cat => ({
    category: cat,
    tokens: filtered.filter(t => t.category === cat),
  })).filter(g => g.tokens.length > 0);

  function handleInsert(def: TokenDef) {
    const tag = def.defaultFallback
      ? `{{${def.token}|${def.defaultFallback}}}`
      : `{{${def.token}}}`;
    onInsert(tag);
    setOpen(false);
    setSearch('');
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border transition-colors ${
          compact
            ? 'px-2 py-1 text-[11px] border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
            : 'px-3 py-1.5 text-[12px] border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-[#1ED4A7] hover:text-[#1ED4A7] dark:hover:border-[#1ED4A7] dark:hover:text-[#1ED4A7]'
        } font-medium`}
      >
        <span className="font-mono">{'{{'}</span>
        <span>Personalize</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
          {/* Search */}
          <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tokens..."
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-[#1ED4A7]"
              />
            </div>
          </div>

          {/* Token list */}
          <div className="max-h-64 overflow-y-auto p-1">
            {grouped.map(group => {
              const meta = CATEGORY_META[group.category];
              const Icon = meta.icon;
              return (
                <div key={group.category}>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 mt-1">
                    <Icon className="w-3 h-3 text-zinc-400" />
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider">
                      {meta.label}
                    </span>
                  </div>
                  {group.tokens.map(def => (
                    <button
                      key={def.token}
                      onClick={() => handleInsert(def)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors group/token text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <code className="text-[11px] font-mono text-[#1ED4A7] bg-[#1ED4A7]/10 px-1.5 py-0.5 rounded flex-shrink-0">
                          {`{{${def.token}}}`}
                        </code>
                        <span className="text-[12px] text-zinc-600 dark:text-zinc-400 truncate">
                          {def.label}
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-600 opacity-0 group-hover/token:opacity-100 transition-opacity flex-shrink-0">
                        {def.example}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
            {grouped.length === 0 && (
              <p className="text-center text-[12px] text-zinc-400 py-4">No tokens found</p>
            )}
          </div>

          {/* Footer: preview toggle */}
          {previewText && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 p-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-[#1ED4A7] transition-colors w-full px-2 py-1"
              >
                <Eye className="w-3 h-3" />
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
              {showPreview && (
                <div className="mt-1.5 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-[12px] text-zinc-700 dark:text-zinc-300 leading-relaxed max-h-32 overflow-y-auto">
                  {previewTokens(previewText)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TokenInserter;
