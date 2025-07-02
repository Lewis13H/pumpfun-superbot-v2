#!/bin/bash

echo "======================================"
echo "AMM Fixes Verification"
echo "======================================"
echo ""

DB="pump_monitor"

# Check latest trades
echo "## Latest AMM Trades (checking decimal conversion)"
psql $DB -c "
SELECT 
    signature,
    sol_amount,
    token_amount,
    price_usd,
    market_cap_usd,
    created_at
FROM trades_unified
WHERE program = 'amm_pool'
ORDER BY created_at DESC
LIMIT 5;
"

echo ""
echo "## Price Calculation Check"
psql $DB -c "
SELECT 
    COUNT(*) as total_trades,
    COUNT(CASE WHEN price_usd > 0 THEN 1 END) as trades_with_price,
    COUNT(CASE WHEN price_usd = 0 THEN 1 END) as trades_without_price,
    ROUND(AVG(CASE WHEN price_usd > 0 THEN price_usd END)::numeric, 8) as avg_price_usd
FROM trades_unified
WHERE program = 'amm_pool'
AND created_at > NOW() - INTERVAL '10 minutes';
"

echo ""
echo "## Token Save Check"
psql $DB -c "
SELECT 
    COUNT(*) as tokens_saved
FROM tokens_unified
WHERE graduated_to_amm = true
AND created_at > NOW() - INTERVAL '10 minutes';
"

echo ""
echo "## Sample Trade Verification"
psql $DB -t -c "
SELECT 
    signature,
    sol_amount,
    token_amount
FROM trades_unified
WHERE program = 'amm_pool'
AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 1;
" | while IFS='|' read -r sig sol token; do
    sig=$(echo "$sig" | xargs)
    sol=$(echo "$sol" | xargs)
    token=$(echo "$token" | xargs)
    
    echo "Latest trade:"
    echo "- Signature: $sig"
    echo "- SOL Amount: $sol (should be < 1000, not in billions)"
    echo "- Token Amount: $token (should be in millions, not trillions)"
    echo ""
    echo "Verify on Solscan: https://solscan.io/tx/$sig"
done