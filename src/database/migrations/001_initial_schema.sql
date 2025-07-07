-- Initial Database Schema for Pump.fun Superbot
-- This is the base schema that creates all core tables and indexes
-- All subsequent migrations build upon this foundation
-- Created: 2025-01-07

-- =====================================================
-- EXTENSIONS
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Master token registry
CREATE TABLE IF NOT EXISTS tokens_unified (
    mint_address VARCHAR(64) PRIMARY KEY,
    symbol VARCHAR(32),
    name VARCHAR(128),
    uri VARCHAR(512),
    image_uri VARCHAR(512),
    description TEXT,
    
    -- Program tracking
    first_program VARCHAR(50) NOT NULL,
    current_program VARCHAR(50),
    
    -- Price and market data
    current_price_sol DECIMAL(30, 12),
    current_price_usd DECIMAL(30, 12),
    current_market_cap_usd DECIMAL(30, 12),
    fdv_usd DECIMAL(30, 12),
    
    -- First seen data
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    first_seen_slot BIGINT,
    first_price_sol DECIMAL(30, 15),
    first_price_usd DECIMAL(30, 15),
    first_market_cap_usd DECIMAL(30, 15),
    
    -- Bonding curve data
    bonding_curve_key VARCHAR(100),
    latest_bonding_curve_progress DECIMAL(5, 2),
    bonding_curve_complete BOOLEAN DEFAULT FALSE,
    latest_virtual_sol_reserves BIGINT,
    latest_virtual_token_reserves BIGINT,
    
    -- Graduation tracking
    graduated_to_amm BOOLEAN DEFAULT FALSE,
    graduation_timestamp TIMESTAMP WITH TIME ZONE,
    graduation_slot BIGINT,
    graduation_signature VARCHAR(128),
    graduation_price_sol DECIMAL(30, 15),
    graduation_price_usd DECIMAL(30, 15),
    graduation_market_cap_usd DECIMAL(30, 15),
    
    -- Token metadata
    decimals INTEGER DEFAULT 6,
    total_supply BIGINT,
    is_mutable BOOLEAN,
    update_authority VARCHAR(64),
    freeze_authority VARCHAR(64),
    mint_authority VARCHAR(64),
    creator_address VARCHAR(64),
    
    -- Social metadata
    twitter VARCHAR(255),
    telegram VARCHAR(255),
    discord VARCHAR(255),
    website VARCHAR(255),
    metadata_score INTEGER DEFAULT 0,
    
    -- Status flags
    is_active BOOLEAN DEFAULT TRUE,
    should_remove BOOLEAN DEFAULT FALSE,
    is_enriched BOOLEAN DEFAULT FALSE,
    enrichment_attempts INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    last_trade_at TIMESTAMP WITH TIME ZONE,
    last_price_update TIMESTAMP WITH TIME ZONE,
    metadata_last_updated TIMESTAMP WITH TIME ZONE,
    stale_marked_at TIMESTAMP WITH TIME ZONE,
    
    -- Additional tracking
    creation_slot BIGINT,
    block_time TIMESTAMP WITH TIME ZONE,
    price_source VARCHAR(50),
    volume_24h_usd DECIMAL(30, 15),
    
    -- DEX integration
    dexscreener_last_checked TIMESTAMP WITH TIME ZONE
);

-- Unified trades table
CREATE TABLE IF NOT EXISTS trades_unified (
    id BIGSERIAL PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    signature VARCHAR(128) UNIQUE NOT NULL,
    program VARCHAR(50) NOT NULL,
    trade_type VARCHAR(10) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    
    -- Trade amounts
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    
    -- Prices
    price_sol DECIMAL(30, 15),
    price_usd DECIMAL(30, 15),
    market_cap_usd DECIMAL(30, 15),
    volume_usd DECIMAL(30, 15),
    
    -- State data
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    bonding_curve_key VARCHAR(100),
    bonding_curve_progress DECIMAL(5, 2),
    
    -- Blockchain data
    slot BIGINT NOT NULL,
    block_time TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    timestamp TIMESTAMP WITH TIME ZONE
);

-- AMM pool states
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

-- Liquidity events
CREATE TABLE IF NOT EXISTS liquidity_events (
    id BIGSERIAL PRIMARY KEY,
    signature VARCHAR(128) UNIQUE NOT NULL,
    pool_address VARCHAR(64) NOT NULL,
    mint_address VARCHAR(64) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    lp_amount BIGINT,
    token_0_amount BIGINT,
    token_1_amount BIGINT,
    reserves_0 BIGINT,
    reserves_1 BIGINT,
    user_address VARCHAR(64),
    slot BIGINT NOT NULL,
    block_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    pool_token_0 VARCHAR(64),
    pool_token_1 VARCHAR(64),
    token_0_price_usd DECIMAL(30, 15),
    token_1_price_usd DECIMAL(30, 15),
    total_value_usd DECIMAL(30, 15)
);

-- AMM fee events
CREATE TABLE IF NOT EXISTS amm_fee_events (
    id BIGSERIAL PRIMARY KEY,
    signature VARCHAR(128) UNIQUE NOT NULL,
    pool_address VARCHAR(64) NOT NULL,
    fee_amount_0 BIGINT NOT NULL,
    fee_amount_1 BIGINT NOT NULL,
    reserves_0 BIGINT NOT NULL,
    reserves_1 BIGINT NOT NULL,
    slot BIGINT NOT NULL,
    block_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    mint_address VARCHAR(64),
    sol_fees BIGINT,
    token_fees BIGINT,
    fee_percentage DECIMAL(5, 4),
    pool_tvl_usd DECIMAL(30, 15)
);

-- LP positions
CREATE TABLE IF NOT EXISTS lp_positions (
    id BIGSERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    lp_token_balance BIGINT NOT NULL,
    share_percentage DECIMAL(10, 6),
    token_0_amount BIGINT,
    token_1_amount BIGINT,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_address, user_address)
);

-- AMM pool metrics hourly
CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (
    id BIGSERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    hour TIMESTAMP WITH TIME ZONE NOT NULL,
    volume_usd DECIMAL(30, 15),
    fee_revenue_usd DECIMAL(30, 15),
    tvl_usd DECIMAL(30, 15),
    swap_count INTEGER DEFAULT 0,
    unique_traders INTEGER DEFAULT 0,
    price_volatility DECIMAL(10, 6),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_address, hour)
);

-- Bonding curve mappings
CREATE TABLE IF NOT EXISTS bonding_curve_mappings (
    bonding_curve_key VARCHAR(100) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- SOL prices
CREATE TABLE IF NOT EXISTS sol_prices (
    id SERIAL PRIMARY KEY,
    price DECIMAL(20, 10) NOT NULL,
    source VARCHAR(50) DEFAULT 'jupiter',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Price snapshots
CREATE TABLE IF NOT EXISTS price_snapshots (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(64) REFERENCES tokens_unified(mint_address),
    price_sol DECIMAL(30, 15),
    price_usd DECIMAL(30, 15),
    market_cap_usd DECIMAL(30, 15),
    bonding_curve_progress DECIMAL(5, 2),
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Stale detection runs
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

-- Recovery progress tracking
CREATE TABLE IF NOT EXISTS recovery_progress (
    id SERIAL PRIMARY KEY,
    recovery_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    items_processed INTEGER DEFAULT 0,
    items_failed INTEGER DEFAULT 0,
    last_error TEXT,
    metadata JSONB
);

-- =====================================================
-- INDEXES
-- =====================================================

-- tokens_unified indexes
CREATE INDEX idx_tokens_mint_address ON tokens_unified(mint_address);
CREATE INDEX idx_tokens_graduated ON tokens_unified(graduated_to_amm) WHERE graduated_to_amm = true;
CREATE INDEX idx_tokens_active ON tokens_unified(is_active) WHERE is_active = true;
CREATE INDEX idx_tokens_market_cap ON tokens_unified(current_market_cap_usd DESC) WHERE current_market_cap_usd IS NOT NULL;
CREATE INDEX idx_tokens_created_at ON tokens_unified(created_at DESC);
CREATE INDEX idx_tokens_last_trade ON tokens_unified(last_trade_at DESC) WHERE last_trade_at IS NOT NULL;
CREATE INDEX idx_tokens_program ON tokens_unified(current_program);
CREATE INDEX idx_tokens_bc_complete ON tokens_unified(bonding_curve_complete) WHERE bonding_curve_complete = true AND graduated_to_amm = false;
CREATE INDEX idx_tokens_should_remove ON tokens_unified(should_remove) WHERE should_remove = true;
CREATE INDEX idx_tokens_enrichment ON tokens_unified(is_enriched, enrichment_attempts);

-- trades_unified indexes
CREATE INDEX idx_trades_mint ON trades_unified(mint_address);
CREATE INDEX idx_trades_signature ON trades_unified(signature);
CREATE INDEX idx_trades_slot ON trades_unified(slot DESC);
CREATE INDEX idx_trades_created ON trades_unified(created_at DESC);
CREATE INDEX idx_trades_program ON trades_unified(program);
CREATE INDEX idx_trades_type ON trades_unified(trade_type);
CREATE INDEX idx_trades_user ON trades_unified(user_address);
CREATE INDEX idx_trades_composite ON trades_unified(mint_address, created_at DESC);

-- amm_pool_states indexes
CREATE INDEX idx_amm_pool_states_mint ON amm_pool_states(mint_address, created_at DESC);
CREATE INDEX idx_amm_pool_states_pool ON amm_pool_states(pool_address, created_at DESC);
CREATE INDEX idx_amm_pool_states_slot ON amm_pool_states(slot DESC);

-- liquidity_events indexes
CREATE INDEX idx_liquidity_events_pool ON liquidity_events(pool_address);
CREATE INDEX idx_liquidity_events_mint ON liquidity_events(mint_address);
CREATE INDEX idx_liquidity_events_type ON liquidity_events(event_type);
CREATE INDEX idx_liquidity_events_slot ON liquidity_events(slot DESC);
CREATE INDEX idx_liquidity_events_user ON liquidity_events(user_address);

-- amm_fee_events indexes
CREATE INDEX idx_fee_events_pool ON amm_fee_events(pool_address);
CREATE INDEX idx_fee_events_slot ON amm_fee_events(slot DESC);
CREATE INDEX idx_fee_events_mint ON amm_fee_events(mint_address);

-- lp_positions indexes
CREATE INDEX idx_lp_positions_pool ON lp_positions(pool_address);
CREATE INDEX idx_lp_positions_user ON lp_positions(user_address);

-- amm_pool_metrics_hourly indexes
CREATE INDEX idx_pool_metrics_pool_hour ON amm_pool_metrics_hourly(pool_address, hour DESC);
CREATE INDEX idx_pool_metrics_volume ON amm_pool_metrics_hourly(volume_usd DESC) WHERE volume_usd IS NOT NULL;

-- Other indexes
CREATE INDEX idx_sol_prices_created_at ON sol_prices(created_at DESC);
CREATE INDEX idx_price_snapshots_mint ON price_snapshots(mint_address);
CREATE INDEX idx_price_snapshots_created ON price_snapshots(created_at DESC);
CREATE INDEX idx_price_snapshots_composite ON price_snapshots(mint_address, created_at DESC);
CREATE INDEX idx_bc_mappings_mint ON bonding_curve_mappings(mint_address);

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add update triggers
CREATE TRIGGER update_tokens_updated_at BEFORE UPDATE ON tokens_unified
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create token if not exists (for trade inserts)
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
CREATE TRIGGER ensure_token_exists
    BEFORE INSERT ON trades_unified
    FOR EACH ROW
    EXECUTE FUNCTION create_token_if_not_exists();

-- =====================================================
-- PERMISSIONS
-- =====================================================
GRANT ALL ON SCHEMA public TO pump_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO pump_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pump_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pump_user;

-- =====================================================
-- INITIAL DATA
-- =====================================================
INSERT INTO sol_prices (price, source) 
SELECT 250.00, 'initial'
WHERE NOT EXISTS (SELECT 1 FROM sol_prices);

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE tokens_unified IS 'Master registry of all tokens tracked by the system';
COMMENT ON TABLE trades_unified IS 'All trades from both bonding curve and AMM programs';
COMMENT ON TABLE amm_pool_states IS 'Snapshots of AMM pool states over time';
COMMENT ON TABLE liquidity_events IS 'Liquidity add/remove events from AMM pools';
COMMENT ON TABLE amm_fee_events IS 'Fee collection events from AMM pools';
COMMENT ON TABLE lp_positions IS 'Current LP token positions for users';
COMMENT ON TABLE amm_pool_metrics_hourly IS 'Hourly aggregated metrics for AMM pools';
COMMENT ON TABLE bonding_curve_mappings IS 'Maps bonding curve keys to token mint addresses';
COMMENT ON TABLE sol_prices IS 'Historical SOL/USD prices for calculations';
COMMENT ON TABLE price_snapshots IS 'Historical price snapshots for tokens';
COMMENT ON TABLE stale_detection_runs IS 'Audit log of stale token detection runs';
COMMENT ON TABLE recovery_progress IS 'Tracks progress of various recovery operations';

COMMENT ON COLUMN tokens_unified.latest_bonding_curve_progress IS 'Progress percentage (0-100) based on SOL in bonding curve';
COMMENT ON COLUMN tokens_unified.bonding_curve_complete IS 'Complete flag from bonding curve account - definitive graduation status';