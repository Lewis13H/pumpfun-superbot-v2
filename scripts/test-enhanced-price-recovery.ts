#!/usr/bin/env tsx
/**
 * Test Enhanced Price Recovery
 * Tests the new Shyft AMM price recovery for graduated tokens
 */

import 'dotenv/config';
import { db } from '../src/database';
import { UnifiedGraphQLPriceRecovery } from '../src/services/unified-graphql-price-recovery';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🚀 Testing Enhanced Price Recovery'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get all stale tokens
  const staleTokens = await db.query(`
    SELECT 
      t.mint_address,
      t.symbol,
      t.name,
      t.graduated_to_amm,
      t.latest_market_cap_usd,
      t.updated_at,
      t.price_source
    FROM tokens_unified t
    WHERE t.updated_at < NOW() - INTERVAL '30 minutes'
      OR t.latest_price_usd IS NULL
    ORDER BY t.graduated_to_amm DESC, t.created_at DESC
    LIMIT 30
  `);
  
  console.log(chalk.yellow(`Found ${staleTokens.rows.length} stale tokens\n`));
  
  // Separate graduated and non-graduated
  const graduated = staleTokens.rows.filter(t => t.graduated_to_amm);
  const nonGraduated = staleTokens.rows.filter(t => !t.graduated_to_amm);
  
  console.log(chalk.cyan('Token Breakdown:'));
  console.log(chalk.green(`  ✓ Graduated (AMM): ${graduated.length}`));
  console.log(chalk.yellow(`  ○ Non-graduated (BC): ${nonGraduated.length}`));
  
  if (graduated.length > 0) {
    console.log(chalk.gray('\nGraduated tokens to update:'));
    for (const token of graduated.slice(0, 10)) {
      const age = Date.now() - new Date(token.updated_at).getTime();
      const ageStr = age > 3600000 ? `${Math.floor(age / 3600000)}h` : `${Math.floor(age / 60000)}m`;
      
      console.log(
        chalk.white(`  ${(token.symbol || 'Unknown').padEnd(10)}`),
        chalk.gray(`${token.mint_address.slice(0, 8)}...`),
        chalk.yellow(`$${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`),
        chalk.gray(`(${ageStr} old, source: ${token.price_source || 'unknown'})`)
      );
    }
  }
  
  // Test recovery
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Running Enhanced Price Recovery...'));
  
  const recoveryService = UnifiedGraphQLPriceRecovery.getInstance();
  const mints = staleTokens.rows.map(t => t.mint_address);
  
  const startTime = Date.now();
  const result = await recoveryService.recoverPrices(mints);
  const elapsed = Date.now() - startTime;
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Recovery Results:'));
  console.log(chalk.green(`✅ Successful: ${result.successful.length}`));
  console.log(chalk.red(`❌ Failed: ${result.failed.length}`));
  console.log(chalk.yellow(`⏱️  Time: ${elapsed}ms`));
  console.log(chalk.blue(`📊 GraphQL Queries: ${result.graphqlQueries}`));
  
  // Show successful updates
  if (result.successful.length > 0) {
    console.log(chalk.gray('\n' + 'Successful Updates:'));
    
    // Group by source
    const bySource = new Map<string, any[]>();
    result.successful.forEach(update => {
      const source = update.source || 'unknown';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source)!.push(update);
    });
    
    for (const [source, updates] of bySource.entries()) {
      console.log(chalk.cyan(`\n  From ${source}: ${updates.length} tokens`));
      
      for (const update of updates.slice(0, 5)) {
        const token = staleTokens.rows.find(t => t.mint_address === update.mintAddress);
        const oldMarketCap = parseFloat(token?.latest_market_cap_usd || 0);
        const change = oldMarketCap > 0 ? ((update.marketCapUsd - oldMarketCap) / oldMarketCap * 100) : 0;
        
        console.log(
          chalk.white(`    ${(token?.symbol || 'Unknown').padEnd(10)}`),
          chalk.gray(`${update.mintAddress.slice(0, 8)}...`),
          chalk.green(`$${update.priceInUsd.toFixed(8)}`),
          chalk.yellow(`MC: $${update.marketCapUsd.toLocaleString()}`),
          change !== 0 ? (change > 0 ? chalk.green(`+${change.toFixed(2)}%`) : chalk.red(`${change.toFixed(2)}%`)) : ''
        );
      }
    }
  }
  
  // Show failures
  if (result.failed.length > 0) {
    console.log(chalk.gray('\n' + 'Failed Updates:'));
    
    // Group by reason
    const byReason = new Map<string, any[]>();
    result.failed.forEach(failure => {
      const reason = failure.reason || 'Unknown error';
      if (!byReason.has(reason)) byReason.set(reason, []);
      byReason.get(reason)!.push(failure);
    });
    
    for (const [reason, failures] of byReason.entries()) {
      console.log(chalk.red(`\n  ${reason}: ${failures.length} tokens`));
      
      for (const failure of failures.slice(0, 3)) {
        const token = staleTokens.rows.find(t => t.mint_address === failure.mintAddress);
        console.log(
          chalk.gray(`    ${(token?.symbol || 'Unknown').padEnd(10)}`),
          chalk.gray(`${failure.mintAddress.slice(0, 8)}...`)
        );
      }
    }
  }
  
  // Check updated tokens
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Verifying Updates...'));
  
  const verifyResult = await db.query(`
    SELECT 
      COUNT(*) FILTER (WHERE price_source = 'shyft_amm') as shyft_amm,
      COUNT(*) FILTER (WHERE price_source = 'amm') as legacy_amm,
      COUNT(*) FILTER (WHERE price_source = 'graphql') as graphql,
      COUNT(*) FILTER (WHERE price_source = 'amm_pool_state') as pool_state,
      COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '5 minutes') as recently_updated
    FROM tokens_unified
    WHERE mint_address = ANY($1)
  `, [mints]);
  
  const stats = verifyResult.rows[0];
  console.log(chalk.green('\nPrice Sources:'));
  console.log(chalk.white(`  Shyft AMM: ${stats.shyft_amm}`));
  console.log(chalk.white(`  Legacy AMM: ${stats.legacy_amm}`));
  console.log(chalk.white(`  GraphQL BC: ${stats.graphql}`));
  console.log(chalk.white(`  Pool State: ${stats.pool_state}`));
  console.log(chalk.yellow(`  Recently Updated: ${stats.recently_updated}`));
  
  await db.close();
}

main().catch(console.error);