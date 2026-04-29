import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

export function TrackingScriptValidator() {
  const [scriptCode, setScriptCode] = useState('');
  const [validation, setValidation] = useState<{
    hasAccountId: boolean;
    accountId: string;
    isValidUuid: boolean;
    belongsToUser: boolean;
    message: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  const validateScript = async () => {
    if (!scriptCode.trim()) {
      toast.error('Please paste your tracking script');
      return;
    }

    setChecking(true);
    try {
      // Get current user from session (no network request needed; server validates auth separately)
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error('Please sign in to validate your script');
        setChecking(false);
        return;
      }

      // Extract account_id from the script
      const accountIdMatch = scriptCode.match(/account_id:\s*['"]([^'"]*)['"]/);
      
      if (!accountIdMatch || !accountIdMatch[1]) {
        setValidation({
          hasAccountId: false,
          accountId: '',
          isValidUuid: false,
          belongsToUser: false,
          message: '❌ No account_id found in script. This script will NOT track visits.'
        });
        setChecking(false);
        return;
      }

      const extractedAccountId = accountIdMatch[1];
      
      // Check if it's a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isValidUuid = uuidRegex.test(extractedAccountId);

      // Check if it matches current user
      const belongsToUser = extractedAccountId === user.id;

      let message = '';
      if (!isValidUuid) {
        message = '❌ Invalid or empty account_id. Script will be rejected by server.';
      } else if (!belongsToUser) {
        message = '⚠️ Account ID belongs to a different user. Visits will not show in YOUR dashboard.';
      } else {
        message = '✅ Script is valid! Visits will appear in your dashboard.';
      }

      setValidation({
        hasAccountId: true,
        accountId: extractedAccountId,
        isValidUuid,
        belongsToUser,
        message
      });
    } catch (err) {
      toast.error('Validation failed: ' + err.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="bg-white dark:bg-black rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Validate Existing Tracking Script</h3>
        <p className="text-sm text-gray-500">
          If tracking isn't working, paste your embedded script here to check if the account_id is valid.
        </p>
      </div>

      <div className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Paste your tracking script:
          </label>
          <textarea
            value={scriptCode}
            onChange={(e) => setScriptCode(e.target.value)}
            placeholder="<script>
  (function() {
    const track = () => {
      fetch('...', {
        body: JSON.stringify({
          account_id: '...'
        })
      })
    }
  })();
</script>"
            className="w-full h-48 p-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg font-mono text-xs text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
          />
        </div>

        <button
          onClick={validateScript}
          disabled={checking || !scriptCode.trim()}
          className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {checking ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Validating...
            </>
          ) : (
            'Validate Script'
          )}
        </button>

        {validation && (
          <div className={`p-4 rounded-lg border ${
            validation.belongsToUser && validation.isValidUuid
              ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/20'
              : validation.hasAccountId && validation.isValidUuid
              ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/20'
              : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/20'
          }`}>
            <div className="flex items-start gap-3">
              {validation.belongsToUser && validation.isValidUuid ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : validation.hasAccountId && validation.isValidUuid ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={`text-sm font-medium mb-2 ${
                  validation.belongsToUser && validation.isValidUuid
                    ? 'text-emerald-900 dark:text-emerald-100'
                    : validation.hasAccountId && validation.isValidUuid
                    ? 'text-amber-900 dark:text-amber-100'
                    : 'text-red-900 dark:text-red-100'
                }`}>
                  {validation.message}
                </p>
                
                {validation.hasAccountId && (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Account ID:</span>
                      <code className="px-2 py-1 bg-white dark:bg-black rounded font-mono">{validation.accountId}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Valid UUID:</span>
                      <span>{validation.isValidUuid ? '✅ Yes' : '❌ No'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Matches Your Account:</span>
                      <span>{validation.belongsToUser ? '✅ Yes' : '❌ No'}</span>
                    </div>
                  </div>
                )}

                {!validation.belongsToUser || !validation.isValidUuid ? (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-semibold mb-1">Action Required:</p>
                    <p className="text-xs">
                      Go back to the "Web Visit Tracking" section above, wait for the "Ready" indicator, 
                      then copy the NEW tracking script and replace it on your website.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
