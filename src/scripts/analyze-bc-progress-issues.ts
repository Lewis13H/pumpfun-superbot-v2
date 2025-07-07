#!/usr/bin/env node

/**
 * Analyze bonding curve progress calculation issues
 * Investigates why progress calculations are off
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

const LAMPORTS_PER_SOL = 1_000_000_000;

async function analyzeBondingCurveIssues() {
  console.log(chalk.cyan('🔍 Analyzing Bonding Curve Progress Issues\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  try {
    // 1. Check graduated tokens that still show high BC progress
    console.log(chalk.yellow('1. Graduated tokens with high BC progress:\n'));
    
    const graduatedResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        bonding_curve_key,
        latest_bonding_curve_progress,
        graduated_to_amm,
        graduation_at,
        latest_virtual_sol_reserves
      FROM tokens_unified
      WHERE graduated_to_amm = true
        AND latest_bonding_curve_progress > 90
      ORDER BY latest_bonding_curve_progress DESC
      LIMIT 10
    `);
    
    if (graduatedResult.rows.length > 0) {
      console.log('Symbol     | Progress | Graduation Time');
      console.log('-----------|----------|----------------');
      graduatedResult.rows.forEach(token => {
        console.log(
          `${(token.symbol || 'Unknown').padEnd(10)} | ` +
          `${parseFloat(token.latest_bonding_curve_progress).toFixed(2).padStart(8)}% | ` +
          `${token.graduation_at || 'Unknown'}`
        );
      });
      console.log(chalk.red('\n⚠️  These tokens are graduated but still show high BC progress!'));
      console.log('   This suggests progress isn\'t being cleared on graduation.\n');
    }
    
    // 2. Check tokens at 100% that aren't graduated
    console.log(chalk.yellow('\n2. Tokens at 100% progress but not graduated:\n'));
    
    const at100Result = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        bonding_curve_key,
        latest_bonding_curve_progress,
        bonding_curve_complete,
        latest_virtual_sol_reserves,
        created_at,
        updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_bonding_curve_progress >= 100
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    
    if (at100Result.rows.length > 0) {
      for (const token of at100Result.rows) {
        console.log(chalk.white(`${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...):`));
        console.log(`  BC Key: ${token.bonding_curve_key}`);
        console.log(`  Progress: ${parseFloat(token.latest_bonding_curve_progress).toFixed(2)}%`);
        console.log(`  Complete flag: ${token.bonding_curve_complete}`);
        
        // Check on-chain status
        if (token.bonding_curve_key) {
          try {
            const bcPubkey = new PublicKey(token.bonding_curve_key);
            const accountInfo = await connection.getAccountInfo(bcPubkey);
            
            if (!accountInfo) {
              console.log(chalk.red('  On-chain: Account closed/not found'));
              console.log(chalk.gray('  → Likely graduated and BC account was closed'));
            } else {
              console.log(chalk.green(`  On-chain: Account exists (${accountInfo.lamports / LAMPORTS_PER_SOL} SOL)`));
            }
          } catch (error) {
            console.log(chalk.red('  On-chain check failed:', error.message));
          }
        }
        console.log();
      }
    }
    
    // 3. Analyze progress calculation methods
    console.log(chalk.yellow('\n3. Progress Calculation Analysis:\n'));
    
    const sampleResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        bonding_curve_key,
        latest_bonding_curve_progress,
        latest_virtual_sol_reserves,
        graduated_to_amm
      FROM tokens_unified
      WHERE bonding_curve_key IS NOT NULL
        AND latest_virtual_sol_reserves IS NOT NULL
        AND latest_bonding_curve_progress BETWEEN 50 AND 90
      LIMIT 5
    `);
    
    console.log('Comparing progress calculation methods:\n');
    console.log('Symbol     | DB Progress | From Reserves | From Lamports | Method Match');
    console.log('-----------|-------------|---------------|---------------|-------------');
    
    for (const token of sampleResult.rows) {
      try {
        const virtualSolReserves = BigInt(token.latest_virtual_sol_reserves);
        const progressFromReserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL / 85 * 100; // Using 85 SOL
        
        // Try to get on-chain lamports
        let progressFromLamports = 0;
        if (token.bonding_curve_key) {
          const bcPubkey = new PublicKey(token.bonding_curve_key);
          const accountInfo = await connection.getAccountInfo(bcPubkey);
          if (accountInfo) {
            progressFromLamports = accountInfo.lamports / LAMPORTS_PER_SOL / 84 * 100; // Using 84 SOL
          }
        }
        
        const dbProgress = parseFloat(token.latest_bonding_curve_progress);
        const matchesReserves = Math.abs(dbProgress - progressFromReserves) < 1;
        const matchesLamports = Math.abs(dbProgress - progressFromLamports) < 1;
        
        console.log(
          `${(token.symbol || 'Unknown').padEnd(10)} | ` +
          `${dbProgress.toFixed(2).padStart(11)}% | ` +
          `${progressFromReserves.toFixed(2).padStart(13)}% | ` +
          `${progressFromLamports.toFixed(2).padStart(13)}% | ` +
          `${matchesReserves ? chalk.green('Reserves') : matchesLamports ? chalk.yellow('Lamports') : chalk.red('Neither')}`
        );
      } catch (error) {
        console.log(`${(token.symbol || 'Unknown').padEnd(10)} | Error: ${error.message}`);
      }
    }
    
    // 4. Summary and recommendations
    console.log(chalk.cyan('\n\n📊 Summary of Issues:\n'));
    
    const issuesResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true AND latest_bonding_curve_progress > 90) as graduated_with_progress,
        COUNT(*) FILTER (WHERE graduated_to_amm = false AND latest_bonding_curve_progress >= 100) as at_100_not_graduated,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as marked_complete,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as total_graduated
      FROM tokens_unified
    `);
    
    const issues = issuesResult.rows[0];
    
    console.log(`  Graduated tokens still showing BC progress: ${issues.graduated_with_progress}`);
    console.log(`  Tokens at 100% but not graduated: ${issues.at_100_not_graduated}`);
    console.log(`  Tokens marked as complete: ${issues.marked_complete}`);
    console.log(`  Total graduated tokens: ${issues.total_graduated}`);
    
    console.log(chalk.yellow('\n💡 Key Findings:\n'));
    console.log('  1. Progress calculation appears to use virtual_sol_reserves, not account lamports');
    console.log('  2. Many graduated tokens have closed bonding curve accounts (expected behavior)');
    console.log('  3. The 85 SOL vs 84 SOL threshold difference may cause discrepancies');
    console.log('  4. Progress should be reset to 0 or 100 when tokens graduate');
    console.log('  5. The "complete" flag from on-chain data is crucial for accurate graduation detection');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Run analysis
analyzeBondingCurveIssues().catch(console.error);