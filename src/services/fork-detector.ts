/**
 * Fork Detector Service
 * Detects and handles blockchain forks
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { db } from '../database';

export interface ForkEvent {
  detectedAt: Date;
  forkPoint: bigint;
  orphanedBranch: {
    startSlot: bigint;
    endSlot: bigint;
    slots: bigint[];
  };
  canonicalBranch: {
    startSlot: bigint;
    endSlot: bigint;
    slots: bigint[];
  };
  affectedTransactions: string[];
  severity: 'minor' | 'major' | 'critical';
  resolved: boolean;
}

export interface SlotRelationship {
  slot: bigint;
  parentSlot: bigint;
  blockHeight: bigint;
  blockHash: string;
  status: 'processed' | 'confirmed' | 'finalized';
  isOrphaned: boolean;
}

export interface ForkStatistics {
  totalForks: number;
  minorForks: number;
  majorForks: number;
  criticalForks: number;
  avgOrphanedSlots: number;
  maxOrphanedSlots: number;
  lastForkDetected?: Date;
  affectedTransactionsTotal: number;
}

export class ForkDetector {
  private static instance: ForkDetector;
  private logger: Logger;
  private eventBus: EventBus;
  
  private slotRelationships: Map<bigint, SlotRelationship> = new Map();
  private detectedForks: ForkEvent[] = [];
  private orphanedTransactions: Map<string, bigint> = new Map(); // tx -> slot
  
  // Fork detection parameters
  private readonly MINOR_FORK_THRESHOLD = 5;    // <= 5 slots
  private readonly MAJOR_FORK_THRESHOLD = 20;   // 6-20 slots

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'ForkDetector' });
    this.eventBus = eventBus;
    
    this.setupEventListeners();
    this.startPeriodicTasks();
  }

  static async create(eventBus: EventBus): Promise<ForkDetector> {
    if (!ForkDetector.instance) {
      ForkDetector.instance = new ForkDetector(eventBus);
      await ForkDetector.instance.initialize();
    }
    return ForkDetector.instance;
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    await this.createTables();
    await this.loadRecentSlots();
    
    this.logger.info('Fork detector initialized', {
      trackedSlots: this.slotRelationships.size
    });
  }

  /**
   * Create required database tables
   */
  private async createTables(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS fork_events (
          id SERIAL PRIMARY KEY,
          fork_point BIGINT NOT NULL,
          orphaned_start_slot BIGINT NOT NULL,
          orphaned_end_slot BIGINT NOT NULL,
          orphaned_slot_count INTEGER NOT NULL,
          canonical_start_slot BIGINT NOT NULL,
          canonical_end_slot BIGINT NOT NULL,
          affected_transactions INTEGER DEFAULT 0,
          severity VARCHAR(10) NOT NULL,
          resolved BOOLEAN DEFAULT FALSE,
          detected_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_fork_point ON fork_events(fork_point);
        CREATE INDEX IF NOT EXISTS idx_fork_severity ON fork_events(severity);
        
        CREATE TABLE IF NOT EXISTS orphaned_slots (
          slot BIGINT PRIMARY KEY,
          parent_slot BIGINT,
          block_hash VARCHAR(88),
          fork_event_id INTEGER REFERENCES fork_events(id),
          orphaned_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS orphaned_transactions (
          signature VARCHAR(88) PRIMARY KEY,
          slot BIGINT NOT NULL,
          user_address VARCHAR(64),
          program VARCHAR(64),
          transaction_type VARCHAR(20),
          fork_event_id INTEGER REFERENCES fork_events(id),
          reprocessed BOOLEAN DEFAULT FALSE,
          orphaned_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_orphaned_tx_slot ON orphaned_transactions(slot);
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
    
    // Listen for block finalization
    this.eventBus.on('block:finalized', this.handleBlockFinalized.bind(this));
    
    // Listen for transaction data
    this.eventBus.on('transaction:processed', this.trackTransaction.bind(this));
  }

  /**
   * Start periodic tasks
   */
  private startPeriodicTasks(): void {
    // Check for forks every 5 seconds
    setInterval(() => this.checkForForks(), 5000);
    
    // Validate slot chain every 30 seconds
    setInterval(() => this.validateSlotChain(), 30000);
    
    // Clean up old data every hour
    setInterval(() => this.cleanupOldData(), 3600000);
  }

  /**
   * Handle slot update
   */
  private async handleSlotUpdate(event: any): Promise<void> {
    try {
      const slot = BigInt(event.slot || 0);
      const parentSlot = event.parentSlot ? BigInt(event.parentSlot) : slot - 1n;
      const blockHeight = event.blockHeight ? BigInt(event.blockHeight) : 0n;
      const blockHash = event.blockHash || '';
      const status = event.status || 'processed';
      
      // Check for fork
      const existingRelationship = this.slotRelationships.get(slot);
      if (existingRelationship && existingRelationship.parentSlot !== parentSlot) {
        // Fork detected!
        await this.detectFork(slot, parentSlot, existingRelationship.parentSlot);
      }
      
      // Store relationship
      const relationship: SlotRelationship = {
        slot,
        parentSlot,
        blockHeight,
        blockHash,
        status,
        isOrphaned: false
      };
      
      this.slotRelationships.set(slot, relationship);
      
      // Clean up old relationships
      if (this.slotRelationships.size > 10000) {
        const slots = Array.from(this.slotRelationships.keys()).sort((a, b) => 
          a < b ? -1 : a > b ? 1 : 0
        );
        const toRemove = slots.slice(0, slots.length - 10000);
        toRemove.forEach(s => this.slotRelationships.delete(s));
      }
    } catch (error) {
      this.logger.error('Error handling slot update', error as Error);
    }
  }

  /**
   * Handle block finalized
   */
  private async handleBlockFinalized(event: any): Promise<void> {
    try {
      const slot = BigInt(event.slot || 0);
      const relationship = this.slotRelationships.get(slot);
      
      if (relationship) {
        relationship.status = 'finalized';
        relationship.blockHash = event.blockHash || relationship.blockHash;
      }
      
      // Check if this finalization orphans any slots
      await this.checkOrphanedSlots(slot);
    } catch (error) {
      this.logger.error('Error handling block finalized', error as Error);
    }
  }

  /**
   * Track transaction for fork handling
   */
  private trackTransaction(event: any): void {
    try {
      const signature = event.signature;
      const slot = BigInt(event.slot || 0);
      
      if (signature && slot) {
        // Keep track of recent transactions
        this.orphanedTransactions.set(signature, slot);
        
        // Clean up old transactions
        if (this.orphanedTransactions.size > 100000) {
          const entries = Array.from(this.orphanedTransactions.entries());
          const toRemove = entries.slice(0, entries.length - 100000);
          toRemove.forEach(([sig, _]) => this.orphanedTransactions.delete(sig));
        }
      }
    } catch (error) {
      // Silent error
    }
  }

  /**
   * Detect fork
   */
  private async detectFork(
    slot: bigint, 
    newParent: bigint, 
    oldParent: bigint
  ): Promise<void> {
    try {
      this.logger.warn('Fork detected!', {
        slot: slot.toString(),
        newParent: newParent.toString(),
        oldParent: oldParent.toString()
      });
      
      // Find fork point
      const forkPoint = await this.findForkPoint(newParent, oldParent);
      
      // Identify orphaned branch
      const orphanedSlots = await this.identifyOrphanedSlots(oldParent, forkPoint);
      const canonicalSlots = await this.identifyCanonicalSlots(newParent, forkPoint);
      
      // Find affected transactions
      const affectedTransactions = this.findAffectedTransactions(orphanedSlots);
      
      // Determine severity
      const orphanedCount = orphanedSlots.length;
      let severity: 'minor' | 'major' | 'critical';
      if (orphanedCount <= this.MINOR_FORK_THRESHOLD) {
        severity = 'minor';
      } else if (orphanedCount <= this.MAJOR_FORK_THRESHOLD) {
        severity = 'major';
      } else {
        severity = 'critical';
      }
      
      // Create fork event
      const forkEvent: ForkEvent = {
        detectedAt: new Date(),
        forkPoint,
        orphanedBranch: {
          startSlot: orphanedSlots[0] || forkPoint,
          endSlot: orphanedSlots[orphanedSlots.length - 1] || forkPoint,
          slots: orphanedSlots
        },
        canonicalBranch: {
          startSlot: canonicalSlots[0] || forkPoint,
          endSlot: canonicalSlots[canonicalSlots.length - 1] || slot,
          slots: canonicalSlots
        },
        affectedTransactions,
        severity,
        resolved: false
      };
      
      this.detectedForks.push(forkEvent);
      
      // Store in database
      await this.storeForkEvent(forkEvent);
      
      // Mark slots as orphaned
      for (const orphanedSlot of orphanedSlots) {
        const relationship = this.slotRelationships.get(orphanedSlot);
        if (relationship) {
          relationship.isOrphaned = true;
        }
      }
      
      // Emit fork event
      this.eventBus.emit('fork:detected', {
        slot: slot.toString(),
        parentSlot: newParent.toString(),
        forkPoint: forkPoint.toString(),
        orphanedSlots: orphanedSlots.length,
        severity
      });
      
      // Handle based on severity
      if (severity === 'critical') {
        this.logger.error('Critical fork detected!', {
          orphanedSlots: orphanedCount,
          affectedTransactions: affectedTransactions.length
        });
        
        this.eventBus.emit('fork:critical', forkEvent);
      }
    } catch (error) {
      this.logger.error('Error detecting fork', error as Error);
    }
  }

  /**
   * Find fork point
   */
  private async findForkPoint(branch1: bigint, branch2: bigint): Promise<bigint> {
    const ancestors1 = await this.getAncestors(branch1, 100);
    const ancestors2 = await this.getAncestors(branch2, 100);
    
    // Find common ancestor
    for (const slot1 of ancestors1) {
      if (ancestors2.includes(slot1)) {
        return slot1;
      }
    }
    
    // If no common ancestor found in recent history, return lower of the two
    return branch1 < branch2 ? branch1 : branch2;
  }

  /**
   * Get ancestors of a slot
   */
  private async getAncestors(slot: bigint, maxDepth: number): Promise<bigint[]> {
    const ancestors: bigint[] = [];
    let currentSlot = slot;
    
    for (let i = 0; i < maxDepth; i++) {
      const relationship = this.slotRelationships.get(currentSlot);
      if (!relationship) break;
      
      ancestors.push(currentSlot);
      currentSlot = relationship.parentSlot;
      
      if (currentSlot === 0n) break;
    }
    
    return ancestors;
  }

  /**
   * Identify orphaned slots
   */
  private async identifyOrphanedSlots(
    branchTip: bigint, 
    forkPoint: bigint
  ): Promise<bigint[]> {
    const orphaned: bigint[] = [];
    let currentSlot = branchTip;
    
    while (currentSlot > forkPoint) {
      orphaned.push(currentSlot);
      
      const relationship = this.slotRelationships.get(currentSlot);
      if (!relationship) break;
      
      currentSlot = relationship.parentSlot;
    }
    
    return orphaned.reverse();
  }

  /**
   * Identify canonical slots
   */
  private async identifyCanonicalSlots(
    branchTip: bigint, 
    forkPoint: bigint
  ): Promise<bigint[]> {
    const canonical: bigint[] = [];
    let currentSlot = branchTip;
    
    while (currentSlot > forkPoint) {
      canonical.push(currentSlot);
      
      const relationship = this.slotRelationships.get(currentSlot);
      if (!relationship) break;
      
      currentSlot = relationship.parentSlot;
    }
    
    return canonical.reverse();
  }

  /**
   * Find affected transactions
   */
  private findAffectedTransactions(orphanedSlots: bigint[]): string[] {
    const affected: string[] = [];
    
    for (const [signature, slot] of this.orphanedTransactions) {
      if (orphanedSlots.includes(slot)) {
        affected.push(signature);
      }
    }
    
    return affected;
  }

  /**
   * Check for forks periodically
   */
  private async checkForForks(): Promise<void> {
    try {
      // Get recent slots
      const recentSlots = Array.from(this.slotRelationships.entries())
        .sort((a, b) => Number(b[0] - a[0]))
        .slice(0, 100);
      
      // Check for parent mismatches
      for (const [slot, relationship] of recentSlots) {
        if (relationship.parentSlot === 0n) continue;
        
        const parent = this.slotRelationships.get(relationship.parentSlot);
        if (parent && !this.isValidParentChild(parent, relationship)) {
          await this.detectFork(slot, relationship.parentSlot, parent.slot);
        }
      }
    } catch (error) {
      this.logger.error('Error checking for forks', error as Error);
    }
  }

  /**
   * Validate slot chain
   */
  private async validateSlotChain(): Promise<void> {
    try {
      const slots = Array.from(this.slotRelationships.keys()).sort((a, b) => 
        a < b ? -1 : a > b ? 1 : 0
      );
      
      let brokenChains = 0;
      
      for (let i = 1; i < slots.length; i++) {
        const currentSlot = slots[i];
        const relationship = this.slotRelationships.get(currentSlot)!;
        
        // Check if parent exists
        if (!this.slotRelationships.has(relationship.parentSlot) && 
            relationship.parentSlot !== currentSlot - 1n) {
          brokenChains++;
        }
      }
      
      if (brokenChains > 0) {
        this.logger.warn('Broken slot chains detected', {
          count: brokenChains
        });
      }
    } catch (error) {
      this.logger.error('Error validating slot chain', error as Error);
    }
  }

  /**
   * Check if slots have orphaned children
   */
  private async checkOrphanedSlots(finalizedSlot: bigint): Promise<void> {
    try {
      // Find slots that should be orphaned
      const slotsToCheck = Array.from(this.slotRelationships.entries())
        .filter(([slot, rel]) => 
          slot > finalizedSlot - 1000n && // Recent slots
          slot < finalizedSlot &&
          rel.status !== 'finalized'
        );
      
      for (const [slot, relationship] of slotsToCheck) {
        // Check if this slot's chain leads to finalized slot
        const leadsToFinalized = await this.checkChainToFinalized(slot, finalizedSlot);
        
        if (!leadsToFinalized) {
          relationship.isOrphaned = true;
          this.logger.debug('Orphaned slot detected', {
            slot: slot.toString()
          });
        }
      }
    } catch (error) {
      this.logger.error('Error checking orphaned slots', error as Error);
    }
  }

  /**
   * Check if slot chain leads to finalized slot
   */
  private async checkChainToFinalized(
    slot: bigint, 
    finalizedSlot: bigint
  ): Promise<boolean> {
    let currentSlot = slot;
    const maxDepth = 1000;
    
    for (let i = 0; i < maxDepth; i++) {
      if (currentSlot === finalizedSlot) {
        return true;
      }
      
      if (currentSlot > finalizedSlot) {
        return false; // Slot is ahead of finalized
      }
      
      const relationship = this.slotRelationships.get(currentSlot);
      if (!relationship) {
        return false; // Chain broken
      }
      
      currentSlot = relationship.parentSlot;
    }
    
    return false;
  }

  /**
   * Check if parent-child relationship is valid
   */
  private isValidParentChild(
    parent: SlotRelationship, 
    child: SlotRelationship
  ): boolean {
    return parent.slot === child.parentSlot;
  }

  /**
   * Store fork event in database
   */
  private async storeForkEvent(forkEvent: ForkEvent): Promise<void> {
    try {
      const result = await db.query(`
        INSERT INTO fork_events (
          fork_point, orphaned_start_slot, orphaned_end_slot,
          orphaned_slot_count, canonical_start_slot, canonical_end_slot,
          affected_transactions, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        forkEvent.forkPoint.toString(),
        forkEvent.orphanedBranch.startSlot.toString(),
        forkEvent.orphanedBranch.endSlot.toString(),
        forkEvent.orphanedBranch.slots.length,
        forkEvent.canonicalBranch.startSlot.toString(),
        forkEvent.canonicalBranch.endSlot.toString(),
        forkEvent.affectedTransactions.length,
        forkEvent.severity
      ]);
      
      const forkId = result.rows[0].id;
      
      // Store orphaned slots
      for (const slot of forkEvent.orphanedBranch.slots) {
        const relationship = this.slotRelationships.get(slot);
        await db.query(`
          INSERT INTO orphaned_slots (slot, parent_slot, block_hash, fork_event_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (slot) DO NOTHING
        `, [
          slot.toString(),
          relationship?.parentSlot.toString() || null,
          relationship?.blockHash || null,
          forkId
        ]);
      }
      
      // Store affected transactions
      for (const tx of forkEvent.affectedTransactions) {
        await db.query(`
          INSERT INTO orphaned_transactions (signature, slot, fork_event_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (signature) DO NOTHING
        `, [
          tx,
          this.orphanedTransactions.get(tx)?.toString() || '0',
          forkId
        ]);
      }
    } catch (error) {
      this.logger.error('Error storing fork event', error as Error);
    }
  }

  /**
   * Load recent slots from database
   */
  private async loadRecentSlots(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT slot, parent_slot, block_height, block_hash, status
        FROM slot_progression
        WHERE block_time > NOW() - INTERVAL '30 minutes'
        ORDER BY slot DESC
        LIMIT 5000
      `);
      
      for (const row of result.rows) {
        const relationship: SlotRelationship = {
          slot: BigInt(row.slot),
          parentSlot: BigInt(row.parent_slot || 0),
          blockHeight: BigInt(row.block_height || 0),
          blockHash: row.block_hash || '',
          status: row.status,
          isOrphaned: false
        };
        
        this.slotRelationships.set(relationship.slot, relationship);
      }
    } catch (error) {
      this.logger.error('Error loading recent slots', error as Error);
    }
  }

  /**
   * Get fork statistics
   */
  async getForkStats(): Promise<ForkStatistics> {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_forks,
          COUNT(*) FILTER (WHERE severity = 'minor') as minor_forks,
          COUNT(*) FILTER (WHERE severity = 'major') as major_forks,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical_forks,
          AVG(orphaned_slot_count) as avg_orphaned_slots,
          MAX(orphaned_slot_count) as max_orphaned_slots,
          MAX(detected_at) as last_fork_detected,
          SUM(affected_transactions) as affected_transactions_total
        FROM fork_events
      `);
      
      const stats = result.rows[0];
      
      return {
        totalForks: parseInt(stats.total_forks) || 0,
        minorForks: parseInt(stats.minor_forks) || 0,
        majorForks: parseInt(stats.major_forks) || 0,
        criticalForks: parseInt(stats.critical_forks) || 0,
        avgOrphanedSlots: parseFloat(stats.avg_orphaned_slots) || 0,
        maxOrphanedSlots: parseInt(stats.max_orphaned_slots) || 0,
        lastForkDetected: stats.last_fork_detected,
        affectedTransactionsTotal: parseInt(stats.affected_transactions_total) || 0
      };
    } catch (error) {
      this.logger.error('Error getting fork stats', error as Error);
      return {
        totalForks: 0,
        minorForks: 0,
        majorForks: 0,
        criticalForks: 0,
        avgOrphanedSlots: 0,
        maxOrphanedSlots: 0,
        affectedTransactionsTotal: 0
      };
    }
  }

  /**
   * Get recent forks
   */
  getRecentForks(limit: number = 10): ForkEvent[] {
    return this.detectedForks.slice(-limit);
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    // Keep only recent forks
    if (this.detectedForks.length > 100) {
      this.detectedForks = this.detectedForks.slice(-100);
    }
    
    this.logger.debug('Cleaned up old fork data', {
      remainingSlots: this.slotRelationships.size,
      remainingForks: this.detectedForks.length
    });
  }
}