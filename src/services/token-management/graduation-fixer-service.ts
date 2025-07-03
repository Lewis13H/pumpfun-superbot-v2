/**
 * Graduation Fixer Service
 * Automatically detects and fixes tokens that have graduated but aren't marked as such
 */

import { Logger } from '../../core/logger';
import { TokenRepository } from '../../repositories/token-repository';
import { EventBus, EVENTS } from '../../core/event-bus';
import chalk from 'chalk';

export class GraduationFixerService {
  private logger: Logger;
  private checkInterval: NodeJS.Timeout | null = null;
  private isChecking = false;
  private lastCheckTime: Date | null = null;
  private fixedCount = 0;

  constructor(
    private tokenRepo: TokenRepository,
    private eventBus: EventBus
  ) {
    this.logger = new Logger({ 
      context: 'GraduationFixer', 
      color: chalk.magenta 
    });
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing graduation fixer service');
      
      // Run initial check
      await this.checkAndFixGraduatedTokens();
      
      // Set up periodic check (every 5 minutes)
      this.checkInterval = setInterval(() => {
        this.checkAndFixGraduatedTokens().catch(error => {
          this.logger.error('Error in periodic graduation check', error);
        });
      }, 5 * 60 * 1000);
      
      this.logger.info('Graduation fixer service initialized', {
        checkInterval: '5 minutes',
        initialFixedCount: this.fixedCount
      });
    } catch (error) {
      this.logger.error('Failed to initialize graduation fixer', error as Error);
      throw error;
    }
  }

  /**
   * Check and fix graduated tokens
   */
  async checkAndFixGraduatedTokens(): Promise<void> {
    if (this.isChecking) {
      this.logger.debug('Check already in progress, skipping');
      return;
    }

    this.isChecking = true;
    const startTime = Date.now();

    try {
      // Find tokens with AMM trades that aren't marked as graduated
      const findQuery = `
        WITH graduated_tokens AS (
          SELECT DISTINCT 
            t.mint_address,
            tok.symbol,
            MIN(CASE WHEN t.program = 'amm_pool' THEN t.block_time END) as first_amm_trade,
            COUNT(CASE WHEN t.program = 'amm_pool' THEN 1 END) as amm_trade_count,
            MAX(t.bonding_curve_progress) as max_bc_progress
          FROM trades_unified t
          INNER JOIN tokens_unified tok ON tok.mint_address = t.mint_address
          WHERE tok.graduated_to_amm = false
          GROUP BY t.mint_address, tok.symbol
          HAVING COUNT(CASE WHEN t.program = 'amm_pool' THEN 1 END) > 0
        )
        SELECT * FROM graduated_tokens
        ORDER BY first_amm_trade DESC
        LIMIT 100;
      `;

      const result = await this.tokenRepo.executeQuery(findQuery);
      const tokensToFix = result.rows || result;

      if (tokensToFix.length === 0) {
        if (this.lastCheckTime && Date.now() - this.lastCheckTime.getTime() > 60 * 60 * 1000) {
          // Log once per hour if no tokens need fixing
          this.logger.debug('No graduated tokens need fixing');
        }
        return;
      }

      this.logger.warn(`Found ${tokensToFix.length} tokens that need graduation fixing`);

      // Update tokens in batches
      const updateQuery = `
        UPDATE tokens_unified
        SET 
          graduated_to_amm = true,
          graduation_at = subquery.first_amm_trade,
          current_program = 'amm_pool',
          updated_at = NOW()
        FROM (
          SELECT DISTINCT 
            t.mint_address,
            MIN(CASE WHEN t.program = 'amm_pool' THEN t.block_time END) as first_amm_trade
          FROM trades_unified t
          INNER JOIN tokens_unified tok ON tok.mint_address = t.mint_address
          WHERE tok.graduated_to_amm = false
            AND t.program = 'amm_pool'
          GROUP BY t.mint_address
        ) AS subquery
        WHERE tokens_unified.mint_address = subquery.mint_address
        RETURNING tokens_unified.mint_address, tokens_unified.symbol;
      `;

      const updateResult = await this.tokenRepo.executeQuery(updateQuery);
      const fixedTokens = updateResult.rows || updateResult;

      if (fixedTokens.length > 0) {
        this.fixedCount += fixedTokens.length;
        
        this.logger.warn(`🔧 Fixed ${fixedTokens.length} graduated tokens:`, {
          tokens: fixedTokens.map((t: any) => ({
            symbol: t.symbol,
            mint: t.mint_address.substring(0, 8) + '...'
          })).slice(0, 5), // Show first 5
          totalFixed: this.fixedCount,
          duration: Date.now() - startTime + 'ms'
        });

        // Emit event for each fixed token
        for (const token of fixedTokens) {
          this.eventBus.emit(EVENTS.GRADUATION_FIXED, {
            mintAddress: token.mint_address,
            symbol: token.symbol,
            timestamp: new Date()
          });
        }
      }

      this.lastCheckTime = new Date();
    } catch (error) {
      this.logger.error('Error checking graduated tokens', error as Error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      fixedCount: this.fixedCount,
      lastCheckTime: this.lastCheckTime,
      isChecking: this.isChecking
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    this.logger.info('Graduation fixer service shut down', {
      totalFixed: this.fixedCount
    });
  }
}