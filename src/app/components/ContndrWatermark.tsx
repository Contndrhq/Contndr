/**
 * Contndr "C" brand mark — reusable watermark component.
 *
 * Render inside a `position: relative; overflow: hidden` container.
 * The mark is absolutely positioned, non-interactive, and uses a
 * diagonal gradient that fades from subtle to invisible for a
 * premium, ghosted-stamp effect.
 *
 * Supports light, dark, and auto (system) modes via the `variant` prop.
 */

interface ContndrWatermarkProps {
  /** 'dark' = white mark on dark bg, 'light' = black mark on light bg, 'auto' = adapts to dark: class */
  variant?: 'dark' | 'light' | 'auto';
  /** Extra Tailwind classes — use to override position, size, opacity, etc. */
  className?: string;
}

export function ContndrWatermark({ variant = 'dark', className = '' }: ContndrWatermarkProps) {
  if (variant === 'auto') {
    // Renders two overlapping SVGs: one for light mode, one for dark — CSS handles visibility
    return (
      <div
        className={`absolute inset-0 pointer-events-none select-none flex items-center justify-center ${className}`}
        aria-hidden="true"
      >
        {/* Light mode mark (black on white bg) — hidden in dark mode */}
        <svg
          className="w-[60%] max-w-[480px] dark:hidden"
          viewBox="0 0 108 98"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="cwm-auto-l" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#000" stopOpacity={0.035} />
              <stop offset="50%" stopColor="#000" stopOpacity={0.015} />
              <stop offset="100%" stopColor="#000" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d="M76.0098 0V11.62H95.7098V31.32H107.32V0H76.0098Z" fill="url(#cwm-auto-l)" />
          <path d="M43.95 11.62H68.21V0H39.14L0 39.14H16.43L43.95 11.62Z" fill="url(#cwm-auto-l)" />
          <path d="M95.71 85.4399H43.95L16.43 57.9199H0L39.14 97.0599H107.32V65.7399H95.71V85.4399Z" fill="url(#cwm-auto-l)" />
        </svg>
        {/* Dark mode mark (white on dark bg) — hidden in light mode */}
        <svg
          className="w-[60%] max-w-[480px] hidden dark:block"
          viewBox="0 0 108 98"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="cwm-auto-d" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fff" stopOpacity={0.05} />
              <stop offset="50%" stopColor="#fff" stopOpacity={0.025} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d="M76.0098 0V11.62H95.7098V31.32H107.32V0H76.0098Z" fill="url(#cwm-auto-d)" />
          <path d="M43.95 11.62H68.21V0H39.14L0 39.14H16.43L43.95 11.62Z" fill="url(#cwm-auto-d)" />
          <path d="M95.71 85.4399H43.95L16.43 57.9199H0L39.14 97.0599H107.32V65.7399H95.71V85.4399Z" fill="url(#cwm-auto-d)" />
        </svg>
      </div>
    );
  }

  // Fixed variant — single SVG
  const id = variant === 'dark' ? 'cwm-d' : 'cwm-l';
  const color = variant === 'dark' ? '#fff' : '#000';
  const stops =
    variant === 'dark'
      ? { a: 0.05, b: 0.025, c: 0 }
      : { a: 0.035, b: 0.015, c: 0 };

  return (
    <div
      className={`absolute inset-0 pointer-events-none select-none flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      <svg
        className="w-[60%] max-w-[480px]"
        viewBox="0 0 108 98"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={stops.a} />
            <stop offset="50%" stopColor={color} stopOpacity={stops.b} />
            <stop offset="100%" stopColor={color} stopOpacity={stops.c} />
          </linearGradient>
        </defs>
        <path d="M76.0098 0V11.62H95.7098V31.32H107.32V0H76.0098Z" fill={`url(#${id})`} />
        <path d="M43.95 11.62H68.21V0H39.14L0 39.14H16.43L43.95 11.62Z" fill={`url(#${id})`} />
        <path d="M95.71 85.4399H43.95L16.43 57.9199H0L39.14 97.0599H107.32V65.7399H95.71V85.4399Z" fill={`url(#${id})`} />
      </svg>
    </div>
  );
}
