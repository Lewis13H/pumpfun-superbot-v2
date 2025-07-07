#!/usr/bin/env node

/**
 * Verify bonding curve progress calculation fix
 * Compares database values after our corrections
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';

const LAMPORTS_PER_SOL = 1_000_000_000;
const GRADUATION_SOL_TARGET = 84;

async function verifyProgressFix() {
  console.log(chalk.cyan('✅ Verifying Bonding Curve Progress Fix\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  try {
    // Get tokens with BC progress
    const tokensResult = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.bonding_curve_key,
        t.latest_bonding_curve_progress,
        t.bonding_curve_complete,
        t.graduated_to_amm
      FROM tokens_unified t
      WHERE t.bonding_curve_key IS NOT NULL
        AND t.latest_bonding_curve_progress IS NOT NULL
      ORDER BY t.latest_bonding_curve_progress DESC
      LIMIT 10
    `);
    
    console.log(chalk.yellow('Top 10 tokens by progress:\n'));
    console.log('Symbol     | DB Progress | On-chain SOL | Calculated | Complete | Match?');
    console.log('-----------|-------------|--------------|------------|----------|-------');
    
    for (const token of tokensResult.rows) {
      try {
        const bcPubkey = new PublicKey(token.bonding_curve_key);
        const accountInfo = await connection.getAccountInfo(bcPubkey);
        
        if (!accountInfo) {
          console.log(
            `${(token.symbol || 'Unknown').padEnd(10)} | ` +
            `${parseFloat(token.latest_bonding_curve_progress).toFixed(2).padStart(11)}% | ` +
            chalk.gray('CLOSED'.padStart(12)) + ' | ' +
            chalk.gray('N/A'.padStart(10)) + ' | ' +
            `${token.bonding_curve_complete.toString().padStart(8)} | ` +
            chalk.gray('Graduated')
          );
        } else {
          const solInCurve = accountInfo.lamports / LAMPORTS_PER_SOL;
          const calculatedProgress = Math.min((solInCurve / GRADUATION_SOL_TARGET) * 100, 100);
          const dbProgress = parseFloat(token.latest_bonding_curve_progress);
          const match = Math.abs(dbProgress - calculatedProgress) < 0.1;
          
          console.log(
            `${(token.symbol || 'Unknown').padEnd(10)} | ` +
            `${dbProgress.toFixed(2).padStart(11)}% | ` +
            `${solInCurve.toFixed(2).padStart(12)} | ` +
            `${calculatedProgress.toFixed(2).padStart(10)}% | ` +
            `${token.bonding_curve_complete.toString().padStart(8)} | ` +
            (match ? chalk.green('✓') : chalk.red('✗'))
          );
        }
      } catch (error) {
        console.log(`${(token.symbol || 'Unknown').padEnd(10)} | Error: ${error.message}`);
      }
    }
    
    // Summary stats
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as complete_count,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_count,
        COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 100 AND graduated_to_amm = false) as at_100_not_graduated,
        COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 90 AND graduated_to_amm = false) as near_graduation
      FROM tokens_unified
    `);
    
    const stats = statsResult.rows[0];
    
    console.log(chalk.cyan('\n📊 Database Summary:'));
    console.log(`  Tokens marked complete: ${stats.complete_count}`);
    console.log(`  Graduated tokens: ${stats.graduated_count}`);
    console.log(`  At 100% but not graduated: ${stats.at_100_not_graduated}`);
    console.log(`  Near graduation (90%+): ${stats.near_graduation}`);
    
    // Check EGGBOY specifically since it showed complete: true
    const eggboyResult = await pool.query(`
      SELECT * FROM tokens_unified WHERE symbol = 'EGGBOY'
    `);
    
    if (eggboyResult.rows.length > 0) {
      const eggboy = eggboyResult.rows[0];
      console.log(chalk.yellow('\n🥚 EGGBOY Token Status:'));
      console.log(`  Mint: ${eggboy.mint_address}`);
      console.log(`  BC Key: ${eggboy.bonding_curve_key}`);
      console.log(`  Progress: ${eggboy.latest_bonding_curve_progress}%`);
      console.log(`  Complete: ${eggboy.bonding_curve_complete}`);
      console.log(`  Graduated: ${eggboy.graduated_to_amm}`);
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run verification
verifyProgressFix().catch(console.error);