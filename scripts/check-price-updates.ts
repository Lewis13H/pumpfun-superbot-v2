#!/usr/bin/env tsx

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function checkPriceUpdates() {
  try {
    // Check update statistics
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(latest_price_usd) as tokens_with_price,
        COUNT(CASE WHEN updated_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as recently_updated,
        COUNT(CASE WHEN latest_price_usd IS NULL THEN 1 END) as tokens_without_price
      FROM tokens_unified 
      WHERE graduated_to_amm = false
    `);
    
    console.log(chalk.cyan('\n📊 Token Price Update Statistics:'));
    console.log(chalk.white(`  Total active tokens: ${stats.rows[0].total_tokens}`));
    console.log(chalk.green(`  Tokens with prices: ${stats.rows[0].tokens_with_price}`));
    console.log(chalk.blue(`  Recently updated: ${stats.rows[0].recently_updated}`));
    console.log(chalk.yellow(`  Missing prices: ${stats.rows[0].tokens_without_price}`));
    
    // Show some sample updated tokens
    const samples = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_price_usd,
        latest_market_cap_usd,
        latest_virtual_sol_reserves::numeric / 1e9 as sol_reserves,
        updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_price_usd IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    
    console.log(chalk.cyan('\n🔄 Recently Updated Tokens:'));
    samples.rows.forEach((row, i) => {
      const price = parseFloat(row.latest_price_usd);
      const marketCap = parseFloat(row.latest_market_cap_usd);
      const sol = parseFloat(row.sol_reserves);
      const age = Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 1000);
      
      console.log(chalk.gray(`\n${i + 1}. ${row.symbol || row.name || 'Unknown'}`));
      console.log(chalk.gray(`   Price: $${price < 0.01 ? price.toExponential(2) : price.toFixed(6)}`));
      console.log(chalk.gray(`   Market Cap: $${marketCap.toLocaleString()}`));
      console.log(chalk.gray(`   SOL Reserves: ${sol.toFixed(2)} SOL`));
      console.log(chalk.gray(`   Updated: ${age}s ago`));
    });
    
    // Check price history entries
    const priceHistory = await db.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(DISTINCT mint_address) as unique_tokens,
        MIN(created_at) as oldest_entry,
        MAX(created_at) as newest_entry
      FROM price_update_sources
      WHERE update_source = 'graphql'
    `);
    
    if (priceHistory.rows[0].total_entries > 0) {
      console.log(chalk.cyan('\n📈 Price History (GraphQL):'));
      console.log(chalk.white(`  Total entries: ${priceHistory.rows[0].total_entries}`));
      console.log(chalk.white(`  Unique tokens: ${priceHistory.rows[0].unique_tokens}`));
      console.log(chalk.white(`  Oldest: ${new Date(priceHistory.rows[0].oldest_entry).toLocaleString()}`));
      console.log(chalk.white(`  Newest: ${new Date(priceHistory.rows[0].newest_entry).toLocaleString()}`));
    }
    
  } catch (error) {
    console.error(chalk.red('Error checking updates:'), error);
  } finally {
    await db.close();
  }
}

checkPriceUpdates();