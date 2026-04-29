interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  text?: string;
  className?: string;
  center?: boolean;
}

/**
 * Unified loading spinner matching Teams style.
 * Uses a clean border-spinner that adapts to light/dark mode.
 */
export function LoadingSpinner({
  size = 'md',
  text,
  className = '',
  center = false,
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4 border-[1.5px]',
    md: 'h-6 w-6 border-2',
    lg: 'h-8 w-8 border-2',
    xl: 'h-12 w-12 border-[3px]',
  };

  const textSizes = {
    sm: 'text-[12px]',
    md: 'text-[13px]',
    lg: 'text-[14px]',
    xl: 'text-[15px]',
  };

  const spinner = (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div
        className={`animate-spin rounded-full ${sizeClasses[size]} border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-white`}
      />
      {text && (
        <p className={`${textSizes[size]} text-zinc-500 dark:text-zinc-400`}>
          {text}
        </p>
      )}
    </div>
  );

  if (center) {
    return (
      <div className="flex items-center justify-center py-12">
        {spinner}
      </div>
    );
  }

  return spinner;
}
