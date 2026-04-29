import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AskAIButtonProps {
  onClick: () => void;
}

const PROMPT_KEYS = [
  'askAiButton.askAnything',
  'askAiButton.summarizePipeline',
  'askAiButton.draftFollowUp',
  'askAiButton.findLeadsFintech',
  'askAiButton.analyzeReply',
  'askAiButton.writeColdIntro',
  'askAiButton.showUnresponsive',
];

export function AskAIButton({ onClick }: AskAIButtonProps) {
  const { t } = useTranslation();
  const [promptIndex, setPromptIndex] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState<'typing' | 'hold' | 'erasing'>('typing');
  const rafRef = useRef<number | null>(null);

  // ---------- cycling placeholder text ----------
  useEffect(() => {
    const full = t(PROMPT_KEYS[promptIndex]);
    let timer: ReturnType<typeof setTimeout>;

    if (phase === 'typing') {
      if (displayed.length < full.length) {
        timer = setTimeout(() => setDisplayed(full.slice(0, displayed.length + 1)), 52);
      } else {
        timer = setTimeout(() => setPhase('hold'), 2200);
      }
    } else if (phase === 'hold') {
      timer = setTimeout(() => setPhase('erasing'), 0);
    } else if (phase === 'erasing') {
      if (displayed.length > 0) {
        timer = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 28);
      } else {
        setPromptIndex((i) => (i + 1) % PROMPT_KEYS.length);
        setPhase('typing');
      }
    }
    return () => clearTimeout(timer);
  }, [displayed, phase, promptIndex, t]);

  // ---------- rotating conic-gradient border ----------
  const canvasRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);

  useEffect(() => {
    let running = true;
    const step = () => {
      if (!running) return;
      angleRef.current = (angleRef.current + 0.6) % 360;
      if (canvasRef.current) {
        canvasRef.current.style.setProperty('--angle', `${angleRef.current}deg`);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      {/* Inject keyframes once */}
      <style>{`
        @property --angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes askai-sparkle-spin {
          0%   { transform: rotate(0deg)   scale(1);   }
          25%  { transform: rotate(45deg)  scale(1.18); }
          50%  { transform: rotate(90deg)  scale(1);   }
          75%  { transform: rotate(135deg) scale(1.18); }
          100% { transform: rotate(180deg) scale(1);   }
        }
        @keyframes askai-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center;  }
        }
        @keyframes askai-cursor-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
      `}</style>

      <div className="px-4 pb-4">
        {/* Outer wrapper — the rotating border lives here */}
        <div
          ref={canvasRef}
          className="relative rounded-xl p-[1px] cursor-text group"
          style={{
            background: `conic-gradient(from var(--angle, 0deg), transparent 0%, rgba(16,185,129,0.45) 10%, transparent 20%, transparent 48%, rgba(16,185,129,0.3) 55%, transparent 65%, transparent 100%)`,
          } as React.CSSProperties}
          onClick={onClick}
          role="button"
          tabIndex={0}
          aria-label="Open AI Assistant"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
        >
          {/* Subtle outer glow */}
          <div
            className="absolute -inset-[1px] rounded-xl opacity-40 blur-[6px] pointer-events-none"
            style={{
              background: `conic-gradient(from var(--angle, 0deg), transparent 0%, rgba(16,185,129,0.3) 10%, transparent 20%, transparent 48%, rgba(16,185,129,0.2) 55%, transparent 65%, transparent 100%)`,
            } as React.CSSProperties}
          />

          {/* Inner button surface */}
          <div className="relative flex items-center gap-2.5 px-3 py-2 rounded-[11px]
            bg-zinc-50 dark:bg-zinc-900/95
            group-hover:bg-zinc-100 dark:group-hover:bg-zinc-800/90
            transition-colors duration-200 text-left w-full">

            {/* Sparkle icon — continuous spin */}
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              className="text-[#1ED4A7] dark:text-[#1ED4A7] shrink-0"
              style={{ animation: 'askai-sparkle-spin 3s ease-in-out infinite' }}
            >
              <path d="M12 2L13.8 8.56L12 10L10.2 8.56L12 2Z" fill="currentColor" />
              <path d="M12 22L10.2 15.44L12 14L13.8 15.44L12 22Z" fill="currentColor" />
              <path d="M2 12L8.56 10.2L10 12L8.56 13.8L2 12Z" fill="currentColor" />
              <path d="M22 12L15.44 13.8L14 12L15.44 10.2L22 12Z" fill="currentColor" />
              <path d="M12 8.5L14 12L12 15.5L10 12L12 8.5Z" fill="currentColor" opacity="0.9" />
              <path d="M18.5 4V7M17 5.5H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>

            {/* Typing text + shimmer */}
            <span className="flex-1 text-[12.5px] truncate select-none relative">
              <span
                className="bg-clip-text"
                style={{
                  backgroundImage: 'linear-gradient(110deg, rgba(161,161,170,1) 35%, rgba(16,185,129,0.7) 50%, rgba(161,161,170,1) 65%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundSize: '200% 100%',
                  animation: 'askai-shimmer 3.5s ease-in-out infinite',
                }}
              >
                {displayed}
              </span>
              {/* Blinking cursor */}
              <span
                className="inline-block w-[1.5px] h-[13px] bg-[#1ED4A7]/70 dark:bg-[#1ED4A7]/70 ml-[1px] align-middle rounded-full"
                style={{ animation: 'askai-cursor-blink 0.9s step-end infinite' }}
              />
            </span>

            {/* Keyboard shortcut badge */}
            <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium
              bg-zinc-100 dark:bg-white/[0.06] text-zinc-400 dark:text-zinc-500
              border border-zinc-200/60 dark:border-white/[0.06]
              group-hover:border-zinc-300 dark:group-hover:border-white/[0.1] transition-colors">
              <span className="text-[9px]">&#8984;</span>J
            </kbd>
          </div>
        </div>
      </div>
    </>
  );
}