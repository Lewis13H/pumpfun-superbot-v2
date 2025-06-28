import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function keepOnlyPumpTokens() {
  console.log('Keeping only tokens with "pump" in mint address...\n');

  // First, get counts
  const countQuery = `
    SELECT 
      COUNT(*) as total_tokens,
      COUNT(*) FILTER (WHERE mint_address LIKE '%pump%') as pump_tokens,
      COUNT(*) FILTER (WHERE mint_address NOT LIKE '%pump%') as non_pump_tokens
    FROM tokens_unified
  `;

  const countResult = await pool.query(countQuery);
  const counts = countResult.rows[0];
  
  console.log(`Current state:`);
  console.log(`Total tokens: ${counts.total_tokens}`);
  console.log(`Pump tokens: ${counts.pump_tokens}`);
  console.log(`Non-pump tokens: ${counts.non_pump_tokens}`);

  if (counts.non_pump_tokens === 0) {
    console.log('\nNo non-pump tokens to delete.');
    await pool.end();
    return;
  }

  console.log(`\nDeleting ${counts.non_pump_tokens} non-pump tokens and their associated data...`);

  try {
    // Start transaction
    await pool.query('BEGIN');

    // Delete trades for non-pump tokens
    const tradesResult = await pool.query(`
      DELETE FROM trades_unified 
      WHERE mint_address NOT LIKE '%pump%'
    `);
    console.log(`Deleted ${tradesResult.rowCount} trades`);

    // Delete price snapshots for non-pump tokens
    const snapshotsResult = await pool.query(`
      DELETE FROM price_snapshots_unified 
      WHERE mint_address NOT LIKE '%pump%'
    `);
    console.log(`Deleted ${snapshotsResult.rowCount} price snapshots`);

    // Delete the tokens themselves
    const tokensResult = await pool.query(`
      DELETE FROM tokens_unified 
      WHERE mint_address NOT LIKE '%pump%'
    `);
    console.log(`Deleted ${tokensResult.rowCount} tokens`);

    // Commit transaction
    await pool.query('COMMIT');
    console.log('\nTransaction committed successfully!');

    // Verify final state
    const finalCountResult = await pool.query(countQuery);
    const finalCounts = finalCountResult.rows[0];
    
    console.log(`\nFinal state:`);
    console.log(`Total tokens: ${finalCounts.total_tokens}`);
    console.log(`Pump tokens: ${finalCounts.pump_tokens}`);
    console.log(`Non-pump tokens: ${finalCounts.non_pump_tokens}`);

  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK');
    console.error('Error during deletion, rolled back:', error);
    throw error;
  }

  await pool.end();
}

keepOnlyPumpTokens().catch(console.error);