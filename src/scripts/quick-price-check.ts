#!/usr/bin/env node
/**
 * Quick price check and recovery for tokens
 * Usage: npx tsx src/scripts/quick-price-check.ts [mintAddress]
 */

import { config } from 'dotenv';
import chalk from 'chalk';
import { db } from '../database';
import { UnifiedGraphQLPriceRecovery } from '../services/recovery/unified-graphql-price-recovery';
import { Connection, PublicKey } from '@solana/web3.js';
import { deriveBondingCurveAddress } from '../utils/config/pump-addresses';

config();

async function quickPriceCheck(mintAddress?: string) {
  const targetMint = mintAddress || process.argv[2];
  
  if (!targetMint) {
    console.log(chalk.red('Please provide a mint address'));
    console.log(chalk.gray('Usage: npx tsx src/scripts/quick-price-check.ts <mintAddress>'));
    process.exit(1);
  }
  
  console.log(chalk.cyan(`🔍 Quick Price Check for ${targetMint}\n`));

  try {
    // Validate mint address
    try {
      new PublicKey(targetMint);
    } catch {
      console.log(chalk.red('❌ Invalid mint address'));
      return;
    }

    // Get current token info from database
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
      console.log(chalk.yellow('⚠️ Token not found in database'));
      console.log(chalk.gray('This token may not have been tracked yet'));
    } else {
      const token = tokenResult.rows[0];
      console.log(chalk.blue('📊 Current Database State:'));
      console.log(chalk.gray(`   Symbol: ${token.symbol || 'Unknown'}`));
      console.log(chalk.gray(`   Name: ${token.name || 'Unknown'}`));
      console.log(chalk.yellow(`   Market Cap: $${token.latest_market_cap_usd?.toLocaleString() || '0'}`));
      console.log(chalk.gray(`   Price USD: $${token.latest_price_usd || '0'}`));
      console.log(chalk.gray(`   Price SOL: ${token.latest_price_sol || '0'}`));
      console.log(chalk.gray(`   Last Trade: ${Math.round(token.minutes_since_trade)} minutes ago`));
      console.log(chalk.gray(`   Type: ${token.graduated_to_amm ? 'AMM Pool' : 'Bonding Curve'}`));
      console.log(chalk.gray(`   Is Stale: ${token.is_stale ? 'Yes' : 'No'}`));
    }

    // Now fetch live price
    console.log(chalk.blue('\n🔄 Fetching live price...'));
    const priceRecovery = UnifiedGraphQLPriceRecovery.getInstance();
    
    const startTime = Date.now();
    const result = await priceRecovery.recoverPrices([targetMint]);
    const duration = Date.now() - startTime;
    
    if (result.successful.length > 0) {
      const update = result.successful[0];
      console.log(chalk.green(`\n✅ Live price fetched successfully! (${(duration / 1000).toFixed(1)}s)`));
      console.log(chalk.blue('📈 Live Data:'));
      console.log(chalk.green(`   Market Cap: $${update.marketCapUsd.toLocaleString()}`));
      console.log(chalk.gray(`   Price USD: $${update.priceUsd}`));
      console.log(chalk.gray(`   Price SOL: ${update.priceSol}`));
      
      // Compare with database
      if (tokenResult.rows.length > 0) {
        const token = tokenResult.rows[0];
        const mcapChange = ((update.marketCapUsd - (token.latest_market_cap_usd || 0)) / (token.latest_market_cap_usd || 1) * 100).toFixed(1);
        
        if (Math.abs(parseFloat(mcapChange)) > 1) {
          console.log(chalk.yellow(`\n📊 Difference: ${mcapChange}%`));
          
          if (Math.abs(parseFloat(mcapChange)) > 50) {
            console.log(chalk.red(`⚠️  Large price discrepancy detected!`));
            console.log(chalk.gray(`   Database shows: $${token.latest_market_cap_usd?.toLocaleString() || '0'}`));
            console.log(chalk.gray(`   Live price is: $${update.marketCapUsd.toLocaleString()}`));
          }
        }
      }
      
      // Update database if requested
      if (process.argv.includes('--update')) {
        console.log(chalk.blue('\n💾 Updating database...'));
        await db.query(`
          UPDATE tokens_unified
          SET 
            latest_market_cap_usd = $2,
            latest_price_usd = $3,
            latest_price_sol = $4,
            is_stale = false,
            last_updated = NOW()
          WHERE mint_address = $1
        `, [targetMint, update.marketCapUsd, update.priceUsd, update.priceSol]);
        
        console.log(chalk.green('✅ Database updated!'));
      } else {
        console.log(chalk.gray('\n💡 Tip: Add --update flag to update the database'));
      }
      
    } else {
      console.log(chalk.red(`\n❌ Failed to fetch live price`));
      if (result.failed.length > 0) {
        console.log(chalk.red(`   Error: ${result.failed[0].error}`));
      }
      
      // Try to show bonding curve address for debugging
      if (tokenResult.rows.length > 0 && !tokenResult.rows[0].graduated_to_amm) {
        try {
          const bcAddress = deriveBondingCurveAddress(targetMint);
          console.log(chalk.gray(`\n🔍 Debug info:`));
          console.log(chalk.gray(`   Bonding Curve: ${bcAddress.toBase58()}`));
        } catch (e) {
          console.log(chalk.red(`   Failed to derive BC address: ${e}`));
        }
      }
    }

    console.log(chalk.gray(`\n📡 GraphQL queries used: ${result.graphqlQueries || 0}`));

  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    process.exit(0);
  }
}

// Run the check
quickPriceCheck().catch(console.error);