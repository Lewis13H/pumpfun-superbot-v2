/**
 * Simple Dashboard Data Check
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log('🌐 Dashboard Data Check\n');
    
    // Basic stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm
      FROM tokens_unified
    `);
    
    console.log('📊 Token Stats:');
    console.log(`Total: ${stats.rows[0].total}`);
    console.log(`Graduated: ${stats.rows[0].graduated}`);
    console.log(`AMM Program: ${stats.rows[0].amm}`);
    
    // Recent AMM tokens
    console.log('\n🏆 Recent AMM Tokens:');
    const ammTokens = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        graduated_to_amm,
        current_program,
        updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = true
         OR current_program = 'amm_pool'
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    
    if (ammTokens.rows.length === 0) {
      console.log('No AMM tokens found');
    } else {
      ammTokens.rows.forEach((token, i) => {
        console.log(`${i + 1}. ${token.symbol || 'N/A'} - ${token.mint_address.slice(0, 16)}...`);
        console.log(`   Graduated: ${token.graduated_to_amm ? '✅' : '❌'} | Program: ${token.current_program}`);
        console.log(`   Updated: ${token.updated_at.toISOString()}\n`);
      });
    }
    
    // Recent trades
    const trades = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE program = 'amm_pool') as amm,
        COUNT(*) FILTER (WHERE program = 'bonding_curve') as bc
      FROM trades_unified
      WHERE created_at >= NOW() - INTERVAL '1 hour'
    `);
    
    console.log('📈 Recent Trades (last hour):');
    console.log(`Total: ${trades.rows[0].total}`);
    console.log(`AMM: ${trades.rows[0].amm}`);
    console.log(`BC: ${trades.rows[0].bc}`);
    
    // Dashboard info
    console.log('\n🔗 Dashboard Access:');
    console.log('URL: http://localhost:3001');
    console.log('The dashboard auto-refreshes every 10 seconds');
    console.log('Use the "Graduated" filter to see AMM tokens');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);