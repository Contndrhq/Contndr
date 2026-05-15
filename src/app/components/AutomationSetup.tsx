import { Database, Copy, CheckCircle, ExternalLink, Zap } from 'lucide-react';
import { useState, useRef } from 'react';

export function AutomationSetup() {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sqlScript = `-- ============================================
-- QUICK FIX: Add Automation Rules Table
-- ============================================
-- Copy this SQL and run it in your Supabase SQL Editor

-- Create Automation Rules table
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  search_query TEXT NOT NULL,
  location TEXT NOT NULL,
  leads_per_run INTEGER DEFAULT 20,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  last_run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns to existing tables (if they don't exist)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS brand TEXT DEFAULT 'Contndr';
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT 'Let me help grow your business';
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS follow_up_attempts INTEGER DEFAULT 3;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS days_between_follow_ups INTEGER DEFAULT 3;

ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS sequence_number INTEGER DEFAULT 1;
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS lead_status TEXT DEFAULT 'sent';
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP WITH TIME ZONE;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON public.automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_next_run ON public.automation_rules(next_run_at);

-- Enable Row Level Security
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

-- Create policy
DROP POLICY IF EXISTS "Allow all on automation_rules" ON public.automation_rules;
CREATE POLICY "Allow all on automation_rules" ON public.automation_rules FOR ALL USING (true) WITH CHECK (true);`;

  function copyToClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sqlScript).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {
          fallbackCopy();
        });
      } else {
        fallbackCopy();
      }
    } catch (error) {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    if (textareaRef.current) {
      textareaRef.current.select();
      textareaRef.current.setSelectionRange(0, 99999);
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  }

  function selectAll() {
    if (textareaRef.current) {
      textareaRef.current.select();
      textareaRef.current.setSelectionRange(0, 99999);
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-zinc-50 dark:bg-zinc-950 p-6 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6 text-zinc-500 dark:text-zinc-400" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white mb-1">
                Automation Setup Required
              </h2>
              <p className="text-[14px] text-zinc-600 dark:text-zinc-400">
                Run this SQL script in Supabase to enable automation features
              </p>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="p-6 space-y-5">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white mb-1 text-[14px]">
                  Open Supabase SQL Editor
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-[13px] mb-2">
                  Go to your Supabase project and open the SQL Editor
                </p>
                <a
                  href="https://supabase.com/dashboard/project/_/sql"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors text-[13px] font-medium"
                >
                  <span>Open SQL Editor</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                2
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-zinc-900 dark:text-white mb-1 text-[14px]">
                  Copy the SQL Script
                </h3>
                <p className="text-zinc-600 dark:text-zinc-400 text-[13px] mb-3">
                  Click below to copy the complete setup script
                </p>
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 px-3 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors text-[13px] font-medium"
                >
                  {copied ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy SQL Script</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                3
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-white mb-1 text-[14px]">
                  Run the Script
                </h3>
                <p className="text-zinc-600 dark:text-zinc-400 text-[13px]">
                  Paste the SQL into the editor and click "Run" to create the automation tables
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-[14px]">
                4
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-white mb-1 text-[14px]">
                  Refresh This Page
                </h3>
                <p className="text-zinc-600 dark:text-zinc-400 text-[13px]">
                  Once complete, refresh to start using automation features
                </p>
              </div>
            </div>
          </div>

          {/* SQL Preview */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-medium text-zinc-900 dark:text-white">
                SQL Script Preview
              </h3>
              <button
                onClick={selectAll}
                className="text-[12px] text-[#1ED4A7] dark:text-[#1ED4A7] hover:text-[#1ED4A7]/80 dark:hover:text-[#1ED4A7]/80 font-medium"
              >
                Select All
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={sqlScript}
              readOnly
              onClick={selectAll}
              className="w-full h-64 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700 font-mono text-xs text-zinc-700 dark:text-zinc-300 resize-none focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              💡 Click in the box to select all text, then copy with Ctrl+C (Cmd+C on Mac)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}