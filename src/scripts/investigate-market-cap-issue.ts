import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger('MarketCapInvestigation');

async function investigateMarketCap() {
  // Get current SOL price from database
  const solPriceResult = await db.query(`
    SELECT price FROM sol_prices 
    ORDER BY timestamp DESC 
    LIMIT 1
  `);
  
  const currentSolPrice = parseFloat(solPriceResult.rows[0]?.price || '150');
  
  // First token: 82cVoYetp2HsekHUrrmATyWPWR296JBN9akaY4F6hgBF (expected ~$44.9k)
  // Second token: 785n5QpqiPdNC8vhJpXkqz8fTzkgpX2bGsrbhnm6pump (expected $41k, shows $4.1k)
  const tokens = [
    // { mint: '82cVoYetp2HsekHUrrmATyWPWR296JBN9akaY4F6hgBF', expected: '$44.9k' },
    { mint: '785n5QpqiPdNC8vhJpXkqz8fTzkgpX2bGsrbhnm6pump', expected: '$41k' }
  ];
  
  for (const { mint: tokenMint, expected } of tokens) {
  
  logger.info('\n=== Market Cap Investigation ===');
  logger.info(`Token: ${tokenMint}`);
  logger.info(`Expected market cap: ${expected}`);
  
  // Show current SOL price
  logger.info(`\nCurrent SOL Price: $${currentSolPrice}`);
  
  // Get token info
  const tokenResult = await db.query(`
    SELECT * FROM tokens_unified 
    WHERE mint_address = $1
  `, [tokenMint]);
  
  const tokenInfo = tokenResult.rows[0];
  if (tokenInfo) {
    logger.info('\n=== Token Info from tokens_unified ===');
    logger.info(`Symbol: ${tokenInfo.symbol}`);
    logger.info(`Name: ${tokenInfo.name}`);
    logger.info(`Current Price SOL: ${tokenInfo.current_price_sol}`);
    logger.info(`Current Price USD: ${tokenInfo.current_price_usd}`);
    logger.info(`Latest Market Cap USD: ${tokenInfo.latest_market_cap_usd}`);
    logger.info(`FDV: ${tokenInfo.fdv}`);
    logger.info(`Graduated to AMM: ${tokenInfo.graduated_to_amm}`);
    logger.info(`Virtual SOL Reserves: ${tokenInfo.latest_virtual_sol_reserves}`);
    logger.info(`Virtual Token Reserves: ${tokenInfo.latest_virtual_token_reserves}`);
    logger.info(`Total Supply: ${tokenInfo.total_supply || '1,000,000,000'}`);
    logger.info(`Is AMM: ${tokenInfo.is_amm}`);
  } else {
    logger.error('Token not found in database!');
  }
  
  // Get latest trades
  const result = await db.query(`
    SELECT 
      block_time,
      trade_type,
      sol_amount,
      token_amount,
      price_sol,
      price_usd,
      market_cap_usd,
      bonding_curve_progress,
      virtual_sol_reserves,
      virtual_token_reserves,
      bonding_curve_key
    FROM trades_unified
    WHERE mint_address = $1
    ORDER BY block_time DESC
    LIMIT 10
  `, [tokenMint]);
  
  logger.info('\n=== Latest 10 Trades ===');
  logger.info('Time | Type | SOL Amount | Token Amount | Price SOL | Price USD | Market Cap | Progress');
  logger.info('-'.repeat(120));
  
  for (const trade of result.rows) {
    const time = new Date(trade.block_time).toLocaleTimeString();
    const type = trade.trade_type || 'UNKNOWN';
    const solAmount = parseFloat(trade.sol_amount).toFixed(4);
    const tokenAmount = parseFloat(trade.token_amount).toFixed(0);
    const priceSol = parseFloat(trade.price_sol).toFixed(9);
    const priceUsd = parseFloat(trade.price_usd).toFixed(9);
    const marketCap = trade.market_cap_usd ? `$${parseFloat(trade.market_cap_usd).toFixed(2)}` : 'NULL';
    const progress = trade.bonding_curve_progress ? `${parseFloat(trade.bonding_curve_progress).toFixed(2)}%` : 'NULL';
    
    logger.info(`${time} | ${type} | ${solAmount} | ${tokenAmount} | ${priceSol} | ${priceUsd} | ${marketCap} | ${progress}`);
  }
  
  // Calculate what the market cap should be
  if (result.rows.length > 0) {
    const latestTrade = result.rows[0];
    const priceSol = parseFloat(latestTrade.price_sol);
    const priceUsd = parseFloat(latestTrade.price_usd);
    
    logger.info('\n=== Market Cap Calculation Analysis ===');
    logger.info(`Latest Price SOL: ${priceSol}`);
    logger.info(`Latest Price USD: ${priceUsd}`);
    logger.info(`SOL Price Used: $${currentSolPrice}`);
    
    // Check if it's an AMM token by looking at bonding curve key
    const isAmm = !latestTrade.bonding_curve_key || latestTrade.bonding_curve_key === '11111111111111111111111111111111';
    logger.info(`Is AMM Token: ${isAmm} (BC Key: ${latestTrade.bonding_curve_key || 'NULL'})`);
    
    if (isAmm && latestTrade.virtual_token_reserves) {
      // For AMM tokens, market cap = price × tokens in pool
      const tokensInPool = parseFloat(latestTrade.virtual_token_reserves);
      const calculatedMarketCap = priceUsd * tokensInPool;
      logger.info(`\nAMM Token Calculation:`);
      logger.info(`Tokens in Pool: ${tokensInPool.toLocaleString()}`);
      logger.info(`Calculated Market Cap: $${calculatedMarketCap.toFixed(2)}`);
    } else {
      // For BC tokens, market cap = price × (total supply × 10%)
      const totalSupply = 1_000_000_000; // Standard pump.fun supply
      const circulatingSupply = totalSupply * 0.1; // 10% circulating
      const calculatedMarketCap = priceUsd * circulatingSupply;
      logger.info(`\nBC Token Calculation:`);
      logger.info(`Total Supply: ${totalSupply.toLocaleString()}`);
      logger.info(`Circulating Supply (10%): ${circulatingSupply.toLocaleString()}`);
      logger.info(`Calculated Market Cap: $${calculatedMarketCap.toFixed(2)}`);
    }
    
    // Check price calculation
    logger.info(`\nPrice Calculation Check:`);
    logger.info(`Price USD from trade: $${priceUsd}`);
    logger.info(`Price SOL × SOL Price: ${priceSol} × $${currentSolPrice} = $${(priceSol * currentSolPrice).toFixed(9)}`);
    
    // Check reserves if available
    if (latestTrade.virtual_sol_reserves && latestTrade.virtual_token_reserves) {
      const solReserves = parseFloat(latestTrade.virtual_sol_reserves);
      const tokenReserves = parseFloat(latestTrade.virtual_token_reserves);
      const priceFromReserves = solReserves / tokenReserves;
      logger.info(`\nReserve-based Price Check:`);
      logger.info(`SOL Reserves: ${solReserves}`);
      logger.info(`Token Reserves: ${tokenReserves.toLocaleString()}`);
      logger.info(`Price from Reserves: ${priceFromReserves.toFixed(9)} SOL`);
      logger.info(`Price from Reserves USD: $${(priceFromReserves * currentSolPrice).toFixed(9)}`);
    }
  }
  
  // Also check bonding curve mappings if it's graduated
  if (tokenInfo?.graduated_to_amm) {
    const bcResult = await db.query(`
      SELECT bonding_curve_address, mint_address 
      FROM bonding_curve_mappings 
      WHERE mint_address = $1
    `, [tokenMint]);
    
    if (bcResult.rows.length > 0) {
      logger.info('\n=== Bonding Curve Mapping ===');
      logger.info(`Bonding Curve: ${bcResult.rows[0].bonding_curve_address}`);
    }
  }
  } // End of token loop
  
  process.exit(0);
}

investigateMarketCap().catch(error => {
  logger.error('Error investigating market cap:', error);
  process.exit(1);
});