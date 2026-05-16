// Rebuild: 2026-02-28T02:00 — added AffiliatePortal route + external affiliate guard
// Rebuild: 2026-02-28T03:00 — force recompile after Supabase client fix + RoleManagement null checks
// Rebuild: 2026-03-02T10:00 — force rebuild to fix stale module import cache after Gemini model update
// Rebuild: 2026-03-02T11:30 — aggressive cache clear for chunk loading failures
// Rebuild: 2026-03-03T09:00 — force recompile after Dashboard stat card cleanup
// Rebuild: 2026-03-16T12:00 — force rebuild after i18n HotLeads + Autopilot translation
// Rebuild: 2026-03-05T12:00 — force recompile after removing Apollo logo_url from CompanyLogo brand tier
// Rebuild: 2026-03-07T01:00 — force recompile after signature + toast close button fixes
// Rebuild: 2026-03-07T02:00 — social engagement tracking + cron worker
// Rebuild: 2026-03-07T03:00 — force recompile for EngagementOverview component resolution
// Rebuild: 2026-03-11T00:00 — force recompile after HeroWorkflow update (Pipeline, Intent, Team, Revenue views)
// Rebuild: 2026-03-11T01:00 — AI Calls plan gating (Growth/Enterprise only) + NavButton locked prop
// Rebuild: 2026-03-12T01:00 — Social Tracker rewrite (replaced Social Post Syncer with profile tracker)
// Rebuild: 2026-03-13T01:00 — force recompile after SocialSyncer chart duplicate key fix
// Rebuild: 2026-03-13T02:00 — dark-only theme conversion + social preload map + module import fix
// Rebuild: 2026-03-13T03:00 — force recompile after SocialSyncer tab switcher style update
// Rebuild: 2026-03-13T04:00 — force recompile: SerpAPI displayed_link follower parsing + SocialSyncer profile-found message
// Rebuild: 2026-03-13T05:00 — fix module import error: removed nested lazy loading in SocialSyncer
// Rebuild: 2026-03-13T06:00 — temporary: disabled SocialPublisher import to isolate module resolution issue
// Rebuild: 2026-03-13T07:00 — minimal SocialSyncer to test if file can be imported at all
// Rebuild: 2026-03-13T08:00 — restored full SocialSyncer with direct SocialPublisher import (no nested lazy, no recharts)
// Rebuild: 2026-03-13T09:00 — enhanced social tracker metric extraction + platform metrics display
// Rebuild: 2026-03-13T10:00 — removed recharts from SocialSyncer chunk (replaced with pure SVG chart) to fix module import error
// Rebuild: 2026-03-13T11:00 — force recompile: SocialSyncer empty state redesign + SocialPublisher logo imports
// Rebuild: 2026-03-13T12:00 — fix module import error after theme system restoration
// Rebuild: 2026-03-13T13:00 — default export fixes for dynamic module imports
// Rebuild: 2026-03-14T01:00 — fix module import error: removed mapbox CSS @import from globals.css + cleaned ?v= from entry script
// Rebuild: 2026-03-15T01:00 — comprehensive i18n translations for ES/PT across all components
// Rebuild: 2026-03-16T01:00 — LocationPicker i18n: added location picker translation keys + fixed hardcoded strings
// Rebuild: 2026-03-17T01:00 — force recompile after WebTrackingSetup + TeamSettings i18n completion (stale module cache)
// Rebuild: 2026-03-18T01:00 — force recompile after activity feed i18n + auth email_exists fix + close button visibility
// Rebuild: 2026-03-18T13:00 — fix module import script error
// Rebuild: 2026-03-18T14:00 — fix send-batch partial cleanup logic
// Rebuild: 2026-03-17T02:00 — force recompile after CreatorFinder full i18n translation
// Rebuild: 2026-03-17T02:00 — force recompile after OAuthOnboarding + PendingAccess + ApprovedAccess + WaitlistModal i18n + landing page removal (stale module cache)
// Rebuild: 2026-03-17T03:00 — deleted LandingPage.tsx + all landing/ sub-components to reduce bundle size; app starts from AuthScreen
// Rebuild: 2026-03-17T04:00 — force recompile after Back-to-Home redirect fix (contndr.com external navigation)
// Rebuild: 2026-03-17T05:00 — force recompile after CompanySearch table headers + pagination i18n translation
// Rebuild: 2026-03-17T06:00 — performance: lazy-load AIAssistant+AutomationScheduler, remove DB gate, memo NavButton
// Rebuild: 2026-03-17T07:00 — App.tsx i18n: replaced all hardcoded English with t() calls + added app section to ES/PT locales
// Rebuild: 2026-03-17T08:00 — palette cleanup: replaced all orange with amber across 9 components for premium consistency
// Rebuild: 2026-03-18T12:00 — trigger rebuild
// Rebuild: 2026-03-02T10:01 — force rebuild to fix stale module import cache
// Rebuild: 2026-03-21T15:00 — fix module import error after button centering + CompanySearch styling updates
// Rebuild: 2026-03-30T16:00 — fix CORS lazy load errors by converting critical components to eager imports
import React, { useState, useEffect, useRef, useCallback, lazy, Suspense, startTransition, useMemo } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { AnimatePresence } from 'motion/react';
import { SplashScreen } from './components/SplashScreen';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useSearchParams, BrowserRouter } from 'react-router';
import { toast, Toaster } from 'sonner';
import './lib/i18n';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './components/LoadingSpinner';
import { MobileNav } from './components/MobileNav';
import { supabase } from './lib/supabase';
import { Home, Users, Mail, BarChart3, TrendingUp, Settings as SettingsIcon, Phone, Plus, LogOut, Zap, DollarSign, Inbox, Send, X, Search, PlayCircle, Trophy, GitBranch, PanelLeftClose, PanelLeftOpen, ChevronsRight, ArrowRight, Lock, Globe } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LazyLoadErrorBoundary } from './components/LazyLoadErrorBoundary';
import { AuthScreen } from './components/AuthScreen';
import { ImpersonationBanner } from './components/ImpersonationBanner';
import { ConfirmProvider } from './components/ConfirmDialog';
import { PendingAccessScreen } from './components/PendingAccessScreen';
import { OAuthOnboardingScreen } from './components/OAuthOnboardingScreen';
import { ApprovedAccessScreen } from './components/ApprovedAccessScreen';
import { ContndrLogo } from './components/ContndrLogo';
import { ContndrSymbol } from './components/ContndrSymbol';
import { blogPosts } from './data/blog-posts';
import { UpgradeModal } from './components/UpgradeModal';
// StructuredData removed — landing page moved to separate contndr.com site
// LandingPage + all landing/ sub-components deleted from disk — bundle size reduction
import { useFavicon } from './components/FaviconHandler';
import { projectId } from './utils/supabase/info';
import { getAuthHeaders, authenticatedFetch } from './lib/auth';
import { fetchWithTimeout, fetchWithRetry, isNetworkError, getFriendlyErrorMessage } from './lib/fetch-utils';
import { apiCache } from './lib/api-cache';
import { useCampaignMonitor } from './lib/campaign-monitor';
import { BroadcastProvider } from './components/BroadcastContext';
import { BroadcastOverlay } from './components/BroadcastOverlay';
import { ImportBroadcastProvider } from './components/ImportBroadcastContext';
import demoAvatarImg from 'figma:asset/8a2d2f88d49885cd220cf7f8a21620f538bacb88.png';
import { ImportBroadcastOverlay } from './components/ImportBroadcastOverlay';
import { RealtimeProvider } from './components/RealtimeProvider';
import { AskAIButton } from './components/AskAIButton';
import { AdminEventToasts } from './components/AdminEventToasts';
import { DemoContext } from './components/DemoContext';
import { FloatingDemoCTA } from './components/FloatingDemoCTA';
import { CurrencyProvider } from './lib/CurrencyContext';
import { isNativeApp, sendNativeMessage } from './lib/ios-native-bridge';
import {
  DashboardSkeleton,
  CRMSkeleton,
  CampaignsSkeleton,
  AnalyticsSkeleton,
  InboxSkeleton,
  SettingsSkeleton,
  AiCallsSkeleton,
  RevenueSkeleton,
  PipelineSkeleton,
  IntentSkeleton,
  TeamSkeleton,
  AutomationsSkeleton,
  LeadFinderSkeleton,
  GenericSkeleton,
} from './components/SkeletonLoaders';
import { QuickSearch } from './components/QuickSearch';
import { DatabaseSetup } from './components/DatabaseSetup';

// ── Eager imports for critical components (fixes CORS lazy load errors) ────
// CORS Issue Fix: 2026-03-30 - Figma Make's iframe environment blocks dynamic chunk loading
// with "Cross-origin script load denied by Cross-Origin Resource Sharing policy" errors.
// Converting these high-priority components to eager imports bundles them in the main chunk,
// eliminating the cross-origin fetch that was causing failures. Other components remain lazy.
import { AIAssistant } from './components/AIAssistant';
import { Dashboard } from './components/Dashboard';
import { AutomationScheduler } from './components/AutomationScheduler';

// ���── Admin UIDs (supplement email-based checks) ─────────────────────
const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];
const isAdminUid = (uid?: string) => !!uid && ADMIN_UIDS.includes(uid);

// Helper to retry failed dynamic imports (handles chunk loading failures)
// Automatically resolves both default and named exports — pass the component name to
// resolve named exports when no default export exists.
// v2: 2026-03-03T15:00 — forced rebuild to clear persistent stale module cache
const lazyRetry = (importFn: () => Promise<any>, componentName: string, retries = 3): Promise<{ default: any }> => {
  return new Promise((resolve, reject) => {
    importFn()
      .then((module) => {
        // 1. Module already has a default export — use it
        if (module && module.default) {
          resolve(module);
          return;
        }
        // 2. Look for a named export matching the component name
        if (module && typeof module[componentName] === 'function') {
          resolve({ default: module[componentName] });
          return;
        }
        // 3. Fallback: pick the first exported function
        if (module) {
          const keys = Object.keys(module).filter(k => k !== '__esModule');
          for (const key of keys) {
            if (typeof module[key] === 'function') {
              console.warn(`[LAZY LOAD] ${componentName}: using fallback export "${key}"`);
              resolve({ default: module[key] });
              return;
            }
          }
        }
        // Nothing usable found
        const available = module ? Object.keys(module).join(', ') : 'module is null';
        console.error(`[LAZY LOAD] ${componentName}: no valid export found. Available exports: ${available}`);
        reject(new Error(`Module "${componentName}" resolved with no usable export. Available: ${available}`));
      })
      .catch((error) => {
        // Check if this is a chunk loading error
        const isChunkError = error.name === 'ChunkLoadError' || 
                             error.message?.includes('Failed to fetch dynamically imported module') ||
                             error.message?.includes('Importing a module script failed');
        
        console.error(`[LAZY LOAD] Error loading ${componentName}:`, {
          errorName: error.name,
          errorMessage: error.message,
          isChunkError,
          retriesLeft: retries,
          stack: error.stack,
        });
        
        if (retries > 0 && isChunkError) {
          console.warn(`[LAZY LOAD] Retrying ${componentName} (${retries} attempts left)...`);
          // Longer delay to allow for any network/bundler issues to clear
          setTimeout(() => {
            lazyRetry(importFn, componentName, retries - 1).then(resolve, reject);
          }, 1500);
        } else {
          console.error(`[LAZY LOAD] Failed to load ${componentName} after all retries:`, error);
          // If it's a chunk error after all retries, suggest hard refresh
          if (isChunkError) {
            console.error(`[LAZY LOAD] Try clearing cache and hard refreshing (Ctrl+Shift+R or Cmd+Shift+R)`);
          }
          reject(error);
        }
      });
  });
};

// ─── Lazy-loaded dashboard views (code-split for fast initial load) ─────
// Updated: 2026-03-13b - Rebuild trigger: dark-only theme + social preload + module import fix
// Updated: 2026-03-07 - Rebuild trigger: email signature for manual compose + toast close button fix
// Updated: 2026-03-05b - Rebuild trigger: brand validation guards (domain redirect + name mismatch) + KV cache v2
// Updated: 2026-03-05 - Rebuild trigger: KV retry hardening + company logo unification
// Updated: 2026-03-04 - Rebuild trigger: fix stale dynamic imports for Revenue, Settings, AdminDashboard
// Updated: 2026-03-02T11:30 - Added cache-busting version parameters to all imports
// Updated: 2026-03-02 - Rebuild trigger: fix stale CRM dynamic import chunk
// Updated: 2026-02-27 - Rebuild trigger v2: fix stale dynamic import cache after CPU exceeded + social query changes
// Updated: 2026-02-23 - Added export default to all 33 lazily-loaded components
// Updated: 2026-02-23 - Fixed search pipeline stale closure + fallback threshold (ApolloProSearch)
// Updated: 2026-02-26 - Rebuild trigger: fix stale dynamic imports (Revenue, BuyingIntent)
// Updated: 2026-02-26 - Rebuild trigger: OnboardingWalkthrough visual restore
// Updated: 2026-02-23 - Fixed: removed .then() chains; lazyRetry now auto-resolves named exports
// Updated: 2026-02-23 - Rebuild trigger after legal page updates (PrivacyPolicy, TermsOfService)
// Updated: 2026-02-22 - Triggered rebuild to fix dynamic import chunks (UnifiedInbox, LeadFinder)
// Updated: 2026-02-20 - Improved chunk loading for large components (CRM is 3130 lines)
// Updated: 2026-02-18 - Triggered rebuild to fix dynamic imports
// Updated: 2026-02-14 - Added retry logic for chunk loading failures
// Removed ?v= cache-busting params — they cause duplicate module instances in Vite,
// breaking shared React context (Router, etc.). Vite handles cache invalidation natively.
// PERFORMANCE: 2026-03-14 - Converted ALL components to lazy loading for 70%+ faster initial load
// REBUILD: 2026-03-17T18:00 - force module graph recompile after perf optimizations (lazy AIAssistant/AutomationScheduler)
// REBUILD: 2026-03-30T16:00 - Converted AIAssistant, Dashboard, AutomationScheduler to eager imports (fixes CORS errors in iframe)

// ─── Lazy-loaded components (code-split for performance) ───────────────────
const CRM = lazy(() => lazyRetry(() => import('./components/CRM'), 'CRM'));
const CampaignsView = lazy(() => lazyRetry(() => import('./components/CampaignsView'), 'CampaignsView'));
const UnifiedInbox = lazy(() => lazyRetry(() => import('./components/UnifiedInbox'), 'UnifiedInbox'));
const AdvancedAnalytics = lazy(() => lazyRetry(() => import('./components/AdvancedAnalytics'), 'AdvancedAnalytics'));
const Revenue = lazy(() => lazyRetry(() => import('./components/Revenue'), 'Revenue'));
const Settings = lazy(() => lazyRetry(() => import('./components/Settings'), 'Settings'));
const AICalls = lazy(() => lazyRetry(() => import('./components/AICalls'), 'AICalls'));
const AdminDashboard = lazy(() => lazyRetry(() => import('./components/AdminDashboard'), 'AdminDashboard'));
const AutomationManager = lazy(() => lazyRetry(() => import('./components/AutomationManager'), 'AutomationManager'));
const TeamLeaderboard = lazy(() => lazyRetry(() => import('./components/TeamLeaderboard'), 'TeamLeaderboard'));
const Pipeline = lazy(() => lazyRetry(() => import('./components/Pipeline'), 'Pipeline'));
const BuyingIntent = lazy(() => lazyRetry(() => import('./components/BuyingIntent'), 'BuyingIntent'));
const EmailsView = lazy(() => lazyRetry(() => import('./components/EmailsView'), 'EmailsView'));
const ScheduledMeetings = lazy(() => lazyRetry(() => import('./components/ScheduledMeetings'), 'ScheduledMeetings'));
const FollowUpManager = lazy(() => lazyRetry(() => import('./components/FollowUpManager'), 'FollowUpManager'));

// Lazy-loaded modals (only loaded when opened)
const CampaignBuilder = lazy(() => lazyRetry(() => import('./components/CampaignBuilder'), 'CampaignBuilder'));
const AICallCampaignBuilder = lazy(() => lazyRetry(() => import('./components/AICallCampaignBuilder'), 'AICallCampaignBuilder'));
const TelnyxPhoneNumbers = lazy(() => lazyRetry(() => import('./components/TelnyxPhoneNumbers'), 'TelnyxPhoneNumbers'));
const OnboardingWalkthrough = lazy(() => lazyRetry(() => import('./components/OnboardingWalkthrough'), 'OnboardingWalkthrough'));

// Lazy-loaded lead finder (medium-heavy component)
const LeadFinder = lazy(() => lazyRetry(() => import('./components/LeadFinder'), 'LeadFinder'));

// Lazy-loaded public pages
// LandingPage removed — app.contndr.com starts from auth screen; landing page lives on contndr.com separately
const BlogIndex = lazy(() => lazyRetry(() => import('./components/blog/BlogIndex'), 'BlogIndex'));
const BlogPostView = lazy(() => lazyRetry(() => import('./components/blog/BlogPostView'), 'BlogPostView'));
const PrivacyPolicy = lazy(() => lazyRetry(() => import('./components/legal/PrivacyPolicy'), 'PrivacyPolicy'));
const TermsOfService = lazy(() => lazyRetry(() => import('./components/legal/TermsOfService'), 'TermsOfService'));
const AboutUs = lazy(() => lazyRetry(() => import('./components/pages/AboutUs'), 'AboutUs'));
const Security = lazy(() => lazyRetry(() => import('./components/pages/Security'), 'Security'));
const Contact = lazy(() => lazyRetry(() => import('./components/pages/Contact'), 'Contact'));
const Careers = lazy(() => lazyRetry(() => import('./components/pages/Careers'), 'Careers'));
const SalesforceOAuthCallback = lazy(() => lazyRetry(() => import('./components/SalesforceOAuthCallback'), 'SalesforceOAuthCallback'));
const HubSpotOAuthCallback = lazy(() => lazyRetry(() => import('./components/HubSpotOAuthCallback'), 'HubSpotOAuthCallback'));
const SlackOAuthCallback = lazy(() => lazyRetry(() => import('./components/SlackOAuthCallback'), 'SlackOAuthCallback'));
const QuickBooksOAuthCallback = lazy(() => lazyRetry(() => import('./components/QuickBooksOAuthCallback'), 'QuickBooksOAuthCallback'));
const SocialOAuthCallback = lazy(() => lazyRetry(() => import('./components/SocialOAuthCallback'), 'SocialOAuthCallback'));

// Lazy-loaded rare/utility components
const AccessDebugger = lazy(() => lazyRetry(() => import('./components/AccessDebugger'), 'AccessDebugger'));
const AcceptInviteHandler = lazy(() => lazyRetry(() => import('./components/AcceptInviteHandler'), 'AcceptInviteHandler'));
const AffiliateRedirect = lazy(() => lazyRetry(() => import('./components/AffiliateRedirect'), 'AffiliateRedirect'));
const AffiliatePortal = lazy(() => lazyRetry(() => import('./components/AffiliatePortal'), 'AffiliatePortal'));

// Lazy-loaded dev tools (only loaded when toggled)
const CacheDevTools = lazy(() => lazyRetry(() => import('./components/CacheDevTools'), 'CacheDevTools'));

// Eagerly loaded lightweight components (kept synchronous — small bundles)

// ─── Server warmup: ensure the edge function is warm before firing prefetches ──
// Cold-starts can take several seconds; sending a lightweight /ping first avoids
// a stampede of "Failed to fetch" retries from parallel prefetch calls.
let _serverWarm: Promise<void> | null = null;

function ensureServerWarm(): Promise<void> {
  if (_serverWarm) return _serverWarm;
  _serverWarm = (async () => {
    // Skip pings when device is offline — avoids flooding "hostname not found" console errors
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.log('[WARM] Device offline — skipping server ping');
      return;
    }
    const url = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ping`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (res.ok) return; // server is warm
      } catch {
        // expected on cold-start — wait and retry
      }
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
      }
    }
    // Even if all pings failed, let prefetches proceed (they have their own retries)
  })();
  return _serverWarm;
}

// ─── Preloader: eagerly fetch chunks for views the user is likely to visit next ──
/** Fire-and-forget: prefetch dashboard data into apiCache so it's warm before the component mounts */
async function prefetchDashboardData() {
  try {
    // Skip if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    await ensureServerWarm();
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;

    const cacheKey = `dashboard:data:${userId}:all`;
    // Only prefetch if not already fresh
    const existing = apiCache.get(cacheKey);
    if (existing && !existing.isStale) return;

    const headers = await getAuthHeaders();
    if (!headers.Authorization) return;

    // Prefetch the combined dashboard stats endpoint (replaces old individual /leads/count prefetch)
    // This warms the same cache key that Dashboard.tsx reads from, so it mounts with data instantly.
    apiCache.prefetch(cacheKey, async () => {
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/dashboard/stats?brand=all`,
        { signal: AbortSignal.timeout(25000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 120_000 });
  } catch {
    // Prefetch is best-effort — silently ignore errors
  }
}

const viewPreloadMap: Record<string, () => void> = {
  dashboard: () => {
    prefetchDashboardData();
  },
  crm: () => {
    // Prefetch CRM leads page 1 alongside the JS chunk
    apiCache.prefetch('crm:leads:p1', async () => {
      await ensureServerWarm();
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return null;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads?page=1&per_page=100`,
        { headers, signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 120_000 });
    // Also prefetch filter options (lightweight)
    apiCache.prefetch('crm:filter-options', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/filter-options`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 60_000, cacheTime: 300_000 });
    // Also prefetch bounced count (lightweight)
    apiCache.prefetch('crm:bounced-count', async () => {
      await ensureServerWarm();
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return null; // Not authenticated yet — skip
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bounced-count`,
        { headers, signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 120_000 });
  },
  'lead-finder': () => {},
  campaigns: () => {
    // Prefetch campaigns data alongside the JS chunk
    apiCache.prefetch('campaigns:list', async () => {
      await ensureServerWarm();
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return null;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns`,
        { headers, signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 15_000, cacheTime: 60_000 });
    // Prefetch first page of campaign-builder leads so "Select Leads" step loads fast
    // Full pagination is handled by CampaignBuilder's server-side fetching
    apiCache.prefetch('campaign-builder:leads:page1', async () => {
      await ensureServerWarm();
      const lightFields = 'id,business_name,contact_name,email,category,city,state,country,last_contacted,bounced,status';
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads?page=1&per_page=200&contacted=all&skip_stats=true&fields=${lightFields}`,
        { signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return await res.json();
    }, { staleTime: 60_000, cacheTime: 300_000 });
  },
  inbox: () => {
    // Prefetch inbox threads (heaviest endpoint — warm it eagerly)
    apiCache.prefetch('inbox:threads:all', async () => {
      await ensureServerWarm();
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return null;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/inbox`,
        { headers, signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 20_000, cacheTime: 120_000 });
    // Prefetch inbox stats (lightweight)
    apiCache.prefetch('inbox:stats', async () => {
      await ensureServerWarm();
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return null;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/inbox/stats`,
        { headers, signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 180_000 });
  },
  analytics: () => {
    // Prefetch analytics overview data alongside the JS chunk
    apiCache.prefetch('analytics:overview', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/analytics/overview`,
        { signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 60_000, cacheTime: 300_000 });
  },
  settings: () => {
    // Prefetch settings data (team + signature) alongside the JS chunk
    apiCache.prefetch('settings:team', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team`,
        { signal: AbortSignal.timeout(25000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 60_000, cacheTime: 300_000 });
    apiCache.prefetch('settings:signature', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/settings/signature`,
        { signal: AbortSignal.timeout(25000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 60_000, cacheTime: 300_000 });
  },
  automations: () => {
    apiCache.prefetch('automations:rules', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/automation/rules`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 120_000 });
  },
  'ai-calls': () => {
    apiCache.prefetch('ai-calls:campaigns', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-call-campaigns`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 20_000, cacheTime: 120_000 });
  },
  revenue: () => {
    // Prefetch stripe config + revenue metrics in parallel (brand=all default)
    apiCache.prefetch('settings:stripe-config', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/settings/stripe-config`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 60_000, cacheTime: 300_000 });
    // Warm all three parallel Revenue fetches at once
    Promise.all([
      apiCache.prefetch('revenue:metrics:default', async () => {
        await ensureServerWarm();
        const res = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/revenue/metrics?brand=default`,
          { signal: AbortSignal.timeout(25000) }
        );
        if (!res.ok) throw new Error('Prefetch failed');
        return res.json();
      }, { staleTime: 30_000, cacheTime: 120_000 }),
      apiCache.prefetch('revenue:funnel:default', async () => {
        await ensureServerWarm();
        const res = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/revenue/funnel?brand=default`,
          { signal: AbortSignal.timeout(25000) }
        );
        if (!res.ok) throw new Error('Prefetch failed');
        return res.json();
      }, { staleTime: 30_000, cacheTime: 120_000 }),
      apiCache.prefetch('revenue:payments:default', async () => {
        await ensureServerWarm();
        const res = await authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/revenue/payments?brand=default`,
          { signal: AbortSignal.timeout(25000) }
        );
        if (!res.ok) throw new Error('Prefetch failed');
        return res.json();
      }, { staleTime: 30_000, cacheTime: 120_000 }),
    ]).catch(() => {/* best-effort */});
  },
  admin: () => {},
  team: () => {
    apiCache.prefetch('team:leaderboard', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/leaderboard`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 120_000, cacheTime: 600_000 });
    apiCache.prefetch('sales:leaderboard', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/sales-leaderboard`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 120_000, cacheTime: 600_000 });
  },
  intent: () => {
    apiCache.prefetch('intent:dashboard', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/intent/dashboard`,
        { signal: AbortSignal.timeout(25000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 120_000 });
  },
  pipeline: () => {
    // Prefetch deals + metrics in parallel
    apiCache.prefetch('pipeline:deals', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/pipeline/deals`,
        { signal: AbortSignal.timeout(25000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 120_000 });
    apiCache.prefetch('pipeline:metrics', async () => {
      await ensureServerWarm();
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/pipeline/metrics`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) throw new Error('Prefetch failed');
      return res.json();
    }, { staleTime: 30_000, cacheTime: 120_000 });
  },
};

/** Preload a view's JS chunk on hover/focus */
function preloadView(view: string) {
  viewPreloadMap[view]?.();
}

/** Eagerly prefetch adjacent views the user is likely to visit next */
const _prefetchedViews = new Set<string>();
function prefetchAdjacentViews(current: string) {
  // Don't prefetch if offline — prevents "hostname not found" flood in iOS webview
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const adj: Record<string, string[]> = {
    dashboard: ['crm', 'campaigns', 'inbox', 'analytics', 'revenue'],
    crm: ['campaigns', 'pipeline', 'lead-finder', 'inbox'],
    campaigns: ['crm', 'inbox', 'ai-calls'],
    inbox: ['crm', 'campaigns', 'analytics'],
    analytics: ['dashboard', 'campaigns', 'revenue'],
    pipeline: ['crm', 'campaigns', 'intent', 'revenue'],
    intent: ['pipeline', 'crm', 'analytics'],
    'lead-finder': ['crm', 'campaigns'],
    'ai-calls': ['campaigns', 'crm'],
    revenue: ['dashboard', 'analytics', 'pipeline'],
    team: ['dashboard', 'analytics'],
    automations: ['campaigns', 'crm'],
    settings: ['dashboard'],
  };
  const views = (adj[current] || []).filter(v => !_prefetchedViews.has(v));
  if (views.length === 0) return;
  const schedule = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 150);
  schedule(() => { views.forEach(v => { _prefetchedViews.add(v); viewPreloadMap[v]?.(); }); });
}

// Skeleton map for Suspense fallbacks per view
const viewSkeletonMap: Record<string, React.ReactNode> = {
  dashboard: <DashboardSkeleton />,
  crm: <CRMSkeleton />,
  'lead-finder': <LeadFinderSkeleton />,
  campaigns: <CampaignsSkeleton />,
  inbox: <InboxSkeleton />,
  analytics: <AnalyticsSkeleton />,
  settings: <SettingsSkeleton />,
  automations: <AutomationsSkeleton />,
  'ai-calls': <AiCallsSkeleton />,
  revenue: <RevenueSkeleton />,
  admin: <GenericSkeleton />,
  team: <TeamSkeleton />,
  pipeline: <PipelineSkeleton />,
  intent: <IntentSkeleton />,
  emails: <InboxSkeleton />,
  meetings: <GenericSkeleton />,
  'follow-ups': <AutomationsSkeleton />,
};

// Suppress known harmless Supabase auth warnings
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.warn = (...args: any[]) => {
  // Fast path: only check first arg (string) to avoid expensive join on every call
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (first.includes('Refresh Token Not Found') || 
      first.includes('Invalid Refresh Token') ||
      first.includes('refresh_token') ||
      first.includes('No auth token available')) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

console.error = (...args: any[]) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (first.includes('Refresh Token Not Found') || 
      first.includes('Invalid Refresh Token')) {
    return;
  }
  originalConsoleError.apply(console, args);
};

// Theme: reads stored preference (defaults to dark for Contndr brand)
const getIsDark = (): boolean => {
  const stored = localStorage.getItem('theme');
  if (stored === 'light') return false;
  if (stored === 'dark') return true;
  if (stored === 'system') {
    // Follow OS preference when explicitly set to system
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // Default to dark when no preference has been set (Contndr brand default)
  return true;
};

// Apply theme to DOM (used on load + when user changes preference)
const applyThemeToDOM = (dark: boolean) => {
  const themeColor = dark ? '#050505' : '#F9FAFB';
  const updateMeta = (name: string, content: string) => {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };
  updateMeta('theme-color', themeColor);
  updateMeta('apple-mobile-web-app-status-bar-style', dark ? 'black-translucent' : 'default');
  updateMeta('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  document.documentElement.style.backgroundColor = themeColor;
  document.body.style.backgroundColor = themeColor;
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

// Run once on load
applyThemeToDOM(getIsDark());

// AccessDebugger, AcceptInviteHandler, AffiliateRedirect are lazy-loaded above

// ─── Cross-origin affiliate ref capture ────────────────────────────
// When the marketing site (contndr.com) redirects to app.contndr.com?ref=slug,
// sessionStorage from the /r/:slug route is lost (different origin).
// Capture ?ref= on ANY page load and persist it so signup can attribute it.
try {
  const _qRef = new URLSearchParams(window.location.search).get('ref');
  if (_qRef) {
    sessionStorage.setItem('contndr_affiliate_ref', _qRef);
    console.log('[AFFILIATE] Captured ref from query param:', _qRef);
    // Clean the URL without triggering a reload
    const _url = new URL(window.location.href);
    _url.searchParams.delete('ref');
    window.history.replaceState({}, '', _url.pathname + _url.search + _url.hash);
  }
} catch {
  // sessionStorage or URL API not available — ignore
}

type View = 'dashboard' | 'crm' | 'lead-finder' | 'campaigns' | 'inbox' | 'revenue' | 'analytics' | 'ai-calls' | 'automations' | 'settings' | 'admin' | 'team' | 'pipeline' | 'intent' | 'emails' | 'meetings' | 'follow-ups';

const VALID_VIEWS: View[] = ['dashboard', 'crm', 'lead-finder', 'campaigns', 'inbox', 'revenue', 'analytics', 'ai-calls', 'automations', 'settings', 'admin', 'team', 'pipeline', 'intent', 'emails', 'meetings', 'follow-ups'];

// ─── Helper route components ───────────────────────────────────────

/** Renders the /auth route — reads ?mode= from search params */
function AuthRoute({ user, onAuthSuccess }: { user: any; onAuthSuccess: (s: any) => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = (searchParams.get('mode') as 'signin' | 'signup') || 'signin';
  const redirect = searchParams.get('redirect');

  if (user) {
    return <Navigate to={redirect || '/app'} replace />;
  }

  return (
    <AuthScreen 
      onAuthSuccess={onAuthSuccess}
      onBack={() => window.location.href = 'https://contndr.com'}
      initialMode={mode}
    />
  );
}

/** Renders /blog/:slug — reads slug param and resolves the blog post */
function BlogPostRoute({ onNavigate, onLogin, onGetStarted }: { onNavigate: (p: string) => void; onLogin: () => void; onGetStarted: () => void }) {
  const { slug } = useParams<{ slug: string }>();
  const post = blogPosts.find(p => p.slug === slug);
  if (!post) return <Navigate to="/blog" replace />;
  return <BlogPostView post={post} onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted} />;
}

function CampaignsRedirect() {
  const { id } = useParams();
  return <Navigate to={`/app/campaigns/${id}`} replace />;
}

// ─── Main App ──────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <BroadcastProvider>
        <ImportBroadcastProvider>
          <ConfirmProvider>
            <ImpersonationBanner />
            <AppContent />
          </ConfirmProvider>
        </ImportBroadcastProvider>
      </BroadcastProvider>
    </BrowserRouter>
  );
}

function AppContent() {
  // Build fingerprint — changed to force Vite to invalidate stale chunks after file deletions
  void '2026-03-21T00:00';
  const { t, i18n } = useTranslation();
  useFavicon();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Demo mode — renders the real dashboard shell with no auth required ──
  const isDemoMode = location.pathname === '/demo' || location.pathname.startsWith('/demo/');

  // Fake user object for demo mode so the dashboard shell renders identically
  const DEMO_USER = useMemo(() => ({
    id: 'demo-sandbox-user',
    email: 'demo@contndr.com',
    user_metadata: { name: 'Alex Demo', email: 'demo@contndr.com', avatar_url: demoAvatarImg },
  }), []);

  // ── Derive dashboard view from URL path ──
  const deriveCurrentView = (pathname: string): View => {
    if (pathname.startsWith('/app/')) {
      const segment = pathname.slice(5).split('/')[0]; // strip '/app/' and get first part
      if (VALID_VIEWS.includes(segment as View)) return segment as View;
    }
    if (pathname.startsWith('/demo/')) {
      const segment = pathname.slice(6).split('/')[0]; // strip '/demo/' and get first part
      if (VALID_VIEWS.includes(segment as View)) return segment as View;
    }
    return 'dashboard';
  };
  const currentView: View = deriveCurrentView(location.pathname);

  // Drop-in replacement for the old setCurrentView — now navigates
  // Uses startTransition so the outgoing view stays rendered until the new chunk is ready
  const setCurrentView = useCallback((view: View) => {
    const prefix = isDemoMode ? '/demo' : '/app';
    startTransition(() => {
      navigate(`${prefix}/${view}`);
    });
  }, [navigate, isDemoMode]);

  // ── Auth / global state ──
  const [minSplashDone, setMinSplashDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const silentSignOutRef = useRef(false); // Tracks stale-token cleanups to suppress toast
  const [isDark, setIsDark] = useState(getIsDark());
  const [subscriptionStatus, setSubscriptionStatus] = useState<any>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isUpgradeForced, setIsUpgradeForced] = useState(false);
  const [isRecheckingSubscription, setIsRecheckingSubscription] = useState(false);
  const [showAccessDebugger, setShowAccessDebugger] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [hasCheckedOnboarding, setHasCheckedOnboarding] = useState(false);

  // ── Prefetch adjacent views when the current view stabilizes ──
  useEffect(() => {
    // Skip prefetching in demo mode (no real auth) or before session is established
    if (isDemoMode || !user) return;
    prefetchAdjacentViews(currentView);
  }, [currentView, isDemoMode, user]);

  // ── Global campaign monitor: auto-resumes stuck campaigns & processes retries ──
  // Runs regardless of which view is active. Pauses when offline or tab hidden.
  useCampaignMonitor(user?.id || null, isDemoMode);

  // ── Dashboard-specific state ──
  const [showCampaignBuilder, setShowCampaignBuilder] = useState(false);
  const [showAICallBuilder, setShowAICallBuilder] = useState(false);
  const [showPhoneNumbers, setShowPhoneNumbers] = useState(false);
  const [preselectedLeadIds, setPreselectedLeadIds] = useState<string[]>([]);
  // Initialize as true — checkDatabase always resolves to true anyway; removes a render-blocking gate
  const [databaseReady, setDatabaseReady] = useState<boolean | null>(true);
  const [editingCampaign, setEditingCampaign] = useState<any | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [leadFinderVisited, setLeadFinderVisited] = useState(false);
  // Track when finders have been visited so we keep them mounted (preserving search results)
  if (currentView === 'lead-finder' && !leadFinderVisited) {
    setLeadFinderVisited(true);
  }
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('contndr.sidebar.collapsed') === 'true'; } catch { return false; }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('contndr.sidebar.collapsed', String(next)); } catch {}
      return next;
    });
  }, []);
  const [aiOpen, setAIOpen] = useState(false);
  const [aiInitialQuery, setAIInitialQuery] = useState<string>('');

  // ── Navigation helpers for public pages ──
  const handlePublicNavigate = useCallback((path: string) => {
    // Handle anchor links
    if (path.startsWith('/#')) {
      if (location.pathname !== '/') {
        navigate('/');
        // Wait for render then scroll
        setTimeout(() => {
          const id = path.substring(2);
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        const id = path.substring(2);
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    if (path === '/') {
      navigate('/');
      window.scrollTo(0, 0);
      return;
    }

    navigate(path);
    window.scrollTo(0, 0);
  }, [navigate, location.pathname]);

  const handleLogin = useCallback(() => navigate('/auth?mode=signin'), [navigate]);
  const handleGetStarted = useCallback(() => navigate('/auth?mode=signup'), [navigate]);

  // ── Backward compat: /?auth=signup → /auth?mode=signup ──
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authParam = params.get('auth');
    if (authParam && location.pathname === '/' && !user) {
      navigate(`/auth?mode=${authParam}`, { replace: true });
    }
  }, [location.search, location.pathname, user, navigate]);

  // ── Check onboarding status ──
  useEffect(() => {
    if (user && !hasCheckedOnboarding) {
        checkOnboarding();
    }
  }, [user, hasCheckedOnboarding]);

  async function checkOnboarding() {
      if (!user) return;
      try {
           // Admin/demo bypass - VIP emails skip onboarding
           const email = user.email || user.user_metadata?.email;
           const userEmail = email?.toLowerCase().trim();
           // VIP status: explicit admins, demo, any @contndr.com, or admin UIDs
            // Also check admin UIDs for non-contndr email admins
            if (isAdminUid(user?.id)) { setHasCheckedOnboarding(true); return; }
           if (userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' || userEmail === 'demo@contndr.com' || userEmail === 'or@contndr.com' || userEmail?.endsWith('@contndr.com')) {
               setHasCheckedOnboarding(true);
               return;
           }

          const headers = await getAuthHeaders();
          // Wait for auth headers to be ready
          if (!headers.Authorization) return;

          const res = await fetchWithRetry(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/user/onboarding`, {
              headers, timeout: 20000, retries: 2
          });
          if (res.ok) {
              const data = await res.json();
              if (!data.completed) {
                  setShowOnboarding(true);
                  if (typeof data.step === 'number') {
                      setOnboardingStep(data.step);
                  }
              }
          }
      } catch (error) {
          console.error('Error checking onboarding:', error);
      } finally {
          setHasCheckedOnboarding(true);
      }
  }

  // Auto-force UpgradeModal for approved-but-unpaid users (dashboard renders blurred behind)
  useEffect(() => {
    if (!user || !subscriptionStatus) return;
    
    const email = user?.email || user?.user_metadata?.email;
    const userEmail = email?.toLowerCase().trim();
    // VIP billing status: explicit admins, demo, or any @contndr.com (includes sales reps), or admin UIDs
    // isAdminUser is email-based; isAdminByUid supplements it
    const isAdminUser = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' || userEmail === 'demo@contndr.com' || userEmail === 'or@contndr.com' || userEmail?.endsWith('@contndr.com');
    
    if (!isAdminUser && !isAdminUid(user?.id) && subscriptionStatus.status !== 'active') {
      // Skip if pending/waitlist (those get PendingAccessScreen early return)
      if (subscriptionStatus.status === 'pending' && subscriptionStatus.plan === 'waitlist') return;
      
      console.log('[ACCESS CONTROL] Auto-opening forced UpgradeModal for approved-but-unpaid user');
      setShowUpgradeModal(true);
      setIsUpgradeForced(true);
    } else {
      // Clear forced state if user becomes active
      if (isUpgradeForced) {
        setIsUpgradeForced(false);
        setShowUpgradeModal(false);
      }
    }
  }, [user, subscriptionStatus]);

  // Set is-native-app class for Mobile Nav behavior
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         (window.navigator as any).standalone === true;
    if (isStandalone || isNativeApp) {
      document.body.classList.add('is-native-app');
    }
  }, []);

  // ── Keyboard shortcut to show access debugger (Ctrl+Shift+D or Cmd+Shift+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setShowAccessDebugger(prev => !prev);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── iOS Native Bridge Setup ──
  useEffect(() => {
    if (!user) return;
    
    const win = window as any;
    win.__app = win.__app || {};

    win.__app.onDeviceTokenReceived = async function(token: string) {
      console.log("iOS device token received", token);
      try {
        const headers = await getAuthHeaders();
        if (!headers.Authorization) return;
        
        await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/native/push-token`, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token, platform: 'ios', app: 'contndr' })
        });
      } catch (err) {
        console.error("Failed to save device token:", err);
      }
    };

    win.__app.onNotificationTap = function(url: string) {
      if (!url) return;
      try {
        const targetUrl = new URL(url, window.location.origin);
        if (targetUrl.origin === window.location.origin) {
          // Route internally
          const pathWithQuery = targetUrl.pathname + targetUrl.search + targetUrl.hash;
          if (pathWithQuery.startsWith('/app/') || pathWithQuery.startsWith('/demo/') || pathWithQuery === '/') {
            navigate(pathWithQuery);
          } else {
             window.location.href = url;
          }
        } else {
          window.location.href = url;
        }
      } catch (e) {
        window.location.href = url;
      }
    };

    if (isNativeApp) {
      sendNativeMessage("REQUEST_PUSH_PERMISSION");
      
      // Intercept window.open to use native browser
      const originalWindowOpen = window.open;
      window.open = function(url?: string | URL, target?: string, features?: string) {
        if (url && typeof url === 'string' && (url.startsWith('http') || url.startsWith('mailto:'))) {
          sendNativeMessage("OPEN_URL", { url });
          return null;
        }
        return originalWindowOpen.call(window, url, target, features);
      };
    }
  }, [user, navigate]);

  // Global listener for navigate-to custom events (used by CampaignBuilder, Analytics, AIAssistant, etc.)
  useEffect(() => {
    const handleNavigateTo = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === 'string') {
        setCurrentView(detail as View);
        // Close any open modals when navigating away
        setShowCampaignBuilder(false);
        setShowAICallBuilder(false);
        setPreselectedLeadIds([]);
      }
    };
    window.addEventListener('navigate-to', handleNavigateTo);
    return () => window.removeEventListener('navigate-to', handleNavigateTo);
  }, [setCurrentView]);

  // Expose debug function to browser console for admins
  useEffect(() => {
    (window as any).debugSubscription = () => {
      console.log('========== SUBSCRIPTION DEBUG INFO ==========');
      console.log('User Email:', user?.email);
      console.log('User ID:', user?.id);
      console.log('Subscription Status:', JSON.stringify(subscriptionStatus, null, 2));
      console.log('Auth Loading:', authLoading);
      console.log('Database Ready:', databaseReady);
      console.log('Session:', session ? 'Active' : 'None');
      console.log('============================================');
      return {
        user: { email: user?.email, id: user?.id },
        subscriptionStatus,
        authLoading,
        databaseReady,
        hasSession: !!session
      };
    };
    
    (window as any).showDebugger = () => {
      setShowAccessDebugger(true);
    };
    
    return () => {
      delete (window as any).debugSubscription;
      delete (window as any).showDebugger;
    };
  }, [user, subscriptionStatus, authLoading, databaseReady, session]);

  // Check subscription status
  useEffect(() => {
    if (user) {
      checkSubscription();
    }
  }, [user]);

  // Check for Stripe checkout return - recheck subscription after payment
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    // Stripe embedded checkout adds session_id to URL after successful payment
    if (urlParams.get('session_id') && user && subscriptionStatus) {
      console.log('[BILLING] Detected Stripe checkout return, rechecking subscription...');
      setIsRecheckingSubscription(true);
      
      // Wait a bit for webhook to process (webhooks are usually instant but add buffer)
      setTimeout(async () => {
        await checkSubscription();
        setIsRecheckingSubscription(false);
        
        // If still not active, show helpful message
        // Note: subscriptionStatus won't be updated yet, so we'll check in the next render cycle
        setTimeout(() => {
          const currentStatus = subscriptionStatus?.status;
          if (currentStatus !== 'active') {
            toast.info(t('app.paymentProcessingTitle'), {
              description: t('app.paymentProcessingDesc'),
              duration: 10000,
            });
          } else {
            toast.success(t('app.welcomeToContndr'), {
              description: t('app.subscriptionActive'),
              duration: 5000,
            });
          }
        }, 500);
      }, 2000);
      
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [user, subscriptionStatus]);

  async function checkSubscription() {
    try {
      const email = user?.email || user?.user_metadata?.email;
      const userEmail = email?.toLowerCase().trim();
      
      // Fast path: return cached subscription if fresh (avoids redundant API call)
      const cacheKey = `subscription:${user?.id}`;
      const cached = apiCache.get(cacheKey);
      if (cached && !cached.isStale) {
        // Silently reuse cache — don't log on every auth state change
        setSubscriptionStatus(cached.data);
        return;
      }

      console.log('[BILLING] ========== CHECKING SUBSCRIPTION ==========');
      console.log('[BILLING] User:', userEmail);
      
      const headers = await getAuthHeaders();
      // If no auth headers yet, wait for session to initialize
      if (!headers.Authorization) {
        console.log('[BILLING] Waiting for session initialization...');
        if (isAdminUid(user?.id)) {
          const fallbackStatus = { status: 'active', plan: 'enterprise', isWhitelisted: true };
          apiCache.set(cacheKey, fallbackStatus, { staleTime: 30_000, cacheTime: 60_000 });
          setSubscriptionStatus(fallbackStatus);
        } else {
          setSubscriptionStatus({ status: 'pending', plan: 'waitlist', isWhitelisted: false });
        }
        console.log('[BILLING] ================================================');
        return;
      }

      console.log('[BILLING] Fetching subscription status from server...');
      
      const billingUrl = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/status`;
      let res = await fetchWithRetry(billingUrl, { headers, timeout: 30000, retries: 3 });
      
      // ── Handle 401: refresh token and retry once ──────────────────────
      if (res.status === 401) {
        const errorText = await res.text().catch(() => 'Unknown error');
        console.warn('[BILLING] Got 401 on first attempt:', errorText);
        
        // CRITICAL: Detect deleted user (account no longer exists in Supabase Auth)
        if (errorText.includes('USER_NOT_FOUND')) {
          console.error('[BILLING] User account no longer exists — forcing sign out');
          toast.error(t('app.accountNotFoundTitle'), {
            description: t('app.accountNotFoundDesc'),
            duration: 10000,
          });
          silentSignOutRef.current = true;
          await supabase.auth.signOut({ scope: 'local' });
          setSession(null);
          setUser(null);
          setSubscriptionStatus(null);
          return;
        }
        
        // Session expired / stale token — try refreshing and retry
        console.log('[BILLING] Attempting token refresh and retry...');
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        
        if (refreshError || !refreshData.session) {
          // Refresh failed — session is truly dead, sign the user out
          const isStaleToken = refreshError?.message?.includes('Refresh Token Not Found') ||
                               refreshError?.message?.includes('Invalid Refresh Token');
          if (isStaleToken) {
            console.log('[BILLING] Refresh token invalid, clearing stale session...');
            silentSignOutRef.current = true;
            await supabase.auth.signOut({ scope: 'local' });
            setSession(null);
            setUser(null);
            setSubscriptionStatus(null);
            return;
          }
          console.error('[BILLING] Token refresh failed:', refreshError?.message || 'No session after refresh');
          // Fall through to default pending/waitlist below
        } else {
          // Retry with the fresh token
          console.log('[BILLING] Token refreshed, retrying billing check...');
          const freshHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${refreshData.session.access_token}`,
          };
          res = await fetchWithTimeout(billingUrl, { headers: freshHeaders, timeout: 30000 });
        }
      }
      
      // ── Process the (possibly retried) response ───────────────────────
      if (res.ok) {
        const data = await res.json();
        
        // BULLETPROOF: Validate and normalize response
        const normalizedStatus = {
          status: data.status || 'inactive',
          plan: data.plan || 'none',
          isWhitelisted: data.isWhitelisted || false,
          isTeamMember: data.isTeamMember || false,
          teamOwnerId: data.teamOwnerId || null,
          stripe_sub_id: data.stripe_sub_id,
          updated_at: data.updated_at
        };
        
        console.log('[BILLING] Received subscription status:', JSON.stringify(normalizedStatus));
        // Cache for 60 seconds — subsequent calls within that window skip the network entirely
        apiCache.set(cacheKey, normalizedStatus, { staleTime: 60_000, cacheTime: 300_000 });
        setSubscriptionStatus(normalizedStatus);
      } else {
        const retryErrorText = await res.text().catch(() => 'Unknown error');
        console.error('[BILLING] Subscription check failed with status', res.status, ':', retryErrorText);
        
        // SECURITY: Default to pending (waitlist) on error - prevents accidental free access
        console.warn('[BILLING] Defaulting to pending/waitlist for security');
        setSubscriptionStatus({ status: 'pending', plan: 'waitlist', isWhitelisted: false });
      }
      
      console.log('[BILLING] ================================================');
    } catch (err) {
      const errorMsg = getFriendlyErrorMessage(err);
      
      console.error('[BILLING] Exception checking subscription:', errorMsg);
      
      if (isNetworkError(err)) {
        console.warn('[BILLING] Network error - using fallback');
      }
      
      // SECURITY: Default to pending (waitlist) on error - prevents accidental free access
      console.warn('[BILLING] Defaulting to pending/waitlist for security');
      setSubscriptionStatus({ status: 'pending', plan: 'waitlist', isWhitelisted: false });
      console.log('[BILLING] ================================================');
    }
  }

  // Wait for subscription check (don't block for too long though, checkSubscription handles default)
  // Add safety timeout to prevent infinite loading
  useEffect(() => {
    if (user && subscriptionStatus === null) {
      const timeout = setTimeout(() => {
        console.warn('[ACCESS CONTROL] Subscription check timeout - forcing default');
        // Force a default status if check takes too long (prevents infinite loading)
        setSubscriptionStatus({ status: 'pending', plan: 'waitlist', isWhitelisted: false });
      }, 10000); // 10 second timeout
      
      return () => clearTimeout(timeout);
    }
  }, [user, subscriptionStatus]);

  // Theme management — apply stored preference and listen for changes
  useEffect(() => {
    const dark = getIsDark();
    setIsDark(dark);
    applyThemeToDOM(dark);

    // Listen for theme-change events from PreferencesSettings
    const onThemeChange = () => {
      const newDark = getIsDark();
      setIsDark(newDark);
      applyThemeToDOM(newDark);
    };
    window.addEventListener('theme-change', onThemeChange);

    // Also listen for OS preference changes when theme is 'system'
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const stored = localStorage.getItem('theme');
      if (!stored || stored === 'system') {
        onThemeChange();
      }
    };
    mq.addEventListener('change', onSystemChange);

    return () => {
      window.removeEventListener('theme-change', onThemeChange);
      mq.removeEventListener('change', onSystemChange);
    };
  }, []);

  // Theme toggle (header/sidebar shortcut)
  function changeTheme() {
    const newDark = !isDark;
    setIsDark(newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
    applyThemeToDOM(newDark);
  }

  // Database check removed — KV store is always available via edge functions.
  // databaseReady defaults to true; the old check always resolved to true anyway.

  // Authentication check with session validation
  useEffect(() => {
    async function checkAuth() {
      try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          // Stale session in localStorage — clear silently, don't alarm the user
          if (error.message?.includes('Refresh Token Not Found') || 
              error.message?.includes('Invalid Refresh Token')) {
            console.log('[AUTH] Stale session detected, clearing silently...');
            silentSignOutRef.current = true;
            await supabase.auth.signOut({ scope: 'local' });
          } else {
            console.error('[AUTH] Error getting session:', error);
          }
          setSession(null);
          setUser(null);
          setAuthLoading(false);
          return;
        }
        
        // Check if session exists and is valid
        if (data.session) {
          // Validate session hasn't expired
          const expiresAt = data.session.expires_at ? data.session.expires_at * 1000 : 0;
          const now = Date.now();
          
          if (expiresAt < now) {
            console.log('[AUTH] Session expired, attempting refresh...');
            
            // Try to refresh
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError || !refreshData.session) {
              // Stale / revoked refresh token — clean up silently
              const isStaleToken = refreshError?.message?.includes('Refresh Token Not Found') ||
                                   refreshError?.message?.includes('Invalid Refresh Token');

              if (isStaleToken) {
                console.log('[AUTH] Refresh token expired or revoked, clearing session...');
              } else {
                console.warn('[AUTH] Session refresh failed:', refreshError?.message || 'Unknown');
                toast.error(t('app.sessionExpiredTitle'), {
                  description: t('app.sessionExpiredDesc'),
                  duration: 10000,
                });
              }
              
              // Clear session — use 'local' scope to avoid a server round-trip that
              // would also fail with the same invalid token
              silentSignOutRef.current = true;
              await supabase.auth.signOut({ scope: 'local' });
              setSession(null);
              setUser(null);
            } else {
              console.log('[AUTH] Session refreshed successfully');
              setSession(refreshData.session);
              setUser(refreshData.session.user);
            }
          } else {
            setSession(data.session);
            setUser(data.session.user);
            // Eagerly preload Dashboard chunk + data while auth gates resolve
            preloadView('dashboard');
          }
        } else {
          setSession(null);
          setUser(null);
        }
      } catch (error) {
        console.error('[AUTH] Error checking auth session:', error);
        setSession(null);
        setUser(null);
      } finally {
        // If we found a session, or if the URL doesn't look like an OAuth callback, we can stop loading.
        // If there is no session BUT the URL has 'access_token' or 'code', we keep loading true
        // and let onAuthStateChange handle it to avoid flashing the Landing Page.
        const hasAuthParams = 
          window.location.hash.includes('access_token') || 
          window.location.hash.includes('refresh_token') ||
          window.location.search.includes('code=');

        if (!hasAuthParams) {
          setAuthLoading(false);
        } else {
          console.log('[AUTH] Detected auth params in URL, waiting for onAuthStateChange...');
          // Set a timeout to force loading off if onAuthStateChange doesn't fire reasonably soon
          setTimeout(() => {
            setAuthLoading((prev) => {
              if (prev) {
                console.warn('[AUTH] Auth param check timed out, forcing loading false');
                return false;
              }
              return prev;
            });
          }, 5000);
        }
      }
    }

    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AUTH] Auth state changed:', event);
        
        if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
          apiCache.clear(); // Purge stale data from previous session
          try { localStorage.removeItem('contndr:dashboard:snapshot'); } catch {};
          setSession(null);
          setUser(null);
          setSubscriptionStatus(null);
          setAuthLoading(false); // Ensure loading is off
          if (event === 'SIGNED_OUT') {
             // Only show toast for user-initiated sign outs, not stale-token cleanups
             if (silentSignOutRef.current) {
               silentSignOutRef.current = false;
             } else {
               toast.info(t('app.signedOutTitle'), { description: t('app.signedOutDesc') });
             }
             // Navigate to landing page after sign out
             navigate('/');
          }
        } else if (event === 'TOKEN_REFRESHED') {
          console.log('[AUTH] Token refreshed successfully');
          setSession(session);
          setUser(session?.user || null);
          setAuthLoading(false);
        } else if (event === 'USER_UPDATED' && !session) {
          console.warn('[AUTH] Session lost - user needs to sign in again');
          toast.error(t('app.sessionExpiredTitle'), { 
            description: t('app.sessionExpiredDesc'),
            duration: 10000
          });
          setSession(null);
          setUser(null);
          setSubscriptionStatus(null);
          setAuthLoading(false);
        } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          setSession(session);
          setUser(session?.user || null);
          
          // RACE CONDITION FIX: If INITIAL_SESSION fires with null session but there are
          // OAuth auth params in the URL (code= or access_token), the code exchange is still
          // in progress. Don't set authLoading=false yet — wait for the subsequent SIGNED_IN event.
          const hasOAuthParams = 
            window.location.hash.includes('access_token') || 
            window.location.hash.includes('refresh_token') ||
            window.location.search.includes('code=');
          
          if (event === 'INITIAL_SESSION' && !session && hasOAuthParams) {
            console.log('[AUTH] INITIAL_SESSION with no session but OAuth params present — waiting for code exchange...');
            // Don't set authLoading to false; the SIGNED_IN event will handle it
          } else {
            setAuthLoading(false);
          }
          
          // Eagerly preload Dashboard chunk + prefetch data so /app renders instantly
          if (session?.user) {
            preloadView('dashboard');
          }

          // Late-bind affiliate ref from sessionStorage (covers OAuth signups)
          if (event === 'SIGNED_IN' && session?.access_token) {
            try {
              const pendingRef = sessionStorage.getItem('contndr_affiliate_ref');
              if (pendingRef) {
                console.log('[AFFILIATE] OAuth SIGNED_IN with pending ref, attributing:', pendingRef);
                fetch(
                  `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/attribute`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ ref: pendingRef }),
                  }
                )
                  .then(res => res.ok
                    ? console.log('[AFFILIATE] OAuth attribution sent successfully')
                    : console.warn('[AFFILIATE] OAuth attribution failed:', res.status)
                  )
                  .catch(err => console.warn('[AFFILIATE] OAuth attribution error:', err))
                  .finally(() => {
                    try { sessionStorage.removeItem('contndr_affiliate_ref'); } catch {}
                  });
              }
            } catch {
              // sessionStorage not available — ignore
            }
          }
          
          // After OAuth callback: clean up URL params and navigate to /app
          // Covers both implicit flow (hash #access_token=) and PKCE flow (query ?code=)
          {
            const hasHashAuth = window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('type=recovery'));
            const hasCodeAuth = window.location.search.includes('code=');
            
            if (hasHashAuth || hasCodeAuth) {
              // Clean up the URL (remove auth params)
              const cleanUrl = window.location.pathname;
              window.history.replaceState(null, '', cleanUrl);
              
              // Navigate to /app if user is authenticated and on a non-app page
              if (session?.user) {
                const currentPath = window.location.pathname;
                if (currentPath === '/' || currentPath === '/auth' || currentPath.startsWith('/auth')) {
                  console.log('[AUTH] OAuth callback detected with session, navigating to /app');
                  navigate('/app', { replace: true });
                }
              }
            }
          }
        } else {
           // Fallback for other events
           setSession(session);
           setUser(session?.user || null);
           setAuthLoading(false);
        }
      }
    );

    // Listen for custom session expiration events (from auth.ts and components)
    const handleSessionExpired = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('[AUTH] Session expired event received:', customEvent.detail);
      
      // Clear all state
      apiCache.clear();
      try { localStorage.removeItem('contndr:dashboard:snapshot'); } catch {};
      setSession(null);
      setUser(null);
      setSubscriptionStatus(null);
      
      // Show user-friendly error message
      toast.error(t('app.sessionExpiredTitle'), {
        description: t('app.sessionExpiredDescYour'),
        duration: 8000
      });
      
      // Use startTransition to avoid interrupting lazy loads, and add small delay
      // to allow React to finish unmounting components and applying state updates before navigating
      setTimeout(() => {
        startTransition(() => {
          // Navigate directly to auth screen with current path as redirect
          const currentPath = window.location.pathname;
          if (currentPath.startsWith('/app')) {
            navigate(`/auth?mode=signin&redirect=${encodeURIComponent(currentPath)}`);
          } else {
            navigate('/auth?mode=signin');
          }
        });
      }, 100);
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);

    // Periodic session validity check (every 5 minutes)
    // NOTE: We do NOT manually call refreshSession() here because the Supabase
    // client's `autoRefreshToken: true` already handles proactive refresh
    // internally. This interval only detects sessions that have gone stale
    // (e.g. laptop sleep, revoked tokens) and cleans them up.
    const sessionCheckInterval = setInterval(async () => {
      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        const isStaleToken = error.message?.includes('Refresh Token Not Found') ||
                             error.message?.includes('Invalid Refresh Token');
        if (isStaleToken) {
          console.log('[AUTH] Periodic check: stale session detected, clearing...');
          silentSignOutRef.current = true;
          await supabase.auth.signOut({ scope: 'local' });
          setSession(null);
          setUser(null);
        }
        return;
      }

      // If we had a session in state but getSession returns null, it was revoked
      if (!data.session && session) {
        console.log('[AUTH] Periodic check: session no longer valid, clearing...');
        setSession(null);
        setUser(null);
      }
    }, 300000); // Check every 5 minutes

    return () => {
      authListener?.subscription?.unsubscribe();
      clearInterval(sessionCheckInterval);
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, [navigate]);

  async function handleSignOut() {
    // Clear client-side API cache to prevent stale data leaking to the next session
    apiCache.clear();
    // Clear dashboard localStorage snapshot so stale data doesn't leak to next user
    try { localStorage.removeItem('contndr:dashboard:snapshot'); } catch {};
    if (isNativeApp) {
      sendNativeMessage("LOGOUT_CLEANUP");
    }
    await supabase.auth.signOut();
  }

  function handleAuthSuccess(newSession: any) {
    setSession(newSession);
    setUser(newSession?.user || null);

    // Late-bind affiliate ref from sessionStorage (covers OAuth signups)
    // The signup-v2 flow handles this inline, but OAuth users skip that endpoint
    try {
      const pendingRef = sessionStorage.getItem('contndr_affiliate_ref');
      if (pendingRef && newSession?.access_token) {
        console.log('[AFFILIATE] Found pending ref in sessionStorage, attributing:', pendingRef);
        fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/attribute`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${newSession.access_token}`,
            },
            body: JSON.stringify({ ref: pendingRef }),
          }
        )
          .then(res => {
            if (res.ok) {
              console.log('[AFFILIATE] Attribution sent successfully');
            } else {
              console.warn('[AFFILIATE] Attribution request failed:', res.status);
            }
          })
          .catch(err => console.warn('[AFFILIATE] Attribution request error:', err))
          .finally(() => {
            try { sessionStorage.removeItem('contndr_affiliate_ref'); } catch {}
          });
      }
    } catch {
      // sessionStorage not available — ignore
    }

    // Navigate to /app after successful auth (covers email/password sign in)
    if (newSession?.user) {
      navigate('/app', { replace: true });
    }
  }

  // ── Loading gate (skip for demo mode) ──
  const isInitializing = authLoading && !isDemoMode;

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <SplashScreen isInitial={true} />
      </div>
    );
  }

  // ── Resolve effective user (real user or demo fake) ──
  const effectiveUser = isDemoMode ? DEMO_USER : user;

  // ── Compute admin status ──
  const email = effectiveUser?.email || effectiveUser?.user_metadata?.email;
  const userEmail = email?.toLowerCase().trim();
  // Only explicit admin emails (or admin UIDs) have admin access - sales reps do NOT
  const isAdmin = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' || userEmail === 'or@contndr.com' || isAdminUid(effectiveUser?.id);

  // ── Build dashboard element (rendered inside /app/* or /demo/* route) ──
  const renderDashboard = () => {
    // Skip all gates in demo mode — go straight to the shell
    if (!isDemoMode) {
      // Database check
      if (databaseReady === null) {
        return (
          <div className="min-h-screen bg-zinc-50 dark:bg-[#050505]"></div>
        );
      }
      if (databaseReady === false) {
        return <DatabaseSetup />;
      }

      // Subscription loading
      if (user && subscriptionStatus === null) {
        return (
          <div className="min-h-screen bg-zinc-50 dark:bg-[#050505]"></div>
        );
      }

      if (user && isRecheckingSubscription) {
        return (
          <div className="min-h-screen bg-zinc-50 dark:bg-[#050505] flex items-center justify-center">
            <LoadingSpinner size="xl" text={t('app.processingPayment')} />
          </div>
        );
      }

      // Access control
      if (!isAdmin) {
        const status = subscriptionStatus?.status || 'unknown';
        const plan = subscriptionStatus?.plan || 'none';

        console.log('[ACCESS CONTROL] Non-admin user - Status:', status, 'Plan:', plan);

        if (status !== 'active') {
          // SECURITY: If status is pending, ALWAYS show PendingAccessScreen regardless of plan name
          // This prevents access if the plan name is missing or malformed
          if (status === 'pending') {
            // OAuth users who haven't completed the business info form yet:
            // Check if they came from an OAuth provider and haven't filled in company/business data.
            // user_metadata.oauth_onboarding_completed is set by /auth/complete-oauth-profile endpoint.
            const provider = user?.app_metadata?.provider;
            const isOAuthUser = provider && provider !== 'email';
            const accessMeta = user?.user_metadata || {};
            const hasCompletedOnboarding =
              accessMeta.oauth_onboarding_completed === true &&
              !!accessMeta.brand &&
              !!accessMeta.phone &&
              !!accessMeta.businessType &&
              !!accessMeta.monthlyLeadVolume &&
              !!accessMeta.teamSize &&
              !!accessMeta.annualRevenue;
            
            if (isOAuthUser && !hasCompletedOnboarding) {
              return (
                <OAuthOnboardingScreen
                  user={user}
                  onComplete={async () => {
                    // Refresh the session so user_metadata updates are reflected
                    const { data } = await supabase.auth.refreshSession();
                    if (data.session) {
                      setSession(data.session);
                      setUser(data.session.user);
                    }
                    // Clear cached subscription so the re-check hits the server
                    apiCache.clear();
                    // Re-check subscription (the endpoint just created the waitlist entry)
                    await checkSubscription();
                  }}
                  onLogout={handleSignOut}
                />
              );
            }
            
            return <PendingAccessScreen onLogout={handleSignOut} />;
          }
          if (status === 'unpaid') {
            console.log('[ACCESS CONTROL] Approved user requires subscription before product access');
            return (
              <ApprovedAccessScreen
                onLogout={handleSignOut}
                onCheckSubscription={checkSubscription}
              />
            );
          }

          console.log('[ACCESS CONTROL] Non-active access status detected - showing subscription gate');
          return (
            <ApprovedAccessScreen
              onLogout={handleSignOut}
              onCheckSubscription={checkSubscription}
            />
          );
        }
      }
    }

    // ── Dashboard shell ──
    const isCollapsed = sidebarCollapsed && !showMobileMenu;
    return (
      <DemoContext.Provider value={{ isDemoMode }}>
      <div className={`h-[100dvh] overflow-hidden bg-zinc-50 dark:bg-[#050505] transition-colors duration-200`}>
        {/* Demo mode top banner */}
        {isDemoMode && (
          <div className="fixed top-0 left-0 right-0 z-[60] bg-white/95 dark:bg-[#0a0a0a]/95 border-b border-[#1ED4A7]/15 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center justify-between px-3 sm:px-6 h-9 sm:h-10">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <PlayCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1ED4A7] shrink-0" />
                <span className="hidden sm:inline text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('app.sandboxExploring')}</span>
                <span className="sm:hidden text-[11px] font-semibold tracking-wide text-[#1ED4A7]">{t('app.sandboxLabel')}</span>
              </div>
              <div className="flex items-center shrink-0">
                <button onClick={() => navigate('/auth?mode=signin')} className="text-[11px] sm:text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">{t('app.logIn')}</button>
              </div>
            </div>
          </div>
        )}
        {/* Mobile Header — safe-area-aware for iOS notch/status bar */}
        <div className="lg:hidden fixed left-0 right-0 bg-white/90 dark:bg-[#050505]/90 backdrop-blur-xl border-b border-zinc-200 dark:border-white/10 z-30 px-4 flex items-center justify-between" style={{ top: isDemoMode ? 'calc(36px + env(safe-area-inset-top, 0px))' : '0', paddingTop: isDemoMode ? '0px' : 'env(safe-area-inset-top, 0px)', height: isDemoMode ? '48px' : 'calc(4rem + env(safe-area-inset-top, 0px))' }}>
          <div className="flex items-center">
            <ContndrLogo className="h-[14px] w-auto text-zinc-900 dark:text-white ml-1" stroke={isDark ? "#050505" : "#FFFFFF"} strokeWidth="6" />
          </div>
          
          {/* Mobile Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setAIOpen(true); setAIInitialQuery(''); }}
              className="p-1.5 text-[#1ED4A7] hover:bg-[#1ED4A7]/10 rounded-lg transition-colors"
              aria-label="Open AI Assistant"
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path d="M12 2L13.8 8.56L12 10L10.2 8.56L12 2Z" fill="currentColor" />
                <path d="M12 22L10.2 15.44L12 14L13.8 15.44L12 22Z" fill="currentColor" />
                <path d="M2 12L8.56 10.2L10 12L8.56 13.8L2 12Z" fill="currentColor" />
                <path d="M22 12L15.44 13.8L14 12L15.44 10.2L22 12Z" fill="currentColor" />
                <path d="M12 8.5L14 12L12 15.5L10 12L12 8.5Z" fill="currentColor" opacity="0.9" />
                <path d="M18.5 4V7M17 5.5H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button 
              onClick={() => setShowMobileMenu(true)}
              className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-[12px] font-semibold text-zinc-900 dark:text-white overflow-hidden shrink-0 tap-target-override border border-zinc-300 dark:border-zinc-700/50 shadow-sm transition-transform active:scale-95"
              aria-label="Open User Menu"
            >
              {effectiveUser?.user_metadata?.avatar_url ? (
                <img src={effectiveUser.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                effectiveUser?.email?.[0].toUpperCase() || 'U'
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu Overlay */}
        {showMobileMenu && (
          <div 
            className="fixed inset-0 bg-black/50 dark:bg-black/50 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setShowMobileMenu(false)}
          />
        )}

          {/* Sidebar — safe-area-aware for iOS PWA */}
          <aside className={`
            fixed left-0 h-[100dvh]
            bg-white dark:bg-[#0a0a0a] border-r border-zinc-200 dark:border-white/[0.06]
            flex flex-col transition-all duration-200 ease-out z-50
            ${showMobileMenu ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'}
            ${!showMobileMenu && sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-72'}
          `} style={{ top: isDemoMode ? '40px' : '0', height: isDemoMode ? 'calc(100dvh - 40px)' : '100dvh', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            {/* Logo */}
            <div className={`flex items-center shrink-0 group/header ${isCollapsed ? 'justify-center px-3 py-5' : 'justify-between px-5 py-5'}`}>
              {isCollapsed ? (
                <button
                  onClick={toggleSidebar}
                  className="hidden lg:flex relative group items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 hover:bg-white/[0.06] tap-target-override"
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                >
                  <ContndrSymbol className="w-6 h-6 text-zinc-600 dark:text-zinc-300 transition-opacity duration-200 group-hover:opacity-0" />
                  <ChevronsRight className="w-4 h-4 text-zinc-400 dark:text-zinc-500 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                </button>
              ) : (
                <>
                  <ContndrLogo className="h-4 lg:h-[18px] w-auto text-zinc-900 dark:text-white" stroke={isDark ? "#050505" : "#FFFFFF"} strokeWidth="6" />
                  <div className="flex items-center gap-1">
                    {/* Close button for mobile */}
                    <button 
                      onClick={() => setShowMobileMenu(false)}
                      className="lg:hidden p-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors duration-200"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    {/* Collapse toggle — desktop only, fades in on header hover */}
                    <button
                      onClick={toggleSidebar}
                      className="hidden lg:flex p-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all duration-200 opacity-0 group-hover/header:opacity-100 tap-target-override"
                      title="Collapse sidebar"
                      aria-label="Collapse sidebar"
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* AI Search Bar in Sidebar */}
            {!isCollapsed && (
              <AskAIButton onClick={() => { setShowMobileMenu(false); setAIOpen(true); setAIInitialQuery(''); }} />
            )}

            {/* Navigation */}
            <nav className={`flex-1 overflow-y-auto py-3 custom-scrollbar ${sidebarCollapsed && !showMobileMenu ? 'px-2 space-y-1' : 'px-3 space-y-0.5'}`}>
              <div className="mb-5">
                {sidebarCollapsed && !showMobileMenu ? (
                  <div className="mx-2 mb-2 border-t border-zinc-200 dark:border-white/[0.06]" />
                ) : (
                  <p className="px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-2">{t('sidebar.platform', 'Platform')}</p>
                )}
                <div className="space-y-1">
                  <NavButton
                    icon={Home}
                    label={t('sidebar.dashboard')}
                    active={currentView === 'dashboard'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('dashboard');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="dashboard"
                    data-onboarding-id="nav-dashboard"
                  />
                  <NavButton
                    icon={Search}
                    label={t('sidebar.leadFinder')}
                    active={currentView === 'lead-finder'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('lead-finder');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="lead-finder"
                    className="text-[#1ED4A7]"
                    data-onboarding-id="nav-lead-finder"
                  />
                  <NavButton
                    icon={Mail}
                    label={t('sidebar.inbox')}
                    active={currentView === 'inbox'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('inbox');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="inbox"
                  />
                  <NavButton
                    icon={Users}
                    label={t('sidebar.leads', 'Leads')}
                    active={currentView === 'crm'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('crm');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="crm"
                  />
                </div>
              </div>

              <div className="mb-5">
                {isCollapsed ? (
                  <div className="mx-2 mb-2 border-t border-zinc-200 dark:border-white/[0.06]" />
                ) : (
                  <p className="px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-2">{t('sidebar.outreach', 'Outreach')}</p>
                )}
                <div className="space-y-1">
                  <NavButton
                    icon={Send}
                    label={t('sidebar.campaigns')}
                    active={currentView === 'campaigns'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('campaigns');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="campaigns"
                    data-onboarding-id="nav-campaigns"
                  />
                  {(() => {
                    const email = effectiveUser?.email || effectiveUser?.user_metadata?.email;
                    const userEmail = email?.toLowerCase().trim();
                    const isAdmin = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' || userEmail === 'or@contndr.com' || ADMIN_UIDS.includes(effectiveUser?.id);
                    const userPlan = subscriptionStatus?.plan?.toLowerCase() || 'none';
                    // AI Calls available for: admins, growth, scale, enterprise plans
                    const hasAICallsAccess = isAdmin || userPlan === 'growth' || userPlan === 'scale' || userPlan === 'enterprise';
                    // Users without a paid plan see a locked nav item prompting upgrade
                    const isLockedPlan = !hasAICallsAccess;
                    
                    if (hasAICallsAccess) {
                      return (
                        <NavButton
                          icon={Phone}
                          label={t('sidebar.voiceAgents', 'Voice Agents')}
                          active={currentView === 'ai-calls'}
                          collapsed={isCollapsed}
                          onClick={() => {
                            setCurrentView('ai-calls');
                            setShowMobileMenu(false);
                          }}
                          preloadKey="ai-calls"
                          beta={true}
                        />
                      );
                    }
                    
                    if (isLockedPlan) {
                      return (
                        <NavButton
                          icon={Phone}
                          label={t('sidebar.voiceAgents', 'Voice Agents')}
                          active={false}
                          collapsed={isCollapsed}
                          locked={true}
                          onClick={() => {
                            setShowUpgradeModal(true);
                            setShowMobileMenu(false);
                          }}
                        />
                      );
                    }
                    
                    return null;
                  })()}
                  <NavButton
                    icon={Zap}
                    label={t('sidebar.automations', 'Automations')}
                    active={currentView === 'automations'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('automations');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="automations"
                  />
                </div>
              </div>

              <div>
                {isCollapsed ? (
                  <div className="mx-2 mb-2 border-t border-zinc-200 dark:border-white/[0.06]" />
                ) : (
                  <p className="px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-2">{t('sidebar.insights', 'Insights')}</p>
                )}
                <div className="space-y-1">
                  <NavButton
                    icon={GitBranch}
                    label={t('sidebar.pipeline', 'Pipeline')}
                    active={currentView === 'pipeline'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('pipeline');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="pipeline"
                  />
                  <NavButton
                    icon={TrendingUp}
                    label={t('sidebar.intentSignals', 'Intent')}
                    active={currentView === 'intent'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('intent');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="intent"
                  />
                  <NavButton
                    icon={Trophy}
                    label={t('sidebar.team', 'Team')}
                    active={currentView === 'team'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('team');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="team"
                  />
                  <NavButton
                    icon={DollarSign}
                    label={t('sidebar.revenue', 'Revenue')}
                    active={currentView === 'revenue'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('revenue');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="revenue"
                  />
                  <NavButton
                    icon={BarChart3}
                    label={t('sidebar.analytics', 'Analytics')}
                    active={currentView === 'analytics'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      setCurrentView('analytics');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="analytics"
                  />
                </div>
              </div>
            </nav>

            {/* Bottom Actions — safe-area padding for iOS home indicator */}
            <div className={`border-t border-zinc-200 dark:border-white/[0.06] space-y-1.5 ${isCollapsed ? 'p-2' : 'px-3 py-3'}`} style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}>
              {/* Admin Link - Only visible to explicit admins (NOT sales reps) */}
              {(() => {
                const email = effectiveUser?.email || effectiveUser?.user_metadata?.email;
                const userEmail = email?.toLowerCase().trim();
                // Only explicit admins see Admin Portal - NOT sales reps
                const isAdmin = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' || userEmail === 'or@contndr.com' || ADMIN_UIDS.includes(effectiveUser?.id);
                return isAdmin && (
                  <NavButton
                    icon={Users}
                    label={t('sidebar.admin', 'Admin Portal')}
                    active={currentView === 'admin'}
                    collapsed={isCollapsed}
                    onClick={() => {
                      console.log('[ADMIN] Admin Portal clicked');
                      setCurrentView('admin');
                      setShowMobileMenu(false);
                    }}
                    preloadKey="admin"
                    className="!text-[#1ED4A7] hover:!text-[#1ED4A7]/80"
                  />
                );
              })()}

              <NavButton
                icon={SettingsIcon}
                label={t('sidebar.settings')}
                active={currentView === 'settings'}
                collapsed={isCollapsed}
                onClick={() => {
                  setCurrentView('settings');
                  setShowMobileMenu(false);
                }}
                preloadKey="settings"
                data-onboarding-id="nav-settings"
              />

              {!isCollapsed && !isDemoMode && (
                <NavButton
                  icon={DollarSign}
                  label={subscriptionStatus?.plan === 'growth' ? t('sidebar.planGrowth', 'Plan: Growth') : subscriptionStatus?.plan === 'scale' ? t('sidebar.planScale', 'Plan: Scale') : subscriptionStatus?.plan === 'enterprise' ? t('sidebar.planEnterprise', 'Plan: Enterprise') : t('sidebar.upgradePlan', 'Upgrade Plan')}
                  active={false}
                  onClick={() => {
                    setShowUpgradeModal(true);
                    setShowMobileMenu(false);
                  }}
                />
              )}

              {/* Walkthrough — hidden in demo mode */}
              {!isCollapsed && !isDemoMode && (
                <button
                  onClick={() => {
                    setOnboardingStep(1);
                    setShowOnboarding(true);
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-500 dark:text-zinc-600 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.04] transition-colors duration-150"
                  title={t('sidebar.setup', 'Setup')}
                >
                  <PlayCircle className="w-[18px] h-[18px]" strokeWidth={1.8} />
                  <span>{t('sidebar.setup', 'Setup')}</span>
                </button>
              )}
              
              {/* New Campaign CTA */}
              {isCollapsed ? (
                <button
                  onClick={() => {
                    startTransition(() => {
                      setShowCampaignBuilder(true);
                      setShowMobileMenu(false);
                    });
                  }}
                  className="w-full flex items-center justify-center p-2.5 rounded-lg transition-colors duration-150 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 shadow-sm dark:hover:bg-zinc-200 tap-target-override"
                  title={t('sidebar.newCampaign', 'New Campaign')}
                  aria-label={t('sidebar.newCampaign', 'New Campaign')}
                  data-onboarding-id="sidebar-new-campaign"
                >
                  <Plus className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    startTransition(() => {
                      setShowCampaignBuilder(true);
                      setShowMobileMenu(false);
                    });
                  }}
                  className="w-full flex items-center justify-center gap-2 mt-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors duration-150 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 shadow-sm dark:hover:bg-zinc-200"
                  data-onboarding-id="sidebar-new-campaign"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('sidebar.newCampaign', 'New Campaign')}</span>
                </button>
              )}
              
              {/* User profile + language toggle */}
              {isCollapsed ? (
                <div className="flex flex-col items-center gap-1.5 pt-1.5">
                  <div 
                    className="w-8 h-8 rounded-full bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center text-xs font-medium text-zinc-900 dark:text-white overflow-hidden cursor-pointer hover:ring-2 hover:ring-zinc-400 dark:hover:ring-zinc-500/30 transition-all"
                    onClick={() => isDemoMode ? navigate('/auth?mode=signup') : setCurrentView('settings')}
                    title={effectiveUser?.user_metadata?.name || effectiveUser?.email || t('sidebar.profile', 'Profile')}
                  >
                    {effectiveUser?.user_metadata?.avatar_url ? (
                      <img src={effectiveUser.user_metadata.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      effectiveUser?.email?.[0].toUpperCase()
                    )}
                  </div>
                  <button 
                    onClick={() => {
                      const langs = ['en', 'es', 'pt', 'fr', 'de', 'ru'];
                      const next = langs[(langs.indexOf(i18n.language) + 1) % langs.length];
                      i18n.changeLanguage(next);
                      try { localStorage.setItem('contndr.language', next); } catch {}
                    }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-600 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-all duration-150 tap-target-override"
                    title={t('sidebar.language', 'Language')}
                    aria-label={t('sidebar.language', 'Language')}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide">{i18n.language}</span>
                  </button>
                  <button 
                    onClick={() => isDemoMode ? navigate('/auth?mode=signup') : handleSignOut()}
                    className="p-2 rounded-lg text-zinc-500 dark:text-zinc-600 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.04] transition-colors duration-150 tap-target-override"
                    title={isDemoMode ? t('sidebar.signUp', 'Sign up') : t('sidebar.signOut', 'Sign out')}
                    aria-label={isDemoMode ? t('sidebar.signUp', 'Sign up') : t('sidebar.signOut', 'Sign out')}
                  >
                    {isDemoMode ? <ArrowRight className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 space-y-1">
                  <div 
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer group"
                    data-onboarding-id="sidebar-user-profile"
                    onClick={() => isDemoMode ? navigate('/auth?mode=signup') : setCurrentView('settings')}
                  >
                    <div className="w-7 h-7 rounded-full bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center text-[11px] font-medium text-zinc-900 dark:text-white overflow-hidden shrink-0">
                      {effectiveUser?.user_metadata?.avatar_url ? (
                        <img src={effectiveUser.user_metadata.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        effectiveUser?.email?.[0].toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {effectiveUser?.user_metadata?.name || t('app.userFallback')}
                      </p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 truncate">
                        {effectiveUser?.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {/* Language switcher — premium inline pill */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const langs = ['en', 'es', 'pt', 'fr', 'de', 'ru'];
                          const next = langs[(langs.indexOf(i18n.language) + 1) % langs.length];
                          i18n.changeLanguage(next);
                          try { localStorage.setItem('contndr.language', next); } catch {}
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-all duration-150"
                        title={t('sidebar.language', 'Language')}
                      >
                        <Globe className="w-3 h-3" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider">{i18n.language}</span>
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          isDemoMode ? navigate('/auth?mode=signup') : handleSignOut();
                        }}
                        className="p-1 rounded text-zinc-400 dark:text-zinc-600 hover:text-zinc-900 dark:hover:text-white transition-colors duration-150"
                        title={isDemoMode ? t('sidebar.signUp', 'Sign up') : t('sidebar.signOut', 'Sign out')}
                      >
                        {isDemoMode ? <ArrowRight className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* Main content — pt accounts for safe-area-aware mobile header; demo banner adds 40px offset */}
          <main className={`overflow-hidden bg-transparent mobile-header-offset relative transition-all duration-200 ${sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-72'}`} style={{ height: isDemoMode ? 'calc(100% - 40px)' : '100%', marginTop: isDemoMode ? '40px' : undefined }}>
            <div className="h-full flex flex-col overflow-y-auto relative mobile-scroll app-main-scroll">
              <LazyLoadErrorBoundary componentName={currentView}>
                <Suspense fallback={viewSkeletonMap[currentView] || <GenericSkeleton />}>
              {currentView === 'dashboard' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-dashboard">
                  <Dashboard 
                    onNavigate={setCurrentView} 
                    subscriptionStatus={subscriptionStatus}
                    onUpgrade={() => setShowUpgradeModal(true)}
                  />
                  </div>
                </ErrorBoundary>
              )}
              {(currentView === 'lead-finder' || leadFinderVisited) && (
                <div className={`h-full min-h-0 ${currentView === 'lead-finder' ? 'view-enter' : 'hidden'}`} key="v-lf">
                  <ErrorBoundary>
                    <LeadFinder onUpgrade={() => setShowUpgradeModal(true)} />
                  </ErrorBoundary>
                </div>
              )}
              {currentView === 'campaigns' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-campaigns">
                  <CampaignsView onCreateCampaign={() => startTransition(() => setShowCampaignBuilder(true))} />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'crm' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-crm">
                  <CRM onStartFollowUp={(leadIds) => {
                    setPreselectedLeadIds(leadIds);
                    startTransition(() => setShowCampaignBuilder(true));
                  }} onUpgrade={() => setShowUpgradeModal(true)} />
                  </div>
                </ErrorBoundary>
              )}

              {currentView === 'inbox' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-inbox">
                  <UnifiedInbox />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'emails' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0 overflow-y-auto" key="v-emails">
                  <EmailsView />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'revenue' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-revenue">
                  <Revenue onNavigate={setCurrentView} />
                  </div>
                </ErrorBoundary>
              )}
              {(() => {
                const email = effectiveUser?.email || effectiveUser?.user_metadata?.email;
                const userEmail = email?.toLowerCase().trim();
                // Only explicit admins can access Admin Dashboard - NOT sales reps
                const isAdmin = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' || userEmail === 'or@contndr.com' || ADMIN_UIDS.includes(effectiveUser?.id);
                const shouldShowAdmin = currentView === 'admin' && isAdmin;
                return shouldShowAdmin && (
                  <ErrorBoundary>
                    <div className="view-enter h-full min-h-0" key="v-admin">
                    <AdminDashboard />
                    </div>
                  </ErrorBoundary>
                );
              })()}
              {currentView === 'analytics' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-analytics">
                  <AdvancedAnalytics />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'ai-calls' && (() => {
                const email = effectiveUser?.email || effectiveUser?.user_metadata?.email;
                const userEmail = email?.toLowerCase().trim();
                const isAdmin = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' || userEmail === 'or@contndr.com' || ADMIN_UIDS.includes(effectiveUser?.id);
                const userPlan = subscriptionStatus?.plan?.toLowerCase() || 'none';
                const hasAccess = isAdmin || userPlan === 'growth' || userPlan === 'enterprise';
                
                if (!hasAccess) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
                      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                        <Phone className="w-8 h-8 text-amber-400" />
                      </div>
                      <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">{t('app.aiCallsRequiresGrowth')}</h2>
                      <p className="text-zinc-500 dark:text-zinc-400 text-sm max-w-md">
                        {t('app.aiCallsGrowthDesc')}
                      </p>
                      <button
                        onClick={() => setShowUpgradeModal(true)}
                        className="mt-2 px-6 py-2.5 rounded-lg bg-[#1ED4A7] text-black text-sm font-semibold hover:bg-[#1ED4A7]/90 transition-colors"
                      >
                        {t('app.upgradeToGrowth')}
                      </button>
                    </div>
                  );
                }
                
                return (
                  <ErrorBoundary>
                    <div className="view-enter h-full min-h-0" key="v-ai-calls">
                    <AICalls 
                      onCreateCampaign={() => setShowAICallBuilder(true)}
                      onViewSettings={() => setShowPhoneNumbers(true)}
                      onViewLogs={() => {
                        console.log('View call logs');
                      }}
                      onEditCampaign={(campaign) => {
                        setEditingCampaign(campaign);
                        setShowAICallBuilder(true);
                      }}
                    />
                    </div>
                  </ErrorBoundary>
                );
              })()}
              {currentView === 'automations' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-automations">
                  <AutomationManager />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'meetings' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0 overflow-y-auto p-6" key="v-meetings">
                  <ScheduledMeetings />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'follow-ups' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0 overflow-y-auto p-6" key="v-follow-ups">
                  <FollowUpManager />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'pipeline' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-pipeline">
                  <Pipeline />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'intent' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-intent">
                  <BuyingIntent />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'team' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-team">
                  <TeamLeaderboard />
                  </div>
                </ErrorBoundary>
              )}
              {currentView === 'settings' && (
                <ErrorBoundary>
                  <div className="view-enter h-full min-h-0" key="v-settings">
                  <Settings />
                  </div>
                </ErrorBoundary>
              )}
              </Suspense>
              </LazyLoadErrorBoundary>
            </div>
          </main>

        <MobileNav 
          currentView={currentView} 
          setCurrentView={(v) => {
            setCurrentView(v);
            setShowMobileMenu(false);
          }} 
        />

        {/* Campaign Builder Modal */}
        {showCampaignBuilder && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6 overlay-enter safe-area-bottom safe-area-top">
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => {
                setShowCampaignBuilder(false);
                setPreselectedLeadIds([]);
              }}
            />
            <LazyLoadErrorBoundary componentName="CampaignBuilder">
              <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
                <div className="relative w-full max-w-3xl sm:h-auto sm:max-h-[85dvh] overflow-y-auto mobile-scroll bg-[var(--background)] rounded-t-3xl sm:rounded-2xl shadow-2xl modal-enter border-t sm:border border-[var(--border)]" style={{ height: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1.5rem)' }}>
                  <CampaignBuilder onClose={() => {
                    setShowCampaignBuilder(false);
                    setPreselectedLeadIds([]);
                  }} preselectedLeadIds={preselectedLeadIds} />
                </div>
              </Suspense>
            </LazyLoadErrorBoundary>
          </div>
        )}

        {/* AI Call Campaign Builder Modal */}
        {showAICallBuilder && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6 overlay-enter safe-area-bottom safe-area-top">
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => {
                setShowAICallBuilder(false);
                setPreselectedLeadIds([]);
                setEditingCampaign(null);
              }}
            />
            <LazyLoadErrorBoundary componentName="AICallCampaignBuilder">
              <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
                <div className="relative w-full sm:max-w-2xl sm:max-h-[88dvh] bg-zinc-100 dark:bg-zinc-950 rounded-t-2xl sm:rounded-xl shadow-2xl modal-enter border border-zinc-200 dark:border-zinc-800 overflow-hidden" style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1.5rem)' }}>
                  <AICallCampaignBuilder onClose={() => {
                    setShowAICallBuilder(false);
                    setPreselectedLeadIds([]);
                    setEditingCampaign(null);
                  }} preselectedLeadIds={preselectedLeadIds} editingCampaign={editingCampaign} />
                </div>
              </Suspense>
            </LazyLoadErrorBoundary>
          </div>
        )}

        {/* Telnyx Phone Numbers Modal */}
        {showPhoneNumbers && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6 overlay-enter safe-area-bottom safe-area-top">
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowPhoneNumbers(false)}
            />
            <LazyLoadErrorBoundary componentName="TelnyxPhoneNumbers">
              <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
                <div className="relative w-full sm:max-w-3xl sm:max-h-[85dvh] overflow-y-auto mobile-scroll bg-zinc-100 dark:bg-zinc-950 rounded-t-2xl sm:rounded-xl shadow-2xl modal-enter border border-zinc-200 dark:border-zinc-800 p-3 sm:p-5" style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1.5rem)' }}>
                  <TelnyxPhoneNumbers onClose={() => setShowPhoneNumbers(false)} />
                </div>
              </Suspense>
            </LazyLoadErrorBoundary>
          </div>
        )}

        {/* Background Automation Scheduler */}
        <Suspense fallback={null}>
          <AutomationScheduler />
        </Suspense>

        {/* Quick Search */}
        <QuickSearch onNavigate={setCurrentView} />

        {/* AI Assistant (modal renders at root level to avoid sidebar transform issues) */}
        <Suspense fallback={null}>
          <AIAssistant
            onNavigate={setCurrentView}
            onOpenCampaignBuilder={() => startTransition(() => setShowCampaignBuilder(true))}
            userName={effectiveUser?.user_metadata?.name || ''}
            externalOpen={aiOpen}
            onExternalClose={() => setAIOpen(false)}
            initialQuery={aiInitialQuery}
          />
        </Suspense>

        {showOnboarding && !isDemoMode && (
          <Suspense fallback={null}>
          <OnboardingWalkthrough 
            onComplete={() => setShowOnboarding(false)} 
            currentView={currentView}
            onNavigate={setCurrentView}
            initialStep={onboardingStep}
          />
          </Suspense>
        )}

        {showUpgradeModal && !isDemoMode && (
          <UpgradeModal 
            isOpen={showUpgradeModal} 
            onClose={() => {
               // Prevent closing if upgrade is forced
               if (!isUpgradeForced) {
                   setShowUpgradeModal(false);
               } else {
                   // Recheck subscription in case payment was completed
                   checkSubscription();
                   toast.error(t('app.subscriptionRequiredTitle'), { description: t('app.subscriptionRequiredDesc') });
               }
            }}
            currentPlan={subscriptionStatus?.plan}
            forced={isUpgradeForced}
            user={user}
          />
        )}

        {/* Access Debugger - Press Ctrl+Shift+D or run showDebugger() in console */}
        {user && showAccessDebugger && (
          <Suspense fallback={null}>
            <AccessDebugger
              user={user}
              subscriptionStatus={subscriptionStatus}
              isVisible={showAccessDebugger}
              onClose={() => setShowAccessDebugger(false)}
            />
          </Suspense>
        )}

        {/* Floating bottom CTA card for demo mode — rotating border effect */}
        {isDemoMode && (
          <FloatingDemoCTA onGetStarted={() => navigate('/auth?mode=signup')} />
        )}

      </div>
      </DemoContext.Provider>
    );
  };

  // ── Render ──
  return (
    <CurrencyProvider>
    <RealtimeProvider userId={user?.id || null} teamId={null}>
    <>
      <AnimatePresence>
        {!minSplashDone && !isDemoMode && (
          <SplashScreen isInitial={false} key="splash" />
        )}
      </AnimatePresence>
      <LazyLoadErrorBoundary componentName="Router">
        <Suspense fallback={<div className="min-h-screen bg-zinc-50 dark:bg-[#050505]"></div>}>
      <Routes>
        {/* ════════ PUBLIC ROUTES (accessible regardless of auth) ════════ */}

        {/* Root route — redirect authenticated users to /app, others to /auth */}
        <Route path="/" element={
          user ? <Navigate to="/app" replace /> : <Navigate to="/auth?mode=signin" replace />
        } />

        {/* Auth screen */}
        <Route path="/auth" element={
          <AuthRoute user={user} onAuthSuccess={handleAuthSuccess} />
        } />

        {/* Sandbox Demo — renders the real dashboard shell with no auth, demo banner overlay */}
        <Route path="/demo" element={renderDashboard()} />
        <Route path="/demo/*" element={renderDashboard()} />

        {/* Blog */}
        <Route path="/blog" element={
          <BlogIndex 
            onNavigate={handlePublicNavigate} 
            onLogin={handleLogin} 
            onGetStarted={handleGetStarted} 
          />
        } />
        <Route path="/blog/:slug" element={
          <BlogPostRoute 
            onNavigate={handlePublicNavigate} 
            onLogin={handleLogin} 
            onGetStarted={handleGetStarted} 
          />
        } />

        {/* Legal pages */}
        <Route path="/privacy" element={
          <PrivacyPolicy onNavigate={handlePublicNavigate} onLogin={handleLogin} onGetStarted={handleGetStarted} />
        } />
        <Route path="/terms" element={
          <TermsOfService onNavigate={handlePublicNavigate} onLogin={handleLogin} onGetStarted={handleGetStarted} />
        } />

        {/* Company pages */}
        <Route path="/about" element={
          <AboutUs onNavigate={handlePublicNavigate} onLogin={handleLogin} onGetStarted={handleGetStarted} />
        } />
        <Route path="/security" element={
          <Security onNavigate={handlePublicNavigate} onLogin={handleLogin} onGetStarted={handleGetStarted} />
        } />
        <Route path="/contact" element={
          <Contact onNavigate={handlePublicNavigate} onLogin={handleLogin} onGetStarted={handleGetStarted} />
        } />
        <Route path="/careers" element={
          <Careers onNavigate={handlePublicNavigate} onLogin={handleLogin} onGetStarted={handleGetStarted} />
        } />

        {/* OAuth callbacks — public, handles redirect from provider auth pages */}
        <Route path="/api/integrations/salesforce/callback" element={<SalesforceOAuthCallback />} />
        <Route path="/api/integrations/hubspot/callback" element={<HubSpotOAuthCallback />} />
        <Route path="/api/integrations/slack/callback" element={<SlackOAuthCallback />} />
        <Route path="/api/integrations/quickbooks/callback" element={<QuickBooksOAuthCallback />} />
        <Route path="/social-oauth-callback" element={<SocialOAuthCallback />} />

        {/* Affiliate redirect — /r/:slug stores ref in sessionStorage, logs click, then redirects to landing page */}
        <Route path="/r/:slug" element={<AffiliateRedirect />} />

        {/* Affiliate Portal — standalone login + tracking dashboard for external partners (influencers) */}
        <Route path="/affiliate" element={
          <Suspense fallback={<div className="min-h-screen bg-zinc-950 flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
            <AffiliatePortal />
          </Suspense>
        } />

        {/* Accept team invite — auth-aware */}
        <Route path="/accept-invite" element={
          user ? <AcceptInviteHandler /> : (
            <AuthScreen 
              onAuthSuccess={handleAuthSuccess} 
              onBack={() => window.location.href = 'https://contndr.com'}
              initialMode="signup"
              redirectTo={window.location.href}
            />
          )
        } />

        {/* ════════ PROTECTED APP ROUTES ════════ */}
        <Route path="/app" element={
          !user ? (
            <Navigate to={`/auth?mode=signin&redirect=${encodeURIComponent('/app')}`} replace />
          ) : user.user_metadata?.is_external_affiliate ? (
            <Navigate to="/affiliate" replace />
          ) : (
            renderDashboard()
          )
        } />
        <Route path="/app/*" element={
          !user ? (
            <Navigate to={`/auth?mode=signin&redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />
          ) : user.user_metadata?.is_external_affiliate ? (
            <Navigate to="/affiliate" replace />
          ) : (
            renderDashboard()
          )
        } />

        {/* ════════ LEGACY / SHORTCUT REDIRECTS ════════ */}
        <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="/leads" element={<Navigate to="/app/crm" replace />} />
        <Route path="/campaigns" element={<Navigate to="/app/campaigns" replace />} />
        <Route path="/campaigns/:id" element={<CampaignsRedirect />} />
        <Route path="/pipeline" element={<Navigate to="/app/pipeline" replace />} />
        <Route path="/settings" element={<Navigate to="/app/settings" replace />} />

        {/* ════════ CATCH-ALL ════════ */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </LazyLoadErrorBoundary>

      <BroadcastOverlay />
      <ImportBroadcastOverlay />
      <AdminEventToasts userEmail={user?.email || user?.user_metadata?.email} />
      <Toaster
        position="top-right"
        theme={isDark ? "dark" : "light"}
        richColors
        closeButton
        toastOptions={{
          style: {
            fontFamily: 'var(--font-family-base)',
            fontSize: '13px',
            maxWidth: 'calc(100vw - 24px)',
          },
          className: 'modal-enter sonner-toast-mobile-safe',
        }}
        offset={16}
        gap={8}
      />

      {/* Cache Dev Tools — disabled for production, toggle with Ctrl+Shift+C if re-enabled */}
      {/* <Suspense fallback={null}>
        <CacheDevTools />
      </Suspense> */}
    </>
    </RealtimeProvider>
    </CurrencyProvider>
  );
}

// ─── NavButton ─────────────────────────────────────────────────────

interface NavButtonProps {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  beta?: boolean;
  locked?: boolean;
  className?: string;
  collapsed?: boolean;
  'data-onboarding-id'?: string;
  /** View key for chunk preloading on hover */
  preloadKey?: string;
}

const NavButton = React.memo(function NavButton({ icon: Icon, label, active, onClick, badge, beta, locked, className, collapsed, 'data-onboarding-id': dataOnboardingId, preloadKey }: NavButtonProps) {
  if (collapsed) {
    return (
      <button
        onClick={onClick}
        onMouseEnter={preloadKey ? () => preloadView(preloadKey) : undefined}
        onFocus={preloadKey ? () => preloadView(preloadKey) : undefined}
        data-onboarding-id={dataOnboardingId}
        title={label}
        aria-label={label}
        className={`
          relative w-full flex items-center justify-center p-2.5 rounded-lg
          transition-colors duration-150 group tap-target-override
          ${active 
            ? 'text-zinc-900 bg-zinc-100 dark:text-white dark:bg-white/[0.08]' 
            : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 dark:hover:text-white dark:hover:bg-white/[0.04]'
          }
          ${className || ''}
        `}
      >
        {active && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-[#1ED4A7] rounded-r-full" />
        )}
        <Icon 
          className={`w-[18px] h-[18px] shrink-0 ${
            active 
              ? 'text-[#1ED4A7]' 
              : 'text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-white'
          }`} 
          strokeWidth={1.8} 
        />
        {badge ? (
          <span className="absolute top-1 right-1 flex items-center justify-center w-4 h-4 text-[9px] font-bold bg-[#1ED4A7] text-black rounded-full shadow-[0_0_10px_rgba(30,212,167,0.4)]">
            {badge}
          </span>
        ) : null}
        {locked && (
          <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 flex items-center justify-center bg-amber-500/20 rounded-full">
            <Lock className="w-2 h-2 text-amber-400" strokeWidth={3} />
          </span>
        )}
        {beta && !locked && (
          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#1ED4A7] rounded-full shadow-[0_0_6px_rgba(30,212,167,0.5)]" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={preloadKey ? () => preloadView(preloadKey) : undefined}
      onFocus={preloadKey ? () => preloadView(preloadKey) : undefined}
      data-onboarding-id={dataOnboardingId}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium
        transition-colors duration-150 group relative
        ${active 
          ? 'text-zinc-900 bg-zinc-100 dark:text-white dark:bg-white/[0.08]' 
          : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 dark:hover:text-white dark:hover:bg-white/[0.04]'
        }
        ${className || ''}
      `}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-[#1ED4A7] rounded-r-full" />
      )}
      <Icon 
        className={`w-[18px] h-[18px] shrink-0 transition-colors duration-150 ${
          active 
            ? 'text-[#1ED4A7]' 
            : 'text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-white'
        }`} 
        strokeWidth={1.8} 
      />
      <span className="flex-1 text-left flex items-center gap-2">
        {label}
        {locked && (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-amber-500/10 text-amber-400 rounded uppercase tracking-wider flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" strokeWidth={2.5} />
            Growth
          </span>
        )}
        {beta && !locked && (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-white/[0.06] text-zinc-500 rounded uppercase tracking-wider">
            Beta
          </span>
        )}
      </span>
      {badge && (
        <span className="flex items-center justify-center min-w-5 h-5 px-1 text-[10px] font-semibold bg-[#1ED4A7] text-black rounded-full">
          {badge}
        </span>
      )}
    </button>
  );
});
