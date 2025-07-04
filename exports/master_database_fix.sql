-- MASTER DATABASE FIX - Combines ALL fixes from all export files
-- This is the ONLY file you need to run to fix all database issues
-- Last Updated: Includes freeze_authority and mint_authority columns

-- =====================================================
-- STEP 1: Grant permissions (from all files)
-- =====================================================
GRANT ALL ON SCHEMA public TO pump_user;
GRANT CREATE ON SCHEMA public TO pump_user;
GRANT USAGE ON SCHEMA public TO pump_user;

-- =====================================================
-- STEP 2: Add ALL missing columns to tokens_unified
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
ADD COLUMN IF NOT EXISTS mint_authority VARCHAR(64),
ADD COLUMN IF NOT EXISTS is_mutable BOOLEAN;

-- =====================================================
-- STEP 3: Add ALL missing columns to trades_unified
-- =====================================================
ALTER TABLE trades_unified
ADD COLUMN IF NOT EXISTS virtual_sol_reserves BIGINT,
ADD COLUMN IF NOT EXISTS virtual_token_reserves BIGINT,
ADD COLUMN IF NOT EXISTS block_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS volume_usd DECIMAL(30, 15),
ADD COLUMN IF NOT EXISTS bonding_curve_key VARCHAR(100),
ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE;

-- =====================================================
-- STEP 4: Create ALL missing tables
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
-- STEP 5: Create ALL indexes
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_sol_prices_created_at ON sol_prices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_mint ON price_snapshots(mint_address);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_created ON price_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_composite ON price_snapshots(mint_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amm_pool_states_mint ON amm_pool_states(mint_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amm_pool_states_pool ON amm_pool_states(pool_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amm_pool_states_slot ON amm_pool_states(slot DESC);

-- =====================================================
-- STEP 6: Insert initial data
-- =====================================================
INSERT INTO sol_prices (price, source) 
SELECT 250.00, 'initial'
WHERE NOT EXISTS (SELECT 1 FROM sol_prices);

-- =====================================================
-- STEP 7: Fix foreign key constraint issues
-- =====================================================

-- Drop the problematic foreign key constraint
ALTER TABLE trades_unified DROP CONSTRAINT IF EXISTS trades_unified_mint_address_fkey;

-- Create function to automatically create tokens when trades reference new ones
CREATE OR REPLACE FUNCTION create_token_if_not_exists()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if token exists
    IF NOT EXISTS (SELECT 1 FROM tokens_unified WHERE mint_address = NEW.mint_address) THEN
        -- Create a placeholder token entry
        INSERT INTO tokens_unified (
            mint_address,
            symbol,
            name,
            first_seen_at,
            first_seen_slot,
            first_program,
            first_price_sol,
            first_price_usd,
            first_market_cap_usd,
            current_program,
            created_at,
            updated_at
        ) VALUES (
            NEW.mint_address,
            'UNKNOWN',
            'Unknown Token',
            COALESCE(NEW.block_time, NEW.created_at, CURRENT_TIMESTAMP),
            NEW.slot,
            NEW.program,
            NEW.price_sol,
            NEW.price_usd,
            NEW.market_cap_usd,
            NEW.program,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (mint_address) DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on trades_unified
DROP TRIGGER IF EXISTS ensure_token_exists ON trades_unified;
CREATE TRIGGER ensure_token_exists
    BEFORE INSERT ON trades_unified
    FOR EACH ROW
    EXECUTE FUNCTION create_token_if_not_exists();

-- Create any missing tokens for existing trades (backfill)
INSERT INTO tokens_unified (
    mint_address,
    symbol,
    name,
    first_seen_at,
    first_seen_slot,
    first_program,
    first_price_sol,
    first_price_usd,
    first_market_cap_usd,
    current_program,
    created_at,
    updated_at
)
SELECT DISTINCT
    t.mint_address,
    'UNKNOWN' as symbol,
    'Unknown Token' as name,
    MIN(COALESCE(t.block_time, t.created_at, CURRENT_TIMESTAMP)) as first_seen_at,
    MIN(t.slot) as first_seen_slot,
    t.program as first_program,
    MIN(t.price_sol) as first_price_sol,
    MIN(t.price_usd) as first_price_usd,
    MIN(t.market_cap_usd) as first_market_cap_usd,
    t.program as current_program,
    CURRENT_TIMESTAMP as created_at,
    CURRENT_TIMESTAMP as updated_at
FROM trades_unified t
WHERE NOT EXISTS (
    SELECT 1 FROM tokens_unified tok 
    WHERE tok.mint_address = t.mint_address
)
GROUP BY t.mint_address, t.program;

-- =====================================================
-- STEP 8: Grant final permissions on everything
-- =====================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO pump_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pump_user;
GRANT EXECUTE ON FUNCTION create_token_if_not_exists() TO pump_user;

-- =====================================================
-- STEP 9: Final verification and summary
-- =====================================================
DO $$
DECLARE
    v_total_tokens INTEGER;
    v_total_trades INTEGER;
    v_orphaned_trades INTEGER;
    v_sol_prices INTEGER;
BEGIN
    -- Get counts
    SELECT COUNT(*) INTO v_total_tokens FROM tokens_unified;
    SELECT COUNT(*) INTO v_total_trades FROM trades_unified;
    SELECT COUNT(*) INTO v_sol_prices FROM sol_prices;
    SELECT COUNT(*) INTO v_orphaned_trades 
    FROM trades_unified t 
    WHERE NOT EXISTS (
        SELECT 1 FROM tokens_unified tok 
        WHERE tok.mint_address = t.mint_address
    );

    -- Display results
    RAISE NOTICE '========================================';
    RAISE NOTICE 'DATABASE FIX COMPLETED SUCCESSFULLY!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total tokens: %', v_total_tokens;
    RAISE NOTICE 'Total trades: %', v_total_trades;
    RAISE NOTICE 'Orphaned trades: %', v_orphaned_trades;
    RAISE NOTICE 'SOL price entries: %', v_sol_prices;
    RAISE NOTICE '';
    RAISE NOTICE 'Added columns to tokens_unified:';
    RAISE NOTICE '  - freeze_authority, mint_authority';
    RAISE NOTICE '  - discord, update_authority';
    RAISE NOTICE '  - last_trade_at, block_time';
    RAISE NOTICE '  - And 16+ other columns';
    RAISE NOTICE '';
    RAISE NOTICE 'Added columns to trades_unified:';
    RAISE NOTICE '  - volume_usd, bonding_curve_key';
    RAISE NOTICE '  - timestamp, block_time';
    RAISE NOTICE '  - virtual reserves columns';
    RAISE NOTICE '';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  - sol_prices';
    RAISE NOTICE '  - price_snapshots';
    RAISE NOTICE '  - amm_pool_states';
    RAISE NOTICE '  - stale_detection_runs';
    RAISE NOTICE '========================================';
END $$;

-- Final query to show results
SELECT 
    'Database fixes applied successfully!' as status,
    (SELECT COUNT(*) FROM tokens_unified) as total_tokens,
    (SELECT COUNT(*) FROM trades_unified) as total_trades,
    (SELECT COUNT(*) FROM sol_prices) as sol_price_entries,
    (SELECT COUNT(*) FROM trades_unified t WHERE NOT EXISTS (
        SELECT 1 FROM tokens_unified tok WHERE tok.mint_address = t.mint_address
    )) as orphaned_trades;