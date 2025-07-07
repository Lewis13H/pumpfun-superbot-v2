# Wallet Classification System

## Overview
The wallet classification system categorizes blockchain addresses into distinct types based on behavior patterns, helping identify the quality and nature of token holders.

## Wallet Categories

### 1. Snipers
**Definition**: Wallets that buy tokens within the first few minutes (typically <5 minutes) of launch.

**Detection Methods**:
- Time-based: Purchase within `sniperTimeWindowSeconds` of token creation
- Pattern-based: Multiple early purchases across different tokens
- Association: Connected to known sniper networks

**Characteristics**:
- Very early transaction timestamps
- Often use MEV or priority fees
- Frequently sell within hours or days
- May use multiple wallets (wallet clusters)

**Impact on Score**: Heavy penalties (-15 to -50 points) as snipers often dump on retail.

### 2. Bots
**Definition**: Automated trading wallets using algorithms for trading decisions.

**Detection Methods**:
- Frequency analysis: Consistent time intervals between trades
- Volume patterns: High transaction count
- Multi-token activity: Trading many tokens simultaneously
- Technical patterns: Specific transaction signatures

**Bot Subtypes**:
- `pump_bot`: Specifically targets pump.fun tokens
- `mev_bot`: Executes MEV strategies
- `copy_trader`: Copies successful wallets
- `market_maker`: Provides liquidity algorithmically

**Impact on Score**: Moderate to heavy penalties depending on holdings percentage.

### 3. Bundlers
**Definition**: Wallets that use transaction bundling services (like Jito) for MEV extraction.

**Detection Methods**:
- Transaction analysis: Multiple transactions in same block
- Fee payer analysis: Different fee payer than transaction signer
- Known bundler services: Jito, Flashbots equivalents

**Why It Matters**:
- Indicates sophisticated traders
- Often extracting value from other traders
- Can manipulate prices within blocks

**Impact on Score**: Moderate penalties (-5 to -20 points).

### 4. Developers
**Definition**: Team wallets, creator addresses, and project-affiliated wallets.

**Detection Methods**:
- Token creation: Wallet that created the token
- Update authority: Has special permissions
- Treasury patterns: Receives regular allocations
- Vesting wallets: Time-locked tokens

**Subtypes**:
- `team_wallet`: Core team holdings
- `marketing_wallet`: Marketing allocations
- `treasury_wallet`: Project treasury

**Impact on Score**: Depends on percentage held; reasonable amounts (5-10%) are acceptable.

### 5. Whales
**Definition**: Large holders above a certain threshold (default: 1% of supply).

**Detection Methods**:
- Simple threshold: Holdings > `whaleMinPercentage`
- Relative ranking: Top N holders by percentage
- Historical accumulation: Built position over time

**Characteristics**:
- Can significantly impact price
- May be early investors or accumulated over time
- Could be exchanges or institutional holders

**Impact on Score**: Contributes to concentration penalties if collective whale holdings are high.

### 6. Normal/Organic
**Definition**: Regular retail investors without special patterns.

**Characteristics**:
- Human-like trading patterns
- Reasonable transaction frequency
- Diverse portfolio
- No suspicious associations

**Impact on Score**: Positive contribution to organic growth score.

## Classification Process

### 1. Data Collection
```typescript
// Sources of data for classification
- Transaction history (Helius/Shyft)
- Wallet portfolio analysis
- Trading patterns over time
- Known wallet databases
- Social/on-chain associations
```

### 2. Multi-Signal Analysis
The system uses multiple signals with confidence scoring:

```typescript
interface WalletDetectionMetadata {
  detectionMethod: string[];        // Methods used
  confidenceFactors: {
    tradingPattern?: number;        // 0-1 confidence
    timing?: number;               // 0-1 confidence
    association?: number;          // 0-1 confidence
    behavior?: number;             // 0-1 confidence
  };
  detectedPatterns?: string[];      // Specific patterns found
}
```

### 3. Confidence Scoring
Each classification comes with a confidence score (0-1):
- **0.9-1.0**: Very high confidence
- **0.7-0.9**: High confidence  
- **0.5-0.7**: Moderate confidence
- **<0.5**: Low confidence (may default to 'unknown')

### 4. Classification Priority
When multiple signals exist, priority order:
1. Developer (if created token)
2. Sniper (if bought very early)
3. Bundler (if using bundling)
4. Bot (if automated patterns)
5. Whale (if large holder)
6. Normal (default)

## Implementation Details

### API Integration
The system uses multiple APIs for comprehensive analysis:

**Helius API**:
- Wallet transaction history
- Token holdings
- Transaction patterns
- MEV activity detection

**Shyft DAS API**:
- Digital Asset Standard data
- Token holder information
- Wallet portfolio analysis
- Transaction details

### Caching Strategy
Classifications are cached to reduce API calls:
- Wallet classifications persist in database
- Confidence scores can be updated with new evidence
- Periodic re-evaluation for active wallets

### Batch Processing
For efficiency, wallets are classified in batches:
- Batch size: 10 wallets (configurable)
- Rate limiting: Respects API limits
- Parallel processing: Uses Promise.allSettled

## Best Practices

### 1. Regular Updates
- Re-classify wallets periodically
- Update confidence scores with new data
- Track classification accuracy

### 2. Conservative Classification
- When in doubt, classify as 'unknown'
- Require multiple signals for sniper/bot classification
- Allow for appeals/manual override

### 3. Context Awareness
- New tokens have different patterns
- Consider market conditions
- Account for network congestion effects

## Common Issues & Solutions

### False Positives
**Problem**: Regular traders classified as bots
**Solution**: 
- Increase confidence thresholds
- Add whitelist for known good actors
- Consider longer time windows

### API Limitations
**Problem**: Rate limits or missing data
**Solution**:
- Implement caching layer
- Use multiple data sources
- Graceful degradation

### Evolution of Patterns
**Problem**: Bot/sniper tactics evolve
**Solution**:
- Regular algorithm updates
- Machine learning integration
- Community reporting

## Future Improvements

1. **Machine Learning Models**
   - Train on confirmed classifications
   - Detect new patterns automatically
   - Improve accuracy over time

2. **Social Signal Integration**
   - Twitter/Discord activity correlation
   - Community vouching system
   - Reputation scores

3. **Cross-Chain Analysis**
   - Track wallets across multiple chains
   - Identify bridge patterns
   - Comprehensive wallet profiles

4. **Real-Time Classification**
   - Stream processing for instant classification
   - Alert system for suspicious activity
   - Dynamic score updates

## Metrics & Monitoring

Key metrics to track:
- Classification distribution (% of each type)
- Confidence score averages
- False positive/negative rates
- API usage and costs
- Processing time per wallet