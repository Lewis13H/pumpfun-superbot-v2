Stale Price & trading history:  Pump.fun Superbot - Complete Implementation Plan
Executive Summary
This implementation plan outlines a hybrid strategy for the Pump.fun Superbot that addresses two critical needs:
Historical Trade Backfilling: Automatically collects comprehensive trade history when tokens reach $18,888 market cap
Stale Price Recovery: Efficiently updates prices for tokens with no recent trades using GraphQL bulk queries
Key Benefits
100x reduction in API calls for price recovery
Complete trade history for investment decision support
30-second recovery after downtime (vs 5+ minutes)
$0.10/day for price checks (vs $10+/day with RPC-only)
Technology Stack
Shyft GraphQL API: Bulk price recovery queries
Shyft RPC API: Detailed transaction history
gRPC Streaming: Real-time price monitoring
PostgreSQL: Data persistence
TypeScript/Node.js: Core implementation

1. System Architecture
1.1 Component Overview
┌─────────────────────────────────────────────────────────────┐
│                    Pump.fun Superbot V2                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  gRPC Monitor   │    │  Price Recovery  │                │
│  │  (Real-time)    │    │  (GraphQL)       │                │
│  └────────┬────────┘    └────────┬────────┘                │
│           │                      │                           │
│           ▼                      ▼                           │
│  ┌─────────────────────────────────────────┐                │
│  │         Event Processing Layer           │                │
│  │  • New token detection                   │                │
│  │  • Price updates                         │                │
│  │  • Stale token detection                │                │
│  │  • $18,888 threshold detection          │                │
│  └────────┬───────────────────┬────────────┘                │
│           │                   │                              │
│           ▼                   ▼                              │
│  ┌─────────────────┐  ┌──────────────────┐                 │
│  │ Stale Recovery  │  │ Trade Backfill   │                 │
│  │ Service         │  │ Service          │                 │
│  │ (GraphQL)       │  │ (RPC)            │                 │
│  └─────────────────┘  └──────────────────┘                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  PostgreSQL   │
                    │  Database     │
                    └───────────────┘

1.2 Data Flow
Real-time Monitoring: gRPC stream monitors all tokens
Event Detection: System detects stale tokens and threshold crossings
Recovery Actions: Triggers appropriate recovery/backfill services
Data Storage: Updates database with current prices and trade history
Analysis: Pattern detection and scoring enhancement

2. Database Schema
2.1 Enhanced Token Tracking
-- Add tracking fields to tokens table
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS last_trade_time TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT FALSE;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS stale_since TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS backfill_triggered_at TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS backfill_completed_at TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS backfill_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS launch_detected_at TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS first_trade_signature TEXT;

-- Create indexes for performance
CREATE INDEX idx_tokens_stale ON tokens(is_stale, last_trade_time) 
  WHERE NOT archived AND NOT graduated;
CREATE INDEX idx_tokens_backfill ON tokens(backfill_status, market_cap_usd) 
  WHERE backfill_status = 'pending';

2.2 Trade History Storage
-- Comprehensive trade history table
CREATE TABLE IF NOT EXISTS trade_history (
  id SERIAL PRIMARY KEY,
  signature TEXT UNIQUE NOT NULL,
  token_address TEXT NOT NULL REFERENCES tokens(address),
  trader_address TEXT NOT NULL,
  trade_type VARCHAR(10) NOT NULL, -- 'buy' or 'sell'
  token_amount NUMERIC(40,0) NOT NULL,
  sol_amount NUMERIC(20,8) NOT NULL,
  price_per_token NUMERIC(20,12) NOT NULL,
  price_usd NUMERIC(20,8),
  market_cap_at_trade NUMERIC(20,8),
  bonding_progress NUMERIC(5,2),
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  instruction_index INTEGER,
  inner_instruction_index INTEGER,
  is_initial_buy BOOLEAN DEFAULT FALSE,
  trader_category VARCHAR(20), -- 'sniper', 'whale', 'retail', 'bot'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient analysis
CREATE INDEX idx_trade_history_token_time ON trade_history(token_address, block_time DESC);
CREATE INDEX idx_trade_history_trader ON trade_history(trader_address, block_time DESC);
CREATE INDEX idx_trade_history_type ON trade_history(trade_type, token_address);

2.3 Recovery and Queue Management
-- Recovery tracking
CREATE TABLE IF NOT EXISTS recovery_logs (
  id SERIAL PRIMARY KEY,
  recovery_type VARCHAR(20) NOT NULL, -- 'startup', 'periodic', 'manual'
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  tokens_checked INTEGER DEFAULT 0,
  tokens_updated INTEGER DEFAULT 0,
  tokens_marked_stale INTEGER DEFAULT 0,
  graphql_queries INTEGER DEFAULT 0,
  rpc_calls INTEGER DEFAULT 0,
  downtime_duration INTERVAL,
  status VARCHAR(20) DEFAULT 'running',
  error_message TEXT
);

-- Backfill queue management
CREATE TABLE IF NOT EXISTS backfill_queue (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL UNIQUE,
  priority INTEGER DEFAULT 50, -- 1-100, higher = more urgent
  market_cap_at_trigger NUMERIC(20,8),
  current_progress NUMERIC(5,2),
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'queued',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


3. Phase 1: Stale Token Recovery System
3.1 Detection Mechanism
Stale Token Criteria:
No trades in the last 30 minutes
Token not graduated to Raydium
Token not archived
Last known market cap > $1,000
Detection Process:
Run every 5 minutes
Query tokens meeting stale criteria
Mark as stale in database
Trigger recovery process
3.2 GraphQL Bulk Recovery
Implementation Strategy:
Batch 100 tokens per GraphQL query
Single query retrieves all bonding curve states
Calculate prices from virtual reserves
Update database with current values
GraphQL Query Example:
query GetBondingCurves($tokens: [String!]) {
  pump_fun_BondingCurve(
    where: {
      tokenMint: {_in: $tokens},
      complete: {_eq: false}
    }
  ) {
    tokenMint
    virtualSolReserves
    virtualTokenReserves
    realSolReserves
    realTokenReserves
    complete
    pubkey
  }
}

3.3 Startup Recovery Process
When Monitor Restarts:
Detect downtime duration
If > 5 minutes, trigger full recovery
Prioritize tokens by market cap:
Critical: > $50,000
High: $20,000 - $50,000
Medium: $10,000 - $20,000
Low: $5,000 - $10,000
Process in priority order
Complete recovery in < 30 seconds

4. Phase 2: Trade History Backfilling
4.1 Threshold Detection
$18,888 Market Cap Trigger:
Monitor detects crossing in real-time
Verifies token hasn't been backfilled
Calculates priority score
Adds to backfill queue
Priority Scoring (1-100):
Base score: 50
+20 if bonding progress > 15%
+15 if reached threshold quickly (<30 mins)
+10 if high trading volume (>$50k)
+5 if many unique traders (>50)
-20 if suspicious patterns detected
4.2 Transaction Fetching
RPC API Strategy:
Start from current time, work backwards
Fetch 100 transactions per request
Continue until token creation
Parse pump.fun specific transactions
Extract trade details
Data Extracted:
Trade direction (buy/sell)
Token and SOL amounts
Trader wallet address
Exact timestamp
Transaction signature
4.3 Pattern Analysis
Launch Pattern Detection:
Sniper Bots:
Multiple buys in first 30 seconds
Connected wallet networks
Immediate sell pressure
Organic Launch:
Gradual buyer entry
Varied purchase amounts
Natural time gaps
Manipulation:
Wash trading patterns
Coordinated pumps
Artificial volume
Trader Classification:
Snipers: Buy within first minute, quick profit-taking
Whales: Large purchases (>$5,000), strategic entry
Retail: Small purchases (<$500), FOMO patterns
Bots: Programmatic behavior, consistent timing

5. Phase 3: Integration Layer
5.1 Event Processing
// Event-driven architecture
export class EventProcessor {
  constructor(
    private staleDetector: StaleTokenDetector,
    private thresholdDetector: ThresholdDetector,
    private priceRecovery: PriceRecoveryService,
    private backfillService: BackfillService
  ) {
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Stale token detection
    this.staleDetector.on('stale:detected', async (tokens) => {
      await this.priceRecovery.recoverPrices(tokens);
    });

    // Threshold crossing
    this.thresholdDetector.on('threshold:crossed', async (event) => {
      await this.backfillService.queueToken(event);
    });
  }
}

5.2 Worker Architecture
Backfill Workers:
3 concurrent workers maximum
Process highest priority tokens first
Rate limiting: 2 seconds between RPC batches
Progress tracking and resumability
Price Recovery:
Single worker for GraphQL queries
Processes batches of 100 tokens
1 second delay between batches
Circuit breaker for failures
5.3 Scoring Enhancement
Historical Data Impact:
Positive Indicators (+points):
Organic growth pattern (+50)
Many unique buyers (+30)
Steady accumulation (+40)
Low sniper activity (+20)
Negative Indicators (-points):
Heavy bot activity (-40)
Concentrated holdings (-30)
Wash trading detected (-50)
Rapid dumps after pumps (-35)

6. Implementation Timeline
Week 1: Foundation & GraphQL Integration
Days 1-2: Database schema implementation
Days 3-5: GraphQL client and stale detection service
Days 6-7: Price recovery service and testing
Week 2: RPC Backfilling System
Days 8-9: Threshold detection and queue system
Days 10-12: Transaction fetching and parsing
Days 13-14: Trade pattern analysis engine
Week 3: Integration & Workers
Days 15-16: Worker pool implementation
Days 17-19: System integration with monitor
Days 20-21: Performance optimization
Week 4: Production Deployment
Days 22-23: Comprehensive testing
Days 24-25: Monitoring setup
Days 26-27: Documentation
Day 28: Production deployment

7. Performance Optimization
7.1 Caching Strategy
Multi-Level Cache:
Hot Cache: Last 10 minutes (memory)
Warm Cache: Last hour (Redis/memory)
Cold Storage: Everything else (PostgreSQL)
7.2 API Usage Optimization
GraphQL Efficiency:
Batch 100 tokens per query
Cache bonding curve addresses
Skip recently updated tokens
Reuse GraphQL connections
RPC Management:
Maximum 10 calls per token
2-second delays between batches
Circuit breaker on failures
Fallback to alternative endpoints
7.3 Database Optimization
Performance Enhancements:
Partition trade_history by month
Materialized views for analytics
Background vacuum processes
Aggregate tables for dashboards

8. Monitoring & Alerts
8.1 Key Metrics
Stale Token Recovery:
Tokens marked stale per hour
Recovery success rate
Average recovery time
GraphQL queries per hour
Trade Backfilling:
Tokens crossing threshold daily
Queue depth and processing time
RPC calls per token
Pattern detection accuracy
8.2 Alert Configuration
alerts:
  # Critical alerts
  - name: high_value_stale
    condition: stale_token_mcap > 100000
    action: immediate_recovery
    
  - name: recovery_failure
    condition: recovery_success_rate < 0.8
    action: page_oncall
    
  # Warning alerts
  - name: queue_backup
    condition: backfill_queue_depth > 50
    action: scale_workers
    
  - name: high_stale_count
    condition: stale_tokens_count > 100
    action: check_system_health

8.3 Operational Dashboard
Real-time Metrics:
System health status
API usage vs limits
Queue depths
Processing rates
Error rates

9. Cost Analysis
9.1 API Usage Projection
Daily Operations:
Stale checks: 24 GraphQL queries (hourly batches)
Trade backfill: 500 tokens × 10 RPC calls = 5,000 RPC calls
Total cost: ~$0.50/day
Monthly Projection:
GraphQL: 720 queries = $7.20
RPC: 150,000 calls = $15.00
Total: ~$22.20/month
Savings: 95% reduction vs RPC-only approach
9.2 Performance Improvements
Stale Recovery:
Before: 5+ minutes, 1000+ RPC calls
After: 30 seconds, 1-2 GraphQL queries
Trade Backfill:
Processing time: ~30 seconds per token
Queue capacity: 1000+ tokens/day
Pattern accuracy: 90%

10. Success Criteria
10.1 Technical Metrics
Coverage: 95% of $18,888 tokens backfilled within 5 minutes
Accuracy: 90% correct pattern classification
Efficiency: <10 API calls per token average
Reliability: <1% backfill failure rate
10.2 Business Impact
Decision Quality: 25% improvement in investment decisions
Response Time: 10x faster price recovery
Cost Reduction: 95% lower API costs
Risk Mitigation: Early detection of manipulation patterns

11. Risk Management
11.1 Technical Risks
Mitigation Strategies:
Multiple API provider fallbacks
Data validation at every step
Horizontal scaling capability
Strict API budget controls
11.2 Operational Risks
Contingency Plans:
Manual recovery procedures
Rollback capabilities
Gradual deployment strategy
24/7 monitoring alerts

12. Future Enhancements
12.1 Machine Learning Integration
Pattern prediction models
Anomaly detection algorithms
Success probability scoring
Market trend analysis
12.2 Extended Analytics
Cross-token pattern correlation
Wallet behavior profiling
Social sentiment integration
Predictive alerts system
12.3 Scalability Improvements
Distributed worker architecture
Multi-region deployment
Advanced caching strategies
Real-time analytics pipeline

Conclusion
This implementation plan provides a comprehensive solution for both stale price recovery and historical trade analysis. By leveraging GraphQL for bulk queries and RPC for detailed history, the system achieves optimal performance while maintaining cost efficiency. The phased approach ensures smooth deployment with minimal risk to existing operations.

