/**
 * Verify Reserves Extraction
 * Check if we're extracting the correct reserves from transactions
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger({ context: 'VerifyReserves', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function verifyReserves() {
  try {
    // Get AMM trades with different reserve values
    const result = await db.query(`
      SELECT 
        signature,
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        price_sol,
        price_usd,
        market_cap_usd,
        block_time
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 10
    `, [MINT]);
    
    logger.info(`Found ${result.rows.length} AMM trades`);
    
    // Analyze reserve patterns
    logger.info('\n=== RESERVE ANALYSIS ===');
    
    for (const trade of result.rows) {
      const solReserves = BigInt(trade.virtual_sol_reserves || '0');
      const tokenReserves = BigInt(trade.virtual_token_reserves || '0');
      const solAmount = BigInt(trade.sol_amount || '0');
      const tokenAmount = BigInt(trade.token_amount || '0');
      
      logger.info(`\nTrade ${trade.signature.substring(0, 20)}...`);
      logger.info(`  Block time: ${new Date(trade.block_time * 1000).toISOString()}`);
      logger.info(`  SOL reserves: ${(Number(solReserves) / 1e9).toFixed(4)} SOL`);
      logger.info(`  Token reserves: ${(Number(tokenReserves) / 1e6).toFixed(0)} tokens`);
      logger.info(`  Trade SOL: ${(Number(solAmount) / 1e9).toFixed(4)} SOL`);
      logger.info(`  Trade tokens: ${(Number(tokenAmount) / 1e6).toFixed(0)} tokens`);
      logger.info(`  Price USD: $${trade.price_usd || 'N/A'}`);
      logger.info(`  Market cap: $${Number(trade.market_cap_usd).toLocaleString()}`);
      
      // Check reserve ratios
      if (solReserves > 0n && tokenReserves > 0n) {
        const k = Number(solReserves) * Number(tokenReserves);
        logger.info(`  Constant product (k): ${k.toExponential(2)}`);
        
        // Check if reserves make sense with trade amounts
        const reserveRatio = Number(solAmount) / Number(solReserves);
        logger.info(`  Trade/Reserve ratio: ${(reserveRatio * 100).toFixed(2)}%`);
      }
    }
    
    // Check for patterns in reserves
    logger.info('\n=== RESERVE PATTERNS ===');
    
    const validTrades = result.rows.filter(t => t.virtual_sol_reserves && t.virtual_token_reserves);
    if (validTrades.length > 1) {
      // Check if k is constant
      const kValues = validTrades.map(t => {
        const sol = Number(t.virtual_sol_reserves);
        const token = Number(t.virtual_token_reserves);
        return sol * token;
      });
      
      const minK = Math.min(...kValues);
      const maxK = Math.max(...kValues);
      const kVariation = (maxK - minK) / minK * 100;
      
      logger.info(`Constant product variation: ${kVariation.toFixed(2)}%`);
      if (kVariation > 10) {
        logger.warn('⚠️  High variation in constant product - reserves might be incorrect');
      }
    }
    
    // Compare with expected pump.fun values
    logger.info('\n=== PUMP.FUN COMPARISON ===');
    
    // pump.fun initial values
    const EXPECTED_INITIAL_SOL = 42; // 42 SOL
    const EXPECTED_INITIAL_TOKENS = 1_000_000_000; // 1B tokens
    
    if (validTrades.length > 0) {
      const latestTrade = validTrades[0];
      const currentSol = Number(latestTrade.virtual_sol_reserves) / 1e9;
      const currentTokens = Number(latestTrade.virtual_token_reserves) / 1e6;
      
      logger.info(`Expected initial: ${EXPECTED_INITIAL_SOL} SOL, ${EXPECTED_INITIAL_TOKENS.toLocaleString()} tokens`);
      logger.info(`Current: ${currentSol.toFixed(2)} SOL, ${currentTokens.toLocaleString()} tokens`);
      
      // In pump.fun, if SOL decreases, tokens should increase (and vice versa)
      const solChange = currentSol - EXPECTED_INITIAL_SOL;
      const tokenChange = currentTokens - EXPECTED_INITIAL_TOKENS;
      
      logger.info(`SOL change: ${solChange > 0 ? '+' : ''}${solChange.toFixed(2)} SOL`);
      logger.info(`Token change: ${tokenChange > 0 ? '+' : ''}${tokenChange.toLocaleString()} tokens`);
      
      if (solChange < 0 && tokenChange < 0) {
        logger.error('❌ Both reserves decreased - this is impossible in AMM');
      } else if (solChange > 0 && tokenChange > 0) {
        logger.error('❌ Both reserves increased - this is impossible without liquidity add');
      }
    }
    
  } catch (error) {
    logger.error('Failed to verify reserves', error as Error);
  }
}

verifyReserves()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });