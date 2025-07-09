import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';

config();

async function checkTokensInDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Check total token count
    const countResult = await pool.query('SELECT COUNT(*) FROM tokens_unified');
    const totalTokens = parseInt(countResult.rows[0].count);
    
    logger.info(`Total tokens in database: ${totalTokens}`);

    // Get sample of tokens
    if (totalTokens > 0) {
      const sampleResult = await pool.query(`
        SELECT 
          mint_address,
          symbol,
          name,
          current_price_usd,
          market_cap_usd,
          graduated_to_amm,
          created_at,
          updated_at
        FROM tokens_unified
        ORDER BY updated_at DESC
        LIMIT 10
      `);

      logger.info('Sample of recent tokens:');
      sampleResult.rows.forEach((token, index) => {
        logger.info(`${index + 1}. ${token.symbol || 'N/A'} (${token.name || 'N/A'})`);
        logger.info(`   Mint: ${token.mint_address}`);
        logger.info(`   Price: $${token.current_price_usd || 0}`);
        logger.info(`   Market Cap: $${token.market_cap_usd || 0}`);
        logger.info(`   Graduated: ${token.graduated_to_amm ? 'Yes' : 'No'}`);
        logger.info(`   Updated: ${token.updated_at}`);
        logger.info('---');
      });
    }

    // Check for tokens with price > 0
    const priceResult = await pool.query(
      'SELECT COUNT(*) FROM tokens_unified WHERE current_price_usd > 0'
    );
    const tokensWithPrice = parseInt(priceResult.rows[0].count);
    logger.info(`Tokens with price > 0: ${tokensWithPrice}`);

    // Check for tokens with market cap > threshold
    const thresholdResult = await pool.query(
      'SELECT COUNT(*) FROM tokens_unified WHERE market_cap_usd >= $1',
      [parseFloat(process.env.BC_SAVE_THRESHOLD || '8888')]
    );
    const tokensAboveThreshold = parseInt(thresholdResult.rows[0].count);
    logger.info(`Tokens above BC threshold ($${process.env.BC_SAVE_THRESHOLD || '8888'}): ${tokensAboveThreshold}`);

  } catch (error) {
    logger.error('Error checking database:', error);
  } finally {
    await pool.end();
  }
}

checkTokensInDatabase().catch(console.error);