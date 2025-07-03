/**
 * Block Tracker Service
 * Tracks blocks and slots for chain state consistency
 */

import { Logger } from '../../core/logger';
import { EventBus, EVENTS } from '../../core/event-bus';
import { db } from '../../database';

export interface BlockInfo {
  slot: bigint;
  blockHeight: bigint;
  blockTime: number;
  parentSlot: bigint;
  status: 'processed' | 'confirmed' | 'finalized';
  transactionCount: number;
  successfulTransactions: number;
  failedTransactions: number;
  feeRewards: bigint;
  leader: string;
  hash: string;
}

export interface SlotGap {
  startSlot: bigint;
  endSlot: bigint;
  duration: number; // seconds
  missedSlots: number;
  reason?: 'fork' | 'leader_skip' | 'network_issue';
}

export interface ChainStats {
  currentSlot: bigint;
  currentBlockHeight: bigint;
  avgBlockTime: number; // milliseconds
  avgTransactionsPerBlock: number;
  slotGaps: SlotGap[];
  totalSlots: number;
  missedSlots: number;
  slotSuccessRate: number;
  lastFinalizedSlot: bigint;
  lastConfirmedSlot: bigint;
}

export class BlockTracker {
  private static instance: BlockTracker;
  private logger: Logger;
  private eventBus: EventBus;
  
  private blocks: Map<bigint, BlockInfo> = new Map();
  private slotGaps: SlotGap[] = [];
  private lastProcessedSlot: bigint = 0n;
  private slotTimestamps: Map<bigint, number> = new Map();
  
  // Chain state
  private currentSlot: bigint = 0n;
  private currentBlockHeight: bigint = 0n;
  private lastFinalizedSlot: bigint = 0n;
  private lastConfirmedSlot: bigint = 0n;

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'BlockTracker' });
    this.eventBus = eventBus;
    
    this.setupEventListeners();
    this.startPeriodicTasks();
  }

  static async create(eventBus: EventBus): Promise<BlockTracker> {
    if (!BlockTracker.instance) {
      BlockTracker.instance = new BlockTracker(eventBus);
      await BlockTracker.instance.initialize();
    }
    return BlockTracker.instance;
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    await this.createTables();
    await this.loadRecentBlocks();
    
    this.logger.info('Block tracker initialized', {
      currentSlot: this.currentSlot.toString(),
      blocksLoaded: this.blocks.size
    });
  }

  /**
   * Create required database tables
   */
  private async createTables(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS slot_progression (
          slot BIGINT PRIMARY KEY,
          parent_slot BIGINT,
          block_height BIGINT,
          block_time TIMESTAMP NOT NULL,
          status VARCHAR(20) NOT NULL,
          transaction_count INTEGER DEFAULT 0,
          successful_txs INTEGER DEFAULT 0,
          failed_txs INTEGER DEFAULT 0,
          fee_rewards BIGINT DEFAULT 0,
          leader VARCHAR(64),
          block_hash VARCHAR(88),
          fork_detected BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_slot_time ON slot_progression(block_time DESC);
        CREATE INDEX IF NOT EXISTS idx_slot_status ON slot_progression(status);
        CREATE INDEX IF NOT EXISTS idx_slot_parent ON slot_progression(parent_slot);
        
        CREATE TABLE IF NOT EXISTS slot_gaps (
          id SERIAL PRIMARY KEY,
          start_slot BIGINT NOT NULL,
          end_slot BIGINT NOT NULL,
          duration_seconds INTEGER,
          missed_slots INTEGER,
          reason VARCHAR(20),
          detected_at TIMESTAMP DEFAULT NOW()
        );
      `);
    } catch (error) {
      this.logger.error('Error creating tables', error as Error);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for slot updates
    this.eventBus.on('slot:update', this.handleSlotUpdate.bind(this));
    
    // Listen for block data
    this.eventBus.on(EVENTS.STREAM_DATA, this.handleStreamData.bind(this));
    
    // Listen for finalized blocks
    this.eventBus.on('block:finalized', this.handleBlockFinalized.bind(this));
    
    // Listen for fork detection
    this.eventBus.on('fork:detected', this.handleForkDetected.bind(this));
  }

  /**
   * Start periodic tasks
   */
  private startPeriodicTasks(): void {
    // Check for slot gaps every 10 seconds
    setInterval(() => this.checkSlotGaps(), 10000);
    
    // Update chain stats every 30 seconds
    setInterval(() => this.updateChainStats(), 30000);
    
    // Clean up old data every hour
    setInterval(() => this.cleanupOldData(), 3600000);
  }

  /**
   * Handle slot update
   */
  private async handleSlotUpdate(slotInfo: any): Promise<void> {
    try {
      const slot = BigInt(slotInfo.slot);
      const parentSlot = slotInfo.parentSlot ? BigInt(slotInfo.parentSlot) : slot - 1n;
      const blockHeight = slotInfo.blockHeight ? BigInt(slotInfo.blockHeight) : 0n;
      const blockTime = slotInfo.blockTime || Math.floor(Date.now() / 1000);
      const status = slotInfo.status || 'processed';
      
      // Update current slot
      if (slot > this.currentSlot) {
        this.currentSlot = slot;
        this.slotTimestamps.set(slot, Date.now());
      }
      
      // Update block height
      if (blockHeight > this.currentBlockHeight) {
        this.currentBlockHeight = blockHeight;
      }
      
      // Check for gaps
      if (this.lastProcessedSlot > 0n && slot > this.lastProcessedSlot + 1n) {
        const gap: SlotGap = {
          startSlot: this.lastProcessedSlot + 1n,
          endSlot: slot - 1n,
          duration: blockTime - (this.getBlockTime(this.lastProcessedSlot) || blockTime),
          missedSlots: Number(slot - this.lastProcessedSlot - 1n),
          reason: parentSlot !== this.lastProcessedSlot ? 'fork' : 'leader_skip'
        };
        
        this.slotGaps.push(gap);
        await this.storeSlotGap(gap);
        
        this.logger.warn('Slot gap detected', {
          startSlot: gap.startSlot.toString(),
          endSlot: gap.endSlot.toString(),
          missedSlots: gap.missedSlots
        });
      }
      
      // Create block info
      const blockInfo: BlockInfo = {
        slot,
        blockHeight,
        blockTime,
        parentSlot,
        status,
        transactionCount: 0,
        successfulTransactions: 0,
        failedTransactions: 0,
        feeRewards: 0n,
        leader: '',
        hash: ''
      };
      
      this.blocks.set(slot, blockInfo);
      this.lastProcessedSlot = slot;
      
      // Update status tracking
      if (status === 'finalized' && slot > this.lastFinalizedSlot) {
        this.lastFinalizedSlot = slot;
      }
      if (status === 'confirmed' && slot > this.lastConfirmedSlot) {
        this.lastConfirmedSlot = slot;
      }
      
      // Store in database
      await this.storeBlockInfo(blockInfo);
      
    } catch (error) {
      this.logger.error('Error handling slot update', error as Error);
    }
  }

  /**
   * Handle stream data for transaction counts
   */
  private async handleStreamData(data: any): Promise<void> {
    try {
      if (!data.slot) return;
      
      const slot = BigInt(data.slot);
      const blockInfo = this.blocks.get(slot);
      
      if (blockInfo) {
        blockInfo.transactionCount++;
        
        const meta = data.transaction?.meta || data.meta;
        if (meta?.err === null) {
          blockInfo.successfulTransactions++;
        } else {
          blockInfo.failedTransactions++;
        }
        
        // Extract fee if available
        if (meta?.fee) {
          blockInfo.feeRewards += BigInt(meta.fee);
        }
      }
    } catch (error) {
      // Silent error to avoid spam
    }
  }

  /**
   * Handle block finalized event
   */
  private async handleBlockFinalized(event: any): Promise<void> {
    try {
      const slot = BigInt(event.slot);
      const blockInfo = this.blocks.get(slot);
      
      if (blockInfo) {
        blockInfo.status = 'finalized';
        blockInfo.hash = event.hash || '';
        blockInfo.leader = event.leader || '';
        
        await this.updateBlockStatus(slot, 'finalized', event.hash, event.leader);
      }
      
      if (slot > this.lastFinalizedSlot) {
        this.lastFinalizedSlot = slot;
      }
    } catch (error) {
      this.logger.error('Error handling block finalized', error as Error);
    }
  }

  /**
   * Handle fork detection
   */
  private async handleForkDetected(event: any): Promise<void> {
    try {
      const { slot, parentSlot, forkPoint } = event;
      
      this.logger.warn('Fork detected', {
        slot: slot.toString(),
        parentSlot: parentSlot.toString(),
        forkPoint: forkPoint.toString()
      });
      
      // Mark affected slots
      await db.query(`
        UPDATE slot_progression 
        SET fork_detected = true 
        WHERE slot >= $1 AND slot <= $2
      `, [forkPoint.toString(), slot.toString()]);
      
      // Emit fork alert
      this.eventBus.emit('chain:fork_alert', {
        detectedAt: new Date(),
        affectedSlots: [forkPoint, slot],
        severity: 'high'
      });
    } catch (error) {
      this.logger.error('Error handling fork', error as Error);
    }
  }

  /**
   * Check for slot gaps
   */
  private async checkSlotGaps(): Promise<void> {
    try {
      // Check recent slots for gaps
      const slots = Array.from(this.blocks.keys()).sort((a, b) => 
        a < b ? -1 : a > b ? 1 : 0
      ).slice(-100);
      
      for (let i = 1; i < slots.length; i++) {
        const prevSlot = slots[i - 1];
        const currSlot = slots[i];
        
        if (currSlot > prevSlot + 1n) {
          const gap: SlotGap = {
            startSlot: prevSlot + 1n,
            endSlot: currSlot - 1n,
            duration: 0,
            missedSlots: Number(currSlot - prevSlot - 1n),
            reason: 'network_issue'
          };
          
          // Check if we already tracked this gap
          const exists = this.slotGaps.some(g => 
            g.startSlot === gap.startSlot && g.endSlot === gap.endSlot
          );
          
          if (!exists) {
            this.slotGaps.push(gap);
            await this.storeSlotGap(gap);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error checking slot gaps', error as Error);
    }
  }

  /**
   * Update chain statistics
   */
  private async updateChainStats(): Promise<void> {
    try {
      const stats = await this.getChainStats();
      
      this.eventBus.emit('chain:stats_updated', stats);
      
      // Alert if slot success rate is low
      if (stats.slotSuccessRate < 0.95) {
        this.logger.warn('Low slot success rate', {
          rate: (stats.slotSuccessRate * 100).toFixed(2) + '%',
          missedSlots: stats.missedSlots
        });
      }
    } catch (error) {
      this.logger.error('Error updating chain stats', error as Error);
    }
  }

  /**
   * Store block info in database
   */
  private async storeBlockInfo(block: BlockInfo): Promise<void> {
    try {
      await db.query(`
        INSERT INTO slot_progression (
          slot, parent_slot, block_height, block_time, status,
          transaction_count, successful_txs, failed_txs, fee_rewards,
          leader, block_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (slot) DO UPDATE SET
          transaction_count = EXCLUDED.transaction_count,
          successful_txs = EXCLUDED.successful_txs,
          failed_txs = EXCLUDED.failed_txs,
          fee_rewards = EXCLUDED.fee_rewards,
          status = CASE 
            WHEN slot_progression.status = 'finalized' THEN slot_progression.status
            ELSE EXCLUDED.status
          END
      `, [
        block.slot.toString(),
        block.parentSlot.toString(),
        block.blockHeight.toString(),
        new Date(block.blockTime * 1000),
        block.status,
        block.transactionCount,
        block.successfulTransactions,
        block.failedTransactions,
        block.feeRewards.toString(),
        block.leader,
        block.hash
      ]);
    } catch (error) {
      this.logger.error('Error storing block info', error as Error);
    }
  }

  /**
   * Store slot gap in database
   */
  private async storeSlotGap(gap: SlotGap): Promise<void> {
    try {
      await db.query(`
        INSERT INTO slot_gaps (start_slot, end_slot, duration_seconds, missed_slots, reason)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        gap.startSlot.toString(),
        gap.endSlot.toString(),
        gap.duration,
        gap.missedSlots,
        gap.reason
      ]);
    } catch (error) {
      this.logger.error('Error storing slot gap', error as Error);
    }
  }

  /**
   * Update block status
   */
  private async updateBlockStatus(
    slot: bigint, 
    status: string, 
    hash?: string, 
    leader?: string
  ): Promise<void> {
    try {
      await db.query(`
        UPDATE slot_progression 
        SET status = $2, block_hash = $3, leader = $4
        WHERE slot = $1
      `, [slot.toString(), status, hash || '', leader || '']);
    } catch (error) {
      this.logger.error('Error updating block status', error as Error);
    }
  }

  /**
   * Load recent blocks from database
   */
  private async loadRecentBlocks(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT * FROM slot_progression 
        WHERE block_time > NOW() - INTERVAL '1 hour'
        ORDER BY slot DESC
        LIMIT 1000
      `);
      
      for (const row of result.rows) {
        const blockInfo: BlockInfo = {
          slot: BigInt(row.slot),
          blockHeight: BigInt(row.block_height || 0),
          blockTime: Math.floor(row.block_time.getTime() / 1000),
          parentSlot: BigInt(row.parent_slot || 0),
          status: row.status,
          transactionCount: row.transaction_count || 0,
          successfulTransactions: row.successful_txs || 0,
          failedTransactions: row.failed_txs || 0,
          feeRewards: BigInt(row.fee_rewards || 0),
          leader: row.leader || '',
          hash: row.block_hash || ''
        };
        
        this.blocks.set(blockInfo.slot, blockInfo);
        
        if (blockInfo.slot > this.currentSlot) {
          this.currentSlot = blockInfo.slot;
        }
        if (blockInfo.blockHeight > this.currentBlockHeight) {
          this.currentBlockHeight = blockInfo.blockHeight;
        }
      }
      
      // Set last processed slot
      if (this.blocks.size > 0) {
        const slots = Array.from(this.blocks.keys());
        this.lastProcessedSlot = slots.reduce((max, slot) => slot > max ? slot : max, 0n);
      }
    } catch (error) {
      this.logger.error('Error loading recent blocks', error as Error);
    }
  }

  /**
   * Get block time for a slot
   */
  private getBlockTime(slot: bigint): number | undefined {
    const block = this.blocks.get(slot);
    return block?.blockTime;
  }

  /**
   * Get chain statistics
   */
  async getChainStats(): Promise<ChainStats> {
    try {
      // Calculate average block time
      const recentBlocks = Array.from(this.blocks.values())
        .sort((a, b) => Number(b.slot - a.slot))
        .slice(0, 100);
      
      let totalBlockTime = 0;
      let blockTimeCount = 0;
      
      for (let i = 1; i < recentBlocks.length; i++) {
        const timeDiff = (recentBlocks[i - 1].blockTime - recentBlocks[i].blockTime) * 1000;
        if (timeDiff > 0 && timeDiff < 10000) { // Reasonable block time
          totalBlockTime += timeDiff;
          blockTimeCount++;
        }
      }
      
      const avgBlockTime = blockTimeCount > 0 ? totalBlockTime / blockTimeCount : 400;
      
      // Calculate average transactions per block
      const avgTransactionsPerBlock = recentBlocks.length > 0
        ? recentBlocks.reduce((sum, b) => sum + b.transactionCount, 0) / recentBlocks.length
        : 0;
      
      // Calculate slot success rate
      const totalSlots = this.blocks.size;
      const missedSlots = this.slotGaps.reduce((sum, gap) => sum + gap.missedSlots, 0);
      const slotSuccessRate = totalSlots > 0 
        ? (totalSlots - missedSlots) / (totalSlots + missedSlots)
        : 1;
      
      return {
        currentSlot: this.currentSlot,
        currentBlockHeight: this.currentBlockHeight,
        avgBlockTime,
        avgTransactionsPerBlock,
        slotGaps: this.slotGaps.slice(-10), // Last 10 gaps
        totalSlots,
        missedSlots,
        slotSuccessRate,
        lastFinalizedSlot: this.lastFinalizedSlot,
        lastConfirmedSlot: this.lastConfirmedSlot
      };
    } catch (error) {
      this.logger.error('Error getting chain stats', error as Error);
      return {
        currentSlot: this.currentSlot,
        currentBlockHeight: this.currentBlockHeight,
        avgBlockTime: 400,
        avgTransactionsPerBlock: 0,
        slotGaps: [],
        totalSlots: 0,
        missedSlots: 0,
        slotSuccessRate: 1,
        lastFinalizedSlot: this.lastFinalizedSlot,
        lastConfirmedSlot: this.lastConfirmedSlot
      };
    }
  }

  /**
   * Get recent blocks
   */
  getRecentBlocks(limit: number = 100): BlockInfo[] {
    return Array.from(this.blocks.values())
      .sort((a, b) => Number(b.slot - a.slot))
      .slice(0, limit);
  }

  /**
   * Get block by slot
   */
  getBlock(slot: bigint): BlockInfo | undefined {
    return this.blocks.get(slot);
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    // Clean up old blocks
    const blocksToRemove: bigint[] = [];
    for (const [slot, block] of this.blocks) {
      if (block.blockTime * 1000 < oneHourAgo) {
        blocksToRemove.push(slot);
      }
    }
    
    blocksToRemove.forEach(slot => this.blocks.delete(slot));
    
    // Clean up old slot timestamps
    const timestampsToRemove: bigint[] = [];
    for (const [slot, timestamp] of this.slotTimestamps) {
      if (timestamp < oneHourAgo) {
        timestampsToRemove.push(slot);
      }
    }
    
    timestampsToRemove.forEach(slot => this.slotTimestamps.delete(slot));
    
    // Keep only recent slot gaps
    if (this.slotGaps.length > 100) {
      this.slotGaps = this.slotGaps.slice(-100);
    }
    
    this.logger.debug('Cleaned up old data', {
      blocksRemoved: blocksToRemove.length,
      timestampsRemoved: timestampsToRemove.length
    });
  }
}