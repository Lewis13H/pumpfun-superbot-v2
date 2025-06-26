import { db } from '../database';

async function checkAndMigrateTable() {
  console.log('🔍 Checking sol_prices table...\n');
  
  try {
    // Check if table exists
    const tableExists = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'sol_prices'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ Table sol_prices does not exist');
      console.log('✅ Run any monitor to create it automatically');
      return;
    }
    
    // Get column information
    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'sol_prices'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 Current table structure:');
    console.log('Columns:', columns.rows.map((c: any) => c.column_name).join(', '));
    console.log('\nDetailed structure:');
    columns.rows.forEach((col: any) => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default || ''}`);
    });
    
    // Check for old schema
    const hasTimestamp = columns.rows.some((c: any) => c.column_name === 'timestamp');
    const hasCreatedAt = columns.rows.some((c: any) => c.column_name === 'created_at');
    
    if (hasTimestamp && !hasCreatedAt) {
      console.log('\n⚠️  Old schema detected (using "timestamp" column)');
      console.log('💡 The system will handle both schemas automatically');
    } else if (hasCreatedAt) {
      console.log('\n✅ New schema detected (using "created_at" column)');
    }
    
    // Get sample data
    try {
      const sampleData = await db.query(
        `SELECT * FROM sol_prices ORDER BY ${hasCreatedAt ? 'created_at' : hasTimestamp ? 'timestamp' : 'id'} DESC LIMIT 5`
      );
      
      if (sampleData.rows.length > 0) {
        console.log(`\n📈 Latest ${sampleData.rows.length} price entries:`);
        sampleData.rows.forEach((row: any) => {
          const timestamp = row.created_at || row.timestamp;
          const source = row.source || 'Unknown';
          console.log(`  - $${parseFloat(row.price).toFixed(2)} from ${source} at ${new Date(timestamp).toLocaleString()}`);
        });
      } else {
        console.log('\n📭 No price data found in table');
      }
      
      // Count total entries
      const countResult = await db.query('SELECT COUNT(*) as count FROM sol_prices');
      console.log(`\n📊 Total entries: ${countResult.rows[0].count}`);
      
    } catch (error) {
      console.error('Error reading sample data:', error);
    }
    
  } catch (error) {
    console.error('Error checking table:', error);
  } finally {
    await db.close();
  }
}

checkAndMigrateTable().catch(console.error);