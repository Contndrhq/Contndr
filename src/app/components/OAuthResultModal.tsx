/**
 * OAuthResultModal
 * ────────────────
 * Shared success / error modal shown in the parent app after OAuth completes.
 * Works even when COOP headers prevent the popup from self-closing.
 *
 * Usage:
 *   <OAuthResultModal
 *     type="success"
 *     integrationName="HubSpot"
 *     detail="Portal 12345678"
 *     logo={<HubSpotLogo />}
 *     onClose={() => setModal(null)}
 *   />
 */

import { type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface OAuthResultModalProps {
  type: 'success' | 'error';
  integrationName: string;
  /** Optional detail line — e.g. email, portal ID, workspace name */
  detail?: string;
  /** Optional error message (only when type === 'error') */
  errorMessage?: string;
  /** Optional branded logo node */
  logo?: ReactNode;
  /** Brand accent color (hex). Defaults to #1ED4A7 */
  accentColor?: string;
  onClose: () => void;
}

export function OAuthResultModal({
  type,
  integrationName,
  detail,
  errorMessage,
  logo,
  accentColor = '#1ED4A7',
  onClose,
}: OAuthResultModalProps) {
  const isSuccess = type === 'success';

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 12 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="relative bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl border-t sm:border border-zinc-200 dark:border-white/10 shadow-2xl p-8 sm:max-w-sm w-full sm:mx-4 text-center overflow-hidden"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)' }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors z-10"
            style={{ top: 'max(env(safe-area-inset-top, 16px), 16px)' }}
          >
            <X className="w-4 h-4" />
          </button>

          {/* Glow ring behind icon */}
          <div className="relative w-20 h-20 mx-auto mb-5">
            {isSuccess && (
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.5, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle, ${accentColor}20 0%, transparent 70%)`,
                }}
              />
            )}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 14, stiffness: 200, delay: 0.05 }}
              className={`relative w-20 h-20 rounded-full flex items-center justify-center ${
                isSuccess
                  ? ''
                  : 'bg-red-500/10'
              }`}
              style={isSuccess ? { backgroundColor: `${accentColor}15` } : undefined}
            >
              {logo ? (
                <div className="w-10 h-10 flex items-center justify-center">{logo}</div>
              ) : isSuccess ? (
                <CheckCircle2 className="w-10 h-10" style={{ color: accentColor }} />
              ) : (
                <AlertCircle className="w-10 h-10 text-red-500" />
              )}
            </motion.div>
          </div>

          {/* Status badge */}
          {isSuccess && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold mb-3"
              style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accentColor }} />
              Connected
            </motion.div>
          )}

          {/* Title */}
          <motion.h3
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-[18px] font-bold text-zinc-900 dark:text-white mb-1"
          >
            {isSuccess ? `${integrationName} Connected` : 'Connection Failed'}
          </motion.h3>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-1"
          >
            {isSuccess
              ? `Your ${integrationName} account has been linked`
              : `Could not connect to ${integrationName}`}
          </motion.p>

          {/* Detail line */}
          {isSuccess && detail && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-5"
            >
              {detail}
            </motion.p>
          )}
          {!isSuccess && errorMessage && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-[12px] text-red-500/80 dark:text-red-400/80 mb-5 px-2"
            >
              {errorMessage}
            </motion.p>
          )}

          {/* Spacer if no detail */}
          {!detail && isSuccess && <div className="mb-4" />}
          {!errorMessage && !isSuccess && <div className="mb-4" />}

          {/* Action button */}
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            onClick={onClose}
            className="w-full px-5 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-black text-[14px] font-semibold rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
          >
            {isSuccess ? 'Done' : 'Close'}
          </motion.button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
