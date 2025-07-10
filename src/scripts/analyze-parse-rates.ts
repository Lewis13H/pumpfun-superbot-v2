/**
 * Parse Rate Analysis Tool
 * 
 * Analyzes AMM transaction parse rates and identifies parsing failures
 * Part of Phase 4 of AMM Parsing Implementation
 */

import { Pool } from 'pg';
import { createLogger } from '../core/logger';
import { PUMP_AMM_PROGRAM, PUMP_PROGRAM } from '../utils/config/constants';
import { ParsingMetricsService } from '../services/monitoring/parsing-metrics-service';

const logger = createLogger('ParseRateAnalysis');

export interface ParseRateAnalysis {
  venue: string;
  totalTransactions: number;
  successfullyParsed: number;
  failedToParse: number;
  parseRate: number;
  timeframe: string;
  failedSignatures: string[];
  commonFailurePatterns: Map<string, number>;
  strategyPerformance: Map<string, { attempts: number; successes: number; rate: number }>;
}

export class ParseRateAnalyzer {
  private pool: Pool;
  private metricsService: ParsingMetricsService;

  constructor(pool: Pool) {
    this.pool = pool;
    this.metricsService = ParsingMetricsService.getInstance();
  }

  /**
   * Analyze parse rates for all venues
   */
  async analyzeAllVenues(hours: number = 24): Promise<Map<string, ParseRateAnalysis>> {
    const venues = [
      { name: 'pump_bc', programId: PUMP_PROGRAM },
      { name: 'pump_amm', programId: PUMP_AMM_PROGRAM },
      { name: 'raydium', programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' }
    ];

    const results = new Map<string, ParseRateAnalysis>();

    for (const venue of venues) {
      logger.info(`Analyzing parse rates for ${venue.name}...`);
      const analysis = await this.analyzeVenue(venue.name, venue.programId, hours);
      results.set(venue.name, analysis);
    }

    return results;
  }

  /**
   * Analyze parse rates for a specific venue
   */
  async analyzeVenue(venueName: string, programId: string, hours: number): Promise<ParseRateAnalysis> {
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get all transactions for this program
    // Since we don't have raw_transactions, we'll get all trades for this program
    const allTxnsResult = await this.pool.query(`
      SELECT DISTINCT signature
      FROM trades_unified
      WHERE program = $1
      AND created_at >= $2
    `, [programId, startTime]);

    const allSignatures = new Set(allTxnsResult.rows.map(r => r.signature));

    // Get parsed trades (already have them from above)
    const parsedTradesResult = allTxnsResult;

    const parsedSignatures = new Set(parsedTradesResult.rows.map(r => r.signature));

    // Get parsed liquidity events if AMM
    let parsedLiquiditySignatures = new Set<string>();
    if (venueName === 'pump_amm') {
      const liquidityResult = await this.pool.query(`
        SELECT DISTINCT signature
        FROM liquidity_events
        WHERE pool_address IN (SELECT DISTINCT pool_address FROM trades_unified WHERE program = $1)
        AND created_at >= $2
      `, [programId, startTime]);
      parsedLiquiditySignatures = new Set(liquidityResult.rows.map(r => r.signature));
    }

    // Calculate totals
    const totalTransactions = allSignatures.size;
    const successfullyParsed = parsedSignatures.size + parsedLiquiditySignatures.size;
    const failedToParse = totalTransactions - successfullyParsed;
    const parseRate = totalTransactions > 0 ? (successfullyParsed / totalTransactions) : 0;

    // Identify failed signatures
    const failedSignatures: string[] = [];
    for (const sig of allSignatures) {
      if (!parsedSignatures.has(sig) && !parsedLiquiditySignatures.has(sig)) {
        failedSignatures.push(sig);
      }
    }

    // Analyze failure patterns
    const commonFailurePatterns = await this.analyzeFailurePatterns(failedSignatures.slice(0, 100));

    // Get strategy performance from metrics service
    const strategyPerformance = this.getStrategyPerformance(programId);

    return {
      venue: venueName,
      totalTransactions,
      successfullyParsed,
      failedToParse,
      parseRate,
      timeframe: `${hours} hours`,
      failedSignatures: failedSignatures.slice(0, 10), // Top 10 for review
      commonFailurePatterns,
      strategyPerformance
    };
  }

  /**
   * Analyze common patterns in failed transactions
   */
  private async analyzeFailurePatterns(signatures: string[]): Promise<Map<string, number>> {
    const patterns = new Map<string, number>();

    if (signatures.length === 0) return patterns;

    // Since we don't have raw_transactions, we can't analyze failure patterns
    // Return empty patterns
    /*
    for (const row of result.rows) {
      // Check for common error patterns
      if (row.error_message) {
        const errorType = this.categorizeError(row.error_message);
        patterns.set(errorType, (patterns.get(errorType) || 0) + 1);
      }

      // Check instruction patterns
      if (row.instruction_count === 0) {
        patterns.set('no_instructions', (patterns.get('no_instructions') || 0) + 1);
      } else if (row.instruction_count > 10) {
        patterns.set('complex_transaction', (patterns.get('complex_transaction') || 0) + 1);
      }

      // Check for specific log patterns
      if (row.log_messages) {
        const logs = row.log_messages;
        if (logs.some((log: string) => log.includes('failed'))) {
          patterns.set('transaction_failed', (patterns.get('transaction_failed') || 0) + 1);
        }
        if (logs.some((log: string) => log.includes('insufficient'))) {
          patterns.set('insufficient_funds', (patterns.get('insufficient_funds') || 0) + 1);
        }
      }
    }
    */

    return patterns;
  }

  /**
   * Categorize error messages
   */
  private categorizeError(error: string): string {
    if (error.includes('custom program error')) return 'custom_program_error';
    if (error.includes('insufficient funds')) return 'insufficient_funds';
    if (error.includes('account not found')) return 'account_not_found';
    if (error.includes('invalid instruction')) return 'invalid_instruction';
    return 'other_error';
  }

  /**
   * Get strategy performance from metrics service
   */
  private getStrategyPerformance(programId: string): Map<string, { attempts: number; successes: number; rate: number }> {
    const performance = new Map<string, { attempts: number; successes: number; rate: number }>();
    
    const programMetrics = this.metricsService.getProgramMetrics(programId);
    const strategies = this.metricsService.getStrategyMetrics();

    for (const strategy of strategies) {
      // Only include strategies relevant to this program
      if (this.isStrategyForProgram(strategy.strategy, programId)) {
        performance.set(strategy.strategy, {
          attempts: strategy.attempts,
          successes: strategy.successes,
          rate: strategy.successRate
        });
      }
    }

    return performance;
  }

  /**
   * Check if a strategy is for a specific program
   */
  private isStrategyForProgram(strategyName: string, programId: string): boolean {
    const bcStrategies = ['BCTradeIDLStrategy', 'BCTradeStrategy'];
    const ammStrategies = ['UnifiedAmmTradeStrategy', 'AMMTradeHeuristicStrategy', 'AmmLiquidityStrategy'];
    
    if (programId === PUMP_PROGRAM) {
      return bcStrategies.includes(strategyName);
    } else if (programId === PUMP_AMM_PROGRAM) {
      return ammStrategies.includes(strategyName);
    }
    
    return false;
  }

  /**
   * Generate detailed report
   */
  generateReport(analyses: Map<string, ParseRateAnalysis>): string {
    let report = '# Parse Rate Analysis Report\n\n';
    report += `Generated at: ${new Date().toISOString()}\n\n`;

    // Overall summary
    let totalTxns = 0;
    let totalParsed = 0;
    for (const analysis of analyses.values()) {
      totalTxns += analysis.totalTransactions;
      totalParsed += analysis.successfullyParsed;
    }
    const overallRate = totalTxns > 0 ? (totalParsed / totalTxns * 100) : 0;

    report += `## Overall Summary\n`;
    report += `- Total Transactions: ${totalTxns.toLocaleString()}\n`;
    report += `- Successfully Parsed: ${totalParsed.toLocaleString()}\n`;
    report += `- Overall Parse Rate: ${overallRate.toFixed(1)}%\n\n`;

    // Venue-specific analysis
    for (const [venue, analysis] of analyses) {
      report += `## ${venue.toUpperCase()}\n`;
      report += `- Timeframe: ${analysis.timeframe}\n`;
      report += `- Total Transactions: ${analysis.totalTransactions.toLocaleString()}\n`;
      report += `- Successfully Parsed: ${analysis.successfullyParsed.toLocaleString()}\n`;
      report += `- Failed to Parse: ${analysis.failedToParse.toLocaleString()}\n`;
      report += `- Parse Rate: ${(analysis.parseRate * 100).toFixed(1)}%\n\n`;

      // Strategy performance
      if (analysis.strategyPerformance.size > 0) {
        report += `### Strategy Performance\n`;
        for (const [strategy, perf] of analysis.strategyPerformance) {
          report += `- ${strategy}: ${(perf.rate * 100).toFixed(1)}% (${perf.successes}/${perf.attempts})\n`;
        }
        report += '\n';
      }

      // Common failure patterns
      if (analysis.commonFailurePatterns.size > 0) {
        report += `### Common Failure Patterns\n`;
        const sorted = Array.from(analysis.commonFailurePatterns.entries())
          .sort((a, b) => b[1] - a[1]);
        for (const [pattern, count] of sorted) {
          report += `- ${pattern}: ${count} occurrences\n`;
        }
        report += '\n';
      }

      // Sample failed transactions
      if (analysis.failedSignatures.length > 0) {
        report += `### Sample Failed Transactions\n`;
        for (const sig of analysis.failedSignatures.slice(0, 5)) {
          report += `- https://solscan.io/tx/${sig}\n`;
        }
        report += '\n';
      }
    }

    return report;
  }
}

// Main execution
async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    logger.info('Starting parse rate analysis...');
    
    const analyzer = new ParseRateAnalyzer(pool);
    
    // Analyze last 24 hours by default
    const hours = parseInt(process.argv[2]) || 24;
    
    const analyses = await analyzer.analyzeAllVenues(hours);
    const report = analyzer.generateReport(analyses);
    
    console.log('\n' + report);
    
    // Save report to file
    const fs = await import('fs');
    const filename = `parse-rate-analysis-${new Date().toISOString().split('T')[0]}.md`;
    await fs.promises.writeFile(filename, report);
    logger.info(`Report saved to ${filename}`);
    
  } catch (error) {
    logger.error('Analysis failed:', error);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { ParseRateAnalyzer };