#!/usr/bin/env npx tsx

/**
 * Check Recent AMM Trades
 * Script to verify AMM trades are being saved after BIGINT fix
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

async function main() {
  console.log(chalk.cyan('\n🔍 Checking Recent AMM Trades\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // 1. Count total AMM trades
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM trades_unified
      WHERE program = 'amm_pool'
    `);
    
    console.log(chalk.yellow('Total AMM trades in database:'), countResult.rows[0].total);
    
    // 2. Count AMM trades in last hour
    const hourResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM trades_unified
      WHERE program = 'amm_pool'
      AND created_at > NOW() - INTERVAL '1 hour'
    `);
    
    console.log(chalk.yellow('AMM trades in last hour:'), hourResult.rows[0].total);
    
    // 3. Get most recent 10 AMM trades
    const recentTrades = await pool.query(`
      SELECT 
        signature,
        mint_address,
        user_address,
        trade_type,
        sol_amount,
        token_amount,
        volume_usd,
        price_usd,
        virtual_sol_reserves,
        virtual_token_reserves,
        created_at
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (recentTrades.rows.length === 0) {
      console.log(chalk.red('\n❌ No AMM trades found in database!\n'));
      
      // Check if there are any trades at all
      const anyTrades = await pool.query(`
        SELECT program, COUNT(*) as count
        FROM trades_unified
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY program
      `);
      
      console.log('Trades by program in last hour:');
      anyTrades.rows.forEach(row => {
        console.log(`  ${row.program}: ${row.count}`);
      });
      
    } else {
      console.log(chalk.green('\n✅ Recent AMM trades found!\n'));
      
      recentTrades.rows.forEach((trade, index) => {
        console.log(chalk.cyan(`\n--- Trade #${index + 1} ---`));
        console.log(`Signature: ${trade.signature.substring(0, 20)}...`);
        console.log(`Token: ${trade.mint_address.substring(0, 8)}...`);
        console.log(`Type: ${trade.trade_type}`);
        console.log(`SOL Amount: ${(Number(trade.sol_amount) / 1e9).toFixed(6)} SOL`);
        console.log(`Token Amount: ${trade.token_amount}`);
        console.log(`Volume USD: $${trade.volume_usd ? Number(trade.volume_usd).toFixed(2) : '0.00'}`);
        console.log(`Price USD: $${trade.price_usd ? Number(trade.price_usd).toFixed(8) : '0.00'}`);
        console.log(`Virtual SOL Reserves: ${trade.virtual_sol_reserves || 'NULL'}`);
        console.log(`Virtual Token Reserves: ${trade.virtual_token_reserves || 'NULL'}`);
        console.log(`Time: ${new Date(trade.created_at).toLocaleString()}`);
      });
      
      // Check if reserves are being stored properly (should be large numbers)
      const largeReserves = recentTrades.rows.filter(t => 
        Number(t.virtual_sol_reserves) > 1e15 || 
        Number(t.virtual_token_reserves) > 1e15
      );
      
      if (largeReserves.length > 0) {
        console.log(chalk.green(`\n✅ Large reserves detected (${largeReserves.length} trades with reserves > 10^15)`));
        console.log('This confirms the BIGINT to NUMERIC migration is working!');
      }
    }
    
    // 4. Check for any errors in last hour
    const errorCheck = await pool.query(`
      SELECT COUNT(*) as error_count
      FROM trades_unified
      WHERE program = 'amm_pool'
      AND created_at > NOW() - INTERVAL '1 hour'
      AND (virtual_sol_reserves IS NULL OR virtual_token_reserves IS NULL)
    `);
    
    if (errorCheck.rows[0].error_count > 0) {
      console.log(chalk.yellow(`\n⚠️ Found ${errorCheck.rows[0].error_count} AMM trades with NULL reserves`));
    }
    
  } catch (error) {
    console.error(chalk.red('Database error:'), error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);