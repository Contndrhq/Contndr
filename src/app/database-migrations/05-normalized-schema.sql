-- ============================================================================
-- Sendlr Normalized Schema Migration
-- Transforms flat leads table into normalized structure
-- ============================================================================
-- RUN THIS IN SUPABASE SQL EDITOR BEFORE UPDATING CODE
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext"; -- Case-insensitive email matching

-- ============================================================================
-- 1. COMPANIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  
  -- Core company info
  name TEXT NOT NULL,
  name_for_emails TEXT,
  website TEXT,
  industry TEXT,
  keywords TEXT, -- comma-separated or JSON array
  
  -- Social links
  linkedin_url TEXT,
  facebook_url TEXT,
  twitter_url TEXT,
  
  -- Contact info
  company_phone TEXT,
  
  -- Address fields
  address_full TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  
  -- Financial data
  annual_revenue NUMERIC,
  total_funding NUMERIC,
  latest_funding TEXT,
  latest_funding_amount NUMERIC,
  last_raised_at TIMESTAMPTZ,
  subsidiary_of TEXT,
  
  -- Company details
  number_of_retail_locations INTEGER,
  employees TEXT, -- Store as text to handle ranges like "51-200"
  technologies TEXT, -- comma-separated or JSON array
  
  -- Apollo integration
  apollo_account_id TEXT UNIQUE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. NEW LEADS TABLE (normalized)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.leads_new (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  
  -- Contact info
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  seniority TEXT,
  departments TEXT, -- JSON array or comma-separated
  
  -- CRM fields
  stage TEXT DEFAULT 'Cold',
  lists TEXT, -- JSON array or comma-separated
  account_owner TEXT,
  last_contacted TIMESTAMPTZ,
  
  -- Location (person-specific)
  city TEXT,
  state TEXT,
  country TEXT,
  
  -- Social
  person_linkedin_url TEXT,
  
  -- Engagement tracking
  email_sent BOOLEAN DEFAULT false,
  email_open BOOLEAN DEFAULT false,
  email_bounced BOOLEAN DEFAULT false,
  replied BOOLEAN DEFAULT false,
  demoed BOOLEAN DEFAULT false,
  
  -- Legacy fields for backwards compatibility
  business_name TEXT, -- Deprecated, use company.name
  category TEXT,
  address TEXT,
  website TEXT, -- Deprecated, use company.website
  phone TEXT, -- Deprecated, use lead_phones
  email TEXT, -- Deprecated, use lead_emails
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'active',
  rating DECIMAL(3,2),
  reviews INTEGER,
  place_id TEXT,
  lat DECIMAL(10,8),
  lng DECIMAL(11,8),
  brand TEXT DEFAULT 'sourcr',
  campaign_id UUID,
  last_email_sent TIMESTAMPTZ,
  engagement_score INTEGER,
  reply_received BOOLEAN,
  notes TEXT,
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  last_clicked_at TIMESTAMPTZ,
  job_title TEXT, -- Deprecated, use title
  linkedin TEXT, -- Deprecated, use person_linkedin_url
  employees TEXT, -- Deprecated, use company.employees
  industry TEXT, -- Deprecated, use company.industry
  keywords TEXT[], -- Deprecated, use company.keywords
  
  -- Apollo integration
  apollo_contact_id TEXT UNIQUE,
  raw_source TEXT, -- e.g., "Apollo CSV", "SerpApi", "Manual"
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. LEAD EMAILS TABLE (supports primary/secondary/tertiary)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lead_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads_new(id) ON DELETE CASCADE,
  
  email CITEXT NOT NULL, -- Case-insensitive
  type TEXT NOT NULL CHECK (type IN ('primary', 'secondary', 'tertiary', 'other')),
  
  -- Email metadata (from Apollo)
  status TEXT, -- "User Managed", "Verified", etc.
  source TEXT, -- "User Import", "Findymail", etc.
  verification_source TEXT,
  confidence TEXT, -- "high", "medium", "low" or numeric
  catch_all_status TEXT,
  last_verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(lead_id, email)
);

-- ============================================================================
-- 4. LEAD PHONES TABLE (supports multiple phone types)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lead_phones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads_new(id) ON DELETE CASCADE,
  
  phone TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('work_direct', 'home', 'mobile', 'corporate', 'other')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(lead_id, phone)
);

-- ============================================================================
-- 5. LEAD CUSTOM FIELDS TABLE (future-proofing)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lead_custom_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads_new(id) ON DELETE CASCADE,
  
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(lead_id, key)
);

-- ============================================================================
-- 6. DATA MIGRATION (copy existing leads to new schema)
-- ============================================================================
-- Note: This is a safe migration that preserves all existing data
-- Run this AFTER creating the new tables

-- Step 1: Create companies from existing leads (deduplicate by website/business_name)
INSERT INTO public.companies (
  org_id, user_id, name, website, industry, keywords, employees,
  city, state, country, address_full, apollo_account_id, created_at
)
SELECT DISTINCT ON (COALESCE(website, business_name))
  org_id,
  user_id,
  business_name,
  website,
  industry,
  CASE 
    WHEN keywords IS NOT NULL THEN array_to_string(keywords, ', ')
    ELSE NULL
  END,
  employees,
  city,
  state,
  'United States', -- Default country
  address,
  NULL, -- apollo_account_id (will be populated during CSV import)
  created_at
FROM public.leads
WHERE business_name IS NOT NULL OR website IS NOT NULL
ON CONFLICT DO NOTHING;

-- Step 2: Migrate leads to new normalized structure
INSERT INTO public.leads_new (
  id, org_id, user_id, company_id,
  first_name, last_name, title,
  stage, business_name, category, address, website, phone, email,
  source, status, rating, reviews, place_id, lat, lng,
  brand, campaign_id, last_email_sent, engagement_score, reply_received,
  created_at, notes, emails_sent, emails_opened, emails_clicked,
  last_opened_at, last_clicked_at, job_title, linkedin, employees, industry, keywords
)
SELECT 
  l.id,
  l.org_id,
  l.user_id,
  c.id AS company_id,
  SPLIT_PART(COALESCE(l.contact_name, ''), ' ', 1) AS first_name,
  SPLIT_PART(COALESCE(l.contact_name, ''), ' ', 2) AS last_name,
  l.job_title AS title,
  COALESCE(l.status, 'Cold') AS stage,
  l.business_name,
  l.category,
  l.address,
  l.website,
  l.phone,
  l.email,
  l.source,
  l.status,
  l.rating,
  l.reviews,
  l.place_id,
  l.lat,
  l.lng,
  COALESCE(l.brand, 'sourcr'),
  l.campaign_id,
  l.last_email_sent,
  l.engagement_score,
  l.reply_received,
  l.created_at,
  l.notes,
  COALESCE(l.emails_sent, 0),
  COALESCE(l.emails_opened, 0),
  COALESCE(l.emails_clicked, 0),
  l.last_opened_at,
  l.last_clicked_at,
  l.job_title,
  l.linkedin,
  l.employees,
  l.industry,
  l.keywords
FROM public.leads l
LEFT JOIN public.companies c ON (
  (l.website IS NOT NULL AND c.website = l.website) OR
  (l.website IS NULL AND c.name = l.business_name)
);

-- Step 3: Migrate primary emails to lead_emails table
INSERT INTO public.lead_emails (lead_id, email, type, status)
SELECT 
  id,
  email,
  'primary',
  'User Managed'
FROM public.leads_new
WHERE email IS NOT NULL AND email != ''
ON CONFLICT DO NOTHING;

-- Step 4: Migrate primary phones to lead_phones table
INSERT INTO public.lead_phones (lead_id, phone, type)
SELECT 
  id,
  phone,
  'work_direct'
FROM public.leads_new
WHERE phone IS NOT NULL AND phone != ''
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 7. SWAP TABLES (rename old leads table and replace with new one)
-- ============================================================================
-- WARNING: This will temporarily break the app until code is updated!
-- Uncomment these lines only when ready to switch:

-- ALTER TABLE public.leads RENAME TO leads_backup_pre_normalization;
-- ALTER TABLE public.leads_new RENAME TO leads;

-- ============================================================================
-- 8. CREATE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_companies_website ON public.companies(website);
CREATE INDEX IF NOT EXISTS idx_companies_apollo_account_id ON public.companies(apollo_account_id);
CREATE INDEX IF NOT EXISTS idx_companies_org_id ON public.companies(org_id);
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON public.companies(user_id);

CREATE INDEX IF NOT EXISTS idx_leads_new_company_id ON public.leads_new(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_new_stage ON public.leads_new(stage);
CREATE INDEX IF NOT EXISTS idx_leads_new_apollo_contact_id ON public.leads_new(apollo_contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_new_org_id ON public.leads_new(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_new_user_id ON public.leads_new(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_new_first_name ON public.leads_new(first_name);
CREATE INDEX IF NOT EXISTS idx_leads_new_last_name ON public.leads_new(last_name);

CREATE INDEX IF NOT EXISTS idx_lead_emails_email ON public.lead_emails(email);
CREATE INDEX IF NOT EXISTS idx_lead_emails_lead_id ON public.lead_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_emails_type ON public.lead_emails(type);

CREATE INDEX IF NOT EXISTS idx_lead_phones_lead_id ON public.lead_phones(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_phones_phone ON public.lead_phones(phone);

CREATE INDEX IF NOT EXISTS idx_lead_custom_fields_lead_id ON public.lead_custom_fields(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_custom_fields_key ON public.lead_custom_fields(key);

-- ============================================================================
-- 9. ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_custom_fields ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 10. CREATE RLS POLICIES
-- ============================================================================
-- Companies policies
DROP POLICY IF EXISTS "Allow all on companies" ON public.companies;
CREATE POLICY "Allow all on companies" ON public.companies FOR ALL USING (true) WITH CHECK (true);

-- Leads policies
DROP POLICY IF EXISTS "Allow all on leads_new" ON public.leads_new;
CREATE POLICY "Allow all on leads_new" ON public.leads_new FOR ALL USING (true) WITH CHECK (true);

-- Lead emails policies
DROP POLICY IF EXISTS "Allow all on lead_emails" ON public.lead_emails;
CREATE POLICY "Allow all on lead_emails" ON public.lead_emails FOR ALL USING (true) WITH CHECK (true);

-- Lead phones policies
DROP POLICY IF EXISTS "Allow all on lead_phones" ON public.lead_phones;
CREATE POLICY "Allow all on lead_phones" ON public.lead_phones FOR ALL USING (true) WITH CHECK (true);

-- Lead custom fields policies
DROP POLICY IF EXISTS "Allow all on lead_custom_fields" ON public.lead_custom_fields;
CREATE POLICY "Allow all on lead_custom_fields" ON public.lead_custom_fields FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 11. UPDATE FOREIGN KEYS (update existing tables to reference new leads table)
-- ============================================================================
-- WARNING: Only run this after swapping tables (step 7)
-- These commands will fail until the table is renamed to 'leads'

-- ALTER TABLE public.campaign_leads DROP CONSTRAINT IF EXISTS campaign_leads_lead_id_fkey;
-- ALTER TABLE public.campaign_leads ADD CONSTRAINT campaign_leads_lead_id_fkey 
--   FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

-- ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS emails_lead_id_fkey;
-- ALTER TABLE public.emails ADD CONSTRAINT emails_lead_id_fkey 
--   FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

-- ALTER TABLE public.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_lead_id_fkey;
-- ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_lead_id_fkey 
--   FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

-- ALTER TABLE public.group_leads DROP CONSTRAINT IF EXISTS group_leads_lead_id_fkey;
-- ALTER TABLE public.group_leads ADD CONSTRAINT group_leads_lead_id_fkey 
--   FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Next steps:
-- 1. Run this entire script in Supabase SQL Editor
-- 2. Verify data migration was successful
-- 3. Uncomment step 7 to swap tables (AFTER backing up!)
-- 4. Update application code to use new schema
-- ============================================================================
