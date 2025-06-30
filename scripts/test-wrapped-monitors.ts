#!/usr/bin/env tsx
/**
 * Test Wrapped AMM Monitors
 * Verifies the integration is working correctly
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { TOKENS } from '../src/core/container';
import { EVENTS } from '../src/core/event-bus';
import { Logger } from '../src/core/logger';
import { Pool } from 'pg';

const logger = new Logger({ context: 'TestWrappedMonitors', color: chalk.cyan });

async function testWrappedMonitors() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    logger.info('Testing Wrapped AMM Monitors Integration\n');
    
    // 1. Check database before test
    const beforeStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND block_time > NOW() - INTERVAL '1 hour') as recent_amm_trades,
        (SELECT COUNT(*) FROM amm_pool_states WHERE created_at > NOW() - INTERVAL '1 hour') as recent_pool_states,
        (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated_tokens
    `);
    
    logger.info('Database state before test:', {
      recentAMMTrades: beforeStats.rows[0].recent_amm_trades,
      recentPoolStates: beforeStats.rows[0].recent_pool_states,
      graduatedTokens: beforeStats.rows[0].graduated_tokens
    });
    
    // 2. Create container and get services
    logger.info('\n2. Initializing DI container...');
    const container = await createContainer();
    const eventBus = await container.resolve(TOKENS.EventBus);
    
    // 3. Set up event listeners
    logger.info('3. Setting up event listeners...');
    
    let eventCounts = {
      ammTrades: 0,
      poolStateUpdates: 0,
      poolCreations: 0,
      tradeProcessed: 0,
      graduations: 0
    };
    
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      eventCounts.ammTrades++;
      if (eventCounts.ammTrades <= 3) {
        logger.info('AMM_TRADE event:', {
          mint: data.trade?.mintAddress?.substring(0, 12) + '...',
          type: data.trade?.tradeType,
          price: `$${data.trade?.priceUsd?.toFixed(4)}`
        });
      }
    });
    
    eventBus.on(EVENTS.POOL_STATE_UPDATED, (data) => {
      eventCounts.poolStateUpdates++;
      if (eventCounts.poolStateUpdates <= 3) {
        logger.info('POOL_STATE_UPDATED event:', {
          pool: data.poolAddress?.substring(0, 12) + '...',
          solReserves: data.virtualSolReserves ? (Number(data.virtualSolReserves) / 1e9).toFixed(2) : '0'
        });
      }
    });
    
    eventBus.on(EVENTS.POOL_CREATED, (data) => {
      eventCounts.poolCreations++;
      logger.warn('POOL_CREATED event!', {
        pool: data.poolAddress?.substring(0, 12) + '...',
        mint: data.mintAddress?.substring(0, 12) + '...'
      });
    });
    
    eventBus.on(EVENTS.TRADE_PROCESSED, (trade) => {
      eventCounts.tradeProcessed++;
      if (trade.program === 'amm_pool' && eventCounts.tradeProcessed <= 3) {
        logger.debug('AMM trade processed', {
          mint: trade.mintAddress?.substring(0, 12) + '...',
          bondingCurveKey: trade.bondingCurveKey
        });
      }
    });
    
    eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
      eventCounts.graduations++;
      logger.warn('🎓 GRADUATION!', data);
    });
    
    // 4. Create wrapped monitors
    logger.info('\n4. Creating wrapped monitors...');
    const { AMMMonitorWrapper } = await import('../src/monitors/amm-monitor-wrapper');
    const { AMMAccountMonitorWrapper } = await import('../src/monitors/amm-account-monitor-wrapper');
    
    const ammMonitor = new AMMMonitorWrapper(container);
    const ammAccountMonitor = new AMMAccountMonitorWrapper(container);
    
    // 5. Start monitors for 30 seconds
    logger.info('5. Starting monitors (30 second test)...');
    await ammMonitor.start();
    await ammAccountMonitor.start();
    
    const startTime = Date.now();
    const checkInterval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      if (elapsed % 10 === 0 && elapsed > 0) {
        logger.info(`[${elapsed}s] Event counts:`, eventCounts);
      }
      
      if (elapsed >= 30) {
        clearInterval(checkInterval);
        
        // Stop monitors
        await ammMonitor.stop();
        await ammAccountMonitor.stop();
        
        // Final database check
        const afterStats = await pool.query(`
          SELECT 
            (SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND block_time > NOW() - INTERVAL '1 hour') as recent_amm_trades,
            (SELECT COUNT(*) FROM amm_pool_states WHERE created_at > NOW() - INTERVAL '1 hour') as recent_pool_states,
            (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated_tokens
        `);
        
        const newAMMTrades = afterStats.rows[0].recent_amm_trades - beforeStats.rows[0].recent_amm_trades;
        const newPoolStates = afterStats.rows[0].recent_pool_states - beforeStats.rows[0].recent_pool_states;
        const newGraduations = afterStats.rows[0].graduated_tokens - beforeStats.rows[0].graduated_tokens;
        
        // Summary
        logger.box('Test Summary', {
          'Duration': '30 seconds',
          'AMM Trade Events': eventCounts.ammTrades,
          'Pool State Events': eventCounts.poolStateUpdates,
          'Pool Creation Events': eventCounts.poolCreations,
          'Trade Processed Events': eventCounts.tradeProcessed,
          'Graduation Events': eventCounts.graduations,
          'New AMM Trades (DB)': newAMMTrades,
          'New Pool States (DB)': newPoolStates,
          'New Graduations (DB)': newGraduations
        });
        
        if (eventCounts.ammTrades > 0 || eventCounts.poolStateUpdates > 0) {
          logger.info(chalk.green('\n✓ Wrapped AMM monitors are working correctly!'));
          logger.info('Events are being emitted and can be consumed by other components.');
        } else {
          logger.warn(chalk.yellow('\n⚠ No AMM activity detected during test period'));
          logger.info('This could be normal if there\'s low AMM activity.');
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

testWrappedMonitors();