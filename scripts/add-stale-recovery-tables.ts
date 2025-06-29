#!/usr/bin/env tsx

/**
 * Add stale token recovery tables
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function migrate() {
  try {
    console.log(chalk.cyan('🔄 Adding stale token recovery tables...'));
    
    // Create stale token recovery log table
    await db.query(`
      CREATE TABLE IF NOT EXISTS stale_token_recovery (
        id BIGSERIAL PRIMARY KEY,
        recovery_batch_id UUID,
        recovery_type VARCHAR(20) DEFAULT 'periodic', -- 'startup', 'periodic', 'manual'
        tokens_checked INTEGER DEFAULT 0,
        tokens_recovered INTEGER DEFAULT 0,
        tokens_failed INTEGER DEFAULT 0,
        graphql_queries INTEGER DEFAULT 0,
        total_duration_ms INTEGER,
        status VARCHAR(20) DEFAULT 'running', -- 'running', 'completed', 'failed'
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);
    
    console.log(chalk.green('✅ Created stale_token_recovery table'));
    
    // Add indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_stale_recovery_status 
      ON stale_token_recovery(status, created_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_stale_recovery_batch 
      ON stale_token_recovery(recovery_batch_id);
    `);
    
    console.log(chalk.green('✅ Created indexes'));
    
    // Add monitoring columns to tokens_unified if they don't exist
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS monitoring_tier INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS last_graphql_update TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_recovery_attempt TIMESTAMPTZ;
    `);
    
    console.log(chalk.green('✅ Updated tokens_unified table'));
    
    // Create a view for monitoring stale tokens
    await db.query(`
      CREATE OR REPLACE VIEW stale_tokens_view AS
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        updated_at,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 as minutes_since_update,
        monitoring_tier,
        recovery_attempts
      FROM tokens_unified
      WHERE 
        graduated_to_amm = false
        AND latest_market_cap_usd > 1000
      ORDER BY 
        minutes_since_update DESC,
        latest_market_cap_usd DESC;
    `);
    
    console.log(chalk.green('✅ Created stale_tokens_view'));
    
    // Create summary statistics function
    await db.query(`
      CREATE OR REPLACE FUNCTION get_stale_token_stats(
        stale_threshold_minutes INTEGER DEFAULT 30
      ) RETURNS TABLE (
        total_active_tokens BIGINT,
        stale_tokens BIGINT,
        critical_stale_tokens BIGINT,
        avg_minutes_since_update NUMERIC,
        total_market_cap_stale NUMERIC
      ) AS $$
      BEGIN
        RETURN QUERY
        SELECT 
          COUNT(*) FILTER (WHERE graduated_to_amm = false) as total_active_tokens,
          COUNT(*) FILTER (
            WHERE graduated_to_amm = false 
            AND updated_at < NOW() - INTERVAL '1 minute' * stale_threshold_minutes
          ) as stale_tokens,
          COUNT(*) FILTER (
            WHERE graduated_to_amm = false 
            AND updated_at < NOW() - INTERVAL '60 minutes'
            AND latest_market_cap_usd > 10000
          ) as critical_stale_tokens,
          AVG(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60) FILTER (
            WHERE graduated_to_amm = false
          ) as avg_minutes_since_update,
          COALESCE(SUM(latest_market_cap_usd) FILTER (
            WHERE graduated_to_amm = false 
            AND updated_at < NOW() - INTERVAL '1 minute' * stale_threshold_minutes
          ), 0) as total_market_cap_stale
        FROM tokens_unified
        WHERE latest_market_cap_usd > 1000;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    console.log(chalk.green('✅ Created get_stale_token_stats function'));
    
    console.log(chalk.green('\n✅ Stale token recovery tables migration complete!'));
    
    // Show current stats
    const stats = await db.query('SELECT * FROM get_stale_token_stats(30)');
    if (stats.rows.length > 0) {
      const s = stats.rows[0];
      console.log(chalk.cyan('\n📊 Current Statistics:'));
      console.log(chalk.gray(`  Total active tokens: ${s.total_active_tokens}`));
      console.log(chalk.gray(`  Stale tokens (>30 min): ${s.stale_tokens}`));
      console.log(chalk.gray(`  Critical stale (>60 min, >$10k): ${s.critical_stale_tokens}`));
      console.log(chalk.gray(`  Average age: ${parseFloat(s.avg_minutes_since_update).toFixed(1)} minutes`));
      console.log(chalk.gray(`  Total stale market cap: $${parseFloat(s.total_market_cap_stale).toLocaleString()}`));
    }
    
  } catch (error) {
    console.error(chalk.red('Error during migration:'), error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run migration
migrate().catch(console.error);