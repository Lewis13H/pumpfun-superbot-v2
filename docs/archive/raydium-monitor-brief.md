# Raydium AMM Monitor - Key Findings

## Overview
Based on the shyft-code-examples, here's how Raydium AMM monitoring works:

## Program ID
- Raydium AMM V4: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`

## Instruction Discriminators
The Raydium AMM uses numeric discriminators (first byte of instruction data):
- 0: initialize
- 1: initialize2
- 2: monitorStep
- 3: deposit
- 4: withdraw
- 5: migrateToOpenBook
- 6: setParams
- 7: withdrawPnl
- 8: withdrawSrm
- 9: swapBaseIn (main swap type)
- 10: preInitialize
- 11: swapBaseOut (alternative swap type)
- 12: simulateInfo
- 13: adminCancelOrders
- 14: createConfigAccount
- 15: updateConfigAccount

## Swap Detection
There are two main swap instructions:
1. **swapBaseIn** (discriminator: 9) - User specifies exact input amount
2. **swapBaseOut** (discriminator: 11) - User specifies exact output amount

## Event Parsing
Raydium emits events in logs with format: `ray_log: <base64_data>`

Event discriminators (first byte of decoded log data):
- 0: Init
- 1: Deposit
- 2: Withdraw
- 3: SwapBaseIn
- 4: SwapBaseOut

## Buy/Sell Detection
The example code determines buy/sell by comparing token balances:
- If non-SOL token balance in Raydium pool decreases → Buy
- If non-SOL token balance in Raydium pool increases → Sell

## Key Accounts in Swap Instructions
For swapBaseIn/swapBaseOut:
- Index 1: amm (pool account)
- Index 5: poolCoinTokenAccount
- Index 6: poolPcTokenAccount
- Index 15: userSourceTokenAccount
- Index 16: userDestinationTokenAccount
- Index 17: userSourceOwner (signer)

## Implementation Notes
1. Parse instruction data to get discriminator (first byte)
2. Decode instruction args based on discriminator
3. Parse logs to get swap events with amounts
4. Use token balance changes to determine buy/sell direction
5. Extract pool reserves from poolCoinTokenAccount and poolPcTokenAccount