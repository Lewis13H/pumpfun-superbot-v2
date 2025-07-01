/**
 * Token Lifecycle Service
 * Comprehensive tracking of token journey from creation to graduation
 */

import { Logger } from '../core/logger';
import { EventBus, EVENTS } from '../core/event-bus';
import { Container, TOKENS } from '../core/container';
import { db } from '../database';
import { TokenCreationDetector, NewTokenEvent } from './token-creation-detector';
import { MigrationTracker, TokenLifecycle } from './migration-tracker';
import { PoolCreationMonitor, PoolCreationEvent } from './pool-creation-monitor';

export interface TokenLifecyclePhase {
  phase: 'created' | 'bonding' | 'graduating' | 'graduated' | 'raydium' | 'abandoned' | 'migrating';
  startedAt: Date;
  endedAt?: Date;
  transactionSignature?: string;
  metadata?: any;
}

export interface TokenLifecycleStats {
  totalTokensCreated: number;
  activeTokens: number;
  graduatedTokens: number;
  abandonedTokens: number;
  avgTimeToGraduation: number; // hours
  graduationRate: number; // percentage
  tokensCreated24h: number;
  tokensGraduated24h: number;
  topCreators: Array<{
    address: string;
    tokensCreated: number;
    tokensGraduated: number;
    successRate: number;
  }>;
}

export class TokenLifecycleService {
  private static instance: TokenLifecycleService;
  private logger: Logger;
  private eventBus: EventBus;
  private tokenDetector: TokenCreationDetector;
  private migrationTracker!: MigrationTracker;
  private poolMonitor: PoolCreationMonitor;
  
  private lifecycles: Map<string, TokenLifecycle> = new Map();
  private creatorStats: Map<string, {
    created: number;
    graduated: number;
    abandoned: number;
  }> = new Map();

  private constructor(container: Container) {
    this.logger = new Logger({ context: 'TokenLifecycleService' });
    this.eventBus = (container.resolve(TOKENS.EventBus) as unknown) as EventBus;
    
    // Initialize sub-services
    this.tokenDetector = TokenCreationDetector.getInstance(this.eventBus);
    this.poolMonitor = PoolCreationMonitor.getInstance(this.eventBus);
  }

  static async create(container: Container): Promise<TokenLifecycleService> {
    if (!TokenLifecycleService.instance) {
      TokenLifecycleService.instance = new TokenLifecycleService(container);
      TokenLifecycleService.instance.migrationTracker = await MigrationTracker.create(container);
      await TokenLifecycleService.instance.initialize();
    }
    return TokenLifecycleService.instance;
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    await this.createLifecycleTable();
    await this.loadExistingLifecycles();
    this.setupEventListeners();
    
    // Start periodic tasks
    setInterval(() => this.updateLifecycleStats(), 60000); // Every minute
    setInterval(() => this.detectAbandonedTokens(), 300000); // Every 5 minutes
    setInterval(() => this.cleanupOldData(), 3600000); // Every hour
    
    this.logger.info('Token lifecycle service initialized');
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for stream data to detect new tokens and pools
    this.eventBus.on(EVENTS.STREAM_DATA, this.processStreamData.bind(this));
    
    // Listen for specific lifecycle events
    this.eventBus.on('token:created', this.handleTokenCreated.bind(this));
    this.eventBus.on(EVENTS.TOKEN_GRADUATED, this.handleTokenGraduated.bind(this));
    this.eventBus.on(EVENTS.POOL_CREATED, this.handlePoolCreated.bind(this));
    this.eventBus.on('migration:completed', this.handleMigrationCompleted.bind(this));
  }

  /**
   * Process stream data for lifecycle events
   */
  private async processStreamData(data: any): Promise<void> {
    try {
      // Detect new token creation
      const newToken = await this.tokenDetector.detectNewToken(data);
      if (newToken) {
        await this.handleTokenCreated(newToken);
      }

      // Detect pool creation
      const newPool = await this.poolMonitor.detectPoolCreation(data);
      if (newPool) {
        await this.handlePoolCreated(newPool);
      }
    } catch (error) {
      // Silent error to avoid spam
    }
  }

  /**
   * Handle new token creation
   */
  private async handleTokenCreated(event: NewTokenEvent): Promise<void> {
    try {
      // Check if we already have this token
      if (this.lifecycles.has(event.mintAddress)) {
        return;
      }

      // Create lifecycle entry
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
      
      // Update creator stats
      this.updateCreatorStats(event.creator, 'created');
      
      // Store in database
      await this.storeTokenLifecycle(lifecycle);
      
      this.logger.info('Token lifecycle started', {
        mint: event.mintAddress,
        creator: event.creator
      });
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
      if (!lifecycle) return;

      // Update lifecycle phase
      const currentPhase = lifecycle.lifecycle[lifecycle.lifecycle.length - 1];
      currentPhase.completedAt = new Date();
      
      lifecycle.lifecycle.push({
        phase: 'graduating',
        startedAt: new Date(),
        txSignature: event.signature
      });
      lifecycle.currentPhase = 'graduating';
      lifecycle.migrationStarted = new Date();

      await this.storeTokenLifecycle(lifecycle);
      
      this.logger.info('Token graduating', {
        mint: event.mintAddress
      });
    } catch (error) {
      this.logger.error('Error handling graduation', error as Error);
    }
  }

  /**
   * Handle pool creation
   */
  private async handlePoolCreated(event: PoolCreationEvent | any): Promise<void> {
    try {
      const mintAddress = event.mintAddress;
      const lifecycle = this.lifecycles.get(mintAddress);
      
      if (lifecycle && lifecycle.currentPhase === 'graduating') {
        // Complete graduation
        const currentPhase = lifecycle.lifecycle[lifecycle.lifecycle.length - 1];
        currentPhase.completedAt = new Date();
        
        lifecycle.lifecycle.push({
          phase: 'graduated',
          startedAt: new Date(),
          txSignature: event.signature || event.transactionSignature
        });
        lifecycle.currentPhase = 'graduated';
        lifecycle.migrationCompleted = new Date();
        lifecycle.destinationPool = event.poolAddress;

        // Update creator stats
        this.updateCreatorStats(lifecycle.creator, 'graduated');
        
        await this.storeTokenLifecycle(lifecycle);
        
        this.logger.info('Token graduated to pool', {
          mint: mintAddress,
          pool: event.poolAddress
        });
      }
    } catch (error) {
      this.logger.error('Error handling pool creation', error as Error);
    }
  }

  /**
   * Handle migration completed
   */
  private async handleMigrationCompleted(event: any): Promise<void> {
    // Additional processing if needed
    this.logger.debug('Migration completed', { mint: event.mintAddress });
  }

  /**
   * Create lifecycle table if it doesn't exist
   */
  private async createLifecycleTable(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS token_lifecycle (
          mint_address VARCHAR(64) PRIMARY KEY,
          created_at TIMESTAMP NOT NULL,
          created_tx VARCHAR(88) NOT NULL,
          creator_address VARCHAR(64) NOT NULL,
          bonding_curve_key VARCHAR(64),
          lifecycle_status VARCHAR(20) NOT NULL,
          lifecycle_phases JSONB,
          total_trades INTEGER DEFAULT 0,
          peak_market_cap DECIMAL(20, 4) DEFAULT 0,
          migration_started_at TIMESTAMP,
          migration_tx VARCHAR(88),
          migration_destination VARCHAR(20),
          pool_address VARCHAR(64),
          abandoned_at TIMESTAMP,
          updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_lifecycle_creator ON token_lifecycle(creator_address);
        CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON token_lifecycle(lifecycle_status);
        CREATE INDEX IF NOT EXISTS idx_lifecycle_created ON token_lifecycle(created_at DESC);
      `);

      // Create creator analysis table
      await db.query(`
        CREATE TABLE IF NOT EXISTS creator_analysis (
          creator_address VARCHAR(64) PRIMARY KEY,
          tokens_created INTEGER DEFAULT 0,
          tokens_graduated INTEGER DEFAULT 0,
          tokens_rugged INTEGER DEFAULT 0,
          graduation_rate DECIMAL(5, 2),
          avg_market_cap DECIMAL(20, 4),
          first_seen TIMESTAMP,
          last_seen TIMESTAMP,
          analyzed_at TIMESTAMP DEFAULT NOW()
        );
      `);
    } catch (error) {
      this.logger.debug('Tables may already exist', { error });
    }
  }

  /**
   * Load existing lifecycles from database
   */
  private async loadExistingLifecycles(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT * FROM token_lifecycle 
        WHERE created_at > NOW() - INTERVAL '7 days'
        AND lifecycle_status NOT IN ('abandoned')
      `);

      for (const row of result.rows) {
        const lifecycle: TokenLifecycle = {
          mintAddress: row.mint_address,
          creator: row.creator_address,
          createdAt: row.created_at,
          createdTx: row.created_tx,
          createdSlot: BigInt(row.created_slot || 0),
          bondingCurveKey: row.bonding_curve_key,
          lifecycle: row.lifecycle_phases || [],
          currentPhase: row.lifecycle_status as any,
          totalTrades: row.total_trades || 0,
          peakMarketCap: parseFloat(row.peak_market_cap) || 0,
          migrationStarted: row.migration_started_at,
          migrationCompleted: row.pool_address ? new Date() : undefined,
          destinationPool: row.pool_address
        };

        this.lifecycles.set(row.mint_address, lifecycle);
      }

      // Load creator stats
      const creatorResult = await db.query(`
        SELECT creator_address, 
               COUNT(*) as created,
               COUNT(*) FILTER (WHERE lifecycle_status = 'graduated') as graduated,
               COUNT(*) FILTER (WHERE lifecycle_status = 'abandoned') as abandoned
        FROM token_lifecycle
        GROUP BY creator_address
      `);

      for (const row of creatorResult.rows) {
        this.creatorStats.set(row.creator_address, {
          created: parseInt(row.created),
          graduated: parseInt(row.graduated),
          abandoned: parseInt(row.abandoned)
        });
      }

      this.logger.info('Loaded existing lifecycles', {
        lifecycles: this.lifecycles.size,
        creators: this.creatorStats.size
      });
    } catch (error) {
      this.logger.error('Error loading lifecycles', error as Error);
    }
  }

  /**
   * Store token lifecycle in database
   */
  private async storeTokenLifecycle(lifecycle: TokenLifecycle): Promise<void> {
    try {
      await db.query(`
        INSERT INTO token_lifecycle (
          mint_address,
          created_at,
          created_tx,
          creator_address,
          bonding_curve_key,
          lifecycle_status,
          lifecycle_phases,
          total_trades,
          peak_market_cap,
          migration_started_at,
          migration_tx,
          migration_destination,
          pool_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (mint_address) DO UPDATE SET
          lifecycle_status = $6,
          lifecycle_phases = $7,
          total_trades = $8,
          peak_market_cap = $9,
          migration_started_at = COALESCE(token_lifecycle.migration_started_at, $10),
          migration_tx = COALESCE(token_lifecycle.migration_tx, $11),
          migration_destination = COALESCE(token_lifecycle.migration_destination, $12),
          pool_address = COALESCE(token_lifecycle.pool_address, $13),
          updated_at = NOW()
      `, [
        lifecycle.mintAddress,
        lifecycle.createdAt,
        lifecycle.createdTx,
        lifecycle.creator,
        lifecycle.bondingCurveKey,
        lifecycle.currentPhase,
        JSON.stringify(lifecycle.lifecycle),
        lifecycle.totalTrades,
        lifecycle.peakMarketCap,
        lifecycle.migrationStarted,
        lifecycle.lifecycle.find(l => l.phase === 'graduating')?.txSignature,
        lifecycle.currentPhase === 'graduated' ? 'amm_pool' : null,
        lifecycle.destinationPool
      ]);
    } catch (error) {
      this.logger.error('Error storing lifecycle', error as Error);
    }
  }

  /**
   * Update creator statistics
   */
  private updateCreatorStats(creator: string, event: 'created' | 'graduated' | 'abandoned'): void {
    if (!this.creatorStats.has(creator)) {
      this.creatorStats.set(creator, {
        created: 0,
        graduated: 0,
        abandoned: 0
      });
    }

    const stats = this.creatorStats.get(creator)!;
    stats[event]++;
  }

  /**
   * Update lifecycle statistics
   */
  private async updateLifecycleStats(): Promise<void> {
    try {
      // Update creator analysis
      for (const [creator, stats] of this.creatorStats) {
        const graduationRate = stats.created > 0 
          ? (stats.graduated / stats.created) * 100 
          : 0;

        await db.query(`
          INSERT INTO creator_analysis (
            creator_address,
            tokens_created,
            tokens_graduated,
            tokens_rugged,
            graduation_rate,
            first_seen,
            last_seen
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          ON CONFLICT (creator_address) DO UPDATE SET
            tokens_created = $2,
            tokens_graduated = $3,
            tokens_rugged = $4,
            graduation_rate = $5,
            last_seen = NOW(),
            analyzed_at = NOW()
        `, [
          creator,
          stats.created,
          stats.graduated,
          stats.abandoned,
          graduationRate
        ]);
      }
    } catch (error) {
      this.logger.error('Error updating stats', error as Error);
    }
  }

  /**
   * Detect abandoned tokens
   */
  private async detectAbandonedTokens(): Promise<void> {
    try {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      
      for (const [mint, lifecycle] of this.lifecycles) {
        if (lifecycle.currentPhase === 'bonding' && 
            lifecycle.createdAt.getTime() < oneHourAgo &&
            lifecycle.totalTrades < 10) {
          
          // Mark as abandoned
          lifecycle.currentPhase = 'abandoned';
          const currentPhase = lifecycle.lifecycle[lifecycle.lifecycle.length - 1];
          currentPhase.completedAt = new Date();
          
          lifecycle.lifecycle.push({
            phase: 'abandoned',
            startedAt: new Date()
          });

          this.updateCreatorStats(lifecycle.creator, 'abandoned');
          await this.storeTokenLifecycle(lifecycle);
          
          // Remove from active tracking
          this.lifecycles.delete(mint);
        }
      }
    } catch (error) {
      this.logger.error('Error detecting abandoned tokens', error as Error);
    }
  }

  /**
   * Get lifecycle statistics
   */
  async getLifecycleStats(): Promise<TokenLifecycleStats> {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_created,
          COUNT(*) FILTER (WHERE lifecycle_status = 'bonding') as active_tokens,
          COUNT(*) FILTER (WHERE lifecycle_status = 'graduated') as graduated_tokens,
          COUNT(*) FILTER (WHERE lifecycle_status = 'abandoned') as abandoned_tokens,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as created_24h,
          COUNT(*) FILTER (WHERE lifecycle_status = 'graduated' AND migration_started_at > NOW() - INTERVAL '24 hours') as graduated_24h,
          AVG(EXTRACT(EPOCH FROM (migration_started_at - created_at))/3600) FILTER (WHERE lifecycle_status = 'graduated') as avg_time_to_graduation
        FROM token_lifecycle
        WHERE created_at > NOW() - INTERVAL '30 days'
      `);

      const stats = result.rows[0];
      const graduationRate = stats.total_created > 0 
        ? (parseFloat(stats.graduated_tokens) / parseFloat(stats.total_created)) * 100 
        : 0;

      // Get top creators
      const creatorsResult = await db.query(`
        SELECT 
          creator_address as address,
          tokens_created,
          tokens_graduated,
          graduation_rate as success_rate
        FROM creator_analysis
        ORDER BY tokens_graduated DESC, graduation_rate DESC
        LIMIT 10
      `);

      return {
        totalTokensCreated: parseInt(stats.total_created),
        activeTokens: parseInt(stats.active_tokens),
        graduatedTokens: parseInt(stats.graduated_tokens),
        abandonedTokens: parseInt(stats.abandoned_tokens),
        avgTimeToGraduation: parseFloat(stats.avg_time_to_graduation) || 0,
        graduationRate,
        tokensCreated24h: parseInt(stats.created_24h),
        tokensGraduated24h: parseInt(stats.graduated_24h),
        topCreators: creatorsResult.rows.map((row: any) => ({
          address: row.address,
          tokensCreated: parseInt(row.tokens_created),
          tokensGraduated: parseInt(row.tokens_graduated),
          successRate: parseFloat(row.success_rate)
        }))
      };
    } catch (error) {
      this.logger.error('Error getting lifecycle stats', error as Error);
      return {
        totalTokensCreated: 0,
        activeTokens: 0,
        graduatedTokens: 0,
        abandonedTokens: 0,
        avgTimeToGraduation: 0,
        graduationRate: 0,
        tokensCreated24h: 0,
        tokensGraduated24h: 0,
        topCreators: []
      };
    }
  }

  /**
   * Get lifecycle for a specific token
   */
  getTokenLifecycle(mintAddress: string): TokenLifecycle | undefined {
    return this.lifecycles.get(mintAddress) || 
           this.migrationTracker.getLifecycle(mintAddress);
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    // Clean up token detector cache
    this.tokenDetector.clearCache();
    
    // Clean up pool monitor cache
    this.poolMonitor.clearCache();
    
    // Clean up old lifecycles
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [mint, lifecycle] of this.lifecycles) {
      if (lifecycle.createdAt.getTime() < oneWeekAgo &&
          (lifecycle.currentPhase === 'abandoned' || lifecycle.currentPhase === 'graduated')) {
        this.lifecycles.delete(mint);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.info('Cleaned up old lifecycles', { removed });
    }
  }
}