#!/usr/bin/env tsx
/**
 * Verify Pool States
 * Check which tokens have pool states and test recovery
 */

import 'dotenv/config';
import { db } from '../src/database';
import { AmmPoolPriceRecovery } from '../src/services/amm-pool-price-recovery';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🔍 Verifying Pool States'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get tokens that have pool states
  const poolStates = await db.query(`
    SELECT DISTINCT ON (ps.mint_address)
      ps.mint_address,
      ps.pool_address,
      ps.virtual_sol_reserves,
      ps.virtual_token_reserves,
      ps.created_at,
      t.symbol,
      t.name,
      t.graduated_to_amm,
      t.latest_market_cap_usd
    FROM amm_pool_states ps
    LEFT JOIN tokens_unified t ON t.mint_address = ps.mint_address
    WHERE ps.virtual_sol_reserves > 0 
      AND ps.virtual_token_reserves > 0
    ORDER BY ps.mint_address, ps.created_at DESC
    LIMIT 10
  `);
  
  console.log(chalk.yellow(`Found ${poolStates.rows.length} tokens with valid pool states\n`));
  
  // Display pool states
  for (const row of poolStates.rows) {
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.white('Mint:'), row.mint_address);
    console.log(chalk.white('Token:'), `${row.symbol || 'Unknown'} - ${row.name || 'No name'}`);
    console.log(chalk.white('Pool:'), row.pool_address);
    console.log(chalk.white('Graduated:'), row.graduated_to_amm ? chalk.green('Yes') : chalk.red('No'));
    console.log(chalk.white('Current Market Cap:'), chalk.yellow(`$${parseFloat(row.latest_market_cap_usd || 0).toLocaleString()}`));
    console.log(chalk.white('SOL Reserves:'), (parseInt(row.virtual_sol_reserves) / 1e9).toFixed(4));
    console.log(chalk.white('Token Reserves:'), (parseInt(row.virtual_token_reserves) / 1e6).toLocaleString());
    console.log(chalk.white('Last Update:'), row.created_at);
  }
  
  // Test recovery on these tokens
  if (poolStates.rows.length > 0) {
    console.log(chalk.gray('\n' + '─'.repeat(80)));
    console.log(chalk.cyan('\nTesting Price Recovery...'));
    
    const recoveryService = AmmPoolPriceRecovery.getInstance();
    const mintsToRecover = poolStates.rows.map(r => r.mint_address);
    
    const result = await recoveryService.recoverPricesFromPoolStates(mintsToRecover);
    
    console.log(chalk.gray('\n' + '─'.repeat(80)));
    console.log(chalk.cyan('Recovery Results:'));
    console.log(chalk.green(`✓ Successful: ${result.successful.length}`));
    console.log(chalk.red(`✗ Failed: ${result.failed.length}`));
    
    // Show price changes
    if (result.successful.length > 0) {
      console.log(chalk.gray('\n' + 'Price Updates:'));
      for (const recovery of result.successful) {
        const original = poolStates.rows.find(r => r.mint_address === recovery.mintAddress);
        const oldMarketCap = parseFloat(original?.latest_market_cap_usd || 0);
        const newMarketCap = recovery.marketCapUsd;
        const change = oldMarketCap > 0 ? ((newMarketCap - oldMarketCap) / oldMarketCap * 100) : 0;
        
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.white('Token:'), `${original?.symbol || 'Unknown'} (${recovery.mintAddress.slice(0, 8)}...)`);
        console.log(chalk.white('Old Market Cap:'), chalk.yellow(`$${oldMarketCap.toLocaleString()}`));
        console.log(chalk.white('New Market Cap:'), chalk.green(`$${newMarketCap.toLocaleString()}`));
        console.log(chalk.white('Change:'), change > 0 ? chalk.green(`+${change.toFixed(2)}%`) : chalk.red(`${change.toFixed(2)}%`));
      }
    }
  }
  
  // Check how many graduated tokens have no pool states
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('\nGraduated Tokens Without Pool States:'));
  
  const missingStates = await db.query(`
    SELECT COUNT(*) as count
    FROM tokens_unified t
    WHERE t.graduated_to_amm = true
      AND NOT EXISTS (
        SELECT 1 FROM amm_pool_states ps 
        WHERE ps.mint_address = t.mint_address
      )
  `);
  
  console.log(chalk.yellow(`${missingStates.rows[0].count} graduated tokens have no pool states recorded`));
  
  await db.close();
}

main().catch(console.error);