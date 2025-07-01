/**
 * Subscription Builder
 * Creates advanced subscription configurations for Shyft gRPC
 */

import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { Logger } from './logger';

export interface SubscriptionFilter {
  memcmp?: {
    offset: number;
    bytes: Uint8Array | string;
  };
  dataSize?: number;
}

export interface AccountSubscriptionOptions {
  owner: string[];
  filters?: SubscriptionFilter[];
  nonemptyTxnSignature?: boolean;
}

export interface TransactionSubscriptionOptions {
  vote?: boolean;
  failed?: boolean;
  accountInclude?: string[];
  accountRequired?: string[];
  accountExclude?: string[];
}

export interface SlotSubscriptionOptions {
  filterByCommitment?: boolean;
}

export interface DataSliceOptions {
  offset: string;
  length: string;
}

export interface SubscriptionConfig {
  transactions?: {
    [key: string]: TransactionSubscriptionOptions;
  };
  accounts?: {
    [key: string]: AccountSubscriptionOptions;
  };
  slots?: {
    slot_updates?: SlotSubscriptionOptions;
  };
  accountsDataSlice?: DataSliceOptions[];
  fromSlot?: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export class SubscriptionBuilder {
  private config: SubscriptionConfig = {};
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ context: 'SubscriptionBuilder' });
  }

  /**
   * Add transaction subscription
   */
  addTransactionSubscription(
    key: string,
    options: TransactionSubscriptionOptions
  ): this {
    if (!this.config.transactions) {
      this.config.transactions = {};
    }
    
    // Ensure all fields are properly initialized
    const cleanOptions: any = {
      vote: options.vote ?? false,
      failed: options.failed ?? false,
      signature: undefined,
      accountInclude: options.accountInclude || [],
      accountExclude: options.accountExclude || [],
      accountRequired: options.accountRequired || []
    };
    
    this.config.transactions[key] = cleanOptions;
    this.logger.debug(`Added transaction subscription: ${key}`, { options: cleanOptions });
    
    return this;
  }

  /**
   * Add account subscription with filters
   */
  addAccountSubscription(
    key: string,
    options: AccountSubscriptionOptions
  ): this {
    if (!this.config.accounts) {
      this.config.accounts = {};
    }
    
    // Ensure filters is an array (not undefined)
    const cleanOptions = {
      ...options,
      filters: options.filters || []
    };
    
    this.config.accounts[key] = cleanOptions;
    this.logger.debug(`Added account subscription: ${key}`, { options: cleanOptions });
    
    return this;
  }

  /**
   * Add slot subscription
   */
  addSlotSubscription(options: SlotSubscriptionOptions = {}): this {
    this.config.slots = {
      slot_updates: {
        filterByCommitment: options.filterByCommitment ?? true
      }
    };
    
    this.logger.debug('Added slot subscription', { options });
    return this;
  }

  /**
   * Add data slicing for bandwidth optimization
   */
  addDataSlice(offset: string, length: string): this {
    if (!this.config.accountsDataSlice) {
      this.config.accountsDataSlice = [];
    }
    
    this.config.accountsDataSlice.push({ offset, length });
    this.logger.debug('Added data slice', { offset, length });
    
    return this;
  }

  /**
   * Set starting slot for historical recovery
   */
  setFromSlot(slot: string | number): this {
    this.config.fromSlot = slot.toString();
    this.logger.debug(`Set fromSlot: ${slot}`);
    return this;
  }

  /**
   * Set commitment level
   */
  setCommitment(commitment: 'processed' | 'confirmed' | 'finalized'): this {
    this.config.commitment = commitment;
    this.logger.debug(`Set commitment: ${commitment}`);
    return this;
  }

  /**
   * Build pump.fun bonding curve subscription
   */
  static buildBondingCurveSubscription(options: {
    includeFailedTxs?: boolean;
    requiredAccounts?: string[];
    trackSlots?: boolean;
    dataSlicing?: boolean;
  } = {}): SubscriptionConfig {
    const builder = new SubscriptionBuilder();
    
    // Transaction subscription
    builder.addTransactionSubscription('pumpfun', {
      vote: false,
      failed: options.includeFailedTxs ?? false,
      accountInclude: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      accountRequired: options.requiredAccounts ?? []
    });
    
    // Account subscription with filters
    builder.addAccountSubscription('pumpfun', {
      owner: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      nonemptyTxnSignature: true
    });
    
    // Slot tracking
    if (options.trackSlots) {
      builder.addSlotSubscription({ filterByCommitment: true });
    }
    
    // Data slicing for bonding curve accounts
    if (options.dataSlicing) {
      // Only get essential bonding curve data (first 165 bytes)
      builder.addDataSlice('0', '165');
    }
    
    return builder.build();
  }

  /**
   * Build AMM pool subscription
   */
  static buildAMMSubscription(options: {
    includeFailedTxs?: boolean;
    trackSlots?: boolean;
  } = {}): SubscriptionConfig {
    const builder = new SubscriptionBuilder();
    
    // Transaction subscription for AMM
    builder.addTransactionSubscription('pumpswap_amm', {
      vote: false,
      failed: options.includeFailedTxs ?? false,
      accountInclude: ['PUMP1chwSxdLCtxakQo2QB6km1GeLM8BNPuADGhoiP5']
    });
    
    // Account subscription for pool states
    builder.addAccountSubscription('pumpAMM', {
      owner: ['PUMP1chwSxdLCtxakQo2QB6km1GeLM8BNPuADGhoiP5'],
      nonemptyTxnSignature: true
    });
    
    // Slot tracking
    if (options.trackSlots) {
      builder.addSlotSubscription({ filterByCommitment: true });
    }
    
    return builder.build();
  }

  /**
   * Build completed bonding curves filter
   */
  static buildCompletedBondingCurvesFilter(): SubscriptionFilter {
    // Complete field is at offset 221 in bonding curve account
    return {
      memcmp: {
        offset: 221,
        bytes: new Uint8Array([1]) // 1 = true for complete
      }
    };
  }

  /**
   * Build active bonding curves filter
   */
  static buildActiveBondingCurvesFilter(): SubscriptionFilter {
    // Complete field is at offset 221 in bonding curve account
    return {
      memcmp: {
        offset: 221,
        bytes: new Uint8Array([0]) // 0 = false for complete
      }
    };
  }

  /**
   * Build filter for specific creator
   */
  static buildCreatorFilter(creatorAddress: string): SubscriptionFilter {
    // Creator field is at offset 32 in bonding curve account
    const creatorBytes = Buffer.from(creatorAddress, 'base64');
    return {
      memcmp: {
        offset: 32,
        bytes: creatorBytes
      }
    };
  }

  /**
   * Convert commitment string to enum
   */
  private getCommitmentLevel(commitment?: string): CommitmentLevel {
    switch (commitment) {
      case 'processed':
        return CommitmentLevel.PROCESSED;
      case 'confirmed':
        return CommitmentLevel.CONFIRMED;
      case 'finalized':
        return CommitmentLevel.FINALIZED;
      default:
        return CommitmentLevel.CONFIRMED;
    }
  }

  /**
   * Get built configuration
   */
  build(): SubscriptionConfig {
    this.logger.info('Built subscription config', { 
      hasTransactions: !!this.config.transactions,
      hasAccounts: !!this.config.accounts,
      hasSlots: !!this.config.slots,
      hasDataSlice: !!this.config.accountsDataSlice
    });
    
    // Ensure all required fields are present for gRPC
    const fullConfig: any = {
      commitment: this.getCommitmentLevel(this.config.commitment),
      accounts: this.config.accounts || {},
      slots: this.config.slots || {},
      transactions: this.config.transactions || {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: this.config.accountsDataSlice || [],
      ping: undefined
    };
    
    // Add optional fields if present
    if (this.config.fromSlot) {
      fullConfig.fromSlot = this.config.fromSlot;
    }
    
    return fullConfig;
  }

  /**
   * Merge multiple subscription configs
   */
  static merge(...configs: SubscriptionConfig[]): SubscriptionConfig {
    const merged: any = {
      commitment: CommitmentLevel.CONFIRMED,
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      ping: undefined
    };
    
    for (const config of configs) {
      // Merge transactions
      if (config.transactions) {
        Object.assign(merged.transactions, config.transactions);
      }
      
      // Merge accounts
      if (config.accounts) {
        Object.assign(merged.accounts, config.accounts);
      }
      
      // Merge slots (last one wins)
      if (config.slots) {
        merged.slots = config.slots;
      }
      
      // Merge data slices
      if (config.accountsDataSlice) {
        merged.accountsDataSlice = [
          ...merged.accountsDataSlice,
          ...config.accountsDataSlice
        ];
      }
      
      // Other fields (last one wins)
      if (config.fromSlot) merged.fromSlot = config.fromSlot;
      if (config.commitment) merged.commitment = config.commitment;
    }
    
    return merged;
  }
}