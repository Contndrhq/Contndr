-- Add score column to leads table for AI lead scoring
-- This column stores the lead quality score (0-100)
-- Run this in Supabase SQL Editor if the column doesn't exist

ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INTEGER;

-- Add index for faster sorting by score
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);

-- Optional: Update existing leads with a default score
-- UPDATE leads SET score = 50 WHERE score IS NULL;

-- Verify the column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leads' AND column_name = 'score';
