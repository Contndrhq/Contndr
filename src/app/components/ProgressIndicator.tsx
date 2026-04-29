import { Check, Loader2 } from 'lucide-react';

export interface ProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'complete' | 'error';
  description?: string;
  errorMessage?: string;
}

interface ProgressIndicatorProps {
  steps: ProgressStep[];
  title?: string;
  subtitle?: string;
}

export function ProgressIndicator({ steps, title, subtitle }: ProgressIndicatorProps) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
      {/* Header */}
      {(title || subtitle) && (
        <div className="mb-6">
          {title && (
            <h3 className="text-gray-900 dark:text-white text-[15px] font-medium mb-1">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-gray-500 dark:text-gray-400 text-[13px]">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Progress Steps */}
      <div className="space-y-4">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-start gap-4">
            {/* Status Icon */}
            <div className="flex-shrink-0 mt-0.5">
              {step.status === 'complete' && (
                <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" strokeWidth={2.5} />
                </div>
              )}
              {step.status === 'loading' && (
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" strokeWidth={2.5} />
                </div>
              )}
              {step.status === 'pending' && (
                <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-600" />
                </div>
              )}
              {step.status === 'error' && (
                <div className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-400" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[13px] font-medium ${
                  step.status === 'complete' 
                    ? 'text-green-700 dark:text-green-400'
                    : step.status === 'loading'
                    ? 'text-blue-700 dark:text-blue-400'
                    : step.status === 'error'
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {step.label}
                </span>
                {step.status === 'loading' && (
                  <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">
                    Processing...
                  </span>
                )}
              </div>
              {step.description && step.status === 'loading' && (
                <p className="text-gray-500 dark:text-gray-400 text-[12px] mt-1">
                  {step.description}
                </p>
              )}
              {step.errorMessage && step.status === 'error' && (
                <p className="text-red-600 dark:text-red-400 text-[12px] mt-1">
                  {step.errorMessage}
                </p>
              )}
            </div>

            {/* Connecting Line */}
            {index < steps.length - 1 && (
              <div className="absolute left-[31px] mt-8 w-px h-6 bg-gray-200 dark:bg-gray-800" style={{ marginLeft: '-19px' }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}