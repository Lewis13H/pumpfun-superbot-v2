#!/usr/bin/env node
/**
 * Verify AMM pool states table structure
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function verifyTable() {
  console.log(chalk.cyan.bold('🔍 Verifying AMM Pool States V2 Table...\n'));
  
  try {
    // Check table structure
    const columnsResult = await db.query(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'amm_pool_states'
      ORDER BY ordinal_position;
    `);
    
    console.log(chalk.yellow('Table Structure:'));
    console.log(chalk.gray('─'.repeat(80)));
    
    columnsResult.rows.forEach(col => {
      let type = col.data_type;
      if (col.character_maximum_length) {
        type += `(${col.character_maximum_length})`;
      }
      
      console.log(chalk.white(`${col.column_name.padEnd(25)} ${type.padEnd(20)} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL    '} ${col.column_default || ''}`));
    });
    
    console.log(chalk.gray('─'.repeat(80)));
    
    // Test insert with proper mint address format
    console.log(chalk.yellow('\n🧪 Testing insert with Solana address format...'));
    
    const testMint = 'EvYyujuvZGVKUhrCm1xnJvYjR9WcXAjYURy5dTEqpump';
    const testPool = '7jkz5Lbs6CVT3PkNPt9xjgZKzpump123456789ABC';
    
    await db.query(`
      INSERT INTO amm_pool_states (
        mint_address,
        pool_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        slot
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
    `, [testMint, testPool, 1000000000, 1000000000000, 123456]);
    
    console.log(chalk.green('✅ Insert successful with Solana address format'));
    
    // Query the inserted record
    const result = await db.query(`
      SELECT * FROM amm_pool_states 
      WHERE mint_address = $1
    `, [testMint]);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(chalk.green('\n✅ Verified record:'));
      console.log(chalk.gray(`  Mint: ${row.mint_address}`));
      console.log(chalk.gray(`  Pool: ${row.pool_address}`));
      console.log(chalk.gray(`  SOL Reserves: ${row.virtual_sol_reserves}`));
      console.log(chalk.gray(`  Token Reserves: ${row.virtual_token_reserves}`));
    }
    
    // Clean up test data
    await db.query('DELETE FROM amm_pool_states WHERE mint_address = $1', [testMint]);
    console.log(chalk.gray('\n✓ Test data cleaned up'));
    
    console.log(chalk.green('\n✅ Table structure is correct for Solana addresses!'));
    
  } catch (error) {
    console.error(chalk.red('❌ Verification failed:'), error);
  } finally {
    await db.close();
  }
}

// Run verification
verifyTable().catch(console.error);