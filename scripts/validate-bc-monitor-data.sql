-- BC Monitor Database Validation Queries
-- Run after test to validate data integrity

-- Overview Statistics
\echo '=== DATABASE VALIDATION REPORT ==='
\echo 'Generated at:' `date`
\echo ''

-- 1. Token Summary
\echo '1. TOKEN SUMMARY (Last Hour)'
SELECT 
    COUNT(DISTINCT mint_address) as unique_tokens,
    COUNT(*) FILTER (WHERE threshold_crossed_at IS NOT NULL) as above_threshold,
    COUNT(*) FILTER (WHERE graduated_to_amm = TRUE) as graduated,
    COUNT(*) FILTER (WHERE first_market_cap_usd >= 8888) as discovered_above_threshold,
    MIN(created_at) as oldest_token,
    MAX(created_at) as newest_token,
    ROUND(AVG(first_market_cap_usd)::numeric, 2) as avg_first_market_cap,
    ROUND(MAX(latest_market_cap_usd)::numeric, 2) as highest_market_cap
FROM tokens_unified
WHERE created_at > NOW() - INTERVAL '1 hour';

-- 2. Trade Summary
\echo ''
\echo '2. TRADE SUMMARY (Last Hour)'
SELECT 
    COUNT(*) as total_trades,
    COUNT(DISTINCT mint_address) as tokens_with_trades,
    COUNT(*) FILTER (WHERE trade_type = 'buy') as buy_trades,
    COUNT(*) FILTER (WHERE trade_type = 'sell') as sell_trades,
    COUNT(DISTINCT user_address) as unique_traders,
    ROUND(AVG(market_cap_usd)::numeric, 2) as avg_market_cap,
    ROUND(MAX(market_cap_usd)::numeric, 2) as max_market_cap,
    ROUND(SUM(sol_amount::numeric / 1e9 * price_usd)::numeric, 2) as total_volume_usd
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour';

-- 3. Data Quality Checks
\echo ''
\echo '3. DATA QUALITY CHECKS'

-- Check for duplicate trades
WITH duplicate_check AS (
    SELECT signature, COUNT(*) as count
    FROM trades_unified
    WHERE created_at > NOW() - INTERVAL '1 hour'
    GROUP BY signature
    HAVING COUNT(*) > 1
)
SELECT 
    'Duplicate Trades' as check_name,
    COUNT(*) as issues,
    CASE WHEN COUNT(*) = 0 THEN '✅ PASSED' ELSE '❌ FAILED' END as status
FROM duplicate_check

UNION ALL

-- Check for tokens without trades
SELECT 
    'Tokens Without Trades' as check_name,
    COUNT(*) as issues,
    CASE WHEN COUNT(*) = 0 THEN '✅ PASSED' ELSE '⚠️  WARNING' END as status
FROM tokens_unified t
LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
WHERE t.created_at > NOW() - INTERVAL '1 hour'
    AND t.threshold_crossed_at IS NOT NULL
    AND tr.mint_address IS NULL

UNION ALL

-- Check for invalid market caps
SELECT 
    'Invalid Market Caps' as check_name,
    COUNT(*) as issues,
    CASE WHEN COUNT(*) = 0 THEN '✅ PASSED' ELSE '❌ FAILED' END as status
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
    AND (market_cap_usd < 0 OR market_cap_usd > 10000000)

UNION ALL

-- Check for missing prices
SELECT 
    'Trades Missing Prices' as check_name,
    COUNT(*) as issues,
    CASE WHEN COUNT(*) = 0 THEN '✅ PASSED' ELSE '❌ FAILED' END as status
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
    AND (price_sol IS NULL OR price_usd IS NULL OR price_sol = 0 OR price_usd = 0)

ORDER BY check_name;

-- 4. Market Cap Distribution
\echo ''
\echo '4. MARKET CAP DISTRIBUTION'
SELECT 
    CASE 
        WHEN market_cap_usd < 1000 THEN '< $1K'
        WHEN market_cap_usd < 10000 THEN '$1K - $10K'
        WHEN market_cap_usd < 50000 THEN '$10K - $50K'
        WHEN market_cap_usd < 100000 THEN '$50K - $100K'
        ELSE '> $100K'
    END as market_cap_range,
    COUNT(*) as trade_count,
    COUNT(DISTINCT mint_address) as unique_tokens,
    ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER())::numeric, 1) as percentage
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY 1
ORDER BY 
    CASE market_cap_range
        WHEN '< $1K' THEN 1
        WHEN '$1K - $10K' THEN 2
        WHEN '$10K - $50K' THEN 3
        WHEN '$50K - $100K' THEN 4
        ELSE 5
    END;

-- 5. Progress Distribution
\echo ''
\echo '5. BONDING CURVE PROGRESS DISTRIBUTION'
SELECT 
    CASE 
        WHEN bonding_curve_progress <= 25 THEN '0-25%'
        WHEN bonding_curve_progress <= 50 THEN '25-50%'
        WHEN bonding_curve_progress <= 75 THEN '50-75%'
        WHEN bonding_curve_progress <= 90 THEN '75-90%'
        WHEN bonding_curve_progress <= 100 THEN '90-100%'
        ELSE 'Complete'
    END as progress_range,
    COUNT(*) as trade_count,
    COUNT(DISTINCT mint_address) as unique_tokens,
    ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER())::numeric, 1) as percentage
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
    AND bonding_curve_progress IS NOT NULL
GROUP BY 1
ORDER BY 1;

-- 6. Top Tokens by Volume
\echo ''
\echo '6. TOP 10 TOKENS BY VOLUME'
SELECT 
    t.mint_address,
    t.symbol,
    t.name,
    COUNT(tr.signature) as trade_count,
    ROUND(SUM(tr.sol_amount::numeric / 1e9 * tr.price_usd)::numeric, 2) as volume_usd,
    ROUND(MAX(tr.market_cap_usd)::numeric, 2) as max_market_cap,
    MAX(tr.bonding_curve_progress) as max_progress,
    t.graduated_to_amm
FROM tokens_unified t
JOIN trades_unified tr ON t.mint_address = tr.mint_address
WHERE tr.created_at > NOW() - INTERVAL '1 hour'
GROUP BY t.mint_address, t.symbol, t.name, t.graduated_to_amm
ORDER BY volume_usd DESC
LIMIT 10;

-- 7. Graduation Analysis
\echo ''
\echo '7. GRADUATION ANALYSIS'
SELECT 
    COUNT(*) as total_graduations,
    MIN(graduation_at) as first_graduation,
    MAX(graduation_at) as last_graduation,
    STRING_AGG(mint_address, ', ' ORDER BY graduation_at) as graduated_tokens
FROM tokens_unified
WHERE graduation_at > NOW() - INTERVAL '1 hour';

-- 8. Performance Metrics
\echo ''
\echo '8. PERFORMANCE METRICS'
WITH time_buckets AS (
    SELECT 
        DATE_TRUNC('minute', created_at) as minute,
        COUNT(*) as trades_per_minute,
        COUNT(DISTINCT mint_address) as unique_tokens_per_minute
    FROM trades_unified
    WHERE created_at > NOW() - INTERVAL '1 hour'
    GROUP BY 1
)
SELECT 
    COUNT(*) as total_minutes,
    ROUND(AVG(trades_per_minute)::numeric, 1) as avg_trades_per_minute,
    MAX(trades_per_minute) as max_trades_per_minute,
    ROUND(AVG(unique_tokens_per_minute)::numeric, 1) as avg_tokens_per_minute
FROM time_buckets;

-- 9. Error Summary (if error logging table exists)
\echo ''
\echo '9. DATABASE OPERATION SUMMARY'
SELECT 
    'Total Tokens' as metric,
    COUNT(*) as count
FROM tokens_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT 
    'Total Trades' as metric,
    COUNT(*) as count
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT 
    'Unique Traders' as metric,
    COUNT(DISTINCT user_address) as count
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT 
    'Tokens > $8,888' as metric,
    COUNT(DISTINCT mint_address) as count
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
    AND market_cap_usd >= 8888;

-- 10. Final Health Check
\echo ''
\echo '10. OVERALL HEALTH CHECK'
WITH health_metrics AS (
    SELECT 
        (SELECT COUNT(*) FROM trades_unified WHERE created_at > NOW() - INTERVAL '1 hour') as trades,
        (SELECT COUNT(DISTINCT mint_address) FROM tokens_unified WHERE created_at > NOW() - INTERVAL '1 hour') as tokens,
        (SELECT COUNT(*) FROM trades_unified WHERE created_at > NOW() - INTERVAL '1 hour' AND signature IN (SELECT signature FROM trades_unified GROUP BY signature HAVING COUNT(*) > 1)) as duplicates
)
SELECT 
    CASE 
        WHEN trades > 1000 AND tokens > 50 AND duplicates = 0 THEN '✅ EXCELLENT - High volume, no issues'
        WHEN trades > 500 AND tokens > 25 AND duplicates = 0 THEN '✅ GOOD - Moderate volume, no issues'
        WHEN trades > 100 AND duplicates < 5 THEN '⚠️  WARNING - Low volume or minor issues'
        ELSE '❌ POOR - Very low volume or data issues'
    END as health_status,
    trades as total_trades,
    tokens as unique_tokens,
    duplicates as duplicate_trades
FROM health_metrics;

\echo ''
\echo '=== END OF VALIDATION REPORT ==='"