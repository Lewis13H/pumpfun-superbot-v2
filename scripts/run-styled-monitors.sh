#!/bin/bash

# Run all 4 styled monitors with consistent terminal display
# This script helps evaluate performance during extended runs

echo "🚀 Starting all styled monitors..."
echo "═══════════════════════════════════════════════════"
echo ""

# Create logs directory if it doesn't exist
mkdir -p logs/styled-monitors

# Get current timestamp for log files
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Function to run a monitor in background
run_monitor() {
    local name=$1
    local script=$2
    local log_file="logs/styled-monitors/${name}_${TIMESTAMP}.log"
    
    echo "▶️  Starting $name..."
    npm run $script > "$log_file" 2>&1 &
    local pid=$!
    echo "   PID: $pid | Log: $log_file"
    echo $pid >> .monitor_pids
}

# Clean up any existing PID file
rm -f .monitor_pids

# Start all monitors
run_monitor "BC-Monitor" "bc-monitor-styled"
run_monitor "BC-Account-Monitor" "bc-account-monitor-styled"
run_monitor "AMM-Monitor" "amm-monitor-styled"
run_monitor "AMM-Account-Monitor" "amm-account-monitor-styled"

echo ""
echo "═══════════════════════════════════════════════════"
echo "✅ All monitors started!"
echo ""
echo "📊 View logs:"
echo "   tail -f logs/styled-monitors/*_${TIMESTAMP}.log"
echo ""
echo "🛑 Stop all monitors:"
echo "   ./scripts/stop-styled-monitors.sh"
echo ""
echo "═══════════════════════════════════════════════════"