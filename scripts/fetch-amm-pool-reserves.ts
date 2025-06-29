#!/usr/bin/env tsx
/**
 * Fetch AMM Pool Reserves
 * Fetches current reserve balances for all known AMM pools
 */

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🔄 Fetching AMM Pool Reserves'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Create connection
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Get all unique pools
  const pools = await db.query(`
    SELECT DISTINCT ON (pool_address)
      pool_address,
      mint_address
    FROM amm_pool_states
    ORDER BY pool_address, created_at DESC
  `);
  
  console.log(chalk.yellow(`Found ${pools.rows.length} unique pools to check\n`));
  
  let updated = 0;
  let failed = 0;
  
  for (const pool of pools.rows) {
    try {
      console.log(chalk.gray(`Checking pool ${pool.pool_address.slice(0, 8)}...`));
      
      // First, we need to get the pool account to find vault addresses
      const poolPubkey = new PublicKey(pool.pool_address);
      const poolAccount = await connection.getAccountInfo(poolPubkey);
      
      if (!poolAccount) {
        console.log(chalk.red(`  ✗ Pool account not found`));
        failed++;
        continue;
      }
      
      // Decode pool account to get vault addresses
      // Skip discriminator (8 bytes) and read the structure
      const data = poolAccount.data;
      
      // Pool structure offsets (after 8-byte discriminator):
      // poolBump: u8 (1 byte) at offset 8
      // index: u16 (2 bytes) at offset 9
      // creator: PublicKey (32 bytes) at offset 11
      // baseMint: PublicKey (32 bytes) at offset 43
      // quoteMint: PublicKey (32 bytes) at offset 75
      // lpMint: PublicKey (32 bytes) at offset 107
      // poolBaseTokenAccount: PublicKey (32 bytes) at offset 139
      // poolQuoteTokenAccount: PublicKey (32 bytes) at offset 171
      
      const baseVaultBytes = data.slice(139, 171);
      const quoteVaultBytes = data.slice(171, 203);
      
      const baseVault = new PublicKey(baseVaultBytes);
      const quoteVault = new PublicKey(quoteVaultBytes);
      
      console.log(chalk.gray(`  Base vault: ${baseVault.toBase58()}`));
      console.log(chalk.gray(`  Quote vault: ${quoteVault.toBase58()}`));
      
      // Fetch token account balances
      const [baseAccount, quoteAccount] = await Promise.all([
        connection.getTokenAccountBalance(baseVault),
        connection.getTokenAccountBalance(quoteVault),
      ]);
      
      const solReserves = BigInt(baseAccount.value.amount);
      const tokenReserves = BigInt(quoteAccount.value.amount);
      
      console.log(chalk.green(`  ✓ SOL reserves: ${(Number(solReserves) / 1e9).toFixed(4)} SOL`));
      console.log(chalk.green(`  ✓ Token reserves: ${(Number(tokenReserves) / 1e6).toLocaleString()} tokens`));
      
      // Update database
      await db.query(`
        INSERT INTO amm_pool_states (
          mint_address,
          pool_address,
          virtual_sol_reserves,
          virtual_token_reserves,
          pool_open,
          slot,
          created_at
        ) VALUES ($1, $2, $3, $4, true, $5, NOW())
      `, [
        pool.mint_address,
        pool.pool_address,
        solReserves.toString(),
        tokenReserves.toString(),
        await connection.getSlot(),
      ]);
      
      updated++;
      
    } catch (error) {
      console.log(chalk.red(`  ✗ Error: ${error.message}`));
      failed++;
    }
  }
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Summary:'));
  console.log(chalk.green(`✓ Updated: ${updated} pools`));
  console.log(chalk.red(`✗ Failed: ${failed} pools`));
  
  // Test price recovery with the new data
  if (updated > 0) {
    console.log(chalk.gray('\n' + '─'.repeat(80)));
    console.log(chalk.cyan('Testing price recovery with new reserve data...'));
    
    const { AmmPoolPriceRecovery } = await import('../src/services/amm-pool-price-recovery');
    const recoveryService = AmmPoolPriceRecovery.getInstance();
    
    // Get some tokens to test
    const testTokens = await db.query(`
      SELECT DISTINCT mint_address
      FROM amm_pool_states
      WHERE virtual_sol_reserves > 0 AND virtual_token_reserves > 0
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    if (testTokens.rows.length > 0) {
      const mints = testTokens.rows.map(r => r.mint_address);
      const result = await recoveryService.recoverPricesFromPoolStates(mints);
      
      console.log(chalk.green(`\n✓ Price recovery successful: ${result.successful.length} tokens`));
      console.log(chalk.red(`✗ Price recovery failed: ${result.failed.length} tokens`));
      
      if (result.successful.length > 0) {
        console.log(chalk.gray('\nSample prices:'));
        for (const success of result.successful.slice(0, 3)) {
          console.log(chalk.white(`  ${success.mintAddress.slice(0, 8)}...: $${success.priceInUsd.toFixed(8)}`));
        }
      }
    }
  }
  
  await db.close();
}

main().catch(console.error);