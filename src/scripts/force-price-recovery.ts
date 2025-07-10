#!/usr/bin/env node
/**
 * Force price recovery for specific tokens
 * Usage: npx tsx src/scripts/force-price-recovery.ts [mintAddress]
 */

import { config } from 'dotenv';
import chalk from 'chalk';
import { db } from '../database';
import { UnifiedGraphQLPriceRecovery } from '../services/recovery/unified-graphql-price-recovery';

config();

async function forcePriceRecovery(mintAddress?: string) {
  const targetMint = mintAddress || process.argv[2] || 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'; // Default to Paperbon
  
  console.log(chalk.cyan(`🔧 Force Price Recovery for ${targetMint}\n`));

  try {
    // Get current token info
    const tokenResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        latest_price_sol,
        latest_price_usd,
        last_trade_at,
        graduated_to_amm,
        is_stale,
        EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 as minutes_since_trade
      FROM tokens_unified
      WHERE mint_address = $1
    `, [targetMint]);

    if (tokenResult.rows.length === 0) {
      console.log(chalk.red('❌ Token not found in database'));
      return;
    }

    const token = tokenResult.rows[0];
    console.log(chalk.blue('Current Token State:'));
    console.log(chalk.gray(`   Symbol: ${token.symbol || 'Unknown'}`));
    console.log(chalk.gray(`   Name: ${token.name || 'Unknown'}`));
    console.log(chalk.yellow(`   Market Cap: $${token.latest_market_cap_usd.toLocaleString()}`));
    console.log(chalk.gray(`   Price USD: $${token.latest_price_usd}`));
    console.log(chalk.gray(`   Price SOL: ${token.latest_price_sol}`));
    console.log(chalk.gray(`   Last Trade: ${Math.round(token.minutes_since_trade)} minutes ago`));
    console.log(chalk.gray(`   Type: ${token.graduated_to_amm ? 'AMM' : 'Bonding Curve'}`));
    console.log(chalk.gray(`   Is Stale: ${token.is_stale ? 'Yes' : 'No'}`));

    // Initialize price recovery service
    console.log(chalk.blue('\n🚀 Initiating price recovery...'));
    const priceRecovery = UnifiedGraphQLPriceRecovery.getInstance();

    // Perform recovery
    const startTime = Date.now();
    const result = await priceRecovery.recoverPrices([token.mint_address]);

    const duration = Date.now() - startTime;
    
    if (result.successful.length > 0) {
      console.log(chalk.green(`\n✅ Price recovery successful! (${(duration / 1000).toFixed(1)}s)`));
      
      // Get updated token info
      const updatedResult = await db.query(`
        SELECT 
          latest_market_cap_usd,
          latest_price_sol,
          latest_price_usd,
          is_stale
        FROM tokens_unified
        WHERE mint_address = $1
      `, [targetMint]);

      if (updatedResult.rows.length > 0) {
        const updated = updatedResult.rows[0];
        console.log(chalk.blue('\nUpdated Token State:'));
        console.log(chalk.green(`   Market Cap: $${updated.latest_market_cap_usd.toLocaleString()}`));
        console.log(chalk.gray(`   Price USD: $${updated.latest_price_usd}`));
        console.log(chalk.gray(`   Price SOL: ${updated.latest_price_sol}`));
        console.log(chalk.gray(`   Is Stale: ${updated.is_stale ? 'Yes' : 'No'}`));
        
        // Calculate change
        const mcapChange = ((updated.latest_market_cap_usd - token.latest_market_cap_usd) / token.latest_market_cap_usd * 100).toFixed(1);
        if (Math.abs(parseFloat(mcapChange)) > 0.1) {
          console.log(chalk.yellow(`\n📊 Market cap changed by ${mcapChange}%`));
        }
      }
    } else {
      console.log(chalk.red(`\n❌ Price recovery failed!`));
      if (result.failed.length > 0) {
        console.log(chalk.red(`   Error: ${result.failed[0].error}`));
      }
    }

    // Show GraphQL queries used
    console.log(chalk.gray(`\n📡 GraphQL queries used: ${result.graphqlQueries || 0}`));

  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    process.exit(0);
  }
}

// Check if running directly
if (require.main === module) {
  forcePriceRecovery().catch(console.error);
}

export { forcePriceRecovery };