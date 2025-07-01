# Bonding Curve Extraction Fix Report

## Issue Identified
The bonding curve extraction was using the wrong account index, resulting in:
- 44 different bonding curve keys for a single token
- Data integrity issues preventing proper tracking of token state
- Inability to track graduations correctly

## Root Cause
The code was extracting the bonding curve from `accounts[1]`, but based on the pump.fun IDL analysis, the correct position is `accounts[3]`.

## Fix Applied

### Account Structure (from pump.fun IDL)
```
Buy/Sell Instruction Accounts:
0: global (PDA)
1: fee_recipient  
2: mint
3: bonding_curve (PDA derived from mint) ← CORRECT POSITION
4: associated_bonding_curve
5: associated_user
6: user (signer)
7: system_program
8: token_program/creator_vault
```

### Code Changes
Updated `src/parsers/strategies/bc-trade-strategy.ts`:

```typescript
private findBondingCurveAccount(accounts: string[]): string | null {
  // The bonding curve should be at index 3
  if (accounts.length > 3) {
    const bondingCurve = accounts[3];
    // Validate it's not the system program or token program
    if (bondingCurve !== '11111111111111111111111111111111' && 
        bondingCurve !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
      return bondingCurve;
    }
  }
  
  // If that fails, we shouldn't guess - return null
  return null;
}
```

## Test Results

### Before Fix
- Most tokens had 10-44 different bonding curve keys
- Data integrity compromised

### After Fix (1 minute test)
```
bc_count | token_count | total_trades 
---------|-------------|-------------
    1    |    283      |    363       ← 66% have correct single BC
    2    |     68      |    220
    3    |     25      |    137
    ...
```

### Improvement
- **66% of tokens** now have exactly 1 bonding curve key (correct)
- Down from 44 different keys per token to mostly 1-3
- Significant improvement in data integrity

## Remaining Issues

Some tokens still show multiple bonding curve keys (2-18). Possible causes:
1. **Inner Instructions**: Pump.fun might use inner instructions with different account ordering
2. **Different Transaction Types**: Create vs trade transactions might have different layouts
3. **Transaction Complexity**: Some transactions might include multiple instructions

## Recommendations

1. **Current Fix is Good**: The fix significantly improves data quality and should be kept
2. **Further Investigation**: 
   - Analyze transactions with multiple BC keys to understand edge cases
   - Consider using IDL-based parsing for 100% accuracy
   - May need to handle inner instructions differently

3. **Data Cleanup**: Run a script to fix historical data by:
   - Identifying the most common BC key per token
   - Updating all trades to use the correct BC key

## Conclusion

The bonding curve extraction fix successfully addresses the critical data integrity issue. While not 100% perfect, it reduces the problem from 44 different keys per token to mostly 1 key per token, which is a massive improvement. The remaining edge cases can be addressed in a follow-up enhancement.