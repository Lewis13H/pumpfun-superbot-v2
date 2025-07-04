import { db } from '../database';

async function checkAMMActivity() {
  console.log('🔍 Checking AMM Activity...\n');

  try {
    // Check for graduated tokens
    const graduatedTokens = await db.query(`
      SELECT COUNT(*) as count,
             COUNT(*) FILTER (WHERE graduation_at IS NOT NULL) as with_date
      FROM tokens_unified 
      WHERE graduated_to_amm = true
    `);
    console.log(`📊 Graduated Tokens: ${graduatedTokens.rows[0].count} (${graduatedTokens.rows[0].with_date} with graduation date)\n`);

    // Check for AMM trades
    const ammTrades = await db.query(`
      SELECT COUNT(*) as total_trades,
             COUNT(DISTINCT mint_address) as unique_tokens,
             MIN(block_time) as first_trade,
             MAX(block_time) as last_trade,
             SUM(volume_usd) as total_volume
      FROM trades_unified 
      WHERE program = 'amm_pool'
    `);
    
    const stats = ammTrades.rows[0];
    console.log('📈 AMM Trade Statistics:');
    console.log(`   Total Trades: ${stats.total_trades}`);
    console.log(`   Unique Tokens: ${stats.unique_tokens}`);
    console.log(`   Total Volume: $${stats.total_volume || 0}`);
    console.log(`   First Trade: ${stats.first_trade || 'None'}`);
    console.log(`   Last Trade: ${stats.last_trade || 'None'}\n`);

    // Check for AMM pool states
    const poolStates = await db.query(`
      SELECT COUNT(*) as count,
             COUNT(DISTINCT pool_address) as unique_pools
      FROM amm_pool_states
    `);
    console.log(`🏊 AMM Pool States: ${poolStates.rows[0].count} records, ${poolStates.rows[0].unique_pools} unique pools\n`);

    // Check recent BC trades that might be close to graduation
    const nearGraduation = await db.query(`
      SELECT mint_address, 
             symbol, 
             name,
             MAX(bonding_curve_progress) as max_progress,
             MAX(market_cap_usd) as max_market_cap,
             COUNT(*) as trade_count
      FROM trades_unified t
      JOIN tokens_unified tok ON tok.mint_address = t.mint_address
      WHERE t.program = 'bonding_curve' 
        AND t.bonding_curve_progress > 90
        AND tok.graduated_to_amm = false
      GROUP BY t.mint_address, symbol, name
      ORDER BY max_progress DESC
      LIMIT 10
    `);

    if (nearGraduation.rows.length > 0) {
      console.log('🎯 Tokens Close to Graduation (>90% progress):');
      nearGraduation.rows.forEach(token => {
        console.log(`   ${token.symbol || 'UNKNOWN'} - ${token.max_progress}% - $${parseFloat(token.max_market_cap).toFixed(0)} MC`);
      });
    } else {
      console.log('🎯 No tokens currently close to graduation (>90% progress)');
    }

    // Check for any liquidity events
    const liquidityEvents = await db.query(`
      SELECT COUNT(*) as count FROM liquidity_events
    `);
    console.log(`\n💧 Liquidity Events: ${liquidityEvents.rows[0].count}`);

    // Check if AMM monitor is receiving any data
    console.log('\n🔍 Debugging Tips:');
    console.log('1. AMM trades only happen after tokens graduate from bonding curve');
    console.log('2. Most graduations go to Raydium, not pump.swap AMM');
    console.log('3. Run graduation fixer: npx tsx src/scripts/fix-graduated-tokens.ts');
    console.log('4. Check if any tokens show 100% progress but not graduated');

  } catch (error) {
    console.error('Error checking AMM activity:', error);
  } finally {
    await db.end();
  }
}

checkAMMActivity().catch(console.error);