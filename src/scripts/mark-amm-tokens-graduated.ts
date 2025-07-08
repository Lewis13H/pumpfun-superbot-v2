import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function markAmmTokensAsGraduated() {
  console.log('🔧 Marking AMM tokens as graduated...\n');

  try {
    // Find tokens that have AMM trades but aren't marked as graduated
    console.log('📊 Finding tokens with AMM trades that aren\'t graduated...');
    const findTokensQuery = `
      SELECT DISTINCT 
        tu.mint_address,
        tu.symbol,
        tu.name,
        tu.graduated_to_amm,
        tu.latest_market_cap_usd,
        COUNT(t.signature) as amm_trade_count,
        MAX(t.block_time) as latest_amm_trade
      FROM tokens_unified tu
      INNER JOIN trades_unified t ON tu.mint_address = t.mint_address
      WHERE 
        t.program = 'amm_pool'
        AND (tu.graduated_to_amm = false OR tu.graduated_to_amm IS NULL)
      GROUP BY tu.mint_address, tu.symbol, tu.name, tu.graduated_to_amm, tu.latest_market_cap_usd
      ORDER BY amm_trade_count DESC
    `;
    
    const tokensResult = await pool.query(findTokensQuery);
    const tokens = tokensResult.rows;
    
    console.log(`Found ${tokens.length} tokens with AMM trades that aren't marked as graduated\n`);

    if (tokens.length === 0) {
      console.log('✅ All tokens with AMM trades are already marked as graduated!');
      return;
    }

    // Update each token
    let updated = 0;
    for (const token of tokens) {
      console.log(`\n🪙 ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 16)}...)`);
      console.log(`  - AMM trades: ${token.amm_trade_count}`);
      console.log(`  - Latest AMM trade: ${new Date(token.latest_amm_trade).toLocaleString()}`);
      console.log(`  - Current graduated status: ${token.graduated_to_amm}`);
      
      // Update the token
      const updateQuery = `
        UPDATE tokens_unified 
        SET 
          graduated_to_amm = true,
          updated_at = NOW()
        WHERE mint_address = $1
      `;
      
      await pool.query(updateQuery, [token.mint_address]);
      console.log(`  ✅ Marked as graduated`);
      updated++;
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ AMM Token Update Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  - Tokens updated: ${updated}`);

    // Verify the results
    console.log('\n📊 Verifying results...');
    const verifyQuery = `
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN graduated_to_amm = true THEN 1 END) as graduated_tokens,
        COUNT(CASE WHEN latest_market_cap_usd > 0 THEN 1 END) as tokens_with_market_cap
      FROM tokens_unified
    `;
    const verifyResult = await pool.query(verifyQuery);
    const counts = verifyResult.rows[0];
    
    console.log(`  - Total tokens: ${counts.total_tokens}`);
    console.log(`  - Graduated to AMM: ${counts.graduated_tokens}`);
    console.log(`  - With market cap > 0: ${counts.tokens_with_market_cap}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

markAmmTokensAsGraduated().catch(console.error);