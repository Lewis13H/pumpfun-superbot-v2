#!/usr/bin/env npx tsx
/**
 * Debug MINTR Holder Score
 * 
 * Debug why MINTR shows 0 instead of 165
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';

async function debugMintrScore() {
  console.log(chalk.cyan('\n🔍 Debugging MINTR Holder Score\n'));
  
  try {
    // 1. Check MINTR in tokens_unified
    console.log(chalk.yellow('1. Checking MINTR in tokens_unified...'));
    const tokenResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        threshold_crossed_at
      FROM tokens_unified
      WHERE symbol = 'MINTR'
    `);
    
    if (tokenResult.rows.length === 0) {
      console.log(chalk.red('   MINTR not found in tokens_unified!'));
      return;
    }
    
    const mintr = tokenResult.rows[0];
    console.log(chalk.gray(`   Mint Address: ${mintr.mint_address}`));
    console.log(chalk.gray(`   Symbol: ${mintr.symbol}`));
    console.log(chalk.gray(`   Name: ${mintr.name}`));
    console.log(chalk.gray(`   Market Cap: $${parseFloat(mintr.latest_market_cap_usd).toLocaleString()}`));
    console.log(chalk.gray(`   Threshold Crossed: ${mintr.threshold_crossed_at ? 'Yes' : 'No'}`));
    
    // 2. Check holder_snapshots
    console.log(chalk.yellow('\n2. Checking holder_snapshots for MINTR...'));
    const snapshotResult = await db.query(`
      SELECT 
        mint_address,
        holder_score,
        snapshot_time,
        total_holders
      FROM holder_snapshots
      WHERE mint_address = $1
      ORDER BY snapshot_time DESC
    `, [mintr.mint_address]);
    
    console.log(chalk.gray(`   Found ${snapshotResult.rows.length} snapshots`));
    snapshotResult.rows.forEach((snapshot, index) => {
      console.log(chalk.gray(`   Snapshot ${index + 1}:`));
      console.log(chalk.gray(`     Time: ${snapshot.snapshot_time}`));
      console.log(chalk.gray(`     Score: ${snapshot.holder_score}`));
      console.log(chalk.gray(`     Holders: ${snapshot.total_holders}`));
    });
    
    // 3. Test the exact query used by the API
    console.log(chalk.yellow('\n3. Testing API query for MINTR...'));
    const apiQuery = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.latest_market_cap_usd,
        -- Get latest holder score
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score
      FROM tokens_unified t
      WHERE t.mint_address = $1
    `;
    
    const apiResult = await db.query(apiQuery, [mintr.mint_address]);
    if (apiResult.rows.length > 0) {
      const data = apiResult.rows[0];
      console.log(chalk.gray(`   Mint Address: ${data.mint_address}`));
      console.log(chalk.gray(`   Symbol: ${data.symbol}`));
      console.log(chalk.gray(`   Holder Score from subquery: ${data.holder_score}`));
    }
    
    // 4. Check if there's a case sensitivity issue
    console.log(chalk.yellow('\n4. Checking for case sensitivity issues...'));
    const caseResult = await db.query(`
      SELECT 
        hs.mint_address as snapshot_mint,
        t.mint_address as token_mint,
        hs.holder_score,
        hs.mint_address = t.mint_address as exact_match,
        LOWER(hs.mint_address) = LOWER(t.mint_address) as case_insensitive_match
      FROM holder_snapshots hs
      CROSS JOIN tokens_unified t
      WHERE t.symbol = 'MINTR'
      ORDER BY hs.snapshot_time DESC
      LIMIT 1
    `);
    
    if (caseResult.rows.length > 0) {
      const match = caseResult.rows[0];
      console.log(chalk.gray(`   Snapshot mint: ${match.snapshot_mint}`));
      console.log(chalk.gray(`   Token mint: ${match.token_mint}`));
      console.log(chalk.gray(`   Exact match: ${match.exact_match}`));
      console.log(chalk.gray(`   Case insensitive match: ${match.case_insensitive_match}`));
    }
    
    // 5. Check what the frontend receives
    console.log(chalk.yellow('\n5. Simulating frontend data...'));
    const frontendQuery = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        t.holder_score,
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as calculated_holder_score
      FROM tokens_unified t
      WHERE t.symbol = 'MINTR'
    `;
    
    const frontendResult = await db.query(frontendQuery);
    if (frontendResult.rows.length > 0) {
      const data = frontendResult.rows[0];
      console.log(chalk.gray(`   Direct holder_score column: ${data.holder_score || 'null'}`));
      console.log(chalk.gray(`   Calculated holder_score: ${data.calculated_holder_score || 'null'}`));
    }
    
    console.log(chalk.green('\n✅ Debug complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Debug failed:'), error);
  } finally {
    await db.close();
  }
}

// Run debug
debugMintrScore().catch(console.error);