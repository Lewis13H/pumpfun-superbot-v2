/**
 * Congestion Monitor Service
 * Monitors network congestion patterns and their impact on transaction failures
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { FailedTransaction } from './failed-tx-analyzer';

export type CongestionLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface CongestionMetrics {
  slot: bigint;
  timestamp: Date;
  level: CongestionLevel;
  totalTransactions: number;
  failedTransactions: number;
  failureRate: number;
  avgComputeUnits: number;
  maxComputeUnits: number;
  avgFee: number;
  maxFee: number;
  tps: number; // transactions per second
  blockTime: number; // milliseconds
}

export interface CongestionPattern {
  timeWindow: {
    start: Date;
    end: Date;
  };
  avgFailureRate: number;
  peakFailureRate: number;
  avgTPS: number;
  peakTPS: number;
  congestionPeriods: Array<{
    start: Date;
    end: Date;
    level: CongestionLevel;
    duration: number; // minutes
  }>;
  recommendations: string[];
}

export interface CongestionAlert {
  type: 'congestion_started' | 'congestion_ended' | 'extreme_congestion';
  level: CongestionLevel;
  slot: bigint;
  timestamp: Date;
  metrics: CongestionMetrics;
  message: string;
}

export class CongestionMonitor {
  private static instance: CongestionMonitor;
  private logger: Logger;
  private eventBus: EventBus;
  
  private slotMetrics: Map<bigint, CongestionMetrics> = new Map();
  private recentMetrics: CongestionMetrics[] = [];
  private congestionAlerts: CongestionAlert[] = [];
  private currentCongestionLevel: CongestionLevel = 'low';
  private congestionStartTime?: Date;
  
  // Thresholds
  private readonly FAILURE_RATE_THRESHOLDS = {
    low: 0.05,      // < 5% failures
    medium: 0.15,   // 5-15% failures
    high: 0.30,     // 15-30% failures
    extreme: 0.50   // > 50% failures
  };
  
  private readonly TPS_THRESHOLDS = {
    low: 1000,      // < 1000 TPS
    medium: 2000,   // 1000-2000 TPS
    high: 3000,     // 2000-3000 TPS
    extreme: 4000   // > 4000 TPS
  };

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'CongestionMonitor' });
    this.eventBus = eventBus;
    
    // Start periodic analysis
    setInterval(() => this.analyzeCurrentCongestion(), 5000); // Every 5 seconds
    setInterval(() => this.analyzeCongestionPatterns(), 60000); // Every minute
    setInterval(() => this.cleanupOldData(), 3600000); // Every hour
  }

  static getInstance(eventBus: EventBus): CongestionMonitor {
    if (!CongestionMonitor.instance) {
      CongestionMonitor.instance = new CongestionMonitor(eventBus);
    }
    return CongestionMonitor.instance;
  }

  /**
   * Track slot metrics
   */
  trackSlotMetrics(
    slot: bigint,
    totalTxs: number,
    failedTxs: number,
    computeUnits?: number[],
    fees?: number[]
  ): void {
    try {
      const timestamp = new Date();
      const failureRate = totalTxs > 0 ? failedTxs / totalTxs : 0;
      
      // Calculate averages
      const avgComputeUnits = computeUnits && computeUnits.length > 0
        ? computeUnits.reduce((a, b) => a + b, 0) / computeUnits.length
        : 0;
      
      const maxComputeUnits = computeUnits && computeUnits.length > 0
        ? Math.max(...computeUnits)
        : 0;
      
      const avgFee = fees && fees.length > 0
        ? fees.reduce((a, b) => a + b, 0) / fees.length
        : 0;
      
      const maxFee = fees && fees.length > 0
        ? Math.max(...fees)
        : 0;
      
      // Calculate TPS (approximate based on slot time)
      const prevSlot = slot - 1n;
      const prevMetrics = this.slotMetrics.get(prevSlot);
      const blockTime = prevMetrics 
        ? timestamp.getTime() - prevMetrics.timestamp.getTime()
        : 400; // Default 400ms slot time
      
      const tps = blockTime > 0 ? (totalTxs / blockTime) * 1000 : 0;
      
      // Determine congestion level
      const level = this.determineCongestionLevel(failureRate, tps);
      
      const metrics: CongestionMetrics = {
        slot,
        timestamp,
        level,
        totalTransactions: totalTxs,
        failedTransactions: failedTxs,
        failureRate,
        avgComputeUnits,
        maxComputeUnits,
        avgFee,
        maxFee,
        tps,
        blockTime
      };
      
      this.slotMetrics.set(slot, metrics);
      this.recentMetrics.push(metrics);
      
      // Keep only recent metrics
      if (this.recentMetrics.length > 1000) {
        this.recentMetrics.shift();
      }
      
      // Check for congestion changes
      this.checkCongestionChange(metrics);
      
    } catch (error) {
      this.logger.error('Error tracking slot metrics', error as Error);
    }
  }

  /**
   * Track failed transaction for congestion analysis
   */
  trackFailedTransaction(failedTx: FailedTransaction): void {
    try {
      const slot = failedTx.slot;
      const metrics = this.slotMetrics.get(slot);
      
      if (metrics) {
        // Update failed count
        metrics.failedTransactions++;
        metrics.failureRate = metrics.totalTransactions > 0
          ? metrics.failedTransactions / metrics.totalTransactions
          : 0;
        
        // Re-evaluate congestion level
        metrics.level = this.determineCongestionLevel(metrics.failureRate, metrics.tps);
      }
    } catch (error) {
      // Silent error
    }
  }

  /**
   * Determine congestion level based on metrics
   */
  private determineCongestionLevel(failureRate: number, tps: number): CongestionLevel {
    // Check failure rate first (more important indicator)
    if (failureRate >= this.FAILURE_RATE_THRESHOLDS.extreme) return 'extreme';
    if (failureRate >= this.FAILURE_RATE_THRESHOLDS.high) return 'high';
    if (failureRate >= this.FAILURE_RATE_THRESHOLDS.medium) return 'medium';
    
    // Then check TPS
    if (tps >= this.TPS_THRESHOLDS.extreme) return 'extreme';
    if (tps >= this.TPS_THRESHOLDS.high) return 'high';
    if (tps >= this.TPS_THRESHOLDS.medium) return 'medium';
    
    return 'low';
  }

  /**
   * Check for congestion level changes
   */
  private checkCongestionChange(metrics: CongestionMetrics): void {
    const previousLevel = this.currentCongestionLevel;
    const newLevel = metrics.level;
    
    if (newLevel !== previousLevel) {
      this.currentCongestionLevel = newLevel;
      
      if (this.getCongestionScore(newLevel) > this.getCongestionScore(previousLevel)) {
        // Congestion increased
        if (!this.congestionStartTime) {
          this.congestionStartTime = metrics.timestamp;
        }
        
        const alert: CongestionAlert = {
          type: newLevel === 'extreme' ? 'extreme_congestion' : 'congestion_started',
          level: newLevel,
          slot: metrics.slot,
          timestamp: metrics.timestamp,
          metrics,
          message: `Network congestion increased to ${newLevel} level`
        };
        
        this.congestionAlerts.push(alert);
        this.eventBus.emit('congestion:alert', alert);
        
        this.logger.warn('Congestion level increased', {
          previousLevel,
          newLevel,
          failureRate: (metrics.failureRate * 100).toFixed(2) + '%',
          tps: metrics.tps.toFixed(0)
        });
        
      } else if (newLevel === 'low' && previousLevel !== 'low') {
        // Congestion ended
        const duration = this.congestionStartTime
          ? (metrics.timestamp.getTime() - this.congestionStartTime.getTime()) / 1000 / 60
          : 0;
        
        const alert: CongestionAlert = {
          type: 'congestion_ended',
          level: newLevel,
          slot: metrics.slot,
          timestamp: metrics.timestamp,
          metrics,
          message: `Network congestion ended after ${duration.toFixed(1)} minutes`
        };
        
        this.congestionAlerts.push(alert);
        this.eventBus.emit('congestion:alert', alert);
        
        this.congestionStartTime = undefined;
        
        this.logger.info('Congestion ended', {
          duration: duration.toFixed(1) + ' minutes',
          currentFailureRate: (metrics.failureRate * 100).toFixed(2) + '%'
        });
      }
    }
  }

  /**
   * Get congestion score for comparison
   */
  private getCongestionScore(level: CongestionLevel): number {
    const scores = { low: 0, medium: 1, high: 2, extreme: 3 };
    return scores[level];
  }

  /**
   * Analyze current congestion
   */
  private async analyzeCurrentCongestion(): Promise<void> {
    try {
      const recentSlots = this.recentMetrics.slice(-10); // Last 10 slots
      if (recentSlots.length === 0) return;
      
      // Calculate moving averages
      const avgFailureRate = recentSlots.reduce((sum, m) => sum + m.failureRate, 0) / recentSlots.length;
      const avgTPS = recentSlots.reduce((sum, m) => sum + m.tps, 0) / recentSlots.length;
      
      // Emit current status
      this.eventBus.emit('congestion:status', {
        currentLevel: this.currentCongestionLevel,
        avgFailureRate,
        avgTPS,
        recentSlots: recentSlots.length,
        inCongestion: this.currentCongestionLevel !== 'low',
        congestionDuration: this.congestionStartTime
          ? (Date.now() - this.congestionStartTime.getTime()) / 1000 / 60
          : 0
      });
    } catch (error) {
      this.logger.error('Error analyzing congestion', error as Error);
    }
  }

  /**
   * Analyze congestion patterns over time
   */
  private async analyzeCongestionPatterns(): Promise<void> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      // Get metrics from last hour
      const hourlyMetrics = this.recentMetrics.filter(m => 
        m.timestamp > oneHourAgo
      );
      
      if (hourlyMetrics.length === 0) return;
      
      // Identify congestion periods
      const congestionPeriods: CongestionPattern['congestionPeriods'] = [];
      let currentPeriod: typeof congestionPeriods[0] | null = null;
      
      for (const metrics of hourlyMetrics) {
        if (metrics.level !== 'low') {
          if (!currentPeriod) {
            currentPeriod = {
              start: metrics.timestamp,
              end: metrics.timestamp,
              level: metrics.level,
              duration: 0
            };
          } else {
            currentPeriod.end = metrics.timestamp;
            // Update to highest level seen
            if (this.getCongestionScore(metrics.level) > this.getCongestionScore(currentPeriod.level)) {
              currentPeriod.level = metrics.level;
            }
          }
        } else if (currentPeriod) {
          // Congestion ended
          currentPeriod.duration = (currentPeriod.end.getTime() - currentPeriod.start.getTime()) / 1000 / 60;
          congestionPeriods.push(currentPeriod);
          currentPeriod = null;
        }
      }
      
      // Add ongoing congestion period
      if (currentPeriod) {
        currentPeriod.duration = (currentPeriod.end.getTime() - currentPeriod.start.getTime()) / 1000 / 60;
        congestionPeriods.push(currentPeriod);
      }
      
      // Calculate pattern statistics
      const avgFailureRate = hourlyMetrics.reduce((sum, m) => sum + m.failureRate, 0) / hourlyMetrics.length;
      const peakFailureRate = Math.max(...hourlyMetrics.map(m => m.failureRate));
      const avgTPS = hourlyMetrics.reduce((sum, m) => sum + m.tps, 0) / hourlyMetrics.length;
      const peakTPS = Math.max(...hourlyMetrics.map(m => m.tps));
      
      // Generate recommendations
      const recommendations: string[] = [];
      
      if (peakFailureRate > 0.3) {
        recommendations.push('Consider implementing retry logic with exponential backoff');
      }
      
      if (avgFailureRate > 0.15) {
        recommendations.push('Increase slippage tolerance during high congestion periods');
      }
      
      if (congestionPeriods.length > 5) {
        recommendations.push('Monitor for recurring congestion patterns at specific times');
      }
      
      if (peakTPS > 3000) {
        recommendations.push('Use priority fees during peak TPS periods');
      }
      
      const pattern: CongestionPattern = {
        timeWindow: { start: oneHourAgo, end: now },
        avgFailureRate,
        peakFailureRate,
        avgTPS,
        peakTPS,
        congestionPeriods,
        recommendations
      };
      
      this.eventBus.emit('congestion:pattern_analyzed', pattern);
    } catch (error) {
      this.logger.error('Error analyzing patterns', error as Error);
    }
  }

  /**
   * Get current congestion status
   */
  getCurrentStatus() {
    const recent = this.recentMetrics.slice(-10);
    const avgFailureRate = recent.length > 0
      ? recent.reduce((sum, m) => sum + m.failureRate, 0) / recent.length
      : 0;
    
    const avgTPS = recent.length > 0
      ? recent.reduce((sum, m) => sum + m.tps, 0) / recent.length
      : 0;
    
    return {
      currentLevel: this.currentCongestionLevel,
      avgFailureRate,
      avgTPS,
      inCongestion: this.currentCongestionLevel !== 'low',
      congestionDuration: this.congestionStartTime
        ? (Date.now() - this.congestionStartTime.getTime()) / 1000 / 60
        : 0,
      recentAlerts: this.congestionAlerts.slice(-10)
    };
  }

  /**
   * Get congestion statistics
   */
  getCongestionStats() {
    const totalSlots = this.slotMetrics.size;
    const congestionCounts = { low: 0, medium: 0, high: 0, extreme: 0 };
    
    for (const metrics of this.slotMetrics.values()) {
      congestionCounts[metrics.level]++;
    }
    
    return {
      totalSlots,
      congestionDistribution: congestionCounts,
      congestionRate: totalSlots > 0
        ? ((congestionCounts.medium + congestionCounts.high + congestionCounts.extreme) / totalSlots) * 100
        : 0,
      totalAlerts: this.congestionAlerts.length,
      currentLevel: this.currentCongestionLevel
    };
  }

  /**
   * Get recommendations based on current congestion
   */
  getRecommendations(): string[] {
    const recommendations: string[] = [];
    
    switch (this.currentCongestionLevel) {
      case 'extreme':
        recommendations.push('Pause non-critical transactions');
        recommendations.push('Use maximum priority fees');
        recommendations.push('Increase slippage to 20-30%');
        break;
      case 'high':
        recommendations.push('Use priority fees for important transactions');
        recommendations.push('Increase slippage to 10-15%');
        recommendations.push('Implement retry logic');
        break;
      case 'medium':
        recommendations.push('Monitor transaction success rates');
        recommendations.push('Consider using priority fees');
        recommendations.push('Set slippage to 5-10%');
        break;
      case 'low':
        recommendations.push('Normal operations');
        recommendations.push('Standard slippage settings (1-3%)');
        break;
    }
    
    return recommendations;
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    // Clean up slot metrics
    const slotsToRemove: bigint[] = [];
    for (const [slot, metrics] of this.slotMetrics) {
      if (metrics.timestamp.getTime() < oneHourAgo) {
        slotsToRemove.push(slot);
      }
    }
    
    slotsToRemove.forEach(slot => this.slotMetrics.delete(slot));
    
    // Clean up recent metrics
    this.recentMetrics = this.recentMetrics.filter(m => 
      m.timestamp.getTime() > oneHourAgo
    );
    
    // Keep only recent alerts
    if (this.congestionAlerts.length > 100) {
      this.congestionAlerts = this.congestionAlerts.slice(-100);
    }
    
    this.logger.debug('Cleaned up congestion data', {
      removedSlots: slotsToRemove.length,
      remainingMetrics: this.recentMetrics.length
    });
  }
}