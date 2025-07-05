#!/bin/bash

# Smart Streaming Production Deployment Script
# This script handles the deployment of the smart streaming architecture

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOYMENT_MODE=${1:-"canary"}  # canary, gradual, or full
ROLLBACK_ON_ERROR=${ROLLBACK_ON_ERROR:-true}
CHECKPOINT_DIR="./checkpoints"
BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
LOG_FILE="./logs/deployment_$(date +%Y%m%d_%H%M%S).log"

# Create necessary directories
mkdir -p "$CHECKPOINT_DIR" "$BACKUP_DIR" "$(dirname "$LOG_FILE")"

# Logging function
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
}

# Progress indicator
show_progress() {
    local message=$1
    echo -ne "${BLUE}▶ ${message}...${NC}"
}

# Success indicator
show_success() {
    echo -e " ${GREEN}✓${NC}"
}

# Error handler
handle_error() {
    local exit_code=$1
    local error_message=$2
    
    echo -e " ${RED}✗${NC}"
    log "ERROR" "$error_message"
    
    if [ "$ROLLBACK_ON_ERROR" = true ]; then
        log "INFO" "Initiating rollback..."
        rollback
    fi
    
    exit $exit_code
}

# Pre-deployment checks
pre_deployment_checks() {
    show_progress "Running pre-deployment checks"
    
    # Check Node.js version
    node_version=$(node -v | cut -d'v' -f2)
    required_version="18.0.0"
    if [ "$(printf '%s\n' "$required_version" "$node_version" | sort -V | head -n1)" != "$required_version" ]; then
        handle_error 1 "Node.js version must be >= $required_version (current: $node_version)"
    fi
    
    # Check if build is successful
    npm run build > /dev/null 2>&1 || handle_error 1 "Build failed"
    
    # Check if tests pass
    npm run test > /dev/null 2>&1 || handle_error 1 "Tests failed"
    
    # Check database connection
    node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT 1').then(() => process.exit(0)).catch(() => process.exit(1));
    " || handle_error 1 "Database connection failed"
    
    # Check environment variables
    required_vars=("SHYFT_GRPC_ENDPOINT" "SHYFT_GRPC_TOKEN" "DATABASE_URL")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            handle_error 1 "Required environment variable $var is not set"
        fi
    done
    
    show_success
}

# Backup current state
create_backup() {
    show_progress "Creating backup"
    
    # Backup database schema and recent data
    pg_dump $DATABASE_URL \
        --schema-only \
        --file="$BACKUP_DIR/schema.sql" \
        2>/dev/null || handle_error 1 "Database schema backup failed"
    
    # Backup last 24 hours of data
    pg_dump $DATABASE_URL \
        --data-only \
        --table=tokens_unified \
        --table=trades_unified \
        --where="created_at > NOW() - INTERVAL '24 hours'" \
        --file="$BACKUP_DIR/recent_data.sql" \
        2>/dev/null || handle_error 1 "Database data backup failed"
    
    # Backup environment file
    cp .env "$BACKUP_DIR/.env.backup" 2>/dev/null || true
    
    # Create deployment snapshot
    cat > "$BACKUP_DIR/deployment_snapshot.json" <<EOF
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "mode": "$DEPLOYMENT_MODE",
    "git_commit": "$(git rev-parse HEAD)",
    "node_version": "$(node -v)",
    "npm_version": "$(npm -v)"
}
EOF
    
    show_success
}

# Update environment for smart streaming
update_environment() {
    show_progress "Updating environment configuration"
    
    # Create temporary env file
    cp .env .env.deployment_temp
    
    # Update smart streaming configuration
    case "$DEPLOYMENT_MODE" in
        "canary")
            echo "SMART_STREAMING_CANARY=0.25" >> .env.deployment_temp
            echo "USE_SMART_STREAMING=true" >> .env.deployment_temp
            ;;
        "gradual")
            echo "SMART_STREAMING_CANARY=0.50" >> .env.deployment_temp
            echo "USE_SMART_STREAMING=true" >> .env.deployment_temp
            ;;
        "full")
            echo "USE_SMART_STREAMING=true" >> .env.deployment_temp
            echo "POOL_MAX_CONNECTIONS=3" >> .env.deployment_temp
            echo "POOL_MIN_CONNECTIONS=2" >> .env.deployment_temp
            echo "FAULT_TOLERANCE_ENABLED=true" >> .env.deployment_temp
            ;;
    esac
    
    # Add performance optimization settings
    cat >> .env.deployment_temp <<EOF

# Smart Streaming Configuration
POOL_HEALTH_CHECK_INTERVAL=30000
POOL_CONNECTION_TIMEOUT=10000
POOL_MAX_RETRIES=3

# Fault Tolerance
CIRCUIT_BREAKER_THRESHOLD=3
RECOVERY_TIMEOUT=30000
CHECKPOINT_INTERVAL=60000
CHECKPOINT_DIR=$CHECKPOINT_DIR

# Performance Optimization
BATCH_SIZE=100
BATCH_TIMEOUT=500
CACHE_TTL_MULTIPLIER=1.5
EOF
    
    # Replace current env file
    mv .env.deployment_temp .env
    
    show_success
}

# Deploy application
deploy_application() {
    show_progress "Deploying application ($DEPLOYMENT_MODE mode)"
    
    # Stop current application gracefully
    if [ -f "app.pid" ]; then
        old_pid=$(cat app.pid)
        kill -SIGTERM $old_pid 2>/dev/null || true
        
        # Wait for graceful shutdown (max 30 seconds)
        timeout=30
        while [ $timeout -gt 0 ] && kill -0 $old_pid 2>/dev/null; do
            sleep 1
            ((timeout--))
        done
        
        if [ $timeout -eq 0 ]; then
            log "WARN" "Force killing old process"
            kill -SIGKILL $old_pid 2>/dev/null || true
        fi
    fi
    
    # Start new application
    nohup npm run start > "$LOG_FILE" 2>&1 &
    new_pid=$!
    echo $new_pid > app.pid
    
    # Wait for application to start
    sleep 5
    
    # Verify application is running
    if ! kill -0 $new_pid 2>/dev/null; then
        handle_error 1 "Application failed to start"
    fi
    
    show_success
}

# Health check
perform_health_check() {
    show_progress "Performing health check"
    
    # Check if API is responding
    max_attempts=10
    attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -s -f "http://localhost:3001/api/health" > /dev/null 2>&1; then
            break
        fi
        
        ((attempt++))
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        handle_error 1 "Health check failed - API not responding"
    fi
    
    # Check smart streaming metrics
    metrics=$(curl -s "http://localhost:3001/api/streaming/stats" 2>/dev/null)
    
    if [ -z "$metrics" ]; then
        handle_error 1 "Failed to retrieve streaming metrics"
    fi
    
    # Verify connection pool is healthy
    pool_health=$(echo "$metrics" | jq -r '.pool.healthyConnections // 0' 2>/dev/null)
    if [ "$pool_health" -eq 0 ]; then
        handle_error 1 "No healthy connections in pool"
    fi
    
    show_success
}

# Monitor deployment
monitor_deployment() {
    local duration=${1:-300}  # Default 5 minutes
    
    log "INFO" "Monitoring deployment for $duration seconds"
    
    local end_time=$(($(date +%s) + duration))
    local error_count=0
    local parse_rate_sum=0
    local check_count=0
    
    while [ $(date +%s) -lt $end_time ]; do
        # Get current metrics
        metrics=$(curl -s "http://localhost:3001/api/streaming/stats" 2>/dev/null)
        
        if [ -n "$metrics" ]; then
            # Extract key metrics
            parse_rate=$(echo "$metrics" | jq -r '.load.overallParseRate // 0' 2>/dev/null)
            error_rate=$(echo "$metrics" | jq -r '.errorRate // 0' 2>/dev/null)
            tps=$(echo "$metrics" | jq -r '.load.summary.totalTps // 0' 2>/dev/null)
            
            parse_rate_sum=$(echo "$parse_rate_sum + $parse_rate" | bc)
            ((check_count++))
            
            # Check for critical issues
            if (( $(echo "$parse_rate < 90" | bc -l) )); then
                ((error_count++))
                log "WARN" "Low parse rate detected: $parse_rate%"
            fi
            
            if (( $(echo "$error_rate > 0.05" | bc -l) )); then
                ((error_count++))
                log "WARN" "High error rate detected: $error_rate"
            fi
            
            # Log current status
            log "INFO" "Metrics - TPS: $tps, Parse Rate: $parse_rate%, Error Rate: $error_rate"
        fi
        
        sleep 10
    done
    
    # Calculate average parse rate
    if [ $check_count -gt 0 ]; then
        avg_parse_rate=$(echo "scale=2; $parse_rate_sum / $check_count" | bc)
        log "INFO" "Average parse rate during monitoring: $avg_parse_rate%"
        
        if (( $(echo "$avg_parse_rate < 95" | bc -l) )); then
            handle_error 1 "Average parse rate below threshold"
        fi
    fi
    
    if [ $error_count -gt 5 ]; then
        handle_error 1 "Too many errors during monitoring period"
    fi
    
    log "INFO" "Monitoring completed successfully"
}

# Rollback function
rollback() {
    log "INFO" "Starting rollback procedure"
    
    # Stop current application
    if [ -f "app.pid" ]; then
        kill -SIGTERM $(cat app.pid) 2>/dev/null || true
        rm app.pid
    fi
    
    # Restore environment
    if [ -f "$BACKUP_DIR/.env.backup" ]; then
        cp "$BACKUP_DIR/.env.backup" .env
        log "INFO" "Environment restored"
    fi
    
    # Start with old configuration
    export USE_SMART_STREAMING=false
    nohup npm run start > "$LOG_FILE" 2>&1 &
    echo $! > app.pid
    
    log "INFO" "Rollback completed"
}

# Finalize deployment
finalize_deployment() {
    show_progress "Finalizing deployment"
    
    # Update deployment status
    cat > ./deployment_status.json <<EOF
{
    "status": "success",
    "mode": "$DEPLOYMENT_MODE",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "version": "$(git rev-parse HEAD)"
}
EOF
    
    # Clean up old checkpoints (keep last 10)
    if [ -d "$CHECKPOINT_DIR" ]; then
        ls -t "$CHECKPOINT_DIR" | tail -n +11 | xargs -I {} rm -f "$CHECKPOINT_DIR/{}"
    fi
    
    show_success
}

# Main deployment flow
main() {
    echo -e "${GREEN}Smart Streaming Deployment Script${NC}"
    echo -e "${YELLOW}Mode: $DEPLOYMENT_MODE${NC}"
    echo ""
    
    log "INFO" "Starting deployment in $DEPLOYMENT_MODE mode"
    
    # Execute deployment steps
    pre_deployment_checks
    create_backup
    update_environment
    deploy_application
    perform_health_check
    
    # Different monitoring durations based on mode
    case "$DEPLOYMENT_MODE" in
        "canary")
            monitor_deployment 600  # 10 minutes for canary
            ;;
        "gradual")
            monitor_deployment 300  # 5 minutes for gradual
            ;;
        "full")
            monitor_deployment 180  # 3 minutes for full
            ;;
    esac
    
    finalize_deployment
    
    echo ""
    echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
    log "INFO" "Deployment completed successfully"
    
    # Show next steps
    echo ""
    echo "Next steps:"
    case "$DEPLOYMENT_MODE" in
        "canary")
            echo "  - Monitor metrics at http://localhost:3001/streaming-metrics.html"
            echo "  - If stable after 24 hours, run: ./scripts/deploy-smart-streaming.sh gradual"
            ;;
        "gradual")
            echo "  - Continue monitoring for 12 hours"
            echo "  - If stable, run: ./scripts/deploy-smart-streaming.sh full"
            ;;
        "full")
            echo "  - Smart streaming is now fully deployed"
            echo "  - Monitor dashboard: http://localhost:3001"
            echo "  - Check metrics: http://localhost:3001/streaming-metrics.html"
            ;;
    esac
}

# Run main function
main