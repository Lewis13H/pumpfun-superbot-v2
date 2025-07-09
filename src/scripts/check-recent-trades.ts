import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';

config();

async function checkRecentTrades() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Check if trades_unified table exists
    const tableExistsResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'trades_unified'
      )
    `);
    
    if (!tableExistsResult.rows[0].exists) {
      logger.error('Table trades_unified does not exist!');
      return;
    }

    // Check total trade count
    const countResult = await pool.query('SELECT COUNT(*) FROM trades_unified');
    const totalTrades = parseInt(countResult.rows[0].count);
    logger.info(`Total trades in database: ${totalTrades}`);

    // Get recent trades
    if (totalTrades > 0) {
      const recentTradesResult = await pool.query(`
        SELECT 
          signature,
          mint_address,
          type,
          trader,
          token_amount,
          sol_amount,
          price_sol,
          price_usd,
          market_cap_usd,
          created_at
        FROM trades_unified
        ORDER BY created_at DESC
        LIMIT 10
      `);

      logger.info('\nRecent trades:');
      recentTradesResult.rows.forEach((trade, index) => {
        logger.info(`${index + 1}. ${trade.type} - Token: ${trade.mint_address?.substring(0, 8)}...`);
        logger.info(`   Sol Amount: ${trade.sol_amount}`);
        logger.info(`   Price USD: $${trade.price_usd || 0}`);
        logger.info(`   Market Cap: $${trade.market_cap_usd || 0}`);
        logger.info(`   Time: ${trade.created_at}`);
        logger.info('---');
      });

      // Check market caps above threshold
      const thresholdResult = await pool.query(`
        SELECT COUNT(DISTINCT mint_address) as tokens_above_threshold
        FROM trades_unified
        WHERE market_cap_usd >= $1
      `, [parseFloat(process.env.BC_SAVE_THRESHOLD || '8888')]);
      
      logger.info(`\nUnique tokens with market cap above $${process.env.BC_SAVE_THRESHOLD || '8888'}: ${thresholdResult.rows[0].tokens_above_threshold}`);
    }

    // Check if any AMM trades exist
    const ammTradesResult = await pool.query(`
      SELECT COUNT(*) FROM trades_unified WHERE program = 'amm'
    `);
    const ammTrades = parseInt(ammTradesResult.rows[0].count);
    logger.info(`\nAMM trades: ${ammTrades}`);

  } catch (error) {
    logger.error('Error checking trades:', error);
  } finally {
    await pool.end();
  }
}

checkRecentTrades().catch(console.error);