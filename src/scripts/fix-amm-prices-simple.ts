#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';
import { PriceCalculator } from '../services/pricing/price-calculator';

async function fixAMMPricesSimple() {
  console.log(chalk.cyan('🔧 Fixing AMM token prices using simple calculation...\n'));
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const priceCalculator = new PriceCalculator();
  
  try {
    const solPrice = 190;
    console.log(chalk.yellow(`Using SOL price: $${solPrice}\n`));
    
    // Get all AMM tokens with reserves already in DB
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
        t.latest_virtual_token_reserves
      FROM tokens_unified t
      WHERE t.graduated_to_amm = true 
        AND t.latest_market_cap_usd > 1000000  -- More than $1M
        AND t.latest_virtual_sol_reserves IS NOT NULL
        AND t.latest_virtual_token_reserves IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC
    `);
    
    console.log(chalk.yellow(`Found ${result.rows.length} AMM tokens with reserves and high market caps\n`));
    
    let fixed = 0;
    const fixes = [];
    
    for (let i = 0; i < result.rows.length; i++) {
      const token = result.rows[i];
      const progress = `[${i + 1}/${result.rows.length}]`;
      
      console.log(chalk.cyan(`${progress} Processing ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)`));
      console.log(chalk.gray(`  Current Market Cap: $${(token.current_market_cap_usd / 1e6).toFixed(2)}M`));
      
      try {
        const decimals = token.decimals || 6;
        
        // Calculate correct price using the new method
        const priceInfo = priceCalculator.calculatePrice(
          {
            solReserves: BigInt(token.latest_virtual_sol_reserves),
            tokenReserves: BigInt(token.latest_virtual_token_reserves),
            isVirtual: true
          },
          solPrice,
          true // isAmmToken = true - use pool tokens as circulating supply
        );
        
        const oldMarketCap = Number(token.current_market_cap_usd);
        const newMarketCap = priceInfo.marketCapUsd;
        const reduction = oldMarketCap / newMarketCap;
        
        // Calculate circulating supply (tokens in pool)
        const circulatingSupply = Number(token.latest_virtual_token_reserves) / Math.pow(10, decimals);
        
        console.log(chalk.green(`  ✅ New market cap: $${(newMarketCap / 1000).toFixed(0)}K (${reduction.toFixed(1)}x reduction)`));
        console.log(chalk.gray(`     Circulating supply: ${circulatingSupply.toLocaleString()} tokens (from pool)`));
        console.log(chalk.gray(`     Price: $${priceInfo.priceInUsd.toFixed(6)}`));
        
        // Update database
        await pool.query(`
          UPDATE tokens_unified 
          SET 
            supply = $2,
            latest_price_usd = $3,
            latest_market_cap_usd = $4,
            updated_at = NOW()
          WHERE mint_address = $1
        `, [
          token.mint_address,
          circulatingSupply.toString(),
          priceInfo.priceInUsd,
          newMarketCap
        ]);
        
        fixes.push({
          symbol: token.symbol || 'Unknown',
          mint: token.mint_address,
          oldMarketCap,
          newMarketCap,
          reduction
        });
        
        fixed++;
        
      } catch (error) {
        console.log(chalk.red(`  ❌ Error: ${error.message}`));
      }
    }
    
    // Summary
    console.log(chalk.cyan('\n\n📊 Summary:'));
    console.log(chalk.green(`✅ Fixed: ${fixed} tokens`));
    
    if (fixes.length > 0) {
      console.log(chalk.cyan('\n📈 Top Fixes:'));
      fixes
        .sort((a, b) => b.reduction - a.reduction)
        .slice(0, 10)
        .forEach((fix, i) => {
          console.log(chalk.white(
            `  ${i + 1}. ${fix.symbol} (${fix.mint.substring(0, 8)}...): ` +
            `$${(fix.oldMarketCap / 1e6).toFixed(1)}M → $${(fix.newMarketCap / 1000).toFixed(0)}K ` +
            `(${fix.reduction.toFixed(0)}x reduction)`
          ));
        });
    }
    
    // Update recent trades
    if (fixed > 0) {
      console.log(chalk.yellow('\n🔄 Updating recent trades...'));
      
      const updateResult = await pool.query(`
        UPDATE trades_unified t
        SET 
          market_cap_usd = tok.latest_market_cap_usd,
          price_usd = tok.latest_price_usd
        FROM tokens_unified tok
        WHERE t.mint_address = tok.mint_address
          AND t.program = 'amm_pool'
          AND t.block_time > NOW() - INTERVAL '24 hours'
          AND tok.graduated_to_amm = true
          AND tok.latest_market_cap_usd < 1000000
      `);
      
      console.log(chalk.green(`✅ Updated ${updateResult.rowCount} recent trades`));
    }
    
    // Show example token
    console.log(chalk.cyan('\n📝 Example - AHEGAO token:'));
    const exampleResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        supply as circulating_supply,
        latest_price_usd,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = 'G8BFA2EqWK9KynM3XDHnEb7m9xR5pA4ekx5Q4SDLFif3'
    `);
    
    if (exampleResult.rows.length > 0) {
      const example = exampleResult.rows[0];
      console.log(chalk.white(`  Symbol: ${example.symbol || 'AHEGAO'}`));
      console.log(chalk.white(`  Circulating Supply: ${Number(example.circulating_supply).toLocaleString()}`));
      console.log(chalk.white(`  Price: $${Number(example.latest_price_usd).toFixed(6)}`));
      console.log(chalk.white(`  Market Cap: $${Number(example.latest_market_cap_usd).toLocaleString()}`));
    }
    
    console.log(chalk.cyan('\n✨ Complete! AMM token prices have been fixed.'));
    
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixAMMPricesSimple().catch(console.error);