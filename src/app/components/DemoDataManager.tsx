import React, { useState, useEffect } from 'react';
import { Database, Trash2, RefreshCw, Loader2, AlertTriangle, Check, TrendingUp, Users, Mail, MapPin, Globe, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';

interface DemoStatus {
  isDemoAccount: boolean;
  userEmail: string;
  currentData: {
    leads: number;
    campaigns: number;
    emails: number;
    tracking_events: number;
  };
}

interface SeedStats {
  leads: number;
  campaigns: number;
  emails: number;
  tracking_events: number;
  revenue_events: number;
}

export default function DemoDataManager() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'seed' | 'traffic' | 'clear' | null>(null);
  const [demoStatus, setDemoStatus] = useState<DemoStatus | null>(null);
  const [seedStats, setSeedStats] = useState<SeedStats | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setAccessToken(session.access_token);
        checkDemoStatus(session.access_token);
      }
    };
    getSession();
  }, []);

  const checkDemoStatus = async (token: string) => {
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/demo/status`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setDemoStatus(data);
    } catch (error: any) {
      console.error('Status check error:', error);
      toast.error(`Failed to check demo status: ${error.message}`);
    }
  };

  const seedDemoData = async () => {
    if (!accessToken) { toast.error('Not authenticated'); return; }
    if (!demoStatus?.isDemoAccount) { toast.error('Demo accounts only'); return; }

    const confirmed = confirm(
      'Seed Demo Data?\n\n' +
      'This will create:\n' +
      '- 250 realistic leads with geographic data\n' +
      '- 5 campaigns with varied statuses\n' +
      '- 200 emails with tracking events\n' +
      '- Revenue analytics data\n' +
      '- Knowledge base entries\n' +
      '- 28 pipeline deals across all stages with AI insights\n\n' +
      'Continue?'
    );

    if (!confirmed) return;

    setIsLoading(true);
    setLoadingAction('seed');
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/demo/seed`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            config: {
              leadCount: 250,
              campaignCount: 5,
              emailsPerCampaign: 40,
              trackingEventsPerEmail: 3,
              revenueEvents: 15
            }
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setSeedStats(data.stats);
      
      toast.success(
        `Demo data seeded! ${data.stats.leads} leads, ${data.stats.campaigns} campaigns, ${data.stats.emails} emails created.`,
        { duration: 5000 }
      );

      await checkDemoStatus(accessToken);

      setTimeout(() => {
        if (confirm('Demo data has been seeded! Refresh the page to see the new data?')) {
          window.location.reload();
        }
      }, 1500);

    } catch (error: any) {
      console.error('Seed error:', error);
      toast.error(`Failed to seed demo data: ${error.message}`);
    } finally {
      setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const simulateTraffic = async () => {
    if (!accessToken) { toast.error('Not authenticated'); return; }
    if (!demoStatus?.isDemoAccount) { toast.error('Demo accounts only'); return; }
    if (demoStatus.currentData.leads === 0) {
      toast.error('Seed demo data first to have leads for traffic simulation');
      return;
    }

    setIsLoading(true);
    setLoadingAction('traffic');
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/demo/traffic`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ count: 5 })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      toast.success('Sent 5 live visitors! Check the dashboard map.');
      await checkDemoStatus(accessToken);

    } catch (error: any) {
      console.error('Traffic simulation error:', error);
      toast.error(`Failed to simulate traffic: ${error.message}`);
    } finally {
      setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const clearDemoData = async () => {
    if (!accessToken) { toast.error('Not authenticated'); return; }
    if (!demoStatus?.isDemoAccount) { toast.error('Demo accounts only'); return; }

    const confirmed = confirm(
      'Clear All Demo Data?\n\n' +
      'This will permanently delete:\n' +
      `- ${demoStatus.currentData.leads} leads\n` +
      `- ${demoStatus.currentData.campaigns} campaigns\n` +
      `- ${demoStatus.currentData.emails} emails\n` +
      `- ${demoStatus.currentData.tracking_events} tracking events\n\n` +
      'This action cannot be undone.'
    );

    if (!confirmed) return;

    const doubleConfirm = confirm('Are you absolutely sure? This will delete ALL data for this account.');
    if (!doubleConfirm) return;

    setIsLoading(true);
    setLoadingAction('clear');
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/demo/clear`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        toast.success('All demo data cleared successfully');
        setSeedStats(null);
        await checkDemoStatus(accessToken);

        setTimeout(() => {
          if (confirm('Demo data has been cleared! Refresh the page?')) {
            window.location.reload();
          }
        }, 1000);
      } else {
        throw new Error(data.message || 'Failed to clear data');
      }

    } catch (error: any) {
      console.error('Clear error:', error);
      toast.error(`Failed to clear demo data: ${error.message}`);
    } finally {
      setIsLoading(false);
      setLoadingAction(null);
    }
  };

  // ── Loading state ──
  if (!demoStatus) {
    return (
      <div className="p-4 sm:p-6">
        <LoadingSpinner center size="md" text="Loading demo status..." />
      </div>
    );
  }

  // ── Not a demo account ──
  if (!demoStatus.isDemoAccount) {
    return (
      <div className="p-4 sm:p-6">
        <div className="border border-zinc-500/30 bg-zinc-500/5 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-500/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-zinc-500" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-semibold text-[15px] mb-1">Demo Account Only</h3>
              <p className="text-zinc-400 text-[13px] leading-relaxed">
                This feature is only available for the demo account (demo@contndr.com).
                Current account: <span className="text-white font-medium">{demoStatus.userEmail}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const hasData = demoStatus.currentData.leads > 0;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Demo Data Manager</h1>
        <p className="text-zinc-500 text-[13px] sm:text-sm mt-1">
          Manage showcase data for {demoStatus.userEmail}
        </p>
      </div>

      {/* Demo Account Badge — compact inline */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border border-[#1ED4A7]/20 bg-[#1ED4A7]/5 rounded-xl w-fit">
        <div className="w-7 h-7 rounded-lg bg-[#1ED4A7]/15 flex items-center justify-center flex-shrink-0">
          <Check className="w-3.5 h-3.5 text-[#1ED4A7]" />
        </div>
        <span className="text-[13px] font-medium text-[#1ED4A7]">Demo Account Active</span>
      </div>

      {/* Current Data Stats — compact 2x2 grid */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-white/[0.06]">
          <h2 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider">Current Data</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <StatCell icon={Users} label="Leads" value={demoStatus.currentData.leads} />
          <StatCell icon={TrendingUp} label="Campaigns" value={demoStatus.currentData.campaigns} borderLeft />
          <StatCell icon={Mail} label="Emails" value={demoStatus.currentData.emails} borderTop />
          <StatCell icon={MapPin} label="Tracking" value={demoStatus.currentData.tracking_events} borderLeft borderTop />
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider px-1">Actions</h2>

        {/* Seed Demo Data */}
        <ActionCard
          icon={Database}
          iconColor="text-[#1ED4A7]"
          iconBg="bg-[#1ED4A7]/10"
          title="Seed Demo Data"
          description="Populate with realistic demo data"
          details={[
            '250 leads across 15 US cities',
            '5 campaigns (active, completed, paused)',
            '200 emails with open/click/reply rates',
            'Live tracking events for heatmap',
            'Revenue data & knowledge base',
          ]}
          warning="Adds to existing data. Clear first for a clean slate."
          buttonLabel={loadingAction === 'seed' ? 'Seeding...' : 'Seed Data'}
          buttonIcon={loadingAction === 'seed' ? Loader2 : Sparkles}
          buttonLoading={loadingAction === 'seed'}
          buttonDisabled={isLoading}
          onAction={seedDemoData}
          buttonVariant="primary"
          seedStats={seedStats}
        />

        {/* Simulate Live Traffic */}
        <ActionCard
          icon={Globe}
          iconColor="text-zinc-400"
          iconBg="bg-zinc-500/10"
          title="Simulate Live Traffic"
          description={'Generate 5 real-time visits from random leads. They appear instantly on the live map and in the "Online Now" counter.'}
          buttonLabel={loadingAction === 'traffic' ? 'Sending...' : 'Send 5 Visits'}
          buttonIcon={loadingAction === 'traffic' ? Loader2 : TrendingUp}
          buttonLoading={loadingAction === 'traffic'}
          buttonDisabled={isLoading || !hasData}
          onAction={simulateTraffic}
          buttonVariant="secondary"
        />

        {/* Clear Demo Data */}
        <ActionCard
          icon={Trash2}
          iconColor="text-zinc-400"
          iconBg="bg-zinc-500/10"
          title="Clear All Data"
          description="Permanently delete all leads, campaigns, emails, tracking events, and revenue data."
          warning="This action cannot be undone."
          warningColor="text-zinc-400"
          buttonLabel={loadingAction === 'clear' ? 'Clearing...' : 'Clear Data'}
          buttonIcon={loadingAction === 'clear' ? Loader2 : Trash2}
          buttonLoading={loadingAction === 'clear'}
          buttonDisabled={isLoading || !hasData}
          onAction={clearDemoData}
          buttonVariant="danger"
          borderColor="border-zinc-500/20"
        />
      </div>

      {/* Tips */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
        <h3 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span className="text-base">💡</span>
          Demo Tips
        </h3>
        <ul className="space-y-2 text-zinc-500 text-[13px] leading-relaxed">
          <li className="flex gap-2"><span className="text-zinc-600 select-none">·</span><span>Heatmap shows geographic distribution of tracking events across the US</span></li>
          <li className="flex gap-2"><span className="text-zinc-600 select-none">·</span><span>Engagement rates are optimized for showcase (80% open, 40% click, 15% reply)</span></li>
          <li className="flex gap-2"><span className="text-zinc-600 select-none">·</span><span>Revenue data shows various deal sizes and payment types</span></li>
          <li className="flex gap-2"><span className="text-zinc-600 select-none">·</span><span>All timestamps are spread across the last 90 days for realism</span></li>
        </ul>
      </div>
    </div>
  );
}

// ── Stat cell for the data grid ──
function StatCell({ icon: Icon, label, value, borderLeft, borderTop }: {
  icon: React.ElementType;
  label: string;
  value: number;
  borderLeft?: boolean;
  borderTop?: boolean;
}) {
  return (
    <div className={`px-4 sm:px-5 py-4 ${borderLeft ? 'border-l border-white/[0.06]' : ''} ${borderTop ? 'border-t border-white/[0.06] sm:border-t-0' : ''}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg sm:text-xl font-bold text-white tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

// ── Reusable action card — stacks vertically on mobile ──
function ActionCard({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  description,
  details,
  warning,
  warningColor = 'text-zinc-400',
  buttonLabel,
  buttonIcon: ButtonIcon,
  buttonLoading,
  buttonDisabled,
  onAction,
  buttonVariant = 'primary',
  borderColor = 'border-white/[0.08]',
  seedStats,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  details?: string[];
  warning?: string;
  warningColor?: string;
  buttonLabel: string;
  buttonIcon: React.ElementType;
  buttonLoading?: boolean;
  buttonDisabled?: boolean;
  onAction: () => void;
  buttonVariant?: 'primary' | 'secondary' | 'danger';
  borderColor?: string;
  seedStats?: SeedStats | null;
}) {
  const buttonStyles = {
    primary: 'bg-white text-black hover:bg-zinc-100 active:bg-zinc-200',
    secondary: 'bg-zinc-800 text-white hover:bg-zinc-700 active:bg-zinc-600 border border-white/[0.08]',
    danger: 'bg-zinc-600/15 text-zinc-400 border border-zinc-500/25 hover:bg-zinc-600/25 active:bg-zinc-600/35',
  };

  return (
    <div className={`rounded-2xl border ${borderColor} bg-white/[0.02] overflow-hidden`}>
      <div className="p-4 sm:p-5 flex flex-col">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        </div>

        {/* Description */}
        <p className="text-zinc-400 text-[13px] leading-relaxed mb-3">
          {description}
        </p>

        {/* Bullet details (for Seed card) */}
        {details && details.length > 0 && (
          <ul className="space-y-1.5 mb-3">
            {details.map((item, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-zinc-500 leading-snug">
                <span className="text-zinc-600 select-none mt-px">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Last seed results */}
        {seedStats && (
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#1ED4A7]/10 text-[#1ED4A7] text-[11px] font-medium">
              <Users className="w-3 h-3" /> {seedStats.leads} leads
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#1ED4A7]/10 text-[#1ED4A7] text-[11px] font-medium">
              <TrendingUp className="w-3 h-3" /> {seedStats.campaigns} campaigns
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#1ED4A7]/10 text-[#1ED4A7] text-[11px] font-medium">
              <Mail className="w-3 h-3" /> {seedStats.emails} emails
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#1ED4A7]/10 text-[#1ED4A7] text-[11px] font-medium">
              <MapPin className="w-3 h-3" /> {seedStats.tracking_events} events
            </span>
          </div>
        )}

        {/* Warning */}
        {warning && (
          <div className={`flex items-start gap-2 text-[12px] ${warningColor} mb-4`}>
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="leading-snug">{warning}</span>
          </div>
        )}

        {/* Button — full width on mobile, right-aligned on desktop */}
        <button
          onClick={onAction}
          disabled={buttonDisabled}
          className={`w-full sm:w-auto sm:ml-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${buttonStyles[buttonVariant]}`}
        >
          <ButtonIcon className={`w-4 h-4 ${buttonLoading ? 'animate-spin' : ''}`} />
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}