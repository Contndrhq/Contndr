import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Wifi, WifiOff, Server, Database } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface ConnectionStatus {
  internet: boolean;
  supabase: boolean;
  database: boolean;
  edgeFunction: boolean;
  errors: string[];
}

export function ConnectionHealthCheck() {
  const [status, setStatus] = useState<ConnectionStatus>({
    internet: true,
    supabase: false,
    database: false,
    edgeFunction: false,
    errors: []
  });
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkConnections();
  }, []);

  async function checkConnections() {
    setChecking(true);
    const errors: string[] = [];
    const newStatus: ConnectionStatus = {
      internet: true,
      supabase: false,
      database: false,
      edgeFunction: false,
      errors: []
    };

    try {
      // 1. Check internet connectivity
      try {
        const response = await fetch('https://www.google.com/favicon.ico', { 
          mode: 'no-cors',
          cache: 'no-store'
        });
        newStatus.internet = true;
      } catch (err) {
        newStatus.internet = false;
        errors.push('No internet connection detected');
      }

      // 2. Check Supabase API connectivity
      try {
        const supabaseUrl = `https://${projectId}.supabase.co`;
        const response = await fetch(`${supabaseUrl}/rest/v1/`, {
          headers: {
            'apikey': publicAnonKey,
            'Authorization': `Bearer ${publicAnonKey}`
          }
        });
        newStatus.supabase = response.status === 200 || response.status === 404;
        if (!newStatus.supabase) {
          errors.push(`Supabase API returned status ${response.status}`);
        }
      } catch (err: any) {
        newStatus.supabase = false;
        errors.push(`Supabase API error: ${err.message}`);
      }

      // 3. Check database connectivity
      try {
        const { error } = await supabase
          .from('leads')
          .select('id')
          .limit(1);

        if (!error || error.code === 'PGRST116') {
          // PGRST116 = "no rows returned" which is fine
          newStatus.database = true;
        } else if (error.code === 'PGRST205') {
          // Table doesn't exist, but connection works
          newStatus.database = true;
          errors.push('Leads table does not exist (needs setup)');
        } else {
          newStatus.database = false;
          errors.push(`Database error: ${error.message} (${error.code})`);
        }
      } catch (err: any) {
        newStatus.database = false;
        errors.push(`Database connection failed: ${err.message}`);
      }

      // 4. Check Edge Function connectivity
      try {
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/public-health`,
          {
            headers: {
              'Authorization': `Bearer ${publicAnonKey}`
            },
            signal: AbortSignal.timeout(5000)
          }
        );
        
        newStatus.edgeFunction = response.ok;
        if (!response.ok) {
          const text = await response.text();
          errors.push(`Edge Function returned status ${response.status}: ${text}`);
        }
      } catch (err: any) {
        newStatus.edgeFunction = false;
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
          errors.push('Edge Function request timed out (not deployed or slow)');
        } else {
          errors.push(`Edge Function error: ${err.message}`);
        }
      }

      newStatus.errors = errors;
      setStatus(newStatus);
    } finally {
      setChecking(false);
    }
  }

  const allGood = status.internet && status.supabase && status.database;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-lg p-4 max-w-md">
        <div className="flex items-center gap-3 mb-3">
          {allGood ? (
            <CheckCircle className="w-5 h-5 text-[#1ED4A7]" />
          ) : (
            <AlertCircle className="w-5 h-5 text-zinc-400" />
          )}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {checking ? 'Checking connections...' : allGood ? 'All systems operational' : 'Connection issues detected'}
            </h3>
          </div>
        </div>

        <div className="space-y-2">
          <StatusItem 
            icon={Wifi}
            label="Internet"
            status={status.internet}
            checking={checking}
          />
          <StatusItem 
            icon={Server}
            label="Supabase API"
            status={status.supabase}
            checking={checking}
          />
          <StatusItem 
            icon={Database}
            label="Database"
            status={status.database}
            checking={checking}
          />
          <StatusItem 
            icon={Server}
            label="Edge Functions"
            status={status.edgeFunction}
            checking={checking}
            optional
          />
        </div>

        {status.errors.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Issues:
            </p>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              {status.errors.map((error, i) => (
                <li key={i}>• {error}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={checkConnections}
          disabled={checking}
          className="mt-3 w-full text-xs font-medium text-[#1ED4A7] dark:text-[#1ED4A7] hover:text-[#1ED4A7]/80 dark:hover:text-[#1ED4A7]/80 disabled:opacity-50"
        >
          {checking ? 'Checking...' : 'Recheck'}
        </button>
      </div>
    </div>
  );
}

function StatusItem({ 
  icon: Icon, 
  label, 
  status, 
  checking,
  optional = false
}: { 
  icon: any; 
  label: string; 
  status: boolean; 
  checking: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-gray-400" />
      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
        {label}
        {optional && <span className="text-xs text-gray-400 ml-1">(optional)</span>}
      </span>
      {checking ? (
        <div className="w-2 h-2 bg-gray-300 dark:bg-gray-600 rounded-full animate-pulse" />
      ) : status ? (
        <CheckCircle className="w-4 h-4 text-[#1ED4A7]" />
      ) : (
        <WifiOff className="w-4 h-4 text-zinc-500" />
      )}
    </div>
  );
}