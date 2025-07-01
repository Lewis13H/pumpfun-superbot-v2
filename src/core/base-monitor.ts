import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import bs58 from 'bs58';
import { Container, TOKENS } from './container';
import { EventBus, EVENTS } from './event-bus';
import { ConfigService } from './config';
import { Logger, loggers } from './logger';

export interface MonitorOptions {
  programId: string;
  monitorName: string;
  color?: typeof chalk;
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
  
  protected currentSolPrice: number = 180; // Default fallback
  protected isShuttingDown: boolean = false;
  protected displayInterval?: NodeJS.Timeout;
  protected priceUpdateInterval?: NodeJS.Timeout;

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
      
      // Register with stream manager using monitor's subscription config
      const subscriptionConfig = this.buildSubscribeRequest();
      await this.streamManager.subscribeTo(this.options.programId, subscriptionConfig);
      
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
  }

  /**
   * Check if data is relevant to this monitor
   */
  protected isRelevantTransaction(data: any): boolean {
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
      
      // Check if our program ID is in the account keys
      for (const account of accounts) {
        const accountStr = typeof account === 'string' ? account : bs58.encode(account);
        if (accountStr === this.options.programId) return true;
      }
      
      // Also check logs for program invocation
      const logs = tx?.meta?.logMessages || [];
      return logs.some((log: string) => log.includes(this.options.programId));
    }
    
    return false;
  }

  /**
   * Build subscribe request
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
    
    await this.onShutdown();
    this.logger.info('Monitor stopped');
  }

  // Abstract methods
  abstract processStreamData(data: any): Promise<void>;
  abstract displayStats(): void;
  abstract shouldLogError(error: any): boolean;
  abstract onShutdown(): Promise<void>;
}