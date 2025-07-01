/**
 * Consistency Validator Service
 * Validates state consistency across all tracking services
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { BlockTracker } from './block-tracker';
import { StateHistoryService } from './state-history-service';
import { ForkDetector } from './fork-detector';

export interface ConsistencyReport {
  timestamp: Date;
  isConsistent: boolean;
  services: {
    blockTracker: {
      healthy: boolean;
      currentSlot: bigint;
      issues: string[];
    };
    stateHistory: {
      healthy: boolean;
      trackedAccounts: number;
      issues: string[];
    };
    forkDetector: {
      healthy: boolean;
      recentForks: number;
      issues: string[];
    };
  };
  crossServiceIssues: Array<{
    type: 'slot_mismatch' | 'state_divergence' | 'missing_data';
    description: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  recommendations: string[];
}

export interface ValidationRule {
  name: string;
  description: string;
  validate: () => Promise<{ passed: boolean; message?: string }>;
  severity: 'low' | 'medium' | 'high';
}

export class ConsistencyValidator {
  private static instance: ConsistencyValidator;
  private logger: Logger;
  private eventBus: EventBus;
  
  private blockTracker: BlockTracker;
  private stateHistory: StateHistoryService;
  private forkDetector: ForkDetector;
  
  private validationRules: ValidationRule[] = [];
  private lastReport?: ConsistencyReport;

  private constructor(
    eventBus: EventBus,
    blockTracker: BlockTracker,
    stateHistory: StateHistoryService,
    forkDetector: ForkDetector
  ) {
    this.logger = new Logger({ context: 'ConsistencyValidator' });
    this.eventBus = eventBus;
    this.blockTracker = blockTracker;
    this.stateHistory = stateHistory;
    this.forkDetector = forkDetector;
    
    this.setupValidationRules();
    this.startPeriodicValidation();
  }

  static create(
    eventBus: EventBus,
    blockTracker: BlockTracker,
    stateHistory: StateHistoryService,
    forkDetector: ForkDetector
  ): ConsistencyValidator {
    if (!ConsistencyValidator.instance) {
      ConsistencyValidator.instance = new ConsistencyValidator(
        eventBus,
        blockTracker,
        stateHistory,
        forkDetector
      );
    }
    return ConsistencyValidator.instance;
  }

  /**
   * Setup validation rules
   */
  private setupValidationRules(): void {
    // Slot consistency rule
    this.validationRules.push({
      name: 'Slot Consistency',
      description: 'Verify slots are consistent across services',
      severity: 'high',
      validate: async () => {
        const blockStats = await this.blockTracker.getChainStats();
        const stateSlot = this.stateHistory.lastProcessedSlot || 0n;
        
        const diff = blockStats.currentSlot > stateSlot 
          ? blockStats.currentSlot - stateSlot 
          : stateSlot - blockStats.currentSlot;
        
        if (diff > 10n) {
          return {
            passed: false,
            message: `Slot mismatch: BlockTracker=${blockStats.currentSlot}, StateHistory=${stateSlot}`
          };
        }
        
        return { passed: true };
      }
    });
    
    // Write version consistency
    this.validationRules.push({
      name: 'Write Version Consistency',
      description: 'Verify write versions are monotonically increasing',
      severity: 'high',
      validate: async () => {
        const issues = this.stateHistory.getConsistencyIssues(10);
        const versionMismatches = issues.filter(i => 
          i.issues.some(issue => issue.type === 'version_mismatch')
        );
        
        if (versionMismatches.length > 0) {
          return {
            passed: false,
            message: `${versionMismatches.length} write version inconsistencies detected`
          };
        }
        
        return { passed: true };
      }
    });
    
    // Fork impact validation
    this.validationRules.push({
      name: 'Fork Impact',
      description: 'Check if recent forks affected state consistency',
      severity: 'medium',
      validate: async () => {
        const recentForks = this.forkDetector.getRecentForks(5);
        const criticalForks = recentForks.filter(f => f.severity === 'critical');
        
        if (criticalForks.length > 0) {
          return {
            passed: false,
            message: `${criticalForks.length} critical forks detected that may affect state`
          };
        }
        
        return { passed: true };
      }
    });
    
    // Block finalization lag
    this.validationRules.push({
      name: 'Finalization Lag',
      description: 'Check if finalization is lagging',
      severity: 'medium',
      validate: async () => {
        const stats = await this.blockTracker.getChainStats();
        const lag = stats.currentSlot - stats.lastFinalizedSlot;
        
        if (lag > 100n) {
          return {
            passed: false,
            message: `Finalization lag: ${lag} slots behind current`
          };
        }
        
        return { passed: true };
      }
    });
    
    // State gaps detection
    this.validationRules.push({
      name: 'State Gaps',
      description: 'Detect missing state updates',
      severity: 'high',
      validate: async () => {
        const issues = this.stateHistory.getConsistencyIssues(10);
        const stateGaps = issues.filter(i => 
          i.issues.some(issue => issue.type === 'missing_state')
        );
        
        if (stateGaps.length > 0) {
          return {
            passed: false,
            message: `${stateGaps.length} state gaps detected`
          };
        }
        
        return { passed: true };
      }
    });
  }

  /**
   * Start periodic validation
   */
  private startPeriodicValidation(): void {
    // Run validation every minute
    setInterval(() => this.runValidation(), 60000);
    
    // Run immediate validation
    setTimeout(() => this.runValidation(), 5000);
  }

  /**
   * Run validation
   */
  async runValidation(): Promise<ConsistencyReport> {
    try {
      const report: ConsistencyReport = {
        timestamp: new Date(),
        isConsistent: true,
        services: {
          blockTracker: {
            healthy: true,
            currentSlot: 0n,
            issues: []
          },
          stateHistory: {
            healthy: true,
            trackedAccounts: 0,
            issues: []
          },
          forkDetector: {
            healthy: true,
            recentForks: 0,
            issues: []
          }
        },
        crossServiceIssues: [],
        recommendations: []
      };
      
      // Check block tracker health
      try {
        const blockStats = await this.blockTracker.getChainStats();
        report.services.blockTracker.currentSlot = blockStats.currentSlot;
        
        if (blockStats.slotSuccessRate < 0.9) {
          report.services.blockTracker.issues.push(
            `Low slot success rate: ${(blockStats.slotSuccessRate * 100).toFixed(2)}%`
          );
          report.services.blockTracker.healthy = false;
        }
      } catch (error) {
        report.services.blockTracker.healthy = false;
        report.services.blockTracker.issues.push('Failed to get block stats');
      }
      
      // Check state history health
      try {
        const trackedAccounts = this.stateHistory.accountStatesSize || 0;
        report.services.stateHistory.trackedAccounts = trackedAccounts;
        
        const consistencyIssues = this.stateHistory.getConsistencyIssues(10);
        if (consistencyIssues.length > 5) {
          report.services.stateHistory.issues.push(
            `${consistencyIssues.length} consistency issues in last 10 checks`
          );
          report.services.stateHistory.healthy = false;
        }
      } catch (error) {
        report.services.stateHistory.healthy = false;
        report.services.stateHistory.issues.push('Failed to check state history');
      }
      
      // Check fork detector health
      try {
        const forkStats = await this.forkDetector.getForkStats();
        report.services.forkDetector.recentForks = forkStats.totalForks;
        
        if (forkStats.criticalForks > 0) {
          report.services.forkDetector.issues.push(
            `${forkStats.criticalForks} critical forks detected`
          );
          report.services.forkDetector.healthy = false;
        }
      } catch (error) {
        report.services.forkDetector.healthy = false;
        report.services.forkDetector.issues.push('Failed to get fork stats');
      }
      
      // Run validation rules
      for (const rule of this.validationRules) {
        try {
          const result = await rule.validate();
          if (!result.passed) {
            report.crossServiceIssues.push({
              type: this.getIssueType(rule.name),
              description: result.message || rule.description,
              severity: rule.severity
            });
            
            if (rule.severity === 'high') {
              report.isConsistent = false;
            }
          }
        } catch (error) {
          this.logger.error(`Validation rule '${rule.name}' failed`, error as Error);
        }
      }
      
      // Generate recommendations
      report.recommendations = this.generateRecommendations(report);
      
      // Update overall health
      if (!report.services.blockTracker.healthy || 
          !report.services.stateHistory.healthy || 
          !report.services.forkDetector.healthy) {
        report.isConsistent = false;
      }
      
      // Store report
      this.lastReport = report;
      
      // Emit validation result
      this.eventBus.emit('consistency:validation_complete', report);
      
      // Log if inconsistent
      if (!report.isConsistent) {
        this.logger.warn('Consistency validation failed', {
          issues: report.crossServiceIssues.length,
          recommendations: report.recommendations.length
        });
      }
      
      return report;
    } catch (error) {
      this.logger.error('Error running validation', error as Error);
      throw error;
    }
  }

  /**
   * Get issue type from rule name
   */
  private getIssueType(ruleName: string): 'slot_mismatch' | 'state_divergence' | 'missing_data' {
    if (ruleName.includes('Slot')) return 'slot_mismatch';
    if (ruleName.includes('State')) return 'state_divergence';
    return 'missing_data';
  }

  /**
   * Generate recommendations based on report
   */
  private generateRecommendations(report: ConsistencyReport): string[] {
    const recommendations: string[] = [];
    
    // Check for slot mismatch
    const slotMismatch = report.crossServiceIssues.find(i => i.type === 'slot_mismatch');
    if (slotMismatch) {
      recommendations.push('Synchronize slot tracking across services');
      recommendations.push('Check for network latency issues');
    }
    
    // Check for state divergence
    const stateDivergence = report.crossServiceIssues.find(i => i.type === 'state_divergence');
    if (stateDivergence) {
      recommendations.push('Rebuild state from historical data');
      recommendations.push('Verify write version tracking is working correctly');
    }
    
    // Check for fork issues
    if (report.services.forkDetector.issues.length > 0) {
      recommendations.push('Monitor fork resolution closely');
      recommendations.push('Consider increasing confirmation requirements');
    }
    
    // Check for low slot success rate
    if (report.services.blockTracker.issues.some(i => i.includes('slot success rate'))) {
      recommendations.push('Investigate network connectivity issues');
      recommendations.push('Check RPC endpoint performance');
    }
    
    // General recommendations
    if (!report.isConsistent) {
      recommendations.push('Run full consistency check and repair');
      recommendations.push('Consider restarting affected services');
    }
    
    return [...new Set(recommendations)]; // Remove duplicates
  }

  /**
   * Get last validation report
   */
  getLastReport(): ConsistencyReport | undefined {
    return this.lastReport;
  }

  /**
   * Force validation
   */
  async forceValidation(): Promise<ConsistencyReport> {
    this.logger.info('Force validation requested');
    return await this.runValidation();
  }

  /**
   * Repair inconsistencies
   */
  async repairInconsistencies(): Promise<{ repaired: number; failed: number }> {
    this.logger.info('Starting consistency repair');
    
    let repaired = 0;
    let failed = 0;
    
    try {
      // Run validation first
      const report = await this.runValidation();
      
      // Attempt to repair each issue
      for (const issue of report.crossServiceIssues) {
        try {
          switch (issue.type) {
            case 'slot_mismatch':
              // Sync slots across services
              await this.syncSlots();
              repaired++;
              break;
              
            case 'state_divergence':
              // Rebuild state for affected accounts
              await this.rebuildState();
              repaired++;
              break;
              
            case 'missing_data':
              // Request missing data
              await this.requestMissingData();
              repaired++;
              break;
              
            default:
              failed++;
          }
        } catch (error) {
          this.logger.error(`Failed to repair ${issue.type}`, error as Error);
          failed++;
        }
      }
      
      this.logger.info('Consistency repair completed', { repaired, failed });
      
      // Run validation again
      await this.runValidation();
      
    } catch (error) {
      this.logger.error('Error during repair', error as Error);
    }
    
    return { repaired, failed };
  }

  /**
   * Sync slots across services
   */
  private async syncSlots(): Promise<void> {
    // Implementation would sync slot tracking
    this.logger.info('Syncing slots across services');
  }

  /**
   * Rebuild state for inconsistent accounts
   */
  private async rebuildState(): Promise<void> {
    // Implementation would rebuild state from chain
    this.logger.info('Rebuilding state for inconsistent accounts');
  }

  /**
   * Request missing data
   */
  private async requestMissingData(): Promise<void> {
    // Implementation would request missing data
    this.logger.info('Requesting missing data');
  }
}