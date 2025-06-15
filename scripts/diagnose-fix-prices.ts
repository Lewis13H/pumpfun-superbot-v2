// scripts/diagnose-fix-prices.ts
// Diagnose and fix price issues in the database
// Run with: npx ts-node scripts/diagnose-fix-prices.ts

import { pool } from '../src/database';

async function diagnoseAndFix() {
  console.log('🔍 Diagnosing Price Issues...\n');

  try {
    // 1. Check current state
    const diagnosis = await pool.query(`
      SELECT 
        COUNT(*) as total_rows,
        AVG(price_usd) as avg_price_usd,
        AVG(price_sol) as avg_price_sol,
        MAX(price_usd) as max_price_usd,
        COUNT(CASE WHEN price_usd > 1 THEN 1 END) as high_usd_prices,
        COUNT(CASE WHEN price_sol IS NULL OR price_sol = 0 THEN 1 END) as missing_sol_prices
      FROM price_updates
      WHERE time > NOW() - INTERVAL '2 hours'
    `);

    const stats = diagnosis.rows[0];
    console.log('📊 CURRENT STATE:');
    console.log(`  Total price updates: ${stats.total_rows}`);
    console.log(`  Average USD price: $${Number(stats.avg_price_usd).toFixed(6)}`);
    console.log(`  Average SOL price: ${Number(stats.avg_price_sol || 0).toFixed(6)} SOL`);
    console.log(`  Max USD price: $${Number(stats.max_price_usd).toFixed(6)}`);
    console.log(`  High prices (>$1): ${stats.high_usd_prices}`);
    console.log(`  Missing SOL prices: ${stats.missing_sol_prices}\n`);

    // 2. Identify the issue
    if (stats.high_usd_prices > stats.total_rows * 0.5 && (stats.missing_sol_prices > stats.total_rows * 0.8 || Number(stats.avg_price_sol || 0) === 0)) {
      console.log('❌ ISSUE DETECTED: price_usd column contains SOL prices, not USD prices');
      console.log('   This happened because solPrice was not initialized properly\n');

      // 3. Ask for confirmation
      console.log('🔧 FIX AVAILABLE:');
      console.log('   1. Move price_usd values to price_sol column');
      console.log('   2. Recalculate price_usd using SOL price of $150');
      console.log('   3. Recalculate market caps\n');

      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>(resolve => {
        rl.question('Apply fix? (yes/no): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() === 'yes') {
        console.log('\n🔧 Applying fix...');

        // Backup first
        await pool.query(`
          CREATE TABLE IF NOT EXISTS price_updates_backup_${Date.now()} AS 
          SELECT * FROM price_updates
        `);

        // Apply fix
        const result = await pool.query(`
          UPDATE price_updates
          SET 
            price_sol = price_usd,
            price_usd = price_usd * 150,
            market_cap_usd = (price_usd * 150) * 1000000000
          WHERE 
            (price_sol IS NULL OR price_sol = 0)
            AND price_usd > 0.0001
            AND price_usd < 100
            AND time > NOW() - INTERVAL '24 hours'
          RETURNING token
        `);

        console.log(`✅ Fixed ${result.rowCount} price entries\n`);

        // Show sample of fixed data
        const sample = await pool.query(`
          SELECT 
            token,
            price_sol,
            price_usd,
            market_cap_usd,
            liquidity_usd
          FROM price_updates
          WHERE time > NOW() - INTERVAL '10 minutes'
          ORDER BY time DESC
          LIMIT 5
        `);

        console.log('📊 SAMPLE FIXED DATA:');
        sample.rows.forEach(row => {
          console.log(`  ${row.token.substring(0, 12)}...`);
          console.log(`    Price: ${row.price_sol.toFixed(8)} SOL = $${row.price_usd.toFixed(8)}`);
          console.log(`    MCap: $${Number(row.market_cap_usd).toLocaleString()}\n`);
        });
      }
    } else {
      console.log('✅ Prices appear to be correctly stored');
      console.log('   Average price is reasonable for pump.fun tokens\n');

      // Show distribution
      const distribution = await pool.query(`
        SELECT 
          CASE 
            WHEN price_usd < 0.00001 THEN '< $0.00001'
            WHEN price_usd < 0.0001 THEN '$0.00001 - $0.0001'
            WHEN price_usd < 0.001 THEN '$0.0001 - $0.001'
            WHEN price_usd < 0.01 THEN '$0.001 - $0.01'
            WHEN price_usd < 0.1 THEN '$0.01 - $0.1'
            WHEN price_usd < 1 THEN '$0.1 - $1'
            ELSE '> $1'
          END as price_range,
          COUNT(*) as count
        FROM price_updates
        WHERE time > NOW() - INTERVAL '1 hour'
        GROUP BY price_range
        ORDER BY 
          CASE price_range
            WHEN '< $0.00001' THEN 1
            WHEN '$0.00001 - $0.0001' THEN 2
            WHEN '$0.0001 - $0.001' THEN 3
            WHEN '$0.001 - $0.01' THEN 4
            WHEN '$0.01 - $0.1' THEN 5
            WHEN '$0.1 - $1' THEN 6
            ELSE 7
          END
      `);

      console.log('📈 PRICE DISTRIBUTION:');
      distribution.rows.forEach(row => {
        console.log(`  ${row.price_range}: ${row.count} tokens`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

diagnoseAndFix().catch(console.error);