# API Documentation

## Overview

The Pump.fun & Pump.swap monitoring system provides a comprehensive REST API and WebSocket interface for real-time token monitoring, analytics, and historical data access. The API is built on a refactored architecture with dependency injection, event-driven communication, and clean separation of concerns.

## Base URL

```
http://localhost:3001
```

## Architecture

The API server is part of a 4-monitor system:
- **BC Monitor**: Bonding curve trade monitoring (>95% parse rate)
- **BC Account Monitor**: Bonding curve graduation detection
- **AMM Monitor**: AMM pool trade monitoring
- **AMM Account Monitor**: AMM pool state tracking

All components communicate via EventBus and share services through DI container.

## Authentication

Currently, the API does not require authentication. In production, implement API key authentication.

## Core Endpoints

### 1. Health & Status

#### GET /api/health

Check if the API server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

#### GET /api/health/detailed

Get detailed health information about all services.

**Response:**
```json
{
  "status": "ok",
  "services": {
    "database": "connected",
    "grpc": "connected",
    "websocket": "active",
    "monitors": {
      "bc": "running",
      "bcAccount": "running",
      "amm": "running",
      "ammAccount": "running"
    }
  },
  "stats": {
    "uptime": 3600,
    "connections": 15,
    "memory": {
      "used": 256,
      "total": 512
    }
  }
}
```

### 2. Tokens

#### GET /api/v1/tokens

Retrieve a list of saved tokens with comprehensive filtering.

**Query Parameters:**
- `limit` (number, optional): Number of tokens to return (default: 100, max: 1000)
- `offset` (number, optional): Pagination offset (default: 0)
- `graduated` (boolean, optional): Filter by graduation status
- `minMarketCap` (number, optional): Minimum market cap filter
- `maxMarketCap` (number, optional): Maximum market cap filter
- `creator` (string, optional): Filter by creator address
- `sortBy` (string, optional): Sort field (marketCap, createdAt, volume, trades)
- `order` (string, optional): Sort order (asc, desc)
- `search` (string, optional): Search by symbol or name

**Response:**
```json
{
  "data": [
    {
      "mintAddress": "So11111111111111111111111111111111111111112",
      "symbol": "BONK",
      "name": "Bonk Token",
      "creator": "Creator111111111111111111111111111111111111",
      "totalSupply": 1000000000000000,
      "bondingCurveKey": "BC111111111111111111111111111111111111111111",
      "firstPriceSol": 0.000001,
      "firstPriceUsd": 0.00015,
      "firstMarketCapUsd": 150000,
      "currentPriceSol": 0.000005,
      "currentPriceUsd": 0.00075,
      "currentMarketCapUsd": 750000,
      "graduatedToAmm": true,
      "graduationAt": "2025-01-01T13:00:00.000Z",
      "graduationSlot": 123456789,
      "priceSource": "dexscreener",
      "metadata": {
        "uri": "https://metadata.url",
        "verified": true
      },
      "createdAt": "2025-01-01T12:00:00.000Z",
      "lastUpdated": "2025-01-01T14:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 500,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

#### GET /api/v1/tokens/:mintAddress

Get detailed information about a specific token.

**Response:**
```json
{
  "token": {
    "mintAddress": "So11111111111111111111111111111111111111112",
    "symbol": "BONK",
    "name": "Bonk Token",
    "description": "The people's dog coin",
    "image": "https://...",
    "creator": "Creator111111111111111111111111111111111111",
    "totalSupply": 1000000000000000,
    "decimals": 6,
    "bondingCurveKey": "BC111111111111111111111111111111111111111111",
    "priceHistory": {
      "first": {
        "priceSol": 0.000001,
        "priceUsd": 0.00015,
        "marketCapUsd": 150000,
        "timestamp": "2025-01-01T12:00:00.000Z"
      },
      "current": {
        "priceSol": 0.000005,
        "priceUsd": 0.00075,
        "marketCapUsd": 750000,
        "liquidityUsd": 500000,
        "volume24h": 250000,
        "priceChange24h": 25.5
      }
    },
    "graduation": {
      "graduated": true,
      "timestamp": "2025-01-01T13:00:00.000Z",
      "slot": 123456789,
      "poolAddress": "Pool11111111111111111111111111111111111111"
    },
    "statistics": {
      "totalTrades": 15000,
      "uniqueTraders": 3500,
      "totalVolume": 2500000,
      "avgTradeSize": 166.67
    },
    "creatorStats": {
      "tokensCreated": 10,
      "tokensGraduated": 3,
      "graduationRate": 0.3,
      "avgMarketCap": 500000
    }
  }
}
```

#### GET /api/v1/tokens/:mintAddress/price-history

Get historical price data for a token.

**Query Parameters:**
- `interval` (string): Time interval (1m, 5m, 15m, 1h, 4h, 1d)
- `from` (number): Start timestamp (Unix)
- `to` (number): End timestamp (Unix)
- `limit` (number): Max data points (default: 100)

**Response:**
```json
{
  "mintAddress": "So11111111111111111111111111111111111111112",
  "interval": "1h",
  "data": [
    {
      "timestamp": 1704110400,
      "open": 0.00072,
      "high": 0.00078,
      "low": 0.00070,
      "close": 0.00075,
      "volume": 125000,
      "trades": 250
    }
  ]
}
```

### 3. Trades

#### GET /api/v1/trades

Get trades with advanced filtering.

**Query Parameters:**
- `limit` (number, optional): Number of trades (default: 50, max: 500)
- `offset` (number, optional): Pagination offset
- `program` (string, optional): Filter by program (bonding_curve, amm_pool)
- `tradeType` (string, optional): Filter by type (buy, sell)
- `mintAddress` (string, optional): Filter by token
- `userAddress` (string, optional): Filter by trader
- `minVolume` (number, optional): Minimum volume USD
- `from` (number, optional): Start timestamp
- `to` (number, optional): End timestamp

**Response:**
```json
{
  "data": [
    {
      "signature": "5abc...",
      "mintAddress": "So11111111111111111111111111111111111111112",
      "program": "bonding_curve",
      "tradeType": "buy",
      "userAddress": "User1111111111111111111111111111111111111111",
      "solAmount": 1000000000,
      "tokenAmount": 1000000000000,
      "priceSol": 0.000001,
      "priceUsd": 0.00015,
      "marketCapUsd": 150000,
      "volumeUsd": 150,
      "virtualSolReserves": 30000000000,
      "virtualTokenReserves": 300000000000000,
      "bondingCurveKey": "BC111111111111111111111111111111111111111111",
      "bondingCurveProgress": 45.5,
      "slot": 123456789,
      "blockTime": "2025-01-01T12:00:00.000Z",
      "createdAt": "2025-01-01T12:00:01.000Z"
    }
  ],
  "pagination": {
    "total": 50000,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

### 4. Analytics

#### GET /api/v1/analytics/volume

Get trading volume analytics.

**Query Parameters:**
- `period` (string): Time period (1h, 24h, 7d, 30d)
- `groupBy` (string, optional): Group by (token, program, hour, day)
- `mintAddress` (string, optional): Filter by token

**Response:**
```json
{
  "period": "24h",
  "summary": {
    "totalVolume": 5000000,
    "totalTrades": 15000,
    "uniqueTraders": 3500,
    "avgTradeSize": 333.33
  },
  "breakdown": {
    "byProgram": {
      "bonding_curve": {
        "volume": 3000000,
        "trades": 10000,
        "percentage": 60
      },
      "amm_pool": {
        "volume": 2000000,
        "trades": 5000,
        "percentage": 40
      }
    },
    "byHour": [
      {
        "hour": "2025-01-01T12:00:00.000Z",
        "volume": 250000,
        "trades": 750
      }
    ]
  },
  "topTokens": [
    {
      "mintAddress": "...",
      "symbol": "BONK",
      "volume": 500000,
      "trades": 1500,
      "percentage": 10
    }
  ]
}
```

#### GET /api/v1/analytics/creators

Get creator analytics.

**Query Parameters:**
- `limit` (number): Number of creators (default: 20)
- `sortBy` (string): Sort field (tokensCreated, graduationRate, avgMarketCap)

**Response:**
```json
{
  "data": [
    {
      "creatorAddress": "Creator111111111111111111111111111111111111",
      "tokensCreated": 25,
      "tokensGraduated": 8,
      "tokensRugged": 2,
      "graduationRate": 0.32,
      "avgMarketCap": 750000,
      "totalVolume": 12500000,
      "firstSeen": "2024-12-01T00:00:00.000Z",
      "lastSeen": "2025-01-01T12:00:00.000Z"
    }
  ]
}
```

### 5. Lifecycle Tracking (Phase 3)

#### GET /api/v1/lifecycle/statistics

Get token lifecycle statistics.

**Response:**
```json
{
  "overview": {
    "totalCreated": 10000,
    "totalGraduated": 2500,
    "totalAbandoned": 6000,
    "totalActive": 1500,
    "graduationRate": 0.25
  },
  "byPeriod": {
    "24h": {
      "created": 100,
      "graduated": 25,
      "abandoned": 50
    },
    "7d": {
      "created": 700,
      "graduated": 175,
      "abandoned": 400
    }
  },
  "averages": {
    "timeToGraduation": 7200,
    "timeToAbandonment": 3600,
    "tradesBeforeGraduation": 500
  }
}
```

#### GET /api/v1/lifecycle/migrations

Get recent BC to AMM migrations.

**Query Parameters:**
- `limit` (number): Number of migrations (default: 20)
- `from` (number): Start timestamp

**Response:**
```json
{
  "data": [
    {
      "mintAddress": "Token111...",
      "bondingCurveKey": "BC111...",
      "poolAddress": "Pool111...",
      "migrationSlot": 123456789,
      "migrationTime": "2025-01-01T13:00:00.000Z",
      "finalBcPrice": 0.0001,
      "initialAmmPrice": 0.00012,
      "priceIncrease": 0.2,
      "creator": "Creator111...",
      "timeToGraduation": 7200
    }
  ]
}
```

### 6. Failed Transactions & MEV (Phase 4)

#### GET /api/v1/failures/summary

Get failed transaction analysis summary.

**Query Parameters:**
- `period` (string): Time period (1h, 24h, 7d)

**Response:**
```json
{
  "period": "24h",
  "totalFailed": 5000,
  "failureRate": 0.25,
  "breakdown": {
    "slippage": {
      "count": 2000,
      "percentage": 40,
      "avgSlippage": 15.5
    },
    "insufficientFunds": {
      "count": 1500,
      "percentage": 30
    },
    "mev": {
      "count": 1000,
      "percentage": 20,
      "types": {
        "sandwich": 600,
        "frontrun": 400
      }
    },
    "other": {
      "count": 500,
      "percentage": 10
    }
  }
}
```

#### GET /api/v1/mev/events

Get detected MEV events.

**Query Parameters:**
- `limit` (number): Number of events (default: 50)
- `type` (string): MEV type (sandwich, frontrun, arbitrage)

**Response:**
```json
{
  "data": [
    {
      "id": "mev-123",
      "type": "sandwich",
      "victimTx": "victim123...",
      "frontrunTx": "front123...",
      "backrunTx": "back123...",
      "profitSol": 5.5,
      "profitUsd": 825,
      "mevBot": "Bot111...",
      "token": "Token111...",
      "timestamp": "2025-01-01T12:00:00.000Z"
    }
  ]
}
```

#### GET /api/v1/congestion/status

Get network congestion status.

**Response:**
```json
{
  "currentStatus": "moderate",
  "metrics": {
    "tps": 2500,
    "failureRate": 0.15,
    "avgComputeUnits": 250000,
    "avgPriorityFee": 0.0001
  },
  "recommendation": "Use priority fee of 0.0002 SOL",
  "history": {
    "1h": {
      "avgTps": 2300,
      "peakTps": 3000,
      "avgFailureRate": 0.12
    }
  }
}
```

### 7. State & History (Phase 5)

#### GET /api/v1/history/state/:accountPubkey

Get historical state for an account.

**Query Parameters:**
- `slot` (number): Specific slot to query
- `timestamp` (number): Specific timestamp (alternative to slot)

**Response:**
```json
{
  "account": "Account111...",
  "slot": 123456789,
  "writeVersion": 456,
  "state": {
    "virtualSolReserves": 30000000000,
    "virtualTokenReserves": 300000000000000,
    "realSolReserves": 25000000000,
    "realTokenReserves": 250000000000000,
    "complete": false
  },
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

#### GET /api/v1/liquidity/:mintAddress/depth

Get liquidity depth analysis.

**Response:**
```json
{
  "mintAddress": "Token111...",
  "currentLiquidity": {
    "sol": 1000,
    "usd": 150000
  },
  "depth": {
    "buy": {
      "1%": 1500,
      "2%": 3000,
      "5%": 7500,
      "10%": 15000
    },
    "sell": {
      "1%": 1485,
      "2%": 2940,
      "5%": 7125,
      "10%": 13500
    }
  },
  "manipulationRisk": "low",
  "volatility": "medium",
  "lastUpdated": "2025-01-01T12:00:00.000Z"
}
```

### 8. Performance Monitoring (Phase 6)

#### GET /api/v1/performance/metrics

Get comprehensive performance metrics.

**Response:**
```json
{
  "system": {
    "cpu": {
      "usage": 45.5,
      "cores": 8,
      "loadAvg": [2.1, 2.5, 2.3]
    },
    "memory": {
      "used": 4096,
      "total": 16384,
      "percentage": 25
    },
    "disk": {
      "used": 50000,
      "total": 500000,
      "percentage": 10
    }
  },
  "monitors": {
    "bc": {
      "status": "healthy",
      "messagesPerSecond": 150,
      "parseRate": 0.96,
      "latency": 12,
      "errors24h": 50
    },
    "amm": {
      "status": "healthy",
      "messagesPerSecond": 75,
      "parseRate": 0.94,
      "latency": 15,
      "errors24h": 25
    }
  },
  "database": {
    "connections": {
      "active": 25,
      "idle": 75,
      "max": 100
    },
    "performance": {
      "avgQueryTime": 2.5,
      "slowQueries": 5,
      "deadlocks": 0
    }
  },
  "grpc": {
    "status": "connected",
    "messagesPerSecond": 250,
    "reconnects24h": 2,
    "latency": 10
  }
}
```

## WebSocket API

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');
```

### Enhanced Events

#### trade:processed
Unified trade event from any source.

```json
{
  "type": "trade:processed",
  "payload": {
    "signature": "5abc...",
    "mintAddress": "Token111...",
    "program": "bonding_curve",
    "tradeType": "buy",
    "userAddress": "User111...",
    "priceUsd": 0.00015,
    "marketCapUsd": 150000,
    "volumeUsd": 150,
    "bondingCurveProgress": 45.5,
    "timestamp": "2025-01-01T12:00:00.000Z"
  }
}
```

#### token:graduated
Token graduation event with full details.

```json
{
  "type": "token:graduated",
  "payload": {
    "mintAddress": "Token111...",
    "bondingCurveKey": "BC111...",
    "poolAddress": "Pool111...",
    "creator": "Creator111...",
    "finalBcPrice": 0.0001,
    "initialAmmPrice": 0.00012,
    "graduationSlot": 123456789,
    "timeToGraduation": 7200
  }
}
```

#### pool:created
New AMM pool creation.

```json
{
  "type": "pool:created",
  "payload": {
    "poolAddress": "Pool111...",
    "mintAddress": "Token111...",
    "creator": "Creator111...",
    "initialLiquidity": {
      "sol": 85,
      "token": 850000000
    },
    "slot": 123456789
  }
}
```

#### mev:detected
Real-time MEV detection.

```json
{
  "type": "mev:detected",
  "payload": {
    "type": "sandwich",
    "victimTx": "victim123...",
    "profitSol": 5.5,
    "token": "Token111...",
    "mevBot": "Bot111..."
  }
}
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Token not found",
    "details": {
      "mintAddress": "Invalid111..."
    }
  }
}
```

### Error Codes

- `INVALID_REQUEST` - Bad request parameters
- `RESOURCE_NOT_FOUND` - Resource doesn't exist
- `INTERNAL_ERROR` - Server error
- `RATE_LIMITED` - Too many requests
- `SERVICE_UNAVAILABLE` - Service temporarily down
- `GRPC_ERROR` - gRPC connection issue
- `DATABASE_ERROR` - Database operation failed

## Rate Limiting

- Default: 100 requests per minute per IP
- Bulk endpoints: 10 requests per minute
- WebSocket: 10 messages per second
- Historical data: 20 requests per minute

## Examples

### Monitor High-Value Tokens

```bash
# Get tokens above $100k market cap
curl "http://localhost:3001/api/v1/tokens?minMarketCap=100000&sortBy=marketCap&order=desc"
```

### Track Creator Performance

```bash
# Get top creators by graduation rate
curl "http://localhost:3001/api/v1/analytics/creators?sortBy=graduationRate&limit=10"
```

### Real-Time Monitoring

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    events: ['trade:processed', 'token:graduated', 'mev:detected']
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data);
  if (event.type === 'token:graduated') {
    console.log(`Token graduated: ${event.payload.mintAddress}`);
  }
});
```

### Historical Analysis

```bash
# Get price history for a token
curl "http://localhost:3001/api/v1/tokens/Token111.../price-history?interval=1h&limit=24"

# Get liquidity depth
curl "http://localhost:3001/api/v1/liquidity/Token111.../depth"
```

## Deployment Notes

1. **Environment Variables**: Ensure all required env vars are set (see README.md)
2. **Database Indexes**: Run migration scripts for optimal performance
3. **Rate Limiting**: Configure based on your infrastructure capacity
4. **Monitoring**: Set up alerts for API health endpoints
5. **Caching**: Redis recommended for production deployments

## Version History

- **v2.0**: Complete refactor with DI, EventBus, and 6 enhancement phases
- **v1.0**: Initial unified monitor implementation