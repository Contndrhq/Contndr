import { useState, useEffect, useCallback } from 'react';
import { toast, Toaster } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { fmtUSDCents } from '../lib/format';
import { ContndrLogo } from './ContndrLogo';
import {
  Link2, Copy, Check, DollarSign, Users, MousePointerClick, TrendingUp,
  Loader2, Wallet, LogOut, Eye, EyeOff, ArrowUpRight, Percent,
  Clock, CheckCircle, XCircle, AlertCircle, User, BarChart3, RefreshCw,
  Sun, Moon, Monitor
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AffiliateData {
  name: string;
  email: string;
  slug: string;
  commission_rate: number;
  status: string;
  created_at: string;
  paypal_email?: string;
  payout_method?: string;
  is_external?: boolean;
}

interface ReferralEntry {
  id: string;
  referred_email: string;
  signed_up_at: string;
  converted_at?: string;
  plan?: string;
  monthly_commission?: number;
  status: 'signup' | 'converted' | 'active' | 'churned';
}

interface DashboardData {
  affiliate: AffiliateData;
  stats: {
    total_clicks: number;
    total_signups: number;
    total_conversions: number;
    total_earned: number;
    monthly_recurring: number;
  };
  referrals: ReferralEntry[];
}

type ThemeMode = 'light' | 'dark' | 'system';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  return (localStorage.getItem('theme') as ThemeMode) || 'system';
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  const themeColor = isDark ? '#050505' : '#F9FAFB';
  document.documentElement.style.backgroundColor = themeColor;
  document.body.style.backgroundColor = themeColor;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor);
}

export default function AffiliatePortal() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paypalEmail, setPaypalEmail] = useState('');
  const [editingPayout, setEditingPayout] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);

  // ─── Theme management ───
  useEffect(() => {
    applyTheme(themeMode);

    // Listen for system preference changes when in 'system' mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => { if (themeMode === 'system') applyTheme('system'); };
    mq.addEventListener('change', handleChange);

    // Sync with other tabs / main app
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'theme') {
        const newMode = (e.newValue as ThemeMode) || 'system';
        setThemeMode(newMode);
        applyTheme(newMode);
      }
    };
    window.addEventListener('storage', handleStorage);

    // Listen for custom theme-change event dispatched by main app
    const handleCustom = () => {
      const stored = (localStorage.getItem('theme') as ThemeMode) || 'system';
      setThemeMode(stored);
      applyTheme(stored);
    };
    window.addEventListener('theme-change', handleCustom);

    return () => {
      mq.removeEventListener('change', handleChange);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('theme-change', handleCustom);
    };
  }, [themeMode]);

  function cycleTheme() {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(themeMode) + 1) % order.length];
    setThemeMode(next);
    localStorage.setItem('theme', next);
    applyTheme(next);
    window.dispatchEvent(new Event('theme-change'));
  }

  const isDark = themeMode === 'dark' || (themeMode === 'system' && (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!session?.access_token) return;
    setDashLoading(true);
    try {
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/portal/dashboard`,
        { headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 403) {
          toast.error('This account is not an affiliate account');
          await supabase.auth.signOut();
          setSession(null);
          return;
        }
        throw new Error(err.error || 'Failed to load dashboard');
      }
      const data = await res.json();
      setDashboard(data);
      if (data.affiliate?.paypal_email) setPaypalEmail(data.affiliate.paypal_email);
    } catch (err: any) {
      console.error('[AFFILIATE PORTAL] Dashboard error:', err);
      toast.error(err.message || 'Failed to load dashboard');
    } finally {
      setDashLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (session) loadDashboard();
  }, [session, loadDashboard]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoginLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setSession(data.session);
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setDashboard(null);
    setEmail('');
    setPassword('');
  };

  const handleCopyLink = () => {
    if (!dashboard?.affiliate?.slug) return;
    navigator.clipboard.writeText(`https://contndr.com/r/${dashboard.affiliate.slug}`);
    setCopied(true);
    toast.success('Referral link copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSavePayout = async () => {
    if (!session?.access_token) return;
    setSavingPayout(true);
    try {
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/portal/update-payout`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ paypal_email: paypalEmail, payout_method: 'paypal' }),
        }
      );
      if (!res.ok) throw new Error('Failed to update');
      toast.success('Payout info updated');
      setEditingPayout(false);
      loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSavingPayout(false);
    }
  };

  // ─── Loading ───
  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-zinc-400 animate-spin" />
      </div>
    );
  }

  // ─── Login screen ───
  if (!session) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex flex-col">
        <Toaster position="top-right" theme={isDark ? 'dark' : 'light'} />
        <header className="border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 px-6 py-4">
          <div className="max-w-sm mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ContndrLogo className="h-5 text-zinc-900 dark:text-white" />
              <span className="text-zinc-400 dark:text-zinc-600 text-sm font-medium">Affiliate Portal</span>
            </div>
            <ThemeToggleButton themeMode={themeMode} onCycle={cycleTheme} />
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Sign in to your portal</h1>
              <p className="text-zinc-500 text-sm mt-1.5">View your referral stats and earnings</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-500 mb-1.5 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-900 dark:text-white text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none"
                  placeholder="your@email.com"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-500 mb-1.5 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 pr-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-900 dark:text-white text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none"
                    placeholder="Enter password"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loginLoading || !email || !password}
                className="w-full py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loginLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loginLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
            <p className="text-center text-zinc-400 dark:text-zinc-600 text-xs mt-8">
              This portal is for Contndr affiliate partners only.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Dashboard loading ───
  if (dashLoading && !dashboard) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
        <Toaster position="top-right" theme={isDark ? 'dark' : 'light'} />
        <Loader2 className="w-6 h-6 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
        <Toaster position="top-right" theme={isDark ? 'dark' : 'light'} />
        <div className="text-center">
          <p className="text-zinc-900 dark:text-white font-medium mb-2">Unable to load dashboard</p>
          <button onClick={loadDashboard} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white text-sm underline">Try Again</button>
        </div>
      </div>
    );
  }

  const { affiliate, stats, referrals } = dashboard;
  const referralLink = `https://contndr.com/r/${affiliate.slug}`;

  // ─── Dashboard ───
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Toaster position="top-right" theme={isDark ? 'dark' : 'light'} />

      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-50">
        <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ContndrLogo className="h-4 sm:h-5 text-zinc-900 dark:text-white" />
            <span className="text-zinc-400 dark:text-zinc-600 text-xs sm:text-sm font-medium">Affiliate Portal</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-xs text-zinc-500 hidden sm:inline">{affiliate.name}</span>
            <ThemeToggleButton themeMode={themeMode} onCycle={cycleTheme} />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-4 sm:space-y-5">
        {/* Welcome + referral link row */}
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Welcome */}
          <div className="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg sm:text-xl font-semibold text-zinc-900 dark:text-white">Welcome, {affiliate.name.split(' ')[0]}</h1>
                <p className="text-zinc-500 text-xs sm:text-sm mt-1">
                  Share your referral link and earn {(affiliate.commission_rate * 100).toFixed(0)}% commission on every conversion.
                </p>
              </div>
              <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full shrink-0 uppercase tracking-wider ${
                affiliate.status === 'active'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'
              }`}>
                {affiliate.status}
              </span>
            </div>
          </div>

          {/* Referral link */}
          <div className="lg:w-[420px] xl:w-[480px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Link2 className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Your Referral Link</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300 text-xs sm:text-sm font-mono truncate">
                {referralLink}
              </div>
              <button
                onClick={handleCopyLink}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 border ${
                  copied
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                    : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-white/[0.08]'
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { icon: MousePointerClick, label: 'Link Clicks', value: stats.total_clicks.toLocaleString() },
            { icon: Users, label: 'Signups', value: stats.total_signups.toLocaleString() },
            { icon: ArrowUpRight, label: 'Conversions', value: stats.total_conversions.toLocaleString() },
            { icon: DollarSign, label: 'Total Earned', value: fmtUSDCents(stats.total_earned) },
            { icon: TrendingUp, label: 'Monthly Recurring', value: fmtUSDCents(stats.monthly_recurring) },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 sm:p-4">
              <s.icon className="w-4 h-4 text-zinc-400 dark:text-zinc-500 mb-2" />
              <div className="text-lg sm:text-xl font-semibold text-zinc-900 dark:text-white tabular-nums">{s.value}</div>
              <div className="text-[10px] sm:text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Commission + Payout row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <Percent className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Commission Rate</span>
            </div>
            <div className="text-2xl font-semibold text-zinc-900 dark:text-white">{(affiliate.commission_rate * 100).toFixed(0)}%</div>
            <p className="text-zinc-400 dark:text-zinc-600 text-xs mt-1">
              You earn {(affiliate.commission_rate * 100).toFixed(0)}% of each subscriber's monthly payment
            </p>
          </div>

          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Payout Info</span>
              </div>
              {!editingPayout && (
                <button onClick={() => setEditingPayout(true)} className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                  {affiliate.paypal_email ? 'Edit' : 'Set Up'}
                </button>
              )}
            </div>
            {editingPayout ? (
              <div className="space-y-3">
                <input
                  type="email"
                  value={paypalEmail}
                  onChange={e => setPaypalEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-900 dark:text-white text-sm placeholder:text-zinc-400 focus:outline-none"
                  placeholder="PayPal email for payouts"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSavePayout}
                    disabled={savingPayout || !paypalEmail}
                    className="px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    {savingPayout ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Save
                  </button>
                  <button onClick={() => setEditingPayout(false)} className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 text-xs font-medium rounded-lg transition-colors hover:bg-zinc-200 dark:hover:bg-white/[0.08]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{affiliate.paypal_email || 'No payout method configured yet'}</p>
                <p className="text-zinc-400 dark:text-zinc-600 text-xs mt-0.5">PayPal</p>
              </>
            )}
          </div>
        </div>

        {/* Referrals table */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Referrals</span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-600">({referrals.length})</span>
            </div>
            <button
              onClick={loadDashboard}
              disabled={dashLoading}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${dashLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {referrals.length === 0 ? (
            <div className="p-10 sm:p-12 text-center">
              <Users className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
              <p className="text-zinc-600 dark:text-zinc-400 text-sm font-medium">No referrals yet</p>
              <p className="text-zinc-400 dark:text-zinc-600 text-xs mt-1">Share your link to start earning commissions</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-200 dark:border-zinc-800">
                      <th className="text-left px-5 py-2.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Email</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Signed Up</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Plan</th>
                      <th className="text-right px-5 py-2.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Monthly</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-100 dark:divide-zinc-900">
                    {referrals.map((ref, i) => (
                      <tr key={ref.id || i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                        <td className="px-5 py-3 text-zinc-700 dark:text-zinc-300 font-mono text-xs truncate max-w-[200px]">{ref.referred_email}</td>
                        <td className="px-5 py-3 text-zinc-500 text-xs">{ref.signed_up_at ? new Date(ref.signed_up_at).toLocaleDateString() : '-'}</td>
                        <td className="px-5 py-3"><StatusBadge status={ref.status} /></td>
                        <td className="px-5 py-3 text-zinc-500 text-xs capitalize">{ref.plan || '-'}</td>
                        <td className="px-5 py-3 text-right text-zinc-900 dark:text-white text-xs font-medium tabular-nums">
                          {ref.monthly_commission ? fmtUSDCents(ref.monthly_commission) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-zinc-100 dark:divide-white/[0.04]">
                {referrals.map((ref, i) => (
                  <div key={ref.id || i} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate">{ref.referred_email}</span>
                      <StatusBadge status={ref.status} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>{ref.signed_up_at ? new Date(ref.signed_up_at).toLocaleDateString() : '-'} &middot; {ref.plan || 'Free'}</span>
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{ref.monthly_commission ? `${fmtUSDCents(ref.monthly_commission)}/mo` : '-'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-zinc-400 dark:text-zinc-600 text-[11px]">
            Contndr Affiliate Program &middot; <a href="mailto:support@contndr.com" className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400 underline">support@contndr.com</a>
          </p>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    signup: { label: 'Signed Up', cls: 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-200 dark:border-zinc-200 dark:border-zinc-800' },
    converted: { label: 'Converted', cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
    active: { label: 'Active', cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
    churned: { label: 'Churned', cls: 'bg-zinc-100 dark:bg-zinc-900 text-zinc-400 border-zinc-200 dark:border-zinc-200 dark:border-zinc-800' },
  };
  const m = map[status] || map.signup;
  return <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded border ${m.cls}`}>{m.label}</span>;
}

function ThemeToggleButton({ themeMode, onCycle }: { themeMode: ThemeMode; onCycle: () => void }) {
  const Icon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Monitor;
  const label = themeMode === 'light' ? 'Light mode' : themeMode === 'dark' ? 'Dark mode' : 'System theme';
  return (
    <button
      onClick={onCycle}
      title={`${label} — click to switch`}
      className="p-1.5 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}