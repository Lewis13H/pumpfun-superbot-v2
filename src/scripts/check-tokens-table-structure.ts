import { db } from '../database';
import { logger } from '../core/logger';

async function checkTokensTableStructure() {
  
  try {
    // Query to get column information from information_schema
    const query = `
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'tokens_unified'
      ORDER BY ordinal_position;
    `;
    
    const result = await db.query(query);
    
    console.log('\n=== TOKENS_UNIFIED TABLE STRUCTURE ===\n');
    console.log('Total columns:', result.rows.length);
    console.log('\nColumn Details:');
    console.log('─'.repeat(80));
    
    result.rows.forEach((col, index) => {
      console.log(`\n${index + 1}. ${col.column_name}`);
      console.log(`   Type: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}${col.numeric_precision ? `(${col.numeric_precision}${col.numeric_scale ? `,${col.numeric_scale}` : ''})` : ''}`);
      console.log(`   Nullable: ${col.is_nullable}`);
      if (col.column_default) {
        console.log(`   Default: ${col.column_default}`);
      }
    });
    
    console.log('\n' + '─'.repeat(80));
    
    // Also show a sample row to see actual data
    const sampleQuery = `SELECT * FROM tokens_unified LIMIT 1`;
    const sampleResult = await db.query(sampleQuery);
    
    if (sampleResult.rows.length > 0) {
      console.log('\nSample row (first token):');
      console.log('─'.repeat(80));
      const sampleRow = sampleResult.rows[0];
      Object.entries(sampleRow).forEach(([key, value]) => {
        console.log(`${key}: ${value}`);
      });
    }
    
  } catch (error) {
    logger.error('Error checking table structure:', error);
  } finally {
    await db.close();
  }
}

// Run the check
checkTokensTableStructure().catch(console.error);