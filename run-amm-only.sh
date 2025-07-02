#!/bin/bash

echo "======================================"
echo "AMM Monitors Only Test"
echo "======================================"
echo ""
echo "This will run ONLY the AMM monitors (no BC monitors)"
echo "Starting in 3 seconds..."
sleep 3

# Set environment to run only AMM monitors
export DISABLE_BC_MONITORS=true
export DISABLE_MONITOR_STATS=false
export DEBUG_AMM=true

# Run the main start script with AMM-only configuration
echo "Starting AMM monitors..."
npm run start