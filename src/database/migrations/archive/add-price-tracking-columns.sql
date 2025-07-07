-- Migration: Add Price Tracking and Stale Token Detection Columns
-- Purpose: Implement token enrichment plan Session 1 - Database Schema Updates
-- Created: 2025-01-02

-- Add critical missing columns to tokens_unified
DO $$
BEGIN
    -- Add last_trade_at if missing (critical for stale detection)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'last_trade_at'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN last_trade_at TIMESTAMP;
        COMMENT ON COLUMN tokens_unified.last_trade_at IS 'Timestamp of the last trade for this token';
    END IF;
    
    -- Add is_stale flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'is_stale'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN is_stale BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN tokens_unified.is_stale IS 'Flag indicating if token price data is stale';
    END IF;
    
    -- Add should_remove flag for auto-removal
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'should_remove'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN should_remove BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN tokens_unified.should_remove IS 'Flag indicating token should be removed from active monitoring';
    END IF;
    
    -- Add liquidity_usd for better token analysis
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'liquidity_usd'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN liquidity_usd DECIMAL(20,4);
        COMMENT ON COLUMN tokens_unified.liquidity_usd IS 'Current liquidity in USD';
    END IF;

    -- Add bonding_curve_key if missing (mentioned in CLAUDE.md but not in schema)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'bonding_curve_key'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN bonding_curve_key VARCHAR(64);
        COMMENT ON COLUMN tokens_unified.bonding_curve_key IS 'Associated bonding curve public key';
    END IF;

    -- Add total_supply if missing (mentioned in CLAUDE.md but not in schema)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'total_supply'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN total_supply BIGINT;
        COMMENT ON COLUMN tokens_unified.total_supply IS 'Total token supply';
    END IF;
END $$;

-- Create indexes for efficient stale token detection
CREATE INDEX IF NOT EXISTS idx_tokens_stale 
ON tokens_unified(last_trade_at, latest_market_cap_usd DESC) 
WHERE latest_market_cap_usd > 5000 AND is_stale = FALSE;

CREATE INDEX IF NOT EXISTS idx_tokens_removal 
ON tokens_unified(should_remove, latest_market_cap_usd) 
WHERE should_remove = TRUE;

-- Index for finding tokens needing updates
CREATE INDEX IF NOT EXISTS idx_tokens_last_trade 
ON tokens_unified(last_trade_at) 
WHERE last_trade_at IS NOT NULL;

-- Index for bonding curve lookups
CREATE INDEX IF NOT EXISTS idx_tokens_bonding_curve 
ON tokens_unified(bonding_curve_key) 
WHERE bonding_curve_key IS NOT NULL;

-- Function to update last_trade_at and latest prices on new trades
CREATE OR REPLACE FUNCTION update_token_latest_prices()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the token's latest price information
    UPDATE tokens_unified 
    SET 
        last_trade_at = NEW.block_time,
        latest_price_sol = NEW.price_sol,
        latest_price_usd = NEW.price_usd,
        latest_market_cap_usd = NEW.market_cap_usd,
        latest_update_slot = NEW.slot,
        updated_at = NOW(),
        is_stale = FALSE  -- Reset stale flag on new trade
    WHERE mint_address = NEW.mint_address;
    
    -- Update volume statistics (24h will need separate job)
    UPDATE tokens_unified
    SET 
        total_trades = total_trades + 1,
        total_buys = total_buys + CASE WHEN NEW.trade_type = 'buy' THEN 1 ELSE 0 END,
        total_sells = total_sells + CASE WHEN NEW.trade_type = 'sell' THEN 1 ELSE 0 END
    WHERE mint_address = NEW.mint_address;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update token prices on new trades
DROP TRIGGER IF EXISTS trigger_update_token_latest_prices ON trades_unified;
CREATE TRIGGER trigger_update_token_latest_prices
AFTER INSERT ON trades_unified
FOR EACH ROW
EXECUTE FUNCTION update_token_latest_prices();

-- Initialize last_trade_at for existing tokens based on their most recent trade
UPDATE tokens_unified t
SET last_trade_at = (
    SELECT MAX(block_time) 
    FROM trades_unified tr 
    WHERE tr.mint_address = t.mint_address
)
WHERE last_trade_at IS NULL
  AND EXISTS (
    SELECT 1 FROM trades_unified tr WHERE tr.mint_address = t.mint_address
  );

-- Mark tokens as potentially stale if no trades in last 2 hours (initial marking)
UPDATE tokens_unified
SET is_stale = TRUE
WHERE last_trade_at < NOW() - INTERVAL '2 hours'
  AND latest_market_cap_usd > 5000
  AND is_stale = FALSE;

-- Create recovery progress table for tracking historical data recovery
CREATE TABLE IF NOT EXISTS recovery_progress (
    id SERIAL PRIMARY KEY,
    period_start TIMESTAMP,
    period_end TIMESTAMP,
    tokens_processed INTEGER DEFAULT 0,
    tokens_total INTEGER,
    trades_recovered INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add index for recovery progress queries
CREATE INDEX idx_recovery_progress_status ON recovery_progress(status, created_at DESC);

-- Create table for tracking stale token detection runs
CREATE TABLE IF NOT EXISTS stale_detection_runs (
    id SERIAL PRIMARY KEY,
    run_at TIMESTAMP DEFAULT NOW(),
    tokens_checked INTEGER DEFAULT 0,
    tokens_marked_stale INTEGER DEFAULT 0,
    tokens_marked_removal INTEGER DEFAULT 0,
    tokens_recovered INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    error_message TEXT
);

-- Add comments for documentation
COMMENT ON TABLE recovery_progress IS 'Tracks historical data recovery operations';
COMMENT ON TABLE stale_detection_runs IS 'Audit log for stale token detection runs';

-- Display summary of changes
DO $$
DECLARE
    v_token_count INTEGER;
    v_stale_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_token_count FROM tokens_unified;
    SELECT COUNT(*) INTO v_stale_count FROM tokens_unified WHERE is_stale = TRUE;
    
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE 'Total tokens: %', v_token_count;
    RAISE NOTICE 'Tokens marked as stale: %', v_stale_count;
    RAISE NOTICE '';
    RAISE NOTICE 'New columns added:';
    RAISE NOTICE '  - last_trade_at (for tracking last activity)';
    RAISE NOTICE '  - is_stale (for marking outdated prices)';
    RAISE NOTICE '  - should_remove (for auto-removal)';
    RAISE NOTICE '  - liquidity_usd (for better analysis)';
    RAISE NOTICE '  - bonding_curve_key (for BC tracking)';
    RAISE NOTICE '  - total_supply (for supply info)';
    RAISE NOTICE '';
    RAISE NOTICE 'New features:';
    RAISE NOTICE '  - Automatic price updates on new trades';
    RAISE NOTICE '  - Stale token detection indexes';
    RAISE NOTICE '  - Recovery progress tracking';
    RAISE NOTICE '  - Stale detection audit logging';
END $$;