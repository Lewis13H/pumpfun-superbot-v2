// scripts/check-database.ts
// Run with: npx ts-node scripts/check-database.ts

import { pool } from '../src/database';

async function checkDatabase() {
  console.log('🔍 Checking Pump.fun Monitor Database...\n');

  try {
    // 1. Overall stats
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN symbol IS NOT NULL THEN 1 END) as with_metadata,
        COUNT(CASE WHEN graduated THEN 1 END) as graduated,
        COUNT(CASE WHEN archived THEN 1 END) as archived,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as new_last_hour
      FROM tokens
    `);
    
    const stats = statsResult.rows[0];
    console.log('📊 TOKEN STATISTICS:');
    console.log(`   Total tokens: ${stats.total_tokens}`);
    console.log(`   With metadata: ${stats.with_metadata} (${(stats.with_metadata/stats.total_tokens*100).toFixed(1)}%)`);
    console.log(`   Graduated: ${stats.graduated}`);
    console.log(`   Archived: ${stats.archived}`);
    console.log(`   New (last hour): ${stats.new_last_hour}\n`);

    // 2. Recent tokens
    const recentTokens = await pool.query(`
      SELECT 
        address,
        symbol,
        name,
        created_at,
        vanity_id
      FROM tokens
      WHERE created_at > NOW() - INTERVAL '30 minutes'
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (recentTokens.rows.length > 0) {
      console.log('🆕 RECENT TOKENS (last 30 min):');
      recentTokens.rows.forEach(token => {
        const age = Math.floor((Date.now() - new Date(token.created_at).getTime()) / 60000);
        console.log(`   ${token.symbol || 'UNKNOWN'} (${token.address.substring(0, 8)}...) - ${age} min ago`);
      });
      console.log('');
    }

    // 3. Top active tokens
    const activeTokens = await pool.query(`
      SELECT 
        symbol,
        address,
        current_price,
        current_mcap,
        current_liquidity,
        bonding_progress
      FROM active_tokens
      WHERE current_price IS NOT NULL
      ORDER BY current_mcap DESC
      LIMIT 10
    `);

    if (activeTokens.rows.length > 0) {
      console.log('💎 TOP ACTIVE TOKENS BY MARKET CAP:');
      activeTokens.rows.forEach(token => {
        console.log(`   ${token.symbol || 'UNKNOWN'}: $${Number(token.current_price).toFixed(6)} | MCap: $${Number(token.current_mcap).toLocaleString()} | ${token.bonding_progress?.toFixed(1) || '0'}% complete`);
      });
      console.log('');
    }

    // 4. Progress distribution
    const progressDist = await pool.query(`
      SELECT 
        CASE 
          WHEN bonding_progress < 25 THEN '0-25%'
          WHEN bonding_progress < 50 THEN '25-50%'
          WHEN bonding_progress < 75 THEN '50-75%'
          WHEN bonding_progress < 90 THEN '75-90%'
          ELSE '90%+'
        END as range,
        COUNT(*) as count
      FROM active_tokens
      WHERE bonding_progress IS NOT NULL
      GROUP BY range
      ORDER BY range
    `);

    console.log('📈 BONDING CURVE PROGRESS DISTRIBUTION:');
    progressDist.rows.forEach(row => {
      console.log(`   ${row.range}: ${row.count} tokens`);
    });
    console.log('');

    // 5. Price update activity
    const activityResult = await pool.query(`
      SELECT 
        COUNT(*) as total_updates,
        COUNT(DISTINCT token) as unique_tokens,
        MAX(time) as latest_update
      FROM price_updates
      WHERE time > NOW() - INTERVAL '5 minutes'
    `);

    const activity = activityResult.rows[0];
    if (activity.total_updates > 0) {
      const updateRate = activity.total_updates / 5; // per minute
      console.log('⚡ RECENT ACTIVITY (last 5 min):');
      console.log(`   Total updates: ${activity.total_updates}`);
      console.log(`   Unique tokens: ${activity.unique_tokens}`);
      console.log(`   Update rate: ${updateRate.toFixed(1)} per minute`);
      console.log(`   Latest: ${new Date(activity.latest_update).toLocaleTimeString()}\n`);
    }

    // 6. Close to graduation
    const nearGraduation = await pool.query(`
      SELECT symbol, address, bonding_progress, current_mcap
      FROM active_tokens
      WHERE bonding_progress > 80
      ORDER BY bonding_progress DESC
      LIMIT 5
    `);

    if (nearGraduation.rows.length > 0) {
      console.log('🎓 CLOSE TO GRADUATION (>80%):');
      nearGraduation.rows.forEach(token => {
        console.log(`   ${token.symbol || token.address.substring(0, 8)}: ${token.bonding_progress.toFixed(1)}% | MCap: $${Number(token.current_mcap).toLocaleString()}`);
      });
      console.log('');
    }

    // 7. Data quality check
    const qualityCheck = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens WHERE symbol IS NULL) as no_metadata,
        (SELECT COUNT(*) FROM tokens t WHERE NOT EXISTS (SELECT 1 FROM price_updates p WHERE p.token = t.address)) as no_prices,
        (SELECT COUNT(*) FROM price_updates WHERE price_usd <= 0) as zero_prices
    `);

    const quality = qualityCheck.rows[0];
    console.log('🔧 DATA QUALITY:');
    console.log(`   Tokens without metadata: ${quality.no_metadata}`);
    console.log(`   Tokens without prices: ${quality.no_prices}`);
    console.log(`   Zero/negative prices: ${quality.zero_prices}`);

  } catch (error) {
    console.error('❌ Database check failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the check
checkDatabase().catch(console.error);