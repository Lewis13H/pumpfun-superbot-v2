#!/usr/bin/env node

/**
 * Test script to verify bonding curve progress calculation accuracy
 * Compares our calculated progress against actual on-chain data
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
const GRADUATION_SOL_TARGET = 84; // Based on our implementation

interface TestResult {
  symbol: string;
  mintAddress: string;
  bondingCurveKey: string;
  
  // Database values
  dbProgress: number;
  dbComplete: boolean;
  dbGraduated: boolean;
  dbVirtualSolReserves: string | null;
  
  // On-chain values
  onchainLamports: number;
  onchainSolInCurve: number;
  onchainProgress: number;
  onchainComplete: boolean;
  onchainVirtualSolReserves: bigint;
  
  // Comparison
  progressDiff: number;
  completeMismatch: boolean;
  accuracy: 'EXACT' | 'CLOSE' | 'OFF' | 'ERROR';
  error?: string;
}

async function testBondingCurveProgressAccuracy() {
  console.log(chalk.cyan('🧪 Testing Bonding Curve Progress Accuracy\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  // Use Solana mainnet RPC
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  try {
    // Get tokens with bonding curve progress from database
    const tokensResult = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.bonding_curve_key,
        t.latest_bonding_curve_progress,
        t.bonding_curve_complete,
        t.graduated_to_amm,
        t.latest_virtual_sol_reserves
      FROM tokens_unified t
      WHERE t.bonding_curve_key IS NOT NULL
        AND t.latest_bonding_curve_progress IS NOT NULL
        AND t.graduated_to_amm = false
      ORDER BY t.latest_bonding_curve_progress DESC
      LIMIT 20
    `);
    
    console.log(chalk.yellow(`Found ${tokensResult.rows.length} tokens to test\n`));
    
    const results: TestResult[] = [];
    
    for (const token of tokensResult.rows) {
      const result: TestResult = {
        symbol: token.symbol || 'Unknown',
        mintAddress: token.mint_address,
        bondingCurveKey: token.bonding_curve_key,
        dbProgress: parseFloat(token.latest_bonding_curve_progress),
        dbComplete: token.bonding_curve_complete,
        dbGraduated: token.graduated_to_amm,
        dbVirtualSolReserves: token.latest_virtual_sol_reserves,
        onchainLamports: 0,
        onchainSolInCurve: 0,
        onchainProgress: 0,
        onchainComplete: false,
        onchainVirtualSolReserves: 0n,
        progressDiff: 0,
        completeMismatch: false,
        accuracy: 'ERROR'
      };
      
      try {
        // Fetch on-chain account data
        const bondingCurvePubkey = new PublicKey(token.bonding_curve_key);
        const accountInfo = await connection.getAccountInfo(bondingCurvePubkey);
        
        if (!accountInfo) {
          result.error = 'Account not found on chain';
          results.push(result);
          continue;
        }
        
        // Check discriminator
        const discriminator = accountInfo.data.slice(0, 8);
        if (!discriminator.equals(BONDING_CURVE_DISCRIMINATOR)) {
          result.error = 'Invalid discriminator';
          results.push(result);
          continue;
        }
        
        // Decode account data
        const decoded = BONDING_CURVE_SCHEMA.decode(accountInfo.data.slice(8));
        
        // Calculate progress based on lamports
        result.onchainLamports = accountInfo.lamports;
        result.onchainSolInCurve = accountInfo.lamports / LAMPORTS_PER_SOL;
        result.onchainProgress = Math.min((result.onchainSolInCurve / GRADUATION_SOL_TARGET) * 100, 100);
        result.onchainComplete = decoded.complete;
        result.onchainVirtualSolReserves = decoded.virtualSolReserves;
        
        // Compare results
        result.progressDiff = Math.abs(result.dbProgress - result.onchainProgress);
        result.completeMismatch = result.dbComplete !== result.onchainComplete;
        
        // Determine accuracy
        if (result.progressDiff < 0.01) {
          result.accuracy = 'EXACT';
        } else if (result.progressDiff < 1) {
          result.accuracy = 'CLOSE';
        } else {
          result.accuracy = 'OFF';
        }
        
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error';
      }
      
      results.push(result);
    }
    
    // Display results
    console.log(chalk.cyan('📊 Test Results:\n'));
    
    // Summary table
    console.log(chalk.white('Symbol     | DB Prog | Chain Prog | Diff   | DB Compl | Chain Compl | Accuracy'));
    console.log(chalk.gray('-----------|---------|------------|--------|----------|-------------|----------'));
    
    let exactCount = 0;
    let closeCount = 0;
    let offCount = 0;
    let errorCount = 0;
    let completeMismatchCount = 0;
    
    results.forEach(result => {
      const progressColor = result.accuracy === 'EXACT' ? chalk.green :
                          result.accuracy === 'CLOSE' ? chalk.yellow :
                          result.accuracy === 'OFF' ? chalk.red : chalk.gray;
      
      const completeColor = result.completeMismatch ? chalk.red : chalk.green;
      
      console.log(
        `${result.symbol.padEnd(10)} | ` +
        `${result.dbProgress.toFixed(2).padStart(7)}% | ` +
        `${result.accuracy !== 'ERROR' ? result.onchainProgress.toFixed(2).padStart(10) + '%' : 'ERROR'.padStart(11)} | ` +
        `${result.accuracy !== 'ERROR' ? progressColor(result.progressDiff.toFixed(2).padStart(6) + '%') : chalk.gray('   N/A')} | ` +
        `${result.dbComplete.toString().padStart(8)} | ` +
        `${result.accuracy !== 'ERROR' ? completeColor(result.onchainComplete.toString().padStart(11)) : chalk.gray('      ERROR')} | ` +
        progressColor(result.accuracy)
      );
      
      if (result.accuracy === 'EXACT') exactCount++;
      else if (result.accuracy === 'CLOSE') closeCount++;
      else if (result.accuracy === 'OFF') offCount++;
      else errorCount++;
      
      if (result.completeMismatch) completeMismatchCount++;
    });
    
    // Detailed analysis for problematic tokens
    const problematicTokens = results.filter(r => r.accuracy === 'OFF' || r.completeMismatch || r.error);
    if (problematicTokens.length > 0) {
      console.log(chalk.yellow('\n\n📍 Detailed Analysis of Problematic Tokens:\n'));
      
      problematicTokens.forEach(result => {
        console.log(chalk.white(`${result.symbol} (${result.mintAddress.substring(0, 8)}...):`));
        console.log(`  Bonding Curve: ${result.bondingCurveKey}`);
        console.log(`  DB Progress: ${result.dbProgress.toFixed(2)}% | On-chain: ${result.onchainProgress.toFixed(2)}%`);
        console.log(`  DB Complete: ${result.dbComplete} | On-chain: ${result.onchainComplete}`);
        console.log(`  On-chain SOL: ${result.onchainSolInCurve.toFixed(4)} / ${GRADUATION_SOL_TARGET} SOL`);
        console.log(`  On-chain lamports: ${result.onchainLamports.toLocaleString()}`);
        
        if (result.dbVirtualSolReserves) {
          const dbReserves = BigInt(result.dbVirtualSolReserves);
          const reserveDiff = Number(result.onchainVirtualSolReserves - dbReserves) / LAMPORTS_PER_SOL;
          console.log(`  Virtual SOL Reserves Diff: ${reserveDiff.toFixed(6)} SOL`);
        }
        
        if (result.error) {
          console.log(chalk.red(`  Error: ${result.error}`));
        }
        console.log();
      });
    }
    
    // Summary statistics
    console.log(chalk.cyan('\n📈 Summary Statistics:\n'));
    console.log(`  Total tokens tested: ${results.length}`);
    console.log(`  ${chalk.green('Exact matches')}: ${exactCount} (${(exactCount/results.length*100).toFixed(1)}%)`);
    console.log(`  ${chalk.yellow('Close matches')}: ${closeCount} (${(closeCount/results.length*100).toFixed(1)}%)`);
    console.log(`  ${chalk.red('Off matches')}: ${offCount} (${(offCount/results.length*100).toFixed(1)}%)`);
    console.log(`  ${chalk.gray('Errors')}: ${errorCount} (${(errorCount/results.length*100).toFixed(1)}%)`);
    console.log(`  Complete flag mismatches: ${completeMismatchCount}`);
    
    // Recommendations
    if (offCount > 0 || completeMismatchCount > 0) {
      console.log(chalk.yellow('\n💡 Recommendations:\n'));
      
      if (offCount > 0) {
        console.log('  • Progress calculation differences detected');
        console.log('  • Check if we\'re using the correct graduation threshold (currently 84 SOL)');
        console.log('  • Verify lamports are being read correctly from account data');
      }
      
      if (completeMismatchCount > 0) {
        console.log('  • Complete flag mismatches found');
        console.log('  • Ensure account monitoring is processing all updates');
        console.log('  • Check if there\'s a delay in database updates');
      }
    } else if (exactCount === results.length - errorCount) {
      console.log(chalk.green('\n✅ All progress calculations are accurate!'));
    }
    
  } catch (error) {
    console.error('Error running test:', error);
  } finally {
    await pool.end();
  }
}

// Run test
testBondingCurveProgressAccuracy().catch(console.error);