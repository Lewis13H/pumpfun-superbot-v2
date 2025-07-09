import { Pool } from 'pg';
import { EventBus } from '../../../core/event-bus';
import { logger } from '../../../core/logger';

export interface HolderAlert {
  id?: number;
  mintAddress: string;
  alertType: 'score_drop' | 'concentration_increase' | 'rapid_growth' | 'high_churn' | 'bot_activity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  metadata?: any;
  triggered_at: Date;
  acknowledged: boolean;
}

export interface AlertRule {
  type: string;
  condition: (current: any, previous: any, trends?: any) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: (data: any) => string;
  message: (data: any) => string;
}

export class HolderAlertService {
  private alertRules: AlertRule[] = [
    {
      type: 'score_drop',
      condition: (current, previous) => {
        const drop = previous.holderScore - current.holderScore;
        return drop >= 20 || (drop >= 10 && current.holderScore < 150);
      },
      severity: 'high',
      title: () => 'Significant Holder Score Drop',
      message: (data) => `Holder score dropped from ${data.previous.holderScore} to ${data.current.holderScore}`
    },
    {
      type: 'concentration_increase',
      condition: (current, previous) => {
        const increase = current.top10Percentage - previous.top10Percentage;
        return increase >= 10 || (increase >= 5 && current.top10Percentage > 50);
      },
      severity: 'medium',
      title: () => 'Increasing Token Concentration',
      message: (data) => `Top 10 holders now control ${data.current.top10Percentage.toFixed(1)}% (up ${(data.current.top10Percentage - data.previous.top10Percentage).toFixed(1)}%)`
    },
    {
      type: 'rapid_growth',
      condition: (current, previous) => {
        const timeDiff = (current.timestamp - previous.timestamp) / (1000 * 60 * 60); // hours
        const holderGrowth = current.totalHolders - previous.totalHolders;
        const growthRate = holderGrowth / timeDiff;
        return growthRate > 10; // More than 10 holders per hour
      },
      severity: 'medium',
      title: () => 'Rapid Holder Growth Detected',
      message: (data) => {
        const growth = data.current.totalHolders - data.previous.totalHolders;
        return `Added ${growth} holders in short period - possible bot activity`;
      }
    },
    {
      type: 'high_churn',
      condition: (current, _previous, trends) => {
        return trends && trends.walletChurn && trends.walletChurn.rate > 25;
      },
      severity: 'medium',
      title: () => 'High Wallet Churn Rate',
      message: (data) => `${data.trends.walletChurn.rate.toFixed(1)}% of holders changed in the period`
    }
  ];

  constructor(
    private pool: Pool,
    private eventBus: EventBus
  ) {}

  async checkAlerts(mintAddress: string): Promise<HolderAlert[]> {
    try {
      // Get current and previous snapshots
      const snapshots = await this.getRecentSnapshots(mintAddress, 2);
      if (snapshots.length < 2) {
        return [];
      }

      const current = snapshots[0];
      const previous = snapshots[1];

      // Get trend data if available
      const trends = await this.getTrendData(mintAddress);

      // Check all rules
      const alerts: HolderAlert[] = [];
      
      for (const rule of this.alertRules) {
        if (rule.condition(current, previous, trends)) {
          const alert: HolderAlert = {
            mintAddress,
            alertType: rule.type as any,
            severity: rule.severity,
            title: rule.title({ current, previous, trends }),
            message: rule.message({ current, previous, trends }),
            metadata: {
              currentSnapshot: current,
              previousSnapshot: previous,
              trends
            },
            triggered_at: new Date(),
            acknowledged: false
          };

          alerts.push(alert);
        }
      }

      // Save alerts to database
      for (const alert of alerts) {
        await this.saveAlert(alert);
      }

      // Emit alerts via event bus
      if (alerts.length > 0) {
        this.eventBus.emit('HOLDER_ALERTS_TRIGGERED', {
          mintAddress,
          alerts,
          timestamp: new Date()
        });
      }

      return alerts;
    } catch (error) {
      logger.error(`Error checking alerts for ${mintAddress}:`, error);
      return [];
    }
  }

  private async getRecentSnapshots(mintAddress: string, limit: number) {
    const query = `
      SELECT 
        snapshot_time as timestamp,
        total_holders as "totalHolders",
        holder_score as "holderScore",
        top_10_percentage as "top10Percentage",
        top_25_percentage as "top25Percentage",
        gini_coefficient as "giniCoefficient"
      FROM holder_snapshots
      WHERE mint_address = $1
      ORDER BY snapshot_time DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [mintAddress, limit]);
    return result.rows;
  }

  private async getTrendData(mintAddress: string) {
    const query = `
      SELECT 
        time_window,
        holder_count_change,
        holder_growth_rate,
        churn_rate
      FROM holder_trends
      WHERE mint_address = $1
        AND time_window = '24h'
      ORDER BY calculated_at DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [mintAddress]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      walletChurn: {
        rate: parseFloat(row.churn_rate) || 0
      }
    };
  }

  private async saveAlert(alert: HolderAlert): Promise<void> {
    const query = `
      INSERT INTO holder_alerts (
        mint_address,
        alert_type,
        severity,
        title,
        message,
        metadata,
        triggered_at,
        acknowledged
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    try {
      const result = await this.pool.query(query, [
        alert.mintAddress,
        alert.alertType,
        alert.severity,
        alert.title,
        alert.message,
        JSON.stringify(alert.metadata || {}),
        alert.triggered_at,
        alert.acknowledged
      ]);

      alert.id = result.rows[0].id;
      logger.info(`Alert saved: ${alert.title} for ${alert.mintAddress}`);
    } catch (error) {
      logger.error('Error saving alert:', error);
    }
  }

  async getActiveAlerts(mintAddress?: string): Promise<HolderAlert[]> {
    let query = `
      SELECT 
        id,
        mint_address as "mintAddress",
        alert_type as "alertType",
        severity,
        title,
        message,
        metadata,
        triggered_at,
        acknowledged
      FROM holder_alerts
      WHERE acknowledged = false
    `;

    const params: any[] = [];
    if (mintAddress) {
      query += ' AND mint_address = $1';
      params.push(mintAddress);
    }

    query += ' ORDER BY triggered_at DESC LIMIT 100';

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async acknowledgeAlert(alertId: number): Promise<void> {
    const query = `
      UPDATE holder_alerts
      SET acknowledged = true,
          acknowledged_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [alertId]);
    logger.info(`Alert ${alertId} acknowledged`);
  }

  async getAlertHistory(
    mintAddress: string,
    period: '24h' | '7d' | '30d' = '7d'
  ): Promise<HolderAlert[]> {
    const periodMs = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };

    const cutoffTime = new Date(Date.now() - periodMs[period]);

    const query = `
      SELECT 
        id,
        mint_address as "mintAddress",
        alert_type as "alertType",
        severity,
        title,
        message,
        metadata,
        triggered_at,
        acknowledged
      FROM holder_alerts
      WHERE mint_address = $1
        AND triggered_at >= $2
      ORDER BY triggered_at DESC
    `;

    const result = await this.pool.query(query, [mintAddress, cutoffTime]);
    return result.rows;
  }
}