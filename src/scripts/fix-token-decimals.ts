/**
 * Fix Token Decimals Issue
 * The issue might be that pump.fun tokens have 9 decimals, not 6
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FixTokenDecimals', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function fixDecimals() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    // Get latest AMM trade
    const result = await db.query(`
      SELECT 
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    if (result.rows.length === 0) {
      logger.error('No AMM trades found');
      return;
    }
    
    const trade = result.rows[0];
    
    // Current calculation (assuming 6 decimals)
    const solReserves = BigInt(trade.virtual_sol_reserves);
    const tokenReserves = BigInt(trade.virtual_token_reserves);
    
    logger.info('Raw reserves:', {
      solReserves: solReserves.toString(),
      tokenReserves: tokenReserves.toString()
    });
    
    // Try different decimal assumptions
    const SCENARIOS = [
      { name: '6 decimals (current)', decimals: 6, totalSupply: 1e9 },
      { name: '9 decimals (like SOL)', decimals: 9, totalSupply: 1e9 },
      { name: '6 decimals, 100B supply', decimals: 6, totalSupply: 100e9 },
      { name: '9 decimals, 100M supply', decimals: 9, totalSupply: 100e6 },
      { name: '0 decimals, 1B supply', decimals: 0, totalSupply: 1e9 }
    ];
    
    logger.info('\n=== DECIMAL SCENARIOS ===');
    
    for (const scenario of SCENARIOS) {
      const tokenReservesAdjusted = Number(tokenReserves) / Math.pow(10, scenario.decimals);
      const solReservesAdjusted = Number(solReserves) / 1e9; // SOL always 9 decimals
      
      // Price per token
      const priceInSol = solReservesAdjusted / tokenReservesAdjusted;
      const priceInUsd = priceInSol * solPrice;
      
      // Market cap
      const marketCap = priceInUsd * scenario.totalSupply;
      
      logger.info(`\n${scenario.name}:`);
      logger.info(`  Token reserves: ${tokenReservesAdjusted.toLocaleString()} tokens`);
      logger.info(`  Price per token: $${priceInUsd.toFixed(9)}`);
      logger.info(`  Market cap: $${marketCap.toLocaleString()}`);
      logger.info(`  Ratio to $3.9M: ${(marketCap / 3_900_000).toFixed(2)}x`);
    }
    
    // Check if we're interpreting the reserves wrong
    logger.info('\n=== VIRTUAL RESERVES INTERPRETATION ===');
    
    // pump.fun uses virtual reserves for pricing
    // Maybe we need to subtract initial virtual reserves?
    const INITIAL_VIRTUAL_TOKEN = 1_000_000_000_000_000n; // 1B tokens * 1e6
    const INITIAL_VIRTUAL_SOL = 42_000_000_000n; // 42 SOL
    
    const actualTokenReserves = tokenReserves - INITIAL_VIRTUAL_TOKEN;
    const actualSolReserves = solReserves - INITIAL_VIRTUAL_SOL;
    
    logger.info('Subtracting initial virtual reserves:');
    logger.info(`  Actual token reserves: ${actualTokenReserves.toString()}`);
    logger.info(`  Actual SOL reserves: ${actualSolReserves.toString()}`);
    
    if (actualTokenReserves < 0n || actualSolReserves < 0n) {
      logger.warn('⚠️  Negative reserves - this approach is incorrect');
    }
    
    // Maybe the issue is that pump.fun tokens have a different total supply
    logger.info('\n=== REVERSE ENGINEERING ===');
    
    // If market cap is $3.9M and price is based on our reserves
    const currentPrice = (Number(solReserves) / 1e9 * solPrice) / (Number(tokenReserves) / 1e6);
    const impliedTotalSupply = 3_900_000 / currentPrice;
    
    logger.info(`Current price (6 decimals): $${currentPrice.toFixed(9)}`);
    logger.info(`Implied total supply for $3.9M: ${(impliedTotalSupply / 1e9).toFixed(2)}B tokens`);
    
    // What if pump.fun shows FDV not market cap?
    logger.info('\n=== FDV vs MARKET CAP ===');
    const fdv = currentPrice * 1e9; // 1B total supply
    logger.info(`FDV with 1B supply: $${fdv.toLocaleString()}`);
    logger.info(`If $3.9M is FDV, then total supply would be: ${(3_900_000 / currentPrice).toLocaleString()} tokens`);
    
  } catch (error) {
    logger.error('Failed to analyze decimals', error as Error);
  }
}

fixDecimals()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });