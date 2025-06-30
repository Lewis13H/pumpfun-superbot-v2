#!/bin/bash
# Wrapped Monitoring Setup
# Uses refactored BC monitors + wrapped AMM monitors

echo "🚀 Starting Wrapped Monitoring System"
echo "═══════════════════════════════════"
echo "Using: Refactored BC monitors + Wrapped AMM monitors"
echo ""

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

# Create logs directory
mkdir -p logs

# Kill any existing monitors
echo -e "${YELLOW}Stopping any existing monitors...${NC}"
pkill -f "tsx.*monitor" 2>/dev/null
pkill -f "node.*monitor" 2>/dev/null
sleep 2

# Start the wrapped monitoring system
echo -e "\n${BLUE}Starting Wrapped Monitoring System...${NC}"
npm run start-wrapped > logs/wrapped-monitors.log 2>&1 &

sleep 5

# Start additional services
echo -e "\n${YELLOW}Starting Additional Services:${NC}"
echo "────────────────────────"

# 1. API Server (Dashboard)
echo -e "${BLUE}Starting API Server & Dashboard...${NC}"
npm run dashboard > logs/dashboard.log 2>&1 &
sleep 3
if check_process "api/server-unified" "API Server"; then
    echo -e "${GREEN}✓${NC} API Server started successfully"
else
    echo -e "${RED}✗${NC} Failed to start API Server"
fi

# 2. DexScreener Recovery
echo -e "\n${BLUE}Starting DexScreener Recovery Service...${NC}"
tsx scripts/start-dexscreener-recovery.ts > logs/dexscreener-recovery.log 2>&1 &
sleep 2
if check_process "dexscreener-recovery" "DexScreener Recovery"; then
    echo -e "${GREEN}✓${NC} DexScreener Recovery started successfully"
else
    echo -e "${RED}✗${NC} Failed to start DexScreener Recovery"
fi

# 3. Auto Enricher Service
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

check_process "start-wrapped" "Wrapped Monitors"
check_process "api/server-unified" "API Server"
check_process "dexscreener-recovery" "DexScreener Recovery"
check_process "auto-enricher" "Auto Enricher"

echo -e "\n${YELLOW}Monitor Architecture:${NC}"
echo "────────────────────────"
echo "✓ BC Monitor: Refactored (DI + Events)"
echo "✓ BC Account Monitor: Refactored (DI + Events)"
echo "✓ AMM Monitor: Wrapped Legacy (proven logic)"
echo "✓ AMM Account Monitor: Wrapped Legacy (proven logic)"
echo "✓ All monitors emit events through unified EventBus"
echo "✓ Graduation handler tracks BC → mint mappings"

echo -e "\n${YELLOW}Useful Commands:${NC}"
echo "────────────────────────"
echo "View logs:        tail -f logs/wrapped-monitors.log"
echo "Dashboard:        http://localhost:3001"
echo "Stop all:         pkill -f 'tsx|node'"
echo "Check database:   npm run query-trades"
echo "Test monitors:    tsx scripts/test-wrapped-monitors.ts"

echo -e "\n${GREEN}✓ Wrapped monitoring system is running!${NC}"