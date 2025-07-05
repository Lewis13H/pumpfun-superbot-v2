#!/bin/bash

# Clear previous logs
rm -f amm-tx-monitor.log amm-account-monitor.log

# Start AMM monitors in background
echo "Starting AMM transaction monitor..."
npm run amm-monitor > amm-tx-monitor.log 2>&1 &
AMM_TX_PID=$!

echo "Starting AMM account monitor..."
npm run amm-account-monitor > amm-account-monitor.log 2>&1 &
AMM_ACCOUNT_PID=$!

echo "Monitors started with PIDs: $AMM_TX_PID (tx), $AMM_ACCOUNT_PID (account)"
echo "Running for 5 minutes..."

# Wait for 5 minutes
sleep 300

# Kill the monitors
echo "Stopping monitors..."
kill $AMM_TX_PID $AMM_ACCOUNT_PID 2>/dev/null

echo "Done. Check amm-tx-monitor.log and amm-account-monitor.log for output"