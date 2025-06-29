#!/usr/bin/env tsx
/**
 * Full DexScreener Recovery Test
 */

import 'dotenv/config';
import { db } from '../src/database';
import { DexScreenerPriceRecovery } from '../src/services/dexscreener-price-recovery';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🧪 Full DexScreener Recovery Test'));
  console.log(chalk.gray('─'.repeat(80)));
  
  const recovery = DexScreenerPriceRecovery.getInstance();
  
  // Get stale graduated tokens
  const staleTokens = await db.query(`
    SELECT 
      mint_address,
      symbol,
      name,
      latest_price_usd,
      latest_market_cap_usd,
      EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 as hours_stale
    FROM tokens_unified
    WHERE graduated_to_amm = TRUE
      AND (
        updated_at < NOW() - INTERVAL '1 hour'
        OR latest_price_usd IS NULL
        OR latest_price_usd = 0
      )
    ORDER BY latest_market_cap_usd DESC NULLS LAST
    LIMIT 10
  `);
  
  console.log(chalk.yellow(`Found ${staleTokens.rows.length} stale graduated tokens\n`));
  
  if (staleTokens.rows.length === 0) {
    console.log(chalk.green('No stale tokens - all prices are up to date!'));
    await db.close();
    return;
  }
  
  // Show current state
  console.log(chalk.cyan('Current State:'));
  console.log(chalk.gray('─'.repeat(80)));
  console.log(chalk.gray('Token                Symbol    Current Price   Market Cap      Hours Stale'));
  
  for (const token of staleTokens.rows) {
    console.log(
      chalk.white(`${token.mint_address.slice(0, 12)}...`),
      chalk.cyan((token.symbol || 'N/A').padEnd(10)),
      chalk.yellow(`$${parseFloat(token.latest_price_usd || 0).toFixed(8)}`.padEnd(16)),
      chalk.green(`$${((token.latest_market_cap_usd || 0) / 1000).toFixed(1)}k`.padEnd(15)),
      chalk.red(`${Math.round(token.hours_stale || 0)}h`)
    );
  }
  
  // Run recovery
  console.log(chalk.cyan('\n\nRunning Recovery...'));
  console.log(chalk.gray('─'.repeat(80)));
  
  await recovery.recoverStalePrices();
  
  // Check results
  console.log(chalk.cyan('\n\nChecking Results...'));
  console.log(chalk.gray('─'.repeat(80)));
  
  const updatedTokens = await db.query(`
    SELECT 
      mint_address,
      symbol,
      name,
      latest_price_usd,
      latest_market_cap_usd,
      price_source,
      last_dexscreener_update,
      EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 as minutes_since_update
    FROM tokens_unified
    WHERE mint_address = ANY($1)
    ORDER BY latest_market_cap_usd DESC NULLS LAST
  `, [staleTokens.rows.map(t => t.mint_address)]);
  
  console.log(chalk.gray('Token                Symbol    New Price       Market Cap      Source         Updated'));
  console.log(chalk.gray('─'.repeat(80)));
  
  let successCount = 0;
  for (const token of updatedTokens.rows) {
    const wasUpdated = token.minutes_since_update < 5 && token.last_dexscreener_update;
    if (wasUpdated) successCount++;
    
    console.log(
      wasUpdated ? chalk.green('✓') : chalk.red('✗'),
      chalk.white(`${token.mint_address.slice(0, 12)}...`),
      chalk.cyan((token.symbol || 'N/A').padEnd(10)),
      chalk.yellow(`$${parseFloat(token.latest_price_usd || 0).toFixed(8)}`.padEnd(16)),
      chalk.green(`$${((token.latest_market_cap_usd || 0) / 1000).toFixed(1)}k`.padEnd(15)),
      chalk.magenta((token.price_source || 'None').padEnd(15)),
      wasUpdated ? chalk.green(`${Math.round(token.minutes_since_update)}m ago`) : chalk.red('Not updated')
    );
  }
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Summary:'));
  console.log(chalk.white(`Tokens recovered: ${successCount}/${staleTokens.rows.length}`));
  
  // Show price update sources
  const sources = await db.query(`
    SELECT 
      update_source,
      COUNT(*) as count,
      AVG(price_usd) as avg_price,
      MAX(created_at) as latest
    FROM price_update_sources
    WHERE update_source = 'dexscreener_recovery'
      AND created_at > NOW() - INTERVAL '5 minutes'
    GROUP BY update_source
  `);
  
  if (sources.rows.length > 0) {
    console.log(chalk.green(`\n✓ DexScreener recovery logged ${sources.rows[0].count} updates`));
  }
  
  await db.close();
}

main().catch(console.error);