/**
 * Token Lifecycle Monitor
 * Unified monitor for token creation, bonding curve trading, and graduation
 * Consolidates BC transaction and account monitoring into a single domain-focused monitor
 */

import chalk from 'chalk';
import * as borsh from '@coral-xyz/borsh';
import { BaseMonitor, MonitorOptions } from '../../core/base-monitor';
import { Container, TOKENS } from '../../core/container';
import { EventType, TradeType } from '../../utils/parsers/types';
import { UnifiedEventParser } from '../../utils/parsers/unified-event-parser';
import { TradeHandler } from '../../handlers/trade-handler';
// TokenLifecycleService functionality integrated directly into this monitor
import { PUMP_PROGRAM } from '../../utils/config/constants';
import { EVENTS } from '../../core/event-bus';
import { enableErrorSuppression } from '../../utils/parsers/error-suppressor';
import { performanceMonitor } from '../../services/monitoring/performance-monitor';
import { SmartStreamManager } from '../../services/core/smart-stream-manager';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BondingCurveAccountHandler } from './bonding-curve-account-handler';
import * as fs from 'fs';

// Bonding curve account schema
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'),
]);

const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

interface TokenLifecycleStats {
  // Base monitor stats
  startTime: Date;
  transactions: number;
  errors: number;
  reconnections: number;
  
  // Transaction stats
  trades: number;
  buys: number;
  sells: number;
  volume: number;
  avgTradeSize: number;
  
  // Account stats
  accountUpdates: number;
  graduations: number;
  nearGraduations: number;
  
  // Token lifecycle stats
  tokensCreated: number;
  tokensAboveThreshold: number;
  activeTokens: Set<string>;
  graduatedTokens: Set<string>;
  
  // Performance stats
  parseErrors: number;
  avgParseTime: number;
  parseRate: number;
  eventSizes: Map<number, number>;
}

interface TokenState {
  mintAddress: string;
  bondingCurveKey?: string;
  creator?: string;
  firstSeen: Date;
  lastUpdate: Date;
  
  // Bonding curve state
  virtualSolReserves?: bigint;
  virtualTokenReserves?: bigint;
  realSolReserves?: bigint;
  realTokenReserves?: bigint;
  complete: boolean;
  progress: number;
  
  // Trading stats
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  totalVolume: number;
  
  // Price tracking
  currentPriceUsd?: number;
  currentMarketCapUsd?: number;
  highestMarketCapUsd?: number;
  
  // Lifecycle phase
  phase: 'created' | 'trading' | 'near-graduation' | 'graduated';
}

export class TokenLifecycleMonitor extends BaseMonitor {
  private parser!: UnifiedEventParser;
  private tradeHandler!: TradeHandler;
  // Remove unused lifecycleService - functionality is integrated directly
  protected stats: TokenLifecycleStats;
  private tokenStates: Map<string, TokenState> = new Map();
  private parseTimings: number[] = [];
  private smartStreamManager?: SmartStreamManager;
  private bcAccountHandler?: BondingCurveAccountHandler;
  private bondingCurveToMint: Map<string, string> = new Map();

  constructor(container: Container, options?: Partial<MonitorOptions>) {
    super(
      {
        programId: PUMP_PROGRAM,
        monitorName: 'Token Lifecycle Monitor',
        color: chalk.magenta as any,
        includeFailedTxs: options?.includeFailedTxs ?? false,
        requiredAccounts: options?.requiredAccounts,
        excludeAccounts: options?.excludeAccounts,
        trackSlots: options?.trackSlots ?? false,
        dataSlicing: options?.dataSlicing ?? true, // Enable for account monitoring
        filters: options?.filters,
        fromSlot: options?.fromSlot,
        commitment: options?.commitment ?? 'confirmed'
      },
      container
    );

    // Initialize stats
    this.stats = {
      // Base monitor stats
      startTime: new Date(),
      transactions: 0,
      errors: 0,
      reconnections: 0,
      // Transaction stats
      trades: 0,
      buys: 0,
      sells: 0,
      volume: 0,
      avgTradeSize: 0,
      accountUpdates: 0,
      graduations: 0,
      nearGraduations: 0,
      tokensCreated: 0,
      tokensAboveThreshold: 0,
      activeTokens: new Set(),
      graduatedTokens: new Set(),
      parseErrors: 0,
      avgParseTime: 0,
      parseRate: 0,
      eventSizes: new Map()
    };
  }

  /**
   * Get subscription key
   */
  protected getSubscriptionKey(): string {
    return 'token_lifecycle';
  }

  /**
   * Get subscription group for smart routing
   */
  protected getSubscriptionGroup(): string {
    return 'bonding_curve'; // High priority group
  }

  /**
   * Build enhanced subscribe request for both transactions and accounts
   */
  protected buildEnhancedSubscribeRequest(): any {
    const builder = this.subscriptionBuilder;
    
    // Set commitment level
    builder.setCommitment('confirmed');
    
    // Add transaction subscription for trades
    builder.addTransactionSubscription('token_lifecycle_txn', {
      vote: false,
      failed: this.options.includeFailedTxs || false,
      accountInclude: [this.options.programId],
      accountRequired: this.options.requiredAccounts || [],
      accountExclude: this.options.excludeAccounts || []
    });
    
    // Add account subscription for bonding curve state changes
    // Using owner filter to get all pump.fun owned accounts (including bonding curves)
    builder.addAccountSubscription('token_lifecycle_acc', {
      owner: [this.options.programId], // This will capture all pump.fun accounts including bonding curves
      filters: this.buildAccountFilters(),
      nonemptyTxnSignature: false // We want all account updates, not just from transactions
    });
    
    // Set group priority if available
    if ('setGroup' in builder) {
      (builder as any).setGroup(this.getSubscriptionGroup());
    }
    
    return builder.build();
  }

  /**
   * Build account filters for BC monitoring
   */
  protected buildAccountFilters(): any[] {
    const filters = [];
    
    // Add custom filters if provided
    if (this.options.filters) {
      filters.push(...this.options.filters);
    }
    
    return filters;
  }

  /**
   * Get data slice configuration for BC accounts
   */
  protected getDataSliceConfig(): { offset: string; length: string } | null {
    // Bonding curve account data - we need the full account to decode it
    // The account is ~165 bytes but we'll get all data to be safe
    return null; // Get full account data
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Enable error suppression
    enableErrorSuppression({
      suppressParserWarnings: true,
      suppressComputeBudget: true,
      suppressUnknownPrograms: true,
      logSuppressionStats: false
    });
    
    // Get services
    this.parser = await this.container.resolve(TOKENS.EventParser);
    this.tradeHandler = await this.container.resolve(TOKENS.TradeHandler);
    // Lifecycle functionality is integrated directly into this monitor
    
    // Get smart stream manager if available
    try {
      const streamManager = await this.container.resolve(TOKENS.StreamManager);
      if (streamManager && 'getLoadMetrics' in streamManager) {
        this.smartStreamManager = streamManager as SmartStreamManager;
      }
    } catch {
      // SmartStreamManager not available
    }
    
    // Initialize BondingCurveAccountHandler if IDL is available
    try {
      const idlPath = './src/idls/pump_0.1.0.json';
      if (fs.existsSync(idlPath)) {
        const programIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
        this.bcAccountHandler = new BondingCurveAccountHandler(
          programIdl,
          this.eventBus,
          this.bondingCurveToMint
        );
        this.logger.info('BondingCurveAccountHandler initialized with pump.fun IDL');
      } else {
        this.logger.warn('pump.fun IDL not found at ' + idlPath + ', using basic account parsing');
      }
    } catch (error) {
      this.logger.error('Failed to initialize BondingCurveAccountHandler', error as Error);
    }
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Start periodic reporting
    setInterval(() => this.reportStats(), 30000); // Every 30 seconds
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Token events
    this.eventBus.on(EVENTS.TOKEN_DISCOVERED, (token) => {
      this.stats.tokensCreated++;
      this.stats.activeTokens.add(token.mintAddress);
      
      // Initialize token state
      this.tokenStates.set(token.mintAddress, {
        mintAddress: token.mintAddress,
        firstSeen: new Date(),
        lastUpdate: new Date(),
        complete: false,
        progress: 0,
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        totalVolume: 0,
        phase: 'created'
      });
      
      this.logger.info('Token created', {
        mint: token.mintAddress,
        marketCap: token.currentMarketCapUsd
      });
    });

    this.eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
      this.stats.graduations++;
      this.stats.graduatedTokens.add(data.mintAddress);
      
      const state = this.tokenStates.get(data.mintAddress);
      if (state) {
        state.phase = 'graduated';
        state.complete = true;
        state.progress = 100;
      }
      
      this.logger.info('🎓 Token graduated!', {
        mint: data.mintAddress,
        slot: data.graduationSlot
      });
    });

    this.eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data) => {
      this.stats.tokensAboveThreshold++;
      
      this.logger.info('💰 Token crossed threshold!', {
        mint: data.mintAddress,
        marketCap: data.marketCapUsd,
        threshold: data.threshold
      });
    });
    
    // Listen for bonding curve updates from the account handler
    if (this.bcAccountHandler) {
      this.eventBus.on(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, async (data) => {
        const state = this.tokenStates.get(data.mintAddress);
        if (state) {
          state.progress = data.progress;
          state.complete = data.complete;
          state.virtualSolReserves = data.virtualSolReserves;
          state.virtualTokenReserves = data.virtualTokenReserves;
          state.lastUpdate = new Date();
          
          // Update phase based on progress
          if (data.complete) {
            state.phase = 'graduated';
          } else if (data.progress >= 90) {
            state.phase = 'near-graduation';
          }
        }
        
        // Update database with bonding curve complete status
        if (data.mintAddress) {
          try {
            const db = await this.container.resolve(TOKENS.DatabaseService);
            await db.query(
              `UPDATE tokens_unified 
               SET bonding_curve_complete = $1,
                   latest_bonding_curve_progress = $2,
                   updated_at = NOW()
               WHERE mint_address = $3`,
              [data.complete, data.progress, data.mintAddress]
            );
            
            this.logger.debug('Updated BC complete status in DB', {
              mint: data.mintAddress.substring(0, 8) + '...',
              complete: data.complete,
              progress: data.progress.toFixed(2)
            });
          } catch (error) {
            this.logger.error('Failed to update BC complete status', error as Error);
          }
        }
      });
    }
  }

  /**
   * Process stream data (handles both transactions and accounts)
   */
  async processStreamData(data: any): Promise<void> {
    const startTime = Date.now();
    
    // Debug: Log first few messages
    if (this.stats.transactions < 3) {
      console.log(`🔍 TokenLifecycle processing data:`, {
        hasTransaction: !!data.transaction,
        hasAccount: !!data.account,
        filters: data.filters
      });
    }
    
    try {
      // Record message with smart stream manager if available
      if (this.smartStreamManager) {
        const messageId = `${Date.now()}-${Math.random()}`;
        const connectionId = data.connectionId || 'default';
        this.smartStreamManager['loadBalancer']?.recordMessageStart(connectionId, messageId);
        
        // Process message
        await this.processMessage(data);
        
        // Record completion
        const messageSize = JSON.stringify(data).length;
        this.smartStreamManager['loadBalancer']?.recordMessageComplete(
          connectionId, 
          messageId, 
          true, 
          messageSize
        );
      } else {
        await this.processMessage(data);
      }
      
      // Track parse timing
      const parseTime = Date.now() - startTime;
      this.parseTimings.push(parseTime);
      if (this.parseTimings.length > 1000) {
        this.parseTimings.shift();
      }
      
      // Update average parse time
      this.stats.avgParseTime = this.parseTimings.reduce((a, b) => a + b, 0) / this.parseTimings.length;
      
    } catch (error) {
      this.stats.parseErrors++;
      if (this.shouldLogError(error as Error)) {
        this.logger.error('Failed to process stream data', error as Error);
        performanceMonitor.recordError('TokenLifecycleMonitor', error as Error);
      }
    }
  }

  /**
   * Process a single message (transaction or account update)
   */
  private async processMessage(data: any): Promise<void> {
    // Handle account updates
    if (data.account) {
      await this.processAccountUpdate(data);
      return;
    }
    
    // Handle transactions
    if (data.transaction) {
      await this.processTransaction(data);
      return;
    }
  }

  /**
   * Process account update (from BC account monitor)
   */
  private async processAccountUpdate(data: any): Promise<void> {
    this.stats.accountUpdates++;
    
    // Debug log for first few account updates
    if (this.stats.accountUpdates <= 5) {
      this.logger.debug('Processing account update', {
        updateNumber: this.stats.accountUpdates,
        hasHandler: !!this.bcAccountHandler,
        dataKeys: Object.keys(data),
        accountKeys: data.account ? Object.keys(data.account) : []
      });
    }
    
    // If we have the account handler, use it for more robust parsing
    if (this.bcAccountHandler) {
      await this.bcAccountHandler.processAccountUpdate(data);
      return;
    }
    
    // Fallback to basic parsing if no handler
    const accountInfo = data.account;
    if (!accountInfo || !accountInfo.account) return;
    
    try {
      // Get the actual account data - structure matches Shyft examples
      const account = accountInfo.account;
      if (!account.data || account.data.length === 0) return;
      
      // Convert base64 data to buffer - data is an array, take first element
      const accountData = Buffer.from(account.data[0], 'base64');
      
      // Check discriminator
      const discriminator = accountData.slice(0, 8);
      const expectedDiscriminator = Buffer.from(BONDING_CURVE_DISCRIMINATOR);
      
      if (!discriminator.equals(expectedDiscriminator)) {
        return; // Not a bonding curve account
      }
      
      // Parse bonding curve data
      const bcData = BONDING_CURVE_SCHEMA.decode(accountData.slice(8));
      
      // Calculate progress using account lamports (as per Shyft examples)
      const lamports = account.lamports || 0;
      const solInCurve = lamports / LAMPORTS_PER_SOL;
      const GRADUATION_SOL_TARGET = 84; // 84 SOL as per Shyft examples, not 85
      const progress = Math.min((solInCurve / GRADUATION_SOL_TARGET) * 100, 100);
      
      // Get the bonding curve address
      const bondingCurveAddress = account.pubkey ? 
        (typeof account.pubkey === 'string' ? account.pubkey : Buffer.from(account.pubkey).toString('base64')) : 
        'unknown';
      
      // Get or find mint address for this bonding curve
      const mintAddress = await this.findMintForBondingCurve(bondingCurveAddress);
      if (!mintAddress) return;
      
      // Update token state
      let state = this.tokenStates.get(mintAddress);
      if (!state) {
        state = {
          mintAddress,
          bondingCurveKey: accountInfo.pubkey,
          creator: bcData.creator.toString(),
          firstSeen: new Date(),
          lastUpdate: new Date(),
          complete: bcData.complete,
          progress,
          tradeCount: 0,
          buyCount: 0,
          sellCount: 0,
          totalVolume: 0,
          phase: 'created'
        };
        this.tokenStates.set(mintAddress, state);
      }
      
      // Update state
      state.virtualSolReserves = bcData.virtualSolReserves;
      state.virtualTokenReserves = bcData.virtualTokenReserves;
      state.realSolReserves = bcData.realSolReserves;
      state.realTokenReserves = bcData.realTokenReserves;
      state.complete = bcData.complete;
      state.progress = progress;
      state.lastUpdate = new Date();
      
      // Check for graduation
      if (bcData.complete && !state.phase.includes('graduated')) {
        state.phase = 'graduated';
        this.stats.graduations++;
        
        // Emit graduation event
        this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
          mintAddress,
          bondingCurveKey: accountInfo.pubkey,
          graduationSlot: data.slot,
          timestamp: new Date(),
          finalSolReserves: Number(bcData.virtualSolReserves) / LAMPORTS_PER_SOL,
          creator: bcData.creator.toString()
        });
        
        // Also emit bonding curve progress update for consistency
        this.eventBus.emit(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, {
          bondingCurveAddress: bondingCurveAddress,
          mintAddress,
          progress: 100,
          complete: true,
          lamports,
          solInCurve,
          virtualSolReserves: bcData.virtualSolReserves,
          virtualTokenReserves: bcData.virtualTokenReserves
        });
        
        this.logger.info('🎓 Graduation detected via account update!', {
          mint: mintAddress,
          bondingCurve: bondingCurveAddress.substring(0, 8) + '...',
          progress: progress.toFixed(2) + '%',
          slot: data.slot,
          finalSol: solInCurve.toFixed(2)
        });
      } else if (progress > 90 && state.phase !== 'near-graduation') {
        state.phase = 'near-graduation';
        this.stats.nearGraduations++;
        
        this.logger.warn(`⚠️ Near graduation: ${progress.toFixed(1)}%`, {
          mint: mintAddress,
          solInCurve: solInCurve.toFixed(2)
        });
      }
      
      // Emit progress update for all account updates
      this.eventBus.emit(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, {
        bondingCurveAddress: bondingCurveAddress,
        mintAddress,
        progress,
        complete: bcData.complete,
        lamports,
        solInCurve,
        virtualSolReserves: bcData.virtualSolReserves,
        virtualTokenReserves: bcData.virtualTokenReserves
      });
      
    } catch (error) {
      this.stats.parseErrors++;
      if (this.shouldLogError(error as Error)) {
        this.logger.error('Failed to parse account update', error as Error);
      }
    }
  }

  /**
   * Process transaction (from BC transaction monitor)
   */
  private async processTransaction(data: any): Promise<void> {
    const context = UnifiedEventParser.createContext(data);
    
    // Track event size
    if (context.data) {
      const size = context.data.length;
      this.stats.eventSizes.set(
        size, 
        (this.stats.eventSizes.get(size) || 0) + 1
      );
    }
    
    // Parse the event
    const event = this.parser.parse(context);
    
    if (!event) {
      this.stats.parseErrors++;
      if (this.stats.parseErrors < 3) {
        console.log(`❌ TokenLifecycle parse error #${this.stats.parseErrors}`);
      }
      return;
    }
    
    // Debug: Log successful parse
    if (this.stats.transactions < 3) {
      console.log(`✅ TokenLifecycle parsed event:`, {
        type: event.type,
        mintAddress: event.mintAddress?.substring(0, 8) + '...',
        signature: event.signature?.substring(0, 8) + '...'
      });
    }
    
    // Handle token creation events (check if it's a creation event)
    // Token creation is typically the first trade on a new bonding curve
    if (event.type === EventType.BC_TRADE && !this.tokenStates.has(event.mintAddress)) {
      // This is likely a token creation - first trade
      await this.handleTokenCreation(event);
    }
    
    // Only process BC trades
    if (event.type !== EventType.BC_TRADE) {
      return;
    }
    
    // Update stats
    this.stats.trades++;
    if (event.tradeType === TradeType.BUY) {
      this.stats.buys++;
    } else {
      this.stats.sells++;
    }
    
    // Calculate volume
    const volumeUsd = Number(event.solAmount) / 1e9 * this.currentSolPrice;
    this.stats.volume += volumeUsd;
    
    // Update token state
    let state = this.tokenStates.get(event.mintAddress);
    if (!state) {
      state = {
        mintAddress: event.mintAddress,
        firstSeen: new Date(),
        lastUpdate: new Date(),
        complete: false,
        progress: 0,
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        totalVolume: 0,
        phase: 'trading'
      };
      this.tokenStates.set(event.mintAddress, state);
    }
    
    // Update trading stats
    state.tradeCount++;
    if (event.tradeType === TradeType.BUY) {
      state.buyCount++;
    } else {
      state.sellCount++;
    }
    state.totalVolume += volumeUsd;
    state.lastUpdate = new Date();
    
    // Track bonding curve state if available
    if ('bondingCurveKey' in event) {
      state.bondingCurveKey = event.bondingCurveKey;
      
      // Track bonding curve to mint mapping for account updates
      if (event.bondingCurveKey && event.mintAddress) {
        this.bondingCurveToMint.set(event.bondingCurveKey, event.mintAddress);
        
        // Also update the handler if available
        if (this.bcAccountHandler) {
          this.bcAccountHandler.addMapping(event.bondingCurveKey, event.mintAddress);
        }
      }
      
      if (event.vSolInBondingCurve) {
        state.virtualSolReserves = event.vSolInBondingCurve;
        const progress = this.calculateBondingCurveProgress(event.vSolInBondingCurve);
        state.progress = progress;
        
        if (progress > 90 && state.phase !== 'near-graduation') {
          state.phase = 'near-graduation';
          this.stats.nearGraduations++;
        }
      }
      
      if (event.vTokenInBondingCurve) {
        state.virtualTokenReserves = event.vTokenInBondingCurve;
      }
    }
    
    // Process the trade
    const tradeResult = await this.tradeHandler.processTrade(event, this.currentSolPrice);
    
    // Update price info if available
    if (tradeResult && typeof tradeResult === 'object' && 'marketCapUsd' in tradeResult) {
      const marketCapUsd = Number(tradeResult.marketCapUsd);
      const priceUsd = 'priceUsd' in tradeResult ? Number(tradeResult.priceUsd) : undefined;
      
      state.currentMarketCapUsd = marketCapUsd;
      if (priceUsd !== undefined) {
        state.currentPriceUsd = priceUsd;
      }
      
      // Track highest market cap
      if (!state.highestMarketCapUsd || marketCapUsd > state.highestMarketCapUsd) {
        state.highestMarketCapUsd = marketCapUsd;
      }
      
      // Check milestones
      this.checkMilestones(state, marketCapUsd);
      
      // Update phase based on market activity
      if (state.phase === 'created' && state.tradeCount > 5) {
        state.phase = 'trading';
        this.eventBus.emit(EVENTS.TOKEN_LIFECYCLE_PHASE_CHANGE, {
          mintAddress: state.mintAddress,
          oldPhase: 'created',
          newPhase: 'trading',
          metadata: {
            marketCapUsd,
            tradeCount: state.tradeCount
          }
        });
      }
    }
    
    // Log high-value trades
    if (volumeUsd > 1000) {
      this.logger.info('🐋 High-value trade', {
        type: event.tradeType,
        volume: `$${volumeUsd.toFixed(2)}`,
        mint: event.mintAddress.substring(0, 8) + '...',
        user: event.userAddress.substring(0, 8) + '...',
        progress: state.progress.toFixed(1) + '%'
      });
    }
  }

  /**
   * Calculate bonding curve progress
   */
  private calculateBondingCurveProgress(virtualSolReserves: bigint): number {
    const solInCurve = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
    const GRADUATION_SOL_TARGET = 84; // 84 SOL as per Shyft examples
    const progress = (solInCurve / GRADUATION_SOL_TARGET) * 100;
    return Math.min(progress, 100);
  }

  /**
   * Handle token creation event
   */
  private async handleTokenCreation(event: any): Promise<void> {
    this.stats.tokensCreated++;
    this.stats.activeTokens.add(event.mintAddress);
    
    // Initialize token state
    const state: TokenState = {
      mintAddress: event.mintAddress,
      bondingCurveKey: event.bondingCurveKey,
      creator: event.creatorAddress,
      firstSeen: new Date(),
      lastUpdate: new Date(),
      complete: false,
      progress: 0,
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      totalVolume: 0,
      phase: 'created',
      virtualSolReserves: event.virtualSolReserves,
      virtualTokenReserves: event.virtualTokenReserves
    };
    
    this.tokenStates.set(event.mintAddress, state);
    
    // Emit token discovered event
    this.eventBus.emit(EVENTS.TOKEN_DISCOVERED, {
      mintAddress: event.mintAddress,
      bondingCurveKey: event.bondingCurveKey,
      creatorAddress: event.creatorAddress,
      currentMarketCapUsd: 0, // Will be calculated on first trade
      timestamp: new Date()
    });
    
    // Emit lifecycle creation event
    this.eventBus.emit(EVENTS.TOKEN_LIFECYCLE_CREATED, {
      mintAddress: event.mintAddress,
      phase: 'created',
      metadata: {
        bondingCurveKey: event.bondingCurveKey,
        creator: event.creatorAddress,
        initialReserves: {
          sol: Number(event.virtualSolReserves || 0) / LAMPORTS_PER_SOL,
          token: Number(event.virtualTokenReserves || 0) / 1e6
        }
      }
    });
    
    this.logger.info('🌱 Token created', {
      mint: event.mintAddress,
      creator: event.creatorAddress?.substring(0, 8) + '...'
    });
  }

  /**
   * Check if token has reached market cap milestones
   */
  private checkMilestones(state: TokenState, marketCapUsd: number): void {
    const milestones = [1000, 5000, 10000, 25000, 50000, 100000];
    
    for (const milestone of milestones) {
      if (marketCapUsd >= milestone && (!state.highestMarketCapUsd || state.highestMarketCapUsd < milestone)) {
        this.eventBus.emit(EVENTS.TOKEN_MILESTONE_REACHED, {
          mintAddress: state.mintAddress,
          milestone,
          marketCapUsd,
          phase: state.phase,
          metadata: {
            tradeCount: state.tradeCount,
            volume: state.totalVolume,
            progress: state.progress
          }
        });
        
        this.logger.info(`🏆 Milestone reached: $${milestone.toLocaleString()}`, {
          mint: state.mintAddress.substring(0, 8) + '...',
          marketCap: `$${marketCapUsd.toFixed(0)}`
        });
      }
    }
  }

  /**
   * Find mint address for a bonding curve (lookup from database)
   */
  private async findMintForBondingCurve(bondingCurveKey: string): Promise<string | null> {
    try {
      // First check our in-memory mapping
      if (this.bondingCurveToMint.has(bondingCurveKey)) {
        return this.bondingCurveToMint.get(bondingCurveKey)!;
      }
      
      // Then check our token states
      for (const [mint, state] of this.tokenStates) {
        if (state.bondingCurveKey === bondingCurveKey) {
          return mint;
        }
      }
      
      // Fallback to database lookup
      const db = await this.container.resolve(TOKENS.DatabaseService);
      const result = await db.query(
        'SELECT mint FROM bonding_curve_mappings WHERE bonding_curve = $1',
        [bondingCurveKey]
      );
      
      if (result.rows.length > 0) {
        return result.rows[0].mint;
      }
      
      return null;
    } catch (error) {
      this.logger.error('Error finding mint for bonding curve', error as Error);
      return null;
    }
  }

  /**
   * Report statistics
   */
  private reportStats(): void {
    const parseRate = this.stats.trades > 0 
      ? ((this.stats.trades / (this.stats.trades + this.stats.parseErrors)) * 100).toFixed(2)
      : '0';
    
    const avgTradeSize = this.stats.trades > 0
      ? this.stats.volume / this.stats.trades
      : 0;
    
    this.logger.info('📊 Token Lifecycle Stats', {
      // Trading stats
      trades: this.stats.trades,
      buys: this.stats.buys,
      sells: this.stats.sells,
      volume: `$${this.stats.volume.toFixed(2)}`,
      avgTradeSize: `$${avgTradeSize.toFixed(2)}`,
      
      // Account stats
      accountUpdates: this.stats.accountUpdates,
      accountHandler: this.bcAccountHandler ? 'active' : 'fallback',
      graduations: this.stats.graduations,
      nearGraduations: this.stats.nearGraduations,
      
      // Token stats
      activeTokens: this.stats.activeTokens.size,
      graduatedTokens: this.stats.graduatedTokens.size,
      tokensAboveThreshold: this.stats.tokensAboveThreshold,
      
      // Performance
      parseRate: `${parseRate}%`,
      avgParseTime: `${this.stats.avgParseTime.toFixed(2)}ms`,
      parseErrors: this.stats.parseErrors
    });
    
    // Report to performance monitor
    if ('updateStats' in performanceMonitor) {
      (performanceMonitor as any).updateStats('TokenLifecycleMonitor', {
      tps: this.stats.trades / 30, // 30 second intervals
      parseRate: parseFloat(parseRate),
      activeTokens: this.stats.activeTokens.size,
      graduations: this.stats.graduations
      });
    }
  }

  /**
   * Get current statistics
   */
  getStats(): TokenLifecycleStats {
    return { ...this.stats };
  }

  /**
   * Get token state
   */
  getTokenState(mintAddress: string): TokenState | undefined {
    return this.tokenStates.get(mintAddress);
  }

  /**
   * Display statistics (required by BaseMonitor)
   */
  displayStats(): void {
    this.reportStats();
  }
  
  /**
   * Should log error (required by BaseMonitor)
   */
  shouldLogError(error: Error): boolean {
    // Suppress common parsing errors
    const message = error.message?.toLowerCase() || '';
    if (message.includes('unknown program') || 
        message.includes('parse') ||
        message.includes('expected')) {
      return false;
    }
    return true;
  }
  
  /**
   * On shutdown (required by BaseMonitor)
   */
  async onShutdown(): Promise<void> {
    // Save final stats
    this.reportStats();
    
    // Clear state
    this.tokenStates.clear();
  }
}