#!/bin/bash

echo "======================================"
echo "AMM Monitor Test Results Analysis"
echo "======================================"
echo ""

DB="pump_monitor"

# Get summary statistics
echo "## Summary Statistics"
psql $DB -c "
SELECT 
    COUNT(*) as total_trades,
    COUNT(DISTINCT mint_address) as unique_tokens,
    COUNT(CASE WHEN trade_type = 'buy' THEN 1 END) as buy_trades,
    COUNT(CASE WHEN trade_type = 'sell' THEN 1 END) as sell_trades,
    ROUND(SUM(volume_usd)::numeric, 2) as total_volume_usd,
    ROUND(AVG(price_usd)::numeric, 8) as avg_price_usd,
    ROUND(MAX(market_cap_usd)::numeric, 2) as max_market_cap
FROM trades_unified
WHERE program = 'amm_pool'
AND created_at > NOW() - INTERVAL '10 minutes';
"

echo ""
echo "## Token Save Status"
psql $DB -c "
SELECT 
    COUNT(*) as amm_tokens_saved
FROM tokens_unified
WHERE graduated_to_amm = true
AND created_at > NOW() - INTERVAL '10 minutes';
"

echo ""
echo "## Sample Trades (2 Buy, 2 Sell)"

# Get 2 buy trades
echo ""
echo "### BUY Trades:"
psql $DB -t -c "
SELECT 
    signature,
    mint_address,
    sol_amount,
    token_amount,
    price_usd,
    volume_usd,
    market_cap_usd,
    created_at
FROM trades_unified
WHERE program = 'amm_pool' 
AND trade_type = 'buy'
AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 2;
" | while IFS='|' read -r sig mint sol_amt token_amt price vol mcap created; do
    # Trim whitespace
    sig=$(echo "$sig" | xargs)
    mint=$(echo "$mint" | xargs)
    
    echo ""
    echo "Signature: $sig"
    echo "Mint: $mint"
    echo "SOL Amount: $sol_amt"
    echo "Token Amount: $token_amt"
    echo "Price USD: $price"
    echo "Volume USD: $vol"
    echo "Market Cap: $mcap"
    echo "Time: $created"
    echo "Solscan: https://solscan.io/tx/$sig"
    echo "Pump.fun: https://pump.fun/coin/$mint"
done

# Get 2 sell trades
echo ""
echo "### SELL Trades:"
psql $DB -t -c "
SELECT 
    signature,
    mint_address,
    sol_amount,
    token_amount,
    price_usd,
    volume_usd,
    market_cap_usd,
    created_at
FROM trades_unified
WHERE program = 'amm_pool' 
AND trade_type = 'sell'
AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 2;
" | while IFS='|' read -r sig mint sol_amt token_amt price vol mcap created; do
    # Trim whitespace
    sig=$(echo "$sig" | xargs)
    mint=$(echo "$mint" | xargs)
    
    echo ""
    echo "Signature: $sig"
    echo "Mint: $mint"
    echo "SOL Amount: $sol_amt"
    echo "Token Amount: $token_amt"
    echo "Price USD: $price"
    echo "Volume USD: $vol"
    echo "Market Cap: $mcap"
    echo "Time: $created"
    echo "Solscan: https://solscan.io/tx/$sig"
    echo "Pump.fun: https://pump.fun/coin/$mint"
done

echo ""
echo "## Random Token Sample (10 tokens)"
psql $DB -c "
WITH recent_trades AS (
    SELECT DISTINCT mint_address
    FROM trades_unified
    WHERE program = 'amm_pool'
    AND created_at > NOW() - INTERVAL '10 minutes'
    ORDER BY RANDOM()
    LIMIT 10
)
SELECT 
    rt.mint_address,
    t.symbol,
    t.name,
    t.first_price_usd,
    t.first_market_cap_usd
FROM recent_trades rt
LEFT JOIN tokens_unified t ON rt.mint_address = t.mint_address;
"

echo ""
echo "## Pool States"
psql $DB -c "
SELECT 
    COUNT(*) as pool_states_count,
    COUNT(DISTINCT mint_address) as unique_pools
FROM amm_pool_states
WHERE slot > 0;
"