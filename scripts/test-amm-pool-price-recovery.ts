#!/usr/bin/env tsx
/**
 * Test AMM Pool Price Recovery
 * Verifies that price recovery from pool states works correctly
 */

import 'dotenv/config';
import { db } from '../src/database';
import { AmmPoolPriceRecovery } from '../src/services/amm-pool-price-recovery';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🧪 Testing AMM Pool Price Recovery'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get some graduated tokens that might need price recovery
  const graduatedTokens = await db.query(`
    SELECT t.mint_address, t.symbol, t.name, t.latest_market_cap_usd, t.created_at
    FROM tokens_unified t
    WHERE t.graduated_to_amm = true
      AND t.latest_market_cap_usd < 100000  -- Focus on smaller tokens more likely to be stale
    ORDER BY t.created_at DESC
    LIMIT 10
  `);
  
  console.log(chalk.yellow(`Found ${graduatedTokens.rows.length} graduated tokens to test\n`));
  
  // Check which ones have pool states
  const tokenMints = graduatedTokens.rows.map(r => r.mint_address);
  
  const poolStates = await db.query(`
    SELECT DISTINCT ON (mint_address)
      mint_address,
      pool_address,
      virtual_sol_reserves,
      virtual_token_reserves,
      created_at
    FROM amm_pool_states
    WHERE mint_address = ANY($1)
    ORDER BY mint_address, created_at DESC
  `, [tokenMints]);
  
  console.log(chalk.green(`Found pool states for ${poolStates.rows.length} tokens\n`));
  
  // Display what we found
  for (const token of graduatedTokens.rows) {
    const poolState = poolStates.rows.find(p => p.mint_address === token.mint_address);
    
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.white('Token:'), `${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
    console.log(chalk.white('Current Market Cap:'), chalk.yellow(`$${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`));
    
    if (poolState) {
      console.log(chalk.green('✓ Has pool state'));
      console.log(chalk.gray(`  Pool: ${poolState.pool_address.slice(0, 8)}...`));
      console.log(chalk.gray(`  SOL Reserves: ${(parseInt(poolState.virtual_sol_reserves) / 1e9).toFixed(4)}`));
      console.log(chalk.gray(`  Token Reserves: ${(parseInt(poolState.virtual_token_reserves) / 1e6).toLocaleString()}`));
      console.log(chalk.gray(`  Last Update: ${poolState.created_at}`));
    } else {
      console.log(chalk.red('✗ No pool state found'));
    }
  }
  
  // Now test the recovery service
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('\nTesting Price Recovery Service...'));
  
  const recoveryService = AmmPoolPriceRecovery.getInstance();
  const mintsToRecover = poolStates.rows.map(r => r.mint_address);
  
  if (mintsToRecover.length > 0) {
    const result = await recoveryService.recoverPricesFromPoolStates(mintsToRecover);
    
    console.log(chalk.gray('\n' + '─'.repeat(80)));
    console.log(chalk.cyan('Recovery Results:'));
    console.log(chalk.green(`✓ Successful: ${result.successful.length}`));
    console.log(chalk.red(`✗ Failed: ${result.failed.length}`));
    
    // Show successful recoveries
    if (result.successful.length > 0) {
      console.log(chalk.gray('\n' + 'Successful Recoveries:'));
      for (const recovery of result.successful) {
        const token = graduatedTokens.rows.find(t => t.mint_address === recovery.mintAddress);
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.white('Token:'), `${token?.symbol || 'Unknown'} (${recovery.mintAddress.slice(0, 8)}...)`);
        console.log(chalk.white('New Price:'), chalk.green(`$${recovery.priceInUsd.toFixed(8)}`));
        console.log(chalk.white('New Market Cap:'), chalk.green(`$${recovery.marketCapUsd.toLocaleString()}`));
        console.log(chalk.white('Source:'), recovery.source);
      }
    }
    
    // Show failures
    if (result.failed.length > 0) {
      console.log(chalk.gray('\n' + 'Failed Recoveries:'));
      for (const failure of result.failed) {
        console.log(chalk.red(`✗ ${failure.mintAddress.slice(0, 8)}...: ${failure.reason}`));
      }
    }
  } else {
    console.log(chalk.yellow('\nNo tokens with pool states to recover'));
  }
  
  await db.close();
}

main().catch(console.error);