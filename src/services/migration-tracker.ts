/**
 * Migration Tracker Service
 * Tracks token migrations from bonding curve to AMM/Raydium
 */

import { Logger } from '../core/logger';
import { EventBus, EVENTS } from '../core/event-bus';
import { Container, TOKENS } from '../core/container';
import { db } from '../database';

export interface MigrationEvent {
  mintAddress: string;
  bondingCurveKey: string;
  destinationType: 'amm_pool' | 'raydium';
  destinationAddress?: string;
  migrationTx: string;
  slot: bigint;
  blockTime: number;
  withdrawAmount?: bigint;
  status: 'started' | 'completed' | 'failed';
}

export interface TokenLifecycle {
  mintAddress: string;
  creator: string;
  createdAt: Date;
  createdTx: string;
  createdSlot: bigint;
  bondingCurveKey?: string;
  lifecycle: {
    phase: 'bonding' | 'migrating' | 'graduated' | 'raydium' | 'graduating' | 'abandoned';
    startedAt: Date;
    completedAt?: Date;
    txSignature?: string;
  }[];
  currentPhase: 'bonding' | 'migrating' | 'graduated' | 'raydium' | 'graduating' | 'abandoned';
  totalTrades: number;
  peakMarketCap: number;
  migrationStarted?: Date;
  migrationCompleted?: Date;
  destinationPool?: string;
}

export class MigrationTracker {
  private static instance: MigrationTracker;
  private logger: Logger;
  private eventBus: EventBus;
  private lifecycles: Map<string, TokenLifecycle> = new Map();
  private pendingMigrations: Map<string, MigrationEvent> = new Map();

  private constructor(container: Container) {
    this.logger = new Logger({ context: 'MigrationTracker' });
    this.eventBus = (container.resolve(TOKENS.EventBus) as unknown) as EventBus;
    
    this.setupEventListeners();
  }

  static async create(container: Container): Promise<MigrationTracker> {
    if (!MigrationTracker.instance) {
      MigrationTracker.instance = new MigrationTracker(container);
      await MigrationTracker.instance.initialize();
    }
    return MigrationTracker.instance;
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    // Load existing lifecycles from database
    await this.loadExistingLifecycles();
    this.logger.info('Migration tracker initialized', {
      trackedTokens: this.lifecycles.size
    });
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for new tokens
    this.eventBus.on('token:created', this.handleTokenCreated.bind(this));
    
    // Listen for graduations
    this.eventBus.on(EVENTS.TOKEN_GRADUATED, this.handleTokenGraduated.bind(this));
    
    // Listen for pool creation
    this.eventBus.on(EVENTS.POOL_CREATED, this.handlePoolCreated.bind(this));
    
    // Listen for migration events
    this.eventBus.on('migration:started', this.handleMigrationStarted.bind(this));
    this.eventBus.on('migration:completed', this.handleMigrationCompleted.bind(this));
    
    // Listen for trades to update lifecycle
    this.eventBus.on(EVENTS.TRADE_PROCESSED, this.handleTradeProcessed.bind(this));
  }

  /**
   * Handle new token creation
   */
  private async handleTokenCreated(event: any): Promise<void> {
    try {
      const lifecycle: TokenLifecycle = {
        mintAddress: event.mintAddress,
        creator: event.creator,
        createdAt: new Date(),
        createdTx: event.transactionSignature,
        createdSlot: event.slot,
        bondingCurveKey: event.bondingCurveKey,
        lifecycle: [{
          phase: 'bonding',
          startedAt: new Date()
        }],
        currentPhase: 'bonding',
        totalTrades: 0,
        peakMarketCap: 0
      };

      this.lifecycles.set(event.mintAddress, lifecycle);
      
      // Store in database
      await this.storeLifecycleUpdate(lifecycle);
      
      this.logger.info('Token lifecycle started', {
        mint: event.mintAddress,
        creator: event.creator
      });

      // Emit lifecycle event
      this.eventBus.emit('lifecycle:started', lifecycle);
    } catch (error) {
      this.logger.error('Error handling token creation', error as Error);
    }
  }

  /**
   * Handle token graduation
   */
  private async handleTokenGraduated(event: any): Promise<void> {
    try {
      const lifecycle = this.lifecycles.get(event.mintAddress);
      if (!lifecycle) {
        this.logger.warn('Graduation for unknown token', { 
          mint: event.mintAddress 
        });
        return;
      }

      // Update lifecycle
      const currentPhase = lifecycle.lifecycle[lifecycle.lifecycle.length - 1];
      currentPhase.completedAt = new Date();
      currentPhase.txSignature = event.signature;

      // Add migration phase
      lifecycle.lifecycle.push({
        phase: 'migrating',
        startedAt: new Date(),
        txSignature: event.signature
      });
      lifecycle.currentPhase = 'migrating';
      lifecycle.migrationStarted = new Date();

      await this.storeLifecycleUpdate(lifecycle);
      
      this.logger.info('Token graduated, migration started', {
        mint: event.mintAddress,
        bondingCurve: event.bondingCurveKey
      });

      // Track pending migration
      const migration: MigrationEvent = {
        mintAddress: event.mintAddress,
        bondingCurveKey: event.bondingCurveKey,
        destinationType: 'amm_pool',
        migrationTx: event.signature,
        slot: event.slot,
        blockTime: event.blockTime,
        status: 'started'
      };
      
      this.pendingMigrations.set(event.mintAddress, migration);
      
      // Emit migration event
      this.eventBus.emit('migration:detected', migration);
    } catch (error) {
      this.logger.error('Error handling graduation', error as Error);
    }
  }

  /**
   * Handle pool creation
   */
  private async handlePoolCreated(event: any): Promise<void> {
    try {
      // Check if this is for a pending migration
      const migration = this.pendingMigrations.get(event.mintAddress);
      const lifecycle = this.lifecycles.get(event.mintAddress);
      
      if (migration && lifecycle) {
        // Complete migration
        migration.destinationAddress = event.poolAddress;
        migration.status = 'completed';
        
        // Update lifecycle
        const currentPhase = lifecycle.lifecycle[lifecycle.lifecycle.length - 1];
        currentPhase.completedAt = new Date();
        
        // Add graduated phase
        lifecycle.lifecycle.push({
          phase: 'graduated',
          startedAt: new Date(),
          txSignature: event.signature
        });
        lifecycle.currentPhase = 'graduated';
        lifecycle.migrationCompleted = new Date();
        lifecycle.destinationPool = event.poolAddress;
        
        await this.storeLifecycleUpdate(lifecycle);
        
        this.logger.info('Migration completed to AMM pool', {
          mint: event.mintAddress,
          pool: event.poolAddress
        });
        
        // Remove from pending
        this.pendingMigrations.delete(event.mintAddress);
        
        // Emit completion event
        this.eventBus.emit('migration:completed', {
          ...migration,
          destinationAddress: event.poolAddress
        });
      }
    } catch (error) {
      this.logger.error('Error handling pool creation', error as Error);
    }
  }

  /**
   * Handle migration started
   */
  private async handleMigrationStarted(event: MigrationEvent): Promise<void> {
    // Additional processing if needed
    this.logger.debug('Migration started', { mint: event.mintAddress });
  }

  /**
   * Handle migration completed
   */
  private async handleMigrationCompleted(event: MigrationEvent): Promise<void> {
    try {
      // Update database with completed migration
      await db.query(`
        UPDATE tokens_unified
        SET 
          graduated_to_amm = true,
          graduation_at = NOW(),
          graduation_slot = $1,
          current_program = 'amm_pool',
          updated_at = NOW()
        WHERE mint_address = $2
      `, [event.slot.toString(), event.mintAddress]);
      
      this.logger.info('Migration completed in database', {
        mint: event.mintAddress,
        destination: event.destinationAddress
      });
    } catch (error) {
      this.logger.error('Error updating migration status', error as Error);
    }
  }

  /**
   * Handle trade processed
   */
  private async handleTradeProcessed(event: any): Promise<void> {
    try {
      const lifecycle = this.lifecycles.get(event.mintAddress);
      if (lifecycle) {
        lifecycle.totalTrades++;
        
        // Update peak market cap if higher
        if (event.marketCapUsd > lifecycle.peakMarketCap) {
          lifecycle.peakMarketCap = event.marketCapUsd;
        }
        
        // Periodically save updates
        if (lifecycle.totalTrades % 10 === 0) {
          await this.storeLifecycleUpdate(lifecycle);
        }
      }
    } catch (error) {
      // Silent error to avoid spam
    }
  }

  /**
   * Load existing lifecycles from database
   */
  private async loadExistingLifecycles(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT 
          t.mint_address,
          t.creator,
          t.created_at,
          t.first_seen_slot,
          t.graduated_to_amm,
          t.graduation_at,
          t.current_program,
          bcm.bonding_curve_key,
          COUNT(tr.id) as total_trades,
          MAX(tr.market_cap_usd) as peak_market_cap
        FROM tokens_unified t
        LEFT JOIN bonding_curve_mappings bcm ON t.mint_address = bcm.mint_address
        LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
        WHERE t.created_at > NOW() - INTERVAL '7 days'
        GROUP BY t.mint_address, t.creator, t.created_at, t.first_seen_slot, 
                 t.graduated_to_amm, t.graduation_at, t.current_program, bcm.bonding_curve_key
      `);

      for (const row of result.rows) {
        const lifecycle: TokenLifecycle = {
          mintAddress: row.mint_address,
          creator: row.creator || 'unknown',
          createdAt: row.created_at,
          createdTx: 'unknown',
          createdSlot: BigInt(row.first_seen_slot || 0),
          bondingCurveKey: row.bonding_curve_key,
          lifecycle: [],
          currentPhase: row.graduated_to_amm ? 'graduated' : 'bonding',
          totalTrades: parseInt(row.total_trades) || 0,
          peakMarketCap: parseFloat(row.peak_market_cap) || 0,
          migrationCompleted: row.graduation_at
        };

        this.lifecycles.set(row.mint_address, lifecycle);
      }

      this.logger.info('Loaded existing lifecycles', {
        count: this.lifecycles.size
      });
    } catch (error) {
      this.logger.error('Error loading lifecycles', error as Error);
    }
  }

  /**
   * Store lifecycle update in database
   */
  private async storeLifecycleUpdate(lifecycle: TokenLifecycle): Promise<void> {
    try {
      // Create token_lifecycle record if needed
      await db.query(`
        INSERT INTO token_lifecycle (
          mint_address,
          created_at,
          created_tx,
          creator_address,
          lifecycle_status,
          migration_started_at,
          migration_tx,
          migration_destination,
          pool_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (mint_address) DO UPDATE SET
          lifecycle_status = $5,
          migration_started_at = COALESCE(token_lifecycle.migration_started_at, $6),
          migration_tx = COALESCE(token_lifecycle.migration_tx, $7),
          migration_destination = COALESCE(token_lifecycle.migration_destination, $8),
          pool_address = COALESCE(token_lifecycle.pool_address, $9),
          updated_at = NOW()
      `, [
        lifecycle.mintAddress,
        lifecycle.createdAt,
        lifecycle.createdTx,
        lifecycle.creator,
        lifecycle.currentPhase,
        lifecycle.migrationStarted || null,
        lifecycle.lifecycle.find(l => l.phase === 'migrating')?.txSignature || null,
        lifecycle.currentPhase === 'graduated' ? 'amm_pool' : null,
        lifecycle.destinationPool || null
      ]);
    } catch (error) {
      this.logger.debug('Lifecycle table may not exist yet', { error });
    }
  }

  /**
   * Get lifecycle for a token
   */
  getLifecycle(mintAddress: string): TokenLifecycle | undefined {
    return this.lifecycles.get(mintAddress);
  }

  /**
   * Get migration statistics
   */
  async getMigrationStats(): Promise<any> {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_count,
          COUNT(*) FILTER (WHERE graduated_to_amm = false) as active_count,
          COUNT(*) FILTER (WHERE graduated_to_amm = true AND graduation_at > NOW() - INTERVAL '24 hours') as graduated_24h,
          AVG(EXTRACT(EPOCH FROM (graduation_at - created_at))/3600) FILTER (WHERE graduated_to_amm = true) as avg_time_to_graduation_hours,
          COUNT(DISTINCT creator) as unique_creators
        FROM tokens_unified
        WHERE created_at > NOW() - INTERVAL '30 days'
      `);

      return {
        ...result.rows[0],
        pendingMigrations: this.pendingMigrations.size,
        trackedLifecycles: this.lifecycles.size
      };
    } catch (error) {
      this.logger.error('Error getting migration stats', error as Error);
      return {
        graduated_count: 0,
        active_count: 0,
        graduated_24h: 0,
        avg_time_to_graduation_hours: 0,
        unique_creators: 0,
        pendingMigrations: this.pendingMigrations.size,
        trackedLifecycles: this.lifecycles.size
      };
    }
  }

  /**
   * Clean up old lifecycles
   */
  cleanupOldLifecycles(): void {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [mint, lifecycle] of this.lifecycles) {
      if (lifecycle.createdAt.getTime() < oneWeekAgo) {
        this.lifecycles.delete(mint);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.info('Cleaned up old lifecycles', { removed });
    }
  }
}