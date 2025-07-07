#!/usr/bin/env node
import { db } from '../src/database';
import fs from 'fs';
import path from 'path';

async function runMigration() {
  console.log('🚀 Running comprehensive monitoring schema migration...\n');
  
  try {
    // Read the SQL schema file
    const schemaPath = path.join(__dirname, 'comprehensive-monitoring-schema-fixed.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    // More robust SQL statement splitting that handles functions
    const statements: string[] = [];
    let currentStatement = '';
    let inDollarQuote = false;
    
    const lines = schemaSql.split('\n');
    for (const line of lines) {
      // Skip comment-only lines
      if (line.trim().startsWith('--') && !inDollarQuote) {
        continue;
      }
      
      // Check for dollar quotes
      if (line.includes('$$')) {
        inDollarQuote = !inDollarQuote;
      }
      
      currentStatement += line + '\n';
      
      // Statement ends with ; and we're not in a dollar quote
      if (line.trim().endsWith(';') && !inDollarQuote) {
        const trimmed = currentStatement.trim();
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim().length > 0) {
      statements.push(currentStatement.trim());
    }
    
    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Extract a description from the statement
      let description = 'SQL statement';
      if (statement.includes('CREATE TABLE')) {
        const match = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
        description = `Create table: ${match?.[1] || 'unknown'}`;
      } else if (statement.includes('CREATE TYPE')) {
        const match = statement.match(/CREATE TYPE (\w+)/);
        description = `Create type: ${match?.[1] || 'unknown'}`;
      } else if (statement.includes('CREATE FUNCTION')) {
        const match = statement.match(/CREATE OR REPLACE FUNCTION (\w+)/);
        description = `Create function: ${match?.[1] || 'unknown'}`;
      } else if (statement.includes('CREATE TRIGGER')) {
        const match = statement.match(/CREATE TRIGGER (\w+)/);
        description = `Create trigger: ${match?.[1] || 'unknown'}`;
      } else if (statement.includes('CREATE EXTENSION')) {
        const match = statement.match(/CREATE EXTENSION IF NOT EXISTS "?(\w+)"?/);
        description = `Create extension: ${match?.[1] || 'unknown'}`;
      } else if (statement.includes('CREATE INDEX')) {
        const match = statement.match(/INDEX (\w+)/);
        description = `Create index: ${match?.[1] || 'unknown'}`;
      }
      
      console.log(`[${i + 1}/${statements.length}] ${description}`);
      
      try {
        await db.query(statement);
        console.log('✅ Success\n');
      } catch (error: any) {
        // Some errors are acceptable (e.g., type already exists)
        if (error.message.includes('already exists')) {
          console.log('⚠️  Already exists (skipping)\n');
        } else {
          console.error('❌ Error:', error.message, '\n');
          throw error;
        }
      }
    }
    
    // Verify tables were created
    console.log('🔍 Verifying migration...\n');
    
    const tables = [
      'tokens_comprehensive',
      'bonding_curve_states',
      'bonding_curve_trades',
      'amm_pools',
      'amm_pool_states',
      'amm_swaps',
      'token_stats_hourly',
      'processing_queue',
      'monitoring_metrics'
    ];
    
    for (const table of tables) {
      const result = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )
      `, [table]);
      
      if (result.rows[0].exists) {
        console.log(`✅ Table ${table} exists`);
      } else {
        console.log(`❌ Table ${table} NOT FOUND`);
      }
    }
    
    console.log('\n✨ Migration completed successfully!');
    
    // Show some statistics
    console.log('\n📊 Database Statistics:');
    
    const stats = await db.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename IN (${tables.map((_, i) => `$${i + 1}`).join(',')})
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `, tables);
    
    console.log('\nTable sizes:');
    stats.rows.forEach((row: any) => {
      console.log(`  ${row.tablename}: ${row.size}`);
    });
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run the migration
runMigration().catch(console.error);