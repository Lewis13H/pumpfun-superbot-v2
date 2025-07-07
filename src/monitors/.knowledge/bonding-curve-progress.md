# Bonding Curve Progress Calculation

## The Problem That Took Days to Solve

We had tokens showing 100% progress with 85,000+ SOL in reserves - clearly wrong since graduation happens at 84 SOL.

## Root Cause

### What We Were Doing Wrong
```typescript
// ❌ INCORRECT - Using virtual reserves from trade events
const progress = (virtualSolReserves / LAMPORTS_PER_SOL / 85) * 100;
```

Trade events contain **post-trade reserve values**, not the actual SOL locked in the bonding curve. This led to massive calculation errors.

### The Correct Approach
```typescript
// ✅ CORRECT - Using account lamports
const accountInfo = await connection.getAccountInfo(bondingCurveAddress);
const solInCurve = accountInfo.lamports / LAMPORTS_PER_SOL;
const progress = (solInCurve / 84) * 100;
```

## Why This Matters

1. **Virtual Reserves ≠ Locked SOL**: Virtual reserves are used for price calculation, not progress
2. **Account Lamports = Truth**: The SOL balance of the bonding curve account is what actually matters
3. **84 not 85**: Graduation threshold is 84 SOL (confirmed via Shyft examples)

## Implementation Details

### Getting Bonding Curve Address
```typescript
const [bondingCurve] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("bonding-curve"),
    new PublicKey(mintAddress).toBuffer(),
  ],
  PUMP_PROGRAM
);
```

### Full Progress Calculation
```typescript
async function calculateAccurateProgress(mintAddress: string): Promise<number> {
  const bondingCurveAddress = deriveBondingCurveAddress(mintAddress);
  const accountInfo = await connection.getAccountInfo(bondingCurveAddress);
  
  if (!accountInfo) return 0;
  
  const solInCurve = accountInfo.lamports / LAMPORTS_PER_SOL;
  return Math.min((solInCurve / 84) * 100, 100);
}
```

## Common Pitfalls

1. **Don't use virtualSolReserves from trades** - Always wrong for progress
2. **Don't assume 85 SOL** - It's 84 SOL
3. **Don't forget null checks** - Account might not exist
4. **Don't trust calculated values** - Always verify against on-chain data

## Testing

Use these scripts to verify:
- `test-bc-progress-accuracy.ts` - Compare calculations
- `analyze-bc-progress-issues.ts` - Find discrepancies
- `reset-incorrect-bc-progress.ts` - Fix bad data

## References
- Original issue: monitors.md lines 11-30
- Fix implementation: token-lifecycle-monitor.ts
- Price calculator: price-calculator.ts line 44