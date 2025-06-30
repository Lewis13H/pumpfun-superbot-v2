#!/bin/bash
# Complete Monitoring Setup with DexScreener Recovery
# Runs all 4 monitors + SOL price updater + DexScreener recovery

echo "🚀 Starting Complete Monitoring System"
echo "═══════════════════════════════════"

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if a process is running
check_process() {
    if pgrep -f "$1" > /dev/null; then
        echo -e "${GREEN}✓${NC} $2 is running"
        return 0
    else
        echo -e "${RED}✗${NC} $2 is not running"
        return 1
    fi
}

# Function to start a monitor
start_monitor() {
    echo -e "${BLUE}Starting $2...${NC}"
    npm run $1 > logs/$1.log 2>&1 &
    sleep 3
    if check_process "$1" "$2"; then
        echo -e "${GREEN}✓${NC} $2 started successfully"
    else
        echo -e "${RED}✗${NC} Failed to start $2"
        echo "Check logs/$1.log for errors"
    fi
}

# Create logs directory
mkdir -p logs

# Start services
echo -e "\n${YELLOW}Starting Core Services:${NC}"
echo "────────────────────────"

# 1. SOL Price Updater
start_monitor "sol-price-updater" "SOL Price Updater"

# 2. API Server (Dashboard)
start_monitor "dashboard" "API Server & Dashboard"

echo -e "\n${YELLOW}Starting Monitors:${NC}"
echo "────────────────────────"

# 3. BC Monitor
start_monitor "bc-monitor" "BC Trade Monitor"

# 4. BC Account Monitor
start_monitor "bc-account-monitor" "BC Account Monitor"

# 5. AMM Monitor
start_monitor "amm-monitor" "AMM Trade Monitor"

# 6. AMM Account Monitor
start_monitor "amm-account-monitor" "AMM Account Monitor"

# 7. DexScreener Recovery (via script)
echo -e "\n${BLUE}Starting DexScreener Recovery Service...${NC}"
tsx scripts/start-dexscreener-recovery.ts > logs/dexscreener-recovery.log 2>&1 &
sleep 2
if check_process "dexscreener-recovery" "DexScreener Recovery"; then
    echo -e "${GREEN}✓${NC} DexScreener Recovery started successfully"
else
    echo -e "${RED}✗${NC} Failed to start DexScreener Recovery"
fi

# 8. Auto Enricher Service
echo -e "\n${BLUE}Starting Auto Enricher Service...${NC}"
tsx scripts/start-auto-enricher.ts > logs/auto-enricher.log 2>&1 &
sleep 2
if check_process "auto-enricher" "Auto Enricher"; then
    echo -e "${GREEN}✓${NC} Auto Enricher started successfully"
else
    echo -e "${RED}✗${NC} Failed to start Auto Enricher"
fi

# Summary
echo -e "\n${YELLOW}═══════════════════════════════════${NC}"
echo -e "${GREEN}System Status:${NC}"
echo "────────────────────────"

check_process "sol-price-updater" "SOL Price Updater"
check_process "api/server-unified" "API Server"
check_process "bc-monitor" "BC Monitor"
check_process "bc-account-monitor" "BC Account Monitor"
check_process "amm-monitor" "AMM Monitor"
check_process "amm-account-monitor" "AMM Account Monitor"
check_process "dexscreener-recovery" "DexScreener Recovery"
check_process "auto-enricher" "Auto Enricher"

echo -e "\n${YELLOW}Useful Commands:${NC}"
echo "────────────────────────"
echo "View logs:        tail -f logs/*.log"
echo "Dashboard:        http://localhost:3001"
echo "Stop all:         pkill -f 'tsx|node'"
echo "Check database:   npm run query-trades"

echo -e "\n${GREEN}✓ Complete monitoring system is running!${NC}"