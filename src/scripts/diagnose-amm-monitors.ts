import { db } from '../database';

async function diagnoseAMMMonitors() {
  console.log('🔍 Diagnosing AMM Monitor Issues...\n');

  try {
    // 1. Check recent AMM trades in database
    const recentAMM = await db.query(`
      SELECT 
        COUNT(*) as count,
        MAX(block_time) as last_trade_time,
        MIN(block_time) as first_trade_time,
        COUNT(DISTINCT mint_address) as unique_tokens
      FROM trades_unified 
      WHERE program = 'amm_pool'
        AND block_time > NOW() - INTERVAL '1 hour'
    `);
    
    console.log('📊 AMM Trades in Last Hour:');
    console.log(`   Count: ${recentAMM.rows[0].count}`);
    console.log(`   Last Trade: ${recentAMM.rows[0].last_trade_time || 'None'}`);
    console.log(`   Unique Tokens: ${recentAMM.rows[0].unique_tokens}\n`);

    // 2. Check AMM trades by time period
    const tradesByPeriod = await db.query(`
      SELECT 
        DATE_TRUNC('hour', block_time) as hour,
        COUNT(*) as trade_count,
        COUNT(DISTINCT mint_address) as unique_tokens,
        SUM(volume_usd) as volume
      FROM trades_unified 
      WHERE program = 'amm_pool'
        AND block_time > NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
      LIMIT 10
    `);

    console.log('📈 AMM Trades by Hour (Last 24h):');
    tradesByPeriod.rows.forEach((row: any) => {
      const hour = new Date(row.hour).toLocaleString();
      console.log(`   ${hour}: ${row.trade_count} trades, ${row.unique_tokens} tokens, $${parseFloat(row.volume || 0).toFixed(0)} volume`);
    });
    console.log('');

    // 3. Check if AMM pool states are being updated
    const poolStateUpdates = await db.query(`
      SELECT 
        COUNT(*) as total_updates,
        COUNT(DISTINCT pool_address) as unique_pools,
        MAX(created_at) as last_update,
        MIN(created_at) as first_update
      FROM amm_pool_states
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);

    console.log('🏊 AMM Pool State Updates (Last Hour):');
    console.log(`   Total Updates: ${poolStateUpdates.rows[0].total_updates}`);
    console.log(`   Unique Pools: ${poolStateUpdates.rows[0].unique_pools}`);
    console.log(`   Last Update: ${poolStateUpdates.rows[0].last_update || 'None'}\n`);

    // 4. Check for graduated tokens that should have AMM activity
    const graduatedRecent = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        graduation_at,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE graduated_to_amm = true
        AND graduation_at > NOW() - INTERVAL '24 hours'
      ORDER BY graduation_at DESC
      LIMIT 10
    `);

    console.log('🎓 Recently Graduated Tokens (Last 24h):');
    if (graduatedRecent.rows.length > 0) {
      graduatedRecent.rows.forEach((token: any) => {
        console.log(`   ${token.symbol || 'UNKNOWN'} - Graduated: ${new Date(token.graduation_at).toLocaleString()}`);
      });
    } else {
      console.log('   No recent graduations found');
    }
    console.log('');

    // 5. Check the pump.swap program ID being monitored
    console.log('🔧 Configuration Check:');
    console.log('   pump.swap Program ID: 61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu');
    console.log('   (Ensure this matches the actual pump.swap program)\n');

    // 6. Look for any error patterns
    console.log('🚨 Common Issues:');
    console.log('1. Wrong program ID - pump.swap might have changed');
    console.log('2. Subscription filter not working - similar to Raydium issue');
    console.log('3. Graduated tokens using different AMM (Raydium instead of pump.swap)');
    console.log('4. Network/RPC issues preventing transaction reception\n');

    // 7. Check monitoring stats
    console.log('💡 Next Steps:');
    console.log('1. Check logs for AMM monitor errors');
    console.log('2. Verify pump.swap program ID is correct');
    console.log('3. Test direct subscription to pump.swap program');
    console.log('4. Check if graduated tokens are actually using pump.swap or Raydium');

  } catch (error) {
    console.error('Error diagnosing AMM monitors:', error);
  } finally {
    await (db as any).close();
  }
}

diagnoseAMMMonitors().catch(console.error);