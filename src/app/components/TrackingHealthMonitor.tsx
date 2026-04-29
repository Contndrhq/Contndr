import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface TrackingError {
  url: string;
  account_id: string;
  timestamp: number;
}

export function TrackingHealthMonitor() {
  const [isHealthy, setIsHealthy] = useState(true);
  const [errors, setErrors] = useState<TrackingError[]>([]);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);
  const failureCountRef = useRef(0);
  const hasWarnedRef = useRef(false);

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    if (!projectId || !publicAnonKey) return;

    setChecking(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/tracking/errors`,
        {
          headers: { 'Authorization': `Bearer ${publicAnonKey}` },
          signal: signal || AbortSignal.timeout(8000),
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        setIsHealthy(!data.hasErrors);
        setErrors(data.hasErrors ? data.errors || [] : []);
        setLastCheck(new Date());
        failureCountRef.current = 0;
        hasWarnedRef.current = false;
      }
    } catch (err: any) {
      // Silently handle network errors. These are expected when:
      // - Backend is cold-starting or not deployed
      // - User is offline or on flaky connection
      // - Request times out
      // Only warn once to avoid console spam from repeated polling failures.
      if (err?.name !== 'AbortError' && err?.name !== 'TimeoutError') {
        if (!hasWarnedRef.current) {
          console.warn('[TrackingHealthMonitor] Tracking health check unavailable:', err?.message || 'Network error');
          hasWarnedRef.current = true;
        }
      }
      failureCountRef.current += 1;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkHealth(controller.signal);

    // Poll with adaptive interval: 30s normally, backs off on repeated failures
    const intervalId = setInterval(() => {
      if (!controller.signal.aborted) {
        // Skip this tick if we've had many consecutive failures (backoff)
        const failures = failureCountRef.current;
        if (failures > 0) {
          // After N failures, only check every Nth interval (simple backoff)
          // failures=1 -> every 2nd tick (60s), failures=2 -> every 4th (120s), etc.
          const skipFactor = Math.min(Math.pow(2, failures), 8); // max 8x = ~240s
          // Use a simple counter check via timestamp
          if (Math.random() > 1 / skipFactor) return;
        }
        checkHealth(controller.signal);
      }
    }, 30000);

    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [checkHealth]);

  if (isHealthy) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/10 rounded-lg border border-emerald-200 dark:border-emerald-900/20">
        <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm text-emerald-800 dark:text-emerald-400 font-medium">
          Tracking Scripts Healthy
        </span>
        {lastCheck && (
          <span className="text-xs text-emerald-600 dark:text-emerald-500 ml-auto">
            Last checked {lastCheck.toLocaleTimeString()}
          </span>
        )}
      </div>
    );
  }

  const uniqueUrls = [...new Set(errors.map(e => e.url))];
  const recentErrors = errors.slice(-5);

  return (
    <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-xl border-2 border-red-300 dark:border-red-900/40">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-red-900 dark:text-red-300">
              {errors.length} Tracking Error{errors.length !== 1 ? 's' : ''} Detected
            </h4>
            <button
              onClick={() => checkHealth()}
              disabled={checking}
              className="p-1 hover:bg-red-200 dark:hover:bg-red-900/50 rounded transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-red-600 dark:text-red-400 ${checking ? 'animate-spin' : ''}`} />
            </button>
          </div>
          
          <p className="text-xs text-red-800 dark:text-red-400 mb-3">
            Your websites are sending invalid tracking data. Update the scripts below.
          </p>
          
          <div className="space-y-2">
            <div className="text-xs">
              <p className="font-semibold text-red-900 dark:text-red-300 mb-1">
                Affected Websites ({uniqueUrls.length}):
              </p>
              <ul className="space-y-1">
                {uniqueUrls.map((url, i) => {
                  const errorCount = errors.filter(e => e.url === url).length;
                  return (
                    <li key={i} className="flex items-center gap-2 text-red-700 dark:text-red-400">
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      <span className="font-mono text-xs truncate flex-1">{url}</span>
                      <span className="px-2 py-0.5 bg-red-200 dark:bg-red-900/40 rounded text-xs font-semibold">
                        {errorCount} error{errorCount !== 1 ? 's' : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            
            {lastCheck && (
              <p className="text-xs text-red-600 dark:text-red-500 italic">
                Last error: {new Date(recentErrors[recentErrors.length - 1]?.timestamp || Date.now()).toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
