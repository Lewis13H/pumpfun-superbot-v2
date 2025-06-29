#!/usr/bin/env tsx
/**
 * Test Jupiter Price Service
 * Fetches prices for graduated tokens from Jupiter API
 */

import 'dotenv/config';
import { db } from '../src/database';
import { JupiterPriceService } from '../src/services/jupiter-price-service';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🃏 Testing Jupiter Price Service'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get some graduated tokens to test
  const graduatedTokens = await db.query(`
    SELECT 
      t.mint_address, 
      t.symbol, 
      t.name, 
      t.latest_market_cap_usd,
      t.updated_at
    FROM tokens_unified t
    WHERE t.graduated_to_amm = true
    ORDER BY t.created_at DESC
    LIMIT 20
  `);
  
  console.log(chalk.yellow(`Testing with ${graduatedTokens.rows.length} graduated tokens\n`));
  
  // Display current state
  console.log(chalk.cyan('Current Token States:'));
  console.log(chalk.gray('─'.repeat(60)));
  
  for (const token of graduatedTokens.rows) {
    const age = Date.now() - new Date(token.updated_at).getTime();
    const ageStr = age > 3600000 ? chalk.red(`${Math.floor(age / 3600000)}h ago`) : 
                   age > 60000 ? chalk.yellow(`${Math.floor(age / 60000)}m ago`) : 
                   chalk.green(`${Math.floor(age / 1000)}s ago`);
    
    console.log(
      chalk.white(`${(token.symbol || 'Unknown').padEnd(10)}`),
      chalk.gray(`${token.mint_address.slice(0, 8)}...`),
      chalk.yellow(`$${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`),
      ageStr
    );
  }
  
  // Test Jupiter API
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Fetching prices from Jupiter...'));
  
  const jupiterService = JupiterPriceService.getInstance();
  const mints = graduatedTokens.rows.map(r => r.mint_address);
  
  const startTime = Date.now();
  const prices = await jupiterService.getPrices(mints);
  const elapsed = Date.now() - startTime;
  
  console.log(chalk.green(`\n✅ Fetched ${prices.size} prices in ${elapsed}ms`));
  
  // Display results
  if (prices.size > 0) {
    console.log(chalk.gray('\n' + 'Jupiter Price Results:'));
    console.log(chalk.gray('─'.repeat(60)));
    
    for (const token of graduatedTokens.rows) {
      const price = prices.get(token.mint_address);
      if (price) {
        const newMarketCap = price * 1e9;
        const oldMarketCap = parseFloat(token.latest_market_cap_usd || 0);
        const change = oldMarketCap > 0 ? ((newMarketCap - oldMarketCap) / oldMarketCap * 100) : 0;
        
        console.log(
          chalk.white(`${(token.symbol || 'Unknown').padEnd(10)}`),
          chalk.gray(`${token.mint_address.slice(0, 8)}...`),
          chalk.green(`$${price.toFixed(8)}`),
          chalk.yellow(`MC: $${newMarketCap.toLocaleString()}`),
          change > 0 ? chalk.green(`+${change.toFixed(2)}%`) : chalk.red(`${change.toFixed(2)}%`)
        );
      } else {
        console.log(
          chalk.white(`${(token.symbol || 'Unknown').padEnd(10)}`),
          chalk.gray(`${token.mint_address.slice(0, 8)}...`),
          chalk.red('No price data')
        );
      }
    }
  }
  
  // Test full update
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Testing full graduated token update...'));
  
  const updateResult = await jupiterService.updateGraduatedTokenPrices();
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Update Results:'));
  console.log(chalk.green(`✅ Successful: ${updateResult.successful}`));
  console.log(chalk.red(`❌ Failed: ${updateResult.failed}`));
  console.log(chalk.yellow(`📊 Total Queried: ${updateResult.totalQueried}`));
  
  await db.close();
}

main().catch(console.error);