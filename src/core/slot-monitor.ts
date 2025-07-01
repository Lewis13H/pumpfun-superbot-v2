/**
 * Slot Monitor
 * Tracks slot progression and detects forks
 */

import { EventEmitter } from 'events';
import { Logger } from './logger';
import { EventBus } from './event-bus';

export interface SlotInfo {
  slot: bigint;
  parentSlot?: bigint;
  blockHeight?: bigint;
  blockTime?: number;
  status: 'processed' | 'confirmed' | 'finalized';
}

export interface ForkInfo {
  detected: boolean;
  forkPoint?: bigint;
  orphanedSlots?: bigint[];
  currentBranch: bigint;
  previousBranch: bigint;
}

export interface SlotStats {
  currentSlot: bigint;
  latestFinalizedSlot: bigint;
  slotsProcessed: number;
  forksDetected: number;
  averageSlotTime: number;
  slotLag: number;
}

export class SlotMonitor extends EventEmitter {
  private logger: Logger;
  private eventBus: EventBus;
  private slotHistory: Map<string, SlotInfo> = new Map();
  private currentSlot: SlotInfo | null = null;
  private finalizedSlot: SlotInfo | null = null;
  private stats: SlotStats;
  private slotTimes: number[] = [];
  private maxHistorySize = 1000;

  constructor(eventBus: EventBus) {
    super();
    this.logger = new Logger({ context: 'SlotMonitor' });
    this.eventBus = eventBus;
    
    this.stats = {
      currentSlot: BigInt(0),
      latestFinalizedSlot: BigInt(0),
      slotsProcessed: 0,
      forksDetected: 0,
      averageSlotTime: 400, // Default 400ms
      slotLag: 0
    };

    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for slot updates from gRPC stream
    this.eventBus.on('slot:update', this.handleSlotUpdate.bind(this));
    this.eventBus.on('slot:finalized', this.handleSlotFinalized.bind(this));
  }

  /**
   * Handle slot update
   */
  private handleSlotUpdate(slotInfo: SlotInfo): void {
    try {
      const previousSlot = this.currentSlot;
      
      // Check for fork
      if (previousSlot && slotInfo.parentSlot) {
        const forkInfo = this.detectFork(slotInfo, previousSlot);
        if (forkInfo.detected) {
          this.handleFork(forkInfo);
        }
      }

      // Update current slot
      this.currentSlot = slotInfo;
      this.stats.currentSlot = slotInfo.slot;
      this.stats.slotsProcessed++;

      // Store in history
      this.slotHistory.set(slotInfo.slot.toString(), slotInfo);
      this.pruneHistory();

      // Calculate slot time
      if (previousSlot && slotInfo.blockTime && previousSlot.blockTime) {
        const slotTime = (slotInfo.blockTime - previousSlot.blockTime) * 1000;
        this.updateSlotTime(slotTime);
      }

      // Calculate lag
      this.updateSlotLag();

      // Emit events
      this.emit('slot:new', slotInfo);
      this.eventBus.emit('slot:processed', {
        slot: slotInfo.slot,
        status: slotInfo.status,
        lag: this.stats.slotLag
      });

      this.logger.debug('Slot updated', {
        slot: slotInfo.slot.toString(),
        parent: slotInfo.parentSlot?.toString(),
        status: slotInfo.status
      });

    } catch (error) {
      this.logger.error('Failed to handle slot update', error as Error);
    }
  }

  /**
   * Handle finalized slot
   */
  private handleSlotFinalized(slot: bigint): void {
    this.finalizedSlot = this.slotHistory.get(slot.toString()) || {
      slot,
      status: 'finalized'
    };
    
    this.stats.latestFinalizedSlot = slot;
    
    this.emit('slot:finalized', this.finalizedSlot);
    this.logger.debug('Slot finalized', { slot: slot.toString() });
  }

  /**
   * Detect fork in slot progression
   */
  private detectFork(newSlot: SlotInfo, previousSlot: SlotInfo): ForkInfo {
    if (!newSlot.parentSlot) {
      return { detected: false, currentBranch: newSlot.slot, previousBranch: previousSlot.slot };
    }

    // Check if new slot's parent is the previous slot
    if (newSlot.parentSlot !== previousSlot.slot) {
      // Fork detected
      const forkPoint = this.findCommonAncestor(newSlot, previousSlot);
      const orphanedSlots = this.getOrphanedSlots(previousSlot, newSlot.parentSlot);

      return {
        detected: true,
        forkPoint,
        orphanedSlots,
        currentBranch: newSlot.slot,
        previousBranch: previousSlot.slot
      };
    }

    return { 
      detected: false, 
      currentBranch: newSlot.slot, 
      previousBranch: previousSlot.slot 
    };
  }

  /**
   * Find common ancestor between two slots
   */
  private findCommonAncestor(slot1: SlotInfo, slot2: SlotInfo): bigint | undefined {
    const ancestors1 = this.getAncestors(slot1);
    const ancestors2 = this.getAncestors(slot2);

    // Find first common ancestor
    for (const ancestor of ancestors1) {
      if (ancestors2.includes(ancestor)) {
        return ancestor;
      }
    }

    return undefined;
  }

  /**
   * Get ancestors of a slot
   */
  private getAncestors(slot: SlotInfo): bigint[] {
    const ancestors: bigint[] = [];
    let current: SlotInfo | undefined = slot;

    while (current && current.parentSlot) {
      ancestors.push(current.parentSlot);
      current = this.slotHistory.get(current.parentSlot.toString());
    }

    return ancestors;
  }

  /**
   * Get orphaned slots between two points
   */
  private getOrphanedSlots(fromSlot: SlotInfo, toSlot: bigint): bigint[] {
    const orphaned: bigint[] = [];
    let current: SlotInfo | undefined = fromSlot;

    while (current && current.slot > toSlot) {
      orphaned.push(current.slot);
      if (current.parentSlot) {
        current = this.slotHistory.get(current.parentSlot.toString());
      } else {
        break;
      }
    }

    return orphaned;
  }

  /**
   * Handle fork detection
   */
  private handleFork(forkInfo: ForkInfo): void {
    this.stats.forksDetected++;
    
    this.logger.warn('Fork detected', {
      forkPoint: forkInfo.forkPoint?.toString(),
      orphanedSlots: forkInfo.orphanedSlots?.length,
      currentBranch: forkInfo.currentBranch.toString(),
      previousBranch: forkInfo.previousBranch.toString()
    });

    // Emit fork event
    this.emit('fork:detected', forkInfo);
    this.eventBus.emit('blockchain:fork', {
      forkInfo,
      timestamp: Date.now()
    });

    // Mark orphaned slots
    if (forkInfo.orphanedSlots) {
      for (const orphanedSlot of forkInfo.orphanedSlots) {
        const slotInfo = this.slotHistory.get(orphanedSlot.toString());
        if (slotInfo) {
          slotInfo.status = 'processed'; // Downgrade status
          this.eventBus.emit('slot:orphaned', { slot: orphanedSlot });
        }
      }
    }
  }

  /**
   * Update average slot time
   */
  private updateSlotTime(slotTime: number): void {
    this.slotTimes.push(slotTime);
    
    // Keep last 100 slot times
    if (this.slotTimes.length > 100) {
      this.slotTimes.shift();
    }

    // Calculate average
    const sum = this.slotTimes.reduce((a, b) => a + b, 0);
    this.stats.averageSlotTime = Math.round(sum / this.slotTimes.length);
  }

  /**
   * Update slot lag
   */
  private updateSlotLag(): void {
    // Estimate current network slot based on time
    const timeSinceLastSlot = Date.now() - (this.currentSlot?.blockTime || 0) * 1000;
    const estimatedSlotsSince = Math.floor(timeSinceLastSlot / this.stats.averageSlotTime);
    
    this.stats.slotLag = Math.max(0, estimatedSlotsSince);
  }

  /**
   * Prune old slot history
   */
  private pruneHistory(): void {
    if (this.slotHistory.size > this.maxHistorySize) {
      const slots = Array.from(this.slotHistory.keys())
        .map(s => BigInt(s))
        .sort((a, b) => Number(a - b));
      
      const toRemove = slots.slice(0, slots.length - this.maxHistorySize);
      for (const slot of toRemove) {
        this.slotHistory.delete(slot.toString());
      }
    }
  }

  /**
   * Get current slot info
   */
  getCurrentSlot(): SlotInfo | null {
    return this.currentSlot;
  }

  /**
   * Get finalized slot info
   */
  getFinalizedSlot(): SlotInfo | null {
    return this.finalizedSlot;
  }

  /**
   * Get slot statistics
   */
  getStats(): SlotStats {
    return { ...this.stats };
  }

  /**
   * Get slot by number
   */
  getSlot(slot: bigint): SlotInfo | undefined {
    return this.slotHistory.get(slot.toString());
  }

  /**
   * Check if slot is finalized
   */
  isSlotFinalized(slot: bigint): boolean {
    return this.finalizedSlot ? slot <= this.finalizedSlot.slot : false;
  }

  /**
   * Get slot confirmation status
   */
  getSlotStatus(slot: bigint): 'processed' | 'confirmed' | 'finalized' | 'unknown' {
    const slotInfo = this.slotHistory.get(slot.toString());
    return slotInfo?.status || 'unknown';
  }

  /**
   * Reset monitor state
   */
  reset(): void {
    this.slotHistory.clear();
    this.currentSlot = null;
    this.finalizedSlot = null;
    this.slotTimes = [];
    this.stats = {
      currentSlot: BigInt(0),
      latestFinalizedSlot: BigInt(0),
      slotsProcessed: 0,
      forksDetected: 0,
      averageSlotTime: 400,
      slotLag: 0
    };
    
    this.logger.info('Slot monitor reset');
  }

  /**
   * Subscribe to slot updates from a specific slot
   */
  async subscribeFromSlot(slot: bigint): Promise<void> {
    this.logger.info('Subscribing from slot', { slot: slot.toString() });
    
    // Emit event to request subscription from specific slot
    this.eventBus.emit('slot:subscribe', {
      fromSlot: slot.toString(),
      commitment: 'confirmed'
    });
  }
}