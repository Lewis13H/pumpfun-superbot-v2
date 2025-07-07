# Holder Analysis Session 2: API Integration

## Overview
Session 2 implements API clients for fetching holder data from Helius and Shyft, along with a wallet classification service that analyzes wallet behavior patterns.

## What Was Created

### 1. Helius API Client
- **File**: `helius-api-client.ts`
- **Features**:
  - Token holder fetching with pagination
  - Wallet information and transaction analysis
  - Pattern detection for bot/sniper identification
  - MEV activity detection
  - Token metadata retrieval

### 2. Shyft DAS API Client
- **File**: `shyft-das-api-client.ts`
- **Features**:
  - Digital Asset Standard (DAS) API integration
  - Token holder data with percentages
  - Wallet portfolio analysis
  - Transaction history fetching
  - Token creation info retrieval

### 3. Holder Data Fetcher
- **File**: `holder-data-fetcher.ts`
- **Features**:
  - Orchestrates both API clients
  - Automatic fallback mechanism
  - Data normalization across sources
  - In-memory caching with TTL
  - Event-based status updates
  - Merge data from multiple sources

### 4. Wallet Classification Service
- **File**: `wallet-classification-service.ts`
- **Features**:
  - Analyzes wallet behavior patterns
  - Classifies wallets into categories:
    - Snipers (early buyers)
    - Bots (automated trading)
    - Bundlers (MEV/Jito users)
    - Developers (token creators)
    - Whales (large holders)
    - Normal traders
  - Confidence scoring
  - Database persistence
  - Batch classification support

## Configuration

### Environment Variables Required
```bash
# At least one API key is required
HELIUS_API_KEY=your-helius-api-key  # Optional but recommended
SHYFT_API_KEY=your-shyft-api-key    # Required for Shyft client
```

### Classification Criteria
Default thresholds can be customized:
```typescript
{
  sniperTimeWindowSeconds: 300,    // 5 minutes from token creation
  botMinTransactions: 20,           // Min transactions for bot detection
  botMaxTimeDiffSeconds: 30,        // Max time between bot transactions
  whaleMinPercentage: 1.0,          // Min % holding for whale status
  developerTokenCreations: 1        // Token creations for dev classification
}
```

## API Usage Examples

### Fetching Holder Data
```typescript
const fetcher = new HolderDataFetcher(heliusKey, shyftKey);

// Fetch with automatic fallback
const holderData = await fetcher.fetchHolderData(mintAddress, {
  preferredSource: 'shyft',
  maxHolders: 1000,
  enableFallback: true,
  cacheResults: true,
  cacheTTL: 300 // 5 minutes
});

// Fetch from both sources and merge
const mergedData = await fetcher.fetchFromBothSources(mintAddress);
```

### Classifying Wallets
```typescript
const classifier = new WalletClassificationService(pool, heliusKey, shyftKey);

// Classify single wallet
const result = await classifier.classifyWallet(walletAddress, mintAddress, {
  holdingPercentage: 2.5,
  firstTransactionTime: Date.now() - 60000, // 1 minute ago
  tokenCreationTime: Date.now() - 120000    // 2 minutes ago
});

// Batch classification
const wallets = [
  { address: 'wallet1', holdingPercentage: 1.5 },
  { address: 'wallet2', holdingPercentage: 0.5 }
];
const results = await classifier.classifyBatch(wallets, mintAddress);
```

## Data Flow

1. **Holder Data Request** → HolderDataFetcher
2. **Primary API Call** → Shyft/Helius (based on preference)
3. **Fallback if needed** → Alternative API
4. **Data Normalization** → Standardized format
5. **Cache Storage** → In-memory with TTL
6. **Wallet Analysis** → Classification Service
7. **Pattern Detection** → Multiple data points analyzed
8. **Classification** → Category + confidence score
9. **Database Storage** → Persistent classification

## Testing

Run the test script:
```bash
npx tsx src/scripts/test-holder-analysis-session2.ts
```

This will:
1. Test both API clients individually
2. Verify fallback mechanism
3. Test wallet classification
4. Check caching functionality
5. Display classification statistics

## Error Handling

- **API Failures**: Automatic fallback to alternative source
- **Rate Limiting**: Built-in delays and request throttling
- **Invalid API Keys**: Graceful degradation with warnings
- **Network Errors**: Retry logic with exponential backoff
- **Data Inconsistencies**: Merge strategy for conflicting data

## Next Steps (Session 3)
- Implement core holder analysis service
- Calculate holder scores (0-300 points)
- Generate comprehensive analysis reports
- Set up scheduled analysis jobs