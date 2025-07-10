/**
 * Investigate Market Cap Discrepancy
 * Compare our calculation with actual on-chain data
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'InvestigateMarketCap', color: chalk.cyan });

// IPO token
const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function investigate() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    // Get latest AMM trade
    const result = await db.query(`
      SELECT 
        mint_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        market_cap_usd,
        price_sol,
        price_usd,
        block_time,
        signature
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    if (result.rows.length === 0) {
      logger.error('No AMM trades found for token');
      return;
    }
    
    const trade = result.rows[0];
    logger.info('Latest AMM trade:', {
      signature: trade.signature.substring(0, 20) + '...',
      blockTime: new Date(trade.block_time * 1000).toISOString()
    });
    
    // Get token info
    const tokenResult = await db.query(`
      SELECT name, symbol, latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = $1
    `, [MINT]);
    
    const token = tokenResult.rows[0];
    logger.info('Token info:', token);
    
    // Analysis
    logger.info('\n=== MARKET CAP ANALYSIS ===');
    
    // 1. Our calculation
    const solReserves = BigInt(trade.virtual_sol_reserves || '0');
    const tokenReserves = BigInt(trade.virtual_token_reserves || '0');
    
    logger.info('Reserves:', {
      solReserves: `${Number(solReserves) / 1e9} SOL`,
      tokenReserves: `${Number(tokenReserves) / 1e6} tokens`
    });
    
    // Price from reserves
    const priceFromReserves = Number(solReserves) / Number(tokenReserves);
    const priceInUsdFromReserves = priceFromReserves * solPrice;
    
    // Different supply assumptions
    const TOTAL_SUPPLY_1B = 1_000_000_000; // 1B tokens
    const TOTAL_SUPPLY_10B = 10_000_000_000; // 10B tokens (maybe wrong decimals?)
    const TOTAL_SUPPLY_100M = 100_000_000; // 100M tokens
    
    logger.info('\nPrice calculations:');
    logger.info(`Price from reserves: $${priceInUsdFromReserves.toFixed(9)}`);
    logger.info(`Price from trade: $${trade.price_usd || 'N/A'}`);
    
    logger.info('\nMarket cap with different supplies:');
    logger.info(`With 1B supply: $${(priceInUsdFromReserves * TOTAL_SUPPLY_1B).toLocaleString()}`);
    logger.info(`With 10B supply: $${(priceInUsdFromReserves * TOTAL_SUPPLY_10B).toLocaleString()}`);
    logger.info(`With 100M supply: $${(priceInUsdFromReserves * TOTAL_SUPPLY_100M).toLocaleString()}`);
    
    logger.info('\nCurrent values:');
    logger.info(`Our market cap: $${Number(trade.market_cap_usd).toLocaleString()}`);
    logger.info(`Reported market cap: $3,900,000`);
    
    // Check if we're using wrong decimals
    const decimalsIssue = 3_900_000 / Number(trade.market_cap_usd);
    logger.info(`\nMultiplier difference: ${decimalsIssue.toFixed(2)}x`);
    
    // Maybe the issue is with token decimals?
    if (Math.abs(decimalsIssue - 10) < 2) {
      logger.warn('⚠️  Possible decimals issue - we might be off by 10x');
    } else if (Math.abs(decimalsIssue - 100) < 20) {
      logger.warn('⚠️  Possible decimals issue - we might be off by 100x');
    }
    
    // Check circulating vs total supply
    logger.info('\n=== SUPPLY ANALYSIS ===');
    
    // In AMM, tokens in pool are NOT circulating
    const tokensInPool = Number(tokenReserves) / 1e6;
    const circulatingSupply1B = TOTAL_SUPPLY_1B - tokensInPool;
    const circulatingSupply10B = TOTAL_SUPPLY_10B - tokensInPool;
    
    logger.info(`Tokens in pool: ${tokensInPool.toLocaleString()}`);
    logger.info(`Circulating (1B total): ${circulatingSupply1B.toLocaleString()}`);
    logger.info(`Circulating (10B total): ${circulatingSupply10B.toLocaleString()}`);
    
    // Market cap with circulating supply
    logger.info('\nMarket cap with circulating supply:');
    logger.info(`1B total: $${(priceInUsdFromReserves * circulatingSupply1B).toLocaleString()}`);
    logger.info(`10B total: $${(priceInUsdFromReserves * circulatingSupply10B).toLocaleString()}`);
    
    // What would the price need to be for $3.9M market cap?
    const requiredPrice1B = 3_900_000 / TOTAL_SUPPLY_1B;
    const requiredPrice10B = 3_900_000 / TOTAL_SUPPLY_10B;
    const requiredPriceCirculating = 3_900_000 / circulatingSupply1B;
    
    logger.info('\n=== REQUIRED PRICE FOR $3.9M MARKET CAP ===');
    logger.info(`With 1B total supply: $${requiredPrice1B.toFixed(6)}`);
    logger.info(`With 10B total supply: $${requiredPrice10B.toFixed(6)}`);
    logger.info(`With circulating supply: $${requiredPriceCirculating.toFixed(6)}`);
    logger.info(`Our calculated price: $${priceInUsdFromReserves.toFixed(6)}`);
    
    // Check if reserves might be wrong
    logger.info('\n=== RESERVES CHECK ===');
    const impliedSolReserves = (requiredPrice1B / solPrice) * Number(tokenReserves);
    logger.info(`For $3.9M market cap, SOL reserves should be: ${(impliedSolReserves / 1e9).toFixed(2)} SOL`);
    logger.info(`Actual SOL reserves: ${(Number(solReserves) / 1e9).toFixed(2)} SOL`);
    
  } catch (error) {
    logger.error('Investigation failed', error as Error);
  }
}

investigate()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });