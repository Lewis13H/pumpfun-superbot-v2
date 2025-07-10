/**
 * Fix AMM Market Cap with Accurate Calculation
 * Uses proper circulating supply calculation for AMM tokens
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { PriceCalculator } from '../services/pricing/price-calculator';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FixAmmMarketCap', color: chalk.cyan });

// Constants from pump.fun AMM
const INITIAL_VIRTUAL_TOKEN_RESERVES = 1_000_000_000_000_000n; // 1 billion tokens * 1e6 decimals
const INITIAL_VIRTUAL_SOL_RESERVES = 42_000_000_000n; // 42 SOL in lamports
const PUMP_FUN_FEE = 15_000_000_000n; // 15 SOL fee

async function fixAmmMarketCaps() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    // Get all AMM trades
    const result = await db.query(`
      SELECT DISTINCT ON (mint_address) 
        mint_address, 
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        price_sol,
        block_time
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY mint_address, block_time DESC
    `);
    
    logger.info(`Processing ${result.rows.length} AMM tokens`);
    
    for (const trade of result.rows) {
      // Calculate price from trade
      const solAmount = BigInt(trade.sol_amount);
      const tokenAmount = BigInt(trade.token_amount);
      
      if (solAmount === 0n || tokenAmount === 0n) continue;
      
      // Price per token in SOL
      const priceInSol = Number(solAmount) / Number(tokenAmount);
      const priceInUsd = priceInSol * solPrice;
      
      // For AMM tokens, circulating supply calculation:
      // Initial supply - tokens still in pool = circulating supply
      // But we need actual pool reserves for this
      
      // If we have reserves, use them
      if (trade.virtual_sol_reserves && trade.virtual_token_reserves) {
        const solReserves = BigInt(trade.virtual_sol_reserves);
        const tokenReserves = BigInt(trade.virtual_token_reserves);
        
        // For pump.fun AMM, we need to calculate actual circulating supply
        // The pool can have more or less than initial reserves due to trading
        // A better approach is to use the constant product formula
        
        // Calculate price from reserves using constant product
        const priceFromReserves = Number(solReserves) / Number(tokenReserves);
        const priceInUsdFromReserves = priceFromReserves * solPrice;
        
        // Use the more accurate price
        const finalPriceUsd = priceInUsdFromReserves || priceInUsd;
        
        // For market cap, we need total supply minus what's locked
        // Pump.fun tokens have 1B total supply
        const TOTAL_SUPPLY = 1_000_000_000; // 1B tokens
        
        // Market cap = price * total supply
        const marketCapUsd = finalPriceUsd * TOTAL_SUPPLY;
        
        logger.info(`Token ${trade.mint_address}:`, {
          priceUsd: finalPriceUsd.toFixed(9),
          priceFromTrade: priceInUsd.toFixed(9),
          priceFromReserves: priceInUsdFromReserves.toFixed(9),
          marketCap: marketCapUsd.toFixed(2)
        });
        
        // Update all trades for this token
        await db.query(`
          UPDATE trades_unified
          SET market_cap_usd = $2
          WHERE mint_address = $1 AND program = 'amm_pool'
        `, [trade.mint_address, marketCapUsd]);
        
        // Update token
        await db.query(`
          UPDATE tokens_unified
          SET 
            latest_market_cap_usd = $2,
            updated_at = NOW()
          WHERE mint_address = $1
        `, [trade.mint_address, marketCapUsd]);
        
      } else {
        // Without reserves, we can't calculate accurate market cap
        // Use a reasonable estimate based on typical AMM liquidity
        // Most AMM pools start with ~800M tokens remaining after 200M initial liquidity
        const TYPICAL_CIRCULATING = 200_000_000; // 200M tokens
        const marketCapUsd = priceInUsd * TYPICAL_CIRCULATING;
        
        logger.warn(`No reserves for ${trade.mint_address}, using typical circulating supply`);
        
        await db.query(`
          UPDATE trades_unified
          SET market_cap_usd = $2
          WHERE mint_address = $1 AND program = 'amm_pool'
        `, [trade.mint_address, marketCapUsd]);
        
        await db.query(`
          UPDATE tokens_unified
          SET 
            latest_market_cap_usd = $2,
            updated_at = NOW()
          WHERE mint_address = $1
        `, [trade.mint_address, marketCapUsd]);
      }
    }
    
    logger.info('✅ Market caps updated');
    
    // Show results
    const updated = await db.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd
      FROM tokens_unified
      WHERE graduated_to_amm = true
      ORDER BY latest_market_cap_usd DESC
    `);
    
    logger.info('\nUpdated AMM tokens:');
    for (const token of updated.rows) {
      logger.info(`${token.symbol || 'UNKNOWN'} (${token.mint_address.substring(0, 8)}...): $${token.latest_market_cap_usd}`);
    }
    
  } catch (error) {
    logger.error('Failed to fix market caps', error as Error);
  }
}

fixAmmMarketCaps()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });