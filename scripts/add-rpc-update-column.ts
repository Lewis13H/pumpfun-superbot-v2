#!/usr/bin/env tsx
/**
 * Add last_rpc_update column to track RPC-based price updates
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Adding last_rpc_update column...'));
  
  try {
    // Add last_rpc_update column
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS last_rpc_update TIMESTAMP WITH TIME ZONE
    `);
    
    console.log(chalk.green('✓ Added last_rpc_update column'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main().catch(console.error);