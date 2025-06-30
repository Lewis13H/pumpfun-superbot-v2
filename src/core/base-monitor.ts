import { CommitmentLevel, SubscribeRequest, SubscribeRequestPing } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
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
  protected eventBus: EventBus;
  protected config: ConfigService;
  protected logger: Logger;
  
  protected streamClient: any; // Will be injected
  protected dbService: any; // Will be injected
  protected solPriceService: any; // Will be injected
  
  protected currentSolPrice: number = 180; // Default fallback
  protected isShuttingDown: boolean = false;
  protected reconnectAttempts: number = 0;
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
    this.streamClient = await this.container.resolve(TOKENS.StreamClient);
    this.dbService = await this.container.resolve(TOKENS.DatabaseService);
    this.solPriceService = await this.container.resolve(TOKENS.SolPriceService);
  }

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    this.logger.info(`Starting ${this.options.monitorName}...`);
    
    try {
      // Initialize services
      await this.initializeServices();
      
      // Setup shutdown handlers
      this.setupShutdownHandlers();
      
      // Initialize SOL price
      await this.initializeSolPrice();
      
      // Start display interval
      this.startDisplayInterval();
      
      // Emit monitor started event
      this.eventBus.emit(EVENTS.MONITOR_STARTED, {
        monitor: this.options.monitorName,
        timestamp: new Date()
      });
      
      // Start monitoring
      await this.startMonitoring();
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
      this.currentSolPrice = await this.solPriceService.getCurrentPrice();
      
      const updateInterval = this.config.get('services').solPriceUpdateInterval;
      
      // Subscribe to price updates via event bus
      this.eventBus.on(EVENTS.SOL_PRICE_UPDATED, (price: number) => {
        this.currentSolPrice = price;
      });
      
      // Also poll for updates
      this.priceUpdateInterval = setInterval(async () => {
        try {
          const price = await this.solPriceService.getCurrentPrice();
          if (price !== this.currentSolPrice) {
            this.currentSolPrice = price;
            this.eventBus.emit(EVENTS.SOL_PRICE_UPDATED, price);
          }
        } catch (error) {
          this.logger.error('Error updating SOL price', error as Error);
        }
      }, updateInterval);
      
      this.logger.info(`SOL price initialized: $${this.currentSolPrice.toFixed(2)}`);
    } catch (error) {
      this.logger.error('Failed to initialize SOL price', error as Error);
    }
  }

  /**
   * Start display interval
   */
  protected startDisplayInterval(): void {
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
   * Main monitoring loop
   */
  protected async startMonitoring(reconnectDelay?: number): Promise<void> {
    if (this.isShuttingDown) return;
    
    const grpcConfig = this.config.get('grpc');
    const delay = reconnectDelay || grpcConfig.reconnectDelay;
    
    try {
      const request = this.buildSubscribeRequest();
      const stream = await this.streamClient.subscribe(request);
      
      this.logger.info('Connected to gRPC stream');
      this.reconnectAttempts = 0;
      
      for await (const data of stream) {
        if (this.isShuttingDown) break;
        
        try {
          await this.processStreamData(data);
          this.stats.transactions++;
        } catch (error) {
          this.stats.errors++;
          if (this.shouldLogError(error)) {
            this.logger.error('Error processing transaction', error as Error);
          }
        }
      }
    } catch (error) {
      this.stats.errors++;
      this.stats.reconnections++;
      
      this.logger.error('Stream error', error as Error);
      this.eventBus.emit(EVENTS.MONITOR_ERROR, {
        monitor: this.options.monitorName,
        error: error as Error,
        reconnectAttempts: this.reconnectAttempts
      });
      
      if (!this.isShuttingDown) {
        const nextDelay = Math.min(delay * 2, grpcConfig.maxReconnectDelay);
        this.logger.warn(`Reconnecting in ${nextDelay / 1000}s...`);
        this.reconnectAttempts++;
        
        setTimeout(() => {
          this.startMonitoring(nextDelay);
        }, delay);
      }
    }
  }

  /**
   * Build subscribe request
   */
  protected buildSubscribeRequest(): SubscribeRequest {
    const request: SubscribeRequest = {
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      ping: undefined as unknown as SubscribeRequestPing
    };

    // Subscribe to program accounts
    request.accounts = {
      account: [],
      owner: [this.options.programId],
      filters: []
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

  // Abstract methods
  abstract processStreamData(data: any): Promise<void>;
  abstract displayStats(): void;
  abstract shouldLogError(error: any): boolean;
  abstract onShutdown(): Promise<void>;
}