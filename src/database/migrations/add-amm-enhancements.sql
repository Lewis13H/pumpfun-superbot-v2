-- AMM Enhancement Tables for Sessions 1-5
-- This migration adds tables for AMM-specific features

-- Session 1: Liquidity Events
CREATE TABLE IF NOT EXISTS liquidity_events (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('add', 'remove')),
    user_address VARCHAR(64) NOT NULL,
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    lp_tokens_minted BIGINT,
    lp_tokens_burned BIGINT,
    pool_sol_balance BIGINT NOT NULL,
    pool_token_balance BIGINT NOT NULL,
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL UNIQUE,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session 2: Fee Events
CREATE TABLE IF NOT EXISTS amm_fee_events (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    trade_signature VARCHAR(88) NOT NULL,
    fee_sol_amount BIGINT NOT NULL,
    fee_token_amount BIGINT NOT NULL,
    fee_percentage DECIMAL(5,4) NOT NULL,
    cumulative_fees_sol BIGINT,
    cumulative_fees_token BIGINT,
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session 3: LP Positions
CREATE TABLE IF NOT EXISTS lp_positions (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    lp_token_balance BIGINT NOT NULL,
    pool_share_percentage DECIMAL(5,2),
    estimated_sol_value BIGINT,
    estimated_token_value BIGINT,
    last_updated_slot BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_address, user_address)
);

-- Session 4: Pool Analytics
CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    hour_timestamp TIMESTAMPTZ NOT NULL,
    volume_sol BIGINT NOT NULL DEFAULT 0,
    volume_usd DECIMAL(20,4),
    trade_count INTEGER NOT NULL DEFAULT 0,
    unique_traders INTEGER NOT NULL DEFAULT 0,
    liquidity_sol BIGINT NOT NULL,
    liquidity_usd DECIMAL(20,4),
    fees_collected_sol BIGINT DEFAULT 0,
    fees_collected_usd DECIMAL(20,4),
    price_high DECIMAL(20,12),
    price_low DECIMAL(20,12),
    price_open DECIMAL(20,12),
    price_close DECIMAL(20,12),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_address, hour_timestamp)
);

-- Session 5: Trade Simulations
CREATE TABLE IF NOT EXISTS trade_simulations (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    trade_type VARCHAR(10) NOT NULL CHECK (trade_type IN ('buy', 'sell')),
    input_amount BIGINT NOT NULL,
    output_amount BIGINT NOT NULL,
    price_impact_percentage DECIMAL(10,6) NOT NULL,
    effective_price DECIMAL(20,12) NOT NULL,
    slippage_percentage DECIMAL(10,6),
    simulation_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- AMM Pool State (already exists but ensure schema is correct)
CREATE TABLE IF NOT EXISTS amm_pool_state (
    pool_address VARCHAR(64) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    virtual_sol_reserves BIGINT NOT NULL,
    virtual_token_reserves BIGINT NOT NULL,
    virtual_lp_supply BIGINT NOT NULL DEFAULT 0,
    swap_fee_numerator BIGINT NOT NULL DEFAULT 25,
    swap_fee_denominator BIGINT NOT NULL DEFAULT 10000,
    total_volume_sol BIGINT DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    last_price_sol DECIMAL(20,12),
    last_price_usd DECIMAL(20,12),
    last_update_slot BIGINT NOT NULL,
    last_update_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_liquidity_events_pool_time ON liquidity_events(pool_address, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_events_user ON liquidity_events(user_address);
CREATE INDEX IF NOT EXISTS idx_liquidity_events_type ON liquidity_events(event_type);

CREATE INDEX IF NOT EXISTS idx_fee_events_pool ON amm_fee_events(pool_address, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_fee_events_signature ON amm_fee_events(trade_signature);

CREATE INDEX IF NOT EXISTS idx_lp_positions_user ON lp_positions(user_address);
CREATE INDEX IF NOT EXISTS idx_lp_positions_pool ON lp_positions(pool_address);

CREATE INDEX IF NOT EXISTS idx_pool_metrics_time ON amm_pool_metrics_hourly(hour_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pool_metrics_pool_time ON amm_pool_metrics_hourly(pool_address, hour_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_simulations_pool ON trade_simulations(pool_address, simulation_timestamp DESC);

-- Update trigger for pool state
CREATE OR REPLACE FUNCTION update_amm_pool_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_amm_pool_state_timestamp
BEFORE UPDATE ON amm_pool_state
FOR EACH ROW
EXECUTE FUNCTION update_amm_pool_state_timestamp();

-- Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;