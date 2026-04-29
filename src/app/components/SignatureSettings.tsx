import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PenLine, User, Briefcase, Mail, Phone, Globe, Loader2, CheckCircle, Eye, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { apiCache } from '../lib/api-cache';
import { LoadingSpinner } from './LoadingSpinner';
import { formatPhoneDisplay, formatPhoneInput, phoneToDigits } from '../lib/phone-format';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface SignatureData {
  closing_line: string;
  full_name: string;
  title: string;
  email: string;
  phone: string;
  website: string;
  custom_html: string;
}

const DEFAULT_SIGNATURE: SignatureData = {
  closing_line: 'Best Regards',
  full_name: '',
  title: '',
  email: '',
  phone: '',
  website: '',
  custom_html: '',
};

const CLOSING_OPTIONS = [
  'Best Regards',
  'Best',
  'Kind Regards',
  'Thanks',
  'Cheers',
  'Warm Regards',
  'Talk soon',
  'Looking forward',
];

export function SignatureSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signature, setSignature] = useState<SignatureData>(DEFAULT_SIGNATURE);
  const [useCustom, setUseCustom] = useState(false);

  useEffect(() => {
    loadSignature();
  }, []);

  async function loadSignature() {
    try {
      setLoading(true);

      // Pre-fill email from auth session (no network request)
      const { data: { session } } = await supabase.auth.getSession();
      const userEmail = session?.user?.email || '';
      const userName = session?.user?.user_metadata?.name || '';

      const data = await apiCache.fetch(
        'settings:signature',
        async () => {
          const res = await authenticatedFetch(`${BASE}/settings/signature`);
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );

      if (data.success && data.signature) {
        setSignature(data.signature);
        if (data.signature.custom_html) {
          setUseCustom(true);
        }
      } else {
        // Pre-fill with user data
        setSignature(prev => ({
          ...prev,
          full_name: userName,
          email: userEmail,
        }));
      }
    } catch (error) {
      console.error('Error loading signature:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveSignature() {
    setSaving(true);
    try {
      const res = await authenticatedFetch(`${BASE}/settings/signature`, {
        method: 'POST',
        body: JSON.stringify(signature),
      });
      const data = await res.json();
      if (data.success) {
        apiCache.invalidate('settings:signature');
        toast.success(t('signature.savedSuccessfully', 'Signature saved successfully'));
        // Notify the onboarding walkthrough so it advances to the next step
        window.dispatchEvent(new Event('onboarding-step-completed'));
      } else {
        throw new Error(data.error || 'Failed to save');
      }
    } catch (error: any) {
      console.error('Error saving signature:', error);
      toast.error(t('signature.saveFailed', 'Failed to save signature'), { description: error.message });
    } finally {
      setSaving(false);
    }
  }

  function generatePreview(): string {
    if (useCustom && signature.custom_html) {
      return signature.custom_html;
    }
    const lines: string[] = [];
    if (signature.closing_line) {
      lines.push(`${signature.closing_line},`);
    }
    if (signature.full_name) {
      let nameLine = signature.full_name;
      if (signature.title) nameLine += ` | ${signature.title}`;
      lines.push(nameLine);
    }
    if (signature.email) lines.push(`E: ${signature.email}`);
    if (signature.phone) lines.push(`P: ${formatPhoneDisplay(signature.phone)}`);
    if (signature.website) {
      const clean = signature.website.replace(/^https?:\/\//, '');
      lines.push(`W: ${clean}`);
    }
    return lines.join('\n');
  }

  // Check if signature is missing critical fields
  const missingWebsite = !useCustom && !signature.website;
  const missingName = !useCustom && !signature.full_name;
  const missingEmail = !useCustom && !signature.email;
  const hasWarnings = missingWebsite || missingName || missingEmail;

  if (loading) {
    return <LoadingSpinner center size="md" />;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-6">
        <PenLine className="w-5 h-5 text-zinc-400" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{t('signature.title', 'Email Signature')}</h2>
      </div>

      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        {t('signature.description', 'Configure your email signature that will be appended to outgoing campaign emails and follow-ups. This is exactly what recipients will see — make sure your website and contact info are correct.')}
      </p>

      {/* Warnings for missing fields */}
      {hasWarnings && !useCustom && (
        <div className="mb-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">{t('signature.incompleteSignature', 'Incomplete Signature')}</p>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                {missingName && <li>{t('signature.missingNameWarning', '- Full name is empty — emails will be sent without your name')}</li>}
                {missingEmail && <li>{t('signature.missingEmailWarning', "- Email is empty — recipients won't see your email in the signature")}</li>}
                {missingWebsite && <li>{t('signature.missingWebsiteWarning', '- Website is empty — no website link will appear in your signature')}</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Mode Toggle */}
        <div className="flex p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 w-fit">
          <button
            onClick={() => setUseCustom(false)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${!useCustom ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}
          >
            {t('signature.modeStructured', 'Structured')}
          </button>
          <button
            onClick={() => setUseCustom(true)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${useCustom ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm' : 'text-zinc-500'}`}
          >
            {t('signature.modeCustom', 'Custom Text')}
          </button>
        </div>

        {!useCustom ? (
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4">
            {/* Closing Line */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('signature.closingLine', 'Closing Line')}</label>
              <div className="flex flex-wrap gap-2">
                {CLOSING_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSignature(prev => ({ ...prev, closing_line: opt }))}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                      signature.closing_line === opt
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-black border-zinc-900 dark:border-white'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Name & Title */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('signature.fullName', 'Full Name')}</label>
                <div className="relative">
                  <input
                    type="text"
                    value={signature.full_name}
                    onChange={e => setSignature(prev => ({ ...prev, full_name: e.target.value }))}
                    placeholder="John Doe"
                    className={`w-full px-3 py-2 pl-9 bg-white dark:bg-zinc-900 border rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] ${
                      missingName ? 'border-amber-300 dark:border-amber-700' : 'border-zinc-200 dark:border-zinc-800'
                    }`}
                  />
                  <User className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('signature.titleRole', 'Title / Role')}</label>
                <div className="relative">
                  <input
                    type="text"
                    value={signature.title}
                    onChange={e => setSignature(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Sales Manager"
                    className="w-full px-3 py-2 pl-9 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7]"
                  />
                  <Briefcase className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                </div>
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('signature.email', 'Email')}</label>
              <div className="relative">
                <input
                  type="email"
                  value={signature.email}
                  onChange={e => setSignature(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="john@company.com"
                  className={`w-full px-3 py-2 pl-9 bg-white dark:bg-zinc-900 border rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] ${
                    missingEmail ? 'border-amber-300 dark:border-amber-700' : 'border-zinc-200 dark:border-zinc-800'
                  }`}
                />
                <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Phone & Website */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {t('signature.phone', 'Phone')} <span className="text-zinc-400">{t('signature.optional', '(optional)')}</span>
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    value={signature.phone}
                    onChange={e => {
                      const formatted = formatPhoneInput(e.target.value);
                      setSignature(prev => ({ ...prev, phone: formatted }));
                    }}
                    placeholder="+1 (555) 123-4567"
                    className="w-full px-3 py-2 pl-9 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7]"
                  />
                  <Phone className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {t('signature.website', 'Website')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={signature.website}
                    onChange={e => setSignature(prev => ({ ...prev, website: e.target.value }))}
                    placeholder="yourcompany.com"
                    className={`w-full px-3 py-2 pl-9 bg-white dark:bg-zinc-900 border rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] ${
                      missingWebsite ? 'border-amber-300 dark:border-amber-700' : 'border-zinc-200 dark:border-zinc-800'
                    }`}
                  />
                  <Globe className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
                  {t('signature.websiteHelpText', 'This is the website URL shown in your email signature. Enter your own company website.')}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('signature.customSignature', 'Custom Signature')}</label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              {t('signature.customSignatureHelp', 'Write your full signature exactly as you want it to appear in outgoing emails. This replaces all structured fields above.')}
            </p>
            <textarea
              value={signature.custom_html}
              onChange={e => setSignature(prev => ({ ...prev, custom_html: e.target.value }))}
              placeholder={"Best Regards,\nJohn Doe | Sales Manager\nE: john@company.com\nP: +1 (555) 123-4567\nW: yourcompany.com"}
              rows={8}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7] font-mono resize-none"
            />
            <p className="text-xs text-zinc-500 mt-2">
              {t('signature.customSignatureHelp2', 'Use line breaks for formatting. This text is appended directly to every outgoing email.')}
            </p>
          </div>
        )}

        {/* Live Preview */}
        <div className="bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('signature.livePreview', 'Live Preview')}</span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-auto">{t('signature.previewHelp', 'This is exactly what recipients will see')}</span>
          </div>
          <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 italic">{t('signature.emailBodyContent', '...email body content')}</div>
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3">
              <pre className="text-sm text-zinc-700 dark:text-zinc-300 font-sans whitespace-pre-line leading-relaxed">
                {generatePreview() || <span className="text-zinc-400 italic">{t('signature.fillFieldsPlaceholder', 'Fill in the fields above to see your signature')}</span>}
              </pre>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={saveSignature}
            disabled={saving}
            className="px-6 py-2.5 bg-black dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-black font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            <span>{t('signature.saveSignature', 'Save Signature')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}