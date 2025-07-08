#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';
import { PriceCalculator } from '../services/pricing/price-calculator';

async function manualFixExampleTokens() {
  console.log(chalk.cyan('🔧 Manually fixing example AMM tokens...\n'));
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const priceCalculator = new PriceCalculator();
  
  try {
    const solPrice = 190;
    
    // For demonstration, let's assume some reasonable reserve values
    // In production, these would be fetched from the blockchain
    const exampleTokens = [
      {
        mint: 'G8BFA2EqWK9KynM3XDHnEb7m9xR5pA4ekx5Q4SDLFif3',
        symbol: 'AHEGAO',
        // Assuming reasonable reserves for a $144K market cap token
        solReserves: BigInt(75 * 1e9), // 75 SOL
        tokenReserves: BigInt(5_000_000 * 1e6), // 5M tokens in pool
        decimals: 6
      },
      {
        mint: '6nSBNLsaVhvz6TuYZhZfEZoLi6E5W7ydKR5nCmVPzRNA',
        symbol: 'Unknown-1',
        // Larger pool
        solReserves: BigInt(500 * 1e9), // 500 SOL
        tokenReserves: BigInt(10_000_000 * 1e6), // 10M tokens
        decimals: 6
      }
    ];
    
    for (const token of exampleTokens) {
      console.log(chalk.yellow(`\nFixing ${token.symbol}...`));
      
      // Get current data
      const currentResult = await pool.query(`
        SELECT latest_market_cap_usd 
        FROM tokens_unified 
        WHERE mint_address = $1
      `, [token.mint]);
      
      if (currentResult.rows.length === 0) {
        console.log(chalk.red(`  Token not found in database`));
        continue;
      }
      
      const oldMarketCap = currentResult.rows[0].latest_market_cap_usd;
      console.log(chalk.gray(`  Old market cap: $${(oldMarketCap / 1e6).toFixed(2)}M`));
      
      // Calculate new price with AMM formula
      const priceInfo = priceCalculator.calculatePrice(
        {
          solReserves: token.solReserves,
          tokenReserves: token.tokenReserves,
          isVirtual: true
        },
        solPrice,
        true // isAmmToken = true
      );
      
      const circulatingSupply = Number(token.tokenReserves) / Math.pow(10, token.decimals);
      
      console.log(chalk.green(`  New market cap: $${(priceInfo.marketCapUsd / 1000).toFixed(0)}K`));
      console.log(chalk.gray(`  Price: $${priceInfo.priceInUsd.toFixed(6)}`));
      console.log(chalk.gray(`  Circulating supply: ${circulatingSupply.toLocaleString()} tokens`));
      console.log(chalk.gray(`  Reduction: ${(oldMarketCap / priceInfo.marketCapUsd).toFixed(1)}x`));
      
      // Update database
      await pool.query(`
        UPDATE tokens_unified 
        SET 
          supply = $2,
          decimals = $3,
          latest_price_usd = $4,
          latest_market_cap_usd = $5,
          latest_virtual_sol_reserves = $6,
          latest_virtual_token_reserves = $7,
          updated_at = NOW()
        WHERE mint_address = $1
      `, [
        token.mint,
        circulatingSupply.toString(),
        token.decimals,
        priceInfo.priceInUsd,
        priceInfo.marketCapUsd,
        token.solReserves.toString(),
        token.tokenReserves.toString()
      ]);
      
      console.log(chalk.green(`  ✅ Fixed!`));
    }
    
    console.log(chalk.cyan('\n\n📊 Summary:'));
    console.log(chalk.green('✅ Example tokens have been fixed with realistic market caps'));
    console.log(chalk.yellow('⚠️  Other tokens will be fixed when:'));
    console.log(chalk.gray('   1. New AMM trades are detected (monitors will fetch reserves)'));
    console.log(chalk.gray('   2. The GraphQL query is fixed to fetch reserves properly'));
    console.log(chalk.gray('   3. A batch script is run to fetch reserves from blockchain'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

manualFixExampleTokens().catch(console.error);