import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createMissingAmmTokens() {
  console.log('🔧 Creating missing AMM tokens...\n');

  try {
    // Find AMM tokens not in tokens_unified
    console.log('📊 Finding AMM tokens not in tokens_unified...');
    const missingTokensQuery = `
      SELECT DISTINCT 
        t.mint_address,
        COUNT(*) as trade_count,
        MAX(t.block_time) as latest_trade,
        MIN(t.block_time) as first_trade,
        AVG(t.price_sol) as avg_price_sol,
        MAX(t.price_usd) as latest_price_usd,
        MAX(t.market_cap_usd) as latest_market_cap,
        AVG(t.market_cap_usd) as avg_market_cap
      FROM trades_unified t
      LEFT JOIN tokens_unified tu ON t.mint_address = tu.mint_address
      WHERE t.program = 'amm_pool' 
        AND tu.mint_address IS NULL
      GROUP BY t.mint_address
      ORDER BY trade_count DESC
    `;
    
    const missingTokensResult = await pool.query(missingTokensQuery);
    const missingTokens = missingTokensResult.rows;
    
    console.log(`Found ${missingTokens.length} AMM tokens not in tokens_unified\n`);

    // Use a reasonable SOL price
    const solPrice = 250;
    console.log(`Using SOL price: $${solPrice}\n`);

    let created = 0;
    let errors = 0;

    for (const token of missingTokens) {
      try {
        console.log(`\n🪙 Creating token ${token.mint_address.substring(0, 16)}...`);
        console.log(`  - Trade count: ${token.trade_count}`);
        console.log(`  - First trade: ${new Date(token.first_trade).toLocaleString()}`);
        console.log(`  - Latest trade: ${new Date(token.latest_trade).toLocaleString()}`);
        console.log(`  - Avg market cap: $${token.avg_market_cap?.toLocaleString() || 'Unknown'}`);

        // Calculate market cap and price
        const marketCap = token.latest_market_cap || token.avg_market_cap || (token.avg_price_sol * solPrice * 1_000_000_000);
        const priceUsd = token.latest_price_usd || (token.avg_price_sol * solPrice);

        // Insert the token
        const insertQuery = `
          INSERT INTO tokens_unified (
            mint_address,
            symbol,
            name,
            first_seen_at,
            created_at,
            graduated_to_amm,
            graduation_timestamp,
            latest_market_cap_usd,
            current_price_usd,
            current_price_sol,
            latest_price_usd,
            latest_price_sol,
            is_active,
            first_program,
            current_program,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
          ON CONFLICT (mint_address) DO NOTHING
        `;

        await pool.query(insertQuery, [
          token.mint_address,
          'Unknown',
          'Unknown Token',
          token.first_trade,
          token.first_trade,
          true, // graduated_to_amm
          token.first_trade, // graduation_timestamp (use first AMM trade)
          marketCap,
          priceUsd,
          token.avg_price_sol,
          priceUsd,
          token.avg_price_sol,
          true, // is_active
          'amm', // first_program
          'amm'  // current_program
        ]);

        console.log(`  ✅ Created token with market cap: $${marketCap.toLocaleString()}`);
        created++;

      } catch (error: any) {
        console.log(`  ❌ Error: ${error.message}`);
        errors++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ AMM Token Creation Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  - Tokens found: ${missingTokens.length}`);
    console.log(`  - Tokens created: ${created}`);
    console.log(`  - Errors: ${errors}`);

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

createMissingAmmTokens().catch(console.error);