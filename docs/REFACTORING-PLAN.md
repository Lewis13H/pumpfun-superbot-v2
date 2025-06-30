# Comprehensive Refactoring Plan for Pump.fun Monitor System

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Refactoring Strategy](#refactoring-strategy)
4. [Target Architecture](#target-architecture)
5. [Implementation Phases](#implementation-phases)
6. [Final Code Structure](#final-code-structure)
7. [Cleanup Plan](#cleanup-plan)

## Executive Summary

This document outlines a comprehensive refactoring plan to transform the pump.fun monitoring system from a collection of duplicated, tightly-coupled monitors into a clean, maintainable, and extensible architecture. Since the system is offline, we can make aggressive changes without worrying about backward compatibility or gradual migration.

### Key Goals
- **Eliminate code duplication** across 4 monitors
- **Simplify file naming** by removing version suffixes
- **Fix WebSocket architecture** issues
- **Implement proper separation of concerns**
- **Clean slate approach** - remove all deprecated code immediately

## Current State Analysis

### Problems Identified

1. **Code Duplication (>70%)**
   - All 4 monitors duplicate gRPC connection logic
   - Statistics tracking repeated in each monitor
   - Reconnection logic copied with minor variations
   - Display formatting duplicated

2. **File Naming Chaos**
   ```
   bc-monitor.ts
   bc-monitor-quick-fixes.ts
   bc-monitor-styled.ts
   bonding-curve-monitor-v3.ts
   unified-monitor-v2.ts (DEPRECATED)
   bc-event-parser.ts
   bc-event-parser-v2.ts
   ```

3. **Architectural Issues**
   - Singleton anti-pattern everywhere
   - No dependency injection
   - Tightly coupled services
   - WebSocket server broken and disabled
   - No central configuration management

4. **Missing Abstractions**
   - No base monitor class
   - No shared event bus
   - No unified error handling
   - No consistent logging

## Refactoring Strategy

### Core Principles (Updated - System Offline)
1. **Direct Replacement** - Replace old code immediately, no need for parallel versions
2. **Clean Slate** - Delete all deprecated and versioned files upfront
3. **Aggressive Refactoring** - Make breaking changes without compatibility concerns
4. **Fast Implementation** - No gradual migration needed
5. **Immediate Testing** - Test new implementation directly

## Target Architecture

### Clean Directory Structure
```
src/
├── core/                      # Core abstractions and utilities
│   ├── base-monitor.ts       # Abstract base class for all monitors
│   ├── container.ts          # Dependency injection container
│   ├── event-bus.ts          # Central event dispatcher
│   └── config.ts             # Configuration management
│
├── monitors/                  # One file per monitor (no versions!)
│   ├── bc-monitor.ts         # Bonding curve trade monitor
│   ├── bc-account-monitor.ts # BC account state monitor
│   ├── amm-monitor.ts        # AMM trade monitor
│   └── amm-account-monitor.ts # AMM account state monitor
│
├── services/                  # Business logic services
│   ├── price-calculator.ts   # Unified price calculations
│   ├── sol-price.ts          # SOL price service
│   ├── enrichment.ts         # Token metadata enrichment
│   ├── recovery.ts           # Price recovery service
│   └── websocket.ts          # WebSocket server (fixed)
│
├── parsers/                   # Event parsing (consolidated)
│   ├── event-parser.ts       # Unified parser with strategies
│   ├── strategies/           # Parsing strategies
│   │   ├── bc-225-byte.ts
│   │   ├── bc-113-byte.ts
│   │   └── amm-swap.ts
│   └── index.ts
│
├── repositories/              # Data access layer
│   ├── token-repository.ts   # Token CRUD operations
│   ├── trade-repository.ts   # Trade operations
│   └── pool-repository.ts    # AMM pool operations
│
├── handlers/                  # Request/Event handlers
│   ├── trade-handler.ts      # Unified trade handling
│   └── graduation-handler.ts # Graduation event handling
│
├── api/                       # REST API
│   ├── server.ts             # Main API server
│   ├── routes/               # API routes
│   │   ├── tokens.ts
│   │   ├── trades.ts
│   │   └── pools.ts
│   └── middleware/           # Express middleware
│
├── websocket/                 # WebSocket implementation
│   ├── server.ts             # WebSocket server
│   └── client.ts             # Client implementation
│
├── database/                  # Database layer
│   ├── client.ts             # Database client
│   ├── migrations/           # SQL migrations
│   └── queries/              # SQL query builders
│
├── utils/                     # Utilities
│   ├── constants.ts          # Shared constants
│   ├── formatters.ts         # Display formatters
│   ├── validators.ts         # Input validators
│   └── logger.ts             # Logging utility
│
└── tests/                     # Test files
    ├── unit/                 # Unit tests
    ├── integration/          # Integration tests
    └── e2e/                  # End-to-end tests
```

## Implementation Phases (Accelerated - 2 Weeks Total)

### Phase 1: Immediate Cleanup (Day 1)
1. **Delete all deprecated files**
   - Remove all `-v2`, `-v3`, `-styled`, `-quick-fixes` variants
   - Delete `unified-monitor-v2.ts` and other deprecated monitors
   - Clean up duplicate parsers and handlers

2. **Rename files to clean names**
   ```bash
   # Examples
   mv bc-monitor-quick-fixes.ts bc-monitor.ts
   mv unified-db-service-v2.ts database-service.ts
   mv bc-event-parser-v2.ts event-parser.ts
   ```

3. **Create new directory structure**
   ```bash
   mkdir -p src/{core,repositories,websocket}
   ```

### Phase 2: Foundation Layer (Days 2-3)

#### 1.1 Base Monitor Abstraction
```typescript
// src/core/base-monitor.ts
export abstract class BaseMonitor {
  protected config: MonitorConfig;
  protected stats: MonitorStats;
  protected services: MonitorServices;
  
  constructor(config: MonitorConfig, services: MonitorServices) {
    this.config = config;
    this.services = services;
    this.stats = this.initializeStats();
  }
  
  async start(): Promise<void> {
    await this.initialize();
    await this.startMonitoring();
  }
  
  protected abstract processTransaction(tx: Transaction): Promise<void>;
  protected abstract getDisplayName(): string;
  
  // Common functionality
  private async startMonitoring() { /* Shared gRPC logic */ }
  private handleReconnection() { /* Exponential backoff */ }
  private updateStatistics() { /* Stats tracking */ }
  private displayDashboard() { /* Terminal display */ }
}
```

#### 1.2 Dependency Injection Container
```typescript
// src/core/container.ts
export class Container {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();
  
  register<T>(token: string, factory: () => T): void {
    this.factories.set(token, factory);
  }
  
  resolve<T>(token: string): T {
    if (!this.services.has(token)) {
      const factory = this.factories.get(token);
      if (!factory) throw new Error(`Service ${token} not registered`);
      this.services.set(token, factory());
    }
    return this.services.get(token);
  }
}

// Usage
const container = new Container();
container.register('dbService', () => new DatabaseService(config));
container.register('solPrice', () => new SolPriceService());
container.register('parser', () => new UnifiedParser());
```

#### 1.3 Event Bus
```typescript
// src/core/event-bus.ts
export class EventBus {
  private events = new Map<string, Set<EventHandler>>();
  
  on(event: string, handler: EventHandler): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(handler);
  }
  
  emit(event: string, data: any): void {
    const handlers = this.events.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }
}
```

### Phase 3: Core Services (Days 4-5)

#### 2.1 Unified Parser with Strategies
```typescript
// src/parsers/event-parser.ts
export class UnifiedParser {
  private strategies: ParsingStrategy[];
  
  constructor(strategies: ParsingStrategy[]) {
    this.strategies = strategies;
  }
  
  parse(data: Buffer, logs: string[]): ParsedEvent | null {
    for (const strategy of this.strategies) {
      if (strategy.canParse(data, logs)) {
        return strategy.parse(data, logs);
      }
    }
    return null;
  }
}

// src/parsers/strategies/bc-225-byte.ts
export class BC225ByteStrategy implements ParsingStrategy {
  canParse(data: Buffer, logs: string[]): boolean {
    return data.length === 225 && logs.some(log => 
      log.includes('Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke')
    );
  }
  
  parse(data: Buffer, logs: string[]): BCTradeEvent {
    // Parsing logic here
  }
}
```

### Phase 4: Monitors & WebSocket (Days 6-8)

#### 3.1 Repository Pattern
```typescript
// src/repositories/token-repository.ts
export class TokenRepository {
  constructor(private db: DatabaseClient) {}
  
  async save(token: Token): Promise<void> {
    await this.db.query(
      `INSERT INTO tokens_unified (...) VALUES (...) 
       ON CONFLICT (mint_address) DO UPDATE SET ...`,
      [token.mintAddress, token.symbol, ...]
    );
  }
  
  async findByMintAddress(mint: string): Promise<Token | null> {
    const result = await this.db.query(
      'SELECT * FROM tokens_unified WHERE mint_address = $1',
      [mint]
    );
    return result.rows[0] || null;
  }
  
  async findAboveThreshold(threshold: number): Promise<Token[]> {
    const result = await this.db.query(
      'SELECT * FROM tokens_unified WHERE market_cap_usd >= $1',
      [threshold]
    );
    return result.rows;
  }
}
```

#### 3.2 Unified Price Calculator
```typescript
// src/services/price-calculator.ts
export class PriceCalculator {
  calculateBondingCurvePrice(
    virtualSolReserves: bigint,
    virtualTokenReserves: bigint
  ): PriceInfo {
    const priceInSol = Number(virtualSolReserves) / Number(virtualTokenReserves);
    const priceInLamports = priceInSol * LAMPORTS_PER_SOL;
    return { priceInSol, priceInLamports };
  }
  
  calculateAMMPrice(
    solReserves: bigint,
    tokenReserves: bigint,
    isBaseSOL: boolean
  ): PriceInfo {
    if (isBaseSOL) {
      return this.calculateWithSOLBase(solReserves, tokenReserves);
    } else {
      return this.calculateWithTokenBase(solReserves, tokenReserves);
    }
  }
  
  calculatePriceImpact(
    amount: bigint,
    reserves: { sol: bigint, token: bigint }
  ): number {
    // Constant product formula
    const k = reserves.sol * reserves.token;
    const newReserves = reserves.sol + amount;
    const newTokenReserves = k / newReserves;
    const tokensOut = reserves.token - newTokenReserves;
    const priceImpact = (Number(amount) / Number(reserves.sol)) * 100;
    return priceImpact;
  }
}
```

### Phase 5: Integration & Testing (Days 9-10)

#### 4.1 Fixed WebSocket Server
```typescript
// src/websocket/server.ts
export class WebSocketServer {
  private wss: WSServer;
  private clients = new Set<WebSocket>();
  
  constructor(
    private server: http.Server,
    private eventBus: EventBus
  ) {
    this.wss = new WSServer({ 
      server,
      path: '/ws',
      perMessageDeflate: false // Fix frame header issues
    });
    
    this.setupEventHandlers();
    this.subscribeToEvents();
  }
  
  private setupEventHandlers(): void {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      
      ws.on('close', () => {
        this.clients.delete(ws);
      });
      
      ws.send(JSON.stringify({
        type: 'connected',
        timestamp: new Date()
      }));
    });
  }
  
  private subscribeToEvents(): void {
    this.eventBus.on('trade', (data) => {
      this.broadcast({
        type: 'trade',
        payload: data
      });
    });
    
    this.eventBus.on('graduation', (data) => {
      this.broadcast({
        type: 'graduation',
        payload: data
      });
    });
  }
  
  private broadcast(message: any): void {
    const data = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }
}
```

#### 4.2 WebSocket Client
```typescript
// public/js/websocket-client.js
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.eventHandlers = new Map();
    this.connect();
  }
  
  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.onopen = () => {
      console.log('Connected to WebSocket');
      this.reconnectDelay = 1000;
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.emit(message.type, message.payload);
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected from WebSocket');
      this.scheduleReconnect();
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  scheduleReconnect() {
    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }
  
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
  }
  
  emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }
}

// Usage
const ws = new WebSocketClient('ws://localhost:3001/ws');

ws.on('trade', (trade) => {
  console.log('New trade:', trade);
  updateTradeDisplay(trade);
});

ws.on('graduation', (graduation) => {
  console.log('Token graduated:', graduation);
  showGraduationNotification(graduation);
});
```

### Phase 6: Final Configuration (Days 11-12)

#### 5.1 Centralized Configuration
```typescript
// src/core/config.ts
export interface Config {
  // Database
  database: {
    url: string;
    poolSize: number;
    idleTimeout: number;
  };
  
  // Monitoring
  monitors: {
    bcSaveThreshold: number;
    ammSaveThreshold: number;
    saveAllTokens: boolean;
    displayInterval: number;
  };
  
  // Services
  services: {
    solPriceUpdateInterval: number;
    enrichmentBatchSize: number;
    recoveryInterval: number;
  };
  
  // gRPC
  grpc: {
    endpoint: string;
    token: string;
    reconnectDelay: number;
    maxReconnectDelay: number;
  };
  
  // API
  api: {
    port: number;
    corsOrigins: string[];
  };
}

export class ConfigService {
  private config: Config;
  
  constructor() {
    this.config = this.loadConfig();
  }
  
  private loadConfig(): Config {
    return {
      database: {
        url: process.env.DATABASE_URL!,
        poolSize: parseInt(process.env.DB_POOL_SIZE || '10'),
        idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000')
      },
      monitors: {
        bcSaveThreshold: parseFloat(process.env.BC_SAVE_THRESHOLD || '8888'),
        ammSaveThreshold: parseFloat(process.env.AMM_SAVE_THRESHOLD || '1000'),
        saveAllTokens: process.env.SAVE_ALL_TOKENS === 'true',
        displayInterval: parseInt(process.env.DISPLAY_INTERVAL || '10000')
      },
      services: {
        solPriceUpdateInterval: 5000,
        enrichmentBatchSize: 50,
        recoveryInterval: 1800000 // 30 minutes
      },
      grpc: {
        endpoint: process.env.SHYFT_GRPC_ENDPOINT!,
        token: process.env.SHYFT_GRPC_TOKEN!,
        reconnectDelay: 5000,
        maxReconnectDelay: 60000
      },
      api: {
        port: parseInt(process.env.API_PORT || '3001'),
        corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',')
      }
    };
  }
  
  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }
}
```

## Final Code Structure

### Example: Refactored BC Monitor
```typescript
// src/monitors/bc-monitor.ts
import { BaseMonitor } from '../core/base-monitor';
import { Container } from '../core/container';
import { BCTradeEvent } from '../types';
import chalk from 'chalk';

export class BCMonitor extends BaseMonitor {
  private parser = this.services.resolve('parser');
  private tradeHandler = this.services.resolve('tradeHandler');
  private stats = {
    trades: 0,
    graduations: 0,
    savedTokens: 0,
    parseErrors: 0
  };
  
  constructor(container: Container) {
    super({
      programId: PUMP_PROGRAM,
      monitorName: 'Bonding Curve Monitor',
      color: chalk.yellow
    }, container);
  }
  
  protected async processTransaction(tx: Transaction): Promise<void> {
    // Use unified parser
    const event = await this.parser.parse(tx);
    
    if (!event) {
      this.stats.parseErrors++;
      return;
    }
    
    if (event.type === 'trade') {
      await this.handleTrade(event as BCTradeEvent);
    } else if (event.type === 'graduation') {
      await this.handleGraduation(event);
    }
  }
  
  private async handleTrade(trade: BCTradeEvent): Promise<void> {
    this.stats.trades++;
    
    // Delegate to trade handler
    const saved = await this.tradeHandler.processTrade(trade);
    
    if (saved) {
      this.stats.savedTokens++;
    }
    
    // Emit event for WebSocket
    this.eventBus.emit('bc:trade', trade);
  }
  
  protected displayStats(): void {
    const runtime = Date.now() - this.startTime.getTime();
    const parseRate = ((this.stats.trades / this.stats.transactions) * 100).toFixed(1);
    
    console.log(chalk.yellow('\n╔═══════════════════════════════════════════════════╗'));
    console.log(chalk.yellow('║         Bonding Curve Monitor Statistics          ║'));
    console.log(chalk.yellow('╠═══════════════════════════════════════════════════╣'));
    console.log(chalk.yellow(`║ Runtime: ${this.formatDuration(runtime).padEnd(40)} ║`));
    console.log(chalk.yellow(`║ Transactions: ${this.formatNumber(this.stats.transactions).padEnd(36)} ║`));
    console.log(chalk.yellow(`║ Trades: ${this.formatNumber(this.stats.trades).padEnd(42)} ║`));
    console.log(chalk.yellow(`║ Parse Rate: ${parseRate}%`.padEnd(51) + '║'));
    console.log(chalk.yellow(`║ Saved Tokens: ${this.formatNumber(this.stats.savedTokens).padEnd(36)} ║`));
    console.log(chalk.yellow(`║ Graduations: ${this.formatNumber(this.stats.graduations).padEnd(37)} ║`));
    console.log(chalk.yellow('╚═══════════════════════════════════════════════════╝\n'));
  }
}

// Usage
const container = createContainer();
const monitor = new BCMonitor(container);
await monitor.start();
```

### Example: Main Entry Point
```typescript
// src/index.ts
import { createContainer } from './core/container';
import { BCMonitor } from './monitors/bc-monitor';
import { BcAccountMonitor } from './monitors/bc-account-monitor';
import { AmmMonitor } from './monitors/amm-monitor';
import { AmmAccountMonitor } from './monitors/amm-account-monitor';

async function startAllMonitors() {
  const container = createContainer();
  
  const monitors = [
    new BCMonitor(container),
    new BcAccountMonitor(container),
    new AmmMonitor(container),
    new AmmAccountMonitor(container)
  ];
  
  // Start all monitors
  await Promise.all(monitors.map(m => m.start()));
}

startAllMonitors().catch(console.error);
```

## Cleanup Plan

### Immediate File Cleanup (Day 1)
```bash
# Delete all versioned files
rm -f src/monitors/*-v2.ts
rm -f src/monitors/*-v3.ts
rm -f src/monitors/*-quick-fixes.ts
rm -f src/monitors/*-styled.ts
rm -f src/monitors/unified-monitor-v2.ts
rm -f src/monitors/bonding-curve-monitor-v3.ts

# Delete duplicate parsers
rm -f src/parsers/bc-event-parser.ts  # Keep v2
rm -f src/handlers/bc-db-handler.ts   # Keep v2

# Delete old database services
rm -f src/database/db-service.ts      # Keep unified-db-service-v2

# Remove deprecated directories
rm -rf src/deprecated/

# Clean up scripts
rm -f scripts/*-v2.ts
rm -f scripts/quick-*.ts
rm -f scripts/test-*.ts  # Keep only essential test scripts
```

### File Renaming (Day 1)
```bash
# Rename to clean names
mv src/monitors/bc-monitor-quick-fixes.ts src/monitors/bc-monitor.ts
mv src/monitors/amm-account-monitor-v2.ts src/monitors/amm-account-monitor.ts
mv src/database/unified-db-service-v2.ts src/services/database-service.ts
mv src/parsers/bc-event-parser-v2.ts src/parsers/bc-event-parser.ts
mv src/handlers/bc-db-handler-v2.ts src/handlers/bc-db-handler.ts

# Consolidate price calculators
# Keep only one unified price calculator
rm src/services/bc-price-calculator.ts
rm src/services/amm-price-calculator.ts
mv src/utils/price-calculator.ts src/services/price-calculator.ts
```

### Code Consolidation Plan
1. **Merge similar services**
   - Combine GraphQL recovery services into one
   - Merge all price calculation logic
   - Unify enrichment services

2. **Remove redundant code**
   - Delete mock WebSocket implementation
   - Remove commented-out code blocks
   - Clean up unused imports

3. **Standardize patterns**
   - Convert all services from singleton to DI
   - Use consistent error handling
   - Implement uniform logging

## Success Metrics

1. **Code Reduction**: 50% fewer lines through DRY
2. **Performance**: <100ms latency for all operations
3. **Reliability**: 99.9% uptime
4. **Maintainability**: 90% test coverage
5. **Development Speed**: 3x faster to add new features

## Accelerated Timeline (System Offline)

### Week 1
- **Day 1**: Immediate cleanup - delete all deprecated files, rename to clean names
- **Days 2-3**: Foundation layer - BaseMonitor, DI container, EventBus
- **Days 4-5**: Core services - unified parser, repositories, price calculator

### Week 2  
- **Days 6-8**: Refactor monitors & fix WebSocket
- **Days 9-10**: Integration and testing
- **Days 11-12**: Final configuration and polish
- **Days 13-14**: Comprehensive testing and documentation

**Total time: 2 weeks** (vs 6 weeks with zero-downtime requirement)

## Benefits of Offline Refactoring

1. **No backward compatibility needed** - Clean breaks allowed
2. **Direct file replacement** - No parallel versions
3. **Aggressive optimization** - Can make breaking changes
4. **Faster implementation** - No gradual migration overhead
5. **Cleaner codebase** - No transition code or feature flags
6. **Immediate validation** - Test the final state directly