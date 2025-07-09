#!/usr/bin/env tsx

/**
 * Script to analyze data collected after 5 minutes of system runtime
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { logger } from '../core/logger';

interface TableStats {
  table: string;
  count: number;
  details?: any;
}

async function analyze5MinData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n📊 Database Analysis - 5 Minute Runtime Report\n');
    console.log('=' .repeat(60));

    // 1. Basic table counts
    console.log('\n1️⃣ TABLE RECORD COUNTS:\n');
    
    const tables = [
      'tokens_unified',
      'trades_unified',
      'bonding_curve_mappings',
      'amm_pool_states',
      'liquidity_events',
      'amm_fee_events',
      'graduation_events',
      'holder_snapshots',
      'holder_analysis_metadata',
      'wallet_classifications',
      'sol_prices',
      'monitoring_metrics'
    ];

    const stats: TableStats[] = [];
    
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        const count = parseInt(result.rows[0].count);
        stats.push({ table, count });
        console.log(`  ${table.padEnd(30)} ${count.toString().padStart(8)} records`);
      } catch (error) {
        console.log(`  ${table.padEnd(30)} ERROR: Table might not exist`);
      }
    }

    // 2. Token Analysis
    console.log('\n2️⃣ TOKEN ANALYSIS:\n');
    
    // Token types
    const tokenTypes = await pool.query(`
      SELECT 
        graduated_to_amm,
        COUNT(*) as count,
        AVG(latest_market_cap_usd) as avg_market_cap,
        MAX(latest_market_cap_usd) as max_market_cap
      FROM tokens_unified
      GROUP BY graduated_to_amm
    `);
    
    console.log('  Token Types:');
    for (const row of tokenTypes.rows) {
      const type = row.graduated_to_amm ? 'Graduated (AMM)' : 'Bonding Curve';
      console.log(`    ${type}: ${row.count} tokens`);
      console.log(`      Avg Market Cap: $${parseFloat(row.avg_market_cap || 0).toLocaleString()}`);
      console.log(`      Max Market Cap: $${parseFloat(row.max_market_cap || 0).toLocaleString()}`);
    }

    // Token creation timeline
    const timeline = await pool.query(`
      SELECT 
        DATE_TRUNC('minute', created_at) as minute,
        COUNT(*) as tokens_created
      FROM tokens_unified
      WHERE created_at > NOW() - INTERVAL '10 minutes'
      GROUP BY minute
      ORDER BY minute DESC
      LIMIT 5
    `);
    
    console.log('\n  Tokens Created (by minute):');
    for (const row of timeline.rows) {
      const time = new Date(row.minute).toLocaleTimeString();
      console.log(`    ${time}: ${row.tokens_created} tokens`);
    }

    // 3. Trade Analysis
    console.log('\n3️⃣ TRADE ANALYSIS:\n');
    
    const tradeStats = await pool.query(`
      SELECT 
        type,
        trade_type,
        COUNT(*) as count,
        AVG(sol_amount) as avg_sol_amount,
        SUM(sol_amount) as total_volume
      FROM trades_unified
      GROUP BY type, trade_type
      ORDER BY count DESC
    `);
    
    console.log('  Trade Distribution:');
    let totalTrades = 0;
    for (const row of tradeStats.rows) {
      totalTrades += parseInt(row.count);
      const avgSol = parseFloat(row.avg_sol_amount || 0).toFixed(4);
      const volume = parseFloat(row.total_volume || 0).toFixed(2);
      console.log(`    ${row.type} ${row.trade_type}: ${row.count} trades`);
      console.log(`      Avg: ${avgSol} SOL, Total Volume: ${volume} SOL`);
    }
    console.log(`\n  Total Trades: ${totalTrades}`);

    // Trades per minute
    const tradeRate = await pool.query(`
      SELECT 
        DATE_TRUNC('minute', timestamp) as minute,
        COUNT(*) as trades,
        COUNT(DISTINCT user_address) as unique_traders
      FROM trades_unified
      WHERE timestamp > NOW() - INTERVAL '5 minutes'
      GROUP BY minute
      ORDER BY minute DESC
      LIMIT 5
    `);
    
    console.log('\n  Trades Per Minute:');
    for (const row of tradeRate.rows) {
      const time = new Date(row.minute).toLocaleTimeString();
      console.log(`    ${time}: ${row.trades} trades (${row.unique_traders} unique traders)`);
    }

    // 4. Bonding Curve Progress
    console.log('\n4️⃣ BONDING CURVE PROGRESS:\n');
    
    const bcProgress = await pool.query(`
      SELECT 
        CASE 
          WHEN bonding_curve_complete THEN 'Graduated'
          WHEN latest_bonding_curve_progress >= 90 THEN '90-100%'
          WHEN latest_bonding_curve_progress >= 50 THEN '50-90%'
          WHEN latest_bonding_curve_progress >= 10 THEN '10-50%'
          ELSE '0-10%'
        END as progress_range,
        COUNT(*) as count
      FROM tokens_unified
      WHERE graduated_to_amm = false OR bonding_curve_complete = true
      GROUP BY progress_range
      ORDER BY 
        CASE progress_range
          WHEN 'Graduated' THEN 0
          WHEN '90-100%' THEN 1
          WHEN '50-90%' THEN 2
          WHEN '10-50%' THEN 3
          ELSE 4
        END
    `);
    
    for (const row of bcProgress.rows) {
      console.log(`  ${row.progress_range}: ${row.count} tokens`);
    }

    // 5. Holder Analysis
    console.log('\n5️⃣ HOLDER ANALYSIS:\n');
    
    const holderStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT mint_address) as analyzed_tokens,
        AVG(holder_score) as avg_score,
        MIN(holder_score) as min_score,
        MAX(holder_score) as max_score
      FROM holder_snapshots
    `);
    
    if (holderStats.rows[0].analyzed_tokens > 0) {
      const stats = holderStats.rows[0];
      console.log(`  Analyzed Tokens: ${stats.analyzed_tokens}`);
      console.log(`  Score Range: ${stats.min_score} - ${stats.max_score}`);
      console.log(`  Average Score: ${parseFloat(stats.avg_score).toFixed(1)}`);
      
      // Score distribution
      const scoreDistribution = await pool.query(`
        SELECT 
          CASE 
            WHEN holder_score >= 250 THEN 'Excellent (250+)'
            WHEN holder_score >= 200 THEN 'Good (200-249)'
            WHEN holder_score >= 150 THEN 'Fair (150-199)'
            WHEN holder_score >= 100 THEN 'Poor (100-149)'
            ELSE 'Critical (<100)'
          END as rating,
          COUNT(DISTINCT mint_address) as count
        FROM holder_snapshots
        GROUP BY rating
        ORDER BY 
          CASE rating
            WHEN 'Excellent (250+)' THEN 0
            WHEN 'Good (200-249)' THEN 1
            WHEN 'Fair (150-199)' THEN 2
            WHEN 'Poor (100-149)' THEN 3
            ELSE 4
          END
      `);
      
      console.log('\n  Score Distribution:');
      for (const row of scoreDistribution.rows) {
        console.log(`    ${row.rating}: ${row.count} tokens`);
      }
    } else {
      console.log('  No tokens analyzed yet (threshold: $18,888)');
    }

    // 6. System Performance
    console.log('\n6️⃣ SYSTEM PERFORMANCE:\n');
    
    // Message rate
    const messageRate = totalTrades / 5; // trades per minute
    console.log(`  Average Message Rate: ${messageRate.toFixed(1)} trades/minute`);
    console.log(`  Estimated TPS: ${(messageRate / 60).toFixed(2)} trades/second`);
    
    // SOL price updates
    const solPrices = await pool.query(`
      SELECT COUNT(*) as updates, MIN(price) as min_price, MAX(price) as max_price
      FROM sol_prices
      WHERE timestamp > NOW() - INTERVAL '5 minutes'
    `);
    
    if (solPrices.rows[0].updates > 0) {
      console.log(`\n  SOL Price Updates: ${solPrices.rows[0].updates}`);
      console.log(`  Price Range: $${solPrices.rows[0].min_price} - $${solPrices.rows[0].max_price}`);
    }

    // 7. Graduated Tokens
    console.log('\n7️⃣ GRADUATED TOKENS:\n');
    
    const graduated = await pool.query(`
      SELECT 
        symbol, 
        name,
        latest_market_cap_usd,
        graduation_timestamp
      FROM tokens_unified
      WHERE graduated_to_amm = true
      ORDER BY graduation_timestamp DESC
      LIMIT 5
    `);
    
    if (graduated.rows.length > 0) {
      console.log('  Recently Graduated:');
      for (const token of graduated.rows) {
        const time = token.graduation_timestamp ? 
          new Date(token.graduation_timestamp).toLocaleTimeString() : 'Unknown';
        console.log(`    ${token.symbol} (${token.name})`);
        console.log(`      Market Cap: $${parseFloat(token.latest_market_cap_usd).toLocaleString()}`);
        console.log(`      Graduated at: ${time}`);
      }
    } else {
      console.log('  No graduations detected yet');
    }

    // 8. Summary
    console.log('\n📈 SUMMARY:\n');
    console.log(`  Total Tokens: ${stats.find(s => s.table === 'tokens_unified')?.count || 0}`);
    console.log(`  Total Trades: ${totalTrades}`);
    console.log(`  Avg New Tokens/min: ${((stats.find(s => s.table === 'tokens_unified')?.count || 0) / 5).toFixed(1)}`);
    console.log(`  Avg Trades/min: ${(totalTrades / 5).toFixed(1)}`);
    
    // Data collection rate
    const dataPoints = stats.reduce((sum, stat) => sum + stat.count, 0);
    console.log(`  Total Data Points: ${dataPoints.toLocaleString()}`);
    console.log(`  Data Collection Rate: ${(dataPoints / 5).toFixed(0)} records/minute`);

  } catch (error) {
    logger.error('Analysis failed:', error);
    console.error('\n❌ Analysis failed:', error);
  } finally {
    await pool.end();
  }
}

// Add completion to todo
async function markAnalysisComplete() {
  console.log('\n✅ Analysis complete!');
}

// Run the analysis
analyze5MinData()
  .then(markAnalysisComplete)
  .catch(console.error);