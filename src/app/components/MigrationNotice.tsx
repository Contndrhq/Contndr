import { AlertCircle, ExternalLink, Copy, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export function MigrationNotice({ onDismiss }: { onDismiss?: () => void }) {
  const [copied, setCopied] = useState(false);

  const migrationSQL = `-- Migration: Add sender columns to campaigns table
-- Run this in your Supabase SQL Editor

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' AND column_name = 'sender_name'
  ) THEN
    ALTER TABLE public.campaigns ADD COLUMN sender_name TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'campaigns' AND column_name = 'sender_title'
  ) THEN
    ALTER TABLE public.campaigns ADD COLUMN sender_title TEXT;
  END IF;
END $$;`;

  function copyMigration() {
    navigator.clipboard.writeText(migrationSQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      alert('Failed to copy. Please manually copy the SQL below.');
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 z-50 animate-fade-in">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-2xl w-full shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-red-500 p-6 text-white rounded-t-2xl">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-[22px] font-semibold mb-1">Database Migration Required</h2>
              <p className="text-amber-100 text-[14px]">
                New columns need to be added to the campaigns table
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4">
            <p className="text-amber-900 dark:text-amber-100 text-[14px]">
              <strong>Error:</strong> The database is missing required columns (<code className="bg-amber-200 dark:bg-amber-900 px-1.5 py-0.5 rounded text-[13px]">sender_name</code> and <code className="bg-amber-200 dark:bg-amber-900 px-1.5 py-0.5 rounded text-[13px]">sender_title</code>) in the campaigns table.
            </p>
          </div>

          <div>
            <h3 className="text-[15px] font-semibold mb-3 text-gray-900 dark:text-white">
              Follow these steps to fix:
            </h3>
            
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-7 h-7 bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                  1
                </div>
                <div className="flex-1">
                  <p className="text-gray-700 dark:text-gray-300 text-[14px] mb-2">
                    Copy the migration SQL below
                  </p>
                  <button
                    onClick={copyMigration}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-[13px] font-medium"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Migration SQL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-7 h-7 bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                  2
                </div>
                <div className="flex-1">
                  <p className="text-gray-700 dark:text-gray-300 text-[14px] mb-2">
                    Open Supabase SQL Editor
                  </p>
                  <a
                    href="https://supabase.com/dashboard/project/_/sql"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors text-[13px] font-medium"
                  >
                    <span>Open SQL Editor</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-7 h-7 bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                  3
                </div>
                <div>
                  <p className="text-gray-700 dark:text-gray-300 text-[14px]">
                    Paste the SQL and click <strong>"Run"</strong>
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-7 h-7 bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                  4
                </div>
                <div>
                  <p className="text-gray-700 dark:text-gray-300 text-[14px]">
                    Refresh this page
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* SQL Preview */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
              <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300">Migration SQL</p>
            </div>
            <pre className="p-4 bg-gray-50 dark:bg-gray-900/50 overflow-x-auto">
              <code className="text-[12px] text-gray-800 dark:text-gray-200 font-mono">
                {migrationSQL}
              </code>
            </pre>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-[14px] font-medium"
              >
                I'll do this later
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-emerald-600 dark:bg-emerald-700 text-white rounded-lg hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors text-[14px] font-medium"
            >
              I've run the SQL - Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}