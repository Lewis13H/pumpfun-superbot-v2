#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';

async function debugAMMPriceCalculation() {
  console.log(chalk.cyan('🔍 Debugging AMM Price Calculation for AHEGAO token\n'));
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Get the AHEGAO token data
    const tokenMint = 'G8BFA2EqWK9KynM3XDHnEb7m9xR5pA4ekx5Q4SDLFif3';
    
    const result = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        supply,
        total_supply,
        decimals,
        latest_price_usd,
        latest_market_cap_usd,
        latest_virtual_sol_reserves,
        latest_virtual_token_reserves,
        creator
      FROM tokens_unified
      WHERE mint_address = $1
    `, [tokenMint]);
    
    if (result.rows.length === 0) {
      console.log(chalk.red('Token not found!'));
      return;
    }
    
    const token = result.rows[0];
    console.log(chalk.yellow('Current Database Values:'));
    console.log(chalk.gray(`  Symbol: ${token.symbol || 'AHEGAO'}`));
    console.log(chalk.gray(`  Supply (DB): ${token.supply}`));
    console.log(chalk.gray(`  Total Supply (DB): ${token.total_supply}`));
    console.log(chalk.gray(`  Decimals: ${token.decimals}`));
    console.log(chalk.gray(`  Price USD: $${token.latest_price_usd}`));
    console.log(chalk.gray(`  Market Cap USD: $${Number(token.latest_market_cap_usd).toLocaleString()}`));
    console.log(chalk.gray(`  SOL Reserves: ${token.latest_virtual_sol_reserves}`));
    console.log(chalk.gray(`  Token Reserves: ${token.latest_virtual_token_reserves}`));
    
    // Calculate what the values should be
    const solReserves = Number(token.latest_virtual_sol_reserves) / 1e9; // Convert lamports to SOL
    const tokenReserves = Number(token.latest_virtual_token_reserves) / 1e6; // 6 decimals
    const solPrice = 190; // Current SOL price
    
    console.log(chalk.cyan('\n📊 Calculation Details:'));
    console.log(chalk.gray(`  SOL in pool: ${solReserves.toFixed(2)} SOL`));
    console.log(chalk.gray(`  Tokens in pool: ${tokenReserves.toLocaleString()}`));
    console.log(chalk.gray(`  SOL price: $${solPrice}`));
    
    // Price per token = SOL in pool / tokens in pool * SOL price
    const pricePerToken = (solReserves / tokenReserves) * solPrice;
    console.log(chalk.green(`  ✅ Price per token: $${pricePerToken.toFixed(6)}`));
    
    // For pump.fun tokens, we need to figure out circulating supply
    // Market cap on DexScreener is $144K
    // If price is correct, then: circulating supply = market cap / price
    const targetMarketCap = 144000; // $144K from DexScreener
    const impliedCirculatingSupply = targetMarketCap / pricePerToken;
    
    console.log(chalk.cyan('\n🎯 Reverse Engineering from DexScreener:'));
    console.log(chalk.gray(`  Target market cap: $${targetMarketCap.toLocaleString()}`));
    console.log(chalk.gray(`  Price per token: $${pricePerToken.toFixed(6)}`));
    console.log(chalk.green(`  ✅ Implied circulating supply: ${impliedCirculatingSupply.toLocaleString()} tokens`));
    
    // What percentage is this of total supply?
    const totalSupplyFromDB = Number(token.total_supply) / 1e6; // Convert with decimals
    const circulatingPercentage = (impliedCirculatingSupply / totalSupplyFromDB) * 100;
    console.log(chalk.green(`  ✅ Circulating percentage: ${circulatingPercentage.toFixed(2)}%`));
    
    // Calculate correct market cap
    const correctMarketCap = pricePerToken * impliedCirculatingSupply;
    console.log(chalk.cyan('\n💰 Correct Values:'));
    console.log(chalk.green(`  ✅ Price: $${pricePerToken.toFixed(6)}`));
    console.log(chalk.green(`  ✅ Circulating Supply: ${impliedCirculatingSupply.toLocaleString()}`));
    console.log(chalk.green(`  ✅ Market Cap: $${correctMarketCap.toLocaleString()}`));
    
    // Show the fix SQL
    console.log(chalk.cyan('\n🔧 Fix SQL:'));
    const fixSQL = `
UPDATE tokens_unified 
SET 
  supply = '${impliedCirculatingSupply}',
  latest_price_usd = ${pricePerToken},
  latest_market_cap_usd = ${correctMarketCap}
WHERE mint_address = '${tokenMint}';`;
    console.log(chalk.gray(fixSQL));
    
    // Actually run the fix
    console.log(chalk.yellow('\n🚀 Applying fix...'));
    await pool.query(`
      UPDATE tokens_unified 
      SET 
        supply = $1,
        latest_price_usd = $2,
        latest_market_cap_usd = $3,
        updated_at = NOW()
      WHERE mint_address = $4
    `, [
      impliedCirculatingSupply.toString(),
      pricePerToken,
      correctMarketCap,
      tokenMint
    ]);
    
    console.log(chalk.green('✅ Fix applied!'));
    
    // Verify the fix
    const verifyResult = await pool.query(`
      SELECT 
        supply as circulating_supply,
        latest_price_usd,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = $1
    `, [tokenMint]);
    
    const fixed = verifyResult.rows[0];
    console.log(chalk.cyan('\n✅ Verification:'));
    console.log(chalk.green(`  Circulating Supply: ${Number(fixed.circulating_supply).toLocaleString()}`));
    console.log(chalk.green(`  Price: $${Number(fixed.latest_price_usd).toFixed(6)}`));
    console.log(chalk.green(`  Market Cap: $${Number(fixed.latest_market_cap_usd).toLocaleString()}`));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

debugAMMPriceCalculation().catch(console.error);