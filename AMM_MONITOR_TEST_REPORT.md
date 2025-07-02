# AMM Monitor Test Report

## Test Overview
- **Test Date**: January 2, 2025
- **Test Duration**: ~5 minutes
- **Monitors Run**: amm-monitor, amm-account-monitor
- **Database**: pump_monitor_amm_enhancement (fresh, cleared before test)

## Data Collection Summary

### Overall Statistics
- **Total Trades Captured**: 2,157
- **Unique Tokens**: 78
- **Tokens Saved to DB**: 0 (critical issue)
- **AMM Pools Created**: 186
- **Pool States Recorded**: 181

### Critical Issue Identified

**All AMM trades have price_usd = 0.0000 and market_cap_usd = 0.0000**

This prevents:
1. Tokens from being saved (don't meet $1,000 threshold)
2. Price impact calculations from Session 5
3. Accurate market data tracking

## Sample Token Analysis (10 Random Tokens)

### 1. ygDC5bRFQcz7YKe8XoSbSLUB99LEtzqtoH6BKVMpump
- **Trade Count**: 162
- **Time Range**: 11:24:09 - 11:28:36 (4.5 minutes)
- **Sample Transaction**: [5Ux6LH2Vne7Q2c7ef3MpFozPXxkhxuqpKjNjkmiGvTjDaomzGmofvXzkVegmsv5GNDaf8weggQiY3A95LEbf1fUo](https://solscan.io/tx/5Ux6LH2Vne7Q2c7ef3MpFozPXxkhxuqpKjNjkmiGvTjDaomzGmofvXzkVegmsv5GNDaf8weggQiY3A95LEbf1fUo)
- **Trade Details**: Buy 2.2 SOL for 9,864,292,747,980 tokens
- **Price in DB**: $0.00
- **Pump.fun Link**: [View on pump.fun](https://pump.fun/ygDC5bRFQcz7YKe8XoSbSLUB99LEtzqtoH6BKVMpump)

### 2. FfkL2cZSnLnrbDV7ikAm6phe9zVu9Wa4AbhWAJDG9q92
- **Trade Count**: 79
- **Time Range**: 11:23:55 - 11:29:04 (5+ minutes)
- **Sample Transaction**: [23ahioVJufYxaY49nZu6wjTDa4dUGZdDHYadMvSvBEvdHQe6Cz9URb6P2TexXgsjKMDoeE7vWXrG8k57MLuU76oA](https://solscan.io/tx/23ahioVJufYxaY49nZu6wjTDa4dUGZdDHYadMvSvBEvdHQe6Cz9URb6P2TexXgsjKMDoeE7vWXrG8k57MLuU76oA)
- **Price in DB**: $0.00
- **Pump.fun Link**: [View on pump.fun](https://pump.fun/FfkL2cZSnLnrbDV7ikAm6phe9zVu9Wa4AbhWAJDG9q92)

### 3. DaRM6g63RD3YDKTVc7MqJbKefHS5a9fUv7FwaQ2kPUMP
- **Trade Count**: 70
- **Time Range**: 11:23:56 - 11:29:13 (5+ minutes)
- **Sample Transaction**: [2CWZcEKooTU52PBheYewYHLRjpNfYw7H7sfu6nPojtmGN8fDFojjaivfAVhp5vJF2wCHq5BF7s5qe4oyZ7kFPHKB](https://solscan.io/tx/2CWZcEKooTU52PBheYewYHLRjpNfYw7H7sfu6nPojtmGN8fDFojjaivfAVhp5vJF2wCHq5BF7s5qe4oyZ7kFPHKB)
- **Price in DB**: $0.00
- **Pump.fun Link**: [View on pump.fun](https://pump.fun/DaRM6g63RD3YDKTVc7MqJbKefHS5a9fUv7FwaQ2kPUMP)

### 4. 3fkvnQA6fPWXD92y24QUKnaEgNuNGDLLbmBL7M8S1r1C
- **Trade Count**: 42
- **Sample Transaction**: [29874aTA2U89WcHjixqQLscrE5Ha1eAeFBzvn4cGSJsmhPXnNZvBf8MPeu7TWPwb85fq3WGqXVUouEHqLw6jqHLv](https://solscan.io/tx/29874aTA2U89WcHjixqQLscrE5Ha1eAeFBzvn4cGSJsmhPXnNZvBf8MPeu7TWPwb85fq3WGqXVUouEHqLw6jqHLv)
- **Price in DB**: $0.00

### 5. DCAPCDmaYKQYE7bmJG8WRxqUu3XGBaVHvPMsXh5MrZ5i
- **Trade Count**: 33
- **Sample Transaction**: [22R5UAJeU6C7PfDuN3t2NxsMujWGc6JNvv8EHQeUc7sf1ngNdZxEfnPha11HHx6FWJZBfK9famwjrhc8JE8fxPbi](https://solscan.io/tx/22R5UAJeU6C7PfDuN3t2NxsMujWGc6JNvv8EHQeUc7sf1ngNdZxEfnPha11HHx6FWJZBfK9famwjrhc8JE8fxPbi)
- **Price in DB**: $0.00

### 6. 5jck1NbFE2KkFPFTNqsp5QP1c7fkAivJLTs4jm5xy783
- **Trade Count**: 14
- **Sample Transaction**: [2SZSyPWwCf7qzkZ1gCwgewmXKFc6bFsYQQp7C5roTZ1atAyXVRYLyT8Kt8X15XFLFfKUrwnLs8DNLMrjLKNyxT69](https://solscan.io/tx/2SZSyPWwCf7qzkZ1gCwgewmXKFc6bFsYQQp7C5roTZ1atAyXVRYLyT8Kt8X15XFLFfKUrwnLs8DNLMrjLKNyxT69)
- **Price in DB**: $0.00

### 7. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (USDC)
- **Trade Count**: 2
- **Sample Transaction**: [6xPNLEUg6wkh7tZB9kWgv9JRrucrcfpbkzNm7rfzGDJUckcDrvoLaqfF7cSujzzytnV8fpxcyNJDComJrXs1Yzd](https://solscan.io/tx/6xPNLEUg6wkh7tZB9kWgv9JRrucrcfpbkzNm7rfzGDJUckcDrvoLaqfF7cSujzzytnV8fpxcyNJDComJrXs1Yzd)
- **Note**: This is USDC, a well-known stablecoin

### 8-10. Single Trade Tokens
- **zByW1uVMmEmGpbr1yAgF9nxeDd6NKMRDbautoLwpump**: 1 trade
- **9KczPhWgTxeNMgqe216Q36u3c3HTQ5WihuAmT5AKe3e1**: 1 trade
- **54tdMu6znTZL3UJtpZcmPEjw1dMQZiFFHD5jkjx8pump**: 1 trade

## Key Findings

### 1. Trade Capture Works
- AMM monitor successfully captures trades
- Trade details (sol_amount, token_amount) are correct
- Buy/sell detection works properly
- Transaction signatures are valid and verifiable on Solscan

### 2. Price Calculation Broken
- All trades have price_usd = 0.0000
- All trades have market_cap_usd = 0.0000
- This prevents token saving (threshold not met)
- Price impact features cannot function

### 3. Pool State Issues
- Pool states are being saved but with zero reserves
- Virtual reserves show as 0 for all pools
- This likely causes the price calculation failure

### 4. Event Detection Issues
- No liquidity events detected (0 in amm_liquidity_events)
- No fee events captured
- LP position tracking cannot function without events

## Root Cause Analysis

The issue appears to be in the price calculation logic. Possible causes:
1. Virtual reserves not being properly extracted from pool states
2. SOL price not being fetched/cached
3. Price calculator receiving wrong data format
4. AMM pool decoder not parsing reserves correctly

## Recommendations

1. **Immediate Fix Needed**: Debug `priceCalculator.calculatePrice()` for AMM trades
2. **Check Pool State Parsing**: Verify virtual reserves are extracted correctly
3. **SOL Price Service**: Ensure SOL price is available during calculation
4. **Add Logging**: Add detailed logging to price calculation pipeline
5. **Test with Known Pools**: Use well-known AMM pools to verify calculations

## Impact

Without price calculations:
- No AMM tokens can be saved to database
- Market cap tracking is impossible
- Price impact analysis cannot function
- Dashboard shows no AMM token data
- All Session 5 enhancements are blocked

This is a **CRITICAL** issue that blocks most AMM functionality.