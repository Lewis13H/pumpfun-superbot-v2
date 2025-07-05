/**
 * Event Processor - Handles batch processing of normalized events
 * Provides caching, retry logic, and persistence capabilities
 */

import { Logger, loggers } from '../../core/logger';
import { NormalizedEvent } from './data-pipeline';

export interface ProcessorConfig {
  name: string;
  type: string;
  config: {
    maxRetries: number;
    enableCaching: boolean;
    batchSize?: number;
    processingTimeout?: number;
  };
}

export interface ProcessorStats {
  processed: number;
  failed: number;
  retried: number;
  avgProcessingTime: number;
  lastProcessedAt?: Date;
}

export class EventProcessor {
  public readonly name: string;
  private logger: Logger;
  private config: ProcessorConfig;
  private stats: ProcessorStats = {
    processed: 0,
    failed: 0,
    retried: 0,
    avgProcessingTime: 0
  };
  private cache: Map<string, any> = new Map();
  private retryQueue: Map<string, { event: NormalizedEvent; attempts: number }> = new Map();
  private isShuttingDown: boolean = false;

  constructor(config: ProcessorConfig) {
    this.name = config.name;
    this.config = config;
    this.logger = loggers.service(`EventProcessor:${config.name}`);
  }

  /**
   * Process a batch of events
   */
  async processBatch(events: NormalizedEvent[]): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Processor is shutting down, skipping batch');
      return;
    }

    const startTime = Date.now();
    const results = await Promise.allSettled(
      events.map(event => this.processEvent(event))
    );

    // Handle results
    let successCount = 0;
    let failureCount = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        failureCount++;
        this.handleFailure(events[index], result.reason);
      }
    });

    // Update stats
    this.stats.processed += successCount;
    this.stats.failed += failureCount;
    this.stats.lastProcessedAt = new Date();
    this.updateAvgProcessingTime(Date.now() - startTime, events.length);

    this.logger.debug(`Batch processed: ${successCount} success, ${failureCount} failed`);
  }

  /**
   * Process a single event
   */
  private async processEvent(event: NormalizedEvent): Promise<void> {
    try {
      // Check cache if enabled
      if (this.config.config.enableCaching) {
        const cached = this.cache.get(event.id);
        if (cached) {
          this.logger.debug(`Cache hit for event ${event.id}`);
          return;
        }
      }

      // Process based on processor type
      switch (this.config.type) {
        case 'database':
          await this.processDatabaseEvent(event);
          break;
        case 'analytics':
          await this.processAnalyticsEvent(event);
          break;
        case 'cache':
          await this.processCacheEvent(event);
          break;
        case 'token':
          await this.processTokenEvent(event);
          break;
        case 'trade':
          await this.processTradeEvent(event);
          break;
        case 'liquidity':
          await this.processLiquidityEvent(event);
          break;
        case 'pool':
          await this.processPoolEvent(event);
          break;
        default:
          await this.processDefaultEvent(event);
      }

      // Cache result if enabled
      if (this.config.config.enableCaching) {
        this.cache.set(event.id, { processed: true, timestamp: Date.now() });
      }

    } catch (error) {
      throw new Error(`Failed to process event ${event.id}: ${error}`);
    }
  }

  /**
   * Process database events
   */
  private async processDatabaseEvent(event: NormalizedEvent): Promise<void> {
    // Simulate database processing
    await new Promise(resolve => setTimeout(resolve, 10));
    
    this.logger.debug(`Database event processed: ${event.type} - ${event.id}`);
  }

  /**
   * Process analytics events
   */
  private async processAnalyticsEvent(event: NormalizedEvent): Promise<void> {
    // Calculate metrics based on event type
    switch (event.type) {
      case 'trade':
        // Update trade analytics
        break;
      case 'liquidity':
        // Update liquidity metrics
        break;
    }
    
    this.logger.debug(`Analytics event processed: ${event.type} - ${event.id}`);
  }

  /**
   * Process cache events
   */
  private async processCacheEvent(event: NormalizedEvent): Promise<void> {
    // Update in-memory caches
    if (event.type === 'pool_state') {
      // Update pool state cache
    }
    
    this.logger.debug(`Cache event processed: ${event.type} - ${event.id}`);
  }

  /**
   * Process token events
   */
  private async processTokenEvent(event: NormalizedEvent): Promise<void> {
    // Handle token lifecycle events
    const data = event.data;
    
    switch (data.phase) {
      case 'created':
        this.logger.info(`New token created: ${data.mint}`);
        break;
      case 'trading':
        this.logger.debug(`Token trading: ${data.mint}`);
        break;
      case 'graduated':
        this.logger.info(`Token graduated: ${data.mint}`);
        break;
    }
  }

  /**
   * Process trade events
   */
  private async processTradeEvent(event: NormalizedEvent): Promise<void> {
    // Handle trade events
    const data = event.data;
    
    if (data.isMEV) {
      this.logger.warn(`MEV detected in trade: ${event.metadata.signature}`);
    }
    
    if (data.slippage > 10) {
      this.logger.warn(`High slippage trade: ${data.slippage}%`);
    }
  }

  /**
   * Process liquidity events
   */
  private async processLiquidityEvent(event: NormalizedEvent): Promise<void> {
    // Handle liquidity events
    const data = event.data;
    
    this.logger.info(`Liquidity event: ${data.type} - Amount: ${data.amount}`);
  }

  /**
   * Process pool events
   */
  private async processPoolEvent(event: NormalizedEvent): Promise<void> {
    // Handle pool state updates
    const data = event.data;
    
    this.logger.debug(`Pool updated: ${data.poolAddress} - TVL: $${data.tvl}`);
  }

  /**
   * Process default events
   */
  private async processDefaultEvent(event: NormalizedEvent): Promise<void> {
    this.logger.debug(`Default processing for event: ${event.type} - ${event.id}`);
  }

  /**
   * Handle processing failure
   */
  private handleFailure(event: NormalizedEvent, error: any): void {
    const retryInfo = this.retryQueue.get(event.id);
    const attempts = retryInfo ? retryInfo.attempts + 1 : 1;

    if (attempts < this.config.config.maxRetries) {
      // Add to retry queue
      this.retryQueue.set(event.id, { event, attempts });
      this.stats.retried++;
      this.logger.warn(`Event ${event.id} failed, will retry (attempt ${attempts}/${this.config.config.maxRetries})`);
    } else {
      // Max retries exceeded
      this.logger.error(`Event ${event.id} failed after ${attempts} attempts`, error);
      this.retryQueue.delete(event.id);
    }
  }

  /**
   * Process retry queue
   */
  async processRetries(): Promise<void> {
    if (this.retryQueue.size === 0) return;

    const retries = Array.from(this.retryQueue.values());
    this.retryQueue.clear();

    const events = retries.map(r => r.event);
    await this.processBatch(events);
  }

  /**
   * Update average processing time
   */
  private updateAvgProcessingTime(processingTime: number, batchSize: number): void {
    const timePerEvent = processingTime / batchSize;
    const alpha = 0.1;
    this.stats.avgProcessingTime = this.stats.avgProcessingTime * (1 - alpha) + timePerEvent * alpha;
  }

  /**
   * Get processor statistics
   */
  getStats(): ProcessorStats {
    return { ...this.stats };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info(`Cache cleared: ${size} entries removed`);
  }

  /**
   * Shutdown the processor
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down processor...');
    this.isShuttingDown = true;

    // Process remaining retries
    if (this.retryQueue.size > 0) {
      this.logger.info(`Processing ${this.retryQueue.size} retries before shutdown`);
      await this.processRetries();
    }

    // Clear cache
    this.clearCache();

    this.logger.info('Processor shutdown complete', {
      processed: this.stats.processed,
      failed: this.stats.failed,
      retried: this.stats.retried
    });
  }
}