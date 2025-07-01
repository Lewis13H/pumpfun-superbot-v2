/**
 * Slot Recovery Service
 * Handles recovery from specific slots and historical data processing
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { db } from '../database';

export interface RecoveryConfig {
  batchSize: number;
  maxConcurrentBatches: number;
  processingDelay: number;
  retryAttempts: number;
  checkpointInterval: number;
}

export interface RecoveryRequest {
  id: string;
  fromSlot: bigint;
  toSlot?: bigint;
  programs: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: {
    currentSlot: bigint;
    processedSlots: number;
    totalSlots: number;
    startTime: Date;
    estimatedCompletion?: Date;
  };
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface RecoveryStats {
  totalRecoveries: number;
  activeRecoveries: number;
  completedRecoveries: number;
  failedRecoveries: number;
  totalSlotsProcessed: number;
  averageProcessingRate: number;
  lastRecoveryTime?: Date;
}

export interface SlotCheckpoint {
  slot: bigint;
  timestamp: Date;
  transactionsProcessed: number;
  accountsUpdated: number;
  errors: number;
}

export class SlotRecoveryService {
  private static instance: SlotRecoveryService;
  private logger: Logger;
  private eventBus: EventBus;
  
  private config: RecoveryConfig;
  private activeRecoveries: Map<string, RecoveryRequest> = new Map();
  private recoveryQueue: RecoveryRequest[] = [];
  private isProcessing: boolean = false;
  
  // Stream management
  private recoveryStreams: Map<string, any> = new Map();
  private checkpoints: Map<string, SlotCheckpoint[]> = new Map();
  
  // Statistics
  private stats: RecoveryStats = {
    totalRecoveries: 0,
    activeRecoveries: 0,
    completedRecoveries: 0,
    failedRecoveries: 0,
    totalSlotsProcessed: 0,
    averageProcessingRate: 0
  };

  private constructor(eventBus: EventBus, config?: Partial<RecoveryConfig>) {
    this.logger = new Logger({ context: 'SlotRecoveryService' });
    this.eventBus = eventBus;
    
    this.config = {
      batchSize: 1000,
      maxConcurrentBatches: 3,
      processingDelay: 100,
      retryAttempts: 3,
      checkpointInterval: 10000, // Every 10k slots
      ...config
    };
    
    this.initialize();
  }

  static async create(
    eventBus: EventBus, 
    config?: Partial<RecoveryConfig>
  ): Promise<SlotRecoveryService> {
    if (!SlotRecoveryService.instance) {
      SlotRecoveryService.instance = new SlotRecoveryService(eventBus, config);
      await SlotRecoveryService.instance.createTables();
    }
    return SlotRecoveryService.instance;
  }

  /**
   * Initialize the service
   */
  private initialize(): void {
    this.setupEventListeners();
    this.startProcessingLoop();
    
    this.logger.info('Slot recovery service initialized', this.config);
  }

  /**
   * Create required database tables
   */
  private async createTables(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS recovery_requests (
          id VARCHAR(36) PRIMARY KEY,
          from_slot BIGINT NOT NULL,
          to_slot BIGINT,
          programs TEXT[],
          status VARCHAR(20) NOT NULL,
          current_slot BIGINT,
          processed_slots INTEGER DEFAULT 0,
          total_slots INTEGER,
          error_message TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          started_at TIMESTAMP,
          completed_at TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_requests(status);
        CREATE INDEX IF NOT EXISTS idx_recovery_created ON recovery_requests(created_at DESC);
        
        CREATE TABLE IF NOT EXISTS recovery_checkpoints (
          id SERIAL PRIMARY KEY,
          recovery_id VARCHAR(36) REFERENCES recovery_requests(id),
          slot BIGINT NOT NULL,
          transactions_processed INTEGER DEFAULT 0,
          accounts_updated INTEGER DEFAULT 0,
          errors INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_checkpoint_recovery ON recovery_checkpoints(recovery_id);
      `);
    } catch (error) {
      this.logger.error('Error creating tables', error as Error);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for slot updates during recovery
    this.eventBus.on('recovery:slot_processed', this.handleSlotProcessed.bind(this));
    
    // Listen for recovery completion
    this.eventBus.on('recovery:batch_complete', this.handleBatchComplete.bind(this));
    
    // Listen for errors
    this.eventBus.on('recovery:error', this.handleRecoveryError.bind(this));
  }

  /**
   * Start processing loop
   */
  private startProcessingLoop(): void {
    setInterval(() => this.processQueue(), 5000);
  }

  /**
   * Request slot recovery
   */
  async requestRecovery(
    fromSlot: bigint,
    toSlot?: bigint,
    programs?: string[]
  ): Promise<RecoveryRequest> {
    const request: RecoveryRequest = {
      id: this.generateRecoveryId(),
      fromSlot,
      toSlot,
      programs: programs || [],
      status: 'pending',
      progress: {
        currentSlot: fromSlot,
        processedSlots: 0,
        totalSlots: toSlot ? Number(toSlot - fromSlot) : 0,
        startTime: new Date()
      },
      createdAt: new Date()
    };
    
    // Add to queue
    this.recoveryQueue.push(request);
    
    // Store in database
    await this.storeRecoveryRequest(request);
    
    // Update stats
    this.stats.totalRecoveries++;
    
    this.logger.info('Recovery requested', {
      id: request.id,
      fromSlot: fromSlot.toString(),
      toSlot: toSlot?.toString(),
      programs: programs?.length || 0
    });
    
    // Emit event
    this.eventBus.emit('recovery:requested', request);
    
    return request;
  }

  /**
   * Process recovery queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.recoveryQueue.length === 0) return;
    
    // Check if we can process more
    if (this.activeRecoveries.size >= this.config.maxConcurrentBatches) return;
    
    this.isProcessing = true;
    
    try {
      // Get next recovery request
      const request = this.recoveryQueue.shift();
      if (!request) return;
      
      // Start recovery
      await this.startRecovery(request);
    } catch (error) {
      this.logger.error('Error processing queue', error as Error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Start recovery process
   */
  private async startRecovery(request: RecoveryRequest): Promise<void> {
    try {
      // Update status
      request.status = 'processing';
      request.progress.startTime = new Date();
      
      // Add to active recoveries
      this.activeRecoveries.set(request.id, request);
      this.stats.activeRecoveries++;
      
      // Update database
      await this.updateRecoveryStatus(request);
      
      this.logger.info('Starting recovery', {
        id: request.id,
        fromSlot: request.fromSlot.toString()
      });
      
      // Create recovery stream
      const stream = await this.createRecoveryStream(request);
      this.recoveryStreams.set(request.id, stream);
      
      // Process slots
      await this.processSlots(request, stream);
      
    } catch (error) {
      this.logger.error('Error starting recovery', error as Error);
      await this.failRecovery(request, error as Error);
    }
  }

  /**
   * Create recovery stream
   */
  private async createRecoveryStream(request: RecoveryRequest): Promise<any> {
    // This would create a subscription with fromSlot parameter
    // For now, return a mock stream
    const subscribeRequest = {
      slots: {},
      accounts: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      entry: {},
      commitment: 'confirmed',
      fromSlot: request.fromSlot.toString()
    };
    
    if (request.programs.length > 0) {
      subscribeRequest.transactions = {
        recovery: {
          vote: false,
          failed: false,
          accountInclude: request.programs
        }
      };
    }
    
    // Emit stream creation event
    this.eventBus.emit('recovery:stream_created', {
      recoveryId: request.id,
      subscribeRequest
    });
    
    return subscribeRequest;
  }

  /**
   * Process slots
   */
  private async processSlots(request: RecoveryRequest, _stream: any): Promise<void> {
    const startSlot = request.fromSlot;
    const endSlot = request.toSlot || startSlot + BigInt(this.config.batchSize);
    
    let currentSlot = startSlot;
    let processedCount = 0;
    
    while (currentSlot <= endSlot) {
      try {
        // Process batch
        const batchEnd = currentSlot + BigInt(this.config.batchSize);
        const actualEnd = batchEnd > endSlot ? endSlot : batchEnd;
        
        await this.processBatch(request, currentSlot, actualEnd);
        
        // Update progress
        processedCount += Number(actualEnd - currentSlot);
        request.progress.currentSlot = actualEnd;
        request.progress.processedSlots = processedCount;
        
        // Calculate ETA
        const elapsed = Date.now() - request.progress.startTime.getTime();
        const rate = processedCount / (elapsed / 1000); // slots per second
        const remaining = request.progress.totalSlots - processedCount;
        const eta = remaining / rate * 1000; // milliseconds
        request.progress.estimatedCompletion = new Date(Date.now() + eta);
        
        // Create checkpoint if needed
        if (processedCount % this.config.checkpointInterval === 0) {
          await this.createCheckpoint(request, currentSlot);
        }
        
        // Update database
        await this.updateRecoveryProgress(request);
        
        // Emit progress event
        this.eventBus.emit('recovery:progress', {
          recoveryId: request.id,
          progress: request.progress
        });
        
        // Move to next batch
        currentSlot = actualEnd + 1n;
        
        // Add delay to avoid overwhelming the system
        await this.delay(this.config.processingDelay);
        
      } catch (error) {
        this.logger.error('Error processing batch', {
          recoveryId: request.id,
          currentSlot: currentSlot.toString(),
          error
        });
        
        // Retry logic
        // For now, just fail the recovery
        throw error;
      }
    }
    
    // Complete recovery
    await this.completeRecovery(request);
  }

  /**
   * Process a batch of slots
   */
  private async processBatch(
    request: RecoveryRequest,
    startSlot: bigint,
    endSlot: bigint
  ): Promise<void> {
    // This would process the actual slot data
    // For now, simulate processing
    
    const slots = Number(endSlot - startSlot);
    const transactionsPerSlot = Math.floor(Math.random() * 100) + 50;
    const totalTransactions = slots * transactionsPerSlot;
    
    this.logger.debug('Processing batch', {
      recoveryId: request.id,
      startSlot: startSlot.toString(),
      endSlot: endSlot.toString(),
      slots
    });
    
    // Simulate processing time
    await this.delay(slots * 10);
    
    // Update stats
    this.stats.totalSlotsProcessed += slots;
    
    // Emit batch complete event
    this.eventBus.emit('recovery:batch_complete', {
      recoveryId: request.id,
      startSlot: startSlot.toString(),
      endSlot: endSlot.toString(),
      transactionsProcessed: totalTransactions
    });
  }

  /**
   * Create checkpoint
   */
  private async createCheckpoint(
    request: RecoveryRequest,
    slot: bigint
  ): Promise<void> {
    const checkpoint: SlotCheckpoint = {
      slot,
      timestamp: new Date(),
      transactionsProcessed: 0, // Would be tracked during processing
      accountsUpdated: 0,
      errors: 0
    };
    
    // Add to checkpoints
    if (!this.checkpoints.has(request.id)) {
      this.checkpoints.set(request.id, []);
    }
    this.checkpoints.get(request.id)!.push(checkpoint);
    
    // Store in database
    await db.query(`
      INSERT INTO recovery_checkpoints (
        recovery_id, slot, transactions_processed, 
        accounts_updated, errors
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      request.id,
      slot.toString(),
      checkpoint.transactionsProcessed,
      checkpoint.accountsUpdated,
      checkpoint.errors
    ]);
    
    this.logger.debug('Checkpoint created', {
      recoveryId: request.id,
      slot: slot.toString()
    });
  }

  /**
   * Complete recovery
   */
  private async completeRecovery(request: RecoveryRequest): Promise<void> {
    request.status = 'completed';
    request.completedAt = new Date();
    
    // Remove from active
    this.activeRecoveries.delete(request.id);
    this.recoveryStreams.delete(request.id);
    
    // Update stats
    this.stats.activeRecoveries--;
    this.stats.completedRecoveries++;
    this.stats.lastRecoveryTime = new Date();
    
    // Update database
    await this.updateRecoveryStatus(request);
    
    this.logger.info('Recovery completed', {
      id: request.id,
      processedSlots: request.progress.processedSlots,
      duration: Date.now() - request.progress.startTime.getTime()
    });
    
    // Emit completion event
    this.eventBus.emit('recovery:completed', request);
  }

  /**
   * Fail recovery
   */
  private async failRecovery(request: RecoveryRequest, error: Error): Promise<void> {
    request.status = 'failed';
    request.error = error.message;
    request.completedAt = new Date();
    
    // Remove from active
    this.activeRecoveries.delete(request.id);
    this.recoveryStreams.delete(request.id);
    
    // Update stats
    this.stats.activeRecoveries--;
    this.stats.failedRecoveries++;
    
    // Update database
    await this.updateRecoveryStatus(request);
    
    this.logger.error('Recovery failed', {
      id: request.id,
      error: error.message
    });
    
    // Emit failure event
    this.eventBus.emit('recovery:failed', {
      request,
      error: error.message
    });
  }

  /**
   * Handle slot processed event
   */
  private handleSlotProcessed(event: any): void {
    // Update recovery progress if applicable
    const recoveryId = event.recoveryId;
    if (!recoveryId) return;
    
    const request = this.activeRecoveries.get(recoveryId);
    if (request) {
      // Update progress would happen here
    }
  }

  /**
   * Handle batch complete event
   */
  private handleBatchComplete(event: any): void {
    // Log batch completion
    this.logger.debug('Batch completed', event);
  }

  /**
   * Handle recovery error
   */
  private async handleRecoveryError(event: any): Promise<void> {
    const request = this.activeRecoveries.get(event.recoveryId);
    if (request) {
      await this.failRecovery(request, new Error(event.error));
    }
  }

  /**
   * Store recovery request in database
   */
  private async storeRecoveryRequest(request: RecoveryRequest): Promise<void> {
    try {
      await db.query(`
        INSERT INTO recovery_requests (
          id, from_slot, to_slot, programs, status,
          current_slot, processed_slots, total_slots
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        request.id,
        request.fromSlot.toString(),
        request.toSlot?.toString() || null,
        request.programs,
        request.status,
        request.progress.currentSlot.toString(),
        request.progress.processedSlots,
        request.progress.totalSlots
      ]);
    } catch (error) {
      this.logger.error('Error storing recovery request', error as Error);
    }
  }

  /**
   * Update recovery status
   */
  private async updateRecoveryStatus(request: RecoveryRequest): Promise<void> {
    try {
      await db.query(`
        UPDATE recovery_requests SET
          status = $2,
          error_message = $3,
          started_at = COALESCE(started_at, $4),
          completed_at = $5
        WHERE id = $1
      `, [
        request.id,
        request.status,
        request.error || null,
        request.status === 'processing' ? new Date() : null,
        request.completedAt || null
      ]);
    } catch (error) {
      this.logger.error('Error updating recovery status', error as Error);
    }
  }

  /**
   * Update recovery progress
   */
  private async updateRecoveryProgress(request: RecoveryRequest): Promise<void> {
    try {
      await db.query(`
        UPDATE recovery_requests SET
          current_slot = $2,
          processed_slots = $3
        WHERE id = $1
      `, [
        request.id,
        request.progress.currentSlot.toString(),
        request.progress.processedSlots
      ]);
    } catch (error) {
      this.logger.error('Error updating recovery progress', error as Error);
    }
  }

  /**
   * Generate recovery ID
   */
  private generateRecoveryId(): string {
    return `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get recovery status
   */
  getRecoveryStatus(recoveryId: string): RecoveryRequest | undefined {
    return this.activeRecoveries.get(recoveryId);
  }

  /**
   * Get all active recoveries
   */
  getActiveRecoveries(): RecoveryRequest[] {
    return Array.from(this.activeRecoveries.values());
  }

  /**
   * Get recovery statistics
   */
  getStats(): RecoveryStats {
    // Calculate average processing rate
    if (this.stats.totalSlotsProcessed > 0 && this.stats.lastRecoveryTime) {
      const totalTime = Date.now() - this.stats.lastRecoveryTime.getTime();
      this.stats.averageProcessingRate = this.stats.totalSlotsProcessed / (totalTime / 1000);
    }
    
    return { ...this.stats };
  }

  /**
   * Get recovery history
   */
  async getRecoveryHistory(limit: number = 10): Promise<RecoveryRequest[]> {
    try {
      const result = await db.query(`
        SELECT * FROM recovery_requests
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
      
      return result.rows.map((row: any) => ({
        id: row.id,
        fromSlot: BigInt(row.from_slot),
        toSlot: row.to_slot ? BigInt(row.to_slot) : undefined,
        programs: row.programs || [],
        status: row.status,
        progress: {
          currentSlot: BigInt(row.current_slot || row.from_slot),
          processedSlots: row.processed_slots || 0,
          totalSlots: row.total_slots || 0,
          startTime: row.started_at || row.created_at
        },
        error: row.error_message,
        createdAt: row.created_at,
        completedAt: row.completed_at
      }));
    } catch (error) {
      this.logger.error('Error getting recovery history', error as Error);
      return [];
    }
  }

  /**
   * Cancel recovery
   */
  async cancelRecovery(recoveryId: string): Promise<boolean> {
    const request = this.activeRecoveries.get(recoveryId);
    if (!request) return false;
    
    await this.failRecovery(request, new Error('Recovery cancelled by user'));
    return true;
  }
}