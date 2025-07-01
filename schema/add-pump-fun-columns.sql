-- Migration: Add pump.fun specific columns to tokens_unified table
-- This adds columns for creator address, token supply, and bonding curve key
-- Part of Enhanced Phase 1: Extend Existing Services

-- Add creator column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'tokens_unified' 
                   AND column_name = 'creator') THEN
        ALTER TABLE tokens_unified 
        ADD COLUMN creator VARCHAR(64);
        
        CREATE INDEX idx_tokens_creator ON tokens_unified(creator) 
        WHERE creator IS NOT NULL;
    END IF;
END $$;

-- Add total_supply column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'tokens_unified' 
                   AND column_name = 'total_supply') THEN
        ALTER TABLE tokens_unified 
        ADD COLUMN total_supply BIGINT;
    END IF;
END $$;

-- Add bonding_curve_key column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'tokens_unified' 
                   AND column_name = 'bonding_curve_key') THEN
        ALTER TABLE tokens_unified 
        ADD COLUMN bonding_curve_key VARCHAR(64);
        
        CREATE INDEX idx_tokens_bonding_curve ON tokens_unified(bonding_curve_key) 
        WHERE bonding_curve_key IS NOT NULL;
    END IF;
END $$;

-- Add latest price columns if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'tokens_unified' 
                   AND column_name = 'latest_price_sol') THEN
        ALTER TABLE tokens_unified 
        ADD COLUMN latest_price_sol DECIMAL(20,12),
        ADD COLUMN latest_price_usd DECIMAL(20,4),
        ADD COLUMN latest_market_cap_usd DECIMAL(20,4);
    END IF;
END $$;

-- Add volume and liquidity columns if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'tokens_unified' 
                   AND column_name = 'volume_24h_usd') THEN
        ALTER TABLE tokens_unified 
        ADD COLUMN volume_24h_usd DECIMAL(20,4),
        ADD COLUMN liquidity_usd DECIMAL(20,4),
        ADD COLUMN holder_count INTEGER;
    END IF;
END $$;

-- Create creator_analysis table for Phase 2
CREATE TABLE IF NOT EXISTS creator_analysis (
    creator_address VARCHAR(64) PRIMARY KEY,
    total_tokens_created INTEGER DEFAULT 0,
    successful_graduations INTEGER DEFAULT 0,
    average_lifespan_hours DECIMAL(10,2),
    creation_frequency_per_day DECIMAL(10,2),
    is_serial_creator BOOLEAN DEFAULT FALSE,
    recent_activity_count INTEGER DEFAULT 0,
    risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100),
    recommendation VARCHAR(20) CHECK (recommendation IN ('OK', 'CAUTION', 'AVOID')),
    analyzed_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_creator_analysis_updated 
ON creator_analysis(analyzed_at DESC);

-- Add comment to document the purpose
COMMENT ON TABLE creator_analysis IS 'Stores risk analysis for pump.fun token creators';
COMMENT ON COLUMN tokens_unified.creator IS 'Creator address from pump.fun bonding curve';
COMMENT ON COLUMN tokens_unified.total_supply IS 'Total token supply from bonding curve';
COMMENT ON COLUMN tokens_unified.bonding_curve_key IS 'Bonding curve program address';