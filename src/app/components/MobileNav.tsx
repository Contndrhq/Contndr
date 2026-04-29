import React, { useState, useEffect } from 'react';
import { Home, Users, Send, GitBranch, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isNativeApp } from '../lib/ios-native-bridge';

interface MobileNavProps {
  currentView: string;
  setCurrentView: (view: any) => void;
}

export function MobileNav({ currentView, setCurrentView }: MobileNavProps) {
  const { t } = useTranslation();
  const [isAppMode, setIsAppMode] = useState(isNativeApp);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         (window.navigator as any).standalone === true;
    if (isStandalone || isNativeApp) {
      setIsAppMode(true);
    }
  }, []);

  if (!isAppMode) return null;
  
  const navItems = [
    { id: 'dashboard', icon: Home, label: t('sidebar.dashboard', 'Home') },
    { id: 'crm', icon: Users, label: t('sidebar.leads', 'Leads') },
    { id: 'campaigns', icon: Send, label: t('sidebar.campaigns', 'Campaigns') },
    { id: 'pipeline', icon: GitBranch, label: t('sidebar.pipeline', 'Pipeline') },
    { id: 'settings', icon: Settings, label: t('sidebar.settings', 'Settings') },
  ];

  return (
    <div 
      className="lg:hidden fixed bottom-0 left-0 right-0 z-[45] pointer-events-none transition-transform duration-300 transform data-[sheet-open=true]:translate-y-[150%]"
      id="mobile-nav-container"
      style={{ 
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        paddingLeft: '1rem',
        paddingRight: '1rem'
      }}
    >
      <div className="bg-white/85 dark:bg-[#111111]/85 backdrop-blur-3xl border border-zinc-200/50 dark:border-white/10 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)] rounded-[28px] px-2 py-2 flex items-center justify-between pointer-events-auto mx-auto max-w-sm">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;
          
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className="relative flex-1 flex flex-col items-center justify-center h-[52px] rounded-[20px] transition-all duration-300 tap-target-override group"
            >
              {isActive && (
                <div className="absolute inset-0 bg-zinc-100 dark:bg-white/[0.06] rounded-[20px] -z-10" />
              )}
              <div className="relative flex flex-col items-center gap-[3px]">
                <Icon 
                  className={`w-5 h-5 sm:w-[22px] sm:h-[22px] transition-all duration-300 ${
                    isActive 
                      ? 'text-[#1ED4A7] scale-110' 
                      : 'text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 scale-100'
                  }`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span 
                  className={`text-[9px] sm:text-[10px] font-semibold tracking-wide transition-colors duration-300 ${
                    isActive
                      ? 'text-zinc-900 dark:text-white'
                      : 'text-zinc-500 dark:text-zinc-500'
                  }`}
                >
                  {item.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
