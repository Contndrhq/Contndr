// Rebuild trigger: 2026-03-04 — fix stale dynamic import chunk
import { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import { DollarSign, TrendingUp, Repeat, CreditCard, Users, RefreshCw, Settings, AlertTriangle, FileText, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { supabase } from '../lib/supabase';
import { fmtUSD as fmtUSDShared, fmtCentsToUSD, fmtUSDCents } from '../lib/format';
import { useTranslation } from 'react-i18next';
import { useDemoMode } from './DemoContext';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ─── Logos ───────────────────────────────────────────────────────────
function StripeLogo({ className = 'w-10 h-10', color = '#635BFF' }: { className?: string; color?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 18 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.542 9.15C8.37 8.344 7.186 7.724 7.186 6.741C7.186 5.91 7.869 5.436 9.087 5.436C11.314 5.436 13.602 6.294 15.177 7.067L16.067 1.573C14.818 0.975 12.263 0 8.731 0C6.233 0 4.155 0.654 2.67 1.872C1.126 3.147 0.323 4.992 0.323 7.218C0.323 11.257 2.79 12.978 6.799 14.437C9.384 15.357 10.244 16.011 10.244 17.02C10.244 18 9.404 18.565 7.89 18.565C6.015 18.565 2.925 17.644 0.9 16.456L0 22.011C1.741 22.99 4.951 24 8.28 24C10.921 24 13.123 23.376 14.608 22.187C16.272 20.882 17.133 18.951 17.133 16.455C17.133 12.327 14.609 10.604 10.539 9.15H10.542Z" fill={color}/>
    </svg>
  );
}

function QuickBooksLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 62 62" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30.77 61.54C47.76 61.54 61.54 47.76 61.54 30.77C61.54 13.78 47.76 0 30.77 0C13.78 0 0 13.78 0 30.77C0 47.76 13.77 61.54 30.77 61.54Z" fill="#2CA01C"/>
      <path d="M20.51 18.8C13.9 18.8 8.54004 24.16 8.54004 30.77C8.54004 37.38 13.89 42.73 20.51 42.73H22.22V38.29H20.51C16.36 38.29 12.99 34.92 12.99 30.77C12.99 26.62 16.36 23.25 20.51 23.25H24.62V46.5C24.62 48.95 26.61 50.94 29.06 50.94V18.8H20.51ZM41.03 42.73C47.64 42.73 53 37.37 53 30.77C53 24.17 47.65 18.81 41.03 18.81H39.32V23.25H41.03C45.18 23.25 48.55 26.62 48.55 30.77C48.55 34.92 45.18 38.29 41.03 38.29H36.92V15.04C36.92 12.59 34.93 10.6 32.48 10.6V42.73H41.03Z" fill="white"/>
    </svg>
  );
}

// ─── Types ───────────────────────────────────────────────���───────────
interface RevenueMetrics {
  brand: string;
  total_revenue: number;
  monthly_revenue: number;
  weekly_revenue: number;
  daily_revenue: number;
  mrr: number;
  arr: number;
  total_customers: number;
  active_subscriptions: number;
  churn_rate: number;
  avg_deal_size: number;
  conversion_rate: number;
  revenue_per_lead: number;
  updated_at: string;
}

interface ConversionFunnel {
  leads: number;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  customers: number;
  revenue: number;
  conversionRate: number;
}

interface PaymentRecord {
  id: string;
  brand: string;
  type: 'subscription' | 'one_time';
  customer_email: string;
  customer_name?: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending';
  lead_id?: string;
  campaign_id?: string;
  payment_intent_id?: string;
  checkout_session_id?: string;
  created_at: string;
}

interface QboMetrics {
  total_invoiced: number;
  total_received: number;
  total_outstanding: number;
  monthly_invoiced: number;
  monthly_received: number;
  weekly_received: number;
  daily_received: number;
  total_customers: number;
  total_invoices: number;
  paid_invoices: number;
  overdue_invoices: number;
  collection_rate: number;
}

interface QboInvoice {
  id: string;
  doc_number: string;
  customer: string;
  amount: number;
  balance: number;
  date: string;
  due_date: string;
  status: 'paid' | 'overdue' | 'open';
}

type RevenueSource = 'all' | 'stripe' | 'quickbooks';

interface RevenueProps {
  onNavigate?: (view: string) => void;
}

// ─── Demo Data (demo@contndr.com only) ──────────────────────────────
const DEMO_STRIPE_METRICS: RevenueMetrics = {
  brand: 'default',
  total_revenue: 284750,
  monthly_revenue: 47200,
  weekly_revenue: 11800,
  daily_revenue: 1690,
  mrr: 38400,
  arr: 460800,
  total_customers: 156,
  active_subscriptions: 89,
  churn_rate: 3.2,
  avg_deal_size: 1825,
  conversion_rate: 12.4,
  revenue_per_lead: 22.60,
  updated_at: new Date().toISOString(),
};

const DEMO_FUNNEL: ConversionFunnel = {
  leads: 12600,
  emailsSent: 8940,
  emailsOpened: 4025,
  emailsClicked: 1430,
  customers: 156,
  revenue: 28475000,
  conversionRate: 12.4,
};

const DEMO_PAYMENTS: PaymentRecord[] = [
  { id: 'pi_demo_001', brand: 'default', type: 'subscription', customer_email: 'sarah@meridiangroup.com', customer_name: 'Sarah Chen', amount: 39900, currency: 'usd', status: 'succeeded', created_at: '2026-02-19T09:14:00Z' },
  { id: 'pi_demo_002', brand: 'default', type: 'subscription', customer_email: 'james@northbridgecap.com', customer_name: 'James Park', amount: 19900, currency: 'usd', status: 'succeeded', created_at: '2026-02-18T16:42:00Z' },
  { id: 'pi_demo_003', brand: 'default', type: 'one_time', customer_email: 'lena@vividstudio.io', customer_name: 'Lena Vogt', amount: 9900, currency: 'usd', status: 'succeeded', created_at: '2026-02-18T11:08:00Z' },
  { id: 'pi_demo_004', brand: 'default', type: 'subscription', customer_email: 'marcus@helix.dev', customer_name: 'Marcus Rivera', amount: 39900, currency: 'usd', status: 'succeeded', created_at: '2026-02-17T20:33:00Z' },
  { id: 'pi_demo_005', brand: 'default', type: 'subscription', customer_email: 'anna@clearviewhq.com', customer_name: 'Anna Lindström', amount: 19900, currency: 'usd', status: 'succeeded', created_at: '2026-02-17T14:15:00Z' },
  { id: 'pi_demo_006', brand: 'default', type: 'one_time', customer_email: 'tom@blueforgeai.com', customer_name: 'Tom Nakamura', amount: 9900, currency: 'usd', status: 'succeeded', created_at: '2026-02-16T08:50:00Z' },
  { id: 'pi_demo_007', brand: 'default', type: 'subscription', customer_email: 'priya@elementcx.com', customer_name: 'Priya Sharma', amount: 39900, currency: 'usd', status: 'succeeded', created_at: '2026-02-15T13:22:00Z' },
  { id: 'pi_demo_008', brand: 'default', type: 'subscription', customer_email: 'david@coastalops.co', customer_name: 'David Morales', amount: 19900, currency: 'usd', status: 'failed', created_at: '2026-02-15T10:05:00Z' },
  { id: 'pi_demo_009', brand: 'default', type: 'subscription', customer_email: 'nina@arclight.agency', customer_name: 'Nina Petrova', amount: 39900, currency: 'usd', status: 'succeeded', created_at: '2026-02-14T17:44:00Z' },
  { id: 'pi_demo_010', brand: 'default', type: 'one_time', customer_email: 'ryan@pulsecrm.io', customer_name: 'Ryan Oduya', amount: 9900, currency: 'usd', status: 'succeeded', created_at: '2026-02-13T09:30:00Z' },
];

const DEMO_QBO_METRICS: QboMetrics = {
  total_invoiced: 372400,
  total_received: 318600,
  total_outstanding: 53800,
  monthly_invoiced: 62500,
  monthly_received: 48200,
  weekly_received: 12050,
  daily_received: 1720,
  total_customers: 64,
  total_invoices: 218,
  paid_invoices: 186,
  overdue_invoices: 7,
  collection_rate: 85.3,
};

const DEMO_QBO_INVOICES: QboInvoice[] = [
  { id: 'inv_demo_001', doc_number: '1047', customer: 'Meridian Group LLC', amount: 8500, balance: 0, date: '2026-02-12', due_date: '2026-03-14', status: 'paid' },
  { id: 'inv_demo_002', doc_number: '1046', customer: 'Northbridge Capital', amount: 12750, balance: 12750, date: '2026-02-10', due_date: '2026-03-12', status: 'open' },
  { id: 'inv_demo_003', doc_number: '1045', customer: 'Vivid Studio Inc', amount: 4200, balance: 0, date: '2026-02-08', due_date: '2026-03-10', status: 'paid' },
  { id: 'inv_demo_004', doc_number: '1044', customer: 'Helix Dev Co', amount: 18900, balance: 18900, date: '2026-01-15', due_date: '2026-02-14', status: 'overdue' },
  { id: 'inv_demo_005', doc_number: '1043', customer: 'ClearView HQ', amount: 6300, balance: 0, date: '2026-02-05', due_date: '2026-03-07', status: 'paid' },
  { id: 'inv_demo_006', doc_number: '1042', customer: 'BlueForge AI', amount: 15400, balance: 15400, date: '2026-01-20', due_date: '2026-02-19', status: 'overdue' },
  { id: 'inv_demo_007', doc_number: '1041', customer: 'Element CX', amount: 9800, balance: 0, date: '2026-02-01', due_date: '2026-03-03', status: 'paid' },
  { id: 'inv_demo_008', doc_number: '1040', customer: 'Coastal Ops', amount: 3500, balance: 0, date: '2026-01-28', due_date: '2026-02-27', status: 'paid' },
  { id: 'inv_demo_009', doc_number: '1039', customer: 'Arclight Agency', amount: 22000, balance: 22000, date: '2026-02-14', due_date: '2026-03-16', status: 'open' },
  { id: 'inv_demo_010', doc_number: '1038', customer: 'Pulse CRM', amount: 7600, balance: 0, date: '2026-01-25', due_date: '2026-02-24', status: 'paid' },
];

export function Revenue({ onNavigate }: RevenueProps = {}) {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  
  // ─── Stripe state ──────────────────────────────────────────────────
  const [revenueMetrics, setRevenueMetrics] = useState<RevenueMetrics | null>(null);
  const [conversionFunnel, setConversionFunnel] = useState<ConversionFunnel | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [showPayments, setShowPayments] = useState(false);
  const [stripeConnected, setStripeConnected] = useState<boolean | null>(null);

  // ─── QuickBooks state ──────────────────────────────────────────────
  const [qboConnected, setQboConnected] = useState<boolean | null>(null);
  const [qboMetrics, setQboMetrics] = useState<QboMetrics | null>(null);
  const [qboInvoices, setQboInvoices] = useState<QboInvoice[]>([]);
  const [qboCompanyName, setQboCompanyName] = useState<string>('');
  const [showInvoices, setShowInvoices] = useState(false);
  const [qboLastSync, setQboLastSync] = useState<string | null>(null);

  // ─── Shared state ─────────────────────────────────────────────────
  const [stripeLoading, setStripeLoading] = useState(true);
  const [qboLoading, setQboLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingQbo, setSyncingQbo] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [activeSource, setActiveSource] = useState<RevenueSource>('all');
  const [isDemoAccount, setIsDemoAccount] = useState(false);
  const dedupRanRef = useRef(false);

  const fmtUSD = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Memoized dedup of payments — avoids re-computing on every render
  const dedupedPayments = useMemo(() => {
    if (payments.length === 0) return payments;
    const seenPIs = new Set<string>();
    const seenFingerprints = new Set<string>();
    const result: PaymentRecord[] = [];
    for (const p of payments) {
      if (p.payment_intent_id && seenPIs.has(p.payment_intent_id)) continue;
      const ts = new Date(p.created_at).getTime();
      const bucket = Math.floor(ts / 300000) * 300000;
      const fp = `${p.customer_email}|${p.amount}|${bucket}`;
      if (seenFingerprints.has(fp)) continue;
      if (p.payment_intent_id) seenPIs.add(p.payment_intent_id);
      seenFingerprints.add(fp);
      result.push(p);
    }
    return result;
  }, [payments]);

  // ─── Check Stripe connection ───────────────────────────────────────
  const checkStripeConnection = useCallback(async () => {
    try {
      const data = await apiCache.fetch(
        'settings:stripe-config',
        async () => {
          const res = await authenticatedFetch(`${API_BASE}/settings/stripe-config`);
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      const connected = data.success && data.configured;
      setStripeConnected(connected);
      return connected;
    } catch (err) {
      console.error('Error checking Stripe connection:', err);
      setStripeConnected(false);
      return false;
    }
  }, []);

  // ─── Check QuickBooks connection ───────────────────────────────────
  const checkQboConnection = useCallback(async () => {
    try {
      const data = await apiCache.fetch(
        'qbo:revenue-status',
        async () => {
          const headers = await getAuthHeaders();
          if (!headers.Authorization) return { connected: false };
          const res = await fetch(`${API_BASE}/quickbooks/status`, { headers });
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      const connected = !!data?.connected;
      setQboConnected(connected);
      return connected;
    } catch (err) {
      console.error('Error checking QBO connection:', err);
      setQboConnected(false);
      return false;
    }
  }, []);

  // ─── Load Stripe data ─────────────────────────────────────────────
  async function loadStripeData(silentRefresh?: boolean) {
    try {
      const headers = await getAuthHeaders();
      const brand = 'default';
      // Use shorter cache for silent refreshes to get fresher data
      const staleTime = silentRefresh ? 15_000 : 30_000;

      const [metricsData, funnelData, paymentsData] = await Promise.all([
        apiCache.fetch(
          `revenue:metrics:${brand}`,
          async () => {
            const res = await fetch(`${API_BASE}/revenue/metrics?brand=${brand}`, { headers });
            if (!res.ok) throw new Error(`Metrics fetch failed: ${res.status}`);
            return res.json();
          },
          { staleTime: 30_000, cacheTime: 120_000 }
        ),
        apiCache.fetch(
          `revenue:funnel:${brand}`,
          async () => {
            const res = await fetch(`${API_BASE}/revenue/funnel?brand=${brand}`, { headers });
            if (!res.ok) throw new Error(`Funnel fetch failed: ${res.status}`);
            return res.json();
          },
          { staleTime: 30_000, cacheTime: 120_000 }
        ),
        apiCache.fetch(
          `revenue:payments:${brand}`,
          async () => {
            const res = await fetch(`${API_BASE}/revenue/payments?brand=${brand}`, { headers });
            if (!res.ok) throw new Error(`Payments fetch failed: ${res.status}`);
            return res.json();
          },
          { staleTime: 30_000, cacheTime: 120_000 }
        ),
      ]);

      if (metricsData.success) setRevenueMetrics(metricsData.metrics);
      if (funnelData.success) setConversionFunnel(funnelData.funnel);
      if (paymentsData.success) {
        setPayments(paymentsData.payments || []);
      }
    } catch (error) {
      console.error('Error loading Stripe revenue data:', error);
    } finally {
      setStripeLoading(false);
    }
  }

  // ─── Load QuickBooks data ─────────────────────────────────────────
  async function loadQboData() {
    try {
      const data = await apiCache.fetch(
        'qbo:revenue-summary',
        async () => {
          const headers = await getAuthHeaders();
          if (!headers.Authorization) return { connected: false };
          const res = await fetch(`${API_BASE}/quickbooks/revenue-summary`, { headers });
          if (!res.ok) throw new Error(`QBO revenue summary failed: ${res.status}`);
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );

      if (data?.success && data?.metrics) {
        setQboMetrics(data.metrics);
        setQboInvoices(data.recent_invoices || []);
        setQboCompanyName(data.company_name || '');
        setQboLastSync(data.last_sync_at || null);
      }
    } catch (error) {
      console.error('Error loading QBO revenue data:', error);
    } finally {
      setQboLoading(false);
    }
  }

  // ─── Seed demo data for demo@contndr.com ──────────────────────────
  function seedDemoData() {
    console.log('[DEMO] Seeding demo revenue data for showcase');
    setStripeConnected(true);
    setQboConnected(true);
    setRevenueMetrics(DEMO_STRIPE_METRICS);
    setConversionFunnel(DEMO_FUNNEL);
    setPayments(DEMO_PAYMENTS);
    setQboMetrics(DEMO_QBO_METRICS);
    setQboInvoices(DEMO_QBO_INVOICES);
    setQboCompanyName('Contndr Demo Corp');
    setQboLastSync(new Date().toISOString());
    setIsDemoAccount(true);
    setStripeLoading(false);
    setQboLoading(false);
  }

  // ─── Initial load ─────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      // Check if this is demo mode (sandbox or demo@contndr.com)
      if (isDemoMode) {
        seedDemoData();
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email === 'demo@contndr.com') {
          seedDemoData();
          return;
        }
      } catch (_) { /* non-fatal */ }

      // Check connections in parallel
      const [stripeOk, qboOk] = await Promise.all([
        checkStripeConnection(),
        checkQboConnection(),
      ]);

      // Load data progressively — each source finishes independently
      if (stripeOk) {
        loadStripeData().then(() => {
          // Fire-and-forget dedup — only once per session
          if (!dedupRanRef.current) {
            dedupRanRef.current = true;
            deduplicatePaymentsOnLoad();
          }
        });
      } else {
        setStripeLoading(false);
      }

      if (qboOk) {
        loadQboData();
      } else {
        setQboLoading(false);
      }
    }
    init();
  }, [checkStripeConnection, checkQboConnection, isDemoMode]);

  // ─── Auto-refresh when Stripe is connected (60s to reduce CPU usage) ─────
  useEffect(() => {
    if (!stripeConnected || isDemoAccount || isDemoMode) return;

    const interval = setInterval(() => loadStripeData(true), 60000);

    const kvChannel = supabase
      .channel('revenue-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'kv_store_a8b2511f', filter: 'key=like.payment:%|key=like.subscription:%' },
        () => loadStripeData(true)
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(kvChannel);
    };
  }, [stripeConnected, isDemoAccount]);

  // ─── Auto-refresh QBO every 60s ────────────────────────────────────
  useEffect(() => {
    if (!qboConnected || isDemoAccount || isDemoMode) return;
    const interval = setInterval(() => {
      apiCache.invalidate('qbo:revenue-summary');
      loadQboData();
    }, 60000);
    return () => clearInterval(interval);
  }, [qboConnected, isDemoAccount]);

  // ─── Stripe manual sync ───────────────────────────────────────────
  async function manualStripeSync() {
    if (isDemoAccount) {
      setSyncMessage('Demo mode — data refreshed');
      setTimeout(() => setSyncMessage(''), 3000);
      return;
    }
    setSyncing(true);
    setSyncMessage('Syncing with Stripe...');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/revenue/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ brand: 'default', days: 30 }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const count = data.results?.default?.synced || 0;
        setSyncMessage(`Synced ${count} recent payments from Stripe`);
        setTimeout(() => setSyncMessage(''), 5000);
        apiCache.invalidate('revenue:*');
        await loadStripeData();
      } else {
        const errorMsg = data.results?.default?.errors?.[0] || data.error || 'Sync failed. Please try again.';
        setSyncMessage(errorMsg);
        setTimeout(() => setSyncMessage(''), 5000);
      }
    } catch (error) {
      console.error('Error syncing Stripe:', error);
      setSyncMessage('Stripe sync error occurred');
      setTimeout(() => setSyncMessage(''), 5000);
    } finally {
      setSyncing(false);
    }
  }

  // ─── Deduplicate Stripe payments ──────────────────────────────────
  async function deduplicateStripePayments() {
    if (isDemoAccount) {
      setSyncMessage('Demo mode — no duplicates to remove');
      setTimeout(() => setSyncMessage(''), 3000);
      return;
    }
    setSyncing(true);
    setSyncMessage('Removing duplicate payments...');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/revenue/deduplicate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ brand: 'default' }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const count = data.duplicatesRemoved || 0;
        setSyncMessage(`Removed ${count} duplicate payment${count !== 1 ? 's' : ''}`);
        setTimeout(() => setSyncMessage(''), 5000);
        apiCache.invalidate('revenue:*');
        await loadStripeData();
      } else {
        const errorMsg = data.errors?.[0] || data.error || 'Deduplication failed';
        setSyncMessage(errorMsg);
        setTimeout(() => setSyncMessage(''), 5000);
      }
    } catch (error) {
      console.error('Error deduplicating payments:', error);
      setSyncMessage('Deduplication error occurred');
      setTimeout(() => setSyncMessage(''), 5000);
    } finally {
      setSyncing(false);
    }
  }

  // ─── QuickBooks manual sync ───────────────────────────────────────
  async function manualQboSync() {
    if (isDemoAccount) {
      setSyncMessage('Demo mode — data refreshed');
      setTimeout(() => setSyncMessage(''), 3000);
      return;
    }
    setSyncingQbo(true);
    setSyncMessage('Syncing with QuickBooks...');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/quickbooks/sync/now`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const inv = data.results?.invoices?.count || 0;
        const pmt = data.results?.payments?.count || 0;
        const cust = data.results?.customers?.count || 0;
        setSyncMessage(`QuickBooks synced: ${inv} invoices, ${pmt} payments, ${cust} customers`);
        setTimeout(() => setSyncMessage(''), 5000);
        apiCache.invalidate('qbo:*');
        await loadQboData();
      } else {
        setSyncMessage(data.error || 'QuickBooks sync failed.');
        setTimeout(() => setSyncMessage(''), 5000);
      }
    } catch (error) {
      console.error('Error syncing QBO:', error);
      setSyncMessage('QuickBooks sync error occurred');
      setTimeout(() => setSyncMessage(''), 5000);
    } finally {
      setSyncingQbo(false);
    }
  }

  async function deduplicatePaymentsOnLoad() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/revenue/deduplicate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ brand: 'default' }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.duplicates_removed > 0) {
        setSyncMessage(`Cleaned up ${data.duplicates_removed} duplicate payments`);
        setTimeout(() => setSyncMessage(''), 3000);
        apiCache.invalidate('revenue:*');
        await loadStripeData();
      }
    } catch (error) {
      console.error('Error auto-deduplicating:', error);
    }
  }

  const navigateToSettings = () => {
    if (onNavigate) {
      onNavigate('settings');
    } else {
      window.dispatchEvent(new CustomEvent('contndr-navigate', { detail: { view: 'settings', tab: 'integrations' } }));
    }
  };

  // Derived
  const anyConnected = stripeConnected || qboConnected;
  const bothConnected = stripeConnected && qboConnected;
  const showStripe = activeSource === 'all' || activeSource === 'stripe';
  const showQbo = activeSource === 'all' || activeSource === 'quickbooks';
  // Initial loading — only block render until we know connection status
  const initialLoading = stripeConnected === null && qboConnected === null;

  // ─── Loading skeleton — only shown while checking initial connection status ──
  if (initialLoading) {
    return (
      <div className="space-y-6 animate-fade-in p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-10 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-xl w-64" />
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-40 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-2xl" />
            ))}
          </div>
          <div className="h-96 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-2xl" />
        </div>
      </div>
    );
  }

  // ─── Neither connected — prompt to connect (wait until both are checked) ──
  if (!anyConnected && stripeConnected !== null && qboConnected !== null) {
    return (
      <div className="flex flex-col h-full p-4 sm:p-6 animate-fade-in overflow-y-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('revenuePage.title')}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('revenuePage.subtitle')}</p>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-lg w-full text-center space-y-8">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">{t('revenuePage.connectSource')}</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {t('revenuePage.connectSourceDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Stripe card */}
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 text-left space-y-4">
                <div className="w-14 h-14 rounded-xl bg-[#635BFF]/10 flex items-center justify-center">
                  <StripeLogo className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Stripe</h3>
                  <p className="text-xs text-zinc-500 mt-1">{t('revenuePage.stripeDesc')}</p>
                </div>
                <div className="space-y-2 text-left">
                  {[
                    { icon: TrendingUp, label: t('revenuePage.stripeFeature1') },
                    { icon: Repeat, label: t('revenuePage.stripeFeature2') },
                    { icon: CreditCard, label: t('revenuePage.stripeFeature3') },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      <Icon className="w-3 h-3 text-zinc-400" />
                      <span className="text-[11px] text-zinc-500">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* QuickBooks card */}
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 text-left space-y-4">
                <div className="w-14 h-14 rounded-xl bg-[#2CA01C]/10 flex items-center justify-center">
                  <QuickBooksLogo className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">QuickBooks</h3>
                  <p className="text-xs text-zinc-500 mt-1">{t('revenuePage.qboDesc')}</p>
                </div>
                <div className="space-y-2 text-left">
                  {[
                    { icon: FileText, label: t('revenuePage.qboFeature1') },
                    { icon: DollarSign, label: t('revenuePage.qboFeature2') },
                    { icon: AlertCircle, label: t('revenuePage.qboFeature3') },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      <Icon className="w-3 h-3 text-zinc-400" />
                      <span className="text-[11px] text-zinc-500">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={navigateToSettings}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors shadow-sm"
            >
              <Settings className="w-4 h-4" />
              {t('revenuePage.goToSettings')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Connected — show revenue data ─────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-transparent overflow-y-auto">
      <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-6 animate-fade-in">
        {syncMessage && (
          <div className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg px-4 py-3 text-[13px] text-[#1ED4A7]">
            {syncMessage}
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{t('revenuePage.title')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {t('revenuePage.trackPerformance')}
              {isDemoAccount && <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-500">Demo</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Connection indicators */}
            {stripeConnected && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="w-2 h-2 rounded-full bg-[#635BFF] animate-pulse" />
                Stripe
              </div>
            )}
            {qboConnected && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="w-2 h-2 rounded-full bg-[#2CA01C] animate-pulse" />
                QuickBooks{qboCompanyName ? ` (${qboCompanyName})` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Source tabs — only show when both connected */}
        {bothConnected && (
          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-lg w-fit">
            {([
              { key: 'all', label: t('revenuePage.allSources') },
              { key: 'stripe', label: 'Stripe', icon: <StripeLogo className="w-3.5 h-3.5" /> },
              { key: 'quickbooks', label: 'QuickBooks', icon: <QuickBooksLogo className="w-3.5 h-3.5" /> },
            ] as { key: RevenueSource; label: string; icon?: React.ReactNode }[]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveSource(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeSource === tab.key
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STRIPE SECTION                                                 */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {stripeConnected && showStripe && (
          <>
            {/* Stripe section header */}
            {bothConnected && activeSource === 'all' && (
              <div className="flex items-center gap-2 pt-2">
                <StripeLogo className="w-4 h-4" />
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">Stripe</h2>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                <button
                  onClick={manualStripeSync}
                  disabled={syncing}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    syncing
                      ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed'
                      : 'bg-[#635BFF]/10 text-[#635BFF] hover:bg-[#635BFF]/20'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? t('revenuePage.syncing') : t('revenuePage.sync')}
                </button>
              </div>
            )}

            {/* Sync button when viewing Stripe only */}
            {(!bothConnected || activeSource === 'stripe') && (
              <div className="flex items-center gap-3">
                <button
                  onClick={manualStripeSync}
                  disabled={syncing}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    syncing
                      ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed'
                      : 'bg-[#1ED4A7]/10 text-[#1ED4A7] hover:bg-[#1ED4A7]/20'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? t('revenuePage.syncing') : t('revenuePage.syncStripe')}
                </button>
              </div>
            )}

            {revenueMetrics && (
              <>
                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  <StatCard
                    title={t('revenuePage.totalRevenue')}
                    value={fmtUSD(revenueMetrics.total_revenue || 0)}
                    icon={DollarSign}
                    color="text-[#1ED4A7]"
                    subtitle={t('revenuePage.allTime')}
                  />
                  <StatCard
                    title={t('revenuePage.thisMonth')}
                    value={fmtUSD(revenueMetrics.monthly_revenue || 0)}
                    icon={TrendingUp}
                    color="text-[#1ED4A7]"
                  />
                  <StatCard
                    title={t('revenuePage.mrr')}
                    value={fmtUSD(revenueMetrics.mrr || 0)}
                    icon={Repeat}
                    color="text-[#1ED4A7]"
                    subtitle={t('revenuePage.monthlyRecurring')}
                  />
                  <StatCard
                    title={t('revenuePage.activeSubscriptions')}
                    value={(revenueMetrics.active_subscriptions || 0).toLocaleString()}
                    icon={CreditCard}
                    color="text-zinc-500 dark:text-zinc-400"
                    subtitle={revenueMetrics.churn_rate > 0 ? t('revenuePage.churnPct', { rate: revenueMetrics.churn_rate.toFixed(1) }) : undefined}
                  />
                  <StatCard
                    title={t('revenuePage.totalCustomers')}
                    value={(revenueMetrics.total_customers || 0).toLocaleString()}
                    icon={Users}
                    color="text-zinc-500 dark:text-zinc-400"
                    subtitle={t('revenuePage.conversionPct', { rate: (revenueMetrics.conversion_rate || 0).toFixed(1) })}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {conversionFunnel && (
                    <>
                      <div className="lg:col-span-2 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-6">{t('revenuePage.conversionFunnel')}</h2>
                        <div className="space-y-6">
                          <FunnelStage label={t('revenuePage.leadsImported')} value={conversionFunnel.leads} percentage={100} color="bg-zinc-200 dark:bg-zinc-800" />
                          <FunnelStage label={t('revenuePage.emailsSent')} value={conversionFunnel.emailsSent} percentage={conversionFunnel.leads > 0 ? (conversionFunnel.emailsSent / conversionFunnel.leads) * 100 : 0} color="bg-zinc-400 dark:bg-zinc-700" />
                          <FunnelStage label={t('revenuePage.emailsOpened')} value={conversionFunnel.emailsOpened} percentage={conversionFunnel.leads > 0 ? (conversionFunnel.emailsOpened / conversionFunnel.leads) * 100 : 0} color="bg-zinc-500 dark:bg-zinc-600" />
                          <FunnelStage label={t('revenuePage.emailsClicked')} value={conversionFunnel.emailsClicked} percentage={conversionFunnel.leads > 0 ? (conversionFunnel.emailsClicked / conversionFunnel.leads) * 100 : 0} color="bg-zinc-600 dark:bg-zinc-500" />
                          <FunnelStage label={t('revenuePage.customers')} value={conversionFunnel.customers} percentage={conversionFunnel.conversionRate} color="bg-[#1ED4A7]" revenue={conversionFunnel.revenue} />
                        </div>
                      </div>
                      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-6">{t('revenuePage.performance')}</h3>
                        <div className="space-y-5">
                          <MetricRow label={t('revenuePage.dailyRevenue')} value={fmtUSD(revenueMetrics.daily_revenue || 0)} />
                          <MetricRow label={t('revenuePage.weeklyRevenue')} value={fmtUSD(revenueMetrics.weekly_revenue || 0)} />
                          <MetricRow label={t('revenuePage.monthlyRevenue')} value={fmtUSD(revenueMetrics.monthly_revenue || 0)} />
                          <MetricRow label={t('revenuePage.revenuePerLead')} value={fmtUSDCents(revenueMetrics.revenue_per_lead || 0)} />
                          <MetricRow label={t('revenuePage.conversionRate')} value={`${(revenueMetrics.conversion_rate || 0).toFixed(2)}%`} />
                          {revenueMetrics.churn_rate > 0 && (
                            <MetricRow label={t('revenuePage.churnRateLabel')} value={`${revenueMetrics.churn_rate.toFixed(1)}%`} highlight />
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Stripe loading skeleton */}
            {stripeLoading && !revenueMetrics && (
              <div className="animate-pulse space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-32 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-xl" />
                  ))}
                </div>
                <div className="h-64 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-xl" />
              </div>
            )}

            {/* Stripe empty state */}
            {!revenueMetrics && !stripeLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center space-y-4 max-w-sm">
                  <div className="mx-auto w-14 h-14 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{t('revenuePage.noStripeData')}</p>
                    <p className="text-xs text-zinc-500 mt-1">{t('revenuePage.noStripeDataDesc')}</p>
                  </div>
                  <button
                    onClick={manualStripeSync}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#1ED4A7]/10 text-[#1ED4A7] hover:bg-[#1ED4A7]/20 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? t('revenuePage.syncing') : t('revenuePage.syncNow')}
                  </button>
                </div>
              </div>
            )}

            {/* Stripe Payments List */}
            {dedupedPayments.length > 0 && (
              <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{t('revenuePage.recentPayments')}</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowPayments(!showPayments)}
                      className="text-sm font-medium text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                    >
                      {showPayments ? t('revenuePage.hide') : t('revenuePage.showAll')}
                    </button>
                  </div>
                </div>
                {(showPayments ? dedupedPayments : dedupedPayments.slice(0, 5)).map((payment) => (
                  <div key={payment.id} className="p-4 border-b border-zinc-100 dark:border-zinc-800/50 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-zinc-900 dark:text-white">{payment.customer_name || payment.customer_email}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {new Date(payment.created_at).toLocaleDateString()} &bull; {t(`common.paymentType.${payment.type}`)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white tabular-nums">
                          {fmtCentsToUSD(payment.amount)}
                        </span>
                        <span className={`block text-[10px] font-medium mt-0.5 ${
                          payment.status === 'succeeded' ? 'text-[#1ED4A7]' :
                          payment.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                        }`}>
                          {t(`common.paymentStatus.${payment.status}`)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════��� */}
        {/* QUICKBOOKS SECTION                                             */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {qboConnected && showQbo && (
          <>
            {/* QBO section header */}
            {bothConnected && activeSource === 'all' && (
              <div className="flex items-center gap-2 pt-4">
                <QuickBooksLogo className="w-4 h-4" />
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">QuickBooks</h2>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                <button
                  onClick={manualQboSync}
                  disabled={syncingQbo}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    syncingQbo
                      ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed'
                      : 'bg-[#2CA01C]/10 text-[#2CA01C] hover:bg-[#2CA01C]/20'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${syncingQbo ? 'animate-spin' : ''}`} />
                  {syncingQbo ? t('revenuePage.syncing') : t('revenuePage.sync')}
                </button>
              </div>
            )}

            {/* Sync button when viewing QBO only */}
            {(!bothConnected || activeSource === 'quickbooks') && (
              <div className="flex items-center gap-3">
                <button
                  onClick={manualQboSync}
                  disabled={syncingQbo}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    syncingQbo
                      ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed'
                      : 'bg-[#2CA01C]/10 text-[#2CA01C] hover:bg-[#2CA01C]/20'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${syncingQbo ? 'animate-spin' : ''}`} />
                  {syncingQbo ? t('revenuePage.syncing') : t('revenuePage.syncQuickBooks')}
                </button>
                {qboLastSync && (
                  <span className="text-[11px] text-zinc-400">
                    {t('revenuePage.lastSynced', { time: new Date(qboLastSync).toLocaleString() })}
                  </span>
                )}
              </div>
            )}

            {qboMetrics && (
              <>
                {/* QBO Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  <StatCard
                    title={t('revenuePage.totalInvoiced')}
                    value={fmtUSD(qboMetrics.total_invoiced)}
                    icon={FileText}
                    color="text-[#2CA01C]"
                    subtitle={t('revenuePage.allTime')}
                  />
                  <StatCard
                    title={t('revenuePage.totalReceived')}
                    value={fmtUSD(qboMetrics.total_received)}
                    icon={DollarSign}
                    color="text-[#2CA01C]"
                    subtitle={t('revenuePage.paymentsCollected')}
                  />
                  <StatCard
                    title={t('revenuePage.outstanding')}
                    value={fmtUSD(qboMetrics.total_outstanding)}
                    icon={Clock}
                    color={qboMetrics.total_outstanding > 0 ? 'text-amber-500' : 'text-zinc-400'}
                    subtitle={qboMetrics.overdue_invoices > 0 ? t('revenuePage.overdueCount', { count: qboMetrics.overdue_invoices }) : t('revenuePage.noOverdue')}
                  />
                  <StatCard
                    title={t('revenuePage.thisMonth')}
                    value={fmtUSD(qboMetrics.monthly_received)}
                    icon={TrendingUp}
                    color="text-[#2CA01C]"
                    subtitle={t('revenuePage.invoicedAmount', { amount: fmtUSD(qboMetrics.monthly_invoiced) })}
                  />
                  <StatCard
                    title={t('revenuePage.collectionRate')}
                    value={`${qboMetrics.collection_rate.toFixed(1)}%`}
                    icon={CheckCircle2}
                    color={qboMetrics.collection_rate >= 80 ? 'text-[#2CA01C]' : 'text-amber-500'}
                    subtitle={t('revenuePage.invoicesPaid', { paid: qboMetrics.paid_invoices, total: qboMetrics.total_invoices })}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* QBO Summary Metrics */}
                  <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-6">{t('revenuePage.qboPerformance')}</h3>
                    <div className="space-y-5">
                      <MetricRow label={t('revenuePage.dailyReceived')} value={fmtUSD(qboMetrics.daily_received)} />
                      <MetricRow label={t('revenuePage.weeklyReceived')} value={fmtUSD(qboMetrics.weekly_received)} />
                      <MetricRow label={t('revenuePage.monthlyReceived')} value={fmtUSD(qboMetrics.monthly_received)} />
                      <MetricRow label={t('revenuePage.totalCustomers')} value={qboMetrics.total_customers.toLocaleString()} />
                      <MetricRow label={t('revenuePage.totalInvoices')} value={qboMetrics.total_invoices.toLocaleString()} />
                      {qboMetrics.overdue_invoices > 0 && (
                        <MetricRow label={t('revenuePage.overdueInvoices')} value={qboMetrics.overdue_invoices.toLocaleString()} highlight />
                      )}
                    </div>
                  </div>

                  {/* Invoice Breakdown visual */}
                  <div className="lg:col-span-2 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-6">{t('revenuePage.invoiceBreakdown')}</h3>
                    <div className="space-y-6">
                      <FunnelStage
                        label={t('revenuePage.totalInvoiced')}
                        value={qboMetrics.total_invoices}
                        percentage={100}
                        color="bg-zinc-200 dark:bg-zinc-800"
                      />
                      <FunnelStage
                        label={t('revenuePage.paid')}
                        value={qboMetrics.paid_invoices}
                        percentage={qboMetrics.total_invoices > 0 ? (qboMetrics.paid_invoices / qboMetrics.total_invoices) * 100 : 0}
                        color="bg-[#2CA01C]"
                        revenue={qboMetrics.total_received * 100}
                      />
                      <FunnelStage
                        label={t('revenuePage.outstanding')}
                        value={qboMetrics.total_invoices - qboMetrics.paid_invoices}
                        percentage={qboMetrics.total_invoices > 0 ? ((qboMetrics.total_invoices - qboMetrics.paid_invoices) / qboMetrics.total_invoices) * 100 : 0}
                        color="bg-amber-400 dark:bg-amber-500"
                        revenue={qboMetrics.total_outstanding * 100}
                      />
                      {qboMetrics.overdue_invoices > 0 && (
                        <FunnelStage
                          label={t('revenuePage.overdue')}
                          value={qboMetrics.overdue_invoices}
                          percentage={qboMetrics.total_invoices > 0 ? (qboMetrics.overdue_invoices / qboMetrics.total_invoices) * 100 : 0}
                          color="bg-red-400 dark:bg-red-500"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* QBO loading skeleton */}
            {qboLoading && !qboMetrics && (
              <div className="animate-pulse space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-32 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-xl" />
                  ))}
                </div>
              </div>
            )}

            {/* QBO empty state */}
            {!qboMetrics && !qboLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center space-y-4 max-w-sm">
                  <div className="mx-auto w-14 h-14 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{t('revenuePage.noQboData')}</p>
                    <p className="text-xs text-zinc-500 mt-1">{t('revenuePage.noQboDataDesc')}</p>
                  </div>
                  <button
                    onClick={manualQboSync}
                    disabled={syncingQbo}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#2CA01C]/10 text-[#2CA01C] hover:bg-[#2CA01C]/20 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingQbo ? 'animate-spin' : ''}`} />
                    {syncingQbo ? t('revenuePage.syncing') : t('revenuePage.syncNow')}
                  </button>
                </div>
              </div>
            )}

            {/* QBO Recent Invoices */}
            {qboInvoices.length > 0 && (
              <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{t('revenuePage.recentInvoices')}</h3>
                  <button
                    onClick={() => setShowInvoices(!showInvoices)}
                    className="text-sm font-medium text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                  >
                    {showInvoices ? t('revenuePage.hide') : t('revenuePage.showAll')}
                  </button>
                </div>
                {(showInvoices ? qboInvoices : qboInvoices.slice(0, 5)).map((inv) => (
                  <div key={inv.id} className="p-4 border-b border-zinc-100 dark:border-zinc-800/50 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-zinc-900 dark:text-white">
                          {inv.customer}
                          {inv.doc_number && <span className="text-zinc-400 ml-2 font-normal">#{inv.doc_number}</span>}
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {inv.date ? new Date(inv.date).toLocaleDateString() : '—'}
                          {inv.due_date && <> &bull; {t('revenuePage.due')} {new Date(inv.due_date).toLocaleDateString()}</>}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white tabular-nums">
                          {fmtUSDCents(inv.amount)}
                        </span>
                        <span className={`block text-[10px] font-medium mt-0.5 ${
                          inv.status === 'paid' ? 'text-[#2CA01C]' :
                          inv.status === 'overdue' ? 'text-red-400' : 'text-amber-400'
                        }`}>
                          {t(`common.invoiceStatus.${inv.status}`)}{inv.balance > 0 && inv.status !== 'paid' ? ` (${t('common.balanceDue', { amount: fmtUSDCents(inv.balance) })})` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ─── Upsell card for the missing source ──────────────────────── */}
        {!bothConnected && !isDemoAccount && (
          <div className="bg-white dark:bg-zinc-950 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: !stripeConnected ? 'rgba(99,91,255,0.1)' : 'rgba(44,160,28,0.1)' }}>
              {!stripeConnected ? <StripeLogo className="w-5 h-5" /> : <QuickBooksLogo className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-white">
                {!stripeConnected ? t('revenuePage.connectStripeUpsell') : t('revenuePage.connectQboUpsell')}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {!stripeConnected
                  ? t('revenuePage.connectStripeUpsellDesc')
                  : t('revenuePage.connectQboUpsellDesc')}
              </p>
            </div>
            <button
              onClick={navigateToSettings}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              <Settings className="w-3 h-3" />
              {t('revenuePage.connect')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────

const StatCard = memo(function StatCard({ title, value, icon: Icon, color, subtitle }: { title: string; value: string; icon: any; color: string; subtitle?: string }) {
  return (
    <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 p-5 rounded-xl">
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{value}</p>
      {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
    </div>
  );
});

const FunnelStage = memo(function FunnelStage({ label, value, percentage, color, revenue }: { label: string; value: number; percentage: number; color: string; revenue?: number }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="font-medium text-zinc-900 dark:text-white">{value.toLocaleString()}</span>
      </div>
      <div className="w-full bg-zinc-100 dark:bg-zinc-900 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(percentage || 0, 100)}%` }} />
      </div>
      <div className="flex justify-between text-xs text-zinc-500 mt-1">
        <span>{(percentage || 0).toFixed(1)}% {t('revenuePage.conversion')}</span>
        {revenue !== undefined && <span>{fmtCentsToUSD(revenue)}</span>}
      </div>
    </div>
  );
});

const MetricRow = memo(function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}`}>{value}</span>
    </div>
  );
});

export default Revenue;