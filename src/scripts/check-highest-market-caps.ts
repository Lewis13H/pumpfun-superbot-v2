import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';

config();

async function checkHighestMarketCaps() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Get highest market cap tokens
    const highestMcapResult = await pool.query(`
      SELECT 
        mint_address,
        MAX(market_cap_usd) as max_market_cap,
        MAX(price_usd) as max_price,
        COUNT(*) as trade_count,
        MAX(created_at) as last_trade
      FROM trades_unified
      WHERE market_cap_usd > 0
      GROUP BY mint_address
      ORDER BY max_market_cap DESC
      LIMIT 20
    `);

    logger.info('Top 20 tokens by market cap:');
    highestMcapResult.rows.forEach((token, index) => {
      logger.info(`${index + 1}. Token: ${token.mint_address}`);
      logger.info(`   Max Market Cap: $${Math.round(token.max_market_cap).toLocaleString()}`);
      logger.info(`   Max Price: $${token.max_price}`);
      logger.info(`   Trade Count: ${token.trade_count}`);
      logger.info(`   Last Trade: ${token.last_trade}`);
      logger.info('---');
    });

    // Check the current threshold
    const threshold = parseFloat(process.env.BC_SAVE_THRESHOLD || '8888');
    logger.info(`\nCurrent BC_SAVE_THRESHOLD: $${threshold}`);
    
    // Count how many tokens would be saved at different thresholds
    const thresholds = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 8888];
    for (const t of thresholds) {
      const result = await pool.query(`
        SELECT COUNT(DISTINCT mint_address) as count
        FROM trades_unified
        WHERE market_cap_usd >= $1
      `, [t]);
      logger.info(`Tokens with market cap >= $${t}: ${result.rows[0].count}`);
    }

  } catch (error) {
    logger.error('Error checking highest market caps:', error);
  } finally {
    await pool.end();
  }
}

checkHighestMarketCaps().catch(console.error);