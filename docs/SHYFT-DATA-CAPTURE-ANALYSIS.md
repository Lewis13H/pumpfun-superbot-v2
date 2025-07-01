# Shyft API Data Capture Analysis for Pump.fun Tokens

## Overview
Shyft provides multiple APIs for Solana data access, including GraphQL indexing, gRPC streaming, and REST APIs. Their services are particularly valuable for pump.fun token monitoring as they offer both real-time streaming and historical data access.

## Core Shyft Services

### 1. GraphQL SuperIndexer

**Endpoint Format:**
```
Mainnet: https://programs.shyft.to/v0/graphql/?api_key={your-key}&network=mainnet-beta
Devnet: https://programs.shyft.to/v0/graphql/?api_key={your-key}&network=devnet
```

**Available Pump.fun Schemas:**
```graphql
# Bonding Curve Schema (Pump.fun)
pump_BondingCurve {
  pubkey
  virtualTokenReserves
  virtualSolReserves
  realTokenReserves
  realSolReserves
  tokenTotalSupply
  complete
  creator
  migrator
  ... (discovered via introspection)
}

# AMM Pool Schema (Pumpswap)
pump_fun_amm_Pool {
  pubkey
  poolBump
  index
  creator
  baseMint
  quoteMint
  lpMint
  poolBaseTokenAccount
  poolQuoteTokenAccount
  lpSupply
  coinCreator
  ... (discovered via introspection)
}

# Global Config
pump_fun_amm_GlobalConfig {
  pubkey
  creator
  initialized
  feeRecipient
  ... (discovered via introspection)
}
```

**Key Features:**
- Real-time synced with on-chain state
- Filtering, pagination, and sorting
- Bulk queries for efficiency
- Historical data access

### 2. gRPC Streaming (Yellowstone)

**Capabilities:**
- Transaction streaming
- Account streaming
- Block and BlocksMeta streaming
- Real-time pump.fun event detection

**Example Subscription:**
```typescript
const subscription = {
  accounts: {},
  slots: {},
  transactions: {
    pumpFun: {
      vote: false,
      failed: false,
      signature: undefined,
      accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"], // pump.fun program
      accountExclude: [],
      accountRequired: [],
    },
  },
  commitment: CommitmentLevel.CONFIRMED,
};
```

### 3. REST APIs

**Token Metadata:**
```typescript
// Get token metadata
GET https://api.shyft.to/sol/v1/token/get_info
{
  "network": "mainnet-beta",
  "token_address": "mint_address"
}

Response: {
  "result": {
    "name": "Token Name",
    "symbol": "SYMBOL",
    "decimals": 6,
    "freeze_authority": null,
    "mint_authority": null,
    "supply": "1000000000000000",
    "image": "https://...",
    "description": "..."
  }
}
```

**Transaction History:**
```typescript
// Get parsed transactions
GET https://api.shyft.to/sol/v1/transaction/history
{
  "network": "mainnet-beta",
  "account": "wallet_or_program",
  "tx_num": 10
}
```

### 4. Callbacks (Webhooks)

**Setup:**
```typescript
POST https://api.shyft.to/sol/v1/callback/create
{
  "network": "mainnet-beta",
  "addresses": ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
  "callback_url": "https://your-server.com/webhook",
  "type": "TRANSACTION"
}
```

**Parsed Events:**
- New token creation
- Buy/sell transactions
- Graduation to AMM
- Liquidity changes

## Pump.fun Specific Data Available

### 1. Bonding Curve Data (via GraphQL)
```graphql
query GetBondingCurve($mintAddress: String!) {
  pump_BondingCurve(
    where: { tokenMint: { _eq: $mintAddress } }
  ) {
    pubkey
    virtualTokenReserves
    virtualSolReserves
    realTokenReserves
    realSolReserves
    tokenTotalSupply
    complete
    creator
    migrator
    bondingCurveProgress: {
      calculated_field # (virtualSolReserves - 30) / 55 * 100
    }
  }
}
```

### 2. Trade History (via GraphQL)
```graphql
query GetTokenTrades($mintAddress: String!, $limit: Int) {
  pump_Trade(
    where: { mintAddress: { _eq: $mintAddress } }
    order_by: { blockTime: desc }
    limit: $limit
  ) {
    signature
    tradeType
    userAddress
    solAmount
    tokenAmount
    priceSol
    priceUsd
    virtualSolReserves
    virtualTokenReserves
    blockTime
    slot
  }
}
```

### 3. Creator Analysis (via GraphQL)
```graphql
query GetCreatorTokens($creator: String!) {
  pump_BondingCurve(
    where: { creator: { _eq: $creator } }
    order_by: { created_at: desc }
  ) {
    tokenMint
    complete
    virtualSolReserves
    tokenTotalSupply
    created_at
  }
}
```

### 4. AMM Pool State (via GraphQL)
```graphql
query GetAmmPool($mintAddress: String!) {
  pump_fun_amm_Pool(
    where: { quoteMint: { _eq: $mintAddress } }
  ) {
    pubkey
    baseMint
    quoteMint
    lpMint
    poolBaseTokenAccount
    poolQuoteTokenAccount
    lpSupply
    coinCreator
  }
}
```

## Data Enrichment Capabilities

### 1. Token Metadata Enrichment
```typescript
async function enrichTokenMetadata(mintAddress: string): Promise<TokenMetadata> {
  const response = await fetch(`https://api.shyft.to/sol/v1/token/get_info`, {
    method: 'GET',
    headers: {
      'x-api-key': SHYFT_API_KEY
    },
    params: {
      network: 'mainnet-beta',
      token_address: mintAddress
    }
  });
  
  const data = await response.json();
  
  return {
    name: data.result.name,
    symbol: data.result.symbol,
    decimals: data.result.decimals,
    supply: data.result.supply,
    image: data.result.image,
    description: data.result.description,
    // Authority information
    mintAuthority: data.result.mint_authority,
    freezeAuthority: data.result.freeze_authority,
    // Additional metadata
    updateAuthority: data.result.update_authority,
    isMutable: data.result.is_mutable
  };
}
```

### 2. Historical Price Data
```typescript
async function getHistoricalPrices(mintAddress: string): Promise<PriceHistory[]> {
  const query = `
    query GetPriceHistory($mint: String!) {
      pump_Trade(
        where: { mintAddress: { _eq: $mint } }
        order_by: { blockTime: asc }
      ) {
        blockTime
        priceSol
        priceUsd
        virtualSolReserves
        virtualTokenReserves
      }
    }
  `;
  
  const response = await graphqlRequest(query, { mint: mintAddress });
  return response.pump_Trade;
}
```

### 3. Volume Analysis
```typescript
async function getVolumeMetrics(mintAddress: string): Promise<VolumeMetrics> {
  const query = `
    query GetVolumeMetrics($mint: String!, $time24h: timestamp!) {
      volume_24h: pump_Trade_aggregate(
        where: { 
          mintAddress: { _eq: $mint },
          blockTime: { _gte: $time24h }
        }
      ) {
        aggregate {
          sum {
            solAmount
          }
          count
        }
      }
      
      unique_traders: pump_Trade(
        where: { 
          mintAddress: { _eq: $mint },
          blockTime: { _gte: $time24h }
        }
        distinct_on: userAddress
      ) {
        userAddress
      }
    }
  `;
  
  const time24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const response = await graphqlRequest(query, { mint: mintAddress, time24h });
  
  return {
    volume24h: response.volume_24h.aggregate.sum.solAmount / 1e9,
    trades24h: response.volume_24h.aggregate.count,
    uniqueTraders24h: response.unique_traders.length
  };
}
```

### 4. Graduation Detection
```typescript
async function checkGraduationStatus(mintAddress: string): Promise<GraduationStatus> {
  const query = `
    query CheckGraduation($mint: String!) {
      bonding_curve: pump_BondingCurve(
        where: { tokenMint: { _eq: $mint } }
      ) {
        complete
        virtualSolReserves
      }
      
      amm_pool: pump_fun_amm_Pool(
        where: { quoteMint: { _eq: $mint } }
      ) {
        pubkey
        lpSupply
      }
    }
  `;
  
  const response = await graphqlRequest(query, { mint: mintAddress });
  
  const bcComplete = response.bonding_curve[0]?.complete || false;
  const hasAmmPool = response.amm_pool.length > 0;
  const progress = ((response.bonding_curve[0]?.virtualSolReserves || 0) - 30e9) / 55e9 * 100;
  
  return {
    graduated: bcComplete || hasAmmPool,
    progress: Math.min(100, Math.max(0, progress)),
    ammPoolAddress: response.amm_pool[0]?.pubkey,
    bondingCurveComplete: bcComplete
  };
}
```

## Integration Strategy

### 1. Primary Data Source Enhancement
```typescript
class ShyftDataEnhancer {
  private graphqlClient: GraphQLClient;
  private restClient: ShyftRestClient;
  
  async enhanceTokenData(mintAddress: string): Promise<EnhancedTokenData> {
    // Parallel data fetching
    const [metadata, bondingCurve, trades, graduation] = await Promise.all([
      this.getTokenMetadata(mintAddress),
      this.getBondingCurveState(mintAddress),
      this.getRecentTrades(mintAddress),
      this.checkGraduationStatus(mintAddress)
    ]);
    
    return {
      ...metadata,
      bondingCurve,
      recentTrades: trades,
      graduationStatus: graduation,
      riskMetrics: this.calculateRiskMetrics(trades, bondingCurve)
    };
  }
}
```

### 2. Real-time Monitoring Setup
```typescript
class ShyftRealtimeMonitor {
  async setupMonitoring(): Promise<void> {
    // 1. GraphQL subscriptions for account changes
    const subscription = `
      subscription MonitorBondingCurves {
        pump_BondingCurve(
          where: { complete: { _eq: false } }
        ) {
          tokenMint
          virtualSolReserves
          complete
        }
      }
    `;
    
    // 2. Webhook for transactions
    await this.createWebhook({
      addresses: [PUMP_PROGRAM_ID],
      callback_url: process.env.WEBHOOK_URL,
      type: 'TRANSACTION'
    });
    
    // 3. gRPC stream for low-latency
    this.startGrpcStream();
  }
}
```

## Advantages Over Other Providers

### 1. **GraphQL Flexibility**
- Complex queries with filtering
- Aggregations and calculations
- Bulk data fetching
- Real-time subscriptions

### 2. **Complete Historical Data**
- All pump.fun transactions indexed
- Account state history
- Price/volume analytics

### 3. **Multiple Access Methods**
- GraphQL for complex queries
- REST for simple lookups
- gRPC for real-time streaming
- Webhooks for notifications

### 4. **Pump.fun Specific Support**
- Dedicated schemas for pump.fun
- Graduation detection
- Creator analysis
- Bonding curve calculations

## Rate Limits & Pricing

**Free Tier:**
- 100 requests/minute
- 10,000 requests/month
- Basic support

**Pro Tier:**
- 1,000 requests/minute
- 1,000,000 requests/month
- Priority support

**Enterprise:**
- Custom limits
- Dedicated infrastructure
- SLA guarantees

## Recommended Usage for Pump.fun

### ✅ Use Shyft for:
1. **Historical Analysis** - Complete trade history via GraphQL
2. **Bulk Data Queries** - Get multiple tokens in one request
3. **Complex Analytics** - Aggregations and calculations
4. **Creator Research** - All tokens by creator
5. **Graduation Tracking** - Monitor BC → AMM transitions

### ⚠️ Limitations:
1. **Cost** - Can get expensive at scale
2. **Latency** - GraphQL adds overhead vs direct gRPC
3. **Schema Discovery** - Need to explore via introspection

### 🎯 Best Practices:
1. Use GraphQL for batch operations
2. Cache frequently accessed data
3. Combine with gRPC for real-time
4. Use webhooks for critical events
5. Implement retry logic for reliability

## Summary

Shyft provides comprehensive data access for pump.fun tokens through:
- **GraphQL** - Rich querying with `pump_BondingCurve` and `pump_fun_amm_Pool` schemas
- **REST API** - Simple token metadata and transaction history
- **gRPC** - Real-time streaming for live monitoring
- **Webhooks** - Event notifications for automation

The combination of historical data access and real-time streaming makes Shyft an excellent complement to direct gRPC monitoring for building a complete pump.fun analytics system.