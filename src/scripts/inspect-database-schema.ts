import { db } from '../database';

async function inspectSchema() {
  console.log('🔍 Inspecting Database Schema...\n');

  try {
    // Get all tables
    const tablesResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('📋 Tables found:', tablesResult.rows.map((r: any) => r.table_name).join(', '));
    console.log('\n');

    // For each table, get column details
    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      console.log(`📊 Table: ${tableName}`);
      console.log('─'.repeat(60));

      const columnsResult = await db.query(`
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          numeric_precision,
          numeric_scale,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_name = $1
        AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [tableName]);

      for (const col of columnsResult.rows) {
        let type = (col as any).data_type;
        if (col.character_maximum_length) {
          type += `(${col.character_maximum_length})`;
        } else if (col.numeric_precision) {
          type += `(${col.numeric_precision}`;
          if (col.numeric_scale) {
            type += `,${col.numeric_scale}`;
          }
          type += ')';
        }

        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        
        console.log(`  - ${col.column_name}: ${type} ${nullable}${defaultVal}`);
      }

      // Get indexes
      const indexesResult = await db.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1
        AND schemaname = 'public'
      `, [tableName]);

      if (indexesResult.rows.length > 0) {
        console.log('\n  Indexes:');
        for (const idx of indexesResult.rows) {
          console.log(`  - ${idx.indexname}`);
        }
      }

      console.log('\n');
    }

    // Check for specific columns that are causing errors
    console.log('🔍 Checking for specific problematic columns:');
    console.log('─'.repeat(60));

    // Check if volume_usd exists in trades_unified
    const volumeCheck = await db.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'trades_unified' 
        AND column_name = 'volume_usd'
      )
    `);
    console.log(`trades_unified.volume_usd exists: ${volumeCheck.rows[0].exists}`);

    // Check all columns in trades_unified
    const tradesColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'trades_unified' 
      ORDER BY ordinal_position
    `);
    console.log('\nAll columns in trades_unified:');
    console.log(tradesColumns.rows.map((r: any) => r.column_name).join(', '));

    // Check what columns the code is trying to insert
    console.log('\n\n📝 Columns referenced in code that might be missing:');
    console.log('─'.repeat(60));
    
    // List columns that appear in error messages or are commonly used
    const expectedColumns = {
      'trades_unified': [
        'signature', 'slot', 'timestamp', 'mint_address', 'program', 
        'trade_type', 'user_address', 'sol_amount', 'token_amount',
        'price_sol', 'price_usd', 'market_cap_usd', 'bonding_curve_progress',
        'virtual_sol_reserves', 'virtual_token_reserves', 'created_at',
        'block_time', 'volume_usd' // This one is causing errors
      ],
      'tokens_unified': [
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

    for (const [tableName, columns] of Object.entries(expectedColumns)) {
      console.log(`\n${tableName}:`);
      const result = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [tableName]);
      
      const existingColumns = result.rows.map((r: any) => r.column_name);
      const missingColumns = columns.filter(col => !existingColumns.includes(col));
      
      if (missingColumns.length > 0) {
        console.log(`  ❌ Missing columns: ${missingColumns.join(', ')}`);
      } else {
        console.log(`  ✅ All expected columns exist`);
      }
    }

  } catch (error) {
    console.error('Error inspecting schema:', error);
  } finally {
    await (db as any).close();
  }
}

// Run the inspection
inspectSchema().catch(console.error);