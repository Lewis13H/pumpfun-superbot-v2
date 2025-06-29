#!/usr/bin/env tsx

/**
 * Update all token prices using GraphQL bulk recovery
 */

import 'dotenv/config';
import { GraphQLPriceRecovery } from '../src/services/graphql-price-recovery';
import { db } from '../src/database';
import chalk from 'chalk';

async function updateAllTokenPrices() {
  console.log(chalk.cyan.bold('\n📊 Updating All Token Prices via GraphQL\n'));
  
  const priceRecovery = GraphQLPriceRecovery.getInstance();
  const startTime = Date.now();
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  
  try {
    // Get all non-graduated tokens from database
    console.log(chalk.blue('Fetching all active tokens from database...'));
    const tokenResult = await db.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd
      FROM tokens_unified
      WHERE graduated_to_amm = false
      ORDER BY latest_market_cap_usd DESC NULLS LAST
    `);
    
    console.log(chalk.green(`Found ${tokenResult.rows.length} active bonding curve tokens`));
    
    if (tokenResult.rows.length === 0) {
      console.log(chalk.yellow('No tokens to update'));
      return;
    }
    
    // Process in batches of 100
    const batchSize = 100;
    const totalBatches = Math.ceil(tokenResult.rows.length / batchSize);
    
    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * batchSize;
      const batchEnd = Math.min((i + 1) * batchSize, tokenResult.rows.length);
      const batch = tokenResult.rows.slice(batchStart, batchEnd);
      const mintAddresses = batch.map(row => row.mint_address);
      
      console.log(chalk.blue(`\nProcessing batch ${i + 1}/${totalBatches} (${batch.length} tokens)`));
      
      try {
        // Recover prices
        const result = await priceRecovery.recoverPrices(mintAddresses);
        
        // Update database with new prices
        if (result.successful.length > 0) {
          const updatePromises = result.successful.map(async (priceUpdate) => {
            try {
              await db.query(`
                UPDATE tokens_unified
                SET 
                  latest_price_sol = $1,
                  latest_price_usd = $2,
                  latest_market_cap_usd = $3,
                  latest_virtual_sol_reserves = $4,
                  latest_virtual_token_reserves = $5,
                  latest_update_slot = $6,
                  updated_at = NOW()
                WHERE mint_address = $7
              `, [
                priceUpdate.priceInSol,
                priceUpdate.priceInUsd,
                priceUpdate.marketCapUsd,
                priceUpdate.virtualSolReserves.toString(),
                priceUpdate.virtualTokenReserves.toString(),
                priceUpdate.lastUpdated.getTime(),
                priceUpdate.mintAddress
              ]);
              
              // Also save to price history
              await db.query(`
                INSERT INTO price_update_sources (
                  mint_address, update_source, price_sol, price_usd,
                  market_cap_usd, reserves_sol, reserves_token, slot
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              `, [
                priceUpdate.mintAddress,
                'graphql',
                priceUpdate.priceInSol,
                priceUpdate.priceInUsd,
                priceUpdate.marketCapUsd,
                priceUpdate.virtualSolReserves.toString(),
                priceUpdate.virtualTokenReserves.toString(),
                0 // slot not available in current response
              ]);
              
              return true;
            } catch (error) {
              console.error(chalk.red(`Failed to update ${priceUpdate.mintAddress}:`), error);
              return false;
            }
          });
          
          const updateResults = await Promise.all(updatePromises);
          const successCount = updateResults.filter(r => r).length;
          totalUpdated += successCount;
        }
        
        totalFailed += result.failed.length;
        
        // Show progress
        const progress = ((batchEnd / tokenResult.rows.length) * 100).toFixed(1);
        console.log(chalk.gray(`  ✓ Updated: ${result.successful.length}`));
        console.log(chalk.gray(`  ✗ Failed: ${result.failed.length}`));
        console.log(chalk.gray(`  Progress: ${progress}%`));
        
        // Add delay between batches to avoid rate limits
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error) {
        console.error(chalk.red(`Batch ${i + 1} failed:`), error);
        totalFailed += batch.length;
      }
    }
    
    // Clear cache after bulk update
    priceRecovery.clearCache();
    
    // Show summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(chalk.green.bold('\n✅ Update Complete!'));
    console.log(chalk.white(`  Total tokens: ${tokenResult.rows.length}`));
    console.log(chalk.green(`  Successfully updated: ${totalUpdated}`));
    console.log(chalk.red(`  Failed: ${totalFailed}`));
    console.log(chalk.yellow(`  Skipped: ${totalSkipped}`));
    console.log(chalk.blue(`  Time elapsed: ${elapsed}s`));
    console.log(chalk.gray(`  Average: ${(tokenResult.rows.length / parseFloat(elapsed)).toFixed(1)} tokens/second`));
    
    // Show some sample updated tokens
    const sampleResult = await db.query(`
      SELECT mint_address, symbol, latest_price_usd, latest_market_cap_usd, updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_price_usd IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    
    if (sampleResult.rows.length > 0) {
      console.log(chalk.cyan('\nSample updated tokens:'));
      sampleResult.rows.forEach(row => {
        const price = parseFloat(row.latest_price_usd);
        const marketCap = parseFloat(row.latest_market_cap_usd);
        console.log(chalk.gray(`  ${row.symbol || 'Unknown'}: $${price.toFixed(8)} (MC: $${Math.round(marketCap).toLocaleString()})`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Update failed:'), error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run the update
updateAllTokenPrices()
  .then(() => {
    console.log(chalk.green('\n✨ All done!'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Fatal error:'), error);
    process.exit(1);
  });