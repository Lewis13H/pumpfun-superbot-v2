import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';

config();

async function checkTradeMarketCaps() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Check trades_unified columns first
    const schemaResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'trades_unified'
      ORDER BY ordinal_position
    `);
    
    logger.info('Available columns in trades_unified:');
    const columns = schemaResult.rows.map(r => r.column_name);
    logger.info(columns.join(', '));

    // Check total trade count
    const countResult = await pool.query('SELECT COUNT(*) FROM trades_unified');
    const totalTrades = parseInt(countResult.rows[0].count);
    logger.info(`\nTotal trades: ${totalTrades}`);

    // Check unique tokens
    const uniqueTokensResult = await pool.query('SELECT COUNT(DISTINCT mint_address) FROM trades_unified');
    const uniqueTokens = parseInt(uniqueTokensResult.rows[0].count);
    logger.info(`Unique tokens traded: ${uniqueTokens}`);

    // Check market cap distribution
    const marketCapResult = await pool.query(`
      SELECT 
        COUNT(CASE WHEN market_cap_usd >= 1000000 THEN 1 END) as above_1m,
        COUNT(CASE WHEN market_cap_usd >= 100000 AND market_cap_usd < 1000000 THEN 1 END) as above_100k,
        COUNT(CASE WHEN market_cap_usd >= 10000 AND market_cap_usd < 100000 THEN 1 END) as above_10k,
        COUNT(CASE WHEN market_cap_usd >= 8888 AND market_cap_usd < 10000 THEN 1 END) as above_threshold,
        COUNT(CASE WHEN market_cap_usd >= 1000 AND market_cap_usd < 8888 THEN 1 END) as above_1k,
        COUNT(CASE WHEN market_cap_usd < 1000 THEN 1 END) as below_1k,
        COUNT(CASE WHEN market_cap_usd IS NULL OR market_cap_usd = 0 THEN 1 END) as zero_or_null
      FROM trades_unified
    `);

    logger.info('\nMarket cap distribution:');
    logger.info(`  Above $1M: ${marketCapResult.rows[0].above_1m}`);
    logger.info(`  $100K-$1M: ${marketCapResult.rows[0].above_100k}`);
    logger.info(`  $10K-$100K: ${marketCapResult.rows[0].above_10k}`);
    logger.info(`  $8,888-$10K (threshold): ${marketCapResult.rows[0].above_threshold}`);
    logger.info(`  $1K-$8,888: ${marketCapResult.rows[0].above_1k}`);
    logger.info(`  Below $1K: ${marketCapResult.rows[0].below_1k}`);
    logger.info(`  Zero or NULL: ${marketCapResult.rows[0].zero_or_null}`);

    // Get tokens that should have been saved
    const threshold = parseFloat(process.env.BC_SAVE_THRESHOLD || '8888');
    const qualifiedTokensResult = await pool.query(`
      SELECT DISTINCT mint_address, MAX(market_cap_usd) as max_market_cap
      FROM trades_unified
      WHERE market_cap_usd >= $1
      GROUP BY mint_address
      ORDER BY max_market_cap DESC
      LIMIT 10
    `, [threshold]);

    if (qualifiedTokensResult.rows.length > 0) {
      logger.info(`\nTop tokens with market cap above $${threshold}:`);
      qualifiedTokensResult.rows.forEach((token, index) => {
        logger.info(`${index + 1}. ${token.mint_address?.substring(0, 44)}... - Max MCap: $${Math.round(token.max_market_cap).toLocaleString()}`);
      });
    }

    // Check recent trades with high market caps
    const recentHighMcapResult = await pool.query(`
      SELECT 
        mint_address,
        market_cap_usd,
        price_usd,
        sol_amount,
        created_at
      FROM trades_unified
      WHERE market_cap_usd >= $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [threshold]);

    if (recentHighMcapResult.rows.length > 0) {
      logger.info(`\nRecent trades above $${threshold} market cap:`);
      recentHighMcapResult.rows.forEach((trade, index) => {
        logger.info(`${index + 1}. Token: ${trade.mint_address?.substring(0, 8)}...`);
        logger.info(`   Market Cap: $${Math.round(trade.market_cap_usd).toLocaleString()}`);
        logger.info(`   Price: $${trade.price_usd}`);
        logger.info(`   Time: ${trade.created_at}`);
      });
    }

  } catch (error) {
    logger.error('Error checking trade market caps:', error);
  } finally {
    await pool.end();
  }
}

checkTradeMarketCaps().catch(console.error);