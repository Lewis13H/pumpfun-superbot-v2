#!/bin/bash

# Test Script for Phase 6: New Token Detection
# Tests the bc-monitor's ability to detect and enrich new tokens

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}==================================${NC}"
echo -e "${BLUE}Phase 6: New Token Detection Test${NC}"
echo -e "${BLUE}==================================${NC}"
echo

# Test duration (2 minutes for quick test)
TEST_DURATION=${1:-120}
echo -e "${YELLOW}Test Duration: ${TEST_DURATION} seconds${NC}"
echo

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check environment
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}ERROR: DATABASE_URL not set${NC}"
    echo -e "${YELLOW}Please ensure .env file exists with DATABASE_URL${NC}"
    exit 1
fi

# Start time
START_TIME=$(date +%s)
echo -e "${GREEN}Starting test at $(date)${NC}"
echo

# Run the monitor and capture output
echo -e "${YELLOW}Running bc-monitor with new token detection...${NC}"
OUTPUT_FILE="logs/phase6-test-$(date +%Y%m%d_%H%M%S).log"
mkdir -p logs

# Run monitor in background
npm run bc-monitor 2>&1 | tee "$OUTPUT_FILE" &
MONITOR_PID=$!

# Set up timer for test duration
(
    sleep $TEST_DURATION
    if ps -p $MONITOR_PID > /dev/null 2>&1; then
        echo -e "\n${YELLOW}Test duration reached, stopping monitor...${NC}"
        kill -SIGINT $MONITOR_PID
    fi
) &
TIMER_PID=$!

# Wait for monitor to finish
wait $MONITOR_PID

# Kill timer if still running
kill $TIMER_PID 2>/dev/null

# Analyze results
echo -e "\n${BLUE}==================================${NC}"
echo -e "${BLUE}Test Results Analysis${NC}"
echo -e "${BLUE}==================================${NC}"

# Extract statistics from log
echo -e "\n${YELLOW}New Token Detection Stats:${NC}"
NEW_TOKENS=$(grep -c "NEW TOKEN DETECTED" "$OUTPUT_FILE" || echo "0")
echo -e "New tokens detected: ${GREEN}${NEW_TOKENS}${NC}"

# Extract creator stats
UNIQUE_CREATORS=$(grep "Unique creators:" "$OUTPUT_FILE" | tail -1 | awk '{print $3}' || echo "0")
echo -e "Unique creators: ${BLUE}${UNIQUE_CREATORS}${NC}"

# Extract enrichment stats
TOKENS_ENRICHED=$(grep "Tokens enriched:" "$OUTPUT_FILE" | tail -1 | awk '{print $3}' || echo "0")
echo -e "Tokens enriched: ${YELLOW}${TOKENS_ENRICHED}${NC}"

# Check for risk assessments
echo -e "\n${YELLOW}Risk Assessment Summary:${NC}"
NO_METADATA=$(grep -c "No metadata" "$OUTPUT_FILE" || echo "0")
echo -e "Tokens without metadata: ${RED}${NO_METADATA}${NC}"

SUSPICIOUS=$(grep -c "SUSPICIOUS" "$OUTPUT_FILE" || echo "0")
echo -e "Suspicious creators: ${RED}${SUSPICIOUS}${NC}"

# Extract creator reputation distribution
echo -e "\n${YELLOW}Creator Reputation Distribution:${NC}"
NEW_CREATORS=$(grep -c "Reputation: NEW" "$OUTPUT_FILE" || echo "0")
REGULAR_CREATORS=$(grep -c "Reputation: REGULAR" "$OUTPUT_FILE" || echo "0")
PROLIFIC_CREATORS=$(grep -c "Reputation: PROLIFIC" "$OUTPUT_FILE" || echo "0")

echo -e "NEW creators: ${BLUE}${NEW_CREATORS}${NC}"
echo -e "REGULAR creators: ${GREEN}${REGULAR_CREATORS}${NC}"
echo -e "PROLIFIC creators: ${YELLOW}${PROLIFIC_CREATORS}${NC}"

# Check database for new tokens
echo -e "\n${YELLOW}Database Verification:${NC}"
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Query recent tokens from database
DB_RESULT=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(DISTINCT mint_address) as new_tokens
    FROM tokens_unified
    WHERE created_at >= NOW() - INTERVAL '${DURATION} seconds'
" 2>/dev/null || echo "0")

echo -e "New tokens in database: ${GREEN}${DB_RESULT}${NC}"

# Check for graduations
echo -e "\n${YELLOW}Graduation Events:${NC}"
GRADUATIONS=$(grep -c "GRADUATION DETECTED" "$OUTPUT_FILE" || echo "0")
echo -e "Graduations detected: ${GREEN}${GRADUATIONS}${NC}"

# Performance metrics
echo -e "\n${YELLOW}Performance Metrics:${NC}"
TOTAL_TX=$(grep "Transactions:" "$OUTPUT_FILE" | tail -1 | grep -oE "[0-9]+" | tail -1 || echo "0")
TRADES_DETECTED=$(grep "Trades detected:" "$OUTPUT_FILE" | tail -1 | grep -oE "[0-9]+" | tail -1 || echo "0")
PARSE_ERRORS=$(grep "Parse errors:" "$OUTPUT_FILE" | tail -1 | grep -oE "[0-9]+" | tail -1 || echo "0")

echo -e "Total transactions: ${YELLOW}${TOTAL_TX}${NC}"
echo -e "Trades detected: ${GREEN}${TRADES_DETECTED}${NC}"
echo -e "Parse errors: ${RED}${PARSE_ERRORS}${NC}"

# Calculate rates
if [ "$DURATION" -gt 0 ]; then
    NEW_TOKENS_RATE=$(awk -v tokens=$NEW_TOKENS -v duration=$DURATION 'BEGIN {printf "%.2f", tokens*60/duration}')
    echo -e "\n${YELLOW}Detection Rates:${NC}"
    echo -e "New tokens per minute: ${GREEN}${NEW_TOKENS_RATE}${NC}"
fi

# Summary
echo -e "\n${BLUE}==================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}==================================${NC}"

if [ "$NEW_TOKENS" -gt 0 ]; then
    echo -e "${GREEN}✅ Phase 6 New Token Detection: WORKING${NC}"
    echo -e "   - Detected ${NEW_TOKENS} new tokens"
    echo -e "   - Enriched ${TOKENS_ENRICHED} tokens"
    echo -e "   - Tracked ${UNIQUE_CREATORS} unique creators"
    
    if [ "$NO_METADATA" -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Found ${NO_METADATA} tokens without metadata${NC}"
    fi
else
    echo -e "${RED}❌ No new tokens detected during test${NC}"
fi

echo -e "\n${GREEN}Log file saved to: ${OUTPUT_FILE}${NC}"

# Show sample of new token detections
if [ "$NEW_TOKENS" -gt 0 ]; then
    echo -e "\n${YELLOW}Sample New Token Detections:${NC}"
    grep -A 5 "NEW TOKEN DETECTED" "$OUTPUT_FILE" | head -20
fi

echo -e "\n${GREEN}Test completed at $(date)${NC}"