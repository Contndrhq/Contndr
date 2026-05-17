import { toast } from 'sonner';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Mail, Server, CheckCircle2, AlertCircle, Unplug, Loader2, ChevronDown, Eye, EyeOff, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { getAuthHeaders, getAuthToken } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { apiCache } from '../lib/api-cache';
import { LoadingSpinner } from './LoadingSpinner';
import { GmailIcon } from './GmailIcon';
import { OutlookIcon } from './OutlookIcon';
import { OAuthResultModal } from './OAuthResultModal';
import { dispatchAppEvent } from '../lib/app-events';
import { SenderRotation } from './SenderRotation';
import { WarmupDashboard } from './WarmupDashboard';
import { EmailAuthChecker } from './EmailAuthChecker';

type Provider = 'resend' | 'gmail_oauth' | 'outlook_oauth' | 'smtp';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

export function EmailProviderSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Current provider
  const [provider, setProvider] = useState<Provider>('resend');
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);

  // SMTP form (advanced)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('');
  const [smtpFromEmail, setSmtpFromEmail] = useState('');

  // Brand senders
  const [roadrSender, setRoadrSender] = useState('');
  const [sourcrSender, setSourcrSender] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Connecting state
  const [connecting, setConnecting] = useState<'gmail' | 'outlook' | null>(null);

  // Success modal shown after OAuth completes
  const [successModal, setSuccessModal] = useState<{ email: string; provider: 'gmail' | 'outlook' } | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  // Shared flag: whether OAuth result already handled
  const oauthHandledRef = useRef(false);
  const connectingTypeRef = useRef<'gmail' | 'outlook' | null>(null);

  // -------------------------------------------------------------------------
  // Load current user email (for brand senders visibility)
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) setUserEmail(session.user.email || null);
    })();
  }, []);

  // -------------------------------------------------------------------------
  // Load settings from backend
  // -------------------------------------------------------------------------
  const loadSettings = useCallback(async () => {
    try {
      const preCheck = await getAuthHeaders();
      if (!preCheck.Authorization) {
        setTimeout(loadSettings, 1000);
        return;
      }

      const data = await apiCache.fetch(
        'settings:email-provider',
        async () => {
          const headers = await getAuthHeaders();
          if (!headers.Authorization) throw new Error('Not authenticated');
          const res = await fetch(`${BASE}/settings/user-settings`, { headers });
          if (res.ok) return res.json();
          throw new Error('Failed to load settings');
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );

      if (data.success && data.settings) {
        const s = data.settings;
        setProvider(s.provider || 'resend');
        setConnectedEmail(s.connected_email || null);
        setConnectedName(s.connected_name || null);
        if (s.roadr_sender) setRoadrSender(s.roadr_sender);
        if (s.sourcr_sender) setSourcrSender(s.sourcr_sender);
        if (s.provider === 'smtp') setShowAdvanced(true);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // -------------------------------------------------------------------------
  // Check for OAuth callback on mount (after redirect back)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthEmail = params.get('oauth_email');
    const oauthError = params.get('oauth_error');
    const oauthProvider = params.get('oauth_provider');

    if (oauthEmail && oauthProvider) {
      // Clear URL params
      window.history.replaceState({}, '', window.location.pathname);
      
      // Show success
      setSuccessModal({ 
        email: oauthEmail, 
        provider: oauthProvider as 'gmail' | 'outlook' 
      });
      apiCache.invalidate('settings:email-provider');
      loadSettings();
      window.dispatchEvent(new Event('integration-connected'));
      dispatchAppEvent({ type: 'connection:changed', meta: { provider: oauthProvider } });
    } else if (oauthError) {
      // Clear URL params
      window.history.replaceState({}, '', window.location.pathname);
      
      // Show error
      setErrorModal(oauthError);
      apiCache.invalidate('settings:email-provider');
      window.dispatchEvent(new Event('integration-connected'));
      dispatchAppEvent({ type: 'connection:changed', meta: { action: 'disconnect' } });
    }
  }, [loadSettings]);

  // -------------------------------------------------------------------------
  // OAuth connect (redirects to OAuth provider, then back to app)
  // -------------------------------------------------------------------------
  async function connectOAuth(type: 'gmail' | 'outlook') {
    setError('');
    setConnecting(type);
    oauthHandledRef.current = false;
    connectingTypeRef.current = type;

    try {
      const token = await getAuthToken();
      if (!token) {
        setError('Please sign in first');
        setConnecting(null);
        return;
      }

      // Build return URL that goes to settings page (not home)
      // The Settings component will auto-switch to email tab when it sees oauth params
      const returnPath = '/app/settings';
      const returnUrl = `${window.location.origin}${returnPath}`;

      // Redirect to OAuth endpoint - it will redirect to provider, then back to settings
      const url = `${BASE}/auth/${type}/connect?token=${encodeURIComponent(token)}&origin=${encodeURIComponent(returnUrl)}`;
      window.location.href = url;
    } catch (err: any) {
      console.error('[OAUTH] connectOAuth error:', err);
      setError(err.message);
      setConnecting(null);
    }
  }

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------
  async function disconnect() {
    if (!confirm('Disconnect your email account? Campaigns will fall back to Resend.')) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`${BASE}/auth/email/disconnect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider }),
      });
      setProvider('resend');
      setConnectedEmail(null);
      setConnectedName(null);
      apiCache.invalidate('settings:email-provider');
      window.dispatchEvent(new Event('integration-connected'));
      dispatchAppEvent({ type: 'connection:changed', meta: { action: 'disconnect' } });
    } catch (err: any) {
      setError(err.message);
    }
  }

  // -------------------------------------------------------------------------
  // Switch to Resend
  // -------------------------------------------------------------------------
  async function switchToResend() {
    setSaving(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      await fetch(`${BASE}/settings/user-settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email_provider: 'resend' }),
      });
      setProvider('resend');
      setConnectedEmail(null);
      apiCache.invalidate('settings:email-provider');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Save SMTP
  // -------------------------------------------------------------------------
  async function saveSmtp() {
    if (!smtpHost || !smtpUsername || !smtpFromEmail) {
      setError('Please fill in all required SMTP fields');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const body: any = {
        email_provider: 'smtp',
        smtp_host: smtpHost,
        smtp_port: parseInt(smtpPort),
        smtp_username: smtpUsername,
        smtp_from_name: smtpFromName,
        smtp_from_email: smtpFromEmail,
      };
      if (smtpPassword) body.smtp_password = smtpPassword;

      await fetch(`${BASE}/settings/user-settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      setProvider('smtp');
      setConnectedEmail(smtpFromEmail);
      apiCache.invalidate('settings:email-provider');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      window.dispatchEvent(new Event('integration-connected'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Save brand senders
  // -------------------------------------------------------------------------
  async function saveBrandSenders() {
    setSaving(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      await fetch(`${BASE}/settings/user-settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email_provider: provider,
          roadr_sender: roadrSender,
          sourcr_sender: sourcrSender,
        }),
      });
      apiCache.invalidate('settings:email-provider');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingSpinner center size="md" />;
  }

  const isOAuth = provider === 'gmail_oauth' || provider === 'outlook_oauth';
  const isAdmin = userEmail === 'or@roadr.com' || userEmail === 'admin@contndr.com';

  // Best-effort default domain for the DNS checker — the verified
  // sending email (connectedEmail) is the most likely candidate.
  const defaultAuthDomain = (() => {
    const e = (userEmail || '').toLowerCase();
    if (!e || !e.includes('@')) return '';
    return e.split('@')[1] || '';
  })();

  return (
    <div className="space-y-5">
      {/* SPF / DKIM / DMARC health — pinned high so users see it on every visit */}
      <EmailAuthChecker defaultDomain={defaultAuthDomain} />

      {/* Toasts */}
      {saved && (
        <div className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg p-3.5 animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
            <p className="text-[#1ED4A7] text-[13px] font-medium">Settings saved.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3.5 animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            <p className="text-zinc-400 text-[13px] font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Connected State */}
      {/* ================================================================= */}
      {isOAuth && connectedEmail && (
        <div className="bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-white/10 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-4 min-w-0">
              {/* Provider logo circle */}
              <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
                provider === 'gmail_oauth'
                  ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]'
                  : 'bg-zinc-500/10 text-zinc-400'
              }`}>
                {provider === 'gmail_oauth' ? (
                  <GmailIcon className="w-5 h-5" />
                ) : (
                  <Mail className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold text-zinc-900 dark:text-white">
                    {provider === 'gmail_oauth' ? 'Gmail' : 'Outlook'} {t('emailSettings.connected', 'Connected')}
                  </p>
                  <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse flex-shrink-0" />
                </div>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{connectedEmail}</p>
              </div>
            </div>
            <button
              onClick={disconnect}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all flex-shrink-0 w-full sm:w-auto"
            >
              <Unplug className="w-3.5 h-3.5" />
              {t('emailSettings.disconnect', 'Disconnect')}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Provider Selection */}
      {/* ================================================================= */}
      <div className="bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-white/10 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Server className="w-5 h-5 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />
          <div>
            <h2 className="text-zinc-900 dark:text-white text-[15px] font-semibold">{t('emailSettings.emailSending', 'Email Sending')}</h2>
            <p className="text-zinc-500 text-[13px]">
              {t('emailSettings.emailSendingDesc', 'Choose how Contndr sends outreach from your account')}
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {/* ---- Connect Gmail ---- */}
          <div className={`rounded-xl border-2 transition-all ${
            provider === 'gmail_oauth'
              ? 'border-[#1ED4A7] bg-[#1ED4A7]/5'
              : 'border-zinc-200 dark:border-white/8 hover:border-zinc-300 dark:hover:border-white/15'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Google "G" */}
                <div className="w-9 h-9 rounded-lg bg-white dark:bg-white flex items-center justify-center flex-shrink-0 border border-zinc-100 dark:border-transparent">
                  <GmailIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[14px] font-semibold text-zinc-900 dark:text-white">{t('emailSettings.connectGmail', 'Connect Gmail')}</p>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#1ED4A7] text-black">{t('emailSettings.recommended', 'RECOMMENDED')}</span>
                  </div>
                  <p className="text-[12px] text-zinc-500 mt-0.5">
                    {t('emailSettings.gmailDesc', '1-click connect. Highest deliverability. Sends from your own Gmail.')}
                  </p>
                </div>
              </div>
              {provider !== 'gmail_oauth' && (
                <button
                  onClick={() => connectOAuth('gmail')}
                  disabled={connecting === 'gmail'}
                  className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black text-[13px] font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 flex-shrink-0 w-full sm:w-auto"
                >
                  {connecting === 'gmail' ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('emailSettings.connecting', 'Connecting...')}</>
                  ) : (
                    t('emailSettings.connect', 'Connect')
                  )}
                </button>
              )}
              {provider === 'gmail_oauth' && (
                <CheckCircle2 className="w-5 h-5 text-[#1ED4A7] flex-shrink-0" />
              )}
            </div>
          </div>

          {/* ---- Connect Outlook ---- */}
          <div className={`rounded-xl border-2 transition-all ${
            provider === 'outlook_oauth'
              ? 'border-[#1ED4A7] bg-[#1ED4A7]/5'
              : 'border-zinc-200 dark:border-white/8 hover:border-zinc-300 dark:hover:border-white/15'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Microsoft logo */}
                <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-[#05A6F0]/10 flex items-center justify-center flex-shrink-0">
                  <OutlookIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-zinc-900 dark:text-white">{t('emailSettings.connectOutlook', 'Connect Outlook')}</p>
                  <p className="text-[12px] text-zinc-500 mt-0.5">
                    {t('emailSettings.outlookDesc', 'Microsoft 365 / Outlook. 1-click OAuth connect.')}
                  </p>
                </div>
              </div>
              {provider !== 'outlook_oauth' && (
                <button
                  onClick={() => connectOAuth('outlook')}
                  disabled={connecting === 'outlook'}
                  className="px-4 py-2 rounded-lg bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white text-[13px] font-semibold hover:bg-zinc-200 dark:hover:bg-white/15 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 flex-shrink-0 w-full sm:w-auto"
                >
                  {connecting === 'outlook' ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('emailSettings.connecting', 'Connecting...')}</>
                  ) : (
                    t('emailSettings.connect', 'Connect')
                  )}
                </button>
              )}
              {provider === 'outlook_oauth' && (
                <CheckCircle2 className="w-5 h-5 text-[#1ED4A7] flex-shrink-0" />
              )}
            </div>
          </div>

          {/* ---- Resend (Default) ---- */}
          {isAdmin && (
          <div
            onClick={provider !== 'resend' ? switchToResend : undefined}
            className={`rounded-xl border-2 p-4 transition-all cursor-pointer ${
              provider === 'resend'
                ? 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950'
                : 'border-zinc-200 dark:border-white/8 hover:border-zinc-300 dark:hover:border-white/15'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <Mail className="w-4.5 h-4.5 text-zinc-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-medium text-zinc-900 dark:text-white">{t('emailSettings.resendTitle', 'Resend (Platform Default)')}</p>
                  {provider === 'resend' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">{t('emailSettings.active', 'ACTIVE')}</span>
                  )}
                </div>
                <p className="text-[12px] text-zinc-500 mt-0.5">
                  {t('emailSettings.resendDesc', "Send via Contndr's verified domain. Admin only.")}
                </p>
              </div>
              {provider === 'resend' && (
                <CheckCircle2 className="w-5 h-5 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
              )}
            </div>
          </div>
          )}
        </div>

        {/* Non-admin nudge if not connected */}
        {!isAdmin && !isOAuth && provider !== 'smtp' && (
          <div className="mt-4 p-3.5 bg-zinc-800/50 border border-zinc-700 rounded-lg">
            <p className="text-[12px] text-zinc-400">
              <strong dangerouslySetInnerHTML={{ __html: t('emailSettings.connectNudgeStrong', 'Connect your email to start sending.') }} /> {t('emailSettings.connectNudgeText', "Gmail is the easiest option — 1 click and you're ready. Without a connected account, campaigns cannot be sent.")}
            </p>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* Advanced: Custom SMTP (collapsible) */}
      {/* ================================================================= */}
      <div className="bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-white/10 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Server className="w-4 h-4 text-zinc-400 dark:text-zinc-600" />
            <div>
              <p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">{t('emailSettings.advancedSmtp', 'Advanced: Custom SMTP')}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600">{t('emailSettings.advancedSmtpDesc', 'SendGrid, Mailgun, Amazon SES, or your own server')}</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-400 dark:text-zinc-600 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>

        {showAdvanced && (
          <div className="px-5 pb-5 space-y-4 border-t border-zinc-100 dark:border-white/5 pt-5">
            {provider === 'smtp' && connectedEmail && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[#1ED4A7]/10 border border-[#1ED4A7]/20">
                <CheckCircle2 className="w-4 h-4 text-[#1ED4A7]" />
                <p className="text-[12px] text-[#1ED4A7]">{t('emailSettings.smtpConnected', 'SMTP connected:')} {connectedEmail}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">{t('emailSettings.smtpHost', 'SMTP Host')} *</label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">{t('emailSettings.port', 'Port')} *</label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  placeholder="587"
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">{t('emailSettings.usernameEmail', 'Username / Email')} *</label>
              <input
                type="text"
                value={smtpUsername}
                onChange={(e) => setSmtpUsername(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
              />
            </div>

            <div>
              <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">{t('emailSettings.password', 'Password')} *</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={smtpPassword ? '••••••••' : t('emailSettings.enterPassword', 'Enter password')}
                  className="w-full px-3 py-2 pr-10 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">{t('emailSettings.fromName', 'From Name')}</label>
                <input
                  type="text"
                  value={smtpFromName}
                  onChange={(e) => setSmtpFromName(e.target.value)}
                  placeholder={t('emailSettings.yourCompany', 'Your Company')}
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">{t('emailSettings.fromEmail', 'From Email')} *</label>
                <input
                  type="email"
                  value={smtpFromEmail}
                  onChange={(e) => setSmtpFromEmail(e.target.value)}
                  placeholder="noreply@example.com"
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={saveSmtp}
                disabled={saving}
                className="px-5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-[13px] font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save SMTP Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* Brand Email Addresses (admin only, for Resend) */}
      {/* ================================================================= */}
      {provider === 'resend' && isAdmin && (
        <div className="bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-white/10 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <Mail className="w-5 h-5 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />
            <div>
              <h2 className="text-zinc-900 dark:text-white text-[15px] font-semibold">Brand Sender Addresses</h2>
              <p className="text-zinc-500 text-[13px]">Default sender for each brand's campaigns</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">Roadr Sender</label>
              <input
                type="email"
                value={roadrSender}
                onChange={(e) => setRoadrSender(e.target.value)}
                placeholder="partner@roadr.com"
                className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
              />
            </div>
            <div>
              <label className="block text-zinc-500 mb-1.5 text-[12px] font-medium">Sourcr Sender</label>
              <input
                type="email"
                value={sourcrSender}
                onChange={(e) => setSourcrSender(e.target.value)}
                placeholder="or@sourcr.net"
                className="w-full px-3 py-2 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:border-zinc-400 dark:focus:border-white/30 focus:ring-1 focus:ring-zinc-300/20 dark:focus:ring-white/20"
              />
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={saveBrandSenders}
                disabled={saving}
                className="px-5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-[13px] font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Senders'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Sender Rotation */}
      {/* ================================================================= */}
      <div className="bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-white/10 p-5 sm:p-6 shadow-sm">
        <SenderRotation />
      </div>

      {/* ================================================================= */}
      {/* Warmup Dashboard */}
      {/* ================================================================= */}
      <div className="bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-white/10 p-5 sm:p-6 shadow-sm">
        <WarmupDashboard />
      </div>

      {/* ================================================================= */}
      {/* Connecting overlay (shown during redirect) */}
      {/* ================================================================= */}
      <AnimatePresence>
        {connecting && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />

            {/* Loading card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl p-8 max-w-sm w-full mx-4 text-center"
            >
              {/* Icon */}
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#1ED4A7]/10 flex items-center justify-center">
                {connecting === 'gmail' ? (
                  <GmailIcon className="w-8 h-8" />
                ) : (
                  <OutlookIcon className="w-8 h-8" />
                )}
              </div>

              {/* Text */}
              <h3 className="text-[16px] font-semibold text-zinc-900 dark:text-white mb-2">
                Connecting to {connecting === 'gmail' ? 'Google' : 'Microsoft'}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-5">
                You'll be redirected to sign in securely
              </p>

              {/* Spinner */}
              <Loader2 className="w-5 h-5 text-[#1ED4A7] animate-spin mx-auto" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================= */}
      {/* OAuth Success Modal */}
      {/* ================================================================= */}
      {successModal && (
        <OAuthResultModal
          type="success"
          integrationName={successModal.provider === 'gmail' ? 'Gmail' : 'Outlook'}
          detail={successModal.email}
          logo={successModal.provider === 'gmail' ? <GmailIcon className="w-8 h-8" /> : <OutlookIcon className="w-8 h-8" />}
          onClose={() => setSuccessModal(null)}
        />
      )}

      {/* ================================================================= */}
      {/* OAuth Error Modal */}
      {/* ================================================================= */}
      {errorModal && (
        <OAuthResultModal
          type="error"
          integrationName="Email"
          errorMessage={errorModal}
          onClose={() => { setErrorModal(null); setError(''); }}
        />
      )}
    </div>
  );
}