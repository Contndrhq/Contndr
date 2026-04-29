import { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

interface AccessDebuggerProps {
  user: any;
  subscriptionStatus: any;
  isVisible: boolean;
  onClose: () => void;
}

export function AccessDebugger({ user, subscriptionStatus, isVisible, onClose }: AccessDebuggerProps) {
  const [liveStatus, setLiveStatus] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLiveStatus = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/status`,
        { headers }
      );
      
      if (res.ok) {
        const data = await res.json();
        setLiveStatus(data);
      } else {
        const errorText = await res.text();
        setError(`HTTP ${res.status}: ${errorText}`);
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isVisible) {
      fetchLiveStatus();
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const email = user?.email || user?.user_metadata?.email;
  const userEmail = email?.toLowerCase().trim();
  const isAdmin = userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com';

  const getStatusIcon = (status: string) => {
    if (status === 'active') return <CheckCircle className="w-5 h-5 text-[#1ED4A7]" />;
    if (status === 'pending') return <AlertCircle className="w-5 h-5 text-zinc-400" />;
    return <XCircle className="w-5 h-5 text-zinc-500" />;
  };

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'text-[#1ED4A7] bg-[#1ED4A7]/10 border-[#1ED4A7]/20';
    if (status === 'pending') return 'text-zinc-400 bg-zinc-800 border-zinc-700';
    return 'text-zinc-500 bg-zinc-800 border-zinc-700';
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-96 bg-white dark:bg-zinc-900 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-zinc-800 to-zinc-900 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          <h3 className="font-semibold">Access Control Debugger</h3>
        </div>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
        {/* User Info */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">User Information</h4>
          <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Email:</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">{userEmail || 'Unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">User ID:</span>
              <span className="font-mono text-xs text-zinc-900 dark:text-zinc-100">{user?.id?.substring(0, 16)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Is Admin:</span>
              <span className={`font-semibold ${isAdmin ? 'text-[#1ED4A7]' : 'text-zinc-600'}`}>
                {isAdmin ? 'Yes 👑' : 'No'}
              </span>
            </div>
          </div>
        </div>

        {/* Frontend Subscription Status */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">Frontend Status (Current)</h4>
          <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-sm space-y-2">
            {subscriptionStatus ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Status:</span>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(subscriptionStatus.status)}
                    <span className={`font-semibold px-2 py-1 rounded border ${getStatusColor(subscriptionStatus.status)}`}>
                      {subscriptionStatus.status}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Plan:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{subscriptionStatus.plan || 'none'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Whitelisted:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {subscriptionStatus.isWhitelisted ? 'Yes' : 'No'}
                  </span>
                </div>
                {subscriptionStatus.updated_at && (
                  <div className="flex justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Updated:</span>
                    <span className="text-xs text-zinc-900 dark:text-zinc-100">
                      {new Date(subscriptionStatus.updated_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-zinc-500 italic">No subscription data</div>
            )}
          </div>
        </div>

        {/* Live Backend Status */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">Backend Status (Live)</h4>
            <button
              onClick={fetchLiveStatus}
              disabled={isRefreshing}
              className="text-[#1ED4A7] hover:text-[#1ED4A7]/80 disabled:text-zinc-400 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-sm space-y-2">
            {error ? (
              <div className="text-zinc-400 text-xs">{error}</div>
            ) : liveStatus ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Status:</span>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(liveStatus.status)}
                    <span className={`font-semibold px-2 py-1 rounded border ${getStatusColor(liveStatus.status)}`}>
                      {liveStatus.status}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Plan:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{liveStatus.plan || 'none'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Whitelisted:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {liveStatus.isWhitelisted ? 'Yes' : 'No'}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-zinc-500 italic">Loading...</div>
            )}
          </div>
        </div>

        {/* Access Decision */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">Access Decision</h4>
          <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-sm space-y-2">
            {isAdmin ? (
              <div className="flex items-center gap-2 text-[#1ED4A7]">
                <CheckCircle className="w-5 h-5" />
                <span className="font-semibold">ADMIN - Full Access Granted</span>
              </div>
            ) : subscriptionStatus?.status === 'active' ? (
              <div className="flex items-center gap-2 text-[#1ED4A7]">
                <CheckCircle className="w-5 h-5" />
                <span className="font-semibold">ACCESS GRANTED - Active Subscription</span>
              </div>
            ) : subscriptionStatus?.status === 'pending' ? (
              <div className="flex items-center gap-2 text-zinc-400">
                <AlertCircle className="w-5 h-5" />
                <span className="font-semibold">WAITLIST - Pending Access</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-zinc-500">
                <XCircle className="w-5 h-5" />
                <span className="font-semibold">ACCESS DENIED - Upgrade Required</span>
              </div>
            )}
          </div>
        </div>

        {/* Console Commands */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">Console Commands</h4>
          <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-xs font-mono space-y-1">
            <div className="text-zinc-600 dark:text-zinc-400">
              Open browser console and run:
            </div>
            <code className="block bg-zinc-900 text-[#1ED4A7] p-2 rounded">
              debugSubscription()
            </code>
            <div className="text-zinc-600 dark:text-zinc-400 mt-2">
              To check backend directly:
            </div>
            <code className="block bg-zinc-900 text-[#1ED4A7] p-2 rounded break-all">
              {`fetch('https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/check-subscription/${userEmail}').then(r=>r.json()).then(console.log)`}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccessDebugger;