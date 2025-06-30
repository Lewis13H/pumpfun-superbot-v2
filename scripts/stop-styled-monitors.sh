#!/bin/bash

# Stop all styled monitors gracefully

echo "🛑 Stopping all styled monitors..."
echo "═══════════════════════════════════════════════════"
echo ""

if [ -f .monitor_pids ]; then
    while read pid; do
        if ps -p $pid > /dev/null 2>&1; then
            echo "Stopping monitor with PID: $pid"
            kill -SIGINT $pid 2>/dev/null
        fi
    done < .monitor_pids
    
    # Give monitors time to shut down gracefully
    sleep 2
    
    # Force kill any remaining processes
    while read pid; do
        if ps -p $pid > /dev/null 2>&1; then
            echo "Force stopping PID: $pid"
            kill -9 $pid 2>/dev/null
        fi
    done < .monitor_pids
    
    rm -f .monitor_pids
    echo ""
    echo "✅ All monitors stopped"
else
    echo "⚠️  No monitor PIDs found. Monitors may not be running."
fi

echo "═══════════════════════════════════════════════════"