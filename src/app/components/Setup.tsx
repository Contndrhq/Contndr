import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, Copy, RefreshCw } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

interface WebhookStatus {
  name: string;
  configured: boolean;
  receiving_events: boolean;
  webhook_url: string;
  message: string;
  setup_instructions?: {
    step1: string;
    step2: string;
    step3: string;
    step4: string;
  };
  status?: {
    signing_secret_configured?: boolean;
    recent_events_count?: number;
    last_event_at?: string;
  };
}

export function Setup() {
  const [resendStatus, setResendStatus] = useState<WebhookStatus | null>(null);
  const [stripeRoadrStatus, setStripeRoadrStatus] = useState<any>(null);
  const [stripeSourcrStatus, setStripeSourcrStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  async function checkResendWebhook(silent?: boolean) {
    if (!silent) setLoading(true);
    try {
      const headers = await getAuthHeaders();
      
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/resend/webhook/status`,
        { headers }
      );

      const data = await res.json();
      
      if (res.ok) {
        setResendStatus({
          name: 'Resend Email Tracking',
          configured: data.configured,
          receiving_events: data.receiving_events,
          webhook_url: `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/webhooks/resend-v2`,
          message: data.message,
          setup_instructions: data.setup_instructions,
          status: data.status
        });
      }
    } catch (error) {
      console.error('Error checking Resend webhook:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function checkStripeWebhooks(silent?: boolean) {
    if (!silent) setLoading(true);
    try {
      const headers = await getAuthHeaders();
      
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/stripe/webhook/status`,
        { headers }
      );

      const data = await res.json();
      
      if (res.ok) {
        setStripeRoadrStatus({
          name: 'Stripe Roadr',
          webhook_url: `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/stripe/webhook/roadr`,
          ...data.status
        });
        
        setStripeSourcrStatus({
          name: 'Stripe Sourcr',
          webhook_url: `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/stripe/webhook/sourcr`,
          ...data.status
        });
      }
    } catch (error) {
      console.error('Error checking Stripe webhooks:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function checkAllWebhooks(silent?: boolean) {
    await Promise.all([
      checkResendWebhook(silent),
      checkStripeWebhooks(silent)
    ]);
    setLastRefresh(new Date());
  }

  function copyToClipboard(text: string, label: string) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        setCopiedUrl(label);
        setTimeout(() => setCopiedUrl(null), 2000);
      } else {
        // Fallback for browsers without clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          setCopiedUrl(label);
          setTimeout(() => setCopiedUrl(null), 2000);
        } catch (err) {
          console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  }

  useEffect(() => {
    checkAllWebhooks();
    
    // Auto-refresh webhook status every 30 seconds
    const refreshInterval = setInterval(() => {
      checkAllWebhooks(true);
    }, 30000); // 30 seconds
    
    return () => {
      clearInterval(refreshInterval);
    };
  }, []);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-900/30 via-black to-zinc-900/30 rounded-2xl opacity-50" />
        <div className="relative px-8 py-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="mb-1 text-[var(--foreground)]">Webhook Setup & Configuration</h1>
              <p className="text-[var(--foreground-muted)] text-[14px]">
                Configure email tracking and payment webhooks for real-time automation
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                🔄 Auto-refreshes every 30 seconds • Last updated: {lastRefresh.toLocaleTimeString()}
              </p>
            </div>
            <button
              onClick={() => checkAllWebhooks()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-[#1ED4A7] hover:bg-[#1ED4A7]/90 text-black rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Check All Webhooks
            </button>
          </div>
        </div>
      </div>

      {/* Resend Email Tracking Webhook */}
      <WebhookCard
        title="Resend Email Tracking Webhook"
        description="Automatically tracks email opens, clicks, bounces, and deliveries"
        status={resendStatus}
        onCheck={checkResendWebhook}
        loading={loading}
        onCopyUrl={(url) => copyToClipboard(url, 'resend')}
        copied={copiedUrl === 'resend'}
      />

      {/* Stripe Roadr Webhook */}
      {stripeRoadrStatus && (
        <StripeWebhookCard
          title="Stripe Roadr Webhook"
          description="Tracks subscription payments for Roadr auto repair shops"
          status={stripeRoadrStatus}
          onCopyUrl={(url) => copyToClipboard(url, 'roadr')}
          copied={copiedUrl === 'roadr'}
        />
      )}

      {/* Stripe Sourcr Webhook */}
      {stripeSourcrStatus && (
        <StripeWebhookCard
          title="Stripe Sourcr Webhook"
          description="Tracks subscription payments for Sourcr premium websites"
          status={stripeSourcrStatus}
          onCopyUrl={(url) => copyToClipboard(url, 'sourcr')}
          copied={copiedUrl === 'sourcr'}
        />
      )}
    </div>
  );
}

interface WebhookCardProps {
  title: string;
  description: string;
  status: WebhookStatus | null;
  onCheck: () => void;
  loading: boolean;
  onCopyUrl: (url: string) => void;
  copied: boolean;
}

function WebhookCard({ title, description, status, onCheck, loading, onCopyUrl, copied }: WebhookCardProps) {
  const isConfigured = status?.configured;
  const isReceiving = status?.receiving_events;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[var(--border)] p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-[var(--foreground)] mb-1">{title}</h3>
          <p className="text-[13px] text-[var(--foreground-muted)]">{description}</p>
        </div>
        <button
          onClick={onCheck}
          disabled={loading}
          className="px-4 py-2 text-[13px] bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Check Status'}
        </button>
      </div>

      {status && (
        <div className="space-y-4">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            {isConfigured && isReceiving ? (
              <>
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-[13px] font-medium text-green-600 dark:text-green-400">
                  {status.message}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
                  {status.message}
                </span>
              </>
            )}
          </div>

          {/* Webhook URL */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                Webhook Endpoint URL
              </label>
              <button
                onClick={() => onCopyUrl(status.webhook_url)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <code className="text-[12px] text-[#1ED4A7] break-all">
              {status.webhook_url}
            </code>
          </div>

          {/* Stats */}
          {status.status && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold mb-1">
                  Signing Secret
                </p>
                <p className="text-[15px] font-medium text-[var(--foreground)]">
                  {status.status.signing_secret_configured ? (
                    <span className="text-green-600 dark:text-green-400">Configured ✓</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">Not Set ✗</span>
                  )}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold mb-1">
                  Recent Events
                </p>
                <p className="text-[15px] font-medium text-[var(--foreground)]">
                  {status.status.recent_events_count || 0}
                </p>
              </div>
            </div>
          )}

          {/* Setup Instructions */}
          {!isReceiving && status.setup_instructions && (
            <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <h4 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
                📋 Setup Instructions
              </h4>
              <ol className="space-y-2 text-[12px] text-zinc-700 dark:text-zinc-300">
                <li className="flex gap-2">
                  <span className="font-semibold">1.</span>
                  <span>{status.setup_instructions.step1}</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">2.</span>
                  <span>{status.setup_instructions.step2}</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">3.</span>
                  <span>{status.setup_instructions.step3}</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">4.</span>
                  <span>{status.setup_instructions.step4}</span>
                </li>
              </ol>
              <a
                href="https://resend.com/webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-[#1ED4A7] hover:bg-[#1ED4A7]/90 text-black text-[12px] rounded-lg transition-colors font-medium"
              >
                Open Resend Dashboard
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface StripeWebhookCardProps {
  title: string;
  description: string;
  status: any;
  onCopyUrl: (url: string) => void;
  copied: boolean;
}

function StripeWebhookCard({ title, description, status, onCopyUrl, copied }: StripeWebhookCardProps) {
  const isValid = status.roadr_api_key_valid || status.sourcr_api_key_valid;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[var(--border)] p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-[var(--foreground)] mb-1">{title}</h3>
          <p className="text-[13px] text-[var(--foreground-muted)]">{description}</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {isValid ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-[13px] font-medium text-green-600 dark:text-green-400">
                API Keys configured and valid
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
                API Keys need configuration
              </span>
            </>
          )}
        </div>

        {/* Webhook URL */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
              Webhook Endpoint URL
            </label>
            <button
              onClick={() => onCopyUrl(status.webhook_url)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              {copied ? (
                <>
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy
                </>
              )}
            </button>
          </div>
          <code className="text-[12px] text-[#1ED4A7] break-all">
            {status.webhook_url}
          </code>
        </div>

        {/* Setup Instructions */}
        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            📋 Setup Instructions
          </h4>
          <ol className="space-y-2 text-[12px] text-zinc-700 dark:text-zinc-300">
            <li className="flex gap-2">
              <span className="font-semibold">1.</span>
              <span>Go to Stripe Dashboard → Developers → Webhooks</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold">2.</span>
              <span>Click "Add endpoint" and paste the webhook URL above</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold">3.</span>
              <span>Select events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold">4.</span>
              <span>Copy the Signing Secret and add it to STRIPE_WEBHOOK_SECRET_{title.includes('Roadr') ? 'ROADR' : 'SOURCR'} in Supabase</span>
            </li>
          </ol>
          <a
            href="https://dashboard.stripe.com/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-[#1ED4A7] hover:bg-[#1ED4A7]/90 text-black text-[12px] rounded-lg transition-colors font-medium"
          >
            Open Stripe Dashboard
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}