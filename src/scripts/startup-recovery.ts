#!/usr/bin/env tsx

/**
 * Startup Recovery Script
 * Recovers all token prices after system downtime
 */

import 'dotenv/config';
import { StaleTokenDetector } from '../services/stale-token-detector';
import { db } from '../database';
import chalk from 'chalk';

async function performStartupRecovery() {
  console.log(chalk.cyan.bold('\n🚀 Startup Recovery Script\n'));
  
  const detector = StaleTokenDetector.getInstance({
    enableStartupRecovery: true,
    startupRecoveryThresholdMinutes: 0, // Force recovery regardless of downtime
  });
  
  try {
    // Get system status
    const lastUpdate = await db.query(`
      SELECT 
        MAX(updated_at) as last_update,
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN graduated_to_amm = false THEN 1 END) as active_tokens
      FROM tokens_unified
    `);
    
    const lastUpdateTime = lastUpdate.rows[0].last_update;
    const totalTokens = parseInt(lastUpdate.rows[0].total_tokens);
    const activeTokens = parseInt(lastUpdate.rows[0].active_tokens);
    
    if (lastUpdateTime) {
      const downtimeMinutes = Math.floor((Date.now() - new Date(lastUpdateTime).getTime()) / 1000 / 60);
      console.log(chalk.yellow(`⏰ System was last updated ${downtimeMinutes} minutes ago`));
    }
    
    console.log(chalk.gray(`📊 Found ${activeTokens} active tokens (${totalTokens} total)`));
    
    // Perform recovery
    console.log(chalk.blue('\n🔄 Starting full recovery...'));
    await detector.performStartupRecovery();
    
    // Show results
    const stats = detector.getStats();
    console.log(chalk.green('\n✅ Recovery Complete!'));
    console.log(chalk.white('Statistics:'));
    console.log(chalk.gray(`  • Tokens recovered: ${stats.tokensRecovered}`));
    console.log(chalk.gray(`  • Success rate: ${(stats.recoverySuccessRate * 100).toFixed(1)}%`));
    console.log(chalk.gray(`  • GraphQL queries used: ${stats.graphqlQueriesUsed}`));
    console.log(chalk.gray(`  • Average recovery time: ${(stats.averageRecoveryTime / 1000).toFixed(1)}s`));
    
    // Check for any remaining stale tokens
    const staleCheck = await db.query(`
      SELECT COUNT(*) as stale_count
      FROM tokens_unified
      WHERE 
        graduated_to_amm = false
        AND latest_market_cap_usd > 1000
        AND updated_at < NOW() - INTERVAL '30 minutes'
    `);
    
    const staleCount = parseInt(staleCheck.rows[0].stale_count);
    if (staleCount > 0) {
      console.log(chalk.yellow(`\n⚠️ ${staleCount} tokens are still stale. Consider running again.`));
    } else {
      console.log(chalk.green('\n✨ All tokens are up to date!'));
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Recovery failed:'), error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Add command line arguments
const args = process.argv.slice(2);
const forceRecovery = args.includes('--force');

if (forceRecovery) {
  console.log(chalk.yellow('Force recovery mode enabled'));
}

// Run recovery
performStartupRecovery()
  .then(() => {
    console.log(chalk.green('\n✨ Startup recovery completed successfully!'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Fatal error:'), error);
    process.exit(1);
  });