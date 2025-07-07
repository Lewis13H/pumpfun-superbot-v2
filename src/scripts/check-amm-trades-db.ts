#!/usr/bin/env node

/**
 * Check database for AMM trades directly
 */

import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';

async function checkAMMTradesInDB() {
  console.log(chalk.cyan('🔍 Checking Database for AMM Trades\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    // 1. Count trades by program
    console.log(chalk.yellow('1. Trade counts by program:'));
    const programCountsResult = await pool.query(`
      SELECT 
        program,
        COUNT(*) as count,
        MIN(block_time) as earliest,
        MAX(block_time) as latest
      FROM trades_unified
      WHERE block_time > NOW() - INTERVAL '24 hours'
      GROUP BY program
      ORDER BY count DESC
    `);
    
    console.log('Program'.padEnd(20) + 'Count'.padEnd(10) + 'Earliest'.padEnd(25) + 'Latest');
    console.log('-'.repeat(80));
    
    for (const row of programCountsResult.rows) {
      const earliest = new Date(row.earliest).toISOString();
      const latest = new Date(row.latest).toISOString();
      console.log(
        row.program.padEnd(20) + 
        row.count.toString().padEnd(10) + 
        earliest.padEnd(25) + 
        latest
      );
    }
    
    // 2. Check recent AMM trades specifically
    console.log(chalk.yellow('\n2. Recent AMM trades (last hour):'));
    const recentAMMResult = await pool.query(`
      SELECT 
        signature,
        mint_address,
        trade_type,
        volume_usd,
        block_time
      FROM trades_unified
      WHERE program = 'amm_pool'
        AND block_time > NOW() - INTERVAL '1 hour'
      ORDER BY block_time DESC
      LIMIT 10
    `);
    
    if (recentAMMResult.rows.length === 0) {
      console.log(chalk.red('  No AMM trades found in the last hour'));
    } else {
      console.log(`  Found ${recentAMMResult.rows.length} AMM trades:`);
      for (const trade of recentAMMResult.rows) {
        const time = new Date(trade.block_time).toISOString();
        console.log(`    ${time} - ${trade.trade_type} - $${trade.volume_usd?.toFixed(2) || '0.00'} - ${trade.signature.substring(0, 20)}...`);
      }
    }
    
    // 3. Check if any graduated tokens have AMM trades
    console.log(chalk.yellow('\n3. Graduated tokens with AMM activity:'));
    const graduatedWithAMMResult = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.graduated_to_amm,
        COUNT(tr.signature) as amm_trade_count,
        MAX(tr.block_time) as last_amm_trade
      FROM tokens_unified t
      LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address AND tr.program = 'amm_pool'
      WHERE t.graduated_to_amm = true
      GROUP BY t.mint_address, t.symbol, t.graduated_to_amm
      HAVING COUNT(tr.signature) > 0
      ORDER BY last_amm_trade DESC
      LIMIT 10
    `);
    
    if (graduatedWithAMMResult.rows.length === 0) {
      console.log(chalk.red('  No graduated tokens have AMM trades'));
    } else {
      console.log(`  Found ${graduatedWithAMMResult.rows.length} graduated tokens with AMM trades:`);
      for (const token of graduatedWithAMMResult.rows) {
        const lastTrade = token.last_amm_trade ? new Date(token.last_amm_trade).toISOString() : 'Never';
        console.log(`    ${(token.symbol || 'Unknown').padEnd(10)} - ${token.amm_trade_count} trades - Last: ${lastTrade}`);
      }
    }
    
    // 4. Check total counts since system start
    console.log(chalk.yellow('\n4. All-time trade counts:'));
    const allTimeResult = await pool.query(`
      SELECT 
        program,
        COUNT(*) as total_count,
        COUNT(DISTINCT mint_address) as unique_tokens,
        SUM(volume_usd) as total_volume_usd
      FROM trades_unified
      GROUP BY program
    `);
    
    console.log('Program'.padEnd(20) + 'Total Trades'.padEnd(15) + 'Unique Tokens'.padEnd(15) + 'Volume USD');
    console.log('-'.repeat(65));
    
    for (const row of allTimeResult.rows) {
      console.log(
        row.program.padEnd(20) + 
        row.total_count.toString().padEnd(15) + 
        row.unique_tokens.toString().padEnd(15) + 
        `$${parseFloat(row.total_volume_usd || 0).toFixed(2)}`
      );
    }
    
    // 5. Check if AMM parser is working by looking at trade details
    console.log(chalk.yellow('\n5. Sample AMM trade details (if any):'));
    const sampleAMMResult = await pool.query(`
      SELECT 
        signature,
        mint_address,
        trade_type,
        sol_amount,
        token_amount,
        virtual_sol_reserves,
        virtual_token_reserves,
        block_time
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 3
    `);
    
    if (sampleAMMResult.rows.length === 0) {
      console.log(chalk.red('  No AMM trades to show'));
    } else {
      for (const trade of sampleAMMResult.rows) {
        console.log(chalk.cyan(`\n  Trade ${trade.signature.substring(0, 20)}...`));
        console.log(`    Mint: ${trade.mint_address}`);
        console.log(`    Type: ${trade.trade_type}`);
        console.log(`    SOL Amount: ${(Number(trade.sol_amount) / 1e9).toFixed(6)} SOL`);
        console.log(`    Token Amount: ${(Number(trade.token_amount) / 1e6).toFixed(2)}`);
        console.log(`    Reserves - SOL: ${trade.virtual_sol_reserves}, Token: ${trade.virtual_token_reserves}`);
        console.log(`    Time: ${new Date(trade.block_time).toISOString()}`);
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run check
checkAMMTradesInDB().catch(console.error);