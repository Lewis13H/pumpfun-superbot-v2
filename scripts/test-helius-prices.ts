#!/usr/bin/env tsx
/**
 * Test Helius Price Service
 * Check if Helius DAS API provides price data for graduated tokens
 */

import 'dotenv/config';
import { db } from '../src/database';
import { HeliusPriceService } from '../src/services/helius-price-service';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🌟 Testing Helius Price Service'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Check if API key is configured
  if (!process.env.HELIUS_API_KEY) {
    console.log(chalk.red('❌ HELIUS_API_KEY not found in environment'));
    console.log(chalk.yellow('Please set HELIUS_API_KEY in your .env file'));
    await db.close();
    return;
  }
  
  // Get some graduated tokens to test
  const graduatedTokens = await db.query(`
    SELECT 
      t.mint_address,
      t.symbol,
      t.name,
      t.latest_price_usd,
      t.latest_market_cap_usd,
      t.updated_at,
      t.price_source
    FROM tokens_unified t
    WHERE t.graduated_to_amm = true
    ORDER BY t.created_at DESC
    LIMIT 10
  `);
  
  console.log(chalk.yellow(`Testing with ${graduatedTokens.rows.length} graduated tokens\n`));
  
  const heliusService = HeliusPriceService.getInstance();
  
  // Test individual price lookups
  console.log(chalk.cyan('Testing Individual Price Lookups:'));
  console.log(chalk.gray('─'.repeat(60)));
  
  let successCount = 0;
  let noPriceCount = 0;
  
  for (const token of graduatedTokens.rows) {
    const mint = token.mint_address;
    console.log(chalk.white(`\nChecking ${token.symbol || 'Unknown'} (${mint.slice(0, 8)}...):`));
    console.log(chalk.gray(`Current: $${parseFloat(token.latest_price_usd || 0).toFixed(8)} (${token.price_source})`));
    
    try {
      const result = await heliusService.checkPriceAvailability(mint);
      
      if (result.hasPrice && result.price) {
        successCount++;
        const oldPrice = parseFloat(token.latest_price_usd || 0);
        const change = oldPrice > 0 ? ((result.price - oldPrice) / oldPrice * 100) : 0;
        
        console.log(chalk.green(`✅ Helius price: $${result.price.toFixed(8)}`));
        if (change !== 0) {
          console.log(
            chalk.white('   Change: '),
            change > 0 ? chalk.green(`+${change.toFixed(2)}%`) : chalk.red(`${change.toFixed(2)}%`)
          );
        }
      } else {
        noPriceCount++;
        console.log(chalk.yellow('⚠️  No price data available in Helius'));
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.log(chalk.red('❌ Error fetching price'));
    }
  }
  
  // Summary
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Summary:'));
  console.log(chalk.green(`✅ Tokens with prices: ${successCount}`));
  console.log(chalk.yellow(`⚠️  Tokens without prices: ${noPriceCount}`));
  
  // Test bulk update if we have some successes
  if (successCount > 0) {
    console.log(chalk.gray('\n' + '─'.repeat(80)));
    console.log(chalk.cyan('Testing Bulk Update for Stale Tokens...'));
    
    const updateResult = await heliusService.updateStaleGraduatedTokenPrices();
    
    console.log(chalk.gray('\n' + '─'.repeat(80)));
    console.log(chalk.cyan('Bulk Update Results:'));
    console.log(chalk.green(`✅ Successfully updated: ${updateResult.successful}`));
    console.log(chalk.yellow(`⚠️  No price data: ${updateResult.noPrice}`));
    console.log(chalk.red(`❌ Failed: ${updateResult.failed}`));
  } else {
    console.log(chalk.red('\n⚠️  Helius does not appear to have price data for pump.fun tokens'));
    console.log(chalk.yellow('This is expected as Helius primarily tracks established tokens'));
  }
  
  await db.close();
}

main().catch(console.error);