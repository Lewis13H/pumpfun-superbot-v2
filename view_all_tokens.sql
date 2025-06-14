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