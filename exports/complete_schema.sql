-- PumpFun Superbot v2 Database Schema
-- Complete schema for Windows setup

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables if they exist
DROP TABLE IF EXISTS lp_positions CASCADE;
DROP TABLE IF EXISTS amm_fee_events CASCADE;
DROP TABLE IF EXISTS liquidity_events CASCADE;
DROP TABLE IF EXISTS amm_pool_metrics_hourly CASCADE;
DROP TABLE IF EXISTS trades_unified CASCADE;
DROP TABLE IF EXISTS bonding_curve_mappings CASCADE;
DROP TABLE IF EXISTS tokens_unified CASCADE;

-- Tokens table
CREATE TABLE tokens_unified (
    mint_address VARCHAR(50) PRIMARY KEY,
    symbol VARCHAR(50),
    name VARCHAR(255),
    uri VARCHAR(500),
    image_uri VARCHAR(500),
    description TEXT,
    creator VARCHAR(50),
    creation_slot BIGINT,
    telegram VARCHAR(100),
    twitter VARCHAR(100),
    website VARCHAR(255),
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    first_program VARCHAR(20),
    current_program VARCHAR(20),
    graduated_to_amm BOOLEAN DEFAULT FALSE,
    graduation_at TIMESTAMP WITH TIME ZONE,
    threshold_crossed_at TIMESTAMP WITH TIME ZONE,
    metadata_updated_at TIMESTAMP WITH TIME ZONE,
    enrichment_attempts INTEGER DEFAULT 0,
    metadata_source VARCHAR(50),
    token_created_at TIMESTAMP WITH TIME ZONE,
    is_enriched BOOLEAN DEFAULT FALSE,
    is_stale BOOLEAN DEFAULT FALSE,
    stale_marked_at TIMESTAMP WITH TIME ZONE,
    latest_price_sol DECIMAL(30, 15),
    latest_price_usd DECIMAL(30, 15),
    latest_market_cap_usd DECIMAL(30, 15),
    latest_bonding_curve_progress DECIMAL(5, 2),
    volume_24h_usd DECIMAL(30, 15),
    holder_count INTEGER,
    top_holder_percentage DECIMAL(5, 2),
    total_trades INTEGER,
    unique_traders_24h INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trades table
CREATE TABLE trades_unified (
    signature VARCHAR(150) PRIMARY KEY,
    slot BIGINT,
    timestamp TIMESTAMP WITH TIME ZONE,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    program VARCHAR(20),
    trade_type VARCHAR(10),
    user_address VARCHAR(50),
    sol_amount DECIMAL(30, 0),
    token_amount DECIMAL(30, 0),
    price_sol DECIMAL(30, 15),
    price_usd DECIMAL(30, 15),
    market_cap_usd DECIMAL(30, 15),
    bonding_curve_progress DECIMAL(5, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_program CHECK (program IN ('bonding_curve', 'amm_pool'))
);

-- AMM Pool Metrics
CREATE TABLE amm_pool_metrics_hourly (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    hour TIMESTAMP WITH TIME ZONE,
    volume_sol DECIMAL(30, 15),
    volume_usd DECIMAL(30, 15),
    liquidity_sol DECIMAL(30, 15),
    liquidity_usd DECIMAL(30, 15),
    trade_count INTEGER,
    unique_traders INTEGER,
    price_change_percent DECIMAL(10, 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mint_address, hour)
);

-- Liquidity Events
CREATE TABLE liquidity_events (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(150),
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    event_type VARCHAR(20),
    lp_mint_amount DECIMAL(30, 0),
    base_amount DECIMAL(30, 0),
    quote_amount DECIMAL(30, 0),
    provider_address VARCHAR(50),
    timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_event_type CHECK (event_type IN ('add', 'remove'))
);

-- Fee Events
CREATE TABLE amm_fee_events (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(150),
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    base_fee_amount DECIMAL(30, 0),
    quote_fee_amount DECIMAL(30, 0),
    owner_address VARCHAR(50),
    timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- LP Positions
CREATE TABLE lp_positions (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    provider_address VARCHAR(50),
    lp_token_balance DECIMAL(30, 0),
    share_percentage DECIMAL(10, 6),
    estimated_base_amount DECIMAL(30, 0),
    estimated_quote_amount DECIMAL(30, 0),
    last_update TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_address, provider_address)
);

-- Bonding Curve Mappings
CREATE TABLE bonding_curve_mappings (
    bonding_curve_address VARCHAR(50) PRIMARY KEY,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_tokens_graduated ON tokens_unified(graduated_to_amm);
CREATE INDEX idx_tokens_creator ON tokens_unified(creator);
CREATE INDEX idx_tokens_program ON tokens_unified(current_program);
CREATE INDEX idx_tokens_created_at ON tokens_unified(token_created_at);
CREATE INDEX idx_tokens_market_cap ON tokens_unified(latest_market_cap_usd);
CREATE INDEX idx_tokens_progress ON tokens_unified(latest_bonding_curve_progress);
CREATE INDEX idx_tokens_first_seen ON tokens_unified(first_seen_at);
CREATE INDEX idx_tokens_stale ON tokens_unified(is_stale);

CREATE INDEX idx_trades_mint ON trades_unified(mint_address);
CREATE INDEX idx_trades_timestamp ON trades_unified(timestamp);
CREATE INDEX idx_trades_user ON trades_unified(user_address);
CREATE INDEX idx_trades_slot ON trades_unified(slot);
CREATE INDEX idx_trades_program ON trades_unified(program);

CREATE INDEX idx_liquidity_mint ON liquidity_events(mint_address);
CREATE INDEX idx_liquidity_pool ON liquidity_events(pool_address);
CREATE INDEX idx_liquidity_timestamp ON liquidity_events(timestamp);

CREATE INDEX idx_fee_mint ON amm_fee_events(mint_address);
CREATE INDEX idx_fee_pool ON amm_fee_events(pool_address);
CREATE INDEX idx_fee_timestamp ON amm_fee_events(timestamp);

CREATE INDEX idx_lp_pool ON lp_positions(pool_address);
CREATE INDEX idx_lp_provider ON lp_positions(provider_address);

CREATE INDEX idx_bc_mapping_mint ON bonding_curve_mappings(mint_address);

-- Create update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tokens_updated_at BEFORE UPDATE
    ON tokens_unified FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO pump_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pump_user;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO pump_user;