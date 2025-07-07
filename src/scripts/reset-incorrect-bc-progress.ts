#!/usr/bin/env node

/**
 * Reset incorrect bonding curve progress values
 * This script clears progress for graduated tokens and recalculates for active ones
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
const GRADUATION_SOL_TARGET = 84;

async function resetIncorrectProgress() {
  console.log(chalk.cyan('🔧 Resetting Incorrect Bonding Curve Progress\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  try {
    // 1. First, let's identify graduated tokens that shouldn't have progress
    console.log(chalk.yellow('1. Finding graduated tokens to reset...\n'));
    
    const graduatedResult = await pool.query(`
      SELECT DISTINCT t.mint_address, t.symbol, t.bonding_curve_key
      FROM tokens_unified t
      WHERE EXISTS (
        SELECT 1 FROM trades_unified tr
        WHERE tr.mint_address = t.mint_address
        AND tr.program = 'amm_pool'
      )
    `);
    
    console.log(`Found ${graduatedResult.rows.length} tokens with AMM trades (likely graduated)\n`);
    
    // Update these tokens
    if (graduatedResult.rows.length > 0) {
      const updateResult = await pool.query(`
        UPDATE tokens_unified
        SET 
          graduated_to_amm = true,
          latest_bonding_curve_progress = 100,
          updated_at = NOW()
        WHERE mint_address = ANY($1::text[])
        RETURNING mint_address, symbol
      `, [graduatedResult.rows.map(r => r.mint_address)]);
      
      console.log(chalk.green(`✅ Marked ${updateResult.rows.length} tokens as graduated\n`));
    }
    
    // 2. Now fix tokens that show 100% but aren't graduated
    console.log(chalk.yellow('2. Checking tokens at 100% progress...\n'));
    
    const at100Result = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        bonding_curve_key,
        latest_bonding_curve_progress
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_bonding_curve_progress >= 100
        AND bonding_curve_key IS NOT NULL
      LIMIT 20
    `);
    
    console.log(`Found ${at100Result.rows.length} tokens at 100% to verify\n`);
    
    let corrected = 0;
    let graduated = 0;
    let errors = 0;
    
    for (const token of at100Result.rows) {
      try {
        const bcPubkey = new PublicKey(token.bonding_curve_key);
        const accountInfo = await connection.getAccountInfo(bcPubkey);
        
        if (!accountInfo) {
          // Account closed - likely graduated
          await pool.query(`
            UPDATE tokens_unified
            SET 
              graduated_to_amm = true,
              bonding_curve_complete = true,
              updated_at = NOW()
            WHERE mint_address = $1
          `, [token.mint_address]);
          graduated++;
          console.log(chalk.green(`  ${token.symbol} - Account closed, marked as graduated`));
        } else {
          // Calculate real progress from lamports
          const solInCurve = accountInfo.lamports / LAMPORTS_PER_SOL;
          const realProgress = Math.min((solInCurve / GRADUATION_SOL_TARGET) * 100, 100);
          
          // Check if account data shows complete
          let isComplete = false;
          try {
            const discriminator = accountInfo.data.slice(0, 8);
            if (discriminator.equals(BONDING_CURVE_DISCRIMINATOR)) {
              const decoded = BONDING_CURVE_SCHEMA.decode(accountInfo.data.slice(8));
              isComplete = decoded.complete;
            }
          } catch {}
          
          await pool.query(`
            UPDATE tokens_unified
            SET 
              latest_bonding_curve_progress = $2,
              bonding_curve_complete = $3,
              graduated_to_amm = $4,
              updated_at = NOW()
            WHERE mint_address = $1
          `, [token.mint_address, realProgress, isComplete, isComplete]);
          
          corrected++;
          console.log(chalk.yellow(`  ${token.symbol} - Updated: ${token.latest_bonding_curve_progress}% → ${realProgress.toFixed(2)}% (Complete: ${isComplete})`));
        }
      } catch (error) {
        errors++;
        console.log(chalk.red(`  ${token.symbol} - Error: ${error.message}`));
      }
    }
    
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(`  Corrected progress: ${corrected}`);
    console.log(`  Marked as graduated: ${graduated}`);
    console.log(`  Errors: ${errors}`);
    
    // 3. Clear progress for tokens without bonding curve keys
    console.log(chalk.yellow('\n3. Cleaning up tokens without bonding curve keys...\n'));
    
    const cleanupResult = await pool.query(`
      UPDATE tokens_unified
      SET 
        latest_bonding_curve_progress = NULL,
        bonding_curve_complete = false
      WHERE bonding_curve_key IS NULL
        AND latest_bonding_curve_progress IS NOT NULL
    `);
    
    console.log(chalk.green(`✅ Cleared progress for ${cleanupResult.rowCount} tokens without BC keys\n`));
    
    // 4. Final stats
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as complete,
        COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 90 AND graduated_to_amm = false) as near_graduation,
        COUNT(*) FILTER (WHERE latest_bonding_curve_progress IS NOT NULL) as with_progress
      FROM tokens_unified
    `);
    
    const stats = statsResult.rows[0];
    console.log(chalk.cyan('📈 Final Database Stats:'));
    console.log(`  Graduated tokens: ${stats.graduated}`);
    console.log(`  Complete tokens: ${stats.complete}`);
    console.log(`  Near graduation (90%+): ${stats.near_graduation}`);
    console.log(`  Total with progress: ${stats.with_progress}`);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run reset
resetIncorrectProgress().catch(console.error);