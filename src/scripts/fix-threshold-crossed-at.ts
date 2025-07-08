import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixThresholdCrossedAt() {
  console.log('🔧 Fixing threshold_crossed_at for tokens...\n');

  try {
    // Check current state
    const checkQuery = `
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN threshold_crossed_at IS NOT NULL THEN 1 END) as with_threshold,
        COUNT(CASE WHEN latest_market_cap_usd > 1000 THEN 1 END) as above_1k_mcap,
        COUNT(CASE WHEN graduated_to_amm = true THEN 1 END) as graduated
      FROM tokens_unified
    `;
    
    const checkResult = await pool.query(checkQuery);
    const counts = checkResult.rows[0];
    
    console.log('📊 Current state:');
    console.log(`  - Total tokens: ${counts.total_tokens}`);
    console.log(`  - With threshold_crossed_at: ${counts.with_threshold}`);
    console.log(`  - Market cap > $1,000: ${counts.above_1k_mcap}`);
    console.log(`  - Graduated to AMM: ${counts.graduated}`);

    // Update tokens that should have threshold_crossed_at
    // Set it for tokens with market cap > $1,000 or graduated tokens
    console.log('\n📊 Updating threshold_crossed_at...');
    
    const updateQuery = `
      UPDATE tokens_unified
      SET 
        threshold_crossed_at = COALESCE(threshold_crossed_at, first_seen_at, created_at, NOW()),
        updated_at = NOW()
      WHERE 
        threshold_crossed_at IS NULL
        AND (
          latest_market_cap_usd > 1000
          OR graduated_to_amm = true
          OR latest_price_usd > 0
        )
    `;
    
    const updateResult = await pool.query(updateQuery);
    console.log(`✅ Updated ${updateResult.rowCount} tokens`);

    // Check final state
    const finalCheckResult = await pool.query(checkQuery);
    const finalCounts = finalCheckResult.rows[0];
    
    console.log('\n📊 Final state:');
    console.log(`  - Total tokens: ${finalCounts.total_tokens}`);
    console.log(`  - With threshold_crossed_at: ${finalCounts.with_threshold}`);
    console.log(`  - Market cap > $1,000: ${finalCounts.above_1k_mcap}`);
    console.log(`  - Graduated to AMM: ${finalCounts.graduated}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

fixThresholdCrossedAt().catch(console.error);