// scripts/debug-prices.ts
// Debug script to check price calculations
// Run with: npx ts-node scripts/debug-prices.ts

import { pool } from '../src/database';

async function debugPrices() {
  console.log('🔍 Debugging Price Calculations\n');

  try {
    // 1. Check raw price data
    const rawPrices = await pool.query(`
      SELECT 
        token,
        price_sol,
        price_usd,
        virtual_sol_reserves,
        virtual_token_reserves,
        liquidity_sol,
        market_cap_usd
      FROM price_updates
      WHERE time > NOW() - INTERVAL '1 hour'
      ORDER BY time DESC
      LIMIT 10
    `);

    console.log('📊 RAW PRICE DATA:');
    rawPrices.rows.forEach(row => {
      console.log(`\nToken: ${row.token.substring(0, 12)}...`);
      console.log(`  Virtual SOL: ${row.virtual_sol_reserves || 'null'}`);
      console.log(`  Virtual Tokens: ${row.virtual_token_reserves || 'null'}`);
      console.log(`  Price SOL: ${row.price_sol}`);
      console.log(`  Price USD: ${row.price_usd}`);
      console.log(`  Liquidity SOL: ${row.liquidity_sol}`);
      console.log(`  Market Cap: ${Number(row.market_cap_usd).toLocaleString()}`);
      
      // Recalculate to verify
      if (row.virtual_sol_reserves && row.virtual_token_reserves) {
        const vSol = Number(row.virtual_sol_reserves);
        const vTokens = Number(row.virtual_token_reserves);
        
        // Try different calculations
        const calc1 = (vSol / 1e9) / (vTokens / 1e6); // Standard
        const calc2 = vSol / vTokens; // Direct ratio
        const calc3 = (vSol / 1e9) / (vTokens / 1e9); // Both in billions
        
        console.log(`  Calc1 (standard): ${calc1.toFixed(10)}`);
        console.log(`  Calc2 (direct): ${calc2.toFixed(10)}`);
        console.log(`  Calc3 (billions): ${calc3.toFixed(10)}`);
      }
    });

    // 2. Check if prices make sense
    const priceStats = await pool.query(`
      SELECT 
        MIN(price_usd) as min_price,
        MAX(price_usd) as max_price,
        AVG(price_usd) as avg_price,
        COUNT(CASE WHEN price_usd > 1 THEN 1 END) as high_prices,
        COUNT(CASE WHEN price_usd < 0.0001 THEN 1 END) as low_prices
      FROM price_updates
      WHERE time > NOW() - INTERVAL '1 hour'
    `);

    const stats = priceStats.rows[0];
    console.log('\n📈 PRICE STATISTICS:');
    console.log(`  Min: $${Number(stats.min_price).toFixed(8)}`);
    console.log(`  Max: $${Number(stats.max_price).toFixed(8)}`);
    console.log(`  Avg: $${Number(stats.avg_price).toFixed(8)}`);
    console.log(`  Prices > $1: ${stats.high_prices}`);
    console.log(`  Prices < $0.0001: ${stats.low_prices}`);

    // 3. Compare with expected values
    console.log('\n⚠️  ISSUES DETECTED:');
    if (Number(stats.avg_price) > 0.01) {
      console.log('  - Average price too high (should be < $0.01 for new tokens)');
    }
    if (stats.high_prices > 0) {
      console.log(`  - ${stats.high_prices} tokens with price > $1 (suspicious)`);
    }

    // 4. Sample calculation
    console.log('\n🧮 SAMPLE CALCULATION:');
    console.log('  Typical pump.fun values:');
    console.log('  - Virtual SOL: 30 SOL (30,000,000,000 lamports)');
    console.log('  - Virtual Tokens: 800M (800,000,000,000,000 with 6 decimals)');
    console.log('  - Expected price: 30 / 800,000,000 = $0.0000000375 per token');
    console.log('  - Expected MCap: $0.0000000375 * 1B = $37.50');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

debugPrices().catch(console.error);