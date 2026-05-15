import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  error: Error | null;
}

/**
 * AdminPanelErrorBoundary — catches render errors inside admin sub-panels so
 * the whole dashboard doesn't whitescreen when one panel has a bug. Shows
 * the actual error message + a "try again" button.
 */
export class AdminPanelErrorBoundary extends Component<{ resetKey?: string; children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: { resetKey?: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[ADMIN-PANEL] crash:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm">
          <div className="flex items-center gap-2 text-red-500 font-semibold mb-2">
            <AlertTriangle className="w-4 h-4" /> This panel crashed
          </div>
          <pre className="text-xs text-red-400 whitespace-pre-wrap break-all mb-3">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 text-xs font-medium"
          >
            <RefreshCw className="w-3 h-3" /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
