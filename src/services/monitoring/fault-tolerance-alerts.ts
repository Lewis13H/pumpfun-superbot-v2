/**
 * Fault Tolerance Alert Service
 * Monitors system health and sends alerts for critical conditions
 */

import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import chalk from 'chalk';

export interface AlertConfig {
  enableConsoleAlerts: boolean;
  enableWebhookAlerts: boolean;
  webhookUrl?: string;
  alertThresholds: {
    maxFailuresPerConnection: number;
    minParseRate: number;
    maxLatency: number;
    maxConsecutiveFailures: number;
  };
  alertCooldown: number; // ms between alerts for same issue
}

export interface Alert {
  id: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'error' | 'critical';
  type: string;
  title: string;
  message: string;
  data?: any;
}

export class FaultToleranceAlerts {
  private logger: Logger;
  private alerts: Alert[] = [];
  private alertCooldowns: Map<string, number> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  
  constructor(
    private eventBus: EventBus,
    private config: AlertConfig
  ) {
    this.logger = new Logger({ context: 'FaultToleranceAlerts' });
    this.setupAlertListeners();
  }
  
  /**
   * Setup event listeners for fault tolerance events
   */
  private setupAlertListeners(): void {
    // Connection failures
    this.eventBus.on('fault-tolerance:alert', (data: any) => {
      switch (data.type) {
        case 'connection_failure':
          this.handleConnectionFailure(data);
          break;
        case 'performance_degradation':
          this.handlePerformanceDegradation(data);
          break;
        case 'high_latency':
          this.handleHighLatency(data);
          break;
      }
    });
    
    // Recovery events
    this.eventBus.on('fault-tolerance:recovery', (data: any) => {
      this.createAlert({
        severity: 'info',
        type: 'recovery_success',
        title: 'Connection Recovered',
        message: `Connection ${data.connectionId} recovered after ${Math.round(data.recoveryTime / 1000)}s`,
        data
      });
      
      // Reset consecutive failures
      this.consecutiveFailures.delete(data.connectionId);
    });
    
    // Emergency events
    this.eventBus.on('fault-tolerance:emergency', (data: any) => {
      this.createAlert({
        severity: 'critical',
        type: 'emergency_recovery',
        title: '🚨 EMERGENCY: All Connections Failed',
        message: 'System entering emergency recovery mode. All connections have failed.',
        data
      });
    });
    
    // Checkpoint events
    this.eventBus.on('recovery:checkpoint-failed', (data: any) => {
      this.createAlert({
        severity: 'warning',
        type: 'checkpoint_failure',
        title: 'Checkpoint Save Failed',
        message: `Failed to save checkpoint: ${data.error}`,
        data
      });
    });
    
    // Migration events
    this.eventBus.on('fault-tolerance:failover', (data: any) => {
      this.createAlert({
        severity: 'warning',
        type: 'failover',
        title: 'Connection Failover',
        message: `Migrating ${data.subscriptions.length} subscriptions from ${data.from} to ${data.to}`,
        data
      });
    });
  }
  
  /**
   * Handle connection failure alerts
   */
  private handleConnectionFailure(data: any): void {
    const connectionId = data.connectionId;
    const failures = this.consecutiveFailures.get(connectionId) || 0;
    this.consecutiveFailures.set(connectionId, failures + 1);
    
    // Check if we should alert
    if (data.failures >= this.config.alertThresholds.maxFailuresPerConnection) {
      this.createAlert({
        severity: 'error',
        type: 'connection_failure',
        title: `Connection ${connectionId} Failed`,
        message: `Circuit breaker opened after ${data.failures} failures. Error: ${data.error}`,
        data
      });
    } else if (failures >= this.config.alertThresholds.maxConsecutiveFailures) {
      this.createAlert({
        severity: 'warning',
        type: 'consecutive_failures',
        title: `Multiple Failures on ${connectionId}`,
        message: `Connection has failed ${failures} times consecutively`,
        data
      });
    }
  }
  
  /**
   * Handle performance degradation alerts
   */
  private handlePerformanceDegradation(data: any): void {
    if (data.parseRate < this.config.alertThresholds.minParseRate) {
      this.createAlert({
        severity: 'warning',
        type: 'low_parse_rate',
        title: `Low Parse Rate on ${data.connectionId}`,
        message: `Parse rate dropped to ${data.parseRate}% (threshold: ${this.config.alertThresholds.minParseRate}%)`,
        data
      });
    }
  }
  
  /**
   * Handle high latency alerts
   */
  private handleHighLatency(data: any): void {
    if (data.latency > this.config.alertThresholds.maxLatency) {
      this.createAlert({
        severity: 'warning',
        type: 'high_latency',
        title: `High Latency on ${data.connectionId}`,
        message: `Latency increased to ${data.latency}ms (threshold: ${this.config.alertThresholds.maxLatency}ms)`,
        data
      });
    }
  }
  
  /**
   * Create and send an alert
   */
  private createAlert(alert: Omit<Alert, 'id' | 'timestamp'>): void {
    // Check cooldown
    const cooldownKey = `${alert.type}:${alert.data?.connectionId || 'system'}`;
    const lastAlert = this.alertCooldowns.get(cooldownKey);
    if (lastAlert && Date.now() - lastAlert < this.config.alertCooldown) {
      return; // Still in cooldown
    }
    
    // Create alert
    const fullAlert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...alert
    };
    
    // Store alert
    this.alerts.push(fullAlert);
    this.alertCooldowns.set(cooldownKey, Date.now());
    
    // Keep only last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }
    
    // Send alert
    this.sendAlert(fullAlert);
  }
  
  /**
   * Send alert through configured channels
   */
  private sendAlert(alert: Alert): void {
    // Console alerts
    if (this.config.enableConsoleAlerts) {
      this.sendConsoleAlert(alert);
    }
    
    // Webhook alerts
    if (this.config.enableWebhookAlerts && this.config.webhookUrl) {
      this.sendWebhookAlert(alert);
    }
    
    // Emit alert event for other systems
    this.eventBus.emit('alert:created', alert);
  }
  
  /**
   * Send console alert with color coding
   */
  private sendConsoleAlert(alert: Alert): void {
    const timestamp = alert.timestamp.toLocaleTimeString();
    let color = chalk.gray;
    let prefix = 'ℹ️ ';
    
    switch (alert.severity) {
      case 'warning':
        color = chalk.yellow;
        prefix = '⚠️ ';
        break;
      case 'error':
        color = chalk.red;
        prefix = '❌ ';
        break;
      case 'critical':
        color = chalk.bgRed.white;
        prefix = '🚨 ';
        break;
    }
    
    console.log(`\n${color(`[${timestamp}] ${prefix}${alert.title}`)}`);
    console.log(color(`  ${alert.message}`));
    
    if (alert.data && this.logger.level <= 1) { // DEBUG level
      console.log(chalk.gray(`  Data: ${JSON.stringify(alert.data, null, 2)}`));
    }
    console.log(); // Empty line for readability
  }
  
  /**
   * Send webhook alert (mock implementation)
   */
  private async sendWebhookAlert(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) return;
    
    try {
      // In production, this would make an HTTP POST request
      this.logger.debug(`Webhook alert sent to ${this.config.webhookUrl}`, { alertId: alert.id });
      
      // Mock implementation - log that we would send
      this.logger.info(`Would send webhook alert: ${alert.title}`);
      
    } catch (error) {
      this.logger.error('Failed to send webhook alert', error as Error);
    }
  }
  
  /**
   * Get alert history
   */
  public getAlertHistory(limit: number = 100): Alert[] {
    return this.alerts.slice(-limit);
  }
  
  /**
   * Get alerts by severity
   */
  public getAlertsBySeverity(severity: Alert['severity']): Alert[] {
    return this.alerts.filter(a => a.severity === severity);
  }
  
  /**
   * Get alert statistics
   */
  public getAlertStats(): {
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    recentRate: number; // alerts per minute in last 5 minutes
  } {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentAlerts = this.alerts.filter(a => a.timestamp.getTime() > fiveMinutesAgo);
    
    const stats = {
      total: this.alerts.length,
      bySeverity: {} as Record<string, number>,
      byType: {} as Record<string, number>,
      recentRate: recentAlerts.length / 5 // per minute
    };
    
    // Count by severity and type
    for (const alert of this.alerts) {
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
    }
    
    return stats;
  }
  
  /**
   * Clear alert history
   */
  public clearAlerts(): void {
    this.alerts = [];
    this.alertCooldowns.clear();
    this.consecutiveFailures.clear();
    this.logger.info('Alert history cleared');
  }
}