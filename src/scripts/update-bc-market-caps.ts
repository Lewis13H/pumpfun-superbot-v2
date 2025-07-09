import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger('UpdateBCMarketCaps');

/**
 * Update all BC token market caps by multiplying by 10
 * This fixes the issue where BC tokens were calculated with 10% circulating supply
 * when they should use 100% circulating supply
 */
async function updateBCMarketCaps() {
  logger.info('=== Updating BC Token Market Caps ===');
  logger.info('Multiplying all BC token market caps by 10x');
  logger.info('This corrects the 10% vs 100% circulating supply issue\n');
  
  try {
    // First, let's see how many tokens will be affected
    const countResult = await db.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE graduated_to_amm = false
      AND latest_market_cap_usd IS NOT NULL
    `);
    
    const totalCount = parseInt(countResult.rows[0].count);
    logger.info(`Found ${totalCount} BC tokens to update\n`);
    
    // Show some examples before update
    const examplesResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        current_price_usd
      FROM tokens_unified
      WHERE graduated_to_amm = false
      AND latest_market_cap_usd IS NOT NULL
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    logger.info('Top 10 BC tokens before update:');
    for (const token of examplesResult.rows) {
      const symbol = token.symbol || 'Unknown';
      const currentMcap = parseFloat(token.latest_market_cap_usd || '0');
      const newMcap = currentMcap * 10;
      logger.info(`  ${chalk.yellow(symbol)} - Current: $${currentMcap.toLocaleString()} → New: $${newMcap.toLocaleString()}`);
    }
    
    // Ask for confirmation
    logger.info(chalk.yellow('\nThis will update market caps for all BC tokens.'));
    logger.info(chalk.yellow('Make sure the price-calculator.ts has been updated first!'));
    logger.info(chalk.yellow('Press Ctrl+C to cancel or wait 5 seconds to continue...\n'));
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Update all BC token market caps
    const updateResult = await db.query(`
      UPDATE tokens_unified
      SET 
        latest_market_cap_usd = latest_market_cap_usd * 10,
        updated_at = NOW()
      WHERE graduated_to_amm = false
      AND latest_market_cap_usd IS NOT NULL
      RETURNING mint_address
    `);
    
    logger.info(chalk.green(`✓ Updated ${updateResult.rows.length} BC token market caps`));
    
    // Also update trades_unified table
    logger.info('\nUpdating trades table...');
    const tradesUpdateResult = await db.query(`
      UPDATE trades_unified
      SET market_cap_usd = market_cap_usd * 10
      WHERE bonding_curve_key IS NOT NULL
      AND bonding_curve_key != '11111111111111111111111111111111'
      AND market_cap_usd IS NOT NULL
    `);
    
    logger.info(chalk.green(`✓ Updated ${tradesUpdateResult.rowCount} trade records`));
    
    // Show examples after update
    const afterResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE graduated_to_amm = false
      AND latest_market_cap_usd IS NOT NULL
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    logger.info('\nTop 10 BC tokens after update:');
    for (const token of afterResult.rows) {
      const symbol = token.symbol || 'Unknown';
      const mcap = parseFloat(token.latest_market_cap_usd || '0');
      logger.info(`  ${chalk.green(symbol)} - New Market Cap: $${mcap.toLocaleString()}`);
    }
    
    logger.info(chalk.green('\n✓ Market cap update complete!'));
    logger.info('BC tokens now correctly show market cap based on 100% circulating supply');
    
  } catch (error) {
    logger.error('Error updating market caps:', error);
    throw error;
  }
  
  process.exit(0);
}

updateBCMarketCaps().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});