# Unified System Examples

This directory contains example scripts that work with the unified monitoring system and database schema.

## Available Scripts

### view-tokens.ts
View tokens saved by the unified monitor, focusing on those that crossed the $8,888 threshold.

```bash
npm run view-tokens-unified
```

### enrich-tokens.ts
Enrich tokens with metadata from Helius API. Requires HELIUS_API_KEY in .env.

```bash
npm run enrich-tokens-unified
```

### query-trades.ts
Query and analyze trades from both pump.fun and pump.swap programs.

```bash
# View recent trades
npm run query-trades

# Filter by mint address
npm run query-trades -- --mint <address>

# Filter by program
npm run query-trades -- --program bonding_curve
npm run query-trades -- --program amm_pool

# Filter by minimum market cap
npm run query-trades -- --min-mcap 10000

# Limit results
npm run query-trades -- --limit 100
```

## Database Schema

These examples work with the unified database schema:

- `tokens_unified` - Main token table with mint_address as PRIMARY KEY
- `trades_unified` - Trade history for both programs
- `token_metadata_unified` - Enriched metadata from Helius

## Notes

- All scripts require DATABASE_URL to be set in .env
- Enrichment requires HELIUS_API_KEY
- These scripts are read-only and safe to run anytime