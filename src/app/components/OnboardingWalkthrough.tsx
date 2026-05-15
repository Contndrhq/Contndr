import { useState, useEffect, useCallback } from 'react';
import { Mail, PenTool, Users, Rocket, X, ChevronRight, Check, RefreshCw, Minimize2, Maximize2, Globe } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────
interface OnboardingWalkthroughProps {
  onComplete: () => void;
  currentView: string;
  onNavigate: (view: any) => void;
  initialStep?: number;
}

interface ReadinessStep {
  id: string;
  label: string;
  completed: boolean;
  detail?: string | number;
}

// ─── Step metadata ───────────────────────────────────────────────────────
const STEP_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  signature: PenTool,
  tracking: Globe,
  leads: Users,
  campaign: Rocket,
};

const STEP_TARGETS: Record<string, { targetView: string; settingsTab?: string }> = {
  email: { targetView: 'settings', settingsTab: 'email' },
  signature: { targetView: 'settings', settingsTab: 'signature' },
  tracking: { targetView: 'settings', settingsTab: 'tracking' },
  leads: { targetView: 'lead-finder' },
  campaign: { targetView: 'campaigns' },
};

// ─── Circular Progress ──────────────────────────────────────────────────
function CircularProgress({ percent, isDarkMode, readyLabel }: { percent: number; isDarkMode: boolean; readyLabel: string }) {
  const r = 36;
  const stroke = 5;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative w-[88px] h-[88px] flex items-center justify-center flex-shrink-0">
      <svg width="88" height="88" className="-rotate-90">
        <circle
          cx="44" cy="44" r={r}
          fill="none"
          stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
          strokeWidth={stroke}
        />
        <circle
          cx="44" cy="44" r={r}
          fill="none"
          stroke="#1ED4A7"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-[20px] font-bold leading-none ${
          isDarkMode ? 'text-white' : 'text-zinc-900'
        }`}>{percent}%</span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider mt-0.5 ${
          isDarkMode ? 'text-zinc-600' : 'text-zinc-400'
        }`}>{readyLabel}</span>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────
export function OnboardingWalkthrough({ onComplete, currentView, onNavigate }: OnboardingWalkthroughProps) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<ReadinessStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Labels & descriptions keyed by step id
  const stepLabels: Record<string, string> = {
    email: t('onboardingWalkthrough.stepEmailLabel'),
    signature: t('onboardingWalkthrough.stepSignatureLabel'),
    tracking: t('onboardingWalkthrough.stepTrackingLabel'),
    leads: t('onboardingWalkthrough.stepLeadsLabel'),
    campaign: t('onboardingWalkthrough.stepCampaignLabel'),
  };

  const stepDescs: Record<string, string> = {
    email: t('onboardingWalkthrough.stepEmailDesc'),
    signature: t('onboardingWalkthrough.stepSignatureDesc'),
    tracking: t('onboardingWalkthrough.stepTrackingDesc'),
    leads: t('onboardingWalkthrough.stepLeadsDesc'),
    campaign: t('onboardingWalkthrough.stepCampaignDesc'),
  };

  const stepActions: Record<string, string> = {
    email: t('onboardingWalkthrough.stepEmailAction'),
    signature: t('onboardingWalkthrough.stepSignatureAction'),
    tracking: t('onboardingWalkthrough.stepTrackingAction'),
    leads: t('onboardingWalkthrough.stepLeadsAction'),
    campaign: t('onboardingWalkthrough.stepCampaignAction'),
  };

  const fetchReadiness = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        setLoading(false);
        return;
      }
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/user/onboarding`,
        { headers }
      );
      if (!res.ok) {
        console.error('[ONBOARDING] API error:', res.status);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSteps(data.steps || []);
    } catch (err) {
      console.error('[ONBOARDING] Fetch error:', err);
    } finally {
      setLoading(false);
      if (showRefresh) setTimeout(() => setRefreshing(false), 400);
    }
  }, []);

  useEffect(() => { fetchReadiness(); }, [fetchReadiness]);

  // Refresh on view change (user might have just completed a step)
  useEffect(() => { 
    if (!loading) fetchReadiness(); 
  }, [currentView, fetchReadiness, loading]);

  // Listen for step-completion events (signature saved, email connected, etc.)
  useEffect(() => {
    const handleStepCompleted = () => {
      // Short delay to let the backend persist before we re-fetch
      setTimeout(() => fetchReadiness(true), 600);
    };
    window.addEventListener('onboarding-step-completed', handleStepCompleted);
    window.addEventListener('integration-connected', handleStepCompleted);
    window.addEventListener('profile-updated', handleStepCompleted);
    return () => {
      window.removeEventListener('onboarding-step-completed', handleStepCompleted);
      window.removeEventListener('integration-connected', handleStepCompleted);
      window.removeEventListener('profile-updated', handleStepCompleted);
    };
  }, [fetchReadiness]);

  function navigateTo(stepId: string) {
    const target = STEP_TARGETS[stepId];
    if (!target) return;
    if (target.settingsTab) {
      onNavigate('settings');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: target.settingsTab }));
      }, 100);
    } else {
      onNavigate(target.targetView);
    }
  }

  const completedCount = steps.filter(s => s.completed).length;
  const totalSteps = steps.length || 5;
  const percent = Math.round((completedCount / totalSteps) * 100);
  const stepsRemaining = totalSteps - completedCount;

  // Don't render until we've loaded the data (prevents flash of empty content)
  if (loading || steps.length === 0) return null;

  // Minimized pill view
  if (minimized) {
    return (
      <div className="fixed bottom-6 right-6 z-[60] animate-fade-in">
        <div 
          className={`backdrop-blur-xl rounded-full shadow-2xl overflow-hidden flex items-center gap-3 px-3 py-2 cursor-pointer transition-all hover:scale-[1.02] ${
            isDarkMode 
              ? 'bg-[#050505]/95 border border-zinc-200 dark:border-zinc-800 shadow-black/60' 
              : 'bg-white/95 border border-zinc-200 shadow-zinc-400/20'
          }`}
          onClick={() => setMinimized(false)}
        >
          {/* Mini circular progress */}
          <div className="relative w-[44px] h-[44px] flex items-center justify-center flex-shrink-0">
            <svg width="44" height="44" className="-rotate-90">
              <circle
                cx="22" cy="22" r="18"
                fill="none"
                stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
                strokeWidth="3"
              />
              <circle
                cx="22" cy="22" r="18"
                fill="none"
                stroke="#1ED4A7"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 18}
                strokeDashoffset={2 * Math.PI * 18 - (percent / 100) * 2 * Math.PI * 18}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-[13px] font-bold leading-none ${
                isDarkMode ? 'text-white' : 'text-zinc-900'
              }`}>{percent}</span>
            </div>
          </div>

          {/* Label */}
          <span className={`text-[15px] font-semibold pr-1 ${
            isDarkMode ? 'text-white' : 'text-zinc-900'
          }`}>{t('onboardingWalkthrough.setup')}</span>

          {/* Expand icon */}
          <Maximize2 className={`w-3.5 h-3.5 ${
            isDarkMode ? 'text-zinc-500' : 'text-zinc-400'
          }`} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-[60] w-[340px] max-w-[calc(100vw-2rem)] animate-fade-in">
      <div className={`backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden ${
        isDarkMode 
          ? 'bg-[#050505]/95 border border-zinc-200 dark:border-zinc-800 shadow-black/60' 
          : 'bg-white/95 border border-zinc-200 shadow-zinc-400/20'
      }`}>
        {/* Header */}
        <div className="px-5 pt-4 pb-0">
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-zinc-600' : 'text-zinc-500'
              }`}>{t('onboardingWalkthrough.accountSetup')}</p>
              <h3 className={`text-[17px] font-bold mt-0.5 ${
                isDarkMode ? 'text-white' : 'text-zinc-900'
              }`}>{t('onboardingWalkthrough.setupChecklist')}</h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimized(!minimized)}
                className={`transition-colors p-1 rounded-lg ${
                  isDarkMode 
                    ? 'text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.05]' 
                    : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
                }`}
                title={minimized ? t('onboardingWalkthrough.expand') : t('onboardingWalkthrough.minimize')}
              >
                {minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onComplete}
                className={`transition-colors p-1 rounded-lg ${
                  isDarkMode 
                    ? 'text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.05]' 
                    : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
                }`}
                title={t('onboardingWalkthrough.close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Progress section */}
        <div className="px-5 py-4 flex items-center gap-4">
          <CircularProgress percent={percent} isDarkMode={isDarkMode} readyLabel={t('onboardingWalkthrough.ready')} />
          <p className={`text-[13px] leading-relaxed ${
            isDarkMode ? 'text-zinc-500' : 'text-zinc-600'
          }`}>
            {stepsRemaining > 0 ? (
              <>{t('onboardingWalkthrough.completeStepsText', { count: stepsRemaining, plural: stepsRemaining > 1 ? 's' : '' })}</>
            ) : (
              <span className="text-[#1ED4A7] font-semibold">{t('onboardingWalkthrough.allSet')}</span>
            )}
          </p>
        </div>

        {/* Steps */}
        <div className="px-3 pb-2 space-y-1">
          {steps.map((step, index) => {
            const Icon = STEP_ICONS[step.id];
            const target = STEP_TARGETS[step.id];
            if (!Icon || !target) return null;
            const label = stepLabels[step.id] || step.label;
            const description = stepDescs[step.id] || '';
            const actionLabel = stepActions[step.id] || '';
            
            // Determine if this is the "current" step (first incomplete)
            const isCurrentStep = !step.completed && steps.slice(0, index).every(s => s.completed);

            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                  step.completed
                    ? 'bg-[#1ED4A7]/[0.04] border border-[#1ED4A7]/[0.12]'
                    : isDarkMode
                      ? 'bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800'
                      : 'bg-zinc-50 border border-zinc-200'
                }`}
              >
                {/* Icon */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  step.completed
                    ? 'bg-[#1ED4A7]/[0.08]'
                    : isDarkMode
                      ? 'bg-white/[0.05]'
                      : 'bg-zinc-100'
                }`}>
                  {step.completed ? (
                    <Check className="w-4 h-4 text-[#1ED4A7]" />
                  ) : (
                    <Icon className={`w-4 h-4 ${
                      isDarkMode ? 'text-zinc-400' : 'text-zinc-500'
                    }`} />
                  )}
                </div>

                {/* Label + description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-[13px] font-semibold ${
                      step.completed 
                        ? 'text-[#1ED4A7]' 
                        : isDarkMode 
                          ? 'text-white' 
                          : 'text-zinc-900'
                    }`}>
                      {label}
                    </p>
                    {step.completed && (
                      <span className="text-[9px] font-bold text-[#1ED4A7]/70 uppercase tracking-wider">{t('onboardingWalkthrough.done')}</span>
                    )}
                  </div>
                  <p className={`text-[11px] mt-0.5 truncate ${
                    isDarkMode ? 'text-zinc-600' : 'text-zinc-500'
                  }`}>{description}</p>
                </div>

                {/* Action - only show for current step or completed */}
                {step.completed ? (
                  <Check className="w-4 h-4 text-[#1ED4A7]/50 flex-shrink-0" />
                ) : isCurrentStep ? (
                  <button
                    onClick={() => navigateTo(step.id)}
                    className={`flex items-center gap-1 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0 whitespace-nowrap ${
                      isDarkMode
                        ? 'text-zinc-900 bg-white hover:bg-zinc-100'
                        : 'text-white bg-zinc-900 hover:bg-zinc-800'
                    }`}
                  >
                    {actionLabel}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-3 pb-4 pt-2 flex items-center gap-2">
          <button
            onClick={() => fetchReadiness(true)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 border ${
              isDarkMode
                ? 'bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
            } ${refreshing ? 'animate-spin' : ''}`}
            title={t('onboardingWalkthrough.refreshStatus')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${
              isDarkMode ? 'text-zinc-500' : 'text-zinc-600'
            }`} />
          </button>
          <button
            onClick={onComplete}
            className={`flex-1 flex items-center justify-center gap-2 text-[13px] font-semibold rounded-lg py-2.5 transition-colors border ${
              isDarkMode
                ? 'text-zinc-500 hover:text-zinc-300 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                : 'text-zinc-600 hover:text-zinc-900 bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
            }`}
          >
            {t('onboardingWalkthrough.skipForNow')}
            <span className="text-[14px]">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default OnboardingWalkthrough;
