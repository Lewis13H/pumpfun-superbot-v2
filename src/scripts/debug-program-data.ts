import 'dotenv/config';
import { Pool } from 'pg';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test parsing Program data
function testParseProgramData() {
  // Sample base64 Program data from logs
  const sampleData = [
    // Add some real examples if we can find them
  ];

  console.log('Testing Program data parsing...\n');

  // The offsets from the parser
  const DISCRIMINATOR_SIZE = 8;
  const MINT_OFFSET = 8;
  const MINT_SIZE = 32;
  
  // Test with a known corrupted mint
  const corruptedMint = 'Pi83CqUD3Cp5kV5oAAAAAB6tgCoAAAAAwFgaghoAAAAe';
  console.log(`Corrupted mint: ${corruptedMint}`);
  
  try {
    const decoded = bs58.decode(corruptedMint);
    console.log(`Decoded length: ${decoded.length} bytes`);
    console.log(`Decoded hex: ${decoded.toString('hex')}`);
    
    // Try to interpret as Program data
    if (decoded.length >= 40) {
      const discriminator = decoded.slice(0, 8);
      const mintBytes = decoded.slice(8, 40);
      
      console.log(`\nDiscriminator: ${discriminator.toString('hex')}`);
      console.log(`Mint bytes (32): ${mintBytes.toString('hex')}`);
      
      try {
        const mint = new PublicKey(mintBytes);
        console.log(`Parsed mint: ${mint.toString()}`);
      } catch (e) {
        console.log('Failed to create PublicKey from mint bytes');
      }
    }
  } catch (e) {
    console.log('Failed to decode corrupted mint');
  }
}

async function checkRecentTrades() {
  console.log('\n\nChecking recent trade patterns...\n');
  
  // Get some recent trades with different mint patterns
  const query = `
    SELECT DISTINCT ON (pattern) 
      mint_address,
      substring(mint_address, 1, 10) as pattern,
      signature,
      created_at
    FROM trades_unified
    WHERE created_at > NOW() - INTERVAL '1 hour'
    ORDER BY pattern, created_at DESC
    LIMIT 20
  `;
  
  const result = await pool.query(query);
  
  for (const row of result.rows) {
    console.log(`Pattern: ${row.pattern}... -> ${row.mint_address}`);
    
    try {
      const decoded = bs58.decode(row.mint_address);
      console.log(`  Length: ${decoded.length} bytes, Valid: ${decoded.length === 32 ? '✓' : '✗'}`);
    } catch {
      console.log('  Invalid base58');
    }
  }
}

async function main() {
  testParseProgramData();
  await checkRecentTrades();
  await pool.end();
}

main().catch(console.error);