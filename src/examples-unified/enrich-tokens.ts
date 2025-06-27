#!/usr/bin/env node
/**
 * Enrich tokens with metadata from Helius
 * Works with the unified database schema
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { HeliusService } from '../services/helius';
import chalk from 'chalk';
import ora from 'ora';

async function enrichTokens() {
  if (!process.env.HELIUS_API_KEY) {
    console.error(chalk.red('Error: HELIUS_API_KEY not found in environment variables'));
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const helius = HeliusService.getInstance();

  try {
    // Get tokens that need enrichment
    const result = await pool.query(`
      SELECT t.mint_address, t.symbol, t.name
      FROM tokens_unified t
      LEFT JOIN token_metadata_unified tm ON t.mint_address = tm.mint_address
      WHERE t.threshold_crossed_at IS NOT NULL
        AND tm.mint_address IS NULL
      ORDER BY t.threshold_crossed_at DESC
      LIMIT 50
    `);

    if (result.rows.length === 0) {
      console.log(chalk.green('✅ All tokens are already enriched!'));
      return;
    }

    console.log(chalk.cyan(`\n🔍 Found ${result.rows.length} tokens to enrich\n`));

    for (const token of result.rows) {
      const spinner = ora(`Enriching ${token.symbol || token.mint_address.slice(0, 8)}...`).start();

      try {
        // Fetch metadata from Helius
        const metadata = await helius.getTokenMetadata(token.mint_address);

        if (metadata) {
          // Insert or update metadata
          await pool.query(`
            INSERT INTO token_metadata_unified (
              mint_address,
              update_authority,
              name,
              symbol,
              uri,
              additional_metadata,
              description,
              token_standard,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (mint_address) DO UPDATE SET
              name = EXCLUDED.name,
              symbol = EXCLUDED.symbol,
              description = EXCLUDED.description,
              updated_at = NOW()
          `, [
            token.mint_address,
            metadata.updateAuthority,
            metadata.name,
            metadata.symbol,
            metadata.uri,
            JSON.stringify(metadata.additionalMetadata || {}),
            metadata.description,
            metadata.tokenStandard
          ]);

          // Update the main token record if we got better data
          if (metadata.symbol || metadata.name) {
            await pool.query(`
              UPDATE tokens_unified 
              SET 
                symbol = COALESCE($2, symbol),
                name = COALESCE($3, name)
              WHERE mint_address = $1
            `, [token.mint_address, metadata.symbol, metadata.name]);
          }

          spinner.succeed(`Enriched ${metadata.symbol || token.symbol || 'Unknown'} - ${metadata.name || 'No name'}`);
        } else {
          spinner.warn(`No metadata found for ${token.symbol || token.mint_address.slice(0, 8)}`);
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        spinner.fail(`Failed to enrich ${token.symbol || token.mint_address.slice(0, 8)}: ${error.message}`);
      }
    }

    // Show summary
    const enrichedCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM token_metadata_unified
    `);

    console.log(chalk.green(`\n✅ Total enriched tokens: ${enrichedCount.rows[0].count}`));

  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  enrichTokens().catch(console.error);
}

export { enrichTokens };