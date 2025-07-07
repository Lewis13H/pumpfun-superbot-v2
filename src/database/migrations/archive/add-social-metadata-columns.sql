-- Migration: Add social links and extended metadata columns
-- Purpose: Support Shyft DAS integration for comprehensive token metadata

-- Add social link columns
ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS twitter VARCHAR(255),
ADD COLUMN IF NOT EXISTS telegram VARCHAR(255),
ADD COLUMN IF NOT EXISTS discord VARCHAR(255),
ADD COLUMN IF NOT EXISTS website VARCHAR(255);

-- Add authority columns
ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS update_authority VARCHAR(64),
ADD COLUMN IF NOT EXISTS freeze_authority VARCHAR(64),
ADD COLUMN IF NOT EXISTS mint_authority VARCHAR(64);

-- Add extended metadata columns
ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS is_mutable BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS is_compressed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS metadata_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS holder_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS top_holder_percentage DECIMAL(5,2);

-- Add creator tracking
ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS creators JSONB;

-- Add collection info
ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS collection_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS collection_family VARCHAR(255);

-- Create indexes for social links (for filtering)
CREATE INDEX IF NOT EXISTS idx_tokens_twitter ON tokens_unified(twitter) WHERE twitter IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_telegram ON tokens_unified(telegram) WHERE telegram IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_holder_count ON tokens_unified(holder_count) WHERE holder_count > 0;
CREATE INDEX IF NOT EXISTS idx_tokens_metadata_score ON tokens_unified(metadata_score);

-- Create a table to track metadata enrichment progress
CREATE TABLE IF NOT EXISTS metadata_enrichment_runs (
    id SERIAL PRIMARY KEY,
    run_at TIMESTAMP DEFAULT NOW(),
    tokens_processed INTEGER DEFAULT 0,
    tokens_enriched INTEGER DEFAULT 0,
    holder_counts_added INTEGER DEFAULT 0,
    social_links_added INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    status VARCHAR(20) DEFAULT 'running',
    error_message TEXT
);

-- Add metadata quality view
CREATE OR REPLACE VIEW metadata_quality_stats AS
SELECT 
    COUNT(*) as total_tokens,
    COUNT(CASE WHEN name IS NOT NULL THEN 1 END) as tokens_with_name,
    COUNT(CASE WHEN symbol IS NOT NULL THEN 1 END) as tokens_with_symbol,
    COUNT(CASE WHEN description IS NOT NULL THEN 1 END) as tokens_with_description,
    COUNT(CASE WHEN image_uri IS NOT NULL THEN 1 END) as tokens_with_image,
    COUNT(CASE WHEN holder_count > 0 THEN 1 END) as tokens_with_holder_count,
    COUNT(CASE WHEN twitter IS NOT NULL OR telegram IS NOT NULL OR discord IS NOT NULL THEN 1 END) as tokens_with_social_links,
    COUNT(CASE WHEN metadata_score >= 80 THEN 1 END) as high_quality_metadata,
    COUNT(CASE WHEN metadata_score >= 50 AND metadata_score < 80 THEN 1 END) as medium_quality_metadata,
    COUNT(CASE WHEN metadata_score < 50 THEN 1 END) as low_quality_metadata,
    AVG(metadata_score) as avg_metadata_score
FROM tokens_unified
WHERE threshold_crossed_at IS NOT NULL;

-- Create a function to calculate metadata score
CREATE OR REPLACE FUNCTION calculate_metadata_score(
    p_name VARCHAR,
    p_symbol VARCHAR,
    p_description TEXT,
    p_image_uri VARCHAR,
    p_twitter VARCHAR,
    p_telegram VARCHAR,
    p_discord VARCHAR,
    p_holder_count INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_score INTEGER := 0;
BEGIN
    -- Name: 20 points
    IF p_name IS NOT NULL AND p_name != '' THEN
        v_score := v_score + 20;
    END IF;
    
    -- Symbol: 20 points
    IF p_symbol IS NOT NULL AND p_symbol != '' THEN
        v_score := v_score + 20;
    END IF;
    
    -- Description: 10 points
    IF p_description IS NOT NULL AND p_description != '' THEN
        v_score := v_score + 10;
    END IF;
    
    -- Image: 15 points
    IF p_image_uri IS NOT NULL AND p_image_uri != '' THEN
        v_score := v_score + 15;
    END IF;
    
    -- Social links: 15 points
    IF p_twitter IS NOT NULL OR p_telegram IS NOT NULL OR p_discord IS NOT NULL THEN
        v_score := v_score + 15;
    END IF;
    
    -- Holder count: 20 points
    IF p_holder_count IS NOT NULL AND p_holder_count > 0 THEN
        v_score := v_score + 20;
    END IF;
    
    RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- Update existing tokens with metadata scores
UPDATE tokens_unified
SET metadata_score = calculate_metadata_score(
    name, 
    symbol, 
    description, 
    image_uri, 
    twitter, 
    telegram, 
    discord, 
    holder_count
)
WHERE metadata_score IS NULL OR metadata_score = 0;

-- Add comment to document the purpose
COMMENT ON TABLE metadata_enrichment_runs IS 'Tracks Shyft DAS API enrichment runs for monitoring and optimization';
COMMENT ON COLUMN tokens_unified.metadata_score IS 'Quality score 0-100 based on metadata completeness';
COMMENT ON COLUMN tokens_unified.holder_count IS 'Current number of token holders from Shyft DAS API';
COMMENT ON COLUMN tokens_unified.twitter IS 'Twitter/X handle or URL extracted from metadata';
COMMENT ON COLUMN tokens_unified.telegram IS 'Telegram group/channel URL from metadata';
COMMENT ON COLUMN tokens_unified.discord IS 'Discord server invite URL from metadata';