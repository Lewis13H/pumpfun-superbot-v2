-- AMM Fee Events Database Schema
-- Tracks fee collection events and metrics for AMM pools

-- Fee events table
CREATE TABLE IF NOT EXISTS amm_fee_events (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(88) NOT NULL,
    event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('lp', 'protocol', 'creator')),
    pool_address VARCHAR(64) NOT NULL,
    recipient VARCHAR(64) NOT NULL,
    coin_amount BIGINT DEFAULT 0,
    pc_amount BIGINT DEFAULT 0,
    coin_value_usd DECIMAL(20, 4),
    pc_value_usd DECIMAL(20, 4),
    total_value_usd DECIMAL(20, 4),
    coin_mint VARCHAR(64),
    pc_mint VARCHAR(64),
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(signature, event_type)
);

-- Indexes for performance
CREATE INDEX idx_fee_events_pool ON amm_fee_events(pool_address);
CREATE INDEX idx_fee_events_recipient ON amm_fee_events(recipient);
CREATE INDEX idx_fee_events_time ON amm_fee_events(block_time DESC);
CREATE INDEX idx_fee_events_type ON amm_fee_events(event_type);

-- Daily fee metrics table
CREATE TABLE IF NOT EXISTS amm_fee_metrics_daily (
    pool_address VARCHAR(64) NOT NULL,
    date DATE NOT NULL,
    total_fees_usd DECIMAL(20, 4) DEFAULT 0,
    protocol_fees_usd DECIMAL(20, 4) DEFAULT 0,
    lp_fees_usd DECIMAL(20, 4) DEFAULT 0,
    creator_fees_usd DECIMAL(20, 4) DEFAULT 0,
    volume_usd DECIMAL(20, 4) DEFAULT 0,
    fee_apy DECIMAL(10, 4),
    trade_count INTEGER DEFAULT 0,
    unique_traders INTEGER DEFAULT 0,
    avg_fee_per_trade DECIMAL(20, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (pool_address, date)
);

-- Create index for date-based queries
CREATE INDEX idx_fee_metrics_date ON amm_fee_metrics_daily(date DESC);

-- Hourly fee aggregation view
CREATE MATERIALIZED VIEW IF NOT EXISTS amm_fee_metrics_hourly AS
SELECT 
    pool_address,
    date_trunc('hour', block_time) as hour,
    event_type,
    COUNT(*) as fee_event_count,
    SUM(coin_amount) as total_coin_amount,
    SUM(pc_amount) as total_pc_amount,
    SUM(total_value_usd) as total_value_usd,
    AVG(total_value_usd) as avg_fee_value_usd,
    MAX(total_value_usd) as max_fee_value_usd
FROM amm_fee_events
GROUP BY pool_address, date_trunc('hour', block_time), event_type
ORDER BY hour DESC;

-- Create index on materialized view
CREATE INDEX idx_fee_metrics_hourly_pool_hour ON amm_fee_metrics_hourly(pool_address, hour DESC);

-- Top fee generating users view
CREATE MATERIALIZED VIEW IF NOT EXISTS amm_top_fee_generators AS
SELECT 
    f.pool_address,
    t.user_address,
    COUNT(DISTINCT f.signature) as trade_count,
    SUM(f.total_value_usd) as total_fees_generated_usd,
    AVG(f.total_value_usd) as avg_fee_per_trade,
    MAX(f.block_time) as last_trade_time,
    date_trunc('day', MIN(f.block_time)) as first_trade_date
FROM amm_fee_events f
JOIN trades_unified t ON t.signature = f.signature
WHERE f.block_time > NOW() - INTERVAL '30 days'
GROUP BY f.pool_address, t.user_address
HAVING SUM(f.total_value_usd) > 10 -- Only users generating >$10 in fees
ORDER BY total_fees_generated_usd DESC;

-- Create indexes on view
CREATE INDEX idx_top_fee_generators_pool ON amm_top_fee_generators(pool_address);
CREATE INDEX idx_top_fee_generators_user ON amm_top_fee_generators(user_address);

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_amm_fee_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY amm_fee_metrics_hourly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY amm_top_fee_generators;
END;
$$ LANGUAGE plpgsql;

-- Pool fee summary view
CREATE OR REPLACE VIEW amm_pool_fee_summary AS
SELECT 
    p.pool_address,
    p.mint_address,
    t.symbol,
    t.name,
    -- Fee totals
    COALESCE(SUM(f.total_value_usd), 0) as total_fees_usd,
    COALESCE(SUM(CASE WHEN f.event_type = 'lp' THEN f.total_value_usd ELSE 0 END), 0) as lp_fees_usd,
    COALESCE(SUM(CASE WHEN f.event_type = 'protocol' THEN f.total_value_usd ELSE 0 END), 0) as protocol_fees_usd,
    COALESCE(SUM(CASE WHEN f.event_type = 'creator' THEN f.total_value_usd ELSE 0 END), 0) as creator_fees_usd,
    -- Fee counts
    COUNT(DISTINCT f.id) as fee_event_count,
    COUNT(DISTINCT DATE(f.block_time)) as days_with_fees,
    -- Time metrics
    MIN(f.block_time) as first_fee_collected,
    MAX(f.block_time) as last_fee_collected,
    -- Average metrics
    CASE 
        WHEN COUNT(DISTINCT DATE(f.block_time)) > 0 
        THEN SUM(f.total_value_usd) / COUNT(DISTINCT DATE(f.block_time))
        ELSE 0 
    END as avg_daily_fees_usd
FROM amm_pools p
LEFT JOIN tokens_unified t ON t.mint_address = p.mint_address
LEFT JOIN amm_fee_events f ON f.pool_address = p.pool_address
GROUP BY p.pool_address, p.mint_address, t.symbol, t.name;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_amm_fee_metrics_daily_updated_at
BEFORE UPDATE ON amm_fee_metrics_daily
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();