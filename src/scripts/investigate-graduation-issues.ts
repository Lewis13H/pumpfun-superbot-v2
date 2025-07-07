#!/usr/bin/env node

/**
 * Investigate why certain tokens aren't marked as graduated
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import { configService } from '../core/config';
import * as borsh from '@coral-xyz/borsh';
import chalk from 'chalk';

// Bonding curve account schema
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'),
]);

const BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
const LAMPORTS_PER_SOL = 1_000_000_000;

async function investigateGraduation() {
  console.log(chalk.cyan('🔍 Investigating Graduation Issues\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  // Tokens to investigate
  const tokensToCheck = [
    '4UfTYHPXA1JKnG2mi6eQPv3s5vhiVP358Ko9MDxxpump',
    'B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump',
    'BgoBs6JQDU1fZqiheJX2aWFj9XvtWtu8755uhVvNpump'
  ];
  
  try {
    for (const mintAddress of tokensToCheck) {
      console.log(chalk.yellow(`\nInvestigating token: ${mintAddress}`));
      console.log('='.repeat(80));
      
      // 1. Check database state
      const dbResult = await pool.query(`
        SELECT 
          mint_address,
          symbol,
          bonding_curve_key,
          bonding_curve_complete,
          graduated_to_amm,
          latest_bonding_curve_progress,
          current_program,
          created_at,
          updated_at,
          latest_virtual_sol_reserves,
          latest_virtual_token_reserves
        FROM tokens_unified
        WHERE mint_address = $1
      `, [mintAddress]);
      
      if (dbResult.rows.length === 0) {
        console.log(chalk.red('❌ Token not found in database!'));
        continue;
      }
      
      const token = dbResult.rows[0];
      console.log(chalk.cyan('📊 Database State:'));
      console.log(`  Symbol: ${token.symbol || 'Unknown'}`);
      console.log(`  Bonding Curve Key: ${token.bonding_curve_key || 'NULL'}`);
      console.log(`  BC Complete: ${token.bonding_curve_complete}`);
      console.log(`  Graduated to AMM: ${token.graduated_to_amm}`);
      console.log(`  BC Progress: ${token.latest_bonding_curve_progress || 'NULL'}%`);
      console.log(`  Current Program: ${token.current_program}`);
      console.log(`  Created: ${new Date(token.created_at).toISOString()}`);
      console.log(`  Updated: ${new Date(token.updated_at).toISOString()}`);
      
      // 2. Check if token has AMM trades
      const ammTradesResult = await pool.query(`
        SELECT COUNT(*) as count, MIN(block_time) as first_amm_trade
        FROM trades_unified
        WHERE mint_address = $1 AND program = 'amm_pool'
      `, [mintAddress]);
      
      const ammTrades = ammTradesResult.rows[0];
      console.log(chalk.cyan('\n📈 AMM Trading:'));
      console.log(`  AMM Trades: ${ammTrades.count}`);
      if (ammTrades.count > 0) {
        console.log(`  First AMM Trade: ${new Date(ammTrades.first_amm_trade).toISOString()}`);
        console.log(chalk.yellow('  ⚠️  Has AMM trades but not marked as graduated!'));
      }
      
      // 3. Check bonding curve account on-chain
      if (token.bonding_curve_key) {
        console.log(chalk.cyan('\n🔗 On-chain Bonding Curve State:'));
        try {
          const bcPubkey = new PublicKey(token.bonding_curve_key);
          const accountInfo = await connection.getAccountInfo(bcPubkey);
          
          if (!accountInfo) {
            console.log(chalk.green('  ✅ Account closed (expected for graduated tokens)'));
          } else {
            console.log(`  Account exists with ${accountInfo.lamports} lamports`);
            const solInCurve = accountInfo.lamports / LAMPORTS_PER_SOL;
            const progress = (solInCurve / 84) * 100;
            console.log(`  SOL in curve: ${solInCurve.toFixed(4)} SOL`);
            console.log(`  Progress: ${progress.toFixed(2)}%`);
            
            // Try to decode the account
            try {
              const discriminator = accountInfo.data.slice(0, 8);
              if (discriminator.equals(BONDING_CURVE_DISCRIMINATOR)) {
                const decoded = BONDING_CURVE_SCHEMA.decode(accountInfo.data.slice(8));
                console.log(`  Complete flag: ${decoded.complete}`);
                console.log(`  Virtual SOL: ${(Number(decoded.virtualSolReserves) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
                console.log(`  Real SOL: ${(Number(decoded.realSolReserves) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
                
                if (decoded.complete && !token.bonding_curve_complete) {
                  console.log(chalk.red('  ❌ Complete flag is TRUE on-chain but FALSE in database!'));
                }
              }
            } catch (err) {
              console.log(chalk.gray('  Could not decode account data'));
            }
          }
        } catch (error) {
          console.log(chalk.red(`  Error fetching BC account: ${error.message}`));
        }
      } else {
        console.log(chalk.gray('\n🔗 No bonding curve key stored'));
      }
      
      // 4. Check recent events
      const recentEventsResult = await pool.query(`
        SELECT 
          signature,
          program,
          trade_type,
          block_time,
          bonding_curve_progress
        FROM trades_unified
        WHERE mint_address = $1
        ORDER BY block_time DESC
        LIMIT 5
      `, [mintAddress]);
      
      console.log(chalk.cyan('\n📝 Recent Trades:'));
      for (const trade of recentEventsResult.rows) {
        const time = new Date(trade.block_time).toISOString();
        console.log(`  ${time} - ${trade.program} - ${trade.trade_type} - Progress: ${trade.bonding_curve_progress || 'NULL'}`);
      }
      
      // 5. Diagnosis
      console.log(chalk.cyan('\n🔍 Diagnosis:'));
      
      if (ammTrades.count > 0 && !token.graduated_to_amm) {
        console.log(chalk.red('  ❌ ISSUE: Token has AMM trades but graduated_to_amm is false'));
        console.log(chalk.yellow('  → GraduationFixerService should have caught this'));
      }
      
      if (!token.bonding_curve_key) {
        console.log(chalk.yellow('  ⚠️  No bonding curve key - cannot monitor account updates'));
        console.log(chalk.yellow('  → This token may have graduated before we started monitoring'));
      }
      
      if (token.bonding_curve_complete && !token.graduated_to_amm) {
        console.log(chalk.red('  ❌ ISSUE: BC complete is true but graduated_to_amm is false'));
      }
      
      if (!token.bonding_curve_complete && !token.graduated_to_amm && ammTrades.count > 0) {
        console.log(chalk.red('  ❌ ISSUE: Token is trading on AMM but not marked as complete or graduated'));
      }
    }
    
    // 6. Check if GraduationFixerService is running
    console.log(chalk.cyan('\n\n🔧 System Check:'));
    
    const recentFixesResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE graduated_to_amm = true
        AND graduation_detected_at IS NOT NULL
        AND graduation_detected_at > NOW() - INTERVAL '1 hour'
    `);
    
    console.log(`  Graduations fixed in last hour: ${recentFixesResult.rows[0].count}`);
    
    // 7. Suggested fix
    console.log(chalk.cyan('\n💡 Suggested Fix:'));
    console.log('  1. Run the graduation fixer manually:');
    console.log(chalk.green('     npx tsx src/scripts/fix-graduated-tokens.ts'));
    console.log('  2. Check if GraduationFixerService is running in the main app');
    console.log('  3. Consider running the reset script to recalculate all progress:');
    console.log(chalk.green('     npx tsx src/scripts/reset-incorrect-bc-progress.ts'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run investigation
investigateGraduation().catch(console.error);