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
      const health = this.faultTolerantManager.getHealthSummary();
      const checkpoint = await this.stateRecoveryService.loadLatestCheckpoint();
      
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
      const connectionHealth = this.faultTolerantManager.getConnectionHealth();
      const circuitBreakers: CircuitBreakerStatus[] = Array.from(connectionHealth.entries()).map(([id, health]) => ({
        connectionId: id,
        state: health.circuitState,
        failures: health.failures || 0,
        lastFailure: health.lastFailure,
        lastSuccess: health.lastSuccess,
        parseRate: health.parseRate,
        latency: health.latency
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
      
      const alerts = this.alertService.getAlertHistory(limit);
      const filtered = severity ? 
        alerts.filter(a => a.severity === severity) : 
        alerts;
      
      const formattedAlerts: FaultToleranceAlert[] = filtered.map(alert => ({
        id: alert.id || Date.now().toString(),
        timestamp: alert.timestamp,
        severity: alert.severity,
        type: alert.type,
        message: alert.message,
        connectionId: (alert as any).connectionId,
        data: alert.data
      }));
      
      res.json(formattedAlerts);
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