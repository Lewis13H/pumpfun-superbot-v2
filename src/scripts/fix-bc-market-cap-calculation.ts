import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger('BCMarketCapFix');

/**
 * Fix BC Market Cap Calculation
 * 
 * The issue: We're using 10% circulating supply for BC tokens
 * The fix: Use 100% supply for BC tokens (they're fully circulating)
 * Only AMM tokens should use the tokens in pool for market cap
 */
async function fixBCMarketCap() {
  logger.info('=== Fixing BC Market Cap Calculation ===');
  logger.info('Current: BC tokens use 10% of supply (100M of 1B)');
  logger.info('Fix: BC tokens should use 100% of supply (1B)');
  logger.info('This explains why market caps are 10x lower than expected\n');
  
  // Get current SOL price
  const solPriceResult = await db.query(`
    SELECT price FROM sol_prices 
    ORDER BY timestamp DESC 
    LIMIT 1
  `);
  
  const currentSolPrice = parseFloat(solPriceResult.rows[0]?.price || '150');
  logger.info(`Current SOL Price: $${currentSolPrice}\n`);
  
  // Find all BC tokens with recent trades
  const bcTokens = await db.query(`
    SELECT DISTINCT 
      t.mint_address,
      t.symbol,
      t.name,
      t.latest_market_cap_usd as current_mcap,
      t.current_price_sol,
      t.current_price_usd,
      t.graduated_to_amm,
      tr.price_sol as latest_price_sol,
      tr.price_usd as latest_price_usd,
      tr.bonding_curve_key
    FROM tokens_unified t
    INNER JOIN (
      SELECT DISTINCT ON (mint_address) 
        mint_address, 
        price_sol, 
        price_usd,
        bonding_curve_key
      FROM trades_unified
      WHERE block_time > NOW() - INTERVAL '24 hours'
      ORDER BY mint_address, block_time DESC
    ) tr ON t.mint_address = tr.mint_address
    WHERE t.graduated_to_amm = false
    AND tr.bonding_curve_key IS NOT NULL
    AND tr.bonding_curve_key != '11111111111111111111111111111111'
    ORDER BY t.latest_market_cap_usd DESC
    LIMIT 20
  `);
  
  logger.info(`Found ${bcTokens.rows.length} BC tokens to analyze\n`);
  
  const totalSupply = 1_000_000_000; // Standard pump.fun supply
  
  for (const token of bcTokens.rows) {
    const symbol = token.symbol || 'Unknown';
    const currentMcap = parseFloat(token.current_mcap || '0');
    const priceSol = parseFloat(token.latest_price_sol);
    const priceUsd = parseFloat(token.latest_price_usd);
    
    // Current calculation (wrong): price × 100M
    const currentCalc = priceUsd * (totalSupply * 0.1);
    
    // Correct calculation: price × 1B
    const correctCalc = priceUsd * totalSupply;
    
    // The difference factor
    const factor = correctCalc / currentCalc;
    
    logger.info(`${chalk.yellow(symbol)} (${token.mint_address.slice(0, 8)}...)`);
    logger.info(`  Current Market Cap: $${currentMcap.toLocaleString()}`);
    logger.info(`  Price: ${priceSol.toFixed(9)} SOL ($${priceUsd.toFixed(9)})`);
    logger.info(`  Current Calc (10%): $${currentCalc.toLocaleString()}`);
    logger.info(`  Correct Calc (100%): $${correctCalc.toLocaleString()}`);
    logger.info(`  ${chalk.green(`Factor: ${factor}x`)}\n`);
  }
  
  // Show the fix in price-calculator.ts
  logger.info(chalk.cyan('\n=== The Fix ==='));
  logger.info('In src/services/pricing/price-calculator.ts:');
  logger.info(chalk.gray('Current code:'));
  logger.info(`  const circulatingSupply = isAmmToken && virtualTokenReserves
    ? virtualTokenReserves  // For AMM: use tokens in pool
    : totalSupply * 0.1;    // For BC: 10% circulating`);
  
  logger.info(chalk.gray('\nShould be:'));
  logger.info(`  const circulatingSupply = isAmmToken && virtualTokenReserves
    ? virtualTokenReserves  // For AMM: use tokens in pool
    : totalSupply;          // For BC: 100% circulating`);
  
  logger.info(chalk.yellow('\nThis will fix the 10x market cap discrepancy!'));
  
  process.exit(0);
}

fixBCMarketCap().catch(error => {
  logger.error('Error:', error);
  process.exit(1);
});