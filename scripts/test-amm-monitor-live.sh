#!/bin/bash
# Test AMM Monitor Live
# Runs the AMM monitor for 5 minutes and checks if it captures trades

echo "🚀 Starting AMM Monitor Test"
echo "================================"
echo "This will run the AMM monitor for 5 minutes"
echo "and check if trades are being captured..."
echo ""

# Start time
START_TIME=$(date +%s)

# Get initial trade count
INITIAL_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND block_time > NOW() - INTERVAL '1 day'" 2>/dev/null | tr -d ' ')
echo "📊 Initial AMM trades (last 24h): $INITIAL_COUNT"

# Run the monitor in background
echo ""
echo "🏃 Starting AMM monitor..."
npm run amm-monitor &
MONITOR_PID=$!

# Function to check trade count
check_trades() {
    local current_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND block_time > NOW() - INTERVAL '10 minutes'" 2>/dev/null | tr -d ' ')
    local new_trades=$((current_count - INITIAL_COUNT))
    echo "📈 Trades captured: $new_trades (Total in last 10min: $current_count)"
}

# Monitor for 5 minutes, checking every 30 seconds
echo ""
echo "⏱️  Monitoring for 5 minutes..."
echo "================================"

for i in {1..10}; do
    sleep 30
    echo -n "[$i/10] "
    check_trades
done

# Stop the monitor
echo ""
echo "🛑 Stopping monitor..."
kill $MONITOR_PID 2>/dev/null
wait $MONITOR_PID 2>/dev/null

# Final check
echo ""
echo "📊 Final Statistics:"
echo "================================"
FINAL_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND block_time > NOW() - INTERVAL '10 minutes'" 2>/dev/null | tr -d ' ')
NEW_TRADES=$((FINAL_COUNT - INITIAL_COUNT))

echo "✅ New AMM trades captured: $NEW_TRADES"

# Check latest trades
echo ""
echo "📝 Latest 5 AMM trades:"
psql "$DATABASE_URL" -c "
SELECT 
    TO_CHAR(block_time, 'HH24:MI:SS') as time,
    trade_type,
    SUBSTRING(mint_address, 1, 8) || '...' as token,
    ROUND(price_usd::numeric, 8) as price_usd,
    ROUND(sol_amount::numeric / 1e9, 4) as sol_amount
FROM trades_unified 
WHERE program = 'amm_pool' 
ORDER BY block_time DESC 
LIMIT 5
" 2>/dev/null

# Check if prices are being updated
echo ""
echo "📊 Recent price updates:"
psql "$DATABASE_URL" -c "
SELECT 
    SUBSTRING(mint_address, 1, 8) || '...' as token,
    price_source,
    TO_CHAR(updated_at, 'HH24:MI:SS') as last_update,
    ROUND(latest_price_usd::numeric, 8) as price_usd
FROM tokens_unified
WHERE graduated_to_amm = true
  AND updated_at > NOW() - INTERVAL '10 minutes'
ORDER BY updated_at DESC
LIMIT 5
" 2>/dev/null

if [ $NEW_TRADES -gt 0 ]; then
    echo ""
    echo "✅ SUCCESS: AMM monitor is capturing trades!"
else
    echo ""
    echo "⚠️  WARNING: No new trades captured. Possible issues:"
    echo "   - No AMM trading activity during test period"
    echo "   - Monitor configuration issues"
    echo "   - Connection problems"
fi