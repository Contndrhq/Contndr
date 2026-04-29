import { useState, useEffect } from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { useDemoMode } from './DemoContext';

export function OutdatedScriptWarning() {
  const isDemoMode = useDemoMode();
  const [hasOutdatedScript, setHasOutdatedScript] = useState(false);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Skip in demo mode
    if (isDemoMode) return;

    // Only run checks if we have a valid project ID
    if (!projectId || !publicAnonKey) {
      return;
    }

    // Check if there have been recent failed tracking attempts
    // We'll do this by checking the KV store for a special error log key
    const checkForErrors = async () => {
      try {
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/tracking/errors`,
          {
            headers: { 'Authorization': `Bearer ${publicAnonKey}` },
            signal: AbortSignal.timeout(5000), // 5 second timeout
          }
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.hasErrors && data.urls && data.urls.length > 0) {
            setHasOutdatedScript(true);
            setFailedUrls(data.urls);
          }
        }
      } catch (err: any) {
        // Silently handle network errors - these are expected when:
        // - Backend is not deployed yet
        // - User is offline
        // - Request timeout
        // Only log in development for debugging
        if (err?.name !== 'AbortError' && err?.name !== 'TimeoutError') {
          console.warn('[OutdatedScriptWarning] Unable to check tracking errors:', err?.message || 'Network error');
        }
      }
    };

    checkForErrors();
    // Check every 30 seconds
    const interval = setInterval(checkForErrors, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!hasOutdatedScript || dismissed) {
    return null;
  }

  return (
    <div className="mb-6 p-5 bg-gradient-to-r from-red-50 to-amber-50 dark:from-red-950/20 dark:to-amber-950/20 rounded-xl border-2 border-red-200 dark:border-red-900/40 shadow-lg">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
          <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <h3 className="text-lg font-bold text-red-900 dark:text-red-300">
                ⚠️ Outdated Tracking Scripts Detected
              </h3>
              <p className="text-sm text-red-800 dark:text-red-400 mt-1">
                Your website is sending tracking requests with an invalid script. Visits are being rejected.
              </p>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="flex-shrink-0 p-1 hover:bg-red-200 dark:hover:bg-red-900/50 rounded transition-colors"
              title="Dismiss"
            >
              <X className="w-5 h-5 text-red-600 dark:text-red-400" />
            </button>
          </div>

          <div className="space-y-3 mt-4">
            <div className="p-3 bg-white dark:bg-black/30 rounded-lg border border-red-200 dark:border-red-900/40">
              <p className="text-xs font-semibold text-red-900 dark:text-red-300 mb-2">
                📍 Affected URLs:
              </p>
              <ul className="space-y-1">
                {failedUrls.slice(0, 3).map((url, i) => (
                  <li key={i} className="text-xs text-red-700 dark:text-red-400 font-mono truncate flex items-center gap-2">
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    {url}
                  </li>
                ))}
                {failedUrls.length > 3 && (
                  <li className="text-xs text-red-600 dark:text-red-500 italic">
                    + {failedUrls.length - 3} more...
                  </li>
                )}
              </ul>
            </div>

            <div className="p-3 bg-amber-100 dark:bg-amber-900/20 rounded-lg border border-amber-300 dark:border-amber-900/30">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-300 mb-2">
                How to fix:
              </p>
              <ol className="text-xs text-amber-800 dark:text-amber-400 space-y-1.5 ml-4 list-decimal">
                <li>Open <strong>Tracking Setup</strong> from the analytics toolbar</li>
                <li>Expand your website in the list to reveal the tracking snippet</li>
                <li>Click <strong>Copy</strong> to grab the updated script tag</li>
                <li>Replace the old script on your website with the new one</li>
                <li>Deploy your changes — tracking will resume immediately</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}