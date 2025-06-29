#!/usr/bin/env tsx
/**
 * Test DexScreener Price Recovery
 */

import 'dotenv/config';
import { db } from '../src/database';
import { DexScreenerPriceService } from '../src/services/dexscreener-price-service';
import { DexScreenerPriceRecovery } from '../src/services/dexscreener-price-recovery';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🧪 Testing DexScreener Price Recovery'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get some stale graduated tokens
  const staleTokens = await db.query(`
    SELECT 
      t.mint_address,
      t.symbol,
      t.name,
      t.latest_price_usd,
      t.updated_at,
      EXTRACT(EPOCH FROM (NOW() - t.updated_at)) / 3600 as hours_since_update
    FROM tokens_unified t
    WHERE t.graduated_to_amm = TRUE
      AND t.current_program = 'amm_pool'
      AND (
        t.updated_at < NOW() - INTERVAL '1 hour'
        OR t.latest_price_usd IS NULL
        OR t.latest_price_usd = 0
      )
    ORDER BY t.latest_market_cap_usd DESC NULLS LAST
    LIMIT 5
  `);
  
  if (staleTokens.rows.length === 0) {
    console.log(chalk.yellow('No stale graduated tokens found'));
    
    // Try to find any graduated token for testing
    const anyGraduated = await db.query(`
      SELECT mint_address, symbol, name, latest_price_usd
      FROM tokens_unified
      WHERE graduated_to_amm = TRUE
      LIMIT 5
    `);
    
    if (anyGraduated.rows.length > 0) {
      console.log(chalk.cyan('\nTesting with recent graduated tokens:'));
      staleTokens.rows = anyGraduated.rows;
    } else {
      console.log(chalk.red('No graduated tokens found in database'));
      await db.close();
      return;
    }
  }
  
  console.log(chalk.yellow(`\nFound ${staleTokens.rows.length} tokens to test:\n`));
  
  const dexScreener = DexScreenerPriceService.getInstance();
  let successCount = 0;
  
  for (const token of staleTokens.rows) {
    console.log(chalk.white(`Testing: ${token.mint_address}`));
    console.log(chalk.gray(`  Symbol: ${token.symbol || 'N/A'}`));
    console.log(chalk.gray(`  Current Price: $${token.latest_price_usd || 'None'}`));
    console.log(chalk.gray(`  Hours Since Update: ${Math.round(token.hours_since_update || 0)}`));
    
    try {
      const priceData = await dexScreener.getTokenPrice(token.mint_address);
      
      if (priceData) {
        successCount++;
        console.log(chalk.green('  ✓ Found on DexScreener:'));
        console.log(chalk.cyan(`    Price: $${priceData.priceUsd.toFixed(8)}`));
        console.log(chalk.cyan(`    Market Cap: $${(priceData.marketCap / 1e6).toFixed(2)}M`));
        console.log(chalk.cyan(`    Liquidity: $${(priceData.liquidity / 1e3).toFixed(1)}k`));
        console.log(chalk.cyan(`    24h Volume: $${(priceData.volume24h / 1e3).toFixed(1)}k`));
        console.log(chalk.cyan(`    24h Change: ${priceData.priceChange24h.toFixed(2)}%`));
        console.log(chalk.cyan(`    Source: ${priceData.source}`));
      } else {
        console.log(chalk.red('  ✗ Not found on DexScreener'));
      }
    } catch (error) {
      console.log(chalk.red('  ✗ Error:'), error.message);
    }
    
    console.log(chalk.gray('─'.repeat(60)));
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(chalk.cyan(`\n📊 Summary: ${successCount}/${staleTokens.rows.length} tokens found on DexScreener`));
  
  // Test the recovery service
  console.log(chalk.cyan('\n🔄 Testing Recovery Service...'));
  
  const recovery = DexScreenerPriceRecovery.getInstance();
  
  // Test single token recovery if we found any
  if (staleTokens.rows.length > 0 && successCount > 0) {
    const testToken = staleTokens.rows[0];
    console.log(chalk.yellow(`\nRecovering single token: ${testToken.mint_address.slice(0, 8)}...`));
    
    const recovered = await recovery.recoverToken(testToken.mint_address);
    
    if (recovered) {
      // Check if it was updated
      const updated = await db.query(`
        SELECT latest_price_usd, price_source, last_dexscreener_update
        FROM tokens_unified
        WHERE mint_address = $1
      `, [testToken.mint_address]);
      
      if (updated.rows.length > 0) {
        console.log(chalk.green('✅ Token successfully updated:'));
        console.log(chalk.gray(`  New Price: $${updated.rows[0].latest_price_usd}`));
        console.log(chalk.gray(`  Source: ${updated.rows[0].price_source}`));
        console.log(chalk.gray(`  DexScreener Update: ${updated.rows[0].last_dexscreener_update}`));
      }
    }
  }
  
  await db.close();
}

main().catch(console.error);