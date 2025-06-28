#!/bin/bash

# BC Monitor Quick Test (5 minutes)
# For rapid validation after code changes

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
TEST_DURATION=300  # 5 minutes
LOG_FILE="logs/bc-monitor-test/quick_test_$(date +%Y%m%d_%H%M%S).log"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}BC Monitor Quick Test (5 min)${NC}"
echo -e "${BLUE}================================${NC}"
echo -e "Start: ${GREEN}$(date +"%H:%M:%S")${NC}"
echo

# Create log directory
mkdir -p logs/bc-monitor-test

# Start monitor with manual timeout for macOS compatibility
echo "Starting monitor for 5 minutes..."
npm run bc-monitor 2>&1 | tee $LOG_FILE &
MONITOR_PID=$!

# Set up timer for manual timeout
(
    sleep $TEST_DURATION
    if ps -p $MONITOR_PID > /dev/null 2>&1; then
        echo -e "\n${YELLOW}Test duration reached, stopping monitor...${NC}"
        kill -SIGINT $MONITOR_PID
    fi
) &
TIMER_PID=$!

# Monitor key metrics every 30 seconds
for i in {1..10}; do
    sleep 30
    
    # Check if still running
    if ! ps -p $MONITOR_PID > /dev/null 2>&1; then
        echo -e "${RED}Monitor stopped unexpectedly!${NC}"
        break
    fi
    
    # Extract current stats
    echo -e "\n${YELLOW}[$(date +"%H:%M:%S")] ${i}0 seconds:${NC}"
    
    # Get latest statistics
    STATS=$(tail -n 100 $LOG_FILE | grep -A 20 "Transactions:" | head -20)
    if [ ! -z "$STATS" ]; then
        echo "$STATS" | grep -E "(Received:|Trades detected:|Above \$8,888:|Graduations:|errors:)" | head -5
    fi
    
    # Check for errors
    ERROR_COUNT=$(grep -c -i "error" $LOG_FILE 2>/dev/null || echo 0)
    if [ $ERROR_COUNT -gt 0 ]; then
        echo -e "  ${RED}Errors: $ERROR_COUNT${NC}"
    fi
    
    # Check for graduations
    GRAD_COUNT=$(grep -c "GRADUATION DETECTED" $LOG_FILE 2>/dev/null || echo 0)
    if [ $GRAD_COUNT -gt 0 ]; then
        echo -e "  ${GREEN}Graduations: $GRAD_COUNT${NC}"
    fi
done

# Wait for completion
wait $MONITOR_PID 2>/dev/null

# Clean up timer if still running
kill $TIMER_PID 2>/dev/null || true

# Final summary
echo -e "\n${BLUE}================================${NC}"
echo -e "${BLUE}Quick Test Summary${NC}"
echo -e "${BLUE}================================${NC}"

# Parse final results
TOTAL_TX=$(tail -n 200 $LOG_FILE | grep -oE "Received: [0-9,]+" | tail -1 | grep -oE "[0-9,]+" | tr -d ',' || echo 0)
TOTAL_TRADES=$(tail -n 200 $LOG_FILE | grep -oE "Trades detected: [0-9,]+" | tail -1 | grep -oE "[0-9,]+" | tr -d ',' || echo 0)
TOTAL_ERRORS=$(grep -c -i "error" $LOG_FILE 2>/dev/null || echo 0)
GRADUATIONS=$(grep -c "GRADUATION DETECTED" $LOG_FILE 2>/dev/null || echo 0)
UNIQUE_TOKENS=$(tail -n 200 $LOG_FILE | grep -oE "Unique tokens: [0-9,]+" | tail -1 | grep -oE "[0-9,]+" | tr -d ',' || echo 0)
THRESHOLD_TOKENS=$(tail -n 200 $LOG_FILE | grep -oE "Above \\\$8,888: [0-9,]+" | tail -1 | grep -oE "[0-9,]+" | tr -d ',' || echo 0)

# Calculate rates (using awk for compatibility)
TX_RATE=$(awk -v tx=$TOTAL_TX 'BEGIN {printf "%.1f", tx/5}' 2>/dev/null || echo "0")
TRADE_RATE=$(awk -v tr=$TOTAL_TRADES 'BEGIN {printf "%.1f", tr/5}' 2>/dev/null || echo "0")

echo -e "Duration: ${GREEN}5 minutes${NC}"
echo -e "Transactions: ${GREEN}$TOTAL_TX${NC} (~$TX_RATE/min)"
echo -e "Trades: ${GREEN}$TOTAL_TRADES${NC} (~$TRADE_RATE/min)"
echo -e "Unique Tokens: ${BLUE}$UNIQUE_TOKENS${NC}"
echo -e "Above \$8,888: ${YELLOW}$THRESHOLD_TOKENS${NC}"
echo -e "Graduations: ${GREEN}$GRADUATIONS${NC}"
echo -e "Errors: $([ $TOTAL_ERRORS -eq 0 ] && echo -e "${GREEN}$TOTAL_ERRORS${NC}" || echo -e "${RED}$TOTAL_ERRORS${NC}")"

# Performance check
if [ $TOTAL_TX -gt 0 ]; then
    DETECTION_RATE=$(awk -v tr=$TOTAL_TRADES -v tx=$TOTAL_TX 'BEGIN {printf "%.1f", tr*100/tx}' 2>/dev/null || echo "0")
    echo -e "Detection Rate: ${YELLOW}$DETECTION_RATE%${NC}"
fi

# Health check
echo -e "\n${BLUE}Health Check:${NC}"
if [ $TOTAL_ERRORS -eq 0 ] && [ $TOTAL_TX -gt 500 ]; then
    echo -e "${GREEN}✅ PASSED${NC} - No errors, good transaction volume"
elif [ $TOTAL_ERRORS -lt 10 ] && [ $TOTAL_TX -gt 300 ]; then
    echo -e "${YELLOW}⚠️  WARNING${NC} - Some errors detected, moderate volume"
else
    echo -e "${RED}❌ FAILED${NC} - Too many errors or low volume"
fi

# Notable events
echo -e "\n${BLUE}Notable Events:${NC}"
grep -E "(GRADUATION|Above \\\$8,888 threshold|Highest MC:)" $LOG_FILE | tail -5

echo -e "\n${GREEN}Test complete!${NC}"
echo -e "Log: ${YELLOW}$LOG_FILE${NC}"

# Create mini report
REPORT_FILE="logs/bc-monitor-test/quick_report_$(date +%Y%m%d_%H%M%S).txt"
cat > $REPORT_FILE << EOF
BC Monitor Quick Test Report
===========================
Date: $(date +"%Y-%m-%d %H:%M:%S")
Duration: 5 minutes

Results:
- Transactions: $TOTAL_TX (~$TX_RATE/min)
- Trades: $TOTAL_TRADES (~$TRADE_RATE/min)
- Unique Tokens: $UNIQUE_TOKENS
- Above Threshold: $THRESHOLD_TOKENS
- Graduations: $GRADUATIONS
- Errors: $TOTAL_ERRORS
- Detection Rate: ${DETECTION_RATE}%

Status: $([ $TOTAL_ERRORS -eq 0 ] && [ $TOTAL_TX -gt 500 ] && echo "PASSED" || echo "CHECK LOGS")
EOF

echo -e "Report: ${YELLOW}$REPORT_FILE${NC}"