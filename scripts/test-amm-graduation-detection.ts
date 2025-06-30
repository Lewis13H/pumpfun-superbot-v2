#!/usr/bin/env tsx
/**
 * Test AMM Graduation Detection
 * Focuses on real pool data with reserves > 0 and graduation events
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';
import { createContainer } from '../src/core/container-factory';
import { TOKENS } from '../src/core/container';
import { EVENTS } from '../src/core/event-bus';
import { Logger } from '../src/core/logger';

const logger = new Logger({ context: 'TestAMMGraduation', color: chalk.cyan });

async function testAMMGraduationDetection() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    logger.info('Testing AMM Graduation Detection and Pool State Tracking\n');
    
    // 1. Check real pool states (with reserves > 0)
    logger.info('1. Checking real AMM pool states (reserves > 0)...');
    const realPools = await pool.query(`
      SELECT 
        p.mint_address,
        p.pool_address,
        p.virtual_sol_reserves,
        p.virtual_token_reserves,
        p.created_at,
        t.symbol,
        t.graduated_to_amm,
        t.graduation_at
      FROM amm_pool_states p
      LEFT JOIN tokens_unified t ON t.mint_address = p.mint_address
      WHERE p.virtual_sol_reserves > 0
        AND p.virtual_token_reserves > 0
      ORDER BY p.created_at DESC
      LIMIT 10
    `);
    
    if (realPools.rows.length > 0) {
      logger.info(`Found ${realPools.rows.length} pools with reserves:`);
      for (const pool of realPools.rows) {
        const solReserves = Number(pool.virtual_sol_reserves) / 1e9;
        const tokenReserves = Number(pool.virtual_token_reserves) / 1e6;
        const price = solReserves / tokenReserves;
        
        console.log(`  ${pool.symbol || pool.mint_address.substring(0, 8)}... | ` +
                   `SOL: ${solReserves.toFixed(2)} | ` +
                   `Tokens: ${tokenReserves.toFixed(0)} | ` +
                   `Price: $${(price * 150).toFixed(4)} | ` +
                   `Graduated: ${pool.graduated_to_amm ? '✓' : '✗'}`);
      }
    } else {
      logger.warn('No pools found with reserves > 0');
    }
    
    // 2. Check graduated tokens
    logger.info('\n2. Checking graduated tokens...');
    const graduatedTokens = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.graduated_to_amm,
        t.graduation_at,
        t.graduation_slot,
        COUNT(DISTINCT p.pool_address) as pool_count,
        MAX(p.virtual_sol_reserves) as max_sol_reserves
      FROM tokens_unified t
      LEFT JOIN amm_pool_states p ON p.mint_address = t.mint_address
      WHERE t.graduated_to_amm = true
        AND t.graduation_at > NOW() - INTERVAL '24 hours'
      GROUP BY t.mint_address, t.symbol, t.name, t.graduated_to_amm, t.graduation_at, t.graduation_slot
      ORDER BY t.graduation_at DESC
      LIMIT 10
    `);
    
    if (graduatedTokens.rows.length > 0) {
      logger.info(`Found ${graduatedTokens.rows.length} recently graduated tokens:`);
      for (const token of graduatedTokens.rows) {
        console.log(`  ${token.symbol || token.mint_address.substring(0, 8)}... | ` +
                   `Pools: ${token.pool_count} | ` +
                   `Max SOL: ${token.max_sol_reserves ? (Number(token.max_sol_reserves) / 1e9).toFixed(2) : '0'} | ` +
                   `Graduated: ${new Date(token.graduation_at).toLocaleString()}`);
      }
    } else {
      logger.warn('No recently graduated tokens found');
    }
    
    // 3. Test graduation handler integration
    logger.info('\n3. Testing graduation handler integration...');
    const container = await createContainer();
    const eventBus = await container.resolve(TOKENS.EventBus);
    const graduationHandler = await container.resolve(TOKENS.GraduationHandler);
    
    // Check graduation handler stats
    const stats = graduationHandler.getStats();
    logger.info('Graduation handler stats:', stats);
    
    // 4. Monitor for new graduations (30 seconds)
    logger.info('\n4. Monitoring for new graduations and pool updates (30 seconds)...');
    
    let graduationEvents = 0;
    let poolStateEvents = 0;
    let tradeEvents = 0;
    
    // Listen for events
    eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
      graduationEvents++;
      logger.warn('🎓 GRADUATION EVENT!', {
        mint: data.mintAddress?.substring(0, 12) + '...',
        bondingCurve: data.bondingCurveKey?.substring(0, 12) + '...'
      });
    });
    
    eventBus.on(EVENTS.POOL_STATE_UPDATED, (data) => {
      poolStateEvents++;
      if (poolStateEvents <= 5) { // Log first 5
        logger.info('Pool state updated', {
          pool: data.poolAddress?.substring(0, 12) + '...',
          hasReserves: data.virtualSolReserves > 0
        });
      }
    });
    
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      tradeEvents++;
      if (tradeEvents <= 5) { // Log first 5
        logger.info('AMM trade', {
          mint: data.trade?.mintAddress?.substring(0, 12) + '...',
          type: data.trade?.tradeType,
          price: `$${data.trade?.priceUsd?.toFixed(4)}`
        });
      }
    });
    
    // Track database changes
    const beforeCount = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM amm_pool_states WHERE virtual_sol_reserves > 0) as pool_states,
        (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated_tokens
    `);
    
    const startTime = Date.now();
    const checkInterval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      if (elapsed >= 30) {
        clearInterval(checkInterval);
        
        // Final check
        const afterCount = await pool.query(`
          SELECT 
            (SELECT COUNT(*) FROM amm_pool_states WHERE virtual_sol_reserves > 0) as pool_states,
            (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated_tokens
        `);
        
        const newPoolStates = afterCount.rows[0].pool_states - beforeCount.rows[0].pool_states;
        const newGraduations = afterCount.rows[0].graduated_tokens - beforeCount.rows[0].graduated_tokens;
        
        // Summary
        logger.box('Test Summary', {
          'Duration': '30 seconds',
          'Graduation Events': graduationEvents,
          'Pool State Events': poolStateEvents,
          'AMM Trade Events': tradeEvents,
          'New Pool States (DB)': newPoolStates,
          'New Graduations (DB)': newGraduations,
          'Event Rate': `${((graduationEvents + poolStateEvents + tradeEvents) / 30).toFixed(2)} events/sec`
        });
        
        if (graduationEvents > 0) {
          logger.info(chalk.green('\n✓ Graduation detection is working!'));
        } else if (poolStateEvents > 0 || tradeEvents > 0) {
          logger.info(chalk.yellow('\n⚠ AMM activity detected but no graduations in test period'));
        } else {
          logger.warn(chalk.red('\n✗ No AMM monitor activity detected'));
          logger.info('\nPossible issues:');
          logger.info('1. Refactored AMM monitors not running due to gRPC error');
          logger.info('2. Run the legacy monitors instead:');
          logger.info('   npm run amm-monitor');
          logger.info('   npm run amm-account-monitor');
        }
        
        await pool.end();
        process.exit(0);
      }
    }, 1000);
    
  } catch (error) {
    logger.error('Test failed:', error as Error);
    await pool.end();
    process.exit(1);
  }
}

testAMMGraduationDetection();