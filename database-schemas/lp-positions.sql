-- LP Positions Database Schema
-- Tracks LP token holdings and position analytics

-- LP positions table
CREATE TABLE IF NOT EXISTS lp_positions (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    lp_token_account VARCHAR(64) NOT NULL,
    lp_balance BIGINT NOT NULL DEFAULT 0,
    base_share BIGINT, -- SOL share in lamports
    quote_share BIGINT, -- Token share with decimals
    total_value_usd DECIMAL(20, 4),
    share_percentage DECIMAL(10, 6),
    last_deposit_time TIMESTAMPTZ,
    last_withdraw_time TIMESTAMPTZ,
    realized_pnl_usd DECIMAL(20, 4) DEFAULT 0,
    fees_earned_usd DECIMAL(20, 4) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_address, user_address)
);

-- Indexes for performance
CREATE INDEX idx_lp_positions_pool ON lp_positions(pool_address);
CREATE INDEX idx_lp_positions_user ON lp_positions(user_address);
CREATE INDEX idx_lp_positions_active ON lp_positions(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_lp_positions_value ON lp_positions(total_value_usd DESC);

-- LP position history for tracking changes over time
CREATE TABLE IF NOT EXISTS lp_position_history (
    id SERIAL PRIMARY KEY,
    position_id INTEGER REFERENCES lp_positions(id),
    lp_balance BIGINT NOT NULL,
    base_share BIGINT,
    quote_share BIGINT,
    value_usd DECIMAL(20, 4),
    impermanent_loss DECIMAL(10, 4),
    fees_earned_period DECIMAL(20, 4),
    action VARCHAR(20) CHECK (action IN ('deposit', 'withdraw', 'update', 'fees')),
    slot BIGINT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for historical queries
CREATE INDEX idx_position_history_position ON lp_position_history(position_id);
CREATE INDEX idx_position_history_timestamp ON lp_position_history(timestamp DESC);

-- LP deposit/withdrawal events
CREATE TABLE IF NOT EXISTS lp_transactions (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(88) NOT NULL UNIQUE,
    pool_address VARCHAR(64) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('deposit', 'withdraw')),
    lp_amount BIGINT NOT NULL,
    base_amount BIGINT NOT NULL,
    quote_amount BIGINT NOT NULL,
    base_price_usd DECIMAL(20, 4),
    quote_price_usd DECIMAL(20, 4),
    total_value_usd DECIMAL(20, 4),
    lp_tokens_minted BIGINT, -- For deposits
    lp_tokens_burned BIGINT, -- For withdrawals
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for transaction queries
CREATE INDEX idx_lp_transactions_pool ON lp_transactions(pool_address);
CREATE INDEX idx_lp_transactions_user ON lp_transactions(user_address);
CREATE INDEX idx_lp_transactions_time ON lp_transactions(block_time DESC);

-- Impermanent loss tracking
CREATE TABLE IF NOT EXISTS lp_impermanent_loss (
    id SERIAL PRIMARY KEY,
    position_id INTEGER REFERENCES lp_positions(id),
    initial_base_amount DECIMAL(20, 12),
    initial_quote_amount DECIMAL(20, 12),
    initial_base_price DECIMAL(20, 4),
    initial_quote_price DECIMAL(20, 4),
    current_base_amount DECIMAL(20, 12),
    current_quote_amount DECIMAL(20, 12),
    current_base_price DECIMAL(20, 4),
    current_quote_price DECIMAL(20, 4),
    current_value_usd DECIMAL(20, 4),
    hodl_value_usd DECIMAL(20, 4),
    impermanent_loss_usd DECIMAL(20, 4),
    impermanent_loss_percent DECIMAL(10, 4),
    price_ratio_change DECIMAL(10, 4),
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(position_id)
);

-- User LP summary view
CREATE OR REPLACE VIEW user_lp_summary AS
SELECT 
    u.user_address,
    COUNT(DISTINCT p.pool_address) as pools_count,
    COUNT(DISTINCT CASE WHEN p.is_active THEN p.pool_address END) as active_pools_count,
    SUM(CASE WHEN p.is_active THEN p.total_value_usd ELSE 0 END) as total_value_usd,
    SUM(p.realized_pnl_usd) as total_realized_pnl,
    SUM(p.fees_earned_usd) as total_fees_earned,
    AVG(p.share_percentage) as avg_pool_share,
    MIN(p.created_at) as first_lp_date,
    MAX(p.last_updated) as last_activity
FROM lp_positions p
JOIN (SELECT DISTINCT user_address FROM lp_positions) u ON u.user_address = p.user_address
GROUP BY u.user_address;

-- Pool LP metrics view
CREATE OR REPLACE VIEW pool_lp_metrics AS
SELECT 
    p.pool_address,
    t.mint_address,
    t.symbol,
    t.name,
    COUNT(DISTINCT lp.user_address) as unique_providers,
    COUNT(CASE WHEN lp.is_active THEN 1 END) as active_positions,
    SUM(CASE WHEN lp.is_active THEN lp.total_value_usd ELSE 0 END) as total_locked_value,
    AVG(CASE WHEN lp.is_active THEN lp.share_percentage ELSE NULL END) as avg_position_share,
    MAX(lp.share_percentage) as largest_position_share,
    SUM(lp.fees_earned_usd) as total_fees_distributed,
    COUNT(DISTINCT DATE(tx.block_time)) as days_with_activity,
    MAX(lp.last_updated) as last_position_update
FROM amm_pools p
LEFT JOIN tokens_unified t ON t.mint_address = p.mint_address
LEFT JOIN lp_positions lp ON lp.pool_address = p.pool_address
LEFT JOIN lp_transactions tx ON tx.pool_address = p.pool_address
GROUP BY p.pool_address, t.mint_address, t.symbol, t.name;

-- Top LP providers view
CREATE MATERIALIZED VIEW IF NOT EXISTS top_lp_providers AS
SELECT 
    lp.user_address,
    COUNT(DISTINCT lp.pool_address) as pools_provided,
    SUM(lp.total_value_usd) as total_value_provided,
    SUM(lp.fees_earned_usd) as total_fees_earned,
    SUM(lp.realized_pnl_usd) as total_realized_pnl,
    AVG(il.impermanent_loss_percent) as avg_impermanent_loss,
    MAX(lp.total_value_usd) as largest_position_usd,
    MIN(lp.created_at) as first_provision_date,
    MAX(lp.last_updated) as last_activity
FROM lp_positions lp
LEFT JOIN lp_impermanent_loss il ON il.position_id = lp.id
WHERE lp.is_active = TRUE
GROUP BY lp.user_address
HAVING SUM(lp.total_value_usd) > 100 -- Only include significant providers
ORDER BY total_value_provided DESC;

-- Create indexes on materialized view
CREATE INDEX idx_top_providers_value ON top_lp_providers(total_value_provided DESC);
CREATE INDEX idx_top_providers_user ON top_lp_providers(user_address);

-- Function to update position value
CREATE OR REPLACE FUNCTION update_lp_position_value(
    p_position_id INTEGER,
    p_base_share BIGINT,
    p_quote_share BIGINT,
    p_total_value_usd DECIMAL,
    p_share_percentage DECIMAL
) RETURNS void AS $$
BEGIN
    UPDATE lp_positions
    SET 
        base_share = p_base_share,
        quote_share = p_quote_share,
        total_value_usd = p_total_value_usd,
        share_percentage = p_share_percentage,
        last_updated = NOW()
    WHERE id = p_position_id;
    
    -- Record in history
    INSERT INTO lp_position_history (
        position_id, lp_balance, base_share, quote_share, 
        value_usd, action, timestamp
    )
    SELECT 
        id, lp_balance, p_base_share, p_quote_share,
        p_total_value_usd, 'update', NOW()
    FROM lp_positions
    WHERE id = p_position_id;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_lp_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY top_lp_providers;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_updated timestamp
CREATE OR REPLACE FUNCTION update_lp_position_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_lp_positions_timestamp
BEFORE UPDATE ON lp_positions
FOR EACH ROW
EXECUTE FUNCTION update_lp_position_timestamp();