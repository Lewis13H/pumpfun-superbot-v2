import { db } from '../database';

async function checkMissingColumns() {
  console.log('🔍 Checking for missing columns...\n');

  try {
    // Define expected columns for each table based on code usage
    const expectedColumns = {
      'trades_unified': [
        // Standard columns from schema
        'id', 'mint_address', 'signature', 'program', 'trade_type',
        'user_address', 'sol_amount', 'token_amount', 'price_sol',
        'price_usd', 'market_cap_usd', 'bonding_curve_progress',
        'virtual_sol_reserves', 'virtual_token_reserves', 'slot',
        'timestamp', 'created_at', 'block_time',
        // Columns referenced in errors
        'volume_usd'  // This is causing the error!
      ],
      'tokens_unified': [
        // All the columns from the complete schema
        'mint_address', 'symbol', 'name', 'uri', 'image_uri', 'description',
        'creator', 'creation_slot', 'first_seen_at', 'last_seen_at',
        'first_program', 'current_program', 'graduated_to_amm', 'graduation_at',
        'threshold_crossed_at', 'metadata_updated_at', 'enrichment_attempts',
        'metadata_source', 'token_created_at', 'is_enriched', 'is_stale',
        'stale_marked_at', 'first_price_sol', 'first_price_usd',
        'first_market_cap_usd', 'latest_price_sol', 'latest_price_usd',
        'latest_market_cap_usd', 'latest_bonding_curve_progress',
        'latest_virtual_sol_reserves', 'latest_virtual_token_reserves',
        'price_source', 'first_seen_slot', 'bonding_curve_key',
        'last_price_update', 'created_at', 'volume_24h_usd', 'holder_count',
        'top_holder_percentage', 'total_trades', 'unique_traders_24h',
        'updated_at', 'telegram', 'twitter', 'website', 'should_remove',
        'block_time'
      ]
    };

    // Check each table
    for (const [tableName, expectedCols] of Object.entries(expectedColumns)) {
      console.log(`📊 Checking table: ${tableName}`);
      console.log('─'.repeat(60));

      // Get actual columns
      const result = await db.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      const actualColumns = result.rows.map((r: any) => r.column_name);
      console.log(`Found ${actualColumns.length} columns`);

      // Find missing columns
      const missingColumns = expectedCols.filter(col => !actualColumns.includes(col));
      
      if (missingColumns.length > 0) {
        console.log(`\n❌ Missing columns (${missingColumns.length}):`);
        missingColumns.forEach(col => console.log(`   - ${col}`));
      } else {
        console.log(`\n✅ All expected columns exist`);
      }

      // Show actual columns for reference
      console.log(`\n📋 Actual columns in ${tableName}:`);
      console.log(actualColumns.join(', '));
      console.log('\n');
    }

    // Check where volume_usd is being used in the code
    console.log('📝 Code Analysis:');
    console.log('─'.repeat(60));
    console.log('The error shows "volume_usd" is being inserted into trades_unified');
    console.log('This appears to be in trade-repository.ts at line 148');
    console.log('\nRecommendation: Check if volume_usd should be:');
    console.log('1. Added as a new column to trades_unified');
    console.log('2. Removed from the INSERT statement in the code');
    console.log('3. Mapped to a different column name');

  } catch (error) {
    console.error('Error checking columns:', error);
  } finally {
    await (db as any).close();
  }
}

// Run the check
checkMissingColumns().catch(console.error);