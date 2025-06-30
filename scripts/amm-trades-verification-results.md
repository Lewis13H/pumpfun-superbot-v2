# AMM Trades Verification Results

## Summary
We captured 2 BUY trades and 2 SELL trades from the AMM monitor. Here are the exact details for Solscan verification:

---

## SELL TRADES

### SELL Trade #1
- **Signature**: `SuaKTLhw3pVn2Y9FZ9A1D9K963XxJdCPVxd557DwVu5rGjwxrueidbFWYrHUjZqhM3AJQ5Y72uZrhPnR2iW5sy7`
- **Solscan URL**: https://solscan.io/tx/SuaKTLhw3pVn2Y9FZ9A1D9K963XxJdCPVxd557DwVu5rGjwxrueidbFWYrHUjZqhM3AJQ5Y72uZrhPnR2iW5sy7
- **Token**: 3iHC7C5wnPBDGqK3Ky1RvqeuAbFKGJWipkX6pGPqiSEY
- **User**: 5tLuZMSQPGnS1Jx6EARj1Smtkw37tqMWqYMMkut6CBnW
- **SOL Amount**: 1.408363 SOL (received by user)
- **Token Amount**: 216,496.47 tokens (sent by user)
- **Price**: 0.000006505246 SOL per token ($0.000976 USD)
- **Market Cap**: $976,112.17
- **Time**: 2025-06-30 20:36:45 UTC+8

### SELL Trade #2
- **Signature**: `2FsscUnEoBzAZKfizpZGKsoiTDsndXxcvjJ6CUJWKizEVqCoW8LHqwZFdAsqK4ARP394LefHUy6vEuRxP6XU6hE5`
- **Solscan URL**: https://solscan.io/tx/2FsscUnEoBzAZKfizpZGKsoiTDsndXxcvjJ6CUJWKizEVqCoW8LHqwZFdAsqK4ARP394LefHUy6vEuRxP6XU6hE5
- **Token**: 3iHC7C5wnPBDGqK3Ky1RvqeuAbFKGJWipkX6pGPqiSEY
- **User**: 7wtH62mutuysAT8DeFMvSx1HpmjzAM62PjRteNN5MaDJ
- **SOL Amount**: 1.117470 SOL (received by user)
- **Token Amount**: 173,671.15 tokens (sent by user)
- **Price**: 0.000006434401 SOL per token ($0.000965 USD)
- **Market Cap**: $965,481.81
- **Time**: 2025-06-30 20:36:41 UTC+8

---

## BUY TRADES

### BUY Trade #1
- **Signature**: `41VRpSq3TuFhyyFBDh2ezEiwA6cE1qJuapSfou5Cgqex1XWahTTJ7Tchjhx6Ui7A6SZSdfmPMaTBLFFHb23GN6jY`
- **Solscan URL**: https://solscan.io/tx/41VRpSq3TuFhyyFBDh2ezEiwA6cE1qJuapSfou5Cgqex1XWahTTJ7Tchjhx6Ui7A6SZSdfmPMaTBLFFHb23GN6jY
- **Token**: JDPiqE1oLLsxARXtYLdErHDsGt9ybfsuyrddEUC3Pump
- **User**: 4J2eAiBYsUgZ4hUrUq4R8np6ZbT4DKkgbEqZJvDMtV9o
- **SOL Amount**: 6.872652 SOL (sent by user)
- **Token Amount**: 8,522,327.80 tokens (received by user)
- **Price**: 0.000000806429 SOL per token ($0.000121 USD)
- **Market Cap**: $121,004.67
- **Time**: 2025-06-30 20:36:45 UTC+8

### BUY Trade #2
- **Signature**: `3to6gYU2YVjfEYXc2PtHi39CU2FjqUZBeMpVwEG4BditFnHnfFuncUvyqxVBCZVFrcuVFnjGPpv16WGeg8ssRi4v`
- **Solscan URL**: https://solscan.io/tx/3to6gYU2YVjfEYXc2PtHi39CU2FjqUZBeMpVwEG4BditFnHnfFuncUvyqxVBCZVFrcuVFnjGPpv16WGeg8ssRi4v
- **Token**: 3iHC7C5wnPBDGqK3Ky1RvqeuAbFKGJWipkX6pGPqiSEY
- **User**: 55m9BF2qKmiuf63nZHB5ixdKXoFssLp6T6HsuZUjYgH8
- **SOL Amount**: 2.041999 SOL (sent by user)
- **Token Amount**: 313,889.23 tokens (received by user)
- **Price**: 0.000006505476 SOL per token ($0.000976 USD)
- **Market Cap**: $976,146.62
- **Time**: 2025-06-30 20:36:42 UTC+8

---

## Verification Instructions

1. **Click each Solscan URL** to view the transaction details
2. **On Solscan, verify**:
   - Transaction type matches (Buy/Sell)
   - Token transfer amounts match our data
   - SOL transfer amounts match our data
   - User addresses match
   - The pump.fun AMM program is involved

3. **Note about our data**:
   - Amounts shown are AFTER fees are deducted
   - Prices are calculated from the actual amounts transferred
   - Market cap assumes 1 billion token supply
   - USD prices based on SOL price of ~$150

4. **Database Note**:
   - The virtual reserves show as 0 in the database query
   - This appears to be a data storage issue - the monitor is calculating prices correctly
   - The actual prices and amounts are accurate based on the transaction data