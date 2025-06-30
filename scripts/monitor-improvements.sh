#!/bin/bash

# BC Monitor Improvements Runner
# Easy-to-use script for running the improved monitor with different configurations

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default values
DEFAULT_THRESHOLD=8888
DEFAULT_SAVE_ALL=false
DEFAULT_DEBUG=false

# Function to display usage
usage() {
    echo -e "${BLUE}BC Monitor Quick Fix Runner${NC}"
    echo -e "${BLUE}===========================${NC}"
    echo
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -t, --threshold VALUE    Set save threshold (default: $DEFAULT_THRESHOLD)"
    echo "  -a, --save-all          Save all tokens regardless of threshold"
    echo "  -d, --debug             Enable debug logging for parse errors"
    echo "  -w, --watch             Watch mode - only show rates and stats"
    echo "  -h, --help              Show this help message"
    echo
    echo "Examples:"
    echo "  $0                      # Run with defaults"
    echo "  $0 -t 5000              # Save tokens above \$5,000"
    echo "  $0 -a -d                # Save all tokens with debug logging"
    echo "  $0 -w                   # Watch mode - minimal output"
    echo
}

# Parse command line arguments
THRESHOLD=$DEFAULT_THRESHOLD
SAVE_ALL=$DEFAULT_SAVE_ALL
DEBUG=$DEFAULT_DEBUG
WATCH_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        -a|--save-all)
            SAVE_ALL=true
            shift
            ;;
        -d|--debug)
            DEBUG=true
            shift
            ;;
        -w|--watch)
            WATCH_MODE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

# Display configuration
echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}BC Monitor Quick Fix${NC}"
echo -e "${BLUE}================================${NC}"
echo -e "Save Threshold: ${YELLOW}\$$THRESHOLD${NC}"
echo -e "Save All Tokens: ${YELLOW}$SAVE_ALL${NC}"
echo -e "Debug Mode: ${YELLOW}$DEBUG${NC}"
echo -e "Watch Mode: ${YELLOW}$WATCH_MODE${NC}"
echo

# Export environment variables
export BC_SAVE_THRESHOLD=$THRESHOLD
export SAVE_ALL_TOKENS=$SAVE_ALL
export DEBUG_PARSE_ERRORS=$DEBUG

# Run the monitor
if [ "$WATCH_MODE" = true ]; then
    echo -e "${GREEN}Starting monitor in watch mode...${NC}"
    echo -e "${YELLOW}Showing only parse rates, save rates, and statistics${NC}"
    echo
    npm run bc-monitor-watch
else
    echo -e "${GREEN}Starting monitor with full output...${NC}"
    echo
    npm run bc-monitor
fi