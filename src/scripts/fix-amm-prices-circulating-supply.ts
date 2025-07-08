#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { AMMPriceCalculator } from '../services/pricing/amm-price-calculator-fix';

async function fixAMMPricesWithCirculatingSupply() {
  console.log(chalk.cyan('🔧 Fixing AMM token prices with correct circulating supply...\n'));
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
  const priceCalculator = new AMMPriceCalculator();
  
  try {
    // Get current SOL price (use a reasonable default)
    const solPriceUsd = 190; // You can update this to current SOL price
    console.log(chalk.yellow(`Current SOL price: $${solPriceUsd}\n`));
    
    // Get all AMM tokens with reserves
    const result = await pool.query(`
      SELECT 
        t.mint_address, 
        t.symbol, 
        t.name,
        t.supply,
        t.total_supply,
        t.decimals,
        t.latest_price_usd as current_price_usd,
        t.latest_market_cap_usd as current_market_cap_usd,
        t.latest_virtual_sol_reserves,
        t.latest_virtual_token_reserves,
        t.creator
      FROM tokens_unified t
      WHERE t.graduated_to_amm = true 
        AND t.latest_virtual_sol_reserves IS NOT NULL
        AND t.latest_virtual_token_reserves IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 100
    `);
    
    console.log(chalk.yellow(`Found ${result.rows.length} AMM tokens with reserves\n`));
    
    let fixed = 0;
    let failed = 0;
    
    // Example token for detailed analysis
    const exampleMint = 'G8BFA2EqWK9KynM3XDHnEb7m9xR5pA4ekx5Q4SDLFif3';
    
    for (const token of result.rows) {
      const isExample = token.mint_address === exampleMint;
      
      if (isExample) {
        console.log(chalk.cyan(`\n🔍 DETAILED ANALYSIS: ${token.symbol || 'Unknown'} (${token.mint_address})`));
      }
      
      try {
        // Get actual token supply from blockchain
        const mintPubkey = new PublicKey(token.mint_address);
        const mintInfo = await connection.getAccountInfo(mintPubkey);
        
        if (!mintInfo) {
          console.log(chalk.red(`❌ ${token.mint_address.substring(0, 8)}... - Mint account not found`));
          failed++;
          continue;
        }
        
        // Parse mint data
        const supplyBytes = mintInfo.data.slice(36, 44);
        const actualSupply = Buffer.from(supplyBytes).readBigUInt64LE();
        const decimals = mintInfo.data[44];
        
        // Check if this is a pump.fun token (has creator field)
        const isPumpFunToken = !!token.creator;
        
        // Calculate correct price using AMM calculator
        const priceInfo = priceCalculator.calculateAMMPrice(
          BigInt(token.latest_virtual_sol_reserves),
          BigInt(token.latest_virtual_token_reserves),
          actualSupply,
          decimals,
          solPriceUsd,
          isPumpFunToken
        );
        
        if (isExample) {
          console.log(chalk.blue(`  📊 Token Details:`));
          console.log(chalk.gray(`     Total Supply: ${priceInfo.totalSupply.toLocaleString()}`));
          console.log(chalk.gray(`     Circulating Supply: ${priceInfo.circulatingSupply.toLocaleString()} (${isPumpFunToken ? '10%' : '100%'})`));
          console.log(chalk.gray(`     Sol Reserves: ${Number(token.latest_virtual_sol_reserves) / 1e9} SOL`));
          console.log(chalk.gray(`     Token Reserves: ${Number(token.latest_virtual_token_reserves) / Math.pow(10, decimals)}`));
          console.log(chalk.gray(`     Price per token: $${priceInfo.priceInUsd.toFixed(6)}`));
          console.log(chalk.gray(`     Is Pump.fun token: ${isPumpFunToken ? 'Yes' : 'No'}`));
          console.log(chalk.yellow(`  💰 Old Market Cap: $${Number(token.current_market_cap_usd).toLocaleString()}`));
          console.log(chalk.green(`  💰 New Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`));
          console.log(chalk.cyan(`  📉 Reduction: ${(token.current_market_cap_usd / priceInfo.marketCapUsd).toFixed(1)}x`));
        }
        
        // Update database with correct values
        await pool.query(`
          UPDATE tokens_unified 
          SET 
            supply = $2,
            total_supply = $3,
            decimals = $4,
            latest_market_cap_usd = $5,
            latest_price_usd = $6,
            updated_at = NOW()
          WHERE mint_address = $1
        `, [
          token.mint_address,
          priceInfo.circulatingSupply.toString(),
          actualSupply.toString(),
          decimals,
          priceInfo.marketCapUsd,
          priceInfo.priceInUsd
        ]);
        
        // Also update recent trades
        await pool.query(`
          UPDATE trades_unified
          SET 
            market_cap_usd = $2,
            price_usd = $3
          WHERE mint_address = $1 
            AND program = 'amm_pool'
            AND block_time > NOW() - INTERVAL '1 hour'
        `, [
          token.mint_address,
          priceInfo.marketCapUsd,
          priceInfo.priceInUsd
        ]);
        
        fixed++;
        
        if (!isExample) {
          // Short output for non-example tokens
          const oldMcap = Number(token.current_market_cap_usd);
          const reduction = oldMcap / priceInfo.marketCapUsd;
          console.log(chalk.green(`✅ ${token.mint_address.substring(0, 8)}... - Fixed! Market cap: $${(priceInfo.marketCapUsd / 1000).toFixed(0)}K (${reduction.toFixed(0)}x reduction)`));
        }
        
      } catch (error) {
        console.log(chalk.red(`❌ ${token.mint_address.substring(0, 8)}... - Error: ${error.message}`));
        failed++;
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(chalk.cyan('\n\n📊 Summary:'));
    console.log(chalk.green(`✅ Fixed: ${fixed} tokens`));
    console.log(chalk.red(`❌ Failed: ${failed} tokens`));
    
    // Show final state of example token
    const finalResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        supply as circulating_supply,
        total_supply,
        decimals,
        latest_price_usd,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = $1
    `, [exampleMint]);
    
    if (finalResult.rows.length > 0) {
      const example = finalResult.rows[0];
      console.log(chalk.cyan(`\n📝 Final State - ${exampleMint}:`));
      console.log(chalk.white(`  Symbol: ${example.symbol || 'Unknown'}`));
      console.log(chalk.white(`  Circulating Supply: ${Number(example.circulating_supply).toLocaleString()}`));
      console.log(chalk.white(`  Total Supply: ${(Number(example.total_supply) / Math.pow(10, example.decimals)).toLocaleString()}`));
      console.log(chalk.white(`  Price: $${Number(example.latest_price_usd).toFixed(6)}`));
      console.log(chalk.white(`  Market Cap: $${Number(example.latest_market_cap_usd).toLocaleString()}`));
      console.log(chalk.green(`\n✅ This should now match the ~$144K market cap shown on DexScreener!`));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

fixAMMPricesWithCirculatingSupply().catch(console.error);