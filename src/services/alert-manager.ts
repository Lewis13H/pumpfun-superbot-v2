import { EventEmitter } from 'events';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  component: string;
  message: string;
  details?: any;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  autoResolve?: boolean;
  resolvedAt?: Date;
}

export enum AlertType {
  CPU_HIGH = 'cpu_high',
  MEMORY_HIGH = 'memory_high',
  PARSE_RATE_LOW = 'parse_rate_low',
  STREAM_LAG_HIGH = 'stream_lag_high',
  MONITOR_DISCONNECTED = 'monitor_disconnected',
  MONITOR_UNHEALTHY = 'monitor_unhealthy',
  ERROR_RATE_HIGH = 'error_rate_high',
  NETWORK_CONGESTION = 'network_congestion',
  DATABASE_SLOW = 'database_slow',
  API_SLOW = 'api_slow'
}

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

interface AlertThreshold {
  type: AlertType;
  condition: (metrics: any) => boolean;
  severity: AlertSeverity;
  message: (metrics: any) => string;
  autoResolve?: boolean;
  cooldown?: number; // Minutes before re-alerting
}

export class AlertManager extends EventEmitter {
  private alerts: Map<string, Alert> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private maxHistorySize = 1000;
  private alertCooldowns: Map<string, number> = new Map();
  
  private thresholds: AlertThreshold[] = [
    {
      type: AlertType.CPU_HIGH,
      condition: (metrics) => metrics.system.cpuUsage > 80,
      severity: AlertSeverity.WARNING,
      message: (metrics) => `CPU usage is high: ${metrics.system.cpuUsage.toFixed(1)}%`,
      autoResolve: true,
      cooldown: 5
    },
    {
      type: AlertType.MEMORY_HIGH,
      condition: (metrics) => metrics.system.memoryUsage.percentage > 85,
      severity: AlertSeverity.WARNING,
      message: (metrics) => `Memory usage is high: ${metrics.system.memoryUsage.percentage.toFixed(1)}%`,
      autoResolve: true,
      cooldown: 5
    },
    {
      type: AlertType.PARSE_RATE_LOW,
      condition: (metrics) => metrics.monitors.some(m => m.parseRate < 0.9),
      severity: AlertSeverity.ERROR,
      message: (metrics) => {
        const monitor = metrics.monitors.find(m => m.parseRate < 0.9);
        return `Parse rate low for ${monitor.name}: ${(monitor.parseRate * 100).toFixed(1)}%`;
      },
      autoResolve: true,
      cooldown: 10
    },
    {
      type: AlertType.STREAM_LAG_HIGH,
      condition: (metrics) => metrics.streams.some(s => s.streamLag > 2000),
      severity: AlertSeverity.ERROR,
      message: (metrics) => {
        const stream = metrics.streams.find(s => s.streamLag > 2000);
        return `Stream lag high for ${stream.name}: ${stream.streamLag}ms`;
      },
      autoResolve: true,
      cooldown: 5
    },
    {
      type: AlertType.MONITOR_DISCONNECTED,
      condition: (metrics) => metrics.monitors.some(m => m.status === 'disconnected'),
      severity: AlertSeverity.CRITICAL,
      message: (metrics) => {
        const monitor = metrics.monitors.find(m => m.status === 'disconnected');
        return `Monitor ${monitor.name} is disconnected`;
      },
      autoResolve: true,
      cooldown: 2
    },
    {
      type: AlertType.ERROR_RATE_HIGH,
      condition: (metrics) => metrics.monitors.some(m => m.errors24h > 100),
      severity: AlertSeverity.WARNING,
      message: (metrics) => {
        const monitor = metrics.monitors.find(m => m.errors24h > 100);
        return `High error rate for ${monitor.name}: ${monitor.errors24h} errors in 24h`;
      },
      autoResolve: false,
      cooldown: 60
    }
  ];

  constructor() {
    super();
    this.startAlertChecking();
  }

  private startAlertChecking() {
    // Check alerts every 30 seconds
    setInterval(() => {
      this.checkAlerts();
    }, 30000);
  }

  public checkAlerts(metrics?: any) {
    if (!metrics) {
      // Metrics must be provided for now
      return;
    }

    // Check each threshold
    this.thresholds.forEach(threshold => {
      const alertKey = `${threshold.type}`;
      const isConditionMet = threshold.condition(metrics);
      const existingAlert = this.activeAlerts.get(alertKey);

      if (isConditionMet && !existingAlert) {
        // Check cooldown
        const lastAlertTime = this.alertCooldowns.get(alertKey);
        if (lastAlertTime) {
          const cooldownExpiry = lastAlertTime + (threshold.cooldown || 5) * 60 * 1000;
          if (Date.now() < cooldownExpiry) {
            return; // Still in cooldown
          }
        }

        // Create new alert
        const alert = this.createAlert(
          threshold.type,
          threshold.severity,
          threshold.message(metrics),
          { metrics, threshold: threshold.type }
        );
        
        this.raiseAlert(alert);
        this.alertCooldowns.set(alertKey, Date.now());
      } else if (!isConditionMet && existingAlert && threshold.autoResolve) {
        // Auto-resolve alert
        this.resolveAlert(existingAlert.id);
      }
    });
  }

  private createAlert(
    type: AlertType,
    severity: AlertSeverity,
    message: string,
    details?: any
  ): Alert {
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      component: 'system',
      message,
      details,
      timestamp: new Date(),
      acknowledged: false
    };
  }

  public raiseAlert(alert: Alert) {
    this.alerts.set(alert.id, alert);
    this.activeAlerts.set(alert.type, alert);
    this.addToHistory(alert);

    console.warn(`Alert raised: ${alert.type} - ${alert.message}`);
    this.emit('alert:raised', alert);
  }

  public acknowledgeAlert(alertId: string, acknowledgedBy = 'system') {
    const alert = this.alerts.get(alertId);
    if (!alert) return;

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;

    console.info(`Alert acknowledged: ${alert.type} - ${alert.message}`);
    this.emit('alert:acknowledged', alert);
  }

  public resolveAlert(alertId: string) {
    const alert = this.alerts.get(alertId);
    if (!alert) return;

    alert.resolvedAt = new Date();
    this.alerts.delete(alertId);
    
    // Remove from active alerts
    for (const [type, activeAlert] of this.activeAlerts) {
      if (activeAlert.id === alertId) {
        this.activeAlerts.delete(type);
        break;
      }
    }

    console.info(`Alert resolved: ${alert.type} - ${alert.message}`);
    this.emit('alert:resolved', alert);
  }

  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  public getAlertHistory(limit = 100): Alert[] {
    return this.alertHistory.slice(0, limit);
  }

  public getAlertById(id: string): Alert | undefined {
    return this.alerts.get(id) || this.alertHistory.find(a => a.id === id);
  }

  public getAlertsBySeverity(severity: AlertSeverity): Alert[] {
    return this.getActiveAlerts().filter(a => a.severity === severity);
  }

  public clearAlert(alertId: string) {
    this.alerts.delete(alertId);
    
    // Remove from active alerts
    for (const [type, alert] of this.activeAlerts) {
      if (alert.id === alertId) {
        this.activeAlerts.delete(type);
        break;
      }
    }
  }

  public clearAllAlerts() {
    this.alerts.clear();
    this.activeAlerts.clear();
    this.alertCooldowns.clear();
  }

  private addToHistory(alert: Alert) {
    this.alertHistory.unshift({ ...alert });
    
    // Maintain history size limit
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
    }
  }

  public addCustomThreshold(threshold: AlertThreshold) {
    this.thresholds.push(threshold);
  }

  public removeThreshold(type: AlertType) {
    this.thresholds = this.thresholds.filter(t => t.type !== type);
  }

  public getThresholds(): AlertThreshold[] {
    return [...this.thresholds];
  }

  // Integration with notification systems
  public async sendNotification(alert: Alert, channels: string[] = ['dashboard']) {
    for (const channel of channels) {
      switch (channel) {
        case 'dashboard':
          this.emit('notification:dashboard', alert);
          break;
        case 'email':
          // Implement email notification
          break;
        case 'slack':
          // Implement Slack notification
          break;
        case 'webhook':
          // Implement webhook notification
          break;
      }
    }
  }

  public getAlertStats() {
    const stats = {
      total: this.alertHistory.length,
      active: this.activeAlerts.size,
      bySeverity: {
        [AlertSeverity.INFO]: 0,
        [AlertSeverity.WARNING]: 0,
        [AlertSeverity.ERROR]: 0,
        [AlertSeverity.CRITICAL]: 0
      },
      byType: {} as Record<string, number>
    };

    // Count by severity
    this.getActiveAlerts().forEach(alert => {
      stats.bySeverity[alert.severity]++;
    });

    // Count by type
    this.alertHistory.forEach(alert => {
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
    });

    return stats;
  }

  public destroy() {
    this.clearAllAlerts();
    this.removeAllListeners();
  }
}

// Singleton instance
export const alertManager = new AlertManager();