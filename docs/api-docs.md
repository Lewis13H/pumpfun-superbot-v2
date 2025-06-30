# API Documentation

## Base URL

```
http://localhost:3001
```

## Authentication

Currently, the API does not require authentication. In production, implement API key authentication.

## Endpoints

### 1. Health Check

#### GET /api/health

Check if the API server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-06-30T12:00:00.000Z"
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
      "amm": "running"
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

#### GET /api/tokens

Retrieve a list of saved tokens.

**Query Parameters:**
- `limit` (number, optional): Number of tokens to return (default: 100, max: 1000)
- `offset` (number, optional): Pagination offset (default: 0)
- `graduated` (boolean, optional): Filter by graduation status
- `minMarketCap` (number, optional): Minimum market cap filter
- `sortBy` (string, optional): Sort field (marketCap, createdAt, volume)
- `order` (string, optional): Sort order (asc, desc)

**Response:**
```json
{
  "data": [
    {
      "mintAddress": "So11111111111111111111111111111111111111112",
      "symbol": "BONK",
      "name": "Bonk Token",
      "firstMarketCapUsd": 10000,
      "currentMarketCapUsd": 50000,
      "graduatedToAmm": true,
      "createdAt": "2025-06-30T12:00:00.000Z"
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

#### GET /api/tokens/:mintAddress

Get detailed information about a specific token.

**Parameters:**
- `mintAddress` (string): The token's mint address

**Response:**
```json
{
  "mintAddress": "So11111111111111111111111111111111111111112",
  "symbol": "BONK",
  "name": "Bonk Token",
  "description": "The people's dog coin",
  "image": "https://...",
  "firstMarketCapUsd": 10000,
  "currentMarketCapUsd": 50000,
  "firstPriceSol": 0.000001,
  "currentPriceSol": 0.000005,
  "graduatedToAmm": true,
  "graduationAt": "2025-06-30T13:00:00.000Z",
  "totalTrades": 1500,
  "volume24hUsd": 250000,
  "creators": [
    {
      "address": "Creator111111111111111111111111111111111111",
      "share": 100
    }
  ],
  "metadata": {
    "website": "https://bonk.com",
    "twitter": "@bonk"
  }
}
```

### 3. Trades

#### GET /api/trades/recent

Get recent trades across all monitored tokens.

**Query Parameters:**
- `limit` (number, optional): Number of trades (default: 50, max: 500)
- `program` (string, optional): Filter by program (bonding_curve, amm_pool)
- `tradeType` (string, optional): Filter by type (buy, sell)
- `mintAddress` (string, optional): Filter by token

**Response:**
```json
{
  "data": [
    {
      "signature": "5abc...",
      "mintAddress": "So11111111111111111111111111111111111111112",
      "program": "bonding_curve",
      "tradeType": "buy",
      "priceUsd": 0.00005,
      "marketCapUsd": 50000,
      "volumeUsd": 500,
      "userAddress": "User1111111111111111111111111111111111111111",
      "blockTime": "2025-06-30T12:00:00.000Z"
    }
  ]
}
```

#### GET /api/trades/volume

Get trading volume statistics.

**Query Parameters:**
- `period` (string): Time period (1h, 24h, 7d, 30d)
- `groupBy` (string, optional): Group by (token, program, hour)

**Response:**
```json
{
  "period": "24h",
  "totalVolume": 5000000,
  "totalTrades": 15000,
  "uniqueTraders": 3500,
  "volumeByProgram": {
    "bonding_curve": 3000000,
    "amm_pool": 2000000
  },
  "topTokens": [
    {
      "mintAddress": "...",
      "symbol": "BONK",
      "volume": 500000,
      "trades": 1500
    }
  ]
}
```

### 4. Statistics

#### GET /api/stats

Get aggregate system statistics.

**Response:**
```json
{
  "monitors": {
    "bcMonitor": {
      "status": "running",
      "uptime": 3600,
      "transactions": 50000,
      "trades": 45000,
      "parseRate": 0.95,
      "errors": 50
    },
    "ammMonitor": {
      "status": "running",
      "uptime": 3600,
      "transactions": 20000,
      "trades": 18000,
      "parseRate": 0.90,
      "errors": 20
    }
  },
  "tokens": {
    "total": 500,
    "graduated": 150,
    "aboveThreshold": 300
  },
  "volume": {
    "24h": 5000000,
    "7d": 25000000
  }
}
```

#### GET /api/stats/performance

Get performance metrics.

**Response:**
```json
{
  "cpu": {
    "usage": 45.5,
    "cores": 8
  },
  "memory": {
    "used": 512,
    "total": 2048,
    "percentage": 25
  },
  "database": {
    "connections": 10,
    "maxConnections": 100,
    "queryTime": 2.5
  },
  "grpc": {
    "messagesPerSecond": 50,
    "latency": 10
  }
}
```

### 5. AMM Specific

#### GET /api/amm/pools

Get AMM pool information.

**Query Parameters:**
- `limit` (number, optional): Number of pools (default: 50)
- `sortBy` (string, optional): Sort by (liquidity, volume, created)

**Response:**
```json
{
  "data": [
    {
      "poolAddress": "Pool11111111111111111111111111111111111111",
      "mintAddress": "Token1111111111111111111111111111111111111",
      "liquiditySol": 1000,
      "liquidityUsd": 150000,
      "volume24h": 50000,
      "priceUsd": 0.15,
      "priceChange24h": 25.5,
      "createdAt": "2025-06-30T12:00:00.000Z"
    }
  ]
}
```

#### GET /api/amm/pools/:mintAddress

Get detailed pool information for a token.

**Response:**
```json
{
  "poolAddress": "Pool11111111111111111111111111111111111111",
  "mintAddress": "Token1111111111111111111111111111111111111",
  "reserves": {
    "sol": 1000,
    "token": 1000000
  },
  "liquidity": {
    "sol": 1000,
    "usd": 150000
  },
  "price": {
    "sol": 0.001,
    "usd": 0.15
  },
  "fees": {
    "24h": 500,
    "total": 5000
  },
  "holders": 1500,
  "transactions24h": 500
}
```

## WebSocket API

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');
```

### Message Format

All messages follow this format:

```json
{
  "type": "event_type",
  "payload": { /* event data */ },
  "timestamp": 1234567890
}
```

### Events

#### connected
Sent when client connects.

```json
{
  "type": "connected",
  "payload": {
    "clientId": "ws-123456-abc",
    "serverTime": "2025-06-30T12:00:00.000Z",
    "availableEvents": ["bc:trade", "amm:trade", "token:discovered"]
  }
}
```

#### bc:trade
Bonding curve trade event.

```json
{
  "type": "bc:trade",
  "payload": {
    "signature": "5abc...",
    "mintAddress": "Token111...",
    "tradeType": "buy",
    "priceUsd": 0.00005,
    "marketCapUsd": 50000,
    "volumeUsd": 500,
    "progress": 45.5
  }
}
```

#### amm:trade
AMM pool trade event.

```json
{
  "type": "amm:trade",
  "payload": {
    "signature": "6def...",
    "mintAddress": "Token222...",
    "poolAddress": "Pool222...",
    "tradeType": "sell",
    "priceUsd": 0.15,
    "volumeUsd": 1500,
    "liquidityUsd": 150000
  }
}
```

#### token:discovered
New token discovered above threshold.

```json
{
  "type": "token:discovered",
  "payload": {
    "mintAddress": "Token333...",
    "symbol": "NEW",
    "name": "New Token",
    "marketCapUsd": 10000,
    "program": "bonding_curve"
  }
}
```

#### token:graduated
Token graduated to AMM.

```json
{
  "type": "token:graduated",
  "payload": {
    "mintAddress": "Token444...",
    "poolAddress": "Pool444...",
    "finalBcPrice": 0.0001,
    "initialAmmPrice": 0.00012,
    "slot": 12345678
  }
}
```

### Client Commands

#### subscribe
Subscribe to specific events.

```json
{
  "type": "subscribe",
  "events": ["bc:trade", "token:discovered"]
}
```

#### unsubscribe
Unsubscribe from events.

```json
{
  "type": "unsubscribe",
  "events": ["amm:trade"]
}
```

#### ping
Keep connection alive.

```json
{
  "type": "ping"
}
```

Server responds with:
```json
{
  "type": "pong",
  "timestamp": 1234567890
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

## Rate Limiting

- Default: 100 requests per minute per IP
- WebSocket: 10 messages per second
- Bulk endpoints: 10 requests per minute

## Examples

### Fetch High-Value Tokens

```bash
curl "http://localhost:3001/api/tokens?minMarketCap=100000&sortBy=marketCap&order=desc"
```

### Stream Real-Time Trades

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    events: ['bc:trade', 'amm:trade']
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log(`${event.type}: ${event.payload.mintAddress}`);
});
```

### Get Token Details

```bash
curl "http://localhost:3001/api/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
```