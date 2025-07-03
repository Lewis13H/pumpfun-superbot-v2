/**
 * Failure Analytics API Endpoints
 * Provides insights into failed transactions, MEV activity, and network congestion
 */

import { Router, Request, Response } from 'express';
import { Container, TOKENS } from '../core/container';
import { FailedTransactionAnalyzer } from '../services/monitoring/failed-tx-analyzer';
import { MEVDetector } from '../services/analysis/mev-detector';
import { SlippageAnalyzer } from '../services/analysis/slippage-analyzer';
import { CongestionMonitor } from '../services/monitoring/congestion-monitor';
import { EventBus } from '../core/event-bus';
import { db } from '../database';

export function createFailureAnalyticsEndpoints(container: Container): Router {
  const router = Router();
  const eventBus = (container.resolve(TOKENS.EventBus) as unknown) as EventBus;
  
  // Initialize services
  const failedTxAnalyzer = FailedTransactionAnalyzer.getInstance(eventBus);
  const mevDetector = MEVDetector.getInstance(eventBus);
  const slippageAnalyzer = SlippageAnalyzer.getInstance(eventBus);
  const congestionMonitor = CongestionMonitor.getInstance(eventBus);

  /**
   * Get failed transaction statistics
   */
  router.get('/failed-transactions/stats', async (_req: Request, res: Response) => {
    try {
      const stats = failedTxAnalyzer.getFailureStats();
      const recentFailures = failedTxAnalyzer.getRecentFailures(10);
      
      res.json({
        success: true,
        data: {
          stats,
          recentFailures: recentFailures.map(f => ({
            signature: f.signature,
            mintAddress: f.mintAddress,
            failureReason: f.failureReason,
            intendedAction: f.intendedAction,
            mevSuspected: f.mevSuspected,
            blockTime: new Date(f.blockTime * 1000).toISOString()
          }))
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get failure statistics'
      });
    }
  });

  /**
   * Get failed transactions by reason
   */
  router.get('/failed-transactions/by-reason/:reason', async (req: Request, res: Response) => {
    try {
      const { reason } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const failures = failedTxAnalyzer.getRecentFailures(limit)
        .filter(f => f.failureReason === reason);
      
      res.json({
        success: true,
        data: {
          reason,
          count: failures.length,
          failures: failures.map(f => ({
            signature: f.signature,
            mintAddress: f.mintAddress,
            userAddress: f.userAddress,
            errorMessage: f.errorMessage,
            analysisMetadata: f.analysisMetadata,
            blockTime: new Date(f.blockTime * 1000).toISOString()
          }))
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get failures by reason'
      });
    }
  });

  /**
   * Get MEV statistics
   */
  router.get('/mev/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await mevDetector.getMEVStats();
      const suspiciousAddresses = mevDetector.getSuspiciousAddresses();
      
      res.json({
        success: true,
        data: {
          ...stats,
          suspiciousAddresses: suspiciousAddresses.slice(0, 10)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get MEV statistics'
      });
    }
  });

  /**
   * Get recent MEV events
   */
  router.get('/mev/recent', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const type = req.query.type as string;
      
      const result = await db.query(`
        SELECT * FROM mev_events 
        ${type ? 'WHERE mev_type = $1' : ''}
        ORDER BY block_time DESC 
        LIMIT ${type ? '$2' : '$1'}
      `, type ? [type, limit] : [limit]);
      
      res.json({
        success: true,
        data: {
          count: result.rows.length,
          events: result.rows.map((row: any) => ({
            victimTx: row.victim_tx,
            type: row.mev_type,
            attackerAddress: row.attacker_address,
            attackerTxs: row.attacker_txs,
            mintAddress: row.mint_address,
            confidence: row.confidence,
            evidence: row.evidence,
            profitEstimate: row.profit_estimate,
            blockTime: row.block_time
          }))
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get MEV events'
      });
    }
  });

  /**
   * Get slippage analysis
   */
  router.get('/slippage/stats', async (_req: Request, res: Response) => {
    try {
      const stats = slippageAnalyzer.getSlippageStats();
      const topVolatile = slippageAnalyzer.getTopVolatileTokens(5);
      
      res.json({
        success: true,
        data: {
          ...stats,
          topVolatileTokens: topVolatile.map(t => ({
            mintAddress: t.mintAddress,
            avgSlippage: t.pattern.avgSlippage,
            maxSlippage: t.pattern.maxSlippage,
            volatilityScore: t.pattern.volatilityScore,
            recommendedSlippage: t.pattern.recommendedSlippage
          }))
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get slippage statistics'
      });
    }
  });

  /**
   * Get slippage recommendation for a token
   */
  router.get('/slippage/recommendation/:mint', async (req: Request, res: Response) => {
    try {
      const { mint } = req.params;
      const recommendation = slippageAnalyzer.getSlippageRecommendation(mint);
      const pattern = slippageAnalyzer.getTokenSlippagePattern(mint);
      
      res.json({
        success: true,
        data: {
          mintAddress: mint,
          recommendedSlippage: recommendation,
          pattern: pattern ? {
            avgSlippage: pattern.avgSlippage,
            maxSlippage: pattern.maxSlippage,
            volatilityScore: pattern.volatilityScore,
            failureCount: pattern.failureCount,
            timeWindow: pattern.timeWindow
          } : null
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get slippage recommendation'
      });
    }
  });

  /**
   * Get high slippage events
   */
  router.get('/slippage/high-events', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const highSlippageEvents = slippageAnalyzer.getHighSlippageEvents(limit);
      
      res.json({
        success: true,
        data: {
          count: highSlippageEvents.length,
          events: highSlippageEvents.map(e => ({
            signature: e.signature,
            mintAddress: e.mintAddress,
            slippagePercent: e.slippagePercent,
            expectedPrice: e.expectedPrice,
            actualPrice: e.actualPrice,
            likelyMEV: e.likelyMEV,
            blockTime: new Date(e.blockTime * 1000).toISOString()
          }))
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get high slippage events'
      });
    }
  });

  /**
   * Get current congestion status
   */
  router.get('/congestion/status', async (_req: Request, res: Response) => {
    try {
      const status = congestionMonitor.getCurrentStatus();
      const recommendations = congestionMonitor.getRecommendations();
      
      res.json({
        success: true,
        data: {
          ...status,
          recommendations,
          avgFailureRatePercent: (status.avgFailureRate * 100).toFixed(2),
          congestionDurationMinutes: status.congestionDuration?.toFixed(1)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get congestion status'
      });
    }
  });

  /**
   * Get congestion statistics
   */
  router.get('/congestion/stats', async (_req: Request, res: Response) => {
    try {
      const stats = congestionMonitor.getCongestionStats();
      
      res.json({
        success: true,
        data: {
          ...stats,
          congestionRatePercent: stats.congestionRate.toFixed(2)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get congestion statistics'
      });
    }
  });

  /**
   * Get failure analysis summary
   */
  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const timeRange = req.query.timeRange as string || '1h';
      const timeRangeMs = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000
      }[timeRange] || 60 * 60 * 1000;
      
      const since = new Date(Date.now() - timeRangeMs);
      
      // Get database statistics
      const failureResult = await db.query(`
        SELECT 
          COUNT(*) as total_failures,
          COUNT(DISTINCT mint_address) as unique_tokens,
          COUNT(DISTINCT user_address) as unique_users,
          AVG(CASE WHEN mev_suspected THEN 1 ELSE 0 END) * 100 as mev_rate
        FROM failed_transactions
        WHERE block_time > $1
      `, [since]);
      
      const mevResult = await db.query(`
        SELECT 
          COUNT(*) as total_mev_events,
          COUNT(DISTINCT attacker_address) as unique_attackers,
          COUNT(DISTINCT mint_address) as targeted_tokens,
          AVG(profit_estimate) as avg_profit
        FROM mev_events
        WHERE block_time > $1
      `, [since]);
      
      // Get current service statistics
      const failureStats = failedTxAnalyzer.getFailureStats();
      const mevStats = await mevDetector.getMEVStats();
      const slippageStats = slippageAnalyzer.getSlippageStats();
      const congestionStatus = congestionMonitor.getCurrentStatus();
      
      res.json({
        success: true,
        data: {
          timeRange,
          database: {
            failures: failureResult.rows[0],
            mev: mevResult.rows[0]
          },
          current: {
            failures: failureStats,
            mev: mevStats,
            slippage: slippageStats,
            congestion: {
              level: congestionStatus.currentLevel,
              inCongestion: congestionStatus.inCongestion,
              avgFailureRate: (congestionStatus.avgFailureRate * 100).toFixed(2) + '%'
            }
          },
          insights: {
            mostCommonFailure: Object.entries(failureStats.byReason)
              .sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0],
            mevActive: mevStats.detectedPatterns > 0,
            highVolatility: slippageStats.avgSlippage > 5,
            networkCongested: congestionStatus.inCongestion
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get summary'
      });
    }
  });

  /**
   * Create required database tables
   */
  router.post('/init-tables', async (_req: Request, res: Response) => {
    try {
      // Create failed transactions table
      await db.query(`
        CREATE TABLE IF NOT EXISTS failed_transactions (
          signature VARCHAR(88) PRIMARY KEY,
          mint_address VARCHAR(64),
          user_address VARCHAR(64) NOT NULL,
          failure_reason VARCHAR(50) NOT NULL,
          error_message TEXT,
          intended_action VARCHAR(20),
          slot BIGINT NOT NULL,
          block_time TIMESTAMP NOT NULL,
          mev_suspected BOOLEAN DEFAULT FALSE,
          retry_signature VARCHAR(88),
          analysis_metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_failed_tx_mint ON failed_transactions(mint_address);
        CREATE INDEX IF NOT EXISTS idx_failed_tx_user ON failed_transactions(user_address);
        CREATE INDEX IF NOT EXISTS idx_failed_tx_reason ON failed_transactions(failure_reason);
        CREATE INDEX IF NOT EXISTS idx_failed_tx_time ON failed_transactions(block_time DESC);
      `);
      
      res.json({
        success: true,
        message: 'Tables created successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to create tables'
      });
    }
  });

  return router;
}