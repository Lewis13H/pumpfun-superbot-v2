#!/usr/bin/env node

/**
 * Test script to verify bonding curve database updates
 */

import { Pool } from 'pg';
import { configService } from '../core/config';

async function testDatabaseUpdates() {
  console.log('🧪 Testing Bonding Curve Database Updates...\n');
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    // Check tokens with bonding curve progress
    const progressResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        latest_bonding_curve_progress,
        bonding_curve_complete,
        graduated_to_amm,
        bonding_curve_key,
        updated_at
      FROM tokens_unified
      WHERE latest_bonding_curve_progress IS NOT NULL
         OR bonding_curve_complete = true
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    
    console.log('📊 Tokens with BC Progress Updates:');
    console.log('Total found:', progressResult.rows.length);
    
    progressResult.rows.forEach(token => {
      console.log(`\n${token.symbol || 'Unknown'}:`);
      console.log(`  Mint: ${token.mint_address.substring(0, 8)}...`);
      console.log(`  Progress: ${token.latest_bonding_curve_progress}%`);
      console.log(`  Complete: ${token.bonding_curve_complete}`);
      console.log(`  Graduated: ${token.graduated_to_amm}`);
      console.log(`  BC Key: ${token.bonding_curve_key ? token.bonding_curve_key.substring(0, 8) + '...' : 'null'}`);
      console.log(`  Last Update: ${token.updated_at}`);
    });
    
    // Check for mismatches
    const mismatchResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE bonding_curve_complete = true 
        AND graduated_to_amm = false
    `);
    
    console.log('\n⚠️  Potential Issues:');
    console.log(`  Tokens marked complete but not graduated: ${mismatchResult.rows[0].count}`);
    
    // Check recent updates
    const recentResult = await pool.query(`
      SELECT 
        COUNT(*) as count,
        MAX(updated_at) as last_update
      FROM tokens_unified
      WHERE updated_at > NOW() - INTERVAL '1 hour'
        AND (latest_bonding_curve_progress IS NOT NULL 
             OR bonding_curve_complete IS NOT NULL)
    `);
    
    console.log('\n📈 Recent Activity:');
    console.log(`  BC updates in last hour: ${recentResult.rows[0].count}`);
    console.log(`  Last update: ${recentResult.rows[0].last_update || 'None'}`);
    
    // Test update query
    console.log('\n🧪 Testing update query...');
    const testResult = await pool.query(`
      EXPLAIN (ANALYZE, BUFFERS) 
      UPDATE tokens_unified 
      SET bonding_curve_complete = false,
          latest_bonding_curve_progress = 50.0,
          graduated_to_amm = false,
          updated_at = NOW()
      WHERE mint_address = 'test123'
         OR (bonding_curve_key = 'test456' AND bonding_curve_key IS NOT NULL)
    `);
    
    console.log('✅ Update query plan verified');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

// Run test
testDatabaseUpdates().catch(console.error);