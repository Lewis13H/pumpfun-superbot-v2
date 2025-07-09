import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';

config();

async function insertTestTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Get the top tokens by market cap from trades
    const topTokensResult = await pool.query(`
      SELECT 
        tu.mint_address,
        MAX(tu.price_sol) as latest_price_sol,
        MAX(tu.price_usd) as latest_price_usd,
        MAX(tu.market_cap_usd) as max_market_cap,
        MIN(tu.slot) as first_seen_slot,
        FIRST_VALUE(tu.program) OVER (PARTITION BY tu.mint_address ORDER BY tu.slot) as first_program,
        COUNT(*) as trade_count
      FROM trades_unified tu
      WHERE tu.market_cap_usd > 1000
      GROUP BY tu.mint_address, tu.program, tu.slot
      ORDER BY max_market_cap DESC
      LIMIT 10
    `);

    logger.info(`Found ${topTokensResult.rows.length} tokens with >$1000 market cap`);

    // Insert these tokens into tokens_unified
    for (const token of topTokensResult.rows) {
      await pool.query(`
        INSERT INTO tokens_unified (
          mint_address,
          symbol,
          name,
          current_price_sol,
          current_price_usd,
          latest_market_cap_usd,
          total_trades,
          graduated_to_amm,
          first_seen_slot,
          created_at,
          updated_at,
          first_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), NOW())
        ON CONFLICT (mint_address) 
        DO UPDATE SET
          current_price_sol = EXCLUDED.current_price_sol,
          current_price_usd = EXCLUDED.current_price_usd,
          latest_market_cap_usd = EXCLUDED.latest_market_cap_usd,
          total_trades = EXCLUDED.total_trades,
          updated_at = NOW()
      `, [
        token.mint_address,
        'UNKNOWN',  // We don't have symbol in trades table
        'Unknown Token',  // We don't have name in trades table
        token.latest_price_sol,
        token.latest_price_usd,
        token.max_market_cap,
        token.trade_count,
        false,  // graduated_to_amm
        token.first_seen_slot
      ]);
      
      logger.info(`Inserted token ${token.mint_address} with market cap $${token.max_market_cap}`);
    }

    // Check how many tokens we have now
    const countResult = await pool.query('SELECT COUNT(*) FROM tokens_unified');
    logger.info(`Total tokens in database: ${countResult.rows[0].count}`);

  } catch (error) {
    logger.error('Error inserting test tokens:', error);
  } finally {
    await pool.end();
  }
}

insertTestTokens().catch(console.error);