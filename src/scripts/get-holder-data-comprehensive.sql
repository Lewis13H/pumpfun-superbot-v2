-- Comprehensive holder data query for token HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump

-- 1. Basic token information
WITH token_info AS (
    SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.uri,
        t.image_uri,
        t.description,
        t.creator,
        t.first_seen_at,
        t.first_price_sol,
        t.first_price_usd,
        t.first_market_cap_usd,
        t.threshold_crossed_at,
        t.threshold_market_cap_usd,
        t.current_program,
        t.graduated_to_amm,
        t.graduation_at,
        t.total_trades,
        t.total_buys,
        t.total_sells,
        t.volume_24h_sol,
        t.volume_24h_usd,
        t.latest_price_sol,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        t.latest_bonding_curve_progress,
        t.created_at,
        t.updated_at
    FROM tokens_unified t
    WHERE t.mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
),

-- 2. Latest holder snapshot
latest_snapshot AS (
    SELECT 
        hs.*,
        hs.created_at as snapshot_time
    FROM holder_snapshots hs
    WHERE hs.mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
    ORDER BY hs.created_at DESC
    LIMIT 1
),

-- 3. Holder analysis metadata
analysis_metadata AS (
    SELECT 
        ham.*,
        ham.created_at as analysis_time
    FROM holder_analysis_metadata ham
    WHERE ham.mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
    ORDER BY ham.created_at DESC
    LIMIT 1
),

-- 4. Token holder details
holder_details AS (
    SELECT 
        thd.*,
        wc.classification as wallet_type,
        wc.sub_classification,
        wc.confidence_score as wallet_confidence,
        wc.suspicious_activity_count
    FROM token_holder_details thd
    LEFT JOIN wallet_classifications wc ON thd.wallet_address = wc.wallet_address
    WHERE thd.mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
    ORDER BY thd.balance DESC
),

-- 5. Historical snapshots (last 10)
historical_snapshots AS (
    SELECT 
        hs.id,
        hs.created_at,
        hs.snapshot_time,
        hs.total_holders,
        hs.unique_holders,
        hs.top_10_percentage,
        hs.top_25_percentage,
        hs.top_100_percentage,
        hs.gini_coefficient,
        hs.herfindahl_index,
        hs.holder_score,
        hs.score_breakdown
    FROM holder_snapshots hs
    WHERE hs.mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
    ORDER BY hs.created_at DESC
    LIMIT 10
),

-- 6. Holder trends
trends AS (
    SELECT 
        ht.*
    FROM holder_trends ht
    WHERE ht.mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
    ORDER BY ht.calculated_at DESC
    LIMIT 1
),

-- 7. Active alerts
alerts AS (
    SELECT 
        ha.*
    FROM holder_alerts ha
    WHERE ha.mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
      AND ha.acknowledged = false
    ORDER BY ha.created_at DESC
)

-- Main query combining all data
SELECT 
    -- Token info
    jsonb_build_object(
        'token_info', (SELECT row_to_json(token_info.*) FROM token_info),
        'latest_snapshot', (SELECT row_to_json(latest_snapshot.*) FROM latest_snapshot),
        'analysis_metadata', (SELECT row_to_json(analysis_metadata.*) FROM analysis_metadata),
        'holder_details_count', (SELECT COUNT(*) FROM holder_details),
        'holder_details_top_20', (SELECT jsonb_agg(row_to_json(hd.*)) FROM (SELECT * FROM holder_details LIMIT 20) hd),
        'historical_snapshots', (SELECT jsonb_agg(row_to_json(hs.*)) FROM historical_snapshots hs),
        'latest_trends', (SELECT row_to_json(trends.*) FROM trends),
        'active_alerts', (SELECT jsonb_agg(row_to_json(alerts.*)) FROM alerts),
        'wallet_type_distribution', (
            SELECT jsonb_object_agg(
                COALESCE(wallet_type, 'unknown'), 
                count
            )
            FROM (
                SELECT 
                    wallet_type, 
                    COUNT(*) as count
                FROM holder_details
                GROUP BY wallet_type
            ) wt
        ),
        'holder_distribution_stats', (
            SELECT jsonb_build_object(
                'total_holders', COUNT(*),
                'avg_balance', AVG(balance),
                'median_balance', PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY balance),
                'top_1_balance', SUM(CASE WHEN rank <= 1 THEN balance ELSE 0 END),
                'top_10_balance', SUM(CASE WHEN rank <= 10 THEN balance ELSE 0 END),
                'top_20_balance', SUM(CASE WHEN rank <= 20 THEN balance ELSE 0 END),
                'top_50_balance', SUM(CASE WHEN rank <= 50 THEN balance ELSE 0 END),
                'top_100_balance', SUM(CASE WHEN rank <= 100 THEN balance ELSE 0 END)
            )
            FROM holder_details
        )
    ) as comprehensive_holder_data;