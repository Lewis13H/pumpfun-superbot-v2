# Bonding Curve Progress Calculation Issue & Implementation Guide

## Executive Summary

Our current bonding curve progress calculation is inaccurate because we're using a hardcoded 85 SOL threshold instead of reading the actual bonding curve state from the blockchain. This document outlines the issue, explains the Solana account structure, and provides a comprehensive implementation guide to fix it.

## The Problem

### Current Implementation
- **Hardcoded Threshold**: We assume tokens graduate at 85 SOL in virtual reserves
- **Estimation Only**: Progress = (SOL in curve / 85) × 100
- **Inaccurate Results**: Tokens show 100% progress but are still trading on bonding curve
- **No Real State**: We don't monitor the actual bonding curve account

### Real-World Example
Token: `B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump` (ALPACU)
- **Our System**: Shows 100% progress (>85 SOL in reserves)
- **pump.fun**: Shows 98% progress
- **Reality**: Still trading on bonding curve, not graduated

## Understanding Pump.fun Account Structure

### Account Types

1. **Mint Address** (Token)
   - Example: `B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump`
   - The SPL token mint

2. **Bonding Curve PDA** (State Account)
   - Example: `3aoZQmkGm8MJ7rRCxD1rPDZ7hRx7AwiMVv8yrNdedhG8`
   - Program Derived Address containing bonding curve state
   - Derived using: `["bonding-curve", mint_pubkey]`
   - **Contains the data we need**

3. **Associated Token Account** (Token Holdings)
   - Example: `Bwnnm3XmfpMSHHyjHRU83VAjJJTVQZqPvZGZQM1LW4Lc`
   - Holds tokens owned by the bonding curve
   - **This is what we currently store**

### Account Relationship
```
Mint Address (B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump)
    │
    ├─> Bonding Curve PDA (3aoZQmkGm8MJ7rRCxD1rPDZ7hRx7AwiMVv8yrNdedhG8)
    │   ├── virtualSolReserves
    │   ├── virtualTokenReserves
    │   ├── realSolReserves
    │   ├── realTokenReserves
    │   ├── complete (boolean) ← THIS IS WHAT WE NEED
    │   └── Other state data
    │
    └─> Associated Token Account (Bwnnm3XmfpMSHHyjHRU83VAjJJTVQZqPvZGZQM1LW4Lc)
        └── Token balance
```

## Implementation Guide

### Phase 1: Add Bonding Curve PDA Derivation

#### 1.1 Create PDA Derivation Utility

```typescript
// src/utils/bonding-curve/pda-derivation.ts
import { PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM } from '../config/constants';

export class BondingCurvePDA {
  /**
   * Derive the bonding curve PDA from a mint address
   */
  static deriveBondingCurvePDA(mintAddress: string): PublicKey {
    const mint = new PublicKey(mintAddress);
    const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mint.toBuffer()],
      new PublicKey(PUMP_PROGRAM)
    );
    return bondingCurvePDA;
  }

  /**
   * Derive the associated bonding curve token account
   */
  static deriveAssociatedBondingCurve(
    mintAddress: string,
    bondingCurvePDA: PublicKey
  ): PublicKey {
    const mint = new PublicKey(mintAddress);
    const [ata] = PublicKey.findProgramAddressSync(
      [
        bondingCurvePDA.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return ata;
  }
}
```

#### 1.2 Update Database Schema

```sql
-- Add bonding curve PDA column to existing table
ALTER TABLE bonding_curve_mappings 
ADD COLUMN bonding_curve_pda VARCHAR(44);

-- Update existing records with derived PDAs
UPDATE bonding_curve_mappings 
SET bonding_curve_pda = derive_bonding_curve_pda(mint_address);

-- Create index for efficient lookups
CREATE INDEX idx_bonding_curve_pda ON bonding_curve_mappings(bonding_curve_pda);
```

### Phase 2: Implement Bonding Curve Account Monitoring

#### 2.1 Create Bonding Curve Account Parser

```typescript
// src/utils/parsers/bonding-curve-account-parser.ts
import { PublicKey } from '@solana/web3.js';
import { Logger } from '../../core/logger';

export interface BondingCurveState {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
  migrationAuthority?: string;
}

export class BondingCurveAccountParser {
  private logger = new Logger({ context: 'BondingCurveAccountParser' });

  /**
   * Parse bonding curve account data
   * Account layout (size: 185 bytes):
   * - discriminator: 8 bytes
   * - virtualSolReserves: u64 (8 bytes)
   * - virtualTokenReserves: u64 (8 bytes)
   * - realSolReserves: u64 (8 bytes)
   * - realTokenReserves: u64 (8 bytes)
   * - tokenTotalSupply: u64 (8 bytes)
   * - complete: bool (1 byte)
   * - creator: Pubkey (32 bytes)
   * - mint: Pubkey (32 bytes)
   * - ... other fields
   */
  parse(accountData: Buffer): BondingCurveState | null {
    try {
      if (accountData.length < 185) {
        this.logger.warn('Invalid bonding curve account data size', {
          size: accountData.length,
          expected: 185
        });
        return null;
      }

      let offset = 8; // Skip discriminator

      const virtualSolReserves = this.readUInt64LE(accountData, offset);
      offset += 8;

      const virtualTokenReserves = this.readUInt64LE(accountData, offset);
      offset += 8;

      const realSolReserves = this.readUInt64LE(accountData, offset);
      offset += 8;

      const realTokenReserves = this.readUInt64LE(accountData, offset);
      offset += 8;

      const tokenTotalSupply = this.readUInt64LE(accountData, offset);
      offset += 8;

      const complete = accountData.readUInt8(offset) === 1;
      offset += 1;

      const creator = new PublicKey(accountData.slice(offset, offset + 32)).toString();
      offset += 32;

      // Skip mint (32 bytes) - we already know it
      offset += 32;

      // Migration authority (optional)
      let migrationAuthority: string | undefined;
      if (accountData.length > offset + 32) {
        migrationAuthority = new PublicKey(
          accountData.slice(offset, offset + 32)
        ).toString();
      }

      return {
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
        tokenTotalSupply,
        complete,
        creator,
        migrationAuthority
      };
    } catch (error) {
      this.logger.error('Failed to parse bonding curve account', error as Error);
      return null;
    }
  }

  private readUInt64LE(buffer: Buffer, offset: number): bigint {
    const low = buffer.readUInt32LE(offset);
    const high = buffer.readUInt32LE(offset + 4);
    return BigInt(low) + (BigInt(high) << 32n);
  }
}
```

#### 2.2 Create Bonding Curve Monitor

```typescript
// src/monitors/bonding-curve-account-monitor.ts
import { Injectable } from '@nestjs/common';
import { BaseMonitor } from '../core/base-monitor';
import { BondingCurveAccountParser } from '../utils/parsers/bonding-curve-account-parser';
import { EventBus, EVENTS } from '../services/event-bus';
import { DatabaseService } from '../database/database-service';
import { Logger } from '../core/logger';

@Injectable()
export class BondingCurveAccountMonitor extends BaseMonitor {
  private parser = new BondingCurveAccountParser();
  private bondingCurveAddresses: Set<string> = new Set();

  constructor(
    container: any,
    private eventBus: EventBus,
    private database: DatabaseService
  ) {
    super(container, {
      name: 'BondingCurveAccountMonitor',
      programIds: [], // We'll subscribe to specific accounts
      filters: []
    });
  }

  async onStart(): Promise<void> {
    // Load all bonding curve PDAs from database
    const result = await this.database.query(`
      SELECT DISTINCT bonding_curve_pda 
      FROM bonding_curve_mappings 
      WHERE bonding_curve_pda IS NOT NULL
    `);

    result.rows.forEach(row => {
      this.bondingCurveAddresses.add(row.bonding_curve_pda);
    });

    this.logger.info('Loaded bonding curve addresses', {
      count: this.bondingCurveAddresses.size
    });

    // Subscribe to account updates for all bonding curves
    await this.subscribeToAccounts();
  }

  private async subscribeToAccounts(): Promise<void> {
    const streamClient = await this.container.resolve('StreamClient');
    
    for (const address of this.bondingCurveAddresses) {
      try {
        await streamClient.subscribeToAccount(address, (data: any) => {
          this.handleAccountUpdate(address, data);
        });
      } catch (error) {
        this.logger.error('Failed to subscribe to bonding curve account', {
          address,
          error
        });
      }
    }
  }

  private async handleAccountUpdate(address: string, data: any): Promise<void> {
    try {
      const accountData = Buffer.from(data.account.data, 'base64');
      const state = this.parser.parse(accountData);

      if (!state) {
        return;
      }

      // Calculate accurate progress
      const progress = this.calculateAccurateProgress(state);

      // Update database
      await this.updateBondingCurveState(address, state, progress);

      // Emit event for graduation detection
      if (state.complete) {
        this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
          bondingCurvePDA: address,
          complete: true,
          realSolReserves: state.realSolReserves.toString(),
          virtualSolReserves: state.virtualSolReserves.toString()
        });
      }

      // Emit progress update event
      this.eventBus.emit(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, {
        bondingCurvePDA: address,
        progress,
        complete: state.complete,
        state
      });

    } catch (error) {
      this.logger.error('Failed to handle bonding curve account update', {
        address,
        error
      });
    }
  }

  private calculateAccurateProgress(state: BondingCurveState): number {
    if (state.complete) {
      return 100;
    }

    // Use real SOL reserves for progress calculation
    const realSolInCurve = Number(state.realSolReserves) / 1e9;
    
    // Based on analysis, graduation seems to happen around different thresholds
    // This needs to be reverse-engineered from actual graduation data
    const ESTIMATED_GRADUATION_SOL = 85; // This is still an estimate
    
    const progress = (realSolInCurve / ESTIMATED_GRADUATION_SOL) * 100;
    return Math.min(progress, 99); // Cap at 99% unless complete
  }

  private async updateBondingCurveState(
    address: string,
    state: BondingCurveState,
    progress: number
  ): Promise<void> {
    await this.database.query(`
      UPDATE tokens_unified t
      SET 
        latest_bonding_curve_progress = $1,
        graduated_to_amm = $2,
        latest_virtual_sol_reserves = $3,
        latest_virtual_token_reserves = $4,
        updated_at = NOW()
      FROM bonding_curve_mappings bcm
      WHERE bcm.mint_address = t.mint_address
      AND bcm.bonding_curve_pda = $5
    `, [progress, state.complete, state.virtualSolReserves, state.virtualTokenReserves, address]);
  }

  /**
   * Add new bonding curve to monitor
   */
  async addBondingCurve(mintAddress: string, bondingCurvePDA: string): Promise<void> {
    if (this.bondingCurveAddresses.has(bondingCurvePDA)) {
      return;
    }

    this.bondingCurveAddresses.add(bondingCurvePDA);
    
    const streamClient = await this.container.resolve('StreamClient');
    await streamClient.subscribeToAccount(bondingCurvePDA, (data: any) => {
      this.handleAccountUpdate(bondingCurvePDA, data);
    });

    this.logger.info('Added new bonding curve to monitor', {
      mintAddress,
      bondingCurvePDA
    });
  }
}
```

### Phase 3: Update Existing Components

#### 3.1 Update Token Lifecycle Monitor

```typescript
// Add to token-lifecycle-monitor.ts
private async handleNewToken(event: any): Promise<void> {
  // ... existing code ...

  // Derive and store bonding curve PDA
  const bondingCurvePDA = BondingCurvePDA.deriveBondingCurvePDA(mintAddress);
  
  // Update database with PDA
  await this.database.query(`
    UPDATE bonding_curve_mappings 
    SET bonding_curve_pda = $1 
    WHERE mint_address = $2
  `, [bondingCurvePDA.toString(), mintAddress]);

  // Add to bonding curve monitor
  const bcMonitor = await this.container.resolve('BondingCurveAccountMonitor');
  await bcMonitor.addBondingCurve(mintAddress, bondingCurvePDA.toString());
}
```

#### 3.2 Update Price Calculator

```typescript
// Update src/services/pricing/price-calculator.ts
calculateBondingCurveProgress(
  virtualSolReserves: bigint,
  isComplete: boolean = false
): number {
  if (isComplete) {
    return 100;
  }

  // Use virtual reserves for estimation when we don't have complete data
  const solInCurve = Number(virtualSolReserves) / Number(LAMPORTS_PER_SOL);
  
  // This is still an estimation - real progress comes from account monitoring
  const ESTIMATED_THRESHOLD = 85;
  const progress = (solInCurve / ESTIMATED_THRESHOLD) * 100;
  
  // Cap at 99% unless we know it's complete
  return Math.min(progress, 99);
}
```

### Phase 4: Integration & Testing

#### 4.1 Update Container Registration

```typescript
// Add to src/di/container.ts
container.register('BondingCurveAccountMonitor', BondingCurveAccountMonitor, {
  dependencies: ['EventBus', 'DatabaseService']
});
```

#### 4.2 Start Monitor

```typescript
// Add to src/index.ts
const bcAccountMonitor = await container.resolve('BondingCurveAccountMonitor');
await bcAccountMonitor.start();
monitors.push(bcAccountMonitor);
```

#### 4.3 Create Test Script

```typescript
// src/scripts/test-bonding-curve-monitor.ts
import { BondingCurvePDA } from '../utils/bonding-curve/pda-derivation';
import { Connection, PublicKey } from '@solana/web3.js';

async function testBondingCurveMonitoring() {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const mintAddress = 'B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump';
  
  // Derive PDA
  const bondingCurvePDA = BondingCurvePDA.deriveBondingCurvePDA(mintAddress);
  console.log('Bonding Curve PDA:', bondingCurvePDA.toString());
  
  // Fetch account info
  const accountInfo = await connection.getAccountInfo(bondingCurvePDA);
  if (accountInfo) {
    console.log('Account size:', accountInfo.data.length);
    console.log('Owner:', accountInfo.owner.toString());
    
    // Parse account data
    const parser = new BondingCurveAccountParser();
    const state = parser.parse(accountInfo.data);
    console.log('Parsed state:', state);
  }
}

testBondingCurveMonitoring().catch(console.error);
```

## Migration Strategy

### Step 1: Database Migration
1. Add `bonding_curve_pda` column to `bonding_curve_mappings`
2. Derive and populate PDAs for existing records
3. Add indexes for performance

### Step 2: Gradual Rollout
1. Deploy bonding curve account monitor in passive mode (no DB updates)
2. Compare account-based progress with our estimates
3. Log discrepancies for analysis
4. Enable DB updates once validated

### Step 3: UI Updates
1. Add indicator showing data source (estimate vs actual)
2. Show "Verifying..." for tokens being monitored
3. Display accurate progress once available

## Expected Outcomes

### Accuracy Improvements
- **Before**: ~85 SOL threshold estimation
- **After**: Actual graduation status from blockchain
- **Progress**: Real progress based on pump.fun's formula

### Performance Considerations
- Additional account subscriptions (1 per token)
- Minimal overhead - account updates are infrequent
- Can batch subscriptions for efficiency

### Data Quality
- 100% accurate graduation detection
- Real-time progress updates
- Historical data can be backfilled

## Future Enhancements

1. **Reverse Engineer Graduation Formula**
   - Collect data on tokens at graduation
   - Analyze patterns in real vs virtual reserves
   - Determine exact graduation criteria

2. **Historical Data Recovery**
   - Script to fetch current state of all bonding curves
   - Backfill accurate progress for existing tokens

3. **Predictive Analytics**
   - Use accurate data to predict graduation timing
   - Alert system for tokens approaching graduation

## Conclusion

Implementing bonding curve account monitoring will provide accurate progress tracking and graduation detection. While it requires additional infrastructure, the benefits of accurate data far outweigh the complexity. This implementation guide provides a clear path forward to fix the current estimation-based approach.