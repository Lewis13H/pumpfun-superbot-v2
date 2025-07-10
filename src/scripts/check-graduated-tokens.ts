/**
 * Check Graduated Tokens
 * Quick script to verify graduated token detection is working
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'CheckGraduatedTokens' });

async function checkGraduatedTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Get stats on graduated tokens
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_count,
        COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm_program_count,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as bc_complete_count,
        COUNT(*) as total_tokens,
        COUNT(*) FILTER (WHERE graduated_to_amm = true AND current_market_cap_usd >= 10000) as graduated_over_10k,
        COUNT(*) FILTER (WHERE graduated_to_amm = true AND created_at >= NOW() - INTERVAL '24 hours') as graduated_last_24h,
        COUNT(*) FILTER (WHERE graduated_to_amm = true AND created_at >= NOW() - INTERVAL '1 hour') as graduated_last_hour
      FROM tokens_unified
    `);
    
    const result = statsResult.rows[0];
    
    console.log('🎓 Graduated Token Statistics:\n');
    console.log(`Total Tokens: ${result.total_tokens}`);
    console.log(`Graduated to AMM: ${result.graduated_count} (${(result.graduated_count / result.total_tokens * 100).toFixed(1)}%)`);
    console.log(`Current Program = AMM: ${result.amm_program_count}`);
    console.log(`Bonding Curve Complete: ${result.bc_complete_count}`);
    console.log(`\nGraduated with MC > $10k: ${result.graduated_over_10k}`);
    console.log(`Graduated in last 24h: ${result.graduated_last_24h}`);
    console.log(`Graduated in last hour: ${result.graduated_last_hour}`);
    
    // Get sample of recently graduated tokens
    const recentGraduatedResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        current_market_cap_usd,
        current_price_usd,
        graduated_to_amm,
        current_program,
        created_at,
        updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = true
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    
    const recentGraduated = recentGraduatedResult.rows;
    if (recentGraduated.length > 0) {
      console.log('\n📋 Recently Graduated Tokens:');
      console.log('━'.repeat(100));
      
      recentGraduated.forEach((token: any, i: number) => {
        console.log(`\n${i + 1}. ${token.symbol || 'N/A'} - ${token.name || 'Unknown'}`);
        console.log(`   Mint: ${token.mint_address}`);
        console.log(`   Market Cap: $${token.current_market_cap_usd?.toFixed(2) || '0'}`);
        console.log(`   Price: $${token.current_price_usd?.toFixed(6) || '0'}`);
        console.log(`   Program: ${token.current_program}`);
        console.log(`   Graduated: ${token.updated_at.toISOString()}`);
      });
    }
    
    // Check for tokens that might be graduated but not marked
    const potentialGraduatedResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE current_program = 'amm_pool'
        AND graduated_to_amm = false
    `);
    
    if (potentialGraduatedResult.rows[0].count > 0) {
      console.log(`\n⚠️  Found ${potentialGraduatedResult.rows[0].count} tokens with AMM program but not marked as graduated`);
      console.log('   These will be fixed when AMM trades are detected for them.');
    }
    
    // Success criteria
    const graduationRate = result.graduated_count / result.total_tokens * 100;
    if (graduationRate < 1) {
      console.log('\n❌ Low graduation rate detected. AMM parsing may need investigation.');
    } else {
      console.log('\n✅ Graduation detection appears to be working correctly!');
    }
    
  } catch (error) {
    logger.error('Failed to check graduated tokens', error as Error);
  } finally {
    await pool.end();
  }
}

checkGraduatedTokens().catch(console.error);