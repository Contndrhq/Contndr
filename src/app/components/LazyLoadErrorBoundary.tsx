import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, WifiOff, AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  componentName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  isRetrying: boolean;
}

/**
 * Specialized error boundary for lazy-loaded components.
 * Catches chunk loading errors and provides:
 * - Automatic retry with exponential backoff
 * - Clean, professional error UI
 * - Manual retry option
 * - Hard refresh fallback
 */
export class LazyLoadErrorBoundary extends Component<Props, State> {
  private retryTimeout: NodeJS.Timeout | null = null;
  private readonly MAX_AUTO_RETRIES = 2;
  private readonly RETRY_DELAYS = [1500, 3000]; // ms

  public state: State = {
    hasError: false,
    error: null,
    retryCount: 0,
    isRetrying: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const isChunkError = this.isChunkLoadError(error);
    
    console.error(
      `[LazyLoadErrorBoundary] ${isChunkError ? 'Chunk loading error' : 'Component error'} in ${this.props.componentName || 'unknown'}:`,
      error,
      errorInfo
    );

    // Auto-retry chunk loading errors
    if (isChunkError && this.state.retryCount < this.MAX_AUTO_RETRIES) {
      const delay = this.RETRY_DELAYS[this.state.retryCount] || 3000;
      console.log(`[LazyLoadErrorBoundary] Auto-retrying in ${delay}ms (attempt ${this.state.retryCount + 1}/${this.MAX_AUTO_RETRIES})...`);
      
      this.setState({ isRetrying: true });
      
      this.retryTimeout = setTimeout(() => {
        this.handleRetry();
      }, delay);
    }
  }

  public componentWillUnmount() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }

  private isChunkLoadError(error: Error): boolean {
    const message = error.message?.toLowerCase() || '';
    return (
      error.name === 'ChunkLoadError' ||
      message.includes('failed to fetch dynamically imported module') ||
      message.includes('importing a module script failed') ||
      message.includes('failed to fetch') ||
      message.includes('chunk')
    );
  }

  private handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
      isRetrying: false,
    }));
  };

  private handleHardRefresh = () => {
    // Clear all caches and force full page reload
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister());
      });
    }
    
    // Clear cache storage
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    
    // Force reload without cache
    window.location.reload();
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      const isChunkError = this.isChunkLoadError(this.state.error);
      const isRetrying = this.state.isRetrying;
      const canAutoRetry = this.state.retryCount < this.MAX_AUTO_RETRIES;

      // Show retry spinner during auto-retry
      if (isRetrying) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-zinc-200 dark:border-zinc-800 border-t-zinc-600 dark:border-t-zinc-400 rounded-full animate-spin" />
            </div>
            <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
              Retrying... (attempt {this.state.retryCount + 1}/{this.MAX_AUTO_RETRIES})
            </p>
          </div>
        );
      }

      // Show error UI after auto-retries exhausted or for non-chunk errors
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center animate-in fade-in duration-300">
          <div className="max-w-md w-full bg-zinc-900 rounded-2xl border border-zinc-800 shadow-lg p-8">
            {/* Icon */}
            <div className="w-14 h-14 mx-auto bg-zinc-800 rounded-2xl flex items-center justify-center mb-5">
              {isChunkError ? (
                <WifiOff className="w-7 h-7 text-zinc-400" />
              ) : (
                <AlertCircle className="w-7 h-7 text-zinc-400" />
              )}
            </div>

            {/* Title */}
            <h3 className="text-xl font-semibold text-white mb-2">
              {isChunkError ? 'Connection Issue' : 'Something Went Wrong'}
            </h3>

            {/* Description */}
            <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
              {isChunkError ? (
                <>
                  We couldn't load this page. This usually happens due to:
                  <span className="block mt-2 text-xs text-zinc-500">
                    • Network connectivity issues<br/>
                    • App updates requiring a refresh<br/>
                    • Browser cache conflicts
                  </span>
                </>
              ) : (
                this.state.error.message || 'An unexpected error occurred.'
              )}
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              {/* Primary: Try Again */}
              <button
                onClick={this.handleRetry}
                className="flex items-center justify-center gap-2 w-full px-5 py-3 bg-white text-black rounded-xl font-medium transition-all duration-200 shadow-md hover:shadow-lg active:scale-95 hover:bg-zinc-200"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </button>

              {/* Secondary: Hard Refresh (only for chunk errors) */}
              {isChunkError && (
                <button
                  onClick={this.handleHardRefresh}
                  className="flex items-center justify-center gap-2 w-full px-5 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-medium transition-all duration-200 active:scale-95"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Refresh Page</span>
                </button>
              )}
            </div>

            {/* Helper text */}
            {isChunkError && (
              <p className="mt-5 text-xs text-zinc-500">
                Refreshing the page will clear your cache and reload the latest version
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}