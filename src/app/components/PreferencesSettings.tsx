import { useState, useEffect, useCallback } from 'react';
import { Sun, Moon, Monitor, Check, Bell, BellOff, Layout, Columns3, Eye, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

type ThemeOption = 'light' | 'dark' | 'system';
type DensityOption = 'comfortable' | 'compact';

export function PreferencesSettings() {
  const { t } = useTranslation();

  // Map theme options with translation inside the component so `t` is available
  const THEME_OPTIONS: { id: ThemeOption; label: string; description: string; icon: typeof Sun }[] = [
    { id: 'light', label: t('preferences.light', 'Light'), description: t('preferences.lightDesc', 'Clean & bright'), icon: Sun },
    { id: 'dark', label: t('preferences.dark', 'Dark'), description: t('preferences.darkDesc', 'Easy on the eyes'), icon: Moon },
    { id: 'system', label: t('preferences.system', 'System'), description: t('preferences.systemDesc', 'Match your OS'), icon: Monitor },
  ];
  const [theme, setTheme] = useState<ThemeOption>(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
    // Default to dark when no preference has been set (matches brand)
    return 'dark';
  });

  const [density, setDensity] = useState<DensityOption>(() => {
    return (localStorage.getItem('contndr_density') as DensityOption) || 'comfortable';
  });

  const [notifSound, setNotifSound] = useState(() => {
    return localStorage.getItem('contndr_notif_sound') !== 'off';
  });

  const [notifDesktop, setNotifDesktop] = useState(() => {
    return localStorage.getItem('contndr_notif_desktop') !== 'off';
  });

  const [aiSuggestions, setAiSuggestions] = useState(() => {
    return localStorage.getItem('contndr_ai_suggestions') !== 'off';
  });

  const [animationsEnabled, setAnimationsEnabled] = useState(() => {
    return localStorage.getItem('contndr_animations') !== 'off';
  });

  const [defaultView, setDefaultView] = useState(() => {
    return localStorage.getItem('contndr_default_view') || 'dashboard';
  });

  const resolvedTheme = useCallback(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  }, [theme]);

  const handleThemeChange = (newTheme: ThemeOption) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    window.dispatchEvent(new Event('theme-change'));
  };

  const handleDensityChange = (newDensity: DensityOption) => {
    setDensity(newDensity);
    localStorage.setItem('contndr_density', newDensity);
    document.documentElement.setAttribute('data-density', newDensity);
    toast.success(t('preferences.densitySwitched', { density: newDensity, defaultValue: `Switched to ${newDensity} mode` }));
  };

  const handleToggle = (key: string, value: boolean, setter: (v: boolean) => void, label: string) => {
    setter(value);
    localStorage.setItem(key, value ? 'on' : 'off');
    toast.success(value ? t('preferences.enabled', { label, defaultValue: `${label} enabled` }) : t('preferences.disabled', { label, defaultValue: `${label} disabled` }));
  };

  const handleDefaultView = (view: string) => {
    setDefaultView(view);
    localStorage.setItem('contndr_default_view', view);
    toast.success(t('preferences.defaultViewUpdated', 'Default view updated'));
  };

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => window.dispatchEvent(new Event('theme-change'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const isDark = resolvedTheme() === 'dark';

  return (
    <div className="max-w-2xl space-y-8">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/[0.08] dark:to-white/[0.03] flex items-center justify-center border border-zinc-200/80 dark:border-zinc-200 dark:border-zinc-800">
          <Sparkles className="w-4.5 h-4.5 text-zinc-600 dark:text-zinc-300" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">{t('preferences.title', 'Preferences')}</h2>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{t('preferences.subtitle', 'Customize your Contndr experience')}</p>
        </div>
      </div>

      {/* ── Theme Section ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">{t('preferences.appearance', 'Appearance')}</h3>
          <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(opt => {
            const active = theme === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => handleThemeChange(opt.id)}
                className={`group relative rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
                  active
                    ? 'border-zinc-900 dark:border-white shadow-lg shadow-zinc-900/5 dark:shadow-white/5'
                    : 'border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-white/[0.15] hover:shadow-md'
                }`}
              >
                {/* Mini preview */}
                <div className={`h-[88px] relative overflow-hidden ${
                  opt.id === 'dark' ? 'bg-[#0a0a0a]' : opt.id === 'light' ? 'bg-[#FAFAFA]' : 'bg-gradient-to-r from-[#FAFAFA] from-50% to-[#0a0a0a] to-50%'
                }`}>
                  {/* Simulated UI chrome */}
                  {opt.id !== 'system' ? (
                    <div className="absolute inset-2 flex gap-1.5">
                      {/* Sidebar */}
                      <div className={`w-[28%] rounded-lg ${opt.id === 'dark' ? 'bg-zinc-100 dark:bg-zinc-900' : 'bg-zinc-200/60'}`}>
                        <div className="p-1.5 space-y-1">
                          <div className={`h-1 w-[70%] rounded-full ${opt.id === 'dark' ? 'bg-white/10' : 'bg-zinc-300/80'}`} />
                          <div className={`h-1 w-[50%] rounded-full ${opt.id === 'dark' ? 'bg-zinc-100 dark:bg-zinc-900' : 'bg-zinc-200/80'}`} />
                          <div className={`h-1 w-[60%] rounded-full ${opt.id === 'dark' ? 'bg-zinc-100 dark:bg-zinc-900' : 'bg-zinc-200/80'}`} />
                          <div className={`h-1 w-[40%] rounded-full ${opt.id === 'dark' ? 'bg-zinc-100 dark:bg-zinc-900' : 'bg-zinc-200/80'}`} />
                        </div>
                      </div>
                      {/* Main content */}
                      <div className="flex-1 space-y-1.5 p-1">
                        <div className={`h-1.5 w-[60%] rounded-full ${opt.id === 'dark' ? 'bg-white/10' : 'bg-zinc-300'}`} />
                        <div className={`h-6 rounded-md ${opt.id === 'dark' ? 'bg-white/[0.05]' : 'bg-zinc-100'}`} />
                        <div className="flex gap-1">
                          <div className={`h-3 flex-1 rounded ${opt.id === 'dark' ? 'bg-zinc-100 dark:bg-zinc-900' : 'bg-zinc-100/80'}`} />
                          <div className={`h-3 flex-1 rounded ${opt.id === 'dark' ? 'bg-zinc-100 dark:bg-zinc-900' : 'bg-zinc-100/80'}`} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Left half - light */}
                      <div className="absolute inset-y-2 left-2 right-[50%] mr-0.5 flex gap-1">
                        <div className="w-[30%] rounded-l-lg bg-zinc-200/60">
                          <div className="p-1 space-y-1">
                            <div className="h-1 w-[70%] rounded-full bg-zinc-300/80" />
                            <div className="h-1 w-[50%] rounded-full bg-zinc-200/80" />
                          </div>
                        </div>
                        <div className="flex-1 p-1 space-y-1">
                          <div className="h-1.5 w-[60%] rounded-full bg-zinc-300" />
                          <div className="h-5 rounded bg-zinc-100" />
                        </div>
                      </div>
                      {/* Right half - dark */}
                      <div className="absolute inset-y-2 right-2 left-[50%] ml-0.5 flex gap-1">
                        <div className="w-[30%] rounded-l-lg bg-zinc-100 dark:bg-zinc-900">
                          <div className="p-1 space-y-1">
                            <div className="h-1 w-[70%] rounded-full bg-white/10" />
                            <div className="h-1 w-[50%] rounded-full bg-zinc-100 dark:bg-zinc-900" />
                          </div>
                        </div>
                        <div className="flex-1 p-1 space-y-1">
                          <div className="h-1.5 w-[60%] rounded-full bg-white/10" />
                          <div className="h-5 rounded-r-lg bg-white/[0.05]" />
                        </div>
                      </div>
                    </>
                  )}

                  {/* Selected checkmark */}
                  {active && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center shadow-md" style={{ animation: 'aiMsgIn .2s ease-out' }}>
                      <Check className="w-3 h-3 text-white dark:text-zinc-900" strokeWidth={3} />
                    </div>
                  )}
                </div>

                {/* Label */}
                <div className={`px-3 py-2.5 flex items-center gap-2 transition-colors ${
                  active ? 'bg-zinc-50 dark:bg-zinc-100 dark:bg-zinc-900' : 'bg-white dark:bg-transparent'
                }`}>
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'}`} />
                  <div className="text-left">
                    <p className={`text-[12.5px] font-semibold ${active ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-300'}`}>{opt.label}</p>
                    <p className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{opt.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {theme === 'system' && (
          <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500 mt-2.5 flex items-center gap-1.5">
            <Monitor className="w-3 h-3" />
            {t('preferences.usingSystem', 'Currently using')} <span className="font-medium text-zinc-600 dark:text-zinc-300">{isDark ? t('preferences.dark') : t('preferences.light')}</span> {t('preferences.basedOnSystem', 'based on your system')}
          </p>
        )}
      </div>

      {/* ── Interface Section ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">{t('preferences.interface', 'Interface')}</h3>
          <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div className="space-y-1">
          {/* Density */}
          <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors">
                <Columns3 className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{t('preferences.displayDensity', 'Display density')}</p>
                <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t('preferences.displayDensityDesc', 'Adjust spacing and sizing of interface elements')}</p>
              </div>
            </div>
            <div className="flex bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 border border-zinc-200/60 dark:border-zinc-200 dark:border-zinc-800">
              {(['comfortable', 'compact'] as DensityOption[]).map(d => (
                <button
                  key={d}
                  onClick={() => handleDensityChange(d)}
                  className={`px-3 py-1.5 rounded-md text-[11.5px] font-medium transition-all ${
                    density === d
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {t(`preferences.density_${d}`, d.charAt(0).toUpperCase() + d.slice(1))}
                </button>
              ))}
            </div>
          </div>

          {/* Default view */}
          <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors">
                <Layout className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{t('preferences.defaultLandingPage', 'Default landing page')}</p>
                <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t('preferences.defaultLandingPageDesc', 'Where you land after logging in')}</p>
              </div>
            </div>
            <select
              value={defaultView}
              onChange={(e) => handleDefaultView(e.target.value)}
              className="text-[12px] font-medium bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-white/[0.08] transition-colors appearance-none pr-8 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717A%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[center_right_0.5rem]"
            >
              <option value="dashboard">{t('sidebar.dashboard', 'Dashboard')}</option>
              <option value="crm">{t('sidebar.leads', 'Leads')}</option>
              <option value="campaigns">{t('sidebar.campaigns', 'Campaigns')}</option>
              <option value="lead-finder">{t('sidebar.leadFinder', 'Lead Finder')}</option>
              <option value="emails">{t('sidebar.inbox', 'Inbox')}</option>
            </select>
          </div>

          {/* Animations */}
          <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors">
                <Eye className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{t('preferences.animations', 'Animations')}</p>
                <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t('preferences.animationsDesc', 'Smooth transitions and micro-interactions')}</p>
              </div>
            </div>
            <ToggleSwitch
              checked={animationsEnabled}
              onChange={(v) => handleToggle('contndr_animations', v, setAnimationsEnabled, t('preferences.animations', 'Animations'))}
            />
          </div>
        </div>
      </div>

      {/* ── Notifications Section ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">{t('preferences.notifications', 'Notifications')}</h3>
          <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div className="space-y-1">
          {/* Notification sounds */}
          <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors">
                {notifSound ? <Bell className="w-4 h-4 text-zinc-500 dark:text-zinc-400" /> : <BellOff className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />}
              </div>
              <div>
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{t('preferences.notificationSounds', 'Notification sounds')}</p>
                <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t('preferences.notificationSoundsDesc', 'Play sounds for new replies and campaign events')}</p>
              </div>
            </div>
            <ToggleSwitch
              checked={notifSound}
              onChange={(v) => handleToggle('contndr_notif_sound', v, setNotifSound, t('preferences.notificationSounds', 'Notification sounds'))}
            />
          </div>

          {/* Desktop notifications */}
          <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors">
                <Bell className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{t('preferences.desktopNotifications', 'Desktop notifications')}</p>
                <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t('preferences.desktopNotificationsDesc', 'Browser push notifications when the tab is in background')}</p>
              </div>
            </div>
            <ToggleSwitch
              checked={notifDesktop}
              onChange={(v) => {
                if (v && 'Notification' in window && Notification.permission !== 'granted') {
                  Notification.requestPermission().then(perm => {
                    if (perm === 'granted') {
                      handleToggle('contndr_notif_desktop', true, setNotifDesktop, t('preferences.desktopNotifications', 'Desktop notifications'));
                    } else {
                      toast.error(t('preferences.browserNotifBlocked', 'Browser notifications blocked — enable in browser settings'));
                    }
                  });
                } else {
                  handleToggle('contndr_notif_desktop', v, setNotifDesktop, t('preferences.desktopNotifications', 'Desktop notifications'));
                }
              }}
            />
          </div>

          {/* AI suggestions */}
          <div className="flex items-center justify-between py-3.5 px-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-200/60 dark:group-hover:bg-white/[0.08] transition-colors">
                <Sparkles className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{t('preferences.aiSuggestions', 'AI suggestions')}</p>
                <p className="text-[11.5px] text-zinc-400 dark:text-zinc-500">{t('preferences.aiSuggestionsDesc', 'Proactive tips and recommendations from the AI assistant')}</p>
              </div>
            </div>
            <ToggleSwitch
              checked={aiSuggestions}
              onChange={(v) => handleToggle('contndr_ai_suggestions', v, setAiSuggestions, t('preferences.aiSuggestions', 'AI suggestions'))}
            />
          </div>
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 text-center pt-2 pb-4">
        {t('preferences.footerNote', 'Preferences are saved locally on this device')}
      </p>
    </div>
  );
}

/* ── Premium Toggle Switch ── */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 ${
        checked
          ? 'bg-zinc-900 dark:bg-white'
          : 'bg-zinc-200 dark:bg-white/[0.12]'
      }`}
    >
      <span
        className={`inline-block h-4.5 w-4.5 transform rounded-full transition-all duration-200 ease-in-out shadow-sm ${
          checked
            ? 'translate-x-[22px] bg-white dark:bg-zinc-900'
            : 'translate-x-[3px] bg-white dark:bg-zinc-400'
        }`}
        style={{ width: 18, height: 18 }}
      />
    </button>
  );
}
