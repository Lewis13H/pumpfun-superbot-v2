/**
 * Fix AMM Reserve Extraction
 * The issue is we're extracting the wrong values as reserves
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'FixReserveExtraction', color: chalk.cyan });

// pump.fun constants
const INITIAL_VIRTUAL_SOL = 42_000_000_000n; // 42 SOL in lamports
const INITIAL_VIRTUAL_TOKENS = 1_000_000_000_000_000n; // 1B tokens with 6 decimals
const TOTAL_SUPPLY = 1_000_000_000; // 1B tokens

async function fixReserveExtraction() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    logger.info(`Current SOL price: $${solPrice}`);
    
    // Get all AMM trades
    const result = await db.query(`
      SELECT 
        id,
        mint_address,
        signature,
        sol_amount,
        token_amount,
        trade_type,
        virtual_sol_reserves,
        virtual_token_reserves,
        block_time
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY mint_address, block_time ASC
    `);
    
    logger.info(`Processing ${result.rows.length} AMM trades`);
    
    // Group by mint to track virtual reserves
    const mintGroups = new Map<string, any[]>();
    for (const trade of result.rows) {
      const trades = mintGroups.get(trade.mint_address) || [];
      trades.push(trade);
      mintGroups.set(trade.mint_address, trades);
    }
    
    logger.info(`Found ${mintGroups.size} unique AMM tokens`);
    
    // Process each token
    for (const [mintAddress, trades] of mintGroups) {
      logger.info(`\nProcessing ${mintAddress.substring(0, 8)}... (${trades.length} trades)`);
      
      // Start with initial virtual reserves
      let virtualSol = INITIAL_VIRTUAL_SOL;
      let virtualTokens = INITIAL_VIRTUAL_TOKENS;
      
      // Process trades in order
      for (const trade of trades) {
        const solAmount = BigInt(trade.sol_amount || '0');
        const tokenAmount = BigInt(trade.token_amount || '0');
        const isBuy = trade.trade_type === 'buy';
        
        if (solAmount === 0n || tokenAmount === 0n) continue;
        
        // Update virtual reserves based on constant product formula
        // For a buy: user puts in SOL, gets out tokens
        // For a sell: user puts in tokens, gets out SOL
        
        const k = virtualSol * virtualTokens; // constant product
        
        if (isBuy) {
          // Buy: SOL increases, tokens decrease
          virtualSol = virtualSol + solAmount;
          virtualTokens = k / virtualSol; // Maintain constant product
        } else {
          // Sell: tokens increase, SOL decreases
          virtualTokens = virtualTokens + tokenAmount;
          virtualSol = k / virtualTokens; // Maintain constant product
        }
        
        // Sanity check: token reserves should never exceed total supply
        const maxTokenReserves = BigInt(TOTAL_SUPPLY) * 1_000_000n; // 1B * 1e6
        if (virtualTokens > maxTokenReserves) {
          logger.warn(`⚠️  Token reserves exceed total supply, capping at ${TOTAL_SUPPLY}`);
          virtualTokens = maxTokenReserves;
          virtualSol = k / virtualTokens;
        }
        
        // Calculate price and market cap
        const priceInSol = Number(virtualSol) / Number(virtualTokens);
        const priceInUsd = priceInSol * solPrice;
        
        // For pump.fun graduated tokens:
        // - 800M sold in BC
        // - 200M initial liquidity
        // - Circulating = 800M + (200M - current_reserves/1e6)
        const currentReservesInTokens = Number(virtualTokens) / 1e6;
        const tokensOutOfPool = 200_000_000 - Math.min(currentReservesInTokens, 200_000_000);
        const circulatingSupply = 800_000_000 + tokensOutOfPool;
        
        const marketCapUsd = priceInUsd * circulatingSupply;
        
        // Update the trade
        await db.query(`
          UPDATE trades_unified
          SET 
            virtual_sol_reserves = $2,
            virtual_token_reserves = $3,
            market_cap_usd = $4,
            price_usd = $5
          WHERE id = $1
        `, [
          trade.id,
          virtualSol.toString(),
          virtualTokens.toString(),
          marketCapUsd,
          priceInUsd
        ]);
        
        logger.debug(`Trade ${trade.signature.substring(0, 10)}...`, {
          type: trade.trade_type,
          virtualSol: (Number(virtualSol) / 1e9).toFixed(2),
          virtualTokens: (Number(virtualTokens) / 1e6).toFixed(0),
          price: priceInUsd.toFixed(6),
          marketCap: marketCapUsd.toFixed(2)
        });
      }
      
      // Update token with latest values
      const latestTrade = trades[trades.length - 1];
      await db.query(`
        UPDATE tokens_unified
        SET 
          latest_market_cap_usd = $2,
          latest_virtual_sol_reserves = $3,
          latest_virtual_token_reserves = $4,
          updated_at = NOW()
        WHERE mint_address = $1
      `, [
        mintAddress,
        (Number(virtualSol) / Number(virtualTokens) * solPrice * 800_000_000), // Using circulating supply
        (Number(virtualSol) / 1e9),
        (Number(virtualTokens) / 1e6)
      ]);
      
      logger.info(`✅ Updated ${mintAddress.substring(0, 8)}... Final reserves: ${(Number(virtualSol) / 1e9).toFixed(2)} SOL, ${(Number(virtualTokens) / 1e6).toLocaleString()} tokens`);
    }
    
    // Show IPO token specifically
    const ipoResult = await db.query(`
      SELECT 
        latest_market_cap_usd,
        latest_virtual_sol_reserves,
        latest_virtual_token_reserves
      FROM tokens_unified
      WHERE mint_address = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump'
    `);
    
    if (ipoResult.rows.length > 0) {
      const ipo = ipoResult.rows[0];
      logger.info('\n=== IPO TOKEN UPDATED ===');
      logger.info(`Market cap: $${Number(ipo.latest_market_cap_usd).toLocaleString()}`);
      logger.info(`Reserves: ${ipo.latest_virtual_sol_reserves} SOL, ${Number(ipo.latest_virtual_token_reserves).toLocaleString()} tokens`);
      logger.info(`Ratio to $3.9M: ${(3_900_000 / Number(ipo.latest_market_cap_usd)).toFixed(2)}x`);
    }
    
  } catch (error) {
    logger.error('Failed to fix reserves', error as Error);
  }
}

fixReserveExtraction()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });