import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Simple database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixAmmTokens() {
  console.log('🔧 Starting Ultra-Simple AMM token fix...\n');

  try {
    // First, let's check what columns exist in tokens_unified
    console.log('📊 Checking table structure...');
    const columnsQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tokens_unified'
      ORDER BY ordinal_position
    `;
    const columnsResult = await pool.query(columnsQuery);
    const columns = columnsResult.rows.map(r => r.column_name);
    console.log('Available columns:', columns.filter(c => 
      c.includes('market_cap') || c.includes('price') || c.includes('graduated')
    ).join(', '));

    // Find recent AMM tokens
    console.log('\n📊 Finding recent AMM tokens...');
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
      LIMIT 20
    `;

    const ammTokensResult = await pool.query(recentAmmTokensQuery);
    const ammTokens = ammTokensResult.rows;

    console.log(`Found ${ammTokens.length} AMM tokens with recent trades\n`);

    // Try to fix each token
    let fixed = 0;
    let errors = 0;

    for (const token of ammTokens) {
      try {
        console.log(`\n🪙 Processing ${token.mint_address.substring(0, 16)}...`);
        console.log(`  - Trade count: ${token.trade_count}`);
        console.log(`  - Latest market cap: $${token.latest_market_cap?.toLocaleString() || 'Unknown'}`);

        // Check if token exists
        const checkQuery = `SELECT mint_address FROM tokens_unified WHERE mint_address = $1`;
        const checkResult = await pool.query(checkQuery, [token.mint_address]);
        
        if (checkResult.rows.length === 0) {
          console.log('  ❌ Token not in database - skipping for now');
          continue;
        }

        // Build dynamic update query based on available columns
        const updates = [];
        const values = [token.mint_address];
        let paramCount = 1;

        // Always mark as graduated
        if (columns.includes('graduated_to_amm')) {
          updates.push(`graduated_to_amm = true`);
        }

        // Update market cap if column exists and we have data
        if (columns.includes('market_cap_usd') && token.latest_market_cap) {
          updates.push(`market_cap_usd = $${++paramCount}`);
          values.push(token.latest_market_cap);
        } else if (columns.includes('current_market_cap_usd') && token.latest_market_cap) {
          updates.push(`current_market_cap_usd = $${++paramCount}`);
          values.push(token.latest_market_cap);
        }

        // Update price if we have data
        if (columns.includes('current_price_usd') && token.latest_price_usd) {
          updates.push(`current_price_usd = $${++paramCount}`);
          values.push(token.latest_price_usd);
        }

        // Update SOL price if we have data
        if (columns.includes('current_price_sol') && token.avg_price_sol) {
          updates.push(`current_price_sol = $${++paramCount}`);
          values.push(token.avg_price_sol);
        }

        // Always update timestamp
        updates.push(`updated_at = NOW()`);

        if (updates.length > 1) { // More than just updated_at
          const updateQuery = `
            UPDATE tokens_unified 
            SET ${updates.join(', ')}
            WHERE mint_address = $1
          `;

          await pool.query(updateQuery, values);
          console.log(`  ✅ Updated token successfully`);
          fixed++;
        } else {
          console.log('  ⚠️  No updates needed');
        }

      } catch (error: any) {
        console.log(`  ❌ Error: ${error.message}`);
        errors++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ AMM Token Fix Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`  - Tokens processed: ${ammTokens.length}`);
    console.log(`  - Tokens fixed: ${fixed}`);
    console.log(`  - Errors: ${errors}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixAmmTokens().catch(console.error);