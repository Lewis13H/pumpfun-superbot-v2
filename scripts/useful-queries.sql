-- useful-queries.sql
-- Collection of SQL queries to explore your data

-- 1. View all tokens with their latest price info
SELECT 
    t.*,
    p.price_sol,
    p.price_usd,
    p.liquidity_sol,
    p.liquidity_usd,
    p.market_cap_usd,
    p.time as last_update
FROM tokens t
LEFT JOIN LATERAL (
    SELECT * FROM price_updates 
    WHERE token = t.address 
    ORDER BY time DESC 
    LIMIT 1
) p ON true
WHERE NOT t.archived
ORDER BY t.created_at DESC;

-- 2. Find tokens by symbol or name
SELECT * FROM tokens 
WHERE symbol ILIKE '%PEPE%' 
   OR name ILIKE '%PEPE%';

-- 3. Top gainers in the last hour
WITH price_changes AS (
    SELECT 
        token,
        MAX(price_usd) FILTER (WHERE time > NOW() - INTERVAL '1 hour') as current_price,
        MAX(price_usd) FILTER (WHERE time < NOW() - INTERVAL '1 hour' AND time > NOW() - INTERVAL '2 hours') as previous_price
    FROM price_updates
    WHERE time > NOW() - INTERVAL '2 hours'
    GROUP BY token
)
SELECT 
    t.symbol,
    t.name,
    pc.current_price,
    pc.previous_price,
    ((pc.current_price - pc.previous_price) / pc.previous_price * 100) as price_change_percent
FROM price_changes pc
JOIN tokens t ON t.address = pc.token
WHERE pc.previous_price > 0 AND pc.current_price > 0
ORDER BY price_change_percent DESC
LIMIT 10;

-- 4. Token creation timeline
SELECT 
    DATE_TRUNC('hour', created_at) as hour,
    COUNT(*) as tokens_created
FROM tokens
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- 5. Creators with multiple tokens
SELECT 
    creator,
    COUNT(*) as token_count,
    ARRAY_AGG(symbol ORDER BY created_at DESC) as tokens
FROM tokens
WHERE symbol IS NOT NULL
GROUP BY creator
HAVING COUNT(*) > 1
ORDER BY token_count DESC
LIMIT 20;

-- 6. Bonding curve distribution
SELECT 
    CASE 
        WHEN p.liquidity_sol < 10 THEN '0-10 SOL'
        WHEN p.liquidity_sol < 25 THEN '10-25 SOL'
        WHEN p.liquidity_sol < 50 THEN '25-50 SOL'
        WHEN p.liquidity_sol < 70 THEN '50-70 SOL'
        WHEN p.liquidity_sol < 85 THEN '70-85 SOL'
        ELSE '85+ SOL (Graduated)'
    END as liquidity_range,
    COUNT(*) as token_count
FROM tokens t
INNER JOIN LATERAL (
    SELECT liquidity_sol FROM price_updates 
    WHERE token = t.address 
    ORDER BY time DESC 
    LIMIT 1
) p ON true
WHERE NOT t.archived
GROUP BY liquidity_range
ORDER BY 
    CASE liquidity_range
        WHEN '0-10 SOL' THEN 1
        WHEN '10-25 SOL' THEN 2
        WHEN '25-50 SOL' THEN 3
        WHEN '50-70 SOL' THEN 4
        WHEN '70-85 SOL' THEN 5
        ELSE 6
    END;

-- 7. Price history for specific token
SELECT 
    time,
    price_sol,
    price_usd,
    liquidity_sol,
    market_cap_usd
FROM price_updates
WHERE token = 'YOUR_TOKEN_ADDRESS_HERE'
ORDER BY time DESC
LIMIT 100;

-- 8. Tokens close to graduation (>70 SOL liquidity)
SELECT 
    t.symbol,
    t.name,
    t.address,
    p.liquidity_sol,
    (85 - p.liquidity_sol) as sol_to_graduation,
    ROUND((p.liquidity_sol / 85.0 * 100)::numeric, 2) as progress_percent
FROM tokens t
INNER JOIN LATERAL (
    SELECT * FROM price_updates 
    WHERE token = t.address 
    ORDER BY time DESC 
    LIMIT 1
) p ON true
WHERE NOT t.archived 
  AND NOT t.graduated 
  AND p.liquidity_sol > 70
ORDER BY p.liquidity_sol DESC;

-- 9. Database size and performance stats
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    n_live_tup as row_count
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;