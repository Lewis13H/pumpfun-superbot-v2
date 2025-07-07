-- Add metadata columns to tokens_unified
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS image_uri TEXT,
ADD COLUMN IF NOT EXISTS uri TEXT,
ADD COLUMN IF NOT EXISTS metadata_source VARCHAR(20),
ADD COLUMN IF NOT EXISTS metadata_updated_at TIMESTAMP;

-- Add index for finding tokens needing enrichment
CREATE INDEX IF NOT EXISTS idx_tokens_need_metadata 
ON tokens_unified(created_at DESC) 
WHERE symbol IS NULL OR name IS NULL;

-- Add index for metadata source tracking
CREATE INDEX IF NOT EXISTS idx_tokens_metadata_source 
ON tokens_unified(metadata_source, metadata_updated_at);