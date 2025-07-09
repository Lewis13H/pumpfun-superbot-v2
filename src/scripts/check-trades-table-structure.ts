import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function checkTradesTableStructure() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Checking trades_unified table structure...\n');

    // Query to get column information
    const query = `
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'trades_unified'
      ORDER BY ordinal_position;
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      console.log('❌ Table trades_unified not found!');
      return;
    }

    console.log('✅ trades_unified table columns:\n');
    console.log('Column Name                    | Data Type      | Nullable | Default');
    console.log('-------------------------------|----------------|----------|--------');

    result.rows.forEach(row => {
      const columnName = row.column_name.padEnd(30);
      const dataType = row.data_type.padEnd(14);
      const nullable = row.is_nullable.padEnd(8);
      const defaultVal = row.column_default ? row.column_default.substring(0, 20) : 'NULL';
      
      console.log(`${columnName} | ${dataType} | ${nullable} | ${defaultVal}`);
    });

    console.log(`\nTotal columns: ${result.rows.length}`);

  } catch (error) {
    console.error('Error checking table structure:', error);
  } finally {
    await pool.end();
  }
}

checkTradesTableStructure();