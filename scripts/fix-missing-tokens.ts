// scripts/fix-missing-tokens.ts
import { pool } from '../src/database';

async function fixMissingTokens() {
  // Find tokens in price_updates that don't exist in tokens table
  const result = await pool.query(`
    SELECT DISTINCT p.token as address
    FROM price_updates p
    LEFT JOIN tokens t ON p.token = t.address
    WHERE t.address IS NULL
    LIMIT 100
  `);
  
  console.log(`Found ${result.rows.length} tokens with price updates but no token record`);
  
  // Create minimal token entries for them
  for (const row of result.rows) {
    await pool.query(`
      INSERT INTO tokens (address, bonding_curve, created_at, creator)
      VALUES ($1, 'recovered-unknown', NOW(), 'unknown')
      ON CONFLICT (address) DO NOTHING
    `, [row.address]);
  }
  
  console.log('Done!');
}

fixMissingTokens();