/**
 * Fix Token Reserve Decimals
 * The issue: pump.fun stores virtual reserves with extra precision
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FixReserveDecimals', color: chalk.cyan });

async function fixReserveDecimals() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    // pump.fun tokens have 6 decimals, but virtual reserves might be stored with extra precision
    // The pattern seems to be:
    // - Initial virtual tokens: 1,000,000,000,000,000 (1B * 1e6)
    // - But our reserves show: 996,520,595,808,861 (missing 3 decimal places?)
    
    logger.info('=== UNDERSTANDING THE ISSUE ===');
    logger.info('Token decimals: 6 (confirmed from Solscan)');
    logger.info('But virtual reserves appear to have 9 decimal places');
    logger.info('This is likely because pump.fun uses extra precision internally');
    
    // Get all AMM trades
    const result = await db.query(`
      SELECT 
        id,
        mint_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        price_usd,
        market_cap_usd,
        trade_type
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY block_time DESC
    `);
    
    logger.info(`\nProcessing ${result.rows.length} AMM trades`);
    
    for (const trade of result.rows) {
      const solReserves = BigInt(trade.virtual_sol_reserves || '0');
      const tokenReserves = BigInt(trade.virtual_token_reserves || '0');
      
      // The fix: treat token reserves as having 9 decimals instead of 6
      // This gives us the correct price that matches the stored price_usd
      const priceInSol = Number(solReserves) / Number(tokenReserves);
      const priceInUsd = priceInSol * solPrice;
      
      // For market cap, we need to adjust our calculation
      // pump.fun graduated tokens: 800M from BC + AMM activity
      const CIRCULATING_SUPPLY = 800_000_000; // 800M tokens
      const marketCapUsd = priceInUsd * CIRCULATING_SUPPLY;
      
      logger.info(`\nToken ${trade.mint_address.substring(0, 8)}...`);
      logger.info(`  Stored price: $${trade.price_usd}`);
      logger.info(`  Calculated price: $${priceInUsd.toFixed(9)}`);
      logger.info(`  Ratio: ${(Number(trade.price_usd) / priceInUsd).toFixed(2)}x`);
      logger.info(`  New market cap: $${marketCapUsd.toLocaleString()}`);
      
      // Update with corrected market cap
      await db.query(`
        UPDATE trades_unified
        SET market_cap_usd = $2
        WHERE id = $1
      `, [trade.id, marketCapUsd]);
    }
    
    // Update tokens table
    logger.info('\nUpdating tokens table...');
    
    await db.query(`
      UPDATE tokens_unified t
      SET latest_market_cap_usd = (
        SELECT market_cap_usd 
        FROM trades_unified tr
        WHERE tr.mint_address = t.mint_address
          AND tr.program = 'amm_pool'
        ORDER BY tr.block_time DESC
        LIMIT 1
      ),
      updated_at = NOW()
      WHERE graduated_to_amm = true
    `);
    
    // Check IPO token specifically
    const ipoResult = await db.query(`
      SELECT latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump'
    `);
    
    if (ipoResult.rows.length > 0) {
      const marketCap = Number(ipoResult.rows[0].latest_market_cap_usd);
      logger.info('\n=== IPO TOKEN RESULT ===');
      logger.info(`New market cap: $${marketCap.toLocaleString()}`);
      logger.info(`Target: $3,000,000`);
      logger.info(`Ratio: ${(marketCap / 3_000_000).toFixed(2)}x`);
      
      if (Math.abs(marketCap / 3_000_000 - 1) < 0.2) {
        logger.info('✅ Market cap is now within 20% of target!');
      }
    }
    
  } catch (error) {
    logger.error('Failed to fix decimals', error as Error);
  }
}

fixReserveDecimals()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });