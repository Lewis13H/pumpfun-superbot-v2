/**
 * Fix AMM Reserves
 * Backfill reserves for existing AMM trades
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import axios from 'axios';
import { PriceCalculator } from '../services/pricing/price-calculator';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FixAmmReserves', color: chalk.cyan });

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const SHYFT_API_KEY = process.env.SHYFT_API_KEY || '';

interface TokenBalance {
  mint: string;
  owner: string;
  amount: string;
  decimals: number;
}

async function getTransactionDetails(signature: string): Promise<any> {
  try {
    // Try Helius first
    if (HELIUS_API_KEY) {
      const response = await axios.post(
        `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`,
        {
          transactions: [signature]
        }
      );
      
      if (response.data && response.data.length > 0) {
        return response.data[0];
      }
    }
    
    // Fallback to Shyft
    if (SHYFT_API_KEY) {
      const response = await axios.get(
        `https://api.shyft.to/sol/v1/transaction/parsed`,
        {
          params: {
            txn_signature: signature,
            network: 'mainnet-beta'
          },
          headers: {
            'x-api-key': SHYFT_API_KEY
          }
        }
      );
      
      if (response.data.success) {
        return response.data.result;
      }
    }
    
    return null;
  } catch (error) {
    logger.error(`Failed to fetch transaction ${signature}`, error as Error);
    return null;
  }
}

async function extractReservesFromTransaction(tx: any, mintAddress: string): Promise<{
  solReserves: bigint;
  tokenReserves: bigint;
} | null> {
  try {
    // Look for post token balances
    const postBalances: TokenBalance[] = tx.tokenBalanceChanges || tx.postTokenBalances || [];
    
    // Find pool balances (high balance accounts)
    const poolBalances = postBalances.filter((balance: TokenBalance) => {
      const amount = BigInt(balance.amount || '0');
      return amount > 1000000n; // Significant balances
    });
    
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    let solReserves = 0n;
    let tokenReserves = 0n;
    
    for (const balance of poolBalances) {
      const amount = BigInt(balance.amount || '0');
      
      if (balance.mint === SOL_MINT) {
        solReserves = amount;
      } else if (balance.mint === mintAddress) {
        tokenReserves = amount;
      }
    }
    
    if (solReserves > 0n && tokenReserves > 0n) {
      return { solReserves, tokenReserves };
    }
    
    // Alternative: look at account inputs/outputs
    if (tx.accountData) {
      for (const account of tx.accountData) {
        if (account.tokenBalanceChanges) {
          // Similar logic for account balance changes
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to extract reserves', error as Error);
    return null;
  }
}

async function fixAmmReserves() {
  try {
    // Get all AMM trades without reserves
    const result = await db.query(`
      SELECT id, signature, mint_address, sol_amount, token_amount, slot
      FROM trades_unified
      WHERE program = 'amm_pool'
        AND (virtual_sol_reserves IS NULL OR virtual_token_reserves IS NULL)
      ORDER BY block_time DESC
    `);
    
    logger.info(`Found ${result.rows.length} AMM trades without reserves`);
    
    const priceCalculator = new PriceCalculator();
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    
    logger.info(`Current SOL price: $${solPrice}`);
    let fixed = 0;
    
    for (const trade of result.rows) {
      logger.info(`Processing trade ${trade.signature.substring(0, 10)}...`);
      
      // Fetch transaction details
      const txDetails = await getTransactionDetails(trade.signature);
      
      if (txDetails) {
        const reserves = await extractReservesFromTransaction(txDetails, trade.mint_address);
        
        if (reserves) {
          // Calculate market cap with proper reserves
          const priceInfo = priceCalculator.calculatePrice(
            {
              solReserves: reserves.solReserves,
              tokenReserves: reserves.tokenReserves,
              isVirtual: true
            },
            solPrice,
            true // isAMM
          );
          
          // Update the trade
          await db.query(`
            UPDATE trades_unified
            SET 
              virtual_sol_reserves = $2,
              virtual_token_reserves = $3,
              market_cap_usd = $4
            WHERE id = $1
          `, [
            trade.id,
            reserves.solReserves.toString(),
            reserves.tokenReserves.toString(),
            priceInfo.marketCapUsd
          ]);
          
          logger.info(`✅ Fixed reserves for ${trade.mint_address}`, {
            solReserves: reserves.solReserves.toString(),
            tokenReserves: reserves.tokenReserves.toString(),
            marketCap: priceInfo.marketCapUsd
          });
          
          fixed++;
        } else {
          // Use estimation fallback
          const solAmount = BigInt(trade.sol_amount);
          const tokenAmount = BigInt(trade.token_amount);
          
          if (solAmount > 0n && tokenAmount > 0n) {
            // Estimate pool size (assume 1% trade impact)
            const estimatedSolReserves = solAmount * 100n;
            const estimatedTokenReserves = tokenAmount * 100n;
            
            const priceInfo = priceCalculator.calculatePrice(
              {
                solReserves: estimatedSolReserves,
                tokenReserves: estimatedTokenReserves,
                isVirtual: true
              },
              solPrice,
              true
            );
            
            await db.query(`
              UPDATE trades_unified
              SET 
                virtual_sol_reserves = $2,
                virtual_token_reserves = $3,
                market_cap_usd = $4
              WHERE id = $1
            `, [
              trade.id,
              estimatedSolReserves.toString(),
              estimatedTokenReserves.toString(),
              priceInfo.marketCapUsd
            ]);
            
            logger.info(`⚠️  Used estimated reserves for ${trade.mint_address}`);
            fixed++;
          }
        }
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    logger.info(`✅ Fixed ${fixed} out of ${result.rows.length} trades`);
    
    // Update token market caps
    logger.info('Updating token market caps...');
    
    await db.query(`
      UPDATE tokens_unified t
      SET 
        latest_market_cap_usd = (
          SELECT market_cap_usd 
          FROM trades_unified tr
          WHERE tr.mint_address = t.mint_address
            AND tr.program = 'amm_pool'
          ORDER BY tr.block_time DESC
          LIMIT 1
        ),
        latest_virtual_sol_reserves = (
          SELECT virtual_sol_reserves::numeric
          FROM trades_unified tr
          WHERE tr.mint_address = t.mint_address
            AND tr.program = 'amm_pool'
          ORDER BY tr.block_time DESC
          LIMIT 1
        ),
        latest_virtual_token_reserves = (
          SELECT virtual_token_reserves::numeric
          FROM trades_unified tr
          WHERE tr.mint_address = t.mint_address
            AND tr.program = 'amm_pool'
          ORDER BY tr.block_time DESC
          LIMIT 1
        ),
        updated_at = NOW()
      WHERE graduated_to_amm = true
        AND EXISTS (
          SELECT 1 FROM trades_unified tr 
          WHERE tr.mint_address = t.mint_address 
            AND tr.program = 'amm_pool'
        )
    `);
    
    logger.info('✅ Token market caps updated');
    
  } catch (error) {
    logger.error('Failed to fix AMM reserves', error as Error);
  }
}

fixAmmReserves()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });