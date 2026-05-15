// Rebuild trigger: 2026-03-04 — fix stale dynamic import chunk
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { IntegrationsTab } from './IntegrationsTab';
import { ProfileSettings } from './ProfileSettings';
import { BillingSettings } from './BillingSettings';
import { EmailProviderSettings } from './EmailProviderSettings';
import { SignatureSettings } from './SignatureSettings';
import { KnowledgeBase } from './KnowledgeBase';
import { AIBrain } from './AIBrain';
import { TeamSettings } from './TeamSettings';
import { AffiliateSettings } from './AffiliateSettings';
import { LeadScoringTest } from './LeadScoringTest';
import ApiDiagnostics from './ApiDiagnostics';
import DemoDataManager from './DemoDataManager';
import LeadScoringManager from './LeadScoringManager';
import { WebsiteConnector } from './WebsiteConnector';
import { PreferencesSettings } from './PreferencesSettings';
import { ComplianceSettings } from './ComplianceSettings';
import { AgentModeSettings } from './AgentModeSettings';
import { useTranslation } from 'react-i18next';

// ─── Admin UIDs (supplement email-based checks) ─────────────────────
const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];

type SettingsTab = 'profile' | 'preferences' | 'signature' | 'email' | 'integrations' | 'tracking' | 'knowledge-base' | 'team' | 'affiliate' | 'billing' | 'diagnostics' | 'demo' | 'lead-scoring' | 'compliance' | 'agent-mode';

export function Settings() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [isDemoAccount, setIsDemoAccount] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Auto-switch to email tab when OAuth callback redirects here with query params
  // This ensures EmailProviderSettings mounts and picks up the oauth_email/oauth_error param
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const oauthProvider = params.get('oauth_provider');
      if (oauthProvider && (oauthProvider === 'gmail_rotation' || oauthProvider === 'outlook_rotation')) {
        // Rotation OAuth callback — switch to Email tab (sender rotation is now inside it)
        setActiveTab('email');
      } else if (params.get('oauth_email') || params.get('oauth_error')) {
        setActiveTab('email');
      }
    } catch (_) {}
  }, []);

  // Check if user is demo account and get role
  useEffect(() => {
    const checkUserContext = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsDemoAccount(session?.user?.email === 'demo@contndr.com');
      // Get user role from metadata — only sales_rep and admins see the Affiliate tab
      const role = session?.user?.user_metadata?.role || null;
      const email = session?.user?.email?.toLowerCase().trim();
      // Admins also see the Affiliate tab
      const isAdmin = email === 'admin@contndr.com' || email === 'or@roadr.com' || email === 'or@contndr.com' || ADMIN_UIDS.includes(session?.user?.id);
      setUserRole(isAdmin ? 'admin' : role);
    };
    checkUserContext();
  }, []);

  // Listen for external tab switch requests (e.g. from onboarding)
  useEffect(() => {
    const handleSwitch = (e: CustomEvent) => {
        if (e.detail && typeof e.detail === 'string') {
            // Map old tab names to new ones
            const tab = e.detail as string;
            if (tab === 'stripe' || tab === 'hubspot' || tab === 'calendly' || tab === 'apollo') {
              setActiveTab('integrations');
            } else if (tab === 'tracking' || tab === 'map' || tab === 'web-tracking') {
              setActiveTab('tracking');
            } else if (tab === 'appearance' || tab === 'theme') {
              setActiveTab('preferences');
            } else if (tab === 'sender-rotation') {
              setActiveTab('email');
            } else if (tab === 'warmup' || tab === 'warm-up') {
              setActiveTab('email');
            } else if (tab === 'agent' || tab === 'agent-mode' || tab === 'autopilot') {
              setActiveTab('agent-mode');
            } else {
              setActiveTab(tab as SettingsTab);
            }
        }
    };
    window.addEventListener('switch-settings-tab', handleSwitch as EventListener);
    return () => window.removeEventListener('switch-settings-tab', handleSwitch as EventListener);
  }, []);

  // Affiliate tab is visible to all authenticated users
  const showAffiliateTab = true;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'profile', label: t('settings.profile', 'Profile') },
    { id: 'preferences', label: t('settings.preferences', 'Preferences') },
    { id: 'billing', label: t('settings.billing', 'Billing') },
    { id: 'agent-mode', label: 'Agent Mode' },
    { id: 'email', label: t('settings.email', 'Email') },
    { id: 'signature', label: t('settings.signature', 'Signature') },
    { id: 'integrations', label: t('settings.integrations', 'Integrations') },
    { id: 'tracking', label: t('settings.tracking', 'Tracking') },
    { id: 'knowledge-base', label: t('settings.aiBrain', 'AI Brain') },
    { id: 'team', label: t('settings.team', 'Team') },
    ...(showAffiliateTab ? [{ id: 'affiliate' as SettingsTab, label: t('settings.affiliate', 'Affiliate') }] : []),
    { id: 'compliance', label: t('settings.compliance', 'Compliance') },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/80 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{t('settings.title', 'Settings')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.subtitle', 'Manage your preferences and integrations')}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 py-6 space-y-6 animate-fade-in w-full">
        {/* Tabs */}
        <div className="bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg flex overflow-x-auto scrollbar-hide max-w-full -mx-1 sm:mx-0 px-1 sm:px-1 border border-zinc-200 dark:border-zinc-800" style={{ WebkitOverflowScrolling: 'touch' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 sm:px-4 sm:py-1.5 rounded-md text-[13px] sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${activeTab === tab.id ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}
          >
            {tab.label}
          </button>
        ))}
        {isDemoAccount && (
          <button
            onClick={() => setActiveTab('demo')}
            className={`px-3 py-1.5 sm:px-4 sm:py-1.5 rounded-md text-[13px] sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${activeTab === 'demo' ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}
          >
            {t('settings.demoData', 'Demo Data')}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6 shadow-sm">
        {activeTab === 'profile' && <ProfileSettings />}
        
        {activeTab === 'preferences' && <PreferencesSettings />}
        
        {activeTab === 'email' && <EmailProviderSettings />}

        {activeTab === 'knowledge-base' && <AIBrain />}

        {activeTab === 'integrations' && <IntegrationsTab />}

        {activeTab === 'tracking' && <WebsiteConnector />}

        {activeTab === 'team' && <TeamSettings />}
        
        {activeTab === 'affiliate' && <AffiliateSettings />}
        
        {activeTab === 'billing' && <BillingSettings />}

        {activeTab === 'agent-mode' && <AgentModeSettings />}
        
        {activeTab === 'signature' && <SignatureSettings />}
        
        {activeTab === 'diagnostics' && <ApiDiagnostics />}
        
        {activeTab === 'lead-scoring' && (
          <div className="space-y-6">
            <LeadScoringTest />
            <LeadScoringManager />
          </div>
        )}
        
        {activeTab === 'demo' && isDemoAccount && <DemoDataManager />}

        {activeTab === 'compliance' && <ComplianceSettings />}
      </div>
      </div>
    </div>
  );
}

export default Settings;
