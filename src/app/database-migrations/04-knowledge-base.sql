-- Knowledge Base Table Migration
-- This table stores brand-specific and global knowledge base entries
-- that are used to personalize email generation with AI

CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand TEXT NOT NULL CHECK (brand IN ('roadr', 'sourcr', 'global')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_knowledge_base_brand ON knowledge_base(brand);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(brand, category);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_active ON knowledge_base(is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_search ON knowledge_base USING gin(to_tsvector('english', title || ' ' || content));

-- Add RLS (Row Level Security) policies
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read knowledge base
CREATE POLICY "Allow authenticated users to read knowledge base"
  ON knowledge_base
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow all authenticated users to manage knowledge base
-- (In production, you might want to restrict this to admins)
CREATE POLICY "Allow authenticated users to insert knowledge base"
  ON knowledge_base
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update knowledge base"
  ON knowledge_base
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete knowledge base"
  ON knowledge_base
  FOR DELETE
  TO authenticated
  USING (true);

-- Insert default Sourcr payment knowledge base entry
INSERT INTO knowledge_base (brand, category, title, content, is_active)
VALUES (
  'sourcr',
  'Payment Options',
  'Flexible Payment Plans',
  'At Sourcr, we offer flexible payment options to make it easy for clients to move forward with their project.

All of our products including websites, mobile apps, and digital platforms can be paid using split payment plans that best suit the client''s needs.

For websites, clients may choose monthly payments spread over an agreed period until the full project amount has been paid.

For mobile apps and larger projects, clients can choose a two-payment structure. This consists of 50% of the total project cost paid at project kick-off, with the remaining 50% paid upon delivery.

The goal is to remove friction, allow projects to start faster, and align payments with progress while keeping expectations clear for both sides.

If needed, custom payment arrangements can be discussed and approved on a case-by-case basis.',
  true
) ON CONFLICT DO NOTHING;

-- Add campaign_knowledge column to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_knowledge TEXT DEFAULT '';

COMMENT ON TABLE knowledge_base IS 'Stores brand-specific and global knowledge base entries for AI email personalization';
COMMENT ON COLUMN knowledge_base.brand IS 'Brand identifier: roadr, sourcr, or global (applies to all brands)';
COMMENT ON COLUMN knowledge_base.category IS 'Category for organizing knowledge base entries (e.g., Payment Options, Services, Pricing)';
COMMENT ON COLUMN knowledge_base.title IS 'Title of the knowledge base entry';
COMMENT ON COLUMN knowledge_base.content IS 'Full content of the knowledge base entry';
COMMENT ON COLUMN knowledge_base.is_active IS 'Whether this entry is active and should be used in email generation';
COMMENT ON COLUMN campaigns.campaign_knowledge IS 'Campaign-specific knowledge base context that overrides default brand information';
