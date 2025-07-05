import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import bs58 from 'bs58';
import { Container, TOKENS } from './container';
import { EventBus, EVENTS } from './event-bus';
import { ConfigService } from './config';
import { Logger, loggers } from './logger';
import { SubscriptionBuilder } from './subscription-builder';
import { SlotMonitor } from './slot-monitor';

export interface MonitorOptions {
  programId: string;
  monitorName: string;
  color?: typeof chalk;
  subscriptionKey?: string;  // Add subscription key for stream registration
  // Enhanced subscription options
  includeFailedTxs?: boolean;
  requiredAccounts?: string[];
  excludeAccounts?: string[];
  trackSlots?: boolean;
  dataSlicing?: boolean;
  filters?: any[];
  fromSlot?: string | number;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  // Subscription group metadata
  monitorGroup?: 'bonding_curve' | 'amm_pool' | 'external_amm';
  monitorType?: string;
  priority?: 'high' | 'medium' | 'low';
  isAccountMonitor?: boolean;
}

export interface MonitorStats {
  startTime: Date;
  transactions: number;
  errors: number;
  reconnections: number;
  [key: string]: any; // Allow monitors to add custom stats
}

export abstract class BaseMonitor {
  protected options: MonitorOptions;
  protected stats: MonitorStats;
  protected container: Container;
  protected eventBus!: EventBus;
  protected config!: ConfigService;
  protected logger: Logger;
  
  protected streamManager: any; // Will be injected
  protected dbService: any; // Will be injected
  protected solPriceService: any; // Will be injected
  protected slotMonitor?: SlotMonitor; // Optional slot monitor
  protected lifecycleService?: any; // Optional lifecycle service (Phase 3)
  
  protected currentSolPrice: number = 180; // Default fallback
  protected isShuttingDown: boolean = false;
  protected displayInterval?: NodeJS.Timeout;
  protected priceUpdateInterval?: NodeJS.Timeout;
  protected subscriptionBuilder: SubscriptionBuilder;

  constructor(options: MonitorOptions, container: Container) {
    this.options = options;
    this.container = container;
    
    // Initialize stats
    this.stats = {
      startTime: new Date(),
      transactions: 0,
      errors: 0,
      reconnections: 0
    };
    
    // Create logger
    this.logger = loggers.monitor(options.monitorName, options.color);
    
    // Create subscription builder
    this.subscriptionBuilder = new SubscriptionBuilder();
  }

  /**
   * Initialize services from container
   */
  protected async initializeServices(): Promise<void> {
    this.eventBus = await this.container.resolve(TOKENS.EventBus);
    this.config = await this.container.resolve(TOKENS.ConfigService);
    this.streamManager = await this.container.resolve(TOKENS.StreamManager);
    this.dbService = await this.container.resolve(TOKENS.DatabaseService);
    this.solPriceService = await this.container.resolve(TOKENS.SolPriceService);
    
    // Initialize slot monitor if requested
    if (this.options.trackSlots) {
      this.slotMonitor = new SlotMonitor(this.eventBus);
      this.logger.info('Slot monitoring enabled');
    }
  }

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    if (process.env.DISABLE_MONITOR_STATS !== 'true') {
      this.logger.info(`Starting ${this.options.monitorName}...`);
    }
    
    try {
      // Initialize services
      await this.initializeServices();
      
      // Setup shutdown handlers
      this.setupShutdownHandlers();
      
      // Initialize SOL price
      await this.initializeSolPrice();
      
      // Start display interval
      this.startDisplayInterval();
      
      // Subscribe to stream data events
      this.setupStreamListener();
      
      // Register with stream manager using enhanced subscription config
      const subscriptionConfig = this.buildEnhancedSubscribeRequest();
      
      // If stream manager supports enhanced registration, use it
      if (this.streamManager.registerMonitor) {
        await this.streamManager.registerMonitor({
          monitorId: this.options.monitorName,
          monitorType: this.options.monitorType || this.inferMonitorType(),
          group: this.options.monitorGroup || this.inferMonitorGroup(),
          programId: this.options.programId,
          subscriptionConfig: {
            ...subscriptionConfig,
            isAccountMonitor: this.options.isAccountMonitor
          }
        });
      } else {
        // Fallback to legacy method
        await this.streamManager.subscribeTo(this.options.programId, subscriptionConfig);
      }
      
      // Emit monitor started event
      this.eventBus.emit(EVENTS.MONITOR_STARTED, {
        monitor: this.options.monitorName,
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.error('Failed to start monitor', error as Error);
      throw error;
    }
  }

  /**
   * Initialize SOL price updates
   */
  protected async initializeSolPrice(): Promise<void> {
    try {
      await this.solPriceService.initialize();
      this.currentSolPrice = await this.solPriceService.getPrice();
      
      const updateInterval = this.config.get('services').solPriceUpdateInterval;
      
      // Subscribe to price updates via event bus
      this.eventBus.on(EVENTS.SOL_PRICE_UPDATED, (price: number) => {
        this.currentSolPrice = price;
      });
      
      // Also poll for updates
      this.priceUpdateInterval = setInterval(async () => {
        try {
          const price = await this.solPriceService.getPrice();
          if (price !== this.currentSolPrice) {
            this.currentSolPrice = price;
            this.eventBus.emit(EVENTS.SOL_PRICE_UPDATED, price);
          }
        } catch (error) {
          this.logger.error('Error updating SOL price', error as Error);
        }
      }, updateInterval);
      
      if (process.env.DISABLE_MONITOR_STATS !== 'true') {
        this.logger.info(`SOL price initialized: $${this.currentSolPrice.toFixed(2)}`);
      }
    } catch (error) {
      this.logger.error('Failed to initialize SOL price', error as Error);
    }
  }

  /**
   * Start display interval
   */
  protected startDisplayInterval(): void {
    // Skip display if disabled
    if (process.env.DISABLE_MONITOR_STATS === 'true') {
      return;
    }
    
    const interval = this.config.get('monitors').displayInterval;
    
    this.displayInterval = setInterval(() => {
      this.displayStats();
      this.eventBus.emit(EVENTS.MONITOR_STATS_UPDATED, {
        monitor: this.options.monitorName,
        stats: { ...this.stats }
      });
    }, interval);
  }

  /**
   * Setup listener for stream data
   */
  protected setupStreamListener(): void {
    // Transaction data listener
    this.eventBus.on(EVENTS.STREAM_DATA, async (data: any) => {
      if (this.isShuttingDown) return;
      
      // Check if this transaction is relevant to our monitor
      if (!this.isRelevantTransaction(data)) return;
      
      try {
        await this.processStreamData(data);
        this.stats.transactions++;
      } catch (error) {
        this.stats.errors++;
        if (this.shouldLogError(error)) {
          this.logger.error('Error processing transaction', error as Error);
        }
      }
    });
    
    // Slot update listener (if slot tracking is enabled)
    if (this.options.trackSlots && this.slotMonitor) {
      this.eventBus.on(EVENTS.STREAM_DATA, (data: any) => {
        if (data.slot) {
          this.eventBus.emit('slot:update', {
            slot: BigInt(data.slot),
            parentSlot: data.parentSlot ? BigInt(data.parentSlot) : undefined,
            blockHeight: data.blockHeight ? BigInt(data.blockHeight) : undefined,
            blockTime: data.blockTime,
            status: data.commitment || 'processed'
          });
        }
      });
    }
  }

  /**
   * Check if data is relevant to this monitor
   */
  protected isRelevantTransaction(data: any): boolean {
    // Check if this is a failed transaction and we're not including failed txs
    if (data?.transaction?.meta?.err && !this.options.includeFailedTxs) {
      return false;
    }
    
    // Check if this is account data
    if (data?.account) {
      // For account updates, check if the owner matches our program
      const owner = data.account.owner;
      if (owner) {
        const ownerStr = typeof owner === 'string' ? owner : bs58.encode(owner);
        return ownerStr === this.options.programId;
      }
      return false;
    }
    
    // Check if this is transaction data
    if (data?.transaction) {
      // The structure from gRPC is: data.transaction.transaction.transaction.message.accountKeys
      const tx = data.transaction.transaction;
      const innerTx = tx?.transaction;
      const accounts = innerTx?.message?.accountKeys || [];
      
      // Convert accounts to strings for comparison
      const accountStrs = accounts.map((acc: any) => 
        typeof acc === 'string' ? acc : bs58.encode(acc)
      );
      
      // Check required accounts
      if (this.options.requiredAccounts?.length) {
        const hasAllRequired = this.options.requiredAccounts.every(req => 
          accountStrs.includes(req)
        );
        if (!hasAllRequired) return false;
      }
      
      // Check excluded accounts
      if (this.options.excludeAccounts?.length) {
        const hasExcluded = this.options.excludeAccounts.some(exc => 
          accountStrs.includes(exc)
        );
        if (hasExcluded) return false;
      }
      
      // Check if our program ID is in the account keys
      if (accountStrs.includes(this.options.programId)) return true;
      
      // Also check logs for program invocation
      const logs = tx?.meta?.logMessages || [];
      return logs.some((log: string) => log.includes(this.options.programId));
    }
    
    return false;
  }

  /**
   * Build subscribe request (legacy method for compatibility)
   */
  protected buildSubscribeRequest(): SubscribeRequest {
    const request: SubscribeRequest = {
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      accounts: {
        client: {
          account: [],
          owner: [this.options.programId],
          filters: []
        }
      },
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      ping: undefined
    };

    return request;
  }

  /**
   * Build enhanced subscribe request with Phase 2 features
   */
  protected buildEnhancedSubscribeRequest(): any {
    // Use subscription builder for enhanced config
    const builder = new SubscriptionBuilder();
    
    // Set commitment level
    const commitment = this.options.commitment || 'confirmed';
    builder.setCommitment(commitment);
    
    // Set starting slot if provided
    if (this.options.fromSlot) {
      builder.setFromSlot(this.options.fromSlot);
    }
    
    // Add transaction subscription
    const subscriptionKey = this.getSubscriptionKey();
    builder.addTransactionSubscription(subscriptionKey, {
      vote: false,
      failed: this.options.includeFailedTxs ?? false,
      accountInclude: [this.options.programId],
      accountRequired: this.options.requiredAccounts ?? [],
      accountExclude: this.options.excludeAccounts ?? []
    });
    
    // Add account subscription with filters
    const accountFilters = this.buildAccountFilters();
    builder.addAccountSubscription(subscriptionKey, {
      owner: [this.options.programId],
      filters: accountFilters,
      nonemptyTxnSignature: true
    });
    
    // Add slot tracking if enabled
    if (this.options.trackSlots) {
      builder.addSlotSubscription({ filterByCommitment: true });
    }
    
    // Add data slicing if enabled
    if (this.options.dataSlicing) {
      const sliceConfig = this.getDataSliceConfig();
      if (sliceConfig) {
        builder.addDataSlice(sliceConfig.offset, sliceConfig.length);
      }
    }
    
    const config = builder.build();
    this.logger.debug('Built enhanced subscription', { config });
    
    return config;
  }

  /**
   * Get subscription key for this monitor
   */
  protected getSubscriptionKey(): string {
    // Override in subclasses for specific keys
    return 'default';
  }

  /**
   * Build account filters
   */
  protected buildAccountFilters(): any[] {
    // Override in subclasses for specific filters
    return this.options.filters || [];
  }

  /**
   * Get data slice configuration
   */
  protected getDataSliceConfig(): { offset: string; length: string } | null {
    // Override in subclasses for specific slicing
    return null;
  }

  /**
   * Infer monitor type from program ID and monitor name
   */
  protected inferMonitorType(): string {
    if (this.options.monitorName.toLowerCase().includes('raydium')) {
      return 'Raydium';
    } else if (this.options.monitorName.toLowerCase().includes('amm')) {
      return 'AMM';
    } else if (this.options.monitorName.toLowerCase().includes('bc') || 
               this.options.monitorName.toLowerCase().includes('bonding')) {
      return 'BC';
    }
    return 'Unknown';
  }

  /**
   * Infer monitor group from program ID
   */
  protected inferMonitorGroup(): 'bonding_curve' | 'amm_pool' | 'external_amm' {
    const BC_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const PUMP_SWAP_PROGRAM = '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu';
    const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    const RAYDIUM_PROGRAM = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
    
    if (this.options.programId === BC_PROGRAM) {
      return 'bonding_curve';
    } else if (this.options.programId === PUMP_SWAP_PROGRAM || 
               this.options.programId === PUMP_AMM_PROGRAM) {
      return 'amm_pool';
    } else if (this.options.programId === RAYDIUM_PROGRAM || 
               this.options.programId.includes('raydium')) {
      return 'external_amm';
    }
    
    // Default based on monitor name
    if (this.options.monitorName.toLowerCase().includes('raydium')) {
      return 'external_amm';
    } else if (this.options.monitorName.toLowerCase().includes('amm')) {
      return 'amm_pool';
    }
    
    return 'bonding_curve';
  }

  /**
   * Setup shutdown handlers
   */
  protected setupShutdownHandlers(): void {
    const shutdown = async () => {
      this.logger.info('Shutting down...');
      this.isShuttingDown = true;
      
      // Stream cleanup is now handled by StreamManager
      
      // Clear intervals
      if (this.displayInterval) clearInterval(this.displayInterval);
      if (this.priceUpdateInterval) clearInterval(this.priceUpdateInterval);
      
      // Emit monitor stopped event
      this.eventBus.emit(EVENTS.MONITOR_STOPPED, {
        monitor: this.options.monitorName,
        timestamp: new Date(),
        stats: { ...this.stats }
      });
      
      // Custom shutdown logic
      await this.onShutdown();
      
      // Display final stats
      this.displayStats();
      
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Format number with commas
   */
  protected formatNumber(num: number): string {
    return num.toLocaleString();
  }

  /**
   * Format duration
   */
  protected formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Calculate rate per minute
   */
  protected calculateRate(count: number, startTime: Date): number {
    const elapsedMs = Date.now() - startTime.getTime();
    const elapsedMinutes = elapsedMs / 60000;
    return elapsedMinutes > 0 ? count / elapsedMinutes : 0;
  }

  /**
   * Stop the monitor and clean up connections
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping monitor...');
    this.isShuttingDown = true;
    
    // Clear intervals
    if (this.displayInterval) {
      clearInterval(this.displayInterval);
      this.displayInterval = undefined;
    }
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = undefined;
    }
    
    // Unregister from stream manager if it supports it
    try {
      if (this.streamManager.unregisterMonitor && this.options.monitorName) {
        await this.streamManager.unregisterMonitor(this.options.monitorName);
      }
    } catch (error) {
      // Ignore errors during unregistration
      this.logger.debug('Error unregistering monitor:', error);
    }
    
    await this.onShutdown();
    this.logger.info('Monitor stopped');
  }

  // Abstract methods
  abstract processStreamData(data: any): Promise<void>;
  abstract displayStats(): void;
  abstract shouldLogError(error: any): boolean;
  abstract onShutdown(): Promise<void>;
}