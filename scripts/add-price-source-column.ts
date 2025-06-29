#!/usr/bin/env tsx
/**
 * Add price_source column to track where prices come from (bonding_curve, amm, graphql)
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Adding price_source column...'));
  
  try {
    // Add price_source column
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS price_source TEXT DEFAULT 'unknown'
    `);
    
    console.log(chalk.green('✓ Added price_source column'));
    
    // Update existing tokens based on their program
    await db.query(`
      UPDATE tokens_unified 
      SET price_source = CASE
        WHEN graduated_to_amm = true THEN 'amm'
        WHEN graduated_to_amm = false THEN 'bonding_curve'
        ELSE 'unknown'
      END
      WHERE price_source = 'unknown'
    `);
    
    console.log(chalk.green('✓ Updated existing token price sources'));
    
    // Show statistics
    const stats = await db.query(`
      SELECT 
        price_source,
        COUNT(*) as count
      FROM tokens_unified
      GROUP BY price_source
      ORDER BY count DESC
    `);
    
    console.log(chalk.blue('\nPrice source distribution:'));
    stats.rows.forEach(row => {
      console.log(chalk.white(`  ${row.price_source}: ${row.count}`));
    });
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main().catch(console.error);