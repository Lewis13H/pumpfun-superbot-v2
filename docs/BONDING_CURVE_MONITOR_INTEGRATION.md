# Bonding Curve Monitor Integration Guide

Based on the Shyft code examples, here's how to integrate accurate bonding curve monitoring into the existing `TokenLifecycleMonitor`.

## Key Insights from Shyft Examples

### 1. Account-Based Monitoring
The most efficient approach (from `stream_pump_fun_bonding_curve_progress_accounts`):
- Subscribe to pump.fun accounts using owner filter
- Decode accounts using BorshAccountsCoder with pump.fun IDL
- Calculate progress from account lamports: `(lamports / 84 SOL) * 100`
- The 84 SOL target represents graduation

### 2. Bonding Curve Account Structure
```typescript
{
  discriminator: u64,
  virtualTokenReserves: u64,
  virtualSolReserves: u64,
  realTokenReserves: u64,
  realSolReserves: u64,
  tokenTotalSupply: u64,
  complete: bool  // This indicates graduation!
}
```

### 3. Filtering for Completed Curves
From `stream_completed_bonding_curve`, you can use memcmp filter:
```typescript
filters: [{
  memcmp: {
    offset: structure.offsetOf('complete').toString(),
    bytes: Uint8Array.from([1])
  }
}]
```

## Integration Steps for Existing Monitor

### Step 1: Add Account Subscription

Add to `TokenLifecycleMonitor.onStart()`:

```typescript
// Subscribe to pump.fun account updates
const streamClient = await this.container.resolve('StreamClient');
await streamClient.subscribeToAccountsByOwner(
  PUMP_PROGRAM,
  (accountData: any) => this.handleBondingCurveAccount(accountData)
);
```

### Step 2: Add Account Handler

```typescript
private async handleBondingCurveAccount(accountData: any): Promise<void> {
  try {
    // Check if this is a BondingCurve account by discriminator
    const data = Buffer.from(accountData.account.data, 'base64');
    const discriminator = data.slice(0, 8);
    
    // BondingCurve discriminator (from IDL)
    const bcDiscriminator = this.accountCoder.accountDiscriminator('BondingCurve');
    if (!discriminator.equals(bcDiscriminator)) {
      return;
    }

    // Decode the account
    const decodedData = this.accountCoder.decodeAny(data);
    const pubkey = bs58.encode(accountData.account.pubkey);
    const lamports = accountData.account.lamports;

    // Calculate progress (84 SOL = 100%)
    const solInCurve = lamports / 1e9;
    const progress = Math.min((solInCurve / 84) * 100, 100);

    // Check if graduated
    if (decodedData.complete) {
      this.logger.info('🎓 Token graduated via bonding curve complete flag!', {
        bondingCurve: pubkey,
        finalProgress: progress,
        finalSol: solInCurve
      });

      this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
        bondingCurveAddress: pubkey,
        complete: true,
        progress: 100
      });
    }

    // Emit progress update
    this.eventBus.emit(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, {
      bondingCurveAddress: pubkey,
      progress,
      complete: decodedData.complete,
      lamports,
      virtualSolReserves: decodedData.virtualSolReserves,
      realSolReserves: decodedData.realSolReserves
    });

  } catch (error) {
    this.logger.error('Failed to handle bonding curve account', error);
  }
}
```

### Step 3: Update Progress Calculation

Replace the hardcoded 85 SOL with 84 SOL (from Shyft examples):

```typescript
// In price-calculator.ts
private readonly BONDING_CURVE_PROGRESS_SOL = 84; // Updated from 85

calculateBondingCurveProgress(virtualSolReserves: bigint, isComplete?: boolean): number {
  if (isComplete) {
    return 100;
  }
  
  const solInCurve = Number(virtualSolReserves) / Number(LAMPORTS_PER_SOL);
  const progress = (solInCurve / this.BONDING_CURVE_PROGRESS_SOL) * 100;
  
  return Math.min(progress, 100);
}
```

### Step 4: Add IDL and Account Coder

```typescript
// In constructor
const idlPath = './src/idls/pump_0.1.0.json';
const programIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
this.accountCoder = new BorshAccountsCoder(programIdl);
```

### Step 5: Update Database on Progress Changes

```typescript
// Add to handleBondingCurveAccount
if (progress !== previousProgress || decodedData.complete !== previousComplete) {
  await this.database.query(`
    UPDATE tokens_unified 
    SET 
      latest_bonding_curve_progress = $1,
      graduated_to_amm = $2,
      updated_at = NOW()
    WHERE bonding_curve_key = $3
  `, [progress, decodedData.complete, pubkey]);
}
```

## Benefits of This Approach

1. **Real-time Updates**: Get instant notifications when bonding curve state changes
2. **Accurate Progress**: Based on actual lamports in the account
3. **Graduation Detection**: The `complete` boolean gives definitive graduation status
4. **Efficient**: Only processes BondingCurve accounts, not all pump.fun accounts

## Testing

Use the Shyft example scripts to verify:
```bash
cd shyft-code-examples/bonding\ curve/stream_pump_fun_bonding_curve_progress_accounts
npm install
npm start
```

This will show you real-time bonding curve progress updates to compare with your implementation.

## Notes

- The 84 SOL threshold appears to be the actual graduation point (not 85)
- Progress is calculated from account lamports, not virtual reserves
- The `complete` field is the definitive indicator of graduation
- Account updates are less frequent than transactions but more accurate