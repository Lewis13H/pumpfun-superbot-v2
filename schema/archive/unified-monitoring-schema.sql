-- Unified Token Monitoring Schema
-- Uses mint_address as primary key for compatibility across all monitors
-- Supports both pump.fun bonding curves and pump.swap AMM pools

-- Enable UUID extension (for backwards compatibility if needed)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main tokens table using mint address as primary key
CREATE TABLE IF NOT EXISTS tokens_unified (
  -- Primary identification
  mint_address VARCHAR(64) PRIMARY KEY,
  
  -- Token metadata
  symbol VARCHAR(32),
  name VARCHAR(128),
  uri VARCHAR(512),
  image_uri VARCHAR(512),
  description TEXT,
  creator VARCHAR(64),
  
  -- Discovery information
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_seen_slot BIGINT NOT NULL,
  first_program VARCHAR(20) NOT NULL CHECK (first_program IN ('bonding_curve', 'amm_pool')),
  first_price_sol DECIMAL(20, 12) NOT NULL,
  first_price_usd DECIMAL(20, 4) NOT NULL,
  first_market_cap_usd DECIMAL(20, 4) NOT NULL,
  
  -- Threshold crossing ($8,888)
  threshold_crossed_at TIMESTAMPTZ,
  threshold_price_sol DECIMAL(20, 12),
  threshold_price_usd DECIMAL(20, 4),
  threshold_market_cap_usd DECIMAL(20, 4),
  threshold_slot BIGINT,
  
  -- Current state
  current_program VARCHAR(20) CHECK (current_program IN ('bonding_curve', 'amm_pool')),
  graduated_to_amm BOOLEAN DEFAULT FALSE,
  graduation_at TIMESTAMPTZ,
  graduation_slot BIGINT,
  
  -- Statistics
  total_trades INTEGER DEFAULT 0,
  total_buys INTEGER DEFAULT 0,
  total_sells INTEGER DEFAULT 0,
  volume_24h_sol DECIMAL(20, 9) DEFAULT 0,
  volume_24h_usd DECIMAL(20, 4) DEFAULT 0,
  unique_traders_24h INTEGER DEFAULT 0,
  
  -- Latest state
  latest_price_sol DECIMAL(20, 12),
  latest_price_usd DECIMAL(20, 4),
  latest_market_cap_usd DECIMAL(20, 4),
  latest_virtual_sol_reserves BIGINT,
  latest_virtual_token_reserves BIGINT,
  latest_bonding_curve_progress DECIMAL(5, 2),
  latest_update_slot BIGINT,
  
  -- Enrichment data
  holder_count INTEGER DEFAULT 0,
  top_holder_percentage DECIMAL(5, 2) DEFAULT 0,
  metadata_enriched BOOLEAN DEFAULT FALSE,
  metadata_enriched_at TIMESTAMPTZ,
  helius_metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create all necessary indexes for performance
CREATE INDEX idx_tokens_unified_threshold ON tokens_unified(threshold_crossed_at) 
  WHERE threshold_crossed_at IS NOT NULL;
CREATE INDEX idx_tokens_unified_graduated ON tokens_unified(graduated_to_amm) 
  WHERE graduated_to_amm = TRUE;
CREATE INDEX idx_tokens_unified_volume ON tokens_unified(volume_24h_usd DESC);
CREATE INDEX idx_tokens_unified_latest_mcap ON tokens_unified(latest_market_cap_usd DESC)
  WHERE latest_market_cap_usd IS NOT NULL;
CREATE INDEX idx_tokens_unified_created ON tokens_unified(created_at DESC);
CREATE INDEX idx_tokens_unified_program ON tokens_unified(current_program);
CREATE INDEX idx_tokens_unified_enrichment ON tokens_unified(metadata_enriched, created_at);

-- Trades table with high-performance design
CREATE TABLE IF NOT EXISTS trades_unified (
  -- Use bigserial for fast inserts
  id BIGSERIAL PRIMARY KEY,
  
  -- Token reference
  mint_address VARCHAR(64) NOT NULL,
  
  -- Trade details
  signature VARCHAR(128) NOT NULL,
  program VARCHAR(20) NOT NULL CHECK (program IN ('bonding_curve', 'amm_pool')),
  trade_type VARCHAR(10) NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  user_address VARCHAR(64) NOT NULL,
  
  -- Amounts
  sol_amount BIGINT NOT NULL,
  token_amount BIGINT NOT NULL,
  price_sol DECIMAL(20, 12) NOT NULL,
  price_usd DECIMAL(20, 4) NOT NULL,
  market_cap_usd DECIMAL(20, 4) NOT NULL,
  
  -- Bonding curve specific
  virtual_sol_reserves BIGINT,
  virtual_token_reserves BIGINT,
  bonding_curve_progress DECIMAL(5, 2),
  
  -- Blockchain data
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  
  -- Performance: No foreign key constraint for faster inserts
  -- Foreign key validation happens at application level
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimized indexes for trades
CREATE UNIQUE INDEX idx_trades_unified_signature ON trades_unified(signature);
CREATE INDEX idx_trades_unified_mint_time ON trades_unified(mint_address, block_time DESC);
CREATE INDEX idx_trades_unified_user ON trades_unified(user_address);
CREATE INDEX idx_trades_unified_slot ON trades_unified(slot DESC);

-- Price snapshots for historical data
CREATE TABLE IF NOT EXISTS price_snapshots_unified (
  id BIGSERIAL PRIMARY KEY,
  mint_address VARCHAR(64) NOT NULL,
  price_sol DECIMAL(20, 12) NOT NULL,
  price_usd DECIMAL(20, 4) NOT NULL,
  market_cap_usd DECIMAL(20, 4) NOT NULL,
  virtual_sol_reserves BIGINT,
  virtual_token_reserves BIGINT,
  bonding_curve_progress DECIMAL(5, 2),
  program VARCHAR(20) NOT NULL,
  slot BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient time-series queries
CREATE INDEX idx_price_snapshots_unified_lookup ON price_snapshots_unified(mint_address, created_at DESC);

-- Account states for monitoring graduations
CREATE TABLE IF NOT EXISTS account_states_unified (
  id BIGSERIAL PRIMARY KEY,
  mint_address VARCHAR(64) NOT NULL,
  program VARCHAR(20) NOT NULL,
  account_type VARCHAR(20) NOT NULL,
  virtual_sol_reserves BIGINT,
  virtual_token_reserves BIGINT,
  real_sol_reserves BIGINT,
  real_token_reserves BIGINT,
  bonding_curve_complete BOOLEAN,
  slot BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_states_unified_lookup ON account_states_unified(mint_address, created_at DESC);

-- Token holders (for enrichment)
CREATE TABLE IF NOT EXISTS token_holders_unified (
  mint_address VARCHAR(64) NOT NULL,
  wallet_address VARCHAR(64) NOT NULL,
  balance NUMERIC(20, 0) NOT NULL,
  percentage DECIMAL(5, 2) NOT NULL,
  rank INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mint_address, wallet_address)
);

CREATE INDEX idx_token_holders_unified_mint ON token_holders_unified(mint_address);
CREATE INDEX idx_token_holders_unified_percentage ON token_holders_unified(percentage DESC);

-- SOL price tracking (shared across all monitors)
CREATE TABLE IF NOT EXISTS sol_prices (
  id SERIAL PRIMARY KEY,
  price_usd DECIMAL(10, 4) NOT NULL,
  source VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sol_prices_created ON sol_prices(created_at DESC);

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert migration record
INSERT INTO schema_migrations (version, name) 
VALUES (1, 'unified_monitoring_schema') 
ON CONFLICT (version) DO NOTHING;

-- Create optimized functions for common operations
CREATE OR REPLACE FUNCTION update_token_stats(
  p_mint_address VARCHAR(64)
) RETURNS void AS $$
BEGIN
  UPDATE tokens_unified t
  SET 
    volume_24h_sol = COALESCE((
      SELECT SUM(sol_amount) / 1e9
      FROM trades_unified
      WHERE mint_address = p_mint_address
      AND block_time > NOW() - INTERVAL '24 hours'
    ), 0),
    volume_24h_usd = COALESCE((
      SELECT SUM(sol_amount * price_usd / price_sol) / 1e9
      FROM trades_unified
      WHERE mint_address = p_mint_address
      AND block_time > NOW() - INTERVAL '24 hours'
    ), 0),
    unique_traders_24h = COALESCE((
      SELECT COUNT(DISTINCT user_address)
      FROM trades_unified
      WHERE mint_address = p_mint_address
      AND block_time > NOW() - INTERVAL '24 hours'
    ), 0),
    total_trades = COALESCE((
      SELECT COUNT(*)
      FROM trades_unified
      WHERE mint_address = p_mint_address
    ), 0),
    total_buys = COALESCE((
      SELECT COUNT(*)
      FROM trades_unified
      WHERE mint_address = p_mint_address
      AND trade_type = 'buy'
    ), 0),
    total_sells = COALESCE((
      SELECT COUNT(*)
      FROM trades_unified
      WHERE mint_address = p_mint_address
      AND trade_type = 'sell'
    ), 0),
    updated_at = NOW()
  WHERE mint_address = p_mint_address;
END;
$$ LANGUAGE plpgsql;

-- Create view for active tokens (crossed threshold)
CREATE OR REPLACE VIEW active_tokens AS
SELECT 
  t.*,
  CASE 
    WHEN t.graduated_to_amm THEN 'graduated'
    WHEN t.current_program = 'amm_pool' THEN 'amm'
    WHEN t.latest_bonding_curve_progress >= 100 THEN 'completing'
    WHEN t.latest_bonding_curve_progress >= 50 THEN 'trending'
    ELSE 'active'
  END as status,
  (SELECT COUNT(*) FROM trades_unified WHERE mint_address = t.mint_address AND block_time > NOW() - INTERVAL '1 hour') as trades_1h,
  (SELECT COUNT(*) FROM trades_unified WHERE mint_address = t.mint_address AND block_time > NOW() - INTERVAL '24 hours') as trades_24h
FROM tokens_unified t
WHERE t.threshold_crossed_at IS NOT NULL
ORDER BY t.latest_market_cap_usd DESC NULLS LAST;

-- Create materialized view for performance dashboard
CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_stats AS
SELECT 
  COUNT(*) FILTER (WHERE threshold_crossed_at IS NOT NULL) as total_tracked_tokens,
  COUNT(*) FILTER (WHERE threshold_crossed_at IS NOT NULL AND current_program = 'bonding_curve') as bonding_curve_tokens,
  COUNT(*) FILTER (WHERE graduated_to_amm = TRUE) as graduated_tokens,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_tokens_24h,
  SUM(volume_24h_usd) as total_volume_24h_usd,
  AVG(latest_market_cap_usd) FILTER (WHERE latest_market_cap_usd IS NOT NULL) as avg_market_cap_usd,
  MAX(latest_market_cap_usd) as max_market_cap_usd,
  COUNT(DISTINCT (SELECT user_address FROM trades_unified WHERE block_time > NOW() - INTERVAL '24 hours')) as unique_traders_24h,
  NOW() as last_updated
WITH NO DATA;

-- Refresh dashboard stats periodically
CREATE UNIQUE INDEX idx_dashboard_stats_refresh ON dashboard_stats(last_updated);
REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_stats;