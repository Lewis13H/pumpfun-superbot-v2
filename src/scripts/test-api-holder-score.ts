#!/usr/bin/env npx tsx
/**
 * Test API Holder Score Issue
 * 
 * Debug why holder_score is null in API responses
 */

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';

async function testAPIHolderScore() {
  console.log(chalk.cyan('\n🔍 Testing API Holder Score Issue\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    // Step 1: Run the exact realtime API query
    console.log(chalk.yellow('1. Running exact /api/tokens/realtime query...'));
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.image_uri,
        t.creator,
        t.first_seen_at,
        t.token_created_at,
        t.first_program,
        t.current_program,
        t.graduated_to_amm,
        t.threshold_crossed_at,
        t.latest_price_sol,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        t.latest_virtual_sol_reserves,
        t.latest_virtual_token_reserves,
        t.latest_bonding_curve_progress,
        t.bonding_curve_complete,
        t.volume_24h_usd,
        t.holder_count,
        t.top_holder_percentage,
        t.total_trades,
        t.unique_traders_24h,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(t.token_created_at, t.first_seen_at))) as age_seconds,
        (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) as sol_price,
        -- Get latest holder score
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score
      FROM tokens_unified t
      WHERE t.threshold_crossed_at IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC NULLS LAST
    `;
    
    const result = await pool.query(query);
    
    // Find MINTR
    const mintr = result.rows.find(row => row.symbol === 'MINTR');
    if (mintr) {
      console.log(chalk.green('   Found MINTR in query result'));
      console.log(chalk.gray(`   holder_score: ${mintr.holder_score}`));
      console.log(chalk.gray(`   holder_score type: ${typeof mintr.holder_score}`));
      console.log(chalk.gray(`   holder_score === null: ${mintr.holder_score === null}`));
      console.log(chalk.gray(`   holder_score === undefined: ${mintr.holder_score === undefined}`));
      
      // Check all properties
      console.log(chalk.gray(`   Total properties: ${Object.keys(mintr).length}`));
      
      // Check if any property is missing
      const expectedProps = [
        'mint_address', 'symbol', 'name', 'image_uri', 'creator',
        'first_seen_at', 'token_created_at', 'first_program', 'current_program',
        'graduated_to_amm', 'threshold_crossed_at', 'latest_price_sol',
        'latest_price_usd', 'latest_market_cap_usd', 'latest_virtual_sol_reserves',
        'latest_virtual_token_reserves', 'latest_bonding_curve_progress',
        'bonding_curve_complete', 'volume_24h_usd', 'holder_count',
        'top_holder_percentage', 'total_trades', 'unique_traders_24h',
        'age_seconds', 'sol_price', 'holder_score'
      ];
      
      const missingProps = expectedProps.filter(prop => !(prop in mintr));
      if (missingProps.length > 0) {
        console.log(chalk.red(`   Missing properties: ${missingProps.join(', ')}`));
      }
    } else {
      console.log(chalk.red('   MINTR not found in results'));
    }
    
    // Step 2: Check total tokens with holder scores
    console.log(chalk.yellow('\n2. Checking tokens with holder scores...'));
    const tokensWithScores = result.rows.filter(t => t.holder_score !== null && t.holder_score !== undefined);
    console.log(chalk.gray(`   Total tokens: ${result.rows.length}`));
    console.log(chalk.gray(`   Tokens with holder scores: ${tokensWithScores.length}`));
    
    if (tokensWithScores.length > 0) {
      console.log(chalk.gray('\n   Examples of tokens with scores:'));
      tokensWithScores.slice(0, 5).forEach(t => {
        console.log(chalk.gray(`     ${t.symbol}: ${t.holder_score}`));
      });
    }
    
    // Step 3: Test simulated mapping like the API does
    console.log(chalk.yellow('\n3. Testing object spread behavior...'));
    if (mintr) {
      const testObj = { ...mintr };
      console.log(chalk.gray(`   Original holder_score: ${mintr.holder_score}`));
      console.log(chalk.gray(`   Spread object holder_score: ${testObj.holder_score}`));
      console.log(chalk.gray(`   Are they equal: ${mintr.holder_score === testObj.holder_score}`));
      
      // Test with modification
      const testObj2 = {
        ...mintr,
        latest_price_sol: 999,
        realtime_updated: true
      };
      console.log(chalk.gray(`   Modified object holder_score: ${testObj2.holder_score}`));
    }
    
    console.log(chalk.green('\n✅ Test complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
  } finally {
    await pool.end();
  }
}

// Run test
testAPIHolderScore().catch(console.error);