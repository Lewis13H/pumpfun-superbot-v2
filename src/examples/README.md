# Examples & Utilities

This directory contains utility scripts and examples for database operations and token management.

## Database Viewers

### view-saved-tokens.ts
Views all tokens saved in the database.
```bash
npm run view-tokens
```

### view-enriched-tokens.ts
Views tokens with Helius enrichment data (metadata, holder info).
```bash
npm run view-enriched
```

### view-graduated-tokens.ts
Views tokens that have graduated from bonding curve to Raydium.
```bash
npm run view-graduated
```

## Data Enrichment & Updates

### enrich-tokens.ts
Fetches metadata and holder distribution from Helius API.
```bash
npm run enrich-tokens
```

### update-token-ages.ts
Updates token creation times from blockchain data.
```bash
npm run update-ages
```

### update-graduated-prices.ts
Updates current prices for graduated tokens from DexScreener.
```bash
npm run update-graduated
```

### check-graduations.ts
Checks which tokens have graduated to Raydium.
```bash
npm run check-graduations
```

## Stream Examples

### modify-subscription.ts
Demonstrates dynamic subscription modification without disconnecting.
```bash
npx tsx src/examples/modify-subscription.ts
```

Features:
- Starts with Pump.fun program filter
- Switches to Jupiter after 30 seconds
- Returns to Pump.fun after 60 seconds
- No stream disconnection required