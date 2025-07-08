# AMM Reserves Fetcher Service

## Overview

The AMM Reserves Fetcher is a service that automatically fetches pool reserves data from the Shyft GraphQL API when AMM trades are detected. This ensures that tokens have accurate price calculations based on their actual AMM pool reserves rather than estimates.

## Features

- **Automatic Reserve Fetching**: Listens for `AMM_TRADE` events and fetches reserves for tokens that don't have them
- **GraphQL Integration**: Uses Shyft's GraphQL API to query pump.fun AMM pool data and token account balances
- **Price Recalculation**: Recalculates token prices using actual reserves for accurate market cap determination
- **Caching**: Prevents duplicate fetches with a 1-minute cache per token
- **Threshold Filtering**: Only updates tokens that meet the configured market cap threshold
- **Event-Driven**: Emits `AMM_RESERVES_FETCHED` events when reserves are successfully fetched

## How It Works

1. **Event Listening**: The service subscribes to `AMM_TRADE` events from the EventBus
2. **Reserve Check**: When a trade is detected, it checks if the token already has reserves in the database
3. **GraphQL Query**: If reserves are missing, it queries:
   - First finds the AMM pool for the token mint
   - Then fetches the token account balances for SOL and token reserves
4. **Price Calculation**: Uses the PriceCalculator to compute price and market cap from reserves
5. **Database Update**: If the market cap meets the threshold, updates the token with:
   - Virtual SOL reserves
   - Virtual token reserves
   - Recalculated price in SOL and USD
   - Updated market cap
   - Pool address and LP mint

## Configuration

### Environment Variables

- `AMM_SAVE_THRESHOLD`: Market cap threshold in USD (default: 1000)
- GraphQL endpoint is configured via `GRAPHQL_CONFIG`

### Integration

The service is automatically started in `index.ts`:

```typescript
const ammReservesFetcher = AmmReservesFetcher.getInstance(eventBus);
```

## API Methods

### Public Methods

- `fetchReservesForToken(mintAddress: string): Promise<boolean>`
  - Manually fetch reserves for a specific token
  - Returns true if successful, false otherwise
  
- `getStats(): { cachedTokens: number, cacheEntries: Array }`
  - Get service statistics including cached tokens

### Events

**Listens for:**
- `AMM_TRADE`: Triggers reserve fetching for the traded token

**Emits:**
- `AMM_RESERVES_FETCHED`: When reserves are successfully fetched and stored
  ```typescript
  {
    mintAddress: string,
    poolAddress: string,
    solReserves: bigint,
    tokenReserves: bigint,
    priceInUsd: number,
    marketCapUsd: number
  }
  ```

## Database Updates

The service updates the following columns in `tokens_unified`:
- `latest_virtual_sol_reserves`
- `latest_virtual_token_reserves`
- `latest_price_sol`
- `latest_price_usd`
- `latest_market_cap_usd`
- `current_price_sol`
- `current_price_usd`
- `current_market_cap_usd`
- `pool_address` (if available)
- `lp_mint` (if available)

## Testing

Use the test script to verify functionality:

```bash
npx tsx src/scripts/test-amm-reserves-fetcher.ts
```

The test script:
1. Finds AMM tokens without reserves
2. Emits a mock AMM_TRADE event
3. Tests manual fetching
4. Verifies database updates

## Technical Details

### GraphQL Queries Used

1. **FIND_AMM_POOLS_BY_MINT**: Finds pump.fun AMM pools for given mint addresses
2. **GET_AMM_POOLS_AND_ACCOUNTS**: Fetches both pool data and token account balances

### Reserve Calculation

- SOL reserves are from the quote token account (SOL is quote in pump.fun)
- Token reserves are from the base token account
- Price = SOL reserves / Token reserves (with proper decimal handling)
- Market cap = Price × Total supply (1 billion tokens)

### Performance Considerations

- Caches recently fetched tokens for 1 minute to prevent duplicate API calls
- Uses GraphQL batching where possible
- Only processes tokens above the market cap threshold
- Implements retry logic via the GraphQLClient

## Troubleshooting

### Common Issues

1. **No pool data found**: Token may not have graduated to AMM yet
2. **Incomplete reserve data**: Token accounts may not be properly initialized
3. **Invalid reserves (0 values)**: Pool may be in an invalid state

### Debugging

Enable debug logs by setting:
```bash
LOG_LEVEL=debug
```

Check service stats:
```typescript
const stats = ammReservesFetcher.getStats();
console.log(stats);
```

## Future Improvements

1. **Batch Processing**: Queue multiple tokens and fetch in batches
2. **Periodic Refresh**: Update reserves for existing tokens periodically
3. **Multiple AMM Support**: Extend to support other AMMs beyond pump.fun
4. **WebSocket Updates**: Use real-time subscriptions instead of polling