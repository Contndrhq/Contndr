import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ContndrLogo } from './ContndrLogo';
import { supabase } from '../lib/supabase';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { Eye, EyeOff, Loader2, Star, Quote, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatPhoneInput } from '../lib/phone-format';

interface AuthScreenProps {
  onAuthSuccess: (session: any) => void;
  onBack?: () => void;
  initialMode?: 'signin' | 'signup';
  redirectTo?: string;
}

export function AuthScreen({ onAuthSuccess, onBack, initialMode = 'signin', redirectTo }: AuthScreenProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [monthlyLeadVolume, setMonthlyLeadVolume] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [currentTestimonial, setCurrentTestimonial] = useState(0);

  // Debug log to verify component update
  useEffect(() => {
    console.log('AuthScreen mounted, mode:', mode);
  }, [mode]);

  const testimonials = [
    {
      quote: t('auth.testimonial1Quote'),
      author: t('auth.testimonial1Author'),
      role: t('auth.testimonial1Role'),
      metric: t('auth.testimonial1Metric')
    },
    {
      quote: t('auth.testimonial2Quote'),
      author: t('auth.testimonial2Author'),
      role: t('auth.testimonial2Role'),
      metric: t('auth.testimonial2Metric')
    },
    {
      quote: t('auth.testimonial3Quote'),
      author: t('auth.testimonial3Author'),
      role: t('auth.testimonial3Role'),
      metric: t('auth.testimonial3Metric')
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTestimonial((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  async function handleSocialLogin(provider: 'google' | 'github') {
    setLoading(true);
    setError('');
    
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/auth?mode=signin`,
          queryParams: {
            prompt: 'select_account',
          },
        }
      });
      
      if (error) throw error;
      
    } catch (err: any) {
      console.error(`${provider} login error:`, err);
      setError(err.message || t('auth.failedSocialLogin', { provider }));
      setLoading(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    const MAX_SIGN_IN_RETRIES = 4;
    for (let attempt = 0; attempt < MAX_SIGN_IN_RETRIES; attempt++) {
      try {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          const msg = signInError.message || '';
          const isTransient = msg.includes('schema cache') || msg.includes('PGRST002')
            || msg.includes('Database error') || msg.includes('Unexpected failure')
            || msg.includes('Failed to fetch') || msg.includes('fetch failed')
            || msg.includes('network error') || msg.includes('NetworkError');
          if (isTransient && attempt < MAX_SIGN_IN_RETRIES - 1) {
            const delay = 800 * Math.pow(2, attempt);
            console.warn(`[AUTH] Sign-in transient error (attempt ${attempt + 1}/${MAX_SIGN_IN_RETRIES}), retrying in ${delay}ms: ${msg}`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw signInError;
        }

        if (data.session) {
          onAuthSuccess(data.session);
        }
        break; // success
      } catch (err: any) {
        const msg = err?.message || '';
        const isTransient = msg.includes('schema cache') || msg.includes('PGRST002')
          || msg.includes('Database error') || msg.includes('Unexpected failure')
          || msg.includes('Failed to fetch') || msg.includes('fetch failed')
          || msg.includes('network error') || msg.includes('NetworkError');
        if (isTransient && attempt < MAX_SIGN_IN_RETRIES - 1) {
          const delay = 800 * Math.pow(2, attempt);
          console.warn(`[AUTH] Sign-in thrown error (attempt ${attempt + 1}/${MAX_SIGN_IN_RETRIES}), retrying in ${delay}ms: ${msg}`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error('Sign in error:', err);
        setError(err.message || t('auth.failedToSignIn'));
        break;
      }
    }
    setLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/auth/forgot-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ email }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('auth.failedToSendCode'));
      }

      setSuccessMessage(t('auth.codeSentSuccess'));
      setMode('reset'); // Switch to reset mode to show code input
    } catch (err: any) {
      console.error('Forgot password error:', err);
      setError(err.message || t('auth.failedToSendCode'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    // Validation
    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError(t('auth.passwordMinLength'));
      setLoading(false);
      return;
    }

    if (resetCode.length !== 6) {
      setError(t('auth.enterSixDigitCode'));
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/auth/reset-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ 
            email,
            code: resetCode,
            password
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('auth.failedToResetPassword'));
      }

      setSuccessMessage(t('auth.resetSuccess'));
      
      // Clear form and redirect to sign in
      setTimeout(() => {
        setMode('signin');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setResetCode('');
        setError('');
        setSuccessMessage('');
      }, 2000);
    } catch (err: any) {
      console.error('Reset password error:', err);
      setError(err.message || t('auth.failedToResetPassword'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      // Resolve affiliate ref: URL param takes priority, then sessionStorage
      const urlRef = new URLSearchParams(window.location.search).get('ref');
      const sessionRef = (() => {
        try { return sessionStorage.getItem('contndr_affiliate_ref'); } catch { return null; }
      })();
      const affiliateRef = urlRef || sessionRef || undefined;

      if (affiliateRef) {
        console.log('[AUTH] Signup with affiliate ref:', affiliateRef);
      }

      // Call our backend to create user with admin privileges
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/auth/signup-v2`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ 
            email, 
            password, 
            name, 
            company: companyName,
            phone,
            businessType,
            monthlyLeadVolume,
            teamSize,
            annualRevenue,
            ref: affiliateRef
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        // If email already exists (409), switch to sign-in mode
        if (response.status === 409) {
          setMode('signin');
          setError(errorData.error || t('auth.emailAlreadyExists', 'An account with this email already exists. Please sign in instead.'));
          setLoading(false);
          return;
        }
        throw new Error(errorData.error || t('auth.failedToSignUp'));
      }

      const data = await response.json();

      // Now sign in with the created credentials
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      // Clear sessionStorage affiliate ref after successful signup
      try { sessionStorage.removeItem('contndr_affiliate_ref'); } catch {}

      if (signInData.session) {
        onAuthSuccess(signInData.session);
      }
    } catch (err: any) {
      console.error('Sign up error:', err);
      setError(err.message || t('auth.failedToSignUp'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex bg-[#050505] text-white overflow-hidden">
      {/* Left Column - Form */}
      <div className="w-full lg:w-1/2 flex flex-col relative z-20 bg-[#050505] border-r border-white/5 h-screen">
        
        {/* Header */}
        <div className="relative z-30 p-8 flex items-center justify-between flex-shrink-0" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 2rem)' }}>
            <a
              href="https://contndr.com"
              onClick={(e) => {
                e.preventDefault();
                if (onBack) onBack();
                else window.location.href = 'https://contndr.com';
              }}
              className="flex items-center gap-2 cursor-pointer"
            >
                <ContndrLogo className="h-4 lg:h-5 w-auto text-white" stroke="#050505" strokeWidth="6" />
            </a>
        </div>

        {/* Form Container - scrollable with keyboard awareness */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-12 md:px-24 max-w-[640px] mx-auto w-full pb-8 mobile-form-container flex flex-col" style={{ overscrollBehavior: 'contain' }}>
            <div className="my-auto w-full">
                <div className="mb-10">
                <h1 className="text-3xl md:text-4xl font-bold !text-white mb-3 tracking-tight">
                    {mode === 'signin' ? t('auth.welcomeBack') : mode === 'forgot' ? t('auth.resetPassword') : mode === 'reset' ? t('auth.enterVerificationCode') : t('auth.requestAccess')}
                </h1>
                <p className="text-gray-300 text-lg">
                    {mode === 'signin' 
                        ? t('auth.enterCredentials') 
                        : mode === 'forgot'
                        ? t('auth.enterEmailForCode')
                        : mode === 'reset'
                        ? t('auth.checkEmailForCode')
                        : t('auth.joinWaitlist')}
                </p>
            </div>

            <form onSubmit={mode === 'signin' ? handleSignIn : mode === 'forgot' ? handleForgotPassword : mode === 'reset' ? handleResetPassword : handleSignUp} className="space-y-5">
                {mode === 'signup' && (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2 col-span-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.fullName')}</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                placeholder={t('auth.placeholderName')}
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.company')}</label>
                            <input
                                type="text"
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                required
                                placeholder={t('auth.placeholderCompany')}
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.phoneNumber')}</label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                                required
                                placeholder="+1 (555) 123-4567"
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.businessType')}</label>
                            <select
                                value={businessType}
                                onChange={(e) => setBusinessType(e.target.value)}
                                required
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all appearance-none"
                            >
                                <option value="" disabled>{t('auth.selectType')}</option>
                                <option value="Agency">{t('auth.agency')}</option>
                                <option value="SaaS">{t('auth.saas')}</option>
                                <option value="Recruiting">{t('auth.recruiting')}</option>
                                <option value="Real Estate">{t('auth.realEstate')}</option>
                                <option value="Consulting">{t('auth.consulting')}</option>
                                <option value="Financial Services">{t('auth.financialServices')}</option>
                                <option value="Other">{t('auth.other')}</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.leadVolume')}</label>
                            <select
                                value={monthlyLeadVolume}
                                onChange={(e) => setMonthlyLeadVolume(e.target.value)}
                                required
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all appearance-none"
                            >
                                <option value="" disabled>{t('auth.monthlyLeads')}</option>
                                <option value="0_1000">0 - 1,000</option>
                                <option value="1000_5000">1,000 - 5,000</option>
                                <option value="5000_20000">5,000 - 20,000</option>
                                <option value="20000_plus">20,000+</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.teamSize')}</label>
                            <select
                                value={teamSize}
                                onChange={(e) => setTeamSize(e.target.value)}
                                required
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all appearance-none"
                            >
                                <option value="" disabled>{t('auth.selectSize')}</option>
                                <option value="1_5">1 - 5</option>
                                <option value="6_20">6 - 20</option>
                                <option value="21_50">21 - 50</option>
                                <option value="51_plus">51+</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.annualRevenue')}</label>
                            <select
                                value={annualRevenue}
                                onChange={(e) => setAnnualRevenue(e.target.value)}
                                required
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all appearance-none"
                            >
                                <option value="" disabled>{t('auth.selectRevenue')}</option>
                                <option value="0_500k">$0 - $500k</option>
                                <option value="500k_1m">$500k - $1m</option>
                                <option value="1m_5m">$1m - $5m</option>
                                <option value="5m_plus">$5m+</option>
                            </select>
                        </div>
                    </div>
                )}

                {mode === 'reset' ? (
                    <>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.verificationCode')}</label>
                            <input
                                type="text"
                                value={resetCode}
                                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                required
                                maxLength={6}
                                placeholder="000000"
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all text-center tracking-widest text-2xl font-mono"
                            />
                            <p className="text-xs text-gray-500 ml-1">
                                {t('auth.codeSentTo', { email })}
                            </p>
                            <p className="text-xs text-gray-400 ml-1 mt-1">
                                {t('auth.checkSpamFolder')}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.newPassword')}</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    placeholder="••••••••"
                                    className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 pr-10 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.confirmPassword')}</label>
                            <div className="relative">
                                <input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    placeholder="••••••••"
                                    className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 pr-10 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                                >
                                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.emailAddress')}</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                placeholder="you@company.com"
                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all"
                            />
                        </div>

                        {mode !== 'forgot' && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">{t('auth.password')}</label>
                        {mode === 'signin' && (
                            <button 
                                type="button" 
                                onClick={() => {
                                    setMode('forgot');
                                    setError('');
                                    setSuccessMessage('');
                                }}
                                className="text-xs text-gray-400 hover:text-white font-medium transition-colors"
                            >
                                {t('auth.forgotPassword')}
                            </button>
                        )}
                    </div>
                    <div className="relative">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                            placeholder="••••••••"
                            className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3 pr-10 text-base !text-white placeholder:text-gray-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/50 transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                        >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
                        )}
                    </>
                )}

                {error && (
                    <div className="p-4 bg-zinc-500/10 border border-zinc-500/20 rounded-xl flex items-start gap-3">
                        <div className="w-5 h-5 bg-zinc-500 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-black text-xs font-bold">!</span>
                        </div>
                        <p className="text-sm text-zinc-300 font-medium">{error}</p>
                    </div>
                )}

                {successMessage && (
                    <div className="p-4 bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-xl flex items-start gap-3">
                        <div className="w-5 h-5 bg-[#1ED4A7] rounded-full flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-black text-xs font-bold">✓</span>
                        </div>
                        <p className="text-sm text-[#1ED4A7] font-medium">{successMessage}</p>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-white hover:bg-gray-200 text-black font-bold text-lg py-4 rounded-xl transition-all shadow-lg hover:shadow-white/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                >
                    {loading ? (
                        <div className="flex items-center justify-center gap-2">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>{t('auth.processing')}</span>
                        </div>
                    ) : (
                        <span>{mode === 'signin' ? t('auth.signIn') : mode === 'forgot' ? t('auth.sendVerificationCode') : mode === 'reset' ? t('auth.resetPassword') : t('auth.requestAccess')}</span>
                    )}
                </button>
            </form>

            {(mode === 'signin' || mode === 'signup') && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-[#050505] px-4 text-gray-500 uppercase tracking-wider font-bold">{mode === 'signup' ? t('auth.orSignUpWith') : t('auth.orContinueWith')}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('google')}
                    disabled={loading}
                    className="flex items-center justify-center gap-2.5 w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3.5 text-sm font-semibold text-white hover:bg-white/5 hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4.5 h-4.5" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                      <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
                      <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
                      <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
                      <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
                    </svg>
                    Google
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('github')}
                    disabled={loading}
                    className="flex items-center justify-center gap-2.5 w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-4 py-3.5 text-sm font-semibold text-white hover:bg-white/5 hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
                    </svg>
                    GitHub
                  </button>
                </div>
              </>
            )}

            <div className="mt-8 text-center text-sm text-gray-400">
                {mode === 'reset' ? (
                    <>
                        {t('auth.didntReceiveCode')}{' '}
                        <button
                            onClick={() => {
                                setMode('forgot');
                                setResetCode('');
                                setPassword('');
                                setConfirmPassword('');
                                setError('');
                                setSuccessMessage('');
                            }}
                            className="text-white font-bold hover:underline"
                        >
                            {t('auth.resendCode')}
                        </button>
                        {' '}{t('auth.or')}{' '}
                        <button
                            onClick={() => {
                                setMode('signin');
                                setEmail('');
                                setResetCode('');
                                setPassword('');
                                setConfirmPassword('');
                                setError('');
                                setSuccessMessage('');
                            }}
                            className="text-white font-bold hover:underline"
                        >
                            {t('auth.backToSignIn')}
                        </button>
                    </>
                ) : mode === 'forgot' ? (
                    <>
                        {t('auth.rememberPassword')}{' '}
                        <button
                            onClick={() => {
                                setMode('signin');
                                setError('');
                                setSuccessMessage('');
                            }}
                            className="text-white font-bold hover:underline"
                        >
                            {t('auth.signIn')}
                        </button>
                    </>
                ) : (
                    <>
                        {mode === 'signin' ? t('auth.dontHaveAccount') : t('auth.alreadyHaveAccount')}
                        <button
                            onClick={() => {
                                setMode(mode === 'signin' ? 'signup' : 'signin');
                                setError('');
                                setSuccessMessage('');
                            }}
                            className="text-white font-bold hover:underline"
                        >
                            {mode === 'signin' ? t('auth.requestAccess') : t('auth.signIn')}
                        </button>
                    </>
                )}
            </div>
            </div>
        </div>
        
        {/* Footer */}
        <div className="p-8 text-center sm:text-left">
            <p className="text-xs text-gray-600 uppercase tracking-widest font-bold">
                {t('auth.protectedBySecurity')}
            </p>
        </div>
      </div>

      {/* Right Column - Visuals */}
      <div className="hidden lg:flex w-1/2 bg-[#000] relative items-center justify-center overflow-hidden">
        {/* Background Effects */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#1ED4A7]/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#1ED4A7]/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent opacity-20" />
        
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:32px_32px]" />

        <div className="relative z-10 w-full max-w-lg px-12 flex flex-col justify-center">
            {/* Feature Highlight Card */}
            <div className="mb-12 relative">
                <div className="absolute -inset-1 bg-gradient-to-r from-[#1ED4A7] to-[#1ED4A7] rounded-2xl opacity-20 blur-lg" />
                <div className="bg-[#0A0A0A] border border-white/10 rounded-2xl p-8 relative overflow-hidden">
                     {/* Decorative Elements */}
                     <div className="absolute top-0 right-0 p-4 opacity-20">
                         <Zap className="w-24 h-24 text-white rotate-12" />
                     </div>

                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-[#1ED4A7]/20 flex items-center justify-center border border-[#1ED4A7]/30">
                            <Star className="w-5 h-5 text-[#1ED4A7] fill-[#1ED4A7]" />
                        </div>
                        <span className="text-[#1ED4A7] font-bold uppercase tracking-wider text-xs border border-[#1ED4A7]/20 bg-[#1ED4A7]/10 px-2 py-1 rounded">{t('auth.trustpilotRating')}</span>
                    </div>
                    
                    <h3 className="text-2xl font-bold !text-white mb-2">{t('auth.joinIndustryLeaders')}</h3>
                    <p className="text-gray-400 mb-6">{t('auth.automateOutbound')}</p>
                    
                    <div className="flex -space-x-3">
                        {[
                          "https://images.unsplash.com/photo-1576558656222-ba66febe3dec?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBoZWFkc2hvdCUyMHBvcnRyYWl0fGVufDF8fHx8MTc2OTgxNzI3MXww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
                          "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxidXNpbmVzcyUyMHdvbWFuJTIwcG9ydHJhaXR8ZW58MXx8fHwxNzY5ODU3MzAwfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
                          "https://images.unsplash.com/photo-1651684215020-f7a5b6610f23?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzbWlsaW5nJTIwbWFuJTIwYnVzaW5lc3MlMjBwb3J0cmFpdHxlbnwxfHx8fDE3Njk4OTQzNDV8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
                          "https://images.unsplash.com/photo-1715177092963-d342663a8350?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0ZWNoJTIwc3RhcnR1cCUyMGZvdW5kZXIlMjBwb3J0cmFpdCUyMHdvbWFufGVufDF8fHx8MTc2OTg5NDM0OHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
                          "https://images.unsplash.com/photo-1530281834572-02d15fa61f64?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxleGVjdXRpdmUlMjBwb3J0cmFpdCUyMG1hbGV8ZW58MXx8fHwxNzY5ODk0MzUyfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                        ].map((img, i) => (
                            <div key={i} className="w-10 h-10 rounded-full border-2 border-[#0A0A0A] bg-gray-800 overflow-hidden">
                                <img src={img} alt="User" className="w-full h-full object-cover" />
                            </div>
                        ))}
                        <div className="w-10 h-10 rounded-full border-2 border-[#0A0A0A] bg-white text-black flex items-center justify-center text-xs font-bold">
                            +2k
                        </div>
                    </div>
                </div>
            </div>

            {/* Testimonials */}
            <div className="relative h-32">
                <AnimatePresence mode="wait">
                    <motion.div 
                        key={currentTestimonial}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.5 }}
                        className="absolute inset-0"
                    >
                        <div className="flex gap-4">
                            <Quote className="w-8 h-8 text-gray-600 shrink-0" />
                            <div>
                                <p className="text-xl font-medium text-white leading-relaxed mb-4">
                                    "{testimonials[currentTestimonial].quote}"
                                </p>
                                <div>
                                    <div className="font-bold text-white">{testimonials[currentTestimonial].author}</div>
                                    <div className="text-sm text-gray-500">{testimonials[currentTestimonial].role}</div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
      </div>
    </div>
  );
}
