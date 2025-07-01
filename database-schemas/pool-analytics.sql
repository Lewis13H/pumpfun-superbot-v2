-- AMM Pool Analytics Schema
-- For Session 4: Advanced Pool Analytics

-- Hourly metrics for pool performance tracking
CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (
    pool_address VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    tvl_usd DECIMAL(20, 4),
    volume_usd DECIMAL(20, 4),
    fees_usd DECIMAL(20, 4),
    trade_count INTEGER,
    unique_traders INTEGER,
    avg_trade_size_usd DECIMAL(20, 4),
    price_base_quote DECIMAL(20, 12),
    base_reserve BIGINT,
    quote_reserve BIGINT,
    lp_supply BIGINT,
    utilization_rate DECIMAL(10, 4),
    volatility_1h DECIMAL(10, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (pool_address, timestamp)
);

-- Liquidity depth at various price impact levels
CREATE TABLE IF NOT EXISTS amm_liquidity_depth (
    pool_address VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    buy_2pct_usd DECIMAL(20, 4),
    buy_5pct_usd DECIMAL(20, 4),
    buy_10pct_usd DECIMAL(20, 4),
    sell_2pct_usd DECIMAL(20, 4),
    sell_5pct_usd DECIMAL(20, 4),
    sell_10pct_usd DECIMAL(20, 4),
    total_liquidity_usd DECIMAL(20, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (pool_address, timestamp)
);

-- Pool performance metrics
CREATE TABLE IF NOT EXISTS amm_pool_performance (
    pool_address VARCHAR(64) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    total_volume_usd DECIMAL(30, 4) DEFAULT 0,
    total_fees_usd DECIMAL(30, 4) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    unique_traders INTEGER DEFAULT 0,
    highest_tvl_usd DECIMAL(20, 4) DEFAULT 0,
    highest_tvl_date TIMESTAMPTZ,
    current_tvl_usd DECIMAL(20, 4) DEFAULT 0,
    avg_daily_volume DECIMAL(20, 4) DEFAULT 0,
    avg_daily_fees DECIMAL(20, 4) DEFAULT 0,
    fee_apy_7d DECIMAL(10, 4),
    fee_apy_30d DECIMAL(10, 4),
    volatility_7d DECIMAL(10, 4),
    volatility_30d DECIMAL(10, 4),
    sharpe_ratio DECIMAL(10, 4),
    max_drawdown DECIMAL(10, 4),
    last_trade_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily aggregated metrics for trend analysis
CREATE TABLE IF NOT EXISTS amm_pool_metrics_daily (
    pool_address VARCHAR(64) NOT NULL,
    date DATE NOT NULL,
    open_price DECIMAL(20, 12),
    high_price DECIMAL(20, 12),
    low_price DECIMAL(20, 12),
    close_price DECIMAL(20, 12),
    volume_usd DECIMAL(20, 4),
    fees_usd DECIMAL(20, 4),
    trade_count INTEGER,
    unique_traders INTEGER,
    tvl_open DECIMAL(20, 4),
    tvl_close DECIMAL(20, 4),
    liquidity_added_usd DECIMAL(20, 4),
    liquidity_removed_usd DECIMAL(20, 4),
    net_liquidity_change DECIMAL(20, 4),
    PRIMARY KEY (pool_address, date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pool_metrics_hourly_time ON amm_pool_metrics_hourly(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pool_metrics_hourly_tvl ON amm_pool_metrics_hourly(tvl_usd DESC);
CREATE INDEX IF NOT EXISTS idx_pool_metrics_hourly_volume ON amm_pool_metrics_hourly(volume_usd DESC);

CREATE INDEX IF NOT EXISTS idx_liquidity_depth_time ON amm_liquidity_depth(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pool_performance_tvl ON amm_pool_performance(current_tvl_usd DESC);
CREATE INDEX IF NOT EXISTS idx_pool_performance_volume ON amm_pool_performance(total_volume_usd DESC);

CREATE INDEX IF NOT EXISTS idx_pool_metrics_daily_date ON amm_pool_metrics_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_pool_metrics_daily_volume ON amm_pool_metrics_daily(volume_usd DESC);

-- View for top performing pools
CREATE OR REPLACE VIEW v_top_pools AS
SELECT 
    p.pool_address,
    p.mint_address,
    p.current_tvl_usd,
    p.total_volume_usd,
    p.total_fees_usd,
    p.fee_apy_7d,
    p.volatility_7d,
    p.unique_traders,
    p.last_trade_time,
    t.symbol,
    t.name
FROM amm_pool_performance p
LEFT JOIN tokens_unified t ON p.mint_address = t.mint_address
WHERE p.current_tvl_usd > 1000
ORDER BY p.current_tvl_usd DESC;

-- View for recent pool activity
CREATE OR REPLACE VIEW v_pool_activity_24h AS
SELECT 
    pool_address,
    COUNT(*) as trades_24h,
    SUM(volume_usd) as volume_24h,
    SUM(fees_usd) as fees_24h,
    COUNT(DISTINCT unique_traders) as traders_24h,
    AVG(tvl_usd) as avg_tvl_24h,
    MAX(tvl_usd) as max_tvl_24h,
    MIN(tvl_usd) as min_tvl_24h
FROM amm_pool_metrics_hourly
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY pool_address;

-- Function to calculate pool utilization rate
CREATE OR REPLACE FUNCTION calculate_utilization_rate(
    volume_24h DECIMAL,
    tvl DECIMAL
) RETURNS DECIMAL AS $$
BEGIN
    IF tvl IS NULL OR tvl = 0 THEN
        RETURN 0;
    END IF;
    RETURN ROUND(volume_24h / tvl, 4);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate fee APY
CREATE OR REPLACE FUNCTION calculate_fee_apy(
    fees_period DECIMAL,
    tvl DECIMAL,
    days INTEGER
) RETURNS DECIMAL AS $$
BEGIN
    IF tvl IS NULL OR tvl = 0 OR days = 0 THEN
        RETURN 0;
    END IF;
    -- Annualize the fee return
    RETURN ROUND((fees_period / tvl) * (365.0 / days) * 100, 2);
END;
$$ LANGUAGE plpgsql;