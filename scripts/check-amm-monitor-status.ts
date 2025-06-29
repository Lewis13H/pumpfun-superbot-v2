#!/usr/bin/env tsx
/**
 * Check AMM Monitor Status
 * Verifies if AMM monitors are correctly updating prices for active tokens
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🔍 Checking AMM Monitor Status'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Check recent AMM trades
  const recentAmmTrades = await db.query(`
    SELECT 
      COUNT(*) as total_trades,
      COUNT(DISTINCT mint_address) as unique_tokens,
      MIN(block_time) as oldest_trade,
      MAX(block_time) as newest_trade,
      AVG(price_usd) as avg_price_usd
    FROM trades_unified
    WHERE program = 'amm_pool'
      AND block_time > NOW() - INTERVAL '1 hour'
  `);
  
  const stats = recentAmmTrades.rows[0];
  console.log(chalk.cyan('AMM Trade Statistics (Last Hour):'));
  console.log(chalk.white(`Total Trades: ${stats.total_trades}`));
  console.log(chalk.white(`Unique Tokens: ${stats.unique_tokens}`));
  console.log(chalk.white(`Time Range: ${stats.oldest_trade} to ${stats.newest_trade}`));
  console.log(chalk.white(`Average Price: $${parseFloat(stats.avg_price_usd || 0).toFixed(8)}`));
  
  // Check if prices are being updated
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Recent Price Updates from AMM:'));
  
  const priceUpdates = await db.query(`
    SELECT 
      t.mint_address,
      t.symbol,
      t.name,
      t.latest_price_usd,
      t.latest_market_cap_usd,
      t.price_source,
      t.updated_at,
      COUNT(tr.signature) as recent_trades
    FROM tokens_unified t
    LEFT JOIN trades_unified tr ON tr.mint_address = t.mint_address 
      AND tr.program = 'amm_pool'
      AND tr.block_time > NOW() - INTERVAL '1 hour'
    WHERE t.graduated_to_amm = true
      AND t.updated_at > NOW() - INTERVAL '1 hour'
    GROUP BY t.mint_address, t.symbol, t.name, t.latest_price_usd, 
             t.latest_market_cap_usd, t.price_source, t.updated_at
    ORDER BY t.updated_at DESC
    LIMIT 10
  `);
  
  if (priceUpdates.rows.length === 0) {
    console.log(chalk.red('⚠️  No AMM price updates in the last hour!'));
  } else {
    console.log(chalk.green(`✅ Found ${priceUpdates.rows.length} tokens with recent price updates:\n`));
    
    for (const token of priceUpdates.rows) {
      const age = Date.now() - new Date(token.updated_at).getTime();
      const ageStr = age < 60000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60000)}m ago`;
      
      console.log(
        chalk.white(`${(token.symbol || 'Unknown').padEnd(10)}`),
        chalk.gray(`${token.mint_address.slice(0, 8)}...`),
        chalk.green(`$${parseFloat(token.latest_price_usd || 0).toFixed(8)}`),
        chalk.yellow(`MC: $${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`),
        chalk.cyan(`${token.recent_trades} trades`),
        chalk.gray(`(${ageStr}, source: ${token.price_source})`)
      );
    }
  }
  
  // Check pool state updates
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('AMM Pool State Updates:'));
  
  const poolStates = await db.query(`
    SELECT 
      COUNT(DISTINCT pool_address) as unique_pools,
      COUNT(DISTINCT mint_address) as unique_tokens,
      COUNT(*) as total_updates,
      COUNT(*) FILTER (WHERE virtual_sol_reserves > 0 AND virtual_token_reserves > 0) as with_reserves,
      MAX(created_at) as latest_update
    FROM amm_pool_states
    WHERE created_at > NOW() - INTERVAL '1 hour'
  `);
  
  const poolStats = poolStates.rows[0];
  console.log(chalk.white(`Pool Updates: ${poolStats.total_updates}`));
  console.log(chalk.white(`Unique Pools: ${poolStats.unique_pools}`));
  console.log(chalk.white(`Unique Tokens: ${poolStats.unique_tokens}`));
  console.log(chalk.white(`With Valid Reserves: ${poolStats.with_reserves}`));
  console.log(chalk.white(`Latest Update: ${poolStats.latest_update || 'Never'}`));
  
  // Check specific example of active trading token
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Active Trading Example:'));
  
  const activeToken = await db.query(`
    SELECT 
      t.mint_address,
      t.symbol,
      t.latest_price_usd,
      t.latest_market_cap_usd,
      t.updated_at,
      COUNT(tr.signature) as trade_count,
      MAX(tr.block_time) as last_trade,
      MIN(tr.price_usd) as min_price,
      MAX(tr.price_usd) as max_price
    FROM tokens_unified t
    JOIN trades_unified tr ON tr.mint_address = t.mint_address
    WHERE t.graduated_to_amm = true
      AND tr.program = 'amm_pool'
      AND tr.block_time > NOW() - INTERVAL '1 hour'
    GROUP BY t.mint_address, t.symbol, t.latest_price_usd, 
             t.latest_market_cap_usd, t.updated_at
    ORDER BY COUNT(tr.signature) DESC
    LIMIT 1
  `);
  
  if (activeToken.rows.length > 0) {
    const token = activeToken.rows[0];
    console.log(chalk.green('\nMost Active Token:'));
    console.log(chalk.white(`Token: ${token.symbol || 'Unknown'} (${token.mint_address})`));
    console.log(chalk.white(`Trades in last hour: ${token.trade_count}`));
    console.log(chalk.white(`Price range: $${parseFloat(token.min_price).toFixed(8)} - $${parseFloat(token.max_price).toFixed(8)}`));
    console.log(chalk.white(`Current price: $${parseFloat(token.latest_price_usd || 0).toFixed(8)}`));
    console.log(chalk.white(`Last trade: ${token.last_trade}`));
    console.log(chalk.white(`Price updated: ${token.updated_at}`));
    
    const updateLag = new Date(token.last_trade).getTime() - new Date(token.updated_at).getTime();
    if (updateLag > 60000) {
      console.log(chalk.red(`⚠️  Price update lag: ${Math.floor(updateLag / 60000)} minutes`));
    } else {
      console.log(chalk.green(`✅ Price updates are current (lag: ${Math.floor(updateLag / 1000)}s)`));
    }
  }
  
  // Summary
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan.bold('Summary:'));
  
  if (parseInt(stats.total_trades) > 0) {
    console.log(chalk.green('✅ AMM monitor is receiving trades'));
  } else {
    console.log(chalk.red('❌ No AMM trades detected in the last hour'));
  }
  
  if (priceUpdates.rows.length > 0) {
    console.log(chalk.green('✅ Token prices are being updated from AMM trades'));
  } else {
    console.log(chalk.red('❌ Token prices are NOT being updated'));
  }
  
  if (parseInt(poolStats.with_reserves) > 0) {
    console.log(chalk.green('✅ Some pool states have reserve data'));
  } else {
    console.log(chalk.red('❌ No pool states have reserve data'));
  }
  
  await db.close();
}

main().catch(console.error);