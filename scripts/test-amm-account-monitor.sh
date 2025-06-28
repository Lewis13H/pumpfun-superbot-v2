#!/bin/bash
# Test AMM account monitor for 30 seconds

echo "Testing AMM account monitor for 30 seconds..."
echo "Press Ctrl+C to stop early"
echo ""

# Run the monitor with a timeout
timeout 30 npm run amm-account-monitor || true

echo ""
echo "Test completed!"