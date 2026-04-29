-- Migration: Add scheduled_time column to campaigns table
-- This enables scheduling campaigns for future sending

-- Add scheduled_time column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'campaigns' 
        AND column_name = 'scheduled_time'
    ) THEN
        ALTER TABLE campaigns 
        ADD COLUMN scheduled_time TIMESTAMP WITH TIME ZONE;
        
        -- Add index for efficient cron queries
        CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled 
        ON campaigns(scheduled_time) 
        WHERE status = 'scheduled' AND scheduled_time IS NOT NULL;
        
        RAISE NOTICE 'Added scheduled_time column to campaigns table';
    END IF;
END $$;
