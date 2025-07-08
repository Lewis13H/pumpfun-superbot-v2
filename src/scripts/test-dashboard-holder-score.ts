#!/usr/bin/env npx tsx
/**
 * Test Dashboard Holder Score Display
 * 
 * Tests if holder scores are showing correctly in the API
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';

async function testDashboardHolderScore() {
  console.log(chalk.cyan('\n🔍 Testing Dashboard Holder Score Display\n'));
  
  try {
    // Run the same query the dashboard API uses
    console.log(chalk.yellow('1. Running dashboard API query...'));
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        -- Get latest holder score
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score
      FROM tokens_unified t
      WHERE t.threshold_crossed_at IS NOT NULL
        AND t.latest_market_cap_usd > 10000
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 10
    `;
    
    const result = await db.query(query);
    
    console.log(chalk.gray(`   Found ${result.rows.length} tokens\n`));
    
    console.log(chalk.yellow('2. Tokens with holder scores:'));
    result.rows.forEach((token, index) => {
      const score = token.holder_score;
      const scoreDisplay = score ? chalk.green(score) : chalk.red('null');
      console.log(chalk.gray(`   ${index + 1}. ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)`));
      console.log(chalk.gray(`      Market Cap: $${parseFloat(token.latest_market_cap_usd).toLocaleString()}`));
      console.log(chalk.gray(`      Holder Score: ${scoreDisplay}`));
    });
    
    // Check specifically for MINTR
    console.log(chalk.yellow('\n3. Checking MINTR token specifically...'));
    const mintrResult = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.latest_market_cap_usd,
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score,
        (SELECT COUNT(*) 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address) as snapshot_count
      FROM tokens_unified t
      WHERE t.symbol = 'MINTR'
    `);
    
    if (mintrResult.rows.length > 0) {
      const mintr = mintrResult.rows[0];
      console.log(chalk.gray(`   Found MINTR: ${mintr.mint_address}`));
      console.log(chalk.gray(`   Market Cap: $${parseFloat(mintr.latest_market_cap_usd).toLocaleString()}`));
      console.log(chalk.gray(`   Holder Score: ${mintr.holder_score || 'null'}`));
      console.log(chalk.gray(`   Total Snapshots: ${mintr.snapshot_count}`));
    } else {
      console.log(chalk.red('   MINTR token not found'));
    }
    
    console.log(chalk.green('\n✅ Dashboard holder score query test complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
  } finally {
    await db.close();
  }
}

// Run test
testDashboardHolderScore().catch(console.error);