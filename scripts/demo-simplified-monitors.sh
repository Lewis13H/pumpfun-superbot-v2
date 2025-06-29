#!/bin/bash

# Demo script to show standardized monitor outputs
# Each monitor runs for 30 seconds to show the consistent formatting

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  STANDARDIZED MONITOR OUTPUT DEMO"
echo "  Showing consistent terminal formatting across all 4 monitors"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# Function to run a monitor for 30 seconds
run_monitor() {
    local name=$1
    local command=$2
    echo ""
    echo "▶️  Starting $name (30 second demo)..."
    echo "─────────────────────────────────────────────────────────────────────────────"
    timeout 30 $command 2>&1 || true
    echo ""
    echo "✅ $name demo complete"
    echo ""
    sleep 2
}

# Set error display
export DEBUG_ERRORS=true

# 1. BC Trade Monitor
run_monitor "BC TRADE MONITOR" "npm run bc-monitor-simple"

# 2. BC Account Monitor  
run_monitor "BC ACCOUNT MONITOR" "npm run bc-account-simple"

# 3. AMM Trade Monitor
run_monitor "AMM TRADE MONITOR" "npm run amm-monitor-simple"

# 4. AMM Account Monitor
run_monitor "AMM ACCOUNT MONITOR" "npm run amm-account-simple"

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  DEMO COMPLETE"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Key Features of Standardized Output:"
echo "• Consistent header format with program ID and configuration"
echo "• Unified status messages (✅ success, ❌ error, ⚠️ warning, ℹ️ info)"
echo "• Clear trade/account update formatting"
echo "• Real-time statistics display every 10 seconds"
echo "• Error logging enabled with DEBUG_ERRORS=true"
echo ""