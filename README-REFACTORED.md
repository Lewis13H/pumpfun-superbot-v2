# Pump.fun Monitor v2.0 - Refactored Architecture

A high-performance, real-time Solana token monitoring system built with clean architecture principles, dependency injection, and event-driven design.

## 🚀 Overview

This is a complete architectural refactor of the pump.fun monitoring system, designed to:
- Monitor pump.fun bonding curves and pump.swap AMM pools in real-time
- Track token prices, market caps, and trading activity
- Save high-value tokens (≥$8,888) to PostgreSQL
- Provide real-time WebSocket updates and REST API
- Enrich token metadata automatically

## 🏗️ Architecture

### Core Principles

1. **Dependency Injection (DI)** - No more singletons or global state
2. **Event-Driven Architecture** - Decoupled components communicate via EventBus
3. **Clean Architecture** - Separation of concerns with clear boundaries
4. **Base Abstractions** - Common functionality extracted to base classes
5. **Repository Pattern** - Clean data access layer
6. **Strategy Pattern** - Pluggable parsing strategies

### Key Components

```
src/
├── core/                    # Foundation layer
│   ├── container.ts        # DI container
│   ├── event-bus.ts        # Event-driven communication
│   ├── config.ts           # Centralized configuration
│   ├── logger.ts           # Structured logging
│   └── base-monitor.ts     # Base monitor abstraction
├── monitors/               # Refactored monitors
│   ├── bc-monitor-refactored.ts
│   └── amm-monitor-refactored.ts
├── parsers/                # Event parsing strategies
│   ├── unified-event-parser.ts
│   └── strategies/
├── handlers/               # Business logic
│   └── trade-handler.ts
├── repositories/           # Data access layer
│   ├── token-repository.ts
│   └── trade-repository.ts
├── websocket/              # Real-time updates
│   └── websocket-server.ts
└── api/                    # REST API
    └── server-refactored.ts
```

## 🚦 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Shyft gRPC API key
- Helius/Shyft API keys (for metadata)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd pumpfun-superbot-v2

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run database migrations
npm run migrate-unified

# Start the refactored system
npm run start-refactored
```

### Environment Variables

```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to
SHYFT_GRPC_TOKEN=your-token-here
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional
HELIUS_API_KEY=your-api-key      # For metadata enrichment
SHYFT_API_KEY=your-api-key       # For Shyft DAS API
BC_SAVE_THRESHOLD=8888           # Market cap threshold
API_PORT=3001                    # API server port
```

## 🎯 Usage

### Running the Monitors

```bash
# Start all refactored monitors with API
npm run start-refactored

# Individual monitors (if needed)
npm run bc-monitor-refactored
npm run amm-monitor-refactored

# API server only
npm run server-refactored
```

### API Endpoints

- `GET /` - Dashboard
- `GET /api/tokens` - List saved tokens
- `GET /api/tokens/:mintAddress` - Token details
- `GET /api/trades/recent` - Recent trades
- `GET /api/stats` - System statistics
- `WS /ws` - WebSocket connection

### WebSocket Events

Connect to `ws://localhost:3001/ws` to receive real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log(event.type, event.payload);
});

// Event types:
// - bc:trade
// - amm:trade
// - token:discovered
// - token:graduated
// - token:threshold_crossed
```

## 🔧 Configuration

### Monitor Configuration

The system uses a centralized configuration service:

```typescript
// config.json (auto-generated from env vars)
{
  "monitors": {
    "bcSaveThreshold": 8888,     // Min market cap to save
    "ammSaveThreshold": 1000,    // Lower threshold for AMM
    "saveAllTokens": false,      // Override thresholds
    "displayInterval": 10000     // Stats display interval
  },
  "services": {
    "solPriceUpdateInterval": 5000,
    "enrichmentInterval": 30000,
    "recoveryInterval": 1800000
  }
}
```

### Database Schema

The refactored system uses a unified schema:

```sql
-- Main token table
CREATE TABLE tokens_unified (
  mint_address VARCHAR(64) PRIMARY KEY,
  symbol VARCHAR(32),
  name VARCHAR(128),
  first_market_cap_usd DECIMAL(20, 4),
  graduated_to_amm BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trade history
CREATE TABLE trades_unified (
  signature VARCHAR(88) PRIMARY KEY,
  mint_address VARCHAR(64) NOT NULL,
  program program_type NOT NULL,
  trade_type trade_type,
  price_usd DECIMAL(20, 4),
  market_cap_usd DECIMAL(20, 4),
  block_time TIMESTAMPTZ NOT NULL
);
```

## 🏛️ Architecture Details

### Dependency Injection

The DI container manages all service dependencies:

```typescript
// No more getInstance() calls!
const container = await createContainer();
const monitor = new BCMonitorRefactored(container);
await monitor.start();
```

### Event-Driven Communication

Components communicate through the EventBus:

```typescript
// Emit events
eventBus.emit(EVENTS.TOKEN_DISCOVERED, tokenData);

// Subscribe to events
eventBus.on(EVENTS.TOKEN_DISCOVERED, (token) => {
  console.log('New token:', token.mintAddress);
});
```

### Base Monitor Pattern

All monitors extend the base class:

```typescript
export class BCMonitorRefactored extends BaseMonitor {
  async processStreamData(data: any): Promise<void> {
    // Monitor-specific processing
  }
  
  displayStats(): void {
    // Custom statistics display
  }
}
```

## 📊 Monitoring & Debugging

### Logging

Structured logging with context:

```typescript
logger.info('Trade processed', {
  mint: trade.mintAddress,
  volume: trade.volumeUsd,
  price: trade.priceUsd
});
```

### Statistics

Real-time statistics display:
- Transaction rate
- Parse success rate
- Trade volume
- Token discoveries
- Error tracking

### Health Checks

- `/api/health` - Basic health check
- `/api/health/detailed` - Detailed system status

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- container.test.ts

# Run with coverage
npm test -- --coverage

# Validate refactoring
tsx src/tests/validate-refactoring.ts
```

## 🚀 Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js

# Monitor logs
pm2 logs pump-monitor

# Save PM2 config
pm2 save
pm2 startup
```

### Using Docker

```bash
# Build image
docker build -t pump-monitor .

# Run container
docker run -d \
  --name pump-monitor \
  --env-file .env \
  -p 3001:3001 \
  pump-monitor
```

## 🔍 Troubleshooting

### Common Issues

1. **"Cannot find module"** - Run `npm install`
2. **"Database connection failed"** - Check DATABASE_URL
3. **"No transactions received"** - Verify SHYFT_GRPC_TOKEN
4. **"Parse rate is low"** - Normal, not all transactions are trades

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm run start-refactored

# Debug specific components
DEBUG=monitor:*,parser:* npm run start-refactored
```

## 📈 Performance

- Processes 50+ transactions/second
- Parse rate >95% for trade events
- Sub-millisecond event processing
- Batch database operations
- Connection pooling

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built on Solana blockchain
- Uses Shyft Network for gRPC streaming
- Inspired by clean architecture principles