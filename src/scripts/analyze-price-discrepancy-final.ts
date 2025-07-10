/**
 * Analyze Price Discrepancy Final
 * Why is our price 2.55x higher than Solscan?
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger({ context: 'AnalyzePriceFinal', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function analyzeFinal() {
  try {
    // Get our data
    const result = await db.query(`
      SELECT 
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        price_usd,
        block_time
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    const trade = result.rows[0];
    const solReserves = BigInt(trade.virtual_sol_reserves);
    const tokenReserves = BigInt(trade.virtual_token_reserves);
    
    logger.info('Our data:');
    logger.info(`  Price: $${trade.price_usd}`);
    logger.info(`  SOL reserves: ${solReserves.toString()} (${(Number(solReserves) / 1e9).toFixed(4)} SOL)`);
    logger.info(`  Token reserves: ${tokenReserves.toString()}`);
    logger.info(`  Block time: ${new Date(trade.block_time * 1000).toISOString()}`);
    
    logger.info('\nSolscan data:');
    logger.info('  Price: $0.00256');
    logger.info('  Market Cap: $2,560,485');
    
    const ratio = Number(trade.price_usd) / 0.00256;
    logger.info(`\nOur price is ${ratio.toFixed(3)}x Solscan price`);
    
    // Test different interpretations
    logger.info('\n=== PRICE CALCULATIONS ===');
    
    // Current calculation
    const price1 = Number(solReserves) / Number(tokenReserves) * 154.4;
    logger.info(`1. Raw ratio × SOL price: $${price1.toFixed(6)}`);
    
    // What if we need to apply decimals differently?
    const price2 = (Number(solReserves) / 1e9) / (Number(tokenReserves) / 1e15) * 154.4;
    logger.info(`2. If token reserves have 15 decimals: $${price2.toFixed(6)}`);
    
    // What if virtual reserves are pre-adjusted?
    const price3 = (Number(solReserves) / 1e9) / (Number(tokenReserves) / 1e12) * 154.4;
    logger.info(`3. If token reserves have 12 decimals: $${price3.toFixed(6)}`);
    
    // Reverse engineer from Solscan
    logger.info('\n=== REVERSE ENGINEERING ===');
    const targetPrice = 0.00256;
    const targetPriceInSol = targetPrice / 154.4;
    logger.info(`Target price in SOL: ${targetPriceInSol.toFixed(9)}`);
    
    // What would reserves need to be?
    const currentSolInPool = Number(solReserves) / 1e9;
    const impliedTokenReserves = currentSolInPool / targetPriceInSol;
    logger.info(`Implied token reserves for target price: ${impliedTokenReserves.toLocaleString()}`);
    
    // Compare with our reserves
    const ourTokenReserves = Number(tokenReserves);
    logger.info(`Our token reserves: ${ourTokenReserves.toLocaleString()}`);
    logger.info(`Ratio: ${(ourTokenReserves / impliedTokenReserves).toFixed(3)}x`);
    
    // The key insight
    logger.info('\n=== KEY INSIGHT ===');
    const decimalDifference = Math.log10(ourTokenReserves / impliedTokenReserves);
    logger.info(`Decimal difference: ${decimalDifference.toFixed(1)} places`);
    
    if (Math.abs(decimalDifference - 3) < 0.1) {
      logger.info('✅ Virtual token reserves have 3 extra decimal places!');
      logger.info('Token has 6 decimals, but virtual reserves use 9 decimals internally');
      
      const correctedPrice = (Number(solReserves) / 1e9) / (Number(tokenReserves) / 1e9) * 154.4;
      logger.info(`\nCorrected price: $${correctedPrice.toFixed(6)}`);
      logger.info(`vs Solscan: $0.00256`);
      logger.info(`Ratio: ${(correctedPrice / 0.00256).toFixed(3)}x`);
    }
    
  } catch (error) {
    logger.error('Analysis failed', error as Error);
  }
}

analyzeFinal()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });