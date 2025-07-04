# PumpFun Superbot v2 - Complete Setup Guide

This guide will walk you through setting up the PumpFun Superbot v2 system on a new computer.

## Prerequisites

### 1. System Requirements
- **OS**: macOS, Linux, or Windows (with WSL2)
- **RAM**: Minimum 8GB (16GB recommended for production)
- **Storage**: At least 20GB free space
- **CPU**: Multi-core processor recommended

### 2. Required Software

#### Install Node.js (v18 or higher)
```bash
# macOS (using Homebrew)
brew install node

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v18.x.x or higher
npm --version
```

#### Install PostgreSQL (v14 or higher)
```bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql

# Verify installation
psql --version
```

#### Install Git
```bash
# macOS
brew install git

# Ubuntu/Debian
sudo apt install git

# Verify installation
git --version
```

#### Install ripgrep (for better search)
```bash
# macOS
brew install ripgrep

# Ubuntu/Debian
sudo apt install ripgrep

# Verify installation
rg --version
```

## Installation Steps

### 1. Clone the Repository
```bash
# Clone the repository
git clone https://github.com/Lewis13H/pumpfun-superbot-v2.git
cd pumpfun-superbot-v2

# Or if you have SSH set up
git clone git@github.com:Lewis13H/pumpfun-superbot-v2.git
cd pumpfun-superbot-v2
```

### 2. Install Dependencies
```bash
# Install all npm packages
npm install

# If you encounter errors, try:
npm install --legacy-peer-deps
```

### 3. Database Setup

#### Create PostgreSQL Database
```bash
# Connect to PostgreSQL as superuser
sudo -u postgres psql

# Or on macOS
psql postgres

# Create database and user
CREATE DATABASE pump_monitor;
CREATE USER pump_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE pump_monitor TO pump_user;
\q
```

#### Run Database Migrations
```bash
# Create tables using the SQL file
psql -U pump_user -d pump_monitor -f db/schema.sql

# Or if the schema.sql doesn't exist, create it first
mkdir -p db
cat > db/schema.sql << 'EOF'
-- See below for complete schema
EOF
```

#### Complete Database Schema
```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tokens table
CREATE TABLE IF NOT EXISTS tokens_unified (
    mint_address VARCHAR(50) PRIMARY KEY,
    symbol VARCHAR(50),
    name VARCHAR(255),
    uri VARCHAR(500),
    image_uri VARCHAR(500),
    description TEXT,
    creator VARCHAR(50),
    creation_slot BIGINT,
    telegram VARCHAR(100),
    twitter VARCHAR(100),
    website VARCHAR(255),
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    first_program VARCHAR(20),
    current_program VARCHAR(20),
    graduated_to_amm BOOLEAN DEFAULT FALSE,
    graduation_at TIMESTAMP WITH TIME ZONE,
    threshold_crossed_at TIMESTAMP WITH TIME ZONE,
    metadata_updated_at TIMESTAMP WITH TIME ZONE,
    enrichment_attempts INTEGER DEFAULT 0,
    metadata_source VARCHAR(50),
    token_created_at TIMESTAMP WITH TIME ZONE,
    is_enriched BOOLEAN DEFAULT FALSE,
    is_stale BOOLEAN DEFAULT FALSE,
    stale_marked_at TIMESTAMP WITH TIME ZONE,
    latest_price_sol DECIMAL(30, 15),
    latest_price_usd DECIMAL(30, 15),
    latest_market_cap_usd DECIMAL(30, 15),
    latest_bonding_curve_progress DECIMAL(5, 2),
    volume_24h_usd DECIMAL(30, 15),
    holder_count INTEGER,
    top_holder_percentage DECIMAL(5, 2),
    total_trades INTEGER,
    unique_traders_24h INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades_unified (
    signature VARCHAR(150) PRIMARY KEY,
    slot BIGINT,
    timestamp TIMESTAMP WITH TIME ZONE,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    program VARCHAR(20),
    trade_type VARCHAR(10),
    user_address VARCHAR(50),
    sol_amount DECIMAL(30, 0),
    token_amount DECIMAL(30, 0),
    price_sol DECIMAL(30, 15),
    price_usd DECIMAL(30, 15),
    market_cap_usd DECIMAL(30, 15),
    bonding_curve_progress DECIMAL(5, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_program CHECK (program IN ('bonding_curve', 'amm_pool'))
);

-- AMM Pool Metrics
CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    hour TIMESTAMP WITH TIME ZONE,
    volume_sol DECIMAL(30, 15),
    volume_usd DECIMAL(30, 15),
    liquidity_sol DECIMAL(30, 15),
    liquidity_usd DECIMAL(30, 15),
    trade_count INTEGER,
    unique_traders INTEGER,
    price_change_percent DECIMAL(10, 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mint_address, hour)
);

-- Liquidity Events
CREATE TABLE IF NOT EXISTS liquidity_events (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(150),
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    event_type VARCHAR(20),
    lp_mint_amount DECIMAL(30, 0),
    base_amount DECIMAL(30, 0),
    quote_amount DECIMAL(30, 0),
    provider_address VARCHAR(50),
    timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_event_type CHECK (event_type IN ('add', 'remove'))
);

-- Fee Events
CREATE TABLE IF NOT EXISTS amm_fee_events (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(150),
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    base_fee_amount DECIMAL(30, 0),
    quote_fee_amount DECIMAL(30, 0),
    owner_address VARCHAR(50),
    timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- LP Positions
CREATE TABLE IF NOT EXISTS lp_positions (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    pool_address VARCHAR(50),
    provider_address VARCHAR(50),
    lp_token_balance DECIMAL(30, 0),
    share_percentage DECIMAL(10, 6),
    estimated_base_amount DECIMAL(30, 0),
    estimated_quote_amount DECIMAL(30, 0),
    last_update TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pool_address, provider_address)
);

-- Bonding Curve Mappings
CREATE TABLE IF NOT EXISTS bonding_curve_mappings (
    bonding_curve_address VARCHAR(50) PRIMARY KEY,
    mint_address VARCHAR(50) REFERENCES tokens_unified(mint_address),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tokens_graduated ON tokens_unified(graduated_to_amm);
CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens_unified(creator);
CREATE INDEX IF NOT EXISTS idx_tokens_program ON tokens_unified(current_program);
CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens_unified(token_created_at);
CREATE INDEX IF NOT EXISTS idx_tokens_market_cap ON tokens_unified(latest_market_cap_usd);
CREATE INDEX IF NOT EXISTS idx_tokens_progress ON tokens_unified(latest_bonding_curve_progress);

CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades_unified(mint_address);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades_unified(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades_unified(user_address);
CREATE INDEX IF NOT EXISTS idx_trades_slot ON trades_unified(slot);

CREATE INDEX IF NOT EXISTS idx_liquidity_mint ON liquidity_events(mint_address);
CREATE INDEX IF NOT EXISTS idx_liquidity_pool ON liquidity_events(pool_address);
CREATE INDEX IF NOT EXISTS idx_liquidity_timestamp ON liquidity_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_fee_mint ON amm_fee_events(mint_address);
CREATE INDEX IF NOT EXISTS idx_fee_pool ON amm_fee_events(pool_address);

CREATE INDEX IF NOT EXISTS idx_lp_pool ON lp_positions(pool_address);
CREATE INDEX IF NOT EXISTS idx_lp_provider ON lp_positions(provider_address);

-- Create update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tokens_updated_at BEFORE UPDATE
    ON tokens_unified FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 4. Environment Configuration

Create `.env` file in the project root:
```bash
# Copy the example env file if it exists
cp .env.example .env 2>/dev/null || touch .env

# Edit the .env file
nano .env  # or use your preferred editor
```

Add the following environment variables:
```env
# Database Configuration
DATABASE_URL=postgresql://pump_user:your_secure_password@localhost:5432/pump_monitor

# Shyft gRPC Configuration (REQUIRED)
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to
SHYFT_GRPC_TOKEN=your-shyft-grpc-token

# Shyft API Configuration (for metadata)
SHYFT_API_KEY=your-shyft-api-key

# Helius API (optional metadata fallback)
HELIUS_API_KEY=your-helius-api-key

# API Server Port
API_PORT=3001

# Monitor Thresholds
BC_SAVE_THRESHOLD=8888    # Bonding curve market cap threshold in USD
AMM_SAVE_THRESHOLD=1000   # AMM market cap threshold in USD

# Optional Settings
NODE_ENV=production
LOG_LEVEL=info
```

### 5. Build the Project
```bash
# Build TypeScript
npm run build

# Verify build succeeded
ls -la dist/
```

### 6. Test Database Connection
```bash
# Create a test script
cat > test-db.js << 'EOF'
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('Database connected successfully:', res.rows[0]);
  }
  pool.end();
});
EOF

# Run the test
node test-db.js
```

## Running the System

### Development Mode
```bash
# Run with hot reload
npm run dev

# Or run individual monitors
npm run bc-trade-monitor      # Bonding curve trades
npm run bc-account-monitor    # Bonding curve accounts
npm run amm-trade-monitor     # AMM trades
npm run amm-account-monitor   # AMM accounts
npm run raydium-monitor       # Raydium AMM trades
```

### Production Mode
```bash
# Start all monitors and dashboard
npm run start

# Or use PM2 for process management
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Dashboard Access
Open your browser to:
- Main Dashboard: http://localhost:3001/
- AMM Analytics: http://localhost:3001/amm-dashboard.html
- System Metrics: http://localhost:3001/streaming-metrics.html

## Database Maintenance

### Backup Database
```bash
# Full backup
pg_dump -U pump_user -d pump_monitor > backup_$(date +%Y%m%d_%H%M%S).sql

# Compressed backup
pg_dump -U pump_user -d pump_monitor | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Restore Database
```bash
# From SQL file
psql -U pump_user -d pump_monitor < backup_20240104_120000.sql

# From compressed file
gunzip -c backup_20240104_120000.sql.gz | psql -U pump_user -d pump_monitor
```

### Update Database Schema
```bash
# Check for migration files
ls -la migrations/

# Run migrations (if using a migration tool)
npm run migrate

# Or apply manual updates
psql -U pump_user -d pump_monitor < migrations/update_001.sql
```

### Clean Up Old Data
```bash
# Delete trades older than 30 days
psql -U pump_user -d pump_monitor -c "DELETE FROM trades_unified WHERE timestamp < NOW() - INTERVAL '30 days';"

# Clean up stale tokens
npm run cleanup:stale-tokens
```

## Troubleshooting

### Common Issues

#### 1. Shyft gRPC Connection Limit
**Error**: "Maximum connection count reached"
```bash
# Solution: Wait 5-10 minutes or use different token
./scripts/fix-connection-limit.sh
```

#### 2. High Memory Usage
```bash
# Check memory usage
npx tsx src/scripts/check-memory-usage.ts

# Or with garbage collection
node --expose-gc dist/scripts/check-memory-usage.js
```

#### 3. Database Connection Issues
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list | grep postgresql  # macOS

# Test connection
psql -U pump_user -d pump_monitor -c "SELECT 1;"
```

#### 4. Missing Graduated Tokens
```bash
# Fix graduated tokens manually
npx tsx src/scripts/fix-graduated-tokens.ts

# Update token creation times
npx tsx src/scripts/update-token-creation-times.ts
```

#### 5. Build Errors
```bash
# Clean and rebuild
rm -rf dist/ node_modules/
npm install
npm run build
```

### Performance Optimization

#### 1. Database Indexes
```sql
-- Check slow queries
SELECT query, calls, mean_time_ms 
FROM pg_stat_statements 
ORDER BY mean_time_ms DESC 
LIMIT 10;

-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_trades_composite 
ON trades_unified(mint_address, timestamp DESC);
```

#### 2. Connection Pooling
```javascript
// In .env
DATABASE_POOL_SIZE=20
DATABASE_IDLE_TIMEOUT=30000
```

#### 3. Memory Management
- Set up automatic cache cleanup
- Monitor memory usage regularly
- Use the memory cleanup button in System Metrics dashboard

## Security Best Practices

1. **API Keys**
   - Never commit `.env` file to git
   - Use strong, unique API keys
   - Rotate keys regularly

2. **Database**
   - Use strong passwords
   - Limit database user permissions
   - Enable SSL for remote connections

3. **Network**
   - Use firewall to restrict access
   - Run behind reverse proxy (nginx) in production
   - Enable HTTPS for dashboard

## Monitoring & Alerts

### Set up monitoring
```bash
# Install monitoring dependencies
npm install --save @opentelemetry/api @opentelemetry/sdk-node

# Configure in .env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
ENABLE_MONITORING=true
```

### Health Checks
```bash
# API health check
curl http://localhost:3001/api/v1/performance/health

# Database health
psql -U pump_user -d pump_monitor -c "SELECT COUNT(*) FROM tokens_unified;"
```

## Updating the System

### Pull Latest Changes
```bash
# Stash local changes if any
git stash

# Pull latest from main
git pull origin main

# Apply stashed changes if needed
git stash pop

# Install new dependencies
npm install

# Rebuild
npm run build

# Check for database migrations
ls -la migrations/

# Restart the system
pm2 restart all  # If using PM2
```

## Support & Resources

- **Documentation**: See CLAUDE.md for detailed system documentation
- **Issues**: https://github.com/Lewis13H/pumpfun-superbot-v2/issues
- **Logs**: Check `logs/` directory for system logs

## Quick Commands Reference

```bash
# Start everything
npm run start

# Check system health
curl http://localhost:3001/api/v1/performance/metrics

# View logs
pm2 logs

# Database query
psql -U pump_user -d pump_monitor

# Memory cleanup
npx tsx src/scripts/check-memory-usage.ts

# Fix graduated tokens
npx tsx src/scripts/fix-graduated-tokens.ts
```

Remember to check CLAUDE.md for specific implementation details and recent updates!