import { motion } from 'motion/react';
import { Check } from 'lucide-react';

interface SuccessConfirmationProps {
  title?: string;
  subtitle?: string;
  className?: string;
}

export function SuccessConfirmation({ 
  title = "Email Sent", 
  subtitle, 
  className = "" 
}: SuccessConfirmationProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
      <motion.div 
        initial={{ scale: 0.8, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ 
          type: "spring", 
          stiffness: 180, 
          damping: 20,
          mass: 1
        }}
        className="relative mb-8"
      >
        {/* Subtle Backdrop Glow - Reduced Intensity */}
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.1, 0.2, 0.1] 
          }}
          transition={{ 
            duration: 4, 
            repeat: Infinity,
            ease: "easeInOut" 
          }}
          className="absolute inset-0 bg-emerald-500/20 blur-[30px] rounded-full" 
        />
        
        {/* Glass Container */}
        <div className="relative w-24 h-24 rounded-full bg-gradient-to-b from-white/10 to-transparent border border-white/10 backdrop-blur-xl flex items-center justify-center shadow-2xl">
            {/* Inner Ring for depth */}
            <div className="absolute inset-1 rounded-full border border-white/5" />
            
            {/* Emerald Ring Accent */}
            <div className="absolute inset-0 rounded-full border border-emerald-500/20 shadow-[inset_0_0_20px_rgba(16,185,129,0.1)]" />

            {/* Icon */}
            <motion.div
              initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 15 }}
            >
              <Check className="w-10 h-10 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" strokeWidth={3} />
            </motion.div>
        </div>
      </motion.div>

      {/* Text Content */}
      <div className="text-center space-y-2">
        <motion.h3 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="text-2xl font-bold text-white tracking-tight"
        >
          {title}
        </motion.h3>
        
        {subtitle && (
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="text-gray-400 font-medium text-sm md:text-base"
          >
            {subtitle}
          </motion.p>
        )}
      </div>
    </div>
  );
}
