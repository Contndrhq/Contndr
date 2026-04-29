import { useState } from 'react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

interface SubscriptionDebuggerProps {
  user: any;
  subscriptionStatus: any;
  onClose: () => void;
}

export function SubscriptionDebugger({ user, subscriptionStatus, onClose }: SubscriptionDebuggerProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  const refreshStatus = async () => {
    setIsRefreshing(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/billing/status`,
        { headers }
      );
      
      if (res.ok) {
        const data = await res.json();
        setDebugInfo({
          success: true,
          status: res.status,
          data: data,
          timestamp: new Date().toISOString()
        });
      } else {
        const errorText = await res.text().catch(() => 'Unknown error');
        setDebugInfo({
          success: false,
          status: res.status,
          error: errorText,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      setDebugInfo({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const userEmail = user?.email || user?.user_metadata?.email || 'Unknown';
  const status = subscriptionStatus?.status || 'Unknown';
  const plan = subscriptionStatus?.plan || 'Unknown';
  const isWhitelisted = subscriptionStatus?.isWhitelisted || false;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Subscription Debugger
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Current Status */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Current Status
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Email:</span>
                <span className="font-mono text-gray-900 dark:text-white">{userEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">User ID:</span>
                <span className="font-mono text-gray-900 dark:text-white">{user?.id || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Subscription Status:</span>
                <span className={`font-semibold ${
                  status === 'active' ? 'text-green-600 dark:text-green-400' :
                  status === 'pending' ? 'text-yellow-600 dark:text-yellow-400' :
                  'text-red-600 dark:text-red-400'
                }`}>
                  {status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Plan:</span>
                <span className="font-semibold text-gray-900 dark:text-white">{plan}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Whitelisted:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {isWhitelisted ? 'Yes' : 'No'}
                </span>
              </div>
              {subscriptionStatus?.stripe_sub_id && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Stripe Sub ID:</span>
                  <span className="font-mono text-xs text-gray-900 dark:text-white">
                    {subscriptionStatus.stripe_sub_id}
                  </span>
                </div>
              )}
              {subscriptionStatus?.updated_at && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Updated:</span>
                  <span className="text-xs text-gray-900 dark:text-white">
                    {new Date(subscriptionStatus.updated_at).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Access Control Logic */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Access Control Decision
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="text-gray-600 dark:text-gray-400">Is Admin:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' ? '✅ Yes' : '❌ No'}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-gray-600 dark:text-gray-400">Has Active Status:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {status === 'active' ? '✅ Yes' : '❌ No'}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-gray-600 dark:text-gray-400">Expected Screen:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com' 
                    ? '✅ Full Access (Admin)'
                    : status === 'active'
                    ? '✅ Full Access'
                    : status === 'pending' || status === 'pending_signup' || plan === 'waitlist'
                    ? '📋 Pending Access Screen'
                    : '💳 Upgrade Modal (Forced)'}
                </span>
              </div>
            </div>
          </div>

          {/* Refresh Button */}
          <button
            onClick={refreshStatus}
            disabled={isRefreshing}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg mb-4 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh from Server'}
          </button>

          {/* Debug Info */}
          {debugInfo && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Server Response
              </h3>
              <div className="text-xs font-mono bg-gray-900 dark:bg-black text-green-400 p-4 rounded overflow-x-auto">
                <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-6 text-sm text-gray-600 dark:text-gray-400">
            <p className="font-semibold mb-2">Troubleshooting Guide:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>If status is "pending" or "waitlist", user should see the waitlist screen</li>
              <li>If status is NOT "active" (inactive, canceled, etc.), user should see upgrade modal</li>
              <li>Only "active" status grants full access (unless admin)</li>
              <li>Check server logs for detailed subscription lookup information</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}