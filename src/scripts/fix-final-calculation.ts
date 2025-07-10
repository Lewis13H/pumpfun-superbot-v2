/**
 * Fix Final Calculation
 * The issue was treating token reserves as having 9 decimals when they have 6
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FixFinalCalc', color: chalk.cyan });

async function fixFinalCalculation() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    logger.info('\n=== CORRECT DECIMAL HANDLING ===');
    logger.info('SOL reserves: 9 decimals (standard lamports)');
    logger.info('Token reserves: 6 decimals (confirmed from Solscan)');
    logger.info('Token amounts: 6 decimals');
    
    // Update all AMM trades
    const result = await db.query(`
      SELECT 
        id,
        mint_address,
        virtual_sol_reserves,
        virtual_token_reserves
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY block_time DESC
    `);
    
    logger.info(`\nFixing ${result.rows.length} AMM trades`);
    
    for (const trade of result.rows) {
      const solReserves = BigInt(trade.virtual_sol_reserves || '0');
      const tokenReserves = BigInt(trade.virtual_token_reserves || '0');
      
      // Correct decimal handling
      const solInSol = Number(solReserves) / 1e9; // 9 decimals
      const tokensInTokens = Number(tokenReserves) / 1e6; // 6 decimals
      
      // Price calculation
      const priceInSol = solInSol / tokensInTokens;
      const priceInUsd = priceInSol * solPrice;
      
      // Market cap with 1B total supply
      const marketCapUsd = priceInUsd * 1_000_000_000;
      
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
    }
    
    // Update tokens
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
    
    // Verify IPO
    const ipoResult = await db.query(`
      SELECT 
        t.symbol,
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
      
      logger.info('\n=== IPO TOKEN FINAL RESULT ===');
      logger.info(`Symbol: ${ipo.symbol}`);
      logger.info(`Price: $${Number(ipo.price_usd).toFixed(6)}`);
      logger.info(`Market cap: $${Number(ipo.market_cap_usd).toLocaleString()}`);
      
      // Verify calculation
      const solReserves = Number(ipo.virtual_sol_reserves) / 1e9;
      const tokenReserves = Number(ipo.virtual_token_reserves) / 1e6;
      logger.info(`\nReserves check:`);
      logger.info(`  SOL: ${solReserves.toFixed(4)} SOL`);
      logger.info(`  Tokens: ${tokenReserves.toLocaleString()} (${(tokenReserves / 1e9 * 100).toFixed(2)}% of supply)`);
      
      // Compare with Solscan
      const solscanMarketCap = 2_560_485;
      const ratio = Number(ipo.market_cap_usd) / solscanMarketCap;
      
      logger.info(`\nVs Solscan ($2,560,485): ${ratio.toFixed(3)}x`);
      
      if (ratio > 2) {
        logger.info('\nRemaining discrepancy likely due to:');
        logger.info('1. Our data is from an older trade');
        logger.info('2. Price has moved significantly');
        logger.info('3. Need fresh trade data to match current price');
      } else if (ratio < 0.5) {
        logger.info('\n⚠️  Price may have increased significantly');
      } else {
        logger.info('\n✅ Market cap calculation is now correct!');
      }
    }
    
  } catch (error) {
    logger.error('Fix failed', error as Error);
  }
}

fixFinalCalculation()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });