#!/usr/bin/env tsx
/**
 * Test Legacy AMM Account Monitor
 * Checks if the non-refactored AMM account monitor is working
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function testLegacyAMMAccountMonitor() {
  console.log(chalk.cyan('Testing Legacy AMM Account Monitor\n'));
  
  try {
    // 1. Check current database state
    console.log('1. Checking current database state...');
    const beforeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT mint_address) as unique_mints,
        COUNT(DISTINCT pool_address) as unique_pools,
        MAX(created_at) as latest_update,
        COUNT(*) FILTER (WHERE virtual_sol_reserves > 0) as pools_with_reserves
      FROM amm_pool_states
    `);
    
    console.log('Before running monitor:');
    console.log(`  - Total rows: ${beforeStats.rows[0].total_rows}`);
    console.log(`  - Unique mints: ${beforeStats.rows[0].unique_mints}`);
    console.log(`  - Unique pools: ${beforeStats.rows[0].unique_pools}`);
    console.log(`  - Pools with reserves > 0: ${beforeStats.rows[0].pools_with_reserves}`);
    console.log(`  - Latest update: ${beforeStats.rows[0].latest_update}\n`);
    
    // 2. Check recent entries with reserves
    console.log('2. Recent entries with reserves > 0:');
    const recentWithReserves = await pool.query(`
      SELECT 
        mint_address,
        pool_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        created_at
      FROM amm_pool_states
      WHERE virtual_sol_reserves > 0
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    if (recentWithReserves.rows.length > 0) {
      for (const row of recentWithReserves.rows) {
        console.log(`  - ${row.mint_address.substring(0, 8)}... | SOL: ${Number(row.virtual_sol_reserves) / 1e9} | Tokens: ${Number(row.virtual_token_reserves) / 1e6}`);
      }
    } else {
      console.log('  No entries with reserves > 0 found');
    }
    
    // 3. Check running processes
    console.log('\n3. Checking if AMM account monitor is running...');
    const { execSync } = require('child_process');
    try {
      const processes = execSync('ps aux | grep -E "amm-account-monitor" | grep -v grep', { encoding: 'utf-8' });
      if (processes) {
        console.log(chalk.green('  ✓ AMM account monitor is running'));
        console.log(processes);
      }
    } catch (e) {
      console.log(chalk.yellow('  ⚠ AMM account monitor not detected in process list'));
    }
    
    // 4. Monitor for new entries
    console.log('\n4. Monitoring for new entries (30 seconds)...');
    const startTime = Date.now();
    let newEntries = 0;
    let entriesWithReserves = 0;
    
    const checkInterval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      const newRows = await pool.query(`
        SELECT COUNT(*) as count,
               COUNT(*) FILTER (WHERE virtual_sol_reserves > 0) as with_reserves
        FROM amm_pool_states
        WHERE created_at > $1
      `, [beforeStats.rows[0].latest_update]);
      
      if (newRows.rows[0].count > newEntries) {
        newEntries = parseInt(newRows.rows[0].count);
        entriesWithReserves = parseInt(newRows.rows[0].with_reserves);
        console.log(`  [${elapsed}s] New entries: ${newEntries} (${entriesWithReserves} with reserves)`);
      }
      
      if (elapsed >= 30) {
        clearInterval(checkInterval);
        
        // Final summary
        console.log('\n' + chalk.cyan('Test Summary:'));
        console.log('─'.repeat(50));
        console.log(`Total new entries: ${newEntries}`);
        console.log(`Entries with reserves > 0: ${entriesWithReserves}`);
        console.log(`Save rate: ${(newEntries / 30).toFixed(2)} entries/sec`);
        
        if (newEntries === 0) {
          console.log(chalk.yellow('\n⚠ No new entries detected. Possible issues:'));
          console.log('  1. AMM account monitor not running');
          console.log('  2. No AMM pool activity during test period');
          console.log('  3. Database connection issues');
          console.log('\nRun this command to start the monitor:');
          console.log(chalk.cyan('  npm run amm-account-monitor'));
        } else if (entriesWithReserves === 0) {
          console.log(chalk.yellow('\n⚠ Entries saved but all have 0 reserves. Possible issues:'));
          console.log('  1. Pool state decoding not working correctly');
          console.log('  2. Pools genuinely have 0 reserves');
          console.log('  3. Reserve data not being extracted from account data');
        } else {
          console.log(chalk.green('\n✓ AMM account monitor appears to be working correctly!'));
        }
        
        await pool.end();
        process.exit(0);
      }
    }, 1000);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    await pool.end();
    process.exit(1);
  }
}

testLegacyAMMAccountMonitor();