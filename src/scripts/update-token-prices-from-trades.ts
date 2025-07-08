import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function updateTokenPricesFromTrades() {
  console.log('🔧 Updating token prices from recent trades...\n');

  try {
    // Get tokens that need price updates
    console.log('📊 Finding tokens with zero or null prices...');
    const tokensQuery = `
      SELECT 
        tu.mint_address,
        tu.symbol,
        tu.graduated_to_amm,
        tu.current_price_usd,
        tu.latest_market_cap_usd,
        -- Get latest trade data
        (SELECT price_usd FROM trades_unified t 
         WHERE t.mint_address = tu.mint_address 
         ORDER BY t.block_time DESC LIMIT 1) as latest_trade_price_usd,
        (SELECT price_sol FROM trades_unified t 
         WHERE t.mint_address = tu.mint_address 
         ORDER BY t.block_time DESC LIMIT 1) as latest_trade_price_sol,
        (SELECT market_cap_usd FROM trades_unified t 
         WHERE t.mint_address = tu.mint_address 
         ORDER BY t.block_time DESC LIMIT 1) as latest_trade_market_cap
      FROM tokens_unified tu
      WHERE 
        (tu.current_price_usd IS NULL OR tu.current_price_usd = 0)
        AND EXISTS (
          SELECT 1 FROM trades_unified t 
          WHERE t.mint_address = tu.mint_address
        )
      ORDER BY tu.latest_market_cap_usd DESC
      LIMIT 100
    `;
    
    const tokensResult = await pool.query(tokensQuery);
    const tokens = tokensResult.rows;
    
    console.log(`Found ${tokens.length} tokens that need price updates\n`);

    let updated = 0;
    let skipped = 0;

    for (const token of tokens) {
      const priceUsd = token.latest_trade_price_usd;
      const priceSol = token.latest_trade_price_sol;
      const marketCap = token.latest_trade_market_cap || token.latest_market_cap_usd;

      if (!priceUsd || priceUsd === 0) {
        console.log(`⚠️  ${token.symbol || token.mint_address.substring(0, 16)}: No price data in trades`);
        skipped++;
        continue;
      }

      console.log(`\n🪙 Updating ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 16)}...)`);
      console.log(`  - Current price: $${token.current_price_usd || 0}`);
      console.log(`  - New price: $${priceUsd}`);
      console.log(`  - Market cap: $${marketCap?.toLocaleString() || 'Unknown'}`);
      
      // Update the token
      const updateQuery = `
        UPDATE tokens_unified 
        SET 
          current_price_usd = $2,
          current_price_sol = $3,
          latest_price_usd = $2,
          latest_price_sol = $3,
          latest_market_cap_usd = COALESCE($4, latest_market_cap_usd),
          updated_at = NOW()
        WHERE mint_address = $1
      `;
      
      await pool.query(updateQuery, [
        token.mint_address,
        priceUsd,
        priceSol,
        marketCap
      ]);
      
      console.log(`  ✅ Updated successfully`);
      updated++;
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ Token Price Update Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  - Tokens processed: ${tokens.length}`);
    console.log(`  - Tokens updated: ${updated}`);
    console.log(`  - Tokens skipped: ${skipped}`);

    // Verify the results
    console.log('\n📊 Verifying results...');
    const verifyQuery = `
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN current_price_usd > 0 THEN 1 END) as tokens_with_price,
        COUNT(CASE WHEN latest_market_cap_usd > 0 THEN 1 END) as tokens_with_market_cap,
        COUNT(CASE WHEN graduated_to_amm = true THEN 1 END) as graduated_tokens
      FROM tokens_unified
    `;
    const verifyResult = await pool.query(verifyQuery);
    const counts = verifyResult.rows[0];
    
    console.log(`  - Total tokens: ${counts.total_tokens}`);
    console.log(`  - With price > 0: ${counts.tokens_with_price}`);
    console.log(`  - With market cap > 0: ${counts.tokens_with_market_cap}`);
    console.log(`  - Graduated tokens: ${counts.graduated_tokens}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

updateTokenPricesFromTrades().catch(console.error);