/**
 * Check Current IPO Token Status
 * Verify our calculations against current market data
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'CheckIPOStatus', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function checkStatus() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    logger.info(`Reported market cap: $3,000,000`);
    
    // Get latest data
    const tokenResult = await db.query(`
      SELECT 
        name,
        symbol,
        latest_market_cap_usd,
        latest_virtual_sol_reserves,
        latest_virtual_token_reserves,
        graduated_to_amm,
        updated_at
      FROM tokens_unified
      WHERE mint_address = $1
    `, [MINT]);
    
    if (tokenResult.rows.length === 0) {
      logger.error('Token not found');
      return;
    }
    
    const token = tokenResult.rows[0];
    logger.info('\nToken info:', {
      name: token.name,
      symbol: token.symbol,
      graduated: token.graduated_to_amm,
      lastUpdate: token.updated_at
    });
    
    // Get latest trade
    const tradeResult = await db.query(`
      SELECT 
        signature,
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount,
        trade_type,
        price_usd,
        market_cap_usd,
        block_time
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    if (tradeResult.rows.length > 0) {
      const trade = tradeResult.rows[0];
      logger.info('\nLatest AMM trade:', {
        signature: trade.signature.substring(0, 20) + '...',
        type: trade.trade_type,
        blockTime: new Date(trade.block_time * 1000).toISOString()
      });
      
      // Analyze reserves
      const solReserves = BigInt(trade.virtual_sol_reserves || '0');
      const tokenReserves = BigInt(trade.virtual_token_reserves || '0');
      
      logger.info('\nReserve analysis:');
      logger.info(`  SOL: ${(Number(solReserves) / 1e9).toFixed(4)} SOL`);
      logger.info(`  Tokens: ${(Number(tokenReserves) / 1e6).toLocaleString()} tokens`);
      
      // Price calculation
      const priceFromReserves = (Number(solReserves) / 1e9) / (Number(tokenReserves) / 1e6) * solPrice;
      logger.info(`  Price from reserves: $${priceFromReserves.toFixed(9)}`);
      logger.info(`  Price in trade: $${trade.price_usd || 'N/A'}`);
      
      // Market cap calculations
      logger.info('\nMarket cap analysis:');
      logger.info(`  Our calculation: $${Number(trade.market_cap_usd).toLocaleString()}`);
      logger.info(`  Token table: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
      logger.info(`  Reported: $3,000,000`);
      
      // Calculate what the reserves should be for $3M market cap
      const targetMarketCap = 3_000_000;
      const circulatingSupply = 800_000_000; // 800M from BC
      const requiredPrice = targetMarketCap / circulatingSupply;
      const requiredSolPerToken = requiredPrice / solPrice;
      const requiredSolReserves = requiredSolPerToken * (Number(tokenReserves) / 1e6);
      
      logger.info('\nFor $3M market cap:');
      logger.info(`  Required price: $${requiredPrice.toFixed(9)}`);
      logger.info(`  Required SOL reserves: ${requiredSolReserves.toFixed(4)} SOL`);
      logger.info(`  Actual SOL reserves: ${(Number(solReserves) / 1e9).toFixed(4)} SOL`);
      logger.info(`  Difference: ${((Number(solReserves) / 1e9) / requiredSolReserves).toFixed(2)}x`);
      
      // Check if we're using the wrong circulating supply
      const impliedCirculating = targetMarketCap / priceFromReserves;
      logger.info(`\nImplied circulating supply for $3M: ${impliedCirculating.toLocaleString()} tokens`);
      
      // Maybe the issue is with how we calculate circulating supply
      logger.info('\nCirculating supply scenarios:');
      const scenarios = [
        { name: '800M (BC only)', supply: 800_000_000 },
        { name: '1B (total)', supply: 1_000_000_000 },
        { name: '200M (AMM only)', supply: 200_000_000 },
        { name: 'Implied from $3M', supply: impliedCirculating }
      ];
      
      for (const scenario of scenarios) {
        const mcap = priceFromReserves * scenario.supply;
        logger.info(`  ${scenario.name}: $${mcap.toLocaleString()}`);
      }
    }
    
  } catch (error) {
    logger.error('Check failed', error as Error);
  }
}

checkStatus()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });