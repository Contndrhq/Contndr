import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowRight, CheckCircle2, Users, Clock, Sparkles, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { useTranslation } from 'react-i18next';
import { formatPhoneInput } from '../lib/phone-format';

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSkipToDemo: () => void;
}

export function WaitlistModal({ isOpen, onClose, onSkipToDemo }: WaitlistModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    businessType: '',
    monthlyLeadVolume: '',
    teamSize: '',
    annualRevenue: '',
  });

  // Live counter state -- starts from a base and increments periodically for FOMO
  const [waitlistCount, setWaitlistCount] = useState(127);
  const [spotsLeft, setSpotsLeft] = useState(18);

  useEffect(() => {
    if (!isOpen) return;
    // Fetch actual count from backend
    fetchWaitlistCount();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    // Subtle increment every 30-60s for live feel
    const interval = setInterval(() => {
      setWaitlistCount(prev => prev + (Math.random() > 0.6 ? 1 : 0));
    }, 45000);
    return () => clearInterval(interval);
  }, [isOpen]);

  async function fetchWaitlistCount() {
    try {
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/waitlist/count`,
        { headers: { 'Authorization': `Bearer ${publicAnonKey}` } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.count) setWaitlistCount(data.count);
        if (data.spotsLeft) setSpotsLeft(data.spotsLeft);
      }
    } catch {
      // Use defaults
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const requiredFields = [
      formData.name,
      formData.email,
      formData.phone,
      formData.company,
      formData.businessType,
      formData.monthlyLeadVolume,
      formData.teamSize,
      formData.annualRevenue,
    ];
    if (requiredFields.some(value => !value.trim())) {
      toast.error('Complete all access questions before joining.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/waitlist`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify(formData),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit');
      }

      setSuccess(true);
      setWaitlistCount(prev => prev + 1);
      toast.success(t('waitlist.onPriorityList'));
    } catch (err: any) {
      console.error('[WAITLIST] Submission error:', err);
      toast.error(err.message || t('waitlist.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 md:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-xl"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full sm:max-w-lg max-h-[92vh] sm:max-h-[calc(100dvh-2rem)] bg-[#080808] border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-xl transition-colors z-20"
        >
          <X className="w-5 h-5" />
        </button>

        <AnimatePresence mode="wait">
          {success ? (
            /* -------- SUCCESS STATE -------- */
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-10 md:p-12 text-center"
            >
              <div className="w-20 h-20 mx-auto mb-8 rounded-full bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-[#1ED4A7]" />
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-4 tracking-tight">
                {t('waitlist.youreOnTheList')}
              </h3>
              <p className="text-gray-400 text-lg mb-3 leading-relaxed">
                {t('waitlist.reviewingApplications')} <span className="text-white font-bold">{t('waitlist.hours48')}</span>.
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-sm text-gray-400 mb-10">
                <Users className="w-4 h-4 text-[#1ED4A7]" />
                <span>{t('waitlist.positionInQueue', { position: waitlistCount })}</span>
              </div>

              <div className="border-t border-white/10 pt-8 space-y-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-4">{t('waitlist.wantToSkip')}</p>
                <button
                  onClick={onSkipToDemo}
                  className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-all flex items-center justify-center gap-2 shadow-lg"
                >
                  {t('waitlist.bookDemoCall')} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ) : (
            /* -------- FORM STATE -------- */
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {/* Header */}
              <div className="p-8 md:p-10 pb-0">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-full text-xs font-bold text-[#1ED4A7] uppercase tracking-wider mb-6">
                  <Sparkles className="w-3 h-3" /> {t('waitlist.limitedAccess')}
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight mb-3 leading-tight">
                  {t('waitlist.requestAccess')}
                </h2>
                <p className="text-gray-400 leading-relaxed mb-6">
                  {t('waitlist.onboardInBatches')}
                </p>

                {/* FOMO Indicators */}
                <div className="flex flex-col sm:flex-row gap-3 mb-8">
                  <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm">
                    <Users className="w-4 h-4 text-[#1ED4A7]" />
                    <span className="text-gray-400">
                      {t('waitlist.businessesWaiting', { count: waitlistCount })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm">
                    <CalendarDays className="w-4 h-4 text-amber-400" />
                    <span className="text-gray-400">
                      <span className="text-amber-400 font-bold">{t('waitlist.spotsThisWeek', { count: spotsLeft })}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="px-8 md:px-10 pb-8 md:pb-10">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('waitlist.fullName')}</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Jane Smith"
                        className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('waitlist.workEmail')}</label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        placeholder="jane@company.com"
                        className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('waitlist.phoneNumber')}</label>
                      <input
                        type="tel"
                        required
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: formatPhoneInput(e.target.value) })}
                        placeholder="+1 (555) 123-4567"
                        className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm"
                      />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Company</label>
                      <input
                        type="text"
                        required
                        value={formData.company}
                        onChange={e => setFormData({ ...formData, company: e.target.value })}
                        placeholder="Company name"
                        className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('waitlist.businessType')}</label>
                    <select
                      value={formData.businessType}
                      onChange={e => setFormData({ ...formData, businessType: e.target.value })}
                      required
                      className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm appearance-none"
                      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
                    >
                      <option value="" disabled className="bg-[#050505] text-gray-500">{t('waitlist.selectIndustry')}</option>
                      <option value="agency" className="bg-[#050505]">{t('waitlist.agencyConsulting')}</option>
                      <option value="saas" className="bg-[#050505]">{t('waitlist.saasTech')}</option>
                      <option value="ecommerce" className="bg-[#050505]">{t('waitlist.ecommerce')}</option>
                      <option value="real_estate" className="bg-[#050505]">{t('waitlist.realEstate')}</option>
                      <option value="financial" className="bg-[#050505]">{t('waitlist.financial')}</option>
                      <option value="healthcare" className="bg-[#050505]">{t('waitlist.healthcare')}</option>
                      <option value="construction" className="bg-[#050505]">{t('waitlist.construction')}</option>
                      <option value="professional" className="bg-[#050505]">{t('waitlist.professional')}</option>
                      <option value="other" className="bg-[#050505]">{t('waitlist.other')}</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('waitlist.monthlyLeadVolume')}</label>
                    <select
                      value={formData.monthlyLeadVolume}
                      onChange={e => setFormData({ ...formData, monthlyLeadVolume: e.target.value })}
                      required
                      className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm appearance-none"
                      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
                    >
                      <option value="" disabled className="bg-[#050505] text-gray-500">{t('waitlist.howManyLeads')}</option>
                      <option value="under_100" className="bg-[#050505]">{t('waitlist.under100')}</option>
                      <option value="100_500" className="bg-[#050505]">100 - 500</option>
                      <option value="500_1000" className="bg-[#050505]">500 - 1,000</option>
                      <option value="1000_5000" className="bg-[#050505]">1,000 - 5,000</option>
                      <option value="5000_plus" className="bg-[#050505]">5,000+</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Team Size</label>
                      <select
                        value={formData.teamSize}
                        onChange={e => setFormData({ ...formData, teamSize: e.target.value })}
                        required
                        className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm appearance-none"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
                      >
                        <option value="" disabled className="bg-[#050505] text-gray-500">Select size</option>
                        <option value="1_5" className="bg-[#050505]">1 - 5</option>
                        <option value="6_20" className="bg-[#050505]">6 - 20</option>
                        <option value="21_50" className="bg-[#050505]">21 - 50</option>
                        <option value="51_plus" className="bg-[#050505]">51+</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Annual Revenue</label>
                      <select
                        value={formData.annualRevenue}
                        onChange={e => setFormData({ ...formData, annualRevenue: e.target.value })}
                        required
                        className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all text-sm appearance-none"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
                      >
                        <option value="" disabled className="bg-[#050505] text-gray-500">Select revenue</option>
                        <option value="0_500k" className="bg-[#050505]">$0 - $500k</option>
                        <option value="500k_1m" className="bg-[#050505]">$500k - $1m</option>
                        <option value="1m_5m" className="bg-[#050505]">$1m - $5m</option>
                        <option value="5m_plus" className="bg-[#050505]">$5m+</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-6 py-4 bg-white text-black font-bold text-base rounded-xl hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_30px_-5px_rgba(255,255,255,0.2)] hover:shadow-[0_0_40px_-5px_rgba(255,255,255,0.3)] flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      {t('waitlist.joinPriorityAccess')} <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Fast-track option */}
                <div className="mt-5 pt-5 border-t border-white/5 text-center">
                  <button
                    type="button"
                    onClick={onSkipToDemo}
                    className="text-sm font-bold text-gray-500 hover:text-[#1ED4A7] transition-colors group"
                  >
                    {t('waitlist.skipWaitlist')} <span className="underline underline-offset-2 group-hover:text-white">{t('waitlist.bookDemo')}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
