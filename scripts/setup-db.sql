-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create tokens table if not exists
CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    bonding_curve TEXT NOT NULL,
    vanity_id TEXT UNIQUE,
    symbol VARCHAR(20),
    name VARCHAR(100),
    image_uri TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    metadata_fetched_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    creator TEXT,
    creation_signature TEXT,
    graduated BOOLEAN DEFAULT FALSE,
    graduated_at TIMESTAMPTZ,
    archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    -- Add these columns if missing
    current_price_usd NUMERIC(20, 8) DEFAULT 0,
    current_liquidity_usd NUMERIC(20, 8) DEFAULT 0,
    market_cap_usd NUMERIC(20, 8) DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Create price_updates table if not exists
CREATE TABLE IF NOT EXISTS price_updates (
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    token TEXT NOT NULL,
    price_sol NUMERIC(20, 12),
    price_usd NUMERIC(20, 8),
    liquidity_sol NUMERIC(20, 8),
    liquidity_usd NUMERIC(20, 8),
    market_cap_usd NUMERIC(20, 8),
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    bonding_complete BOOLEAN DEFAULT FALSE
);

-- Create hypertable only if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables 
        WHERE hypertable_name = 'price_updates'
    ) THEN
        PERFORM create_hypertable('price_updates', 'time');
    END IF;
END $$;

-- Create or replace the active_tokens view
CREATE OR REPLACE VIEW active_tokens AS
SELECT 
    t.*,
    COALESCE(p.price_usd, t.current_price_usd, 0) as current_price,
    COALESCE(p.market_cap_usd, t.market_cap_usd, 0) as current_mcap,
    COALESCE(p.liquidity_usd, t.current_liquidity_usd, 0) as current_liquidity
FROM tokens t
LEFT JOIN LATERAL (
    SELECT * FROM price_updates 
    WHERE token = t.address 
    ORDER BY time DESC 
    LIMIT 1
) p ON true
WHERE NOT COALESCE(t.archived, false);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_tokens_active_mcap ON tokens(market_cap_usd DESC) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_tokens_vanity ON tokens(vanity_id);
CREATE INDEX IF NOT EXISTS idx_price_updates_token_time ON price_updates(token, time DESC);

-- Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO pump_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pump_user;

-- Verify setup
SELECT 'Tables:' as type, count(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
UNION ALL
SELECT 'Views:', count(*) FROM information_schema.views WHERE table_schema = 'public'
UNION ALL
SELECT 'Hypertables:', count(*) FROM timescaledb_information.hypertables;