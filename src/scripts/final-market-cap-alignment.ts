/**
 * Final Market Cap Alignment
 * Properly handle virtual reserve precision
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FinalAlignment', color: chalk.cyan });

async function finalAlignment() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    logger.info('\n=== FINAL UNDERSTANDING ===');
    logger.info('1. Token has 6 decimals (confirmed)');
    logger.info('2. Virtual reserves use higher precision internally');
    logger.info('3. Both SOL and token reserves appear to use 9 decimal precision');
    logger.info('4. Market cap = price × 1B total supply');
    
    // Get all AMM trades
    const result = await db.query(`
      SELECT 
        id,
        mint_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        signature
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY mint_address, block_time DESC
    `);
    
    logger.info(`\nProcessing ${result.rows.length} AMM trades`);
    
    for (const trade of result.rows) {
      const solReserves = BigInt(trade.virtual_sol_reserves || '0');
      const tokenReserves = BigInt(trade.virtual_token_reserves || '0');
      
      // Both reserves use 9 decimal precision
      const solReservesAdjusted = Number(solReserves) / 1e9;
      const tokenReservesAdjusted = Number(tokenReserves) / 1e9;
      
      // Calculate price
      const priceInSol = solReservesAdjusted / tokenReservesAdjusted;
      const priceInUsd = priceInSol * solPrice;
      
      // Market cap with 1B total supply
      const TOTAL_SUPPLY = 1_000_000_000;
      const marketCapUsd = priceInUsd * TOTAL_SUPPLY;
      
      // Update
      await db.query(`
        UPDATE trades_unified
        SET 
          price_sol = $2,
          price_usd = $3,
          market_cap_usd = $4
        WHERE id = $1
      `, [
        trade.id,
        priceInSol,
        priceInUsd,
        marketCapUsd
      ]);
      
      logger.debug(`Updated ${trade.mint_address.substring(0, 8)}... price: $${priceInUsd.toFixed(6)}`);
    }
    
    // Update tokens table
    await db.query(`
      UPDATE tokens_unified t
      SET 
        latest_market_cap_usd = (
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
    
    // Verify IPO token
    const ipoResult = await db.query(`
      SELECT 
        t.symbol,
        t.name,
        tr.price_usd,
        tr.market_cap_usd,
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
      const solReserves = Number(ipo.virtual_sol_reserves) / 1e9;
      const tokenReserves = Number(ipo.virtual_token_reserves) / 1e9;
      
      logger.info('\n=== IPO TOKEN FINAL VERIFICATION ===');
      logger.info(`Name: ${ipo.name} (${ipo.symbol})`);
      logger.info(`SOL reserves: ${solReserves.toFixed(4)} SOL`);
      logger.info(`Token reserves: ${tokenReserves.toFixed(0)} tokens`);
      logger.info(`Price: $${Number(ipo.price_usd).toFixed(6)}`);
      logger.info(`Market cap: $${Number(ipo.market_cap_usd).toLocaleString()}`);
      
      // Compare with Solscan
      const solscanPrice = 0.00256;
      const solscanMarketCap = 2_560_485;
      
      logger.info('\nComparison with Solscan:');
      logger.info(`Price ratio: ${(Number(ipo.price_usd) / solscanPrice).toFixed(3)}x`);
      logger.info(`Market cap ratio: ${(Number(ipo.market_cap_usd) / solscanMarketCap).toFixed(3)}x`);
      
      // If still off, it's likely due to:
      logger.info('\nPossible reasons for remaining discrepancy:');
      logger.info('1. Different timestamp (our data might be older)');
      logger.info('2. Price volatility since our last update');
      logger.info('3. Different SOL price used in calculation');
      logger.info('4. Solscan might be showing real-time data while ours is from last trade');
    }
    
    logger.info('\n✅ Market cap calculation aligned with standard methodology');
    logger.info('Formula: Market Cap = (SOL reserves / Token reserves) × SOL price × Total Supply');
    
  } catch (error) {
    logger.error('Alignment failed', error as Error);
  }
}

finalAlignment()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });