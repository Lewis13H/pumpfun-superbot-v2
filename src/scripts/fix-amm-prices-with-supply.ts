#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import { Metadata } from '@metaplex-foundation/mpl-token-metadata';
import chalk from 'chalk';

async function fixAMMPricesWithSupply() {
  console.log(chalk.cyan('🔧 Fixing AMM token prices with actual supply...\n'));
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
  
  try {
    // Get all AMM tokens with inflated market caps
    const result = await pool.query(`
      SELECT 
        mint_address, 
        symbol, 
        name,
        supply,
        total_supply,
        decimals,
        latest_price_usd as current_price_usd,
        latest_market_cap_usd as current_market_cap_usd,
        latest_virtual_sol_reserves,
        latest_virtual_token_reserves
      FROM tokens_unified 
      WHERE graduated_to_amm = true 
        AND latest_market_cap_usd > 1000000
      ORDER BY latest_market_cap_usd DESC
      LIMIT 50
    `);
    
    console.log(chalk.yellow(`Found ${result.rows.length} AMM tokens with high market caps\n`));
    
    let fixed = 0;
    let failed = 0;
    
    for (const token of result.rows) {
      console.log(chalk.cyan(`\nProcessing ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)`));
      console.log(chalk.gray(`Current Market Cap: $${(token.current_market_cap_usd / 1e9).toFixed(2)}B`));
      
      try {
        // Get actual token supply from blockchain
        const mintPubkey = new PublicKey(token.mint_address);
        const mintInfo = await connection.getAccountInfo(mintPubkey);
        
        if (!mintInfo) {
          console.log(chalk.red('  ❌ Mint account not found'));
          failed++;
          continue;
        }
        
        // Parse mint data (supply is at offset 36, 8 bytes)
        const supplyBytes = mintInfo.data.slice(36, 44);
        const actualSupply = Buffer.from(supplyBytes).readBigUInt64LE();
        const decimals = mintInfo.data[44];
        
        // Convert to human-readable supply
        const supplyWithDecimals = Number(actualSupply) / Math.pow(10, decimals);
        
        console.log(chalk.blue(`  📊 Actual Supply: ${supplyWithDecimals.toLocaleString()} (decimals: ${decimals})`));
        
        // Recalculate market cap with actual supply
        const newMarketCap = token.current_price_usd * supplyWithDecimals;
        const marketCapReduction = token.current_market_cap_usd / newMarketCap;
        
        console.log(chalk.green(`  💰 New Market Cap: $${newMarketCap.toLocaleString()}`));
        console.log(chalk.yellow(`  📉 Reduction Factor: ${marketCapReduction.toFixed(2)}x`));
        
        // Update database with correct values
        await pool.query(`
          UPDATE tokens_unified 
          SET 
            supply = $2,
            total_supply = $3,
            decimals = $4,
            latest_market_cap_usd = $5,
            updated_at = NOW()
          WHERE mint_address = $1
        `, [
          token.mint_address,
          supplyWithDecimals.toString(),
          actualSupply.toString(),
          decimals,
          newMarketCap
        ]);
        
        // Also update the current market cap in trades
        await pool.query(`
          UPDATE trades_unified
          SET market_cap_usd = price_usd * $2
          WHERE mint_address = $1 
            AND program = 'amm_pool'
            AND block_time > NOW() - INTERVAL '24 hours'
        `, [token.mint_address, supplyWithDecimals]);
        
        fixed++;
        console.log(chalk.green('  ✅ Fixed!'));
        
      } catch (error) {
        console.log(chalk.red(`  ❌ Error: ${error.message}`));
        failed++;
      }
    }
    
    console.log(chalk.cyan('\n\n📊 Summary:'));
    console.log(chalk.green(`✅ Fixed: ${fixed} tokens`));
    console.log(chalk.red(`❌ Failed: ${failed} tokens`));
    
    // Show example of fixed token
    if (fixed > 0) {
      const exampleResult = await pool.query(`
        SELECT 
          mint_address,
          symbol,
          name,
          supply,
          decimals,
          latest_price_usd,
          latest_market_cap_usd
        FROM tokens_unified
        WHERE mint_address = 'G8BFA2EqWK9KynM3XDHnEb7m9xR5pA4ekx5Q4SDLFif3'
      `);
      
      if (exampleResult.rows.length > 0) {
        const example = exampleResult.rows[0];
        console.log(chalk.cyan('\n📝 Example - Token G8BFA2EqWK9KynM3XDHnEb7m9xR5pA4ekx5Q4SDLFif3:'));
        console.log(chalk.white(`  Symbol: ${example.symbol}`));
        console.log(chalk.white(`  Supply: ${Number(example.supply).toLocaleString()}`));
        console.log(chalk.white(`  Decimals: ${example.decimals}`));
        console.log(chalk.white(`  Price: $${example.latest_price_usd}`));
        console.log(chalk.white(`  Market Cap: $${Number(example.latest_market_cap_usd).toLocaleString()}`));
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

fixAMMPricesWithSupply().catch(console.error);