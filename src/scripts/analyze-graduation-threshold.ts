/**
 * Script to analyze the actual graduation threshold for pump.fun tokens
 * by examining the virtual SOL reserves at the point of graduation
 */

import { db } from '../database';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'GraduationAnalysis' });

async function analyzeGraduationThreshold() {

  try {
    // First, find tokens that have both BC and AMM trades
    logger.info('Finding tokens with both BC and AMM trades...');
    
    const graduatedTokensQuery = `
      SELECT DISTINCT bc.mint_address
      FROM trades_unified bc
      INNER JOIN trades_unified amm ON bc.mint_address = amm.mint_address
      WHERE bc.program = 'bonding_curve'
      AND amm.program = 'amm'
      LIMIT 50
    `;
    
    const graduatedTokens = await db.query(graduatedTokensQuery);
    logger.info(`Found ${graduatedTokens.rows.length} tokens that graduated to AMM`);

    if (graduatedTokens.rows.length === 0) {
      logger.warn('No graduated tokens found. Checking for max virtual SOL reserves...');
      
      // Check the maximum virtual SOL reserves across all tokens
      const maxReservesQuery = `
        SELECT 
          mint_address,
          MAX(virtual_sol_reserves::numeric / 1e9) as max_sol,
          MAX(bonding_curve_progress) as max_progress,
          COUNT(*) as trade_count
        FROM trades_unified
        WHERE program = 'bonding_curve'
        AND virtual_sol_reserves IS NOT NULL
        GROUP BY mint_address
        HAVING MAX(virtual_sol_reserves::numeric / 1e9) > 85
        ORDER BY max_sol DESC
        LIMIT 20
      `;
      
      const maxReserves = await db.query(maxReservesQuery);
      logger.info('\nTokens with >85 SOL still trading on bonding curve:');
      console.table(maxReserves.rows.map(r => ({
        mint: r.mint_address.substring(0, 8) + '...',
        maxSol: parseFloat(r.max_sol).toFixed(2),
        progress: r.max_progress + '%',
        trades: r.trade_count
      })));
    }

    // For each graduated token, find the last BC trade
    for (const token of graduatedTokens.rows.slice(0, 10)) {
      const lastBCTradeQuery = `
        SELECT 
          virtual_sol_reserves::numeric / 1e9 as sol_reserves,
          virtual_token_reserves::numeric / 1e6 as token_reserves,
          bonding_curve_progress,
          created_at
        FROM trades_unified
        WHERE mint_address = $1
        AND program = 'bonding_curve'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const lastBCTrade = await db.query(lastBCTradeQuery, [token.mint_address]);
      
      if (lastBCTrade.rows.length > 0) {
        const trade = lastBCTrade.rows[0];
        logger.info(`Token ${token.mint_address.substring(0, 8)}...`, {
          lastSolReserves: parseFloat(trade.sol_reserves).toFixed(2),
          lastProgress: trade.bonding_curve_progress,
          timestamp: trade.created_at
        });
      }
    }

    // Analyze distribution of max SOL reserves
    const distributionQuery = `
      SELECT 
        CASE 
          WHEN max_sol < 85 THEN '< 85 SOL'
          WHEN max_sol >= 85 AND max_sol < 100 THEN '85-100 SOL'
          WHEN max_sol >= 100 AND max_sol < 110 THEN '100-110 SOL'
          WHEN max_sol >= 110 THEN '> 110 SOL'
        END as range,
        COUNT(*) as token_count,
        AVG(max_progress) as avg_progress
      FROM (
        SELECT 
          mint_address,
          MAX(virtual_sol_reserves::numeric / 1e9) as max_sol,
          MAX(bonding_curve_progress) as max_progress
        FROM trades_unified
        WHERE program = 'bonding_curve'
        AND virtual_sol_reserves IS NOT NULL
        GROUP BY mint_address
      ) t
      GROUP BY range
      ORDER BY 
        CASE range
          WHEN '< 85 SOL' THEN 1
          WHEN '85-100 SOL' THEN 2
          WHEN '100-110 SOL' THEN 3
          WHEN '> 110 SOL' THEN 4
        END
    `;
    
    const distribution = await db.query(distributionQuery);
    logger.info('\nDistribution of maximum SOL reserves:');
    console.table(distribution.rows);

    // Check if there's a pattern in the actual bonding curve data
    logger.info('\nChecking bonding curve account data...');
    const bcMappingQuery = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.latest_virtual_sol_reserves::numeric / 1e9 as latest_sol,
        t.graduation_at,
        bcm.bonding_curve_key
      FROM tokens_unified t
      LEFT JOIN bonding_curve_mappings bcm ON t.mint_address = bcm.mint_address
      WHERE t.latest_virtual_sol_reserves IS NOT NULL
      AND t.latest_virtual_sol_reserves::numeric / 1e9 > 85
      ORDER BY latest_sol DESC
      LIMIT 10
    `;
    
    const bcMappings = await db.query(bcMappingQuery);
    logger.info('Tokens with high SOL reserves and their bonding curves:');
    console.table(bcMappings.rows.map(r => ({
      mint: r.mint_address.substring(0, 8) + '...',
      symbol: r.symbol || 'Unknown',
      latestSol: parseFloat(r.latest_sol).toFixed(2),
      graduated: !!r.graduation_at,
      bcKey: r.bonding_curve_key ? r.bonding_curve_key.substring(0, 8) + '...' : 'N/A'
    })));

  } catch (error) {
    logger.error('Error analyzing graduation threshold', error as Error);
  } finally {
    await db.close();
  }
}

analyzeGraduationThreshold().catch(console.error);