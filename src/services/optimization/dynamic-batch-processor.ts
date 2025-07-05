/**
 * Dynamic Batch Processor
 * Implements adaptive batching for optimal throughput
 */

import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';

export interface BatchItem<T = any> {
  id: string;
  priority: 'high' | 'normal' | 'low';
  data: T;
  timestamp: number;
  retries?: number;
}

export interface BatchProcessorConfig {
  minBatchSize: number;
  maxBatchSize: number;
  batchTimeout: number;
  maxQueueSize: number;
  priorityEnabled: boolean;
  adaptiveEnabled: boolean;
  processor: <T>(items: BatchItem<T>[]) => Promise<void>;
}

interface BatchStatistics {
  totalProcessed: number;
  totalFailed: number;
  avgBatchSize: number;
  avgProcessingTime: number;
  queueDepth: number;
  droppedItems: number;
}

export class DynamicBatchProcessor<T = any> {
  private logger: Logger;
  private queue: Map<string, BatchItem<T>> = new Map();
  private priorityQueues: {
    high: BatchItem<T>[];
    normal: BatchItem<T>[];
    low: BatchItem<T>[];
  } = { high: [], normal: [], low: [] };
  
  private batchTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private stats: BatchStatistics;
  
  // Adaptive parameters
  private currentBatchSize: number;
  private currentTimeout: number;
  private processingTimes: number[] = [];
  
  constructor(
    private eventBus: EventBus,
    private config: BatchProcessorConfig
  ) {
    this.logger = new Logger({ context: 'DynamicBatchProcessor' });
    this.currentBatchSize = config.minBatchSize;
    this.currentTimeout = config.batchTimeout;
    
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
      avgBatchSize: 0,
      avgProcessingTime: 0,
      queueDepth: 0,
      droppedItems: 0
    };
    
    this.setupEventListeners();
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for configuration updates from optimizer
    this.eventBus.on('batching:config-updated', (data: {
      batchSize: number;
      batchTimeout: number;
    }) => {
      if (this.config.adaptiveEnabled) {
        this.currentBatchSize = data.batchSize;
        this.currentTimeout = data.batchTimeout;
        this.logger.debug('Batch configuration updated', data);
      }
    });
  }
  
  /**
   * Add item to batch queue
   */
  public add(item: BatchItem<T>): boolean {
    // Check queue size limit
    if (this.queue.size >= this.config.maxQueueSize) {
      this.stats.droppedItems++;
      this.eventBus.emit('batch:item-dropped', { id: item.id, reason: 'queue-full' });
      return false;
    }
    
    // Add to queue
    this.queue.set(item.id, item);
    
    if (this.config.priorityEnabled) {
      this.priorityQueues[item.priority].push(item);
    }
    
    this.stats.queueDepth = this.queue.size;
    
    // Start batch timer if not already running
    if (!this.batchTimer && !this.isProcessing) {
      this.scheduleBatch();
    }
    
    // Check if we should process immediately
    if (this.queue.size >= this.currentBatchSize) {
      this.processBatch();
    }
    
    return true;
  }
  
  /**
   * Schedule batch processing
   */
  private scheduleBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.currentTimeout);
  }
  
  /**
   * Process current batch
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.queue.size === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    const startTime = Date.now();
    
    try {
      // Build batch
      const batch = this.buildBatch();
      
      if (batch.length === 0) {
        return;
      }
      
      this.logger.debug(`Processing batch of ${batch.length} items`);
      
      // Process batch
      await this.config.processor(batch);
      
      // Update statistics
      const processingTime = Date.now() - startTime;
      this.updateStatistics(batch.length, processingTime, true);
      
      // Remove processed items from queue
      batch.forEach(item => {
        this.queue.delete(item.id);
        if (this.config.priorityEnabled) {
          this.removePriorityItem(item);
        }
      });
      
      this.eventBus.emit('batch:processed', {
        size: batch.length,
        duration: processingTime
      });
      
      // Adapt batch size if enabled
      if (this.config.adaptiveEnabled) {
        this.adaptBatchSize(processingTime, batch.length);
      }
      
    } catch (error) {
      this.logger.error('Batch processing failed', error as Error);
      this.stats.totalFailed++;
      
      // Update statistics for failure
      const processingTime = Date.now() - startTime;
      this.updateStatistics(0, processingTime, false);
      
      this.eventBus.emit('batch:failed', { error: (error as Error).message });
      
    } finally {
      this.isProcessing = false;
      this.stats.queueDepth = this.queue.size;
      
      // Schedule next batch if items remain
      if (this.queue.size > 0) {
        this.scheduleBatch();
      }
    }
  }
  
  /**
   * Build batch from queue
   */
  private buildBatch(): BatchItem<T>[] {
    const batch: BatchItem<T>[] = [];
    const maxSize = Math.min(this.currentBatchSize, this.queue.size);
    
    if (this.config.priorityEnabled) {
      // Process by priority
      const priorities: Array<'high' | 'normal' | 'low'> = ['high', 'normal', 'low'];
      
      for (const priority of priorities) {
        const items = this.priorityQueues[priority];
        while (items.length > 0 && batch.length < maxSize) {
          const item = items.shift();
          if (item && this.queue.has(item.id)) {
            batch.push(item);
          }
        }
      }
    } else {
      // Process in FIFO order
      let count = 0;
      for (const item of this.queue.values()) {
        if (count >= maxSize) break;
        batch.push(item);
        count++;
      }
    }
    
    return batch;
  }
  
  /**
   * Remove item from priority queue
   */
  private removePriorityItem(item: BatchItem<T>): void {
    const queue = this.priorityQueues[item.priority];
    const index = queue.findIndex(i => i.id === item.id);
    if (index > -1) {
      queue.splice(index, 1);
    }
  }
  
  /**
   * Update processing statistics
   */
  private updateStatistics(
    batchSize: number,
    processingTime: number,
    success: boolean
  ): void {
    if (success) {
      this.stats.totalProcessed += batchSize;
      
      // Update average batch size
      this.stats.avgBatchSize = this.stats.avgBatchSize === 0
        ? batchSize
        : (this.stats.avgBatchSize * 0.9 + batchSize * 0.1);
      
      // Update average processing time
      this.stats.avgProcessingTime = this.stats.avgProcessingTime === 0
        ? processingTime
        : (this.stats.avgProcessingTime * 0.9 + processingTime * 0.1);
      
      // Track processing times for adaptation
      this.processingTimes.push(processingTime);
      if (this.processingTimes.length > 100) {
        this.processingTimes.shift();
      }
    }
  }
  
  /**
   * Adapt batch size based on performance
   */
  private adaptBatchSize(processingTime: number, batchSize: number): void {
    const targetProcessingTime = 100; // Target 100ms per batch
    const tolerance = 0.2; // 20% tolerance
    
    // Calculate items per millisecond
    const itemsPerMs = batchSize / processingTime;
    
    // If processing is too slow, reduce batch size
    if (processingTime > targetProcessingTime * (1 + tolerance)) {
      this.currentBatchSize = Math.max(
        this.config.minBatchSize,
        Math.floor(targetProcessingTime * itemsPerMs)
      );
      
      // Also increase timeout to allow more items to accumulate
      this.currentTimeout = Math.min(
        this.config.batchTimeout * 2,
        this.currentTimeout * 1.1
      );
    }
    // If processing is too fast, increase batch size
    else if (processingTime < targetProcessingTime * (1 - tolerance)) {
      this.currentBatchSize = Math.min(
        this.config.maxBatchSize,
        Math.floor(targetProcessingTime * itemsPerMs)
      );
      
      // Reduce timeout for lower latency
      this.currentTimeout = Math.max(
        this.config.batchTimeout / 2,
        this.currentTimeout * 0.9
      );
    }
    
    this.logger.debug('Batch size adapted', {
      newSize: this.currentBatchSize,
      newTimeout: this.currentTimeout,
      processingTime,
      itemsPerMs
    });
  }
  
  /**
   * Get current statistics
   */
  public getStats(): BatchStatistics {
    return { ...this.stats };
  }
  
  /**
   * Get queue information
   */
  public getQueueInfo() {
    if (this.config.priorityEnabled) {
      return {
        total: this.queue.size,
        byPriority: {
          high: this.priorityQueues.high.length,
          normal: this.priorityQueues.normal.length,
          low: this.priorityQueues.low.length
        }
      };
    }
    
    return {
      total: this.queue.size
    };
  }
  
  /**
   * Force process current queue
   */
  public async flush(): Promise<void> {
    this.logger.info('Flushing batch queue');
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    while (this.queue.size > 0) {
      await this.processBatch();
    }
  }
  
  /**
   * Clear queue without processing
   */
  public clear(): void {
    this.queue.clear();
    this.priorityQueues = { high: [], normal: [], low: [] };
    this.stats.queueDepth = 0;
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    this.logger.info('Batch queue cleared');
  }
  
  /**
   * Stop processor
   */
  public async stop(): Promise<void> {
    this.logger.info('Stopping batch processor');
    
    // Process remaining items
    await this.flush();
    
    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
}