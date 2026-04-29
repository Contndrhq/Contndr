import { useEffect, useRef } from 'react';
import { ArrowRight } from 'lucide-react';

interface FloatingDemoCTAProps {
  onGetStarted: () => void;
}

export function FloatingDemoCTA({ onGetStarted }: FloatingDemoCTAProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Rotating conic-gradient border — identical to AskAIButton
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
      <style>{`
        @property --angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: false;
        }
      `}</style>

      <div
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[55] w-[calc(100%-2rem)] max-w-md sm:max-w-lg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Outer wrapper — the rotating border lives here */}
        <div
          ref={canvasRef}
          className="relative rounded-2xl p-[1.5px] group"
          style={{
            background: `conic-gradient(from var(--angle, 0deg), transparent 0%, rgba(16,185,129,0.45) 10%, transparent 20%, transparent 48%, rgba(16,185,129,0.3) 55%, transparent 65%, transparent 100%)`,
          } as React.CSSProperties}
        >
          {/* Subtle outer glow — stronger in dark mode */}
          <div
            className="absolute -inset-[2px] rounded-2xl pointer-events-none blur-[6px] opacity-30 dark:opacity-50"
            style={{
              background: `conic-gradient(from var(--angle, 0deg), transparent 0%, rgba(16,185,129,0.35) 10%, transparent 20%, transparent 48%, rgba(16,185,129,0.25) 55%, transparent 65%, transparent 100%)`,
            } as React.CSSProperties}
          />

          {/* Inner surface
              Light: white card with soft shadow
              Dark: dark zinc-900 with stronger border contrast */}
          <div className={`
            relative flex flex-row items-center justify-between gap-4 px-5 py-3.5 rounded-[14.5px] backdrop-blur-2xl
            bg-white shadow-[0_8px_32px_rgba(0,0,0,0.1),0_2px_8px_rgba(0,0,0,0.06)] border border-zinc-200
            dark:bg-zinc-900/95 dark:shadow-[0_8px_40px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)] dark:border-transparent
          `}>
            <div className="flex flex-col gap-0.5 text-left min-w-0">
              <span className="text-[13px] sm:text-sm font-semibold text-zinc-900 dark:text-white leading-snug">
                Ready to supercharge your outreach?
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-snug">
                Set up your workspace in under 2 minutes
              </span>
            </div>
            <button
              onClick={onGetStarted}
              className="shrink-0 flex items-center gap-1.5 h-[40px] px-5 rounded-xl
                bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-[13px] font-semibold
                shadow-[0_2px_8px_rgba(0,0,0,0.1)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.18)]
                hover:bg-zinc-800 active:scale-[0.97] transition-all duration-200 ease-out
                dark:bg-white dark:text-zinc-950
                dark:shadow-[0_2px_12px_rgba(255,255,255,0.06)] dark:hover:shadow-[0_4px_20px_rgba(255,255,255,0.1)]
                dark:hover:bg-zinc-50"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}