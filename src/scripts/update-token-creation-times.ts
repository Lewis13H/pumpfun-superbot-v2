#!/usr/bin/env tsx
/**
 * Update token creation times for all tokens
 * Fetches actual blockchain creation time for tokens
 */

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';
import { TokenCreationTimeService } from '../services/token-creation-time-service';

async function updateTokenCreationTimes() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const creationTimeService = TokenCreationTimeService.getInstance();

  try {
    console.log(chalk.cyan('📅 Updating token creation times...'));
    
    // Get tokens that need creation time updates (where token_created_at is null)
    const query = `
      SELECT mint_address, symbol, name, latest_market_cap_usd
      FROM tokens_unified
      WHERE token_created_at IS NULL
      AND threshold_crossed_at IS NOT NULL
      ORDER BY latest_market_cap_usd DESC NULLS LAST
      LIMIT 100
    `;
    
    const result = await pool.query(query);
    const tokens = result.rows;
    
    console.log(chalk.yellow(`Found ${tokens.length} tokens without creation times`));
    
    let updated = 0;
    let failed = 0;
    
    for (const token of tokens) {
      try {
        console.log(chalk.gray(`\nChecking ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)...`));
        
        const creationInfo = await creationTimeService.getTokenCreationTime(token.mint_address);
        
        if (creationInfo) {
          await creationTimeService.updateTokenCreationTime(token.mint_address, creationInfo);
          
          const age = Math.floor((Date.now() - creationInfo.creationTime.getTime()) / 1000 / 60 / 60); // hours
          console.log(chalk.green(`✅ Updated: ${creationInfo.creationTime.toLocaleString()} (${age}h old, source: ${creationInfo.source})`));
          updated++;
        } else {
          console.log(chalk.yellow('⚠️  No creation time found'));
          failed++;
        }
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        failed++;
      }
    }
    
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(chalk.green(`✅ Updated: ${updated} tokens`));
    console.log(chalk.yellow(`⚠️  Failed: ${failed} tokens`));
    
    // Show some examples of updated tokens
    const examplesQuery = `
      SELECT mint_address, symbol, name, token_created_at, first_seen_at,
        EXTRACT(EPOCH FROM (first_seen_at - token_created_at)) / 3600 as discovery_delay_hours
      FROM tokens_unified
      WHERE token_created_at IS NOT NULL
      AND threshold_crossed_at IS NOT NULL
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `;
    
    const examples = await pool.query(examplesQuery);
    
    if (examples.rows.length > 0) {
      console.log(chalk.cyan('\n📋 Example tokens with creation times:'));
      for (const token of examples.rows) {
        const createdAt = new Date(token.token_created_at);
        const firstSeen = new Date(token.first_seen_at);
        const delayHours = Math.floor(token.discovery_delay_hours || 0);
        
        console.log(chalk.white(`\n${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`));
        console.log(chalk.gray(`  Created: ${createdAt.toLocaleString()}`));
        console.log(chalk.gray(`  First seen: ${firstSeen.toLocaleString()}`));
        if (delayHours > 0) {
          console.log(chalk.yellow(`  Discovery delay: ${delayHours} hours`));
        }
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
  } finally {
    await pool.end();
  }
}

// Run the script
updateTokenCreationTimes().catch(console.error);