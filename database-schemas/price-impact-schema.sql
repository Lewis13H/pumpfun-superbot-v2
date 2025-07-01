-- Session 5: Enhanced Price Impact & Slippage Schema Updates
-- Adds detailed price impact tracking to trades

-- Add price impact columns to trades_unified table
ALTER TABLE trades_unified 
ADD COLUMN IF NOT EXISTS price_impact DECIMAL(10, 6),
ADD COLUMN IF NOT EXISTS effective_fee DECIMAL(10, 6),
ADD COLUMN IF NOT EXISTS spot_price DECIMAL(20, 12),
ADD COLUMN IF NOT EXISTS execution_price DECIMAL(20, 12),
ADD COLUMN IF NOT EXISTS slippage DECIMAL(10, 6),
ADD COLUMN IF NOT EXISTS minimum_received BIGINT,
ADD COLUMN IF NOT EXISTS maximum_sent BIGINT;

-- Create index for price impact analysis
CREATE INDEX IF NOT EXISTS idx_trades_price_impact ON trades_unified(price_impact) 
WHERE price_impact IS NOT NULL;

-- Create index for high impact trades
CREATE INDEX IF NOT EXISTS idx_trades_high_impact ON trades_unified(mint_address, block_time DESC) 
WHERE price_impact > 0.05; -- 5% or higher

-- Table for trade simulations (for large trade analysis)
CREATE TABLE IF NOT EXISTS trade_simulations (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    mint_address VARCHAR(64) NOT NULL,
    direction VARCHAR(10) NOT NULL, -- 'buy' or 'sell'
    total_input_amount BIGINT NOT NULL,
    chunk_size BIGINT NOT NULL,
    num_chunks INTEGER NOT NULL,
    average_price DECIMAL(20, 12),
    total_price_impact DECIMAL(10, 6),
    progressive_impacts JSONB, -- Array of impacts per chunk
    optimal_chunk_size BIGINT,
    recommended_chunks INTEGER,
    simulation_time TIMESTAMPTZ DEFAULT NOW()
);

-- Table for slippage analysis
CREATE TABLE IF NOT EXISTS slippage_analysis (
    pool_address VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    trade_size_100_usd DECIMAL(10, 6),   -- Slippage for $100 trade
    trade_size_1k_usd DECIMAL(10, 6),    -- Slippage for $1,000 trade
    trade_size_10k_usd DECIMAL(10, 6),   -- Slippage for $10,000 trade
    trade_size_100k_usd DECIMAL(10, 6),  -- Slippage for $100,000 trade
    avg_daily_slippage DECIMAL(10, 6),
    max_daily_slippage DECIMAL(10, 6),
    PRIMARY KEY (pool_address, timestamp)
);

-- View for high slippage trades
CREATE OR REPLACE VIEW v_high_slippage_trades AS
SELECT 
    t.signature,
    t.mint_address,
    t.user_address,
    t.trade_type,
    (t.sol_amount::DECIMAL / 1e9 * t.price_usd / t.price_sol) as volume_usd,
    t.price_impact,
    t.slippage,
    t.effective_fee,
    t.block_time,
    tok.symbol,
    tok.name
FROM trades_unified t
LEFT JOIN tokens_unified tok ON t.mint_address = tok.mint_address
WHERE t.slippage > 0.02 -- 2% or higher slippage
   OR t.price_impact > 0.05 -- 5% or higher price impact
ORDER BY t.block_time DESC;

-- View for pool slippage profiles
CREATE OR REPLACE VIEW v_pool_slippage_profiles AS
SELECT 
    sa.pool_address,
    ap.mint_address,
    t.symbol,
    t.name,
    sa.trade_size_100_usd as slippage_100,
    sa.trade_size_1k_usd as slippage_1k,
    sa.trade_size_10k_usd as slippage_10k,
    sa.trade_size_100k_usd as slippage_100k,
    sa.avg_daily_slippage,
    sa.max_daily_slippage,
    perf.current_tvl_usd,
    sa.timestamp
FROM slippage_analysis sa
JOIN amm_pools ap ON sa.pool_address = ap.pool_address
LEFT JOIN tokens_unified t ON ap.mint_address = t.mint_address
LEFT JOIN amm_pool_performance perf ON sa.pool_address = perf.pool_address
WHERE sa.timestamp = (
    SELECT MAX(timestamp) 
    FROM slippage_analysis sa2 
    WHERE sa2.pool_address = sa.pool_address
)
ORDER BY ap.current_tvl_usd DESC;

-- Function to calculate effective fee including price impact
CREATE OR REPLACE FUNCTION calculate_effective_fee(
    nominal_fee DECIMAL,
    price_impact DECIMAL
) RETURNS DECIMAL AS $$
BEGIN
    -- Effective fee = nominal fee + price impact
    -- This represents the true cost of the trade
    RETURN ROUND(nominal_fee + ABS(price_impact), 6);
END;
$$ LANGUAGE plpgsql;

-- Function to categorize price impact severity
CREATE OR REPLACE FUNCTION categorize_price_impact(
    impact DECIMAL
) RETURNS TEXT AS $$
BEGIN
    IF impact IS NULL THEN
        RETURN 'unknown';
    ELSIF ABS(impact) < 0.001 THEN
        RETURN 'negligible';
    ELSIF ABS(impact) < 0.005 THEN
        RETURN 'low';
    ELSIF ABS(impact) < 0.02 THEN
        RETURN 'medium';
    ELSIF ABS(impact) < 0.05 THEN
        RETURN 'high';
    ELSE
        RETURN 'severe';
    END IF;
END;
$$ LANGUAGE plpgsql;