import { 
  SubscribeRequest,
  SubscribeRequestFilterAccounts,
  SubscribeRequestFilterTransactions,
  CommitmentLevel
} from '@triton-one/yellowstone-grpc';
import { Logger } from '../../core/logger';

const logger = new Logger({ context: 'SubscriptionBuilder' });

export type SubscriptionPriority = 'high' | 'medium' | 'low';
export type MonitorGroup = 'bonding_curve' | 'amm_pool' | 'external_amm';

export interface SubscriptionGroup {
  id: string;
  group: MonitorGroup;
  priority: SubscriptionPriority;
  subscriptions: Map<string, EnhancedSubscription>;
}

export interface EnhancedSubscription {
  id: string;
  monitorId: string;
  monitorType: string;
  group: MonitorGroup;
  priority: SubscriptionPriority;
  request: SubscribeRequest;
  created: Date;
  lastActivity?: Date;
  metrics: {
    messagesReceived: number;
    errors: number;
    lastError?: string;
  };
}

export class SubscriptionBuilder {
  private subscriptionGroups: Map<MonitorGroup, SubscriptionGroup> = new Map();
  private priorityWeights: Map<SubscriptionPriority, number> = new Map([
    ['high', 100],
    ['medium', 50],
    ['low', 10]
  ]);

  constructor() {
    // Initialize subscription groups
    this.initializeGroups();
  }

  private initializeGroups(): void {
    // Bonding Curve group - highest priority
    this.subscriptionGroups.set('bonding_curve', {
      id: 'group-bc',
      group: 'bonding_curve',
      priority: 'high',
      subscriptions: new Map()
    });

    // AMM Pool group - medium priority
    this.subscriptionGroups.set('amm_pool', {
      id: 'group-amm',
      group: 'amm_pool',
      priority: 'medium',
      subscriptions: new Map()
    });

    // External AMM group - low priority (Raydium, etc.)
    this.subscriptionGroups.set('external_amm', {
      id: 'group-external',
      group: 'external_amm',
      priority: 'low',
      subscriptions: new Map()
    });
  }

  /**
   * Create an enhanced subscription with grouping and priority
   */
  createSubscription(
    monitorId: string,
    monitorType: string,
    group: MonitorGroup,
    request: SubscribeRequest
  ): EnhancedSubscription {
    const subscriptionGroup = this.subscriptionGroups.get(group);
    if (!subscriptionGroup) {
      throw new Error(`Invalid subscription group: ${group}`);
    }

    const subscription: EnhancedSubscription = {
      id: `sub-${monitorId}-${Date.now()}`,
      monitorId,
      monitorType,
      group,
      priority: subscriptionGroup.priority,
      request,
      created: new Date(),
      metrics: {
        messagesReceived: 0,
        errors: 0
      }
    };

    subscriptionGroup.subscriptions.set(subscription.id, subscription);
    logger.info('Created enhanced subscription', {
      id: subscription.id,
      monitorId,
      group,
      priority: subscription.priority
    });

    return subscription;
  }

  /**
   * Build subscription request for transactions
   */
  buildTransactionSubscription(
    programIds: string[],
    accountKeys?: string[]
  ): SubscribeRequest {
    const filters: SubscribeRequestFilterTransactions = {
      vote: false,
      failed: false,
      accountInclude: programIds.map(id => id),
      accountRequired: accountKeys || [],
      accountExclude: []
    };

    return {
      accounts: {},
      blocks: {},
      blocksMeta: {},
      transactions: {
        filter: filters
      },
      transactionsStatus: {},
      slots: {},
      entry: {},
      commitment: CommitmentLevel.PROCESSED,
      accountsDataSlice: [],
      ping: undefined
    };
  }

  /**
   * Build subscription request for accounts
   */
  buildAccountSubscription(
    ownerPrograms: string[],
    accountKeys?: string[]
  ): SubscribeRequest {
    const filters: SubscribeRequestFilterAccounts = {
      account: accountKeys || [],
      owner: ownerPrograms,
      filters: []
    };

    return {
      accounts: {
        filter: filters
      },
      blocks: {},
      blocksMeta: {},
      transactions: {},
      transactionsStatus: {},
      slots: {},
      entry: {},
      commitment: CommitmentLevel.PROCESSED,
      accountsDataSlice: [],
      ping: undefined
    };
  }

  /**
   * Merge multiple subscriptions into a single optimized request
   */
  mergeSubscriptions(subscriptions: EnhancedSubscription[]): SubscribeRequest {
    const mergedRequest: SubscribeRequest = {
      accounts: {},
      blocks: {},
      blocksMeta: {},
      transactions: {},
      transactionsStatus: {},
      slots: {},
      entry: {},
      commitment: CommitmentLevel.PROCESSED,
      accountsDataSlice: [],
      ping: undefined
    };

    // Collect all filters
    const transactionPrograms = new Set<string>();
    const transactionAccounts = new Set<string>();
    const accountOwners = new Set<string>();
    const accountKeys = new Set<string>();

    for (const sub of subscriptions) {
      const req = sub.request;

      // Merge transaction filters
      if (req.transactions && req.transactions.filter) {
        const filter = req.transactions.filter;
        filter.accountInclude?.forEach(acc => transactionPrograms.add(acc));
        filter.accountRequired?.forEach(acc => transactionAccounts.add(acc));
      }

      // Merge account filters
      if (req.accounts && req.accounts.filter) {
        const filter = req.accounts.filter;
        filter.owner?.forEach(owner => accountOwners.add(owner));
        filter.account?.forEach(acc => accountKeys.add(acc));
      }
    }

    // Build merged filters
    if (transactionPrograms.size > 0 || transactionAccounts.size > 0) {
      mergedRequest.transactions = {
        filter: {
          vote: false,
          failed: false,
          accountInclude: Array.from(transactionPrograms),
          accountRequired: Array.from(transactionAccounts),
          accountExclude: []
        }
      };
    }

    if (accountOwners.size > 0 || accountKeys.size > 0) {
      mergedRequest.accounts = {
        filter: {
          account: Array.from(accountKeys),
          owner: Array.from(accountOwners),
          filters: []
        }
      };
    }

    logger.info('Merged subscriptions', {
      originalCount: subscriptions.length,
      transactionPrograms: transactionPrograms.size,
      accountOwners: accountOwners.size
    });

    return mergedRequest;
  }

  /**
   * Get subscription groups by priority
   */
  getGroupsByPriority(): SubscriptionGroup[] {
    return Array.from(this.subscriptionGroups.values())
      .sort((a, b) => {
        const weightA = this.priorityWeights.get(a.priority) || 0;
        const weightB = this.priorityWeights.get(b.priority) || 0;
        return weightB - weightA; // Higher weight first
      });
  }

  /**
   * Calculate optimal connection assignment for groups
   */
  assignGroupsToConnections(connectionCount: number): Map<string, MonitorGroup[]> {
    const assignments = new Map<string, MonitorGroup[]>();
    const groups = this.getGroupsByPriority();

    // Initialize connections
    for (let i = 0; i < connectionCount; i++) {
      assignments.set(`connection-${i}`, []);
    }

    // Assign high priority groups to dedicated connections if possible
    let connectionIndex = 0;
    for (const group of groups) {
      const connectionId = `connection-${connectionIndex % connectionCount}`;
      const assigned = assignments.get(connectionId) || [];
      assigned.push(group.group);
      assignments.set(connectionId, assigned);

      // High priority groups get dedicated connections if available
      if (group.priority === 'high' && connectionIndex < connectionCount - 1) {
        connectionIndex++;
      } else if (group.priority === 'medium' && assigned.length === 1) {
        connectionIndex++;
      }
      // Low priority groups share connections
    }

    logger.info('Assigned groups to connections', {
      connectionCount,
      assignments: Array.from(assignments.entries()).map(([conn, groups]) => ({
        connection: conn,
        groups
      }))
    });

    return assignments;
  }

  /**
   * Update subscription metrics
   */
  updateMetrics(subscriptionId: string, event: 'message' | 'error', error?: string): void {
    for (const group of this.subscriptionGroups.values()) {
      const subscription = group.subscriptions.get(subscriptionId);
      if (subscription) {
        subscription.lastActivity = new Date();
        if (event === 'message') {
          subscription.metrics.messagesReceived++;
        } else if (event === 'error') {
          subscription.metrics.errors++;
          if (error) {
            subscription.metrics.lastError = error;
          }
        }
        break;
      }
    }
  }

  /**
   * Get subscription statistics
   */
  getStatistics(): {
    groups: Array<{
      group: MonitorGroup;
      priority: SubscriptionPriority;
      subscriptionCount: number;
      totalMessages: number;
      totalErrors: number;
    }>;
    total: {
      subscriptions: number;
      messages: number;
      errors: number;
    };
  } {
    const groupStats = Array.from(this.subscriptionGroups.entries()).map(([group, data]) => {
      let totalMessages = 0;
      let totalErrors = 0;

      for (const sub of data.subscriptions.values()) {
        totalMessages += sub.metrics.messagesReceived;
        totalErrors += sub.metrics.errors;
      }

      return {
        group,
        priority: data.priority,
        subscriptionCount: data.subscriptions.size,
        totalMessages,
        totalErrors
      };
    });

    const total = groupStats.reduce(
      (acc, stat) => ({
        subscriptions: acc.subscriptions + stat.subscriptionCount,
        messages: acc.messages + stat.totalMessages,
        errors: acc.errors + stat.totalErrors
      }),
      { subscriptions: 0, messages: 0, errors: 0 }
    );

    return { groups: groupStats, total };
  }

  /**
   * Remove inactive subscriptions
   */
  cleanupInactiveSubscriptions(maxInactiveMinutes: number = 30): number {
    const now = new Date();
    const maxInactiveMs = maxInactiveMinutes * 60 * 1000;
    let removedCount = 0;

    for (const group of this.subscriptionGroups.values()) {
      const toRemove: string[] = [];

      for (const [id, sub] of group.subscriptions) {
        const lastActivity = sub.lastActivity || sub.created;
        const inactiveMs = now.getTime() - lastActivity.getTime();

        if (inactiveMs > maxInactiveMs) {
          toRemove.push(id);
        }
      }

      for (const id of toRemove) {
        group.subscriptions.delete(id);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info(`Cleaned up ${removedCount} inactive subscriptions`);
    }

    return removedCount;
  }
}

// Export singleton instance
export const subscriptionBuilder = new SubscriptionBuilder();