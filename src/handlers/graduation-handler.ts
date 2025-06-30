/**
 * Graduation Event Handler
 * Manages bonding curve to mint address mapping and graduation tracking
 */

import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { TokenRepository } from '../repositories/token-repository';
import { UnifiedDbServiceV2 } from '../database/unified-db-service';
import { Trade } from '../repositories/trade-repository';
import chalk from 'chalk';

interface BondingCurveMapping {
  bondingCurve: string;
  mintAddress: string;
  firstSeen: Date;
  lastUpdated: Date;
  graduated: boolean;
}

export class GraduationHandler {
  private logger: Logger;
  private bondingCurveCache: Map<string, BondingCurveMapping> = new Map();
  private pendingGraduations: Map<string, any> = new Map();
  private initialized: boolean = false;

  constructor(
    private eventBus: EventBus,
    private tokenRepo: TokenRepository,
    private dbService: UnifiedDbServiceV2
  ) {
    this.logger = new Logger({ context: 'GraduationHandler', color: chalk.magenta });
    this.setupEventListeners();
  }

  /**
   * Initialize the handler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load existing mappings from database
      await this.loadExistingMappings();
      
      this.logger.info('Graduation handler initialized', {
        cachedMappings: this.bondingCurveCache.size
      });
      
      this.initialized = true;
    } catch (error) {
      this.logger.error('Failed to initialize graduation handler', error as Error);
      throw error;
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for new trades to build bonding curve mappings
    this.eventBus.on(EVENTS.TRADE_PROCESSED, this.handleNewTrade.bind(this));
    
    // Listen for graduation events from account monitor
    this.eventBus.on(EVENTS.TOKEN_GRADUATED, this.handleGraduation.bind(this));
    
    // Listen for bonding curve creation events
    this.eventBus.on(EVENTS.BONDING_CURVE_CREATED, this.handleBondingCurveCreation.bind(this));
  }

  /**
   * Load existing bonding curve mappings from database
   */
  private async loadExistingMappings(): Promise<void> {
    try {
      // Query recent trades to build initial mapping
      const result = await this.tokenRepo.query(`
        SELECT DISTINCT 
          t.mint_address,
          t.bonding_curve_key,
          MIN(t.block_time) as first_seen,
          MAX(t.block_time) as last_updated,
          tok.graduated_to_amm as graduated
        FROM trades_unified t
        LEFT JOIN tokens_unified tok ON tok.mint_address = t.mint_address
        WHERE t.program = 'bonding_curve' 
          AND t.bonding_curve_key IS NOT NULL
          AND t.block_time > NOW() - INTERVAL '7 days'
        GROUP BY t.mint_address, t.bonding_curve_key, tok.graduated_to_amm
      `);

      for (const row of (result.rows || result)) {
        if (row.bonding_curve_key && row.mint_address) {
          this.bondingCurveCache.set(row.bonding_curve_key, {
            bondingCurve: row.bonding_curve_key,
            mintAddress: row.mint_address,
            firstSeen: new Date(row.first_seen),
            lastUpdated: new Date(row.last_updated),
            graduated: row.graduated || false
          });
        }
      }

      this.logger.info('Loaded bonding curve mappings', {
        mappings: this.bondingCurveCache.size
      });
    } catch (error) {
      this.logger.error('Failed to load existing mappings', error as Error);
    }
  }

  /**
   * Handle new trade to extract bonding curve mapping
   */
  private async handleNewTrade(trade: Trade): Promise<void> {
    // Only process bonding curve trades
    if (trade.program !== 'bonding_curve' || !trade.bondingCurveKey) {
      return;
    }

    // Update or create mapping
    const existing = this.bondingCurveCache.get(trade.bondingCurveKey);
    if (!existing) {
      this.bondingCurveCache.set(trade.bondingCurveKey, {
        bondingCurve: trade.bondingCurveKey,
        mintAddress: trade.mintAddress,
        firstSeen: new Date(trade.blockTime),
        lastUpdated: new Date(trade.blockTime),
        graduated: false
      });

      // Store in database for persistence
      await this.storeBondingCurveMapping(trade.bondingCurveKey, trade.mintAddress);
    } else {
      existing.lastUpdated = new Date(trade.blockTime);
    }
  }

  /**
   * Handle bonding curve creation event
   */
  private async handleBondingCurveCreation(event: any): Promise<void> {
    const { bondingCurve, mintAddress, creator, slot } = event;
    
    if (!bondingCurve || !mintAddress) return;

    this.bondingCurveCache.set(bondingCurve, {
      bondingCurve,
      mintAddress,
      firstSeen: new Date(),
      lastUpdated: new Date(),
      graduated: false
    });

    await this.storeBondingCurveMapping(bondingCurve, mintAddress);
    
    this.logger.debug('Bonding curve created', {
      bondingCurve,
      mintAddress,
      creator
    });
  }

  /**
   * Store bonding curve mapping in database
   */
  private async storeBondingCurveMapping(bondingCurve: string, mintAddress: string): Promise<void> {
    try {
      await this.tokenRepo.query(`
        INSERT INTO bonding_curve_mappings (bonding_curve_key, mint_address)
        VALUES ($1, $2)
        ON CONFLICT (bonding_curve_key) DO UPDATE
        SET mint_address = $2, updated_at = NOW()
      `, [bondingCurve, mintAddress]);
    } catch (error) {
      // Table might not exist yet, create it
      if (error.message?.includes('does not exist')) {
        await this.createMappingTable();
        // Retry the insert
        await this.storeBondingCurveMapping(bondingCurve, mintAddress);
      } else {
        this.logger.error('Failed to store bonding curve mapping', error as Error);
      }
    }
  }

  /**
   * Create bonding curve mapping table
   */
  private async createMappingTable(): Promise<void> {
    await this.tokenRepo.query(`
      CREATE TABLE IF NOT EXISTS bonding_curve_mappings (
        bonding_curve_key VARCHAR(64) PRIMARY KEY,
        mint_address VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(mint_address)
      );
      
      CREATE INDEX IF NOT EXISTS idx_bc_mappings_mint ON bonding_curve_mappings(mint_address);
    `);
  }

  /**
   * Handle graduation event from account monitor
   */
  private async handleGraduation(event: any): Promise<void> {
    const { bondingCurveKey, virtualSolReserves, virtualTokenReserves, complete, slot } = event;
    
    if (!bondingCurveKey) return;

    // Store pending graduation data
    this.pendingGraduations.set(bondingCurveKey, event);

    // Try to find mint address
    const mintAddress = await this.getMintForBondingCurve(bondingCurveKey);
    
    if (mintAddress) {
      // Process graduation immediately
      await this.processGraduation(mintAddress, bondingCurveKey, event);
    } else {
      // Queue for later processing when we find the mint
      this.logger.warn('Graduation detected but mint unknown', {
        bondingCurve: bondingCurveKey,
        complete,
        virtualSOL: (Number(virtualSolReserves) / 1e9).toFixed(2)
      });
      
      // Try alternative methods to find mint
      await this.attemptMintRecovery(bondingCurveKey);
    }
  }

  /**
   * Get mint address for bonding curve
   */
  async getMintForBondingCurve(bondingCurve: string): Promise<string | null> {
    // Check cache first
    const cached = this.bondingCurveCache.get(bondingCurve);
    if (cached) {
      return cached.mintAddress;
    }

    // Check database
    try {
      const result = await this.tokenRepo.query(`
        SELECT mint_address 
        FROM bonding_curve_mappings 
        WHERE bonding_curve_key = $1
      `, [bondingCurve]);

      if (result.rows.length > 0) {
        const mintAddress = result.rows[0].mint_address;
        
        // Update cache
        this.bondingCurveCache.set(bondingCurve, {
          bondingCurve,
          mintAddress,
          firstSeen: new Date(),
          lastUpdated: new Date(),
          graduated: false
        });
        
        return mintAddress;
      }
    } catch (error) {
      // Table might not exist
    }

    // Try to find from recent trades
    try {
      const result = await this.tokenRepo.query(`
        SELECT DISTINCT mint_address 
        FROM trades_unified 
        WHERE bonding_curve_key = $1 
        LIMIT 1
      `, [bondingCurve]);

      if (result.rows.length > 0) {
        return result.rows[0].mint_address;
      }
    } catch (error) {
      // Column might not exist
    }

    return null;
  }

  /**
   * Attempt to recover mint address through various methods
   */
  private async attemptMintRecovery(bondingCurve: string): Promise<void> {
    // Method 1: Check recent trades with high activity
    try {
      const result = await this.tokenRepo.query(`
        SELECT t.mint_address, COUNT(*) as trade_count
        FROM trades_unified t
        WHERE t.program = 'bonding_curve'
          AND t.block_time > NOW() - INTERVAL '1 hour'
          AND t.bonding_curve_progress > 90
        GROUP BY t.mint_address
        HAVING COUNT(*) > 10
        ORDER BY MAX(t.block_time) DESC
        LIMIT 10
      `);

      // For each high-activity token, we could verify if it matches our bonding curve
      // This would require additional on-chain verification
      if (result.rows.length > 0) {
        this.logger.debug('Found potential mint candidates for graduation', {
          bondingCurve,
          candidates: result.rows.length
        });
      }
    } catch (error) {
      this.logger.error('Failed mint recovery attempt', error as Error);
    }
  }

  /**
   * Process graduation for a token
   */
  private async processGraduation(
    mintAddress: string, 
    bondingCurve: string, 
    graduationData: any
  ): Promise<void> {
    try {
      const { virtualSolReserves, virtualTokenReserves, complete, slot } = graduationData;
      
      // Update token as graduated
      await this.tokenRepo.update(mintAddress, {
        graduatedToAmm: true,
        graduationAt: new Date(),
        graduationSlot: slot,
        priceSource: 'graduated'
      });

      // Update cache
      const cached = this.bondingCurveCache.get(bondingCurve);
      if (cached) {
        cached.graduated = true;
      }

      // Remove from pending
      this.pendingGraduations.delete(bondingCurve);

      const virtualSOL = Number(virtualSolReserves) / 1e9;
      
      this.logger.warn('🎓 Token Graduation Processed!', {
        mintAddress,
        bondingCurve: bondingCurve.substring(0, 8) + '...',
        virtualSOL: virtualSOL.toFixed(2) + ' SOL',
        complete,
        slot
      });

      // Emit graduation processed event
      this.eventBus.emit(EVENTS.GRADUATION_PROCESSED, {
        mintAddress,
        bondingCurve,
        virtualSolReserves,
        virtualTokenReserves,
        complete,
        slot,
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.error('Failed to process graduation', error as Error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      bondingCurveMappings: this.bondingCurveCache.size,
      pendingGraduations: this.pendingGraduations.size,
      graduatedTokens: Array.from(this.bondingCurveCache.values()).filter(m => m.graduated).length
    };
  }

  /**
   * Process any pending graduations (called periodically)
   */
  async processPendingGraduations(): Promise<void> {
    if (this.pendingGraduations.size === 0) return;

    for (const [bondingCurve, graduationData] of this.pendingGraduations) {
      const mintAddress = await this.getMintForBondingCurve(bondingCurve);
      if (mintAddress) {
        await this.processGraduation(mintAddress, bondingCurve, graduationData);
      }
    }
  }
}