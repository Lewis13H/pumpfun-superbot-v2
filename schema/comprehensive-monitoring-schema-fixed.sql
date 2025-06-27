-- Comprehensive Dual-Monitor Database Schema
-- Designed for high-throughput monitoring of pump.fun bonding curves and pump.swap AMM pools
-- Optimized for 100,000+ tokens/week with $8,888 market cap threshold

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Token Programs Enum
CREATE TYPE token_program AS ENUM ('bonding_curve', 'amm_pool');

-- Trade Type Enum
CREATE TYPE trade_type AS ENUM ('buy', 'sell');

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Master token registry (only tokens that hit $8,888)
CREATE TABLE IF NOT EXISTS tokens_comprehensive (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mint_address VARCHAR(64) UNIQUE NOT NULL,
    symbol VARCHAR(32),
    name VARCHAR(128),
    uri VARCHAR(512),
    
    -- First detection info
    first_program token_program NOT NULL,
    first_seen_slot BIGINT NOT NULL,
    first_seen_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_market_cap_usd DECIMAL(20, 4) NOT NULL,
    
    -- Threshold crossing info
    threshold_crossed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    threshold_price_sol DECIMAL(20, 12) NOT NULL,
    threshold_market_cap_usd DECIMAL(20, 4) NOT NULL,
    
    -- Migration tracking
    graduated_to_amm BOOLEAN DEFAULT FALSE,
    graduation_timestamp TIMESTAMPTZ,
    graduation_slot BIGINT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- BONDING CURVE DATA
-- =====================================================

-- Bonding curve states (snapshot at each update)
CREATE TABLE IF NOT EXISTS bonding_curve_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID NOT NULL REFERENCES tokens_comprehensive(id) ON DELETE CASCADE,
    
    -- State data
    virtual_sol_reserves BIGINT NOT NULL,
    virtual_token_reserves BIGINT NOT NULL,
    real_sol_reserves BIGINT NOT NULL,
    real_token_reserves BIGINT NOT NULL,
    
    -- Calculated fields
    price_sol DECIMAL(20, 12) NOT NULL,
    price_usd DECIMAL(20, 4) NOT NULL,
    market_cap_usd DECIMAL(20, 4) NOT NULL,
    progress_percent DECIMAL(5, 2) NOT NULL,
    
    -- Blockchain data
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    
    -- Only keep if market cap >= threshold
    CONSTRAINT chk_market_cap CHECK (market_cap_usd >= 8888)
);

-- Bonding curve trades
CREATE TABLE IF NOT EXISTS bonding_curve_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID NOT NULL REFERENCES tokens_comprehensive(id) ON DELETE CASCADE,
    
    -- Trade data
    signature VARCHAR(128) UNIQUE NOT NULL,
    trade_type trade_type NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    
    -- Amounts
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    
    -- Price at time of trade
    price_sol DECIMAL(20, 12) NOT NULL,
    price_usd DECIMAL(20, 4) NOT NULL,
    market_cap_usd DECIMAL(20, 4) NOT NULL,
    
    -- State after trade
    virtual_sol_reserves BIGINT NOT NULL,
    virtual_token_reserves BIGINT NOT NULL,
    
    -- Blockchain data
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL
);

-- =====================================================
-- AMM POOL DATA  
-- =====================================================

-- AMM pool configurations
CREATE TABLE IF NOT EXISTS amm_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID NOT NULL REFERENCES tokens_comprehensive(id) ON DELETE CASCADE,
    
    -- Pool identifiers
    pool_address VARCHAR(64) UNIQUE NOT NULL,
    base_mint VARCHAR(64) NOT NULL,
    quote_mint VARCHAR(64) NOT NULL,
    
    -- Token accounts (where reserves are actually stored)
    base_token_account VARCHAR(64),
    quote_token_account VARCHAR(64),
    
    -- Pool metadata
    lp_mint VARCHAR(64),
    lp_supply BIGINT,
    
    -- Creation info
    created_slot BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AMM pool states (requires separate token account queries)
CREATE TABLE IF NOT EXISTS amm_pool_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id UUID NOT NULL REFERENCES amm_pools(id) ON DELETE CASCADE,
    
    -- Reserve data (from token accounts)
    base_reserves BIGINT,
    quote_reserves BIGINT,
    
    -- Calculated fields
    price_sol DECIMAL(20, 12),
    price_usd DECIMAL(20, 4),
    market_cap_usd DECIMAL(20, 4),
    liquidity_usd DECIMAL(20, 4),
    
    -- Blockchain data
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    
    -- Only keep if market cap >= threshold
    CONSTRAINT chk_amm_market_cap CHECK (market_cap_usd >= 8888)
);

-- AMM swaps
CREATE TABLE IF NOT EXISTS amm_swaps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id UUID NOT NULL REFERENCES amm_pools(id) ON DELETE CASCADE,
    
    -- Swap data
    signature VARCHAR(128) UNIQUE NOT NULL,
    trade_type trade_type NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    
    -- Amounts (from inner instructions)
    amount_in BIGINT NOT NULL,
    amount_out BIGINT NOT NULL,
    
    -- Price at time of swap
    price_sol DECIMAL(20, 12),
    price_usd DECIMAL(20, 4),
    market_cap_usd DECIMAL(20, 4),
    
    -- Blockchain data
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL
);

-- =====================================================
-- AGGREGATED DATA (for fast queries)
-- =====================================================

-- Hourly statistics per token
CREATE TABLE IF NOT EXISTS token_stats_hourly (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID NOT NULL REFERENCES tokens_comprehensive(id) ON DELETE CASCADE,
    hour TIMESTAMPTZ NOT NULL,
    
    -- Price data
    open_price_usd DECIMAL(20, 4),
    high_price_usd DECIMAL(20, 4),
    low_price_usd DECIMAL(20, 4),
    close_price_usd DECIMAL(20, 4),
    
    -- Volume data
    volume_sol DECIMAL(20, 9),
    volume_usd DECIMAL(20, 4),
    buy_count INTEGER DEFAULT 0,
    sell_count INTEGER DEFAULT 0,
    unique_traders INTEGER DEFAULT 0,
    
    -- Program breakdown
    bonding_curve_volume_usd DECIMAL(20, 4) DEFAULT 0,
    amm_volume_usd DECIMAL(20, 4) DEFAULT 0,
    
    -- Unique constraint
    CONSTRAINT uk_token_hour UNIQUE (token_id, hour)
);

-- =====================================================
-- MONITORING & PERFORMANCE
-- =====================================================

-- Processing queue for high-throughput
CREATE TABLE IF NOT EXISTS processing_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(32) NOT NULL, -- 'bc_trade', 'bc_state', 'amm_swap', 'amm_state'
    program token_program NOT NULL,
    signature VARCHAR(128),
    account_pubkey VARCHAR(64),
    slot BIGINT NOT NULL,
    data JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Monitoring metrics
CREATE TABLE IF NOT EXISTS monitoring_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(64) NOT NULL,
    metric_value DECIMAL(20, 4) NOT NULL,
    tags JSONB DEFAULT '{}',
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES (created separately)
-- =====================================================

-- Tokens indexes
CREATE INDEX IF NOT EXISTS idx_tokens_first_seen ON tokens_comprehensive(first_seen_timestamp);
CREATE INDEX IF NOT EXISTS idx_tokens_graduated ON tokens_comprehensive(graduated_to_amm) WHERE graduated_to_amm = TRUE;
CREATE INDEX IF NOT EXISTS idx_tokens_threshold_crossed ON tokens_comprehensive(threshold_crossed_at);

-- Bonding curve states indexes
CREATE INDEX IF NOT EXISTS idx_bc_states_token_time ON bonding_curve_states(token_id, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_bc_states_slot ON bonding_curve_states(slot);
CREATE INDEX IF NOT EXISTS idx_bc_states_market_cap ON bonding_curve_states(market_cap_usd DESC);

-- Bonding curve trades indexes
CREATE INDEX IF NOT EXISTS idx_bc_trades_token_time ON bonding_curve_trades(token_id, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_bc_trades_user ON bonding_curve_trades(user_address);
CREATE INDEX IF NOT EXISTS idx_bc_trades_type ON bonding_curve_trades(trade_type);
CREATE INDEX IF NOT EXISTS idx_bc_trades_market_cap ON bonding_curve_trades(market_cap_usd DESC);

-- AMM pools indexes
CREATE INDEX IF NOT EXISTS idx_amm_pools_token ON amm_pools(token_id);

-- AMM pool states indexes
CREATE INDEX IF NOT EXISTS idx_amm_states_pool_time ON amm_pool_states(pool_id, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_amm_states_market_cap ON amm_pool_states(market_cap_usd DESC);

-- AMM swaps indexes
CREATE INDEX IF NOT EXISTS idx_amm_swaps_pool_time ON amm_swaps(pool_id, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_amm_swaps_user ON amm_swaps(user_address);
CREATE INDEX IF NOT EXISTS idx_amm_swaps_type ON amm_swaps(trade_type);

-- Token stats indexes
CREATE INDEX IF NOT EXISTS idx_stats_hour ON token_stats_hourly(hour DESC);
CREATE INDEX IF NOT EXISTS idx_stats_volume ON token_stats_hourly(volume_usd DESC);

-- Processing queue indexes
CREATE INDEX IF NOT EXISTS idx_queue_unprocessed ON processing_queue(processed, created_at) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_queue_slot ON processing_queue(slot);

-- Monitoring metrics indexes
CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON monitoring_metrics(metric_name, recorded_at DESC);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to calculate market cap
CREATE OR REPLACE FUNCTION calculate_market_cap(
    price_sol DECIMAL,
    sol_price_usd DECIMAL
) RETURNS DECIMAL AS $$
BEGIN
    -- Assumes 1B token supply
    RETURN price_sol * sol_price_usd * 1000000000;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if token should be saved
CREATE OR REPLACE FUNCTION should_save_token(
    market_cap_usd DECIMAL
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN market_cap_usd >= 8888;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tokens_timestamp
    BEFORE UPDATE ON tokens_comprehensive
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- MAINTENANCE
-- =====================================================

-- Cleanup old queue items
CREATE OR REPLACE FUNCTION cleanup_old_queue_items()
RETURNS void AS $$
BEGIN
    DELETE FROM processing_queue 
    WHERE processed = TRUE 
    AND processed_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Archive old metrics
CREATE OR REPLACE FUNCTION archive_old_metrics()
RETURNS void AS $$
BEGIN
    DELETE FROM monitoring_metrics 
    WHERE recorded_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;