#!/bin/bash

# Session 10 Test Runner
# Runs all tests for the smart streaming migration

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Session 10: Migration & Testing ===${NC}"
echo ""

# Function to run test suite
run_test_suite() {
    local suite=$1
    local description=$2
    
    echo -e "${YELLOW}Running ${description}...${NC}"
    
    if npm run test:$suite > /tmp/test_$suite.log 2>&1; then
        echo -e "${GREEN}✓ ${description} passed${NC}"
        return 0
    else
        echo -e "${RED}✗ ${description} failed${NC}"
        echo "  See /tmp/test_$suite.log for details"
        return 1
    fi
}

# Check environment
echo -e "${BLUE}Checking environment...${NC}"

# Verify required environment variables
required_vars=("SHYFT_GRPC_ENDPOINT" "SHYFT_GRPC_TOKEN" "DATABASE_URL")
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=($var)
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo -e "${RED}Missing required environment variables:${NC}"
    printf '%s\n' "${missing_vars[@]}"
    exit 1
fi

echo -e "${GREEN}✓ Environment configured${NC}"
echo ""

# Build the project
echo -e "${BLUE}Building project...${NC}"
if npm run build > /tmp/build.log 2>&1; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    cat /tmp/build.log
    exit 1
fi
echo ""

# Run unit tests
echo -e "${BLUE}Running unit tests...${NC}"

# Create test configuration
cat > vitest.config.ts << 'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': './src'
    }
  }
});
EOF

# Run individual unit test suites
test_results=0

echo -e "${YELLOW}Unit Tests:${NC}"
npx vitest run src/tests/unit/connection-pool.test.ts --reporter=verbose || ((test_results++))
npx vitest run src/tests/unit/fault-tolerant-manager.test.ts --reporter=verbose || ((test_results++))
npx vitest run src/tests/unit/performance-optimizer.test.ts --reporter=verbose || ((test_results++))

if [ $test_results -eq 0 ]; then
    echo -e "${GREEN}✓ All unit tests passed${NC}"
else
    echo -e "${RED}✗ ${test_results} unit test suites failed${NC}"
fi
echo ""

# Run integration tests
echo -e "${BLUE}Running integration tests...${NC}"
echo -e "${YELLOW}Integration Tests:${NC}"

npx vitest run src/tests/integration/domain-monitors.test.ts --reporter=verbose || ((test_results++))

if [ $test_results -eq 0 ]; then
    echo -e "${GREEN}✓ Integration tests passed${NC}"
else
    echo -e "${RED}✗ Integration tests failed${NC}"
fi
echo ""

# Run load tests (optional - can be slow)
if [ "$RUN_LOAD_TESTS" = "true" ]; then
    echo -e "${BLUE}Running load tests...${NC}"
    echo -e "${YELLOW}Load Tests:${NC}"
    
    npx vitest run src/tests/load/connection-pool-load.test.ts --reporter=verbose || ((test_results++))
    
    if [ $test_results -eq 0 ]; then
        echo -e "${GREEN}✓ Load tests passed${NC}"
    else
        echo -e "${RED}✗ Load tests failed${NC}"
    fi
    echo ""
fi

# Test deployment script
echo -e "${BLUE}Testing deployment script...${NC}"

if [ -x "./scripts/deploy-smart-streaming.sh" ]; then
    echo -e "${GREEN}✓ Deployment script is executable${NC}"
    
    # Dry run deployment script
    if bash -n ./scripts/deploy-smart-streaming.sh 2>/dev/null; then
        echo -e "${GREEN}✓ Deployment script syntax is valid${NC}"
    else
        echo -e "${RED}✗ Deployment script has syntax errors${NC}"
        ((test_results++))
    fi
else
    echo -e "${RED}✗ Deployment script not found or not executable${NC}"
    ((test_results++))
fi
echo ""

# Test smart streaming configuration
echo -e "${BLUE}Testing smart streaming configuration...${NC}"

# Create test script
cat > /tmp/test-smart-streaming-config.ts << 'EOF'
import { SmartStreamManager } from './src/services/core/smart-stream-manager';
import { EventBus } from './src/core/event-bus';

async function testConfig() {
  const eventBus = new EventBus();
  
  try {
    const manager = new SmartStreamManager({
      eventBus,
      poolConfig: {
        grpcEndpoint: process.env.SHYFT_GRPC_ENDPOINT || '',
        grpcToken: process.env.SHYFT_GRPC_TOKEN || '',
        maxConnections: 2,
        minConnections: 1,
        connectionTimeout: 5000,
        healthCheckInterval: 30000,
        maxRetries: 3
      }
    });
    
    console.log('✓ Smart streaming configuration is valid');
    process.exit(0);
  } catch (error) {
    console.error('✗ Smart streaming configuration error:', error);
    process.exit(1);
  }
}

testConfig();
EOF

if npx tsx /tmp/test-smart-streaming-config.ts > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Smart streaming configuration is valid${NC}"
else
    echo -e "${RED}✗ Smart streaming configuration failed${NC}"
    ((test_results++))
fi
echo ""

# Summary
echo -e "${BLUE}=== Test Summary ===${NC}"
if [ $test_results -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "The smart streaming architecture is ready for deployment."
    echo ""
    echo "Next steps:"
    echo "1. Review the migration plan: docs/SMART_STREAMING_MIGRATION_PLAN.md"
    echo "2. Start canary deployment: ./scripts/deploy-smart-streaming.sh canary"
    echo "3. Monitor metrics at: http://localhost:3001/streaming-metrics.html"
else
    echo -e "${RED}❌ ${test_results} test failures detected${NC}"
    echo ""
    echo "Please fix the failing tests before proceeding with deployment."
    exit 1
fi

# Clean up
rm -f /tmp/test-smart-streaming-config.ts vitest.config.ts