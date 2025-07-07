/**
 * Liquidity Monitor - Domain-driven monitor for liquidity and pool state
 * Consolidates AMM account monitoring, pool state tracking, and LP positions
 */

import { BaseMonitor } from '../../core/base-monitor';
import { EVENTS } from '../../core/event-bus';
import { UnifiedEventParser } from '../../utils/parsers/unified-event-parser';
// import { AmmPoolStateService } from '../../services/amm/amm-pool-state-service';
// import { AmmFeeService } from '../../services/amm/amm-fee-service';
// import { LpPositionCalculator } from '../../services/amm/lp-position-calculator';
import chalk from 'chalk';
import bs58 from 'bs58';

// Program IDs
const PUMP_SWAP_PROGRAM = '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu';
const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const RAYDIUM_AMM_PROGRAM = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

export interface LiquidityMetrics {
  totalPools: number;
  totalTVL: number;
  totalLiquidityEvents: number;
  totalFeeEvents: number;
  lpPositions: number;
  parseRate: number;
  messagesProcessed: number;
  errorsCount: number;
}

export interface PoolMetrics {
  poolAddress: string;
  tokenMint: string;
  tvlSOL: number;
  tvlUSD: number;
  tokenReserves: bigint;
  solReserves: bigint;
  liquidityProviders: number;
  totalVolume: number;
  totalFees: number;
  lastUpdated: Date;
}

export class LiquidityMonitor extends BaseMonitor {
  private eventParser: UnifiedEventParser;
  // private poolStateService: AmmPoolStateService;
  // private feeService: AmmFeeService;
  // private lpCalculator: LpPositionCalculator;
  private metrics: LiquidityMetrics = {
    totalPools: 0,
    totalTVL: 0,
    totalLiquidityEvents: 0,
    totalFeeEvents: 0,
    lpPositions: 0,
    parseRate: 0,
    messagesProcessed: 0,
    errorsCount: 0
  };
  private poolStates: Map<string, PoolMetrics> = new Map();
  private startTime: number = Date.now();

  constructor(container: any) {
    super({
      programId: PUMP_AMM_PROGRAM,
      monitorName: 'LiquidityMonitor',
      monitorType: 'Liquidity',
      monitorGroup: 'amm_pool',
      priority: 'medium',
      isAccountMonitor: true,
      color: chalk
    }, container);
    
    this.eventParser = new UnifiedEventParser({ useIDLParsing: true });
    // this.poolStateService = AmmPoolStateService.getInstance();
    // this.feeService = AmmFeeService.getInstance();
    // this.lpCalculator = LpPositionCalculator.getInstance();
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Subscribe to events
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // eventBus is already initialized in parent class
    
    // Listen for liquidity events
    this.eventBus.on(EVENTS.LIQUIDITY_ADDED, this.handleLiquidityEvent.bind(this));
    this.eventBus.on(EVENTS.LIQUIDITY_REMOVED, this.handleLiquidityEvent.bind(this));
    
    // Listen for fee events
    this.eventBus.on(EVENTS.FEE_COLLECTED, this.handleFeeEvent.bind(this));
    
    // Listen for pool state updates
    this.eventBus.on(EVENTS.POOL_STATE_UPDATED, this.handlePoolStateUpdate.bind(this));
    
    // Listen for liquidity processed events
    this.eventBus.on(EVENTS.LIQUIDITY_PROCESSED, this.handleLPPositionUpdate.bind(this));
  }

  /**
   * Get subscription configuration
   */
  protected getSubscriptionConfig(): any {
    return {
      isAccountMonitor: true,
      accounts: {
        'amm_pools': {
          owner: [PUMP_AMM_PROGRAM, PUMP_SWAP_PROGRAM, RAYDIUM_AMM_PROGRAM],
          filters: [],
          nonemptyTxnSignature: true
        }
      },
      transactions: {
        'amm_liquidity': {
          vote: false,
          failed: false,
          accountInclude: [PUMP_AMM_PROGRAM, PUMP_SWAP_PROGRAM, RAYDIUM_AMM_PROGRAM],
          accountExclude: [],
          accountRequired: []
        }
      }
    };
  }

  /**
   * Get subscription group for smart routing
   */
  getSubscriptionGroup(): string {
    return 'amm_pool'; // Medium priority
  }

  /**
   * Build enhanced subscribe request to monitor ALL AMM programs
   */
  protected buildEnhancedSubscribeRequest(): any {
    const builder = this.subscriptionBuilder;
    
    // Set commitment level
    builder.setCommitment('confirmed');
    
    // Subscribe to ALL AMM programs
    const ammPrograms = [PUMP_AMM_PROGRAM, PUMP_SWAP_PROGRAM, RAYDIUM_AMM_PROGRAM];
    
    builder.addTransactionSubscription('liquidity_monitor_txns', {
      vote: false,
      failed: false,
      accountInclude: ammPrograms,
      accountRequired: [],
      accountExclude: []
    });
    
    // Also subscribe to account updates for pool state
    builder.addAccountSubscription('liquidity_monitor_accounts', {
      owner: ammPrograms,
      filters: [],
      nonemptyTxnSignature: true
    });
    
    // Set group priority if available
    if ('setGroup' in builder) {
      (builder as any).setGroup(this.getSubscriptionGroup());
    }
    
    return builder.build();
  }

  /**
   * Process stream data
   */
  async processStreamData(data: any): Promise<void> {
    this.metrics.messagesProcessed++;
    
    try {
      // Debug: Log data type
      const dataType = data.account ? 'ACCOUNT' : data.transaction ? 'TRANSACTION' : 'UNKNOWN';
      this.logger.debug(`Processing ${dataType} data`, {
        hasAccount: !!data.account,
        hasTransaction: !!data.transaction,
        slot: data.account?.slot || data.transaction?.slot
      });
      
      // Check if it's an account update
      if (data.account) {
        await this.processAccountUpdate(data);
      } 
      // Check if it's a transaction
      else if (data.transaction) {
        await this.processTransaction(data);
      }
    } catch (error) {
      this.metrics.errorsCount++;
      this.logger.error('Error processing stream data:', error);
    }
    
    // Update parse rate
    this.updateParseRate();
  }

  /**
   * Process account update
   */
  private async processAccountUpdate(data: any): Promise<void> {
    try {
      // Debug: Log account update details
      const accountPubkey = data.account?.account?.pubkey;
      const owner = data.account?.account?.owner;
      this.logger.debug('Account update:', {
        pubkey: accountPubkey?.slice(0, 10) + '...' || 'unknown',
        owner: owner,
        slot: data.account?.slot,
        dataLength: data.account?.account?.data?.length
      });
      
      // Create parse context from gRPC data
      const context = this.createParseContext(data);
      const event = this.eventParser.parse(context);
      const events = event ? [event] : [];
      
      for (const event of events) {
        if ((event as any).type === 'amm_pool_state') {
          // Update pool state
          const poolData = (event as any).data;
          this.logger.info('🏊 Pool state update detected!', {
            pool: poolData.poolAddress,
            tokenMint: poolData.tokenMint
          });
          const poolMetrics: PoolMetrics = {
            poolAddress: poolData.poolAddress,
            tokenMint: poolData.tokenMint,
            tvlSOL: poolData.reserves.sol,
            tvlUSD: poolData.reserves.sol * (poolData.solPrice || 0),
            tokenReserves: BigInt(poolData.reserves.token),
            solReserves: BigInt(poolData.reserves.sol * 1e9), // Convert to lamports
            liquidityProviders: poolData.lpHolders || 0,
            totalVolume: poolData.volume24h || 0,
            totalFees: poolData.fees24h || 0,
            lastUpdated: new Date()
          };
          
          this.poolStates.set(poolData.poolAddress, poolMetrics);
          this.metrics.totalPools = this.poolStates.size;
          
          // Calculate total TVL
          this.updateTotalTVL();
          
          this.logger.debug('Pool state updated:', {
            pool: poolData.poolAddress,
            tvl: poolMetrics.tvlUSD.toFixed(2)
          });
        }
      }
    } catch (error) {
      this.logger.error('Error processing account update:', error);
    }
  }

  /**
   * Process transaction
   */
  private async processTransaction(data: any): Promise<void> {
    try {
      // Create parse context from gRPC data
      const context = this.createParseContext(data);
      
      // Debug: Log transaction details
      const logs = context.logs || [];
      this.logger.debug('Transaction logs:', {
        signature: context.signature.slice(0, 10) + '...',
        logCount: logs.length,
        programs: context.accounts.slice(0, 3),
        firstLog: logs[0]?.slice(0, 100)
      });
      
      // Check for liquidity-related logs
      const hasLiquidityLog = logs.some((log: string) => 
        log.toLowerCase().includes('liquidity') ||
        log.toLowerCase().includes('mint_lp') ||
        log.toLowerCase().includes('burn_lp') ||
        log.toLowerCase().includes('fee')
      );
      
      if (hasLiquidityLog) {
        this.logger.info('🎯 Potential liquidity transaction detected!', {
          signature: context.signature,
          logs: logs.filter((log: string) => 
            log.toLowerCase().includes('liquidity') ||
            log.toLowerCase().includes('mint_lp') ||
            log.toLowerCase().includes('burn_lp') ||
            log.toLowerCase().includes('fee')
          )
        });
      }
      
      const event = this.eventParser.parse(context);
      const events = event ? [event] : [];
      
      for (const event of events) {
        // Handle different liquidity-related events
        const eventType = (event as any).type;
        this.logger.debug('Parsed event type:', eventType);
        
        switch (eventType) {
          case 'amm_liquidity_add':
          case 'amm_liquidity_remove':
            this.metrics.totalLiquidityEvents++;
            this.logger.info('💧 Liquidity event detected!', { type: eventType, event });
            break;
            
          case 'amm_fee_collect':
            this.metrics.totalFeeEvents++;
            this.logger.info('💰 Fee collection event detected!', { type: eventType, event });
            break;
            
          case 'lp_position':
            this.metrics.lpPositions++;
            this.logger.info('📊 LP position event detected!', { type: eventType, event });
            break;
            
          default:
            // Log other event types to understand what we're seeing
            if (eventType) {
              this.logger.debug('Other event type:', { type: eventType });
            }
        }
      }
    } catch (error) {
      this.logger.error('Error processing transaction:', error);
    }
  }

  /**
   * Handle liquidity event
   */
  private handleLiquidityEvent(event: any): void {
    this.metrics.totalLiquidityEvents++;
    
    this.logger.info('Liquidity event detected:', {
      type: event.type,
      pool: event.poolAddress,
      amount: event.amount
    });
  }

  /**
   * Handle fee event
   */
  private handleFeeEvent(event: any): void {
    this.metrics.totalFeeEvents++;
    
    this.logger.debug('Fee event detected:', {
      pool: event.poolAddress,
      fees: event.feeAmount
    });
  }

  /**
   * Handle pool state update
   */
  private handlePoolStateUpdate(_update: any): void {
    // Pool state updates are handled in processAccountUpdate
    this.logger.debug('Pool state event received');
  }

  /**
   * Handle LP position update
   */
  private handleLPPositionUpdate(update: any): void {
    this.metrics.lpPositions++;
    
    this.logger.debug('LP position updated:', {
      user: update.userAddress,
      pool: update.poolAddress,
      shares: update.lpShares
    });
  }

  /**
   * Update total TVL across all pools
   */
  private updateTotalTVL(): void {
    let totalTVL = 0;
    for (const pool of this.poolStates.values()) {
      totalTVL += pool.tvlUSD;
    }
    this.metrics.totalTVL = totalTVL;
  }

  /**
   * Update parse rate
   */
  private updateParseRate(): void {
    const successfulParses = this.metrics.messagesProcessed - this.metrics.errorsCount;
    this.metrics.parseRate = this.metrics.messagesProcessed > 0 
      ? (successfulParses / this.metrics.messagesProcessed) * 100 
      : 0;
  }

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    this.logger.info('Starting Liquidity Monitor...');
    this.startTime = Date.now();
    
    // Subscribe to multiple programs
    const programs = [PUMP_AMM_PROGRAM, PUMP_SWAP_PROGRAM];
    
    for (const program of programs) {
      this.options.programId = program;
      await super.start();
    }
    
    // Start periodic stats display
    this.startStatsInterval();
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping Liquidity Monitor...');
    
    await super.stop();
  }

  /**
   * Display statistics (required by BaseMonitor)
   */
  displayStats(): void {
    const runtime = Math.floor((Date.now() - this.startTime) / 1000);
    const lps = runtime > 0 ? (this.metrics.totalLiquidityEvents / runtime).toFixed(2) : '0';
    
    console.log(chalk.blue('\n📊 Liquidity Monitor Statistics:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Runtime: ${chalk.white(runtime)}s`);
    console.log(`Parse Rate: ${chalk.green(this.metrics.parseRate.toFixed(2) + '%')}`);
    console.log(`Messages Processed: ${chalk.yellow(this.metrics.messagesProcessed)}`);
    console.log(`Errors: ${chalk.red(this.metrics.errorsCount)}`);
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Total Pools: ${chalk.cyan(this.metrics.totalPools)}`);
    console.log(`Total TVL: ${chalk.green('$' + this.metrics.totalTVL.toFixed(2))}`);
    console.log(`Liquidity Events: ${chalk.yellow(this.metrics.totalLiquidityEvents)} (${lps}/s)`);
    console.log(`Fee Events: ${chalk.magenta(this.metrics.totalFeeEvents)}`);
    console.log(`LP Positions: ${chalk.blue(this.metrics.lpPositions)}`);
    console.log(chalk.gray('─'.repeat(50)));
    
    // Show top pools by TVL
    if (this.poolStates.size > 0) {
      console.log(chalk.blue('\n🏊 Top Pools by TVL:'));
      const topPools = Array.from(this.poolStates.values())
        .sort((a, b) => b.tvlUSD - a.tvlUSD)
        .slice(0, 5);
        
      topPools.forEach((pool, index) => {
        console.log(`${index + 1}. ${pool.tokenMint.slice(0, 8)}... - $${pool.tvlUSD.toFixed(2)}`);
      });
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): LiquidityMetrics {
    return { ...this.metrics };
  }

  /**
   * Get pool states
   */
  getPoolStates(): Map<string, PoolMetrics> {
    return new Map(this.poolStates);
  }

  /**
   * Start periodic stats display
   */
  private startStatsInterval(): void {
    // Display stats every 30 seconds
    setInterval(() => {
      this.displayStats();
    }, 30000);
  }

  /**
   * Create parse context from gRPC data
   */
  private createParseContext(data: any): any {
    // Handle transaction data
    if (data.transaction) {
      const tx = data.transaction.transaction.transaction;
      const meta = data.transaction.transaction.meta;
      
      // Extract account keys
      const accountKeys = tx.message.accountKeys.map((key: any) => 
        typeof key === 'string' ? key : bs58.encode(key)
      );
      
      return {
        signature: bs58.encode(tx.signatures[0]),
        slot: BigInt(data.transaction.slot),
        blockTime: data.transaction.blockTime,
        accounts: accountKeys,
        logs: meta?.logMessages || [],
        instructions: tx.message.instructions || [],
        innerInstructions: meta?.innerInstructions || []
      };
    }
    
    // Handle account data
    if (data.account) {
      return {
        signature: 'account-update',
        slot: BigInt(data.account.slot),
        blockTime: Date.now() / 1000,
        accounts: [data.account.account.pubkey],
        logs: [],
        instructions: [],
        innerInstructions: []
      };
    }
    
    return {
      signature: 'unknown',
      slot: 0n,
      blockTime: Date.now() / 1000,
      accounts: [],
      logs: [],
      instructions: [],
      innerInstructions: []
    };
  }
  
  /**
   * Should log error
   */
  shouldLogError(_error: Error): boolean {
    return true;
  }
  
  /**
   * Cleanup on shutdown
   */
  async onShutdown(): Promise<void> {
    // Cleanup any resources
  }
}