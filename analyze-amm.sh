#!/bin/bash

echo "==================================="
echo "AMM Database Analysis"
echo "==================================="
echo ""

# Database connection
DB="pump_monitor"

# Get statistics
echo "## AMM Trade Statistics"
psql $DB -c "
SELECT 
    COUNT(*) as total_trades,
    COUNT(DISTINCT mint_address) as unique_tokens,
    COUNT(CASE WHEN trade_type = 'buy' THEN 1 END) as buy_trades,
    COUNT(CASE WHEN trade_type = 'sell' THEN 1 END) as sell_trades,
    ROUND(SUM(volume_usd)::numeric, 2) as total_volume_usd
FROM trades_unified
WHERE program = 'amm_pool'
AND created_at > NOW() - INTERVAL '24 hours';
"

echo ""
echo "## Sample AMM Trades (2 Buy, 2 Sell)"

# Get 2 recent buy trades
echo ""
echo "### Recent BUY Trades:"
psql $DB -t -A -F'|' -c "
SELECT 
    signature,
    mint_address,
    sol_amount,
    token_amount,
    price_usd,
    volume_usd,
    created_at
FROM trades_unified
WHERE program = 'amm_pool' 
AND trade_type = 'buy'
ORDER BY created_at DESC
LIMIT 2;
" | while IFS='|' read sig mint sol_amt token_amt price vol created; do
    echo ""
    echo "Signature: $sig"
    echo "Solscan: https://solscan.io/tx/$sig"
    echo "Pump.fun: https://pump.fun/coin/$mint"
    echo "SOL Amount: $sol_amt"
    echo "Token Amount: $token_amt"
    echo "Price USD: $price"
    echo "Volume USD: $vol"
    echo "Time: $created"
done

# Get 2 recent sell trades
echo ""
echo "### Recent SELL Trades:"
psql $DB -t -A -F'|' -c "
SELECT 
    signature,
    mint_address,
    sol_amount,
    token_amount,
    price_usd,
    volume_usd,
    created_at
FROM trades_unified
WHERE program = 'amm_pool' 
AND trade_type = 'sell'
ORDER BY created_at DESC
LIMIT 2;
" | while IFS='|' read sig mint sol_amt token_amt price vol created; do
    echo ""
    echo "Signature: $sig"
    echo "Solscan: https://solscan.io/tx/$sig"
    echo "Pump.fun: https://pump.fun/coin/$mint"
    echo "SOL Amount: $sol_amt"
    echo "Token Amount: $token_amt"
    echo "Price USD: $price"
    echo "Volume USD: $vol"
    echo "Time: $created"
done

echo ""
echo "## Token Information"
psql $DB -c "
SELECT 
    t.mint_address,
    t.symbol,
    t.name,
    t.graduated_to_amm,
    COUNT(tr.signature) as trade_count
FROM tokens_unified t
JOIN trades_unified tr ON t.mint_address = tr.mint_address
WHERE tr.program = 'amm_pool'
GROUP BY t.mint_address, t.symbol, t.name, t.graduated_to_amm
ORDER BY trade_count DESC
LIMIT 5;
"

echo ""
echo "## Pool States"
psql $DB -c "
SELECT 
    mint_address,
    pool_address,
    virtual_sol_reserves,
    virtual_token_reserves,
    last_updated
FROM amm_pool_states
ORDER BY last_updated DESC
LIMIT 5;
"

echo ""
echo "Report generation complete!"