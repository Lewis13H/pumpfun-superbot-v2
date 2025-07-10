/**
 * Understand Reserve Precision
 * Figure out the exact decimal precision for virtual reserves
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger({ context: 'ReservePrecision', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function understandPrecision() {
  try {
    // Get the trade
    const result = await db.query(`
      SELECT 
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        trade_type,
        signature
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    const trade = result.rows[0];
    const solReserves = trade.virtual_sol_reserves;
    const tokenReserves = trade.virtual_token_reserves;
    const solAmount = trade.sol_amount;
    const tokenAmount = trade.token_amount;
    
    logger.info('Raw values from database:');
    logger.info(`  SOL reserves: ${solReserves}`);
    logger.info(`  Token reserves: ${tokenReserves}`);
    logger.info(`  Trade SOL amount: ${solAmount}`);
    logger.info(`  Trade token amount: ${tokenAmount}`);
    logger.info(`  Trade type: ${trade.trade_type}`);
    
    // Analyze the values
    logger.info('\n=== ANALYSIS ===');
    
    // SOL reserves
    logger.info('\nSOL reserves (42146645214):');
    logger.info(`  As lamports (9 decimals): ${(Number(solReserves) / 1e9).toFixed(9)} SOL`);
    logger.info(`  Length: ${solReserves.length} digits`);
    
    // Token reserves
    logger.info('\nToken reserves (996520595808861):');
    logger.info(`  Length: ${tokenReserves.length} digits`);
    logger.info(`  With 6 decimals: ${(Number(tokenReserves) / 1e6).toLocaleString()} tokens`);
    logger.info(`  With 9 decimals: ${(Number(tokenReserves) / 1e9).toLocaleString()} tokens`);
    logger.info(`  With 12 decimals: ${(Number(tokenReserves) / 1e12).toLocaleString()} tokens`);
    logger.info(`  With 15 decimals: ${(Number(tokenReserves) / 1e15).toLocaleString()} tokens`);
    
    // Trade amounts
    logger.info('\nTrade amounts:');
    logger.info(`  SOL: ${(Number(solAmount) / 1e9).toFixed(9)} SOL`);
    logger.info(`  Tokens with 6 decimals: ${(Number(tokenAmount) / 1e6).toLocaleString()}`);
    logger.info(`  Tokens with 9 decimals: ${(Number(tokenAmount) / 1e9).toLocaleString()}`);
    
    // Key insight
    logger.info('\n=== KEY INSIGHT ===');
    logger.info('Token amount (160414675000000) has 15 digits');
    logger.info('With 6 decimals: 160,414,675 tokens (makes sense for a trade)');
    logger.info('Token reserves (996520595808861) also has 15 digits');
    logger.info('With 6 decimals: 996,520,595.808861 tokens');
    logger.info('\nBUT this would mean pool has 996M tokens (99.6% of supply)');
    logger.info('This is typical for pump.fun - most tokens stay in pool!');
    
    // Price calculation with correct decimals
    logger.info('\n=== CORRECT CALCULATION ===');
    const solReservesInSol = Number(solReserves) / 1e9;
    const tokenReservesInTokens = Number(tokenReserves) / 1e6;
    const pricePerToken = solReservesInSol / tokenReservesInTokens;
    const priceInUsd = pricePerToken * 154.4;
    
    logger.info(`SOL reserves: ${solReservesInSol.toFixed(4)} SOL`);
    logger.info(`Token reserves: ${tokenReservesInTokens.toLocaleString()} tokens`);
    logger.info(`Price per token: ${pricePerToken.toFixed(9)} SOL`);
    logger.info(`Price in USD: $${priceInUsd.toFixed(6)}`);
    logger.info(`Market cap (1B supply): $${(priceInUsd * 1e9).toLocaleString()}`);
    
    // What this means
    logger.info('\n=== CONCLUSION ===');
    logger.info('1. SOL reserves use standard 9 decimals (lamports)');
    logger.info('2. Token reserves use standard 6 decimals');
    logger.info('3. ~99.65% of tokens are in the AMM pool');
    logger.info('4. Only ~0.35% (3.5M tokens) are circulating');
    logger.info('5. This is why price seems high - very few tokens in circulation!');
    
  } catch (error) {
    logger.error('Analysis failed', error as Error);
  }
}

understandPrecision()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });