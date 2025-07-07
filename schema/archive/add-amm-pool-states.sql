-- AMM Pool State Tracking
-- Stores historical pool state snapshots for pump.swap AMM pools

-- Create table if not exists
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_amm_pool_states_mint 
  ON amm_pool_states(mint_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_amm_pool_states_pool 
  ON amm_pool_states(pool_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_amm_pool_states_slot 
  ON amm_pool_states(slot DESC);

-- Add comment
COMMENT ON TABLE amm_pool_states IS 'Historical snapshots of AMM pool states including reserves';
COMMENT ON COLUMN amm_pool_states.virtual_sol_reserves IS 'Virtual SOL reserves in lamports from trade events';
COMMENT ON COLUMN amm_pool_states.virtual_token_reserves IS 'Virtual token reserves with token decimals from trade events';
COMMENT ON COLUMN amm_pool_states.real_sol_reserves IS 'Actual SOL in pool account (optional)';
COMMENT ON COLUMN amm_pool_states.real_token_reserves IS 'Actual tokens in pool account (optional)';