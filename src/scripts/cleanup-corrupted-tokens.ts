import 'dotenv/config';
import { Pool } from 'pg';
import bs58 from 'bs58';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function cleanupCorruptedTokens() {
  console.log('Cleaning up corrupted tokens...\n');

  // First, let's identify all corrupted tokens
  const query = `
    SELECT mint_address, 
           (SELECT COUNT(*) FROM trades_unified WHERE mint_address = t.mint_address) as trade_count
    FROM tokens_unified t
    WHERE LENGTH(mint_address) = 44
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query);
  
  let validCount = 0;
  let invalidCount = 0;
  const toDelete: string[] = [];

  console.log(`Checking ${result.rows.length} tokens with 44-character addresses...\n`);

  for (const row of result.rows) {
    try {
      const decoded = bs58.decode(row.mint_address);
      if (decoded.length === 32) {
        validCount++;
      } else {
        invalidCount++;
        toDelete.push(row.mint_address);
        console.log(`Invalid (${decoded.length} bytes): ${row.mint_address} - ${row.trade_count} trades`);
      }
    } catch {
      invalidCount++;
      toDelete.push(row.mint_address);
      console.log(`Invalid (decode failed): ${row.mint_address} - ${row.trade_count} trades`);
    }
  }

  console.log(`\nSummary:`);
  console.log(`Valid: ${validCount}`);
  console.log(`Invalid: ${invalidCount}`);

  if (toDelete.length > 0) {
    console.log(`\nWill delete ${toDelete.length} corrupted tokens and their associated trades.`);
    console.log('\nDeleting corrupted tokens...');
    
    // Delete in batches
    const batchSize = 100;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');
      
      // Delete trades first (foreign key constraint)
      await pool.query(
        `DELETE FROM trades_unified WHERE mint_address IN (${placeholders})`,
        batch
      );
      
      // Delete price snapshots
      await pool.query(
        `DELETE FROM price_snapshots_unified WHERE mint_address IN (${placeholders})`,
        batch
      );
      
      // Delete tokens
      await pool.query(
        `DELETE FROM tokens_unified WHERE mint_address IN (${placeholders})`,
        batch
      );
      
      console.log(`Deleted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toDelete.length / batchSize)}`);
    }
    
    console.log('\nCleanup complete!');
  }

  await pool.end();
}

cleanupCorruptedTokens().catch(console.error);