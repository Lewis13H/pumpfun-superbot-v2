import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Simple database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixAmmTokens() {
  console.log('🔧 Starting AMM token fix...\n');

  try {
    // 1. Find recent AMM tokens from trades
    console.log('📊 Finding recent AMM tokens...');
    const recentAmmTokensQuery = `
      SELECT DISTINCT 
        t.mint_address,
        COUNT(*) as trade_count,
        MAX(t.block_time) as latest_trade,
        AVG(t.price_sol) as avg_price_sol,
        MAX(t.price_usd) as latest_price_usd,
        MAX(t.market_cap_usd) as latest_market_cap
      FROM trades_unified t
      WHERE 
        t.program = 'amm_pool'
        AND t.block_time > NOW() - INTERVAL '24 hours'
      GROUP BY t.mint_address
      ORDER BY trade_count DESC
      LIMIT 50
    `;

    const ammTokensResult = await pool.query(recentAmmTokensQuery);
    const ammTokens = ammTokensResult.rows;

    console.log(`Found ${ammTokens.length} AMM tokens with recent trades\n`);

    // 2. Use a reasonable SOL price (can be updated manually if needed)
    const solPrice = 250; // Hardcoded SOL price
    console.log(`Using SOL price: $${solPrice}\n`);

    // 3. Fix each token
    let fixed = 0;
    let created = 0;
    let updated = 0;

    for (const token of ammTokens) {
      console.log(`\n🪙 Processing ${token.mint_address.substring(0, 8)}...${token.mint_address.substring(token.mint_address.length - 6)}`);
      console.log(`  - Trade count: ${token.trade_count}`);
      console.log(`  - Latest trade: ${new Date(token.latest_trade).toLocaleString()}`);
      console.log(`  - Latest market cap: $${token.latest_market_cap?.toLocaleString() || 'Unknown'}`);

      // Check if token exists
      const tokenExistsQuery = `
        SELECT 
          mint_address, 
          symbol, 
          name, 
          current_market_cap_usd, 
          graduated_to_amm,
          current_price_usd
        FROM tokens_unified 
        WHERE mint_address = $1
      `;
      const tokenExistsResult = await pool.query(tokenExistsQuery, [token.mint_address]);
      const existingToken = tokenExistsResult.rows[0];

      if (!existingToken) {
        // Create token if missing
        console.log('  ❌ Token not found in database - creating...');
        
        // Use market cap from trades if available, otherwise calculate
        const marketCap = token.latest_market_cap || (token.latest_price_usd || (token.avg_price_sol * solPrice)) * 1_000_000_000;

        const insertQuery = `
          INSERT INTO tokens_unified (
            mint_address,
            symbol,
            name,
            first_program,
            current_program,
            current_market_cap_usd,
            current_price_usd,
            current_price_sol,
            graduated_to_amm,
            graduation_timestamp,
            is_active,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
          ON CONFLICT (mint_address) DO NOTHING
        `;

        await pool.query(insertQuery, [
          token.mint_address,
          'Unknown',  // We don't have symbol from trades
          'Unknown Token',  // We don't have name from trades
          'amm_pool',  // first_program
          'amm_pool',  // current_program
          marketCap,
          token.latest_price_usd || (token.avg_price_sol * solPrice),
          token.avg_price_sol,
          true,
          token.latest_trade,
          true
        ]);

        console.log(`  ✅ Created token with market cap: $${marketCap.toLocaleString()}`);
        created++;
      } else {
        // Update existing token if needed
        console.log(`  ✓ Token exists: ${existingToken.symbol}`);
        
        let needsUpdate = false;
        const updates = [];

        // Check if graduated
        if (!existingToken.graduated_to_amm) {
          console.log('  ⚠️  Not marked as graduated - fixing...');
          needsUpdate = true;
        }

        // Check if market cap is zero or null
        if (!existingToken.current_market_cap_usd || existingToken.current_market_cap_usd === 0) {
          console.log('  ⚠️  Market cap is zero - fixing...');
          needsUpdate = true;
        }

        // Check if price is zero or null
        if (!existingToken.current_price_usd || existingToken.current_price_usd === 0) {
          console.log('  ⚠️  Price is zero - fixing...');
          needsUpdate = true;
        }

        if (needsUpdate) {
          // Use market cap from trades if available, otherwise calculate
          const marketCap = token.latest_market_cap || (token.latest_price_usd || (token.avg_price_sol * solPrice)) * 1_000_000_000;
          const priceInUsd = token.latest_price_usd || (token.avg_price_sol * solPrice);

          const updateQuery = `
            UPDATE tokens_unified 
            SET 
              graduated_to_amm = true,
              graduation_timestamp = COALESCE(graduation_timestamp, $2),
              current_market_cap_usd = CASE 
                WHEN current_market_cap_usd IS NULL OR current_market_cap_usd = 0 
                THEN $3 
                ELSE current_market_cap_usd 
              END,
              current_price_usd = CASE 
                WHEN current_price_usd IS NULL OR current_price_usd = 0 
                THEN $4 
                ELSE current_price_usd 
              END,
              current_price_sol = CASE 
                WHEN current_price_sol IS NULL OR current_price_sol = 0 
                THEN $5 
                ELSE current_price_sol 
              END,
              is_active = true,
              updated_at = NOW()
            WHERE mint_address = $1
          `;

          await pool.query(updateQuery, [
            token.mint_address,
            token.latest_trade,
            marketCap,
            priceInUsd,
            token.avg_price_sol
          ]);

          console.log(`  ✅ Updated token with market cap: $${marketCap.toLocaleString()}`);
          updated++;
        } else {
          console.log('  ✓ Token data looks good');
        }
      }

      fixed++;
    }

    // 4. Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ AMM Token Fix Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  - Tokens processed: ${fixed}`);
    console.log(`  - Tokens created: ${created}`);
    console.log(`  - Tokens updated: ${updated}`);
    console.log(`  - SOL price used: $${solPrice}`);

    // Show sample of fixed tokens
    console.log('\n📋 Sample of fixed tokens:');
    const sampleQuery = `
      SELECT 
        symbol,
        name,
        current_market_cap_usd,
        current_price_usd,
        graduated_to_amm
      FROM tokens_unified
      WHERE 
        mint_address = ANY($1::text[])
        AND graduated_to_amm = true
      ORDER BY current_market_cap_usd DESC
      LIMIT 5
    `;
    
    const sampleResult = await pool.query(sampleQuery, [ammTokens.slice(0, 10).map(t => t.mint_address)]);
    
    for (const token of sampleResult.rows) {
      console.log(`  - ${token.symbol}: $${token.current_market_cap_usd.toLocaleString()} @ $${token.current_price_usd}`);
    }

  } catch (error) {
    console.error('❌ Error fixing AMM tokens:', error);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixAmmTokens().catch(console.error);