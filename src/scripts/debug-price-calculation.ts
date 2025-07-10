/**
 * Debug Price Calculation
 * Find the decimal issue in our price calculation
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger({ context: 'DebugPrice', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function debugPrice() {
  try {
    // Get the trade
    const result = await db.query(`
      SELECT 
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        price_sol,
        price_usd,
        trade_type
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    const trade = result.rows[0];
    const solReserves = BigInt(trade.virtual_sol_reserves);
    const tokenReserves = BigInt(trade.virtual_token_reserves);
    const solAmount = BigInt(trade.sol_amount);
    const tokenAmount = BigInt(trade.token_amount);
    
    logger.info('Raw values:', {
      solReserves: solReserves.toString(),
      tokenReserves: tokenReserves.toString(),
      solAmount: solAmount.toString(),
      tokenAmount: tokenAmount.toString()
    });
    
    // Different decimal scenarios
    logger.info('\n=== PRICE CALCULATIONS ===');
    
    // Scenario 1: Both use standard decimals (9 for SOL, 6 for token)
    const price1 = (Number(solReserves) / 1e9) / (Number(tokenReserves) / 1e6);
    logger.info(`Standard decimals (9,6): $${price1.toFixed(9)} per token`);
    
    // Scenario 2: Token might have 9 decimals like SOL
    const price2 = (Number(solReserves) / 1e9) / (Number(tokenReserves) / 1e9);
    logger.info(`Both 9 decimals: $${price2.toFixed(9)} per token`);
    
    // Scenario 3: Raw values (no decimal adjustment)
    const price3 = Number(solReserves) / Number(tokenReserves);
    logger.info(`Raw ratio: $${price3.toFixed(9)} per token`);
    
    // Check trade price calculation
    logger.info('\n=== TRADE PRICE ===');
    const tradePrice = Number(solAmount) / Number(tokenAmount);
    logger.info(`Trade raw ratio: ${tradePrice.toFixed(9)}`);
    logger.info(`Trade price stored: ${trade.price_sol}`);
    logger.info(`Trade price USD stored: ${trade.price_usd}`);
    
    // What if reserves are already adjusted for decimals?
    logger.info('\n=== RESERVES ALREADY ADJUSTED? ===');
    // If reserves are already in whole units (not lamports/smallest unit)
    const price4 = Number(solReserves) / Number(tokenReserves) * 153.89; // SOL price
    logger.info(`If reserves are whole units: $${price4.toFixed(9)} per token`);
    
    // Check the actual token reserves value
    logger.info('\n=== TOKEN RESERVES ANALYSIS ===');
    const tokensWithDecimals = Number(tokenReserves) / 1e6;
    logger.info(`Tokens (6 decimals): ${tokensWithDecimals.toLocaleString()}`);
    logger.info(`Tokens (9 decimals): ${(Number(tokenReserves) / 1e9).toLocaleString()}`);
    logger.info(`Tokens (raw): ${tokenReserves.toString()}`);
    
    // The issue might be that virtual reserves are stored differently
    logger.info('\n=== VIRTUAL VS ACTUAL ===');
    logger.info('pump.fun initial virtual reserves:');
    logger.info('  SOL: 42 SOL (42,000,000,000 lamports)');
    logger.info('  Tokens: 1B tokens (1,000,000,000,000,000 with 6 decimals)');
    
    // Our reserves show 42.1466 SOL and 996M tokens
    // This looks correct for virtual reserves
    
    // The price calculation should be:
    const correctPrice = (Number(solReserves) / 1e9) / (Number(tokenReserves) / 1e6) * 153.89;
    logger.info(`\nCorrect calculation: ${(Number(solReserves) / 1e9).toFixed(4)} SOL / ${(Number(tokenReserves) / 1e6).toFixed(0)} tokens * $153.89 = $${correctPrice.toFixed(9)}`);
    
    // But the stored price is 1000x higher
    const ratio = Number(trade.price_usd) / correctPrice;
    logger.info(`\nStored price is ${ratio.toFixed(1)}x our calculation`);
    
    // Check if pump.fun tokens actually have 3 decimals instead of 6
    logger.info('\n=== DECIMAL POSSIBILITIES ===');
    for (let decimals = 0; decimals <= 9; decimals++) {
      const price = (Number(solReserves) / 1e9) / (Number(tokenReserves) / Math.pow(10, decimals)) * 153.89;
      const marketCap = price * 800_000_000;
      logger.info(`${decimals} decimals: $${price.toFixed(6)}/token, Market cap: $${marketCap.toLocaleString()}`);
    }
    
  } catch (error) {
    logger.error('Debug failed', error as Error);
  }
}

debugPrice()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });