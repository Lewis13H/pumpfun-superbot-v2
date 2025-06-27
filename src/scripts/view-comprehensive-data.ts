#!/usr/bin/env node
import { db } from '../database';

async function viewData() {
  console.log('📊 Comprehensive Monitoring Database Overview\n');
  
  try {
    // Check tokens
    const tokensResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        first_program,
        first_market_cap_usd,
        threshold_market_cap_usd,
        graduated_to_amm,
        created_at
      FROM tokens_comprehensive
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log(`💎 Tokens Saved (${tokensResult.rows.length} latest):`);
    if (tokensResult.rows.length === 0) {
      console.log('  No tokens saved yet (none reached $8,888 threshold)\n');
    } else {
      tokensResult.rows.forEach((token: any) => {
        console.log(`  ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
        console.log(`    First seen: ${token.first_program} at $${parseFloat(token.first_market_cap_usd).toFixed(2)}`);
        console.log(`    Graduated: ${token.graduated_to_amm ? 'Yes' : 'No'}`);
        console.log(`    Created: ${new Date(token.created_at).toLocaleString()}\n`);
      });
    }
    
    // Check recent trades
    const tradesResult = await db.query(`
      SELECT COUNT(*) as count FROM bonding_curve_trades
    `);
    console.log(`📈 Bonding Curve Trades: ${tradesResult.rows[0].count}`);
    
    // Check recent swaps
    const swapsResult = await db.query(`
      SELECT COUNT(*) as count FROM amm_swaps
    `);
    console.log(`🔄 AMM Swaps: ${swapsResult.rows[0].count}`);
    
    // Check states
    const statesResult = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM bonding_curve_states) as bc_states,
        (SELECT COUNT(*) FROM amm_pool_states) as amm_states
    `);
    console.log(`📊 Bonding Curve States: ${statesResult.rows[0].bc_states}`);
    console.log(`🏊 AMM Pool States: ${statesResult.rows[0].amm_states}`);
    
    // Check processing queue
    const queueResult = await db.query(`
      SELECT 
        event_type,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE processed = false) as unprocessed
      FROM processing_queue
      GROUP BY event_type
    `);
    
    console.log('\n📬 Processing Queue:');
    if (queueResult.rows.length === 0) {
      console.log('  Queue is empty');
    } else {
      queueResult.rows.forEach((row: any) => {
        console.log(`  ${row.event_type}: ${row.count} total (${row.unprocessed} unprocessed)`);
      });
    }
    
    // Check recent high-value tokens
    const recentHighValue = await db.query(`
      SELECT 
        t.symbol,
        t.mint_address,
        MAX(s.market_cap_usd) as peak_market_cap
      FROM tokens_comprehensive t
      LEFT JOIN bonding_curve_states s ON t.id = s.token_id
      GROUP BY t.id, t.symbol, t.mint_address
      ORDER BY peak_market_cap DESC
      LIMIT 5
    `);
    
    if (recentHighValue.rows.length > 0) {
      console.log('\n🏆 Top Tokens by Peak Market Cap:');
      recentHighValue.rows.forEach((row: any, idx: number) => {
        console.log(`  ${idx + 1}. ${row.symbol || 'Unknown'}: $${parseFloat(row.peak_market_cap || '0').toLocaleString()}`);
      });
    }
    
  } catch (error) {
    console.error('Error viewing data:', error);
  } finally {
    await db.close();
  }
}

viewData().catch(console.error);