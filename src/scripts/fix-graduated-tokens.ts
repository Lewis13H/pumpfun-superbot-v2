#!/usr/bin/env tsx
/**
 * Fix tokens that have graduated but are not marked as such
 * Detects tokens with AMM trades that aren't marked as graduated
 */

import { Client } from 'pg';
import { config } from 'dotenv';
import chalk from 'chalk';

config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(chalk.red('DATABASE_URL not found in environment'));
  process.exit(1);
}

async function fixGraduatedTokens() {
  const client = new Client({ connectionString: DATABASE_URL });
  
  try {
    await client.connect();
    console.log(chalk.green('Connected to database'));

    // Find tokens with AMM trades that aren't marked as graduated
    const findQuery = `
      WITH graduated_tokens AS (
        SELECT DISTINCT 
          t.mint_address,
          tok.symbol,
          MIN(CASE WHEN t.program = 'amm_pool' THEN t.block_time END) as first_amm_trade,
          COUNT(CASE WHEN t.program = 'amm_pool' THEN 1 END) as amm_trade_count,
          MAX(t.bonding_curve_progress) as max_bc_progress
        FROM trades_unified t
        INNER JOIN tokens_unified tok ON tok.mint_address = t.mint_address
        WHERE tok.graduated_to_amm = false
        GROUP BY t.mint_address, tok.symbol
        HAVING COUNT(CASE WHEN t.program = 'amm_pool' THEN 1 END) > 0
      )
      SELECT * FROM graduated_tokens
      ORDER BY first_amm_trade DESC;
    `;

    const result = await client.query(findQuery);
    console.log(chalk.yellow(`Found ${result.rows.length} tokens that should be marked as graduated`));

    if (result.rows.length === 0) {
      console.log(chalk.green('No tokens need fixing'));
      return;
    }

    // Display tokens to be fixed
    console.log('\nTokens to fix:');
    for (const token of result.rows) {
      console.log(chalk.cyan(`- ${token.symbol} (${token.mint_address.substring(0, 8)}...)`));
      console.log(`  AMM trades: ${token.amm_trade_count}, Max BC progress: ${token.max_bc_progress || 'N/A'}%`);
      console.log(`  First AMM trade: ${token.first_amm_trade}`);
    }

    // Proceed with update
    console.log(chalk.yellow('\nUpdating tokens...'));
    
    const updateQuery = `
      UPDATE tokens_unified
      SET 
        graduated_to_amm = true,
        graduation_at = subquery.first_amm_trade,
        current_program = 'amm_pool',
        updated_at = NOW()
      FROM (
        SELECT DISTINCT 
          t.mint_address,
          MIN(CASE WHEN t.program = 'amm_pool' THEN t.block_time END) as first_amm_trade
        FROM trades_unified t
        INNER JOIN tokens_unified tok ON tok.mint_address = t.mint_address
        WHERE tok.graduated_to_amm = false
          AND t.program = 'amm_pool'
        GROUP BY t.mint_address
      ) AS subquery
      WHERE tokens_unified.mint_address = subquery.mint_address
      RETURNING tokens_unified.mint_address, tokens_unified.symbol;
    `;

    const updateResult = await client.query(updateQuery);
    console.log(chalk.green(`\nSuccessfully updated ${updateResult.rows.length} tokens:`));
    
    for (const token of updateResult.rows) {
      console.log(chalk.green(`✓ ${token.symbol} (${token.mint_address.substring(0, 8)}...)`));
    }

  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await client.end();
  }
}

// Run the script
fixGraduatedTokens().catch(console.error);