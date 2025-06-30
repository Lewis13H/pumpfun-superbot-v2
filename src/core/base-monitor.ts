import { CommitmentLevel, SubscribeRequest, SubscribeRequestPing } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../stream/client';
import { SolPriceService } from '../services/sol-price';
import { UnifiedDbServiceV2 } from '../database/unified-db-service';
import chalk from 'chalk';

export interface MonitorConfig {
  programId: string;
  monitorName: string;
  color: typeof chalk;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  displayIntervalMs?: number;
  enableWebSocket?: boolean;
}

export interface MonitorStats {
  startTime: Date;
  transactions: number;
  errors: number;
  reconnections: number;
  [key: string]: any; // Allow monitors to add custom stats
}

export abstract class BaseMonitor {
  protected config: MonitorConfig;
  protected stats: MonitorStats;
  protected streamClient: StreamClient;
  protected dbService: typeof UnifiedDbServiceV2;
  protected solPriceService: SolPriceService;
  protected currentSolPrice: number = 180; // Default fallback
  protected isShuttingDown: boolean = false;
  protected reconnectAttempts: number = 0;
  protected displayInterval?: NodeJS.Timeout;

  constructor(config: MonitorConfig) {
    this.config = {
      reconnectDelayMs: 5000,
      maxReconnectDelayMs: 60000,
      displayIntervalMs: 10000,
      ...config
    };

    this.stats = {
      startTime: new Date(),
      transactions: 0,
      errors: 0,
      reconnections: 0
    };

    // Initialize services
    this.streamClient = StreamClient.getInstance();
    this.dbService = UnifiedDbServiceV2;
    this.solPriceService = SolPriceService.getInstance();
  }

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    console.log(this.config.color(`\n🚀 Starting ${this.config.monitorName}...\n`));
    
    // Setup graceful shutdown
    this.setupShutdownHandlers();
    
    // Start SOL price updates
    await this.initializeSolPrice();
    
    // Start display interval
    this.startDisplayInterval();
    
    // Start monitoring with reconnection logic
    await this.startMonitoring();
  }

  /**
   * Initialize SOL price service
   */
  protected async initializeSolPrice(): Promise<void> {
    try {
      await this.solPriceService.initialize();
      this.currentSolPrice = await this.solPriceService.getCurrentPrice();
      
      // Update price periodically
      setInterval(async () => {
        try {
          this.currentSolPrice = await this.solPriceService.getCurrentPrice();
        } catch (error) {
          console.error(this.config.color('❌ Error updating SOL price:'), error);
        }
      }, 5000);
    } catch (error) {
      console.error(this.config.color('❌ Error initializing SOL price:'), error);
    }
  }

  /**
   * Start the display interval
   */
  protected startDisplayInterval(): void {
    this.displayInterval = setInterval(() => {
      this.displayStats();
    }, this.config.displayIntervalMs);
  }

  /**
   * Main monitoring loop with reconnection logic
   */
  protected async startMonitoring(reconnectDelay: number = this.config.reconnectDelayMs!): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      const request = this.buildSubscribeRequest();
      const stream = await this.streamClient.subscribe(request);

      console.log(this.config.color(`✅ Connected to gRPC stream for ${this.config.monitorName}`));
      this.reconnectAttempts = 0;

      for await (const data of stream) {
        if (this.isShuttingDown) break;

        try {
          await this.processStreamData(data);
          this.stats.transactions++;
        } catch (error) {
          this.stats.errors++;
          if (this.shouldLogError(error)) {
            console.error(this.config.color('❌ Error processing transaction:'), error);
          }
        }
      }
    } catch (error) {
      this.stats.errors++;
      this.stats.reconnections++;
      console.error(this.config.color(`❌ Stream error in ${this.config.monitorName}:`), error);
      
      if (!this.isShuttingDown) {
        const nextDelay = Math.min(reconnectDelay * 2, this.config.maxReconnectDelayMs!);
        console.log(this.config.color(`🔄 Reconnecting in ${nextDelay / 1000}s...`));
        this.reconnectAttempts++;
        
        setTimeout(() => {
          this.startMonitoring(nextDelay);
        }, reconnectDelay);
      }
    }
  }

  /**
   * Build the subscribe request for the gRPC stream
   */
  protected buildSubscribeRequest(): SubscribeRequest {
    const request: SubscribeRequest = {
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      ping: undefined as unknown as SubscribeRequestPing
    };

    // Add program subscription
    request.accounts = {
      account: [],
      owner: [this.config.programId],
      filters: []
    };

    return request;
  }

  /**
   * Setup graceful shutdown handlers
   */
  protected setupShutdownHandlers(): void {
    const shutdown = async () => {
      console.log(this.config.color(`\n🛑 Shutting down ${this.config.monitorName}...`));
      this.isShuttingDown = true;
      
      if (this.displayInterval) {
        clearInterval(this.displayInterval);
      }
      
      await this.onShutdown();
      
      // Display final stats
      this.displayStats();
      
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Format a number with commas
   */
  protected formatNumber(num: number): string {
    return num.toLocaleString();
  }

  /**
   * Format time duration
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

  // Abstract methods that each monitor must implement
  abstract processStreamData(data: any): Promise<void>;
  abstract displayStats(): void;
  abstract shouldLogError(error: any): boolean;
  abstract onShutdown(): Promise<void>;
}