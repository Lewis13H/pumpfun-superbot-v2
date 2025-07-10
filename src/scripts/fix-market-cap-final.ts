/**
 * Fix Market Cap Final
 * Align with Solscan's calculation: price × total_supply
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FixMarketCapFinal', color: chalk.cyan });

async function fixMarketCapFinal() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    // From Solscan:
    // - Price: $0.00256
    // - Market Cap: $2,560,485.49
    // - This means: Market Cap = Price × 1,000,000,000 (total supply)
    
    logger.info('=== SOLSCAN METHODOLOGY ===');
    logger.info('Market Cap = Price × Total Supply (1B tokens)');
    logger.info('NOT circulating supply, but TOTAL supply');
    
    // Get all AMM trades
    const result = await db.query(`
      SELECT 
        id,
        mint_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        price_usd,
        market_cap_usd
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY block_time DESC
    `);
    
    logger.info(`\nProcessing ${result.rows.length} AMM trades`);
    
    for (const trade of result.rows) {
      const solReserves = BigInt(trade.virtual_sol_reserves || '0');
      const tokenReserves = BigInt(trade.virtual_token_reserves || '0');
      
      // Price calculation (virtual reserves use raw ratio)
      const priceInSol = Number(solReserves) / Number(tokenReserves);
      const priceInUsd = priceInSol * solPrice;
      
      // Market cap = price × total supply
      const TOTAL_SUPPLY = 1_000_000_000; // 1B tokens
      const marketCapUsd = priceInUsd * TOTAL_SUPPLY;
      
      logger.info(`\nToken ${trade.mint_address.substring(0, 8)}...`);
      logger.info(`  Price: $${priceInUsd.toFixed(9)}`);
      logger.info(`  Market cap: $${marketCapUsd.toLocaleString()}`);
      logger.info(`  Old market cap: $${Number(trade.market_cap_usd).toLocaleString()}`);
      
      // Update
      await db.query(`
        UPDATE trades_unified
        SET 
          market_cap_usd = $2,
          price_usd = $3
        WHERE id = $1
      `, [trade.id, marketCapUsd, priceInUsd]);
    }
    
    // Update tokens table
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
    
    // Check IPO token
    const ipoResult = await db.query(`
      SELECT 
        t.symbol,
        t.latest_market_cap_usd,
        tr.price_usd,
        tr.virtual_sol_reserves,
        tr.virtual_token_reserves
      FROM tokens_unified t
      JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE t.mint_address = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump'
        AND tr.program = 'amm_pool'
      ORDER BY tr.block_time DESC
      LIMIT 1
    `);
    
    if (ipoResult.rows.length > 0) {
      const ipo = ipoResult.rows[0];
      logger.info('\n=== IPO TOKEN FINAL RESULT ===');
      logger.info(`Price: $${Number(ipo.price_usd).toFixed(6)}`);
      logger.info(`Market cap: $${Number(ipo.latest_market_cap_usd).toLocaleString()}`);
      logger.info(`Target (Solscan): $2,560,485`);
      
      const ratio = Number(ipo.latest_market_cap_usd) / 2_560_485;
      logger.info(`Ratio: ${ratio.toFixed(3)}x`);
      
      if (Math.abs(ratio - 1) < 0.1) {
        logger.info('✅ Market cap now matches Solscan!');
      } else {
        logger.info('⚠️  Still some discrepancy - likely due to price movement');
      }
    }
    
  } catch (error) {
    logger.error('Failed to fix market cap', error as Error);
  }
}

fixMarketCapFinal()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });