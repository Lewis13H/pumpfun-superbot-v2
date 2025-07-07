# API Integration Guide

## Overview
The holder analysis system integrates with two primary APIs (Helius and Shyft) to gather comprehensive holder data. This document explains the integration strategy, fallback mechanisms, and best practices.

## API Providers

### Helius API
**Purpose**: Primary source for wallet analysis and transaction patterns.

**Key Endpoints**:
- `/token/holders` - Get token holders with balances
- `/addresses/{address}/balances` - Get wallet balances
- `/addresses/{address}/transactions` - Get transaction history
- `/token-metadata` - Get token metadata

**Strengths**:
- Detailed transaction history
- Good wallet analysis capabilities
- MEV detection support
- Real-time data

**Limitations**:
- Rate limits on free tier
- May have data gaps for new tokens
- Requires API key

### Shyft DAS API
**Purpose**: Digital Asset Standard compliant data source with good holder information.

**Key Endpoints**:
- `/token/holders` - Token holder list with percentages
- `/wallet/all_tokens` - Wallet portfolio
- `/transaction/history` - Transaction history
- `/token/get_info` - Token information

**Strengths**:
- DAS compliance
- Good holder percentage calculations
- Includes NFT data
- Detailed token info

**Limitations**:
- Occasional 500 errors
- Rate limits
- Requires API key

## Integration Architecture

### 1. Data Fetcher Pattern
```typescript
class HolderDataFetcher {
  // Primary source (configurable)
  preferredSource: 'helius' | 'shyft' = 'shyft';
  
  // Automatic fallback
  enableFallback: boolean = true;
  
  // Caching layer
  cache: Map<string, CachedData> = new Map();
  
  async fetchHolderData(mint: string): Promise<TokenHolderData> {
    // 1. Check cache first
    // 2. Try preferred source
    // 3. Fallback if needed
    // 4. Normalize data
    // 5. Cache results
  }
}
```

### 2. Fallback Strategy
```
Primary (Shyft) → Failure → Secondary (Helius) → Failure → Error
     ↓                              ↓
  Success                       Success
     ↓                              ↓
  Normalize                     Normalize
     ↓                              ↓
   Cache                         Cache
```

### 3. Data Normalization
Both APIs return different formats. Normalization ensures consistent output:

```typescript
interface NormalizedTokenHolder {
  address: string;
  balance: string;      // As string to handle large numbers
  uiBalance: number;    // Human-readable balance
  percentage: number;   // Of total supply
  rank?: number;        // Position by holdings
}
```

## Rate Limiting Strategy

### Helius Rate Limits
- Free tier: 100 req/minute
- Paid tiers: Higher limits
- Implementation:
  ```typescript
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 100ms delay between requests
  await this.delay(100);
  ```

### Shyft Rate Limits
- Standard: 200 req/minute
- Enterprise: Higher limits
- Implementation:
  ```typescript
  // 200ms delay for Shyft (more conservative)
  await this.delay(200);
  ```

### Batch Processing
```typescript
// Process in batches with delays
const batchSize = 10;
for (let i = 0; i < wallets.length; i += batchSize) {
  const batch = wallets.slice(i, i + batchSize);
  await Promise.allSettled(batch.map(w => classify(w)));
  await this.delay(1000); // 1 second between batches
}
```

## Error Handling

### Common Errors & Solutions

1. **400 Bad Request**
   - Cause: Invalid wallet address format
   - Solution: Validate addresses before API calls
   ```typescript
   function isValidSolanaAddress(address: string): boolean {
     return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
   }
   ```

2. **401 Unauthorized**
   - Cause: Invalid or missing API key
   - Solution: Check environment variables
   ```typescript
   if (!this.apiKey) {
     logger.warn('API key missing, some features limited');
   }
   ```

3. **429 Rate Limited**
   - Cause: Too many requests
   - Solution: Implement exponential backoff
   ```typescript
   async retryWithBackoff(fn: Function, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (i === maxRetries - 1) throw error;
         await this.delay(Math.pow(2, i) * 1000);
       }
     }
   }
   ```

4. **500 Internal Server Error**
   - Cause: API service issues
   - Solution: Fallback to alternative source
   ```typescript
   catch (error) {
     if (error.response?.status === 500 && this.enableFallback) {
       return this.fetchFromAlternative();
     }
     throw error;
   }
   ```

## Caching Strategy

### Cache Configuration
```typescript
interface CacheConfig {
  ttl: number;           // Time to live in seconds
  maxSize: number;       // Maximum cache entries
  enableCompression: boolean; // For large datasets
}

const defaultConfig: CacheConfig = {
  ttl: 300,             // 5 minutes
  maxSize: 1000,        // 1000 tokens
  enableCompression: false
};
```

### Cache Key Structure
```typescript
// Consistent key generation
function getCacheKey(mintAddress: string, dataType: string): string {
  return `${dataType}:${mintAddress}:${Date.now() / 1000 / 60 | 0}`;
}
```

### Cache Invalidation
- Time-based: TTL expiry
- Event-based: On significant changes
- Manual: Force refresh option

## Data Merging Strategy

When both APIs succeed, merge data for better accuracy:

```typescript
function mergeHolderData(
  helius: TokenHolder[],
  shyft: TokenHolder[]
): TokenHolder[] {
  const holderMap = new Map();
  
  // Add all holders from both sources
  [...helius, ...shyft].forEach(holder => {
    const existing = holderMap.get(holder.address);
    if (existing) {
      // Average percentages if different
      existing.percentage = (existing.percentage + holder.percentage) / 2;
    } else {
      holderMap.set(holder.address, holder);
    }
  });
  
  return Array.from(holderMap.values());
}
```

## Best Practices

### 1. API Key Management
```typescript
// Never hardcode keys
const apiKey = process.env.HELIUS_API_KEY;

// Validate on startup
if (!apiKey) {
  logger.warn('Helius API key not configured');
}

// Secure transmission
headers: {
  'x-api-key': apiKey,
  'Content-Type': 'application/json'
}
```

### 2. Response Validation
```typescript
// Always validate API responses
function validateHolderResponse(data: any): boolean {
  return data &&
    data.result &&
    Array.isArray(data.result.holders) &&
    data.result.token;
}
```

### 3. Timeout Configuration
```typescript
const client = axios.create({
  baseURL: this.baseUrl,
  timeout: 30000,  // 30 second timeout
  headers: {
    'Content-Type': 'application/json'
  }
});
```

### 4. Logging & Monitoring
```typescript
// Log all API calls
this.client.interceptors.request.use(config => {
  logger.debug(`API request: ${config.method} ${config.url}`);
  return config;
});

// Track metrics
this.emit('api_call', {
  provider: 'helius',
  endpoint: '/token/holders',
  duration: Date.now() - startTime,
  success: true
});
```

## Testing Strategy

### Mock Mode
For development without API keys:
```typescript
if (process.env.NODE_ENV === 'development' && !this.apiKey) {
  return this.getMockData(mintAddress);
}
```

### Integration Tests
```typescript
describe('API Integration', () => {
  it('should fallback when primary fails', async () => {
    // Mock primary failure
    jest.spyOn(shyftClient, 'getTokenHolders').mockRejectedValue(new Error());
    
    // Should succeed with fallback
    const result = await fetcher.fetchHolderData(mintAddress);
    expect(result.source).toBe('helius');
  });
});
```

## Cost Optimization

### 1. Cache Aggressively
- Cache holder data for 5-15 minutes
- Cache wallet classifications indefinitely
- Use Redis for persistent cache

### 2. Batch Requests
- Group multiple tokens in single request where possible
- Process wallet classifications in batches

### 3. Selective Fetching
- Only fetch top N holders for initial analysis
- Fetch more details on demand

### 4. Monitor Usage
```typescript
class APIUsageTracker {
  private usage = new Map<string, number>();
  
  track(provider: string) {
    const count = this.usage.get(provider) || 0;
    this.usage.set(provider, count + 1);
  }
  
  getStats() {
    return Object.fromEntries(this.usage);
  }
}
```

## Future Improvements

1. **GraphQL Integration**
   - More efficient data fetching
   - Reduce over-fetching
   - Better query flexibility

2. **WebSocket Support**
   - Real-time holder updates
   - Instant classification changes
   - Live score updates

3. **Additional Providers**
   - Birdeye API
   - Jupiter API
   - Custom RPC methods

4. **Smart Routing**
   - Choose provider based on token type
   - Route by data freshness needs
   - Cost-based routing