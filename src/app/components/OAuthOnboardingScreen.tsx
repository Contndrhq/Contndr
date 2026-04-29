import { useState } from 'react';
import { motion } from 'motion/react';
import { Building2, ArrowRight, Loader2 } from 'lucide-react';
import { ContndrLogo } from './ContndrLogo';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface OAuthOnboardingScreenProps {
  user: any;
  onComplete: () => void;
  onLogout: () => void;
}

export function OAuthOnboardingScreen({ user, onComplete, onLogout }: OAuthOnboardingScreenProps) {
  const { t } = useTranslation();
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.user_metadata?.user_name || '';
  
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [monthlyLeadVolume, setMonthlyLeadVolume] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const headers = await getAuthHeaders();
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/auth/complete-oauth-profile`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            company: companyName,
            businessType,
            monthlyLeadVolume,
            teamSize,
            annualRevenue,
          }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || t('oauthOnboarding.failedToSaveProfile'));
      }

      toast.success(t('oauthOnboarding.profileSaved'), { description: t('oauthOnboarding.profileSavedDesc') });
      onComplete();
    } catch (err: any) {
      console.error('[ONBOARDING] Error:', err);
      setError(err.message || t('oauthOnboarding.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "w-full bg-[#0A0A0A] border border-white/[0.08] rounded-xl px-4 py-3.5 text-[15px] !text-white placeholder:text-gray-500 focus:outline-none focus:border-[#1ED4A7]/40 focus:ring-1 focus:ring-[#1ED4A7]/30 transition-all duration-200";
  const selectClass = `${inputClass} appearance-none`;
  const labelClass = "text-[11px] font-bold text-zinc-500 uppercase tracking-[0.12em] ml-1 font-['Red_Hat_Display']";

  return (
    <div className="min-h-screen bg-[#050505] text-white font-['Red_Hat_Display'] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/3 w-[800px] h-[600px] bg-[#1ED4A7]/[0.04] rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-[600px] h-[400px] bg-[#1ED4A7]/[0.02] rounded-full blur-[120px] pointer-events-none" />
      
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[460px] relative z-10"
      >
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <ContndrLogo className="h-5 w-auto text-white" stroke="#050505" strokeWidth="6" />
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <motion.h1 
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="text-[28px] font-bold tracking-tight mb-2.5 !text-white"
          >
            {displayName 
              ? t('oauthOnboarding.welcomeName', { name: displayName.split(' ')[0] })
              : t('oauthOnboarding.welcome')}
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="text-gray-400 text-[15px]"
          >
            {t('oauthOnboarding.completeProfile')}
          </motion.p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <motion.div 
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-zinc-900/40 border border-white/[0.06] rounded-2xl p-6 space-y-5 backdrop-blur-sm"
          >
            <div className="space-y-2">
              <label className={labelClass}>{t('oauthOnboarding.company')}</label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500/70" />
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  placeholder="Acme Inc."
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelClass}>{t('oauthOnboarding.businessType')}</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                required
                className={selectClass}
              >
                <option value="" disabled>{t('oauthOnboarding.selectType')}</option>
                <option value="Agency">{t('oauthOnboarding.agency')}</option>
                <option value="SaaS">{t('oauthOnboarding.saas')}</option>
                <option value="Recruiting">{t('oauthOnboarding.recruiting')}</option>
                <option value="Real Estate">{t('oauthOnboarding.realEstate')}</option>
                <option value="Consulting">{t('oauthOnboarding.consulting')}</option>
                <option value="Financial Services">{t('oauthOnboarding.financialServices')}</option>
                <option value="Other">{t('oauthOnboarding.other')}</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className={labelClass}>{t('oauthOnboarding.leadVolume')}</label>
                <select
                  value={monthlyLeadVolume}
                  onChange={(e) => setMonthlyLeadVolume(e.target.value)}
                  required
                  className={selectClass}
                >
                  <option value="" disabled>{t('oauthOnboarding.monthlyLeads')}</option>
                  <option value="0_1000">0 - 1,000</option>
                  <option value="1000_5000">1,000 - 5,000</option>
                  <option value="5000_20000">5,000 - 20,000</option>
                  <option value="20000_plus">20,000+</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className={labelClass}>{t('oauthOnboarding.teamSize')}</label>
                <select
                  value={teamSize}
                  onChange={(e) => setTeamSize(e.target.value)}
                  required
                  className={selectClass}
                >
                  <option value="" disabled>{t('oauthOnboarding.selectSize')}</option>
                  <option value="1_5">1 - 5</option>
                  <option value="6_20">6 - 20</option>
                  <option value="21_50">21 - 50</option>
                  <option value="51_plus">51+</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelClass}>{t('oauthOnboarding.annualRevenue')}</label>
              <select
                value={annualRevenue}
                onChange={(e) => setAnnualRevenue(e.target.value)}
                required
                className={selectClass}
              >
                <option value="" disabled>{t('oauthOnboarding.selectRevenue')}</option>
                <option value="0_500k">$0 - $500k</option>
                <option value="500k_1m">$500k - $1m</option>
                <option value="1m_5m">$1m - $5m</option>
                <option value="5m_plus">$5m+</option>
              </select>
            </div>
          </motion.div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3"
            >
              {error}
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="space-y-3 pt-1"
          >
            <button
              type="submit"
              disabled={loading}
              className="group w-full bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold py-4 rounded-2xl transition-all duration-200 flex items-center justify-center gap-2.5 text-[16px] tracking-[-0.01em] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_24px_rgba(255,255,255,0.08)] hover:shadow-[0_0_32px_rgba(255,255,255,0.12)]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-[18px] h-[18px] animate-spin" />
                  {t('oauthOnboarding.submitting')}
                </>
              ) : (
                <>
                  {t('oauthOnboarding.requestAccess')}
                  <ArrowRight className="w-[18px] h-[18px] transition-transform duration-200 group-hover:translate-x-0.5" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="w-full text-gray-500 hover:text-gray-300 text-sm py-2.5 transition-colors duration-200"
            >
              {t('oauthOnboarding.signOut')}
            </button>
          </motion.div>
        </form>
      </motion.div>
    </div>
  );
}
