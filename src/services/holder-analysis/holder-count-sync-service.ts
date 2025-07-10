/**
 * Holder Count Sync Service
 * 
 * Automatically syncs holder counts from holder_snapshots to tokens_unified
 * whenever a new snapshot is created or updated
 */

import { Pool } from 'pg';
import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger';
import chalk from 'chalk';

const logger = createLogger('HolderCountSyncService');

export class HolderCountSyncService extends EventEmitter {
  private static instance: HolderCountSyncService;
  
  constructor(private pool: Pool) {
    super();
  }
  
  static getInstance(pool: Pool): HolderCountSyncService {
    if (!HolderCountSyncService.instance) {
      HolderCountSyncService.instance = new HolderCountSyncService(pool);
    }
    return HolderCountSyncService.instance;
  }
  
  /**
   * Sync holder count for a specific token
   */
  async syncTokenHolderCount(mintAddress: string): Promise<boolean> {
    try {
      // Get the latest snapshot for this token
      const snapshotResult = await this.pool.query(`
        SELECT 
          total_holders,
          holder_score,
          snapshot_time
        FROM holder_snapshots
        WHERE mint_address = $1
        ORDER BY snapshot_time DESC
        LIMIT 1
      `, [mintAddress]);
      
      if (snapshotResult.rows.length === 0) {
        logger.debug(`No snapshot found for ${mintAddress}`);
        return false;
      }
      
      const snapshot = snapshotResult.rows[0];
      
      // Update tokens_unified
      const updateResult = await this.pool.query(`
        UPDATE tokens_unified
        SET 
          holder_count = $2,
          holder_score = $3,
          holder_analysis_updated_at = $4,
          updated_at = NOW()
        WHERE mint_address = $1
          AND (
            holder_count IS NULL 
            OR holder_count != $2
            OR holder_score IS NULL
            OR holder_score != $3
          )
        RETURNING mint_address, symbol, holder_count, holder_score
      `, [
        mintAddress,
        snapshot.total_holders,
        snapshot.holder_score,
        snapshot.snapshot_time
      ]);
      
      if (updateResult.rows.length > 0) {
        const token = updateResult.rows[0];
        logger.info(
          `Synced holder count for ${token.symbol || 'Unknown'} (${mintAddress.slice(0, 8)}...): ` +
          `${token.holder_count} holders, score: ${token.holder_score}`
        );
        
        this.emit('holder_count_synced', {
          mintAddress,
          symbol: token.symbol,
          holderCount: token.holder_count,
          holderScore: token.holder_score
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`Error syncing holder count for ${mintAddress}:`, error);
      return false;
    }
  }
  
  /**
   * Sync all tokens that have outdated holder counts
   */
  async syncAllOutdatedTokens(): Promise<number> {
    try {
      logger.info('Starting bulk holder count sync...');
      
      const result = await this.pool.query(`
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (mint_address)
            mint_address,
            total_holders,
            holder_score,
            snapshot_time
          FROM holder_snapshots
          ORDER BY mint_address, snapshot_time DESC
        )
        UPDATE tokens_unified tu
        SET 
          holder_count = ls.total_holders,
          holder_score = ls.holder_score,
          holder_analysis_updated_at = ls.snapshot_time,
          updated_at = NOW()
        FROM latest_snapshots ls
        WHERE tu.mint_address = ls.mint_address
          AND (
            tu.holder_count IS NULL 
            OR tu.holder_count != ls.total_holders
            OR tu.holder_score IS NULL
            OR tu.holder_score != ls.holder_score
            OR tu.holder_analysis_updated_at IS NULL
            OR tu.holder_analysis_updated_at < ls.snapshot_time
          )
        RETURNING tu.mint_address
      `);
      
      const syncedCount = result.rowCount || 0;
      
      if (syncedCount > 0) {
        logger.info(`Successfully synced ${syncedCount} tokens with updated holder counts`);
        
        this.emit('bulk_sync_completed', {
          syncedCount,
          mintAddresses: result.rows.map(r => r.mint_address)
        });
      }
      
      return syncedCount;
    } catch (error) {
      logger.error('Error in bulk holder count sync:', error);
      return 0;
    }
  }
  
  /**
   * Set up automatic syncing on snapshot creation
   * This should be called after holder analysis completes
   */
  setupAutoSync(holderAnalysisService: any): void {
    // Listen for analysis completion events
    holderAnalysisService.on('analysis_complete', async (data: any) => {
      if (data.mintAddress) {
        await this.syncTokenHolderCount(data.mintAddress);
      }
    });
    
    logger.info('Auto-sync enabled for holder count updates');
  }
  
  /**
   * Get sync statistics
   */
  async getSyncStats(): Promise<{
    totalTokens: number;
    tokensWithHolderCount: number;
    tokensWithHolderScore: number;
    tokensWithAnalysis: number;
    outOfSyncTokens: number;
  }> {
    try {
      const result = await this.pool.query(`
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (mint_address)
            mint_address,
            total_holders,
            holder_score,
            snapshot_time
          FROM holder_snapshots
          ORDER BY mint_address, snapshot_time DESC
        )
        SELECT 
          COUNT(DISTINCT tu.mint_address) as total_tokens,
          COUNT(DISTINCT tu.mint_address) FILTER (WHERE tu.holder_count > 0) as with_holder_count,
          COUNT(DISTINCT tu.mint_address) FILTER (WHERE tu.holder_score > 0) as with_holder_score,
          COUNT(DISTINCT ls.mint_address) as with_analysis,
          COUNT(DISTINCT ls.mint_address) FILTER (
            WHERE tu.holder_count IS NULL 
            OR tu.holder_count != ls.total_holders
            OR tu.holder_score IS NULL
            OR tu.holder_score != ls.holder_score
          ) as out_of_sync
        FROM tokens_unified tu
        LEFT JOIN latest_snapshots ls ON ls.mint_address = tu.mint_address
      `);
      
      const stats = result.rows[0];
      
      return {
        totalTokens: parseInt(stats.total_tokens),
        tokensWithHolderCount: parseInt(stats.with_holder_count),
        tokensWithHolderScore: parseInt(stats.with_holder_score),
        tokensWithAnalysis: parseInt(stats.with_analysis),
        outOfSyncTokens: parseInt(stats.out_of_sync)
      };
    } catch (error) {
      logger.error('Error getting sync stats:', error);
      throw error;
    }
  }
  
  /**
   * Ensure required columns exist
   */
  async ensureColumns(): Promise<void> {
    try {
      await this.pool.query(`
        ALTER TABLE tokens_unified 
        ADD COLUMN IF NOT EXISTS holder_score INTEGER,
        ADD COLUMN IF NOT EXISTS holder_analysis_updated_at TIMESTAMP WITH TIME ZONE
      `);
      logger.info('Ensured all required columns exist');
    } catch (error) {
      logger.warn('Error adding columns (they may already exist):', error);
    }
  }
}