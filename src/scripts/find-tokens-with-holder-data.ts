import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function findTokensWithHolderData() {
  try {
    // First, let's see what's in holder_snapshots table
    const snapshotResult = await pool.query(`
      SELECT 
        hs.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        hs.total_holders,
        hs.unique_holders,
        hs.holder_score,
        hs.top_10_percentage,
        hs.top_25_percentage,
        hs.gini_coefficient,
        hs.score_breakdown,
        hs.snapshot_time
      FROM holder_snapshots hs
      JOIN tokens_unified t ON hs.mint_address = t.mint_address
      WHERE hs.holder_score IS NOT NULL
        AND hs.total_holders > 0
      ORDER BY hs.snapshot_time DESC
      LIMIT 20
    `);

    console.log(`Found ${snapshotResult.rows.length} tokens with holder snapshots\n`);
    
    if (snapshotResult.rows.length > 0) {
      // Group by mint address to show latest for each token
      const latestByToken = new Map();
      snapshotResult.rows.forEach(row => {
        if (!latestByToken.has(row.mint_address)) {
          latestByToken.set(row.mint_address, row);
        }
      });

      console.log('Tokens with complete holder analysis:');
      console.log('====================================\n');
      
      let index = 1;
      for (const [mint, snapshot] of latestByToken) {
        console.log(`${index}. ${snapshot.symbol || 'Unknown'} (${snapshot.name || 'Unknown'})`);
        console.log(`   Mint: ${mint}`);
        console.log(`   Market Cap: $${snapshot.latest_market_cap_usd?.toLocaleString() || 'N/A'}`);
        console.log(`   Total Holders: ${snapshot.total_holders}`);
        console.log(`   Unique Holders: ${snapshot.unique_holders}`);
        console.log(`   Holder Score: ${snapshot.holder_score}/300`);
        console.log(`   Top 10%: ${snapshot.top_10_percentage}%`);
        console.log(`   Top 25%: ${snapshot.top_25_percentage}%`);
        console.log(`   Gini Coefficient: ${snapshot.gini_coefficient}`);
        if (snapshot.score_breakdown) {
          console.log(`   Score Breakdown:`);
          console.log(`     - Base: ${snapshot.score_breakdown.base}`);
          console.log(`     - Distribution: ${snapshot.score_breakdown.distributionScore}`);
          console.log(`     - Organic Growth: ${snapshot.score_breakdown.organicGrowthScore}`);
          console.log(`     - Concentration Penalty: ${snapshot.score_breakdown.concentrationPenalty}`);
          console.log(`     - Bot Penalty: ${snapshot.score_breakdown.botPenalty}`);
          console.log(`     - Sniper Penalty: ${snapshot.score_breakdown.sniperPenalty}`);
        }
        console.log(`   Snapshot Time: ${snapshot.snapshot_time}\n`);
        index++;
        if (index > 10) break;
      }
    } else {
      console.log('No tokens found with holder snapshots.');
    }

    // Also check token_holder_details for actual holder data
    const holderDetailsResult = await pool.query(`
      SELECT 
        thd.mint_address,
        COUNT(DISTINCT thd.wallet_address) as unique_holders,
        MAX(thd.snapshot_time) as latest_snapshot,
        SUM(thd.percentage) as total_percentage
      FROM token_holder_details thd
      GROUP BY thd.mint_address
      HAVING COUNT(DISTINCT thd.wallet_address) > 10
      ORDER BY latest_snapshot DESC
      LIMIT 10
    `);

    console.log(`\nTokens with holder details (found ${holderDetailsResult.rows.length}):`);
    console.log('============================================');
    
    for (const detail of holderDetailsResult.rows) {
      // Get token info
      const tokenResult = await pool.query(`
        SELECT symbol, name, latest_market_cap_usd
        FROM tokens_unified
        WHERE mint_address = $1
      `, [detail.mint_address]);
      
      const token = tokenResult.rows[0];
      console.log(`\n- ${token?.symbol || 'Unknown'} (${token?.name || 'Unknown'})`);
      console.log(`  Mint: ${detail.mint_address}`);
      console.log(`  Market Cap: $${token?.latest_market_cap_usd?.toLocaleString() || 'N/A'}`);
      console.log(`  Unique Holders: ${detail.unique_holders}`);
      console.log(`  Total %: ${parseFloat(detail.total_percentage).toFixed(2)}%`);
      console.log(`  Latest Snapshot: ${detail.latest_snapshot}`);
    }

    // Show example of a token with complete data
    if (snapshotResult.rows.length > 0) {
      const exampleToken = snapshotResult.rows[0];
      console.log(`\n\nExample token with complete holder data:`);
      console.log('=======================================');
      console.log(`Token: ${exampleToken.symbol} (${exampleToken.name})`);
      console.log(`Mint Address: ${exampleToken.mint_address}`);
      console.log('\nYou can use this mint address to test holder analysis endpoints.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

findTokensWithHolderData();