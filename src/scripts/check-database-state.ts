import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkDatabaseState() {
  console.log('🔍 Checking database state...\n');

  try {
    // 1. Check tokens_unified
    console.log('📊 Tokens in database:');
    const tokenCountQuery = `
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN graduated_to_amm = true THEN 1 END) as graduated_tokens,
        COUNT(CASE WHEN current_price_usd > 0 THEN 1 END) as tokens_with_price,
        COUNT(CASE WHEN latest_market_cap_usd > 0 THEN 1 END) as tokens_with_market_cap
      FROM tokens_unified
    `;
    const tokenCountResult = await pool.query(tokenCountQuery);
    const counts = tokenCountResult.rows[0];
    
    console.log(`  - Total tokens: ${counts.total_tokens}`);
    console.log(`  - Graduated to AMM: ${counts.graduated_tokens}`);
    console.log(`  - With price > 0: ${counts.tokens_with_price}`);
    console.log(`  - With market cap > 0: ${counts.tokens_with_market_cap}`);

    // 2. Check recent tokens
    console.log('\n📊 Recent tokens (last 10):');
    const recentTokensQuery = `
      SELECT 
        mint_address,
        symbol,
        graduated_to_amm,
        current_price_usd,
        latest_market_cap_usd,
        created_at
      FROM tokens_unified
      ORDER BY created_at DESC
      LIMIT 10
    `;
    const recentTokensResult = await pool.query(recentTokensQuery);
    
    for (const token of recentTokensResult.rows) {
      console.log(`  ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 16)}...)`);
      console.log(`    Graduated: ${token.graduated_to_amm}, Price: $${token.current_price_usd || 0}, MCap: $${token.latest_market_cap_usd || 0}`);
    }

    // 3. Check trades_unified
    console.log('\n📊 Trades in database:');
    const tradeCountQuery = `
      SELECT 
        program,
        COUNT(*) as count,
        COUNT(DISTINCT mint_address) as unique_tokens,
        MAX(block_time) as latest_trade
      FROM trades_unified
      WHERE block_time > NOW() - INTERVAL '1 hour'
      GROUP BY program
    `;
    const tradeCountResult = await pool.query(tradeCountQuery);
    
    for (const row of tradeCountResult.rows) {
      console.log(`  - ${row.program}: ${row.count} trades, ${row.unique_tokens} tokens, latest: ${new Date(row.latest_trade).toLocaleString()}`);
    }

    // 4. Check for AMM tokens not in tokens_unified
    console.log('\n📊 AMM tokens not in tokens_unified:');
    const missingTokensQuery = `
      SELECT DISTINCT t.mint_address, COUNT(*) as trade_count
      FROM trades_unified t
      LEFT JOIN tokens_unified tu ON t.mint_address = tu.mint_address
      WHERE t.program = 'amm_pool' 
        AND tu.mint_address IS NULL
        AND t.block_time > NOW() - INTERVAL '1 hour'
      GROUP BY t.mint_address
      ORDER BY trade_count DESC
      LIMIT 10
    `;
    const missingTokensResult = await pool.query(missingTokensQuery);
    
    console.log(`Found ${missingTokensResult.rows.length} AMM tokens not in tokens_unified:`);
    for (const token of missingTokensResult.rows) {
      console.log(`  - ${token.mint_address}: ${token.trade_count} trades`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkDatabaseState().catch(console.error);