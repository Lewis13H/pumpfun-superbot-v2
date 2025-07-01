# PumpFun DexScreener - Complete Implementation Plan

## Vision
Build a real-time analytics platform for pump.fun tokens that rivals DexScreener's capabilities, with sub-second data updates, comprehensive charts, and advanced trading insights.

## Core Architecture

### Data Flow Pipeline
```
Solana Blockchain
    ↓
gRPC Stream (Shyft/Helius)
    ↓
Stream Multiplexer
    ↓
Parse Workers (Parallel)
    ↓
Message Queue (Kafka/RedPanda)
    ↓
Processing Pipeline
    ├── Real-time DB (Redis/DragonflyDB)
    ├── Time-series DB (TimescaleDB/QuestDB)
    ├── Search Engine (Elasticsearch)
    └── Analytics DB (ClickHouse)
    ↓
WebSocket Server (Socket.io Cluster)
    ↓
CDN (Cloudflare)
    ↓
React Frontend
```

## Phase 1: High-Performance Data Ingestion (Week 1)

### 1.1 Stream Infrastructure

#### Services Required:
```yaml
# docker-compose.streaming.yml
services:
  # Message Queue for buffering
  redpanda:
    image: vectorized/redpanda:latest
    ports:
      - "9092:9092"
      - "9644:9644"
    command:
      - redpanda start
      - --overprovisioned
      - --smp 4
      - --memory 8G
      - --reserve-memory 0M
      - --node-id 0
      - --kafka-addr PLAINTEXT://0.0.0.0:9092
    volumes:
      - redpanda-data:/var/lib/redpanda/data

  # High-performance Redis alternative
  dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly:latest
    ports:
      - "6379:6379"
    command:
      - --maxmemory=32gb
      - --hz=100
      - --tcp_keepalive=60
    volumes:
      - dragonfly-data:/data
```

#### Stream Multiplexer Implementation:
```typescript
// src/infrastructure/stream-multiplexer.ts
import { Client as YellowstoneClient } from '@triton-one/yellowstone-grpc';
import { Kafka, Producer, Consumer } from 'kafkajs';
import { Worker } from 'worker_threads';
import pLimit from 'p-limit';

export class StreamMultiplexer {
  private yellowstoneClients: YellowstoneClient[] = [];
  private kafka: Kafka;
  private producer: Producer;
  private parseWorkers: Worker[] = [];
  private rateLimiter = pLimit(100); // Max 100 concurrent operations
  
  constructor(private config: StreamConfig) {
    // Initialize multiple gRPC connections for redundancy
    this.initializeClients();
    
    // Setup Kafka/RedPanda
    this.kafka = new Kafka({
      clientId: 'pumpfun-stream',
      brokers: config.kafkaBrokers,
      connectionTimeout: 3000,
      requestTimeout: 25000,
    });
    
    // Initialize parse workers (CPU cores - 1)
    this.initializeWorkers();
  }
  
  private initializeClients() {
    // Create 3 gRPC clients for load balancing
    const endpoints = [
      this.config.primaryEndpoint,
      this.config.secondaryEndpoint,
      this.config.tertiaryEndpoint
    ];
    
    this.yellowstoneClients = endpoints.map(endpoint => 
      new YellowstoneClient(endpoint, this.config.token, {
        'grpc.keepalive_time_ms': 30000,
        'grpc.keepalive_timeout_ms': 10000,
        'grpc.max_receive_message_length': 1024 * 1024 * 64, // 64MB
      })
    );
  }
  
  private initializeWorkers() {
    const numWorkers = os.cpus().length - 1;
    
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker('./parse-worker.js', {
        workerData: { workerId: i }
      });
      
      worker.on('message', async (result) => {
        // Send parsed data to Kafka
        await this.producer.send({
          topic: result.program === 'bonding_curve' ? 'bc-trades' : 'amm-trades',
          messages: [{
            key: result.signature,
            value: JSON.stringify(result),
            headers: {
              'program': result.program,
              'timestamp': Date.now().toString()
            }
          }]
        });
      });
      
      this.parseWorkers.push(worker);
    }
  }
  
  async start() {
    // Connect producer
    this.producer = this.kafka.producer({
      maxInFlightRequests: 100,
      compression: CompressionTypes.SNAPPY,
    });
    await this.producer.connect();
    
    // Start streams with automatic failover
    this.startStreamsWithFailover();
  }
  
  private async startStreamsWithFailover() {
    for (let i = 0; i < this.yellowstoneClients.length; i++) {
      this.startSingleStream(i);
    }
  }
  
  private async startSingleStream(clientIndex: number) {
    const client = this.yellowstoneClients[clientIndex];
    
    try {
      const stream = await client.subscribe(this.buildSubscriptionRequest());
      
      stream.on('data', (data) => {
        // Rate limit and distribute to workers
        this.rateLimiter(async () => {
          const workerIndex = Math.floor(Math.random() * this.parseWorkers.length);
          this.parseWorkers[workerIndex].postMessage(data);
        });
      });
      
      stream.on('error', (error) => {
        console.error(`Stream ${clientIndex} error:`, error);
        // Exponential backoff reconnect
        setTimeout(() => this.startSingleStream(clientIndex), Math.pow(2, clientIndex) * 1000);
      });
      
    } catch (error) {
      console.error(`Failed to start stream ${clientIndex}:`, error);
      // Retry with backoff
      setTimeout(() => this.startSingleStream(clientIndex), 5000);
    }
  }
}
```

#### Parse Worker Implementation:
```typescript
// src/workers/parse-worker.js
const { parentPort, workerData } = require('worker_threads');
const { EventParser } = require('../parsers/optimized-event-parser');
const LRU = require('lru-cache');

// Worker-specific cache
const cache = new LRU({ max: 10000 });
const parser = new EventParser();

parentPort.on('message', async (data) => {
  try {
    // Check cache for duplicate signatures
    const signature = extractSignature(data);
    if (cache.has(signature)) return;
    
    // Parse based on data type
    let result;
    if (data.transaction) {
      result = await parser.parseTransaction(data);
    } else if (data.account) {
      result = await parser.parseAccountUpdate(data);
    }
    
    if (result) {
      cache.set(signature, true);
      parentPort.postMessage(result);
    }
  } catch (error) {
    console.error(`Worker ${workerData.workerId} parse error:`, error);
  }
});
```

### 1.2 Optimized Event Parser

```typescript
// src/parsers/optimized-event-parser.ts
import { BorshCoder, BorshAccountsCoder, EventParser as AnchorEventParser } from '@coral-xyz/anchor';
import { IDL as PumpFunIDL } from '../idl/pump_fun';
import { IDL as PumpSwapIDL } from '../idl/pump_swap';
import pako from 'pako';

export class OptimizedEventParser {
  private bcCoder: BorshCoder;
  private ammCoder: BorshCoder;
  private bcEventParser: AnchorEventParser;
  private ammEventParser: AnchorEventParser;
  
  // Pre-compiled regex patterns
  private patterns = {
    buyLog: /Program log: buy: mint=(\w+), sol_amount=(\d+), token_amount=(\d+)/,
    sellLog: /Program log: sell: mint=(\w+), sol_amount=(\d+), token_amount=(\d+)/,
    rayLog: /ray_log: ({.+})/,
    migrate: /Program log: Instruction: Migrate/,
    createPool: /Program log: Instruction: CreatePool/,
  };
  
  constructor() {
    this.bcCoder = new BorshCoder(PumpFunIDL);
    this.ammCoder = new BorshCoder(PumpSwapIDL);
    this.bcEventParser = new AnchorEventParser(this.bcCoder);
    this.ammEventParser = new AnchorEventParser(this.ammCoder);
  }
  
  async parseTransaction(data: any): Promise<ParsedTrade | null> {
    const tx = data.transaction?.transaction;
    if (!tx) return null;
    
    // Extract basic info
    const signature = bs58.encode(data.signature);
    const slot = data.slot;
    const blockTime = new Date(tx.blockTime * 1000);
    
    // Determine program type
    const accountKeys = tx.message.accountKeys.map(k => bs58.encode(k));
    const isPump = accountKeys.includes(PUMP_PROGRAM);
    const isAmm = accountKeys.includes(AMM_PROGRAM);
    
    if (!isPump && !isAmm) return null;
    
    // Parse logs for trade data
    const logs = data.transaction.meta?.logMessages || [];
    const tradeData = this.parseLogsOptimized(logs, isPump);
    
    if (!tradeData) return null;
    
    // Extract metadata from transaction
    const metadata = this.extractMetadata(data.transaction);
    
    // Calculate derived fields
    const priceData = this.calculatePrices(tradeData, metadata);
    
    return {
      signature,
      slot,
      blockTime,
      program: isPump ? 'bonding_curve' : 'amm_pool',
      ...tradeData,
      ...metadata,
      ...priceData,
      rawData: data // Keep raw data for recovery
    };
  }
  
  private parseLogsOptimized(logs: string[], isPump: boolean): TradeData | null {
    // Fast path for common patterns
    for (const log of logs) {
      // Check buy pattern
      let match = log.match(this.patterns.buyLog);
      if (match) {
        return {
          tradeType: 'buy',
          mintAddress: match[1],
          solAmount: BigInt(match[2]),
          tokenAmount: BigInt(match[3]),
        };
      }
      
      // Check sell pattern
      match = log.match(this.patterns.sellLog);
      if (match) {
        return {
          tradeType: 'sell',
          mintAddress: match[1],
          solAmount: BigInt(match[2]),
          tokenAmount: BigInt(match[3]),
        };
      }
      
      // Check ray_log for AMM
      if (!isPump) {
        match = log.match(this.patterns.rayLog);
        if (match) {
          try {
            const data = JSON.parse(match[1]);
            return this.parseRayLog(data);
          } catch {}
        }
      }
    }
    
    // Fallback to event parsing
    return this.parseEventsFromLogs(logs, isPump);
  }
  
  private extractMetadata(transaction: any): TransactionMetadata {
    const meta = transaction.meta;
    
    return {
      // Balance changes for exact amounts
      balanceChanges: this.extractBalanceChanges(
        meta.preTokenBalances,
        meta.postTokenBalances
      ),
      
      // Compute units for MEV detection
      computeUnits: meta.computeUnitsConsumed || 0,
      
      // Priority fee calculation
      priorityFee: this.calculatePriorityFee(meta),
      
      // Inner instructions for cross-program calls
      innerInstructions: meta.innerInstructions || [],
      
      // Extract signer
      signer: this.extractSigner(transaction),
      
      // Token decimals
      decimals: this.extractDecimals(meta.postTokenBalances),
    };
  }
}
```

### 1.3 Database Layer

#### Time-Series Database Setup:
```yaml
# docker-compose.databases.yml
services:
  # Time-series data
  timescale:
    image: timescale/timescaledb-ha:pg14-latest
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: pumpfun_analytics
    volumes:
      - timescale-data:/var/lib/postgresql/data
    command:
      - postgres
      - -c
      - shared_buffers=4GB
      - -c
      - effective_cache_size=12GB
      - -c
      - maintenance_work_mem=1GB
      - -c
      - work_mem=256MB
      - -c
      - max_connections=500
      - -c
      - random_page_cost=1.1
      - -c
      - effective_io_concurrency=200
      
  # Analytics database
  clickhouse:
    image: clickhouse/clickhouse-server:latest
    ports:
      - "8123:8123"
      - "9000:9000"
    volumes:
      - clickhouse-data:/var/lib/clickhouse
    environment:
      CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD}
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
        
  # Search engine
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.1
    ports:
      - "9200:9200"
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms4g -Xmx4g"
    volumes:
      - elastic-data:/usr/share/elasticsearch/data
```

#### Optimized Schema:
```sql
-- TimescaleDB schema for real-time data
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Main trades table (partitioned by time)
CREATE TABLE trades (
    time TIMESTAMPTZ NOT NULL,
    signature VARCHAR(88) NOT NULL,
    mint_address VARCHAR(64) NOT NULL,
    program program_type NOT NULL,
    trade_type trade_type NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    price_sol DECIMAL(20,12) NOT NULL,
    price_usd DECIMAL(20,4) NOT NULL,
    market_cap_usd DECIMAL(20,4),
    
    -- Reserves
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    real_sol_reserves BIGINT,
    real_token_reserves BIGINT,
    
    -- Metadata
    compute_units INTEGER,
    priority_fee BIGINT,
    slot BIGINT NOT NULL,
    
    -- Indexes for queries
    PRIMARY KEY (time, signature)
);

-- Convert to hypertable
SELECT create_hypertable('trades', 'time', 
  chunk_time_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- Compression policy
ALTER TABLE trades SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'mint_address',
  timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('trades', INTERVAL '24 hours');

-- Continuous aggregates for real-time metrics
CREATE MATERIALIZED VIEW trades_1m
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 minute', time) AS bucket,
    mint_address,
    COUNT(*) as trade_count,
    SUM(CASE WHEN trade_type = 'buy' THEN sol_amount ELSE 0 END) as buy_volume,
    SUM(CASE WHEN trade_type = 'sell' THEN sol_amount ELSE 0 END) as sell_volume,
    AVG(price_sol) as avg_price_sol,
    AVG(price_usd) as avg_price_usd,
    MAX(price_usd) as high_price_usd,
    MIN(price_usd) as low_price_usd,
    LAST(price_usd, time) as close_price_usd,
    LAST(market_cap_usd, time) as market_cap_usd
FROM trades
GROUP BY bucket, mint_address
WITH NO DATA;

-- Refresh policy
SELECT add_continuous_aggregate_policy('trades_1m',
    start_offset => INTERVAL '2 minutes',
    end_offset => INTERVAL '0 minutes',
    schedule_interval => INTERVAL '30 seconds'
);

-- Create similar aggregates for 5m, 15m, 1h, 24h
```

## Phase 2: Real-time Processing Pipeline (Week 1-2)

### 2.1 Stream Processors

```typescript
// src/processors/trade-processor.ts
import { Injectable } from '@nestjs/common';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { TimescaleService } from '../services/timescale.service';
import { ClickHouseService } from '../services/clickhouse.service';
import { ElasticsearchService } from '../services/elasticsearch.service';

@Injectable()
export class TradeProcessor {
  private consumer: Consumer;
  private batchBuffer: Map<string, Trade[]> = new Map();
  private flushInterval: NodeJS.Timer;
  
  constructor(
    @InjectRedis() private redis: Redis,
    private timescale: TimescaleService,
    private clickhouse: ClickHouseService,
    private elasticsearch: ElasticsearchService,
  ) {
    this.setupConsumer();
    this.setupBatchFlushing();
  }
  
  private setupConsumer() {
    this.consumer = kafka.consumer({ 
      groupId: 'trade-processor',
      maxWaitTimeInMs: 100,
      sessionTimeout: 30000,
    });
  }
  
  async start() {
    await this.consumer.connect();
    await this.consumer.subscribe({ 
      topics: ['bc-trades', 'amm-trades'], 
      fromBeginning: false 
    });
    
    await this.consumer.run({
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        const trades = batch.messages.map(m => JSON.parse(m.value.toString()));
        
        // Process in parallel
        await Promise.all([
          this.updateRealTimeCache(trades),
          this.bufferForBatchWrite(trades),
          this.updateSearchIndex(trades),
          heartbeat()
        ]);
        
        await resolveOffset(batch.messages[batch.messages.length - 1].offset);
      },
    });
  }
  
  private async updateRealTimeCache(trades: Trade[]) {
    const pipeline = this.redis.pipeline();
    
    for (const trade of trades) {
      const key = `token:${trade.mintAddress}`;
      
      // Update current price
      pipeline.hset(key, {
        'latest_price_sol': trade.price_sol.toString(),
        'latest_price_usd': trade.price_usd.toString(),
        'latest_market_cap': trade.market_cap_usd.toString(),
        'last_trade_at': trade.blockTime.toISOString(),
        'last_trade_type': trade.tradeType,
      });
      
      // Update 24h metrics
      pipeline.hincrby(`${key}:24h`, 'trade_count', 1);
      pipeline.hincrbyfloat(`${key}:24h`, 'volume_usd', trade.volume_usd);
      
      // Price history for charts (keep 24h of 1m candles)
      const minute = Math.floor(trade.blockTime.getTime() / 60000) * 60000;
      pipeline.zadd(
        `${key}:prices`,
        minute,
        JSON.stringify({
          t: minute,
          p: trade.price_usd,
          v: trade.volume_usd
        })
      );
      
      // Trim old data
      pipeline.zremrangebyscore(
        `${key}:prices`,
        '-inf',
        Date.now() - 86400000 // 24h
      );
      
      // Update global metrics
      pipeline.zadd('tokens:by_volume', trade.volume_24h || 0, trade.mintAddress);
      pipeline.zadd('tokens:by_mcap', trade.market_cap_usd || 0, trade.mintAddress);
      
      // Publish to WebSocket subscribers
      pipeline.publish(`trade:${trade.mintAddress}`, JSON.stringify(trade));
    }
    
    await pipeline.exec();
  }
  
  private async bufferForBatchWrite(trades: Trade[]) {
    for (const trade of trades) {
      const mint = trade.mintAddress;
      if (!this.batchBuffer.has(mint)) {
        this.batchBuffer.set(mint, []);
      }
      this.batchBuffer.get(mint)!.push(trade);
    }
  }
  
  private setupBatchFlushing() {
    // Flush every 1 second or when buffer is full
    this.flushInterval = setInterval(() => this.flushBatch(), 1000);
  }
  
  private async flushBatch() {
    if (this.batchBuffer.size === 0) return;
    
    const batches = Array.from(this.batchBuffer.entries());
    this.batchBuffer.clear();
    
    // Write to databases in parallel
    await Promise.all([
      this.writeToTimescale(batches),
      this.writeToClickHouse(batches),
      this.updateAggregates(batches),
    ]);
  }
}
```

### 2.2 Aggregation Service

```typescript
// src/services/aggregation.service.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

@Injectable()
export class AggregationService {
  constructor(
    @InjectRedis() private redis: Redis,
    private timescale: TimescaleService,
  ) {}
  
  // Run every 10 seconds for near real-time updates
  @Cron('*/10 * * * * *')
  async updateTokenMetrics() {
    const tokens = await this.redis.zrevrange('tokens:by_volume', 0, 1000);
    
    const pipeline = this.redis.pipeline();
    
    for (const mint of tokens) {
      // Calculate 5m, 15m, 1h, 24h metrics
      const metrics = await this.calculateMetrics(mint);
      
      pipeline.hset(`token:${mint}:metrics`, {
        'volume_5m': metrics.volume5m,
        'volume_15m': metrics.volume15m,
        'volume_1h': metrics.volume1h,
        'volume_24h': metrics.volume24h,
        'trades_5m': metrics.trades5m,
        'trades_24h': metrics.trades24h,
        'price_change_5m': metrics.priceChange5m,
        'price_change_1h': metrics.priceChange1h,
        'price_change_24h': metrics.priceChange24h,
        'liquidity_usd': metrics.liquidityUsd,
        'holders': metrics.holders,
        'score': metrics.score, // Custom ranking score
      });
    }
    
    await pipeline.exec();
  }
  
  private async calculateMetrics(mint: string): Promise<TokenMetrics> {
    // Get data from continuous aggregates
    const [prices5m, prices1h, prices24h] = await Promise.all([
      this.timescale.query(`
        SELECT * FROM trades_5m 
        WHERE mint_address = $1 
        AND bucket >= NOW() - INTERVAL '5 minutes'
        ORDER BY bucket DESC
      `, [mint]),
      
      this.timescale.query(`
        SELECT * FROM trades_1h 
        WHERE mint_address = $1 
        AND bucket >= NOW() - INTERVAL '1 hour'
        ORDER BY bucket DESC
      `, [mint]),
      
      this.timescale.query(`
        SELECT * FROM trades_24h 
        WHERE mint_address = $1 
        AND bucket >= NOW() - INTERVAL '24 hours'
        ORDER BY bucket DESC
      `, [mint]),
    ]);
    
    // Calculate metrics
    return {
      volume5m: this.sumVolume(prices5m),
      volume1h: this.sumVolume(prices1h),
      volume24h: this.sumVolume(prices24h),
      priceChange5m: this.calculatePriceChange(prices5m),
      priceChange1h: this.calculatePriceChange(prices1h),
      priceChange24h: this.calculatePriceChange(prices24h),
      trades5m: this.sumTrades(prices5m),
      trades24h: this.sumTrades(prices24h),
      liquidityUsd: await this.calculateLiquidity(mint),
      holders: await this.getHolderCount(mint),
      score: this.calculateScore(metrics),
    };
  }
  
  private calculateScore(metrics: Partial<TokenMetrics>): number {
    // Custom scoring algorithm
    let score = 0;
    
    // Volume weight (40%)
    score += Math.log10(metrics.volume24h || 1) * 40;
    
    // Price momentum (30%)
    const momentum = (metrics.priceChange1h || 0) * 0.5 + 
                    (metrics.priceChange24h || 0) * 0.5;
    score += Math.min(momentum, 30);
    
    // Liquidity weight (20%)
    score += Math.log10(metrics.liquidityUsd || 1) * 20;
    
    // Activity weight (10%)
    score += Math.min(metrics.trades24h || 0, 1000) / 100;
    
    return Math.max(0, Math.min(100, score));
  }
}
```

## Phase 3: WebSocket Infrastructure (Week 2)

### 3.1 Scalable WebSocket Server

```typescript
// src/websocket/websocket-cluster.ts
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Cluster } from 'cluster';
import { cpus } from 'os';
import sticky from 'sticky-session';
import { Redis } from 'ioredis';

export class WebSocketCluster {
  private io: Server;
  private pubClient: Redis;
  private subClient: Redis;
  
  constructor(private server: any) {
    this.setupCluster();
  }
  
  private setupCluster() {
    if (cluster.isMaster) {
      console.log(`Master ${process.pid} is running`);
      
      // Fork workers
      const numWorkers = cpus().length;
      for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
      }
      
      cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
        cluster.fork();
      });
      
    } else {
      // Worker process
      this.setupWebSocketServer();
      console.log(`Worker ${process.pid} started`);
    }
  }
  
  private setupWebSocketServer() {
    this.io = new Server(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL,
        credentials: true
      },
      transports: ['websocket'],
      pingInterval: 25000,
      pingTimeout: 5000,
      maxHttpBufferSize: 1e6,
    });
    
    // Redis adapter for horizontal scaling
    this.pubClient = new Redis({
      host: process.env.REDIS_HOST,
      port: 6379,
    });
    
    this.subClient = this.pubClient.duplicate();
    
    this.io.adapter(createAdapter(this.pubClient, this.subClient));
    
    // Connection handling
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
    
    // Subscribe to Redis events
    this.subscribeToRedisEvents();
  }
  
  private handleConnection(socket: Socket) {
    console.log(`Client connected: ${socket.id}`);
    
    // Token subscriptions
    socket.on('subscribe:token', async (mintAddress: string) => {
      socket.join(`token:${mintAddress}`);
      
      // Send current data
      const currentData = await this.redis.hgetall(`token:${mintAddress}`);
      socket.emit('token:snapshot', currentData);
      
      // Send price history
      const priceHistory = await this.redis.zrange(
        `token:${mintAddress}:prices`,
        -1440, -1 // Last 24h of 1m candles
      );
      socket.emit('token:history', priceHistory.map(p => JSON.parse(p)));
    });
    
    // Global market data subscription
    socket.on('subscribe:market', async () => {
      socket.join('market:global');
      
      // Send top tokens
      const topByVolume = await this.redis.zrevrange('tokens:by_volume', 0, 99, 'WITHSCORES');
      const topByMcap = await this.redis.zrevrange('tokens:by_mcap', 0, 99, 'WITHSCORES');
      
      socket.emit('market:snapshot', {
        topByVolume: this.formatTokenList(topByVolume),
        topByMcap: this.formatTokenList(topByMcap),
      });
    });
    
    // Search subscription
    socket.on('search:tokens', async (query: string) => {
      const results = await this.searchTokens(query);
      socket.emit('search:results', results);
    });
    
    // Cleanup
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  }
  
  private subscribeToRedisEvents() {
    const subscriber = this.subClient.duplicate();
    
    // Subscribe to trade events
    subscriber.psubscribe('trade:*');
    
    subscriber.on('pmessage', (pattern, channel, message) => {
      if (pattern === 'trade:*') {
        const mintAddress = channel.split(':')[1];
        const trade = JSON.parse(message);
        
        // Emit to subscribed clients
        this.io.to(`token:${mintAddress}`).emit('trade', trade);
        
        // Update global market feed
        this.io.to('market:global').emit('market:trade', {
          mint: mintAddress,
          ...trade
        });
      }
    });
  }
}
```

### 3.2 Rate Limiting & Caching

```typescript
// src/middleware/rate-limiter.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private rateLimiter: RateLimiterRedis;
  
  constructor() {
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      enableOfflineQueue: false,
    });
    
    this.rateLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl',
      points: 100, // Number of requests
      duration: 1, // Per second
      blockDuration: 60, // Block for 1 minute
    });
  }
  
  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const key = req.ip || req.connection.remoteAddress;
      await this.rateLimiter.consume(key);
      next();
    } catch (rejRes) {
      res.status(429).send('Too Many Requests');
    }
  }
}
```

## Phase 4: API Layer (Week 2-3)

### 4.1 High-Performance REST API

```typescript
// src/controllers/tokens.controller.ts
import { Controller, Get, Query, Param, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('tokens')
@Controller('api/v1/tokens')
@UseInterceptors(CacheInterceptor)
export class TokensController {
  constructor(
    private tokenService: TokenService,
    private analyticsService: AnalyticsService,
  ) {}
  
  @Get()
  @CacheTTL(10) // Cache for 10 seconds
  @ApiOperation({ summary: 'Get tokens with filters and sorting' })
  async getTokens(
    @Query() query: GetTokensDto,
  ): Promise<PaginatedResponse<Token>> {
    const { 
      page = 1, 
      limit = 50, 
      sortBy = 'volume_24h',
      order = 'desc',
      minLiquidity,
      maxAge,
      program,
      search
    } = query;
    
    // Build filter
    const filter = this.buildFilter({ minLiquidity, maxAge, program, search });
    
    // Get tokens from cache/database
    const tokens = await this.tokenService.getTokens({
      filter,
      sortBy,
      order,
      offset: (page - 1) * limit,
      limit
    });
    
    return {
      data: tokens,
      meta: {
        page,
        limit,
        total: await this.tokenService.countTokens(filter),
        hasMore: tokens.length === limit
      }
    };
  }
  
  @Get(':mintAddress')
  @CacheTTL(5)
  @ApiOperation({ summary: 'Get detailed token information' })
  async getToken(
    @Param('mintAddress') mintAddress: string,
  ): Promise<TokenDetail> {
    const [token, analytics, holders] = await Promise.all([
      this.tokenService.getToken(mintAddress),
      this.analyticsService.getTokenAnalytics(mintAddress),
      this.tokenService.getTopHolders(mintAddress),
    ]);
    
    return {
      ...token,
      analytics,
      holders,
    };
  }
  
  @Get(':mintAddress/chart')
  @CacheTTL(30)
  @ApiOperation({ summary: 'Get token price chart data' })
  async getChart(
    @Param('mintAddress') mintAddress: string,
    @Query() query: GetChartDto,
  ): Promise<ChartData> {
    const { interval = '1m', from, to } = query;
    
    return this.analyticsService.getChartData({
      mintAddress,
      interval,
      from: from || Date.now() - 86400000, // Default 24h
      to: to || Date.now(),
    });
  }
  
  @Get(':mintAddress/trades')
  @ApiOperation({ summary: 'Get recent trades for token' })
  async getTrades(
    @Param('mintAddress') mintAddress: string,
    @Query() query: GetTradesDto,
  ): Promise<PaginatedResponse<Trade>> {
    const { page = 1, limit = 100 } = query;
    
    const trades = await this.tokenService.getRecentTrades({
      mintAddress,
      offset: (page - 1) * limit,
      limit
    });
    
    return {
      data: trades,
      meta: {
        page,
        limit,
        hasMore: trades.length === limit
      }
    };
  }
}
```

### 4.2 GraphQL API

```typescript
// src/graphql/schema.graphql
type Token {
  mintAddress: String!
  symbol: String
  name: String
  decimals: Int!
  
  # Price data
  currentPrice: Price!
  priceChange5m: Float
  priceChange1h: Float
  priceChange24h: Float
  
  # Volume data
  volume5m: Float!
  volume1h: Float!
  volume24h: Float!
  
  # Market data
  marketCap: Float
  liquidity: Float
  holders: Int
  
  # Lifecycle
  createdAt: DateTime!
  graduatedAt: DateTime
  isGraduated: Boolean!
  
  # Relations
  trades(first: Int, after: String): TradeConnection!
  chart(interval: ChartInterval!, from: Int, to: Int): [Candle!]!
  topHolders(limit: Int): [Holder!]!
}

type Subscription {
  # Real-time trade updates
  trades(mintAddress: String!): Trade!
  
  # Token updates (price, volume, etc)
  tokenUpdate(mintAddress: String!): Token!
  
  # New token launches
  newTokens: Token!
  
  # Graduation events
  graduations: GraduationEvent!
}
```

## Phase 5: Frontend & Charts (Week 3)

### 5.1 React Frontend Architecture

```typescript
// src/frontend/App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecoilRoot } from 'recoil';
import { WebSocketProvider } from './providers/WebSocketProvider';

// Lazy load pages
const TokenList = React.lazy(() => import('./pages/TokenList'));
const TokenDetail = React.lazy(() => import('./pages/TokenDetail'));
const Portfolio = React.lazy(() => import('./pages/Portfolio'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 1000, // 10 seconds
      cacheTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <WebSocketProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<TokenList />} />
              <Route path="/token/:mintAddress" element={<TokenDetail />} />
              <Route path="/portfolio" element={<Portfolio />} />
            </Routes>
          </BrowserRouter>
        </WebSocketProvider>
      </RecoilRoot>
    </QueryClientProvider>
  );
}
```

### 5.2 Real-time Chart Component

```typescript
// src/frontend/components/TokenChart.tsx
import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi } from 'lightweight-charts';
import { useWebSocket } from '../hooks/useWebSocket';
import { useQuery } from '@tanstack/react-query';

interface TokenChartProps {
  mintAddress: string;
  interval: '1m' | '5m' | '15m' | '1h' | '24h';
}

export function TokenChart({ mintAddress, interval }: TokenChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  
  const { subscribe, unsubscribe } = useWebSocket();
  
  // Fetch initial data
  const { data: chartData } = useQuery({
    queryKey: ['chart', mintAddress, interval],
    queryFn: () => fetchChartData(mintAddress, interval),
    refetchInterval: interval === '1m' ? 60000 : false,
  });
  
  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    chartRef.current = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#0d1117' },
        textColor: '#c9d1d9',
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });
    
    // Add candle series
    candleSeriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#26a641',
      downColor: '#ed6a45',
      borderVisible: false,
      wickUpColor: '#26a641',
      wickDownColor: '#ed6a45',
    });
    
    // Add volume series
    volumeSeriesRef.current = chartRef.current.addHistogramSeries({
      color: '#26d3a644',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    
    chartRef.current.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });
    
    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current?.remove();
    };
  }, []);
  
  // Update chart data
  useEffect(() => {
    if (!chartData || !candleSeriesRef.current) return;
    
    candleSeriesRef.current.setData(chartData.candles);
    volumeSeriesRef.current.setData(chartData.volumes);
  }, [chartData]);
  
  // Subscribe to real-time updates
  useEffect(() => {
    const handleTrade = (trade: Trade) => {
      if (!candleSeriesRef.current) return;
      
      // Update current candle
      const time = Math.floor(trade.timestamp / 60000) * 60;
      candleSeriesRef.current.update({
        time,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
      });
      
      // Update volume
      volumeSeriesRef.current.update({
        time,
        value: trade.volume,
      });
    };
    
    subscribe(`token:${mintAddress}`, 'trade', handleTrade);
    
    return () => {
      unsubscribe(`token:${mintAddress}`, 'trade', handleTrade);
    };
  }, [mintAddress, subscribe, unsubscribe]);
  
  return (
    <div className="chart-container">
      <div ref={chartContainerRef} />
    </div>
  );
}
```

## Phase 6: DevOps & Infrastructure (Week 3-4)

### 6.1 Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pumpfun-stream-processor
spec:
  replicas: 3
  selector:
    matchLabels:
      app: stream-processor
  template:
    metadata:
      labels:
        app: stream-processor
    spec:
      containers:
      - name: stream-processor
        image: pumpfun/stream-processor:latest
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        env:
        - name: GRPC_ENDPOINT
          valueFrom:
            secretKeyRef:
              name: pumpfun-secrets
              key: grpc-endpoint
        - name: KAFKA_BROKERS
          value: "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
        - name: REDIS_HOST
          value: "redis-master"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: stream-processor-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: pumpfun-stream-processor
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 6.2 Monitoring Stack

```yaml
# docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
      
  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3000:3000"
      
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - loki-data:/loki
      
  tempo:
    image: grafana/tempo:latest
    command: [ "-config.file=/etc/tempo.yaml" ]
    volumes:
      - ./tempo.yaml:/etc/tempo.yaml
      - tempo-data:/tmp/tempo
    ports:
      - "3200:3200"
```

## Phase 7: Analytics & ML (Week 4)

### 7.1 Analytics Engine

```typescript
// src/analytics/analytics-engine.ts
import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../services/clickhouse.service';
import * as tf from '@tensorflow/tfjs-node';

@Injectable()
export class AnalyticsEngine {
  private models: Map<string, tf.LayersModel> = new Map();
  
  constructor(
    private clickhouse: ClickHouseService,
  ) {
    this.loadModels();
  }
  
  async analyzeToken(mintAddress: string): Promise<TokenAnalysis> {
    // Get historical data
    const [trades, holders, liquidity] = await Promise.all([
      this.getTradeHistory(mintAddress),
      this.getHolderDistribution(mintAddress),
      this.getLiquidityHistory(mintAddress),
    ]);
    
    // Calculate metrics
    const metrics = {
      volatility: this.calculateVolatility(trades),
      momentum: this.calculateMomentum(trades),
      liquidityScore: this.calculateLiquidityScore(liquidity),
      holderConcentration: this.calculateHolderConcentration(holders),
      tradeVelocity: this.calculateTradeVelocity(trades),
    };
    
    // ML predictions
    const predictions = await this.runPredictions(mintAddress, metrics);
    
    // Risk assessment
    const riskScore = this.calculateRiskScore(metrics, predictions);
    
    return {
      metrics,
      predictions,
      riskScore,
      signals: this.generateTradingSignals(metrics, predictions),
    };
  }
  
  private async runPredictions(
    mintAddress: string, 
    metrics: TokenMetrics
  ): Promise<Predictions> {
    const priceModel = this.models.get('price_prediction');
    const volumeModel = this.models.get('volume_prediction');
    
    // Prepare input tensor
    const input = tf.tensor2d([[
      metrics.volatility,
      metrics.momentum,
      metrics.liquidityScore,
      metrics.holderConcentration,
      metrics.tradeVelocity,
    ]]);
    
    // Run predictions
    const [pricePred, volumePred] = await Promise.all([
      priceModel.predict(input),
      volumeModel.predict(input),
    ]);
    
    return {
      priceDirection: await pricePred.data(),
      volumeTrend: await volumePred.data(),
      confidence: this.calculateConfidence(metrics),
    };
  }
}
```

### 7.2 Alert System

```typescript
// src/alerts/alert-engine.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AlertRule, AlertTrigger } from './alert.types';

@Injectable()
export class AlertEngine {
  private rules: Map<string, AlertRule[]> = new Map();
  
  constructor(
    private eventEmitter: EventEmitter2,
    private notificationService: NotificationService,
  ) {
    this.setupEventListeners();
  }
  
  async checkAlerts(trade: Trade): Promise<void> {
    const rules = this.rules.get(trade.mintAddress) || [];
    
    for (const rule of rules) {
      if (await this.evaluateRule(rule, trade)) {
        await this.triggerAlert(rule, trade);
      }
    }
  }
  
  private async evaluateRule(rule: AlertRule, trade: Trade): Promise<boolean> {
    switch (rule.type) {
      case 'price_above':
        return trade.price_usd > rule.threshold;
        
      case 'price_below':
        return trade.price_usd < rule.threshold;
        
      case 'volume_spike':
        const avgVolume = await this.getAverageVolume(trade.mintAddress);
        return trade.volume_usd > avgVolume * rule.multiplier;
        
      case 'whale_trade':
        return trade.volume_usd > rule.threshold;
        
      case 'liquidity_change':
        const prevLiquidity = await this.getPreviousLiquidity(trade.mintAddress);
        const change = Math.abs(trade.liquidity - prevLiquidity) / prevLiquidity;
        return change > rule.threshold;
        
      default:
        return false;
    }
  }
  
  private async triggerAlert(rule: AlertRule, trade: Trade): Promise<void> {
    const alert: AlertTrigger = {
      ruleId: rule.id,
      userId: rule.userId,
      mintAddress: trade.mintAddress,
      type: rule.type,
      value: trade.price_usd,
      threshold: rule.threshold,
      timestamp: new Date(),
      trade,
    };
    
    // Store alert
    await this.storeAlert(alert);
    
    // Send notifications
    await this.notificationService.send(alert);
    
    // Emit event
    this.eventEmitter.emit('alert.triggered', alert);
  }
}
```

## Phase 8: Production Optimization (Week 4+)

### 8.1 Performance Optimizations

```typescript
// src/optimizations/performance.ts

// 1. Connection Pooling
export const createOptimizedPool = () => {
  return new Pool({
    host: process.env.DB_HOST,
    port: 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 50, // Maximum connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    statement_timeout: 30000,
    query_timeout: 30000,
  });
};

// 2. Batch Processing
export class BatchProcessor {
  private batch: any[] = [];
  private batchSize = 1000;
  private flushInterval = 1000; // 1 second
  private timer: NodeJS.Timer;
  
  constructor(
    private processor: (batch: any[]) => Promise<void>
  ) {
    this.timer = setInterval(() => this.flush(), this.flushInterval);
  }
  
  async add(item: any) {
    this.batch.push(item);
    
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }
  
  async flush() {
    if (this.batch.length === 0) return;
    
    const items = this.batch.splice(0, this.batchSize);
    await this.processor(items);
  }
}

// 3. Query Optimization
export const optimizedQueries = {
  // Use partial indexes
  getActiveTokens: `
    SELECT * FROM tokens 
    WHERE last_trade_at > NOW() - INTERVAL '24 hours'
    AND volume_24h > 1000
    ORDER BY volume_24h DESC
    LIMIT 100
  `,
  
  // Use materialized CTEs
  getTokenMetrics: `
    WITH recent_trades AS MATERIALIZED (
      SELECT mint_address, 
             SUM(volume_usd) as volume,
             COUNT(*) as trade_count,
             MAX(price_usd) as high,
             MIN(price_usd) as low
      FROM trades
      WHERE time > NOW() - INTERVAL '24 hours'
      GROUP BY mint_address
    )
    SELECT t.*, rt.* 
    FROM tokens t
    JOIN recent_trades rt ON t.mint_address = rt.mint_address
    ORDER BY rt.volume DESC
  `,
};

// 4. Caching Strategy
export class MultiLevelCache {
  private l1Cache = new LRU({ max: 10000, ttl: 10000 }); // 10s
  private l2Cache: Redis;
  
  async get(key: string): Promise<any> {
    // Check L1 (memory)
    let value = this.l1Cache.get(key);
    if (value) return value;
    
    // Check L2 (Redis)
    value = await this.l2Cache.get(key);
    if (value) {
      this.l1Cache.set(key, value);
      return JSON.parse(value);
    }
    
    return null;
  }
  
  async set(key: string, value: any, ttl: number = 60) {
    // Set in both caches
    this.l1Cache.set(key, value);
    await this.l2Cache.setex(key, ttl, JSON.stringify(value));
  }
}
```

### 8.2 Scaling Strategy

```yaml
# k8s/scaling.yaml
# Stream processors - scale based on lag
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: stream-processor-scaler
spec:
  scaleTargetRef:
    name: stream-processor
  minReplicaCount: 3
  maxReplicaCount: 20
  triggers:
  - type: kafka
    metadata:
      bootstrapServers: kafka:9092
      consumerGroup: trade-processor
      topic: trades
      lagThreshold: "1000"
      
# API servers - scale based on requests
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: api-scaler
spec:
  scaleTargetRef:
    name: api-server
  minReplicaCount: 2
  maxReplicaCount: 10
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: http_requests_per_second
      threshold: "100"
      query: sum(rate(http_requests_total[1m]))
```

## Infrastructure Requirements

### Hardware Requirements (Production)
- **Stream Processors**: 8 CPU cores, 16GB RAM per instance (3-10 instances)
- **Database Servers**: 
  - TimescaleDB: 32 CPU cores, 128GB RAM, 2TB NVMe SSD
  - ClickHouse: 16 CPU cores, 64GB RAM, 4TB SSD
  - Redis/Dragonfly: 8 CPU cores, 64GB RAM
- **API Servers**: 4 CPU cores, 8GB RAM per instance (2-10 instances)
- **WebSocket Servers**: 4 CPU cores, 8GB RAM per instance (4-8 instances)

### Network Requirements
- 10Gbps network for database servers
- Low latency (<1ms) between services
- DDoS protection for public endpoints
- CDN for static assets and API caching

### Estimated Costs (AWS)
- **Compute**: ~$3,000-5,000/month
- **Storage**: ~$1,000-2,000/month
- **Network**: ~$500-1,000/month
- **Total**: ~$4,500-8,000/month

## Success Metrics

### Performance Targets
- **Data Latency**: <100ms from blockchain to dashboard
- **API Response Time**: <50ms for cached, <200ms for uncached
- **WebSocket Latency**: <10ms for trade updates
- **System Uptime**: 99.9% availability
- **Data Accuracy**: 99.99% trade capture rate

### Scale Targets
- **Concurrent Users**: 100,000+
- **Trades per Second**: 10,000+
- **Tokens Tracked**: 50,000+
- **Historical Data**: 1+ year retention
- **Chart Updates**: Real-time (sub-second)

This comprehensive plan provides everything needed to build a DexScreener-level platform for pump.fun tokens with real-time data processing, scalable infrastructure, and professional-grade analytics.