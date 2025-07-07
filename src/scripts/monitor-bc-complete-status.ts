#!/usr/bin/env node

/**
 * Monitor script to watch for bonding curve complete flag detection
 * This script monitors the database for tokens that have been marked as complete
 */

import { Pool } from 'pg';
import { configService } from '../core/config';

async function monitorBondingCurveComplete() {
  console.log('🔍 Monitoring Bonding Curve Complete Status...\n');
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  let lastCheckTime = new Date();
  let knownCompleteTokens = new Set<string>();
  
  const checkForUpdates = async () => {
    try {
      // Check for tokens with bonding_curve_complete = true
      const completeResult = await pool.query(`
        SELECT 
          mint_address,
          symbol,
          latest_bonding_curve_progress,
          bonding_curve_complete,
          graduated_to_amm,
          bonding_curve_key,
          updated_at
        FROM tokens_unified
        WHERE bonding_curve_complete = true
        ORDER BY updated_at DESC
      `);
      
      // Check for newly complete tokens
      completeResult.rows.forEach(token => {
        if (!knownCompleteTokens.has(token.mint_address)) {
          console.log(`\n🎯 NEW COMPLETE TOKEN DETECTED!`);
          console.log(`Symbol: ${token.symbol || 'Unknown'}`);
          console.log(`Mint: ${token.mint_address}`);
          console.log(`Progress: ${token.latest_bonding_curve_progress}%`);
          console.log(`Complete: ${token.bonding_curve_complete}`);
          console.log(`Graduated: ${token.graduated_to_amm}`);
          console.log(`BC Key: ${token.bonding_curve_key}`);
          console.log(`Updated: ${token.updated_at}`);
          console.log('─'.repeat(50));
          
          knownCompleteTokens.add(token.mint_address);
        }
      });
      
      // Show summary of recent updates
      const recentResult = await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE bonding_curve_complete = true) as complete_count,
          COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 100) as at_100_count,
          COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 90 AND latest_bonding_curve_progress < 100) as near_graduation_count,
          COUNT(*) FILTER (WHERE updated_at > $1) as recent_updates
        FROM tokens_unified
        WHERE latest_bonding_curve_progress IS NOT NULL
      `, [lastCheckTime]);
      
      const stats = recentResult.rows[0];
      
      console.log('\n📊 Current Status:');
      console.log(`  Complete tokens: ${stats.complete_count}`);
      console.log(`  At 100% progress: ${stats.at_100_count}`);
      console.log(`  Near graduation (90-99%): ${stats.near_graduation_count}`);
      console.log(`  Updates since last check: ${stats.recent_updates}`);
      
      lastCheckTime = new Date();
      
    } catch (error) {
      console.error('Error checking database:', error);
    }
  };
  
  // Initial check
  await checkForUpdates();
  
  // Check every 5 seconds
  const interval = setInterval(checkForUpdates, 5000);
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down monitor...');
    clearInterval(interval);
    await pool.end();
    process.exit(0);
  });
  
  console.log('\n🔄 Monitoring every 5 seconds... (Press Ctrl+C to stop)\n');
}

// Run monitor
monitorBondingCurveComplete().catch(console.error);