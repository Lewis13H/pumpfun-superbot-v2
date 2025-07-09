import { logger } from '../../../core/logger';

export interface BatchConfig {
  maxBatchSize: number;
  maxWaitTime: number; // milliseconds
  concurrency: number;
}

export interface BatchItem<T> {
  id: string;
  data: T;
  priority?: number;
  timestamp: number;
}

export interface BatchResult<T> {
  successful: BatchItem<T>[];
  failed: Array<{ item: BatchItem<T>; error: Error }>;
  processingTime: number;
}

export class BatchProcessor<T, R> {
  private queue: BatchItem<T>[] = [];
  private processing = false;
  private timer: NodeJS.Timer | null = null;
  
  private readonly defaultConfig: BatchConfig = {
    maxBatchSize: 50,
    maxWaitTime: 1000, // 1 second
    concurrency: 5
  };
  
  constructor(
    private processor: (items: T[]) => Promise<R[]>,
    private config: BatchConfig = {} as BatchConfig
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }
  
  async add(id: string, data: T, priority = 0): Promise<void> {
    const item: BatchItem<T> = {
      id,
      data,
      priority,
      timestamp: Date.now()
    };
    
    this.queue.push(item);
    
    // Sort by priority (higher first)
    this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    // Check if we should process immediately
    if (this.queue.length >= this.config.maxBatchSize) {
      await this.processBatch();
    } else if (!this.timer) {
      // Set timer for max wait time
      this.timer = setTimeout(() => {
        this.processBatch();
      }, this.config.maxWaitTime);
    }
  }
  
  async processBatch(): Promise<BatchResult<T>> {
    if (this.processing || this.queue.length === 0) {
      return {
        successful: [],
        failed: [],
        processingTime: 0
      };
    }
    
    this.processing = true;
    const startTime = Date.now();
    
    // Clear timer
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    // Take items from queue
    const batch = this.queue.splice(0, this.config.maxBatchSize);
    const result: BatchResult<T> = {
      successful: [],
      failed: [],
      processingTime: 0
    };
    
    try {
      logger.debug(`Processing batch of ${batch.length} items`);
      
      // Process in chunks based on concurrency
      const chunks = this.chunkArray(batch, Math.ceil(batch.length / this.config.concurrency));
      
      for (const chunk of chunks) {
        try {
          const data = chunk.map(item => item.data);
          await this.processor(data);
          
          result.successful.push(...chunk);
        } catch (error) {
          // If batch processing fails, try individual items
          for (const item of chunk) {
            try {
              await this.processor([item.data]);
              result.successful.push(item);
            } catch (itemError) {
              result.failed.push({
                item,
                error: itemError as Error
              });
            }
          }
        }
      }
      
      result.processingTime = Date.now() - startTime;
      
      logger.info(`Batch processed: ${result.successful.length} successful, ${result.failed.length} failed in ${result.processingTime}ms`);
      
    } catch (error) {
      logger.error('Batch processing failed:', error);
      
      // Mark all items as failed
      result.failed = batch.map(item => ({
        item,
        error: error as Error
      }));
      
    } finally {
      this.processing = false;
      
      // If there are more items in queue, schedule next batch
      if (this.queue.length > 0) {
        this.timer = setTimeout(() => {
          this.processBatch();
        }, 100); // Small delay between batches
      }
    }
    
    return result;
  }
  
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
  
  async flush(): Promise<BatchResult<T>> {
    logger.info('Flushing batch processor queue');
    return this.processBatch();
  }
  
  getQueueSize(): number {
    return this.queue.length;
  }
  
  getQueueInfo(): {
    size: number;
    oldestItem?: number;
    processing: boolean;
  } {
    const oldestItem = this.queue.length > 0 
      ? Date.now() - this.queue[0].timestamp
      : undefined;
    
    return {
      size: this.queue.length,
      oldestItem,
      processing: this.processing
    };
  }
  
  clear(): void {
    this.queue = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// Specialized batch processors

export class HolderAnalysisBatchProcessor extends BatchProcessor<string, any> {
  constructor(
    private analysisService: any,
    config?: BatchConfig
  ) {
    super(
      async (mintAddresses: string[]) => {
        const results = [];
        
        for (const mintAddress of mintAddresses) {
          try {
            const analysis = await this.analysisService.analyzeToken(mintAddress);
            results.push(analysis);
          } catch (error) {
            logger.error(`Failed to analyze ${mintAddress}:`, error);
            throw error;
          }
        }
        
        return results;
      },
      config
    );
  }
}

export class WalletClassificationBatchProcessor extends BatchProcessor<string, any> {
  constructor(
    private classificationService: any,
    config?: BatchConfig
  ) {
    super(
      async (walletAddresses: string[]) => {
        return this.classificationService.classifyWallets(walletAddresses);
      },
      config
    );
  }
}

export class SnapshotBatchProcessor extends BatchProcessor<any, void> {
  constructor(
    private storageService: any,
    config?: BatchConfig
  ) {
    super(
      async (snapshots: any[]) => {
        await this.storageService.saveSnapshots(snapshots);
        return [];
      },
      config
    );
  }
}