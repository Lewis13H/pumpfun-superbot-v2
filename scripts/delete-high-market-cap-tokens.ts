import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function deleteHighMarketCapTokens() {
  try {
    console.log('🗑️  Deleting tokens with market cap > $100,000...\n');

    // First, let's see what we're about to delete
    const previewResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        threshold_crossed_at
      FROM tokens_unified
      WHERE latest_market_cap_usd > 100000
      ORDER BY latest_market_cap_usd DESC
    `);

    if (previewResult.rows.length === 0) {
      console.log('✅ No tokens found with market cap > $100,000');
      await pool.end();
      return;
    }

    console.log(`Found ${previewResult.rows.length} tokens to delete:\n`);
    
    // Display tokens that will be deleted
    previewResult.rows.forEach((token, index) => {
      console.log(`${index + 1}. ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
      console.log(`   Mint: ${token.mint_address}`);
      console.log(`   Market Cap: $${token.latest_market_cap_usd?.toLocaleString() || '0'}`);
      console.log(`   First tracked: ${token.threshold_crossed_at || 'N/A'}`);
      console.log('');
    });

    // Get mint addresses for deletion
    const mintAddresses = previewResult.rows.map(row => row.mint_address);

    console.log('⚠️  This will delete:');
    console.log(`   - ${previewResult.rows.length} tokens from tokens_unified`);
    console.log(`   - All associated trades from trades_unified`);
    console.log(`   - All price snapshots from price_snapshots_unified`);
    console.log(`   - All AMM pool states from amm_pool_states`);
    
    // Proceed with deletion
    console.log('\n🔥 Starting deletion...\n');

    // Delete from trades_unified
    const tradesResult = await pool.query(`
      DELETE FROM trades_unified
      WHERE mint_address = ANY($1)
    `, [mintAddresses]);
    console.log(`✅ Deleted ${tradesResult.rowCount} trades`);

    // Delete from price_snapshots_unified (if table exists)
    try {
      const snapshotsResult = await pool.query(`
        DELETE FROM price_snapshots_unified
        WHERE mint_address = ANY($1)
      `, [mintAddresses]);
      console.log(`✅ Deleted ${snapshotsResult.rowCount} price snapshots`);
    } catch (error) {
      console.log('⚠️  price_snapshots_unified table not found, skipping...');
    }

    // Delete from amm_pool_states
    try {
      const poolStatesResult = await pool.query(`
        DELETE FROM amm_pool_states
        WHERE mint_address = ANY($1)
      `, [mintAddresses]);
      console.log(`✅ Deleted ${poolStatesResult.rowCount} AMM pool states`);
    } catch (error) {
      console.log('⚠️  amm_pool_states table not found, skipping...');
    }

    // Finally, delete from tokens_unified
    const tokensResult = await pool.query(`
      DELETE FROM tokens_unified
      WHERE mint_address = ANY($1)
    `, [mintAddresses]);
    console.log(`✅ Deleted ${tokensResult.rowCount} tokens`);

    console.log('\n🎉 Deletion complete!');

    // Show remaining token count
    const remainingResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
    `);
    console.log(`\n📊 Remaining tokens in database: ${remainingResult.rows[0].count}`);

  } catch (error) {
    console.error('❌ Error deleting tokens:', error);
  } finally {
    await pool.end();
  }
}

// Add confirmation prompt
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('⚠️  WARNING: This will permanently delete all tokens with market cap > $100,000');
console.log('This action cannot be undone!\n');

rl.question('Are you sure you want to proceed? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes') {
    rl.close();
    deleteHighMarketCapTokens();
  } else {
    console.log('❌ Deletion cancelled');
    rl.close();
    pool.end();
  }
});