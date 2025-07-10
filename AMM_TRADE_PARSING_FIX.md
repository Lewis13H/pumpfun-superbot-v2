# AMM Trade Parsing and Reserves Implementation Plan

## Current Issues

### 1. Missing AMM Trade Reserves
- **Problem**: All AMM trades in database have NULL `virtual_sol_reserves` and `virtual_token_reserves`
- **Impact**: Market cap calculations fail, showing incorrect values (10x lower)
- **Root Cause**: Not extracting reserve data from pool state or inner instructions

### 2. Low AMM Trade Detection Rate
- **Problem**: Only 3 AMM trades captured vs thousands of BC trades
- **Impact**: Missing most AMM trading activity
- **Evidence**: Database shows only 3 AMM trades total

### 3. No Raydium Trades
- **Problem**: Zero Raydium trades detected despite monitor configuration
- **Impact**: Missing all Raydium DEX activity

## Technical Analysis

### Current Implementation Gaps

1. **Pool State Not Tracked**
   - Pool account structure doesn't contain reserves
   - Reserves are in separate SPL token accounts
   - No mechanism to fetch token account balances

2. **Inner Instructions Not Properly Parsed**
   - `AMMTradeInnerIxStrategy` exists but may not receive proper context
   - gRPC data structure may not include inner instructions correctly

3. **No Account Monitoring for AMM**
   - `LiquidityMonitor` configured but not parsing account updates
   - Missing pool state synchronization

### Shyft Example Differences

1. **Account Monitoring**
   ```typescript
   // Shyft subscribes to pool accounts
   accounts: {
     "pumpswap_amm": {
       "owner": ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"],
       "filters": [],
       "nonemptyTxnSignature": true
     }
   }
   ```

2. **Pool State Decoding**
   ```typescript
   // Shyft uses BorshAccountsCoder
   const coder = new BorshAccountsCoder(program_idl);
   const parsedAccount = coder.decodeAny(dataTx?.data);
   ```

3. **Reserve Extraction from Inner Instructions**
   ```typescript
   // Shyft parses transferChecked instructions
   const transferChecked = parsedInstruction.inner_ixs.find(
     (instruction) => instruction.name === 'transferChecked'
   );
   ```

## Implementation Plan

### Phase 1: Fix AMM Trade Enrichment

#### 1.1 Enhance AmmTradeEnricher
```typescript
// src/services/amm/amm-trade-enricher.ts

// Add method to extract reserves from inner instructions
private extractReservesFromInnerInstructions(event: TradeEvent): {
  solReserves: bigint;
  tokenReserves: bigint;
} | null {
  // Parse inner instructions from event context
  const innerInstructions = event.context?.innerInstructions;
  if (!innerInstructions) return null;
  
  // Look for pool token account transfers
  // Extract pre/post balances
  // Calculate reserves from transfers
}
```

#### 1.2 Update Trade Handler
```typescript
// src/handlers/trade-handler.ts

// Remove the fixed 100M token assumption
// Use actual reserves from enricher or pool state
if (trade.virtualSolReserves && trade.virtualTokenReserves) {
  // Calculate using actual reserves
  const circulatingSupply = calculateCirculatingSupply(
    trade.virtualTokenReserves,
    trade.tokenAmount
  );
}
```

### Phase 2: Implement Pool State Tracking

#### 2.1 Create AMM Account Monitor
```typescript
// src/monitors/amm-account-monitor.ts

export class AmmAccountMonitor extends BaseMonitor {
  // Subscribe to AMM pool accounts
  protected getSubscriptionConfig() {
    return {
      accounts: {
        'amm_pools': {
          owner: ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'],
          filters: [],
          nonemptyTxnSignature: true
        }
      }
    };
  }
  
  // Parse pool updates
  async processAccountUpdate(data: any) {
    const poolAccount = decodePoolAccount(data);
    // Fetch token account balances
    // Update pool state service
  }
}
```

#### 2.2 Enhance Pool State Service
```typescript
// src/services/amm/amm-pool-state-service.ts

// Add method to fetch token account balances
async fetchPoolReserves(poolAddress: string): Promise<{
  solReserves: bigint;
  tokenReserves: bigint;
}> {
  // Use Helius/Shyft API to get token account balances
  const poolAccount = await this.getPoolAccount(poolAddress);
  const solBalance = await this.getTokenBalance(poolAccount.poolQuoteTokenAccount);
  const tokenBalance = await this.getTokenBalance(poolAccount.poolBaseTokenAccount);
  
  return {
    solReserves: solBalance,
    tokenReserves: tokenBalance
  };
}
```

### Phase 3: Fix Inner Instruction Parsing

#### 3.1 Update Parse Context Creation
```typescript
// src/utils/parsers/unified-event-parser.ts

static createContext(grpcData: any): ParseContext {
  // Ensure inner instructions are properly extracted
  const meta = grpcData.transaction?.transaction?.meta || 
               grpcData.transaction?.meta;
  
  // Parse inner instructions with proper indexing
  const innerInstructions = meta?.innerInstructions?.map(group => ({
    index: group.index,
    instructions: group.instructions.map(ix => ({
      programIdIndex: ix.programIdIndex,
      accounts: ix.accounts,
      data: ix.data
    }))
  }));
  
  return {
    ...context,
    innerInstructions,
    meta
  };
}
```

### Phase 4: Add Raydium Support

#### 4.1 Create Raydium Parser Strategy
```typescript
// src/utils/parsers/strategies/raydium-swap-strategy.ts

export class RaydiumSwapStrategy implements ParseStrategy {
  name = 'RaydiumSwapStrategy';
  
  canParse(context: ParseContext): boolean {
    return context.accounts.some(acc => 
      acc === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' ||
      acc === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
    );
  }
  
  parse(context: ParseContext): AMMTradeEvent | null {
    // Parse Raydium swap instructions
    // Extract amounts from logs or inner instructions
  }
}
```

## Migration Steps

### 1. Update Existing AMM Trades
```sql
-- Create script to backfill reserves for existing trades
-- src/scripts/fix-amm-reserves.ts

// Fetch pool states at trade time
// Update trades with proper reserves
// Recalculate market caps
```

### 2. Test Implementation
```typescript
// src/scripts/test-amm-parsing.ts

// Subscribe to AMM transactions
// Verify reserves are captured
// Check market cap calculations
```

## Success Metrics

1. **AMM Trade Reserves**: No more NULL values in `virtual_sol_reserves` and `virtual_token_reserves`
2. **Market Cap Accuracy**: AMM token market caps match DexScreener values
3. **Trade Detection Rate**: Significant increase in AMM trades captured (>100/day expected)
4. **Raydium Support**: Successfully capturing Raydium swaps

## Timeline

- **Phase 1**: 2-3 hours - Fix immediate reserve extraction
- **Phase 2**: 3-4 hours - Implement pool state tracking
- **Phase 3**: 2-3 hours - Fix inner instruction parsing
- **Phase 4**: 2-3 hours - Add Raydium support
- **Testing**: 2-3 hours - Verify all fixes work

Total: 12-16 hours of implementation

## Risk Mitigation

1. **Backward Compatibility**: Keep existing strategies as fallback
2. **Gradual Rollout**: Test on testnet first
3. **Monitoring**: Add metrics for parse success rates
4. **Documentation**: Update CLAUDE.md with new parsing logic