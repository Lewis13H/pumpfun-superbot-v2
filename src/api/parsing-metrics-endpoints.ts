/**
 * Parsing Metrics API Endpoints
 * 
 * Provides comprehensive parsing metrics for the streaming metrics dashboard
 * Part of Phase 4 of AMM Parsing Implementation
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { ParsingMetricsService } from '../services/monitoring/parsing-metrics-service';
import { PUMP_PROGRAM, PUMP_AMM_PROGRAM } from '../utils/config/constants';
import { createLogger } from '../core/logger';

const logger = createLogger('ParsingMetricsAPI');
const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

export function createParsingMetricsRouter(pool: Pool): Router {
  const router = Router();
  const metricsService = ParsingMetricsService.getInstance();

  /**
   * Get overview metrics
   */
  router.get('/api/parsing-metrics/overview', async (req: Request, res: Response) => {
    try {
      const overview = metricsService.getOverviewMetrics();
      
      // Get TPS from database
      const tpsResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM trades_unified
        WHERE created_at > NOW() - INTERVAL '1 minute'
      `);
      const tps = parseFloat((tpsResult.rows[0].count / 60).toFixed(2));

      // Get failed parse count for last 24h
      const failedResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM raw_transactions rt
        WHERE created_at > NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM trades_unified tu 
          WHERE tu.signature = rt.signature
        )
        AND NOT EXISTS (
          SELECT 1 FROM liquidity_events le 
          WHERE le.signature = rt.signature
        )
      `);

      res.json({
        success: true,
        data: {
          overall: {
            parseRate: overview.overallParseRate,
            totalTransactions: overview.totalTransactions,
            successfullyParsed: overview.successfullyParsed,
            avgParseTime: overview.avgParseTime,
            tps: tps,
            failedCount: failedResult.rows[0].count
          },
          byProgram: {
            'pump.fun': metricsService.getProgramMetrics(PUMP_PROGRAM),
            'pump.swap': metricsService.getProgramMetrics(PUMP_AMM_PROGRAM),
            'raydium': metricsService.getProgramMetrics(RAYDIUM_PROGRAM_ID)
          },
          recentFailures: metricsService.getRecentFailures(10)
        }
      });
    } catch (error) {
      logger.error('Failed to get overview metrics:', error);
      res.status(500).json({ success: false, error: 'Failed to get metrics' });
    }
  });

  /**
   * Get strategy metrics
   */
  router.get('/api/parsing-metrics/strategies', async (req: Request, res: Response) => {
    try {
      const strategies = metricsService.getStrategyMetrics();
      
      res.json({
        success: true,
        data: strategies.map(s => ({
          name: s.strategy,
          successRate: s.successRate,
          attempts: s.attempts,
          avgParseTime: s.avgParseTime,
          topErrors: s.topErrors
        }))
      });
    } catch (error) {
      logger.error('Failed to get strategy metrics:', error);
      res.status(500).json({ success: false, error: 'Failed to get metrics' });
    }
  });

  /**
   * Get data quality metrics
   */
  router.get('/api/parsing-metrics/data-quality', async (req: Request, res: Response) => {
    try {
      // AMM trades with reserves
      const reservesResult = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN virtual_sol_reserves > 0 THEN 1 END) as with_reserves
        FROM trades_unified
        WHERE venue = 'pump_amm'
        AND created_at > NOW() - INTERVAL '24 hours'
      `);

      const reservePercentage = reservesResult.rows[0].total > 0
        ? (reservesResult.rows[0].with_reserves / reservesResult.rows[0].total * 100)
        : 0;

      // Reserve data sources
      const sourcesResult = await pool.query(`
        SELECT 
          enrichment_source,
          COUNT(*) as count
        FROM trades_unified
        WHERE venue = 'pump_amm'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND enrichment_source IS NOT NULL
        GROUP BY enrichment_source
      `);

      const sources = sourcesResult.rows.reduce((acc, row) => {
        acc[row.enrichment_source] = parseInt(row.count);
        return acc;
      }, {});

      // Cross-venue correlation
      const correlationResult = await pool.query(`
        SELECT 
          t1.mint_address,
          COUNT(DISTINCT t1.venue) as venue_count,
          COUNT(*) as trade_count
        FROM trades_unified t1
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t1.mint_address
        HAVING COUNT(DISTINCT t1.venue) > 1
      `);

      const crossVenueTokens = correlationResult.rows.length;

      // Market cap accuracy (compare BC progress vs AMM market cap)
      const accuracyResult = await pool.query(`
        SELECT 
          AVG(ABS(bc.market_cap_sol - amm.market_cap_sol) / NULLIF(bc.market_cap_sol, 0)) as avg_deviation
        FROM (
          SELECT mint_address, AVG(market_cap_sol) as market_cap_sol
          FROM trades_unified
          WHERE venue = 'pump_bc'
          AND created_at > NOW() - INTERVAL '1 hour'
          GROUP BY mint_address
        ) bc
        JOIN (
          SELECT mint_address, AVG(market_cap_sol) as market_cap_sol
          FROM trades_unified
          WHERE venue = 'pump_amm'
          AND created_at > NOW() - INTERVAL '1 hour'
          GROUP BY mint_address
        ) amm ON bc.mint_address = amm.mint_address
      `);

      const marketCapAccuracy = accuracyResult.rows[0].avg_deviation
        ? (1 - parseFloat(accuracyResult.rows[0].avg_deviation)) * 100
        : 100;

      res.json({
        success: true,
        data: {
          ammTradesWithReserves: reservePercentage.toFixed(1),
          reserveDataSources: sources,
          crossVenueCorrelation: {
            tokensTrading: crossVenueTokens,
            correlationRate: crossVenueTokens > 0 ? 'Active' : 'None'
          },
          marketCapAccuracy: marketCapAccuracy.toFixed(1)
        }
      });
    } catch (error) {
      logger.error('Failed to get data quality metrics:', error);
      res.status(500).json({ success: false, error: 'Failed to get metrics' });
    }
  });

  /**
   * Get system metrics
   */
  router.get('/api/parsing-metrics/system', async (req: Request, res: Response) => {
    try {
      // Get queue depth from parsing metrics
      const queueStats = { depth: 0 }; // Queue stats not implemented yet

      // Get EventBus message rate
      const eventBusRate = 0; // EventBus rate not implemented yet

      // Get DB write rate
      const dbWriteResult = await pool.query(`
        SELECT COUNT(*) as writes
        FROM trades_unified
        WHERE created_at > NOW() - INTERVAL '1 minute'
      `);
      const dbWriteRate = parseFloat((dbWriteResult.rows[0].writes / 60).toFixed(2));

      res.json({
        success: true,
        data: {
          parseQueueDepth: queueStats.depth || 0,
          memoryUsage: process.memoryUsage(),
          eventBusMessagesPerSec: eventBusRate,
          dbWriteThroughput: dbWriteRate,
          uptime: process.uptime(),
          cpuUsage: process.cpuUsage()
        }
      });
    } catch (error) {
      logger.error('Failed to get system metrics:', error);
      res.status(500).json({ success: false, error: 'Failed to get metrics' });
    }
  });

  /**
   * Get alerts
   */
  router.get('/api/parsing-metrics/alerts', async (req: Request, res: Response) => {
    try {
      const alerts = [];

      // Check parse rate thresholds
      const overview = metricsService.getOverviewMetrics();
      if (overview.overallParseRate < 0.8) {
        alerts.push({
          level: 'warning',
          type: 'parse_rate',
          message: `Overall parse rate below 80% (${(overview.overallParseRate * 100).toFixed(1)}%)`,
          timestamp: new Date()
        });
      }

      // Check for specific program issues
      const pumpBcMetrics = metricsService.getProgramMetrics(PUMP_PROGRAM);
      if (pumpBcMetrics && pumpBcMetrics.parseRate < 0.9) {
        alerts.push({
          level: 'warning',
          type: 'program_parse_rate',
          message: `Pump BC parse rate below 90% (${(pumpBcMetrics.parseRate * 100).toFixed(1)}%)`,
          timestamp: new Date()
        });
      }

      const pumpAmmMetrics = metricsService.getProgramMetrics(PUMP_AMM_PROGRAM);
      if (pumpAmmMetrics && pumpAmmMetrics.parseRate < 0.85) {
        alerts.push({
          level: 'warning',
          type: 'program_parse_rate',
          message: `Pump AMM parse rate below 85% (${(pumpAmmMetrics.parseRate * 100).toFixed(1)}%)`,
          timestamp: new Date()
        });
      }

      // Check memory usage
      const memoryUsage = process.memoryUsage();
      const heapUsedPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      if (heapUsedPercentage > 80) {
        alerts.push({
          level: 'critical',
          type: 'memory_usage',
          message: `Heap usage above 80% (${heapUsedPercentage.toFixed(1)}%)`,
          timestamp: new Date()
        });
      }

      // Check recent failure spike
      const recentFailures = metricsService.getRecentFailures(60); // Last hour
      if (recentFailures.length > 100) {
        alerts.push({
          level: 'warning',
          type: 'failure_spike',
          message: `High failure rate detected: ${recentFailures.length} failures in last hour`,
          timestamp: new Date()
        });
      }

      res.json({
        success: true,
        data: alerts
      });
    } catch (error) {
      logger.error('Failed to get alerts:', error);
      res.status(500).json({ success: false, error: 'Failed to get alerts' });
    }
  });

  /**
   * Get historical metrics for charts
   */
  router.get('/api/parsing-metrics/history', async (req: Request, res: Response) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      
      const result = await pool.query(`
        SELECT 
          DATE_TRUNC('hour', created_at) as hour,
          venue,
          COUNT(*) as trades,
          AVG(CASE WHEN virtual_sol_reserves > 0 THEN 1 ELSE 0 END) * 100 as reserves_percentage
        FROM trades_unified
        WHERE created_at > NOW() - INTERVAL '${hours} hours'
        GROUP BY hour, venue
        ORDER BY hour DESC
      `);

      const history = result.rows.map(row => ({
        timestamp: row.hour,
        venue: row.venue,
        trades: parseInt(row.trades),
        reservesPercentage: parseFloat(row.reserves_percentage || 0)
      }));

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('Failed to get historical metrics:', error);
      res.status(500).json({ success: false, error: 'Failed to get metrics' });
    }
  });

  return router;
}

export default createParsingMetricsRouter;