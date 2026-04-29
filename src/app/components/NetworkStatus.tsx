import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Floating banner that appears when the user goes offline or the edge function
 * is unreachable.  Automatically dismisses when connectivity is restored.
 */
export function NetworkStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const goOffline = () => { setOffline(true); setDismissed(false); };
    const goOnline  = () => setOffline(false);

    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (!offline || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] animate-slide-up">
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 shadow-lg shadow-black/30">
        <WifiOff className="w-4 h-4 text-red-400 flex-shrink-0" />
        <span className="text-sm text-zinc-200 font-medium">
          You're offline — some features may not work
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
