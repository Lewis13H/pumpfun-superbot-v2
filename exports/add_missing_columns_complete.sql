-- Complete migration script to add ALL missing columns to existing database
-- Run this if you already have tables but are missing columns
-- Updated: Includes freeze_authority and mint_authority

-- =====================================================
-- Add missing columns to tokens_unified
-- =====================================================
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS first_price_sol DECIMAL(30, 15),
ADD COLUMN IF NOT EXISTS first_price_usd DECIMAL(30, 15),
ADD COLUMN IF NOT EXISTS first_market_cap_usd DECIMAL(30, 15),
ADD COLUMN IF NOT EXISTS price_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS first_seen_slot BIGINT,
ADD COLUMN IF NOT EXISTS bonding_curve_key VARCHAR(100),
ADD COLUMN IF NOT EXISTS last_price_update TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS latest_virtual_sol_reserves BIGINT,
ADD COLUMN IF NOT EXISTS latest_virtual_token_reserves BIGINT,
ADD COLUMN IF NOT EXISTS should_remove BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS block_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS creation_slot BIGINT,
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS enrichment_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_enriched BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stale_marked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_trade_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS discord VARCHAR(255),
ADD COLUMN IF NOT EXISTS update_authority VARCHAR(64),
ADD COLUMN IF NOT EXISTS freeze_authority VARCHAR(64),
ADD COLUMN IF NOT EXISTS mint_authority VARCHAR(64);

-- =====================================================
-- Add missing columns to trades_unified
-- =====================================================
ALTER TABLE trades_unified
ADD COLUMN IF NOT EXISTS virtual_sol_reserves BIGINT,
ADD COLUMN IF NOT EXISTS virtual_token_reserves BIGINT,
ADD COLUMN IF NOT EXISTS block_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS volume_usd DECIMAL(30, 15),
ADD COLUMN IF NOT EXISTS bonding_curve_key VARCHAR(100),
ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE;

-- =====================================================
-- Create missing tables if they don't exist
-- =====================================================

-- Create sol_prices table
CREATE TABLE IF NOT EXISTS sol_prices (
    id SERIAL PRIMARY KEY,
    price DECIMAL(20, 10) NOT NULL,
    source VARCHAR(50) DEFAULT 'jupiter',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create price_snapshots table
CREATE TABLE IF NOT EXISTS price_snapshots (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    price_sol DECIMAL(30, 15),
    price_usd DECIMAL(30, 15),
    market_cap_usd DECIMAL(30, 15),
    bonding_curve_progress DECIMAL(5, 2),
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create amm_pool_states table
CREATE TABLE IF NOT EXISTS amm_pool_states (
    id BIGSERIAL PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    pool_address VARCHAR(64) NOT NULL,
    virtual_sol_reserves BIGINT NOT NULL,
    virtual_token_reserves BIGINT NOT NULL,
    real_sol_reserves BIGINT,
    real_token_reserves BIGINT,
    pool_open BOOLEAN DEFAULT TRUE,
    slot BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create stale_detection_runs table
CREATE TABLE IF NOT EXISTS stale_detection_runs (
    id SERIAL PRIMARY KEY,
    run_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    tokens_checked INTEGER DEFAULT 0,
    tokens_marked_stale INTEGER DEFAULT 0,
    tokens_marked_removal INTEGER DEFAULT 0,
    tokens_recovered INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    status VARCHAR(20) DEFAULT 'running',
    error_message TEXT
);

-- =====================================================
-- Create indexes if they don't exist
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_sol_prices_created_at ON sol_prices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_mint ON price_snapshots(mint_address);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_created ON price_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_composite ON price_snapshots(mint_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amm_pool_states_mint ON amm_pool_states(mint_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amm_pool_states_pool ON amm_pool_states(pool_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amm_pool_states_slot ON amm_pool_states(slot DESC);

-- =====================================================
-- Insert initial data if needed
-- =====================================================
INSERT INTO sol_prices (price, source) 
SELECT 250.00, 'initial'
WHERE NOT EXISTS (SELECT 1 FROM sol_prices);

-- =====================================================
-- Grant permissions
-- =====================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO pump_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pump_user;

-- =====================================================
-- Show what was added
-- =====================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration completed!';
    RAISE NOTICE 'Added columns to tokens_unified including: freeze_authority, mint_authority, discord, update_authority, and more';
    RAISE NOTICE 'Added columns to trades_unified including: volume_usd, bonding_curve_key, timestamp';
    RAISE NOTICE 'Created tables: sol_prices, price_snapshots, amm_pool_states, stale_detection_runs';
END $$;