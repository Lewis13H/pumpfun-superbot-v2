import { Pool } from 'pg';
import dotenv from 'dotenv';
import { AmmReservesFetcher } from '../services/amm/amm-reserves-fetcher';
import { PriceCalculator } from '../services/pricing/price-calculator';
import axios from 'axios';

dotenv.config();

async function getSolPrice(): Promise<number> {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    return response.data.solana.usd;
  } catch (error) {
    console.error('Failed to get SOL price:', error);
    return 246.5; // fallback
  }
}

async function main() {
  console.log('🔧 Fixing AMM Market Cap for Token\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  const reservesFetcher = AmmReservesFetcher.getInstance();
  const priceCalculator = new PriceCalculator();
  
  try {
    const mintAddress = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';
    
    // Get current token data
    const tokenResult = await pool.query(`
      SELECT mint_address, symbol, name, latest_price_usd
      FROM tokens_unified
      WHERE mint_address = $1
    `, [mintAddress]);
    
    if (tokenResult.rows.length === 0) {
      console.error('Token not found');
      return;
    }
    
    const token = tokenResult.rows[0];
    console.log(`Token: ${token.symbol || 'Unknown'} (${mintAddress})`);
    console.log(`Current price: $${token.latest_price_usd}`);
    
    // Fetch AMM reserves
    console.log('\nFetching AMM reserves...');
    const reserves = await reservesFetcher.fetchReservesForToken(mintAddress);
    
    if (!reserves || !reserves.solReserves || !reserves.tokenReserves) {
      console.error('Failed to fetch reserves');
      return;
    }
    
    console.log(`SOL Reserves: ${Number(reserves.solReserves) / 1e9} SOL`);
    console.log(`Token Reserves: ${Number(reserves.tokenReserves) / 1e9} tokens`);
    
    // Get current SOL price
    const solPrice = await getSolPrice();
    console.log(`SOL Price: $${solPrice}`);
    
    // Calculate correct price and market cap
    const priceInfo = priceCalculator.calculatePrice({
      solReserves: BigInt(reserves.solReserves),
      tokenReserves: BigInt(reserves.tokenReserves),
      isVirtual: false
    }, solPrice, true); // true for AMM token
    
    console.log(`\nCalculated Price: $${priceInfo.priceInUsd.toFixed(6)}`);
    console.log(`Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`);
    
    // Update the token
    await pool.query(`
      UPDATE tokens_unified
      SET 
        latest_price_sol = $1,
        latest_price_usd = $2,
        latest_market_cap_usd = $3,
        last_updated = NOW()
      WHERE mint_address = $4
    `, [
      priceInfo.priceInSol,
      priceInfo.priceInUsd,
      priceInfo.marketCapUsd,
      mintAddress
    ]);
    
    // Also update the latest AMM trade with reserves
    await pool.query(`
      UPDATE trades_unified
      SET 
        virtual_sol_reserves = $1,
        virtual_token_reserves = $2,
        market_cap_usd = $3
      WHERE mint_address = $4 
        AND program = 'amm_pool'
        AND virtual_sol_reserves IS NULL
    `, [
      reserves.solReserves,
      reserves.tokenReserves,
      priceInfo.marketCapUsd,
      mintAddress
    ]);
    
    console.log('\n✅ Token market cap updated successfully!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);