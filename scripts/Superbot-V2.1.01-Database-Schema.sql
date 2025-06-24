-- Pump.fun Superbot V2 Database Schema
-- PostgreSQL with TimescaleDB extension

-- Create database if not exists (run as superuser)
-- CREATE DATABASE pump_monitor;

-- Connect to pump_monitor database
-- \c pump_monitor

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Drop existing tables for clean setup (remove in production)
DROP VIEW IF EXISTS active_tokens CASCADE;
DROP TABLE IF EXISTS price_updates CASCADE;
DROP TABLE IF EXISTS tokens CASCADE;

-- Main tokens table
CREATE TABLE tokens (
  address TEXT PRIMARY KEY,
  bonding_curve TEXT NOT NULL,
  vanity_id TEXT,
  symbol VARCHAR(20),
  name VARCHAR(100),
  image_uri TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  creator TEXT NOT NULL,
  graduated BOOLEAN DEFAULT FALSE,
  archived BOOLEAN DEFAULT FALSE,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for tokens table
CREATE INDEX idx_tokens_archived ON tokens(archived);
CREATE INDEX idx_tokens_creator ON tokens(creator);
CREATE INDEX idx_tokens_created_at ON tokens(created_at DESC);
CREATE INDEX idx_tokens_graduated ON tokens(graduated);
CREATE INDEX idx_tokens_symbol ON tokens(symbol);

-- Price updates table (will be converted to hypertable)
CREATE TABLE price_updates (
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token TEXT NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
  price_sol NUMERIC(20,12) NOT NULL,
  price_usd NUMERIC(20,8) NOT NULL,
  liquidity_sol NUMERIC(20,8) NOT NULL,
  liquidity_usd NUMERIC(20,8) NOT NULL,
  market_cap_usd NUMERIC(20,8) NOT NULL,
  bonding_complete BOOLEAN DEFAULT FALSE,
  progress NUMERIC(5,2),
  CONSTRAINT price_updates_token_time_key UNIQUE (token, time)
);

-- Convert to TimescaleDB hypertable for efficient time-series storage
SELECT create_hypertable('price_updates', 'time', if_not_exists => TRUE);

-- Create indexes for price_updates
CREATE INDEX idx_price_updates_token_time ON price_updates(token, time DESC);
CREATE INDEX idx_price_updates_time ON price_updates(time DESC);
CREATE INDEX idx_price_updates_market_cap ON price_updates(market_cap_usd);

-- Create view for active tokens with latest prices
CREATE OR REPLACE VIEW active_tokens AS
SELECT 
  t.*,
  p.price_usd as current_price,
  p.price_sol as current_price_sol,
  p.market_cap_usd as current_mcap,
  p.liquidity_usd as current_liquidity,
  p.liquidity_sol as current_liquidity_sol,
  p.progress as bonding_progress,
  p.bonding_complete,
  p.time as last_price_update
FROM tokens t
LEFT JOIN LATERAL (
  SELECT * FROM price_updates 
  WHERE token = t.address 
  ORDER BY time DESC 
  LIMIT 1
) p ON true
WHERE NOT t.archived
ORDER BY p.market_cap_usd DESC NULLS LAST;

-- Grant permissions (adjust user as needed)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pump_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO pump_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO pump_user;

-- Optional: Set up automatic data retention (keep 30 days of price data)
-- SELECT add_retention_policy('price_updates', INTERVAL '30 days', if_not_exists => TRUE);

-- Optional: Create continuous aggregate for hourly price data
-- CREATE MATERIALIZED VIEW price_updates_hourly
-- WITH (timescaledb.continuous) AS
-- SELECT 
--   time_bucket('1 hour', time) AS bucket,
--   token,
--   AVG(price_usd) as avg_price_usd,
--   AVG(market_cap_usd) as avg_market_cap,
--   MAX(price_usd) as high_price,
--   MIN(price_usd) as low_price,
--   LAST(price_usd, time) as close_price,
--   FIRST(price_usd, time) as open_price
-- FROM price_updates
-- GROUP BY bucket, token;

-- Add refresh policy for continuous aggregate
-- SELECT add_continuous_aggregate_policy('price_updates_hourly',
--   start_offset => INTERVAL '3 hours',
--   end_offset => INTERVAL '1 hour',
--   schedule_interval => INTERVAL '1 hour',
--   if_not_exists => TRUE
-- );