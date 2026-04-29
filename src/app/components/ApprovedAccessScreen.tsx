import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Shield, ArrowRight, CheckCircle2, Lock, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UpgradeModal } from './UpgradeModal';
import { useTranslation } from 'react-i18next';

interface ApprovedAccessScreenProps {
  onLogout: () => void;
  onCheckSubscription: () => void;
}

export function ApprovedAccessScreen({ onLogout, onCheckSubscription }: ApprovedAccessScreenProps) {
  const { t } = useTranslation();
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      onLogout();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md text-white font-sans overflow-hidden flex flex-col z-[9999]">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(30,212,167,0.03)_0%,_transparent_60%)]" />
        
        <div className="flex-1 flex items-center justify-center p-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full max-w-md"
          >
            <div className="bg-[#0A0A0A] border border-white/10 rounded-3xl p-8 md:p-10 shadow-2xl relative overflow-hidden">
              {/* Top shine */}
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#1ED4A7]/30 to-transparent" />
              
              <div className="flex flex-col items-center text-center">
                {/* Approved badge */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                  className="w-16 h-16 rounded-2xl bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 flex items-center justify-center mb-8"
                >
                  <CheckCircle2 className="w-8 h-8 text-[#1ED4A7]" />
                </motion.div>
                
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-2xl md:text-3xl font-bold text-white mb-3 tracking-tight"
                >
                  {t('approvedAccess.title')}
                </motion.h2>
                
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.45 }}
                  className="text-gray-400 text-base leading-relaxed mb-8"
                >
                  {t('approvedAccess.subtitle')}
                </motion.p>

                {/* Scarcity indicators */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 }}
                  className="w-full bg-white/[0.03] rounded-xl p-4 mb-8 border border-white/5 space-y-3"
                >
                  <div className="flex items-center gap-3 text-sm">
                    <Shield className="w-4 h-4 text-[#1ED4A7] shrink-0" />
                    <span className="text-gray-300">{t('approvedAccess.cardSaved')} <span className="text-white font-medium">{t('approvedAccess.notChargedYet')}</span></span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="w-4 h-4 text-[#1ED4A7] shrink-0" />
                    <span className="text-gray-300">{t('approvedAccess.chargedOnActivation')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Lock className="w-4 h-4 text-[#1ED4A7] shrink-0" />
                    <span className="text-gray-300">{t('approvedAccess.cancelAnytime')}</span>
                  </div>
                </motion.div>

                {/* CTA */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                  className="w-full space-y-3"
                >
                  <button
                    onClick={() => setShowUpgrade(true)}
                    className="w-full py-4 bg-white hover:bg-gray-100 text-black font-bold text-base rounded-xl transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)] hover:shadow-[0_0_25px_-5px_rgba(255,255,255,0.4)] transform hover:-translate-y-0.5"
                  >
                    {t('approvedAccess.secureSpot')}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={handleSignOut}
                    className="w-full py-3 bg-transparent hover:bg-white/5 text-gray-500 hover:text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    {t('approvedAccess.signOut')}
                  </button>
                </motion.div>
              </div>
            </div>

            <div className="text-center mt-6">
              <p className="text-[10px] text-gray-600 uppercase tracking-widest">{t('approvedAccess.inviteOnlyAccess')}</p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Portal the UpgradeModal to document.body so it renders above the z-[9999] screen */}
      {showUpgrade && createPortal(
        <UpgradeModal
          isOpen={showUpgrade}
          onClose={() => {
            onCheckSubscription();
          }}
          currentPlan="none"
          forced={true}
        />,
        document.body
      )}
    </>
  );
}
