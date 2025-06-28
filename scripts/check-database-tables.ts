#!/usr/bin/env node
/**
 * Check database tables and schema
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function checkDatabase() {
  console.log(chalk.cyan.bold('🔍 Checking Database Schema...\n'));
  
  try {
    // Check current schema
    const schemaResult = await db.query('SELECT current_schema()');
    const currentSchema = schemaResult.rows[0].current_schema;
    console.log(chalk.yellow(`Current schema: ${currentSchema}\n`));
    
    // List all tables
    const tablesResult = await db.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    `);
    
    console.log(chalk.cyan('📋 Tables in database:'));
    tablesResult.rows.forEach(row => {
      console.log(chalk.white(`  ${row.table_schema}.${row.table_name}`));
    });
    
    // Check specifically for amm_pool_states
    console.log(chalk.cyan('\n🔍 Checking for amm_pool_states table:'));
    
    const ammTableResult = await db.query(`
      SELECT 
        table_schema,
        table_name,
        (SELECT COUNT(*) FROM information_schema.columns 
         WHERE table_schema = t.table_schema 
         AND table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_name LIKE '%amm%pool%'
         OR table_name = 'amm_pool_states';
    `);
    
    if (ammTableResult.rows.length > 0) {
      console.log(chalk.green('Found AMM-related tables:'));
      ammTableResult.rows.forEach(row => {
        console.log(chalk.white(`  ${row.table_schema}.${row.table_name} (${row.column_count} columns)`));
      });
      
      // Show columns if found
      for (const table of ammTableResult.rows) {
        const columnsResult = await db.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position;
        `, [table.table_schema, table.table_name]);
        
        console.log(chalk.gray(`\n  Columns in ${table.table_schema}.${table.table_name}:`));
        columnsResult.rows.forEach(col => {
          console.log(chalk.gray(`    - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`));
        });
      }
    } else {
      console.log(chalk.red('No AMM pool tables found'));
    }
    
    // Check if we need to use a different schema
    console.log(chalk.cyan('\n🔍 Checking all schemas:'));
    const schemasResult = await db.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY schema_name;
    `);
    
    console.log(chalk.yellow('Available schemas:'));
    schemasResult.rows.forEach(row => {
      console.log(chalk.white(`  - ${row.schema_name}`));
    });
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error);
  } finally {
    await db.close();
  }
}

// Run the check
checkDatabase().catch(console.error);