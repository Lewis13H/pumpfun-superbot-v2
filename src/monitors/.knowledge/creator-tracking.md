# Creator Address Tracking

## Overview

The creator address is a crucial piece of token metadata that identifies who deployed the token on pump.fun. This information is stored in the bonding curve account and needs to be extracted during monitoring.

## Problem

Tokens were being discovered through trade monitoring but the creator address wasn't being captured, resulting in empty creator fields in the token detail page.

## Solution

### 1. Bonding Curve Schema
The bonding curve account includes a creator field:
```typescript
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'), // ← Creator address is here
]);
```

### 2. Capture During Monitoring
When processing bonding curve account updates in TokenLifecycleMonitor:
```typescript
// Update creator if we have it
if (bcData.creator && bcData.creator !== '11111111111111111111111111111111') {
  await this.dbService.updateTokenCreator(mintAddress, bcData.creator);
  this.logger.info('Updated token creator', {
    mint: mintAddress,
    creator: bcData.creator
  });
}
```

### 3. Database Update Method
Added to UnifiedDBService:
```typescript
async updateTokenCreator(mintAddress: string, creator: string): Promise<void> {
  try {
    await db.query(
      `UPDATE tokens_unified 
       SET creator = $2,
           updated_at = NOW()
       WHERE mint_address = $1`,
      [mintAddress, creator]
    );
  } catch (error) {
    console.error('Error updating token creator:', error);
  }
}
```

### 4. Retroactive Updates
For existing tokens without creators, use the update script:
```bash
npx tsx src/scripts/update-token-creators.ts
```

This script:
- Finds tokens without creator addresses
- Derives their bonding curve addresses
- Fetches account data from Solana
- Parses the creator field
- Updates the database

## Implementation Details

### Valid Creator Check
- System address `11111111111111111111111111111111` is ignored
- Only non-null, valid public keys are saved

### When Creator is Captured
1. **During account monitoring**: When bonding curve account is updated
2. **Via update script**: For existing tokens
3. **During token creation time fetch**: Some APIs return creator info

### Display
- Token detail page shows creator in Token Info section
- Format: First 6 chars...last 4 chars (e.g., `SnowgB...61grf`)
- Copyable on click

## Example

For SNOW token:
- Mint: `3dooHwfSrENkv1EV1s3kfQbHegxSBqZRX2ksYK2Bpump`
- Creator: `SnowgBeXhtb4TGVLFFiobbiQsfZE3f9256QHFT61grf`
- Bonding curve: Derived from mint using PDA
- Complete: false (still trading on BC)
- SOL Reserves: 73.978 SOL

## Related Files
- Implementation: `token-lifecycle-monitor.ts` lines 645-652
- Database service: `unified-db-service.ts` lines 656-668
- Update script: `src/scripts/update-token-creators.ts`
- Dashboard: `token-detail.html` line 799