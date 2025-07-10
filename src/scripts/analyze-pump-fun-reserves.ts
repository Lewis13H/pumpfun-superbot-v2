/**
 * Analyze Pump.fun Reserve Logic
 * Understanding how pump.fun handles virtual reserves
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { SolPriceService } from '../services/pricing/sol-price-service';

const logger = new Logger({ context: 'AnalyzePumpFun', color: chalk.cyan });

const MINT = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';

async function analyzePumpFun() {
  try {
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getPrice();
    
    // Key insight: pump.fun uses VIRTUAL reserves, not actual reserves
    // Virtual reserves != actual token balances
    
    logger.info('=== PUMP.FUN VIRTUAL RESERVES EXPLAINED ===');
    logger.info('pump.fun uses virtual reserves for price calculation');
    logger.info('These are NOT the actual token balances in the pool');
    
    // Get the trade
    const result = await db.query(`
      SELECT 
        virtual_sol_reserves,
        virtual_token_reserves,
        sol_amount,
        token_amount
      FROM trades_unified
      WHERE mint_address = $1 AND program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 1
    `, [MINT]);
    
    const trade = result.rows[0];
    if (!trade) return;
    
    const virtualSol = BigInt(trade.virtual_sol_reserves);
    const virtualTokens = BigInt(trade.virtual_token_reserves);
    
    logger.info('\nVirtual reserves from trade:');
    logger.info(`  SOL: ${(Number(virtualSol) / 1e9).toFixed(2)}`);
    logger.info(`  Tokens: ${(Number(virtualTokens) / 1e6).toLocaleString()}`);
    
    // pump.fun initial virtual reserves
    const INITIAL_VIRTUAL_SOL = 42_000_000_000n; // 42 SOL
    const INITIAL_VIRTUAL_TOKENS = 1_000_000_000_000_000n; // 1B tokens * 1e6
    
    // Calculate actual liquidity added/removed
    const solDelta = virtualSol - INITIAL_VIRTUAL_SOL;
    const tokenDelta = virtualTokens - INITIAL_VIRTUAL_TOKENS;
    
    logger.info('\nChange from initial:');
    logger.info(`  SOL: ${(Number(solDelta) / 1e9).toFixed(2)} (${solDelta > 0 ? 'added' : 'removed'})`);
    logger.info(`  Tokens: ${(Number(tokenDelta) / 1e6).toLocaleString()} (${tokenDelta > 0 ? 'added' : 'removed'})`);
    
    // The actual pool balances would be different
    // pump.fun keeps some tokens for the bonding curve
    const TOKENS_FOR_LIQUIDITY = 200_000_000_000_000n; // 200M tokens * 1e6
    const TOKENS_FOR_BC = 800_000_000_000_000n; // 800M tokens * 1e6
    
    logger.info('\n=== CORRECTED MARKET CAP CALCULATION ===');
    
    // Price from virtual reserves (this is correct)
    const priceInSol = Number(virtualSol) / Number(virtualTokens);
    const priceInUsd = priceInSol * solPrice;
    
    logger.info(`Price per token: $${priceInUsd.toFixed(9)}`);
    
    // For pump.fun tokens that graduated to AMM:
    // - Total supply is 1B tokens
    // - But only 200M go to liquidity initially
    // - 800M were sold during bonding curve
    
    // So circulating supply = tokens sold in BC + tokens removed from AMM
    const tokensRemovedFromAMM = TOKENS_FOR_LIQUIDITY - (virtualTokens - INITIAL_VIRTUAL_TOKENS);
    const circulatingFromAMM = Number(tokensRemovedFromAMM) / 1e6;
    const circulatingFromBC = 800_000_000; // 800M sold in BC
    const totalCirculating = circulatingFromBC + Math.max(0, circulatingFromAMM);
    
    logger.info(`\nCirculating supply breakdown:`);
    logger.info(`  From BC sales: ${circulatingFromBC.toLocaleString()}`);
    logger.info(`  From AMM: ${circulatingFromAMM.toLocaleString()}`);
    logger.info(`  Total circulating: ${totalCirculating.toLocaleString()}`);
    
    const marketCap = priceInUsd * totalCirculating;
    logger.info(`\nMarket cap (circulating): $${marketCap.toLocaleString()}`);
    
    // FDV with total supply
    const fdv = priceInUsd * 1_000_000_000;
    logger.info(`FDV (1B total): $${fdv.toLocaleString()}`);
    
    // Update the database with corrected calculation
    logger.info('\nUpdating database with corrected market cap...');
    
    await db.query(`
      UPDATE trades_unified
      SET market_cap_usd = $2
      WHERE mint_address = $1 AND program = 'amm_pool'
    `, [MINT, marketCap]);
    
    await db.query(`
      UPDATE tokens_unified
      SET latest_market_cap_usd = $2
      WHERE mint_address = $1
    `, [MINT, marketCap]);
    
    logger.info('✅ Market cap updated to: $' + marketCap.toLocaleString());
    
    // Compare with reported
    const ratio = 3_900_000 / marketCap;
    logger.info(`\nRatio to reported $3.9M: ${ratio.toFixed(2)}x`);
    
    if (Math.abs(ratio - 1) > 0.1) {
      logger.info('\n=== REMAINING DISCREPANCY ===');
      logger.info('Possible reasons:');
      logger.info('1. DexScreener might show FDV instead of market cap');
      logger.info('2. Our virtual reserves might be from a different time');
      logger.info('3. DexScreener might use different circulating supply calculation');
    }
    
  } catch (error) {
    logger.error('Analysis failed', error as Error);
  }
}

analyzePumpFun()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });