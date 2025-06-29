#!/usr/bin/env tsx

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function checkTokensAboveThreshold() {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_above_8888,
        COUNT(CASE WHEN latest_market_cap_usd > 10000 THEN 1 END) as above_10k,
        COUNT(CASE WHEN latest_market_cap_usd > 20000 THEN 1 END) as above_20k,
        COUNT(CASE WHEN latest_market_cap_usd > 50000 THEN 1 END) as above_50k,
        MIN(latest_market_cap_usd) as min_market_cap,
        MAX(latest_market_cap_usd) as max_market_cap,
        AVG(latest_market_cap_usd) as avg_market_cap
      FROM tokens_unified
      WHERE latest_market_cap_usd > 8888
        AND graduated_to_amm = false
    `);
    
    const stats = result.rows[0];
    
    console.log(chalk.cyan.bold('\n💰 Tokens Above $8,888 Market Cap\n'));
    console.log(chalk.white('Total tokens above $8,888: ') + chalk.green.bold(stats.total_above_8888));
    console.log('');
    console.log(chalk.yellow('Distribution:'));
    console.log(chalk.gray('  • Above $10,000: ') + stats.above_10k);
    console.log(chalk.gray('  • Above $20,000: ') + stats.above_20k);
    console.log(chalk.gray('  • Above $50,000: ') + stats.above_50k);
    console.log('');
    console.log(chalk.yellow('Market Cap Range:'));
    console.log(chalk.gray('  • Minimum: $') + parseFloat(stats.min_market_cap).toLocaleString());
    console.log(chalk.gray('  • Maximum: $') + parseFloat(stats.max_market_cap).toLocaleString());
    console.log(chalk.gray('  • Average: $') + parseFloat(stats.avg_market_cap).toLocaleString());
    
    // Get top 10 tokens
    const topTokens = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        latest_price_usd,
        updated_at
      FROM tokens_unified
      WHERE latest_market_cap_usd > 8888
        AND graduated_to_amm = false
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    if (topTokens.rows.length > 0) {
      console.log(chalk.cyan('\nTop 10 Tokens:'));
      topTokens.rows.forEach((token, i) => {
        const marketCap = parseFloat(token.latest_market_cap_usd);
        const price = parseFloat(token.latest_price_usd);
        const age = Math.floor((Date.now() - new Date(token.updated_at).getTime()) / 1000 / 60);
        console.log(chalk.gray(
          `  ${i + 1}. ${token.symbol || token.name || 'Unknown'}: $${marketCap.toLocaleString()} (price: $${price < 0.01 ? price.toExponential(2) : price.toFixed(6)}) - ${age}m ago`
        ));
      });
    }
    
    // Check the $8,888 boundary
    const boundaryCheck = await db.query(`
      SELECT COUNT(*) as near_threshold
      FROM tokens_unified
      WHERE latest_market_cap_usd BETWEEN 8000 AND 8888
        AND graduated_to_amm = false
    `);
    
    console.log(chalk.yellow(`\n📊 Tokens near $8,888 threshold (8k-8.8k): ${boundaryCheck.rows[0].near_threshold}`));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.close();
  }
}

checkTokensAboveThreshold();