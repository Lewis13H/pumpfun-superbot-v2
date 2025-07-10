/**
 * Calculate True Circulating Supply
 * Figure out the actual circulating supply for pump.fun graduated tokens
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger({ context: 'CirculatingSupply', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function calculateCirculating() {
  try {
    // From the Solscan data:
    // - Total supply: 1,000,000,000 tokens
    // - Token has 6 decimals
    
    // Get current data
    const result = await db.query(`
      SELECT 
        virtual_sol_reserves,
        virtual_token_reserves,
        price_usd
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    const trade = result.rows[0];
    const price = Number(trade.price_usd);
    const targetMarketCap = 3_000_000;
    
    logger.info('Current price per token: $' + price.toFixed(9));
    logger.info('Target market cap: $3,000,000');
    
    // Calculate implied circulating supply
    const impliedCirculating = targetMarketCap / price;
    logger.info(`\nImplied circulating supply: ${impliedCirculating.toLocaleString()} tokens`);
    logger.info(`As % of total supply: ${(impliedCirculating / 1_000_000_000 * 100).toFixed(2)}%`);
    
    // Analyze token distribution
    logger.info('\n=== TOKEN DISTRIBUTION ANALYSIS ===');
    
    // Virtual reserves tell us how many tokens are in the AMM pool
    const tokenReserves = BigInt(trade.virtual_token_reserves);
    // With 9 decimal precision for virtual reserves
    const tokensInPool = Number(tokenReserves) / 1e9;
    
    logger.info(`Tokens in AMM pool: ${tokensInPool.toLocaleString()}`);
    logger.info(`As % of total: ${(tokensInPool / 1_000_000_000 * 100).toFixed(2)}%`);
    
    // pump.fun token distribution:
    // - Bonding curve completes at ~84 SOL
    // - Initial price ~0.000000056 SOL/token
    // - Final BC price ~0.0000001 SOL/token
    // - Approximately 80-85% of tokens sold during BC
    
    logger.info('\n=== PUMP.FUN MODEL ===');
    const scenarios = [
      { name: 'If 80% sold in BC', bcSold: 0.80, ammInitial: 0.20 },
      { name: 'If 85% sold in BC', bcSold: 0.85, ammInitial: 0.15 },
      { name: 'If 90% sold in BC', bcSold: 0.90, ammInitial: 0.10 },
      { name: 'Implied from $3M', bcSold: impliedCirculating / 1_000_000_000, ammInitial: 0 }
    ];
    
    for (const scenario of scenarios) {
      const bcTokens = scenario.bcSold * 1_000_000_000;
      const ammInitialTokens = scenario.ammInitial * 1_000_000_000;
      const tokensOutOfPool = Math.max(0, ammInitialTokens - tokensInPool);
      const circulating = bcTokens + tokensOutOfPool;
      const marketCap = price * circulating;
      
      logger.info(`\n${scenario.name}:`);
      logger.info(`  BC tokens: ${(bcTokens / 1e6).toFixed(0)}M`);
      logger.info(`  AMM initial: ${(ammInitialTokens / 1e6).toFixed(0)}M`);
      logger.info(`  Circulating: ${(circulating / 1e6).toFixed(0)}M`);
      logger.info(`  Market cap: $${marketCap.toLocaleString()}`);
      logger.info(`  vs Target: ${(marketCap / targetMarketCap).toFixed(2)}x`);
    }
    
    // The most likely scenario
    logger.info('\n=== CONCLUSION ===');
    const likelyCirculating = impliedCirculating;
    const likelyBcPercent = likelyCirculating / 1_000_000_000;
    
    logger.info(`For $3M market cap at current price:`);
    logger.info(`- Circulating supply: ${(likelyCirculating / 1e6).toFixed(0)}M tokens (${(likelyBcPercent * 100).toFixed(1)}%)`);
    logger.info(`- This suggests ~${(likelyBcPercent * 100).toFixed(0)}% of tokens were sold in bonding curve`);
    
    // Update our calculation
    logger.info('\n=== UPDATING MARKET CAP ===');
    const newMarketCap = price * likelyCirculating;
    
    await db.query(`
      UPDATE trades_unified
      SET market_cap_usd = $2
      WHERE mint_address = $1 AND program = 'amm_pool'
    `, [MINT, newMarketCap]);
    
    await db.query(`
      UPDATE tokens_unified
      SET latest_market_cap_usd = $2
      WHERE mint_address = $1
    `, [MINT, newMarketCap]);
    
    logger.info(`✅ Updated market cap to: $${newMarketCap.toLocaleString()}`);
    
  } catch (error) {
    logger.error('Calculation failed', error as Error);
  }
}

calculateCirculating()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });