/**
 * Performance Metrics API Endpoints
 * Provides comprehensive performance monitoring and system health APIs
 */

import { Router, Request, Response } from 'express';
import { Container } from '../core/container';
import { PerformanceMonitor } from '../services/performance-monitor';
import { AlertManager } from '../services/alert-manager';
import { CommitmentStrategy } from '../services/commitment-strategy';
import { MultiRegionManager } from '../services/multi-region-manager';
import { SlotRecoveryService } from '../services/slot-recovery';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'PerformanceMetricsAPI' });

// Helper function to calculate percentile
function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * percentile) - 1;
  return sorted[index] || 0;
}

export function createPerformanceMetricsEndpoints(container: Container): Router {
  const router = Router();
  
  // Get service instances
  const performanceMonitor = container.resolve('PerformanceMonitor') as unknown as PerformanceMonitor;
  const alertManager = container.resolve('AlertManager') as unknown as AlertManager;
  const commitmentStrategy = container.resolve('CommitmentStrategy') as unknown as CommitmentStrategy;
  const multiRegionManager = container.resolve('MultiRegionManager') as unknown as MultiRegionManager;
  const slotRecovery = container.resolve('SlotRecoveryService') as unknown as SlotRecoveryService;

  /**
   * Get current performance metrics
   */
  router.get('/metrics/current', async (_req: Request, res: Response) => {
    try {
      const metrics = performanceMonitor.getCurrentMetrics();
      const healthScore = performanceMonitor.getHealthScore();
      
      res.json({
        success: true,
        data: {
          metrics,
          healthScore,
          timestamp: new Date()
        }
      });
    } catch (error) {
      logger.error('Error getting current metrics', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get current metrics'
      });
    }
  });

  /**
   * Get performance report
   */
  router.get('/metrics/report', async (req: Request, res: Response) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const report = await performanceMonitor.generateReport(hours);
      
      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Error generating report', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report'
      });
    }
  });

  /**
   * Get system health overview
   */
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const healthScore = performanceMonitor.getHealthScore();
      const activeAlerts = alertManager.getActiveAlerts();
      const currentRegion = multiRegionManager.getCurrentRegion();
      const recommendations = performanceMonitor.getOptimizationRecommendations();
      
      const status = healthScore >= 80 ? 'healthy' : 
                    healthScore >= 60 ? 'degraded' : 'unhealthy';
      
      res.json({
        success: true,
        data: {
          status,
          healthScore,
          activeAlerts: activeAlerts.length,
          criticalAlerts: activeAlerts.filter(a => a.severity === 'critical').length,
          currentRegion: currentRegion?.name,
          regionHealth: currentRegion?.healthy,
          recommendations,
          timestamp: new Date()
        }
      });
    } catch (error) {
      logger.error('Error getting health status', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get health status'
      });
    }
  });

  /**
   * Get commitment strategy stats
   */
  router.get('/commitment/stats', async (_req: Request, res: Response) => {
    try {
      const stats = commitmentStrategy.getPerformanceStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error getting commitment stats', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get commitment stats'
      });
    }
  });

  /**
   * Get commitment recommendation
   */
  router.post('/commitment/recommend', async (req: Request, res: Response) => {
    try {
      const { type, operation, priority, retryable } = req.body;
      
      const context = {
        type: type || 'query',
        operation: operation || 'default',
        priority: priority || 'medium',
        retryable: retryable !== false
      };
      
      const recommendation = commitmentStrategy.getRecommendation(context);
      
      res.json({
        success: true,
        data: recommendation
      });
    } catch (error) {
      logger.error('Error getting commitment recommendation', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recommendation'
      });
    }
  });

  /**
   * Get region status
   */
  router.get('/regions/status', async (_req: Request, res: Response) => {
    try {
      const regions = multiRegionManager.getRegionsStatus();
      const currentRegion = multiRegionManager.getCurrentRegion();
      const failoverHistory = multiRegionManager.getFailoverHistory();
      
      res.json({
        success: true,
        data: {
          regions,
          currentRegion: currentRegion?.name,
          failoverHistory: failoverHistory.slice(-10), // Last 10 failovers
          timestamp: new Date()
        }
      });
    } catch (error) {
      logger.error('Error getting region status', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get region status'
      });
    }
  });

  /**
   * Get region statistics
   */
  router.get('/regions/stats/:region?', async (req: Request, res: Response) => {
    try {
      const regionName = req.params.region;
      const stats = multiRegionManager.getRegionStats(regionName);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error getting region stats', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get region stats'
      });
    }
  });

  /**
   * Manually switch region
   */
  router.post('/regions/switch', async (req: Request, res: Response) => {
    try {
      const { region } = req.body;
      
      if (!region) {
        res.status(400).json({
          success: false,
          error: 'Region name required'
        });
        return;
      }
      
      const success = await multiRegionManager.manualSwitchRegion(region);
      
      res.json({
        success,
        message: success ? 'Region switched successfully' : 'Failed to switch region'
      });
    } catch (error) {
      logger.error('Error switching region', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to switch region'
      });
    }
  });

  /**
   * Get active alerts
   */
  router.get('/alerts/active', async (_req: Request, res: Response) => {
    try {
      const alerts = alertManager.getActiveAlerts();
      
      res.json({
        success: true,
        data: {
          count: alerts.length,
          alerts,
          timestamp: new Date()
        }
      });
    } catch (error) {
      logger.error('Error getting active alerts', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get active alerts'
      });
    }
  });

  /**
   * Get alert history
   */
  router.get('/alerts/history', async (req: Request, res: Response) => {
    try {
      const { type, severity, startDate, endDate, limit } = req.query;
      
      const filters = {
        type: type as any,
        severity: severity as any,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? parseInt(limit as string) : 100
      };
      
      const history = await alertManager.getAlertHistory(filters);
      
      res.json({
        success: true,
        data: {
          count: history.length,
          alerts: history
        }
      });
    } catch (error) {
      logger.error('Error getting alert history', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get alert history'
      });
    }
  });

  /**
   * Get alert statistics
   */
  router.get('/alerts/stats', async (_req: Request, res: Response) => {
    try {
      const stats = alertManager.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error getting alert stats', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get alert stats'
      });
    }
  });

  /**
   * Acknowledge alert
   */
  router.post('/alerts/:alertId/acknowledge', async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params;
      const { acknowledgedBy } = req.body;
      
      if (!acknowledgedBy) {
        res.status(400).json({
          success: false,
          error: 'acknowledgedBy required'
        });
        return;
      }
      
      const success = await alertManager.acknowledgeAlert(alertId, acknowledgedBy);
      
      res.json({
        success,
        message: success ? 'Alert acknowledged' : 'Alert not found'
      });
    } catch (error) {
      logger.error('Error acknowledging alert', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to acknowledge alert'
      });
    }
  });

  /**
   * Resolve alert
   */
  router.post('/alerts/:alertId/resolve', async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params;
      const success = await alertManager.resolveAlert(alertId);
      
      res.json({
        success,
        message: success ? 'Alert resolved' : 'Alert not found'
      });
    } catch (error) {
      logger.error('Error resolving alert', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to resolve alert'
      });
    }
  });

  /**
   * Get recovery status
   */
  router.get('/recovery/status', async (_req: Request, res: Response) => {
    try {
      const activeRecoveries = slotRecovery.getActiveRecoveries();
      const stats = slotRecovery.getStats();
      
      res.json({
        success: true,
        data: {
          activeRecoveries: activeRecoveries.map(r => ({
            id: r.id,
            fromSlot: r.fromSlot.toString(),
            toSlot: r.toSlot?.toString(),
            status: r.status,
            progress: {
              ...r.progress,
              currentSlot: r.progress.currentSlot.toString(),
              percentComplete: r.progress.totalSlots > 0 ?
                (r.progress.processedSlots / r.progress.totalSlots * 100).toFixed(2) : 0
            }
          })),
          stats,
          timestamp: new Date()
        }
      });
    } catch (error) {
      logger.error('Error getting recovery status', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recovery status'
      });
    }
  });

  /**
   * Get recovery history
   */
  router.get('/recovery/history', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const history = await slotRecovery.getRecoveryHistory(limit);
      
      res.json({
        success: true,
        data: {
          count: history.length,
          recoveries: history.map(r => ({
            ...r,
            fromSlot: r.fromSlot.toString(),
            toSlot: r.toSlot?.toString(),
            progress: {
              ...r.progress,
              currentSlot: r.progress.currentSlot.toString()
            }
          }))
        }
      });
    } catch (error) {
      logger.error('Error getting recovery history', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recovery history'
      });
    }
  });

  /**
   * Request slot recovery
   */
  router.post('/recovery/request', async (req: Request, res: Response) => {
    try {
      const { fromSlot, toSlot, programs } = req.body;
      
      if (!fromSlot) {
        res.status(400).json({
          success: false,
          error: 'fromSlot required'
        });
        return;
      }
      
      const recovery = await slotRecovery.requestRecovery(
        BigInt(fromSlot),
        toSlot ? BigInt(toSlot) : undefined,
        programs
      );
      
      res.json({
        success: true,
        data: {
          id: recovery.id,
          status: recovery.status,
          message: 'Recovery requested successfully'
        }
      });
    } catch (error) {
      logger.error('Error requesting recovery', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to request recovery'
      });
    }
  });

  /**
   * Cancel recovery
   */
  router.post('/recovery/:recoveryId/cancel', async (req: Request, res: Response) => {
    try {
      const { recoveryId } = req.params;
      const success = await slotRecovery.cancelRecovery(recoveryId);
      
      res.json({
        success,
        message: success ? 'Recovery cancelled' : 'Recovery not found or already completed'
      });
    } catch (error) {
      logger.error('Error cancelling recovery', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel recovery'
      });
    }
  });

  /**
   * Get system summary
   */
  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      const healthScore = performanceMonitor.getHealthScore();
      const currentMetrics = performanceMonitor.getCurrentMetrics();
      const activeAlerts = alertManager.getActiveAlerts();
      const alertStats = alertManager.getStats();
      const currentRegion = multiRegionManager.getCurrentRegion();
      const activeRecoveries = slotRecovery.getActiveRecoveries();
      const recommendations = performanceMonitor.getOptimizationRecommendations();
      
      const summary = {
        health: {
          score: healthScore,
          status: healthScore >= 80 ? 'healthy' : 
                 healthScore >= 60 ? 'degraded' : 'unhealthy'
        },
        performance: {
          parseLatencyP95: currentMetrics.parseLatency.length > 0 ?
            calculatePercentile(currentMetrics.parseLatency, 0.95) : 0,
          streamLag: currentMetrics.streamLag,
          cpuUsage: currentMetrics.cpuUsage.toFixed(2) + '%',
          memoryUsage: (currentMetrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
          activeConnections: currentMetrics.activeConnections
        },
        alerts: {
          active: activeAlerts.length,
          critical: activeAlerts.filter(a => a.severity === 'critical').length,
          high: activeAlerts.filter(a => a.severity === 'high').length,
          total24h: alertStats.totalAlerts
        },
        infrastructure: {
          currentRegion: currentRegion?.name,
          regionLatency: currentRegion?.latency,
          activeRecoveries: activeRecoveries.length
        },
        recommendations: recommendations.slice(0, 5), // Top 5 recommendations
        timestamp: new Date()
      };
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      logger.error('Error getting system summary', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system summary'
      });
    }
  });

  return router;
}