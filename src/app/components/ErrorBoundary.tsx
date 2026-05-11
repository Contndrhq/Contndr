import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Best-effort report to the backend so support actually finds out when
// users crash. Doesn't block rendering the fallback UI. Auth header is
// included only if the user already has a session — pre-login crashes
// still report anonymously. Failures here are intentionally silent — if
// the reporter is broken we don't want it to recursively crash the
// ErrorBoundary itself.
async function reportError(error: Error, info: ErrorInfo) {
  try {
    let authHeader: Record<string, string> = {};
    try {
      // Read the cached Supabase session synchronously from localStorage —
      // dynamically importing the supabase client here would deepen the
      // failure surface during a crash.
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const token = parsed?.access_token || parsed?.currentSession?.access_token;
        if (token) { authHeader = { Authorization: `Bearer ${token}` }; break; }
      }
    } catch { /* no session — report anonymously */ }

    const build = (typeof window !== 'undefined' && (window as any).__contndr_build?.sha) || 'unknown';
    await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/errors/report`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publicAnonKey,
          ...authHeader,
        },
        body: JSON.stringify({
          message: error?.message || 'Unknown error',
          stack: error?.stack || null,
          component_stack: info?.componentStack || null,
          url: typeof window !== 'undefined' ? window.location.href : null,
          build,
        }),
        keepalive: true, // survive the page unload that often follows a crash
      },
    );
  } catch { /* swallow — never make a crash worse */ }
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    reportError(error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-zinc-800">
          <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-zinc-600 dark:text-zinc-400" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Something went wrong</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mb-6 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred while rendering this component.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white text-black rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try Again</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}