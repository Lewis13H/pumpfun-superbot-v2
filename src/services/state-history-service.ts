/**
 * State History Service
 * Tracks account state changes and enables historical state reconstruction
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { db } from '../database';
import bs58 from 'bs58';

export interface AccountState {
  pubkey: string;
  owner: string;
  lamports: bigint;
  data: Buffer;
  executable: boolean;
  rentEpoch: bigint;
  writeVersion: bigint;
  slot: bigint;
  blockTime: number;
}

export interface StateChange {
  pubkey: string;
  slot: bigint;
  writeVersion: bigint;
  previousWriteVersion?: bigint;
  changeType: 'create' | 'update' | 'delete';
  dataHash: string;
  lamportsDelta: bigint;
  owner: string;
  program: string;
  instruction?: string;
  signature?: string;
}

export interface StateSnapshot {
  slot: bigint;
  timestamp: Date;
  accounts: Map<string, AccountState>;
  totalAccounts: number;
  totalLamports: bigint;
  programBreakdown: Map<string, number>;
}

export interface ConsistencyCheck {
  slot: bigint;
  timestamp: Date;
  isConsistent: boolean;
  issues: Array<{
    type: 'missing_state' | 'version_mismatch' | 'invalid_transition';
    account: string;
    details: string;
  }>;
}

export class StateHistoryService {
  private static instance: StateHistoryService;
  private logger: Logger;
  private eventBus: EventBus;
  
  private accountStates: Map<string, AccountState> = new Map();
  private stateChanges: Map<string, StateChange[]> = new Map();
  private writeVersions: Map<string, bigint> = new Map();
  public lastProcessedSlot: bigint = 0n;
  
  // Consistency tracking
  private pendingWrites: Map<string, StateChange> = new Map();
  private inconsistencies: ConsistencyCheck[] = [];

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'StateHistoryService' });
    this.eventBus = eventBus;
    
    this.setupEventListeners();
    this.startPeriodicTasks();
  }

  static async create(eventBus: EventBus): Promise<StateHistoryService> {
    if (!StateHistoryService.instance) {
      StateHistoryService.instance = new StateHistoryService(eventBus);
      await StateHistoryService.instance.initialize();
    }
    return StateHistoryService.instance;
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    await this.createTables();
    await this.loadRecentStates();
    
    this.logger.info('State history service initialized', {
      trackedAccounts: this.accountStates.size,
      lastSlot: this.lastProcessedSlot.toString()
    });
  }

  /**
   * Create required database tables
   */
  private async createTables(): Promise<void> {
    try {
      // Account state history
      await db.query(`
        CREATE TABLE IF NOT EXISTS account_state_history (
          id SERIAL PRIMARY KEY,
          pubkey VARCHAR(64) NOT NULL,
          slot BIGINT NOT NULL,
          write_version BIGINT NOT NULL,
          owner VARCHAR(64) NOT NULL,
          lamports BIGINT NOT NULL,
          data_hash VARCHAR(64),
          data_size INTEGER,
          executable BOOLEAN DEFAULT FALSE,
          rent_epoch BIGINT,
          block_time TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(pubkey, write_version)
        );
        
        CREATE INDEX IF NOT EXISTS idx_state_pubkey_slot ON account_state_history(pubkey, slot DESC);
        CREATE INDEX IF NOT EXISTS idx_state_slot ON account_state_history(slot DESC);
        CREATE INDEX IF NOT EXISTS idx_state_owner ON account_state_history(owner);
        
        -- State changes tracking
        CREATE TABLE IF NOT EXISTS state_changes (
          id SERIAL PRIMARY KEY,
          pubkey VARCHAR(64) NOT NULL,
          slot BIGINT NOT NULL,
          write_version BIGINT NOT NULL,
          previous_write_version BIGINT,
          change_type VARCHAR(10) NOT NULL,
          lamports_delta BIGINT,
          owner VARCHAR(64),
          program VARCHAR(64),
          instruction VARCHAR(100),
          signature VARCHAR(88),
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_changes_pubkey ON state_changes(pubkey);
        CREATE INDEX IF NOT EXISTS idx_changes_slot ON state_changes(slot DESC);
        
        -- Write version tracking
        CREATE TABLE IF NOT EXISTS write_version_tracking (
          pubkey VARCHAR(64) PRIMARY KEY,
          current_write_version BIGINT NOT NULL,
          last_update_slot BIGINT NOT NULL,
          last_update_time TIMESTAMP NOT NULL,
          total_updates INTEGER DEFAULT 1
        );
        
        -- Consistency issues
        CREATE TABLE IF NOT EXISTS consistency_issues (
          id SERIAL PRIMARY KEY,
          slot BIGINT NOT NULL,
          account VARCHAR(64) NOT NULL,
          issue_type VARCHAR(50) NOT NULL,
          details TEXT,
          resolved BOOLEAN DEFAULT FALSE,
          detected_at TIMESTAMP DEFAULT NOW()
        );
      `);
    } catch (error) {
      this.logger.error('Error creating tables', error as Error);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for account updates
    this.eventBus.on('account:updated', this.handleAccountUpdate.bind(this));
    
    // Listen for transaction data to track state changes
    this.eventBus.on('transaction:processed', this.handleTransactionProcessed.bind(this));
    
    // Listen for slot updates
    this.eventBus.on('slot:update', this.handleSlotUpdate.bind(this));
  }

  /**
   * Start periodic tasks
   */
  private startPeriodicTasks(): void {
    // Check consistency every 30 seconds
    setInterval(() => this.checkConsistency(), 30000);
    
    // Create snapshots every 5 minutes
    setInterval(() => this.createSnapshot(), 300000);
    
    // Clean up old data every hour
    setInterval(() => this.cleanupOldData(), 3600000);
  }

  /**
   * Handle account update
   */
  private async handleAccountUpdate(event: any): Promise<void> {
    try {
      const pubkey = typeof event.pubkey === 'string' 
        ? event.pubkey 
        : bs58.encode(event.pubkey);
      
      const slot = BigInt(event.slot || 0);
      const writeVersion = BigInt(event.writeVersion || 0);
      
      // Check write version consistency
      const currentVersion = this.writeVersions.get(pubkey);
      if (currentVersion && writeVersion <= currentVersion) {
        this.logger.warn('Write version inconsistency detected', {
          pubkey,
          currentVersion: currentVersion.toString(),
          newVersion: writeVersion.toString()
        });
        
        await this.recordInconsistency({
          slot,
          timestamp: new Date(),
          isConsistent: false,
          issues: [{
            type: 'version_mismatch',
            account: pubkey,
            details: `Expected version > ${currentVersion}, got ${writeVersion}`
          }]
        });
        
        return;
      }
      
      // Create account state
      const accountState: AccountState = {
        pubkey,
        owner: event.owner || '',
        lamports: BigInt(event.lamports || 0),
        data: event.data || Buffer.alloc(0),
        executable: event.executable || false,
        rentEpoch: BigInt(event.rentEpoch || 0),
        writeVersion,
        slot,
        blockTime: event.blockTime || Math.floor(Date.now() / 1000)
      };
      
      // Track state change
      const previousState = this.accountStates.get(pubkey);
      const stateChange: StateChange = {
        pubkey,
        slot,
        writeVersion,
        previousWriteVersion: currentVersion,
        changeType: previousState ? 'update' : 'create',
        dataHash: this.hashData(accountState.data),
        lamportsDelta: previousState 
          ? accountState.lamports - previousState.lamports 
          : accountState.lamports,
        owner: accountState.owner,
        program: event.program || '',
        instruction: event.instruction,
        signature: event.signature
      };
      
      // Update tracking
      this.accountStates.set(pubkey, accountState);
      this.writeVersions.set(pubkey, writeVersion);
      
      if (!this.stateChanges.has(pubkey)) {
        this.stateChanges.set(pubkey, []);
      }
      this.stateChanges.get(pubkey)!.push(stateChange);
      
      // Store in database
      await this.storeAccountState(accountState);
      await this.storeStateChange(stateChange);
      await this.updateWriteVersion(pubkey, writeVersion, slot);
      
      // Update last processed slot
      if (slot > this.lastProcessedSlot) {
        this.lastProcessedSlot = slot;
      }
      
    } catch (error) {
      this.logger.error('Error handling account update', error as Error);
    }
  }

  /**
   * Handle transaction processed
   */
  private async handleTransactionProcessed(event: any): Promise<void> {
    try {
      // Extract account states from transaction
      const postBalances = event.meta?.postBalances || [];
      const accountKeys = event.transaction?.message?.accountKeys || [];
      
      for (let i = 0; i < accountKeys.length && i < postBalances.length; i++) {
        const pubkey = typeof accountKeys[i] === 'string' 
          ? accountKeys[i] 
          : bs58.encode(accountKeys[i]);
        
        // Track lamport changes
        const preBalance = event.meta?.preBalances?.[i] || 0;
        const postBalance = postBalances[i] || 0;
        
        if (preBalance !== postBalance) {
          // This indicates a state change
          this.pendingWrites.set(pubkey, {
            pubkey,
            slot: BigInt(event.slot || 0),
            writeVersion: 0n, // Will be filled by account update
            changeType: 'update',
            dataHash: '',
            lamportsDelta: BigInt(postBalance - preBalance),
            owner: '',
            program: event.program || '',
            signature: event.signature
          });
        }
      }
    } catch (error) {
      // Silent error to avoid spam
    }
  }

  /**
   * Handle slot update
   */
  private async handleSlotUpdate(event: any): Promise<void> {
    try {
      const slot = BigInt(event.slot || 0);
      
      // Process any pending writes for consistency
      for (const [pubkey, pendingWrite] of this.pendingWrites) {
        if (pendingWrite.slot < slot - 10n) { // Old pending write
          this.logger.warn('Pending write not resolved', {
            pubkey,
            slot: pendingWrite.slot.toString()
          });
          
          this.pendingWrites.delete(pubkey);
        }
      }
    } catch (error) {
      // Silent error
    }
  }

  /**
   * Check consistency
   */
  private async checkConsistency(): Promise<void> {
    try {
      const issues: ConsistencyCheck['issues'] = [];
      
      // Check for missing state updates
      for (const [pubkey, changes] of this.stateChanges) {
        if (changes.length > 1) {
          // Check for gaps in write versions
          const sortedChanges = changes.sort((a, b) => 
            Number(a.writeVersion - b.writeVersion)
          );
          
          for (let i = 1; i < sortedChanges.length; i++) {
            const prev = sortedChanges[i - 1];
            const curr = sortedChanges[i];
            
            if (curr.previousWriteVersion !== prev.writeVersion) {
              issues.push({
                type: 'missing_state',
                account: pubkey,
                details: `Gap between versions ${prev.writeVersion} and ${curr.writeVersion}`
              });
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const check: ConsistencyCheck = {
          slot: this.lastProcessedSlot,
          timestamp: new Date(),
          isConsistent: false,
          issues
        };
        
        this.inconsistencies.push(check);
        await this.recordInconsistency(check);
        
        this.logger.warn('Consistency issues detected', {
          issueCount: issues.length
        });
      }
    } catch (error) {
      this.logger.error('Error checking consistency', error as Error);
    }
  }

  /**
   * Create state snapshot
   */
  private async createSnapshot(): Promise<void> {
    try {
      const programBreakdown = new Map<string, number>();
      let totalLamports = 0n;
      
      for (const state of this.accountStates.values()) {
        totalLamports += state.lamports;
        
        const count = programBreakdown.get(state.owner) || 0;
        programBreakdown.set(state.owner, count + 1);
      }
      
      const snapshot: StateSnapshot = {
        slot: this.lastProcessedSlot,
        timestamp: new Date(),
        accounts: new Map(this.accountStates),
        totalAccounts: this.accountStates.size,
        totalLamports,
        programBreakdown
      };
      
      this.eventBus.emit('state:snapshot_created', snapshot);
      
      this.logger.info('State snapshot created', {
        slot: snapshot.slot.toString(),
        accounts: snapshot.totalAccounts,
        totalLamports: (Number(snapshot.totalLamports) / 1e9).toFixed(2) + ' SOL'
      });
    } catch (error) {
      this.logger.error('Error creating snapshot', error as Error);
    }
  }

  /**
   * Store account state
   */
  private async storeAccountState(state: AccountState): Promise<void> {
    try {
      const dataHash = this.hashData(state.data);
      
      await db.query(`
        INSERT INTO account_state_history (
          pubkey, slot, write_version, owner, lamports,
          data_hash, data_size, executable, rent_epoch, block_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (pubkey, write_version) DO NOTHING
      `, [
        state.pubkey,
        state.slot.toString(),
        state.writeVersion.toString(),
        state.owner,
        state.lamports.toString(),
        dataHash,
        state.data.length,
        state.executable,
        state.rentEpoch.toString(),
        new Date(state.blockTime * 1000)
      ]);
    } catch (error) {
      this.logger.error('Error storing account state', error as Error);
    }
  }

  /**
   * Store state change
   */
  private async storeStateChange(change: StateChange): Promise<void> {
    try {
      await db.query(`
        INSERT INTO state_changes (
          pubkey, slot, write_version, previous_write_version,
          change_type, lamports_delta, owner, program, instruction, signature
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        change.pubkey,
        change.slot.toString(),
        change.writeVersion.toString(),
        change.previousWriteVersion?.toString() || null,
        change.changeType,
        change.lamportsDelta.toString(),
        change.owner,
        change.program,
        change.instruction || null,
        change.signature || null
      ]);
    } catch (error) {
      this.logger.error('Error storing state change', error as Error);
    }
  }

  /**
   * Update write version tracking
   */
  private async updateWriteVersion(
    pubkey: string, 
    writeVersion: bigint, 
    slot: bigint
  ): Promise<void> {
    try {
      await db.query(`
        INSERT INTO write_version_tracking (
          pubkey, current_write_version, last_update_slot, last_update_time
        ) VALUES ($1, $2, $3, NOW())
        ON CONFLICT (pubkey) DO UPDATE SET
          current_write_version = $2,
          last_update_slot = $3,
          last_update_time = NOW(),
          total_updates = write_version_tracking.total_updates + 1
      `, [pubkey, writeVersion.toString(), slot.toString()]);
    } catch (error) {
      this.logger.error('Error updating write version', error as Error);
    }
  }

  /**
   * Record inconsistency
   */
  private async recordInconsistency(check: ConsistencyCheck): Promise<void> {
    try {
      for (const issue of check.issues) {
        await db.query(`
          INSERT INTO consistency_issues (
            slot, account, issue_type, details
          ) VALUES ($1, $2, $3, $4)
        `, [
          check.slot.toString(),
          issue.account,
          issue.type,
          issue.details
        ]);
      }
    } catch (error) {
      this.logger.error('Error recording inconsistency', error as Error);
    }
  }

  /**
   * Hash data for comparison
   */
  private hashData(data: Buffer): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Load recent states from database
   */
  private async loadRecentStates(): Promise<void> {
    try {
      // Load write versions
      const versionResult = await db.query(`
        SELECT pubkey, current_write_version, last_update_slot
        FROM write_version_tracking
        ORDER BY last_update_time DESC
        LIMIT 10000
      `);
      
      for (const row of versionResult.rows) {
        this.writeVersions.set(row.pubkey, BigInt(row.current_write_version));
        const slot = BigInt(row.last_update_slot);
        if (slot > this.lastProcessedSlot) {
          this.lastProcessedSlot = slot;
        }
      }
      
      // Load recent account states
      const stateResult = await db.query(`
        SELECT DISTINCT ON (pubkey) 
          pubkey, slot, write_version, owner, lamports, 
          data_size, executable, rent_epoch, block_time
        FROM account_state_history
        WHERE block_time > NOW() - INTERVAL '1 hour'
        ORDER BY pubkey, write_version DESC
      `);
      
      for (const row of stateResult.rows) {
        const accountState: AccountState = {
          pubkey: row.pubkey,
          owner: row.owner,
          lamports: BigInt(row.lamports),
          data: Buffer.alloc(0), // Don't load full data
          executable: row.executable,
          rentEpoch: BigInt(row.rent_epoch || 0),
          writeVersion: BigInt(row.write_version),
          slot: BigInt(row.slot),
          blockTime: Math.floor(row.block_time.getTime() / 1000)
        };
        
        this.accountStates.set(row.pubkey, accountState);
      }
    } catch (error) {
      this.logger.error('Error loading recent states', error as Error);
    }
  }

  /**
   * Reconstruct historical state
   */
  async reconstructStateAtSlot(
    pubkey: string, 
    targetSlot: bigint
  ): Promise<AccountState | null> {
    try {
      const result = await db.query(`
        SELECT * FROM account_state_history
        WHERE pubkey = $1 AND slot <= $2
        ORDER BY write_version DESC
        LIMIT 1
      `, [pubkey, targetSlot.toString()]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        pubkey: row.pubkey,
        owner: row.owner,
        lamports: BigInt(row.lamports),
        data: Buffer.alloc(row.data_size || 0),
        executable: row.executable,
        rentEpoch: BigInt(row.rent_epoch || 0),
        writeVersion: BigInt(row.write_version),
        slot: BigInt(row.slot),
        blockTime: Math.floor(row.block_time.getTime() / 1000)
      };
    } catch (error) {
      this.logger.error('Error reconstructing state', error as Error);
      return null;
    }
  }

  /**
   * Get state changes for account
   */
  async getStateChanges(
    pubkey: string, 
    startSlot?: bigint, 
    endSlot?: bigint
  ): Promise<StateChange[]> {
    try {
      let query = `
        SELECT * FROM state_changes 
        WHERE pubkey = $1
      `;
      const params: any[] = [pubkey];
      
      if (startSlot) {
        query += ` AND slot >= $${params.length + 1}`;
        params.push(startSlot.toString());
      }
      
      if (endSlot) {
        query += ` AND slot <= $${params.length + 1}`;
        params.push(endSlot.toString());
      }
      
      query += ` ORDER BY write_version DESC`;
      
      const result = await db.query(query, params);
      
      return result.rows.map((row: any) => ({
        pubkey: row.pubkey,
        slot: BigInt(row.slot),
        writeVersion: BigInt(row.write_version),
        previousWriteVersion: row.previous_write_version ? BigInt(row.previous_write_version) : undefined,
        changeType: row.change_type,
        dataHash: '',
        lamportsDelta: BigInt(row.lamports_delta || 0),
        owner: row.owner,
        program: row.program,
        instruction: row.instruction,
        signature: row.signature
      }));
    } catch (error) {
      this.logger.error('Error getting state changes', error as Error);
      return [];
    }
  }

  /**
   * Get current account state
   */
  getCurrentState(pubkey: string): AccountState | undefined {
    return this.accountStates.get(pubkey);
  }

  /**
   * Get write version
   */
  getWriteVersion(pubkey: string): bigint | undefined {
    return this.writeVersions.get(pubkey);
  }

  /**
   * Get consistency issues
   */
  getConsistencyIssues(limit: number = 100): ConsistencyCheck[] {
    return this.inconsistencies.slice(-limit);
  }

  /**
   * Get account states size
   */
  get accountStatesSize(): number {
    return this.accountStates.size;
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    // Clean up old state changes from memory
    for (const [pubkey, changes] of this.stateChanges) {
      const recentChanges = changes.filter(c => 
        Number(c.slot) * 400 > oneHourAgo // Approximate slot to time
      );
      
      if (recentChanges.length === 0) {
        this.stateChanges.delete(pubkey);
      } else {
        this.stateChanges.set(pubkey, recentChanges);
      }
    }
    
    // Keep only recent inconsistencies
    if (this.inconsistencies.length > 100) {
      this.inconsistencies = this.inconsistencies.slice(-100);
    }
    
    this.logger.debug('Cleaned up old state data', {
      remainingAccounts: this.accountStates.size,
      remainingChanges: this.stateChanges.size
    });
  }
}