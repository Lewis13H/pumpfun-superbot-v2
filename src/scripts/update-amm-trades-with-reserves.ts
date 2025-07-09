import { Pool } from 'pg';
import dotenv from 'dotenv';
import axios from 'axios';
import { PriceCalculator } from '../services/pricing/price-calculator';

dotenv.config();

interface PoolData {
  mint: string;
  virtualSolReserves: string;
  virtualTokenReserves: string;
}

async function fetchPoolData(mintAddress: string): Promise<PoolData | null> {
  try {
    const shyftApiKey = process.env.SHYFT_API_KEY;
    if (!shyftApiKey) {
      console.error('SHYFT_API_KEY not found in environment');
      return null;
    }

    // Query to get AMM pool data
    const query = `
      query GetAmmPoolByMint($mint: String!) {
        pump_fun_amm_Pool(
          where: { quote_mint: { _eq: $mint } }
          limit: 1
        ) {
          pubkey
          base_mint
          quote_mint
          pool_base_token_account
          pool_quote_token_account
          lp_supply
          _updatedAt
        }
      }
    `;

    const response = await axios.post(
      'https://graphigo.prd.space.id/query',
      {
        query,
        variables: { mint: mintAddress }
      },
      {
        headers: {
          'x-api-key': shyftApiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    const pools = response.data?.data?.pump_fun_amm_Pool;
    if (!pools || pools.length === 0) {
      return null;
    }

    const pool = pools[0];
    
    // Now fetch the actual token account balances
    const accountQuery = `
      query GetTokenAccounts($accounts: [String!]!) {
        spl_Account(
          where: {
            pubkey: { _in: $accounts }
          }
        ) {
          pubkey
          amount
          mint
        }
      }
    `;
    
    const accountResponse = await axios.post(
      'https://graphigo.prd.space.id/query',
      {
        query: accountQuery,
        variables: { 
          accounts: [pool.pool_base_token_account, pool.pool_quote_token_account]
        }
      },
      {
        headers: {
          'x-api-key': shyftApiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const accounts = accountResponse.data?.data?.spl_Account;
    if (!accounts || accounts.length < 2) {
      return null;
    }
    
    // SOL is the base, token is the quote
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    let solReserves = '0';
    let tokenReserves = '0';
    
    for (const account of accounts) {
      if (account.mint === SOL_MINT) {
        solReserves = account.amount;
      } else {
        tokenReserves = account.amount;
      }
    }
    
    return {
      mint: mintAddress,
      virtualSolReserves: solReserves,
      virtualTokenReserves: tokenReserves
    };
  } catch (error: any) {
    console.error('Error fetching pool data:', error.response?.data || error.message);
    return null;
  }
}

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
  console.log('🔧 Updating AMM Trades with Pool Reserves\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  const priceCalculator = new PriceCalculator();
  
  try {
    // Get all AMM trades without reserves
    const tradesResult = await pool.query(`
      SELECT DISTINCT ON (mint_address) 
        signature, mint_address, program, trade_type,
        sol_amount, token_amount, price_sol, price_usd,
        virtual_sol_reserves, virtual_token_reserves
      FROM trades_unified
      WHERE program = 'amm_pool'
        AND (virtual_sol_reserves IS NULL OR virtual_token_reserves IS NULL)
      ORDER BY mint_address, block_time DESC
    `);
    
    console.log(`Found ${tradesResult.rows.length} AMM trades without reserves\n`);
    
    if (tradesResult.rows.length === 0) {
      console.log('No AMM trades need updating');
      return;
    }
    
    const solPrice = await getSolPrice();
    console.log(`Current SOL Price: $${solPrice}\n`);
    
    let updated = 0;
    let failed = 0;
    
    for (const trade of tradesResult.rows) {
      console.log(`Processing ${trade.mint_address}...`);
      
      // Fetch pool data
      const poolData = await fetchPoolData(trade.mint_address);
      
      if (!poolData) {
        console.log(`  ❌ No pool data found`);
        failed++;
        continue;
      }
      
      console.log(`  SOL Reserves: ${Number(poolData.virtualSolReserves) / 1e9} SOL`);
      console.log(`  Token Reserves: ${Number(poolData.virtualTokenReserves) / 1e9} tokens`);
      
      // Calculate correct market cap
      const priceInfo = priceCalculator.calculatePrice({
        solReserves: BigInt(poolData.virtualSolReserves),
        tokenReserves: BigInt(poolData.virtualTokenReserves),
        isVirtual: false
      }, solPrice, true); // true for AMM token
      
      console.log(`  Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`);
      
      // Update the trade
      await pool.query(`
        UPDATE trades_unified
        SET 
          virtual_sol_reserves = $1,
          virtual_token_reserves = $2,
          market_cap_usd = $3
        WHERE mint_address = $4 
          AND program = 'amm_pool'
      `, [
        poolData.virtualSolReserves,
        poolData.virtualTokenReserves,
        priceInfo.marketCapUsd,
        trade.mint_address
      ]);
      
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
        trade.mint_address
      ]);
      
      console.log(`  ✅ Updated successfully\n`);
      updated++;
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  Total trades: ${tradesResult.rows.length}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Failed: ${failed}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);