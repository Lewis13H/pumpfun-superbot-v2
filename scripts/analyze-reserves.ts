// scripts/analyze-reserves.ts
// Analyze what's wrong with the price calculations
// Run with: npx ts-node scripts/analyze-reserves.ts

import { pool } from '../src/database';

async function analyzeReserves() {
  console.log('🔍 Analyzing Reserve Data and Prices\n');

  try {
    // 1. Get some recent data with reserves
    const recentData = await pool.query(`
      SELECT 
        token,
        price_sol,
        price_usd,
        virtual_sol_reserves,
        virtual_token_reserves,
        market_cap_usd,
        time
      FROM price_updates
      WHERE virtual_sol_reserves IS NOT NULL
        AND virtual_token_reserves IS NOT NULL
      ORDER BY time DESC
      LIMIT 10
    `);

    if (recentData.rows.length === 0) {
      console.log('No data with reserves found. Running without reserve data...\n');
      
      // Get data without reserves
      const dataNoReserves = await pool.query(`
        SELECT 
          token,
          price_sol,
          price_usd,
          market_cap_usd,
          liquidity_sol,
          time
        FROM price_updates
        ORDER BY time DESC
        LIMIT 10
      `);

      console.log('📊 RECENT PRICE DATA (no reserves):');
      dataNoReserves.rows.forEach(row => {
        console.log(`\n${row.token.substring(0, 12)}...`);
        console.log(`  Price: ${row.price_sol} SOL = $${row.price_usd}`);
        console.log(`  MCap: $${Number(row.market_cap_usd).toLocaleString()}`);
        console.log(`  Liquidity: ${row.liquidity_sol} SOL`);
        
        // Calculate what the reserves might be
        const impliedTokens = Number(row.market_cap_usd) / Number(row.price_usd);
        console.log(`  Implied calculation: $${row.market_cap_usd} / $${row.price_usd} = ${impliedTokens.toLocaleString()} tokens`);
      });
    } else {
      console.log('📊 ANALYZING RESERVE DATA:');
      
      recentData.rows.forEach(row => {
        const vSol = Number(row.virtual_sol_reserves);
        const vTokens = Number(row.virtual_token_reserves);
        
        console.log(`\n${row.token.substring(0, 12)}...`);
        console.log(`  Stored price: ${row.price_sol} SOL = $${row.price_usd}`);
        console.log(`  Virtual reserves: ${vSol} / ${vTokens}`);
        
        // Try different calculations
        const calc1 = (vSol / 1e9) / (vTokens / 1e6); // Standard (6 decimals)
        const calc2 = (vSol / 1e9) / vTokens; // No token decimals
        const calc3 = vSol / vTokens; // Direct ratio
        const calc4 = (vSol / 1e9) / (vTokens / 1e9); // Both 9 decimals
        
        console.log(`  Calc1 (6 dec): ${calc1.toFixed(9)} SOL`);
        console.log(`  Calc2 (no dec): ${calc2.toFixed(9)} SOL`);
        console.log(`  Calc3 (direct): ${calc3.toFixed(9)} SOL`);
        console.log(`  Calc4 (9 dec): ${calc4.toFixed(9)} SOL`);
        
        // Which one matches stored price?
        const stored = Number(row.price_sol);
        if (Math.abs(calc1 - stored) < 0.000001) console.log('  ✅ Matches calc1 (6 decimals)');
        else if (Math.abs(calc2 - stored) < 0.000001) console.log('  ✅ Matches calc2 (no decimals)');
        else if (Math.abs(calc3 - stored) < 0.000001) console.log('  ✅ Matches calc3 (direct)');
        else if (Math.abs(calc4 - stored) < 0.000001) console.log('  ✅ Matches calc4 (9 decimals)');
        else console.log('  ❌ No calculation matches stored price');
        
        // Market cap check
        const mcapCalc = Number(row.price_usd) * 1_000_000_000;
        console.log(`  MCap check: $${row.price_usd} * 1B = $${mcapCalc.toLocaleString()}`);
        console.log(`  Stored MCap: $${Number(row.market_cap_usd).toLocaleString()}`);
      });
    }

    // 2. Check for typical pump.fun values
    console.log('\n📏 EXPECTED PUMP.FUN RANGES:');
    console.log('  New token price: $0.000001 - $0.01');
    console.log('  New token mcap: $1,000 - $10,000,000');
    console.log('  Virtual SOL: 30-100 SOL (30-100 billion lamports)');
    console.log('  Virtual tokens: 700M - 1B tokens');
    
    // 3. Find outliers
    const outliers = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN price_usd > 1 THEN 1 END) as high_price,
        COUNT(CASE WHEN market_cap_usd > 1000000000 THEN 1 END) as high_mcap,
        AVG(price_usd) as avg_price,
        MAX(price_usd) as max_price,
        MIN(price_usd) as min_price
      FROM price_updates
      WHERE time > NOW() - INTERVAL '1 hour'
    `);

    const stats = outliers.rows[0];
    console.log('\n🚨 OUTLIER ANALYSIS (last hour):');
    console.log(`  Total updates: ${stats.total}`);
    console.log(`  High price (>$1): ${stats.high_price} (${(stats.high_price/stats.total*100).toFixed(1)}%)`);
    console.log(`  High mcap (>$1B): ${stats.high_mcap} (${(stats.high_mcap/stats.total*100).toFixed(1)}%)`);
    console.log(`  Price range: $${Number(stats.min_price).toFixed(6)} - $${Number(stats.max_price).toFixed(6)}`);
    console.log(`  Average: $${Number(stats.avg_price).toFixed(6)}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

analyzeReserves().catch(console.error);