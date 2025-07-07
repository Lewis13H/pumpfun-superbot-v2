#!/usr/bin/env npx tsx

/**
 * Create AMM Tokens
 * Create token records for AMM trades that don't have tokens
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

async function main() {
  console.log(chalk.cyan('\n🔧 Creating AMM Tokens\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Find unique AMM mints without token records
    const missingTokens = await pool.query(`
      SELECT DISTINCT 
        t.mint_address,
        MIN(t.created_at) as first_seen,
        MIN(t.slot) as first_slot,
        COUNT(*) as trade_count,
        AVG(t.price_sol) as avg_price_sol,
        AVG(t.price_usd) as avg_price_usd
      FROM trades_unified t
      LEFT JOIN tokens_unified tok ON t.mint_address = tok.mint_address
      WHERE t.program = 'amm_pool' 
      AND tok.mint_address IS NULL
      GROUP BY t.mint_address
      LIMIT 50
    `);
    
    console.log(`Found ${missingTokens.rows.length} AMM tokens without records\n`);
    
    if (missingTokens.rows.length === 0) {
      console.log('All AMM tokens have records!');
      return;
    }
    
    // Create token records
    let created = 0;
    
    for (const token of missingTokens.rows) {
      try {
        // Use a reasonable default price if the parsed price is 0
        const priceSol = Number(token.avg_price_sol) || 0.000001;
        const priceUsd = Number(token.avg_price_usd) || 0.0001;
        const marketCapUsd = priceUsd * 1000000000; // Assume 1B supply
        
        await pool.query(`
          INSERT INTO tokens_unified (
            mint_address,
            first_price_sol,
            first_price_usd,
            first_market_cap_usd,
            latest_price_sol,
            latest_price_usd,
            latest_market_cap_usd,
            graduated_to_amm,
            price_source,
            first_program,
            current_program,
            first_seen_slot,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (mint_address) DO NOTHING
        `, [
          token.mint_address,
          priceSol,
          priceUsd,
          marketCapUsd,
          priceSol,
          priceUsd,
          marketCapUsd,
          true, // graduated_to_amm
          'amm', // price_source
          'amm_pool', // first_program
          'amm_pool', // current_program
          Number(token.first_slot), // first_seen_slot
          token.first_seen,
          new Date()
        ]);
        
        created++;
        console.log(chalk.green(`✅ Created token ${token.mint_address.substring(0, 8)}... (${token.trade_count} trades)`));
        
      } catch (error) {
        console.error(chalk.red(`Failed to create token ${token.mint_address}:`), error);
      }
    }
    
    console.log(chalk.green(`\n✅ Created ${created} AMM token records`));
    
    // Show stats
    const stats = await pool.query(`
      SELECT 
        COUNT(DISTINCT mint_address) as total_tokens,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as amm_tokens,
        COUNT(*) FILTER (WHERE graduated_to_amm = false) as bc_tokens
      FROM tokens_unified
    `);
    
    const s = stats.rows[0];
    console.log(chalk.cyan('\nToken Statistics:'));
    console.log(`Total tokens: ${s.total_tokens}`);
    console.log(`AMM tokens: ${s.amm_tokens}`);
    console.log(`BC tokens: ${s.bc_tokens}`);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);