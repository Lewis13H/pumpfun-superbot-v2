#!/usr/bin/env tsx

/**
 * Script to fix bonding curve progress calculations for existing tokens
 * Updates the progress calculation to use the correct formula:
 * - 30 SOL = 0% progress
 * - 85 SOL = 100% progress
 */

import 'dotenv/config';
import { db } from '../src/database';
import { calculateBondingCurveProgress } from '../src/services/bc-price-calculator';

async function fixBondingCurveProgress() {
  console.log('🔧 Fixing bonding curve progress calculations...\n');
  
  try {
    // Get all tokens with bonding curve data
    const result = await db.query(`
      SELECT 
        mint_address,
        latest_virtual_sol_reserves,
        latest_bonding_curve_progress,
        graduated_to_amm
      FROM tokens_unified
      WHERE latest_virtual_sol_reserves IS NOT NULL
        AND graduated_to_amm = false
      ORDER BY latest_market_cap_usd DESC
    `);
    
    console.log(`Found ${result.rows.length} tokens to update\n`);
    
    let updated = 0;
    let errors = 0;
    
    for (const token of result.rows) {
      try {
        const virtualSolReserves = BigInt(token.latest_virtual_sol_reserves);
        const newProgress = calculateBondingCurveProgress(virtualSolReserves);
        const oldProgress = parseFloat(token.latest_bonding_curve_progress) || 0;
        
        // Only update if there's a significant difference
        if (Math.abs(newProgress - oldProgress) > 0.1) {
          await db.query(`
            UPDATE tokens_unified
            SET latest_bonding_curve_progress = $2
            WHERE mint_address = $1
          `, [token.mint_address, newProgress]);
          
          const solInCurve = Number(virtualSolReserves) / 1e9;
          console.log(`✅ ${token.mint_address.slice(0, 8)}...`);
          console.log(`   SOL in curve: ${solInCurve.toFixed(2)} SOL`);
          console.log(`   Old progress: ${oldProgress.toFixed(1)}%`);
          console.log(`   New progress: ${newProgress.toFixed(1)}%\n`);
          
          updated++;
        }
      } catch (error) {
        console.error(`❌ Error updating ${token.mint_address}:`, error);
        errors++;
      }
    }
    
    console.log(`\n✅ Updated ${updated} tokens`);
    console.log(`❌ Errors: ${errors}`);
    
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  }
}

// Run the script
fixBondingCurveProgress()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });