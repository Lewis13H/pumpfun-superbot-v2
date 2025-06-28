import 'dotenv/config';
import { Pool } from 'pg';
import bs58 from 'bs58';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function analyzeMints() {
  console.log('Analyzing mint addresses...\n');

  // Get sample of corrupted addresses
  const corruptedQuery = `
    SELECT mint_address, created_at, 
           (SELECT COUNT(*) FROM trades_unified WHERE mint_address = t.mint_address) as trade_count
    FROM tokens_unified t
    WHERE mint_address LIKE 'P%AAAA%' 
       OR mint_address LIKE 'RSH%' 
       OR mint_address LIKE 'Pi8%'
       OR mint_address ~ 'A{4,}'  -- Contains 4+ consecutive As
    ORDER BY created_at DESC
    LIMIT 20
  `;

  const corruptedResult = await pool.query(corruptedQuery);
  
  console.log('Sample of corrupted addresses:');
  console.log('================================');
  
  for (const row of corruptedResult.rows) {
    console.log(`\nMint: ${row.mint_address}`);
    console.log(`Created: ${row.created_at}`);
    console.log(`Trades: ${row.trade_count}`);
    
    // Try to decode
    try {
      const decoded = bs58.decode(row.mint_address);
      console.log(`Decoded length: ${decoded.length} bytes`);
      console.log(`Decoded (hex): ${decoded.toString('hex').substring(0, 64)}...`);
      
      // Check if it's valid 32 bytes
      if (decoded.length === 32) {
        console.log('✓ Valid length for Solana pubkey');
      } else {
        console.log(`✗ Invalid length: ${decoded.length} (expected 32)`);
      }
    } catch (error) {
      console.log('✗ Failed to decode as base58');
    }
  }

  // Compare with valid pump addresses
  console.log('\n\nSample of valid pump addresses:');
  console.log('=================================');
  
  const validQuery = `
    SELECT mint_address, symbol, name, created_at,
           (SELECT COUNT(*) FROM trades_unified WHERE mint_address = t.mint_address) as trade_count
    FROM tokens_unified t
    WHERE mint_address LIKE '%pump'
      AND mint_address NOT LIKE 'P%AAAA%'
      AND mint_address NOT LIKE 'RSH%'
      AND mint_address NOT LIKE 'Pi8%'
    ORDER BY created_at DESC
    LIMIT 10
  `;

  const validResult = await pool.query(validQuery);
  
  for (const row of validResult.rows) {
    console.log(`\nMint: ${row.mint_address}`);
    console.log(`Symbol: ${row.symbol || 'N/A'}, Name: ${row.name || 'N/A'}`);
    console.log(`Trades: ${row.trade_count}`);
  }

  // Check distribution
  console.log('\n\nToken distribution:');
  console.log('====================');
  
  const statsQuery = `
    SELECT 
      COUNT(*) FILTER (WHERE mint_address LIKE '%pump') as pump_tokens,
      COUNT(*) FILTER (WHERE mint_address LIKE 'P%AAAA%' OR mint_address LIKE 'RSH%' OR mint_address LIKE 'Pi8%') as corrupted_tokens,
      COUNT(*) FILTER (WHERE mint_address NOT LIKE '%pump' AND mint_address NOT LIKE 'P%AAAA%' AND mint_address NOT LIKE 'RSH%' AND mint_address NOT LIKE 'Pi8%') as other_tokens,
      COUNT(*) as total_tokens
    FROM tokens_unified
  `;

  const statsResult = await pool.query(statsQuery);
  const stats = statsResult.rows[0];
  
  console.log(`Total tokens: ${stats.total_tokens}`);
  console.log(`Pump tokens: ${stats.pump_tokens} (${(stats.pump_tokens / stats.total_tokens * 100).toFixed(2)}%)`);
  console.log(`Corrupted tokens: ${stats.corrupted_tokens} (${(stats.corrupted_tokens / stats.total_tokens * 100).toFixed(2)}%)`);
  console.log(`Other tokens: ${stats.other_tokens} (${(stats.other_tokens / stats.total_tokens * 100).toFixed(2)}%)`);

  await pool.end();
}

analyzeMints().catch(console.error);