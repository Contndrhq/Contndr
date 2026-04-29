/**
 * TelnyxSetupWizard — Guided multi-step onboarding for Telnyx telephony integration.
 * Matches the Contndr dark zinc + teal (#1ED4A7) design system.
 *
 * Steps:
 *   1. Welcome — Create a Telnyx account (link out)
 *   2. API Key — Enter V2 API key
 *   3. Connection ID — Enter TeXML or Call Control app ID
 *   4. Verify & Sync — Test connection, auto-sync phone numbers
 */

import { useState, useEffect } from 'react';
import {
  Key,
  Save,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Phone,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Plug,
  Zap,
  Shield,
  Copy,
  Check,
  XCircle,
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface TelnyxApiKeySetupProps {
  onComplete: () => void;
}

type Step = 'welcome' | 'api_key' | 'connection_id' | 'verify';

// ─── Telnyx Brand Logo ────────────────────────────────────────────────
function TelnyxLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 90 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M45.009 0L23.822 37.329H66.178L45.009 0ZM18.534 50.677L0 80H37.068V50.677H18.534ZM52.95 50.677H71.484L90 80H52.95V50.677Z" fill="#31B886"/>
    </svg>
  );
}

export function TelnyxApiKeySetup({ onComplete }: TelnyxApiKeySetupProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [apiKey, setApiKey] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string; numbers?: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // Check if already partially configured
  useEffect(() => {
    checkExisting();
  }, []);

  async function checkExisting() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/telnyx/config`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.config?.api_key_configured) {
          // Already have API key, skip to connection ID or verify
          if (data.config?.connection_id_configured) {
            setStep('verify');
          } else {
            setStep('connection_id');
          }
        }
      }
    } catch {
      // Start from beginning
    }
  }

  async function handleSaveApiKey() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/telnyx/config`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });

      if (res.ok) {
        toast.success('API key saved');
        setStep('connection_id');
      } else {
        const data = await res.json();
        toast.error('Failed to save API key', { description: data.error });
      }
    } catch (err: any) {
      console.error('[TelnyxSetup] Save API key error:', err);
      toast.error('Failed to save API key');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveConnectionId() {
    if (!connectionId.trim()) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/telnyx/config`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connectionId.trim() }),
      });

      if (res.ok) {
        toast.success('Connection ID saved');
        setStep('verify');
        // Auto-verify after saving
        setTimeout(() => handleVerify(), 500);
      } else {
        const data = await res.json();
        toast.error('Failed to save Connection ID', { description: data.error });
      }
    } catch (err: any) {
      console.error('[TelnyxSetup] Save connection ID error:', err);
      toast.error('Failed to save Connection ID');
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const headers = await getAuthHeaders();

      // 1. Check config
      const configRes = await fetch(`${API_BASE}/telnyx/config`, { headers });
      if (!configRes.ok) throw new Error('Could not reach Telnyx config endpoint');
      const configData = await configRes.json();

      if (!configData.config?.api_key_configured) {
        setVerifyResult({ ok: false, message: 'API key not configured. Please go back and enter your key.' });
        setVerifying(false);
        return;
      }

      if (configData.config?.account_status !== 'active') {
        setVerifyResult({ ok: false, message: 'Telnyx account is not active. Please check your API key and account status.' });
        setVerifying(false);
        return;
      }

      // 2. Sync phone numbers
      const syncRes = await fetch(`${API_BASE}/telnyx/numbers/sync`, { method: 'POST', headers });
      const numbersRes = await fetch(`${API_BASE}/telnyx/numbers`, { headers });
      let numberCount = 0;
      if (numbersRes.ok) {
        const numbersData = await numbersRes.json();
        numberCount = (numbersData.numbers || []).filter((n: any) => n !== null).length;
      }

      setVerifyResult({
        ok: true,
        message: numberCount > 0
          ? `Connected successfully! Found ${numberCount} phone number${numberCount > 1 ? 's' : ''}.`
          : 'Connected successfully! No phone numbers found yet — you can purchase one from the Phone Numbers panel.',
        numbers: numberCount,
      });
    } catch (err: any) {
      console.error('[TelnyxSetup] Verify error:', err);
      setVerifyResult({ ok: false, message: err.message || 'Verification failed' });
    } finally {
      setVerifying(false);
    }
  }

  function handleCopyWebhookUrl() {
    const url = `${API_BASE}/telnyx/webhooks/call-status`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success('Webhook URL copied');
    setTimeout(() => setCopied(false), 2000);
  }

  const steps: { id: Step; label: string; number: number }[] = [
    { id: 'welcome', label: 'Account', number: 1 },
    { id: 'api_key', label: 'API Key', number: 2 },
    { id: 'connection_id', label: 'Connection', number: 3 },
    { id: 'verify', label: 'Verify', number: 4 },
  ];

  const currentIndex = steps.findIndex(s => s.id === step);

  return (
    <div className="flex flex-col items-center px-4 py-6 sm:p-8 animate-fade-in">
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8 w-full max-w-sm">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                  i < currentIndex
                    ? 'bg-[#1ED4A7] text-black'
                    : i === currentIndex
                    ? 'bg-white dark:bg-white text-black'
                    : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-zinc-300 dark:border-zinc-700'
                }`}
              >
                {i < currentIndex ? <Check className="w-3.5 h-3.5" /> : s.number}
              </div>
              <span className={`text-[9px] mt-1 font-medium ${
                i <= currentIndex ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'
              }`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 mx-1 mt-[-12px] ${
                i < currentIndex ? 'bg-[#1ED4A7]' : 'bg-zinc-200 dark:bg-zinc-800'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 1: Welcome ── */}
      {step === 'welcome' && (
        <div className="text-center max-w-sm w-full">
          <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Phone className="w-7 h-7 text-[#1ED4A7]" />
          </div>

          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            Connect Telnyx
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed mb-6">
            Telnyx powers AI phone calls in Contndr. You'll need a Telnyx account with a phone number to get started.
          </p>

          {/* What you'll need */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 mb-6 text-left">
            <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">What you'll need</p>
            <div className="space-y-2.5">
              {[
                { icon: Key, text: 'API V2 Key from your Telnyx dashboard' },
                { icon: Plug, text: 'A Call Control or TeXML Application ID' },
                { icon: Phone, text: 'At least one phone number (can be purchased in-app)' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <item.icon className="w-3.5 h-3.5 text-[#1ED4A7] mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-zinc-300">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <a
              href="https://telnyx.com/sign-up"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-800 border border-zinc-700 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              Create Telnyx Account
              <ExternalLink className="w-3.5 h-3.5 opacity-60" />
            </a>
            <button
              onClick={() => setStep('api_key')}
              className="w-full py-2.5 bg-white text-black rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
            >
              I have an account
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: API Key ── */}
      {step === 'api_key' && (
        <div className="text-center max-w-sm w-full">
          <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Key className="w-7 h-7 text-[#1ED4A7]" />
          </div>

          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            Enter API Key
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed mb-6">
            Find your V2 API Key at{' '}
            <a
              href="https://portal.telnyx.com/#/app/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1ED4A7] hover:underline inline-flex items-center gap-0.5"
            >
              portal.telnyx.com <ExternalLink className="w-3 h-3 inline" />
            </a>
          </p>

          <div className="space-y-3">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="KEY0123456789..."
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
            />

            {/* Help hint */}
            <div className="flex items-start gap-2 p-3 bg-zinc-900/40 border border-zinc-800/60 rounded-lg text-left">
              <Shield className="w-3.5 h-3.5 text-zinc-500 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Use a <span className="text-zinc-400 font-medium">V2 API Key</span> (starts with KEY). V1 keys are not supported. Your key is stored securely and never leaves our servers.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('welcome')}
                className="px-4 py-2.5 text-zinc-400 hover:text-white border border-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSaveApiKey}
                disabled={saving || !apiKey.trim()}
                className="flex-1 py-2.5 bg-white text-black rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Connection ID ── */}
      {step === 'connection_id' && (
        <div className="text-center max-w-sm w-full">
          <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Plug className="w-7 h-7 text-[#1ED4A7]" />
          </div>

          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            Connection ID
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed mb-2">
            Create a <span className="text-zinc-300 font-medium">Call Control Application</span> in Telnyx and paste its ID here.
          </p>
          <a
            href="https://portal.telnyx.com/#/app/call-control/applications"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#1ED4A7] text-xs hover:underline inline-flex items-center gap-1 mb-6"
          >
            Open Telnyx Call Control Apps <ExternalLink className="w-3 h-3" />
          </a>

          <div className="space-y-3">
            <input
              type="text"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              placeholder="1234567890123456789"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleSaveConnectionId()}
            />

            {/* Webhook URL helper */}
            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg p-3 text-left">
              <p className="text-[11px] text-zinc-500 mb-2">
                Set this as the <span className="text-zinc-400 font-medium">Webhook URL</span> in your Telnyx app:
              </p>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 text-[10px] text-[#1ED4A7] bg-zinc-900 px-2 py-1.5 rounded font-mono truncate">
                  {API_BASE}/telnyx/webhooks/call-status
                </code>
                <button
                  onClick={handleCopyWebhookUrl}
                  className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors flex-shrink-0"
                  title="Copy webhook URL"
                >
                  {copied ? <Check className="w-3 h-3 text-[#1ED4A7]" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('api_key')}
                className="px-4 py-2.5 text-zinc-400 hover:text-white border border-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSaveConnectionId}
                disabled={saving || !connectionId.trim()}
                className="flex-1 py-2.5 bg-white text-black rounded-lg text-sm font-semibold hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save & Verify
              </button>
            </div>

            <button
              onClick={() => { setStep('verify'); setTimeout(() => handleVerify(), 500); }}
              className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1"
            >
              Skip — I'll set this up later
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Verify ── */}
      {step === 'verify' && (
        <div className="text-center max-w-sm w-full">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 border transition-colors ${
            verifyResult?.ok
              ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/30'
              : verifyResult && !verifyResult.ok
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-zinc-900 border-zinc-800'
          }`}>
            {verifying ? (
              <Loader2 className="w-7 h-7 text-zinc-400 animate-spin" />
            ) : verifyResult?.ok ? (
              <CheckCircle2 className="w-7 h-7 text-[#1ED4A7]" />
            ) : verifyResult && !verifyResult.ok ? (
              <XCircle className="w-7 h-7 text-red-400" />
            ) : (
              <Zap className="w-7 h-7 text-[#1ED4A7]" />
            )}
          </div>

          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            {verifying
              ? 'Verifying...'
              : verifyResult?.ok
              ? 'You\'re all set!'
              : verifyResult && !verifyResult.ok
              ? 'Connection Issue'
              : 'Verify Connection'
            }
          </h2>

          {verifyResult && (
            <p className={`text-sm leading-relaxed mb-6 ${
              verifyResult.ok ? 'text-zinc-400' : 'text-red-400/80'
            }`}>
              {verifyResult.message}
            </p>
          )}

          {!verifyResult && !verifying && (
            <p className="text-sm text-zinc-400 leading-relaxed mb-6">
              We'll test your Telnyx connection and sync your phone numbers.
            </p>
          )}

          <div className="space-y-2.5">
            {verifyResult?.ok ? (
              <button
                onClick={onComplete}
                className="w-full py-2.5 bg-white text-black rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
              >
                Go to Phone Numbers
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <>
                {!verifying && (
                  <button
                    onClick={handleVerify}
                    className="w-full py-2.5 bg-white text-black rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {verifyResult ? 'Retry Verification' : 'Verify Now'}
                  </button>
                )}
              </>
            )}

            {verifyResult && !verifyResult.ok && (
              <button
                onClick={() => setStep('api_key')}
                className="w-full py-2.5 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Setup
              </button>
            )}

            {!verifyResult && !verifying && (
              <button
                onClick={onComplete}
                className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1"
              >
                Skip verification
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}