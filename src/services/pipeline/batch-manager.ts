/**
 * Batch Manager - Manages event batching with configurable size and timeout
 */

import { NormalizedEvent } from './data-pipeline';
import { Logger, loggers } from '../../core/logger';

export interface BatchManagerConfig {
  maxBatchSize: number;
  maxWaitTime: number;
  onBatchReady: (batch: NormalizedEvent[]) => Promise<void>;
}

export class BatchManager {
  private logger: Logger;
  private config: BatchManagerConfig;
  private currentBatch: NormalizedEvent[] = [];
  private batchTimer?: NodeJS.Timeout;
  private lastBatchTime: number = Date.now();
  private totalBatches: number = 0;
  private totalEvents: number = 0;

  constructor(config: BatchManagerConfig) {
    this.config = config;
    this.logger = loggers.service('BatchManager');
  }

  /**
   * Add event to batch
   */
  async addEvent(event: NormalizedEvent): Promise<void> {
    this.currentBatch.push(event);
    this.totalEvents++;

    // Check if batch is full
    if (this.currentBatch.length >= this.config.maxBatchSize) {
      await this.flush();
    } else if (!this.batchTimer) {
      // Start timer for first event in batch
      this.startBatchTimer();
    }
  }

  /**
   * Add multiple events to batch
   */
  async addEvents(events: NormalizedEvent[]): Promise<void> {
    for (const event of events) {
      await this.addEvent(event);
    }
  }

  /**
   * Start batch timer
   */
  private startBatchTimer(): void {
    this.batchTimer = setTimeout(async () => {
      if (this.currentBatch.length > 0) {
        await this.flush();
      }
    }, this.config.maxWaitTime);
  }

  /**
   * Check if batch timeout has occurred
   */
  checkTimeout(): void {
    const timeSinceLastBatch = Date.now() - this.lastBatchTime;
    
    if (this.currentBatch.length > 0 && timeSinceLastBatch >= this.config.maxWaitTime) {
      this.flush().catch(error => {
        this.logger.error('Error flushing batch on timeout', error);
      });
    }
  }

  /**
   * Flush current batch
   */
  async flush(): Promise<void> {
    if (this.currentBatch.length === 0) return;

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    // Get batch and reset
    const batch = [...this.currentBatch];
    this.currentBatch = [];
    this.lastBatchTime = Date.now();
    this.totalBatches++;

    this.logger.debug(`Flushing batch of ${batch.length} events`);

    try {
      // Process batch
      await this.config.onBatchReady(batch);
    } catch (error) {
      this.logger.error(`Error processing batch of ${batch.length} events`, error);
      // Could implement retry logic here
    }
  }

  /**
   * Get current batch size
   */
  getCurrentBatchSize(): number {
    return this.currentBatch.length;
  }

  /**
   * Get batch statistics
   */
  getStats(): {
    currentBatchSize: number;
    totalBatches: number;
    totalEvents: number;
    avgBatchSize: number;
  } {
    return {
      currentBatchSize: this.currentBatch.length,
      totalBatches: this.totalBatches,
      totalEvents: this.totalEvents,
      avgBatchSize: this.totalBatches > 0 ? this.totalEvents / this.totalBatches : 0
    };
  }

  /**
   * Clear current batch without processing
   */
  clear(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    const cleared = this.currentBatch.length;
    this.currentBatch = [];
    
    if (cleared > 0) {
      this.logger.warn(`Cleared ${cleared} events from batch`);
    }
  }
}