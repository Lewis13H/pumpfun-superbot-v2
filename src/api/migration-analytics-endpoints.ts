/**
 * Migration Analytics API Endpoints
 * Provides analytics for token lifecycle and migrations
 */

import { Router, Request, Response } from 'express';
import { Container } from '../core/container';
import { Logger } from '../core/logger';
import { TokenLifecycleService } from '../services/token-management/token-lifecycle-service';
import { MigrationTracker } from '../services/token-management/migration-tracker';
import { db } from '../database';

export function createMigrationAnalyticsRouter(container: Container): Router {
  const router = Router();
  const logger = new Logger({ context: 'MigrationAnalyticsAPI' });
  
  let lifecycleService: TokenLifecycleService;
  let migrationTracker: MigrationTracker;

  // Initialize services
  (async () => {
    lifecycleService = await TokenLifecycleService.create(container);
    migrationTracker = await MigrationTracker.create(container);
  })();

  /**
   * Get overall lifecycle statistics
   */
  router.get('/lifecycle/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await lifecycleService.getLifecycleStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error getting lifecycle stats', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get lifecycle statistics'
      });
    }
  });

  /**
   * Get migration statistics
   */
  router.get('/migrations/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await migrationTracker.getMigrationStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error getting migration stats', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get migration statistics'
      });
    }
  });

  /**
   * Get token lifecycle by mint address
   */
  router.get('/lifecycle/:mint', async (req: Request, res: Response) => {
    try {
      const { mint } = req.params;
      const lifecycle = lifecycleService.getTokenLifecycle(mint);
      
      if (!lifecycle) {
        return res.status(404).json({
          success: false,
          error: 'Token lifecycle not found'
        });
      }

      return res.json({
        success: true,
        data: lifecycle
      });
    } catch (error) {
      logger.error('Error getting token lifecycle', error as Error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get token lifecycle'
      });
    }
  });

  /**
   * Get recent graduations
   */
  router.get('/graduations/recent', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await db.query(`
        SELECT 
          t.mint_address,
          t.symbol,
          t.name,
          t.creator,
          t.created_at,
          t.graduation_at,
          t.graduation_slot,
          t.first_price_sol,
          t.first_market_cap_usd,
          t.latest_market_cap_usd,
          EXTRACT(EPOCH FROM (t.graduation_at - t.created_at))/3600 as hours_to_graduation,
          COUNT(tr.id) as total_trades,
          COUNT(DISTINCT tr.user_address) as unique_traders
        FROM tokens_unified t
        LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
        WHERE t.graduated_to_amm = true
        GROUP BY t.mint_address
        ORDER BY t.graduation_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      res.json({
        success: true,
        data: {
          graduations: result.rows,
          total: result.rowCount,
          limit,
          offset
        }
      });
    } catch (error) {
      logger.error('Error getting recent graduations', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recent graduations'
      });
    }
  });

  /**
   * Get top creators by graduation rate
   */
  router.get('/creators/top', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const minTokens = parseInt(req.query.minTokens as string) || 5;

      const result = await db.query(`
        SELECT 
          ca.creator_address,
          ca.tokens_created,
          ca.tokens_graduated,
          ca.tokens_rugged,
          ca.graduation_rate,
          ca.avg_market_cap,
          ca.first_seen,
          ca.last_seen,
          COALESCE(
            (SELECT symbol FROM tokens_unified WHERE creator = ca.creator_address AND graduated_to_amm = true ORDER BY graduation_at DESC LIMIT 1),
            'Unknown'
          ) as latest_graduated_token
        FROM creator_analysis ca
        WHERE ca.tokens_created >= $1
        ORDER BY ca.graduation_rate DESC, ca.tokens_graduated DESC
        LIMIT $2
      `, [minTokens, limit]);

      res.json({
        success: true,
        data: {
          creators: result.rows,
          total: result.rowCount
        }
      });
    } catch (error) {
      logger.error('Error getting top creators', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get top creators'
      });
    }
  });

  /**
   * Get token creation timeline
   */
  router.get('/timeline/creations', async (req: Request, res: Response) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const interval = req.query.interval || 'hour'; // hour, day

      const result = await db.query(`
        SELECT 
          DATE_TRUNC($1, created_at) as time_bucket,
          COUNT(*) as tokens_created,
          COUNT(*) FILTER (WHERE graduated_to_amm = true) as tokens_graduated,
          AVG(first_market_cap_usd) as avg_initial_market_cap
        FROM tokens_unified
        WHERE created_at > NOW() - INTERVAL '${hours} hours'
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `, [interval]);

      res.json({
        success: true,
        data: {
          timeline: result.rows,
          hours,
          interval
        }
      });
    } catch (error) {
      logger.error('Error getting creation timeline', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get creation timeline'
      });
    }
  });

  /**
   * Get migration flow analysis
   */
  router.get('/migrations/flow', async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT 
          DATE_TRUNC('day', created_at) as day,
          COUNT(*) as tokens_created,
          COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_to_amm,
          COUNT(*) FILTER (WHERE current_program = 'bonding_curve' AND created_at < NOW() - INTERVAL '24 hours') as still_bonding,
          COUNT(*) FILTER (WHERE graduated_to_amm = true AND graduation_at - created_at < INTERVAL '1 hour') as quick_graduations,
          COUNT(*) FILTER (WHERE graduated_to_amm = true AND graduation_at - created_at > INTERVAL '24 hours') as slow_graduations
        FROM tokens_unified
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day DESC
      `);

      const flowData = result.rows.map((row: any) => ({
        date: row.day,
        created: parseInt(row.tokens_created),
        graduated: parseInt(row.graduated_to_amm),
        active: parseInt(row.still_bonding),
        quickGraduations: parseInt(row.quick_graduations),
        slowGraduations: parseInt(row.slow_graduations),
        graduationRate: row.tokens_created > 0 
          ? (parseInt(row.graduated_to_amm) / parseInt(row.tokens_created) * 100).toFixed(1) 
          : '0.0'
      }));

      res.json({
        success: true,
        data: {
          flow: flowData,
          summary: {
            totalDays: flowData.length,
            avgDailyCreations: flowData.reduce((sum: number, d: any) => sum + d.created, 0) / flowData.length,
            avgDailyGraduations: flowData.reduce((sum: number, d: any) => sum + d.graduated, 0) / flowData.length,
            overallGraduationRate: flowData.reduce((sum: number, d: any) => sum + parseFloat(d.graduationRate), 0) / flowData.length
          }
        }
      });
    } catch (error) {
      logger.error('Error getting migration flow', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get migration flow analysis'
      });
    }
  });

  /**
   * Get abandoned tokens analysis
   */
  router.get('/abandoned/analysis', async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_abandoned,
          AVG(total_trades) as avg_trades,
          AVG(peak_market_cap) as avg_peak_market_cap,
          COUNT(DISTINCT creator_address) as unique_creators,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (abandoned_at - created_at))/3600) as median_hours_to_abandon
        FROM token_lifecycle
        WHERE lifecycle_status = 'abandoned'
        AND created_at > NOW() - INTERVAL '30 days'
      `);

      const creatorResult = await db.query(`
        SELECT 
          creator_address,
          COUNT(*) as abandoned_count
        FROM token_lifecycle
        WHERE lifecycle_status = 'abandoned'
        AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY creator_address
        ORDER BY abandoned_count DESC
        LIMIT 10
      `);

      res.json({
        success: true,
        data: {
          summary: result.rows[0],
          topAbandoningCreators: creatorResult.rows
        }
      });
    } catch (error) {
      logger.error('Error getting abandoned analysis', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get abandoned tokens analysis'
      });
    }
  });

  /**
   * Get real-time migration events
   */
  router.get('/migrations/realtime', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;

      const result = await db.query(`
        SELECT 
          tl.mint_address,
          tl.lifecycle_status as status,
          tl.migration_started_at,
          tl.pool_address,
          t.symbol,
          t.name,
          t.latest_market_cap_usd,
          CASE 
            WHEN tl.lifecycle_status = 'graduating' THEN 'in_progress'
            WHEN tl.lifecycle_status = 'graduated' THEN 'completed'
            ELSE 'pending'
          END as migration_status
        FROM token_lifecycle tl
        JOIN tokens_unified t ON tl.mint_address = t.mint_address
        WHERE tl.migration_started_at IS NOT NULL
        ORDER BY 
          CASE WHEN tl.lifecycle_status = 'graduating' THEN 0 ELSE 1 END,
          tl.migration_started_at DESC
        LIMIT $1
      `, [limit]);

      res.json({
        success: true,
        data: {
          migrations: result.rows,
          total: result.rowCount
        }
      });
    } catch (error) {
      logger.error('Error getting realtime migrations', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get real-time migrations'
      });
    }
  });

  return router;
}