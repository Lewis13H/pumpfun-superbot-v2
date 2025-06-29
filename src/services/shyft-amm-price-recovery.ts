/**
 * Shyft AMM Price Recovery Service
 * Uses Shyft GraphQL to fetch AMM pool data and token account balances
 */

import { ShyftGraphQLClient } from './graphql-client';
import { SolPriceService } from './sol-price';
import { db } from '../database';
import chalk from 'chalk';
import { gql } from 'graphql-request';

// Get AMM pools where base_mint is the token (not SOL)
const GET_AMM_POOLS_BY_TOKEN = gql`
  query GetAmmPoolsByToken($mints: [String!]!) {
    pump_fun_amm_Pool(
      where: {
        _or: [
          { base_mint: { _in: $mints } },
          { quote_mint: { _in: $mints } }
        ]
      }
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

// Get token account balances
const GET_TOKEN_ACCOUNTS = gql`
  query GetTokenAccounts($accounts: [String!]!) {
    spl_Account(
      where: { pubkey: { _in: $accounts } }
    ) {
      pubkey
      mint
      amount
      _updatedAt
    }
  }
`;

interface AmmPoolData {
  pubkey: string;
  base_mint: string;
  quote_mint: string;
  pool_base_token_account: string;
  pool_quote_token_account: string;
  lp_supply: string;
  _updatedAt: string;
}

interface TokenAccountData {
  pubkey: string;
  mint: string;
  amount: string;
  _updatedAt: string;
}

export class ShyftAmmPriceRecovery {
  private static instance: ShyftAmmPriceRecovery;
  private client: ShyftGraphQLClient;
  private solPriceService: SolPriceService;
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  private constructor() {
    this.client = ShyftGraphQLClient.getInstance();
    this.solPriceService = SolPriceService.getInstance();
  }
  
  static getInstance(): ShyftAmmPriceRecovery {
    if (!ShyftAmmPriceRecovery.instance) {
      ShyftAmmPriceRecovery.instance = new ShyftAmmPriceRecovery();
    }
    return ShyftAmmPriceRecovery.instance;
  }
  
  /**
   * Recover AMM pool prices from Shyft
   */
  async recoverAmmPrices(tokenMints: string[]): Promise<{
    successful: any[];
    failed: any[];
  }> {
    const successful: any[] = [];
    const failed: any[] = [];
    
    console.log(chalk.blue(`🔍 Recovering AMM prices from Shyft for ${tokenMints.length} tokens...`));
    
    try {
      // Get AMM pools for these tokens
      const poolResponse = await this.client.query<{ pump_fun_amm_Pool: AmmPoolData[] }>(
        GET_AMM_POOLS_BY_TOKEN,
        { mints: tokenMints }
      );
      
      const pools = poolResponse.pump_fun_amm_Pool || [];
      console.log(chalk.gray(`Found ${pools.length} AMM pools`));
      
      if (pools.length === 0) {
        tokenMints.forEach(mint => {
          failed.push({
            mintAddress: mint,
            reason: 'No AMM pool found in Shyft',
          });
        });
        return { successful, failed };
      }
      
      // Collect all token accounts to query
      const tokenAccounts: string[] = [];
      const poolMap = new Map<string, { pool: AmmPoolData; tokenMint: string }>();
      
      for (const pool of pools) {
        tokenAccounts.push(pool.pool_base_token_account, pool.pool_quote_token_account);
        
        // Determine which is the token mint (not SOL)
        const tokenMint = pool.base_mint === this.SOL_MINT ? pool.quote_mint : pool.base_mint;
        poolMap.set(pool.pubkey, { pool, tokenMint });
      }
      
      // Get token account balances
      const accountResponse = await this.client.query<{ spl_Account: TokenAccountData[] }>(
        GET_TOKEN_ACCOUNTS,
        { accounts: tokenAccounts }
      );
      
      const accounts = accountResponse.spl_Account || [];
      const accountMap = new Map<string, string>();
      accounts.forEach(acc => accountMap.set(acc.pubkey, acc.amount));
      
      // Calculate prices
      const solPrice = await this.solPriceService.getPrice();
      
      for (const [poolAddress, { pool, tokenMint }] of poolMap.entries()) {
        try {
          // Determine which account is SOL and which is token
          let solReserves: bigint;
          let tokenReserves: bigint;
          
          if (pool.base_mint === this.SOL_MINT) {
            // Base is SOL, quote is token
            const baseAmount = accountMap.get(pool.pool_base_token_account);
            const quoteAmount = accountMap.get(pool.pool_quote_token_account);
            
            if (!baseAmount || !quoteAmount) {
              failed.push({
                mintAddress: tokenMint,
                reason: 'Missing reserve data from Shyft',
              });
              continue;
            }
            
            solReserves = BigInt(baseAmount);
            tokenReserves = BigInt(quoteAmount);
          } else {
            // Base is token, quote is SOL
            const baseAmount = accountMap.get(pool.pool_base_token_account);
            const quoteAmount = accountMap.get(pool.pool_quote_token_account);
            
            if (!baseAmount || !quoteAmount) {
              failed.push({
                mintAddress: tokenMint,
                reason: 'Missing reserve data from Shyft',
              });
              continue;
            }
            
            tokenReserves = BigInt(baseAmount);
            solReserves = BigInt(quoteAmount);
          }
          
          // Calculate price
          if (solReserves > 0n && tokenReserves > 0n) {
            const priceInSol = Number(solReserves) / 1e9 / (Number(tokenReserves) / 1e6);
            const priceInUsd = priceInSol * solPrice;
            const marketCapUsd = priceInUsd * 1e9; // Assuming 1B supply
            
            successful.push({
              mintAddress: tokenMint,
              poolAddress: pool.pubkey,
              priceInSol,
              priceInUsd,
              marketCapUsd,
              virtualSolReserves: solReserves,
              virtualTokenReserves: tokenReserves,
              lpSupply: BigInt(pool.lp_supply),
              lastUpdated: new Date(pool._updatedAt),
              source: 'shyft_amm',
            });
            
            // Save to amm_pool_states for future use
            await this.savePoolState(tokenMint, pool.pubkey, solReserves, tokenReserves);
          } else {
            failed.push({
              mintAddress: tokenMint,
              reason: 'Zero reserves',
            });
          }
        } catch (error) {
          failed.push({
            mintAddress: tokenMint,
            reason: `Processing error: ${error.message}`,
            error,
          });
        }
      }
      
      // Mark tokens without pools as failed
      const foundMints = new Set(Array.from(poolMap.values()).map(v => v.tokenMint));
      tokenMints.forEach(mint => {
        if (!foundMints.has(mint)) {
          failed.push({
            mintAddress: mint,
            reason: 'No AMM pool found',
          });
        }
      });
      
    } catch (error) {
      console.error(chalk.red('Error recovering AMM prices from Shyft:'), error);
      tokenMints.forEach(mint => {
        failed.push({
          mintAddress: mint,
          reason: `Query error: ${error.message}`,
          error,
        });
      });
    }
    
    // Update database with successful recoveries
    if (successful.length > 0) {
      await this.updateTokenPrices(successful);
    }
    
    console.log(chalk.green(`✅ Recovered ${successful.length} prices, ${failed.length} failed`));
    
    return { successful, failed };
  }
  
  /**
   * Save pool state for future use
   */
  private async savePoolState(
    mintAddress: string,
    poolAddress: string,
    solReserves: bigint,
    tokenReserves: bigint
  ): Promise<void> {
    try {
      await db.query(`
        INSERT INTO amm_pool_states (
          mint_address,
          pool_address,
          virtual_sol_reserves,
          virtual_token_reserves,
          pool_open,
          slot,
          created_at
        ) VALUES ($1, $2, $3, $4, true, 0, NOW())
        ON CONFLICT (mint_address, pool_address, created_at) DO NOTHING
      `, [
        mintAddress,
        poolAddress,
        solReserves.toString(),
        tokenReserves.toString(),
      ]);
    } catch (error) {
      console.error(chalk.red('Error saving pool state:'), error);
    }
  }
  
  /**
   * Update token prices in database
   */
  private async updateTokenPrices(priceUpdates: any[]): Promise<void> {
    const updateTime = new Date();
    
    const values = priceUpdates.map(update => [
      update.mintAddress,
      update.priceInSol,
      update.priceInUsd,
      update.marketCapUsd,
      update.source,
      updateTime,
    ]);
    
    try {
      await db.query(`
        UPDATE tokens_unified
        SET 
          latest_price_sol = v.price_sol,
          latest_price_usd = v.price_usd,
          latest_market_cap_usd = v.market_cap,
          price_source = v.source,
          updated_at = v.update_time
        FROM (
          VALUES ${values.map((_, i) => 
            `($${i * 6 + 1}, $${i * 6 + 2}::numeric, $${i * 6 + 3}::numeric, $${i * 6 + 4}::numeric, $${i * 6 + 5}::text, $${i * 6 + 6}::timestamp)`
          ).join(', ')}
        ) AS v(mint_address, price_sol, price_usd, market_cap, source, update_time)
        WHERE tokens_unified.mint_address = v.mint_address
      `, values.flat());
      
      console.log(chalk.green(`✅ Updated ${priceUpdates.length} token prices from Shyft AMM data`));
    } catch (error) {
      console.error(chalk.red('Failed to update token prices:'), error);
    }
  }
}