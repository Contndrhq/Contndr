-- Add missing columns to leads table to support CSV imports
-- This adds common fields that most CSV files contain

-- Add contact person fields
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS contact_name TEXT,
ADD COLUMN IF NOT EXISTS job_title TEXT,
ADD COLUMN IF NOT EXISTS linkedin TEXT;

-- Add company detail fields
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS employees TEXT,
ADD COLUMN IF NOT EXISTS keywords TEXT;

-- Add notes field for additional info
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add bounced flag for email validation
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS bounced BOOLEAN DEFAULT FALSE;

-- Update the updated_at timestamp function if needed
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at if not exists
DROP TRIGGER IF EXISTS update_leads_updated_at ON public.leads;
CREATE TRIGGER update_leads_updated_at
    BEFORE UPDATE ON public.leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
