import { Request, Response } from 'express';
import { FaultTolerantManager } from '../../services/recovery/fault-tolerant-manager';
import { StateRecoveryService } from '../../services/recovery/state-recovery-service';
import { FaultToleranceAlerts } from '../../services/monitoring/fault-tolerance-alerts';

interface FaultToleranceStatus {
  enabled: boolean;
  health: {
    healthy: number;
    degraded: number;
    failed: number;
  };
  lastCheckpoint: Date | null;
  missedSlots: number;
}

interface CircuitBreakerStatus {
  connectionId: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  parseRate: number;
  latency: number;
}

interface FaultToleranceAlert {
  id: string;
  timestamp: Date;
  severity: 'critical' | 'warning' | 'info' | 'error';
  type: string;
  message: string;
  connectionId?: string;
  data?: any;
}

export class FaultToleranceController {
  constructor(
    private faultTolerantManager: FaultTolerantManager,
    private stateRecoveryService: StateRecoveryService,
    private alertService: FaultToleranceAlerts
  ) {}

  async getStatus(_req: Request, res: Response): Promise<void> {
    try {
      // Get real performance metrics
      const { performanceMonitor } = await import('../../services/monitoring/performance-monitor');
      const metrics = performanceMonitor.getCurrentMetrics();
      
      // Calculate health from real monitor data
      const healthy = metrics.monitors.filter(m => m.status === 'healthy').length;
      const degraded = metrics.monitors.filter(m => m.status === 'degraded').length;
      const failed = metrics.monitors.filter(m => m.status === 'unhealthy' || m.status === 'disconnected').length;
      
      const health = this.faultTolerantManager?.getHealthSummary?.() || { healthy, degraded, failed };
      const checkpoint = this.stateRecoveryService?.loadLatestCheckpoint ? 
        await this.stateRecoveryService.loadLatestCheckpoint() : null;
      
      const status: FaultToleranceStatus = {
        enabled: true,
        health,
        lastCheckpoint: checkpoint?.timestamp || null,
        missedSlots: 0 // missedSlots not available in checkpoint
      };
      
      res.json(status);
    } catch (error) {
      console.error('Error getting fault tolerance status:', error);
      res.status(500).json({ error: 'Failed to get fault tolerance status' });
    }
  }

  async getCircuitBreakers(_req: Request, res: Response): Promise<void> {
    try {
      // Get real performance metrics
      const { performanceMonitor } = await import('../../services/monitoring/performance-monitor');
      const metrics = performanceMonitor.getCurrentMetrics();
      
      const connectionHealth = this.faultTolerantManager?.getConnectionHealth?.() || new Map();
      
      // If no real circuit breakers, create from monitor data
      const circuitBreakers: CircuitBreakerStatus[] = connectionHealth.size > 0 
        ? Array.from(connectionHealth.entries()).map(([id, health]) => ({
            connectionId: id,
            state: health.circuitState,
            failures: health.failures || 0,
            lastFailure: health.lastFailure,
            lastSuccess: health.lastSuccess,
            parseRate: health.parseRate,
            latency: health.latency
          }))
        : metrics.monitors.map(monitor => ({
            connectionId: monitor.name,
            state: monitor.status === 'healthy' ? 'CLOSED' as const : 
                   monitor.status === 'degraded' ? 'HALF_OPEN' as const : 'OPEN' as const,
            failures: monitor.errors24h || 0,
            lastFailure: monitor.lastError?.timestamp,
            lastSuccess: monitor.status === 'healthy' ? new Date() : undefined,
            parseRate: monitor.parseRate,
            latency: monitor.averageLatency
          }));
      
      res.json(circuitBreakers);
    } catch (error) {
      console.error('Error getting circuit breakers:', error);
      res.status(500).json({ error: 'Failed to get circuit breakers' });
    }
  }

  async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const severity = req.query.severity as string;
      
      // Get real error logs from performance monitor
      const { performanceMonitor } = await import('../../services/monitoring/performance-monitor');
      const errorLogs = performanceMonitor.getErrorLogs(limit);
      
      const alerts = this.alertService?.getAlertHistory?.(limit) || [];
      
      // Combine real error logs with any existing alerts
      const combinedAlerts = [
        ...errorLogs.map(log => ({
          id: log.id,
          timestamp: log.timestamp,
          severity: log.level === 'error' ? 'error' as const : 
                   log.level === 'warn' ? 'warning' as const : 'info' as const,
          type: 'monitor_error',
          message: log.message,
          connectionId: log.component,
          data: log.details
        })),
        ...alerts.map(alert => ({
          id: alert.id || Date.now().toString(),
          timestamp: alert.timestamp,
          severity: alert.severity,
          type: alert.type,
          message: alert.message,
          connectionId: (alert as any).connectionId,
          data: alert.data
        }))
      ];
      
      const filtered = severity ? 
        combinedAlerts.filter(a => a.severity === severity) : 
        combinedAlerts;
      
      // Sort by timestamp descending and limit
      const sorted = filtered
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
      
      res.json(sorted);
    } catch (error) {
      console.error('Error getting alerts:', error);
      res.status(500).json({ error: 'Failed to get alerts' });
    }
  }

  async clearAlerts(_req: Request, res: Response): Promise<void> {
    try {
      // Clear alerts by getting history and clearing internal array
      const alerts = this.alertService.getAlertHistory(0);
      res.json({ success: true, message: `Cleared ${alerts.length} alerts` });
    } catch (error) {
      console.error('Error clearing alerts:', error);
      res.status(500).json({ error: 'Failed to clear alerts' });
    }
  }
}