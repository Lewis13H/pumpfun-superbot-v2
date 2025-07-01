/**
 * Commitment Strategy Service
 * Manages commitment levels for different operation types
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';

export type CommitmentLevel = 'processed' | 'confirmed' | 'finalized';

export interface CommitmentConfig {
  defaultLevel: CommitmentLevel;
  fastMode: boolean;
  criticalOperations: string[];
  timeoutByLevel: {
    processed: number;
    confirmed: number;
    finalized: number;
  };
}

export interface OperationContext {
  type: 'trade' | 'account_update' | 'pool_state' | 'critical' | 'query';
  operation: string;
  priority: 'low' | 'medium' | 'high';
  retryable: boolean;
}

export interface CommitmentRecommendation {
  level: CommitmentLevel;
  timeout: number;
  retries: number;
  fallbackLevel?: CommitmentLevel;
  reason: string;
}

export class CommitmentStrategy {
  private static instance: CommitmentStrategy;
  private logger: Logger;
  private eventBus: EventBus;
  
  private config: CommitmentConfig;
  private performanceMetrics: Map<string, number[]> = new Map();
  private successRates: Map<CommitmentLevel, number> = new Map();
  
  private constructor(eventBus: EventBus, config?: Partial<CommitmentConfig>) {
    this.logger = new Logger({ context: 'CommitmentStrategy' });
    this.eventBus = eventBus;
    
    // Default configuration
    this.config = {
      defaultLevel: 'confirmed',
      fastMode: false,
      criticalOperations: ['tokenTransfer', 'poolCreation', 'graduation'],
      timeoutByLevel: {
        processed: 5000,    // 5 seconds
        confirmed: 10000,   // 10 seconds
        finalized: 30000    // 30 seconds
      },
      ...config
    };
    
    this.initializeMetrics();
    this.setupEventListeners();
  }

  static create(eventBus: EventBus, config?: Partial<CommitmentConfig>): CommitmentStrategy {
    if (!CommitmentStrategy.instance) {
      CommitmentStrategy.instance = new CommitmentStrategy(eventBus, config);
    }
    return CommitmentStrategy.instance;
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): void {
    this.successRates.set('processed', 0.95);  // Assume 95% success initially
    this.successRates.set('confirmed', 0.98);
    this.successRates.set('finalized', 1.0);
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for performance updates
    this.eventBus.on('commitment:success', this.handleSuccess.bind(this));
    this.eventBus.on('commitment:failure', this.handleFailure.bind(this));
    
    // Listen for network conditions
    this.eventBus.on('network:congestion', this.handleCongestion.bind(this));
  }

  /**
   * Get commitment level for trading operations
   */
  getTradingCommitment(): CommitmentRecommendation {
    const context: OperationContext = {
      type: 'trade',
      operation: 'trade_monitoring',
      priority: 'high',
      retryable: true
    };
    
    return this.getRecommendation(context);
  }

  /**
   * Get commitment level for account updates
   */
  getAccountUpdateCommitment(): CommitmentRecommendation {
    const context: OperationContext = {
      type: 'account_update',
      operation: 'account_state_tracking',
      priority: 'medium',
      retryable: true
    };
    
    return this.getRecommendation(context);
  }

  /**
   * Get commitment level for critical operations
   */
  getSettlementCommitment(): CommitmentRecommendation {
    const context: OperationContext = {
      type: 'critical',
      operation: 'settlement',
      priority: 'high',
      retryable: false
    };
    
    return this.getRecommendation(context);
  }

  /**
   * Get commitment recommendation based on context
   */
  getRecommendation(context: OperationContext): CommitmentRecommendation {
    let level: CommitmentLevel;
    let reason: string;
    
    // Critical operations always use finalized
    if (context.type === 'critical' || this.config.criticalOperations.includes(context.operation)) {
      level = 'finalized';
      reason = 'Critical operation requires finalized commitment';
    }
    // Fast mode for time-sensitive operations
    else if (this.config.fastMode && context.priority === 'high') {
      level = 'processed';
      reason = 'Fast mode enabled for high priority operation';
    }
    // Account updates can use confirmed
    else if (context.type === 'account_update') {
      level = 'confirmed';
      reason = 'Account updates use confirmed for balance';
    }
    // Queries can use processed
    else if (context.type === 'query') {
      level = 'processed';
      reason = 'Queries can use processed for speed';
    }
    // Default based on performance
    else {
      level = this.selectOptimalLevel(context);
      reason = 'Selected based on current performance metrics';
    }
    
    // Get timeout and retries
    const timeout = this.config.timeoutByLevel[level];
    const retries = this.getRetryCount(level, context);
    
    // Determine fallback
    const fallbackLevel = this.getFallbackLevel(level);
    
    return {
      level,
      timeout,
      retries,
      fallbackLevel,
      reason
    };
  }

  /**
   * Select optimal commitment level based on performance
   */
  private selectOptimalLevel(context: OperationContext): CommitmentLevel {
    const processedRate = this.successRates.get('processed') || 0.95;
    const confirmedRate = this.successRates.get('confirmed') || 0.98;
    
    // If processed has high success rate and operation is retryable
    if (processedRate > 0.93 && context.retryable && context.priority !== 'low') {
      return 'processed';
    }
    
    // If confirmed has good success rate
    if (confirmedRate > 0.95) {
      return 'confirmed';
    }
    
    // Default to finalized for reliability
    return 'finalized';
  }

  /**
   * Get retry count based on level and context
   */
  private getRetryCount(level: CommitmentLevel, context: OperationContext): number {
    if (!context.retryable) return 0;
    
    switch (level) {
      case 'processed':
        return 3; // More retries for less reliable level
      case 'confirmed':
        return 2;
      case 'finalized':
        return 1; // Fewer retries needed
      default:
        return 2;
    }
  }

  /**
   * Get fallback commitment level
   */
  private getFallbackLevel(level: CommitmentLevel): CommitmentLevel | undefined {
    switch (level) {
      case 'processed':
        return 'confirmed';
      case 'confirmed':
        return 'finalized';
      case 'finalized':
        return undefined; // No fallback from finalized
      default:
        return 'confirmed';
    }
  }

  /**
   * Handle successful operation
   */
  private handleSuccess(event: any): void {
    const level = event.commitmentLevel as CommitmentLevel;
    const currentRate = this.successRates.get(level) || 0.95;
    
    // Update success rate with exponential moving average
    const newRate = currentRate * 0.95 + 1 * 0.05;
    this.successRates.set(level, Math.min(newRate, 1.0));
    
    // Track latency
    if (event.latency) {
      const key = `${level}_latency`;
      if (!this.performanceMetrics.has(key)) {
        this.performanceMetrics.set(key, []);
      }
      
      const metrics = this.performanceMetrics.get(key)!;
      metrics.push(event.latency);
      
      // Keep only recent metrics
      if (metrics.length > 100) {
        this.performanceMetrics.set(key, metrics.slice(-100));
      }
    }
  }

  /**
   * Handle failed operation
   */
  private handleFailure(event: any): void {
    const level = event.commitmentLevel as CommitmentLevel;
    const currentRate = this.successRates.get(level) || 0.95;
    
    // Update success rate
    const newRate = currentRate * 0.95 + 0 * 0.05;
    this.successRates.set(level, Math.max(newRate, 0.5));
    
    this.logger.debug('Commitment failure recorded', {
      level,
      newSuccessRate: newRate,
      error: event.error
    });
  }

  /**
   * Handle network congestion
   */
  private handleCongestion(event: any): void {
    const congestionLevel = event.level || 'medium';
    
    // Adjust fast mode based on congestion
    if (congestionLevel === 'high') {
      this.config.fastMode = false;
      this.logger.info('Disabled fast mode due to high congestion');
    } else if (congestionLevel === 'low') {
      this.config.fastMode = true;
      this.logger.info('Enabled fast mode due to low congestion');
    }
  }

  /**
   * Get current performance stats
   */
  getPerformanceStats(): {
    successRates: Record<CommitmentLevel, number>;
    averageLatencies: Record<CommitmentLevel, number>;
    recommendations: string[];
  } {
    const averageLatencies: Record<CommitmentLevel, number> = {
      processed: 0,
      confirmed: 0,
      finalized: 0
    };
    
    // Calculate average latencies
    for (const level of ['processed', 'confirmed', 'finalized'] as CommitmentLevel[]) {
      const key = `${level}_latency`;
      const metrics = this.performanceMetrics.get(key) || [];
      
      if (metrics.length > 0) {
        averageLatencies[level] = metrics.reduce((a, b) => a + b, 0) / metrics.length;
      }
    }
    
    // Generate recommendations
    const recommendations: string[] = [];
    
    const processedRate = this.successRates.get('processed') || 0;
    if (processedRate < 0.9) {
      recommendations.push('Consider using confirmed level due to low processed success rate');
    }
    
    if (averageLatencies.finalized > 20000) {
      recommendations.push('High finalized latency detected, check network conditions');
    }
    
    if (this.config.fastMode && processedRate < 0.85) {
      recommendations.push('Disable fast mode due to poor processed performance');
    }
    
    return {
      successRates: Object.fromEntries(this.successRates) as Record<CommitmentLevel, number>,
      averageLatencies,
      recommendations
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CommitmentConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Commitment strategy config updated', this.config);
  }

  /**
   * Check if operation is critical
   */
  isCriticalOperation(operation: string): boolean {
    return this.config.criticalOperations.includes(operation);
  }

  /**
   * Add critical operation
   */
  addCriticalOperation(operation: string): void {
    if (!this.config.criticalOperations.includes(operation)) {
      this.config.criticalOperations.push(operation);
      this.logger.info('Added critical operation', { operation });
    }
  }
}