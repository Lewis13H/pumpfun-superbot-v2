/**
 * State Recovery Service
 * Handles checkpoint persistence and recovery after failures or restarts
 */

import { Logger } from '../../core/logger';
import { EventBus } from '../../core/event-bus';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StateCheckpoint } from './fault-tolerant-manager';

export interface RecoveryConfig {
  checkpointDir: string;
  maxCheckpoints: number;
  compressionEnabled: boolean;
}

export interface RecoveryData {
  checkpoint: StateCheckpoint;
  missedSlots: bigint[];
  pendingSubscriptions: Map<string, string[]>;
}

export class StateRecoveryService {
  private logger: Logger;
  private checkpointPath: string;
  private isRecovering = false;
  
  constructor(
    private eventBus: EventBus,
    private config: RecoveryConfig
  ) {
    this.logger = new Logger({ context: 'StateRecoveryService' });
    this.checkpointPath = path.join(config.checkpointDir, 'checkpoints');
    // Don't wait for async operation in constructor
    this.ensureCheckpointDirectory().catch(err => 
      this.logger.error('Failed to create checkpoint directory', err)
    );
  }
  
  /**
   * Ensure checkpoint directory exists
   */
  private async ensureCheckpointDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.checkpointPath, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create checkpoint directory', error as Error);
    }
  }
  
  /**
   * Save checkpoint to disk
   */
  public async saveCheckpoint(checkpoint: StateCheckpoint): Promise<void> {
    try {
      const filename = `checkpoint_${checkpoint.timestamp.getTime()}.json`;
      const filepath = path.join(this.checkpointPath, filename);
      
      // Convert Maps to serializable format
      const serializable = {
        ...checkpoint,
        connectionStates: Array.from(checkpoint.connectionStates.entries()),
        lastProcessedSlots: Array.from(checkpoint.lastProcessedSlots.entries()).map(([k, v]) => [k, v.toString()]),
        activeSubscriptions: Array.from(checkpoint.activeSubscriptions.entries())
      };
      
      const data = JSON.stringify(serializable, null, 2);
      
      if (this.config.compressionEnabled) {
        // In production, we'd compress the data
        // For now, just save as-is
      }
      
      await fs.writeFile(filepath, data, 'utf-8');
      
      // Clean up old checkpoints
      await this.cleanupOldCheckpoints();
      
      this.logger.debug('Checkpoint saved', { filename });
      
    } catch (error) {
      this.logger.error('Failed to save checkpoint', error as Error);
      this.eventBus.emit('recovery:checkpoint-failed', {
        error: (error as Error).message,
        timestamp: checkpoint.timestamp
      });
    }
  }
  
  /**
   * Load latest checkpoint from disk
   */
  public async loadLatestCheckpoint(): Promise<StateCheckpoint | null> {
    try {
      const files = await fs.readdir(this.checkpointPath);
      const checkpointFiles = files
        .filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Sort descending (newest first)
      
      if (checkpointFiles.length === 0) {
        this.logger.info('No checkpoints found');
        return null;
      }
      
      const latestFile = checkpointFiles[0];
      const filepath = path.join(this.checkpointPath, latestFile);
      const data = await fs.readFile(filepath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Convert back to Maps
      const checkpoint: StateCheckpoint = {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
        connectionStates: new Map(parsed.connectionStates),
        lastProcessedSlots: new Map(parsed.lastProcessedSlots.map(([k, v]: [string, string]) => [k, BigInt(v)])),
        activeSubscriptions: new Map(parsed.activeSubscriptions)
      };
      
      this.logger.info('Checkpoint loaded', {
        filename: latestFile,
        timestamp: checkpoint.timestamp,
        connections: checkpoint.connectionStates.size
      });
      
      return checkpoint;
      
    } catch (error) {
      this.logger.error('Failed to load checkpoint', error as Error);
      return null;
    }
  }
  
  /**
   * Perform recovery from checkpoint
   */
  public async performRecovery(): Promise<RecoveryData | null> {
    if (this.isRecovering) {
      this.logger.warn('Recovery already in progress');
      return null;
    }
    
    this.isRecovering = true;
    this.logger.info('Starting recovery process');
    
    try {
      // 1. Load latest checkpoint
      const checkpoint = await this.loadLatestCheckpoint();
      if (!checkpoint) {
        this.logger.info('No checkpoint to recover from');
        return null;
      }
      
      // 2. Calculate missed slots since checkpoint
      const currentSlot = await this.getCurrentSlot();
      const missedSlots: bigint[] = [];
      
      for (const [connectionId, lastSlot] of checkpoint.lastProcessedSlots) {
        if (currentSlot > lastSlot) {
          // Track slots we need to catch up on
          for (let slot = lastSlot + 1n; slot <= currentSlot && missedSlots.length < 1000; slot++) {
            missedSlots.push(slot);
          }
        }
      }
      
      // 3. Identify subscriptions that need to be restored
      const pendingSubscriptions = new Map(checkpoint.activeSubscriptions);
      
      // 4. Create recovery data
      const recoveryData: RecoveryData = {
        checkpoint,
        missedSlots,
        pendingSubscriptions
      };
      
      // 5. Emit recovery events
      this.eventBus.emit('recovery:started', {
        checkpointTime: checkpoint.timestamp,
        missedSlots: missedSlots.length,
        subscriptions: Array.from(pendingSubscriptions.values()).flat().length
      });
      
      // 6. Restore connection states
      for (const [connectionId, health] of checkpoint.connectionStates) {
        this.eventBus.emit('recovery:connection-state', {
          connectionId,
          state: health.circuitState,
          parseRate: health.parseRate,
          failures: health.failures
        });
      }
      
      // 7. Request replay of missed data if needed
      if (missedSlots.length > 0) {
        this.logger.info(`Requesting replay of ${missedSlots.length} missed slots`);
        this.eventBus.emit('recovery:replay-needed', {
          slots: missedSlots,
          connections: Array.from(checkpoint.lastProcessedSlots.keys())
        });
      }
      
      this.logger.info('Recovery completed successfully', {
        checkpointAge: Date.now() - checkpoint.timestamp.getTime(),
        missedSlots: missedSlots.length,
        restoredConnections: checkpoint.connectionStates.size
      });
      
      this.eventBus.emit('recovery:completed', {
        checkpoint: checkpoint.timestamp,
        recoveredConnections: checkpoint.connectionStates.size,
        missedSlots: missedSlots.length
      });
      
      return recoveryData;
      
    } catch (error) {
      this.logger.error('Recovery failed', error as Error);
      this.eventBus.emit('recovery:failed', {
        error: (error as Error).message
      });
      return null;
      
    } finally {
      this.isRecovering = false;
    }
  }
  
  /**
   * Clean up old checkpoints
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    try {
      const files = await fs.readdir(this.checkpointPath);
      const checkpointFiles = files
        .filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Sort descending (newest first)
      
      // Keep only the configured number of checkpoints
      if (checkpointFiles.length > this.config.maxCheckpoints) {
        const toDelete = checkpointFiles.slice(this.config.maxCheckpoints);
        
        for (const file of toDelete) {
          const filepath = path.join(this.checkpointPath, file);
          await fs.unlink(filepath);
          this.logger.debug('Deleted old checkpoint', { file });
        }
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old checkpoints', error as Error);
    }
  }
  
  /**
   * Get current slot from blockchain (mock implementation)
   */
  private async getCurrentSlot(): Promise<bigint> {
    // In production, this would query the actual blockchain
    // For now, return a mock value based on timestamp
    return BigInt(Math.floor(Date.now() / 400)); // ~400ms per slot
  }
  
  /**
   * Export checkpoint for debugging/analysis
   */
  public async exportCheckpoint(checkpoint: StateCheckpoint, filepath: string): Promise<void> {
    try {
      const data = {
        exported_at: new Date().toISOString(),
        checkpoint: {
          timestamp: checkpoint.timestamp.toISOString(),
          connections: Array.from(checkpoint.connectionStates.entries()).map(([id, health]) => ({
            id,
            state: health.circuitState,
            failures: health.failures,
            parseRate: health.parseRate,
            latency: health.latency,
            lastFailure: health.lastFailure?.toISOString(),
            lastSuccess: health.lastSuccess?.toISOString()
          })),
          lastProcessedSlots: Array.from(checkpoint.lastProcessedSlots.entries()).map(([k, v]) => ({
            connection: k,
            slot: v.toString()
          })),
          activeSubscriptions: Array.from(checkpoint.activeSubscriptions.entries()).map(([k, v]) => ({
            connection: k,
            subscriptions: v
          })),
          metrics: checkpoint.metrics
        }
      };
      
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
      this.logger.info('Checkpoint exported', { filepath });
      
    } catch (error) {
      this.logger.error('Failed to export checkpoint', error as Error);
      throw error;
    }
  }
  
  /**
   * Get recovery statistics
   */
  public async getRecoveryStats(): Promise<{
    checkpointCount: number;
    latestCheckpoint: Date | null;
    oldestCheckpoint: Date | null;
    totalSize: number;
  }> {
    try {
      const files = await fs.readdir(this.checkpointPath);
      const checkpointFiles = files
        .filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'))
        .sort((a, b) => a.localeCompare(b)); // Sort ascending
      
      if (checkpointFiles.length === 0) {
        return {
          checkpointCount: 0,
          latestCheckpoint: null,
          oldestCheckpoint: null,
          totalSize: 0
        };
      }
      
      // Extract timestamps from filenames
      const timestamps = checkpointFiles.map(f => {
        const match = f.match(/checkpoint_(\d+)\.json/);
        return match ? parseInt(match[1]) : 0;
      }).filter(t => t > 0);
      
      // Calculate total size
      let totalSize = 0;
      for (const file of checkpointFiles) {
        const stats = await fs.stat(path.join(this.checkpointPath, file));
        totalSize += stats.size;
      }
      
      return {
        checkpointCount: checkpointFiles.length,
        latestCheckpoint: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
        oldestCheckpoint: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
        totalSize
      };
      
    } catch (error) {
      this.logger.error('Failed to get recovery stats', error as Error);
      return {
        checkpointCount: 0,
        latestCheckpoint: null,
        oldestCheckpoint: null,
        totalSize: 0
      };
    }
  }
}