#!/bin/bash

echo "======================================"
echo "AMM Monitor Fresh Test"
echo "======================================"
echo ""
echo "WARNING: This will delete all token data!"
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

# Clear token data
echo ""
echo "Clearing database..."
psql pump_monitor << EOF
-- Clear AMM-related data
DELETE FROM trades_unified WHERE program = 'amm_pool';
DELETE FROM tokens_unified WHERE graduated_to_amm = true;
DELETE FROM amm_pool_states;
DELETE FROM liquidity_events;
DELETE FROM amm_fee_events;
DELETE FROM lp_positions;
DELETE FROM amm_pool_metrics_hourly;

-- Show counts after cleanup
SELECT 
    'trades_unified' as table_name, 
    COUNT(*) as amm_records 
FROM trades_unified 
WHERE program = 'amm_pool'
UNION ALL
SELECT 
    'tokens_unified', 
    COUNT(*) 
FROM tokens_unified 
WHERE graduated_to_amm = true
UNION ALL
SELECT 
    'amm_pool_states', 
    COUNT(*) 
FROM amm_pool_states;
EOF

echo ""
echo "Database cleared. Ready to run AMM monitors."
echo ""
echo "Starting AMM test in 3 seconds..."
sleep 3

# Run the AMM test
npx tsx src/test-amm-fresh.ts