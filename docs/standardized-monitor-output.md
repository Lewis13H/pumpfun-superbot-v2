# Standardized Monitor Output Examples

All 4 monitors now use consistent terminal formatting with chalk styling for better readability and alignment.

## 1. BC Trade Monitor (Bonding Curve)

```
════════════════════════════════════════════════════════════════════════════════
  BONDING CURVE MONITOR
════════════════════════════════════════════════════════════════════════════════
Program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
Started: 2025-06-29T15:00:00.000Z
Threshold: $8888 | Save All: false
────────────────────────────────────────────────────────────────────────────────
✅ SOL Price: $151.35
✅ Connected to gRPC stream

🟢 BUY TRADE
────────────────────────────────────────
Token: 7KZ4SwDi...
Amount: $124.56
Price: $0.000234
User: 9xYz3nFm...
Sig: 4gfrzcHNHGvh...

✅ 🎓 GRADUATION DETECTED! B5FEjRDYfABVZWBD6WSxxMcCjHxcHkLw3nR31mmppump

📊 STATISTICS
────────────────────────────────────────
Uptime: 0h 5m 12s
Transactions: 523 | Trades: 412
Errors: 0 | Warnings: 3
Parse Rate: 95.4%
Save Rate: 81.2%
Graduations: 2
Volume: $45,234.12
Unique Tokens: 87
SOL Price: $151.35

────────────────────────────────────────────────────────────────────────────────
Press Ctrl+C to stop monitoring...
```

## 2. BC Account Monitor

```
════════════════════════════════════════════════════════════════════════════════
  BC ACCOUNT MONITOR
════════════════════════════════════════════════════════════════════════════════
Program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
Started: 2025-06-29T15:00:00.000Z
Mode: Account State Tracking | Focus: Graduation Detection
────────────────────────────────────────────────────────────────────────────────
✅ Connected to gRPC stream

📍 BONDING CURVE UPDATE
────────────────────────────────────────
Account: Hx3TRJkV...
Progress: 87.5%
Complete: NO
Virtual SOL: 76.23 SOL
Real SOL: 46.23 SOL

✅ 🎓 GRADUATION DETECTED! Progress: 100.0%

📊 STATISTICS
────────────────────────────────────────
Uptime: 0h 5m 12s
Transactions: 0 | Trades: 0
Errors: 0 | Warnings: 5
Account Updates: 234
Active Accounts: 156
Graduations: 3
Mint Resolution Failures: 12

────────────────────────────────────────────────────────────────────────────────
Press Ctrl+C to stop monitoring...
```

## 3. AMM Trade Monitor

```
════════════════════════════════════════════════════════════════════════════════
  AMM POOL MONITOR
════════════════════════════════════════════════════════════════════════════════
Program: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
Started: 2025-06-29T15:00:00.000Z
Threshold: $1000 | Program: pump.swap
────────────────────────────────────────────────────────────────────────────────
✅ SOL Price: $151.35
✅ Connected to gRPC stream

🔴 SELL TRADE
────────────────────────────────────────
Token: AoHkzTUG...
Amount: $523.45
Price: $0.042156
User: 7xKm9pQr...
Sig: 2VbNmXyz8fGh...

ℹ️  📝 Creating new AMM token: HEdSqqZXQ5Tn4FnqpwjdRvwBQJypzyAVGK3gn4vhPUMP

📊 STATISTICS
────────────────────────────────────────
Uptime: 0h 5m 12s
Transactions: 234 | Trades: 89
Errors: 0 | Warnings: 0
Volume: $125,234.56
Buys: 45
Sells: 44
Buy/Sell Ratio: 102.3%
Unique Tokens: 23
New Tokens: 5
SOL Price: $151.35

────────────────────────────────────────────────────────────────────────────────
Press Ctrl+C to stop monitoring...
```

## 4. AMM Account Monitor

```
════════════════════════════════════════════════════════════════════════════════
  AMM ACCOUNT MONITOR
════════════════════════════════════════════════════════════════════════════════
Program: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
Started: 2025-06-29T15:00:00.000Z
Mode: Pool State Tracking | Focus: Reserve Updates
────────────────────────────────────────────────────────────────────────────────
✅ Loaded 357 existing pool states
✅ Connected to gRPC stream

📍 POOL STATE UPDATE
────────────────────────────────────────
Account: 7yRgxEXG...
Mint: So111111...
LP Supply: 4,193,388,303,129
Base Token: 9L9csbvj...
Quote Token: 4t5XtNp5...

📊 STATISTICS
────────────────────────────────────────
Uptime: 0h 5m 12s
Transactions: 0 | Trades: 0
Errors: 0 | Warnings: 0
Pool Updates: 156
Unique Pools: 89
Decoding Errors: 3
Status: Active
Cache Size: 89

────────────────────────────────────────────────────────────────────────────────
Press Ctrl+C to stop monitoring...
```

## Key Features of Standardized Output

### 1. **Consistent Header**
- Program ID displayed
- Start timestamp
- Configuration parameters shown

### 2. **Status Icons**
- ✅ Success (green)
- ❌ Error (red)
- ⚠️ Warning (yellow)
- ℹ️ Info (blue)
- 🟢 Buy trades (green)
- 🔴 Sell trades (red)
- 🎓 Graduations
- 📍 Account updates
- 📊 Statistics

### 3. **Trade/Update Format**
- Clear section dividers
- Consistent field layout
- Truncated addresses for readability
- Color-coded values

### 4. **Statistics Display**
- Updates every 10 seconds
- Common stats (uptime, transactions, errors)
- Monitor-specific stats
- Clear visual separation

### 5. **Error Logging**
- Errors show with ❌ icon
- Stack traces only with DEBUG_ERRORS=true
- Warnings tracked separately
- Clear error messages

## Running the Monitors

```bash
# Simplified versions with standardized output
npm run bc-monitor-simple      # BC trade monitor
npm run bc-account-simple      # BC account monitor  
npm run amm-monitor-simple     # AMM trade monitor
npm run amm-account-simple     # AMM account monitor

# Enable detailed error logging
DEBUG_ERRORS=true npm run bc-monitor-simple

# Run demo of all monitors
./scripts/demo-simplified-monitors.sh
```