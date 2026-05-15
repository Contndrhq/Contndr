import { Database, ExternalLink, Copy, CheckCircle } from 'lucide-react';
import { useState, useRef } from 'react';

export function DatabaseSetup() {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sqlSchema = `-- Contndr Database Schema
-- Copy and paste this entire script into your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.organizations (name) 
VALUES ('Default Organization')
ON CONFLICT DO NOTHING;

-- Leads table
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  business_name TEXT NOT NULL,
  category TEXT,
  city TEXT,
  address TEXT,
  website TEXT,
  email TEXT,
  phone TEXT,
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'active',
  rating DECIMAL(3,2),
  reviews INTEGER,
  place_id TEXT,
  lat DECIMAL(10,8),
  lng DECIMAL(11,8),
  brand TEXT,
  bounced BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add brand and bounced columns if they don't exist (migration)
-- This ensures the columns exist even if the table was created before
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bounced BOOLEAN DEFAULT false;

-- Campaigns table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'Roadr',
  subject TEXT NOT NULL DEFAULT 'Let me help grow your business',
  product TEXT NOT NULL,
  price_summary TEXT,
  landing_url TEXT,
  tone TEXT NOT NULL DEFAULT 'professional',
  from_email TEXT NOT NULL,
  sender_name TEXT,
  sender_title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  follow_up_enabled BOOLEAN DEFAULT false,
  follow_up_attempts INTEGER DEFAULT 3,
  days_between_follow_ups INTEGER DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add sender columns if they don't exist (migration)
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
END $$;

-- Campaign Leads table
CREATE TABLE IF NOT EXISTS public.campaign_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  last_email_id UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(campaign_id, lead_id)
);

-- Emails table
CREATE TABLE IF NOT EXISTS public.emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID,
  resend_id TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  preview TEXT,
  text_body TEXT,
  html_body TEXT,
  direction TEXT DEFAULT 'outbound',
  status TEXT NOT NULL DEFAULT 'queued',
  sequence_number INTEGER DEFAULT 1,
  lead_status TEXT DEFAULT 'sent',
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  bounced_at TIMESTAMP WITH TIME ZONE,
  replied_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email Events table
CREATE TABLE IF NOT EXISTS public.email_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_id UUID NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lead Groups table
CREATE TABLE IF NOT EXISTS public.lead_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'blue',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Group Leads junction table
CREATE TABLE IF NOT EXISTS public.group_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES public.lead_groups(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(group_id, lead_id)
);

-- Follow-ups table
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID,
  email_id UUID REFERENCES public.emails(id) ON DELETE SET NULL,
  attempt_number INTEGER NOT NULL,
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Automation Rules table
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

-- Signatures table
CREATE TABLE IF NOT EXISTS public.signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  company TEXT,
  phone TEXT,
  website TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, brand)
);

-- AI Call Campaigns table (lightweight tracking for real-time updates)
CREATE TABLE IF NOT EXISTS public.ai_call_campaigns (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  total_calls INTEGER DEFAULT 0,
  completed_calls INTEGER DEFAULT 0,
  in_progress INTEGER DEFAULT 0,
  booked_meetings INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_city ON public.leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON public.leads(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON public.campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_resend_id ON public.emails(resend_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON public.emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_campaign_id ON public.emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_emails_lead_id ON public.emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_date ON public.follow_ups(due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON public.follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON public.automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_next_run ON public.automation_rules(next_run_at);

-- Enable Row Level Security
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all for now)
CREATE POLICY "Allow all on organizations" ON public.organizations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on leads" ON public.leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on campaigns" ON public.campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on campaign_leads" ON public.campaign_leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on emails" ON public.emails FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on email_events" ON public.email_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on lead_groups" ON public.lead_groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on group_leads" ON public.group_leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on follow_ups" ON public.follow_ups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on automation_rules" ON public.automation_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on signatures" ON public.signatures FOR ALL USING (true) WITH CHECK (true);`;

  function copyToClipboard() {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sqlSchema).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {
          // Fallback to textarea method
          fallbackCopy();
        });
      } else {
        // Use fallback method
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
        alert('Please manually select and copy the SQL below');
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
    <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-br from-zinc-900 to-black p-8 text-white">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center">
                <Database className="w-8 h-8 text-[#1ED4A7]" strokeWidth={2} />
              </div>
              <div>
                <h1 className="text-[28px] font-semibold mb-1">Database Setup Required</h1>
                <p className="text-zinc-400 text-[15px]">
                  Create the database tables to start using Contndr
                </p>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="p-8 space-y-6">
            <div>
              <h2 className="text-[20px] font-semibold mb-4 text-gray-900">
                Follow these steps to set up your database:
              </h2>
              
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-full flex items-center justify-center font-semibold flex-shrink-0">
                    1
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 mb-1">Open Supabase SQL Editor</h3>
                    <p className="text-gray-600 text-[14px] mb-2">
                      Go to your Supabase project dashboard and open the SQL Editor
                    </p>
                    <a
                      href="https://supabase.com/dashboard/project/_/sql"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-[14px] font-medium"
                    >
                      <span>Open SQL Editor</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-full flex items-center justify-center font-semibold flex-shrink-0">
                    2
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">Copy the SQL Schema</h3>
                    <p className="text-gray-600 text-[14px] mb-3">
                      Click the button below to copy the complete database schema
                    </p>
                    <button
                      onClick={copyToClipboard}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors text-[14px] font-medium"
                    >
                      {copied ? (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy SQL Schema</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-full flex items-center justify-center font-semibold flex-shrink-0">
                    3
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 mb-1">Run the Schema</h3>
                    <p className="text-gray-600 text-[14px]">
                      Paste the SQL into the editor and click "Run" to create all tables
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-full flex items-center justify-center font-semibold flex-shrink-0">
                    4
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 mb-1">Refresh This Page</h3>
                    <p className="text-gray-600 text-[14px]">
                      Once the schema is created, refresh this page to start using Contndr
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="border-t border-gray-200 pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[15px] font-medium text-gray-900">Complete SQL Schema</h3>
                <button
                  onClick={selectAll}
                  className="text-[13px] text-[#1ED4A7] hover:text-[#1ED4A7]/80 font-medium"
                >
                  Select All
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={sqlSchema}
                readOnly
                onClick={selectAll}
                className="w-full h-64 bg-gray-50 rounded-lg p-4 border border-gray-200 font-mono text-[12px] text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]"
                placeholder="SQL Schema will appear here..."
              />
              <p className="text-[12px] text-gray-500 mt-2">
                💡 Tip: Click in the box above to select all text, then Ctrl+C (Cmd+C on Mac) to copy
              </p>
            </div>

            {/* What Gets Created */}
            <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <h3 className="text-zinc-900 dark:text-zinc-100 font-medium mb-3 text-[15px]">What gets created:</h3>
              <ul className="space-y-2 text-zinc-700 dark:text-zinc-300 text-[14px]">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>organizations</strong> - Multi-tenant support</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>leads</strong> - Business contacts with location data</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>campaigns</strong> - Email campaign configurations</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>campaign_leads</strong> - Lead assignments with status</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>emails</strong> - Sent email records and tracking</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>email_events</strong> - Detailed event logs</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>lead_groups</strong> - Grouping leads for organization</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>group_leads</strong> - Junction table for lead groups</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>follow_ups</strong> - Scheduled follow-up emails</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>automation_rules</strong> - Automated lead campaigns</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>signatures</strong> - Email signatures for branding</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0" />
                  <span><strong>ai_call_campaigns</strong> - Lightweight tracking for real-time updates</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}