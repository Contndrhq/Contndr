// Rebuilt: 2026-03-03T15:00 — full rewrite to clear stale Vite module cache
import React, { useState } from 'react';
import { Building2, Users } from 'lucide-react';
import { ApolloProSearch } from './ApolloProSearch';
import { CompanySearch } from './CompanySearch';
import { useTranslation } from 'react-i18next';

// Lead Finder — triple-mode prospecting engine.
// "People" = Smart Discovery (find decision makers with verified emails).
// "Companies" = Company Search (find businesses, then drill into decision makers inline).

type FinderMode = 'people' | 'companies';

interface LeadFinderProps {
  onSaveProspects?: (prospects: any[]) => void;
  embedded?: boolean;
  onUpgrade?: () => void;
}

export function LeadFinder({ onSaveProspects, embedded = false, onUpgrade }: LeadFinderProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<FinderMode>('people');

  const tabs: { key: FinderMode; label: string; icon: typeof Users }[] = [
    { key: 'people', label: t('leadFinder.people', 'People'), icon: Users },
    { key: 'companies', label: t('leadFinder.companies', 'Companies'), icon: Building2 },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab Bar */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 pb-0">
        <div className="flex items-center gap-3">
          {/* Tabs */}
          <div className="flex items-center">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = mode === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setMode(tab.key)}
                  className={`
                    relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors duration-150
                    ${active
                      ? 'text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                  {/* Active underline */}
                  {active && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-[var(--border-color)] mt-0" />
      </div>

      {/* Active View */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'people' ? (
          <ApolloProSearch
            onSaveProspects={onSaveProspects}
            embedded={embedded}
            onUpgrade={onUpgrade}
          />
        ) : mode === 'companies' ? (
          <CompanySearch
            onUpgrade={onUpgrade}
          />
        ) : null}
      </div>
    </div>
  );
}

export default LeadFinder;
