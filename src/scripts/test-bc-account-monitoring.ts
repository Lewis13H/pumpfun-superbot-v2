#!/usr/bin/env node

/**
 * Test script to verify bonding curve account monitoring is working
 * This will show real-time account updates and progress calculations
 */

import { Container, TOKENS } from '../core/container';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';

// Track account updates
const accountUpdates = new Map<string, any>();
let updateCount = 0;

async function testBondingCurveAccountMonitoring() {
  console.log(chalk.cyan('🔍 Testing Bonding Curve Account Monitoring\n'));
  
  const container = new Container();
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    // Container doesn't need initialization
    
    // Get event bus to listen for events
    const eventBus = container.resolve(TOKENS.EventBus);
    
    // Listen for bonding curve events
    eventBus.on('BONDING_CURVE_PROGRESS_UPDATE', (data: any) => {
      updateCount++;
      const key = data.bondingCurveAddress || 'unknown';
      accountUpdates.set(key, data);
      
      console.log(chalk.green(`\n📊 Bonding Curve Progress Update #${updateCount}`));
      console.log(`  BC Address: ${data.bondingCurveAddress}`);
      console.log(`  Mint: ${data.mintAddress || 'unknown'}`);
      console.log(`  Progress: ${data.progress?.toFixed(2)}%`);
      console.log(`  Complete: ${data.complete}`);
      console.log(`  SOL in curve: ${data.solInCurve?.toFixed(4)} SOL`);
      console.log(`  Lamports: ${data.lamports?.toLocaleString()}`);
      console.log('─'.repeat(50));
    });
    
    eventBus.on('TOKEN_GRADUATED', (data: any) => {
      console.log(chalk.yellow('\n🎓 TOKEN GRADUATED!'));
      console.log(`  Mint: ${data.mintAddress}`);
      console.log(`  BC Address: ${data.bondingCurveAddress}`);
      console.log(`  Final SOL: ${data.solInCurve?.toFixed(2)}`);
      console.log(`  Complete: ${data.complete}`);
      console.log('─'.repeat(50));
    });
    
    // Create and start the monitor
    const monitor = new TokenLifecycleMonitor(container, {
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      includeFailedTxs: false
    });
    
    console.log(chalk.yellow('Starting Token Lifecycle Monitor...\n'));
    await monitor.start();
    
    // Show some tokens we're tracking
    const tokensResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        bonding_curve_key,
        latest_bonding_curve_progress
      FROM tokens_unified
      WHERE bonding_curve_key IS NOT NULL
        AND graduated_to_amm = false
        AND latest_bonding_curve_progress > 50
      ORDER BY latest_bonding_curve_progress DESC
      LIMIT 5
    `);
    
    console.log(chalk.cyan('📋 Monitoring these high-progress tokens:\n'));
    tokensResult.rows.forEach(token => {
      console.log(`  ${(token.symbol || 'Unknown').padEnd(10)} - ${token.latest_bonding_curve_progress}% - BC: ${token.bonding_curve_key.substring(0, 12)}...`);
    });
    
    // Status updates every 10 seconds
    const statusInterval = setInterval(() => {
      console.log(chalk.gray(`\n⏱️  Status: ${updateCount} account updates received`));
      
      if (accountUpdates.size > 0) {
        console.log(chalk.gray('Recent updates:'));
        const recent = Array.from(accountUpdates.values()).slice(-3);
        recent.forEach(update => {
          console.log(chalk.gray(`  ${update.bondingCurveAddress?.substring(0, 8)}... - ${update.progress?.toFixed(1)}% - Complete: ${update.complete}`));
        });
      }
    }, 10000);
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nShutting down...'));
      clearInterval(statusInterval);
      await monitor.stop();
      await pool.end();
      
      console.log(chalk.cyan('\n📊 Final Summary:'));
      console.log(`  Total account updates: ${updateCount}`);
      console.log(`  Unique bonding curves: ${accountUpdates.size}`);
      
      process.exit(0);
    });
    
    console.log(chalk.green('\n✅ Monitor started. Watching for bonding curve account updates...'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    await pool.end();
    process.exit(1);
  }
}

// Run test
testBondingCurveAccountMonitoring().catch(console.error);