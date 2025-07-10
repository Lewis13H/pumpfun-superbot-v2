/**
 * Add Graduation Tracking Columns
 * Adds columns to better track token graduations
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import chalk from 'chalk';

async function addGraduationColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log(chalk.cyan('📊 Adding graduation tracking columns...\n'));
    
    // Add columns for better graduation tracking
    const alterQueries = [
      {
        name: 'amm_pool_address',
        query: `ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS amm_pool_address TEXT`
      },
      {
        name: 'graduation_signature',
        query: `ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS graduation_signature TEXT`
      },
      {
        name: 'graduation_timestamp',
        query: `ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS graduation_timestamp TIMESTAMP`
      },
      {
        name: 'graduation_method',
        query: `ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS graduation_method TEXT`
      },
      {
        name: 'bc_completion_timestamp',
        query: `ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS bc_completion_timestamp TIMESTAMP`
      }
    ];
    
    for (const { name, query } of alterQueries) {
      try {
        await pool.query(query);
        console.log(chalk.green(`✓ Added column: ${name}`));
      } catch (error: any) {
        if (error.code === '42701') { // Column already exists
          console.log(chalk.gray(`- Column ${name} already exists`));
        } else {
          throw error;
        }
      }
    }
    
    // Add indexes for performance
    const indexQueries = [
      {
        name: 'idx_graduated_to_amm',
        query: `CREATE INDEX IF NOT EXISTS idx_graduated_to_amm ON tokens_unified(graduated_to_amm)`
      },
      {
        name: 'idx_bonding_curve_complete',
        query: `CREATE INDEX IF NOT EXISTS idx_bonding_curve_complete ON tokens_unified(bonding_curve_complete)`
      },
      {
        name: 'idx_amm_pool_address',
        query: `CREATE INDEX IF NOT EXISTS idx_amm_pool_address ON tokens_unified(amm_pool_address)`
      },
      {
        name: 'idx_graduation_timestamp',
        query: `CREATE INDEX IF NOT EXISTS idx_graduation_timestamp ON tokens_unified(graduation_timestamp)`
      }
    ];
    
    console.log(chalk.cyan('\n📈 Adding indexes...'));
    
    for (const { name, query } of indexQueries) {
      try {
        await pool.query(query);
        console.log(chalk.green(`✓ Added index: ${name}`));
      } catch (error: any) {
        console.log(chalk.gray(`- Index ${name} may already exist`));
      }
    }
    
    // Show current graduation stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as bc_complete,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true AND graduated_to_amm = false) as bc_complete_not_graduated,
        COUNT(*) FILTER (WHERE amm_pool_address IS NOT NULL) as has_pool_address,
        COUNT(*) FILTER (WHERE graduation_signature IS NOT NULL) as has_grad_signature
      FROM tokens_unified
    `);
    
    console.log(chalk.cyan('\n📊 Current Stats:'));
    const s = stats.rows[0];
    console.log(`- Total tokens: ${s.total_tokens}`);
    console.log(`- Graduated: ${s.graduated}`);
    console.log(`- BC Complete: ${s.bc_complete}`);
    console.log(`- BC Complete but not graduated: ${s.bc_complete_not_graduated}`);
    console.log(`- Has pool address: ${s.has_pool_address}`);
    console.log(`- Has graduation signature: ${s.has_grad_signature}`);
    
    console.log(chalk.green('\n✨ Database schema updated successfully!'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

addGraduationColumns().catch(console.error);