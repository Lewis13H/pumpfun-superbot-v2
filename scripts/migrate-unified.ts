#!/usr/bin/env node
/**
 * Migration script for unified monitoring schema
 */

import 'dotenv/config';
import { db } from '../src/database';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

async function runMigration() {
  console.log(chalk.cyan.bold('🚀 Running Unified Monitoring Schema Migration...\n'));
  
  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '..', 'schema', 'unified-monitoring-schema.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
    
    console.log(chalk.yellow('📋 Checking existing schema...'));
    
    // First check if schema_migrations table exists
    const tableExists = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'schema_migrations'
      );
    `);
    
    let migrationApplied = false;
    
    if (tableExists.rows[0].exists) {
      // Check if migration already run
      const migrationCheck = await db.query(
        "SELECT version FROM schema_migrations WHERE name = 'unified_monitoring_schema'"
      ).catch(() => null);
      
      if (migrationCheck && migrationCheck.rows.length > 0) {
        migrationApplied = true;
      }
    }
    
    if (migrationApplied) {
      console.log(chalk.green('✅ Migration already applied\n'));
      
      // Show current statistics
      await showStatistics();
      return;
    }
    
    console.log(chalk.yellow('🔧 Applying migration...'));
    
    // Split migration into statements (handling functions with $$ delimiters)
    const statements: string[] = [];
    let currentStatement = '';
    let inFunction = false;
    
    const lines = migrationSQL.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Check for function boundaries
      if (trimmedLine.includes('$$') && trimmedLine.includes('LANGUAGE')) {
        inFunction = false;
        currentStatement += line + '\n';
        statements.push(currentStatement.trim());
        currentStatement = '';
        continue;
      }
      
      if (trimmedLine.includes('$$') || trimmedLine.includes('AS $$')) {
        inFunction = true;
      }
      
      currentStatement += line + '\n';
      
      // If not in a function and line ends with semicolon, it's a complete statement
      if (!inFunction && trimmedLine.endsWith(';') && 
          !trimmedLine.startsWith('--') && 
          trimmedLine.length > 1) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const statement of statements) {
      try {
        // Skip comments and empty statements
        if (!statement || statement.startsWith('--')) continue;
        
        await db.query(statement);
        successCount++;
        
        // Log important operations
        if (statement.includes('CREATE TABLE')) {
          const tableMatch = statement.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
          if (tableMatch) {
            console.log(chalk.green(`  ✓ Created table: ${tableMatch[1]}`));
          }
        } else if (statement.includes('CREATE INDEX')) {
          const indexMatch = statement.match(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)/i);
          if (indexMatch) {
            console.log(chalk.green(`  ✓ Created index: ${indexMatch[1]}`));
          }
        } else if (statement.includes('CREATE FUNCTION')) {
          console.log(chalk.green(`  ✓ Created function: update_token_stats`));
        } else if (statement.includes('CREATE MATERIALIZED VIEW')) {
          console.log(chalk.green(`  ✓ Created materialized view: dashboard_stats`));
        }
      } catch (error: any) {
        errorCount++;
        
        // Some errors are expected (e.g., "already exists")
        if (error.message.includes('already exists')) {
          console.log(chalk.gray(`  - Skipped (already exists): ${error.message.split('"')[1]}`));
        } else {
          console.error(chalk.red(`  ✗ Error: ${error.message}`));
        }
      }
    }
    
    console.log(chalk.green(`\n✅ Migration completed: ${successCount} statements executed, ${errorCount} skipped\n`));
    
    // Show current statistics
    await showStatistics();
    
  } catch (error) {
    console.error(chalk.red('❌ Migration failed:'), error);
  } finally {
    await db.close();
  }
}

async function showStatistics() {
  console.log(chalk.cyan.bold('📊 Current Database Statistics:\n'));
  
  try {
    // Check if tables exist
    const tables = [
      'tokens_unified',
      'trades_unified',
      'price_snapshots_unified',
      'account_states_unified',
      'token_holders_unified'
    ];
    
    for (const table of tables) {
      // First check if table exists
      const tableCheck = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        );
      `, [table]);
      
      if (tableCheck.rows[0].exists) {
        const result = await db.query(
          `SELECT COUNT(*) as count FROM ${table}`
        );
        
        const count = parseInt(result.rows[0].count);
        console.log(chalk.white(`${table}: `) + chalk.yellow(count.toLocaleString()) + ' records');
      } else {
        console.log(chalk.gray(`${table}: not yet created`));
      }
    }
    
    // Check tokens with threshold crossed
    const thresholdResult = await db.query(
      'SELECT COUNT(*) as count FROM tokens_unified WHERE threshold_crossed_at IS NOT NULL'
    ).catch(() => null);
    
    if (thresholdResult) {
      const count = parseInt(thresholdResult.rows[0].count);
      console.log(chalk.green(`\nTokens above $8,888 threshold: ${count.toLocaleString()}`));
    }
    
    // Check graduated tokens
    const graduatedResult = await db.query(
      'SELECT COUNT(*) as count FROM tokens_unified WHERE graduated_to_amm = TRUE'
    ).catch(() => null);
    
    if (graduatedResult) {
      const count = parseInt(graduatedResult.rows[0].count);
      console.log(chalk.cyan(`Graduated tokens: ${count.toLocaleString()}`));
    }
    
  } catch (error) {
    console.error(chalk.red('Error fetching statistics:'), error);
  }
}

// Run the migration
runMigration().catch(console.error);