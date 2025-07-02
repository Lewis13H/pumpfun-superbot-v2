#!/bin/bash

echo "==================================="
echo "AMM Monitors Accuracy Test"
echo "==================================="
echo ""
echo "This test will:"
echo "- Run ONLY the AMM transaction and account monitors"
echo "- Capture 50+ trades"
echo "- Extract 4 sample trades (2 buy, 2 sell)"
echo "- Compare parsed data with Solscan/pump.fun"
echo "- Generate accuracy report with evidence"
echo ""
echo "Starting in 3 seconds..."
sleep 3

# Clear previous test results
mkdir -p test-results
rm -f test-results/AMM_ACCURACY_ANALYSIS.md
rm -f test-results/amm-test-raw-data.json

# Run the test
echo ""
echo "Running AMM monitors..."
npx tsx src/test-amm-only.ts

echo ""
echo "Test complete! Check test-results/ directory for:"
echo "- AMM_ACCURACY_ANALYSIS.md - Detailed accuracy report"
echo "- amm-test-raw-data.json - Raw captured data"