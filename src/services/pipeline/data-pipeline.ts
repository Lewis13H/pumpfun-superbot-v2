/**
 * Data Pipeline - Central event processing and routing system
 * Handles event normalization, batching, and distribution to appropriate services
 */

import { EventBus, EVENTS } from '../../core/event-bus';
import { Logger, loggers } from '../../core/logger';
import { EventProcessor } from './event-processor';
import { EventNormalizer } from './event-normalizer';
import { BatchManager } from './batch-manager';
import { PipelineMetrics } from './pipeline-metrics';
import * as chalk from 'chalk';

export interface PipelineConfig {
  batchSize: number;
  batchTimeout: number;
  maxRetries: number;
  enableCaching: boolean;
  enableMetrics: boolean;
  processors: string[];
}

export interface NormalizedEvent {
  id: string;
  type: 'token_lifecycle' | 'trade' | 'liquidity' | 'pool_state' | 'mev' | 'unknown';
  source: 'bonding_curve' | 'amm_pool' | 'external_amm';
  timestamp: Date;
  data: any;
  metadata: {
    programId: string;
    signature?: string;
    slot: bigint;
    monitorId: string;
    priority: 'high' | 'medium' | 'low';
  };
}

export interface PipelineStats {
  eventsProcessed: number;
  eventsQueued: number;
  eventsFailed: number;
  batchesProcessed: number;
  avgBatchSize: number;
  avgProcessingTime: number;
  throughput: number;
  errorRate: number;
}

export class DataPipeline {
  private static instance: DataPipeline;
  private static injectedEventBus?: EventBus;
  private logger: Logger;
  private eventBus: EventBus;
  private config: PipelineConfig;
  private normalizer: EventNormalizer;
  private batchManager: BatchManager;
  private processors: Map<string, EventProcessor> = new Map();
  private metrics: PipelineMetrics;
  private stats: PipelineStats = {
    eventsProcessed: 0,
    eventsQueued: 0,
    eventsFailed: 0,
    batchesProcessed: 0,
    avgBatchSize: 0,
    avgProcessingTime: 0,
    throughput: 0,
    errorRate: 0
  };
  private startTime: number = Date.now();
  private processingInterval?: NodeJS.Timeout;

  private constructor(config: PipelineConfig) {
    this.config = config;
    this.logger = loggers.service('DataPipeline');
    // Use injected EventBus or create new one
    this.eventBus = DataPipeline.injectedEventBus || new EventBus();
    this.normalizer = new EventNormalizer();
    this.batchManager = new BatchManager({
      maxBatchSize: config.batchSize,
      maxWaitTime: config.batchTimeout,
      onBatchReady: this.processBatch.bind(this)
    });
    this.metrics = new PipelineMetrics();
  }

  static getInstance(config?: PipelineConfig): DataPipeline {
    if (!DataPipeline.instance) {
      if (!config) {
        throw new Error('DataPipeline requires config on first initialization');
      }
      DataPipeline.instance = new DataPipeline(config);
    }
    return DataPipeline.instance;
  }

  /**
   * Set EventBus instance (for dependency injection)
   */
  static setEventBus(eventBus: EventBus): void {
    DataPipeline.injectedEventBus = eventBus;
  }

  /**
   * Initialize the pipeline
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing data pipeline', {
      batchSize: this.config.batchSize,
      batchTimeout: this.config.batchTimeout,
      processors: this.config.processors.length
    });

    // Setup event listeners
    this.setupEventListeners();

    // Initialize processors
    await this.initializeProcessors();

    // Start batch processing
    this.startProcessing();

    this.logger.info('Data pipeline initialized');
  }

  /**
   * Setup event listeners for all monitor events
   */
  private setupEventListeners(): void {
    // Token lifecycle events
    this.eventBus.on(EVENTS.TOKEN_CREATED, (event) => this.handleEvent('token_lifecycle', event));
    this.eventBus.on(EVENTS.TOKEN_GRADUATED, (event) => this.handleEvent('token_lifecycle', event));
    this.eventBus.on(EVENTS.TOKEN_LIFECYCLE_PHASE_CHANGE, (event) => this.handleEvent('token_lifecycle', event));
    
    // Trade events
    this.eventBus.on(EVENTS.TRADE_EXECUTED, (event) => this.handleEvent('trade', event));
    this.eventBus.on(EVENTS.MEV_DETECTED, (event) => this.handleEvent('trade', event));
    this.eventBus.on(EVENTS.HIGH_SLIPPAGE_TRADE, (event) => this.handleEvent('trade', event));
    
    // Liquidity events
    this.eventBus.on(EVENTS.LIQUIDITY_ADDED, (event) => this.handleEvent('liquidity', event));
    this.eventBus.on(EVENTS.LIQUIDITY_REMOVED, (event) => this.handleEvent('liquidity', event));
    this.eventBus.on(EVENTS.FEE_COLLECTED, (event) => this.handleEvent('liquidity', event));
    
    // Pool state events
    this.eventBus.on(EVENTS.POOL_STATE_UPDATED, (event) => this.handleEvent('pool_state', event));
    this.eventBus.on(EVENTS.POOL_CREATED, (event) => this.handleEvent('pool_state', event));

    this.logger.debug('Event listeners configured');
  }

  /**
   * Initialize event processors
   */
  private async initializeProcessors(): Promise<void> {
    // Initialize processors based on config
    for (const processorName of this.config.processors) {
      try {
        const processor = await this.createProcessor(processorName);
        this.processors.set(processorName, processor);
        this.logger.info(`Initialized processor: ${processorName}`);
      } catch (error) {
        this.logger.error(`Failed to initialize processor: ${processorName}`, error);
      }
    }
  }

  /**
   * Create a processor instance
   */
  private async createProcessor(name: string): Promise<EventProcessor> {
    // This would be extended to support different processor types
    return new EventProcessor({
      name,
      type: 'default',
      config: {
        maxRetries: this.config.maxRetries,
        enableCaching: this.config.enableCaching
      }
    });
  }

  /**
   * Handle incoming event
   */
  private async handleEvent(type: string, event: any): Promise<void> {
    try {
      this.stats.eventsQueued++;
      
      // Normalize the event
      const normalizedEvent = this.normalizer.normalize(type, event);
      
      // Add to batch
      await this.batchManager.addEvent(normalizedEvent);
      
      // Update metrics
      this.metrics.recordEvent(normalizedEvent);
      
    } catch (error) {
      this.stats.eventsFailed++;
      this.logger.error('Error handling event', error);
    }
  }

  /**
   * Process a batch of events
   */
  private async processBatch(batch: NormalizedEvent[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.debug(`Processing batch of ${batch.length} events`);
      
      // Group events by type for efficient processing
      const eventsByType = this.groupEventsByType(batch);
      
      // Process each group through appropriate processors
      const processingPromises: Promise<void>[] = [];
      
      for (const [eventType, events] of eventsByType) {
        // Route to appropriate processors
        const processors = this.getProcessorsForType(eventType);
        
        for (const processor of processors) {
          processingPromises.push(
            processor.processBatch(events)
              .catch(error => {
                this.logger.error(`Processor ${processor.name} failed`, error);
                this.stats.eventsFailed += events.length;
              })
          );
        }
      }
      
      // Wait for all processors to complete
      await Promise.all(processingPromises);
      
      // Update stats
      this.stats.eventsProcessed += batch.length;
      this.stats.batchesProcessed++;
      this.updateAverages(batch.length, Date.now() - startTime);
      
      // Record metrics
      this.metrics.recordBatch(batch.length, Date.now() - startTime);
      
      // Emit pipeline stats
      this.eventBus.emit(EVENTS.PIPELINE_STATS_UPDATED, this.getStats());
      
    } catch (error) {
      this.logger.error('Error processing batch', error);
      this.stats.eventsFailed += batch.length;
    }
  }

  /**
   * Group events by type
   */
  private groupEventsByType(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
    const groups = new Map<string, NormalizedEvent[]>();
    
    for (const event of events) {
      const type = event.type;
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(event);
    }
    
    return groups;
  }

  /**
   * Get processors for event type
   */
  private getProcessorsForType(eventType: string): EventProcessor[] {
    // Route events to appropriate processors
    const processors: EventProcessor[] = [];
    
    switch (eventType) {
      case 'token_lifecycle':
        if (this.processors.has('token')) processors.push(this.processors.get('token')!);
        if (this.processors.has('database')) processors.push(this.processors.get('database')!);
        break;
        
      case 'trade':
        if (this.processors.has('trade')) processors.push(this.processors.get('trade')!);
        if (this.processors.has('analytics')) processors.push(this.processors.get('analytics')!);
        if (this.processors.has('database')) processors.push(this.processors.get('database')!);
        break;
        
      case 'liquidity':
        if (this.processors.has('liquidity')) processors.push(this.processors.get('liquidity')!);
        if (this.processors.has('database')) processors.push(this.processors.get('database')!);
        break;
        
      case 'pool_state':
        if (this.processors.has('pool')) processors.push(this.processors.get('pool')!);
        if (this.processors.has('cache')) processors.push(this.processors.get('cache')!);
        break;
        
      default:
        if (this.processors.has('default')) processors.push(this.processors.get('default')!);
    }
    
    return processors;
  }

  /**
   * Start processing loop
   */
  private startProcessing(): void {
    // Process batches periodically
    this.processingInterval = setInterval(() => {
      this.batchManager.checkTimeout();
      this.updateThroughput();
    }, 1000);
  }

  /**
   * Update running averages
   */
  private updateAverages(batchSize: number, processingTime: number): void {
    const alpha = 0.1; // Exponential moving average factor
    
    this.stats.avgBatchSize = this.stats.avgBatchSize * (1 - alpha) + batchSize * alpha;
    this.stats.avgProcessingTime = this.stats.avgProcessingTime * (1 - alpha) + processingTime * alpha;
    
    if (this.stats.eventsProcessed > 0) {
      this.stats.errorRate = (this.stats.eventsFailed / this.stats.eventsProcessed) * 100;
    }
  }

  /**
   * Update throughput calculation
   */
  private updateThroughput(): void {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    if (elapsedSeconds > 0) {
      this.stats.throughput = this.stats.eventsProcessed / elapsedSeconds;
    }
  }

  /**
   * Get pipeline statistics
   */
  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /**
   * Get pipeline metrics
   */
  getMetrics(): any {
    return this.metrics.getMetrics();
  }

  /**
   * Display pipeline statistics
   */
  displayStats(): void {
    const runtime = Math.floor((Date.now() - this.startTime) / 1000);
    
    console.log(chalk.magenta('\n📊 Data Pipeline Statistics:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Runtime: ${chalk.white(runtime)}s`);
    console.log(`Events Processed: ${chalk.green(this.stats.eventsProcessed)}`);
    console.log(`Events Queued: ${chalk.yellow(this.stats.eventsQueued)}`);
    console.log(`Events Failed: ${chalk.red(this.stats.eventsFailed)}`);
    console.log(`Error Rate: ${chalk.red(this.stats.errorRate.toFixed(2) + '%')}`);
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Batches Processed: ${chalk.cyan(this.stats.batchesProcessed)}`);
    console.log(`Avg Batch Size: ${chalk.blue(this.stats.avgBatchSize.toFixed(1))}`);
    console.log(`Avg Processing Time: ${chalk.green(this.stats.avgProcessingTime.toFixed(0) + 'ms')}`);
    console.log(`Throughput: ${chalk.magenta(this.stats.throughput.toFixed(2) + ' events/s')}`);
    console.log(chalk.gray('─'.repeat(50)));
    
    // Display processor stats
    console.log(chalk.magenta('\n🔧 Processor Status:'));
    for (const [name, processor] of this.processors) {
      const stats = processor.getStats();
      console.log(`${name}: ${stats.processed} processed, ${stats.failed} failed`);
    }
  }

  /**
   * Shutdown the pipeline
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down data pipeline...');
    
    // Stop processing
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    // Flush remaining batches
    await this.batchManager.flush();
    
    // Shutdown processors
    for (const processor of this.processors.values()) {
      await processor.shutdown();
    }
    
    // Display final stats
    this.displayStats();
    
    this.logger.info('Data pipeline shutdown complete');
  }
}