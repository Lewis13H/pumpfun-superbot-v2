-- AMM Liquidity Events Schema
-- Tracks liquidity add/remove operations

-- Create liquidity events table
CREATE TABLE IF NOT EXISTS amm_liquidity_events (
  id SERIAL PRIMARY KEY,
  signature VARCHAR(88) NOT NULL UNIQUE,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('deposit', 'withdraw')),
  pool_address VARCHAR(64) NOT NULL,
  user_address VARCHAR(64) NOT NULL,
  lp_amount BIGINT NOT NULL,
  base_amount BIGINT NOT NULL,
  quote_amount BIGINT NOT NULL,
  base_price_usd DECIMAL(20, 4),
  quote_price_usd DECIMAL(20, 4),
  total_value_usd DECIMAL(20, 4),
  impermanent_loss DECIMAL(10, 4), -- for withdrawals
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_liquidity_events_pool ON amm_liquidity_events(pool_address);
CREATE INDEX idx_liquidity_events_user ON amm_liquidity_events(user_address);
CREATE INDEX idx_liquidity_events_type ON amm_liquidity_events(event_type);
CREATE INDEX idx_liquidity_events_time ON amm_liquidity_events(block_time DESC);
CREATE INDEX idx_liquidity_events_value ON amm_liquidity_events(total_value_usd DESC);

-- Create materialized view for user positions
CREATE MATERIALIZED VIEW IF NOT EXISTS user_liquidity_positions AS
SELECT 
  user_address,
  pool_address,
  SUM(CASE WHEN event_type = 'deposit' THEN lp_amount ELSE -lp_amount END) as net_lp_amount,
  SUM(CASE WHEN event_type = 'deposit' THEN base_amount ELSE -base_amount END) as net_base_amount,
  SUM(CASE WHEN event_type = 'deposit' THEN quote_amount ELSE -quote_amount END) as net_quote_amount,
  SUM(CASE WHEN event_type = 'deposit' THEN total_value_usd ELSE 0 END) as total_deposited_usd,
  SUM(CASE WHEN event_type = 'withdraw' THEN total_value_usd ELSE 0 END) as total_withdrawn_usd,
  COUNT(CASE WHEN event_type = 'deposit' THEN 1 END) as deposit_count,
  COUNT(CASE WHEN event_type = 'withdraw' THEN 1 END) as withdraw_count,
  MIN(CASE WHEN event_type = 'deposit' THEN block_time END) as first_deposit_time,
  MAX(block_time) as last_activity_time
FROM amm_liquidity_events
GROUP BY user_address, pool_address
HAVING SUM(CASE WHEN event_type = 'deposit' THEN lp_amount ELSE -lp_amount END) > 0;

-- Create index on materialized view
CREATE INDEX idx_user_positions_user ON user_liquidity_positions(user_address);
CREATE INDEX idx_user_positions_pool ON user_liquidity_positions(pool_address);
CREATE INDEX idx_user_positions_value ON user_liquidity_positions(net_lp_amount DESC);

-- Create function to refresh positions
CREATE OR REPLACE FUNCTION refresh_user_liquidity_positions()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_liquidity_positions;
END;
$$ LANGUAGE plpgsql;

-- Create hourly liquidity metrics table
CREATE TABLE IF NOT EXISTS amm_liquidity_metrics_hourly (
  pool_address VARCHAR(64) NOT NULL,
  hour TIMESTAMPTZ NOT NULL,
  deposits_count INTEGER DEFAULT 0,
  withdrawals_count INTEGER DEFAULT 0,
  deposits_value_usd DECIMAL(20, 4) DEFAULT 0,
  withdrawals_value_usd DECIMAL(20, 4) DEFAULT 0,
  net_liquidity_change_usd DECIMAL(20, 4) DEFAULT 0,
  unique_providers INTEGER DEFAULT 0,
  avg_deposit_size_usd DECIMAL(20, 4),
  avg_withdrawal_size_usd DECIMAL(20, 4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (pool_address, hour)
);

-- Create index for time-based queries
CREATE INDEX idx_liquidity_metrics_hour ON amm_liquidity_metrics_hourly(hour DESC);

-- Create function to aggregate hourly metrics
CREATE OR REPLACE FUNCTION aggregate_liquidity_metrics_hourly()
RETURNS void AS $$
BEGIN
  INSERT INTO amm_liquidity_metrics_hourly (
    pool_address,
    hour,
    deposits_count,
    withdrawals_count,
    deposits_value_usd,
    withdrawals_value_usd,
    net_liquidity_change_usd,
    unique_providers,
    avg_deposit_size_usd,
    avg_withdrawal_size_usd
  )
  SELECT 
    pool_address,
    date_trunc('hour', block_time) as hour,
    COUNT(CASE WHEN event_type = 'deposit' THEN 1 END) as deposits_count,
    COUNT(CASE WHEN event_type = 'withdraw' THEN 1 END) as withdrawals_count,
    COALESCE(SUM(CASE WHEN event_type = 'deposit' THEN total_value_usd END), 0) as deposits_value_usd,
    COALESCE(SUM(CASE WHEN event_type = 'withdraw' THEN total_value_usd END), 0) as withdrawals_value_usd,
    COALESCE(SUM(CASE WHEN event_type = 'deposit' THEN total_value_usd ELSE -total_value_usd END), 0) as net_liquidity_change_usd,
    COUNT(DISTINCT user_address) as unique_providers,
    AVG(CASE WHEN event_type = 'deposit' THEN total_value_usd END) as avg_deposit_size_usd,
    AVG(CASE WHEN event_type = 'withdraw' THEN total_value_usd END) as avg_withdrawal_size_usd
  FROM amm_liquidity_events
  WHERE block_time >= date_trunc('hour', NOW() - INTERVAL '1 hour')
    AND block_time < date_trunc('hour', NOW())
  GROUP BY pool_address, date_trunc('hour', block_time)
  ON CONFLICT (pool_address, hour) DO UPDATE SET
    deposits_count = EXCLUDED.deposits_count,
    withdrawals_count = EXCLUDED.withdrawals_count,
    deposits_value_usd = EXCLUDED.deposits_value_usd,
    withdrawals_value_usd = EXCLUDED.withdrawals_value_usd,
    net_liquidity_change_usd = EXCLUDED.net_liquidity_change_usd,
    unique_providers = EXCLUDED.unique_providers,
    avg_deposit_size_usd = EXCLUDED.avg_deposit_size_usd,
    avg_withdrawal_size_usd = EXCLUDED.avg_withdrawal_size_usd,
    created_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to update pool states when liquidity changes
CREATE OR REPLACE FUNCTION update_pool_liquidity_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update pool liquidity stats in amm_pools table if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'amm_pools') THEN
    UPDATE amm_pools
    SET 
      last_liquidity_event = NEW.block_time,
      updated_at = NOW()
    WHERE pool_address = NEW.pool_address;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_pool_liquidity_stats
AFTER INSERT ON amm_liquidity_events
FOR EACH ROW
EXECUTE FUNCTION update_pool_liquidity_stats();

-- Create view for top liquidity providers
CREATE VIEW top_liquidity_providers AS
SELECT 
  user_address,
  COUNT(DISTINCT pool_address) as pools_count,
  SUM(total_deposited_usd) as total_provided_usd,
  SUM(total_withdrawn_usd) as total_withdrawn_usd,
  SUM(total_deposited_usd - total_withdrawn_usd) as net_provided_usd,
  AVG(total_deposited_usd / NULLIF(deposit_count, 0)) as avg_deposit_size_usd,
  SUM(deposit_count) as total_deposits,
  SUM(withdraw_count) as total_withdrawals,
  MIN(first_deposit_time) as first_activity,
  MAX(last_activity_time) as last_activity
FROM user_liquidity_positions
GROUP BY user_address
ORDER BY total_provided_usd DESC;

-- Grant permissions if needed
GRANT SELECT ON amm_liquidity_events TO readonly_user;
GRANT SELECT ON user_liquidity_positions TO readonly_user;
GRANT SELECT ON amm_liquidity_metrics_hourly TO readonly_user;
GRANT SELECT ON top_liquidity_providers TO readonly_user;