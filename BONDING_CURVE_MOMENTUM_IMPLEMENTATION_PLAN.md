# Bonding Curve Momentum Implementation Plan

## Overview
The Bonding Curve Momentum Scoring System (0-300 points) is designed to predict token success on pump.fun by analyzing progress velocity, early trading action, and graduation trajectory patterns. This system leverages real-time blockchain data to identify tokens with high momentum potential before they graduate to AMM.

## Scoring Breakdown

### 1. Progress Velocity (0-120 points)
Measures the speed and acceleration of bonding curve progress

#### 1.1 Milestone Velocity (0-40 points)
- **10% Progress Speed** (0-10 pts)
  - Under 30 mins: 10 pts
  - 30-60 mins: 8 pts
  - 1-2 hours: 6 pts
  - 2-4 hours: 4 pts
  - 4-8 hours: 2 pts
  - Over 8 hours: 0 pts

- **25% Progress Speed** (0-10 pts)
  - Under 1 hour: 10 pts
  - 1-2 hours: 8 pts
  - 2-4 hours: 6 pts
  - 4-8 hours: 4 pts
  - 8-16 hours: 2 pts
  - Over 16 hours: 0 pts

- **50% Progress Speed** (0-10 pts)
  - Under 2 hours: 10 pts
  - 2-4 hours: 8 pts
  - 4-8 hours: 6 pts
  - 8-16 hours: 4 pts
  - 16-24 hours: 2 pts
  - Over 24 hours: 0 pts

- **75% Progress Speed** (0-10 pts)
  - Under 4 hours: 10 pts
  - 4-8 hours: 8 pts
  - 8-12 hours: 6 pts
  - 12-24 hours: 4 pts
  - 24-48 hours: 2 pts
  - Over 48 hours: 0 pts

#### 1.2 Progress Acceleration (0-40 points)
- **Current Acceleration** (0-20 pts)
  - Measures if progress is speeding up or slowing down
  - Compare current hourly progress rate vs previous hour
  - Accelerating strongly (>200%): 20 pts
  - Accelerating (150-200%): 15 pts
  - Steady acceleration (120-150%): 10 pts
  - Maintaining pace (80-120%): 5 pts
  - Decelerating (<80%): 0 pts

- **Momentum Consistency** (0-20 pts)
  - Number of consecutive hours with positive progress
  - 10+ hours: 20 pts
  - 6-10 hours: 15 pts
  - 3-6 hours: 10 pts
  - 1-3 hours: 5 pts
  - Stalled: 0 pts

#### 1.3 Comparative Performance (0-40 points)
- **Percentile Ranking vs Graduated Tokens** (0-20 pts)
  - Compare progress speed to successful graduates at same age
  - Top 10%: 20 pts
  - Top 25%: 15 pts
  - Top 50%: 10 pts
  - Top 75%: 5 pts
  - Bottom 25%: 0 pts

- **Creator Track Record Bonus** (0-20 pts)
  - Creator graduation rate >75%: 20 pts
  - Creator graduation rate 50-75%: 15 pts
  - Creator graduation rate 25-50%: 10 pts
  - Creator graduation rate 10-25%: 5 pts
  - Creator graduation rate <10% or new: 0 pts

### 2. Early Action (0-100 points)
Analyzes initial trading patterns that predict future success

#### 2.1 First Hour Metrics (0-50 points)
- **First 10 Trades Analysis** (0-25 pts)
  - Average buy size > 0.5 SOL: 10 pts
  - Buy/sell ratio > 8:1: 8 pts
  - Average trade value increasing: 7 pts

- **First Hour Volume** (0-25 pts)
  - Over 50 SOL: 25 pts
  - 25-50 SOL: 20 pts
  - 10-25 SOL: 15 pts
  - 5-10 SOL: 10 pts
  - 2-5 SOL: 5 pts
  - Under 2 SOL: 0 pts

#### 2.2 Market Cap Velocity (0-50 points)
- **Time to $5k Market Cap** (0-15 pts)
  - Under 10 mins: 15 pts
  - 10-20 mins: 12 pts
  - 20-30 mins: 9 pts
  - 30-60 mins: 6 pts
  - 1-2 hours: 3 pts
  - Over 2 hours: 0 pts

- **Time to $25k Market Cap** (0-20 pts)
  - Under 30 mins: 20 pts
  - 30-45 mins: 16 pts
  - 45-60 mins: 12 pts
  - 1-2 hours: 8 pts
  - 2-4 hours: 4 pts
  - Over 4 hours: 0 pts

- **Time to $50k Market Cap** (0-15 pts)
  - Under 1 hour: 15 pts
  - 1-2 hours: 12 pts
  - 2-3 hours: 9 pts
  - 3-4 hours: 6 pts
  - 4-6 hours: 3 pts
  - Over 6 hours: 0 pts

### 3. Graduation Trajectory (0-80 points)
Predicts likelihood and timing of graduation

#### 3.1 Graduation Pace Analysis (0-40 points)
- **Projected Time to Graduation** (0-20 pts)
  - Based on current progress rate
  - Under 2 hours: 20 pts
  - 2-4 hours: 16 pts
  - 4-8 hours: 12 pts
  - 8-16 hours: 8 pts
  - 16-24 hours: 4 pts
  - Over 24 hours: 0 pts

- **Trajectory Stability** (0-20 pts)
  - Consistent upward trajectory: 20 pts
  - Minor dips (<10% reversals): 15 pts
  - Moderate volatility (10-20% reversals): 10 pts
  - High volatility (20-30% reversals): 5 pts
  - Major reversals (>30%): 0 pts

#### 3.2 Pattern Recognition (0-20 points)
- **Historical Pattern Match** (0-20 pts)
  - Match current trajectory to successful graduates
  - Strong match (>80% similarity): 20 pts
  - Good match (60-80% similarity): 15 pts
  - Moderate match (40-60% similarity): 10 pts
  - Weak match (20-40% similarity): 5 pts
  - No match (<20% similarity): 0 pts

#### 3.3 Risk Assessment (0-20 points)
- **Sell Pressure Analysis** (0-10 pts)
  - No major sell walls detected: 10 pts
  - Small sell walls (<10% of progress): 7 pts
  - Moderate sell walls (10-20% of progress): 4 pts
  - Large sell walls (>20% of progress): 0 pts

- **Concentration Risk** (0-10 pts)
  - Top 10 holders own <50%: 10 pts
  - Top 10 holders own 50-60%: 7 pts
  - Top 10 holders own 60-70%: 4 pts
  - Top 10 holders own >70%: 0 pts

## Data Requirements

### Primary Data Sources
1. **trades_unified table**
   - Trade history with timestamps
   - Market cap progression
   - Bonding curve progress
   - User addresses for unique trader counts

2. **tokens_unified table**
   - Current bonding curve progress
   - Creation timestamp
   - Creator address
   - Latest market metrics

3. **Calculated Metrics**
   - Progress velocity (% per hour)
   - Market cap growth rate
   - Trade frequency and volume patterns
   - Wallet quality scores

4. **Historical Patterns**
   - Graduated token trajectories
   - Creator success rates
   - Time to milestone distributions

### Real-time Data Collection
```typescript
interface BondingCurveMomentumData {
  // Progress tracking
  currentProgress: number;
  progressHistory: ProgressSnapshot[];
  milestoneTimestamps: MilestoneTimestamps;
  
  // Trading metrics
  tradeHistory: TradeSnapshot[];
  volumeMetrics: VolumeMetrics;
  tradingPatterns: TradingPatterns;
  
  // Trajectory analysis
  projectedGraduation: Date | null;
  trajectoryScore: number;
  riskFactors: RiskAssessment;
}

interface ProgressSnapshot {
  timestamp: Date;
  progress: number;
  marketCapUsd: number;
  volume1h: number;
  tradeCount1h: number;
}

interface MilestoneTimestamps {
  firstTrade: Date;
  reached10Percent?: Date;
  reached25Percent?: Date;
  reached50Percent?: Date;
  reached75Percent?: Date;
  marketCap5k?: Date;
  marketCap25k?: Date;
  marketCap50k?: Date;
}
```

## Implementation Architecture

### Core Components

1. **BondingCurveMomentumAnalyzer**
   - Main orchestrator for momentum scoring
   - Coordinates all sub-analyzers
   - Caches results for performance

2. **ProgressVelocityAnalyzer**
   - Tracks progress milestones
   - Calculates acceleration metrics
   - Compares to historical patterns

3. **EarlyActionAnalyzer**
   - Monitors first hour activity
   - Tracks market cap velocity
   - Analyzes trading patterns

4. **GraduationTrajectoryAnalyzer**
   - Projects graduation timing
   - Matches historical patterns
   - Assesses risk factors

5. **MomentumDataCollector**
   - Collects real-time trade data
   - Maintains progress history
   - Updates milestone timestamps

### Integration Points

1. **Trade Handler Integration**
   - Update momentum data on each trade
   - Trigger recalculation of scores
   - Store snapshots for history

2. **Database Schema Updates**
   ```sql
   -- Momentum tracking table
   CREATE TABLE bonding_curve_momentum (
     mint_address VARCHAR(44) PRIMARY KEY,
     current_score INTEGER,
     progress_velocity_score INTEGER,
     early_action_score INTEGER,
     graduation_trajectory_score INTEGER,
     
     -- Milestone timestamps
     reached_10_percent_at TIMESTAMPTZ,
     reached_25_percent_at TIMESTAMPTZ,
     reached_50_percent_at TIMESTAMPTZ,
     reached_75_percent_at TIMESTAMPTZ,
     
     -- Velocity metrics
     current_velocity_per_hour DECIMAL,
     peak_velocity_per_hour DECIMAL,
     acceleration_factor DECIMAL,
     
     -- Early action metrics
     first_hour_volume_sol DECIMAL,
     first_hour_trade_count INTEGER,
     time_to_5k_mcap_minutes INTEGER,
     time_to_25k_mcap_minutes INTEGER,
     time_to_50k_mcap_minutes INTEGER,
     
     -- Trajectory metrics
     projected_graduation_at TIMESTAMPTZ,
     trajectory_confidence DECIMAL,
     pattern_match_score DECIMAL,
     
     -- Metadata
     last_updated TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   
   -- Progress history for pattern matching
   CREATE TABLE bonding_curve_progress_history (
     id SERIAL PRIMARY KEY,
     mint_address VARCHAR(44),
     timestamp TIMESTAMPTZ,
     progress DECIMAL,
     market_cap_usd DECIMAL,
     volume_1h_sol DECIMAL,
     trade_count_1h INTEGER,
     
     INDEX idx_mint_timestamp (mint_address, timestamp DESC)
   );
   ```

3. **API Endpoints**
   ```typescript
   // Real-time momentum score
   GET /api/bonding-curve/momentum/:mintAddress
   
   // Top momentum tokens
   GET /api/bonding-curve/top-momentum
   
   // Historical momentum analysis
   GET /api/bonding-curve/momentum-history/:mintAddress
   
   // Graduation predictions
   GET /api/bonding-curve/graduation-predictions
   ```

## Performance Considerations

1. **Caching Strategy**
   - Cache momentum scores for 30 seconds
   - Cache milestone timestamps permanently
   - Update scores on significant events (new milestones, large trades)

2. **Batch Processing**
   - Process multiple tokens in parallel
   - Use database views for common calculations
   - Implement efficient pattern matching algorithms

3. **Real-time Updates**
   - Subscribe to trade events
   - Update only affected metrics
   - Broadcast score changes via WebSocket

## Success Metrics

1. **Prediction Accuracy**
   - % of high-score tokens that graduate
   - % of graduated tokens that scored high early
   - Average score of successful graduates

2. **Timing Accuracy**
   - Accuracy of graduation time predictions
   - Early detection rate (identifying winners in first hour)

3. **Performance Metrics**
   - Score calculation time
   - Update latency
   - Cache hit rate

## Future Enhancements

1. **Machine Learning Integration**
   - Train models on historical graduation data
   - Improve pattern matching algorithms
   - Dynamic weight adjustment

2. **Advanced Risk Analysis**
   - MEV detection in bonding curve trades
   - Whale manipulation detection
   - Social sentiment integration

3. **Cross-chain Analysis**
   - Compare to successful launches on other chains
   - Identify cross-chain patterns
   - Multi-chain momentum tracking