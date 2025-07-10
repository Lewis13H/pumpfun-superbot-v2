/**
 * Simple check for graduated tokens
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // First check what columns exist
    const columnsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens_unified'
      ORDER BY ordinal_position
    `);
    
    console.log('Available columns:', columnsResult.rows.map(r => r.column_name).join(', '));
    
    // Basic graduated token check
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated
      FROM tokens_unified
    `);
    
    console.log('\n🎓 Graduated Tokens:');
    console.log(`Total: ${result.rows[0].total}`);
    console.log(`Graduated: ${result.rows[0].graduated}`);
    console.log(`Percentage: ${(result.rows[0].graduated / result.rows[0].total * 100).toFixed(1)}%`);
    
    // Get some samples
    const samples = await pool.query(`
      SELECT mint_address, symbol, name, graduated_to_amm, current_program
      FROM tokens_unified
      WHERE graduated_to_amm = true
      LIMIT 5
    `);
    
    if (samples.rows.length > 0) {
      console.log('\nSample graduated tokens:');
      samples.rows.forEach((token, i) => {
        console.log(`${i + 1}. ${token.symbol || 'N/A'} - ${token.mint_address.slice(0, 8)}...`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);