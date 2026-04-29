import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, XCircle, Loader } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface DiagnosticCheck {
  name: string;
  status: 'pending' | 'success' | 'error' | 'warning';
  message: string;
  details?: string;
}

export function StartupDiagnostics() {
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [hasErrors, setHasErrors] = useState(false);

  useEffect(() => {
    runDiagnostics();
  }, []);

  const addCheck = (check: DiagnosticCheck) => {
    setChecks(prev => [...prev, check]);
  };

  const runDiagnostics = async () => {
    const diagnostics: DiagnosticCheck[] = [];

    // 1. Check React is loaded
    diagnostics.push({
      name: 'React Environment',
      status: 'success',
      message: 'React loaded successfully'
    });

    // 2. Check Supabase client
    try {
      if (supabase) {
        diagnostics.push({
          name: 'Supabase Client',
          status: 'success',
          message: 'Supabase client initialized'
        });
      } else {
        diagnostics.push({
          name: 'Supabase Client',
          status: 'error',
          message: 'Supabase client not initialized'
        });
      }
    } catch (error: any) {
      diagnostics.push({
        name: 'Supabase Client',
        status: 'error',
        message: 'Failed to load Supabase',
        details: error.message
      });
    }

    // 3. Check localStorage
    try {
      localStorage.setItem('test', 'test');
      localStorage.removeItem('test');
      diagnostics.push({
        name: 'LocalStorage',
        status: 'success',
        message: 'LocalStorage accessible'
      });
    } catch (error: any) {
      diagnostics.push({
        name: 'LocalStorage',
        status: 'warning',
        message: 'LocalStorage not available',
        details: 'Some features may not work properly'
      });
    }

    // 4. Check Network Connectivity
    try {
      const online = navigator.onLine;
      if (online) {
        diagnostics.push({
          name: 'Network Connection',
          status: 'success',
          message: 'Device is online'
        });
      } else {
        diagnostics.push({
          name: 'Network Connection',
          status: 'error',
          message: 'Device is offline',
          details: 'Connect to the internet to use the app'
        });
      }
    } catch (error: any) {
      diagnostics.push({
        name: 'Network Connection',
        status: 'warning',
        message: 'Cannot determine network status'
      });
    }

    // 5. Check Browser Compatibility
    const isCompatible = 
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      typeof fetch !== 'undefined' &&
      typeof Promise !== 'undefined';

    if (isCompatible) {
      diagnostics.push({
        name: 'Browser Compatibility',
        status: 'success',
        message: 'Browser is compatible'
      });
    } else {
      diagnostics.push({
        name: 'Browser Compatibility',
        status: 'error',
        message: 'Browser may not be fully compatible',
        details: 'Please use a modern browser (Chrome, Firefox, Safari, Edge)'
      });
    }

    // 6. Check Dark Mode
    try {
      const isDark = document.documentElement.classList.contains('dark');
      diagnostics.push({
        name: 'Theme',
        status: 'success',
        message: `Theme: ${isDark ? 'Dark' : 'Light'}`
      });
    } catch (error: any) {
      diagnostics.push({
        name: 'Theme',
        status: 'warning',
        message: 'Could not detect theme'
      });
    }

    // Update state
    setChecks(diagnostics);
    setIsComplete(true);
    setHasErrors(diagnostics.some(d => d.status === 'error'));

    // Auto-hide after 5 seconds if no errors
    if (!diagnostics.some(d => d.status === 'error')) {
      setTimeout(() => {
        const element = document.getElementById('startup-diagnostics');
        if (element) {
          element.style.opacity = '0';
          setTimeout(() => {
            element.style.display = 'none';
          }, 300);
        }
      }, 3000);
    }

    // Log to console
    console.log('[DIAGNOSTICS] ========== STARTUP DIAGNOSTICS ==========');
    diagnostics.forEach(d => {
      const icon = d.status === 'success' ? '✅' : d.status === 'error' ? '❌' : '⚠️';
      console.log(`[DIAGNOSTICS] ${icon} ${d.name}: ${d.message}`);
      if (d.details) {
        console.log(`[DIAGNOSTICS]    └─ ${d.details}`);
      }
    });
    console.log('[DIAGNOSTICS] =============================================');
  };

  if (checks.length === 0) {
    return null; // Don't show anything during initial load
  }

  const getStatusIcon = (status: DiagnosticCheck['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
    }
  };

  return (
    <div
      id="startup-diagnostics"
      className="fixed top-4 right-4 z-[9999] w-80 bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden transition-opacity duration-300"
    >
      <div className={`px-4 py-3 flex items-center justify-between ${
        hasErrors ? 'bg-red-600' : 'bg-gradient-to-r from-blue-600 to-purple-600'
      } text-white`}>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          <h3 className="font-semibold">Startup Diagnostics</h3>
        </div>
        {isComplete && (
          <button
            onClick={() => {
              const element = document.getElementById('startup-diagnostics');
              if (element) element.style.display = 'none';
            }}
            className="text-white/80 hover:text-white transition-colors"
          >
            ×
          </button>
        )}
      </div>

      <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
        {checks.map((check, index) => (
          <div
            key={index}
            className="flex items-start gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800"
          >
            <div className="mt-0.5">{getStatusIcon(check.status)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {check.name}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                {check.message}
              </p>
              {check.details && (
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 italic">
                  {check.details}
                </p>
              )}
            </div>
          </div>
        ))}

        {!isComplete && (
          <div className="flex items-center justify-center py-4">
            <Loader className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        )}

        {isComplete && hasErrors && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200 font-medium">
              ⚠️ Some checks failed
            </p>
            <p className="text-xs text-red-600 dark:text-red-300 mt-1">
              The app may not function properly. Please resolve the errors above.
            </p>
          </div>
        )}

        {isComplete && !hasErrors && (
          <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-200 font-medium">
              ✅ All checks passed
            </p>
            <p className="text-xs text-green-600 dark:text-green-300 mt-1">
              This panel will auto-hide in 3 seconds...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
