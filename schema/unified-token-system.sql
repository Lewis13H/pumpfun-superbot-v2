-- Unified Token System Migration
-- Creates a single source of truth for all token data

-- Option 1: Add UUID to existing system (backward compatible)
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_id ON tokens(id);

-- Create mapping view for compatibility
CREATE OR REPLACE VIEW tokens_unified AS
SELECT 
  COALESCE(t1.id, t2.id) as id,
  COALESCE(t1.address, t2.mint_address) as mint_address,
  CASE 
    WHEN t1.address IS NOT NULL AND t2.mint_address IS NOT NULL THEN 'both'
    WHEN t1.address IS NOT NULL THEN 'threshold'
    ELSE 'comprehensive'
  END as source,
  t1.created_at as threshold_first_seen,
  t2.created_at as comprehensive_first_seen,
  GREATEST(
    COALESCE(t1.volume_24h_usd, 0), 
    COALESCE((
      SELECT SUM(market_cap_usd) 
      FROM bonding_curve_trades 
      WHERE token_id = t2.id 
      AND block_time > NOW() - INTERVAL '24 hours'
    ), 0)
  ) as combined_volume_24h
FROM tokens t1
FULL OUTER JOIN tokens_comprehensive t2 ON t1.address = t2.mint_address;

-- Option 2: Create unified monitor that uses mint address as primary key
-- (Better for new deployments)

CREATE TABLE IF NOT EXISTS tokens_unified_v2 (
  mint_address VARCHAR(64) PRIMARY KEY,
  symbol VARCHAR(32),
  name VARCHAR(128),
  uri VARCHAR(512),
  
  -- Discovery info
  first_program VARCHAR(20) NOT NULL,
  first_seen_slot BIGINT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_market_cap_usd DECIMAL(20, 4) NOT NULL,
  
  -- Threshold info  
  threshold_crossed_at TIMESTAMPTZ,
  threshold_price_sol DECIMAL(20, 12),
  threshold_market_cap_usd DECIMAL(20, 4),
  
  -- Current status
  current_program VARCHAR(20),
  graduated_to_amm BOOLEAN DEFAULT FALSE,
  graduation_at TIMESTAMPTZ,
  graduation_slot BIGINT,
  
  -- Enrichment
  metadata_fetched BOOLEAN DEFAULT FALSE,
  metadata_fetched_at TIMESTAMPTZ,
  
  -- Stats
  total_trades INTEGER DEFAULT 0,
  volume_24h_sol DECIMAL(20, 9) DEFAULT 0,
  volume_24h_usd DECIMAL(20, 4) DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_tokens_unified_v2_threshold ON tokens_unified_v2(threshold_crossed_at) 
  WHERE threshold_crossed_at IS NOT NULL;
CREATE INDEX idx_tokens_unified_v2_graduated ON tokens_unified_v2(graduated_to_amm) 
  WHERE graduated_to_amm = TRUE;
CREATE INDEX idx_tokens_unified_v2_volume ON tokens_unified_v2(volume_24h_usd DESC);

-- All related tables use mint_address directly
CREATE TABLE IF NOT EXISTS trades_unified (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mint_address VARCHAR(64) NOT NULL REFERENCES tokens_unified_v2(mint_address),
  program VARCHAR(20) NOT NULL,
  signature VARCHAR(128) UNIQUE NOT NULL,
  trade_type VARCHAR(10) NOT NULL,
  user_address VARCHAR(64) NOT NULL,
  
  -- Amounts
  sol_amount BIGINT NOT NULL,
  token_amount BIGINT NOT NULL,
  price_sol DECIMAL(20, 12) NOT NULL,
  price_usd DECIMAL(20, 4) NOT NULL,
  market_cap_usd DECIMAL(20, 4) NOT NULL,
  
  -- State
  virtual_sol_reserves BIGINT,
  virtual_token_reserves BIGINT,
  
  -- Blockchain
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  
  -- Indexes
  INDEX idx_trades_unified_mint_time (mint_address, block_time DESC),
  INDEX idx_trades_unified_user (user_address),
  INDEX idx_trades_unified_mcap (market_cap_usd DESC)
);