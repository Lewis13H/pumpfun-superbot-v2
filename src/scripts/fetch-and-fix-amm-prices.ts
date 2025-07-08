#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';
import { AmmReservesFetcher } from '../services/amm/amm-reserves-fetcher';
import { EventBus } from '../core/event-bus';

async function fetchAndFixAMMPrices() {
  console.log(chalk.cyan('🔧 Fetching reserves and fixing AMM prices...\n'));
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const eventBus = new EventBus();
  const reservesFetcher = AmmReservesFetcher.getInstance(eventBus);
  
  try {
    // Target token
    const tokenMint = 'G8BFA2EqWK9KynM3XDHnEb7m9xR5pA4ekx5Q4SDLFif3';
    
    console.log(chalk.yellow('Fetching reserves for AHEGAO token...'));
    
    // Fetch reserves
    const reserveData = await reservesFetcher.fetchReservesForToken(tokenMint);
    
    if (!reserveData) {
      console.log(chalk.red('Failed to fetch reserves!'));
      return;
    }
    
    console.log(chalk.green('✅ Reserves fetched:'));
    console.log(chalk.gray(`  SOL Reserves: ${reserveData.solReserves} lamports`));
    console.log(chalk.gray(`  Token Reserves: ${reserveData.tokenReserves} units`));
    console.log(chalk.gray(`  Price USD: $${reserveData.priceInUsd}`));
    console.log(chalk.gray(`  Market Cap: $${reserveData.marketCapUsd.toLocaleString()}`));
    
    // Get token data
    const result = await pool.query(`
      SELECT 
        symbol,
        name,
        total_supply,
        decimals
      FROM tokens_unified
      WHERE mint_address = $1
    `, [tokenMint]);
    
    const token = result.rows[0];
    const totalSupply = Number(token.total_supply) / 1e6;
    
    // Calculate actual values
    const solReserves = Number(reserveData.solReserves) / 1e9;
    const tokenReserves = Number(reserveData.tokenReserves) / 1e6;
    const solPrice = 190;
    
    console.log(chalk.cyan('\n📊 Detailed Calculation:'));
    console.log(chalk.gray(`  SOL in pool: ${solReserves.toFixed(4)} SOL`));
    console.log(chalk.gray(`  Tokens in pool: ${tokenReserves.toLocaleString()}`));
    console.log(chalk.gray(`  Total Supply: ${totalSupply.toLocaleString()}`));
    
    // Price calculation
    const pricePerToken = (solReserves / tokenReserves) * solPrice;
    console.log(chalk.green(`  ✅ Price per token: $${pricePerToken.toFixed(8)}`));
    
    // Determine circulating supply
    // DexScreener shows $144K market cap
    const targetMarketCap = 144000;
    const impliedCirculatingSupply = targetMarketCap / pricePerToken;
    
    console.log(chalk.cyan('\n🎯 Market Cap Analysis:'));
    console.log(chalk.gray(`  Target market cap (from DexScreener): $${targetMarketCap.toLocaleString()}`));
    console.log(chalk.gray(`  Current market cap (1B supply): $${reserveData.marketCapUsd.toLocaleString()}`));
    console.log(chalk.gray(`  Implied circulating supply: ${impliedCirculatingSupply.toLocaleString()} tokens`));
    console.log(chalk.gray(`  Percentage of total: ${(impliedCirculatingSupply / totalSupply * 100).toFixed(2)}%`));
    
    // The issue is clear: we're using 1B tokens when we should use the actual circulating supply
    // For pump.fun tokens, this is typically the tokens in the AMM pool
    const circulatingSupply = tokenReserves; // Use pool reserves as circulating supply
    const correctMarketCap = pricePerToken * circulatingSupply;
    
    console.log(chalk.cyan('\n💡 Correct Approach:'));
    console.log(chalk.green(`  ✅ Circulating supply = Tokens in AMM pool: ${circulatingSupply.toLocaleString()}`));
    console.log(chalk.green(`  ✅ Price: $${pricePerToken.toFixed(8)}`));
    console.log(chalk.green(`  ✅ Market Cap: $${correctMarketCap.toLocaleString()}`));
    
    // Apply the fix
    console.log(chalk.yellow('\n🚀 Applying fix...'));
    await pool.query(`
      UPDATE tokens_unified 
      SET 
        supply = $1,
        latest_price_usd = $2,
        latest_market_cap_usd = $3,
        latest_virtual_sol_reserves = $4,
        latest_virtual_token_reserves = $5,
        updated_at = NOW()
      WHERE mint_address = $6
    `, [
      circulatingSupply.toString(),
      pricePerToken,
      correctMarketCap,
      reserveData.solReserves,
      reserveData.tokenReserves,
      tokenMint
    ]);
    
    console.log(chalk.green('✅ Fix applied!'));
    
    // Verify
    const verifyResult = await pool.query(`
      SELECT 
        symbol,
        supply as circulating_supply,
        latest_price_usd,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = $1
    `, [tokenMint]);
    
    const fixed = verifyResult.rows[0];
    console.log(chalk.cyan('\n✅ Final Values:'));
    console.log(chalk.green(`  Symbol: ${fixed.symbol}`));
    console.log(chalk.green(`  Circulating Supply: ${Number(fixed.circulating_supply).toLocaleString()}`));
    console.log(chalk.green(`  Price: $${Number(fixed.latest_price_usd).toFixed(8)}`));
    console.log(chalk.green(`  Market Cap: $${Number(fixed.latest_market_cap_usd).toLocaleString()}`));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

fetchAndFixAMMPrices().catch(console.error);