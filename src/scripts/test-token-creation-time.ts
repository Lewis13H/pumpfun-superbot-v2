/**
 * Test Token Creation Time Service
 * Checks enriched tokens without creation time and attempts to fetch it
 */

import chalk from 'chalk';
import { db } from '../database';
import { TokenCreationTimeService } from '../services/token-management/token-creation-time-service';

async function testTokenCreationTime() {
  console.log(chalk.blue('\n🔍 Testing Token Creation Time Service\n'));
  
  try {
    // First, check the current state of tokens
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(*) FILTER (WHERE metadata_enriched = true) as enriched_tokens,
        COUNT(*) FILTER (WHERE token_created_at IS NOT NULL) as has_creation_time,
        COUNT(*) FILTER (WHERE metadata_enriched = true AND token_created_at IS NULL) as enriched_missing_creation,
        COUNT(*) FILTER (WHERE metadata_enriched = false AND token_created_at IS NOT NULL) as not_enriched_has_creation
      FROM tokens_unified
    `);
    
    const stats = statsResult.rows[0];
    console.log(chalk.cyan('📊 Current Database Statistics:'));
    console.log(chalk.white(`   Total tokens: ${stats.total_tokens}`));
    console.log(chalk.green(`   Enriched tokens: ${stats.enriched_tokens}`));
    console.log(chalk.green(`   Has creation time: ${stats.has_creation_time}`));
    console.log(chalk.yellow(`   Enriched but missing creation time: ${stats.enriched_missing_creation}`));
    console.log(chalk.gray(`   Not enriched but has creation time: ${stats.not_enriched_has_creation}`));
    
    // Get some enriched tokens without creation time
    const missingCreationResult = await db.query(`
      SELECT mint_address, symbol, name, created_at
      FROM tokens_unified
      WHERE metadata_enriched = true 
        AND token_created_at IS NULL
      ORDER BY latest_market_cap_usd DESC NULLS LAST
      LIMIT 10
    `);
    
    if (missingCreationResult.rows.length === 0) {
      console.log(chalk.green('\n✅ All enriched tokens already have creation times!'));
      return;
    }
    
    console.log(chalk.yellow(`\n🔧 Testing creation time fetch for ${missingCreationResult.rows.length} enriched tokens missing creation time:\n`));
    
    // Initialize the service
    const creationTimeService = TokenCreationTimeService.getInstance();
    
    // Test each token
    for (const token of missingCreationResult.rows) {
      console.log(chalk.white(`\n📍 Testing ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`));
      console.log(chalk.gray(`   Name: ${token.name || 'No name'}`));
      console.log(chalk.gray(`   First seen: ${new Date(token.created_at).toLocaleString()}`));
      
      try {
        // Fetch creation time
        const creationInfo = await creationTimeService.getTokenCreationTime(token.mint_address);
        
        if (creationInfo) {
          console.log(chalk.green(`   ✅ Found creation time!`));
          console.log(chalk.gray(`      Time: ${creationInfo.creationTime.toLocaleString()}`));
          console.log(chalk.gray(`      Source: ${creationInfo.source}`));
          console.log(chalk.gray(`      Slot: ${creationInfo.creationSlot}`));
          if (creationInfo.creator) {
            console.log(chalk.gray(`      Creator: ${creationInfo.creator}`));
          }
          
          // Update the database
          await creationTimeService.updateTokenCreationTime(token.mint_address, creationInfo);
          console.log(chalk.green(`   ✅ Updated database`));
          
          // Calculate time difference
          const firstSeen = new Date(token.created_at);
          const created = creationInfo.creationTime;
          const diffMs = firstSeen.getTime() - created.getTime();
          const diffMinutes = Math.floor(diffMs / 60000);
          const diffHours = Math.floor(diffMinutes / 60);
          
          if (diffHours > 0) {
            console.log(chalk.blue(`   ⏱️  Token was created ${diffHours}h ${diffMinutes % 60}m before we discovered it`));
          } else {
            console.log(chalk.blue(`   ⏱️  Token was created ${diffMinutes}m before we discovered it`));
          }
        } else {
          console.log(chalk.red(`   ❌ Could not find creation time`));
        }
        
      } catch (error) {
        console.log(chalk.red(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Re-check statistics
    console.log(chalk.cyan('\n📊 Updated Database Statistics:'));
    const updatedStatsResult = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE metadata_enriched = true) as enriched_tokens,
        COUNT(*) FILTER (WHERE token_created_at IS NOT NULL) as has_creation_time,
        COUNT(*) FILTER (WHERE metadata_enriched = true AND token_created_at IS NULL) as enriched_missing_creation
      FROM tokens_unified
    `);
    
    const updatedStats = updatedStatsResult.rows[0];
    console.log(chalk.white(`   Enriched tokens: ${updatedStats.enriched_tokens}`));
    console.log(chalk.green(`   Has creation time: ${updatedStats.has_creation_time} (was ${stats.has_creation_time})`));
    console.log(chalk.yellow(`   Enriched but missing creation time: ${updatedStats.enriched_missing_creation} (was ${stats.enriched_missing_creation})`));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.end();
  }
}

// Run the test
testTokenCreationTime().catch(console.error);