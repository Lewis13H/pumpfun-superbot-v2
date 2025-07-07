# Holder Analysis Session 1: Database Schema & Core Models

## Overview
Session 1 implements the foundational database schema and TypeScript models for the token holder analysis system.

## What Was Created

### 1. Database Migration
- **File**: `003_add_holder_analysis_tables.sql`
- **Tables Created**:
  - `holder_snapshots` - Historical holder distribution snapshots with scores
  - `wallet_classifications` - Wallet type classifications (sniper, bot, whale, etc.)
  - `token_holder_details` - Detailed holder information per token
  - `holder_analysis_metadata` - Analysis run tracking
  - `holder_trends` - Time-based holder trend tracking

### 2. TypeScript Types
- **File**: `src/types/holder-analysis.ts`
- **Key Types**:
  - `WalletClassification` - Enum for wallet types
  - `HolderScoreBreakdown` - Detailed score components
  - `TokenHolderAnalysis` - Complete analysis result
  - `HolderAnalysisConfig` - System configuration

### 3. Model Classes
- **HolderSnapshotModel** (`src/models/holder-snapshot.ts`)
  - Create and retrieve holder snapshots
  - Calculate data hash for change detection
  - Query by score range and time
  
- **WalletClassificationModel** (`src/models/wallet-classification.ts`)
  - Classify and track wallet types
  - Confidence scoring
  - Suspicious activity tracking
  
- **TokenHolderAnalysisModel** (`src/models/token-holder-analysis.ts`)
  - Manage holder details
  - Track analysis metadata
  - Calculate holder trends

## How to Apply Migration

```bash
# Apply the migration to your database
psql -U pump_user -d pump_monitor -f src/database/migrations/003_add_holder_analysis_tables.sql

# Test the implementation
npx tsx src/scripts/test-holder-analysis-session1.ts
```

## Key Features Implemented

### Holder Scoring (0-300 points)
- **Base Score**: 150 points
- **Positive Factors**:
  - Distribution score (up to +50)
  - Decentralization score (up to +50)
  - Organic growth score (up to +30)
  - Developer ethics score (up to +20)
- **Penalties**:
  - Sniper holdings (up to -50)
  - Bot activity (up to -30)
  - Bundler presence (up to -20)
  - Concentration penalty (up to -70)

### Wallet Classifications
- `sniper` - Early buyers with suspicious timing
- `bot` - Automated trading bots
- `bundler` - MEV bundle submitters
- `developer` - Team/developer wallets
- `whale` - Large holders
- `normal` - Regular holders
- `unknown` - Unclassified

### Data Tracking
- Historical snapshots with change detection
- Holder trends across multiple time windows
- Profit/loss tracking per holder
- Analysis metadata for audit trail

## Next Steps (Session 2)
- Implement Helius & Shyft API integration
- Create holder data fetching service
- Build wallet classification algorithms
- Set up job queue for analysis

## Testing
Run the test script to verify everything is working:
```bash
npx tsx src/scripts/test-holder-analysis-session1.ts
```

This will:
1. Create test wallet classifications
2. Save holder details
3. Create a holder snapshot with score
4. Track analysis metadata
5. Save holder trends
6. Verify all query operations