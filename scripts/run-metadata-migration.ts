#!/usr/bin/env tsx
/**
 * Run metadata columns migration
 */

import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  try {
    console.log(chalk.cyan('Running metadata migration...'));
    
    // Add metadata columns
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS image_uri TEXT,
      ADD COLUMN IF NOT EXISTS uri TEXT,
      ADD COLUMN IF NOT EXISTS metadata_source VARCHAR(20),
      ADD COLUMN IF NOT EXISTS metadata_updated_at TIMESTAMP
    `);
    
    console.log(chalk.green('✅ Added metadata columns'));
    
    // Add indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_tokens_need_metadata 
      ON tokens_unified(created_at DESC) 
      WHERE symbol IS NULL OR name IS NULL
    `);
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_tokens_metadata_source 
      ON tokens_unified(metadata_source, metadata_updated_at)
    `);
    
    console.log(chalk.green('✅ Added metadata indexes'));
    
    // Check how many tokens need enrichment
    const needEnrichment = await db.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE (symbol IS NULL OR name IS NULL)
        AND created_at > NOW() - INTERVAL '7 days'
    `);
    
    console.log(chalk.yellow(`\nTokens needing enrichment: ${needEnrichment.rows[0].count}`));
    
    await db.close();
  } catch (error) {
    console.error(chalk.red('Migration error:'), error);
    process.exit(1);
  }
}

main();