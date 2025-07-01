/**
 * Alert Manager Service
 * Manages and distributes alerts across the system
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { db } from '../database';

export interface AlertConfig {
  enabledChannels: AlertChannel[];
  aggregationWindow: number;  // milliseconds
  rateLimits: {
    [key in AlertType]: {
      maxPerHour: number;
      maxPerDay: number;
    };
  };
  severityThresholds: {
    critical: number;  // Send immediately
    high: number;      // Send within 1 minute
    medium: number;    // Send within 5 minutes
    low: number;       // Send within 15 minutes
    info: number;      // Send within 30 minutes
  };
}

export type AlertType = 
  | 'performance'
  | 'system'
  | 'network'
  | 'trading'
  | 'security'
  | 'data_integrity'
  | 'liquidity'
  | 'mev';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AlertChannel = 'console' | 'database' | 'webhook' | 'email' | 'slack';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  details?: any;
  source: string;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolved: boolean;
  resolvedAt?: Date;
  correlationId?: string;
  tags: string[];
}

export interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  enabled: boolean;
  condition: {
    metric: string;
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
    threshold: number;
    duration?: number;  // How long condition must be true
  };
  severity: AlertSeverity;
  channels: AlertChannel[];
  cooldown: number;  // Milliseconds before alert can fire again
  lastFired?: Date;
}

export interface AlertStats {
  totalAlerts: number;
  activeAlerts: number;
  alertsBySeverity: Record<AlertSeverity, number>;
  alertsByType: Record<AlertType, number>;
  averageResolutionTime: number;
  topAlertSources: Array<{ source: string; count: number }>;
}

export class AlertManager {
  private static instance: AlertManager;
  private logger: Logger;
  private eventBus: EventBus;
  
  private config: AlertConfig;
  private alerts: Map<string, Alert> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private rateLimits: Map<string, number[]> = new Map();
  
  // Alert aggregation
  private pendingAlerts: Map<string, Alert[]> = new Map();
  private aggregationTimer?: NodeJS.Timeout;
  
  // Statistics
  private alertStats: AlertStats = {
    totalAlerts: 0,
    activeAlerts: 0,
    alertsBySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    },
    alertsByType: {
      performance: 0,
      system: 0,
      network: 0,
      trading: 0,
      security: 0,
      data_integrity: 0,
      liquidity: 0,
      mev: 0
    },
    averageResolutionTime: 0,
    topAlertSources: []
  };

  private constructor(eventBus: EventBus, config?: Partial<AlertConfig>) {
    this.logger = new Logger({ context: 'AlertManager' });
    this.eventBus = eventBus;
    
    this.config = {
      enabledChannels: ['console', 'database'],
      aggregationWindow: 5000,  // 5 seconds
      rateLimits: {
        performance: { maxPerHour: 10, maxPerDay: 50 },
        system: { maxPerHour: 20, maxPerDay: 100 },
        network: { maxPerHour: 15, maxPerDay: 75 },
        trading: { maxPerHour: 30, maxPerDay: 200 },
        security: { maxPerHour: 50, maxPerDay: 500 },
        data_integrity: { maxPerHour: 10, maxPerDay: 50 },
        liquidity: { maxPerHour: 20, maxPerDay: 100 },
        mev: { maxPerHour: 100, maxPerDay: 1000 }
      },
      severityThresholds: {
        critical: 0,     // Immediate
        high: 60000,     // 1 minute
        medium: 300000,  // 5 minutes
        low: 900000,     // 15 minutes
        info: 1800000    // 30 minutes
      },
      ...config
    };
    
    this.initialize();
  }

  static async create(eventBus: EventBus, config?: Partial<AlertConfig>): Promise<AlertManager> {
    if (!AlertManager.instance) {
      AlertManager.instance = new AlertManager(eventBus, config);
      await AlertManager.instance.createTables();
      await AlertManager.instance.loadRules();
    }
    return AlertManager.instance;
  }

  /**
   * Initialize the service
   */
  private initialize(): void {
    this.setupEventListeners();
    this.startAggregationTimer();
    this.setupDefaultRules();
    
    this.logger.info('Alert manager initialized', {
      channels: this.config.enabledChannels
    });
  }

  /**
   * Create required database tables
   */
  private async createTables(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS alerts (
          id VARCHAR(36) PRIMARY KEY,
          type VARCHAR(20) NOT NULL,
          severity VARCHAR(10) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT,
          details JSONB,
          source VARCHAR(100) NOT NULL,
          acknowledged BOOLEAN DEFAULT FALSE,
          acknowledged_at TIMESTAMP,
          acknowledged_by VARCHAR(100),
          resolved BOOLEAN DEFAULT FALSE,
          resolved_at TIMESTAMP,
          correlation_id VARCHAR(36),
          tags TEXT[],
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
        CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
        CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);
        
        CREATE TABLE IF NOT EXISTS alert_rules (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(20) NOT NULL,
          enabled BOOLEAN DEFAULT TRUE,
          condition JSONB NOT NULL,
          severity VARCHAR(10) NOT NULL,
          channels TEXT[],
          cooldown INTEGER NOT NULL,
          last_fired TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_rules_type ON alert_rules(type);
        CREATE INDEX IF NOT EXISTS idx_rules_enabled ON alert_rules(enabled);
      `);
    } catch (error) {
      this.logger.error('Error creating tables', error as Error);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Performance alerts
    this.eventBus.on('performance:alert', this.handlePerformanceAlert.bind(this));
    
    // System alerts
    this.eventBus.on('system:error', this.handleSystemError.bind(this));
    this.eventBus.on('system:warning', this.handleSystemWarning.bind(this));
    
    // Trading alerts
    this.eventBus.on('trade:high_value', this.handleHighValueTrade.bind(this));
    this.eventBus.on('trade:anomaly', this.handleTradeAnomaly.bind(this));
    
    // Liquidity alerts
    this.eventBus.on('liquidity:alert', this.handleLiquidityAlert.bind(this));
    
    // MEV alerts
    this.eventBus.on('mev:detected', this.handleMevDetection.bind(this));
    
    // Network alerts
    this.eventBus.on('network:disconnection', this.handleNetworkDisconnection.bind(this));
    this.eventBus.on('region:failover', this.handleRegionFailover.bind(this));
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_cpu_usage',
        name: 'High CPU Usage',
        type: 'performance',
        enabled: true,
        condition: {
          metric: 'cpu_usage',
          operator: 'gt',
          threshold: 90,
          duration: 60000  // 1 minute
        },
        severity: 'high',
        channels: ['console', 'database'],
        cooldown: 300000  // 5 minutes
      },
      {
        id: 'memory_leak',
        name: 'Potential Memory Leak',
        type: 'system',
        enabled: true,
        condition: {
          metric: 'memory_growth_rate',
          operator: 'gt',
          threshold: 10,  // 10MB per minute
          duration: 300000  // 5 minutes
        },
        severity: 'critical',
        channels: ['console', 'database', 'webhook'],
        cooldown: 600000  // 10 minutes
      },
      {
        id: 'high_missed_tx',
        name: 'High Missed Transaction Rate',
        type: 'performance',
        enabled: true,
        condition: {
          metric: 'missed_tx_rate',
          operator: 'gt',
          threshold: 5,  // 5%
          duration: 30000
        },
        severity: 'high',
        channels: ['console', 'database'],
        cooldown: 180000
      }
    ];
    
    for (const rule of defaultRules) {
      this.rules.set(rule.id, rule);
    }
  }

  /**
   * Start aggregation timer
   */
  private startAggregationTimer(): void {
    this.aggregationTimer = setInterval(
      () => this.processAggregatedAlerts(),
      this.config.aggregationWindow
    );
  }

  /**
   * Create alert
   */
  async createAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'acknowledged' | 'resolved'>): Promise<Alert> {
    // Check rate limits
    if (!this.checkRateLimit(alertData.type)) {
      this.logger.warn('Alert rate limited', {
        type: alertData.type,
        severity: alertData.severity
      });
      throw new Error('Alert rate limited');
    }
    
    const alert: Alert = {
      id: this.generateAlertId(),
      ...alertData,
      timestamp: new Date(),
      acknowledged: false,
      resolved: false,
      tags: alertData.tags || []
    };
    
    // Check if should aggregate
    if (this.shouldAggregate(alert)) {
      this.addToAggregation(alert);
      return alert;
    }
    
    // Process immediately for critical alerts
    if (alert.severity === 'critical') {
      await this.processAlert(alert);
    } else {
      this.addToAggregation(alert);
    }
    
    return alert;
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(type: AlertType): boolean {
    const key = `${type}_timestamps`;
    const now = Date.now();
    const timestamps = this.rateLimits.get(key) || [];
    
    // Clean old timestamps
    const oneHourAgo = now - 3600000;
    const recentTimestamps = timestamps.filter(t => t > oneHourAgo);
    
    // Check hourly limit
    const limits = this.config.rateLimits[type];
    if (recentTimestamps.length >= limits.maxPerHour) {
      return false;
    }
    
    // Add new timestamp
    recentTimestamps.push(now);
    this.rateLimits.set(key, recentTimestamps);
    
    return true;
  }

  /**
   * Should aggregate alert
   */
  private shouldAggregate(alert: Alert): boolean {
    // Don't aggregate critical alerts
    if (alert.severity === 'critical') return false;
    
    // Check severity threshold
    const threshold = this.config.severityThresholds[alert.severity];
    return threshold > 0;
  }

  /**
   * Add alert to aggregation
   */
  private addToAggregation(alert: Alert): void {
    const key = `${alert.type}_${alert.severity}`;
    
    if (!this.pendingAlerts.has(key)) {
      this.pendingAlerts.set(key, []);
    }
    
    this.pendingAlerts.get(key)!.push(alert);
  }

  /**
   * Process aggregated alerts
   */
  private async processAggregatedAlerts(): Promise<void> {
    for (const [key, alerts] of this.pendingAlerts) {
      if (alerts.length === 0) continue;
      
      // Check if alerts should be sent based on severity
      const severity = alerts[0].severity;
      const oldestAlert = alerts[0];
      const age = Date.now() - oldestAlert.timestamp.getTime();
      
      if (age >= this.config.severityThresholds[severity]) {
        // Process aggregated alert
        if (alerts.length === 1) {
          await this.processAlert(alerts[0]);
        } else {
          await this.processAggregatedAlert(alerts);
        }
        
        // Clear processed alerts
        this.pendingAlerts.set(key, []);
      }
    }
  }

  /**
   * Process single alert
   */
  private async processAlert(alert: Alert): Promise<void> {
    // Store alert
    this.alerts.set(alert.id, alert);
    this.alertStats.totalAlerts++;
    this.alertStats.activeAlerts++;
    this.alertStats.alertsBySeverity[alert.severity]++;
    this.alertStats.alertsByType[alert.type]++;
    
    // Send to channels
    await this.sendToChannels(alert);
    
    // Store in database
    await this.storeAlert(alert);
    
    // Emit alert event
    this.eventBus.emit('alert:created', alert);
    
    this.logger.warn('Alert created', {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title
    });
  }

  /**
   * Process aggregated alerts
   */
  private async processAggregatedAlert(alerts: Alert[]): Promise<void> {
    const summary: Alert = {
      id: this.generateAlertId(),
      type: alerts[0].type,
      severity: alerts[0].severity,
      title: `${alerts.length} ${alerts[0].type} alerts`,
      message: this.createAggregatedMessage(alerts),
      details: {
        count: alerts.length,
        alerts: alerts.map(a => ({
          id: a.id,
          title: a.title,
          timestamp: a.timestamp
        }))
      },
      source: 'AlertAggregator',
      timestamp: new Date(),
      acknowledged: false,
      resolved: false,
      tags: ['aggregated']
    };
    
    await this.processAlert(summary);
  }

  /**
   * Create aggregated message
   */
  private createAggregatedMessage(alerts: Alert[]): string {
    const sources = new Set(alerts.map(a => a.source));
    const timeRange = {
      start: Math.min(...alerts.map(a => a.timestamp.getTime())),
      end: Math.max(...alerts.map(a => a.timestamp.getTime()))
    };
    
    return `${alerts.length} alerts from ${sources.size} sources between ${new Date(timeRange.start).toISOString()} and ${new Date(timeRange.end).toISOString()}`;
  }

  /**
   * Send alert to channels
   */
  private async sendToChannels(alert: Alert): Promise<void> {
    for (const channel of this.config.enabledChannels) {
      try {
        switch (channel) {
          case 'console':
            this.sendToConsole(alert);
            break;
          case 'database':
            // Already handled separately
            break;
          case 'webhook':
            await this.sendToWebhook(alert);
            break;
          case 'email':
            await this.sendToEmail(alert);
            break;
          case 'slack':
            await this.sendToSlack(alert);
            break;
        }
      } catch (error) {
        this.logger.error(`Error sending to ${channel}`, error as Error);
      }
    }
  }

  /**
   * Send to console
   */
  private sendToConsole(alert: Alert): void {
    const color = this.getSeverityColor(alert.severity);
    console.log(`${color}[ALERT] [${alert.severity.toUpperCase()}] ${alert.title}\x1b[0m`);
    console.log(`  Type: ${alert.type}`);
    console.log(`  Message: ${alert.message}`);
    console.log(`  Source: ${alert.source}`);
    console.log(`  Time: ${alert.timestamp.toISOString()}`);
  }

  /**
   * Get severity color for console
   */
  private getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
      case 'critical': return '\x1b[91m';  // Bright red
      case 'high': return '\x1b[31m';      // Red
      case 'medium': return '\x1b[33m';    // Yellow
      case 'low': return '\x1b[36m';       // Cyan
      case 'info': return '\x1b[90m';      // Gray
      default: return '\x1b[0m';
    }
  }

  /**
   * Send to webhook (placeholder)
   */
  private async sendToWebhook(alert: Alert): Promise<void> {
    // Webhook implementation would go here
    this.logger.debug('Webhook alert sent', { alertId: alert.id });
  }

  /**
   * Send to email (placeholder)
   */
  private async sendToEmail(alert: Alert): Promise<void> {
    // Email implementation would go here
    this.logger.debug('Email alert sent', { alertId: alert.id });
  }

  /**
   * Send to Slack (placeholder)
   */
  private async sendToSlack(alert: Alert): Promise<void> {
    // Slack implementation would go here
    this.logger.debug('Slack alert sent', { alertId: alert.id });
  }

  /**
   * Store alert in database
   */
  private async storeAlert(alert: Alert): Promise<void> {
    try {
      await db.query(`
        INSERT INTO alerts (
          id, type, severity, title, message, details,
          source, acknowledged, resolved, correlation_id, tags
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        alert.id,
        alert.type,
        alert.severity,
        alert.title,
        alert.message,
        JSON.stringify(alert.details || {}),
        alert.source,
        alert.acknowledged,
        alert.resolved,
        alert.correlationId || null,
        alert.tags
      ]);
    } catch (error) {
      this.logger.error('Error storing alert', error as Error);
    }
  }

  /**
   * Handle performance alert
   */
  private async handlePerformanceAlert(event: any): Promise<void> {
    await this.createAlert({
      type: 'performance',
      severity: event.severity || 'medium',
      title: event.message || 'Performance issue detected',
      message: event.details || '',
      details: event,
      source: 'PerformanceMonitor',
      tags: ['auto-generated']
    });
  }

  /**
   * Handle system error
   */
  private async handleSystemError(event: any): Promise<void> {
    await this.createAlert({
      type: 'system',
      severity: 'high',
      title: 'System error occurred',
      message: event.error || 'Unknown error',
      details: event,
      source: event.source || 'System',
      tags: ['error', 'auto-generated']
    });
  }

  /**
   * Handle system warning
   */
  private async handleSystemWarning(event: any): Promise<void> {
    await this.createAlert({
      type: 'system',
      severity: 'medium',
      title: 'System warning',
      message: event.message || 'System warning detected',
      details: event,
      source: event.source || 'System',
      tags: ['warning', 'auto-generated']
    });
  }

  /**
   * Handle high value trade
   */
  private async handleHighValueTrade(event: any): Promise<void> {
    await this.createAlert({
      type: 'trading',
      severity: 'info',
      title: 'High value trade detected',
      message: `Trade value: $${event.valueUsd?.toFixed(2) || 'unknown'}`,
      details: event,
      source: 'TradeMonitor',
      tags: ['high-value', 'trade']
    });
  }

  /**
   * Handle trade anomaly
   */
  private async handleTradeAnomaly(event: any): Promise<void> {
    await this.createAlert({
      type: 'trading',
      severity: 'high',
      title: 'Trading anomaly detected',
      message: event.description || 'Unusual trading pattern detected',
      details: event,
      source: 'TradeAnalyzer',
      tags: ['anomaly', 'trade']
    });
  }

  /**
   * Handle liquidity alert
   */
  private async handleLiquidityAlert(event: any): Promise<void> {
    await this.createAlert({
      type: 'liquidity',
      severity: event.severity || 'medium',
      title: event.message || 'Liquidity alert',
      message: `${event.type}: ${event.changePercent?.toFixed(2)}% change`,
      details: event,
      source: 'LiquidityTracker',
      tags: ['liquidity', event.type]
    });
  }

  /**
   * Handle MEV detection
   */
  private async handleMevDetection(event: any): Promise<void> {
    await this.createAlert({
      type: 'mev',
      severity: event.confidence === 'high' ? 'high' : 'medium',
      title: `MEV activity detected: ${event.type}`,
      message: event.description || 'Potential MEV activity detected',
      details: event,
      source: 'MEVDetector',
      tags: ['mev', event.type]
    });
  }

  /**
   * Handle network disconnection
   */
  private async handleNetworkDisconnection(event: any): Promise<void> {
    await this.createAlert({
      type: 'network',
      severity: 'high',
      title: 'Network disconnection',
      message: `Disconnected from ${event.endpoint || 'unknown endpoint'}`,
      details: event,
      source: 'NetworkMonitor',
      tags: ['network', 'disconnection']
    });
  }

  /**
   * Handle region failover
   */
  private async handleRegionFailover(event: any): Promise<void> {
    await this.createAlert({
      type: 'network',
      severity: 'medium',
      title: 'Region failover occurred',
      message: `Switched from ${event.fromRegion} to ${event.toRegion}: ${event.reason}`,
      details: event,
      source: 'MultiRegionManager',
      tags: ['network', 'failover']
    });
  }

  /**
   * Load rules from database
   */
  private async loadRules(): Promise<void> {
    try {
      const result = await db.query('SELECT * FROM alert_rules WHERE enabled = true');
      
      for (const row of result.rows) {
        const rule: AlertRule = {
          id: row.id,
          name: row.name,
          type: row.type,
          enabled: row.enabled,
          condition: row.condition,
          severity: row.severity,
          channels: row.channels || this.config.enabledChannels,
          cooldown: row.cooldown,
          lastFired: row.last_fired
        };
        
        this.rules.set(rule.id, rule);
      }
      
      this.logger.info('Loaded alert rules', { count: this.rules.size });
    } catch (error) {
      this.logger.error('Error loading rules', error as Error);
    }
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    
    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
    
    // Update database
    await db.query(`
      UPDATE alerts 
      SET acknowledged = true, 
          acknowledged_at = NOW(), 
          acknowledged_by = $2
      WHERE id = $1
    `, [alertId, acknowledgedBy]);
    
    // Emit event
    this.eventBus.emit('alert:acknowledged', {
      alertId,
      acknowledgedBy
    });
    
    return true;
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    
    alert.resolved = true;
    alert.resolvedAt = new Date();
    
    // Update stats
    this.alertStats.activeAlerts--;
    
    // Update database
    await db.query(`
      UPDATE alerts 
      SET resolved = true, resolved_at = NOW()
      WHERE id = $1
    `, [alertId]);
    
    // Remove from active alerts
    this.alerts.delete(alertId);
    
    // Emit event
    this.eventBus.emit('alert:resolved', { alertId });
    
    return true;
  }

  /**
   * Generate alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(a => !a.resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get alert statistics
   */
  getStats(): AlertStats {
    // Update top sources
    const sourceCounts = new Map<string, number>();
    for (const alert of this.alerts.values()) {
      const count = sourceCounts.get(alert.source) || 0;
      sourceCounts.set(alert.source, count + 1);
    }
    
    this.alertStats.topAlertSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return { ...this.alertStats };
  }

  /**
   * Get alert history
   */
  async getAlertHistory(
    filters?: {
      type?: AlertType;
      severity?: AlertSeverity;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<Alert[]> {
    try {
      let query = 'SELECT * FROM alerts WHERE 1=1';
      const params: any[] = [];
      
      if (filters?.type) {
        params.push(filters.type);
        query += ` AND type = $${params.length}`;
      }
      
      if (filters?.severity) {
        params.push(filters.severity);
        query += ` AND severity = $${params.length}`;
      }
      
      if (filters?.startDate) {
        params.push(filters.startDate);
        query += ` AND created_at >= $${params.length}`;
      }
      
      if (filters?.endDate) {
        params.push(filters.endDate);
        query += ` AND created_at <= $${params.length}`;
      }
      
      query += ' ORDER BY created_at DESC';
      
      if (filters?.limit) {
        params.push(filters.limit);
        query += ` LIMIT $${params.length}`;
      }
      
      const result = await db.query(query, params);
      
      return result.rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        severity: row.severity,
        title: row.title,
        message: row.message,
        details: row.details,
        source: row.source,
        timestamp: row.created_at,
        acknowledged: row.acknowledged,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedBy: row.acknowledged_by,
        resolved: row.resolved,
        resolvedAt: row.resolved_at,
        correlationId: row.correlation_id,
        tags: row.tags || []
      }));
    } catch (error) {
      this.logger.error('Error getting alert history', error as Error);
      return [];
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Alert config updated');
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
    }
    
    this.logger.info('Alert manager stopped');
  }
}