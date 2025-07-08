import 'reflect-metadata';
import { Pool } from 'pg';
import { Logger } from '../core/logger';
import 'dotenv/config';

const logger = new Logger({ context: 'CheckAMMTrades' });

async function checkAMMTradesInDatabase() {
  logger.info('🔍 Checking AMM trades in database...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Check recent AMM trades
    const recentTrades = await pool.query(`
      SELECT 
        t.signature,
        t.mint_address,
        t.program,
        t.market_cap_usd,
        t.price_usd,
        t.created_at,
        tk.symbol,
        tk.name,
        tk.graduated_to_amm,
        tk.current_market_cap_usd
      FROM trades_unified t
      LEFT JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE t.program = 'amm_pool'
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    logger.info(`📊 Found ${recentTrades.rows.length} recent AMM trades`);
    
    recentTrades.rows.forEach((trade, index) => {
      logger.info(`Trade ${index + 1}:`, {
        mintAddress: trade.mint_address,
        marketCapUsd: trade.market_cap_usd,
        priceUsd: trade.price_usd,
        symbol: trade.symbol || 'Unknown',
        name: trade.name || 'Unknown',
        graduated: trade.graduated_to_amm,
        currentMarketCap: trade.current_market_cap_usd,
        createdAt: trade.created_at
      });
    });

    // Check AMM trades by market cap ranges
    const marketCapRanges = await pool.query(`
      SELECT 
        CASE 
          WHEN market_cap_usd < 1000 THEN '< $1,000'
          WHEN market_cap_usd < 10000 THEN '$1,000 - $10,000'
          WHEN market_cap_usd < 100000 THEN '$10,000 - $100,000'
          ELSE '> $100,000'
        END as range,
        COUNT(*) as count,
        AVG(market_cap_usd) as avg_market_cap
      FROM trades_unified
      WHERE program = 'amm_pool'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY 1
      ORDER BY 2 DESC
    `);

    logger.info('\n📈 AMM trades by market cap (last 24h):');
    marketCapRanges.rows.forEach(row => {
      logger.info(`${row.range}: ${row.count} trades (avg: $${row.avg_market_cap?.toFixed(2)})`);
    });

    // Check tokens with AMM trades but not graduated
    const notGraduated = await pool.query(`
      SELECT DISTINCT
        t.mint_address,
        tk.symbol,
        tk.name,
        tk.graduated_to_amm,
        tk.current_market_cap_usd,
        COUNT(t.*) as trade_count,
        MAX(t.market_cap_usd) as max_trade_market_cap
      FROM trades_unified t
      LEFT JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE t.program = 'amm_pool'
        AND (tk.graduated_to_amm = false OR tk.graduated_to_amm IS NULL)
      GROUP BY t.mint_address, tk.symbol, tk.name, tk.graduated_to_amm, tk.current_market_cap_usd
      ORDER BY trade_count DESC
      LIMIT 10
    `);

    if (notGraduated.rows.length > 0) {
      logger.info('\n⚠️  Tokens with AMM trades but not marked as graduated:');
      notGraduated.rows.forEach(token => {
        logger.info(`${token.symbol || 'Unknown'} (${token.mint_address}):`, {
          tradeCount: token.trade_count,
          maxTradeMarketCap: token.max_trade_market_cap,
          currentMarketCap: token.current_market_cap_usd,
          graduated: token.graduated_to_amm
        });
      });
    }

    // Check if we're saving low market cap AMM trades
    const lowMarketCapTrades = await pool.query(`
      SELECT COUNT(*) as count
      FROM trades_unified
      WHERE program = 'amm_pool'
        AND market_cap_usd < 1000
        AND created_at > NOW() - INTERVAL '1 hour'
    `);

    logger.info(`\n📉 Low market cap AMM trades (< $1,000) in last hour: ${lowMarketCapTrades.rows[0].count}`);

    // Check the AMM save threshold from environment
    logger.info('\n🔧 Current AMM save threshold:', process.env.AMM_SAVE_THRESHOLD || '1000 (default)');

  } catch (error) {
    logger.error('Database query failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the check
checkAMMTradesInDatabase().catch(error => {
  logger.error('Script failed:', error);
  process.exit(1);
});